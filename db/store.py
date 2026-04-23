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
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            email                    TEXT UNIQUE NOT NULL,
            username                 TEXT UNIQUE NOT NULL,
            password_hash            TEXT NOT NULL,
            credits                  INTEGER NOT NULL DEFAULT 20,
            referral_code            TEXT UNIQUE,
            referred_by              INTEGER,
            report_streak            INTEGER NOT NULL DEFAULT 0,
            last_report_date         TEXT,
            reporting_restricted_until INTEGER,
            flagged_report_count     INTEGER NOT NULL DEFAULT 0,
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
    """)
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
    ]:
        try:
            db.execute(sql)
        except Exception:
            pass
    db.commit()
    db.close()

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
    row = db.execute("SELECT plan FROM trips WHERE id=?", (trip_id,)).fetchone()
    db.close()
    return json.loads(row["plan"]) if row else None

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

# ── Users ─────────────────────────────────────────────────────────────────────

def create_user(email: str, username: str, password_hash: str, referral_code: str,
                referred_by: int | None = None) -> int:
    db = _conn()
    cur = db.execute(
        "INSERT INTO users (email,username,password_hash,referral_code,referred_by,created_at) VALUES (?,?,?,?,?,?)",
        (email.lower(), username, password_hash, referral_code, referred_by, int(time.time()))
    )
    uid = cur.lastrowid
    db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
               (uid, 20, "Welcome bonus — first adventure on us!", int(time.time())))
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
    """Return reports near any waypoint on a route."""
    db = _conn()
    now = int(time.time())
    seen, results = set(), []
    for wp in waypoints:
        lat, lng = wp.get("lat"), wp.get("lng")
        if not lat or not lng:
            continue
        rows = db.execute(
            """SELECT r.*,u.username FROM reports r
               JOIN users u ON r.user_id=u.id
               WHERE r.lat BETWEEN ? AND ? AND r.lng BETWEEN ? AND ?
               AND (r.expires_at IS NULL OR r.expires_at>?)
               ORDER BY r.severity DESC, r.upvotes DESC LIMIT 20""",
            (lat-radius_deg, lat+radius_deg, lng-radius_deg, lng+radius_deg, now)
        ).fetchall()
        for row in rows:
            if row["id"] not in seen:
                seen.add(row["id"])
                d = dict(row)
                d.pop("photo_data", None)
                d["waypoint_day"] = wp.get("day")
                results.append(d)
    db.close()
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

def confirm_report(report_id: int, user_id: int) -> bool:
    """'Still there' confirmation — resets expiry, +1 credit to confirmer."""
    db = _conn()
    row = db.execute("SELECT type,expires_at FROM reports WHERE id=?", (report_id,)).fetchone()
    if not row:
        db.close(); return False
    ttl = EXPIRY_BY_TYPE.get(row["type"], 7 * 86400)
    new_expires = int(time.time()) + ttl
    db.execute("UPDATE reports SET confirmations=confirmations+1, expires_at=? WHERE id=?",
               (new_expires, report_id))
    db.execute("UPDATE users SET credits=credits+1 WHERE id=?", (user_id,))
    db.execute("INSERT INTO credit_transactions (user_id,amount,reason,created_at) VALUES (?,?,?,?)",
               (user_id, 1, f"Confirmed report #{report_id} still active", int(time.time())))
    db.commit(); db.close()
    return True

def upvote_report(report_id: int):
    db = _conn()
    db.execute("UPDATE reports SET upvotes=upvotes+1 WHERE id=?", (report_id,))
    row = db.execute("SELECT user_id FROM reports WHERE id=?", (report_id,)).fetchone()
    if row:
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
