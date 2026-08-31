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
  assert.match(handleSend, /const ok = await onSend\(msg, attachments\.length \? attachments : undefined\)/);
  assert.match(handleSend, /if \(ok !== false\) clearInput\(\)/);
  assert.match(clearInput, /valueRef\.current = ""/);
  assert.match(clearInput, /if \(draftKey\) clearDraft\(draftKey\)/);
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
