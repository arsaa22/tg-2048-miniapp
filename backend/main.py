from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.database import get_global_best, init_db, save_score
from backend.telegram_auth import TelegramAuthError, validate_init_data


app = FastAPI(title="Cube 2048 API")

LOCAL_FRONTEND_ORIGINS = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=LOCAL_FRONTEND_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Tg-Init-Data"],
)


class ScorePayload(BaseModel):
    score: int = Field(ge=0)
    initData: str
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
    try:
        telegram_user = validate_init_data(payload.initData)
    except TelegramAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    telegram_id = int(telegram_user["id"])

    save_score(
        telegram_id=telegram_id,
        username=telegram_user.get("username"),
        first_name=telegram_user.get("first_name"),
        last_name=telegram_user.get("last_name"),
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