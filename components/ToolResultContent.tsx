"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { imageSource } from "@/lib/message-images";
import type { ImageContent, TextContent, ToolResultView } from "@/lib/types";

type DisplayBlock = TextContent | ImageContent | { type: "deferredImage"; entryId: string; blockIndex: number };

function displayBlocks(result: ToolResultView, sessionId?: string): DisplayBlock[] {
  const deferred = result.deferredImages;
  if (!deferred || !sessionId) return result.content;
  const blocks: DisplayBlock[] = result.content.filter((_, index) => index !== deferred.noticeIndex);
  for (const image of deferred.images) {
    blocks.splice(image.blockIndex, 0, { type: "deferredImage", entryId: deferred.entryId, blockIndex: image.blockIndex });
  }
  return blocks;
}

// The SDK joins adjacent text items before returning codemode content. Its
// line markers retain the output boundaries; child calls are not output items.
function splitCodemodeOutput(blocks: DisplayBlock[]): DisplayBlock[] {
  return blocks.flatMap((block): DisplayBlock[] => {
    if (block.type !== "text") return [block];
    const markers = [...block.text.matchAll(/^==> text ([1-9]\d*)\/([1-9]\d*) <==\r?$/gm)]
      .filter((match) => Number(match[2]) > 1 && Number(match[1]) <= Number(match[2]));
    if (!markers.length) return [block];
    const boundaries = [0, ...markers.map((match) => match.index).filter((index) => index > 0), block.text.length];
    return boundaries.slice(0, -1).map((start, index) => ({
      type: "text",
      text: block.text.slice(start, boundaries[index + 1]).replace(/^==> text [1-9]\d*\/[1-9]\d* <==(?:\r?\n|$)/, ""),
    }));
  });
}

type OutputMode = "plain" | "blocks";

function OutputControls({ mode, onChange }: { mode: OutputMode; onChange: (mode: OutputMode) => void }) {
  const { t } = useI18n();
  return <div role="group" aria-label={t("message.outputView")} style={{ display: "flex", gap: 4, padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
    {(["plain", "blocks"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => onChange(value)} style={{ padding: "3px 8px", border: "1px solid var(--border)", borderRadius: 4, background: mode === value ? "var(--bg-selected)" : "none", color: mode === value ? "var(--text)" : "var(--text-dim)", fontSize: 11, cursor: "pointer" }}>{t(`message.output${value === "plain" ? "Plain" : "Blocks"}`)}</button>)}
  </div>;
}

function ResultText({ text, isEmpty, isError, flat = false }: { text: string; isEmpty?: boolean; isError?: boolean; flat?: boolean }) {
  return <pre style={{ margin: 0, padding: "8px 10px", color: isError ? "#f87171" : isEmpty ? "var(--text-dim)" : "var(--text-muted)", fontSize: 12, lineHeight: 1.5, maxHeight: flat ? undefined : 400, overflow: flat ? "visible" : "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontStyle: isEmpty ? "italic" : "normal", opacity: isEmpty ? 0.6 : 1 }}>{text}</pre>;
}

function ResultImage({ src, flat = false }: { src: string; flat?: boolean }) {
  const { t } = useI18n();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = failedSource === src;
  const [attempt, setAttempt] = useState(0);
  return (
    <div style={{ padding: flat ? 0 : "8px 10px", minWidth: 0 }}>
      {!src || failed ? (
        <div role="status" style={{ color: "var(--text-dim)", fontSize: 12 }}>
          {t("message.toolImageUnavailable")}
          {src && <button onClick={() => { setFailedSource(null); setAttempt((value) => value + 1); }} style={{ marginLeft: 8, color: "var(--accent)", border: "none", background: "none", cursor: "pointer" }}>{t("message.retryToolImage")}</button>}
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={attempt} src={src} alt={t("message.toolImage")} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSource(src)} style={{ display: "block", maxWidth: "100%", maxHeight: 400, minHeight: 80, objectFit: "contain", borderRadius: 6, border: "1px solid var(--border)" }} />
      )}
    </div>
  );
}

function CollapsibleOutputBlock({ block, index, sessionId, toolCallId, isError }: { block: DisplayBlock; index: number; sessionId?: string; toolCallId: string; isError?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const label = t(block.type === "text" ? "message.outputTextBlock" : "message.outputImageBlock", { index: index + 1 });
  const preview = block.type === "text" ? block.text.slice(0, 160).replace(/\s+/g, " ").trim() : "";
  return <details onToggle={(event) => setOpen(event.currentTarget.open)} style={{ margin: "6px 10px", border: "1px solid var(--border)", borderRadius: 5, minWidth: 0 }}>
    <summary style={{ padding: "7px 10px", cursor: "pointer", color: "var(--text-muted)", fontSize: 12 }}>
      <span title={preview} style={{ display: "inline-block", maxWidth: "calc(100% - 20px)", verticalAlign: "middle", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}{preview ? ` · ${preview}` : ""}</span>
    </summary>
    {/* Closed blocks neither construct data URLs nor mount historical image requests. */}
    {open && (block.type === "text" && (!block.text.trim() || block.text.trim() === "(no output)")
      ? <ResultText text={t("message.noToolOutput")} isEmpty isError={isError} />
      : <ResultBlock block={block} sessionId={sessionId} toolCallId={toolCallId} isError={isError} />)}
  </details>;
}

function resultImageSource(block: Exclude<DisplayBlock, TextContent>, sessionId: string | undefined, toolCallId: string): string {
  if (block.type !== "deferredImage") return imageSource(block);
  if (!sessionId) return "";
  return `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(block.entryId)}/images/${block.blockIndex}?toolCallId=${encodeURIComponent(toolCallId)}`;
}

function ResultBlock({ block, sessionId, toolCallId, isError, flat = false }: { block: DisplayBlock; sessionId?: string; toolCallId: string; isError?: boolean; flat?: boolean }) {
  // Do not rebuild large data URLs when only tool status or locale changes.
  const src = useMemo(() => block.type === "text" ? "" : resultImageSource(block, sessionId, toolCallId), [block, sessionId, toolCallId]);
  if (block.type === "text") {
    if (!block.text) return null;
    // Plain text shares one flow; no per-content pre, frame, padding or scrollbar.
    if (flat) return <>{block.text}{"\n"}</>;
    return <ResultText text={block.text} isError={isError} />;
  }
  return <ResultImage src={src} flat={flat} />;
}

function StructuredResult({ details, flat = false }: { details: unknown; flat?: boolean }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const structured = details && typeof details === "object" && "structuredContent" in details
    ? (details as { structuredContent?: unknown }).structuredContent : undefined;
  const text = useMemo(() => {
    if ((!flat && !expanded) || structured === undefined) return "";
    try {
      let truncated = false;
      const json = JSON.stringify(structured, function (key, value) {
        if (key === "data" && this?.type === "image") return t("message.omittedImageData");
        if (typeof value === "string" && value.length > 16_000) {
          truncated = true;
          return `${value.slice(0, 16_000)}…`;
        }
        return value;
      }, 2) ?? "";
      return truncated || json.length > 50_000 ? `${json.slice(0, 50_000)}\n${t("message.structuredTruncated")}` : json;
    } catch {
      return t("message.structuredUnavailable");
    }
  }, [expanded, flat, structured, t]);
  if (structured === undefined) return null;
  if (flat) return <>
    <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-dim)" }}>{t("message.structuredResult")}</div>
    <ResultText text={text} flat />
  </>;
  return (
    <details onToggle={(event) => setExpanded(event.currentTarget.open)} style={{ borderTop: "1px solid var(--border)", fontSize: 12 }}>
      <summary style={{ padding: "8px 10px", color: "var(--text-dim)", cursor: "pointer" }}>{t("message.structuredResult")}</summary>
      {expanded && <ResultText text={text} />}
    </details>
  );
}

export function ToolResultContent({ result, sessionId, outputLayouts = false }: { result: ToolResultView; sessionId?: string; outputLayouts?: boolean }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<OutputMode>("blocks");
  const { header, blocks } = useMemo(() => {
    const content = displayBlocks(result, sessionId);
    const first = content[0];
    // Only codemode parent Output opts in. Match its leading SDK execution summary,
    // not arbitrary later text blocks; tolerate history with header/body combined.
    const header = outputLayouts && first?.type === "text"
      ? first.text.match(/^Script (?:completed|failed)\r?\nWall time [\d.]+ seconds\r?\nOutput:\r?\n/)?.[0]
      : undefined;
    if (!header || first?.type !== "text") return { header: undefined, blocks: content };
    const remaining = first.text.slice(header.length);
    const blocks: DisplayBlock[] = remaining ? [{ type: "text", text: remaining }, ...content.slice(1)] : content.slice(1);
    return { header, blocks };
  }, [result, sessionId, outputLayouts]);
  const flat = outputLayouts && mode === "plain";
  const blockMode = outputLayouts && mode === "blocks";
  const renderedBlocks = useMemo(() => blockMode ? splitCodemodeOutput(blocks) : blocks, [blockMode, blocks]);
  const isEmpty = blocks.every((block) => block.type === "text" && (!block.text.trim() || block.text.trim() === "(no output)"));
  return (
    <div style={{ borderTop: `1px solid ${result.isError ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"}`, background: "var(--bg)", minWidth: 0 }}>
      {outputLayouts && <OutputControls mode={mode} onChange={setMode} />}
      {header && <ResultText text={header} isError={result.isError} flat />}
      <div style={{ maxHeight: 560, overflow: "auto", minWidth: 0, padding: flat ? "8px 10px" : undefined, whiteSpace: flat ? "pre-wrap" : undefined, overflowWrap: flat ? "anywhere" : undefined, fontFamily: flat ? "var(--font-mono)" : undefined, fontSize: flat ? 12 : undefined, lineHeight: flat ? 1.5 : undefined, color: result.isError ? "#f87171" : "var(--text-muted)" }}>
        {isEmpty && (!blockMode || !blocks.length) ? <ResultText text={t("message.noToolOutput")} isEmpty isError={result.isError} flat={flat} /> : renderedBlocks.map((block, index) => blockMode ? (
          <CollapsibleOutputBlock key={index} block={block} index={index} sessionId={sessionId} toolCallId={result.toolCallId} isError={result.isError} />
        ) : <ResultBlock key={index} block={block} sessionId={sessionId} toolCallId={result.toolCallId} isError={result.isError} flat={flat} />)}
        <StructuredResult key={flat ? "plain" : "blocks"} details={result.details} flat={flat} />
      </div>
    </div>
  );
}
