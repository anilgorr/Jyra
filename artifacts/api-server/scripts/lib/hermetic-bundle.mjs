/**
 * Bundle a module graph for unit testing with the database replaced by a stub
 * that throws on contact. Suites built this way need no DATABASE_URL, no API
 * keys and no network — and if the code under test ever grows a database call,
 * the suite fails loudly instead of silently requiring a live server.
 */
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

const STUB = fileURLToPath(new URL("../stubs/db-stub.cjs", import.meta.url));

export async function loadHermetic(entryPoint, outfile) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: "cjs",
    platform: "node",
    external: ["pg-native"],
    plugins: [{
      name: "stub-database",
      setup(b) {
        b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: STUB }));
      },
    }],
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}
