// Session selection changes only the query string. A Next.js router navigation
// re-applies the layout's static metadata title after the chat sets its title.
// Native history integrates with Next's useSearchParams without reloading metadata.
export function replaceSessionUrl(sessionId: string | null): void {
  window.history.replaceState(null, "", sessionId ? `?session=${encodeURIComponent(sessionId)}` : "/");
}
