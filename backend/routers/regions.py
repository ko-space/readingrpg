from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import User, Region, UserRegionUnlock
from security import get_current_user

router = APIRouter(prefix="/regions", tags=["regions"])

# 지역별 이미지 파일명. 새 지역을 추가할 땐 seed.py에 지역 추가하고, 여기에 한 줄만 추가
# (assets/regions/ 폴더에 이 파일명으로 이미지를 넣으면 프론트가 자동으로 씀 - 없으면 그라데이션으로 대체됨)
REGION_IMAGES = {
    "초심자의 평원": "region-beginner-plains.webp",
    "잊혀진 서고": "region-forgotten-archive.webp",
    "안개 낀 협곡": "region-misty-canyon.webp",
    "지혜의 신전": "region-temple-wisdom.webp",
    "마법사의 은광": "region-mage-silver-mine.webp",
    "종말의 금광": "region-doomsday-gold-mine.webp",
    "투기장": "투기장.png",
}

# 레벨만으로는 부족하고 실버로 한 번 구매해야만 입장할 수 있는 지역 - {지역명: 구매 가격(실버)}.
# routers/logs.py의 GOLD_MINE_REGION_NAME과 같은 지역을 가리킨다(이 프로젝트 컨벤션상 파일마다 중복 선언).
PURCHASABLE_REGIONS = {"종말의 금광": 50000}

@router.get("/")
def get_regions(db: Session = Depends(get_db)):
    # always_open=True 투기장은 별도취급
    regions = (
        db.query(Region)
        .filter(Region.always_open == False)
        .order_by(Region.order.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "name": r.name,
            "order": r.order,
            "required_level": r.required_level,
            "description": r.description,
            "exp_rate": r.exp_rate,
            "silver_rate": r.silver_rate,
            "gold_rate": r.gold_rate,
            "subject_bonus_rules": r.subject_bonus_rules,
            "unlock_price_silver": PURCHASABLE_REGIONS.get(r.name),
            "image_file": REGION_IMAGES.get(r.name),
        }
        for r in regions
    ]


@router.post("/unlock")
def unlock_region(
    region_name: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    price = PURCHASABLE_REGIONS.get(region_name)
    if price is None:
        raise HTTPException(status_code=400, detail="구매로 해금할 수 있는 지역이 아닙니다.")

    region = db.query(Region).filter(Region.name == region_name).first()
    if not region:
        raise HTTPException(status_code=404, detail="존재하지 않는 지역입니다.")

    if user.level < region.required_level:
        raise HTTPException(
            status_code=400,
            detail=f"레벨 {region.required_level} 이상부터 구매할 수 있습니다.",
        )

    already = db.query(UserRegionUnlock).filter(
        UserRegionUnlock.user_id == user.id, UserRegionUnlock.region_id == region.id,
    ).first()
    if already:
        raise HTTPException(status_code=400, detail="이미 해금된 지역입니다.")

    # 조건부 UPDATE로 원자적으로 차감(shop.py 구매 로직과 동일한 이유 - 동시 요청으로 중복 차감 방지)
    locked_user = db.query(User).filter(User.id == user.id).with_for_update().first()
    if locked_user.silver < price:
        raise HTTPException(status_code=400, detail="실버가 부족합니다.")
    locked_user.silver -= price
    db.add(UserRegionUnlock(user_id=user.id, region_id=region.id))
    db.commit()

    return {"message": f"{region_name}이(가) 해금되었습니다!", "left_silver": locked_user.silver}


@router.get("/unlocked")
def get_unlocked_regions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = db.query(UserRegionUnlock).filter(UserRegionUnlock.user_id == user.id).all()
    region_ids = {row.region_id for row in rows}
    names = [r.name for r in db.query(Region).filter(Region.id.in_(region_ids)).all()]
    return {"unlocked_region_names": names}

@router.post("/advance")
def advance_region(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    current = db.query(Region).filter(Region.id == user.current_region_id).first()
    if not current or current.order is None:
        raise HTTPException(status_code=400, detail="현재 위치한 지역 정보를 확인할 수 없습니다.")

    next_region = (
        db.query(Region)
        .filter(Region.always_open == False, Region.order == current.order + 1)
        .first()
    )

    if not next_region:
        raise HTTPException(status_code=400, detail="최종 지역입니다.")

    if user.level < next_region.required_level:
        raise HTTPException(
            status_code=400,
            detail=f"레벨이 부족합니다. {next_region.name}은(는) 레벨 {next_region.required_level} 이상 필요합니다."
        )

    if next_region.name in PURCHASABLE_REGIONS:
        unlocked = db.query(UserRegionUnlock).filter(
            UserRegionUnlock.user_id == user.id, UserRegionUnlock.region_id == next_region.id,
        ).first()
        if not unlocked:
            raise HTTPException(status_code=400, detail=f"{next_region.name}은(는) 먼저 구매해야 합니다.")

    user.current_region_id = next_region.id
    db.commit()
    return {"message": f"{next_region.name}(으)로 이동했습니다!", "current_region": next_region.name}