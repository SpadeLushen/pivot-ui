import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ExtensionDialog } = await jiti.import("./ChatWindow.tsx");

test("waits for a pending pack reload before sending", async () => {
  const [chatWindow, hook] = await Promise.all([
    readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8"),
  ]);
  const handleSend = hook.slice(
    hook.indexOf("const handleSend = useCallback"),
    hook.indexOf("const handleAbort = useCallback"),
  );

  assert.match(chatWindow, /packsRefreshKey,/);
  assert.match(hook, /const ensurePackSkillsReloaded = useCallback/);
  assert.match(handleSend, /await ensurePackSkillsReloaded\(\);/);
});

test("preserves multiline extension dialog titles", () => {
  const title = [
    "Permission Required",
    "tool : bash",
    "rule : rm -rf *",
    "command : rm -rf tmp/app-shell-check tmp/app-shell-baseline",
    "full command : git worktree remove --force tmp/pivot-ui-base && rm -rf tmp/app-shell-check tmp/app-shell-baseline",
  ].join("\n");
  const html = renderToStaticMarkup(
    React.createElement(ExtensionDialog, {
      request: {
        type: "extension_ui_request",
        id: "permission-request",
        method: "select",
        title,
        options: ["Allow", "Deny"],
      },
      onRespond() {},
    }),
  );

  assert.match(html, /Permission Required\ntool : bash\nrule : rm -rf \*\ncommand : rm -rf tmp\/app-shell-check tmp\/app-shell-baseline\nfull command : git worktree remove --force tmp\/pivot-ui-base/);
  assert.match(html, /white-space:pre-wrap/);
  assert.match(html, /overflow-wrap:anywhere/);
});

test("collapses mobile pack badges to the first pack", async () => {
  const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

  assert.match(chatInput, /isMobile \? appliedPacks\.slice\(0, 1\) : appliedPacks/);
  assert.match(chatInput, /isMobile && appliedPacks\.length > 1 && "\\u22ef"/);
});

test("keeps the live stream anchored to the real chat tail", async () => {
  const [chatWindow, viewport, hook] = await Promise.all([
    readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("./useChatViewport.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(chatWindow, /agentRunning && \(\s*<div style=\{\{ height: scrollContainerRef\.current/);
  assert.match(chatWindow, /useChatViewport\(\{/);
  assert.match(viewport, /if \(streamingMessage && completionScrollAllowedRef\.current\)/);
  assert.doesNotMatch(hook, /messagesEndRef|scrollContainerRef|lastUserMsgRef/);
});

test("resumes following when the user returns to the live tail", async () => {
  const [viewport, state] = await Promise.all([
    readFile(new URL("./useChatViewport.ts", import.meta.url), "utf8"),
    readFile(new URL("./chat-viewport-state.ts", import.meta.url), "utf8"),
  ]);

  assert.match(viewport, /container\.addEventListener\("scroll", handleScrollPositionChange/);
  assert.match(viewport, /isAtScrollTail\(container\.scrollHeight, container\.scrollTop, container\.clientHeight\)/);
  assert.match(state, /if \(atTail\) return true;/);
  assert.match(state, /if \(now < ignoreProgrammaticScrollUntil \|\| now > userScrollIntentUntil\) return current;/);
});

test("keeps the live tail visible when the chat viewport is resized", async () => {
  const viewport = await readFile(new URL("./useChatViewport.ts", import.meta.url), "utf8");

  assert.match(viewport, /const scrollTailPinnedRef = useRef\(true\)/);
  assert.match(viewport, /const resizeObserver = new ResizeObserver/);
  assert.match(viewport, /resizeObserver\.observe\(container\)/);
  assert.match(viewport, /if \(content\) resizeObserver\.observe\(content\)/);
  assert.match(viewport, /shouldFollowScrollTailOnResize\(\{/);
  assert.match(viewport, /scrollTailPinned: scrollTailPinnedRef\.current/);
  assert.match(viewport, /scrollToBottom\("instant"\)/);
  assert.match(viewport, /resizeObserver\.disconnect\(\)/);
  assert.match(viewport, /\}, \[agentRunning, loading, scrollToBottom\]\);/);
});

test("clears the transient draft after a successful new-session send", async () => {
  const [appShell, chatWindow, chatInput, hook] = await Promise.all([
    readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8"),
  ]);
  const newSessionHandler = appShell.slice(
    appShell.indexOf("const handleNewSession"),
    appShell.indexOf("// Client-built transient SessionInfo"),
  );
  const handleSend = chatInput.slice(
    chatInput.indexOf("const handleSend = useCallback"),
    chatInput.indexOf("const slashQuery ="),
  );
  const clearInput = chatInput.slice(
    chatInput.indexOf("const clearInput = useCallback"),
    chatInput.indexOf("useEffect(() => {", chatInput.indexOf("const clearInput = useCallback")),
  );

  // A successful send creates the session before onSend resolves. The
  // composer then clears the original transient draft key, while clicking
  // New Session itself does not own draft cleanup.
  assert.match(hook, /promoteNewSession\(1, message\)/);
  assert.match(hook, /clearDraft\(`new:\$\{newSessionCwd\}`\)/);
  assert.match(hook, /opts\.chatInputRef\?\.current\?\.clearInput\(\)/);
  assert.match(handleSend, /const ok = await onSend\(msg, attachments\.length \? attachments : undefined\)/);
  assert.match(handleSend, /if \(ok !== false\) clearInput\(\)/);
  assert.match(clearInput, /valueRef\.current = ""/);
  assert.match(clearInput, /if \(draftKey\) clearDraft\(draftKey\)/);
  assert.match(chatInput, /clearInput\(\) \{\s+clearInputRef\.current\?\.\(\);/);
  assert.doesNotMatch(newSessionHandler, /clearDraft/);
  assert.match(appShell, /key=\{sessionKey\}/);
  assert.match(chatWindow, /newSessionCwd \? `new:\$\{newSessionCwd\}`/);
  assert.match(chatInput, /getDraft\(draftKey\)\?\.value/);

  // Selecting an existing session must retain its own draft.
  const existingSessionHandler = appShell.slice(
    appShell.indexOf("const handleSelectSession"),
    appShell.indexOf("const handleNewSession"),
  );
  assert.doesNotMatch(existingSessionHandler, /clearDraft/);
});

test("keeps extension-generated session names and browser titles synchronized", async () => {
  const [appShell, chatWindow, hook, rpc] = await Promise.all([
    readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/rpc-manager.ts", import.meta.url), "utf8"),
  ]);

  assert.match(rpc, /event\.type === "agent_end" \|\| event\.type === "session_info_changed"/);
  assert.match(hook, /case "session_info_changed"/);
  assert.match(hook, /void connectEvents\(session\.id\)/);
  assert.match(hook, /document\.title = request\.title \|\| "Pivot UI"/);
  assert.match(chatWindow, /onSessionNameChange, onSessionForked/);
  assert.match(appShell, /onSessionNameChange=\{handleSessionNameChange\}/);
});
test("uses Pi's default thinking level for new sessions", async () => {
  const [route, hook] = await Promise.all([
    readFile(new URL("../app/api/models/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /settings\.getDefaultThinkingLevel\(\) \?\? null/);
  assert.match(route, /defaultThinkingLevel/);
  assert.match(hook, /defaultThinkingLevel\?: string \| null/);
  assert.match(hook, /setThinkingLevel\(normalizeThinkingLevel\(d\.defaultThinkingLevel\)\)/);
  assert.match(hook, /!thinkingLevelUserSelectedRef\.current/);
  assert.doesNotMatch(hook, /readThinkingLevelPreference|writeThinkingLevelPreference|pi-thinking-level/);
});

test("propagates the TPS visibility preference to session messages", async () => {
  const [appShell, chatWindow, messageView, settings] = await Promise.all([
    readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("./MessageView.tsx", import.meta.url), "utf8"),
    readFile(new URL("./SettingsModal.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(appShell, /showTps=\{showTps\}/);
  assert.match(chatWindow, /showTps=\{showTps\}/);
  assert.match(messageView, /showTps && tps !== null/);
  assert.match(settings, /id="settings-show-tps"/);
});

test("keeps thinking previews collapsed while retaining positive duration and toggle controls", async () => {
  const messageView = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
  const thinkingBlock = messageView.slice(
    messageView.indexOf("function ThinkingBlock"),
    messageView.indexOf("function ToolCallBlock"),
  );

  assert.match(thinkingBlock, /const preview = getLastThinkingLine\(content \?\? block\.thinkingPreview \?\? block\.thinking\)/);
  assert.match(thinkingBlock, /!expanded \? \(/);
  assert.match(thinkingBlock, /direction: "rtl"/);
  assert.match(thinkingBlock, /textOverflow: "ellipsis"/);
  assert.match(thinkingBlock, /duration !== undefined && \(duration > 0 \|\| isLive\)/);
  assert.match(thinkingBlock, /<ChevronDown/);
  assert.match(thinkingBlock, /transform: expanded \? "rotate\(180deg\)" : "none"/);
  assert.match(thinkingBlock, /className="markdown-thinking-message"/);
  assert.match(thinkingBlock, /<MarkdownBody[\s\S]*\{block\.deferred \? content \?\? "" : block\.thinking\}[\s\S]*<\/MarkdownBody>/);
  assert.match(thinkingBlock, /<MarkdownBody className="markdown-thinking-preview" inline[\s\S]*\{preview\}[\s\S]*<\/MarkdownBody>/);
});


test("starts live thinking at the model header and removes empty provider thinking", async () => {
  const [chatWindow, messageView] = await Promise.all([
    readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("./MessageView.tsx", import.meta.url), "utf8"),
  ]);

  // A new prompt gets a fresh live-message instance, so its local timer starts
  // when the assistant/model header first becomes visible.
  assert.match(chatWindow, /key=\{`stream-\$\{promptGeneration\}`\}/);
  assert.match(messageView, /const thinkingTimingsRef = useRef<Map<number, StreamingThinkingTiming>>/);
  assert.match(messageView, /setInterval\(tick, 1000\)/);
  assert.match(messageView, /return \(\) => clearInterval\(id\)/);

  // A real thinking block replaces the provisional one; an empty one is
  // removed as soon as the first non-thinking block arrives.
  assert.match(messageView, /getStreamingAssistantBlockItems\(message\)/);
  assert.match(messageView, /thinkingStructureKey/);
  assert.match(messageView, /updateStreamingThinkingDurations/);
});

test("always shows notice details in a modal instead of expanding the toast", async () => {
  const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const noticeBlock = chatWindow.slice(
    chatWindow.indexOf("function noticeColor"),
    chatWindow.indexOf("type ExtensionDialogRequest"),
  );
  const dialogBlock = noticeBlock.slice(
    noticeBlock.indexOf("function NoticeDetailsDialog"),
    noticeBlock.indexOf("function NoticeShelf({"),
  );

  assert.match(noticeBlock, /className="notice-details-button"/);
  assert.match(noticeBlock, /onClick=\{\(\) => onShowDetails\(notice\)\}/);
  assert.doesNotMatch(noticeBlock, /ResizeObserver|scrollWidth|isOverflowing/);
  assert.match(dialogBlock, /createPortal\(/);
  assert.match(dialogBlock, /role="dialog"/);
  assert.match(dialogBlock, /whiteSpace: "pre-wrap"/);
  assert.match(dialogBlock, /overflowWrap: "anywhere"/);
  assert.match(dialogBlock, /\{notice\.message\}/);
});
