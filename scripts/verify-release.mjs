#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateManifest, verifyEnvelope } from "./validate-manifest.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
for (const flag of ["--manifest", "--envelope", "--trusted-keys"]) if (!args.get(flag)) throw new Error(`${flag} is required`);
const manifestBytes = await readFile(args.get("--manifest"));
const manifest = JSON.parse(manifestBytes);
const envelope = JSON.parse(await readFile(args.get("--envelope"), "utf8"));
const trustedKeys = JSON.parse(await readFile(args.get("--trusted-keys"), "utf8"));
validateManifest(manifest);
verifyEnvelope(manifestBytes, envelope, trustedKeys);
console.log(`Verified signed runtime manifest sequence ${manifest.sequence}.`);
