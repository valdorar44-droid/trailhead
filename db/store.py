"""SQLite WAL store. Schema + queries."""
from __future__ import annotations
import sqlite3, json, time, math
from config.settings import settings

# Report expiry by type (seconds)
EXPIRY_BY_TYPE = {
    'police':       2  * 3600,
    'cell_signal':  24 * 3600,
    'wildlife':     24 * 3600,
    'water':        3  * 86400,
    'road_condition': 7 * 86400,
    'hazard':       7  * 86400,
    'campsite':     14 * 86400,
    'closure':      30 * 86400,
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
            request     TEXT NOT NULL,
            plan        TEXT NOT NULL,
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
            land_type    TEXT,
            submitted_at INTEGER NOT NULL,
            upvotes      INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS stripe_purchases (
            session_id  TEXT PRIMARY KEY,
            user_id     INTEGER NOT NULL,
            credits     INTEGER NOT NULL,
            created_at  INTEGER NOT NULL
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
    """)
    # Performance indexes (IF NOT EXISTS is safe to re-run)
    for idx_sql in [
        "CREATE INDEX IF NOT EXISTS idx_reports_geo ON reports(lat, lng, expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_reports_user_type ON reports(user_id, type, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_pins_geo ON community_pins(lat, lng)",
        "CREATE INDEX IF NOT EXISTS idx_fullness_geo ON camp_fullness(lat, lng, status, expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_credits_user ON credit_transactions(user_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_analytics_session ON analytics_events(session_id, event_type)",
        "CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_route_cache_time ON route_cache(fetched_at)",
        "CREATE INDEX IF NOT EXISTS idx_offline_downloads_user ON offline_downloads(user_id, asset_type, created_at)",
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
        "ALTER TABLE trips ADD COLUMN audio_guide TEXT",
        "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE trips ADD COLUMN user_id INTEGER",
        "CREATE TABLE IF NOT EXISTS stripe_purchases (session_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, credits INTEGER NOT NULL, created_at INTEGER NOT NULL)",
        "ALTER TABLE users ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'free'",
        "ALTER TABLE users ADD COLUMN plan_expires_at INTEGER",
        "ALTER TABLE users ADD COLUMN camp_searches_used INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN push_token TEXT",
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
    ]:
        try:
            db.execute(sql)
        except Exception:
            pass
    db.commit()
    db.close()

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
    db.execute(
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
    db.execute(
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
    db.execute(
        "INSERT OR REPLACE INTO trips (id, user_id, created_at, request, plan) VALUES (?,?,?,?,?)",
        (trip_id, user_id, int(time.time()), request, json.dumps(plan))
    )
    db.commit(); db.close()

def get_trip(trip_id: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT user_id, plan, audio_guide FROM trips WHERE id=?", (trip_id,)).fetchone()
    db.close()
    if not row:
        return None
    result = json.loads(row["plan"])
    result["user_id"] = row["user_id"]  # used for ownership check in the route
    if row["audio_guide"]:
        result["audio_guide"] = json.loads(row["audio_guide"])
    return result

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
        "INSERT INTO users (email,username,password_hash,referral_code,referred_by,created_at) VALUES (?,?,?,?,?,?)",
        (email.lower(), username, password_hash, referral_code, referred_by, int(time.time()))
    )
    uid = cur.lastrowid
    db.commit(); db.close()
    return uid

def get_user_by_email(email: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM users WHERE email=?", (email.lower(),)).fetchone()
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
    db.execute("DELETE FROM report_interactions WHERE user_id=?",    (user_id,))
    db.execute("DELETE FROM camp_field_reports  WHERE user_id=?",    (user_id,))
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

def add_credits(user_id: int, amount: int, reason: str):
    db = _conn()
    db.execute("UPDATE users SET credits=MAX(0,credits+?) WHERE id=?", (amount, user_id))
    db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
               (user_id, amount, reason, int(time.time())))
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
    if streak == 3:   bonus, bonus_reason = 25,  "3-day reporting streak! 🔥"
    elif streak == 7:  bonus, bonus_reason = 50,  "7-day streak legend! 🏆"
    elif streak == 30: bonus, bonus_reason = 200, "30-day streak — you're a trailblazer! 🌟"

    db.execute("UPDATE users SET report_streak=?, last_report_date=? WHERE id=?", (streak, today, user_id))
    if bonus:
        db.execute("UPDATE users SET credits=credits+? WHERE id=?", (bonus, user_id))
        db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
                   (user_id, bonus, bonus_reason, int(time.time())))
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
    db.execute("UPDATE users SET credits=credits+1 WHERE id=?", (user_id,))
    db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
               (user_id, 1, f"Confirmed report #{report_id} still active", int(time.time())))
    db.execute("INSERT INTO report_interactions (report_id,user_id,action,created_at) VALUES (?,?,?,?)",
               (report_id, user_id, "confirm", int(time.time())))
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
    db.execute("UPDATE users SET credits=credits+2 WHERE id=?", (row["user_id"],))
    db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
               (row["user_id"], 2, f"Report #{report_id} upvoted", int(time.time())))
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

# ── Community pins ─────────────────────────────────────────────────────────────

def add_community_pin(lat: float, lng: float, name: str, type: str,
                      description: str, land_type: str, user_id: int | None = None):
    db = _conn()
    db.execute(
        "INSERT INTO community_pins (user_id,lat,lng,name,type,description,land_type,submitted_at) VALUES (?,?,?,?,?,?,?,?)",
        (user_id, lat, lng, name, type, description, land_type, int(time.time()))
    )
    db.commit(); db.close()

def get_community_pins(lat: float, lng: float, radius_deg: float = 1.0) -> list:
    db = _conn()
    rows = db.execute(
        """SELECT * FROM community_pins
           WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
           ORDER BY upvotes DESC LIMIT 100""",
        (lat-radius_deg, lat+radius_deg, lng-radius_deg, lng+radius_deg)
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]

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
                  u.reporting_restricted_until,
                  COUNT(r.id) as report_count
           FROM users u
           LEFT JOIN reports r ON r.user_id=u.id
           WHERE u.username LIKE ? OR u.email LIKE ?
           GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?""",
        (like, like, limit, offset)
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]

def set_user_admin(user_id: int, is_admin: bool):
    db = _conn()
    db.execute("UPDATE users SET is_admin=? WHERE id=?", (1 if is_admin else 0, user_id))
    db.commit(); db.close()

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
    return [dict(r) for r in rows]

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

def submit_bug_report(user_id: int | None, username: str | None, title: str, description: str, app_version: str = '') -> int:
    db = _conn()
    cur = db.execute(
        "INSERT INTO bug_reports (user_id,username,title,description,app_version,created_at) VALUES (?,?,?,?,?,?)",
        (user_id, username, title, description, app_version, int(time.time()))
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
        db.execute("UPDATE users SET is_admin=1 WHERE email=?", (email.lower(),))
        db.commit(); db.close()
        return
    import secrets as _secrets
    code = f"admin-{_secrets.token_hex(4)}"
    db.execute(
        "INSERT INTO users (email,username,password_hash,referral_code,is_admin,created_at) VALUES (?,?,?,?,1,?)",
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

def authorize_offline_download(user: dict, asset_type: str, region_id: str, cost: int, reason: str) -> dict:
    """Authorize one offline map/routing asset.

    Plan users are free. Free users get one state map and one state routing pack,
    then pay credits. Re-downloading an already-authorized asset is free.
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

      if has_active_plan(user):
          db.execute(
              "INSERT OR IGNORE INTO offline_downloads (user_id,asset_type,region_id,cost,free_used,created_at) VALUES (?,?,?,?,?,?)",
              (user_id, asset_type, region_id, 0, 0, now),
          )
          db.commit()
          return {"authorized": True, "charged": 0, "free_used": False, "plan": True, "credits": user.get("credits", 0)}

      free_allowed = asset_type in ("state_map", "state_route") and region_id != "conus"
      if free_allowed:
          free_count = db.execute(
              "SELECT COUNT(*) AS c FROM offline_downloads WHERE user_id=? AND asset_type=? AND free_used=1",
              (user_id, asset_type),
          ).fetchone()["c"]
          if free_count == 0:
              db.execute(
                  "INSERT OR IGNORE INTO offline_downloads (user_id,asset_type,region_id,cost,free_used,created_at) VALUES (?,?,?,?,?,?)",
                  (user_id, asset_type, region_id, 0, 1, now),
              )
              db.commit()
              return {"authorized": True, "charged": 0, "free_used": True, "credits": user.get("credits", 0)}
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
    db.execute(
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
