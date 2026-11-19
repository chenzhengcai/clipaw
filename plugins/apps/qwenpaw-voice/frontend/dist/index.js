function ne() {
  return window.QwenPaw;
}
function M() {
  const e = ne();
  if (!(e != null && e.host))
    throw new Error("[qwenpaw-voice] window.QwenPaw.host not available");
  return e.host;
}
function st(e) {
  return M().getApiUrl(e);
}
async function P(e, t = {}) {
  var a;
  const r = M(), n = new Headers(t.headers), c = (a = r.getApiToken) == null ? void 0 : a.call(r);
  return c && n.set("Authorization", `Bearer ${c}`), t.body && !n.has("Content-Type") && n.set("Content-Type", "application/json"), fetch(st(e), { ...t, headers: n });
}
const le = M().React, Te = {
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
function ee() {
  try {
    return (localStorage.getItem("language") || localStorage.getItem("i18nextLng") || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}
function Ue(e, t, r) {
  let n = Te[e][t] ?? Te.en[t] ?? t;
  if (r)
    for (const [c, a] of Object.entries(r))
      n = n.replace(new RegExp(`\\{\\{${c}\\}\\}`, "g"), String(a));
  return n;
}
function W() {
  const [e, t] = le.useState(ee);
  return le.useEffect(() => {
    const n = (c) => {
      (c.key === "language" || c.key === "i18nextLng") && t(ee());
    };
    return window.addEventListener("storage", n), t(ee()), () => window.removeEventListener("storage", n);
  }, []), { t: le.useCallback(
    (n, c) => Ue(e, n, c),
    [e]
  ), locale: e };
}
const it = /* @__PURE__ */ new Set([
  "voice_connected",
  "qwenpaw_voice_shortcut",
  "qwenpaw_voice_shortcut_mode",
  "qwenpaw_voice_enabled"
]);
let ke = !1;
async function at() {
  if (!ke) {
    try {
      const e = await P("/qwenpaw-voice/client-config");
      if (!e.ok) return;
      const t = await e.json();
      if (t && typeof t == "object")
        for (const [r, n] of Object.entries(t))
          it.has(r) && n !== void 0 && n !== null && localStorage.setItem(r, String(n));
    } catch {
    }
    ke = !0;
  }
}
async function re(e, t) {
  try {
    localStorage.setItem(e, t);
  } catch {
  }
  try {
    await P("/qwenpaw-voice/client-config", {
      method: "PUT",
      body: JSON.stringify({ [e]: t })
    });
  } catch {
  }
}
function lt(e) {
  return localStorage.getItem(e);
}
function ut(e) {
  try {
    localStorage.removeItem(e);
  } catch {
  }
  P("/qwenpaw-voice/client-config", {
    method: "PUT",
    body: JSON.stringify({ [e]: "" })
  }).catch(() => {
  });
}
const Ce = "voice_connected", me = "qwenpaw_voice_shortcut", ve = "qwenpaw_voice_shortcut_mode", oe = "qwenpaw_voice_enabled", $ = "qwenpaw-voice-change", ye = "volcengine_asr_api_key", He = "volcengine_asr_resource_id", O = "volc.bigasr.sauc.duration";
function ue() {
  ut(Ce);
}
function N() {
  return lt(Ce) === "1";
}
async function dt() {
  await re(Ce, "1");
}
function we() {
  try {
    return localStorage.getItem(oe) !== "0";
  } catch {
    return !0;
  }
}
async function ft(e) {
  const t = e ? "1" : "0";
  try {
    localStorage.setItem(oe, t);
  } catch {
  }
  try {
    await re(oe, t);
  } catch {
  }
  try {
    window.dispatchEvent(new CustomEvent($));
  } catch {
  }
}
function We() {
  return /Mac|iP(hone|[ao]d)/.test(navigator.platform || navigator.userAgent);
}
function gt() {
  const e = We();
  return { ctrl: !e, shift: !0, alt: !1, meta: e, code: "KeyM" };
}
function Ee() {
  try {
    const e = localStorage.getItem(me);
    if (e) return JSON.parse(e);
  } catch {
  }
  return gt();
}
function Se() {
  return localStorage.getItem(ve) === "hold" ? "hold" : "toggle";
}
async function de(e, t) {
  localStorage.setItem(me, JSON.stringify(e)), localStorage.setItem(ve, t);
  try {
    await re(me, JSON.stringify(e)), await re(ve, t);
  } catch {
  }
}
const ht = /* @__PURE__ */ new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight"
]);
function Le(e, t) {
  return (ht.has(t.code) || e.ctrlKey === t.ctrl && e.shiftKey === t.shift && e.altKey === t.alt && e.metaKey === t.meta) && e.code === t.code;
}
function pt(e) {
  const t = We(), r = {
    AltLeft: t ? "⌥" : "Alt",
    AltRight: t ? "⌥" : "Alt",
    ControlLeft: t ? "⌃" : "Ctrl",
    ControlRight: t ? "⌃" : "Ctrl",
    ShiftLeft: t ? "⇧" : "Shift",
    ShiftRight: t ? "⇧" : "Shift",
    MetaLeft: t ? "⌘" : "Win",
    MetaRight: t ? "⌘" : "Win"
  };
  if (r[e.code]) return r[e.code];
  const n = [];
  e.ctrl && n.push(t ? "⌃" : "Ctrl"), e.alt && n.push(t ? "⌥" : "Alt"), e.shift && n.push(t ? "⇧" : "Shift"), e.meta && n.push(t ? "⌘" : "Win");
  const c = e.code.replace(/^Key/, "").replace(/^Digit/, "").replace("Comma", ",").replace("Period", ".").replace("Slash", "/").replace("Backslash", "\\").replace("BracketLeft", "[").replace("BracketRight", "]").replace("Minus", "-").replace("Equal", "=").replace("Semicolon", ";").replace("Quote", "'").replace("Backquote", "`").replace("Space", "Space");
  return n.push(c), n.join(t ? "" : "+");
}
async function mt() {
  try {
    const e = await P("/envs");
    if (!e.ok) throw new Error("envs fetch failed");
    const t = await e.json(), r = {};
    for (const n of t) r[n.key] = n.value;
    return {
      apiKey: r[ye] ?? "",
      resourceId: r[He] ?? O
    };
  } catch {
    return { apiKey: "", resourceId: O };
  }
}
async function vt(e, t) {
  const r = await P("/envs"), n = {};
  if (r.ok) {
    const c = await r.json();
    for (const a of c) n[a.key] = a.value;
  }
  delete n.volcengine_asr_app_id, delete n.volcengine_asr_access_token, e ? n[ye] = e : delete n[ye], n[He] = t || O, await P("/envs", {
    method: "PUT",
    body: JSON.stringify(n)
  });
}
async function yt(e) {
  return await (await P("/qwenpaw-voice/voice-test-connection", {
    method: "POST",
    body: JSON.stringify(e ?? {})
  })).json();
}
const { React: E, antd: wt, antdIcons: Et } = M(), { Tooltip: St, message: x, Button: Rt } = wt, { LoadingOutlined: Ct } = Et, {
  useCallback: K,
  useRef: L,
  useState: fe,
  forwardRef: bt,
  useImperativeHandle: At,
  useEffect: Me
} = E, _e = 300 * 1e3, Re = 16e3, q = 1e3, B = 4, te = 140, De = te / 2, J = 250, Oe = 500, Y = 0.8, It = ({ className: e }) => /* @__PURE__ */ E.createElement(
  "svg",
  {
    viewBox: `0 0 ${q} ${q}`,
    xmlns: "http://www.w3.org/2000/svg",
    className: e,
    style: {
      color: "#1890ff",
      height: "1.2em",
      width: "1.2em",
      verticalAlign: "top"
    }
  },
  /* @__PURE__ */ E.createElement("title", null, "Speech Recording"),
  Array.from({ length: B }).map((t, r) => {
    const n = (q - te * B) / (B - 1), c = r * (n + te), a = q / 2 - J / 2, g = q / 2 - Oe / 2;
    return /* @__PURE__ */ E.createElement(
      "rect",
      {
        fill: "currentColor",
        rx: De,
        ry: De,
        height: J,
        width: te,
        x: c,
        y: a,
        key: r
      },
      /* @__PURE__ */ E.createElement(
        "animate",
        {
          attributeName: "height",
          values: `${J}; ${Oe}; ${J}`,
          keyTimes: "0; 0.5; 1",
          dur: `${Y}s`,
          begin: `${Y / B * r}s`,
          repeatCount: "indefinite"
        }
      ),
      /* @__PURE__ */ E.createElement(
        "animate",
        {
          attributeName: "y",
          values: `${a}; ${g}; ${a}`,
          keyTimes: "0; 0.5; 1",
          dur: `${Y}s`,
          begin: `${Y / B * r}s`,
          repeatCount: "indefinite"
        }
      )
    );
  })
), Tt = () => /* @__PURE__ */ E.createElement(
  "span",
  {
    className: "spark-icon spark-icon-spark-mic-line",
    role: "img",
    "aria-label": "spark-mic-line",
    "data-spark-icon": "true"
  },
  /* @__PURE__ */ E.createElement(
    "svg",
    {
      viewBox: "0 0 1024 1024",
      width: "1em",
      height: "1em",
      overflow: "hidden",
      fill: "currentColor",
      "aria-hidden": "true"
    },
    /* @__PURE__ */ E.createElement("path", { d: "M285.216 562.9408a248.64 248.64 0 0 0 37.6448 59.7312 249.008 249.008 0 0 0 52.5056 46.64 245.5232 245.5232 0 0 0 64.0672 30.288c23.52 7.2032 47.712 10.8032 72.5664 10.8032 24.8544 0 49.0432-3.6 72.5664-10.8032a245.5296 245.5296 0 0 0 64.0672-30.288 248.896 248.896 0 0 0 52.5056-46.64 248.5888 248.5888 0 0 0 37.648-59.7312 32 32 0 1 1 58.4256 26.1184 312.2432 312.2432 0 0 1-47.2832 75.0336 312.6752 312.6752 0 0 1-65.936 58.5664 309.168 309.168 0 0 1-80.688 38.1376C573.6768 769.8688 543.2416 774.4 512 774.4c-31.2416 0-61.6768-4.5344-91.3056-13.6064a309.184 309.184 0 0 1-80.688-38.1376 312.6912 312.6912 0 0 1-65.936-58.5664 312.32 312.32 0 0 1-47.2832-75.0336 32 32 0 1 1 58.4256-26.1184z" }),
    /* @__PURE__ */ E.createElement("path", { d: "M339.4304 219.68a183.6896 183.6896 0 0 1 41.3312-62.9184 183.6896 183.6896 0 0 1 62.9184-41.3312A183.9712 183.9712 0 0 1 512 102.4a183.9712 183.9712 0 0 1 68.32 13.0304 183.6896 183.6896 0 0 1 62.9184 41.3312 183.696 183.696 0 0 1 41.3312 62.9184A183.9616 183.9616 0 0 1 697.6 288v198.4a183.952 183.952 0 0 1-13.0304 68.3168 183.7088 183.7088 0 0 1-41.3312 62.9216 183.6896 183.6896 0 0 1-62.9184 41.3312A183.9616 183.9616 0 0 1 512 672a183.9616 183.9616 0 0 1-68.32-13.0304 183.6896 183.6896 0 0 1-62.9184-41.3312 183.7024 183.7024 0 0 1-41.3312-62.9216A183.9616 183.9616 0 0 1 326.4 486.4V288a183.9712 183.9712 0 0 1 13.0304-68.32z m86.5856 352.704a120.3392 120.3392 0 0 0 41.2224 27.0784A120.512 120.512 0 0 0 512 608a120.512 120.512 0 0 0 44.7616-8.5376 120.3392 120.3392 0 0 0 41.2224-27.0784 120.3584 120.3584 0 0 0 27.0784-41.2224A120.544 120.544 0 0 0 633.6 486.4V288c0-15.4624-2.848-30.384-8.5376-44.7616a120.3552 120.3552 0 0 0-27.0784-41.2224 120.3552 120.3552 0 0 0-41.2224-27.0784A120.5344 120.5344 0 0 0 512 166.4c-15.4624 0-30.384 2.848-44.7616 8.5376a120.3552 120.3552 0 0 0-41.2224 27.0784 120.3552 120.3552 0 0 0-27.0784 41.2224A120.5312 120.5312 0 0 0 390.4 288v198.4c0 15.4624 2.848 30.384 8.5376 44.7616a120.3584 120.3584 0 0 0 27.0784 41.2224zM512 710.4c17.6736 0 32 14.3264 32 32v147.2c0 17.6736-14.3264 32-32 32s-32-14.3264-32-32v-147.2c0-17.6736 14.3264-32 32-32z" }),
    /* @__PURE__ */ E.createElement("path", { d: "M352 889.6c0-17.6736 14.3264-32 32-32h256c17.6736 0 32 14.3264 32 32s-14.3264 32-32 32h-256c-17.6736 0-32-14.3264-32-32z" })
  )
);
function kt(e) {
  const t = M().getApiUrl(e);
  return t.startsWith("https://") ? t.replace("https://", "wss://") : t.startsWith("http://") ? t.replace("http://", "ws://") : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${t}`;
}
function Lt(e, t) {
  if (t === Re) {
    const a = new Int16Array(e.length);
    for (let g = 0; g < e.length; g++)
      a[g] = Math.max(-32768, Math.min(32767, Math.round(e[g] * 32767)));
    return a;
  }
  const r = t / Re, n = Math.floor(e.length / r), c = new Int16Array(n);
  for (let a = 0; a < n; a++) {
    const g = a * r, i = Math.floor(g), f = Math.min(i + 1, e.length - 1), u = g - i, l = e[i] * (1 - u) + e[f] * u;
    c[a] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
  }
  return c;
}
function Mt(e) {
  const t = new ArrayBuffer(e.length * 2), r = new DataView(t);
  for (let n = 0; n < e.length; n++)
    r.setInt16(n * 2, e[n], !0);
  return t;
}
const Fe = bt(
  ({ disabled: e, onTranscription: t, onStart: r }, n) => {
    const { t: c } = W(), [a, g] = fe(!1), [i, f] = fe(!1), u = L(!1), l = L(!1), s = L(null), h = L(null), m = L(null), y = L(null), p = L(!1), S = L(
      null
    ), b = L(""), [_, d] = fe(N);
    Me(() => {
      const v = () => {
        const V = N();
        d((I) => I === V ? I : V);
      }, C = setInterval(v, 1e3);
      return window.addEventListener($, v), () => {
        clearInterval(C), window.removeEventListener($, v);
      };
    }, []);
    const k = K((v) => {
      u.current = v, f(v);
    }, []), R = K(() => {
      if (S.current && (clearTimeout(S.current), S.current = null), m.current) {
        try {
          m.current.disconnect();
        } catch {
        }
        m.current = null;
      }
      if (h.current) {
        try {
          h.current.close();
        } catch {
        }
        h.current = null;
      }
      y.current && (y.current.getTracks().forEach((C) => C.stop()), y.current = null);
      const v = s.current;
      if (s.current = null, v) {
        v.onopen = null, v.onmessage = null;
        try {
          v.readyState === WebSocket.OPEN && v.send("DONE");
        } catch {
        }
        try {
          v.close();
        } catch {
        }
      }
      p.current = !1, l.current = !1, g(!1), k(!1);
    }, [k]);
    Me(() => R, [R]);
    const A = K(() => {
      if (p.current) {
        if (p.current = !1, g(!1), k(!0), m.current) {
          try {
            m.current.disconnect();
          } catch {
          }
          m.current = null;
        }
        if (h.current) {
          try {
            h.current.close();
          } catch {
          }
          h.current = null;
        }
        y.current && (y.current.getTracks().forEach((v) => v.stop()), y.current = null), S.current && (clearTimeout(S.current), S.current = null), s.current && s.current.readyState === WebSocket.OPEN && s.current.send("DONE");
      }
    }, [k]), D = K(async () => {
      if (!(p.current || u.current)) {
        l.current = !0, r == null || r(), k(!0);
        try {
          const v = kt("/qwenpaw-voice/transcribe/ws"), C = new WebSocket(v);
          C.binaryType = "arraybuffer", C.onopen = async () => {
            if (s.current === C)
              try {
                const I = await navigator.mediaDevices.getUserMedia({
                  audio: {
                    channelCount: 1,
                    sampleRate: { ideal: Re }
                  }
                });
                if (s.current !== C) {
                  I.getTracks().forEach((ae) => ae.stop());
                  return;
                }
                y.current = I;
                const w = new AudioContext({
                  sampleRate: I.getAudioTracks()[0].getSettings().sampleRate
                });
                h.current = w;
                const tt = w.createMediaStreamSource(I), G = w.createScriptProcessor(4096, 1, 1);
                m.current = G;
                const nt = w.sampleRate;
                G.onaudioprocess = (ae) => {
                  if (!p.current || C.readyState !== WebSocket.OPEN) return;
                  const rt = ae.inputBuffer.getChannelData(0), ot = Lt(rt, nt), ct = Mt(ot);
                  C.send(ct);
                }, tt.connect(G), G.connect(w.destination), p.current = !0, l.current = !1, g(!0), k(!1), S.current = setTimeout(() => {
                  p.current && (x.warning(
                    c("recordingTooLong", {
                      limit: _e / 1e3
                    })
                  ), A());
                }, _e);
              } catch (I) {
                console.error("Microphone access error:", I), x.error(c("microphoneError")), R();
              }
          };
          let V = !1;
          C.onmessage = (I) => {
            try {
              const w = JSON.parse(I.data);
              w.type === "partial" && w.text ? (t(w.text, !0), b.current = w.text) : w.type === "final" ? (V = !0, w.text ? (t(w.text, !1), b.current = w.text) : b.current && t(b.current, !1), R()) : w.type === "error" && (x.error(w.message || c("transcriptionFailed")), R());
            } catch {
            }
          }, C.onclose = () => {
            if (s.current !== C) {
              R();
              return;
            }
            u.current && !V && (b.current ? t(b.current, !1) : x.error(c("transcriptionFailed"))), R();
          }, s.current = C;
        } catch (v) {
          console.error("Microphone setup error:", v), x.error(c("microphoneError")), R();
        }
      }
    }, [t, r, c, A, R, k]), F = K(() => {
      if (!N()) {
        x.warning(c("notConnected"));
        return;
      }
      if (l.current) {
        R();
        return;
      }
      u.current || (p.current ? A() : (b.current = "", D()));
    }, [D, A, R, c]), j = K(() => {
      b.current = "", s.current && s.current.readyState === WebSocket.OPEN && s.current.send("RESET");
    }, []);
    At(
      n,
      () => ({
        toggleRecording: F,
        isRecording: () => p.current || l.current,
        isLoading: () => u.current,
        resetSession: j
      }),
      [F, j]
    );
    const Ze = e || u.current || !_, et = c(i ? "transcribing" : a ? "stopRecording" : "startRecording");
    return /* @__PURE__ */ E.createElement(
      St,
      {
        title: c(_ ? i ? "transcribing" : a ? "stopRecording" : "startRecording" : "notConnected"),
        mouseEnterDelay: 0.5
      },
      /* @__PURE__ */ E.createElement(
        Rt,
        {
          type: "text",
          "aria-label": et,
          className: "qwenpaw-sender-actions-btn qwenpaw-spark-icon-button spark-button",
          icon: i ? /* @__PURE__ */ E.createElement(Ct, { style: { fontSize: "1.2em" } }) : a ? /* @__PURE__ */ E.createElement(It, null) : /* @__PURE__ */ E.createElement(Tt, null),
          onClick: _ ? F : void 0,
          disabled: Ze,
          style: {
            // Mirror the official design-lib Button exactly: it renders an
            // antd Button with { fontWeight: 500, lineHeight: 1 } and passes
            // the icon through unchanged. Same antd defaults ⇒ same box size.
            fontWeight: 500,
            lineHeight: 1,
            color: a || i ? "#1890ff" : void 0
          }
        }
      )
    );
  }
);
Fe.displayName = "SpeechButton";
const { React: _t } = M(), { useCallback: Q, useRef: ge } = _t;
function Pe() {
  const e = (c) => c.offsetParent !== null, t = Array.from(
    document.querySelectorAll(
      'textarea[data-sender-input="true"]'
    )
  ), r = t.find(e) ?? t[0];
  if (r) return r;
  for (const c of Array.from(
    document.querySelectorAll('[class*="sender"]')
  )) {
    const a = c.querySelector("textarea");
    if (a && e(a)) return a;
  }
  const n = document.activeElement;
  return n instanceof HTMLTextAreaElement ? n : null;
}
function xe(e, t) {
  var c;
  const r = Object.getPrototypeOf(e), n = (c = Object.getOwnPropertyDescriptor(r, "value")) == null ? void 0 : c.set;
  n ? n.call(e, t) : e.value = t, e.dispatchEvent(new Event("input", { bubbles: !0 }));
}
function Dt() {
  const e = ge(""), t = ge(0), r = ge(!1), n = Q((i, f = !1) => {
    if (!r.current) return;
    const u = Pe();
    if (!u) return;
    const l = u.value || "";
    if (f) {
      const s = l.length - t.current, h = s > 0 ? l.slice(0, s) : "";
      t.current = i.length;
      const m = h ? `${h}${i}` : i;
      xe(u, m);
    } else {
      t.current = 0;
      const s = e.current ? `${e.current}${i}` : i;
      xe(u, s);
    }
    u.focus();
  }, []), c = Q(() => {
    const i = Pe();
    e.current = (i == null ? void 0 : i.value) || "", t.current = 0, r.current = !0;
  }, []), a = Q(() => {
    e.current = "", t.current = 0, r.current = !1;
  }, []), g = Q(() => r.current, []);
  return { handleTranscription: n, onStart: c, stopOnSubmit: a, isActive: g };
}
const o = M().React, { useCallback: ce, useEffect: je, useRef: Ge, useState: T } = o, { antd: Ot, antdIcons: Pt } = M(), { Card: be, Input: Ke, Form: he, Button: U, Space: se, message: xt, Switch: Kt, Tag: Je, Radio: pe } = Ot, { EditOutlined: Nt, CloseOutlined: $t, CheckOutlined: Vt, ApiOutlined: qt } = Pt, Bt = 15e3, Ae = {
  marginBottom: 16,
  borderRadius: 8
}, Ie = {
  margin: "0 0 4px",
  fontSize: 15,
  fontWeight: 600
}, ie = {
  margin: "0 0 12px",
  color: "var(--ant-color-text-secondary, rgba(0,0,0,0.45))",
  fontSize: 13
}, zt = {
  color: "var(--ant-color-text-tertiary, rgba(0,0,0,0.35))",
  fontSize: 13,
  lineHeight: 2
}, Ne = {
  fontWeight: 500,
  marginRight: 6
}, $e = {
  color: "var(--ant-color-text-secondary, rgba(0,0,0,0.45))",
  fontSize: 12
}, Ve = /* @__PURE__ */ new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight"
]);
function Ut() {
  const { t: e } = W(), [t, r] = T(we);
  return /* @__PURE__ */ o.createElement(be, { style: Ae }, /* @__PURE__ */ o.createElement("h3", { style: Ie }, e("toggleTitle")), /* @__PURE__ */ o.createElement("p", { style: ie }, e("toggleDesc")), /* @__PURE__ */ o.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } }, /* @__PURE__ */ o.createElement(
    Kt,
    {
      checked: t,
      onChange: (n) => {
        r(n), ft(n);
      }
    }
  ), /* @__PURE__ */ o.createElement(Je, { color: t ? "green" : "default" }, e(t ? "toggleOn" : "toggleOff"))));
}
function Ht() {
  const { t: e } = W(), [t, r] = xt.useMessage(), [n, c] = T(!1), [a, g] = T(""), [i, f] = T(O), [u, l] = T(!1), [s, h] = T(!1), [m, y] = T(N), p = Ge(!1), S = ce(async () => {
    const { apiKey: A, resourceId: D } = await mt();
    g(A), f(D || O), l(!0);
  }, []);
  je(() => {
    S();
  }, [S]);
  const b = ce(async () => {
    if (!p.current) {
      p.current = !0, h(!0);
      try {
        const A = n ? {
          api_key: a,
          resource_id: i || O
        } : void 0, D = await Promise.race([
          yt(A),
          new Promise(
            (F, j) => setTimeout(
              () => j(new Error(e("testFailed"))),
              Bt
            )
          )
        ]);
        D.ok ? (await dt(), y(!0), t.success(e("testSuccess"))) : (ue(), y(!1), t.error(D.error || e("testFailed")));
      } catch {
        ue(), y(!1), t.error(e("testFailed"));
      } finally {
        p.current = !1, h(!1);
      }
    }
  }, [e, n, a, i, t]), _ = async () => {
    ue(), y(!1);
    try {
      await vt(a, i), c(!1);
    } catch {
      t.error(e("testFailed"));
    }
  }, d = !!a, k = n ? !!a : d, R = /* @__PURE__ */ o.createElement(
    U,
    {
      size: "small",
      icon: o.createElement(qt),
      onClick: b,
      loading: s,
      disabled: !k
    },
    s ? e("testing") : m ? `${e("testConnected")} ✓` : e("testConnection")
  );
  return /* @__PURE__ */ o.createElement(
    be,
    {
      style: Ae,
      extra: n ? /* @__PURE__ */ o.createElement(se, { size: "small" }, R, /* @__PURE__ */ o.createElement(
        U,
        {
          size: "small",
          icon: o.createElement($t),
          onClick: () => {
            c(!1), S();
          }
        },
        e("cancel", { defaultValue: "Cancel" })
      ), /* @__PURE__ */ o.createElement(
        U,
        {
          size: "small",
          type: "primary",
          icon: o.createElement(Vt),
          onClick: _
        },
        e("save", { defaultValue: "Save" })
      )) : /* @__PURE__ */ o.createElement(se, { size: "small" }, R, /* @__PURE__ */ o.createElement(
        U,
        {
          size: "small",
          icon: o.createElement(Nt),
          onClick: () => c(!0)
        },
        e("edit", { defaultValue: "Edit" })
      ))
    },
    r,
    /* @__PURE__ */ o.createElement("h3", { style: Ie }, e("volcengineConfigTitle")),
    /* @__PURE__ */ o.createElement("p", { style: ie }, e("volcengineConfigDesc")),
    !n && u && /* @__PURE__ */ o.createElement("div", { style: zt }, d ? /* @__PURE__ */ o.createElement(o.Fragment, null, /* @__PURE__ */ o.createElement("div", null, e("volcengineApiKeyLabel"), ": ****"), /* @__PURE__ */ o.createElement("div", null, e("volcengineResourceIdLabel"), ": ", i)) : /* @__PURE__ */ o.createElement("div", { style: { fontStyle: "italic" } }, e("volcengineNotConfigured"))),
    n && /* @__PURE__ */ o.createElement(he, { layout: "vertical" }, /* @__PURE__ */ o.createElement(he.Item, { label: e("volcengineApiKeyLabel") }, /* @__PURE__ */ o.createElement(
      Ke.Password,
      {
        value: a,
        onChange: (A) => g(A.target.value),
        placeholder: e("volcengineApiKeyPlaceholder")
      }
    )), /* @__PURE__ */ o.createElement(he.Item, { label: e("volcengineResourceIdLabel") }, /* @__PURE__ */ o.createElement(
      Ke,
      {
        value: i,
        onChange: (A) => f(A.target.value),
        placeholder: O
      }
    )))
  );
}
function Wt() {
  const { t: e } = W(), [t, r] = T(Ee), [n, c] = T(Se), [a, g] = T(!1), i = Ge(/* @__PURE__ */ new Set()), f = ce(
    (l) => {
      if (!a) return;
      if (l.preventDefault(), l.stopPropagation(), Ve.has(l.code)) {
        i.current.add(l.code);
        return;
      }
      const s = i.current, h = {
        ctrl: s.has("ControlLeft") || s.has("ControlRight"),
        shift: s.has("ShiftLeft") || s.has("ShiftRight"),
        alt: s.has("AltLeft") || s.has("AltRight"),
        meta: s.has("MetaLeft") || s.has("MetaRight"),
        code: l.code
      };
      r(h), de(h, n), g(!1), i.current.clear();
    },
    [a, n]
  ), u = ce(
    (l) => {
      if (a && (l.preventDefault(), l.stopPropagation(), Ve.has(l.code) && (i.current.delete(l.code), i.current.size === 0))) {
        const s = {
          ctrl: !1,
          shift: !1,
          alt: !1,
          meta: !1,
          code: l.code
        };
        r(s), de(s, n), g(!1);
      }
    },
    [a, n]
  );
  return je(() => {
    if (a)
      return i.current.clear(), document.addEventListener("keydown", f, !0), document.addEventListener("keyup", u, !0), () => {
        document.removeEventListener("keydown", f, !0), document.removeEventListener("keyup", u, !0);
      };
  }, [a, f, u]), /* @__PURE__ */ o.createElement(be, { style: Ae }, /* @__PURE__ */ o.createElement("h3", { style: Ie }, e("shortcutTitle")), /* @__PURE__ */ o.createElement("p", { style: ie }, e("shortcutDesc")), /* @__PURE__ */ o.createElement(se, { direction: "vertical", size: "middle", style: { width: "100%" } }, /* @__PURE__ */ o.createElement("div", null, /* @__PURE__ */ o.createElement("div", { style: { marginBottom: 4, fontWeight: 500 } }, e("shortcutKey")), /* @__PURE__ */ o.createElement(
    U,
    {
      onClick: () => g(!0),
      style: { minWidth: 200, textAlign: "center" }
    },
    a ? /* @__PURE__ */ o.createElement("span", { style: { color: "#1890ff" } }, e("shortcutCapturing")) : /* @__PURE__ */ o.createElement(Je, { color: "blue", style: { fontSize: 14, padding: "2px 8px" } }, pt(t))
  )), /* @__PURE__ */ o.createElement("div", null, /* @__PURE__ */ o.createElement("div", { style: { marginBottom: 4, fontWeight: 500 } }, e("shortcutMode")), /* @__PURE__ */ o.createElement(
    pe.Group,
    {
      value: n,
      onChange: (l) => {
        const s = l.target.value;
        c(s), de(t, s);
      }
    },
    /* @__PURE__ */ o.createElement(se, { direction: "vertical", size: "small" }, /* @__PURE__ */ o.createElement(pe, { value: "toggle" }, /* @__PURE__ */ o.createElement("span", { style: Ne }, e("shortcutModeToggle")), /* @__PURE__ */ o.createElement("span", { style: $e }, e("shortcutModeToggleDesc"))), /* @__PURE__ */ o.createElement(pe, { value: "hold" }, /* @__PURE__ */ o.createElement("span", { style: Ne }, e("shortcutModeHold")), /* @__PURE__ */ o.createElement("span", { style: $e }, e("shortcutModeHoldDesc"))))
  ))));
}
function qe() {
  const { t: e } = W();
  return /* @__PURE__ */ o.createElement(
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
    /* @__PURE__ */ o.createElement("h2", { style: { margin: "0 0 4px", fontSize: 20 } }, e("title")),
    /* @__PURE__ */ o.createElement("p", { style: ie }, e("description")),
    /* @__PURE__ */ o.createElement(Ut, null),
    /* @__PURE__ */ o.createElement(Ht, null),
    /* @__PURE__ */ o.createElement(Wt, null)
  );
}
const X = "qwenpaw-voice", { React: H, antdIcons: Z } = M(), { useEffect: z, useRef: Ft, useState: Be } = H, jt = Z != null && Z.AudioOutlined ? H.createElement(Z.AudioOutlined) : "🎤", Ye = "data-qwenpaw-voice-mic";
function Qe(e) {
  return !!(e != null && e.closest(`[${Ye}]`));
}
function Xe(e) {
  if (!e || Qe(e)) return !1;
  if (e.querySelector(".spark-icon-spark-mic-line") || e.querySelector("svg.lucide-mic")) return !0;
  for (const t of Array.from(e.querySelectorAll("svg > title")))
    if ((t.textContent || "").trim() === "Speech Recording") return !0;
  return !1;
}
function Gt() {
  return document.querySelector('[class$="-sender-prefix"]') || document.querySelector('[class*="sender"]');
}
function Jt() {
  const e = Gt();
  if (!e) return [];
  const t = [];
  for (const r of Array.from(e.querySelectorAll("button")))
    Xe(r) && t.push(r);
  return t;
}
function Yt() {
  const e = Ft(null), t = Dt(), [r, n] = Be(we), [c, a] = Be(!1);
  if (z(() => {
    const i = () => n(we()), f = (u) => {
      u.key === oe && i();
    };
    return window.addEventListener($, i), window.addEventListener("storage", f), () => {
      window.removeEventListener($, i), window.removeEventListener("storage", f);
    };
  }, []), z(() => {
    const i = () => {
      var l, s;
      (l = e.current) != null && l.isRecording() && e.current.toggleRecording(), (s = e.current) == null || s.resetSession(), t.stopOnSubmit();
    }, f = (l) => {
      const s = l.target;
      !s || s.tagName !== "TEXTAREA" || l.key === "Enter" && !l.shiftKey && i();
    }, u = (l) => {
      var m;
      const s = (m = l.target) == null ? void 0 : m.closest(
        'button, [role="button"]'
      );
      if (!s) return;
      (s.getAttribute("aria-label") || s.className || "").toLowerCase().includes("send") && i();
    };
    return document.addEventListener("keydown", f, !0), document.addEventListener("click", u, !0), () => {
      document.removeEventListener("keydown", f, !0), document.removeEventListener("click", u, !0);
    };
  }, []), z(() => {
    if (!r) return;
    let i = Ee(), f = Se(), u = !1;
    const l = () => {
      const d = window.location.pathname.replace(/^\/console(?=\/|$)/, "");
      return d.startsWith("/chat") || d.startsWith("/coding");
    }, s = () => {
      i = Ee(), f = Se();
    };
    window.addEventListener("storage", s);
    const h = () => {
      var d;
      f === "hold" ? e.current && !e.current.isRecording() && (e.current.toggleRecording(), u = !0) : (d = e.current) == null || d.toggleRecording();
    }, m = () => {
      var d;
      f !== "hold" || !u || ((d = e.current) != null && d.isRecording() && e.current.toggleRecording(), u = !1);
    }, y = (d) => {
      l() && N() && Le(d, i) && (d.preventDefault(), h());
    }, p = (d) => {
      Le(d, i) && (d.preventDefault(), m());
    }, S = (d) => (d.ctrlKey || d.metaKey) && d.shiftKey && !d.altKey && d.key.toLowerCase() === "m", b = (d) => {
      S(d) && (!l() || !N() || (d.preventDefault(), d.stopPropagation(), h()));
    }, _ = (d) => {
      S(d) && u && (d.stopPropagation(), m());
    };
    return document.addEventListener("keydown", y), document.addEventListener("keyup", p), document.addEventListener("keydown", b, !0), document.addEventListener("keyup", _, !0), () => {
      document.removeEventListener("keydown", y), document.removeEventListener("keyup", p), document.removeEventListener("keydown", b, !0), document.removeEventListener("keyup", _, !0), window.removeEventListener("storage", s);
    };
  }, [r]), z(() => {
    if (!r) return;
    const i = (f) => {
      var s;
      const u = f.target;
      if (!u || Qe(u)) return;
      const l = u.closest("button");
      Xe(l) && (f.stopPropagation(), f.preventDefault(), (s = e.current) == null || s.toggleRecording());
    };
    return document.addEventListener("click", i, !0), () => document.removeEventListener("click", i, !0);
  }, [r]), z(() => {
    if (!r) return;
    const i = () => {
      var m, y;
      const u = Jt(), l = u.length === 0;
      a((p) => p === l ? p : l);
      const s = (m = e.current) == null ? void 0 : m.isRecording(), h = (y = e.current) == null ? void 0 : y.isLoading();
      for (const p of u)
        if (p.offsetParent !== null) {
          p.style.color = s || h ? "#1890ff" : "";
          break;
        }
    };
    i();
    const f = setInterval(i, 200);
    return () => clearInterval(f);
  }, [r]), !r) return null;
  const g = c ? { display: "inline-flex", alignItems: "center" } : {
    position: "absolute",
    width: 0,
    height: 0,
    overflow: "hidden",
    opacity: 0,
    pointerEvents: "none"
  };
  return /* @__PURE__ */ H.createElement(
    "span",
    {
      [Ye]: "1",
      style: g,
      "aria-hidden": c ? void 0 : !0
    },
    /* @__PURE__ */ H.createElement(
      Fe,
      {
        ref: e,
        onTranscription: t.handleTranscription,
        onStart: t.onStart
      }
    )
  );
}
function ze() {
  var t, r, n, c;
  const e = ne();
  if (!e) {
    console.warn("[qwenpaw-voice] window.QwenPaw not ready");
    return;
  }
  at().then(() => {
    try {
      window.dispatchEvent(new CustomEvent($));
    } catch {
    }
  }), (t = e.route) != null && t.add && e.route.add(X, {
    id: "qwenpaw-voice.settings",
    path: "/qwenpaw-voice",
    component: qe
  }), (r = e.menu) != null && r.add ? e.menu.add(X, {
    id: "qwenpaw-voice.settings",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: () => Ue(ee(), "title"),
    icon: jt,
    route: "qwenpaw-voice.settings",
    order: 50
  }) : e.registerRoutes && e.registerRoutes(X, [
    {
      path: "/qwenpaw-voice",
      component: qe,
      label: "语音输入",
      icon: "🎤",
      priority: 50
    }
  ]), (c = (n = e.chat) == null ? void 0 : n.sender) != null && c.addPrefix ? e.chat.sender.addPrefix(X, /* @__PURE__ */ H.createElement(Yt, null), {
    id: "qwenpaw-voice.mic",
    order: 0
  }) : console.warn(
    "[qwenpaw-voice] chat.sender.addPrefix unavailable; mic not mounted"
  ), console.info("[qwenpaw-voice] registered");
}
if (ne())
  ze();
else {
  let e = 0;
  const t = setInterval(() => {
    e += 1, ne() ? (clearInterval(t), ze()) : e > 50 && (clearInterval(t), console.error("[qwenpaw-voice] host never became available"));
  }, 100);
}
