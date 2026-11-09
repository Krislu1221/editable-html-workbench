/* t22-zoom — 预览态自动适应 + 缩放；编辑态缩放只作用于页面，不影响左右面板 */
import { launch } from "./cdp.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://127.0.0.1:8941";
const OUT = path.dirname(fileURLToPath(import.meta.url)) + path.sep;
const P = (ok, msg) => console.log((ok ? "PASS  " : "FAIL  ") + msg);

const b = await launch({ port: 9347 });
const errors = [];
const pump = setInterval(() => {
  for (const m of b.events.splice(0)) {
    if (m.method === "Runtime.exceptionThrown")
      errors.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
}, 100);

const ui = () => `return {
  pct: document.getElementById('zoomPct').textContent,
  frameW: parseFloat(document.getElementById('frame').style.width)||0,
  frameH: parseFloat(document.getElementById('frame').style.height)||0,
  fx: document.getElementById('f').style.transform,
  sideW: document.querySelector('.side').getBoundingClientRect().width,
  bodyZoom: getComputedStyle(document.body).zoom
}`;

try {
  await b.setViewport(1600, 1000);
  await b.goto(BASE + "/__wb/studio.html", 1400);

  /* 选一个宽页面（1920 的幻灯片）—— 预览态应当自动缩小到可用宽度 */
  await b.eval(`(()=>{const it=[...document.querySelectorAll('#files .item')].find(x=>x.title==='slides/01-cover.html'); if(it) it.click(); return 1})()`);
  await b.sleep(1400);

  console.log("== A. 预览态自动适应 ==");
  const a1 = await b.eval(ui());
  console.log(JSON.stringify(a1));
  const nat = await b.eval(`const d=document.getElementById('f').contentDocument; const de=d.documentElement;
    return { w: de.scrollWidth, h: de.scrollHeight }`);
  console.log("页面原始尺寸:", JSON.stringify(nat));
  P(/^\d+%$/.test(a1.pct), `缩放比例显示为 ${a1.pct}`);
  P(a1.frameW > 0 && Math.abs(a1.frameW - nat.w * (parseInt(a1.pct) / 100)) < 3,
    `画布已等比缩放到 ${a1.frameW}px 宽（原 ${nat.w}px，不再被 1280 裁掉）`);
  /* 演示的幻灯片是流式宽度（width:100%），预览态 100% 即为正确；
     定宽 1920 页面的缩放在 t23-preview 里单独验证。 */

  /* 预览态放大 */
  await b.eval(`document.getElementById('zoomIn').click(); return 1`);
  await b.sleep(300);
  const a2 = await b.eval(ui());
  P(parseInt(a2.pct) > parseInt(a1.pct), `点「+」预览放大：${a1.pct} → ${a2.pct}`);
  await b.eval(`document.getElementById('zoomFit').click(); return 1`);
  await b.sleep(300);
  const a3 = await b.eval(ui());
  P(a3.pct === a1.pct, `点「适应」回到 ${a3.pct}`);

  /* Ctrl+滚轮 */
  await b.send("Input.dispatchMouseEvent", {
    type: "mouseWheel", x: 900, y: 500, deltaX: 0, deltaY: -120,
  });
  await b.sleep(250);
  console.log("（普通滚轮不应缩放）:", (await b.eval(ui())).pct);

  /* 编辑态：缩放只作用于页面 */
  console.log("\n== B. 编辑态缩放 ==");
  await b.eval(`document.getElementById('edit').click(); return 1`);
  await b.sleep(1800);
  const e1 = await b.eval(`
    const w=document.getElementById('f').contentWindow;
    return { dbg: w.__editableAPI.debug(), pct: document.getElementById('zoomPct').textContent,
             sideW: document.querySelector('.side').getBoundingClientRect().width,
             topH: document.querySelector('.top').getBoundingClientRect().height,
             panelW: w.document.getElementById('__editable_panel').getBoundingClientRect().width };
  `);
  console.log("编辑态初始:", JSON.stringify(e1));
  P(e1.sideW === 260, `左侧目录宽度保持 ${e1.sideW}px`);
  P(Math.round(e1.panelW) === 300, `右侧面板宽度保持 ${Math.round(e1.panelW)}px`);

  await b.eval(`document.getElementById('zoomIn').click(); return 1`);
  await b.sleep(400);
  const e2 = await b.eval(`
    const w=document.getElementById('f').contentWindow;
    return { dbg: w.__editableAPI.debug(), pct: document.getElementById('zoomPct').textContent,
             sideW: document.querySelector('.side').getBoundingClientRect().width,
             panelW: w.document.getElementById('__editable_panel').getBoundingClientRect().width,
             slideTransform: w.document.querySelector('.slide').style.transform };
  `);
  console.log("放大后:", JSON.stringify(e2));
  P(e2.dbg.scale > e1.dbg.scale, `页面缩放 ${e1.dbg.scale.toFixed(3)} → ${e2.dbg.scale.toFixed(3)}`);
  P(e2.dbg.userZoom > 1, "编辑器记下了用户倍率");
  P(e2.sideW === 260 && Math.round(e2.panelW) === 300, "左右面板尺寸完全没变（缩放只作用于页面）");
  P(/scale\(/.test(e2.slideTransform || ""), "页面确实被 transform 放大了");

  /* 放大后能滚动到页面下方（margin 补出了滚动区） */
  const scrollable = await b.eval(`
    const w=document.getElementById('f').contentWindow, d=w.document;
    return { bodyH: d.body.scrollHeight, viewH: w.innerHeight };
  `);
  P(scrollable.bodyH > scrollable.viewH, `放大后页面可滚动（内容 ${scrollable.bodyH}px > 视口 ${scrollable.viewH}px）`);

  await b.eval(`document.getElementById('zoomFit').click(); return 1`);
  await b.sleep(400);
  const e3 = await b.eval(`const w=document.getElementById('f').contentWindow; return w.__editableAPI.debug()`);
  P(Math.abs(e3.userZoom - 1) < 0.001, `点「适应」回到 100% 基准（userZoom=${e3.userZoom}）`);

  await b.screenshot(OUT + "30-zoom.png");
  console.log("\n控制台:", errors.length ? errors.join("\n") : "(无 error)");
} catch (e) {
  console.log("EXCEPTION:", e.message);
} finally {
  clearInterval(pump);
  await b.close();
}
