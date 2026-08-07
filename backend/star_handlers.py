"""
성급별 효과(star_effects) 핸들러 모음. battle_engine.py의 _apply_battle_start_star_effects가 전투
시작 시 1회 호출한다(characters.json의 star_effects 문구를 실제 전투 수치로 반영).
명명 규칙(star=passive)은 battle_core.py 상단 참고.
"""
from battle_core import CRIT_CHANCE, _alive_units, _effective_gender, _teammate

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

