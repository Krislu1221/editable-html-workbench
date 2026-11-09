/* 端到端验证：工作台指向一个「完全无关」的项目目录（没有 .slide、没有 editable.js、
   没有 tokens.css），应当也能直接打开、编辑、写回原文件且不留痕迹。 */
import { launch } from "./cdp.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8911";
const PROJ = process.argv[3] || path.join(os.tmpdir(), "_proj-fake");
const P = (ok, msg) => console.log((ok ? "PASS  " : "FAIL  ") + msg);

const INDEX = path.join(PROJ, "index.html");
const original = fs.readFileSync(INDEX, "utf8");

const b = await launch({ port: 9341 });
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

try {
  await b.setViewport(1600, 1000);
  await b.goto(`${BASE}/__wb/studio.html`, 1400);

  const list = await b.eval(`return { root: document.getElementById('root').textContent,
    items: [...document.querySelectorAll('#files .item .nm')].map(n=>n.textContent) }`);
  console.log("文件列表:", JSON.stringify(list));
  P(list.items.length === 2, "左侧栏列出该项目的 2 个页面");
  P(/[\\/]_proj-fake$/i.test(list.root), "工作台显示的项目根目录正确");
  P(list.items[0] === "index.html", "首页排在列表第一位");

  // 明确切到 index.html 再进入编辑（列表按路径排序，不能假设顺序）
  await b.eval(`
    const items=[...document.querySelectorAll('#files .item')];
    const i=items.findIndex(x=>x.title==='index.html');
    if(i>=0) items[i].click();
    return i;
  `);
  await b.sleep(800);

  await b.eval(`document.getElementById('edit').click();return 1`);
  await b.sleep(1600);

  const dbg = await b.eval(api(`return w.__editableAPI.debug()`));
  console.log("编辑器状态:", JSON.stringify(dbg));
  P(dbg.editing && dbg.handles === 8, "编辑器在这个无关项目里也正常初始化");

  const anchor = await b.eval(api(`
    const a=d.querySelector('[data-ed-anchor]');
    return { tag: a ? a.tagName : null, cls: a ? a.className : null,
             pos: a ? getComputedStyle(a).position : null,
             hasSlide: !!d.querySelector('.slide') };
  `));
  console.log("画布锚点:", JSON.stringify(anchor));
  P(anchor.hasSlide === false, "该项目没有 .slide（确实是普通页面）");
  P(anchor.cls === "wrap" && anchor.pos === "relative", "回退锚点 = .wrap，且临时加了定位上下文");

  /* 拖动第一张卡片 */
  const g = await b.eval(api(`
    const f=document.getElementById('f'), fr=f.getBoundingClientRect();
    const el=d.querySelector('.card'); const r=el.getBoundingClientRect();
    const a=d.querySelector('[data-ed-anchor]');
    return { cx: fr.left+r.left+r.width/2, cy: fr.top+r.top+30,
             k: a.getBoundingClientRect().width / a.offsetWidth,
             before: r.left, eid: el.dataset.eid };
  `));
  await b.drag(g.cx, g.cy, g.cx + 100, g.cy + 60, 12);
  const after = await b.eval(api(`
    const el=d.querySelector('[data-eid="${g.eid}"]');
    const r=el.getBoundingClientRect();
    return { left: r.left, free: el.getAttribute('data-free'), parent: el.parentElement.className,
             w: el.style.width, h: el.style.height };
  `));
  const gotX = (after.left - g.before) / g.k, expX = 100 / g.k;
  console.log(`拖动: 屏幕 100 → 逻辑 ${gotX.toFixed(1)}（期望 ${expX.toFixed(1)}, k=${g.k.toFixed(4)}）`);
  P(after.free === "1" && /free-layer/.test(after.parent), "卡片拖动后进入自由定位层");
  P(Math.abs(gotX - expX) <= 7, "位移换算正确");
  P(!!after.w && !!after.h, "拖动锁定了宽高");

  /* 改字 */
  const t = await b.eval(api(`
    const el=d.querySelector('.card h3');
    w.__editableAPI.select(el);
    const inp=d.querySelector('#ed_text'); inp.value='改过的标题';
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    return el.textContent.trim();
  `));
  P(t === "改过的标题", `面板改字生效 = "${t}"`);

  /* 保存 */
  await b.eval(api(`return w.__editableAPI.save().then(()=>'ok')`));
  await b.sleep(600);
  const saved = fs.readFileSync(INDEX, "utf8");
  console.log(`文件 ${original.length} → ${saved.length} bytes`);
  const bad = [
    ["注入的编辑器脚本", /data-ed-inject/],
    ["运行时 meta", /__EDIT_FILE__/],
    ["data-eid", /data-eid/],
    ["data-ed-anchor", /data-ed-anchor/],
    ["data-ed-layer 标记", /\sdata-ed-layer/],
    ["data-sel", /data-sel/],
    ["编辑器 UI", /__editable/],
    ["contenteditable", /contenteditable/i],
    ["编辑期 scale transform", /transform:\s*scale\(/],
  ].filter(([, re]) => re.test(saved));
  P(bad.length === 0, "写回的文件干净（无编辑器痕迹）" + (bad.length ? " 命中: " + bad.map((x) => x[0]).join(", ") : ""));
  P(saved.includes("改过的标题"), "改动确实写进了原文件");
  P(/\.card\s*\{[^}]*position/.test(saved) === false, "没有给卡片偷偷加定位样式");
  P(/\.wrap\s*\{[^}]*position:\s*relative/.test(saved) === false, "锚点临时加的 position:relative 已清除");

  /* 回退 */
  const rev = await (await fetch(BASE + "/__revert", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "index.html" }),
  })).json();
  P(rev.ok && fs.readFileSync(INDEX, "utf8") === original, "回退后与原文件逐字节一致");

  /* 翻页 */
  await b.eval(`document.getElementById('next').click(); return 1`);
  await b.sleep(900);
  const page2 = await b.eval(`return { cur: document.getElementById('cur').textContent,
    ce: !!document.getElementById('f').contentDocument.querySelector('[data-ed-anchor]') }`);
  P(page2.cur === "about.html" && page2.ce, "翻到第二页且编辑器仍生效");

  console.log("\n控制台:", errors.length ? errors.join("\n") : "无 error");
} catch (e) {
  console.log("EXCEPTION:", e.message);
} finally {
  clearInterval(pump);
  try { if (fs.readFileSync(INDEX, "utf8") !== original) fs.writeFileSync(INDEX, original, "utf8"); } catch (e) {}
  await b.close();
}
