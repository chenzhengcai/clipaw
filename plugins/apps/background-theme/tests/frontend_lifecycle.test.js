// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "plugins/apps/background-theme/ui/index.js"),
  "utf8",
);

function response(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

describe("background-theme frontend lifecycle", () => {
  let menuDispose;
  let routeDispose;
  let enabled;
  let config;

  beforeEach(() => {
    menuDispose = vi.fn();
    routeDispose = vi.fn();
    enabled = true;
    config = {
      enabled: true,
      slots: {
        global: { type: "color", color: "#112233", url: null },
        chat: { type: null, url: null },
      },
    };
    const component = () => null;
    const antd = new Proxy(
      { message: {} },
      { get: (target, key) => target[key] || component },
    );
    window.QwenPaw = {
      host: {
        React: { createElement: vi.fn(() => ({})) },
        antd,
        antdIcons: {},
        getApiUrl: (path) => path,
        getApiToken: () => "",
      },
      menu: { add: vi.fn(() => ({ dispose: menuDispose })) },
      route: { add: vi.fn(() => ({ dispose: routeDispose })) },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (url === "/background-theme/config") return Promise.resolve(response(config));
        if (url === "/frontend_plugin") {
          return Promise.resolve(
            response([
              {
                id: "background-theme",
                enabled,
                status: enabled ? "active" : "inactive",
              },
            ]),
          );
        }
        return Promise.reject(new Error(`unexpected URL ${url}`));
      }),
    );
  });

  afterEach(() => {
    window.__QWP_BG_THEME_RUNTIME__?.dispose();
    delete window.QwenPaw;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    document.documentElement.className = "";
    document.body.className = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fully cleans on disable and can register again", async () => {
    vm.runInThisContext(source);
    await vi.waitFor(() => {
      expect(document.getElementById("qwp-bg-global-layer")).not.toBeNull();
    });

    enabled = false;
    window.dispatchEvent(new Event("qwenpaw:plugins-changed"));
    await vi.waitFor(() => {
      expect(menuDispose).toHaveBeenCalledTimes(1);
      expect(routeDispose).toHaveBeenCalledTimes(1);
    });
    expect(document.getElementById("qwp-bg-global-layer")).toBeNull();
    expect(document.getElementById("qwp-bg-styles")).toBeNull();
    expect(document.body.classList.contains("qwp-bg-enabled")).toBe(false);
    expect(window.__QWP_BG_THEME_RUNTIME__).toBeUndefined();

    enabled = true;
    vm.runInThisContext(source);
    await vi.waitFor(() => {
      expect(window.QwenPaw.menu.add).toHaveBeenCalledTimes(2);
      expect(window.QwenPaw.route.add).toHaveBeenCalledTimes(2);
    });
  });

  it("disposes the old instance on hot reload without permanent loaded flag", async () => {
    vm.runInThisContext(source);
    await vi.waitFor(() => expect(window.QwenPaw.menu.add).toHaveBeenCalledTimes(1));
    vm.runInThisContext(source);
    await vi.waitFor(() => expect(window.QwenPaw.menu.add).toHaveBeenCalledTimes(2));
    expect(menuDispose).toHaveBeenCalledTimes(1);
    expect(routeDispose).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(document.querySelectorAll("#qwp-bg-global-layer")).toHaveLength(1);
    });
  });

  it("does not make the composer transparent for an enabled but empty config", async () => {
    config.slots.global = { type: null, url: null };
    vm.runInThisContext(source);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/background-theme/config", expect.anything()));
    expect(document.body.classList.contains("qwp-bg-global-on")).toBe(false);
    expect(document.body.classList.contains("qwp-chat-bg-on")).toBe(false);
    expect(source).not.toContain("body.qwp-bg-enabled .qwenpaw-chat-anywhere-input-wrapper");
  });

  it("does not reload video when only visual options change", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.play = play;
    config.slots.global = {
      type: "video",
      file: "movie.mp4",
      url: "/api/background-theme/files/movie.mp4",
      fit: "cover",
      dim: 0.2,
    };
    vm.runInThisContext(source);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    const video = document.querySelector("video");
    const initialSrc = video.src;

    window.__QWP_BG__.apply({
      ...config,
      slots: {
        ...config.slots,
        global: { ...config.slots.global, dim: 0.8, blur: 4 },
      },
    });
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.src).toBe(initialSrc);
    expect(video.style.filter).toBe("blur(4px)");
  });

  it("retires the legacy 0.1 runtime during a hot upgrade", async () => {
    const legacyApply = vi.fn();
    const legacyListener = vi.fn();
    window.__QWP_BG_THEME_LOADED__ = true;
    window.__QWP_BG__ = { apply: legacyApply };
    const staleStyle = document.createElement("style");
    staleStyle.id = "qwp-bg-styles";
    staleStyle.textContent = "body.qwp-bg-enabled .legacy-selector {}";
    document.head.appendChild(staleStyle);
    window.addEventListener("qwp-bg-config-changed", legacyListener);

    vm.runInThisContext(source);
    expect(legacyApply).toHaveBeenCalledWith({
      enabled: false,
      slots: { global: null, chat: null },
    });
    expect(window.__QWP_BG_THEME_LOADED__).toBeUndefined();
    await vi.waitFor(() => {
      expect(document.getElementById("qwp-bg-styles")?.textContent).toContain(
        "body.qwp-chat-bg-on .qwenpaw-chat-anywhere-input-wrapper",
      );
    });
    legacyApply.mockClear();
    window.dispatchEvent(new Event("qwp-bg-config-changed"));
    expect(legacyApply).not.toHaveBeenCalled();
    window.removeEventListener("qwp-bg-config-changed", legacyListener);
  });
});
