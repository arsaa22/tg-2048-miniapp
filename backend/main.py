from fastapi import FastAPI
from pydantic import BaseModel, Field

from backend.database import get_global_best, init_db, save_score


app = FastAPI(title="Cube 2048 API")


class ScorePayload(BaseModel):
    score: int = Field(ge=0)
    initData: str | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    moves: int | None = Field(default=None, ge=0)
    best_at_end: int | None = Field(default=None, ge=0)
    max_tile: int | None = Field(default=None, ge=0)
    started_at: str | None = None
    ended_at: str | None = None


@app.on_event("startup")
def startup():
    init_db()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/best")
def best():
    return {"best": get_global_best()}


@app.post("/score")
def submit_score(payload: ScorePayload):
    # ВРЕМЕННО: локальный тестовый пользователь.
    # Позже telegram_id будем получать из проверенного Telegram initData.
    telegram_id = 0

    save_score(
        telegram_id=telegram_id,
        score=payload.score,
        duration_ms=payload.duration_ms,
        moves=payload.moves,
        best_at_end=payload.best_at_end,
        max_tile=payload.max_tile,
        started_at=payload.started_at,
        ended_at=payload.ended_at,
    )

    return {
        "ok": True,
        "best": get_global_best(),
    }