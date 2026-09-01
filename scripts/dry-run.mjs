#!/usr/bin/env node
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { preflight } from "./release-preflight.mjs";
import { validateManifest, verifyEnvelope } from "./validate-manifest.mjs";

// RFC 8032 test vector seed. Public, deterministic, and forbidden for production.
const TEST_SEED = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
const TEST_PKCS8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), TEST_SEED]);
const testPrivateKey = crypto.createPrivateKey({ key: TEST_PKCS8, format: "der", type: "pkcs8" });
const testPublicKey = crypto.createPublicKey(testPrivateKey).export({ format: "pem", type: "spki" });

const previousBytes = await readFile(new URL("../runtimes.manifest.json", import.meta.url));
const previous = JSON.parse(previousBytes);
validateManifest(previous);

const tag = "runtime-v2.0.0-test";
const candidate = {
  schema_version: 1,
  sequence: previous.sequence + 1,
  generated_at: "2026-09-01T00:00:01Z",
  status: "release",
  signing_key_id: "TEST-ONLY-rfc8032-vector-1",
  runtimes: [{
    id: "fixture-runtime", version: "2.0.0", platform: "windows", architecture: "x64", backend: "cpu", accelerator: "none",
    entrypoints: ["bin/runtime.exe"],
    archive: { name: "fixture-runtime.zip", url: `https://github.com/makekosmos/local-ai-runtimes/releases/download/${tag}/fixture-runtime.zip`, sha256: "a".repeat(64), size: 123, format: "zip" },
    source: { project: "fixture/upstream", version: "2.0.0", commit: "b".repeat(40) },
    build: { recipe: "fixtures/build.ps1", toolchain: "fixture-msvc" },
    licences: [{ spdx: "MIT", path: "LICENSE.txt" }], migration_status: "release-asset"
  }]
};
preflight({ tag, existingTags: [], existingReleases: [], previous, candidate, now: new Date("2026-09-01T00:01:00Z") });

const candidateBytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
const envelope = {
  schema_version: 1,
  payload_type: "application/vnd.makekosmos.runtime-manifest+json",
  payload_sha256: crypto.createHash("sha256").update(candidateBytes).digest("hex"),
  payload_size: candidateBytes.length,
  key_id: candidate.signing_key_id,
  signature: crypto.sign(null, candidateBytes, testPrivateKey).toString("base64")
};
verifyEnvelope(candidateBytes, envelope, { [candidate.signing_key_id]: testPublicKey });

const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ candidate, envelope })).digest("hex");
console.log(`Deterministic secret-free dry-run passed: ${fingerprint}`);
