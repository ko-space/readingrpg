from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Quest, UserQuestClaim
from schemas import QuestClaimRequest
from security import get_current_user
from leveling import apply_exp
from quests import compute_progress, current_period_key

router = APIRouter(prefix="/quests", tags=["quests"])


def _serialize(db: Session, user: User, quest: Quest, claimed_period_keys: dict) -> dict:
    period_key = current_period_key(quest.period)
    already_claimed = claimed_period_keys.get(quest.id) == period_key
    progress = compute_progress(db, user, quest, period_key)
    if already_claimed:
        progress = {"current": progress["target"], "target": progress["target"]}

    return {
        "id": quest.id,
        "name": quest.name,
        "period": quest.period,
        "progress_current": progress["current"],
        "progress_target": progress["target"],
        "reward_type": quest.reward_type,
        "reward_amount": quest.reward_amount,
        "claimed": already_claimed,
        "claimable": (not already_claimed) and progress["current"] >= progress["target"],
    }


@router.get("/")
def list_quests(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """일일/주간 퀘스트 전체 목록 + 이번 기간(KST 자정/월요일 자정 기준) 진행도/수령 가능 여부.
    기간이 넘어가면 claimed_period_keys에 저장된 지난 기간의 period_key와 더 이상 일치하지 않으므로,
    아무 것도 안 해도 자동으로 미수령 상태로 되돌아간다."""
    claimed_period_keys = {
        row.quest_id: row.period_key
        for row in db.query(UserQuestClaim).filter(UserQuestClaim.user_id == user.id).all()
    }

    quests = db.query(Quest).order_by(Quest.period.asc(), Quest.sort_order.asc(), Quest.id.asc()).all()
    daily = [_serialize(db, user, q, claimed_period_keys) for q in quests if q.period == "daily"]
    weekly = [_serialize(db, user, q, claimed_period_keys) for q in quests if q.period == "weekly"]
    return {"daily": daily, "weekly": weekly}


def _claim_one(db: Session, user: User, quest: Quest) -> dict:
    period_key = current_period_key(quest.period)
    already = db.query(UserQuestClaim).filter(
        UserQuestClaim.user_id == user.id,
        UserQuestClaim.quest_id == quest.id,
        UserQuestClaim.period_key == period_key,
    ).first()
    if already:
        raise HTTPException(status_code=400, detail=f"'{quest.name}' 보상은 이미 받았습니다.")

    progress = compute_progress(db, user, quest, period_key)
    if progress["current"] < progress["target"]:
        raise HTTPException(status_code=400, detail=f"'{quest.name}' 달성 조건을 아직 만족하지 못했습니다.")

    db.add(UserQuestClaim(user_id=user.id, quest_id=quest.id, period_key=period_key))

    if quest.reward_type == "gold":
        user.gold += quest.reward_amount
        user.lifetime_gold += quest.reward_amount
    elif quest.reward_type == "exp":
        apply_exp(user, quest.reward_amount)

    return {"quest_id": quest.id, "name": quest.name, "reward_type": quest.reward_type, "reward_amount": quest.reward_amount}


@router.post("/claim")
def claim_quest(
    req: QuestClaimRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    quest = db.query(Quest).filter(Quest.id == req.quest_id).first()
    if not quest:
        raise HTTPException(status_code=404, detail="존재하지 않는 퀘스트입니다.")

    result = _claim_one(db, user, quest)
    db.commit()
    db.refresh(user)

    return {
        "message": f"'{quest.name}' 보상을 받았습니다!",
        **result,
        "gold": user.gold,
        "level": user.level,
        "total_exp": user.total_exp,
    }


@router.post("/claim-all")
def claim_all_quests(
    period: str | None = None,  # "daily" | "weekly" | None(둘 다)
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """지금 수령 가능한 퀘스트를 전부 받는다. 하나라도 조건 미달/중복 수령이면 그 항목만 조용히
    건너뛰고, 실제로 받은 것들만 결과에 담아 돌려준다(부분 실패로 전체가 막히지 않게)."""
    claimed_period_keys = {
        row.quest_id: row.period_key
        for row in db.query(UserQuestClaim).filter(UserQuestClaim.user_id == user.id).all()
    }

    query = db.query(Quest)
    if period in ("daily", "weekly"):
        query = query.filter(Quest.period == period)

    claimed_results = []
    for quest in query.order_by(Quest.sort_order.asc(), Quest.id.asc()).all():
        period_key = current_period_key(quest.period)
        if claimed_period_keys.get(quest.id) == period_key:
            continue
        progress = compute_progress(db, user, quest, period_key)
        if progress["current"] < progress["target"]:
            continue
        claimed_results.append(_claim_one(db, user, quest))

    db.commit()
    db.refresh(user)

    return {
        "message": f"퀘스트 보상 {len(claimed_results)}개를 받았습니다." if claimed_results else "지금 받을 수 있는 보상이 없습니다.",
        "claimed": claimed_results,
        "gold": user.gold,
        "level": user.level,
        "total_exp": user.total_exp,
    }
