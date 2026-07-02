"""SQLite WAL store. Schema + queries."""
from __future__ import annotations
import sqlite3, json, time, math, hashlib, random, secrets, re
from config.settings import settings

# Report expiry by type (seconds)
EXPIRY_BY_TYPE = {
    'police':       2  * 3600,
    'cell_signal':  24 * 3600,
    'wildlife':     24 * 3600,
    'water':        3  * 86400,
    'trail_condition': 7 * 86400,
    'road_condition': 7 * 86400,
    'hazard':       7  * 86400,
    'campsite':     14 * 86400,
    'closure':      30 * 86400,
    'road_closure': 30 * 86400,
    'fuel':         12 * 3600,
    'service':      30 * 86400,
    'viewpoint':    90 * 86400,
    'traffic':      6  * 3600,
    'weather':      12 * 3600,
    'fire':         14 * 86400,
    'smoke':        12 * 3600,
}

def _conn() -> sqlite3.Connection:
    db = sqlite3.connect(settings.db_path, check_same_thread=False, timeout=30.0)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=30000")
    db.row_factory = sqlite3.Row
    return db

def init_db():
    db = _conn()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS trips (
            id          TEXT PRIMARY KEY,
            user_id     INTEGER,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER,
            request     TEXT NOT NULL,
            plan        TEXT NOT NULL,
            route_geometry TEXT,
            builder_state  TEXT,
            source      TEXT,
            version     INTEGER NOT NULL DEFAULT 1,
            audio_guide TEXT
        );
        CREATE TABLE IF NOT EXISTS weather_cache (
            cache_key   TEXT PRIMARY KEY,
            fetched_at  INTEGER NOT NULL,
            data        TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS campsite_cache (
            cache_key   TEXT PRIMARY KEY,
            fetched_at  INTEGER NOT NULL,
            data        TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS gas_cache (
            cache_key   TEXT PRIMARY KEY,
            fetched_at  INTEGER NOT NULL,
            data        TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS route_cache (
            cache_key    TEXT PRIMARY KEY,
            fetched_at   INTEGER NOT NULL,
            request_json TEXT NOT NULL,
            data         TEXT NOT NULL,
            hit_count    INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS community_pins (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER,
            lat          REAL NOT NULL,
            lng          REAL NOT NULL,
            name         TEXT NOT NULL,
            type         TEXT NOT NULL DEFAULT 'camp',
            description  TEXT,
            details      TEXT,
            land_type    TEXT,
            submitted_at INTEGER NOT NULL,
            upvotes      INTEGER NOT NULL DEFAULT 0,
            downvotes    INTEGER NOT NULL DEFAULT 0,
            hidden       INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS pin_update_suggestions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            pin_id      INTEGER NOT NULL,
            pin_name    TEXT NOT NULL,
            user_id     INTEGER,
            username    TEXT,
            field       TEXT NOT NULL,
            value       TEXT NOT NULL,
            note        TEXT,
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS stripe_purchases (
            session_id  TEXT PRIMARY KEY,
            user_id     INTEGER NOT NULL,
            credits     INTEGER NOT NULL,
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_store_subscriptions (
            original_transaction_id TEXT PRIMARY KEY,
            transaction_id          TEXT,
            user_id                 INTEGER NOT NULL REFERENCES users(id),
            product_id              TEXT NOT NULL,
            environment             TEXT,
            expires_at              INTEGER,
            status                  TEXT NOT NULL DEFAULT 'active',
            updated_at              INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS explore_story_overrides (
            place_id      TEXT PRIMARY KEY,
            title         TEXT,
            story         TEXT,
            summary       TEXT,
            hook          TEXT,
            notes         TEXT,
            updated_by    INTEGER,
            updated_at    INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            email                    TEXT UNIQUE NOT NULL,
            username                 TEXT UNIQUE NOT NULL,
            password_hash            TEXT NOT NULL,
            credits                  INTEGER NOT NULL DEFAULT 0,
            referral_code            TEXT UNIQUE,
            referred_by              INTEGER,
            report_streak            INTEGER NOT NULL DEFAULT 0,
            last_report_date         TEXT,
            reporting_restricted_until INTEGER,
            flagged_report_count     INTEGER NOT NULL DEFAULT 0,
            is_admin                 INTEGER NOT NULL DEFAULT 0,
            email_verified           INTEGER NOT NULL DEFAULT 0,
            email_verify_token       TEXT,
            email_verify_sent_at     INTEGER,
            password_reset_token     TEXT,
            password_reset_sent_at   INTEGER,
            password_reset_expires_at INTEGER,
            public_profile_visible   INTEGER NOT NULL DEFAULT 1,
            contributor_title        TEXT,
            contributor_bio          TEXT,
            contributor_avatar_color TEXT,
            auth_provider            TEXT,
            apple_sub                TEXT,
            google_sub               TEXT,
            created_at               INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS credit_transactions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            amount      INTEGER NOT NULL,
            reason      TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS reports (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            lat           REAL NOT NULL,
            lng           REAL NOT NULL,
            type          TEXT NOT NULL,
            subtype       TEXT,
            description   TEXT,
            severity      TEXT DEFAULT 'moderate',
            upvotes       INTEGER NOT NULL DEFAULT 0,
            downvotes     INTEGER NOT NULL DEFAULT 0,
            confirmations INTEGER NOT NULL DEFAULT 0,
            has_photo     INTEGER NOT NULL DEFAULT 0,
            photo_data    TEXT,
            created_at    INTEGER NOT NULL,
            expires_at    INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS referrals (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id     INTEGER NOT NULL,
            referred_email  TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending',
            created_at      INTEGER NOT NULL,
            converted_at    INTEGER,
            FOREIGN KEY (referrer_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS trail_dna (
            session_id  TEXT PRIMARY KEY,
            profile     TEXT NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conversations (
            session_id  TEXT PRIMARY KEY,
            messages    TEXT NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bug_reports (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER,
            username    TEXT,
            title       TEXT NOT NULL,
            description TEXT NOT NULL,
            app_version TEXT,
            category    TEXT NOT NULL DEFAULT 'bug',
            source_surface TEXT,
            screenshot_data TEXT,
            screenshot_content_type TEXT,
            ai_context_json TEXT,
            status      TEXT NOT NULL DEFAULT 'open',
            credits_awarded INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS camp_fullness (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            camp_id      TEXT NOT NULL UNIQUE,
            camp_name    TEXT,
            lat          REAL NOT NULL,
            lng          REAL NOT NULL,
            status       TEXT NOT NULL DEFAULT 'full',
            reporter_id  INTEGER REFERENCES users(id),
            confirmations INTEGER NOT NULL DEFAULT 0,
            disputes     INTEGER NOT NULL DEFAULT 0,
            reported_at  INTEGER NOT NULL,
            expires_at   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS camp_fullness_votes (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            camp_id   TEXT NOT NULL,
            user_id   INTEGER NOT NULL REFERENCES users(id),
            vote      TEXT NOT NULL,
            voted_at  INTEGER NOT NULL,
            UNIQUE(camp_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS analytics_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER,
            session_id  TEXT,
            event_type  TEXT NOT NULL,
            event_data  TEXT,
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS camp_briefs (
            facility_id  TEXT PRIMARY KEY,
            brief_json   TEXT NOT NULL,
            generated_at INTEGER NOT NULL,
            view_count   INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS camp_profile_overrides (
            camp_id     TEXT PRIMARY KEY,
            data        TEXT NOT NULL,
            updated_by  INTEGER,
            updated_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS camp_edit_suggestions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            camp_id     TEXT NOT NULL,
            camp_name   TEXT NOT NULL,
            lat         REAL NOT NULL,
            lng         REAL NOT NULL,
            user_id     INTEGER,
            username    TEXT,
            field       TEXT NOT NULL,
            value       TEXT NOT NULL,
            note        TEXT,
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS report_interactions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id  INTEGER NOT NULL,
            user_id    INTEGER NOT NULL REFERENCES users(id),
            action     TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(report_id, user_id, action)
        );
        CREATE TABLE IF NOT EXISTS camp_field_reports (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            camp_id          TEXT NOT NULL,
            camp_name        TEXT NOT NULL,
            lat              REAL NOT NULL,
            lng              REAL NOT NULL,
            user_id          INTEGER NOT NULL REFERENCES users(id),
            username         TEXT NOT NULL,
            rig_label        TEXT,
            visited_date     TEXT NOT NULL,
            sentiment        TEXT NOT NULL,
            access_condition TEXT NOT NULL,
            crowd_level      TEXT NOT NULL,
            tags             TEXT NOT NULL DEFAULT '[]',
            note             TEXT,
            photo_data       TEXT,
            credits_earned   INTEGER NOT NULL DEFAULT 0,
            created_at       INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS camp_comments (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            camp_id     TEXT NOT NULL,
            camp_name   TEXT NOT NULL,
            lat         REAL NOT NULL,
            lng         REAL NOT NULL,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            username    TEXT NOT NULL,
            body        TEXT NOT NULL,
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS places (
            trailhead_place_id TEXT PRIMARY KEY,
            source             TEXT NOT NULL,
            source_priority    INTEGER NOT NULL DEFAULT 50,
            source_label       TEXT,
            source_place_id    TEXT,
            name               TEXT NOT NULL,
            lat                REAL NOT NULL,
            lng                REAL NOT NULL,
            category           TEXT,
            subtype            TEXT,
            official_url       TEXT,
            provider_ids       TEXT NOT NULL DEFAULT '{}',
            provenance         TEXT NOT NULL DEFAULT '{}',
            hero_photo_url     TEXT,
            display_metadata   TEXT NOT NULL DEFAULT '{}',
            last_seen          INTEGER NOT NULL,
            created_at         INTEGER NOT NULL,
            updated_at         INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dispersed_site_leads (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_key           TEXT NOT NULL UNIQUE,
            source             TEXT NOT NULL DEFAULT 'private_lead',
            source_batch       TEXT NOT NULL,
            source_record_hash TEXT NOT NULL,
            lat                REAL NOT NULL,
            lng                REAL NOT NULL,
            rounded_lat        REAL NOT NULL,
            rounded_lng        REAL NOT NULL,
            category           TEXT NOT NULL,
            status             TEXT NOT NULL DEFAULT 'lead',
            confidence         INTEGER NOT NULL DEFAULT 25,
            source_verified_at TEXT,
            review_flags       TEXT NOT NULL DEFAULT '[]',
            canonical_camp_id  TEXT,
            profile_data       TEXT NOT NULL DEFAULT '{}',
            reviewed_by        INTEGER,
            reviewed_at        INTEGER,
            rejection_reason   TEXT,
            published_by       INTEGER,
            published_at       INTEGER,
            provenance         TEXT NOT NULL DEFAULT '{}',
            imported_at        INTEGER NOT NULL,
            updated_at         INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dispersed_site_lead_photos (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_key           TEXT NOT NULL,
            user_id            INTEGER NOT NULL REFERENCES users(id),
            username           TEXT NOT NULL,
            caption            TEXT,
            photo_data         TEXT NOT NULL,
            content_type       TEXT NOT NULL DEFAULT 'image/jpeg',
            status             TEXT NOT NULL DEFAULT 'private',
            published_photo_id INTEGER,
            created_at         INTEGER NOT NULL,
            FOREIGN KEY (lead_key) REFERENCES dispersed_site_leads(lead_key)
        );
        CREATE TABLE IF NOT EXISTS place_comments (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            trailhead_place_id  TEXT NOT NULL,
            user_id             INTEGER NOT NULL REFERENCES users(id),
            username            TEXT NOT NULL,
            body                TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'visible',
            created_at          INTEGER NOT NULL,
            FOREIGN KEY (trailhead_place_id) REFERENCES places(trailhead_place_id)
        );
        CREATE TABLE IF NOT EXISTS place_photos (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            trailhead_place_id  TEXT NOT NULL,
            user_id             INTEGER NOT NULL REFERENCES users(id),
            username            TEXT NOT NULL,
            comment_id          INTEGER,
            object_key          TEXT,
            url                 TEXT,
            caption             TEXT,
            source              TEXT NOT NULL DEFAULT 'user',
            status              TEXT NOT NULL DEFAULT 'visible',
            content_type        TEXT NOT NULL DEFAULT 'image/jpeg',
            photo_data          TEXT,
            credits_awarded     INTEGER NOT NULL DEFAULT 0,
            created_at          INTEGER NOT NULL,
            FOREIGN KEY (trailhead_place_id) REFERENCES places(trailhead_place_id),
            FOREIGN KEY (comment_id) REFERENCES place_comments(id)
        );
        CREATE TABLE IF NOT EXISTS place_edit_suggestions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            trailhead_place_id  TEXT NOT NULL,
            place_name          TEXT NOT NULL,
            user_id             INTEGER,
            username            TEXT,
            field               TEXT NOT NULL,
            value               TEXT NOT NULL,
            note                TEXT,
            status              TEXT NOT NULL DEFAULT 'pending',
            created_at          INTEGER NOT NULL,
            FOREIGN KEY (trailhead_place_id) REFERENCES places(trailhead_place_id)
        );
        CREATE TABLE IF NOT EXISTS place_reservation_alerts (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            trailhead_place_id  TEXT NOT NULL,
            user_id             INTEGER NOT NULL REFERENCES users(id),
            start_date          TEXT,
            end_date            TEXT,
            party_size          INTEGER,
            source              TEXT,
            booking_url         TEXT,
            status              TEXT NOT NULL DEFAULT 'active',
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            UNIQUE(trailhead_place_id, user_id, start_date, end_date),
            FOREIGN KEY (trailhead_place_id) REFERENCES places(trailhead_place_id)
        );
        CREATE TABLE IF NOT EXISTS viator_bookings (
            id                  TEXT PRIMARY KEY,
            user_id             INTEGER NOT NULL REFERENCES users(id),
            product_code        TEXT NOT NULL,
            product_title       TEXT,
            travel_date         TEXT,
            currency            TEXT NOT NULL DEFAULT 'USD',
            amount              REAL,
            status              TEXT NOT NULL DEFAULT 'intent',
            booking_reference   TEXT,
            cart_id             TEXT,
            hold_expires_at     TEXT,
            payment_solution    TEXT NOT NULL DEFAULT 'iframe',
            booking_url         TEXT,
            voucher_url         TEXT,
            provider_payload    TEXT NOT NULL DEFAULT '{}',
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS trail_field_reports (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            trail_id         TEXT NOT NULL,
            trail_name       TEXT NOT NULL,
            lat              REAL NOT NULL,
            lng              REAL NOT NULL,
            user_id          INTEGER NOT NULL REFERENCES users(id),
            username         TEXT NOT NULL,
            rig_label        TEXT,
            visited_date     TEXT NOT NULL,
            sentiment        TEXT NOT NULL,
            access_condition TEXT NOT NULL,
            crowd_level      TEXT NOT NULL,
            tags             TEXT NOT NULL DEFAULT '[]',
            note             TEXT,
            photo_data       TEXT,
            credits_earned   INTEGER NOT NULL DEFAULT 0,
            created_at       INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS trail_profiles (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            summary      TEXT,
            description  TEXT,
            lat          REAL NOT NULL,
            lng          REAL NOT NULL,
            length_mi    REAL,
            difficulty   TEXT,
            activities   TEXT NOT NULL DEFAULT '[]',
            land_manager TEXT,
            geometry     TEXT,
            trailheads   TEXT NOT NULL DEFAULT '[]',
            official_url TEXT,
            photos       TEXT NOT NULL DEFAULT '[]',
            source       TEXT NOT NULL,
            source_label TEXT NOT NULL,
            provenance   TEXT NOT NULL DEFAULT '{}',
            last_checked INTEGER NOT NULL,
            admin_edited INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS trail_edit_suggestions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            trail_id    TEXT NOT NULL,
            trail_name  TEXT NOT NULL,
            user_id     INTEGER,
            username    TEXT,
            field       TEXT NOT NULL,
            value       TEXT NOT NULL,
            note        TEXT,
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS offline_downloads (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            asset_type  TEXT NOT NULL,
            region_id   TEXT NOT NULL,
            cost         INTEGER NOT NULL DEFAULT 0,
            free_used    INTEGER NOT NULL DEFAULT 0,
            created_at   INTEGER NOT NULL,
            UNIQUE(user_id, asset_type, region_id)
        );
        CREATE TABLE IF NOT EXISTS contest_events (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL REFERENCES users(id),
            points       INTEGER NOT NULL,
            source_type  TEXT NOT NULL,
            source_id    TEXT NOT NULL,
            label        TEXT NOT NULL,
            period_month TEXT NOT NULL,
            period_year  TEXT NOT NULL,
            created_at   INTEGER NOT NULL,
            UNIQUE(user_id, source_type, source_id)
        );
        CREATE TABLE IF NOT EXISTS contest_entries (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            period_month TEXT NOT NULL,
            period_year  TEXT NOT NULL,
            entry_type  TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            UNIQUE(user_id, period_month)
        );
        CREATE TABLE IF NOT EXISTS contest_awards (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            prize_type      TEXT NOT NULL,
            period_month    TEXT,
            period_year     TEXT NOT NULL,
            winner_user_id  INTEGER REFERENCES users(id),
            winner_username TEXT,
            points_snapshot INTEGER NOT NULL DEFAULT 0,
            entry_count     INTEGER NOT NULL DEFAULT 0,
            prize_label     TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'selected',
            notes           TEXT,
            awarded_by      INTEGER REFERENCES users(id),
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS contributor_badges (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            badge_id    TEXT NOT NULL,
            label       TEXT NOT NULL,
            description TEXT,
            granted_by  INTEGER REFERENCES users(id),
            created_at  INTEGER NOT NULL,
            UNIQUE(user_id, badge_id)
        );
        CREATE TABLE IF NOT EXISTS map_contributor_applications (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            username    TEXT,
            experience  TEXT,
            regions     TEXT,
            sample_note TEXT,
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS extreme_demo_sessions (
            session_id  TEXT PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            surface     TEXT NOT NULL,
            trip_id     TEXT,
            status      TEXT NOT NULL DEFAULT 'active',
            started_at  INTEGER NOT NULL,
            ended_at    INTEGER,
            expires_at  INTEGER NOT NULL,
            metadata    TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS extreme_ledger_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            event_type  TEXT NOT NULL,
            surface     TEXT,
            trip_id     TEXT,
            event_data  TEXT NOT NULL DEFAULT '{}',
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS extreme_trip_metadata (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL REFERENCES users(id),
            trip_id      TEXT NOT NULL,
            checkpoints  TEXT NOT NULL DEFAULT '[]',
            trip_memory  TEXT NOT NULL DEFAULT '{}',
            updated_at   INTEGER NOT NULL,
            UNIQUE(user_id, trip_id)
        );
        CREATE TABLE IF NOT EXISTS extreme_copilot_actions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL REFERENCES users(id),
            session_id   TEXT,
            trip_id      TEXT,
            command      TEXT NOT NULL,
            action_type  TEXT NOT NULL,
            status       TEXT NOT NULL DEFAULT 'staged',
            payload      TEXT NOT NULL DEFAULT '{}',
            created_at   INTEGER NOT NULL,
            confirmed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS extreme_admin_config (
            config_key  TEXT PRIMARY KEY,
            value_json  TEXT NOT NULL,
            updated_by  INTEGER REFERENCES users(id),
            updated_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS push_campaigns (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_key  TEXT NOT NULL UNIQUE,
            campaign_type TEXT NOT NULL,
            audience_json TEXT NOT NULL DEFAULT '{}',
            title         TEXT NOT NULL,
            body          TEXT NOT NULL,
            deeplink      TEXT,
            payload_json  TEXT NOT NULL DEFAULT '{}',
            status        TEXT NOT NULL DEFAULT 'draft',
            created_by    INTEGER REFERENCES users(id),
            estimated_recipients INTEGER NOT NULL DEFAULT 0,
            sent_count    INTEGER NOT NULL DEFAULT 0,
            failed_count  INTEGER NOT NULL DEFAULT 0,
            test_only     INTEGER NOT NULL DEFAULT 0,
            created_at    INTEGER NOT NULL,
            sent_at       INTEGER
        );
        CREATE TABLE IF NOT EXISTS push_campaign_deliveries (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id   INTEGER NOT NULL REFERENCES push_campaigns(id) ON DELETE CASCADE,
            user_id       INTEGER REFERENCES users(id),
            push_token    TEXT NOT NULL,
            delivery_status TEXT NOT NULL DEFAULT 'queued',
            response_json TEXT,
            error_text    TEXT,
            created_at    INTEGER NOT NULL,
            sent_at       INTEGER
        );
        CREATE TABLE IF NOT EXISTS support_threads (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL REFERENCES users(id),
            category      TEXT NOT NULL DEFAULT 'support',
            subject       TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'open',
            opened_by     TEXT NOT NULL DEFAULT 'user',
            created_by_admin INTEGER REFERENCES users(id),
            last_message_at INTEGER NOT NULL,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS support_messages (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id     INTEGER NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
            sender_role   TEXT NOT NULL,
            sender_user_id INTEGER REFERENCES users(id),
            sender_admin_id INTEGER REFERENCES users(id),
            body          TEXT NOT NULL,
            meta_json     TEXT NOT NULL DEFAULT '{}',
            created_at    INTEGER NOT NULL,
            read_by_user_at INTEGER,
            read_by_admin_at INTEGER
        );
    """)
    # Performance indexes (IF NOT EXISTS is safe to re-run)
    for idx_sql in [
        "CREATE INDEX IF NOT EXISTS idx_reports_geo ON reports(lat, lng, expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_reports_user_type ON reports(user_id, type, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_pins_geo ON community_pins(lat, lng)",
        "CREATE INDEX IF NOT EXISTS idx_pins_user_time ON community_pins(user_id, submitted_at)",
        "CREATE INDEX IF NOT EXISTS idx_pin_update_suggestions_status ON pin_update_suggestions(status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_trail_field_reports_trail ON trail_field_reports(trail_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_trail_profiles_geo ON trail_profiles(lat, lng)",
        "CREATE INDEX IF NOT EXISTS idx_trail_edit_suggestions_status ON trail_edit_suggestions(status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_places_geo ON places(lat, lng)",
        "CREATE INDEX IF NOT EXISTS idx_places_source ON places(source, source_place_id)",
        "CREATE INDEX IF NOT EXISTS idx_dispersed_site_leads_geo ON dispersed_site_leads(lat, lng, status)",
        "CREATE INDEX IF NOT EXISTS idx_dispersed_site_leads_batch ON dispersed_site_leads(source_batch, status)",
        "CREATE INDEX IF NOT EXISTS idx_dispersed_site_leads_category ON dispersed_site_leads(category, status, source_verified_at)",
        "CREATE INDEX IF NOT EXISTS idx_dispersed_site_lead_photos_lead ON dispersed_site_lead_photos(lead_key, status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_place_comments_place ON place_comments(trailhead_place_id, status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_place_photos_place ON place_photos(trailhead_place_id, status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_place_edit_suggestions_status ON place_edit_suggestions(status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_place_reservation_alerts_user ON place_reservation_alerts(user_id, status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_fullness_geo ON camp_fullness(lat, lng, status, expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_credits_user ON credit_transactions(user_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_analytics_session ON analytics_events(session_id, event_type)",
        "CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_route_cache_time ON route_cache(fetched_at)",
        "CREATE INDEX IF NOT EXISTS idx_offline_downloads_user ON offline_downloads(user_id, asset_type, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_users_email_verify_token ON users(email_verify_token)",
        "CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON users(password_reset_token)",
        "CREATE INDEX IF NOT EXISTS idx_contest_events_period ON contest_events(period_year, period_month, points)",
        "CREATE INDEX IF NOT EXISTS idx_contest_events_user_period ON contest_events(user_id, period_year, period_month)",
        "CREATE INDEX IF NOT EXISTS idx_contest_entries_period ON contest_entries(period_month, entry_type)",
        "CREATE INDEX IF NOT EXISTS idx_contest_awards_period ON contest_awards(period_year, period_month, prize_type)",
        "CREATE INDEX IF NOT EXISTS idx_contributor_badges_user ON contributor_badges(user_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_map_contributor_applications_status ON map_contributor_applications(status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_extreme_sessions_user ON extreme_demo_sessions(user_id, started_at)",
        "CREATE INDEX IF NOT EXISTS idx_extreme_ledger_session ON extreme_ledger_events(session_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_extreme_trip_metadata_user ON extreme_trip_metadata(user_id, updated_at)",
        "CREATE INDEX IF NOT EXISTS idx_extreme_copilot_user ON extreme_copilot_actions(user_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_push_campaigns_created ON push_campaigns(created_at, status)",
        "CREATE INDEX IF NOT EXISTS idx_push_campaign_deliveries_campaign ON push_campaign_deliveries(campaign_id, delivery_status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_support_threads_user ON support_threads(user_id, last_message_at, status)",
        "CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, created_at)",
    ]:
        try:
            db.execute(idx_sql)
        except Exception:
            pass

    # Non-destructive column additions for existing deployments
    for sql in [
        "ALTER TABLE users ADD COLUMN report_streak INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN last_report_date TEXT",
        "ALTER TABLE users ADD COLUMN reporting_restricted_until INTEGER",
        "ALTER TABLE users ADD COLUMN flagged_report_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE reports ADD COLUMN confirmations INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE reports ADD COLUMN has_photo INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE reports ADD COLUMN photo_data TEXT",
        "ALTER TABLE reports ADD COLUMN downvotes INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE community_pins ADD COLUMN downvotes INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE community_pins ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE community_pins ADD COLUMN details TEXT",
        "ALTER TABLE dispersed_site_leads ADD COLUMN profile_data TEXT NOT NULL DEFAULT '{}'",
        "ALTER TABLE dispersed_site_leads ADD COLUMN published_by INTEGER",
        "ALTER TABLE dispersed_site_leads ADD COLUMN published_at INTEGER",
        """CREATE TABLE IF NOT EXISTS dispersed_site_lead_photos (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_key           TEXT NOT NULL,
            user_id            INTEGER NOT NULL REFERENCES users(id),
            username           TEXT NOT NULL,
            caption            TEXT,
            photo_data         TEXT NOT NULL,
            content_type       TEXT NOT NULL DEFAULT 'image/jpeg',
            status             TEXT NOT NULL DEFAULT 'private',
            published_photo_id INTEGER,
            created_at         INTEGER NOT NULL,
            FOREIGN KEY (lead_key) REFERENCES dispersed_site_leads(lead_key)
        )""",
        """CREATE TABLE IF NOT EXISTS pin_interactions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            pin_id     INTEGER NOT NULL,
            user_id    INTEGER NOT NULL REFERENCES users(id),
            action     TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(pin_id, user_id, action)
        )""",
        """CREATE TABLE IF NOT EXISTS pin_update_suggestions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            pin_id      INTEGER NOT NULL,
            pin_name    TEXT NOT NULL,
            user_id     INTEGER,
            username    TEXT,
            field       TEXT NOT NULL,
            value       TEXT NOT NULL,
            note        TEXT,
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  INTEGER NOT NULL
        )""",
        "ALTER TABLE trips ADD COLUMN audio_guide TEXT",
        "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE trips ADD COLUMN user_id INTEGER",
        "ALTER TABLE trips ADD COLUMN updated_at INTEGER",
        "ALTER TABLE trips ADD COLUMN route_geometry TEXT",
        "ALTER TABLE trips ADD COLUMN builder_state TEXT",
        "ALTER TABLE trips ADD COLUMN source TEXT",
        "ALTER TABLE trips ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
        "CREATE INDEX IF NOT EXISTS idx_trips_user_updated ON trips(user_id, updated_at)",
        "CREATE TABLE IF NOT EXISTS stripe_purchases (session_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, credits INTEGER NOT NULL, created_at INTEGER NOT NULL)",
        """CREATE TABLE IF NOT EXISTS app_store_subscriptions (
            original_transaction_id TEXT PRIMARY KEY,
            transaction_id          TEXT,
            user_id                 INTEGER NOT NULL REFERENCES users(id),
            product_id              TEXT NOT NULL,
            environment             TEXT,
            expires_at              INTEGER,
            status                  TEXT NOT NULL DEFAULT 'active',
            updated_at              INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS explore_story_overrides (
            place_id      TEXT PRIMARY KEY,
            title         TEXT,
            story         TEXT,
            summary       TEXT,
            hook          TEXT,
            notes         TEXT,
            updated_by    INTEGER,
            updated_at    INTEGER NOT NULL
        )""",
        "ALTER TABLE users ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'free'",
        "ALTER TABLE users ADD COLUMN plan_expires_at INTEGER",
        "ALTER TABLE users ADD COLUMN camp_searches_used INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN push_token TEXT",
        "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE users ADD COLUMN email_verify_token TEXT",
        "ALTER TABLE users ADD COLUMN email_verify_sent_at INTEGER",
        "ALTER TABLE users ADD COLUMN password_reset_token TEXT",
        "ALTER TABLE users ADD COLUMN password_reset_sent_at INTEGER",
        "ALTER TABLE users ADD COLUMN password_reset_expires_at INTEGER",
        "ALTER TABLE users ADD COLUMN public_profile_visible INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE users ADD COLUMN contributor_title TEXT",
        "ALTER TABLE users ADD COLUMN contributor_bio TEXT",
        "ALTER TABLE users ADD COLUMN contributor_avatar_color TEXT",
        "ALTER TABLE users ADD COLUMN auth_provider TEXT",
        "ALTER TABLE users ADD COLUMN apple_sub TEXT",
        "ALTER TABLE users ADD COLUMN google_sub TEXT",
        "ALTER TABLE bug_reports ADD COLUMN category TEXT NOT NULL DEFAULT 'bug'",
        "ALTER TABLE bug_reports ADD COLUMN source_surface TEXT",
        "ALTER TABLE bug_reports ADD COLUMN screenshot_data TEXT",
        "ALTER TABLE bug_reports ADD COLUMN screenshot_content_type TEXT",
        "ALTER TABLE bug_reports ADD COLUMN ai_context_json TEXT",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_sub ON users(apple_sub) WHERE apple_sub IS NOT NULL AND apple_sub != ''",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL AND google_sub != ''",
        """CREATE TABLE IF NOT EXISTS plan_jobs (
            id          TEXT PRIMARY KEY,
            user_id     INTEGER,
            session_id  TEXT,
            request     TEXT,
            status      TEXT NOT NULL DEFAULT 'pending',
            result      TEXT,
            error       TEXT,
            created_at  REAL NOT NULL,
            updated_at  REAL NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS report_interactions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id  INTEGER NOT NULL,
            user_id    INTEGER NOT NULL REFERENCES users(id),
            action     TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(report_id, user_id, action)
        )""",
        """CREATE TABLE IF NOT EXISTS camp_field_reports (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            camp_id          TEXT NOT NULL,
            camp_name        TEXT NOT NULL,
            lat              REAL NOT NULL,
            lng              REAL NOT NULL,
            user_id          INTEGER NOT NULL REFERENCES users(id),
            username         TEXT NOT NULL,
            rig_label        TEXT,
            visited_date     TEXT NOT NULL,
            sentiment        TEXT NOT NULL,
            access_condition TEXT NOT NULL,
            crowd_level      TEXT NOT NULL,
            tags             TEXT NOT NULL DEFAULT '[]',
            note             TEXT,
            photo_data       TEXT,
            credits_earned   INTEGER NOT NULL DEFAULT 0,
            created_at       INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS camp_comments (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            camp_id     TEXT NOT NULL,
            camp_name   TEXT NOT NULL,
            lat         REAL NOT NULL,
            lng         REAL NOT NULL,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            username    TEXT NOT NULL,
            body        TEXT NOT NULL,
            created_at  INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS places (
            trailhead_place_id TEXT PRIMARY KEY,
            source             TEXT NOT NULL,
            source_priority    INTEGER NOT NULL DEFAULT 50,
            source_label       TEXT,
            source_place_id    TEXT,
            name               TEXT NOT NULL,
            lat                REAL NOT NULL,
            lng                REAL NOT NULL,
            category           TEXT,
            subtype            TEXT,
            official_url       TEXT,
            provider_ids       TEXT NOT NULL DEFAULT '{}',
            provenance         TEXT NOT NULL DEFAULT '{}',
            hero_photo_url     TEXT,
            display_metadata   TEXT NOT NULL DEFAULT '{}',
            last_seen          INTEGER NOT NULL,
            created_at         INTEGER NOT NULL,
            updated_at         INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS dispersed_site_leads (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_key           TEXT NOT NULL UNIQUE,
            source             TEXT NOT NULL DEFAULT 'private_lead',
            source_batch       TEXT NOT NULL,
            source_record_hash TEXT NOT NULL,
            lat                REAL NOT NULL,
            lng                REAL NOT NULL,
            rounded_lat        REAL NOT NULL,
            rounded_lng        REAL NOT NULL,
            category           TEXT NOT NULL,
            status             TEXT NOT NULL DEFAULT 'lead',
            confidence         INTEGER NOT NULL DEFAULT 25,
            source_verified_at TEXT,
            review_flags       TEXT NOT NULL DEFAULT '[]',
            canonical_camp_id  TEXT,
            profile_data       TEXT NOT NULL DEFAULT '{}',
            reviewed_by        INTEGER,
            reviewed_at        INTEGER,
            rejection_reason   TEXT,
            published_by       INTEGER,
            published_at       INTEGER,
            provenance         TEXT NOT NULL DEFAULT '{}',
            imported_at        INTEGER NOT NULL,
            updated_at         INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS dispersed_site_lead_photos (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_key           TEXT NOT NULL,
            user_id            INTEGER NOT NULL REFERENCES users(id),
            username           TEXT NOT NULL,
            caption            TEXT,
            photo_data         TEXT NOT NULL,
            content_type       TEXT NOT NULL DEFAULT 'image/jpeg',
            status             TEXT NOT NULL DEFAULT 'private',
            published_photo_id INTEGER,
            created_at         INTEGER NOT NULL,
            FOREIGN KEY (lead_key) REFERENCES dispersed_site_leads(lead_key)
        )""",
        """CREATE TABLE IF NOT EXISTS place_comments (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            trailhead_place_id  TEXT NOT NULL,
            user_id             INTEGER NOT NULL REFERENCES users(id),
            username            TEXT NOT NULL,
            body                TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'visible',
            created_at          INTEGER NOT NULL,
            FOREIGN KEY (trailhead_place_id) REFERENCES places(trailhead_place_id)
        )""",
        """CREATE TABLE IF NOT EXISTS place_photos (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            trailhead_place_id  TEXT NOT NULL,
            user_id             INTEGER NOT NULL REFERENCES users(id),
            username            TEXT NOT NULL,
            comment_id          INTEGER,
            object_key          TEXT,
            url                 TEXT,
            caption             TEXT,
            source              TEXT NOT NULL DEFAULT 'user',
            status              TEXT NOT NULL DEFAULT 'visible',
            content_type        TEXT NOT NULL DEFAULT 'image/jpeg',
            photo_data          TEXT,
            credits_awarded     INTEGER NOT NULL DEFAULT 0,
            created_at          INTEGER NOT NULL,
            FOREIGN KEY (trailhead_place_id) REFERENCES places(trailhead_place_id),
            FOREIGN KEY (comment_id) REFERENCES place_comments(id)
        )""",
        """CREATE TABLE IF NOT EXISTS place_edit_suggestions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            trailhead_place_id  TEXT NOT NULL,
            place_name          TEXT NOT NULL,
            user_id             INTEGER,
            username            TEXT,
            field               TEXT NOT NULL,
            value               TEXT NOT NULL,
            note                TEXT,
            status              TEXT NOT NULL DEFAULT 'pending',
            created_at          INTEGER NOT NULL,
            FOREIGN KEY (trailhead_place_id) REFERENCES places(trailhead_place_id)
        )""",
        """CREATE TABLE IF NOT EXISTS place_reservation_alerts (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            trailhead_place_id  TEXT NOT NULL,
            user_id             INTEGER NOT NULL REFERENCES users(id),
            start_date          TEXT,
            end_date            TEXT,
            party_size          INTEGER,
            source              TEXT,
            booking_url         TEXT,
            status              TEXT NOT NULL DEFAULT 'active',
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            UNIQUE(trailhead_place_id, user_id, start_date, end_date),
            FOREIGN KEY (trailhead_place_id) REFERENCES places(trailhead_place_id)
        )""",
        """CREATE TABLE IF NOT EXISTS viator_bookings (
            id                  TEXT PRIMARY KEY,
            user_id             INTEGER NOT NULL REFERENCES users(id),
            product_code        TEXT NOT NULL,
            product_title       TEXT,
            travel_date         TEXT,
            currency            TEXT NOT NULL DEFAULT 'USD',
            amount              REAL,
            status              TEXT NOT NULL DEFAULT 'intent',
            booking_reference   TEXT,
            cart_id             TEXT,
            hold_expires_at     TEXT,
            payment_solution    TEXT NOT NULL DEFAULT 'iframe',
            booking_url         TEXT,
            voucher_url         TEXT,
            provider_payload    TEXT NOT NULL DEFAULT '{}',
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_places_geo ON places(lat, lng)",
        "CREATE INDEX IF NOT EXISTS idx_places_source ON places(source, source_place_id)",
        "CREATE INDEX IF NOT EXISTS idx_dispersed_site_leads_geo ON dispersed_site_leads(lat, lng, status)",
        "CREATE INDEX IF NOT EXISTS idx_dispersed_site_leads_batch ON dispersed_site_leads(source_batch, status)",
        "CREATE INDEX IF NOT EXISTS idx_dispersed_site_leads_category ON dispersed_site_leads(category, status, source_verified_at)",
        "CREATE INDEX IF NOT EXISTS idx_dispersed_site_lead_photos_lead ON dispersed_site_lead_photos(lead_key, status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_place_comments_place ON place_comments(trailhead_place_id, status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_place_photos_place ON place_photos(trailhead_place_id, status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_place_edit_suggestions_status ON place_edit_suggestions(status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_place_reservation_alerts_user ON place_reservation_alerts(user_id, status, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_viator_bookings_user ON viator_bookings(user_id, status, updated_at)",
        "CREATE INDEX IF NOT EXISTS idx_viator_bookings_reference ON viator_bookings(booking_reference)",
        """CREATE TABLE IF NOT EXISTS trail_field_reports (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            trail_id         TEXT NOT NULL,
            trail_name       TEXT NOT NULL,
            lat              REAL NOT NULL,
            lng              REAL NOT NULL,
            user_id          INTEGER NOT NULL REFERENCES users(id),
            username         TEXT NOT NULL,
            rig_label        TEXT,
            visited_date     TEXT NOT NULL,
            sentiment        TEXT NOT NULL,
            access_condition TEXT NOT NULL,
            crowd_level      TEXT NOT NULL,
            tags             TEXT NOT NULL DEFAULT '[]',
            note             TEXT,
            photo_data       TEXT,
            credits_earned   INTEGER NOT NULL DEFAULT 0,
            created_at       INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS trail_profiles (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            summary      TEXT,
            description  TEXT,
            lat          REAL NOT NULL,
            lng          REAL NOT NULL,
            length_mi    REAL,
            difficulty   TEXT,
            activities   TEXT NOT NULL DEFAULT '[]',
            land_manager TEXT,
            geometry     TEXT,
            trailheads   TEXT NOT NULL DEFAULT '[]',
            official_url TEXT,
            photos       TEXT NOT NULL DEFAULT '[]',
            source       TEXT NOT NULL,
            source_label TEXT NOT NULL,
            provenance   TEXT NOT NULL DEFAULT '{}',
            last_checked INTEGER NOT NULL,
            admin_edited INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS trail_edit_suggestions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            trail_id    TEXT NOT NULL,
            trail_name  TEXT NOT NULL,
            user_id     INTEGER,
            username    TEXT,
            field       TEXT NOT NULL,
            value       TEXT NOT NULL,
            note        TEXT,
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS route_cache (
            cache_key    TEXT PRIMARY KEY,
            fetched_at   INTEGER NOT NULL,
            request_json TEXT NOT NULL,
            data         TEXT NOT NULL,
            hit_count    INTEGER NOT NULL DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS offline_downloads (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            asset_type  TEXT NOT NULL,
            region_id   TEXT NOT NULL,
            cost         INTEGER NOT NULL DEFAULT 0,
            free_used    INTEGER NOT NULL DEFAULT 0,
            created_at   INTEGER NOT NULL,
            UNIQUE(user_id, asset_type, region_id)
        )""",
        """CREATE TABLE IF NOT EXISTS camp_profile_overrides (
            camp_id     TEXT PRIMARY KEY,
            data        TEXT NOT NULL,
            updated_by  INTEGER,
            updated_at  INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS camp_edit_suggestions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            camp_id     TEXT NOT NULL,
            camp_name   TEXT NOT NULL,
            lat         REAL NOT NULL,
            lng         REAL NOT NULL,
            user_id     INTEGER,
            username    TEXT,
            field       TEXT NOT NULL,
            value       TEXT NOT NULL,
            note        TEXT,
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS contest_events (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL REFERENCES users(id),
            points       INTEGER NOT NULL,
            source_type  TEXT NOT NULL,
            source_id    TEXT NOT NULL,
            label        TEXT NOT NULL,
            period_month TEXT NOT NULL,
            period_year  TEXT NOT NULL,
            created_at   INTEGER NOT NULL,
            UNIQUE(user_id, source_type, source_id)
        )""",
        """CREATE TABLE IF NOT EXISTS contest_entries (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL REFERENCES users(id),
            period_month TEXT NOT NULL,
            period_year  TEXT NOT NULL,
            entry_type   TEXT NOT NULL,
            created_at   INTEGER NOT NULL,
            UNIQUE(user_id, period_month)
        )""",
        """CREATE TABLE IF NOT EXISTS contest_awards (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            prize_type      TEXT NOT NULL,
            period_month    TEXT,
            period_year     TEXT NOT NULL,
            winner_user_id  INTEGER REFERENCES users(id),
            winner_username TEXT,
            points_snapshot INTEGER NOT NULL DEFAULT 0,
            entry_count     INTEGER NOT NULL DEFAULT 0,
            prize_label     TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'selected',
            notes           TEXT,
            awarded_by      INTEGER REFERENCES users(id),
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS contributor_badges (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            badge_id    TEXT NOT NULL,
            label       TEXT NOT NULL,
            description TEXT,
            granted_by  INTEGER REFERENCES users(id),
            created_at  INTEGER NOT NULL,
            UNIQUE(user_id, badge_id)
        )""",
        """CREATE TABLE IF NOT EXISTS map_contributor_applications (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            username    TEXT,
            experience  TEXT,
            regions     TEXT,
            sample_note TEXT,
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS extreme_demo_sessions (
            session_id  TEXT PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            surface     TEXT NOT NULL,
            trip_id     TEXT,
            status      TEXT NOT NULL DEFAULT 'active',
            started_at  INTEGER NOT NULL,
            ended_at    INTEGER,
            expires_at  INTEGER NOT NULL,
            metadata    TEXT NOT NULL DEFAULT '{}'
        )""",
        """CREATE TABLE IF NOT EXISTS extreme_ledger_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            event_type  TEXT NOT NULL,
            surface     TEXT,
            trip_id     TEXT,
            event_data  TEXT NOT NULL DEFAULT '{}',
            created_at  INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS extreme_trip_metadata (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL REFERENCES users(id),
            trip_id      TEXT NOT NULL,
            checkpoints  TEXT NOT NULL DEFAULT '[]',
            trip_memory  TEXT NOT NULL DEFAULT '{}',
            updated_at   INTEGER NOT NULL,
            UNIQUE(user_id, trip_id)
        )""",
        """CREATE TABLE IF NOT EXISTS extreme_copilot_actions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL REFERENCES users(id),
            session_id   TEXT,
            trip_id      TEXT,
            command      TEXT NOT NULL,
            action_type  TEXT NOT NULL,
            status       TEXT NOT NULL DEFAULT 'staged',
            payload      TEXT NOT NULL DEFAULT '{}',
            created_at   INTEGER NOT NULL,
            confirmed_at INTEGER
        )""",
        """CREATE TABLE IF NOT EXISTS extreme_admin_config (
            config_key  TEXT PRIMARY KEY,
            value_json  TEXT NOT NULL,
            updated_by  INTEGER REFERENCES users(id),
            updated_at  INTEGER NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_extreme_sessions_user ON extreme_demo_sessions(user_id, started_at)",
        "CREATE INDEX IF NOT EXISTS idx_extreme_ledger_session ON extreme_ledger_events(session_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_extreme_trip_metadata_user ON extreme_trip_metadata(user_id, updated_at)",
        "CREATE INDEX IF NOT EXISTS idx_extreme_copilot_user ON extreme_copilot_actions(user_id, created_at)",
    ]:
        try:
            db.execute(sql)
        except Exception:
            pass
    db.commit()
    db.close()
    try:
        backfill_contest_events_from_credits()
    except Exception:
        pass

# ── Analytics ────────────────────────────────────────────────────────────────

def log_event(user_id: int | None, session_id: str | None, event_type: str, event_data: dict | None = None):
    """Fire-and-forget analytics event. Never raises — analytics must not break product."""
    try:
        db = _conn()
        db.execute(
            "INSERT INTO analytics_events (user_id, session_id, event_type, event_data, created_at) VALUES (?,?,?,?,?)",
            (user_id, session_id, event_type, json.dumps(event_data) if event_data else None, int(time.time()))
        )
        db.commit(); db.close()
    except Exception:
        pass

def cleanup_stale_data():
    """Prune expired camp fullness records and old analytics. Safe to call on health check."""
    try:
        db = _conn()
        now = int(time.time())
        db.execute("DELETE FROM camp_fullness WHERE expires_at < ? AND status='full'", (now,))
        # Keep analytics for 90 days
        cutoff = now - 90 * 86400
        db.execute("DELETE FROM analytics_events WHERE created_at < ?", (cutoff,))
        db.commit(); db.close()
    except Exception:
        pass

# ── Trail DNA (user preference profile) ──────────────────────────────────────

def get_trail_dna(session_id: str) -> dict:
    db = _conn()
    row = db.execute("SELECT profile FROM trail_dna WHERE session_id=?", (session_id,)).fetchone()
    db.close()
    return json.loads(row["profile"]) if row else {}

def save_trail_dna(session_id: str, profile: dict):
    db = _conn()
    cur = db.execute(
        "INSERT OR REPLACE INTO trail_dna (session_id, profile, updated_at) VALUES (?,?,?)",
        (session_id, json.dumps(profile), int(time.time()))
    )
    db.commit(); db.close()

# ── Conversations ─────────────────────────────────────────────────────────────

def get_conversation(session_id: str) -> list:
    db = _conn()
    row = db.execute("SELECT messages FROM conversations WHERE session_id=?", (session_id,)).fetchone()
    db.close()
    return json.loads(row["messages"]) if row else []

def save_conversation(session_id: str, messages: list):
    db = _conn()
    cur = db.execute(
        "INSERT OR REPLACE INTO conversations (session_id, messages, updated_at) VALUES (?,?,?)",
        (session_id, json.dumps(messages), int(time.time()))
    )
    db.commit(); db.close()

def clear_conversation(session_id: str):
    db = _conn()
    db.execute("DELETE FROM conversations WHERE session_id=?", (session_id,))
    db.commit(); db.close()

# ── Trips ─────────────────────────────────────────────────────────────────────

def save_trip(trip_id: str, request: str, plan: dict, user_id: int | None = None):
    db = _conn()
    now = int(time.time())
    existing = db.execute("SELECT created_at, audio_guide FROM trips WHERE id=?", (trip_id,)).fetchone()
    created_at = existing["created_at"] if existing else now
    audio_guide = existing["audio_guide"] if existing else None
    db.execute(
        """INSERT OR REPLACE INTO trips
           (id, user_id, created_at, updated_at, request, plan, audio_guide, version)
           VALUES (?,?,?,?,?,?,?,COALESCE((SELECT version + 1 FROM trips WHERE id=?), 1))""",
        (trip_id, user_id, created_at, now, request, json.dumps(plan), audio_guide, trip_id)
    )
    db.commit(); db.close()

def get_trip(trip_id: str) -> dict | None:
    db = _conn()
    row = db.execute(
        """SELECT user_id, created_at, updated_at, plan, audio_guide, route_geometry,
                  builder_state, source, version
           FROM trips WHERE id=?""",
        (trip_id,)
    ).fetchone()
    db.close()
    if not row:
        return None
    result = json.loads(row["plan"])
    result["user_id"] = row["user_id"]  # used for ownership check in the route
    result["created_at"] = row["created_at"]
    result["updated_at"] = row["updated_at"] or row["created_at"]
    result["source"] = row["source"]
    result["version"] = row["version"] or 1
    if row["route_geometry"]:
        result["route_geometry"] = json.loads(row["route_geometry"])
    if row["builder_state"]:
        result["builder_state"] = json.loads(row["builder_state"])
    if row["audio_guide"]:
        result["audio_guide"] = json.loads(row["audio_guide"])
    return result

def save_account_trip(
    trip_id: str,
    trip: dict,
    user_id: int,
    request: str = "",
    route_geometry: dict | None = None,
    builder_state: dict | None = None,
    source: str = "web",
) -> dict:
    db = _conn()
    now = int(time.time())
    existing = db.execute("SELECT created_at, audio_guide, version FROM trips WHERE id=?", (trip_id,)).fetchone()
    created_at = existing["created_at"] if existing else now
    version = (existing["version"] or 1) + 1 if existing else 1
    audio_guide = existing["audio_guide"] if existing else None
    db.execute(
        """INSERT OR REPLACE INTO trips
           (id, user_id, created_at, updated_at, request, plan, route_geometry,
            builder_state, source, version, audio_guide)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            trip_id,
            user_id,
            created_at,
            now,
            request,
            json.dumps(trip),
            json.dumps(route_geometry) if route_geometry is not None else None,
            json.dumps(builder_state) if builder_state is not None else None,
            source,
            version,
            audio_guide,
        )
    )
    db.commit(); db.close()
    saved = get_trip(trip_id)
    return saved if saved else trip

def list_user_trips(user_id: int, limit: int = 25) -> list[dict]:
    db = _conn()
    rows = db.execute(
        """SELECT id, created_at, COALESCE(updated_at, created_at) AS updated_at,
                  request, plan, source, version
           FROM trips
           WHERE user_id=?
           ORDER BY COALESCE(updated_at, created_at) DESC
           LIMIT ?""",
        (user_id, limit)
    ).fetchall()
    db.close()
    out = []
    for row in rows:
        plan_json = json.loads(row["plan"])
        plan = plan_json.get("plan", {}) if isinstance(plan_json, dict) else {}
        out.append({
            "trip_id": row["id"],
            "trip_name": plan.get("trip_name") or "Untitled route",
            "states": plan.get("states") or [],
            "duration_days": plan.get("duration_days") or 0,
            "est_miles": plan.get("total_est_miles") or 0,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "source": row["source"],
            "version": row["version"] or 1,
        })
    return out

def save_trip_geometry(trip_id: str, user_id: int, route_geometry: dict) -> dict | None:
    db = _conn()
    row = db.execute("SELECT user_id FROM trips WHERE id=?", (trip_id,)).fetchone()
    if not row:
        db.close()
        return None
    if row["user_id"] != user_id:
        db.close()
        raise PermissionError("Not authorized")
    db.execute(
        "UPDATE trips SET route_geometry=?, updated_at=?, version=COALESCE(version,1)+1 WHERE id=?",
        (json.dumps(route_geometry), int(time.time()), trip_id)
    )
    db.commit(); db.close()
    return get_trip(trip_id)

def save_audio_guide(trip_id: str, guide: dict):
    db = _conn()
    db.execute("UPDATE trips SET audio_guide=? WHERE id=?", (json.dumps(guide), trip_id))
    db.commit(); db.close()

def get_audio_guide(trip_id: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT audio_guide FROM trips WHERE id=?", (trip_id,)).fetchone()
    db.close()
    return json.loads(row["audio_guide"]) if row and row["audio_guide"] else None

# ── Cache ─────────────────────────────────────────────────────────────────────

def get_cached(table: str, key: str, ttl_seconds: int = 86400) -> list | None:
    db = _conn()
    row = db.execute(f"SELECT fetched_at,data FROM {table} WHERE cache_key=?", (key,)).fetchone()
    db.close()
    if row and (time.time() - row["fetched_at"]) < ttl_seconds:
        return json.loads(row["data"])
    return None

def set_cached(table: str, key: str, data: list):
    db = _conn()
    db.execute(f"INSERT OR REPLACE INTO {table} (cache_key,fetched_at,data) VALUES (?,?,?)",
               (key, int(time.time()), json.dumps(data)))
    db.commit(); db.close()

def clear_cached_rows(table: str, prefixes: list[str] | None = None, keys: list[str] | None = None) -> int:
    if table not in {"weather_cache", "campsite_cache", "gas_cache"}:
        raise ValueError("unsupported cache table")
    db = _conn()
    deleted = 0
    try:
        if keys:
            for key in keys:
                cur = db.execute(f"DELETE FROM {table} WHERE cache_key=?", (key,))
                deleted += cur.rowcount or 0
        if prefixes:
            for prefix in prefixes:
                cur = db.execute(f"DELETE FROM {table} WHERE cache_key LIKE ?", (f"{prefix}%",))
                deleted += cur.rowcount or 0
        db.commit()
        return deleted
    finally:
        db.close()

def get_route_cached(key: str, ttl_seconds: int = 30 * 86400) -> dict | None:
    db = _conn()
    row = db.execute("SELECT fetched_at,data FROM route_cache WHERE cache_key=?", (key,)).fetchone()
    if row and (time.time() - row["fetched_at"]) < ttl_seconds:
        db.execute("UPDATE route_cache SET hit_count=hit_count+1 WHERE cache_key=?", (key,))
        db.commit(); db.close()
        return json.loads(row["data"])
    db.close()
    return None

def set_route_cached(key: str, request_payload: dict, data: dict):
    db = _conn()
    db.execute(
        """INSERT OR REPLACE INTO route_cache
           (cache_key,fetched_at,request_json,data,hit_count) VALUES (?,?,?,?,COALESCE((SELECT hit_count FROM route_cache WHERE cache_key=?),0))""",
        (key, int(time.time()), json.dumps(request_payload), json.dumps(data), key)
    )
    db.commit(); db.close()

# ── Users ─────────────────────────────────────────────────────────────────────

def create_user(email: str, username: str, password_hash: str, referral_code: str,
                referred_by: int | None = None) -> int:
    db = _conn()
    cur = db.execute(
        """INSERT INTO users
           (email,username,password_hash,referral_code,referred_by,email_verified,created_at)
           VALUES (?,?,?,?,?,0,?)""",
        (email.lower(), username, password_hash, referral_code, referred_by, int(time.time()))
    )
    uid = cur.lastrowid
    db.commit(); db.close()
    return uid

def create_oauth_user(email: str, username: str, password_hash: str, provider: str, provider_sub: str) -> int:
    if provider not in {"apple", "google"}:
        raise ValueError("Unsupported OAuth provider")
    column = "apple_sub" if provider == "apple" else "google_sub"
    db = _conn()
    code = f"{username.lower()}-{secrets.token_hex(3)}"
    cur = db.execute(
        f"""INSERT INTO users
           (email,username,password_hash,referral_code,email_verified,auth_provider,{column},created_at)
           VALUES (?,?,?,?,1,?,?,?)""",
        (email.lower(), username, password_hash, code, provider, provider_sub, int(time.time()))
    )
    uid = cur.lastrowid
    db.commit(); db.close()
    return uid

def get_user_by_oauth(provider: str, provider_sub: str) -> dict | None:
    if provider not in {"apple", "google"} or not provider_sub:
        return None
    column = "apple_sub" if provider == "apple" else "google_sub"
    db = _conn()
    row = db.execute(f"SELECT * FROM users WHERE {column}=?", (provider_sub,)).fetchone()
    db.close()
    return dict(row) if row else None

def link_user_oauth(user_id: int, provider: str, provider_sub: str) -> dict | None:
    if provider not in {"apple", "google"} or not provider_sub:
        return None
    column = "apple_sub" if provider == "apple" else "google_sub"
    db = _conn()
    db.execute(
        f"""UPDATE users
           SET {column}=?,
               auth_provider=COALESCE(auth_provider, ?),
               email_verified=1,
               email_verify_token=NULL,
               email_verify_sent_at=NULL
           WHERE id=?""",
        (provider_sub, provider, user_id)
    )
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    db.close()
    return dict(row) if row else None

def set_email_verification(user_id: int, token: str, sent_at: int | None = None) -> None:
    db = _conn()
    db.execute(
        "UPDATE users SET email_verified=0, email_verify_token=?, email_verify_sent_at=? WHERE id=?",
        (token, sent_at or int(time.time()), user_id)
    )
    db.commit(); db.close()

def verify_email_token(token: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM users WHERE email_verify_token=?", (token,)).fetchone()
    if not row:
        db.close()
        return None
    db.execute(
        "UPDATE users SET email_verified=1, email_verify_token=NULL, email_verify_sent_at=NULL WHERE id=?",
        (row["id"],)
    )
    db.commit()
    fresh = db.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
    db.close()
    return dict(fresh) if fresh else None

def mark_email_verified(user_id: int) -> None:
    db = _conn()
    db.execute(
        "UPDATE users SET email_verified=1, email_verify_token=NULL, email_verify_sent_at=NULL WHERE id=?",
        (user_id,)
    )
    db.commit(); db.close()

def get_user_by_email(email: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM users WHERE email=?", (email.lower(),)).fetchone()
    db.close()
    return dict(row) if row else None

def set_password_reset(user_id: int, token: str, expires_at: int, sent_at: int | None = None) -> None:
    db = _conn()
    db.execute(
        "UPDATE users SET password_reset_token=?, password_reset_sent_at=?, password_reset_expires_at=? WHERE id=?",
        (token, sent_at or int(time.time()), expires_at, user_id)
    )
    db.commit(); db.close()

def reset_password_with_token(token: str, password_hash: str) -> dict | None:
    db = _conn()
    now = int(time.time())
    row = db.execute(
        "SELECT * FROM users WHERE password_reset_token=? AND COALESCE(password_reset_expires_at,0)>=?",
        (token, now)
    ).fetchone()
    if not row:
        db.close()
        return None
    db.execute(
        """UPDATE users
           SET password_hash=?,
               password_reset_token=NULL,
               password_reset_sent_at=NULL,
               password_reset_expires_at=NULL,
               email_verified=1,
               email_verify_token=NULL,
               email_verify_sent_at=NULL
           WHERE id=?""",
        (password_hash, row["id"])
    )
    db.commit()
    fresh = db.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
    db.close()
    return dict(fresh) if fresh else None

def get_user_by_username(username: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM users WHERE lower(username)=lower(?)", (username.strip(),)).fetchone()
    db.close()
    return dict(row) if row else None

def get_user_by_id(user_id: int) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    db.close()
    return dict(row) if row else None

def delete_user(user_id: int) -> None:
    """Permanently delete a user and all associated data.
    Uses FK-compliant full delete when possible; falls back to FK-off user-row
    delete if DB is locked (e.g. Railway multi-instance deploy window)."""
    import time as _time
    # Attempt 1-3: full FK-compliant delete
    for attempt in range(3):
        try:
            _delete_user_full(user_id)
            return
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() and attempt < 2:
                _time.sleep(2)
            else:
                break

    # Fallback: disable FK constraints, delete user row directly.
    # Orphan rows remain but the account (PII/login) is gone — meets Apple 5.1.1(v).
    db = sqlite3.connect(settings.db_path, timeout=60.0, check_same_thread=False)
    db.execute("PRAGMA foreign_keys=OFF")
    db.execute("DELETE FROM users WHERE id=?", (user_id,))
    db.commit()
    db.close()


def _delete_user_full(user_id: int) -> None:
    db = _conn()
    # Tables with REFERENCES users(id) — strict foreign key constraints, delete first
    db.execute("DELETE FROM contributor_badges WHERE user_id=? OR granted_by=?", (user_id, user_id))
    db.execute("DELETE FROM contest_events      WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM contest_entries     WHERE user_id=?",    (user_id,))
    db.execute("UPDATE contest_awards SET winner_user_id=NULL,winner_username='Deleted user' WHERE winner_user_id=?", (user_id,))
    db.execute("DELETE FROM report_interactions WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM camp_field_reports  WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM camp_comments       WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM place_reservation_alerts WHERE user_id=?", (user_id,))
    db.execute("DELETE FROM place_photos        WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM place_comments      WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM trail_field_reports WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM camp_fullness_votes WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM camp_fullness       WHERE reporter_id=?", (user_id,))
    db.execute("DELETE FROM credit_transactions WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM referrals           WHERE referrer_id=?", (user_id,))
    # Tables with nullable user_id (no FK constraint but clean up anyway)
    db.execute("DELETE FROM analytics_events    WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM bug_reports         WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM plan_jobs           WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM reports             WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM community_pins      WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM trips               WHERE user_id=?",    (user_id,))
    # stripe_purchases uses session_id PK — delete by user_id if col exists (added via migration)
    try:
        db.execute("DELETE FROM stripe_purchases WHERE user_id=?",   (user_id,))
    except Exception:
        pass  # table or column may not exist on older deployments
    # Finally delete the user row itself (push_token is a column on users, not a table)
    db.execute("DELETE FROM users               WHERE id=?",         (user_id,))
    db.commit(); db.close()

def get_user_by_referral_code(code: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM users WHERE referral_code=?", (code,)).fetchone()
    db.close()
    return dict(row) if row else None

def _contest_period(ts: int | None = None) -> tuple[str, str]:
    stamp = time.gmtime(ts or int(time.time()))
    return time.strftime("%Y-%m", stamp), time.strftime("%Y", stamp)

def _contest_source_type(reason: str) -> str | None:
    r = (reason or "").strip()
    if not r:
        return None
    if r.startswith("Report:"):
        return "community_report"
    if r.startswith("Community pin:"):
        return "community_pin"
    if r.startswith("Confirmed report") or "still active" in r:
        return "report_confirmation"
    if r.startswith("Report #") and "upvoted" in r:
        return "report_upvote"
    if r.startswith("Field report for"):
        return "camp_field_report"
    if r.startswith("Trail report for"):
        return "trail_field_report"
    if r.startswith("Place photo:"):
        return "place_photo"
    if r.startswith("Place edit suggestion:"):
        return "place_edit_suggestion"
    if r.startswith("Camp edit suggestion:"):
        return "camp_edit"
    if r.startswith("Reported camp full:") or r.startswith("Confirmed camp full:") or r.startswith("Camp report confirmed:") or r.startswith("Cleared camp full report:"):
        return "camp_status"
    if "reporting streak" in r.lower() or "streak" in r.lower():
        return "streak_bonus"
    return None

def _record_contest_event_db(db: sqlite3.Connection, user_id: int, points: int, reason: str,
                             source_type: str | None = None, source_id: str | None = None,
                             created_at: int | None = None) -> None:
    if points <= 0:
        return
    source = source_type or _contest_source_type(reason)
    if not source:
        return
    ts = int(created_at or time.time())
    month, year = _contest_period(ts)
    sid = source_id or hashlib.sha1(f"{user_id}:{source}:{reason}:{ts}".encode("utf-8")).hexdigest()
    db.execute(
        """INSERT OR IGNORE INTO contest_events
           (user_id,points,source_type,source_id,label,period_month,period_year,created_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (user_id, points, source, str(sid), reason[:240], month, year, ts),
    )

def add_contest_points(user_id: int, points: int, reason: str,
                       source_type: str | None = None, source_id: str | None = None,
                       created_at: int | None = None) -> None:
    db = _conn()
    _record_contest_event_db(db, user_id, points, reason, source_type, source_id, created_at)
    db.commit(); db.close()

def add_credits(user_id: int, amount: int, reason: str):
    now = int(time.time())
    db = _conn()
    db.execute("UPDATE users SET credits=MAX(0,credits+?) WHERE id=?", (amount, user_id))
    db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
               (user_id, amount, reason, now))
    _record_contest_event_db(db, user_id, amount, reason, created_at=now)
    db.commit(); db.close()

def get_credit_history(user_id: int, limit: int = 20) -> list:
    db = _conn()
    rows = db.execute(
        "SELECT * FROM credit_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
        (user_id, limit)
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


# ── Camp fullness ──────────────────────────────────────────────────────────────

import datetime as _dt

DISPUTE_THRESHOLD = 3  # disputes needed to flip a full report back to open

def _next_noon_utc(ts: int) -> int:
    """Return timestamp of the next noon UTC — campsites check out at noon."""
    dt = _dt.datetime.utcfromtimestamp(ts)
    noon = dt.replace(hour=12, minute=0, second=0, microsecond=0)
    if dt.hour >= 12:
        noon += _dt.timedelta(days=1)
    return int(noon.timestamp())

def _user_balance(user_id: int) -> int:
    db = _conn()
    row = db.execute("SELECT credits FROM users WHERE id=?", (user_id,)).fetchone()
    db.close()
    return row["credits"] if row else 0

def report_camp_full(camp_id: str, camp_name: str, lat: float, lng: float, user_id: int) -> dict:
    db = _conn()
    now = int(time.time())
    expires = _next_noon_utc(now)
    existing = db.execute("SELECT * FROM camp_fullness WHERE camp_id=?", (camp_id,)).fetchone()
    if existing and existing["status"] == "full" and existing["reporter_id"] == user_id and existing["expires_at"] > now:
        db.close()
        return {"credits_earned": 0, "confirmations": existing["confirmations"], "already_reported": True, "new_balance": _user_balance(user_id)}
    db.execute("""
        INSERT INTO camp_fullness (camp_id, camp_name, lat, lng, status, reporter_id, confirmations, disputes, reported_at, expires_at)
        VALUES (?, ?, ?, ?, 'full', ?, 0, 0, ?, ?)
        ON CONFLICT(camp_id) DO UPDATE SET
            status='full', reporter_id=excluded.reporter_id, confirmations=0,
            disputes=0, reported_at=excluded.reported_at, expires_at=excluded.expires_at
    """, (camp_id, camp_name, lat, lng, user_id, now, expires))
    db.execute("DELETE FROM camp_fullness_votes WHERE camp_id=?", (camp_id,))
    db.commit(); db.close()
    add_credits(user_id, 3, f"Reported camp full: {camp_name}")
    return {"credits_earned": 3, "confirmations": 0, "new_balance": _user_balance(user_id)}

def confirm_camp_full(camp_id: str, user_id: int) -> dict:
    db = _conn()
    now = int(time.time())
    fullness = db.execute("SELECT * FROM camp_fullness WHERE camp_id=?", (camp_id,)).fetchone()
    if not fullness or fullness["status"] != "full" or fullness["expires_at"] < now:
        db.close()
        return {"error": "No active full report", "credits_earned": 0}
    vote = db.execute("SELECT id FROM camp_fullness_votes WHERE camp_id=? AND user_id=?", (camp_id, user_id)).fetchone()
    if vote:
        db.close()
        return {"credits_earned": 0, "confirmations": fullness["confirmations"], "already_voted": True}
    db.execute("INSERT INTO camp_fullness_votes (camp_id, user_id, vote, voted_at) VALUES (?,?,'confirm',?)", (camp_id, user_id, now))
    db.execute("UPDATE camp_fullness SET confirmations=confirmations+1 WHERE camp_id=?", (camp_id,))
    db.commit(); db.close()
    add_credits(user_id, 1, f"Confirmed camp full: {fullness['camp_name']}")
    confirmations = fullness["confirmations"] + 1
    if confirmations <= 10 and fullness["reporter_id"] and fullness["reporter_id"] != user_id:
        add_credits(fullness["reporter_id"], 1, f"Camp report confirmed: {fullness['camp_name']}")
    return {"credits_earned": 1, "confirmations": confirmations, "new_balance": _user_balance(user_id)}

def dispute_camp_full(camp_id: str, user_id: int) -> dict:
    db = _conn()
    now = int(time.time())
    fullness = db.execute("SELECT * FROM camp_fullness WHERE camp_id=?", (camp_id,)).fetchone()
    if not fullness or fullness["status"] != "full" or fullness["expires_at"] < now:
        db.close()
        return {"status": "open", "disputes": 0, "credits_earned": 0}
    vote = db.execute("SELECT id FROM camp_fullness_votes WHERE camp_id=? AND user_id=?", (camp_id, user_id)).fetchone()
    if vote:
        db.close()
        return {"credits_earned": 0, "disputes": fullness["disputes"], "status": "full", "already_voted": True}
    db.execute("INSERT INTO camp_fullness_votes (camp_id, user_id, vote, voted_at) VALUES (?,?,'dispute',?)", (camp_id, user_id, now))
    disputes = fullness["disputes"] + 1
    new_status = "full"
    credits_earned = 0
    if disputes >= DISPUTE_THRESHOLD and disputes > fullness["confirmations"]:
        new_status = "open"
        db.execute("UPDATE camp_fullness SET status='open', disputes=? WHERE camp_id=?", (disputes, camp_id))
        credits_earned = 3 if fullness["confirmations"] >= 2 else 1
        add_credits(user_id, credits_earned, f"Cleared camp full report: {fullness['camp_name']}")
    else:
        db.execute("UPDATE camp_fullness SET disputes=? WHERE camp_id=?", (disputes, camp_id))
    db.commit(); db.close()
    return {"credits_earned": credits_earned, "disputes": disputes, "status": new_status, "new_balance": _user_balance(user_id)}

def get_camp_fullness(camp_id: str) -> dict | None:
    db = _conn()
    now = int(time.time())
    row = db.execute(
        "SELECT cf.*, u.username FROM camp_fullness cf LEFT JOIN users u ON cf.reporter_id=u.id WHERE cf.camp_id=? AND cf.status='full' AND cf.expires_at>?",
        (camp_id, now)
    ).fetchone()
    db.close()
    return dict(row) if row else None

def get_fullness_nearby(lat: float, lng: float, radius_deg: float = 0.5) -> list:
    db = _conn()
    now = int(time.time())
    rows = db.execute("""
        SELECT cf.*, u.username FROM camp_fullness cf
        LEFT JOIN users u ON cf.reporter_id=u.id
        WHERE cf.status='full' AND cf.expires_at>?
          AND cf.lat BETWEEN ? AND ? AND cf.lng BETWEEN ? AND ?
    """, (now, lat - radius_deg, lat + radius_deg, lng - radius_deg, lng + radius_deg)).fetchall()
    db.close()
    return [dict(r) for r in rows]


def deduct_credits(user_id: int, amount: int, reason: str) -> bool:
    """Atomically deduct credits. Returns False if insufficient balance."""
    db = _conn()
    try:
        db.execute(
            "UPDATE users SET credits=credits-? WHERE id=? AND credits>=?",
            (amount, user_id, amount)
        )
        if db.execute("SELECT changes()").fetchone()[0] == 0:
            return False
        db.execute(
            "INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
            (user_id, -amount, reason, int(time.time()))
        )
        db.commit()
        return True
    except Exception:
        return False
    finally:
        db.close()


def get_user_report_count_today(user_id: int) -> int:
    import datetime
    today = datetime.date.today().isoformat()
    db = _conn()
    row = db.execute(
        "SELECT COUNT(*) as cnt FROM reports WHERE user_id=? AND date(created_at,'unixepoch')=?",
        (user_id, today)
    ).fetchone()
    db.close()
    return row["cnt"] if row else 0


def get_report_credits_today(user_id: int) -> int:
    """Sum of credits earned from reports today — used to enforce daily cap."""
    today_start = int(time.time()) - (int(time.time()) % 86400)
    db = _conn()
    row = db.execute(
        """SELECT COALESCE(SUM(amount),0) as total FROM credit_transactions
           WHERE user_id=? AND amount>0 AND reason LIKE 'Report%' AND created_at>=?""",
        (user_id, today_start)
    ).fetchone()
    db.close()
    return row["total"] if row else 0


def log_ai_usage(user_id: int, action: str):
    """Record a plan-subscriber AI call for daily soft-cap tracking."""
    db = _conn()
    db.execute(
        "CREATE TABLE IF NOT EXISTS ai_usage_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, created_at INTEGER)"
    )
    db.execute("INSERT INTO ai_usage_log (user_id,action,created_at) VALUES (?,?,?)",
               (user_id, action, int(time.time())))
    db.commit(); db.close()

def get_plan_action_count_today(user_id: int, action: str) -> int:
    """Count how many times a plan subscriber has used a given AI action today."""
    today_start = int(time.time()) - (int(time.time()) % 86400)
    db = _conn()
    db.execute("CREATE TABLE IF NOT EXISTS ai_usage_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, created_at INTEGER)")
    row = db.execute(
        "SELECT COUNT(*) as cnt FROM ai_usage_log WHERE user_id=? AND action=? AND created_at>=?",
        (user_id, action, today_start)
    ).fetchone()
    db.close()
    return row["cnt"] if row else 0


def is_stripe_session_fulfilled(session_id: str) -> bool:
    db = _conn()
    row = db.execute("SELECT 1 FROM stripe_purchases WHERE session_id=?", (session_id,)).fetchone()
    db.close()
    return row is not None


def fulfill_stripe_purchase(session_id: str, user_id: int, credits: int):
    db = _conn()
    db.execute(
        "INSERT OR IGNORE INTO stripe_purchases (session_id,user_id,credits,created_at) VALUES (?,?,?,?)",
        (session_id, user_id, credits, int(time.time()))
    )
    db.commit()
    db.close()


def is_reporter_restricted(user_id: int) -> tuple[bool, int]:
    """Returns (restricted, seconds_remaining)."""
    db = _conn()
    row = db.execute("SELECT reporting_restricted_until FROM users WHERE id=?", (user_id,)).fetchone()
    db.close()
    if row and row["reporting_restricted_until"] and row["reporting_restricted_until"] > int(time.time()):
        return True, row["reporting_restricted_until"] - int(time.time())
    return False, 0

def check_and_update_streak(user_id: int) -> dict:
    """Update daily reporting streak. Returns bonus credits earned."""
    import datetime
    today = datetime.date.today().isoformat()
    db = _conn()
    row = db.execute("SELECT report_streak,last_report_date FROM users WHERE id=?", (user_id,)).fetchone()
    streak = row["report_streak"] or 0
    last = row["last_report_date"]
    bonus = 0
    bonus_reason = ""

    if last == today:
        db.close()
        return {"streak": streak, "bonus": 0, "reason": ""}

    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    if last == yesterday:
        streak += 1
    else:
        streak = 1

    # Milestone bonuses
    if streak == 3:   bonus, bonus_reason = 25,  "3-day reporting streak! Fire"
    elif streak == 7:  bonus, bonus_reason = 50,  "7-day streak legend! Trophy"
    elif streak == 30: bonus, bonus_reason = 200, "30-day streak — you're a trailblazer! Star"

    db.execute("UPDATE users SET report_streak=?, last_report_date=? WHERE id=?", (streak, today, user_id))
    if bonus:
        now = int(time.time())
        db.execute("UPDATE users SET credits=credits+? WHERE id=?", (bonus, user_id))
        db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
                   (user_id, bonus, bonus_reason, now))
        _record_contest_event_db(db, user_id, bonus, bonus_reason, "streak_bonus", today, now)
    db.commit(); db.close()
    return {"streak": streak, "bonus": bonus, "reason": bonus_reason}

# ── Reports ───────────────────────────────────────────────────────────────────

def create_report(user_id: int, lat: float, lng: float, type: str, subtype: str,
                  description: str, severity: str, photo_data: str | None = None) -> int:
    db = _conn()
    ttl = EXPIRY_BY_TYPE.get(type, 7 * 86400)
    expires = int(time.time()) + ttl
    has_photo = 1 if photo_data else 0
    cur = db.execute(
        """INSERT INTO reports
           (user_id,lat,lng,type,subtype,description,severity,has_photo,photo_data,created_at,expires_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (user_id, lat, lng, type, subtype, description, severity, has_photo, photo_data,
         int(time.time()), expires)
    )
    db.commit(); db.close()
    return cur.lastrowid

def get_reports_near(lat: float, lng: float, radius_deg: float = 0.5) -> list:
    db = _conn()
    now = int(time.time())
    rows = db.execute(
        """SELECT r.*,u.username FROM reports r
           JOIN users u ON r.user_id=u.id
           WHERE r.lat BETWEEN ? AND ? AND r.lng BETWEEN ? AND ?
           AND (r.expires_at IS NULL OR r.expires_at>?)
           ORDER BY r.created_at DESC LIMIT 100""",
        (lat-radius_deg, lat+radius_deg, lng-radius_deg, lng+radius_deg, now)
    ).fetchall()
    db.close()
    raw = [dict(r) for r in rows]
    # Strip photo_data from list view (heavy)
    for r in raw:
        r.pop("photo_data", None)
    return _cluster_reports(raw)

def get_reports_along_route(waypoints: list[dict], radius_deg: float = 0.15) -> list:
    """Return reports near any waypoint on a route — single query, no N+1."""
    valid = [(wp["lat"], wp["lng"], wp.get("day")) for wp in waypoints
             if wp.get("lat") and wp.get("lng")]
    if not valid:
        return []
    db = _conn()
    now = int(time.time())
    # Build one expanded bounding box covering the whole route, then post-filter
    lats = [v[0] for v in valid]
    lngs = [v[1] for v in valid]
    min_lat, max_lat = min(lats) - radius_deg, max(lats) + radius_deg
    min_lng, max_lng = min(lngs) - radius_deg, max(lngs) + radius_deg
    rows = db.execute(
        """SELECT r.*,u.username FROM reports r
           JOIN users u ON r.user_id=u.id
           WHERE r.lat BETWEEN ? AND ? AND r.lng BETWEEN ? AND ?
           AND (r.expires_at IS NULL OR r.expires_at>?)
           ORDER BY r.severity DESC, r.upvotes DESC LIMIT 100""",
        (min_lat, max_lat, min_lng, max_lng, now)
    ).fetchall()
    db.close()
    # Post-filter: only keep rows that are actually within radius of a waypoint
    # and tag with nearest waypoint day
    results = []
    seen: set[int] = set()
    for row in rows:
        if row["id"] in seen:
            continue
        r_lat, r_lng = row["lat"], row["lng"]
        best_day = None
        for lat, lng, day in valid:
            if abs(r_lat - lat) <= radius_deg and abs(r_lng - lng) <= radius_deg:
                best_day = day
                break
        if best_day is None:
            continue
        seen.add(row["id"])
        d = dict(row)
        d.pop("photo_data", None)
        d["waypoint_day"] = best_day
        results.append(d)
    return results

def _cluster_reports(reports: list[dict], cluster_deg: float = 0.002) -> list:
    """Merge reports within ~200m into clusters."""
    clusters = []
    used = set()
    for i, r in enumerate(reports):
        if i in used:
            continue
        cluster = [r]
        for j, r2 in enumerate(reports):
            if j <= i or j in used:
                continue
            if (abs(r["lat"] - r2["lat"]) < cluster_deg and
                    abs(r["lng"] - r2["lng"]) < cluster_deg and
                    r["type"] == r2["type"]):
                cluster.append(r2)
                used.add(j)
        used.add(i)
        rep = cluster[0].copy()
        rep["cluster_count"] = len(cluster)
        rep["upvotes"] = sum(c["upvotes"] for c in cluster)
        clusters.append(rep)
    return clusters

def confirm_report(report_id: int, user_id: int) -> dict:
    """'Still there' confirmation — resets expiry, +1 credit to confirmer. One confirm per user per report."""
    db = _conn()
    row = db.execute("SELECT type,expires_at,user_id FROM reports WHERE id=?", (report_id,)).fetchone()
    if not row:
        db.close(); return {"ok": False, "reason": "not_found"}
    if row["user_id"] == user_id:
        db.close(); return {"ok": False, "reason": "own_report"}
    existing = db.execute(
        "SELECT id FROM report_interactions WHERE report_id=? AND user_id=? AND action='confirm'",
        (report_id, user_id)
    ).fetchone()
    if existing:
        db.close(); return {"ok": False, "reason": "already_confirmed"}
    ttl = EXPIRY_BY_TYPE.get(row["type"], 7 * 86400)
    new_expires = int(time.time()) + ttl
    db.execute("UPDATE reports SET confirmations=confirmations+1, expires_at=? WHERE id=?",
               (new_expires, report_id))
    now = int(time.time())
    db.execute("UPDATE users SET credits=credits+1 WHERE id=?", (user_id,))
    db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
               (user_id, 1, f"Confirmed report #{report_id} still active", now))
    db.execute("INSERT INTO report_interactions (report_id,user_id,action,created_at) VALUES (?,?,?,?)",
               (report_id, user_id, "confirm", now))
    _record_contest_event_db(db, user_id, 1, f"Confirmed report #{report_id} still active", "report_confirmation", str(report_id), now)
    db.commit(); db.close()
    return {"ok": True}

def upvote_report(report_id: int, user_id: int | None = None):
    db = _conn()
    row = db.execute("SELECT user_id FROM reports WHERE id=?", (report_id,)).fetchone()
    if not row:
        db.close(); return
    if user_id:
        if row["user_id"] == user_id:
            db.close(); return  # no self-upvotes
        existing = db.execute(
            "SELECT id FROM report_interactions WHERE report_id=? AND user_id=? AND action='upvote'",
            (report_id, user_id)
        ).fetchone()
        if existing:
            db.close(); return
        db.execute("INSERT INTO report_interactions (report_id,user_id,action,created_at) VALUES (?,?,?,?)",
                   (report_id, user_id, "upvote", int(time.time())))
    db.execute("UPDATE reports SET upvotes=upvotes+1 WHERE id=?", (report_id,))
    now = int(time.time())
    db.execute("UPDATE users SET credits=credits+2 WHERE id=?", (row["user_id"],))
    db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
               (row["user_id"], 2, f"Report #{report_id} upvoted", now))
    _record_contest_event_db(db, row["user_id"], 2, f"Report #{report_id} upvoted", "report_upvote", str(report_id), now)
    db.commit(); db.close()

def downvote_report(report_id: int):
    db = _conn()
    db.execute("UPDATE reports SET downvotes=downvotes+1 WHERE id=?", (report_id,))
    row = db.execute("SELECT user_id,downvotes FROM reports WHERE id=?", (report_id,)).fetchone()
    if row and row["downvotes"] >= 5:
        # Auto-expire flagged report
        db.execute("UPDATE reports SET expires_at=? WHERE id=?", (int(time.time()), report_id))
        # Dock 5 credits from reporter
        db.execute("UPDATE users SET credits=MAX(0,credits-5), flagged_report_count=flagged_report_count+1 WHERE id=?",
                   (row["user_id"],))
        db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
                   (row["user_id"], -5, f"Report #{report_id} removed — flagged inaccurate", int(time.time())))
        # Check if user should be restricted (3 flagged in 30 days)
        cutoff = int(time.time()) - 30 * 86400
        count_row = db.execute(
            "SELECT flagged_report_count FROM users WHERE id=?", (row["user_id"],)
        ).fetchone()
        if count_row and count_row["flagged_report_count"] >= 3:
            restrict_until = int(time.time()) + 7 * 86400
            db.execute("UPDATE users SET reporting_restricted_until=?, flagged_report_count=0 WHERE id=?",
                       (restrict_until, row["user_id"]))
            db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
                       (row["user_id"], 0,
                        "Reporting restricted 7 days — 3 reports flagged as inaccurate", int(time.time())))
    db.commit(); db.close()

def get_leaderboard(limit: int = 20) -> list:
    """Top reporters by confirmed reports in last 30 days."""
    db = _conn()
    cutoff = int(time.time()) - 30 * 86400
    rows = db.execute(
        """SELECT u.username,
                  COUNT(r.id) as report_count,
                  SUM(r.upvotes) as total_upvotes,
                  u.report_streak as streak
           FROM reports r JOIN users u ON r.user_id=u.id
           WHERE r.created_at>? AND r.downvotes<5
           GROUP BY r.user_id ORDER BY report_count DESC, total_upvotes DESC LIMIT ?""",
        (cutoff, limit)
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]

# ── Contest tracking ──────────────────────────────────────────────────────────

def _masked_username(username: str | None) -> str:
    name = (username or "Trailhead user").strip()
    if len(name) <= 2:
        return name[0:1] + "***"
    return f"{name[:1]}***{name[-1:]}"

def _contest_bounds(period: str, month: str | None = None, year: str | None = None) -> tuple[str | None, str]:
    now_month, now_year = _contest_period()
    y = (year or now_year)[:4]
    m = (month or now_month)[:7]
    return (m if period == "month" else None), y

def get_contest_leaderboard(period: str = "month", limit: int = 50,
                            month: str | None = None, year: str | None = None) -> list[dict]:
    period = "year" if period == "year" else "month"
    m, y = _contest_bounds(period, month, year)
    db = _conn()
    if period == "month":
        rows = db.execute(
            """SELECT u.id AS user_id,u.username,COALESCE(SUM(e.points),0) AS points,COUNT(e.id) AS event_count
               FROM contest_events e JOIN users u ON u.id=e.user_id
               WHERE e.period_month=?
               GROUP BY e.user_id
               ORDER BY points DESC,event_count DESC,MAX(e.created_at) ASC
               LIMIT ?""",
            (m, limit),
        ).fetchall()
    else:
        rows = db.execute(
            """SELECT u.id AS user_id,u.username,COALESCE(SUM(e.points),0) AS points,COUNT(e.id) AS event_count
               FROM contest_events e JOIN users u ON u.id=e.user_id
               WHERE e.period_year=?
               GROUP BY e.user_id
               ORDER BY points DESC,event_count DESC,MAX(e.created_at) ASC
               LIMIT ?""",
            (y, limit),
        ).fetchall()
    db.close()
    out = []
    for idx, row in enumerate(rows, start=1):
        d = dict(row)
        d["rank"] = idx
        d["display_name"] = _masked_username(d.get("username"))
        out.append(d)
    return out

def get_contest_user_status(user_id: int) -> dict:
    month, year = _contest_period()
    db = _conn()
    month_points = db.execute(
        "SELECT COALESCE(SUM(points),0) AS total FROM contest_events WHERE user_id=? AND period_month=?",
        (user_id, month),
    ).fetchone()["total"]
    year_points = db.execute(
        "SELECT COALESCE(SUM(points),0) AS total FROM contest_events WHERE user_id=? AND period_year=?",
        (user_id, year),
    ).fetchone()["total"]
    entry = db.execute(
        "SELECT * FROM contest_entries WHERE user_id=? AND period_month=?",
        (user_id, month),
    ).fetchone()
    month_rank = None
    for row in get_contest_leaderboard("month", 500, month=month, year=year):
        if row["user_id"] == user_id:
            month_rank = row["rank"]; break
    year_rank = None
    for row in get_contest_leaderboard("year", 500, year=year):
        if row["user_id"] == user_id:
            year_rank = row["rank"]; break
    db.close()
    return {
        "period_month": month,
        "period_year": year,
        "month_points": int(month_points or 0),
        "year_points": int(year_points or 0),
        "month_rank": month_rank,
        "year_rank": year_rank,
        "drawing_entered": bool(entry),
        "drawing_entry_type": entry["entry_type"] if entry else None,
    }

def ensure_contest_entry(user_id: int, entry_type: str = "free") -> dict:
    month, year = _contest_period()
    entry_type = "subscriber" if entry_type == "subscriber" else "free"
    now = int(time.time())
    db = _conn()
    db.execute(
        """INSERT OR IGNORE INTO contest_entries (user_id,period_month,period_year,entry_type,created_at)
           VALUES (?,?,?,?,?)""",
        (user_id, month, year, entry_type, now),
    )
    row = db.execute(
        "SELECT * FROM contest_entries WHERE user_id=? AND period_month=?",
        (user_id, month),
    ).fetchone()
    db.commit(); db.close()
    return dict(row) if row else {}

def get_contest_admin_overview(month: str | None = None, year: str | None = None) -> dict:
    month = (month or _contest_period()[0])[:7]
    year = (year or _contest_period()[1])[:4]
    db = _conn()
    now = int(time.time())
    active_subs = db.execute(
        "SELECT id FROM users WHERE plan_type!='free' AND COALESCE(plan_expires_at,0)>?",
        (now,),
    ).fetchall()
    for sub in active_subs:
        db.execute(
            """INSERT OR IGNORE INTO contest_entries (user_id,period_month,period_year,entry_type,created_at)
               VALUES (?,?,?,?,?)""",
            (sub["id"], month, year, "subscriber", now),
        )
    db.commit()
    entries = db.execute("SELECT COUNT(*) AS c FROM contest_entries WHERE period_month=?", (month,)).fetchone()["c"]
    free_entries = db.execute("SELECT COUNT(*) AS c FROM contest_entries WHERE period_month=? AND entry_type='free'", (month,)).fetchone()["c"]
    sub_entries = db.execute("SELECT COUNT(*) AS c FROM contest_entries WHERE period_month=? AND entry_type='subscriber'", (month,)).fetchone()["c"]
    awards = [dict(r) for r in db.execute(
        """SELECT a.*,u.email FROM contest_awards a LEFT JOIN users u ON u.id=a.winner_user_id
           WHERE a.period_year=? ORDER BY a.created_at DESC LIMIT 80""",
        (year,),
    ).fetchall()]
    db.close()
    return {
        "period_month": month,
        "period_year": year,
        "entries": entries,
        "free_entries": free_entries,
        "subscriber_entries": sub_entries,
        "month_leaders": get_contest_leaderboard("month", 25, month=month, year=year),
        "year_leaders": get_contest_leaderboard("year", 25, year=year),
        "awards": awards,
    }

def snapshot_contest_award(prize_type: str, admin_id: int, month: str | None = None,
                           year: str | None = None, notes: str = "") -> dict:
    month = (month or _contest_period()[0])[:7]
    year = (year or _contest_period()[1])[:4]
    is_year = prize_type == "yearly_top"
    leaders = get_contest_leaderboard("year" if is_year else "month", 1, month=month, year=year)
    winner = leaders[0] if leaders else None
    prize_label = "$1,000 cash/card + 1 year Explorer" if is_year else "$100 cash/card + 1 year Explorer"
    now = int(time.time())
    db = _conn()
    cur = db.execute(
        """INSERT INTO contest_awards
           (prize_type,period_month,period_year,winner_user_id,winner_username,points_snapshot,entry_count,prize_label,status,notes,awarded_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            prize_type,
            None if is_year else month,
            year,
            winner.get("user_id") if winner else None,
            winner.get("username") if winner else None,
            int(winner.get("points") or 0) if winner else 0,
            0,
            prize_label,
            "selected",
            notes,
            admin_id,
            now,
            now,
        ),
    )
    row = db.execute("SELECT * FROM contest_awards WHERE id=?", (cur.lastrowid,)).fetchone()
    db.commit(); db.close()
    return dict(row)

def run_contest_drawing(admin_id: int, month: str | None = None, year: str | None = None,
                        notes: str = "") -> dict:
    month = (month or _contest_period()[0])[:7]
    year = (year or _contest_period()[1])[:4]
    db = _conn()
    rows = db.execute(
        """SELECT e.*,u.username FROM contest_entries e JOIN users u ON u.id=e.user_id
           WHERE e.period_month=? ORDER BY e.created_at ASC""",
        (month,),
    ).fetchall()
    entries = [dict(r) for r in rows]
    winner = random.choice(entries) if entries else None
    now = int(time.time())
    cur = db.execute(
        """INSERT INTO contest_awards
           (prize_type,period_month,period_year,winner_user_id,winner_username,points_snapshot,entry_count,prize_label,status,notes,awarded_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            "monthly_drawing",
            month,
            year,
            winner.get("user_id") if winner else None,
            winner.get("username") if winner else None,
            0,
            len(entries),
            "$50 cash/card + 1 year Explorer",
            "selected",
            notes,
            admin_id,
            now,
            now,
        ),
    )
    row = db.execute("SELECT * FROM contest_awards WHERE id=?", (cur.lastrowid,)).fetchone()
    db.commit(); db.close()
    return dict(row)

def update_contest_award_status(award_id: int, status: str, notes: str = "") -> dict | None:
    allowed = {"selected", "notified", "paid", "void"}
    if status not in allowed:
        return None
    db = _conn()
    db.execute(
        "UPDATE contest_awards SET status=?, notes=?, updated_at=? WHERE id=?",
        (status, notes, int(time.time()), award_id),
    )
    row = db.execute("SELECT * FROM contest_awards WHERE id=?", (award_id,)).fetchone()
    db.commit(); db.close()
    return dict(row) if row else None

def backfill_contest_events_from_credits() -> int:
    db = _conn()
    existing = db.execute("SELECT COUNT(*) AS c FROM contest_events").fetchone()["c"]
    if existing:
        db.close()
        return 0
    rows = db.execute("SELECT * FROM credit_transactions WHERE amount>0 ORDER BY created_at ASC").fetchall()
    count = 0
    for r in rows:
        source = _contest_source_type(r["reason"])
        if not source:
            continue
        before = db.total_changes
        _record_contest_event_db(db, r["user_id"], r["amount"], r["reason"], source, f"credit:{r['id']}", r["created_at"])
        if db.total_changes > before:
            count += 1
    db.commit(); db.close()
    return count


# ── Contributor profiles ─────────────────────────────────────────────────────

CONTRIBUTOR_TIERS = [
    {"id": "first_tracks", "label": "First Tracks", "points_required": 0},
    {"id": "trail_scout", "label": "Trail Scout", "points_required": 50},
    {"id": "camp_finder", "label": "Camp Finder", "points_required": 250},
    {"id": "backroad_mapper", "label": "Backroad Mapper", "points_required": 750},
    {"id": "ridge_runner", "label": "Ridge Runner", "points_required": 1500},
    {"id": "desert_proven", "label": "Desert Proven", "points_required": 3000},
    {"id": "expedition_legend", "label": "Expedition Legend", "points_required": 7500},
]

def _contributor_tier(points: int) -> dict:
    points = int(points or 0)
    current = CONTRIBUTOR_TIERS[0]
    next_tier = None
    for idx, tier in enumerate(CONTRIBUTOR_TIERS):
        if points >= tier["points_required"]:
            current = tier
            next_tier = CONTRIBUTOR_TIERS[idx + 1] if idx + 1 < len(CONTRIBUTOR_TIERS) else None
    if next_tier:
        span = max(1, next_tier["points_required"] - current["points_required"])
        progress = max(0, min(1, (points - current["points_required"]) / span))
    else:
        progress = 1
    return {
        **current,
        "next_label": next_tier["label"] if next_tier else None,
        "next_points": next_tier["points_required"] if next_tier else None,
        "progress": progress,
    }

def _sum_points(db: sqlite3.Connection, user_id: int, period: str) -> int:
    if period == "month":
        month = _contest_period()[0]
        row = db.execute(
            "SELECT COALESCE(SUM(points),0) AS total FROM contest_events WHERE user_id=? AND period_month=?",
            (user_id, month),
        ).fetchone()
    elif period == "year":
        year = _contest_period()[1]
        row = db.execute(
            "SELECT COALESCE(SUM(points),0) AS total FROM contest_events WHERE user_id=? AND period_year=?",
            (user_id, year),
        ).fetchone()
    else:
        row = db.execute(
            "SELECT COALESCE(SUM(points),0) AS total FROM contest_events WHERE user_id=?",
            (user_id,),
        ).fetchone()
    return int(row["total"] or 0) if row else 0

def _rank_for_user(user_id: int, period: str) -> int | None:
    for row in get_contributor_leaderboard(period, 500):
        if row["user_id"] == user_id:
            return row["rank_number"]
    return None

def _contributor_stats(db: sqlite3.Connection, user_id: int) -> tuple[dict, list[dict]]:
    rows = db.execute(
        """SELECT COALESCE(source_type,'contribution') AS source_type,
                  COUNT(*) AS count,
                  COALESCE(SUM(points),0) AS points
           FROM contest_events
           WHERE user_id=?
           GROUP BY COALESCE(source_type,'contribution')
           ORDER BY points DESC,count DESC""",
        (user_id,),
    ).fetchall()
    counts = {r["source_type"]: int(r["count"] or 0) for r in rows}
    points = {r["source_type"]: int(r["points"] or 0) for r in rows}
    camp_reports = int(counts.get("camp_field_report", 0))
    trail_reports = int(counts.get("trail_field_report", 0))
    photo_reports = db.execute(
        """SELECT
              (SELECT COUNT(*) FROM camp_field_reports WHERE user_id=? AND COALESCE(photo_data,'')!='') +
              (SELECT COUNT(*) FROM trail_field_reports WHERE user_id=? AND COALESCE(photo_data,'')!='') +
              (SELECT COUNT(*) FROM place_photos WHERE user_id=? AND status!='removed') AS c""",
        (user_id, user_id, user_id),
    ).fetchone()["c"]
    report_rows = int(db.execute("SELECT COUNT(*) AS c FROM reports WHERE user_id=?", (user_id,)).fetchone()["c"])
    pin_rows = int(db.execute("SELECT COUNT(*) AS c FROM community_pins WHERE user_id=?", (user_id,)).fetchone()["c"])
    stats = {
        "total_events": sum(counts.values()),
        "reports": report_rows,
        "pins": pin_rows,
        "camp_reports": camp_reports,
        "trail_reports": trail_reports,
        "confirmations": int(counts.get("report_confirmation", 0)),
        "photos": int(photo_reports or 0),
        "edits": int(counts.get("camp_edit_suggestion", 0) + counts.get("place_edit_suggestion", 0)),
        "camp_status": int(counts.get("camp_status", 0)),
        "signal_water_road": int(counts.get("report_confirmation", 0) + counts.get("report_upvote", 0)),
    }
    labels = {
        "camp_field_report": "Camp field reports",
        "trail_field_report": "Trail field reports",
        "report_confirmation": "Confirmed reports",
        "report_upvote": "Helpful votes",
        "streak_bonus": "Streak bonuses",
        "camp_edit_suggestion": "Camp edits",
        "place_edit_suggestion": "Place edits",
        "place_photo": "Place photos",
        "camp_status": "Camp status updates",
    }
    recent = [
        {"label": labels.get(r["source_type"], str(r["source_type"]).replace("_", " ").title()),
         "count": int(r["count"] or 0), "points": int(points.get(r["source_type"], 0))}
        for r in rows[:6]
    ]
    return stats, recent

def _contributor_awards(db: sqlite3.Connection, user_id: int) -> list[dict]:
    rows = db.execute(
        """SELECT id,prize_type,period_month,period_year,prize_label,status,created_at
           FROM contest_awards
           WHERE winner_user_id=? AND status!='void'
           ORDER BY created_at DESC LIMIT 20""",
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]

def _auto_contributor_badges(stats: dict, awards: list[dict], all_points: int, joined_at: int | None) -> list[dict]:
    earned: list[dict] = []
    def add(badge_id: str, label: str, description: str, icon: str, tone: str):
        earned.append({
            "id": badge_id, "label": label, "description": description,
            "icon": icon, "tone": tone, "source": "auto", "earned_at": joined_at,
        })
    if stats.get("total_events", 0) >= 1:
        add("first_tracks", "First Tracks", "Logged a first useful field contribution.", "trail-sign", "green")
    if stats.get("signal_water_road", 0) >= 10:
        add("signal_finder", "Signal Finder", "Helped verify road, signal, or condition reports.", "radio", "blue")
    if stats.get("camp_reports", 0) >= 10:
        add("camp_steward", "Camp Steward", "Submitted 10 camp field reports.", "bonfire", "teal")
    if stats.get("trail_reports", 0) >= 10:
        add("trail_steward", "Trail Steward", "Submitted 10 trail field reports.", "map", "orange")
    if stats.get("photos", 0) >= 25:
        add("photo_scout", "Photo Scout", "Added 25 photo-backed reports.", "camera", "purple")
    if any(a.get("prize_type") == "monthly_top" for a in awards):
        add("month_leader", "Month Leader", "Finished a month as top contributor.", "trophy", "gold")
    if any(a.get("prize_type") == "yearly_top" for a in awards):
        add("trailhead_champion", "Trailhead Champion", "Won the yearly contributor title.", "ribbon", "gold")
    for tier in CONTRIBUTOR_TIERS[1:]:
        if all_points >= tier["points_required"]:
            add(tier["id"], tier["label"], f"Reached {tier['points_required']:,} lifetime contribution points.", "medal", "gold")
    return earned

def _manual_contributor_badges(db: sqlite3.Connection, user_id: int) -> list[dict]:
    rows = db.execute(
        "SELECT badge_id,label,description,created_at FROM contributor_badges WHERE user_id=? ORDER BY created_at DESC",
        (user_id,),
    ).fetchall()
    return [{
        "id": r["badge_id"], "label": r["label"], "description": r["description"] or "",
        "icon": "sparkles", "tone": "gold", "source": "admin", "earned_at": r["created_at"],
    } for r in rows]

def _avatar_color(user_id: int, stored: str | None) -> str:
    if stored:
        return stored
    colors = ["#f97316", "#14b8a6", "#38bdf8", "#a78bfa", "#d4af37", "#22c55e"]
    return colors[int(user_id or 0) % len(colors)]

def get_contributor_profile(user_id: int, viewer_id: int | None = None) -> dict | None:
    db = _conn()
    user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        db.close()
        return None
    is_self = viewer_id == user_id
    visible = bool(user["public_profile_visible"])
    if not visible and not is_self:
        db.close()
        return None
    month_points = _sum_points(db, user_id, "month")
    year_points = _sum_points(db, user_id, "year")
    all_points = _sum_points(db, user_id, "all")
    stats, recent = _contributor_stats(db, user_id)
    awards = _contributor_awards(db, user_id)
    badges = _manual_contributor_badges(db, user_id) + _auto_contributor_badges(stats, awards, all_points, user["created_at"])
    map_contributor_row = db.execute(
        """SELECT status,created_at,updated_at FROM map_contributor_applications
           WHERE user_id=? ORDER BY updated_at DESC,id DESC LIMIT 1""",
        (user_id,),
    ).fetchone()
    map_contributor_status = map_contributor_row["status"] if map_contributor_row else "not_applied"
    seen = set()
    unique_badges = []
    for badge in badges:
        if badge["id"] in seen:
            continue
        seen.add(badge["id"])
        unique_badges.append(badge)
    tier = _contributor_tier(all_points)
    profile = {
        "user_id": user_id,
        "username": user["username"],
        "display_name": user["username"],
        "is_self": is_self,
        "public_profile_visible": visible,
        "title": user["contributor_title"] or tier["label"],
        "bio": user["contributor_bio"] or "",
        "avatar_color": _avatar_color(user_id, user["contributor_avatar_color"]),
        "joined_at": user["created_at"],
        "points": {"month": month_points, "year": year_points, "all": all_points},
        "rank": {
            "month": _rank_for_user(user_id, "month"),
            "year": _rank_for_user(user_id, "year"),
            "all": _rank_for_user(user_id, "all"),
        },
        "streak": int(user["report_streak"] or 0),
        "tier": tier,
        "stats": stats,
        "badges": unique_badges,
        "awards": awards,
        "recent_activity": recent,
        "map_contributor": {
            "status": map_contributor_status,
            "approved": map_contributor_status == "approved",
            "updated_at": map_contributor_row["updated_at"] if map_contributor_row else None,
        },
    }
    db.close()
    return profile

def get_contributor_leaderboard(period: str = "month", limit: int = 50, viewer_id: int | None = None) -> list[dict]:
    period = period if period in {"month", "year", "all"} else "month"
    now_month, now_year = _contest_period()
    where = "COALESCE(u.public_profile_visible,1)=1"
    params: list = []
    if period == "month":
        where += " AND e.period_month=?"
        params.append(now_month)
    elif period == "year":
        where += " AND e.period_year=?"
        params.append(now_year)
    params.append(limit)
    db = _conn()
    rows = db.execute(
        f"""SELECT u.id AS user_id,u.username,u.report_streak,u.contributor_title,u.contributor_avatar_color,
                  COALESCE(SUM(e.points),0) AS points_for_period,
                  COUNT(e.id) AS event_count,
                  MAX(e.created_at) AS last_event
           FROM contest_events e JOIN users u ON u.id=e.user_id
           WHERE {where}
           GROUP BY e.user_id
           ORDER BY points_for_period DESC,event_count DESC,last_event ASC
           LIMIT ?""",
        params,
    ).fetchall()
    leaders = []
    for idx, r in enumerate(rows, start=1):
        user_id = int(r["user_id"])
        all_points = _sum_points(db, user_id, "all")
        stats, _recent = _contributor_stats(db, user_id)
        awards = _contributor_awards(db, user_id)
        badges = (_manual_contributor_badges(db, user_id) + _auto_contributor_badges(stats, awards, all_points, None))[:4]
        tier = _contributor_tier(all_points)
        leaders.append({
            "user_id": user_id,
            "username": r["username"],
            "display_name": r["username"],
            "is_self": viewer_id == user_id,
            "rank_number": idx,
            "points_for_period": int(r["points_for_period"] or 0),
            "points": {
                "month": _sum_points(db, user_id, "month"),
                "year": _sum_points(db, user_id, "year"),
                "all": all_points,
            },
            "title": r["contributor_title"] or tier["label"],
            "avatar_color": _avatar_color(user_id, r["contributor_avatar_color"]),
            "streak": int(r["report_streak"] or 0),
            "tier": tier,
            "stats": stats,
            "badges": badges,
            "awards": awards[:3],
            "event_count": int(r["event_count"] or 0),
        })
    db.close()
    return leaders

def set_contributor_visibility(user_id: int, visible: bool) -> dict | None:
    db = _conn()
    db.execute("UPDATE users SET public_profile_visible=? WHERE id=?", (1 if visible else 0, user_id))
    db.commit(); db.close()
    return get_contributor_profile(user_id, user_id)

def submit_map_contributor_application(user_id: int, username: str, experience: str, regions: str, sample_note: str) -> dict:
    now = int(time.time())
    db = _conn()
    row = db.execute(
        "SELECT * FROM map_contributor_applications WHERE user_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    if row:
        db.execute(
            """UPDATE map_contributor_applications
               SET username=?,experience=?,regions=?,sample_note=?,updated_at=? WHERE id=?""",
            (username, experience[:2000], regions[:500], sample_note[:2000], now, row["id"]),
        )
        app_id = row["id"]
    else:
        cur = db.execute(
            """INSERT INTO map_contributor_applications
               (user_id,username,experience,regions,sample_note,status,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (user_id, username, experience[:2000], regions[:500], sample_note[:2000], "pending", now, now),
        )
        app_id = cur.lastrowid
    out = db.execute("SELECT * FROM map_contributor_applications WHERE id=?", (app_id,)).fetchone()
    db.commit(); db.close()
    return dict(out)

def get_map_contributor_applications(status: str | None = "pending", limit: int = 200) -> list[dict]:
    db = _conn()
    if status:
        rows = db.execute(
            "SELECT * FROM map_contributor_applications WHERE status=? ORDER BY created_at DESC LIMIT ?",
            (status, limit),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM map_contributor_applications ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    db.close()
    return [dict(r) for r in rows]

def update_map_contributor_application_status(application_id: int, status: str) -> bool:
    if status not in {"pending", "approved", "dismissed"}:
        return False
    db = _conn()
    row = db.execute("SELECT * FROM map_contributor_applications WHERE id=?", (application_id,)).fetchone()
    if not row:
        db.close()
        return False
    cur = db.execute(
        "UPDATE map_contributor_applications SET status=?,updated_at=? WHERE id=?",
        (status, int(time.time()), application_id),
    )
    if status == "approved":
        db.execute(
            """INSERT OR REPLACE INTO contributor_badges (user_id,badge_id,label,description,granted_by,created_at)
               VALUES (?,?,?,?,?,?)""",
            (
                row["user_id"],
                "map_contributor",
                "Map Contributor",
                "Approved to review private map leads.",
                None,
                int(time.time()),
            ),
        )
    db.commit(); db.close()
    return cur.rowcount > 0

def has_approved_map_contributor(user_id: int | None) -> bool:
    if not user_id:
        return False
    db = _conn()
    row = db.execute(
        "SELECT status FROM map_contributor_applications WHERE user_id=? ORDER BY updated_at DESC,id DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    db.close()
    return bool(row and row["status"] == "approved")

def grant_contributor_badge(user_id: int, badge_id: str, label: str, description: str = "", admin_id: int | None = None) -> dict | None:
    now = int(time.time())
    db = _conn()
    db.execute(
        """INSERT OR REPLACE INTO contributor_badges (user_id,badge_id,label,description,granted_by,created_at)
           VALUES (?,?,?,?,?,?)""",
        (user_id, badge_id, label, description, admin_id, now),
    )
    db.commit(); db.close()
    return get_contributor_profile(user_id, admin_id)

# ── Community pins ─────────────────────────────────────────────────────────────

def _decode_pin_details(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    raw = data.get("details")
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            data["details"] = parsed if isinstance(parsed, dict) else {}
        except Exception:
            data["details"] = {}
    elif raw is None:
        data["details"] = {}
    return data

def find_duplicate_community_pin(lat: float, lng: float, pin_type: str, name: str = "", radius_deg: float = 0.00018) -> dict | None:
    db = _conn()
    name_norm = (name or "").strip().lower()
    rows = db.execute(
        """SELECT * FROM community_pins
           WHERE hidden=0 AND type=? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
           ORDER BY submitted_at DESC LIMIT 20""",
        (pin_type, lat - radius_deg, lat + radius_deg, lng - radius_deg, lng + radius_deg)
    ).fetchall()
    db.close()
    for row in rows:
        data = dict(row)
        other_name = (data.get("name") or "").strip().lower()
        if not name_norm or not other_name or name_norm == other_name:
            return data
    return dict(rows[0]) if rows else None

def add_community_pin(lat: float, lng: float, name: str, type: str,
                      description: str, land_type: str, user_id: int | None = None,
                      details: dict | None = None) -> int:
    db = _conn()
    cur = db.execute(
        "INSERT INTO community_pins (user_id,lat,lng,name,type,description,details,land_type,submitted_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (user_id, lat, lng, name, type, description, json.dumps(details or {}), land_type, int(time.time()))
    )
    pin_id = cur.lastrowid
    db.commit(); db.close()
    return int(pin_id)

def get_user_pin_count_today(user_id: int) -> int:
    db = _conn()
    cutoff = int(time.time()) - 86400
    row = db.execute(
        "SELECT COUNT(*) AS c FROM community_pins WHERE user_id=? AND submitted_at>?",
        (user_id, cutoff)
    ).fetchone()
    db.close()
    return int(row["c"] or 0)

def get_community_pins(lat: float, lng: float, radius_deg: float = 1.0) -> list:
    db = _conn()
    rows = db.execute(
        """SELECT * FROM community_pins
           WHERE hidden=0 AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
           ORDER BY upvotes DESC, submitted_at DESC LIMIT 150""",
        (lat-radius_deg, lat+radius_deg, lng-radius_deg, lng+radius_deg)
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]

def vote_community_pin(pin_id: int, user_id: int, action: str) -> dict:
    if action not in {"upvote", "downvote"}:
        return {"ok": False, "reason": "bad_action"}
    db = _conn()
    row = db.execute("SELECT user_id, upvotes, downvotes FROM community_pins WHERE id=?", (pin_id,)).fetchone()
    if not row:
        db.close()
        return {"ok": False, "reason": "not_found"}
    if row["user_id"] == user_id:
        db.close()
        return {"ok": False, "reason": "own_pin"}
    try:
        db.execute(
            "INSERT INTO pin_interactions (pin_id,user_id,action,created_at) VALUES (?,?,?,?)",
            (pin_id, user_id, action, int(time.time()))
        )
    except sqlite3.IntegrityError:
        db.close()
        return {"ok": False, "reason": "already_voted"}
    col = "upvotes" if action == "upvote" else "downvotes"
    db.execute(f"UPDATE community_pins SET {col}={col}+1 WHERE id=?", (pin_id,))
    updated = db.execute("SELECT upvotes, downvotes FROM community_pins WHERE id=?", (pin_id,)).fetchone()
    hidden = 1 if updated["downvotes"] >= 3 and updated["downvotes"] > updated["upvotes"] + 1 else 0
    if hidden:
        db.execute("UPDATE community_pins SET hidden=1 WHERE id=?", (pin_id,))
    db.commit(); db.close()
    return {"ok": True, "hidden": bool(hidden), "upvotes": updated["upvotes"], "downvotes": updated["downvotes"]}

def add_pin_update_suggestion(pin_id: int, pin_name: str, user_id: int | None, username: str | None,
                              field: str, value: str, note: str | None = None) -> dict:
    db = _conn()
    cur = db.execute(
        """INSERT INTO pin_update_suggestions
           (pin_id,pin_name,user_id,username,field,value,note,status,created_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (pin_id, pin_name[:120], user_id, username, field[:60], value[:1000], note[:700] if note else None, "pending", int(time.time()))
    )
    db.commit()
    suggestion_id = cur.lastrowid
    db.close()
    return {"id": suggestion_id, "status": "pending"}

def get_pin_update_suggestions(status: str | None = "pending", limit: int = 200) -> list[dict]:
    db = _conn()
    if status:
      rows = db.execute(
          "SELECT * FROM pin_update_suggestions WHERE status=? ORDER BY created_at DESC LIMIT ?",
          (status, limit)
      ).fetchall()
    else:
      rows = db.execute("SELECT * FROM pin_update_suggestions ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    db.close()
    return [dict(r) for r in rows]

def update_pin_update_suggestion_status(suggestion_id: int, status: str) -> bool:
    db = _conn()
    cur = db.execute("UPDATE pin_update_suggestions SET status=? WHERE id=?", (status, suggestion_id))
    db.commit()
    ok = cur.rowcount > 0
    db.close()
    return ok

# ── Admin ─────────────────────────────────────────────────────────────────────

def get_platform_stats() -> dict:
    db = _conn()
    now = int(time.time())
    day  = now - 86400
    week = now - 7 * 86400
    mon  = now - 30 * 86400

    def scalar(sql, *args):
        return db.execute(sql, args).fetchone()[0] or 0

    stats = {
        "users_total":   scalar("SELECT COUNT(*) FROM users"),
        "users_today":   scalar("SELECT COUNT(*) FROM users WHERE created_at>?", day),
        "users_7d":      scalar("SELECT COUNT(*) FROM users WHERE created_at>?", week),
        "users_30d":     scalar("SELECT COUNT(*) FROM users WHERE created_at>?", mon),
        "reports_active":scalar("SELECT COUNT(*) FROM reports WHERE (expires_at IS NULL OR expires_at>?) AND downvotes<5", now),
        "reports_today": scalar("SELECT COUNT(*) FROM reports WHERE created_at>?", day),
        "reports_7d":    scalar("SELECT COUNT(*) FROM reports WHERE created_at>?", week),
        "reports_30d":   scalar("SELECT COUNT(*) FROM reports WHERE created_at>?", mon),
        "trips_total":   scalar("SELECT COUNT(*) FROM trips"),
        "trips_today":   scalar("SELECT COUNT(*) FROM trips WHERE created_at>?", day),
        "trips_7d":      scalar("SELECT COUNT(*) FROM trips WHERE created_at>?", week),
        "credits_total": scalar("SELECT COALESCE(SUM(credits),0) FROM users"),
        "pins_total":    scalar("SELECT COUNT(*) FROM community_pins"),
    }

    # Report breakdown by type
    rows = db.execute(
        """SELECT type, COUNT(*) as cnt FROM reports
           WHERE (expires_at IS NULL OR expires_at>?) AND downvotes<5
           GROUP BY type ORDER BY cnt DESC""", (now,)
    ).fetchall()
    stats["by_type"] = [{"type": r["type"], "count": r["cnt"]} for r in rows]

    db.close()
    return stats

def get_all_users(search: str = "", limit: int = 50, offset: int = 0) -> list:
    db = _conn()
    like = f"%{search}%"
    rows = db.execute(
        """SELECT u.id, u.username, u.email, u.credits, u.is_admin,
                  u.report_streak, u.flagged_report_count, u.created_at,
                  u.reporting_restricted_until, u.plan_type, u.plan_expires_at,
                  COUNT(r.id) as report_count
           FROM users u
           LEFT JOIN reports r ON r.user_id=u.id
           WHERE u.username LIKE ? OR u.email LIKE ?
           GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?""",
        (like, like, limit, offset)
    ).fetchall()
    db.close()
    return [_decode_pin_details(r) for r in rows]

def set_user_admin(user_id: int, is_admin: bool):
    db = _conn()
    db.execute("UPDATE users SET is_admin=? WHERE id=?", (1 if is_admin else 0, user_id))
    db.commit(); db.close()

def set_user_plan(user_id: int, plan_type: str, expires_at: int | None = None) -> dict | None:
    db = _conn()
    if plan_type == "free":
        db.execute("UPDATE users SET plan_type='free', plan_expires_at=NULL WHERE id=?", (user_id,))
    else:
        if expires_at is None:
            expires_at = int(time.time()) + 366 * 86400
        db.execute("UPDATE users SET plan_type=?, plan_expires_at=? WHERE id=?", (plan_type, expires_at, user_id))
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    db.close()
    return _decode_pin_details(row) if row else None

def save_app_store_subscription(original_transaction_id: str, transaction_id: str | None,
                                user_id: int, product_id: str, environment: str | None,
                                expires_at: int | None, status: str = "active") -> None:
    db = _conn()
    db.execute(
        """INSERT INTO app_store_subscriptions
           (original_transaction_id,transaction_id,user_id,product_id,environment,expires_at,status,updated_at)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(original_transaction_id) DO UPDATE SET
             transaction_id=excluded.transaction_id,
             user_id=excluded.user_id,
             product_id=excluded.product_id,
             environment=excluded.environment,
             expires_at=excluded.expires_at,
             status=excluded.status,
             updated_at=excluded.updated_at""",
        (original_transaction_id, transaction_id, user_id, product_id, environment, expires_at, status, int(time.time()))
    )
    db.commit(); db.close()

def get_app_store_subscription(original_transaction_id: str) -> dict | None:
    db = _conn()
    row = db.execute(
        "SELECT * FROM app_store_subscriptions WHERE original_transaction_id=?",
        (original_transaction_id,),
    ).fetchone()
    db.close()
    return dict(row) if row else None

def ban_user(user_id: int, days: int = 365):
    db = _conn()
    until = int(time.time()) + days * 86400
    db.execute("UPDATE users SET reporting_restricted_until=? WHERE id=?", (until, user_id))
    db.commit(); db.close()

def get_all_reports(limit: int = 100, include_expired: bool = False) -> list:
    db = _conn()
    now = int(time.time())
    where = "" if include_expired else "WHERE (r.expires_at IS NULL OR r.expires_at>?) AND r.downvotes<5"
    params = [] if include_expired else [now]
    rows = db.execute(
        f"""SELECT r.id, r.lat, r.lng, r.type, r.subtype, r.severity,
                   r.upvotes, r.downvotes, r.confirmations, r.has_photo,
                   r.created_at, r.expires_at, r.description,
                   u.username
            FROM reports r JOIN users u ON r.user_id=u.id
            {where} ORDER BY r.created_at DESC LIMIT ?""",
        params + [limit]
    ).fetchall()
    db.close()
    return [_decode_pin_details(r) for r in rows]

def expire_report(report_id: int):
    db = _conn()
    db.execute("UPDATE reports SET expires_at=? WHERE id=?", (int(time.time()) - 1, report_id))
    db.commit(); db.close()

def delete_report(report_id: int):
    db = _conn()
    db.execute("DELETE FROM reports WHERE id=?", (report_id,))
    db.commit(); db.close()

def get_all_trips(limit: int = 50) -> list:
    db = _conn()
    rows = db.execute(
        """SELECT t.id, t.created_at, t.request,
                  json_extract(t.plan,'$.plan.trip_name') as trip_name,
                  json_extract(t.plan,'$.plan.duration_days') as duration_days,
                  json_extract(t.plan,'$.plan.states') as states,
                  u.username
           FROM trips t LEFT JOIN users u ON t.user_id=u.id
           ORDER BY t.created_at DESC LIMIT ?""",
        (limit,)
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]

def get_all_pins(limit: int = 100) -> list:
    db = _conn()
    rows = db.execute(
        """SELECT p.*, u.username FROM community_pins p
           LEFT JOIN users u ON p.user_id=u.id
           ORDER BY p.submitted_at DESC LIMIT ?""", (limit,)
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]

def delete_pin(pin_id: int):
    db = _conn()
    db.execute("DELETE FROM community_pins WHERE id=?", (pin_id,))
    db.commit(); db.close()

def submit_bug_report(
    user_id: int | None,
    username: str | None,
    title: str,
    description: str,
    app_version: str = '',
    category: str = 'bug',
    source_surface: str = '',
    screenshot_data: str = '',
    screenshot_content_type: str = '',
    ai_context: dict | list | None = None,
) -> int:
    db = _conn()
    ai_context_json = json.dumps(ai_context) if ai_context is not None else None
    cur = db.execute(
        """INSERT INTO bug_reports (
            user_id, username, title, description, app_version,
            category, source_surface, screenshot_data, screenshot_content_type,
            ai_context_json, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            user_id,
            username,
            title,
            description,
            app_version,
            category or 'bug',
            source_surface or '',
            screenshot_data or None,
            screenshot_content_type or None,
            ai_context_json,
            int(time.time()),
        )
    )
    bug_id = cur.lastrowid
    db.commit(); db.close()
    return bug_id

def get_all_bug_reports(status: str | None = None) -> list:
    db = _conn()
    if status:
        rows = db.execute(
            "SELECT * FROM bug_reports WHERE status=? ORDER BY created_at DESC", (status,)
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM bug_reports ORDER BY created_at DESC").fetchall()
    db.close()
    return [dict(r) for r in rows]

def award_bug_credits(bug_id: int, credits: int) -> dict:
    db = _conn()
    bug = db.execute("SELECT * FROM bug_reports WHERE id=?", (bug_id,)).fetchone()
    if not bug:
        db.close(); raise ValueError("Bug report not found")
    db.execute("UPDATE bug_reports SET status='resolved', credits_awarded=? WHERE id=?", (credits, bug_id))
    if bug['user_id'] and credits > 0:
        db.execute("UPDATE users SET credits=credits+? WHERE id=?", (credits, bug['user_id']))
        db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
                   (bug['user_id'], credits, f"Bug report reward #{bug_id}", int(time.time())))
    db.commit(); db.close()
    return {"bug_id": bug_id, "credits_awarded": credits}

def dismiss_bug_report(bug_id: int):
    db = _conn()
    db.execute("UPDATE bug_reports SET status='dismissed' WHERE id=?", (bug_id,))
    db.commit(); db.close()

def ensure_admin_user(email: str, username: str, password_hash: str):
    """Create admin account if it doesn't exist. Idempotent."""
    db = _conn()
    existing = db.execute("SELECT id FROM users WHERE email=?", (email.lower(),)).fetchone()
    if existing:
        db.execute("UPDATE users SET is_admin=1, email_verified=1, email_verify_token=NULL WHERE email=?", (email.lower(),))
        db.commit(); db.close()
        return
    import secrets as _secrets
    code = f"admin-{_secrets.token_hex(4)}"
    db.execute(
        "INSERT INTO users (email,username,password_hash,referral_code,is_admin,email_verified,created_at) VALUES (?,?,?,?,1,1,?)",
        (email.lower(), username, password_hash, code, int(time.time()))
    )
    db.commit(); db.close()


# ── Camp briefs (permanent cache by facility_id) ──────────────────────────────

def get_camp_brief(facility_id: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT brief_json FROM camp_briefs WHERE facility_id=?", (facility_id,)).fetchone()
    if row:
        db.execute("UPDATE camp_briefs SET view_count=view_count+1 WHERE facility_id=?", (facility_id,))
        db.commit()
    db.close()
    return json.loads(row["brief_json"]) if row else None

def set_camp_brief(facility_id: str, data: dict):
    db = _conn()
    db.execute(
        "INSERT OR REPLACE INTO camp_briefs (facility_id, brief_json, generated_at) VALUES (?,?,?)",
        (facility_id, json.dumps(data), int(time.time()))
    )
    db.commit(); db.close()


# ── Subscription / plan helpers ───────────────────────────────────────────────

def has_active_plan(user: dict) -> bool:
    """True if user has a monthly or annual plan that hasn't expired."""
    plan = user.get("plan_type", "free")
    if plan == "free":
        return False
    expires = user.get("plan_expires_at")
    if expires is None:
        return False
    return int(time.time()) < expires

def _csv_set(value: str) -> set[str]:
    return {item.strip().lower() for item in (value or "").split(",") if item.strip()}

EXPLORER_PLAN_TYPES = {"explorer", "explorer_beta", "extreme", "extreme_beta"}

def get_extreme_admin_config() -> dict:
    db = _conn()
    rows = db.execute("SELECT config_key, value_json, updated_by, updated_at FROM extreme_admin_config").fetchall()
    db.close()
    config: dict = {}
    meta: dict = {}
    for row in rows:
        key = row["config_key"]
        try:
            config[key] = json.loads(row["value_json"])
        except Exception:
            config[key] = None
        meta[key] = {"updated_by": row["updated_by"], "updated_at": row["updated_at"]}
    config["_meta"] = meta
    return config

def set_extreme_admin_config(values: dict, updated_by: int | None = None) -> dict:
    now = int(time.time())
    db = _conn()
    for key, value in (values or {}).items():
        clean_key = re.sub(r"[^a-z0-9_.:-]+", "_", str(key or "").strip().lower())[:80]
        if not clean_key or clean_key.startswith("_"):
            continue
        db.execute(
            """INSERT INTO extreme_admin_config (config_key,value_json,updated_by,updated_at)
               VALUES (?,?,?,?)
               ON CONFLICT(config_key) DO UPDATE SET
                 value_json=excluded.value_json,
                 updated_by=excluded.updated_by,
                 updated_at=excluded.updated_at""",
            (clean_key, json.dumps(value), updated_by, now),
        )
    db.commit()
    db.close()
    return get_extreme_admin_config()

def has_extreme_plan(user: dict | None) -> bool:
    """Hidden beta entitlement for Extreme Explorer before public products exist."""
    if not user:
        return False
    if user.get("is_admin"):
        return True
    plan = str(user.get("plan_type") or "free").strip().lower()
    if plan in EXPLORER_PLAN_TYPES:
        expires = user.get("plan_expires_at")
        return expires is None or int(time.time()) < int(expires)
    beta_ids = _csv_set(settings.extreme_beta_user_ids)
    beta_emails = _csv_set(settings.extreme_beta_emails)
    return str(user.get("id")) in beta_ids or str(user.get("email") or "").lower() in beta_emails

def create_extreme_demo_session(user_id: int, surface: str, trip_id: str | None,
                                ttl_seconds: int, metadata: dict | None = None) -> dict:
    now = int(time.time())
    session_id = f"extreme_{secrets.token_hex(12)}"
    db = _conn()
    db.execute(
        """INSERT INTO extreme_demo_sessions
           (session_id,user_id,surface,trip_id,status,started_at,expires_at,metadata)
           VALUES (?,?,?,?,?,?,?,?)""",
        (session_id, user_id, surface, trip_id, "active", now, now + max(60, ttl_seconds), json.dumps(metadata or {})),
    )
    db.commit(); db.close()
    return {
        "session_id": session_id,
        "user_id": user_id,
        "surface": surface,
        "trip_id": trip_id,
        "status": "active",
        "started_at": now,
        "expires_at": now + max(60, ttl_seconds),
    }

def end_extreme_demo_session(user_id: int, session_id: str, reason: str = "ended") -> dict | None:
    db = _conn()
    row = db.execute(
        "SELECT * FROM extreme_demo_sessions WHERE user_id=? AND session_id=?",
        (user_id, session_id),
    ).fetchone()
    if not row:
        db.close()
        return None
    now = int(time.time())
    db.execute(
        "UPDATE extreme_demo_sessions SET status=?, ended_at=? WHERE user_id=? AND session_id=?",
        (reason[:40] or "ended", now, user_id, session_id),
    )
    db.commit()
    updated = db.execute("SELECT * FROM extreme_demo_sessions WHERE session_id=?", (session_id,)).fetchone()
    db.close()
    return dict(updated) if updated else None

def log_extreme_ledger_event(user_id: int, event_type: str, session_id: str | None = None,
                             surface: str | None = None, trip_id: str | None = None,
                             event_data: dict | None = None) -> int:
    db = _conn()
    cur = db.execute(
        """INSERT INTO extreme_ledger_events
           (session_id,user_id,event_type,surface,trip_id,event_data,created_at)
           VALUES (?,?,?,?,?,?,?)""",
        (session_id, user_id, event_type, surface, trip_id, json.dumps(event_data or {}), int(time.time())),
    )
    event_id = cur.lastrowid
    db.commit(); db.close()
    return event_id

def save_extreme_trip_metadata(user_id: int, trip_id: str, checkpoints: list | None = None,
                               trip_memory: dict | None = None) -> dict:
    clean_trip_id = str(trip_id or "").strip()[:120]
    if not clean_trip_id:
        raise ValueError("trip_id is required")
    now = int(time.time())
    db = _conn()
    db.execute(
        """INSERT INTO extreme_trip_metadata (user_id,trip_id,checkpoints,trip_memory,updated_at)
           VALUES (?,?,?,?,?)
           ON CONFLICT(user_id, trip_id) DO UPDATE SET
             checkpoints=excluded.checkpoints,
             trip_memory=excluded.trip_memory,
             updated_at=excluded.updated_at""",
        (user_id, clean_trip_id, json.dumps(checkpoints or []), json.dumps(trip_memory or {}), now),
    )
    db.commit(); db.close()
    return {"trip_id": clean_trip_id, "checkpoints": checkpoints or [], "trip_memory": trip_memory or {}, "updated_at": now}

def stage_extreme_copilot_action(user_id: int, command: str, action_type: str,
                                 session_id: str | None = None, trip_id: str | None = None,
                                 payload: dict | None = None) -> dict:
    now = int(time.time())
    db = _conn()
    cur = db.execute(
        """INSERT INTO extreme_copilot_actions
           (user_id,session_id,trip_id,command,action_type,status,payload,created_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (
            user_id,
            session_id,
            trip_id,
            str(command or "").strip()[:800],
            str(action_type or "review").strip()[:80],
            "staged",
            json.dumps(payload or {}),
            now,
        ),
    )
    action_id = cur.lastrowid
    db.commit()
    row = db.execute("SELECT * FROM extreme_copilot_actions WHERE id=?", (action_id,)).fetchone()
    db.close()
    out = dict(row) if row else {"id": action_id, "status": "staged"}
    try:
        out["payload"] = json.loads(out.get("payload") or "{}")
    except Exception:
        out["payload"] = {}
    return out

def confirm_extreme_copilot_action(user_id: int, action_id: int, confirmed: bool,
                                   client_result: dict | None = None) -> dict | None:
    db = _conn()
    row = db.execute(
        "SELECT * FROM extreme_copilot_actions WHERE id=? AND user_id=?",
        (action_id, user_id),
    ).fetchone()
    if not row:
        db.close()
        return None
    payload = {}
    try:
        payload = json.loads(row["payload"] or "{}")
    except Exception:
        payload = {}
    payload["confirmation"] = {
        "confirmed": bool(confirmed),
        "client_result": client_result or {},
        "at": int(time.time()),
    }
    if not confirmed:
        status = "canceled"
    else:
        result = client_result or {}
        status = "failed" if result.get("applied") is False or result.get("error") else "applied"
    payload["confirmation"]["status"] = status
    confirmed_at = int(time.time()) if confirmed else None
    db.execute(
        "UPDATE extreme_copilot_actions SET status=?, payload=?, confirmed_at=? WHERE id=? AND user_id=?",
        (status, json.dumps(payload), confirmed_at, action_id, user_id),
    )
    db.commit()
    updated = db.execute("SELECT * FROM extreme_copilot_actions WHERE id=? AND user_id=?", (action_id, user_id)).fetchone()
    db.close()
    if not updated:
        return None
    out = dict(updated)
    try:
        out["payload"] = json.loads(out.get("payload") or "{}")
    except Exception:
        out["payload"] = {}
    return out

def list_extreme_sessions(limit: int = 50) -> list[dict]:
    db = _conn()
    rows = db.execute(
        """SELECT s.*, u.username, u.email
           FROM extreme_demo_sessions s
           LEFT JOIN users u ON u.id=s.user_id
           ORDER BY s.started_at DESC LIMIT ?""",
        (max(1, min(limit, 200)),),
    ).fetchall()
    db.close()
    out = []
    for row in rows:
        item = dict(row)
        try:
            item["metadata"] = json.loads(item.get("metadata") or "{}")
        except Exception:
            item["metadata"] = {}
        out.append(item)
    return out

def list_extreme_ledger_events(limit: int = 100) -> list[dict]:
    db = _conn()
    rows = db.execute(
        """SELECT e.*, u.username, u.email
           FROM extreme_ledger_events e
           LEFT JOIN users u ON u.id=e.user_id
           ORDER BY e.created_at DESC LIMIT ?""",
        (max(1, min(limit, 300)),),
    ).fetchall()
    db.close()
    out = []
    for row in rows:
        item = dict(row)
        try:
            item["event_data"] = json.loads(item.get("event_data") or "{}")
        except Exception:
            item["event_data"] = {}
        out.append(item)
    return out

def get_extreme_ledger_summary(since: int | None = None) -> dict:
    db = _conn()
    where = "WHERE created_at>=?" if since else ""
    params = (since,) if since else ()
    events = db.execute(
        f"SELECT event_type, COUNT(*) as count FROM extreme_ledger_events {where} GROUP BY event_type ORDER BY count DESC",
        params,
    ).fetchall()
    sessions = db.execute(
        f"SELECT status, COUNT(*) as count FROM extreme_demo_sessions {'WHERE started_at>=?' if since else ''} GROUP BY status",
        params,
    ).fetchall()
    active = db.execute(
        "SELECT COUNT(*) as count FROM extreme_demo_sessions WHERE status='active' AND expires_at>?",
        (int(time.time()),),
    ).fetchone()
    db.close()
    return {
        "events_by_type": [{"event_type": r["event_type"], "count": r["count"]} for r in events],
        "sessions_by_status": [{"status": r["status"], "count": r["count"]} for r in sessions],
        "active_sessions": int(active["count"] if active else 0),
    }

def authorize_offline_download(user: dict, asset_type: str, region_id: str, cost: int, reason: str) -> dict:
    """Authorize one offline map/routing asset.

    Trailhead-owned offline packs are free for everyone. Plan users are free
    for any remaining paid offline assets.
    Re-downloading an already-authorized asset is free.
    """
    user_id = user["id"]
    asset_type = asset_type.strip().lower()
    region_id = region_id.strip().lower()
    db = _conn()
    now = int(time.time())
    try:
      existing = db.execute(
          "SELECT * FROM offline_downloads WHERE user_id=? AND asset_type=? AND region_id=?",
          (user_id, asset_type, region_id),
      ).fetchone()
      if existing:
          return {"authorized": True, "charged": 0, "free_used": False, "already_authorized": True, "credits": user.get("credits", 0)}

      if cost <= 0:
          db.execute(
              "INSERT OR IGNORE INTO offline_downloads (user_id,asset_type,region_id,cost,free_used,created_at) VALUES (?,?,?,?,?,?)",
              (user_id, asset_type, region_id, 0, 0, now),
          )
          db.commit()
          return {"authorized": True, "charged": 0, "free_used": False, "credits": user.get("credits", 0)}

      if has_active_plan(user):
          db.execute(
              "INSERT OR IGNORE INTO offline_downloads (user_id,asset_type,region_id,cost,free_used,created_at) VALUES (?,?,?,?,?,?)",
              (user_id, asset_type, region_id, 0, 0, now),
          )
          db.commit()
          return {"authorized": True, "charged": 0, "free_used": False, "plan": True, "credits": user.get("credits", 0)}

      trailhead_owned_free = (
          asset_type in {
              "state_map", "state_route", "state_contours", "state_trails",
              "country_map", "country_route", "trip_corridor",
              "conus_map", "place_pack", "trail_pack", "topo_pack",
          }
          or asset_type.startswith("trailhead_")
      )
      if trailhead_owned_free:
          db.execute(
              "INSERT OR IGNORE INTO offline_downloads (user_id,asset_type,region_id,cost,free_used,created_at) VALUES (?,?,?,?,?,?)",
              (user_id, asset_type, region_id, 0, 0, now),
          )
          db.commit()
          return {"authorized": True, "charged": 0, "free_used": False, "credits": user.get("credits", 0)}
    finally:
      db.close()

    if not deduct_credits(user_id, cost, reason):
        fresh = _user_balance(user_id)
        return {"authorized": False, "charged": 0, "free_used": False, "credits": fresh, "credits_needed": cost}

    db = _conn()
    try:
        db.execute(
            "INSERT OR IGNORE INTO offline_downloads (user_id,asset_type,region_id,cost,free_used,created_at) VALUES (?,?,?,?,?,?)",
            (user_id, asset_type, region_id, cost, 0, now),
        )
        db.commit()
    finally:
        db.close()
    return {"authorized": True, "charged": cost, "free_used": False, "credits": _user_balance(user_id)}

def activate_plan(user_id: int, plan_type: str, duration_days: int):
    """Set plan_type and expiry. Extends existing plan if still active."""
    db = _conn()
    now = int(time.time())
    row = db.execute("SELECT plan_expires_at FROM users WHERE id=?", (user_id,)).fetchone()
    current_expiry = row["plan_expires_at"] if row and row["plan_expires_at"] else now
    new_expiry = max(current_expiry, now) + duration_days * 86400
    db.execute(
        "UPDATE users SET plan_type=?, plan_expires_at=? WHERE id=?",
        (plan_type, new_expiry, user_id)
    )
    db.commit(); db.close()
    return new_expiry

def use_free_camp_search(user_id: int) -> bool:
    """Consume one free camp search. Returns True if the slot was available, False if limit reached."""
    db = _conn()
    row = db.execute("SELECT camp_searches_used FROM users WHERE id=?", (user_id,)).fetchone()
    used = row["camp_searches_used"] if row else 0
    if used >= 1:
        db.close()
        return False
    db.execute("UPDATE users SET camp_searches_used=camp_searches_used+1 WHERE id=?", (user_id,))
    db.commit(); db.close()
    return True


# ── Push tokens ───────────────────────────────────────────────────────────────

def save_push_token(user_id: int, token: str):
    db = _conn()
    db.execute("UPDATE users SET push_token=? WHERE id=?", (token, user_id))
    db.commit(); db.close()

def get_push_token(user_id: int) -> str | None:
    db = _conn()
    row = db.execute("SELECT push_token FROM users WHERE id=?", (user_id,)).fetchone()
    db.close()
    return row["push_token"] if row else None

def _push_audience_where(audience: dict | None, now: int) -> tuple[str, list]:
    audience = audience or {}
    segment = str(audience.get("segment") or "active_recent").strip().lower()
    active_days = int(audience.get("active_within_days") or 30)
    credits_lte = audience.get("credits_lte")
    where = [
        "COALESCE(u.push_token,'') != ''",
    ]
    params: list = []
    if segment == "active_plan":
        where.append("u.plan_type != 'free'")
        where.append("COALESCE(u.plan_expires_at, 0) > ?")
        params.append(now)
    elif segment == "free_users":
        where.append("(u.plan_type = 'free' OR COALESCE(u.plan_expires_at, 0) <= ?)")
        params.append(now)
    elif segment == "admins":
        where.append("u.is_admin = 1")
    elif segment == "low_credits":
        where.append("u.is_admin = 0")
        where.append("COALESCE(u.credits, 0) <= ?")
        params.append(int(credits_lte if credits_lte is not None else 200))
    elif segment == "all_users":
        pass
    else:
        cutoff = now - max(1, active_days) * 86400
        where.append(
            "EXISTS (SELECT 1 FROM analytics_events ae WHERE ae.user_id = u.id AND ae.created_at >= ?)"
        )
        params.append(cutoff)
    return " AND ".join(where), params

def get_push_campaign_recipients(audience: dict | None, limit: int | None = None) -> list[dict]:
    db = _conn()
    now = int(time.time())
    where_sql, params = _push_audience_where(audience, now)
    limit_sql = f" LIMIT {int(limit)}" if limit and limit > 0 else ""
    rows = db.execute(
        f"""SELECT u.id, u.username, u.email, u.push_token, u.credits, u.plan_type, u.plan_expires_at, u.is_admin
            FROM users u
            WHERE {where_sql}
            ORDER BY u.id ASC{limit_sql}""",
        params,
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]

def count_push_campaign_recipients(audience: dict | None) -> int:
    db = _conn()
    now = int(time.time())
    where_sql, params = _push_audience_where(audience, now)
    row = db.execute(
        f"SELECT COUNT(*) AS count FROM users u WHERE {where_sql}",
        params,
    ).fetchone()
    db.close()
    return int(row["count"] or 0) if row else 0

def create_push_campaign(campaign_key: str, campaign_type: str, audience: dict, title: str, body: str,
                         deeplink: str | None, payload: dict | None, created_by: int | None,
                         estimated_recipients: int, test_only: bool = False, status: str = "queued") -> int:
    db = _conn()
    now = int(time.time())
    cur = db.execute(
        """INSERT INTO push_campaigns
           (campaign_key,campaign_type,audience_json,title,body,deeplink,payload_json,status,created_by,
            estimated_recipients,test_only,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            campaign_key,
            campaign_type,
            json.dumps(audience or {}),
            title,
            body,
            deeplink,
            json.dumps(payload or {}),
            status,
            created_by,
            int(estimated_recipients or 0),
            1 if test_only else 0,
            now,
        ),
    )
    campaign_id = int(cur.lastrowid)
    db.commit()
    db.close()
    return campaign_id

def record_push_campaign_delivery(campaign_id: int, user_id: int | None, push_token: str,
                                  delivery_status: str, response: dict | None = None,
                                  error_text: str | None = None) -> None:
    db = _conn()
    now = int(time.time())
    db.execute(
        """INSERT INTO push_campaign_deliveries
           (campaign_id,user_id,push_token,delivery_status,response_json,error_text,created_at,sent_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (
            campaign_id,
            user_id,
            push_token,
            delivery_status,
            json.dumps(response or {}) if response is not None else None,
            error_text,
            now,
            now if delivery_status in {"sent", "ok"} else None,
        ),
    )
    db.commit()
    db.close()

def finalize_push_campaign(campaign_id: int, sent_count: int, failed_count: int, status: str = "sent") -> None:
    db = _conn()
    db.execute(
        "UPDATE push_campaigns SET status=?, sent_count=?, failed_count=?, sent_at=? WHERE id=?",
        (status, int(sent_count or 0), int(failed_count or 0), int(time.time()), campaign_id),
    )
    db.commit()
    db.close()

def list_push_campaigns(limit: int = 40) -> list[dict]:
    db = _conn()
    rows = db.execute(
        """SELECT c.*, u.username AS created_by_username
           FROM push_campaigns c
           LEFT JOIN users u ON u.id = c.created_by
           ORDER BY c.created_at DESC
           LIMIT ?""",
        (limit,),
    ).fetchall()
    db.close()
    items = []
    for row in rows:
        item = dict(row)
        item["audience"] = json.loads(item.get("audience_json") or "{}")
        item["payload"] = json.loads(item.get("payload_json") or "{}")
        items.append(item)
    return items

def get_push_campaign(campaign_id: int) -> dict | None:
    db = _conn()
    row = db.execute(
        """SELECT c.*, u.username AS created_by_username
           FROM push_campaigns c
           LEFT JOIN users u ON u.id = c.created_by
           WHERE c.id=?""",
        (campaign_id,),
    ).fetchone()
    if not row:
        db.close()
        return None
    item = dict(row)
    item["audience"] = json.loads(item.get("audience_json") or "{}")
    item["payload"] = json.loads(item.get("payload_json") or "{}")
    deliveries = db.execute(
        """SELECT id, user_id, push_token, delivery_status, response_json, error_text, created_at, sent_at
           FROM push_campaign_deliveries
           WHERE campaign_id=?
           ORDER BY created_at DESC
           LIMIT 200""",
        (campaign_id,),
    ).fetchall()
    db.close()
    item["deliveries"] = [
        {
            **dict(d),
            "response": json.loads(d["response_json"]) if d["response_json"] else None,
        }
        for d in deliveries
    ]
    return item

def _decode_support_thread_row(row: sqlite3.Row | dict) -> dict:
    item = dict(row)
    if "last_meta_json" in item:
        item["last_meta"] = json.loads(item["last_meta_json"]) if item.get("last_meta_json") else {}
    if "meta_json" in item:
        item["meta"] = json.loads(item["meta_json"]) if item.get("meta_json") else {}
    return item

def create_support_thread(user_id: int, subject: str, category: str = "support", opened_by: str = "user",
                          initial_body: str | None = None, admin_id: int | None = None,
                          meta: dict | None = None) -> int:
    db = _conn()
    now = int(time.time())
    cur = db.execute(
        """INSERT INTO support_threads
           (user_id,category,subject,status,opened_by,created_by_admin,last_message_at,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (user_id, category[:60], subject[:160], "open", opened_by[:20], admin_id, now, now, now),
    )
    thread_id = int(cur.lastrowid)
    if initial_body:
        db.execute(
            """INSERT INTO support_messages
               (thread_id,sender_role,sender_user_id,sender_admin_id,body,meta_json,created_at,read_by_user_at,read_by_admin_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                thread_id,
                "admin" if admin_id else "user",
                None if admin_id else user_id,
                admin_id,
                initial_body[:4000],
                json.dumps(meta or {}),
                now,
                now if admin_id else None,
                now if not admin_id else None,
            ),
        )
    db.commit()
    db.close()
    return thread_id

def list_support_threads_for_user(user_id: int) -> list[dict]:
    db = _conn()
    rows = db.execute(
        """SELECT t.*,
                  (SELECT body FROM support_messages sm WHERE sm.thread_id=t.id ORDER BY sm.created_at DESC, sm.id DESC LIMIT 1) AS last_message_body,
                  (SELECT meta_json FROM support_messages sm WHERE sm.thread_id=t.id ORDER BY sm.created_at DESC, sm.id DESC LIMIT 1) AS last_meta_json,
                  (SELECT COUNT(*) FROM support_messages sm WHERE sm.thread_id=t.id AND sm.sender_role='admin' AND sm.read_by_user_at IS NULL) AS unread_count
           FROM support_threads t
           WHERE t.user_id=?
           ORDER BY t.last_message_at DESC, t.id DESC""",
        (user_id,),
    ).fetchall()
    db.close()
    return [_decode_support_thread_row(r) for r in rows]

def list_support_threads_admin(status: str | None = None, search: str = "", limit: int = 120) -> list[dict]:
    db = _conn()
    where = []
    params: list = []
    if status:
        where.append("t.status=?")
        params.append(status)
    if search.strip():
        like = f"%{search.strip()}%"
        where.append("(u.username LIKE ? OR u.email LIKE ? OR t.subject LIKE ?)")
        params.extend([like, like, like])
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    rows = db.execute(
        f"""SELECT t.*, u.username, u.email,
                  (SELECT body FROM support_messages sm WHERE sm.thread_id=t.id ORDER BY sm.created_at DESC, sm.id DESC LIMIT 1) AS last_message_body,
                  (SELECT meta_json FROM support_messages sm WHERE sm.thread_id=t.id ORDER BY sm.created_at DESC, sm.id DESC LIMIT 1) AS last_meta_json,
                  (SELECT COUNT(*) FROM support_messages sm WHERE sm.thread_id=t.id AND sm.sender_role='user' AND sm.read_by_admin_at IS NULL) AS unread_count
           FROM support_threads t
           JOIN users u ON u.id=t.user_id
           {where_sql}
           ORDER BY t.last_message_at DESC, t.id DESC
           LIMIT ?""",
        params + [limit],
    ).fetchall()
    db.close()
    return [_decode_support_thread_row(r) for r in rows]

def get_support_thread(thread_id: int, user_id: int | None = None, admin: bool = False) -> dict | None:
    db = _conn()
    if admin:
        row = db.execute(
            """SELECT t.*, u.username, u.email
               FROM support_threads t
               JOIN users u ON u.id=t.user_id
               WHERE t.id=?""",
            (thread_id,),
        ).fetchone()
    else:
        row = db.execute(
            """SELECT t.*, u.username, u.email
               FROM support_threads t
               JOIN users u ON u.id=t.user_id
               WHERE t.id=? AND t.user_id=?""",
            (thread_id, user_id),
        ).fetchone()
    if not row:
        db.close()
        return None
    item = dict(row)
    messages = db.execute(
        """SELECT * FROM support_messages
           WHERE thread_id=?
           ORDER BY created_at ASC, id ASC""",
        (thread_id,),
    ).fetchall()
    now = int(time.time())
    if admin:
        db.execute(
            "UPDATE support_messages SET read_by_admin_at=? WHERE thread_id=? AND sender_role='user' AND read_by_admin_at IS NULL",
            (now, thread_id),
        )
    else:
        db.execute(
            "UPDATE support_messages SET read_by_user_at=? WHERE thread_id=? AND sender_role='admin' AND read_by_user_at IS NULL",
            (now, thread_id),
        )
    db.commit()
    db.close()
    item["messages"] = [_decode_support_thread_row(m) for m in messages]
    return item

def add_support_message(thread_id: int, sender_role: str, body: str, user_id: int | None = None,
                        admin_id: int | None = None, meta: dict | None = None) -> dict | None:
    db = _conn()
    thread = db.execute("SELECT * FROM support_threads WHERE id=?", (thread_id,)).fetchone()
    if not thread:
        db.close()
        return None
    now = int(time.time())
    cur = db.execute(
        """INSERT INTO support_messages
           (thread_id,sender_role,sender_user_id,sender_admin_id,body,meta_json,created_at,read_by_user_at,read_by_admin_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (
            thread_id,
            sender_role[:20],
            user_id,
            admin_id,
            body[:4000],
            json.dumps(meta or {}),
            now,
            now if sender_role == "user" else None,
            now if sender_role == "admin" else None,
        ),
    )
    db.execute(
        "UPDATE support_threads SET status='open', last_message_at=?, updated_at=? WHERE id=?",
        (now, now, thread_id),
    )
    db.commit()
    db.close()
    return {
        "id": int(cur.lastrowid),
        "thread_id": thread_id,
        "sender_role": sender_role,
        "sender_user_id": user_id,
        "sender_admin_id": admin_id,
        "body": body[:4000],
        "meta": meta or {},
        "created_at": now,
    }

def update_support_thread_status(thread_id: int, status: str) -> bool:
    db = _conn()
    cur = db.execute("UPDATE support_threads SET status=?, updated_at=? WHERE id=?", (status[:20], int(time.time()), thread_id))
    db.commit()
    ok = cur.rowcount > 0
    db.close()
    return ok


# ── Plan jobs (async background trip planning) ────────────────────────────────

def create_plan_job(job_id: str, user_id: int | None, session_id: str, request: str) -> None:
    db = _conn()
    now = time.time()
    db.execute(
        "INSERT INTO plan_jobs (id,user_id,session_id,request,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        (job_id, user_id, session_id, request, "pending", now, now)
    )
    db.commit(); db.close()

def get_plan_job(job_id: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM plan_jobs WHERE id=?", (job_id,)).fetchone()
    db.close()
    return dict(row) if row else None

def update_plan_job(job_id: str, status: str, result: str | None = None, error: str | None = None) -> None:
    db = _conn()
    db.execute(
        "UPDATE plan_jobs SET status=?, result=?, error=?, updated_at=? WHERE id=?",
        (status, result, error, time.time(), job_id)
    )
    db.commit(); db.close()


# ── Camp Field Reports ────────────────────────────────────────────────────────

FIELD_REPORT_CREDITS = 5   # base
FIELD_REPORT_PHOTO_BONUS = 5

def submit_field_report(camp_id: str, camp_name: str, lat: float, lng: float,
                         user_id: int, username: str, rig_label: str | None,
                         visited_date: str, sentiment: str, access_condition: str,
                         crowd_level: str, tags: list[str], note: str | None,
                         photo_data: str | None) -> dict:
    db = _conn()
    credits = FIELD_REPORT_CREDITS + (FIELD_REPORT_PHOTO_BONUS if photo_data else 0)
    now = int(time.time())
    cur = db.execute(
        """INSERT INTO camp_field_reports
           (camp_id,camp_name,lat,lng,user_id,username,rig_label,visited_date,
            sentiment,access_condition,crowd_level,tags,note,photo_data,credits_earned,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (camp_id, camp_name, lat, lng, user_id, username, rig_label, visited_date,
         sentiment, access_condition, crowd_level, json.dumps(tags), note,
         photo_data, credits, now)
    )
    db.execute("UPDATE users SET credits=credits+? WHERE id=?", (credits, user_id))
    db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
               (user_id, credits, f"Field report for {camp_name}", now))
    _record_contest_event_db(db, user_id, credits, f"Field report for {camp_name}", "camp_field_report", str(cur.lastrowid), now)
    db.commit(); db.close()
    return {"credits_earned": credits}

def get_field_reports(camp_id: str) -> list[dict]:
    db = _conn()
    rows = db.execute(
        """SELECT id,username,rig_label,visited_date,sentiment,access_condition,
                  crowd_level,tags,note,photo_data,created_at
           FROM camp_field_reports WHERE camp_id=?
           ORDER BY created_at DESC LIMIT 50""",
        (camp_id,)
    ).fetchall()
    db.close()
    result = []
    for r in rows:
        d = dict(r)
        d['tags'] = json.loads(d['tags'] or '[]')
        d['has_photo'] = bool(d.pop('photo_data'))
        result.append(d)
    return result

def get_field_report_summary(camp_id: str) -> dict:
    db = _conn()
    rows = db.execute(
        "SELECT sentiment, tags, crowd_level, access_condition, visited_date FROM camp_field_reports WHERE camp_id=? ORDER BY created_at DESC",
        (camp_id,)
    ).fetchall()
    db.close()
    if not rows:
        return {"count": 0, "sentiment_counts": {}, "top_tags": [], "last_visited": None}
    sentiment_counts: dict[str, int] = {}
    tag_counts: dict[str, int] = {}
    for r in rows:
        sentiment_counts[r["sentiment"]] = sentiment_counts.get(r["sentiment"], 0) + 1
        for t in json.loads(r["tags"] or "[]"):
            tag_counts[t] = tag_counts.get(t, 0) + 1
    top_tags = sorted(tag_counts.items(), key=lambda x: -x[1])[:8]
    return {
        "count": len(rows),
        "sentiment_counts": sentiment_counts,
        "top_tags": [{"tag": t, "count": c} for t, c in top_tags],
        "last_visited": rows[0]["visited_date"] if rows else None,
    }

def add_camp_comment(camp_id: str, camp_name: str, lat: float, lng: float,
                     user_id: int, username: str, body: str) -> dict:
    now = int(time.time())
    db = _conn()
    cur = db.execute(
        """INSERT INTO camp_comments
           (camp_id,camp_name,lat,lng,user_id,username,body,created_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (camp_id, camp_name, lat, lng, user_id, username, body, now),
    )
    db.commit(); db.close()
    return {"id": cur.lastrowid, "created_at": now}

def get_camp_comments(camp_id: str, limit: int = 50) -> list[dict]:
    db = _conn()
    rows = db.execute(
        """SELECT id,username,body,created_at
           FROM camp_comments WHERE camp_id=?
           ORDER BY created_at DESC LIMIT ?""",
        (camp_id, limit),
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


# ── Private dispersed camp lead queue ────────────────────────────────────────

DISPERSED_LEAD_ALLOWED_KEYS = {
    "lead_key", "source", "source_batch", "source_record_hash",
    "lat", "lng", "rounded_lat", "rounded_lng", "category", "status",
    "confidence", "source_verified_at", "review_flags", "canonical_camp_id",
    "profile_data", "reviewed_by", "reviewed_at", "rejection_reason",
    "published_by", "published_at", "provenance", "imported_at", "updated_at",
}

DISPERSED_LEAD_STATUSES = {
    "lead", "needs_field_check", "community_verified", "trailhead_verified",
    "published", "rejected", "merged", "expired",
}

DISPERSED_LEAD_PROFILE_KEYS = {
    "name", "description", "cost", "phone", "url", "access_notes",
    "bail_out_notes", "stay_limit", "reservation_notes",
    "source_confidence_notes", "max_rig_length", "site_types",
    "amenities", "activities",
}

DISPERSED_PUBLIC_DEFAULT_DESCRIPTION = (
    "Dispersed spots can change quickly. Check access, rules, and current conditions before relying on this spot."
)


def _dispersed_lead_json(raw: object, fallback):
    if raw in (None, ""):
        return fallback
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(str(raw))
    except Exception:
        return fallback


def _decode_dispersed_site_lead(row: sqlite3.Row | dict) -> dict:
    d = dict(row)
    d["review_flags"] = _dispersed_lead_json(d.get("review_flags"), [])
    d["profile_data"] = _dispersed_lead_json(d.get("profile_data"), {})
    d["provenance"] = _dispersed_lead_json(d.get("provenance"), {})
    return d


def _clean_dispersed_lead_profile(data: dict | None) -> dict:
    clean: dict = {}
    if not isinstance(data, dict):
        return clean
    for key, value in data.items():
        if key not in DISPERSED_LEAD_PROFILE_KEYS:
            continue
        if isinstance(value, str):
            text = re.sub(r"\s+", " ", value.strip())
            limit = 4000 if key == "description" else 900
            if text:
                clean[key] = text[:limit]
        elif isinstance(value, list):
            items = []
            for item in value:
                text = re.sub(r"\s+", " ", str(item or "").strip())[:80]
                if text and text.lower() not in {"0", "none", "unknown"}:
                    items.append(text)
            if items:
                clean[key] = sorted(dict.fromkeys(items))[:40]
    return clean


def _parse_dispersed_verified_ts(value: object) -> int | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", raw)
    if not match:
        return None
    try:
        return int(time.mktime((int(match.group(1)), int(match.group(2)), int(match.group(3)), 12, 0, 0, 0, 0, -1)))
    except Exception:
        return None


def dispersed_lead_verified_freshness(lead: dict, *, now: int | None = None) -> str:
    verified_ts = _parse_dispersed_verified_ts(lead.get("source_verified_at") if isinstance(lead, dict) else None)
    if not verified_ts:
        return "Recently verified"
    age_days = max(0, int(((now or int(time.time())) - verified_ts) / 86400))
    if age_days < 31:
        return "Verified this month"
    months = max(1, round(age_days / 30))
    if months == 1:
        return "Verified 1 month ago"
    if months < 12:
        return f"Verified {months} months ago"
    years = max(1, round(months / 12))
    return "Verified 1 year ago" if years == 1 else f"Verified {years} years ago"


def upsert_dispersed_site_leads(leads: list[dict], source_batch: str) -> dict:
    """Store sanitized private dispersed-site leads.

    This helper is intentionally strict: any unexpected key is treated as a
    failed row so source names, notes, reviews, amenities, or photos cannot leak
    into the staging table.
    """
    batch = re.sub(r"[^a-zA-Z0-9_.:-]+", "_", str(source_batch or "").strip())[:120]
    if not batch:
        raise ValueError("source_batch is required")

    now = int(time.time())
    saved = 0
    skipped = 0
    errors: list[dict] = []
    db = _conn()
    for index, lead in enumerate(leads or [], start=1):
        try:
            if not isinstance(lead, dict):
                raise ValueError("lead must be an object")
            unexpected = sorted(set(lead) - DISPERSED_LEAD_ALLOWED_KEYS)
            if unexpected:
                raise ValueError(f"unexpected lead fields: {', '.join(unexpected[:5])}")

            lat = float(lead.get("lat"))
            lng = float(lead.get("lng"))
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                raise ValueError("lead lat/lng out of range")
            rounded_lat = round(float(lead.get("rounded_lat", lat)), 5)
            rounded_lng = round(float(lead.get("rounded_lng", lng)), 5)
            category = re.sub(r"[^a-z0-9_]+", "_", str(lead.get("category") or "").lower()).strip("_")[:60]
            if category not in {"wild_camp", "informal_camp"}:
                raise ValueError("unsupported dispersed lead category")
            status = re.sub(r"[^a-z0-9_]+", "_", str(lead.get("status") or "lead").lower()).strip("_")[:40] or "lead"
            if status not in DISPERSED_LEAD_STATUSES:
                raise ValueError("unsupported dispersed lead status")
            source = re.sub(r"[^a-z0-9_.:-]+", "_", str(lead.get("source") or "private_lead").lower()).strip("_")[:80] or "private_lead"
            source_record_hash = re.sub(r"[^a-fA-F0-9]+", "", str(lead.get("source_record_hash") or ""))[:64]
            if not source_record_hash:
                source_record_hash = hashlib.sha256(f"{source}:{category}:{lat:.5f}:{lng:.5f}".encode("utf-8")).hexdigest()
            lead_key = str(lead.get("lead_key") or "").strip()
            if not lead_key:
                lead_key = "dsl_" + hashlib.sha256(f"{source}:{category}:{rounded_lat:.5f}:{rounded_lng:.5f}".encode("utf-8")).hexdigest()[:24]
            lead_key = re.sub(r"[^a-zA-Z0-9_.:-]+", "_", lead_key)[:90]
            flags = lead.get("review_flags") or []
            if not isinstance(flags, list):
                flags = [str(flags)]
            flags = [re.sub(r"[^a-z0-9_:-]+", "_", str(flag).lower()).strip("_")[:60] for flag in flags if str(flag).strip()]
            provenance = lead.get("provenance") or {}
            if not isinstance(provenance, dict):
                provenance = {}
            safe_provenance = {
                str(key)[:60]: value
                for key, value in provenance.items()
                if key in {"source_kind", "source_label", "import_file", "license_state", "date_policy", "raw_fields_stripped"}
            }
            profile_data = _clean_dispersed_lead_profile(lead.get("profile_data") if isinstance(lead.get("profile_data"), dict) else {})
            confidence = max(0, min(int(lead.get("confidence") or 25), 100))
            db.execute(
                """INSERT INTO dispersed_site_leads
                   (lead_key,source,source_batch,source_record_hash,lat,lng,rounded_lat,rounded_lng,
                    category,status,confidence,source_verified_at,review_flags,canonical_camp_id,
                    profile_data,reviewed_by,reviewed_at,rejection_reason,published_by,published_at,
                    provenance,imported_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(lead_key) DO UPDATE SET
                    source_batch=excluded.source_batch,
                    source_record_hash=excluded.source_record_hash,
                    lat=excluded.lat,
                    lng=excluded.lng,
                    rounded_lat=excluded.rounded_lat,
                    rounded_lng=excluded.rounded_lng,
                    category=excluded.category,
                    status=excluded.status,
                    confidence=excluded.confidence,
                    source_verified_at=excluded.source_verified_at,
                    review_flags=excluded.review_flags,
                    profile_data=CASE
                        WHEN dispersed_site_leads.profile_data IS NULL OR dispersed_site_leads.profile_data='{}' THEN excluded.profile_data
                        ELSE dispersed_site_leads.profile_data
                    END,
                    provenance=excluded.provenance,
                    updated_at=excluded.updated_at""",
                (
                    lead_key, source, batch, source_record_hash, lat, lng, rounded_lat, rounded_lng,
                    category, status, confidence, lead.get("source_verified_at"),
                    json.dumps(flags), lead.get("canonical_camp_id"), json.dumps(profile_data),
                    lead.get("reviewed_by"), lead.get("reviewed_at"), lead.get("rejection_reason"),
                    lead.get("published_by"), lead.get("published_at"), json.dumps(safe_provenance),
                    int(lead.get("imported_at") or now), now,
                ),
            )
            saved += 1
        except Exception as exc:
            skipped += 1
            errors.append({"index": index, "error": str(exc)})
    db.commit()
    db.close()
    return {"saved": saved, "skipped": skipped, "errors": errors[:25]}


def get_dispersed_site_lead_summary(source_batch: str | None = None) -> dict:
    db = _conn()
    where = ""
    params: tuple = ()
    if source_batch:
        where = "WHERE source_batch=?"
        params = (source_batch,)
    total = db.execute(f"SELECT COUNT(*) AS c FROM dispersed_site_leads {where}", params).fetchone()["c"]
    by_status = {
        row["status"]: row["c"]
        for row in db.execute(
            f"SELECT status,COUNT(*) AS c FROM dispersed_site_leads {where} GROUP BY status ORDER BY status",
            params,
        ).fetchall()
    }
    by_category = {
        row["category"]: row["c"]
        for row in db.execute(
            f"SELECT category,COUNT(*) AS c FROM dispersed_site_leads {where} GROUP BY category ORDER BY category",
            params,
        ).fetchall()
    }
    db.close()
    return {"total": total, "by_status": by_status, "by_category": by_category}


def list_dispersed_site_leads_for_publication(
    *,
    max_age_days: int = 366,
    source_batch: str | None = None,
    limit: int = 0,
    statuses: list[str] | None = None,
) -> list[dict]:
    max_age_days = max(1, min(int(max_age_days or 366), 3660))
    now = int(time.time())
    cutoff = time.strftime("%Y-%m-%d", time.localtime(now - max_age_days * 86400))
    allowed_statuses = {
        status for status in (statuses or ["lead", "needs_field_check", "community_verified", "trailhead_verified"])
        if status in DISPERSED_LEAD_STATUSES
    }
    if not allowed_statuses:
        return []
    params: list[object] = [*sorted(allowed_statuses), cutoff]
    where = [
        f"status IN ({','.join('?' for _ in allowed_statuses)})",
        "source_verified_at IS NOT NULL",
        "source_verified_at >= ?",
    ]
    if source_batch:
        where.append("source_batch=?")
        params.append(re.sub(r"[^a-zA-Z0-9_.:-]+", "_", str(source_batch).strip())[:120])
    sql_limit = ""
    if limit and int(limit) > 0:
        sql_limit = " LIMIT ?"
        params.append(max(1, min(int(limit), 100000)))
    db = _conn()
    rows = db.execute(
        f"""SELECT * FROM dispersed_site_leads
            WHERE {' AND '.join(where)}
            ORDER BY source_verified_at DESC, confidence DESC, updated_at DESC{sql_limit}""",
        tuple(params),
    ).fetchall()
    db.close()
    return [_decode_dispersed_site_lead(row) for row in rows]


def list_dispersed_site_leads_near(
    lat: float,
    lng: float,
    radius_mi: float = 35,
    statuses: list[str] | None = None,
    limit: int = 120,
) -> list[dict]:
    radius_mi = max(1.0, min(float(radius_mi or 35), 90.0))
    limit = max(1, min(int(limit or 120), 200))
    allowed_statuses = {
        status for status in (statuses or ["lead", "needs_field_check", "trailhead_verified", "community_verified"])
        if status in DISPERSED_LEAD_STATUSES
    }
    if not allowed_statuses:
        return []

    lat_delta = radius_mi / 69.0
    lng_delta = radius_mi / max(8.0, 69.0 * math.cos(math.radians(lat)))
    placeholders = ",".join("?" for _ in allowed_statuses)
    db = _conn()
    rows = db.execute(
        f"""SELECT * FROM dispersed_site_leads
            WHERE status IN ({placeholders})
              AND lat BETWEEN ? AND ?
              AND lng BETWEEN ? AND ?
            ORDER BY confidence DESC, source_verified_at DESC, updated_at DESC
            LIMIT ?""",
        (*sorted(allowed_statuses), lat - lat_delta, lat + lat_delta, lng - lng_delta, lng + lng_delta, limit * 4),
    ).fetchall()
    out: list[dict] = []
    for row in rows:
        item = _decode_dispersed_site_lead(row)
        distance = _place_distance_mi(lat, lng, item)
        if distance > radius_mi:
            continue
        item["distance_mi"] = round(distance, 2)
        out.append(item)
        if len(out) >= limit:
            break
    db.close()
    return out


def get_dispersed_site_lead(lead_key: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM dispersed_site_leads WHERE lead_key=?", (lead_key,)).fetchone()
    db.close()
    return _decode_dispersed_site_lead(row) if row else None


def update_dispersed_site_lead_status(
    lead_key: str,
    status: str,
    reviewer_id: int | None = None,
    rejection_reason: str | None = None,
) -> dict | None:
    status = re.sub(r"[^a-z0-9_]+", "_", str(status or "").lower()).strip("_")
    if status not in DISPERSED_LEAD_STATUSES:
        raise ValueError("unsupported dispersed lead status")
    reason = (rejection_reason or "").strip()[:300] or None
    now = int(time.time())
    db = _conn()
    cur = db.execute(
        """UPDATE dispersed_site_leads
           SET status=?,reviewed_by=?,reviewed_at=?,rejection_reason=?,updated_at=? WHERE lead_key=?""",
        (status, reviewer_id, now, reason, now, lead_key),
    )
    row = db.execute("SELECT * FROM dispersed_site_leads WHERE lead_key=?", (lead_key,)).fetchone()
    db.commit(); db.close()
    if cur.rowcount <= 0 or not row:
        return None
    return _decode_dispersed_site_lead(row)


def update_dispersed_site_lead_profile(
    lead_key: str,
    profile_data: dict,
    reviewer_id: int | None = None,
) -> dict | None:
    clean = _clean_dispersed_lead_profile(profile_data)
    existing = get_dispersed_site_lead(lead_key)
    if not existing:
        return None
    merged = {**(existing.get("profile_data") or {}), **clean}
    now = int(time.time())
    db = _conn()
    db.execute(
        """UPDATE dispersed_site_leads
           SET profile_data=?,reviewed_by=COALESCE(?,reviewed_by),reviewed_at=?,updated_at=?
           WHERE lead_key=?""",
        (json.dumps(merged), reviewer_id, now, now, lead_key),
    )
    row = db.execute("SELECT * FROM dispersed_site_leads WHERE lead_key=?", (lead_key,)).fetchone()
    db.commit(); db.close()
    return _decode_dispersed_site_lead(row) if row else None


def add_dispersed_site_lead_photo(
    lead_key: str,
    user_id: int,
    username: str,
    photo_data: str,
    caption: str | None = None,
    content_type: str = "image/jpeg",
) -> dict | None:
    if not get_dispersed_site_lead(lead_key):
        return None
    now = int(time.time())
    db = _conn()
    cur = db.execute(
        """INSERT INTO dispersed_site_lead_photos
           (lead_key,user_id,username,caption,photo_data,content_type,status,created_at)
           VALUES (?,?,?,?,?,?, 'private', ?)""",
        (
            lead_key,
            user_id,
            (username or "")[:120],
            (caption or "")[:500] or None,
            photo_data,
            (content_type or "image/jpeg")[:120],
            now,
        ),
    )
    row = db.execute(
        """SELECT id,lead_key,user_id,username,caption,content_type,status,published_photo_id,created_at
           FROM dispersed_site_lead_photos WHERE id=?""",
        (cur.lastrowid,),
    ).fetchone()
    db.commit(); db.close()
    return dict(row) if row else None


def get_dispersed_site_lead_photos(lead_key: str, status: str | None = None) -> list[dict]:
    db = _conn()
    if status:
        rows = db.execute(
            """SELECT * FROM dispersed_site_lead_photos
               WHERE lead_key=? AND status=? ORDER BY created_at ASC""",
            (lead_key, status),
        ).fetchall()
    else:
        rows = db.execute(
            """SELECT * FROM dispersed_site_lead_photos
               WHERE lead_key=? ORDER BY created_at ASC""",
            (lead_key,),
        ).fetchall()
    db.close()
    return [dict(row) for row in rows]


def _nearby_public_dispersed_place(lat: float, lng: float, max_mi: float = 0.12) -> dict | None:
    lat_delta = max_mi / 69.0
    lng_delta = max_mi / max(8.0, 69.0 * math.cos(math.radians(lat)))
    db = _conn()
    rows = db.execute(
        """SELECT * FROM places
           WHERE source='trailhead'
             AND category='camp'
             AND lat BETWEEN ? AND ?
             AND lng BETWEEN ? AND ?
           ORDER BY updated_at DESC
           LIMIT 40""",
        (lat - lat_delta, lat + lat_delta, lng - lng_delta, lng + lng_delta),
    ).fetchall()
    db.close()
    best: tuple[float, dict] | None = None
    for row in rows:
        place = dict(row)
        metadata = _dispersed_lead_json(place.get("display_metadata"), {})
        if isinstance(metadata, dict):
            place.update(metadata)
        if str(place.get("trailhead_dataset") or "") != "dispersed_camp":
            continue
        if str(place.get("trailhead_public") or "").lower() not in {"1", "true", "yes"} and place.get("trailhead_public") is not True:
            continue
        distance = _place_distance_mi(lat, lng, place)
        if distance > max_mi:
            continue
        if best is None or distance < best[0]:
            best = (distance, place)
    return best[1] if best else None


def publish_dispersed_site_lead(
    lead_key: str,
    admin_id: int | None = None,
    profile_data: dict | None = None,
) -> dict | None:
    lead = get_dispersed_site_lead(lead_key)
    if not lead:
        return None
    if lead.get("status") in {"rejected", "expired"}:
        raise ValueError("cannot publish a rejected or expired site")
    merged_profile = {**(lead.get("profile_data") or {}), **_clean_dispersed_lead_profile(profile_data)}
    lat = float(lead.get("lat"))
    lng = float(lead.get("lng"))
    merge_target = _nearby_public_dispersed_place(lat, lng)
    name = str(merged_profile.get("name") or "").strip() or "Dispersed tent site"
    if merge_target and name == "Dispersed tent site" and str(merge_target.get("name") or "").strip():
        name = str(merge_target.get("name")).strip()
    source_place_id = f"dispersed:{lead_key}"
    if merge_target:
        source_place_id = str(merge_target.get("source_place_id") or source_place_id)
    now = int(time.time())
    verified_ts = _parse_dispersed_verified_ts(lead.get("source_verified_at")) or now
    source_freshness = dispersed_lead_verified_freshness(lead, now=now)
    public_description = (
        str(merged_profile.get("description") or "").strip()
        or DISPERSED_PUBLIC_DEFAULT_DESCRIPTION
    )
    payload = {
        "source": "trailhead",
        "source_label": "Trailhead",
        "source_place_id": source_place_id,
        "name": name,
        "lat": merge_target.get("lat") if merge_target else lat,
        "lng": merge_target.get("lng") if merge_target else lng,
        "category": "camp",
        "subtype": "Dispersed",
        "land_type": "Dispersed",
        "summary": public_description,
        "description": public_description,
        "cost": merged_profile.get("cost") or "",
        "phone": merged_profile.get("phone") or "",
        "url": merged_profile.get("url") or "",
        "amenities": merged_profile.get("amenities") or [],
        "site_types": merged_profile.get("site_types") or ["Tent"],
        "activities": merged_profile.get("activities") or [],
        "access_notes": merged_profile.get("access_notes") or "",
        "bail_out_notes": merged_profile.get("bail_out_notes") or "",
        "stay_limit": merged_profile.get("stay_limit") or "",
        "reservation_notes": merged_profile.get("reservation_notes") or "",
        "source_confidence_notes": merged_profile.get("source_confidence_notes") or DISPERSED_PUBLIC_DEFAULT_DESCRIPTION,
        "max_rig_length": merged_profile.get("max_rig_length") or "",
        "reservable": False,
        "verified_source": "Recent dispersed spot",
        "source_badge": "Trailhead",
        "source_freshness": source_freshness,
        "trailhead_dataset": "dispersed_camp",
        "trailhead_public": True,
        "published_at": now,
        "source_verified_at": lead.get("source_verified_at") or "",
        "source_updated_at": verified_ts,
        "last_refreshed_at": now,
        "refresh_after": now + 90 * 86400,
    }
    place = upsert_canonical_place(payload)
    place_id = place.get("trailhead_place_id")
    if place_id:
        set_camp_profile_override(str(place_id), {
            **merged_profile,
            "name": name,
            "land_type": "Dispersed",
            "reservable": False,
            "verified_source": "Recent dispersed spot",
            "source_badge": "Trailhead",
            "source_freshness": source_freshness,
            "description": public_description,
            "site_types": merged_profile.get("site_types") or ["Tent"],
            "amenities": merged_profile.get("amenities") or [],
            "activities": merged_profile.get("activities") or [],
        }, admin_id)
        for private_photo in get_dispersed_site_lead_photos(lead_key, status="private"):
            photo = add_place_photo(
                str(place_id),
                int(private_photo["user_id"]),
                str(private_photo["username"] or ""),
                caption=private_photo.get("caption") or name,
                photo_data=private_photo.get("photo_data"),
                content_type=private_photo.get("content_type") or "image/jpeg",
            )
            db_photo = _conn()
            db_photo.execute(
                "UPDATE dispersed_site_lead_photos SET status='published',published_photo_id=? WHERE id=?",
                (photo.get("id") if photo else None, private_photo["id"]),
            )
            db_photo.commit(); db_photo.close()
    db = _conn()
    db.execute(
        """UPDATE dispersed_site_leads
           SET status='published',canonical_camp_id=?,profile_data=?,reviewed_by=?,reviewed_at=?,
               published_by=?,published_at=?,updated_at=?
           WHERE lead_key=?""",
        (place_id, json.dumps(merged_profile), admin_id, now, admin_id, now, now, lead_key),
    )
    row = db.execute("SELECT * FROM dispersed_site_leads WHERE lead_key=?", (lead_key,)).fetchone()
    db.commit(); db.close()
    out = _decode_dispersed_site_lead(row) if row else lead
    out["camp"] = place
    return out


# ── Canonical places / all-pin community layer ───────────────────────────────

PLACE_PHOTO_CREDITS = 5
PLACE_EDIT_CREDITS = 3
OFFICIAL_PLACE_SOURCES = {"nps", "ridb", "recreation.gov", "blm", "usfs", "fs", "usda"}
PAID_PROVIDER_SOURCES = {"google", "google_places", "foursquare", "fsq"}

PLACE_METADATA_KEYS = {
    "summary", "description", "address", "phone", "website", "url", "hours",
    "amenities", "activities", "access_note", "access_notes", "reservation_notes",
    "booking_url", "reservable", "rating", "rating_count", "source_badge",
    "source_freshness", "verified_source", "land_type", "cost",
    "confidence", "cache_status", "stale_reason", "source_verified_at",
    "source_updated_at", "source_confidence_notes",
    "last_refreshed_at", "refresh_after", "refresh_priority",
    "route_distance_mi", "route_progress", "route_progress_mi",
    "trailhead_dataset", "trailhead_public", "published_at",
}

def _place_source_clean(value: object) -> str:
    source = str(value or "").strip().lower()
    source = source.replace("google places", "google").replace("recreationgov", "recreation.gov")
    source = re.sub(r"[^a-z0-9_.:-]+", "_", source)[:60]
    return source or "community"

def _place_source_priority(source: str, source_label: str | None = None) -> int:
    source = _place_source_clean(source)
    label = str(source_label or "").lower()
    if source in {"trailhead", "admin", "community"} or "trailhead" in label:
        return 0
    if source in OFFICIAL_PLACE_SOURCES or any(token in label for token in ("national park service", "recreation.gov", "ridb", "blm", "forest service", "usfs")):
        return 10
    if source == "geoapify" or "geoapify" in label:
        return 30
    if source in {"osm", "openstreetmap", "offline"} or "openstreetmap" in label:
        return 40
    if source in PAID_PROVIDER_SOURCES or any(token in label for token in ("google", "foursquare")):
        return 90
    return 50

def _place_normalized_name(name: str) -> str:
    clean = re.sub(r"\s+", " ", str(name or "").strip().lower())
    clean = re.sub(r"\([^)]*\)", " ", clean)
    clean = re.sub(r"[^a-z0-9]+", "-", clean).strip("-")
    return clean[:80] or "place"

def _place_provider_id(payload: dict, source: str) -> str:
    candidates = [
        payload.get("source_place_id"),
        payload.get("provider_place_id"),
        payload.get("place_id"),
        payload.get("facility_id"),
        payload.get("parkCode"),
        payload.get("park_code"),
        payload.get("id"),
    ]
    for value in candidates:
        raw = str(value or "").strip()
        if not raw or raw.startswith("thp_"):
            continue
        if raw.startswith(f"{source}:"):
            raw = raw[len(source) + 1:]
        return re.sub(r"[^a-zA-Z0-9_.:-]+", "_", raw)[:180]
    return ""

def canonical_place_id(payload: dict) -> str:
    source = _place_source_clean(payload.get("source") or payload.get("attribution") or payload.get("source_label"))
    source_place_id = _place_provider_id(payload, source)
    if source_place_id:
        stable = f"{source}:{source_place_id}"
    else:
        name = _place_normalized_name(str(payload.get("name") or payload.get("title") or "place"))
        try:
            lat = round(float(payload.get("lat")), 5)
            lng = round(float(payload.get("lng")), 5)
        except Exception:
            lat = lng = 0.0
        stable = f"{source}:{name}:{lat:.5f}:{lng:.5f}"
    return "thp_" + hashlib.sha1(stable.encode("utf-8")).hexdigest()[:24]

def _place_json(raw: object, fallback):
    if raw in (None, ""):
        return fallback
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(str(raw))
    except Exception:
        return fallback

def _decode_place(row: sqlite3.Row | dict) -> dict:
    d = dict(row)
    d["provider_ids"] = _place_json(d.get("provider_ids"), {})
    d["provenance"] = _place_json(d.get("provenance"), {})
    d["display_metadata"] = _place_json(d.get("display_metadata"), {})
    for key, value in list(d["display_metadata"].items()):
        d.setdefault(key, value)
    return d

def _place_public_photos(db: sqlite3.Connection, trailhead_place_id: str, limit: int = 24) -> list[dict]:
    rows = db.execute(
        """SELECT id,username,comment_id,url,caption,source,status,credits_awarded,created_at
           FROM place_photos
           WHERE trailhead_place_id=? AND status='visible'
           ORDER BY created_at ASC LIMIT ?""",
        (trailhead_place_id, limit),
    ).fetchall()
    return [dict(r) for r in rows]

def _place_public_comments(db: sqlite3.Connection, trailhead_place_id: str, limit: int = 50) -> list[dict]:
    rows = db.execute(
        """SELECT c.id,c.username,c.body,c.created_at,
                  COALESCE(
                    json_group_array(
                      CASE WHEN p.id IS NOT NULL THEN json_object('id',p.id,'url',p.url,'caption',p.caption,'source',p.source,'created_at',p.created_at) END
                    ),
                    '[]'
                  ) AS photos_json
           FROM place_comments c
           LEFT JOIN place_photos p ON p.comment_id=c.id AND p.status='visible'
           WHERE c.trailhead_place_id=? AND c.status='visible'
           GROUP BY c.id
           ORDER BY c.created_at DESC LIMIT ?""",
        (trailhead_place_id, limit),
    ).fetchall()
    comments: list[dict] = []
    for row in rows:
        d = dict(row)
        raw = _place_json(d.pop("photos_json", "[]"), [])
        d["photos"] = [p for p in raw if isinstance(p, dict) and p.get("id")]
        comments.append(d)
    return comments

def upsert_canonical_place(payload: dict) -> dict:
    name = re.sub(r"\s+", " ", str(payload.get("name") or payload.get("title") or "").strip())[:220]
    if not name:
        raise ValueError("place name is required")
    try:
        lat = float(payload.get("lat"))
        lng = float(payload.get("lng"))
    except Exception as exc:
        raise ValueError("place lat/lng are required") from exc
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError("place lat/lng out of range")

    source = _place_source_clean(payload.get("source") or payload.get("attribution") or payload.get("source_label"))
    source_label = str(payload.get("source_label") or payload.get("verified_source") or payload.get("attribution") or source).strip()[:180]
    source_place_id = _place_provider_id(payload, source)
    priority = _place_source_priority(source, source_label)
    place_id = canonical_place_id(payload)
    now = int(time.time())
    category = str(payload.get("category") or payload.get("type") or payload.get("kind") or "place").strip()[:80]
    subtype = str(payload.get("subtype") or payload.get("land_type") or "").strip()[:120]
    paid_source = source in PAID_PROVIDER_SOURCES
    official_url = ""
    if not paid_source:
        official_url = str(payload.get("official_url") or payload.get("url") or payload.get("website") or "").strip()[:900]

    incoming_provider_ids = {}
    if source_place_id:
        incoming_provider_ids[source] = source_place_id
    for key in ("google_place_id", "foursquare_id", "ridb_id", "nps_id", "osm_id", "geoapify_place_id", "blm_id", "usfs_id"):
        value = str(payload.get(key) or "").strip()
        if value:
            incoming_provider_ids[key.replace("_place_id", "").replace("_id", "")] = value[:180]

    incoming_meta: dict = {}
    if not paid_source:
        for key in PLACE_METADATA_KEYS:
            value = payload.get(key)
            if value not in (None, "", []):
                incoming_meta[key] = value
    incoming_hero = "" if paid_source else str(payload.get("hero_photo_url") or payload.get("photo_url") or "").strip()[:1200]
    photos = payload.get("photos")
    if not incoming_hero and not paid_source and isinstance(photos, list) and photos:
        first = photos[0]
        if isinstance(first, dict):
            incoming_hero = str(first.get("url") or "").strip()[:1200]
        else:
            incoming_hero = str(first or "").strip()[:1200]

    provenance = {
        "source": source,
        "source_label": source_label,
        "source_place_id": source_place_id,
        "priority": priority,
        "last_seen": now,
    }

    db = _conn()
    existing = db.execute("SELECT * FROM places WHERE trailhead_place_id=?", (place_id,)).fetchone()
    if existing:
        current = _decode_place(existing)
        current_priority = int(current.get("source_priority") or 50)
        incoming_wins = priority <= current_priority
        provider_ids = {**(current.get("provider_ids") or {}), **incoming_provider_ids}
        metadata = dict(current.get("display_metadata") or {})
        if incoming_wins:
            metadata.update(incoming_meta)
        else:
            for key, value in incoming_meta.items():
                metadata.setdefault(key, value)
        existing_provenance = current.get("provenance") or {}
        sources = dict(existing_provenance.get("sources") or {})
        sources[source] = provenance
        merged_provenance = {**existing_provenance, "sources": sources, "last_seen": now}
        db.execute(
            """UPDATE places SET
                 source=?, source_priority=?, source_label=?, source_place_id=?,
                 name=?, lat=?, lng=?, category=?, subtype=?,
                 official_url=COALESCE(NULLIF(?,''), official_url),
                 provider_ids=?, provenance=?, hero_photo_url=COALESCE(NULLIF(?,''), hero_photo_url),
                 display_metadata=?, last_seen=?, updated_at=?
               WHERE trailhead_place_id=?""",
            (
                source if incoming_wins else current["source"],
                priority if incoming_wins else current_priority,
                source_label if incoming_wins else current.get("source_label"),
                source_place_id if incoming_wins else current.get("source_place_id"),
                name if incoming_wins else current["name"],
                lat if incoming_wins else current["lat"],
                lng if incoming_wins else current["lng"],
                category if incoming_wins else current.get("category"),
                subtype if incoming_wins else current.get("subtype"),
                official_url,
                json.dumps(provider_ids),
                json.dumps(merged_provenance),
                incoming_hero,
                json.dumps(metadata),
                now,
                now,
                place_id,
            ),
        )
    else:
        db.execute(
            """INSERT INTO places
               (trailhead_place_id,source,source_priority,source_label,source_place_id,name,lat,lng,
                category,subtype,official_url,provider_ids,provenance,hero_photo_url,display_metadata,
                last_seen,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                place_id, source, priority, source_label, source_place_id, name, lat, lng,
                category, subtype, official_url, json.dumps(incoming_provider_ids),
                json.dumps({"sources": {source: provenance}, "last_seen": now}),
                incoming_hero or None, json.dumps(incoming_meta), now, now, now,
            ),
        )
    row = db.execute("SELECT * FROM places WHERE trailhead_place_id=?", (place_id,)).fetchone()
    db.commit()
    photos_out = _place_public_photos(db, place_id, 24)
    comments_out = _place_public_comments(db, place_id, 50)
    db.close()
    decoded = _decode_place(row)
    decoded["photos"] = photos_out
    decoded["comments"] = comments_out
    if not decoded.get("hero_photo_url") and photos_out:
        decoded["hero_photo_url"] = photos_out[0].get("url")
        decoded["hero_photo_source"] = "community"
    return decoded

def get_place(trailhead_place_id: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM places WHERE trailhead_place_id=?", (trailhead_place_id,)).fetchone()
    if not row:
        db.close()
        return None
    place = _decode_place(row)
    photos = _place_public_photos(db, trailhead_place_id, 24)
    comments = _place_public_comments(db, trailhead_place_id, 50)
    if not place.get("hero_photo_url") and photos:
        place["hero_photo_url"] = photos[0].get("url")
        place["hero_photo_source"] = "community"
    place["photos"] = photos
    place["comments"] = comments
    db.close()
    return place

def _place_distance_mi(lat: float, lng: float, place: dict) -> float:
    try:
        plat = float(place.get("lat"))
        plng = float(place.get("lng"))
    except Exception:
        return 999999.0
    r = 3958.8
    dlat = math.radians(plat - lat)
    dlng = math.radians(plng - lng)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat)) * math.cos(math.radians(plat)) * math.sin(dlng / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def upsert_route_intelligence_places(items: list[dict], source_context: str = "route_intelligence") -> dict:
    """Persist normalized provider/camp/place results into the canonical places table."""
    saved = 0
    skipped = 0
    now = int(time.time())
    for raw in items or []:
        if not isinstance(raw, dict):
            skipped += 1
            continue
        payload = dict(raw)
        payload.setdefault("source_context", source_context)
        payload.setdefault("last_refreshed_at", now)
        payload.setdefault("refresh_after", now + 7 * 86400)
        payload.setdefault("cache_status", "fresh")
        try:
            upsert_canonical_place(payload)
            saved += 1
        except Exception:
            skipped += 1
    return {"saved": saved, "skipped": skipped}

def list_cached_places_near_samples(
    samples: list[dict],
    radius_mi: float = 35,
    categories: list[str] | None = None,
    stale_after_seconds: int = 7 * 86400,
    include_stale: bool = True,
    limit: int = 240,
) -> list[dict]:
    """Return canonical places near sampled points, annotated for stale-while-refresh use."""
    clean_samples = []
    for sample in samples or []:
        try:
            lat = float(sample.get("lat"))
            lng = float(sample.get("lng"))
        except Exception:
            continue
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            clean_samples.append({"lat": lat, "lng": lng})
    if not clean_samples:
        return []
    normalized_categories = {re.sub(r"[^a-z0-9_]+", "", str(c or "").lower().replace(" ", "_")) for c in (categories or []) if str(c or "").strip()}
    radius_mi = max(1.0, min(float(radius_mi or 35), 90.0))
    now = int(time.time())
    db = _conn()
    seen: set[str] = set()
    out: list[dict] = []
    for sample in clean_samples:
        lat = sample["lat"]
        lng = sample["lng"]
        lat_delta = radius_mi / 69.0
        lng_delta = radius_mi / max(8.0, 69.0 * math.cos(math.radians(lat)))
        rows = db.execute(
            """SELECT * FROM places
               WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
               ORDER BY source_priority ASC, last_seen DESC
               LIMIT ?""",
            (lat - lat_delta, lat + lat_delta, lng - lng_delta, lng + lng_delta, max(limit * 2, 80)),
        ).fetchall()
        for row in rows:
            place = _decode_place(row)
            pid = str(place.get("trailhead_place_id") or "")
            if not pid or pid in seen:
                continue
            distance = _place_distance_mi(lat, lng, place)
            if distance > radius_mi:
                continue
            category = re.sub(r"[^a-z0-9_]+", "", str(place.get("category") or place.get("type") or "").lower().replace(" ", "_"))
            if normalized_categories and category not in normalized_categories and not (
                category in {"camp", "camping"} and normalized_categories.intersection({"camp", "camps", "camping"})
            ):
                continue
            age_seconds = max(0, now - int(place.get("last_seen") or place.get("updated_at") or 0))
            stale = age_seconds > stale_after_seconds
            if stale and not include_stale:
                continue
            seen.add(pid)
            place["id"] = pid
            place["source_place_id"] = place.get("source_place_id") or (place.get("provider_ids") or {}).get(place.get("source"))
            place["provider_place_id"] = place.get("source_place_id") or place.get("provider_place_id")
            place["place_id"] = place.get("source_place_id") or place.get("place_id")
            place["type"] = place.get("category") or place.get("type") or "place"
            place["photo_url"] = place.get("hero_photo_url") or place.get("photo_url") or ""
            place["distance_mi"] = round(distance, 2)
            place["cache_status"] = "stale" if stale else "hit"
            place["cached"] = True
            place["last_seen_at"] = int(place.get("last_seen") or 0)
            place["last_refreshed_at"] = place.get("last_refreshed_at") or int(place.get("updated_at") or 0)
            place["stale"] = stale
            if stale:
                place.setdefault("stale_reason", f"Source data older than {max(1, stale_after_seconds // 86400)} days.")
            out.append(place)
            if len(out) >= limit:
                db.close()
                return sorted(out, key=lambda p: (p.get("stale", False), p.get("source_priority", 50), p.get("distance_mi", 9999), p.get("name", "")))
    db.close()
    return sorted(out, key=lambda p: (p.get("stale", False), p.get("source_priority", 50), p.get("distance_mi", 9999), p.get("name", "")))[:limit]

def add_place_comment(trailhead_place_id: str, user_id: int, username: str, body: str) -> dict:
    now = int(time.time())
    db = _conn()
    cur = db.execute(
        """INSERT INTO place_comments (trailhead_place_id,user_id,username,body,status,created_at)
           VALUES (?,?,?,?, 'visible', ?)""",
        (trailhead_place_id, user_id, username, body[:1200], now),
    )
    db.commit()
    comment = db.execute(
        "SELECT id,username,body,created_at FROM place_comments WHERE id=?",
        (cur.lastrowid,),
    ).fetchone()
    db.close()
    return dict(comment) if comment else {"id": cur.lastrowid, "created_at": now}

def get_place_comments(trailhead_place_id: str, limit: int = 50) -> list[dict]:
    db = _conn()
    comments = _place_public_comments(db, trailhead_place_id, limit)
    db.close()
    return comments

def add_place_photo(
    trailhead_place_id: str,
    user_id: int,
    username: str,
    *,
    comment_id: int | None = None,
    object_key: str | None = None,
    url: str | None = None,
    caption: str | None = None,
    photo_data: str | None = None,
    content_type: str = "image/jpeg",
) -> dict:
    now = int(time.time())
    db = _conn()
    cur = db.execute(
        """INSERT INTO place_photos
           (trailhead_place_id,user_id,username,comment_id,object_key,url,caption,source,status,content_type,photo_data,credits_awarded,created_at)
           VALUES (?,?,?,?,?,?,?,?, 'visible', ?, ?, ?, ?)""",
        (
            trailhead_place_id, user_id, username, comment_id, object_key, url,
            (caption or "")[:500] or None, "user", content_type[:120], photo_data,
            PLACE_PHOTO_CREDITS, now,
        ),
    )
    photo_id = cur.lastrowid
    if not url:
        url = f"/api/places/photos/{photo_id}/image"
        db.execute("UPDATE place_photos SET url=? WHERE id=?", (url, photo_id))
    place = db.execute("SELECT name FROM places WHERE trailhead_place_id=?", (trailhead_place_id,)).fetchone()
    label = (place["name"] if place else trailhead_place_id)[:80]
    db.execute("UPDATE users SET credits=credits+? WHERE id=?", (PLACE_PHOTO_CREDITS, user_id))
    db.execute(
        "INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
        (user_id, PLACE_PHOTO_CREDITS, f"Place photo: {label}", now),
    )
    _record_contest_event_db(db, user_id, PLACE_PHOTO_CREDITS, f"Place photo: {label}", "place_photo", str(photo_id), now)
    row = db.execute(
        """SELECT id,trailhead_place_id,username,comment_id,object_key,url,caption,source,status,credits_awarded,created_at
           FROM place_photos WHERE id=?""",
        (photo_id,),
    ).fetchone()
    db.commit(); db.close()
    return dict(row)

def get_place_photo_image(photo_id: int) -> dict | None:
    db = _conn()
    row = db.execute(
        "SELECT id,content_type,photo_data,status FROM place_photos WHERE id=?",
        (photo_id,),
    ).fetchone()
    db.close()
    return dict(row) if row and row["status"] == "visible" and row["photo_data"] else None

def get_place_photos(trailhead_place_id: str, limit: int = 50) -> list[dict]:
    db = _conn()
    photos = _place_public_photos(db, trailhead_place_id, limit)
    db.close()
    return photos

def add_place_edit_suggestion(trailhead_place_id: str, place_name: str, user_id: int | None,
                              username: str | None, field: str, value: str,
                              note: str | None = None) -> dict:
    now = int(time.time())
    db = _conn()
    cur = db.execute(
        """INSERT INTO place_edit_suggestions
           (trailhead_place_id,place_name,user_id,username,field,value,note,status,created_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (trailhead_place_id, place_name[:180], user_id, username, field[:80], value[:8000], note[:800] if note else None, "pending", now),
    )
    suggestion_id = cur.lastrowid
    if user_id:
        db.execute("UPDATE users SET credits=credits+? WHERE id=?", (PLACE_EDIT_CREDITS, user_id))
        db.execute(
            "INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
            (user_id, PLACE_EDIT_CREDITS, f"Place edit suggestion: {place_name[:80]}", now),
        )
        _record_contest_event_db(db, user_id, PLACE_EDIT_CREDITS, f"Place edit suggestion: {place_name[:80]}", "place_edit_suggestion", str(suggestion_id), now)
    db.commit(); db.close()
    return {"id": suggestion_id, "status": "pending", "credits_earned": PLACE_EDIT_CREDITS if user_id else 0}

def get_place_edit_suggestions(status: str | None = "pending", limit: int = 200) -> list[dict]:
    db = _conn()
    if status:
        rows = db.execute(
            "SELECT * FROM place_edit_suggestions WHERE status=? ORDER BY created_at DESC LIMIT ?",
            (status, limit),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM place_edit_suggestions ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    db.close()
    return [dict(r) for r in rows]

def update_place_edit_suggestion_status(suggestion_id: int, status: str) -> bool:
    db = _conn()
    cur = db.execute("UPDATE place_edit_suggestions SET status=? WHERE id=?", (status, suggestion_id))
    db.commit(); db.close()
    return cur.rowcount > 0

def list_place_comments(status: str | None = "visible", limit: int = 200) -> list[dict]:
    db = _conn()
    if status:
        rows = db.execute(
            """SELECT c.*,p.name AS place_name FROM place_comments c
               LEFT JOIN places p ON p.trailhead_place_id=c.trailhead_place_id
               WHERE c.status=? ORDER BY c.created_at DESC LIMIT ?""",
            (status, limit),
        ).fetchall()
    else:
        rows = db.execute(
            """SELECT c.*,p.name AS place_name FROM place_comments c
               LEFT JOIN places p ON p.trailhead_place_id=c.trailhead_place_id
               ORDER BY c.created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    db.close()
    return [dict(r) for r in rows]

def update_place_comment_status(comment_id: int, status: str) -> bool:
    db = _conn()
    cur = db.execute("UPDATE place_comments SET status=? WHERE id=?", (status, comment_id))
    db.commit(); db.close()
    return cur.rowcount > 0

def list_place_photos(status: str | None = "visible", limit: int = 200) -> list[dict]:
    db = _conn()
    if status:
        rows = db.execute(
            """SELECT ph.id,ph.trailhead_place_id,ph.user_id,ph.username,ph.comment_id,ph.object_key,ph.url,
                      ph.caption,ph.source,ph.status,ph.credits_awarded,ph.created_at,p.name AS place_name
               FROM place_photos ph LEFT JOIN places p ON p.trailhead_place_id=ph.trailhead_place_id
               WHERE ph.status=? ORDER BY ph.created_at DESC LIMIT ?""",
            (status, limit),
        ).fetchall()
    else:
        rows = db.execute(
            """SELECT ph.id,ph.trailhead_place_id,ph.user_id,ph.username,ph.comment_id,ph.object_key,ph.url,
                      ph.caption,ph.source,ph.status,ph.credits_awarded,ph.created_at,p.name AS place_name
               FROM place_photos ph LEFT JOIN places p ON p.trailhead_place_id=ph.trailhead_place_id
               ORDER BY ph.created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    db.close()
    return [dict(r) for r in rows]

def update_place_photo_status(photo_id: int, status: str) -> bool:
    db = _conn()
    cur = db.execute("UPDATE place_photos SET status=? WHERE id=?", (status, photo_id))
    db.commit(); db.close()
    return cur.rowcount > 0

def save_place_reservation_alert(trailhead_place_id: str, user_id: int, start_date: str | None,
                                 end_date: str | None, party_size: int | None,
                                 source: str | None, booking_url: str | None) -> dict:
    now = int(time.time())
    db = _conn()
    db.execute(
        """INSERT INTO place_reservation_alerts
           (trailhead_place_id,user_id,start_date,end_date,party_size,source,booking_url,status,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,'active',?,?)
           ON CONFLICT(trailhead_place_id,user_id,start_date,end_date) DO UPDATE SET
             party_size=excluded.party_size, source=excluded.source, booking_url=excluded.booking_url,
             status='active', updated_at=excluded.updated_at""",
        (trailhead_place_id, user_id, start_date, end_date, party_size, source, booking_url, now, now),
    )
    row = db.execute(
        """SELECT * FROM place_reservation_alerts
           WHERE trailhead_place_id=? AND user_id=? AND COALESCE(start_date,'')=COALESCE(?, '') AND COALESCE(end_date,'')=COALESCE(?, '')
           ORDER BY updated_at DESC LIMIT 1""",
        (trailhead_place_id, user_id, start_date, end_date),
    ).fetchone()
    db.commit(); db.close()
    return dict(row) if row else {}

def get_place_reservation_alerts(trailhead_place_id: str, user_id: int | None = None) -> list[dict]:
    db = _conn()
    if user_id:
        rows = db.execute(
            "SELECT * FROM place_reservation_alerts WHERE trailhead_place_id=? AND user_id=? AND status='active' ORDER BY updated_at DESC",
            (trailhead_place_id, user_id),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM place_reservation_alerts WHERE trailhead_place_id=? AND status='active' ORDER BY updated_at DESC",
            (trailhead_place_id,),
        ).fetchall()
    db.close()
    return [dict(r) for r in rows]


def _decode_viator_booking(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    try:
        data["provider_payload"] = json.loads(data.get("provider_payload") or "{}")
    except Exception:
        data["provider_payload"] = {}
    return data

def save_viator_booking_intent(user_id: int, product_code: str, product_title: str | None = None,
                               travel_date: str | None = None, currency: str | None = "USD",
                               amount: float | None = None, booking_url: str | None = None,
                               provider_payload: dict | None = None, status: str = "intent") -> dict:
    now = int(time.time())
    booking_id = "vtr_" + secrets.token_urlsafe(18).replace("-", "").replace("_", "")[:24]
    db = _conn()
    db.execute(
        """INSERT INTO viator_bookings
           (id,user_id,product_code,product_title,travel_date,currency,amount,status,booking_url,provider_payload,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            booking_id,
            int(user_id),
            str(product_code or "").strip()[:120],
            str(product_title or "").strip()[:300],
            str(travel_date or "").strip()[:40],
            str(currency or "USD").strip().upper()[:8],
            amount,
            str(status or "intent").strip()[:40],
            str(booking_url or "").strip()[:1200],
            json.dumps(provider_payload or {}, separators=(",", ":")),
            now,
            now,
        ),
    )
    row = db.execute("SELECT * FROM viator_bookings WHERE id=? AND user_id=?", (booking_id, int(user_id))).fetchone()
    db.commit(); db.close()
    return _decode_viator_booking(row) if row else {}

def update_viator_booking(booking_id: str, user_id: int, **updates) -> dict | None:
    allowed = {
        "product_title", "travel_date", "currency", "amount", "status", "booking_reference",
        "cart_id", "hold_expires_at", "payment_solution", "booking_url", "voucher_url",
        "provider_payload",
    }
    values = {}
    for key, value in updates.items():
        if key not in allowed:
            continue
        if key == "provider_payload":
            values[key] = json.dumps(value or {}, separators=(",", ":"))
        elif key == "currency":
            values[key] = str(value or "USD").strip().upper()[:8]
        elif isinstance(value, str):
            values[key] = value.strip()
        else:
            values[key] = value
    if not values:
        return get_viator_booking(booking_id, user_id)
    values["updated_at"] = int(time.time())
    assignments = ", ".join(f"{key}=?" for key in values.keys())
    params = list(values.values()) + [str(booking_id), int(user_id)]
    db = _conn()
    db.execute(f"UPDATE viator_bookings SET {assignments} WHERE id=? AND user_id=?", params)
    row = db.execute("SELECT * FROM viator_bookings WHERE id=? AND user_id=?", (str(booking_id), int(user_id))).fetchone()
    db.commit(); db.close()
    return _decode_viator_booking(row) if row else None

def get_viator_booking(booking_id: str, user_id: int) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM viator_bookings WHERE id=? AND user_id=?", (str(booking_id), int(user_id))).fetchone()
    db.close()
    return _decode_viator_booking(row) if row else None

def list_viator_bookings(user_id: int, limit: int = 50) -> list[dict]:
    db = _conn()
    rows = db.execute(
        "SELECT * FROM viator_bookings WHERE user_id=? ORDER BY updated_at DESC LIMIT ?",
        (int(user_id), max(1, min(int(limit or 50), 100))),
    ).fetchall()
    db.close()
    return [_decode_viator_booking(r) for r in rows]


# ── Trail Field Reports ───────────────────────────────────────────────────────

def submit_trail_field_report(trail_id: str, trail_name: str, lat: float, lng: float,
                              user_id: int, username: str, rig_label: str | None,
                              visited_date: str, sentiment: str, access_condition: str,
                              crowd_level: str, tags: list[str], note: str | None,
                              photo_data: str | None) -> dict:
    db = _conn()
    credits = FIELD_REPORT_CREDITS + (FIELD_REPORT_PHOTO_BONUS if photo_data else 0)
    now = int(time.time())
    cur = db.execute(
        """INSERT INTO trail_field_reports
           (trail_id,trail_name,lat,lng,user_id,username,rig_label,visited_date,
            sentiment,access_condition,crowd_level,tags,note,photo_data,credits_earned,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (trail_id, trail_name, lat, lng, user_id, username, rig_label, visited_date,
         sentiment, access_condition, crowd_level, json.dumps(tags), note,
         photo_data, credits, now)
    )
    db.execute("UPDATE users SET credits=credits+? WHERE id=?", (credits, user_id))
    db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
               (user_id, credits, f"Trail report for {trail_name}", now))
    _record_contest_event_db(db, user_id, credits, f"Trail report for {trail_name}", "trail_field_report", str(cur.lastrowid), now)
    db.commit(); db.close()
    return {"credits_earned": credits}

def get_trail_field_reports(trail_id: str) -> list[dict]:
    db = _conn()
    rows = db.execute(
        """SELECT id,username,rig_label,visited_date,sentiment,access_condition,
                  crowd_level,tags,note,photo_data,created_at
           FROM trail_field_reports WHERE trail_id=?
           ORDER BY created_at DESC LIMIT 50""",
        (trail_id,)
    ).fetchall()
    db.close()
    result = []
    for r in rows:
        d = dict(r)
        d['tags'] = json.loads(d['tags'] or '[]')
        d['has_photo'] = bool(d.pop('photo_data'))
        result.append(d)
    return result

def get_trail_field_report_summary(trail_id: str) -> dict:
    db = _conn()
    rows = db.execute(
        "SELECT sentiment, tags, crowd_level, access_condition, visited_date FROM trail_field_reports WHERE trail_id=? ORDER BY created_at DESC",
        (trail_id,)
    ).fetchall()
    db.close()
    if not rows:
        return {"count": 0, "sentiment_counts": {}, "top_tags": [], "last_visited": None}
    sentiment_counts: dict[str, int] = {}
    tag_counts: dict[str, int] = {}
    for r in rows:
        sentiment_counts[r["sentiment"]] = sentiment_counts.get(r["sentiment"], 0) + 1
        for t in json.loads(r["tags"] or "[]"):
            tag_counts[t] = tag_counts.get(t, 0) + 1
    top_tags = sorted(tag_counts.items(), key=lambda x: -x[1])[:8]
    return {
        "count": len(rows),
        "sentiment_counts": sentiment_counts,
        "top_tags": [{"tag": t, "count": c} for t, c in top_tags],
        "last_visited": rows[0]["visited_date"] if rows else None,
    }


# ── Trail profiles ────────────────────────────────────────────────────────────

TRAIL_PROFILE_JSON_FIELDS = {"activities", "geometry", "trailheads", "photos", "provenance"}

def _decode_trail_profile(row: sqlite3.Row | dict) -> dict:
    d = dict(row)
    for key in TRAIL_PROFILE_JSON_FIELDS:
        raw = d.get(key)
        if raw is None:
            d[key] = {} if key == "provenance" else []
            continue
        try:
            d[key] = json.loads(raw or ("{}" if key == "provenance" else "[]"))
        except Exception:
            d[key] = {} if key == "provenance" else []
    d["admin_edited"] = bool(d.get("admin_edited"))
    return d

def upsert_trail_profile(profile: dict, preserve_admin: bool = True) -> dict:
    now = int(time.time())
    trail_id = str(profile.get("id") or "").strip()[:180]
    if not trail_id:
        raise ValueError("trail profile id required")
    db = _conn()
    existing = db.execute("SELECT * FROM trail_profiles WHERE id=?", (trail_id,)).fetchone()
    if existing and preserve_admin and int(existing["admin_edited"] or 0):
        decoded = _decode_trail_profile(existing)
        db.close()
        return decoded
    merged = {**(_decode_trail_profile(existing) if existing else {}), **profile}
    lat = float(merged.get("lat") or 0)
    lng = float(merged.get("lng") or 0)
    db.execute(
        """INSERT INTO trail_profiles
           (id,name,summary,description,lat,lng,length_mi,difficulty,activities,land_manager,
            geometry,trailheads,official_url,photos,source,source_label,provenance,last_checked,admin_edited,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name, summary=excluded.summary, description=excluded.description,
             lat=excluded.lat, lng=excluded.lng, length_mi=excluded.length_mi,
             difficulty=excluded.difficulty, activities=excluded.activities,
             land_manager=excluded.land_manager, geometry=excluded.geometry,
             trailheads=excluded.trailheads, official_url=excluded.official_url,
             photos=excluded.photos, source=excluded.source, source_label=excluded.source_label,
             provenance=excluded.provenance, last_checked=excluded.last_checked,
             admin_edited=excluded.admin_edited, updated_at=excluded.updated_at""",
        (
            trail_id,
            str(merged.get("name") or "Trail")[:180],
            (merged.get("summary") or "")[:800],
            (merged.get("description") or "")[:6000],
            lat,
            lng,
            merged.get("length_mi"),
            (merged.get("difficulty") or "")[:80],
            json.dumps(merged.get("activities") or []),
            (merged.get("land_manager") or "")[:180],
            json.dumps(merged.get("geometry") or None),
            json.dumps(merged.get("trailheads") or []),
            (merged.get("official_url") or "")[:800],
            json.dumps(merged.get("photos") or []),
            (merged.get("source") or "open")[:80],
            (merged.get("source_label") or "Open source")[:180],
            json.dumps(merged.get("provenance") or {}),
            int(merged.get("last_checked") or now),
            1 if merged.get("admin_edited") else 0,
            now,
        ),
    )
    row = db.execute("SELECT * FROM trail_profiles WHERE id=?", (trail_id,)).fetchone()
    db.commit(); db.close()
    return _decode_trail_profile(row)

def get_trail_profile(trail_id: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM trail_profiles WHERE id=?", (trail_id,)).fetchone()
    db.close()
    return _decode_trail_profile(row) if row else None

def list_trail_profiles_near(lat: float, lng: float, radius_mi: float = 50, limit: int = 80,
                             bbox: dict | None = None, mode: str = "nearby") -> list[dict]:
    db = _conn()
    params: list = []
    where = ""
    if bbox:
        where = "WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?"
        params = [bbox["s"], bbox["n"], bbox["w"], bbox["e"]]
    else:
        lat_delta = radius_mi / 69
        lng_delta = radius_mi / max(10, 69 * math.cos(math.radians(lat)))
        where = "WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?"
        params = [lat - lat_delta, lat + lat_delta, lng - lng_delta, lng + lng_delta]
    candidate_limit = max(limit * 12, 500)
    rows = db.execute(
        f"""SELECT * FROM trail_profiles {where}
            ORDER BY ((lat - ?) * (lat - ?)) + ((lng - ?) * (lng - ?))
            LIMIT ?""",
        (*params, lat, lat, lng, lng, candidate_limit),
    ).fetchall()
    db.close()
    profiles = [_decode_trail_profile(r) for r in rows]
    for p in profiles:
        p["distance_mi"] = _distance_miles(lat, lng, p["lat"], p["lng"])
        if bbox:
            center_score = _distance_miles(lat, lng, p["lat"], p["lng"])
            p["viewport_score"] = max(0, 100 - center_score)
    def _sort_distance(profile: dict) -> float:
        value = profile.get("distance_mi")
        return float(value) if isinstance(value, (int, float)) else 9999.0
    if mode == "view":
        profiles.sort(key=lambda p: (-(p.get("viewport_score") or 0), _sort_distance(p), p["name"]))
    else:
        profiles.sort(key=lambda p: (_sort_distance(p), p["name"]))
    return profiles[:limit]

def _distance_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 3958.8
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))

def add_trail_edit_suggestion(trail_id: str, trail_name: str, user_id: int | None, username: str | None,
                              field: str, value: str, note: str | None) -> dict:
    now = int(time.time())
    db = _conn()
    cur = db.execute(
        """INSERT INTO trail_edit_suggestions
           (trail_id,trail_name,user_id,username,field,value,note,status,created_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (trail_id, trail_name[:180], user_id, username, field[:80], value[:8000], note, "pending", now),
    )
    db.commit(); db.close()
    return {"id": cur.lastrowid, "status": "pending"}

def get_trail_edit_suggestions(status: str | None = "pending", limit: int = 200) -> list[dict]:
    db = _conn()
    if status:
        rows = db.execute(
            "SELECT * FROM trail_edit_suggestions WHERE status=? ORDER BY created_at DESC LIMIT ?",
            (status, limit),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM trail_edit_suggestions ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    db.close()
    return [dict(r) for r in rows]

def update_trail_edit_suggestion_status(suggestion_id: int, status: str) -> bool:
    db = _conn()
    cur = db.execute("UPDATE trail_edit_suggestions SET status=? WHERE id=?", (status, suggestion_id))
    db.commit(); db.close()
    return cur.rowcount > 0

def set_trail_profile_admin_update(trail_id: str, data: dict, admin_id: int | None) -> dict:
    current = get_trail_profile(trail_id)
    if not current:
        raise KeyError(trail_id)
    clean = {k: v for k, v in data.items() if v is not None}
    return upsert_trail_profile({**current, **clean, "admin_edited": True, "provenance": {
        **(current.get("provenance") or {}),
        "admin_edit": {"source": "Trailhead admin", "updated_by": admin_id, "updated_at": int(time.time())},
    }}, preserve_admin=False)


# ── Camp profile edits ────────────────────────────────────────────────────────

def get_camp_profile_override(camp_id: str) -> dict:
    db = _conn()
    row = db.execute("SELECT data FROM camp_profile_overrides WHERE camp_id=?", (camp_id,)).fetchone()
    db.close()
    if not row:
        return {}
    try:
        return json.loads(row["data"] or "{}")
    except Exception:
        return {}

def set_camp_profile_override(camp_id: str, data: dict, admin_id: int | None) -> dict:
    current = get_camp_profile_override(camp_id)
    merged = {**current, **{k: v for k, v in data.items() if v is not None}}
    now = int(time.time())
    db = _conn()
    db.execute(
        """INSERT INTO camp_profile_overrides (camp_id,data,updated_by,updated_at)
           VALUES (?,?,?,?)
           ON CONFLICT(camp_id) DO UPDATE SET data=excluded.data, updated_by=excluded.updated_by, updated_at=excluded.updated_at""",
        (camp_id, json.dumps(merged), admin_id, now)
    )
    db.commit(); db.close()
    return merged


# ── Explore audio guide story edits ───────────────────────────────────────────

def get_explore_story_override(place_id: str) -> dict:
    db = _conn()
    row = db.execute("SELECT * FROM explore_story_overrides WHERE place_id=?", (place_id,)).fetchone()
    db.close()
    return dict(row) if row else {}

def get_explore_story_overrides() -> dict[str, dict]:
    db = _conn()
    rows = db.execute("SELECT * FROM explore_story_overrides").fetchall()
    db.close()
    return {row["place_id"]: dict(row) for row in rows}

def set_explore_story_override(place_id: str, data: dict, admin_id: int | None) -> dict:
    current = get_explore_story_override(place_id)
    merged = {
        **current,
        **{k: (v if isinstance(v, str) else None) for k, v in data.items() if k in {"title", "story", "summary", "hook", "notes"}},
    }
    now = int(time.time())
    db = _conn()
    db.execute(
        """INSERT INTO explore_story_overrides
           (place_id,title,story,summary,hook,notes,updated_by,updated_at)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(place_id) DO UPDATE SET
             title=excluded.title,
             story=excluded.story,
             summary=excluded.summary,
             hook=excluded.hook,
             notes=excluded.notes,
             updated_by=excluded.updated_by,
             updated_at=excluded.updated_at""",
        (
            place_id,
            merged.get("title"),
            merged.get("story"),
            merged.get("summary"),
            merged.get("hook"),
            merged.get("notes"),
            admin_id,
            now,
        ),
    )
    db.commit(); db.close()
    return get_explore_story_override(place_id)

def add_camp_edit_suggestion(camp_id: str, camp_name: str, lat: float, lng: float,
                             user_id: int | None, username: str | None,
                             field: str, value: str, note: str | None) -> dict:
    now = int(time.time())
    db = _conn()
    cur = db.execute(
        """INSERT INTO camp_edit_suggestions
           (camp_id,camp_name,lat,lng,user_id,username,field,value,note,status,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,'pending',?)""",
        (camp_id, camp_name, lat, lng, user_id, username, field, value, note, now)
    )
    db.commit()
    suggestion_id = cur.lastrowid
    db.close()
    return {"id": suggestion_id, "status": "pending"}

def get_camp_edit_suggestions(status: str | None = None, limit: int = 200) -> list[dict]:
    db = _conn()
    if status:
        rows = db.execute(
            "SELECT * FROM camp_edit_suggestions WHERE status=? ORDER BY created_at DESC LIMIT ?",
            (status, limit)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM camp_edit_suggestions ORDER BY created_at DESC LIMIT ?",
            (limit,)
        ).fetchall()
    db.close()
    return [dict(r) for r in rows]

def update_camp_edit_suggestion_status(suggestion_id: int, status: str) -> bool:
    db = _conn()
    cur = db.execute("UPDATE camp_edit_suggestions SET status=? WHERE id=?", (status, suggestion_id))
    db.commit(); db.close()
    return cur.rowcount > 0
