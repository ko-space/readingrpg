"""
개발자용 밸런스 테스트 전용 라우터. 로비(home.html)와 전혀 연결돼 있지 않고, URL을 직접 아는 사람만 접근한다.
로그인만 요구할 뿐(get_current_user) 소유권/매칭 검사는 전부 생략하고, 임의의 캐릭터/성급/수치로 전투를 돌려볼 수 있게 한다.
DB에는 아무 것도 저장하지 않는다(PvpBattleLog 미생성) - 실제 랭킹/전적을 건드리지 않기 위함.
"""
from fastapi import APIRouter, HTTPException, Depends
from models import User
from schemas import DevTestBattleRequest, DevTestUnitConfig
from security import get_current_user
from battle_engine import compute_unit_stats, build_team, simulate_battle
from routers.characters import CATALOG_BY_NAME
from character_visibility import is_hidden_override

router = APIRouter(prefix="/devtest", tags=["devtest"])

ADMIN_USER_ID = 1  # gacha.py/ranking.py/pvp.py와 동일한 관리자 계정 - is_hidden 캐릭터(예: 이의진)는
# 공개 전까지 이 계정으로 로그인했을 때만 devtest에서 조회/전투 테스트가 가능하다.


def _config_to_unit(cfg: DevTestUnitConfig, slot: str, is_admin: bool):
    if cfg.character_name not in CATALOG_BY_NAME:
        raise HTTPException(status_code=400, detail=f"characters.json에 없는 캐릭터입니다: {cfg.character_name}")

    char = CATALOG_BY_NAME[cfg.character_name]
    if is_hidden_override(char["name"], char.get("is_hidden", False)) and not is_admin:
        raise HTTPException(status_code=403, detail=f"{cfg.character_name}은(는) 아직 공개되지 않은 캐릭터입니다.")

    overrides = {}
    if cfg.hp_override is not None:
        overrides["hp"] = cfg.hp_override
    if cfg.atk_override is not None:
        overrides["atk"] = cfg.atk_override
    if cfg.attack_interval_override is not None:
        overrides["attack_interval"] = cfg.attack_interval_override
    if cfg.level_override is not None:
        overrides["level"] = cfg.level_override
    if cfg.skill_params_override is not None:
        overrides["skill_params"] = cfg.skill_params_override

    return compute_unit_stats(cfg.character_name, cfg.star, cfg.level_override or 1, slot, overrides=overrides)


def _unit_view(unit):
    # 소환된 복제체("~의 복제체")는 원본 캐릭터 이름으로 되돌려서 outfit(스프라이트 경로)을 찾는다.
    base_name = unit["name"].split("의 복제체")[0]
    catalog = CATALOG_BY_NAME.get(base_name, {})
    return {
        "name": unit["name"],
        "max_hp": unit["max_hp"],
        "is_melee": unit["is_melee"],
        "melee_speed_ratio": unit.get("melee_speed_ratio"),
        "outfit": catalog.get("outfits", {}).get("기본"),
        "star": unit["star"],
    }


@router.post("/battle")
def devtest_battle(
    req: DevTestBattleRequest,
    user: User = Depends(get_current_user),
):
    is_admin = user.id == ADMIN_USER_ID
    attacker_team = build_team(
        _config_to_unit(req.attacker_front, "front", is_admin),
        _config_to_unit(req.attacker_back, "back", is_admin),
        supporter=_config_to_unit(req.attacker_supporter, "supporter", is_admin) if req.attacker_supporter else None,
    )
    defender_team = build_team(
        _config_to_unit(req.defender_front, "front", is_admin),
        _config_to_unit(req.defender_back, "back", is_admin),
        supporter=_config_to_unit(req.defender_supporter, "supporter", is_admin) if req.defender_supporter else None,
    )

    result = simulate_battle(attacker_team, defender_team)

    return {
        "attacker_won": result["attacker_won"],
        "duration": result["duration"],
        "events": result["events"],
        "attacker_team": {
            "front": _unit_view(attacker_team["front"]), "back": _unit_view(attacker_team["back"]),
            "supporter": _unit_view(attacker_team["supporter"]) if attacker_team.get("supporter") else None,
        },
        "defender_team": {
            "front": _unit_view(defender_team["front"]), "back": _unit_view(defender_team["back"]),
            "supporter": _unit_view(defender_team["supporter"]) if defender_team.get("supporter") else None,
        },
    }


@router.get("/characters")
def devtest_characters(user: User = Depends(get_current_user)):
    """개발자 창의 캐릭터 선택 드롭다운을 채우기 위한 목록 - 이름/희귀도/초기 성/스킬·특성 기본 파라미터까지 그대로 내려준다.
    로그인만 요구하던 걸 여기서도 검사하도록 바꿈 - is_hidden 캐릭터(예: 이의진)는 관리자 계정으로 로그인했을 때만
    목록에 나온다(그래야 목록에서부터 완전히 안 보임 - _config_to_unit의 403은 "이미 이름을 아는" 사람만 막는다)."""
    is_admin = user.id == ADMIN_USER_ID
    return [
        {
            "name": c["name"],
            "rarity": c["rarity"],
            "start_star": c["start_star"],
            "unit_role": c.get("unit_role", "striker"),
            "range": c.get("range"),
            "gender": c.get("gender"),
            "attack_type": c.get("attack_type", "Student"),
            "defense_type": c.get("defense_type", "Student"),
            "outfits": c.get("outfits", {}),
            "skill_mechanics": c.get("skill_mechanics"),
            "trait_mechanics": c.get("trait_mechanics"),
        }
        for c in CATALOG_BY_NAME.values()
        if is_admin or not is_hidden_override(c["name"], c.get("is_hidden", False))
    ]
