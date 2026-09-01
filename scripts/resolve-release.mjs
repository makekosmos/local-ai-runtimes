#!/usr/bin/env node
import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateManifest } from "./validate-manifest.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
for (const flag of ["--plan", "--assets", "--repository-commit", "--bom", "--manifest"]) if (!args.get(flag)) throw new Error(`${flag} is required`);
const repositoryCommit = args.get("--repository-commit");
if (!/^[a-f0-9]{40}$/.test(repositoryCommit)) throw new Error("repository commit must be a full SHA");
const plan = JSON.parse(await readFile(args.get("--plan"), "utf8"));
const runtimes = [];
for (const runtime of plan.runtimes ?? []) {
  const archivePath = path.join(args.get("--assets"), runtime.archive.name);
  const bytes = await readFile(archivePath);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== runtime.archive.sha256 || bytes.length !== runtime.archive.size) throw new Error(`${runtime.id}: reproducible archive hash or size mismatch`);
  runtimes.push(runtime);
}
const bom = {
  schema_version: plan.schema_version,
  sequence: plan.sequence,
  generated_at: plan.generated_at,
  repository_commit: repositoryCommit,
  release_tag: plan.release_tag,
  signing_key_id: plan.signing_key_id,
  runtimes,
};
const manifest = {
  schema_version: plan.schema_version,
  sequence: plan.sequence,
  generated_at: plan.generated_at,
  status: "release",
  signing_key_id: plan.signing_key_id,
  runtimes: runtimes.map((runtime) => ({ ...runtime, migration_status: "release-asset" })),
};
validateManifest(manifest);
await writeFile(args.get("--bom"), `${JSON.stringify(bom, null, 2)}\n`);
await writeFile(args.get("--manifest"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Resolved ${runtimes.length} reproducible runtime archives.`);
