from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import User, Item, UserItem, UserStoryProgress, UserCgUnlock, ActivityLog
from schemas import StoryProgressRequest, StoryUnlockCgRequest, StoryConsumeTicketRequest
from security import get_current_user
from achievements import check_and_grant_achievements

router = APIRouter(prefix="/story", tags=["story"])

STORY_TICKET_ITEM_NAME = "스토리모드 티켓"


def _ticket_balance(db: Session, user: User) -> int:
    ticket_item = db.query(Item).filter(Item.name == STORY_TICKET_ITEM_NAME).first()
    if not ticket_item:
        return 0
    owned = db.query(UserItem).filter(
        UserItem.user_id == user.id, UserItem.item_id == ticket_item.id
    ).first()
    return owned.quantity if owned else 0


@router.get("/state")
def get_story_state(
    story_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    progress = (
        db.query(UserStoryProgress)
        .filter(UserStoryProgress.user_id == user.id, UserStoryProgress.story_id == story_id)
        .first()
    )
    unlocked_cgs = [
        row.cg_id
        for row in db.query(UserCgUnlock).filter(
            UserCgUnlock.user_id == user.id, UserCgUnlock.story_id == story_id
        ).all()
    ]

    return {
        "progress": (
            {"scene_key": progress.scene_key, "state": progress.state_json}
            if progress else None
        ),
        "unlocked_cgs": unlocked_cgs,
        "ticket_balance": _ticket_balance(db, user),
    }


@router.post("/progress")
def save_story_progress(
    req: StoryProgressRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """체크포인트 저장. 대사/분기/호감도는 전부 프론트(story-engine.js) 소관이라
    scene_key/state는 그대로 저장했다가 돌려주기만 한다(서버는 내용을 해석하지 않음)."""
    progress = (
        db.query(UserStoryProgress)
        .filter(UserStoryProgress.user_id == user.id, UserStoryProgress.story_id == req.story_id)
        .first()
    )
    if progress:
        progress.scene_key = req.scene_key
        progress.state_json = req.state
    else:
        db.add(UserStoryProgress(
            user_id=user.id, story_id=req.story_id, scene_key=req.scene_key, state_json=req.state,
        ))
    db.commit()
    return {"message": "저장되었습니다."}


@router.delete("/progress")
def clear_story_progress(
    story_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.query(UserStoryProgress).filter(
        UserStoryProgress.user_id == user.id, UserStoryProgress.story_id == story_id
    ).delete()
    db.commit()
    return {"message": "진행 상황을 초기화했습니다."}


@router.post("/unlock-cg")
def unlock_cg(
    req: StoryUnlockCgRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    existing = (
        db.query(UserCgUnlock)
        .filter(
            UserCgUnlock.user_id == user.id,
            UserCgUnlock.story_id == req.story_id,
            UserCgUnlock.cg_id == req.cg_id,
        )
        .first()
    )
    if not existing:
        db.add(UserCgUnlock(user_id=user.id, story_id=req.story_id, cg_id=req.cg_id))
        db.commit()
        # CG 수집 업적("스토리 수집가"/"이야기꾼"/"노벨 문학상")과 히든 엔딩 업적("Ep.1 히든 엔딩") 판정.
        # 보상(골드/캐릭터)은 이 시점에 서버에서 바로 지급된다.
        check_and_grant_achievements(db, user)
    return {"message": "CG가 해금되었습니다."}


@router.post("/consume-ticket")
def consume_ticket(
    req: StoryConsumeTicketRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ticket_item = db.query(Item).filter(Item.name == STORY_TICKET_ITEM_NAME).first()
    owned = (
        db.query(UserItem).filter(
            UserItem.user_id == user.id, UserItem.item_id == ticket_item.id
        ).first()
        if ticket_item else None
    )
    if not owned or owned.quantity <= 0:
        raise HTTPException(status_code=400, detail="티켓이 부족합니다")

    owned.quantity -= 1
    if owned.quantity <= 0:
        db.delete(owned)

    db.add(ActivityLog(user_id=user.id, activity_type="story_ticket_use"))  # 퀘스트("스토리모드 티켓 사용") 판정용

    db.commit()

    return {"ticket_balance": _ticket_balance(db, user)}
