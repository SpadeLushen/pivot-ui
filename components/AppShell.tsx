"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, Eye, FileText, Gauge, History, Info, Menu, Minimize2, Moon, PanelLeftClose, RotateCcw, Settings, Square, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow, type CompactionControls } from "./ChatWindow";
import { SettingsModal } from "./SettingsModal";
import { SkillsConfig } from "./SkillsConfig";
import { McpConfig } from "./McpConfig";
import { SkillPacksModal } from "./SkillPacksModal";
import { PluginsConfig } from "./PluginsConfig";
import { BranchNavigator } from "./BranchNavigator";
import { RightPanel } from "./right-panel/RightPanel";
import type { RightPanelHandle } from "./right-panel/types";
import { useTheme } from "@/hooks/useTheme";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  readEnterBehaviorPreference,
  readTimeFormatPreference,
  readTpsEnabledPreference,
  writeEnterBehaviorPreference,
  writeTimeFormatPreference,
  writeTpsEnabledPreference,
  type EnterBehavior,
  type TimeFormat,
} from "@/lib/ui-preferences";
import { copyText } from "@/lib/clipboard";
import { encodeFilePathForApi, getFileName } from "@/lib/file-paths";
import { buildAtMentionText } from "@/lib/file-fuzzy";
import type { SessionInfo, SessionTreeNode, ExtensionStatusItem } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo } from "@/lib/pi-types";

// Probe whether a chat-linked path is a directory so the right panel can
// decide between opening a file tab and revealing a folder in the file tree.
// Returns false on any access/network error so callers keep the file behavior.
function isDirectoryPath(filePath: string, sessionId: string | null): Promise<boolean> {
  const params = new URLSearchParams({ type: "stat" });
  if (sessionId) params.set("sessionId", sessionId);
  return fetch(`/api/files/${encodeFilePathForApi(filePath)}?${params.toString()}`)
    .then(async (response) => {
      if (!response.ok) return false;
      const data = await response.json() as { isDir?: boolean };
      return data.isDir === true;
    })
    .catch(() => false);
}

function ExtensionStatusBar({
  statuses,
  isMobile,
  open,
  onToggle,
}: {
  statuses: ExtensionStatusItem[];
  isMobile: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const statusContentRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const element = statusContentRef.current;
    if (!element) return;

    const checkOverflow = () => {
      setHasOverflow(element.scrollWidth > element.clientWidth + 1);
    };
    checkOverflow();

    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(element);
    window.addEventListener("resize", checkOverflow);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", checkOverflow);
    };
  }, [statuses, isMobile]);

  if (statuses.length === 0) return null;

  const summary = statuses.map((status) => `${status.key}: ${status.text}`).join(" · ");
  const showExpandButton = hasOverflow || open;
  const tags = statuses.map((status) => (
    <span
      key={status.key}
      title={`${status.key}: ${status.text}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "max-content",
        padding: "4px 8px",
        border: "1px solid color-mix(in srgb, var(--accent) 24%, var(--border))",
        borderRadius: 6,
        background: "color-mix(in srgb, var(--accent) 7%, var(--bg))",
        color: "var(--text-muted)",
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{status.key}</span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status.text}</span>
    </span>
  ));

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", minWidth: 0, maxWidth: "none", flex: "1 1 auto", height: "100%", margin: isMobile ? "0 4px" : "0 8px" }}>
      <div
        ref={statusContentRef}
        title={summary}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
          flex: "1 1 auto",
          overflow: "hidden",
        }}
      >
        {tags}
      </div>
      {showExpandButton && (
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? t("app.collapseExtensionStatuses") : t("app.expandExtensionStatuses")}
          title={open ? t("app.collapseExtensionStatuses") : summary}
          onClick={onToggle}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: isMobile ? 28 : 30,
            height: "100%",
            flexShrink: 0,
            padding: 0,
            border: "none",
            borderLeft: "1px solid var(--border)",
            borderTop: open ? "2px solid var(--accent)" : "2px solid transparent",
            background: open ? "var(--bg-selected)" : "none",
            color: open ? "var(--text)" : "var(--text-muted)",
            cursor: "pointer",
            transition: "color 0.1s, background 0.1s",
          }}
        >
          <ChevronDown
            size={14}
            strokeWidth={1.6}
            aria-hidden="true"
            style={{
              color: "var(--text-dim)",
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 0.15s",
            }}
          />
        </button>
      )}
    </div>
  );
}

type SessionCopyField = "file" | "id";

type CompactionDisplayState = Pick<CompactionControls, "isCompacting" | "isStreaming" | "error">;
const EMPTY_COMPACTION_STATE: CompactionDisplayState = {
  isCompacting: false,
  isStreaming: false,
  error: null,
};

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const nextThemeLabel = theme === "light" ? t("settings.switchToDark") : theme === "dark" ? t("settings.switchToEye") : t("settings.switchToLight");
  const isMobile = useIsMobile();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [recentUserMessageWorkspaces, setRecentUserMessageWorkspaces] = useState<string[]>([]);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showTps, setShowTps] = useState(false);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>("24");
  const [enterBehavior, setEnterBehavior] = useState<EnterBehavior>("followUp");
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
  const [mcpConfigOpen, setMcpConfigOpen] = useState(false);
  const [packsConfigOpen, setPacksConfigOpen] = useState(false);
  const [packsRefreshKey, setPacksRefreshKey] = useState(0);
  const [pluginsConfigOpen, setPluginsConfigOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  useEffect(() => {
    setShowTps(readTpsEnabledPreference());
    setTimeFormat(readTimeFormatPreference());
    setEnterBehavior(readEnterBehaviorPreference());
  }, []);

  const handleTpsToggle = useCallback(() => {
    setShowTps((current) => {
      const next = !current;
      writeTpsEnabledPreference(next);
      return next;
    });
  }, []);

  const handleEnterBehaviorChange = useCallback((behavior: EnterBehavior) => {
    setEnterBehavior(behavior);
    writeEnterBehaviorPreference(behavior);
  }, []);

  const handleTimeFormatChange = useCallback((format: TimeFormat) => {
    setTimeFormat(format);
    writeTimeFormatPreference(format);
  }, []);

  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const rightPanelRef = useRef<RightPanelHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const systemBtnRef = useRef<HTMLButtonElement>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Extension statuses — populated by ChatWindow, displayed beside the left top-bar buttons
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionStatusItem[]>([]);
  const handleExtensionStatusesChange = useCallback((statuses: ExtensionStatusItem[] | null) => {
    setExtensionStatuses(statuses ?? []);
  }, []);

  const compactControlsRef = useRef<CompactionControls | null>(null);
  const [compactionState, setCompactionState] = useState<CompactionDisplayState>(EMPTY_COMPACTION_STATE);
  const handleCompactionStateChange = useCallback((controls: CompactionControls | null) => {
    compactControlsRef.current = controls;
    setCompactionState(controls ? {
      isCompacting: controls.isCompacting,
      isStreaming: controls.isStreaming,
      error: controls.error,
    } : EMPTY_COMPACTION_STATE);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | "session" | "extensions" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const toggleTopPanel = useCallback((panel: "branches" | "system" | "session" | "extensions") => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, [isMobile]);

  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel("session");
  }, [isMobile]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) setActiveTopPanel(null);
    setSidebarOpen((open) => !open);
  }, [isMobile]);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const rect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel]);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);

  const [initialSessionId] = useState<string | null>(() => searchParams.get("session"));
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [activeProjectRoot, setActiveProjectRoot] = useState<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !searchParams.get("session"));
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);
  const rightPanelCwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null;
  const rightPanelProjectRoot = activeProjectRoot ?? selectedSession?.projectRoot ?? rightPanelCwd;

  const handleUserMessageSent = useCallback((cwd: string, projectRoot?: string | null) => {
    const root = projectRoot ?? activeProjectRoot ?? cwd;
    if (!root) return;
    setRecentUserMessageWorkspaces((current) => current[0] === root
      ? current
      : [root, ...current.filter((item) => item !== root)]);
  }, [activeProjectRoot]);

  const handleCwdChange = useCallback((cwd: string | null, projectRoot?: string | null) => {
    setActiveCwd(cwd);
    setActiveProjectRoot(cwd ? projectRoot ?? cwd : null);
    // Skip if cwd is null (initial mount) or during the initial URL restore.
    if (!cwd) return;
    // A worktree selection has already started a new chat for this cwd. The
    // sidebar receives that cwd on the next render and reports it back; avoid
    // remounting the fresh chat a second time.
    if (selectedSession === null && newSessionCwd === cwd) return;
    if (suppressCwdBumpRef.current) {
      suppressCwdBumpRef.current = false;
      return;
    }
    // Worktrees of one repo share a project root. Moving the effective cwd
    // within the same project (e.g. switching worktree, or clicking a session
    // that lives in another worktree) must not close the open session.
    const newProject = projectRoot ?? cwd;
    if (selectedSession && (selectedSession.projectRoot ?? selectedSession.cwd) === newProject) {
      return;
    }
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    setSelectedSession(null);
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setExtensionStatuses([]);
    compactControlsRef.current = null;
    setCompactionState(EMPTY_COMPACTION_STATE);
    setActiveTopPanel(null);
    router.replace("/", { scroll: false });
  }, [newSessionCwd, router, selectedSession]);

  // A worktree is a distinct checkout. Do not keep the old AgentSession open:
  // it owns its original cwd even when both worktrees share a git project.
  const handleWorktreeChange = useCallback((cwd: string, projectRoot: string) => {
    setActiveCwd(cwd);
    setActiveProjectRoot(projectRoot);
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((key) => key + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setExtensionStatuses([]);
    compactControlsRef.current = null;
    setCompactionState(EMPTY_COMPACTION_STATE);
    setActiveTopPanel(null);
    router.replace("/", { scroll: false });
  }, [router]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setActiveProjectRoot(session.projectRoot ?? session.cwd);
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setExtensionStatuses([]);
    compactControlsRef.current = null;
    setCompactionState(EMPTY_COMPACTION_STATE);
    setInitialSessionRestored(true);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick.
    if (isMobile && !isRestore) setSidebarOpen(false);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [router, isMobile]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setActiveProjectRoot(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setExtensionStatuses([]);
    compactControlsRef.current = null;
    setCompactionState(EMPTY_COMPACTION_STATE);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    router.replace("/", { scroll: false });
  }, [router, isMobile]);

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectRoot, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
      })
      .catch(() => {});
  }, []);

  // Session-title extensions update the persisted session name from inside
  // the agent runtime. Keep both the selected session and the sidebar's list
  // current as soon as the runtime emits that change.
  const handleSessionNameChange = useCallback((sessionId: string, name: string | undefined) => {
    setSelectedSession((prev) => {
      if (!prev || prev.id !== sessionId || prev.name === name) return prev;
      return { ...prev, name };
    });
    setRefreshKey((k) => k + 1);
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setActiveProjectRoot(session.projectRoot ?? session.cwd);
    setRefreshKey((k) => k + 1);
    hydrateSelectedSession(session.id);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    compactControlsRef.current = null;
    setCompactionState(EMPTY_COMPACTION_STATE);
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setExtensionStatuses([]);
      compactControlsRef.current = null;
      setCompactionState(EMPTY_COMPACTION_STATE);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    }
  }, [selectedSession, router]);

  const handleOpenLinkedFile = useCallback((filePath: string) => {
    const sessionId = selectedSession?.id ?? null;
    void isDirectoryPath(filePath, sessionId).then((isDir) => {
      if (isDir) {
        // Directory in the chat: open the right-panel file tree at that folder
        rightPanelRef.current?.revealInFileTree(filePath, true);
      } else {
        rightPanelRef.current?.openFile(filePath, getFileName(filePath), sessionId);
      }
    });
  }, [selectedSession?.id]);

  const handleViewFullHistory = useCallback(() => {
    if (!selectedSession) return;
    window.open(
      `/api/sessions/${encodeURIComponent(selectedSession.id)}/export?inline=1`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [selectedSession]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  const compactButtonDisabled = !selectedSession || (compactionState.isStreaming && !compactionState.isCompacting);
  const compactButtonTitle = !selectedSession
    ? "Compact is available after the session is saved"
    : compactionState.error
      ?? (compactionState.isCompacting
        ? t("chat.stopGeneration")
        : compactionState.isStreaming ? "Compact is available after the agent finishes" : t("chat.compactContext"));
  const handleCompactButtonClick = useCallback(() => {
    const controls = compactControlsRef.current;
    if (!controls || !selectedSession) return;
    if (controls.isCompacting) controls.abort();
    else if (!controls.isStreaming) controls.compact();
  }, [selectedSession]);
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  const sidebarContent = (
    <>
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        recentUserMessageWorkspaces={recentUserMessageWorkspaces}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        showExplorer={false}
        onOpenSkills={() => {
          setSkillsConfigOpen(true);
          if (isMobile) setSidebarOpen(false);
        }}
        onOpenMcp={() => {
          setMcpConfigOpen(true);
          if (isMobile) setSidebarOpen(false);
        }}
        onOpenPacks={() => {
          setPacksConfigOpen(true);
          if (isMobile) setSidebarOpen(false);
        }}
        onOpenPlugins={() => {
          setPluginsConfigOpen(true);
          if (isMobile) setSidebarOpen(false);
        }}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="sidebar-utility-bar" style={{ padding: "8px", flexShrink: 0, background: isMobile ? "var(--overlay-bg)" : undefined }}>
        <button
          type="button"
          className="sidebar-settings-action"
          onClick={() => {
            setSettingsOpen(true);
            if (isMobile) setSidebarOpen(false);
          }}
        >
          <Settings size={18} strokeWidth={1.8} aria-hidden="true" />
          <span>{t("app.settings")}</span>
        </button>
      </div>
    </>
  );

  return (
    <>
    <style>{`
      @keyframes session-info-pop {
        0% {
          opacity: 0;
          transform: translateY(-24px);
          filter: blur(6px);
          box-shadow: 0 2px 8px rgba(0,0,0,0);
        }
        55% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: color-mix(in srgb, var(--accent) 8%, var(--bg-panel));
          box-shadow: 0 18px 44px rgba(37,99,235,0.16);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: var(--bg-panel);
          box-shadow: 0 10px 28px rgba(0,0,0,0.10);
        }
      }
      @keyframes session-info-light-wash {
        0% {
          opacity: 0;
          transform: translateX(-110%) skewX(-16deg);
        }
        24% {
          opacity: 0.42;
        }
        100% {
          opacity: 0;
          transform: translateX(115%) skewX(-16deg);
        }
      }
      .session-info-popover {
        position: relative;
        overflow: hidden;
        transform-origin: top right;
        animation: session-info-pop 360ms ease-out both;
        will-change: transform, opacity, filter, background, box-shadow;
      }
      .session-info-popover::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 44%;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 24%, transparent), transparent);
        animation: session-info-light-wash 620ms ease-out both;
      }
      @media (prefers-reduced-motion: reduce) {
        .session-info-popover,
        .session-info-popover::after {
          animation: none;
        }
      }
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(-100%);
          box-shadow: none;
        }
      }
    `}</style>
    <div className="workspace-shell" style={{ display: "flex", height: "100dvh", overflow: "hidden", background: "var(--app-canvas)" }}>
      {/* Mobile overlay backdrop */}
      <div
        className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Left sidebar */}
      <div
        className={`sidebar-container glass-sidebar${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        style={{
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 200,
        }}
      >
        {sidebarContent}
      </div>

      {/* Center: chat */}
      <div className="workspace-main" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar with sidebar toggle */}
        <div ref={topBarRef} className="workspace-toolbar" style={{ display: "flex", alignItems: "center", flexShrink: 0, borderBottom: "1px solid var(--border)", height: 36, background: "var(--bg-panel)" }}>
          <button
            onClick={handleSidebarToggle}
            title={sidebarOpen ? t("app.hideSidebar") : t("app.showSidebar")}
            aria-label={sidebarOpen ? t("app.hideSidebar") : t("app.showSidebar")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, padding: 0,
              background: "none", border: "none", borderRight: "1px solid var(--border)",
              color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {sidebarOpen ? <PanelLeftClose size={17} strokeWidth={1.8} aria-hidden="true" /> : <Menu size={18} strokeWidth={1.8} aria-hidden="true" />}
          </button>
          <button
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
            }}
            title={nextThemeLabel}
            aria-label={nextThemeLabel}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, padding: 0,
              background: "none", border: "none", borderRight: "1px solid var(--border)",
              color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {theme === "light" ? <Moon size={16} strokeWidth={1.8} aria-hidden="true" /> : theme === "dark" ? <Eye size={16} strokeWidth={1.8} aria-hidden="true" /> : <Sun size={16} strokeWidth={1.8} aria-hidden="true" />}
          </button>
          {showChat && (
            <div style={{ display: "flex", alignItems: "stretch", height: "100%", flex: "1 1 auto", minWidth: 0 }}>
              <button
                onClick={handleViewFullHistory}
                disabled={!selectedSession}
                title={selectedSession ? t("app.fullHistory") : "Full history is available after the session is saved"}
                aria-label={t("app.fullHistory")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: "100%",
                  padding: "0 12px",
                  background: "none",
                  border: "none",
                  borderTop: "2px solid transparent",
                  borderRight: "1px solid var(--border)",
                  color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
                  cursor: selectedSession ? "pointer" : "not-allowed",
                  opacity: selectedSession ? 1 : 0.45,
                  flexShrink: 0,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  transition: "color 0.1s, background 0.1s, opacity 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!selectedSession) return;
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = selectedSession ? "var(--text-muted)" : "var(--text-dim)";
                  e.currentTarget.style.background = "none";
                }}
              >
                <History size={13} strokeWidth={1.8} aria-hidden="true" style={{ color: selectedSession ? "var(--text-muted)" : "var(--text-dim)", flexShrink: 0 }} />
                {!isMobile && <span>{t("app.fullHistory")}</span>}
              </button>
              <BranchNavigator
                tree={branchTree}
                activeLeafId={branchActiveLeafId}
                onLeafChange={handleBranchLeafChange}
                inline
                compact={isMobile}
                containerRef={topBarRef}
                open={activeTopPanel === "branches"}
                onToggle={() => toggleTopPanel("branches")}
                hasSession={Boolean(selectedSession)}
              />
              <button
                ref={systemBtnRef}
                onClick={() => {
                  if (!selectedSession) return;
                  toggleTopPanel("system");
                }}
                disabled={!selectedSession}
                title={selectedSession ? t("app.systemPrompt") : "System prompt is available after the session is saved"}
                aria-label={t("app.systemPrompt")}
                aria-disabled={!selectedSession}
                aria-pressed={selectedSession ? activeTopPanel === "system" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  height: "100%", padding: "0 12px",
                  background: selectedSession && activeTopPanel === "system" ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderTop: selectedSession && activeTopPanel === "system" ? "2px solid var(--accent)" : "2px solid transparent",
                  borderRight: "1px solid var(--border)",
                  cursor: selectedSession ? "pointer" : "not-allowed",
                  color: selectedSession && activeTopPanel === "system" ? "var(--text)" : selectedSession ? "var(--text-muted)" : "var(--text-dim)",
                  opacity: selectedSession ? 1 : 0.45,
                  fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s, opacity 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!selectedSession) return;
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = selectedSession && activeTopPanel === "system" ? "var(--text)" : selectedSession ? "var(--text-muted)" : "var(--text-dim)";
                }}
              >
                <FileText size={13} strokeWidth={1.8} aria-hidden="true" style={{ color: selectedSession && systemPrompt ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }} />
                {!isMobile && <span>{t("app.systemPrompt")}</span>}
              </button>
              <button
                type="button"
                onClick={handleCompactButtonClick}
                disabled={compactButtonDisabled}
                title={compactButtonTitle}
                aria-label={compactionState.isCompacting ? t("chat.stopGeneration") : t("chat.compact")}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  height: "100%", padding: "0 12px",
                  background: compactionState.isCompacting ? "rgba(239,68,68,0.08)" : "none",
                  border: "none",
                  borderTop: "2px solid transparent",
                  borderRight: "1px solid var(--border)",
                  cursor: compactButtonDisabled ? "not-allowed" : "pointer",
                  color: compactButtonDisabled
                    ? "var(--text-dim)"
                    : compactionState.error || compactionState.isCompacting ? "#ef4444" : "var(--text-muted)",
                  opacity: compactButtonDisabled ? 0.45 : 1,
                  fontSize: 11, whiteSpace: "nowrap",
                  transition: "color 0.1s, background 0.1s, opacity 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (compactButtonDisabled) return;
                  e.currentTarget.style.background = compactionState.isCompacting ? "rgba(239,68,68,0.16)" : "var(--bg-hover)";
                  e.currentTarget.style.color = compactionState.isCompacting || compactionState.error ? "#ef4444" : "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = compactionState.isCompacting ? "rgba(239,68,68,0.08)" : "none";
                  e.currentTarget.style.color = compactButtonDisabled
                    ? "var(--text-dim)"
                    : compactionState.error || compactionState.isCompacting ? "#ef4444" : "var(--text-muted)";
                }}
              >
                {compactionState.isCompacting ? (
                  <><Square size={10} fill="currentColor" aria-hidden="true" />{!isMobile && <span>{t("chat.compacting")}</span>}</>
                ) : (
                  <><Minimize2 size={11} strokeWidth={2} aria-hidden="true" />{!isMobile && <span>{t("chat.compact")}</span>}</>
                )}
              </button>
              {showChat && extensionStatuses.length > 0 && (
                <ExtensionStatusBar
                  statuses={extensionStatuses}
                  isMobile={isMobile}
                  open={activeTopPanel === "extensions"}
                  onToggle={() => toggleTopPanel("extensions")}
                />
              )}
            </div>
          )}
          {/* Session stats — right-aligned in top bar */}
          {showChat && (sessionStats || contextUsage) && (() => {
            const tkn = sessionStats?.tokens;
            const c = sessionStats?.cost ?? 0;
            const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
            const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : `<$0.01`) : null;
            const cacheHitRate = tkn && tkn.input + tkn.cacheRead > 0 ? tkn.cacheRead / (tkn.input + tkn.cacheRead) : null;
            const cacheHitRateLabel = cacheHitRate === null ? "--" : `${(cacheHitRate * 100).toFixed(1)}%`;
            const showCacheHitRate = cacheHitRate !== null;

            let ctxColor = "var(--text-muted)";
            let ctxStr: string | null = null;
            if (contextUsage?.contextWindow) {
              const pct = contextUsage.percent;
              if (pct !== null && pct > 90) ctxColor = "#ef4444";
              else if (pct !== null && pct > 70) ctxColor = "rgba(234,179,8,0.95)";
              const pctStr = pct !== null ? `${pct.toFixed(0)}%` : "?";
              ctxStr = isMobile ? pctStr : `${pctStr} / ${fmt(contextUsage.contextWindow)}`;
            }

            const tooltipParts: string[] = [];
            if (tkn) {
              tooltipParts.push(`in: ${tkn.input.toLocaleString()}`);
              tooltipParts.push(`out: ${tkn.output.toLocaleString()}`);
              tooltipParts.push(`cache read: ${tkn.cacheRead.toLocaleString()}`);
              tooltipParts.push(`cache write: ${tkn.cacheWrite.toLocaleString()}`);
              tooltipParts.push(`cache hit: ${cacheHitRateLabel}`);
              if (c > 0) tooltipParts.push(`cost: $${c.toFixed(4)}`);
            }
            if (contextUsage?.contextWindow) {
              const pct = contextUsage.percent;
              tooltipParts.push(`context: ${pct !== null ? pct.toFixed(1) + "%" : "unknown"} of ${contextUsage.contextWindow.toLocaleString()} tokens`);
            }
            const tooltip = tooltipParts.join("  |  ");

            return (
              <button
                type="button"
                onClick={() => toggleTopPanel("session")}
                title={tooltip || t("app.sessionInfo")}
                aria-label={t("app.sessionInfo")}
                aria-pressed={activeTopPanel === "session"}
                style={{
                  marginLeft: "auto",
                  display: "flex", alignItems: "center", gap: isMobile ? 8 : 10,
                  paddingLeft: isMobile ? 8 : 12,
                  paddingRight: isMobile ? 12 : 48,
                  height: "100%",
                  background: activeTopPanel === "session" ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderTop: activeTopPanel === "session" ? "2px solid var(--accent)" : "2px solid transparent",
                  fontSize: 11, color: "var(--text-muted)",
                  whiteSpace: "nowrap", cursor: "pointer",
                  fontVariantNumeric: "tabular-nums",
                  transition: "color 0.1s, background 0.1s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = activeTopPanel === "session" ? "var(--text)" : "var(--text-muted)"; }}
              >
                {isMobile && <Info size={14} strokeWidth={1.8} aria-hidden="true" />}
                {!isMobile && tkn && tkn.input > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <ArrowUp size={12} strokeWidth={1.2} aria-hidden="true" />
                    {fmt(tkn.input)}
                  </span>
                )}
                {!isMobile && tkn && tkn.output > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <ArrowDown size={12} strokeWidth={1.2} aria-hidden="true" />
                    {fmt(tkn.output)}
                  </span>
                )}
                {showCacheHitRate && (
                  <span title={`Cache hit rate: ${cacheHitRateLabel}`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <RotateCcw size={12} strokeWidth={1.2} aria-hidden="true" />
                    {cacheHitRateLabel}
                  </span>
                )}
                {!isMobile && costStr && (
                  <span style={{ display: "flex", alignItems: "center", color: "var(--text)", fontWeight: 500 }}>
                    {costStr}
                  </span>
                )}
                {ctxStr && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, color: ctxColor }}>
                    <Gauge size={12} strokeWidth={1.2} aria-hidden="true" />
                    {ctxStr}
                  </span>
                )}
              </button>
            );
          })()}
          {/* Top panel dropdown — shared, only one active at a time */}
          {activeTopPanel && topPanelPos && createPortal(
            <div className="workspace-popover" style={{
              position: "fixed",
              top: topPanelPos.top,
              left: topPanelPos.left,
              width: topPanelPos.width,
              maxHeight: `calc(100dvh - ${topPanelPos.top}px)`,
              overflowY: "auto",
              zIndex: 500,
            }}>
              {activeTopPanel === "extensions" && extensionStatuses.length > 0 && (
                <div style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  <div style={{
                    maxHeight: "min(600px, 75vh)",
                    overflowY: "auto",
                    display: "flex",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: 6,
                    padding: "12px 16px",
                    color: "var(--text-muted)",
                    fontSize: 12,
                    lineHeight: 1.6,
                    fontFamily: "var(--font-mono)",
                    whiteSpace: "normal",
                  }}>
                    {extensionStatuses.map((status) => (
                      <div
                        key={status.key}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 6,
                          width: "max-content",
                          maxWidth: "100%",
                          minWidth: 0,
                          flexShrink: 0,
                          padding: "4px 8px",
                          border: "1px solid color-mix(in srgb, var(--accent) 24%, var(--border))",
                          borderRadius: 6,
                          background: "color-mix(in srgb, var(--accent) 7%, var(--bg))",
                          overflowWrap: "anywhere",
                        }}
                      >
                        <span style={{ color: "var(--accent)", fontSize: 11, flexShrink: 0 }}>{status.key}</span>
                        <span style={{
                          minWidth: 0,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                          wordBreak: "break-word",
                        }}>{status.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {activeTopPanel === "system" && (
                <div style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  {systemPrompt ? (
                    <div style={{
                      maxHeight: "min(600px, 75vh)",
                      overflowY: "auto",
                      padding: "12px 16px",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--font-mono)",
                    }}>
                      {systemPrompt}
                    </div>
                  ) : systemPrompt === "" ? (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      {t("app.systemPromptEmpty")}
                    </div>
                  ) : (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      {t("app.systemPromptLoading")}
                    </div>
                  )}
                </div>
              )}
              {activeTopPanel === "session" && (
                <div className="session-info-popover" style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                  boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
                  padding: "12px 16px",
                }}>
                  {sessionStats ? (() => {
                    const sessionRows: { label: string; value: string; copyField: SessionCopyField | null }[] = [
                      ...(sessionStats.sessionName ? [{ label: t("session.name"), value: sessionStats.sessionName, copyField: null as SessionCopyField | null }] : []),
                      { label: t("session.file"), value: sessionStats.sessionFile ?? "In-memory", copyField: "file" as const },
                      { label: t("session.id"), value: sessionStats.sessionId, copyField: "id" as const },
                    ];
                    const messageRows = [
                      [t("session.user"), sessionStats.userMessages.toLocaleString()],
                      [t("session.assistant"), sessionStats.assistantMessages.toLocaleString()],
                      [t("session.toolCalls"), sessionStats.toolCalls.toLocaleString()],
                      [t("session.toolResults"), sessionStats.toolResults.toLocaleString()],
                      [t("session.total"), sessionStats.totalMessages.toLocaleString()],
                    ];
                    const tokenRows = [
                      [t("session.input"), sessionStats.tokens.input.toLocaleString()],
                      [t("session.output"), sessionStats.tokens.output.toLocaleString()],
                      ...(sessionStats.tokens.cacheRead > 0 ? [[t("session.cacheRead"), sessionStats.tokens.cacheRead.toLocaleString()]] : []),
                      ...(sessionStats.tokens.cacheWrite > 0 ? [[t("session.cacheWrite"), sessionStats.tokens.cacheWrite.toLocaleString()]] : []),
                      [t("session.cacheHit"), sessionStats.tokens.input + sessionStats.tokens.cacheRead > 0
                        ? `${(sessionStats.tokens.cacheRead / (sessionStats.tokens.input + sessionStats.tokens.cacheRead) * 100).toFixed(1)}%`
                        : "--"],
                      [t("session.total"), sessionStats.tokens.total.toLocaleString()],
                    ];
                    const ctx = contextUsage ?? sessionStats.contextUsage;
                    const formatCompact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
                    const extraTokenRows = [
                      ...(sessionStats.cost > 0 ? [[t("session.cost"), `$${sessionStats.cost.toFixed(4)}`]] : []),
                      ...(ctx?.contextWindow ? [[t("session.context"), `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompact(ctx.contextWindow)}`]] : []),
                    ];
                    const section = (
                      title: string,
                      sectionRows: string[][],
                      valueAlign: "left" | "right" = "left",
                      compact = false,
                    ) => (
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{title}</div>
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: compact ? "max-content max-content" : "auto minmax(0, 1fr)",
                            columnGap: compact ? 14 : 12,
                            rowGap: 4,
                            justifyContent: compact ? "start" : undefined,
                          }}>
                            {sectionRows.map(([label, value]) => (
                              <div key={`${title}:${label}`} style={{ display: "contents" }}>
                                <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{label}</div>
                                <div style={{
                                  color: "var(--text-muted)",
                                  minWidth: 0,
                                  overflowWrap: compact ? "normal" : "anywhere",
                                  textAlign: valueAlign,
                                  whiteSpace: valueAlign === "right" ? "nowrap" : "normal",
                                }}>{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    const copyButton = (field: SessionCopyField, value: string) => {
                      const copied = copiedSessionField === field;
                      return (
                        <button
                          type="button"
                          title={copied ? t("general.copied") : (field === "file" ? t("session.copyFilePath") : t("session.copySessionId"))}
                          onClick={() => handleCopySessionField(field, value)}
                          style={{
                            alignSelf: "start",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 22,
                            height: 22,
                            marginTop: -2,
                            color: copied ? "var(--accent)" : "var(--text-dim)",
                            background: "transparent",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            cursor: "pointer",
                            flex: "0 0 auto",
                            transition: "color 0.12s, border-color 0.12s, background 0.12s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--accent)";
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.background = "var(--bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = copied ? "var(--accent)" : "var(--text-dim)";
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          {copied ? (
                            <Check size={12} strokeWidth={2} aria-hidden="true" />
                          ) : (
                            <Copy size={12} strokeWidth={2} aria-hidden="true" />
                          )}
                        </button>
                      );
                    };
                    const sessionInfoSection = (
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{t("session.info")}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", columnGap: 12, rowGap: 8, alignItems: "start" }}>
                          {sessionRows.map((row) => (
                            <div key={`session-info:${row.label}`} style={{ display: "contents" }}>
                              <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{row.label}</div>
                              <div style={{
                                color: "var(--text-muted)",
                                minWidth: 0,
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                whiteSpace: "normal",
                              }}>{row.value}</div>
                              <div>{row.copyField ? copyButton(row.copyField, row.value) : null}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );

                    return (
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                          ? "1fr"
                          : "minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr)",
                        gap: isMobile ? 16 : 24,
                        fontSize: 12,
                        lineHeight: 1.5,
                        fontFamily: "var(--font-mono)",
                      }}>
                        {sessionInfoSection}
                        {section(t("session.messages"), messageRows)}
                        {section(t("session.tokens"), [...tokenRows, ...extraTokenRows], "right", true)}
                      </div>
                    );
                  })() : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      {t("app.sessionInfoSendFirst")}
                    </div>
                  )}
                </div>
              )}
            </div>,
            document.body,
          )}

        </div>

        {/* Chat content */}
        <div className="workspace-chat-surface" style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              newSessionCwd={effectiveNewSessionCwd}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              onUserMessageSent={handleUserMessageSent}
              onSessionNameChange={handleSessionNameChange}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              showTps={showTps}
              timeFormat={timeFormat}
              enterBehavior={enterBehavior}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onSessionStatsChange={handleSessionStatsChange}
              onCompactionStateChange={handleCompactionStateChange}
              onExtensionStatusesChange={handleExtensionStatusesChange}
              onSessionStatsPanelOpen={openSessionStatsPanel}
              onContextUsageChange={handleContextUsageChange}
              onOpenFile={handleOpenLinkedFile}
              onCwdChange={handleWorktreeChange}
              onOpenSkills={() => setSkillsConfigOpen(true)}
              packsRefreshKey={packsRefreshKey}
            />
          ) : showPlaceholder ? (
            activeCwd ? (
              <div className="workspace-placeholder">
                <span>{t("app.selectWorkspace")}</span>
              </div>
            ) : (
              <div className="workspace-placeholder workspace-placeholder-intro">
                <span>Pivot UI </span>
              </div>
            )
          ) : null}
        </div>
      </div>

      <RightPanel
        ref={rightPanelRef}
        workspaceCwd={rightPanelCwd}
        workspaceProjectRoot={rightPanelProjectRoot}
        sourceSessionId={selectedSession?.id ?? null}
        explorerRefreshKey={explorerRefreshKey}
        onAtMention={handleAtMention}
        onPanelOpened={() => {
          if (isMobile) setSidebarOpen(false);
        }}
      />
    </div>
    {settingsOpen && <SettingsModal onClose={() => { setSettingsOpen(false); setModelsRefreshKey((k) => k + 1); }} onModelsChanged={() => setModelsRefreshKey((k) => k + 1)} showTps={showTps} onTpsToggle={handleTpsToggle} timeFormat={timeFormat} onTimeFormatChange={handleTimeFormatChange} enterBehavior={enterBehavior} onEnterBehaviorChange={handleEnterBehaviorChange} />}
    {skillsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
      <SkillsConfig
        cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!}
        onClose={() => setSkillsConfigOpen(false)}
        onPacksChanged={() => setPacksRefreshKey((k) => k + 1)}
        packsRefreshKey={packsRefreshKey}
      />
    )}
    {mcpConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
      <McpConfig cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!} onClose={() => setMcpConfigOpen(false)} />
    )}
    {packsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
      <SkillPacksModal onClose={() => setPacksConfigOpen(false)} />
    )}
    {pluginsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
      <PluginsConfig
        cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!}
        sessionId={selectedSession?.id ?? null}
        onClose={() => setPluginsConfigOpen(false)}
        onReloaded={() => setSessionKey((k) => k + 1)}
      />
    )}
    </>
  );
}
