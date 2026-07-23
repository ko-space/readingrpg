import json
import random
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import User, Character, PvpBattleLog
from schemas import PvpDefenseRequest, PvpBattleRequest
from security import get_current_user
from battle_engine import compute_unit_stats, build_team, simulate_battle
from achievements import check_and_grant_achievements, get_equipped_title_info

router = APIRouter(prefix="/pvp", tags=["pvp"])

MATCH_RANGE = 5       # 위/아래로 몇 칸까지 후보 풀에 넣을지
CANDIDATE_COUNT = 3    # 한 번에 보여줄 후보 수
TOP_RANK_THRESHOLD = 3 # 이 순위 이하(더 높은 순위)는 아래 순위도 후보로 보여줌
ADMIN_USER_ID = 1      # ranking.py와 동일한 관리자 계정 - 일반 순위 사다리에 참여하지 않고 항상 0위 고정


def _get_equipped_outfit(user: User):
    """로비에서 장착 중인(is_equipped=1) 캐릭터의 outfit 경로. 없으면 None."""
    equipped = next((c for c in user.characters if c.is_equipped == 1), None)
    if equipped is None and user.characters:
        equipped = user.characters[0]
    return equipped.outfit if equipped else None


def _ensure_rank_assigned(user: User, db: Session):
    """아직 PVP 순위가 없는 유저(신규)는 꼴찌로 배정한다.
    관리자(ADMIN_USER_ID)는 일반 순위 사다리에 참여하지 않고 항상 0위로 고정한다 - 실제 유저들의
    최상위(1위)보다 위에 별도로 존재해서, 승패로 순위가 밀리거나 밀어내는 일이 없어야 한다."""
    if user.id == ADMIN_USER_ID:
        if user.pvp_rank != 0:
            user.pvp_rank = 0
            db.commit()
            db.refresh(user)
        return
    if user.pvp_rank is not None:
        return
    lowest = (
        db.query(User)
        .filter(User.pvp_rank.isnot(None), User.id != ADMIN_USER_ID)
        .order_by(User.pvp_rank.desc())
        .first()
    )
    user.pvp_rank = (lowest.pvp_rank + 1) if lowest else 1
    db.commit()
    db.refresh(user)


def _ensure_defense_assigned(user: User, db: Session):
    """
    방어편성이 하나도 없는 유저가 서로 다른 이름의 캐릭터를 2명 이상 보유하게 되면,
    자동으로 앞의 2명(이름이 겹치지 않는)을 전방/후방으로 채워준다.
    이미 방어편성이 있으면 아무것도 안 하고, 캐릭터가 2명 미만이면 아직 배정하지 않는다(입장 자체가 막혀있음).
    """
    if user.pvp_defense_front_id is not None and user.pvp_defense_back_id is not None:
        return

    seen_names = set()
    picked = []
    for character in sorted(user.characters, key=lambda c: c.id):
        if character.name in seen_names:
            continue
        seen_names.add(character.name)
        picked.append(character)
        if len(picked) == 2:
            break

    if len(picked) < 2:
        return

    user.pvp_defense_front_id = picked[0].id
    user.pvp_defense_back_id = picked[1].id
    db.commit()
    db.refresh(user)


def _get_candidate_pool(user: User, db: Session):
    """
    후보 풀을 (User, rank_changeable) 튜플 목록으로 돌려준다.
    - 나보다 순위가 높은(숫자가 작은) 사람: 최대 MATCH_RANGE칸 이내, 이기면 순위가 바뀜(True)
    - 내가 TOP_RANK_THRESHOLD등 이내면: 아래 순위도 후보에 추가(친선전, 순위 안 바뀜=False)
    - 관리자(0위)는 일반 사다리 계산에서 완전히 빠지고, 그 대신 누구에게나 항상 친선전
      (rank_changeable=False) 상대로만 노출된다 - 이겨도 져도 순위표가 흔들리지 않는다.
    """
    others = (
        db.query(User)
        .filter(User.pvp_rank.isnot(None), User.id != user.id, User.id != ADMIN_USER_ID)
        .order_by(User.pvp_rank.asc())
        .all()
    )

    pool = []
    for other in others:
        if user.pvp_rank - MATCH_RANGE <= other.pvp_rank < user.pvp_rank:
            pool.append((other, True))

    if user.pvp_rank <= TOP_RANK_THRESHOLD:
        for other in others:
            if user.pvp_rank < other.pvp_rank <= user.pvp_rank + MATCH_RANGE:
                pool.append((other, False))

    if user.id != ADMIN_USER_ID:
        admin = db.query(User).filter(User.id == ADMIN_USER_ID).first()
        if admin and admin.pvp_rank is not None:
            pool.append((admin, False))

    return pool


def _has_defense_team(user: User) -> bool:
    return user.pvp_defense_front_id is not None and user.pvp_defense_back_id is not None


def _defense_preview(db: Session, user: User):
    """카드에 보여줄 상대의 방어 편성 미리보기(사진+성급만, 이름은 안 보여줌)."""
    front = db.query(Character).filter(Character.id == user.pvp_defense_front_id).first()
    back = db.query(Character).filter(Character.id == user.pvp_defense_back_id).first()
    return {
        "front": {"outfit": front.outfit, "star": front.star} if front else None,
        "back": {"outfit": back.outfit, "star": back.star} if back else None,
    }


@router.get("/opponents")
def get_opponents(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_rank_assigned(user, db)
    _ensure_defense_assigned(user, db)

    pool = [item for item in _get_candidate_pool(user, db) if _has_defense_team(item[0])]
    picked = random.sample(pool, min(CANDIDATE_COUNT, len(pool)))

    return {
        "my_rank": user.pvp_rank,
        "opponents": [
            {
                "id": other.id,
                "nickname": other.nickname,
                "level": other.level,
                "pvp_rank": other.pvp_rank,
                "lobby_outfit": _get_equipped_outfit(other),
                "defense": _defense_preview(db, other),
                "rank_changeable": changeable,
            }
            for other, changeable in picked
        ],
    }


@router.post("/defense")
def set_defense_team(
    req: PvpDefenseRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if req.front_character_id == req.back_character_id:
        raise HTTPException(status_code=400, detail="전방과 후방에 같은 캐릭터를 넣을 수 없습니다.")

    front = db.query(Character).filter(Character.id == req.front_character_id, Character.user_id == user.id).first()
    back = db.query(Character).filter(Character.id == req.back_character_id, Character.user_id == user.id).first()

    if not front or not back:
        raise HTTPException(status_code=404, detail="보유하지 않은 캐릭터입니다.")

    if front.name == back.name:
        raise HTTPException(status_code=400, detail="전방과 후방에 같은 이름의 캐릭터를 중복으로 넣을 수 없습니다.")

    user.pvp_defense_front_id = front.id
    user.pvp_defense_back_id = back.id
    db.commit()

    return {"message": "방어 편성이 저장되었습니다.", "front": front.name, "back": back.name}


def _character_brief(character: Character | None):
    if not character:
        return None
    return {
        "id": character.id,
        "name": character.name,
        "star": character.star,
        "outfit": character.outfit,
    }


@router.get("/defense")
def get_my_defense(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """지금 저장된 내 방어 편성(전방/후방)을 그대로 돌려준다. 화면을 껐다 켜도 항상 저장된 상태가 보이게 하기 위함."""
    _ensure_rank_assigned(user, db)
    _ensure_defense_assigned(user, db)
    front = db.query(Character).filter(Character.id == user.pvp_defense_front_id).first() if user.pvp_defense_front_id else None
    back = db.query(Character).filter(Character.id == user.pvp_defense_back_id).first() if user.pvp_defense_back_id else None
    return {"front": _character_brief(front), "back": _character_brief(back)}


def _character_to_unit(character: Character, owner_level: int, slot: str):
    return compute_unit_stats(character.name, character.star, owner_level, slot)


@router.post("/battle")
def run_battle(
    req: PvpBattleRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ensure_rank_assigned(user, db)
    _ensure_defense_assigned(user, db)

    defender = db.query(User).filter(User.id == req.defender_id).first()
    if not defender:
        raise HTTPException(status_code=404, detail="존재하지 않는 상대입니다.")
    if not _has_defense_team(defender):
        raise HTTPException(status_code=400, detail="상대가 아직 방어 편성을 하지 않았습니다.")
    if not _has_defense_team(user):
        raise HTTPException(status_code=400, detail="먼저 내 방어 편성을 완료해주세요.")

    # 실제로 유효한 후보인지(순위 사거리 안인지) 검증 - 클라이언트가 임의로 다른 상대를 찍는 것 방지
    pool_ids = {other.id: changeable for other, changeable in _get_candidate_pool(user, db)}
    if defender.id not in pool_ids:
        raise HTTPException(status_code=400, detail="지금은 이 상대와 대전할 수 없습니다. 목록을 갱신해주세요.")
    rank_changeable = pool_ids[defender.id]

    attacker_front = db.query(Character).filter(Character.id == user.pvp_defense_front_id).first()
    attacker_back = db.query(Character).filter(Character.id == user.pvp_defense_back_id).first()
    defender_front = db.query(Character).filter(Character.id == defender.pvp_defense_front_id).first()
    defender_back = db.query(Character).filter(Character.id == defender.pvp_defense_back_id).first()

    attacker_team = build_team(
        _character_to_unit(attacker_front, user.level, "front"),
        _character_to_unit(attacker_back, user.level, "back"),
    )
    defender_team = build_team(
        _character_to_unit(defender_front, defender.level, "front"),
        _character_to_unit(defender_back, defender.level, "back"),
    )

    result = simulate_battle(attacker_team, defender_team)
    attacker_won = result["attacker_won"]

    attacker_rank_before = user.pvp_rank
    defender_rank_before = defender.pvp_rank
    rank_did_change = False

    if attacker_won and rank_changeable:
        # 나와 상대 사이에 있던 사람들을 한 칸씩 뒤로 밀고, 나는 상대의 순위를 가져간다.
        db.query(User).filter(
            User.pvp_rank >= defender_rank_before,
            User.pvp_rank < attacker_rank_before,
        ).update({User.pvp_rank: User.pvp_rank + 1}, synchronize_session=False)

        user.pvp_rank = defender_rank_before
        rank_did_change = True
        db.commit()
        db.refresh(user)

    log = PvpBattleLog(
        attacker_id=user.id,
        defender_id=defender.id,
        winner_id=user.id if attacker_won else defender.id,
        rank_changed=rank_did_change,
        attacker_rank_before=attacker_rank_before,
        defender_rank_before=defender_rank_before,
        attacker_front_name=attacker_front.name,
        attacker_back_name=attacker_back.name,
        battle_log=json.dumps(result["events"], ensure_ascii=False),
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    new_achievements, new_characters = check_and_grant_achievements(db, user)
    attacker_title, attacker_title_hidden = get_equipped_title_info(db, user)
    defender_title, defender_title_hidden = get_equipped_title_info(db, defender)

    return {
        "battle_log_id": log.id,
        "attacker_won": attacker_won,
        "duration": result["duration"],
        "events": result["events"],
        "rank_changed": rank_did_change,
        "my_new_rank": user.pvp_rank,
        "new_achievements": new_achievements,
        "new_characters": new_characters,
        "attacker_info": {
            "nickname": user.nickname,
            "level": user.level,
            "lobby_outfit": _get_equipped_outfit(user),
            "title": attacker_title,
            "title_is_hidden": attacker_title_hidden,
        },
        "defender_info": {
            "nickname": defender.nickname,
            "level": defender.level,
            "lobby_outfit": _get_equipped_outfit(defender),
            "title": defender_title,
            "title_is_hidden": defender_title_hidden,
        },
        "attacker_team": {
            "front": {
                "name": attacker_team["front"]["name"],
                "max_hp": attacker_team["front"]["max_hp"],
                "is_melee": attacker_team["front"]["is_melee"],
                "outfit": attacker_front.outfit,
                "star": attacker_front.star,
            },
            "back": {
                "name": attacker_team["back"]["name"],
                "max_hp": attacker_team["back"]["max_hp"],
                "is_melee": attacker_team["back"]["is_melee"],
                "outfit": attacker_back.outfit,
                "star": attacker_back.star,
            },
        },
        "defender_team": {
            "front": {
                "name": defender_team["front"]["name"],
                "max_hp": defender_team["front"]["max_hp"],
                "is_melee": defender_team["front"]["is_melee"],
                "outfit": defender_front.outfit,
                "star": defender_front.star,
            },
            "back": {
                "name": defender_team["back"]["name"],
                "max_hp": defender_team["back"]["max_hp"],
                "is_melee": defender_team["back"]["is_melee"],
                "outfit": defender_back.outfit,
                "star": defender_back.star,
            },
        },
    }


@router.get("/history")
def get_history(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """내가 '방어자'였던 전투 기록 - 누가 나에게 도전했는지 나중에 확인하는 용도."""
    logs = (
        db.query(PvpBattleLog)
        .filter(PvpBattleLog.defender_id == user.id)
        .order_by(PvpBattleLog.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": log.id,
            "attacker_nickname": log.attacker.nickname,
            "result": "패배" if log.winner_id == log.attacker_id else "승리",
            "rank_changed": log.rank_changed,
            "created_at": log.created_at,
        }
        for log in logs
    ]


@router.get("/rank-change-notice")
def get_rank_change_notice(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """내가 모르는 새 순위가 바뀐(패배해서 순위를 뺏긴) 적이 있으면 알려준다."""
    logs = (
        db.query(PvpBattleLog)
        .filter(
            PvpBattleLog.defender_id == user.id,
            PvpBattleLog.rank_changed == True,
            PvpBattleLog.acknowledged == False,
        )
        .order_by(PvpBattleLog.created_at.asc())
        .all()
    )
    return [
        {
            "id": log.id,
            "attacker_nickname": log.attacker.nickname,
            "old_rank": log.defender_rank_before,
            "new_rank": log.defender_rank_before + 1,  # 밀려난 순위 (최소 1칸)
            "created_at": log.created_at,
        }
        for log in logs
    ]


@router.post("/rank-change-notice/{log_id}/ack")
def acknowledge_rank_change(
    log_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    log = db.query(PvpBattleLog).filter(PvpBattleLog.id == log_id, PvpBattleLog.defender_id == user.id).first()
    if not log:
        raise HTTPException(status_code=404, detail="존재하지 않는 기록입니다.")
    log.acknowledged = True
    db.commit()
    return {"message": "확인했습니다."}