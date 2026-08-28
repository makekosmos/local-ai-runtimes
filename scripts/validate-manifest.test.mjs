import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { validateManifest, verifyEnvelope } from "./validate-manifest.mjs";

const source = JSON.parse(await readFile(new URL("../runtimes.manifest.json", import.meta.url), "utf8"));
const bytes = Buffer.from(JSON.stringify(source, null, 2) + "\n");

test("accepts migration manifest and ephemeral signed envelope", () => {
  assert.equal(validateManifest(source), true);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const envelope = {
    schema_version: 1,
    payload_sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    signature: crypto.sign(null, bytes, privateKey).toString("base64"),
  };
  assert.equal(verifyEnvelope(bytes, envelope, publicKey), true);
});

for (const [name, mutate, pattern] of [
  ["duplicate runtime IDs", (m) => m.runtimes.push(structuredClone(m.runtimes[0])), /duplicate/],
  ["archive traversal", (m) => { m.runtimes[0].archive = "../runtime.zip"; }, /flat ZIP/],
  ["unsupported architecture", (m) => { m.runtimes[0].architecture = "arm64"; }, /unsupported/],
  ["release missing provenance", (m) => { m.status = "release"; }, /release entries require|source provenance/],
]) {
  test(name, () => assert.throws(() => {
    const m = structuredClone(source);
    mutate(m);
    validateManifest(m);
  }, pattern));
}

test("rejects tampered signed manifest", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const envelope = {
    schema_version: 1,
    payload_sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    signature: crypto.sign(null, bytes, privateKey).toString("base64"),
  };
  const altered = Buffer.from(bytes);
  altered[altered.length - 2] ^= 1;
  assert.throws(() => verifyEnvelope(altered, envelope, publicKey), /hash|signature/);
});
