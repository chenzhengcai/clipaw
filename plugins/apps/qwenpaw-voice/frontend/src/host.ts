/**
 * host.ts — typed access to the console host API injected as
 * `window.QwenPaw`.
 *
 * Mirrors the declarations in `console/src/plugins/types/qwenpaw.d.ts` and
 * `console/src/plugins/hostSdk/install.ts`.  Kept local so the plugin builds
 * without reaching into the console source tree.
 */
import type * as ReactNS from "react";

export interface QwenPawHost {
  React: typeof ReactNS;
  ReactDOM: { flushSync: <T>(fn: () => T) => T } & Record<string, unknown>;
  antd: any;
  antdIcons: any;
  getApiUrl: (path: string) => string;
  getApiToken: () => string;
  fetch?: (path: string, init?: RequestInit) => Promise<Response>;
  useTheme?: () => "light" | "dark";
  useLocale?: () => string;
  getSelectedAgentId?: () => string;
}

/** Additive chat list slot API (subset we use). */
export interface QwenPawChatNamespace {
  sender: {
    addPrefix(
      pluginId: string,
      node: ReactNS.ReactNode,
      opts?: { id?: string; order?: number },
    ): { dispose(): void };
    set(
      pluginId: string,
      partial: { placeholder?: string; disclaimer?: ReactNS.ReactNode },
    ): { dispose(): void };
  };
  rightHeader: {
    add(
      pluginId: string,
      node: ReactNS.ReactNode,
      opts?: { id?: string; order?: number },
    ): { dispose(): void };
  };
}

export interface QwenPawGlobal {
  host: QwenPawHost;
  chat?: QwenPawChatNamespace;
  route?: {
    add(
      pluginId: string,
      route: {
        id: string;
        path: string;
        component: ReactNS.ComponentType<any>;
      },
    ): { dispose(): void };
  };
  menu?: {
    add(
      pluginId: string,
      item: Record<string, unknown>,
    ): { dispose(): void };
  };
  registerRoutes?: (
    pluginId: string,
    routes: Array<{
      path: string;
      component: ReactNS.ComponentType<any>;
      label?: string;
      icon?: string;
      priority?: number;
    }>,
  ) => void;
}

export function getQwenPaw(): QwenPawGlobal | undefined {
  return (window as unknown as { QwenPaw?: QwenPawGlobal }).QwenPaw;
}

export function getHost(): QwenPawHost {
  const ns = getQwenPaw();
  if (!ns?.host) {
    throw new Error("[qwenpaw-voice] window.QwenPaw.host not available");
  }
  return ns.host;
}

/** Resolve a console API path against the host's API base. */
export function apiUrl(path: string): string {
  return getHost().getApiUrl(path);
}

/** Fetch helper that attaches the host bearer token when present. */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const host = getHost();
  const headers = new Headers(init.headers);
  const token = host.getApiToken?.();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(apiUrl(path), { ...init, headers });
}
