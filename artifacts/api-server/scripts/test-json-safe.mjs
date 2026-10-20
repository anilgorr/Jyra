/**
 * Strings Postgres jsonb will take: a slice that halves an emoji, a NUL, a stray surrogate.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
await build({ entryPoints: ["./src/lib/json-safe.ts"], outfile: "/tmp/json-safe.cjs", bundle: true, format: "cjs", platform: "node" });
const j = await import(pathToFileURL("/tmp/json-safe.cjs").href);
const emoji = "Healthcare 🏥 Financial 💰 Manufacturing 🏭";
const cut = emoji.slice(0, 12); // "Healthcare " is 11 units; 🏥 is two; this ends inside it
assert.equal(cut.length, 12);
assert.match(JSON.stringify({ cut }), /\\ud83c"/i, "a plain slice leaves a lone high surrogate, which jsonb refuses");
assert.equal(j.cutText(emoji, 12), "Healthcare ", "cutText backs off one unit rather than split the pair");
assert.equal(j.cutText(emoji, 13), "Healthcare 🏥");
assert.equal(j.cutText(emoji, 1000), emoji);
assert.equal(j.jsonSafeText(cut), "Healthcare ");
assert.equal(j.jsonSafeText("a\u0000b\uDC00c"), "abc");
assert.equal(j.jsonSafeText(emoji), emoji, "whole pairs are untouched");
const payload = { a: [cut, { b: "x\uD83Dy", n: 1 }], d: new Date(0) };
const safe = j.jsonSafe(payload);
assert.equal(safe.a[0], "Healthcare ");
assert.equal(safe.a[1].b, "xy");
assert.equal(safe.a[1].n, 1);
assert.ok(safe.d instanceof Date, "non-plain objects pass through");
assert.doesNotThrow(() => JSON.parse(JSON.stringify(safe)));
console.log("json-safe ok");
