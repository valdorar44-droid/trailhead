from pathlib import Path
import tomllib
import unittest


class RailwayConfigTests(unittest.TestCase):
    def test_healthcheck_uses_current_deploy_keys(self):
        config_path = Path(__file__).resolve().parents[1] / "railway.toml"
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
        deploy = config.get("deploy", {})

        self.assertEqual(deploy.get("healthcheckPath"), "/api/health")
        self.assertEqual(deploy.get("healthcheckTimeout"), 90)
        self.assertNotIn("healthcheck", deploy)


if __name__ == "__main__":
    unittest.main()
