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

router = APIRouter(prefix="/devtest", tags=["devtest"])


def _config_to_unit(cfg: DevTestUnitConfig, slot: str):
    if cfg.character_name not in CATALOG_BY_NAME:
        raise HTTPException(status_code=400, detail=f"characters.json에 없는 캐릭터입니다: {cfg.character_name}")

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
        "outfit": catalog.get("outfits", {}).get("기본"),
        "star": unit["star"],
    }


@router.post("/battle")
def devtest_battle(
    req: DevTestBattleRequest,
    user: User = Depends(get_current_user),
):
    attacker_team = build_team(
        _config_to_unit(req.attacker_front, "front"),
        _config_to_unit(req.attacker_back, "back"),
    )
    defender_team = build_team(
        _config_to_unit(req.defender_front, "front"),
        _config_to_unit(req.defender_back, "back"),
    )

    result = simulate_battle(attacker_team, defender_team)

    return {
        "attacker_won": result["attacker_won"],
        "duration": result["duration"],
        "events": result["events"],
        "attacker_team": {"front": _unit_view(attacker_team["front"]), "back": _unit_view(attacker_team["back"])},
        "defender_team": {"front": _unit_view(defender_team["front"]), "back": _unit_view(defender_team["back"])},
    }


@router.get("/characters")
def devtest_characters():
    """개발자 창의 캐릭터 선택 드롭다운을 채우기 위한 목록 - 이름/희귀도/초기 성/스킬·특성 기본 파라미터까지 그대로 내려준다."""
    return [
        {
            "name": c["name"],
            "rarity": c["rarity"],
            "start_star": c["start_star"],
            "range": c.get("range"),
            "gender": c.get("gender"),
            "attack_type": c.get("attack_type", "Student"),
            "defense_type": c.get("defense_type", "Student"),
            "outfits": c.get("outfits", {}),
            "skill_mechanics": c.get("skill_mechanics"),
            "trait_mechanics": c.get("trait_mechanics"),
        }
        for c in CATALOG_BY_NAME.values()
    ]
