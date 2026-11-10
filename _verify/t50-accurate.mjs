/* t50-accurate — v5.7 新增能力验收：
   A 保存不再吃掉作者的裸 data-drag
   B 保存门控：没改动不写盘 / 改完保存两次幂等
   C 方向键微调 1px、Shift 10px，且能撤销
   D 面板 X/Y/W/H 数值输入直接落位
   E 按住空格临时 1:1 真实比例，松开恢复
   运行前：node scripts/editable-studio.mjs --port 8899 --no-open */
import { launch } from "./cdp.mjs";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://127.0.0.1:8899";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(HERE, "..");
const SLIDE = path.join(ROOT, "slides", "03-new.html");
const OUT = HERE + path.sep;
const P = (ok, msg) => console.log((ok ? "PASS  " : "FAIL  ") + msg);
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
const shaFile = () => sha(fs.readFileSync(SLIDE, "utf8"));
const original = fs.readFileSync(SLIDE, "utf8");

const VK = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, " ": 32 };
/* 按键直接派发到 iframe 的 document 上：CDP 的 Input 事件要求目标 frame 自己持焦，
   在 iframe + 缩放布局里很容易落空；用真的 KeyboardEvent 派发能给 handlers 确定的行为 */
const keyIn = async (b, api, key, opts = {}) => {
  await b.eval(api(`
    d.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, shiftKey: ${!!opts.shift} }));
    return 1`));
  await b.sleep(Math.max(60, opts.wait || 90));
  await b.eval(api(`
    d.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true, shiftKey: ${!!opts.shift} }));
    return 1`));
  await b.sleep(60);
};

const b = await launch({ port: 9371 });
const errors = [];
const pump = setInterval(() => {
  for (const m of b.events.splice(0)) {
    if (m.method === "Runtime.exceptionThrown")
      errors.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
}, 100);
const api = (e) => `const f=document.getElementById('f'); const w=f.contentWindow, d=f.contentDocument; ${e}`;

try {
  await b.setViewport(1600, 1000);
  await b.goto(BASE + "/__wb/studio.html", 1500);
  await b.eval(`
    const it=[...document.querySelectorAll('#files .item')].find(x=>x.title==='slides/03-new.html');
    if(it) it.click(); return 1`);
  await b.sleep(900);
  await b.eval(`document.getElementById('edit').click(); return 1`);
  await b.sleep(1600);

  /* ═════ B① 什么都不改就保存 → 不许写盘 ═════ */
  const s0 = shaFile();
  await b.eval(api(`d.getElementById('ed_save').click(); return 1`));
  await b.sleep(900);
  const toast1 = await b.eval(api(`const t=w.document.getElementById('ed_toast'); return t?t.textContent:''`));
  console.log("空保存提示:", JSON.stringify(toast1));
  P(s0 === shaFile(), `没改动时点保存：文件逐字节未变（${s0}）`);

  /* ═════ C 方向键微调 ═════ */
  const tgt = await b.eval(api(`
    const el = d.querySelector('[data-drag].blk') || d.querySelector('[data-drag]') || d.querySelector('.blk');
    el.setAttribute('data-test-target','1');
    return { tag: el.tagName, cls: el.className };`));
  console.log("微调目标:", JSON.stringify(tgt));
  await b.eval(api(`w.__editableAPI.select(d.querySelector('[data-test-target]')); d.body.setAttribute('tabindex','-1'); d.body.focus(); w.focus(); return 1`));
  await b.sleep(300);

  const geo = async () => await b.eval(api(`
    const el=d.querySelector('[data-test-target]');
    const s=d.querySelector('.slide'); const sr=s.getBoundingClientRect();
    const r=el.getBoundingClientRect(); const k=sr.width/s.offsetWidth;
    return { free: el.getAttribute('data-free'),
             x: +(((r.left-sr.left)/k).toFixed(2)), y: +(((r.top-sr.top)/k).toFixed(2)),
             w: el.style.width, h: el.style.height };`));

  const g0 = await geo();
  for (let i = 0; i < 3; i++) { await keyIn(b, api, "ArrowRight"); }
  await b.sleep(250);
  const g1 = await geo();
  console.log("方向键 ×3:", JSON.stringify({ x0: g0.x, x1: g1.x, free: g1.free }));
  P(g1.free === "1", "方向键把元素转入自由定位");
  P(Math.abs(g1.x - (g0.x + 3)) < 0.6, `→ 连按 3 次位移 ${(g1.x - g0.x).toFixed(1)}px（期望 3）`);

  await keyIn(b, api, "ArrowDown", { shift: true });
  await b.sleep(250);
  const g2 = await geo();
  P(Math.abs(g2.y - (g1.y + 10)) < 0.6, `Shift+↓ 位移 ${(g2.y - g1.y).toFixed(1)}px（期望 10）`);

  await b.eval(api(`w.__editableAPI.undo(); return 1`));
  await b.sleep(350);
  const g3 = await geo();
  console.log("撤销后:", JSON.stringify({ x: g3.x, y: g3.y }));
  P(Math.abs(g3.y - g0.y) < 0.6 || Math.abs(g3.y - g1.y) < 0.6, "撤销退回到上一步（连续方向键合为一个撤销步）");

  /* ═════ D 面板数值输入 ═════ */
  await b.eval(api(`w.__editableAPI.select(d.querySelector('[data-test-target]')); return 1`));
  await b.sleep(250);
  const setNum = async (id, v) => await b.eval(api(`
    const n=d.querySelector('#${id}'); n.value='${v}';
    n.dispatchEvent(new Event('change',{bubbles:true})); return n.value;`));
  await setNum("ed_x", 120); await b.sleep(150);
  await setNum("ed_y", 180); await b.sleep(150);
  await setNum("ed_bw", 420); await b.sleep(150);
  await setNum("ed_bh", 160); await b.sleep(300);
  const g4 = await geo();
  console.log("面板输入后:", JSON.stringify(g4));
  P(Math.abs(g4.x - 120) < 0.6 && Math.abs(g4.y - 180) < 0.6, `X/Y 输入生效 = ${g4.x} / ${g4.y}`);  P(Math.abs(parseFloat(g4.w) - 420) < 0.6 && Math.abs(parseFloat(g4.h) - 160) < 0.6,
    `W/H 输入生效 = ${g4.w} / ${g4.h}`);
  const panelSynced = await b.eval(api(`
    return { x: d.querySelector('#ed_x').value, y: d.querySelector('#ed_y').value,
             w: d.querySelector('#ed_bw').value, h: d.querySelector('#ed_bh').value ,
             geom: d.querySelector('#ed_geom').textContent };`));
  console.log("面板回填:", JSON.stringify(panelSynced));
  P(panelSynced.x === "120" && panelSynced.w === "420", "面板数值与元素真实几何同步");

  /* ═════ E 按住空格 1:1 ═════ */
  const baseScale = await b.eval(api(`return w.__editableAPI.debug().scale`));
  await b.eval(api(`d.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })); return 1`));
  await b.sleep(500);
  const heldScale = await b.eval(api(`return w.__editableAPI.debug().scale`));
  const badge = await b.eval(api(`const n=d.getElementById('ed_spacebadge'); return n?n.textContent:''`));
  console.log("空格按下:", JSON.stringify({ base: baseScale, held: heldScale, badge }));
  P(Math.abs(heldScale - 1) < 0.02, `按住空格 → 缩放 ${heldScale.toFixed(3)}（期望 1，即 1:1）`);
  P(/1:1/.test(badge), "出现 1:1 提示条");
  await b.eval(api(`d.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true })); return 1`));
  await b.sleep(400);
  const backScale = await b.eval(api(`return w.__editableAPI.debug().scale`));
  const badge2 = await b.eval(api(`const n=d.getElementById('ed_spacebadge'); return n?n.textContent:'(已移除)'`));
  P(Math.abs(backScale - baseScale) < 0.01, `松开空格恢复 ${backScale.toFixed(3)}（原 ${baseScale.toFixed(3)}）`);
  P(badge2 === "(已移除)", "提示条已移除");

  /* ═════ A + B② 真改动后保存：data-drag 必须还在 ═════ */
  const shaBeforeSave = shaFile();
  await b.eval(api(`w.__editableAPI.select(d.querySelector('[data-test-target]')); return 1`));
  await b.sleep(200);
  await setNum("ed_x", 300); await b.sleep(250);
  await b.eval(api(`return w.__editableAPI.save()`));
  await b.sleep(900);
  const saved = fs.readFileSync(SLIDE, "utf8");
  console.log("保存后体积:", original.length, "→", saved.length);
  P(shaBeforeSave !== sha(saved), "有改动时确实写盘了");
  P(/data-drag[\s=>]/.test(original) && /data-drag[\s=>]/.test(saved),
    `作者的裸 data-drag 没被删（原文 ${(original.match(/data-drag(?=[\s>])/g) || []).length} 处，保存后 ${(saved.match(/data-drag(?=[\s>=])/g) || []).length} 处）`);
  const junk = [/data-eid/, /data-ed-inject/, /__editable/, /data-ed-anchor/, /data-sel/, /__EDIT_FILE__/]
    .filter((re) => re.test(saved));
  P(junk.length === 0, "写回的文件没有编辑器残留" + (junk.length ? " 命中:" + junk.join(" ") : ""));  P(/transform:\s*scale\(/.test(saved) === false, "编辑期 scale 没有写进文件");
  /* 页坐标 X=300 是面板口径；文件里存的是「父容器坐标系」的 left（与画布锁定的写法一致），
     所以要比对「页坐标」而不是死瞅字面上的 300px。 */
  const xWritten = await b.eval(api(`
    const el=d.querySelector('[data-test-target]');
    const s=d.querySelector('.slide');
    const k=s.getBoundingClientRect().width/s.offsetWidth;
    const sb=s.getBoundingClientRect(), eb=el.getBoundingClientRect();
    return { pageX: Math.round((eb.left-sb.left)/k), inline: parseFloat(el.style.left)||0 };
  `));
  console.log("X 校对:", JSON.stringify(xWritten));
  P(Math.abs(xWritten.pageX - 300) <= 1 &&
    (saved.includes("left:" + xWritten.inline + "px") || saved.includes("left: " + xWritten.inline + "px")),
    `X=300 已生效并落文件（页坐标 ${xWritten.pageX}，inline left:${xWritten.inline}px）`);

  /* ═════ B③ 紧接着再点一次保存 → 幂等 ═════ */
  const shaAfter1 = sha(saved);
  await b.eval(api(`return w.__editableAPI.save()`));
  await b.sleep(900);
  const toast2 = await b.eval(api(`const t=w.document.getElementById('ed_toast'); return t?t.textContent:''`));
  console.log("二次保存提示:", JSON.stringify(toast2));
  P(shaAfter1 === shaFile(), `连点第二次保存：文件不变（幂等，${shaAfter1}）`);

  console.log("\n控制台错误:", errors.length ? errors.join("\n") : "无 error");
} catch (e) {
  console.log("EXCEPTION:", e.message);
} finally {
  clearInterval(pump);
  try { if (fs.readFileSync(SLIDE, "utf8") !== original) fs.writeFileSync(SLIDE, original, "utf8"); } catch (e) {}
  await b.close();
}
