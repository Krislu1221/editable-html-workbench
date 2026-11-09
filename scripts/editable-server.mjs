#!/usr/bin/env node
/**
 * editable-server.mjs — Editable HTML 模式的本地工作台服务（v5 通用版）
 *
 * 用法：
 *   node editable-server.mjs --root <项目目录> [--port 8899] [--host 127.0.0.1]
 *
 * 与 v4 的关键区别：**项目零侵入**
 *   · 工作台自己的 UI / 编辑器脚本从「包目录」按 /__wb/ 前缀提供，
 *     所以 --root 指向任意项目都能用，项目里不需要放 studio.html / editable.js。
 *   · 只有带 ?edit=1 的页面才会注入编辑器脚本（HTTP 注入，不写进文件）；
 *     若项目页面自己已经引了 editable.js 则不重复注入。
 *   · 保存时序列化会剥掉注入的 script[data-ed-inject]，交付文件保持干净。
 *
 * 作用：
 *   1. 静态服务 --root 指向的项目目录
 *   2. /__wb/*  —— 服务本工作台自身的 UI 与编辑器（studio.html / assets/*），只读
 *   3. GET  /__list  —— 项目内文件树（工作台左侧栏）
 *   4. POST /__save  —— 把编辑器序列化结果写回**原文件**
 *   5. POST /__revert —— 回退到上一版（内存备份，不落 .bak）
 *   6. GET  /__ping  —— 健康检查
 *
 * 安全约束：
 *   · 所有读写路径必须在 --root 之内（防目录穿越）；/__wb/ 只能访问包内文件
 *   · 只监听回环地址
 */

import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

/* ── 参数 ─────────────────────────────────────────────── */
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");   // 工作台自身的包目录

/* 工作台 UI 根（/__wb/ 从这取）——兼容两种包布局：
   ① 独立包：<pkg>/studio.html + <pkg>/assets/editable.js
   ② skill 内嵌：<pkg>/assets/editable-kit/studio.html 及同目录 editable.js */
const UI_ROOT = (() => {
  const candidates = [PACKAGE_ROOT, path.join(PACKAGE_ROOT, "assets", "editable-kit")];
  for (const c of candidates) {
    try { if (fsSync.statSync(path.join(c, "studio.html")).isFile()) return c; } catch { /* next */ }
  }
  return PACKAGE_ROOT;
})();
const UI_IS_KIT = path.basename(UI_ROOT) === "editable-kit";

/* 被编辑的项目目录 + 当前「打开中的文档」
   — --root 传目录：整个目录都能浏览
   — --root 传 .html 文件：根切到它所在目录，并默认打开它
   — 运行中也可以用 POST /__open 切到任意位置的文档 */
let OPEN_FILE = null;
let ROOT = path.resolve(arg("--root", PACKAGE_ROOT));
try {
  const st = fsSync.statSync(ROOT);
  if (st.isFile()) {
    OPEN_FILE = path.basename(ROOT);
    ROOT = path.dirname(ROOT);
  }
} catch {
  // 不存在时留给启动检查报错
}
const PORT = parseInt(arg("--port", "8899"), 10);
const HOST = arg("--host", "127.0.0.1");

/* 内存备份：path -> 上一次保存前的内容（用于 /__revert） */
const backup = new Map();

/* 文件对话框同一时刻只允许一个（连点会堆出一串看不见的窗口） */
let pickPending = false;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ico": "image/x-icon",
};

/* ── 路径守卫 ─────────────────────────────────────────── */
function safeIn(base, rel) {
  const p = path.resolve(base, "." + path.sep + (rel || "").replace(/^[/\\]+/, ""));
  if (p !== base && !p.startsWith(base + path.sep)) return null;
  return p;
}
function safePath(rel) { return safeIn(ROOT, rel); }
/* /__wb/ 路径解析：kit 布局下允许省略最优的 assets/ 前缀（/__wb/assets/editable.js → <kit>/editable.js），
   且必须真存在，避免 404 落到错误目录 */
function packagePath(rel) {
  const tries = [rel];
  if (UI_IS_KIT && /^assets\//.test(rel)) tries.push(rel.replace(/^assets\//, ""));
  for (const t of tries) {
    const abs = safeIn(UI_ROOT, t);
    if (!abs) continue;
    try { if (fsSync.statSync(abs).isFile()) return abs; } catch { /* next */ }
  }
  return null;
}
function relOf(abs) { return path.relative(ROOT, abs).split(path.sep).join("/"); }

/* ── 注入 ─────────────────────────────────────────────── */

/* 告诉页面它自己在编辑哪个文件 */
const INJECT_META = (rel) =>
  `<script>window.__EDIT_FILE__=${JSON.stringify(rel)};` +
  `window.__EDIT_SAVE__="/__save";window.__EDIT_LIST__="/__list";</script>`;

/* 项目页面没自带编辑器时，从包目录注入（HTTP 注入，不落盘） */
const INJECT_EDITOR = `<script src="/__wb/assets/editable.js" data-ed-inject="1"></script>`;

async function serveHTML(res, abs, rel, wantEditor) {
  let html = await fs.readFile(abs, "utf8");
  const hasOwnEditor = /editable(?:\.min)?\.js/i.test(html);
  let tag = INJECT_META(rel);
  if (wantEditor && !hasOwnEditor) tag += "\n" + INJECT_EDITOR;

  if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, tag + "\n</head>");
  else if (/<body[^>]*>/i.test(html)) html = html.replace(/(<body[^>]*>)/i, "$1\n" + tag);
  else html = tag + "\n" + html;

  res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
  res.end(html);
}

/* ── 文件树 ───────────────────────────────────────────── */
async function walk(dir, out = []) {
  let items = [];
  try { items = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    if (it.name.startsWith(".")) continue;
    if (it.name === "node_modules") continue;
    const abs = path.join(dir, it.name);
    if (it.isDirectory()) await walk(abs, out);
    else out.push(relOf(abs));
  }
  return out;
}

/* ── 工具 ─────────────────────────────────────────────── */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => {
      d += c;
      if (d.length > 64 * 1024 * 1024) { reject(new Error("body too large")); req.destroy(); }
    });
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
}

/* ── 原生「打开文档」对话框（只在用户亲手点的时候弹） ── */
function capture(cmd, args, timeout = 180000) {
  return new Promise((resolve) => {
    let out = "", err = "";
    let child;
    try { child = spawn(cmd, args, { windowsHide: false }); }
    catch (e) { return resolve({ code: -1, out: "", err: String(e.message || e) }); }
    const t = setTimeout(() => { try { child.kill(); } catch {} resolve({ code: -2, out, err: "timeout" }); }, timeout);
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.stderr.on("data", (d) => (err += d.toString("utf8")));
    child.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e.message || e) }); });
    child.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

async function pickFile() {
  const p = process.platform;
  if (p === "win32") {
    const ps1 = path.join(__dirname, "pick-file.ps1");
    if (!fsSync.existsSync(ps1)) return { error: "缺少 scripts/pick-file.ps1" };
    /* 路径走「临时文件」而不是 stdout：
       Windows PowerShell 5.1 的重定向 stdout 默认是 OEM 代码页（936），
       中文路径按 UTF-8 解会变乱码。写临时文件可完全绕开编码问题。
       -InitialDir 传当前项目目录：对话框直接从这儿开始，省去翻目录的时间。 */
    const outFile = path.join(os.tmpdir(), "edwb-pick-" + crypto.randomUUID() + ".txt");
    const r = await capture("powershell", [
      "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", ps1,
      "-OutFile", outFile, "-InitialDir", ROOT,
    ]);
    let s = "";
    try { s = (await fs.readFile(outFile, "utf8")).trim(); } catch {}
    try { await fs.unlink(outFile); } catch {}
    if (s) return { path: s };
    return { canceled: true, stderr: (r.err || "").slice(0, 300) };
  }
  if (p === "darwin") {
    const r = await capture("osascript", ["-e", 'POSIX path of (choose file with prompt "打开要编辑的 HTML 文档")']);
    const s = (r.out || "").trim();
    if (r.code === 0 && s) return { path: s };
    return { canceled: true };
  }
  const r = await capture("zenity", ["--file-selection", "--title=打开要编辑的 HTML 文档"]);
  const s = (r.out || "").trim();
  if (r.code === 0 && s) return { path: s };
  return { canceled: true, stderr: (r.err || "").slice(0, 300) };
}

/* ── 主服务 ───────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(u.pathname);

  try {
    /* 健康检查 */
    if (pathname === "/__ping") {
      return json(res, 200, { ok: true, root: ROOT, package: PACKAGE_ROOT, open: OPEN_FILE, pid: process.pid });
    }

    /* 项目文件树 */
    if (pathname === "/__list") {
      const files = await walk(ROOT);
      files.sort();
      return json(res, 200, { root: ROOT, open: OPEN_FILE, files });
    }

    /* 弹原生对话框选一个文档（用户亲手选，服务端只负责把路径告诉页面）
       —— 同一时刻只允许一个对话框，避免连点堆出一串看不见的窗口 */
    if (pathname === "/__pick") {
      if (pickPending) {
        return json(res, 200, { ok: false, busy: true, error: "已经有一个文件对话框开着，请先处理它" });
      }
      pickPending = true;
      let r;
      try { r = await pickFile(); } finally { pickPending = false; }
      if (r.path) return json(res, 200, { ok: true, path: r.path });
      return json(res, 200, { ok: false, canceled: true, error: r.error || r.stderr || "cancelled" });
    }

    /* 打开一个文档：把工作根切到它所在目录（相对 CSS/JS 才能正常加载） */
    if (pathname === "/__open" && req.method === "POST") {
      const raw = await readBody(req);
      let payload;
      try { payload = JSON.parse(raw); } catch { return json(res, 400, { ok: false, error: "bad json" }); }
      const target = String(payload.path || "").trim();
      if (!target) return json(res, 400, { ok: false, error: "no path" });
      const abs = path.resolve(target);
      let st = null;
      try { st = await fs.stat(abs); } catch {}
      if (!st) return json(res, 404, { ok: false, error: "not found: " + abs });
      if (st.isDirectory()) {
        ROOT = abs;
        OPEN_FILE = null;
      } else {
        ROOT = path.dirname(abs);
        OPEN_FILE = path.basename(abs);
      }
      return json(res, 200, { ok: true, root: ROOT, open: OPEN_FILE });
    }

    /* 保存：写回原文件 */
    if (pathname === "/__save" && req.method === "POST") {
      const raw = await readBody(req);
      let payload;
      try { payload = JSON.parse(raw); } catch { return json(res, 400, { ok: false, error: "bad json" }); }
      const rel = String(payload.path || "").replace(/^\/+/, "");
      const abs = safePath(rel);
      if (!abs) return json(res, 403, { ok: false, error: "path outside root" });
      if (typeof payload.content !== "string") return json(res, 400, { ok: false, error: "no content" });

      let prev = null;
      try { prev = await fs.readFile(abs, "utf8"); } catch {}
      if (prev !== null) backup.set(rel, prev);

      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, payload.content, "utf8");
      const st = await fs.stat(abs);
      return json(res, 200, {
        ok: true, path: rel, bytes: st.size,
        mtime: st.mtime.toISOString(),
        hash: crypto.createHash("sha1").update(payload.content).digest("hex").slice(0, 12),
      });
    }

    /* 回退到上一版（内存备份，不落 .bak） */
    if (pathname === "/__revert" && req.method === "POST") {
      const raw = await readBody(req);
      const { path: p } = JSON.parse(raw || "{}");
      const rel = String(p || "").replace(/^\/+/, "");
      if (!backup.has(rel)) return json(res, 404, { ok: false, error: "no backup" });
      const abs = safePath(rel);
      if (!abs) return json(res, 403, { ok: false, error: "path outside root" });
      await fs.writeFile(abs, backup.get(rel), "utf8");
      return json(res, 200, { ok: true, path: rel });
    }

    /* 工作台自身 UI / 编辑器：只读，永远从包目录取 */
    if (pathname === "/__wb" || pathname.startsWith("/__wb/")) {
      let rel = pathname.replace(/^\/__wb\/?/, "");
      if (!rel) rel = "studio.html";
      const abs = packagePath(rel);
      if (!abs) { res.writeHead(403); return res.end("forbidden"); }
      try {
        await fs.stat(abs);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("404 __wb/" + rel);
      }
      const ext = path.extname(abs).toLowerCase();
      if (ext === ".html") {
        // 工作台外壳本身不注入 meta / 编辑器
        const html = await fs.readFile(abs, "utf8");
        res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
        return res.end(html);
      }
      const buf = await fs.readFile(abs);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
      return res.end(buf);
    }

    /* 静态文件（项目目录） */
    let rel = pathname === "/" ? "/index.html" : pathname;
    let abs = safePath(rel);
    if (!abs) { res.writeHead(403); return res.end("forbidden"); }
    try {
      const st = await fs.stat(abs);
      if (st.isDirectory()) { abs = path.join(abs, "index.html"); rel = relOf(abs); }
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 " + rel);
    }
    const ext = path.extname(abs).toLowerCase();
    if (ext === ".html" || ext === ".htm") {
      const wantEditor = u.searchParams.get("edit") === "1";
      return serveHTML(res, abs, relOf(abs), wantEditor);
    }
    const buf = await fs.readFile(abs);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  } catch (e) {
    json(res, 500, { ok: false, error: String(e && e.message || e) });
  }
});

server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用。换一个端口重试：`);
    console.error(`  node editable-server.mjs --root "${ROOT}" --port ${PORT + 1}`);
    process.exit(1);
  }
  console.error("服务启动失败:", e && e.message ? e.message : e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Editable HTML 工作台已启动`);
  console.log(`  项目: ${ROOT}`);
  if (OPEN_FILE) console.log(`  文档: ${OPEN_FILE}`);
  console.log(`  地址: http://${HOST}:${PORT}/__wb/studio.html`);
});
