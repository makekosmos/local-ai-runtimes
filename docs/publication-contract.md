# Runtime publication contract

## Immutable inputs

The reviewed BOM is the sole build/publication input. It pins the repository commit, upstream source commit, release tag, sequence, timestamp, toolchain, recipe, complete archive allowlist, entrypoints, SPDX licence files, exact SHA-256, and exact byte size. Branch names, `latest` URLs, workflow source edits, and discovered files are forbidden inputs.

## Ordered gates

The production job MUST execute these gates in order and stop on the first failure:

1. Checkout the exact 40-character BOM commit and verify a clean tree.
2. Validate BOM schema, unique runtime coordinates, canonical UTC timestamp (not more than five minutes in the future), and `previous.sequence + 1`.
3. Resolve/import upstream material by the exact source commit and build with the declared recipe/toolchain.
4. Inspect each ZIP with `scripts/inspect_archives.py`; verify allowlisted paths, no traversal/symlinks/encryption/collisions/bombs, x64 PE entrypoints, licence files, SHA-256, and byte size.
5. On Windows, smoke-test `--version`, startup, clean shutdown, CPU inference, Vulkan capability, and documented CPU fallback. No production key is available to these steps.
6. Query GitHub and reject an existing tag or release. Fetch and verify the previous immutable signed manifest/envelope. Run `release-preflight.mjs`.
7. Only now enter a protected production signing environment. Materialize the key to a mode-restricted temporary file if the signer requires one; delete it on success, error, and cancellation. Sign the exact reviewed manifest bytes and immediately verify the resulting envelope with the trusted public key.
8. Create an immutable release, upload the already-hashed bytes, manifest, envelope, provenance statement, and BOM. Re-download all assets and verify hash/size/signature again before marking the run successful.

The release must fail closed if the hosting platform cannot guarantee immutability. A rerun uses a new tag and sequence; it never edits an existing release.

## Envelope

```json
{
  "schema_version": 1,
  "payload_type": "application/vnd.makekosmos.runtime-manifest+json",
  "payload_sha256": "64 lowercase hex characters",
  "payload_size": 1234,
  "key_id": "runtime-prod-YYYY-N",
  "signature": "base64 Ed25519 signature over the exact manifest bytes"
}
```

The envelope is not a JSON canonicalization scheme. The signature covers the exact downloaded bytes; any whitespace change invalidates it.

## Rollback

Releases are append-only. Rollback selects a previously signed, non-revoked manifest coordinate; it does not replace an asset or decrement accepted sequence state. A bad sequence is revoked by a later signed policy statement and a new sequence pointing to a corrected artifact.
