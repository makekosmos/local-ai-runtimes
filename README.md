# Kosmos local AI runtimes

This repository is migrating managed runtime archives from Git history to
immutable, signed release assets. `runtimes.manifest.json` is the versioned
metadata contract for that migration.

The current entries are explicitly marked `legacy-git-asset`; their hashes,
source provenance, licences, and signing key are intentionally unset until the
archives are imported into a release. Consumers must not treat these entries
as verified release artifacts or execute them.

## Secret-free validation

```powershell
node scripts/validate-manifest.mjs
node --test scripts/validate-manifest.test.mjs
node scripts/dry-run.mjs
```

The dry-run signs the exact manifest bytes with an ephemeral Ed25519 key and
never publishes or accesses a production secret. A release-status manifest
requires an immutable GitHub release URL, SHA-256, exact size, Windows/x64
target, source project/version/40-character commit, build recipe/toolchain,
licences, and signing key ID. The signed envelope binds the manifest hash.

## Publication and update contract

Publication must import archives from an immutable upstream source, inspect
ZIP paths and permissions, verify the expected executable/architecture and
licence files, calculate hash/size, then sign the manifest before exposing the
release asset. Cortex/Dictation must verify HTTPS, envelope signature, hash,
size, and safe archive paths before execution; extraction is atomic and a
failed update quarantines partial files while retaining the previous
known-good runtime for rollback.

Existing legacy URLs remain valid during the migration window. New releases
use immutable versioned release URLs and must not add binary archives to the
default branch. Key rotation changes the signing key ID, public-key allowlist,
and manifest documentation together; revoke compromised keys for new releases
while retaining historical verification under the original key.
