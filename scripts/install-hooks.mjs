#!/usr/bin/env node
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: "ignore" });
  execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"]);
  console.log("Installed runtime repository hooks.");
} catch {
  console.log("Git hooks skipped: not inside a checkout.");
}
