from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Achievement, UserAchievement
from schemas import EquipTitleRequest
from security import get_current_user
from achievements import compute_progress

router = APIRouter(prefix="/achievements", tags=["achievements"])


@router.get("/")
def list_achievements(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """전체 업적 목록 + 내 달성 현황/진행도. 히든 업적은 달성 전까지 이름/설명/보상만 "???"로 가리고,
    진행도(현재/목표)는 히든 업적도 그대로 보여준다."""
    earned_rows = {
        ua.achievement_id: ua
        for ua in db.query(UserAchievement).filter(UserAchievement.user_id == user.id).all()
    }

    result = []
    for ach in db.query(Achievement).order_by(Achievement.id.asc()).all():
        earned = ach.id in earned_rows
        locked_hidden = ach.is_hidden and not earned
        progress = compute_progress(db, user, ach)
        if earned:
            progress = {"current": progress["target"], "target": progress["target"]}

        result.append({
            "id": ach.id,
            "name": "???" if locked_hidden else ach.name,
            "description": "???" if locked_hidden else ach.description,
            "is_hidden": ach.is_hidden,
            "earned": earned,
            "equipped": earned and user.equipped_achievement_id == ach.id,
            "earned_at": earned_rows[ach.id].earned_at if earned else None,
            "progress_current": progress["current"],
            "progress_target": progress["target"],
            "reward_gold": None if locked_hidden else ach.reward_gold,
            "reward_exp": None if locked_hidden else ach.reward_exp,
            "reward_items": None if locked_hidden else ach.reward_items,
        })

    return result


@router.post("/equip")
def equip_title(
    req: EquipTitleRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """달성한 업적을 칭호로 장착한다. achievement_id가 None이면 칭호를 해제한다."""
    if req.achievement_id is None:
        user.equipped_achievement_id = None
        db.commit()
        return {"message": "칭호를 해제했습니다.", "equipped_title": None}

    owned = (
        db.query(UserAchievement)
        .filter(
            UserAchievement.user_id == user.id,
            UserAchievement.achievement_id == req.achievement_id,
        )
        .first()
    )
    if not owned:
        raise HTTPException(status_code=403, detail="아직 달성하지 않은 업적은 칭호로 장착할 수 없습니다.")

    user.equipped_achievement_id = req.achievement_id
    db.commit()

    return {"message": f"'{owned.achievement.name}' 칭호를 장착했습니다.", "equipped_title": owned.achievement.name}
