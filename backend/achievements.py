"""
업적 조건 판정 + 보상 지급 엔진.

강화 아이템(characters.py의 effect_type/effect_params)과 같은 패턴을 따른다: 새 업적이 늘어날 때마다
if문을 여기저기 추가하는 게 아니라, condition_type/condition_params(조건)과 reward_gold/reward_exp/
reward_items(보상) "데이터"만 seed.py에 채우면 되게 한다.

compute_progress()가 조건 판정과 진행도 표시(예: "57/100")를 동시에 담당하는 단일 지점이다 - 달성
여부는 결국 "진행도가 목표에 도달했는가"이므로, 판정 로직과 진행도 계산 로직을 따로 두면 언젠가 둘이
어긋난다. 정말로 새로운 종류의 조건이 생길 때만 아래 if/elif 사슬에 분기 하나를 추가하면 된다.

check_and_grant_achievements(db, user)는 독서 기록 제출, 가챠, 강화, PVP 전투 등 유저 상태가 바뀌는
모든 지점에서 호출된다. "업적 달성 개수"처럼 업적 자체를 조건으로 삼는 메타 업적이 있어서, 더 이상
새로 달성되는 게 없을 때까지 여러 번 훑는다.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from sqlalchemy.orm import Session

from models import (
    Character, Item, UserItem, Achievement, UserAchievement, ReadingLog, PvpBattleLog,
    UserCgUnlock, ActivityLog, UserItemPurchase,
)
from leveling import apply_exp

KST = timezone(timedelta(hours=9))

CHARACTERS_JSON = Path(__file__).resolve().parent / "characters.json"
with CHARACTERS_JSON.open("r", encoding="utf-8") as f:
    _CHARACTER_POOL = json.load(f)

RARITY_START_STAR = {"신화": 5, "전설": 4, "영웅": 3, "희귀": 2, "일반": 1}

_CHARACTER_BY_NAME = {
    char["name"]: {**char, "rarity": rarity, "start_star": RARITY_START_STAR.get(rarity, 1)}
    for rarity, char_list in _CHARACTER_POOL.items()
    for char in char_list
}


def get_character_catalog(name: str) -> dict | None:
    """characters.json에서 이 캐릭터의 원본 데이터(설명/스탯/exp_multiplier/exp_subjects 등)를 돌려준다.
    다른 라우터(logs.py 등)가 굳이 characters.json을 따로 또 읽지 않고 이 모듈의 캐시를 재사용하게 한다."""
    return _CHARACTER_BY_NAME.get(name)


MAX_PASSES = 20  # 메타 업적끼리 서로를 트리거하며 무한 루프에 빠지는 실수를 막는 안전장치


def _extract_name(effect_text: str | None) -> str | None:
    """skill_effects/trait_effects는 "이름: 설명" 형식의 문장이다(예: "청진기 진료: 아군의 체력을...").
    획득 연출(가챠 결과화면 등)에는 설명 없이 이름만 필요해서, 콜론 앞부분만 잘라 돌려준다."""
    if not effect_text:
        return None
    return effect_text.split(":", 1)[0].strip()


def _first_unlocked_name(effects_by_star: dict | None) -> str | None:
    """스킬/특성은 낮은 성급에선 아직 null이었다가 특정 성급부터 생기는데, 이름 자체는 성급과 무관하게
    "그 캐릭터가 가진 스킬/특성이 뭔지" 보여주는 용도라서, 아직 해금 전이어도(예: 갓 뽑은 낮은 성급)
    1성부터 순서대로 훑어서 처음 나오는(=언젠가 해금될) 이름을 보여준다. 아예 스킬/특성이 없는
    캐릭터는(전 성급 null) 그대로 None -> 화면에서 "없음"."""
    for star_key in ["1", "2", "3", "4", "5", "6"]:
        extracted = _extract_name((effects_by_star or {}).get(star_key))
        if extracted:
            return extracted
    return None


def resolve_character_reveal_info(name: str, star: int) -> dict:
    """캐릭터 획득 연출(가챠 결과화면, 업적 보상 등)에 필요한 부가 정보를 돌려준다.
    성별/공격타입/방어타입은 성급과 무관한 고정값이고, 스킬/특성 이름도 아직 해금 전인 낮은 성급에
    막 뽑았더라도 "이 캐릭터가 언젠가 갖게 될 스킬/특성 이름"을 미리 보여준다(star 인자는 지금 당장은
    안 쓰지만, 나중에 성급별로 다른 이름을 쓰게 되면 다시 필요해질 수 있어 시그니처는 유지)."""
    catalog = _CHARACTER_BY_NAME.get(name)
    if not catalog:
        return {"gender": None, "attack_type": None, "defense_type": None, "skill_name": None, "trait_name": None}

    return {
        "gender": catalog.get("gender"),
        "attack_type": catalog.get("attack_type"),
        "defense_type": catalog.get("defense_type"),
        "skill_name": _first_unlocked_name(catalog.get("skill_effects")),
        "trait_name": _first_unlocked_name(catalog.get("trait_effects")),
    }


def _character_reveal_dict(character: Character) -> dict:
    """Character DB row + characters.json 부가 정보를 합쳐서, 프론트 획득 연출이 그대로 쓸 수 있는 dict로 만든다."""
    catalog = _CHARACTER_BY_NAME.get(character.name, {})
    info = resolve_character_reveal_info(character.name, character.star)
    return {
        "id": character.id,
        "name": character.name,
        "rarity": character.rarity,
        "job_class": character.job_class,
        "description": catalog.get("description", ""),
        "outfit": character.outfit,
        **info,
    }


def compute_progress(db: Session, user, ach: Achievement) -> dict:
    """조건 타입별로 (현재값, 목표값)을 계산한다. current >= target이면 달성 조건을 만족한 것이다.
    화면의 진행도 바("57/100")와 달성 판정이 항상 같은 숫자를 보게 하기 위한 단일 지점."""
    ctype = ach.condition_type
    params = ach.condition_params or {}
    target = ach.condition_value or 1
    current = 0

    if ctype == "total_exp":
        current = user.lifetime_exp
    elif ctype == "level":
        current = user.level
    elif ctype == "gold":
        current = user.lifetime_gold
    elif ctype == "daily_session_minutes":
        # user.daily_reading_minutes는 독서/과목/모의고사를 전부 합친 "하루 학습시간"이라
        # session_type을 구분해야 하는 업적("독서광" = 순수 독서만)은 ReadingLog에서 직접 집계한다.
        # created_at은 UTC로 저장되므로, "오늘(KST)" 하루를 UTC 구간으로 변환해서 필터링한다.
        today_kst = datetime.now(KST).date()
        start_utc = datetime(today_kst.year, today_kst.month, today_kst.day, tzinfo=KST).astimezone(timezone.utc).replace(tzinfo=None)
        end_utc = start_utc + timedelta(days=1)
        rows = db.query(ReadingLog).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type == params.get("session_type"),
            ReadingLog.created_at >= start_utc,
            ReadingLog.created_at < end_utc,
        ).all()
        current = sum(row.reading_minutes or 0 for row in rows)
    elif ctype == "reading_session_count":
        current = db.query(ReadingLog).filter(ReadingLog.user_id == user.id).count()
    elif ctype == "own_characters":
        names = set(params.get("names", []))
        target = len(names) or 1
        owned = {
            name for (name,) in
            db.query(Character.name).filter(Character.user_id == user.id).distinct()
        }
        current = len(names & owned)
    elif ctype == "character_star":
        target = params.get("star") or target
        best = (
            db.query(Character.star)
            .filter(Character.user_id == user.id, Character.name == params.get("name"))
            .order_by(Character.star.desc())
            .first()
        )
        current = best[0] if best else 0
    elif ctype == "pvp_wins":
        current = db.query(PvpBattleLog).filter(
            PvpBattleLog.attacker_id == user.id,
            PvpBattleLog.winner_id == user.id,
        ).count()
    elif ctype == "combo_pvp_wins":
        names = set(params.get("names", []))
        wins = db.query(PvpBattleLog).filter(
            PvpBattleLog.attacker_id == user.id,
            PvpBattleLog.winner_id == user.id,
        ).all()
        current = sum(
            1 for log in wins
            if {log.attacker_front_name, log.attacker_back_name} == names
        )
    elif ctype == "empty_inventory":
        target = 1
        current = 1 if db.query(Character).filter(Character.user_id == user.id).count() == 0 else 0
    elif ctype == "achievement_count":
        current = db.query(UserAchievement).filter(UserAchievement.user_id == user.id).count()
    elif ctype == "hidden_achievement_count":
        current = (
            db.query(UserAchievement)
            .join(Achievement, Achievement.id == UserAchievement.achievement_id)
            .filter(UserAchievement.user_id == user.id, Achievement.is_hidden == True)
            .count()
        )
    elif ctype == "session_type_count":
        # 특정 종류의 세션(예: 모의고사) 시행 횟수. reading_session_count는 전체 세션이라 별개로 둔다.
        current = db.query(ReadingLog).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type == params.get("session_type"),
        ).count()
    elif ctype == "subject_minutes":
        # 특정 과목의 누적 공부 시간(분). "과목"은 과목 공부와 모의고사를 모두 포함하고,
        # 모의고사 difficulty에는 "수학(하프)"처럼 변형 표기가 있어서 접두사 일치로 판정한다.
        subjects = tuple(params.get("subjects", []))
        rows = db.query(ReadingLog).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type.in_(["subject", "mock_exam"]),
        ).all()
        current = sum(
            row.reading_minutes or 0 for row in rows
            if row.difficulty and row.difficulty.startswith(subjects)
        )
    elif ctype == "study_minutes":
        # 전체 공부(과목+모의고사) 누적 시간(분). 독서(reading)는 "독서 시간"이라 별도 취급.
        rows = db.query(ReadingLog).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type.in_(["subject", "mock_exam"]),
        ).all()
        current = sum(row.reading_minutes or 0 for row in rows)
    elif ctype == "cg_count":
        query = db.query(UserCgUnlock).filter(UserCgUnlock.user_id == user.id)
        if params.get("story_id"):
            query = query.filter(UserCgUnlock.story_id == params["story_id"])
        current = query.count()
    elif ctype == "cg_unlocked":
        target = 1
        exists = db.query(UserCgUnlock).filter(
            UserCgUnlock.user_id == user.id,
            UserCgUnlock.story_id == params.get("story_id"),
            UserCgUnlock.cg_id == params.get("cg_id"),
        ).first()
        current = 1 if exists else 0
    elif ctype == "own_characters_star":
        # 지정 캐릭터들을 각각 지정 성급 이상으로 보유하고 있는지 (예: 서민석/강승유/송주헌 ★3)
        names = params.get("names", [])
        star = params.get("star", 1)
        target = len(names) or 1
        current = 0
        for name in names:
            best = (
                db.query(Character.star)
                .filter(Character.user_id == user.id, Character.name == name)
                .order_by(Character.star.desc())
                .first()
            )
            if best and best[0] >= star:
                current += 1
    elif ctype == "own_all_characters":
        # 현재 카탈로그(characters.json)의 모든 캐릭터 보유. 이후 캐릭터가 추가되면 목표치가 늘지만,
        # 이미 딴 유저는 UserAchievement 기록이 남아 있으므로 칭호가 회수되지 않는다.
        all_names = set(_CHARACTER_BY_NAME.keys())
        target = len(all_names)
        owned = {
            name for (name,) in
            db.query(Character.name).filter(Character.user_id == user.id).distinct()
        }
        current = len(all_names & owned)
    elif ctype == "activity_total":
        # ActivityLog 평생 누적 횟수. 퀘스트(quests.py)의 activity_count는 기간(일/주) 한정이라 별개.
        current = db.query(ActivityLog).filter(
            ActivityLog.user_id == user.id,
            ActivityLog.activity_type == params.get("activity_type"),
        ).count()
    elif ctype == "activity_types_all":
        # 나열된 활동 종류 각각을 1회 이상 수행 (예: 윤영준 강화 성공 + 송주헌 강화 성공)
        types = params.get("types", [])
        target = len(types) or 1
        current = sum(
            1 for t in types
            if db.query(ActivityLog).filter(
                ActivityLog.user_id == user.id, ActivityLog.activity_type == t
            ).first()
        )
    elif ctype == "short_session_streak":
        # 가장 최근 세션부터 거슬러 올라가며 "지정 시간 미만" 연속 기록을 센다.
        # 한 번이라도 긴 세션이 끼면 streak가 끊기므로 딱 "연속 N회" 판정이 된다.
        max_minutes = params.get("max_minutes", 60)
        recent = (
            db.query(ReadingLog)
            .filter(ReadingLog.user_id == user.id)
            .order_by(ReadingLog.id.desc())
            .limit(target)
            .all()
        )
        current = 0
        for row in recent:
            if (row.reading_minutes or 0) < max_minutes:
                current += 1
            else:
                break
    elif ctype == "item_purchase_total":
        # 특정 아이템 평생 구매 수량. shop.py가 모든 구매를 UserItemPurchase에 누적 기록한다.
        item_row = db.query(Item).filter(Item.name == params.get("item_name")).first()
        if item_row:
            record = db.query(UserItemPurchase).filter(
                UserItemPurchase.user_id == user.id,
                UserItemPurchase.item_id == item_row.id,
            ).first()
            current = record.total_purchased if record else 0

    return {"current": max(0, min(current, target)), "target": target}


def _grant_reward_items(db: Session, user, reward_items) -> list[Character]:
    """보상을 지급하고, 이번 호출에서 새로 생성된 Character row들만 돌려준다(획득 연출용 - 골드/아이템은
    연출 대상이 아니라서 안 돌려줌)."""
    granted = []
    for entry in reward_items or []:
        kind = entry.get("type")
        name = entry.get("name")
        quantity = entry.get("quantity", 1)

        if kind == "character":
            catalog = _CHARACTER_BY_NAME.get(name)
            if not catalog:
                continue
            for _ in range(quantity):
                char = Character(
                    user_id=user.id,
                    name=name,
                    job_class=catalog["job_class"],
                    rarity=catalog["rarity"],
                    star=catalog["start_star"],
                    outfit=catalog["outfits"]["기본"],
                    is_equipped=0,
                    is_indestructible=bool(entry.get("indestructible", False)),
                )
                db.add(char)
                granted.append(char)
        elif kind == "item":
            item_row = db.query(Item).filter(Item.name == name).first()
            if not item_row:
                continue
            user_item = db.query(UserItem).filter(
                UserItem.user_id == user.id, UserItem.item_id == item_row.id
            ).first()
            if user_item:
                user_item.quantity += quantity
            else:
                db.add(UserItem(user_id=user.id, item_id=item_row.id, quantity=quantity))

    return granted


def check_and_grant_achievements(db: Session, user) -> tuple[list[dict], list[dict]]:
    """아직 안 딴 업적 중 조건을 만족한 것을 전부 지급하고, (새로 딴 업적 목록, 새로 획득한 캐릭터 목록)을
    돌려준다. 호출 시점에 이미 커밋된 유저/캐릭터/로그 상태를 기준으로 판정하므로, 호출부는 먼저 자기
    변경사항을 커밋한 뒤 이 함수를 불러야 한다. 보상(골드/exp/아이템/캐릭터)은 칭호 장착 여부와 무관하게
    이 시점에 바로 지급된다 - "강 희의 파쇄술"처럼 칭호를 장착하지 않아도 보상 캐릭터를 즉시 받는다.
    두 번째 반환값(새로 획득한 캐릭터 목록)은 프론트의 가챠 획득 연출을 업적 보상에도 그대로 재사용하기
    위한 것 - is_duplicate는 이 호출이 시작되기 전 유저의 보유 목록 기준으로 판정한다(같은 배치 안에서
    같은 캐릭터가 두 번 지급되면 두 번째 것부터 중복으로 표시됨)."""
    newly_earned = []
    granted_characters = []
    owned_names = {c.name for c in user.characters}

    for _ in range(MAX_PASSES):
        earned_ids = {
            ua.achievement_id for ua in
            db.query(UserAchievement).filter(UserAchievement.user_id == user.id).all()
        }

        progressed = False
        for ach in db.query(Achievement).all():
            if ach.id in earned_ids:
                continue

            progress = compute_progress(db, user, ach)
            if progress["current"] < progress["target"]:
                continue

            db.add(UserAchievement(user_id=user.id, achievement_id=ach.id))

            if ach.reward_gold:
                user.gold += ach.reward_gold
                user.lifetime_gold += ach.reward_gold
            if ach.reward_exp:
                apply_exp(user, ach.reward_exp)
            new_chars = _grant_reward_items(db, user, ach.reward_items)
            for char in new_chars:
                granted_characters.append({"char": char, "is_duplicate": char.name in owned_names})
                owned_names.add(char.name)

            newly_earned.append({
                "id": ach.id,
                "name": ach.name,
                "description": ach.description,
                "is_hidden": ach.is_hidden,
                "reward_gold": ach.reward_gold,
                "reward_exp": ach.reward_exp,
                "reward_items": ach.reward_items,
            })
            progressed = True

        if not progressed:
            break

        db.commit()
        db.refresh(user)

    granted_character_dicts = [
        {**_character_reveal_dict(g["char"]), "is_duplicate": g["is_duplicate"], "is_pickup": False}
        for g in granted_characters
    ]
    return newly_earned, granted_character_dicts


def get_equipped_title_info(db: Session, user) -> tuple[str | None, bool]:
    """(칭호로 표시할 업적 이름, 히든 업적 여부)를 돌려준다. 장착한 게 없으면 (None, False)."""
    if not user.equipped_achievement_id:
        return None, False
    ach = db.query(Achievement).filter(Achievement.id == user.equipped_achievement_id).first()
    if not ach:
        return None, False
    return ach.name, ach.is_hidden
