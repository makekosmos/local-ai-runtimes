#!/usr/bin/env python3
import argparse
import hashlib
import json
import stat
import zipfile
from pathlib import Path

COMMON = ("ggml-base.dll", "ggml-cpu.dll", "ggml.dll", "whisper.dll", "whisper-cli.exe", "whisper-server.exe")


def package_runtime(bin_dir: Path, licence: Path, output: Path, vulkan: bool) -> dict:
    names = (*COMMON, *(("ggml-vulkan.dll",) if vulkan else ()))
    files = [(f"Release/{name}", bin_dir / name) for name in names]
    files.append(("LICENSE.whisper.cpp.txt", licence))
    for archive_name, source in files:
        if not source.is_file():
            raise FileNotFoundError(f"missing runtime input: {archive_name}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for archive_name, source in sorted(files):
            info = zipfile.ZipInfo(archive_name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, source.read_bytes(), compresslevel=9)
    payload = output.read_bytes()
    return {
        "files": [name for name, _ in sorted(files)],
        "name": output.name,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size": len(payload),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bin", required=True, type=Path)
    parser.add_argument("--licence", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--vulkan", action="store_true")
    args = parser.parse_args()
    print(json.dumps(package_runtime(args.bin, args.licence, args.output, args.vulkan), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

