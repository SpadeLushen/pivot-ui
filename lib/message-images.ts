import type { ImageContent } from "./types";

// Only image MIME types can become data URLs or binary image responses.
export function isImageMimeType(mime: unknown): mime is string {
  return typeof mime === "string" && /^image\/[a-z0-9][a-z0-9.+-]*$/i.test(mime);
}

export function imageSource(image: ImageContent): string {
  const source = image.source;
  const data = source?.type === "base64" ? source.data : image.data;
  const mime = source?.type === "base64" ? source.media_type : image.mimeType;
  if (typeof data === "string" && data && isImageMimeType(mime)) {
    return `data:${mime};base64,${data}`;
  }
  if (source?.type !== "url" || typeof source.url !== "string") return "";
  const url = source.url.trim();
  if (/^https?:\/\//i.test(url) || (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\"))) return url;
  if (/^data:image\/[a-z0-9][a-z0-9.+-]*;base64,/i.test(url)) return url;
  return "";
}
