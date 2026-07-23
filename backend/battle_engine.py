"""
PVP 전투 시뮬레이션 엔진.
기본공격 + 캐릭터별 스킬(기본공격 3회 시전 후, 공격 주기의 2배 시전시간으로 발동. 시전 중엔 기본공격 안 함) +
전투 시작 시 1회 판정되는 특성(팀 시너지)까지 포함한 버전.
DB에 의존하지 않는 순수 함수들로만 구성해서, 나중에 테스트하기 쉽게 해둠(개발자 테스트 창에서도 그대로 재사용).
"""
import json
import random

# 성(星)별 기본 스탯. hp는 "원거리 기준", atk는 "근거리 기준" 값이다 - 반대쪽 사거리는
# compute_unit_stats에서 여기에 1.5배를 곱해서 계산한다(근거리 체력 = 원거리 체력의 1.5배,
# 원거리 공격력 = 근거리 공격력의 1.5배 - 근거리는 맷집형, 원거리는 화력형이 되도록).
STAR_BASE_STATS = {
    1: {"hp": 100, "atk": 10},
    2: {"hp": 200, "atk": 20},
    3: {"hp": 300, "atk": 30},
    4: {"hp": 400, "atk": 40},
    5: {"hp": 500, "atk": 50},
    6: {"hp": 600, "atk": 60},
}
RANGE_STAT_MULTIPLIER = 1.5

# 캐릭터별 사거리/속성/스킬·특성은 하드코딩 대신 characters.json에서 읽는다.
# 새 캐릭터를 추가할 땐 characters.json만 채우면 이 파일은 안 건드려도 됨(스킬 로직 자체를 새로 만드는 경우 제외).
with open("characters.json", "r", encoding="utf-8") as f:
    _CHARACTER_POOL = json.load(f)

_ALL_CHARACTERS = [char for char_list in _CHARACTER_POOL.values() for char in char_list]

CHARACTER_RANGE = {char["name"]: char.get("range", "근거리") for char in _ALL_CHARACTERS}
ATTACK_TYPE = {char["name"]: char.get("attack_type", "Student") for char in _ALL_CHARACTERS}
DEFENSE_TYPE = {char["name"]: char.get("defense_type", "Student") for char in _ALL_CHARACTERS}
CHARACTER_GENDER = {char["name"]: char.get("gender") for char in _ALL_CHARACTERS}
CHARACTER_SKILL_MECHANICS = {char["name"]: char["skill_mechanics"] for char in _ALL_CHARACTERS if char.get("skill_mechanics")}
CHARACTER_TRAIT_MECHANICS = {char["name"]: char["trait_mechanics"] for char in _ALL_CHARACTERS if char.get("trait_mechanics")}
CHARACTER_STAR_MECHANICS = {char["name"]: char["star_mechanics"] for char in _ALL_CHARACTERS if char.get("star_mechanics")}

# 삼각 상성: 키가 이기는(유리한) 대상 = 값. 예) TYPE_ADVANTAGE["Parent"] == "Teacher" -> Parent가 Teacher에게 유리
TYPE_ADVANTAGE = {"Parent": "Teacher", "Student": "Parent", "Teacher": "Student"}
TYPE_ADVANTAGE_MULT = 1.5
TYPE_DISADVANTAGE_MULT = 0.7


def get_type_multiplier(attacker_type: str, defender_type: str) -> float:
    if attacker_type == defender_type:
        return 1.0
    if TYPE_ADVANTAGE.get(attacker_type) == defender_type:
        return TYPE_ADVANTAGE_MULT
    return TYPE_DISADVANTAGE_MULT


MELEE_MOVE_TIME_FRONT = 2.0  # 전방 근거리 유닛이 적에게 다가가는 시간(초)
MELEE_MOVE_TIME_BACK = 3.6   # 후방 근거리 유닛은 더 멀리서 오니까 더 오래 걸림
KNOCKBACK_REAPPROACH_TIME = 2.0  # 넉백 후 재접근 시간 - 넉백 거리가 줄면서(맵 밖 밀림 방지) 후방까지 가는 시간(3.6)보다 짧아짐
MELEE_ATTACK_INTERVAL = 1.2   # 근거리 공격 주기(초)
RANGED_ATTACK_INTERVAL = 1.5  # 원거리 공격 주기(초)
TICK = 0.05

SKILL_TRIGGER_ATTACK_COUNT = 3   # 기본공격 몇 회마다 스킬을 시전하는지
SKILL_CAST_INTERVAL_MULTIPLIER = 1.1  # 시전 시간 = 기본공격 주기 * 이 값


def _new_status():
    # 스킬/특성이 유닛에 남기는 임시·영구 상태. compute_unit_stats에서 유닛마다 새로 만들어 붙인다.
    return {
        "atk_percent_bonus": 0,      # 영구(전투 종료까지) 공격력 증가 - 특성, 윤대웅 중첩 버프 등
        "atk_percent_debuff": 0,     # 임시 공격력 감소
        "temp_debuff_until": None,
        "haste_percent": 0,          # 임시 공격 속도 증가(주기 단축)
        "haste_until": None,
        "shield_until": None,        # 이 시간까지는 받는 피해가 0
        "stun_until": None,          # 이 시간까지는 아무 행동도 못 함
        "stack_count": 0,
    }


def compute_unit_stats(character_name, star, owner_level, slot="front", overrides=None):
    """캐릭터 이름/성/유저레벨/배치(전방·후방)로 실제 전투 스탯을 계산한다.
    overrides: 개발자 테스트 창에서 hp/atk/attack_interval/level/skill_params를 직접 덮어쓸 때 사용(없으면 기존과 동일)."""
    overrides = overrides or {}
    effective_level = overrides.get("level", owner_level)

    base = STAR_BASE_STATS.get(star, STAR_BASE_STATS[1])
    ranged_hp = base["hp"] + effective_level * 20   # hp는 원거리 기준값
    melee_atk = base["atk"] + effective_level * 2   # atk는 근거리 기준값

    is_melee = CHARACTER_RANGE.get(character_name, "근거리") == "근거리"
    if is_melee:
        hp = round(ranged_hp * RANGE_STAT_MULTIPLIER)  # 근거리 체력 = 원거리 체력의 1.5배(맷집형)
        atk = melee_atk
        attack_interval = MELEE_ATTACK_INTERVAL
        first_attack_delay = MELEE_MOVE_TIME_BACK if slot == "back" else MELEE_MOVE_TIME_FRONT
    else:
        hp = ranged_hp
        atk = round(melee_atk * RANGE_STAT_MULTIPLIER)  # 원거리 공격력 = 근거리 공격력의 1.5배(화력형)
        attack_interval = RANGED_ATTACK_INTERVAL
        first_attack_delay = 0.0

    if "hp" in overrides:
        hp = overrides["hp"]
    if "atk" in overrides:
        atk = overrides["atk"]
    if "attack_interval" in overrides:
        attack_interval = overrides["attack_interval"]

    skill_effect_type = None
    skill_params = None
    skill_mech = CHARACTER_SKILL_MECHANICS.get(character_name)
    if skill_mech:
        star_params = skill_mech["params"].get(str(star))
        if star_params:
            skill_effect_type = skill_mech["effect_type"]
            skill_params = dict(star_params)
            if "skill_params" in overrides:
                skill_params.update(overrides["skill_params"])

    trait_effect_type = None
    trait_params = None
    trait_partner_name = None
    trait_mech = CHARACTER_TRAIT_MECHANICS.get(character_name)
    if trait_mech:
        star_params = trait_mech["params"].get(str(star))
        if star_params:
            trait_effect_type = trait_mech["effect_type"]
            trait_params = dict(star_params)
            trait_partner_name = trait_mech["partner_name"]

    star_effect_type = None
    star_params_out = None
    star_mech = CHARACTER_STAR_MECHANICS.get(character_name)
    if star_mech:
        star_params = star_mech["params"].get(str(star))
        if star_params:
            star_effect_type = star_mech["effect_type"]
            star_params_out = dict(star_params)

    return {
        "name": character_name,
        "hp": hp,
        "max_hp": hp,
        "atk": atk,
        "star": star,
        "is_melee": is_melee,
        "attack_type": ATTACK_TYPE.get(character_name, "Student"),
        "defense_type": DEFENSE_TYPE.get(character_name, "Student"),
        "attack_interval": attack_interval,
        "next_attack_time": attack_interval + first_attack_delay,
        "attack_count": 0,
        "is_casting": False,
        "cast_end_time": None,
        "skill_effect_type": skill_effect_type,
        "skill_params": skill_params,
        "trait_effect_type": trait_effect_type,
        "trait_params": trait_params,
        "trait_partner_name": trait_partner_name,
        "star_effect_type": star_effect_type,
        "star_params": star_params_out,
        "gendered_damage_bonus": None,  # damage_to_gender_bonus 성급 효과가 있으면 배틀 시작 때 채워짐
        "status": _new_status(),
        "is_clone": False,
    }


def build_team(front, back):
    # "summon" 슬롯은 기존 전방/후방과 별개로 존재하는 3번째 자리 - 윤영준의 복제체처럼
    # 인원을 대체하지 않고 "추가로" 소환되는 유닛 전용이다. 평소엔 비어있다(None).
    return {"front": front, "back": back, "summon": None}


def _all_slots(team):
    return (team["front"], team["back"], team.get("summon"))


def _alive_units(team):
    """생존 유닛을 우선순위 순서로 반환한다. 윤영준의 복제체는 미끼 역할이라
    배치와 무관하게 항상 맨 앞(최우선 타겟)으로 온다 - 그 외에는 front, back, summon 순서 그대로."""
    units = [u for u in _all_slots(team) if u and u["hp"] > 0]
    units.sort(key=lambda u: 0 if u.get("is_clone") else 1)
    return units


def _alive_target(team):
    units = _alive_units(team)
    return units[0] if units else None


def _team_alive(team):
    return bool(_alive_target(team))


def _teammate(team, unit):
    """자신을 제외한 다른 팀원 1명(살아있든 아니든) - front/back/summon 순서로 첫 번째를 반환."""
    for other in _all_slots(team):
        if other is not None and other is not unit:
            return other
    return None


def _select_basic_attack_target(unit, enemy_team):
    """기본공격 대상 선정. 전방/후방은 고정 슬롯이 아니라 "살아있는 유닛의 순서"로 매번 다시 정해진다:
    _alive_units가 복제체(미끼) -> 전방 -> 후방 순으로 돌려주므로, 전방이 죽으면 그다음 유닛(원래 후방)이
    자연히 새 전방(첫 타겟)이 되고, (복제체가 있어 3인일 때) 후방이 죽으면 그 앞 유닛이 새 후방이 된다 -
    후방이 죽어도 전방은 변하지 않는다.

    - 기본: 현재 전방(목록의 맨 앞, 복제체가 있으면 복제체)을 때린다.
    - 최재혁(★3부터)만 예외: "무조건" 현재 후방(살아있는 유닛 중 맨 뒤)을 먼저 때린다 - 복제체(미끼)가
      있어도 무시하고 후방을 노린다. 살아있는 적이 1명뿐이면 그가 곧 전방이자 유일한 대상이다."""
    units = _alive_units(enemy_team)
    if not units:
        return None

    if unit["name"] == "최재혁" and unit.get("star", 1) >= 3:
        return units[-1] if len(units) >= 2 else units[0]

    return units[0]


def _effective_atk(unit, time_elapsed):
    status = unit["status"]
    bonus = status["atk_percent_bonus"]
    debuff = status["atk_percent_debuff"] if (status["temp_debuff_until"] is not None and time_elapsed < status["temp_debuff_until"]) else 0
    return round(unit["atk"] * (1 + bonus / 100 - debuff / 100))


def _effective_interval(unit, time_elapsed):
    status = unit["status"]
    interval = unit["attack_interval"]
    if status["haste_until"] is not None and time_elapsed < status["haste_until"]:
        interval = interval * (1 - status["haste_percent"] / 100)
    return interval


def _apply_damage(target, amount, time_elapsed):
    """실드가 떠 있으면 피해를 0으로 만든다. 실제로 깎인 양을 반환."""
    if target["status"]["shield_until"] is not None and time_elapsed < target["status"]["shield_until"]:
        amount = 0
    amount = max(0, round(amount))
    target["hp"] = max(0, target["hp"] - amount)
    return amount


# ───────────────────────── 치명타 - 기본공격/스킬 모두 공통 ─────────────────────────
CRIT_CHANCE = 0.10        # 10% 확률
CRIT_MULTIPLIER = 1.5     # 공격력의 1.5배


def _roll_damage_atk(unit, time_elapsed):
    """피해 공식의 시작점(공격력 값 하나). 기본공격이든 스킬이든 이 함수를 거쳐서 공격력을 구하면
    10% 확률로 치명타(공격력 1.5배)가 함께 적용된다 - (사용할 공격력, 치명타 여부)를 돌려준다."""
    atk = _effective_atk(unit, time_elapsed)
    is_crit = random.random() < CRIT_CHANCE
    if is_crit:
        atk = round(atk * CRIT_MULTIPLIER)
    return atk, is_crit


def _apply_gendered_damage_bonus(unit, target, damage):
    """불빠따 김어진의 성급 효과(damage_to_gender_bonus) 전용 - 특정 성별 대상에게 주는 피해를
    추가로 늘린다. 다른 캐릭터는 이 필드가 아예 없어서(None) 항상 조용히 통과한다."""
    bonus = unit.get("gendered_damage_bonus")
    if bonus and CHARACTER_GENDER.get(target["name"]) == bonus["gender"]:
        damage *= (1 + bonus["percent"] / 100)
    return damage


def _scale_params(params, factor):
    # 강승유의 "성대모사"처럼 남의 스킬 수치를 비율만큼 낮춰 재사용할 때 씀. 숫자 값만 스케일하고 문자열(condition/stat 등)은 그대로 둔다.
    return {k: (round(v * factor, 2) if isinstance(v, (int, float)) else v) for k, v in params.items()}


# ───────────────────────── 특성(trait) - 전투 시작 시 1회만 판정 ─────────────────────────

def _trait_ally_synergy_remove_absorb(caster, team, params, events, side):
    partner = _teammate(team, caster)
    if not partner or partner["name"] != caster["trait_partner_name"] or partner["hp"] <= 0:
        return
    absorb = params["absorb_percent"] / 100
    caster["atk"] += round(partner["atk"] * absorb)
    caster["max_hp"] += round(partner["max_hp"] * absorb)
    caster["hp"] = caster["max_hp"]
    partner["hp"] = 0  # "제거" - 죽은 것으로 처리
    events.append({
        "time": 0, "event_type": "trait_resolve", "side": side, "actor": caster["name"],
        "effect_type": "ally_synergy_remove_absorb",
        "detail": {"removed": partner["name"], "absorb_percent": params["absorb_percent"]},
    })


def _trait_ally_synergy_atk_buff(caster, team, params, events, side):
    partner = _teammate(team, caster)
    if not partner or partner["name"] != caster["trait_partner_name"] or partner["hp"] <= 0:
        return
    caster["status"]["atk_percent_bonus"] += params["atk_percent"]
    events.append({
        "time": 0, "event_type": "trait_resolve", "side": side, "actor": caster["name"],
        "effect_type": "ally_synergy_atk_buff",
        "detail": {"partner": partner["name"], "atk_percent": params["atk_percent"]},
    })


TRAIT_EFFECT_HANDLERS = {
    "ally_synergy_remove_absorb": _trait_ally_synergy_remove_absorb,
    "ally_synergy_atk_buff": _trait_ally_synergy_atk_buff,
}


def _apply_battle_start_traits(team, events, side):
    for slot in ("front", "back"):
        unit = team[slot]
        if not unit or unit["hp"] <= 0 or not unit.get("trait_effect_type"):
            continue
        handler = TRAIT_EFFECT_HANDLERS.get(unit["trait_effect_type"])
        if handler:
            handler(unit, team, unit["trait_params"], events, side)


# ───────────────────────── 성급별 효과(star_effects) - 전투 시작 시 1회만 판정 ─────────────────────────
# characters.json의 star_effects는 원래 인벤토리 화면에 보여주기만 하던 문구였는데, 실제 전투에도
# 반영되도록 star_mechanics(효과 타입 + 성급별 수치)를 데이터로 추가하고 여기서 실행한다.
# 특성처럼 전투 시작 시 딱 1번만 적용되고(지속시간 없이 전투 끝까지 유지), 최재혁의 "후방 우선 공격"과
# 김남옥의 "기본공격 다중 타격"만은 예외 - 그 둘은 매 공격마다 판정해야 하는 로직이라 여전히
# _select_basic_attack_target / _do_basic_attack에 캐릭터 이름으로 직접 하드코딩돼 있다.


# 성급 효과 핸들러들은 실제 스탯 반영과 함께, 프론트 상태 아이콘 표시용으로
# "누가 어떤 방향의 변화를 받았는지" 목록을 반환한다: ("own"|"enemy", 대상유닛, atk부호, hp부호).
# 부호는 +1(증가)/-1(감소)/0(변화 없음)만 쓴다 - 정확한 수치는 아이콘 표시에 필요 없다.

def _star_self_stat_percent(unit, own_team, enemy_team, params):
    # 자신의 공격력/체력 중 있는 것만 X% 증가 (강승유, 청년, 강 희, 김남옥의 자기 공격력 보너스 등)
    atk_percent = params.get("atk_percent", 0)
    hp_percent = params.get("hp_percent", 0)
    if atk_percent:
        unit["status"]["atk_percent_bonus"] += atk_percent
    if hp_percent:
        gain = round(unit["max_hp"] * hp_percent / 100)
        unit["max_hp"] += gain
        unit["hp"] += gain
    return [("own", unit, 1 if atk_percent else 0, 1 if hp_percent else 0)]


def _star_self_buff_enemy_debuff(unit, own_team, enemy_team, params):
    # 윤대웅, 윤영준: 자신 공격력·체력 +X%, 적 전체 공격력·체력 -X%
    percent = params["percent"]
    unit["status"]["atk_percent_bonus"] += percent
    gain = round(unit["max_hp"] * percent / 100)
    unit["max_hp"] += gain
    unit["hp"] += gain
    changes = [("own", unit, 1, 1)]
    for enemy in _alive_units(enemy_team):
        enemy["status"]["atk_percent_bonus"] -= percent
        loss = round(enemy["max_hp"] * percent / 100)
        enemy["max_hp"] = max(1, enemy["max_hp"] - loss)
        enemy["hp"] = min(enemy["hp"], enemy["max_hp"])
        changes.append(("enemy", enemy, -1, -1))
    return changes


def _star_ally_team_stat_percent(unit, own_team, enemy_team, params):
    # 이종복(체력), 임소정(공격력): 아군 전체(자신 포함) 특정 스탯 X% 증가
    stat = params["stat"]
    percent = params["percent"]
    changes = []
    for ally in _alive_units(own_team):
        if stat == "atk":
            ally["status"]["atk_percent_bonus"] += percent
            changes.append(("own", ally, 1, 0))
        else:
            gain = round(ally["max_hp"] * percent / 100)
            ally["max_hp"] += gain
            ally["hp"] += gain
            changes.append(("own", ally, 0, 1))
    return changes


def _star_debuff_all_others_atk(unit, own_team, enemy_team, params):
    # 이영웅: 자신을 제외한 모든 캐릭터(아군·적 모두) 공격력 X% 감소
    percent = params["percent"]
    changes = []
    for rel, team in (("own", own_team), ("enemy", enemy_team)):
        for u in _alive_units(team):
            if u is unit:
                continue
            u["status"]["atk_percent_bonus"] -= percent
            changes.append((rel, u, -1, 0))
    return changes


def _star_teammate_stat_percent(unit, own_team, enemy_team, params):
    # 송주헌: 자신 제외 팀원 1명의 특정 스탯 X% 증가
    partner = _teammate(own_team, unit)
    if not partner or partner["hp"] <= 0:
        return []
    stat = params["stat"]
    percent = params["percent"]
    if stat == "atk":
        partner["status"]["atk_percent_bonus"] += percent
        return [("own", partner, 1, 0)]
    gain = round(partner["max_hp"] * percent / 100)
    partner["max_hp"] += gain
    partner["hp"] += gain
    return [("own", partner, 0, 1)]


def _star_ally_gender_stat_percent(unit, own_team, enemy_team, params):
    # 서민석: 특정 성별 아군 전체(자신 포함 가능) 공격력·체력 X% 증가
    gender = params["gender"]
    atk_percent = params.get("atk_percent", 0)
    hp_percent = params.get("hp_percent", 0)
    changes = []
    for ally in _alive_units(own_team):
        if CHARACTER_GENDER.get(ally["name"]) != gender:
            continue
        if atk_percent:
            ally["status"]["atk_percent_bonus"] += atk_percent
        if hp_percent:
            gain = round(ally["max_hp"] * hp_percent / 100)
            ally["max_hp"] += gain
            ally["hp"] += gain
        changes.append(("own", ally, 1 if atk_percent else 0, 1 if hp_percent else 0))
    return changes


def _star_damage_to_gender_bonus(unit, own_team, enemy_team, params):
    # 불빠따 김어진: 특정 성별 "적"에게 주는 피해 X% 증가(_apply_gendered_damage_bonus가 실제 적용)
    # 스탯 자체가 변하는 게 아니라 조건부 피해 보정이라 상태 아이콘 대상은 아니다.
    unit["gendered_damage_bonus"] = {"gender": params["gender"], "percent": params["bonus_percent"]}
    return []


STAR_EFFECT_HANDLERS = {
    "self_stat_percent": _star_self_stat_percent,
    "self_buff_enemy_debuff": _star_self_buff_enemy_debuff,
    "ally_team_stat_percent": _star_ally_team_stat_percent,
    "debuff_all_others_atk": _star_debuff_all_others_atk,
    "teammate_stat_percent": _star_teammate_stat_percent,
    "ally_gender_stat_percent": _star_ally_gender_stat_percent,
    "damage_to_gender_bonus": _star_damage_to_gender_bonus,
}


def _apply_battle_start_star_effects(attacker_team, defender_team, events=None):
    """특성(_apply_battle_start_traits)이 다 끝난 뒤(도플갱어로 제거될 캐릭터는 제외된 채) 호출해야 한다.
    윤대웅/윤영준/이영웅처럼 상대 팀에도 영향을 주는 효과가 있어서, 한쪽 팀이 아니라 양 팀을 함께 받는다.
    events가 주어지면 스탯이 바뀐 대상 목록을 star_effect_resolve 이벤트로 남긴다(프론트 상태 아이콘용)."""
    for side_name, own_team, enemy_team in (
        ("attacker", attacker_team, defender_team),
        ("defender", defender_team, attacker_team),
    ):
        enemy_side = "defender" if side_name == "attacker" else "attacker"
        for slot in ("front", "back"):
            unit = own_team[slot]
            if not unit or unit["hp"] <= 0 or not unit.get("star_effect_type"):
                continue
            handler = STAR_EFFECT_HANDLERS.get(unit["star_effect_type"])
            if not handler:
                continue
            changes = handler(unit, own_team, enemy_team, unit["star_params"]) or []
            if events is None:
                continue
            change_dicts = [
                {
                    "target": target["name"],
                    "target_side": side_name if rel == "own" else enemy_side,
                    "atk": atk_sign,
                    "hp": hp_sign,
                }
                for rel, target, atk_sign, hp_sign in changes
                if atk_sign or hp_sign
            ]
            if change_dicts:
                events.append({
                    "time": 0, "event_type": "star_effect_resolve", "side": side_name,
                    "actor": unit["name"], "effect_type": unit["star_effect_type"],
                    "detail": {"changes": change_dicts},
                })


# ───────────────────────── 스킬(skill) - 기본공격 3회 시전마다 발동 ─────────────────────────

def _skill_self_stack_buff(caster, own_team, enemy_team, params, time_elapsed):
    status = caster["status"]
    if status["stack_count"] < params["max_stacks"]:
        status["stack_count"] += 1
    status["atk_percent_bonus"] = status["stack_count"] * params["percent_per_stack"]
    return {"stack_count": status["stack_count"], "atk_percent_bonus": status["atk_percent_bonus"]}


def _skill_summon_clone(caster, own_team, enemy_team, params, time_elapsed):
    # 복제체는 기존 전방/후방 인원을 대체하지 않고, 별도의 "summon" 자리에 추가로 나타난다(3번째 유닛).
    # 이미 복제체가 있으면(이전 캐스팅에서 소환한 것) 그것만 제거하고 새 복제체로 교체한다 - 항상 최대 1마리.
    replaced = own_team.get("summon")

    clone_max_hp = round(caster["max_hp"] * params["hp_percent"] / 100)
    clone_atk = round(caster["atk"] * params["atk_percent"] / 100)
    clone = {
        "name": f"{caster['name']}의 복제체",
        "hp": clone_max_hp, "max_hp": clone_max_hp, "atk": clone_atk, "star": caster["star"],
        "is_melee": caster["is_melee"], "attack_type": caster["attack_type"], "defense_type": caster["defense_type"],
        "attack_interval": caster["attack_interval"], "next_attack_time": time_elapsed + caster["attack_interval"],
        "attack_count": 0, "is_casting": False, "cast_end_time": None,
        "skill_effect_type": None, "skill_params": None,
        "trait_effect_type": None, "trait_params": None, "trait_partner_name": None,
        "status": _new_status(), "is_clone": True,
    }
    own_team["summon"] = clone
    return {
        "summoned": True, "clone_name": clone["name"], "clone_hp": clone_max_hp, "clone_atk": clone_atk,
        "clone_slot": "summon", "replaced": replaced["name"] if replaced else None,
    }


def _skill_conditional_target_debuff(caster, own_team, enemy_team, params, time_elapsed):
    target = _alive_target(enemy_team)
    if target is None:
        return {"hit": False}

    # 공격 속도 증가는 대상 성별과 무관하게 시전할 때마다 항상 적용된다. 기절만 대상이 여성일 때 조건부로 걸린다.
    caster["status"]["haste_percent"] = params["haste_percent"]
    caster["status"]["haste_until"] = time_elapsed + params["haste_seconds"]

    condition_met = params["condition"] != "target_gender_female" or CHARACTER_GENDER.get(target["name"]) == "여"
    if condition_met:
        target["status"]["stun_until"] = time_elapsed + params["stun_seconds"]

    return {
        "hit": True, "target": target["name"], "stunned": condition_met,
        "stun_seconds": params["stun_seconds"] if condition_met else 0,
        "haste_percent": params["haste_percent"],
        "haste_seconds": params["haste_seconds"],  # 프론트 상태 아이콘(공격속도 증가)의 지속시간 표시용
    }


def _skill_heal_ally_percent_max_hp(caster, own_team, enemy_team, params, time_elapsed):
    ally = _teammate(own_team, caster)
    if not ally or ally["hp"] <= 0:
        return {"healed": False}
    heal = round(ally["max_hp"] * params["percent"] / 100)
    before = ally["hp"]
    ally["hp"] = min(ally["max_hp"], ally["hp"] + heal)
    return {"healed": True, "target": ally["name"], "amount": ally["hp"] - before}


def _skill_self_shield_duration(caster, own_team, enemy_team, params, time_elapsed):
    caster["status"]["shield_until"] = time_elapsed + params["seconds"]
    return {"shield_seconds": params["seconds"]}


def _skill_bonus_damage_knockback(caster, own_team, enemy_team, params, time_elapsed):
    target = _alive_target(enemy_team)
    if target is None:
        return {"hit": False}
    type_mult = get_type_multiplier(caster["attack_type"], target["defense_type"])
    atk, is_crit = _roll_damage_atk(caster, time_elapsed)
    damage = atk * params["multiplier"] / 100 * type_mult
    damage = _apply_gendered_damage_bonus(caster, target, damage)
    dealt = _apply_damage(target, damage, time_elapsed)
    target["next_attack_time"] = max(target["next_attack_time"], time_elapsed) + 1.0  # 밀쳐내기 = 다음 행동 1초 지연

    # 넉백은 대상이 "뒤로 밀려난" 것으로 취급한다 - own_team 소속 근거리 유닛들(캐스터 포함)은
    # 그 대상과 다시 접촉할 때까지 걸어가야 하고, 그동안은 공격할 수 없다(첫 접근 지연과 같은 방식).
    # 캐스터(청년)는 넉백 직후 즉시 이동을 시작하므로, 밀려난 거리(단축됨)에 맞는 짧은 시간만 걸린다.
    reapproach_by = time_elapsed + KNOCKBACK_REAPPROACH_TIME
    for u in _alive_units(own_team):
        if u.get("is_melee"):
            u["next_attack_time"] = max(u["next_attack_time"], reapproach_by)

    return {"hits": [{"target": target["name"], "damage": dealt, "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult}]}


def _skill_aoe_gendered_damage(caster, own_team, enemy_team, params, time_elapsed):
    hits = []
    for t in _alive_units(enemy_team):
        gender = CHARACTER_GENDER.get(t["name"], "남")
        mult = params["female_multiplier"] if gender == "여" else params["male_multiplier"]
        type_mult = get_type_multiplier(caster["attack_type"], t["defense_type"])
        atk, is_crit = _roll_damage_atk(caster, time_elapsed)
        damage = atk * mult / 100 * type_mult
        damage = _apply_gendered_damage_bonus(caster, t, damage)
        dealt = _apply_damage(t, damage, time_elapsed)
        hits.append({"target": t["name"], "damage": dealt, "target_hp_after": t["hp"], "target_max_hp": t["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult})
    return {"hits": hits}


def _skill_copy_target_skill(caster, own_team, enemy_team, params, time_elapsed):
    target = _alive_target(enemy_team)
    if target and target.get("skill_effect_type") and not target.get("is_clone"):
        effect_type = target["skill_effect_type"]
        handler = SKILL_EFFECT_HANDLERS.get(effect_type)
        if handler:
            scaled = _scale_params(target["skill_params"] or {}, params["potency_percent"] / 100)
            detail = handler(caster, own_team, enemy_team, scaled, time_elapsed)
            detail["copied_from"] = target["name"]
            detail["copied_effect_type"] = effect_type
            return detail
    # 복제할 스킬이 없으면 단순 피해
    if target is None:
        return {"hit": False}
    type_mult = get_type_multiplier(caster["attack_type"], target["defense_type"])
    atk, is_crit = _roll_damage_atk(caster, time_elapsed)
    damage = atk * params["fallback_multiplier"] / 100 * type_mult
    damage = _apply_gendered_damage_bonus(caster, target, damage)
    dealt = _apply_damage(target, damage, time_elapsed)
    return {"hits": [{"target": target["name"], "damage": dealt, "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult}]}


def _skill_stun_target(caster, own_team, enemy_team, params, time_elapsed):
    target = _alive_target(enemy_team)
    if target is None:
        return {"hit": False}
    target["status"]["stun_until"] = time_elapsed + params["seconds"]
    return {"hit": True, "target": target["name"], "stun_seconds": params["seconds"]}


def _skill_aoe_enemy_damage(caster, own_team, enemy_team, params, time_elapsed):
    hits = []
    for t in _alive_units(enemy_team):
        type_mult = get_type_multiplier(caster["attack_type"], t["defense_type"])
        atk, is_crit = _roll_damage_atk(caster, time_elapsed)
        damage = atk * params["multiplier"] / 100 * type_mult
        damage = _apply_gendered_damage_bonus(caster, t, damage)
        dealt = _apply_damage(t, damage, time_elapsed)
        hits.append({"target": t["name"], "damage": dealt, "target_hp_after": t["hp"], "target_max_hp": t["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult})
    return {"hits": hits}


def _skill_damage_hp_percent_plus_atk(caster, own_team, enemy_team, params, time_elapsed):
    target = _alive_target(enemy_team)
    if target is None:
        return {"hit": False}
    atk, is_crit = _roll_damage_atk(caster, time_elapsed)
    damage = target["hp"] * params["hp_percent"] / 100 + atk * params["atk_percent"] / 100
    damage = _apply_gendered_damage_bonus(caster, target, damage)
    dealt = _apply_damage(target, damage, time_elapsed)
    return {"hits": [{"target": target["name"], "damage": dealt, "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit, "type_multiplier": 1.0}]}


def _skill_debuff_atk_and_damage(caster, own_team, enemy_team, params, time_elapsed):
    target = _alive_target(enemy_team)
    if target is None:
        return {"hit": False}
    target["status"]["atk_percent_debuff"] = params["atk_debuff_percent"]
    target["status"]["temp_debuff_until"] = time_elapsed + params["debuff_seconds"]
    type_mult = get_type_multiplier(caster["attack_type"], target["defense_type"])
    atk, is_crit = _roll_damage_atk(caster, time_elapsed)
    damage = atk * params["multiplier"] / 100 * type_mult
    damage = _apply_gendered_damage_bonus(caster, target, damage)
    dealt = _apply_damage(target, damage, time_elapsed)
    return {
        "hits": [{"target": target["name"], "damage": dealt, "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult}],
        "debuff_seconds": params["debuff_seconds"],  # 프론트 상태 아이콘(공격력 감소)의 지속시간 표시용
        "debuff_target": target["name"],
    }


def _skill_aoe_all_others_damage(caster, own_team, enemy_team, params, time_elapsed):
    hits = []
    for u in _alive_units(own_team):
        if u is caster:
            continue
        atk, is_crit = _roll_damage_atk(caster, time_elapsed)
        dealt = _apply_damage(u, atk * params["multiplier"] / 100, time_elapsed)
        hits.append({"target": u["name"], "damage": dealt, "target_hp_after": u["hp"], "target_max_hp": u["max_hp"], "is_crit": is_crit, "type_multiplier": 1.0})
    for u in _alive_units(enemy_team):
        type_mult = get_type_multiplier(caster["attack_type"], u["defense_type"])
        atk, is_crit = _roll_damage_atk(caster, time_elapsed)
        damage = atk * params["multiplier"] / 100 * type_mult
        damage = _apply_gendered_damage_bonus(caster, u, damage)
        dealt = _apply_damage(u, damage, time_elapsed)
        hits.append({"target": u["name"], "damage": dealt, "target_hp_after": u["hp"], "target_max_hp": u["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult})
    return {"hits": hits}


SKILL_EFFECT_HANDLERS = {
    "self_stack_buff": _skill_self_stack_buff,
    "summon_clone": _skill_summon_clone,
    "conditional_target_debuff": _skill_conditional_target_debuff,
    "heal_ally_percent_max_hp": _skill_heal_ally_percent_max_hp,
    "self_shield_duration": _skill_self_shield_duration,
    "bonus_damage_knockback": _skill_bonus_damage_knockback,
    "aoe_gendered_damage": _skill_aoe_gendered_damage,
    "copy_target_skill": _skill_copy_target_skill,
    "stun_target": _skill_stun_target,
    "aoe_enemy_damage": _skill_aoe_enemy_damage,
    "damage_hp_percent_plus_atk": _skill_damage_hp_percent_plus_atk,
    "debuff_atk_and_damage": _skill_debuff_atk_and_damage,
    "aoe_all_others_damage": _skill_aoe_all_others_damage,
}


def _do_basic_attack(unit, side, own_team, enemy_team, time_elapsed, events):
    """기본공격 처리. 김남옥만 예외적으로(★4부터, star_effects 문구 기준) 적 2인 모두를 타격한다
    (주 대상 100%, 나머지 25%) - 기존 star_effects 문구("주 대상 100%, 다른 적 25%")와 확정된 공격
    연출(다트가 적 2인에게 명중)이 일치해서 이 캐릭터만 기본공격 자체가 다중 타격으로 구현돼 있다."""
    targets = _alive_units(enemy_team)
    if not targets:
        return
    if unit["name"] == "김남옥" and unit.get("star", 1) >= 4:
        for i, target in enumerate(targets):
            mult = 1.0 if i == 0 else 0.25
            type_mult = get_type_multiplier(unit["attack_type"], target["defense_type"])
            atk, is_crit = _roll_damage_atk(unit, time_elapsed)
            damage = atk * mult * type_mult
            damage = _apply_gendered_damage_bonus(unit, target, damage)
            dealt = _apply_damage(target, damage, time_elapsed)
            events.append({
                "time": time_elapsed, "event_type": "basic_attack", "side": side, "type_multiplier": type_mult,
                "actor": unit["name"], "target": target["name"], "damage": dealt,
                "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit,
            })
    else:
        target = _select_basic_attack_target(unit, enemy_team)
        if target is None:
            return
        type_mult = get_type_multiplier(unit["attack_type"], target["defense_type"])
        atk, is_crit = _roll_damage_atk(unit, time_elapsed)
        damage = atk * type_mult
        damage = _apply_gendered_damage_bonus(unit, target, damage)
        dealt = _apply_damage(target, damage, time_elapsed)
        events.append({
            "time": time_elapsed, "event_type": "basic_attack", "side": side, "type_multiplier": type_mult,
            "actor": unit["name"], "target": target["name"], "damage": dealt,
            "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit,
        })


def simulate_battle(attacker_team: dict, defender_team: dict) -> dict:
    """
    두 팀(전방+후방)을 받아 시간 기반으로 전투를 시뮬레이션한다.
    전방이 살아있는 동안은 전방만 공격받고, 전방이 죽으면 후방이 대신 공격받는다(김남옥의 기본공격은 예외 - 둘 다 맞음).
    각 유닛은 기본공격 3회마다 자신의 스킬을 시전한다(시전 시간 = 공격 주기 * 2, 시전 중엔 기본공격 안 함).
    반환값의 events는 프론트에서 순서대로 재생하는 데 쓰인다.
    """
    time_elapsed = 0.0
    events = []

    _apply_battle_start_traits(attacker_team, events, "attacker")
    _apply_battle_start_traits(defender_team, events, "defender")
    _apply_battle_start_star_effects(attacker_team, defender_team, events)

    while _team_alive(attacker_team) and _team_alive(defender_team):
        time_elapsed = round(time_elapsed + TICK, 2)

        for side_name, own_team, enemy_team in (
            ("attacker", attacker_team, defender_team),
            ("defender", defender_team, attacker_team),
        ):
            for slot in ("front", "back", "summon"):
                unit = own_team[slot]
                if unit is None or unit["hp"] <= 0:
                    continue

                status = unit["status"]
                if status["stun_until"] is not None and time_elapsed < status["stun_until"]:
                    continue

                if unit["is_casting"]:
                    if time_elapsed >= unit["cast_end_time"]:
                        handler = SKILL_EFFECT_HANDLERS.get(unit["skill_effect_type"])
                        detail = handler(unit, own_team, enemy_team, unit["skill_params"], time_elapsed) if handler else {}
                        events.append({
                            "time": time_elapsed, "event_type": "skill_resolve", "side": side_name,
                            "actor": unit["name"], "effect_type": unit["skill_effect_type"], "detail": detail,
                        })
                        unit["is_casting"] = False
                        unit["cast_end_time"] = None
                        unit["attack_count"] = 0
                        # max로 두는 이유: 청년의 넉백처럼 스킬 핸들러가 캐스터 자신의 next_attack_time을
                        # (own_team 순회 중) 미리 더 늦게 예약해뒀을 수 있어서, 여기서 무조건 덮어쓰면 그
                        # 예약이 사라진다. 그 외 모든 스킬은 캐스팅 시작 이후 next_attack_time을 안 건드려서
                        # 항상 과거 값이므로, max를 써도 기존 동작과 완전히 동일하다.
                        unit["next_attack_time"] = max(unit["next_attack_time"], time_elapsed + _effective_interval(unit, time_elapsed))
                    continue

                if time_elapsed < unit["next_attack_time"]:
                    continue

                if _alive_target(enemy_team) is None:
                    continue

                _do_basic_attack(unit, side_name, own_team, enemy_team, time_elapsed, events)
                unit["attack_count"] += 1

                interval = _effective_interval(unit, time_elapsed)
                if unit["attack_count"] >= SKILL_TRIGGER_ATTACK_COUNT and unit["skill_effect_type"] and not unit["is_clone"]:
                    unit["is_casting"] = True
                    unit["cast_end_time"] = time_elapsed + SKILL_CAST_INTERVAL_MULTIPLIER * interval
                    events.append({
                        "time": time_elapsed, "event_type": "cast_start", "side": side_name,
                        "actor": unit["name"], "effect_type": unit["skill_effect_type"],
                        "duration": SKILL_CAST_INTERVAL_MULTIPLIER * interval,
                    })
                else:
                    unit["next_attack_time"] = time_elapsed + interval

    attacker_alive = _team_alive(attacker_team)
    defender_alive = _team_alive(defender_team)

    if attacker_alive and not defender_alive:
        attacker_won = True
    elif defender_alive and not attacker_alive:
        attacker_won = False
    else:
        # 시간 초과(둘 다 생존) - 남은 체력 비율이 높은 쪽이 승리 (복제체가 있으면 그 체력도 합산)
        def _hp_ratio(team):
            alive = [u for u in _all_slots(team) if u]
            total_hp = sum(u["hp"] for u in alive)
            total_max = sum(u["max_hp"] for u in alive)
            return (total_hp / total_max) if total_max else 0

        attacker_won = _hp_ratio(attacker_team) >= _hp_ratio(defender_team)

    return {
        "events": events,
        "attacker_won": attacker_won,
        "duration": time_elapsed,
        "final_attacker_team": attacker_team,
        "final_defender_team": defender_team,
    }
