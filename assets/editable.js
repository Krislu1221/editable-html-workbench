/* ============================================================
   editable.js v4 — PPT 式可视化编辑器（原生指针拖放内核）
   ------------------------------------------------------------
   v3 曾用 Moveable 作为拖放内核，但在真实浏览器里它的内部手势对象
   （targetAbles / targetGesto）无法建立，dragStart 静默失败——连最小
   复现都拖不动。240KB vendor 成了整个工作台里唯一不可控的部分。

   v4 改为自带的指针事件内核（本文件内的原生实现，零依赖）：
     · 拖动 / 八向缩放 / 旋转 / 吸附参考线 / 层级，全部可预测
     · 不再有第三方框架的时序坑，也没有 240KB 运行时
     · 交付的 HTML 依旧只多一行 <script src="editable.js">
   本文件只负责：选中、属性面板、图层顺序、撤销重做、保存写回原文件。

   用法：URL 加 ?edit=1
   能力：
     · 自由拖放（脱离栅格 → .free-layer 绝对定位）
     · 八向缩放 / 旋转 + 吸附参考线（页边、页面中线、其它块边缘）
     · 层级控制（置顶 / 上移 / 下移 / 置底）
     · 双击改文字
     · 右侧属性面板：颜色 / 字号 / 粗细 / 对齐 / 附加 class
     · 撤销 / 重做（Ctrl+Z / Ctrl+Shift+Z）
     · 写回原文件（配合 editable-server.mjs 的 /__save），不产生新文件、不加编号
   ------------------------------------------------------------
   关键设计：
     · 所有改动只落在元素的 data-eid-* 属性上，真实 class/style 在提交时写回
     · 撤销/重做/保存走同一条路径，改完的 HTML 仍是干净可手工维护的源码
     · 自由定位元素统一放进 .free-layer（页面内绝对定位层），坐标相对页面左上角
   ============================================================ */

(function () {
  "use strict";

  if (!/[?&]edit=1/.test(location.search)) return;
  if (window.__EDITABLE_LOADED__) return;
  window.__EDITABLE_LOADED__ = true;

  /* ── 基础 ─────────────────────────────────────────── */

  const API_PATH = window.__EDIT_SAVE__ || "/__save";
  /* 接口前缀：通常就是空（服务挂在根上），留出可被反向代理改路径的余地 */
  const API_BASE = String(API_PATH).replace(/\/__save$/, "");
  const FILE = window.__EDIT_FILE__ || location.pathname.replace(/^.*\/demos\//, "");
  /* 被工作台用 iframe 嵌入时，外壳已经提供了「退出编辑 / 撤销 / 保存」按钮，
     页面内的 HUD 就是重复的（还会盖住画布），所以内嵌时隐藏。 */
  const EMBEDDED = (() => { try { return window.parent && window.parent !== window; } catch (e) { return false; } })();

  const state = {
    selected: null,
    undo: [],
    redo: [],
    dirty: false,
    scale: 1,
    frozen: false,
    /* 用户缩放倍率：1 = 适应窗口。只缩放画布页面本身，不影响左右面板。 */
    userZoom: 1,
  };

  /* 按住空格时的临时缩放覆盖值（1 = 1 CSS px : 1 屏幕 px 的真实比例） */
  let zoomOverride = null;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

  /* 可选中的元素：分两层
     · 文字层（可改文字/颜色/字号）—— 尽量细，用户点哪个字就改哪个
     · 块层（可拖动/缩放/调层级）—— 容器与卡片
     两层共存：选中的文字层，其「块」= 最近带 data-drag 的祖先。 */
  const TEXT_PICK = "h1,h2,h3,h4,h5,h6,p,li,td,th,figcaption,caption,b,strong,em,u,small,span," +
    ".k,.v,.n,.lbl,.t,.d,.no,.m,.cap,.claim,.l1,.l2,.seal,.eyebrow,.slide-title,.slide-sub," +
    ".note,.lead,.kpi .ico,.cover .brand,.cover .facts b,.cover .facts span,.words,.words span";
  const BLOCK_PICK = ".blk,.kpi,.tag,.btn,.step,.panel,.bar,.tbl,.card,.plate," +
    ".adv .col,.cover .left,.cover .right,.cover .facts,.stack,.grid,.slide-body,.slide-head,.slide-foot";
  const PICKABLE = TEXT_PICK + "," + BLOCK_PICK;

  const HANDLE_DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const HANDLE_CURSOR = {
    nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize",
    se: "nwse-resize", s: "ns-resize", sw: "nesw-resize", w: "ew-resize",
  };

  /* ── 元素登记 ─────────────────────────────────────── */

  let seq = 0;
  function assignIds() {
    $$("[data-eid]").forEach((el) => {
      if (!el.hasAttribute("data-eid-base-cls")) el.setAttribute("data-eid-base-cls", el.getAttribute("class") || "");
      if (!el.hasAttribute("data-eid-st")) el.setAttribute("data-eid-st", el.getAttribute("style") || "");
    });
    $$(PICKABLE).forEach((el) => {
      if (el.closest("[data-eid-ui]")) return;
      if (!el.dataset.eid) el.dataset.eid = "e" + (++seq);
      if (!el.hasAttribute("data-eid-base-cls")) el.setAttribute("data-eid-base-cls", el.getAttribute("class") || "");
      if (!el.hasAttribute("data-eid-st")) el.setAttribute("data-eid-st", el.getAttribute("style") || "");
    });
  }

  /* 把 data-eid-* 上的改动真正写到元素 */
  function applyProps(el) {
    const c = el.getAttribute("data-eid-cls");
    if (c !== null) {
      const base = (el.getAttribute("data-eid-base-cls") || "").split(/\s+/).filter(Boolean);
      const inc = c.split(/\s+/).filter(Boolean);
      const seen = new Set(), out = [];
      base.concat(inc).forEach((x) => { if (!seen.has(x)) { seen.add(x); out.push(x); } });
      el.setAttribute("class", out.join(" "));
    }
    const s = el.getAttribute("data-eid-st");
    if (s !== null) el.setAttribute("style", s);
    const t = el.getAttribute("data-eid-text");
    if (t !== null && el.textContent !== t) setTextPreserving(el, t);
  }
  function applyAll() { $$("[data-eid]").forEach(applyProps); }

  /* ── 样式属性读写（都在 data-eid-st 上） ──────────── */

  function stGet(el, prop) {
    const st = el.getAttribute("data-eid-st") || "";
    const m = st.match(new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)", "i"));
    return m ? m[1].trim() : "";
  }
  function stSet(el, prop, val) {
    let st = el.getAttribute("data-eid-st") || "";
    st = st.replace(new RegExp("(?:^|;)\\s*" + prop + "\\s*:[^;]*", "ig"), "").trim();
    if (val) st = (st ? st + ";" : "") + prop + ":" + val;
    el.setAttribute("data-eid-st", st.trim());
    applyProps(el);
  }

  /* ── 撤销 / 重做 ──────────────────────────────────── */

  /* 父节点路径（相对 body），用于把元素放回栅格原位 */
  function parentPath(node) {
    const parts = [];
    let n = node;
    while (n && n !== document.body) {
      const p = n.parentElement;
      if (!p) break;
      const idx = [...p.children].indexOf(n);
      parts.unshift(idx);
      n = p;
    }
    return parts.join(".");
  }
  function nodeByPath(pathStr) {
    if (!pathStr) return null;
    let n = document.body;
    for (const i of pathStr.split(".").map(Number)) {
      if (!n.children[i]) return null;
      n = n.children[i];
    }
    return n;
  }

  function snapshot() {
    const s = {};
    $$("[data-eid]").forEach((el) => {
      const free = el.getAttribute("data-free") === "1" ? "1" : "";
      // 自由定位元素记「原始栅格位置」，否则撤销后回不去原位
      const op = free ? el.getAttribute("data-eid-parent") : "";
      const on = free ? el.getAttribute("data-eid-next") : "";
      s[el.dataset.eid] = {
        cls: el.getAttribute("data-eid-cls") || "",
        st: el.getAttribute("data-eid-st") || "",
        txt: el.getAttribute("data-eid-text") || "",
        free,
        parentPath: free && op ? op : (el.parentElement ? parentPath(el.parentElement) : ""),
        nextId: free && on ? on
          : (el.nextElementSibling && el.nextElementSibling.dataset ? (el.nextElementSibling.dataset.eid || "") : ""),
      };
    });
    return s;
  }

  function restore(s) {
    Object.keys(s).forEach((id) => {
      const el = $(`[data-eid="${id}"]`);
      if (!el) return;
      el.setAttribute("data-eid-cls", s[id].cls);
      el.setAttribute("data-eid-st", s[id].st);
      if (s[id].txt) el.setAttribute("data-eid-text", s[id].txt);
      if (s[id].free) {
        el.setAttribute("data-free", s[id].free);
        if (s[id].parentPath) el.setAttribute("data-eid-parent", s[id].parentPath);
        if (s[id].nextId) el.setAttribute("data-eid-next", s[id].nextId);
        // 重做/恢复成自由定位：元素要真的回到 .free-layer（否则只挂属性、人还在流里 → 重做看不出变化）
        const layer = freeLayer();
        if (layer && el.parentElement !== layer) layer.appendChild(el);
      } else {
        // 从自由定位回到栅格：放回原父节点的原位置
        el.removeAttribute("data-free");
        if (el.parentElement && el.parentElement.classList.contains("free-layer")) {
          backToGrid(el, s[id].parentPath, s[id].nextId);
        }
      }
    });
    applyAll();
    refresh();
    updateSelectionBox();
  }

  /* 把元素从 .free-layer 放回指定父节点的指定位置 */
  function backToGrid(el, pp, nid) {
    const s = slide();
    const target = nodeByPath(pp) || (s && s.querySelector(".slide-body")) || s;
    if (!target) return;
    const ref = nid ? $(`[data-eid="${nid}"]`) : null;
    if (ref && ref !== el && ref.parentElement === target) target.insertBefore(el, ref);
    else target.appendChild(el);
  }

  function pushUndo() {
    state.undo.push(snapshot());
    if (state.undo.length > 80) state.undo.shift();
    state.redo.length = 0;
    markDirty();
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push(snapshot());
    restore(state.undo.pop());
    markDirty();
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(snapshot());
    restore(state.redo.pop());
    markDirty();
  }

  function markDirty() { state.dirty = true; notifyParent({ type: "dirty", value: true }); }

  /* ── 画布尺寸与缩放 ──────────────────────────────── */

  /* 画布锚点：优先 .slide（规范项目的页面骨架），
     否则找「页面型」容器（.page / .sheet / .board），
     最后才退到 body 里第一个「可见且有尺寸」的块级元素。
     【坑】不能直接取 body 第一个子元素：常见做法是在 body 顶部放一个
     0×0 的 SVG 图标精灵，取到它就会把缩放作用在空节点上，看起来就是「缩放无效」。 */
  let canvasAnchor = null;
  function pageLikes() {
    return [...document.querySelectorAll(".page, .sheet, .board")]
      .filter((n) => n.offsetWidth > 100 && n.offsetHeight > 100);
  }
  function slide() {
    const s = document.querySelector(".slide");
    if (s) { s.setAttribute("data-ed-anchor", "1"); return s; }
    if (canvasAnchor && canvasAnchor.isConnected) {
      canvasAnchor.setAttribute("data-ed-anchor", "1");
      return canvasAnchor;
    }
    let cand = pageLikes()[0] || null;
    if (!cand) {
      const kids = [...document.body.children].filter((n) =>
        ["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "SVG"].indexOf(n.tagName) < 0);
      cand = kids.find((n) => n.offsetWidth > 40 && n.offsetHeight > 40) || document.body;
    }
    canvasAnchor = cand;
    cand.setAttribute("data-ed-anchor", "1");
    if (cand !== document.body && getComputedStyle(cand).position === "static") {
      cand.style.position = "relative";
      cand.setAttribute("data-ed-anchor-pos", "1");
    }
    return cand;
  }
  /* 需要一起缩放的画布块：
     · 多页堆叠文档（一文件 20+ 页）→ 运行时把它们包进 #__ed_scope 一起缩放，
       否则只有第一页被缩、其余保持原尺寸；自由层（.free-layer）若在页面外面，也要一起缩，
       不然拖出来的元素会保持 100% 尺寸压在缩小后的页面上。
     · 单一 .slide / 单页 → 就是锚点自己。
     · 保存时会在副本里把这个包装层拆掉，不写进交付文件。 */
  let scopeWrap = null;
  function ensureScope() {
    if (scopeWrap && scopeWrap.isConnected) return scopeWrap;
    const pages = pageLikes();
    if (pages.length < 2) return null;
    const existing = document.getElementById("__ed_scope");
    if (existing) { scopeWrap = existing; return scopeWrap; }
    const first = pages[0];
    const wrap = document.createElement("div");
    wrap.id = "__ed_scope";
    wrap.style.cssText = "position:relative;transform-origin:top left;";
    first.parentElement.insertBefore(wrap, first);
    pages.forEach((p) => wrap.appendChild(p));
    const layer = document.querySelector(".free-layer");
    if (layer && !wrap.contains(layer)) wrap.appendChild(layer);
    scopeWrap = wrap;
    return wrap;
  }
  function unwrapScope(root) {
    const w = root && root.querySelector ? root.querySelector("#__ed_scope") : null;
    if (!w) return;
    const parent = w.parentElement;
    [...w.children].forEach((c) => parent.insertBefore(c, w));
    w.remove();
    if (root === document) scopeWrap = null;
  }
  function canvasParts(anchor) {
    const w = ensureScope();
    if (w) return [w];
    const pages = pageLikes();
    return pages.length > 1 ? pages : [anchor];
  }
  function inCanvas(el) {
    if (!el) return false;
    const parts = canvasParts(slide());
    return parts.some((p) => p === el || p.contains(el));
  }

  function fitCanvas() {
    const s = slide();
    if (!s) return;
    const natW = s.offsetWidth || 1920;
    const natH = s.offsetHeight || 1080;
    // 右侧属性面板是 fixed，可用宽度 = 视口 - 面板；高度也要参与，避免画布越出视口
    const availW = Math.max(160, window.innerWidth - 300);
    const availH = Math.max(140, window.innerHeight);
    /* 基础缩放：
       · 宽度永远适配
       · 只有「单屏 / 横向」页面（高宽比 ≤ 1.3）才连高度一起适配
       · 长文档（如 2151×29862）按宽度适配、纵向滚动——否则会被高度压成 3% 无法阅读
       用户缩放再乘上去（只缩放页面，不缩放左右面板）。 */
    const baseW = Math.min(1, availW / natW);
    const ar = natW > 0 ? natH / natW : 1;
    const base = ar <= 1.3 ? Math.min(baseW, availH / natH) : baseW;
    const sc = zoomOverride != null ? zoomOverride : Math.max(0.02, Math.min(6, base * state.userZoom));
    state.scale = sc;
    document.documentElement.style.setProperty("--ed-scale", String(sc));

    const parts = canvasParts(s);
    const single = parts.length === 1;
    parts.forEach((p) => {
      const pw = p.offsetWidth || natW;
      const ph = p.offsetHeight || natH;
      p.style.transformOrigin = "top left";
      p.style.transform = sc === 1 ? "" : "scale(" + sc + ")";
      /* transform 不占布局空间：放大时用 margin 补出滚动区域，否则滚不到被放大的部分。
         多页堆叠文档不做垂直居中（各页按原顺序堆叠），单页才居中。 */
      p.style.marginTop = single ? Math.max(0, (availH - ph * sc) / 2) + "px" : "";
      p.style.marginBottom = Math.max(0, ph * (sc - 1)) + "px";
      p.style.marginRight = Math.max(0, pw * (sc - 1)) + "px";
    });
    notifyParent({ type: "scale", value: sc });
    updateSelectionBox();
  }

  /* 缩放画布页面（外壳的按钮 / Ctrl+滚轮 / 触控板双指捏合 都会调到这里） */
  function setZoom(z) {
    state.userZoom = Math.max(0.05, Math.min(8, z || 1));
    fitCanvas();
    refresh();
  }

  /* 元素在页面坐标系（未缩放）中的位置与尺寸 */
  function rectIn(el) {
    const s = slide();
    const a = el.getBoundingClientRect();
    const b = s.getBoundingClientRect();
    const k = state.scale || 1;
    return {
      x: (a.left - b.left) / k,
      y: (a.top - b.top) / k,
      w: a.width / k,
      h: a.height / k,
    };
  }

  /* 自由定位元素读 inline 值（避免旋转后 bounding box 变大导致框错位） */
  function boxRect(el) {
    if (el.getAttribute("data-free") === "1") {
      return {
        x: parseFloat(el.style.left) || 0,
        y: parseFloat(el.style.top) || 0,
        w: parseFloat(el.style.width) || el.offsetWidth,
        h: parseFloat(el.style.height) || el.offsetHeight,
      };
    }
    return rectIn(el);
  }

  /* ── 画布锁定（PPT 式编辑）──────────────────────────
     目标语义：像改 PPT 一样改 HTML。
     · 元素之间没有「反亲和性」：拖一个，其他绝不跟着挪
     · 允许重叠 / 覆盖
     · 不靠占位块，原位置不留死区（拖走就空着，跟 PPT 一样）

     做法：进入编辑时把整个画布**按当前位置一次性冻成绝对坐标**，
     之后没有任何元素参与文档流 → 拖谁都不会引起重排。
     冻结只作用于块级盒子；inline 子元素（文字、span）留在父盒的文字流里，跟着父盒走。
     “退出编辑”但没保存时会把原样式还原，不污染未保存的页面。 */
  const frozenOrig = new WeakMap();   // el → 冻结前的 style 属性（还原用）
  const frozenNodes = new Set();

  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

  function isBlockLevel(cs) {
    return cs.display !== "inline" && cs.display !== "contents" && cs.display !== "none";
  }

  /* 画布真实生效的缩放比（取元素自身 rect/offset 比值，跟 state.scale 的更新时序无关）。
     【坑】直接用 state.scale：fitCanvas() 刚改完 state、浏览器可能还没重算 transform，
     此时 rect 是未缩放值 → 冻结出来的宽度会被放大 1/k（实测 1200 → 1840）。 */
  function actualScale() {
    const s = slide();
    if (!s || !s.offsetWidth) return state.scale || 1;
    const k = s.getBoundingClientRect().width / s.offsetWidth;
    return k > 0 ? k : (state.scale || 1);
  }

  let freezeCanvasRect = null;
  let freezeZ = 0;

  function freezeLayout() {
    if (state.frozen) return 0;
    const canvas = slide();
    if (!canvas) return 0;
    const k = actualScale();
    freezeCanvasRect = canvas.getBoundingClientRect();
    freezeZ = 0;
    const n = freezeInto(canvas, k);
    state.frozen = true;
    try {
      window.__FREEZE_DEBUG = {
        k: k,
        stateScale: state.scale,
        userZoom: state.userZoom,
        canvasRectW: canvas.getBoundingClientRect().width,
        canvasOffsetW: canvas.offsetWidth,
        nodes: n,
        canvasTag: canvas.tagName + "." + (canvas.className || ""),
        canvasStyleW: canvas.style.width,
        canvasComputedW: getComputedStyle(canvas).width,
        canvasTransform: getComputedStyle(canvas).transform,
        rootTransform: getComputedStyle(document.documentElement).transform,
        bodyTransform: getComputedStyle(document.body).transform,
        scopeTransform: document.getElementById("__ed_scope") ? getComputedStyle(document.getElementById("__ed_scope")).transform : null,
      };
    } catch (e) {}
    return n;
  }

  function freezeInto(parent, k) {
    let count = 0;
    const pcs = getComputedStyle(parent);
    if (pcs.position === "static") {
      // 成为绝对定位子元素的参照；serialize 会把临时 relative 清掉
      if (!parent.hasAttribute("data-ed-anchor-pos")) parent.setAttribute("data-ed-anchor-pos", "1");
      parent.style.position = "relative";
    }
    const b = parent.getBoundingClientRect();
    const pl = parseFloat(pcs.borderLeftWidth) || 0;
    const pt = parseFloat(pcs.borderTopWidth) || 0;

    /* 【必须先读完所有兄弟的矩形，再下手】
       边读边设会把第一个子元素变绝对 → 后面的兄弟立刻上移，读到的坐标已经是错的
       （实测：三块全被冻结到同一个 top，版面直接叠在一起）。 */
    const kids = [];
    Array.from(parent.children).forEach((ch) => {
      if (ch.nodeType !== 1) return;
      if (ch.hasAttribute("data-eid-ui")) return;
      if (ch.hasAttribute("data-ed-layer") || ch.classList.contains("free-layer")) return;
      const cs = getComputedStyle(ch);
      if (cs.display === "none") return;
      if (!isBlockLevel(cs)) return;                       // inline / contents：不动
      if (cs.position === "absolute" || cs.position === "fixed") {
        kids.push({ ch, already: true });
        return;
      }
      const r = ch.getBoundingClientRect();
      if (!r.width && !r.height) return;
      kids.push({
        ch,
        l: (r.left - b.left) / k - pl,
        t: (r.top - b.top) / k - pt,
        w: r.width / k,
        h: r.height / k,
        canvasFrame: freezeCanvasRect ? [
          (r.left - freezeCanvasRect.left) / k,
          (r.top - freezeCanvasRect.top) / k,
          r.width / k,
          r.height / k,
        ] : null,
      });
    });

    kids.forEach((kid) => {
      if (kid.already) return;
      setFrozen(kid.ch, kid.l, kid.t, kid.w, kid.h);
      count += 1;
      try {
        (window.__FREEZE_CHECKS = window.__FREEZE_CHECKS || []).push({
          elId: kid.ch.id || "",
          cls: kid.ch.className || "",
          expect: kid.canvasFrame || [kid.l, kid.t, kid.w, kid.h],
        });
      } catch (e) {}
    });
    kids.forEach((kid) => { count += freezeInto(kid.ch, k); });
    return count;
  }

  function setFrozen(el, l, t, w, h) {
    if (!frozenOrig.has(el)) frozenOrig.set(el, el.getAttribute("style"));
    frozenNodes.add(el);
    if (el.dataset.eid) el.setAttribute("data-eid-orig", [r2(l), r2(t), r2(w), r2(h)].join("|"));
    const base = el.dataset.eid ? (el.getAttribute("data-eid-st") || "") : (el.getAttribute("style") || "");
    const cleaned = base
      .replace(/(?:^|;)\s*(position|left|top|width|height|margin|box-sizing)\s*:[^;]*/gi, "")
      .replace(/;{2,}/g, ";")
      .replace(/^[;\s]+|[;\s]+$/g, "")
      .trim();
    /* 层序：冻结时按文档顺序发一个初始 z-index（PPT 里每个对象都有层号）。
       已有 z-index 的元素不覆盖——否则用户调过的层序会被冻结重置。 */
    const hasZ = /(?:^|;)\s*z-index\s*:/i.test(cleaned);
    const zPart = hasZ ? "" : ";z-index:" + (++freezeZ);
    const add = "position:absolute;left:" + r2(l) + "px;top:" + r2(t) + "px;width:" + r2(w) +
      "px;height:" + r2(h) + "px;margin:0;box-sizing:border-box" + zPart;
    const merged = cleaned ? cleaned + ";" + add : add;
    if (el.dataset.eid) el.setAttribute("data-eid-st", merged);
    el.setAttribute("style", merged);
  }

  function restoreFrozen() {
    frozenNodes.forEach((el) => {
      const orig = frozenOrig.get(el);
      if (orig === null || orig === undefined) el.removeAttribute("style");
      else el.setAttribute("style", orig);
      if (el.dataset && el.dataset.eid) {
        el.setAttribute("data-eid-st", orig || "");
        el.removeAttribute("data-eid-orig");
      }
    });
    frozenNodes.clear();
    state.frozen = false;
  }

  function freeLayer() {
    let l = $(".free-layer");
    if (!l) {
      l = document.createElement("div");
      l.className = "free-layer";
      // 定位层是文档的真实结构（不是编辑器 UI），不能被序列化清理掉
      l.setAttribute("data-ed-layer", "1");
      l.style.cssText = "position:absolute;inset:0;pointer-events:none";
      const s = slide();
      if (s) s.appendChild(l);
    }
    return l;
  }

  /* 把元素转成自由定位（脱离栅格流），并记下原始栅格位置 */
  function toFreeQuiet(el) {
    if (el.getAttribute("data-free") === "1") return;
    const r = rectIn(el);
    el.setAttribute("data-eid-parent", el.parentElement ? parentPath(el.parentElement) : "");
    el.setAttribute("data-eid-next",
      el.nextElementSibling && el.nextElementSibling.dataset ? (el.nextElementSibling.dataset.eid || "") : "");

    const layer = freeLayer();
    layer.appendChild(el);
    el.setAttribute("data-free", "1");
    el.style.position = "absolute";
    el.style.left = r.x + "px";
    el.style.top = r.y + "px";
    el.style.width = r.w + "px";
    el.style.height = r.h + "px";
    el.style.margin = "0";
    el.style.pointerEvents = "auto";
    el.style.zIndex = stGet(el, "z-index") || "10";
    el.style.boxSizing = "border-box";
  }

  /* ── 选择 ────────────────────────────────────────── */

  function select(el) {
    if (state.selected === el) { updateSelectionBox(); return; }
    if (state.selected) state.selected.removeAttribute("data-sel");
    state.selected = el;
    if (el) el.setAttribute("data-sel", "1");
    refresh();
    updateSelectionBox();
  }

  /* 元素的块容器（拖动/缩放/层级作用于此）
     优先级：带 data-drag 的祖先 → BLOCK_PICK 类名祖先 → 最近的块级祖先 */
  function blockOf(el) {
    if (!el) return null;
    const byDrag = el.closest("[data-drag]");
    if (byDrag) return byDrag;
    const byCls = el.closest(BLOCK_PICK);
    if (byCls) return byCls;
    let n = el.parentElement;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      const isInline = cs.display === "inline" || cs.display === "inline-block";
      if (!isInline && n.matches(PICKABLE)) return n;
      n = n.parentElement;
    }
    return el;
  }

  /* ── 选择框 / 八个控制点 / 参考线（原生，替代 Moveable） ── */

  let overlay, selBox, rotHandle, guideV, guideH;
  const handles = {};

  function ensureOverlay() {
    const s = slide();
    if (!s) return null;
    if (overlay && overlay.isConnected) return overlay;

    overlay = document.createElement("div");
    overlay.id = "__editable_overlay";
    overlay.setAttribute("data-eid-ui", "");
    overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2147482000";
    s.appendChild(overlay);

    selBox = document.createElement("div");
    selBox.id = "__editable_sel";
    selBox.setAttribute("data-eid-ui", "");
    selBox.style.cssText =
      "position:absolute;pointer-events:none;display:none;box-sizing:border-box;" +
      "border:calc(1px / var(--ed-scale,1)) solid #2f9e52;" +
      "outline:calc(1px / var(--ed-scale,1)) dashed rgba(80,150,110,.45);" +
      "outline-offset:calc(2px / var(--ed-scale,1))";
    overlay.appendChild(selBox);

    const sz = "calc(9px / var(--ed-scale,1))";
    const off = "calc(4.5px / var(--ed-scale,1))";
    HANDLE_DIRS.forEach((d) => {
      const h = document.createElement("div");
      h.setAttribute("data-eid-ui", "");
      h.dataset.dir = d;
      h.className = "ed-handle";
      let pos = "";
      if (d === "nw") pos = "left:0;top:0";
      if (d === "n") pos = "left:50%;top:0";
      if (d === "ne") pos = "left:100%;top:0";
      if (d === "e") pos = "left:100%;top:50%";
      if (d === "se") pos = "left:100%;top:100%";
      if (d === "s") pos = "left:50%;top:100%";
      if (d === "sw") pos = "left:0;top:100%";
      if (d === "w") pos = "left:0;top:50%";
      h.style.cssText =
        "position:absolute;width:" + sz + ";height:" + sz + ";background:#fff;box-sizing:border-box;" +
        "border:calc(1px / var(--ed-scale,1)) solid #2f9e52;" +
        "border-radius:calc(2px / var(--ed-scale,1));pointer-events:auto;" +
        "cursor:" + HANDLE_CURSOR[d] + ";margin-left:calc(-1 * " + off + ");margin-top:calc(-1 * " + off + ");" + pos;
      selBox.appendChild(h);
      handles[d] = h;
    });

    rotHandle = document.createElement("div");
    rotHandle.id = "__editable_rotate";
    rotHandle.setAttribute("data-eid-ui", "");
    rotHandle.title = "拖动旋转";
    rotHandle.style.cssText =
      "position:absolute;left:50%;top:0;width:calc(11px / var(--ed-scale,1));height:calc(11px / var(--ed-scale,1));" +
      "margin-left:calc(-5.5px / var(--ed-scale,1));margin-top:calc(-22px / var(--ed-scale,1));" +
      "background:#fff;border:calc(1px / var(--ed-scale,1)) solid #2f9e52;border-radius:50%;" +
      "pointer-events:auto;cursor:grab";
    selBox.appendChild(rotHandle);

    guideV = document.createElement("div");
    guideV.setAttribute("data-eid-ui", "");
    guideV.style.cssText =
      "position:absolute;top:0;bottom:0;width:0;display:none;pointer-events:none;" +
      "border-left:calc(1px / var(--ed-scale,1)) dashed #d33";
    overlay.appendChild(guideV);

    guideH = document.createElement("div");
    guideH.setAttribute("data-eid-ui", "");
    guideH.style.cssText =
      "position:absolute;left:0;right:0;height:0;display:none;pointer-events:none;" +
      "border-top:calc(1px / var(--ed-scale,1)) dashed #d33";
    overlay.appendChild(guideH);

    return overlay;
  }

  function rotationOf(el) {
    const st = el.getAttribute("style") || "";
    const m = st.match(/rotate\(\s*(-?[\d.]+)deg\s*\)/i);
    return m ? parseFloat(m[1]) : 0;
  }

  function updateSelectionBox() {
    const l = ensureOverlay();
    if (!l || !selBox) return;
    const el = state.selected ? blockOf(state.selected) : null;
    if (!el || !inCanvas(el)) {
      selBox.style.display = "none";
      showGuides(null, null);
      return;
    }
    const r = boxRect(el);
    selBox.style.display = "block";
    selBox.style.left = r.x + "px";
    selBox.style.top = r.y + "px";
    selBox.style.width = r.w + "px";
    selBox.style.height = r.h + "px";
    const deg = rotationOf(el);
    selBox.style.transform = deg ? "rotate(" + deg + "deg)" : "";
    selBox.style.transformOrigin = "50% 50%";
  }

  function showGuides(vx, hy) {
    if (!guideV || !guideH) return;
    if (vx === null || vx === undefined) guideV.style.display = "none";
    else { guideV.style.display = "block"; guideV.style.left = vx + "px"; }
    if (hy === null || hy === undefined) guideH.style.display = "none";
    else { guideH.style.display = "block"; guideH.style.top = hy + "px"; }
  }

  /* ── 吸附目标（页边 / 页面中线 / 其它块边缘） ─────── */

  function collectSnapTargets(exclude) {
    const s = slide();
    if (!s) return { v: [], h: [] };
    const W = s.offsetWidth, H = s.offsetHeight;
    const v = [0, W / 2, W], hh = [0, H / 2, H];
    $$("[data-eid]", s).forEach((el) => {
      if (el === exclude || exclude.contains(el) || el.contains(exclude)) return;
      if (el.closest("[data-eid-ui]")) return;
      if (el.classList.contains("free-layer")) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      const r = boxRect(el);
      if (!(r.w > 0) || !(r.h > 0)) return;
      v.push(r.x, r.x + r.w / 2, r.x + r.w);
      hh.push(r.y, r.y + r.h / 2, r.y + r.h);
    });
    return { v, h: hh };
  }

  function snapAxis(pos, size, cands, thr) {
    const edges = [pos, pos + size / 2, pos + size];
    let best = null;
    for (const c of cands) {
      for (let i = 0; i < 3; i++) {
        const d = c - edges[i];
        if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: c };
      }
    }
    return best ? { pos: pos + best.d, line: best.line } : { pos, line: null };
  }

  /* ── 指针交互：拖动 / 缩放 / 旋转 ─────────────────── */

  let drag = null;    // 进行中的操作
  let pending = null; // 已按下但还没越过拖拽阈值

  const DRAG_THRESHOLD = 3; // 屏幕像素；小于它视为单击（保留双击改字）

  function beginMove(el, ev, ox, oy) {
    pushUndo();
    toFreeQuiet(el);
    const r = boxRect(el);
    // 【坐标语义】起点必须是**按下的位置**，不是越过阈值那一刻的位置——
    // 否则起步的前几个像素会被吃掉（实测拖 100 屏幕px 只走 172.5 逻辑px）。
    drag = {
      mode: "move", el,
      sx: ox === undefined ? ev.clientX : ox,
      sy: oy === undefined ? ev.clientY : oy,
      base: { x: r.x, y: r.y, w: r.w, h: r.h },
      targets: collectSnapTargets(el),
    };
    document.body.style.userSelect = "none";
  }

  function beginResize(dir, el, ev) {
    pushUndo();
    toFreeQuiet(el);
    const r = boxRect(el);
    drag = {
      mode: "resize", dir, el,
      sx: ev.clientX, sy: ev.clientY,
      base: { x: r.x, y: r.y, w: r.w, h: r.h },
      targets: collectSnapTargets(el),
    };
    document.body.style.userSelect = "none";
  }

  function beginRotate(el, ev) {
    pushUndo();
    toFreeQuiet(el);
    const r = boxRect(el);
    const s = slide().getBoundingClientRect();
    const cx = s.left + (r.x + r.w / 2) * state.scale;
    const cy = s.top + (r.y + r.h / 2) * state.scale;
    drag = {
      mode: "rotate", el, cx, cy,
      startAngle: Math.atan2(ev.clientY - cy, ev.clientX - cx),
      baseDeg: rotationOf(el),
    };
    document.body.style.userSelect = "none";
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (document.body.getAttribute("data-editing") !== "1") return;
    const t = e.target;
    if (!t || !t.closest) return;

    // 编辑器 UI（面板 / HUD / 控制点）：控制点接管，其余放行给面板
    const uiHit = t.closest("[data-eid-ui]");
    if (uiHit) {
      const h = t.closest(".ed-handle");
      const el = blockOf(state.selected);
      if (h && el) { e.preventDefault(); e.stopPropagation(); beginResize(h.dataset.dir, el, e); return; }
      if (t.closest("#__editable_rotate") && el) {
        e.preventDefault(); e.stopPropagation(); beginRotate(el, e); return;
      }
      return;
    }

    const hit = t.closest(PICKABLE);
    if (!hit) {
      if (!t.closest(".slide")) select(null);
      return;
    }
    if (hit.isContentEditable || hit.closest('[contenteditable="true"]')) return;

    select(hit);
    const blk = blockOf(hit);
    if (!blk) return;
    // 先记为「待定」：越过阈值才真正开始拖动，这样单击选中、双击改字都不受影响
    pending = { el: blk, x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e) {
    if (!drag) {
      if (!pending) return;
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < DRAG_THRESHOLD) return;
      const el = pending.el, ox = pending.x, oy = pending.y;
      pending = null;
      beginMove(el, e, ox, oy);
      if (!drag) return;
      // 不 return：同一次 move 里就把位移应用上，避免起步掉帧
    }
    const d = drag;
    e.preventDefault();
    const k = state.scale || 1;

    if (d.mode === "move") {
      const dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k;
      const vx = snapAxis(d.base.x + dx, d.base.w, d.targets.v, 6);
      const hy = snapAxis(d.base.y + dy, d.base.h, d.targets.h, 6);
      d.el.style.left = vx.pos + "px";
      d.el.style.top = hy.pos + "px";
      showGuides(vx.line, hy.line);
    } else if (d.mode === "resize") {
      const dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k;
      let x = d.base.x, y = d.base.y, w = d.base.w, h = d.base.h;
      if (d.dir.indexOf("e") >= 0) w = d.base.w + dx;
      if (d.dir.indexOf("s") >= 0) h = d.base.h + dy;
      if (d.dir.indexOf("w") >= 0) { x = d.base.x + dx; w = d.base.w - dx; }
      if (d.dir.indexOf("n") >= 0) { y = d.base.y + dy; h = d.base.h - dy; }
      w = Math.max(16, w); h = Math.max(12, h);
      d.el.style.left = x + "px";
      d.el.style.top = y + "px";
      d.el.style.width = w + "px";
      d.el.style.height = h + "px";
      showGuides(null, null);
    } else if (d.mode === "rotate") {
      const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx);
      let deg = d.baseDeg + ((a - d.startAngle) * 180) / Math.PI;
      deg = Math.round(deg);
      d.el.style.transform = deg ? "rotate(" + deg + "deg)" : "";
      showGuides(null, null);
    }
    updateSelectionBox();
  }

  function onPointerUp() {
    pending = null;
    if (!drag) return;
    const d = drag;
    drag = null;
    showGuides(null, null);
    document.body.style.userSelect = "";
    commit(d.el);
  }

  /* 把当前 style 写回 data-eid-st（作为撤销/保存的快照点） */
  function commit(el) {
    el.setAttribute("data-eid-st", el.getAttribute("style") || "");
    el.setAttribute("data-eid-cls", el.getAttribute("data-eid-cls") || "");
    applyProps(el);
    markDirty();
    refresh();
    updateSelectionBox();
  }

  /* ── 精确微调：方向键 / 面板数字输入 ─────────────────
     放大只是「看得清」，真正要调得准靠这两条。
     坐标一律是**页面坐标系**的 px（未乘缩放），所以缩放多少都不影响输的值。 */

  function moveBlockTo(el, nx, ny) {
    toFreeQuiet(el);                 // 在栅格里也允许，先脱流（和拖动行为一致）
    el.style.left = Math.round(nx) + "px";
    el.style.top = Math.round(ny) + "px";
    el.setAttribute("data-eid-st", el.getAttribute("style") || "");
    markDirty(); refresh(); updateSelectionBox();
  }

  function resizeBlock(el, nw, nh) {
    toFreeQuiet(el);
    if (nw != null) el.style.width = Math.max(1, Math.round(nw)) + "px";
    if (nh != null) el.style.height = Math.max(1, Math.round(nh)) + "px";
    el.setAttribute("data-eid-st", el.getAttribute("style") || "");
    markDirty(); refresh(); updateSelectionBox();
  }

  /* 连续方向键合成一个撤销步：700ms 内不重复压栈 */
  let nudgeTimer = null, nudgeOpen = false;
  function nudge(dx, dy) {
    if (document.body.getAttribute("data-editing") !== "1") return false;
    const el = blockOf(state.selected);
    if (!el) return false;
    if (!nudgeOpen) { pushUndo(); nudgeOpen = true; }
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => { nudgeOpen = false; }, 700);
    const r = boxRect(el);
    moveBlockTo(el, r.x + dx, r.y + dy);
    return true;
  }

  /* ── 层级 ────────────────────────────────────────── */

  function zOf(el) { return parseInt(stGet(el, "z-index") || "10", 10) || 10; }
  function setZ(el, z) {
    stSet(el, "z-index", String(z));
    el.style.zIndex = String(z);
  }
  function layerCmd(cmd) {
    const el = blockOf(state.selected); if (!el) return;
    pushUndo();
    const sibs = $$("[data-eid]").filter((e) => inCanvas(e));
    const zs = sibs.map(zOf);
    if (cmd === "front") setZ(el, Math.max.apply(null, zs.concat([0])) + 1);
    else if (cmd === "back") setZ(el, Math.min.apply(null, zs.concat([0])) - 1);
    else if (cmd === "up") { setZ(el, zOf(el) + 1); normalizeZ(slide()); }
    else if (cmd === "down") { setZ(el, zOf(el) - 1); normalizeZ(slide()); }
    markDirty(); refresh(); updateSelectionBox();
  }
  function normalizeZ(scope) {
    const sibs = $$("[data-eid]", scope).sort((a, b) => zOf(a) - zOf(b));
    sibs.forEach((e, i) => { if (zOf(e) !== i + 1) { stSet(e, "z-index", String(i + 1)); e.style.zIndex = String(i + 1); } });
  }

  /* ── 文字编辑 ────────────────────────────────────── */

  function onDbl(e) {
    let el = e.target.closest(PICKABLE);
    if (!el) {
      if (!e.target.closest("[data-eid-ui]")) return;
      el = state.selected;
    }
    if (!el || el.closest("[data-eid-ui]")) return;
    e.preventDefault(); e.stopPropagation();
    select(el);
    pushUndo();
    el.contentEditable = "true";
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  /* 只改文本，不动元素内部结构。
     el.textContent = x 会把 <h4>/<p> 等子标签冲掉（实测改标题把整个块的结构毁了）。

     改哪个文本节点：
     ① 元素自己就有直接文本（如 <h1>标题<br><span>xx</span></h1>）→ 改它自己的，
        否则用户选 h1 改字却改到里面的 span 上，看着像「改不动」。
     ② 自己没有直接文本（如 .blk 里装着 h4/p）→ 取文本最长的叶子元素。 */
  function setTextPreserving(el, text) {
    const own = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && (n.nodeValue || "").trim());
    if (own) { own.nodeValue = text; return; }

    const leaves = [...el.querySelectorAll("*")].filter((n) =>
      n.children.length === 0 && (n.textContent || "").trim().length > 0
    );
    if (leaves.length) {
      leaves.sort((a, b) => (b.textContent || "").trim().length - (a.textContent || "").trim().length);
      const target = leaves[0];
      const tnode = [...target.childNodes].find((c) => c.nodeType === Node.TEXT_NODE && c.nodeValue.trim());
      if (tnode) { tnode.nodeValue = text; return; }
      target.textContent = text;
      return;
    }
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if ((child.nodeValue || "").trim()) { child.nodeValue = text; return true; }
          continue;
        }
        if (child.nodeType === Node.ELEMENT_NODE && walk(child)) return true;
      }
      return false;
    };
    if (!walk(el)) el.textContent = text;
  }

  function onBlur(e) {
    const el = e.target.closest && e.target.closest("[data-eid]");
    if (!el || el.contentEditable !== "true") return;
    el.contentEditable = "false";
    el.setAttribute("data-eid-text", el.textContent);
    markDirty();
    updateSelectionBox();
  }

  /* ── 属性面板 ────────────────────────────────────── */

  let panel, hud;

  function buildUI() {
    panel = document.createElement("aside");
    panel.setAttribute("data-eid-ui", "");
    panel.id = "__editable_panel";
    panel.innerHTML = `
      <style>
        #__editable_panel{position:fixed;top:0;right:0;width:300px;height:100vh;background:#10100f;color:#e8e6e1;
          font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;z-index:2147483000;display:none;
          border-left:1px solid #2c2c2a;overflow-y:auto;padding:14px 14px 60px;box-sizing:border-box}
        body[data-editing]{padding-right:300px}
        body[data-editing] .slide{width:var(--ed-w,1920px);max-width:none;margin:24px auto;transform-origin:top left;
          transform:scale(var(--ed-scale,1))}
        #__editable_panel h4{margin:16px 0 8px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;
          color:#8b8b84;font-weight:700}
        #__editable_panel h4:first-of-type{margin-top:4px}
        #__editable_panel label{display:block;margin:9px 0 3px;font-size:11px;color:#8b8b84}
        #__editable_panel select,#__editable_panel input[type=text],#__editable_panel input[type=number]{
          width:100%;box-sizing:border-box;background:#1c1c1a;border:1px solid #33332f;color:#e8e6e1;
          padding:6px 7px;border-radius:5px;font:inherit;font-size:12px}
        #__editable_panel input[type=color]{width:100%;height:30px;border:1px solid #33332f;border-radius:5px;background:#1c1c1a;padding:2px}
        #__editable_panel .row{display:flex;gap:6px;margin-bottom:6px}
        #__editable_panel .row>*{flex:1}
        #__editable_panel button{background:#262623;border:1px solid #3a3a35;color:#e8e6e1;padding:7px 6px;
          border-radius:5px;font:inherit;font-size:12px;cursor:pointer;width:100%}
        #__editable_panel button:hover{background:#33332f}
        #__editable_panel button.pri{background:#2f7d4f;border-color:#2f7d4f}
        #__editable_panel .hint{font-size:11px;color:#6f6f68;line-height:1.6}
        #__editable_panel .kv{font-size:11px;color:#b9b7ae;background:#1c1c1a;padding:6px;border-radius:5px;
          word-break:break-all;line-height:1.5}
        #__editable_hud{position:fixed;left:14px;bottom:14px;z-index:2147483001;display:none;gap:6px;
          background:rgba(16,16,15,.94);border:1px solid #33332f;border-radius:8px;padding:7px;align-items:center}
        #__editable_hud button{background:#262623;border:1px solid #3a3a35;color:#e8e6e1;padding:5px 10px;
          border-radius:5px;font:inherit;font-size:12px;cursor:pointer}
        #__editable_hud button.pri{background:#2f7d4f;border-color:#2f7d4f;color:#fff}
        #__editable_hud .tip{font-size:11px;color:#8b8b84;padding-right:4px}
        body[data-editing] [data-eid]{cursor:move;-webkit-user-drag:none}
        body[data-editing] [data-eid]:active{cursor:grabbing}
        body[data-editing] .free-layer [data-eid]{outline:1px dashed rgba(80,150,110,.5);outline-offset:1px}
      </style>
      <div style="font-weight:700;font-size:13px">✎ Editable</div>
      <div class="hint" id="ed_sel">未选中元素</div>
      <h4>文字</h4>
      <label>内容</label>
      <input type="text" id="ed_text">
      <h4>样式</h4>
      <label>颜色</label><input type="color" id="ed_color">
      <label>字号 (px)</label><input type="number" id="ed_fs" step="1">
      <label>粗细</label>
      <select id="ed_w">
        <option value="">继承</option><option value="400">400</option><option value="600">600</option>
        <option value="700">700</option><option value="800">800</option><option value="900">900</option>
      </select>
      <label>对齐</label>
      <select id="ed_align">
        <option value="">继承</option><option value="left">左</option><option value="center">中</option><option value="right">右</option>
      </select>
      <h4>位置与尺寸（页面 px）</h4>
      <div class="row">
        <div style="flex:1"><label style="margin-top:0">X</label><input type="number" id="ed_x" step="1"></div>
        <div style="flex:1"><label style="margin-top:0">Y</label><input type="number" id="ed_y" step="1"></div>
      </div>
      <div class="row">
        <div style="flex:1"><label style="margin-top:0">宽 W</label><input type="number" id="ed_bw" step="1"></div>
        <div style="flex:1"><label style="margin-top:0">高 H</label><input type="number" id="ed_bh" step="1"></div>
      </div>
      <div class="hint" style="margin:2px 0 6px">选中后方向键微调 1px，Shift+方向键 10px</div>
      <div class="kv" id="ed_geom">—</div>
      <h4>层级</h4>
      <div class="row"><button data-z="front">置顶</button><button data-z="up">上移</button></div>
      <div class="row"><button data-z="down">下移</button><button data-z="back">置底</button></div>
      <h4>附加 class</h4>
      <input type="text" id="ed_cls" placeholder="如 accent-blue">
      <h4>操作</h4>
      <div class="row"><button id="ed_undo">撤销</button><button id="ed_redo">重做</button></div>
      <div style="height:6px"></div>
      <button class="pri" id="ed_save">保存到原文件</button>
      <div style="height:6px"></div>
      <div class="row"><button id="ed_save">保存到原文件</button><button id="ed_saveas">另存副本</button><button id="ed_regrid">回到原位</button><button id="ed_reset">清除改动</button></div>
      <div style="height:10px"></div>
      <div class="hint">
        单击选中 · 拖动移动 · 拖角/边改大小 · 顶部圆点旋转 · 双击改文字<br>
        选中后方向键微调 1px（Shift 10px）· 按住空格看 1:1 真实比例<br>
        层级按钮调整前后顺序 · Ctrl+Z 撤销 · Ctrl+S 保存
      </div>`;
    document.body.appendChild(panel);

    hud = document.createElement("div");
    hud.setAttribute("data-eid-ui", "");
    hud.id = "__editable_hud";
    hud.innerHTML = `
      <span class="tip" id="ed_file">${FILE}</span>
      <button id="ed_exit">退出编辑</button>
      <button id="ed_undo2">撤销</button>
      <button id="ed_redo2">重做</button>
      <button class="pri" id="ed_save2">保存 (Ctrl+S)</button>`;
    document.body.appendChild(hud);
  }

  function refresh() {
    const el = state.selected;
    const info = $("#ed_sel");
    if (!el) { if (info) info.textContent = "未选中元素"; return; }
    const blk = blockOf(el);
    const cls = ((el.getAttribute("data-eid-base-cls") || "") + " " + (el.getAttribute("data-eid-cls") || "")).trim();
    info.innerHTML = "已选中：<b>" + el.tagName.toLowerCase() + "</b>" +
      (blk !== el ? " <span style='color:#8b8b84'>（块：" + blk.tagName.toLowerCase() +
        (blk.className ? "." + String(blk.className).split(/\s+/)[0] : "") + "）</span>" : "") +
      (blk.getAttribute("data-free") === "1" ? " <span style='color:#2f9e52'>[自由定位]</span>" : "") +
      "<br><span style='color:#6f6f68'>" + (cls || "(无 class)") + "</span>";
    if ($("#ed_text")) $("#ed_text").value = (el.textContent || "").trim().slice(0, 300);
    const c = stGet(el, "color");
    if ($("#ed_color")) $("#ed_color").value = normHex(c || "#000000");
    if ($("#ed_fs")) $("#ed_fs").value = (stGet(el, "font-size").match(/[\d.]+/) || [""])[0];
    if ($("#ed_w")) $("#ed_w").value = stGet(el, "font-weight");
    if ($("#ed_align")) $("#ed_align").value = stGet(el, "text-align");
    if ($("#ed_cls")) $("#ed_cls").value = el.getAttribute("data-eid-cls") || "";
    const r = boxRect(blk);
    const setN = (id, v) => { const n = $("#" + id); if (n && document.activeElement !== n) n.value = Math.round(v); };
    setN("ed_x", r.x); setN("ed_y", r.y); setN("ed_bw", r.w); setN("ed_bh", r.h);
    if ($("#ed_geom")) {
      $("#ed_geom").textContent = "x " + Math.round(r.x) + " · y " + Math.round(r.y) +
        "  |  w " + Math.round(r.w) + " · h " + Math.round(r.h) + "  |  z " + zOf(blk) +
        (rotationOf(blk) ? "  |  " + Math.round(rotationOf(blk)) + "°" : "") +
        (blk.getAttribute("data-free") === "1" ? "  |  自由定位" : "  |  在栅格（改 X/Y 会自动转自由定位）");
    }
  }
  function normHex(c) {
    c = (c || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map((x) => x + x).join("");
    return "#000000";
  }

  /* ── 保存（写回原文件） ──────────────────────────── */

  function serialize() {
    const clone = document.documentElement.cloneNode(true);
    /* 多页文档在编辑期被包进 #__ed_scope 一起缩放；保存前拆掉，页面回到原来的位置 */
    unwrapScope(clone);
    clone.querySelectorAll("[data-eid-ui]").forEach((n) => n.remove());
    clone.querySelectorAll("#__editable_panel,#__editable_hud,#__editable_overlay,#__editable_sel").forEach((n) => n.remove());
    // 编辑器注入的元信息脚本、以及服务端按 ?edit=1 注入的编辑器本身，都不进交付文件
    clone.querySelectorAll("script[data-ed-inject]").forEach((n) => n.remove());
    clone.querySelectorAll("script").forEach((s) => {
      const t = s.textContent || "";
      if (t.indexOf("__EDIT_FILE__") >= 0 || t.indexOf("__EDIT_SAVE__") >= 0) s.remove();
    });
    clone.removeAttribute("style");
    clone.querySelectorAll("[style]").forEach((n) => {
      if ((n.getAttribute("style") || "").indexOf("--ed-scale") >= 0) n.removeAttribute("style");
    });
    clone.querySelectorAll("[data-eid]").forEach((el) => {
      const c = el.getAttribute("data-eid-cls");
      const s = el.getAttribute("data-eid-st");
      const t = el.getAttribute("data-eid-text");
      const base = (el.getAttribute("data-eid-base-cls") || "").split(/\s+/).filter(Boolean);
      const inc = (c || "").split(/\s+/).filter(Boolean);
      const seen = new Set(), out = [];
      base.concat(inc).forEach((x) => { if (!seen.has(x)) { seen.add(x); out.push(x); } });
      if (out.length) el.setAttribute("class", out.join(" ")); else el.removeAttribute("class");
      if (s && s.trim()) el.setAttribute("style", s.trim()); else el.removeAttribute("style");
      if (t !== null && t !== "") setTextPreserving(el, t);
      ["data-eid", "data-eid-cls", "data-eid-st", "data-eid-base-cls", "data-eid-text",
        "data-eid-parent", "data-eid-next", "data-free", "data-free-parent", "data-sel",
        "draggable", "data-text-dirty", "contenteditable", "data-eid-orig"].forEach((a) => el.removeAttribute(a));
      if (el.hasAttribute("data-ed-layer")) el.removeAttribute("data-ed-layer");
    });
    /* 【不要删 data-drag】
       v5.6 这里写的是：值为空的 data-drag 一律 remove。
       但 README §8 / spec 教作者写的就是**裸的 data-drag** 当拖拽锚点，
       于是作者声明的拖拽标记第一次保存就被当成垃圾删掉，块拖拽退化成按类名猜。
       编辑器自己从不往页面上写 data-drag，所以这里不需要清任何东西。
       （以后若要清，请用 data-ed-drag-added 作标记，别拿「空值」当判据。） */
    clone.querySelectorAll("[data-ed-drag-added]").forEach((el) => {
      el.removeAttribute("data-drag");
      el.removeAttribute("data-ed-drag-added");
    });
    clone.querySelectorAll("[style]").forEach((el) => {
      const st = (el.getAttribute("style") || "").replace(/;{2,}/g, ";").replace(/;\s*$/, "").trim();
      if (st) el.setAttribute("style", st); else el.removeAttribute("style");
    });
    // 非定位元素不该带 z-index；但定位元素（含冻结成 absolute 的）的 z-index 是层序，必须保留
    const layer = clone.querySelector(".free-layer");
    clone.querySelectorAll("[style]").forEach((el) => {
      const st = el.getAttribute("style") || "";
      const positioned = /position\s*:\s*(absolute|fixed|relative)/i.test(st);
      const inLayer = layer && el !== layer && layer.contains(el);
      if (!positioned && !inLayer) {
        const cleaned = st.replace(/z-index\s*:\s*[^;]+;?/g, "").replace(/;{2,}/g, ";").trim();
        if (cleaned) el.setAttribute("style", cleaned); else el.removeAttribute("style");
      }
    });
    // 编辑期的画布痕迹：缩放 transform / transform-origin / 居中 margin /
    // 为定位层临时加的 position:relative —— 全部清掉，交付文件不留编辑痕迹
    clone.querySelectorAll("[data-ed-anchor],[data-ed-anchor-pos],.slide,.page").forEach((el) => {
      let st = el.getAttribute("style") || "";
      st = st
        .replace(/transform\s*:\s*scale\([^)]*\)\s*;?/gi, "")
        .replace(/transform-origin\s*:[^;]+;?/gi, "")
        .replace(/margin-(top|bottom|right|left)\s*:\s*[^;]+;?/gi, "");
      if (el.hasAttribute("data-ed-anchor-pos")) st = st.replace(/position\s*:\s*relative\s*;?/gi, "");
      st = st.replace(/;{2,}/g, ";").replace(/;\s*$/, "").trim();
      if (st) el.setAttribute("style", st); else el.removeAttribute("style");
      el.removeAttribute("data-ed-anchor");
      el.removeAttribute("data-ed-anchor-pos");
    });
    clone.querySelectorAll(".dragging").forEach((n) => n.classList.remove("dragging"));
    clone.querySelectorAll("[data-sel]").forEach((n) => n.removeAttribute("data-sel"));
    clone.querySelectorAll("[data-ed-layer]").forEach((n) => n.removeAttribute("data-ed-layer"));
    const b = clone.querySelector("body");
    if (b) {
      b.removeAttribute("data-editing");
      b.style.removeProperty("padding-right");
      b.style.removeProperty("user-select");
    }
    return "<!DOCTYPE html>\n" + clone.outerHTML;
  }

  /* 服务端注入过的编辑页：去掉查询串就是磁盘上的原文（未注入编辑器那一份） */
  let pristineCache;          // undefined = 未拉取；null = 拉取失败；string = 原文
  async function pristineText() {
    if (pristineCache !== undefined) return pristineCache;
    try {
      const r = await fetch(location.pathname, { cache: "no-store" });
      pristineCache = r.ok ? await r.text() : null;
    } catch (e) { pristineCache = null; }
    return pristineCache;
  }

  /* 两边都过一遍 DOM → 同一序列化器，抹掉「重新序列化」带来的格式差异，只比语义：
     · <html><head> 合并、空行漂移 → 先删掉纯空白文本节点（<pre>/<textarea> 里保留）
     · 裸属性 data-drag vs data-drag="" 、hidden vs hidden="" → 统一按“无值”处理 */
  const BOOL_ATTRS = new Set(["hidden", "disabled", "checked", "selected", "readonly", "required",
    "multiple", "open", "defer", "async", "novalidate", "autofocus", "loop", "muted",
    "autoplay", "controls", "default", "inert", "itemscope", "allowfullscreen", "playsinline"]);
  function canonicalHtml(s) {
    try {
      const d = new DOMParser().parseFromString(s, "text/html");
      const w = d.createTreeWalker(d.documentElement, NodeFilter.SHOW_TEXT);
      const kill = [];
      while (w.nextNode()) {
        const t = w.currentNode;
        if (!/^\s+$/.test(t.nodeValue || "")) continue;
        const p = t.parentNode;
        if (p && p.nodeName && /^(PRE|TEXTAREA|SCRIPT|STYLE)$/.test(p.nodeName)) continue;
        kill.push(t);
      }
      kill.forEach((t) => t.parentNode.removeChild(t));
      d.querySelectorAll("*").forEach((el) => {
        [...el.attributes].forEach((a) => {
          if (a.value !== "") return;
          const n = a.name.toLowerCase();
          if (BOOL_ATTRS.has(n) || n.indexOf("data-") === 0) el.removeAttribute(a.name);
        });
      });
      /* 服务端会把 __EDIT_FILE__ 元信息脚本注入进每一份 HTML（不只是 ?edit=1），
         比对前必须把那一段去掉，否则“没改过”也会被当成改过。 */
      d.querySelectorAll("script").forEach((s) => {
        const t = s.textContent || "";
        if (s.hasAttribute("data-ed-inject") || t.indexOf("__EDIT_FILE__") >= 0 ||
            t.indexOf("__EDIT_SAVE__") >= 0 || t.indexOf("__EDIT_LIST__") >= 0) s.remove();
      });
      return "<!DOCTYPE html>\n" + d.documentElement.outerHTML;
    } catch (e) { return s; }
  }

  /* 保存：只有「内容真的变了」才写盘。
     以前无论改没改都把整页重新序列化一遍送回服务端，于是：
       ① 只放大看看、顺手点保存 → 文件被改写（3135 → 3101 bytes）
       ② 连点两次保存 → 字节继续漂（行数 73 → 74），git diff 永远是脏的
     现在用「原文 vs 当前页面」的语义比对做门控；写成功后把当前内容当成新基准，
     于是再点一百次保存也是幂等的。force=true 可绕过（外部脚本/验收用）。 */
  async function save(force) {
    const btn = $("#ed_save") || $("#ed_save2");
    const old = btn ? btn.textContent : "";
    try {
      const content = serialize();
      const base = await pristineText();
      if (!force && base != null && canonicalHtml(base) === canonicalHtml(content)) {
        state.dirty = false;
        notifyParent({ type: "saved", value: { ok: true, skipped: true } });
        toast("没有实质改动，未写盘");
        if (btn) btn.textContent = old;
        return;
      }
      if (btn) btn.textContent = "保存中…";
      const res = await fetch(API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: FILE, content: content }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "save failed");
      state.dirty = false;
      pristineCache = content;   /* 新基准：再点保存就命中「无改动」分支 */
      notifyParent({ type: "saved", value: j });
      toast("已保存到 " + j.path + "（" + j.bytes + " bytes）");
    } catch (e) {
      toast("保存失败：" + e.message);
    }
    if (btn) btn.textContent = old;
  }
  /* 另存副本：内容送到 /__saveas，由服务端弹「另存为」对话框（或写到指定路径）
     —— 主文件不动，工作台当前编辑的还是原文件 */
  async function saveAs(opts) {
    const btn = $("#ed_saveas");
    const old = btn ? btn.textContent : "";
    try {
      if (btn) btn.textContent = "选择位置…";
      const content = serialize();
      const res = await fetch(API_BASE + "/__saveas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ from: FILE, content: content }, opts || {})),
      });
      const j = await res.json();
      if (!j.ok) {
        if (j.canceled) toast("已取消另存");
        else toast("另存失败：" + (j.error || "未知错误"));
        notifyParent({ type: "savedas", value: j });
        return j;
      }
      // 另存不改基准：主文件的「有没有改动」状态不变
      notifyParent({ type: "savedas", value: j });
      toast("已另存副本：" + j.path + "（" + j.bytes + " bytes）");
      return j;
    } catch (e) {
      toast("另存失败：" + e.message);
      return { ok: false, error: e.message };
    } finally {
      if (btn) btn.textContent = old;
    }
  }

  function toast(msg) {
    let t = $("#ed_toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "ed_toast";
      t.setAttribute("data-eid-ui", "");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:70px;z-index:2147483002;" +
      "background:#1c1c1a;color:#e8e6e1;padding:9px 16px;border-radius:7px;" +
      "font:13px -apple-system,\"PingFang SC\",\"Microsoft YaHei\",\"Noto Sans SC\",sans-serif;" +
      "border:1px solid #33332f;box-shadow:0 6px 24px rgba(0,0,0,.35)";
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 2200);
    t.style.opacity = "1";
  }

  /* 按住空格的提示条（只存在于编辑期，序列化时被 [data-eid-ui] 一并清掉） */
  function showSpaceBadge(on) {
    let b = $("#ed_spacebadge");
    if (!on) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement("div");
      b.id = "ed_spacebadge";
      b.setAttribute("data-eid-ui", "");
      document.body.appendChild(b);
    }
    b.textContent = "1:1 真实比例（松开空格恢复）";
    b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:14px;z-index:2147483002;" +
      "background:#1c1c1a;color:#e8e6e1;padding:7px 14px;border-radius:7px;" +
      "font:12px -apple-system,\"PingFang SC\",\"Microsoft YaHei\",\"Noto Sans SC\",sans-serif;" +
      "border:1px solid #33332f;box-shadow:0 6px 24px rgba(0,0,0,.35)";
  }

  /* 与外壳（studio.html / index.html）通信 */
  function notifyParent(msg) {
    try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, "*"); } catch (e) {}
  }
  window.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "save") save();
    if (m.type === "undo") undo();
    if (m.type === "redo") redo();
    if (m.type === "zoomBy") setZoom(state.userZoom * (m.value || 1));
    if (m.type === "zoomSet") setZoom(m.value);
    if (m.type === "zoomFit") setZoom(1);
  });

  /* ── 绑定 ────────────────────────────────────────── */

  function bindUI() {
    const on = (id, ev, fn) => { const n = $("#" + id); if (n) n.addEventListener(ev, fn); };
    let textDirty = false;
    on("ed_text", "input", (e) => {
      const el = state.selected; if (!el) return;
      if (!textDirty) { pushUndo(); textDirty = true; }
      setTextPreserving(el, e.target.value);
      el.setAttribute("data-eid-text", e.target.value);
      markDirty();
      updateSelectionBox();
      setTimeout(() => { textDirty = false; }, 800);
    });
    on("ed_color", "input", (e) => { const el = state.selected; if (el) { pushUndo(); stSet(el, "color", e.target.value); markDirty(); } });
    on("ed_fs", "change", (e) => { const el = state.selected; if (el) { pushUndo(); stSet(el, "font-size", e.target.value + "px"); markDirty(); updateSelectionBox(); } });
    on("ed_w", "change", (e) => { const el = state.selected; if (el) { pushUndo(); stSet(el, "font-weight", e.target.value); markDirty(); } });
    on("ed_align", "change", (e) => { const el = state.selected; if (el) { pushUndo(); stSet(el, "text-align", e.target.value); markDirty(); } });
    on("ed_cls", "change", (e) => {
      const el = state.selected; if (!el) return;
      pushUndo();
      el.setAttribute("data-eid-cls", e.target.value);
      applyProps(el); markDirty(); refresh(); updateSelectionBox();
    });

    /* 位置与尺寸：直接输数值落位（页面坐标 px，与缩放无关） */
    const geom = (id, apply) => on(id, "change", (e) => {
      const el = blockOf(state.selected); if (!el) return;
      const v = parseFloat(e.target.value);
      if (!isFinite(v)) { refresh(); return; }
      pushUndo();
      apply(el, v);
    });
    geom("ed_x", (el, v) => { const r = boxRect(el); moveBlockTo(el, v, r.y); });
    geom("ed_y", (el, v) => { const r = boxRect(el); moveBlockTo(el, r.x, v); });
    geom("ed_bw", (el, v) => resizeBlock(el, v, null));
    geom("ed_bh", (el, v) => resizeBlock(el, null, v));
    $$("[data-z]").forEach((b) => b.addEventListener("click", () => layerCmd(b.dataset.z)));
    on("ed_undo", "click", undo); on("ed_redo", "click", redo);
    on("ed_undo2", "click", undo); on("ed_redo2", "click", redo);
    /* 注意：不能直接 bind save——事件对象会被当成 force 参数传进去，
       结果「没改动也写盘」的门控被绕过了。 */
    on("ed_save", "click", () => save());
    on("ed_save2", "click", () => save());
    on("ed_saveas", "click", () => saveAs());

    /* 回到栅格：真正把元素放回原来的父节点与原位置（不能只清 style） */
    /* 回到原位：把自由定位的元素放回它原来的父容器 + 原来的绝对坐标（PPT 里的“复位”） */
    on("ed_regrid", "click", () => {
      const el = blockOf(state.selected); if (!el) return;
      if (el.getAttribute("data-free") !== "1") { toast("这个元素本来就在原位"); return; }
      pushUndo();
      const pp = el.getAttribute("data-eid-parent");
      const nid = el.getAttribute("data-eid-next");
      const orig = (el.getAttribute("data-eid-orig") || "").split("|").map(Number);
      el.removeAttribute("data-free");
      el.style.zIndex = "";
      el.removeAttribute("data-eid-parent");
      el.removeAttribute("data-eid-next");
      backToGrid(el, pp, nid);
      if (orig.length === 4 && !isNaN(orig[0])) {
        // 没经历过画布锁定的页面（比如旧文件）就清掉手写的位置，回到流里
        setFrozen(el, orig[0], orig[1], orig[2], orig[3]);
      } else {
        el.style.position = ""; el.style.left = ""; el.style.top = "";
        el.style.width = ""; el.style.height = ""; el.style.margin = ""; el.style.boxSizing = "";
        el.setAttribute("data-eid-st", "");
        applyProps(el);
      }
      markDirty(); refresh(); updateSelectionBox();
      toast("已放回原来的位置");
    });

    on("ed_reset", "click", () => {
      if (!confirm("放弃本页所有未保存的编辑改动？")) return;
      location.reload();
    });
    on("ed_exit", "click", () => {
      if (window.parent && window.parent !== window) { notifyParent({ type: "exit" }); return; }
      location.href = location.pathname;
    });
  }

  function toggle(on) {
    document.body.setAttribute("data-editing", on ? "1" : "0");
    if (panel) panel.style.display = on ? "block" : "none";
    if (hud) hud.style.display = on && !EMBEDDED ? "flex" : "none";
    const ov = document.getElementById("__editable_overlay");
    if (ov) ov.style.display = on ? "" : "none";
    if (on) {
      assignIds();
      fitCanvas();
      /* 画布锁定：把整页按当前位置冻成绝对坐标 → 拖任何元素都不会引起重排（PPT 式操作） */
      freezeLayout();
      refresh();
      updateSelectionBox();
    } else {
      drag = null; pending = null;
      $$("[data-eid]").forEach((el) => el.removeAttribute("data-sel"));
      state.selected = null;
      /* 退出编辑时把画布解冻，页面回到原始样式（除非已经保存） */
      restoreFrozen();
      $$("[data-ed-anchor], .slide, .page").forEach((s) => {
        s.style.marginTop = ""; s.style.marginBottom = ""; s.style.marginRight = "";
        s.style.transform = ""; s.style.transformOrigin = "";
        if (s.hasAttribute("data-ed-anchor-pos")) {
          s.style.position = "";
          s.removeAttribute("data-ed-anchor-pos");
        }
        s.removeAttribute("data-ed-anchor");
      });
      unwrapScope(document);
      document.documentElement.style.removeProperty("--ed-scale");
    }
  }

  /* ── 启动 ────────────────────────────────────────── */

  function init() {
    assignIds();
    /* 记住画布「自己的」尺寸：编辑模式会强制 .slide 到 1920×1080（deck 预设），
       但任意页面（比如宽 1280 的普通页）不应该被改形。所以先量下自然尺寸写进 CSS 变量，
       编辑期用的是 var(--ed-w) 而不是写死的 1920。 */
    try {
      const s = slide();
      if (s && s.offsetWidth) {
        s.style.setProperty("--ed-w", s.offsetWidth + "px");
        s.style.setProperty("--ed-h", s.offsetHeight + "px");
      }
    } catch (e) {}
    buildUI();
    bindUI();

    // 捕获阶段：选中；越过阈值才真正开始拖动（单击选中、双击改字都不受影响）
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);

    document.addEventListener("dblclick", onDbl, true);
    document.addEventListener("blur", onBlur, true);
    /* Ctrl/⌘ + 滚轮、触控板双指捏合（Chrome 里会以 ctrlKey=true 的 wheel 出现）：
       只缩放画布页面本身，不触发浏览器缩放。按滚轮力度换算，手感更连续。 */
    document.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const d = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      const factor = Math.max(0.8, Math.min(1.25, Math.pow(1.0015, -d)));
      setZoom(state.userZoom * factor);
    }, { passive: false });
    document.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName) || "";
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault(); e.shiftKey ? redo() : undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault(); save();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault(); setZoom(state.userZoom * 1.2);
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "-" || e.key === "_")) {
        e.preventDefault(); setZoom(state.userZoom / 1.2);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault(); setZoom(1);
      } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey &&
                 (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        /* 方向键微调：1px；Shift 10px。缩放多少都按页面坐标走 */
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (nudge(dx, dy)) e.preventDefault();
      } else if (!typing && (e.code === "Space" || e.key === " ")) {
        /* 按住空格：临时回 1:1 真实比例，松开恢复（看真实大小/校对字号用） */
        if (zoomOverride != null) return;
        e.preventDefault();
        zoomOverride = 1;
        fitCanvas();
        showSpaceBadge(true);
      } else if (e.key === "Escape") {
        if (document.body.getAttribute("data-editing") === "1") select(null);
        notifyParent({ type: "exit" });
      }
    });
    document.addEventListener("keyup", (e) => {
      if ((e.code === "Space" || e.key === " ") && zoomOverride != null) {
        zoomOverride = null;
        fitCanvas();
        showSpaceBadge(false);
      }
    });
    window.addEventListener("resize", () => { fitCanvas(); refresh(); });

    toggle(true);
    notifyParent({ type: "ready", file: FILE });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  /* 对外 API（外壳可调用） */
  window.__editableAPI = {
    serialize: serialize,
    save: save,
    saveAs: saveAs,
    /* 调试/验收用：看“保存门控”两边到底差在哪 */
    canonicalHtml: canonicalHtml,
    pristineText: pristineText,
    undo: undo,
    redo: redo,
    isDirty: () => state.dirty,
    file: FILE,
    refresh: () => { refresh(); updateSelectionBox(); },
    select: (el) => select(el),
    /* 层序：front / back / up / down（需先 select） */
    layer: (cmd) => layerCmd(cmd),
    /* 调试用：返回编辑器内部状态 */
    debug: () => {
      const blk = state.selected ? blockOf(state.selected) : null;
      return {
        editing: document.body.getAttribute("data-editing") === "1",
        scale: state.scale || 1,
        userZoom: state.userZoom || 1,
        selected: state.selected ? (state.selected.className || state.selected.tagName) : null,
        block: blk ? (blk.className || blk.tagName) : null,
        free: blk ? blk.getAttribute("data-free") : null,
        dragMode: drag ? drag.mode : null,
        dirty: state.dirty,
        undoDepth: state.undo.length,
        handles: Object.keys(handles).length,
        overlay: !!document.getElementById("__editable_overlay"),
      };
    },
  };
})();
