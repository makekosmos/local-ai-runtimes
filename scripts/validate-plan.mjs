#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateManifest } from "./validate-manifest.mjs";

const plan = JSON.parse(await readFile(new URL("../release/runtime-v1.9.3.plan.json", import.meta.url), "utf8"));
if (!/^[a-f0-9]{40}$/.test(plan.upstream?.commit || "") || plan.upstream.repository !== "ggml-org/whisper.cpp") throw new Error("plan must pin whisper.cpp by full commit");
if (!/^https:\/\/sdk\.lunarg\.com\//.test(plan.vulkan_sdk?.url || "") || !/^[a-f0-9]{64}$/.test(plan.vulkan_sdk?.sha256 || "")) throw new Error("plan must pin the Vulkan SDK hash");
if (!/^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[a-f0-9]{40}\//.test(plan.smoke_model?.url || "") || !/^[a-f0-9]{64}$/.test(plan.smoke_model?.sha256 || "") || !Number.isSafeInteger(plan.smoke_model?.size)) throw new Error("plan must pin the smoke model bytes");
for (const runtime of plan.runtimes ?? []) {
  if (runtime.source?.commit !== plan.upstream.commit || runtime.source?.version !== plan.upstream.version) throw new Error(`${runtime.id}: source differs from pinned upstream`);
}
validateManifest({
  schema_version: plan.schema_version,
  sequence: plan.sequence,
  generated_at: plan.generated_at,
  status: "release",
  signing_key_id: plan.signing_key_id,
  runtimes: plan.runtimes.map((runtime) => ({ ...runtime, migration_status: "release-asset" })),
});
console.log(`Validated reviewed release plan with ${plan.runtimes.length} runtimes.`);

