import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


class OriginalsStudioInlineHandlerTests(unittest.TestCase):
    def test_narration_license_controls_and_handler_contract(self):
        completed = subprocess.run(
            ["node", "dashboard/admin.originals-license.test.mjs"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        self.assertEqual(
            completed.returncode,
            0,
            completed.stderr or completed.stdout,
        )


if __name__ == "__main__":
    unittest.main()
