/**
 * Text that Postgres jsonb will accept.
 *
 * A JavaScript string is UTF-16, so `slice(0, 4000)` on a page full of emoji
 * can cut a character in half and leave a lone surrogate; JSON.stringify
 * writes it as "\\udXXX" and Postgres refuses the whole row ("Unicode low
 * surrogate must follow a high surrogate", 22P02). A NUL is refused too.
 * One company's web page with a bad cut halted scheduled research for a day.
 *
 * `jsonSafeText` repairs one string; `jsonSafe` walks a payload and repairs
 * every string in it, so the cache write cannot be poisoned by any source.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function jsonSafeText(value: string): string {
  return value.replace(LONE_SURROGATE, "").replace(/\u0000/g, "");
}

export function jsonSafe<T>(value: T): T {
  if (typeof value === "string") return jsonSafeText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item)) as unknown as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[jsonSafeText(key)] = jsonSafe(item);
    return out as T;
  }
  return value;
}

/** Cut a string to at most `max` UTF-16 units without splitting a surrogate pair. */
export function cutText(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max;
  const code = value.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return value.slice(0, end);
}
