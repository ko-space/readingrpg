from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import User, Item, UserItem, UserItemPurchase, UserDailyItemPurchase, Achievement, UserAchievement, ActivityLog
from schemas import PurchaseRequest, ApplyOutfitRequest
from security import get_current_user
from routers.users import _today_kst
from achievements import check_and_grant_achievements

router = APIRouter(prefix="/shop", tags=["shop"])


@router.get("/items")
def get_shop_items(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """
    상점 진열대. required_achievement/purchase_limit이 걸린 아이템(예: "초심자의 행운")도
    조건 미충족 상태 그대로 목록엔 보여주고, 프론트에서 구매 가능 여부를 판단할 수 있게
    achievement_unlocked/purchased_count를 같이 내려준다 - 실제 차단은 /purchase에서 한다.
    """
    items = db.query(Item).filter(Item.is_shop_active == True).all()

    purchased_counts = {
        row.item_id: row.total_purchased
        for row in db.query(UserItemPurchase).filter(UserItemPurchase.user_id == user.id).all()
    }
    today = _today_kst()
    daily_purchased_counts = {
        row.item_id: row.quantity
        for row in db.query(UserDailyItemPurchase).filter(
            UserDailyItemPurchase.user_id == user.id,
            UserDailyItemPurchase.purchase_date == today,
        ).all()
    }
    earned_achievement_names = {
        ua.achievement.name
        for ua in db.query(UserAchievement).filter(UserAchievement.user_id == user.id).all()
    }
    is_hidden_by_name = {ach.name: ach.is_hidden for ach in db.query(Achievement).all()}

    result = []
    for item in items:
        achievement_unlocked = (
            not item.required_achievement or item.required_achievement in earned_achievement_names
        )
        # 히든 업적이 조건이면, 달성 전까지는 이름 자체를 "???"로 가린다(achievements.py 목록과 동일한 규칙) -
        # 상점 문구를 통해 히든 업적의 이름이 미리 새어나가지 않도록 프론트가 아니라 여기서 가린다.
        required_achievement_display = item.required_achievement
        if item.required_achievement and not achievement_unlocked and is_hidden_by_name.get(item.required_achievement):
            required_achievement_display = "???"

        result.append({
            "id": item.id,
            "name": item.name,
            "item_type": item.item_type,
            "outfit_file": item.outfit_file,
            "icon_file": item.icon_file,
            "description": item.description,
            "season": item.season,
            "rarity": item.rarity,
            "price": item.price,
            "source_character": item.source_character,
            "effect_type": item.effect_type,
            "effect_params": item.effect_params,
            "required_achievement": required_achievement_display,
            "purchase_limit": item.purchase_limit,
            "purchased_count": purchased_counts.get(item.id, 0),
            "daily_purchase_limit": item.daily_purchase_limit,
            "daily_purchased_count": daily_purchased_counts.get(item.id, 0),
            "achievement_unlocked": achievement_unlocked,
        })

    return result


@router.get("/my-items")
def get_my_items(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(UserItem)
        .filter(UserItem.user_id == user.id, UserItem.quantity > 0)
        .all()
    )
    return [
        {
            "user_item_id": row.id,
            "item_id": row.item.id,
            "name": row.item.name,
            "quantity": row.quantity,
            "item_type": row.item.item_type,
            "outfit_file": row.item.outfit_file,
            "icon_file": row.item.icon_file,
            "description": row.item.description,
            "season": row.item.season,
            "rarity": row.item.rarity,
            "source_character": row.item.source_character,
            "effect_type": row.item.effect_type,
            "effect_params": row.item.effect_params,
        }
        for row in rows
    ]


@router.post("/purchase")
def purchase_item(
    req: PurchaseRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if req.quantity < 1:
        raise HTTPException(status_code=400, detail="구매 수량은 1개 이상이어야 합니다.")

    item = db.query(Item).filter(Item.id == req.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="아이템을 찾을 수 없습니다.")

    if item.source_character:
        owns_character = any(c.name == item.source_character for c in user.characters)
        if not owns_character:
            raise HTTPException(
                status_code=403,
                detail=f"'{item.source_character}' 보유 시 구매 가능",
            )

    if item.required_achievement:
        has_achievement = (
            db.query(UserAchievement)
            .join(Achievement, Achievement.id == UserAchievement.achievement_id)
            .filter(UserAchievement.user_id == user.id, Achievement.name == item.required_achievement)
            .first()
        )
        if not has_achievement:
            raise HTTPException(
                status_code=403,
                detail=f"'{item.required_achievement}' 업적 달성 시 구매 가능",
            )

    # 평생 누적 구매 기록. UserItem.quantity는 사용하면 줄어들어 신뢰할 수 없으니
    # 별도로 절대 줄어들지 않는 UserItemPurchase.total_purchased로 관리한다.
    # 한도(purchase_limit) 판정뿐 아니라 "티켓 자판기"처럼 누적 구매량을 조건으로 삼는
    # 업적 판정에도 쓰이므로, 한도 유무와 무관하게 모든 아이템의 구매를 기록한다.
    purchase_record = (
        db.query(UserItemPurchase)
        .filter(UserItemPurchase.user_id == user.id, UserItemPurchase.item_id == item.id)
        .first()
    )
    if item.purchase_limit is not None:
        already_purchased = purchase_record.total_purchased if purchase_record else 0
        if already_purchased + req.quantity > item.purchase_limit:
            raise HTTPException(
                status_code=400,
                detail=f"이 아이템은 최대 {item.purchase_limit}개까지만 구매할 수 있습니다. (이미 구매: {already_purchased}개)",
            )

    # 일일 구매 한도(KST 기준). 평생 한도(purchase_limit)와 별개로 병렬 체크한다.
    daily_record = None
    if item.daily_purchase_limit is not None:
        today = _today_kst()
        daily_record = (
            db.query(UserDailyItemPurchase)
            .filter(
                UserDailyItemPurchase.user_id == user.id,
                UserDailyItemPurchase.item_id == item.id,
                UserDailyItemPurchase.purchase_date == today,
            )
            .first()
        )
        already_purchased_today = daily_record.quantity if daily_record else 0
        if already_purchased_today + req.quantity > item.daily_purchase_limit:
            raise HTTPException(
                status_code=400,
                detail=f"이 아이템은 하루 최대 {item.daily_purchase_limit}개까지만 구매할 수 있습니다. (오늘 구매: {already_purchased_today}개)",
            )

    total_price = item.price * req.quantity
    if user.gold < total_price:
        raise HTTPException(status_code=400, detail="골드가 부족합니다.")

    user.gold -= total_price

    owned = db.query(UserItem).filter(
        UserItem.user_id == user.id, UserItem.item_id == item.id
    ).first()
    if owned:
        owned.quantity += req.quantity
    else:
        db.add(UserItem(user_id=user.id, item_id=item.id, quantity=req.quantity))

    if purchase_record:
        purchase_record.total_purchased += req.quantity
    else:
        db.add(UserItemPurchase(user_id=user.id, item_id=item.id, total_purchased=req.quantity))

    if item.daily_purchase_limit is not None:
        if daily_record:
            daily_record.quantity += req.quantity
        else:
            db.add(UserDailyItemPurchase(
                user_id=user.id, item_id=item.id, purchase_date=_today_kst(), quantity=req.quantity,
            ))

    if item.item_type == "enhancement":
        db.add(ActivityLog(user_id=user.id, activity_type="shop_purchase_enhancement"))  # 퀘스트("강화 아이템 구매") 판정용

    db.commit()

    # 누적 구매량을 조건으로 삼는 업적("티켓 자판기" 등) 판정 - 다른 라우터들과 동일하게 커밋 후 호출한다.
    new_achievements, _ = check_and_grant_achievements(db, user)

    return {
        "message": f"{item.name}을(를) {req.quantity}개 구매했습니다!",
        "item_name": item.name,
        "quantity": req.quantity,
        "left_gold": user.gold,
        "new_achievements": new_achievements,
    }


@router.post("/apply-outfit")
def apply_outfit(
    req: ApplyOutfitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    owned = db.query(UserItem).filter(
        UserItem.user_id == user.id, UserItem.item_id == req.item_id
    ).first()
    if not owned:
        raise HTTPException(status_code=400, detail="보유하지 않은 의상입니다.")

    item = db.query(Item).filter(Item.id == req.item_id).first()
    equipped_char = next((c for c in user.characters if c.is_equipped == 1), None)
    if not equipped_char:
        raise HTTPException(status_code=400, detail="장착 중인 캐릭터가 없습니다.")

    equipped_char.outfit = item.outfit_file
    db.commit()

    return {"message": f"{item.name}(으)로 갈아입었습니다!", "current_outfit": equipped_char.outfit}