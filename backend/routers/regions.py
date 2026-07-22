from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import User, Region
from security import get_current_user

router = APIRouter(prefix="/regions", tags=["regions"])

# 지역별 이미지 파일명. 새 지역을 추가할 땐 seed.py에 지역 추가하고, 여기에 한 줄만 추가
# (assets/regions/ 폴더에 이 파일명으로 이미지를 넣으면 프론트가 자동으로 씀 - 없으면 그라데이션으로 대체됨)
REGION_IMAGES = {
    "초심자의 평원": "region-beginner-plains.png",
    "잊혀진 서고": "region-forgotten-archive.png",
    "안개 낀 협곡": "region-misty-canyon.png",
    "지혜의 신전": "region-temple-wisdom.png",
    "투기장": "투기장.png",
}

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
            "image_file": REGION_IMAGES.get(r.name),
        }
        for r in regions
    ]

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

    user.current_region_id = next_region.id
    db.commit()
    return {"message": f"{next_region.name}(으)로 이동했습니다!", "current_region": next_region.name}