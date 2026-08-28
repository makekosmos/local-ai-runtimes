# Kosmos local AI runtimes

This repository is migrating managed runtime archives from Git history to
immutable, signed release assets. `runtimes.manifest.json` is the versioned
metadata contract for that migration.

The current entries are explicitly marked `legacy-git-asset`: their hashes,
source provenance, licences, and signing key are intentionally unset until the
archives are imported into a release. Consumers must not treat these entries
as verified release artifacts.

Validate the metadata without secrets:

```powershell
node scripts/validate-manifest.mjs
```

A release-status manifest will require SHA-256, exact size, source/build
provenance, licences, and a signing key ID. Cortex/Dictation installation must
verify HTTPS, signature, hash, size, safe archive paths, atomic extraction, and
rollback before execution.
