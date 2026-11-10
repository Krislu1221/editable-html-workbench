/* t12-extra — 封面页拖动 / 吸附参考线 / 切页状态 / 独立演示外壳 index.html */
import { launch } from "./cdp.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://127.0.0.1:8899";
const OUT = path.dirname(fileURLToPath(import.meta.url)) + path.sep;
const P = (ok, msg) => console.log((ok ? "PASS  " : "FAIL  ") + msg);

const b = await launch({ port: 9335 });
const errors = [];
const pump = setInterval(() => {
  for (const m of b.events.splice(0)) {
    if (m.method === "Runtime.exceptionThrown")
      errors.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
}, 100);
const api = (e) => `const w=document.getElementById('f').contentWindow; const d=w.document; ${e}`;
const rectOf = (sel) => `
  const f=document.getElementById('f'); const fr=f.getBoundingClientRect(); const d=f.contentDocument;
  const el=d.querySelector(${JSON.stringify(sel)}); if(!el) return null;
  const r=el.getBoundingClientRect();
  return {x:fr.left+r.left, y:fr.top+r.top, w:r.width, h:r.height};
`;

try {
  await b.setViewport(1600, 1000);
  await b.goto(BASE + "/__wb/studio.html", 1200);
  // 列表把 index.html 排最前，所以按文件名点选
  await b.eval(`(()=>{const it=[...document.querySelectorAll('#files .item')].find(x=>x.title==='slides/01-cover.html'); if(it) it.click(); return 1})()`);
  await b.sleep(700);
  await b.eval(`document.getElementById('edit').click();return 1`);
  await b.sleep(1600);

  /* ── A. 封面页（无 data-drag，块级 h1） ───────────────── */
  console.log("== A. 封面页拖动 ==");
  P((await b.eval(`return document.getElementById('cur').textContent`)) === "slides/01-cover.html", "当前为封面页");
  const r0 = await b.eval(rectOf(".slide h1.t"));
  await b.drag(r0.x + 40, r0.y + r0.h / 2, r0.x + 40 + 60, r0.y + r0.h / 2 + 30, 10);
  const cover = await b.eval(api(`
    const el=d.querySelector('.slide h1.t');
    return { free: el.getAttribute('data-free'), left: parseFloat(el.style.left)||0, w: el.style.width,
             inFree: !!el.closest('.free-layer') };
  `));
  console.log("封面拖动:", JSON.stringify(cover));
  P(cover.free === "1" && !cover.inFree && !!cover.w,
    "h1 标题可拖动、留在原父节点、宽高已锁定（v5.13 不再搬进自由层）");
  P(!!cover.w, "拖动时宽高已锁定");

  /* ── B. 吸附参考线 ───────────────────────────────────── */
  console.log("\n== B. 吸附参考线 ==");
  await b.eval(`(()=>{const it=[...document.querySelectorAll('#files .item')].find(x=>x.title==='slides/03-new.html'); if(it) it.click(); return 1})()`);
  await b.sleep(900);
  const ids = await b.eval(api(`
    const blks=[...d.querySelectorAll('.slide .blk[data-drag]')];
    return blks.map(x=>({eid:x.dataset.eid, left: x.getBoundingClientRect().left}));
  `));
  const pa = await b.eval(rectOf(`[data-eid="${ids[0].eid}"]`));
  const pb = await b.eval(rectOf(`[data-eid="${ids[1].eid}"]`));
  await b.mouse("mousePressed", pb.x + 20, pb.y + 20);
  await b.sleep(50);
  const stepX = (pa.x - pb.x + 3);
  for (let i = 1; i <= 8; i++) {
    await b.mouse("mouseMoved", pb.x + 20 + (stepX * i) / 8, pb.y + 20 + (40 * i) / 8);
    await b.sleep(30);
  }
  const mid = await b.eval(api(`
    const lines=[...d.querySelectorAll('#__editable_overlay > div')].slice(1, 4);
    return { guides: lines.map(l=>({disp:l.style.display, left:l.style.left, top:l.style.top})) };
  `));
  console.log("拖动中的参考线:", JSON.stringify(mid));
  await b.mouse("mouseReleased", pb.x + 20 + stepX, pb.y + 20 + 40);
  await b.sleep(200);
  const snapped = await b.eval(api(`
    const A=d.querySelector('[data-eid="${ids[0].eid}"]'), B=d.querySelector('[data-eid="${ids[1].eid}"]');
    const ra=A.getBoundingClientRect(), rb=B.getBoundingClientRect();
    return { aLeft: ra.left, bLeft: rb.left, diff: Math.abs(ra.left-rb.left), bFree: B.getAttribute('data-free') };
  `));
  console.log("吸附后:", JSON.stringify(snapped));
  P(snapped.bFree === "1", "B 已进入自由定位");
  P(snapped.diff < 1.5, `B 左边缘与 A 对齐（差 ${snapped.diff.toFixed(2)}px）`);

  /* ── C. 切页重置 dirty ───────────────────────────────── */
  console.log("\n== C. 切换页面 ==");
  const dirty1 = await b.eval(`return { tip: document.getElementById('dirtyTip').textContent, btn: document.getElementById('save').disabled }`);
  await b.eval(`document.getElementById('prev').click();return 1`);
  await b.sleep(700);
  const dirty2 = await b.eval(`return { tip: document.getElementById('dirtyTip').textContent, btn: document.getElementById('save').disabled, cur: document.getElementById('cur').textContent }`);
  console.log("切页前:", JSON.stringify(dirty1), " 切页后:", JSON.stringify(dirty2));
  P(dirty2.tip === "" && dirty2.btn === true, "切页后未保存提示被清空");

  /* ── D. 独立演示外壳 index.html ───────────────────────── */
  console.log("\n== D. 独立演示外壳 index.html ==");
  await b.goto(BASE + "/index.html", 1000);
  const shellOk = await b.eval(`
    return { title: document.title, iframe: document.getElementById('f').getAttribute('src'), nav: document.getElementById('nav').textContent };
  `);
  console.log("外壳:", JSON.stringify(shellOk));
  await b.eval(`document.getElementById('edit').click(); return 1`);
  await b.sleep(1500);
  const shellEdit = await b.eval(`
    const w=document.getElementById('f').contentWindow;
    return { editing: w.document.body.getAttribute('data-editing'), api: !!w.__editableAPI,
             panel: !!w.document.getElementById('__editable_panel'), scale: w.__editableAPI ? w.__editableAPI.debug().scale : null };
  `);
  console.log("外壳编辑态:", JSON.stringify(shellEdit));
  P(shellEdit.editing === "1" && shellEdit.api && shellEdit.panel, "index.html 也能进入编辑模式");
  await b.screenshot(OUT + "12-index-shell.png");

  console.log("\n== 控制台错误 ==");
  console.log(errors.length ? errors.join("\n") : "(无 error)");
} catch (e) {
  console.log("EXCEPTION:", e.message);
} finally {
  clearInterval(pump);
  await b.close();
}
