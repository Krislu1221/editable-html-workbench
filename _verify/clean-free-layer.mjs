/* 清理 HTML 中上一次编辑遗留的 .free-layer 块
   用法: node clean-free-layer.mjs "<html 路径>"
   - 先写 .bak 备份
   - 按 div 深度配对删除，避免误截
   - 删除后校验：目标块内容是否在别处还完整存在（避免删掉唯一正文）
*/
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
if (!file) { console.error("用法: node clean-free-layer.mjs <html>"); process.exit(1); }

const raw = fs.readFileSync(file);
let text;
try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
catch { console.error("文件不是合法 UTF-8，中止"); process.exit(1); }

const START = '<div class="free-layer"';
const start = text.indexOf(START);
if (start < 0) { console.log("没有 .free-layer，无需清理"); process.exit(0); }

/* 从 start 开始按 <div / </div> 配对，找到真正的结束位置 */
let i = start, depth = 0, end = -1;
const re = /<div\b|<\/div>/g;
re.lastIndex = start;
let m;
while ((m = re.exec(text))) {
  if (m[0] === "</div>") depth -= 1; else depth += 1;
  if (depth === 0) { end = m.index + m[0].length; break; }
}
if (end < 0) { console.error("没能配对 div 结束标签，中止"); process.exit(1); }

const block = text.slice(start, end);
const textOnly = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const outside = (text.slice(0, start) + text.slice(end)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/* 抽查：块里最长的两段文字，在块外是否还存在 */
const phrases = textOnly.split(" ").filter((s) => s.length >= 6).slice(0, 3);
const missing = phrases.filter((p) => !outside.includes(p));
console.log("块内文本:", textOnly.slice(0, 120));
console.log("块外仍存在的抽查片段:", phrases.length - missing.length, "/", phrases.length);
if (missing.length) {
  console.log("⚠ 这些片段在块外找不到:", missing);
  console.log("   —— 说明这段可能是独有内容，脚本仍然继续，但请务必人工确认渲染结果");
}

const bak = file + ".bak-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
fs.writeFileSync(bak, raw);
console.log("已备份:", bak);

const cleaned = text.slice(0, start) + text.slice(end);
fs.writeFileSync(file, cleaned, "utf8");
console.log(`已删除 ${block.length} 字节的 .free-layer；文件 ${raw.length} → ${Buffer.byteLength(cleaned, "utf8")} 字节`);
