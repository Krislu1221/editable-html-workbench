/* t21-open-doc — 在编辑器里「打开文档」：切到项目外的任意 HTML，改完写回它自己。
   前置：node scripts/editable-server.mjs --root <包根> --port 8923 */
import { launch } from "./cdp.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8923";
const DOC = process.argv[3] || path.join(os.tmpdir(), "_proj-fake", "about.html");
const P = (ok, msg) => console.log((ok ? "PASS  " : "FAIL  ") + msg);

const original = fs.readFileSync(DOC, "utf8");

const b = await launch({ port: 9343 });
const errors = [];
const pump = setInterval(() => {
  for (const m of b.events.splice(0)) {
    if (m.method === "Runtime.exceptionThrown")
      errors.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
}, 100);

try {
  await b.setViewport(1600, 1000);
  await b.goto(BASE + "/__wb/studio.html", 1200);

  const before = await b.eval(`return { root: document.getElementById('root').textContent,
    items: [...document.querySelectorAll('#files .item .nm')].map(n=>n.textContent) }`);
  console.log("打开前:", JSON.stringify(before));
  P(!/^.+_proj-fake$/.test(before.root), "初始根目录不是目标项目");

  /* 模拟「打开文档…」按钮在选完文件之后做的事：POST /__open 再重载 */
  const opened = await b.eval(`
    return fetch('/__open', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ path: ${JSON.stringify(DOC)} }) }).then(r=>r.json());
  `);
  console.log("POST /__open:", JSON.stringify(opened));
  P(opened.ok && opened.open === "about.html", "服务端切到该文档所在目录并记住文档名");

  await b.goto(BASE + "/__wb/studio.html", 1400);
  const after = await b.eval(`return { root: document.getElementById('root').textContent,
    cur: document.getElementById('cur').textContent,
    items: [...document.querySelectorAll('#files .item .nm')].map(n=>n.textContent) }`);
  console.log("打开后:", JSON.stringify(after));
  P(/_proj-fake$/i.test(after.root), "工作台根目录已切到该文档所在目录");
  P(after.cur === "about.html", "自动选中了刚打开的文档");
  P(after.items.length === 2, "左侧栏列出该目录的页面");

  /* 编辑并保存 */
  await b.eval(`document.getElementById('edit').click(); return 1`);
  await b.sleep(1600);
  const dbg = await b.eval(`const w=document.getElementById('f').contentWindow; return w.__editableAPI.debug()`);
  P(dbg.editing && dbg.handles === 8, "编辑器在该文档上就绪");

  const changed = await b.eval(`
    const w=document.getElementById('f').contentWindow, d=w.document;
    const el=d.querySelector('.wrap h2');
    w.__editableAPI.select(el);
    const inp=d.querySelector('#ed_text'); inp.value='从编辑器打开的文档';
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    return el.textContent.trim();
  `);
  P(changed === "从编辑器打开的文档", `已改标题 = "${changed}"`);

  await b.eval(`const w=document.getElementById('f').contentWindow; return w.__editableAPI.save().then(()=>'ok')`);
  await b.sleep(600);
  const saved = fs.readFileSync(DOC, "utf8");
  P(saved.includes("从编辑器打开的文档"), "改动写回了项目外的这个文件");
  const bad = [/data-eid/, /data-ed-inject/, /__editable/, /data-ed-anchor/].filter((re) => re.test(saved));
  P(bad.length === 0, "写回的文件干净（无编辑器痕迹）");

  const rev = await (await fetch(BASE + "/__revert", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "about.html" }),
  })).json();
  P(rev.ok && fs.readFileSync(DOC, "utf8") === original, "回退后与原文件逐字节一致");

  console.log("\n控制台:", errors.length ? errors.join("\n") : "无 error");
} catch (e) {
  console.log("EXCEPTION:", e.message);
} finally {
  clearInterval(pump);
  try { if (fs.readFileSync(DOC, "utf8") !== original) fs.writeFileSync(DOC, original, "utf8"); } catch (e) {}
  await b.close();
}
