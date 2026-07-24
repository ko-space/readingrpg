import json
from collections import defaultdict
from pathlib import Path
from random import SystemRandom

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Character, Item, UserItem, ActivityLog
from schemas import EquipRequest, CharacterOutfitRequest, EnhancementRequest
from security import get_current_user
from achievements import check_and_grant_achievements

router = APIRouter(prefix="/characters", tags=["characters"])

# achievements.py의 RARITY_START_STAR와 동일한 등급 순서(낮을수록 흔함) - 정렬 전용으로 여기 따로 둔다.
RARITY_RANK = {"일반": 1, "희귀": 2, "영웅": 3, "전설": 4, "신화": 5}

CHARACTERS_JSON = Path(__file__).resolve().parents[1] / "characters.json"
with CHARACTERS_JSON.open("r", encoding="utf-8") as f:
    CHARACTER_POOL = json.load(f)

RARITY_START_STAR = {"신화": 5, "전설": 4, "영웅": 3, "희귀": 2, "일반": 1}

# 성공 / 유지 / 파괴 확률과 비용.
# 값은 모두 퍼센트 단위다.
ENHANCEMENT_RULES = {
    1: {"success": 79, "maintain": 20, "destroy": 1, "cost": 50},
    2: {"success": 50, "maintain": 45, "destroy": 5, "cost": 100},
    3: {"success": 30, "maintain": 60, "destroy": 10, "cost": 200},
    4: {"success": 20, "maintain": 60, "destroy": 20, "cost": 500},
    5: {"success": 1, "maintain": 49, "destroy": 50, "cost": 1000},
}

ENHANCEMENT_REQUIRED_COPIES = 3
_rng = SystemRandom()

CATALOG = []
CATALOG_BY_NAME = {}
for rarity, char_list in CHARACTER_POOL.items():
    for character in char_list:
        entry = {
            **character,
            "rarity": rarity,
            "start_star": RARITY_START_STAR.get(rarity, 1),
            "catalog_index": len(CATALOG),
        }
        CATALOG.append(entry)
        CATALOG_BY_NAME[character["name"]] = entry


def _character_payload(c: Character):
    return {
        "id": c.id,
        "name": c.name,
        "job_class": c.job_class,
        "rarity": c.rarity,
        "star": c.star,
        "outfit": c.outfit,
        "is_equipped": bool(c.is_equipped),
    }


def _build_inventory_rows(user: User):
    """같은 캐릭터명·같은 성급을 한 묶음으로 만든다."""
    groups = defaultdict(list)
    for character in user.characters:
        groups[(character.name, character.star)].append(character)

    result = []
    fallback_index = len(CATALOG) + 1000

    for (name, star), copies in groups.items():
        catalog = CATALOG_BY_NAME.get(name)
        equipped_copy = next((c for c in copies if c.is_equipped == 1), None)
        representative = equipped_copy or min(copies, key=lambda c: c.id)

        if catalog:
            metadata = {
                "description": catalog.get("description", ""),
                "range": catalog.get("range", "미정"),
                "attack_type": catalog.get("attack_type", "Student"),
                "defense_type": catalog.get("defense_type", "Student"),
                "gender": catalog.get("gender"),
                "outfits": catalog.get("outfits", {}),
                "star_effects": catalog.get("star_effects", {}),
                "exp_multiplier": catalog.get("exp_multiplier", {}),
                "exp_subjects": catalog.get("exp_subjects", []),
                "skill_effects": catalog.get("skill_effects", {}),
                "trait_effects": catalog.get("trait_effects", {}),
                "catalog_index": catalog["catalog_index"],
                "start_star": catalog["start_star"],
            }
            rarity = catalog["rarity"]
            job_class = catalog.get("job_class", representative.job_class)
        else:
            metadata = {
                "description": "캐릭터 정보가 characters.json에 없습니다.",
                "range": "미정",
                "attack_type": "Student",
                "defense_type": "Student",
                "gender": None,
                "outfits": {"기본": representative.outfit},
                "star_effects": {},
                "exp_multiplier": {},
                "exp_subjects": [],
                "skill_effects": {},
                "trait_effects": {},
                "catalog_index": fallback_index,
                "start_star": 1,
            }
            rarity = representative.rarity
            job_class = representative.job_class
            fallback_index += 1

        result.append({
            "character_id": representative.id,
            "copy_ids": [c.id for c in copies],
            "count": len(copies),
            "name": name,
            "job_class": job_class,
            "rarity": rarity,
            "star": star,
            "outfit": representative.outfit,
            "is_equipped": equipped_copy is not None,
            **metadata,
        })

    # 성급 우선(높은 성급 먼저) -> 같은 성급이면 희귀도 순(희귀할수록 먼저) -> 그래도 같으면 도감 순서.
    result.sort(key=lambda row: (
        -row["star"],
        -RARITY_RANK.get(row["rarity"], 0),
        row["catalog_index"],
    ))
    return result


@router.get("/")
def get_my_characters(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # PVP 편성처럼 개별 행 ID가 필요한 기존 화면을 위해 원본 행을 그대로 반환한다.
    return [_character_payload(c) for c in user.characters]


@router.get("/inventory")
def get_character_inventory(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """인벤토리용 그룹 데이터."""
    return {
        "characters": _build_inventory_rows(user),
        "catalog_order": [entry["name"] for entry in CATALOG],
    }


@router.get("/enhancement")
def get_enhancement_inventory(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """강화 화면에 필요한 보유 캐릭터와 확률표를 반환한다."""
    rows = _build_inventory_rows(user)

    # "강 희의 파쇄기"를 갖고 있으면(수량 1개 이상), 그 아이템을 이번 강화에 실제로 선택했을 때
    # 카드 한 장짜리 그룹도 강화(=파괴) 대상이 될 수 있다는 걸 화면에 미리 알려준다.
    owned_enhancement_items = (
        db.query(UserItem)
        .join(Item, Item.id == UserItem.item_id)
        .filter(
            UserItem.user_id == user.id,
            UserItem.quantity > 0,
            Item.item_type == "enhancement",
        )
        .all()
    )
    has_shredder = any(_is_force_destroy_item(ui.item) for ui in owned_enhancement_items)
    min_required_copies = 1 if has_shredder else ENHANCEMENT_REQUIRED_COPIES

    for row in rows:
        rule = ENHANCEMENT_RULES.get(row["star"])
        row["enhancement"] = {
            "eligible": bool(rule and row["count"] >= min_required_copies),
            "required_copies": min_required_copies,
            "next_star": row["star"] + 1 if rule else None,
            "rule": rule,
        }

    return {
        "gold": user.gold,
        "required_copies": ENHANCEMENT_REQUIRED_COPIES,
        "min_required_copies": min_required_copies,
        "has_shredder": has_shredder,
        "rules": ENHANCEMENT_RULES,
        "characters": rows,
    }


def _choose_enhancement_cards(user: User, copies: list[Character], material_count: int):
    """기준 카드 1장과 재료 material_count장을 안전하게 선택한다.

    material_count가 0이면 "강 희의 파쇄기"로 카드 단 한 장만 사용하는 경우다(재료가 필요 없다).
    이땐 굳이 지금 장착 중이거나 PVP에 쓰는 카드부터 없앨 이유가 없으니, 그렇지 않은 카드를
    최대한 먼저 고른다 - 3장 강화 때의 "기준 카드를 보존" 우선순위와는 반대다.

    material_count > 0(기존 3장 강화)일 때는 장착 중이거나 PVP 방어 편성에 들어간 카드를
    가능한 한 기준 카드로 보존하고, 재료에는 사용하지 않는다. 서로 다른 보호 카드가 두 장
    이상이라 재료가 부족하면 먼저 장착/PVP 편성을 해제하도록 안내한다.
    """
    protected_ids = {
        character_id
        for character_id in (
            user.pvp_defense_front_id,
            user.pvp_defense_back_id,
        )
        if character_id is not None
    }
    protected_ids.update(c.id for c in copies if c.is_equipped == 1)

    if material_count == 0:
        base = next((c for c in copies if c.id not in protected_ids), None)
        if base is None:
            base = min(copies, key=lambda c: c.id)
        return base, []

    protected_copies = [c for c in copies if c.id in protected_ids]

    # 장착 캐릭터를 가장 먼저 기준 카드로 삼고, 그다음 PVP 편성 카드, 일반 카드를 고른다.
    base = next((c for c in protected_copies if c.is_equipped == 1), None)
    if base is None and protected_copies:
        base = min(protected_copies, key=lambda c: c.id)
    if base is None:
        base = min(copies, key=lambda c: c.id)

    materials = [
        c
        for c in sorted(copies, key=lambda c: c.id)
        if c.id != base.id and c.id not in protected_ids
    ][:material_count]

    if len(materials) < material_count:
        raise HTTPException(
            status_code=400,
            detail=(
                "장착 중이거나 PVP 방어 편성에 사용 중인 캐릭터는 재료로 사용할 수 없습니다. "
                f"기준 카드 외에 사용 가능한 동일 캐릭터 {material_count}장이 필요합니다."
            ),
        )

    return base, materials


def _select_replacement_equipped_character(
    db: Session,
    user: User,
    excluded_ids: set[int],
):
    replacement = (
        db.query(Character)
        .filter(
            Character.user_id == user.id,
            Character.id.notin_(excluded_ids),
        )
        .order_by(Character.star.desc(), Character.id.asc())
        .first()
    )

    if replacement:
        replacement.is_equipped = 1


def _apply_shift(rule: dict, params: dict) -> dict:
    """확률 일부를 한 항목에서 다른 항목으로 옮긴다. (예: 유지 -10%p -> 성공 +10%p)"""
    result = dict(rule)
    frm, to, amount = params["from"], params["to"], params["amount"]
    moved = min(amount, result.get(frm, 0))
    result[frm] = result.get(frm, 0) - moved
    result[to] = result.get(to, 0) + moved
    return result


def _apply_redistribute(rule: dict, params: dict) -> dict:
    """한 항목을 완전히 없애고, 남은 항목들에 지정된 비율대로 재분배한다."""
    result = dict(rule)
    remove_key = params["remove"]
    freed = result.get(remove_key, 0)
    ratio = params["ratio"]
    total_ratio = sum(ratio.values()) or 1
    for key, weight in ratio.items():
        result[key] = result.get(key, 0) + freed * (weight / total_ratio)
    result[remove_key] = 0
    return result


def _apply_force(rule: dict, params: dict) -> dict:
    """한 항목을 100%로 고정한다 (다른 항목은 전부 0%)."""
    outcome = params["outcome"]
    return {"success": 0, "maintain": 0, "destroy": 0, outcome: 100, "cost": rule.get("cost", 0)}


def _is_force_destroy_item(item: Item) -> bool:
    """"강 희의 파쇄기"(파괴 확률 100%로 고정)인지 판별한다.
    이 아이템만 가진 특수 규칙(다른 효과 무시 최우선 적용, 카드 1장으로 강화 가능)을
    이름이 아니라 effect_type/effect_params로 식별해서, seed 데이터의 이름이 바뀌어도 안전하다."""
    return item.effect_type == "force" and (item.effect_params or {}).get("outcome") == "destroy"


def _apply_enhancement_items(rule: dict, item_defs: list) -> dict:
    """
    선택된 강화 아이템들의 효과를 순서대로 적용한다.
    "강 희의 파쇄기"(파괴 강제)가 포함되어 있으면, 다른 아이템 효과는 전부 무시하고
    이것만 최우선으로 적용한다 (일반화하지 않고 이 아이템 하나를 콕 집어 처리 -
    나중에 다른 force류 아이템이 늘어나도 의도치 않게 "최우선"이 되지 않도록).
    """
    force_destroy = next((item for item in item_defs if _is_force_destroy_item(item)), None)
    if force_destroy:
        return _apply_force(rule, force_destroy.effect_params)

    result = dict(rule)
    for item in item_defs:
        if item.effect_type == "shift":
            result = _apply_shift(result, item.effect_params)
        elif item.effect_type == "redistribute":
            result = _apply_redistribute(result, item.effect_params)
        elif item.effect_type == "force":
            result = _apply_force(result, item.effect_params)
    return result


@router.post("/enhance")
def enhance_character(
    req: EnhancementRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """같은 이름·같은 성급 캐릭터 세 장으로 강화를 시도한다.
    (단, "강 희의 파쇄기"를 함께 쓰면 파괴가 확정이라 카드 한 장만으로도 시도할 수 있다.)

    - 성공: 기준 카드가 다음 성급이 되고 재료 두 장이 소모된다.
    - 유지: 기준 카드의 성급은 유지되고 재료 두 장이 소모된다.
    - 파괴: 기준 카드와 재료가 모두 소모된다.
    """
    if req.star not in ENHANCEMENT_RULES:
        raise HTTPException(
            status_code=400,
            detail="1성부터 5성 캐릭터까지만 강화할 수 있습니다.",
        )

    # 동시 요청으로 같은 카드가 중복 사용되지 않도록 사용자와 카드 행을 잠근다.
    locked_user = (
        db.query(User)
        .filter(User.id == user.id)
        .with_for_update()
        .first()
    )
    if not locked_user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    if len(req.item_ids) != len(set(req.item_ids)):
        raise HTTPException(status_code=400, detail="같은 아이템을 중복해서 선택할 수 없습니다.")

    selected_user_items = []
    for item_id in req.item_ids:
        user_item = (
            db.query(UserItem)
            .join(Item, Item.id == UserItem.item_id)
            .filter(
                UserItem.user_id == locked_user.id,
                UserItem.item_id == item_id,
                UserItem.quantity > 0,
                Item.item_type == "enhancement",
            )
            .with_for_update()
            .first()
        )
        if not user_item:
            raise HTTPException(status_code=400, detail="보유하지 않은 강화 아이템이 포함되어 있습니다.")
        selected_user_items.append(user_item)

    item_defs = [user_item.item for user_item in selected_user_items]

    # "강 희의 파쇄기"를 쓰면 파괴가 100% 확정이니, 재료로 희생시킬 카드 없이 단 1장만으로도
    # 강화(=파괴)를 시도할 수 있다. 그 외에는 기존 그대로 동일 캐릭터 3장이 필요하다.
    required_copies = 1 if any(_is_force_destroy_item(item) for item in item_defs) else ENHANCEMENT_REQUIRED_COPIES

    copies = (
        db.query(Character)
        .filter(
            Character.user_id == locked_user.id,
            Character.name == req.character_name,
            Character.star == req.star,
        )
        .order_by(Character.id.asc())
        .with_for_update()
        .all()
    )

    if len(copies) < required_copies:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{req.character_name} ★{req.star} 캐릭터가 "
                f"{required_copies}장 필요합니다."
            ),
        )

    base_rule = ENHANCEMENT_RULES[req.star]
    if locked_user.gold < base_rule["cost"]:
        raise HTTPException(
            status_code=400,
            detail=f"골드가 부족합니다. 강화에는 {base_rule['cost']}G가 필요합니다.",
        )

    rule = _apply_enhancement_items(base_rule, item_defs)

    base, materials = _choose_enhancement_cards(locked_user, copies, required_copies - 1)
    selected = [base, *materials]
    selected_ids = {c.id for c in selected}

    locked_user.gold -= base_rule["cost"]

    roll = _rng.uniform(0, 100)
    success_boundary = rule["success"]
    maintain_boundary = rule["success"] + rule["maintain"]

    if roll < success_boundary:
        outcome = "success"
    elif roll < maintain_boundary:
        outcome = "maintain"
    else:
        outcome = "destroy"

    # "강 희의 파쇄술" 히든 업적 보상 카드는 파괴되지 않는다 - 파괴 판정이 나와도 유지로 바뀐다.
    if outcome == "destroy" and any(c.is_indestructible for c in selected):
        outcome = "maintain"

    if outcome == "success":
        base.star = req.star + 1

        for material in materials:
            db.delete(material)

        consumed_count = len(materials)
        result_star = base.star
        message = f"강화 성공! {base.name}이(가) ★{result_star}이 되었습니다."

    elif outcome == "maintain":
        for material in materials:
            db.delete(material)

        consumed_count = len(materials)
        result_star = base.star
        message = (
            f"강화 수치가 유지되었습니다. "
            f"{base.name}은(는) ★{result_star} 상태로 남았습니다."
        )

    else:
        was_equipped = any(c.is_equipped == 1 for c in selected)

        if locked_user.pvp_defense_front_id in selected_ids:
            locked_user.pvp_defense_front_id = None
        if locked_user.pvp_defense_back_id in selected_ids:
            locked_user.pvp_defense_back_id = None

        for character in selected:
            character.is_equipped = 0
            db.delete(character)

        db.flush()

        if was_equipped:
            _select_replacement_equipped_character(
                db,
                locked_user,
                selected_ids,
            )

        consumed_count = len(selected)
        result_star = None
        message = (
            f"강화에 실패하여 {req.character_name} ★{req.star} "
            f"캐릭터 {consumed_count}장이 파괴되었습니다."
        )

    # 강화 아이템은 결과(성공/유지/파괴)와 무관하게, 사용한 시점에 소모된다.
    for user_item in selected_user_items:
        user_item.quantity -= 1
        if user_item.quantity <= 0:
            db.delete(user_item)

    db.add(ActivityLog(user_id=locked_user.id, activity_type="character_enhance"))  # 퀘스트("캐릭터 강화 시도") 판정용

    # 도전과제("강화 성공/파괴 누적", "아이템 사용 누적") 판정용.
    if outcome == "success":
        db.add(ActivityLog(user_id=locked_user.id, activity_type="character_enhance_success"))
    elif outcome == "destroy":
        db.add(ActivityLog(user_id=locked_user.id, activity_type="character_enhance_destroy"))
    if selected_user_items:
        db.add(ActivityLog(user_id=locked_user.id, activity_type="item_use"))

    # 히든 업적("ester CAD!") 판정용: 오페라 하우스 + 독서대를 "모두" 쓴 강화 성공을 캐릭터별로 기록.
    # ActivityLog에는 params 컬럼이 없어서 대상 캐릭터 이름을 activity_type 문자열에 함께 박는다.
    used_item_names = {item.name for item in item_defs}
    if outcome == "success" and {"윤영준의 오페라 하우스", "송주헌의 독서대"} <= used_item_names:
        db.add(ActivityLog(
            user_id=locked_user.id,
            activity_type=f"enhance_success_opera_desk:{req.character_name}",
        ))

    # 히든 업적("상남자") 판정용: 최고 단계(★5 -> ★6) 강화를 아이템 없이 시도.
    if req.star == 5 and not item_defs:
        db.add(ActivityLog(user_id=locked_user.id, activity_type="enhance_attempt_star6_no_item"))

    db.commit()

    remaining_same_star = (
        db.query(Character)
        .filter(
            Character.user_id == locked_user.id,
            Character.name == req.character_name,
            Character.star == req.star,
        )
        .count()
    )

    new_achievements, new_characters = check_and_grant_achievements(db, locked_user)

    return {
        "outcome": outcome,
        "message": message,
        "character_name": req.character_name,
        "star_before": req.star,
        "star_after": result_star,
        "consumed_count": consumed_count,
        "left_gold": locked_user.gold,
        "remaining_same_star": remaining_same_star,
        "roll": round(roll, 4),
        "rule": rule,
        "used_items": [item.name for item in item_defs],
        "new_achievements": new_achievements,
        "new_characters": new_characters,
    }


@router.post("/equip")
def equip_character(
    req: EquipRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = db.query(Character).filter(
        Character.id == req.character_id,
        Character.user_id == user.id,
    ).first()
    if not target:
        raise HTTPException(
            status_code=404,
            detail="본인 소유의 캐릭터가 아니거나 존재하지 않습니다.",
        )

    for c in user.characters:
        c.is_equipped = 0
    target.is_equipped = 1
    db.commit()

    return {
        "message": f"{target.name}을(를) 장착했습니다!",
        "equipped_character": target.name,
        "character_id": target.id,
        "outfit": target.outfit,
    }


@router.post("/apply-outfit")
def apply_character_outfit(
    req: CharacterOutfitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = db.query(Character).filter(
        Character.id == req.character_id,
        Character.user_id == user.id,
    ).first()
    if not target:
        raise HTTPException(
            status_code=404,
            detail="본인 소유의 캐릭터가 아니거나 존재하지 않습니다.",
        )

    catalog = CATALOG_BY_NAME.get(target.name)
    basic_outfit = catalog.get("outfits", {}).get("기본") if catalog else None

    allowed = req.outfit_file == basic_outfit
    if not allowed:
        owned = (
            db.query(UserItem)
            .join(Item, Item.id == UserItem.item_id)
            .filter(
                UserItem.user_id == user.id,
                Item.source_character == target.name,
                Item.outfit_file == req.outfit_file,
                UserItem.quantity > 0,
            )
            .first()
        )
        allowed = owned is not None

    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="이 캐릭터가 사용할 수 있는 보유 의상이 아닙니다.",
        )

    target.outfit = req.outfit_file
    db.commit()

    return {
        "message": f"{target.name}의 의상을 변경했습니다.",
        "character_id": target.id,
        "current_outfit": target.outfit,
    }