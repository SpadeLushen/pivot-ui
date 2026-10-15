"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function SessionSearchControl({ query, onChange, enabled }: {
  query: string; onChange: (value: string) => void; enabled: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const searching = Boolean(query.trim());
  const closeSearch = useCallback(() => {
    input.current?.blur();
    setExpanded(false);
  }, []);
  useLayoutEffect(() => {
    if (!expanded) return;
    const search = region.current;
    const heading = search?.closest<HTMLElement>(".sidebar-session-heading");
    const section = heading?.closest<HTMLElement>(".sidebar-session-section");
    if (!search || !heading || !section) return;
    input.current?.focus();
    // Content is laid out at its final width; only its clipping is animated.
    // Reserve overflow below the unchanged toolbar, not inside its centered row.
    const reserveSpace = () => {
      const bottom = search.offsetTop + search.getBoundingClientRect().height + 8;
      const extra = Math.max(0, Math.ceil(bottom - heading.getBoundingClientRect().height));
      section.style.setProperty("--session-search-extra-height", `${extra}px`);
    };
    reserveSpace();
    const observer = new ResizeObserver(reserveSpace);
    observer.observe(search);
    observer.observe(heading);
    return () => {
      observer.disconnect();
      section.style.removeProperty("--session-search-extra-height");
    };
  }, [expanded]);
  useEffect(() => {
    if (!expanded || searching) return;
    const outside = (event: MouseEvent) => {
      if (!anchor.current?.contains(event.target as Node)) {
        closeSearch();
      }
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [expanded, searching, closeSearch]);
  return <div ref={anchor} className={`session-search-anchor${expanded ? " is-expanded" : ""}`}>
    <button type="button" className="session-search-trigger" aria-label={t("general.search")}
      aria-expanded={expanded} aria-hidden={expanded} tabIndex={expanded ? -1 : 0}
      onClick={() => setExpanded(true)}><Search size={16} /></button>
    <div ref={region} className={`session-search-float${expanded ? " is-expanded" : ""}`}
      inert={!expanded} aria-hidden={!expanded}>
      <div className="session-search-input-row">
        <input ref={input} value={query} tabIndex={expanded ? 0 : -1}
          aria-hidden={!expanded} aria-label={t("sessionSearch.placeholder")}
          placeholder={t("sessionSearch.placeholder")} maxLength={1000}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") { onChange(""); closeSearch(); } }} />
        <button type="button" aria-expanded={expanded}
          aria-label={t(searching ? "general.clearSearch" : "general.close")}
          onClick={() => {
            if (!searching) closeSearch();
            else { onChange(""); input.current?.focus(); }
          }}><X size={16} /></button>
      </div>
      {!enabled && <div className="session-search-hint">{t("sessionSearch.titleOnly")}</div>}
    </div>
  </div>;
}
