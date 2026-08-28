#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../runtimes.manifest.json", import.meta.url), "utf8"));
if (manifest.schema_version !== 1 || !["migration-in-progress", "release"].includes(manifest.status)) throw new Error("unsupported manifest status");
if (!Array.isArray(manifest.runtimes) || manifest.runtimes.length === 0) throw new Error("runtimes must be non-empty");
const ids = new Set();
for (const runtime of manifest.runtimes) {
  if (!runtime || typeof runtime.id !== "string" || ids.has(runtime.id)) throw new Error("duplicate or invalid runtime id");
  ids.add(runtime.id);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(runtime.version)) throw new Error(`${runtime.id}: invalid version`);
  if (runtime.platform !== "windows" || runtime.architecture !== "x64" || !["cpu", "vulkan"].includes(runtime.backend)) throw new Error(`${runtime.id}: unsupported target`);
  if (typeof runtime.archive !== "string" || runtime.archive.includes("/") || runtime.archive.includes("\\\\") || !runtime.archive.endsWith(".zip")) throw new Error(`${runtime.id}: archive must be a flat ZIP name`);
  if (!Number.isSafeInteger(runtime.size) || runtime.size <= 0) throw new Error(`${runtime.id}: size is required`);
  if (manifest.status === "release") {
    if (!/^[a-f0-9]{64}$/.test(runtime.sha256) || typeof runtime.source !== "object" || typeof runtime.signing_key_id !== "string") throw new Error(`${runtime.id}: release entries require hash, source and signing key`);
  } else if (runtime.migration_status !== "legacy-git-asset") {
    throw new Error(`${runtime.id}: migration entries must identify legacy assets`);
  }
}
console.log(`Validated ${manifest.runtimes.length} runtime manifest entries (${manifest.status}).`);
