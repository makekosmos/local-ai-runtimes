# Kosmos local AI runtimes

This repository is the metadata and verification source for managed local AI runtimes. Runtime binaries are forbidden on the active source branch. New binaries must be immutable, versioned GitHub release assets described by an exact reviewed BOM and a signed manifest envelope.

## Current migration state

The three historical ZIPs were removed from the active source tree. `runtimes.manifest.json` preserves their exact SHA-256, byte size, and full-commit-pinned historical blob URL through **2026-12-31**. They remain `quarantined-legacy-source-blob`: provenance and licence files were not recoverable from the committed archives, so consumers MUST NOT treat them as installable release artifacts.

The reviewed `release/runtime-v1.9.3.plan.json` replaces those blobs with reproducible CPU and Vulkan builds from the full `whisper.cpp` v1.9.3 commit. It pins the compiler recipe, Vulkan SDK installer hash, smoke-model bytes, complete archive allowlists, and expected archive hashes. GitHub release immutability is enabled for this repository.

## Local verification

```powershell
bun install
bun run check
```

The repository has no package dependencies, so Bun intentionally produces no
lockfile. The pinned Bun 1.3.14 install configures repository-owned pre-commit
and pre-push hooks without downloading packages.
The dry-run is deterministic and offline. It uses the public RFC 8032 test vector, performs tag/release/sequence/timestamp preflight before signing, signs the exact candidate bytes, and verifies key ID, signature, hash, and size. It never reads a production secret.

Archive validation uses only the Python standard library and rejects traversal, absolute/drive/backslash paths, symlinks, encryption, case collisions, undeclared files, ZIP bombs, missing licences, bad hash/size, and non-x64 PE entrypoints.

## Publication model

1. Review the release plan and its full upstream commit, toolchain inputs, allowlists, and expected hashes.
2. Import/build assets in a clean job; do not accept mutable branch URLs.
3. Run `inspect_archives.py` and Windows CPU/Vulkan/startup/shutdown smoke tests.
4. Query GitHub for an existing tag or release and compare the previous signed manifest sequence before any signing secret is exposed.
5. Sign the exact reviewed manifest bytes in a protected production environment, then immediately verify the envelope with the committed trusted public key.
6. Create a draft, upload only the already-verified bytes, and publish it under repository-enforced release immutability. Re-download and re-verify every asset.

Dispatch `Build and publish signed runtimes` with only `bom_ref=<full main commit SHA>`. The Windows build job has no signing secret. The protected `production` job receives `RUNTIME_SIGNING_PRIVATE_KEY` only after source, toolchain, reproducibility, archive, PE, licence, inference, fallback, tag, timestamp, and sequence checks pass.

Detailed requirements are in [docs/publication-contract.md](docs/publication-contract.md). The exact consumer contract to hand to the Cortex agent is in [docs/cortex-agent-contract.md](docs/cortex-agent-contract.md). Do not edit Cortex from this repository.

## Key rotation and revocation

Each envelope binds a `key_id`; consumers use an allowlist of public keys with `not_before`, `not_after`, and revoked-sequence rules. Rotation publishes the new public key and overlap policy before the first manifest signed by it. A compromised key is rejected for sequences after the declared revocation boundary while old known-good installs remain available for rollback. Never rewrite a historical envelope or reuse a sequence.

## Remaining acceptance gates

- Merge and run the reviewed production workflow, then verify the immutable signed release after re-download.
- Implement and verify the consumer contract in Cortex/Dictation through the separate Cortex agent.

Until all gates pass, `status` remains `migration-in-progress` and legacy entries remain quarantined.
