import {
  Layout,
  Button,
  Modal,
  Input,
  Form,
  Tooltip,
  Popover,
} from "antd";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppMessage } from "../hooks/useAppMessage";
import AgentSelector from "../components/AgentSelector";
import {
  SparkChatTabFill,
  SparkExitFullscreenLine,
  SparkSearchUserLine,
  SparkMenuExpandLine,
  SparkMenuFoldLine,
  SparkEmailLine,
  SparkSettingLine,
} from "@agentscope-ai/icons";
import SidebarSessionList from "./SidebarSessionList";
import SidebarSettingsPanel from "./SidebarSettingsPanel";
import { clearAuthToken } from "../api/config";
import { authApi } from "../api/modules/auth";
import api from "../api";
import {
  syncSessionsGlobal,
  type ExtendedSession,
} from "../stores/sessionListStore";
import { useCodingMode } from "../stores/codingModeStore";
import { useSidebarModeStore } from "../stores/sidebarModeStore";
import { buildSessionPath, getSessionIdFromPath } from "../utils/sessionRoute";
import sessionApi from "../pages/Chat/sessionApi";
import { useInboxWobble } from "../hooks/useInboxWobble";
import styles from "./index.module.less";
import { useTheme } from "../contexts/ThemeContext";
import { useMenuItems, useRoutes } from "../plugins/registry/hooks";
import { Slot } from "../plugins/registry/Slot";
import {
  findMenuItem,
  flattenMenu,
  renderIcon,
  routeIdToPath,
} from "./registry/adapter";
import type { FlatMenuEntry } from "./registry/adapter";
import type { MenuItem } from "../plugins/registry/types";
import type { ReactNode } from "react";

// ── Layout ────────────────────────────────────────────────────────────────

const { Sider } = Layout;
const MOBILE_SIDEBAR_QUERY = "(max-width: 768px)";

function isMobileSidebarViewport() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_SIDEBAR_QUERY).matches
  );
}
const INBOX_BADGE_POLLING_MS = 6000;

// ── Simple mode whitelist ─────────────────────────────────────────────────

/** Menu item IDs that remain visible in simple sidebar mode (no groups). */
const SIMPLE_MODE_WHITELIST = new Set([
  "core.inbox",
  "core.cron-jobs",
  "core.agent-config",
  "core.models",
]);

/**
 * Flatten a MenuItem tree into a leaf-only list for simple sidebar mode.
 * Groups are eliminated entirely — only whitelisted children survive
 * as top-level items.
 */
function flattenMenuForSimpleMode(items: MenuItem[]): MenuItem[] {
  const result: MenuItem[] = [];
  for (const rawItem of items) {
    const item = rawItem as MenuItem & { __children?: MenuItem[] };
    if (item.__children && item.__children.length > 0) {
      for (const child of item.__children) {
        if (SIMPLE_MODE_WHITELIST.has(child.id)) {
          result.push(child);
        }
      }
    } else if (SIMPLE_MODE_WHITELIST.has(item.id)) {
      result.push(item);
    }
  }
  return result;
}

// ── Section Header (collapsible group toggle) ──────────────────────────────

function SectionHeader({
  label,
  collapsed: isCollapsed,
  onClick,
}: {
  label: string;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={styles.sectionHeader}
      onClick={onClick}
      type="button"
      aria-expanded={!isCollapsed}
    >
      <span className={styles.sectionHeaderLabel}>{label}</span>
      <span
        className={`${styles.sectionHeaderArrow} ${
          isCollapsed ? styles.sectionHeaderArrowCollapsed : ""
        }`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4.5 2.5L8 6L4.5 9.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────

interface SidebarProps {
  /** Route id of the currently active page (e.g. "core.workspace"). */
  selectedKey: string;
}

// ── Sidebar ───────────────────────────────────────────────────────────────

export default function Sidebar({ selectedKey }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const { isDark } = useTheme();
  // When coding mode is on, the sidebar "Chat" entry should land on /coding
  // (FileTree + Editor + Chat panel) rather than the bare Chat page.
  const { codingMode } = useCodingMode();
  const currentSessionId = getSessionIdFromPath(location.pathname);
  const chatPath = buildSessionPath(
    codingMode ? "coding" : "chat",
    currentSessionId,
  );
  const [authEnabled, setAuthEnabled] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountForm] = Form.useForm();
  // Start collapsed on mobile so the first paint does not overlay/obscure
  // the main content on narrow viewports.
  const [collapsed, setCollapsed] = useState(isMobileSidebarViewport);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(isMobileSidebarViewport);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [hasPendingApprovals, setHasPendingApprovals] = useState(false);
  const [shakeInbox, setShakeInbox] = useState(false);
  const [wobbleEnabled] = useInboxWobble();
  const currentApprovalIdsRef = useRef<Set<string>>(new Set());
  const seenApprovalIdsRef = useRef<Set<string>>(new Set());

  // Sidebar mode: "simple" (only core items) or "full" (everything)
  const { mode: sidebarMode } = useSidebarModeStore();

  // Menu + route snapshots from registry (builtin + plugin registrations merged).
  const rawAgentMenu = useMenuItems("primary.agentScoped");
  const rawSettingsMenu = useMenuItems("primary.settings");
  const routes = useRoutes();

  // Apply simple-mode filtering when enabled
  const agentMenu = useMemo(
    () =>
      sidebarMode === "simple"
        ? flattenMenuForSimpleMode(rawAgentMenu)
        : rawAgentMenu,
    [rawAgentMenu, sidebarMode],
  );
  const settingsMenu = useMemo(
    () =>
      sidebarMode === "simple"
        ? flattenMenuForSimpleMode(rawSettingsMenu)
        : rawSettingsMenu,
    [rawSettingsMenu, sidebarMode],
  );

  // Flat nav entries for simple mode (icon + label + path)
  const simpleFlatNav = useMemo(() => {
    if (sidebarMode !== "simple") return [];
    return [
      ...flattenMenu(agentMenu, routes, 16),
      ...flattenMenu(settingsMenu, routes, 16),
    ];
  }, [agentMenu, settingsMenu, routes, sidebarMode]);

  // ── Collapsible section state ──────────────────────────────────────────
  // Default: all sections collapsed
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({
    "core.control-group": true,
    "core.agent-group": true,
    "core.settings-group": true,
    "plugins-group": true,
  });

  const toggleSection = useCallback((sectionKey: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  }, []);

  // ── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    authApi
      .getStatus()
      .then((res) => setAuthEnabled(res.enabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia(MOBILE_SIDEBAR_QUERY);
    const syncMobileSidebar = () => {
      setIsMobile(mediaQuery.matches);
      // Collapse on mobile to avoid covering the main content; expand again
      // when the viewport returns to desktop width.
      setCollapsed(mediaQuery.matches);
    };

    syncMobileSidebar();
    mediaQuery.addEventListener("change", syncMobileSidebar);

    return () => {
      mediaQuery.removeEventListener("change", syncMobileSidebar);
    };
  }, []);
  useEffect(() => {
    const loadUnreadState = async () => {
      try {
        const [inboxRes, pushRes] = await Promise.all([
          api.getInboxEvents({
            unread_only: true,
            limit: 1,
          }),
          api.getPushMessages(),
        ]);
        const hasUnreadEvents = (inboxRes?.events?.length || 0) > 0;
        const approvals = pushRes?.pending_approvals || [];
        const currentIds = new Set(
          approvals.map((a: { request_id: string }) => a.request_id),
        );
        currentApprovalIdsRef.current = currentIds;
        const hasNewApprovals =
          currentIds.size > 0 &&
          [...currentIds].some((id) => !seenApprovalIdsRef.current.has(id));
        setShakeInbox(hasNewApprovals);
        setHasUnreadMessages(hasUnreadEvents);
        setHasPendingApprovals(currentIds.size > 0);
      } catch {
        // Keep previous state when polling fails.
      }
    };
    void loadUnreadState();
    const timer = window.setInterval(() => {
      void loadUnreadState();
    }, INBOX_BADGE_POLLING_MS);
    return () => window.clearInterval(timer);
  }, []);

  // ── Pre-fetch sessions on mount ───────────────────────────────────────────
  // On mobile the sidebar starts collapsed so SidebarSessionList is unmounted
  // and never fetches.  When the user expands the sidebar the list mounts fresh
  // but the Zustand store may still be empty (ChatSessionInitializer may not
  // have synced yet).  Proactively fetch sessions into the store so the data
  // is ready the moment the user expands.  Fire on mount regardless of
  // sidebar mode (the default "full" mode also benefits from this).
  // Uses sessionApi.getSessionList() instead of raw api.listChats() to ensure
  // the same data processing pipeline (dedup, realId, generating state) as
  // the desktop ChatSessionDrawer.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await sessionApi.getSessionList();
        if (!cancelled && list.length > 0) {
          syncSessionsGlobal(list as ExtendedSession[]);
        }
      } catch {
        // Best-effort: let SidebarSessionList retry on its own.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Inbox badge dot & wobble ─────────────────────────────────────────────
  const hasInboxUnread = hasUnreadMessages || hasPendingApprovals;
  const inboxDotColor = hasPendingApprovals
    ? "#e04848"
    : "rgba(255, 157, 77, 1)";
  const effectiveShake = shakeInbox && wobbleEnabled;

  /** Mark current approvals as "seen" so the wobble stops. */
  const handleInboxHover = useCallback(() => {
    seenApprovalIdsRef.current = new Set(currentApprovalIdsRef.current);
    setShakeInbox(false);
  }, []);

  /** Wrap the inbox label with the unread badge dot while keeping other labels intact. */
  const decorateLabel = useCallback(
    (item: MenuItem, label: ReactNode): ReactNode => {
      if (item.id !== "core.inbox" || label == null) return label;
      return (
        <span style={{ position: "relative", display: "inline-flex" }}>
          {label}
          {hasInboxUnread && (
            <span
              style={{
                position: "absolute",
                top: -1,
                right: -3,
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: inboxDotColor,
              }}
            />
          )}
        </span>
      );
    },
    [hasInboxUnread, inboxDotColor],
  );

  const collapsedNavItems = useMemo(() => {
    // Sticky chat is its own carve-out (lives outside menu data — see builtinMenu.ts).
    const stickyChat: FlatMenuEntry = {
      key: "core.chat",
      icon: <SparkChatTabFill size={18} />,
      path: chatPath,
      label: t("nav.chat"),
    };
    // Inbox in collapsed mode shows a dot overlay on its icon (kept Sidebar-local
    // for the same reason as decorateLabel: live state isn't menu data).
    const decorateInboxIcon = (icon: ReactNode): ReactNode => (
      <span style={{ position: "relative", display: "inline-flex" }}>
        {icon ?? <SparkEmailLine size={18} />}
        {hasInboxUnread && (
          <span
            style={{
              position: "absolute",
              top: -1,
              right: -3,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: inboxDotColor,
            }}
          />
        )}
      </span>
    );
    const flat = [
      stickyChat,
      ...flattenMenu(agentMenu, routes, 18),
      ...flattenMenu(settingsMenu, routes, 18),
    ];
    return flat.map((entry) =>
      entry.key === "core.inbox"
        ? { ...entry, icon: decorateInboxIcon(entry.icon) }
        : entry,
    );
  }, [
    agentMenu,
    settingsMenu,
    routes,
    chatPath,
    t,
    hasInboxUnread,
    inboxDotColor,
  ]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleMenuClick = (key: string, allItems: MenuItem[]) => {
    const item = findMenuItem(allItems, key);
    if (item?.href) {
      window.open(item.href, "_blank", "noopener,noreferrer");
      return;
    }
    const path = routeIdToPath(item?.route, routes);
    if (path) navigate(path);
  };

  /**
   * New chat: if we're already on the chat page, dispatch the event so
   * ChatSessionInitializer (which is mounted) creates the session.
   * If we're on another page, navigate to /chat without a session id —
   * the chat page will auto-create a new session on mount.
   */
  const handleNewChat = useCallback(() => {
    const onChatPage =
      location.pathname.startsWith("/chat") ||
      location.pathname.startsWith("/coding");
    if (onChatPage) {
      window.dispatchEvent(new CustomEvent("qwenpaw:sidebar-new-chat"));
    } else {
      sessionStorage.setItem("qwenpaw_pending_new_chat", "1");
      const mode = codingMode ? "coding" : "chat";
      navigate(`/${mode}`);
    }
  }, [location.pathname, navigate, codingMode]);

  /**
   * Session click: navigate directly without relying on ChatSessionInitializer.
   * buildSessionPath handles coding-mode paths.
   * Resolve realId (backend UUID) to avoid exposing local timestamp in URL.
   */
  const handleSidebarSessionClick = useCallback(
    (sessionId: string) => {
      const mode = codingMode ? "coding" : "chat";
      const effectiveId = sessionApi.getEffectiveSessionId(sessionId);
      const targetPath = buildSessionPath(mode, effectiveId);
      navigate(targetPath);
    },
    [codingMode, navigate],
  );

  const handleUpdateProfile = async (values: {
    currentPassword: string;
    newUsername?: string;
    newPassword?: string;
  }) => {
    const trimmedUsername = values.newUsername?.trim() || undefined;
    const trimmedPassword = values.newPassword?.trim() || undefined;

    if (values.newPassword && !trimmedPassword) {
      message.error(t("account.passwordEmpty"));
      return;
    }

    if (values.newUsername && !trimmedUsername) {
      message.error(t("account.usernameEmpty"));
      return;
    }

    if (!trimmedUsername && !trimmedPassword) {
      message.warning(t("account.nothingToUpdate"));
      return;
    }

    setAccountLoading(true);
    try {
      await authApi.updateProfile(
        values.currentPassword,
        trimmedUsername,
        trimmedPassword,
      );
      message.success(t("account.updateSuccess"));
      setAccountModalOpen(false);
      accountForm.resetFields();
      clearAuthToken();
      window.location.href = "/login";
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      let msg = t("account.updateFailed");
      if (raw.includes("password is incorrect")) {
        msg = t("account.wrongPassword");
      } else if (raw.includes("Nothing to update")) {
        msg = t("account.nothingToUpdate");
      } else if (raw.includes("cannot be empty")) {
        msg = t("account.nothingToUpdate");
      } else if (raw) {
        msg = raw;
      }
      message.error(msg);
    } finally {
      setAccountLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const siderWidth = collapsed ? (isMobile ? 56 : 72) : 240;
  // Sticky chat is active when on /chat* or /coding routes.
  const isChatActive =
    selectedKey === "core.chat" || selectedKey === "core.coding";
  // `renderIcon` retained for tree-shaking awareness.
  void renderIcon;

  // On mobile, the expanded sidebar shows sessions (like simple mode) instead
  // of the full menu — matching the desktop history panel UX.
  const isSimpleExpanded = (sidebarMode === "simple" || isMobile) && !collapsed;

  return (
    <Sider
      width={siderWidth}
      className={`${styles.sider}${
        collapsed ? ` ${styles.siderCollapsed}` : ""
      }${isDark ? ` ${styles.siderDark}` : ""}${
        isSimpleExpanded ? ` ${styles.siderSimple}` : ""
      }`}
    >
      {collapsed ? (
        <nav className={styles.collapsedNav}>
          {collapsedNavItems.map((item) => {
            const isActive =
              item.key === "core.chat"
                ? isChatActive
                : selectedKey === item.key;
            return (
              <Tooltip
                key={item.key}
                title={item.label}
                placement="right"
                overlayInnerStyle={{
                  background: "rgba(0,0,0,0.75)",
                  color: "#fff",
                }}
              >
                <button
                  className={`${styles.collapsedNavItem} ${
                    isActive ? styles.collapsedNavItemActive : ""
                  }${
                    item.key === "core.inbox" && effectiveShake
                      ? ` ${styles.inboxShake}`
                      : ""
                  }`}
                  onClick={() =>
                    item.href
                      ? window.open(item.href, "_blank", "noopener,noreferrer")
                      : navigate(item.path)
                  }
                  onMouseEnter={
                    item.key === "core.inbox" ? handleInboxHover : undefined
                  }
                >
                  {item.icon}
                </button>
              </Tooltip>
            );
          })}
        </nav>
      ) : isSimpleExpanded ? (
        <>
          {/* Simple mode: flat nav items + session list */}
          <div className={styles.agentScopedSection}>
            <div className={styles.agentSelectorContainer}>
              <AgentSelector collapsed={collapsed} />
            </div>
            {/* Flat nav items (no groups) */}
            <div className={styles.simpleNavItems}>
              {simpleFlatNav.map((entry) => {
                const isInbox = entry.key === "core.inbox";
                const isActive = selectedKey === entry.key;
                return (
                  <button
                    key={entry.key}
                    className={`${styles.simpleNavItem} ${
                      isActive ? styles.simpleNavItemActive : ""
                    }${
                      isInbox && effectiveShake ? ` ${styles.inboxShake}` : ""
                    }`}
                    onMouseEnter={isInbox ? handleInboxHover : undefined}
                    onClick={() =>
                      entry.href
                        ? window.open(
                            entry.href,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        : navigate(entry.path)
                    }
                  >
                    {isInbox ? (
                      <span
                        style={{
                          position: "relative",
                          display: "inline-flex",
                        }}
                      >
                        {entry.icon ?? <SparkEmailLine size={16} />}
                        {hasInboxUnread && (
                          <span
                            style={{
                              position: "absolute",
                              top: -1,
                              right: -3,
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: inboxDotColor,
                            }}
                          />
                        )}
                      </span>
                    ) : (
                      entry.icon
                    )}
                    <span>{entry.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Session list — fills remaining space */}
          <SidebarSessionList
            onNewChat={handleNewChat}
            onSessionClick={handleSidebarSessionClick}
          />
        </>
      ) : (
        <>
          {/* Agent-scoped section: selector + Chat + Control + Workspace */}
          <div className={styles.agentScopedSection}>
            <div className={styles.agentSelectorContainer}>
              <AgentSelector collapsed={collapsed} />
              {/* Chat entry — sticky together with agent selector */}
              <button
                className={`${styles.stickyChatButton}${
                  isChatActive ? ` ${styles.stickyChatButtonActive}` : ""
                }`}
                onClick={() => navigate(chatPath)}
              >
                <SparkChatTabFill size={16} />
                <span>{t("nav.chat")}</span>
              </button>
            </div>
            <Slot name="sider.top" kind="fill" />

            {/* Agent-scoped menu items from menuRegistry */}
            {agentMenu.map((item) => {
              const itemWithChildren = item as MenuItem & { __children?: MenuItem[] };
              if (itemWithChildren.__children) {
                const groupId = item.id;
                const isSectionCollapsed = !!collapsedSections[groupId];
                const children = itemWithChildren.__children;
                return (
                  <div key={groupId} className={styles.navSection}>
                    <SectionHeader
                      label={
                        typeof item.label === "function"
                          ? String(item.label() ?? "")
                          : String(item.label ?? "")
                      }
                      collapsed={isSectionCollapsed}
                      onClick={() => toggleSection(groupId)}
                    />
                    {!isSectionCollapsed && (
                      <div className={styles.navSectionItems}>
                        {children
                          .filter((c: MenuItem) => c.visible?.() !== false)
                          .map((child: MenuItem) => (
                            <button
                              key={child.id}
                              className={`${styles.navItem}${
                                selectedKey === child.id
                                  ? ` ${styles.navItemActive}`
                                  : ""
                              }${
                                child.id === "core.inbox" && effectiveShake
                                  ? ` ${styles.inboxShake}`
                                  : ""
                              }`}
                              onMouseEnter={
                                child.id === "core.inbox"
                                  ? handleInboxHover
                                  : undefined
                              }
                              onClick={() => handleMenuClick(child.id, agentMenu)}
                            >
                              <span className={styles.navItemIcon}>
                                {renderIcon(child.icon, 16)}
                                {child.id === "core.inbox" && hasInboxUnread && (
                                  <span className={styles.navItemBadge} />
                                )}
                              </span>
                              <span className={styles.navItemLabel}>
                                {decorateLabel(
                                  child,
                                  typeof child.label === "function"
                                    ? child.label()
                                    : child.label,
                                )}
                              </span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                );
              } else if (item.divider) {
                return <hr key={item.id} className={styles.navDivider} />;
              } else {
                return (
                  <button
                    key={item.id}
                    className={`${styles.navItem}${
                      selectedKey === item.id ? ` ${styles.navItemActive}` : ""
                    }${
                      item.id === "core.inbox" && effectiveShake
                        ? ` ${styles.inboxShake}`
                        : ""
                    }`}
                    onMouseEnter={
                      item.id === "core.inbox" ? handleInboxHover : undefined
                    }
                    onClick={() => handleMenuClick(item.id, agentMenu)}
                  >
                    <span className={styles.navItemIcon}>
                      {renderIcon(item.icon, 16)}
                      {item.id === "core.inbox" && hasInboxUnread && (
                        <span className={styles.navItemBadge} />
                      )}
                    </span>
                    <span className={styles.navItemLabel}>
                      {decorateLabel(
                        item,
                        typeof item.label === "function"
                          ? item.label()
                          : item.label,
                      )}
                    </span>
                  </button>
                );
              }
            })}
          </div>

          {/* Global settings section — same visual style as agent section */}
          <div className={styles.settingsSection}>
            {settingsMenu.map((item) => {
              const itemWithChildren = item as MenuItem & { __children?: MenuItem[] };
              if (itemWithChildren.__children) {
                const groupId = item.id;
                const isSectionCollapsed = !!collapsedSections[groupId];
                const children = itemWithChildren.__children;
                return (
                  <div key={groupId} className={styles.navSection}>
                    <SectionHeader
                      label={
                        typeof item.label === "function"
                          ? String(item.label() ?? "")
                          : String(item.label ?? "")
                      }
                      collapsed={isSectionCollapsed}
                      onClick={() => toggleSection(groupId)}
                    />
                    {!isSectionCollapsed && (
                      <div className={styles.navSectionItems}>
                        {children
                          .filter((c: MenuItem) => c.visible?.() !== false)
                          .map((child: MenuItem) => (
                            <button
                              key={child.id}
                              className={`${styles.navItem}${
                                selectedKey === child.id
                                  ? ` ${styles.navItemActive}`
                                  : ""
                              }`}
                              onClick={() =>
                                handleMenuClick(child.id, settingsMenu)
                              }
                            >
                              <span className={styles.navItemIcon}>
                                {renderIcon(child.icon, 16)}
                              </span>
                              <span className={styles.navItemLabel}>
                                {typeof child.label === "function"
                                  ? child.label()
                                  : child.label}
                              </span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                );
              } else if (item.divider) {
                return <hr key={item.id} className={styles.navDivider} />;
              } else {
                return (
                  <button
                    key={item.id}
                    className={`${styles.navItem}${
                      selectedKey === item.id ? ` ${styles.navItemActive}` : ""
                    }`}
                    onClick={() => handleMenuClick(item.id, settingsMenu)}
                  >
                    <span className={styles.navItemIcon}>
                      {renderIcon(item.icon, 16)}
                    </span>
                    <span className={styles.navItemLabel}>
                      {typeof item.label === "function"
                        ? item.label()
                        : item.label}
                    </span>
                  </button>
                );
              }
            })}
          </div>
          <Slot name="sider.bottom" kind="fill" />
        </>
      )}

      {authEnabled && !collapsed && (
        <div className={styles.authActions}>
          <Button
            type="text"
            icon={<SparkSearchUserLine size={16} />}
            onClick={() => {
              accountForm.resetFields();
              setAccountModalOpen(true);
            }}
            block
            className={`${styles.authBtn} ${
              collapsed ? styles.authBtnCollapsed : ""
            }`}
          >
            {!collapsed && t("account.title")}
          </Button>
          <Button
            type="text"
            icon={<SparkExitFullscreenLine size={16} />}
            onClick={() => {
              clearAuthToken();
              window.location.href = "/login";
            }}
            block
            className={`${styles.authBtn} ${
              collapsed ? styles.authBtnCollapsed : ""
            }`}
          >
            {!collapsed && t("login.logout")}
          </Button>
        </div>
      )}

      <div className={styles.collapseToggleContainer}>
        {!collapsed && (
          <Popover
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            placement="topRight"
            trigger="click"
            content={
              <SidebarSettingsPanel onClose={() => setSettingsOpen(false)} />
            }
          >
            <Button
              type="text"
              icon={<SparkSettingLine size={18} />}
              className={styles.collapseToggle}
            />
          </Popover>
        )}
        <Button
          type="text"
          icon={
            collapsed ? (
              <SparkMenuExpandLine size={20} />
            ) : (
              <SparkMenuFoldLine size={20} />
            )
          }
          onClick={() => setCollapsed(!collapsed)}
          className={styles.collapseToggle}
        />
      </div>

      <Modal
        open={accountModalOpen}
        onCancel={() => setAccountModalOpen(false)}
        title={t("account.title")}
        footer={null}
        destroyOnHidden
        centered
      >
        <Form
          form={accountForm}
          layout="vertical"
          onFinish={handleUpdateProfile}
        >
          <Form.Item
            name="currentPassword"
            label={t("account.currentPassword")}
            rules={[
              { required: true, message: t("account.currentPasswordRequired") },
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="newUsername" label={t("account.newUsername")}>
            <Input placeholder={t("account.newUsernamePlaceholder")} />
          </Form.Item>
          <Form.Item name="newPassword" label={t("account.newPassword")}>
            <Input.Password placeholder={t("account.newPasswordPlaceholder")} />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={t("account.confirmPassword")}
            dependencies={["newPassword"]}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value && !getFieldValue("newPassword")) {
                    return Promise.resolve();
                  }
                  if (value === getFieldValue("newPassword")) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error(t("account.passwordMismatch")),
                  );
                },
              }),
            ]}
          >
            <Input.Password
              placeholder={t("account.confirmPasswordPlaceholder")}
            />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={accountLoading}
              block
            >
              {t("account.save")}
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </Sider>
  );
}
