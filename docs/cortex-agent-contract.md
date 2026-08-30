# Cortex-agent runtime consumer contract

This is the complete consumer-side change request. **Do not change this repository contract while implementing Cortex.** Cortex and Dictation must consume Store/Package Index metadata but treat this signed runtime manifest as the authority for privileged runtime bytes.

## Trust and anti-rollback state

Persist atomically:

- `highest_accepted_sequence` per manifest schema;
- trusted public keys keyed by `key_id`, validity window, and revocation boundary;
- active runtime coordinate and its manifest hash;
- previous known-good coordinate and manifest hash;
- quarantine records with reason, URL, observed hash/size, and timestamp.

Reject unknown/revoked keys, unsupported schema, `sequence < highest_accepted_sequence`, duplicate runtime coordinates, non-HTTPS URLs, non-versioned release URLs, redirects away from the allowlisted GitHub release host, and timestamps more than five minutes in the future. A recovery downgrade requires an explicit signed rollback authorization; a local flag is insufficient.

## Required install state machine

`IDLE → DOWNLOADING → DOWNLOADED → METADATA_VERIFIED → ARCHIVE_VERIFIED → STAGED → SMOKE_TESTED → COMMITTED → ACTIVE`

Any failure before `COMMITTED` moves the candidate to `QUARANTINED` and leaves `ACTIVE` untouched. A startup crash/health failure after commit moves to `ROLLING_BACK`, atomically restores the previous known-good pointer, then records `ROLLED_BACK`.

1. Download manifest and envelope with bounded size/time. Keep the exact manifest bytes.
2. Verify envelope schema, payload type, trusted key ID, payload byte size, SHA-256, then Ed25519 signature over those exact bytes.
3. Parse and validate manifest only after signature verification. Enforce sequence/timestamp/platform/architecture/backend and select exactly one coordinate.
4. Download the archive to a newly created quarantine directory on the same volume as installation. Never use the final path and never execute from quarantine.
5. Stream with a hard byte limit equal to `archive.size`; reject early EOF, extra bytes, or SHA-256 mismatch. Call `FlushFileBuffers` before verification success is recorded.
6. Inspect ZIP central and local headers before extraction. Reject absolute, UNC, drive, backslash, empty, `.`, `..`, ADS (`:`), device names, NUL, symlink/reparse-point, encrypted, duplicate/case-colliding, undeclared, excessive count/size/ratio entries. Require every declared licence and entrypoint; validate PE x64 machine type.
7. Extract only allowlisted files into a fresh staging directory using create-new/no-follow semantics. Re-open and hash files after extraction. Apply non-writable-by-unprivileged-users ACLs; do not inherit unsafe ACLs from the archive.
8. Run bounded smoke tests from staging with network disabled and a restricted token/job object: `--version`, startup/clean shutdown, CPU inference, and Vulkan capability with explicit CPU fallback. Never load DLLs from the current directory outside staging.
9. Atomically rename staging to the content-addressed final directory `<runtime-root>/<id>/<version>/<archive-sha256>/`. Atomically replace a small active-pointer file after fsync/`FlushFileBuffers`; never overwrite the previous directory.
10. Start through the active pointer and health-check. Retain at least one previous known-good directory. Garbage collection must never remove active, previous, quarantined-for-investigation, or pinned rollback versions.

## Concurrency and crash recovery

Use one cross-process install lock per runtime ID. On startup, delete only incomplete staging directories that contain the tool-owned marker and are not referenced by active/previous pointers; move incomplete downloads to quarantine. A crash between final-directory rename and pointer swap leaves the old runtime active. A crash after pointer swap triggers health validation and rollback.

## Error contract and telemetry

Expose stable error codes: `MANIFEST_SIGNATURE`, `MANIFEST_SEQUENCE`, `MANIFEST_TIMESTAMP`, `MANIFEST_SCHEMA`, `ASSET_HOST`, `ASSET_SIZE`, `ASSET_HASH`, `ARCHIVE_PATH`, `ARCHIVE_CONTENT`, `ARCHIVE_BOMB`, `PLATFORM`, `LICENCE`, `SMOKE_CPU`, `SMOKE_VULKAN`, `COMMIT_ATOMIC`, `HEALTHCHECK`, `ROLLBACK`.

Telemetry must never include manifest private material, local paths containing usernames, or archive contents. It should include runtime coordinate, manifest sequence/hash prefix, error code, rollback result, and quarantine record ID.

## Acceptance tests for the Cortex agent

- Valid install and update; same-version no-op; concurrent update serialization.
- Wrong key/key ID/signature, altered manifest bytes, sequence rollback, future timestamp.
- Redirect/host change, short/long body, exact size mismatch, hash mismatch.
- ZIP traversal/UNC/drive/backslash/ADS/device name/symlink/reparse/collision/bomb/unexpected executable/missing licence/wrong PE architecture.
- Crash at every transition, startup failure after pointer swap, successful automatic rollback, cleanup without deleting known-good data.
- CPU inference; Vulkan available; Vulkan unavailable with allowed fallback; Vulkan failure when fallback is forbidden.

Consumer completion evidence must link test logs and commit SHA in `makekosmos/local-ai-runtimes#1`; until then the runtime consumer acceptance gate remains open.
