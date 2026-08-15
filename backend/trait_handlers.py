"""
특성(trait) 효과 핸들러 모음. battle_engine.py의 _apply_battle_start_traits가 전투 시작 시 1회
호출한다(캐릭터별 팀 시너지류 - 파트너 유무/타입 조건 등을 그 시점에 한 번만 판정).
명명 규칙(trait=special)은 battle_core.py 상단 참고.

각 핸들러는 (caster, team, enemy_team, params) 시그니처로 통일한다 - 이의진/서민석처럼 상대 팀까지
봐야 하는 특성이 있어서, 자기 팀만 보는 특성도 안 쓰는 enemy_team 인자를 그냥 받아둔다. 조건이
충족되지 않으면 None을, 충족되면 (detail, changes)를 돌려준다:
  - detail: 로그 문구(traitLogText)가 필요로 하는 구체적인 수치(partner 이름, 퍼센트 등) - 캐릭터마다 다름.
  - changes: 상태 아이콘용 범용 변화 목록 - star_handlers.py와 완전히 같은 형식
    ("own"|"enemy", 대상유닛, atk_sign, hp_sign, crit_sign=0, crit_chance_sign=0, rear_sign=0, haste_sign=0).
    호출부(_apply_battle_start_traits)가 build_stat_change_dicts로 변환해 이벤트에 함께 실어보낸다.
    이렇게 통일해두면 새 캐릭터가 추가돼도 changes만 제대로 채우면 프론트 아이콘 처리가 자동으로
    보장된다(예전엔 effect_type마다 프론트에 아이콘 분기를 손으로 추가해야 해서 빠뜨리기 쉬웠다).
"""
from battle_core import _alive_units, _all_slots, _effective_gender, _teammate, build_stat_change_dicts

# ───────────────────────── 특성(trait) - 전투 시작 시 1회만 판정 ─────────────────────────

def _trait_ally_synergy_remove_absorb(caster, team, enemy_team, params):
    # 윤대웅(도플갱어): 파트너를 제거하고 그 스탯 일부를 흡수.
    partner = _teammate(team, caster)
    if not partner or partner["name"] != caster["trait_partner_name"] or partner["hp"] <= 0:
        return None
    absorb = params["absorb_percent"] / 100
    caster["atk"] += round(partner["atk"] * absorb)
    caster["max_hp"] += round(partner["max_hp"] * absorb)
    caster["hp"] = caster["max_hp"]
    partner["hp"] = 0  # "제거" - 죽은 것으로 처리(이 hp=0 반영 자체는 changes로 아이콘화할 대상이 아니라
    # 별도로 detail.removed를 보고 프론트가 직접 처리한다 - _apply_battle_start_traits 참고)
    detail = {"removed": partner["name"], "absorb_percent": params["absorb_percent"]}
    changes = [("own", caster, 1, 1)]
    return detail, changes


def _trait_ally_synergy_atk_buff(caster, team, enemy_team, params):
    # 파트너가 있으면 자신에게 버프 - stat이 "hp"면 체력을(청년↔송주헌), 기본(atk, 윤영준↔강 희)이면
    # 공격력을 올린다. 이종복↔임소정처럼 서로가 서로를 partner_name으로 지정해두면, 양쪽 다 이 핸들러가
    # 각자 자신에게 버프를 걸어서 "함께 있으면 둘 다 강해짐"이 자연히 성립한다.
    partner = _teammate(team, caster)
    if not partner or partner["name"] != caster["trait_partner_name"] or partner["hp"] <= 0:
        return None
    stat = params.get("stat", "atk")
    if stat == "hp":
        percent = params["hp_percent"]
        gain = round(caster["max_hp"] * percent / 100)
        caster["max_hp"] += gain
        caster["hp"] += gain
        detail = {"partner": partner["name"], "hp_percent": percent}
        changes = [("own", caster, 0, 1)]
    else:
        percent = params["atk_percent"]
        caster["status"]["atk_percent_bonus"] += percent
        detail = {"partner": partner["name"], "atk_percent": percent}
        changes = [("own", caster, 1, 0)]
    return detail, changes


def _trait_ally_job_conditional_team_buff(caster, team, enemy_team, params):
    # 김남옥(자애심)/강승유(친근감): 파트너의 역할(attack_type)이 job_type과 일치하면(예: "Student")
    # 아군 전체(자신 포함) 공격력/체력 X% 증가. "직업:학생"처럼 텍스트가 말하는 직업 카테고리는 이
    # 게임에서 캐릭터의 attack_type 삼각 상성값(Student/Parent/Teacher)과 대응된다 - job_class는
    # "1반 학생"/"초심자"처럼 캐릭터마다 제각각인 순수 설정 문구라 조건 판정에 쓰기엔 너무 좁다.
    partner = _teammate(team, caster)
    if not partner or partner["hp"] <= 0 or partner.get("attack_type") != params["job_type"]:
        return None
    atk_percent = params.get("atk_percent", 0)
    hp_percent = params.get("hp_percent", 0)
    changes = []
    for ally in _alive_units(team):
        if atk_percent:
            ally["status"]["atk_percent_bonus"] += atk_percent
        if hp_percent:
            gain = round(ally["max_hp"] * hp_percent / 100)
            ally["max_hp"] += gain
            ally["hp"] += gain
        changes.append(("own", ally, 1 if atk_percent else 0, 1 if hp_percent else 0))
    detail = {"partner": partner["name"], "atk_percent": atk_percent, "hp_percent": hp_percent}
    return detail, changes


def _trait_ally_type_conditional_team_buff(caster, team, enemy_team, params):
    # 강 희(광역 도발): 파트너의 공격 타입이 Teacher면 아군 전체 공격력 X%, 방어 타입이 Teacher면
    # 아군 전체 체력 X% - 두 조건은 독립적이라 파트너가 둘 다 Teacher면 둘 다 적용된다("중첩 가능").
    partner = _teammate(team, caster)
    if not partner or partner["hp"] <= 0:
        return None
    atk_percent = params.get("atk_percent", 0) if partner.get("attack_type") == "Teacher" else 0
    hp_percent = params.get("hp_percent", 0) if partner.get("defense_type") == "Teacher" else 0
    if not (atk_percent or hp_percent):
        return None
    changes = []
    for ally in _alive_units(team):
        if atk_percent:
            ally["status"]["atk_percent_bonus"] += atk_percent
        if hp_percent:
            gain = round(ally["max_hp"] * hp_percent / 100)
            ally["max_hp"] += gain
            ally["hp"] += gain
        changes.append(("own", ally, 1 if atk_percent else 0, 1 if hp_percent else 0))
    detail = {"partner": partner["name"], "atk_percent": atk_percent, "hp_percent": hp_percent}
    return detail, changes


def _trait_team_teacher_hp_buff(caster, team, enemy_team, params):
    # 불빠따 김어진(교권 보호): 팀 내(자신 포함) 공격/방어 타입 중 하나라도 Teacher인 캐릭터 전원의
    # 최대 체력 X% 증가.
    percent = params["percent"]
    targets = []
    changes = []
    for u in _alive_units(team):
        if u.get("attack_type") == "Teacher" or u.get("defense_type") == "Teacher":
            gain = round(u["max_hp"] * percent / 100)
            u["max_hp"] += gain
            u["hp"] += gain
            targets.append(u["name"])
            changes.append(("own", u, 0, 1))
    if not targets:
        return None
    detail = {"targets": targets, "hp_percent": percent}
    return detail, changes


def _trait_teammate_hp_buff_self_cost(caster, team, enemy_team, params):
    # 송주헌(페이스 메이커): 파트너 최대 체력 X% 증가 + 자신의 최대 체력 50% 감소(대가).
    # 팀에 파트너가 없으면(전방/후방 중 한 자리만 등록된 편성) 줄 상대가 없으니 자기 대가만 치르는
    # 손해를 방지하기 위해 아예 발동하지 않는다.
    partner = _teammate(team, caster)
    if not partner or partner["hp"] <= 0:
        return None
    changes = []
    gain = round(partner["max_hp"] * params["hp_percent"] / 100)
    partner["max_hp"] += gain
    partner["hp"] += gain
    changes.append(("own", partner, 0, 1))
    loss = round(caster["max_hp"] * params["self_hp_loss_percent"] / 100)
    caster["max_hp"] = max(1, caster["max_hp"] - loss)
    caster["hp"] = min(caster["hp"], caster["max_hp"])
    changes.append(("own", caster, 0, -1))
    detail = {
        "partner": partner["name"],
        "hp_percent": params["hp_percent"], "self_hp_loss_percent": params["self_hp_loss_percent"],
    }
    return detail, changes


def _trait_battlefield_presence_haste(caster, team, enemy_team, params):
    # 이의진(복수): 전장(양 팀 모두) 내에 특정 이름의 캐릭터가 있으면 자신의 공격 속도가 전투 끝까지 증가.
    target_name = params["target_name"]
    present = any(u and u["name"] == target_name for u in _all_slots(team)) or \
        any(u and u["name"] == target_name for u in _all_slots(enemy_team))
    if not present:
        return None
    caster["status"]["haste_percent"] = params["haste_percent"]  # 영구(전투 끝까지) - 만료 시각 불필요
    detail = {"target_name": target_name, "haste_percent": params["haste_percent"]}
    changes = [("own", caster, 0, 0, 0, 0, 0, 1)]
    return detail, changes


def _trait_female_count_haste(caster, team, enemy_team, params):
    # 서민석(본능): 전장(양 팀 모두) 내 여성 인물 수 x X%만큼 공격 속도 증가(전투 끝까지 유지).
    female_count = sum(
        1 for u in list(_all_slots(team)) + list(_all_slots(enemy_team))
        if u and _effective_gender(u) == "여"
    )
    if female_count <= 0:
        return None
    haste_percent = female_count * params["percent_per_female"]
    caster["status"]["haste_percent"] = haste_percent  # 영구(전투 끝까지) - 만료 시각 불필요
    detail = {"female_count": female_count, "haste_percent": haste_percent}
    changes = [("own", caster, 0, 0, 0, 0, 0, 1)]
    return detail, changes


def _trait_dynamic_grant_rear_priority(caster, team, enemy_team, params):
    # 최재혁(마법사 아카데미): 파트너의 직업이 마법사면, 그 파트너도 자신처럼 후방 적 우선 공격을 하게
    # 만든다(_select_basic_attack_target이 rear_priority 플래그로 판정). survive_atk_percent가 있으면
    # (6성 "+" 티어) 파트너도 후방 적 생존 시 공격력 증가 조건부 보너스를 함께 받는다.
    partner = _teammate(team, caster)
    if not partner or partner["hp"] <= 0 or partner.get("job_class") != "마법사":
        return None
    partner["rear_priority"] = True
    survive_atk_percent = params.get("survive_atk_percent")
    if survive_atk_percent:
        partner["rear_survive_atk_percent"] = survive_atk_percent
    detail = {"partner": partner["name"]}
    changes = [("own", partner, 0, 0, 0, 0, 1, 0)]
    return detail, changes


def _trait_death_heal_ally(caster, team, enemy_team, params):
    # 이영웅(히포크라테스 선서): 지금은 그냥 "장전"만 해둔다 - 실제 발동(회복)은 자신이 죽는 순간
    # _apply_death_triggers가 매 틱 감지해서 처리한다. 전투 시작 시점엔 아직 아무 일도 안 일어났으므로
    # 여기선 이벤트를 남기지 않는다.
    caster["death_heal_percent"] = params["percent"]
    return None


def _trait_conditional_stun_dr_ally_type(caster, team, enemy_team, params):
    # 방임석(방임): 지금은 설정만 해둔다 - 실제 판정(지속 기절 + 받는 피해 감소)은 조건(학생 타입 아군의
    # 생존 여부)이 전투 중 바뀔 수 있어서 매 틱 _apply_neglect_status가 다시 확인한다. 김어진(교권 보호)과
    # 동일하게 공격/방어 타입 둘 중 하나만 일치해도 "그 타입을 보유"한 것으로 취급한다.
    caster["neglect_config"] = {
        "ally_type": params["ally_type"],
        "dr_percent": params["dr_percent"],
        "paint_interval_seconds": params.get("paint_interval_seconds"),
    }
    return None


def _trait_type_attack_lifesteal(caster, team, enemy_team, params):
    # 윤(선생 고혈): 설정만 해둔다 - "지금 공격 대상이 이 타입인가"는 매 틱 갱신되는 상태(흡혈,
    # lifesteal_active)로 다뤄지고(battle_engine.py의 simulate_battle 메인 루프에서 resolved_target을
    # 구한 직후 판정 - neglect_active와 동일하게 상태가 바뀌는 순간만 이벤트를 남겨 프론트 아이콘을
    # 갱신한다), 실제 회복은 그 상태가 켜져 있는 동안 기본공격이 명중할 때마다 _do_basic_attack이
    # 처리한다. 김어진(team_teacher_hp_buff)/방임석(neglect_config)과 동일하게 공격/방어 타입 둘 중
    # 하나만 일치해도 "그 타입을 보유"한 것으로 취급한다.
    caster["lifesteal_config"] = {"type": params["type"], "heal_amount": params["amount"]}
    return None


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
    "type_attack_lifesteal": _trait_type_attack_lifesteal,
}


def _apply_battle_start_traits(team, enemy_team, events, side):
    enemy_side = "defender" if side == "attacker" else "attacker"
    for slot in ("front", "back"):
        unit = team[slot]
        if not unit or unit["hp"] <= 0 or not unit.get("trait_effect_type"):
            continue
        handler = TRAIT_EFFECT_HANDLERS.get(unit["trait_effect_type"])
        if not handler:
            continue
        result = handler(unit, team, enemy_team, unit["trait_params"])
        if result is None:
            continue
        detail, changes = result
        detail = dict(detail)
        change_dicts = build_stat_change_dicts(changes, side, enemy_side)
        if change_dicts:
            detail["changes"] = change_dicts
        events.append({
            "time": 0, "event_type": "trait_resolve", "side": side, "actor": unit["name"],
            "effect_type": unit["trait_effect_type"], "detail": detail,
        })
