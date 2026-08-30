#!/usr/bin/env python3
"""Fail-closed ZIP and release-BOM verification using only the Python stdlib."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import struct
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath

SHA256 = re.compile(r"^[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
RELEASE_URL = re.compile(
    r"^https://github\.com/makekosmos/local-ai-runtimes/releases/download/([^/]+)/([^/]+)$"
)
VERSIONED_TAG = re.compile(r"^(?:[A-Za-z0-9][A-Za-z0-9._-]*-)?v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
RUNTIME_ID = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
MAX_ENTRIES = 256
MAX_UNCOMPRESSED = 1_000_000_000
MAX_RATIO = 250
WINDOWS_DEVICES = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


class ArchiveError(ValueError):
    pass


def exact_keys(value: dict, required: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != required:
        missing = required - set(value) if isinstance(value, dict) else required
        extra = set(value) - required if isinstance(value, dict) else set()
        raise ArchiveError(f"{label}: schema mismatch (missing={sorted(missing)}, extra={sorted(extra)})")


def safe_member(name: str) -> PurePosixPath:
    if not name or "\\" in name or "\x00" in name or ":" in name or name.startswith("/") or re.match(r"^[A-Za-z]:", name):
        raise ArchiveError(f"unsafe archive path: {name!r}")
    path = PurePosixPath(name)
    if any(part in ("", ".", "..") for part in path.parts):
        raise ArchiveError(f"unsafe archive path: {name!r}")
    for part in path.parts:
        stem = part.rstrip(" .").split(".", 1)[0].upper()
        if part != part.rstrip(" .") or stem in WINDOWS_DEVICES:
            raise ArchiveError(f"unsafe Windows archive path: {name!r}")
    return path


def pe_machine(stream, info: zipfile.ZipInfo) -> int:
    with stream.open(info, "r") as member:
        data = member.read(4096)
    if len(data) < 64 or data[:2] != b"MZ":
        raise ArchiveError(f"entrypoint is not a PE executable: {info.filename}")
    offset = struct.unpack_from("<I", data, 0x3C)[0]
    if offset + 6 > len(data) or data[offset : offset + 4] != b"PE\0\0":
        raise ArchiveError(f"entrypoint has invalid PE header: {info.filename}")
    return struct.unpack_from("<H", data, offset + 4)[0]


def inspect_archive(archive: Path, item: dict) -> dict:
    archive_name = item["archive"]["name"]
    name_path = safe_member(archive_name)
    if len(name_path.parts) != 1 or name_path.name != archive_name:
        raise ArchiveError(f"unsafe local archive name: {archive_name!r}")
    assets_root = archive.parent.resolve(strict=True)
    try:
        metadata = archive.lstat()
        resolved = archive.resolve(strict=True)
    except OSError as error:
        raise ArchiveError(f"{archive_name}: archive is unavailable") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode) or resolved.parent != assets_root:
        raise ArchiveError(f"{archive_name}: archive must be a regular no-follow file inside the assets directory")
    expected_size = item["archive"]["size"]
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    digestor = hashlib.sha256()
    with os.fdopen(os.open(archive, flags), "rb") as source:
        actual_size = os.fstat(source.fileno()).st_size
        if actual_size != expected_size:
            raise ArchiveError(f"{archive.name}: size {actual_size} != {expected_size}")
        if actual_size > MAX_UNCOMPRESSED:
            raise ArchiveError(f"{archive.name}: compressed size limit exceeded")
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digestor.update(chunk)
    digest = digestor.hexdigest()
    if digest != item["archive"]["sha256"]:
        raise ArchiveError(f"{archive.name}: SHA-256 mismatch")

    declared_files = item["archive"]["files"]
    if len({name.casefold() for name in declared_files}) != len(declared_files):
        raise ArchiveError(f"{archive.name}: duplicate/case-colliding declared file")
    allowed = set(declared_files)
    entrypoints = set(item["entrypoints"])
    licence_paths = {licence["path"] for licence in item["licences"]}
    seen: set[str] = set()
    total = 0
    with zipfile.ZipFile(archive) as stream:
        infos = stream.infolist()
        if not infos or len(infos) > MAX_ENTRIES:
            raise ArchiveError(f"{archive.name}: invalid entry count")
        for info in infos:
            path = safe_member(info.filename)
            normalized = path.as_posix().casefold()
            if normalized in seen:
                raise ArchiveError(f"{archive.name}: duplicate/case-colliding path {path}")
            seen.add(normalized)
            if info.flag_bits & 1:
                raise ArchiveError(f"{archive.name}: encrypted entries are forbidden")
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise ArchiveError(f"{archive.name}: symbolic links are forbidden")
            if any(check(mode) for check in (stat.S_ISCHR, stat.S_ISBLK, stat.S_ISFIFO, stat.S_ISSOCK)) or info.external_attr & 0x400:
                raise ArchiveError(f"{archive.name}: special device or reparse entries are forbidden")
            if info.is_dir():
                continue
            with stream.open(info, "r") as member:
                member.read(1)  # forces local-header/name/encryption validation
            if path.as_posix() not in allowed:
                raise ArchiveError(f"{archive.name}: unexpected file {path}")
            total += info.file_size
            if total > MAX_UNCOMPRESSED:
                raise ArchiveError(f"{archive.name}: uncompressed size limit exceeded")
            if info.compress_size == 0 and info.file_size > 0:
                raise ArchiveError(f"{archive.name}: invalid compression ratio")
            if info.compress_size and info.file_size / info.compress_size > MAX_RATIO:
                raise ArchiveError(f"{archive.name}: compression ratio limit exceeded")
        names = {info.filename for info in infos if not info.is_dir()}
        missing = allowed - names
        if missing:
            raise ArchiveError(f"{archive.name}: missing expected files: {sorted(missing)}")
        if not licence_paths or not licence_paths <= names:
            raise ArchiveError(f"{archive.name}: licence files are missing")
        by_name = {info.filename: info for info in infos}
        for entrypoint in entrypoints:
            if entrypoint not in by_name or pe_machine(stream, by_name[entrypoint]) != 0x8664:
                raise ArchiveError(f"{archive.name}: entrypoint is not Windows x64: {entrypoint}")
    return {"name": archive.name, "sha256": digest, "size": actual_size, "files": len(seen)}


def validate_bom(bom: dict, assets: Path, now: datetime | None = None) -> list[dict]:
    exact_keys(bom, {"schema_version", "sequence", "generated_at", "repository_commit", "release_tag", "signing_key_id", "runtimes"}, "BOM")
    if type(bom.get("schema_version")) is not int or bom["schema_version"] != 1 or type(bom.get("sequence")) is not int or bom["sequence"] <= 0:
        raise ArchiveError("invalid BOM schema or sequence")
    try:
        generated_at = datetime.strptime(bom["generated_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError) as error:
        raise ArchiveError("BOM generated_at must be canonical UTC seconds") from error
    current = now or datetime.now(timezone.utc)
    if generated_at > current + timedelta(minutes=5):
        raise ArchiveError("BOM generated_at is too far in the future")
    if not isinstance(bom.get("repository_commit"), str) or not COMMIT.fullmatch(bom["repository_commit"]):
        raise ArchiveError("BOM repository_commit must be a full commit SHA")
    if not isinstance(bom.get("signing_key_id"), str) or not bom["signing_key_id"].strip():
        raise ArchiveError("BOM signing_key_id is required")
    tag = bom.get("release_tag")
    if not isinstance(tag, str) or not VERSIONED_TAG.fullmatch(tag):
        raise ArchiveError("BOM release_tag must be an immutable versioned tag")
    results = []
    coordinates: set[str] = set()
    runtime_ids: set[str] = set()
    for item in bom.get("runtimes", []):
        exact_keys(item, {"id", "version", "platform", "architecture", "backend", "accelerator", "entrypoints", "archive", "source", "build", "licences"}, "runtime")
        runtime_id = item.get("id")
        if not isinstance(runtime_id, str) or not RUNTIME_ID.fullmatch(runtime_id):
            raise ArchiveError("runtime ID is invalid")
        if runtime_id in runtime_ids:
            raise ArchiveError(f"duplicate runtime ID: {runtime_id}")
        runtime_ids.add(runtime_id)
        if not isinstance(item.get("version"), str) or not SEMVER.fullmatch(item["version"]):
            raise ArchiveError(f"{runtime_id}: semantic version is required")
        if item.get("platform") != "windows" or item.get("architecture") != "x64":
            raise ArchiveError(f"{runtime_id}: unsupported platform/architecture")
        if item.get("backend") not in {"cpu", "vulkan"} or item.get("accelerator") not in {"none", "vulkan"}:
            raise ArchiveError(f"{runtime_id}: unsupported backend/accelerator")
        if (item["backend"] == "cpu") != (item["accelerator"] == "none"):
            raise ArchiveError(f"{runtime_id}: backend/accelerator mismatch")
        entrypoints = item.get("entrypoints")
        if not isinstance(entrypoints, list) or not entrypoints or any(not isinstance(value, str) for value in entrypoints):
            raise ArchiveError(f"{runtime_id}: entrypoints are required")
        if len({value.casefold() for value in entrypoints}) != len(entrypoints):
            raise ArchiveError(f"{runtime_id}: duplicate entrypoints")
        for entrypoint in entrypoints:
            safe_member(entrypoint)
        coordinate = f"{item.get('id')}@{item.get('version')}:{item.get('platform')}:{item.get('architecture')}:{item.get('backend')}"
        if coordinate in coordinates:
            raise ArchiveError(f"duplicate BOM coordinate: {coordinate}")
        coordinates.add(coordinate)
        archive = item.get("archive", {})
        exact_keys(archive, {"name", "url", "sha256", "size", "format", "files"}, f"{coordinate}: archive")
        if not isinstance(archive.get("name"), str) or not archive["name"].lower().endswith(".zip"):
            raise ArchiveError(f"{coordinate}: archive name must be a .zip basename")
        if archive.get("format") != "zip" or not isinstance(archive.get("files"), list) or not archive["files"]:
            raise ArchiveError(f"{coordinate}: ZIP format and complete file allowlist required")
        for filename in archive["files"]:
            if not isinstance(filename, str):
                raise ArchiveError(f"{coordinate}: archive file path must be a string")
            safe_member(filename)
        match = RELEASE_URL.fullmatch(archive.get("url", "")) if isinstance(archive.get("url"), str) else None
        if not match or match.group(1) != tag or match.group(2) != archive.get("name"):
            raise ArchiveError(f"{coordinate}: release URL/tag/name mismatch")
        if not isinstance(archive.get("sha256"), str) or not SHA256.fullmatch(archive["sha256"]) or type(archive.get("size")) is not int or archive["size"] <= 0:
            raise ArchiveError(f"{coordinate}: exact hash and size required")
        source = item.get("source", {})
        exact_keys(source, {"project", "version", "commit"}, f"{coordinate}: source")
        if not all(isinstance(source.get(key), str) and source[key].strip() for key in ("project", "version")):
            raise ArchiveError(f"{coordinate}: source project/version required")
        if not isinstance(source.get("commit"), str) or not COMMIT.fullmatch(source["commit"]):
            raise ArchiveError(f"{coordinate}: immutable source commit required")
        build = item.get("build", {})
        exact_keys(build, {"recipe", "toolchain"}, f"{coordinate}: build")
        if not all(isinstance(build.get(key), str) and build[key].strip() for key in ("recipe", "toolchain")):
            raise ArchiveError(f"{coordinate}: build provenance required")
        licences = item.get("licences", [])
        if not isinstance(licences, list) or not licences:
            raise ArchiveError(f"{coordinate}: SPDX licence metadata required")
        for licence in licences:
            exact_keys(licence, {"spdx", "path"}, f"{coordinate}: licence")
            if not isinstance(licence.get("spdx"), str) or not licence["spdx"].strip() or not isinstance(licence.get("path"), str):
                raise ArchiveError(f"{coordinate}: SPDX licence metadata required")
            safe_member(licence["path"])
        results.append(inspect_archive(assets / archive["name"], item))
    if not results:
        raise ArchiveError("BOM must contain at least one runtime")
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bom", required=True, type=Path)
    parser.add_argument("--assets", required=True, type=Path)
    args = parser.parse_args()
    try:
        bom = json.loads(args.bom.read_text(encoding="utf-8"))
        print(json.dumps(validate_bom(bom, args.assets), sort_keys=True, separators=(",", ":")))
        return 0
    except (ArchiveError, KeyError, OSError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
