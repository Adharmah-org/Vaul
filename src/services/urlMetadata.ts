import { isValidHttpUrl } from './fileUtils';

export interface ResolvedUrlMetadata {
  url: string;
  title: string;
  description: string;
  faviconUrl: string;
  fetchedLive: boolean;
}

/**
 * Resolves metadata for a bookmark URL.
 * Attempts a lightweight client-side fetch with a short timeout when CORS allows,
 * and gracefully falls back to clean domain-derived metadata when blocked by CORS.
 */
export async function resolveBookmarkMetadata(rawUrl: string): Promise<ResolvedUrlMetadata> {
  const validation = isValidHttpUrl(rawUrl);
  if (!validation.valid || !validation.normalized) {
    throw new Error(validation.error || 'Invalid URL');
  }

  const parsed = new URL(validation.normalized);
  const hostname = parsed.hostname.replace(/^www\./, '');
  const fallbackTitle = hostname;
  const fallbackFavicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      mode: 'cors',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        url: parsed.toString(),
        title: fallbackTitle,
        description: `Saved link from ${hostname}`,
        faviconUrl: fallbackFavicon,
        fetchedLive: false,
      };
    }

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.querySelector('title')?.textContent?.trim() || fallbackTitle;
    const metaDesc =
      doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ||
      doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ||
      `Saved link from ${hostname}`;

    return {
      url: parsed.toString(),
      title: title.slice(0, 140),
      description: metaDesc.slice(0, 280),
      faviconUrl: fallbackFavicon,
      fetchedLive: true,
    };
  } catch {
    return {
      url: parsed.toString(),
      title: fallbackTitle,
      description: `Saved link from ${hostname}`,
      faviconUrl: fallbackFavicon,
      fetchedLive: false,
    };
  }
}
