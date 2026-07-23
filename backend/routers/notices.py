from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Notice, UserNoticeRead
from security import get_current_user

router = APIRouter(prefix="/notices", tags=["notices"])


@router.get("/")
def list_notices(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    read_ids = {
        row.notice_id
        for row in db.query(UserNoticeRead).filter(UserNoticeRead.user_id == user.id).all()
    }
    notices = db.query(Notice).order_by(Notice.id.desc()).all()
    return [
        {
            "id": n.id,
            "title": n.title,
            "image_file": n.image_file,
            "body": n.body,
            "read": n.id in read_ids,
        }
        for n in notices
    ]


@router.post("/{notice_id}/read")
def mark_notice_read(notice_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    notice = db.query(Notice).filter(Notice.id == notice_id).first()
    if not notice:
        raise HTTPException(status_code=404, detail="존재하지 않는 공지입니다.")

    already = db.query(UserNoticeRead).filter(
        UserNoticeRead.user_id == user.id,
        UserNoticeRead.notice_id == notice_id,
    ).first()
    if not already:
        db.add(UserNoticeRead(user_id=user.id, notice_id=notice_id, read_at=datetime.utcnow()))
        db.commit()
    return {"ok": True}
