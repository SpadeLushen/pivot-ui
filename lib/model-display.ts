/** Original provider ids for names shared by different providers; no display case conversion. */
export function buildAmbiguousModelProviders(names: Readonly<Record<string, string>>): Record<string, string> {
  const firstProvider = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [key, name] of Object.entries(names)) {
    const separator = key.indexOf(":");
    if (separator < 0) continue;
    const provider = key.slice(0, separator);
    const first = firstProvider.get(name);
    if (first !== undefined && first !== provider) ambiguous.add(name);
    else firstProvider.set(name, provider);
  }
  return Object.fromEntries(Object.entries(names).flatMap(([key, name]) => {
    const separator = key.indexOf(":");
    return separator >= 0 && ambiguous.has(name) ? [[key, key.slice(0, separator)]] : [];
  }));
}
