/** Provider-qualified identity for chat-picker visibility; model IDs may contain separators. */
export function modelVisibilityKey(provider: string, modelId: string): string {
  return JSON.stringify([provider, modelId]);
}
