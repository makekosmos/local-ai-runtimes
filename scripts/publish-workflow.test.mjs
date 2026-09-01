import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflow = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");

test("production workflow builds, verifies, signs, and immutably publishes in order", () => {
  assert.match(workflow, /ref: \$\{\{ inputs\.bom_ref \}\}/);
  assert.match(workflow, /-DCMAKE_C_FLAGS=\/Brepro/);
  assert.match(workflow, /-DGGML_VULKAN=ON/);
  assert.match(workflow, /CPU inference smoke failed/);
  assert.match(workflow, /Vulkan runtime CPU fallback smoke failed/);
  assert.match(workflow, /inspect_archives\.py/);
  assert.match(workflow, /environment: production/);
  assert.ok(workflow.indexOf("Preflight immutable release") < workflow.indexOf("RUNTIME_SIGNING_PRIVATE_KEY"));
  assert.ok(workflow.indexOf("gh release create") < workflow.indexOf("gh release upload"));
  assert.ok(workflow.indexOf("gh release upload") < workflow.indexOf("gh release edit"));
  assert.match(workflow, /immutable-releases/);
  for (const line of workflow.split("\n").filter((line) => line.trim().startsWith("uses:"))) {
    assert.match(line, /@[a-f0-9]{40}\s*$/);
  }
});
