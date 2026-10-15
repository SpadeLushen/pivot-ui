import { createAgentSessionFromServices, getAgentDir, initTheme, SessionManager, Theme } from "@earendil-works/pi-coding-agent";
import { PlainTextTheme } from "./plain-text-theme";
import { KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { randomUUID } from "crypto";
import { invalidateModelsCache } from "./models-cache";
import { cacheSessionPath, invalidateSessionListCache } from "./session-reader";
import { branchModelSelection } from "./session-models";
import { knownModelLimit, VIRTUAL_CHAT_API } from "./response-model";
import { sessionStatistics } from "./session-statistics";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ExtensionUiContextLike, ToolInfo } from "./pi-types";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "./types";
import { EXTENSION_STATUSLINE_WIDGET_KEY } from "./extension-statusline";
import type { ToolPreset } from "./tool-presets";
import { activateAllSessionTools } from "./active-tools";
import { readWorkspaceTools, subscribeWorkspaceTools } from "./workspace-tools";
import { appliedToolRulesRevision, toolRulesFailed } from "./tool-application";
import { codemodeValues, readOrchestration } from "./tool-orchestration";
import type { OrchestrationSnapshot, ToolApplicationState } from "./tool-settings-types";
import { workspaceKey } from "./workspace-pack-files";
import { resourceRevision, subscribeResourceChanges } from "./session-resource-events";
import { persistEmptySession } from "./session-persistence";
import { readWorkspaceState } from "./workspace-packs";
import { subscribeWorkspacePacks } from "./workspace-pack-events";
import { createPivotAgentSessionServices, enableLegacyAzure, LEGACY_AZURE_PROVIDER } from "./model-runtime";
import { nativeProjectTrusted, publishMcpLoad } from "./native-mcp-runtime";
import { join } from "node:path";
import { clearPivotTypedModels, reloadSessionTypedModels } from "./typed-model-runtime";
import { assertSdkChatConfiguration, withModelConfigLock } from "./model-config-store";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export class AgentBusyError extends Error {
  constructor() {
    super("Agent is already running");
    this.name = "AgentBusyError";
  }
}

type EventListener = (event: AgentEvent) => void;
type InputReceipt = import("./pi-types").InputReceipt;

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};


type QueueStorageLike = {
  messages: unknown[];
};

type AgentSessionQueueInternals = AgentSessionLike & {
  _steeringMessages: string[];
  _followUpMessages: string[];
  _emitQueueUpdate: () => void;
  agent: AgentSessionLike["agent"] & {
    steeringQueue: QueueStorageLike;
    followUpQueue: QueueStorageLike;
  };
};

function queueMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (
      block && typeof block === "object"
        && (block as { type?: unknown }).type === "text"
        && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : ""
    ))
    .filter(Boolean)
    .join("\n");
}

function findTrackedQueueMessageIndex(messages: unknown[], tracked: readonly string[], targetIndex: number): number {
  const targetText = tracked[targetIndex];
  if (targetText === undefined) return -1;
  let trackedIndex = 0;
  for (let messageIndex = 0; messageIndex < messages.length && trackedIndex < tracked.length; messageIndex += 1) {
    if (queueMessageText(messages[messageIndex]) !== tracked[trackedIndex]) continue;
    if (trackedIndex === targetIndex) return messageIndex;
    trackedIndex += 1;
  }
  return -1;
}

const MODEL_START_TIMEOUT_MS = 300_000;
const MODEL_ABORT_GRACE_MS = 10_000;

// Pivot UI provides a browser-backed implementation of the extension UI
// protocol (including dialogs and custom components). Expose it as the
// interactive mode so extensions that gate commands on ctx.mode === "tui"
// can use the UI instead of incorrectly treating the browser as headless.
const EXTENSION_MODE = "tui" as const;

// Each wrapper owns a complete, stable bridge independent of browser theme.
const CUSTOM_UI_KEYBINDINGS = new TuiKeybindingsManager(TUI_KEYBINDINGS);
const EXTENSION_STATUSLINE_RENDER_WIDTH = 120;

type ExtensionWidgetComponent = {
  render: (width: number) => unknown;
};

function renderStatuslineWidget(content: unknown, theme: Theme): string[] | null {
  if (typeof content !== "function") return null;

  try {
    const component = (content as (tui: unknown, theme: Theme) => unknown)({}, theme);
    if (!component || typeof component !== "object" || typeof (component as ExtensionWidgetComponent).render !== "function") {
      return null;
    }
    const lines = (component as ExtensionWidgetComponent).render(EXTENSION_STATUSLINE_RENDER_WIDTH);
    if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) return null;
    return lines as string[];
  } catch (error) {
    console.error("[pivot-ui] failed to render extension statusline:", error instanceof Error ? error.message : error);
    return null;
  }
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private pendingUiRequests = new Map<string, AgentEvent>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private hasExtensionTitle = false;
  private extensionTitle = "";
  private promptRunning = false;
  private pendingInputRejections = new Set<(error: Error) => void>();
  private settledInputCompletions = new Set<() => void>();
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private modelStartTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private _alive = true;
  private shutdownPromise: Promise<void> | null = null;

  private workspacePackRevision: number;
  private workspacePackReload: Promise<void> | null = null;
  private resourceReloadPromise: Promise<void> | null = null;
  private unsubscribeWorkspacePacks: (() => void) | null = null;
  private unsubscribeWorkspaceTools: (() => void) | null = null;
  private unsubscribeResourceChanges: (() => void) | null = null;
  private workspaceResourceRevision: string;
  private resourceReloadFailed = false;

  private readonly plainTextTheme = new PlainTextTheme();

  constructor(public readonly inner: AgentSessionLike, initialPackRevision = 0) {
    this.workspacePackRevision = initialPackRevision;
    this.workspaceResourceRevision = resourceRevision(inner.sessionManager.getCwd());
  }

  private workspaceCwd(): string | undefined { return this.inner.sessionManager?.getCwd?.(); }

  private refreshWorkspacePacksInBackground(): void {
    if (!this._alive || this.isRunning()) return;
    // Keep persisted changes pending on failure; background notifications must not throw.
    void this.refreshWorkspaceTools().catch((error) => {
      this.emit({ type: "workspace_packs_reload_error", errorMessage: String(error) });
    });
  }

  getExtensionApplicationState() {
    const cwd = this.workspaceCwd();
    const pending = cwd !== undefined && resourceRevision(cwd) !== this.workspaceResourceRevision;
    const state = this.resourceReloadFailed || this.extensionBindingError ? "failed" as const
      : this.resourceReloadPromise || !this.extensionsBound ? "applying" as const
      : pending ? "pending" as const : "applied" as const;
    return { sessionId: this.sessionId, running: this.isRunning(), state };
  }

  getToolApplicationState(desired: OrchestrationSnapshot): ToolApplicationState {
    const cwd = this.workspaceCwd();
    const current = codemodeValues(this.inner.settingsManager.getSettings());
    const rules = cwd ? readWorkspaceTools(cwd, this.inner.settingsManager.isProjectTrusted()).revision : undefined;
    const pending = appliedToolRulesRevision(this.inner) !== rules ||
      current.mode !== desired.mode || current.inlineBudget !== desired.inlineBudget ||
      this.inner.settingsManager.isProjectTrusted() !== desired.trusted ||
      (cwd !== undefined && resourceRevision(cwd) !== this.workspaceResourceRevision);
    const state = this.resourceReloadFailed || this.extensionBindingError || toolRulesFailed(this.inner) ? "failed"
      : this.resourceReloadPromise || !this.extensionsBound ? "applying" : pending ? "pending" : "applied";
    return { sessionId: this.sessionId, running: this.isRunning(), codemode: current, state };
  }

  async refreshWorkspaceTools(): Promise<void> {
    if (!this._alive || this.isRunning()) return;
    try {
      if (this.resourceReloadPromise) await this.resourceReloadPromise;
      await this.ensureWorkspacePacksReloaded();
      if (!this._alive || this.isRunning()) return;
      const cwd = this.workspaceCwd();
      if (cwd) {
        const desired = readOrchestration(cwd);
        const current = codemodeValues(this.inner.settingsManager.getSettings());
        if (this.resourceReloadFailed || this.extensionBindingError || desired.mode !== current.mode ||
            desired.inlineBudget !== current.inlineBudget || desired.trusted !== this.inner.settingsManager.isProjectTrusted()) {
          await this.reloadResources();
        }
      }
      if (!this._alive || this.isRunning()) return;
      activateAllSessionTools(this.inner);
      this.resourceReloadFailed = false;
    } catch (error) { this.resourceReloadFailed = true; throw error; }
  }

  async ensureWorkspacePacksReloaded(): Promise<void> {
    if (this.workspacePackReload) return this.workspacePackReload;
    const cwd = this.workspaceCwd();
    if (!cwd || !this._alive || this.isRunning()) return;
    if (readWorkspaceState({ cwd }).revision === this.workspacePackRevision && resourceRevision(cwd) === this.workspaceResourceRevision) return;
    const task = (async () => {
      while (this._alive && !this.isRunning()) {
        const revision = readWorkspaceState({ cwd }).revision;
        if (revision === this.workspacePackRevision && resourceRevision(cwd) === this.workspaceResourceRevision) return;
        await this.reloadResources();
        this.emit({ type: "workspace_packs_reloaded", revision: this.workspacePackRevision });
      }
    })();
    this.workspacePackReload = task;
    try { await task; } finally { this.workspacePackReload = null; }
  }

  private async reloadResources(): Promise<void> {
    if (this.resourceReloadPromise) return this.resourceReloadPromise;
    const task = (async () => {
      if (this.isRunning()) throw new AgentBusyError();
      // A failed binding must be recoverable through reload, not block every retry forever.
      await this.extensionBindingPromise?.catch(() => undefined);
      if (this.isRunning()) throw new AgentBusyError();
      const cwd = this.workspaceCwd();
      const revision = cwd ? readWorkspaceState({ cwd }).revision : this.workspacePackRevision;
      const resources = cwd ? resourceRevision(cwd) : this.workspaceResourceRevision;
      this.extensionStatuses.clear();
      this.extensionWidgets.clear();
      this.extensionsBound = false;
      this.extensionBindingPromise = null;
      // SDK reload preserves its initial trust flag; refresh saved trust only at this idle boundary.
      const settings = this.inner.settingsManager;
      if (cwd && typeof settings.setProjectTrusted === "function" && typeof settings.getDefaultProjectTrust === "function") {
        settings.setProjectTrusted(nativeProjectTrusted(cwd, getAgentDir(), settings));
      }
      const modelsPath = join(getAgentDir(), "models.json");
      await withModelConfigLock(modelsPath, async () => {
        await assertSdkChatConfiguration(modelsPath);
        clearPivotTypedModels(this.inner.modelRuntime);
        await this.inner.modelRuntime.refresh({ allowNetwork: false });
      });
      await this.inner.reload({ beforeSessionStart: () => reloadSessionTypedModels(this.inner.modelRuntime, modelsPath) });
      publishMcpLoad(cwd ?? this.inner.sessionManager.getCwd(), getAgentDir(), this.inner.resourceLoader.getExtensions(), true);
      if (settings.drainErrors().length) throw new Error("Unable to apply workspace settings");
      this.beginExtensionBinding();
      await this.waitForExtensionsBound();
      activateAllSessionTools(this.inner);
      this.workspacePackRevision = revision;
      this.workspaceResourceRevision = resources;
    })();
    this.resourceReloadPromise = task;
    try { await task; this.resourceReloadFailed = false; }
    catch (error) { this.resourceReloadFailed = true; throw error; }
    finally { this.resourceReloadPromise = null; }
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return this._alive && (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting);
  }

  start(): void {
    const cwd = this.workspaceCwd();
    if (cwd) this.unsubscribeResourceChanges = subscribeResourceChanges(cwd, () => this.refreshWorkspacePacksInBackground());
    if (cwd) this.unsubscribeWorkspaceTools = subscribeWorkspaceTools(cwd, () => {
      this.refreshWorkspacePacksInBackground();
    });
    if (cwd) this.unsubscribeWorkspacePacks = subscribeWorkspacePacks(cwd, () => {
      this.emit({ type: "workspace_packs_changed" });
      this.refreshWorkspacePacksInBackground();
    });
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      if (this.isModelProgress(event)) this.clearModelStartTimer();
      if (event.type === "agent_end" || event.type === "session_info_changed" ||
          (event.type === "message_end" && (event.message as { role?: string } | undefined)?.role === "user")) {
        invalidateSessionListCache();
      }
      this.emit(event);
      if (event.type === "agent_settled") for (const complete of this.settledInputCompletions) complete();
      // Streaming / compaction / tool events flow through here; re-broadcast
      // the running-status snapshot so the sidebar can update live.
      notifyRunningChange();
    });
    this.resetIdleTimer();
    notifyRunningChange();
  }

  beginExtensionBinding(): void {
    void this.ensureExtensionsBound().catch((err) => {
      console.error("[pivot-ui] failed to dispatch session_start to extensions:", err instanceof Error ? err.message : err);
    });
  }

  private ensureExtensionsBound(): Promise<void> {
    if (this.extensionsBound) {
      if (!this.isRunning()) activateAllSessionTools(this.inner);
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        const bindExtensions = this.inner.bindExtensions as (bindings: {
          uiContext?: ExtensionUiContextLike;
          mode?: "tui" | "rpc";
          commandContextActions?: ExtensionCommandContextActionsLike;
          shutdownHandler?: () => void;
          onError?: (error: { extensionPath: string; event: string; error: string }) => void;
        }) => Promise<void>;
        await bindExtensions.call(this.inner, {
          uiContext,
          mode: EXTENSION_MODE,
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () => this.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "notify",
            notifyType: "warning",
            message: "Extension requested shutdown, but shutdown is not supported in pivot-ui.",
          } as ExtensionUiRequest as AgentEvent),
          onError: (error) => this.emit({
            type: "extension_error",
            extensionPath: error.extensionPath,
            event: error.event,
            error: error.error,
          }),
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, EXTENSION_MODE);
      }
      this.extensionsBound = true;
      activateAllSessionTools(this.inner);
      console.log(`[pivot-ui] session_start dispatched to extensions for session ${this.inner.sessionId}`);
    })().catch((err) => {
      this.extensionBindingError = err;
      throw err;
    });

    return this.extensionBindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    try {
      if (this.extensionBindingPromise) await this.extensionBindingPromise;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (this.extensionBindingError) {
      throw this.extensionBindingError instanceof Error
        ? this.extensionBindingError
        : new Error(String(this.extensionBindingError));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt" || type === "steer" || type === "follow_up" || type === "get_commands";
  }

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      notifyRunningChange();
      this.refreshWorkspacePacksInBackground();
    }
  }

  private toggleQueuedMessageMode(
    mode: "steer" | "followUp",
    index: number,
    expectedText: string,
  ): { steering: string[]; followUp: string[] } {
    // AgentSession exposes queue contents but not a single-item move API. Its
    // underlying Agent queues are ordinary (non-#) fields in the pi 0.84
    // runtime, so mutate both layers synchronously. Doing this without an
    // await prevents the agent loop from draining between removal and insert.
    const inner = this.inner as unknown as AgentSessionQueueInternals;
    if (
      !Array.isArray(inner._steeringMessages)
      || !Array.isArray(inner._followUpMessages)
      || typeof inner._emitQueueUpdate !== "function"
      || !inner.agent
    ) {
      throw new Error("Queued message switching is unavailable with this pi version");
    }

    const sourceTracked = mode === "steer" ? inner._steeringMessages : inner._followUpMessages;
    const destinationTracked = mode === "steer" ? inner._followUpMessages : inner._steeringMessages;
    const sourceQueue = mode === "steer" ? inner.agent.steeringQueue : inner.agent.followUpQueue;
    const destinationQueue = mode === "steer" ? inner.agent.followUpQueue : inner.agent.steeringQueue;

    if (!Number.isInteger(index) || index < 0 || sourceTracked[index] !== expectedText) {
      throw new Error("Queued message is stale; refresh and try again");
    }
    if (!Array.isArray(sourceQueue?.messages) || !Array.isArray(destinationQueue?.messages)) {
      throw new Error("Queued message switching is unavailable with this pi version");
    }

    const coreIndex = findTrackedQueueMessageIndex(sourceQueue.messages, sourceTracked, index);
    if (coreIndex < 0) throw new Error("Queued message is no longer pending");
    const [queuedMessage] = sourceQueue.messages.splice(coreIndex, 1);
    if (!queuedMessage) throw new Error("Queued message is no longer pending");

    destinationQueue.messages.push(queuedMessage);
    sourceTracked.splice(index, 1);
    destinationTracked.push(expectedText);
    inner._emitQueueUpdate();
    return {
      steering: [...inner._steeringMessages],
      followUp: [...inner._followUpMessages],
    };
  }

  private emit(event: AgentEvent): void {
    if (event.type === "prompt_error") {
      markRpcSessionError(this.sessionId);
    } else if (event.type === "agent_end" && event.willRetry !== true) {
      const messages = event.messages as Array<{ role?: string; stopReason?: string }> | undefined;
      if (messages?.some((message) => message.role === "assistant" && message.stopReason === "error")) {
        markRpcSessionError(this.sessionId);
      }
    }
    for (const l of this.listeners) l(event);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.destroy(), 10 * 60 * 1000);
  }

  private isModelProgress(event: AgentEvent): boolean {
    if (event.type === "tool_execution_start" || event.type === "agent_end") return true;
    if (event.type !== "message_start" && event.type !== "message_update") return false;
    const message = event.message as { role?: string } | undefined;
    return message?.role === "assistant";
  }

  private clearModelStartTimer(): void {
    if (!this.modelStartTimer) return;
    clearTimeout(this.modelStartTimer);
    this.modelStartTimer = null;
  }

  private startModelStartTimer(): void {
    this.clearModelStartTimer();
    this.modelStartTimer = setTimeout(() => {
      this.modelStartTimer = null;
      if (!this.isRunning()) return;
      this.emit({ type: "prompt_error", errorMessage: "Model did not start responding in time; stopping this run." });
      void this.inner.abort().catch(() => {});
      setTimeout(() => {
        if (this.isRunning()) this.destroy();
      }, MODEL_ABORT_GRACE_MS);
    }, MODEL_START_TIMEOUT_MS);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    for (const event of this.pendingUiRequests.values()) listener(event);
    // Extension startup can finish before the SSE route has attached its
    // listener. Replay the latest fire-and-forget UI state so a newly selected
    // session can restore statuses, widgets, and browser titles in that race.
    for (const [statusKey, statusText] of this.extensionStatuses) {
      listener({
        type: "extension_ui_request",
        id: randomUUID(),
        method: "setStatus",
        statusKey,
        statusText,
      } as ExtensionUiRequest as AgentEvent);
    }
    for (const widget of this.extensionWidgets.values()) {
      listener({
        type: "extension_ui_request",
        id: randomUUID(),
        method: "setWidget",
        widgetKey: widget.key,
        widgetLines: widget.lines,
        widgetPlacement: widget.placement,
      } as ExtensionUiRequest as AgentEvent);
    }
    if (this.hasExtensionTitle) {
      listener({
        type: "extension_ui_request",
        id: randomUUID(),
        method: "setTitle",
        title: this.extensionTitle,
      } as ExtensionUiRequest as AgentEvent);
    }
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;
    if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();
    if (!this.isRunning() && (this.shouldWaitForExtensions(type) || type === "get_tools" || type === "reload_workspace_packs")) {
      await this.refreshWorkspaceTools();
    }
    // Refresh dynamic registrations without changing an in-flight run's loadout.
    if (!this.isRunning() && (this.shouldWaitForExtensions(type) || type === "get_tools")) {
      activateAllSessionTools(this.inner);
    }

    switch (type) {
      case "prompt": {
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior === "steer" || command.streamingBehavior === "followUp"
          ? command.streamingBehavior : undefined;
        if (command.streamingBehavior != null && !streamingBehavior) throw new Error("Invalid streaming behavior");
        const ownsPrompt = !this.isRunning();
        // Allow explicit streaming dispatch, not arbitrary concurrent prompts
        // or a second prompt while the first is still in its input hooks.
        if (!ownsPrompt && (!streamingBehavior || !this.inner.isStreaming)) throw new AgentBusyError();
        if (ownsPrompt && this.inner.sessionManager) persistEmptySession(this.inner.sessionManager);
        const requestId = typeof command.requestId === "string" ? command.requestId : undefined;
        if (ownsPrompt) {
          this.promptRunning = true;
          clearRpcSessionError(this.sessionId);
          notifyRunningChange();
        }
        return new Promise<InputReceipt>((resolve, reject) => {
          let disposition: InputReceipt["disposition"] | undefined;
          let replied = false;
          let returned = false;
          const fail = (error: Error) => {
            if (replied) return;
            replied = true;
            this.pendingInputRejections.delete(fail);
            reject(error);
          };
          const reply = () => {
            if (replied || !disposition || !this._alive) return;
            replied = true;
            this.pendingInputRejections.delete(fail);
            resolve({ disposition });
          };
          this.pendingInputRejections.add(fail);
          const complete = () => {
            this.settledInputCompletions.delete(onSettled);
            if (!ownsPrompt) return;
            this.promptRunning = false;
            this.clearModelStartTimer();
            this.refreshWorkspacePacksInBackground();
            notifyRunningChange();
          };
          const onSettled = () => {
            // SDK can defer prompt() from an async agent_settled extension.
            // Its original promise resolves before the deferred dispatch.
            if (!returned || disposition !== "started") return;
            complete();
            if (ownsPrompt && this._alive) this.emit({ type: "prompt_done", requestId });
          };
          this.settledInputCompletions.add(onSettled);
          // Only the preflight acknowledgement is awaited by HTTP. The SDK
          // promise remains observed until its run/command actually completes.
          void Promise.resolve().then(() => this.inner.prompt(command.message as string, {
            ...(promptImages?.length ? { images: promptImages } : {}),
            ...(streamingBehavior ? { streamingBehavior } : {}),
            source: "rpc",
            preflightResult: (value) => {
              if (!this._alive) return;
              disposition = value;
              if (value === "started") {
                if (ownsPrompt) this.startModelStartTimer();
                reply();
              } else if (returned) {
                complete();
                reply();
                if (ownsPrompt) this.emit({ type: "prompt_done", requestId });
              }
            },
          })).then(() => {
            returned = true;
            if (!disposition) return; // Deferred: the callback will acknowledge.
            complete();
            reply();
            if (ownsPrompt && this._alive) this.emit({ type: "prompt_done", requestId });
          }).catch((error: unknown) => {
            complete();
            const failure = error instanceof Error ? error : new Error(String(error));
            if (!replied) {
              fail(failure); // Rejection before acceptance belongs to HTTP.
            } else if (this._alive) {
              invalidateSessionListCache();
              this.emit({ type: "prompt_error", requestId, errorMessage: failure.message });
              if (ownsPrompt) this.emit({ type: "prompt_done", requestId });
            }
          });
        });
      }

      case "abort":
        await this.withFinalRunningNotification(() => this.inner.abort());
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        const routed = this.inner.routedModel;
        const history = branchModelSelection(this.inner.sessionManager.getBranch() as never);
        const routedModel = routed ? {
          provider: routed.model.provider, modelId: routed.model.id, api: routed.model.api,
          thinkingLevel: routed.thinkingLevel,
          contextWindow: knownModelLimit(routed.model.contextWindow), maxTokens: knownModelLimit(routed.model.maxTokens),
        } : history.routedModel;
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunning,
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          selectedModel: model ? { provider: model.provider, modelId: model.id,
            virtual: model.api === VIRTUAL_CHAT_API, contextWindow: knownModelLimit(model.contextWindow),
            maxTokens: knownModelLimit(model.maxTokens) } : null,
          routedModel,
          messageCount: 0,
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.systemPrompt ?? this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const registry = this.inner.modelRuntime;
        if (provider === LEGACY_AZURE_PROVIDER) await enableLegacyAzure(registry, true);
        const model = registry.getModel(provider, modelId);
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model, { persist: command.persist === true });
        if (command.persist === true) {
          await this.inner.settingsManager.flush();
          const errors = this.inner.settingsManager.drainErrors();
          if (errors.length) throw errors[0];
        }
        invalidateModelsCache();
        invalidateSessionListCache();
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry || entry.type !== "message" || entry.message.role !== "user") {
          throw new Error("Fork requires a user message entry");
        }

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          persistEmptySession(newManager);
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          // pi defers branches containing only setup entries until a user
          // message; Pivot exposes these empty forks immediately as before.
          persistEmptySession(sourceManager);
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        invalidateSessionListCache();
        // Only the separately opened sourceManager is branched. Keep this
        // wrapper alive so an in-flight source run continues unaffected.
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        if (this.isRunning()) throw new AgentBusyError();
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return {
          cancelled: result.cancelled,
          editorText: result.editorText,
          leafId: this.inner.sessionManager.getLeafId(),
        };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level, { persist: command.persist === true });
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        if (command.persist === true) {
          await this.inner.settingsManager.flush();
          const errors = this.inner.settingsManager.drainErrors();
          if (errors.length) throw errors[0];
        }
        invalidateModelsCache();
        invalidateSessionListCache();
        return null;
      }

      case "compact": {
        try {
          return await this.withFinalRunningNotification(() =>
            this.inner.compact(command.customInstructions as string | undefined)
          );
        } finally {
          invalidateSessionListCache();
        }
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        invalidateSessionListCache();
        return null;
      }

      case "get_session_stats": {
        return sessionStatistics(this.inner.sessionManager, this.inner);
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "toggle_queue_message": {
        const mode = command.mode;
        const index = command.index;
        const message = command.message;
        if (mode !== "steer" && mode !== "followUp") throw new Error("Invalid queued message mode");
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
          throw new Error("Invalid queued message index");
        }
        if (typeof message !== "string") throw new Error("Invalid queued message text");
        return this.toggleQueuedMessageMode(mode, index, message);
      }

      case "clear_queue": {
        // Full clear only: pi has no single-item dequeue, and clear+requeue
        // races against the agent loop pulling messages mid-flight.
        return this.inner.clearQueue();
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const disposition = await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined, { source: "rpc" });
        return { disposition } satisfies InputReceipt;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const disposition = await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined, { source: "rpc" });
        return { disposition } satisfies InputReceipt;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          sourceInfo: { source: t.sourceInfo.source },
          active: active.has(t.name),
        }));
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          const key = skill.baseDir.split(/[\\/]/).pop() ?? "";
          const displayName = skill.name || key;
          commands.push({
            name: `skill:${displayName}`,
            description: skill.description || key,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }
        return { commands };
      }

      case "set_tools": {
        // Legacy clients may still submit a preset. Ignore it; do not persist
        // replacement metadata or change a loadout in the middle of a run.
        if (!this.isRunning()) activateAllSessionTools(this.inner);
        return null;
      }

      case "reload_workspace_packs":
        return { success: true, workspaceRevision: this.workspacePackRevision };

      case "reload": {
        if (this.isRunning()) throw new AgentBusyError();
        await this.reloadResources();
        return { success: true };
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "extension_ui_response": {
        this.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      }

      case "extension_ui_input": {
        this.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    for (const reject of this.pendingInputRejections) reject(new Error("Session closed before input was accepted"));
    this.pendingInputRejections.clear();
    this.settledInputCompletions.clear();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.clearModelStartTimer();
    this.unsubscribe?.();
    this.unsubscribeWorkspacePacks?.();
    this.unsubscribeWorkspaceTools?.();
    this.unsubscribeResourceChanges?.();
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    const dispose = () => { try { this.inner.dispose(); } catch { /* cleanup must not strand the wrapper */ } };
    if (this.inner.extensionRunner?.emit) {
      // dispose() alone does not emit session_shutdown; native MCP owns processes.
      this.shutdownPromise = (this.extensionBindingPromise ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => this.inner.extensionRunner.emit?.({ type: "session_shutdown", reason: "quit" }))
        .catch(() => undefined).then(dispose);
    } else dispose();
    this.onDestroyCallback?.();
    notifyRunningChange();
  }

  async destroyAndWait(): Promise<void> {
    this.destroy();
    await this.shutdownPromise;
  }

  private resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  private getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  private getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private getCustomUiWidth(options: unknown): number {
    if (!options || typeof options !== "object") return 92;
    const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
    const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
    if (!resolved || typeof resolved !== "object") return 92;
    const width = (resolved as { width?: unknown }).width;
    return typeof width === "number" && Number.isFinite(width)
      ? Math.max(40, Math.min(140, Math.round(width)))
      : 92;
  }

  private emitCustomUiRender(id: string, custom: ActiveCustomUi): void {
    let lines: string[];
    try {
      lines = custom.component.render(custom.width);
    } catch (error) {
      lines = [`Extension custom UI render failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    const event = {
      type: "extension_ui_request",
      id,
      method: "custom",
      lines,
    } as ExtensionUiRequest as AgentEvent;
    this.pendingUiRequests.set(id, event);
    this.emit(event);
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    try {
      custom.component.dispose?.();
    } catch {
      // Ignore dispose errors from extension UI components.
    }
    this.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    } as ExtensionUiRequest as AgentEvent);
    custom.resolve(value);
  }

  private handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emit({
        type: "extension_error",
        extensionPath: `custom-ui:${id}`,
        event: "custom_ui_input",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requestExtensionCustomUi<T>(
    factory: unknown,
    options?: unknown,
  ): Promise<T> {
    if (typeof factory !== "function") return Promise.resolve(undefined as T);

    const id = randomUUID();
    const width = this.getCustomUiWidth(options);

    return new Promise<T>((resolve) => {
      let completed = false;
      const tui = {
        requestRender: () => {
          const custom = this.activeCustomUis.get(id);
          if (custom) this.emitCustomUiRender(id, custom);
        },
      };
      const finish = (value: T) => {
        if (completed) return;
        completed = true;
        resolve(value);
      };
      const done = (value: T) => {
        if (this.activeCustomUis.has(id)) {
          this.closeCustomUi(id, value);
        } else {
          finish(value);
        }
      };

      Promise.resolve()
        .then(() => factory(tui, this.plainTextTheme, CUSTOM_UI_KEYBINDINGS, done))
        .then((component) => {
          if (completed) {
            try {
              (component as CustomUiComponent | undefined)?.dispose?.();
            } catch {
              // Ignore dispose errors from a component completed before mounting.
            }
            return;
          }
          if (!component || typeof component !== "object" || typeof (component as CustomUiComponent).render !== "function") {
            finish(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            component: component as CustomUiComponent,
            width,
            resolve: (value) => finish(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(id, custom);
        })
        .catch((error) => {
          if (completed) return;
          this.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          finish(undefined as T);
        });
    });
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.pendingUiRequests.delete(id);
        this.pendingUiResponses.delete(id);
      };
      const settle = (value: T) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike {
    return {
      select: (title, options, opts) => this.requestExtensionUi(
        { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      confirm: (title, message, opts) => this.requestExtensionUi(
        { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        false,
        (response) => "confirmed" in response ? response.confirmed : false,
        opts?.timeout,
        opts?.signal,
      ),
      input: (title, placeholder, opts) => this.requestExtensionUi(
        { method: "input", title, ...(placeholder !== undefined ? { placeholder } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      editor: (title, prefill, opts) => this.requestExtensionUi(
        { method: "editor", title, ...(prefill !== undefined ? { prefill } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as AgentEvent);
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, text);
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: key,
          statusText: text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => {
        let lines: string[] | undefined;
        if (content === undefined) {
          this.extensionWidgets.delete(key);
        } else if (Array.isArray(content)) {
          lines = content;
          this.extensionWidgets.set(key, {
            key,
            lines,
            placement: options?.placement ?? "aboveEditor",
          });
        } else if (key === EXTENSION_STATUSLINE_WIDGET_KEY) {
          // The shared pi-plugins statusline is a TUI component factory. It
          // cannot cross SSE as a function, so render its text once using the
          // same plain theme used by the rest of the RPC UI bridge.
          const rendered = renderStatuslineWidget(content, this.plainTextTheme);
          if (!rendered) {
            this.extensionWidgets.delete(key);
            this.emit({
              type: "extension_ui_request",
              id: randomUUID(),
              method: "setWidget",
              widgetKey: key,
            } as ExtensionUiRequest as AgentEvent);
            return;
          }
          lines = rendered;
          this.extensionWidgets.set(key, {
            key,
            lines,
            placement: options?.placement ?? "aboveEditor",
          });
        } else {
          // Arbitrary TUI factories are not serializable in the browser
          // protocol. String-array widgets remain supported as before.
          return;
        }
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          ...(lines ? { widgetLines: lines } : {}),
          ...(options?.placement ? { widgetPlacement: options.placement } : {}),
        } as ExtensionUiRequest as AgentEvent);
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.hasExtensionTitle = true;
        this.extensionTitle = title;
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as AgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setEditorText: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      theme: this.plainTextTheme,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is not supported in pivot-ui extension UI yet" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), EXTENSION_MODE);
          },
        });
        activateAllSessionTools(this.inner);
      },
    };
  }
}

// ============================================================================
// Session registry
// ============================================================================

type RpcSessionStatusListener = (runningSessionIds: string[], errorSessionIds: string[]) => void;

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
  var __piErrorSessionIds: Set<string> | undefined;
  var __piRunningListeners: Set<RpcSessionStatusListener> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

/** Read existing registries only; opening Tools must not create a session or connect MCP. */
export function getToolManagementSession(cwd: string, preferredId?: string): AgentSessionWrapper | undefined {
  const matches = (session: AgentSessionWrapper) => session.isAlive() && workspaceKey(session.inner.sessionManager.getCwd()) === workspaceKey(cwd);
  const preferred = preferredId ? globalThis.__piSessions?.get(preferredId) : undefined;
  // Runtime facts must belong to the explicitly selected session, never a same-cwd sibling.
  return preferred && matches(preferred) ? preferred : undefined;
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}

function getErrorSessionIdStore(): Set<string> {
  if (!globalThis.__piErrorSessionIds) globalThis.__piErrorSessionIds = new Set();
  return globalThis.__piErrorSessionIds;
}

export function getErrorRpcSessionIds(): string[] {
  return [...getErrorSessionIdStore()];
}

export function markRpcSessionError(sessionId: string): void {
  if (!sessionId || getErrorSessionIdStore().has(sessionId)) return;
  getErrorSessionIdStore().add(sessionId);
  notifyRunningChange();
}

export function clearRpcSessionError(sessionId: string): void {
  if (!getErrorSessionIdStore().delete(sessionId)) return;
  notifyRunningChange();
}

// ----------------------------------------------------------------------------
// Running-status broadcaster
//
// Pushes the current set of running session ids to subscribers whenever any
// session's running state may have changed. This lets the sidebar receive live
// updates over SSE instead of polling. Listeners live on globalThis so they
// survive Next.js hot-reload.
// ----------------------------------------------------------------------------

function getRunningListeners(): Set<RpcSessionStatusListener> {
  if (!globalThis.__piRunningListeners) globalThis.__piRunningListeners = new Set();
  return globalThis.__piRunningListeners;
}

/** Subscribe to running/error session changes. Returns an unsubscribe function. */
export function subscribeRunningSessions(listener: RpcSessionStatusListener): () => void {
  const listeners = getRunningListeners();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let lastSessionStatusSnapshot = "";

/**
 * Recompute running/error session ids and, if either set changed since the
 * last notification, broadcast them to subscribers. Cheap to call often.
 */
export function notifyRunningChange(): void {
  const runningSessionIds = getRunningRpcSessionIds();
  const errorSessionIds = getErrorRpcSessionIds();
  const snapshot = JSON.stringify({
    runningSessionIds: [...runningSessionIds].sort(),
    errorSessionIds: [...errorSessionIds].sort(),
  });
  if (snapshot === lastSessionStatusSnapshot) return;
  lastSessionStatusSnapshot = snapshot;
  for (const listener of getRunningListeners()) {
    try { listener(runningSessionIds, errorSessionIds); } catch { /* ignore listener errors */ }
  }
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Legacy toolNames/preset arguments are accepted but ignored until presets are redesigned.
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
  toolPreset?: ToolPreset,
  requestedModel?: { provider: string; modelId: string },
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) {
    if (!existing.isRunning()) {
      // globalThis can retain pre-change wrappers across development hot reload.
      const legacy = existing as AgentSessionWrapper & { setForceEmptySystemPrompt?: (force: boolean) => void };
      legacy.setForceEmptySystemPrompt?.(false);
      activateAllSessionTools(existing.inner);
    }
    return { session: existing, realSessionId: sessionId };
  }

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    // Initialize the legacy SDK singleton once, never from browser appearance.
    const themeState = globalThis as typeof globalThis & { __pivotSdkThemeInitialized?: boolean };
    if (!themeState.__pivotSdkThemeInitialized) {
      initTheme(undefined, false);
      themeState.__pivotSdkThemeInitialized = true;
    }
    const agentDir = getAgentDir();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);

    // Keep the full registry and ignore historical Pivot preset metadata.
    // Build services first so extension-registered providers are available
    // before the SDK restores the saved model from the session file.
    const savedModel = sessionManager.buildSessionContext().model;
    const legacyAzure = savedModel?.provider === LEGACY_AZURE_PROVIDER;
    const initialPackRevision = readWorkspaceState({ cwd }).revision;
    const services = await createPivotAgentSessionServices({ cwd, agentDir }, legacyAzure || requestedModel?.provider === LEGACY_AZURE_PROVIDER);
    const desired = requestedModel ?? (legacyAzure ? savedModel : undefined);
    const startupModel = desired ? services.modelRuntime.getModel(desired.provider, desired.modelId) : undefined;
    if (desired && (!startupModel || !services.modelRuntime.getAvailableSnapshot().some(
      (model) => model.provider === desired.provider && model.id === desired.modelId,
    ))) {
      if (requestedModel) throw new Error(`Model unavailable: ${desired.provider}/${desired.modelId}`);
      throw new Error("Saved Azure model could not be restored. Configure its credentials/model before continuing.");
    }
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      model: startupModel,
    });
    // Never silently continue an old Azure conversation on a fallback provider/model.
    if (legacyAzure && !requestedModel && (inner.model?.provider !== savedModel.provider || inner.model?.id !== savedModel.modelId)) {
      inner.dispose();
      throw new Error("Saved Azure model could not be restored. Configure its credentials/model before continuing.");
    }

    activateAllSessionTools(inner);

    // Keep existing empty-session visibility through the public manager API,
    // without relying on pi's private _rewriteFile()/flushed implementation.
    if (!sessionFile) persistEmptySession(sessionManager);

    const wrapper = new AgentSessionWrapper(inner, initialPackRevision);
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    wrapper.onDestroy(() => registry.delete(realSessionId));
    registry.set(realSessionId, wrapper);
    wrapper.beginExtensionBinding();

    return { session: wrapper, realSessionId };
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
