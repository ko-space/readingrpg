"""
(1v1) 친선전 - 실시간 매치 라우터.
전술대회(routers/pvp.py)와 달리 전투 전체를 미리 계산해서 한 번에 내려주지 않고, 실제 두 플레이어가
접속한 상태에서 틱 단위로 진행되며 스킬카드를 항상 직접 눌러야만 나간다(AUTO 없음 - 확인된 요청,
원인 불명의 "스킬이 자동으로 써진다" 제보가 반복돼 자동 발동 경로 자체를 제거함). 서버 상태는
전부 이 라우터 안, 그것도 호스트의 앵커 웹소켓 핸들러 함수 하나의 로컬 변수/클로저에만 존재한다 -
별도 인메모리 "방 딕셔너리"가 없다(따라서 Cloud Run이 여러 인스턴스로 오토스케일돼도 "방 만들기"
요청과 "웹소켓 연결"이 서로 다른 인스턴스로 가는 문제 자체가 생기지 않는다). 재접속은 지원하지 않는다
(호스트 웹소켓이 끊기거나 게스트가 Realtime 채널에서 떠나면 그 즉시 매치 종료 - 확정된 설계).

실시간 중계는 Supabase Realtime(Broadcast+Presence)을 인스턴스 간 팬아웃 버스로 쓴다 - 두 플레이어의
웹소켓/HTTP 요청이 서로 다른 Cloud Run 인스턴스에 떨어져도 상관없이 서로 메시지를 주고받을 수 있다.
채널 이름은 `match:{room_code}`이고, 호스트만 서버(service_role 키)로 붙어 실제 시뮬레이션(권위)을
돌리며, 두 플레이어의 브라우저는 각자 anon 키로 같은 채널을 직접 구독해 이벤트를 받는다(호스트 자신의
화면도 이 브로드캐스트를 구독해서 그린다 - 앵커 웹소켓 자체는 순수 생명줄일 뿐 이벤트를 실어 보내지
않는다).
"""
import asyncio
import os
import random
import time

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

import supabase as supabase_sdk

from database import get_db
from models import Character, User
from security import get_current_user, get_current_user_ws
from battle_core import ENABLE_SUPPORTER_SLOT, MAX_BATTLE_DURATION, TICK, _team_alive
from battle_engine import _init_battle, _resolve_battle_outcome, _simulate_tick, build_team
from achievements import get_equipped_title_info
from routers.pvp import _character_to_unit, _ensure_defense_assigned, _get_equipped_outfit, _has_defense_team, _team_unit_view

router = APIRouter(prefix="/pvp_live", tags=["pvp_live"])

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

ROOM_CODE_LENGTH = 6
GUEST_JOIN_TIMEOUT_SECONDS = 300        # 호스트가 게스트를 기다리는 최대 시간(5분) - 넘으면 매치 포기
JOIN_BROADCAST_RETRIES = 3              # join이 구독 직후라 host가 아직 못 들었을 가능성에 대비한 재전송 횟수
JOIN_BROADCAST_RETRY_GAP = 0.4          # 초
BROADCAST_FLUSH_INTERVAL = 0.1          # 새 이벤트를 이만큼(초)마다 모아 한 번에 브로드캐스트(전송 횟수 절감)


def _generate_room_code() -> str:
    return "".join(random.choices("0123456789", k=ROOM_CODE_LENGTH))


def _build_room_team(user: User, db: Session) -> tuple[dict, dict] | tuple[None, None]:
    """유저의 저장된 전술대회 방어 편성(pvp_defense_*)을 그대로 친선전 팀으로 쓴다 - 친선전 전용 편성
    화면을 새로 만들지 않고 "지금 등록해둔 출전 명단"을 재사용한다(전술대회 run_battle과 동일한 규칙).
    반환값은 (시뮬레이션용 team, 프론트에 보낼 로스터 뷰) 튜플 - 후자는 pvp.py의 attacker_team/
    defender_team 응답과 동일한 모양(_team_unit_view)이라 arena-battle.js의 buildUnit이 그대로 먹는다."""
    _ensure_defense_assigned(user, db)
    if not _has_defense_team(user):
        return None, None
    front = db.query(Character).filter(Character.id == user.pvp_defense_front_id).first() if user.pvp_defense_front_id else None
    back = db.query(Character).filter(Character.id == user.pvp_defense_back_id).first() if user.pvp_defense_back_id else None
    supporter = None
    if ENABLE_SUPPORTER_SLOT and user.pvp_defense_supporter_id:
        supporter = db.query(Character).filter(Character.id == user.pvp_defense_supporter_id).first()
    team = build_team(
        _character_to_unit(front, user.level, "front"),
        _character_to_unit(back, user.level, "back"),
        _character_to_unit(supporter, user.level, "supporter") if supporter else None,
    )
    roster_view = {
        "front": _team_unit_view(team["front"], front),
        "back": _team_unit_view(team["back"], back),
        "supporter": _team_unit_view(team["supporter"], supporter),
    }
    return team, roster_view


def _player_profile(db: Session, user: User) -> dict:
    """대전 화면 상단에 표시할 내 프로필 조각(로스터와 별개) - 아바타/레벨/칭호. pvp.py의
    attacker_info/defender_info와 동일한 필드 구성이라 arena-battle.js의 renderPlayerPanel과
    같은 방식으로 그대로 쓸 수 있다."""
    title, title_is_hidden = get_equipped_title_info(db, user)
    return {
        "nickname": user.nickname,
        "level": user.level,
        "lobby_outfit": _get_equipped_outfit(user),
        "title": title,
        "title_is_hidden": title_is_hidden,
    }


@router.post("/rooms")
def create_room(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """새 방 코드를 발급한다. 서버는 아무것도 저장하지 않는다 - 방의 실체는 호스트가 바로 이어서 여는
    앵커 웹소켓 그 자체다. 편성이 없으면 웹소켓을 열기 전에 미리 걸러낸다.
    my_roster/my_profile을 함께 돌려줘서, 프론트가 상대를 찾기 전부터(대기 화면 단계) 내 로스터를
    바로 그릴 수 있게 한다(확인된 요청) - match_found를 기다릴 필요가 없다."""
    _ensure_defense_assigned(user, db)
    if not _has_defense_team(user):
        raise HTTPException(status_code=400, detail="먼저 전술대회 방어 편성을 완료해주세요.")
    _, roster_view = _build_room_team(user, db)
    return {"room_code": _generate_room_code(), "my_roster": roster_view, "my_profile": _player_profile(db, user)}


@router.post("/rooms/{room_code}/join")
async def join_room(room_code: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """상태 없는 1회성 참가 - 이 요청이 호스트의 웹소켓이 붙어있는 인스턴스와 다른 인스턴스에서
    처리돼도 전혀 문제 없다(Realtime이 인스턴스 간 팬아웃을 대신 해준다). 게스트의 팀 스탯은 절대
    브라우저가 직접 제출하지 않는다 - user_id/닉네임만 실어 보내고, 실제 팀은 호스트 쪽에서 이
    user_id로 DB를 다시 조회해서 만든다(위조 불가능)."""
    if not (room_code.isdigit() and len(room_code) == ROOM_CODE_LENGTH):
        raise HTTPException(status_code=400, detail="올바르지 않은 방 코드입니다.")
    _ensure_defense_assigned(user, db)
    if not _has_defense_team(user):
        raise HTTPException(status_code=400, detail="먼저 전술대회 방어 편성을 완료해주세요.")
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        raise HTTPException(status_code=500, detail="실시간 매치 서버 설정이 완료되지 않았습니다.")

    client = await supabase_sdk.acreate_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    try:
        channel = client.channel(f"match:{room_code}")
        await channel.subscribe()
        # 호스트의 구독이 이미 끝나 있을 가능성이 매우 높지만(사람이 코드를 옮겨적어 입력하는 시간은
        # 구독 완료 시간(~1.2초, 레이턴시 실측 스크립트 기준)을 항상 압도한다), 혹시 모를 경합에
        # 대비해 짧은 간격으로 몇 번 더 보낸다 - 중복 수신은 호스트 쪽에서 이미 매치가 시작된 뒤 오는
        # guest_ready를 그냥 무시하므로 안전하다.
        for _ in range(JOIN_BROADCAST_RETRIES):
            await channel.send_broadcast("guest_ready", {"user_id": user.id, "nickname": user.nickname})
            await asyncio.sleep(JOIN_BROADCAST_RETRY_GAP)
    finally:
        await client.remove_all_channels()

    # my_roster/my_profile을 함께 돌려줘서, 프론트가 match_found를 기다리지 않고 자기 로스터부터
    # 바로 그릴 수 있게 한다(create_room과 동일한 이유 - 확인된 요청).
    _, roster_view = _build_room_team(user, db)
    return {"ok": True, "my_roster": roster_view, "my_profile": _player_profile(db, user)}


def _make_manual_cost_gate(state: dict):
    """_tick_team_cost가 실제 발동 직전에 부르는 게이트. 그 진영에서 "지금 이 카드 써줘" 요청이
    대기 중일 때만 1회성으로 통과시키고 소비한다(같은 요청으로 다음 카드까지 연달아 나가지 않도록) -
    AUTO 기능은 제거됐다(확인된 요청 - "스킬이 자동으로 써진다"는 원인 불명 제보가 반복돼서, 아예
    자동 발동 경로 자체를 없애 항상 직접 눌러야만 나가게 함). 통과시킬 때마다 사유를 로그로 남긴다."""
    def gate(side_name, unit):
        if state["pending_activate"].get(side_name):
            state["pending_activate"][side_name] = False
            print(f"[pvp_live] 발동 허용: side={side_name} actor={unit['name']} 사유=pending_activate(수동 클릭)")
            return True
        return False
    return gate


async def _run_live_battle(channel, host_team: dict, guest_team: dict, state: dict, disconnected: asyncio.Event):
    """실제 실시간 전투 루프. simulate_battle(동기)과 완전히 같은 준비/틱/판정 함수를 그대로 재사용하고
    (battle_engine._init_battle/_simulate_tick/_resolve_battle_outcome), 차이는 딱 하나 - 매 틱마다
    asyncio.sleep으로 실제 시간만큼 기다리고, 새로 생긴 이벤트를 짧은 간격으로 모아 Realtime에
    브로드캐스트한다는 점뿐이다. manual_cost_gate로 [Active] 카드 수동 발동을 받아들인다."""
    time_elapsed = 0.0
    pending_events = []

    _init_battle(host_team, guest_team, pending_events)

    async def flush():
        if not pending_events:
            return
        await channel.send_broadcast("battle_event", {"events": list(pending_events)})
        pending_events.clear()

    await flush()

    manual_cost_gate = _make_manual_cost_gate(state)
    tick_index = 0
    last_flush = time.monotonic()
    reason = "finished"

    # _simulate_tick(캐릭터별 스킬/특성 핸들러가 전부 얽혀 있어 예외 발생 가능성이 0이 아님)이 여기서
    # 그냥 죽으면, 이 예외를 잡는 곳이 호출부(host_anchor)에도 없어서(WebSocketDisconnect만 잡음) 매치가
    # 아무 통보 없이 그대로 멈춰버린다 - 두 플레이어 모두 화면이 얼어붙은 채 영원히 대기하게 되는
    # 심각한 문제(확인된 리스크, 기존 동기 simulate_battle은 한 HTTP 요청만 500으로 끝나 blast radius가
    # 훨씬 작았음). 여기서라도 잡아서 match_end로 통보하고, 서버 로그에 원인을 남긴다.
    try:
        while _team_alive(host_team) and _team_alive(guest_team) and time_elapsed < MAX_BATTLE_DURATION:
            if disconnected.is_set():
                reason = "host_disconnected"
                break
            if state["guest_left"]:
                reason = "guest_disconnected"
                break

            tick_start = time.monotonic()
            tick_index += 1
            time_elapsed = _simulate_tick(host_team, guest_team, tick_index, time_elapsed, pending_events, manual_cost_gate)

            if pending_events and (time.monotonic() - last_flush) >= BROADCAST_FLUSH_INTERVAL:
                await flush()
                last_flush = time.monotonic()

            sleep_for = TICK - (time.monotonic() - tick_start)
            if sleep_for > 0:
                await asyncio.sleep(sleep_for)
    except Exception:
        import traceback
        print(f"[pvp_live] 실시간 전투 루프 중 예외 발생(tick={tick_index}, t={time_elapsed:.2f}):")
        traceback.print_exc()
        reason = "server_error"

    await flush()

    attacker_won = None
    if reason == "finished":
        attacker_won = _resolve_battle_outcome(host_team, guest_team, time_elapsed)

    await channel.send_broadcast("match_end", {
        "reason": reason,
        "attacker_won": attacker_won,
        "duration": time_elapsed,
    })


@router.websocket("/ws/{room_code}")
async def host_anchor(websocket: WebSocket, room_code: str, token: str = "", db: Session = Depends(get_db)):
    """호스트 전용 앵커 연결. 이 연결이 열려있는 동안만 매치가 존재한다 - 끊기면(새로고침 포함) 그
    즉시 매치를 종료한다. 브라우저 WebSocket API는 커스텀 헤더를 못 보내므로 인증 토큰은 쿼리스트링
    (?token=)으로 받는다. 이 소켓 자체로는 어떤 전투 데이터도 오가지 않는다(순수 생명줄) - 실제 이벤트는
    호스트 자신을 포함해 두 플레이어 모두 Realtime 채널을 직접 구독해서 받는다(대칭적인 설계)."""
    await websocket.accept()

    if not (room_code.isdigit() and len(room_code) == ROOM_CODE_LENGTH):
        await websocket.close(code=4400, reason="올바르지 않은 방 코드")
        return

    user = get_current_user_ws(token, db)
    if user is None:
        await websocket.close(code=4401, reason="인증 실패")
        return

    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        await websocket.close(code=1011, reason="서버 설정 오류")
        return

    host_team, host_roster = _build_room_team(user, db)
    if host_team is None:
        await websocket.close(code=4400, reason="편성이 없습니다")
        return

    client = await supabase_sdk.acreate_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    channel = client.channel(f"match:{room_code}")

    state = {
        "guest_user_id": None,
        "guest_nickname": None,
        "pending_activate": {"attacker": False, "defender": False},
        "guest_left": False,
    }
    guest_ready_event = asyncio.Event()
    disconnected = asyncio.Event()

    def on_guest_ready(message):
        payload = message.get("payload", {})
        if state["guest_user_id"] is not None:
            return  # 매치가 이미 시작된 뒤 도착한 중복/지연 재전송은 무시(1:1 확정 인원)
        state["guest_user_id"] = payload.get("user_id")
        state["guest_nickname"] = payload.get("nickname")
        guest_ready_event.set()

    # "클릭도 AUTO도 안 켰는데 스킬이 자동 발동됐다"는 재현 안 되는 제보 조사용 - 실제로 어느 쪽에서
    # 언제 무슨 payload가 도착하는지 서버 로그에 전부 남긴다(side가 예상 밖 값이면 그것도 그대로 남아
    # 원인 추적에 쓸 수 있다).
    def on_activate_skill(message):
        payload = message.get("payload", {})
        side = payload.get("side")
        print(f"[pvp_live] activate_skill 수신: raw_side={side!r}, payload={payload}")
        if side in state["pending_activate"]:
            state["pending_activate"][side] = True
        else:
            print(f"[pvp_live] activate_skill 무시됨(알 수 없는 side): {side!r}")

    def on_guest_leave(key, current, left):
        # 프레즌스 leave는 실제로 끊긴 뒤 약 3초 정도 지연되어 감지된다(Realtime API 실측 확인) -
        # 매치 중 짧은 순단으로 오탐하는 것보다는, 이 정도 지연을 감수하고 확실히 끊겼을 때만 반응하는
        # 쪽이 안전하다.
        state["guest_left"] = True

    channel.on_broadcast("guest_ready", on_guest_ready)
    channel.on_broadcast("activate_skill", on_activate_skill)
    channel.on_presence_leave(on_guest_leave)

    async def watch_disconnect():
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            disconnected.set()

    watcher_task = asyncio.create_task(watch_disconnect())

    try:
        await channel.subscribe()
        await channel.track({"role": "host", "user_id": user.id, "nickname": user.nickname})

        try:
            await _wait_guest_or_disconnect(guest_ready_event, disconnected, GUEST_JOIN_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            await channel.send_broadcast("match_end", {"reason": "guest_not_found", "attacker_won": None, "duration": 0})
            return

        if disconnected.is_set():
            return  # 게스트를 기다리는 동안 호스트가 먼저 나감 - 알릴 상대가 없으니 그냥 종료

        guest_user = db.query(User).filter(User.id == state["guest_user_id"]).first()
        guest_team, guest_roster = _build_room_team(guest_user, db) if guest_user else (None, None)
        if guest_team is None:
            await channel.send_broadcast("match_end", {"reason": "guest_invalid", "attacker_won": None, "duration": 0})
            return

        # host_team/guest_team(로스터 뷰)을 함께 실어 보낸다 - 클라이언트(arena-live.js)의 buildUnit이
        # pvp.py의 attacker_team/defender_team 응답과 동일한 모양으로 기대하는 필드
        # (name/max_hp/is_melee/melee_speed_ratio/outfit/star)라 그대로 매핑된다.
        # host_profile/guest_profile(아바타/레벨/칭호)도 함께 보낸다(확인된 요청) - 대기 화면 단계
        # (create_room/join_room 응답)에서는 내 프로필만 알 수 있고, 상대 프로필은 매치가 실제로
        # 성사돼야(여기) 비로소 알 수 있다.
        await channel.send_broadcast("match_found", {
            "host_nickname": user.nickname,
            "guest_nickname": state["guest_nickname"],
            "host_team": host_roster,
            "guest_team": guest_roster,
            "host_profile": _player_profile(db, user),
            "guest_profile": _player_profile(db, guest_user),
        })

        await _run_live_battle(channel, host_team, guest_team, state, disconnected)

    except WebSocketDisconnect:
        pass
    finally:
        watcher_task.cancel()
        try:
            await channel.unsubscribe()
        except Exception:
            pass
        try:
            await client.remove_all_channels()
        except Exception:
            pass


async def _wait_guest_or_disconnect(guest_ready_event: asyncio.Event, disconnected: asyncio.Event, timeout: float):
    """guest_ready 또는 호스트 연결 끊김 중 먼저 오는 쪽까지 기다린다. 어느 쪽도 안 오면(둘 다 대기)
    timeout초 뒤 asyncio.TimeoutError를 던진다(호출부가 "상대를 찾지 못함"으로 처리)."""
    guest_task = asyncio.create_task(guest_ready_event.wait())
    disconnect_task = asyncio.create_task(disconnected.wait())
    try:
        done, pending = await asyncio.wait(
            {guest_task, disconnect_task}, timeout=timeout, return_when=asyncio.FIRST_COMPLETED,
        )
        for t in pending:
            t.cancel()
        if not done:
            raise asyncio.TimeoutError()
    finally:
        pass
