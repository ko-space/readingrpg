"""
일일/주간 퀘스트 조건 판정 엔진. achievements.py와 같은 철학을 따른다: 조건은 코드가 아니라
condition_type/condition_params(seed.py의 데이터)로 표현하고, 정말 새로운 "종류"의 조건이 생길 때만
compute_progress()의 if/elif 사슬에 분기 하나를 추가한다.

업적과 다른 점 하나: 업적은 UserAchievement로 "달성 여부"를 영구히 저장하지만, 퀘스트는 유저별 진행
상태를 저장하지 않는다. 대신 "지금이 속한 기간(일일=KST 자정마다, 주간=KST 월요일 자정마다)" 동안 쌓인
로그(ReadingLog/PvpBattleLog/ActivityLog)만 그때그때 세어서 진행도를 계산한다 - 그래서 기간이 바뀌면
아무 것도 안 해도 자동으로 0부터 다시 시작된다. UserQuestClaim은 "이번 기간에 이미 보상을 받았는지"만
표시하는 용도다.
"""
from datetime import datetime, timezone, timedelta, date, time
from sqlalchemy.orm import Session

from models import ReadingLog, PvpBattleLog, ActivityLog, UserQuestClaim

KST = timezone(timedelta(hours=9))


def _daily_period_key(today: date | None = None) -> str:
    d = today or datetime.now(KST).date()
    return d.isoformat()


def _daily_bounds_kst(period_key: str):
    d = date.fromisoformat(period_key)
    start = datetime.combine(d, time.min, tzinfo=KST)
    return start, start + timedelta(days=1)


def _weekly_period_key(today: date | None = None) -> str:
    d = today or datetime.now(KST).date()
    monday = d - timedelta(days=d.weekday())
    return f"W{monday.isoformat()}"  # 일일 키("2026-07-20")와 절대 안 겹치도록 접두어를 붙임


def _weekly_bounds_kst(period_key: str):
    monday = date.fromisoformat(period_key[1:])  # 맨 앞 "W" 제거
    start = datetime.combine(monday, time.min, tzinfo=KST)
    return start, start + timedelta(days=7)


def current_period_key(period: str) -> str:
    return _daily_period_key() if period == "daily" else _weekly_period_key()


def _bounds_utc_naive(period: str, period_key: str):
    """DB의 created_at은 datetime.utcnow() 기준 naive datetime이라, KST로 계산한 기간 경계를
    naive UTC로 변환해야 그대로 비교 필터에 쓸 수 있다."""
    start_kst, end_kst = (
        _daily_bounds_kst(period_key) if period == "daily" else _weekly_bounds_kst(period_key)
    )
    to_utc_naive = lambda dt: dt.astimezone(timezone.utc).replace(tzinfo=None)
    return to_utc_naive(start_kst), to_utc_naive(end_kst)


def compute_progress(db: Session, user, quest, period_key: str) -> dict:
    """조건 타입별로 (현재값, 목표값)을 계산한다. 화면의 진행도("3/6")와 수령 가능 여부 판정이 항상
    같은 숫자를 보도록 하는 단일 지점이다."""
    ctype = quest.condition_type
    params = quest.condition_params or {}
    target = quest.condition_target or 1
    current = 0
    start, end = _bounds_utc_naive(quest.period, period_key)

    if ctype == "session_minutes":
        rows = db.query(ReadingLog.reading_minutes).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type == params.get("session_type"),
            ReadingLog.created_at >= start,
            ReadingLog.created_at < end,
        ).all()
        current = sum(minutes for (minutes,) in rows)
    elif ctype == "session_count":
        q = db.query(ReadingLog).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type == params.get("session_type"),
            ReadingLog.created_at >= start,
            ReadingLog.created_at < end,
        )
        if params.get("difficulty"):
            q = q.filter(ReadingLog.difficulty == params["difficulty"])
        if params.get("session_type") == "mock_exam":
            # 모의고사는 "풀었다"로 인정되려면 타이머가 끝까지 흘러 자동 제출된 것이어야 한다
            # (포기하기로 중도 종료한 기록은 세지 않음).
            q = q.filter(ReadingLog.is_auto_complete == True)
        current = q.count()
    elif ctype == "pvp_battle_count":
        current = db.query(PvpBattleLog).filter(
            PvpBattleLog.attacker_id == user.id,
            PvpBattleLog.created_at >= start,
            PvpBattleLog.created_at < end,
        ).count()
    elif ctype == "activity_count":
        current = db.query(ActivityLog).filter(
            ActivityLog.user_id == user.id,
            ActivityLog.activity_type == params.get("activity_type"),
            ActivityLog.created_at >= start,
            ActivityLog.created_at < end,
        ).count()
    elif ctype == "quest_claims_in_period":
        current = db.query(UserQuestClaim).filter(
            UserQuestClaim.user_id == user.id,
            UserQuestClaim.period_key == period_key,
            UserQuestClaim.quest_id != quest.id,
        ).count()

    return {"current": max(0, min(current, target)), "target": target}


def log_login_activity(db: Session, user_id: int) -> None:
    """접속(로그인) 활동을 하루 한 번만 기록한다 - 같은 날 여러 번 로그인해도 "접속 1회"로만
    취급되도록, 오늘자(KST) 기록이 이미 있으면 새로 남기지 않는다."""
    start, end = _bounds_utc_naive("daily", _daily_period_key())
    exists = db.query(ActivityLog).filter(
        ActivityLog.user_id == user_id,
        ActivityLog.activity_type == "login",
        ActivityLog.created_at >= start,
        ActivityLog.created_at < end,
    ).first()
    if not exists:
        db.add(ActivityLog(user_id=user_id, activity_type="login"))
        db.commit()
