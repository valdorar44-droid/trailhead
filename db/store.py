"""SQLite WAL store. Schema + queries."""
from __future__ import annotations
import base64, sqlite3, json, time, math, hashlib, secrets, re, io, struct, wave, zlib, os
from datetime import date as _date, datetime as _datetime, timedelta as _timedelta, timezone as _timezone
from pathlib import Path as _Path
from urllib.parse import quote as _url_quote, unquote as _url_unquote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from config.settings import settings
from db.originals_validation import (
    OriginalValidationRunnerError,
    normalize_original_validation_output,
    original_route_geometry_sha256,
    run_originals_validation_cli,
    trusted_originals_validator_source_sha256,
    validate_original_route_network,
)

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

# Reports queued by a disconnected client should describe current conditions,
# even when the report type itself remains useful for several days.
REPORT_MAX_QUEUE_AGE = 24 * 3600


def report_max_observation_age(report_type: str) -> int:
    """Maximum accepted delay between an observation and server receipt."""
    return min(EXPIRY_BY_TYPE.get(report_type, 7 * 86400), REPORT_MAX_QUEUE_AGE)

def _conn() -> sqlite3.Connection:
    db = sqlite3.connect(settings.db_path, check_same_thread=False, timeout=30.0)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=30000")
    db.row_factory = sqlite3.Row
    return db


def _original_generator_license_attestation_complete(metadata: object) -> bool:
    if not isinstance(metadata, dict) or metadata.get("license_status") != "attested":
        return False
    attestation = metadata.get("license_attestation")
    if not isinstance(attestation, dict):
        return False
    if not str(attestation.get("terms_id") or "").strip():
        return False
    if not str(attestation.get("terms_url") or "").strip().startswith("https://"):
        return False
    if not str(attestation.get("terms_version") or "").strip():
        return False
    admin_id = attestation.get("attested_by_admin_user_id")
    if isinstance(admin_id, bool) or not isinstance(admin_id, int) or admin_id < 1:
        return False
    try:
        reviewed_raw = str(attestation.get("reviewed_at") or "").strip()
        reviewed = (
            _datetime.fromisoformat(reviewed_raw[:-1] + "+00:00" if reviewed_raw.endswith("Z") else reviewed_raw).date()
            if "T" in reviewed_raw else _date.fromisoformat(reviewed_raw)
        )
        attested_raw = str(attestation.get("attested_at") or "").strip()
        attested = _datetime.fromisoformat(
            attested_raw[:-1] + "+00:00" if attested_raw.endswith("Z") else attested_raw
        )
    except (TypeError, ValueError):
        return False
    if attested.tzinfo is None or reviewed > _datetime.now(_timezone.utc).date():
        return False
    if attested.astimezone(_timezone.utc) > _datetime.now(_timezone.utc) + _timedelta(minutes=5):
        return False
    return reviewed.year >= 2000 and attested.year >= 2000


def _backfill_original_generator_licenses(db: sqlite3.Connection) -> None:
    """Mark legacy/generated license claims unverified; never fabricate an attestation."""
    try:
        rows = db.execute(
            """SELECT pack_id,asset_id,sha256,generator_metadata_json
               FROM authored_original_assets WHERE generator_metadata_json!='{}'"""
        ).fetchall()
    except sqlite3.OperationalError:
        return
    for row in rows:
        metadata = _decode_pack_json(row["generator_metadata_json"], {})
        if not isinstance(metadata, dict) or not metadata:
            continue
        if _original_generator_license_attestation_complete(metadata):
            continue
        if metadata.get("license_status") == "unverified":
            continue
        metadata["license_status"] = "unverified"
        db.execute(
            """UPDATE authored_original_assets SET generator_metadata_json=?
               WHERE pack_id=? AND asset_id=? AND sha256=?""",
            (
                json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                row["pack_id"], row["asset_id"], row["sha256"],
            ),
        )


def _migrate_authored_entitlements_for_original_versions(db: sqlite3.Connection) -> None:
    columns = {row["name"] for row in db.execute(
        "PRAGMA table_info(authored_trip_pack_entitlements)"
    ).fetchall()}
    unique_pack_constraint = False
    for index in db.execute("PRAGMA index_list(authored_trip_pack_entitlements)").fetchall():
        if not index["unique"]:
            continue
        indexed = [row["name"] for row in db.execute(
            f"PRAGMA index_info('{index['name']}')"
        ).fetchall()]
        if indexed == ["user_id", "pack_id"] and not bool(index["partial"]):
            unique_pack_constraint = True
            break
    if "content_kind" in columns and not unique_pack_constraint:
        db.execute(
            """CREATE UNIQUE INDEX IF NOT EXISTS idx_authored_trip_pack_entitlements_legacy_pack
               ON authored_trip_pack_entitlements(user_id,pack_id)
               WHERE content_kind='trip_pack'"""
        )
        return

    db.commit()
    db.execute("PRAGMA foreign_keys=OFF")
    try:
        db.execute("BEGIN IMMEDIATE")
        has_requests = bool(db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='authored_trip_pack_acquisition_requests'"
        ).fetchone())
        if has_requests:
            db.execute(
                "ALTER TABLE authored_trip_pack_acquisition_requests RENAME TO authored_trip_pack_acquisition_requests_legacy"
            )
        db.execute(
            "ALTER TABLE authored_trip_pack_entitlements RENAME TO authored_trip_pack_entitlements_legacy"
        )
        db.execute(
            """CREATE TABLE authored_trip_pack_entitlements (
                id                TEXT PRIMARY KEY,
                user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                pack_id           TEXT NOT NULL,
                version           INTEGER NOT NULL,
                content_kind      TEXT NOT NULL DEFAULT 'trip_pack',
                acquisition_type  TEXT NOT NULL,
                list_price_credits INTEGER NOT NULL,
                credits_charged   INTEGER NOT NULL,
                explorer_discount INTEGER NOT NULL DEFAULT 0,
                claim_month       TEXT,
                trip_id           TEXT NOT NULL,
                idempotency_key   TEXT NOT NULL,
                request_hash      TEXT NOT NULL,
                acquired_at       INTEGER NOT NULL,
                UNIQUE(user_id, pack_id, version),
                UNIQUE(user_id, idempotency_key),
                UNIQUE(user_id, claim_month),
                FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version)
            )"""
        )
        legacy_has_kind = "content_kind" in columns
        legacy_kind_fallback = ",content_kind" if legacy_has_kind else ""
        kind_expression = (
            "COALESCE((SELECT content_kind FROM authored_trip_pack_versions v "
            "WHERE v.pack_id=authored_trip_pack_entitlements_legacy.pack_id "
            "AND v.version=authored_trip_pack_entitlements_legacy.version)"
            f"{legacy_kind_fallback},'trip_pack')"
        )
        db.execute(
            f"""INSERT INTO authored_trip_pack_entitlements
                (id,user_id,pack_id,version,content_kind,acquisition_type,
                 list_price_credits,credits_charged,explorer_discount,claim_month,
                 trip_id,idempotency_key,request_hash,acquired_at)
                SELECT id,user_id,pack_id,version,{kind_expression},acquisition_type,
                       list_price_credits,credits_charged,explorer_discount,claim_month,
                       trip_id,idempotency_key,request_hash,acquired_at
                FROM authored_trip_pack_entitlements_legacy"""
        )
        db.execute(
            """CREATE TABLE authored_trip_pack_acquisition_requests (
                user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                idempotency_key TEXT NOT NULL,
                request_hash    TEXT NOT NULL,
                entitlement_id  TEXT NOT NULL REFERENCES authored_trip_pack_entitlements(id) ON DELETE CASCADE,
                created_at      INTEGER NOT NULL,
                PRIMARY KEY (user_id, idempotency_key)
            )"""
        )
        if has_requests:
            db.execute(
                """INSERT INTO authored_trip_pack_acquisition_requests
                   (user_id,idempotency_key,request_hash,entitlement_id,created_at)
                   SELECT request.user_id,request.idempotency_key,request.request_hash,
                          request.entitlement_id,request.created_at
                   FROM authored_trip_pack_acquisition_requests_legacy request
                   JOIN authored_trip_pack_entitlements entitlement
                     ON entitlement.id=request.entitlement_id"""
            )
            db.execute("DROP TABLE authored_trip_pack_acquisition_requests_legacy")
        db.execute("DROP TABLE authored_trip_pack_entitlements_legacy")
        db.execute(
            """CREATE UNIQUE INDEX idx_authored_trip_pack_entitlements_legacy_pack
               ON authored_trip_pack_entitlements(user_id,pack_id)
               WHERE content_kind='trip_pack'"""
        )
        db.execute(
            """CREATE INDEX idx_authored_trip_pack_entitlements_user
               ON authored_trip_pack_entitlements(user_id,acquired_at DESC)"""
        )
        db.execute(
            """CREATE INDEX idx_authored_trip_pack_acquisition_entitlement
               ON authored_trip_pack_acquisition_requests(entitlement_id)"""
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.execute("PRAGMA foreign_keys=ON")


def _migrate_trip_documents_to_account_scope(db: sqlite3.Connection) -> None:
    """Replace the original global trip id primary key with an account-local key."""
    columns = db.execute("PRAGMA table_info(trip_documents_v2)").fetchall()
    if not columns:
        return
    primary_key = [row["name"] for row in sorted(columns, key=lambda row: row["pk"]) if row["pk"]]
    if primary_key == ["user_id", "id"]:
        return
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute("ALTER TABLE trip_documents_v2 RENAME TO trip_documents_v2_global_ids")
        db.execute(
            """CREATE TABLE trip_documents_v2 (
                   id            TEXT NOT NULL,
                   user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                   status        TEXT NOT NULL DEFAULT 'draft',
                   revision      INTEGER NOT NULL DEFAULT 1,
                   document_json TEXT NOT NULL,
                   created_at    INTEGER NOT NULL,
                   updated_at    INTEGER NOT NULL,
                   archived_at   INTEGER,
                   deleted_at    INTEGER,
                   PRIMARY KEY (user_id, id)
               )"""
        )
        db.execute(
            """INSERT INTO trip_documents_v2
               (id,user_id,status,revision,document_json,created_at,updated_at,archived_at,deleted_at)
               SELECT id,user_id,status,revision,document_json,created_at,updated_at,archived_at,deleted_at
               FROM trip_documents_v2_global_ids"""
        )
        db.execute("DROP TABLE trip_documents_v2_global_ids")
        db.commit()
    except Exception:
        db.rollback()
        raise


def _remove_legacy_rows_for_deleted_trip_documents(db: sqlite3.Connection) -> None:
    """Keep soft-deleted v2 trips out of the legacy account-trip surface."""
    db.execute(
        """DELETE FROM trips
           WHERE user_id IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM trip_documents_v2 v2
               WHERE v2.user_id=trips.user_id
                 AND v2.id=trips.id
                 AND v2.status='deleted'
             )"""
    )


def _backfill_embedded_trip_payloads(db: sqlite3.Connection) -> None:
    """Move large trip fields into their dedicated columns once, in place."""
    rows = db.execute(
        """SELECT id,plan,route_geometry,builder_state,audio_guide FROM trips
           WHERE plan LIKE '%\"route_geometry\"%'
              OR plan LIKE '%\"builder_state\"%'
              OR plan LIKE '%\"audio_guide\"%'"""
    ).fetchall()
    for row in rows:
        try:
            stored = json.loads(row["plan"])
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if not isinstance(stored, dict):
            continue
        changed = False
        promoted: dict[str, str | None] = {
            "route_geometry": row["route_geometry"],
            "builder_state": row["builder_state"],
            "audio_guide": row["audio_guide"],
        }
        for field in promoted:
            if field not in stored:
                continue
            embedded = stored.pop(field)
            changed = True
            if promoted[field] is None and embedded is not None:
                promoted[field] = json.dumps(embedded)
        if changed:
            db.execute(
                """UPDATE trips SET plan=?,route_geometry=?,builder_state=?,audio_guide=? WHERE id=?""",
                (
                    json.dumps(stored),
                    promoted["route_geometry"],
                    promoted["builder_state"],
                    promoted["audio_guide"],
                    row["id"],
                ),
            )


TRAILHEAD_V110_BACKEND_MIGRATION = "trailhead_1_0_10_backend_contracts_v1"


def _table_columns(db: sqlite3.Connection, table: str) -> set[str]:
    return {
        str(row["name"])
        for row in db.execute(f"PRAGMA table_info('{table}')").fetchall()
    }


def _require_table_columns(
    db: sqlite3.Connection,
    table: str,
    required: set[str],
) -> None:
    columns = _table_columns(db, table)
    missing = required.difference(columns)
    if missing:
        raise RuntimeError(
            f"Backend schema migration did not create {table}: "
            f"missing {', '.join(sorted(missing))}"
        )


def _migrate_trailhead_v110_backend_contracts(db: sqlite3.Connection) -> None:
    """Install additive 1.0.10 contracts transactionally and verify them.

    Older migrations in this database intentionally tolerate duplicate-column
    errors. New contracts use a migration ledger and structural post-checks so
    a partially applied production schema cannot masquerade as ready.
    """
    db.commit()
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute(
            """CREATE TABLE IF NOT EXISTS schema_migrations (
                migration_id TEXT PRIMARY KEY,
                applied_at   INTEGER NOT NULL
            )"""
        )
        schema_sql = """
            CREATE TABLE IF NOT EXISTS community_ratings (
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                entity_kind TEXT NOT NULL,
                entity_id   TEXT NOT NULL,
                rating      INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL,
                PRIMARY KEY (user_id, entity_kind, entity_id)
            );
            CREATE INDEX IF NOT EXISTS idx_community_ratings_entity
                ON community_ratings(entity_kind, entity_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS community_rating_events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                entity_kind TEXT NOT NULL,
                entity_id   TEXT NOT NULL,
                action      TEXT NOT NULL,
                created_at  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_community_rating_events_user
                ON community_rating_events(user_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS offline_bundle_preparations_v2 (
                id             TEXT PRIMARY KEY,
                user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                request_hash   TEXT NOT NULL,
                request_json   TEXT NOT NULL,
                status         TEXT NOT NULL DEFAULT 'queued',
                progress       INTEGER NOT NULL DEFAULT 0,
                bundle_id      TEXT,
                revision       TEXT,
                manifest_json  TEXT,
                error_code     TEXT,
                error_message  TEXT,
                created_at     INTEGER NOT NULL,
                updated_at     INTEGER NOT NULL,
                completed_at   INTEGER,
                UNIQUE(user_id, request_hash)
            );
            CREATE INDEX IF NOT EXISTS idx_offline_bundle_preparations_user
                ON offline_bundle_preparations_v2(user_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS offline_bundle_artifacts_v2 (
                preparation_id TEXT NOT NULL REFERENCES offline_bundle_preparations_v2(id) ON DELETE CASCADE,
                artifact_id    TEXT NOT NULL,
                kind           TEXT NOT NULL,
                storage_path   TEXT NOT NULL,
                media_type     TEXT NOT NULL,
                byte_count     INTEGER NOT NULL,
                sha256         TEXT NOT NULL,
                etag           TEXT NOT NULL,
                record_count   INTEGER,
                created_at     INTEGER NOT NULL,
                PRIMARY KEY (preparation_id, artifact_id)
            );

            CREATE TABLE IF NOT EXISTS route_service_segments_v1 (
                id                 TEXT PRIMARY KEY,
                user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                trip_id            TEXT NOT NULL,
                route_sha256       TEXT NOT NULL,
                evidence_revision  TEXT NOT NULL,
                sequence           INTEGER NOT NULL,
                start_progress     REAL NOT NULL,
                end_progress       REAL NOT NULL,
                availability       TEXT NOT NULL,
                source_label       TEXT,
                source_url         TEXT,
                observed_at        INTEGER,
                updated_at         INTEGER NOT NULL,
                payload_json       TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_route_service_segments_trip
                ON route_service_segments_v1(user_id, trip_id, route_sha256, sequence);
            CREATE TABLE IF NOT EXISTS route_exit_references_v1 (
                id                 TEXT PRIMARY KEY,
                user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                trip_id            TEXT NOT NULL,
                route_sha256       TEXT NOT NULL,
                evidence_revision  TEXT NOT NULL,
                route_progress     REAL NOT NULL,
                label              TEXT NOT NULL,
                availability       TEXT NOT NULL,
                source_label       TEXT,
                source_url         TEXT,
                observed_at        INTEGER,
                updated_at         INTEGER NOT NULL,
                payload_json       TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_route_exit_references_trip
                ON route_exit_references_v1(user_id, trip_id, route_sha256, route_progress);
            CREATE TABLE IF NOT EXISTS timeline_event_media_v1 (
                id                 TEXT PRIMARY KEY,
                user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                trip_id            TEXT NOT NULL,
                route_sha256       TEXT NOT NULL,
                evidence_revision  TEXT NOT NULL,
                event_id           TEXT NOT NULL,
                place_id           TEXT,
                media_url          TEXT NOT NULL,
                license_id         TEXT NOT NULL,
                attribution        TEXT NOT NULL,
                updated_at         INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_timeline_event_media_trip
                ON timeline_event_media_v1(user_id, trip_id, route_sha256, event_id);
            CREATE TABLE IF NOT EXISTS trip_brief_and_backup_v1 (
                user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                idempotency_key   TEXT NOT NULL,
                trip_id           TEXT NOT NULL,
                trip_revision     INTEGER NOT NULL,
                route_sha256      TEXT NOT NULL,
                evidence_revision TEXT NOT NULL,
                request_hash      TEXT NOT NULL,
                response_json     TEXT NOT NULL,
                credits_charged   INTEGER NOT NULL DEFAULT 0,
                created_at        INTEGER NOT NULL,
                PRIMARY KEY (user_id, idempotency_key)
            );
            CREATE INDEX IF NOT EXISTS idx_trip_brief_and_backup_trip
                ON trip_brief_and_backup_v1(user_id, trip_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS support_attachments (
                id            TEXT PRIMARY KEY,
                user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                message_id    INTEGER REFERENCES support_messages(id) ON DELETE CASCADE,
                content_type  TEXT NOT NULL,
                byte_count    INTEGER NOT NULL,
                sha256        TEXT NOT NULL,
                image_data    BLOB NOT NULL,
                created_at    INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_support_attachments_owner
                ON support_attachments(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_support_attachments_message
                ON support_attachments(message_id, created_at);

            CREATE TABLE IF NOT EXISTS account_deletion_authorizations (
                token_hash   TEXT PRIMARY KEY,
                user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                auth_method  TEXT NOT NULL,
                issued_at    INTEGER NOT NULL,
                expires_at   INTEGER NOT NULL,
                used_at      INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_account_deletion_authorizations_user
                ON account_deletion_authorizations(user_id, expires_at DESC);
            """
        for statement in schema_sql.split(";"):
            if statement.strip():
                db.execute(statement)

        required_tables = {
            "community_ratings": {"user_id", "entity_kind", "entity_id", "rating"},
            "community_rating_events": {
                "user_id", "entity_kind", "entity_id", "action", "created_at",
            },
            "offline_bundle_preparations_v2": {
                "id", "user_id", "request_hash", "status", "manifest_json",
            },
            "offline_bundle_artifacts_v2": {
                "preparation_id", "artifact_id", "storage_path", "sha256", "etag",
            },
            "route_service_segments_v1": {
                "trip_id", "route_sha256", "evidence_revision", "start_progress", "end_progress",
            },
            "route_exit_references_v1": {
                "trip_id", "route_sha256", "evidence_revision", "route_progress",
            },
            "timeline_event_media_v1": {
                "trip_id", "route_sha256", "event_id", "license_id", "attribution",
            },
            "trip_brief_and_backup_v1": {
                "user_id", "idempotency_key", "trip_id", "route_sha256", "request_hash",
            },
            "support_attachments": {
                "id", "user_id", "message_id", "content_type", "image_data",
            },
            "account_deletion_authorizations": {
                "token_hash", "user_id", "auth_method", "expires_at", "used_at",
            },
        }
        for table, columns in required_tables.items():
            _require_table_columns(db, table, columns)
        db.execute(
            "INSERT OR REPLACE INTO schema_migrations (migration_id,applied_at) VALUES (?,?)",
            (TRAILHEAD_V110_BACKEND_MIGRATION, int(time.time())),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

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
            reward_key  TEXT,
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
            client_report_id TEXT,
            observed_at   INTEGER,
            source_surface TEXT,
            accuracy_m    REAL,
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
        CREATE TABLE IF NOT EXISTS availability_monitors (
            id                   TEXT PRIMARY KEY,
            user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            target_id            TEXT NOT NULL,
            target_label         TEXT NOT NULL,
            monitor_type         TEXT NOT NULL,
            start_date           TEXT,
            end_date             TEXT,
            party_size           INTEGER,
            source               TEXT,
            booking_url          TEXT,
            criteria_json        TEXT NOT NULL DEFAULT '{}',
            status               TEXT NOT NULL DEFAULT 'active',
            billing_kind         TEXT NOT NULL,
            credits_charged      INTEGER NOT NULL DEFAULT 0,
            duration_days        INTEGER NOT NULL,
            expires_at           INTEGER NOT NULL,
            reservation_alert_id INTEGER REFERENCES place_reservation_alerts(id) ON DELETE SET NULL,
            idempotency_key      TEXT NOT NULL,
            request_hash         TEXT NOT NULL,
            failure_reason       TEXT,
            refunded_at          INTEGER,
            cancelled_at         INTEGER,
            created_at           INTEGER NOT NULL,
            updated_at           INTEGER NOT NULL,
            UNIQUE(user_id, idempotency_key)
        );
        CREATE TABLE IF NOT EXISTS authored_trip_packs (
            id                        TEXT PRIMARY KEY,
            content_kind              TEXT NOT NULL DEFAULT 'trip_pack',
            slug                      TEXT NOT NULL UNIQUE,
            status                    TEXT NOT NULL DEFAULT 'draft',
            draft_title               TEXT NOT NULL,
            draft_summary             TEXT NOT NULL,
            draft_price_credits       INTEGER NOT NULL,
            draft_coverage_region     TEXT NOT NULL,
            draft_public_metadata     TEXT NOT NULL DEFAULT '{}',
            draft_validation_metadata TEXT NOT NULL DEFAULT '{}',
            draft_template_json       TEXT NOT NULL,
            draft_original_manifest_json TEXT,
            draft_revision            INTEGER NOT NULL DEFAULT 1,
            current_published_version INTEGER,
            created_by                INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated_by                INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at                INTEGER NOT NULL,
            updated_at                INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS authored_trip_pack_versions (
            pack_id             TEXT NOT NULL REFERENCES authored_trip_packs(id) ON DELETE CASCADE,
            version             INTEGER NOT NULL,
            content_kind        TEXT NOT NULL DEFAULT 'trip_pack',
            slug                TEXT NOT NULL,
            title               TEXT NOT NULL,
            summary             TEXT NOT NULL,
            price_credits       INTEGER NOT NULL,
            coverage_region     TEXT NOT NULL,
            public_metadata     TEXT NOT NULL DEFAULT '{}',
            validation_metadata TEXT NOT NULL DEFAULT '{}',
            template_json       TEXT NOT NULL,
            original_manifest_json TEXT,
            published_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
            published_at        INTEGER NOT NULL,
            PRIMARY KEY (pack_id, version)
        );
        CREATE TABLE IF NOT EXISTS authored_trip_pack_features (
            period_month TEXT PRIMARY KEY,
            pack_id      TEXT NOT NULL,
            version      INTEGER NOT NULL,
            selected_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            selected_at  INTEGER NOT NULL,
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version)
        );
        CREATE TABLE IF NOT EXISTS authored_original_features (
            period_month TEXT PRIMARY KEY,
            pack_id      TEXT NOT NULL,
            version      INTEGER NOT NULL,
            selected_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            selected_at  INTEGER NOT NULL,
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version)
        );
        CREATE TABLE IF NOT EXISTS authored_trip_pack_entitlements (
            id                TEXT PRIMARY KEY,
            user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            pack_id           TEXT NOT NULL,
            version           INTEGER NOT NULL,
            content_kind      TEXT NOT NULL DEFAULT 'trip_pack',
            acquisition_type  TEXT NOT NULL,
            list_price_credits INTEGER NOT NULL,
            credits_charged   INTEGER NOT NULL,
            explorer_discount INTEGER NOT NULL DEFAULT 0,
            claim_month       TEXT,
            trip_id           TEXT NOT NULL,
            idempotency_key   TEXT NOT NULL,
            request_hash      TEXT NOT NULL,
            acquired_at       INTEGER NOT NULL,
            UNIQUE(user_id, pack_id, version),
            UNIQUE(user_id, idempotency_key),
            UNIQUE(user_id, claim_month),
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version)
        );
        CREATE TABLE IF NOT EXISTS authored_trip_pack_acquisition_requests (
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL,
            request_hash    TEXT NOT NULL,
            entitlement_id  TEXT NOT NULL REFERENCES authored_trip_pack_entitlements(id) ON DELETE CASCADE,
            created_at      INTEGER NOT NULL,
            PRIMARY KEY (user_id, idempotency_key)
        );
        CREATE TABLE IF NOT EXISTS authored_original_assets (
            pack_id       TEXT NOT NULL REFERENCES authored_trip_packs(id) ON DELETE CASCADE,
            asset_id      TEXT NOT NULL,
            sha256        TEXT NOT NULL,
            kind          TEXT NOT NULL,
            mime_type     TEXT NOT NULL,
            byte_count    INTEGER NOT NULL,
            public_path   TEXT NOT NULL,
            storage_path  TEXT NOT NULL,
            media_metadata_json TEXT NOT NULL DEFAULT '{}',
            transcript_sha256 TEXT,
            generator_metadata_json TEXT NOT NULL DEFAULT '{}',
            is_current    INTEGER NOT NULL DEFAULT 1,
            uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            PRIMARY KEY (pack_id, asset_id, sha256)
        );
        CREATE TABLE IF NOT EXISTS authored_original_validation_reports (
            id                 TEXT PRIMARY KEY,
            pack_id            TEXT NOT NULL REFERENCES authored_trip_packs(id) ON DELETE CASCADE,
            draft_revision     INTEGER NOT NULL,
            manifest_sha256    TEXT NOT NULL,
            assets_sha256      TEXT NOT NULL,
            input_sha256       TEXT NOT NULL,
            validator_source_sha256 TEXT NOT NULL,
            manifest_json      TEXT NOT NULL,
            suite_version      TEXT NOT NULL,
            engine_version     TEXT,
            status             TEXT NOT NULL,
            passed             INTEGER NOT NULL DEFAULT 0,
            summary_json       TEXT NOT NULL DEFAULT '{}',
            scenarios_json     TEXT NOT NULL DEFAULT '[]',
            issues_json        TEXT NOT NULL DEFAULT '[]',
            started_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
            worker_pid         INTEGER,
            started_at         INTEGER NOT NULL,
            completed_at       INTEGER
        );
        CREATE TABLE IF NOT EXISTS authored_original_feedback_tokens (
            id          TEXT PRIMARY KEY,
            pack_id     TEXT NOT NULL,
            version     INTEGER NOT NULL,
            token_hash  TEXT NOT NULL UNIQUE,
            expires_at  INTEGER NOT NULL,
            use_count   INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL,
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS authored_original_feedback_token_issuances (
            token_id             TEXT PRIMARY KEY REFERENCES authored_original_feedback_tokens(id) ON DELETE CASCADE,
            pack_id              TEXT NOT NULL,
            version              INTEGER NOT NULL,
            ip_subject_hmac      TEXT NOT NULL,
            install_subject_hmac TEXT,
            created_at           INTEGER NOT NULL,
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS authored_original_feedback (
            id                 TEXT PRIMARY KEY,
            pack_id            TEXT NOT NULL,
            version            INTEGER NOT NULL,
            stop_id            TEXT,
            user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
            guest_token_id     TEXT REFERENCES authored_original_feedback_tokens(id) ON DELETE SET NULL,
            idempotency_key    TEXT NOT NULL,
            request_hash       TEXT NOT NULL,
            category           TEXT NOT NULL,
            rating             INTEGER,
            message            TEXT NOT NULL,
            platform           TEXT NOT NULL,
            app_version        TEXT,
            runtime_version    TEXT,
            release_cohort     TEXT,
            contact_consent    INTEGER NOT NULL DEFAULT 0,
            status             TEXT NOT NULL DEFAULT 'new',
            moderation_note    TEXT,
            moderated_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
            submitted_at       INTEGER NOT NULL,
            updated_at         INTEGER NOT NULL,
            moderated_at       INTEGER,
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS communication_preferences (
            user_id                    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            weekly_digest              INTEGER NOT NULL DEFAULT 0,
            trip_window_briefs         INTEGER NOT NULL DEFAULT 0,
            deal_alerts                 INTEGER NOT NULL DEFAULT 0,
            timezone                    TEXT NOT NULL DEFAULT 'UTC',
            locale                      TEXT NOT NULL DEFAULT 'en-US',
            unsubscribed_all            INTEGER NOT NULL DEFAULT 0,
            weekly_digest_opted_in_at   INTEGER,
            trip_briefs_opted_in_at     INTEGER,
            deal_alerts_opted_in_at     INTEGER,
            unsubscribed_at             INTEGER,
            updated_at                  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS community_publications (
            id                    TEXT PRIMARY KEY,
            user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            trip_id               TEXT NOT NULL,
            note_id               TEXT NOT NULL,
            source_note_fingerprint TEXT NOT NULL,
            publication_type      TEXT NOT NULL,
            title                 TEXT NOT NULL,
            body                  TEXT NOT NULL,
            place_id              TEXT,
            status                TEXT NOT NULL DEFAULT 'pending_review',
            moderation_note       TEXT,
            moderated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
            submitted_at          INTEGER NOT NULL,
            updated_at            INTEGER NOT NULL,
            moderated_at          INTEGER,
            retracted_at          INTEGER
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
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            contest_award_id INTEGER,
            category      TEXT NOT NULL DEFAULT 'support',
            subject       TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'open',
            opened_by     TEXT NOT NULL DEFAULT 'user',
            created_by_admin INTEGER REFERENCES users(id) ON DELETE SET NULL,
            last_message_at INTEGER NOT NULL,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS support_messages (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id     INTEGER NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
            sender_role   TEXT NOT NULL,
            sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            sender_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            body          TEXT NOT NULL,
            meta_json     TEXT NOT NULL DEFAULT '{}',
            created_at    INTEGER NOT NULL,
            read_by_user_at INTEGER,
            read_by_admin_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS saved_entities (
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            canonical_id  TEXT NOT NULL,
            entity_type   TEXT NOT NULL,
            title         TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'active',
            data_json     TEXT NOT NULL DEFAULT '{}',
            revision      INTEGER NOT NULL DEFAULT 1,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            archived_at   INTEGER,
            deleted_at    INTEGER,
            PRIMARY KEY (user_id, canonical_id)
        );
        CREATE TABLE IF NOT EXISTS saved_entity_mutations (
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL,
            canonical_id    TEXT NOT NULL,
            mutation_kind   TEXT NOT NULL,
            request_hash    TEXT NOT NULL,
            response_json   TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            PRIMARY KEY (user_id, idempotency_key)
        );
        CREATE TABLE IF NOT EXISTS trip_documents_v2 (
            id            TEXT NOT NULL,
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status        TEXT NOT NULL DEFAULT 'draft',
            revision      INTEGER NOT NULL DEFAULT 1,
            document_json TEXT NOT NULL,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            archived_at   INTEGER,
            deleted_at    INTEGER,
            PRIMARY KEY (user_id, id)
        );
        CREATE TABLE IF NOT EXISTS trip_document_mutations (
            user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL,
            trip_id        TEXT NOT NULL,
            request_hash   TEXT NOT NULL,
            response_json  TEXT NOT NULL,
            created_at     INTEGER NOT NULL,
            PRIMARY KEY (user_id, idempotency_key)
        );
    """)
    _migrate_trip_documents_to_account_scope(db)
    _remove_legacy_rows_for_deleted_trip_documents(db)
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
        "CREATE INDEX IF NOT EXISTS idx_availability_monitors_user ON availability_monitors(user_id, status, expires_at, updated_at DESC)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_availability_monitors_active_target ON availability_monitors(user_id,target_id,monitor_type,COALESCE(start_date,''),COALESCE(end_date,'')) WHERE status='active'",
        "CREATE INDEX IF NOT EXISTS idx_authored_trip_packs_status ON authored_trip_packs(status, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_authored_trip_packs_kind_status ON authored_trip_packs(content_kind, status, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_authored_trip_pack_versions_published ON authored_trip_pack_versions(published_at DESC, pack_id)",
        "CREATE INDEX IF NOT EXISTS idx_authored_trip_pack_entitlements_user ON authored_trip_pack_entitlements(user_id, acquired_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_authored_original_validation_latest ON authored_original_validation_reports(pack_id,started_at DESC,id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_authored_original_validation_binding ON authored_original_validation_reports(pack_id,draft_revision,manifest_sha256,assets_sha256,status)",
        "CREATE INDEX IF NOT EXISTS idx_authored_original_feedback_issuance_ip ON authored_original_feedback_token_issuances(pack_id,version,ip_subject_hmac,created_at)",
        "CREATE INDEX IF NOT EXISTS idx_authored_original_feedback_issuance_install ON authored_original_feedback_token_issuances(pack_id,version,install_subject_hmac,created_at) WHERE install_subject_hmac IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_authored_original_feedback_issuance_created ON authored_original_feedback_token_issuances(created_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_authored_original_feedback_user_key ON authored_original_feedback(user_id,idempotency_key) WHERE user_id IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_authored_original_feedback_guest_key ON authored_original_feedback(guest_token_id,idempotency_key) WHERE guest_token_id IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_authored_original_feedback_review ON authored_original_feedback(status,submitted_at DESC,id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_authored_original_feedback_pack ON authored_original_feedback(pack_id,version,submitted_at DESC,id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_communication_preferences_digest ON communication_preferences(weekly_digest,unsubscribed_all,user_id)",
        "CREATE INDEX IF NOT EXISTS idx_communication_preferences_briefs ON communication_preferences(trip_window_briefs,unsubscribed_all,user_id)",
        "CREATE INDEX IF NOT EXISTS idx_community_publications_user ON community_publications(user_id,submitted_at DESC,id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_community_publications_review ON community_publications(status,submitted_at,id)",
        "CREATE INDEX IF NOT EXISTS idx_community_publications_place ON community_publications(place_id,status,submitted_at DESC,id DESC)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_community_publications_open_source ON community_publications(user_id,trip_id,note_id,publication_type) WHERE status IN ('pending_review','approved')",
        "CREATE INDEX IF NOT EXISTS idx_fullness_geo ON camp_fullness(lat, lng, status, expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_credits_user ON credit_transactions(user_id, created_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_credits_reward_key ON credit_transactions(user_id, reward_key) WHERE reward_key IS NOT NULL",
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
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_support_threads_contest_award ON support_threads(contest_award_id) WHERE contest_award_id IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_saved_entities_user_updated ON saved_entities(user_id, updated_at DESC, canonical_id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_saved_entities_user_type ON saved_entities(user_id, entity_type, status, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_trip_documents_v2_user_updated ON trip_documents_v2(user_id, updated_at DESC, id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_trip_document_mutations_trip ON trip_document_mutations(user_id, trip_id, created_at)",
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
        "ALTER TABLE reports ADD COLUMN client_report_id TEXT",
        "ALTER TABLE reports ADD COLUMN observed_at INTEGER",
        "ALTER TABLE reports ADD COLUMN source_surface TEXT",
        "ALTER TABLE reports ADD COLUMN accuracy_m REAL",
        "ALTER TABLE credit_transactions ADD COLUMN reward_key TEXT",
        "ALTER TABLE support_threads ADD COLUMN contest_award_id INTEGER",
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
        """CREATE TABLE IF NOT EXISTS availability_monitors (
            id                   TEXT PRIMARY KEY,
            user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            target_id            TEXT NOT NULL,
            target_label         TEXT NOT NULL,
            monitor_type         TEXT NOT NULL,
            start_date           TEXT,
            end_date             TEXT,
            party_size           INTEGER,
            source               TEXT,
            booking_url          TEXT,
            criteria_json        TEXT NOT NULL DEFAULT '{}',
            status               TEXT NOT NULL DEFAULT 'active',
            billing_kind         TEXT NOT NULL,
            credits_charged      INTEGER NOT NULL DEFAULT 0,
            duration_days        INTEGER NOT NULL,
            expires_at           INTEGER NOT NULL,
            reservation_alert_id INTEGER REFERENCES place_reservation_alerts(id) ON DELETE SET NULL,
            idempotency_key      TEXT NOT NULL,
            request_hash         TEXT NOT NULL,
            failure_reason       TEXT,
            refunded_at          INTEGER,
            cancelled_at         INTEGER,
            created_at           INTEGER NOT NULL,
            updated_at           INTEGER NOT NULL,
            UNIQUE(user_id, idempotency_key)
        )""",
        """CREATE TABLE IF NOT EXISTS authored_trip_packs (
            id                        TEXT PRIMARY KEY,
            content_kind              TEXT NOT NULL DEFAULT 'trip_pack',
            slug                      TEXT NOT NULL UNIQUE,
            status                    TEXT NOT NULL DEFAULT 'draft',
            draft_title               TEXT NOT NULL,
            draft_summary             TEXT NOT NULL,
            draft_price_credits       INTEGER NOT NULL,
            draft_coverage_region     TEXT NOT NULL,
            draft_public_metadata     TEXT NOT NULL DEFAULT '{}',
            draft_validation_metadata TEXT NOT NULL DEFAULT '{}',
            draft_template_json       TEXT NOT NULL,
            draft_original_manifest_json TEXT,
            draft_revision            INTEGER NOT NULL DEFAULT 1,
            current_published_version INTEGER,
            created_by                INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated_by                INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at                INTEGER NOT NULL,
            updated_at                INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS authored_trip_pack_versions (
            pack_id             TEXT NOT NULL REFERENCES authored_trip_packs(id) ON DELETE CASCADE,
            version             INTEGER NOT NULL,
            content_kind        TEXT NOT NULL DEFAULT 'trip_pack',
            slug                TEXT NOT NULL,
            title               TEXT NOT NULL,
            summary             TEXT NOT NULL,
            price_credits       INTEGER NOT NULL,
            coverage_region     TEXT NOT NULL,
            public_metadata     TEXT NOT NULL DEFAULT '{}',
            validation_metadata TEXT NOT NULL DEFAULT '{}',
            template_json       TEXT NOT NULL,
            original_manifest_json TEXT,
            published_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
            published_at        INTEGER NOT NULL,
            PRIMARY KEY (pack_id, version)
        )""",
        """CREATE TABLE IF NOT EXISTS authored_trip_pack_features (
            period_month TEXT PRIMARY KEY,
            pack_id      TEXT NOT NULL,
            version      INTEGER NOT NULL,
            selected_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            selected_at  INTEGER NOT NULL,
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version)
        )""",
        """CREATE TABLE IF NOT EXISTS authored_original_features (
            period_month TEXT PRIMARY KEY,
            pack_id      TEXT NOT NULL,
            version      INTEGER NOT NULL,
            selected_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            selected_at  INTEGER NOT NULL,
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version)
        )""",
        """CREATE TABLE IF NOT EXISTS authored_trip_pack_entitlements (
            id                TEXT PRIMARY KEY,
            user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            pack_id           TEXT NOT NULL,
            version           INTEGER NOT NULL,
            content_kind      TEXT NOT NULL DEFAULT 'trip_pack',
            acquisition_type  TEXT NOT NULL,
            list_price_credits INTEGER NOT NULL,
            credits_charged   INTEGER NOT NULL,
            explorer_discount INTEGER NOT NULL DEFAULT 0,
            claim_month       TEXT,
            trip_id           TEXT NOT NULL,
            idempotency_key   TEXT NOT NULL,
            request_hash      TEXT NOT NULL,
            acquired_at       INTEGER NOT NULL,
            UNIQUE(user_id, pack_id, version),
            UNIQUE(user_id, idempotency_key),
            UNIQUE(user_id, claim_month),
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version)
        )""",
        """CREATE TABLE IF NOT EXISTS authored_trip_pack_acquisition_requests (
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL,
            request_hash    TEXT NOT NULL,
            entitlement_id  TEXT NOT NULL REFERENCES authored_trip_pack_entitlements(id) ON DELETE CASCADE,
            created_at      INTEGER NOT NULL,
            PRIMARY KEY (user_id, idempotency_key)
        )""",
        """CREATE TABLE IF NOT EXISTS authored_original_assets (
            pack_id       TEXT NOT NULL REFERENCES authored_trip_packs(id) ON DELETE CASCADE,
            asset_id      TEXT NOT NULL,
            sha256        TEXT NOT NULL,
            kind          TEXT NOT NULL,
            mime_type     TEXT NOT NULL,
            byte_count    INTEGER NOT NULL,
            public_path   TEXT NOT NULL,
            storage_path  TEXT NOT NULL,
            media_metadata_json TEXT NOT NULL DEFAULT '{}',
            transcript_sha256 TEXT,
            generator_metadata_json TEXT NOT NULL DEFAULT '{}',
            is_current    INTEGER NOT NULL DEFAULT 1,
            uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            PRIMARY KEY (pack_id, asset_id, sha256)
        )""",
        """CREATE TABLE IF NOT EXISTS authored_original_validation_reports (
            id                 TEXT PRIMARY KEY,
            pack_id            TEXT NOT NULL REFERENCES authored_trip_packs(id) ON DELETE CASCADE,
            draft_revision     INTEGER NOT NULL,
            manifest_sha256    TEXT NOT NULL,
            assets_sha256      TEXT NOT NULL,
            input_sha256       TEXT NOT NULL,
            validator_source_sha256 TEXT NOT NULL,
            manifest_json      TEXT NOT NULL,
            suite_version      TEXT NOT NULL,
            engine_version     TEXT,
            status             TEXT NOT NULL,
            passed             INTEGER NOT NULL DEFAULT 0,
            summary_json       TEXT NOT NULL DEFAULT '{}',
            scenarios_json     TEXT NOT NULL DEFAULT '[]',
            issues_json        TEXT NOT NULL DEFAULT '[]',
            started_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
            worker_pid         INTEGER,
            started_at         INTEGER NOT NULL,
            completed_at       INTEGER
        )""",
        """CREATE TABLE IF NOT EXISTS authored_original_feedback_tokens (
            id          TEXT PRIMARY KEY,
            pack_id     TEXT NOT NULL,
            version     INTEGER NOT NULL,
            token_hash  TEXT NOT NULL UNIQUE,
            expires_at  INTEGER NOT NULL,
            use_count   INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL,
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version) ON DELETE CASCADE
        )""",
        """CREATE TABLE IF NOT EXISTS authored_original_feedback_token_issuances (
            token_id             TEXT PRIMARY KEY REFERENCES authored_original_feedback_tokens(id) ON DELETE CASCADE,
            pack_id              TEXT NOT NULL,
            version              INTEGER NOT NULL,
            ip_subject_hmac      TEXT NOT NULL,
            install_subject_hmac TEXT,
            created_at           INTEGER NOT NULL,
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version) ON DELETE CASCADE
        )""",
        """CREATE TABLE IF NOT EXISTS authored_original_feedback (
            id                 TEXT PRIMARY KEY,
            pack_id            TEXT NOT NULL,
            version            INTEGER NOT NULL,
            stop_id            TEXT,
            user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
            guest_token_id     TEXT REFERENCES authored_original_feedback_tokens(id) ON DELETE SET NULL,
            idempotency_key    TEXT NOT NULL,
            request_hash       TEXT NOT NULL,
            category           TEXT NOT NULL,
            rating             INTEGER,
            message            TEXT NOT NULL,
            platform           TEXT NOT NULL,
            app_version        TEXT,
            runtime_version    TEXT,
            release_cohort     TEXT,
            contact_consent    INTEGER NOT NULL DEFAULT 0,
            status             TEXT NOT NULL DEFAULT 'new',
            moderation_note    TEXT,
            moderated_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
            submitted_at       INTEGER NOT NULL,
            updated_at         INTEGER NOT NULL,
            moderated_at       INTEGER,
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version) ON DELETE CASCADE
        )""",
        """CREATE TABLE IF NOT EXISTS communication_preferences (
            user_id                    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            weekly_digest              INTEGER NOT NULL DEFAULT 0,
            trip_window_briefs         INTEGER NOT NULL DEFAULT 0,
            deal_alerts                 INTEGER NOT NULL DEFAULT 0,
            timezone                    TEXT NOT NULL DEFAULT 'UTC',
            locale                      TEXT NOT NULL DEFAULT 'en-US',
            unsubscribed_all            INTEGER NOT NULL DEFAULT 0,
            weekly_digest_opted_in_at   INTEGER,
            trip_briefs_opted_in_at     INTEGER,
            deal_alerts_opted_in_at     INTEGER,
            unsubscribed_at             INTEGER,
            updated_at                  INTEGER NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS community_publications (
            id                    TEXT PRIMARY KEY,
            user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            trip_id               TEXT NOT NULL,
            note_id               TEXT NOT NULL,
            source_note_fingerprint TEXT NOT NULL,
            publication_type      TEXT NOT NULL,
            title                 TEXT NOT NULL,
            body                  TEXT NOT NULL,
            place_id              TEXT,
            status                TEXT NOT NULL DEFAULT 'pending_review',
            moderation_note       TEXT,
            moderated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
            submitted_at          INTEGER NOT NULL,
            updated_at            INTEGER NOT NULL,
            moderated_at          INTEGER,
            retracted_at          INTEGER
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
        "CREATE INDEX IF NOT EXISTS idx_availability_monitors_user ON availability_monitors(user_id, status, expires_at, updated_at DESC)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_availability_monitors_active_target ON availability_monitors(user_id,target_id,monitor_type,COALESCE(start_date,''),COALESCE(end_date,'')) WHERE status='active'",
        "CREATE INDEX IF NOT EXISTS idx_authored_trip_packs_status ON authored_trip_packs(status, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_authored_trip_pack_versions_published ON authored_trip_pack_versions(published_at DESC, pack_id)",
        "CREATE INDEX IF NOT EXISTS idx_authored_trip_pack_entitlements_user ON authored_trip_pack_entitlements(user_id, acquired_at DESC)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_authored_trip_pack_entitlements_legacy_pack ON authored_trip_pack_entitlements(user_id,pack_id) WHERE content_kind='trip_pack'",
        "CREATE INDEX IF NOT EXISTS idx_authored_trip_pack_acquisition_entitlement ON authored_trip_pack_acquisition_requests(entitlement_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_authored_original_assets_current ON authored_original_assets(pack_id,asset_id) WHERE is_current=1",
        "ALTER TABLE authored_original_assets ADD COLUMN media_metadata_json TEXT NOT NULL DEFAULT '{}'",
        "ALTER TABLE authored_original_assets ADD COLUMN transcript_sha256 TEXT",
        "ALTER TABLE authored_original_assets ADD COLUMN generator_metadata_json TEXT NOT NULL DEFAULT '{}'",
        "ALTER TABLE authored_original_validation_reports ADD COLUMN validator_source_sha256 TEXT",
        "ALTER TABLE authored_original_validation_reports ADD COLUMN manifest_json TEXT",
        "ALTER TABLE authored_original_validation_reports ADD COLUMN worker_pid INTEGER",
        "CREATE INDEX IF NOT EXISTS idx_communication_preferences_digest ON communication_preferences(weekly_digest,unsubscribed_all,user_id)",
        "CREATE INDEX IF NOT EXISTS idx_communication_preferences_briefs ON communication_preferences(trip_window_briefs,unsubscribed_all,user_id)",
        "CREATE INDEX IF NOT EXISTS idx_community_publications_user ON community_publications(user_id,submitted_at DESC,id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_community_publications_review ON community_publications(status,submitted_at,id)",
        "CREATE INDEX IF NOT EXISTS idx_community_publications_place ON community_publications(place_id,status,submitted_at DESC,id DESC)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_community_publications_open_source ON community_publications(user_id,trip_id,note_id,publication_type) WHERE status IN ('pending_review','approved')",
        "ALTER TABLE authored_trip_pack_versions ADD COLUMN slug TEXT",
        "ALTER TABLE authored_trip_packs ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'trip_pack'",
        "ALTER TABLE authored_trip_packs ADD COLUMN draft_original_manifest_json TEXT",
        "ALTER TABLE authored_trip_pack_versions ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'trip_pack'",
        "ALTER TABLE authored_trip_pack_versions ADD COLUMN original_manifest_json TEXT",
        "CREATE INDEX IF NOT EXISTS idx_authored_trip_packs_kind_status ON authored_trip_packs(content_kind, status, updated_at DESC)",
        """CREATE TABLE IF NOT EXISTS authored_original_features (
            period_month TEXT PRIMARY KEY,
            pack_id      TEXT NOT NULL,
            version      INTEGER NOT NULL,
            selected_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            selected_at  INTEGER NOT NULL,
            FOREIGN KEY (pack_id, version) REFERENCES authored_trip_pack_versions(pack_id, version)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_authored_original_features_pack ON authored_original_features(pack_id, version)",
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
        """CREATE TABLE IF NOT EXISTS saved_entities (
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            canonical_id  TEXT NOT NULL,
            entity_type   TEXT NOT NULL,
            title         TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'active',
            data_json     TEXT NOT NULL DEFAULT '{}',
            revision      INTEGER NOT NULL DEFAULT 1,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            archived_at   INTEGER,
            deleted_at    INTEGER,
            PRIMARY KEY (user_id, canonical_id)
        )""",
        """CREATE TABLE IF NOT EXISTS saved_entity_mutations (
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL,
            canonical_id    TEXT NOT NULL,
            mutation_kind   TEXT NOT NULL,
            request_hash    TEXT NOT NULL,
            response_json   TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            PRIMARY KEY (user_id, idempotency_key)
        )""",
        """CREATE TABLE IF NOT EXISTS trip_documents_v2 (
            id            TEXT NOT NULL,
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status        TEXT NOT NULL DEFAULT 'draft',
            revision      INTEGER NOT NULL DEFAULT 1,
            document_json TEXT NOT NULL,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            archived_at   INTEGER,
            deleted_at    INTEGER,
            PRIMARY KEY (user_id, id)
        )""",
        """CREATE TABLE IF NOT EXISTS trip_document_mutations (
            user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL,
            trip_id        TEXT NOT NULL,
            request_hash   TEXT NOT NULL,
            response_json  TEXT NOT NULL,
            created_at     INTEGER NOT NULL,
            PRIMARY KEY (user_id, idempotency_key)
        )""",
        "CREATE INDEX IF NOT EXISTS idx_saved_entities_user_updated ON saved_entities(user_id, updated_at DESC, canonical_id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_saved_entities_user_type ON saved_entities(user_id, entity_type, status, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_saved_entity_mutations_item ON saved_entity_mutations(user_id, canonical_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_trip_documents_v2_user_updated ON trip_documents_v2(user_id, updated_at DESC, id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_trip_document_mutations_trip ON trip_document_mutations(user_id, trip_id, created_at)",
    ]:
        try:
            db.execute(sql)
        except Exception:
            pass
    # Originals retain every immutable version a user owns, while legacy trip
    # packs remain one entitlement per pack. Rebuild older entitlement tables
    # before backfilling their request ledger.
    _migrate_authored_entitlements_for_original_versions(db)

    # Preserve every legacy acquisition key in the request ledger. New keys are
    # recorded there as well, including no-charge, already-owned responses.
    db.execute(
        """INSERT OR IGNORE INTO authored_trip_pack_acquisition_requests
           (user_id,idempotency_key,request_hash,entitlement_id,created_at)
           SELECT user_id,idempotency_key,request_hash,id,acquired_at
           FROM authored_trip_pack_entitlements"""
    )
    # These indexes depend on columns/tables added by the migration loop above.
    # A partial unique index preserves compatibility for legacy NULL identifiers.
    db.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_user_client_report
           ON reports(user_id, client_report_id)
           WHERE client_report_id IS NOT NULL"""
    )
    db.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_credits_reward_key
           ON credit_transactions(user_id, reward_key)
           WHERE reward_key IS NOT NULL"""
    )
    db.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_support_threads_contest_award
           ON support_threads(contest_award_id)
           WHERE contest_award_id IS NOT NULL"""
    )
    db.execute(
        """DELETE FROM report_interactions
           WHERE action IN ('upvote','downvote')
             AND id NOT IN (
               SELECT MIN(id) FROM report_interactions
               WHERE action IN ('upvote','downvote')
               GROUP BY report_id,user_id
             )"""
    )
    db.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_report_interactions_user_vote
           ON report_interactions(report_id, user_id)
           WHERE action IN ('upvote', 'downvote')"""
    )
    db.execute(
        """DELETE FROM report_interactions
           WHERE action='confirm'
             AND id NOT IN (
               SELECT MIN(id) FROM report_interactions
               WHERE action='confirm'
               GROUP BY report_id,user_id
             )"""
    )
    db.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_report_interactions_user_confirmation
           ON report_interactions(report_id, user_id)
           WHERE action='confirm'"""
    )
    # Preserve pre-policy campground alerts as grandfathered 30-day watches.
    try:
        db.execute(
            """INSERT OR IGNORE INTO availability_monitors
               (id,user_id,target_id,target_label,monitor_type,start_date,end_date,
                party_size,source,booking_url,criteria_json,status,billing_kind,
                credits_charged,duration_days,expires_at,reservation_alert_id,
                idempotency_key,request_hash,created_at,updated_at)
               SELECT
                 'legacy_reservation_' || alert.id,
                 alert.user_id,
                 alert.trailhead_place_id,
                 COALESCE(NULLIF(place.name,''),'Saved campground'),
                 'campground',alert.start_date,alert.end_date,
                 COALESCE(alert.party_size,1),COALESCE(alert.source,'trailhead'),
                 alert.booking_url,'{}',
                 CASE WHEN alert.status='active' THEN 'active' ELSE 'cancelled' END,
                 'legacy',0,30,
                 COALESCE(alert.updated_at,alert.created_at) + 2592000,
                 alert.id,
                 'legacy-reservation-' || alert.id,
                 'legacy-reservation-' || alert.id,
                 alert.created_at,COALESCE(alert.updated_at,alert.created_at)
               FROM place_reservation_alerts alert
               JOIN users account ON account.id=alert.user_id
               LEFT JOIN places place ON place.trailhead_place_id=alert.trailhead_place_id
               WHERE NOT EXISTS (
                 SELECT 1 FROM availability_monitors monitor
                 WHERE monitor.reservation_alert_id=alert.id
               )"""
        )
    except Exception:
        pass
    try:
        db.execute(
            """UPDATE authored_trip_pack_versions
               SET slug=(SELECT pack.slug FROM authored_trip_packs pack WHERE pack.id=authored_trip_pack_versions.pack_id)
               WHERE slug IS NULL OR slug=''"""
        )
    except Exception:
        pass
    _backfill_original_generator_licenses(db)
    _recover_incomplete_original_validation_runs_db(
        db,
        interrupted_by_restart=True,
    )
    _backfill_embedded_trip_payloads(db)
    _migrate_trailhead_v110_backend_contracts(db)
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
        # Completed planner payloads can contain full route geometry. Trips are
        # already persisted separately, so old job envelopes need not live forever.
        plan_job_cutoff = now - 7 * 86400
        db.execute(
            "DELETE FROM plan_jobs WHERE status IN ('done','failed') AND updated_at < ?",
            (plan_job_cutoff,),
        )
        # Quota subjects are scoped HMACs, but they still have no purpose after
        # the rolling issuance window closes. Remove them on normal maintenance.
        db.execute(
            "DELETE FROM authored_original_feedback_token_issuances WHERE created_at < ?",
            (now - ORIGINAL_FEEDBACK_TOKEN_ISSUANCE_WINDOW_SECONDS,),
        )
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

_ROUTE_GEOMETRY_UNSET = object()
_BUILDER_STATE_UNSET = object()
_AUDIO_GUIDE_UNSET = object()
_ACCOUNT_TRIP_FIELD_UNSET = object()


def _legacy_waypoint_item_kind(waypoint: dict) -> str:
    waypoint_type = str(waypoint.get("type") or waypoint.get("kind") or "place").strip().lower()
    if waypoint_type == "start":
        return "start"
    if waypoint_type in {"destination", "finish", "end"}:
        return "destination"
    if waypoint_type in {"camp", "motel", "lodging", "stay"}:
        return "camp"
    if waypoint_type in {"trail", "trailhead", "hike"}:
        return "trail"
    if waypoint_type in {"activity", "attraction", "experience", "bookable_experience", "tour"}:
        return "activity"
    if waypoint_type in {"fuel", "gas"}:
        return "fuel"
    if waypoint_type == "water":
        return "water"
    if waypoint_type in {"food", "grocery", "restaurant"}:
        return "food"
    if waypoint_type in {"service", "shower", "mechanic", "dump", "propane"}:
        return "service"
    if waypoint_type == "note":
        return "note"
    return "place"


def _legacy_waypoint_coordinates(waypoint: dict) -> dict | None:
    coordinates = waypoint.get("coordinates") if isinstance(waypoint.get("coordinates"), dict) else {}
    try:
        lat = float(waypoint.get("lat") if waypoint.get("lat") is not None else coordinates.get("lat"))
        lng = float(waypoint.get("lng") if waypoint.get("lng") is not None else coordinates.get("lng"))
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return {"lat": lat, "lng": lng}


def _legacy_source_waypoint(item: dict) -> dict:
    facts = item.get("facts") if isinstance(item.get("facts"), dict) else {}
    waypoint = facts.get("legacyWaypoint") or facts.get("legacy_waypoint")
    return waypoint if isinstance(waypoint, dict) else {}


def _v2_item_is_legacy_route_owned(item: dict, trip_id: str) -> bool:
    if not isinstance(item, dict):
        return True
    if _legacy_source_waypoint(item):
        return True
    if item.get("name") and not item.get("title"):
        return True
    item_id = str(item.get("id") or "")
    if item_id.startswith(f"{trip_id}:waypoint:"):
        return True
    return str(item.get("kind") or "").strip().lower() in {"start", "destination"}


def _legacy_waypoint_match_key(waypoint: dict) -> tuple[str, float | None, float | None]:
    title = str(waypoint.get("name") or waypoint.get("title") or "").strip().casefold()
    coordinates = _legacy_waypoint_coordinates(waypoint)
    return (
        title,
        round(float(coordinates["lat"]), 5) if coordinates else None,
        round(float(coordinates["lng"]), 5) if coordinates else None,
    )


def _canonical_v2_items_from_legacy_waypoints(
    trip_id: str,
    waypoints: list[dict],
    existing_items: list[dict],
    now: int,
) -> list[dict]:
    """Project route waypoints into V2 items without dropping V2-only itinerary items."""
    existing = [dict(item) for item in existing_items if isinstance(item, dict)]
    used_existing: set[int] = set()
    known_route_indices = [
        index for index, item in enumerate(existing)
        if _v2_item_is_legacy_route_owned(item, trip_id)
    ]

    def source_id(value: dict) -> str:
        return str(value.get("id") or value.get("entity_id") or "").strip()

    def find_match(waypoint: dict, route_position: int) -> int | None:
        waypoint_id = source_id(waypoint)
        if waypoint_id:
            for index, item in enumerate(existing):
                if index in used_existing:
                    continue
                legacy = _legacy_source_waypoint(item)
                if waypoint_id in {source_id(legacy), str(item.get("entity_id") or "").strip()}:
                    return index

        match_key = _legacy_waypoint_match_key(waypoint)
        for index, item in enumerate(existing):
            if index in used_existing or str(item.get("kind") or "").lower() in {"activity", "note"}:
                continue
            if _legacy_waypoint_match_key({
                "name": item.get("title"),
                "coordinates": item.get("coordinates"),
            }) == match_key:
                return index

        ordered_route_indices = [
            *known_route_indices[route_position:],
            *known_route_indices[:route_position],
        ]
        for index in ordered_route_indices:
            if index not in used_existing:
                return index
        return None

    route_items: list[dict] = []
    occupied_ids = {str(item.get("id") or "") for item in existing if item.get("id")}
    for route_position, raw_waypoint in enumerate(waypoints):
        if not isinstance(raw_waypoint, dict):
            continue
        waypoint = dict(raw_waypoint)
        title = str(waypoint.get("name") or waypoint.get("title") or "").strip()
        if not title:
            continue
        matched_index = find_match(waypoint, route_position)
        matched = existing[matched_index] if matched_index is not None else {}
        if matched_index is not None:
            used_existing.add(matched_index)

        item_id = str(matched.get("id") or "").strip()
        if not item_id:
            identity = source_id(waypoint) or "|".join(map(str, _legacy_waypoint_match_key(waypoint)))
            digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:12]
            item_id = f"{trip_id}:waypoint:{digest}"[:240]
            suffix = 2
            base_id = item_id
            while item_id in occupied_ids:
                item_id = f"{base_id[:235]}:{suffix}"
                suffix += 1
        occupied_ids.add(item_id)

        facts = dict(matched.get("facts")) if isinstance(matched.get("facts"), dict) else {}
        facts.pop("legacyWaypoint", None)
        facts["legacy_waypoint"] = waypoint
        try:
            day = max(1, int(waypoint.get("day") or 1))
        except (TypeError, ValueError):
            day = 1
        item = {
            **matched,
            "schema_version": 1,
            "id": item_id,
            "kind": _legacy_waypoint_item_kind(waypoint),
            "title": title,
            "summary": str(waypoint.get("description") or waypoint.get("summary") or "").strip() or None,
            "day": day,
            "order": route_position,
            "facts": facts,
            "created_at": matched.get("created_at") or now,
            "updated_at": now,
        }
        for legacy_key in ("name", "type", "lat", "lng", "route_point_type", "routePointType"):
            item.pop(legacy_key, None)
        coordinates = _legacy_waypoint_coordinates(waypoint)
        if coordinates:
            item["coordinates"] = coordinates
        else:
            item.pop("coordinates", None)
        waypoint_id = source_id(waypoint)
        if waypoint_id:
            item["entity_id"] = str(matched.get("entity_id") or waypoint_id)
        if waypoint.get("notes") is not None:
            item["note"] = waypoint.get("notes")
        route_items.append(item)

    preserved_items = [
        item for index, item in enumerate(existing)
        if index not in used_existing and not _v2_item_is_legacy_route_owned(item, trip_id)
    ]
    combined = [*route_items, *preserved_items]
    return sorted(
        combined,
        key=lambda item: (
            max(1, int(item.get("day") or 1)) if str(item.get("day") or "1").isdigit() else 1,
            int(item.get("order") or 0) if str(item.get("order") or "0").lstrip("-").isdigit() else 0,
            str(item.get("id") or ""),
        ),
    )


def _canonical_v2_days_from_legacy(days: list[dict], existing_days: list[dict]) -> list[dict]:
    existing_by_day = {
        int(day.get("day")): day
        for day in existing_days
        if isinstance(day, dict) and str(day.get("day") or "").isdigit()
    }
    normalized: list[dict] = []
    for index, raw_day in enumerate(days, start=1):
        if not isinstance(raw_day, dict):
            continue
        try:
            day_number = max(1, int(raw_day.get("day") or index))
        except (TypeError, ValueError):
            day_number = index
        existing = existing_by_day.get(day_number, {})
        normalized.append({
            **existing,
            "day": day_number,
            "title": str(raw_day.get("title") or existing.get("title") or f"Day {day_number}"),
            "summary": str(raw_day.get("summary") or raw_day.get("description") or existing.get("summary") or "").strip() or None,
            "date": raw_day.get("date") or existing.get("date"),
        })
    return normalized


def _sync_v2_trip_from_legacy_write(
    db: sqlite3.Connection,
    user_id: int | None,
    trip_id: str,
    trip: dict,
    request: str,
    route_geometry: dict | None | object,
    builder_state: dict | None | object,
    replace_route_geometry: bool,
    replace_builder_state: bool,
    now: int,
    target_revision: int | None = None,
    sync_plan: bool = True,
) -> int | None:
    if user_id is None:
        return None
    row = db.execute(
        "SELECT status,revision,document_json FROM trip_documents_v2 WHERE user_id=? AND id=?",
        (user_id, trip_id),
    ).fetchone()
    if not row or row["status"] == "deleted":
        return None
    try:
        document = json.loads(row["document_json"] or "{}")
    except Exception:
        document = {}
    if not isinstance(document, dict):
        document = {}
    plan = trip.get("plan") if isinstance(trip.get("plan"), dict) else {}
    legacy_days = plan.get("daily_itinerary") if isinstance(plan.get("daily_itinerary"), list) else None
    legacy_waypoints = plan.get("waypoints") if isinstance(plan.get("waypoints"), list) else None
    document.update({"schema_version": 2, "trip_id": trip_id})
    if sync_plan:
        document.update({
            "title": str(plan.get("trip_name") or document.get("title") or "Untitled route")[:200],
            "summary": plan.get("overview") or document.get("summary"),
            "regions": plan.get("states") if isinstance(plan.get("states"), list) else document.get("regions", []),
            "days": _canonical_v2_days_from_legacy(
                legacy_days,
                document.get("days") if isinstance(document.get("days"), list) else [],
            ) if legacy_days is not None else document.get("days", []),
            "items": _canonical_v2_items_from_legacy_waypoints(
                trip_id,
                legacy_waypoints,
                document.get("items") if isinstance(document.get("items"), list) else [],
                now,
            ) if legacy_waypoints is not None else document.get("items", []),
        })
    if replace_route_geometry:
        document["route"] = route_geometry if isinstance(route_geometry, dict) else {}
    legacy = document.get("legacy_v1") if isinstance(document.get("legacy_v1"), dict) else {}
    legacy.update({"request": request, "trip": trip})
    if replace_route_geometry:
        legacy["route_geometry"] = route_geometry if isinstance(route_geometry, dict) else None
    if replace_builder_state:
        legacy["builder_state"] = builder_state if isinstance(builder_state, dict) else None
    document["legacy_v1"] = legacy
    new_revision = max(
        int(row["revision"] or 1) + 1,
        int(target_revision or 0),
    )
    db.execute(
        """UPDATE trip_documents_v2
           SET revision=?,document_json=?,updated_at=?
           WHERE user_id=? AND id=? AND status!='deleted'""",
        (new_revision, json.dumps(document, separators=(",", ":")), now, user_id, trip_id),
    )
    return new_revision


def save_trip(
    trip_id: str,
    request: str,
    plan: dict,
    user_id: int | None = None,
    route_geometry: dict | None | object = _ROUTE_GEOMETRY_UNSET,
    builder_state: dict | None | object = _BUILDER_STATE_UNSET,
    audio_guide: dict | None | object = _AUDIO_GUIDE_UNSET,
    expected_version: int | None = None,
) -> int | None:
    stored_plan = dict(plan)
    stored_plan.pop("route_geometry", None)
    stored_plan.pop("builder_state", None)
    stored_plan.pop("audio_guide", None)
    stored_plan_json = json.dumps(stored_plan)
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        now = int(time.time())
        v2 = None
        if user_id is not None:
            v2 = db.execute(
                """SELECT status,revision FROM trip_documents_v2
                   WHERE user_id=? AND id=?""",
                (user_id, trip_id),
            ).fetchone()
            if v2 and v2["status"] == "deleted":
                raise RevisionConflictError(int(v2["revision"] or 1))
        existing = db.execute("SELECT user_id,version FROM trips WHERE id=?", (trip_id,)).fetchone()
        if existing and existing["user_id"] != user_id:
            raise PermissionError("Not authorized")
        legacy_revision = int(existing["version"] or 1) if existing else 0
        v2_revision = int(v2["revision"] or 1) if v2 else 0
        current_revision = max(legacy_revision, v2_revision)
        if expected_version is not None and current_revision != int(expected_version):
            raise RevisionConflictError(current_revision)
        next_revision = current_revision + 1
        if existing:
            replace_route_geometry = route_geometry is not _ROUTE_GEOMETRY_UNSET
            replace_builder_state = builder_state is not _BUILDER_STATE_UNSET
            replace_audio_guide = audio_guide is not _AUDIO_GUIDE_UNSET
            cursor = db.execute(
                """UPDATE trips SET request=?,plan=?,
                          route_geometry=CASE WHEN ? THEN ? ELSE route_geometry END,
                          builder_state=CASE WHEN ? THEN ? ELSE builder_state END,
                          audio_guide=CASE WHEN ? THEN ? ELSE audio_guide END,
                          updated_at=?,version=?
                   WHERE id=? AND user_id IS ? AND COALESCE(version,1)=?""",
                (
                    request,
                    stored_plan_json,
                    replace_route_geometry,
                    json.dumps(route_geometry) if replace_route_geometry and route_geometry is not None else None,
                    replace_builder_state,
                    json.dumps(builder_state) if replace_builder_state and builder_state is not None else None,
                    replace_audio_guide,
                    json.dumps(audio_guide) if replace_audio_guide and audio_guide is not None else None,
                    now,
                    next_revision,
                    trip_id,
                    user_id,
                    legacy_revision,
                ),
            )
            if cursor.rowcount != 1:
                raise RevisionConflictError(current_revision)
        else:
            db.execute(
                """INSERT INTO trips
                   (id,user_id,created_at,updated_at,request,plan,route_geometry,builder_state,audio_guide,version)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    trip_id,
                    user_id,
                    now,
                    now,
                    request,
                    stored_plan_json,
                    json.dumps(route_geometry)
                    if route_geometry is not _ROUTE_GEOMETRY_UNSET and route_geometry is not None
                    else None,
                    json.dumps(builder_state)
                    if builder_state is not _BUILDER_STATE_UNSET and builder_state is not None
                    else None,
                    json.dumps(audio_guide)
                    if audio_guide is not _AUDIO_GUIDE_UNSET and audio_guide is not None
                    else None,
                    next_revision,
                ),
            )
        _sync_v2_trip_from_legacy_write(
            db,
            user_id,
            trip_id,
            stored_plan,
            request,
            route_geometry,
            builder_state,
            route_geometry is not _ROUTE_GEOMETRY_UNSET,
            builder_state is not _BUILDER_STATE_UNSET,
            now,
            target_revision=next_revision,
        )
        db.commit()
        return next_revision
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

def _trip_from_row(row: sqlite3.Row | dict) -> dict:
    if not row:
        raise ValueError("Trip row is required")
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


def get_trip(trip_id: str) -> dict | None:
    db = _conn()
    row = db.execute(
        """SELECT t.user_id,t.created_at,t.updated_at,t.plan,t.audio_guide,
                  t.route_geometry,t.builder_state,t.source,
                  MAX(COALESCE(t.version,1),COALESCE(v2.revision,0)) AS version
           FROM trips t
           LEFT JOIN trip_documents_v2 v2
             ON v2.user_id=t.user_id AND v2.id=t.id AND v2.status!='deleted'
           WHERE t.id=?""",
        (trip_id,),
    ).fetchone()
    db.close()
    return _trip_from_row(row) if row else None

def save_account_trip(
    trip_id: str,
    trip: dict,
    user_id: int,
    request: str = "",
    route_geometry: dict | None | object = _ACCOUNT_TRIP_FIELD_UNSET,
    builder_state: dict | None | object = _ACCOUNT_TRIP_FIELD_UNSET,
    source: str = "web",
    expected_version: int | None = None,
) -> dict:
    stored_trip = dict(trip)
    embedded_route_present = "route_geometry" in stored_trip
    embedded_builder_present = "builder_state" in stored_trip
    embedded_audio_present = "audio_guide" in stored_trip
    embedded_route_geometry = stored_trip.pop("route_geometry", None)
    embedded_builder_state = stored_trip.pop("builder_state", None)
    embedded_audio_guide = stored_trip.pop("audio_guide", None)
    if route_geometry is _ACCOUNT_TRIP_FIELD_UNSET and embedded_route_present:
        route_geometry = embedded_route_geometry
    if builder_state is _ACCOUNT_TRIP_FIELD_UNSET and embedded_builder_present:
        builder_state = embedded_builder_state
    replace_route_geometry = route_geometry is not _ACCOUNT_TRIP_FIELD_UNSET
    replace_builder_state = builder_state is not _ACCOUNT_TRIP_FIELD_UNSET
    replace_audio_guide = embedded_audio_present or replace_route_geometry
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        now = int(time.time())
        v2 = db.execute(
            """SELECT status,revision FROM trip_documents_v2
               WHERE user_id=? AND id=?""",
            (user_id, trip_id),
        ).fetchone()
        if v2 and v2["status"] == "deleted":
            raise RevisionConflictError(int(v2["revision"] or 1))
        existing = db.execute(
            "SELECT user_id,version FROM trips WHERE id=?", (trip_id,),
        ).fetchone()
        if existing and existing["user_id"] != user_id:
            raise PermissionError("Not authorized")
        legacy_revision = int(existing["version"] or 1) if existing else 0
        v2_revision = int(v2["revision"] or 1) if v2 else 0
        current_revision = max(legacy_revision, v2_revision)
        if expected_version is not None and current_revision != int(expected_version):
            raise RevisionConflictError(current_revision)
        next_revision = current_revision + 1
        stored_trip["trip_id"] = trip_id
        stored_trip_json = json.dumps(stored_trip)
        if existing:
            params = (
                request, stored_trip_json,
                replace_route_geometry,
                json.dumps(route_geometry) if replace_route_geometry and route_geometry is not None else None,
                replace_builder_state,
                json.dumps(builder_state) if replace_builder_state and builder_state is not None else None,
                replace_audio_guide,
                json.dumps(embedded_audio_guide) if embedded_audio_present and embedded_audio_guide is not None else None,
                source, now, next_revision, trip_id, user_id, legacy_revision,
            )
            cursor = db.execute(
                """UPDATE trips SET request=?,plan=?,
                          route_geometry=CASE WHEN ? THEN ? ELSE route_geometry END,
                          builder_state=CASE WHEN ? THEN ? ELSE builder_state END,
                          audio_guide=CASE WHEN ? THEN ? ELSE audio_guide END,
                          source=?,
                          updated_at=?,version=?
                   WHERE id=? AND user_id=? AND COALESCE(version,1)=?""",
                params,
            )
            if cursor.rowcount != 1:
                raise RevisionConflictError(current_revision)
        else:
            db.execute(
                """INSERT INTO trips
                   (id,user_id,created_at,updated_at,request,plan,route_geometry,
                    builder_state,audio_guide,source,version)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    trip_id, user_id, now, now, request, stored_trip_json,
                    json.dumps(route_geometry) if replace_route_geometry and route_geometry is not None else None,
                    json.dumps(builder_state) if replace_builder_state and builder_state is not None else None,
                    json.dumps(embedded_audio_guide) if embedded_audio_present and embedded_audio_guide is not None else None,
                    source,
                    next_revision,
                ),
            )
        synced_v2_revision = _sync_v2_trip_from_legacy_write(
            db,
            user_id,
            trip_id,
            stored_trip,
            request,
            route_geometry,
            builder_state,
            replace_route_geometry,
            replace_builder_state,
            now,
            target_revision=next_revision,
        )
        saved_row = db.execute(
            """SELECT user_id,created_at,updated_at,plan,audio_guide,route_geometry,
                      builder_state,source,version
               FROM trips WHERE id=? AND user_id=?""",
            (trip_id, user_id),
        ).fetchone()
        if not saved_row:
            raise RuntimeError("Trip save did not produce a stored row")
        saved = _trip_from_row(saved_row)
        if synced_v2_revision is not None:
            saved["v2_revision"] = synced_v2_revision
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return saved

def list_user_trips(user_id: int, limit: int = 25) -> list[dict]:
    db = _conn()
    rows = db.execute(
        """SELECT t.id,t.created_at,COALESCE(t.updated_at,t.created_at) AS updated_at,
                  t.request,t.plan,t.source,
                  MAX(COALESCE(t.version,1),COALESCE(v2.revision,0)) AS version
           FROM trips t
           LEFT JOIN trip_documents_v2 v2
             ON v2.user_id=t.user_id AND v2.id=t.id AND v2.status!='deleted'
           WHERE t.user_id=?
           ORDER BY COALESCE(t.updated_at,t.created_at) DESC
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
    try:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT user_id,plan,request,version FROM trips WHERE id=?", (trip_id,),
        ).fetchone()
        v2 = db.execute(
            """SELECT status,revision,document_json FROM trip_documents_v2
               WHERE id=? AND user_id=?""",
            (trip_id, user_id),
        ).fetchone()
        if row and row["user_id"] != user_id:
            raise PermissionError("Not authorized")
        if v2 and v2["status"] == "deleted":
            raise RevisionConflictError(int(v2["revision"] or 1))
        if not row and not v2:
            db.rollback()
            db.close()
            return None
        now = int(time.time())
        current_revision = max(
            int(row["version"] or 1) if row else 0,
            int(v2["revision"] or 1) if v2 else 0,
        )
        next_revision = current_revision + 1
        if row:
            db.execute(
                """UPDATE trips SET route_geometry=?,updated_at=?,version=?
                   WHERE id=? AND user_id=?""",
                (json.dumps(route_geometry), now, next_revision, trip_id, user_id),
            )
            trip = json.loads(row["plan"] or "{}")
            request = row["request"] or ""
        else:
            document = json.loads(v2["document_json"] or "{}") if v2 else {}
            legacy = document.get("legacy_v1") if isinstance(document.get("legacy_v1"), dict) else {}
            trip = legacy.get("trip") if isinstance(legacy.get("trip"), dict) else {
                "trip_id": trip_id,
                "plan": {
                    "trip_name": document.get("title") or "Untitled route",
                    "overview": document.get("summary") or "",
                    "states": document.get("regions") or [],
                    "daily_itinerary": document.get("days") or [],
                    "waypoints": document.get("items") or [],
                },
            }
            request = str(legacy.get("request") or "")
        synced_v2_revision = _sync_v2_trip_from_legacy_write(
            db, user_id, trip_id, trip, request, route_geometry,
            _BUILDER_STATE_UNSET, True, False, now,
            target_revision=next_revision, sync_plan=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        db.close()
        raise
    db.close()
    saved = get_trip(trip_id) or get_trip_document_v2(user_id, trip_id)
    if saved and synced_v2_revision is not None:
        saved["v2_revision"] = synced_v2_revision
    return saved

def save_audio_guide(trip_id: str, guide: dict, user_id: int | None = None):
    db = _conn()
    row = db.execute("SELECT user_id FROM trips WHERE id=?", (trip_id,)).fetchone()
    if not row:
        db.close()
        raise ValueError("Trip not found")
    if user_id is not None and row["user_id"] != user_id:
        db.close()
        raise PermissionError("Not authorized")
    db.execute(
        "UPDATE trips SET audio_guide=? WHERE id=? AND user_id IS ?",
        (json.dumps(guide), trip_id, row["user_id"]),
    )
    db.commit(); db.close()

def get_audio_guide(trip_id: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT audio_guide FROM trips WHERE id=?", (trip_id,)).fetchone()
    db.close()
    return json.loads(row["audio_guide"]) if row and row["audio_guide"] else None


# -- Account library and canonical trip documents --------------------------------

SAVED_ENTITY_TYPES = {"place", "camp", "trail", "activity", "water", "pack"}
SAVED_ENTITY_STATUSES = {"active", "archived", "deleted"}
TRIP_DOCUMENT_STATUSES = {"draft", "active", "completed", "archived", "deleted"}
_CANONICAL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$")
_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$")


class RevisionConflictError(ValueError):
    def __init__(self, current_revision: int):
        self.current_revision = int(current_revision)
        super().__init__(f"Revision conflict; current revision is {self.current_revision}")


class IdempotencyConflictError(ValueError):
    pass


def _validate_canonical_id(value: str, label: str = "canonical id") -> str:
    clean = str(value or "").strip()
    if not _CANONICAL_ID_RE.fullmatch(clean):
        raise ValueError(f"Invalid {label}")
    return clean


def _json_object(value: dict, label: str, max_bytes: int) -> tuple[dict, str]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    try:
        encoded = json.dumps(value, separators=(",", ":"), sort_keys=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must contain valid JSON") from exc
    if len(encoded.encode("utf-8")) > max_bytes:
        raise ValueError(f"{label} is too large")
    return json.loads(encoded), encoded


def _encode_account_cursor(updated_at: int, item_id: str) -> str:
    raw = json.dumps({"t": int(updated_at), "id": item_id}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_account_cursor(cursor: str | None) -> tuple[int, str] | None:
    if not cursor:
        return None
    try:
        clean = str(cursor).strip()
        raw = base64.urlsafe_b64decode(clean + "=" * (-len(clean) % 4))
        payload = json.loads(raw.decode("utf-8"))
        stamp = int(payload["t"])
        item_id = str(payload["id"])
        if stamp < 0 or not item_id or set(payload) != {"t", "id"}:
            raise ValueError
        return stamp, item_id
    except Exception as exc:
        raise ValueError("Invalid cursor") from exc


def _saved_entity_from_row(row: sqlite3.Row | dict) -> dict:
    item = dict(row)
    try:
        data = json.loads(item.pop("data_json"))
    except Exception:
        data = {}
    item["data"] = data if isinstance(data, dict) else {}
    return item


def get_saved_entity(user_id: int, canonical_id: str, include_deleted: bool = False) -> dict | None:
    canonical_id = _validate_canonical_id(canonical_id)
    db = _conn()
    row = db.execute(
        "SELECT * FROM saved_entities WHERE user_id=? AND canonical_id=?",
        (user_id, canonical_id),
    ).fetchone()
    db.close()
    if not row or (row["status"] == "deleted" and not include_deleted):
        return None
    return _saved_entity_from_row(row)


def upsert_saved_entity(
    user_id: int,
    canonical_id: str,
    entity_type: str,
    title: str,
    data: dict,
    expected_revision: int = 0,
    status: str = "active",
    idempotency_key: str | None = None,
    mutation_kind: str = "upsert",
    request_hash_payload: dict | None = None,
) -> dict:
    canonical_id = _validate_canonical_id(canonical_id)
    entity_type = str(entity_type or "").strip().lower()
    status = str(status or "").strip().lower()
    title = re.sub(r"\s+", " ", str(title or "")).strip()
    if entity_type not in SAVED_ENTITY_TYPES:
        raise ValueError("Invalid saved entity type")
    if status not in SAVED_ENTITY_STATUSES:
        raise ValueError("Invalid saved entity status")
    if not title or len(title) > 200:
        raise ValueError("Title must be between 1 and 200 characters")
    if not isinstance(expected_revision, int) or expected_revision < 0:
        raise ValueError("Expected revision must be a non-negative integer")
    normalized_data, data_json = _json_object(data, "Saved entity data", 512 * 1024)
    clean_key = str(idempotency_key or "").strip() or None
    if clean_key and not _IDEMPOTENCY_KEY_RE.fullmatch(clean_key):
        raise ValueError("Invalid Idempotency-Key")
    mutation_kind = str(mutation_kind or "upsert").strip().lower()
    hash_payload = request_hash_payload or {
        "canonical_id": canonical_id,
        "entity_type": entity_type,
        "title": title,
        "data": normalized_data,
        "expected_revision": expected_revision,
        "status": status,
    }
    request_hash = hashlib.sha256(json.dumps({
        "mutation_kind": mutation_kind,
        "payload": hash_payload,
    }, separators=(",", ":"), sort_keys=True).encode("utf-8")).hexdigest()

    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        if clean_key:
            replay = db.execute(
                """SELECT request_hash,response_json FROM saved_entity_mutations
                   WHERE user_id=? AND idempotency_key=?""",
                (user_id, clean_key),
            ).fetchone()
            if replay:
                if replay["request_hash"] != request_hash:
                    raise IdempotencyConflictError(
                        "Idempotency-Key was already used for a different request"
                    )
                result = json.loads(replay["response_json"])
                db.commit()
                return result
        row = db.execute(
            "SELECT revision, created_at FROM saved_entities WHERE user_id=? AND canonical_id=?",
            (user_id, canonical_id),
        ).fetchone()
        current_revision = int(row["revision"] or 1) if row else 0
        if expected_revision != current_revision:
            raise RevisionConflictError(current_revision)
        now = int(time.time())
        revision = current_revision + 1
        created_at = int(row["created_at"]) if row else now
        archived_at = now if status == "archived" else None
        deleted_at = now if status == "deleted" else None
        db.execute(
            """INSERT INTO saved_entities
               (user_id,canonical_id,entity_type,title,status,data_json,revision,
                created_at,updated_at,archived_at,deleted_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(user_id,canonical_id) DO UPDATE SET
                 entity_type=excluded.entity_type,
                 title=excluded.title,
                 status=excluded.status,
                 data_json=excluded.data_json,
                 revision=excluded.revision,
                 updated_at=excluded.updated_at,
                 archived_at=excluded.archived_at,
                 deleted_at=excluded.deleted_at""",
            (
                user_id, canonical_id, entity_type, title, status, data_json, revision,
                created_at, now, archived_at, deleted_at,
            ),
        )
        saved = db.execute(
            "SELECT * FROM saved_entities WHERE user_id=? AND canonical_id=?",
            (user_id, canonical_id),
        ).fetchone()
        result = _saved_entity_from_row(saved)
        if clean_key:
            db.execute(
                """INSERT INTO saved_entity_mutations
                   (user_id,idempotency_key,canonical_id,mutation_kind,request_hash,response_json,created_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (
                    user_id, clean_key, canonical_id, mutation_kind, request_hash,
                    json.dumps(result, separators=(",", ":"), sort_keys=True), now,
                ),
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return result


def set_saved_entity_status(
    user_id: int,
    canonical_id: str,
    status: str,
    expected_revision: int,
    idempotency_key: str | None = None,
    mutation_kind: str | None = None,
) -> dict | None:
    existing = get_saved_entity(user_id, canonical_id, include_deleted=True)
    if not existing:
        return None
    return upsert_saved_entity(
        user_id,
        canonical_id,
        existing["entity_type"],
        existing["title"],
        existing["data"],
        expected_revision=expected_revision,
        status=status,
        idempotency_key=idempotency_key,
        mutation_kind=mutation_kind or status,
        request_hash_payload={
            "canonical_id": canonical_id,
            "status": status,
            "expected_revision": expected_revision,
        },
    )


def list_saved_entities(
    user_id: int,
    limit: int = 50,
    cursor: str | None = None,
    entity_type: str | None = None,
    include_archived: bool = False,
    include_deleted: bool = False,
) -> dict:
    if not isinstance(limit, int) or limit < 1 or limit > 100:
        raise ValueError("Limit must be between 1 and 100")
    entity_type = str(entity_type or "").strip().lower() or None
    if entity_type and entity_type not in SAVED_ENTITY_TYPES:
        raise ValueError("Invalid saved entity type")
    decoded_cursor = _decode_account_cursor(cursor)
    clauses = ["user_id=?"]
    params: list = [user_id]
    if not include_deleted:
        clauses.append("status!='deleted'")
    if not include_archived:
        clauses.append("status!='archived'")
    if entity_type:
        clauses.append("entity_type=?")
        params.append(entity_type)
    if decoded_cursor:
        clauses.append("(updated_at<? OR (updated_at=? AND canonical_id<?))")
        params.extend([decoded_cursor[0], decoded_cursor[0], decoded_cursor[1]])
    params.append(limit + 1)
    db = _conn()
    rows = db.execute(
        f"""SELECT * FROM saved_entities
            WHERE {' AND '.join(clauses)}
            ORDER BY updated_at DESC, canonical_id DESC
            LIMIT ?""",
        params,
    ).fetchall()
    db.close()
    has_more = len(rows) > limit
    page = rows[:limit]
    items = [_saved_entity_from_row(row) for row in page]
    next_cursor = _encode_account_cursor(page[-1]["updated_at"], page[-1]["canonical_id"]) if has_more else None
    return {"items": items, "next_cursor": next_cursor}


def _legacy_trip_document(row: sqlite3.Row | dict) -> dict:
    raw = dict(row)
    try:
        saved_trip = json.loads(raw.get("document_json") or raw.get("plan") or "{}")
    except Exception:
        saved_trip = {}
    saved_trip = saved_trip if isinstance(saved_trip, dict) else {}
    plan = saved_trip.get("plan") if isinstance(saved_trip.get("plan"), dict) else saved_trip
    title = str(plan.get("trip_name") or saved_trip.get("trip_name") or "Untitled route").strip()[:200]

    def _legacy_json(name: str, fallback):
        value = raw.get(name)
        if value in (None, ""):
            return fallback
        if isinstance(value, (dict, list)):
            return value
        try:
            return json.loads(value)
        except Exception:
            return fallback

    starts_on = str(
        saved_trip.get("starts_on") or saved_trip.get("startsOn")
        or saved_trip.get("start_date") or ""
    ).strip() or None
    ends_on = str(
        saved_trip.get("ends_on") or saved_trip.get("endsOn")
        or saved_trip.get("end_date") or ""
    ).strip() or None
    route = _legacy_json("route_geometry", {})

    return {
        "schema_version": 2,
        "trip_id": raw["id"],
        "revision": int(raw.get("revision") or raw.get("version") or 1),
        "status": "draft",
        "title": title or "Untitled route",
        "summary": str(plan.get("overview") or saved_trip.get("summary") or "").strip() or None,
        "regions": plan.get("states") if isinstance(plan.get("states"), list) else [],
        "starts_on": starts_on,
        "ends_on": ends_on,
        "dates": {"starts_on": starts_on, "ends_on": ends_on},
        "rig_snapshot": {},
        "route": route,
        "days": plan.get("daily_itinerary") if isinstance(plan.get("daily_itinerary"), list) else [],
        "items": plan.get("waypoints") if isinstance(plan.get("waypoints"), list) else [],
        "notes": [],
        "readiness": {},
        "bookings": [],
        "alerts": [],
        "offline": {},
        "visibility": "private",
        "source": raw.get("source") or "legacy_v1",
        "created_at": int(raw.get("created_at") or 0),
        "updated_at": int(raw.get("updated_at") or raw.get("created_at") or 0),
        "archived_at": None,
        "deleted_at": None,
        "legacy_v1": {
            "request": raw.get("request") or "",
            "trip": saved_trip,
            "route_geometry": route or None,
            "builder_state": _legacy_json("builder_state", None),
        },
    }


def _trip_document_from_row(row: sqlite3.Row | dict) -> dict:
    raw = dict(row)
    if raw.get("origin") == "v1" or ("document_json" not in raw and "plan" in raw):
        return _legacy_trip_document(raw)
    try:
        document = json.loads(raw.get("document_json") or "{}")
    except Exception:
        document = {}
    document = document if isinstance(document, dict) else {}
    document.update({
        "schema_version": 2,
        "trip_id": raw["id"],
        "revision": int(raw.get("revision") or 1),
        "status": raw.get("status") or "draft",
        "created_at": int(raw.get("created_at") or 0),
        "updated_at": int(raw.get("updated_at") or raw.get("created_at") or 0),
        "archived_at": raw.get("archived_at"),
        "deleted_at": raw.get("deleted_at"),
    })
    return document


def get_trip_document_v2(user_id: int, trip_id: str, include_deleted: bool = False) -> dict | None:
    trip_id = _validate_canonical_id(trip_id, "trip id")
    db = _conn()
    row = db.execute(
        "SELECT * FROM trip_documents_v2 WHERE user_id=? AND id=?", (user_id, trip_id),
    ).fetchone()
    if row:
        db.close()
        if row["status"] == "deleted" and not include_deleted:
            return None
        return _trip_document_from_row(row)
    legacy = db.execute(
        """SELECT id,user_id,created_at,COALESCE(updated_at,created_at) AS updated_at,
                  request,plan,route_geometry,builder_state,source,version AS revision
           FROM trips WHERE id=? AND user_id=?""",
        (trip_id, user_id),
    ).fetchone()
    db.close()
    if not legacy:
        return None
    return _legacy_trip_document(legacy)


def _normalize_trip_document(document: dict, trip_id: str) -> tuple[dict, str]:
    normalized, _ = _json_object(document, "Trip document", 2 * 1024 * 1024)
    if int(normalized.get("schema_version") or 0) != 2:
        raise ValueError("Trip document schema_version must be 2")
    supplied_id = str(normalized.get("trip_id") or trip_id).strip()
    if supplied_id != trip_id:
        raise ValueError("Trip document id does not match the route")
    status = str(normalized.get("status") or "draft").strip().lower()
    if status not in TRIP_DOCUMENT_STATUSES:
        raise ValueError("Invalid trip document status")
    title = re.sub(r"\s+", " ", str(normalized.get("title") or "")).strip()
    if not title or len(title) > 200:
        raise ValueError("Trip title must be between 1 and 200 characters")
    visibility = str(normalized.get("visibility") or "private").strip().lower()
    if visibility not in {"private", "shared", "public"}:
        raise ValueError("Invalid trip visibility")
    normalized["trip_id"] = trip_id
    normalized["status"] = status
    normalized["title"] = title
    normalized["visibility"] = visibility
    for server_field in ("revision", "created_at", "updated_at", "archived_at", "deleted_at"):
        normalized.pop(server_field, None)
    normalized, document_json = _json_object(normalized, "Trip document", 2 * 1024 * 1024)
    return normalized, document_json


def upsert_trip_document_v2(
    user_id: int,
    trip_id: str,
    document: dict,
    expected_revision: int,
    idempotency_key: str,
) -> dict:
    trip_id = _validate_canonical_id(trip_id, "trip id")
    idempotency_key = str(idempotency_key or "").strip()
    if not _IDEMPOTENCY_KEY_RE.fullmatch(idempotency_key):
        raise ValueError("Invalid Idempotency-Key")
    if not isinstance(expected_revision, int) or expected_revision < 0:
        raise ValueError("Expected revision must be a non-negative integer")
    if isinstance(document, dict) and "experience_ref" in document:
        raise ValueError("Trip experience_ref is server-owned")
    normalized, document_json = _normalize_trip_document(document, trip_id)
    request_hash = hashlib.sha256(json.dumps({
        "trip_id": trip_id,
        "expected_revision": expected_revision,
        "document": normalized,
    }, separators=(",", ":"), sort_keys=True).encode("utf-8")).hexdigest()

    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        replay = db.execute(
            "SELECT request_hash,response_json FROM trip_document_mutations WHERE user_id=? AND idempotency_key=?",
            (user_id, idempotency_key),
        ).fetchone()
        if replay:
            if replay["request_hash"] != request_hash:
                raise ValueError("Idempotency-Key was already used for a different request")
            result = json.loads(replay["response_json"])
            if result.get("status") == "deleted":
                db.execute("DELETE FROM trips WHERE id=? AND user_id=?", (trip_id, user_id))
            elif int(result.get("revision") or 0) > 0:
                db.execute(
                    """UPDATE trips
                       SET version=MAX(COALESCE(version,1),?)
                       WHERE id=? AND user_id=?""",
                    (int(result["revision"]), trip_id, user_id),
                )
            db.commit()
            return result

        current = db.execute(
            "SELECT * FROM trip_documents_v2 WHERE user_id=? AND id=?", (user_id, trip_id),
        ).fetchone()
        if current:
            existing_document = _decode_pack_json(current["document_json"], {})
            existing_experience_ref = existing_document.get("experience_ref")
            if isinstance(existing_experience_ref, dict):
                normalized["experience_ref"] = existing_experience_ref
                normalized, document_json = _json_object(
                    normalized, "Trip document", 2 * 1024 * 1024,
                )
        legacy = db.execute(
            """SELECT id,user_id,created_at,COALESCE(updated_at,created_at) AS updated_at,
                      request,plan,route_geometry,builder_state,source,version AS revision
               FROM trips WHERE id=? AND user_id=?""",
            (trip_id, user_id),
        ).fetchone()
        current_revision = max(
            int(current["revision"] or 1) if current else 0,
            int(legacy["revision"] or 1) if legacy else 0,
        )
        if expected_revision != current_revision:
            raise RevisionConflictError(current_revision)

        now = int(time.time())
        revision = current_revision + 1
        created_at = int(current["created_at"]) if current else int(legacy["created_at"]) if legacy else now
        status = normalized["status"]
        archived_at = now if status == "archived" else None
        deleted_at = now if status == "deleted" else None
        db.execute(
            """INSERT INTO trip_documents_v2
               (id,user_id,status,revision,document_json,created_at,updated_at,archived_at,deleted_at)
               VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(user_id,id) DO UPDATE SET
                 status=excluded.status,
                 revision=excluded.revision,
                 document_json=excluded.document_json,
                 updated_at=excluded.updated_at,
                 archived_at=excluded.archived_at,
                 deleted_at=excluded.deleted_at""",
            (trip_id, user_id, status, revision, document_json, created_at, now, archived_at, deleted_at),
        )
        if status == "deleted":
            db.execute("DELETE FROM trips WHERE id=? AND user_id=?", (trip_id, user_id))
        elif legacy:
            db.execute(
                """UPDATE trips SET version=?,updated_at=?
                   WHERE id=? AND user_id=?""",
                (revision, now, trip_id, user_id),
            )
        saved = db.execute(
            "SELECT * FROM trip_documents_v2 WHERE user_id=? AND id=?", (user_id, trip_id),
        ).fetchone()
        result = _trip_document_from_row(saved)
        db.execute(
            """INSERT INTO trip_document_mutations
               (user_id,idempotency_key,trip_id,request_hash,response_json,created_at)
               VALUES (?,?,?,?,?,?)""",
            (user_id, idempotency_key, trip_id, request_hash, json.dumps(result, separators=(",", ":")), now),
        )
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def list_trip_documents_v2(
    user_id: int,
    limit: int = 50,
    cursor: str | None = None,
    status: str | None = None,
    include_archived: bool = False,
    include_deleted: bool = False,
) -> dict:
    if not isinstance(limit, int) or limit < 1 or limit > 100:
        raise ValueError("Limit must be between 1 and 100")
    status = str(status or "").strip().lower() or None
    if status and status not in TRIP_DOCUMENT_STATUSES:
        raise ValueError("Invalid trip document status")
    if status == "deleted" and not include_deleted:
        raise ValueError("include_deleted is required when filtering deleted trips")
    decoded_cursor = _decode_account_cursor(cursor)
    clauses = ["user_id=?"]
    params: list = [user_id]
    if status:
        clauses.append("status=?")
        params.append(status)
    else:
        if not include_deleted:
            clauses.append("status!='deleted'")
        if not include_archived:
            clauses.append("status!='archived'")
    if decoded_cursor:
        clauses.append("(updated_at<? OR (updated_at=? AND id<?))")
        params.extend([decoded_cursor[0], decoded_cursor[0], decoded_cursor[1]])
    params.append(limit + 1)
    db = _conn()
    rows = db.execute(
        f"""WITH account_trips AS (
                SELECT id,user_id,status,revision,document_json,created_at,updated_at,
                       archived_at,deleted_at,NULL AS request,NULL AS plan,
                       NULL AS route_geometry,NULL AS builder_state,NULL AS source,
                       'v2' AS origin
                FROM trip_documents_v2
                WHERE user_id=?
                UNION ALL
                SELECT t.id,t.user_id,'draft' AS status,COALESCE(t.version,1) AS revision,
                       NULL AS document_json,t.created_at,COALESCE(t.updated_at,t.created_at) AS updated_at,
                       NULL AS archived_at,NULL AS deleted_at,t.request,t.plan,
                       t.route_geometry,t.builder_state,t.source,'v1' AS origin
                FROM trips t
                WHERE t.user_id=?
                  AND NOT EXISTS (
                    SELECT 1 FROM trip_documents_v2 v2
                    WHERE v2.user_id=t.user_id AND v2.id=t.id
                  )
            )
            SELECT * FROM account_trips
            WHERE {' AND '.join(clauses)}
            ORDER BY updated_at DESC,id DESC
            LIMIT ?""",
        [user_id, user_id, *params],
    ).fetchall()
    db.close()
    has_more = len(rows) > limit
    page = rows[:limit]
    items = [_trip_document_from_row(row) for row in page]
    next_cursor = _encode_account_cursor(page[-1]["updated_at"], page[-1]["id"]) if has_more else None
    return {"items": items, "next_cursor": next_cursor}

# ── Cache ─────────────────────────────────────────────────────────────────────

# -- Communication preferences and reviewed community publications -------------

COMMUNICATION_CHANNELS = {
    "weekly_digest": "weekly_digest_opted_in_at",
    "trip_window_briefs": "trip_briefs_opted_in_at",
    "deal_alerts": "deal_alerts_opted_in_at",
}
COMMUNITY_PUBLICATION_TYPES = {"trip_recap", "place_update", "correction"}
COMMUNITY_PUBLICATION_STATUSES = {"pending_review", "approved", "rejected", "retracted"}
TRIP_BRIEF_LEAD_DAYS = 7
TRIP_BRIEF_MAX_DURATION_DAYS = 90
_LOCALE_RE = re.compile(r"^[a-z]{2}(?:-[A-Z]{2})?$")
_DECIMAL_PAIR_RE = re.compile(r"(?<!\d)([-+]?\d{1,2}\.\d{3,})\s*[,;/]\s*([-+]?\d{1,3}\.\d{3,})(?!\d)")
_WHITESPACE_DECIMAL_PAIR_RE = re.compile(
    r"(?<![\d.])([-+]?\d{1,2}\.\d{4,})[ \t]+([-+]?\d{1,3}\.\d{4,})(?!\d)"
)
_LABELED_COORDINATE_RE = re.compile(
    r"\b(?:lat(?:itude)?)\s*[:=]?\s*[-+]?\d{1,2}(?:\.\d+)?\s*[,;/ ]+"
    r"(?:lon(?:gitude)?|lng)\s*[:=]?\s*[-+]?\d{1,3}(?:\.\d+)?\b",
    re.IGNORECASE,
)
_DMS_COORDINATE_PAIR_RE = re.compile(
    r"(?<!\d)\d{1,2}\s*[°º]\s*\d{1,2}\s*['′’]?\s*\d{1,2}(?:\.\d+)?\s*[\"″”]?\s*[NS]"
    r"\s*[,;/ ]+\s*\d{1,3}\s*[°º]\s*\d{1,2}\s*['′’]?\s*\d{1,2}(?:\.\d+)?\s*[\"″”]?\s*[EW]\b",
    re.IGNORECASE,
)
_DMS_COORDINATE_PAIR_REVERSED = re.compile(
    r"(?<!\d)\d{1,3}\s*[°º]\s*\d{1,2}\s*['′’]?\s*\d{1,2}(?:\.\d+)?\s*[\"″”]?\s*[EW]"
    r"\s*[,;/ ]+\s*\d{1,2}\s*[°º]\s*\d{1,2}\s*['′’]?\s*\d{1,2}(?:\.\d+)?\s*[\"″”]?\s*[NS]\b",
    re.IGNORECASE,
)
_GEO_URI_RE = re.compile(
    r"\bgeo:\s*([-+]?\d{1,2}(?:\.\d+)?)\s*,\s*([-+]?\d{1,3}(?:\.\d+)?)",
    re.IGNORECASE,
)
_MAP_LINK_RE = re.compile(
    r"https?://(?:[^/\s]*\.)?(?:google\.[^/\s]+/maps|maps\.google\.[^/\s]+|maps\.apple\.com|openstreetmap\.org)(?:/|\?)[^\s<>{}]*",
    re.IGNORECASE,
)
_MAP_QUERY_PAIR_RE = re.compile(
    r"(?:@|[?&#](?:q|query|ll|center)=|[?&#]mlat=|#map=\d{1,2}/)"
    r"\s*([-+]?\d{1,2}(?:\.\d+)?)\s*[,/&]"
    r"(?:mlon=)?\s*([-+]?\d{1,3}(?:\.\d+)?)",
    re.IGNORECASE,
)
_PLUS_CODE_RE = re.compile(
    r"(?<![A-Z0-9])[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}(?![A-Z0-9])",
    re.IGNORECASE,
)
_WHAT3WORDS_EXPLICIT_RE = re.compile(
    r"(?:/{3}|what3words(?:\.com/|\s*[:=]\s*))"
    r"[a-z]{2,30}\.[a-z]{2,30}\.[a-z]{2,30}\b",
    re.IGNORECASE,
)
_WHAT3WORDS_BARE_RE = re.compile(
    r"(?<![/@\w])([a-z]{3,30}\.[a-z]{3,30}\.([a-z]{3,30}))(?![/\w])"
)


class PublicationSourceNoteNotFoundError(ValueError):
    pass


class PublicationTargetRequiredError(ValueError):
    pass


class PublicationTargetNotFoundError(ValueError):
    pass


class PublicationAlreadySubmittedError(ValueError):
    def __init__(self, publication_id: str):
        self.publication_id = publication_id
        super().__init__("This note already has a submission under review")


class PublicationStateConflictError(ValueError):
    def __init__(self, status: str):
        self.status = status
        super().__init__("This publication can no longer be changed that way")


class PublicationPrivacyError(ValueError):
    pass


def _validate_preference_timezone(value: str) -> str:
    clean = str(value or "").strip()
    if not clean or len(clean) > 80:
        raise ValueError("Choose a valid timezone")
    try:
        ZoneInfo(clean)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("Choose a valid timezone") from exc
    return clean


def _validate_preference_locale(value: str) -> str:
    clean = str(value or "").strip()
    if not _LOCALE_RE.fullmatch(clean):
        raise ValueError("Locale must use a language or language-region code")
    return clean


def _communication_preferences_from_row(row: sqlite3.Row | dict | None) -> dict:
    raw = dict(row) if row else {}
    return {
        "weekly_digest": bool(raw.get("weekly_digest", 0)),
        "trip_window_briefs": bool(raw.get("trip_window_briefs", 0)),
        "deal_alerts": bool(raw.get("deal_alerts", 0)),
        "timezone": str(raw.get("timezone") or "UTC"),
        "locale": str(raw.get("locale") or "en-US"),
        "unsubscribed_all": bool(raw.get("unsubscribed_all", 0)),
        "updated_at": raw.get("updated_at"),
    }


def get_communication_preferences(user_id: int) -> dict:
    db = _conn()
    row = db.execute(
        "SELECT * FROM communication_preferences WHERE user_id=?", (user_id,),
    ).fetchone()
    db.close()
    return _communication_preferences_from_row(row)


def update_communication_preferences(user_id: int, changes: dict) -> dict:
    if not isinstance(changes, dict):
        raise ValueError("Preferences must be an object")
    allowed = {*COMMUNICATION_CHANNELS, "timezone", "locale"}
    if set(changes) - allowed:
        raise ValueError("Unsupported communication preference")
    for channel in COMMUNICATION_CHANNELS:
        if channel in changes and not isinstance(changes[channel], bool):
            raise ValueError("Communication choices must be true or false")
    timezone_name = _validate_preference_timezone(changes["timezone"]) if "timezone" in changes else None
    locale = _validate_preference_locale(changes["locale"]) if "locale" in changes else None

    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute(
            "SELECT * FROM communication_preferences WHERE user_id=?", (user_id,),
        ).fetchone()
        state = {
            "weekly_digest": int(existing["weekly_digest"]) if existing else 0,
            "trip_window_briefs": int(existing["trip_window_briefs"]) if existing else 0,
            "deal_alerts": int(existing["deal_alerts"]) if existing else 0,
            "timezone": str(existing["timezone"] or "UTC") if existing else "UTC",
            "locale": str(existing["locale"] or "en-US") if existing else "en-US",
            "unsubscribed_all": int(existing["unsubscribed_all"]) if existing else 0,
            "weekly_digest_opted_in_at": existing["weekly_digest_opted_in_at"] if existing else None,
            "trip_briefs_opted_in_at": existing["trip_briefs_opted_in_at"] if existing else None,
            "deal_alerts_opted_in_at": existing["deal_alerts_opted_in_at"] if existing else None,
            "unsubscribed_at": existing["unsubscribed_at"] if existing else None,
        }
        any_opt_in = False
        for channel, opted_at_field in COMMUNICATION_CHANNELS.items():
            if channel not in changes:
                continue
            enabled = bool(changes[channel])
            was_enabled = bool(state[channel])
            state[channel] = int(enabled)
            state[opted_at_field] = now if enabled and not was_enabled else state[opted_at_field] if enabled else None
            any_opt_in = any_opt_in or enabled
        if timezone_name is not None:
            state["timezone"] = timezone_name
        if locale is not None:
            state["locale"] = locale
        if any_opt_in:
            state["unsubscribed_all"] = 0
            state["unsubscribed_at"] = None

        db.execute(
            """INSERT INTO communication_preferences
               (user_id,weekly_digest,trip_window_briefs,deal_alerts,timezone,locale,
                unsubscribed_all,weekly_digest_opted_in_at,trip_briefs_opted_in_at,
                deal_alerts_opted_in_at,unsubscribed_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(user_id) DO UPDATE SET
                 weekly_digest=excluded.weekly_digest,
                 trip_window_briefs=excluded.trip_window_briefs,
                 deal_alerts=excluded.deal_alerts,
                 timezone=excluded.timezone,
                 locale=excluded.locale,
                 unsubscribed_all=excluded.unsubscribed_all,
                 weekly_digest_opted_in_at=excluded.weekly_digest_opted_in_at,
                 trip_briefs_opted_in_at=excluded.trip_briefs_opted_in_at,
                 deal_alerts_opted_in_at=excluded.deal_alerts_opted_in_at,
                 unsubscribed_at=excluded.unsubscribed_at,
                 updated_at=excluded.updated_at""",
            (
                user_id, state["weekly_digest"], state["trip_window_briefs"], state["deal_alerts"],
                state["timezone"], state["locale"], state["unsubscribed_all"],
                state["weekly_digest_opted_in_at"], state["trip_briefs_opted_in_at"],
                state["deal_alerts_opted_in_at"], state["unsubscribed_at"], now,
            ),
        )
        row = db.execute(
            "SELECT * FROM communication_preferences WHERE user_id=?", (user_id,),
        ).fetchone()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return _communication_preferences_from_row(row)


def unsubscribe_all_communications(user_id: int) -> dict:
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute(
            "SELECT timezone,locale FROM communication_preferences WHERE user_id=?", (user_id,),
        ).fetchone()
        timezone_name = str(existing["timezone"] or "UTC") if existing else "UTC"
        locale = str(existing["locale"] or "en-US") if existing else "en-US"
        db.execute(
            """INSERT INTO communication_preferences
               (user_id,weekly_digest,trip_window_briefs,deal_alerts,timezone,locale,
                unsubscribed_all,weekly_digest_opted_in_at,trip_briefs_opted_in_at,
                deal_alerts_opted_in_at,unsubscribed_at,updated_at)
               VALUES (?,0,0,0,?,?,1,NULL,NULL,NULL,?,?)
               ON CONFLICT(user_id) DO UPDATE SET
                 weekly_digest=0,trip_window_briefs=0,deal_alerts=0,
                 unsubscribed_all=1,weekly_digest_opted_in_at=NULL,
                 trip_briefs_opted_in_at=NULL,deal_alerts_opted_in_at=NULL,
                 unsubscribed_at=excluded.unsubscribed_at,updated_at=excluded.updated_at""",
            (user_id, timezone_name, locale, now, now),
        )
        row = db.execute(
            "SELECT * FROM communication_preferences WHERE user_id=?", (user_id,),
        ).fetchone()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return _communication_preferences_from_row(row)


def select_weekly_digest_recipients(limit: int = 500, after_user_id: int = 0) -> list[dict]:
    if not isinstance(limit, int) or limit < 1 or limit > 5000:
        raise ValueError("Limit must be between 1 and 5000")
    db = _conn()
    rows = db.execute(
        """SELECT u.id AS user_id,u.email,p.timezone,p.locale
           FROM communication_preferences p
           JOIN users u ON u.id=p.user_id
           WHERE p.weekly_digest=1 AND p.unsubscribed_all=0 AND u.id>?
           ORDER BY u.id ASC LIMIT ?""",
        (max(0, int(after_user_id or 0)), limit),
    ).fetchall()
    db.close()
    return [dict(row) for row in rows]


def _trip_brief_dates(document: dict) -> tuple[_date, _date] | None:
    dates = document.get("dates") if isinstance(document.get("dates"), dict) else {}
    starts_on = str(document.get("starts_on") or dates.get("starts_on") or "").strip()
    ends_on = str(document.get("ends_on") or dates.get("ends_on") or "").strip()
    if not starts_on or not ends_on:
        return None
    try:
        start_date = _date.fromisoformat(starts_on)
        end_date = _date.fromisoformat(ends_on)
    except ValueError:
        return None
    duration = (end_date - start_date).days
    if duration < 0 or duration > TRIP_BRIEF_MAX_DURATION_DAYS:
        return None
    return start_date, end_date


def select_trip_window_brief_recipients(
    now: int | None = None,
    limit: int = 500,
    after_user_id: int = 0,
    after_trip_id: str = "",
) -> list[dict]:
    if not isinstance(limit, int) or limit < 1 or limit > 5000:
        raise ValueError("Limit must be between 1 and 5000")
    timestamp = int(now or time.time())
    db = _conn()
    rows = db.execute(
        """SELECT u.id AS user_id,u.email,p.timezone,p.locale,
                  t.id AS trip_id,t.document_json
           FROM communication_preferences p
           JOIN users u ON u.id=p.user_id
           JOIN trip_documents_v2 t ON t.user_id=u.id
           WHERE p.trip_window_briefs=1 AND p.unsubscribed_all=0
             AND t.status NOT IN ('archived','deleted')
             AND (u.id>? OR (u.id=? AND t.id>?))
           ORDER BY u.id ASC,t.id ASC""",
        (
            max(0, int(after_user_id or 0)), max(0, int(after_user_id or 0)),
            str(after_trip_id or ""),
        ),
    ).fetchall()
    db.close()
    selected: list[dict] = []
    for row in rows:
        try:
            document = json.loads(row["document_json"] or "{}")
        except Exception:
            continue
        if not isinstance(document, dict):
            continue
        date_range = _trip_brief_dates(document)
        if not date_range:
            continue
        start_date, end_date = date_range
        try:
            local_tz = ZoneInfo(str(row["timezone"] or "UTC"))
        except (ZoneInfoNotFoundError, ValueError):
            continue
        local_date = _datetime.fromtimestamp(timestamp, tz=_timezone.utc).astimezone(local_tz).date()
        if not (start_date - _timedelta(days=TRIP_BRIEF_LEAD_DAYS) <= local_date <= end_date):
            continue
        selected.append({
            "user_id": int(row["user_id"]),
            "email": row["email"],
            "timezone": row["timezone"],
            "locale": row["locale"],
            "trip_id": row["trip_id"],
            "trip_title": str(document.get("title") or "Untitled route")[:200],
            "starts_on": start_date.isoformat(),
            "ends_on": end_date.isoformat(),
            "days_until_start": (start_date - local_date).days,
        })
        if len(selected) >= limit:
            break
    return selected


def _contains_coordinates(value: str) -> bool:
    if (
        _LABELED_COORDINATE_RE.search(value)
        or _DMS_COORDINATE_PAIR_RE.search(value)
        or _DMS_COORDINATE_PAIR_REVERSED.search(value)
        or _PLUS_CODE_RE.search(value)
        or _WHAT3WORDS_EXPLICIT_RE.search(value)
    ):
        return True
    for pattern in (_DECIMAL_PAIR_RE, _WHITESPACE_DECIMAL_PAIR_RE, _GEO_URI_RE):
        for match in pattern.finditer(value):
            try:
                lat, lng = float(match.group(1)), float(match.group(2))
            except ValueError:
                continue
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                return True
    for raw_link in _MAP_LINK_RE.findall(value):
        link = _url_unquote(raw_link)
        if _MAP_QUERY_PAIR_RE.search(link) or _DECIMAL_PAIR_RE.search(link):
            return True
    common_domain_endings = {"com", "org", "net", "app", "gov", "edu", "ca", "io", "co"}
    for match in _WHAT3WORDS_BARE_RE.finditer(value):
        if match.group(2).lower() not in common_domain_endings:
            return True
    return False


def _normalize_publication_copy(title: str, body: str) -> tuple[str, str]:
    clean_title = re.sub(r"\s+", " ", str(title or "").replace("\x00", "")).strip()
    clean_body = str(body or "").replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "").strip()
    if len(clean_title) < 3 or len(clean_title) > 160:
        raise ValueError("Title must be between 3 and 160 characters")
    if len(clean_body) < 20 or len(clean_body) > 5000:
        raise ValueError("Reviewed copy must be between 20 and 5000 characters")
    if _contains_coordinates(f"{clean_title}\n{clean_body}"):
        raise PublicationPrivacyError("Remove precise coordinates before submitting this note")
    return clean_title, clean_body


def _publication_target_exists(db: sqlite3.Connection, user_id: int, place_id: str) -> bool:
    if db.execute(
        "SELECT 1 FROM places WHERE trailhead_place_id=?", (place_id,),
    ).fetchone():
        return True
    return bool(db.execute(
        """SELECT 1 FROM saved_entities
           WHERE user_id=? AND canonical_id=? AND status!='deleted' AND entity_type!='pack'""",
        (user_id, place_id),
    ).fetchone())


def _community_publication_from_row(
    row: sqlite3.Row | dict,
    *,
    include_moderation: bool = False,
    include_user: bool = False,
) -> dict:
    raw = dict(row)
    item = {
        "id": raw["id"],
        "publication_type": raw["publication_type"],
        "title": raw["title"],
        "body": raw["body"],
        "place_id": raw.get("place_id"),
        "status": raw["status"],
        "submitted_at": int(raw["submitted_at"]),
        "updated_at": int(raw["updated_at"]),
        "moderated_at": raw.get("moderated_at"),
        "retracted_at": raw.get("retracted_at"),
    }
    if include_moderation:
        item["moderation_note"] = raw.get("moderation_note")
    if include_user:
        item["user_id"] = int(raw["user_id"])
        if "username" in raw:
            item["username"] = raw.get("username")
    return item


def submit_community_publication(
    user_id: int,
    trip_id: str,
    note_id: str,
    publication_type: str,
    title: str,
    body: str,
    place_id: str | None = None,
) -> dict:
    trip_id = _validate_canonical_id(trip_id, "trip id")
    note_id = str(note_id or "").strip()
    if not note_id or len(note_id) > 240:
        raise PublicationSourceNoteNotFoundError("Private trip note not found")
    publication_type = str(publication_type or "").strip().lower()
    if publication_type not in COMMUNITY_PUBLICATION_TYPES:
        raise ValueError("Invalid publication type")
    clean_title, clean_body = _normalize_publication_copy(title, body)
    clean_place_id = str(place_id or "").strip() or None
    if publication_type in {"place_update", "correction"}:
        if not clean_place_id:
            raise PublicationTargetRequiredError("Choose the place this update belongs to")
        clean_place_id = _validate_canonical_id(clean_place_id, "place id")
    elif clean_place_id:
        raise ValueError("Trip recaps cannot target a place")

    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        trip = db.execute(
            """SELECT document_json FROM trip_documents_v2
               WHERE id=? AND user_id=? AND status!='deleted'""",
            (trip_id, user_id),
        ).fetchone()
        if not trip:
            raise PublicationSourceNoteNotFoundError("Private trip note not found")
        try:
            document = json.loads(trip["document_json"] or "{}")
        except Exception:
            document = {}
        notes = document.get("notes") if isinstance(document, dict) else None
        source_note = next(
            (
                note for note in notes or []
                if isinstance(note, dict)
                and str(note.get("id") or "").strip() == note_id
                and str(note.get("visibility") or "private").strip().lower() == "private"
            ),
            None,
        )
        if not source_note:
            raise PublicationSourceNoteNotFoundError("Private trip note not found")
        if clean_place_id and not _publication_target_exists(db, user_id, clean_place_id):
            raise PublicationTargetNotFoundError("The selected place could not be found")
        duplicate = db.execute(
            """SELECT id FROM community_publications
               WHERE user_id=? AND trip_id=? AND note_id=? AND publication_type=?
                 AND status IN ('pending_review','approved')""",
            (user_id, trip_id, note_id, publication_type),
        ).fetchone()
        if duplicate:
            raise PublicationAlreadySubmittedError(duplicate["id"])

        publication_id = f"publication_{secrets.token_hex(16)}"
        now = int(time.time())
        fingerprint = hashlib.sha256(
            json.dumps(source_note, separators=(",", ":"), sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()
        db.execute(
            """INSERT INTO community_publications
               (id,user_id,trip_id,note_id,source_note_fingerprint,publication_type,
                title,body,place_id,status,submitted_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,'pending_review',?,?)""",
            (
                publication_id, user_id, trip_id, note_id, fingerprint, publication_type,
                clean_title, clean_body, clean_place_id, now, now,
            ),
        )
        row = db.execute(
            "SELECT * FROM community_publications WHERE id=?", (publication_id,),
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as exc:
        db.rollback()
        duplicate = db.execute(
            """SELECT id FROM community_publications
               WHERE user_id=? AND trip_id=? AND note_id=? AND publication_type=?
                 AND status IN ('pending_review','approved')""",
            (user_id, trip_id, note_id, publication_type),
        ).fetchone()
        if duplicate:
            raise PublicationAlreadySubmittedError(duplicate["id"]) from exc
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return _community_publication_from_row(row, include_moderation=True)


def list_community_publications_for_user(
    user_id: int,
    limit: int = 50,
    cursor: str | None = None,
) -> dict:
    if not isinstance(limit, int) or limit < 1 or limit > 100:
        raise ValueError("Limit must be between 1 and 100")
    decoded_cursor = _decode_account_cursor(cursor)
    clauses = ["user_id=?"]
    params: list = [user_id]
    if decoded_cursor:
        clauses.append("(submitted_at<? OR (submitted_at=? AND id<?))")
        params.extend([decoded_cursor[0], decoded_cursor[0], decoded_cursor[1]])
    params.append(limit + 1)
    db = _conn()
    rows = db.execute(
        f"""SELECT * FROM community_publications
            WHERE {' AND '.join(clauses)}
            ORDER BY submitted_at DESC,id DESC LIMIT ?""",
        params,
    ).fetchall()
    db.close()
    has_more = len(rows) > limit
    page = rows[:limit]
    items = [_community_publication_from_row(row, include_moderation=True) for row in page]
    next_cursor = _encode_account_cursor(page[-1]["submitted_at"], page[-1]["id"]) if has_more else None
    return {"items": items, "next_cursor": next_cursor}


def retract_community_publication(user_id: int, publication_id: str) -> dict | None:
    publication_id = _validate_canonical_id(publication_id, "publication id")
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT * FROM community_publications WHERE id=?", (publication_id,),
        ).fetchone()
        if not row:
            db.commit()
            return None
        if int(row["user_id"]) != int(user_id):
            raise PermissionError("Not authorized")
        if row["status"] != "retracted":
            now = int(time.time())
            db.execute(
                """UPDATE community_publications
                   SET status='retracted',retracted_at=?,updated_at=? WHERE id=?""",
                (now, now, publication_id),
            )
        saved = db.execute(
            "SELECT * FROM community_publications WHERE id=?", (publication_id,),
        ).fetchone()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return _community_publication_from_row(saved, include_moderation=True)


def list_community_publications_for_review(
    status: str = "pending_review",
    limit: int = 50,
    cursor: str | None = None,
) -> dict:
    status = str(status or "").strip().lower()
    if status not in COMMUNITY_PUBLICATION_STATUSES:
        raise ValueError("Invalid publication status")
    if not isinstance(limit, int) or limit < 1 or limit > 100:
        raise ValueError("Limit must be between 1 and 100")
    decoded_cursor = _decode_account_cursor(cursor)
    clauses = ["p.status=?"]
    params: list = [status]
    if decoded_cursor:
        clauses.append("(p.submitted_at<? OR (p.submitted_at=? AND p.id<?))")
        params.extend([decoded_cursor[0], decoded_cursor[0], decoded_cursor[1]])
    params.append(limit + 1)
    db = _conn()
    rows = db.execute(
        f"""SELECT p.*,u.username FROM community_publications p
            JOIN users u ON u.id=p.user_id
            WHERE {' AND '.join(clauses)}
            ORDER BY p.submitted_at DESC,p.id DESC LIMIT ?""",
        params,
    ).fetchall()
    db.close()
    has_more = len(rows) > limit
    page = rows[:limit]
    items = [
        _community_publication_from_row(row, include_moderation=True, include_user=True)
        for row in page
    ]
    next_cursor = _encode_account_cursor(page[-1]["submitted_at"], page[-1]["id"]) if has_more else None
    return {"items": items, "next_cursor": next_cursor}


def moderate_community_publication(
    publication_id: str,
    status: str,
    moderator_user_id: int,
    note: str | None = None,
) -> dict | None:
    publication_id = _validate_canonical_id(publication_id, "publication id")
    status = str(status or "").strip().lower()
    if status not in {"approved", "rejected"}:
        raise ValueError("Moderation status must be approved or rejected")
    clean_note = re.sub(r"\s+", " ", str(note or "")).strip() or None
    if clean_note and len(clean_note) > 1000:
        raise ValueError("Moderation note is too long")
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT * FROM community_publications WHERE id=?", (publication_id,),
        ).fetchone()
        if not row:
            db.commit()
            return None
        if row["status"] != "pending_review":
            raise PublicationStateConflictError(row["status"])
        now = int(time.time())
        db.execute(
            """UPDATE community_publications
               SET status=?,moderation_note=?,moderated_by=?,moderated_at=?,updated_at=?
               WHERE id=?""",
            (status, clean_note, moderator_user_id, now, now, publication_id),
        )
        saved = db.execute(
            """SELECT p.*,u.username FROM community_publications p
               JOIN users u ON u.id=p.user_id WHERE p.id=?""",
            (publication_id,),
        ).fetchone()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return _community_publication_from_row(
        saved, include_moderation=True, include_user=True,
    )


def _publication_contributor(user_id: int) -> dict | None:
    profile = get_contributor_profile(user_id)
    if not profile:
        return None
    tier = profile.get("tier") if isinstance(profile.get("tier"), dict) else {}
    return {
        "user_id": int(profile["user_id"]),
        "display_name": profile.get("display_name") or profile.get("username"),
        "title": profile.get("title"),
        "avatar_color": profile.get("avatar_color"),
        "tier": {key: tier.get(key) for key in ("id", "label") if tier.get(key) is not None},
    }


def list_approved_place_publications(
    place_id: str,
    limit: int = 50,
    cursor: str | None = None,
) -> dict:
    place_id = _validate_canonical_id(place_id, "place id")
    if not isinstance(limit, int) or limit < 1 or limit > 100:
        raise ValueError("Limit must be between 1 and 100")
    decoded_cursor = _decode_account_cursor(cursor)
    clauses = [
        "p.place_id=?", "p.status='approved'", "p.publication_type IN ('place_update','correction')",
        "u.public_profile_visible=1",
    ]
    params: list = [place_id]
    if decoded_cursor:
        clauses.append("(p.submitted_at<? OR (p.submitted_at=? AND p.id<?))")
        params.extend([decoded_cursor[0], decoded_cursor[0], decoded_cursor[1]])
    params.append(limit + 1)
    db = _conn()
    rows = db.execute(
        f"""SELECT p.* FROM community_publications p
            JOIN users u ON u.id=p.user_id
            WHERE {' AND '.join(clauses)}
            ORDER BY p.submitted_at DESC,p.id DESC LIMIT ?""",
        params,
    ).fetchall()
    db.close()
    has_more = len(rows) > limit
    page = rows[:limit]
    items: list[dict] = []
    for row in page:
        contributor = _publication_contributor(int(row["user_id"]))
        if not contributor:
            continue
        item = _community_publication_from_row(row)
        item.pop("status", None)
        item.pop("updated_at", None)
        item.pop("retracted_at", None)
        item["contributor"] = contributor
        items.append(item)
    next_cursor = _encode_account_cursor(page[-1]["submitted_at"], page[-1]["id"]) if has_more else None
    return {"items": items, "next_cursor": next_cursor}


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


WFIGS_MAP_CACHE_PREFIX = "conditions:wfigs:map:"
WFIGS_MAP_CACHE_MAX_ROWS = 128
WFIGS_MAP_CACHE_MAX_AGE_SECONDS = 1800


def get_wfigs_map_cached(
    key: str,
    *,
    max_age_seconds: int = WFIGS_MAP_CACHE_MAX_AGE_SECONDS,
    now: int | None = None,
) -> tuple[dict | None, int | None]:
    """Read one WFIGS map payload with its bounded age for stale fallback."""
    if not str(key).startswith(WFIGS_MAP_CACHE_PREFIX):
        raise ValueError("invalid WFIGS map cache key")
    timestamp = int(time.time()) if now is None else int(now)
    db = _conn()
    try:
        row = db.execute(
            "SELECT fetched_at,data FROM weather_cache WHERE cache_key=?",
            (key,),
        ).fetchone()
    finally:
        db.close()
    if not row:
        return None, None
    age = max(0, timestamp - int(row["fetched_at"]))
    if age > max(1, int(max_age_seconds)):
        return None, age
    try:
        payload = json.loads(row["data"])
    except (TypeError, ValueError, json.JSONDecodeError):
        return None, age
    return (payload if isinstance(payload, dict) else None), age


def _prune_wfigs_map_cache_rows(
    db: sqlite3.Connection,
    *,
    max_rows: int,
    max_age_seconds: int,
    now: int,
    preserve_key: str | None = None,
) -> int:
    """Prune only viewport-derived WFIGS rows from ``weather_cache``."""
    safe_max_rows = max(1, int(max_rows))
    safe_max_age = max(1, int(max_age_seconds))
    deleted = 0
    stale = db.execute(
        "DELETE FROM weather_cache WHERE cache_key LIKE ? AND fetched_at < ?",
        (f"{WFIGS_MAP_CACHE_PREFIX}%", int(now) - safe_max_age),
    )
    deleted += stale.rowcount or 0
    overflow = db.execute(
        """DELETE FROM weather_cache
           WHERE cache_key IN (
               SELECT cache_key FROM weather_cache
               WHERE cache_key LIKE ?
               ORDER BY (cache_key = ?) DESC, fetched_at DESC, cache_key DESC
               LIMIT -1 OFFSET ?
           )""",
        (f"{WFIGS_MAP_CACHE_PREFIX}%", preserve_key or "", safe_max_rows),
    )
    deleted += overflow.rowcount or 0
    return deleted


def prune_wfigs_map_cache(
    *,
    max_rows: int = WFIGS_MAP_CACHE_MAX_ROWS,
    max_age_seconds: int = WFIGS_MAP_CACHE_MAX_AGE_SECONDS,
    now: int | None = None,
) -> int:
    """Bound the WFIGS map cache without touching other weather providers."""
    db = _conn()
    try:
        deleted = _prune_wfigs_map_cache_rows(
            db,
            max_rows=max_rows,
            max_age_seconds=max_age_seconds,
            now=int(time.time()) if now is None else int(now),
            preserve_key=None,
        )
        db.commit()
        return deleted
    finally:
        db.close()


def set_wfigs_map_cached(
    key: str,
    data: dict,
    *,
    max_rows: int = WFIGS_MAP_CACHE_MAX_ROWS,
    max_age_seconds: int = WFIGS_MAP_CACHE_MAX_AGE_SECONDS,
    now: int | None = None,
) -> int:
    """Atomically store one bounded WFIGS map cell and prune that namespace."""
    if not str(key).startswith(WFIGS_MAP_CACHE_PREFIX):
        raise ValueError("invalid WFIGS map cache key")
    timestamp = int(time.time()) if now is None else int(now)
    db = _conn()
    try:
        db.execute(
            "INSERT OR REPLACE INTO weather_cache (cache_key,fetched_at,data) VALUES (?,?,?)",
            (key, timestamp, json.dumps(data, separators=(",", ":"), allow_nan=False)),
        )
        deleted = _prune_wfigs_map_cache_rows(
            db,
            max_rows=max_rows,
            max_age_seconds=max_age_seconds,
            now=timestamp,
            preserve_key=key,
        )
        db.commit()
        return deleted
    finally:
        db.close()

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

def create_oauth_user(email: str, username: str, password_hash: str, provider: str, provider_sub: str,
                      referred_by: int | None = None) -> int:
    if provider not in {"apple", "google"}:
        raise ValueError("Unsupported OAuth provider")
    column = "apple_sub" if provider == "apple" else "google_sub"
    db = _conn()
    code = f"{username.lower()}-{secrets.token_hex(3)}"
    cur = db.execute(
        f"""INSERT INTO users
           (email,username,password_hash,referral_code,referred_by,email_verified,auth_provider,{column},created_at)
           VALUES (?,?,?,?,?,1,?,?,?)""",
        (email.lower(), username, password_hash, code, referred_by, provider, provider_sub, int(time.time()))
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
            if "locked" not in str(e).lower():
                raise
            if attempt < 2:
                _time.sleep(2)
            else:
                break

    # Fallback: disable FK constraints, delete user row directly.
    # Delete account-owned library/trip records explicitly because foreign keys are
    # disabled on this recovery path.
    db = sqlite3.connect(settings.db_path, timeout=60.0, check_same_thread=False)
    try:
        db.execute("PRAGMA foreign_keys=OFF")
        _delete_user_support_data(db, user_id)
        db.execute("DELETE FROM authored_trip_pack_acquisition_requests WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM authored_trip_pack_entitlements WHERE user_id=?", (user_id,))
        db.execute("UPDATE authored_trip_packs SET created_by=NULL WHERE created_by=?", (user_id,))
        db.execute("UPDATE authored_trip_packs SET updated_by=NULL WHERE updated_by=?", (user_id,))
        db.execute("UPDATE authored_trip_pack_versions SET published_by=NULL WHERE published_by=?", (user_id,))
        db.execute("UPDATE authored_trip_pack_features SET selected_by=NULL WHERE selected_by=?", (user_id,))
        db.execute("UPDATE authored_original_features SET selected_by=NULL WHERE selected_by=?", (user_id,))
        db.execute("UPDATE authored_original_assets SET uploaded_by=NULL WHERE uploaded_by=?", (user_id,))
        db.execute("DELETE FROM availability_monitors WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM community_publications WHERE user_id=?", (user_id,))
        db.execute("UPDATE community_publications SET moderated_by=NULL WHERE moderated_by=?", (user_id,))
        db.execute("DELETE FROM communication_preferences WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM trip_document_mutations WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM trip_documents_v2 WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM saved_entity_mutations WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM saved_entities WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM community_ratings WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM community_rating_events WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM offline_bundle_preparations_v2 WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM route_service_segments_v1 WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM route_exit_references_v1 WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM timeline_event_media_v1 WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM trip_brief_and_backup_v1 WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM account_deletion_authorizations WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM users WHERE id=?", (user_id,))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _delete_user_support_data(db: sqlite3.Connection, user_id: int) -> None:
    """Remove private support data while preserving unrelated transcripts.

    ``support_threads.user_id`` predates cascading deletion in deployed databases,
    and the locked-database recovery path intentionally disables foreign keys. The
    child rows therefore have to be removed explicitly in both paths.
    """
    db.execute("DELETE FROM support_attachments WHERE user_id=?", (user_id,))
    db.execute(
        """DELETE FROM support_messages
           WHERE thread_id IN (SELECT id FROM support_threads WHERE user_id=?)""",
        (user_id,),
    )
    db.execute("DELETE FROM support_threads WHERE user_id=?", (user_id,))

    # A user message should normally belong to the user's own thread. Remove any
    # anomalous cross-thread message as private account data as well.
    db.execute("DELETE FROM support_messages WHERE sender_user_id=?", (user_id,))

    # Admin-authored support remains useful to its recipient after a staff account
    # is removed; only the now-invalid staff identity references are anonymized.
    db.execute("UPDATE support_threads SET created_by_admin=NULL WHERE created_by_admin=?", (user_id,))
    db.execute("UPDATE support_messages SET sender_admin_id=NULL WHERE sender_admin_id=?", (user_id,))


def _delete_user_full(user_id: int) -> None:
    db = _conn()
    _delete_user_support_data(db, user_id)
    # Tables with REFERENCES users(id) — strict foreign key constraints, delete first
    db.execute("DELETE FROM contributor_badges WHERE user_id=? OR granted_by=?", (user_id, user_id))
    db.execute("DELETE FROM contest_events      WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM contest_entries     WHERE user_id=?",    (user_id,))
    db.execute("UPDATE contest_awards SET winner_user_id=NULL,winner_username='Deleted user' WHERE winner_user_id=?", (user_id,))
    db.execute("DELETE FROM report_interactions WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM camp_field_reports  WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM camp_comments       WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM place_reservation_alerts WHERE user_id=?", (user_id,))
    db.execute("DELETE FROM availability_monitors WHERE user_id=?", (user_id,))
    db.execute("DELETE FROM authored_trip_pack_entitlements WHERE user_id=?", (user_id,))
    db.execute("DELETE FROM community_publications WHERE user_id=?", (user_id,))
    db.execute("UPDATE community_publications SET moderated_by=NULL WHERE moderated_by=?", (user_id,))
    db.execute("DELETE FROM communication_preferences WHERE user_id=?", (user_id,))
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
    db.execute("DELETE FROM trip_document_mutations WHERE user_id=?", (user_id,))
    db.execute("DELETE FROM trip_documents_v2   WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM saved_entity_mutations WHERE user_id=?", (user_id,))
    db.execute("DELETE FROM saved_entities       WHERE user_id=?",    (user_id,))
    # stripe_purchases uses session_id PK — delete by user_id if col exists (added via migration)
    try:
        db.execute("DELETE FROM stripe_purchases WHERE user_id=?",   (user_id,))
    except sqlite3.OperationalError as exc:
        # Older deployments can legitimately lack this table/column. Do not mask
        # locking, integrity, or other database failures during account deletion.
        message = str(exc).lower()
        if "no such table" not in message and "no such column" not in message:
            raise
    # Finally delete the user row itself (push_token is a column on users, not a table)
    db.execute("DELETE FROM users               WHERE id=?",         (user_id,))
    db.commit(); db.close()

def get_user_by_referral_code(code: str) -> dict | None:
    normalized = str(code or "").strip()
    if not normalized:
        return None
    db = _conn()
    row = db.execute(
        "SELECT * FROM users WHERE referral_code=? COLLATE NOCASE",
        (normalized,),
    ).fetchone()
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

def grant_signup_rewards(user_id: int, signup_bonus: int, referral_bonus: int) -> dict:
    """Grant welcome/referral credits exactly once, independent of current balance.

    Email verification and OAuth callbacks may be retried. Stable reward keys and a
    single write transaction prevent either retry or concurrent callbacks from
    double-crediting the new account or its referrer.
    """
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        user = db.execute(
            "SELECT id,username,email,referred_by FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
        if not user:
            db.rollback()
            return {"welcome_granted": False, "referral_granted": False}

        now = int(time.time())

        def _grant_once(target_user_id: int, amount: int, reason: str, reward_key: str) -> bool:
            if amount <= 0:
                return False
            cur = db.execute(
                """INSERT OR IGNORE INTO credit_transactions
                   (user_id,amount,reason,reward_key,created_at)
                   VALUES (?,?,?,?,?)""",
                (target_user_id, amount, reason, reward_key, now),
            )
            if cur.rowcount <= 0:
                return False
            db.execute(
                "UPDATE users SET credits=MAX(0,credits+?) WHERE id=?",
                (amount, target_user_id),
            )
            return True

        welcome_granted = _grant_once(
            user_id,
            int(signup_bonus),
            "Welcome bonus",
            f"signup-welcome:{user_id}",
        )
        referrer_id = int(user["referred_by"] or 0)
        referral_granted = False
        if referrer_id > 0 and referrer_id != user_id:
            referral_granted = _grant_once(
                referrer_id,
                int(referral_bonus),
                f"Referral - {user['username'] or 'new user'} signed up",
                f"signup-referral:{user_id}",
            )
            if referral_granted:
                existing = db.execute(
                    "SELECT id FROM referrals WHERE referrer_id=? AND lower(referred_email)=lower(?) LIMIT 1",
                    (referrer_id, user["email"]),
                ).fetchone()
                if existing:
                    db.execute(
                        "UPDATE referrals SET status='converted', converted_at=? WHERE id=?",
                        (now, existing["id"]),
                    )
                else:
                    db.execute(
                        """INSERT INTO referrals
                           (referrer_id,referred_email,status,created_at,converted_at)
                           VALUES (?,?,?,?,?)""",
                        (referrer_id, user["email"], "converted", now, now),
                    )
        db.commit()
        return {
            "welcome_granted": welcome_granted,
            "referral_granted": referral_granted,
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

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
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
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

def get_report_by_client_id(user_id: int, client_report_id: str | None) -> dict | None:
    """Return an account-scoped idempotent report, if one was already accepted."""
    if not client_report_id:
        return None
    db = _conn()
    row = db.execute(
        """SELECT id,type,observed_at,created_at,expires_at
           FROM reports WHERE user_id=? AND client_report_id=?""",
        (user_id, client_report_id),
    ).fetchone()
    db.close()
    return dict(row) if row else None


def create_report_idempotent(
    user_id: int, lat: float, lng: float, type: str, subtype: str | None,
    description: str | None, severity: str, photo_data: str | None = None,
    *, client_report_id: str | None = None, observed_at: int | None = None,
    source_surface: str | None = None, accuracy_m: float | None = None,
) -> dict:
    """Create a report once per account/client identifier."""
    db = _conn()
    now = int(time.time())
    observed = now if observed_at is None else int(observed_at)
    ttl = EXPIRY_BY_TYPE.get(type, 7 * 86400)
    expires = observed + ttl
    has_photo = 1 if photo_data else 0
    try:
        cur = db.execute(
            """INSERT INTO reports
               (user_id,lat,lng,type,subtype,description,severity,has_photo,photo_data,
                client_report_id,observed_at,source_surface,accuracy_m,created_at,expires_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (user_id, lat, lng, type, subtype, description, severity, has_photo, photo_data,
             client_report_id, observed, source_surface, accuracy_m, now, expires),
        )
        db.commit()
        return {
            "report_id": int(cur.lastrowid),
            "created": True,
            "observed_at": observed,
            "expires_at": expires,
        }
    except sqlite3.IntegrityError:
        if not client_report_id:
            raise
        row = db.execute(
            """SELECT id,observed_at,expires_at FROM reports
               WHERE user_id=? AND client_report_id=?""",
            (user_id, client_report_id),
        ).fetchone()
        if not row:
            raise
        return {
            "report_id": int(row["id"]),
            "created": False,
            "observed_at": row["observed_at"],
            "expires_at": row["expires_at"],
        }
    finally:
        db.close()


def create_report(user_id: int, lat: float, lng: float, type: str, subtype: str | None,
                  description: str | None, severity: str, photo_data: str | None = None,
                  *, client_report_id: str | None = None, observed_at: int | None = None,
                  source_surface: str | None = None,
                  accuracy_m: float | None = None) -> int:
    """Backward-compatible report creator returning the numeric report ID."""
    result = create_report_idempotent(
        user_id, lat, lng, type, subtype, description, severity,
        photo_data=photo_data,
        client_report_id=client_report_id,
        observed_at=observed_at,
        source_surface=source_surface,
        accuracy_m=accuracy_m,
    )
    return result["report_id"]

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
    now = int(time.time())
    try:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT type,expires_at,user_id FROM reports WHERE id=?", (report_id,)
        ).fetchone()
        if not row:
            db.rollback()
            return {"ok": False, "reason": "not_found"}
        if row["expires_at"] is not None and row["expires_at"] <= now:
            db.rollback()
            return {"ok": False, "reason": "expired"}
        if row["user_id"] == user_id:
            db.rollback()
            return {"ok": False, "reason": "own_report"}
        existing = db.execute(
            """SELECT id FROM report_interactions
               WHERE report_id=? AND user_id=? AND action='confirm'""",
            (report_id, user_id),
        ).fetchone()
        if existing:
            db.rollback()
            return {"ok": False, "reason": "already_confirmed"}

        db.execute(
            """INSERT INTO report_interactions (report_id,user_id,action,created_at)
               VALUES (?,?,?,?)""",
            (report_id, user_id, "confirm", now),
        )
        ttl = EXPIRY_BY_TYPE.get(row["type"], 7 * 86400)
        new_expires = now + ttl
        db.execute(
            """UPDATE reports
               SET confirmations=confirmations+1, expires_at=? WHERE id=?""",
            (new_expires, report_id),
        )
        db.execute("UPDATE users SET credits=credits+1 WHERE id=?", (user_id,))
        reason = f"Confirmed report #{report_id} still active"
        db.execute(
            """INSERT INTO credit_transactions (user_id,amount,reason,created_at)
               VALUES (?,?,?,?)""",
            (user_id, 1, reason, now),
        )
        _record_contest_event_db(
            db, user_id, 1, reason, "report_confirmation", str(report_id), now
        )
        db.commit()
        return {"ok": True, "expires_at": new_expires}
    except sqlite3.IntegrityError:
        db.rollback()
        return {"ok": False, "reason": "already_confirmed"}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

def _record_report_vote(report_id: int, user_id: int, action: str) -> dict:
    db = _conn()
    now = int(time.time())
    try:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT user_id,downvotes,expires_at FROM reports WHERE id=?", (report_id,)
        ).fetchone()
        if not row:
            db.rollback()
            return {"ok": False, "reason": "not_found"}
        if row["expires_at"] is not None and row["expires_at"] <= now:
            db.rollback()
            return {"ok": False, "reason": "expired"}
        if row["user_id"] == user_id:
            db.rollback()
            return {"ok": False, "reason": "own_report"}
        existing = db.execute(
            """SELECT action FROM report_interactions
               WHERE report_id=? AND user_id=?
                 AND action IN ('upvote','downvote')""",
            (report_id, user_id),
        ).fetchone()
        if existing:
            db.rollback()
            return {
                "ok": False,
                "reason": "already_voted",
                "existing_action": existing["action"],
            }
        db.execute(
            """INSERT INTO report_interactions (report_id,user_id,action,created_at)
               VALUES (?,?,?,?)""",
            (report_id, user_id, action, now),
        )
        if action == "upvote":
            db.execute("UPDATE reports SET upvotes=upvotes+1 WHERE id=?", (report_id,))
            db.execute("UPDATE users SET credits=credits+2 WHERE id=?", (row["user_id"],))
            db.execute(
                """INSERT INTO credit_transactions (user_id,amount,reason,created_at)
                   VALUES (?,?,?,?)""",
                (row["user_id"], 2, f"Report #{report_id} upvoted", now),
            )
            _record_contest_event_db(
                db, row["user_id"], 2, f"Report #{report_id} upvoted",
                "report_upvote", str(report_id), now,
            )
        else:
            db.execute("UPDATE reports SET downvotes=downvotes+1 WHERE id=?", (report_id,))
            updated = db.execute(
                "SELECT downvotes FROM reports WHERE id=?", (report_id,)
            ).fetchone()
            if updated and updated["downvotes"] == 5:
                db.execute("UPDATE reports SET expires_at=? WHERE id=?", (now, report_id))
                db.execute(
                    """UPDATE users
                       SET credits=MAX(0,credits-5),
                           flagged_report_count=flagged_report_count+1
                       WHERE id=?""",
                    (row["user_id"],),
                )
                db.execute(
                    """INSERT INTO credit_transactions (user_id,amount,reason,created_at)
                       VALUES (?,?,?,?)""",
                    (row["user_id"], -5,
                     f"Report #{report_id} removed - flagged inaccurate", now),
                )
                count_row = db.execute(
                    "SELECT flagged_report_count FROM users WHERE id=?", (row["user_id"],)
                ).fetchone()
                if count_row and count_row["flagged_report_count"] >= 3:
                    restrict_until = now + 7 * 86400
                    db.execute(
                        """UPDATE users
                           SET reporting_restricted_until=?, flagged_report_count=0
                           WHERE id=?""",
                        (restrict_until, row["user_id"]),
                    )
                    db.execute(
                        """INSERT INTO credit_transactions
                           (user_id,amount,reason,created_at) VALUES (?,?,?,?)""",
                        (row["user_id"], 0,
                         "Reporting restricted 7 days - 3 reports flagged as inaccurate", now),
                    )
        db.commit()
        return {"ok": True, "action": action}
    except sqlite3.IntegrityError:
        db.rollback()
        return {"ok": False, "reason": "already_voted"}
    finally:
        db.close()


def upvote_report(report_id: int, user_id: int) -> dict:
    return _record_report_vote(report_id, user_id, "upvote")


def downvote_report(report_id: int, user_id: int) -> dict:
    return _record_report_vote(report_id, user_id, "downvote")

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
        """INSERT INTO contest_entries (user_id,period_month,period_year,entry_type,created_at)
           VALUES (?,?,?,?,?)
           ON CONFLICT(user_id,period_month) DO UPDATE SET
             entry_type=CASE
               WHEN excluded.entry_type='subscriber' THEN 'subscriber'
               ELSE contest_entries.entry_type
             END,
             period_year=excluded.period_year""",
        (user_id, month, year, entry_type, now),
    )
    row = db.execute(
        "SELECT * FROM contest_entries WHERE user_id=? AND period_month=?",
        (user_id, month),
    ).fetchone()
    db.commit(); db.close()
    return dict(row) if row else {}

def _ensure_active_subscriber_entries_db(db: sqlite3.Connection, month: str, year: str,
                                         now: int | None = None) -> None:
    timestamp = int(now or time.time())
    active_subs = db.execute(
        "SELECT id FROM users WHERE plan_type!='free' AND COALESCE(plan_expires_at,0)>?",
        (timestamp,),
    ).fetchall()
    for sub in active_subs:
        db.execute(
            """INSERT INTO contest_entries
               (user_id,period_month,period_year,entry_type,created_at)
               VALUES (?,?,?,?,?)
               ON CONFLICT(user_id,period_month) DO UPDATE SET
                 entry_type='subscriber', period_year=excluded.period_year""",
            (sub["id"], month, year, "subscriber", timestamp),
        )

def get_contest_admin_overview(month: str | None = None, year: str | None = None) -> dict:
    month = (month or _contest_period()[0])[:7]
    year = (year or _contest_period()[1])[:4]
    db = _conn()
    now = int(time.time())
    _ensure_active_subscriber_entries_db(db, month, year, now)
    db.commit()
    entries = db.execute("SELECT COUNT(*) AS c FROM contest_entries WHERE period_month=?", (month,)).fetchone()["c"]
    free_entries = db.execute("SELECT COUNT(*) AS c FROM contest_entries WHERE period_month=? AND entry_type='free'", (month,)).fetchone()["c"]
    sub_entries = db.execute("SELECT COUNT(*) AS c FROM contest_entries WHERE period_month=? AND entry_type='subscriber'", (month,)).fetchone()["c"]
    awards = [dict(r) for r in db.execute(
        """SELECT a.*,u.email,
                  (SELECT t.id FROM support_threads t WHERE t.contest_award_id=a.id LIMIT 1) AS support_thread_id
           FROM contest_awards a LEFT JOIN users u ON u.id=a.winner_user_id
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
    if not winner:
        raise ValueError("No eligible contributor exists for this contest period")
    prize_label = "$1,000 cash prize + 1 year Explorer" if is_year else "$100 cash prize + 1 year Explorer"
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        if is_year:
            existing = db.execute(
                """SELECT * FROM contest_awards
                   WHERE prize_type=? AND period_year=? AND period_month IS NULL
                   ORDER BY id ASC LIMIT 1""",
                (prize_type, year),
            ).fetchone()
        else:
            existing = db.execute(
                """SELECT * FROM contest_awards
                   WHERE prize_type=? AND period_year=? AND period_month=?
                   ORDER BY id ASC LIMIT 1""",
                (prize_type, year, month),
            ).fetchone()
        if existing:
            db.commit()
            return dict(existing)
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
        db.commit()
        return dict(row)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

def run_contest_drawing(admin_id: int, month: str | None = None, year: str | None = None,
                        notes: str = "") -> dict:
    month = (month or _contest_period()[0])[:7]
    year = (year or _contest_period()[1])[:4]
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute(
            """SELECT * FROM contest_awards
               WHERE prize_type='monthly_drawing' AND period_month=? AND period_year=?
               ORDER BY id ASC LIMIT 1""",
            (month, year),
        ).fetchone()
        if existing:
            db.commit()
            return dict(existing)
        now = int(time.time())
        _ensure_active_subscriber_entries_db(db, month, year, now)
        rows = db.execute(
            """SELECT e.*,u.username FROM contest_entries e JOIN users u ON u.id=e.user_id
               WHERE e.period_month=? ORDER BY e.created_at ASC""",
            (month,),
        ).fetchall()
        entries = [dict(r) for r in rows]
        if not entries:
            raise ValueError("No eligible entries exist for this drawing period")
        winner = secrets.choice(entries) if entries else None
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
                "$50 cash prize + 1 year Explorer",
                "selected",
                notes,
                admin_id,
                now,
                now,
            ),
        )
        row = db.execute("SELECT * FROM contest_awards WHERE id=?", (cur.lastrowid,)).fetchone()
        db.commit()
        return dict(row)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

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

def ensure_contest_award_support_thread(award_id: int, admin_id: int) -> dict | None:
    """Create the winner's in-app message exactly once for a selected award."""
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        award = db.execute(
            """SELECT a.*,u.username
               FROM contest_awards a
               LEFT JOIN users u ON u.id=a.winner_user_id
               WHERE a.id=?""",
            (award_id,),
        ).fetchone()
        if not award or not award["winner_user_id"] or award["status"] == "void":
            db.commit()
            return None
        existing = db.execute(
            "SELECT id FROM support_threads WHERE contest_award_id=?",
            (award_id,),
        ).fetchone()
        if existing:
            db.commit()
            return {"thread_id": int(existing["id"]), "created": False}

        now = int(time.time())
        subject = "Your Trailhead contest prize"
        body = (
            f"Congratulations — you were selected for {award['prize_label']}. "
            "Reply with your preferred payout method: Cash App, PayPal, or bank deposit. "
            "Do not send bank account, routing, card, password, or identity-document details in chat. "
            "Trailhead support will arrange eligibility verification and the secure payout step with you."
        )
        cur = db.execute(
            """INSERT INTO support_threads
               (user_id,contest_award_id,category,subject,status,opened_by,created_by_admin,last_message_at,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                int(award["winner_user_id"]),
                award_id,
                "contest_award",
                subject,
                "open",
                "admin",
                admin_id,
                now,
                now,
                now,
            ),
        )
        thread_id = int(cur.lastrowid)
        db.execute(
            """INSERT INTO support_messages
               (thread_id,sender_role,sender_user_id,sender_admin_id,body,meta_json,created_at,read_by_user_at,read_by_admin_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                thread_id,
                "admin",
                None,
                admin_id,
                body,
                json.dumps({
                    "kind": "contest_award",
                    "award_id": award_id,
                    "prize_label": award["prize_label"],
                    "payout_methods": ["cash_app", "paypal", "bank_deposit"],
                    "sensitive_details_allowed": False,
                }),
                now,
                None,
                now,
            ),
        )
        db.execute(
            """UPDATE contest_awards
               SET status=CASE WHEN status='selected' THEN 'notified' ELSE status END,
                   updated_at=?
               WHERE id=?""",
            (now, award_id),
        )
        db.commit()
        return {"thread_id": thread_id, "created": True}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

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
    now = int(time.time())
    if plan_type == "free":
        db.execute("UPDATE users SET plan_type='free', plan_expires_at=NULL WHERE id=?", (user_id,))
    else:
        if expires_at is None:
            expires_at = now + 366 * 86400
        db.execute("UPDATE users SET plan_type=?, plan_expires_at=? WHERE id=?", (plan_type, expires_at, user_id))
        if int(expires_at or 0) > now:
            month, year = _contest_period(now)
            db.execute(
                """INSERT INTO contest_entries
                   (user_id,period_month,period_year,entry_type,created_at)
                   VALUES (?,?,?,?,?)
                   ON CONFLICT(user_id,period_month) DO UPDATE SET
                     entry_type='subscriber', period_year=excluded.period_year""",
                (user_id, month, year, "subscriber", now),
            )
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
    month, year = _contest_period(now)
    db.execute(
        """INSERT INTO contest_entries
           (user_id,period_month,period_year,entry_type,created_at)
           VALUES (?,?,?,?,?)
           ON CONFLICT(user_id,period_month) DO UPDATE SET
             entry_type='subscriber', period_year=excluded.period_year""",
        (user_id, month, year, "subscriber", now),
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
    clean = str(token or "").strip()
    if not clean or len(clean) > 512:
        raise ValueError("Invalid push token")
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        db.execute(
            "UPDATE users SET push_token=NULL WHERE push_token=? AND id!=?", (clean, user_id),
        )
        db.execute("UPDATE users SET push_token=? WHERE id=?", (clean, user_id))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def clear_push_token(user_id: int, expected_token: str | None = None) -> bool:
    clean = str(expected_token or "").strip() or None
    db = _conn()
    if clean:
        cursor = db.execute(
            "UPDATE users SET push_token=NULL WHERE id=? AND push_token=?", (user_id, clean),
        )
    else:
        cursor = db.execute("UPDATE users SET push_token=NULL WHERE id=?", (user_id,))
    db.commit()
    cleared = bool(cursor.rowcount)
    db.close()
    return cleared

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
    decoded_messages = [_decode_support_thread_row(m) for m in messages]
    attachment_map = list_support_message_attachments([
        int(message["id"]) for message in decoded_messages
    ]) if decoded_messages else {}
    for message in decoded_messages:
        message["attachments"] = attachment_map.get(int(message["id"]), [])
    item["messages"] = decoded_messages
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
        """UPDATE plan_jobs
           SET status=?, result=CASE WHEN ? IS NULL THEN result ELSE ? END,
               error=?, updated_at=?
           WHERE id=? AND (status NOT IN ('done','failed') OR status=?)""",
        (status, result, result, error, time.time(), job_id, status)
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

DISPERSED_PUBLIC_SOURCE_CLEAR_KEYS = {
    "address", "phone", "website", "url", "booking_url", "hours",
    "rating", "rating_count", "cost", "hero_photo_url", "photo_url",
}


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


def _strip_public_dispersed_source_fields(data: dict) -> dict:
    for key in DISPERSED_PUBLIC_SOURCE_CLEAR_KEYS:
        data.pop(key, None)
    return data


def _clear_public_dispersed_place_source_fields(camp_id: str, *, now: int | None = None) -> None:
    camp_id = str(camp_id or "").strip()
    if not camp_id:
        return
    ts = now or int(time.time())
    db = _conn()
    try:
        row = db.execute(
            "SELECT display_metadata FROM places WHERE trailhead_place_id=?",
            (camp_id,),
        ).fetchone()
        if row:
            metadata = _dispersed_lead_json(row["display_metadata"], {})
            if not isinstance(metadata, dict):
                metadata = {}
            _strip_public_dispersed_source_fields(metadata)
            db.execute(
                """UPDATE places
                   SET official_url='', hero_photo_url=NULL, display_metadata=?, updated_at=?, last_seen=?
                   WHERE trailhead_place_id=?""",
                (json.dumps(metadata), ts, ts, camp_id),
            )

        override_row = db.execute(
            "SELECT data FROM camp_profile_overrides WHERE camp_id=?",
            (camp_id,),
        ).fetchone()
        if override_row:
            override = _dispersed_lead_json(override_row["data"], {})
            if not isinstance(override, dict):
                override = {}
            _strip_public_dispersed_source_fields(override)
            db.execute(
                "UPDATE camp_profile_overrides SET data=?, updated_at=? WHERE camp_id=?",
                (json.dumps(override), ts, camp_id),
            )
        db.commit()
    finally:
        db.close()


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
        _clear_public_dispersed_place_source_fields(str(place_id), now=now)
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


def repair_published_dispersed_site_lead_metadata(
    *,
    max_age_days: int = 366,
    source_batch: str | None = None,
    limit: int = 0,
    admin_id: int | None = None,
) -> dict:
    """Refresh public-card metadata for already-published dispersed leads.

    This intentionally avoids republishing through the nearby merge path. It only
    repairs the fields the public card/API reads for leads that already have a
    canonical public camp id.
    """
    leads = list_dispersed_site_leads_for_publication(
        max_age_days=max_age_days,
        source_batch=source_batch,
        limit=limit,
        statuses=["published"],
    )
    now = int(time.time())
    report = {"eligible": len(leads), "repaired": 0, "skipped": 0, "missing_place": 0}
    db = _conn()
    try:
        for lead in leads:
            camp_id = str(lead.get("canonical_camp_id") or "").strip()
            if not camp_id:
                report["skipped"] += 1
                continue
            place_row = db.execute(
                "SELECT display_metadata FROM places WHERE trailhead_place_id=?",
                (camp_id,),
            ).fetchone()
            if not place_row:
                report["missing_place"] += 1
                continue

            profile = lead.get("profile_data") or {}
            public_description = (
                str(profile.get("description") or "").strip()
                or DISPERSED_PUBLIC_DEFAULT_DESCRIPTION
            )
            verified_ts = _parse_dispersed_verified_ts(lead.get("source_verified_at")) or now
            source_freshness = dispersed_lead_verified_freshness(lead, now=now)
            metadata = _place_json(place_row["display_metadata"], {})
            if not isinstance(metadata, dict):
                metadata = {}
            _strip_public_dispersed_source_fields(metadata)
            metadata.update({
                "summary": public_description,
                "description": public_description,
                "land_type": "Dispersed",
                "reservable": False,
                "verified_source": "Recent dispersed spot",
                "source_badge": "Trailhead",
                "source_freshness": source_freshness,
                "source_confidence_notes": DISPERSED_PUBLIC_DEFAULT_DESCRIPTION,
                "trailhead_dataset": "dispersed_camp",
                "trailhead_public": True,
                "source_verified_at": lead.get("source_verified_at") or "",
                "source_updated_at": verified_ts,
                "last_refreshed_at": now,
                "refresh_after": now + 90 * 86400,
            })
            db.execute(
                """UPDATE places
                   SET official_url='', hero_photo_url=NULL, display_metadata=?, updated_at=?, last_seen=?
                   WHERE trailhead_place_id=?""",
                (json.dumps(metadata), now, now, camp_id),
            )

            override_row = db.execute(
                "SELECT data FROM camp_profile_overrides WHERE camp_id=?",
                (camp_id,),
            ).fetchone()
            override = _place_json(override_row["data"], {}) if override_row else {}
            if not isinstance(override, dict):
                override = {}
            _strip_public_dispersed_source_fields(override)
            override.update({
                "description": public_description,
                "summary": public_description,
                "land_type": "Dispersed",
                "reservable": False,
                "verified_source": "Recent dispersed spot",
                "source_badge": "Trailhead",
                "source_freshness": source_freshness,
                "source_confidence_notes": DISPERSED_PUBLIC_DEFAULT_DESCRIPTION,
                "site_types": override.get("site_types") or profile.get("site_types") or ["Tent"],
                "amenities": override.get("amenities") or profile.get("amenities") or [],
                "activities": override.get("activities") or profile.get("activities") or [],
            })
            db.execute(
                """INSERT INTO camp_profile_overrides (camp_id,data,updated_by,updated_at)
                   VALUES (?,?,?,?)
                   ON CONFLICT(camp_id) DO UPDATE SET
                    data=excluded.data, updated_by=excluded.updated_by, updated_at=excluded.updated_at""",
                (camp_id, json.dumps(override), admin_id, now),
            )
            report["repaired"] += 1
        db.commit()
    finally:
        db.close()
    return report


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


# -- Availability monitors ------------------------------------------------------

AVAILABILITY_MONITOR_TYPES = {
    "campground", "permit", "tour", "route_reopening", "closure", "safety",
}
QUOTA_EXEMPT_MONITOR_TYPES = {"route_reopening", "closure", "safety"}
AVAILABILITY_TRIAL_DAYS = 7
AVAILABILITY_STANDARD_DAYS = 30
AVAILABILITY_EXPLORER_LIMIT = 5
AVAILABILITY_MONITOR_CREDITS = 50
AVAILABILITY_MONITOR_STATUSES = {"active", "expired", "cancelled", "failed"}


class InsufficientMonitorCreditsError(ValueError):
    def __init__(self, balance: int):
        self.balance = int(balance)
        self.required = AVAILABILITY_MONITOR_CREDITS
        super().__init__("Not enough credits for this availability watch")


class MonitorAlreadyExistsError(ValueError):
    def __init__(self, monitor_id: str):
        self.monitor_id = monitor_id
        super().__init__("An active watch already exists for these dates")


class MonitorCreationError(RuntimeError):
    def __init__(self, monitor: dict):
        self.monitor = monitor
        super().__init__("The availability watch could not be started")


def _active_explorer_monitor_plan(plan_type: str, plan_expires_at: int | None, now: int) -> bool:
    plan = str(plan_type or "free").strip().lower()
    entitled_plan = (
        plan in EXPLORER_PLAN_TYPES
        or "explorer" in plan
        or "extreme" in plan
    )
    return entitled_plan and int(plan_expires_at or 0) > now


def _clean_monitor_date(value: str | None, label: str) -> str | None:
    clean = str(value or "").strip() or None
    if clean is None:
        return None
    try:
        _dt.date.fromisoformat(clean)
    except ValueError as exc:
        raise ValueError(f"{label} must be an ISO date") from exc
    return clean


def _expire_availability_monitors_db(db: sqlite3.Connection, now: int, user_id: int | None = None) -> None:
    user_clause = " AND user_id=?" if user_id is not None else ""
    db.execute(
        f"""UPDATE place_reservation_alerts
            SET status='expired', updated_at=?
            WHERE id IN (
                SELECT reservation_alert_id FROM availability_monitors
                WHERE status='active' AND expires_at<=?{user_clause}
                  AND reservation_alert_id IS NOT NULL
            )""",
        [now, now, *([user_id] if user_id is not None else [])],
    )
    db.execute(
        f"""UPDATE availability_monitors
            SET status='expired', updated_at=?
            WHERE status='active' AND expires_at<=?{user_clause}""",
        [now, now, *([user_id] if user_id is not None else [])],
    )


def _availability_monitor_from_row(row: sqlite3.Row | dict, now: int | None = None) -> dict:
    monitor = dict(row)
    try:
        criteria = json.loads(monitor.pop("criteria_json", "{}"))
    except Exception:
        criteria = {}
    monitor["criteria"] = criteria if isinstance(criteria, dict) else {}
    monitor["quota_exempt"] = monitor.get("monitor_type") in QUOTA_EXEMPT_MONITOR_TYPES
    monitor["remaining_seconds"] = max(0, int(monitor.get("expires_at") or 0) - int(now or time.time()))
    monitor.pop("request_hash", None)
    monitor.pop("idempotency_key", None)
    monitor.pop("user_id", None)
    return monitor


def availability_monitor_policy(user_id: int) -> dict:
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        _expire_availability_monitors_db(db, now, user_id)
        user = db.execute(
            "SELECT credits,plan_type,plan_expires_at FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
        if not user:
            raise ValueError("Account not found")
        trial_used = bool(db.execute(
            """SELECT 1 FROM availability_monitors
               WHERE user_id=? AND billing_kind='trial' AND status!='failed' LIMIT 1""",
            (user_id,),
        ).fetchone())
        counts = db.execute(
            """SELECT
                 COUNT(*) AS active_total,
                 SUM(CASE WHEN billing_kind IN ('trial','explorer','legacy') THEN 1 ELSE 0 END) AS free_active,
                 SUM(CASE WHEN billing_kind='credits' THEN 1 ELSE 0 END) AS paid_active,
                 SUM(CASE WHEN billing_kind='safety_free' THEN 1 ELSE 0 END) AS safety_active
               FROM availability_monitors
               WHERE user_id=? AND status='active' AND expires_at>?""",
            (user_id, now),
        ).fetchone()
        plan_type = str(user["plan_type"] or "free")
        plan_expires_at = int(user["plan_expires_at"] or 0)
        explorer_active = _active_explorer_monitor_plan(plan_type, plan_expires_at, now)
        free_active = int(counts["free_active"] or 0)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return {
        "trial": {
            "available": not trial_used,
            "used": trial_used,
            "duration_days": AVAILABILITY_TRIAL_DAYS,
        },
        "explorer": {
            "active": explorer_active,
            "included_limit": AVAILABILITY_EXPLORER_LIMIT,
            "included_active": free_active,
            "included_remaining": max(0, AVAILABILITY_EXPLORER_LIMIT - free_active) if explorer_active else 0,
        },
        "extra_monitor": {
            "credits": AVAILABILITY_MONITOR_CREDITS,
            "duration_days": AVAILABILITY_STANDARD_DAYS,
        },
        "safety_and_legal_alerts": {"free": True, "quota_exempt": True},
        "active_total": int(counts["active_total"] or 0),
        "paid_active": int(counts["paid_active"] or 0),
        "safety_active": int(counts["safety_active"] or 0),
        "credit_balance": int(user["credits"] or 0),
    }


def _link_place_reservation_alert(
    db: sqlite3.Connection,
    target_id: str,
    user_id: int,
    start_date: str | None,
    end_date: str | None,
    party_size: int,
    source: str,
    booking_url: str | None,
    now: int,
) -> int | None:
    if not db.execute("SELECT 1 FROM places WHERE trailhead_place_id=?", (target_id,)).fetchone():
        return None
    existing = db.execute(
        """SELECT id FROM place_reservation_alerts
           WHERE trailhead_place_id=? AND user_id=?
             AND COALESCE(start_date,'')=COALESCE(?, '')
             AND COALESCE(end_date,'')=COALESCE(?, '')
           ORDER BY updated_at DESC LIMIT 1""",
        (target_id, user_id, start_date, end_date),
    ).fetchone()
    if existing:
        db.execute(
            """UPDATE place_reservation_alerts
               SET party_size=?,source=?,booking_url=?,status='active',updated_at=?
               WHERE id=?""",
            (party_size, source, booking_url, now, existing["id"]),
        )
        return int(existing["id"])
    cur = db.execute(
        """INSERT INTO place_reservation_alerts
           (trailhead_place_id,user_id,start_date,end_date,party_size,source,booking_url,status,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,'active',?,?)""",
        (target_id, user_id, start_date, end_date, party_size, source, booking_url, now, now),
    )
    return int(cur.lastrowid)


def create_availability_monitor(
    user_id: int,
    target_id: str,
    target_label: str,
    monitor_type: str,
    idempotency_key: str,
    start_date: str | None = None,
    end_date: str | None = None,
    party_size: int = 1,
    source: str = "trailhead",
    booking_url: str | None = None,
    criteria: dict | None = None,
    job_creator=None,
) -> dict:
    target_id = _validate_canonical_id(target_id, "monitor target id")
    target_label = re.sub(r"\s+", " ", str(target_label or "")).strip()
    monitor_type = str(monitor_type or "").strip().lower()
    idempotency_key = str(idempotency_key or "").strip()
    start_date = _clean_monitor_date(start_date, "start_date")
    end_date = _clean_monitor_date(end_date, "end_date")
    if not target_label or len(target_label) > 200:
        raise ValueError("Target label must be between 1 and 200 characters")
    if monitor_type not in AVAILABILITY_MONITOR_TYPES:
        raise ValueError("Unsupported availability watch type")
    if not _IDEMPOTENCY_KEY_RE.fullmatch(idempotency_key):
        raise ValueError("Invalid Idempotency-Key")
    if start_date and end_date and end_date < start_date:
        raise ValueError("end_date must be on or after start_date")
    if not isinstance(party_size, int) or party_size < 1 or party_size > 20:
        raise ValueError("Party size must be between 1 and 20")
    source = re.sub(r"[^a-zA-Z0-9_.:-]+", "_", str(source or "trailhead").strip())[:80] or "trailhead"
    booking_url = str(booking_url or "").strip() or None
    if booking_url and (len(booking_url) > 2000 or not re.match(r"^https?://", booking_url, re.I)):
        raise ValueError("Booking URL must use http or https")
    criteria, criteria_json = _json_object(criteria or {}, "Availability criteria", 64 * 1024)
    request_payload = {
        "target_id": target_id,
        "target_label": target_label,
        "monitor_type": monitor_type,
        "start_date": start_date,
        "end_date": end_date,
        "party_size": party_size,
        "source": source,
        "booking_url": booking_url,
        "criteria": criteria,
    }
    request_hash = hashlib.sha256(json.dumps(
        request_payload, separators=(",", ":"), sort_keys=True,
    ).encode("utf-8")).hexdigest()
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        _expire_availability_monitors_db(db, now, user_id)
        replay = db.execute(
            """SELECT * FROM availability_monitors
               WHERE user_id=? AND idempotency_key=?""",
            (user_id, idempotency_key),
        ).fetchone()
        if replay:
            if replay["request_hash"] != request_hash:
                raise ValueError("Idempotency-Key was already used for a different request")
            result = _availability_monitor_from_row(replay, now)
            result["replayed"] = True
            db.commit()
            return result
        duplicate = db.execute(
            """SELECT id FROM availability_monitors
               WHERE user_id=? AND target_id=? AND monitor_type=? AND status='active'
                 AND COALESCE(start_date,'')=COALESCE(?, '')
                 AND COALESCE(end_date,'')=COALESCE(?, '')
               LIMIT 1""",
            (user_id, target_id, monitor_type, start_date, end_date),
        ).fetchone()
        if duplicate:
            raise MonitorAlreadyExistsError(str(duplicate["id"]))
        user = db.execute(
            "SELECT credits,plan_type,plan_expires_at FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
        if not user:
            raise ValueError("Account not found")

        if monitor_type in QUOTA_EXEMPT_MONITOR_TYPES:
            billing_kind = "safety_free"
            duration_days = AVAILABILITY_STANDARD_DAYS
            credits_charged = 0
        else:
            trial_used = bool(db.execute(
                """SELECT 1 FROM availability_monitors
                   WHERE user_id=? AND billing_kind='trial' AND status!='failed' LIMIT 1""",
                (user_id,),
            ).fetchone())
            plan_type = str(user["plan_type"] or "free")
            explorer_active = _active_explorer_monitor_plan(
                plan_type, user["plan_expires_at"], now,
            )
            free_active = int(db.execute(
                """SELECT COUNT(*) FROM availability_monitors
                   WHERE user_id=? AND status='active' AND expires_at>?
                     AND billing_kind IN ('trial','explorer','legacy')""",
                (user_id, now),
            ).fetchone()[0])
            if explorer_active and free_active < AVAILABILITY_EXPLORER_LIMIT:
                billing_kind = "explorer"
                duration_days = AVAILABILITY_STANDARD_DAYS
                credits_charged = 0
            elif not explorer_active and not trial_used:
                billing_kind = "trial"
                duration_days = AVAILABILITY_TRIAL_DAYS
                credits_charged = 0
            else:
                billing_kind = "credits"
                duration_days = AVAILABILITY_STANDARD_DAYS
                credits_charged = AVAILABILITY_MONITOR_CREDITS
                db.execute(
                    "UPDATE users SET credits=credits-? WHERE id=? AND credits>=?",
                    (credits_charged, user_id, credits_charged),
                )
                if db.execute("SELECT changes()").fetchone()[0] == 0:
                    raise InsufficientMonitorCreditsError(int(user["credits"] or 0))
                db.execute(
                    """INSERT INTO credit_transactions (user_id,amount,reason,created_at)
                       VALUES (?,?,?,?)""",
                    (user_id, -credits_charged, f"Availability watch: {target_label}", now),
                )

        reservation_alert_id = None
        if monitor_type == "campground":
            reservation_alert_id = _link_place_reservation_alert(
                db, target_id, user_id, start_date, end_date, party_size,
                source, booking_url, now,
            )
        monitor_id = f"mon_{secrets.token_hex(12)}"
        expires_at = now + duration_days * 86400
        db.execute(
            """INSERT INTO availability_monitors
               (id,user_id,target_id,target_label,monitor_type,start_date,end_date,
                party_size,source,booking_url,criteria_json,status,billing_kind,
                credits_charged,duration_days,expires_at,reservation_alert_id,
                idempotency_key,request_hash,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?,?,?,?,?,?)""",
            (
                monitor_id, user_id, target_id, target_label, monitor_type,
                start_date, end_date, party_size, source, booking_url, criteria_json,
                billing_kind, credits_charged, duration_days, expires_at,
                reservation_alert_id, idempotency_key, request_hash, now, now,
            ),
        )
        saved = db.execute("SELECT * FROM availability_monitors WHERE id=?", (monitor_id,)).fetchone()
        result = _availability_monitor_from_row(saved, now)
        result["replayed"] = False
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    if job_creator is not None:
        try:
            job_creator(result)
        except Exception as exc:
            failed = fail_availability_monitor_creation(
                user_id, result["id"], "The watch could not be started",
            )
            raise MonitorCreationError(failed) from exc
    return result


def get_availability_monitor(user_id: int, monitor_id: str) -> dict | None:
    monitor_id = str(monitor_id or "").strip()
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        _expire_availability_monitors_db(db, now, user_id)
        row = db.execute("SELECT * FROM availability_monitors WHERE id=?", (monitor_id,)).fetchone()
        if row and int(row["user_id"]) != int(user_id):
            raise PermissionError("Not authorized")
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return _availability_monitor_from_row(row, now) if row else None


def list_availability_monitors(
    user_id: int,
    limit: int = 50,
    cursor: str | None = None,
    status: str | None = None,
) -> dict:
    if not isinstance(limit, int) or limit < 1 or limit > 100:
        raise ValueError("Limit must be between 1 and 100")
    status = str(status or "").strip().lower() or None
    if status and status not in AVAILABILITY_MONITOR_STATUSES:
        raise ValueError("Invalid availability watch status")
    decoded_cursor = _decode_account_cursor(cursor)
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        _expire_availability_monitors_db(db, now, user_id)
        clauses = ["user_id=?"]
        params: list = [user_id]
        if status:
            clauses.append("status=?")
            params.append(status)
        if decoded_cursor:
            clauses.append("(updated_at<? OR (updated_at=? AND id<?))")
            params.extend([decoded_cursor[0], decoded_cursor[0], decoded_cursor[1]])
        params.append(limit + 1)
        rows = db.execute(
            f"""SELECT * FROM availability_monitors
                WHERE {' AND '.join(clauses)}
                ORDER BY updated_at DESC,id DESC LIMIT ?""",
            params,
        ).fetchall()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    has_more = len(rows) > limit
    page = rows[:limit]
    return {
        "items": [_availability_monitor_from_row(row, now) for row in page],
        "next_cursor": _encode_account_cursor(page[-1]["updated_at"], page[-1]["id"]) if has_more else None,
    }


def cancel_availability_monitor(user_id: int, monitor_id: str) -> dict | None:
    monitor_id = str(monitor_id or "").strip()
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        _expire_availability_monitors_db(db, now, user_id)
        row = db.execute("SELECT * FROM availability_monitors WHERE id=?", (monitor_id,)).fetchone()
        if not row:
            db.commit()
            return None
        if int(row["user_id"]) != int(user_id):
            raise PermissionError("Not authorized")
        if row["status"] == "active":
            db.execute(
                """UPDATE availability_monitors
                   SET status='cancelled',cancelled_at=?,updated_at=? WHERE id=?""",
                (now, now, monitor_id),
            )
            if row["reservation_alert_id"]:
                db.execute(
                    """UPDATE place_reservation_alerts
                       SET status='cancelled',updated_at=? WHERE id=?""",
                    (now, row["reservation_alert_id"]),
                )
        saved = db.execute("SELECT * FROM availability_monitors WHERE id=?", (monitor_id,)).fetchone()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return _availability_monitor_from_row(saved, now)


def fail_availability_monitor_creation(user_id: int, monitor_id: str, reason: str) -> dict:
    now = int(time.time())
    reason = re.sub(r"\s+", " ", str(reason or "")).strip()[:300] or "The watch could not be started"
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM availability_monitors WHERE id=?", (monitor_id,)).fetchone()
        if not row:
            raise ValueError("Availability watch not found")
        if int(row["user_id"]) != int(user_id):
            raise PermissionError("Not authorized")
        if row["status"] == "failed":
            db.commit()
            return _availability_monitor_from_row(row, now)
        if row["status"] != "active":
            raise ValueError("Only an active watch can fail during creation")
        refund = int(row["credits_charged"] or 0)
        refunded_at = None
        if refund > 0 and not row["refunded_at"]:
            db.execute("UPDATE users SET credits=credits+? WHERE id=?", (refund, user_id))
            db.execute(
                """INSERT INTO credit_transactions (user_id,amount,reason,created_at)
                   VALUES (?,?,?,?)""",
                (user_id, refund, f"Availability watch refund: {row['target_label']}", now),
            )
            refunded_at = now
        db.execute(
            """UPDATE availability_monitors
               SET status='failed',failure_reason=?,refunded_at=?,updated_at=? WHERE id=?""",
            (reason, refunded_at, now, monitor_id),
        )
        if row["reservation_alert_id"]:
            db.execute(
                "UPDATE place_reservation_alerts SET status='failed',updated_at=? WHERE id=?",
                (now, row["reservation_alert_id"]),
            )
        saved = db.execute("SELECT * FROM availability_monitors WHERE id=?", (monitor_id,)).fetchone()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return _availability_monitor_from_row(saved, now)


# -- Trailhead-authored trip packs ----------------------------------------------

TRIP_PACK_PRICES = {250, 500, 900}
TRIP_PACK_COVERAGE_REGIONS = {"north_america", "global"}
TRIP_PACK_CONTENT_KINDS = {"trip_pack", "original_drive"}
TRIP_PACK_VALIDATION_CHECKS = {
    "route_reviewed",
    "rig_requirements_reviewed",
    "camps_reviewed",
    "fuel_water_reviewed",
    "season_reviewed",
    "backup_options_reviewed",
    "media_licenses_reviewed",
    "offline_coverage_reviewed",
}
ORIGINAL_VALIDATION_CHECKS = {
    "route_reviewed",
    "cue_route_reviewed",
    "narration_reviewed",
    "audio_assets_reviewed",
    "transcripts_reviewed",
    "source_citations_reviewed",
    "media_licenses_reviewed",
    "safety_access_reviewed",
    "season_reviewed",
    "offline_bundle_reviewed",
}
ORIGINAL_DEVICE_PREVIEW_VERSION_BASE = 1_000_000_000
ORIGINAL_SOURCE_REVIEW_MAX_AGE_DAYS = 180
ORIGINAL_OPERATIONAL_SOURCE_MAX_AGE_DAYS = 30
ORIGINAL_VIRTUAL_VALIDATION_SUITE_VERSION = "originals_virtual_route_v2"
ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION = "original-trigger-v2"
ORIGINAL_VIRTUAL_VALIDATION_RUN_TIMEOUT_SECONDS = 2 * 3600
ORIGINAL_VIRTUAL_VALIDATION_REQUIRED_SCENARIOS = (
    "baseline_slow_15mph",
    "baseline_cruise_36mph",
    "baseline_highway_65mph",
    "gps_jitter",
    "poor_accuracy_recovery",
    "off_route_rejoin",
    "reverse_travel",
    "mid_route_start",
    "restart_duplicate_prevention",
    "overlapping_audio_queue",
    "drive_by_speed",
    "delayed_out_of_order_fixes",
    "self_intersection_ambiguity",
)
ORIGINAL_OPERATIONAL_SOURCE_SCOPES = {
    "route", "access", "fees", "closures", "surface", "season", "safety",
}
ORIGINAL_FEEDBACK_CATEGORIES = {
    "general", "trigger_timing", "audio", "map", "offline",
    "access_info", "safety", "other",
}
ORIGINAL_FEEDBACK_STATUSES = {"new", "reviewing", "resolved", "dismissed"}
ORIGINAL_FEEDBACK_PLATFORMS = {"ios", "android", "web"}
ORIGINAL_FEEDBACK_GUEST_TOKEN_TTL_SECONDS = 30 * 86400
ORIGINAL_FEEDBACK_GUEST_MAX_SUBMISSIONS = 5
ORIGINAL_FEEDBACK_TOKEN_ISSUANCE_WINDOW_SECONDS = 7 * 86400
ORIGINAL_FEEDBACK_TOKEN_ISSUANCE_IP_LIMIT = 10
ORIGINAL_FEEDBACK_TOKEN_ISSUANCE_INSTALL_LIMIT = 10
TRIP_PACK_EXPLORER_DISCOUNT_PERCENT = 20


class InsufficientTripPackCreditsError(ValueError):
    def __init__(self, balance: int, credits_needed: int, list_price: int):
        self.balance = int(balance)
        self.credits_needed = int(credits_needed)
        self.list_price = int(list_price)
        super().__init__("Not enough credits for this trip pack")


class InsufficientOriginalCreditsError(InsufficientTripPackCreditsError):
    def __init__(self, balance: int, credits_needed: int, list_price: int):
        super().__init__(balance, credits_needed, list_price)
        self.args = ("Not enough credits for this Trailhead Original",)


class OriginalAcquisitionConflictError(ValueError):
    pass


class FeaturedTripPackUnavailableError(ValueError):
    pass


class FeaturedOriginalUnavailableError(FeaturedTripPackUnavailableError):
    pass


class MonthlyTripPackClaimUsedError(ValueError):
    def __init__(self, period_month: str):
        self.period_month = period_month
        super().__init__("This month's featured trip pack has already been claimed")


class MonthlyOriginalClaimUsedError(MonthlyTripPackClaimUsedError):
    def __init__(self, period_month: str):
        super().__init__(period_month)
        self.args = ("This month's featured Trailhead experience has already been claimed",)


class ExplorerTripPackClaimRequiredError(ValueError):
    pass


class ExplorerOriginalClaimRequiredError(ExplorerTripPackClaimRequiredError):
    pass


class OriginalManifestAccessError(PermissionError):
    pass


class OriginalFeedbackTokenError(PermissionError):
    pass


class OriginalFeedbackConflictError(ValueError):
    pass


class OriginalFeedbackRateLimitError(ValueError):
    pass


def _utc_month(ts: int | None = None) -> str:
    return time.strftime("%Y-%m", time.gmtime(ts or int(time.time())))


def _validate_trip_pack_month(period_month: str) -> str:
    clean = str(period_month or "").strip()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", clean):
        raise ValueError("period_month must use YYYY-MM")
    return clean


def _decode_pack_json(value: object, fallback):
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value or ""))
    except Exception:
        return fallback


def _stable_trip_pack_template(pack_id: str, template: dict) -> tuple[dict, str]:
    template_copy, _ = _json_object(template, "Trip pack template", 2 * 1024 * 1024)
    template_id = f"pack_template_{pack_id}"[:240]
    template_copy.update({
        "schema_version": 2,
        "trip_id": template_id,
        "status": "draft",
        "visibility": "private",
    })
    normalized, _ = _normalize_trip_document(template_copy, template_id)
    items = normalized.get("items") or []
    if not isinstance(items, list):
        raise ValueError("Trip pack items must be a list")
    seen_ids: set[str] = set()
    stable_items: list[dict] = []
    for index, raw_item in enumerate(items):
        if not isinstance(raw_item, dict):
            raise ValueError("Every trip pack item must be an object")
        item = dict(raw_item)
        item_id = str(item.get("id") or "").strip()
        if not item_id:
            identity = str(
                item.get("canonical_id") or item.get("entity_id")
                or index
            )
            digest = hashlib.sha256(f"{pack_id}:{index}:{identity}".encode("utf-8")).hexdigest()[:20]
            item_id = f"packitem_{digest}"
        if not _CANONICAL_ID_RE.fullmatch(item_id):
            raise ValueError("Trip pack item ids must be stable identifiers")
        if item_id in seen_ids:
            raise ValueError("Trip pack item ids must be unique")
        seen_ids.add(item_id)
        item["id"] = item_id
        stable_items.append(item)
    normalized["items"] = stable_items
    # Provenance is injected only when the server clones an acquired Original.
    normalized.pop("experience_ref", None)
    normalized, template_json = _json_object(normalized, "Trip pack template", 2 * 1024 * 1024)
    return normalized, template_json


def _original_number(
    value: object,
    label: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{label} must be finite")
    if minimum is not None and number < minimum:
        raise ValueError(f"{label} must be at least {minimum:g}")
    if maximum is not None and number > maximum:
        raise ValueError(f"{label} must be at most {maximum:g}")
    return number


ORIGINAL_ASSET_KINDS = {"narration", "image", "transcript", "route", "other"}


def _original_asset_mime_allowed(kind: str, mime_type: str) -> bool:
    if kind == "narration":
        return mime_type in {"audio/wav", "audio/mpeg"}
    if kind == "image":
        return mime_type == "image/png"
    if kind == "transcript":
        return mime_type in {"text/plain", "application/json", "application/x-subrip"}
    if kind == "route":
        return mime_type in {"application/json", "application/geo+json", "application/octet-stream"}
    if kind == "other":
        return mime_type in {"application/octet-stream", "application/pdf", "application/zip"}
    return False


def original_transcript_sha256(transcript: object) -> str:
    normalized = " ".join(str(transcript or "").split())
    if not normalized:
        raise ValueError("Original narration transcript is required")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _probe_original_mp3(data: bytes) -> dict:
    offset = 0
    if data.startswith(b"ID3"):
        if len(data) < 10 or any(byte & 0x80 for byte in data[6:10]):
            raise ValueError("Original narration MP3 has an invalid ID3 header")
        tag_size = sum(data[6 + index] << (21 - 7 * index) for index in range(4))
        offset = 10 + tag_size + (10 if data[5] & 0x10 else 0)
    bitrate_v1_l3 = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)
    bitrate_v2_l3 = (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0)
    sample_rates = (44100, 48000, 32000)
    frames = 0
    duration_s = 0.0
    sample_rate = 0
    while offset + 4 <= len(data):
        if data[offset:offset + 3] == b"TAG" and len(data) - offset == 128:
            offset = len(data)
            break
        header = int.from_bytes(data[offset:offset + 4], "big")
        if (header >> 21) & 0x7FF != 0x7FF:
            break
        version_bits = (header >> 19) & 0x3
        layer_bits = (header >> 17) & 0x3
        bitrate_index = (header >> 12) & 0xF
        sample_index = (header >> 10) & 0x3
        padding = (header >> 9) & 0x1
        if version_bits == 1 or layer_bits != 1 or sample_index == 3:
            break
        mpeg1 = version_bits == 3
        bitrate_kbps = (bitrate_v1_l3 if mpeg1 else bitrate_v2_l3)[bitrate_index]
        if not bitrate_kbps:
            break
        sample_rate = sample_rates[sample_index]
        if version_bits == 2:
            sample_rate //= 2
        elif version_bits == 0:
            sample_rate //= 4
        frame_length = int(
            ((144000 if mpeg1 else 72000) * bitrate_kbps) / sample_rate + padding
        )
        if frame_length < 4 or offset + frame_length > len(data):
            break
        duration_s += (1152 if mpeg1 else 576) / sample_rate
        frames += 1
        offset += frame_length
    trailing = data[offset:]
    if frames < 2 or duration_s < 0.05 or (trailing and any(byte != 0 for byte in trailing)):
        raise ValueError("Original narration is not a decodable MP3 stream")
    return {"format": "mp3", "duration_s": round(duration_s, 3), "sample_rate_hz": sample_rate}


def _probe_original_png(data: bytes) -> dict:
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Original artwork is not a valid PNG")
    offset = 8
    width = height = 0
    bit_depth = color_type = compression = filter_method = interlace = -1
    compressed = bytearray()
    saw_idat = saw_iend = False
    while offset + 12 <= len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        chunk_type = data[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(data):
            break
        chunk_data = data[offset + 8:offset + 8 + length]
        expected_crc = struct.unpack(">I", data[offset + 8 + length:end])[0]
        if zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF != expected_crc:
            raise ValueError("Original artwork PNG failed CRC validation")
        if chunk_type == b"IHDR":
            if length != 13:
                raise ValueError("Original artwork PNG has an invalid header")
            width, height = struct.unpack(">II", chunk_data[:8])
            bit_depth, color_type, compression, filter_method, interlace = chunk_data[8:13]
        elif chunk_type == b"IDAT":
            saw_idat = True
            compressed.extend(chunk_data)
        elif chunk_type == b"IEND":
            saw_iend = True
            offset = end
            break
        offset = end
    if not saw_iend or not saw_idat or width < 1 or height < 1 or offset != len(data):
        raise ValueError("Original artwork PNG is incomplete")
    if width > 8192 or height > 8192 or width * height > 32_000_000:
        raise ValueError("Original artwork PNG dimensions are unsafe")
    bytes_per_pixel = {0: 1, 2: 3, 6: 4}.get(color_type)
    if bit_depth != 8 or bytes_per_pixel is None or compression != 0 or filter_method != 0 or interlace != 0:
        raise ValueError("Original artwork PNG format is not supported")
    row_size = 1 + width * bytes_per_pixel
    expected_decoded_bytes = row_size * height
    try:
        decompressor = zlib.decompressobj()
        decoded = decompressor.decompress(bytes(compressed), expected_decoded_bytes + 1)
    except zlib.error as exc:
        raise ValueError("Original artwork PNG pixels could not be decoded") from exc
    if (
        not decompressor.eof
        or decompressor.unconsumed_tail
        or decompressor.unused_data
        or len(decoded) != expected_decoded_bytes
        or any(decoded[row * row_size] > 4 for row in range(height))
    ):
        raise ValueError("Original artwork PNG pixel data is invalid")
    return {"format": "png", "width": width, "height": height}


def _probe_original_jpeg(data: bytes) -> dict:
    if not (data.startswith(b"\xff\xd8") and data.endswith(b"\xff\xd9")):
        raise ValueError("Original artwork is not a complete JPEG")
    offset = 2
    width = height = 0
    while offset + 4 <= len(data):
        if data[offset] != 0xFF:
            raise ValueError("Original artwork JPEG marker is invalid")
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        marker = data[offset]
        offset += 1
        if marker in {0xD8, 0xD9}:
            continue
        if marker == 0xDA:
            break
        if offset + 2 > len(data):
            break
        length = int.from_bytes(data[offset:offset + 2], "big")
        if length < 2 or offset + length > len(data):
            break
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            if length < 7:
                break
            height = int.from_bytes(data[offset + 3:offset + 5], "big")
            width = int.from_bytes(data[offset + 5:offset + 7], "big")
        offset += length
    if width < 1 or height < 1:
        raise ValueError("Original artwork JPEG dimensions are unavailable")
    return {"format": "jpeg", "width": width, "height": height}


def _probe_original_asset_file(path: _Path, kind: str, mime_type: str) -> dict:
    if kind not in {"narration", "image"}:
        return {}
    data = path.read_bytes()
    if kind == "narration" and mime_type == "audio/wav":
        try:
            with wave.open(io.BytesIO(data), "rb") as audio:
                frames = audio.getnframes()
                sample_rate = audio.getframerate()
                channels = audio.getnchannels()
                sample_width = audio.getsampwidth()
                decoded_frames = audio.readframes(frames)
        except (EOFError, wave.Error) as exc:
            raise ValueError("Original narration is not a decodable WAV stream") from exc
        if frames < 1 or sample_rate < 1000 or channels not in {1, 2} or sample_width not in {1, 2, 3, 4}:
            raise ValueError("Original narration WAV format is invalid")
        if len(decoded_frames) != frames * channels * sample_width:
            raise ValueError("Original narration WAV audio data is incomplete")
        return {
            "format": "wav",
            "duration_s": round(frames / sample_rate, 3),
            "sample_rate_hz": sample_rate,
            "channels": channels,
        }
    if kind == "narration" and mime_type == "audio/mpeg":
        return _probe_original_mp3(data)
    if kind == "image" and mime_type == "image/png":
        return _probe_original_png(data)
    raise ValueError("Original asset format is not supported")


def _original_asset_public_path(pack_id: str, asset_id: str, sha256: str) -> str:
    return f"/api/original-assets/{pack_id}/{asset_id}/{sha256}"


def _original_asset_admin_immutable_path(
    pack_id: str,
    asset_id: str,
    sha256: str,
) -> str:
    return (
        f"/api/admin/originals/{_url_quote(pack_id, safe='')}/assets/"
        f"{_url_quote(asset_id, safe='')}/{sha256}/content"
    )


def _sha256_file(path: _Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


_ORIGINAL_ASSET_INTEGRITY_CACHE: dict[tuple[str, int, int, str], bool] = {}


def _original_asset_file_verified(raw: dict, *, force_hash: bool = False) -> bool:
    path = _Path(raw["storage_path"])
    if not path.is_file():
        return False
    stat = path.stat()
    expected_size = int(raw["byte_count"])
    if stat.st_size != expected_size:
        return False
    key = (str(path), stat.st_size, stat.st_mtime_ns, str(raw["sha256"]))
    if not force_hash and _ORIGINAL_ASSET_INTEGRITY_CACHE.get(key):
        return True
    verified = _sha256_file(path) == raw["sha256"]
    if verified:
        if len(_ORIGINAL_ASSET_INTEGRITY_CACHE) >= 2048:
            _ORIGINAL_ASSET_INTEGRITY_CACHE.clear()
        _ORIGINAL_ASSET_INTEGRITY_CACHE[key] = True
    return verified


def save_authored_original_asset_record(
    pack_id: str,
    asset_id: str,
    kind: str,
    mime_type: str,
    storage_path: str,
    byte_count: int,
    sha256: str,
    admin_user_id: int,
    transcript_sha256: str | None = None,
    generator_metadata: dict | None = None,
) -> dict:
    """Record an uploaded asset only after independently verifying its file bytes."""
    pack_id = _validate_canonical_id(pack_id, "Original id")
    asset_id = _validate_canonical_id(asset_id, "Original asset id")
    kind = str(kind or "").strip().lower()
    if kind not in ORIGINAL_ASSET_KINDS:
        raise ValueError("Original asset kind is invalid")
    mime_type = str(mime_type or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9.+-]{0,79}/[a-z0-9][a-z0-9.+-]{0,79}", mime_type):
        raise ValueError("Original asset MIME type is invalid")
    if not _original_asset_mime_allowed(kind, mime_type):
        raise ValueError("Original asset MIME type is not allowed for its content kind")
    if isinstance(byte_count, bool) or not isinstance(byte_count, int) or byte_count <= 0:
        raise ValueError("Original asset bytes must be a positive integer")
    sha256 = str(sha256 or "").strip().lower()
    if not re.fullmatch(r"[a-f0-9]{64}", sha256):
        raise ValueError("Original asset sha256 is invalid")
    path = _Path(str(storage_path or "")).expanduser().resolve()
    if not path.is_file():
        raise ValueError("Original asset upload is not present on the server")
    if path.stat().st_size != byte_count or _sha256_file(path) != sha256:
        raise ValueError("Original asset upload failed server integrity verification")
    media_metadata = _probe_original_asset_file(path, kind, mime_type)
    media_metadata, media_metadata_json = _json_object(
        media_metadata, "Original media metadata", 32 * 1024,
    )
    if kind == "narration":
        transcript_sha256 = str(transcript_sha256 or "").strip().lower()
        if not re.fullmatch(r"[a-f0-9]{64}", transcript_sha256):
            raise ValueError("Original narration must be bound to a reviewed transcript")
    elif transcript_sha256 is not None:
        raise ValueError("Only Original narration assets may carry a transcript binding")
    generator_metadata, generator_metadata_json = _json_object(
        generator_metadata or {}, "Original asset generator metadata", 32 * 1024,
    )
    public_path = _original_asset_public_path(pack_id, asset_id, sha256)
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        pack = db.execute(
            "SELECT 1 FROM authored_trip_packs WHERE id=? AND content_kind='original_drive'",
            (pack_id,),
        ).fetchone()
        if not pack:
            raise ValueError("Trailhead Original not found")
        existing = db.execute(
            """SELECT * FROM authored_original_assets
               WHERE pack_id=? AND asset_id=? AND sha256=?""",
            (pack_id, asset_id, sha256),
        ).fetchone()
        if existing and (
            existing["kind"] != kind
            or existing["mime_type"] != mime_type
            or int(existing["byte_count"]) != byte_count
            or existing["public_path"] != public_path
            or existing["media_metadata_json"] != media_metadata_json
            or existing["transcript_sha256"] != transcript_sha256
            or existing["generator_metadata_json"] != generator_metadata_json
        ):
            raise ValueError("Original content-addressed asset metadata is immutable")
        db.execute(
            "UPDATE authored_original_assets SET is_current=0,updated_at=? WHERE pack_id=? AND asset_id=?",
            (now, pack_id, asset_id),
        )
        if existing:
            db.execute(
                """UPDATE authored_original_assets
                   SET storage_path=?,is_current=1,uploaded_by=?,updated_at=?
                   WHERE pack_id=? AND asset_id=? AND sha256=?""",
                (str(path), admin_user_id, now, pack_id, asset_id, sha256),
            )
        else:
            db.execute(
                """INSERT INTO authored_original_assets
                   (pack_id,asset_id,sha256,kind,mime_type,byte_count,public_path,
                    storage_path,media_metadata_json,transcript_sha256,
                    generator_metadata_json,is_current,uploaded_by,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)""",
                (
                    pack_id, asset_id, sha256, kind, mime_type, byte_count, public_path,
                    str(path), media_metadata_json, transcript_sha256, generator_metadata_json,
                    admin_user_id, now, now,
                ),
            )
        row = db.execute(
            "SELECT * FROM authored_original_assets WHERE pack_id=? AND asset_id=? AND sha256=?",
            (pack_id, asset_id, sha256),
        ).fetchone()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return _public_original_asset_record(row)


def attest_authored_original_generator_license(
    pack_id: str,
    asset_id: str,
    *,
    terms_id: str,
    terms_url: str,
    terms_version: str,
    reviewed_at: str,
    admin_user_id: int,
) -> dict:
    """Attach a server-owned admin attestation to the current generated narration."""
    pack_id = _validate_canonical_id(pack_id, "Original id")
    asset_id = _validate_canonical_id(asset_id, "Original asset id")
    clean_terms_id = str(terms_id or "").strip()
    clean_terms_url = str(terms_url or "").strip()
    clean_terms_version = str(terms_version or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{3,200}", clean_terms_id):
        raise ValueError("Original narration license terms id is invalid")
    if not clean_terms_url.startswith("https://") or len(clean_terms_url) > 2000:
        raise ValueError("Original narration license terms URL must use HTTPS")
    if not clean_terms_version or len(clean_terms_version) > 120:
        raise ValueError("Original narration license terms version is required")
    normalized_reviewed_at = _normalize_original_citation_review_date(reviewed_at)
    if not normalized_reviewed_at:
        raise ValueError("Original narration license reviewed_at is required")
    attested_at = _datetime.now(_timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        admin = db.execute(
            "SELECT is_admin FROM users WHERE id=?", (admin_user_id,),
        ).fetchone()
        if not admin or not bool(admin["is_admin"]):
            raise PermissionError("Original narration license attestation requires an admin")
        row = db.execute(
            """SELECT * FROM authored_original_assets
               WHERE pack_id=? AND asset_id=? AND is_current=1""",
            (pack_id, asset_id),
        ).fetchone()
        if not row:
            raise ValueError("Original narration asset not found")
        if row["kind"] != "narration":
            raise ValueError("Only generated Original narration can carry a license attestation")
        metadata = _decode_pack_json(row["generator_metadata_json"], {})
        if not isinstance(metadata, dict) or not str(metadata.get("provider") or "").strip():
            raise ValueError("Original narration has no generator provenance to attest")
        metadata["license_status"] = "attested"
        metadata["license_attestation"] = {
            "terms_id": clean_terms_id,
            "terms_url": clean_terms_url,
            "terms_version": clean_terms_version,
            "reviewed_at": normalized_reviewed_at,
            "attested_at": attested_at,
            "attested_by_admin_user_id": int(admin_user_id),
        }
        if not _original_generator_license_attestation_complete(metadata):
            raise ValueError("Original narration license attestation is incomplete")
        metadata_json = json.dumps(metadata, separators=(",", ":"), sort_keys=True)
        db.execute(
            """UPDATE authored_original_assets SET generator_metadata_json=?,updated_at=?
               WHERE pack_id=? AND asset_id=? AND sha256=?""",
            (metadata_json, int(time.time()), pack_id, asset_id, row["sha256"]),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return {
        "pack_id": pack_id,
        "asset_id": asset_id,
        "license_status": "attested",
        "license_attestation": metadata["license_attestation"],
    }


def _public_original_asset_record(row: sqlite3.Row | dict) -> dict:
    raw = dict(row)
    return {
        "pack_id": raw["pack_id"],
        "id": raw["asset_id"],
        "kind": raw["kind"],
        "mime_type": raw["mime_type"],
        "bytes": int(raw["byte_count"]),
        "sha256": raw["sha256"],
        "path": raw["public_path"],
        "current": bool(raw["is_current"]),
        "uploaded_at": int(raw["updated_at"]),
        "media_metadata": _decode_pack_json(raw.get("media_metadata_json"), {}),
        "transcript_sha256": raw.get("transcript_sha256"),
        "generator_metadata": _decode_pack_json(raw.get("generator_metadata_json"), {}),
    }


def list_authored_original_asset_records(pack_id: str, current_only: bool = True) -> list[dict]:
    pack_id = _validate_canonical_id(pack_id, "Original id")
    db = _conn()
    sql = "SELECT * FROM authored_original_assets WHERE pack_id=?"
    if current_only:
        sql += " AND is_current=1"
    sql += " ORDER BY asset_id,updated_at DESC"
    rows = db.execute(sql, (pack_id,)).fetchall()
    db.close()
    return [_public_original_asset_record(row) for row in rows]


def get_authored_original_asset_record_admin(pack_id: str, asset_id: str) -> dict | None:
    pack_id = _validate_canonical_id(pack_id, "Original id")
    asset_id = _validate_canonical_id(asset_id, "Original asset id")
    db = _conn()
    row = db.execute(
        """SELECT * FROM authored_original_assets
           WHERE pack_id=? AND asset_id=? AND is_current=1""",
        (pack_id, asset_id),
    ).fetchone()
    db.close()
    if not row:
        return None
    raw = dict(row)
    if not _original_asset_file_verified(raw):
        raise ValueError("Original asset failed integrity verification")
    return raw


def get_authored_original_asset_record_admin_by_sha256(
    pack_id: str,
    asset_id: str,
    sha256: str,
) -> dict | None:
    """Return an immutable admin asset revision after re-verifying its bytes."""
    pack_id = _validate_canonical_id(pack_id, "Original id")
    asset_id = _validate_canonical_id(asset_id, "Original asset id")
    sha256 = str(sha256 or "").strip().lower()
    if not re.fullmatch(r"[a-f0-9]{64}", sha256):
        raise ValueError("Original asset sha256 is invalid")
    db = _conn()
    row = db.execute(
        """SELECT * FROM authored_original_assets
           WHERE pack_id=? AND asset_id=? AND sha256=?""",
        (pack_id, asset_id, sha256),
    ).fetchone()
    db.close()
    if not row:
        return None
    raw = dict(row)
    if not _original_asset_file_verified(raw, force_hash=True):
        raise ValueError("Original asset failed integrity verification")
    return raw


def _verified_original_asset_map_db(db: sqlite3.Connection, pack_id: str) -> dict[str, dict]:
    rows = db.execute(
        "SELECT * FROM authored_original_assets WHERE pack_id=? AND is_current=1",
        (pack_id,),
    ).fetchall()
    verified: dict[str, dict] = {}
    for row in rows:
        raw = dict(row)
        if not _original_asset_file_verified(raw, force_hash=True):
            continue
        verified[raw["asset_id"]] = raw
    return verified


def _normalize_original_review_timestamp(value: object, label: str) -> str | None:
    if value is None or value == "":
        return None
    raw = str(value).strip()
    if "T" not in raw or not re.search(r"(?:Z|[+-]\d{2}:\d{2})$", raw):
        raise ValueError(f"{label} must be an ISO 8601 date-time with timezone")
    try:
        parsed = _datetime.fromisoformat(raw[:-1] + "+00:00" if raw.endswith("Z") else raw)
    except ValueError as exc:
        raise ValueError(f"{label} must be a valid ISO 8601 date-time") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{label} must include a timezone")
    parsed = parsed.astimezone(_timezone.utc)
    now = _datetime.now(_timezone.utc)
    if parsed.year < 2000 or parsed > now + _timedelta(minutes=5):
        raise ValueError(f"{label} is outside the accepted review window")
    return parsed.isoformat(timespec="seconds").replace("+00:00", "Z")


def _normalize_original_citation_review_date(value: object) -> str | None:
    if value is None or value == "":
        return None
    raw = str(value).strip()
    try:
        if "T" in raw:
            normalized = _normalize_original_review_timestamp(raw, "Original citation reviewed_at")
            return normalized
        parsed = _date.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError("Original citation reviewed_at must be a valid ISO date or date-time") from exc
    if parsed.year < 2000 or parsed > _datetime.now(_timezone.utc).date():
        raise ValueError("Original citation reviewed_at is outside the accepted review window")
    return parsed.isoformat()


def _original_haversine_m(a: list[float], b: list[float]) -> float:
    lng1, lat1 = map(math.radians, a)
    lng2, lat2 = map(math.radians, b)
    delta_lat = lat2 - lat1
    delta_lng = lng2 - lng1
    hav = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(min(1.0, math.sqrt(hav)))


def _original_route_cumulative_m(coordinates: list[list[float]]) -> list[float]:
    cumulative = [0.0]
    for start, end in zip(coordinates, coordinates[1:]):
        cumulative.append(cumulative[-1] + _original_haversine_m(start, end))
    return cumulative


def _original_project_to_segment(
    point: dict,
    start: list[float],
    end: list[float],
) -> tuple[float, float]:
    """Return distance to and fraction along a route segment."""
    radius = 6_371_000.0
    mean_lat = math.radians((float(start[1]) + float(end[1]) + float(point["lat"])) / 3)

    def local_xy(lng: float, lat: float) -> tuple[float, float]:
        return (
            math.radians(lng - float(point["lng"])) * radius * math.cos(mean_lat),
            math.radians(lat - float(point["lat"])) * radius,
        )

    start_x, start_y = local_xy(float(start[0]), float(start[1]))
    end_x, end_y = local_xy(float(end[0]), float(end[1]))
    delta_x = end_x - start_x
    delta_y = end_y - start_y
    length_squared = delta_x * delta_x + delta_y * delta_y
    if length_squared <= 0:
        return math.hypot(start_x, start_y), 0.0
    fraction = max(0.0, min(1.0, -(start_x * delta_x + start_y * delta_y) / length_squared))
    projected_x = start_x + fraction * delta_x
    projected_y = start_y + fraction * delta_y
    return math.hypot(projected_x, projected_y), fraction


_ORIGINAL_UNRESOLVED_COPY_RE = re.compile(
    r"\b(?:draft|placeholder|fixture|tbd|todo)\b"
    r"|\bnot\s+approved\b|\bmust\s+not\s+be\s+published\b"
    r"|\bsource[ _-]?review[ _-]?required\b|\breplace\s+with\b",
    re.IGNORECASE,
)


def _original_unresolved_copy_path(value: object, path: str = "content") -> str | None:
    if isinstance(value, str):
        return path if _ORIGINAL_UNRESOLVED_COPY_RE.search(value) else None
    if isinstance(value, dict):
        for raw_key, child in value.items():
            key = str(raw_key)
            if key in {"id", "pack_id", "trip_id", "manifest_id", "sha256", "path", "url", "mime_type"}:
                continue
            found = _original_unresolved_copy_path(child, f"{path}.{key}")
            if found:
                return found
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found = _original_unresolved_copy_path(child, f"{path}[{index}]")
            if found:
                return found
    return None


def _normalize_original_manifest(
    pack_id: str,
    title: str,
    manifest: dict,
    *,
    version: int | None = None,
    publishing: bool = False,
    verified_assets: dict[str, dict] | None = None,
) -> tuple[dict, str]:
    """Validate and canonicalize the immutable offline contract for an Original."""
    normalized, _ = _json_object(manifest, "Original manifest", 4 * 1024 * 1024)
    if int(normalized.get("schema_version") or 0) != 1:
        raise ValueError("Original manifest schema_version must be 1")
    locale = str(normalized.get("locale") or "en-US").strip()
    if not re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?", locale):
        raise ValueError("Original manifest locale is invalid")

    route = normalized.get("route")
    if not isinstance(route, dict):
        raise ValueError("Original manifest route is required")
    profile = str(route.get("profile") or "").strip().lower()
    if profile != "driving":
        raise ValueError("Original route profile must be driving")
    direction = str(route.get("direction") or "").strip().lower()
    if direction not in {"one_way", "loop"}:
        raise ValueError("Original route direction must be one_way or loop")
    geometry = route.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
        raise ValueError("Original route geometry must be a GeoJSON LineString")
    raw_coordinates = geometry.get("coordinates")
    if not isinstance(raw_coordinates, list) or not 2 <= len(raw_coordinates) <= 20000:
        raise ValueError("Original route needs between 2 and 20000 coordinates")
    coordinates: list[list[float]] = []
    for index, coordinate in enumerate(raw_coordinates):
        if not isinstance(coordinate, (list, tuple)) or len(coordinate) != 2:
            raise ValueError(f"Original route coordinate {index + 1} must be [lng, lat]")
        lng = _original_number(coordinate[0], "Original route longitude", minimum=-180, maximum=180)
        lat = _original_number(coordinate[1], "Original route latitude", minimum=-90, maximum=90)
        coordinates.append([lng, lat])
    distance_m = _original_number(route.get("distance_m"), "Original route distance_m", minimum=1)
    duration_s = _original_number(route.get("duration_s"), "Original route duration_s", minimum=1)
    bounds = route.get("bounds")
    if not isinstance(bounds, dict):
        raise ValueError("Original route bounds are required")
    clean_bounds = {
        "north": _original_number(bounds.get("north"), "Original route north", minimum=-90, maximum=90),
        "south": _original_number(bounds.get("south"), "Original route south", minimum=-90, maximum=90),
        "east": _original_number(bounds.get("east"), "Original route east", minimum=-180, maximum=180),
        "west": _original_number(bounds.get("west"), "Original route west", minimum=-180, maximum=180),
    }
    if clean_bounds["north"] < clean_bounds["south"] or clean_bounds["east"] < clean_bounds["west"]:
        raise ValueError("Original route bounds are invalid")
    if any(
        lat < clean_bounds["south"] or lat > clean_bounds["north"]
        or lng < clean_bounds["west"] or lng > clean_bounds["east"]
        for lng, lat in coordinates
    ):
        raise ValueError("Original route bounds must contain the route geometry")
    clean_route = {
        "profile": profile,
        "direction": direction,
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "bounds": clean_bounds,
        "distance_m": distance_m,
        "duration_s": duration_s,
    }

    raw_assets = normalized.get("assets")
    if not isinstance(raw_assets, list) or len(raw_assets) > 500:
        raise ValueError("Original assets must be a list with at most 500 entries")
    assets: list[dict] = []
    assets_by_id: dict[str, dict] = {}
    for raw_asset in raw_assets:
        if not isinstance(raw_asset, dict):
            raise ValueError("Every Original asset must be an object")
        asset_id = _validate_canonical_id(raw_asset.get("id"), "Original asset id")
        if asset_id in assets_by_id:
            raise ValueError("Original asset ids must be unique")
        kind = str(raw_asset.get("kind") or "").strip().lower()
        if kind not in ORIGINAL_ASSET_KINDS:
            raise ValueError("Original asset kind is invalid")
        path = str(raw_asset.get("path") or "").strip()
        mime_type = str(raw_asset.get("mime_type") or "").strip().lower()
        if not path or not mime_type:
            raise ValueError("Original asset path and MIME type are required")
        byte_count = raw_asset.get("bytes")
        if isinstance(byte_count, bool) or not isinstance(byte_count, int) or byte_count < 0:
            raise ValueError("Original asset bytes must be a non-negative integer")
        sha256 = str(raw_asset.get("sha256") or "").strip().lower()
        if not re.fullmatch(r"[a-f0-9]{64}", sha256):
            raise ValueError("Original asset sha256 must be 64 lowercase hex characters")
        asset = {
            "id": asset_id,
            "kind": kind,
            "path": path,
            "mime_type": mime_type,
            "bytes": byte_count,
            "sha256": sha256,
        }
        assets.append(asset)
        assets_by_id[asset_id] = asset

    raw_stops = normalized.get("stops")
    if not isinstance(raw_stops, list) or not 1 <= len(raw_stops) <= 100:
        raise ValueError("Original manifest needs between 1 and 100 story stops")
    stops: list[dict] = []
    stop_ids: set[str] = set()
    for raw_stop in raw_stops:
        if not isinstance(raw_stop, dict):
            raise ValueError("Every Original stop must be an object")
        stop_id = _validate_canonical_id(raw_stop.get("id"), "Original stop id")
        if stop_id in stop_ids:
            raise ValueError("Original stop ids must be unique")
        stop_ids.add(stop_id)
        sequence = raw_stop.get("sequence")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1:
            raise ValueError("Original stop sequence must be a positive integer")
        stop_title = re.sub(r"\s+", " ", str(raw_stop.get("title") or "")).strip()
        if not stop_title or len(stop_title) > 200:
            raise ValueError("Original stop title must be between 1 and 200 characters")
        point = raw_stop.get("coordinates")
        if not isinstance(point, dict):
            raise ValueError("Original stop coordinates are required")
        clean_point = {
            "lat": _original_number(point.get("lat"), "Original stop latitude", minimum=-90, maximum=90),
            "lng": _original_number(point.get("lng"), "Original stop longitude", minimum=-180, maximum=180),
        }
        transcript = str(raw_stop.get("transcript") or "").strip()
        if not transcript or len(transcript) > 20000:
            raise ValueError("Original stop transcript is required and must be under 20000 characters")
        audio_asset_id = _validate_canonical_id(raw_stop.get("audio_asset_id"), "Original narration asset id")
        audio_duration_s = _original_number(
            raw_stop.get("audio_duration_s"), "Original narration duration", minimum=1, maximum=3600,
        )
        trigger = raw_stop.get("trigger")
        if not isinstance(trigger, dict):
            raise ValueError("Original stop trigger is required")
        enter_radius_m = _original_number(
            trigger.get("enter_radius_m"), "Original trigger enter radius", minimum=50, maximum=1000,
        )
        exit_radius_m = _original_number(
            trigger.get("exit_radius_m"), "Original trigger exit radius", minimum=enter_radius_m,
        )
        minimum_exit = max(enter_radius_m * 1.5, enter_radius_m + 50)
        if exit_radius_m < minimum_exit:
            raise ValueError("Original trigger exit radius must provide route hysteresis")
        start_m = _original_number(
            trigger.get("route_progress_start_m"), "Original trigger progress start", minimum=0,
        )
        end_m = _original_number(
            trigger.get("route_progress_end_m"), "Original trigger progress end", minimum=start_m,
        )
        if end_m > distance_m:
            raise ValueError("Original trigger progress window cannot exceed route distance")
        clean_trigger = {
            "enter_radius_m": enter_radius_m,
            "exit_radius_m": exit_radius_m,
            "lead_time_s": _original_number(
                trigger.get("lead_time_s", 0), "Original trigger lead time", minimum=0, maximum=120,
            ),
            "route_progress_start_m": start_m,
            "route_progress_end_m": end_m,
        }
        bearing = trigger.get("approach_bearing_deg")
        tolerance = trigger.get("bearing_tolerance_deg")
        if bearing is not None:
            clean_bearing = _original_number(
                bearing, "Original trigger approach bearing", minimum=0,
            )
            if clean_bearing >= 360:
                raise ValueError("Original trigger approach bearing must be less than 360")
            clean_trigger["approach_bearing_deg"] = clean_bearing
            clean_trigger["bearing_tolerance_deg"] = _original_number(
                tolerance if tolerance is not None else 45,
                "Original trigger bearing tolerance", minimum=1, maximum=180,
            )
        elif tolerance is not None:
            raise ValueError("Original trigger bearing tolerance requires an approach bearing")
        raw_citations = raw_stop.get("citations")
        if not isinstance(raw_citations, list) or not raw_citations:
            raise ValueError("Every Original stop needs at least one source citation")
        citations: list[dict] = []
        for raw_citation in raw_citations:
            if not isinstance(raw_citation, dict):
                raise ValueError("Original citations must be objects")
            citation_title = re.sub(r"\s+", " ", str(raw_citation.get("title") or "")).strip()
            citation_url = str(raw_citation.get("url") or "").strip()
            if not citation_title or not re.match(r"^https://", citation_url, re.IGNORECASE):
                raise ValueError("Original citations need a title and HTTPS URL")
            citation = {"title": citation_title, "url": citation_url}
            publisher = str(raw_citation.get("publisher") or "").strip()
            if publisher:
                citation["publisher"] = publisher
            citation_reviewed_at = _normalize_original_citation_review_date(
                raw_citation.get("reviewed_at")
            )
            if citation_reviewed_at:
                citation["reviewed_at"] = citation_reviewed_at
            role = str(raw_citation.get("role") or "story").strip().lower()
            if role not in {"story", "operational"}:
                raise ValueError("Original citation role must be story or operational")
            citation["role"] = role
            authority = str(raw_citation.get("authority") or "").strip().lower()
            if authority:
                if authority not in {"official", "authoritative"}:
                    raise ValueError("Original citation authority must be official or authoritative")
                citation["authority"] = authority
            raw_scope = raw_citation.get("scope", [])
            if raw_scope is None:
                raw_scope = []
            if not isinstance(raw_scope, list) or len(raw_scope) > 20:
                raise ValueError("Original citation scope must be a list with at most 20 entries")
            scope: list[str] = []
            for raw_value in raw_scope:
                value = re.sub(r"[^a-z0-9_]+", "_", str(raw_value or "").strip().lower()).strip("_")
                if not value or len(value) > 80:
                    raise ValueError("Original citation scope entries must be short identifiers")
                if value not in scope:
                    scope.append(value)
            citation["scope"] = scope
            citations.append(citation)
        stop = {
            "id": stop_id,
            "sequence": sequence,
            "title": stop_title,
            "coordinates": clean_point,
            "transcript": transcript,
            "audio_asset_id": audio_asset_id,
            "audio_duration_s": audio_duration_s,
            "trigger": clean_trigger,
            "citations": citations,
        }
        for key in ("explore_place_id", "artwork_asset_id"):
            value = raw_stop.get(key)
            if value:
                stop[key] = _validate_canonical_id(value, f"Original stop {key}")
        stops.append(stop)
    stops.sort(key=lambda item: item["sequence"])
    if [stop["sequence"] for stop in stops] != list(range(1, len(stops) + 1)):
        raise ValueError("Original stop sequence must be contiguous starting at 1")
    if any(
        stop["coordinates"]["lat"] < clean_bounds["south"]
        or stop["coordinates"]["lat"] > clean_bounds["north"]
        or stop["coordinates"]["lng"] < clean_bounds["west"]
        or stop["coordinates"]["lng"] > clean_bounds["east"]
        for stop in stops
    ):
        raise ValueError("Original route bounds must contain every story stop")
    if publishing:
        cumulative_m = _original_route_cumulative_m(coordinates)
        geometry_distance_m = cumulative_m[-1]
        distance_tolerance_m = max(500.0, geometry_distance_m * 0.10)
        if abs(distance_m - geometry_distance_m) > distance_tolerance_m:
            raise ValueError("Original route distance must match the authored route geometry")
        average_speed_kph = distance_m / duration_s * 3.6
        if duration_s < 15 * 60 or duration_s > 24 * 3600 or not 3 <= average_speed_kph <= 130:
            raise ValueError("Original route duration must be plausible for the authored driving distance")
        window_starts = [stop["trigger"]["route_progress_start_m"] for stop in stops]
        if any(current <= previous for previous, current in zip(window_starts, window_starts[1:])):
            raise ValueError("Original story cues must progress monotonically along the route")
        previous_projected_progress: float | None = None
        for stop in stops:
            trigger = stop["trigger"]
            candidates: list[tuple[float, float]] = []
            for segment_index, (start, end) in enumerate(zip(coordinates, coordinates[1:])):
                distance_to_segment, fraction = _original_project_to_segment(
                    stop["coordinates"], start, end,
                )
                segment_progress = (
                    cumulative_m[segment_index]
                    + fraction * (cumulative_m[segment_index + 1] - cumulative_m[segment_index])
                )
                if (
                    trigger["route_progress_start_m"] - 1 <= segment_progress
                    <= trigger["route_progress_end_m"] + 1
                ):
                    candidates.append((distance_to_segment, segment_progress))
            if not candidates:
                raise ValueError(
                    f"Original stop {stop['id']} progress window does not intersect its route projection"
                )
            distance_to_route, projected_progress = min(candidates, key=lambda item: item[0])
            if distance_to_route > trigger["enter_radius_m"]:
                raise ValueError(
                    f"Original stop {stop['id']} is outside its authored trigger radius"
                )
            if (
                previous_projected_progress is not None
                and projected_progress <= previous_projected_progress + 1
            ):
                raise ValueError("Original story cues must progress monotonically along the route")
            previous_projected_progress = projected_progress

    offline_map, _ = _json_object(normalized.get("offline_map"), "Original offline map", 128 * 1024)
    region_id = str(offline_map.get("region_id") or "").strip()
    if not region_id:
        raise ValueError("Original offline map region_id is required")
    offline_bounds = offline_map.get("bounds")
    if not isinstance(offline_bounds, dict):
        raise ValueError("Original offline map bounds are required")
    clean_offline_bounds = {
        "north": _original_number(offline_bounds.get("north"), "Original offline map north", minimum=-90, maximum=90),
        "south": _original_number(offline_bounds.get("south"), "Original offline map south", minimum=-90, maximum=90),
        "east": _original_number(offline_bounds.get("east"), "Original offline map east", minimum=-180, maximum=180),
        "west": _original_number(offline_bounds.get("west"), "Original offline map west", minimum=-180, maximum=180),
    }
    if (
        clean_offline_bounds["north"] < clean_offline_bounds["south"]
        or clean_offline_bounds["east"] < clean_offline_bounds["west"]
    ):
        raise ValueError("Original offline map bounds are invalid")
    if any(
        lat < clean_offline_bounds["south"] or lat > clean_offline_bounds["north"]
        or lng < clean_offline_bounds["west"] or lng > clean_offline_bounds["east"]
        for lng, lat in coordinates
    ) or any(
        stop["coordinates"]["lat"] < clean_offline_bounds["south"]
        or stop["coordinates"]["lat"] > clean_offline_bounds["north"]
        or stop["coordinates"]["lng"] < clean_offline_bounds["west"]
        or stop["coordinates"]["lng"] > clean_offline_bounds["east"]
        for stop in stops
    ):
        raise ValueError("Original offline map bounds must contain the route and every story stop")
    for key in ("min_zoom", "max_zoom", "estimated_bytes"):
        if isinstance(offline_map.get(key), bool) or not isinstance(offline_map.get(key), int):
            raise ValueError(f"Original offline map {key} must be an integer")
    if offline_map["estimated_bytes"] < 0 or offline_map["min_zoom"] < 0 or offline_map["max_zoom"] < offline_map["min_zoom"]:
        raise ValueError("Original offline map settings are invalid")
    offline_map = {
        "region_id": region_id,
        "bounds": clean_offline_bounds,
        "min_zoom": offline_map["min_zoom"],
        "max_zoom": offline_map["max_zoom"],
        "estimated_bytes": offline_map["estimated_bytes"],
    }

    safety, _ = _json_object(normalized.get("safety"), "Original safety", 128 * 1024)
    access, _ = _json_object(normalized.get("access"), "Original access", 128 * 1024)
    season, _ = _json_object(normalized.get("season"), "Original season", 128 * 1024)
    review, _ = _json_object(normalized.get("review"), "Original review", 128 * 1024)
    if not str(safety.get("summary") or "").strip():
        raise ValueError("Original safety summary is required")
    if str(access.get("surface") or "").strip().lower() not in {"paved", "mixed", "unpaved"}:
        raise ValueError("Original access surface must be paved, mixed, or unpaved")
    recommended_months = season.get("recommended_months")
    if not isinstance(recommended_months, list) or not recommended_months:
        raise ValueError("Original recommended months are required")
    if any(isinstance(month, bool) or not isinstance(month, int) or not 1 <= month <= 12 for month in recommended_months):
        raise ValueError("Original recommended months must be integers from 1 through 12")
    if len(set(recommended_months)) != len(recommended_months):
        raise ValueError("Original recommended months must be unique")
    season["recommended_months"] = list(recommended_months)
    field_drive_completed_at = _normalize_original_review_timestamp(
        review.get("field_drive_completed_at"), "Original field_drive_completed_at",
    )
    source_review_completed_at = _normalize_original_review_timestamp(
        review.get("source_review_completed_at"), "Original source_review_completed_at",
    )
    review["field_drive_completed_at"] = field_drive_completed_at
    review["source_review_completed_at"] = source_review_completed_at

    if publishing:
        unresolved_path = _original_unresolved_copy_path({
            "title": title,
            "stops": [{
                "title": stop["title"],
                "transcript": stop["transcript"],
                "citations": stop["citations"],
            } for stop in stops],
            "safety": safety,
            "access": access,
            "season": season,
        }, "manifest")
        if unresolved_path:
            raise ValueError(f"Original publish content is unresolved at {unresolved_path}")
        if review.get("editorial_status") != "approved":
            raise ValueError("Original editorial review must be approved before publishing")
        if not source_review_completed_at:
            raise ValueError("Original source review must be complete before publishing")
        review_now = _datetime.now(_timezone.utc)
        parsed_source_review = _datetime.fromisoformat(source_review_completed_at.replace("Z", "+00:00"))
        if parsed_source_review < review_now - _timedelta(days=ORIGINAL_SOURCE_REVIEW_MAX_AGE_DAYS):
            raise ValueError("Original source review is too old to publish")
        if int(offline_map.get("estimated_bytes") or 0) <= 0:
            raise ValueError("Original offline map package must have a reviewed non-zero size")
        if "placeholder" in region_id.lower() or "draft" in region_id.lower():
            raise ValueError("Original offline map region must be final before publishing")
        verified_assets = verified_assets or {}
        for asset in assets:
            verified = verified_assets.get(asset["id"])
            if not verified:
                raise ValueError(f"Original asset {asset['id']} needs a server-verified upload")
            expected = {
                "kind": verified["kind"],
                "path": verified["public_path"],
                "mime_type": verified["mime_type"],
                "bytes": int(verified["byte_count"]),
                "sha256": verified["sha256"],
            }
            if any(asset[key] != expected[key] for key in expected):
                raise ValueError(f"Original asset {asset['id']} does not match its server-verified upload")
        operational_scopes: set[str] = set()
        for stop in stops:
            if re.search(r"\b(?:placeholder|draft)\b", stop["transcript"], re.IGNORECASE):
                raise ValueError(f"Original stop {stop['id']} still has placeholder script text")
            has_story_source = False
            for citation in stop["citations"]:
                if not citation.get("publisher"):
                    raise ValueError(f"Original stop {stop['id']} citations need an explicit publisher")
                if not citation.get("reviewed_at"):
                    raise ValueError(f"Original stop {stop['id']} citations need a reviewed_at date")
                citation_reviewed_on = _date.fromisoformat(str(citation["reviewed_at"])[:10])
                role = citation.get("role") or "story"
                authority = citation.get("authority")
                if role == "operational":
                    if authority != "official":
                        raise ValueError(f"Original stop {stop['id']} operational citations must be official")
                    if citation_reviewed_on < _date.today() - _timedelta(days=ORIGINAL_OPERATIONAL_SOURCE_MAX_AGE_DAYS):
                        raise ValueError(f"Original stop {stop['id']} operational citation review is too old to publish")
                    operational_scopes.update(citation.get("scope") or [])
                else:
                    if authority not in {"official", "authoritative"}:
                        raise ValueError(f"Original stop {stop['id']} story citations need an authority classification")
                    if citation_reviewed_on < _date.today() - _timedelta(days=ORIGINAL_SOURCE_REVIEW_MAX_AGE_DAYS):
                        raise ValueError(f"Original stop {stop['id']} story citation review is too old to publish")
                    has_story_source = True
            if not has_story_source:
                raise ValueError(f"Original stop {stop['id']} needs an authoritative story citation")
            narration = assets_by_id.get(stop["audio_asset_id"])
            if not narration or narration["kind"] != "narration":
                raise ValueError(f"Original stop {stop['id']} needs a published narration asset")
            if not narration["mime_type"].startswith("audio/"):
                raise ValueError(f"Original stop {stop['id']} narration must be an audio upload")
            verified_narration = verified_assets.get(stop["audio_asset_id"])
            if not verified_narration or verified_narration.get("transcript_sha256") != original_transcript_sha256(stop["transcript"]):
                raise ValueError(f"Original stop {stop['id']} narration does not match its reviewed transcript")
            generator_metadata = _decode_pack_json(
                verified_narration.get("generator_metadata_json"), {},
            )
            if generator_metadata:
                provider = str(generator_metadata.get("provider") or "").strip().lower()
                if provider not in {"elevenlabs", "cartesia"}:
                    raise ValueError(f"Original stop {stop['id']} narration generator is not approved")
                for key in ("model_id", "voice_id"):
                    if not str(generator_metadata.get(key) or "").strip():
                        raise ValueError(
                            f"Original stop {stop['id']} generated narration needs {key.replace('_', ' ')} metadata"
                        )
                if not _original_generator_license_attestation_complete(generator_metadata):
                    raise ValueError(
                        f"Original stop {stop['id']} generated narration needs an explicit "
                        "admin license attestation with terms, version, and review date"
                    )
            media_metadata = _decode_pack_json(verified_narration.get("media_metadata_json"), {})
            verified_duration = float(media_metadata.get("duration_s") or 0)
            if verified_duration <= 0 or abs(stop["audio_duration_s"] - verified_duration) > max(0.25, verified_duration * 0.05):
                raise ValueError(f"Original stop {stop['id']} narration duration does not match its verified audio")
            artwork_id = stop.get("artwork_asset_id")
            if not artwork_id:
                raise ValueError(f"Original stop {stop['id']} needs a published artwork asset")
            artwork = assets_by_id.get(artwork_id)
            if not artwork or artwork["kind"] != "image" or not artwork["mime_type"].startswith("image/"):
                raise ValueError(f"Original stop {stop['id']} artwork must be a verified image upload")
            verified_artwork = verified_assets.get(artwork_id)
            artwork_metadata = _decode_pack_json(
                verified_artwork.get("media_metadata_json") if verified_artwork else None, {},
            )
            if int(artwork_metadata.get("width") or 0) < 320 or int(artwork_metadata.get("height") or 0) < 180:
                raise ValueError(f"Original stop {stop['id']} artwork is too small for offline playback")
        missing_operational_scopes = sorted(ORIGINAL_OPERATIONAL_SOURCE_SCOPES - operational_scopes)
        if missing_operational_scopes:
            raise ValueError(
                "Original official operational sources must cover: "
                + ", ".join(missing_operational_scopes)
            )

    result = {
        "schema_version": 1,
        "locale": locale,
        "title": re.sub(r"\s+", " ", title).strip(),
        "route": clean_route,
        "stops": stops,
        "assets": assets,
        "offline_map": offline_map,
        "safety": safety,
        "access": access,
        "season": season,
        "review": review,
    }
    if version is not None:
        result.update({
            "manifest_id": f"original_manifest_{pack_id}_v{int(version)}",
            "pack_id": pack_id,
            "version": int(version),
        })
    return _json_object(result, "Original manifest", 4 * 1024 * 1024)


def _validate_trip_pack_fields(
    pack_id: str,
    slug: str,
    title: str,
    summary: str,
    price_credits: int,
    coverage_region: str,
    public_metadata: dict,
    validation_metadata: dict,
    template: dict,
    content_kind: str = "trip_pack",
    original_manifest: dict | None = None,
) -> dict:
    pack_id = _validate_canonical_id(pack_id, "trip pack id")
    slug = re.sub(r"[^a-z0-9]+", "-", str(slug or "").strip().lower()).strip("-")
    title = re.sub(r"\s+", " ", str(title or "")).strip()
    summary = re.sub(r"\s+", " ", str(summary or "")).strip()
    coverage_region = str(coverage_region or "").strip().lower()
    content_kind = str(content_kind or "trip_pack").strip().lower()
    if not slug or len(slug) > 120:
        raise ValueError("Trip pack slug is required")
    if not title or len(title) > 200:
        raise ValueError("Trip pack title must be between 1 and 200 characters")
    if not summary or len(summary) > 2000:
        raise ValueError("Trip pack summary must be between 1 and 2000 characters")
    if content_kind not in TRIP_PACK_CONTENT_KINDS:
        raise ValueError("Content kind must be trip_pack or original_drive")
    allowed_prices = TRIP_PACK_PRICES | ({0} if content_kind == "original_drive" else set())
    if price_credits not in allowed_prices:
        if content_kind == "original_drive":
            raise ValueError("Original price must be free or 250, 500, or 900 credits")
        raise ValueError("Trip pack price must be 250, 500, or 900 credits")
    if coverage_region not in TRIP_PACK_COVERAGE_REGIONS:
        raise ValueError("Trip pack coverage must be north_america or global")
    public_metadata, public_metadata_json = _json_object(
        public_metadata, "Trip pack public metadata", 256 * 1024,
    )
    validation_metadata, validation_metadata_json = _json_object(
        validation_metadata, "Trip pack validation metadata", 256 * 1024,
    )
    template_for_pack = dict(template)
    template_for_pack["title"] = title
    template_for_pack.setdefault("summary", summary)
    normalized_template, template_json = _stable_trip_pack_template(pack_id, template_for_pack)
    normalized_manifest = None
    original_manifest_json = None
    if content_kind == "original_drive":
        if not isinstance(original_manifest, dict):
            raise ValueError("Original drive manifest is required")
        normalized_manifest, original_manifest_json = _normalize_original_manifest(
            pack_id, title, original_manifest,
        )
    elif original_manifest is not None:
        raise ValueError("Original manifests may only be attached to original_drive content")
    return {
        "id": pack_id,
        "slug": slug,
        "title": title,
        "summary": summary,
        "price_credits": price_credits,
        "coverage_region": coverage_region,
        "content_kind": content_kind,
        "public_metadata": public_metadata,
        "public_metadata_json": public_metadata_json,
        "validation_metadata": validation_metadata,
        "validation_metadata_json": validation_metadata_json,
        "template": normalized_template,
        "template_json": template_json,
        "original_manifest": normalized_manifest,
        "original_manifest_json": original_manifest_json,
    }


def _trip_pack_admin_from_row(row: sqlite3.Row | dict) -> dict:
    raw = dict(row)
    raw["public_metadata"] = _decode_pack_json(raw.pop("draft_public_metadata", "{}"), {})
    raw["validation_metadata"] = _decode_pack_json(raw.pop("draft_validation_metadata", "{}"), {})
    raw["template"] = _decode_pack_json(raw.pop("draft_template_json", "{}"), {})
    raw["original_manifest"] = _decode_pack_json(
        raw.pop("draft_original_manifest_json", None), None,
    )
    for field in ("title", "summary", "price_credits", "coverage_region"):
        raw[field] = raw.pop(f"draft_{field}")
    return raw


def save_authored_trip_pack_draft(
    pack_id: str,
    slug: str,
    title: str,
    summary: str,
    price_credits: int,
    coverage_region: str,
    public_metadata: dict,
    validation_metadata: dict,
    template: dict,
    admin_user_id: int,
    content_kind: str = "trip_pack",
    original_manifest: dict | None = None,
) -> dict:
    clean = _validate_trip_pack_fields(
        pack_id, slug, title, summary, price_credits, coverage_region,
        public_metadata, validation_metadata, template, content_kind, original_manifest,
    )
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        reserved_slug = db.execute(
            """SELECT 1 FROM authored_trip_pack_versions
               WHERE slug=? AND pack_id!=? LIMIT 1""",
            (clean["slug"], clean["id"]),
        ).fetchone()
        if reserved_slug:
            raise ValueError("Trip pack slug is already in use")
        existing = db.execute("SELECT * FROM authored_trip_packs WHERE id=?", (clean["id"],)).fetchone()
        if existing:
            if existing["content_kind"] != clean["content_kind"]:
                raise ValueError("Authored content cannot change content kind")
            db.execute(
                """UPDATE authored_trip_packs SET
                     content_kind=?,slug=?,draft_title=?,draft_summary=?,draft_price_credits=?,
                     draft_coverage_region=?,draft_public_metadata=?,
                     draft_validation_metadata=?,draft_template_json=?,draft_original_manifest_json=?,
                     draft_revision=draft_revision+1,updated_by=?,updated_at=?
                   WHERE id=?""",
                (
                    clean["content_kind"], clean["slug"], clean["title"], clean["summary"], clean["price_credits"],
                    clean["coverage_region"], clean["public_metadata_json"],
                    clean["validation_metadata_json"], clean["template_json"], clean["original_manifest_json"],
                    admin_user_id, now, clean["id"],
                ),
            )
        else:
            db.execute(
                """INSERT INTO authored_trip_packs
                   (id,content_kind,slug,status,draft_title,draft_summary,draft_price_credits,
                    draft_coverage_region,draft_public_metadata,draft_validation_metadata,
                    draft_template_json,draft_original_manifest_json,draft_revision,
                    created_by,updated_by,created_at,updated_at)
                   VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?,1,?,?,?,?)""",
                (
                    clean["id"], clean["content_kind"], clean["slug"], clean["title"], clean["summary"],
                    clean["price_credits"], clean["coverage_region"], clean["public_metadata_json"],
                    clean["validation_metadata_json"], clean["template_json"],
                    clean["original_manifest_json"], admin_user_id,
                    admin_user_id, now, now,
                ),
            )
        saved = db.execute("SELECT * FROM authored_trip_packs WHERE id=?", (clean["id"],)).fetchone()
        db.commit()
    except sqlite3.IntegrityError as exc:
        db.rollback()
        raise ValueError("Trip pack id or slug is already in use") from exc
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return _trip_pack_admin_from_row(saved)


def get_authored_trip_pack_admin(
    pack_id: str,
    content_kind: str | None = None,
) -> dict | None:
    pack_id = _validate_canonical_id(pack_id, "trip pack id")
    db = _conn()
    if content_kind is None:
        row = db.execute("SELECT * FROM authored_trip_packs WHERE id=?", (pack_id,)).fetchone()
    else:
        if content_kind not in TRIP_PACK_CONTENT_KINDS:
            db.close()
            raise ValueError("Invalid authored content kind")
        row = db.execute(
            "SELECT * FROM authored_trip_packs WHERE id=? AND content_kind=?",
            (pack_id, content_kind),
        ).fetchone()
    db.close()
    return _trip_pack_admin_from_row(row) if row else None


def list_authored_trip_pack_versions_admin(
    pack_id: str,
    content_kind: str | None = None,
) -> list[dict]:
    """Return immutable published snapshots for an authored pack, newest first."""
    pack_id = _validate_canonical_id(pack_id, "trip pack id")
    db = _conn()
    if content_kind is None:
        rows = db.execute(
            """SELECT * FROM authored_trip_pack_versions
               WHERE pack_id=? ORDER BY version DESC""",
            (pack_id,),
        ).fetchall()
    else:
        if content_kind not in TRIP_PACK_CONTENT_KINDS:
            db.close()
            raise ValueError("Invalid authored content kind")
        rows = db.execute(
            """SELECT * FROM authored_trip_pack_versions
               WHERE pack_id=? AND content_kind=? ORDER BY version DESC""",
            (pack_id, content_kind),
        ).fetchall()
    db.close()
    versions: list[dict] = []
    for row in rows:
        version = dict(row)
        version["version"] = int(version["version"])
        version["price_credits"] = int(version["price_credits"])
        version["published_at"] = int(version["published_at"])
        version["public_metadata"] = _decode_pack_json(
            version.pop("public_metadata", "{}"), {},
        )
        version["validation_metadata"] = _decode_pack_json(
            version.pop("validation_metadata", "{}"), {},
        )
        version["template"] = _decode_pack_json(
            version.pop("template_json", "{}"), {},
        )
        version["original_manifest"] = _decode_pack_json(
            version.pop("original_manifest_json", None), None,
        )
        versions.append(version)
    return versions


def list_authored_trip_packs_admin(content_kind: str | None = None) -> list[dict]:
    db = _conn()
    if content_kind is None:
        rows = db.execute("SELECT * FROM authored_trip_packs ORDER BY updated_at DESC,id").fetchall()
    else:
        if content_kind not in TRIP_PACK_CONTENT_KINDS:
            db.close()
            raise ValueError("Invalid authored content kind")
        rows = db.execute(
            "SELECT * FROM authored_trip_packs WHERE content_kind=? ORDER BY updated_at DESC,id",
            (content_kind,),
        ).fetchall()
    db.close()
    return [_trip_pack_admin_from_row(row) for row in rows]


def _authored_original_preview_manifest_from_row(
    pack: sqlite3.Row | dict,
    verified_assets: dict[str, dict],
) -> dict:
    pack_id = str(pack["id"])
    draft_revision = int(pack["draft_revision"])
    if draft_revision < 1:
        raise ValueError("Original draft revision is invalid")
    preview_version = ORIGINAL_DEVICE_PREVIEW_VERSION_BASE + draft_revision
    manifest, _ = _normalize_original_manifest(
        pack_id,
        pack["draft_title"],
        _decode_pack_json(pack["draft_original_manifest_json"], None),
        version=preview_version,
        publishing=False,
    )
    assets_by_id = {asset["id"]: asset for asset in manifest["assets"]}
    for asset in manifest["assets"]:
        verified = verified_assets.get(asset["id"])
        if not verified:
            raise ValueError(
                f"Original asset {asset['id']} needs a current server-verified upload"
            )
        expected = {
            "kind": verified["kind"],
            "mime_type": verified["mime_type"],
            "bytes": int(verified["byte_count"]),
            "sha256": verified["sha256"],
        }
        if any(asset[key] != expected[key] for key in expected):
            raise ValueError(
                f"Original asset {asset['id']} does not match its current server-verified upload"
            )
        asset["path"] = _original_asset_admin_immutable_path(
            pack_id,
            asset["id"],
            asset["sha256"],
        )
    for stop in manifest["stops"]:
        narration = assets_by_id.get(stop["audio_asset_id"])
        verified_narration = verified_assets.get(stop["audio_asset_id"])
        if (
            not narration
            or narration["kind"] != "narration"
            or not verified_narration
            or verified_narration.get("transcript_sha256")
            != original_transcript_sha256(stop["transcript"])
        ):
            raise ValueError(
                f"Original stop {stop['id']} narration does not match its current transcript"
            )
        media_metadata = _decode_pack_json(
            verified_narration.get("media_metadata_json"), {},
        )
        verified_duration = float(media_metadata.get("duration_s") or 0)
        if (
            verified_duration <= 0
            or abs(stop["audio_duration_s"] - verified_duration)
            > max(0.25, verified_duration * 0.05)
        ):
            raise ValueError(
                f"Original stop {stop['id']} narration duration does not match its verified audio"
            )
    manifest["manifest_id"] = (
        f"original_preview_manifest_{pack_id}_r{draft_revision}"
    )
    return manifest


def get_authored_original_device_preview_manifest(pack_id: str) -> dict | None:
    """Build a read-only, hash-bound manifest for testing the current draft."""
    pack_id = _validate_canonical_id(pack_id, "Original id")
    db = _conn()
    try:
        pack = db.execute(
            """SELECT * FROM authored_trip_packs
               WHERE id=? AND content_kind='original_drive'""",
            (pack_id,),
        ).fetchone()
        if not pack:
            return None
        verified_assets = _verified_original_asset_map_db(db, pack_id)
        return _authored_original_preview_manifest_from_row(pack, verified_assets)
    finally:
        db.close()


def _original_validation_hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, separators=(",", ":"), sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _original_validation_material(manifest: dict, draft_revision: int) -> dict:
    assets = sorted(({
        "id": asset.get("id"),
        "kind": asset.get("kind"),
        "mime_type": asset.get("mime_type"),
        "bytes": asset.get("bytes"),
        "sha256": asset.get("sha256"),
    } for asset in manifest.get("assets") or []), key=lambda item: str(item["id"]))
    manifest_sha256 = _original_validation_hash(manifest)
    assets_sha256 = _original_validation_hash(assets)
    validator_source_sha256 = trusted_originals_validator_source_sha256()
    input_sha256 = _original_validation_hash({
        "draft_revision": int(draft_revision),
        "manifest_sha256": manifest_sha256,
        "assets_sha256": assets_sha256,
        "suite_version": ORIGINAL_VIRTUAL_VALIDATION_SUITE_VERSION,
        "engine_version": ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
        "validator_source_sha256": validator_source_sha256,
        "scenario_ids": ORIGINAL_VIRTUAL_VALIDATION_REQUIRED_SCENARIOS,
    })
    return {
        "draft_revision": int(draft_revision),
        "manifest_sha256": manifest_sha256,
        "assets_sha256": assets_sha256,
        "validator_source_sha256": validator_source_sha256,
        "input_sha256": input_sha256,
    }


def _original_route_structural_summary(manifest: dict) -> dict:
    coordinates = manifest.get("route", {}).get("geometry", {}).get("coordinates") or []
    segment_lengths = [
        _original_haversine_m(start, end)
        for start, end in zip(coordinates, coordinates[1:])
    ]
    route_distance = float(manifest.get("route", {}).get("distance_m") or 0)
    discontinuity_threshold = max(25_000.0, route_distance * 0.25)
    discontinuities = [
        index for index, length in enumerate(segment_lengths)
        if length > discontinuity_threshold
    ]
    return {
        "geometry_sha256": original_route_geometry_sha256(coordinates),
        "coordinate_count": len(coordinates),
        "distance_m": route_distance,
        "maximum_segment_m": max(segment_lengths, default=0.0),
        "discontinuity_threshold_m": discontinuity_threshold,
        "discontinuity_count": len(discontinuities),
        "discontinuity_segment_indexes": discontinuities[:100],
        # Stop proximity and route-window intersection are derived by
        # _normalize_original_manifest before this trusted report is created.
        "stop_projection_failures": 0,
    }


def _recover_incomplete_original_validation_runs_db(
    db: sqlite3.Connection,
    *,
    timestamp: int | None = None,
    interrupted_by_restart: bool = False,
) -> int:
    """Fail abandoned trusted runs; recovery can never synthesize a passing report."""
    now = int(time.time()) if timestamp is None else int(timestamp)
    if interrupted_by_restart:
        issue = (
            "Trusted validation was interrupted by a server restart before completion; "
            "start a new authoritative run"
        )
        stale_ids: list[str] = []
        for row in db.execute(
            """SELECT id,worker_pid FROM authored_original_validation_reports
               WHERE status IN ('running','executing')"""
        ).fetchall():
            pid = row["worker_pid"]
            if isinstance(pid, bool) or not isinstance(pid, int) or pid < 1:
                stale_ids.append(row["id"])
                continue
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                stale_ids.append(row["id"])
            except PermissionError:
                # A live process owned by another user is still a live worker.
                continue
            except OSError:
                stale_ids.append(row["id"])
        if not stale_ids:
            return 0
        issue_json = json.dumps([issue], separators=(",", ":"))
        recovered = 0
        for report_id in stale_ids:
            recovered += int(db.execute(
                """UPDATE authored_original_validation_reports
                   SET status='error',passed=0,issues_json=?,completed_at=?
                   WHERE id=? AND status IN ('running','executing')""",
                (issue_json, now, report_id),
            ).rowcount or 0)
        return recovered

    cutoff = now - ORIGINAL_VIRTUAL_VALIDATION_RUN_TIMEOUT_SECONDS
    issue = "Trusted validation timed out before completion; start a new authoritative run"
    cursor = db.execute(
        """UPDATE authored_original_validation_reports
           SET status='error',passed=0,issues_json=?,completed_at=?
           WHERE status IN ('running','executing') AND started_at<=?""",
        (
            json.dumps([issue], separators=(",", ":")),
            now,
            cutoff,
        ),
    )
    return int(cursor.rowcount or 0)


def recover_stale_authored_original_validation_runs() -> int:
    """Expire timed-out runs during normal service operation and polling."""
    db = _conn()
    try:
        recovered = _recover_incomplete_original_validation_runs_db(db)
        if recovered:
            db.commit()
        return recovered
    finally:
        db.close()


def _original_validation_report_from_row(
    row: sqlite3.Row | dict,
    *,
    current_material: dict | None = None,
) -> dict:
    raw = dict(row)
    report = {
        "schema_version": 1,
        "report_type": "OriginalRouteValidationReportV1",
        "id": raw["id"],
        "pack_id": raw["pack_id"],
        "draft_revision": int(raw["draft_revision"]),
        "manifest_sha256": raw["manifest_sha256"],
        "assets_sha256": raw["assets_sha256"],
        "input_sha256": raw["input_sha256"],
        "validator_source_sha256": raw.get("validator_source_sha256"),
        "suite_version": raw["suite_version"],
        "engine_version": raw.get("engine_version"),
        "status": raw["status"],
        "passed": bool(raw["passed"]),
        "summary": _decode_pack_json(raw.get("summary_json"), {}),
        "scenarios": _decode_pack_json(raw.get("scenarios_json"), []),
        "issues": _decode_pack_json(raw.get("issues_json"), []),
        "started_at": int(raw["started_at"]),
        "completed_at": int(raw["completed_at"]) if raw.get("completed_at") is not None else None,
    }
    if current_material is not None:
        report["current"] = all(
            report[key] == current_material[key]
            for key in (
                "draft_revision", "manifest_sha256", "assets_sha256", "input_sha256",
                "validator_source_sha256",
            )
        )
    return report


def _current_original_validation_report_db(
    db: sqlite3.Connection,
    pack_id: str,
    material: dict,
) -> sqlite3.Row | None:
    return db.execute(
        """SELECT * FROM authored_original_validation_reports
           WHERE pack_id=? AND draft_revision=? AND manifest_sha256=?
             AND assets_sha256=? AND input_sha256=? AND suite_version=?
             AND engine_version=? AND validator_source_sha256=?
             AND status='passed' AND passed=1
           ORDER BY completed_at DESC,id DESC LIMIT 1""",
        (
            pack_id,
            material["draft_revision"], material["manifest_sha256"],
            material["assets_sha256"], material["input_sha256"],
            ORIGINAL_VIRTUAL_VALIDATION_SUITE_VERSION,
            ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
            material["validator_source_sha256"],
        ),
    ).fetchone()


def create_authored_original_virtual_validation_run(
    pack_id: str,
    admin_user_id: int,
) -> dict:
    """Persist a hash-bound running report before any trusted worker executes."""
    pack_id = _validate_canonical_id(pack_id, "Original id")
    manifest = get_authored_original_device_preview_manifest(pack_id)
    if not manifest:
        raise ValueError("Trailhead Original not found")
    draft_revision = int(manifest["version"]) - ORIGINAL_DEVICE_PREVIEW_VERSION_BASE
    material = _original_validation_material(manifest, draft_revision)
    report_id = f"original_validation_{secrets.token_hex(16)}"
    started_at = int(time.time())
    db = _conn()
    try:
        _recover_incomplete_original_validation_runs_db(db)
        admin = db.execute(
            "SELECT is_admin FROM users WHERE id=?", (admin_user_id,),
        ).fetchone()
        if not admin or not bool(admin["is_admin"]):
            raise PermissionError("Original validation requires an admin")
        db.execute(
            """INSERT INTO authored_original_validation_reports
               (id,pack_id,draft_revision,manifest_sha256,assets_sha256,input_sha256,
                validator_source_sha256,manifest_json,suite_version,status,started_by,
                worker_pid,started_at)
               VALUES (?,?,?,?,?,?,?,?,?,'running',?,?,?)""",
            (
                report_id, pack_id, draft_revision, material["manifest_sha256"],
                material["assets_sha256"], material["input_sha256"],
                material["validator_source_sha256"],
                json.dumps(manifest, separators=(",", ":"), sort_keys=True),
                ORIGINAL_VIRTUAL_VALIDATION_SUITE_VERSION, admin_user_id,
                os.getpid(), started_at,
            ),
        )
        row = db.execute(
            "SELECT * FROM authored_original_validation_reports WHERE id=?", (report_id,),
        ).fetchone()
        db.commit()
    finally:
        db.close()
    return _original_validation_report_from_row(row, current_material=material)


def execute_authored_original_virtual_validation_run(
    report_id: str,
    *,
    runner=None,
    route_network_validator=None,
) -> dict:
    """Claim and execute one persisted validation run; clients cannot complete it."""
    report_id = _validate_canonical_id(report_id, "Original validation report id")
    db = _conn()
    try:
        if _recover_incomplete_original_validation_runs_db(db):
            db.commit()
        row = db.execute(
            "SELECT * FROM authored_original_validation_reports WHERE id=?", (report_id,),
        ).fetchone()
        if not row:
            raise ValueError("Original virtual validation report not found")
        pack_id = row["pack_id"]
        if row["status"] != "running":
            return _original_validation_report_from_row(row)
        claimed = db.execute(
            """UPDATE authored_original_validation_reports SET status='executing'
               WHERE id=? AND status='running'""",
            (report_id,),
        ).rowcount
        if claimed != 1:
            db.rollback()
            current = db.execute(
                "SELECT * FROM authored_original_validation_reports WHERE id=?", (report_id,),
            ).fetchone()
            return _original_validation_report_from_row(current)
        db.commit()
        claimed_row = db.execute(
            "SELECT * FROM authored_original_validation_reports WHERE id=?", (report_id,),
        ).fetchone()
    finally:
        db.close()

    status = "error"
    engine_version: str | None = None
    passed = False
    summary: dict = {}
    scenarios: list = []
    issues: list[str] = []
    material: dict | None = None
    try:
        manifest = _decode_pack_json(claimed_row["manifest_json"], None)
        if not isinstance(manifest, dict):
            raise OriginalValidationRunnerError("Persisted validation manifest is unavailable")
        material = _original_validation_material(manifest, int(claimed_row["draft_revision"]))
        for key in (
            "manifest_sha256", "assets_sha256", "input_sha256", "validator_source_sha256",
        ):
            if claimed_row[key] != material[key]:
                raise OriginalValidationRunnerError(
                    "Persisted validation input no longer matches the trusted source set"
                )

        execute_network = route_network_validator or validate_original_route_network
        network_summary = execute_network(
            manifest,
            valhalla_url=settings.valhalla_url,
        )
        if (
            not isinstance(network_summary, dict)
            or network_summary.get("geometry_sha256")
            != original_route_geometry_sha256(manifest["route"]["geometry"]["coordinates"])
        ):
            raise OriginalValidationRunnerError(
                "Route-network validation is for different geometry"
            )
        execute = runner or run_originals_validation_cli
        raw = execute(
            manifest,
            required_scenario_ids=ORIGINAL_VIRTUAL_VALIDATION_REQUIRED_SCENARIOS,
            expected_engine_version=ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
            expected_validator_source_sha256=material["validator_source_sha256"],
        )
        result = normalize_original_validation_output(
            raw,
            manifest=manifest,
            required_scenario_ids=ORIGINAL_VIRTUAL_VALIDATION_REQUIRED_SCENARIOS,
            expected_engine_version=ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
            expected_validator_source_sha256=material["validator_source_sha256"],
        )
        engine_version = result["engine_version"]
        passed = result["passed"] is True
        summary = dict(result["summary"])
        route_summary = _original_route_structural_summary(manifest)
        runner_route_summary = result["route_summary"]
        route_summary.update({
            "runner_maximum_segment_m": runner_route_summary["maximum_segment_m"],
            "runner_discontinuity_count": int(runner_route_summary["discontinuity_count"]),
            "self_intersection_count": int(runner_route_summary["self_intersection_count"]),
            "runner_stop_projection_failures": int(runner_route_summary["stop_projection_failures"]),
            "network": network_summary,
        })
        summary["route"] = route_summary
        if (
            route_summary["discontinuity_count"]
            or route_summary["runner_discontinuity_count"]
            or route_summary["runner_stop_projection_failures"]
        ):
            passed = False
            result["issues"] = [
                *result["issues"],
                "Authored route contains implausible geometry discontinuities",
            ]
        status = "passed" if passed else "failed"
        scenarios = result["scenarios"]
        issues = result["issues"]
    except Exception as exc:
        clean = re.sub(r"\s+", " ", str(exc or "Virtual validation failed")).strip()
        issues = [clean[:1000] or "Virtual validation failed"]
    completed_at = int(time.time())
    db = _conn()
    try:
        db.execute(
            """UPDATE authored_original_validation_reports
               SET engine_version=?,status=?,passed=?,summary_json=?,scenarios_json=?,
                   issues_json=?,completed_at=? WHERE id=? AND status='executing'""",
            (
                engine_version, status, 1 if passed else 0,
                json.dumps(summary, separators=(",", ":"), sort_keys=True),
                json.dumps(scenarios, separators=(",", ":"), sort_keys=True),
                json.dumps(issues, separators=(",", ":"), sort_keys=True),
                completed_at, report_id,
            ),
        )
        row = db.execute(
            "SELECT * FROM authored_original_validation_reports WHERE id=?", (report_id,),
        ).fetchone()
        db.commit()
    finally:
        db.close()
    current = get_authored_original_virtual_validation_report(pack_id, report_id)
    return current or _original_validation_report_from_row(row, current_material=material)


def start_authored_original_virtual_validation(
    pack_id: str,
    admin_user_id: int,
    *,
    runner=None,
    route_network_validator=None,
) -> dict:
    """Synchronous compatibility wrapper used by tests and maintenance jobs."""
    created = create_authored_original_virtual_validation_run(pack_id, admin_user_id)
    return execute_authored_original_virtual_validation_run(
        created["id"],
        runner=runner,
        route_network_validator=route_network_validator,
    )


def get_authored_original_virtual_validation_report(
    pack_id: str,
    report_id: str,
) -> dict | None:
    pack_id = _validate_canonical_id(pack_id, "Original id")
    report_id = _validate_canonical_id(report_id, "Original validation report id")
    db = _conn()
    try:
        if _recover_incomplete_original_validation_runs_db(db):
            db.commit()
        pack = db.execute(
            "SELECT * FROM authored_trip_packs WHERE id=? AND content_kind='original_drive'",
            (pack_id,),
        ).fetchone()
        if not pack:
            return None
        row = db.execute(
            "SELECT * FROM authored_original_validation_reports WHERE id=? AND pack_id=?",
            (report_id, pack_id),
        ).fetchone()
        if not row:
            return None
        try:
            manifest = _authored_original_preview_manifest_from_row(
                pack, _verified_original_asset_map_db(db, pack_id),
            )
            material = _original_validation_material(manifest, int(pack["draft_revision"]))
        except ValueError:
            material = None
        return _original_validation_report_from_row(row, current_material=material)
    finally:
        db.close()


def get_latest_authored_original_virtual_validation_report(pack_id: str) -> dict | None:
    pack_id = _validate_canonical_id(pack_id, "Original id")
    db = _conn()
    try:
        if _recover_incomplete_original_validation_runs_db(db):
            db.commit()
        pack = db.execute(
            "SELECT * FROM authored_trip_packs WHERE id=? AND content_kind='original_drive'",
            (pack_id,),
        ).fetchone()
        if not pack:
            return None
        row = db.execute(
            """SELECT * FROM authored_original_validation_reports
               WHERE pack_id=? ORDER BY started_at DESC,id DESC LIMIT 1""",
            (pack_id,),
        ).fetchone()
        if not row:
            return None
        try:
            manifest = _authored_original_preview_manifest_from_row(
                pack, _verified_original_asset_map_db(db, pack_id),
            )
            material = _original_validation_material(manifest, int(pack["draft_revision"]))
        except ValueError:
            material = None
        return _original_validation_report_from_row(row, current_material=material)
    finally:
        db.close()


def _original_feedback_version_db(
    db: sqlite3.Connection,
    pack_id: str,
    version: int,
) -> sqlite3.Row:
    row = db.execute(
        """SELECT version.* FROM authored_trip_pack_versions version
           JOIN authored_trip_packs pack ON pack.id=version.pack_id
           WHERE version.pack_id=? AND version.version=?
             AND version.content_kind='original_drive'
             AND pack.current_published_version IS NOT NULL""",
        (pack_id, version),
    ).fetchone()
    if not row:
        raise ValueError("Published Trailhead Original version not found")
    return row


def _validate_original_feedback_subject_hmac(value: object, label: str) -> str:
    clean = str(value or "").strip().lower()
    if not re.fullmatch(r"[a-f0-9]{64}", clean):
        raise ValueError(f"{label} must be a server-keyed SHA-256 HMAC")
    return clean


def issue_original_feedback_guest_token(
    pack_id: str,
    version: int,
    *,
    ip_subject_hmac: str,
    install_subject_hmac: str | None = None,
) -> dict:
    pack_id = _validate_canonical_id(pack_id, "Original id")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ValueError("Original version must be a positive integer")
    clean_ip_hmac = _validate_original_feedback_subject_hmac(
        ip_subject_hmac, "Original feedback IP subject",
    )
    clean_install_hmac = (
        _validate_original_feedback_subject_hmac(
            install_subject_hmac, "Original feedback installation subject",
        )
        if install_subject_hmac else None
    )
    now = int(time.time())
    window_start = now - ORIGINAL_FEEDBACK_TOKEN_ISSUANCE_WINDOW_SECONDS
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    token_id = f"original_feedback_token_{secrets.token_hex(16)}"
    expires_at = now + ORIGINAL_FEEDBACK_GUEST_TOKEN_TTL_SECONDS
    db = _conn()
    try:
        # Serialize the count-and-insert gate so concurrent workers cannot race
        # through a quota. Subject values are scoped, server-keyed HMACs; raw
        # network or installation identifiers never reach persistent storage.
        db.execute("BEGIN IMMEDIATE")
        version_row = _original_feedback_version_db(db, pack_id, version)
        if int(version_row["price_credits"]) != 0:
            raise OriginalFeedbackTokenError("Guest feedback is available only for free Originals")
        db.execute(
            "DELETE FROM authored_original_feedback_token_issuances WHERE created_at<?",
            (window_start,),
        )
        ip_count = int(db.execute(
            """SELECT COUNT(*) FROM authored_original_feedback_token_issuances
               WHERE pack_id=? AND version=? AND ip_subject_hmac=? AND created_at>=?""",
            (pack_id, version, clean_ip_hmac, window_start),
        ).fetchone()[0])
        if ip_count >= ORIGINAL_FEEDBACK_TOKEN_ISSUANCE_IP_LIMIT:
            raise OriginalFeedbackRateLimitError(
                "Guest feedback token limit reached for this network; try again later"
            )
        if clean_install_hmac:
            install_count = int(db.execute(
                """SELECT COUNT(*) FROM authored_original_feedback_token_issuances
                   WHERE pack_id=? AND version=? AND install_subject_hmac=? AND created_at>=?""",
                (pack_id, version, clean_install_hmac, window_start),
            ).fetchone()[0])
            if install_count >= ORIGINAL_FEEDBACK_TOKEN_ISSUANCE_INSTALL_LIMIT:
                raise OriginalFeedbackRateLimitError(
                    "Guest feedback token limit reached for this installation; try again later"
                )
        db.execute(
            """INSERT INTO authored_original_feedback_tokens
               (id,pack_id,version,token_hash,expires_at,created_at)
               VALUES (?,?,?,?,?,?)""",
            (token_id, pack_id, version, token_hash, expires_at, now),
        )
        db.execute(
            """INSERT INTO authored_original_feedback_token_issuances
               (token_id,pack_id,version,ip_subject_hmac,install_subject_hmac,created_at)
               VALUES (?,?,?,?,?,?)""",
            (
                token_id, pack_id, version, clean_ip_hmac,
                clean_install_hmac, now,
            ),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return {
        "schema_version": 1,
        "pack_id": pack_id,
        "version": version,
        "token": raw_token,
        "expires_at": expires_at,
        "max_submissions": ORIGINAL_FEEDBACK_GUEST_MAX_SUBMISSIONS,
        "issuance_policy": {
            "window_seconds": ORIGINAL_FEEDBACK_TOKEN_ISSUANCE_WINDOW_SECONDS,
            "ip_limit": ORIGINAL_FEEDBACK_TOKEN_ISSUANCE_IP_LIMIT,
            "install_limit": ORIGINAL_FEEDBACK_TOKEN_ISSUANCE_INSTALL_LIMIT,
            "installation_bound": bool(clean_install_hmac),
        },
    }


def _clean_original_feedback_text(value: object, label: str, maximum: int) -> str | None:
    clean = re.sub(r"\s+", " ", str(value or "").replace("\x00", " ")).strip()
    if not clean:
        return None
    if len(clean) > maximum:
        raise ValueError(f"{label} is too long")
    return clean


def _original_feedback_from_row(row: sqlite3.Row | dict, *, admin: bool = False) -> dict:
    raw = dict(row)
    item = {
        "id": raw["id"],
        "pack_id": raw["pack_id"],
        "version": int(raw["version"]),
        "stop_id": raw.get("stop_id"),
        "category": raw["category"],
        "rating": int(raw["rating"]) if raw.get("rating") is not None else None,
        "message": raw["message"],
        "platform": raw["platform"],
        "app_version": raw.get("app_version"),
        "runtime_version": raw.get("runtime_version"),
        "release_cohort": raw.get("release_cohort"),
        "contact_consent": bool(raw.get("contact_consent")),
        "status": raw["status"],
        "submitted_at": int(raw["submitted_at"]),
        "updated_at": int(raw["updated_at"]),
    }
    if admin:
        item.update({
            "subject_type": "account" if raw.get("user_id") is not None else "guest",
            "moderation_note": raw.get("moderation_note"),
            "moderated_at": int(raw["moderated_at"]) if raw.get("moderated_at") is not None else None,
        })
    return item


def submit_original_feedback(
    *,
    pack_id: str,
    version: int,
    idempotency_key: str,
    category: str,
    message: str,
    platform: str,
    user_id: int | None = None,
    guest_token: str | None = None,
    stop_id: str | None = None,
    rating: int | None = None,
    app_version: str | None = None,
    runtime_version: str | None = None,
    release_cohort: str | None = None,
    contact_consent: bool = False,
) -> dict:
    pack_id = _validate_canonical_id(pack_id, "Original id")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ValueError("Original version must be a positive integer")
    clean_key = str(idempotency_key or "").strip()
    if not clean_key or len(clean_key) > 240:
        raise ValueError("A valid idempotency key is required")
    clean_category = str(category or "").strip().lower()
    if clean_category not in ORIGINAL_FEEDBACK_CATEGORIES:
        raise ValueError("Invalid Original feedback category")
    clean_platform = str(platform or "").strip().lower()
    if clean_platform not in ORIGINAL_FEEDBACK_PLATFORMS:
        raise ValueError("Invalid Original feedback platform")
    clean_message = _clean_original_feedback_text(message, "Feedback message", 2000)
    if not clean_message or len(clean_message) < 3:
        raise ValueError("Feedback message must be at least 3 characters")
    if _contains_coordinates(clean_message):
        raise PublicationPrivacyError("Remove precise coordinates before submitting feedback")
    clean_stop_id = _validate_canonical_id(stop_id, "Original stop id") if stop_id else None
    if rating is not None and (isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5):
        raise ValueError("Feedback rating must be from 1 through 5")
    clean_app_version = _clean_original_feedback_text(app_version, "App version", 80)
    clean_runtime_version = _clean_original_feedback_text(runtime_version, "Runtime version", 120)
    clean_cohort = _clean_original_feedback_text(release_cohort, "Release cohort", 80)
    if any(
        value and not re.fullmatch(r"[A-Za-z0-9_.:-]+", value)
        for value in (clean_app_version, clean_runtime_version, clean_cohort)
    ):
        raise ValueError("Feedback release metadata contains unsupported characters")
    if user_id is None and not guest_token:
        raise OriginalFeedbackTokenError("A guest feedback token or signed-in account is required")

    request = {
        "pack_id": pack_id, "version": version, "stop_id": clean_stop_id,
        "category": clean_category, "rating": rating, "message": clean_message,
        "platform": clean_platform, "app_version": clean_app_version,
        "runtime_version": clean_runtime_version, "release_cohort": clean_cohort,
        "contact_consent": bool(contact_consent),
    }
    request_hash = _original_validation_hash(request)
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        version_row = _original_feedback_version_db(db, pack_id, version)
        manifest = _decode_pack_json(version_row["original_manifest_json"], {})
        if clean_stop_id and clean_stop_id not in {
            str(stop.get("id")) for stop in manifest.get("stops") or [] if isinstance(stop, dict)
        }:
            raise ValueError("Original feedback stop does not exist in this version")

        token_row = None
        if user_id is not None:
            if int(version_row["price_credits"]) > 0 and not db.execute(
                """SELECT 1 FROM authored_trip_pack_entitlements
                   WHERE user_id=? AND pack_id=? AND version=? AND content_kind='original_drive'""",
                (user_id, pack_id, version),
            ).fetchone():
                raise OriginalFeedbackTokenError("Acquire this Original before sending feedback")
            existing = db.execute(
                "SELECT * FROM authored_original_feedback WHERE user_id=? AND idempotency_key=?",
                (user_id, clean_key),
            ).fetchone()
            recent_count = int(db.execute(
                """SELECT COUNT(*) FROM authored_original_feedback
                   WHERE user_id=? AND submitted_at>=?""",
                (user_id, now - 86400),
            ).fetchone()[0])
            if not existing and recent_count >= 20:
                raise OriginalFeedbackRateLimitError("Feedback limit reached; try again later")
        else:
            token_hash = hashlib.sha256(str(guest_token).encode("utf-8")).hexdigest()
            token_row = db.execute(
                """SELECT * FROM authored_original_feedback_tokens
                   WHERE token_hash=? AND pack_id=? AND version=?""",
                (token_hash, pack_id, version),
            ).fetchone()
            if not token_row or int(token_row["expires_at"]) < now:
                raise OriginalFeedbackTokenError("Guest feedback token is invalid or expired")
            existing = db.execute(
                "SELECT * FROM authored_original_feedback WHERE guest_token_id=? AND idempotency_key=?",
                (token_row["id"], clean_key),
            ).fetchone()
            if not existing and int(token_row["use_count"]) >= ORIGINAL_FEEDBACK_GUEST_MAX_SUBMISSIONS:
                raise OriginalFeedbackRateLimitError("Guest feedback limit reached")

        if existing:
            if existing["request_hash"] != request_hash:
                raise OriginalFeedbackConflictError("Idempotency key was used for different feedback")
            db.commit()
            replay = _original_feedback_from_row(existing)
            replay["replayed"] = True
            return replay

        feedback_id = f"original_feedback_{secrets.token_hex(16)}"
        db.execute(
            """INSERT INTO authored_original_feedback
               (id,pack_id,version,stop_id,user_id,guest_token_id,idempotency_key,
                request_hash,category,rating,message,platform,app_version,runtime_version,
                release_cohort,contact_consent,status,submitted_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'new',?,?)""",
            (
                feedback_id, pack_id, version, clean_stop_id, user_id,
                token_row["id"] if token_row else None, clean_key, request_hash,
                clean_category, rating, clean_message, clean_platform,
                clean_app_version, clean_runtime_version, clean_cohort,
                1 if contact_consent else 0, now, now,
            ),
        )
        if token_row:
            db.execute(
                "UPDATE authored_original_feedback_tokens SET use_count=use_count+1 WHERE id=?",
                (token_row["id"],),
            )
        saved = db.execute(
            "SELECT * FROM authored_original_feedback WHERE id=?", (feedback_id,),
        ).fetchone()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    result = _original_feedback_from_row(saved)
    result["replayed"] = False
    return result


def list_original_feedback_admin(
    *,
    status: str = "new",
    pack_id: str | None = None,
    category: str | None = None,
    limit: int = 50,
    cursor: str | None = None,
) -> dict:
    clean_status = str(status or "").strip().lower()
    if clean_status not in ORIGINAL_FEEDBACK_STATUSES:
        raise ValueError("Invalid Original feedback status")
    if not isinstance(limit, int) or not 1 <= limit <= 100:
        raise ValueError("Limit must be between 1 and 100")
    clauses = ["status=?"]
    params: list = [clean_status]
    if pack_id:
        clauses.append("pack_id=?")
        params.append(_validate_canonical_id(pack_id, "Original id"))
    if category:
        clean_category = str(category).strip().lower()
        if clean_category not in ORIGINAL_FEEDBACK_CATEGORIES:
            raise ValueError("Invalid Original feedback category")
        clauses.append("category=?")
        params.append(clean_category)
    decoded_cursor = _decode_account_cursor(cursor)
    if decoded_cursor:
        clauses.append("(submitted_at<? OR (submitted_at=? AND id<?))")
        params.extend([decoded_cursor[0], decoded_cursor[0], decoded_cursor[1]])
    params.append(limit + 1)
    db = _conn()
    rows = db.execute(
        f"""SELECT * FROM authored_original_feedback
            WHERE {' AND '.join(clauses)}
            ORDER BY submitted_at DESC,id DESC LIMIT ?""",
        params,
    ).fetchall()
    db.close()
    has_more = len(rows) > limit
    page = rows[:limit]
    return {
        "items": [_original_feedback_from_row(row, admin=True) for row in page],
        "next_cursor": _encode_account_cursor(page[-1]["submitted_at"], page[-1]["id"])
        if has_more else None,
    }


def moderate_original_feedback(
    feedback_id: str,
    status: str,
    moderator_user_id: int,
    note: str | None = None,
) -> dict | None:
    feedback_id = _validate_canonical_id(feedback_id, "Original feedback id")
    clean_status = str(status or "").strip().lower()
    if clean_status not in ORIGINAL_FEEDBACK_STATUSES - {"new"}:
        raise ValueError("Feedback status must be reviewing, resolved, or dismissed")
    clean_note = _clean_original_feedback_text(note, "Moderation note", 1000)
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT * FROM authored_original_feedback WHERE id=?", (feedback_id,),
        ).fetchone()
        if not row:
            db.commit()
            return None
        db.execute(
            """UPDATE authored_original_feedback SET status=?,moderation_note=?,
               moderated_by=?,moderated_at=?,updated_at=? WHERE id=?""",
            (clean_status, clean_note, moderator_user_id, now, now, feedback_id),
        )
        saved = db.execute(
            "SELECT * FROM authored_original_feedback WHERE id=?", (feedback_id,),
        ).fetchone()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return _original_feedback_from_row(saved, admin=True)


def validate_authored_original_draft(pack_id: str) -> dict | None:
    pack_id = _validate_canonical_id(pack_id, "Original id")
    db = _conn()
    pack = db.execute(
        "SELECT * FROM authored_trip_packs WHERE id=? AND content_kind='original_drive'",
        (pack_id,),
    ).fetchone()
    if not pack:
        db.close()
        return None
    next_version = int(db.execute(
        "SELECT COALESCE(MAX(version),0)+1 FROM authored_trip_pack_versions WHERE pack_id=?",
        (pack_id,),
    ).fetchone()[0])
    verified_assets = _verified_original_asset_map_db(db, pack_id)
    current_validation_report = None
    try:
        preview_manifest = _authored_original_preview_manifest_from_row(pack, verified_assets)
        validation_material = _original_validation_material(
            preview_manifest, int(pack["draft_revision"]),
        )
        validation_row = _current_original_validation_report_db(
            db, pack_id, validation_material,
        )
        if validation_row:
            current_validation_report = _original_validation_report_from_row(
                validation_row, current_material=validation_material,
            )
    except ValueError:
        validation_material = None
    db.close()
    validation = _decode_pack_json(pack["draft_validation_metadata"], {})
    missing = sorted(check for check in ORIGINAL_VALIDATION_CHECKS if validation.get(check) is not True)
    issues = [f"Review is incomplete: {check}" for check in missing]
    if current_validation_report is None:
        issues.append("A current server-owned virtual route validation report must pass before publishing")
    template_for_scan = _decode_pack_json(pack["draft_template_json"], {})
    if isinstance(template_for_scan, dict):
        template_for_scan = dict(template_for_scan)
        for structural_key in ("schema_version", "trip_id", "status", "visibility", "source"):
            template_for_scan.pop(structural_key, None)
    unresolved_path = _original_unresolved_copy_path({
        "title": pack["draft_title"],
        "summary": pack["draft_summary"],
        "public_metadata": _decode_pack_json(pack["draft_public_metadata"], {}),
        "template": template_for_scan,
    }, "original")
    if unresolved_path:
        issues.append(f"Original publish content is unresolved at {unresolved_path}")
    try:
        _normalize_original_manifest(
            pack_id,
            pack["draft_title"],
            _decode_pack_json(pack["draft_original_manifest_json"], None),
            version=next_version,
            publishing=True,
            verified_assets=verified_assets,
        )
    except ValueError as exc:
        issues.append(str(exc))
    return {
        "pack_id": pack_id,
        "content_kind": "original_drive",
        "draft_revision": int(pack["draft_revision"]),
        "next_version": next_version,
        "publish_ready": not issues,
        "missing_reviews": missing,
        "virtual_validation": current_validation_report,
        "issues": issues,
    }


def publish_authored_trip_pack(
    pack_id: str,
    admin_user_id: int,
    required_content_kind: str | None = None,
) -> dict:
    pack_id = _validate_canonical_id(pack_id, "trip pack id")
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        pack = db.execute("SELECT * FROM authored_trip_packs WHERE id=?", (pack_id,)).fetchone()
        if not pack:
            raise ValueError("Trip pack not found")
        if required_content_kind and pack["content_kind"] != required_content_kind:
            raise ValueError("Authored content kind does not match this publishing endpoint")
        validation = _decode_pack_json(pack["draft_validation_metadata"], {})
        published_validation_metadata = dict(validation)
        validation_checks = (
            ORIGINAL_VALIDATION_CHECKS
            if pack["content_kind"] == "original_drive"
            else TRIP_PACK_VALIDATION_CHECKS
        )
        missing = sorted(check for check in validation_checks if validation.get(check) is not True)
        if missing:
            label = "Original" if pack["content_kind"] == "original_drive" else "Trip pack"
            raise ValueError(f"{label} review is incomplete: " + ", ".join(missing))
        version = int(db.execute(
            "SELECT COALESCE(MAX(version),0)+1 FROM authored_trip_pack_versions WHERE pack_id=?",
            (pack_id,),
        ).fetchone()[0])
        original_manifest_json = None
        if pack["content_kind"] == "original_drive":
            template_for_scan = _decode_pack_json(pack["draft_template_json"], {})
            if isinstance(template_for_scan, dict):
                template_for_scan = dict(template_for_scan)
                for structural_key in ("schema_version", "trip_id", "status", "visibility", "source"):
                    template_for_scan.pop(structural_key, None)
            unresolved_path = _original_unresolved_copy_path({
                "title": pack["draft_title"],
                "summary": pack["draft_summary"],
                "public_metadata": _decode_pack_json(pack["draft_public_metadata"], {}),
                "template": template_for_scan,
            }, "original")
            if unresolved_path:
                raise ValueError(f"Original publish content is unresolved at {unresolved_path}")
            original_manifest = _decode_pack_json(pack["draft_original_manifest_json"], None)
            verified_assets = _verified_original_asset_map_db(db, pack_id)
            preview_manifest = _authored_original_preview_manifest_from_row(pack, verified_assets)
            validation_material = _original_validation_material(
                preview_manifest, int(pack["draft_revision"]),
            )
            validation_report_row = _current_original_validation_report_db(
                db, pack_id, validation_material,
            )
            if not validation_report_row:
                raise ValueError(
                    "Original needs a current server-owned virtual route validation pass before publishing"
                )
            published_validation_metadata.pop("trigger_drive_tested", None)
            published_validation_metadata["virtual_route_validated"] = True
            published_validation_metadata["virtual_validation_report"] = {
                "schema_version": 1,
                "report_type": "OriginalRouteValidationReportV1",
                "id": validation_report_row["id"],
                "input_sha256": validation_report_row["input_sha256"],
                "validator_source_sha256": validation_report_row["validator_source_sha256"],
                "suite_version": validation_report_row["suite_version"],
                "engine_version": validation_report_row["engine_version"],
                "completed_at": int(validation_report_row["completed_at"]),
            }
            _, original_manifest_json = _normalize_original_manifest(
                pack_id,
                pack["draft_title"],
                original_manifest,
                version=version,
                publishing=True,
                verified_assets=verified_assets,
            )
        db.execute(
            """INSERT INTO authored_trip_pack_versions
               (pack_id,version,content_kind,slug,title,summary,price_credits,coverage_region,
                public_metadata,validation_metadata,template_json,original_manifest_json,
                published_by,published_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                pack_id, version, pack["content_kind"], pack["slug"],
                pack["draft_title"], pack["draft_summary"],
                pack["draft_price_credits"], pack["draft_coverage_region"],
                pack["draft_public_metadata"], json.dumps(
                    published_validation_metadata, separators=(",", ":"), sort_keys=True,
                ),
                pack["draft_template_json"], original_manifest_json, admin_user_id, now,
            ),
        )
        db.execute(
            """UPDATE authored_trip_packs
               SET status='published',current_published_version=?,updated_by=?,updated_at=?
               WHERE id=?""",
            (version, admin_user_id, now, pack_id),
        )
        published = db.execute(
            """SELECT p.id,p.slug,v.*,p.status
               FROM authored_trip_packs p JOIN authored_trip_pack_versions v
                 ON v.pack_id=p.id AND v.version=p.current_published_version
               WHERE p.id=?""",
            (pack_id,),
        ).fetchone()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    result = _public_trip_pack_from_row(published, include_template=True)
    return result


def _public_trip_pack_from_row(row: sqlite3.Row | dict, include_template: bool = False) -> dict:
    raw = dict(row)
    result = {
        "id": raw["id"],
        "slug": raw["slug"],
        "version": int(raw["version"]),
        "title": raw["title"],
        "summary": raw["summary"],
        "price_credits": int(raw["price_credits"]),
        "explorer_price_credits": int(raw["price_credits"]) * 80 // 100,
        "free": int(raw["price_credits"]) == 0,
        "content_kind": raw.get("content_kind") or "trip_pack",
        "coverage_region": raw["coverage_region"],
        "public_metadata": _decode_pack_json(raw.get("public_metadata"), {}),
        "validation_metadata": _decode_pack_json(raw.get("validation_metadata"), {}),
        "published_at": int(raw["published_at"]),
        "featured": bool(raw.get("featured") or 0),
    }
    if include_template:
        result["template"] = _decode_pack_json(raw.get("template_json"), {})
        if result["content_kind"] == "original_drive":
            result["original_manifest"] = _decode_pack_json(raw.get("original_manifest_json"), None)
    return result


def _published_trip_pack_query(content_kind: str = "trip_pack") -> str:
    feature_table = {
        "trip_pack": "authored_trip_pack_features",
        "original_drive": "authored_original_features",
    }.get(content_kind)
    if not feature_table:
        raise ValueError("Invalid authored content kind")
    return f"""SELECT p.id,COALESCE(v.slug,p.slug) AS slug,v.version,v.content_kind,
                     v.title,v.summary,v.price_credits,
                     v.coverage_region,v.public_metadata,v.validation_metadata,
                     v.template_json,v.original_manifest_json,v.published_at,
                     CASE WHEN feature.pack_id=p.id AND feature.version=v.version THEN 1 ELSE 0 END AS featured
              FROM authored_trip_packs p
              JOIN authored_trip_pack_versions v
                ON v.pack_id=p.id AND v.version=p.current_published_version
              LEFT JOIN {feature_table} feature
                ON feature.period_month=? AND feature.pack_id=p.id AND feature.version=v.version
              WHERE p.status='published' AND p.content_kind='{content_kind}'"""


def list_published_trip_packs(
    limit: int = 50,
    cursor: str | None = None,
    coverage_region: str | None = None,
    content_kind: str = "trip_pack",
) -> dict:
    if not isinstance(limit, int) or limit < 1 or limit > 100:
        raise ValueError("Limit must be between 1 and 100")
    coverage_region = str(coverage_region or "").strip().lower() or None
    if coverage_region and coverage_region not in TRIP_PACK_COVERAGE_REGIONS:
        raise ValueError("Invalid trip pack coverage")
    decoded_cursor = _decode_account_cursor(cursor)
    sql = _published_trip_pack_query(content_kind)
    params: list = [_utc_month()]
    if coverage_region:
        sql += " AND v.coverage_region=?"
        params.append(coverage_region)
    if decoded_cursor:
        sql += " AND (v.published_at<? OR (v.published_at=? AND p.id<?))"
        params.extend([decoded_cursor[0], decoded_cursor[0], decoded_cursor[1]])
    sql += " ORDER BY v.published_at DESC,p.id DESC LIMIT ?"
    params.append(limit + 1)
    db = _conn()
    rows = db.execute(sql, params).fetchall()
    db.close()
    has_more = len(rows) > limit
    page = rows[:limit]
    return {
        "items": [_public_trip_pack_from_row(row) for row in page],
        "next_cursor": _encode_account_cursor(page[-1]["published_at"], page[-1]["id"]) if has_more else None,
    }


def get_published_trip_pack(
    pack_id_or_slug: str,
    include_template: bool = False,
    content_kind: str = "trip_pack",
) -> dict | None:
    clean = str(pack_id_or_slug or "").strip()
    db = _conn()
    row = db.execute(
        _published_trip_pack_query(content_kind) + " AND (p.id=? OR COALESCE(v.slug,p.slug)=?) LIMIT 1",
        (_utc_month(), clean, clean),
    ).fetchone()
    db.close()
    return _public_trip_pack_from_row(row, include_template=include_template) if row else None


def _original_manifest_preview(manifest: dict | None) -> dict | None:
    if not isinstance(manifest, dict):
        return None
    stops = []
    for raw_stop in manifest.get("stops") or []:
        if not isinstance(raw_stop, dict):
            continue
        stops.append({
            key: raw_stop[key]
            for key in ("id", "sequence", "title", "coordinates", "explore_place_id", "artwork_asset_id")
            if key in raw_stop
        })
    offline_map = manifest.get("offline_map") if isinstance(manifest.get("offline_map"), dict) else {}
    return {
        key: value
        for key, value in {
            "schema_version": manifest.get("schema_version"),
            "manifest_id": manifest.get("manifest_id"),
            "pack_id": manifest.get("pack_id"),
            "version": manifest.get("version"),
            "locale": manifest.get("locale"),
            "title": manifest.get("title"),
            "route": manifest.get("route"),
            "stops": stops,
            "offline_map": {
                key: offline_map.get(key)
                for key in ("region_id", "bounds", "min_zoom", "max_zoom", "estimated_bytes")
                if key in offline_map
            },
            "safety": manifest.get("safety"),
            "access": manifest.get("access"),
            "season": manifest.get("season"),
        }.items()
        if value is not None
    }


def _public_original_from_row(row: sqlite3.Row | dict, include_preview: bool = False) -> dict:
    result = _public_trip_pack_from_row(row)
    # Editorial review flags and source checklists are admin-only.
    result.pop("validation_metadata", None)
    if include_preview:
        result["manifest_preview"] = _original_manifest_preview(
            _decode_pack_json(dict(row).get("original_manifest_json"), None),
        )
    return result


def list_published_originals(
    limit: int = 50,
    cursor: str | None = None,
    coverage_region: str | None = None,
) -> dict:
    page = list_published_trip_packs(
        limit=limit,
        cursor=cursor,
        coverage_region=coverage_region,
        content_kind="original_drive",
    )
    # The base helper has already decoded rows, so remove the admin-only field here.
    for item in page["items"]:
        item.pop("validation_metadata", None)
    return page


def get_published_original(pack_id_or_slug: str, include_preview: bool = True) -> dict | None:
    clean = str(pack_id_or_slug or "").strip()
    db = _conn()
    row = db.execute(
        _published_trip_pack_query("original_drive")
        + " AND (p.id=? OR COALESCE(v.slug,p.slug)=?) LIMIT 1",
        (_utc_month(), clean, clean),
    ).fetchone()
    db.close()
    return _public_original_from_row(row, include_preview=include_preview) if row else None


def get_published_original_version(
    pack_id_or_slug: str,
    version: int,
    include_preview: bool = True,
) -> dict | None:
    """Return one immutable published Original version, never a newer substitute."""
    clean = str(pack_id_or_slug or "").strip()
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ValueError("Original version must be a positive integer")
    db = _conn()
    row = db.execute(
        """SELECT p.id,COALESCE(v.slug,p.slug) AS slug,v.version,v.content_kind,
                  v.title,v.summary,v.price_credits,v.coverage_region,v.public_metadata,
                  v.validation_metadata,v.template_json,v.original_manifest_json,
                  v.published_at,
                  CASE WHEN feature.pack_id=p.id AND feature.version=v.version
                       THEN 1 ELSE 0 END AS featured
           FROM authored_trip_packs p
           JOIN authored_trip_pack_versions v ON v.pack_id=p.id
           LEFT JOIN authored_original_features feature
             ON feature.period_month=? AND feature.pack_id=p.id AND feature.version=v.version
           WHERE (p.id=? OR COALESCE(v.slug,p.slug)=?) AND v.version=?
             AND p.status='published' AND p.content_kind='original_drive'
             AND v.content_kind='original_drive'
           LIMIT 1""",
        (_utc_month(), clean, clean, version),
    ).fetchone()
    db.close()
    return _public_original_from_row(row, include_preview=include_preview) if row else None


def select_featured_trip_pack(
    period_month: str,
    pack_id: str,
    admin_user_id: int,
    version: int | None = None,
) -> dict:
    period_month = _validate_trip_pack_month(period_month)
    pack_id = _validate_canonical_id(pack_id, "trip pack id")
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        if version is None:
            row = db.execute(
                """SELECT current_published_version AS version FROM authored_trip_packs
                   WHERE id=? AND status='published' AND content_kind='trip_pack'""",
                (pack_id,),
            ).fetchone()
            version = int(row["version"]) if row and row["version"] else None
        if version is None or not db.execute(
            """SELECT 1 FROM authored_trip_pack_versions version
               JOIN authored_trip_packs pack ON pack.id=version.pack_id
               WHERE version.pack_id=? AND version.version=? AND pack.status='published'
                 AND pack.content_kind='trip_pack'""",
            (pack_id, version),
        ).fetchone():
            raise ValueError("Published trip pack version not found")
        db.execute(
            """INSERT INTO authored_trip_pack_features
               (period_month,pack_id,version,selected_by,selected_at)
               VALUES (?,?,?,?,?)
               ON CONFLICT(period_month) DO UPDATE SET
                 pack_id=excluded.pack_id,version=excluded.version,
                 selected_by=excluded.selected_by,selected_at=excluded.selected_at""",
            (period_month, pack_id, version, admin_user_id, now),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return {"period_month": period_month, "pack_id": pack_id, "version": version, "selected_at": now}


def get_featured_trip_pack(period_month: str | None = None, include_template: bool = False) -> dict | None:
    month = _validate_trip_pack_month(period_month or _utc_month())
    db = _conn()
    row = db.execute(
        """SELECT p.id,COALESCE(v.slug,p.slug) AS slug,v.version,v.title,v.summary,v.price_credits,
                  v.coverage_region,v.public_metadata,v.validation_metadata,
                  v.template_json,v.published_at,1 AS featured
           FROM authored_trip_pack_features feature
           JOIN authored_trip_packs p ON p.id=feature.pack_id
           JOIN authored_trip_pack_versions v
             ON v.pack_id=feature.pack_id AND v.version=feature.version
           WHERE feature.period_month=? AND p.status='published' AND p.content_kind='trip_pack'""",
        (month,),
    ).fetchone()
    db.close()
    return _public_trip_pack_from_row(row, include_template=include_template) if row else None


def select_featured_original(
    period_month: str,
    pack_id: str,
    admin_user_id: int,
    version: int | None = None,
) -> dict:
    period_month = _validate_trip_pack_month(period_month)
    pack_id = _validate_canonical_id(pack_id, "Original id")
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        if version is None:
            row = db.execute(
                """SELECT current_published_version AS version FROM authored_trip_packs
                   WHERE id=? AND status='published' AND content_kind='original_drive'""",
                (pack_id,),
            ).fetchone()
            version = int(row["version"]) if row and row["version"] else None
        if version is None or not db.execute(
            """SELECT 1 FROM authored_trip_pack_versions version
               JOIN authored_trip_packs pack ON pack.id=version.pack_id
               WHERE version.pack_id=? AND version.version=? AND pack.status='published'
                 AND pack.content_kind='original_drive'""",
            (pack_id, version),
        ).fetchone():
            raise ValueError("Published Original version not found")
        db.execute(
            """INSERT INTO authored_original_features
               (period_month,pack_id,version,selected_by,selected_at)
               VALUES (?,?,?,?,?)
               ON CONFLICT(period_month) DO UPDATE SET
                 pack_id=excluded.pack_id,version=excluded.version,
                 selected_by=excluded.selected_by,selected_at=excluded.selected_at""",
            (period_month, pack_id, version, admin_user_id, now),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return {"period_month": period_month, "pack_id": pack_id, "version": version, "selected_at": now}


def get_featured_original(period_month: str | None = None) -> dict | None:
    month = _validate_trip_pack_month(period_month or _utc_month())
    db = _conn()
    row = db.execute(
        """SELECT p.id,COALESCE(v.slug,p.slug) AS slug,v.version,v.content_kind,
                  v.title,v.summary,v.price_credits,v.coverage_region,v.public_metadata,
                  v.validation_metadata,v.template_json,v.original_manifest_json,
                  v.published_at,1 AS featured
           FROM authored_original_features feature
           JOIN authored_trip_packs p ON p.id=feature.pack_id
           JOIN authored_trip_pack_versions v
             ON v.pack_id=feature.pack_id AND v.version=feature.version
           WHERE feature.period_month=? AND p.status='published'
             AND p.content_kind='original_drive'""",
        (month,),
    ).fetchone()
    db.close()
    return _public_original_from_row(row) if row else None


def _clone_authored_pack_trip_db(
    db: sqlite3.Connection,
    user_id: int,
    pack_id: str,
    version: int,
    template_json: str,
    now: int,
    content_kind: str = "trip_pack",
    original_manifest_json: str | None = None,
) -> dict:
    template = _decode_pack_json(template_json, {})
    trip_id = f"packtrip_{user_id}_{secrets.token_hex(12)}"
    document = dict(template) if isinstance(template, dict) else {}
    document.update({
        "schema_version": 2,
        "trip_id": trip_id,
        "status": "draft",
        "visibility": "private",
        "source": f"trip_pack:{pack_id}:v{version}",
    })
    if content_kind == "original_drive":
        manifest = _decode_pack_json(original_manifest_json, {})
        document["source"] = f"trailhead_original:{pack_id}:v{version}"
        document["experience_ref"] = {
            "kind": "trailhead_original",
            "pack_id": pack_id,
            "version": int(version),
            "manifest_id": str(
                manifest.get("manifest_id") or f"original_manifest_{pack_id}_v{int(version)}"
            ),
        }
    normalized, document_json = _normalize_trip_document(document, trip_id)
    db.execute(
        """INSERT INTO trip_documents_v2
           (id,user_id,status,revision,document_json,created_at,updated_at,archived_at,deleted_at)
           VALUES (?,?,'draft',1,?,?,?,NULL,NULL)""",
        (trip_id, user_id, document_json, now, now),
    )
    row = db.execute(
        "SELECT * FROM trip_documents_v2 WHERE user_id=? AND id=?", (user_id, trip_id),
    ).fetchone()
    return _trip_document_from_row(row)


def _trip_pack_entitlement_query() -> str:
    return """SELECT entitlement.*,COALESCE(version.slug,pack.slug) AS slug,version.title,version.summary,
                     version.price_credits,version.coverage_region,version.content_kind,
                     version.public_metadata,version.validation_metadata,
                     version.template_json,version.original_manifest_json,version.published_at
              FROM authored_trip_pack_entitlements entitlement
              JOIN authored_trip_packs pack ON pack.id=entitlement.pack_id
              JOIN authored_trip_pack_versions version
                ON version.pack_id=entitlement.pack_id AND version.version=entitlement.version"""


def _trip_pack_entitlement_result(
    db: sqlite3.Connection,
    row: sqlite3.Row | dict,
    *,
    already_owned: bool,
) -> dict:
    raw = dict(row)
    entitlement = {
        "id": raw["id"],
        "pack_id": raw["pack_id"],
        "version": int(raw["version"]),
        "acquisition_type": raw["acquisition_type"],
        "list_price_credits": int(raw["list_price_credits"]),
        "credits_charged": int(raw["credits_charged"]),
        "explorer_discount": int(raw["explorer_discount"]),
        "claim_month": raw["claim_month"],
        "trip_id": raw["trip_id"],
        "acquired_at": int(raw["acquired_at"]),
        "permanent": True,
    }
    pack = {
        "id": raw["pack_id"],
        "slug": raw["slug"],
        "version": int(raw["version"]),
        "title": raw["title"],
        "summary": raw["summary"],
        "price_credits": int(raw["price_credits"]),
        "explorer_price_credits": int(raw["price_credits"]) * 80 // 100,
        "free": int(raw["price_credits"]) == 0,
        "content_kind": raw.get("content_kind") or "trip_pack",
        "coverage_region": raw["coverage_region"],
        "public_metadata": _decode_pack_json(raw["public_metadata"], {}),
        "validation_metadata": _decode_pack_json(raw["validation_metadata"], {}),
        "published_at": int(raw["published_at"]),
    }
    if pack["content_kind"] == "original_drive":
        pack.pop("validation_metadata", None)
    trip_row = db.execute(
        "SELECT * FROM trip_documents_v2 WHERE user_id=? AND id=?",
        (raw["user_id"], raw["trip_id"]),
    ).fetchone()
    trip = None
    if trip_row and trip_row["status"] != "deleted":
        trip = _trip_document_from_row(trip_row)
    return {
        "entitlement": entitlement,
        "pack": pack,
        "trip": trip,
        "already_owned": already_owned,
    }


def _restore_trip_pack_entitlement_db(
    db: sqlite3.Connection,
    row: sqlite3.Row | dict,
    user_id: int,
    now: int,
) -> sqlite3.Row:
    raw = dict(row)
    trip = db.execute(
        "SELECT status FROM trip_documents_v2 WHERE user_id=? AND id=?",
        (user_id, raw["trip_id"]),
    ).fetchone()
    if not trip or trip["status"] == "deleted":
        cloned = _clone_authored_pack_trip_db(
            db, user_id, raw["pack_id"], int(raw["version"]), raw["template_json"], now,
            raw.get("content_kind") or "trip_pack", raw.get("original_manifest_json"),
        )
        db.execute(
            "UPDATE authored_trip_pack_entitlements SET trip_id=? WHERE id=?",
            (cloned["trip_id"], raw["id"]),
        )
    return db.execute(
        _trip_pack_entitlement_query() + " WHERE entitlement.id=?",
        (raw["id"],),
    ).fetchone()


def _acquire_authored_trip_pack(
    user_id: int,
    idempotency_key: str,
    *,
    pack_id: str | None = None,
    claim_month: str | None = None,
    required_content_kind: str = "trip_pack",
    requested_version: int | None = None,
) -> dict:
    idempotency_key = str(idempotency_key or "").strip()
    if not _IDEMPOTENCY_KEY_RE.fullmatch(idempotency_key):
        raise ValueError("Invalid Idempotency-Key")
    if claim_month is not None:
        claim_month = _validate_trip_pack_month(claim_month)
    if pack_id is not None:
        pack_id = _validate_canonical_id(pack_id, "trip pack id")
    if required_content_kind not in TRIP_PACK_CONTENT_KINDS:
        raise ValueError("Invalid authored content kind")
    if requested_version is not None:
        if required_content_kind != "original_drive":
            raise ValueError("Explicit versions are supported only for Trailhead Originals")
        if (
            isinstance(requested_version, bool)
            or not isinstance(requested_version, int)
            or requested_version < 1
        ):
            raise ValueError("Original version must be a positive integer")
    if claim_month is not None and requested_version is not None:
        raise ValueError("Featured claims use the selected immutable version")
    request_hash = hashlib.sha256(json.dumps({
        "pack_id": pack_id,
        "version": requested_version,
        "claim_month": claim_month,
        "mode": "featured_claim" if claim_month else "purchase",
        "content_kind": required_content_kind,
    }, separators=(",", ":"), sort_keys=True).encode("utf-8")).hexdigest()
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        replay_request = db.execute(
            """SELECT request_hash,entitlement_id
               FROM authored_trip_pack_acquisition_requests
               WHERE user_id=? AND idempotency_key=?""",
            (user_id, idempotency_key),
        ).fetchone()
        if replay_request:
            if replay_request["request_hash"] != request_hash:
                if required_content_kind == "original_drive":
                    raise OriginalAcquisitionConflictError(
                        "This Original request key was already used for a different acquisition"
                    )
                raise ValueError("Idempotency-Key was already used for a different request")
            replay = db.execute(
                _trip_pack_entitlement_query() + " WHERE entitlement.id=?",
                (replay_request["entitlement_id"],),
            ).fetchone()
            if not replay:
                raise ValueError("Acquisition request record is incomplete")
            replay = _restore_trip_pack_entitlement_db(db, replay, user_id, now)
            result = _trip_pack_entitlement_result(db, replay, already_owned=True)
            result["replayed"] = True
            result["credit_balance"] = int(db.execute(
                "SELECT credits FROM users WHERE id=?", (user_id,),
            ).fetchone()[0])
            db.commit()
            return result

        if claim_month:
            feature_table = (
                "authored_original_features"
                if required_content_kind == "original_drive"
                else "authored_trip_pack_features"
            )
            version_row = db.execute(
                f"""SELECT pack.id,pack.slug,version.*
                   FROM {feature_table} feature
                   JOIN authored_trip_packs pack ON pack.id=feature.pack_id
                   JOIN authored_trip_pack_versions version
                     ON version.pack_id=feature.pack_id AND version.version=feature.version
                   WHERE feature.period_month=? AND pack.status='published'
                     AND pack.content_kind=? AND version.content_kind=?""",
                (claim_month, required_content_kind, required_content_kind),
            ).fetchone()
            if not version_row:
                error_type = (
                    FeaturedOriginalUnavailableError
                    if required_content_kind == "original_drive"
                    else FeaturedTripPackUnavailableError
                )
                raise error_type("No featured authored experience is available this month")
            pack_id = str(version_row["id"])
        elif requested_version is not None:
            version_row = db.execute(
                """SELECT pack.id,pack.slug,version.*
                   FROM authored_trip_packs pack
                   JOIN authored_trip_pack_versions version ON version.pack_id=pack.id
                   WHERE pack.id=? AND version.version=? AND pack.status='published'
                     AND pack.content_kind=? AND version.content_kind=?""",
                (
                    pack_id,
                    requested_version,
                    required_content_kind,
                    required_content_kind,
                ),
            ).fetchone()
            if not version_row:
                raise ValueError("Published Trailhead Original version not found")
        else:
            version_row = db.execute(
                """SELECT pack.id,pack.slug,version.*
                   FROM authored_trip_packs pack
                   JOIN authored_trip_pack_versions version
                     ON version.pack_id=pack.id AND version.version=pack.current_published_version
                   WHERE pack.id=? AND pack.status='published' AND pack.content_kind=?""",
                (pack_id, required_content_kind),
            ).fetchone()
            if not version_row:
                if required_content_kind == "original_drive":
                    raise ValueError("Published Trailhead Original not found")
                raise ValueError("Published trip pack not found")

        owned_sql = (
            _trip_pack_entitlement_query()
            + " WHERE entitlement.user_id=? AND entitlement.pack_id=?"
        )
        owned_params: list[object] = [user_id, pack_id]
        if required_content_kind == "original_drive":
            owned_sql += " AND entitlement.version=?"
            owned_params.append(int(version_row["version"]))
        owned = db.execute(owned_sql, owned_params).fetchone()
        if owned:
            owned = _restore_trip_pack_entitlement_db(db, owned, user_id, now)
            db.execute(
                """INSERT INTO authored_trip_pack_acquisition_requests
                   (user_id,idempotency_key,request_hash,entitlement_id,created_at)
                   VALUES (?,?,?,?,?)""",
                (user_id, idempotency_key, request_hash, owned["id"], now),
            )
            result = _trip_pack_entitlement_result(db, owned, already_owned=True)
            result["replayed"] = False
            result["credit_balance"] = int(db.execute(
                "SELECT credits FROM users WHERE id=?", (user_id,),
            ).fetchone()[0])
            db.commit()
            return result

        user = db.execute(
            "SELECT credits,plan_type,plan_expires_at FROM users WHERE id=?", (user_id,),
        ).fetchone()
        if not user:
            raise ValueError("Account not found")
        explorer_active = _active_explorer_monitor_plan(
            user["plan_type"], user["plan_expires_at"], now,
        )
        list_price = int(version_row["price_credits"])
        latest_owned_version = None
        if required_content_kind == "original_drive":
            latest_owned_version = db.execute(
                """SELECT MAX(version) FROM authored_trip_pack_entitlements
                   WHERE user_id=? AND pack_id=? AND content_kind='original_drive'""",
                (user_id, pack_id),
            ).fetchone()[0]
        if claim_month:
            if not explorer_active:
                error_type = (
                    ExplorerOriginalClaimRequiredError
                    if required_content_kind == "original_drive"
                    else ExplorerTripPackClaimRequiredError
                )
                raise error_type("The featured monthly experience is included with Explorer")
            previous_claim = db.execute(
                """SELECT pack_id FROM authored_trip_pack_entitlements
                   WHERE user_id=? AND claim_month=?""",
                (user_id, claim_month),
            ).fetchone()
            if previous_claim:
                error_type = (
                    MonthlyOriginalClaimUsedError
                    if required_content_kind == "original_drive"
                    else MonthlyTripPackClaimUsedError
                )
                raise error_type(claim_month)
            acquisition_type = "featured_claim"
            credits_charged = 0
            explorer_discount = list_price
        elif (
            required_content_kind == "original_drive"
            and latest_owned_version is not None
            and int(version_row["version"]) > int(latest_owned_version)
        ):
            acquisition_type = "version_update"
            credits_charged = 0
            explorer_discount = 0
        elif list_price == 0:
            acquisition_type = "free"
            explorer_discount = 0
            credits_charged = 0
        else:
            acquisition_type = "purchase"
            explorer_discount = list_price * TRIP_PACK_EXPLORER_DISCOUNT_PERCENT // 100 if explorer_active else 0
            credits_charged = list_price - explorer_discount
            db.execute(
                "UPDATE users SET credits=credits-? WHERE id=? AND credits>=?",
                (credits_charged, user_id, credits_charged),
            )
            if db.execute("SELECT changes()").fetchone()[0] == 0:
                error_type = (
                    InsufficientOriginalCreditsError
                    if required_content_kind == "original_drive"
                    else InsufficientTripPackCreditsError
                )
                raise error_type(int(user["credits"] or 0), credits_charged, list_price)
            db.execute(
                """INSERT INTO credit_transactions (user_id,amount,reason,created_at)
                   VALUES (?,?,?,?)""",
                (
                    user_id,
                    -credits_charged,
                    (
                        f"Trailhead Original: {version_row['title']}"
                        if required_content_kind == "original_drive"
                        else f"Trip pack: {version_row['title']}"
                    ),
                    now,
                ),
            )

        trip = _clone_authored_pack_trip_db(
            db, user_id, pack_id, int(version_row["version"]), version_row["template_json"], now,
            version_row["content_kind"], version_row["original_manifest_json"],
        )
        entitlement_id = f"packent_{secrets.token_hex(12)}"
        db.execute(
            """INSERT INTO authored_trip_pack_entitlements
               (id,user_id,pack_id,version,content_kind,acquisition_type,list_price_credits,
                credits_charged,explorer_discount,claim_month,trip_id,
                idempotency_key,request_hash,acquired_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                entitlement_id, user_id, pack_id, int(version_row["version"]),
                required_content_kind, acquisition_type, list_price, credits_charged, explorer_discount,
                claim_month, trip["trip_id"], idempotency_key, request_hash, now,
            ),
        )
        db.execute(
            """INSERT INTO authored_trip_pack_acquisition_requests
               (user_id,idempotency_key,request_hash,entitlement_id,created_at)
               VALUES (?,?,?,?,?)""",
            (user_id, idempotency_key, request_hash, entitlement_id, now),
        )
        saved = db.execute(
            _trip_pack_entitlement_query() + " WHERE entitlement.id=?",
            (entitlement_id,),
        ).fetchone()
        result = _trip_pack_entitlement_result(db, saved, already_owned=False)
        result["replayed"] = False
        result["credit_balance"] = int(db.execute(
            "SELECT credits FROM users WHERE id=?", (user_id,),
        ).fetchone()[0])
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def acquire_authored_trip_pack(user_id: int, pack_id: str, idempotency_key: str) -> dict:
    return _acquire_authored_trip_pack(
        user_id, idempotency_key, pack_id=pack_id,
    )


def acquire_authored_original(
    user_id: int,
    pack_id: str,
    idempotency_key: str,
    version: int | None = None,
) -> dict:
    return _acquire_authored_trip_pack(
        user_id,
        idempotency_key,
        pack_id=pack_id,
        required_content_kind="original_drive",
        requested_version=version,
    )


def claim_featured_authored_trip_pack(
    user_id: int,
    idempotency_key: str,
    period_month: str | None = None,
) -> dict:
    return _acquire_authored_trip_pack(
        user_id, idempotency_key, claim_month=period_month or _utc_month(),
    )


def claim_featured_authored_original(
    user_id: int,
    idempotency_key: str,
    period_month: str | None = None,
) -> dict:
    return _acquire_authored_trip_pack(
        user_id,
        idempotency_key,
        claim_month=period_month or _utc_month(),
        required_content_kind="original_drive",
    )


def list_owned_authored_trip_packs(
    user_id: int,
    content_kind: str = "trip_pack",
) -> list[dict]:
    if content_kind not in TRIP_PACK_CONTENT_KINDS:
        raise ValueError("Invalid authored content kind")
    db = _conn()
    rows = db.execute(
        _trip_pack_entitlement_query()
        + " WHERE entitlement.user_id=? AND version.content_kind=?"
          " ORDER BY entitlement.acquired_at DESC,entitlement.id DESC",
        (user_id, content_kind),
    ).fetchall()
    results = [_trip_pack_entitlement_result(db, row, already_owned=True) for row in rows]
    db.close()
    return results


def restore_owned_authored_trip_packs(
    user_id: int,
    content_kind: str = "trip_pack",
) -> list[dict]:
    if content_kind not in TRIP_PACK_CONTENT_KINDS:
        raise ValueError("Invalid authored content kind")
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        rows = db.execute(
            _trip_pack_entitlement_query()
            + " WHERE entitlement.user_id=? AND version.content_kind=?"
              " ORDER BY entitlement.acquired_at DESC,entitlement.id DESC",
            (user_id, content_kind),
        ).fetchall()
        restored = [
            _restore_trip_pack_entitlement_db(db, row, user_id, now)
            for row in rows
        ]
        results = [_trip_pack_entitlement_result(db, row, already_owned=True) for row in restored]
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return results


def list_owned_authored_originals(user_id: int) -> list[dict]:
    return list_owned_authored_trip_packs(user_id, content_kind="original_drive")


def restore_owned_authored_originals(user_id: int) -> list[dict]:
    return restore_owned_authored_trip_packs(user_id, content_kind="original_drive")


def get_published_original_manifest(
    pack_id_or_slug: str,
    version: int,
    user_id: int | None = None,
) -> dict | None:
    clean = str(pack_id_or_slug or "").strip()
    if not isinstance(version, int) or version < 1:
        raise ValueError("Original version must be a positive integer")
    db = _conn()
    row = db.execute(
        """SELECT p.id,v.version,v.price_credits,v.original_manifest_json
           FROM authored_trip_packs p
           JOIN authored_trip_pack_versions v ON v.pack_id=p.id
           WHERE (p.id=? OR v.slug=?) AND v.version=?
             AND p.status='published' AND p.content_kind='original_drive'
             AND v.content_kind='original_drive'
           LIMIT 1""",
        (clean, clean, version),
    ).fetchone()
    if not row:
        db.close()
        return None
    if int(row["price_credits"]) > 0:
        entitled = user_id is not None and db.execute(
            """SELECT 1 FROM authored_trip_pack_entitlements
               WHERE user_id=? AND pack_id=? AND version=? LIMIT 1""",
            (user_id, row["id"], version),
        ).fetchone()
        if not entitled:
            db.close()
            raise OriginalManifestAccessError("Acquire this Original before downloading it")
    manifest = _decode_pack_json(row["original_manifest_json"], None)
    db.close()
    if not isinstance(manifest, dict):
        raise ValueError("Published Original manifest is unavailable")
    return manifest


def get_published_original_asset_record(
    pack_id: str,
    asset_id: str,
    sha256: str,
    user_id: int | None = None,
) -> dict | None:
    """Resolve an immutable uploaded asset only through an accessible manifest."""
    pack_id = _validate_canonical_id(pack_id, "Original id")
    asset_id = _validate_canonical_id(asset_id, "Original asset id")
    sha256 = str(sha256 or "").strip().lower()
    if not re.fullmatch(r"[a-f0-9]{64}", sha256):
        raise ValueError("Original asset sha256 is invalid")
    db = _conn()
    versions = db.execute(
        """SELECT v.version,v.price_credits,v.original_manifest_json
           FROM authored_trip_packs p
           JOIN authored_trip_pack_versions v ON v.pack_id=p.id
           WHERE p.id=? AND p.status='published' AND p.content_kind='original_drive'
             AND v.content_kind='original_drive'
           ORDER BY v.version DESC""",
        (pack_id,),
    ).fetchall()
    matched = False
    authorized = False
    free_access = False
    for version_row in versions:
        manifest = _decode_pack_json(version_row["original_manifest_json"], {})
        manifest_asset = next((
            asset for asset in (manifest.get("assets") or [])
            if isinstance(asset, dict)
            and asset.get("id") == asset_id
            and asset.get("sha256") == sha256
        ), None)
        if not manifest_asset:
            continue
        matched = True
        if int(version_row["price_credits"]) == 0:
            authorized = True
            free_access = True
        elif user_id is not None:
            authorized = bool(db.execute(
                """SELECT 1 FROM authored_trip_pack_entitlements
                   WHERE user_id=? AND pack_id=? AND version=? LIMIT 1""",
                (user_id, pack_id, int(version_row["version"])),
            ).fetchone())
        if authorized:
            break
    if not matched:
        db.close()
        return None
    if not authorized:
        db.close()
        raise OriginalManifestAccessError("Acquire this Original before downloading it")
    row = db.execute(
        """SELECT * FROM authored_original_assets
           WHERE pack_id=? AND asset_id=? AND sha256=?""",
        (pack_id, asset_id, sha256),
    ).fetchone()
    db.close()
    if not row:
        return None
    raw = dict(row)
    if not _original_asset_file_verified(raw):
        raise ValueError("Published Original asset failed integrity verification")
    raw["free_access"] = free_access
    return raw


def validate_original_analytics_dimensions(
    pack_id: str,
    version: int,
    stop_id: str | None = None,
    user_id: int | None = None,
) -> bool:
    """Accept analytics IDs only when they name an immutable published manifest."""
    pack_id = _validate_canonical_id(pack_id, "Original analytics pack id")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ValueError("Original analytics version is invalid")
    if stop_id is not None:
        stop_id = _validate_canonical_id(stop_id, "Original analytics stop id")
    db = _conn()
    row = db.execute(
        """SELECT v.price_credits,v.original_manifest_json
           FROM authored_trip_packs p
           JOIN authored_trip_pack_versions v ON v.pack_id=p.id
           WHERE p.id=? AND v.version=? AND p.status='published'
             AND p.content_kind='original_drive' AND v.content_kind='original_drive'""",
        (pack_id, version),
    ).fetchone()
    db.close()
    if not row:
        return False
    if int(row["price_credits"]) > 0:
        if user_id is None:
            return False
        db = _conn()
        entitled = db.execute(
            """SELECT 1 FROM authored_trip_pack_entitlements
               WHERE user_id=? AND pack_id=? AND version=? LIMIT 1""",
            (user_id, pack_id, version),
        ).fetchone()
        db.close()
        if not entitled:
            return False
    if stop_id is None:
        return True
    manifest = _decode_pack_json(row["original_manifest_json"], {})
    return any(
        isinstance(stop, dict) and stop.get("id") == stop_id
        for stop in (manifest.get("stops") or [])
    )


def authored_trip_pack_release_validation(
    minimum_published: int = 10,
    target_north_america_ratio: float = 0.70,
    tolerance: float = 0.10,
) -> dict:
    db = _conn()
    rows = db.execute(
        """SELECT current_version.coverage_region,COUNT(*) AS count
           FROM authored_trip_packs pack
           JOIN authored_trip_pack_versions current_version
             ON current_version.pack_id=pack.id
            AND current_version.version=pack.current_published_version
           WHERE pack.status='published' AND pack.content_kind='trip_pack'
           GROUP BY current_version.coverage_region"""
    ).fetchall()
    db.close()
    counts = {"north_america": 0, "global": 0}
    for row in rows:
        if row["coverage_region"] in counts:
            counts[row["coverage_region"]] = int(row["count"])
    total = counts["north_america"] + counts["global"]
    ratio = counts["north_america"] / total if total else None
    issues: list[str] = []
    if total < minimum_published:
        issues.append(f"Publish at least {minimum_published} reviewed trip packs before launch.")
    if total and abs(float(ratio) - target_north_america_ratio) > tolerance:
        issues.append("Published coverage should remain close to a 70/30 North America and global mix.")
    if total and counts["global"] == 0:
        issues.append("Add reviewed global coverage before launch.")
    return {
        "launch_ready": not issues,
        "published_total": total,
        "counts": counts,
        "north_america_ratio": ratio,
        "target_north_america_ratio": target_north_america_ratio,
        "tolerance": tolerance,
        "minimum_published": minimum_published,
        "issues": issues,
    }


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


# --- Trailhead 1.0.10 additive backend contracts ---------------------------

COMMUNITY_RATING_KINDS = {"camp", "trail", "trailhead", "place"}
COMMUNITY_RATING_MUTATION_LIMIT_PER_HOUR = 60


class CommunityRatingRateLimitError(ValueError):
    pass


def _enforce_community_rating_rate_limit(
    db: sqlite3.Connection,
    user_id: int,
    entity_kind: str,
    entity_id: str,
    action: str,
    now: int,
) -> None:
    window_start = now - 3600
    db.execute(
        "DELETE FROM community_rating_events WHERE created_at<?",
        (now - 7 * 86400,),
    )
    count = int(db.execute(
        """SELECT COUNT(*) AS count FROM community_rating_events
           WHERE user_id=? AND created_at>=?""",
        (int(user_id), window_start),
    ).fetchone()["count"])
    if count >= COMMUNITY_RATING_MUTATION_LIMIT_PER_HOUR:
        raise CommunityRatingRateLimitError(
            "Rating updates are temporarily limited. Try again later."
        )
    db.execute(
        """INSERT INTO community_rating_events
           (user_id,entity_kind,entity_id,action,created_at) VALUES (?,?,?,?,?)""",
        (int(user_id), entity_kind, entity_id, action, now),
    )


def _validate_rating_target(entity_kind: str, entity_id: str) -> tuple[str, str]:
    kind = str(entity_kind or "").strip().lower()
    if kind not in COMMUNITY_RATING_KINDS:
        raise ValueError("This place type cannot be rated")
    canonical_id = _validate_canonical_id(entity_id, "entity id")
    lowered = canonical_id.lower()
    if lowered.startswith(("viator:", "original:", "originals:", "mapbox:", "provider:")):
        raise ValueError("Only canonical Trailhead places can be rated")
    db = _conn()
    try:
        if kind == "trail":
            exists = bool(db.execute(
                "SELECT 1 FROM trail_profiles WHERE id=? LIMIT 1", (canonical_id,),
            ).fetchone())
        else:
            exists = bool(db.execute(
                "SELECT 1 FROM places WHERE trailhead_place_id=? LIMIT 1", (canonical_id,),
            ).fetchone())
    finally:
        db.close()
    if not exists:
        raise ValueError("Canonical place was not found")
    return kind, canonical_id


def get_community_rating_summary(
    entity_kind: str,
    entity_id: str,
    viewer_user_id: int | None = None,
) -> dict:
    kind, canonical_id = _validate_rating_target(entity_kind, entity_id)
    db = _conn()
    row = db.execute(
        """SELECT AVG(rating) AS average,COUNT(*) AS count
           FROM community_ratings WHERE entity_kind=? AND entity_id=?""",
        (kind, canonical_id),
    ).fetchone()
    viewer = None
    if viewer_user_id is not None:
        viewer_row = db.execute(
            """SELECT rating FROM community_ratings
               WHERE user_id=? AND entity_kind=? AND entity_id=?""",
            (int(viewer_user_id), kind, canonical_id),
        ).fetchone()
        viewer = int(viewer_row["rating"]) if viewer_row else None
    db.close()
    count = int(row["count"] or 0)
    average = round(float(row["average"]), 2) if count else None
    return {"average": average, "count": count, "viewer_rating": viewer}


def set_community_rating(
    user_id: int,
    entity_kind: str,
    entity_id: str,
    rating: int,
) -> dict:
    kind, canonical_id = _validate_rating_target(entity_kind, entity_id)
    if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
        raise ValueError("Rating must be from 1 through 5")
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute(
            """SELECT rating FROM community_ratings
               WHERE user_id=? AND entity_kind=? AND entity_id=?""",
            (int(user_id), kind, canonical_id),
        ).fetchone()
        if existing and int(existing["rating"]) == rating:
            db.commit()
            return get_community_rating_summary(kind, canonical_id, int(user_id))
        _enforce_community_rating_rate_limit(
            db, int(user_id), kind, canonical_id, "set", now,
        )
        db.execute(
            """INSERT INTO community_ratings
               (user_id,entity_kind,entity_id,rating,created_at,updated_at)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT(user_id,entity_kind,entity_id) DO UPDATE SET
                 rating=excluded.rating,updated_at=excluded.updated_at""",
            (int(user_id), kind, canonical_id, rating, now, now),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return get_community_rating_summary(kind, canonical_id, int(user_id))


def delete_community_rating(user_id: int, entity_kind: str, entity_id: str) -> dict:
    kind, canonical_id = _validate_rating_target(entity_kind, entity_id)
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute(
            """SELECT 1 FROM community_ratings
               WHERE user_id=? AND entity_kind=? AND entity_id=?""",
            (int(user_id), kind, canonical_id),
        ).fetchone()
        if not existing:
            db.commit()
            return get_community_rating_summary(kind, canonical_id, int(user_id))
        _enforce_community_rating_rate_limit(
            db, int(user_id), kind, canonical_id, "delete", now,
        )
        db.execute(
            "DELETE FROM community_ratings WHERE user_id=? AND entity_kind=? AND entity_id=?",
            (int(user_id), kind, canonical_id),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return get_community_rating_summary(kind, canonical_id, int(user_id))


def _offline_preparation_from_row(row: sqlite3.Row | dict) -> dict:
    raw = dict(row)
    item = {
        "schema_version": 2,
        "id": raw["id"],
        "status": raw["status"],
        "progress": int(raw.get("progress") or 0),
        "bundle_id": raw.get("bundle_id"),
        "revision": raw.get("revision"),
        "error": (
            {"code": raw.get("error_code"), "message": raw.get("error_message")}
            if raw.get("error_code") else None
        ),
        "created_at": int(raw["created_at"]),
        "updated_at": int(raw["updated_at"]),
        "completed_at": raw.get("completed_at"),
    }
    if raw.get("manifest_json"):
        item["manifest"] = json.loads(raw["manifest_json"])
    return item


def create_or_get_offline_bundle_preparation_v2(
    user_id: int,
    request_payload: dict,
    *,
    cache_binding: dict | None = None,
) -> tuple[dict, bool]:
    request_json = json.dumps(request_payload, sort_keys=True, separators=(",", ":"))
    hash_payload: object = request_payload
    if cache_binding:
        hash_payload = {
            "request": request_payload,
            "server_binding": cache_binding,
        }
    request_hash = hashlib.sha256(json.dumps(
        hash_payload, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    now = int(time.time())
    db = _conn()
    row = db.execute(
        """SELECT * FROM offline_bundle_preparations_v2
           WHERE user_id=? AND request_hash=?""",
        (int(user_id), request_hash),
    ).fetchone()
    created = False
    if row and (
        row["status"] == "error"
        or row["status"] == "running" and int(row["updated_at"] or 0) < now - 900
    ):
        db.execute(
            """UPDATE offline_bundle_preparations_v2
               SET status='queued',progress=0,error_code=NULL,error_message=NULL,
                   completed_at=NULL,updated_at=? WHERE id=?""",
            (now, row["id"]),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM offline_bundle_preparations_v2 WHERE id=?", (row["id"],),
        ).fetchone()
    if not row:
        preparation_id = f"offprep_{secrets.token_urlsafe(18)}"
        db.execute(
            """INSERT INTO offline_bundle_preparations_v2
               (id,user_id,request_hash,request_json,status,progress,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (preparation_id, int(user_id), request_hash, request_json, "queued", 0, now, now),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM offline_bundle_preparations_v2 WHERE id=?", (preparation_id,),
        ).fetchone()
        created = True
    db.close()
    return _offline_preparation_from_row(row), created


def get_offline_bundle_preparation_v2(
    preparation_id: str,
    user_id: int,
) -> dict | None:
    db = _conn()
    row = db.execute(
        """SELECT * FROM offline_bundle_preparations_v2
           WHERE id=? AND user_id=?""",
        (str(preparation_id), int(user_id)),
    ).fetchone()
    db.close()
    return _offline_preparation_from_row(row) if row else None


def claim_recoverable_offline_bundle_preparations_v2(
    stale_before: int,
    *,
    limit: int = 8,
    preparation_id: str | None = None,
    user_id: int | None = None,
) -> list[dict]:
    """Lease authorized queued or stale Offline V2 work for trusted runners.

    ``authorize_offline_download`` durably records the exact preparation ID in
    ``offline_downloads`` before a task is scheduled. Using that server-owned
    record as the trust boundary means a process restart can recover work
    without accepting a client assertion or accidentally running the narrow
    class of rows created just before an authorization failure.

    When a specific preparation is requested, its owner is required as part of
    the same query. The transition to ``running`` is performed under an
    immediate transaction, so repeated polls and multiple server workers can
    schedule at most one active lease for a given row.
    """
    if (preparation_id is None) != (user_id is None):
        raise ValueError("Preparation ID and user ID must be provided together")
    bounded_limit = max(1, min(int(limit), 32))
    cutoff = int(stale_before)
    now = int(time.time())
    scope_sql = ""
    scope_params: list[object] = []
    if preparation_id is not None and user_id is not None:
        scope_sql = " AND id=? AND user_id=?"
        scope_params = [str(preparation_id), int(user_id)]
    authorized_sql = """
        EXISTS (
            SELECT 1 FROM offline_downloads authorization
            WHERE authorization.user_id=offline_bundle_preparations_v2.user_id
              AND authorization.asset_type='trailhead_offline_bundle_v2'
              AND LOWER(authorization.region_id)=LOWER(offline_bundle_preparations_v2.id)
        )
    """
    db = _conn()
    work: list[dict] = []
    try:
        db.execute("BEGIN IMMEDIATE")
        db.execute(
            f"""UPDATE offline_bundle_preparations_v2
                SET status='queued',progress=0,error_code=NULL,error_message=NULL,
                    completed_at=NULL,updated_at=?
                WHERE status='running' AND updated_at<=? AND {authorized_sql}
                {scope_sql}""",
            (now, cutoff, *scope_params),
        )
        rows = db.execute(
            f"""SELECT id,user_id,request_json
                FROM offline_bundle_preparations_v2
                WHERE status='queued' AND {authorized_sql}
                {scope_sql}
                ORDER BY updated_at,id LIMIT ?""",
            (*scope_params, bounded_limit),
        ).fetchall()
        for row in rows:
            try:
                request_payload = json.loads(row["request_json"])
                if not isinstance(request_payload, dict):
                    raise ValueError("request payload is not an object")
            except (TypeError, ValueError, json.JSONDecodeError):
                db.execute(
                    """UPDATE offline_bundle_preparations_v2
                       SET status='error',progress=0,error_code=?,error_message=?,
                           updated_at=?,completed_at=?
                       WHERE id=? AND user_id=? AND status='queued'""",
                    (
                        "offline_preparation_request_invalid",
                        "This offline preparation could not be recovered.",
                        now,
                        now,
                        row["id"],
                        int(row["user_id"]),
                    ),
                )
                continue
            claimed = db.execute(
                """UPDATE offline_bundle_preparations_v2
                   SET status='running',progress=CASE WHEN progress<5 THEN 5 ELSE progress END,
                       error_code=NULL,error_message=NULL,completed_at=NULL,updated_at=?
                   WHERE id=? AND user_id=? AND status='queued'""",
                (now, row["id"], int(row["user_id"])),
            )
            if claimed.rowcount == 1:
                work.append({
                    "id": str(row["id"]),
                    "user_id": int(row["user_id"]),
                    "request_payload": request_payload,
                })
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return work


def claim_offline_bundle_preparation_v2(preparation_id: str, user_id: int) -> bool:
    db = _conn()
    now = int(time.time())
    cursor = db.execute(
        """UPDATE offline_bundle_preparations_v2
           SET status='running',progress=5,error_code=NULL,error_message=NULL,updated_at=?
           WHERE id=? AND user_id=? AND status='queued'""",
        (now, str(preparation_id), int(user_id)),
    )
    db.commit(); db.close()
    return cursor.rowcount == 1


def update_offline_bundle_preparation_progress_v2(
    preparation_id: str,
    user_id: int,
    progress: int,
) -> None:
    value = max(5, min(99, int(progress)))
    db = _conn()
    db.execute(
        """UPDATE offline_bundle_preparations_v2
           SET progress=CASE WHEN progress<? THEN ? ELSE progress END,updated_at=?
           WHERE id=? AND user_id=? AND status='running'""",
        (value, value, int(time.time()), str(preparation_id), int(user_id)),
    )
    db.commit(); db.close()


def complete_offline_bundle_preparation_v2(
    preparation_id: str,
    user_id: int,
    manifest: dict,
) -> None:
    now = int(time.time())
    db = _conn()
    cursor = db.execute(
        """UPDATE offline_bundle_preparations_v2
           SET status='ready',progress=100,bundle_id=?,revision=?,manifest_json=?,
               error_code=NULL,error_message=NULL,updated_at=?,completed_at=?
           WHERE id=? AND user_id=? AND status IN ('queued','running')""",
        (
            str(manifest.get("bundle_id") or ""), str(manifest.get("revision") or ""),
            json.dumps(manifest, sort_keys=True, separators=(",", ":")),
            now, now, str(preparation_id), int(user_id),
        ),
    )
    if cursor.rowcount != 1:
        db.rollback(); db.close()
        raise ValueError("Offline preparation is not active")
    db.commit(); db.close()


def fail_offline_bundle_preparation_v2(
    preparation_id: str,
    user_id: int,
    code: str,
    message: str,
) -> None:
    now = int(time.time())
    db = _conn()
    db.execute(
        """UPDATE offline_bundle_preparations_v2
           SET status='error',progress=0,error_code=?,error_message=?,updated_at=?,completed_at=?
           WHERE id=? AND user_id=? AND status IN ('queued','running')""",
        (str(code)[:80], str(message)[:500], now, now, str(preparation_id), int(user_id)),
    )
    db.commit(); db.close()


def register_offline_bundle_artifact_v2(
    preparation_id: str,
    artifact_id: str,
    kind: str,
    storage_path: str,
    media_type: str,
    byte_count: int,
    sha256: str,
    record_count: int | None = None,
) -> None:
    if not re.fullmatch(r"[a-f0-9]{64}", str(sha256 or "")):
        raise ValueError("Artifact SHA-256 is invalid")
    db = _conn()
    db.execute(
        """INSERT OR REPLACE INTO offline_bundle_artifacts_v2
           (preparation_id,artifact_id,kind,storage_path,media_type,byte_count,
            sha256,etag,record_count,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (
            str(preparation_id), str(artifact_id)[:220], str(kind)[:40], str(storage_path),
            str(media_type)[:120], int(byte_count), str(sha256), str(sha256),
            record_count, int(time.time()),
        ),
    )
    db.commit(); db.close()


def get_offline_bundle_artifact_v2(
    preparation_id: str,
    artifact_id: str,
    user_id: int,
) -> dict | None:
    db = _conn()
    row = db.execute(
        """SELECT artifact.* FROM offline_bundle_artifacts_v2 artifact
           JOIN offline_bundle_preparations_v2 preparation
             ON preparation.id=artifact.preparation_id
           WHERE artifact.preparation_id=? AND artifact.artifact_id=?
             AND preparation.user_id=? AND preparation.status='ready'""",
        (str(preparation_id), str(artifact_id), int(user_id)),
    ).fetchone()
    db.close()
    return dict(row) if row else None


def get_route_evidence_v1(user_id: int, trip_id: str, route_sha256: str) -> dict:
    db = _conn()
    segments = db.execute(
        """SELECT * FROM route_service_segments_v1
           WHERE user_id=? AND trip_id=? AND route_sha256=? ORDER BY sequence,id""",
        (int(user_id), trip_id, route_sha256),
    ).fetchall()
    exits = db.execute(
        """SELECT * FROM route_exit_references_v1
           WHERE user_id=? AND trip_id=? AND route_sha256=? ORDER BY route_progress,id""",
        (int(user_id), trip_id, route_sha256),
    ).fetchall()
    media = db.execute(
        """SELECT * FROM timeline_event_media_v1
           WHERE user_id=? AND trip_id=? AND route_sha256=? ORDER BY event_id,id""",
        (int(user_id), trip_id, route_sha256),
    ).fetchall()
    db.close()

    def decoded(rows: list[sqlite3.Row]) -> list[dict]:
        result = []
        for row in rows:
            item = dict(row)
            payload = json.loads(item.pop("payload_json", "{}") or "{}") if "payload_json" in item else {}
            if isinstance(payload, dict):
                item.update(payload)
            item.pop("user_id", None)
            item.pop("trip_id", None)
            item.pop("route_sha256", None)
            result.append(item)
        return result

    revisions = sorted({
        str(row["evidence_revision"])
        for row in [*segments, *exits, *media]
        if row["evidence_revision"]
    })
    revision = (
        hashlib.sha256("|".join(revisions).encode("utf-8")).hexdigest()
        if revisions else "not-checked"
    )
    return {
        "evidence_revision": revision,
        "service_segments": decoded(segments),
        "exits": decoded(exits),
        "timeline_media": decoded(media),
    }


def replace_route_evidence_v1(
    user_id: int,
    trip_id: str,
    route_sha256: str,
    evidence_revision: str,
    *,
    service_segments: list[dict] | None = None,
    exits: list[dict] | None = None,
    timeline_media: list[dict] | None = None,
) -> dict:
    """Replace trusted evidence for one exact owned route revision.

    This function is intentionally not exposed as a client write endpoint. The
    server materializer passes source-bound observations and references after
    resolving the saved route; clients can only request/read the resulting
    Brief & Backup document.
    """
    clean_trip_id = _validate_canonical_id(trip_id, "trip id")
    clean_route_sha = str(route_sha256 or "").strip().lower()
    if not re.fullmatch(r"[a-f0-9]{64}", clean_route_sha):
        raise ValueError("Route SHA-256 is invalid")
    clean_revision = str(evidence_revision or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", clean_revision):
        raise ValueError("Evidence revision is invalid")
    service_segments = service_segments or []
    exits = exits or []
    timeline_media = timeline_media or []
    if len(service_segments) > 80 or len(exits) > 80 or len(timeline_media) > 80:
        raise ValueError("Route evidence exceeds the supported size")

    def progress(value: object, label: str) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{label} is invalid") from None
        if not math.isfinite(parsed) or not 0 <= parsed <= 1:
            raise ValueError(f"{label} is invalid")
        return parsed

    def text(value: object, limit: int) -> str:
        return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]

    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        owned = db.execute(
            """SELECT 1 FROM trip_documents_v2
               WHERE user_id=? AND id=? AND deleted_at IS NULL""",
            (int(user_id), clean_trip_id),
        ).fetchone()
        if not owned:
            raise ValueError("Trip was not found")
        for table in (
            "route_service_segments_v1",
            "route_exit_references_v1",
            "timeline_event_media_v1",
        ):
            db.execute(
                f"DELETE FROM {table} WHERE user_id=? AND trip_id=? AND route_sha256=?",
                (int(user_id), clean_trip_id, clean_route_sha),
            )

        for sequence, raw in enumerate(service_segments):
            start = progress(raw.get("start_progress"), "Service segment start")
            end = progress(raw.get("end_progress"), "Service segment end")
            if end < start:
                raise ValueError("Service segment progress is reversed")
            item_id = text(raw.get("id"), 180) or (
                "route_service_" + hashlib.sha256(json.dumps(
                    [clean_route_sha, sequence, start, end, raw.get("source_label")],
                    sort_keys=True, separators=(",", ":"),
                ).encode("utf-8")).hexdigest()[:32]
            )
            payload = raw.get("details") if isinstance(raw.get("details"), dict) else {}
            db.execute(
                """INSERT INTO route_service_segments_v1
                   (id,user_id,trip_id,route_sha256,evidence_revision,sequence,
                    start_progress,end_progress,availability,source_label,source_url,
                    observed_at,updated_at,payload_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    item_id, int(user_id), clean_trip_id, clean_route_sha, clean_revision,
                    sequence, start, end, text(raw.get("availability"), 40) or "not_checked",
                    text(raw.get("source_label"), 160) or None,
                    text(raw.get("source_url"), 800) or None,
                    int(raw["observed_at"]) if raw.get("observed_at") is not None else None,
                    int(raw.get("updated_at") or now),
                    json.dumps(payload, sort_keys=True, separators=(",", ":")),
                ),
            )

        for raw in exits:
            route_progress = progress(raw.get("route_progress"), "Exit progress")
            item_id = text(raw.get("id"), 180) or (
                "route_exit_" + hashlib.sha256(json.dumps(
                    [clean_route_sha, route_progress, raw.get("label"), raw.get("source_label")],
                    sort_keys=True, separators=(",", ":"),
                ).encode("utf-8")).hexdigest()[:32]
            )
            payload = raw.get("details") if isinstance(raw.get("details"), dict) else {}
            db.execute(
                """INSERT INTO route_exit_references_v1
                   (id,user_id,trip_id,route_sha256,evidence_revision,route_progress,
                    label,availability,source_label,source_url,observed_at,updated_at,payload_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    item_id, int(user_id), clean_trip_id, clean_route_sha, clean_revision,
                    route_progress, text(raw.get("label"), 180) or "Route reference",
                    text(raw.get("availability"), 40) or "not_checked",
                    text(raw.get("source_label"), 160) or None,
                    text(raw.get("source_url"), 800) or None,
                    int(raw["observed_at"]) if raw.get("observed_at") is not None else None,
                    int(raw.get("updated_at") or now),
                    json.dumps(payload, sort_keys=True, separators=(",", ":")),
                ),
            )

        for raw in timeline_media:
            item_id = text(raw.get("id"), 180) or (
                "route_media_" + hashlib.sha256(json.dumps(
                    [clean_route_sha, raw.get("event_id"), raw.get("media_url")],
                    sort_keys=True, separators=(",", ":"),
                ).encode("utf-8")).hexdigest()[:32]
            )
            db.execute(
                """INSERT INTO timeline_event_media_v1
                   (id,user_id,trip_id,route_sha256,evidence_revision,event_id,place_id,
                    media_url,license_id,attribution,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    item_id, int(user_id), clean_trip_id, clean_route_sha, clean_revision,
                    text(raw.get("event_id"), 180), text(raw.get("place_id"), 180) or None,
                    text(raw.get("media_url"), 1000), text(raw.get("license_id"), 160),
                    text(raw.get("attribution"), 240), int(raw.get("updated_at") or now),
                ),
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return get_route_evidence_v1(int(user_id), clean_trip_id, clean_route_sha)


def create_trip_brief_and_backup_v1(
    user_id: int,
    trip_id: str,
    trip_revision: int,
    route_sha256: str,
    evidence_revision: str,
    idempotency_key: str,
    response: dict,
    credits_to_charge: int,
) -> tuple[dict, bool]:
    if not _IDEMPOTENCY_KEY_RE.fullmatch(str(idempotency_key or "")):
        raise ValueError("Invalid Idempotency-Key")
    payload_json = json.dumps(response, sort_keys=True, separators=(",", ":"))
    request_hash = hashlib.sha256(json.dumps({
        "trip_id": trip_id,
        "trip_revision": int(trip_revision),
        "route_sha256": route_sha256,
        "evidence_revision": evidence_revision,
    }, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute(
            """SELECT request_hash,response_json FROM trip_brief_and_backup_v1
               WHERE user_id=? AND idempotency_key=?""",
            (int(user_id), idempotency_key),
        ).fetchone()
        if existing:
            if existing["request_hash"] != request_hash:
                raise IdempotencyConflictError("Idempotency-Key was already used for another brief")
            db.commit()
            return json.loads(existing["response_json"]), False
        charge = max(0, int(credits_to_charge))
        if charge:
            cursor = db.execute(
                "UPDATE users SET credits=credits-? WHERE id=? AND credits>=?",
                (charge, int(user_id), charge),
            )
            if cursor.rowcount != 1:
                raise ValueError("Not enough credits")
            db.execute(
                """INSERT INTO credit_transactions
                   (user_id,amount,reason,reward_key,created_at) VALUES (?,?,?,?,?)""",
                (
                    int(user_id), -charge, "Brief & Backup",
                    f"brief-and-backup:{int(user_id)}:{idempotency_key}", int(time.time()),
                ),
            )
        db.execute(
            """INSERT INTO trip_brief_and_backup_v1
               (user_id,idempotency_key,trip_id,trip_revision,route_sha256,
                evidence_revision,request_hash,response_json,credits_charged,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                int(user_id), idempotency_key, trip_id, int(trip_revision), route_sha256,
                evidence_revision, request_hash, payload_json, charge, int(time.time()),
            ),
        )
        db.commit()
        return response, True
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


class SupportAttachmentRateLimitError(ValueError):
    pass


def create_support_attachment(
    user_id: int,
    content_type: str,
    image_data: bytes,
) -> dict:
    attachment_id = f"sat_{secrets.token_urlsafe(24)}"
    digest = hashlib.sha256(image_data).hexdigest()
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        db.execute(
            """DELETE FROM support_attachments
               WHERE message_id IS NULL AND created_at<?""",
            (now - 86400,),
        )
        recent = int(db.execute(
            """SELECT COUNT(*) FROM support_attachments
               WHERE user_id=? AND created_at>=?""",
            (int(user_id), now - 3600),
        ).fetchone()[0])
        unclaimed = int(db.execute(
            """SELECT COUNT(*) FROM support_attachments
               WHERE user_id=? AND message_id IS NULL""",
            (int(user_id),),
        ).fetchone()[0])
        if recent >= 20 or unclaimed >= 12:
            raise SupportAttachmentRateLimitError(
                "Support screenshot uploads are temporarily limited. Attach or remove pending screenshots, then try again."
            )
        db.execute(
            """INSERT INTO support_attachments
               (id,user_id,content_type,byte_count,sha256,image_data,created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (attachment_id, int(user_id), content_type, len(image_data), digest, image_data, now),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return {
        "attachment_ref": attachment_id, "content_type": content_type,
        "byte_count": len(image_data), "sha256": digest, "created_at": now,
    }


def get_support_attachment(
    attachment_id: str,
    user_id: int | None = None,
    admin: bool = False,
) -> dict | None:
    db = _conn()
    if admin:
        row = db.execute(
            "SELECT * FROM support_attachments WHERE id=?", (attachment_id,),
        ).fetchone()
    else:
        row = db.execute(
            "SELECT * FROM support_attachments WHERE id=? AND user_id=?",
            (attachment_id, int(user_id or 0)),
        ).fetchone()
    db.close()
    return dict(row) if row else None


def claim_support_attachments(
    user_id: int,
    message_id: int,
    attachment_ids: list[str],
) -> list[dict]:
    unique = list(dict.fromkeys(str(value) for value in attachment_ids))
    if len(unique) > 3:
        raise ValueError("A support message can include up to three attachments")
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        result = []
        for attachment_id in unique:
            row = db.execute(
                """SELECT id,content_type,byte_count,sha256,created_at
                   FROM support_attachments
                   WHERE id=? AND user_id=? AND message_id IS NULL""",
                (attachment_id, int(user_id)),
            ).fetchone()
            if not row:
                raise ValueError("Support attachment is unavailable")
            db.execute(
                "UPDATE support_attachments SET message_id=? WHERE id=?",
                (int(message_id), attachment_id),
            )
            item = dict(row)
            item["attachment_ref"] = item.pop("id")
            result.append(item)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def list_support_message_attachments(message_ids: list[int]) -> dict[int, list[dict]]:
    if not message_ids:
        return {}
    placeholders = ",".join("?" for _ in message_ids)
    db = _conn()
    rows = db.execute(
        f"""SELECT id,message_id,content_type,byte_count,sha256,created_at
            FROM support_attachments WHERE message_id IN ({placeholders})
            ORDER BY created_at,id""",
        [int(value) for value in message_ids],
    ).fetchall()
    db.close()
    result: dict[int, list[dict]] = {}
    for row in rows:
        item = dict(row)
        item["attachment_ref"] = item.pop("id")
        result.setdefault(int(row["message_id"]), []).append(item)
    return result


def get_referral_summary(user_id: int) -> dict:
    db = _conn()
    user = db.execute(
        "SELECT referral_code FROM users WHERE id=?", (int(user_id),),
    ).fetchone()
    rows = db.execute(
        """SELECT status,COUNT(*) AS count FROM referrals
           WHERE referrer_id=? GROUP BY status""",
        (int(user_id),),
    ).fetchall()
    credits = db.execute(
        """SELECT COALESCE(SUM(amount),0) AS credits FROM credit_transactions
           WHERE user_id=? AND reward_key LIKE 'signup-referral:%'""",
        (int(user_id),),
    ).fetchone()
    db.close()
    counts = {str(row["status"]): int(row["count"]) for row in rows}
    return {
        "referral_code": str(user["referral_code"] or "") if user else "",
        "converted_count": counts.get("converted", 0),
        "pending_count": counts.get("pending", 0),
        "credits_earned": int(credits["credits"] or 0),
    }


def issue_account_deletion_authorization(
    user_id: int,
    auth_method: str,
    ttl_seconds: int = 300,
) -> dict:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = int(time.time())
    expires_at = now + max(60, min(int(ttl_seconds), 600))
    db = _conn()
    db.execute(
        "DELETE FROM account_deletion_authorizations WHERE user_id=? OR expires_at<=?",
        (int(user_id), now),
    )
    db.execute(
        """INSERT INTO account_deletion_authorizations
           (token_hash,user_id,auth_method,issued_at,expires_at) VALUES (?,?,?,?,?)""",
        (token_hash, int(user_id), str(auth_method)[:20], now, expires_at),
    )
    db.commit(); db.close()
    return {
        "authorization_token": token,
        "expires_at": expires_at,
        "auth_method": auth_method,
    }


def consume_account_deletion_authorization(user_id: int, token: str) -> bool:
    token_hash = hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()
    now = int(time.time())
    db = _conn()
    try:
        db.execute("BEGIN IMMEDIATE")
        cursor = db.execute(
            """UPDATE account_deletion_authorizations SET used_at=?
               WHERE token_hash=? AND user_id=? AND used_at IS NULL AND expires_at>?""",
            (now, token_hash, int(user_id), now),
        )
        db.commit()
        return cursor.rowcount == 1
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
