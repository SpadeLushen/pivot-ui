import type {
  AgentSessionEvent,
  AgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  SlashCommandInfo,
  Theme,
} from "@earendil-works/pi-coding-agent";

export type SlashArgumentCompletion = import("@earendil-works/pi-tui").AutocompleteItem;

/** Accepted input, not a run-completion acknowledgement. */
export type InputDisposition = "started" | "queued" | "handled";
export interface InputReceipt {
  disposition: InputDisposition;
  thinkingPreferenceError?: string;
}

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface ModelLike {
  id: string;
  provider: string;
  api?: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ToolInfo {
  name: string;
  description: string;
  sourceInfo: { source: string; path?: string };
  parameters?: unknown;
  namespace?: ReturnType<AgentSession["getAllTools"]>[number]["namespace"];
  reachesTools?: ReturnType<AgentSession["getAllTools"]>[number]["reachesTools"];
  exposure?: "direct" | "model-only" | "codemode" | "deferred" | "hidden";
}

export interface NavigateTreeResult {
  editorText?: string;
  cancelled: boolean;
  aborted?: boolean;
}

export interface SessionStatsInfo {
  accounting?: import("./session-usage").SessionAccounting;
  statsUnavailable?: boolean;
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: ContextUsage;
}

interface PromptTemplateLike {
  name: string;
  description?: string;
  sourceInfo: SlashCommandInfo["sourceInfo"];
}

interface SkillLike {
  name: string;
  description?: string;
  baseDir: string;
  sourceInfo: SlashCommandInfo["sourceInfo"];
}

interface ResourceLoaderLike {
  getExtensions(): ReturnType<AgentSession["resourceLoader"]["getExtensions"]>;
  getSkills(): { skills: SkillLike[]; diagnostics?: ReturnType<AgentSession["resourceLoader"]["getSkills"]>["diagnostics"] };
  getPrompts?(): ReturnType<AgentSession["resourceLoader"]["getPrompts"]>;
  getThemes?(): ReturnType<AgentSession["resourceLoader"]["getThemes"]>;
}

interface ExtensionRunnerLike {
  emit?(event: { type: "session_shutdown"; reason: "quit" }): Promise<unknown>;
  getRegisteredCommands(): Array<{
    invocationName: string;
    getArgumentCompletions?: (prefix: string) => SlashArgumentCompletion[] | null | Promise<SlashArgumentCompletion[] | null>;
    description?: string;
    sourceInfo: SlashCommandInfo["sourceInfo"];
  }>;
  setUIContext?(uiContext?: unknown, mode?: "tui" | "rpc" | "json" | "print"): void;
}

type DialogOptionsLike = {
  signal?: AbortSignal;
  timeout?: number;
};

type WidgetOptionsLike = {
  placement?: "aboveEditor" | "belowEditor";
};

export interface ExtensionUiContextLike {
  select(title: string, options: string[], opts?: DialogOptionsLike): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: DialogOptionsLike): Promise<boolean>;
  input(title: string, placeholder?: string, opts?: DialogOptionsLike): Promise<string | undefined>;
  editor(title: string, prefill?: string, opts?: DialogOptionsLike): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  onTerminalInput(): () => void;
  setStatus(key: string, text: string | undefined): void;
  setWorkingMessage(message?: string): void;
  setWorkingVisible(visible: boolean): void;
  setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }): void;
  setHiddenThinkingLabel(label?: string): void;
  setWidget(key: string, content: string[] | ((...args: never[]) => unknown) | undefined, options?: WidgetOptionsLike): void;
  setFooter(factory: unknown): void;
  setHeader(factory: unknown): void;
  setTitle(title: string): void;
  custom<T = unknown>(...args: unknown[]): Promise<T>;
  pasteToEditor(text: string): void;
  setEditorText(text: string): void;
  getEditorText(): string;
  addAutocompleteProvider(): void;
  setEditorComponent(): void;
  getEditorComponent(): undefined;
  readonly theme: Theme;
  getAllThemes(): unknown[];
  getTheme(name: string): undefined;
  setTheme(theme: unknown): { success: boolean; error?: string };
  getToolsExpanded(): boolean;
  setToolsExpanded(expanded: boolean): void;
}

export interface AgentSessionLike {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly autoCompactionEnabled: boolean;
  readonly autoRetryEnabled: boolean;
  readonly model: ModelLike | undefined;
  readonly routedModel?: { model: ModelLike; thinkingLevel?: string };
  readonly modelRuntime: ModelRuntime;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  readonly systemPrompt?: string;
  readonly agent: {
    state?: { readonly systemPrompt?: string; thinkingLevel?: string };
    transformContext?: AgentSession["agent"]["transformContext"];
  };
  readonly extensionRunner: ExtensionRunnerLike;
  readonly promptTemplates: readonly PromptTemplateLike[];
  readonly resourceLoader: ResourceLoaderLike;

  readonly bindExtensions?: unknown;
  reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void>;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  dispose(): void;
  prompt(text: string, options?: {
    images?: Array<{ type: "image"; data: string; mimeType: string }>;
    streamingBehavior?: "steer" | "followUp";
    source?: "interactive" | "rpc";
    preflightResult?: (disposition: InputDisposition) => void;
  }): Promise<void>;
  abort(): Promise<void>;
  setModel(model: ModelLike, options?: { persist?: boolean }): Promise<void>;
  navigateTree(targetId: string, options?: { summarize?: boolean }): Promise<NavigateTreeResult>;
  setThinkingLevel(level: string, options?: { persist?: boolean }): void;
  compact(customInstructions?: string): Promise<unknown>;
  setSessionName(name: string): void;
  getSessionStats(): Omit<SessionStatsInfo, "sessionName">;
  getLastAssistantText(): string | undefined;
  setAutoCompactionEnabled(enabled: boolean): void;
  setAutoRetryEnabled(enabled: boolean): void;
  steer(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>, options?: { source?: "interactive" | "rpc" }): Promise<"handled" | "queued">;
  followUp(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>, options?: { source?: "interactive" | "rpc" }): Promise<"handled" | "queued">;
  readonly pendingMessageCount: number;
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  clearQueue(): { steering: string[]; followUp: string[] };
  getAllTools(): ToolInfo[];
  getToolDefinition: AgentSession["getToolDefinition"];
  getActiveToolNames(): string[];
  getCallableToolNames?: () => string[];
  setActiveToolsByName(names: string[]): void;
  abortCompaction(): void;
  getContextUsage(): ContextUsage | undefined;
}
