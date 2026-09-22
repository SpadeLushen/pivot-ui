"use client";

import { useState, useCallback, useEffect, useRef } from "react";

export function useDragDrop(onDrop: (files: File[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragTargetRef = useRef<EventTarget | null>(null);

  const reset = useCallback(() => {
    dragTargetRef.current = null;
    setIsDragOver(false);
  }, []);

  useEffect(() => {
    const handleWindowLeave = (event: DragEvent) => {
      // Some browsers report the final leave on the document, not the last
      // element. Ignore old child targets during transitions within the page.
      if (event.relatedTarget === null && (
        event.target === dragTargetRef.current || event.target === document || event.target === window
      )) reset();
    };
    window.addEventListener("dragleave", handleWindowLeave, true);
    window.addEventListener("drop", reset, true);
    window.addEventListener("dragend", reset, true);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragleave", handleWindowLeave, true);
      window.removeEventListener("drop", reset, true);
      window.removeEventListener("dragend", reset, true);
      window.removeEventListener("blur", reset);
    };
  }, [reset]);

  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files") ||
    Array.from(e.dataTransfer.items).some((item) => item.kind === "file");

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragTargetRef.current = e.target;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragTargetRef.current = e.target;
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // The new target receives dragenter before the old target's dragleave.
    // Tracking that target avoids counters stranded by changing message DOM.
    if (e.target === dragTargetRef.current) reset();
  }, [reset]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    reset();
    const files = Array.from(e.dataTransfer.files);
    onDrop(files);
  }, [onDrop, reset]);

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}