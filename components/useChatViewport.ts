"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMessage } from "@/lib/types";
import {
  captureScrollDistance,
  getNextVisibleCount,
  restoreScrollTop,
  VISIBLE_PAGE_SIZE,
} from "@/lib/chat-lazy-load";
import { getCompletionScrollAllowed, isAtScrollTail, shouldFollowScrollTailOnResize } from "./chat-viewport-state";

const PROGRAMMATIC_SCROLL_IGNORE_MS = 700;
const USER_SCROLL_INTENT_MS = 1200;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Space", "Spacebar"]);

type UseChatViewportOptions = {
  messageCount: number;
  streamingMessage: Partial<AgentMessage> | null;
  agentRunning: boolean;
  loading: boolean;
  hasMessageViewport: boolean;
  promptGeneration: number;
};

export function useChatViewport({
  messageCount,
  streamingMessage,
  agentRunning,
  loading,
  hasMessageViewport,
  promptGeneration,
}: UseChatViewportOptions) {
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const [pinnedVisibleStart, setPinnedVisibleStart] = useState<number | null>(null);
  const lastVisibleStartRef = useRef(0);
  const rememberVisibleStart = useCallback((start: number) => { lastVisibleStartRef.current = start; }, []);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevScrollDistanceRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastUserMessageRef = useRef<HTMLDivElement>(null);
  // Keep layout changes (for example, a status bar appearing above the
  // viewport) from moving a user who was following the chat tail away from
  // the latest content. This is separate from completionScrollAllowedRef:
  // a new prompt intentionally scrolls its user message into view first.
  const scrollTailPinnedRef = useRef(true);
  const initialScrollDoneRef = useRef(false);
  const completionScrollAllowedRef = useRef(true);
  const userScrollIntentUntilRef = useRef(0);
  const ignoreProgrammaticScrollUntilRef = useRef(0);
  const handledPromptGenerationRef = useRef(promptGeneration);
  // Do not move the viewport while the user is dragging over chat text, or
  // after they have selected a passage to copy for their next prompt.
  const selectionPausedRef = useRef(false);
  const selectionPointerDownRef = useRef(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (selectionPausedRef.current) return;
    scrollTailPinnedRef.current = true;
    if (behavior === "smooth") {
      ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    }
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const scrollUserMessageToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const message = lastUserMessageRef.current;
    if (!container || !message) return;
    const top = message.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    scrollTailPinnedRef.current = false;
    ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    container.scrollTo({ top: top - 16, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      prevScrollDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
      setVisibleCount((current) => getNextVisibleCount(current));
    }, { root: container, threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [messageCount, visibleCount]);

  useEffect(() => {
    if (prevScrollDistanceRef.current === null) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = restoreScrollTop(container.scrollHeight, prevScrollDistanceRef.current);
    prevScrollDistanceRef.current = null;
  }, [visibleCount]);

  const markUserScrollIntent = useCallback((event: Event) => {
    if (event instanceof KeyboardEvent) {
      if (!SCROLL_KEYS.has(event.key)) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
    }
    userScrollIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
  }, []);

  const handleScrollPositionChange = useCallback((event: Event) => {
    const container = event.currentTarget as HTMLDivElement;
    const now = Date.now();
    const atTail = isAtScrollTail(container.scrollHeight, container.scrollTop, container.clientHeight);
    if (atTail && !selectionPointerDownRef.current) {
      selectionPausedRef.current = false;
      scrollTailPinnedRef.current = true;
      completionScrollAllowedRef.current = true;
    } else if (now >= ignoreProgrammaticScrollUntilRef.current && now <= userScrollIntentUntilRef.current) {
      scrollTailPinnedRef.current = false;
    }

    if (!agentRunning) return;
    completionScrollAllowedRef.current = getCompletionScrollAllowed({
      current: completionScrollAllowedRef.current,
      atTail,
      now,
      ignoreProgrammaticScrollUntil: ignoreProgrammaticScrollUntilRef.current,
      userScrollIntentUntil: userScrollIntentUntilRef.current,
    });
  }, [agentRunning]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element) ||
          event.target.closest("button, a, input, textarea, select, [contenteditable]")) return;
      clearTimeout(releaseTimer);
      selectionPointerDownRef.current = true;
      selectionPausedRef.current = true;
      setPinnedVisibleStart((current) => current ?? lastVisibleStartRef.current);
    };
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim() &&
          selection.anchorNode && container.contains(selection.anchorNode) &&
          selection.focusNode && container.contains(selection.focusNode)) {
        selectionPausedRef.current = true;
        setPinnedVisibleStart((current) => current ?? lastVisibleStartRef.current);
      } else if (!selectionPointerDownRef.current) {
        setPinnedVisibleStart(null);
      }
    };
    const onPointerUp = () => {
      if (!selectionPointerDownRef.current) return;
      // Wait until the browser has finalized the text selection after pointerup.
      releaseTimer = setTimeout(() => {
        selectionPointerDownRef.current = false;
        const selection = window.getSelection();
        const hasChatSelection = Boolean(selection && !selection.isCollapsed && selection.toString().trim() &&
          ((selection.anchorNode && container.contains(selection.anchorNode)) ||
           (selection.focusNode && container.contains(selection.focusNode))));
        selectionPausedRef.current = hasChatSelection;
        if (!hasChatSelection) setPinnedVisibleStart(null);
        if (hasChatSelection) {
          scrollTailPinnedRef.current = false;
          completionScrollAllowedRef.current = false;
        }
      }, 0);
    };
    container.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      clearTimeout(releaseTimer);
      container.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [loading, hasMessageViewport]);

  useEffect(() => {
    window.addEventListener("keydown", markUserScrollIntent);
    window.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
    return () => {
      window.removeEventListener("keydown", markUserScrollIntent);
      window.removeEventListener("pointerdown", markUserScrollIntent);
    };
  }, [markUserScrollIntent]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener("wheel", markUserScrollIntent, { passive: true });
    container.addEventListener("touchstart", markUserScrollIntent, { passive: true });
    container.addEventListener("scroll", handleScrollPositionChange, { passive: true });
    return () => {
      container.removeEventListener("wheel", markUserScrollIntent);
      container.removeEventListener("touchstart", markUserScrollIntent);
      container.removeEventListener("scroll", handleScrollPositionChange);
    };
  }, [messageCount, loading, handleScrollPositionChange, markUserScrollIntent]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    // The transient Running/Waiting indicator is rendered inside this content
    // node. Observing only the viewport misses that height change because the
    // viewport itself keeps the same dimensions.
    const content = container.firstElementChild;

    let frame: number | null = null;
    const resizeObserver = new ResizeObserver((entries) => {
      const contentChanged = content !== null && entries.some((entry) => entry.target === content);
      if (!shouldFollowScrollTailOnResize({
        scrollTailPinned: scrollTailPinnedRef.current,
        completionScrollAllowed: completionScrollAllowedRef.current,
        contentChanged,
        agentRunning,
      })) return;
      // One re-anchor per frame is enough even when the status and message
      // nodes report their size changes in separate observer callbacks.
      if (frame !== null) return;
      const followContent = contentChanged;
      frame = requestAnimationFrame(() => {
        frame = null;
        // Check again because the user may have scrolled while the frame was
        // waiting. Never take control back from an intentional scroll.
        if (shouldFollowScrollTailOnResize({
          scrollTailPinned: scrollTailPinnedRef.current,
          completionScrollAllowed: completionScrollAllowedRef.current,
          contentChanged: followContent,
          agentRunning,
        })) {
          scrollToBottom("instant");
        }
      });
    });
    resizeObserver.observe(container);
    if (content) resizeObserver.observe(content);

    return () => {
      resizeObserver.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [agentRunning, loading, scrollToBottom]);

  useEffect(() => {
    if (promptGeneration === handledPromptGenerationRef.current) return;
    handledPromptGenerationRef.current = promptGeneration;
    selectionPausedRef.current = false;
    setPinnedVisibleStart(null);
    completionScrollAllowedRef.current = true;
    initialScrollDoneRef.current = true;
    scrollUserMessageToTop();
  }, [promptGeneration, scrollUserMessageToTop]);

  useEffect(() => {
    if (messageCount === 0) return;
    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      scrollToBottom("instant");
    } else if (!agentRunning && completionScrollAllowedRef.current) {
      scrollToBottom("smooth");
    }
  }, [messageCount, agentRunning, scrollToBottom]);

  useEffect(() => {
    if (streamingMessage && completionScrollAllowedRef.current) {
      scrollToBottom("instant");
    }
  }, [streamingMessage, scrollToBottom]);

  return {
    visibleCount,
    pinnedVisibleStart,
    rememberVisibleStart,
    sentinelRef,
    scrollContainerRef,
    messagesEndRef,
    lastUserMessageRef,
  };
}
