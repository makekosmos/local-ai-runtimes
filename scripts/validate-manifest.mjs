#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/i;

export function validateManifest(manifest) {
  if (manifest?.schema_version !== 1 || !["migration-in-progress", "release"].includes(manifest.status)) {
    throw new Error("unsupported manifest status");
  }
  if (!manifest.verification_contract?.required_before_release?.includes("signature") ||
      !manifest.verification_contract?.installation?.includes("safe_archive")) {
    throw new Error("manifest must declare signature and safe archive verification");
  }
  if (!Array.isArray(manifest.runtimes) || manifest.runtimes.length === 0) throw new Error("runtimes must be non-empty");
  const ids = new Set();
  for (const runtime of manifest.runtimes) {
    if (!runtime || typeof runtime.id !== "string" || ids.has(runtime.id)) throw new Error("duplicate or invalid runtime id");
    ids.add(runtime.id);
    if (!SEMVER.test(runtime.version)) throw new Error(`${runtime.id}: invalid version`);
    if (runtime.platform !== "windows" || runtime.architecture !== "x64" || !["cpu", "vulkan"].includes(runtime.backend)) {
      throw new Error(`${runtime.id}: unsupported target`);
    }
    if (typeof runtime.archive !== "string" || runtime.archive.includes("/") || runtime.archive.includes("\\") || !runtime.archive.endsWith(".zip")) {
      throw new Error(`${runtime.id}: archive must be a flat ZIP name`);
    }
    if (!Number.isSafeInteger(runtime.size) || runtime.size <= 0) throw new Error(`${runtime.id}: size is required`);
    if (manifest.status === "release") {
      if (!SHA256.test(runtime.sha256) || !/^https:\/\/github\.com\/.+\/releases\/download\/.+/.test(runtime.archive_url || "")) {
        throw new Error(`${runtime.id}: release entries require immutable HTTPS archive URL and hash`);
      }
      if (!runtime.source || typeof runtime.source.project !== "string" || typeof runtime.source.version !== "string" ||
          !/^[0-9a-f]{40}$/i.test(runtime.source.commit || "")) throw new Error(`${runtime.id}: source provenance is incomplete`);
      if (!runtime.build || typeof runtime.build.recipe !== "string" || typeof runtime.build.toolchain !== "string") {
        throw new Error(`${runtime.id}: build provenance is incomplete`);
      }
      if (!Array.isArray(runtime.licences) || runtime.licences.length === 0 || runtime.licences.some((x) => typeof x !== "string" || !x.trim())) {
        throw new Error(`${runtime.id}: licences are required`);
      }
      if (typeof runtime.signing_key_id !== "string" || !runtime.signing_key_id) throw new Error(`${runtime.id}: signing key is required`);
    } else if (runtime.migration_status !== "legacy-git-asset") {
      throw new Error(`${runtime.id}: migration entries must identify legacy assets`);
    }
  }
  return true;
}

export function verifyEnvelope(manifestBytes, envelope, publicKey) {
  if (envelope?.schema_version !== 1 || envelope.payload_sha256 !== crypto.createHash("sha256").update(manifestBytes).digest("hex")) {
    throw new Error("manifest envelope hash or schema is invalid");
  }
  const signature = Buffer.from(envelope.signature || "", "base64");
  if (signature.length !== 64 || !crypto.verify(null, manifestBytes, crypto.createPublicKey(publicKey), signature)) {
    throw new Error("manifest envelope signature verification failed");
  }
  return true;
}

async function main() {
  const manifest = JSON.parse(await readFile(new URL("../runtimes.manifest.json", import.meta.url), "utf8"));
  validateManifest(manifest);
  console.log(`Validated ${manifest.runtimes.length} runtime manifest entries (${manifest.status}).`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
