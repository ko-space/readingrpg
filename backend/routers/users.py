from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
from database import get_db
from models import User, Region, Item, UserItem
from schemas import NicknameUpdateRequest
from security import get_current_user
from achievements import get_equipped_title_info
from routers.story import STORY_TICKET_ITEM_NAME
from quests import log_login_activity

router = APIRouter(prefix="/users", tags=["users"])

KST = timezone(timedelta(hours=9))

def _today_kst():
    return datetime.now(KST).date()


def _reset_daily_reading_if_needed(user: User, db: Session):
    """자정(KST)이 지난 뒤 아직 아무것도 안 읽었다면, /logs/가 아직 리셋을 못 해준 상태이므로
    조회 시점에 미리 0으로 보여준다(그리고 그대로 저장까지 해서 DB도 최신 상태로 맞춰둔다)."""
    today = _today_kst()
    if user.daily_reading_date != today:
        user.daily_reading_minutes = 0
        user.daily_reading_date = today
        db.commit()
        db.refresh(user)


def _story_ticket_count(user: User, db: Session) -> int:
    ticket_item = db.query(Item).filter(Item.name == STORY_TICKET_ITEM_NAME).first()
    if not ticket_item:
        return 0
    owned = db.query(UserItem).filter(
        UserItem.user_id == user.id, UserItem.item_id == ticket_item.id
    ).first()
    return owned.quantity if owned else 0


def _build_profile(user: User, db: Session):
    equipped = next((c for c in user.characters if c.is_equipped == 1), None)
    if equipped is None and user.characters:
        equipped = user.characters[0]

    region = db.query(Region).filter(Region.id == user.current_region_id).first()
    equipped_title, equipped_title_is_hidden = get_equipped_title_info(db, user)

    return {
        "message": f"환영합니다, {user.nickname}님!",
        "user_info": {
            "id": user.id,
            "nickname": user.nickname,
            "level": user.level,
            "total_exp": user.total_exp,
            "lifetime_exp": user.lifetime_exp,
            "gold": user.gold,
            "gacha_points": user.gacha_points,
            "story_ticket_count": _story_ticket_count(user, db),
            "daily_reading_minutes": user.daily_reading_minutes,
            "equipped_title": equipped_title,
            "equipped_title_is_hidden": equipped_title_is_hidden
        },
        "character_info": {
            "job_class": equipped.job_class,
            "outfit": equipped.outfit
        } if equipped else None,
        "region_info": {
            "name": region.name,
            "description": region.description,
            "exp_rate": region.exp_rate,
            "gold_rate": region.gold_rate
        } if region else None
    }


@router.get("/")
def get_users(db: Session = Depends(get_db)):
    return db.query(User).all()


@router.get("/me")
def get_my_profile(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """토큰으로 인증된 '나'의 정보. 예전의 login_user 역할을 대체한다."""
    _reset_daily_reading_if_needed(current_user, db)
    # 퀘스트("접속 N회"/"18시 이후 접속") 판정용. 토큰은 7일간 유효해서 실제 구글 로그인 절차(auth.py)를
    # 매일 다시 타지 않으므로, "접속"의 실질적 의미에 맞게 홈 화면 진입(=이 엔드포인트 호출)마다 기록한다.
    # log_login_activity 자체가 KST 기준 하루 1번만 남기므로 여기서 매번 불러도 중복 기록되지 않는다.
    log_login_activity(db, current_user.id)
    return _build_profile(current_user, db)


@router.post("/nickname")
def update_nickname(
    req: NicknameUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """설정 화면에서 닉네임을 변경한다. 형식 검증은 스키마(NicknameUpdateRequest)가 이미 처리했으니
    여기서는 '자기 자신 제외 중복'만 확인하면 된다."""
    if req.nickname == user.nickname:
        return {"message": "지금과 같은 닉네임이에요.", "nickname": user.nickname}

    exists = (
        db.query(User)
        .filter(User.nickname == req.nickname, User.id != user.id)
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="이미 존재하는 닉네임입니다.")

    user.nickname = req.nickname
    db.commit()

    return {"message": "닉네임을 변경했습니다.", "nickname": user.nickname}


@router.get("/{nickname}")
def get_user_profile(nickname: str, db: Session = Depends(get_db)):
    """공개 프로필 조회. 로그인/인증 목적이 아니라 랭킹 등에서 남의 프로필 보는 용도."""
    user = db.query(User).filter(User.nickname == nickname).first()
    if not user:
        raise HTTPException(status_code=404, detail="존재하지 않는 닉네임입니다.")
    return _build_profile(user, db)