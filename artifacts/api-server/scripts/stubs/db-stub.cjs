/**
 * A stand-in for @workspace/db used by hermetic unit suites.
 *
 * Every export resolves to a Proxy that throws the moment it is actually
 * called. So a suite that bundles against this stub and still passes has PROVEN
 * the code under test never reached the database — not merely that we withheld
 * a connection string from it.
 *
 * CommonJS on purpose: the export list of @workspace/db is large and moves,
 * and CJS interop lets any named import resolve without pinning that list here.
 */
const trap = (name) => new Proxy(function () {}, {
  get: (_t, prop) => {
    if (prop === "then") return undefined; // never look like a promise
    if (prop === Symbol.toPrimitive || prop === "toString" || prop === Symbol.toStringTag) return () => name;
    return trap(`${name}.${String(prop)}`);
  },
  apply: () => {
    throw new Error(`Hermetic unit suite touched the database: ${name}() was called`);
  },
});

module.exports = new Proxy({}, {
  get: (_t, prop) => (prop === "__esModule" ? false : trap(String(prop))),
  has: () => true,
});
