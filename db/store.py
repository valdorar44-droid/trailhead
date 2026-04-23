"""SQLite WAL store. Schema + cached queries."""
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
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            lat         REAL NOT NULL,
            lng         REAL NOT NULL,
            name        TEXT NOT NULL,
            type        TEXT NOT NULL DEFAULT 'camp',
            description TEXT,
            land_type   TEXT,
            submitted_at INTEGER NOT NULL,
            upvotes     INTEGER NOT NULL DEFAULT 0
        );
    """)
    db.commit()
    db.close()

def save_trip(trip_id: str, request: str, plan: dict):
    db = _conn()
    db.execute(
        "INSERT OR REPLACE INTO trips (id, created_at, request, plan) VALUES (?, ?, ?, ?)",
        (trip_id, int(time.time()), request, json.dumps(plan))
    )
    db.commit()
    db.close()

def get_trip(trip_id: str) -> dict | None:
    db = _conn()
    row = db.execute("SELECT plan FROM trips WHERE id = ?", (trip_id,)).fetchone()
    db.close()
    return json.loads(row["plan"]) if row else None

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

def add_community_pin(lat: float, lng: float, name: str, type: str, description: str, land_type: str):
    db = _conn()
    db.execute(
        "INSERT INTO community_pins (lat, lng, name, type, description, land_type, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (lat, lng, name, type, description, land_type, int(time.time()))
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
