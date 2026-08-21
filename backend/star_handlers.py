"""
성급별 효과(star_effects) 핸들러 모음. battle_engine.py의 _apply_battle_start_star_effects가 전투
시작 시 1회 호출한다(characters.json의 star_effects 문구를 실제 전투 수치로 반영).
명명 규칙(star=passive)은 battle_core.py 상단 참고.
"""
import random

from battle_core import CRIT_CHANCE, _alive_units, _effective_gender, _is_unit_moving, _teammate, build_stat_change_dicts

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


def _star_kill_heal_percent(unit, own_team, enemy_team, params):
    # 윤(영혼 흡수): "장전"만 해둔다 - 실제 판정(적 처치 시 회복)은 이 유닛이 기본공격으로 적을 처치할
    # 때마다 _do_basic_attack이 매번 감지해서 처리한다(_star_gain_paint_on_active_use와 같은 패턴).
    unit["kill_heal_percent"] = params["percent"]
    return []


def _star_grant_shield_to_strikers_percent_max_hp(unit, own_team, enemy_team, params):
    # 김크장(외국인 노동자): 서포터 본인은 전장에 없으므로 own_team의 "front"/"back"(스트라이커)에게만
    # 각자 자기 최대 체력 기준 percent%의 보호막을 준다 - _alive_units(own_team)을 쓰면 supporter는
    # 애초에 _all_slots에 없어 자동으로 빠지므로 따로 걸러낼 필요가 없다. 기존 self_shield_duration
    # (일정 시간 무적)과 달리 이건 "수치가 있는" 보호막이라 unit["shield"]에 직접 더한다(_apply_damage
    # 참고) - 매 성급마다 새로 전투가 시작될 때만 부여되므로 그냥 덮어쓰지 않고 더한다(다른 소스와
    # 중첩 가능하게, 지금은 서포터가 1명뿐이라 실질적으로는 항상 0에서 시작).
    percent = params["percent"]
    changes = []
    for striker in _alive_units(own_team):
        gain = round(striker["max_hp"] * percent / 100)
        striker["shield"] = striker.get("shield", 0) + gain
        # shield_sign(9번째 자리)=1 - build_stat_change_dicts가 이 신호 하나만으로도 이벤트를 실제로
        # 발생시키고, 그 시점의 striker["shield"](방금 갱신한 값)를 이벤트에 함께 실어보낸다. 그래야
        # 프론트가 이 유닛이 처음 맞기 전부터(전투 시작 시점부터) 보호막 바를 바로 그릴 수 있다.
        changes.append(("own", striker, 0, 0, 0, 0, 0, 0, 1))
    return changes


def _star_haste_boost_to_rear_striker(unit, own_team, enemy_team, params):
    # 김룡환(입술의 말): 서포터 본인은 전장에 없으므로(own_team[slot] 순회에도 안 잡힘) own_team의
    # "후방(back)" 슬롯에 실제로 배치된 스트라이커 본인에게(이름과 무관하게 누구든) 공격 속도를 준다.
    # _teammate()는 "캐스터 기준 다른 슬롯"을 찾는 함수라 캐스터가 서포터(_all_slots에 없음)면 안
    # 맞는다(_trait_teammate_haste_by_name과 동일한 이유) - back 슬롯을 이름과 무관하게 직접 조회한다.
    rear = own_team.get("back")
    if not rear or rear["hp"] <= 0:
        return []
    haste_percent = params["haste_percent"]
    rear["status"]["haste_percent"] += haste_percent
    return [("own", rear, 0, 0, 0, 0, 0, 1)]


def _star_shield_low_hp_striker_once(unit, own_team, enemy_team, params):
    # 배(개량한복): "장전"만 해둔다 - 실제 판정(아군 STRIKER 체력이 50% 미만으로 떨어지는 순간 무적 부여)은
    # own_team["low_hp_shield_config"]를 보고 매 틱 _apply_low_hp_shield_grant(battle_engine.py)가
    # 처리한다(_star_gain_paint_on_active_use와 같은 "장전 후 매 틱 감지" 패턴). 배 본인은 서포터라
    # own_team["front"]/["back"]에 없어(대상이 될 수 없어) 유닛이 아니라 팀 단위로 저장해둔다.
    own_team["low_hp_shield_config"] = {
        "seconds": params["seconds"],
        "once_per_striker": params.get("once_per_striker", False),
    }
    return []


def _star_ally_attack_splash_damage(unit, own_team, enemy_team, params):
    # 김국회(일당 독재): "장전"만 해둔다 - kill_heal_percent와 같은 패턴. 실제 판정(아군 STRIKER가
    # 기본공격할 때마다 공격 대상이 아닌 다른 적 전원에게 스플래시)은 이 필드를 가진 서포터가 own_team에
    # 있는지 _do_basic_attack이 매 기본공격마다 확인해서 처리한다. 수치 기준은 확인된 대로 "김국회
    # 자신의" 공격력이라, 여기서는 %만 저장해두고 실제 공격력은 발동 시점에 supporter["atk"]에서 읽는다.
    unit["ally_attack_splash_percent"] = params["percent"]
    return []


def _star_periodic_heal_random_striker(caster, own_team, enemy_team, params, time_elapsed):
    # 신(제 1 권한): 전투 시작 1회가 아니라 "N초마다" 반복되는 완전히 다른 성격의 성급 효과라
    # STAR_EFFECT_HANDLERS(battle_engine._apply_battle_start_star_effects가 t=0에 1회만 호출)가 아닌
    # PERIODIC_STAR_EFFECT_HANDLERS에 등록한다(battle_engine._tick_periodic_effects가 매 틱 간격을
    # 검사해서 호출) - 시그니처도 (caster, own_team, enemy_team, params, time_elapsed)로 skill 핸들러와
    # 동일하고, 반환값도 change 튜플 목록이 아니라 skill_resolve와 같은 단일 detail dict다. 캐스터
    # 자신(서포터)은 own_team["front"]/["back"]에 없으므로 대상 후보에서 저절로 제외된다.
    candidates = [u for u in (own_team.get("front"), own_team.get("back")) if u and u["hp"] > 0]
    if not candidates:
        return None
    target = random.choice(candidates)
    heal_percent = params["heal_percent"]
    # 뽑힌 대상이 아직 자기 기본공격 목표를 향해 이동 중이면(_is_unit_moving) 하트가 실제로 안 맞은
    # 것으로 치고 회복을 실패시킨다 - 이미 풀피라 healed=0인 경우(이벤트 자체를 안 남김)와 달리, 이건
    # "맞았으면 회복했을 텐데 이동 중이라 놓쳤다"는 걸 보여줘야 하므로 missed=True로 이벤트는 남긴다.
    if _is_unit_moving(target):
        return {
            "target": target["name"], "_target_ref": target,
            "healed": 0, "target_hp_after": target["hp"], "target_max_hp": target["max_hp"],
            "heal_percent": heal_percent, "missed": True,
        }
    healed = min(target["max_hp"] - target["hp"], round(target["max_hp"] * heal_percent / 100))
    if healed <= 0:
        return None  # 마침 뽑힌 대상이 이미 풀피면 회복량이 0 - 허공에 이펙트만 뜨는 걸 막기 위해 이벤트 자체를 안 남긴다
    target["hp"] += healed
    return {
        "target": target["name"], "_target_ref": target,
        "healed": healed, "target_hp_after": target["hp"], "target_max_hp": target["max_hp"],
        "heal_percent": heal_percent,
    }


PERIODIC_STAR_EFFECT_HANDLERS = {
    "periodic_heal_random_striker": _star_periodic_heal_random_striker,
}


STAR_EFFECT_HANDLERS = {
    "gain_paint_on_active_use": _star_gain_paint_on_active_use,
    "kill_heal_percent": _star_kill_heal_percent,
    "self_stat_percent": _star_self_stat_percent,
    "self_buff_enemy_debuff": _star_self_buff_enemy_debuff,
    "ally_team_stat_percent": _star_ally_team_stat_percent,
    "debuff_all_others_atk": _star_debuff_all_others_atk,
    "teammate_stat_percent": _star_teammate_stat_percent,
    "ally_gender_stat_percent": _star_ally_gender_stat_percent,
    "damage_to_gender_bonus": _star_damage_to_gender_bonus,
    "self_crit_multiplier": _star_self_crit_multiplier,
    "self_rear_priority": _star_self_rear_priority,
    "grant_shield_to_strikers_percent_max_hp": _star_grant_shield_to_strikers_percent_max_hp,
    "haste_boost_to_rear_striker": _star_haste_boost_to_rear_striker,
    "ally_attack_splash_damage": _star_ally_attack_splash_damage,
    "shield_low_hp_striker_once": _star_shield_low_hp_striker_once,
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
        # "supporter"도 포함한다 - 김크장류 지원가는 전장엔 없지만(_all_slots에 없음) [Passive]는
        # 정상적으로 발동해야 한다(예: 외국인 노동자가 스트라이커에게 보호막을 부여). ENABLE_SUPPORTER_SLOT이
        # False인 동안은 own_team["supporter"]가 항상 None이라 이 슬롯은 자동으로 그냥 건너뛴다.
        for slot in ("front", "back", "supporter"):
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
            # 나머지 핸들러는 그대로 4-튜플이라 이 신호들은 기본 0으로 취급된다(build_stat_change_dicts 참고 -
            # trait_handlers.py의 특성 효과와 형식을 공유한다).
            change_dicts = build_stat_change_dicts(changes, side_name, enemy_side)
            if change_dicts:
                events.append({
                    "time": 0, "event_type": "star_effect_resolve", "side": side_name,
                    "actor": unit["name"], "effect_type": unit["star_effect_type"],
                    "detail": {"changes": change_dicts},
                })

