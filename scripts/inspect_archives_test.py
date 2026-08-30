import hashlib
import json
import struct
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from scripts.inspect_archives import ArchiveError, validate_bom


def fake_pe_x64() -> bytes:
    data = bytearray(256)
    data[:2] = b"MZ"
    struct.pack_into("<I", data, 0x3C, 0x80)
    data[0x80:0x84] = b"PE\0\0"
    struct.pack_into("<H", data, 0x84, 0x8664)
    return bytes(data)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = self.root / "runtime.zip"

    def tearDown(self):
        self.temp.cleanup()

    def make_zip(self, members=None):
        members = members or {"bin/runtime.exe": fake_pe_x64(), "LICENSE.txt": b"MIT\n"}
        with zipfile.ZipFile(self.archive, "w", zipfile.ZIP_DEFLATED) as stream:
            for name, data in members.items():
                stream.writestr(name, data)

    def bom(self):
        blob = self.archive.read_bytes()
        return {
            "schema_version": 1,
            "sequence": 2,
            "generated_at": "2026-08-30T00:00:00Z",
            "repository_commit": "a" * 40,
            "release_tag": "runtime-v1.0.0",
            "signing_key_id": "runtime-test-1",
            "runtimes": [{
                "id": "test-runtime", "version": "1.0.0", "platform": "windows", "architecture": "x64", "backend": "cpu", "accelerator": "none",
                "entrypoints": ["bin/runtime.exe"],
                "archive": {"name": "runtime.zip", "url": "https://github.com/makekosmos/local-ai-runtimes/releases/download/runtime-v1.0.0/runtime.zip", "size": len(blob), "sha256": hashlib.sha256(blob).hexdigest(), "format": "zip", "files": ["bin/runtime.exe", "LICENSE.txt"]},
                "source": {"project": "example", "version": "1.0.0", "commit": "b" * 40},
                "build": {"recipe": "build.ps1", "toolchain": "msvc-19.40"},
                "licences": [{"spdx": "MIT", "path": "LICENSE.txt"}]
            }]
        }

    def test_accepts_exact_safe_archive(self):
        self.make_zip()
        self.assertEqual(validate_bom(self.bom(), self.root, now=datetime(2026, 8, 30, 0, 1, tzinfo=timezone.utc))[0]["files"], 2)

    def test_rejects_traversal(self):
        self.make_zip({"../runtime.exe": fake_pe_x64(), "LICENSE.txt": b"MIT"})
        bom = self.bom()
        bom["runtimes"][0]["archive"]["files"] = ["../runtime.exe", "LICENSE.txt"]
        bom["runtimes"][0]["entrypoints"] = ["../runtime.exe"]
        with self.assertRaisesRegex(ArchiveError, "unsafe"):
            validate_bom(bom, self.root)

    def test_rejects_windows_ads_and_device_names(self):
        for bad_name in ("bin/runtime.exe:evil", "NUL.txt"):
            self.make_zip({bad_name: fake_pe_x64(), "LICENSE.txt": b"MIT"})
            bom = self.bom()
            bom["runtimes"][0]["archive"]["files"] = [bad_name, "LICENSE.txt"]
            bom["runtimes"][0]["entrypoints"] = [bad_name]
            with self.assertRaisesRegex(ArchiveError, "unsafe"):
                validate_bom(bom, self.root)

    def test_rejects_hash_and_size_mismatch(self):
        self.make_zip()
        bom = self.bom()
        bom["runtimes"][0]["archive"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ArchiveError, "SHA-256"):
            validate_bom(bom, self.root)

    def test_rejects_missing_licence(self):
        self.make_zip({"bin/runtime.exe": fake_pe_x64()})
        bom = self.bom()
        bom["runtimes"][0]["archive"]["files"] = ["bin/runtime.exe"]
        with self.assertRaisesRegex(ArchiveError, "licence"):
            validate_bom(bom, self.root)

    def test_rejects_wrong_architecture(self):
        self.make_zip({"bin/runtime.exe": b"not-pe", "LICENSE.txt": b"MIT"})
        with self.assertRaisesRegex(ArchiveError, "PE"):
            validate_bom(self.bom(), self.root)

    def test_rejects_mutable_tag_and_local_archive_escape(self):
        self.make_zip()
        bom = self.bom()
        bom["release_tag"] = "latest"
        with self.assertRaisesRegex(ArchiveError, "versioned"):
            validate_bom(bom, self.root)
        bom = self.bom()
        bom["runtimes"][0]["archive"]["name"] = "..\\runtime.zip"
        bom["runtimes"][0]["archive"]["url"] = "https://github.com/makekosmos/local-ai-runtimes/releases/download/runtime-v1.0.0/..%5Cruntime.zip"
        with self.assertRaises(ArchiveError):
            validate_bom(bom, self.root)

    def test_rejects_special_device_member(self):
        info = zipfile.ZipInfo("device")
        info.create_system = 3
        info.external_attr = 0o020666 << 16
        with zipfile.ZipFile(self.archive, "w") as stream:
            stream.writestr(info, b"device")
            stream.writestr("bin/runtime.exe", fake_pe_x64())
            stream.writestr("LICENSE.txt", b"MIT")
        bom = self.bom()
        bom["runtimes"][0]["archive"]["files"].append("device")
        with self.assertRaisesRegex(ArchiveError, "special device"):
            validate_bom(bom, self.root)

    def test_rejects_duplicate_ids_and_schema_drift(self):
        self.make_zip()
        bom = self.bom()
        duplicate = json.loads(json.dumps(bom["runtimes"][0]))
        duplicate["version"] = "1.0.1"
        bom["runtimes"].append(duplicate)
        with self.assertRaisesRegex(ArchiveError, "duplicate runtime ID"):
            validate_bom(bom, self.root)
        bom = self.bom()
        bom["runtimes"][0]["unexpected"] = True
        with self.assertRaisesRegex(ArchiveError, "schema mismatch"):
            validate_bom(bom, self.root)

    def test_rejects_target_and_entrypoint_type_confusion(self):
        self.make_zip()
        bom = self.bom()
        bom["runtimes"][0]["architecture"] = "arm64"
        with self.assertRaisesRegex(ArchiveError, "platform/architecture"):
            validate_bom(bom, self.root)
        bom = self.bom()
        bom["runtimes"][0]["entrypoints"] = [123]
        with self.assertRaisesRegex(ArchiveError, "entrypoints"):
            validate_bom(bom, self.root)

    def test_rejects_boolean_sequence_non_string_build_and_non_zip_name(self):
        self.make_zip()
        bom = self.bom()
        bom["sequence"] = True
        with self.assertRaisesRegex(ArchiveError, "schema or sequence"):
            validate_bom(bom, self.root)
        bom = self.bom()
        bom["runtimes"][0]["build"]["recipe"] = {"command": "build"}
        with self.assertRaisesRegex(ArchiveError, "build provenance"):
            validate_bom(bom, self.root)
        bom = self.bom()
        bom["runtimes"][0]["archive"]["name"] = "runtime.bin"
        bom["runtimes"][0]["archive"]["url"] = "https://github.com/makekosmos/local-ai-runtimes/releases/download/runtime-v1.0.0/runtime.bin"
        with self.assertRaisesRegex(ArchiveError, "zip basename"):
            validate_bom(bom, self.root)


if __name__ == "__main__":
    unittest.main()
