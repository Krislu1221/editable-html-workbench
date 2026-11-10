/* t11-full — 全链路验收：拖动 / 缩放 / 旋转 / 撤销 / 回到栅格 / 双击改字 /
   面板改字 / 层级 / 保存写回 / 回退。
   运行前先在包根启动工作台：node scripts/editable-studio.mjs --port 8899 --no-open */
import { launch } from "./cdp.mjs";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://127.0.0.1:8899";
// 脚本位于 <包根>/_verify/，所以包根 = 上一级；从别处调用时可用第 3 个参数指定包根
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(HERE, "..");
const SLIDE_REL = "slides/03-new.html";
const SLIDE_ABS = path.join(ROOT, "slides", "03-new.html");
const OUT = HERE + path.sep;
const P = (ok, msg) => console.log((ok ? "PASS  " : "FAIL  ") + msg);
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

const original = fs.readFileSync(SLIDE_ABS, "utf8");
const originalSha = sha(original);

const b = await launch({ port: 9333 });
const errors = [];
const pump = setInterval(() => {
  for (const m of b.events.splice(0)) {
    if (m.method === "Runtime.exceptionThrown")
      errors.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
}, 100);

const rectOf = (sel) => `
  const f=document.getElementById('f'); const fr=f.getBoundingClientRect(); const d=f.contentDocument;
  const el=d.querySelector(${JSON.stringify(sel)}); if(!el) return null;
  const r=el.getBoundingClientRect();
  return {x:fr.left+r.left, y:fr.top+r.top, w:r.width, h:r.height};
`;
const api = (expr) => `const w=document.getElementById('f').contentWindow; const d=w.document; ${expr}`;

try {
  await b.setViewport(1600, 1000);
  await b.goto(BASE + "/__wb/studio.html", 1200);
  // 按文件名点选（列表把 index.html 排在最前，不能靠 next 次数推断）
  await b.eval(`(()=>{const it=[...document.querySelectorAll('#files .item')].find(x=>x.title==='slides/03-new.html'); if(it) it.click(); return 1})()`);
  await b.sleep(800);
  await b.eval(`document.getElementById('edit').click();return 1`);
  await b.sleep(1600);

  const dbg = await b.eval(api(`return w.__editableAPI.debug();`));
  console.log("编辑器状态:", JSON.stringify(dbg));
  P(dbg.overlay && dbg.handles === 8, "原生内核就绪（overlay + 8 控制点）");

  const cur = await b.eval(`return document.getElementById('cur').textContent`);
  P(cur === SLIDE_REL, "当前页 = " + cur);

  const { k } = await b.eval(api(`
    const s=d.querySelector('.slide');
    return { k: s.getBoundingClientRect().width / s.offsetWidth };
  `));
  console.log("画布缩放比 k =", k.toFixed(6));

  /* ── 1. 拖动 ─────────────────────────────── */
  console.log("\n== 1. 拖动 ==");
  /* 用 data-eid 做稳定定位：元素的 DOM 位置在拖/撤销后会变，
     用类名选择器会选中另一个同类块。 */
  const EID = await b.eval(api(`return d.querySelector('.slide .blk[data-drag]').dataset.eid;`));
  const TGT = '[data-eid="' + EID + '"]';
  console.log("目标元素:", TGT);
  const r0 = await b.eval(rectOf(TGT));
  await b.mouse("mousePressed", r0.x + r0.w / 2, r0.y + r0.h / 2);
  await b.sleep(60);
  P(!!(await b.eval(api(`return d.querySelector('[data-sel]') ? 1 : 0;`))), "单击即选中");
  await b.mouse("mouseReleased", r0.x + r0.w / 2, r0.y + r0.h / 2);
  await b.sleep(150);

  const beforeScreen = await b.eval(rectOf(TGT));
  await b.drag(r0.x + r0.w / 2, r0.y + r0.h / 2, r0.x + r0.w / 2 + 100, r0.y + r0.h / 2 + 60, 14);
  const afterScreen = await b.eval(rectOf(TGT));
  const s1 = await b.eval(api(`
    const el=d.querySelector('${TGT}');
    return { left: parseFloat(el.style.left)||0, top: parseFloat(el.style.top)||0,
             free: el.getAttribute('data-free'), parent: el.parentElement.className,
             pos: el.style.position, w: el.style.width, h: el.style.height };
  `));
  console.log("拖动后:", JSON.stringify(s1));
  const gotX = (afterScreen.x - beforeScreen.x) / k;
  const gotY = (afterScreen.y - beforeScreen.y) / k;
  const expX = 100 / k, expY = 60 / k;
  console.log(`屏幕位移 (100,60) → 逻辑位移 (${gotX.toFixed(1)}, ${gotY.toFixed(1)})，期望 (${expX.toFixed(1)}, ${expY.toFixed(1)})`);
  /* v5.13 起拖动不再把元素搬进 .free-layer：元素留在原父节点里转成绝对定位。
     重点验证「CSS 上下文不丢」——父节点不变，类名与选择器链全部保留。 */
  P(s1.free === "1" && s1.pos === "absolute" && !/free-layer/.test(s1.parent),
    "拖动后留在原父节点并转成绝对定位（父节点 = " + s1.parent + "）");
  P(Math.abs(gotX - expX) <= 7, `水平位移 ${gotX.toFixed(1)} ≈ 期望 ${expX.toFixed(1)}（±吸附 6px）`);
  P(Math.abs(gotY - expY) <= 7, `垂直位移 ${gotY.toFixed(1)} ≈ 期望 ${expY.toFixed(1)}`);
  P(!!s1.w && !!s1.h, "拖动时锁定了宽高（不变整行宽）");

  await b.screenshot(OUT + "10-drag.png");

  /* ── 2. 缩放 ─────────────────────────────── */
  console.log("\n== 2. 缩放 ==");
  const he = await b.eval(rectOf('.ed-handle[data-dir="e"]'));
  const wBefore = await b.eval(api(`return parseFloat(d.querySelector('${TGT}').style.width)||0;`));
  await b.drag(he.x + he.w / 2, he.y + he.h / 2, he.x + he.w / 2 + 80, he.y + he.h / 2, 10);
  const wAfter = await b.eval(api(`return parseFloat(d.querySelector('${TGT}').style.width)||0;`));
  console.log(`宽度 ${wBefore.toFixed(1)} → ${wAfter.toFixed(1)}`);
  P(wAfter - wBefore > 50, "拖右中控制点 ⇒ 变宽");

  /* ── 3. 旋转 ─────────────────────────────── */
  console.log("\n== 3. 旋转 ==");
  const rh = await b.eval(rectOf("#__editable_rotate"));
  await b.drag(rh.x + rh.w / 2, rh.y + rh.h / 2, rh.x + rh.w / 2 + 90, rh.y + rh.h / 2 + 40, 10);
  const rot = await b.eval(api(`return d.querySelector('${TGT}').style.transform || '';`));
  P(/rotate\(\s*-?\d+deg\)/.test(rot), `已写入旋转 = ${rot || "(空)"}`);

  /* ── 4. 撤销回到栅格 ─────────────────────── */
  console.log("\n== 4. 撤销 ==");
  for (let i = 0; i < 3; i++) { await b.eval(api(`w.__editableAPI.undo(); return 1;`)); await b.sleep(220); }
  const s2 = await b.eval(api(`
    const el=d.querySelector('${TGT}');
    return { free: el.getAttribute('data-free'), parent: el.parentElement.className,
             inFree: !!el.closest('.free-layer'), left: el.style.left||'', deg: el.style.transform||'' };
  `));
  console.log("撤销后:", JSON.stringify(s2));
  P(!s2.inFree, "撤销后元素回到栅格（不在 .free-layer）");
  P(!s2.deg, "撤销后旋转已清除");

  /* ── 5. 回到栅格按钮 ─────────────────────── */
  console.log("\n== 5. 回到栅格 ==");
  const r1 = await b.eval(rectOf(TGT));
  await b.drag(r1.x + r1.w / 2, r1.y + r1.h / 2, r1.x + r1.w / 2 + 70, r1.y + r1.h / 2 + 40, 8);
  await b.eval(api(`d.querySelector('#ed_regrid').click(); return 1;`));
  await b.sleep(250);
  const s3 = await b.eval(api(`
    const el=d.querySelector('${TGT}');
    return { inFree: !!el.closest('.free-layer'), parent: el.parentElement.className,
             left: el.style.left||'', free: el.getAttribute('data-free')||'' };
  `));
  console.log("回到栅格:", JSON.stringify(s3));
  P(!s3.inFree && !s3.free, "回到栅格后真正回到 grid 父节点");

  /* ── 6. 双击改字 + 结构保留 ──────────────── */
  console.log("\n== 6. 双击改字 ==");
  const HSEL = TGT + " h4";
  const hr = await b.eval(rectOf(HSEL));
  await b.mouse("mouseMoved", hr.x + 10, hr.y + hr.h / 2);
  await b.mouse("mousePressed", hr.x + 10, hr.y + hr.h / 2, { clickCount: 1 });
  await b.mouse("mouseReleased", hr.x + 10, hr.y + hr.h / 2, { clickCount: 1 });
  await b.sleep(50);
  await b.mouse("mousePressed", hr.x + 10, hr.y + hr.h / 2, { clickCount: 2 });
  await b.mouse("mouseReleased", hr.x + 10, hr.y + hr.h / 2, { clickCount: 2 });
  await b.sleep(350);
  const ce = await b.eval(api(`return { ce: d.querySelector('${HSEL}').contentEditable, sel: !!d.querySelector('[data-sel]') };`));
  P(ce.ce === "true", "双击进入可编辑状态");

  await b.eval(api(`
    const el=d.querySelector('${HSEL}');
    el.focus(); d.execCommand('selectAll',false,null);
    d.execCommand('insertText',false,'改字测试 ABC');
    el.blur(); return 1;
  `));
  await b.sleep(250);
  const txt = await b.eval(api(`
    const el=d.querySelector('${HSEL}');
    return { text: el.textContent.trim(), tag: el.tagName };
  `));
  P(txt.text === "改字测试 ABC" && txt.tag === "H4", `文字已改且结构保留 = "${txt.text}"`);

  /* ── 7. 面板改字只改元素自身文本 ─────────── */
  console.log("\n== 7. 面板改字 ==");
  const h2res = await b.eval(api(`
    const el=d.querySelector('.slide h2');
    if (!el) return { skip: true };
    w.__editableAPI.select(el);
    const inp=d.querySelector('#ed_text'); inp.value='新标题';
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    return { after: el.textContent.trim(), span: el.querySelector('.hl') ? el.querySelector('.hl').textContent : null };
  `));
  console.log("标题改字:", JSON.stringify(h2res));
  if (!h2res.skip) P(h2res.after.indexOf("新标题") >= 0, "选中标题改字生效在标题本身");

  /* ── 8. 层级 ─────────────────────────────── */
  console.log("\n== 8. 层级 ==");
  await b.eval(api(`w.__editableAPI.select(d.querySelector('${TGT}')); return 1;`));
  await b.eval(api(`d.querySelector('#__editable_panel [data-z="front"]').click(); return 1;`));
  await b.sleep(200);
  const z = await b.eval(api(`return d.querySelector('${TGT}').style.zIndex || '(none)';`));
  P(z !== "(none)", `置顶后 z-index = ${z}`);

  await b.screenshot(OUT + "11-edited.png");

  /* ── 9. 保存 + 文件干净 ──────────────────── */
  console.log("\n== 9. 保存写回原文件 ==");
  await b.eval(api(`return w.__editableAPI.save().then(()=> 'ok');`));
  await b.sleep(500);
  const saved = fs.readFileSync(SLIDE_ABS, "utf8");
  const savedSha = sha(saved);
  console.log(`文件 ${original.length} → ${saved.length} bytes, sha ${originalSha} → ${savedSha}`);
  P(savedSha !== originalSha, "文件确实被写回（内容变化）");
  const dirty = [
    ["data-eid", /data-eid/],
    ["__EDIT_FILE__", /__EDIT_FILE__/],
    ["data-ed-inject", /data-ed-inject/],
    ["moveable", /moveable/i],
    ["data-sel", /data-sel/],
    ["__editable", /__editable/],
    ["ed-handle", /ed-handle/],
    ["contenteditable", /contenteditable/i],
  ].filter(([, re]) => re.test(saved));
  P(dirty.length === 0, "交付文件干净（无编辑器残留）" + (dirty.length ? " 命中: " + dirty.map((d) => d[0]).join(",") : ""));
  P(/<\/html>\s*$/.test(saved), "仍是完整 HTML");
  P(saved.length < original.length + 4000, "体积没有暴涨");

  /* ── 10. 回退 ────────────────────────────── */
  console.log("\n== 10. /__revert 回退 ==");
  const rev = await (await fetch(BASE + "/__revert", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: SLIDE_REL }),
  })).json();
  const restored = fs.readFileSync(SLIDE_ABS, "utf8");
  P(rev.ok && sha(restored) === originalSha, "回退后与原文件逐字节一致");

  console.log("\n== 控制台错误 ==");
  console.log(errors.length ? errors.join("\n") : "(无 error)");
} catch (e) {
  console.log("EXCEPTION:", e.message);
} finally {
  clearInterval(pump);
  try {
    if (sha(fs.readFileSync(SLIDE_ABS, "utf8")) !== originalSha) fs.writeFileSync(SLIDE_ABS, original, "utf8");
  } catch (e) {}
  await b.close();
}
