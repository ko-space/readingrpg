import math
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Character, MarketListing, UserDailyMarketListing, MarketState, Mail, MarketActivityLog
from schemas import MarketRegisterRequest, MarketBuyRequest
from security import get_current_user
from achievements import check_and_grant_achievements

router = APIRouter(prefix="/market", tags=["market"])

KST = timezone(timedelta(hours=9))


def _today_kst():
    return datetime.now(KST).date()


def _kst_date_of(dt_utc_naive: datetime):
    """MarketListing.listed_at은 다른 모델들과 동일하게 naive-UTC로 저장된다 - KST 날짜로 변환해서
    "오늘 등록됐는지"를 판정한다."""
    return dt_utc_naive.replace(tzinfo=timezone.utc).astimezone(KST).date()


# 표시가(구매자 실지불액)는 등록가에 10% 수수료를 더해서 구한다(단, 수수료가 MARKET_MIN_FEE보다
# 낮으면 MARKET_MIN_FEE로 올려붙인다) - 재화 이원화 이후 거래소는 실버로 거래된다(활용처: 강화·거래·
# 상점 아이템 구매 = 실버). 성급별 등록 하한은 거래제도 개편으로 폐지 - 이제 1실버 이상이면 성급과
# 무관하게 등록할 수 있다(범위 체크만 VALID_MARKET_STARS로 유지).
VALID_MARKET_STARS = {1, 2, 3, 4, 5, 6}
MARKET_PRICE_CAP = 1_000_000  # 등록가(수수료 붙기 전) 상한
MARKET_FEE_MULTIPLIER = 1.2
MARKET_MIN_FEE = 500  # 수수료 하한 - 계산된 수수료가 이보다 낮으면 이 값으로 올려붙인다
MARKET_CAP = 10  # 거래소 전체 동시 매물 상한
DAILY_REGISTER_LIMIT = 2  # 인당 하루 최대 등록 개수(KST 기준)


def _compute_display_price(register_price: int) -> int:
    fee = max(math.ceil(register_price * (MARKET_FEE_MULTIPLIER - 1)), MARKET_MIN_FEE)
    return register_price + fee


def _expire_stale_listings(db: Session) -> None:
    """자정(KST)이 지나도록 안 팔린 매물을 판매자 인벤토리로 돌려준다. 이 프로젝트엔 스케줄러가
    없어서(mailbox.py의 _purge_expired_mail과 동일한 이유/방식), 거래소 관련 엔드포인트가 호출될
    때마다 조용히 훑어서 정리한다. 매 GET 조회마다 쓸데없이 행을 잠그지 않도록, 먼저 잠금 없이
    만료 후보가 있는지만 가볍게 확인하고 실제로 있을 때만 잠그고 되돌린다."""
    today = _today_kst()
    all_listings = db.query(MarketListing).all()
    stale_ids = [row.id for row in all_listings if _kst_date_of(row.listed_at) < today]
    if not stale_ids:
        return

    stale = (
        db.query(MarketListing)
        .filter(MarketListing.id.in_(stale_ids))
        .with_for_update()
        .all()
    )
    for listing in stale:
        character = (
            db.query(Character)
            .filter(Character.id == listing.character_id)
            .with_for_update()
            .first()
        )
        if character:
            character.user_id = listing.seller_id
        db.delete(listing)
    db.commit()


def _protected_character_ids(user: User) -> set:
    """장착 중이거나(캐릭터 자체 필드) 전술대회 방어 편성에 들어간(User의 FK 필드) 캐릭터 -
    characters.py의 _choose_enhancement_cards가 강화 재료 선택에서 이 카드들을 보호하는 것과
    동일한 이유로, 거래소 등록에서도 이 카드들은 자동 선택 대상에서 제외한다."""
    ids = {user.pvp_defense_front_id, user.pvp_defense_back_id, user.pvp_defense_supporter_id}
    ids.discard(None)
    return ids


def _pick_eligible_copy(user: User, copies: list):
    """같은 이름+성급의 보유 카드 중, 장착 중도 아니고 전술대회 방어 편성에도 안 쓰이는 사본을
    하나 고른다. 프론트가 character_id를 직접 안 보내는 이유는 schemas.MarketRegisterRequest의
    주석 참고 - 인벤토리 대표 카드가 장착 중인 사본으로 뽑히는 경우가 흔해서, 서버가 등록 가능한
    사본을 직접 찾아준다."""
    protected_ids = _protected_character_ids(user)
    for copy in copies:
        if copy.is_equipped == 1:
            continue
        if copy.id in protected_ids:
            continue
        return copy
    return None


def _nickname_map(db: Session, user_ids: set) -> dict:
    if not user_ids:
        return {}
    return dict(db.query(User.id, User.nickname).filter(User.id.in_(user_ids)).all())


def _serialize_listing(listing: MarketListing, nickname) -> dict:
    return {
        "id": listing.id,
        "seller_id": listing.seller_id,
        "seller_nickname": nickname,
        "name": listing.name,
        "rarity": listing.rarity,
        "star": listing.star,
        "outfit": listing.outfit,
        "job_class": listing.job_class,
        "display_price": listing.display_price,
        "listed_at": listing.listed_at.isoformat() if listing.listed_at else None,
    }


@router.get("/")
def list_market(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _expire_stale_listings(db)
    listings = db.query(MarketListing).order_by(MarketListing.listed_at.asc()).all()
    nicknames = _nickname_map(db, {row.seller_id for row in listings})
    return {
        "listings": [_serialize_listing(row, nicknames.get(row.seller_id)) for row in listings],
        "market_cap": MARKET_CAP,
        "my_user_id": user.id,
    }


@router.get("/my-listings")
def my_listings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _expire_stale_listings(db)
    listings = (
        db.query(MarketListing)
        .filter(MarketListing.seller_id == user.id)
        .order_by(MarketListing.listed_at.asc())
        .all()
    )

    today = _today_kst()
    daily_record = (
        db.query(UserDailyMarketListing)
        .filter(UserDailyMarketListing.user_id == user.id, UserDailyMarketListing.listing_date == today)
        .first()
    )

    return {
        "listings": [_serialize_listing(row, user.nickname) for row in listings],
        "registered_today": daily_record.count if daily_record else 0,
        "daily_limit": DAILY_REGISTER_LIMIT,
    }


@router.post("/register")
def register_listing(
    req: MarketRegisterRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _expire_stale_listings(db)

    if req.star not in VALID_MARKET_STARS:
        raise HTTPException(status_code=400, detail="1성부터 6성 캐릭터까지만 등록할 수 있습니다.")

    if req.price < 1:
        raise HTTPException(status_code=400, detail="가격은 1실버 이상이어야 합니다.")

    if req.price > MARKET_PRICE_CAP:
        raise HTTPException(
            status_code=400,
            detail=f"가격은 최대 {MARKET_PRICE_CAP:,}실버까지 등록할 수 있습니다.",
        )

    # 거래소 전체 매물 상한(10개) 체크는 서로 다른 판매자(=서로 다른 User 행)끼리 경합할 수 있어서,
    # 각자 자기 User 행만 잠그는 걸로는 못 막는다 - 등록 시도끼리를 이 단일 잠금 행으로 직렬화한
    # 뒤에 COUNT를 다시 확인한다(MarketState 주석 참고).
    db.query(MarketState).filter(MarketState.id == 1).with_for_update().first()

    locked_user = db.query(User).filter(User.id == user.id).with_for_update().first()
    if not locked_user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    today = _today_kst()
    daily_record = (
        db.query(UserDailyMarketListing)
        .filter(UserDailyMarketListing.user_id == locked_user.id, UserDailyMarketListing.listing_date == today)
        .with_for_update()
        .first()
    )
    already_today = daily_record.count if daily_record else 0
    if already_today >= DAILY_REGISTER_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"오늘은 더 이상 캐릭터를 등록할 수 없습니다. (하루 최대 {DAILY_REGISTER_LIMIT}개)",
        )

    active_count = db.query(MarketListing).count()
    if active_count >= MARKET_CAP:
        raise HTTPException(
            status_code=400,
            detail=f"지금은 거래소에 매물이 가득 찼습니다. (최대 {MARKET_CAP}개)",
        )

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
    if not copies:
        raise HTTPException(status_code=404, detail="본인 소유의 캐릭터가 아니거나 존재하지 않습니다.")

    character = _pick_eligible_copy(locked_user, copies)
    if character is None:
        raise HTTPException(
            status_code=400,
            detail="장착 중이거나 전술대회 방어 편성에 사용 중인 캐릭터라 등록할 수 있는 카드가 없습니다.",
        )

    display_price = _compute_display_price(req.price)

    listing = MarketListing(
        seller_id=locked_user.id,
        character_id=character.id,
        name=character.name,
        rarity=character.rarity,
        star=character.star,
        outfit=character.outfit,
        job_class=character.job_class,
        register_price=req.price,
        display_price=display_price,
        listed_at=datetime.utcnow(),
    )
    db.add(listing)
    character.user_id = None  # 인벤토리/강화/PVP 편성 등 user_id 기준 조회 전부에서 자동으로 사라짐

    # 퀘스트/도전과제("인물 등록 N회", "N성 이상 인물 등록" 등) 판정용 이력 - MarketListing 자체는
    # 판매/만료 즉시 삭제되므로 이력이 따로 안 남는다.
    db.add(MarketActivityLog(
        user_id=locked_user.id, action="register", star=character.star, character_name=character.name,
    ))

    if daily_record:
        daily_record.count += 1
    else:
        db.add(UserDailyMarketListing(user_id=locked_user.id, listing_date=today, count=1))

    db.commit()
    db.refresh(listing)

    new_achievements, new_characters = check_and_grant_achievements(db, locked_user)

    return {
        "message": f"{character.name}을(를) 거래소에 등록했습니다.",
        "listing_id": listing.id,
        "display_price": display_price,
        "new_achievements": new_achievements,
        "new_characters": new_characters,
    }


@router.post("/buy")
def buy_listing(
    req: MarketBuyRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _expire_stale_listings(db)

    listing = (
        db.query(MarketListing)
        .filter(MarketListing.id == req.listing_id)
        .with_for_update()
        .first()
    )
    if not listing:
        raise HTTPException(status_code=400, detail="이미 판매되었거나 만료된 매물입니다.")

    buyer = db.query(User).filter(User.id == user.id).with_for_update().first()
    if not buyer:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    if buyer.id == listing.seller_id:
        raise HTTPException(status_code=400, detail="자신이 등록한 캐릭터는 구매할 수 없습니다.")

    if buyer.silver < listing.display_price:
        raise HTTPException(status_code=400, detail="실버가 부족합니다.")

    character = (
        db.query(Character)
        .filter(Character.id == listing.character_id)
        .with_for_update()
        .first()
    )
    if not character or character.user_id is not None:
        # 리스팅이 살아있는 한 캐릭터의 user_id는 항상 NULL이어야 한다(이론상 도달 불가) - 방어적 체크.
        raise HTTPException(status_code=400, detail="이미 판매되었거나 만료된 매물입니다.")

    buyer.silver -= listing.display_price
    character.user_id = buyer.id

    db.add(MarketActivityLog(
        user_id=buyer.id, action="buy", star=listing.star, character_name=listing.name,
    ))

    # 판매자 정산은 즉시 silver를 더하는 대신 우편함으로 보낸다 - pvp.py가 방어 승리 보상을 지급할 때와
    # 동일한 이유: 이 요청 안에서 구매자와 판매자 두 User 행을 동시에 잠그지 않기 위해서다.
    db.add(Mail(
        user_id=listing.seller_id,
        title="인력 거래소 판매 완료",
        body=f"'{listing.name}' 인물이 판매되었습니다.",
        silver_amount=listing.register_price,
    ))

    listing_name = listing.name
    listing_star = listing.star
    db.delete(listing)
    db.commit()
    db.refresh(buyer)

    new_achievements, new_characters = check_and_grant_achievements(db, buyer)

    return {
        "message": f"{listing_name}을(를) 구매했습니다!",
        "character_name": listing_name,
        "star": listing_star,
        "left_silver": buyer.silver,
        "new_achievements": new_achievements,
        "new_characters": new_characters,
    }
