#!/usr/bin/env node
/**
 * editable-studio.mjs — Editable HTML 工作台启动器（跨平台：macOS / Windows / Linux）
 *
 * 用法：
 *   node editable-studio.mjs --root <项目目录> [--port 8899] [--no-open]
 *
 * 作用：
 *   1. 启动 editable-server.mjs（同一份零依赖 Node 服务）
 *   2. 等待 /__ping 就绪后用系统默认浏览器打开工作台
 *
 * 与旧版 editable-studio.sh 的区别：
 *   · 不依赖 bash / curl / open —— Windows PowerShell、CMD 均可直接 `node editable-studio.mjs`
 *   · 健康检查用 Node 内置 fetch，不再依赖系统 curl
 */

import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, statSync, realpathSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── 参数 ─────────────────────────────────────────────── */
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
/* 默认根目录 = 包根目录（scripts 的上一级），不是 process.cwd()：
   双击 .cmd / .sh 时 CWD 往往是 scripts 目录，会让工作台只服务 scripts/。 */
const ROOT = path.resolve(arg("--root", path.join(__dirname, "..")));
const PORT = parseInt(arg("--port", "8899"), 10);
const HOST = arg("--host", "127.0.0.1");
const NO_OPEN = args.includes("--no-open");
const SERVER = path.join(__dirname, "editable-server.mjs");

/* --root 可以是目录，也可以直接是一个 .html 文档 */
const IS_FILE_ROOT = (() => { try { return statSync(ROOT).isFile(); } catch { return false; } })();

if (!existsSync(SERVER)) {
  console.error(`找不到 server: ${SERVER}`);
  process.exit(1);
}
if (!existsSync(ROOT)) {
  console.error(`目录不存在: ${ROOT}`);
  process.exit(1);
}

/* ── 健康检查（不依赖 curl） ───────────────────��─────── */
/* 返回 /__ping 的 JSON；失败返回 null。
   注意：必须区分「本包自己的工作台」和「别的程序占了这个端口」——
   旧版本工作台也会回 200，若直接当成已在运行，双击新版会打开旧编辑器。 */
function ping(startPort = PORT) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: startPort, path: "/__ping", timeout: 1500 }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try { resolve(res.statusCode === 200 ? JSON.parse(body) : null); }
        catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

/* ── 打开浏览器（跨平台） ─────────────────────────────── */
function openBrowser(url) {
  const p = process.platform;
  let cmd, args2;
  if (p === "darwin") {
    cmd = "open"; args2 = [url];
  } else if (p === "win32") {
    // start 是 cmd 内建命令，必须经 shell 且空参数作标题占位
    cmd = "cmd"; args2 = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open"; args2 = [url];
  }
  try {
    spawn(cmd, args2, { stdio: "ignore", detached: true, shell: p === "win32" }).unref();
  } catch {
    console.log(`请手动在浏览器打开: ${url}`);
  }
}

/* 端口被占就顺延到下一个空闲口（macOS 上 8899 常被别的本地服务占着） */
function freePort(start, triesMax = 12) {
  return new Promise((resolve) => {
    let p = start;
    let left = triesMax;
    const attempt = () => {
      if (left-- <= 0) return resolve(start);
      const s = net.createServer();
      s.once("error", () => { p += 1; attempt(); });
      s.once("listening", () => s.close(() => resolve(p)));
      s.listen(p, "127.0.0.1");
    };
    attempt();
  });
}

function pingPort(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: p, path: "/__ping", timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/* ── 已在运行则直接开浏览器 ───────────────────────────── */
const STUDIO_URL = `http://127.0.0.1:${PORT}/__wb/studio.html`;

const existing = await ping();
  const samePkg = (() => {
    if (!existing || !existing.ok || !existing.package) return false;
    const real = (p) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
    return real(existing.package) === real(path.join(__dirname, ".."));
  })();
if (samePkg) {
  console.log(`服务已在运行: ${STUDIO_URL}`);
  console.log(`  注意：已在运行的服务可能指向另一个项目，如需换项目请先关掉它。`);
  if (!NO_OPEN) openBrowser(STUDIO_URL);
  process.exit(0);
}

/* 端口上坐的是别的程序 / 旧版本工作台 → 顺延到空闲端口 */
const CHOSEN_PORT = await freePort(PORT);
if (CHOSEN_PORT !== PORT) {
  console.log(existing
    ? `端口 ${PORT} 上是个别的工作台/服务（${existing.package || "未知"}），改用 ${CHOSEN_PORT}`
    : `端口 ${PORT} 已被其它程序占用，改用 ${CHOSEN_PORT}`);
}
const FINAL_URL = `http://127.0.0.1:${CHOSEN_PORT}/__wb/studio.html`;

/* ── 启动 server ─────────────────────────────────────── */
const child = spawn(process.execPath, [SERVER, "--root", ROOT, "--port", String(CHOSEN_PORT), "--host", HOST], {
  stdio: "inherit",
});
child.on("error", (e) => {
  console.error("启动 server 失败:", e.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));

/* ── 等就绪 ───────────────────────────────────────────── */
let tries = 0;
const timer = setInterval(async () => {
  tries += 1;
  if (await pingPort(CHOSEN_PORT)) {
    clearInterval(timer);
    console.log(`工作台已启动: ${FINAL_URL}`);
    console.log(`  ${IS_FILE_ROOT ? "文档" : "项目目录"}: ${ROOT}`);
    if (!NO_OPEN) openBrowser(FINAL_URL);
  } else if (tries > 40) {
    clearInterval(timer);
    console.error("启动超时（server 未响应 /__ping）");
    child.kill();
    process.exit(1);
  }
}, 250);
