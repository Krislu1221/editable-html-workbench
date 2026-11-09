/* t23-preview — 预览态：定宽 1920 页面必须等比缩小、完整可见，且可缩放 */
import { launch } from "./cdp.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://127.0.0.1:8942";
const OUT = path.dirname(fileURLToPath(import.meta.url)) + path.sep;
const P = (ok, msg) => console.log((ok ? "PASS  " : "FAIL  ") + msg);

const b = await launch({ port: 9349 });
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
  iframeW: parseFloat(document.getElementById('f').style.width)||0,
  iframeH: parseFloat(document.getElementById('f').style.height)||0,
  transform: document.getElementById('f').style.transform,
  stageW: document.getElementById('stage').clientWidth,
  stageH: document.getElementById('stage').clientHeight,
  sideW: document.querySelector('.side').getBoundingClientRect().width
}`;

try {
  await b.setViewport(1600, 1000);
  await b.goto(BASE + "/__wb/studio.html", 1300);
  await b.eval(`(()=>{const it=[...document.querySelectorAll('#files .item')].find(x=>x.title==='fixed-1920.html'); if(it) it.click(); return 1})()`);
  await b.sleep(1500);

  console.log("== A. 定宽页面自动适应 ==");
  const a1 = await b.eval(ui());
  console.log(JSON.stringify(a1));
  P(a1.iframeW === 1920 && a1.iframeH === 1080, `量到页面真实尺寸 ${a1.iframeW}×${a1.iframeH}`);
  P(parseInt(a1.pct) < 100, `自动缩小到 ${a1.pct}（原来写死 1280 宽，1920 页面会被裁）`);
  P(a1.frameW <= a1.stageW, `画布宽度 ${a1.frameW} ≤ 可用宽度 ${a1.stageW}（完整可见）`);
  P(a1.frameH <= a1.stageH, `画布高度 ${a1.frameH} ≤ 可用高度 ${a1.stageH}（不压到下面）`);
  P(a1.sideW === 260, "左侧目录仍是 260px（预览缩放不影响面板）");

  console.log("\n== B. 预览态缩放 ==");
  await b.eval(`document.getElementById('zoomIn').click(); return 1`);
  await b.sleep(300);
  const a2 = await b.eval(ui());
  P(parseInt(a2.pct) > parseInt(a1.pct), `点「+」放大：${a1.pct} → ${a2.pct}`);
  P(a2.sideW === 260, "放大后左侧目录依旧 260px");

  await b.eval(`document.getElementById('zoomOut').click(); document.getElementById('zoomOut').click(); return 1`);
  await b.sleep(300);
  const a3 = await b.eval(ui());
  P(parseInt(a3.pct) < parseInt(a1.pct), `点「−」缩小：${a1.pct} → ${a3.pct}`);

  await b.eval(`document.getElementById('zoomFit').click(); return 1`);
  await b.sleep(300);
  const a4 = await b.eval(ui());
  P(a4.pct === a1.pct, `点「适应」回到 ${a4.pct}`);

  console.log("\n== C. Ctrl+滚轮 ==");
  await b.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 800, y: 500, deltaX: 0, deltaY: -240, modifiers: 2 });
  await b.sleep(300);
  const a5 = await b.eval(ui());
  P(parseInt(a5.pct) > parseInt(a1.pct), `Ctrl+滚轮放大：${a1.pct} → ${a5.pct}`);
  P(a5.sideW === 260, "Ctrl+滚轮也没把整页 UI 放大");
  await b.eval(`document.getElementById('zoomFit').click(); return 1`);

  console.log("\n== D. 切到流式页面仍然正常 ==");
  await b.eval(`(()=>{const it=[...document.querySelectorAll('#files .item')].find(x=>x.title==='index.html'); if(it) it.click(); return 1})()`);
  await b.sleep(1300);
  const d1 = await b.eval(ui());
  console.log(JSON.stringify(d1));
  P(d1.iframeW >= 800, `流式页面按可用宽度排版（${d1.iframeW}px），没有被量成 300`);
  P(d1.frameW <= d1.stageW, "流式页面也没有横向溢出");

  await b.screenshot(OUT + "31-preview.png");
  console.log("\n控制台:", errors.length ? errors.join("\n") : "(无 error)");
} catch (e) {
  console.log("EXCEPTION:", e.message);
} finally {
  clearInterval(pump);
  await b.close();
}
