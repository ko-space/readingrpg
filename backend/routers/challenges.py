from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Challenge, UserChallengeClaim
from schemas import ChallengeClaimRequest
from security import get_current_user
from leveling import apply_exp
from challenges import compute_progress
from achievements import _grant_reward_items, _character_reveal_dict

router = APIRouter(prefix="/challenges", tags=["challenges"])


def _serialize(db: Session, user: User, challenge: Challenge, claimed_ids: set) -> dict:
    already_claimed = challenge.id in claimed_ids
    progress = compute_progress(db, user, challenge)
    if already_claimed:
        progress = {"current": progress["target"], "target": progress["target"]}

    return {
        "id": challenge.id,
        "name": challenge.name,
        "description": challenge.description,
        "progress_current": progress["current"],
        "progress_target": progress["target"],
        "reward_gold": challenge.reward_gold,
        "reward_exp": challenge.reward_exp,
        "reward_items": challenge.reward_items,
        "claimed": already_claimed,
        "claimable": (not already_claimed) and progress["current"] >= progress["target"],
    }


@router.get("/")
def list_challenges(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """도전과제 전체 목록 + 진행도/수령 가능 여부. 퀘스트와 달리 기간 개념이 없어 한 번 받으면
    영구히 claimed 상태로 남는다(UserChallengeClaim에 기간 없이 저장)."""
    claimed_ids = {
        row.challenge_id
        for row in db.query(UserChallengeClaim).filter(UserChallengeClaim.user_id == user.id).all()
    }
    challenges = db.query(Challenge).order_by(Challenge.id.asc()).all()
    return [_serialize(db, user, c, claimed_ids) for c in challenges]


@router.post("/claim")
def claim_challenge(
    req: ChallengeClaimRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    challenge = db.query(Challenge).filter(Challenge.id == req.challenge_id).first()
    if not challenge:
        raise HTTPException(status_code=404, detail="존재하지 않는 도전과제입니다.")

    already = db.query(UserChallengeClaim).filter(
        UserChallengeClaim.user_id == user.id,
        UserChallengeClaim.challenge_id == challenge.id,
    ).first()
    if already:
        raise HTTPException(status_code=400, detail=f"'{challenge.name}' 보상은 이미 받았습니다.")

    progress = compute_progress(db, user, challenge)
    if progress["current"] < progress["target"]:
        raise HTTPException(status_code=400, detail=f"'{challenge.name}' 달성 조건을 아직 만족하지 못했습니다.")

    db.add(UserChallengeClaim(user_id=user.id, challenge_id=challenge.id))

    owned_names = {c.name for c in user.characters}
    if challenge.reward_gold:
        user.gold += challenge.reward_gold
        user.lifetime_gold += challenge.reward_gold
    if challenge.reward_exp:
        apply_exp(user, challenge.reward_exp)
    new_chars = _grant_reward_items(db, user, challenge.reward_items)

    db.commit()
    db.refresh(user)

    new_characters = [
        {**_character_reveal_dict(char), "is_duplicate": char.name in owned_names, "is_pickup": False}
        for char in new_chars
    ]

    return {
        "message": f"'{challenge.name}' 보상을 받았습니다!",
        "challenge_id": challenge.id,
        "name": challenge.name,
        "reward_gold": challenge.reward_gold,
        "reward_exp": challenge.reward_exp,
        "gold": user.gold,
        "level": user.level,
        "total_exp": user.total_exp,
        "new_characters": new_characters,
    }
