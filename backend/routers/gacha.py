import random
import json
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import User, Character, GachaBanner, GachaBannerPickup, ActivityLog
from schemas import GachaSelectRequest
from security import get_current_user
from achievements import check_and_grant_achievements, resolve_character_reveal_info

router = APIRouter(prefix="/gacha", tags=["gacha"])

with open("characters.json", "r", encoding="utf-8") as f:
    CHARACTER_POOL = json.load(f)

GACHA_COST = 100
GACHA_POINTS_PER_PULL = 1   # 모집 1회당 적립되는 모집 포인트 (성공/중복 여부와 무관)
DEFAULT_PICKUP_RATE_UP = 0.5  # gacha_banner_pickups.rate_up이 비어있을 때 쓰는 기본값
RARITY_START_STAR = {"신화": 5, "전설": 4, "영웅": 3, "희귀": 2, "일반": 1}  # 모집 시 시작 성(星)

# 등급별 확률(각 등급의 몫, 합이 1). pull_character의 실제 등급 추첨과 확률 안내 모달(/gacha/rates)이
# 이 상수 하나만 보고 계산하게 해서, 둘이 서로 다른 숫자를 보여주는 일이 없게 한다.
RARITY_TIER_PROBABILITY = {"신화": 0.005, "전설": 0.01, "영웅": 0.09, "희귀": 0.30, "일반": 0.595}


def _get_active_pickup_rates(db: Session, banner_id: int | None) -> dict:
    """
    banner_id로 지정된 그 배너가 '픽업' 타입이고 활성화되어 있을 때만,
    그 배너의 픽업 캐릭터별 확률업 수치를 {캐릭터이름: rate_up} 형태로 돌려준다.
    banner_id가 없거나, 그 배너가 픽업 타입이 아니면(예: 상시모집) 빈 딕셔너리를 돌려준다 -
    즉 지금 사용자가 실제로 보고 있던 배너가 픽업일 때만 픽업 판정이 걸린다.
    캐릭터마다 rate_up 값이 달라도 되고(Supabase gacha_banner_pickups.rate_up에서 조정), 값이
    비어있으면(None) DEFAULT_PICKUP_RATE_UP을 쓴다.
    """
    if banner_id is None:
        return {}
    rows = (
        db.query(GachaBannerPickup.character_name, GachaBannerPickup.rate_up)
        .join(GachaBanner, GachaBanner.id == GachaBannerPickup.banner_id)
        .filter(
            GachaBanner.id == banner_id,
            GachaBanner.is_active == True,
            GachaBanner.banner_type == "pickup",
        )
        .all()
    )
    return {name: (rate if rate is not None else DEFAULT_PICKUP_RATE_UP) for name, rate in rows}


def _pick_character_with_pickup(rarity: str, active_pickup_rates: dict):
    """
    같은 등급 안에, 확률업이 걸린 픽업 캐릭터가 있으면 각자의 rate_up 확률로 그 캐릭터를 확정 지급하고,
    (여러 명이면 순서대로 하나씩 시도) 아무도 안 걸리면 그 등급 안에서 완전 균등 랜덤으로 뽑는다.
    """
    tier = CHARACTER_POOL[rarity]
    tier_pickups = [c for c in tier if c["name"] in active_pickup_rates]

    for pickup_char in tier_pickups:
        if random.random() < active_pickup_rates[pickup_char["name"]]:
            return pickup_char
    return random.choice(tier)

@router.post("/")
def pull_character(
    banner_id: int | None = None,  # 지금 화면에서 선택 중인 배너. 이게 픽업 배너일 때만 픽업 판정이 적용됨
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.gold < GACHA_COST:
        raise HTTPException(status_code=400, detail="골드가 부족합니다.")

    user.gold -= GACHA_COST

    rand_val = random.random()
    cumulative = 0.0
    rarity = "일반"
    for tier_name, tier_prob in RARITY_TIER_PROBABILITY.items():
        cumulative += tier_prob
        if rand_val < cumulative:
            rarity = tier_name
            break

    active_pickup_rates = _get_active_pickup_rates(db, banner_id)
    picked_character = _pick_character_with_pickup(rarity, active_pickup_rates)

    user.gacha_points += GACHA_POINTS_PER_PULL

    owned_names = {c.name for c in user.characters}
    is_duplicate = picked_character["name"] in owned_names
    is_pickup = picked_character["name"] in active_pickup_rates

    if is_duplicate:
        # 중복은 버리지 않고 같은 캐릭터 카드 1장으로 저장한다.
        # 인벤토리 API가 같은 이름+같은 성의 행들을 한 카드로 묶어 count로 보여준다.
        duplicate_copy = Character(
            user_id=user.id,
            name=picked_character["name"],
            job_class=picked_character["job_class"],
            rarity=rarity,
            star=RARITY_START_STAR.get(rarity, 1),
            outfit=picked_character["outfits"]["기본"],
            is_equipped=0,
        )
        db.add(duplicate_copy)
        db.add(ActivityLog(user_id=user.id, activity_type="gacha_pull"))  # 퀘스트("모집 N회") 판정용
        db.commit()
        db.refresh(duplicate_copy)
        new_achievements, new_characters = check_and_grant_achievements(db, user)
        return {
            "message": f"'{picked_character['name']}' 카드 1장을 추가로 획득했습니다.",
            "character": {
                "id": duplicate_copy.id,
                "name": duplicate_copy.name,
                "rarity": rarity,
                "job_class": duplicate_copy.job_class,
                "description": picked_character["description"],
                "outfit": duplicate_copy.outfit,
                **resolve_character_reveal_info(duplicate_copy.name, duplicate_copy.star),
            },
            "is_duplicate": True,
            "is_pickup": is_pickup,
            "left_gold": user.gold,
            "gacha_points": user.gacha_points,
            "new_achievements": new_achievements,
            "new_characters": new_characters,
        }

    new_character = Character(
        user_id=user.id,
        name=picked_character["name"],
        job_class=picked_character["job_class"],
        rarity=rarity,
        star=RARITY_START_STAR.get(rarity, 1),
        outfit=picked_character["outfits"]["기본"],
        is_equipped=0
    )
    db.add(new_character)
    db.add(ActivityLog(user_id=user.id, activity_type="gacha_pull"))  # 퀘스트("모집 N회") 판정용
    db.commit()
    db.refresh(new_character)
    new_achievements, new_characters = check_and_grant_achievements(db, user)

    return {
        "message": picked_character["description"],
        "character": {
            "id": new_character.id,
            "name": new_character.name,
            "rarity": new_character.rarity,
            "job_class": new_character.job_class,
            "description": picked_character["description"],
            "outfit": new_character.outfit,
            **resolve_character_reveal_info(new_character.name, new_character.star),
        },
        "is_duplicate": False,
        "is_pickup": is_pickup,
        "left_gold": user.gold,
        "gacha_points": user.gacha_points,
        "new_achievements": new_achievements,
        "new_characters": new_characters,
    }


@router.get("/banners")
def get_banners(db: Session = Depends(get_db)):
    """지금 활성화된 가챠 배너들과, 각 배너의 픽업 캐릭터/필요 포인트/사진 정보를 돌려준다."""
    banners = db.query(GachaBanner).filter(GachaBanner.is_active == True).all()

    result = []
    for b in banners:
        pickups = []
        for p in b.pickups:
            _, char_data = _find_character_in_pool(p.character_name)
            pickups.append({
                "pickup_id": p.id,
                "character_name": p.character_name,
                "point_cost": p.point_cost,
                "description": char_data["description"] if char_data else "",
                "outfit": char_data["outfits"]["기본"] if char_data else None,
            })

        result.append({
            "id": b.id,
            "name": b.name,
            "banner_type": b.banner_type,
            "image_file": b.image_file,
            "start_date": b.start_date,
            "end_date": b.end_date,
            "pickups": pickups
        })

    return result


RARITY_ORDER = ["신화", "전설", "영웅", "희귀", "일반"]


@router.get("/rates")
def get_gacha_rates(banner_id: int | None = None, db: Session = Depends(get_db)):
    """캐릭터별 실제 획득 확률(퍼센트, 소수점 5자리)을 계산해서 돌려준다 - 확률 안내(i버튼) 모달용.
    banner_id가 활성 픽업 배너면 그 배너의 확률업이 반영된 실제 수치를, 아니면(없거나 상시 배너면)
    등급 내 완전 균등 확률을 돌려준다. pull_character와 완전히 같은 확률 모델
    (RARITY_TIER_PROBABILITY + _pick_character_with_pickup의 순차 시도 규칙)을 그대로 계산에 반영한다."""
    active_pickup_rates = _get_active_pickup_rates(db, banner_id)

    rarities = []
    for rarity in RARITY_ORDER:
        tier = CHARACTER_POOL[rarity]
        tier_prob = RARITY_TIER_PROBABILITY[rarity]
        n = len(tier)

        # 이 등급 안의 픽업 캐릭터들이 순서대로 시도해서 전부 실패할 확률(곱) - 실패하면 균등 추첨으로 폴백.
        miss_all = 1.0
        for c in tier:
            if c["name"] in active_pickup_rates:
                miss_all *= (1 - active_pickup_rates[c["name"]])

        characters = []
        miss_so_far = 1.0  # 지금 이 캐릭터 앞에서 시도된 픽업들이 전부 실패했을 확률
        for c in tier:
            name = c["name"]
            if name in active_pickup_rates:
                rate = active_pickup_rates[name]
                p_within_tier = miss_so_far * rate + miss_all * (1 / n)
                miss_so_far *= (1 - rate)
                is_pickup = True
            else:
                p_within_tier = miss_all * (1 / n)
                is_pickup = False

            characters.append({
                "name": name,
                "percent": round(tier_prob * p_within_tier * 100, 5),
                "is_pickup": is_pickup,
            })

        rarities.append({
            "rarity": rarity,
            "tier_probability_percent": round(tier_prob * 100, 5),
            "characters": characters,
        })

    return {
        "is_pickup_banner": len(active_pickup_rates) > 0,
        "rarities": rarities,
    }


def _find_character_in_pool(character_name: str):
    for rarity, char_list in CHARACTER_POOL.items():
        for char in char_list:
            if char["name"] == character_name:
                return rarity, char
    return None, None


@router.post("/select")
def select_pickup_character(
    req: GachaSelectRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """모집 포인트를 소모해서 픽업 캐릭터를 직접 획득한다 (뽑기가 아니라 확정 지급)."""
    pickup = db.query(GachaBannerPickup).filter(GachaBannerPickup.id == req.pickup_id).first()
    if not pickup:
        raise HTTPException(status_code=404, detail="존재하지 않는 픽업 항목입니다.")

    if user.gacha_points < pickup.point_cost:
        raise HTTPException(
            status_code=400,
            detail=f"모집 포인트가 부족합니다. (필요: {pickup.point_cost}, 보유: {user.gacha_points})"
        )

    rarity, picked_character = _find_character_in_pool(pickup.character_name)
    if not picked_character:
        raise HTTPException(
            status_code=500,
            detail=f"characters.json에서 '{pickup.character_name}'을(를) 찾을 수 없습니다."
        )

    user.gacha_points -= pickup.point_cost

    owned_names = {c.name for c in user.characters}
    is_duplicate = pickup.character_name in owned_names

    # 포인트 선택도 중복 여부와 관계없이 카드 한 장을 지급한다.
    new_character = Character(
        user_id=user.id,
        name=picked_character["name"],
        job_class=picked_character["job_class"],
        rarity=rarity,
        star=RARITY_START_STAR.get(rarity, 1),
        outfit=picked_character["outfits"]["기본"],
        is_equipped=0
    )
    db.add(new_character)
    db.commit()
    db.refresh(new_character)
    new_achievements, new_characters = check_and_grant_achievements(db, user)

    return {
        "message": (
            f"'{pickup.character_name}' 카드 1장을 추가로 획득했습니다."
            if is_duplicate else
            f"'{pickup.character_name}'을(를) 선택했습니다!"
        ),
        "character_name": pickup.character_name,
        "character_id": new_character.id,
        "character": {
            "id": new_character.id,
            "name": new_character.name,
            "rarity": new_character.rarity,
            "job_class": new_character.job_class,
            "description": picked_character["description"],
            "outfit": new_character.outfit,
            **resolve_character_reveal_info(new_character.name, new_character.star),
        },
        "is_duplicate": is_duplicate,
        "left_points": user.gacha_points,
        "new_achievements": new_achievements,
        "new_characters": new_characters
    }