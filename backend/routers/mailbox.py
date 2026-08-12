from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Mail
from security import get_current_user
from achievements import check_and_grant_achievements

router = APIRouter(prefix="/mail", tags=["mail"])

MAIL_AUTO_DELETE_DAYS = 7


def _purge_expired_mail(db: Session, user_id: int) -> None:
    """보상을 수령(claimed_at)한 지 7일이 지난 우편은 우편함을 열 때마다 조용히 정리한다.
    별도 스케줄러 없이도 다음 조회 시점에 자연스럽게 없어지게 하는 방식."""
    cutoff = datetime.utcnow() - timedelta(days=MAIL_AUTO_DELETE_DAYS)
    db.query(Mail).filter(
        Mail.user_id == user_id,
        Mail.claimed_at.isnot(None),
        Mail.claimed_at < cutoff,
    ).delete(synchronize_session=False)
    db.commit()


def _serialize(mail: Mail) -> dict:
    return {
        "id": mail.id,
        "title": mail.title,
        "body": mail.body,
        "gold_amount": mail.gold_amount,
        "silver_amount": mail.silver_amount,
        "created_at": mail.created_at.isoformat() if mail.created_at else None,
        "claimed": mail.claimed_at is not None,
    }


@router.get("/")
def list_mail(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _purge_expired_mail(db, user.id)
    mails = db.query(Mail).filter(Mail.user_id == user.id).order_by(Mail.created_at.desc(), Mail.id.desc()).all()
    return [_serialize(m) for m in mails]


def _claim_one(db: Session, mail: Mail, user: User) -> bool:
    """이 우편을 원자적으로 수령 처리한다. claimed_at이 아직 비어있을 때만 실제로 UPDATE가 걸리는
    조건부 UPDATE라, 같은 우편에 대한 두 요청이 거의 동시에 들어와도(더블클릭, 중복 요청 등)
    DB 레벨에서 한쪽만 실제로 수령 처리된다 - 먼저 커밋된 쪽이 행을 잠그고, 나중 요청은 그 커밋
    이후에야 WHERE 조건을 다시 평가해서 0건으로 실패한다(골드 중복 지급 방지). 실제로 수령
    처리됐는지(= 보상을 지급해야 하는지) 반환한다."""
    updated = (
        db.query(Mail)
        .filter(Mail.id == mail.id, Mail.claimed_at.is_(None))
        .update({Mail.claimed_at: datetime.utcnow()}, synchronize_session=False)
    )
    if not updated:
        return False
    if mail.gold_amount:
        user.gold += mail.gold_amount
        user.lifetime_gold += mail.gold_amount
    if mail.silver_amount:
        user.silver += mail.silver_amount
    return True


@router.post("/{mail_id}/claim")
def claim_mail(mail_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    mail = db.query(Mail).filter(Mail.id == mail_id, Mail.user_id == user.id).first()
    if not mail:
        raise HTTPException(status_code=404, detail="존재하지 않는 우편입니다.")

    if not _claim_one(db, mail, user):
        raise HTTPException(status_code=400, detail=f"'{mail.title}' 보상은 이미 받았습니다.")
    db.commit()
    db.refresh(user)
    new_achievements, new_characters = check_and_grant_achievements(db, user)
    return {
        "message": f"'{mail.title}' 보상을 받았습니다!",
        "gold": user.gold,
        "silver": user.silver,
        "new_achievements": new_achievements,
        "new_characters": new_characters,
    }


@router.post("/claim-all")
def claim_all_mail(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    mails = db.query(Mail).filter(Mail.user_id == user.id, Mail.claimed_at.is_(None)).all()
    claimed_mails = [m for m in mails if _claim_one(db, m, user)]
    db.commit()
    db.refresh(user)
    new_achievements, new_characters = check_and_grant_achievements(db, user)
    return {
        "message": f"우편 보상 {len(claimed_mails)}개를 받았습니다." if claimed_mails else "지금 받을 수 있는 보상이 없습니다.",
        "claimed_count": len(claimed_mails),
        "gold": user.gold,
        "silver": user.silver,
        "new_achievements": new_achievements,
        "new_characters": new_characters,
    }


@router.delete("/{mail_id}")
def delete_mail(mail_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    mail = db.query(Mail).filter(Mail.id == mail_id, Mail.user_id == user.id).first()
    if not mail:
        raise HTTPException(status_code=404, detail="존재하지 않는 우편입니다.")
    db.delete(mail)
    db.commit()
    return {"ok": True}


@router.post("/delete-all")
def delete_all_mail(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.query(Mail).filter(Mail.user_id == user.id).delete()
    db.commit()
    return {"ok": True}
