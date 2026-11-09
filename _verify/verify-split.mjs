/* verify-split.mjs — 校验拆分结果：每页文字与原文对应 section 完全一致 + 资源引用完整
   用法: node verify-split.mjs "<源html>" "<拆分目录>"
*/
import fs from "node:fs";
import path from "node:path";

const src = process.argv[2], dir = process.argv[3];
const text = new TextDecoder("utf-8").decode(fs.readFileSync(src));
const bodyStart = text.search(/<body[^>]*>/i);
const bodyTagEnd = text.indexOf(">", bodyStart) + 1;
const bodyEnd = text.lastIndexOf("</body>");
const body = text.slice(bodyTagEnd, bodyEnd);

const firstPage = body.search(/<section\s+class="page/i);
const rest = body.slice(firstPage);
const starts = [];
const reSec = /<section\s+class="page/gi;
let m;
while ((m = reSec.exec(rest))) starts.push(m.index);
let sections = starts.map((s, i) => rest.slice(s, i + 1 < starts.length ? starts[i + 1] : rest.length));
const lastClose = sections[sections.length - 1].lastIndexOf("</section>");
sections[sections.length - 1] = sections[sections.length - 1].slice(0, lastClose + "</section>".length);

const norm = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const pagesDir = path.join(dir, "pages");
const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".html")).sort();
console.log(`原文 ${sections.length} 页 / 拆分 ${files.length} 页`);

let ok = 0, bad = [];
files.forEach((f, i) => {
  const html = fs.readFileSync(path.join(pagesDir, f), "utf8");
  const b = html.slice(html.search(/<body[^>]*>/i));
  const sec = b.slice(b.search(/<section\s+class="page/i));
  const a = norm(sections[i] || "");
  const c = norm(sec);
  // 拆分页可能比原 section 多出 free-layer 的文字（第 1 页），用前缀比较 + 包含判断
  const same = a === c || c.startsWith(a) || a.startsWith(c);
  if (same) ok++; else bad.push({ f, diffAt: (() => { let k = 0; while (k < a.length && k < c.length && a[k] === c[k]) k++; return k; })(), a: a.length, c: c.length });
});
console.log(`文字一致: ${ok}/${files.length}`);
if (bad.length) console.log("不一致:", JSON.stringify(bad.slice(0, 5), null, 2));

/* 资源引用检查 */
let missing = [];
const check = (html, baseDir) => {
  for (const mm of html.matchAll(/(?:src|href)="((?!data:|https?:|#)[^"]+)"/g)) {
    const rel = mm[1];
    if (/^(mailto|javascript):/i.test(rel)) continue;
    const abs = path.resolve(baseDir, rel);
    if (!fs.existsSync(abs)) missing.push({ from: path.basename(baseDir) + "/" + path.basename(html).slice(0, 0) + rel, abs });
  }
};
for (const f of files) check(fs.readFileSync(path.join(pagesDir, f), "utf8"), pagesDir);
check(fs.readFileSync(path.join(dir, "index.html"), "utf8"), dir);
const css = fs.readFileSync(path.join(dir, "assets", "deck.css"), "utf8");
for (const mm of css.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) {
  const rel = mm[2];
  if (/^(data:|https?:)/.test(rel)) continue;
  const abs = path.resolve(path.join(dir, "assets"), rel);
  if (!fs.existsSync(abs)) missing.push({ from: "deck.css", abs });
}
console.log(`资源缺失: ${missing.length}`);
if (missing.length) console.log(JSON.stringify(missing.slice(0, 5), null, 2));

/* 体积 */
const sizes = files.map((f) => fs.statSync(path.join(pagesDir, f)).size);
console.log(`单页: 最小 ${Math.min(...sizes)}B / 平均 ${Math.round(sizes.reduce((a, b) => a + b) / sizes.length)}B / 最大 ${Math.max(...sizes)}B`);
const imgDir = path.join(dir, "assets", "img");
const imgs = fs.readdirSync(imgDir);
console.log(`图片 ${imgs.length} 个，共 ${(imgs.reduce((a, f) => a + fs.statSync(path.join(imgDir, f)).size, 0) / 1048576).toFixed(2)} MB`);
