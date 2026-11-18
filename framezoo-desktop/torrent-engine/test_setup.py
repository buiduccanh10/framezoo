import subprocess
import sys
import tempfile
import unittest
from importlib.metadata import version
from pathlib import Path


class SetupVersionTest(unittest.TestCase):
    def test_existing_environment_must_match_requirements(self):
        script = (Path(__file__).parent.parent / "scripts/setup-torrent-engine.mjs").read_text()
        check = script.split('["-c", `', 1)[1].split('`, requirementsPath]', 1)[0]
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt") as requirements:
            requirements.write(f"libtorrent=={version('libtorrent')}\npyinstaller=={version('pyinstaller')}\n")
            requirements.flush()
            self.assertEqual(subprocess.run([sys.executable, "-c", check, requirements.name]).returncode, 0)
            requirements.seek(0)
            requirements.truncate()
            requirements.write("libtorrent==0.0.0\n")
            requirements.flush()
            self.assertNotEqual(subprocess.run([sys.executable, "-c", check, requirements.name]).returncode, 0)


if __name__ == "__main__":
    unittest.main()
