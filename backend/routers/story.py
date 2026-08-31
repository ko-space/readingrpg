from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import User, Item, UserItem, UserStoryProgress, UserCgUnlock, ActivityLog, StorySecret
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
    # 히든 엔딩 트리거 키워드 등 - 실제 값은 저장소(공개 GitHub)에 없고 DB(story_secrets)에서만
    # 온다(seed.py의 seed_story_secrets 참고). private_seed.py가 없는 환경에서는 그냥 빈 딕셔너리라
    # 프론트가 키워드를 못 받아 히든 콘텐츠만 조용히 비활성화된다(다른 기능엔 영향 없음).
    secrets = {
        row.key: row.value
        for row in db.query(StorySecret).filter(StorySecret.story_id == story_id).all()
    }

    return {
        "progress": (
            {"scene_key": progress.scene_key, "state": progress.state_json}
            if progress else None
        ),
        "unlocked_cgs": unlocked_cgs,
        "ticket_balance": _ticket_balance(db, user),
        "secrets": secrets,
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
        # CG 수집 업적("스토리 수집가"/"이야기꾼"/"노벨 문학상")과 히든 엔딩 관련 업적 판정.
        # 보상(골드/캐릭터)은 이 시점에 서버에서 바로 지급된다.
        check_and_grant_achievements(db, user)

    # 도전과제("스토리모드 앤딩 N회 보기") 판정용 - 처음 보든 재방문이든(위 if와 무관하게) 매번 남긴다.
    # UserCgUnlock은 "이 엔딩을 최초로 봤는가"(존재 여부, 최대 엔딩 종류 수까지만 셀 수 있음)만 표시하고,
    # 이건 "몇 번을 봤는가"(재방문 포함 누적 횟수)를 센다.
    db.add(ActivityLog(user_id=user.id, activity_type="ep1_ending_reached"))
    db.commit()
    return {"message": "CG가 해금되었습니다."}


@router.post("/unlock-chapter")
def unlock_chapter(
    req: StoryUnlockCgRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """서브 스토리의 화(chapter) 단위 영구 잠금해제. /unlock-cg와 같은 UserCgUnlock 테이블을
    재사용하지만(story_id+cg_id 자리에 story_id+chapter_id를 넣는 것뿐), 그쪽의 achievement 판정/
    ep1 전용 ActivityLog는 붙이지 않는다 - 화 잠금해제는 CG 도감/히든 엔딩과 무관한 별개의 개념이라
    같은 부작용을 공유하면 안 된다."""
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
    return {"message": "잠금 해제되었습니다."}


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
    if not owned:
        raise HTTPException(status_code=400, detail="티켓이 부족합니다")

    # 조건부 UPDATE로 원자적으로 소모한다(pvp.py의 투기장 티켓과 동일한 이유) - 동시에 여러 요청이
    # 소모해도 보유 수량 이상으로 깎이지 않는다.
    updated = (
        db.query(UserItem)
        .filter(UserItem.id == owned.id, UserItem.quantity >= 1)
        .update({UserItem.quantity: UserItem.quantity - 1}, synchronize_session=False)
    )
    if not updated:
        raise HTTPException(status_code=400, detail="티켓이 부족합니다")
    db.refresh(owned)
    if owned.quantity <= 0:
        db.delete(owned)

    db.add(ActivityLog(user_id=user.id, activity_type="story_ticket_use"))  # 퀘스트("스토리모드 티켓 사용") 판정용

    db.commit()

    return {"ticket_balance": _ticket_balance(db, user)}
