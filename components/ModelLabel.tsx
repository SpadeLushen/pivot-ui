"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

interface Props {
  name: string;
  provider?: string;
  compactProvider?: boolean;
}

const chipStyle: CSSProperties = {
  padding: "1px 5px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "var(--bg-panel)",
  color: "var(--text-muted)",
  fontSize: "0.9em",
  lineHeight: 1.25,
  whiteSpace: "nowrap",
};

/** Keep the model first; on mobile, shorten or hide the trailing provider chip. */
export function ModelLabel({ name, provider, compactProvider = false }: Props) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const modelRef = useRef<HTMLSpanElement>(null);
  const minimumRef = useRef<HTMLSpanElement>(null);
  const [providerFits, setProviderFits] = useState(true);
  const fullName = provider ? `${name} (${provider})` : name;
  const characters = Array.from(provider ?? "");
  const minimumProvider = characters.slice(0, 3).join("") + (characters.length > 3 ? "…" : "");

  useLayoutEffect(() => {
    if (!compactProvider || !provider) return;
    const root = rootRef.current;
    const model = modelRef.current;
    const minimum = minimumRef.current;
    if (!root || !model || !minimum) return;
    const measure = () => setProviderFits(
      root.getBoundingClientRect().width >= model.getBoundingClientRect().width + minimum.getBoundingClientRect().width + 6,
    );
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [root, model, minimum]) observer.observe(element);
    return () => observer.disconnect();
  }, [compactProvider, provider, name]);

  const showProvider = provider && (!compactProvider || providerFits);
  return (
    <span ref={rootRef} title={fullName} style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: compactProvider ? "1 1 auto" : "0 1 auto", minWidth: 0, maxWidth: "100%", overflow: "hidden", whiteSpace: "nowrap", position: "relative" }}>
      {compactProvider && provider && (
        <span aria-hidden="true" style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", whiteSpace: "pre", width: "max-content" }}>
          <span ref={modelRef}>{name}</span><span ref={minimumRef} style={chipStyle}>{minimumProvider}</span>
        </span>
      )}
      <span style={{ flex: compactProvider && showProvider ? "0 0 auto" : "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      {showProvider && <span style={{ ...chipStyle, flex: compactProvider ? "0 1 auto" : "0 0 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{provider}</span>}
    </span>
  );
}
