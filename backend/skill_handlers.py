"""
스킬(Active) 효과 핸들러 모음. battle_engine.py의 메인 루프(simulate_battle)가 기본공격
SKILL_TRIGGER_ATTACK_COUNT회 시전마다 호출한다.
명명 규칙(skill=active)은 battle_core.py 상단 참고.
"""
from battle_core import (
    AXIS_ATTACKER_BACK, AXIS_DEFENDER_BACK, CC_PRIORITY_KNOCKBACK, KNOCKBACK_POSITION_DISTANCE,
    _alive_target, _alive_units, _apply_damage, _apply_gendered_damage_bonus, _apply_stun,
    _effective_gender, _interrupt_cast_if_casting, _new_status, _refresh_status_until,
    _roll_damage_atk, _scale_params, get_type_multiplier,
)

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

    # 윤(호 출격!)처럼 소환에 자신의 현재 체력을 대가로 치르는 경우(hp_cost_percent, 선택 파라미터) -
    # 이 대가로 정말 죽을 수도 있다(0까지 깎임, 하한선 없음). "최소 1은 남긴다" 같은 안전장치는 지금은
    # 넣지 않는다 - 나중에 별도 매커니즘으로 만들 예정.
    hp_cost_percent = params.get("hp_cost_percent")
    caster_hp_before = caster["hp"]
    if hp_cost_percent:
        cost = round(caster["max_hp"] * hp_cost_percent / 100)
        caster["hp"] = max(0, caster["hp"] - cost)

    caster_slot = "front" if own_team.get("front") is caster else "back"
    target_key = f"summon_{caster_slot}"
    replaced = own_team.get(target_key)

    clone_max_hp = round(caster["max_hp"] * params["hp_percent"] / 100)
    clone_atk = round(caster["atk"] * params["atk_percent"] / 100)
    # clone_name(선택 파라미터)이 있으면(예: 윤의 "호") 그 고유 이름을 쓰고, 없으면 기존처럼
    # "{시전자}의 복제체"로 부른다.
    clone = {
        "name": params.get("clone_name") or f"{caster['name']}의 복제체",
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
        # 지금 이 순간 그 자리에 "새로 나타난" 것이므로 settled_at도 지금 시각으로 시작한다 -
        # battle_core._exposure_sort_key가 노출도 동률(예: caster가 나중에 다시 이 자리 근처로
        # 걸어 돌아왔을 때)을 깨는 기준으로 쓴다.
        "position_settled_at": time_elapsed,
        "is_attacker_team": caster["is_attacker_team"],
        # 윤의 "호"(자폭 소환수)처럼 첫 기본공격 한 번을 명중시키자마자 스스로 죽는 소환수(선택
        # 파라미터) - 실제 자폭 판정은 _do_basic_attack이 매 기본공격마다 이 필드를 확인해서 처리한다.
        "self_destruct_after_attack": bool(params.get("clone_self_destruct")),
        # 소환수 전용 성별(선택 파라미터) - characters.json에 별도 캐릭터 항목이 없는 소환수(예: 윤의
        # "호")는 CHARACTER_GENDER에 자기 이름이 없어 _effective_gender가 gender_override를 봐야만
        # 성별이 잡힌다(시전자 "윤"의 성별과 독립적으로 지정 가능 - 윤이 여성이어도 호는 그대로 남성).
        "gender_override": params.get("clone_gender"),
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
    # caster도 지금 막 이 위치로 밀려났으니 settled_at을 갱신한다 - 안 그러면 근접 caster가 이후 다시
    # 이 자리 근처로 걸어 돌아왔을 때(노출도가 복제체와 동률이 되는 순간), 위 clone보다 caster의
    # settled_at이 더 오래된 값(전투 시작 시각 등)으로 남아있어서 caster가 부당하게 전방으로 판정된다.
    caster["position_settled_at"] = time_elapsed

    detail = {
        "summoned": True, "clone_name": clone["name"], "clone_hp": clone_max_hp, "clone_atk": clone_atk,
        "clone_slot": target_key.replace("_", "-"), "replaced": replaced["name"] if replaced else None,
    }
    # 프론트가 체력 소모를 반영할 수 있도록, 실제로 대가를 치렀을 때만(hp_cost_percent가 있고 실제로
    # 깎였을 때만) caster의 변화 후 체력을 함께 알려준다.
    if hp_cost_percent and caster["hp"] != caster_hp_before:
        detail["caster_hp_after"] = caster["hp"]
        detail["caster_max_hp"] = caster["max_hp"]
    # 윤(호): 소환수 전용 스프라이트를 시전자와 같은 outfit 폴더 안에서 접미사로만 구분해 쓰는 경우
    # (예: battle_idle_ho.webp, attack_ho_1.webp - 이의진 type2의 battle_idle_type2.webp와 같은 방식).
    # 없으면 프론트는 기존처럼 시전자 스프라이트를 그대로 물려받는다(윤영준의 복제체 등).
    clone_sprite_variant = params.get("clone_sprite_variant")
    if clone_sprite_variant:
        detail["clone_sprite_variant"] = clone_sprite_variant
    # clone_sprite_outfit: 이 소환수의 그림이 항상 이 outfit 폴더(예: 윤의 "mage_2/basic")에서 나와야
    # 하는 경우 - 강승유가 이 스킬을 복제해도(시전자가 강승유라도) 호는 자기 자신의 실제 그림을
    # 그대로 유지해야 하므로, "시전자의 outfit을 물려받는다"는 기본 규칙(프론트 참고) 대신 이 값을
    # 우선 쓴다. 없으면 프론트는 기존처럼 시전자 outfit을 그대로 물려받는다(윤영준의 복제체 등).
    clone_sprite_outfit = params.get("clone_sprite_outfit")
    if clone_sprite_outfit:
        detail["clone_sprite_outfit"] = clone_sprite_outfit
    # 아래 둘은 순수 연출용이라 백엔드 로직(clone dict)엔 저장하지 않고, 프론트가 쓰도록 detail로만
    # 전달한다. clone_melee_overlap_percent: 윤의 "호"처럼 목표 히트박스에 이 비율만큼 실제로 파고들어야
    # (기본값은 딱 맞닿는 수준) 도착으로 쳐서 공격을 시작하는 소환수(arena-battle.js의 getGapToTarget).
    # clone_render_on_top: 다른 스프라이트와 겹쳐도 항상 그 위에 그려지는 소환수.
    melee_overlap_percent = params.get("clone_melee_overlap_percent")
    if melee_overlap_percent:
        detail["clone_melee_overlap_percent"] = melee_overlap_percent
    if params.get("clone_render_on_top"):
        detail["clone_render_on_top"] = True
    return detail


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
    # 이영웅 "청진기 진료": 아군 한 명이 아니라 전체(시전자 자신 포함)를 동시에 회복시킨다 - 여러
    # 명을 동시에 회복시키는 다른 효과(death_heal_ally 등)와 동일하게 heals 배열로 반환한다. 각
    # 대상은 자기 자신의 최대 체력 기준으로 회복(팀 전체가 같은 % 회복률을 받되, 절대량은 다를 수 있음).
    # 이미 만피라 실제로는 안 깎여도(amount=0) 항상 heals에 넣는다 - 프론트가 "발동은 했는데 아무
    # 반응도 없다"가 되지 않도록 만피인 아군에게도 하트 연출 + "0 회복" 로그를 보여줄 수 있어야 한다.
    heals = []
    for ally in _alive_units(own_team):
        heal = round(ally["max_hp"] * params["percent"] / 100)
        before = ally["hp"]
        ally["hp"] = min(ally["max_hp"], ally["hp"] + heal)
        heals.append({
            "target": ally["name"], "amount": ally["hp"] - before,
            "target_hp_after": ally["hp"], "target_max_hp": ally["max_hp"],
        })
    return {"healed": bool(heals), "heals": heals}


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
    # target도 지금 막 이 위치로 밀려났다 - battle_core._exposure_sort_key의 동률 타이브레이커용
    # (밀려난 뒤 다시 걸어와 노출도가 누군가와 같아지는 순간, 더 늦게 도착한 쪽이 후방으로 판정되게 함).
    target["position_settled_at"] = time_elapsed

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
            raw_target_params = target["skill_params"] or {}
            scaled = _scale_params(raw_target_params, params["potency_percent"] / 100)
            # 윤의 "호"처럼 clone_copy_stat_percent가 있는 소환 스킬을 복제하면, 강승유 본인의
            # potency_percent(위력 복제율)와는 별개로 체력/공격력 배율만 한 번 더 이 비율만큼
            # 줄인다 - 원본 캐릭터 자신이 직접 소환할 때는 이 값을 아예 안 읽으므로(clone_copy_stat_percent를
            # 쓰지 않는 _skill_summon_clone) 영향이 없고, "복제로 만든 몸은 원본보다 약하다"는
            # 밸런스만 copy_target_skill 경로에서만 적용된다. 위력 복제율에 또 깎이지 않도록 원본
            # target_params(raw_target_params)에서 읽는다.
            copy_stat_percent = raw_target_params.get("clone_copy_stat_percent")
            if copy_stat_percent:
                stat_factor = copy_stat_percent / 100
                if "hp_percent" in scaled:
                    scaled["hp_percent"] = round(scaled["hp_percent"] * stat_factor, 2)
                if "atk_percent" in scaled:
                    scaled["atk_percent"] = round(scaled["atk_percent"] * stat_factor, 2)
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
