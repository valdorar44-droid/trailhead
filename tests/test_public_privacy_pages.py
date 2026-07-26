import unittest

from fastapi.testclient import TestClient

from dashboard import server


class PublicPrivacyPagesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(server.app)

    def test_privacy_policy_discloses_active_categories_and_processors(self):
        response = self.client.get("/privacy")
        self.assertEqual(response.status_code, 200)
        body = response.text
        for expected in (
            "Trailhead does not sell personal information",
            "Location and Background Use",
            "Co-Pilot voice assistant",
            "Sentry Session Replay is disabled",
            "Mapbox",
            "OpenAI",
            "Firebase Cloud Messaging",
            "Third-party deferred referral attribution is disabled",
            "Production external traffic uses HTTPS encryption",
            'href="/delete-account"',
        ):
            self.assertIn(expected, body)

    def test_deletion_page_names_app_and_supports_in_app_and_web_requests(self):
        response = self.client.get("/delete-account")
        self.assertEqual(response.status_code, 200)
        body = response.text
        for expected in (
            "Delete a Trailhead account",
            "Delete in the app",
            "Profile",
            "Delete account",
            "Reauthenticate",
            "Request account deletion",
            "hello@gettrailhead.app",
            "What is deleted",
            "Limited retention",
        ):
            self.assertIn(expected, body)


if __name__ == "__main__":
    unittest.main()
