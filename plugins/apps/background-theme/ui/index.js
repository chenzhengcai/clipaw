/**
 * Background Theme - frontend (runtime-loaded plugin module).
 *
 * Loaded by the host via usePluginLoader (same-origin Blob URL + dynamic
 * import). No bundler: React and antd come from window.QwenPaw.host.
 *
 * What it does:
 * 1. Registers a "背景设置 / Background" menu entry under the sidebar
 *    Settings group + a /background-settings route with the settings page.
 * 2. Runtime background engine (runs on every page):
 *    - global background: fixed media layer behind the whole Console,
 *      layout surfaces made transparent while active
 *    - chat background: media layer injected under the chat conversation
 *      area (targets the hashed CSS-module class via attribute selector)
 * 3. Settings page: upload images/videos, browse the background library
 *    (history), apply to either slot, adjust fit / dim / blur, delete files.
 *
 * Media files are stored by the plugin backend and served via the public
 * plugin static route (/api/frontend_plugin/background-theme/files/...),
 * so <img>/<video> src URLs need no auth headers and videos stream with
 * Range support.
 */
(() => {
  const QwenPaw = window.QwenPaw;
  if (!QwenPaw || !QwenPaw.host || !QwenPaw.menu || !QwenPaw.route) {
    console.error("[background-theme] window.QwenPaw not ready - cannot register.");
    return;
  }
  if (window.__QWP_BG_THEME_LOADED__) {
    return; // idempotent across hot reloads
  }
  window.__QWP_BG_THEME_LOADED__ = true;

  const host = QwenPaw.host;
  const { React, antd, antdIcons } = host;
  const h = React.createElement;

  const PLUGIN_ID = "background-theme";
  const EVENT_CHANGED = "qwp-bg-config-changed";
  const GLOBAL_LAYER_ID = "qwp-bg-global-layer";
  const STYLE_ID = "qwp-bg-styles";
  const CHAT_LAYER_CLASS = "qwp-chat-bg-layer";
  const CHAT_HOST_SELECTOR = '[class*="__chatMainArea__"]';

  // ── i18n (lightweight, zh/en) ────────────────────────────────────────

  function currentLang() {
    try {
      const saved = localStorage.getItem("language");
      if (saved) return saved;
    } catch { /* ignore */ }
    return (navigator && navigator.language) || "zh";
  }

  function isZh() {
    return currentLang().toLowerCase().indexOf("zh") === 0;
  }

  const STRINGS = {
    menuLabel: { zh: "背景设置", en: "Background" },
    pageTitle: { zh: "背景设置", en: "Background Settings" },
    pageDesc: {
      zh: "为整个软件和聊天对话区域设置图片或动态视频背景。",
      en: "Set an image or video background for the whole app and the chat dialog.",
    },
    enableSwitch: { zh: "启用背景", en: "Enable background" },
    enableHint: {
      zh: "背景功能当前已关闭,打开右上角开关后生效。",
      en: "Backgrounds are OFF - flip the switch above to activate.",
    },
    globalTitle: { zh: "全局背景", en: "Global Background" },
    globalDesc: {
      zh: "替换整个软件底面,所有页面共用。",
      en: "Replaces the whole app surface, shared by all pages.",
    },
    chatTitle: { zh: "聊天对话背景", en: "Chat Dialog Background" },
    chatDesc: {
      zh: "替换聊天对话区域的底面。",
      en: "Replaces the chat conversation surface.",
    },
    notSet: { zh: "未设置背景", en: "No background set" },
    library: { zh: "历史背景", en: "Background Library" },
    libraryEmpty: {
      zh: "还没有上传过背景,点击上方按钮上传图片或视频。",
      en: "Nothing uploaded yet - add an image or video with the button above.",
    },
    upload: { zh: "上传图片 / 视频", en: "Upload image / video" },
    uploadOk: { zh: "背景已上传并应用", en: "Uploaded and applied" },
    clear: { zh: "清除背景", en: "Clear background" },
    cleared: { zh: "背景已清除", en: "Background cleared" },
    applied: { zh: "背景已应用", en: "Background applied" },
    inUse: { zh: "使用中", en: "In use" },
    fit: { zh: "显示方式", en: "Fit" },
    fitCover: { zh: "铺满", en: "Cover" },
    fitContain: { zh: "完整显示", en: "Contain" },
    fitFill: { zh: "拉伸", en: "Stretch" },
    dim: { zh: "遮罩浓度", en: "Dim" },
    blur: { zh: "背景模糊", en: "Blur" },
    opacity: { zh: "背景透明度", en: "Opacity" },
    delete: { zh: "删除", en: "Delete" },
    deleteConfirm: {
      zh: "删除这个背景文件?使用它的位置会被清除。",
      en: "Delete this file? Slots using it will be cleared.",
    },
    deleted: { zh: "已删除", en: "Deleted" },
    image: { zh: "图片", en: "Image" },
    video: { zh: "视频", en: "Video" },
    color: { zh: "纯色", en: "Solid" },
    colorSection: { zh: "纯色背景", en: "Solid Color" },
    colorPresets: { zh: "推荐色", en: "Suggested" },
    colorCustom: { zh: "自定义颜色", en: "Custom" },
    colorHint: {
      zh: "点击推荐色或自定义颜色,立即设为聊天背景。",
      en: "Pick a suggested color or any RGB value to apply instantly.",
    },
    loadFail: {
      zh: "背景服务加载失败,请确认插件已启用。",
      en: "Background service unavailable - check the plugin is enabled.",
    },
  };

  const t = (key) => {
    const entry = STRINGS[key];
    if (!entry) return key;
    return isZh() ? entry.zh : entry.en;
  };

  const fmtSize = (bytes) => {
    if (bytes == null) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ── API helpers ────────────────────────────────────────────────────────

  function apiFetch(path, opts = {}) {
    const url = host.getApiUrl(path);
    const token = host.getApiToken ? host.getApiToken() : "";
    const headers = opts.headers || {};
    if (opts.body && !(opts.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body,
    }).then((res) => {
      if (!res.ok) {
        return res.text().catch(() => "").then((txt) => {
          throw new Error(txt || `HTTP ${res.status}`);
        });
      }
      return res.status === 204 ? null : res.json();
    });
  }

  /**
   * Backend returns /api-prefixed media URLs served by the plugin's own
   * auth-protected router. <img>/<video> cannot send an Authorization
   * header, so append the token as a query param (Console auth supports
   * `?token=`).
   */
  const mediaUrl = (u) => {
    if (!u) return u;
    let url = (host.apiBaseUrl || "") + u;
    const token = host.getApiToken ? host.getApiToken() : "";
    if (token) {
      url += (url.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(token);
    }
    return url;
  };

  const getConfig = () => apiFetch(`/${PLUGIN_ID}/config`);
  const putConfig = (slot, background) =>
    apiFetch(`/${PLUGIN_ID}/config`, {
      method: "PUT",
      body: JSON.stringify({ slot, background }),
    });
  const putEnabled = (enabled) =>
    apiFetch(`/${PLUGIN_ID}/enabled`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
  const getLibrary = () => apiFetch(`/${PLUGIN_ID}/library`);
  const uploadLibrary = (file) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return apiFetch(`/${PLUGIN_ID}/library`, { method: "POST", body: fd });
  };
  const deleteLibrary = (name) =>
    apiFetch(`/${PLUGIN_ID}/library/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });

  // ── Runtime: background engine ─────────────────────────────────────────

  const runtime = {
    chatSpec: null,
    chatObserver: null,
    chatRafPending: false,
  };

  const STYLE_CSS = `
/* ── Global background active: make surfaces transparent ── */
html.qwp-bg-global-on, html.qwp-bg-global-on body { background: transparent !important; }
body.qwp-bg-global-on .ant-layout, body.qwp-bg-global-on .qwenpaw-layout,
body.qwp-bg-global-on .ant-layout-content, body.qwp-bg-global-on .qwenpaw-layout-content { background: transparent !important; }
/* Header / Sider: the running app uses the qwenpaw- antd prefix plus
   hashed module classes (index-module__header__* / __sider__*) - cover
   both prefixes so the background shows through. */
body.qwp-bg-global-on .qwenpaw-layout-header, body.qwp-bg-global-on .ant-layout-header,
body.qwp-bg-global-on [class*='index-module__header__'] { background: transparent !important; }
body.qwp-bg-global-on .qwenpaw-layout-sider, body.qwp-bg-global-on .ant-layout-sider,
body.qwp-bg-global-on [class*='index-module__sider__'] { background: transparent !important; }
body.qwp-bg-global-on .page-container { background: transparent !important; }
body.qwp-bg-global-on .page-content { background: transparent !important; border-color: transparent !important; }
body.qwp-bg-global-on #root { background: transparent !important; }
/* Chat input wrapper: solid surface removed while the plugin is on so
   the chat/global background shows through behind the input area. */
body.qwp-bg-enabled .qwenpaw-chat-anywhere-input-wrapper,
body.qwp-bg-enabled [class*="chat-anywhere-input-wrapper"] {
  background: transparent !important;
}
/* Chat surfaces: clear their opaque backgrounds so the global background
   image shows through the conversation window. Covers the layout container,
   bubble list wrapper, input bar, and welcome card. Use html+body.qwp-bg-global-on
   prefix for enough specificity to override dark-mode and purple-theme rules. */
html.qwp-bg-global-on body.qwp-bg-global-on .qwenpaw-chat-anywhere-layout { background: transparent !important; }
html.qwp-bg-global-on body.qwp-bg-global-on .qwenpaw-bubble-list-wrapper,
html.qwp-bg-global-on body.qwp-bg-global-on .qwenpaw-chat-anywhere-input,
html.qwp-bg-global-on body.qwp-bg-global-on .qwenpaw-chat-anywhere-message-list-welcome { background: transparent !important; }
/* Chat background WITHOUT the global one: the host themes (layout.css and
   purple/overrides.css) give the chat-area surfaces opaque !important
   backgrounds and only relax them under body.qwp-bg-global-on. Scoped to
   the chat host that actually carries the background layer
   (.qwp-chat-bg-on on [class*="__chatMainArea__"]), so a chat-only
   background is visible too. The "html body" prefix keeps specificity
   above the dark-mode and purple-theme !important rules. */
html body ${CHAT_HOST_SELECTOR}.qwp-chat-bg-on .qwenpaw-chat-anywhere-layout,
html body ${CHAT_HOST_SELECTOR}.qwp-chat-bg-on .qwenpaw-bubble-list-wrapper,
html body ${CHAT_HOST_SELECTOR}.qwp-chat-bg-on .qwenpaw-chat-anywhere,
html body ${CHAT_HOST_SELECTOR}.qwp-chat-bg-on .qwenpaw-chat-anywhere-message-list,
html body ${CHAT_HOST_SELECTOR}.qwp-chat-bg-on .qwenpaw-chat-anywhere-message-list-welcome,
html body ${CHAT_HOST_SELECTOR}.qwp-chat-bg-on .qwenpaw-chat-anywhere-welcome-default,
html body ${CHAT_HOST_SELECTOR}.qwp-chat-bg-on .qwenpaw-chat-anywhere-input,
html body ${CHAT_HOST_SELECTOR}.qwp-chat-bg-on [class*="chat-anywhere-input"],
html body ${CHAT_HOST_SELECTOR}.qwp-chat-bg-on [class*="qwenpaw-chat-anywhere-default-footer"],
html body ${CHAT_HOST_SELECTOR}.qwp-chat-bg-on [class*="chat-anywhere-footer"] {
  background: transparent !important;
}
/* Sidebar section cards: consistent frosted glass so the menus stay
   readable (and pretty) floating over any background. Same tint, blur
   and border for agentScopedSection / settingsSection /
   collapseToggleContainer. */
body.qwp-bg-global-on [class*='agentScopedSection'],
body.qwp-bg-global-on [class*='settingsSection'] {
  background: rgba(255, 255, 255, 0.62) !important;
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.55) !important;
  border-radius: 12px;
}
/* Collapse toggle: same frosted card as the sections above - full
   rounded corners and inset width (override the host's full-bleed
   negative-margin bar, incl. the collapsed-mode variant). */
body.qwp-bg-global-on [class*='collapseToggleContainer'] {
  background: rgba(255, 255, 255, 0.62) !important;
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.55) !important;
  border-radius: 12px !important;
  box-sizing: border-box;
  width: 100% !important;
  margin: 8px 0 0 !important;
}
html.dark-mode body.qwp-bg-global-on [class*='agentScopedSection'],
html.dark-mode body.qwp-bg-global-on [class*='settingsSection'] {
  background: rgba(16, 16, 20, 0.62) !important;
  border: 1px solid rgba(255, 255, 255, 0.09) !important;
}
html.dark-mode body.qwp-bg-global-on [class*='collapseToggleContainer'] {
  background: rgba(16, 16, 20, 0.62) !important;
  border: 1px solid rgba(255, 255, 255, 0.09) !important;
}
/* ── Global media layer ── */
#${GLOBAL_LAYER_ID} { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
#${GLOBAL_LAYER_ID} .qwp-bg-media { width: 100%; height: 100%; object-fit: var(--qwp-fit, cover); display: block; }
#${GLOBAL_LAYER_ID} .qwp-bg-overlay { position: absolute; inset: 0; background: rgba(249,248,244,var(--qwp-dim,0)); }
html.dark-mode #${GLOBAL_LAYER_ID} .qwp-bg-overlay { background: rgba(10,10,14,var(--qwp-dim,0)); }
/* ── Chat background active ── */
${CHAT_HOST_SELECTOR}.qwp-chat-bg-on { position: relative !important; }
${CHAT_HOST_SELECTOR}.qwp-chat-bg-on > *:not(.${CHAT_LAYER_CLASS}) { position: relative; z-index: 1; }
.${CHAT_LAYER_CLASS} { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.${CHAT_LAYER_CLASS} .qwp-bg-media { width: 100%; height: 100%; object-fit: var(--qwp-fit, cover); display: block; }
.${CHAT_LAYER_CLASS} .qwp-bg-overlay { position: absolute; inset: 0; background: rgba(255,255,255,var(--qwp-dim,0)); }
html.dark-mode .${CHAT_LAYER_CLASS} .qwp-bg-overlay { background: rgba(10,10,14,var(--qwp-dim,0)); }
`;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = STYLE_CSS;
    document.head.appendChild(el);
  }

  /** Create (or reuse) an <img>/<video>/solid-color element for a spec. */
  function buildMediaEl(spec, existing) {
    // Solid color: a plain colored div (no media file, no blur/fit).
    if (spec.type === "color") {
      let el = existing;
      if (
        !el ||
        el.tagName.toLowerCase() !== "div" ||
        !el.classList.contains("qwp-bg-color") ||
        el.getAttribute("data-bg-color") !== (spec.color || "")
      ) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
        el = document.createElement("div");
        el.className = "qwp-bg-media qwp-bg-color";
        el.setAttribute("data-bg-color", spec.color || "");
      }
      el.style.background = spec.color || "#ffffff";
      return el;
    }
    const url = mediaUrl(spec.url);
    const tag = spec.type === "video" ? "video" : "img";
    let el = existing;
    if (
      !el ||
      el.tagName.toLowerCase() !== tag ||
      el.getAttribute("data-bg-file") !== spec.file
    ) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      el = document.createElement(tag);
      el.className = "qwp-bg-media";
      el.setAttribute("data-bg-file", spec.file || "");
      if (url) el.src = url;
      if (tag === "video") {
        el.muted = true;
        el.loop = true;
        el.autoplay = true;
        el.setAttribute("playsinline", "");
        el.play().catch(() => { /* autoplay guard */ });
      }
    } else if (el.src !== url && url) {
      el.src = url;
      if (tag === "video") el.play().catch(() => { /* ignore */ });
    }
    el.style.objectFit = spec.fit || "cover";
    const blur = Number(spec.blur) || 0;
    el.style.filter = blur > 0 ? `blur(${blur}px)` : "";
    el.style.transform = blur > 0 ? "scale(1.04)" : "";
    return el;
  }

  /** Fill a layer div (media + optional dim overlay) from a spec. */
  function fillLayer(layer, spec) {
    layer.style.setProperty("--qwp-fit", spec.fit || "cover");
    layer.style.setProperty(
      "--qwp-dim",
      String(spec.dim == null ? 0.35 : spec.dim),
    );
    // Background transparency: 1 = fully opaque, <1 lets the surface below
    // (global background / page) show through.
    layer.style.opacity = String(spec.opacity == null ? 1 : spec.opacity);
    const media = layer.querySelector(".qwp-bg-media");
    const next = buildMediaEl(spec, media);
    if (!next.parentNode) layer.insertBefore(next, layer.firstChild);
    if (spec.type === "color") {
      // Solid color: render exactly what was picked - no dim overlay.
      const ov = layer.querySelector(".qwp-bg-overlay");
      if (ov) ov.parentNode.removeChild(ov);
      return;
    }
    let overlay = layer.querySelector(".qwp-bg-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "qwp-bg-overlay";
      layer.appendChild(overlay);
    }
  }

  function clearLayer(layer) {
    if (!layer) return;
    const media = layer.querySelector(".qwp-bg-media");
    if (media) {
      if (media.pause) media.pause();
      media.removeAttribute("src");
      if (media.load) media.load();
      if (media.parentNode) media.parentNode.removeChild(media);
    }
  }

  // ── Global slot ────────────────────────────────────────────────────────

  function applyGlobal(spec) {
    const html = document.documentElement;
    const body = document.body;
    const existing = document.getElementById(GLOBAL_LAYER_ID);
    if (!spec || !spec.type || (!spec.url && spec.type !== "color")) {
      html.classList.remove("qwp-bg-global-on");
      body.classList.remove("qwp-bg-global-on");
      if (existing) {
        clearLayer(existing);
        existing.parentNode.removeChild(existing);
      }
      return;
    }
    ensureStyle();
    html.classList.add("qwp-bg-global-on");
    body.classList.add("qwp-bg-global-on");
    let layer = existing;
    if (!layer) {
      layer = document.createElement("div");
      layer.id = GLOBAL_LAYER_ID;
      body.appendChild(layer);
    }
    fillLayer(layer, spec);
  }

  // ── Chat slot ──────────────────────────────────────────────────────────

  function eachChatHost(fn) {
    document.querySelectorAll(CHAT_HOST_SELECTOR).forEach(fn);
  }

  function applyChatToHost(node, spec) {
    const layer = node.querySelector(`:scope > .${CHAT_LAYER_CLASS}`);
    if (!spec || !spec.type || (!spec.url && spec.type !== "color")) {
      node.classList.remove("qwp-chat-bg-on");
      if (layer) {
        clearLayer(layer);
        layer.parentNode.removeChild(layer);
      }
      return;
    }
    ensureStyle();
    node.classList.add("qwp-chat-bg-on");
    let el = layer;
    if (!el) {
      el = document.createElement("div");
      el.className = CHAT_LAYER_CLASS;
      node.insertBefore(el, node.firstChild);
    }
    fillLayer(el, spec);
  }

  function applyChat(spec) {
    runtime.chatSpec = spec;
    eachChatHost((node) => applyChatToHost(node, spec));
    if (spec && spec.type) {
      startChatObserver();
    } else {
      stopChatObserver();
    }
  }

  function startChatObserver() {
    if (runtime.chatObserver || !document.body) return;
    runtime.chatObserver = new MutationObserver(() => {
      if (runtime.chatRafPending) return;
      runtime.chatRafPending = true;
      requestAnimationFrame(() => {
        runtime.chatRafPending = false;
        const spec = runtime.chatSpec;
        if (!spec || !spec.type) return;
        eachChatHost((node) => {
          if (!node.querySelector(`:scope > .${CHAT_LAYER_CLASS}`)) {
            applyChatToHost(node, spec);
          }
        });
      });
    });
    runtime.chatObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function stopChatObserver() {
    if (runtime.chatObserver) {
      runtime.chatObserver.disconnect();
      runtime.chatObserver = null;
    }
  }

  function applyConfig(cfg) {
    if (!cfg || !cfg.slots) return;
    // Master switch marks the body so plugin-scoped CSS (transparent
    // surfaces, chat input wrapper, …) applies exactly while enabled.
    const enabled = cfg.enabled === true;
    document.body.classList.toggle("qwp-bg-enabled", enabled);
    // Master switch OFF -> strip every layer / class (original UI restored).
    if (!enabled) {
      applyGlobal(null);
      applyChat(null);
      return;
    }
    applyGlobal(cfg.slots.global);
    applyChat(cfg.slots.chat);
  }

  function loadAndApply() {
    return getConfig()
      .then((cfg) => {
        applyConfig(cfg);
        return cfg;
      })
      .catch((err) => {
        console.warn(
          "[background-theme] config load failed:",
          err && err.message,
        );
        return null;
      });
  }

  window.addEventListener(EVENT_CHANGED, () => loadAndApply());

  // ── Settings page ──────────────────────────────────────────────────────

  const { Card, Button, Select, Slider, Popconfirm, Spin, Empty, Tag, Alert, Upload, Switch, ColorPicker, message } = antd;

  // 5 suggested solid colors - soft, elegant tones that keep chat text
  // readable (light neutrals: cream / misty blue-grey / sage / blush / oat).
  const PRESET_COLORS = [
    "#F7F3EE", // 奶油白 cream
    "#E4E9EC", // 雾灰蓝 misty blue-grey
    "#DEE5DA", // 鼠尾草绿 sage
    "#F4EAE3", // 杏粉 blush
    "#E8E0D4", // 燕麦米 oat
  ];
  const {
    UploadOutlined,
    DeleteOutlined,
    CheckCircleFilled,
    VideoCameraFilled,
    PictureOutlined,
    BgColorsOutlined,
    MessageOutlined,
  } = antdIcons || {};

  const icon = (Comp, props) => (Comp ? h(Comp, props || {}) : null);

  /** Live preview box for one slot. */
  function PreviewBox({ spec }) {
    const hasBg = spec && (spec.url || spec.type === "color");
    const boxStyle = {
      position: "relative",
      width: "100%",
      height: 180,
      borderRadius: 10,
      overflow: "hidden",
      border: "1px solid rgba(128,128,128,0.25)",
      background: spec && spec.type === "color" ? spec.color : "#000",
      opacity: spec && spec.opacity != null ? spec.opacity : 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    };
    if (!hasBg) {
      return h(
        "div",
        { style: boxStyle },
        h(
          "div",
          { style: { color: "rgba(128,128,128,0.7)", fontSize: 13 } },
          t("notSet"),
        ),
      );
    }
    if (spec.type === "color") {
      return h(
        "div",
        { style: boxStyle },
        h(
          "div",
          {
            style: {
              position: "absolute",
              left: 10,
              bottom: 8,
              fontSize: 12,
              fontFamily: "monospace",
              color: "rgba(255,255,255,0.85)",
              background: "rgba(0,0,0,0.35)",
              padding: "2px 8px",
              borderRadius: 6,
            },
          },
          spec.color,
        ),
      );
    }
    const mediaStyle = {
      width: "100%",
      height: "100%",
      objectFit: spec.fit || "cover",
      filter: spec.blur > 0 ? `blur(${spec.blur}px)` : undefined,
      transform: spec.blur > 0 ? "scale(1.04)" : undefined,
    };
    const media =
      spec.type === "video"
        ? h("video", {
            src: mediaUrl(spec.url),
            style: mediaStyle,
            autoPlay: true,
            muted: true,
            loop: true,
            playsInline: true,
          })
        : h("img", { src: mediaUrl(spec.url), style: mediaStyle, alt: "" });
    return h(
      "div",
      { style: boxStyle },
      media,
      h("div", {
        style: {
          position: "absolute",
          inset: 0,
          background: `rgba(249,248,244,${spec.dim == null ? 0.35 : spec.dim})`,
        },
      }),
    );
  }

  /** One library item thumbnail. */
  function LibraryItem({ item, active, onApply, onDelete }) {
    const thumb =
      item.kind === "video"
        ? h("video", {
            src: mediaUrl(item.url),
            style: { width: "100%", height: "100%", objectFit: "cover" },
            muted: true,
            preload: "metadata",
            playsInline: true,
          })
        : h("img", {
            src: mediaUrl(item.url),
            style: { width: "100%", height: "100%", objectFit: "cover" },
            alt: item.name,
          });

    return h(
      "div",
      {
        style: {
          position: "relative",
          width: 112,
          borderRadius: 8,
          overflow: "hidden",
          border: active
            ? "2px solid #1677ff"
            : "1px solid rgba(128,128,128,0.25)",
          cursor: "pointer",
          boxShadow: active ? "0 0 0 2px rgba(22,119,255,0.15)" : "none",
        },
        onClick: onApply,
        title: `${item.name} (${fmtSize(item.size)})`,
      },
      h("div", { style: { width: "100%", height: 72, background: "#000" } }, thumb),
      active
        ? h(
            "div",
            {
              style: {
                position: "absolute",
                top: 4,
                left: 4,
                color: "#1677ff",
                background: "rgba(255,255,255,0.9)",
                borderRadius: 10,
                padding: "1px 5px",
                fontSize: 11,
                display: "flex",
                alignItems: "center",
                gap: 3,
              },
            },
            icon(CheckCircleFilled),
            t("inUse"),
          )
        : null,
      item.kind === "video"
        ? h(
            "div",
            {
              style: {
                position: "absolute",
                top: 4,
                right: 4,
                color: "#fff",
                background: "rgba(0,0,0,0.45)",
                borderRadius: 4,
                padding: "1px 4px",
                display: "flex",
              },
              title: t("video"),
            },
            icon(VideoCameraFilled),
          )
        : null,
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "3px 6px",
            background: "rgba(128,128,128,0.06)",
          },
        },
        h(
          "span",
          {
            style: {
              fontSize: 11,
              maxWidth: 66,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          },
          item.name,
        ),
        h(
          "span",
          { onClick: (e) => e.stopPropagation(), style: { display: "flex" } },
          h(
            Popconfirm,
            {
              title: t("deleteConfirm"),
              onConfirm: onDelete,
              okText: t("delete"),
              cancelText: "Cancel",
            },
            h(
              "span",
              { style: { color: "rgba(255,77,79,0.9)", fontSize: 12, display: "flex" } },
              icon(DeleteOutlined),
            ),
          ),
        ),
      ),
    );
  }

  /** Card for one slot: preview + options + upload + clear + library. */
  function SlotCard({ slot, config, library, uploading, onApply, onOption, onUpload, onDelete, onColor }) {
    const spec = config && config.slots && config.slots[slot];
    const activeFile = spec && spec.file;
    // fit/dim/blur only apply to image/video - disabled for solid color.
    const disabled = !spec || !spec.type || spec.type === "color";
    // opacity works for every kind (image/video/solid color).
    const noBg = !spec || !spec.type;
    const isSolid = spec && spec.type === "color";
    const opacityPct = spec ? Math.round((spec.opacity == null ? 1 : spec.opacity) * 100) : 100;

    const optionRow = (label, control) =>
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 } },
        h(
          "span",
          { style: { fontSize: 12, width: 64, color: "rgba(128,128,128,0.9)", flexShrink: 0 } },
          label,
        ),
        h("div", { style: { flex: 1, minWidth: 0 } }, control),
      );

    return h(
      Card,
      {
        title: h(
          "span",
          { style: { display: "inline-flex", alignItems: "center", gap: 8 } },
          icon(
            slot === "global" ? BgColorsOutlined || PictureOutlined : MessageOutlined,
            { style: { color: "#1677ff" } },
          ),
          t(slot === "global" ? "globalTitle" : "chatTitle"),
        ),
        extra:
          spec && spec.type
            ? h(Tag, { color: spec.type === "video" ? "purple" : "blue" }, t(spec.type))
            : null,
        style: { flex: 1, minWidth: 340 },
      },
      h(
        "div",
        { style: { color: "rgba(128,128,128,0.9)", fontSize: 12, marginBottom: 10 } },
        t(slot === "global" ? "globalDesc" : "chatDesc"),
      ),
      h(PreviewBox, { spec }),
      h(
        "div",
        {
          style: {
            marginTop: 12,
            opacity: disabled ? 0.45 : 1,
            pointerEvents: disabled ? "none" : "auto",
          },
        },
        optionRow(
          t("fit"),
          h(Select, {
            size: "small",
            style: { width: 140 },
            value: (spec && spec.fit) || "cover",
            disabled,
            onChange: (v) => onOption(slot, "fit", v),
            options: [
              { value: "cover", label: t("fitCover") },
              { value: "contain", label: t("fitContain") },
              { value: "fill", label: t("fitFill") },
            ],
          }),
        ),
        optionRow(
          t("dim"),
          h(Slider, {
            min: 0,
            max: 0.9,
            step: 0.05,
            value: spec ? (spec.dim == null ? 0.35 : spec.dim) : 0.35,
            disabled,
            onChange: (v) => onOption(slot, "dim", v),
          }),
        ),
        optionRow(
          t("blur"),
          h(Slider, {
            min: 0,
            max: 20,
            step: 1,
            value: spec ? spec.blur || 0 : 0,
            disabled,
            onChange: (v) => onOption(slot, "blur", v),
          }),
        ),
      ),
      // Background transparency - available for image/video AND solid color.
      h(
        "div",
        {
          style: {
            marginTop: 8,
            opacity: noBg ? 0.45 : 1,
            pointerEvents: noBg ? "none" : "auto",
          },
        },
        optionRow(
          t("opacity"),
          h(Slider, {
            min: 0,
            max: 100,
            step: 5,
            value: opacityPct,
            disabled: noBg,
            tooltip: { formatter: (v) => `${v}%` },
            onChange: (v) => onOption(slot, "opacity", v / 100),
          }),
        ),
      ),
      // Solid color section (chat slot only): 5 suggested colors + custom RGB.
      slot === "chat"
        ? h(
            "div",
            {
              style: {
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(128,128,128,0.2)",
                background: "rgba(128,128,128,0.05)",
              },
            },
            h(
              "div",
              { style: { fontWeight: 500, marginBottom: 4, fontSize: 13 } },
              t("colorSection"),
            ),
            h(
              "div",
              { style: { color: "rgba(128,128,128,0.85)", fontSize: 12, marginBottom: 8 } },
              t("colorHint"),
            ),
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
              PRESET_COLORS.map((c) =>
                h(
                  "button",
                  {
                    key: c,
                    title: c,
                    onClick: () => onColor(slot, c),
                    style: {
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background: c,
                      border: isSolid && spec.color === c
                        ? "2px solid #1677ff"
                        : "1px solid rgba(128,128,128,0.3)",
                      boxShadow: isSolid && spec.color === c
                        ? "0 0 0 2px rgba(22,119,255,0.2)"
                        : "none",
                      cursor: "pointer",
                      padding: 0,
                    },
                  },
                ),
              ),
              h(
                "span",
                { style: { fontSize: 12, color: "rgba(128,128,128,0.85)", margin: "0 4px" } },
                t("colorCustom"),
              ),
              h(ColorPicker, {
                size: "small",
                value: isSolid ? spec.color : "#E4E9EC",
                showText: true,
                onChangeComplete: (c) => onColor(slot, c.toHexString()),
              }),
            ),
          )
        : null,
      h(
        "div",
        { style: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" } },
        h(
          Upload,
          {
            accept: "image/*,video/*",
            showUploadList: false,
            customRequest: (req) => onUpload(slot, req.file),
          },
          h(Button, { type: "primary", loading: uploading, icon: icon(UploadOutlined) }, t("upload")),
        ),
        spec && spec.type
          ? h(Button, { onClick: () => onApply(slot, null) }, t("clear"))
          : null,
      ),
      h(
        "div",
        { style: { marginTop: 14 } },
        h("div", { style: { fontWeight: 500, marginBottom: 8, fontSize: 13 } }, t("library")),
        library.length === 0
          ? h(Empty, {
              image: Empty.PRESENTED_IMAGE_SIMPLE,
              description: t("libraryEmpty"),
              style: { margin: "8px 0" },
            })
          : h(
              "div",
              { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
              library.map((item) =>
                h(LibraryItem, {
                  key: item.name,
                  item,
                  active: activeFile === item.name,
                  onApply: () => onApply(slot, item),
                  onDelete: () => onDelete(item),
                }),
              ),
            ),
      ),
    );
  }

  function BackgroundSettingsPage() {
    const [config, setConfigState] = React.useState(null);
    const [library, setLibrary] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [uploading, setUploading] = React.useState(false);
    const [errorMsg, setErrorMsg] = React.useState(null);

    const configRef = React.useRef(null);

    const notifyChanged = () => {
      window.dispatchEvent(new CustomEvent(EVENT_CHANGED));
    };

    const refresh = React.useCallback(() => {
      return Promise.all([getConfig(), getLibrary()])
        .then(([cfg, lib]) => {
          configRef.current = cfg;
          setConfigState(cfg);
          setLibrary((lib && lib.items) || []);
          setErrorMsg(null);
        })
        .catch((err) => {
          setErrorMsg((err && err.message) || String(err));
        })
        .then(() => setLoading(false));
    }, []);

    React.useEffect(() => {
      refresh();
    }, [refresh]);

    const handleApply = React.useCallback((slot, item) => {
      const cur = configRef.current && configRef.current.slots[slot];
      const curOpacity = cur ? (cur.opacity == null ? 1 : cur.opacity) : 1;
      const body = item
        ? {
            type: item.kind,
            file: item.name,
            fit: (cur && cur.fit) || "cover",
            dim: cur ? (cur.dim == null ? 0.35 : cur.dim) : 0.35,
            blur: (cur && cur.blur) || 0,
            opacity: curOpacity,
          }
        : null;
      putConfig(slot, body)
        .then((cfg) => {
          configRef.current = cfg;
          setConfigState(cfg);
          message.success(item ? t("applied") : t("cleared"));
          notifyChanged();
        })
        .catch((err) => message.error((err && err.message) || "Error"));
    }, []);

    const handleOption = React.useCallback((slot, key, value) => {
      const cur = configRef.current && configRef.current.slots[slot];
      if (!cur || !cur.type) return;
      const body = {
        type: cur.type,
        file: cur.file,
        color: cur.color,
        fit: key === "fit" ? value : cur.fit || "cover",
        dim: key === "dim" ? value : cur.dim == null ? 0.35 : cur.dim,
        blur: key === "blur" ? value : cur.blur || 0,
        opacity:
          key === "opacity" ? value : cur.opacity == null ? 1 : cur.opacity,
      };
      putConfig(slot, body)
        .then((cfg) => {
          configRef.current = cfg;
          setConfigState(cfg);
          notifyChanged();
        })
        .catch((err) => message.error((err && err.message) || "Error"));
    }, []);

    const handleUpload = React.useCallback(
      (slot, file) => {
        setUploading(true);
        const cur = configRef.current && configRef.current.slots[slot];
        uploadLibrary(file)
          .then((item) =>
            putConfig(slot, {
              type: item.kind,
              file: item.name,
              fit: "cover",
              dim: 0.35,
              blur: 0,
              opacity: cur ? (cur.opacity == null ? 1 : cur.opacity) : 1,
            }),
          )
          .then(() => {
            message.success(t("uploadOk"));
            return refresh();
          })
          .then(notifyChanged)
          .catch((err) => message.error((err && err.message) || "Upload failed"))
          .then(() => setUploading(false));
      },
      [refresh],
    );

    const handleDelete = React.useCallback(
      (item) => {
        deleteLibrary(item.name)
          .then(() => {
            message.success(t("deleted"));
            return refresh();
          })
          .then(notifyChanged)
          .catch((err) => message.error((err && err.message) || "Error"));
      },
      [refresh],
    );

    const handleToggleEnabled = React.useCallback((checked) => {
      putEnabled(checked)
        .then((cfg) => {
          configRef.current = cfg;
          setConfigState(cfg);
          notifyChanged();
        })
        .catch((err) => message.error((err && err.message) || "Error"));
    }, []);

    // Apply a solid color to a slot (keeps fit/dim/blur, dim is inert for
    // solid colors since we render them verbatim).
    const handleColor = React.useCallback((slot, color) => {
      const cur = configRef.current && configRef.current.slots[slot];
      putConfig(slot, {
        type: "color",
        color: String(color || "").trim().toUpperCase(),
        fit: (cur && cur.fit) || "cover",
        dim: cur ? (cur.dim == null ? 0.35 : cur.dim) : 0.35,
        blur: (cur && cur.blur) || 0,
        opacity: cur ? (cur.opacity == null ? 1 : cur.opacity) : 1,
      })
        .then((cfg) => {
          configRef.current = cfg;
          setConfigState(cfg);
          message.success(t("applied"));
          notifyChanged();
        })
        .catch((err) => message.error((err && err.message) || "Error"));
    }, []);

    if (loading) {
      return h(Spin, { style: { display: "block", margin: "20vh auto" } });
    }

    const enabled = !!(config && config.enabled === true);

    return h(
      "div",
      { style: { padding: 20, maxWidth: 1180, margin: "0 auto" } },
      h(
        "div",
        {
          style: {
            marginBottom: 16,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          },
        },
        h(
          "div",
          null,
          h("div", { style: { fontSize: 20, fontWeight: 600 } }, t("pageTitle")),
          h(
            "div",
            { style: { color: "rgba(128,128,128,0.9)", fontSize: 13, marginTop: 4 } },
            t("pageDesc"),
          ),
        ),
        h(
          "label",
          {
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              flexShrink: 0,
              fontSize: 13,
              paddingTop: 4,
            },
          },
          t("enableSwitch"),
          h(Switch, {
            size: "small",
            checked: enabled,
            onChange: handleToggleEnabled,
          }),
        ),
      ),
      errorMsg
        ? h(Alert, {
            type: "error",
            showIcon: true,
            message: t("loadFail"),
            description: errorMsg,
            style: { marginBottom: 16 },
          })
        : null,
      !enabled
        ? h(Alert, {
            type: "info",
            showIcon: true,
            message: t("enableHint"),
            style: { marginBottom: 16 },
          })
        : null,
      h(
        "div",
        {
          style: {
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            alignItems: "flex-start",
            opacity: enabled ? 1 : 0.55,
            pointerEvents: enabled ? "auto" : "none",
          },
        },
        h(SlotCard, {
          slot: "global",
          config,
          library,
          uploading,
          onApply: handleApply,
          onOption: handleOption,
          onUpload: handleUpload,
          onDelete: handleDelete,
          onColor: handleColor,
        }),
        h(SlotCard, {
          slot: "chat",
          config,
          library,
          uploading,
          onApply: handleApply,
          onOption: handleOption,
          onUpload: handleUpload,
          onDelete: handleDelete,
          onColor: handleColor,
        }),
      ),
    );
  }

  // ── Registration: menu + route ─────────────────────────────────────────

  const MENU_ITEM_ID = "background-theme.settings";
  const ROUTE_ID = "background-theme.settings";
  const ROUTE_PATH = "/background-settings";

  QwenPaw.menu.add(PLUGIN_ID, {
    id: MENU_ITEM_ID,
    location: "primary.settings",
    parentId: "core.settings-group",
    label: () => t("menuLabel"),
    icon: icon(PictureOutlined) || "🖼️",
    route: ROUTE_ID,
    order: 95, // between voice-transcription (90) and debug (100)
  });

  QwenPaw.route.add(PLUGIN_ID, {
    id: ROUTE_ID,
    path: ROUTE_PATH,
    component: BackgroundSettingsPage,
  });

  // Debug handle (console: __QWP_BG__.reload())
  window.__QWP_BG__ = { reload: loadAndApply, apply: applyConfig };

  // Boot the background engine on every page.
  loadAndApply();

  console.info("[background-theme] registered menu + /background-settings route");
})();
