import os
from datetime import datetime, timedelta, timezone

import jwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy.orm import Session

from database import get_db
from models import User

load_dotenv()  # database.py가 먼저 import되지 않는 경우에도 .env가 확실히 로드되도록

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-secret-change-me")  # 배포 전 반드시 .env로 교체
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

# 중복 로그인 차단: 하트비트가 이 시간(초)보다 오래 끊기면 세션이 죽은 것으로 보고 다른 곳에서 로그인 가능.
SESSION_TIMEOUT_SECONDS = 90

bearer_scheme = HTTPBearer()


def verify_google_id_token(token: str) -> dict:
    """
    클라이언트(구글 로그인 SDK)가 넘겨준 id_token을 구글 서버 기준으로 검증한다.
    반환값에는 최소한 'sub'(구글 고유 유저 ID), 'email'이 들어있다.
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="서버에 GOOGLE_CLIENT_ID가 설정되어 있지 않습니다."
        )
    try:
        payload = google_id_token.verify_oauth2_token(
            token, google_requests.Request(), GOOGLE_CLIENT_ID
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 구글 로그인 토큰입니다.")
    return payload


def create_access_token(user_id: int, session_id: str | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expire, "sid": session_id}
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    Authorization: Bearer <access_token> 헤더를 검증하고, 해당하는 User row를 반환한다.
    이제부터 모든 '내 정보를 바꾸는' 엔드포인트는 요청 바디의 nickname이 아니라
    이 함수가 반환하는 user를 신뢰한다 — 클라이언트가 임의로 다른 사람 행세를 할 수 없다.
    """
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload.get("sub"))
        session_id = payload.get("sid")
    except (jwt.PyJWTError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="인증 정보가 유효하지 않습니다. 다시 로그인해주세요."
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="존재하지 않는 사용자입니다.")

    # 이 토큰이 발급된 이후 다른 기기/브라우저에서 새로 로그인해 세션이 넘어갔다면 여기서 걸러낸다.
    # active_session_id가 아직 없는 유저(구버전 토큰, sid 클레임 없음)는 마이그레이션 과도기라 통과시킨다.
    if user.active_session_id and session_id != user.active_session_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="다른 기기에서 로그인되어 세션이 종료되었습니다.",
        )
    return user