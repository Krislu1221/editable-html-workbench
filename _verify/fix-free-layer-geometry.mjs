/* 修复 .free-layer 里被撑出画布的元素宽度
   用法: node fix-free-layer-geometry.mjs "<html 路径>" [画布宽 1920]
   只改自由层里 inline 定位元素的 width，让 left+width 不超出画布；
   元素位置（left/top）与内容一律不动。先写 .bak 备份。
*/
import fs from "node:fs";

const file = process.argv[2];
const CANVAS_W = parseInt(process.argv[3] || "1920", 10);
if (!file) { console.error("用法: node fix-free-layer-geometry.mjs <html> [画布宽]"); process.exit(1); }

const raw = fs.readFileSync(file);
let text;
try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
catch { console.error("文件不是合法 UTF-8，中止"); process.exit(1); }

const START = '<div class="free-layer"';
const start = text.indexOf(START);
if (start < 0) { console.log("没有 .free-layer，无需处理"); process.exit(0); }

let i = start, depth = 0, end = -1;
const re = /<div\b|<\/div>/g;
re.lastIndex = start;
let m;
while ((m = re.exec(text))) {
  depth += m[0] === "</div>" ? -1 : 1;
  if (depth === 0) { end = m.index + m[0].length; break; }
}
if (end < 0) { console.error("配对失败，中止"); process.exit(1); }

const block = text.slice(start, end);
const changes = [];

const fixed = block.replace(/style="([^"]*)"/g, (whole, style) => {
  if (!/position\s*:\s*absolute/i.test(style)) return whole;
  const left = parseFloat((style.match(/left\s*:\s*(-?[\d.]+)px/i) || [])[1] || "0");
  const w = parseFloat((style.match(/width\s*:\s*([\d.]+)px/i) || [])[1] || "0");
  if (!(w > 0)) return whole;
  const limit = Math.max(200, CANVAS_W - Math.max(0, left) - 8);
  if (w <= limit) return whole;
  const nw = Math.round(limit * 100) / 100;
  changes.push({ left: Math.round(left), from: Math.round(w), to: nw });
  return `style="${style.replace(/width\s*:\s*[\d.]+px/i, "width: " + nw + "px")}"`;
});

if (!changes.length) { console.log("自由层里没有超出画布的宽度，无需修改"); process.exit(0); }

console.log("将要收窄的元素:", JSON.stringify(changes, null, 2));

const bak = file + ".bak-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
fs.writeFileSync(bak, raw);
console.log("已备份:", bak);

const out = text.slice(0, start) + fixed + text.slice(end);
fs.writeFileSync(file, out, "utf8");
console.log(`写入完成：${raw.length} → ${Buffer.byteLength(out, "utf8")} 字节`);
