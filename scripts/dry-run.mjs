#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { validateManifest, verifyEnvelope } from "./validate-manifest.mjs";

const manifestBytes = await readFile(new URL("../runtimes.manifest.json", import.meta.url));
const manifest = JSON.parse(manifestBytes);
validateManifest(manifest);

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const envelope = {
  schema_version: 1,
  payload_sha256: crypto.createHash("sha256").update(manifestBytes).digest("hex"),
  signature: crypto.sign(null, manifestBytes, privateKey).toString("base64"),
};
verifyEnvelope(manifestBytes, envelope, publicKey);
console.log("Dry-run passed with ephemeral Ed25519 signature; no runtime release or production secret was used.");
