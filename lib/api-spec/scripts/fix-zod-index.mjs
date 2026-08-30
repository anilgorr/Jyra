import { readFile, writeFile } from "node:fs/promises";

const indexUrl = new URL("../../api-zod/src/index.ts", import.meta.url);
const source = await readFile(indexUrl, "utf8");
const corrected = source
  .split(/\r?\n/)
  .filter((line) => !line.includes("export * from './generated/types'"))
  .join("\n");
await writeFile(indexUrl, corrected.endsWith("\n") ? corrected : `${corrected}\n`);