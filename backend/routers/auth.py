from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Character
from schemas import GoogleSignupRequest, GoogleLoginRequest
from security import verify_google_id_token, create_access_token
from quests import log_login_activity

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/google/signup")
def google_signup(req: GoogleSignupRequest, db: Session = Depends(get_db)):
    google_payload = verify_google_id_token(req.id_token)
    google_sub = google_payload["sub"]
    email = google_payload.get("email")

    if db.query(User).filter(User.google_sub == google_sub).first():
        raise HTTPException(status_code=400, detail="이미 가입된 구글 계정입니다. 로그인을 이용해주세요.")

    if db.query(User).filter(User.nickname == req.nickname).first():
        raise HTTPException(status_code=400, detail="이미 존재하는 닉네임입니다.")

    new_user = User(
        nickname=req.nickname,
        age=req.age,
        google_sub=google_sub,
        email=email,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # 신규 가입자는 기본 캐릭터인 청년을 장착한 상태로 시작한다.
    # outfit은 파일명이 아니라 static/outfits 아래의 폴더 경로를 저장한다.
    db.add(Character(
        user_id=new_user.id,
        name="청년",
        job_class="초심자",
        rarity="일반",
        star=1,
        outfit="beginner/basic",
        is_equipped=1,
    ))
    db.commit()

    log_login_activity(db, new_user.id)  # 퀘스트("접속 N회"/"18시 이후 접속") 판정용 - 가입도 첫 접속으로 취급

    token = create_access_token(new_user.id)
    return {
        "message": "신규 가입을 환영합니다!",
        "access_token": token,
        "token_type": "bearer",
        "nickname": new_user.nickname,
    }


@router.post("/google/login")
def google_login(req: GoogleLoginRequest, db: Session = Depends(get_db)):
    google_payload = verify_google_id_token(req.id_token)
    google_sub = google_payload["sub"]

    user = db.query(User).filter(User.google_sub == google_sub).first()
    if not user:
        raise HTTPException(status_code=404, detail="가입되지 않은 구글 계정입니다. 회원가입을 먼저 해주세요.")

    log_login_activity(db, user.id)  # 퀘스트("접속 N회"/"18시 이후 접속") 판정용

    token = create_access_token(user.id)
    return {
        "message": f"환영합니다, {user.nickname}님!",
        "access_token": token,
        "token_type": "bearer",
    }