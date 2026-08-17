import hashlib
import hmac
import json
import os
import time
from urllib.parse import parse_qsl

from dotenv import load_dotenv


load_dotenv()

MAX_AUTH_AGE_SECONDS = 24 * 60 * 60


class TelegramAuthError(ValueError):
    pass


def validate_init_data(init_data: str) -> dict:
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")

    if not bot_token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")

    if not init_data:
        raise TelegramAuthError("initData is empty")

    data = dict(parse_qsl(init_data, keep_blank_values=True))

    received_hash = data.pop("hash", None)

    if not received_hash:
        raise TelegramAuthError("hash is missing")

    data_check_string = "\n".join(
        f"{key}={value}"
        for key, value in sorted(data.items())
    )

    secret_key = hmac.new(
        key=b"WebAppData",
        msg=bot_token.encode(),
        digestmod=hashlib.sha256,
    ).digest()

    calculated_hash = hmac.new(
        key=secret_key,
        msg=data_check_string.encode(),
        digestmod=hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(calculated_hash, received_hash):
        raise TelegramAuthError("invalid Telegram signature")

    auth_date_raw = data.get("auth_date")

    if not auth_date_raw:
        raise TelegramAuthError("auth_date is missing")

    try:
        auth_date = int(auth_date_raw)
    except ValueError as exc:
        raise TelegramAuthError("invalid auth_date") from exc

    age = int(time.time()) - auth_date

    if age < -60 or age > MAX_AUTH_AGE_SECONDS:
        raise TelegramAuthError("initData is expired")

    user_raw = data.get("user")

    if not user_raw:
        raise TelegramAuthError("user is missing")

    try:
        user = json.loads(user_raw)
    except json.JSONDecodeError as exc:
        raise TelegramAuthError("invalid user data") from exc

    if "id" not in user:
        raise TelegramAuthError("Telegram user id is missing")

    return user