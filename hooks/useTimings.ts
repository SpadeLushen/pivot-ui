"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantMessage } from "@/lib/types";
import { assistantTimingId, MAX_TIMING_RECORDS, recordedDuration, saveTiming, saveTimings } from "@/lib/timing-store";
import { normalizeToolCalls } from "@/lib/normalize";

interface TimingEvent {
  type: string;
  [key: string]: unknown;
}

interface LiveTurn {
  start: number;
  assistant: AssistantMessage | null;
  firstOutputAt?: number;
  lastOutputAt?: number;
  thinkingStarts: Map<number, number>;
  thinkingDone: Map<number, number>;
  thinkingEnds: Map<number, number>;
}

export function useTimings(sessionIdRef: React.RefObject<string | null>) {
  const turn = useRef<LiveTurn | null>(null);
  const tools = useRef(new Map<string, number>());
  const finishedTools = useRef(new Map<string, number>());
  const pending = useRef(new Map<string, number>());
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => performance.now());
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  // Storage is unavailable during SSR; defer reads until hydration completes.
  useEffect(() => refresh(), [refresh]);

  useEffect(() => {
    if (!turn.current?.thinkingStarts.size && !tools.current.size) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [revision]);

  const stage = useCallback((key: string, ms: number) => {
    pending.current.delete(key);
    pending.current.set(key, ms);
    if (pending.current.size > MAX_TIMING_RECORDS) pending.current.delete(pending.current.keys().next().value!);
  }, []);

  const flushPending = useCallback(() => {
    if (pending.current.size === 0) return;
    saveTimings(pending.current);
    pending.current.clear();
  }, []);

  const stopActive = useCallback(() => {
    if (!turn.current && tools.current.size === 0 && pending.current.size === 0) return;
    // A missed turn_end must still preserve tools/thinking that did finish.
    flushPending();
    turn.current = null;
    tools.current.clear();
    finishedTools.current.clear();
    refresh();
  }, [flushPending, refresh]);

  useEffect(() => () => flushPending(), [flushPending]);

  const recordEvent = useCallback((event: TimingEvent) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const clock = performance.now();
    switch (event.type) {
      case "turn_start":
        flushPending(); // previous turn was interrupted without turn_end
        finishedTools.current.clear();
        turn.current = { start: clock, assistant: null, thinkingStarts: new Map(), thinkingDone: new Map(), thinkingEnds: new Map() };
        refresh();
        break;
      case "message_start": {
        const message = event.message as { role?: string } | undefined;
        if (message?.role === "assistant" && turn.current) {
          turn.current.firstOutputAt = undefined;
          turn.current.lastOutputAt = undefined;
        }
        break;
      }
      case "message_update": {
        const update = event.assistantMessageEvent as { type?: string; contentIndex?: number; delta?: string } | undefined;
        const active = turn.current;
        if (!active || typeof update?.contentIndex !== "number") break;
        // All model output counts: text, thinking and generated tool arguments.
        // Empty/start/end events must not extend the output window into waits.
        if (["text_delta", "thinking_delta", "toolcall_delta"].includes(update.type ?? "")
          && typeof update.delta === "string" && update.delta.length > 0) {
          active.firstOutputAt ??= clock;
          active.lastOutputAt = clock;
        }
        if (update.type === "thinking_start") {
          // Adjacent thinking blocks share one displayed clock. Include the gap
          // after the previous segment so the total runs from the first start.
          const start = active.thinkingEnds.get(update.contentIndex - 1) ?? clock;
          active.thinkingStarts.set(update.contentIndex, start);
        }
        if (update.type === "thinking_end") {
          const start = active.thinkingStarts.get(update.contentIndex);
          if (start !== undefined) {
            active.thinkingDone.set(update.contentIndex, clock - start);
            active.thinkingEnds.set(update.contentIndex, clock);
          }
          active.thinkingStarts.delete(update.contentIndex);
        }
        if (update.type === "thinking_start" || update.type === "thinking_end") refresh();
        break;
      }
      case "message_end": {
        const message = event.message as AssistantMessage | undefined;
        if (message?.role !== "assistant" || !turn.current) break;
        const active = turn.current;
        active.assistant = normalizeToolCalls(message) as AssistantMessage;
        const id = assistantTimingId(active.assistant);
        // Publish output timing at message_end so TPS is visible while tools run.
        // Keep thinking/tool/whole-turn timings on their existing batch lifecycle.
        if (active.firstOutputAt !== undefined && active.lastOutputAt !== undefined
          && active.lastOutputAt > active.firstOutputAt) {
          saveTiming(`generation:${sid}:${id}`, active.lastOutputAt - active.firstOutputAt);
        }
        for (const [index, ms] of active.thinkingDone) stage(`thinking:${sid}:${id}:${index}`, ms);
        // A block cut off by an abort has no thinking_end; do not invent a duration.
        refresh();
        break;
      }
      case "turn_end": {
        const active = turn.current;
        if (active?.assistant) stage(`turn:${sid}:${assistantTimingId(active.assistant)}`, clock - active.start);
        flushPending();
        turn.current = null;
        finishedTools.current.clear();
        refresh();
        break;
      }
      case "agent_settled":
        stopActive();
        break;
      case "tool_execution_start":
        if (typeof event.toolCallId === "string") tools.current.set(event.toolCallId, clock);
        refresh();
        break;
      case "tool_execution_end": {
        const id = event.toolCallId;
        if (typeof id !== "string") break;
        const start = tools.current.get(id);
        tools.current.delete(id);
        // Nested summaries time the whole invocation pipeline, unlike execute-only end events.
        // Keep their browser fallback on that same start/end boundary until the summary arrives.
        const ms = (event.parentToolCallId === undefined ? recordedDuration(event.durationMs) : undefined)
          ?? (start !== undefined ? clock - start : undefined);
        if (ms !== undefined) {
          stage(`tool:${sid}:${id}`, ms);
          finishedTools.current.set(id, ms);
        }
        refresh();
        break;
      }
    }
  }, [flushPending, refresh, sessionIdRef, stage, stopActive]);

  const liveThinking = new Map<number, number>();
  for (const [index, start] of turn.current?.thinkingStarts ?? []) liveThinking.set(index, Math.max(0, now - start));
  for (const [index, ms] of turn.current?.thinkingDone ?? []) liveThinking.set(index, ms);
  const liveTools = new Map<string, number>();
  for (const [id, ms] of finishedTools.current) liveTools.set(id, ms);
  for (const [id, start] of tools.current) liveTools.set(id, now - start);
  const liveAssistantId = turn.current?.assistant ? assistantTimingId(turn.current.assistant) : undefined;
  const runningThinking = new Set(turn.current?.thinkingStarts.keys() ?? []);
  const runningTools = new Set(tools.current.keys());
  return { revision, liveAssistantId, liveThinking, liveTools, runningThinking, runningTools, recordEvent, stopActive };
}
