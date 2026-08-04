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
CHARACTER_JOB_CLASS = {char["name"]: char.get("job_class") for char in _ALL_CHARACTERS}


def _effective_gender(unit):
    """전투 중 성별이 바뀌는 캐릭터(이의진 - 염색체 변환으로 type2/여 상태가 되면)를 반영한 성별 조회.
    unit["gender_override"]가 있으면 그걸 우선하고, 없으면 characters.json의 고정 성별로 폴백한다."""
    return unit.get("gender_override") or CHARACTER_GENDER.get(unit["name"])
CHARACTER_SKILL_MECHANICS = {char["name"]: char["skill_mechanics"] for char in _ALL_CHARACTERS if char.get("skill_mechanics")}
CHARACTER_TRAIT_MECHANICS = {char["name"]: char["trait_mechanics"] for char in _ALL_CHARACTERS if char.get("trait_mechanics")}
CHARACTER_STAR_MECHANICS = {char["name"]: char["star_mechanics"] for char in _ALL_CHARACTERS if char.get("star_mechanics")}

# 방임석("예술가의 혼") 전용 - 다른 캐릭터의 [Active] 스킬을 피해/회복,특수/강화,약화,CC 세 종류로
# 분류한다. characters.json의 "skill_categories"(캐릭터별 데이터)에서 그대로 읽어오므로, 새 캐릭터를
# 추가할 때도 이 파일은 건드릴 필요 없이 characters.json에 skill_categories만 채우면 된다("첫 번째
# 효과"만 보는 게 아니라, 스킬이 가진 효과 종류 전부에 대해 물감을 각각 받는다 - 예) 임소정은
# 약화+피해를 모두 가지므로 노란+빨간 물감을 동시에 받는다). 강승유(copy_target_skill)는 매번 실제로
# 복제한 스킬의 effect_type이 달라지므로 이 표의 값은 폴백(복제 실패 시 순수 피해)이고,
# _apply_paint_gain이 detail["copied_effect_type"]을 우선 조회해서 동적으로 분류한다.
SKILL_TYPE_CATEGORY = {
    char["skill_mechanics"]["effect_type"]: tuple(char["skill_categories"])
    for char in _ALL_CHARACTERS
    if char.get("skill_mechanics") and char.get("skill_categories")
}

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


MELEE_MOVE_TIME_FRONT = 2.0  # 전방 근거리 유닛이 적에게 다가가는 시간(초) - MELEE_SPEED_FRONT 계산에 쓰임
MELEE_MOVE_TIME_BACK = 3.6   # 후방 근거리 유닛은 더 멀리서 오니까 더 오래 걸림 - MELEE_SPEED_BACK 계산에 쓰임
MELEE_ATTACK_INTERVAL = 1.2   # 근거리 공격 주기(초)
RANGED_ATTACK_INTERVAL = 1.5  # 원거리 공격 주기(초)
TICK = 0.05

# ── 위치(공유 좌표축) 기반 전방/후방 판정 ──
# 근접 유닛의 실제 이동을 이 하나의 축 위에서 시뮬레이션한다: 공격자 후방(0) -> 공격자 전방(1) ->
# 방어자 전방(2) -> 방어자 후방(3) 순으로 일직선에 놓여있다고 본다. 원거리 유닛은 이 좌표에 고정된 채
# 평생 움직이지 않는다. "전방/후방"은 더 이상 고정 슬롯이 아니라 이 좌표 기준 "누가 더 전진(노출)했는지"로
# 매 순간 다시 판정된다(_alive_units 참고) - 근접 유닛이 슬롯상 후방이어도 충분히 걸어나가면 슬롯상
# 전방보다 먼저 타겟이 될 수 있고, 넉백으로 밀려나면 반대로 우선순위를 잃을 수도 있다.
AXIS_ATTACKER_BACK = 0.0
AXIS_ATTACKER_FRONT = 1.0
AXIS_DEFENDER_FRONT = 2.0
AXIS_DEFENDER_BACK = 3.0

# 슬롯별 이동 속도(좌표/초) - "자기 홈 좌표 -> 적 전방(가장 가까운 상대 슬롯) 도달 시간"이 기존
# MELEE_MOVE_TIME_FRONT/BACK과 정확히 같아지도록 역산한 값. 이 속도로 상대 후방까지 더 걸어가면(거리가
# 더 머니까) 자연히 더 오래 걸린다 - 별도 매직 넘버 없이 기존 두 상수만으로 모든 거리를 커버한다.
MELEE_SPEED_FRONT = (AXIS_DEFENDER_FRONT - AXIS_ATTACKER_FRONT) / MELEE_MOVE_TIME_FRONT  # 0.5
MELEE_SPEED_BACK = (AXIS_DEFENDER_FRONT - AXIS_ATTACKER_BACK) / MELEE_MOVE_TIME_BACK      # ≈0.5556

ARRIVAL_EPSILON = 0.01  # 목표와의 좌표 차이가 이 이하면 "도착"으로 취급(부동소수 오차 대비 여유)

# 넉백으로 밀려나는 거리(좌표축 기준) - 인접한 슬롯 하나 폭(예: 상대 전방->상대 후방)과 같은 값이라
# "슬롯 하나만큼 뒤로 밀려난다"는 감각이다. 자기 팀 홈 back 좌표를 넘어서까지 밀리지는 않는다(클램프).
KNOCKBACK_POSITION_DISTANCE = AXIS_DEFENDER_BACK - AXIS_DEFENDER_FRONT  # 1.0

# 노출도 순위가 바뀌어서 기본공격 대상이 "달라질 후보"가 나타나도, 곧바로 갈아타지 않고 그 후보가
# 이 시간만큼 계속 1순위를 유지해야 비로소 확정한다(뜸들이기) - 근소한 차이로 순위가 잠깐씩 오락가락할
# 때마다 시선이 휙휙 바뀌는 게 부자연스러워서다. 단, 이미 정한 대상이 하나도 없거나(첫 타겟 선정) 그
# 대상이 죽었을 때는 망설임 없이 즉시 확정한다 - _resolve_basic_attack_target 참고.
TARGET_SWITCH_HESITATION_SECONDS = 0.51

SKILL_TRIGGER_ATTACK_COUNT = 3   # 기본공격 몇 회마다 스킬을 시전하는지
SKILL_CAST_INTERVAL_MULTIPLIER = 0.7  # 시전 시간 = 기본공격 주기 * 이 값

# 전투 시간(게임 내 초) 상한 - 회복형 캐릭터가 양쪽/한쪽에 몰리면(예: 회복 스킬을 쓰는 유닛이 여럿) 입히는
# 피해보다 회복량이 더 커져서 어느 쪽도 전멸하지 않는 채로 전투가 사실상 끝나지 않을 수 있다. 정상적인
# 전투는 대부분 이 안에서 끝나므로(넉넉하게 여유를 둠), 이 시간을 넘기면 그 시점 HP 비율이 더 높은 쪽을
# 승자로 강제 종료한다.
MAX_BATTLE_DURATION = 180.0


def _new_status():
    return {
        "atk_percent_bonus": 0,      # 영구 공격력 증감 총합(특성/성급 효과 - 여러 영구 소스가 있어도
                                      # 만료를 추적할 필요가 없어 그냥 이 스칼라 하나에 전부 누적한다.
                                      # 부호로 버프/디버프를 함께 표현한다(이영웅/윤대웅 star effect의
                                      # 영구 디버프도 이 필드를 음수로 깎는 방식).
        "temp_atk_mods": {},         # 임시(지속시간 있는) 공격력 변화 전부 - 소스(캐릭터 인스턴스 id)별로
                                      # 독립된 {"percent": ±X, "until": 시각} 항목을 갖는다. 같은 소스가
                                      # 다시 걸면 그 소스의 항목만 새 값으로 갱신(교체)되고, 다른 소스가
                                      # 걸면 별도 항목으로 추가되어 활성 상태인 동안 서로 합산된다 -
                                      # _effective_atk가 매번 "지금 시각 기준 아직 안 끝난" 항목들을
                                      # 전부 더해서 실효 값을 계산한다(각자 자기 시각에 독립적으로 만료됨).
        "haste_percent": 0,          # 영구 공격속도 증가 총합(전투 시작 특성 - battlefield_presence_haste 등)
        "temp_haste_mods": {},       # 임시 공격속도 증가 - temp_atk_mods와 동일한 소스별 독립 합산 방식
        "shield_until": None,        # 이 시간까지는 받는 피해가 0
        "stun_until": None,          # 이 시간까지는 아무 행동도 못 함
        "stack_count": 0,
        "paint_red": 0,               # 방임석 전용 - 물감(빨강/파랑/노랑) 보유 개수, 다른 캐릭터는 항상 0
        "paint_blue": 0,
        "paint_yellow": 0,
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
        # 첫 공격까지의 "걸어가는 시간"은 더 이상 고정 지연이 아니라, position이 실제로 목표에 도착해야
        # 하는 조건으로 대체된다(simulate_battle의 메인 루프 참고) - 그 도착 속도만 슬롯별로 여기서 정한다.
        melee_speed = MELEE_SPEED_BACK if slot == "back" else MELEE_SPEED_FRONT
    else:
        hp = ranged_hp
        atk = round(melee_atk * RANGE_STAT_MULTIPLIER)  # 원거리 공격력 = 근거리 공격력의 1.5배(화력형)
        attack_interval = RANGED_ATTACK_INTERVAL
        melee_speed = None  # 원거리는 걷지 않음 - position이 홈 좌표에 고정된 채 평생 안 바뀜

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
            trait_partner_name = trait_mech.get("partner_name")

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
        "job_class": CHARACTER_JOB_CLASS.get(character_name),
        "attack_type": ATTACK_TYPE.get(character_name, "Student"),
        "defense_type": DEFENSE_TYPE.get(character_name, "Student"),
        "attack_interval": attack_interval,
        "next_attack_time": attack_interval,
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
        "melee_speed": melee_speed,
        # position/is_attacker_team은 아직 모른다(이 시점엔 이 유닛이 공격자 팀인지 방어자 팀인지도
        # 정해지지 않음) - simulate_battle 시작 시 실제 값으로 채워진다.
        "position": None,
        "is_attacker_team": None,
    }


def build_team(front, back):
    # "summon_front"/"summon_back"은 기존 전방/후방과 별개로 존재하는 전용 자리 - 윤영준의 복제체처럼
    # 인원을 대체하지 않고 "추가로" 소환되는 유닛 전용이다. 평소엔 비어있다(None). 시전자가 front면
    # summon_front, back이면 summon_back을 쓰므로, 같은 팀에 summon_clone을 쓰는 캐릭터가 둘(예:
    # 윤영준+강승유) 있어도 서로의 복제체를 밀어내지 않고 각자 자기 몫의 복제체를 유지할 수 있다.
    return {"front": front, "back": back, "summon_front": None, "summon_back": None}


def _all_slots(team):
    return (team["front"], team["back"], team.get("summon_front"), team.get("summon_back"))


def _exposure(unit):
    """유닛의 "노출도" - 값이 클수록 더 전진해서(공격받기 쉬운 상태로) 나가있다는 뜻이다. position은
    공유 좌표축 절대값이라 팀마다 "전진 방향"이 반대라서(공격자는 좌표가 커질수록, 방어자는 작아질수록
    전진), is_attacker_team으로 부호를 정규화해서 두 팀 모두 "이 값이 클수록 더 전진"으로 통일한다."""
    return unit["position"] if unit["is_attacker_team"] else -unit["position"]


def _alive_units(team):
    """생존 유닛을 "더 전진(노출)한 순서"로 반환한다. 예전엔 항상 front->back 고정 슬롯 순서였지만,
    이제 실제 시뮬레이션된 물리적 position 기준으로 매 순간 다시 정렬된다 - 근접 유닛이 슬롯상
    후방이어도 걸어서 슬롯상 전방보다 더 앞서 나가면(또는 넉백으로 전방이 뒤로 밀려나면) 그 쪽이
    실제로 first가 된다. 전투 시작 시점엔 모두 홈 좌표에 있어 front가 항상 back보다 노출도가 높으므로,
    아직 아무도 움직이지 않았다면 기존과 동일하게 front가 먼저 나온다.
    복제체(클론)도 front/back과 완전히 동일하게 이 노출도 순서에 함께 정렬된다 - "전방/후방이 모두
    죽어야 비로소 대상이 됨"이라는 예전 고정 규칙은 폐지됐다. 클론은 시전자의 그 순간 position을
    물려받아 시작하고(_skill_summon_clone), 근접이면 이후에도 다른 유닛과 동일하게 자기 target을
    쫓아 계속 움직이므로, 노출도 계산에 그대로 섞여 들어가도 값이 항상 유효하다."""
    units = [u for u in (team["front"], team["back"], team.get("summon_front"), team.get("summon_back")) if u and u["hp"] > 0]
    units.sort(key=_exposure, reverse=True)
    return units


def _alive_target(team):
    units = _alive_units(team)
    return units[0] if units else None


def _tag_target_sides(detail, side_name, own_team, enemy_team):
    """스킬 결과(detail)의 각 피격 대상에 실제로 맞은 쪽(attacker/defender)을 명시적으로 붙인다.
    이름만으로는 프론트가 대상을 못 찾는다 - 같은 캐릭터가 양 팀에 모두 있으면(미러/유사 편성)
    이름만 보고는 어느 쪽이 맞았는지 알 수 없어서, 항상 attacker 쪽을 먼저 찾는 폴백 때문에
    실제로는 적이 죽었는데 화면에는 아군이 죽었다가(다음 갱신에서 원래 체력으로) 되살아난 것처럼
    보이는 버그가 있었다. 각 핸들러가 dict에 심어둔 _target_ref(실제 유닛 객체 참조)의 identity로
    own_team/enemy_team 중 어디 소속인지 판정해서 target_side를 붙이고, 참조는 다시 지운다
    (그대로 두면 JSON으로 직렬화할 수 없다)."""
    if not detail:
        return detail
    enemy_side = "defender" if side_name == "attacker" else "attacker"
    own_ids = {id(u) for u in _all_slots(own_team) if u is not None}

    def resolve(ref):
        return side_name if id(ref) in own_ids else enemy_side

    # "hits"는 모든 단일/다중 대상 피해 스킬이 쓰는 표준 목록. "stunned"는 방임석의 "제목은 관객이
    # 정하세요"(노란 물감)처럼 피해 없이 대상만 기절시키는 경우 전용 - 같은 방식으로 태깅한다.
    # _skill_conditional_target_debuff처럼 "stunned"를 리스트가 아니라 단순 성공 여부(bool)로 쓰는
    # 더 오래된 핸들러도 있어서, 리스트일 때만 순회한다(아니면 'bool' object is not iterable로 죽음).
    for key in ("hits", "stunned"):
        values = detail.get(key)
        if not isinstance(values, list):
            continue
        for hit in values:
            ref = hit.pop("_target_ref", None)
            if ref is not None:
                hit["target_side"] = resolve(ref)

    ref = detail.pop("_target_ref", None)
    if ref is not None:
        detail["target_side"] = resolve(ref)

    return detail


def _team_alive(team):
    return bool(_alive_target(team))


def _teammate(team, unit):
    """자신을 제외한 다른 팀원 1명(살아있든 아니든) - front/back/summon_front/summon_back 순서로 첫 번째를 반환."""
    for other in _all_slots(team):
        if other is not None and other is not unit:
            return other
    return None


def _select_basic_attack_target(unit, enemy_team):
    """기본공격 대상 선정. 전방/후방은 고정 슬롯이 아니라 "실제 위치(노출도)"로 매번 다시 정해진다:
    _alive_units가 노출도(_exposure) 내림차순으로 돌려주므로, 근접 유닛이 걸어서 자기 팀의 다른
    슬롯보다 더 앞서 나가면(또는 넉백으로 앞서있던 쪽이 뒤로 밀려나면) 실제로 더 전진한 쪽이 자연히
    첫 타겟이 된다 - 슬롯 자체가 "전방/후방"이라는 이름표를 갖는 게 아니라, 매 순간 누가 더 노출돼
    있는지로 판정된다. 복제체도 front/back과 동일하게 이 노출도 순서에 섞여서 정렬된다(더 이상
    "전방/후방이 모두 죽어야만 대상이 됨"이 아니다) - 캐스터가 소환 시점 위치를 그대로 물려받고,
    근접이면 이후 계속 움직이므로 위치가 항상 유효하다.

    - 기본: 지금 가장 전진(노출)한 유닛(목록의 맨 앞)을 때린다.
    - rear_priority 플래그가 있는 유닛(최재혁 ★3부터, 또는 "마법사 아카데미"로 그 효과를 받은 아군
      마법사)만 예외: "무조건" 가장 덜 전진한(실질적으로 가장 뒤쪽인, 복제체 포함) 유닛을 먼저 때린다.
      살아있는 게 1명뿐이면 그가 곧 유일한 대상이다.

    - rear_priority의 동률 예외: 서로 다른 아군 근접 유닛들이 같은 상대를 쫓다 보면(예: 최재혁을
      추격하는 적 전방/후방이 둘 다 최재혁 위치까지 따라붙음) 노출도가 완전히 같은 좌표로 수렴하는
      경우가 실제로 생긴다. 이때 매번 안정적으로 "뒤 슬롯"으로 계산되긴 하지만, 방금 전까지 확정
      대상이던 유닛과 다르면 아무 실질적 위치 차이도 없는데 갑자기 상대를 놓아버린 것처럼 보인다
      (뜸들이기로도 못 막는다 - 새 후보 자체가 매 순간 진짜로 동률이라 조건을 그대로 통과함). 노출도가
      완전히 같을 땐 지금 이미 확정된 대상이 그 동률 후보 중 하나면 그대로 유지한다."""
    units = _alive_units(enemy_team)
    if not units:
        return None

    if unit.get("rear_priority"):
        if len(units) < 2:
            return units[0]
        least_exposed = units[-1]
        if _exposure(least_exposed) == _exposure(units[0]):
            locked = unit.get("locked_target_ref")
            if locked is not None and any(locked is u for u in units):
                return locked
        return least_exposed

    return units[0]


def _resolve_basic_attack_target(unit, enemy_team, time_elapsed):
    """_select_basic_attack_target이 매 순간 계산해주는 "지금 이 순간 가장 우선순위 높은 대상"을 그대로
    쓰지 않고, 지금 확정된 대상(locked_target_ref)이 TARGET_SWITCH_HESITATION_SECONDS 동안 계속
    1순위 자리를 뺏긴 채로 있어야 그제서야 갈아탄다(뜸들이기). unit["target_lost_since"]는 "확정된
    대상이 1순위가 아니게 된 게 언제부터인지"를 추적한다 - 그 사이에 1순위가 후보 A -> B -> A처럼 여러
    번 바뀌어도(다른 아군들이 함께 움직이는 실제 전투에서 흔함) 상관없이, "원래 확정된 대상이 아직도
    1순위를 못 되찾고 있다"는 사실만 계속 유지되면 시간이 그대로 쌓인다 - 그래야 뜸들이는 시간이
    TARGET_SWITCH_HESITATION_SECONDS를 넘겨서 늘어지지 않는다(예전엔 후보가 바뀔 때마다 타이머가
    처음부터 다시 시작해서, 후보들끼리 잠깐씩 엎치락뒤치락하면 실제 체감 지연이 훨씬 길어지는 문제가 있었다).
    확정될 때는 "그 순간의" 후보(반드시 처음 밀어냈던 후보일 필요는 없음)로 확정한다.

    - 아직 확정된 대상이 없거나(전투 시작 직후 첫 선정 - 예: 최재혁이 처음부터 후방을 겨냥하는 것도
      이 경로라 망설임 없음), 확정된 대상이 죽었으면: 새 후보로 즉시 확정한다(공격 못 하는 공백 방지).
    - 후보가 지금 확정된 대상과 같으면: 그대로 유지, 밀려나 있던 시간도 리셋된다.
    - 후보가 다르면: 확정된 대상이 1순위 자리를 처음 뺏긴 시점부터 시간을 재고, 기준 시간을 넘기면
      그 순간의 후보로 확정한다."""
    candidate = _select_basic_attack_target(unit, enemy_team)
    locked = unit.get("locked_target_ref")

    if candidate is None:
        return locked if locked is not None and locked["hp"] > 0 else None

    if locked is None or locked["hp"] <= 0:
        unit["locked_target_ref"] = candidate
        unit["target_lost_since"] = None
        return candidate

    if candidate is locked:
        unit["target_lost_since"] = None
        return locked

    if unit.get("target_lost_since") is None:
        unit["target_lost_since"] = time_elapsed

    if time_elapsed - unit["target_lost_since"] >= TARGET_SWITCH_HESITATION_SECONDS:
        unit["locked_target_ref"] = candidate
        unit["target_lost_since"] = None
        return candidate

    return locked


def _effective_atk(unit, time_elapsed):
    """공격력에 영향을 주는 모든 요인(영구 + 임시)을 합산한다. 영구는 스칼라 하나(atk_percent_bonus)로
    이미 누적돼 있고, 임시는 소스별로 독립된 항목(temp_atk_mods)이라 그중 "지금 아직 안 끝난" 것만
    골라 더한다 - 서로 다른 출처의 버프/디버프가 겹치는 동안엔 자연히 합산되고, 각자 자기 시각에
    독립적으로 만료된다(하나가 먼저 끝나도 나머지는 그대로 유지)."""
    status = unit["status"]
    total_percent = status["atk_percent_bonus"]
    for mod in status["temp_atk_mods"].values():
        if time_elapsed < mod["until"]:
            total_percent += mod["percent"]
    return round(unit["atk"] * (1 + total_percent / 100))


def _effective_interval(unit, time_elapsed):
    """공격 주기(속도)도 _effective_atk와 동일한 방식 - 영구(haste_percent) + 아직 안 끝난 임시
    소스(temp_haste_mods)를 전부 합산한다."""
    status = unit["status"]
    interval = unit["attack_interval"]
    total_haste = status["haste_percent"]
    for mod in status["temp_haste_mods"].values():
        if time_elapsed < mod["until"]:
            total_haste += mod["percent"]
    if total_haste:
        interval = interval * (1 - total_haste / 100)
    return interval


def _refresh_status_until(status, until_key, new_until, time_elapsed):
    """상태의 "켜짐/꺼짐"만 있는(수치가 없는) 지속시간 필드(stun_until/shield_until) 전용 - 무조건
    덮어쓰지 않고 "갱신"한다: 기존 값이 아직 유효한데(time_elapsed < 기존값) 새 값이 더 이르게
    끝난다면, 새로 걸린(대개 더 약하거나 짧은) 효과가 기존의 더 강한 효과를 실수로 단축시키지 않도록
    기존 값을 그대로 둔다. 기절/실드는 "얼마나 강하게"가 아니라 "지금 걸려있는가"만 의미가 있어서(수치를
    더할 대상이 없음) 여러 소스가 동시에 걸려도 그냥 "가장 늦게 끝나는 것 하나"로 합쳐도 결과가 같다 -
    소스별로 독립 합산해야 하는 공격력/공격속도(_effective_atk/_effective_interval의 temp_atk_mods/
    temp_haste_mods)와는 성격이 다르다. 실제로 값을 갱신했는지 여부를 반환한다."""
    current = status.get(until_key)
    if current is not None and time_elapsed < current and current >= new_until:
        return False
    status[until_key] = new_until
    return True


def _apply_damage(target, amount, time_elapsed):
    """실드가 떠 있으면 피해를 0으로 만든다. 방임석의 "방임" 상태가 활성이면(neglect_active) 대신
    받는 피해를 dr_percent만큼 줄인다 - 실드와 동시에 걸릴 일은 없다(둘 다 self 전용 상태라 서로 다른
    캐릭터에게만 각각 있음). 실제로 깎인 양을 반환."""
    if target["status"]["shield_until"] is not None and time_elapsed < target["status"]["shield_until"]:
        amount = 0
    elif target.get("neglect_active") and target.get("neglect_config"):
        amount *= (1 - target["neglect_config"]["dr_percent"] / 100)
    amount = max(0, round(amount))
    target["hp"] = max(0, target["hp"] - amount)
    return amount


# CC(기절/넉백 등)가 "이미 이번 틱에 발동 예정이던" 상대의 시전을 얼마나 강하게 끊을 수 있는지의
# 우선순위. 숫자가 클수록 강하다 - 자신보다 "엄격히 더 높은" 우선순위의 CC만 이 보호를 뚫고 취소할 수
# 있고, 동급 이하는 못 끊는다(동급끼리는 서로 취소 못 함 - 예: 넉백 스킬끼리 정확히 같은 틱에 맞부딪히면
# 원래 의도대로 둘 다 발동한다). CC의 핵심은 "상대 스킬을 확실히 취소하는 것"이라는 설계 의도에 따라
# 넉백(청년의 bonus_damage_knockback) > 기절류(스턴/디버프 기절 등) > 그 외(방임 같은 CC 아닌 상태
# 트리거) 순으로 매긴다.
CC_PRIORITY_KNOCKBACK = 2
CC_PRIORITY_STUN = 1
CC_PRIORITY_DEFAULT = 0


def _cc_priority_of_skill(effect_type):
    """어떤 스킬 효과 타입이 "대상"으로서 얼마나 강하게 보호받는지(CC_PRIORITY_*) 반환한다 - 이 값보다
    엄격히 더 높은 우선순위의 CC만 "이미 이번 틱에 발동 예정"인 이 스킬을 취소할 수 있다."""
    if effect_type == "bonus_damage_knockback":
        return CC_PRIORITY_KNOCKBACK
    if effect_type in ("stun_target", "conditional_target_debuff", "consume_paint_multi_effect"):
        return CC_PRIORITY_STUN
    return CC_PRIORITY_DEFAULT


def _interrupt_cast_if_casting(target, time_elapsed, priority=CC_PRIORITY_DEFAULT):
    """대상이 마침 스킬을 시전 중이었다면 취소한다 - 기절/넉백 등 CC기 공통 처리. 재개되지 않고, 다음
    행동은 곧장 기본공격으로 넘어간다(attack_count를 0으로 되돌려서, 성공적으로 시전을 마쳤을 때와
    동일하게 다시 기본공격 3회를 쌓아야 재시전할 수 있다). 반환값은 실제로 시전을 끊었는지 여부(프론트에
    "시전 취소" 연출을 보여주기 위한 것).

    단, 대상의 시전이 이미 "이번 틱"에 발동될 예정이었다면(cast_end_time <= time_elapsed), 이 CC의
    priority가 대상 스킬의 우선순위(_cc_priority_of_skill)보다 "엄격히 더 높을 때"만 취소한다 - 동급
    이하(넉백끼리, 스턴끼리, 또는 더 약한 CC가 더 강한 스킬을 노리는 경우)는 소급 취소하지 않는다.
    예전엔 이 보호가 전부 동일했는데(우선순위 구분 없음), 그러면 양 팀에 같은 CC 스킬을 쓰는 캐릭터가
    정확히 같은 틱에 부딪힐 때 팀 처리 순서상 아주 살짝 먼저 처리된 쪽만 일방적으로 상대를 끊어버리는
    버그가 있었다 - 우선순위 구분을 두어, 더 강한 CC(넉백)는 동급 이하를 확실히 뚫고 지나가되, 동급
    CC끼리는 서로 못 끊게(원래 의도대로 둘 다 발동) 만들었다."""
    if target.get("is_casting") and target.get("cast_end_time") is not None and target["cast_end_time"] <= time_elapsed:
        if priority <= _cc_priority_of_skill(target.get("skill_effect_type")):
            return False
    interrupted = bool(target.get("is_casting"))
    if interrupted:
        target["is_casting"] = False
        target["cast_end_time"] = None
        target["attack_count"] = 0
    return interrupted


def _apply_stun(target, stun_until, time_elapsed, priority=CC_PRIORITY_STUN):
    """대상에게 기절을 건다(+ 시전 중이었다면 취소). 기절 지속시간은 무조건 덮어쓰지 않고 "갱신"한다
    (_refresh_status_until) - 이미 더 늦게까지 기절 중이면 그 값을 유지해서, 나중에 걸린 더 짧은 기절이
    기존 기절을 오히려 단축시키지 않는다. 시전 취소 여부는 기절 지속시간 갱신 여부와 무관하게 항상
    우선순위대로 판정한다(약한 CC라도 아직 발동 전인 시전은 그대로 끊을 수 있어야 하므로). 반환값은
    시전 취소 여부. priority 기본값은 "기절류" 등급(CC_PRIORITY_STUN) - 이 함수를 쓰는 스킬은 전부
    기절 계열이라 호출부에서 따로 넘길 필요가 없다."""
    _refresh_status_until(target["status"], "stun_until", stun_until, time_elapsed)
    return _interrupt_cast_if_casting(target, time_elapsed, priority)


# ───────────────────────── 치명타 - 기본공격/스킬 모두 공통 ─────────────────────────
CRIT_CHANCE = 0.10        # 10% 확률
CRIT_MULTIPLIER = 1.5     # 공격력의 1.5배


def _roll_damage_atk(unit, time_elapsed):
    """피해 공식의 시작점(공격력 값 하나). 기본공격이든 스킬이든 이 함수를 거쳐서 공격력을 구하면
    10% 확률(unit에 crit_chance가 있으면 그 값)로 치명타(공격력 1.5배, crit_multiplier가 있으면 그 값)가
    함께 적용된다 - (사용할 공격력, 치명타 여부)를 돌려준다."""
    atk = _effective_atk(unit, time_elapsed)
    chance = unit.get("crit_chance", CRIT_CHANCE)
    is_crit = random.random() < chance
    if is_crit:
        atk = round(atk * unit.get("crit_multiplier", CRIT_MULTIPLIER))
    return atk, is_crit


def _apply_gendered_damage_bonus(unit, target, damage):
    """불빠따 김어진의 성급 효과(damage_to_gender_bonus) 전용 - 특정 성별 대상에게 주는 피해를
    추가로 늘린다. 다른 캐릭터는 이 필드가 아예 없어서(None) 항상 조용히 통과한다."""
    bonus = unit.get("gendered_damage_bonus")
    if bonus and _effective_gender(target) == bonus["gender"]:
        damage *= (1 + bonus["percent"] / 100)
    return damage


def _scale_params(params, factor):
    # 강승유의 "성대모사"처럼 남의 스킬 수치를 비율만큼 낮춰 재사용할 때 씀. 숫자 값만 스케일하고 문자열(condition/stat 등)은 그대로 둔다.
    return {k: (round(v * factor, 2) if isinstance(v, (int, float)) else v) for k, v in params.items()}


# ───────────────────────── 특성(trait) - 전투 시작 시 1회만 판정 ─────────────────────────
# 모든 핸들러는 (caster, team, enemy_team, params, events, side) 시그니처로 통일한다 - 이의진/서민석처럼
# 상대 팀까지 봐야 하는 특성이 있어서, 자기 팀만 보는 특성도 안 쓰는 enemy_team 인자를 그냥 받아둔다.

def _trait_ally_synergy_remove_absorb(caster, team, enemy_team, params, events, side):
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


def _trait_ally_synergy_atk_buff(caster, team, enemy_team, params, events, side):
    # 파트너가 있으면 자신에게 버프 - stat이 "hp"면 체력을(청년↔송주헌), 기본(atk, 윤영준↔강 희)이면
    # 공격력을 올린다. 이종복↔임소정처럼 서로가 서로를 partner_name으로 지정해두면, 양쪽 다 이 핸들러가
    # 각자 자신에게 버프를 걸어서 "함께 있으면 둘 다 강해짐"이 자연히 성립한다.
    partner = _teammate(team, caster)
    if not partner or partner["name"] != caster["trait_partner_name"] or partner["hp"] <= 0:
        return
    stat = params.get("stat", "atk")
    if stat == "hp":
        percent = params["hp_percent"]
        gain = round(caster["max_hp"] * percent / 100)
        caster["max_hp"] += gain
        caster["hp"] += gain
        detail = {"partner": partner["name"], "hp_percent": percent}
    else:
        percent = params["atk_percent"]
        caster["status"]["atk_percent_bonus"] += percent
        detail = {"partner": partner["name"], "atk_percent": percent}
    events.append({
        "time": 0, "event_type": "trait_resolve", "side": side, "actor": caster["name"],
        "effect_type": "ally_synergy_atk_buff", "detail": detail,
    })


def _trait_ally_job_conditional_team_buff(caster, team, enemy_team, params, events, side):
    # 김남옥(자애심)/강승유(친근감): 파트너의 역할(attack_type)이 job_type과 일치하면(예: "Student")
    # 아군 전체(자신 포함) 공격력/체력 X% 증가. "직업:학생"처럼 텍스트가 말하는 직업 카테고리는 이
    # 게임에서 캐릭터의 attack_type 삼각 상성값(Student/Parent/Teacher)과 대응된다 - job_class는
    # "1반 학생"/"초심자"처럼 캐릭터마다 제각각인 순수 설정 문구라 조건 판정에 쓰기엔 너무 좁다.
    partner = _teammate(team, caster)
    if not partner or partner["hp"] <= 0 or partner.get("attack_type") != params["job_type"]:
        return
    atk_percent = params.get("atk_percent", 0)
    hp_percent = params.get("hp_percent", 0)
    for ally in _alive_units(team):
        if atk_percent:
            ally["status"]["atk_percent_bonus"] += atk_percent
        if hp_percent:
            gain = round(ally["max_hp"] * hp_percent / 100)
            ally["max_hp"] += gain
            ally["hp"] += gain
    events.append({
        "time": 0, "event_type": "trait_resolve", "side": side, "actor": caster["name"],
        "effect_type": "ally_job_conditional_team_buff",
        "detail": {"partner": partner["name"], "atk_percent": atk_percent, "hp_percent": hp_percent},
    })


def _trait_ally_type_conditional_team_buff(caster, team, enemy_team, params, events, side):
    # 강 희(광역 도발): 파트너의 공격 타입이 Teacher면 아군 전체 공격력 X%, 방어 타입이 Teacher면
    # 아군 전체 체력 X% - 두 조건은 독립적이라 파트너가 둘 다 Teacher면 둘 다 적용된다("중첩 가능").
    partner = _teammate(team, caster)
    if not partner or partner["hp"] <= 0:
        return
    atk_percent = params.get("atk_percent", 0) if partner.get("attack_type") == "Teacher" else 0
    hp_percent = params.get("hp_percent", 0) if partner.get("defense_type") == "Teacher" else 0
    if not (atk_percent or hp_percent):
        return
    for ally in _alive_units(team):
        if atk_percent:
            ally["status"]["atk_percent_bonus"] += atk_percent
        if hp_percent:
            gain = round(ally["max_hp"] * hp_percent / 100)
            ally["max_hp"] += gain
            ally["hp"] += gain
    events.append({
        "time": 0, "event_type": "trait_resolve", "side": side, "actor": caster["name"],
        "effect_type": "ally_type_conditional_team_buff",
        "detail": {"partner": partner["name"], "atk_percent": atk_percent, "hp_percent": hp_percent},
    })


def _trait_team_teacher_hp_buff(caster, team, enemy_team, params, events, side):
    # 불빠따 김어진(교권 보호): 팀 내(자신 포함) 공격/방어 타입 중 하나라도 Teacher인 캐릭터 전원의
    # 최대 체력 X% 증가.
    percent = params["percent"]
    targets = []
    for u in _alive_units(team):
        if u.get("attack_type") == "Teacher" or u.get("defense_type") == "Teacher":
            gain = round(u["max_hp"] * percent / 100)
            u["max_hp"] += gain
            u["hp"] += gain
            targets.append(u["name"])
    if not targets:
        return
    events.append({
        "time": 0, "event_type": "trait_resolve", "side": side, "actor": caster["name"],
        "effect_type": "team_teacher_hp_buff",
        "detail": {"targets": targets, "hp_percent": percent},
    })


def _trait_teammate_hp_buff_self_cost(caster, team, enemy_team, params, events, side):
    # 송주헌(페이스 메이커): 파트너 최대 체력 X% 증가 + 자신의 최대 체력 50% 감소(대가).
    partner = _teammate(team, caster)
    if partner and partner["hp"] > 0:
        gain = round(partner["max_hp"] * params["hp_percent"] / 100)
        partner["max_hp"] += gain
        partner["hp"] += gain
    loss = round(caster["max_hp"] * params["self_hp_loss_percent"] / 100)
    caster["max_hp"] = max(1, caster["max_hp"] - loss)
    caster["hp"] = min(caster["hp"], caster["max_hp"])
    events.append({
        "time": 0, "event_type": "trait_resolve", "side": side, "actor": caster["name"],
        "effect_type": "teammate_hp_buff_self_cost",
        "detail": {
            "partner": partner["name"] if partner else None,
            "hp_percent": params["hp_percent"], "self_hp_loss_percent": params["self_hp_loss_percent"],
        },
    })


def _trait_battlefield_presence_haste(caster, team, enemy_team, params, events, side):
    # 이의진(복수): 전장(양 팀 모두) 내에 특정 이름의 캐릭터가 있으면 자신의 공격 속도가 전투 끝까지 증가.
    target_name = params["target_name"]
    present = any(u and u["name"] == target_name for u in _all_slots(team)) or \
        any(u and u["name"] == target_name for u in _all_slots(enemy_team))
    if not present:
        return
    caster["status"]["haste_percent"] = params["haste_percent"]  # 영구(전투 끝까지) - 만료 시각 불필요
    events.append({
        "time": 0, "event_type": "trait_resolve", "side": side, "actor": caster["name"],
        "effect_type": "battlefield_presence_haste",
        "detail": {"target_name": target_name, "haste_percent": params["haste_percent"]},
    })


def _trait_female_count_haste(caster, team, enemy_team, params, events, side):
    # 서민석(본능): 전장(양 팀 모두) 내 여성 인물 수 x X%만큼 공격 속도 증가(전투 끝까지 유지).
    female_count = sum(
        1 for u in list(_all_slots(team)) + list(_all_slots(enemy_team))
        if u and _effective_gender(u) == "여"
    )
    if female_count <= 0:
        return
    haste_percent = female_count * params["percent_per_female"]
    caster["status"]["haste_percent"] = haste_percent  # 영구(전투 끝까지) - 만료 시각 불필요
    events.append({
        "time": 0, "event_type": "trait_resolve", "side": side, "actor": caster["name"],
        "effect_type": "female_count_haste",
        "detail": {"female_count": female_count, "haste_percent": haste_percent},
    })


def _trait_dynamic_grant_rear_priority(caster, team, enemy_team, params, events, side):
    # 최재혁(마법사 아카데미): 파트너의 직업이 마법사면, 그 파트너도 자신처럼 후방 적 우선 공격을 하게
    # 만든다(_select_basic_attack_target이 rear_priority 플래그로 판정). survive_atk_percent가 있으면
    # (6성 "+" 티어) 파트너도 후방 적 생존 시 공격력 증가 조건부 보너스를 함께 받는다.
    partner = _teammate(team, caster)
    if not partner or partner["hp"] <= 0 or partner.get("job_class") != "마법사":
        return
    partner["rear_priority"] = True
    survive_atk_percent = params.get("survive_atk_percent")
    if survive_atk_percent:
        partner["rear_survive_atk_percent"] = survive_atk_percent
    events.append({
        "time": 0, "event_type": "trait_resolve", "side": side, "actor": caster["name"],
        "effect_type": "dynamic_grant_rear_priority",
        "detail": {"partner": partner["name"]},
    })


def _trait_death_heal_ally(caster, team, enemy_team, params, events, side):
    # 이영웅(히포크라테스 선서): 지금은 그냥 "장전"만 해둔다 - 실제 발동(회복)은 자신이 죽는 순간
    # _apply_death_triggers가 매 틱 감지해서 처리한다. 전투 시작 시점엔 아직 아무 일도 안 일어났으므로
    # 여기선 이벤트를 남기지 않는다.
    caster["death_heal_percent"] = params["percent"]


def _trait_conditional_stun_dr_ally_type(caster, team, enemy_team, params, events, side):
    # 방임석(방임): 지금은 설정만 해둔다 - 실제 판정(지속 기절 + 받는 피해 감소)은 조건(학생 타입 아군의
    # 생존 여부)이 전투 중 바뀔 수 있어서 매 틱 _apply_neglect_status가 다시 확인한다. 김어진(교권 보호)과
    # 동일하게 공격/방어 타입 둘 중 하나만 일치해도 "그 타입을 보유"한 것으로 취급한다.
    caster["neglect_config"] = {
        "ally_type": params["ally_type"],
        "dr_percent": params["dr_percent"],
        "paint_interval_seconds": params.get("paint_interval_seconds"),
    }


TRAIT_EFFECT_HANDLERS = {
    "ally_synergy_remove_absorb": _trait_ally_synergy_remove_absorb,
    "ally_synergy_atk_buff": _trait_ally_synergy_atk_buff,
    "ally_job_conditional_team_buff": _trait_ally_job_conditional_team_buff,
    "ally_type_conditional_team_buff": _trait_ally_type_conditional_team_buff,
    "team_teacher_hp_buff": _trait_team_teacher_hp_buff,
    "teammate_hp_buff_self_cost": _trait_teammate_hp_buff_self_cost,
    "battlefield_presence_haste": _trait_battlefield_presence_haste,
    "female_count_haste": _trait_female_count_haste,
    "dynamic_grant_rear_priority": _trait_dynamic_grant_rear_priority,
    "death_heal_ally": _trait_death_heal_ally,
    "conditional_stun_dr_ally_type": _trait_conditional_stun_dr_ally_type,
}


def _apply_battle_start_traits(team, enemy_team, events, side):
    for slot in ("front", "back"):
        unit = team[slot]
        if not unit or unit["hp"] <= 0 or not unit.get("trait_effect_type"):
            continue
        handler = TRAIT_EFFECT_HANDLERS.get(unit["trait_effect_type"])
        if handler:
            handler(unit, team, enemy_team, unit["trait_params"], events, side)


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
        if _effective_gender(ally) != gender:
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


def _star_self_crit_multiplier(unit, own_team, enemy_team, params):
    # 이의진: 치명타 발동 시 피해 배수를 전역 기본값(CRIT_MULTIPLIER) 대신 이 값으로 대체한다
    # (_roll_damage_atk가 unit.get("crit_multiplier", CRIT_MULTIPLIER)로 조회). chance_multiplier가 있으면
    # (6성 "+" 티어) 치명타 확률도 전역 기본값(CRIT_CHANCE)의 그 배수로 대체한다. atk/hp 변화는 아니지만
    # 프론트에 상태 아이콘을 띄우기 위해 5번째(crit_sign)/6번째(crit_chance_sign) 원소로 신호를 얹어 돌려준다.
    unit["crit_multiplier"] = params["multiplier"]
    chance_multiplier = params.get("chance_multiplier")
    crit_chance_sign = 0
    if chance_multiplier:
        unit["crit_chance"] = CRIT_CHANCE * chance_multiplier
        crit_chance_sign = 1
    return [("own", unit, 0, 0, 1, crit_chance_sign)]


def _star_self_rear_priority(unit, own_team, enemy_team, params):
    # 최재혁: 후방 적 우선 공격 자체는 _select_basic_attack_target이 unit["rear_priority"] 플래그로
    # 판정한다(과거엔 이름 하드코딩이었으나 "마법사 아카데미" 특성이 아군에게도 이 플래그를 동적으로
    # 줄 수 있어야 해서 플래그 기반으로 일반화함). survive_atk_percent가 있으면(6성 "+" 티어) 후방 적이
    # 그 공격에서 죽지 않고 생존했을 때 공격력을 영구히 올려주는 조건부 보너스도 함께 켠다
    # (_do_basic_attack에서 실제 판정). atk/hp/치명타 변화는 아니고 상태 아이콘 전용 신호라 7번째
    # 원소(rear_sign)로 얹어 돌려준다.
    unit["rear_priority"] = True
    survive_atk_percent = params.get("survive_atk_percent")
    if survive_atk_percent:
        unit["rear_survive_atk_percent"] = survive_atk_percent
    return [("own", unit, 0, 0, 0, 0, 1)]


def _star_gain_paint_on_active_use(unit, own_team, enemy_team, params):
    # 방임석(예술가의 혼): 다른 캐릭터들의 [Active] 스킬 사용 이 "장전"만 해둔다 - 실제 발동(물감 획득)은
    # 전장 어딘가에서 [Active]가 실제로 발동될 때마다 _apply_paint_gain이 매번 감지해서 처리한다
    # (death_heal_ally/_apply_death_triggers와 같은 "설정 후 매 틱 감지" 패턴).
    unit["paint_gain_amount"] = params["amount_per_use"]
    return []


STAR_EFFECT_HANDLERS = {
    "gain_paint_on_active_use": _star_gain_paint_on_active_use,
    "self_stat_percent": _star_self_stat_percent,
    "self_buff_enemy_debuff": _star_self_buff_enemy_debuff,
    "ally_team_stat_percent": _star_ally_team_stat_percent,
    "debuff_all_others_atk": _star_debuff_all_others_atk,
    "teammate_stat_percent": _star_teammate_stat_percent,
    "ally_gender_stat_percent": _star_ally_gender_stat_percent,
    "damage_to_gender_bonus": _star_damage_to_gender_bonus,
    "self_crit_multiplier": _star_self_crit_multiplier,
    "self_rear_priority": _star_self_rear_priority,
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
            # 튜플은 보통 (rel, target, atk_sign, hp_sign) 4개지만, 스탯이 아니라 다른 신호를 알려야 하는
            # 핸들러는 5번째(crit_sign)/6번째(crit_chance_sign)/7번째(rear_sign)를 더 얹어 돌려준다 -
            # 나머지 핸들러는 그대로 4-튜플이라 이 신호들은 기본 0으로 취급된다.
            change_dicts = []
            for change in changes:
                rel, target, atk_sign, hp_sign, *extra = change
                extra = list(extra) + [0, 0, 0]
                crit_sign, crit_chance_sign, rear_sign = extra[0], extra[1], extra[2]
                if not (atk_sign or hp_sign or crit_sign or crit_chance_sign or rear_sign):
                    continue
                change_dicts.append({
                    "target": target["name"],
                    "target_side": side_name if rel == "own" else enemy_side,
                    "atk": atk_sign,
                    "hp": hp_sign,
                    "crit": crit_sign,
                    "crit_chance": crit_chance_sign,
                    "rear_priority": rear_sign,
                })
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
    # 복제체는 기존 전방/후방 인원을 대체하지 않고, 시전자 본인 전용 자리에 추가로 나타난다 - 시전자가
    # front면 summon_front, back이면 summon_back(own_team["front"] is caster로 판정). 같은 팀에
    # summon_clone을 쓰는 캐릭터가 둘이어도 서로 다른 자리를 쓰므로 서로의 복제체를 밀어내지 않는다.
    # 단, 같은 캐릭터가 재시전(재소환)하면 자기 자리에 있던 이전 복제체만 교체한다 - 항상 캐릭터당 최대 1마리.
    #
    # 시전자가 이미 죽어있으면(last_survivor_ids 유예로 "죽는 바로 그 틱"에도 행동은 그대로 진행되는
    # 경우 - simulate_battle 참고) 소환을 무효로 한다 - 안 그러면 팀의 마지막 생존자가 죽는 순간
    # 새 복제체가 나타나서 그 팀이 실제로는 전멸했는데도 계속 "생존 중"으로 판정되어, 상대 팀도 같은
    # 틱에 전멸했을 때 성립해야 할 진짜 동시 전멸(무승부)이 막혀버린다.
    if caster["hp"] <= 0:
        return {"summoned": False}
    caster_slot = "front" if own_team.get("front") is caster else "back"
    target_key = f"summon_{caster_slot}"
    replaced = own_team.get(target_key)

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
        # 복제체는 시전자가 원래 서 있던 바로 그 자리에 나타난다(caster의 "지금" 위치를 그대로 물려받음 -
        # 아래에서 caster 본인의 position을 바꾸기 전에 미리 읽어두는 것). melee_speed도 caster가 이미
        # 자기 슬롯에 맞게 캘리브레이션된 값을 그대로 복사한다(원거리면 None).
        "melee_speed": caster.get("melee_speed"),
        "position": caster["position"],
        "is_attacker_team": caster["is_attacker_team"],
    }
    own_team[target_key] = clone

    # 넉백을 "당하는" 건 복제체가 아니라 caster 자신이다 - 복제체가 자기 자리를 차지한 만큼, caster
    # 본인이 자기 진영 뒤쪽으로 한 칸(KNOCKBACK_POSITION_DISTANCE) 물러난다(프론트엔드의 applyKnockback도
    # caster 본인을 밀어낸다 - arena-battle.js 참고). 이걸 안 해주면 caster의 position이 복제체와 완전히
    # 같은 채로 남아, 노출도 기반 타겟팅에서 caster가 실제로는 전혀 물러나지 않은 것으로 계산된다.
    if caster["is_attacker_team"]:
        caster["position"] = max(AXIS_ATTACKER_BACK, caster["position"] - KNOCKBACK_POSITION_DISTANCE)
    else:
        caster["position"] = min(AXIS_DEFENDER_BACK, caster["position"] + KNOCKBACK_POSITION_DISTANCE)

    return {
        "summoned": True, "clone_name": clone["name"], "clone_hp": clone_max_hp, "clone_atk": clone_atk,
        "clone_slot": target_key.replace("_", "-"), "replaced": replaced["name"] if replaced else None,
    }


def _skill_conditional_target_debuff(caster, own_team, enemy_team, params, time_elapsed):
    target = _alive_target(enemy_team)
    if target is None:
        return {"hit": False}

    # 공격 속도 증가는 대상 성별과 무관하게 시전할 때마다 항상 자기 자신에게 적용된다(자기 대상이라
    # 소스가 항상 자기 자신 하나뿐이라 재시전은 자연히 이 하나의 슬롯만 갱신됨). 전투 시작 특성으로
    # 이미 영구(haste_percent) 공격 속도 증가를 받은 캐릭터가 이 스킬도 쓰면, 임시 슬롯이 별도로
    # 더해질 뿐 영구 값을 덮어쓰지 않는다(_effective_interval이 영구+임시 활성 소스를 전부 합산).
    caster["status"]["temp_haste_mods"][id(caster)] = {
        "percent": params["haste_percent"],
        "until": time_elapsed + params["haste_seconds"],
    }

    condition_met = params["condition"] != "target_gender_female" or _effective_gender(target) == "여"
    interrupted_cast = False
    if condition_met:
        interrupted_cast = _apply_stun(target, time_elapsed + params["stun_seconds"], time_elapsed)

    return {
        "hit": True, "target": target["name"], "_target_ref": target, "stunned": condition_met,
        "stun_seconds": params["stun_seconds"] if condition_met else 0,
        "interrupted_cast": interrupted_cast,  # 프론트에 "시전 취소" 연출을 보여주기 위한 신호
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
    return {"healed": True, "target": ally["name"], "_target_ref": ally, "amount": ally["hp"] - before}


def _skill_self_shield_duration(caster, own_team, enemy_team, params, time_elapsed):
    new_shield_until = time_elapsed + params["seconds"]
    _refresh_status_until(caster["status"], "shield_until", new_shield_until, time_elapsed)
    return {"shield_seconds": params["seconds"]}


def _skill_self_type_swap_heal(caster, own_team, enemy_team, params, time_elapsed):
    # 이의진 "염색체 변환": attack_type을 Student(type1)<->Parent(type2) 사이로 토글하고 자힐.
    # type2(Parent) 상태가 되면 이후 기본공격이 남성 적을 기절시키는 플래그(type2_stun_seconds)를 켜고,
    # type1(Student)로 돌아오면 그 플래그를 끈다 - 실제 스턴 적용은 _do_basic_attack에서 처리.
    new_type = "Parent" if caster["attack_type"] == "Student" else "Student"
    caster["attack_type"] = new_type
    heal = round(caster["max_hp"] * params["heal_percent"] / 100)
    before = caster["hp"]
    caster["hp"] = min(caster["max_hp"], caster["hp"] + heal)
    caster["type2_stun_seconds"] = params["type2_stun_seconds"] if new_type == "Parent" else 0
    # type2(Parent)가 되면 다른 캐릭터의 성별 조건부 효과(예: 김남옥의 "대상이 여성이면 기절") 판정에서도
    # 여성으로 취급된다 - _effective_gender가 gender_override를 CHARACTER_GENDER보다 우선해서 읽는다.
    caster["gender_override"] = "여" if new_type == "Parent" else None
    return {
        "new_attack_type": new_type,
        "type2_active": new_type == "Parent",
        "healed_amount": caster["hp"] - before,
    }


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
    # 넉백도 CC기라 대상이 시전 중이었다면 취소한다 - CC 중 최우선순위(CC_PRIORITY_KNOCKBACK)라
    # "이번 틱 발동 예정" 보호(_interrupt_cast_if_casting 참고)를 뚫고 스턴/그 외 스킬은 확실히 끊되,
    # 넉백끼리 정확히 같은 틱에 맞부딪히면(동급) 서로 못 끊고 둘 다 정상 발동한다.
    interrupted_cast = _interrupt_cast_if_casting(target, time_elapsed, CC_PRIORITY_KNOCKBACK)

    # 넉백은 대상을 실제로 자기 진영 뒤쪽(공유 좌표축 기준)으로 KNOCKBACK_POSITION_DISTANCE만큼 밀어낸다
    # - 자기 팀 홈 back 좌표를 넘어서까지는 안 밀린다(클램프). 근접/원거리 구분 없이 적용한다(원거리도
    # 전방 슬롯이면 넉백으로 노출도가 줄 수 있어야 일관적이다). 전방이 밀려나 후방보다 덜 노출된 상태가
    # 되면, _alive_units의 노출도 정렬이 다음 순간부터 바로 그걸 반영해서 우리 팀의 다음 타겟 선정이
    # 자동으로 최신 위치를 따라간다(전/후방이 뒤바뀌면 타겟도 같이 바뀜).
    # own_team 근접 유닛 전원을 수동으로 지연시키던 예전 로직은 제거했다 - 대상이 실제로 더 멀어졌으니,
    # 그 대상을 쫓아가던 근접 유닛은 위치 기반 도착 게이트가 늘어난 거리만큼 자연히 더 오래 걸리게
    # 만든다(가짜 지연을 얹지 않아도 정확하고, 이 대상과 무관한 다른 아군까지 덩달아 지연되지 않는다).
    if target["is_attacker_team"]:
        target["position"] = max(AXIS_ATTACKER_BACK, target["position"] - KNOCKBACK_POSITION_DISTANCE)
    else:
        target["position"] = min(AXIS_DEFENDER_BACK, target["position"] + KNOCKBACK_POSITION_DISTANCE)

    return {
        "hits": [{"target": target["name"], "_target_ref": target, "damage": dealt, "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult}],
        "interrupted_cast": interrupted_cast,
    }


def _skill_aoe_gendered_damage(caster, own_team, enemy_team, params, time_elapsed):
    hits = []
    for t in _alive_units(enemy_team):
        gender = _effective_gender(t) or "남"
        mult = params["female_multiplier"] if gender == "여" else params["male_multiplier"]
        type_mult = get_type_multiplier(caster["attack_type"], t["defense_type"])
        atk, is_crit = _roll_damage_atk(caster, time_elapsed)
        damage = atk * mult / 100 * type_mult
        damage = _apply_gendered_damage_bonus(caster, t, damage)
        dealt = _apply_damage(t, damage, time_elapsed)
        hits.append({"target": t["name"], "_target_ref": t, "damage": dealt, "target_hp_after": t["hp"], "target_max_hp": t["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult})
    return {"hits": hits}


def _skill_copy_target_skill(caster, own_team, enemy_team, params, time_elapsed):
    target = _alive_target(enemy_team)
    # 상대도 강승유(또는 미래의 다른 copy_target_skill 캐릭터)라서 대상의 스킬이 "복제" 그 자체면
    # 복제하지 않는다 - 그대로 두면 이 핸들러가 자기 자신을 상태 변화 없이 계속 호출해서(own_team/
    # enemy_team/target이 안 바뀐 채 재귀) RecursionError로 죽는다. 복제를 복제하는 것도 설정상 이상하니
    # 그냥 "복제할 스킬이 없는" 경우와 같이 취급해 기본 피해로 대체한다.
    if (
        target
        and target.get("skill_effect_type")
        and target.get("skill_effect_type") != "copy_target_skill"
        and not target.get("is_clone")
    ):
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
    return {"hits": [{"target": target["name"], "_target_ref": target, "damage": dealt, "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult}]}


def _skill_stun_target(caster, own_team, enemy_team, params, time_elapsed):
    target = _alive_target(enemy_team)
    if target is None:
        return {"hit": False}
    interrupted_cast = _apply_stun(target, time_elapsed + params["seconds"], time_elapsed)
    result = {
        "hit": True, "target": target["name"], "_target_ref": target, "stun_seconds": params["seconds"],
        "interrupted_cast": interrupted_cast,
    }
    # multiplier가 있으면(송주헌 "격차 벌리기") 기절과 함께 피해도 준다 - 없으면 예전처럼 순수 기절만.
    multiplier = params.get("multiplier")
    if multiplier:
        type_mult = get_type_multiplier(caster["attack_type"], target["defense_type"])
        atk, is_crit = _roll_damage_atk(caster, time_elapsed)
        damage = atk * multiplier / 100 * type_mult
        damage = _apply_gendered_damage_bonus(caster, target, damage)
        dealt = _apply_damage(target, damage, time_elapsed)
        result["hits"] = [{
            "target": target["name"], "_target_ref": target, "damage": dealt,
            "target_hp_after": target["hp"], "target_max_hp": target["max_hp"],
            "is_crit": is_crit, "type_multiplier": type_mult,
        }]
    return result


def _skill_aoe_enemy_damage(caster, own_team, enemy_team, params, time_elapsed):
    hits = []
    for t in _alive_units(enemy_team):
        type_mult = get_type_multiplier(caster["attack_type"], t["defense_type"])
        atk, is_crit = _roll_damage_atk(caster, time_elapsed)
        damage = atk * params["multiplier"] / 100 * type_mult
        damage = _apply_gendered_damage_bonus(caster, t, damage)
        dealt = _apply_damage(t, damage, time_elapsed)
        hits.append({"target": t["name"], "_target_ref": t, "damage": dealt, "target_hp_after": t["hp"], "target_max_hp": t["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult})
    return {"hits": hits}


def _skill_damage_hp_percent_plus_atk(caster, own_team, enemy_team, params, time_elapsed):
    target = _alive_target(enemy_team)
    if target is None:
        return {"hit": False}
    type_mult = get_type_multiplier(caster["attack_type"], target["defense_type"])
    atk, is_crit = _roll_damage_atk(caster, time_elapsed)
    damage = (target["hp"] * params["hp_percent"] / 100 + atk * params["atk_percent"] / 100) * type_mult
    damage = _apply_gendered_damage_bonus(caster, target, damage)
    dealt = _apply_damage(target, damage, time_elapsed)
    return {"hits": [{"target": target["name"], "_target_ref": target, "damage": dealt, "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult}]}


def _skill_debuff_atk_and_damage(caster, own_team, enemy_team, params, time_elapsed):
    target = _alive_target(enemy_team)
    if target is None:
        return {"hit": False}
    # 이 시전자(캐스터 인스턴스) 전용 슬롯에 독립적으로 기록한다 - 같은 캐스터가 다시 걸면 이 슬롯만
    # 새 값으로 갱신(교체)되고, 다른 캐스터(예: 미러전의 상대 팀 임소정, 또는 강승유가 복제한 경우)가
    # 걸면 별도 슬롯이라 서로 상쇄되지 않고 대상이 살아있는 동안 각자 자기 시각까지 독립적으로
    # 적용된다(_effective_atk가 활성 상태인 슬롯을 전부 합산).
    target["status"]["temp_atk_mods"][id(caster)] = {
        "percent": -params["atk_debuff_percent"],
        "until": time_elapsed + params["debuff_seconds"],
    }
    type_mult = get_type_multiplier(caster["attack_type"], target["defense_type"])
    atk, is_crit = _roll_damage_atk(caster, time_elapsed)
    damage = atk * params["multiplier"] / 100 * type_mult
    damage = _apply_gendered_damage_bonus(caster, target, damage)
    dealt = _apply_damage(target, damage, time_elapsed)
    return {
        "hits": [{"target": target["name"], "_target_ref": target, "damage": dealt, "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult}],
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
        hits.append({"target": u["name"], "_target_ref": u, "damage": dealt, "target_hp_after": u["hp"], "target_max_hp": u["max_hp"], "is_crit": is_crit, "type_multiplier": 1.0})
    for u in _alive_units(enemy_team):
        type_mult = get_type_multiplier(caster["attack_type"], u["defense_type"])
        atk, is_crit = _roll_damage_atk(caster, time_elapsed)
        damage = atk * params["multiplier"] / 100 * type_mult
        damage = _apply_gendered_damage_bonus(caster, u, damage)
        dealt = _apply_damage(u, damage, time_elapsed)
        hits.append({"target": u["name"], "_target_ref": u, "damage": dealt, "target_hp_after": u["hp"], "target_max_hp": u["max_hp"], "is_crit": is_crit, "type_multiplier": type_mult})
    return {"hits": hits}


def _skill_consume_paint_multi_effect(caster, own_team, enemy_team, params, time_elapsed):
    # 방임석 "제목은 관객이 정하세요": 보유한 물감(빨강/파랑/노랑)을 색깔별로 전부 소모해서 한 번에
    # 발동한다. "1개당" 수치는 색깔별로 각각 따로 발동하는 게 아니라(개별 히트 N번) 개수만큼 배수로
    # 늘려서 색깔당 딱 한 번만 적용한다(윤대웅의 자가 스택 버프와 같은 "총량 스케일링" 방식) - 그래야
    # 크리티컬/기절 판정도 색깔당 1번으로 끝난다. 세 색을 동시에 보유했으면 세 효과 모두 함께 발동한다.
    status = caster["status"]
    red = status.get("paint_red", 0)
    blue = status.get("paint_blue", 0)
    yellow = status.get("paint_yellow", 0)
    status["paint_red"] = 0
    status["paint_blue"] = 0
    status["paint_yellow"] = 0

    detail = {"red": red, "blue": blue, "yellow": yellow}

    if not (red or blue or yellow):
        # 물감이 하나도 없으면 대신 강한 단일 피해
        target = _alive_target(enemy_team)
        if target is None:
            return {"hit": False}
        type_mult = get_type_multiplier(caster["attack_type"], target["defense_type"])
        atk, is_crit = _roll_damage_atk(caster, time_elapsed)
        damage = atk * params["no_paint_multiplier"] / 100 * type_mult
        damage = _apply_gendered_damage_bonus(caster, target, damage)
        dealt = _apply_damage(target, damage, time_elapsed)
        detail["hits"] = [{
            "target": target["name"], "_target_ref": target, "damage": dealt,
            "target_hp_after": target["hp"], "target_max_hp": target["max_hp"],
            "is_crit": is_crit, "type_multiplier": type_mult,
        }]
        return detail

    if red:
        target = _alive_target(enemy_team)
        if target is not None:
            type_mult = get_type_multiplier(caster["attack_type"], target["defense_type"])
            atk, is_crit = _roll_damage_atk(caster, time_elapsed)
            damage = atk * (params["red_percent_per_paint"] * red) / 100 * type_mult
            damage = _apply_gendered_damage_bonus(caster, target, damage)
            dealt = _apply_damage(target, damage, time_elapsed)
            detail["hits"] = [{
                "target": target["name"], "_target_ref": target, "damage": dealt,
                "target_hp_after": target["hp"], "target_max_hp": target["max_hp"],
                "is_crit": is_crit, "type_multiplier": type_mult,
            }]

    if blue:
        # 체력이 가장 낮은 아군(자신 포함) - "자신을 제외한"이라는 조건이 없으므로 자신도 대상이 될 수 있다.
        lowest = min(_alive_units(own_team), key=lambda u: u["hp"], default=None)
        if lowest is not None:
            heal_amount = round(lowest["max_hp"] * (params["blue_percent_per_paint"] * blue) / 100)
            before = lowest["hp"]
            lowest["hp"] = min(lowest["max_hp"], lowest["hp"] + heal_amount)
            # 아군 대상 회복이라 항상 시전자와 같은 편 - 이영웅의 death_heal_ally와 동일하게 _target_ref 없이
            # target_side를 프론트가 event.side로 바로 판정하게 둔다.
            detail["heals"] = [{
                "target": lowest["name"], "amount": lowest["hp"] - before,
                "target_hp_after": lowest["hp"], "target_max_hp": lowest["max_hp"],
            }]

    if yellow:
        stun_seconds = params["yellow_seconds_per_paint"] * yellow
        stunned = []
        for enemy in _alive_units(enemy_team):
            interrupted = _apply_stun(enemy, time_elapsed + stun_seconds, time_elapsed)
            stunned.append({"target": enemy["name"], "_target_ref": enemy, "interrupted_cast": interrupted})
        detail["stunned"] = stunned
        detail["stun_seconds"] = stun_seconds

    return detail


SKILL_EFFECT_HANDLERS = {
    "self_stack_buff": _skill_self_stack_buff,
    "summon_clone": _skill_summon_clone,
    "conditional_target_debuff": _skill_conditional_target_debuff,
    "heal_ally_percent_max_hp": _skill_heal_ally_percent_max_hp,
    "self_shield_duration": _skill_self_shield_duration,
    "self_type_swap_heal": _skill_self_type_swap_heal,
    "bonus_damage_knockback": _skill_bonus_damage_knockback,
    "aoe_gendered_damage": _skill_aoe_gendered_damage,
    "copy_target_skill": _skill_copy_target_skill,
    "stun_target": _skill_stun_target,
    "aoe_enemy_damage": _skill_aoe_enemy_damage,
    "damage_hp_percent_plus_atk": _skill_damage_hp_percent_plus_atk,
    "debuff_atk_and_damage": _skill_debuff_atk_and_damage,
    "aoe_all_others_damage": _skill_aoe_all_others_damage,
    "consume_paint_multi_effect": _skill_consume_paint_multi_effect,
}


def _apply_type2_stun_if_active(unit, target, time_elapsed):
    """이의진 type2(Parent) 상태의 기본공격 부가효과: type2_stun_seconds가 켜져 있고(self_type_swap_heal
    스킬로 세팅됨) 대상이 남성이면 기절시킨다. 다른 캐릭터는 이 필드가 없어 항상 조용히 통과한다.
    반환값은 (실제로 적용된 기절 시간(초, 0이면 미적용), 그 기절로 시전이 끊겼는지 여부) 튜플 - 프론트가
    상태 아이콘 지속시간/시전 취소 연출을 정확히 맞출 수 있도록 이벤트에 그대로 실려 나간다(_do_basic_attack)."""
    stun_seconds = unit.get("type2_stun_seconds")
    if stun_seconds and _effective_gender(target) == "남":
        interrupted_cast = _apply_stun(target, time_elapsed + stun_seconds, time_elapsed)
        return stun_seconds, interrupted_cast
    return 0, False


def _do_basic_attack(unit, side, own_team, enemy_team, time_elapsed, events, resolved_target=None):
    """기본공격 처리. 김남옥만 예외적으로(★4부터, star_effects 문구 기준) 적 2인 모두를 타격한다
    (주 대상 100%, 나머지 25%) - 기존 star_effects 문구("주 대상 100%, 다른 적 25%")와 확정된 공격
    연출(다트가 적 2인에게 명중)이 일치해서 이 캐릭터만 기본공격 자체가 다중 타격으로 구현돼 있다.

    resolved_target: 메인 루프가 _resolve_basic_attack_target(뜸들이기 포함)으로 미리 계산해둔 대상.
    넘겨받으면(일반적인 실제 호출 경로) 그대로 쓰고, 안 넘어오면(과거 호출 방식과의 호환) 여기서
    직접 _select_basic_attack_target을 불러 즉시 확정한다 - 김남옥의 다중 타격은 뜸들이기 대상이
    아니라서(order만 매 순간 그대로 반영) resolved_target을 안 쓰고 항상 새로 계산한다."""
    targets = _alive_units(enemy_team)
    if not targets:
        return
    if unit["name"] == "김남옥" and unit.get("star", 1) >= 3:
        for i, target in enumerate(targets):
            mult = 1.0 if i == 0 else 0.25
            type_mult = get_type_multiplier(unit["attack_type"], target["defense_type"])
            atk, is_crit = _roll_damage_atk(unit, time_elapsed)
            damage = atk * mult * type_mult
            damage = _apply_gendered_damage_bonus(unit, target, damage)
            dealt = _apply_damage(target, damage, time_elapsed)
            stun_seconds, interrupted_cast = _apply_type2_stun_if_active(unit, target, time_elapsed)
            events.append({
                "time": time_elapsed, "event_type": "basic_attack", "side": side, "type_multiplier": type_mult,
                "actor": unit["name"], "target": target["name"], "damage": dealt,
                "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit,
                "target_stunned": bool(stun_seconds), "stun_seconds": stun_seconds,
                "interrupted_cast": interrupted_cast,
            })
    else:
        target = resolved_target if resolved_target is not None else _select_basic_attack_target(unit, enemy_team)
        if target is None:
            return
        type_mult = get_type_multiplier(unit["attack_type"], target["defense_type"])
        atk, is_crit = _roll_damage_atk(unit, time_elapsed)
        damage = atk * type_mult
        damage = _apply_gendered_damage_bonus(unit, target, damage)
        dealt = _apply_damage(target, damage, time_elapsed)
        stun_seconds, interrupted_cast = _apply_type2_stun_if_active(unit, target, time_elapsed)
        # 최재혁 6성 "+": 후방 우선 타겟(target)이 이 공격에서 죽지 않고 생존하면, 그 시점부터 전투가
        # 끝날 때까지 영구히 공격력이 오른다 - 한 번만 트리거되도록 플래그로 막는다(재적용/누적 방지).
        rear_bonus = unit.get("rear_survive_atk_percent")
        if rear_bonus and target["hp"] > 0 and not unit.get("_rear_survive_bonus_granted"):
            unit["_rear_survive_bonus_granted"] = True
            unit["status"]["atk_percent_bonus"] += rear_bonus
        events.append({
            "time": time_elapsed, "event_type": "basic_attack", "side": side, "type_multiplier": type_mult,
            "actor": unit["name"], "target": target["name"], "damage": dealt,
            "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit,
            "target_stunned": bool(stun_seconds), "stun_seconds": stun_seconds,
            "interrupted_cast": interrupted_cast,
        })


def _apply_death_triggers(team, side, events, time_elapsed):
    """이영웅(히포크라테스 선서): 사망 시 1회 아군 전체를 회복시키는 것처럼, "죽는 순간" 발동하는
    효과 전용 훅. 매 틱마다 각 팀을 훑어서 "죽었는데 아직 트리거 안 한" 유닛을 찾아 1회만 발동한다 -
    사망은 여러 곳(기본공격/각종 스킬)에서 일어날 수 있어 그 모든 지점에 훅을 심는 대신, 여기 한
    곳에서 "죽어 있음" 상태만 감지한다(최대 1틱=0.05초 지연이지만 체감상 차이 없음)."""
    for slot in ("front", "back", "summon_front", "summon_back"):
        unit = team[slot]
        if not unit or unit["hp"] > 0 or not unit.get("death_heal_percent") or unit.get("_death_triggered"):
            continue
        unit["_death_triggered"] = True
        heal_base = unit["max_hp"]
        heal_percent = unit["death_heal_percent"]
        heals = []
        for ally in _alive_units(team):
            heal = round(heal_base * heal_percent / 100)
            before = ally["hp"]
            ally["hp"] = min(ally["max_hp"], ally["hp"] + heal)
            if ally["hp"] != before:
                heals.append({
                    "target": ally["name"], "amount": ally["hp"] - before,
                    "target_hp_after": ally["hp"], "target_max_hp": ally["max_hp"],
                })
        if heals:
            events.append({
                "time": time_elapsed, "event_type": "death_trigger_resolve", "side": side,
                "actor": unit["name"], "effect_type": "death_heal_ally",
                "detail": {"heals": heals},
            })


def _apply_neglect_status(team, side, events, time_elapsed):
    """방임석(방임): "학생 타입 아군이 존재하는 동안" 자신은 영구 기절 + 받는 피해 대폭 감소. death_heal_ally와
    달리 조건이 한 번 성립하고 끝이 아니라(그 아군이 죽으면 조건이 풀려서 다시 정상적으로 움직여야 함)
    매 틱 다시 판정해야 하는 유일한 특성이라 별도 훅으로 둔다. neglect_active 변화(꺼짐<->켜짐) 시점에만
    이벤트를 남겨서 프론트가 상태 아이콘을 그때만 갱신하면 되게 한다."""
    for unit in _alive_units(team):
        config = unit.get("neglect_config")
        if not config:
            continue
        ally_type = config["ally_type"]
        # 김어진(team_teacher_hp_buff)과 동일한 규칙 - 공격/방어 타입 중 하나만 일치해도 그 타입을 "보유"한
        # 것으로 취급한다.
        has_qualifying_ally = any(
            other is not unit and (other.get("attack_type") == ally_type or other.get("defense_type") == ally_type)
            for other in _alive_units(team)
        )
        was_active = unit.get("neglect_active", False)
        unit["neglect_active"] = has_qualifying_ally

        if has_qualifying_ally and not was_active:
            unit["_neglect_last_paint_time"] = time_elapsed
            interrupted = _interrupt_cast_if_casting(unit, time_elapsed)
            events.append({
                "time": time_elapsed, "event_type": "neglect_status_resolve", "side": side,
                "actor": unit["name"], "detail": {"active": True, "interrupted_cast": interrupted},
            })
        elif not has_qualifying_ally and was_active:
            events.append({
                "time": time_elapsed, "event_type": "neglect_status_resolve", "side": side,
                "actor": unit["name"], "detail": {"active": False},
            })

        # 6성+ 전용: 방임 상태인 동안 일정 주기마다 무작위 색 물감 1개를 추가로 획득한다.
        interval = config.get("paint_interval_seconds")
        if has_qualifying_ally and interval:
            last = unit.get("_neglect_last_paint_time", time_elapsed)
            if time_elapsed - last >= interval:
                unit["_neglect_last_paint_time"] = time_elapsed
                color = random.choice(("red", "blue", "yellow"))
                paint_key = f"paint_{color}"
                unit["status"][paint_key] += 1
                events.append({
                    "time": time_elapsed, "event_type": "paint_gain_resolve", "side": side,
                    "actor": unit["name"],
                    "detail": {"color": color, "amount": 1, "total": unit["status"][paint_key], "source_actor": unit["name"]},
                })


def _apply_paint_gain(caster, effect_type, attacker_team, defender_team, side_name, events, time_elapsed):
    """방임석(예술가의 혼): 자신을 제외한 전장의 누군가(아군이든 적이든)가 [Active]를 발동할 때마다,
    그 스킬이 가진 효과 종류 전부(SKILL_TYPE_CATEGORY - 하나의 스킬이 여러 효과를 가지면 그만큼 색깔도
    여러 개)에 대해 각각 물감을 받는다. 다른 편 유닛의 행동에도 반응하는 이 게임 유일의 "관찰자형"
    패시브라 전용 훅으로 뺐다(death_heal_ally처럼 캐스터 자신에게만 적용되는 훅들과 달리 양 팀을 모두
    훑어야 한다). 시전이 중간에 CC로 취소되면 애초에 skill_resolve 자체가 발생하지 않으므로(main
    loop에서 완료된 캐스팅에 대해서만 호출) 취소된 시전에서는 물감이 전혀 쌓이지 않는다."""
    categories = SKILL_TYPE_CATEGORY.get(effect_type)
    if not categories:
        return
    for team, team_side in ((attacker_team, "attacker"), (defender_team, "defender")):
        for unit in _alive_units(team):
            if unit is caster or not unit.get("paint_gain_amount"):
                continue
            amount = unit["paint_gain_amount"]
            for category in categories:
                paint_key = f"paint_{category}"
                unit["status"][paint_key] += amount
                events.append({
                    "time": time_elapsed, "event_type": "paint_gain_resolve", "side": team_side,
                    "actor": unit["name"],
                    "detail": {
                        "color": category, "amount": amount, "total": unit["status"][paint_key],
                        "source_actor": caster["name"], "source_side": side_name,
                    },
                })


def _home_position(is_attacker, slot):
    if is_attacker:
        return AXIS_ATTACKER_FRONT if slot == "front" else AXIS_ATTACKER_BACK
    return AXIS_DEFENDER_FRONT if slot == "front" else AXIS_DEFENDER_BACK


def _init_unit_positions(team, is_attacker):
    """전투 시작 시점에 홈 좌표를 부여한다 - front/back만 대상이고(복제체는 아직 없음, 소환될 때
    _skill_summon_clone에서 caster 기준으로 채워짐), 원거리 유닛도 이 좌표를 갖되 이후 아무도
    갱신하지 않으므로 사실상 고정값이 된다."""
    for slot in ("front", "back"):
        unit = team.get(slot)
        if not unit:
            continue
        unit["is_attacker_team"] = is_attacker
        unit["position"] = _home_position(is_attacker, slot)


def _advance_melee_position(unit, target_position, tick):
    """근접 유닛의 position을 target_position 쪽으로 최대 melee_speed*tick만큼 옮긴다. 매 틱 현재
    position에서 다시 거리를 계산하므로(누적 오차 없음), 도착 조건을 만족하면 정확히 target_position으로
    스냅한다 - 그래야 부동소수 오차가 여러 틱에 걸쳐 쌓이지 않는다."""
    delta = target_position - unit["position"]
    if abs(delta) <= ARRIVAL_EPSILON:
        unit["position"] = target_position
        return
    step = unit["melee_speed"] * tick
    if abs(delta) <= step:
        unit["position"] = target_position
    else:
        unit["position"] += step if delta > 0 else -step


def simulate_battle(attacker_team: dict, defender_team: dict) -> dict:
    """
    두 팀(전방+후방)을 받아 시간 기반으로 전투를 시뮬레이션한다.
    "전방"/"후방"은 고정 슬롯이 아니라 실제 시뮬레이션된 위치(position) 기준 노출도로 매 순간 다시
    정해진다 - 근접 유닛이 걸어서 자기 팀의 다른 슬롯보다 더 앞서 나가거나(예: 후방 우선 패시브로 적
    후방까지 걸어가는 동안), 넉백으로 누군가 뒤로 밀려나면 실제로 타겟 우선순위가 바뀔 수 있다(자세한
    내용은 _alive_units/_select_basic_attack_target 참고). 김남옥의 기본공격은 예외 - 항상 둘 다 맞음.
    각 유닛은 기본공격 3회마다 자신의 스킬을 시전한다(시전 시간 = 공격 주기 * 2, 시전 중엔 기본공격 안 함).
    반환값의 events는 프론트에서 순서대로 재생하는 데 쓰인다.
    """
    time_elapsed = 0.0
    events = []

    # _apply_battle_start_traits/_apply_battle_start_star_effects가 내부적으로 _alive_units를 쓰므로
    # (노출도 정렬에 position/is_attacker_team이 필요) 반드시 그 호출들보다 먼저 위치를 초기화해야 한다.
    _init_unit_positions(attacker_team, True)
    _init_unit_positions(defender_team, False)

    _apply_battle_start_traits(attacker_team, defender_team, events, "attacker")
    _apply_battle_start_traits(defender_team, attacker_team, events, "defender")
    _apply_battle_start_star_effects(attacker_team, defender_team, events)

    tick_index = 0
    while _team_alive(attacker_team) and _team_alive(defender_team) and time_elapsed < MAX_BATTLE_DURATION:
        time_elapsed = round(time_elapsed + TICK, 2)
        tick_index += 1

        # 각 팀의 "이번 틱 시작 시점 마지막 생존자"를 미리 표시해둔다. 원래는 공격자 팀을 전부 처리한
        # 뒤에야 방어자 팀 차례가 와서, 공격자가 방어자의 마지막 생존자를 죽이면 방어자는 반격할 기회조차
        # 없이 그 즉시 행동이 막혔다(그래서 동시 전멸=무승부가 구조적으로 불가능했다). 이제 "이번 틱을
        # 살아서 시작한 마지막 생존자"만은 같은 틱 안에서 상대보다 먼저 죽더라도(상대 쪽이 처리 순서상
        # 먼저라 이미 죽였더라도) 자신의 행동은 그대로 진행한다 - 그래야 서로가 서로의 마지막 생존자를
        # 같은 틱에 함께 쓰러뜨리는 진짜 동시 전멸이 원칙적으로 가능해진다. 이 유예는 죽는 바로 그 틱
        # 한 번만 적용된다(다음 틱엔 이미 죽어 있어 애초에 이 집합에 안 들어감 - 좀비처럼 계속 행동하는
        # 일은 없다). 팀에 다른 생존자가 남아있는 일반적인 죽음은 기존과 동일하게 그 즉시 행동을 멈춘다.
        #
        # 단, 이 유예는 근접 유닛에게만 준다 - 근접은 서로 칼을 맞대고 있는 셈이라 같은 틱에 동시에
        # 서로를 벨 수 있다는 감각이 자연스럽지만, 원거리는 화살/투사체가 날아가는 데 시간이 걸리므로
        # 이미 맞아 죽은 원거리 유닛이 그 뒤에도 마지막 한 발을 쏘아 상대를 같이 죽이는 건 어색하다.
        # 그래서 원거리 마지막 생존자는 같은 틱에 먼저 맞으면(공격자 팀이 방어자 팀보다 먼저 처리되므로
        # 처리 순서상 먼저 맞은 쪽) 그대로 죽고, 상대는 반격 없이 승리한다.
        last_survivor_ids = set()
        for team in (attacker_team, defender_team):
            alive = [u for u in _all_slots(team) if u and u["hp"] > 0]
            if len(alive) == 1 and alive[0]["is_melee"]:
                last_survivor_ids.add(id(alive[0]))

        _apply_death_triggers(attacker_team, "attacker", events, time_elapsed)
        _apply_death_triggers(defender_team, "defender", events, time_elapsed)
        _apply_neglect_status(attacker_team, "attacker", events, time_elapsed)
        _apply_neglect_status(defender_team, "defender", events, time_elapsed)

        # 두 팀의 next_attack_time이 정확히 같은 틱에 겹치면(대칭 스탯 등), 항상 공격자 팀을 먼저 처리하는
        # 고정 순서 때문에 그런 "동시 타이밍" 상황마다 매번 공격자만 먼저 때리는 구조적 편향이 있었다(예:
        # 3회째 기본공격 직후 스킬 발동 타이밍이 양팀 다 같을 때). 틱 인덱스 홀짝으로 두 팀의 처리 순서를
        # 번갈아 뒤집어서, 여러 틱에 걸쳐 보면 어느 한쪽만 계속 먼저 행동하는 일이 없게 한다.
        team_order = (
            ("attacker", attacker_team, defender_team),
            ("defender", defender_team, attacker_team),
        )
        if tick_index % 2 == 0:
            team_order = tuple(reversed(team_order))

        for side_name, own_team, enemy_team in team_order:
            for slot in ("front", "back", "summon_front", "summon_back"):
                unit = own_team[slot]
                if unit is None:
                    continue
                if unit["hp"] <= 0 and id(unit) not in last_survivor_ids:
                    continue

                status = unit["status"]
                # CC 우선순위(_cc_priority_of_skill)로 "취소되지 않도록 보호"받은 시전은 실제로 그 틱에
                # 발동까지 이어져야 한다 - 안 그러면 취소는 안 됐지만 이 스턴/방임 게이트에 걸려 결국
                # 그 틱엔 아무것도 못 하고 스턴이 풀릴 때까지 미뤄지는, "취소된 것과 다를 바 없는" 상태가
                # 되어버린다(CC 우선순위 설계 의도인 "약한 CC는 상대 스킬을 못 건드린다"가 무력화됨).
                # is_casting이 여전히 True인 채 이미 발동 예정(cast_end_time 도달)이라는 건, 바로 이 틱에
                # 걸린 CC가 _interrupt_cast_if_casting에서 우선순위 부족으로 보호를 통과시켰다는 뜻이므로
                # (그렇지 않았다면 이미 취소되어 is_casting이 False였을 것), 그 발동만은 게이트를 통과시킨다.
                cast_due_now = (
                    unit["is_casting"]
                    and unit["cast_end_time"] is not None
                    and time_elapsed >= unit["cast_end_time"]
                )
                if status["stun_until"] is not None and time_elapsed < status["stun_until"] and not cast_due_now:
                    continue

                if unit.get("neglect_active") and not cast_due_now:
                    continue

                if unit["is_casting"]:
                    if time_elapsed >= unit["cast_end_time"]:
                        handler = SKILL_EFFECT_HANDLERS.get(unit["skill_effect_type"])
                        detail = handler(unit, own_team, enemy_team, unit["skill_params"], time_elapsed) if handler else {}
                        detail = _tag_target_sides(detail, side_name, own_team, enemy_team)
                        events.append({
                            "time": time_elapsed, "event_type": "skill_resolve", "side": side_name,
                            "actor": unit["name"], "effect_type": unit["skill_effect_type"], "detail": detail,
                        })
                        # 방임석(예술가의 혼): 방금 발동한 [Active]를 전장의 다른 관찰자들에게 알린다 -
                        # 강승유가 복제한 스킬이면 실제로 복제된 원본 효과 타입(copied_effect_type)을 기준으로
                        # 분류해야, 방임석이 "강승유가 뭘 복제했는지"까지 정확히 반영해서 물감을 받는다.
                        used_effect_type = detail.get("copied_effect_type") or unit["skill_effect_type"]
                        _apply_paint_gain(unit, used_effect_type, attacker_team, defender_team, side_name, events, time_elapsed)
                        unit["is_casting"] = False
                        unit["cast_end_time"] = None
                        unit["attack_count"] = 0
                        # max로 두는 이유: 청년의 넉백처럼 스킬 핸들러가 캐스터 자신의 next_attack_time을
                        # (own_team 순회 중) 미리 더 늦게 예약해뒀을 수 있어서, 여기서 무조건 덮어쓰면 그
                        # 예약이 사라진다. 그 외 모든 스킬은 캐스팅 시작 이후 next_attack_time을 안 건드려서
                        # 항상 과거 값이므로, max를 써도 기존 동작과 완전히 동일하다.
                        unit["next_attack_time"] = max(unit["next_attack_time"], time_elapsed + _effective_interval(unit, time_elapsed))
                    continue

                # 매 틱 "지금 기본공격 대상으로 확정된 유닛"을 구한다(뜸들이기 포함, _resolve_basic_attack_target
                # 참고) - 근접 유닛은 이 대상 쪽으로 조금씩 걸어간다. 공격 쿨다운(next_attack_time)과
                # 무관하게 이동은 계속 진행되고, 실제 공격은 이동이 끝나 목표와의 거리가 ARRIVAL_EPSILON
                # 이내일 때만 허용된다(도착 게이트). 원거리 유닛은 이동만 안 할 뿐 대상 확정 자체는 동일하게
                # 뜸들이기가 적용된다(원거리도 갑자기 조준을 홱 바꾸지 않는다).
                locked_before = unit.get("locked_target_ref")
                resolved_target = _resolve_basic_attack_target(unit, enemy_team, time_elapsed)
                # 대상이 실제로 바뀐 순간(첫 확정 포함) 전용 이벤트를 별도로 남긴다 - 프론트엔드는 예전엔
                # "이 유닛의 공격이 실제로 명중한" basic_attack 이벤트를 통해서만 새 목표를 알 수 있었다.
                # 근접 유닛이 걸어가서 실제로 명중시키기까지는 시간이 걸리는데(특히 rear_priority처럼 먼
                # 대상을 쫓을 때), 그동안 백엔드는 이미 몇 번이고 더 새 대상으로 갱신됐을 수 있다 - 그 사이
                # 프론트엔드는 여전히 "예전 대상"을 향해 걷고 있어서, 상대가 한참 이동하는 동안 화면에는
                # 아무 반응도 없다가 뒤늦게 몰아서 재생되는 것처럼 보이는 버그가 있었다. 목표가 바뀌는 그
                # 순간 즉시 알려주면, 근접 유닛이 실제 명중보다 훨씬 먼저부터 올바른 방향으로 걸어간다.
                if resolved_target is not None and resolved_target is not locked_before:
                    events.append({
                        "time": time_elapsed, "event_type": "target_lock_resolve", "side": side_name,
                        "actor": unit["name"], "target": resolved_target["name"],
                        "target_side": "defender" if side_name == "attacker" else "attacker",
                    })
                if unit.get("melee_speed") is not None and resolved_target is not None:
                    _advance_melee_position(unit, resolved_target["position"], TICK)

                if time_elapsed < unit["next_attack_time"]:
                    continue

                if _alive_target(enemy_team) is None:
                    continue

                if (
                    unit.get("melee_speed") is not None
                    and resolved_target is not None
                    and abs(unit["position"] - resolved_target["position"]) > ARRIVAL_EPSILON
                ):
                    continue

                _do_basic_attack(unit, side_name, own_team, enemy_team, time_elapsed, events, resolved_target=resolved_target)
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
    elif not attacker_alive and not defender_alive:
        # 무승부: 같은 틱에 양팀이 동시에 전멸한 경우. 아군까지 함께 때리는 광역기(예: 김어진 "불빠따")가
        # 마지막 남은 아군을 쓰러뜨리는 것과 동시에 적팀도 전멸시키는 극히 드문 상황에서만 발생한다 -
        # 시전자 본인은 자기 광역기에 맞지 않으므로 일반적으로는 나오기 어렵다. None으로 표시하고,
        # 호출부(routers/pvp.py)에서 승패 어느 쪽에도 해당하는 보상/순위 변동을 주지 않는다.
        attacker_won = None
    else:
        # 둘 다 아직 살아있는 채로 루프가 끝난 경우 - MAX_BATTLE_DURATION(시간 제한)에 걸린 것이다.
        # 회복형 캐릭터가 몰려서(예: 이영웅 다수 조합) 입히는 피해보다 회복량이 더 커 어느 쪽도 전멸하지
        # 않는 전투를 여기서 강제 종료하고, 그 시점 HP 비율이 더 높은 쪽을 승자로 판정한다.
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
