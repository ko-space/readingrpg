from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import User, UserAchievement, PvpBattleLog

router = APIRouter(prefix="/ranking", tags=["ranking"])

ADMIN_USER_ID = 1  # 유저ID 1(닉네임 "관리자")은 모든 랭킹에서 제외
KST = timezone(timedelta(hours=9))

CATEGORIES = {
    "reading_lifetime",
    "reading_daily",
    "gold",
    "titles",
    "pvp_rank",
    "pvp_wins",
}


def _today_kst():
    return datetime.now(KST).date()


def _lobby_outfit(user: User):
    equipped = next((c for c in user.characters if c.is_equipped == 1), None)
    if equipped is None and user.characters:
        equipped = user.characters[0]
    return equipped.outfit if equipped else None


def _row(rank: int, user: User, value: int):
    return {
        "rank": rank,
        "nickname": user.nickname,
        "level": user.level,
        "lobby_outfit": _lobby_outfit(user),
        "value": value,
    }


@router.get("/{category}")
def get_ranking(category: str, db: Session = Depends(get_db), limit: int = 50):
    if category not in CATEGORIES:
        raise HTTPException(status_code=404, detail=f"존재하지 않는 랭킹 종류입니다: {category}")

    if category == "reading_lifetime":
        users = (
            db.query(User)
            .filter(User.id != ADMIN_USER_ID)
            .order_by(User.lifetime_reading_minutes.desc())
            .limit(limit)
            .all()
        )
        return [_row(i + 1, u, u.lifetime_reading_minutes) for i, u in enumerate(users)]

    if category == "reading_daily":
        # daily_reading_minutes는 유저 본인이 요청을 보낼 때만 자정(KST) 리셋이 반영되는 지연 초기화 필드다.
        # 랭킹은 남의 값을 대신 고칠 수 없으니, 여기서는 읽기 시점에만 "오늘 값인지"를 판단해서 0으로 취급한다.
        today = _today_kst()
        candidates = (
            db.query(User)
            .filter(User.id != ADMIN_USER_ID, User.daily_reading_minutes > 0)
            .all()
        )
        rows = [
            (u, u.daily_reading_minutes)
            for u in candidates
            if u.daily_reading_date == today
        ]
        rows.sort(key=lambda pair: pair[1], reverse=True)
        return [_row(i + 1, u, v) for i, (u, v) in enumerate(rows[:limit])]

    if category == "gold":
        users = (
            db.query(User)
            .filter(User.id != ADMIN_USER_ID)
            .order_by(User.gold.desc())
            .limit(limit)
            .all()
        )
        return [_row(i + 1, u, u.gold) for i, u in enumerate(users)]

    if category == "titles":
        rows = (
            db.query(User, func.count(UserAchievement.id))
            .join(UserAchievement, UserAchievement.user_id == User.id)
            .filter(User.id != ADMIN_USER_ID)
            .group_by(User.id)
            .order_by(func.count(UserAchievement.id).desc())
            .limit(limit)
            .all()
        )
        return [_row(i + 1, u, count) for i, (u, count) in enumerate(rows)]

    if category == "pvp_rank":
        users = (
            db.query(User)
            .filter(User.id != ADMIN_USER_ID, User.pvp_rank.isnot(None))
            .order_by(User.pvp_rank.asc())
            .limit(limit)
            .all()
        )
        return [_row(i + 1, u, u.pvp_rank) for i, u in enumerate(users)]

    # pvp_wins - "공격자로 참여해서 이긴 판"만 승수로 센다 (투기광 업적과 동일한 정의).
    rows = (
        db.query(User, func.count(PvpBattleLog.id))
        .join(
            PvpBattleLog,
            (PvpBattleLog.attacker_id == User.id) & (PvpBattleLog.winner_id == User.id),
        )
        .filter(User.id != ADMIN_USER_ID)
        .group_by(User.id)
        .order_by(func.count(PvpBattleLog.id).desc())
        .limit(limit)
        .all()
    )
    return [_row(i + 1, u, count) for i, (u, count) in enumerate(rows)]
