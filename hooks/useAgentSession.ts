"use client";

import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from "react";
import type {
  AgentMessage,
  ChatAttachment,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
  SessionInfo,
  SessionContext,
  SessionTreeNode,
  ToolResultMessage,
} from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import type { ModelScopeDiagnosticDto } from "@/lib/models-cache";
import type { ModelPickerEntry, RoutedModel, SelectedModel } from "@/lib/session-models";
import type { TypedModelEntry } from "@/lib/model-catalog";
import { successfulResponseModel } from "@/lib/response-model";
import { readInputReceipt, sendAgentCommand } from "@/lib/agent-client";
import { AgentRunState } from "@/lib/agent-run-state";
import { NestedToolState, type NestedCallGroup } from "@/lib/nested-tool-state";
import { clearDraft } from "@/lib/draft-store";
import { useExtensionInteractions } from "@/hooks/useExtensionInteractions";
import type { ExtensionUiSnapshot } from "@/lib/types";
import { useWorkspacePackRevision } from "@/hooks/useWorkspacePackRevision";
import { getFastModeTitleSuffix } from "@/lib/extension-statusline";
import { getSessionDocumentTitle } from "@/lib/background-title";
import { useTimings } from "@/hooks/useTimings";
import { useSessionStatistics } from "@/hooks/useSessionStatistics";
import { useModelCatalogRefresh } from "@/hooks/useModelCatalogRefresh";
import type { ModelCatalogRefreshStatus } from "@/lib/model-refresh-types";
import type { SlashArgumentCompletion } from "@/lib/pi-types";
import type { ChatInputHandle } from "@/components/ChatInput";

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: SessionContext;
}

interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface CompactCommandResult {
  tokensBefore?: number;
  estimatedTokensAfter?: number;
}

interface LastAssistantTextResponse {
  text?: string;
}

type AgentStateResponse = {
  selectedModel?: SelectedModel | null;
  routedModel?: RoutedModel | null;
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  systemPrompt?: string;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isCompacting?: boolean;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
  queuedMessages?: { steering?: string[]; followUp?: string[] } | null;
};

export interface QueuedMessages {
  steering: string[];
  followUp: string[];
}

function normalizeQueuedMessages(q?: { steering?: string[]; followUp?: string[] } | null): QueuedMessages {
  return { steering: q?.steering ?? [], followUp: q?.followUp ?? [] };
}

export type NoticeType = "info" | "success" | "warning" | "error";

export type NoticeItem = {
  id: string;
  message: string;
  type: NoticeType;
  exiting?: boolean;
};

type NoticeState = {
  visible: NoticeItem[];
  pending: NoticeItem[];
};

type NoticeAction =
  | { type: "add"; notice: NoticeItem }
  | { type: "mark_oldest_exiting" }
  | { type: "mark_oldest_dismissible_exiting" }
  | { type: "remove"; id: string }
  | { type: "remove_errors" };

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_command" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;

export interface CompactResultInfo {
  reason: "manual" | "threshold" | "overflow" | "auto" | string;
  tokensBefore: number;
  estimatedTokensAfter: number;
}

export interface SlashCommandInfo {
  name: string;
  hasArgumentCompletions?: boolean;
  description?: string;
  source: "extension" | "prompt" | "skill";
  sourceInfo?: {
    path: string;
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
}

export type BuiltinSlashCommandResult =
  | { handled: false }
  | { handled: true; message?: string; error?: string; action?: "openSessionStats" };

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onUserMessageSent?: (cwd: string, projectRoot?: string | null) => void;
  onSessionNameChange?: (sessionId: string, name: string | undefined) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  packsRefreshKey?: number;
  onPacksChanged?: () => void;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsPanelOpen?: () => void;
}

export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

function normalizeThinkingLevel(value: string | null | undefined): ThinkingLevelOption {
  switch (value) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return value;
    default:
      return "auto";
  }
}

const PROMPT_SETTLE_INITIAL_DELAY_MS = 800;
const PROMPT_SETTLE_POLL_MS = 600;
const PROMPT_SETTLE_MAX_MS = 20_000;
const AGENT_STATE_RECONCILE_MS = 15_000;
const EVENT_STREAM_CONNECT_TIMEOUT_MS = 5_000;
const MAX_NOTICES = 5;
const NOTICE_VISIBLE_MS = 5000;
const NOTICE_EXIT_ANIMATION_MS = 180;

type EventStreamConnectionStatus = "connected" | "timeout" | "closed";

type EventStreamConnectionResult = {
  status: EventStreamConnectionStatus;
  source: EventSource;
};

class EventStreamConnectionError extends Error {
  constructor(public readonly status: Exclude<EventStreamConnectionStatus, "connected">) {
    super(status === "timeout"
      ? "Timed out connecting to the agent event stream. Please try again."
      : "Failed to connect to the agent event stream. Please try again.");
    this.name = "EventStreamConnectionError";
  }
}

function createNoticeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markOldestNoticeExiting(
  notices: NoticeItem[],
  predicate: (notice: NoticeItem) => boolean = () => true,
): NoticeItem[] {
  const index = notices.findIndex((notice) => !notice.exiting && predicate(notice));
  if (index === -1) return notices;
  return notices.map((notice, i) => (
    i === index ? { ...notice, exiting: true } : notice
  ));
}

function fillPendingNotices(visible: NoticeItem[], pending: NoticeItem[]): NoticeState {
  let nextVisible = visible;
  let nextPending = pending;
  while (nextPending.length > 0 && nextVisible.length < MAX_NOTICES) {
    const [next, ...rest] = nextPending;
    nextVisible = [...nextVisible, next];
    nextPending = rest;
  }
  if (nextPending.length > 0 && !nextVisible.some((notice) => notice.exiting)) {
    nextVisible = markOldestNoticeExiting(nextVisible);
  }
  return { visible: nextVisible, pending: nextPending };
}

function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  switch (action.type) {
    case "add": {
      if (state.visible.some((notice) => notice.exiting) || state.visible.length >= MAX_NOTICES) {
        return {
          visible: state.visible.some((notice) => notice.exiting)
            ? state.visible
            : markOldestNoticeExiting(state.visible),
          pending: [...state.pending, action.notice],
        };
      }
      return { ...state, visible: [...state.visible, action.notice] };
    }
    case "mark_oldest_exiting":
      return { ...state, visible: markOldestNoticeExiting(state.visible) };
    case "mark_oldest_dismissible_exiting":
      return { ...state, visible: markOldestNoticeExiting(state.visible, (notice) => notice.type !== "error") };
    case "remove": {
      const visible = state.visible.filter((notice) => notice.id !== action.id);
      return fillPendingNotices(visible, state.pending);
    }
    case "remove_errors": {
      const visible = state.visible.filter((notice) => notice.type !== "error");
      const pending = state.pending.filter((notice) => notice.type !== "error");
      return fillPendingNotices(visible, pending);
    }
    default:
      return state;
  }
}

function extractMessageText(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object"
        && (block as { type?: string }).type === "text"
        && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "")
    .filter(Boolean)
    .join("\n");
}

function imageSignature(block: unknown): string {
  if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "image") return "";
  const source = (block as { source?: unknown }).source;
  if (source && typeof source === "object") {
    const src = source as { type?: unknown; media_type?: unknown; data?: unknown; url?: unknown };
    return [
      src.type === "url" ? "url" : "base64",
      typeof src.media_type === "string" ? src.media_type : "",
      typeof src.data === "string" ? src.data : "",
      typeof src.url === "string" ? src.url : "",
    ].join(":");
  }
  const flat = block as { data?: unknown; mimeType?: unknown };
  return [
    "base64",
    typeof flat.mimeType === "string" ? flat.mimeType : "",
    typeof flat.data === "string" ? flat.data : "",
    "",
  ].join(":");
}

function userMessageKey(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return JSON.stringify({ text: content, images: [] });
  if (!Array.isArray(content)) return JSON.stringify({ text: "", images: [] });
  return JSON.stringify({
    text: extractMessageText(message),
    images: content.map(imageSignature).filter(Boolean),
  });
}

export function reconcileOptimisticUserMessage(
  messages: AgentMessage[], delivered: AgentMessage, optimisticKey: string | null,
): AgentMessage[] {
  // Pi may emit a system prompt update before the initial user message. It is
  // invisible in chat, but can sit after the optimistic bubble in this array.
  let lastVisibleIndex = messages.length - 1;
  while (lastVisibleIndex >= 0 && messages[lastVisibleIndex].role !== "user" && messages[lastVisibleIndex].role !== "assistant") {
    lastVisibleIndex--;
  }
  const lastVisible = messages[lastVisibleIndex];
  if (optimisticKey && lastVisible?.role === "user" && userMessageKey(lastVisible) === optimisticKey) {
    if (optimisticKey === userMessageKey(delivered)) return messages;
    return messages.map((message, index) => index === lastVisibleIndex ? delivered : message);
  }
  return [...messages, delivered];
}

function readCompactResult(result: unknown, reason: string): CompactResultInfo | null {
  if (!result || typeof result !== "object") return null;
  const r = result as CompactCommandResult;
  if (typeof r.tokensBefore !== "number" || typeof r.estimatedTokensAfter !== "number") return null;
  return { reason, tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter };
}

export type { ChatInputHandle } from "@/components/ChatInput";

type ModelEntry = ModelPickerEntry;
type ModelsResponse = {
  models: Record<string, string>;
  typedCatalog?: TypedModelEntry[];
  catalogUnavailable?: boolean;
  catalogError?: string;
  modelScopeDiagnostics?: ModelScopeDiagnosticDto[];
  openRouterCatalog?: ModelCatalogRefreshStatus;
  modelList?: ModelEntry[];
  defaultModel?: SelectedModel | null;
  thinkingLevels?: Record<string, string[]>;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
  defaultThinkingLevel?: string | null;
};

type SlashCommandsResponse = {
  commands?: SlashCommandInfo[];
};

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, newSessionCwd, onAgentEnd, onSessionCreated, onUserMessageSent, onSessionNameChange, onSessionForked,
    modelsRefreshKey, packsRefreshKey, onBranchDataChange, onSystemPromptChange, onSessionStatsPanelOpen,
  } = opts;
  const workspaceCwd = session?.cwd ?? newSessionCwd;
  const workspacePackRevision = useWorkspacePackRevision(workspaceCwd);
  const previousWorkspacePacks = useRef({ cwd: workspaceCwd, revision: -1 });

  const isNew = session === null && newSessionCwd !== null;

  const notifyUserMessageSent = useCallback(() => {
    const cwd = session?.cwd ?? newSessionCwd;
    if (cwd) onUserMessageSent?.(cwd, session?.projectRoot);
  }, [newSessionCwd, onUserMessageSent, session?.cwd, session?.projectRoot]);

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [entryTimestamps, setEntryTimestamps] = useState<(number | null)[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const [agentRunning, setAgentRunning] = useState(false);
  const [inputSending, setInputSending] = useState(false);
  const inputRequestRef = useRef<string | null>(null);
  const inputEpochRef = useRef(0);
  const activePromptRequestIdRef = useRef<string | null>(null);
  const queueRevisionRef = useRef(0);
  const agentEventRevisionRef = useRef(0);
  const [promptGeneration, setPromptGeneration] = useState(0);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelCatalog, setModelCatalog] = useState<TypedModelEntry[]>([]);
  const [catalogUnavailable, setCatalogUnavailable] = useState(true);
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);
  const [modelScopeDiagnostics, setModelScopeDiagnostics] = useState<ModelScopeDiagnosticDto[]>([]);
  const [openRouterCatalog, setOpenRouterCatalog] = useState<ModelCatalogRefreshStatus | null>(null);
  const modelsReadRevision = useRef(0);
  const [routedModel, setRoutedModel] = useState<RoutedModel | null>(null);
  const contextRequestRevisionRef = useRef(0);
  const [modelCatalogRevision, setModelCatalogRevision] = useState(0);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModel] = useState<SelectedModel | null>(null);
  const [newSessionDefaultModel, setNewSessionDefaultModel] = useState<SelectedModel | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<SelectedModel | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<CompactResultInfo | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(false);
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, { visible: [], pending: [] });
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionStatusItem[]>([]);
  const [extensionWidgets, setExtensionWidgets] = useState<ExtensionWidgetItem[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessages>({ steering: [], followUp: [] });

  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const { items: extensionInteractions, active: extensionInteraction, applySnapshot: applyExtensionUiSnapshot,
    setValue: setExtensionInteractionValue, respond: respondToExtensionUi,
    sendCustomInput: sendExtensionCustomInput } = useExtensionInteractions(sessionIdRef);
  const extensionDialog = extensionInteraction?.request.method !== "custom" ? extensionInteraction?.request ?? null : null;
  const extensionCustomUi = extensionInteraction?.request.method === "custom" ? extensionInteraction.request : null;
  const extensionUiPendingRef = useRef(false);
  extensionUiPendingRef.current = extensionInteractions.length > 0;
  const timings = useTimings(sessionIdRef);
  const recordTimingEvent = timings.recordEvent;
  const stopActiveTimings = timings.stopActive;
  useEffect(() => {
    // Reconciliation can finish a run without receiving agent_end over SSE.
    if (!agentRunning) stopActiveTimings();
  }, [agentRunning, stopActiveTimings]);
  const baseDocumentTitleRef = useRef("Pivot UI");
  const extensionTitleRef = useRef<string | null>(null);
  const fastModeTitleSuffixRef = useRef<string | null>(null);
  const applyDocumentTitle = useCallback(() => {
    const base = extensionTitleRef.current ?? baseDocumentTitleRef.current;
    const suffix = fastModeTitleSuffixRef.current;
    const prefix = document.title.match(/^\[(?:Ongoing|Done)\] /)?.[0] ?? "";
    document.title = prefix + (suffix ? `${base} ${suffix}` : base);
  }, []);
  const queueToggleInFlightRef = useRef(false);
  const agentRunRef = useRef(new AgentRunState());
  const inputPending = inputSending || (agentRunRef.current.running && !agentRunning);
  const nestedStateRef = useRef(new NestedToolState());
  const [nestedCalls, setNestedCalls] = useState(new Map<string, NestedCallGroup>());
  const [partialToolResults, setPartialToolResults] = useState(new Map<string, ToolResultMessage>());
  const nestedPublishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventConnectionEpochRef = useRef(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const publishNested = useCallback(() => {
    if (nestedPublishTimerRef.current !== null) return;
    nestedPublishTimerRef.current = setTimeout(() => {
      nestedPublishTimerRef.current = null;
      setNestedCalls(nestedStateRef.current.snapshot());
    }, 100);
  }, []);
  const beginNested = useCallback((runId: number, restore = false) => {
    const sid = sessionIdRef.current;
    if (!sid || !nestedStateRef.current.begin(sid, runId)) return;
    setNestedCalls(new Map());
    setPartialToolResults(new Map());
    if (restore) {
      const completed = new Set(messagesRef.current.filter((msg) => msg.role === "toolResult").map((msg) => msg.toolCallId));
      for (const msg of messagesRef.current) if (msg.role === "assistant") {
        for (const block of msg.content) if (block.type === "toolCall" && !completed.has(block.toolCallId)) nestedStateRef.current.register(block.toolCallId);
      }
    }
  }, []);
  const clearNested = useCallback(() => {
    if (nestedPublishTimerRef.current !== null) clearTimeout(nestedPublishTimerRef.current);
    nestedPublishTimerRef.current = null;
    nestedStateRef.current.clear();
    setNestedCalls(new Map());
    setPartialToolResults(new Map());
  }, []);
  useEffect(() => {
    if (!agentRunning) {
      nestedStateRef.current.finish();
      publishNested();
      setPartialToolResults(previous => previous.size ? new Map() : previous);
    }
  }, [agentRunning, publishNested]);
  useEffect(() => () => {
    eventConnectionEpochRef.current += 1;
    inputEpochRef.current += 1;
    inputRequestRef.current = null;
    if (nestedPublishTimerRef.current !== null) clearTimeout(nestedPublishTimerRef.current);
    nestedStateRef.current.clear();
  }, []);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  const thinkingLevelUserSelectedRef = useRef(false);
  const newSessionPromotedRef = useRef(false);
  const optimisticUserMessageKeyRef = useRef<string | null>(null);
  const prevPacksRefreshKeyRef = useRef(packsRefreshKey);

  const savedSelection = data?.context.selectedModel ?? data?.context.model ?? null;
  const savedCatalogModel = modelCatalog.find(m => m.type === "chat" && m.provider === savedSelection?.provider && m.id === savedSelection?.modelId);
  const selectionNotice: "unknown" | "missing" | null = !currentModelOverride && savedSelection
    ? catalogUnavailable ? "unknown" : !savedCatalogModel ? "missing" : null
    : null;
  // Unknown catalog: preserve the recorded choice. Known missing router: SDK physical fallback.
  const historySelection = savedCatalogModel?.virtual || catalogUnavailable
    ? savedSelection : (data?.context.legacyModel ?? savedSelection);
  const currentModel: SelectedModel | null = currentModelOverride ?? historySelection ?? pendingModel ?? null;
  const displayModel: SelectedModel | null = isNew ? (newSessionModel ?? newSessionDefaultModel) : currentModel;
  const selectedCatalogModel = modelCatalog.find(m => m.type === "chat" && m.provider === displayModel?.provider && m.id === displayModel?.modelId);
  const selectedModelInfo = displayModel ? { ...displayModel,
    ...(selectedCatalogModel ? { virtual: displayModel.virtual ?? selectedCatalogModel.virtual,
      contextWindow: displayModel.contextWindow !== undefined ? displayModel.contextWindow : selectedCatalogModel.contextWindow,
      maxTokens: displayModel.maxTokens !== undefined ? displayModel.maxTokens : selectedCatalogModel.maxTokens } : {}) } : null;
  const routedCatalogModel = modelCatalog.find(m => m.type === "chat" && m.provider === routedModel?.provider && m.id === routedModel?.modelId);
  const routedModelInfo = routedModel ? { ...routedModel,
    ...(routedCatalogModel ? {
      contextWindow: routedModel.contextWindow !== undefined ? routedModel.contextWindow : routedCatalogModel.contextWindow,
      maxTokens: routedModel.maxTokens !== undefined ? routedModel.maxTokens : routedCatalogModel.maxTokens } : {}) } : null;

  const applyLiveModels = useCallback((state: AgentStateResponse) => {
    if (state.selectedModel !== undefined) {
      setCurrentModelOverride(state.selectedModel);
      setData(previous => previous ? { ...previous, context: { ...previous.context,
        selectedModel: state.selectedModel ?? null, legacyModel: state.selectedModel ?? null,
        model: state.selectedModel ?? null } } : previous);
    }
    if (state.routedModel !== undefined) setRoutedModel(state.routedModel);
  }, []);

  const { stats: sessionStats, refresh: refreshSessionStats } = useSessionStatistics(
    sessionIdRef.current ?? session?.id ?? null,
    agentRunning ? null : activeLeafId,
    agentRunning || isCompacting, messages, promptGeneration,
  );

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false, runId?: number) => {
    const epoch = inputEpochRef.current;
    const eventRevision = agentEventRevisionRef.current;
    const contextRevision = contextRequestRevisionRef.current;
    let messagesLoaded = false;
    try {
      if (showLoading) setLoading(true);
      const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1" });
      const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}?${params}`);
      if (res.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setEntryIds([]);
          setEntryTimestamps([]);
          setError(null);
        }
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData;
      if (sessionIdRef.current !== sid || inputEpochRef.current !== epoch
        || contextRequestRevisionRef.current !== contextRevision || (runId !== undefined && (!agentRunRef.current.isCurrent(runId)
          || agentEventRevisionRef.current !== eventRevision))) return null;
      for (const message of d.context.messages) if (message.role === "toolResult") nestedStateRef.current.settle(message.toolCallId, message.nestedCalls);
      publishNested();
      setData(d);
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setEntryTimestamps(d.context.entryTimestamps ?? []);
      setCurrentModelOverride(null);
      setRoutedModel(d.context.routedModel ?? null);
      setError(null);
      setThinkingLevel(normalizeThinkingLevel(d.context.thinkingLevel));

      messagesLoaded = true;
      if (showLoading) setLoading(false);
      if (!includeState) return null;

      try {
        const stateRes = await fetch(`/api/sessions/${encodeURIComponent(sid)}/state`);
        if (!stateRes.ok) throw new Error(`HTTP ${stateRes.status}`);
        const agentState = await stateRes.json() as { running: boolean; state?: AgentStateResponse };
        if (sessionIdRef.current !== sid || inputEpochRef.current !== epoch
          || contextRequestRevisionRef.current !== contextRevision || (runId !== undefined && (!agentRunRef.current.isCurrent(runId)
            || agentEventRevisionRef.current !== eventRevision))) return null;

        const liveState = agentState.state;
        if (liveState) {
          applyLiveModels(liveState);
          if (liveState.contextUsage !== undefined) setContextUsage(liveState.contextUsage ?? null);
          if (liveState.systemPrompt !== undefined) setSystemPrompt(liveState.systemPrompt ?? null);
          if (liveState.thinkingLevel !== undefined) setThinkingLevel((liveState.thinkingLevel as ThinkingLevelOption) ?? "auto");
          if (liveState.extensionStatuses !== undefined) setExtensionStatuses(liveState.extensionStatuses ?? []);
          if (liveState.extensionWidgets !== undefined) setExtensionWidgets(liveState.extensionWidgets ?? []);
          if (liveState.queuedMessages !== undefined) setQueuedMessages(normalizeQueuedMessages(liveState.queuedMessages));
        } else if (!agentState.running) {
          setQueuedMessages({ steering: [], followUp: [] });
        }
        return agentState;
      } catch (e) {
        console.error("Failed to load agent state:", e);
        return null;
      }
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      if (showLoading && !messagesLoaded) setLoading(false);
    }
  }, [applyLiveModels, publishNested]);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    const revision = ++contextRequestRevisionRef.current;
    clearNested();
    try {
      const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1" });
      // Empty explicitly selects the root; omitting leafId selects latest history.
      params.set("leafId", leafId ?? "");
      const url = `/api/sessions/${encodeURIComponent(sid)}/context?${params}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: SessionContext };
      if (sessionIdRef.current !== sid || contextRequestRevisionRef.current !== revision) return;
      setData(previous => previous ? { ...previous, context: d.context } : previous);
      setCurrentModelOverride(null);
      setRoutedModel(d.context.routedModel ?? null);
      setThinkingLevel(normalizeThinkingLevel(d.context.thinkingLevel));
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setEntryTimestamps(d.context.entryTimestamps ?? []);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, [clearNested]);

  const refreshLiveModels = useCallback(async (sid: string) => {
    const epoch = inputEpochRef.current;
    const runId = agentRunRef.current.runId;
    const revision = contextRequestRevisionRef.current;
    const eventRevision = agentEventRevisionRef.current;
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const snapshot = await res.json() as { state?: AgentStateResponse };
      if (sessionIdRef.current !== sid || inputEpochRef.current !== epoch
        || !agentRunRef.current.isCurrent(runId) || contextRequestRevisionRef.current !== revision
        || agentEventRevisionRef.current !== eventRevision) return;
      if (snapshot.state) applyLiveModels(snapshot.state);
    } catch { /* Retain the matching recorded selection on failed refresh. */ }
  }, [applyLiveModels]);

  const promoteNewSession = useCallback((messageCount = 0, firstMessage = "(no messages)") => {
    const sid = sessionIdRef.current;
    if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current) return;
    newSessionPromotedRef.current = true;
    // Move any newly edited input to the real session before props change;
    // only the unchanged accepted submission is cleared by the composer.
    opts.chatInputRef?.current?.promoteDraft?.(sid);
    clearDraft(`new:${newSessionCwd}`);
    // The composer clears only the unchanged, accepted input after the receipt.
    const now = new Date().toISOString();
    onSessionCreated?.({
      id: sid,
      path: "",
      cwd: newSessionCwd,
      name: undefined,
      created: now,
      modified: now,
      lastUserMessageAt: now,
      messageCount,
      firstMessage,
    });
  }, [isNew, newSessionCwd, onSessionCreated, opts.chatInputRef]);

  const ensureNewSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!isNew || !newSessionCwd) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;

    const epoch = inputEpochRef.current;
    const promise = (async () => {
      const selectedModel = newSessionModel ?? newSessionDefaultModel;
      if (selectedModel) setPendingModel(selectedModel);
      const res = await fetch("/api/agent/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: newSessionCwd,
          type: "ensure_session",
          ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
          ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json() as { sessionId: string };
      const realId = result.sessionId;
      if (inputEpochRef.current !== epoch) return null;
      sessionIdRef.current = realId;
      return realId;
    })();

    ensuringNewSessionRef.current = promise;
    try {
      return await promise;
    } finally {
      ensuringNewSessionRef.current = null;
    }
  }, [isNew, newSessionCwd, newSessionModel, newSessionDefaultModel, thinkingLevel]);

  const loadSlashCommands = useCallback(async () => {
    const epoch = inputEpochRef.current;
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (inputEpochRef.current !== epoch) return [] as SlashCommandInfo[];
    if (!sid) {
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    }
    setSlashCommandsLoading(true);
    try {
      const data = await sendAgentCommand<SlashCommandsResponse>(sid, { type: "get_commands" });
      const commands = data?.commands ?? [];
      if (sessionIdRef.current !== sid || inputEpochRef.current !== epoch) return [] as SlashCommandInfo[];
      setSlashCommands(commands);
      return commands;
    } catch (e) {
      console.error("Failed to load slash commands:", e);
      if (sessionIdRef.current === sid && inputEpochRef.current === epoch) setSlashCommands([]);
      return [] as SlashCommandInfo[];
    } finally {
      if (sessionIdRef.current === sid && inputEpochRef.current === epoch) setSlashCommandsLoading(false);
    }
  }, [ensureNewSession]);

  const loadSlashArgumentCompletions = useCallback(async (name: string, argumentPrefix: string) => {
    const sid = sessionIdRef.current;
    const epoch = inputEpochRef.current;
    if (!sid) return [];
    const data = await sendAgentCommand<{ items: SlashArgumentCompletion[] }>(sid, {
      type: "get_command_completions", name, argumentPrefix,
    });
    if (sessionIdRef.current !== sid || inputEpochRef.current !== epoch) return [];
    return data?.items ?? [];
  }, []);

  const connectEvents = useCallback((sid: string, clearError = false): Promise<EventStreamConnectionResult> => {
    const connectionEpoch = ++eventConnectionEpochRef.current;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    const errorParam = clearError ? "?clearError=1" : "";
    const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events${errorParam}`);
    eventSourceRef.current = es;

    return new Promise((resolve) => {
      let settled = false;
      const settle = (status: EventStreamConnectionStatus) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ status, source: es });
      };
      const timeout = setTimeout(() => settle("timeout"), EVENT_STREAM_CONNECT_TIMEOUT_MS);

      es.onmessage = (e) => {
        if (eventSourceRef.current !== es || sessionIdRef.current !== sid) return;
        try {
          const event = JSON.parse(e.data) as AgentEvent;
          if (event.type === "connected") settle("connected");
          handleAgentEventRef.current?.(event);
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        if (eventSourceRef.current !== es || sessionIdRef.current !== sid) return;
        nestedStateRef.current.interrupt();
        publishNested();
        if (es.readyState === EventSource.CLOSED) {
          // Fatal error (404/500/content-type mismatch): browser won't
          // auto-reconnect. Settle the Promise and manually reconnect for
          // already-running sessions.
          settle("closed");
          if (eventSourceRef.current === es && (agentRunRef.current.running || extensionUiPendingRef.current)) {
            eventSourceRef.current = null;
            setTimeout(() => {
              if (eventConnectionEpochRef.current === connectionEpoch && sessionIdRef.current === sid &&
                  (agentRunRef.current.running || extensionUiPendingRef.current) && !eventSourceRef.current) void connectEvents(sid);
            }, 1000);
          }
        }
        // Recoverable errors (CONNECTING): let EventSource auto-reconnect.
        // The timeout above resolves only to let callers decide whether this
        // connection must be ready before they continue.
      };
    });
  }, [publishNested]);

  const ensureEventsConnected = useCallback(async (sid: string) => {
    const result = await connectEvents(sid);
    if (result.status === "connected" || result.source.readyState === EventSource.OPEN) return;
    if (eventSourceRef.current === result.source) eventSourceRef.current = null;
    result.source.close();
    throw new EventStreamConnectionError(result.status);
  }, [connectEvents]);

  const addNotice = useCallback((notice: { id?: string; message: string; type?: NoticeType }) => {
    const message = notice.message.trim();
    if (!message) return;
    dispatchNotice({
      type: "add",
      notice: {
        id: notice.id ?? createNoticeId(),
        message,
        type: notice.type ?? "info",
      },
    });
  }, []);

  const dismissNotice = useCallback((id: string) => {
    dispatchNotice({ type: "remove", id });
  }, []);

  const dismissErrorNotices = useCallback(() => {
    dispatchNotice({ type: "remove_errors" });
  }, []);

  const ensurePackSkillsReloaded = useCallback(() => {
    return agentRunRef.current.reloadPacks(async () => {
      const sid = sessionIdRef.current;
      // An unsaved chat without an AgentSession discovers Packs on first send.
      if (!sid) return;
      await sendAgentCommand(sid, { type: "reload_workspace_packs" });
      await loadSlashCommands();
      await refreshLiveModels(sid);
      setModelCatalogRevision(revision => revision + 1);
    });
  }, [loadSlashCommands, refreshLiveModels]);

  useEffect(() => {
    const previous = previousWorkspacePacks.current;
    const changed = previous.cwd === workspaceCwd && previous.revision >= 0 && workspacePackRevision >= 0
      && previous.revision !== workspacePackRevision;
    previousWorkspacePacks.current = { cwd: workspaceCwd, revision: workspacePackRevision };
    if (prevPacksRefreshKeyRef.current === packsRefreshKey && !changed) return;
    prevPacksRefreshKeyRef.current = packsRefreshKey;
    if (agentRunRef.current.requestPackReload() === "deferred") {
      addNotice({ type: "info", message: "Workspace Pack changes will take effect after the current run ends." });
      return;
    }
    void ensurePackSkillsReloaded().catch((e) => {
      addNotice({ type: "error", message: `Failed to reload pack skills: ${String(e)}` });
    });
  }, [packsRefreshKey, workspaceCwd, workspacePackRevision, agentRunning, addNotice, ensurePackSkillsReloaded]);

  useEffect(() => {
    if (agentRunning || inputPending || agentRunRef.current.running || !agentRunRef.current.hasPendingPackReload) return;
    void ensurePackSkillsReloaded().catch((e) => {
      addNotice({ type: "error", message: `Failed to reload pack skills: ${String(e)}` });
    });
  }, [agentRunning, inputPending, addNotice, ensurePackSkillsReloaded]);

  const handleExtensionUiRequest = useCallback((request: ExtensionUiRequest) => {
    switch (request.method) {
      case "notify": {
        // Pivot already displays usage statistics; suppress extension TPS summaries only.
        if ((request.notifyType ?? "info") === "info"
          && /^TPS\s+\d+(?:\.\d+)?\s+tok\/s\.\s+out\s+[\d,]+,\s+in\s+[\d,]+,\s+cache r\/w\s+[\d,]+\/[\d,]+,\s+total\s+[\d,]+,\s+\d+(?:\.\d+)?s\s*$/i.test(request.message.trim())) break;
        addNotice({
          id: request.id,
          message: request.message,
          type: request.notifyType ?? "info",
        });
        break;
      }
      case "setStatus":
        setExtensionStatuses((prev) => {
          const rest = prev.filter((item) => item.key !== request.statusKey);
          return request.statusText ? [...rest, { key: request.statusKey, text: request.statusText }] : rest;
        });
        break;
      case "setWidget":
        setExtensionWidgets((prev) => {
          const rest = prev.filter((item) => item.key !== request.widgetKey);
          return request.widgetLines && request.widgetLines.length > 0
            ? [...rest, {
                key: request.widgetKey,
                lines: request.widgetLines,
                placement: request.widgetPlacement ?? "aboveEditor",
              }]
            : rest;
        });
        break;
      case "setTitle":
        extensionTitleRef.current = request.title || "Pivot UI";
        applyDocumentTitle();
        break;
      case "set_editor_text":
        opts.chatInputRef?.current?.insertText(request.text);
        break;
    }
  }, [addNotice, applyDocumentTitle, opts.chatInputRef]);

  // The shared pi-plugins statusline is delivered as a rendered widget. Keep
  // the fast-mode marker in the browser title while preserving any title set
  // by the session or another extension.
  useEffect(() => {
    const nextSuffix = getFastModeTitleSuffix(extensionWidgets);
    if (fastModeTitleSuffixRef.current === nextSuffix) return;
    fastModeTitleSuffixRef.current = nextSuffix;
    applyDocumentTitle();
  }, [applyDocumentTitle, extensionWidgets]);

  const finishPromptWithoutStream = useCallback(async (sid: string | null = sessionIdRef.current, runId?: number) => {
    const targetRunId = runId ?? agentRunRef.current.runId;
    // Bail out before loadSession too: a stale finish for a previous run
    // must not overwrite the messages of the run currently streaming.
    if (!agentRunRef.current.isCurrent(targetRunId)) return;
    const epoch = inputEpochRef.current;
    const eventRevision = agentEventRevisionRef.current;
    try {
      if (sid) await loadSession(sid, false, true, targetRunId);
    } finally {
      if (inputEpochRef.current !== epoch || agentEventRevisionRef.current !== eventRevision
        || (sid !== null && sessionIdRef.current !== sid) || !agentRunRef.current.finish(targetRunId)) return;
      optimisticUserMessageKeyRef.current = null;
      setAgentRunning(false);
      setAgentPhase(null);
      setRetryInfo(null);
      dispatch({ type: "end" });
      if (!inputRequestRef.current) setInputSending(false);
      if (agentRunRef.current.started) onAgentEnd?.();
    }
  }, [loadSession, onAgentEnd]);

  const waitForPromptSettlement = useCallback(async (sid: string, runId?: number) => {
    await delay(PROMPT_SETTLE_INITIAL_DELAY_MS);
    const startedAt = Date.now();

    while (agentRunRef.current.running && Date.now() - startedAt < PROMPT_SETTLE_MAX_MS) {
      if (sessionIdRef.current !== sid || (runId !== undefined && !agentRunRef.current.isCurrent(runId))) return;
      try {
        const eventRevision = agentEventRevisionRef.current;
        const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
        if (res.ok) {
          const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
          const state = data.state;
          if (sessionIdRef.current !== sid || (runId !== undefined && !agentRunRef.current.isCurrent(runId))
            || !agentRunRef.current.running) return;
          if (agentEventRevisionRef.current !== eventRevision) continue;
          if (!data.running || !state || (!state.isStreaming && !state.isPromptRunning && !state.isCompacting)) {
            await finishPromptWithoutStream(sid, runId);
            return;
          }
          if (state.isStreaming && !agentRunRef.current.started) {
            const confirmedRunId = agentRunRef.current.runId;
            if (agentRunRef.current.markStarted(confirmedRunId)) {
              beginNested(confirmedRunId, true);
              setPromptGeneration(confirmedRunId);
              setAgentRunning(true);
              if (!inputRequestRef.current) setInputSending(false);
              setAgentPhase({ kind: "waiting_model" });
              dispatch({ type: "start" });
            }
          }
        }
      } catch {
        // SSE remains the primary completion path.
      }
      await delay(PROMPT_SETTLE_POLL_MS);
    }
  }, [beginNested, finishPromptWithoutStream]);

  // Reconcile client streaming state with the server. When SSE events are
  // missed (network drop, mobile tab backgrounded, half-open connection),
  // agent_settled never arrives and the UI stays in streaming state forever.
  // If the server reports idle while we still think it's running, finish
  // through the same path as prompt_done.
  const reconcileAgentState = useCallback(async (sid: string, allowIdle = false) => {
    if ((!allowIdle && !agentRunRef.current.running) || sessionIdRef.current !== sid) return;
    // Before POST reaches the server, an idle snapshot cannot reject the input.
    if (inputRequestRef.current && !agentRunRef.current.started) return;
    const runId = agentRunRef.current.runId;
    const queueRevision = queueRevisionRef.current;
    const wasRunning = agentRunRef.current.running;
    const eventRevision = agentEventRevisionRef.current;
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
      // A slow response can straddle a run boundary (previous run finished
      // and the user already started the next one while this request was in
      // flight) — everything in it is stale, drop it.
      if (sessionIdRef.current !== sid || !agentRunRef.current.isCurrent(runId)
        || agentEventRevisionRef.current !== eventRevision || (wasRunning && !agentRunRef.current.running)) return;
      const state = data.state;
      if (state) applyLiveModels(state);
      // Context can change between turns while the same run remains busy.
      // Do not wait for reconciliation to finish the entire prompt.
      if (state?.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
      // Mirror compaction state unconditionally: a missed compaction_end
      // would otherwise leave the "Stop compaction" UI stuck. No state
      // (wrapper destroyed) means nothing is compacting.
      setIsCompacting(state?.isCompacting ?? false);
      if (queueRevisionRef.current === queueRevision) setQueuedMessages(normalizeQueuedMessages(state?.queuedMessages));
      const busy = data.running && state
        && (state.isStreaming || state.isPromptRunning || state.isCompacting);
      if (busy && state?.isStreaming && (!agentRunRef.current.running || !agentRunRef.current.started)) {
        const confirmedRunId = agentRunRef.current.ensureRunning();
        agentRunRef.current.markStarted(confirmedRunId);
        beginNested(confirmedRunId, true);
        setPromptGeneration(confirmedRunId);
        setAgentRunning(true);
        if (!inputRequestRef.current) setInputSending(false);
        setAgentPhase({ kind: "waiting_model" });
        dispatch({ type: "start" });
      }
      if (agentRunRef.current.reconcile(runId, Boolean(busy)) !== "finish") return;
      if (state) {
        if (state.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt ?? null);
        if (state.extensionStatuses !== undefined) setExtensionStatuses(state.extensionStatuses ?? []);
        if (state.extensionWidgets !== undefined) setExtensionWidgets(state.extensionWidgets ?? []);
      }
      await finishPromptWithoutStream(sid, runId);
    } catch {
      // Network still down — the next poll / visibility / online tick retries.
    }
  }, [applyLiveModels, beginNested, finishPromptWithoutStream]);

  // Recovery net for missed SSE events: while the agent is running, verify
  // against the server periodically and whenever the tab returns to the
  // foreground or the network comes back.
  useEffect(() => {
    if (!agentRunning && !inputPending) return;
    const reconcile = () => {
      // Read the ref on every tick: for brand-new sessions the id is
      // assigned only after ensure_session returns.
      const sid = sessionIdRef.current;
      if (sid) void reconcileAgentState(sid);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    const interval = setInterval(reconcile, AGENT_STATE_RECONCILE_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", reconcile);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", reconcile);
    };
  }, [agentRunning, inputPending, reconcileAgentState]);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    if (event.type.startsWith("tool_execution_")) {
      if (!agentRunRef.current.running) return;
      if (event.parentToolCallId !== undefined) {
        const sid = sessionIdRef.current;
        if (sid && nestedStateRef.current.observe(event, sid, agentRunRef.current.runId)) {
          recordTimingEvent(event);
          publishNested();
        }
        return; // Child calls never change the top-level phase or transcript.
      }
      if (!nestedStateRef.current.owns(event.toolCallId)) return;
    }
    if (event.type === "agent_start" || agentRunRef.current.running) recordTimingEvent(event);
    switch (event.type) {
      case "agent_start": {
        agentEventRevisionRef.current += 1;
        const runId = agentRunRef.current.ensureRunning();
        agentRunRef.current.markStarted(runId);
        beginNested(runId);
        setPromptGeneration(runId);
        setAgentRunning(true);
        if (!inputRequestRef.current) setInputSending(false);
        setAgentPhase({ kind: "waiting_model" });
        dispatch({ type: "start" });
        break;
      }
      case "turn_end":
        if (!agentRunRef.current.running) break;
        refreshSessionStats();
        break;
      case "agent_end": {
        if (!agentRunRef.current.running) break;
        if (event.willRetry !== true) {
          const messages = event.messages as Array<{ role?: string; stopReason?: string; errorMessage?: string }> | undefined;
          const failedMessage = messages?.find((message) => message.role === "assistant" && message.stopReason === "error");
          if (failedMessage) {
            addNotice({ type: "error", message: failedMessage.errorMessage ?? "Agent execution failed" });
          }
        }
        // A low-level run may still retry, compact or continue automatically.
        break;
      }
      case "agent_settled": {
        agentEventRevisionRef.current += 1;
        // A settlement from the previous run cannot settle pending input hooks.
        if (!agentRunRef.current.started) break;
        const settledRunId = agentRunRef.current.runId;
        const settledSid = sessionIdRef.current;
        const settledContextRevision = contextRequestRevisionRef.current;
        const settledEventRevision = agentEventRevisionRef.current;
        const queueRevision = queueRevisionRef.current;
        if (!agentRunRef.current.finish(settledRunId)) break;
        refreshSessionStats();
        setAgentRunning(false);
        if (!inputRequestRef.current) setInputSending(false);
        setAgentPhase(null);
        setRetryInfo(null);
        dispatch({ type: "end" });
        if (sessionIdRef.current) {
          loadSession(sessionIdRef.current, false, false, settledRunId)
            .then(() => {
              if (sessionIdRef.current !== settledSid || !agentRunRef.current.isCurrent(settledRunId)
                || contextRequestRevisionRef.current !== settledContextRevision
                || agentEventRevisionRef.current !== settledEventRevision) return {};
              return fetch(`/api/agent/${encodeURIComponent(settledSid!)}`).then(r => r.ok ? r.json() : {});
            })
            .then((d: { state?: AgentStateResponse }) => {
              if (sessionIdRef.current !== settledSid || !agentRunRef.current.isCurrent(settledRunId)
                || contextRequestRevisionRef.current !== settledContextRevision
                || agentEventRevisionRef.current !== settledEventRevision) return;
              if (d.state) applyLiveModels(d.state);
              if (d.state?.contextUsage !== undefined) setContextUsage(d.state.contextUsage ?? null);
              if (d.state?.systemPrompt !== undefined) setSystemPrompt(d.state.systemPrompt ?? null);
              if (d.state?.extensionStatuses !== undefined) setExtensionStatuses(d.state.extensionStatuses ?? []);
              if (d.state?.extensionWidgets !== undefined) setExtensionWidgets(d.state.extensionWidgets ?? []);
              // Aborted turns can leave messages queued in pi (delivered with the
              // next turn); dead wrapper (no state) means the queue is gone.
              if (queueRevisionRef.current === queueRevision) setQueuedMessages(normalizeQueuedMessages(d.state?.queuedMessages));
            })
            .catch(() => {});
        }
        if (event.aborted !== true) onAgentEnd?.();
        break;
      }
      case "workspace_packs_reloaded":
        if (sessionIdRef.current) void refreshLiveModels(sessionIdRef.current);
        setModelCatalogRevision(revision => revision + 1);
        break;
      case "prompt_done":
        if (event.requestId && activePromptRequestIdRef.current && event.requestId !== activePromptRequestIdRef.current) break;
        // A handled command may have started its own run; done is not settled.
        if (!inputRequestRef.current && sessionIdRef.current) void reconcileAgentState(sessionIdRef.current);
        break;
      case "prompt_error":
        if (event.requestId && activePromptRequestIdRef.current && event.requestId !== activePromptRequestIdRef.current) break;
        addNotice({ type: "error", message: (event.errorMessage as string | undefined) ?? "Command failed" });
        break;
      case "extension_error":
        addNotice({
          type: "error",
          message: (event.error as string | undefined) ?? "Extension command failed",
        });
        break;
      case "message_start":
      case "message_update": {
        // Ignore streaming events arriving after this run already finished
        // (e.g. SSE data buffered while the tab was frozen, flushed after
        // reconcile) — they would resurrect a ghost streaming bubble.
        if (!agentRunRef.current.running) break;
        const msg = event.message as Partial<AgentMessage> | undefined;
        if (msg?.role === "user") {
          break;
        }
        if (msg) {
          const normalized = normalizeToolCalls(msg as AgentMessage);
          // auto_retry_end can be missed when the SSE connection is briefly
          // interrupted. A non-error assistant response is an equally reliable
          // signal that the retry banner is no longer relevant.
          if (normalized.role === "assistant" && normalized.stopReason !== "error") {
            setRetryInfo(null);
          }
          dispatch({ type: "update", message: normalized });
        }
        setAgentPhase(null);
        break;
      }
      case "message_end": {
        // Same late-event guard: after reconcile finished this run,
        // loadSession already loaded this message from the session file —
        // appending it again would duplicate it.
        if (!agentRunRef.current.running) break;
        const completed = event.message as AgentMessage | undefined;
        if (completed) {
          const responseModel = successfulResponseModel(completed);
          if (responseModel) setRoutedModel(responseModel);
          nestedStateRef.current.observeMessage(normalizeToolCalls(completed));
          publishNested();
          if (completed.role === "toolResult") {
            setPartialToolResults(previous => {
              if (!previous.has(completed.toolCallId)) return previous;
              const next = new Map(previous);
              next.delete(completed.toolCallId);
              return next;
            });
          }
        }
        if (completed?.role === "assistant" && completed.stopReason !== "error") {
          setRetryInfo(null);
        }
        if (completed && completed.role === "user") {
          // Only SDK-confirmed messages enter the transcript, including
          // transformed initial prompts and delivered queue messages. Keep
          // legacy optimistic reconciliation for existing mounted clients.
          const delivered = normalizeToolCalls(completed);
          const optimisticKey = optimisticUserMessageKeyRef.current;
          optimisticUserMessageKeyRef.current = null;
          setMessages((prev) => reconcileOptimisticUserMessage(prev, delivered, optimisticKey));
        } else if (completed) {
          setMessages((prev) => [...prev, normalizeToolCalls(completed)]);
        }
        dispatch({ type: "reset" });
        setAgentPhase({ kind: "waiting_model" });
        break;
      }
      case "tool_execution_start": {
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        setAgentPhase((prev) => {
          const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
          if (!tools.some((t) => t.id === id)) tools.push({ id, name });
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "tool_execution_update": {
        const id = event.toolCallId as string;
        const partial = event.partialResult as { content?: ToolResultMessage["content"]; details?: unknown } | undefined;
        if (!partial || !Array.isArray(partial.content)) break;
        const content = partial.content;
        // SDK updates are complete snapshots, not deltas. Keep them separate
        // from transcript messages and never overwrite a completed result.
        if (messagesRef.current.some(message => message.role === "toolResult" && message.toolCallId === id)) break;
        setPartialToolResults(previous => new Map(previous).set(id, {
          role: "toolResult",
          toolCallId: id,
          toolName: event.toolName as string,
          content,
          details: partial.details,
          isPartial: true,
        }));
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId as string;
        setAgentPhase((prev) => {
          if (prev?.kind !== "running_tools") return prev;
          const tools = prev.tools.filter((t) => t.id !== id);
          if (tools.length === 0) return { kind: "waiting_model" };
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "queue_update":
        queueRevisionRef.current += 1;
        setQueuedMessages({
          steering: [...((event.steering as string[] | undefined) ?? [])],
          followUp: [...((event.followUp as string[] | undefined) ?? [])],
        });
        break;
      case "auto_retry_start":
        setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;
      case "auto_retry_end":
        setRetryInfo(null);
        break;
      case "auto_compaction_start":
      case "compaction_start":
        setIsCompacting(true);
        setCompactError(null);
        setCompactResult(null);
        break;
      case "auto_compaction_end":
      case "compaction_end":
        // The pre-compaction live value is no longer applicable. Statistics
        // supply the rebuilt context, including the offline fallback.
        setContextUsage(null);
        refreshSessionStats();
        setIsCompacting(false);
        if (event.errorMessage) {
          setCompactError(event.errorMessage as string);
          setCompactResult(null);
        } else if (!event.aborted) {
          setCompactResult(readCompactResult(event.result, (event.reason as string | undefined) ?? "auto"));
          if (sessionIdRef.current) loadSession(sessionIdRef.current);
        }
        break;
      case "session_info_changed": {
        const sid = sessionIdRef.current;
        if (sid) onSessionNameChange?.(sid, typeof event.name === "string" ? event.name : undefined);
        break;
      }
      case "extension_ui_snapshot":
        applyExtensionUiSnapshot(event as unknown as ExtensionUiSnapshot);
        break;
      case "extension_ui_request":
        // Interactive requests arrive in the ordered authoritative snapshot.
        handleExtensionUiRequest(event as ExtensionUiRequest);
        break;
    }
  }, [addNotice, applyLiveModels, applyExtensionUiSnapshot, beginNested, handleExtensionUiRequest, loadSession, onAgentEnd, onSessionNameChange, publishNested, reconcileAgentState, recordTimingEvent, refreshLiveModels, refreshSessionStats]);
  handleAgentEventRef.current = handleAgentEvent;

  // Sanitize a file name for embedding inside a <file name="..."> tag.
  const escapeFileTagName = useCallback((name: string) => name.replace(/[<>]/g, "_").replace(/[\r\n]+/g, " "), []);

  // Turn attachments into <file> text fragments appended to the prompt.
  // Every attachment is uploaded to ~/.pivot-ui/attachments/ before the user
  // can send (the send button is gated on all attachments being ready), so
  // here we only reference the saved path — the agent reads files with its
  // tools. Returns null if an attachment is not ready.
  // Resolve attachments into (a) pi image content blocks for images (base64,
  // same as the original image flow) and (b) <file> path references for
  // uploaded files. The reference content is the absolute saved path — the
  // agent reads it with its tools, and MessageView renders it as a clickable
  // file link. Throws if an uploaded attachment is not ready.
  const prepareAttachments = useCallback(async (attachments: ChatAttachment[] | undefined): Promise<{
    piImages: { type: "image"; data: string; mimeType: string }[];
    fileText: string;
  }> => {
    const piImages: { type: "image"; data: string; mimeType: string }[] = [];
    const fileParts: string[] = [];
    for (const att of attachments ?? []) {
      if (att.mimeType.startsWith("image/")) {
        if (att.data) piImages.push({ type: "image", data: att.data, mimeType: att.mimeType });
        continue;
      }
      if (!att.savedPath) {
        throw new Error(`Attachment "${att.name}" is not uploaded yet`);
      }
      fileParts.push(`<file name="${escapeFileTagName(att.name)}">${att.savedPath}</file>`);
    }
    return { piImages, fileText: fileParts.join("\n") };
  }, [escapeFileTagName]);

  const handleSend = useCallback(async (message: string, attachments?: ChatAttachment[]) => {
    const trimmedMessage = message.trim();
    if ((!trimmedMessage && !attachments?.length) || agentRunRef.current.running || inputRequestRef.current) return false;
    const requestId = createNoticeId();
    const epoch = inputEpochRef.current;
    const promptRunId = agentRunRef.current.start(); // Reserve dispatch, not execution.
    inputRequestRef.current = requestId;
    activePromptRequestIdRef.current = requestId;
    setInputSending(true);
    dismissErrorNotices();
    setRetryInfo(null);
    const ownsRequest = () => inputEpochRef.current === epoch && inputRequestRef.current === requestId;
    try {
      await ensurePackSkillsReloaded();
      const { piImages, fileText } = await prepareAttachments(attachments);
      if (!ownsRequest()) return false;
      const fullMessage = [trimmedMessage, fileText].filter(Boolean).join("\n");
      const existingSid = sessionIdRef.current;
      const sid = existingSid ?? await ensureNewSession();
      if (!ownsRequest()) return false;
      if (!sid) throw new Error("No session available for this input");
      if (isNew && newSessionModel) {
        setPendingModel(newSessionModel);
        if (existingSid) await sendAgentCommand(sid, {
          type: "set_model", provider: newSessionModel.provider, modelId: newSessionModel.modelId,
        });
      }
      await ensureEventsConnected(sid);
      if (!ownsRequest() || sessionIdRef.current !== sid) return false;
      const receipt = readInputReceipt(await sendAgentCommand(sid, {
        type: "prompt", requestId, message: fullMessage,
        ...(piImages.length ? { images: piImages } : {}),
      }));
      if (!ownsRequest() || sessionIdRef.current !== sid) return true;
      // Fast SSE may have already settled this run. Never revive it from HTTP.
      if (agentRunRef.current.isCurrent(promptRunId)) {
        if (receipt?.disposition === "started" && !agentRunRef.current.started
          && agentRunRef.current.markStarted(promptRunId)) {
          beginNested(promptRunId);
          setPromptGeneration(promptRunId);
          setAgentRunning(true);
          setAgentPhase({ kind: "waiting_model" });
          dispatch({ type: "start" });
        }
        notifyUserMessageSent();
        promoteNewSession(receipt?.disposition === "started" ? 1 : 0,
          receipt?.disposition === "started" ? message : "(no messages)");
        // Receipt acknowledged: idle reconciliation can now settle handled
        // input. For legacy null receipts it discovers execution, not guesses.
        inputRequestRef.current = null;
        await reconcileAgentState(sid);
        if (agentRunRef.current.isCurrent(promptRunId) && agentRunRef.current.running) {
          void waitForPromptSettlement(sid, promptRunId);
        }
      }
      return true;
    } catch (e) {
      if (!ownsRequest()) return false;
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      // A command may have started its own run before rejecting the input.
      if (agentRunRef.current.isCurrent(promptRunId) && !agentRunRef.current.started
        && agentRunRef.current.finish(promptRunId)) {
        setAgentRunning(false);
        setAgentPhase(null);
        dispatch({ type: "end" });
      }
      return false;
    } finally {
      if (inputEpochRef.current === epoch && (inputRequestRef.current === requestId || inputRequestRef.current === null)) {
        if (inputRequestRef.current === requestId) inputRequestRef.current = null;
        setInputSending(false);
      }
    }
  }, [beginNested, isNew, newSessionModel, ensureNewSession, ensureEventsConnected, notifyUserMessageSent,
    promoteNewSession, reconcileAgentState, waitForPromptSettlement, addNotice, dismissErrorNotices,
    ensurePackSkillsReloaded, prepareAttachments]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, []);

  const handleFork = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(entryId);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
        type: "fork",
        entryId,
      });
      const { cancelled, newSessionId } = result ?? {};
      if (sessionIdRef.current === sid && !cancelled && newSessionId) {
        onSessionForked?.(newSessionId);
      }
    } catch (e) {
      if (sessionIdRef.current === sid) {
        addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      if (sessionIdRef.current === sid) setForkingEntryId(null);
    }
  }, [onSessionForked, addNotice]);

  const handleNavigate = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid || agentRunRef.current.running || inputSending || isCompacting) return;
    const revision = ++contextRequestRevisionRef.current;
    try {
      const result = await sendAgentCommand<{
        cancelled: boolean; leafId: string | null; editorText?: string;
      }>(sid, { type: "navigate_tree", targetId: entryId });
      if (sessionIdRef.current !== sid || contextRequestRevisionRef.current !== revision || result.cancelled) return;
      // User-node navigation rewinds to its actual parent, not the selected ID.
      setActiveLeafId(result.leafId);
      if (result.editorText !== undefined) opts.chatInputRef?.current?.insertIfEmpty(result.editorText);
      await loadContext(sid, result.leafId);
      if (sessionIdRef.current === sid) await refreshLiveModels(sid);
    } catch (e) {
      if (sessionIdRef.current === sid && contextRequestRevisionRef.current === revision) {
        addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
  }, [loadContext, refreshLiveModels, opts.chatInputRef, inputSending, isCompacting, addNotice]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    if (leafId) {
      await handleNavigate(leafId);
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid || agentRunRef.current.running || inputSending || isCompacting) return;
    setActiveLeafId(null);
    await loadContext(sid, null);
  }, [handleNavigate, loadContext, inputSending, isCompacting]);

  const persistNewSessionDefault = useCallback(async (selection: { provider: string; modelId: string } | { thinkingLevel: string }) => {
    const res = await fetch("/api/models/defaults", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: newSessionCwd, ...selection }),
    });
    if (!res.ok) throw new Error(`Failed to save default: HTTP ${res.status}`);
  }, [newSessionCwd]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    if (isNew) {
      setNewSessionModel({ provider, modelId });
      setPendingModel({ provider, modelId });
      try {
        await persistNewSessionDefault({ provider, modelId });
      } catch (e) {
        console.error("Failed to save default model:", e);
        addNotice({ type: "error", message: "Failed to save default model" });
      }
      const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
      if (sid) {
        try {
          await sendAgentCommand(sid, { type: "set_model", provider, modelId });
        } catch (e) {
          console.error("Failed to set model:", e);
        }
      }
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_model", provider, modelId, persist: true });
      setCurrentModelOverride({ provider, modelId });
    } catch (e) {
      console.error("Failed to set model:", e);
      addNotice({ type: "error", message: "Failed to save default model" });
    }
  }, [isNew, persistNewSessionDefault, addNotice]);

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    setCompactResult(null);
    try {
      const result = await sendAgentCommand<CompactCommandResult>(sid, { type: "compact" });
      setCompactResult(readCompactResult(result, "manual"));
      await loadSession(sid, true);
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : String(e));
      setCompactResult(null);
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession]);

  const loadModels = useCallback(async (signal?: AbortSignal) => {
    const revision = ++modelsReadRevision.current;
    const modelCwd = newSessionCwd ?? session?.cwd ?? "";
    const modelsUrl = modelCwd ? `/api/models?cwd=${encodeURIComponent(modelCwd)}` : "/api/models";
    const res = await fetch(modelsUrl, signal ? { signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json() as ModelsResponse;
    signal?.throwIfAborted();
    if (revision !== modelsReadRevision.current) return;
    setModelCatalogError(d.catalogError ?? null);
    setModelScopeDiagnostics(d.modelScopeDiagnostics ?? []);
    setOpenRouterCatalog(d.openRouterCatalog ?? null);
    setModelNames(d.models);
    setModelCatalog(d.typedCatalog ?? []);
    setCatalogUnavailable(d.catalogUnavailable !== false);
    setModelThinkingLevels(d.thinkingLevels ?? {});
    setModelThinkingLevelMaps(d.thinkingLevelMaps ?? {});
    const nextModelList = d.modelList ?? [];
    setModelList(nextModelList);
    if (isNew && !thinkingLevelUserSelectedRef.current) {
      setThinkingLevel(normalizeThinkingLevel(d.defaultThinkingLevel));
    }
    if (isNew) {
      const match = d.defaultModel
        ? nextModelList.find((m) => m.id === d.defaultModel?.modelId && m.provider === d.defaultModel?.provider)
        : undefined;
      const displayModel = match ?? nextModelList[0];
      setNewSessionDefaultModel(displayModel ? { provider: displayModel.provider, modelId: displayModel.id } : null);
    }
  }, [isNew, newSessionCwd, session?.cwd]);

  const { refresh: refreshOpenRouterModels, refreshing: modelsRefreshing, refreshError: modelsRefreshError } =
    useModelCatalogRefresh("openrouter", workspaceCwd ?? undefined, loadModels);

  const handleBuiltinSlashCommand = useCallback(async (text: string): Promise<BuiltinSlashCommandResult> => {
    if (!text.startsWith("/")) return { handled: false };
    const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!match) return { handled: false };

    const [, commandName, rawArgs = ""] = match;
    const args = rawArgs.trim();
    dismissErrorNotices();
    setRetryInfo(null);
    const sid = sessionIdRef.current ?? await ensureNewSession();
    const complete = (result: BuiltinSlashCommandResult): BuiltinSlashCommandResult => {
      if (!result.handled) return result;
      if (result.error) {
        addNotice({ type: "error", message: result.error });
      } else if (result.action !== "openSessionStats") {
        addNotice({ type: "success", message: result.message ?? "Command completed" });
      }
      return result;
    };

    try {
      switch (commandName) {
        case "compact": {
          if (!sid || isCompacting) return complete({ handled: true, error: "No active session to compact" });
          setIsCompacting(true);
          setCompactError(null);
          setCompactResult(null);
          const result = await sendAgentCommand<CompactCommandResult>(sid, {
            type: "compact",
            ...(args ? { customInstructions: args } : {}),
          });
          setCompactResult(readCompactResult(result, "manual"));
          if (await loadSession(sid, true)) promoteNewSession();
          return complete({ handled: true, message: "Compacted context" });
        }

        case "reload": {
          if (!sid) return complete({ handled: true, error: "No active session to reload" });
          await sendAgentCommand(sid, { type: "reload" });
          await Promise.all([
            loadSession(sid, false, true),
            loadSlashCommands(),
            loadModels(),
          ]);
          return complete({ handled: true, message: "Reloaded session resources" });
        }

        case "name": {
          if (!sid) return complete({ handled: true, error: "No active session to name" });
          if (!args) return complete({ handled: true, error: "Usage: /name <name>" });
          await sendAgentCommand(sid, { type: "set_session_name", name: args });
          if (await loadSession(sid)) promoteNewSession();
          return complete({ handled: true, message: `Session renamed to ${args}` });
        }

        case "session": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          refreshSessionStats();
          onSessionStatsPanelOpen?.();
          return complete({ handled: true, action: "openSessionStats" });
        }

        case "copy": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          const data = await sendAgentCommand<LastAssistantTextResponse>(sid, { type: "get_last_assistant_text" });
          const textToCopy = data?.text ?? "";
          if (!textToCopy) return complete({ handled: true, error: "No assistant message to copy" });
          await navigator.clipboard.writeText(textToCopy);
          return complete({ handled: true, message: "Copied last assistant message" });
        }

        default:
          return { handled: false };
      }
    } catch (e) {
      return complete({ handled: true, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (commandName === "compact") setIsCompacting(false);
    }
  }, [addNotice, dismissErrorNotices, ensureNewSession, isCompacting, loadModels, loadSession, loadSlashCommands, promoteNewSession, onSessionStatsPanelOpen, refreshSessionStats]);

  // Queued (undelivered) messages live in the queue panel only; the chat gets
  // the real user message when pi delivers it (user message_end event). An
  // optimistic chat bubble here would duplicate the queue panel and turn into
  // a ghost message if the queue is recalled.
  const submitQueuedInput = useCallback(async (command: Record<string, unknown>) => {
    const sid = sessionIdRef.current;
    if (!sid || inputRequestRef.current) return false;
    const requestId = createNoticeId();
    const epoch = inputEpochRef.current;
    inputRequestRef.current = requestId;
    setInputSending(true);
    dismissErrorNotices();
    setRetryInfo(null);
    try {
      const receipt = readInputReceipt(await sendAgentCommand(sid, { ...command, requestId }));
      if (inputEpochRef.current !== epoch || sessionIdRef.current !== sid) return true;
      if (receipt?.disposition === "started") activePromptRequestIdRef.current = requestId;
      notifyUserMessageSent();
      inputRequestRef.current = null;
      // SDK queue_update is authoritative. Fetch state for missed SSE/handled
      // commands, never append raw submitted text to a transformed queue.
      await reconcileAgentState(sid, true);
      if (!agentRunRef.current.running) await loadSession(sid, false, false, agentRunRef.current.runId);
      return true;
    } catch (e) {
      if (inputEpochRef.current === epoch && sessionIdRef.current === sid) {
        addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
      return false;
    } finally {
      if (inputEpochRef.current === epoch && (inputRequestRef.current === requestId || inputRequestRef.current === null)) {
        if (inputRequestRef.current === requestId) inputRequestRef.current = null;
        setInputSending(false);
      }
    }
  }, [addNotice, dismissErrorNotices, loadSession, notifyUserMessageSent, reconcileAgentState]);

  const handleSteer = useCallback((message: string) => submitQueuedInput({
    type: "steer", message,
  }), [submitQueuedInput]);

  const handleToggleQueuedMessage = useCallback(async (
    mode: "steer" | "followUp",
    index: number,
    message: string,
  ) => {
    const sid = sessionIdRef.current;
    if (!sid || queueToggleInFlightRef.current) return;
    queueToggleInFlightRef.current = true;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, {
        type: "toggle_queue_message",
        mode,
        index,
        message,
      });
      if (result) setQueuedMessages(normalizeQueuedMessages(result));
    } catch (e) {
      console.error("Failed to switch queued message mode:", e);
      addNotice({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to switch queued message mode",
      });
    } finally {
      queueToggleInFlightRef.current = false;
    }
  }, [addNotice]);

  const handlePromptWithStreamingBehavior = useCallback((message: string, behavior: "steer" | "followUp") =>
    submitQueuedInput({ type: "prompt", message, streamingBehavior: behavior }), [submitQueuedInput]);

  const handleFollowUp = useCallback((message: string) => submitQueuedInput({
    type: "follow_up", message,
  }), [submitQueuedInput]);

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, []);

  const handleRecallQueue = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, { type: "clear_queue" });
      // clearQueue also emits an empty queue_update, but that only reaches us
      // while SSE is connected — clear locally so idle recalls update the UI.
      setQueuedMessages({ steering: [], followUp: [] });
      const texts = [...(result?.steering ?? []), ...(result?.followUp ?? [])];
      if (texts.length > 0) {
        opts.chatInputRef?.current?.prependText(texts.join("\n\n"));
      }
    } catch (e) {
      console.error("Failed to recall queued messages:", e);
      addNotice({ type: "error", message: "Failed to recall queued messages" });
    }
  }, [opts.chatInputRef, addNotice]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    thinkingLevelUserSelectedRef.current = true;
    setThinkingLevel(level);
    if (level === "auto") return; // "auto" leaves pi's current setting untouched
    if (isNew) {
      try {
        await persistNewSessionDefault({ thinkingLevel: level });
      } catch (e) {
        console.error("Failed to save default thinking level:", e);
        addNotice({ type: "error", message: "Failed to save default thinking level" });
      }
    }
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level, persist: !isNew });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
      addNotice({ type: "error", message: "Failed to save default thinking level" });
    }
  }, [isNew, persistNewSessionDefault, addNotice]);

  // Load session on mount. Restore a deterministic browser title when
  // switching away from a session whose extension set a custom title. The
  // selected session's runtime may replace this shortly through the extension
  // UI event bridge.
  useEffect(() => {
    let cancelled = false;
    baseDocumentTitleRef.current = getSessionDocumentTitle(session);
    extensionTitleRef.current = null;
    fastModeTitleSuffixRef.current = null;
    applyDocumentTitle();
    if (session) {
      sessionIdRef.current = session.id;
      loadSession(session.id, true, true).then((agentState) => {
        if (cancelled) return;
        // The state endpoint does not start idle sessions. Fetching tools does:
        // wait for the actual restored loadout rather than showing the initial
        // full placeholder until this session is opened a second time.
        if (agentState?.running) {
          if (agentState.state?.isStreaming || agentState.state?.isPromptRunning) {
            const runId = agentRunRef.current.ensureRunning();
            if (agentState.state.isStreaming) {
              agentRunRef.current.markStarted(runId);
              beginNested(runId, true);
              setPromptGeneration(runId);
              setAgentRunning(true);
              setAgentPhase({ kind: "waiting_model" });
              dispatch({ type: "start" });
            } else {
              setInputSending(true);
              void waitForPromptSettlement(session.id, runId);
            }
          }
        }
        if (agentState?.state) {
          applyLiveModels(agentState.state);
          if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
          if (agentState.state.contextUsage !== undefined) setContextUsage(agentState.state.contextUsage ?? null);
          if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
          if (agentState.state.thinkingLevel !== undefined) setThinkingLevel((agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto");
          if (agentState.state.extensionStatuses !== undefined) setExtensionStatuses(agentState.state.extensionStatuses ?? []);
          if (agentState.state.extensionWidgets !== undefined) setExtensionWidgets(agentState.state.extensionWidgets ?? []);
          if (agentState.state.queuedMessages !== undefined) setQueuedMessages(normalizeQueuedMessages(agentState.state.queuedMessages));
        }
        // Keep the selected session connected even while idle. Besides
        // streaming agent events, this lets extensions synchronize browser UI
        // during session_start (for example, a session-title extension can
        // restore the document title when the user switches sessions).
        void connectEvents(session.id, true);
      });
    }
    return () => {
      cancelled = true;
      eventConnectionEpochRef.current += 1;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (extensionTitleRef.current !== null) return;
    baseDocumentTitleRef.current = getSessionDocumentTitle(session);
    applyDocumentTitle();
  }, [applyDocumentTitle, session?.name, session?.firstMessage]);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
  }, [data?.tree, activeLeafId, handleLeafChange, onBranchDataChange]);

  // Load model list
  useEffect(() => {
    const controller = new AbortController();
    loadModels(controller.signal).catch((e) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
    });
    return () => controller.abort();
  }, [loadModels, modelsRefreshKey, modelCatalogRevision]);

  // Compact error auto-dismiss
  useEffect(() => {
    if (!compactError) return;
    const t = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(t);
  }, [compactError]);

  useEffect(() => {
    if (!compactResult) return;
    const t = setTimeout(() => setCompactResult(null), 6000);
    return () => clearTimeout(t);
  }, [compactResult]);

  useEffect(() => {
    if (noticeState.visible.length === 0) return;
    const exiting = noticeState.visible.find((notice) => notice.exiting);
    if (exiting) {
      const t = setTimeout(() => {
        dispatchNotice({ type: "remove", id: exiting.id });
      }, NOTICE_EXIT_ANIMATION_MS);
      return () => clearTimeout(t);
    }
    const oldestDismissible = noticeState.visible.find((notice) => !notice.exiting && notice.type !== "error");
    if (!oldestDismissible) return;
    const t = setTimeout(() => {
      dispatchNotice({ type: "mark_oldest_dismissible_exiting" });
    }, NOTICE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [noticeState.visible]);

  return {
    // State
    data, loading, error, activeLeafId, messages, entryIds, entryTimestamps, streamState,
    agentRunning, inputSending: inputPending, promptGeneration, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel, thinkingLevel,
    openRouterCatalog, modelCatalogError, modelScopeDiagnostics, modelsRefreshing, modelsRefreshError, refreshOpenRouterModels,
    retryInfo, contextUsage, systemPrompt, forkingEntryId,
    isCompacting, compactError, compactResult, currentModel, displayModel, selectedModelInfo, routedModel: routedModelInfo, selectionNotice, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices: noticeState.visible, dismissNotice, extensionDialog, extensionCustomUi, extensionInteraction,
    extensionInteractions, setExtensionInteractionValue, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    isAutoModelSelection: isNew && newSessionModel === null,
    agentPhase, timings, nestedCalls, partialToolResults,
    isNew,
    // Runtime refs
    sessionIdRef, eventSourceRef,
    // Actions
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    handleToggleQueuedMessage,
    handleBuiltinSlashCommand,
    handleThinkingLevelChange, loadSlashCommands, loadSlashArgumentCompletions, setActiveLeafId, setData, setMessages,
    dispatch, setAgentRunning, setForkingEntryId, addNotice,
    // Subscriptions
    handleAgentEventRef,
  };
}
