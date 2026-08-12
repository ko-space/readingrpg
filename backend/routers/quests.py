from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Quest, UserQuestClaim, Item, UserItem
from schemas import QuestClaimRequest
from security import get_current_user
from leveling import apply_exp
from quests import compute_progress, current_period_key
from achievements import check_and_grant_achievements

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
        "reward_item_name": quest.reward_item_name,
        "claimed": already_claimed,
        "claimable": (not already_claimed) and progress["current"] >= progress["target"],
    }


@router.get("/")
def list_quests(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """일일/주간 퀘스트 전체 목록 + 이번 기간(KST 자정/월요일 자정 기준) 진행도/수령 가능 여부.
    기간이 넘어가면 claimed_period_keys에 저장된 지난 기간의 period_key와 더 이상 일치하지 않으므로,
    아무 것도 안 해도 자동으로 미수령 상태로 되돌아간다.

    UserQuestClaim은 (user, quest)당 지난 기간들 것까지 전부 쌓인다(하루/한 주 지날 때마다 새 행) -
    period_key로 지금 기간 것만 걸러내지 않고 전체를 quest_id 기준 dict로 모으면, 같은 quest_id에
    대해 여러 period_key 행이 있을 때 정렬 순서가 보장 안 된 쿼리 결과에서 "마지막으로 들어온 행"이
    이기게 되어 어제 것이 오늘 것을 덮어써버릴 수 있었다(클레임을 많이 쌓은 테스트 계정일수록
    잘 걸림) - 그러면 실제로는 오늘 이미 받았는데도 already_claimed가 False로 나와 "받기" 버튼이
    계속 활성 상태로 보이는 버그가 생긴다. 지금 기간(일일/주간) 것만 미리 걸러서 애초에 quest_id당
    행이 최대 하나만 나오게 하면 이 모호함 자체가 없어진다."""
    current_keys = (current_period_key("daily"), current_period_key("weekly"))
    claimed_period_keys = {
        row.quest_id: row.period_key
        for row in db.query(UserQuestClaim).filter(
            UserQuestClaim.user_id == user.id,
            UserQuestClaim.period_key.in_(current_keys),
        ).all()
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
    elif quest.reward_type == "item":
        item = db.query(Item).filter(Item.name == quest.reward_item_name).first()
        if not item:
            raise HTTPException(status_code=500, detail=f"보상 아이템 '{quest.reward_item_name}'을 찾을 수 없습니다.")
        owned = db.query(UserItem).filter(UserItem.user_id == user.id, UserItem.item_id == item.id).first()
        if owned:
            owned.quantity += quest.reward_amount
        else:
            db.add(UserItem(user_id=user.id, item_id=item.id, quantity=quest.reward_amount))

    return {
        "quest_id": quest.id,
        "name": quest.name,
        "reward_type": quest.reward_type,
        "reward_amount": quest.reward_amount,
        "reward_item_name": quest.reward_item_name,
    }


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
    new_achievements, new_characters = check_and_grant_achievements(db, user)

    return {
        "message": f"'{quest.name}' 보상을 받았습니다!",
        **result,
        "gold": user.gold,
        "level": user.level,
        "total_exp": user.total_exp,
        "new_achievements": new_achievements,
        "new_characters": new_characters,
    }


@router.post("/claim-all")
def claim_all_quests(
    period: str | None = None,  # "daily" | "weekly" | None(둘 다)
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """지금 수령 가능한 퀘스트를 전부 받는다. 하나라도 조건 미달/중복 수령이면 그 항목만 조용히
    건너뛰고, 실제로 받은 것들만 결과에 담아 돌려준다(부분 실패로 전체가 막히지 않게)."""
    # list_quests와 동일한 이유로 지금 기간 것만 걸러서 quest_id당 행이 최대 하나만 나오게 한다
    # (그렇지 않으면 지난 기간 행이 이겨서 이미 오늘 받은 퀘스트를 다시 받으려다 400을 받고 조용히
    # 건너뛰어질 수 있다).
    current_keys = (current_period_key("daily"), current_period_key("weekly"))
    claimed_period_keys = {
        row.quest_id: row.period_key
        for row in db.query(UserQuestClaim).filter(
            UserQuestClaim.user_id == user.id,
            UserQuestClaim.period_key.in_(current_keys),
        ).all()
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
    new_achievements, new_characters = check_and_grant_achievements(db, user)

    return {
        "message": f"퀘스트 보상 {len(claimed_results)}개를 받았습니다." if claimed_results else "지금 받을 수 있는 보상이 없습니다.",
        "claimed": claimed_results,
        "gold": user.gold,
        "level": user.level,
        "total_exp": user.total_exp,
        "new_achievements": new_achievements,
        "new_characters": new_characters,
    }
