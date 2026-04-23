"""SQLite WAL store. Schema + queries."""
from __future__ import annotations
import sqlite3, json, time
from config.settings import settings

def _conn() -> sqlite3.Connection:
    db = sqlite3.connect(settings.db_path, check_same_thread=False)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
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
            plan        TEXT NOT NULL
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

        CREATE TABLE IF NOT EXISTS users (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            email        TEXT UNIQUE NOT NULL,
            username     TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            credits      INTEGER NOT NULL DEFAULT 20,
            referral_code TEXT UNIQUE,
            referred_by  INTEGER,
            created_at   INTEGER NOT NULL
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
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL,
            lat          REAL NOT NULL,
            lng          REAL NOT NULL,
            type         TEXT NOT NULL,
            subtype      TEXT,
            description  TEXT,
            severity     TEXT DEFAULT 'moderate',
            upvotes      INTEGER NOT NULL DEFAULT 0,
            downvotes    INTEGER NOT NULL DEFAULT 0,
            created_at   INTEGER NOT NULL,
            expires_at   INTEGER,
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
    """)
    db.commit()
    db.close()

# ── Trips ─────────────────────────────────────────────────────────────────────

def save_trip(trip_id: str, request: str, plan: dict, user_id: int | None = None):
    db = _conn()
    db.execute(
        "INSERT OR REPLACE INTO trips (id, user_id, created_at, request, plan) VALUES (?, ?, ?, ?, ?)",
        (trip_id, user_id, int(time.time()), request, json.dumps(plan))
    )
    db.commit()
    db.close()

def get_trip(trip_id: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT plan FROM trips WHERE id = ?", (trip_id,)).fetchone()
    db.close()
    return json.loads(row["plan"]) if row else None

# ── Cache ─────────────────────────────────────────────────────────────────────

def get_cached(table: str, key: str, ttl_seconds: int = 86400) -> list | None:
    db = _conn()
    row = db.execute(f"SELECT fetched_at, data FROM {table} WHERE cache_key = ?", (key,)).fetchone()
    db.close()
    if row and (time.time() - row["fetched_at"]) < ttl_seconds:
        return json.loads(row["data"])
    return None

def set_cached(table: str, key: str, data: list):
    db = _conn()
    db.execute(
        f"INSERT OR REPLACE INTO {table} (cache_key, fetched_at, data) VALUES (?, ?, ?)",
        (key, int(time.time()), json.dumps(data))
    )
    db.commit()
    db.close()

# ── Users ─────────────────────────────────────────────────────────────────────

def create_user(email: str, username: str, password_hash: str, referral_code: str, referred_by: int | None = None) -> int:
    db = _conn()
    cur = db.execute(
        "INSERT INTO users (email, username, password_hash, referral_code, referred_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (email.lower(), username, password_hash, referral_code, referred_by, int(time.time()))
    )
    user_id = cur.lastrowid
    # Signup bonus
    db.execute("INSERT INTO credit_transactions (user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)",
               (user_id, 20, "Welcome bonus — first trip on us!", int(time.time())))
    db.commit()
    db.close()
    return user_id

def get_user_by_email(email: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM users WHERE email = ?", (email.lower(),)).fetchone()
    db.close()
    return dict(row) if row else None

def get_user_by_id(user_id: int) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    db.close()
    return dict(row) if row else None

def get_user_by_referral_code(code: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT * FROM users WHERE referral_code = ?", (code,)).fetchone()
    db.close()
    return dict(row) if row else None

def add_credits(user_id: int, amount: int, reason: str):
    db = _conn()
    db.execute("UPDATE users SET credits = credits + ? WHERE id = ?", (amount, user_id))
    db.execute("INSERT INTO credit_transactions (user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)",
               (user_id, amount, reason, int(time.time())))
    db.commit()
    db.close()

def get_credit_history(user_id: int, limit: int = 20) -> list:
    db = _conn()
    rows = db.execute(
        "SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
        (user_id, limit)
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]

# ── Reports ───────────────────────────────────────────────────────────────────

def create_report(user_id: int, lat: float, lng: float, type: str, subtype: str,
                  description: str, severity: str) -> int:
    db = _conn()
    expires = int(time.time()) + 86400 * 2  # 48h default
    cur = db.execute(
        "INSERT INTO reports (user_id, lat, lng, type, subtype, description, severity, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, lat, lng, type, subtype, description, severity, int(time.time()), expires)
    )
    report_id = cur.lastrowid
    db.commit()
    db.close()
    return report_id

def get_reports_near(lat: float, lng: float, radius_deg: float = 0.5) -> list:
    db = _conn()
    now = int(time.time())
    rows = db.execute(
        """SELECT r.*, u.username FROM reports r
           JOIN users u ON r.user_id = u.id
           WHERE r.lat BETWEEN ? AND ? AND r.lng BETWEEN ? AND ?
           AND (r.expires_at IS NULL OR r.expires_at > ?)
           ORDER BY r.created_at DESC LIMIT 50""",
        (lat - radius_deg, lat + radius_deg, lng - radius_deg, lng + radius_deg, now)
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]

def downvote_report(report_id: int):
    db = _conn()
    db.execute("UPDATE reports SET downvotes = downvotes + 1 WHERE id = ?", (report_id,))
    # Check if report should be flagged (5+ downvotes = auto-expire)
    row = db.execute("SELECT user_id, downvotes FROM reports WHERE id = ?", (report_id,)).fetchone()
    if row and row["downvotes"] >= 5:
        db.execute("UPDATE reports SET expires_at = ? WHERE id = ?", (int(time.time()), report_id))
        # Dock 5 credits from submitter for false report
        db.execute("UPDATE users SET credits = MAX(0, credits - 5) WHERE id = ?", (row["user_id"],))
        db.execute("INSERT INTO credit_transactions (user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)",
                   (row["user_id"], -5, f"Report #{report_id} flagged as inaccurate", int(time.time())))
    db.commit()
    db.close()

def upvote_report(report_id: int) -> bool:
    db = _conn()
    db.execute("UPDATE reports SET upvotes = upvotes + 1 WHERE id = ?", (report_id,))
    row = db.execute("SELECT user_id FROM reports WHERE id = ?", (report_id,)).fetchone()
    db.commit()
    if row:
        db.execute("INSERT INTO credit_transactions (user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)",
                   (row["user_id"], 2, f"Report #{report_id} upvoted", int(time.time())))
        db.execute("UPDATE users SET credits = credits + 2 WHERE id = ?", (row["user_id"],))
        db.commit()
    db.close()
    return True

# ── Community pins ─────────────────────────────────────────────────────────────

def add_community_pin(lat: float, lng: float, name: str, type: str, description: str,
                      land_type: str, user_id: int | None = None):
    db = _conn()
    db.execute(
        "INSERT INTO community_pins (user_id, lat, lng, name, type, description, land_type, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, lat, lng, name, type, description, land_type, int(time.time()))
    )
    db.commit()
    db.close()

def get_community_pins(lat: float, lng: float, radius_deg: float = 1.0) -> list:
    db = _conn()
    rows = db.execute(
        """SELECT * FROM community_pins
           WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
           ORDER BY upvotes DESC LIMIT 100""",
        (lat - radius_deg, lat + radius_deg, lng - radius_deg, lng + radius_deg)
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]
