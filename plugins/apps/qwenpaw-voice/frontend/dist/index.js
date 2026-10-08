function Q() {
  return window.QwenPaw;
}
function b() {
  const e = Q();
  if (!(e != null && e.host))
    throw new Error("[qwenpaw-voice] window.QwenPaw.host not available");
  return e.host;
}
function Ye(e) {
  return b().getApiUrl(e);
}
async function A(e, t = {}) {
  var c;
  const o = b(), n = new Headers(t.headers), r = (c = o.getApiToken) == null ? void 0 : c.call(o);
  return r && n.set("Authorization", `Bearer ${r}`), t.body && !n.has("Content-Type") && n.set("Content-Type", "application/json"), fetch(Ye(e), { ...t, headers: n });
}
const re = b().React, Ce = {
  en: {
    title: "Voice Input",
    description: "Volcengine BigModel streaming ASR: real-time voice-to-text with configurable shortcuts, plus a master switch that falls back to the built-in voice input.",
    toggleTitle: "Real-time Voice Input",
    toggleDesc: "When on, use this plugin's streaming voice input (Volcengine ASR) in chat. When off, the plugin mic and shortcuts go offline and the built-in official voice input is used instead.",
    toggleOn: "On · Streaming voice input",
    toggleOff: "Off · Built-in voice input",
    volcengineConfigTitle: "Volcengine ASR Configuration",
    volcengineConfigDesc: "Enter the API Key and Resource ID for the Volcengine speech service. Find them in the Volcengine console under Doubao Speech → Streaming ASR.",
    volcengineApiKeyLabel: "API Key",
    volcengineApiKeyPlaceholder: "Enter the Volcengine ASR API Key",
    volcengineResourceIdLabel: "Resource ID",
    volcengineResourceIdPlaceholder: "volc.bigasr.sauc.duration",
    volcengineNotConfigured: "Not configured yet — click Edit to add credentials",
    testConnection: "Test Connection",
    testing: "Testing...",
    testConnected: "Connected",
    testSuccess: "Connection succeeded! Voice input is ready.",
    testFailed: "Connection failed. Check your credentials.",
    shortcutTitle: "Shortcut Settings",
    shortcutDesc: "Set the global shortcut for voice input. Supports toggle (press to start/stop) and hold (press and hold to talk).",
    shortcutKey: "Shortcut",
    shortcutCapturing: "Press a key combination...",
    shortcutMode: "Trigger Mode",
    shortcutModeToggle: "Toggle",
    shortcutModeToggleDesc: "Press to start recording, press again to stop.",
    shortcutModeHold: "Hold",
    shortcutModeHoldDesc: "Hold to record, release to stop.",
    // chat.speech.*
    startRecording: "Start Recording",
    stopRecording: "Stop Recording",
    transcribing: "Transcribing...",
    transcriptionFailed: "Voice transcription failed",
    microphoneError: "Could not access microphone",
    recordingTooLong: "Recording exceeds duration limit ({{limit}}s)",
    notConnected: "Voice service not connected. Test the connection in Settings.",
    cancel: "Cancel",
    save: "Save",
    edit: "Edit"
  },
  zh: {
    title: "语音输入",
    description: "火山引擎大模型流式语音识别：聊天内实时语音转文字、可配置快捷键，并支持一键回退官方内置语音输入。",
    toggleTitle: "实时语音输入",
    toggleDesc: "开启后使用本插件的流式实时语音输入（火山引擎 ASR）；关闭后插件麦克风与快捷键下线，回退官方内置语音输入功能。",
    toggleOn: "已开启 · 实时语音输入",
    toggleOff: "已关闭 · 官方内置语音",
    volcengineConfigTitle: "火山引擎 ASR 配置",
    volcengineConfigDesc: "填写火山引擎语音识别服务的 API Key 和 Resource ID。可在火山引擎控制台「豆包语音 → 语音识别大模型」中获取。",
    volcengineApiKeyLabel: "API Key",
    volcengineApiKeyPlaceholder: "请输入火山引擎语音识别 API Key",
    volcengineResourceIdLabel: "Resource ID",
    volcengineResourceIdPlaceholder: "volc.bigasr.sauc.duration",
    volcengineNotConfigured: "尚未配置，请点击编辑按钮添加凭据",
    testConnection: "测试连通性",
    testing: "测试中...",
    testConnected: "已连接",
    testSuccess: "连接成功！语音输入已就绪。",
    testFailed: "连接失败，请检查凭据配置。",
    shortcutTitle: "快捷键设置",
    shortcutDesc: "设置语音输入的全局快捷键。支持单机模式（按一下开/关）和长按模式（按住说话，松开结束）。",
    shortcutKey: "快捷键",
    shortcutCapturing: "请按下组合键...",
    shortcutMode: "触发模式",
    shortcutModeToggle: "单机模式",
    shortcutModeToggleDesc: "按下快捷键开始录音，再次按下结束录音。",
    shortcutModeHold: "长按模式",
    shortcutModeHoldDesc: "按住快捷键开始录音，松开即结束。",
    // chat.speech.*
    startRecording: "开始语音录制",
    stopRecording: "停止录制",
    transcribing: "正在转录...",
    transcriptionFailed: "语音转录失败",
    microphoneError: "无法访问麦克风",
    recordingTooLong: "录音时长超过限制（{{limit}}秒）",
    notConnected: "语音服务未连接，请先在设置中测试连通性",
    cancel: "取消",
    save: "保存",
    edit: "编辑"
  }
};
function J() {
  try {
    return (localStorage.getItem("language") || localStorage.getItem("i18nextLng") || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}
function xe(e, t, o) {
  let n = Ce[e][t] ?? Ce.en[t] ?? t;
  if (o)
    for (const [r, c] of Object.entries(o))
      n = n.replace(new RegExp(`\\{\\{${r}\\}\\}`, "g"), String(c));
  return n;
}
function K() {
  const [e, t] = re.useState(J);
  return re.useEffect(() => {
    const n = (r) => {
      (r.key === "language" || r.key === "i18nextLng") && t(J());
    };
    return window.addEventListener("storage", n), t(J()), () => window.removeEventListener("storage", n);
  }, []), { t: re.useCallback(
    (n, r) => xe(e, n, r),
    [e]
  ), locale: e };
}
const Qe = /* @__PURE__ */ new Set([
  "voice_connected",
  "qwenpaw_voice_shortcut",
  "qwenpaw_voice_shortcut_mode",
  "qwenpaw_voice_enabled"
]);
let Re = !1;
async function Xe() {
  if (!Re) {
    try {
      const e = await A("/qwenpaw-voice/client-config");
      if (!e.ok) return;
      const t = await e.json();
      if (t && typeof t == "object")
        for (const [o, n] of Object.entries(t))
          Qe.has(o) && n !== void 0 && n !== null && localStorage.setItem(o, String(n));
    } catch {
    }
    Re = !0;
  }
}
async function X(e, t) {
  try {
    localStorage.setItem(e, t);
  } catch {
  }
  try {
    await A("/qwenpaw-voice/client-config", {
      method: "PUT",
      body: JSON.stringify({ [e]: t })
    });
  } catch {
  }
}
function Ze(e) {
  return localStorage.getItem(e);
}
function et(e) {
  try {
    localStorage.removeItem(e);
  } catch {
  }
  A("/qwenpaw-voice/client-config", {
    method: "PUT",
    body: JSON.stringify({ [e]: "" })
  }).catch(() => {
  });
}
const ve = "voice_connected", ue = "qwenpaw_voice_shortcut", de = "qwenpaw_voice_shortcut_mode", Z = "qwenpaw_voice_enabled", ee = "qwenpaw-voice-change", ge = "volcengine_asr_api_key", Ve = "volcengine_asr_resource_id", k = "volc.bigasr.sauc.duration";
function ce() {
  et(ve);
}
function ye() {
  return Ze(ve) === "1";
}
async function tt() {
  await X(ve, "1");
}
function fe() {
  try {
    return localStorage.getItem(Z) !== "0";
  } catch {
    return !0;
  }
}
async function nt(e) {
  const t = e ? "1" : "0";
  try {
    localStorage.setItem(Z, t);
  } catch {
  }
  try {
    await X(Z, t);
  } catch {
  }
  try {
    window.dispatchEvent(new CustomEvent(ee));
  } catch {
  }
}
function Ke() {
  return /Mac|iP(hone|[ao]d)/.test(navigator.platform || navigator.userAgent);
}
function ot() {
  const e = Ke();
  return { ctrl: !e, shift: !0, alt: !1, meta: e, code: "KeyM" };
}
function he() {
  try {
    const e = localStorage.getItem(ue);
    if (e) return JSON.parse(e);
  } catch {
  }
  return ot();
}
function pe() {
  return localStorage.getItem(de) === "hold" ? "hold" : "toggle";
}
async function ae(e, t) {
  localStorage.setItem(ue, JSON.stringify(e)), localStorage.setItem(de, t);
  try {
    await X(ue, JSON.stringify(e)), await X(de, t);
  } catch {
  }
}
const rt = /* @__PURE__ */ new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight"
]);
function be(e, t) {
  return (rt.has(t.code) || e.ctrlKey === t.ctrl && e.shiftKey === t.shift && e.altKey === t.alt && e.metaKey === t.meta) && e.code === t.code;
}
function ct(e) {
  const t = Ke(), o = {
    AltLeft: t ? "⌥" : "Alt",
    AltRight: t ? "⌥" : "Alt",
    ControlLeft: t ? "⌃" : "Ctrl",
    ControlRight: t ? "⌃" : "Ctrl",
    ShiftLeft: t ? "⇧" : "Shift",
    ShiftRight: t ? "⇧" : "Shift",
    MetaLeft: t ? "⌘" : "Win",
    MetaRight: t ? "⌘" : "Win"
  };
  if (o[e.code]) return o[e.code];
  const n = [];
  e.ctrl && n.push(t ? "⌃" : "Ctrl"), e.alt && n.push(t ? "⌥" : "Alt"), e.shift && n.push(t ? "⇧" : "Shift"), e.meta && n.push(t ? "⌘" : "Win");
  const r = e.code.replace(/^Key/, "").replace(/^Digit/, "").replace("Comma", ",").replace("Period", ".").replace("Slash", "/").replace("Backslash", "\\").replace("BracketLeft", "[").replace("BracketRight", "]").replace("Minus", "-").replace("Equal", "=").replace("Semicolon", ";").replace("Quote", "'").replace("Backquote", "`").replace("Space", "Space");
  return n.push(r), n.join(t ? "" : "+");
}
async function at() {
  try {
    const e = await A("/envs");
    if (!e.ok) throw new Error("envs fetch failed");
    const t = await e.json(), o = {};
    for (const n of t) o[n.key] = n.value;
    return {
      apiKey: o[ge] ?? "",
      resourceId: o[Ve] ?? k
    };
  } catch {
    return { apiKey: "", resourceId: k };
  }
}
async function it(e, t) {
  const o = await A("/envs"), n = {};
  if (o.ok) {
    const r = await o.json();
    for (const c of r) n[c.key] = c.value;
  }
  delete n.volcengine_asr_app_id, delete n.volcengine_asr_access_token, e ? n[ge] = e : delete n[ge], n[Ve] = t || k, await A("/envs", {
    method: "PUT",
    body: JSON.stringify(n)
  });
}
async function st(e) {
  return await (await A("/qwenpaw-voice/voice-test-connection", {
    method: "POST",
    body: JSON.stringify(e ?? {})
  })).json();
}
const { React: p, antd: lt, antdIcons: ut } = b(), { Tooltip: dt, message: D, Button: gt } = lt, { LoadingOutlined: ft } = ut, {
  useCallback: O,
  useRef: T,
  useState: Ie,
  forwardRef: ht,
  useImperativeHandle: pt
} = p, Te = 300 * 1e3, me = 16e3, P = 1e3, N = 4, Y = 140, ke = Y / 2, U = 250, Ae = 500, H = 0.8, mt = ({ className: e }) => /* @__PURE__ */ p.createElement(
  "svg",
  {
    viewBox: `0 0 ${P} ${P}`,
    xmlns: "http://www.w3.org/2000/svg",
    className: e,
    style: {
      color: "#1890ff",
      height: "1.2em",
      width: "1.2em",
      verticalAlign: "top"
    }
  },
  /* @__PURE__ */ p.createElement("title", null, "Speech Recording"),
  Array.from({ length: N }).map((t, o) => {
    const n = (P - Y * N) / (N - 1), r = o * (n + Y), c = P / 2 - U / 2, d = P / 2 - Ae / 2;
    return /* @__PURE__ */ p.createElement(
      "rect",
      {
        fill: "currentColor",
        rx: ke,
        ry: ke,
        height: U,
        width: Y,
        x: r,
        y: c,
        key: o
      },
      /* @__PURE__ */ p.createElement(
        "animate",
        {
          attributeName: "height",
          values: `${U}; ${Ae}; ${U}`,
          keyTimes: "0; 0.5; 1",
          dur: `${H}s`,
          begin: `${H / N * o}s`,
          repeatCount: "indefinite"
        }
      ),
      /* @__PURE__ */ p.createElement(
        "animate",
        {
          attributeName: "y",
          values: `${c}; ${d}; ${c}`,
          keyTimes: "0; 0.5; 1",
          dur: `${H}s`,
          begin: `${H / N * o}s`,
          repeatCount: "indefinite"
        }
      )
    );
  })
), vt = () => /* @__PURE__ */ p.createElement(
  "span",
  {
    className: "spark-icon spark-icon-spark-mic-line",
    role: "img",
    "aria-label": "spark-mic-line",
    "data-spark-icon": "true"
  },
  /* @__PURE__ */ p.createElement(
    "svg",
    {
      viewBox: "0 0 1024 1024",
      width: "1em",
      height: "1em",
      overflow: "hidden",
      fill: "currentColor",
      "aria-hidden": "true"
    },
    /* @__PURE__ */ p.createElement("path", { d: "M285.216 562.9408a248.64 248.64 0 0 0 37.6448 59.7312 249.008 249.008 0 0 0 52.5056 46.64 245.5232 245.5232 0 0 0 64.0672 30.288c23.52 7.2032 47.712 10.8032 72.5664 10.8032 24.8544 0 49.0432-3.6 72.5664-10.8032a245.5296 245.5296 0 0 0 64.0672-30.288 248.896 248.896 0 0 0 52.5056-46.64 248.5888 248.5888 0 0 0 37.648-59.7312 32 32 0 1 1 58.4256 26.1184 312.2432 312.2432 0 0 1-47.2832 75.0336 312.6752 312.6752 0 0 1-65.936 58.5664 309.168 309.168 0 0 1-80.688 38.1376C573.6768 769.8688 543.2416 774.4 512 774.4c-31.2416 0-61.6768-4.5344-91.3056-13.6064a309.184 309.184 0 0 1-80.688-38.1376 312.6912 312.6912 0 0 1-65.936-58.5664 312.32 312.32 0 0 1-47.2832-75.0336 32 32 0 1 1 58.4256-26.1184z" }),
    /* @__PURE__ */ p.createElement("path", { d: "M339.4304 219.68a183.6896 183.6896 0 0 1 41.3312-62.9184 183.6896 183.6896 0 0 1 62.9184-41.3312A183.9712 183.9712 0 0 1 512 102.4a183.9712 183.9712 0 0 1 68.32 13.0304 183.6896 183.6896 0 0 1 62.9184 41.3312 183.696 183.696 0 0 1 41.3312 62.9184A183.9616 183.9616 0 0 1 697.6 288v198.4a183.952 183.952 0 0 1-13.0304 68.3168 183.7088 183.7088 0 0 1-41.3312 62.9216 183.6896 183.6896 0 0 1-62.9184 41.3312A183.9616 183.9616 0 0 1 512 672a183.9616 183.9616 0 0 1-68.32-13.0304 183.6896 183.6896 0 0 1-62.9184-41.3312 183.7024 183.7024 0 0 1-41.3312-62.9216A183.9616 183.9616 0 0 1 326.4 486.4V288a183.9712 183.9712 0 0 1 13.0304-68.32z m86.5856 352.704a120.3392 120.3392 0 0 0 41.2224 27.0784A120.512 120.512 0 0 0 512 608a120.512 120.512 0 0 0 44.7616-8.5376 120.3392 120.3392 0 0 0 41.2224-27.0784 120.3584 120.3584 0 0 0 27.0784-41.2224A120.544 120.544 0 0 0 633.6 486.4V288c0-15.4624-2.848-30.384-8.5376-44.7616a120.3552 120.3552 0 0 0-27.0784-41.2224 120.3552 120.3552 0 0 0-41.2224-27.0784A120.5344 120.5344 0 0 0 512 166.4c-15.4624 0-30.384 2.848-44.7616 8.5376a120.3552 120.3552 0 0 0-41.2224 27.0784 120.3552 120.3552 0 0 0-27.0784 41.2224A120.5312 120.5312 0 0 0 390.4 288v198.4c0 15.4624 2.848 30.384 8.5376 44.7616a120.3584 120.3584 0 0 0 27.0784 41.2224zM512 710.4c17.6736 0 32 14.3264 32 32v147.2c0 17.6736-14.3264 32-32 32s-32-14.3264-32-32v-147.2c0-17.6736 14.3264-32 32-32z" }),
    /* @__PURE__ */ p.createElement("path", { d: "M352 889.6c0-17.6736 14.3264-32 32-32h256c17.6736 0 32 14.3264 32 32s-14.3264 32-32 32h-256c-17.6736 0-32-14.3264-32-32z" })
  )
);
function yt(e) {
  const t = b().getApiUrl(e);
  return t.startsWith("https://") ? t.replace("https://", "wss://") : t.startsWith("http://") ? t.replace("http://", "ws://") : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${t}`;
}
function Et(e, t) {
  if (t === me) {
    const c = new Int16Array(e.length);
    for (let d = 0; d < e.length; d++)
      c[d] = Math.max(-32768, Math.min(32767, Math.round(e[d] * 32767)));
    return c;
  }
  const o = t / me, n = Math.floor(e.length / o), r = new Int16Array(n);
  for (let c = 0; c < n; c++) {
    const d = c * o, i = Math.floor(d), g = Math.min(i + 1, e.length - 1), l = d - i, u = e[i] * (1 - l) + e[g] * l;
    r[c] = Math.max(-32768, Math.min(32767, Math.round(u * 32767)));
  }
  return r;
}
function wt(e) {
  const t = new ArrayBuffer(e.length * 2), o = new DataView(t);
  for (let n = 0; n < e.length; n++)
    o.setInt16(n * 2, e[n], !0);
  return t;
}
const qe = ht(
  ({ disabled: e, onTranscription: t, onStart: o }, n) => {
    const { t: r } = K(), [c, d] = Ie(!1), [i, g] = Ie(!1), l = T(null), u = T(null), s = T(null), f = T(null), m = T(!1), v = T(
      null
    ), y = T(""), w = O(() => {
      if (v.current && (clearTimeout(v.current), v.current = null), s.current) {
        try {
          s.current.disconnect();
        } catch {
        }
        s.current = null;
      }
      if (u.current) {
        try {
          u.current.close();
        } catch {
        }
        u.current = null;
      }
      if (f.current && (f.current.getTracks().forEach((E) => E.stop()), f.current = null), l.current) {
        try {
          l.current.readyState === WebSocket.OPEN && l.current.send("DONE");
        } catch {
        }
        try {
          l.current.close();
        } catch {
        }
        l.current = null;
      }
      m.current = !1, d(!1), g(!1);
    }, []), L = O(() => {
      if (m.current) {
        if (m.current = !1, d(!1), g(!0), s.current) {
          try {
            s.current.disconnect();
          } catch {
          }
          s.current = null;
        }
        if (u.current) {
          try {
            u.current.close();
          } catch {
          }
          u.current = null;
        }
        f.current && (f.current.getTracks().forEach((E) => E.stop()), f.current = null), v.current && (clearTimeout(v.current), v.current = null), l.current && l.current.readyState === WebSocket.OPEN && l.current.send("DONE");
      }
    }, []), q = O(async () => {
      if (!(m.current || i)) {
        o == null || o();
        try {
          const E = yt("/qwenpaw-voice/transcribe/ws"), R = new WebSocket(E);
          R.binaryType = "arraybuffer", R.onopen = async () => {
            try {
              const I = await navigator.mediaDevices.getUserMedia({
                audio: {
                  channelCount: 1,
                  sampleRate: { ideal: me }
                }
              });
              f.current = I;
              const h = new AudioContext({
                sampleRate: I.getAudioTracks()[0].getSettings().sampleRate
              });
              u.current = h;
              const Ue = h.createMediaStreamSource(I), W = h.createScriptProcessor(4096, 1, 1);
              s.current = W;
              const He = h.sampleRate;
              W.onaudioprocess = (Fe) => {
                if (!m.current || R.readyState !== WebSocket.OPEN) return;
                const je = Fe.inputBuffer.getChannelData(0), Ge = Et(je, He), Je = wt(Ge);
                R.send(Je);
              }, Ue.connect(W), W.connect(h.destination), m.current = !0, d(!0), v.current = setTimeout(() => {
                m.current && (D.warning(
                  r("recordingTooLong", {
                    limit: Te / 1e3
                  })
                ), L());
              }, Te);
            } catch (I) {
              console.error("Microphone access error:", I), D.error(r("microphoneError")), w();
            }
          }, R.onmessage = (I) => {
            try {
              const h = JSON.parse(I.data);
              h.type === "partial" && h.text ? (t(h.text, !0), y.current = h.text) : h.type === "final" ? (h.text ? (t(h.text, !1), y.current = h.text) : y.current && t(y.current, !1), w()) : h.type === "error" && (D.error(h.message || r("transcriptionFailed")), w());
            } catch {
            }
          };
          let B = !1;
          R.onerror = () => {
            B = !0;
          }, R.onclose = () => {
            i && (y.current ? t(y.current, !1) : B && D.error(r("transcriptionFailed"))), w();
          }, l.current = R;
        } catch (E) {
          console.error("Microphone setup error:", E), D.error(r("microphoneError")), w();
        }
      }
    }, [t, r, i, L, w]), M = O(() => {
      i || (m.current ? L() : (y.current = "", q()));
    }, [i, q, L]), z = O(() => {
      l.current && l.current.readyState === WebSocket.OPEN && (y.current = "", l.current.send("RESET"));
    }, []);
    pt(
      n,
      () => ({
        toggleRecording: M,
        isRecording: () => m.current,
        isLoading: () => i,
        resetSession: z
      }),
      [M, i, z]
    );
    const _ = ye(), C = e || i || !_;
    return /* @__PURE__ */ p.createElement(
      dt,
      {
        title: r(_ ? i ? "transcribing" : c ? "stopRecording" : "startRecording" : "notConnected"),
        mouseEnterDelay: 0.5
      },
      /* @__PURE__ */ p.createElement(
        gt,
        {
          type: "text",
          className: "qwenpaw-sender-actions-btn qwenpaw-spark-icon-button spark-button",
          icon: i ? /* @__PURE__ */ p.createElement(ft, { style: { fontSize: "1.2em" } }) : c ? /* @__PURE__ */ p.createElement(mt, null) : /* @__PURE__ */ p.createElement(vt, null),
          onClick: _ ? M : void 0,
          disabled: C,
          style: {
            // Mirror the official design-lib Button exactly: it renders an
            // antd Button with { fontWeight: 500, lineHeight: 1 } and passes
            // the icon through unchanged. Same antd defaults ⇒ same box size.
            fontWeight: 500,
            lineHeight: 1,
            color: c || i ? "#1890ff" : void 0
          }
        }
      )
    );
  }
);
qe.displayName = "SpeechButton";
const { React: St } = b(), { useCallback: F, useRef: ie } = St;
function Le() {
  const e = document.querySelector('[class*="sender"]');
  return (e == null ? void 0 : e.querySelector("textarea")) ?? null;
}
function Me(e, t) {
  var r;
  const o = Object.getPrototypeOf(e), n = (r = Object.getOwnPropertyDescriptor(o, "value")) == null ? void 0 : r.set;
  n ? n.call(e, t) : e.value = t, e.dispatchEvent(new Event("input", { bubbles: !0 }));
}
function Ct() {
  const e = ie(""), t = ie(0), o = ie(!1), n = F(
    (i, g = !1) => {
      if (!o.current) return;
      const l = Le();
      if (!l) return;
      const u = l.value || "";
      if (g) {
        const s = u.length - t.current, f = s > 0 ? u.slice(0, s) : "";
        t.current = i.length;
        const m = f ? `${f}${i}` : i;
        Me(l, m);
      } else {
        t.current = 0;
        const s = e.current ? `${e.current}${i}` : i;
        Me(l, s);
      }
      l.focus();
    },
    []
  ), r = F(() => {
    const i = Le();
    e.current = (i == null ? void 0 : i.value) || "", t.current = 0, o.current = !0;
  }, []), c = F(() => {
    e.current = "", t.current = 0, o.current = !1;
  }, []), d = F(() => o.current, []);
  return { handleTranscription: n, onStart: r, stopOnSubmit: c, isActive: d };
}
const a = b().React, { useCallback: te, useEffect: ze, useRef: Be, useState: S } = a, { antd: Rt, antdIcons: bt } = b(), { Card: Ee, Input: _e, Form: se, Button: x, Space: ne, message: It, Switch: Tt, Tag: We, Radio: le } = Rt, { EditOutlined: kt, CloseOutlined: At, CheckOutlined: Lt, ApiOutlined: Mt } = bt, _t = 15e3, we = {
  marginBottom: 16,
  borderRadius: 8
}, Se = {
  margin: "0 0 4px",
  fontSize: 15,
  fontWeight: 600
}, oe = {
  margin: "0 0 12px",
  color: "var(--ant-color-text-secondary, rgba(0,0,0,0.45))",
  fontSize: 13
}, Dt = {
  color: "var(--ant-color-text-tertiary, rgba(0,0,0,0.35))",
  fontSize: 13,
  lineHeight: 2
}, De = {
  fontWeight: 500,
  marginRight: 6
}, Oe = {
  color: "var(--ant-color-text-secondary, rgba(0,0,0,0.45))",
  fontSize: 12
}, Pe = /* @__PURE__ */ new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight"
]);
function Ot() {
  const { t: e } = K(), [t, o] = S(fe);
  return /* @__PURE__ */ a.createElement(Ee, { style: we }, /* @__PURE__ */ a.createElement("h3", { style: Se }, e("toggleTitle")), /* @__PURE__ */ a.createElement("p", { style: oe }, e("toggleDesc")), /* @__PURE__ */ a.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } }, /* @__PURE__ */ a.createElement(
    Tt,
    {
      checked: t,
      onChange: (n) => {
        o(n), nt(n);
      }
    }
  ), /* @__PURE__ */ a.createElement(We, { color: t ? "green" : "default" }, e(t ? "toggleOn" : "toggleOff"))));
}
function Pt() {
  const { t: e } = K(), [t, o] = It.useMessage(), [n, r] = S(!1), [c, d] = S(""), [i, g] = S(k), [l, u] = S(!1), [s, f] = S(!1), [m, v] = S(ye), y = Be(!1), w = te(async () => {
    const { apiKey: C, resourceId: E } = await at();
    d(C), g(E || k), u(!0);
  }, []);
  ze(() => {
    w();
  }, [w]);
  const L = te(async () => {
    if (!y.current) {
      y.current = !0, f(!0);
      try {
        const C = n ? {
          api_key: c,
          resource_id: i || k
        } : void 0, E = await Promise.race([
          st(C),
          new Promise(
            (R, B) => setTimeout(
              () => B(new Error(e("testFailed"))),
              _t
            )
          )
        ]);
        E.ok ? (await tt(), v(!0), t.success(e("testSuccess"))) : (ce(), v(!1), t.error(E.error || e("testFailed")));
      } catch {
        ce(), v(!1), t.error(e("testFailed"));
      } finally {
        y.current = !1, f(!1);
      }
    }
  }, [e, n, c, i, t]), q = async () => {
    ce(), v(!1);
    try {
      await it(c, i), r(!1);
    } catch {
      t.error(e("testFailed"));
    }
  }, M = !!c, z = n ? !!c : M, _ = /* @__PURE__ */ a.createElement(
    x,
    {
      size: "small",
      icon: a.createElement(Mt),
      onClick: L,
      loading: s,
      disabled: !z
    },
    s ? e("testing") : m ? `${e("testConnected")} ✓` : e("testConnection")
  );
  return /* @__PURE__ */ a.createElement(
    Ee,
    {
      style: we,
      extra: n ? /* @__PURE__ */ a.createElement(ne, { size: "small" }, _, /* @__PURE__ */ a.createElement(
        x,
        {
          size: "small",
          icon: a.createElement(At),
          onClick: () => {
            r(!1), w();
          }
        },
        e("cancel", { defaultValue: "Cancel" })
      ), /* @__PURE__ */ a.createElement(
        x,
        {
          size: "small",
          type: "primary",
          icon: a.createElement(Lt),
          onClick: q
        },
        e("save", { defaultValue: "Save" })
      )) : /* @__PURE__ */ a.createElement(ne, { size: "small" }, _, /* @__PURE__ */ a.createElement(
        x,
        {
          size: "small",
          icon: a.createElement(kt),
          onClick: () => r(!0)
        },
        e("edit", { defaultValue: "Edit" })
      ))
    },
    o,
    /* @__PURE__ */ a.createElement("h3", { style: Se }, e("volcengineConfigTitle")),
    /* @__PURE__ */ a.createElement("p", { style: oe }, e("volcengineConfigDesc")),
    !n && l && /* @__PURE__ */ a.createElement("div", { style: Dt }, M ? /* @__PURE__ */ a.createElement(a.Fragment, null, /* @__PURE__ */ a.createElement("div", null, e("volcengineApiKeyLabel"), ": ****"), /* @__PURE__ */ a.createElement("div", null, e("volcengineResourceIdLabel"), ": ", i)) : /* @__PURE__ */ a.createElement("div", { style: { fontStyle: "italic" } }, e("volcengineNotConfigured"))),
    n && /* @__PURE__ */ a.createElement(se, { layout: "vertical" }, /* @__PURE__ */ a.createElement(se.Item, { label: e("volcengineApiKeyLabel") }, /* @__PURE__ */ a.createElement(
      _e.Password,
      {
        value: c,
        onChange: (C) => d(C.target.value),
        placeholder: e("volcengineApiKeyPlaceholder")
      }
    )), /* @__PURE__ */ a.createElement(se.Item, { label: e("volcengineResourceIdLabel") }, /* @__PURE__ */ a.createElement(
      _e,
      {
        value: i,
        onChange: (C) => g(C.target.value),
        placeholder: k
      }
    )))
  );
}
function Nt() {
  const { t: e } = K(), [t, o] = S(he), [n, r] = S(pe), [c, d] = S(!1), i = Be(/* @__PURE__ */ new Set()), g = te(
    (u) => {
      if (!c) return;
      if (u.preventDefault(), u.stopPropagation(), Pe.has(u.code)) {
        i.current.add(u.code);
        return;
      }
      const s = i.current, f = {
        ctrl: s.has("ControlLeft") || s.has("ControlRight"),
        shift: s.has("ShiftLeft") || s.has("ShiftRight"),
        alt: s.has("AltLeft") || s.has("AltRight"),
        meta: s.has("MetaLeft") || s.has("MetaRight"),
        code: u.code
      };
      o(f), ae(f, n), d(!1), i.current.clear();
    },
    [c, n]
  ), l = te(
    (u) => {
      if (c && (u.preventDefault(), u.stopPropagation(), Pe.has(u.code) && (i.current.delete(u.code), i.current.size === 0))) {
        const s = {
          ctrl: !1,
          shift: !1,
          alt: !1,
          meta: !1,
          code: u.code
        };
        o(s), ae(s, n), d(!1);
      }
    },
    [c, n]
  );
  return ze(() => {
    if (c)
      return i.current.clear(), document.addEventListener("keydown", g, !0), document.addEventListener("keyup", l, !0), () => {
        document.removeEventListener("keydown", g, !0), document.removeEventListener("keyup", l, !0);
      };
  }, [c, g, l]), /* @__PURE__ */ a.createElement(Ee, { style: we }, /* @__PURE__ */ a.createElement("h3", { style: Se }, e("shortcutTitle")), /* @__PURE__ */ a.createElement("p", { style: oe }, e("shortcutDesc")), /* @__PURE__ */ a.createElement(ne, { direction: "vertical", size: "middle", style: { width: "100%" } }, /* @__PURE__ */ a.createElement("div", null, /* @__PURE__ */ a.createElement("div", { style: { marginBottom: 4, fontWeight: 500 } }, e("shortcutKey")), /* @__PURE__ */ a.createElement(
    x,
    {
      onClick: () => d(!0),
      style: { minWidth: 200, textAlign: "center" }
    },
    c ? /* @__PURE__ */ a.createElement("span", { style: { color: "#1890ff" } }, e("shortcutCapturing")) : /* @__PURE__ */ a.createElement(We, { color: "blue", style: { fontSize: 14, padding: "2px 8px" } }, ct(t))
  )), /* @__PURE__ */ a.createElement("div", null, /* @__PURE__ */ a.createElement("div", { style: { marginBottom: 4, fontWeight: 500 } }, e("shortcutMode")), /* @__PURE__ */ a.createElement(
    le.Group,
    {
      value: n,
      onChange: (u) => {
        const s = u.target.value;
        r(s), ae(t, s);
      }
    },
    /* @__PURE__ */ a.createElement(ne, { direction: "vertical", size: "small" }, /* @__PURE__ */ a.createElement(le, { value: "toggle" }, /* @__PURE__ */ a.createElement("span", { style: De }, e("shortcutModeToggle")), /* @__PURE__ */ a.createElement("span", { style: Oe }, e("shortcutModeToggleDesc"))), /* @__PURE__ */ a.createElement(le, { value: "hold" }, /* @__PURE__ */ a.createElement("span", { style: De }, e("shortcutModeHold")), /* @__PURE__ */ a.createElement("span", { style: Oe }, e("shortcutModeHoldDesc"))))
  ))));
}
function Ne() {
  const { t: e } = K();
  return /* @__PURE__ */ a.createElement(
    "div",
    {
      style: {
        padding: 24,
        maxWidth: 760,
        margin: "0 auto",
        height: "100%",
        overflowY: "auto"
      }
    },
    /* @__PURE__ */ a.createElement("h2", { style: { margin: "0 0 4px", fontSize: 20 } }, e("title")),
    /* @__PURE__ */ a.createElement("p", { style: oe }, e("description")),
    /* @__PURE__ */ a.createElement(Ot, null),
    /* @__PURE__ */ a.createElement(Pt, null),
    /* @__PURE__ */ a.createElement(Nt, null)
  );
}
const j = "qwenpaw-voice", { React: V, antdIcons: G } = b(), { useEffect: $, useRef: $t, useState: xt } = V, Vt = G != null && G.AudioOutlined ? V.createElement(G.AudioOutlined) : "🎤";
function Kt() {
  const e = $t(null), t = Ct(), [o, n] = xt(fe);
  return $(() => {
    const r = () => n(fe()), c = (d) => {
      d.key === Z && r();
    };
    return window.addEventListener(ee, r), window.addEventListener("storage", c), () => {
      window.removeEventListener(ee, r), window.removeEventListener("storage", c);
    };
  }, []), $(() => {
    const r = () => {
      var i, g;
      (i = e.current) != null && i.isRecording() && e.current.toggleRecording(), (g = e.current) == null || g.resetSession(), t.stopOnSubmit();
    }, c = (i) => {
      const g = i.target;
      !g || g.tagName !== "TEXTAREA" || i.key === "Enter" && !i.shiftKey && r();
    }, d = (i) => {
      var u;
      const g = (u = i.target) == null ? void 0 : u.closest(
        'button, [role="button"]'
      );
      if (!g) return;
      (g.getAttribute("aria-label") || g.className || "").toLowerCase().includes("send") && r();
    };
    return document.addEventListener("keydown", c, !0), document.addEventListener("click", d, !0), () => {
      document.removeEventListener("keydown", c, !0), document.removeEventListener("click", d, !0);
    };
  }, []), $(() => {
    if (!o) return;
    let r = he(), c = pe(), d = !1;
    const i = () => {
      const s = window.location.pathname.replace(/^\/console(?=\/|$)/, "");
      return s.startsWith("/chat") || s.startsWith("/coding");
    }, g = () => {
      r = he(), c = pe();
    };
    window.addEventListener("storage", g);
    const l = (s) => {
      var f;
      i() && ye() && be(s, r) && (s.preventDefault(), c === "hold" ? e.current && !e.current.isRecording() && (e.current.toggleRecording(), d = !0) : (f = e.current) == null || f.toggleRecording());
    }, u = (s) => {
      var f;
      c !== "hold" || !d || be(s, r) && (s.preventDefault(), (f = e.current) != null && f.isRecording() && e.current.toggleRecording(), d = !1);
    };
    return document.addEventListener("keydown", l), document.addEventListener("keyup", u), () => {
      document.removeEventListener("keydown", l), document.removeEventListener("keyup", u), window.removeEventListener("storage", g);
    };
  }, [o]), $(() => {
    if (!o) return;
    const r = (c) => {
      var g, l;
      const d = (g = c.target) == null ? void 0 : g.closest(
        ".spark-icon-spark-mic-line"
      );
      !d || !d.closest("button") || (c.stopPropagation(), c.preventDefault(), (l = e.current) == null || l.toggleRecording());
    };
    return document.addEventListener("click", r, !0), () => document.removeEventListener("click", r, !0);
  }, [o]), $(() => {
    if (!o) return;
    const c = setInterval(() => {
      var l, u;
      const d = (l = e.current) == null ? void 0 : l.isRecording(), i = (u = e.current) == null ? void 0 : u.isLoading(), g = document.querySelectorAll(".spark-icon-spark-mic-line");
      for (const s of Array.from(g)) {
        const f = s.closest("button");
        if (f && f.offsetParent !== null) {
          f.style.color = d || i ? "#1890ff" : "";
          break;
        }
      }
    }, 200);
    return () => clearInterval(c);
  }, [o]), o ? /* @__PURE__ */ V.createElement(
    "div",
    {
      style: {
        position: "absolute",
        width: 0,
        height: 0,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none"
      },
      "aria-hidden": "true"
    },
    /* @__PURE__ */ V.createElement(
      qe,
      {
        ref: e,
        onTranscription: t.handleTranscription,
        onStart: t.onStart
      }
    )
  ) : null;
}
function $e() {
  var t, o, n, r;
  const e = Q();
  if (!e) {
    console.warn("[qwenpaw-voice] window.QwenPaw not ready");
    return;
  }
  Xe().then(() => {
    try {
      window.dispatchEvent(new CustomEvent(ee));
    } catch {
    }
  }), (t = e.route) != null && t.add && e.route.add(j, {
    id: "qwenpaw-voice.settings",
    path: "/qwenpaw-voice",
    component: Ne
  }), (o = e.menu) != null && o.add ? e.menu.add(j, {
    id: "qwenpaw-voice.settings",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: () => xe(J(), "title"),
    icon: Vt,
    route: "qwenpaw-voice.settings",
    order: 50
  }) : e.registerRoutes && e.registerRoutes(j, [
    {
      path: "/qwenpaw-voice",
      component: Ne,
      label: "语音输入",
      icon: "🎤",
      priority: 50
    }
  ]), (r = (n = e.chat) == null ? void 0 : n.sender) != null && r.addPrefix ? e.chat.sender.addPrefix(j, /* @__PURE__ */ V.createElement(Kt, null), {
    id: "qwenpaw-voice.mic",
    order: 0
  }) : console.warn(
    "[qwenpaw-voice] chat.sender.addPrefix unavailable; mic not mounted"
  ), console.info("[qwenpaw-voice] registered");
}
if (Q())
  $e();
else {
  let e = 0;
  const t = setInterval(() => {
    e += 1, Q() ? (clearInterval(t), $e()) : e > 50 && (clearInterval(t), console.error("[qwenpaw-voice] host never became available"));
  }, 100);
}
