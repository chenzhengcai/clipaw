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
    delete: { zh: "删除", en: "Delete" },
    deleteConfirm: {
      zh: "删除这个背景文件?使用它的位置会被清除。",
      en: "Delete this file? Slots using it will be cleared.",
    },
    deleted: { zh: "已删除", en: "Deleted" },
    image: { zh: "图片", en: "Image" },
    video: { zh: "视频", en: "Video" },
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

  /** Backend returns URLs already prefixed with /api - attach the base. */
  const mediaUrl = (u) => (u ? (host.apiBaseUrl || "") + u : u);

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

  /** Create (or reuse) an <img>/<video> element for a background spec. */
  function buildMediaEl(spec, existing) {
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

  /** Fill a layer div (media + dim overlay) from a spec. */
  function fillLayer(layer, spec) {
    layer.style.setProperty("--qwp-fit", spec.fit || "cover");
    layer.style.setProperty(
      "--qwp-dim",
      String(spec.dim == null ? 0.35 : spec.dim),
    );
    const media = layer.querySelector(".qwp-bg-media");
    const next = buildMediaEl(spec, media);
    if (!next.parentNode) layer.insertBefore(next, layer.firstChild);
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
    if (!spec || !spec.type || !spec.url) {
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
    if (!spec || !spec.type || !spec.url) {
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
    // Master switch OFF -> strip every layer / class (original UI restored).
    if (cfg.enabled !== true) {
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

  const { Card, Button, Select, Slider, Popconfirm, Spin, Empty, Tag, Alert, Upload, Switch, message } = antd;
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
    const boxStyle = {
      position: "relative",
      width: "100%",
      height: 180,
      borderRadius: 10,
      overflow: "hidden",
      border: "1px solid rgba(128,128,128,0.25)",
      background: spec && spec.url ? "#000" : "rgba(128,128,128,0.08)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    };
    if (!spec || !spec.url) {
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
  function SlotCard({ slot, config, library, uploading, onApply, onOption, onUpload, onDelete }) {
    const spec = config && config.slots && config.slots[slot];
    const activeFile = spec && spec.file;
    const disabled = !spec || !spec.type;

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
      const body = item
        ? {
            type: item.kind,
            file: item.name,
            fit: (cur && cur.fit) || "cover",
            dim: cur ? (cur.dim == null ? 0.35 : cur.dim) : 0.35,
            blur: (cur && cur.blur) || 0,
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
        fit: key === "fit" ? value : cur.fit || "cover",
        dim: key === "dim" ? value : cur.dim == null ? 0.35 : cur.dim,
        blur: key === "blur" ? value : cur.blur || 0,
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
        uploadLibrary(file)
          .then((item) =>
            putConfig(slot, {
              type: item.kind,
              file: item.name,
              fit: "cover",
              dim: 0.35,
              blur: 0,
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
