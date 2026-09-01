#!/usr/bin/env node
import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { verifyEnvelope } from "./validate-manifest.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
for (const flag of ["--manifest", "--trusted-keys", "--out"]) if (!args.get(flag)) throw new Error(`${flag} is required`);
if (!process.env.RUNTIME_SIGNING_PRIVATE_KEY) throw new Error("RUNTIME_SIGNING_PRIVATE_KEY is required");
const manifestBytes = await readFile(args.get("--manifest"));
const manifest = JSON.parse(manifestBytes);
const trustedKeys = JSON.parse(await readFile(args.get("--trusted-keys"), "utf8"));
const envelope = {
  schema_version: 1,
  payload_type: "application/vnd.makekosmos.runtime-manifest+json",
  payload_sha256: crypto.createHash("sha256").update(manifestBytes).digest("hex"),
  payload_size: manifestBytes.length,
  key_id: manifest.signing_key_id,
  signature: crypto.sign(null, manifestBytes, crypto.createPrivateKey(process.env.RUNTIME_SIGNING_PRIVATE_KEY)).toString("base64"),
};
verifyEnvelope(manifestBytes, envelope, trustedKeys);
await writeFile(args.get("--out"), `${JSON.stringify(envelope, null, 2)}\n`);
console.log(`Signed and verified exact ${manifestBytes.length}-byte runtime manifest.`);

