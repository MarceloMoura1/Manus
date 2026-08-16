export function parseMediaDataUrl(dataUrl: string, declaredMimeType: string): { base64: string; mimeType: string } | null {
  const match = dataUrl.match(/^data:([^,]+),([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const metadataParts = match[1].split(";").map(part => part.trim()).filter(Boolean);
  const mimeType = metadataParts.shift()?.toLowerCase() || "";
  const declaredBaseType = declaredMimeType.split(";", 1)[0].trim().toLowerCase();
  if (!mimeType || mimeType !== declaredBaseType || !metadataParts.some(part => part.toLowerCase() === "base64")) {
    return null;
  }
  return { base64: match[2], mimeType };
}
