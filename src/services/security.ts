const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "warpcast:", "farcaster:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);

export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttribute(value: string | number | null | undefined): string {
  return escapeHtml(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizePotentialUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  return trimmed;
}

function parseAbsoluteUrl(value: string | undefined): URL | null {
  const normalized = normalizePotentialUrl(value);

  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

export function sanitizeLinkUrl(value: string | undefined): string | undefined {
  const parsed = parseAbsoluteUrl(value);

  if (!parsed || !SAFE_LINK_PROTOCOLS.has(parsed.protocol)) {
    return undefined;
  }

  return parsed.toString();
}

export function sanitizeImageUrl(
  value: string | undefined,
  options: { allowDataImage?: boolean } = {}
): string | undefined {
  const normalized = normalizePotentialUrl(value);

  if (!normalized) {
    return undefined;
  }

  if (options.allowDataImage && normalized.toLowerCase().startsWith("data:image/")) {
    return normalized;
  }

  const parsed = parseAbsoluteUrl(normalized);

  if (!parsed || !SAFE_IMAGE_PROTOCOLS.has(parsed.protocol)) {
    return undefined;
  }

  return parsed.toString();
}
