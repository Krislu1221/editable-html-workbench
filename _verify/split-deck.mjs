/* split-deck.mjs — 把「单文件多页 HTML」拆成一页一文件
   用法: node split-deck.mjs "<源 html>" "<输出目录>"
   做三件事：
     1. 公共 CSS 抽到 assets/deck.css
     2. base64 图片落地成 assets/img/*（按内容去重）
     3. 每个 <section class="page"> 生成 pages/NN.html（共享 sprite / css / 图片）
   原则：只搬不改——除图片改成外链、样式改成外链，页面标记原样保留。
*/
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const src = process.argv[2];
const outDir = process.argv[3];
if (!src || !outDir) { console.error("用法: node split-deck.mjs <源html> <输出目录>"); process.exit(1); }

const raw = fs.readFileSync(src);
let text;
try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
catch { console.error("源文件不是合法 UTF-8"); process.exit(1); }

const log = (...a) => console.log(...a);
const sha = (buf) => crypto.createHash("sha1").update(buf).digest("hex").slice(0, 10);

/* ── 1. 切出 head / body ───────────────────────────────── */
const bodyStart = text.search(/<body[^>]*>/i);
if (bodyStart < 0) { console.error("找不到 <body>"); process.exit(1); }
const bodyTagEnd = text.indexOf(">", bodyStart) + 1;
const bodyOpen = text.slice(bodyStart, bodyTagEnd);
const bodyEnd = text.lastIndexOf("</body>");
const head = text.slice(0, bodyStart);

/* ── 2. head 里的公共 CSS → assets/deck.css ─────────────── */
const headStyles = [...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
const sharedCss = headStyles.join("\n\n");
let headClean = head.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
log(`公共 CSS: ${headStyles.length} 块, ${sharedCss.length} 字符`);

/* ── 3. 图片：base64 → 文件（按内容去重） ───────────────── */
const imgDir = path.join(outDir, "assets", "img");
fs.mkdirSync(imgDir, { recursive: true });
const imgMap = new Map();          // dataURI -> 相对路径
const written = [];
function materialize(html) {
  return html.replace(/data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)/g, (whole, mime, b64) => {
    const key = mime + ":" + sha(Buffer.from(b64, "base64"));
    if (imgMap.has(key)) return imgMap.get(key);
    const ext = mime === "jpeg" || mime === "jpg" ? "jpg" : "png";
    const name = `img-${sha(Buffer.from(b64, "base64"))}.${ext}`;
    const abs = path.join(imgDir, name);
    if (!fs.existsSync(abs)) {
      fs.writeFileSync(abs, Buffer.from(b64, "base64"));
      written.push({ name, bytes: fs.statSync(abs).size });
    }
    const rel = `../assets/img/${name}`;
    imgMap.set(key, rel);
    return rel;
  });
}

/* ── 4. body 里切出 sprite / free-layer / 各页 ───────────── */
let body = text.slice(bodyTagEnd, bodyEnd);

const firstPage = body.search(/<section\s+class="page/i);
if (firstPage < 0) { console.error("body 里没有 <section class=\"page\">"); process.exit(1); }
let pre = body.slice(0, firstPage);       // svg sprite + （可能）free-layer
const rest = body.slice(firstPage);

/* free-layer 单独拿出来：它属于第 1 页 */
let freeLayer = "";
const flStart = pre.indexOf('<div class="free-layer"');
if (flStart >= 0) {
  let depth = 0, end = -1;
  const re = /<div\b|<\/div>/g; re.lastIndex = flStart;
  let m;
  while ((m = re.exec(pre))) { depth += m[0] === "</div>" ? -1 : 1; if (depth === 0) { end = m.index + m[0].length; break; } }
  if (end > 0) { freeLayer = pre.slice(flStart, end); pre = pre.slice(0, flStart) + pre.slice(end); }
}
const sprite = pre.trim();
log(`sprite: ${sprite.length} 字符; free-layer: ${freeLayer.length} 字符`);

/* 按 <section class="page 切页 */
const starts = [];
const reSec = /<section\s+class="page/gi;
let mm;
while ((mm = reSec.exec(rest))) starts.push(mm.index);
const pages = starts.map((s, i) => rest.slice(s, i + 1 < starts.length ? starts[i + 1] : rest.length));

/* 去掉每页尾部夹带的（不属于任何页的）收尾内容 */
const tailMarker = pages[pages.length - 1];
const tailClose = tailMarker.lastIndexOf("</section>");
if (tailClose >= 0) pages[pages.length - 1] = tailMarker.slice(0, tailClose + "</section>".length);

log(`切出 ${pages.length} 页`);

/* ── 5. 写出 ───────────────────────────────────────────── */
const pagesDir = path.join(outDir, "pages");
fs.mkdirSync(pagesDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "assets", "deck.css"), materialize(sharedCss), "utf8");

const meta = headClean.match(/<meta[^>]*charset[^>]*>/i);
const charset = meta ? meta[0] : '<meta charset="utf-8">';

const titles = [];
pages.forEach((sec, i) => {
  const n = String(i + 1).padStart(2, "0");
  const idMatch = sec.match(/<section[^>]*\bid="([^"]+)"/i);
  let title = "";
  const h = sec.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  if (h) title = h[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!title) title = idMatch ? idMatch[1] : `第 ${i + 1} 页`;
  titles.push(title);

  const extra = i === 0 && freeLayer ? "\n" + freeLayer : "";
  const html =
    `<!DOCTYPE html>\n<html lang="zh-CN"><head>\n${charset}\n` +
    `<meta name="viewport" content="width=1920">\n` +
    `<title>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title>\n` +
    `<link rel="stylesheet" href="../assets/deck.css">\n` +
    `</head>\n<body${bodyOpen.slice(5).replace(/^body/i, "")}>\n` +
    sprite + `\n` + materialize(sec) + extra + `\n</body></html>\n`;
  fs.writeFileSync(path.join(pagesDir, `${n}.html`), html, "utf8");
});

/* ── 6. 索引页 ─────────────────────────────────────────── */
const idx = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Deck Preview</title>
<style>
  html,body{margin:0;height:100%;background:#e7ebe8;font-family:"Microsoft YaHei","PingFang SC",sans-serif}
  .bar{display:flex;align-items:center;gap:10px;padding:10px 16px;background:#fff;border-bottom:1px solid #dde3de}
  .bar b{font-size:15px} .bar .sp{flex:1}
  .bar button{font:inherit;font-size:12px;font-weight:700;cursor:pointer;border:1px solid #dde3de;
    background:#fff;padding:6px 12px;border-radius:5px}
  .stage{padding:16px;display:grid;place-items:center;height:calc(100vh - 54px);overflow:auto}
  iframe{width:min(100%,1600px);height:100%;border:0;background:#fff;box-shadow:0 10px 34px rgba(0,0,0,.12)}
  .nav{padding:6px 16px;font-size:12px;color:#6d7b73}
</style></head><body>
<div class="bar"><b>Deck Preview</b>
  <span class="nav" id="nav">1 / ${pages.length}</span><span class="sp"></span>
  <button id="prev">←</button><button id="next">→</button>
  <button id="open">在新标签打开</button></div>
<div class="stage"><iframe id="f" src="pages/01.html"></iframe></div>
<script>
var n=${pages.length}, i=0, f=document.getElementById('f');
function render(){ f.src='pages/'+String(i+1).padStart(2,'0')+'.html'; document.getElementById('nav').textContent=(i+1)+' / '+n; }
document.getElementById('prev').onclick=function(){ i=(i-1+n)%n; render(); };
document.getElementById('next').onclick=function(){ i=(i+1)%n; render(); };
document.getElementById('open').onclick=function(){ window.open(f.src,'_blank'); };
document.addEventListener('keydown',function(e){ if(e.key==='ArrowRight')document.getElementById('next').click(); if(e.key==='ArrowLeft')document.getElementById('prev').click(); });
</script></body></html>
`;
fs.writeFileSync(path.join(outDir, "index.html"), idx, "utf8");

/* ── 7. 报告 ───────────────────────────────────────────── */
const totalImg = written.reduce((a, b) => a + b.bytes, 0);
const pageSizes = fs.readdirSync(pagesDir).map((f) => fs.statSync(path.join(pagesDir, f)).size);
log("\n=== 完成 ===");
log(`输出目录: ${outDir}`);
log(`页面: ${pages.length} 个，单页最大 ${Math.max(...pageSizes)} 字节，平均 ${Math.round(pageSizes.reduce((a, b) => a + b) / pages.length)}`);
log(`图片: ${written.length} 个独立文件（去重后），共 ${(totalImg / 1024).toFixed(0)} KB`);
log(`公共 CSS: ${(sharedCss.length / 1024).toFixed(0)} KB`);
log(`标题: ${titles.slice(0, 6).join(" | ")} …`);
