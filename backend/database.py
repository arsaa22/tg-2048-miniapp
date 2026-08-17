import sqlite3
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_DIR / "cube2048.db"


def get_connection():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row

    return connection


def init_db():
    with get_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS players (
                telegram_id INTEGER PRIMARY KEY,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                best_score INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at TEXT
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER NOT NULL,
                score INTEGER NOT NULL,
                duration_ms INTEGER,
                moves INTEGER,
                best_at_end INTEGER,
                max_tile INTEGER,
                started_at TEXT,
                ended_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)


def get_global_best():
    with get_connection() as connection:
        row = connection.execute("""
            SELECT COALESCE(MAX(best_score), 0) AS best
            FROM players
        """).fetchone()

        return int(row["best"])

def save_score(
    telegram_id: int,
    score: int,
    username: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    duration_ms: int | None = None,
    moves: int | None = None,
    best_at_end: int | None = None,
    max_tile: int | None = None,
    started_at: str | None = None,
    ended_at: str | None = None,
):
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO players (
                telegram_id,
                username,
                first_name,
                last_name,
                best_score,
                created_at,
                last_seen_at
            )
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(telegram_id) DO UPDATE SET
                username = COALESCE(excluded.username, players.username),
                first_name = COALESCE(excluded.first_name, players.first_name),
                last_name = COALESCE(excluded.last_name, players.last_name),
                best_score = MAX(players.best_score, excluded.best_score),
                last_seen_at = CURRENT_TIMESTAMP
            """,
            (
                telegram_id,
                username,
                first_name,
                last_name,
                score,
            ),
        )

        connection.execute(
            """
            INSERT INTO sessions (
                telegram_id,
                score,
                duration_ms,
                moves,
                best_at_end,
                max_tile,
                started_at,
                ended_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                telegram_id,
                score,
                duration_ms,
                moves,
                best_at_end,
                max_tile,
                started_at,
                ended_at,
            ),
        )