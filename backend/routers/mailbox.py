from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Mail
from security import get_current_user

router = APIRouter(prefix="/mail", tags=["mail"])


def _serialize(mail: Mail) -> dict:
    return {
        "id": mail.id,
        "title": mail.title,
        "body": mail.body,
        "gold_amount": mail.gold_amount,
        "created_at": mail.created_at.isoformat() if mail.created_at else None,
        "claimed": mail.claimed_at is not None,
    }


@router.get("/")
def list_mail(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    mails = db.query(Mail).filter(Mail.user_id == user.id).order_by(Mail.created_at.desc(), Mail.id.desc()).all()
    return [_serialize(m) for m in mails]


def _claim_one(mail: Mail, user: User) -> None:
    if mail.claimed_at:
        raise HTTPException(status_code=400, detail=f"'{mail.title}' 보상은 이미 받았습니다.")
    mail.claimed_at = datetime.utcnow()
    if mail.gold_amount:
        user.gold += mail.gold_amount
        user.lifetime_gold += mail.gold_amount


@router.post("/{mail_id}/claim")
def claim_mail(mail_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    mail = db.query(Mail).filter(Mail.id == mail_id, Mail.user_id == user.id).first()
    if not mail:
        raise HTTPException(status_code=404, detail="존재하지 않는 우편입니다.")

    _claim_one(mail, user)
    db.commit()
    db.refresh(user)
    return {"message": f"'{mail.title}' 보상을 받았습니다!", "gold": user.gold}


@router.post("/claim-all")
def claim_all_mail(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    mails = db.query(Mail).filter(Mail.user_id == user.id, Mail.claimed_at.is_(None)).all()
    for mail in mails:
        _claim_one(mail, user)
    db.commit()
    db.refresh(user)
    return {
        "message": f"우편 보상 {len(mails)}개를 받았습니다." if mails else "지금 받을 수 있는 보상이 없습니다.",
        "claimed_count": len(mails),
        "gold": user.gold,
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
