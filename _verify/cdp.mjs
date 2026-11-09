/* 极简 CDP 驱动：用系统已装 Chrome + Node 内置 WebSocket，零依赖 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(200);
  }
  throw new Error("cannot reach " + url);
}

export async function launch({ port = 9333, headless = true } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edvw-"));
  const exe = [
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((p) => fs.existsSync(p));
  if (!exe) throw new Error("no chrome/edge found");

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--disable-gpu",
    "--force-device-scale-factor=1",
    "--window-size=1600,1000",
    "about:blank",
  ];
  if (headless) args.unshift("--headless=new");

  const child = spawn(exe, args, { stdio: "ignore", detached: false });
  const list = await getJSON(`http://127.0.0.1:${port}/json/list`);
  const page = list.find((t) => t.type === "page") || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  const events = [];
  const waiters = [];

  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    } else if (m.method) {
      events.push(m);
      for (const w of waiters.slice()) if (w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error("timeout " + method)); } }, 30000);
    });

  const on = (method, timeout = 15000) =>
    new Promise((resolve, reject) => {
      const w = { test: (m) => m.method === method, resolve };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error("event timeout " + method)); } }, timeout);
    });

  const api = {
    send, on, events, sleep,
    async goto(url, waitMs = 900) {
      const loaded = on("Page.loadEventFired", 20000).catch(() => {});
      await send("Page.navigate", { url });
      await loaded;
      await sleep(waitMs);
    },
    async eval(expr, awaitPromise = true) {
      const r = await send("Runtime.evaluate", {
        expression: `(()=>{${expr}})()`,
        returnByValue: true, awaitPromise, userGesture: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async mouse(type, x, y, extra = {}) {
      await send("Input.dispatchMouseEvent", {
        type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1,
        clickCount: 1, ...extra,
      });
    },
    async drag(x0, y0, x1, y1, steps = 14) {
      await api.mouse("mousePressed", x0, y0);
      await sleep(60);
      for (let i = 1; i <= steps; i++) {
        await api.mouse("mouseMoved", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
        await sleep(16);
      }
      await api.mouse("mouseReleased", x1, y1);
      await sleep(250);
    },
    async screenshot(file) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
      return file;
    },
    async setViewport(width, height) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    },
    async close() {
      try { ws.close(); } catch {}
      try { child.kill(); } catch {}
    },
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  return api;
}
