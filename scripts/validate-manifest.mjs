#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const RELEASE_URL = /^https:\/\/github\.com\/makekosmos\/local-ai-runtimes\/releases\/download\/([^/]+)\/([^/]+)$/;
const LEGACY_URL = /^https:\/\/raw\.githubusercontent\.com\/makekosmos\/local-ai-runtimes\/([a-f0-9]{40})\/([^/]+)$/;

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

export function validateManifest(manifest, { now = new Date(), maxFutureSkewMs = 5 * 60_000 } = {}) {
  if (!manifest || manifest.schema_version !== 1) throw new Error("unsupported manifest schema");
  if (!Number.isSafeInteger(manifest.sequence) || manifest.sequence <= 0) throw new Error("sequence must be a positive integer");
  if (!ISO_UTC.test(manifest.generated_at || "")) throw new Error("generated_at must be canonical UTC seconds");
  const generatedAt = Date.parse(manifest.generated_at);
  if (!Number.isFinite(generatedAt) || generatedAt > now.getTime() + maxFutureSkewMs) throw new Error("generated_at is invalid or too far in the future");
  if (!["migration-in-progress", "release"].includes(manifest.status)) throw new Error("unsupported manifest status");
  if (!Array.isArray(manifest.runtimes) || manifest.runtimes.length === 0) throw new Error("runtimes must be non-empty");

  const ids = new Set();
  const coordinates = new Set();
  for (const runtime of manifest.runtimes) {
    requiredString(runtime?.id, "runtime id");
    if (ids.has(runtime.id)) throw new Error(`duplicate runtime id: ${runtime.id}`);
    ids.add(runtime.id);
    if (!SEMVER.test(runtime.version || "")) throw new Error(`${runtime.id}: invalid version`);
    if (runtime.platform !== "windows" || runtime.architecture !== "x64") throw new Error(`${runtime.id}: unsupported platform/architecture`);
    if (!["cpu", "vulkan"].includes(runtime.backend) || !["none", "vulkan"].includes(runtime.accelerator)) throw new Error(`${runtime.id}: unsupported backend/accelerator`);
    const coordinate = `${runtime.id}@${runtime.version}:${runtime.platform}:${runtime.architecture}:${runtime.backend}`;
    if (coordinates.has(coordinate)) throw new Error(`duplicate runtime coordinate: ${coordinate}`);
    coordinates.add(coordinate);
    if (!Array.isArray(runtime.entrypoints) || runtime.entrypoints.length === 0 || new Set(runtime.entrypoints.map((value) => value.toLowerCase())).size !== runtime.entrypoints.length) throw new Error(`${runtime.id}: unique entrypoints are required`);
    for (const entrypoint of runtime.entrypoints) validateArchivePath(entrypoint, `${runtime.id}: entrypoint`);

    const archive = runtime.archive;
    if (!archive || archive.format !== "zip") throw new Error(`${runtime.id}: ZIP archive metadata is required`);
    validateArchivePath(archive.name, `${runtime.id}: archive name`);
    if (archive.name.includes("/")) throw new Error(`${runtime.id}: archive name must be flat`);
    if (!SHA256.test(archive.sha256 || "")) throw new Error(`${runtime.id}: exact SHA-256 is required`);
    if (!Number.isSafeInteger(archive.size) || archive.size <= 0) throw new Error(`${runtime.id}: exact size is required`);

    if (manifest.status === "release") {
      const match = RELEASE_URL.exec(archive.url || "");
      if (!match || match[2] !== archive.name || !match[1].includes(runtime.version)) throw new Error(`${runtime.id}: immutable versioned release URL is required`);
      if (runtime.migration_status !== "release-asset") throw new Error(`${runtime.id}: release asset status is required`);
      requiredString(runtime.source?.project, `${runtime.id}: source project`);
      requiredString(runtime.source?.version, `${runtime.id}: source version`);
      if (!/^[a-f0-9]{40}$/.test(runtime.source?.commit || "")) throw new Error(`${runtime.id}: immutable source commit is required`);
      requiredString(runtime.build?.recipe, `${runtime.id}: build recipe`);
      requiredString(runtime.build?.toolchain, `${runtime.id}: build toolchain`);
      if (!Array.isArray(runtime.licences) || runtime.licences.length === 0) throw new Error(`${runtime.id}: licence metadata is required`);
      runtime.licences.forEach((licence, index) => {
        requiredString(licence?.spdx, `${runtime.id}: licence ${index} SPDX`);
        validateArchivePath(licence?.path, `${runtime.id}: licence ${index} path`);
      });
      requiredString(manifest.signing_key_id, "manifest signing_key_id");
    } else {
      const match = LEGACY_URL.exec(archive.url || "");
      if (!match || match[2] !== archive.name) throw new Error(`${runtime.id}: legacy URL must pin the exact historical commit and archive name`);
      if (runtime.migration_status !== "quarantined-legacy-source-blob") throw new Error(`${runtime.id}: legacy artifact must remain quarantined`);
      if (runtime.source !== null || runtime.build !== null || !Array.isArray(runtime.licences) || runtime.licences.length !== 0) throw new Error(`${runtime.id}: incomplete provenance must be represented explicitly, not guessed`);
    }
  }
  return true;
}

export function validateArchivePath(value, label = "archive path") {
  requiredString(value, label);
  if (value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) throw new Error(`${label} is unsafe`);
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) throw new Error(`${label} is unsafe`);
  return true;
}

export function verifyEnvelope(manifestBytes, envelope, publicKeys) {
  if (envelope?.schema_version !== 1 || envelope.payload_type !== "application/vnd.makekosmos.runtime-manifest+json") throw new Error("unsupported envelope");
  if (envelope.payload_sha256 !== crypto.createHash("sha256").update(manifestBytes).digest("hex") || envelope.payload_size !== manifestBytes.length) throw new Error("envelope hash or size mismatch");
  requiredString(envelope.key_id, "envelope key_id");
  const key = publicKeys instanceof Map ? publicKeys.get(envelope.key_id) : publicKeys?.[envelope.key_id];
  if (!key) throw new Error("envelope key is not trusted");
  const signature = Buffer.from(envelope.signature || "", "base64");
  if (signature.length !== 64 || !crypto.verify(null, manifestBytes, crypto.createPublicKey(key), signature)) throw new Error("envelope signature verification failed");
  let manifest;
  try { manifest = JSON.parse(manifestBytes); } catch { throw new Error("signed manifest is not valid JSON"); }
  if (manifest.status !== "release" || manifest.signing_key_id !== envelope.key_id) throw new Error("envelope key ID does not match the release manifest");
  return true;
}

export function assertSequence(previous, candidate) {
  if (candidate.schema_version !== previous.schema_version) throw new Error("schema version cannot change in a sequence update");
  if (candidate.sequence !== previous.sequence + 1) throw new Error("candidate sequence must increment exactly once");
  if (Date.parse(candidate.generated_at) <= Date.parse(previous.generated_at)) throw new Error("candidate timestamp must increase");
  return true;
}

async function main() {
  const bytes = await readFile(new URL("../runtimes.manifest.json", import.meta.url));
  validateManifest(JSON.parse(bytes));
  console.log(`Validated exact ${bytes.length}-byte runtime manifest.`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
