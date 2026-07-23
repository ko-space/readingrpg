import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import update, or_
from sqlalchemy.orm import Session

from database import get_db
from models import User, Character, Mail
from schemas import GoogleSignupRequest, GoogleLoginRequest, HeartbeatRequest
from security import verify_google_id_token, create_access_token, get_current_user, SESSION_TIMEOUT_SECONDS
from quests import log_login_activity

router = APIRouter(prefix="/auth", tags=["auth"])


def _start_session(user: User, db: Session) -> str:
    """새 세션을 발급하고 이 유저의 '현재 활성 세션'으로 등록한다. 발급된 access_token을 반환한다."""
    session_id = uuid.uuid4().hex
    user.active_session_id = session_id
    user.active_tab_id = None  # 새 로그인이므로 "어느 탭이 활성 탭인지"는 첫 하트비트가 정한다
    user.session_last_seen = datetime.utcnow()
    db.commit()
    return create_access_token(user.id, session_id)


def _reject_if_already_connected(user: User) -> None:
    """다른 곳에서 이미 접속 중(하트비트가 최근에 살아있음)이면 새 로그인을 막는다."""
    if user.active_session_id and user.session_last_seen:
        elapsed = datetime.utcnow() - user.session_last_seen
        if elapsed < timedelta(seconds=SESSION_TIMEOUT_SECONDS):
            raise HTTPException(status_code=409, detail="이미 접속 중인 계정입니다.")


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

    db.add(Mail(
        user_id=new_user.id,
        title="신규 가입 선물",
        body="독서 RPG에 오신 것을 환영합니다! 신규 가입을 축하하는 선물을 보내드려요.",
        gold_amount=500,
    ))
    db.commit()

    log_login_activity(db, new_user.id)  # 퀘스트("접속 N회"/"18시 이후 접속") 판정용 - 가입도 첫 접속으로 취급

    token = _start_session(new_user, db)
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

    _reject_if_already_connected(user)

    log_login_activity(db, user.id)  # 퀘스트("접속 N회"/"18시 이후 접속") 판정용

    token = _start_session(user, db)
    return {
        "message": f"환영합니다, {user.nickname}님!",
        "access_token": token,
        "token_type": "bearer",
    }


@router.post("/heartbeat")
def heartbeat(req: HeartbeatRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """현재 세션이 살아있다는 신호. 이게 SESSION_TIMEOUT_SECONDS 이상 끊기면 다른 곳에서 로그인할 수 있게 된다.
    get_current_user가 이미 다른 세션(다른 로그인)에 밀려났는지는 검증해주지만, 같은 로그인을 여러 탭에서
    동시에 쓰는 경우(토큰이 localStorage로 공유되는 같은 브라우저에서 새 창을 여는 경우)는 sid가 똑같아서
    거기서는 안 걸러진다 - 그래서 탭마다 다른 tab_id를 받아 "지금 활성 탭"을 여기서 별도로 가린다.

    확인(읽기)과 반영(쓰기)을 분리하면, 두 탭이 거의 동시에 처음 접속했을 때 둘 다 "아직 아무도 없네"를
    보고 둘 다 통과해버리는 경합이 생긴다(그러면 나중에 결국 꼬여서 최악의 경우 둘 다 막히는 상태로 남는다).
    그래서 조건 확인과 반영을 하나의 UPDATE문으로 묶어 DB가 원자적으로 처리하게 한다."""
    now = datetime.utcnow()
    stale_cutoff = now - timedelta(seconds=SESSION_TIMEOUT_SECONDS)

    result = db.execute(
        update(User)
        .where(
            User.id == user.id,
            or_(
                User.active_tab_id.is_(None),
                User.active_tab_id == req.tab_id,
                User.session_last_seen.is_(None),
                User.session_last_seen < stale_cutoff,
            ),
        )
        .values(active_tab_id=req.tab_id, session_last_seen=now)
    )
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=409, detail="이미 접속 중인 계정입니다.")
    return {"ok": True}


@router.post("/release-tab")
def release_tab(req: HeartbeatRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """탭이 닫히거나 이 사이트의 다른 페이지로 이동할 때(pagehide) 보낸다. 지금 활성 탭이 자기 자신일 때만
    비워서, 활성 탭 자리를 SESSION_TIMEOUT_SECONDS만큼 기다리지 않고 바로 다음 탭에 넘겨줄 수 있게 한다.
    같은 탭이 우리 사이트 안의 다른 페이지로 넘어가는 경우에도 호출되지만, 그 다음 페이지가 같은 tab_id로
    바로 다시 활성 탭을 잡으므로(sessionStorage는 탭 단위로 페이지 이동에도 유지됨) 문제되지 않는다."""
    if user.active_tab_id == req.tab_id:
        user.active_tab_id = None
        db.commit()
    return {"ok": True}


@router.post("/logout")
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """세션을 즉시 반납한다. 이걸 안 눌러도 하트비트가 끊기면 SESSION_TIMEOUT_SECONDS 후 자동으로 풀린다."""
    user.active_session_id = None
    user.active_tab_id = None
    user.session_last_seen = None
    db.commit()
    return {"message": "로그아웃되었습니다."}