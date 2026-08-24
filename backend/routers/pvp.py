import json
import random
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import or_
from sqlalchemy.orm import Session, defer
from database import get_db
from models import User, Character, PvpBattleLog, Item, UserItem, Mail, ActivityLog
from schemas import PvpDefenseRequest, PvpBattleRequest
from security import get_current_user
from battle_core import ENABLE_SUPPORTER_SLOT
from battle_engine import compute_unit_stats, build_team, simulate_battle
from achievements import check_and_grant_achievements, get_equipped_title_info, get_character_catalog

router = APIRouter(prefix="/pvp", tags=["pvp"])

CANDIDATE_COUNT = 3    # 한 번에 보여줄 후보 수
TOP_TIER_SIZE = 5      # 5등 이하는 자기 바로 위 이 인원 수만큼의 창(예: 6등이면 1~5등)에서 무작위로 후보가 나온다
ADMIN_USER_ID = 1      # ranking.py와 동일한 관리자 계정 - 항상 pvp_rank=0으로 고정되어 "0등" 자리를 차지한다

ARENA_TICKET_ITEM_NAME = "투기장모드 티켓"  # users.py의 프로필 응답이 이 상수를 import해서 재사용
ATTACK_WIN_GOLD = 5
DEFENSE_WIN_GOLD = 5


def _count_batter_ally_kills(events: list, side: str) -> int:
    """불빠따 김어진(정확히 이 이름의 실제 시전자, 강승유가
    복제한 경우는 제외 - event["actor"]는 항상 진짜 시전자)의 aoe_all_others_damage가 자기 편(side)
    아군을 그 즉시 죽인(target_hp_after == 0) 횟수를 센다. _skill_aoe_all_others_damage는 매 시전마다
    _alive_units(own_team)에서 그 순간 살아있던 아군만 골라 정확히 한 번씩만 때리므로, 이 값이 0이 된
    히트는 반드시 "이 히트가 죽였다"는 뜻이다(이미 죽어있던 대상을 또 때릴 수 없는 구조)."""
    count = 0
    for event in events:
        if event.get("event_type") != "skill_resolve" or event.get("side") != side:
            continue
        if event.get("actor") != "불빠따 김어진":
            continue
        detail = event.get("detail") or {}
        effect = detail.get("copied_effect_type") or event.get("effect_type")
        if effect != "aoe_all_others_damage":
            continue
        for hit in detail.get("hits", []) or []:
            if hit.get("target_side") == side and hit.get("target_hp_after") == 0:
                count += 1
    return count


# build_stat_change_dicts(battle_core.py)가 star_effect_resolve/trait_resolve 둘 다에 공통으로 실어
# 보내는 필드 -> 상태 카테고리 이름 매핑. 이 함수가 처리하는 필드 목록과 정확히 같은 순서/이름으로
# 맞춰둬야 새 필드(예: haste/shield)가 추가돼도 여기서 자동으로 잡힌다.
_STAT_CHANGE_FIELD_CATEGORIES = {
    "atk": ("atk_up", "atk_down"),
    "hp": ("maxhp_up", "maxhp_down"),
    "crit": ("crit_up", None),
    "crit_chance": ("crit_chance_up", None),
    "rear_priority": ("rear_priority", None),
    "haste": ("haste_up", None),
    "shield": ("shield", None),
}


def _add_categories_from_changes(add, changes, side):
    """star_effect_resolve/trait_resolve가 공유하는 detail.changes(build_stat_change_dicts 형식)를
    범용으로 훑어서 카테고리를 채운다 - 캐릭터 이름/effect_type을 몰라도 되므로, 새 특성/성급 효과가
    추가돼도 이 필드 목록만 맞으면 자동으로 잡힌다(프론트 상태 아이콘 처리와 같은 철학)."""
    for change in changes or []:
        if change.get("target_side") != side:
            continue
        name = change.get("target")
        for field, (pos_cat, neg_cat) in _STAT_CHANGE_FIELD_CATEGORIES.items():
            sign = change.get(field, 0)
            if sign > 0 and pos_cat:
                add(name, pos_cat)
            elif sign < 0 and neg_cat:
                add(name, neg_cat)


# 방임석의 물감(paint)은 소모 자원이지 "상태"가 아니므로 집계하지 않는다.
def _collect_ally_status_categories(events: list, side: str) -> dict:
    """이 편(side)의 아군 유닛 이름별로, 이번 전투에서 발현된 서로 다른 "상태 종류" 집합을 모아
    돌려준다({유닛명: {"stun", "atk_up", ...}}). 실제로 몇 종류나 겹쳤는지는 호출부가 len()으로 판정.
    서포터 본인에게는 상태가 붙지 않는다(전장에 없는 존재라 로스터 행/상태 아이콘 자체가 없음) -
    서포터가 소환한 전장의 소환물(국회의사당 등)은 자기 이름으로 따로 잡히는 별개의 유닛이라 제외
    대상이 아니다. 현재 등록된 서포터는 전부 자기 자신을 대상으로 하는 효과가 없어 우연히 문제가 안
    되지만, 나중에 자기 버프형 서포터가 추가돼도 안전하도록 이름으로 명시적으로 걸러낸다."""
    supporter_name = next(
        (
            card.get("name")
            for event in events
            if event.get("event_type") == "cost_init" and event.get("side") == side
            for card in event.get("cards", []) or []
            if card.get("slot") == "supporter"
        ),
        None,
    )
    categories: dict[str, set] = {}

    def add(name, category):
        if name and name != supporter_name:
            categories.setdefault(name, set()).add(category)

    for event in events:
        etype = event.get("event_type")
        detail = event.get("detail") or {}
        actor = event.get("actor")
        actor_side = event.get("side")

        if etype == "skill_resolve":
            effect = detail.get("copied_effect_type") or event.get("effect_type")

            if effect == "stun_target" and detail.get("hit") and detail.get("target_side") == side:
                add(detail.get("target"), "stun")
            elif effect == "conditional_target_debuff":
                if detail.get("stunned") and detail.get("target_side") == side:
                    add(detail.get("target"), "stun")
                if actor_side == side:
                    add(actor, "atk_speed_up")
            elif effect == "consume_paint_multi_effect":
                for s in detail.get("stunned", []) or []:
                    if s.get("target_side") == side:
                        add(s.get("target"), "stun")
                if actor_side == side:
                    for h in detail.get("heals", []) or []:
                        add(h.get("target"), "heal")
            elif effect == "debuff_atk_and_damage":
                for hit in detail.get("hits", []) or []:
                    if hit.get("target_side") == side:
                        add(hit.get("target"), "atk_down")
            elif effect == "self_stack_buff" and actor_side == side:
                add(actor, "atk_up")
            elif effect == "self_shield_duration" and actor_side == side:
                add(actor, "immune")
            elif effect == "bonus_damage_knockback":
                for hit in detail.get("hits", []) or []:
                    if hit.get("target_side") == side:
                        add(hit.get("target"), "knockback")
            elif effect == "heal_ally_percent_max_hp" and actor_side == side:
                for h in detail.get("heals", []) or []:
                    add(h.get("target"), "heal")
            elif effect == "self_type_swap_heal" and actor_side == side and detail.get("healed_amount"):
                add(actor, "heal")
            elif effect == "revive_dead_striker" and detail.get("target_side") == side:
                add(detail.get("target"), "revive")

        elif etype == "basic_attack" and event.get("target_stunned"):
            target_side = "defender" if actor_side == "attacker" else "attacker"
            if target_side == side:
                add(event.get("target"), "stun")

        elif etype in ("star_effect_resolve", "trait_resolve"):
            # 특성(trait_resolve)도 성급 효과와 완전히 같은 changes 포맷을 쓴다(build_stat_change_dicts
            # 공유) - 예전엔 star_effect_resolve만 처리해서 특성 기반 버프/디버프 전체(팀 타입 체력
            # 버프 등)가 이 업적 집계에서 통째로 빠져 있었다.
            _add_categories_from_changes(add, detail.get("changes"), side)

        elif etype == "periodic_star_resolve" and detail.get("target_side", actor_side) == side and not detail.get("missed"):
            # 신 "제 1 권한" 등 - N초마다 반복되는 성급 효과. 지금은 회복류만 있어 heal로 묶는다.
            # missed(대상이 이동 중이라 하트가 안 맞아 회복 자체가 실패)면 실제로 아무 상태도 발현되지
            # 않은 것이므로 집계에서 제외한다.
            add(detail.get("target"), "heal")

        elif etype == "periodic_trait_resolve" and detail.get("target_side", actor_side) == side:
            # 신 "제 3 권한" 등 - N초마다 반복되는 특성 효과. 지금은 보호막류만 있어 shield로 묶는다.
            add(detail.get("target"), "shield")

        elif etype == "lifesteal_status_resolve" and actor_side == side and detail.get("active"):
            add(actor, "lifesteal")

        elif etype == "neglect_status_resolve" and actor_side == side and detail.get("active"):
            add(actor, "damage_reduction")

        elif etype == "death_trigger_resolve" and actor_side == side:
            for h in detail.get("heals", []) or []:
                add(h.get("target"), "heal")

    return categories


def _max_ally_status_category_count(events: list, side: str) -> int:
    categories = _collect_ally_status_categories(events, side)
    return max((len(v) for v in categories.values()), default=0)


def _consume_arena_ticket(user: User, db: Session) -> None:
    """전투 시도 1회당 투기장모드 티켓 1장을 소모한다. 부족하면 400. 조건부 UPDATE(quantity >= 1일
    때만 실제로 깎임)로 처리해서, 같은 유저가 거의 동시에 여러 전투를 시작해도 보유 수량 이상으로
    소모되지 않는다(shop.py/gacha.py의 골드 차감 경합과 같은 이유)."""
    ticket_item = db.query(Item).filter(Item.name == ARENA_TICKET_ITEM_NAME).first()
    user_item = (
        db.query(UserItem)
        .filter(UserItem.user_id == user.id, UserItem.item_id == ticket_item.id)
        .first()
        if ticket_item else None
    )
    if not user_item:
        raise HTTPException(status_code=400, detail="투기장모드 티켓이 부족합니다.")
    updated = (
        db.query(UserItem)
        .filter(UserItem.id == user_item.id, UserItem.quantity >= 1)
        .update({UserItem.quantity: UserItem.quantity - 1}, synchronize_session=False)
    )
    if not updated:
        raise HTTPException(status_code=400, detail="투기장모드 티켓이 부족합니다.")
    db.refresh(user_item)
    if user_item.quantity <= 0:
        db.delete(user_item)


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
    방어편성이 하나도 없는 유저가 서로 다른 이름의 캐릭터를 보유하게 되면, 자동으로 앞의 최대
    2명(이름이 겹치지 않는)을 전방/후방으로 채워준다. 1명만 있으면 전방만 채운다 - 스트라이커
    한 명 이상만 등록하면 출전할 수 있으므로, 더 이상 2명을 기다릴 필요가 없다.
    전방/후방 중 하나라도 이미 값이 있으면(유저가 직접 편성을 건드린 적이 있다는 뜻이므로) 아무것도
    안 한다 - 일부러 한쪽을 비워둔 편성을 자동배정이 되살리지 않게.
    """
    if user.pvp_defense_front_id is not None or user.pvp_defense_back_id is not None:
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

    if not picked:
        return

    user.pvp_defense_front_id = picked[0].id
    if len(picked) >= 2:
        user.pvp_defense_back_id = picked[1].id
    db.commit()
    db.refresh(user)


def _get_candidate_pool(user: User, db: Session):
    others = (
        db.query(User)
        .filter(User.pvp_rank.isnot(None), User.id != user.id)
        .order_by(User.pvp_rank.asc())
        .all()
    )
    by_rank = {other.pvp_rank: other for other in others}

    if user.pvp_rank in (0, 1, 2, 3):
        target_ranks = [r for r in (0, 1, 2, 3) if r != user.pvp_rank]
    elif user.pvp_rank == 4:
        target_ranks = random.sample([0, 1, 2, 3], min(CANDIDATE_COUNT, 4))
    else:
        window_ranks = list(range(user.pvp_rank - TOP_TIER_SIZE, user.pvp_rank))
        target_ranks = random.sample(window_ranks, min(CANDIDATE_COUNT, len(window_ranks)))

    pool = []
    for r in target_ranks:
        other = by_rank.get(r)
        if other is not None:
            rank_changeable = other.id != ADMIN_USER_ID and other.pvp_rank < user.pvp_rank
            pool.append((other, rank_changeable))

    return pool


def _has_defense_team(user: User) -> bool:
    # 스트라이커(전방/후방) 한 명 이상만 등록하면 출전할 수 있다 - 둘 다 필요했던 예전 규칙에서 완화됨.
    return user.pvp_defense_front_id is not None or user.pvp_defense_back_id is not None


def _defense_preview(db: Session, user: User):
    """카드에 보여줄 상대의 방어 편성 미리보기(사진+성급만, 이름은 안 보여줌)."""
    front = db.query(Character).filter(Character.id == user.pvp_defense_front_id).first()
    back = db.query(Character).filter(Character.id == user.pvp_defense_back_id).first()
    supporter = (
        db.query(Character).filter(Character.id == user.pvp_defense_supporter_id).first()
        if user.pvp_defense_supporter_id else None
    )
    return {
        "front": {"outfit": front.outfit, "star": front.star} if front else None,
        "back": {"outfit": back.outfit, "star": back.star} if back else None,
        "supporter": {"outfit": supporter.outfit, "star": supporter.star} if supporter else None,
    }


@router.get("/opponents")
def get_opponents(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _ensure_rank_assigned(user, db)
    _ensure_defense_assigned(user, db)

    pool = [item for item in _get_candidate_pool(user, db) if _has_defense_team(item[0])]
    picked = random.sample(pool, min(CANDIDATE_COUNT, len(pool)))
    picked.sort(key=lambda item: item[0].pvp_rank)  # 순위가 높은(숫자가 작은) 순으로 위에서부터 표시

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
    # 스트라이커(전방/후방)는 최소 한 명만 있으면 된다 - 완전히 빈 편성은 저장할 수 없다.
    if req.front_character_id is None and req.back_character_id is None:
        raise HTTPException(status_code=400, detail="전방 또는 후방 중 최소 한 명은 선택해야 합니다.")

    if (
        req.front_character_id is not None
        and req.back_character_id is not None
        and req.front_character_id == req.back_character_id
    ):
        raise HTTPException(status_code=400, detail="전방과 후방에 같은 캐릭터를 넣을 수 없습니다.")

    # 서포터는 기본공격 없이 스킬만 쓰는 역할이라 전방/후방(기본공격 슬롯)엔 배치할 수 없다 - 프론트
    # 드롭다운(arena.js)에서 이미 걸러주지만, API를 직접 호출하는 경로까지 막으려면 여기서도 확인해야 한다.
    def _is_supporter(character: Character) -> bool:
        catalog = get_character_catalog(character.name)
        return bool(catalog and catalog.get("unit_role") == "supporter")

    front = None
    if req.front_character_id is not None:
        front = db.query(Character).filter(Character.id == req.front_character_id, Character.user_id == user.id).first()
        if not front:
            raise HTTPException(status_code=404, detail="보유하지 않은 캐릭터입니다.")
        if _is_supporter(front):
            raise HTTPException(status_code=400, detail="서포터는 전방에 배치할 수 없습니다.")

    back = None
    if req.back_character_id is not None:
        back = db.query(Character).filter(Character.id == req.back_character_id, Character.user_id == user.id).first()
        if not back:
            raise HTTPException(status_code=404, detail="보유하지 않은 캐릭터입니다.")
        if _is_supporter(back):
            raise HTTPException(status_code=400, detail="서포터는 후방에 배치할 수 없습니다.")

    if front and back and front.name == back.name:
        raise HTTPException(status_code=400, detail="전방과 후방에 같은 이름의 캐릭터를 중복으로 넣을 수 없습니다.")

    supporter = None
    if req.supporter_character_id is not None:
        if req.supporter_character_id in (req.front_character_id, req.back_character_id):
            raise HTTPException(status_code=400, detail="서포터에 전방/후방과 같은 캐릭터를 넣을 수 없습니다.")
        supporter = (
            db.query(Character)
            .filter(Character.id == req.supporter_character_id, Character.user_id == user.id)
            .first()
        )
        if not supporter:
            raise HTTPException(status_code=404, detail="보유하지 않은 캐릭터입니다.")
        if not _is_supporter(supporter):
            raise HTTPException(status_code=400, detail="서포터 자리엔 서포터만 배치할 수 있습니다.")
        striker_names = {c.name for c in (front, back) if c}
        if supporter.name in striker_names:
            raise HTTPException(status_code=400, detail="서포터에 전방/후방과 같은 이름의 캐릭터를 중복으로 넣을 수 없습니다.")

    user.pvp_defense_front_id = front.id if front else None
    user.pvp_defense_back_id = back.id if back else None
    user.pvp_defense_supporter_id = supporter.id if supporter else None
    db.commit()

    return {
        "message": "방어 편성이 저장되었습니다.",
        "front": front.name if front else None,
        "back": back.name if back else None,
        "supporter": supporter.name if supporter else None,
    }


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
    """지금 저장된 내 방어 편성(전방/후방/서포터)을 그대로 돌려준다. 화면을 껐다 켜도 항상 저장된 상태가 보이게 하기 위함."""
    _ensure_rank_assigned(user, db)
    _ensure_defense_assigned(user, db)
    front = db.query(Character).filter(Character.id == user.pvp_defense_front_id).first() if user.pvp_defense_front_id else None
    back = db.query(Character).filter(Character.id == user.pvp_defense_back_id).first() if user.pvp_defense_back_id else None
    supporter = (
        db.query(Character).filter(Character.id == user.pvp_defense_supporter_id).first()
        if user.pvp_defense_supporter_id else None
    )
    return {"front": _character_brief(front), "back": _character_brief(back), "supporter": _character_brief(supporter)}


def _character_to_unit(character: Character | None, owner_level: int, slot: str):
    # 전방/후방 중 한쪽이 비어있는 편성(스트라이커 1명 등록)도 허용되므로 character가 None일 수 있다 -
    # battle_core/battle_engine은 이미 team["front"]/team["back"]이 None인 경우를 정상적인
    # "그 슬롯의 유닛이 죽어서 없음" 상태와 동일하게 다루도록 설계돼 있어(모든 순회가 None 슬롯을
    # 건너뜀), 처음부터 None으로 시작해도 그대로 안전하다.
    if character is None:
        return None
    # 서포터는 전장에 나서지 않고(공격도 피격도 없음) 체력 개념 자체가 없다("서포터는 죽지 않음") -
    # 예전엔 그래서 hp=1을 더미로 강제했었는데, compute_unit_stats가 계산하는 실제 hp는 어차피 항상
    # 0보다 커서(battle_engine._cost_rotation_units의 hp > 0 로테이션 참여 검사 통과에는) 더미가
    # 필요 없었다. 그런데 이 더미가 max_hp까지 1로 덮어써서, 김국회 "국회의사당"(summon_into_ranged_slot)
    # 처럼 서포터 자신의 real max_hp를 읽어 소환물 체력을 정하는 스킬이 생기자 소환물이 항상 체력 1로
    # 소환되는 버그로 이어졌다 - 실제 운영 전투 로그에서 확인됨(국회의사당 max_hp가 1이라 아무 공격에나
    # 즉사). 서포터는 _all_slots/_alive_units(공격 대상 후보)에 애초에 없어서 실제 hp를 그대로 둬도
    # 어딘가에 표시되거나 깎일 일은 없다.
    return compute_unit_stats(character.name, character.star, owner_level, slot)


def _team_unit_view(unit: dict | None, character: Character | None):
    """전투 결과 응답의 attacker_team/defender_team 한 슬롯 - 그 슬롯이 비어있으면(전방/후방 중
    한쪽만 등록된 편성) None을 그대로 돌려주고, 프론트(arena-battle.js)가 그 슬롯을 빈 자리로 그린다."""
    if unit is None or character is None:
        return None
    return {
        "name": unit["name"],
        "max_hp": unit["max_hp"],
        "is_melee": unit["is_melee"],
        "melee_speed_ratio": unit.get("melee_speed_ratio"),
        "outfit": character.outfit,
        "star": character.star,
        "defense_type": unit["defense_type"],
    }


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

    _consume_arena_ticket(user, db)  # 전투 시도 1회당 티켓 1장 소모 (승패와 무관)

    attacker_front = db.query(Character).filter(Character.id == user.pvp_defense_front_id).first()
    attacker_back = db.query(Character).filter(Character.id == user.pvp_defense_back_id).first()
    defender_front = db.query(Character).filter(Character.id == defender.pvp_defense_front_id).first()
    defender_back = db.query(Character).filter(Character.id == defender.pvp_defense_back_id).first()

    # 서포터는 등록 여부와 무관하게 ENABLE_SUPPORTER_SLOT이 True일 때만 실제 전투에 반영한다 -
    # 지금은 항상 False라, 유저가 서포터를 등록해뒀어도 전투는 전방/후방 2인으로만 진행된다.
    attacker_supporter = defender_supporter = None
    if ENABLE_SUPPORTER_SLOT:
        attacker_supporter = (
            db.query(Character).filter(Character.id == user.pvp_defense_supporter_id).first()
            if user.pvp_defense_supporter_id else None
        )
        defender_supporter = (
            db.query(Character).filter(Character.id == defender.pvp_defense_supporter_id).first()
            if defender.pvp_defense_supporter_id else None
        )

    attacker_team = build_team(
        _character_to_unit(attacker_front, user.level, "front"),
        _character_to_unit(attacker_back, user.level, "back"),
        _character_to_unit(attacker_supporter, user.level, "supporter") if attacker_supporter else None,
    )
    defender_team = build_team(
        _character_to_unit(defender_front, defender.level, "front"),
        _character_to_unit(defender_back, defender.level, "back"),
        _character_to_unit(defender_supporter, defender.level, "supporter") if defender_supporter else None,
    )

    result = simulate_battle(attacker_team, defender_team)
    attacker_won = result["attacker_won"]  # True/False/None(무승부) - None은 양쪽 다 보상 없음

    if attacker_won is True:
        user.gold += ATTACK_WIN_GOLD
        user.lifetime_gold += ATTACK_WIN_GOLD
    elif attacker_won is False:
        db.add(Mail(
            user_id=defender.id,
            title="전술대회 방어 보상입니다.",
            gold_amount=DEFENSE_WIN_GOLD,
        ))

    attacker_rank_before = user.pvp_rank
    defender_rank_before = defender.pvp_rank
    rank_did_change = False

    if attacker_won is True and rank_changeable:
        # 스왑 방식: 사이에 있던 다른 사람들은 그대로 두고, 나와 상대의 순위만 서로 맞바꾼다.
        # pvp_rank엔 unique 제약이 걸려있어서 두 유저가 동시에 같은 값을 가리키면 즉시
        # UniqueViolation이 나므로, 나를 먼저 범위 밖 임시값(음수)으로 비켜둔 채로 상대를 내
        # 원래 순위로 옮기고, 그 다음 내가 상대의 원래 순위로 들어간다.
        db.query(User).filter(User.id == user.id).update(
            {User.pvp_rank: -user.id}, synchronize_session=False
        )
        db.query(User).filter(User.id == defender.id).update(
            {User.pvp_rank: attacker_rank_before}, synchronize_session=False
        )
        db.query(User).filter(User.id == user.id).update(
            {User.pvp_rank: defender_rank_before}, synchronize_session=False
        )

        user.pvp_rank = defender_rank_before
        defender.pvp_rank = attacker_rank_before
        rank_did_change = True
        db.commit()
        db.refresh(user)
        db.refresh(defender)

    log = PvpBattleLog(
        attacker_id=user.id,
        defender_id=defender.id,
        winner_id=user.id if attacker_won is True else (defender.id if attacker_won is False else None),
        rank_changed=rank_did_change,
        attacker_rank_before=attacker_rank_before,
        defender_rank_before=defender_rank_before,
        attacker_front_name=attacker_front.name if attacker_front else None,
        attacker_back_name=attacker_back.name if attacker_back else None,
        battle_log=json.dumps(result["events"], ensure_ascii=False),
    )
    db.add(log)

    for _ in range(_count_batter_ally_kills(result["events"], "attacker")):
        db.add(ActivityLog(user_id=user.id, activity_type="pvp_evt_01"))

    if _max_ally_status_category_count(result["events"], "attacker") >= 7:
        db.add(ActivityLog(user_id=user.id, activity_type="pvp_evt_02"))

    db.commit()
    db.refresh(log)

    new_achievements, new_characters = check_and_grant_achievements(db, user)
    attacker_title, attacker_title_hidden = get_equipped_title_info(db, user)
    defender_title, defender_title_hidden = get_equipped_title_info(db, defender)

    return {
        "battle_log_id": log.id,
        "attacker_won": attacker_won,
        "gold_reward": ATTACK_WIN_GOLD if attacker_won is True else 0,
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
            "front": _team_unit_view(attacker_team["front"], attacker_front),
            "back": _team_unit_view(attacker_team["back"], attacker_back),
            "supporter": _team_unit_view(attacker_team["supporter"], attacker_supporter),
        },
        "defender_team": {
            "front": _team_unit_view(defender_team["front"], defender_front),
            "back": _team_unit_view(defender_team["back"], defender_back),
            "supporter": _team_unit_view(defender_team["supporter"], defender_supporter),
        },
    }


@router.get("/history")
def get_history(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """내가 공격했거나 방어했던 전투 기록(최근 50개) - 두 방향을 합쳐서 최신순으로 보여준다."""
    logs = (
        db.query(PvpBattleLog)
        # battle_log는 전투 이벤트 전체가 담긴 무거운 JSON 컬럼인데 이 화면에선 안 쓰므로, defer로
        # SELECT 대상에서 뺀다(egress 절감 - attacker/defender 관계 접근 등 나머지 동작은 그대로).
        .options(defer(PvpBattleLog.battle_log))
        .filter(or_(PvpBattleLog.attacker_id == user.id, PvpBattleLog.defender_id == user.id))
        .order_by(PvpBattleLog.created_at.desc())
        .limit(50)
        .all()
    )
    result = []
    for log in logs:
        is_attacker = log.attacker_id == user.id
        opponent = log.defender if is_attacker else log.attacker
        result.append({
            "id": log.id,
            "role": "attack" if is_attacker else "defense",
            "opponent_nickname": opponent.nickname,
            "result": "승리" if log.winner_id == user.id else ("무승부" if log.winner_id is None else "패배"),
            "rank_changed": log.rank_changed,
            "created_at": log.created_at,
        })
    return result


@router.get("/rank-change-notice")
def get_rank_change_notice(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """내가 모르는 새 순위가 바뀐(패배해서 순위를 뺏긴) 적이 있으면 알려준다."""
    logs = (
        db.query(PvpBattleLog)
        .options(defer(PvpBattleLog.battle_log))
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
            "new_rank": log.attacker_rank_before,  # 스왑 방식이라 공격자의 원래 순위를 그대로 물려받는다
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