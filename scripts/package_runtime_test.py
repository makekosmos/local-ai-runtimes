import tempfile
import unittest
from pathlib import Path

from scripts.package_runtime import COMMON, package_runtime


class PackageRuntimeTests(unittest.TestCase):
    def test_archive_is_deterministic_and_complete(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            for name in (*COMMON, "ggml-vulkan.dll"):
                (bin_dir / name).write_bytes(name.encode())
            licence = root / "LICENSE"
            licence.write_text("MIT", encoding="utf-8")
            first = package_runtime(bin_dir, licence, root / "first.zip", True)
            second = package_runtime(bin_dir, licence, root / "second.zip", True)
            self.assertEqual(first["sha256"], second["sha256"])
            self.assertIn("Release/ggml-vulkan.dll", first["files"])
            self.assertIn("LICENSE.whisper.cpp.txt", first["files"])


if __name__ == "__main__":
    unittest.main()
