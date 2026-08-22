"""
PVP 전투 시뮬레이션 엔진.
기본공격은 순수 쿨다운(공격 주기)마다 반복되고, [Active] 스킬은 팀 공유 코스트 풀이 그 캐릭터의
코스트만큼 쌓이면 전방->후방->서포터 순 라운드로빈으로 자동 발동한다(코스트제 - _tick_team_cost 참고,
공용 풀이 다 차 있어도 기절 등으로 발동 못 하면 그 턴만 건너뛰고 다음 카드로 넘어간다). 발동 시
공격 주기의 0.7배 시전시간(SKILL_CAST_INTERVAL_MULTIPLIER)이 있고, 시전 중엔 기본공격을 안 한다.
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
    COST_ROTATION_SLOTS, COST_SECONDS_PER_POINT_BY_ALIVE, MAX_BATTLE_DURATION,
    SKILL_CAST_INTERVAL_MULTIPLIER, SKILL_TYPE_CATEGORY, TEAM_COST_MAX, TEAM_COST_START,
    TICK, _alive_target, _alive_units, _all_slots, _apply_damage, _apply_gendered_damage_bonus,
    _apply_stun, _effective_gender, _effective_interval, _init_team_cost, _interrupt_cast_if_casting,
    _is_action_blocked, _maybe_grant_low_hp_shield, _refresh_status_until, _resolve_basic_attack_target, _roll_damage_atk,
    _select_basic_attack_target, _tag_target_sides, _team_alive, build_stat_change_dicts, build_team,
    compute_unit_stats, get_type_multiplier,
)
from trait_handlers import PERIODIC_TRAIT_EFFECT_HANDLERS, _apply_battle_start_traits
from star_handlers import PERIODIC_STAR_EFFECT_HANDLERS, _apply_battle_start_star_effects
from skill_handlers import SKILL_EFFECT_HANDLERS, SKILL_TARGET_AVAILABILITY_CHECKS


def _apply_supporter_stat_donation(team, side_name, events):
    """서포터(김크장류) 공통 규칙 - 캐릭터별 [Passive/Active/Special]과 달리 characters.json 데이터가
    아니라 "서포터"라는 역할 자체에 붙는 보편 규칙이라 여기 하드코딩한다. 서포터는 전장에 나서지 않는
    대신 자신의 공격력을 정확히 반으로 나눠(하드코딩된 "절반"이지 스트라이커 인원수로 다시 나누는 게
    아니다), 살아있는 스트라이커 각자에게 그 절반을 그대로 하나씩 준다 - 스트라이커가 2명이면 각자
    절반씩 받아 도합 서포터 공격력 전체가 분배되고, 1명뿐이면 그 1명만 절반을 받고 나머지 절반은
    받을 대상이 없어 그냥 버려진다. ATK는 percent 가산(atk_percent_bonus)만 있고 고정 수치 가산
    경로가 없어서, 나눠줄 절반값을 받는 쪽 자신의 공격력 대비 퍼센트로 환산해 적용한다."""
    supporter = team.get("supporter")
    if not supporter or supporter["hp"] <= 0:
        return
    strikers = [u for u in (team.get("front"), team.get("back")) if u and u["hp"] > 0]
    if not strikers:
        return
    half_atk = supporter["atk"] / 2
    enemy_side = "defender" if side_name == "attacker" else "attacker"
    for striker in strikers:
        if not striker["atk"]:
            continue
        percent = half_atk / striker["atk"] * 100
        striker["status"]["atk_percent_bonus"] += percent
        change_dicts = build_stat_change_dicts([("own", striker, 1, 0)], side_name, enemy_side)
        events.append({
            "time": 0, "event_type": "star_effect_resolve", "side": side_name,
            "actor": supporter["name"], "actor_slot": supporter.get("slot"),
            "effect_type": "supporter_stat_donation", "detail": {"changes": change_dicts},
        })


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


def _advance_type2_attack_count_and_maybe_revert(unit, side, own_team, time_elapsed, events):
    """이의진 type2(Parent) 상태에서 기본공격을 3회 사용하면 자동으로 [Active](self_type_swap_heal)를
    다시 시전해 type1로 돌아온다(확인된 요청) - type2 동안은 카드를 다시 눌러도 못 쓰므로
    (SKILL_TARGET_AVAILABILITY_CHECKS의 이의진 전용 판정 참고), type1로 돌아오는 유일한 경로다.
    코스트/카드 발동과 무관한 자동 발동이라 _tick_team_cost를 거치지 않고 여기서 직접
    is_casting/cast_end_time을 세팅해서 기존 시전 파이프라인(윈드업 애니메이션 -> skill_resolve에서
    핸들러 호출, battle_engine의 메인 루프 758행 부근)에 그대로 태운다 - 핸들러(_skill_self_type_swap_heal)
    자체는 방향과 무관하게 매번 토글+회복하므로 수정 없이 재사용된다. type2가 아니면(방금 type1 상태로
    기본공격했을 뿐이면) 아무 일도 하지 않는다. 기본공격이 진행 중인 시전을 시작하는 일은 없다 -
    시전 중인 유닛은 애초에 이 함수 호출 지점(_do_basic_attack)까지 도달하지 않는다(메인 루프가
    is_casting이면 기본공격 단계 전에 continue)."""
    if not unit.get("type2_stun_seconds"):
        return
    unit["type2_attack_count"] = unit.get("type2_attack_count", 0) + 1
    if unit["type2_attack_count"] < 3:
        return
    unit["type2_attack_count"] = 0

    interval = _effective_interval(unit, time_elapsed)
    unit["is_casting"] = True
    unit["cast_end_time"] = time_elapsed + SKILL_CAST_INTERVAL_MULTIPLIER * interval
    events.append({
        "time": time_elapsed, "event_type": "cast_start", "side": side,
        "actor": unit["name"], "actor_slot": unit.get("slot"),
        "effect_type": unit["skill_effect_type"],
        "duration": SKILL_CAST_INTERVAL_MULTIPLIER * interval,
        # 코스트를 소모하는 진짜 발동이 아니므로 코스트 관련 필드는 전부 비워둔다 - 프론트가
        # cost_pool이 null이면 게이지 갱신/카드 반짝임을 그냥 건너뛴다(shared/battle-renderer.js).
        "cost_spent": 0, "cost_pool": None, "next_slot": None,
    })


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
    _advance_type2_attack_count_and_maybe_revert(unit, side, own_team, time_elapsed, events)
    if unit["name"] == "김남옥" and unit.get("star", 1) >= 3:
        for i, target in enumerate(targets):
            mult = 1.0 if i == 0 else 0.25
            type_mult = get_type_multiplier(unit["attack_type"], target["defense_type"])
            atk, is_crit = _roll_damage_atk(unit, time_elapsed)
            damage = atk * mult * type_mult
            damage = _apply_gendered_damage_bonus(unit, target, damage)
            dealt, raw_dealt = _apply_damage(target, damage, time_elapsed)
            # 배 "개량한복": 이 피해로 target이 막 체력 50% 미만이 됐으면(그리고 target 소속 팀에
            # low_hp_shield_config가 걸려있으면) 그 즉시(이 타격 이벤트 자체에 실어서) 무적을 부여한다 -
            # battle_engine._apply_low_hp_shield_grant(매 틱 스윕)를 그대로 두면 다음 틱에야 감지돼서,
            # 프론트가 이 공격의 실제 착탄 연출(윈드업/투사체 이동)보다 무적 아이콘을 먼저 띄워버리는
            # 버그가 있었다 - 이 타격의 착탄 콜백에서 곧바로 함께 재생하도록 여기서 직접 판정한다.
            low_hp_shield_seconds = _maybe_grant_low_hp_shield(target, enemy_team, time_elapsed)
            stun_seconds, interrupted_cast = _apply_type2_stun_if_active(unit, target, time_elapsed)
            events.append({
                "time": time_elapsed, "event_type": "basic_attack", "side": side, "type_multiplier": type_mult,
                "actor": unit["name"], "actor_slot": unit.get("slot"), "target": target["name"], "damage": dealt,
                "shown_damage": raw_dealt,
                "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "target_shield_after": target.get("shield", 0),
                "is_crit": is_crit,
                "target_stunned": bool(stun_seconds), "stun_seconds": stun_seconds,
                "interrupted_cast": interrupted_cast,
                "low_hp_shield_seconds": low_hp_shield_seconds,
            })
        # 김남옥은 이미 적 전원을 직접 타격했으므로(주대상 100%+나머지 25%), "공격 대상이 아닌 다른 적"이
        # 남지 않아 아래 훅을 호출해도 자연히 빈 스플래시가 된다 - 그래도 일관성을 위해 그대로 호출한다.
        _apply_ally_attack_splash(unit, side, own_team, enemy_team, {id(t) for t in targets}, time_elapsed, events)
    else:
        target = resolved_target if resolved_target is not None else _select_basic_attack_target(unit, enemy_team)
        if target is None:
            return
        type_mult = get_type_multiplier(unit["attack_type"], target["defense_type"])
        bullet_hits = None
        if unit["name"] == "이종복":
            # "F=ma" 4글자 탄환 연출 - 탄환 하나하나가 사실상 독립된 공격이라, 크리티컬도 탄환마다
            # 따로 굴린다(_roll_damage_atk를 4번 호출 - 매번 독립적으로 크리 확률을 판정). 상성
            # 배율(type_mult)만 공격 전체에 공통으로 적용하고, 각 탄환 몫(전체 공격력의 1/4)에
            # 그 탄환 자신의 크리 여부를 곱해 _apply_damage로 실제 적용한다. 방임/실드의 감소·반올림도
            # 탄환마다 독립적으로 적용된 결과의 합이 총 대미지가 된다. 로그의 "치명타!" 표시는 4발 중
            # 하나라도 크리가 있었으면 뜨고(아래 is_crit=any_crit), 화면의 착탄 이펙트는 각 탄환이
            # 자기 크리 여부에 맞는 색으로 따로 반짝인다(arena-battle.js의 basic_attack 분기 참고).
            BULLET_COUNT = 4
            bullet_hits = []
            dealt = 0
            raw_dealt = 0
            any_crit = False
            for _ in range(BULLET_COUNT):
                bullet_atk, bullet_is_crit = _roll_damage_atk(unit, time_elapsed)
                bullet_damage = (bullet_atk / BULLET_COUNT) * type_mult
                bullet_damage = _apply_gendered_damage_bonus(unit, target, bullet_damage)
                bullet_dealt, bullet_raw_dealt = _apply_damage(target, bullet_damage, time_elapsed)
                dealt += bullet_dealt
                raw_dealt += bullet_raw_dealt
                # 배 "개량한복" - 4탄환 중 정확히 어느 탄환이 target을 50% 미만으로 떨어뜨렸는지가
                # 중요하다(그 탄환 자신의 착탄 콜백에서 무적 이펙트를 함께 재생해야 하므로), 그래서
                # bullet_hits마다(top-level이 아니라) 개별적으로 판정해 붙인다.
                bullet_low_hp_shield_seconds = _maybe_grant_low_hp_shield(target, enemy_team, time_elapsed)
                bullet_hits.append({
                    "damage": bullet_dealt, "shown_damage": bullet_raw_dealt,
                    "target_hp_after": target["hp"], "target_shield_after": target.get("shield", 0), "is_crit": bullet_is_crit,
                    "low_hp_shield_seconds": bullet_low_hp_shield_seconds,
                })
                any_crit = any_crit or bullet_is_crit
            is_crit = any_crit
            low_hp_shield_seconds = None  # 이미 위에서 탄환별로 붙였으므로 top-level에는 안 실어보낸다.
        else:
            atk, is_crit = _roll_damage_atk(unit, time_elapsed)
            damage = atk * type_mult
            damage = _apply_gendered_damage_bonus(unit, target, damage)
            dealt, raw_dealt = _apply_damage(target, damage, time_elapsed)
            low_hp_shield_seconds = _maybe_grant_low_hp_shield(target, enemy_team, time_elapsed)
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
        if bullet_hits is not None:
            actor_extra["bullet_hits"] = bullet_hits

        events.append({
            "time": time_elapsed, "event_type": "basic_attack", "side": side, "type_multiplier": type_mult,
            "actor": unit["name"], "actor_slot": unit.get("slot"), "target": target["name"], "damage": dealt,
            "shown_damage": raw_dealt,
            "target_hp_after": target["hp"], "target_max_hp": target["max_hp"], "target_shield_after": target.get("shield", 0),
            "is_crit": is_crit,
            "target_stunned": bool(stun_seconds), "stun_seconds": stun_seconds,
            "interrupted_cast": interrupted_cast,
            "low_hp_shield_seconds": low_hp_shield_seconds,
            **actor_extra,
        })
        _apply_ally_attack_splash(unit, side, own_team, enemy_team, {id(target)}, time_elapsed, events)


def _apply_ally_attack_splash(attacker_unit, side, own_team, enemy_team, hit_target_ids, time_elapsed, events):
    """김국회(일당 독재): own_team의 서포터가 이 패시브를 설치해뒀으면(star_mechanics가 전투 시작 시
    1회 심어둔 ally_attack_splash_percent - _star_ally_attack_splash_damage 참고), 아군 STRIKER의
    기본공격이 방금 실제로 맞힌 대상(hit_target_ids - 유닛 dict는 해시 불가라 id() 집합으로 비교)을
    제외한 나머지 적 전원에게 "서포터 자신의" 공격력 기준 스플래시 피해를 추가로 입힌다(확인된 설계 -
    공격한 아군 본인이 아니라 항상 김국회 고정 수치). 서포터 본인은 기본공격을 하지 않으므로
    attacker_unit이 서포터 자신일 일은 없다."""
    supporter = own_team.get("supporter")
    percent = supporter.get("ally_attack_splash_percent") if supporter else None
    if not percent or supporter["hp"] <= 0:
        return
    hits = []
    for enemy in _alive_units(enemy_team):
        if id(enemy) in hit_target_ids:
            continue
        type_mult = get_type_multiplier(supporter["attack_type"], enemy["defense_type"])
        atk, is_crit = _roll_damage_atk(supporter, time_elapsed)
        damage = atk * percent / 100 * type_mult
        dealt, raw_dealt = _apply_damage(enemy, damage, time_elapsed)
        low_hp_shield_seconds = _maybe_grant_low_hp_shield(enemy, enemy_team, time_elapsed)
        hits.append({
            "target": enemy["name"], "_target_ref": enemy, "damage": dealt, "shown_damage": raw_dealt,
            "target_hp_after": enemy["hp"], "target_max_hp": enemy["max_hp"],
            "is_crit": is_crit, "type_multiplier": type_mult,
            "low_hp_shield_seconds": low_hp_shield_seconds,
        })
    if not hits:
        return
    detail = _tag_target_sides({"hits": hits, "source_actor": attacker_unit["name"]}, side, own_team, enemy_team)
    events.append({
        "time": time_elapsed, "event_type": "ally_attack_splash_resolve", "side": side,
        "actor": supporter["name"], "actor_slot": supporter.get("slot"), "effect_type": "ally_attack_splash_damage",
        "detail": detail,
    })


def _apply_death_triggers(team, side, events, time_elapsed):
    """이영웅(히포크라테스 선서): 사망 시 1회 아군 전체에게 보호막을 부여하는 것처럼(확인된 요청 -
    원래는 회복이었음, 수치는 그대로), "죽는 순간" 발동하는 효과 전용 훅. 매 틱마다 각 팀을 훑어서
    "죽었는데 아직 트리거 안 한" 유닛을 찾아 1회만 발동한다 - 사망은 여러 곳(기본공격/각종 스킬)에서
    일어날 수 있어 그 모든 지점에 훅을 심는 대신, 여기 한 곳에서 "죽어 있음" 상태만 감지한다(최대
    1틱=0.05초 지연이지만 체감상 차이 없음)."""
    for slot in ("front", "back", "summon_front", "summon_back"):
        unit = team[slot]
        if not unit or unit["hp"] > 0 or not unit.get("death_heal_percent") or unit.get("_death_triggered"):
            continue
        unit["_death_triggered"] = True
        shield_base = unit["max_hp"]
        shield_percent = unit["death_heal_percent"]
        shields = []
        for ally in _alive_units(team):
            gain = round(shield_base * shield_percent / 100)
            ally["shield"] = ally.get("shield", 0) + gain
            shields.append({
                "target": ally["name"], "amount": gain,
                "target_hp_after": ally["hp"], "target_max_hp": ally["max_hp"],
                "target_shield_after": ally["shield"],
            })
        if shields:
            events.append({
                "time": time_elapsed, "event_type": "death_trigger_resolve", "side": side,
                "actor": unit["name"], "actor_slot": unit.get("slot"), "effect_type": "death_heal_ally",
                "detail": {"shields": shields},
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
        # 김어진/김룡환(team_type_hp_buff)과 동일한 규칙 - 공격/방어 타입 중 하나만 일치해도 그 타입을
        # "보유"한 것으로 취급한다.
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
                "actor": unit["name"], "actor_slot": unit.get("slot"), "detail": {"active": True, "interrupted_cast": interrupted},
            })
        elif not has_qualifying_ally and was_active:
            events.append({
                "time": time_elapsed, "event_type": "neglect_status_resolve", "side": side,
                "actor": unit["name"], "actor_slot": unit.get("slot"), "detail": {"active": False},
            })
            # 확정된 설계 변경: 방임이 풀리는 순간 코스트/로테이션을 건너뛰고 즉시 발동시키던 특수
            # 트리거를 없앴다 - 이제 방임이 풀리면 그냥 _is_action_blocked가 False로 돌아갈 뿐이고,
            # 실제 발동은 다른 캐릭터와 완전히 동일하게 _tick_team_cost의 정상 로테이션(자기 차례가
            # 됐고 공용 코스트가 카드 값 이상 찼을 때)을 거쳐야 한다.

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
                    "actor": unit["name"], "actor_slot": unit.get("slot"),
                    "detail": {"color": color, "amount": 1, "total": unit["status"][paint_key], "source_actor": unit["name"]},
                })


def _apply_low_hp_shield_grant(team, side, events, time_elapsed):
    """배(개량한복): 아군 STRIKER(front/back/복제체) 체력이 최대 체력의 50% 미만으로 "떨어지는 그 순간"
    무적(shield_until)을 부여한다. death_heal_ally처럼 조건이 한 번 성립하고 끝나는 원샷이지만, 대상이
    캐스터 자신이 아니라 "그 순간 조건을 만족하는 임의의 아군"이라 캐스터 유닛이 아니라 팀 단위로
    설정을 저장해둔다(_star_shield_low_hp_striker_once가 own_team["low_hp_shield_config"]에 심어둠 -
    배 본인은 서포터라 own_team["front"]/["back"]에 없다). 기본 티어(once_per_striker=False)는 팀
    전체에서 딱 1번만(먼저 조건을 채운 스트라이커 한 명에게만), 6성 "+"(once_per_striker=True)는
    STRIKER별로 각자 1번씩 받을 수 있다."""
    config = team.get("low_hp_shield_config")
    if not config:
        return
    once_per_striker = config["once_per_striker"]
    if not once_per_striker and team.get("_low_hp_shield_used_once"):
        return
    for unit in _alive_units(team):
        if unit["hp"] / unit["max_hp"] >= 0.5:
            continue
        if once_per_striker:
            if unit.get("_low_hp_shield_used"):
                continue
            unit["_low_hp_shield_used"] = True
        else:
            team["_low_hp_shield_used_once"] = True
        seconds = config["seconds"]
        _refresh_status_until(unit["status"], "shield_until", time_elapsed + seconds, time_elapsed)
        events.append({
            "time": time_elapsed, "event_type": "low_hp_shield_resolve", "side": side,
            "actor": unit["name"], "actor_slot": unit.get("slot"),
            "detail": {"seconds": seconds},
        })
        if not once_per_striker:
            break


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
            "actor": unit["name"], "actor_slot": unit.get("slot"), "detail": {"active": is_active},
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
                    "actor": unit["name"], "actor_slot": unit.get("slot"),
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
    """전투 시작 시점에 홈 좌표를 부여한다 - front/back이 주 대상이고(복제체는 아직 없음, 소환될 때
    _skill_summon_clone에서 caster 기준으로 채워짐), 원거리 유닛도 이 좌표를 갖되 이후 아무도
    갱신하지 않으므로 사실상 고정값이 된다. 서포터는 position 자체는 안 쓰지만(전장에 없음),
    is_attacker_team만은 필요하다 - 김룡환(positional_bomb_line)처럼 "적진 방향"이 상대적으로
    정해지는 스킬이 자기가 공격/수비 어느 편인지 알아야 하기 때문(_skill_positional_bomb_line 참고).
    이 필드가 없으면(None) 항상 공격자 방향으로만 발사돼서, 수비 조력자로 편성됐을 때 방향이
    거꾸로(자기 편을 쏘는 식으로) 나가는 버그가 있었다."""
    for slot in ("front", "back", "supporter"):
        unit = team.get(slot)
        if not unit:
            continue
        unit["is_attacker_team"] = is_attacker
        if slot != "supporter":
            unit["position"] = _home_position(is_attacker, slot)
            unit["position_settled_at"] = 0.0  # battle_core._exposure_sort_key의 동률 타이브레이커용


def _advance_melee_position(unit, target_position, tick, time_elapsed):
    """근접 유닛의 position을 target_position 쪽으로 최대 melee_speed*tick만큼 옮긴다. 매 틱 현재
    position에서 다시 거리를 계산하므로(누적 오차 없음), 도착 조건을 만족하면 정확히 target_position으로
    스냅한다 - 그래야 부동소수 오차가 여러 틱에 걸쳐 쌓이지 않는다.
    position이 실제로 바뀔 때마다 position_settled_at을 지금 시각으로 갱신한다(battle_core.
    _exposure_sort_key 참고) - 노출도가 우연히 같아지는 순간(예: 넉백당한 유닛이 다시 걸어와 자기
    복제체와 거의 같은 좌표로 수렴)에 "더 늦게 그 자리에 도착한 쪽"이 후방으로 판정되게 하기 위함."""
    delta = target_position - unit["position"]
    if abs(delta) <= ARRIVAL_EPSILON:
        if unit["position"] != target_position:
            unit["position"] = target_position
            unit["position_settled_at"] = time_elapsed
        return
    step = unit["melee_speed"] * tick
    if abs(delta) <= step:
        unit["position"] = target_position
    else:
        unit["position"] += step if delta > 0 else -step
    unit["position_settled_at"] = time_elapsed


def _cost_rotation_units(team):
    """코스트 라운드로빈에 참여하는 (인덱스, 유닛) 목록 - 살아있고 [Active]를 실제로 가진(skill_cost가
    있는) 유닛만. ★1~3은 skill_cost가 None이라 자동으로 빠지고, 복제체는 애초에 summon_* 슬롯이라
    COST_ROTATION_SLOTS(front/back/supporter)에 없다. 서포터 슬롯은 아직 로스터에 존재하지 않아
    team.get("supporter")가 항상 None을 줘서 자동으로 제외된다."""
    return [
        (i, unit)
        for i, slot in enumerate(COST_ROTATION_SLOTS)
        for unit in (team.get(slot),)
        if unit is not None and unit["hp"] > 0 and unit.get("skill_cost")
    ]


def _current_cost_turn(team, roster):
    """cost_turn_index가 가리키는 자리부터 앞으로(끝나면 처음으로 되감아) 첫 번째 유효 카드를 찾는다.
    죽었거나 [Active]가 없는 슬롯은 로테이션에서 통째로 빠지므로 - 예를 들어 전방만 살아있으면 전방이
    계속 자기 차례를 가져간다(라운드로빈이 자동으로 1인 반복이 됨)."""
    idx = team["cost_turn_index"]
    for i, unit in roster:
        if i >= idx:
            return i, unit
    return roster[0]


def _advance_cost_turn(team, current_i):
    team["cost_turn_index"] = (current_i + 1) % len(COST_ROTATION_SLOTS)


SKILL_CARD_COOLDOWN_SECONDS = 1.5  # 스킬카드 연속 사용 방지 - 발동 직후 이 시간 동안은 CC와 동일하게 스킵


def _tick_team_cost(team, enemy_team, side_name, time_elapsed, events, manual_cost_gate=None):
    """팀 공유 코스트를 이번 틱만큼 채우고, 지금 차례인 스킬카드가 발동 가능하면 발동시킨다. 유닛별
    기본공격 루프와 완전히 분리된, 팀당 1회 호출되는 단계다(메인 루프에서 그 팀의 슬롯 순회보다
    먼저 호출됨).
    manual_cost_gate(side_name, unit)가 주어지면(실시간 (1v1) 친선전 전용), 자격 검사(코스트/CC/쿨다운/
    대상 유무)를 모두 통과한 뒤 실제 발동 직전에 이걸 한 번 더 물어봐서 False면 이번 틱은 그냥 대기한다
    (코스트도 포인터도 그대로 유지 - 다음 틱에 다시 물어봄). None이면(기존 전술대회/devtest 두 호출부)
    완전히 기존과 동일하게 자격만 되면 즉시 발동한다."""
    roster = _cost_rotation_units(team)

    seconds_per_point = COST_SECONDS_PER_POINT_BY_ALIVE.get(len(roster))
    if seconds_per_point != team["cost_seconds_per_point"]:
        team["cost_seconds_per_point"] = seconds_per_point
        events.append({
            "time": time_elapsed, "event_type": "cost_rate_change", "side": side_name,
            "cost_pool": round(team["cost"], 3),
            "seconds_per_point": seconds_per_point,
            "alive_skill_count": len(roster),
        })
    if seconds_per_point:
        team["cost"] = min(TEAM_COST_MAX, team["cost"] + TICK / seconds_per_point)

    if not roster:
        return

    current_i, unit = _current_cost_turn(team, roster)

    # 그 카드가 아직 시전 중이면(시전 시간이 길고 로테이션이 짧아 한 바퀴 만에 자기 차례가 돌아온
    # 경우) 이번 틱은 아무것도 하지 않고 기다린다 - 포인터도 그대로 둔다.
    if unit["is_casting"]:
        return

    cost = unit["skill_cost"]
    if team["cost"] < cost:
        return  # 코스트 부족 - 대기(포인터 유지)

    if _is_action_blocked(unit, time_elapsed):
        # 확정된 설계: 코스트를 아껴두고 나중에 이 카드로 돌아오는 게 아니라, 이 카드의 차례 자체를
        # 버리고 다음 카드로 넘어간다. 코스트는 차감하지 않는다.
        events.append({
            "time": time_elapsed, "event_type": "cost_turn_skip", "side": side_name,
            "actor": unit["name"], "actor_slot": unit.get("slot"),
            "card_cost": cost, "cost_pool": round(team["cost"], 3),
            "reason": "neglect" if unit.get("neglect_active") else "stun",
            "next_slot": COST_ROTATION_SLOTS[(current_i + 1) % len(COST_ROTATION_SLOTS)],
        })
        _advance_cost_turn(team, current_i)
        return

    last_cast = unit.get("_last_cast_time")
    if last_cast is not None and time_elapsed - last_cast < SKILL_CARD_COOLDOWN_SECONDS:
        # 확정된 설계: 스킬카드를 연속으로 못 쓰게, 발동 직후(_last_cast_time - skill_resolve 완료
        # 시점에 찍힘) SKILL_CARD_COOLDOWN_SECONDS 동안은 CC(기절 등)와 완전히 동일하게 그 턴만
        # 건너뛴다(코스트 미차감, 다음 카드로만 진행) - _is_action_blocked와 별개의 독립된 게이트라
        # 실제 CC 상태가 아니어도 적용되고, 프론트는 동일한 "is-blocked" UI로 표시한다.
        events.append({
            "time": time_elapsed, "event_type": "cost_turn_skip", "side": side_name,
            "actor": unit["name"], "actor_slot": unit.get("slot"),
            "card_cost": cost, "cost_pool": round(team["cost"], 3),
            "reason": "cooldown",
            "next_slot": COST_ROTATION_SLOTS[(current_i + 1) % len(COST_ROTATION_SLOTS)],
        })
        _advance_cost_turn(team, current_i)
        return

    availability_check = SKILL_TARGET_AVAILABILITY_CHECKS.get(unit.get("skill_effect_type"))
    if availability_check and not availability_check(unit, team, enemy_team):
        # 신(제 2 권한)처럼 "쓸 수는 있지만 지금은 대상이 없는"(부활시킬 죽은 아군이 없음) 경우 -
        # 사용자가 명시적으로 "CC로 못 쓰는 상황과 동일하게 스킵"을 요구했으므로, 위 CC 스킵과 완전히
        # 같은 처리(코스트 미차감, 다음 카드로만 진행)를 그대로 재사용한다.
        events.append({
            "time": time_elapsed, "event_type": "cost_turn_skip", "side": side_name,
            "actor": unit["name"], "actor_slot": unit.get("slot"),
            "card_cost": cost, "cost_pool": round(team["cost"], 3),
            "reason": "no_target",
            "next_slot": COST_ROTATION_SLOTS[(current_i + 1) % len(COST_ROTATION_SLOTS)],
        })
        _advance_cost_turn(team, current_i)
        return

    # CC(기절 등)가 오래 지속되는 동안엔 코스트 풀이 막힘과 무관하게 계속 차서(위 seconds_per_point
    # 충전은 _is_action_blocked와 별개) 3~4배 넘게 쌓일 수 있다 - 그 상태로 막힘이 풀리면, 남은 풀이
    # 카드 코스트를 여러 번 감당할 만큼 넘쳐서 매 틱(0.05초)마다 카드가 하나씩 연달아 발동해버려
    # "카드 두 장이 사실상 동시에 터지는" 것처럼 보인다 - 필살기형 설계 의도(카드 한 장이 확실히 화면에
    # 자리잡고 재생될 시간)가 깨진다. 이 팀에서 마지막으로 무언가 발동한 시점 기준으로도(카드 종류
    # 무관, 공유) SKILL_CARD_COOLDOWN_SECONDS만큼은 다음 발동을 미룬다 - 풀은 그대로 쌓인 채 대기만
    # 하므로 코스트가 사라지지 않고, 다음 카드도 결국은 반드시 발동한다.
    last_team_cast = team.get("_last_cast_time")
    if last_team_cast is not None and time_elapsed - last_team_cast < SKILL_CARD_COOLDOWN_SECONDS:
        return

    if manual_cost_gate and not manual_cost_gate(side_name, unit):
        return  # (1v1) 친선전 수동 발동 대기 - 코스트/포인터 유지, 다음 틱에 다시 물어봄

    # ── 발동: 기존 cast_start -> (SKILL_CAST_INTERVAL_MULTIPLIER * interval) -> skill_resolve 절차는
    #        한 글자도 바뀌지 않는다. 바뀐 건 "언제 시작하는가"뿐이다. ──
    team["cost"] -= cost
    team["_last_cast_time"] = time_elapsed
    _advance_cost_turn(team, current_i)

    interval = _effective_interval(unit, time_elapsed)
    unit["is_casting"] = True
    unit["cast_end_time"] = time_elapsed + SKILL_CAST_INTERVAL_MULTIPLIER * interval
    events.append({
        "time": time_elapsed, "event_type": "cast_start", "side": side_name,
        "actor": unit["name"], "actor_slot": unit.get("slot"),
        "effect_type": unit["skill_effect_type"],
        "duration": SKILL_CAST_INTERVAL_MULTIPLIER * interval,
        # ── 코스트 관련 필드(신규) - 프론트 게이지가 이 이벤트 하나로 소모까지 반영한다 ──
        "cost_spent": cost,
        "cost_pool": round(team["cost"], 3),
        "next_slot": COST_ROTATION_SLOTS[team["cost_turn_index"]],
    })


def _tick_one_periodic_effect(unit, kind, handlers, own_team, enemy_team, side_name, time_elapsed, events):
    """kind는 "star"|"trait" - 각각 star_effect_type/star_params, trait_effect_type/trait_params를
    읽는다. 전투 시작 1회만 적용되는 STAR_EFFECT_HANDLERS/TRAIT_EFFECT_HANDLERS(_apply_battle_start_*)와
    달리, params에 "interval_seconds"가 있는 효과만 여기서 매 틱 간격을 검사해 반복 발동시킨다(신처럼
    "N초마다" 지속 발동하는 극소수 효과 전용 - 대부분의 캐릭터는 이 키가 아예 없어 조용히 지나간다)."""
    effect_type = unit.get(f"{kind}_effect_type")
    params = unit.get(f"{kind}_params")
    interval = params.get("interval_seconds") if params else None
    if not effect_type or not interval:
        return
    handler = handlers.get(effect_type)
    if not handler:
        return
    last_key = f"_{kind}_periodic_last_time"
    last = unit.get(last_key, 0.0)
    if time_elapsed - last < interval:
        return
    unit[last_key] = time_elapsed
    detail = handler(unit, own_team, enemy_team, params, time_elapsed)
    if detail is None:
        return
    detail = _tag_target_sides(detail, side_name, own_team, enemy_team)
    events.append({
        "time": time_elapsed, "event_type": f"periodic_{kind}_resolve", "side": side_name,
        "actor": unit["name"], "actor_slot": unit.get("slot"), "effect_type": effect_type, "detail": detail,
    })


def _tick_periodic_effects(team, enemy_team, side_name, time_elapsed, events):
    """_tick_team_cost와 마찬가지로 팀당 1회, 유닛별 기본공격 루프와 분리된 단계 - front/back/supporter
    전부 검사한다(신 본인은 supporter라 이 셋 중 supporter로만 걸리지만, 캐릭터 이름을 하드코딩하지
    않고 일반적으로 순회한다)."""
    for slot in ("front", "back", "supporter"):
        unit = team.get(slot)
        if not unit or unit["hp"] <= 0:
            continue
        _tick_one_periodic_effect(unit, "star", PERIODIC_STAR_EFFECT_HANDLERS, team, enemy_team, side_name, time_elapsed, events)
        _tick_one_periodic_effect(unit, "trait", PERIODIC_TRAIT_EFFECT_HANDLERS, team, enemy_team, side_name, time_elapsed, events)


def _expire_timed_summons(team, side_name, time_elapsed, events):
    """김국회 "국회의사당"처럼 일정 시간 뒤 자동으로 사라지는 소환수 전용(다른 소환수(윤영준류)는
    expire_at이 아예 없어 죽을 때까지 유지되는 기존 동작 그대로) - summon_front/summon_back만 대상."""
    for slot in ("summon_front", "summon_back"):
        unit = team.get(slot)
        if unit and unit["hp"] > 0 and unit.get("expire_at") is not None and time_elapsed >= unit["expire_at"]:
            unit["hp"] = 0
            events.append({
                "time": time_elapsed, "event_type": "summon_expire_resolve", "side": side_name,
                "actor": unit["name"], "actor_slot": unit.get("slot"), "detail": {},
            })


def _simulate_tick(attacker_team, defender_team, tick_index, time_elapsed, events, manual_cost_gate=None):
    """전투 한 틱(TICK초)을 처리하고 갱신된 time_elapsed를 반환한다. simulate_battle의 기존 while
    루프 본문을 그대로 옮긴 것 - "언제 부르는가"(동기 while 루프 vs (1v1) 친선전의 실시간 asyncio
    루프)만 바뀌고, 틱 하나가 하는 일 자체는 완전히 동일하다.
    manual_cost_gate는 _tick_team_cost로 그대로 전달된다(친선전 수동 발동용 - None이면 기존과 동일)."""
    time_elapsed = round(time_elapsed + TICK, 2)

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
    _apply_low_hp_shield_grant(attacker_team, "attacker", events, time_elapsed)
    _apply_low_hp_shield_grant(defender_team, "defender", events, time_elapsed)
    _expire_timed_summons(attacker_team, "attacker", time_elapsed, events)
    _expire_timed_summons(defender_team, "defender", time_elapsed, events)

    # 두 팀의 next_attack_time이나 코스트 발동 타이밍이 정확히 같은 틱에 겹치면(대칭 스탯 등), 항상
    # 공격자 팀을 먼저 처리하는 고정 순서 때문에 그런 "동시 타이밍" 상황마다 매번 공격자만 먼저
    # 행동하는 구조적 편향이 있었다. 틱 인덱스 홀짝으로 두 팀의 처리 순서를 번갈아 뒤집어서, 여러
    # 틱에 걸쳐 보면 어느 한쪽만 계속 먼저 행동하는 일이 없게 한다.
    team_order = (
        ("attacker", attacker_team, defender_team),
        ("defender", defender_team, attacker_team),
    )
    if tick_index % 2 == 0:
        team_order = tuple(reversed(team_order))

    for side_name, own_team, enemy_team in team_order:
        _tick_team_cost(own_team, enemy_team, side_name, time_elapsed, events, manual_cost_gate)
        _tick_periodic_effects(own_team, enemy_team, side_name, time_elapsed, events)

        # 서포터(김크장/김룡환류)의 [Active] 시전 완료 판정 - _tick_team_cost가 COST_ROTATION_SLOTS에
        # "supporter"를 포함하므로 cast_start는 정상적으로 발생하는데, 정작 그 시전을 완료(skill_resolve)
        # 시키는 판정은 원래 아래 for-slot 루프 안(front/back/summon_front/summon_back 전용)에만
        # 있어서 서포터는 대상이 아니었다 - 그러면 서포터의 [Active]는 영원히 "시전 중" 상태에 갇혀
        # 절대 발동하지 않는다. 서포터는 기본공격/이동/피격이 아예 없는 존재라 그 아래 루프의 나머지
        # 로직(타겟팅·이동·공격 쿨다운)에는 애초에 끼워 넣으면 안 되므로, 이 시전 완료 판정만 똑같이
        # 복제해서 별도로 처리한다.
        supporter = own_team.get("supporter")
        if supporter is not None and supporter["hp"] > 0 and supporter["is_casting"] and supporter["cast_end_time"] is not None and time_elapsed >= supporter["cast_end_time"]:
            handler = SKILL_EFFECT_HANDLERS.get(supporter["skill_effect_type"])
            detail = handler(supporter, own_team, enemy_team, supporter["skill_params"], time_elapsed) if handler else {}
            detail = _tag_target_sides(detail, side_name, own_team, enemy_team)
            events.append({
                "time": time_elapsed, "event_type": "skill_resolve", "side": side_name,
                "actor": supporter["name"], "actor_slot": supporter.get("slot"), "effect_type": supporter["skill_effect_type"], "detail": detail,
            })
            used_effect_type = detail.get("copied_effect_type") or supporter["skill_effect_type"]
            _apply_paint_gain(supporter, used_effect_type, attacker_team, defender_team, side_name, events, time_elapsed)
            supporter["is_casting"] = False
            supporter["cast_end_time"] = None
            supporter["_last_cast_time"] = time_elapsed

        for slot in ("front", "back", "summon_front", "summon_back"):
            unit = own_team[slot]
            if unit is None:
                continue
            if unit["hp"] <= 0 and id(unit) not in last_survivor_ids:
                continue

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
            if _is_action_blocked(unit, time_elapsed) and not cast_due_now:
                continue

            if unit["is_casting"]:
                if time_elapsed >= unit["cast_end_time"]:
                    handler = SKILL_EFFECT_HANDLERS.get(unit["skill_effect_type"])
                    detail = handler(unit, own_team, enemy_team, unit["skill_params"], time_elapsed) if handler else {}
                    detail = _tag_target_sides(detail, side_name, own_team, enemy_team)
                    events.append({
                        "time": time_elapsed, "event_type": "skill_resolve", "side": side_name,
                        "actor": unit["name"], "actor_slot": unit.get("slot"), "effect_type": unit["skill_effect_type"], "detail": detail,
                    })
                    # 방임석(예술가의 혼): 방금 발동한 [Active]를 전장의 다른 관찰자들에게 알린다 -
                    # 강승유가 복제한 스킬이면 실제로 복제된 원본 효과 타입(copied_effect_type)을 기준으로
                    # 분류해야, 방임석이 "강승유가 뭘 복제했는지"까지 정확히 반영해서 물감을 받는다.
                    used_effect_type = detail.get("copied_effect_type") or unit["skill_effect_type"]
                    _apply_paint_gain(unit, used_effect_type, attacker_team, defender_team, side_name, events, time_elapsed)
                    unit["is_casting"] = False
                    unit["cast_end_time"] = None
                    unit["_last_cast_time"] = time_elapsed
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
                    "actor": unit["name"], "actor_slot": unit.get("slot"), "target": resolved_target["name"],
                    "target_side": "defender" if side_name == "attacker" else "attacker",
                })
            if unit.get("melee_speed") is not None and resolved_target is not None:
                _advance_melee_position(unit, resolved_target["position"], TICK, time_elapsed)

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

            # 기본공격은 이제 스킬 시스템과 완전히 무관하다 - 코스트가 [Active] 발동을 전담하므로
            # (_tick_team_cost), 여기서는 그냥 무조건 다음 공격 쿨다운을 재장전한다.
            _do_basic_attack(unit, side_name, own_team, enemy_team, time_elapsed, events, resolved_target=resolved_target)
            unit["next_attack_time"] = time_elapsed + _effective_interval(unit, time_elapsed)

    return time_elapsed


def _resolve_battle_outcome(attacker_team, defender_team, time_elapsed):
    """전투 루프가 끝난 뒤 승/패/무승부를 판정한다. simulate_battle(동기)과 (1v1) 친선전의 실시간
    루프가 판정 기준을 따로 관리하다 어긋나지 않도록 공유한다."""
    attacker_alive = _team_alive(attacker_team)
    defender_alive = _team_alive(defender_team)

    if attacker_alive and not defender_alive:
        return True
    if defender_alive and not attacker_alive:
        return False
    if not attacker_alive and not defender_alive:
        # 무승부: 같은 틱에 양팀이 동시에 전멸한 경우. 아군까지 함께 때리는 광역기(예: 김어진 "불빠따")가
        # 마지막 남은 아군을 쓰러뜨리는 것과 동시에 적팀도 전멸시키는 극히 드문 상황에서만 발생한다 -
        # 시전자 본인은 자기 광역기에 맞지 않으므로 일반적으로는 나오기 어렵다. None으로 표시하고,
        # 호출부(routers/pvp.py)에서 승패 어느 쪽에도 해당하는 보상/순위 변동을 주지 않는다.
        return None

    # 둘 다 아직 살아있는 채로 루프가 끝난 경우 - MAX_BATTLE_DURATION(시간 제한)에 걸린 것이다.
    # 회복형 캐릭터가 몰려서(예: 이영웅 다수 조합) 입히는 피해보다 회복량이 더 커 어느 쪽도 전멸하지
    # 않는 전투를 여기서 강제 종료하고, 그 시점 HP 비율이 더 높은 쪽을 승자로 판정한다.
    def _hp_ratio(team):
        alive = [u for u in _all_slots(team) if u]
        total_hp = sum(u["hp"] for u in alive)
        total_max = sum(u["max_hp"] for u in alive)
        return (total_hp / total_max) if total_max else 0

    return _hp_ratio(attacker_team) >= _hp_ratio(defender_team)


def _init_battle(attacker_team, defender_team, events):
    """전투 시작 시 1회만 필요한 준비(위치/코스트 초기화, cost_init/특성/성급효과/서포터 스탯분배
    이벤트 발행)를 담당한다. simulate_battle(동기, while 루프 진입 전)과 (1v1) 친선전의 실시간 루프
    (틱 루프를 시작하기 전) 양쪽에서 완전히 동일하게 재사용된다."""
    # _apply_battle_start_traits/_apply_battle_start_star_effects가 내부적으로 _alive_units를 쓰므로
    # (노출도 정렬에 position/is_attacker_team이 필요) 반드시 그 호출들보다 먼저 위치를 초기화해야 한다.
    _init_unit_positions(attacker_team, True)
    _init_unit_positions(defender_team, False)

    _init_team_cost(attacker_team)
    _init_team_cost(defender_team)
    for cost_side, cost_team in (("attacker", attacker_team), ("defender", defender_team)):
        events.append({
            "time": 0.0, "event_type": "cost_init", "side": cost_side,
            "cost_pool": TEAM_COST_START, "cost_max": TEAM_COST_MAX,
            "cards": [
                {
                    "slot": slot,
                    "name": u["name"] if u else None,
                    "card_cost": u.get("skill_cost") if u else None,
                    "attack_type": u.get("attack_type") if u else None,
                    "has_skill": bool(u and u.get("skill_effect_type")),
                }
                for slot in COST_ROTATION_SLOTS
                for u in (cost_team.get(slot),)
            ],
        })

    _apply_battle_start_traits(attacker_team, defender_team, events, "attacker")
    _apply_battle_start_traits(defender_team, attacker_team, events, "defender")
    _apply_battle_start_star_effects(attacker_team, defender_team, events)
    _apply_supporter_stat_donation(attacker_team, "attacker", events)
    _apply_supporter_stat_donation(defender_team, "defender", events)


def simulate_battle(attacker_team: dict, defender_team: dict) -> dict:
    """
    두 팀(전방+후방)을 받아 시간 기반으로 전투를 시뮬레이션한다.
    "전방"/"후방"은 고정 슬롯이 아니라 실제 시뮬레이션된 위치(position) 기준 노출도로 매 순간 다시
    정해진다 - 근접 유닛이 걸어서 자기 팀의 다른 슬롯보다 더 앞서 나가거나(예: 후방 우선 패시브로 적
    후방까지 걸어가는 동안), 넉백으로 누군가 뒤로 밀려나면 실제로 타겟 우선순위가 바뀔 수 있다(자세한
    내용은 _alive_units/_select_basic_attack_target 참고). 김남옥의 기본공격은 예외 - 항상 둘 다 맞음.
    [Active] 스킬은 팀 공유 코스트 풀이 차오르면 전방->후방->서포터 순 라운드로빈으로 자동 발동한다
    (코스트제, _tick_team_cost 참고) - 기본공격은 이제 스킬 시스템과 완전히 무관한 순수 쿨다운이다.
    반환값의 events는 프론트에서 순서대로 재생하는 데 쓰인다.
    """
    time_elapsed = 0.0
    events = []

    _init_battle(attacker_team, defender_team, events)

    tick_index = 0
    while _team_alive(attacker_team) and _team_alive(defender_team) and time_elapsed < MAX_BATTLE_DURATION:
        tick_index += 1
        time_elapsed = _simulate_tick(attacker_team, defender_team, tick_index, time_elapsed, events)

    attacker_won = _resolve_battle_outcome(attacker_team, defender_team, time_elapsed)

    return {
        "events": events,
        "attacker_won": attacker_won,
        "duration": time_elapsed,
        "final_attacker_team": attacker_team,
        "final_defender_team": defender_team,
    }
