from pathlib import Path
import tomllib
import unittest


class RailwayConfigTests(unittest.TestCase):
    def test_healthcheck_uses_current_deploy_keys(self):
        config_path = Path(__file__).resolve().parents[1] / "railway.toml"
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
        deploy = config.get("deploy", {})

        self.assertEqual(deploy.get("healthcheckPath"), "/api/health")
        # Railway occasionally needs longer than its old 90-second window to
        # hydrate the production catalog. The deployed 300-second window is a
        # startup allowance, not a relaxation of the /api/health contract.
        self.assertEqual(deploy.get("healthcheckTimeout"), 300)
        self.assertNotIn("healthcheck", deploy)


if __name__ == "__main__":
    unittest.main()
