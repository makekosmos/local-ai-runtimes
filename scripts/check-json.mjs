#!/usr/bin/env node
import { readFile } from "node:fs/promises";

for (const file of ["runtimes.manifest.json", "release-bom.schema.json"]) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const formatted = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
  if (source.replace(/\r\n/g, "\n") !== formatted) throw new Error(`${file} is not deterministically formatted`);
}
console.log("JSON formatting is deterministic.");
