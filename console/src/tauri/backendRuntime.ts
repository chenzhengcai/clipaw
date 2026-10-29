import { isTauri } from "@tauri-apps/api/core";

/** The native bridge is available before the bundled console has mounted. */
export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return (
    isTauri() ||
    typeof (
      window as {
        __TAURI_INTERNALS__?: { invoke?: unknown };
      }
    ).__TAURI_INTERNALS__?.invoke === "function"
  );
}

export const isDesktopApp = isTauriRuntime;

/** Query parameter marking a desktop-hosted console session (fork). */
const DESKTOP_QUERY_KEY = "desktop";

/**
 * Append the desktop marker to a URL so the backend-hosted console can detect
 * it after the bootstrap redirect.
 */
export function withDesktopMarker(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${DESKTOP_QUERY_KEY}=1`;
}

/**
 * Append a per-launch cache-busting param so the WebView always fetches a fresh
 * SPA entry (index.html) on each desktop startup. WKWebView caches the entry
 * document by URL and does not reliably revalidate even with `Cache-Control:
 * no-cache`, so a stable redirect URL keeps serving stale HTML that points at
 * old asset hashes after a rebuild. The content-hashed JS/CSS it references are
 * unaffected and still cache normally, so load stays fast.
 */
export function withCacheBuster(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}
