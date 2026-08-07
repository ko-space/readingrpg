"""
PVP 전투 시뮬레이션 엔진.
기본공격 + 캐릭터별 스킬(기본공격 3회 시전 후, 공격 주기의 2배 시전시간으로 발동. 시전 중엔 기본공격 안 함) +
전투 시작 시 1회 판정되는 특성(팀 시너지)까지 포함한 버전.
DB에 의존하지 않는 순수 함수들로만 구성해서, 나중에 테스트하기 쉽게 해둠(개발자 테스트 창에서도 그대로 재사용).

star/trait/skill 이펙트 핸들러는 각각 star_handlers.py/trait_handlers.py/skill_handlers.py로 분리돼
있다(캐릭터가 늘어날수록 이 파일 하나가 끝없이 길어지는 걸 막기 위함 - 공용 기반 함수/상수는
battle_core.py). 이 파일은 그 셋을 조립해서 실제 턴 진행(simulate_battle)을 맡는 최상위 계층이다.
compute_unit_stats/build_team/simulate_battle은 routers/pvp.py·routers/devtest.py가 그대로
import해서 쓰므로(from battle_engine import ...) 분리 후에도 이 파일에서 이름이 그대로 보여야 한다.
"""
import random

from battle_core import (
    ARRIVAL_EPSILON, AXIS_ATTACKER_BACK, AXIS_ATTACKER_FRONT, AXIS_DEFENDER_BACK, AXIS_DEFENDER_FRONT,
    MAX_BATTLE_DURATION, SKILL_CAST_INTERVAL_MULTIPLIER, SKILL_TRIGGER_ATTACK_COUNT, SKILL_TYPE_CATEGORY,
    TICK, _alive_target, _alive_units, _all_slots, _apply_damage, _apply_gendered_damage_bonus,
    _apply_stun, _effective_gender, _effective_interval, _interrupt_cast_if_casting,
    _resolve_basic_attack_target, _roll_damage_atk, _select_basic_attack_target, _tag_target_sides,
    _team_alive, build_team, compute_unit_stats, get_type_multiplier,
)
from trait_handlers import _apply_battle_start_traits
from star_handlers import _apply_battle_start_star_effects
from skill_handlers import SKILL_EFFECT_HANDLERS


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

        # 윤: 기본공격 전용 자가 회복 두 종류 - kill_heal_percent(영혼 흡수, 처치 시 최대 체력 X% 회복)와
        # lifesteal_config(선생 고혈, "흡혈" 상태일 때 명중 시 고정량 회복)는 둘 다 star_mechanics/
        # trait_mechanics가 전투 시작 시 데이터 기반으로 심어두는 필드라, 캐릭터 이름과 무관하게 이
        # 필드를 가진 어떤 유닛에도 동일하게 적용된다(다른 캐릭터가 나중에 재사용해도 그대로 동작).
        # 흡혈은 lifesteal_active(simulate_battle 메인 루프가 매 틱 _update_lifesteal_status로 갱신 -
        # 지금 이 target과 완전히 같은 resolved_target 기준이라 항상 동기화돼 있다)로 판정한다 - 상태
        # 아이콘이 켜져 있는 동안만 회복되고, 대상이 바뀌어 흡혈이 꺼진 순간엔 회복되지 않는다.
        self_heal = 0
        kill_heal_percent = unit.get("kill_heal_percent")
        if kill_heal_percent and target["hp"] <= 0:
            self_heal += round(unit["max_hp"] * kill_heal_percent / 100)
        lifesteal_config = unit.get("lifesteal_config")
        if lifesteal_config and unit.get("lifesteal_active"):
            self_heal += lifesteal_config["heal_amount"]
        if self_heal:
            unit["hp"] = min(unit["max_hp"], unit["hp"] + self_heal)

        # 윤의 "호"(자폭 소환수): 이 기본공격이 명중하는 즉시 스스로 죽는다 - summon_clone의
        # clone_self_destruct 파라미터로 심어진 필드라, 캐릭터 이름과 무관하게 이 필드를 가진 어떤
        # 유닛에도 동일하게 적용된다. self_heal과 동시에 걸릴 일은 실제로 없지만(서로 다른 유닛
        # 전용 필드), 혹시 몰라 self_heal을 자폭이 무효화하지 않도록 자폭을 뒤에 적용한다.
        self_destructed = bool(unit.get("self_destruct_after_attack"))
        if self_destructed:
            unit["hp"] = 0

        actor_extra = {}
        if self_heal:
            actor_extra["actor_self_heal"] = self_heal
        if self_destructed:
            actor_extra["actor_self_destruct"] = True
        if actor_extra:
            actor_extra["actor_hp_after"] = unit["hp"]
            actor_extra["actor_max_hp"] = unit["max_hp"]

        events.append({
            "time": time_elapsed, "event_type": "basic_attack", "side": side, "type_multiplier": type_mult,
            "actor": unit["name"], "target": target["name"], "damage": dealt,
            "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "is_crit": is_crit,
            "target_stunned": bool(stun_seconds), "stun_seconds": stun_seconds,
            "interrupted_cast": interrupted_cast,
            **actor_extra,
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


def _apply_neglect_status(team, enemy_team, side, events, time_elapsed):
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

            # 방임이 풀리는 바로 그 틱에, 그동안 쌓아온 것을 곧바로 발동한다(정상적인 "기본공격 3회 ->
            # 시전 시작 -> 시전 시간 대기 -> 발동" 절차를 건너뜀). 방임 중엔 기절 때문에 기본공격
            # 자체를 할 수 없어 attack_count가 못 쌓이므로, 해제 직후에도 정상 절차를 새로 밟으려면
            # 3회를 다시 채워야 하는데, 그동안은 방어력 보너스도 이미 사라진 채로 무방비하게 노출된다 -
            # 그 위험한 공백을 없애기 위한 전용 트리거. neglect_config를 가진 유닛이면 캐릭터 이름과
            # 무관하게 항상 적용된다(데이터 기반 설계 유지).
            if unit.get("skill_effect_type") and not unit.get("is_clone"):
                handler = SKILL_EFFECT_HANDLERS.get(unit["skill_effect_type"])
                if handler:
                    detail = handler(unit, team, enemy_team, unit["skill_params"], time_elapsed)
                    detail = _tag_target_sides(detail, side, team, enemy_team)
                    # 프론트엔드가 이 발동엔 cast_start가 없었다는 걸 알고, 시전 포즈를 별도로
                    # 재생한 뒤에 효과를 보여주도록 표시만 남긴다(게임 로직에는 영향 없음).
                    detail["neglect_release_trigger"] = True
                    events.append({
                        "time": time_elapsed, "event_type": "skill_resolve", "side": side,
                        "actor": unit["name"], "effect_type": unit["skill_effect_type"], "detail": detail,
                    })
                    attacker_team, defender_team = (team, enemy_team) if side == "attacker" else (enemy_team, team)
                    used_effect_type = detail.get("copied_effect_type") or unit["skill_effect_type"]
                    _apply_paint_gain(unit, used_effect_type, attacker_team, defender_team, side, events, time_elapsed)
                    unit["is_casting"] = False
                    unit["cast_end_time"] = None
                    unit["attack_count"] = 0
                    unit["next_attack_time"] = max(unit["next_attack_time"], time_elapsed + _effective_interval(unit, time_elapsed))

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


def _update_lifesteal_status(unit, resolved_target, side, events, time_elapsed):
    """윤(선생 고혈): "지금 확정된 공격 대상"(resolved_target - simulate_battle 메인 루프가 매 틱
    _resolve_basic_attack_target로 갱신한 직후 바로 이 함수를 부른다)이 선생 타입이면(공격/방어
    상관없이) "흡혈" 상태가 켜진다. neglect_active와 동일한 이유로 매 틱 다시 판정해야 한다 - 대상이
    바뀌거나 죽으면 조건이 풀려야 하므로 한 번 켜지고 끝나는 게 아니다. 상태가 실제로 바뀐 순간에만
    이벤트를 남겨서 프론트가 그때만 아이콘을 갱신하면 되게 한다(neglect_status_resolve와 동일한 패턴).
    실제 회복 자체는 이 상태와 별개로 _do_basic_attack이 매 명중마다 lifesteal_active를 읽어 처리한다."""
    config = unit.get("lifesteal_config")
    if not config:
        return
    is_active = bool(
        resolved_target and resolved_target["hp"] > 0
        and (resolved_target.get("attack_type") == config["type"] or resolved_target.get("defense_type") == config["type"])
    )
    was_active = unit.get("lifesteal_active", False)
    unit["lifesteal_active"] = is_active
    if is_active != was_active:
        events.append({
            "time": time_elapsed, "event_type": "lifesteal_status_resolve", "side": side,
            "actor": unit["name"], "detail": {"active": is_active},
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
        _apply_neglect_status(attacker_team, defender_team, "attacker", events, time_elapsed)
        _apply_neglect_status(defender_team, attacker_team, "defender", events, time_elapsed)

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

                # 윤(선생 고혈): 공격 쿨다운/도착 게이트와 무관하게, "지금 확정된 공격 대상"이 바뀔
                # 때마다("잠긴" 상태라 매 틱 갱신은 아니지만 target_lock_resolve와 같은 빈도) 흡혈
                # 상태를 다시 판정한다 - 아직 공격 쿨다운이 안 찼거나 근접이 도착 전이어도 "그 대상을
                # 노리고 있다"는 상태 자체는 성립해야 하므로 아래의 이른 continue들보다 먼저 처리한다.
                _update_lifesteal_status(unit, resolved_target, side_name, events, time_elapsed)

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
