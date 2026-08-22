"""
PVP 전투 시뮬레이션 엔진 - 공용 기반(코어) 모듈.
캐릭터 스탯 계산, 타겟 선정/이동, 피해·상태이상 적용, 치명타 판정 등 star_handlers.py/trait_handlers.py/
skill_handlers.py/battle_engine.py가 공통으로 쓰는 순수 함수·상수를 모아둔다. 이 파일 자체는 그 넷 중
어디도 import하지 않는다(의존성 그래프의 가장 아래 레이어) - 그래야 순환 임포트가 생기지 않는다.

이전에 나뉘어 있던 성급별 효과가 스킬로 통합 되었기에 앞으로 star=passive, skill=active, trait=special로 명명한다.
"""
import json
import random

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

# 슬롯별 이동 속도(좌표/초) - "도착까지 걸리는 시간"이 아니라 이 속도 자체가 기준값이다. 캐릭터가
# 실제로 도착하는 데 걸리는 시간은 (그때그때의 실제 좌표 차이) / (이 속도)로 항상 다시 계산되는
# 결과일 뿐이라, 넉백/재타겟으로 거리가 바뀌어도 자연히 정확하고, 나중에 "이동속도 증가" 같은 효과를
# 추가할 때도 ATK/공격속도(atk_percent_bonus/haste_percent)와 똑같이 이 속도값에 퍼센트 가산만
# 하면 된다(_advance_melee_position이 매 틱 이 값으로 좌표를 옮김).
# 값 자체는 "전방은 자기 홈에서 상대 전방까지 2.0초, 후방은 3.6초에 도착"이라는 기존 튜닝 의도를
# 그대로 보존해서 역산했다 - 후방이 거리는 더 멀지만 걸리는 시간은 그거보다 덜 늘어나므로(1.8배),
# 초당 속도로 보면 후방이 오히려 살짝 더 빠르다.
MELEE_SPEED_FRONT = (AXIS_DEFENDER_FRONT - AXIS_ATTACKER_FRONT) / 2.0  # 0.5
MELEE_SPEED_BACK = (AXIS_DEFENDER_FRONT - AXIS_ATTACKER_BACK) / 3.6    # ≈0.5556

ARRIVAL_EPSILON = 0.01  # 목표와의 좌표 차이가 이 이하면 "도착"으로 취급(부동소수 오차 대비 여유)

# 넉백으로 밀려나는 거리(좌표축 기준) - 인접한 슬롯 하나 폭(예: 상대 전방->상대 후방)과 같은 값이라
# "슬롯 하나만큼 뒤로 밀려난다"는 감각이다. 자기 팀 홈 back 좌표를 넘어서까지 밀리지는 않는다(클램프).
KNOCKBACK_POSITION_DISTANCE = AXIS_DEFENDER_BACK - AXIS_DEFENDER_FRONT  # 1.0

# 노출도 순위가 바뀌어서 기본공격 대상이 "달라질 후보"가 나타나도, 곧바로 갈아타지 않고 그 후보가
# 이 시간만큼 계속 1순위를 유지해야 비로소 확정한다(뜸들이기) - 근소한 차이로 순위가 잠깐씩 오락가락할
# 때마다 시선이 휙휙 바뀌는 게 부자연스러워서다. 단, 이미 정한 대상이 하나도 없거나(첫 타겟 선정) 그
# 대상이 죽었을 때는 망설임 없이 즉시 확정한다 - _resolve_basic_attack_target 참고.
TARGET_SWITCH_HESITATION_SECONDS = 0.51

SKILL_CAST_INTERVAL_MULTIPLIER = 0.7  # 시전 시간 = 기본공격 주기 * 이 값

# ── 코스트(공유 자원) 기반 [Active] 발동 ─────────────────────────────────────────────
# 팀당 하나의 공유 코스트 풀. 시간이 지나면 저절로 차오르고, 스킬카드가 발동할 때 그 캐릭터의 개별
# 코스트만큼 소모된다(블루아카이브식). 예전엔 유닛별 기본공격 3회(SKILL_TRIGGER_ATTACK_COUNT)가
# 트리거였는데, 유닛마다 완전히 독립적이라 "팀 단위 자원 운용"이라는 감각이 없었고 밸런스 조정도
# 어려웠다 - 이제 캐릭터별 코스트 값(아래 CHARACTER_SKILL_COST)과 팀 회복 속도 두 축으로만 조절한다.
TEAM_COST_MAX = 10           # 공용 코스트 풀 상한 - 캐릭터별 코스트(CHARACTER_SKILL_COST)가 전부 2~6이라
# 100은 사실상 도달할 일이 없는 장식적 상한이었고, 그래서 코스트 바 아래 10칸 눈금(cost-bar-segments)이
# 찬 칸 수와 실제 코스트 숫자가 안 맞아 보였다 - 10으로 낮춰서 "코스트 1점당 아래 1칸"이 그대로 맞게 한다.
TEAM_COST_START = 0.0        # 전투 시작 시 보유량

# "지금 살아있는, [Active]를 가진 아군 수" -> 코스트 1점을 채우는 데 걸리는 시간(초). 팀 인원수가
# 늘수록(서포터 도입 후) 더 빨리 찬다. 매 틱 다시 계산한다 - 아군이 죽으면 그 즉시 느려진다. 0명이면
# 회복 자체가 없다(None). 기준은 "1명일 때 초당 0.25코스트(=1점당 4초), 2명이면 x2배속(초당
# 0.5코스트=1점당 2초), 3명이면 x3배속(초당 0.75코스트=1점당 4/3초)" - 초당 코스트 배율로 정의된 걸
# "1점을 채우는 시간(초)" = 1/배율로 환산해서 저장해둔다(_tick_team_cost가 이 표를 그대로 나눗셈에 씀).
COST_SECONDS_PER_POINT_BY_ALIVE = {0: None, 1: 1 / 0.25, 2: 1 / 0.5, 3: 1 / 0.75}

# 스킬카드 발동 순서(라운드로빈). "supporter"는 아직 실제 로스터 슬롯이 없어서 team.get("supporter")가
# 항상 None을 돌려주고 자동으로 로테이션에서 제외된다 - 나중에 서포터 편성이 생기면 이 튜플은 그대로
# 두고 build_team에 그 슬롯만 추가하면 된다.
COST_ROTATION_SLOTS = ("front", "back", "supporter")

# 서포터 슬롯을 실제 전투에 참여시킬지 여부. False인 동안은 routers/pvp.py의 run_battle이 서포터
# 등록 여부와 무관하게 build_team에 항상 supporter=None만 넘겨서, 실배포 전투는 전방/후방 2인 그대로
# 진행된다. 서포터(김크장류)는 애초에 전장에 나서지 않는 설계라(체력 없음, _all_slots/_alive_units에
# 안 잡힘, 공격도 피격도 안 됨) front/back처럼 포지셔닝·타게팅을 지원할 필요가 없다 - 코스트 로테이션
# 참여([Active] 발동)와 전투 시작 시 1회 판정([Passive] 보호막 부여, [Special] 시너지, 스탯 절반
# 기부)만으로 완결된다. 이 플래그는 그래서 "엔진이 아직 미완성"이 아니라 순수하게 배포 타이밍
# 조절용이다(신캐 출시와 묶어서 켤 예정).
ENABLE_SUPPORTER_SLOT = True

DEFAULT_SKILL_COST = 3  # characters.json에 아직 cost가 없는 캐릭터용 폴백(신규 캐릭터 추가 중 등)

# [Active] 발동에 드는 공용 코스트 풀 소모량(캐릭터별 고정값, characters.json의 skill_mechanics.cost).
CHARACTER_SKILL_COST = {
    name: mechanics.get("cost", DEFAULT_SKILL_COST)
    for name, mechanics in CHARACTER_SKILL_MECHANICS.items()
}

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
        "stack_atk_bonus": 0,         # self_stack_buff(stat="atk")가 atk_percent_bonus에 "지금까지
                                      # 자기가 기여한 몫"을 따로 기억해두는 값 - 재시전 때 이 몫만큼만
                                      # 빼고 새 몫을 더해(델타 적용) 다른 영구 소스(서포터 스탯 지원,
                                      # star effect 등)가 같은 atk_percent_bonus에 쌓아둔 기여분을
                                      # 덮어쓰지 않는다.
        "stack_haste_bonus": 0,       # 윤대웅 self_stack_buff(stat="haste", 확인된 요청으로 atk에서
                                      # 변경)가 haste_percent에 쓰는 동일한 델타 추적용 값.
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
    # 내구도 패치(전투가 너무 빨리 끝나던 문제 완화): 체력 125%, 공격력 75% - 레벨로 붙는 보정분에도
    # 똑같이 곱한다(별 기준치+레벨 보정을 더한 합계 자체를 스케일링하므로 자동으로 둘 다 반영됨).
    ranged_hp = round((base["hp"] + effective_level * 20) * 1.25)   # hp는 원거리 기준값
    melee_atk = round((base["atk"] + effective_level * 2) * 0.75)   # atk는 근거리 기준값

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

    # 프론트(arena-battle.js)는 이 추상 좌표축(axis) 단위의 melee_speed를 그대로는 못 쓴다 - 화면은
    # 실제 픽셀 거리로 움직이지 실 좌표계를 안 쓰기 때문. 그래서 "전방 기준 몇 배 빠른가"라는 비율만
    # 넘겨서, 프론트가 자기 픽셀 단위 걷기 속도에 이 비율만 곱하면 전방/후방의 실제 시뮬레이션 속도
    # 차이가 화면에도 그대로 반영되게 한다(원거리는 애초에 안 걸으므로 None).
    melee_speed_ratio = (melee_speed / MELEE_SPEED_FRONT) if melee_speed is not None else None

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
        # 최대 체력 비례 보호막(예: 김크장 "외국인 노동자") - 기존 status["shield_until"](시간 동안
        # 무적)와는 다른 개념으로, "수치가 있는" 보호막이다. 받는 피해를 먼저 이 수치에서 깎고, 다
        # 깎이고 남은 만큼만 체력에서 깎는다(_apply_damage 참고).
        "shield": 0,
        "atk": atk,
        "star": star,
        "is_melee": is_melee,
        "job_class": CHARACTER_JOB_CLASS.get(character_name),
        "attack_type": ATTACK_TYPE.get(character_name, "Student"),
        "defense_type": DEFENSE_TYPE.get(character_name, "Student"),
        "attack_interval": attack_interval,
        "next_attack_time": attack_interval,
        "is_casting": False,
        "cast_end_time": None,
        "skill_effect_type": skill_effect_type,
        # [Active]가 있는 유닛만 코스트를 가진다 - None이면 코스트 로테이션/카드 UI에서 "이 자리엔
        # [Active]가 없다"(EMPTY, ★1~3 등)는 뜻으로 그대로 쓰인다(_cost_rotation_units 등 참고).
        "skill_cost": CHARACTER_SKILL_COST.get(character_name) if skill_effect_type else None,
        "skill_params": skill_params,
        "trait_effect_type": trait_effect_type,
        "trait_params": trait_params,
        "trait_partner_name": trait_partner_name,
        "star_effect_type": star_effect_type,
        "star_params": star_params_out,
        "gendered_damage_bonus": None,  # damage_to_gender_bonus 성급 효과가 있으면 배틀 시작 때 채워짐
        "status": _new_status(),
        "is_clone": False,
        # 이벤트 로그에 actor_slot으로 실려나가 프론트가 이름만으로(findUnitKey) 배우를 특정하는 대신
        # 슬롯으로 정확히 특정하게 해준다 - 강승유가 "호"를 복제하면 한 팀에 같은 이름("호")의 유닛이
        # 두 개(원본 소환수 + 복제된 소환수) 동시에 존재할 수 있어서, 이름만으로는 어느 쪽 행동인지
        # 구분이 안 된다(항상 먼저 찾아지는 쪽으로 잘못 귀속됨 - 아래 _skill_summon_clone도 참고).
        "slot": slot,
        "melee_speed": melee_speed,
        "melee_speed_ratio": melee_speed_ratio,
        # position/is_attacker_team은 아직 모른다(이 시점엔 이 유닛이 공격자 팀인지 방어자 팀인지도
        # 정해지지 않음) - simulate_battle 시작 시 실제 값으로 채워진다.
        "position": None,
        "is_attacker_team": None,
    }


def build_team(front, back, supporter=None):
    # "summon_front"/"summon_back"은 기존 전방/후방과 별개로 존재하는 전용 자리 - 윤영준의 복제체처럼
    # 인원을 대체하지 않고 "추가로" 소환되는 유닛 전용이다. 평소엔 비어있다(None). 시전자가 front면
    # summon_front, back이면 summon_back을 쓰므로, 같은 팀에 summon_clone을 쓰는 캐릭터가 둘(예:
    # 윤영준+강승유) 있어도 서로의 복제체를 밀어내지 않고 각자 자기 몫의 복제체를 유지할 수 있다.
    # "supporter"는 ENABLE_SUPPORTER_SLOT이 True인 동안만 호출부가 채워 넣는다 - _all_slots에는 아직
    # 포함되지 않아 실제 공격/피격에는 참여하지 않고, 코스트카드 표시(_cost_rotation_units)에만 쓰인다.
    return {
        "front": front, "back": back, "supporter": supporter, "summon_front": None, "summon_back": None,
        # ── 팀 공유 코스트 풀(전방/후방/서포터가 함께 쓰는 하나의 자원) ──
        "cost": TEAM_COST_START,          # float - 매 틱 TICK/초당비율만큼 차오름
        "cost_turn_index": 0,             # COST_ROTATION_SLOTS의 인덱스 = "지금 차례인 카드"
        "cost_seconds_per_point": None,   # 지금 적용 중인 회복 속도(바뀔 때만 이벤트를 남기려고 캐시)
    }


def _init_team_cost(team):
    """build_team을 거치지 않고 만들어진 팀 dict(과거 테스트/스크립트 등)도 안전하게 돌도록, 코스트
    필드가 없으면 채워준다(_init_unit_positions와 같은 성격) - simulate_battle 진입 시 양 팀에 호출."""
    team.setdefault("cost", TEAM_COST_START)
    team.setdefault("cost_turn_index", 0)
    team.setdefault("cost_seconds_per_point", None)


def _all_slots(team):
    return (team["front"], team["back"], team.get("summon_front"), team.get("summon_back"))


def _exposure(unit):
    """유닛의 "노출도" - 값이 클수록 더 전진해서(공격받기 쉬운 상태로) 나가있다는 뜻이다. position은
    공유 좌표축 절대값이라 팀마다 "전진 방향"이 반대라서(공격자는 좌표가 커질수록, 방어자는 작아질수록
    전진), is_attacker_team으로 부호를 정규화해서 두 팀 모두 "이 값이 클수록 더 전진"으로 통일한다."""
    return unit["position"] if unit["is_attacker_team"] else -unit["position"]


def _exposure_sort_key(unit):
    """_alive_units 정렬 키 - 노출도가 같을 때(예: 윤영준이 복제체 소환 넉백 후 다시 걸어와 복제체와
    거의 같은 좌표로 수렴하는 경우) 그 동률을 어떻게 깨는지가 중요하다. 예전엔 그냥 _all_slots의
    고정 순서(front가 항상 먼저)로 깨져서, 넉백당했다가 나중에 그 자리로 "다시 돌아온" 쪽이 원래
    거기 계속 있던 쪽(또는 방금 소환된 복제체)보다 오히려 전방으로 판정되는 문제가 있었다 - 실제로는
    더 늦게 그 위치에 도달한 쪽이 후방이어야 자연스럽다. position_settled_at(그 좌표에 마지막으로
    "도착"한 시각 - _advance_melee_position/넉백 계열 스킬이 갱신)을 2차 키로 써서, 노출도가 같으면
    더 일찍부터 그 자리를 지키고 있던 쪽(settled_at이 더 이른 쪽)이 전방을 유지하고, 더 늦게 도착한
    쪽이 후방으로 밀리게 한다."""
    return (_exposure(unit), -unit.get("position_settled_at", 0.0))


def _alive_units(team):
    """생존 유닛을 "더 전진(노출)한 순서"로 반환한다. 예전엔 항상 front->back 고정 슬롯 순서였지만,
    이제 실제 시뮬레이션된 물리적 position 기준으로 매 순간 다시 정렬된다 - 근접 유닛이 슬롯상
    후방이어도 걸어서 슬롯상 전방보다 더 앞서 나가면(또는 넉백으로 전방이 뒤로 밀려나면) 그 쪽이
    실제로 first가 된다. 전투 시작 시점엔 모두 홈 좌표에 있어 front가 항상 back보다 노출도가 높으므로,
    아직 아무도 움직이지 않았다면 기존과 동일하게 front가 먼저 나온다.
    복제체(클론)도 front/back과 완전히 동일하게 이 노출도 순서에 함께 정렬된다 - "전방/후방이 모두
    죽어야 비로소 대상이 됨"이라는 예전 고정 규칙은 폐지됐다. 클론은 시전자의 그 순간 position을
    물려받아 시작하고(_skill_summon_clone), 근접이면 이후에도 다른 유닛과 동일하게 자기 target을
    쫓아 계속 움직이므로, 노출도 계산에 그대로 섞여 들어가도 값이 항상 유효하다. 노출도가 동률일 때의
    타이브레이커는 _exposure_sort_key 참고."""
    units = [u for u in (team["front"], team["back"], team.get("summon_front"), team.get("summon_back")) if u and u["hp"] > 0]
    units.sort(key=_exposure_sort_key, reverse=True)
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
                # 모든 스킬 피해가 이 한 곳을 거치므로, 개별 스킬 핸들러를 안 건드리고도 보호막 잔량을
                # 모든 피격 이벤트에 실어보낼 수 있다(프론트 보호막 바 렌더링용 - arena-battle.js 참고).
                hit["target_shield_after"] = ref.get("shield", 0)

    ref = detail.pop("_target_ref", None)
    if ref is not None:
        detail["target_side"] = resolve(ref)

    return detail


def build_stat_change_dicts(changes, side_name, enemy_side):
    """성급 효과(star_handlers.py)/특성(trait_handlers.py) 핸들러가 공통으로 돌려주는
    "누가 어떤 방향으로 스탯이 바뀌었는지" 튜플 목록을,
    프론트가 상태 아이콘을 켜는 데 쓰는 change_dicts로 변환한다(star_effect_resolve/trait_resolve가
    공유하는 프론트 로직 - arena-battle.js의 changes 처리 참고).

    각 튜플은 (rel, target, atk_sign, hp_sign, crit_sign=0, crit_chance_sign=0, rear_sign=0, haste_sign=0,
    shield_sign=0) - rel은 "own"(own_team 소속) 또는 "enemy". 부호는 +1(증가)/-1(감소)/0(변화 없음)만
    쓴다(정확한 수치는 아이콘 표시에 필요 없음 - 정확한 수치가 필요한 문구는 각 핸들러가 별도로 만드는
    detail에 담는다). 단, shield(보호막)만은 예외 - target["shield"]가 이미 최신 값으로 갱신돼 있는
    상태에서 이 함수가 호출되므로, shield_sign 여부와 무관하게 그 시점의 실제 보호막 수치를 항상 함께
    실어보낸다(김크장류의 "전투 시작 시 보호막 부여"처럼 atk/hp 변화가 전혀 없어 다른 신호가 다 0이어도
    이 이벤트 자체는 발생해야, 프론트가 첫 피격 전에도 보호막 바를 곧바로 그릴 수 있다).

    특성 쪽은 원래 effect_type마다 프론트에 개별 분기를 하나씩 손으로 추가해야 했는데(캐릭터가
    늘어날 때마다 아이콘 처리를 깜빡하기 쉬운 구조였음 - 실제로 5개나 빠져 있었다), 성급 효과와
    똑같은 이 범용 목록을 쓰게 통일하면 앞으로 새 캐릭터를 추가해도 이 목록만 제대로 채우면
    아이콘 처리가 구조적으로 자동 보장된다."""
    change_dicts = []
    for change in changes:
        rel, target, atk_sign, hp_sign, *extra = change
        extra = list(extra) + [0, 0, 0, 0, 0]
        crit_sign, crit_chance_sign, rear_sign, haste_sign, shield_sign = extra[0], extra[1], extra[2], extra[3], extra[4]
        if not (atk_sign or hp_sign or crit_sign or crit_chance_sign or rear_sign or haste_sign or shield_sign):
            continue
        change_dicts.append({
            "target": target["name"],
            "target_side": side_name if rel == "own" else enemy_side,
            "atk": atk_sign,
            "hp": hp_sign,
            "crit": crit_sign,
            "crit_chance": crit_chance_sign,
            "rear_priority": rear_sign,
            "haste": haste_sign,
            "shield": shield_sign,
            "shield_after": target.get("shield", 0),
        })
    return change_dicts


def _team_alive(team):
    return bool(_alive_target(team))


def _teammate(team, unit):
    """자신을 제외한 다른 팀원 1명(살아있든 아니든) - front/back/summon_front/summon_back 순서로 첫 번째를 반환."""
    for other in _all_slots(team):
        if other is not None and other is not unit:
            return other
    return None


def _is_unit_moving(unit):
    """이 유닛이 지금 이 순간 아직 자기 기본공격 대상(_resolve_basic_attack_target이 확정해둔
    locked_target_ref)을 향해 걸어가는 중인지 - 원거리(melee_speed 없음)나 아직 확정된 대상이 없으면
    (또는 그 대상이 이미 죽었으면) 항상 False. 회복(이영웅 "청진기 진료"/신 "제 1 권한")이 "대상이
    이동 중이면 하트에 맞지 않아 회복 실패"를 판정할 때 쓴다 - _cost_caster_in_position이 쓰던 것과
    동일한 "도착 여부" 판정(ARRIVAL_EPSILON)을 그대로 재사용한다."""
    if unit.get("melee_speed") is None:
        return False
    target = unit.get("locked_target_ref")
    if target is None or target["hp"] <= 0:
        return False
    return abs(unit["position"] - target["position"]) > ARRIVAL_EPSILON


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
    """공격 주기(속도)를 구하는 기준값 합산 방식은 _effective_atk와 동일하다 - 영구(haste_percent) +
    아직 안 끝난 임시 소스(temp_haste_mods)를 전부 더해 "총 공격속도%"를 구한다. 다만 그 뒤 주기에
    반영하는 공식은 다르다: (1 - 총%/100)을 곱하는 선형 감소 방식은 총 공격속도가 100%를 넘는 순간
    주기가 0 이하(음수)가 되어버리는 문제가 있었다 - 공격속도를 "기준 속도(1) + 버프량"의 배수로 보고
    주기를 그 배수로 나누면(속도가 오른 만큼 주기가 줄어드는 반비례 관계), 버프가 아무리 커져도
    주기는 절대 0 밑으로 내려가지 않고 계속 짧아지기만 한다(점근적으로 0에 가까워짐)."""
    status = unit["status"]
    interval = unit["attack_interval"]
    total_haste = status["haste_percent"]
    for mod in status["temp_haste_mods"].values():
        if time_elapsed < mod["until"]:
            total_haste += mod["percent"]
    if total_haste:
        interval = interval / (1 + total_haste / 100)
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
    """실드(shield_until)가 떠 있으면 피해를 0으로 만든다(=무적). 방임석의 "방임" 상태가 활성이면
    (neglect_active) 대신 받는 피해를 dr_percent만큼 줄인다 - 실드와 동시에 걸릴 일은 없다(둘 다 self
    전용 상태라 서로 다른 캐릭터에게만 각각 있음). 그 다음, 수치형 보호막(target["shield"] - 김크장류
    지원가가 부여하는 최대 체력 비례 보호막)이 남아있으면 먼저 거기서 깎고, 다 깎고도 남은 만큼만
    체력에서 깎는다.

    반환값은 (dealt, raw_amount, invincible_block) 튜플. dealt는 실제로 체력에서 깎인 순수 피해 -
    흡혈/처치 판정/로그의 "피해량" 등 게임 로직에는 항상 이 값을 써야 한다(보호막으로 막은 양은 안
    잡힘). raw_amount는 실드/방임 감쇄가 적용되기 "전" 원래 맞았어야 할 피해량(반올림만 적용) - 무적
    상태라 dealt=0이어도 raw_amount는 원래 위력 그대로다. 프론트 피해 숫자 표시 전용(수치형 보호막에
    완전히 막혀도 0이 아니라 "원래 이만큼 맞았을 것"을 보여줘야 공격이 허공에 씹힌 것처럼 안 보인다) -
    그 외 로직은 절대 이 값을 쓰면 안 된다(막힌 피해로 흡혈/처치 판정이 나면 안 되므로). invincible_block은
    이 히트가 "무적"(shield_until) 때문에 막혔는지 - 수치형 보호막으로 막힌 경우는 여기 해당하지 않는다
    (확인된 요청 - 무적일 때만 프론트가 피해 숫자 대신 MISS를 보여준다, 보호막으로 막힌 건 그대로 숫자 표시)."""
    raw_amount = max(0, round(amount))
    invincible_block = target["status"]["shield_until"] is not None and time_elapsed < target["status"]["shield_until"]
    if invincible_block:
        amount = 0
    elif target.get("neglect_active") and target.get("neglect_config"):
        amount *= (1 - target["neglect_config"]["dr_percent"] / 100)
    amount = max(0, round(amount))
    if target.get("shield"):
        absorbed = min(target["shield"], amount)
        target["shield"] -= absorbed
        amount -= absorbed
    target["hp"] = max(0, target["hp"] - amount)
    return amount, raw_amount, invincible_block


def _maybe_grant_low_hp_shield(target, target_team, time_elapsed):
    """배(개량한복): target이 방금 이 _apply_damage 호출로 체력 50% 미만이 됐고, target_team에
    low_hp_shield_config(_star_shield_low_hp_striker_once가 심어둔 "장전")가 걸려있으며 아직 자격을
    다 안 썼다면 그 즉시 무적을 부여한다. battle_engine._apply_low_hp_shield_grant(매 틱 전체 스윕)와
    자격 판정은 완전히 동일하지만, 이건 그 피해를 입힌 _apply_damage 호출 "바로 다음"에 불러서 이
    피해 이벤트 자체와 시간이 정확히 붙는다 - 스윕 방식은 다음 틱(0.05초 뒤)에야 감지하는데, 그 정도
    간격은 사소해 보여도 정작 원인이 된 공격 자체가 원거리 윈드업+비행처럼 훨씬 긴 화면 재생 지연을
    갖고 있으면, 프론트에서 그 공격이 화면에 닿기도 전에 무적 아이콘이 먼저 뜨는 것처럼 보이는 원인이
    됐다(호출부가 이 반환값을 그 피해 이벤트/히트 자체에 실어 보내면, 프론트가 "그 타격이 실제로
    착탄하는" 콜백에서 곧바로 무적 이펙트를 함께 재생할 수 있어 정확히 동기화된다).
    _apply_low_hp_shield_grant 스윕은 이 경로를 안 타는 극소수 케이스(예: _apply_damage를 거치지 않는
    hp 변화)에 대한 안전망으로 그대로 남겨둔다 - 이미 여기서 자격을 다 썼으면(아래에서 플래그 설정)
    그쪽은 자연히 아무 일도 안 한다.
    부여했으면 지속시간(초)을, 아니면 None을 반환한다."""
    config = target_team.get("low_hp_shield_config")
    if not config or target["hp"] <= 0 or target["hp"] / target["max_hp"] >= 0.5:
        return None
    once_per_striker = config["once_per_striker"]
    if once_per_striker:
        if target.get("_low_hp_shield_used"):
            return None
        target["_low_hp_shield_used"] = True
    else:
        if target_team.get("_low_hp_shield_used_once"):
            return None
        target_team["_low_hp_shield_used_once"] = True
    seconds = config["seconds"]
    _refresh_status_until(target["status"], "shield_until", time_elapsed + seconds, time_elapsed)
    return seconds


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


def _is_action_blocked(unit, time_elapsed):
    """지금 이 유닛이 아무 행동도 못 하는 상태인지(기절 / 방임). 메인 틱 루프의 기본공격 행동 게이트와
    코스트 카드 발동 게이트(_tick_team_cost, battle_engine.py)가 반드시 같은 판정을 쓰도록 뽑아냈다 -
    한쪽만 고치고 다른 쪽을 깜빡하면 "카드는 발동 가능한데 기본공격은 못 하는" 것 같은 불일치가 생긴다.
    넉백은 별도 상태가 아니라 position 이동으로만 표현되므로(청년의 bonus_damage_knockback도 스턴을
    같이 걺) 여기 따로 포함할 필요가 없다."""
    status = unit["status"]
    if status["stun_until"] is not None and time_elapsed < status["stun_until"]:
        return True
    return bool(unit.get("neglect_active"))


def _interrupt_cast_if_casting(target, time_elapsed, priority=CC_PRIORITY_DEFAULT):
    """대상이 마침 스킬을 시전 중이었다면 취소한다 - 기절/넉백 등 CC기 공통 처리. 재개되지 않는다.
    코스트는 이미 cast_start 시점에 공용 풀에서 차감됐으므로, 이렇게 CC로 끊겨도 환불되지 않는다
    (의도된 트레이드오프 - CC가 상대의 스킬 자원을 그대로 날려버리는 셈이라 그만큼 강력해진다).
    반환값은 실제로 시전을 끊었는지 여부(프론트에 "시전 취소" 연출을 보여주기 위한 것).

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
