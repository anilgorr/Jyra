/**
 * Reading a page's text without paying for it.
 *
 * The change gate needs one thing from a page: its visible text, stable
 * enough to hash. For most company sites a plain HTTP GET and a tag strip
 * gives exactly that, for nothing. Firecrawl renders JavaScript and gets
 * past the bot walls, which is worth USD 0.00083 — but only for the pages
 * that actually need it.
 *
 * So the gate reads free-first and falls back: direct fetch, and if that
 * comes back blocked, empty or suspiciously thin (a React shell with a
 * loading spinner is 200 OK and ~80 characters), Firecrawl gets asked. On a
 * 73-company watchlist that turned a 219-credit sweep into roughly 40.
 *
 * Which reader produced a hash is remembered with the hash, because the two
 * extract different text from the same page — Firecrawl's markdown drops
 * navigation that the tag strip keeps. Comparing across readers would report
 * a change every time the fallback kicked in.
 */
import { textFromHtml } from "./serper-provider";

export type PageReadVia = "direct" | "firecrawl";

export type DirectPageRead = {
  ok: boolean;
  text: string;
  finalUrl: string | null;
  title: string | null;
  statusCode: number | null;
  error: string | null;
};

/** Long enough that a JS shell or a cookie wall does not pass as a page. */
export const MIN_USABLE_TEXT = 400;

const TITLE = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i;

/**
 * One page over plain HTTP. Never throws. A non-HTML body, a redirect to a
 * consent page, or a thin render all come back ok:false so the caller can
 * decide whether the paid reader is worth it.
 */
export async function readPageDirect(url: string, options: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxChars?: number;
  minChars?: number;
} = {}): Promise<DirectPageRead> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxChars = options.maxChars ?? 30_000;
  const minChars = options.minChars ?? MIN_USABLE_TEXT;
  const empty = (error: string, statusCode: number | null = null): DirectPageRead =>
    ({ ok: false, text: "", finalUrl: null, title: null, statusCode, error });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Identifiable, with a contact path. Sites that block this are
        // exactly the ones the paid fallback exists for.
        "user-agent": "Mozilla/5.0 (compatible; JYRA/1.0; +https://jyra.digipuush.com)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en",
      },
    });
    if (!response.ok) return empty(`HTTP_${response.status}`, response.status);
    const type = response.headers.get("content-type") ?? "";
    if (!/html|xml|text\/plain/i.test(type)) return empty("NOT_HTML", response.status);
    const html = await response.text();
    const text = textFromHtml(html, maxChars);
    const title = TITLE.exec(html)?.[1]?.replace(/\s+/g, " ").trim() || null;
    if (text.length < minChars) return empty("THIN_PAGE", response.status);
    return { ok: true, text, finalUrl: response.url || url, title, statusCode: response.status, error: null };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return empty(aborted ? "TIMEOUT" : "FETCH_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

/** `via:hash`, so a hash is never compared against one the other reader produced. */
export function stampHash(via: PageReadVia, hash: string): string {
  return `${via}:${hash}`;
}

/** Split a stored fingerprint. Values written before readers were tracked are Firecrawl's. */
export function splitHash(stored: string): { via: PageReadVia; hash: string } {
  const at = stored.indexOf(":");
  if (at === -1) return { via: "firecrawl", hash: stored };
  const via = stored.slice(0, at);
  return { via: via === "direct" ? "direct" : "firecrawl", hash: stored.slice(at + 1) };
}
