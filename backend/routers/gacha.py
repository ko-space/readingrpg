import random
import json
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import User, Character, GachaBanner, GachaBannerPickup, ActivityLog, Mail, GachaPullLog
from schemas import GachaSelectRequest
from security import get_current_user
from achievements import check_and_grant_achievements, resolve_character_reveal_info
from character_visibility import is_hidden_override

router = APIRouter(prefix="/gacha", tags=["gacha"])

with open("characters.json", "r", encoding="utf-8") as f:
    CHARACTER_POOL = json.load(f)

GACHA_COST = 100
GACHA_POINTS_PER_PULL = 1   # 모집 1회당 적립되는 모집 포인트 (성공/중복 여부와 무관)
DEFAULT_PICKUP_RATE_UP = 0.5  # gacha_banner_pickups.rate_up이 비어있을 때 쓰는 기본값 / rate_up = 2 / (N - 1)
RARITY_START_STAR = {"신화": 5, "전설": 4, "영웅": 3, "희귀": 2, "일반": 1}  # 모집 시 시작 성(星)
ADMIN_USER_ID = 1  # ranking.py/pvp.py와 동일한 관리자 계정 - is_hidden 캐릭터(예: 이의진)도 테스트로 뽑을 수 있는 예외
KST = timezone(timedelta(hours=9))

RARITY_TIER_PROBABILITY = {"신화": 0.005, "전설": 0.01, "영웅": 0.09, "희귀": 0.30, "일반": 0.595}

PICKUP_SCHEDULE = [
    {
        "start_at": datetime(2025, 1, 1, 0, 0, tzinfo=KST),  # 과거 날짜 = 이미 활성화된 최초 픽업
        "banner_name": "픽업모집",
        "image_file": "pickup-banner.webp",
        "characters": [{"character_name": "송주헌", "point_cost": 20, "rate_up": 0.99}],
    },
    {
        "start_at": datetime(2026, 8, 18, 21, 20, tzinfo=KST),
        "banner_name": "픽업모집",
        "image_file": "pickup-banner.webp",
        "characters": [{"character_name": "송주헌", "point_cost": 20, "rate_up": 0.99}],
    },
    {
        "start_at": datetime(2026, 8, 21, 21, 20, tzinfo=KST),
        "banner_name": "픽업모집",
        "image_file": "pickup-banner-new4.webp",
        "characters": [
            {"character_name": "김크장", "point_cost": 10, "rate_up": 0.3333},
            {"character_name": "김룡환", "point_cost": 20, "rate_up": 0.3333},
        ],
    },
    {
        "start_at": datetime(2026, 8, 24, 21, 20, tzinfo=KST),
        "banner_name": "픽업모집",
        "image_file": "pickup-banner-new5.webp",
        "characters": [
            {"character_name": "배", "point_cost": 30, "rate_up": 0.3333},
            {"character_name": "김국회", "point_cost": 100, "rate_up": 0.2857},
        ],
    },
    {
        "start_at": datetime(2026, 8, 27, 21, 20, tzinfo=KST),
        "banner_name": "픽업모집",
        "image_file": "pickup-banner-new6.webp",
        "characters": [
            {"character_name": "신", "point_cost": 200, "rate_up": 0.3333},
        ],
    },
]


def _to_utc_naive(dt: datetime) -> datetime:
    # DB DateTime 컬럼은 시간대 없는 UTC 기준(datetime.utcnow() 관례)이라, KST-aware 값을 그 형태로 맞춘다.
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _current_and_next_pickup():
    """지금 활성화돼야 할 픽업 일정과, 그 다음 픽업이 시작되는 시각(없으면 None - "기간 미정")을 같이 돌려준다."""
    now = datetime.now(KST)
    passed = sorted((p for p in PICKUP_SCHEDULE if p["start_at"] <= now), key=lambda p: p["start_at"])
    if not passed:
        return None, None
    current = passed[-1]
    upcoming = sorted((p for p in PICKUP_SCHEDULE if p["start_at"] > current["start_at"]), key=lambda p: p["start_at"])
    next_start_at = upcoming[0]["start_at"] if upcoming else None
    return current, next_start_at


def _sync_pickup_banner(db: Session):
    scheduled, next_start_at = _current_and_next_pickup()
    if not scheduled:
        return

    banner = db.query(GachaBanner).filter(GachaBanner.banner_type == "pickup").first()
    if not banner:
        return

    # 배너의 시작/종료 시각도 지금 활성화된 일정에 맞춰 항상 최신으로 맞춰둔다 - 로스터 변경 여부와
    # 무관하다(예: 지금 픽업은 그대로인데 "다음" 픽업 일정이 새로 추가되면 end_date만 새로 생긴다).
    new_start_date = _to_utc_naive(scheduled["start_at"])
    new_end_date = _to_utc_naive(next_start_at) if next_start_at else None
    dates_changed = banner.start_date != new_start_date or banner.end_date != new_end_date
    if dates_changed:
        banner.start_date = new_start_date
        banner.end_date = new_end_date

    existing_rows = db.query(GachaBannerPickup).filter(GachaBannerPickup.banner_id == banner.id).all()
    existing_set = {(row.character_name, row.point_cost) for row in existing_rows}
    new_set = {(c["character_name"], c["point_cost"]) for c in scheduled["characters"]}
    roster_changed = existing_set != new_set or banner.name != scheduled["banner_name"]

    if roster_changed:
        # 새 픽업이 시작됨 - 배너 정보와 픽업 캐릭터 목록을 통째로 교체(이전 픽업 캐릭터는 제거).
        banner.name = scheduled["banner_name"]
        banner.image_file = scheduled["image_file"]
        for row in existing_rows:
            db.delete(row)
        for c in scheduled["characters"]:
            kwargs = {"banner_id": banner.id, "character_name": c["character_name"], "point_cost": c["point_cost"]}
            if "rate_up" in c:
                kwargs["rate_up"] = c["rate_up"]
            db.add(GachaBannerPickup(**kwargs))
        db.commit()

        # 남은 모집 포인트를 골드로 즉시 지급하는 대신, 우편함으로 보낸다 - 신규 가입 축하금(auth.py)과
        # 동일한 패턴. 포인트가 0인 유저는 빈 우편이 쌓이지 않도록 건너뛴다 - SQL 단에서부터 걸러서
        # (0인 유저를 다시 0으로 덮어써봐야 no-op이므로) 전체 유저 테이블을 안 긁어온다(egress 절감).
        for u in db.query(User).filter(User.gacha_points > 0).all():
            db.add(Mail(
                user_id=u.id,
                title="모집 포인트가 골드로 전환되었습니다.",
                gold_amount=u.gacha_points,
            ))
            u.gacha_points = 0
        db.commit()
    else:
        # 캐릭터 구성은 그대로고 rate_up/이미지 파일명만 바뀌었을 수 있다 - "새 픽업"이 아니라 지금
        # 픽업의 세부 조정이므로 포인트 골드 전환 없이 값만 맞춘다.
        image_changed = banner.image_file != scheduled["image_file"]
        if image_changed:
            banner.image_file = scheduled["image_file"]
        rate_by_name = {c["character_name"]: c["rate_up"] for c in scheduled["characters"] if "rate_up" in c}
        row_changed = False
        for row in existing_rows:
            target_rate = rate_by_name.get(row.character_name)
            if target_rate is not None and row.rate_up != target_rate:
                row.rate_up = target_rate
                row_changed = True
        if row_changed or dates_changed or image_changed:
            db.commit()


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


def _pick_character_with_pickup(rarity: str, active_pickup_rates: dict, include_hidden: bool = False):
    """
    같은 등급 안에, 확률업이 걸린 픽업 캐릭터가 있으면 각자의 rate_up 확률로 그 캐릭터를 확정 지급하고,
    (여러 명이면 순서대로 하나씩 시도) 아무도 안 걸리면 그 등급 안에서 완전 균등 랜덤으로 뽑는다.
    include_hidden이 False면(일반 유저) is_hidden 캐릭터는 후보에서 아예 제외된다 - 아직 공개 전인
    캐릭터(예: 이의진)가 실수로 뽑히지 않게 하기 위함. 관리자는 True로 넘겨받아 테스트로 뽑을 수 있다.
    """
    tier = CHARACTER_POOL[rarity]
    if not include_hidden:
        tier = [c for c in tier if not is_hidden_override(c["name"], c.get("is_hidden", False))]
    tier_pickups = [c for c in tier if c["name"] in active_pickup_rates]

    for pickup_char in tier_pickups:
        if random.random() < active_pickup_rates[pickup_char["name"]]:
            return pickup_char
    return random.choice(tier)


def _pick_rarity() -> str:
    rand_val = random.random()
    cumulative = 0.0
    for tier_name, tier_prob in RARITY_TIER_PROBABILITY.items():
        cumulative += tier_prob
        if rand_val < cumulative:
            return tier_name
    return "일반"  # 부동소수점 오차 대비 fallback


def _perform_one_pull(db: Session, user: User, active_pickup_rates: dict, include_hidden: bool) -> dict:
    """등급/캐릭터 추첨부터 DB 반영(Character/ActivityLog/GachaPullLog)까지 한 번의 뽑기 전체를 수행하고,
    그 결과를 프론트 획득 연출이 바로 쓸 수 있는 dict로 돌려준다. 골드 차감/포인트 적립은 호출부 책임.

    실제 커밋(디스크 fsync 포함이라 원격 DB 왕복마다 눈에 띄게 느림)은 하지 않고 flush만 한다 - 10연차가
    이 함수를 10번 부르는 동안 매번 커밋하면 그 지연이 그대로 쌓여서(사용자 보고: "10연차 인물 접근 후
    터지는 이펙트가 너무 늦게 나옴") 인트로 연출이 다 끝나고도 한참 더 기다려야 했다. flush는 트랜잭션
    안에서 방금 추가한 행을 그 자리에서 곧바로 조회 가능하게만 만들고(아래 owned_names 쿼리가 이걸
    전제로 함) 실제 커밋은 호출부(pull_character/pull_character_ten)가 전부 끝난 뒤 한 번만 한다.

    owned_names는 매 호출마다 새로 조회해야 한다(10연차 도중 앞선 뽑기가 이미 같은 이름을 지급했을 수
    있어, 뒤의 뽑기가 그걸 "중복"으로 올바르게 인식해야 하기 때문) - 이때 user.characters(관계 캐시)
    대신 Character 테이블을 직접 새로 쿼리한다. user.characters는 커밋 시점에만 자동으로 새로고침되는데
    (SQLAlchemy expire_on_commit 기본값), 이제 커밋을 매번 안 하므로 그 캐시가 낡은 채로 남아있을 수
    있다 - 직접 쿼리는 이 캐시를 아예 안 거치므로(session.autoflush=False라도 이 함수 자신이 이미
    flush해뒀으므로) 항상 최신 상태를 본다."""
    rarity = _pick_rarity()
    picked_character = _pick_character_with_pickup(rarity, active_pickup_rates, include_hidden=include_hidden)

    owned_names = {row[0] for row in db.query(Character.name).filter(Character.user_id == user.id).all()}
    is_duplicate = picked_character["name"] in owned_names
    is_pickup = picked_character["name"] in active_pickup_rates

    new_row = Character(
        user_id=user.id,
        name=picked_character["name"],
        job_class=picked_character["job_class"],
        rarity=rarity,
        star=RARITY_START_STAR.get(rarity, 1),
        outfit=picked_character["outfits"]["기본"],
        is_equipped=0,
    )
    db.add(new_row)
    db.add(ActivityLog(user_id=user.id, activity_type="gacha_pull"))  # 퀘스트("모집 N회") 판정용
    db.add(GachaPullLog(  # 도전과제("N성 인물 모집", "픽업 인물 모집" 등) 판정용
        user_id=user.id, character_name=picked_character["name"], rarity=rarity, was_pickup=is_pickup,
    ))
    db.flush()
    db.refresh(new_row)

    return {
        "message": (
            f"'{picked_character['name']}' 카드 1장을 추가로 획득했습니다."
            if is_duplicate else picked_character["description"]
        ),
        "character": {
            "id": new_row.id,
            "name": new_row.name,
            "rarity": rarity,
            "job_class": new_row.job_class,
            "description": picked_character["description"],
            "gacha_quote": picked_character.get("gacha_quote"),
            "outfit": new_row.outfit,
            **resolve_character_reveal_info(new_row.name, new_row.star),
        },
        "is_duplicate": is_duplicate,
        "is_pickup": is_pickup,
    }


@router.post("/")
def pull_character(
    banner_id: int | None = None,  # 지금 화면에서 선택 중인 배너. 이게 픽업 배너일 때만 픽업 판정이 적용됨
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _sync_pickup_banner(db)

    # 골드 체크와 차감 사이 경합 방지(shop.py의 purchase_item과 동일한 이유) - 연타/다중 탭으로
    # 거의 동시에 두 번 뽑아도 한쪽만 통과하도록 이 유저 행을 요청이 끝날 때까지 잠근다.
    user = db.query(User).filter(User.id == user.id).with_for_update().first()

    if user.gold < GACHA_COST:
        raise HTTPException(status_code=400, detail="골드가 부족합니다.")

    # 아직 커밋하지 않는다 - 여기서 커밋하면 with_for_update 락이 곧바로 풀려버려서, 골드를 빼놓고
    # 아직 뽑기 결과를 반영하기 전인 짧은 틈에 다른 요청이 끼어들 수 있다(_perform_one_pull은 flush만
    # 하므로, 아래 db.commit()이 이 변경사항까지 한 트랜잭션으로 함께 반영하고 나서야 락이 풀린다).
    user.gold -= GACHA_COST
    user.gacha_points += GACHA_POINTS_PER_PULL

    active_pickup_rates = _get_active_pickup_rates(db, banner_id)
    result = _perform_one_pull(db, user, active_pickup_rates, include_hidden=(user.id == ADMIN_USER_ID))
    db.commit()
    new_achievements, new_characters = check_and_grant_achievements(db, user)

    return {
        **result,
        "left_gold": user.gold,
        "gacha_points": user.gacha_points,
        "new_achievements": new_achievements,
        "new_characters": new_characters,
    }


@router.post("/pull10")
def pull_character_ten(
    banner_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """10연차 - 단발(pull_character)과 동일한 확률/픽업 규칙으로 독립된 뽑기 10번을 한 요청에서 처리한다.
    할인 없이 정가(GACHA_COST * 10) 그대로 - 사용자 확정. 도전과제 알림은 10번 전부 끝난 뒤 한 번만
    확인해서(단발과 동일하게 "요청당 1번" 유지) 토스트가 10개씩 뜨지 않게 한다.

    _perform_one_pull이 매번 flush만 하고 실제 커밋은 이 함수 끝에서 딱 한 번만 한다 - 예전엔 10번 다
    각자 커밋해서(원격 DB 왕복마다 실제 디스크 fsync가 걸림) 그 지연이 그대로 쌓였고, 프론트 인트로
    연출이 다 끝난 뒤에도 응답을 한참 더 기다려야 해서 "간판인물이 다가간 뒤 빛 이펙트가 너무 늦게
    나온다"는 문제로 이어졌다(사용자 보고, 2026-08-20). 커밋을 1번으로 줄이면 이 대기가 대부분 사라진다."""
    _sync_pickup_banner(db)

    user = db.query(User).filter(User.id == user.id).with_for_update().first()

    total_cost = GACHA_COST * 10
    if user.gold < total_cost:
        raise HTTPException(status_code=400, detail="골드가 부족합니다.")

    # 단발과 동일한 이유로 여기서 커밋하지 않는다 - 루프가 끝난 뒤의 db.commit() 한 번이 이 골드
    # 차감까지 함께 반영하고 나서야 with_for_update 락이 풀린다.
    user.gold -= total_cost
    user.gacha_points += GACHA_POINTS_PER_PULL * 10

    active_pickup_rates = _get_active_pickup_rates(db, banner_id)
    include_hidden = user.id == ADMIN_USER_ID
    results = [_perform_one_pull(db, user, active_pickup_rates, include_hidden) for _ in range(10)]
    db.commit()

    new_achievements, new_characters = check_and_grant_achievements(db, user)

    return {
        "results": results,
        "left_gold": user.gold,
        "gacha_points": user.gacha_points,
        "new_achievements": new_achievements,
        "new_characters": new_characters,
    }


@router.get("/banners")
def get_banners(db: Session = Depends(get_db)):
    """지금 활성화된 가챠 배너들과, 각 배너의 픽업 캐릭터/필요 포인트/사진 정보를 돌려준다."""
    _sync_pickup_banner(db)
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
    _sync_pickup_banner(db)
    active_pickup_rates = _get_active_pickup_rates(db, banner_id)

    rarities = []
    for rarity in RARITY_ORDER:
        tier = [c for c in CHARACTER_POOL[rarity] if not is_hidden_override(c["name"], c.get("is_hidden", False))]
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
    _sync_pickup_banner(db)
    pickup = db.query(GachaBannerPickup).filter(GachaBannerPickup.id == req.pickup_id).first()
    if not pickup:
        raise HTTPException(status_code=404, detail="존재하지 않는 픽업 항목입니다.")

    # pull_character와 동일한 이유로 포인트 체크/차감 사이 경합을 막는다.
    user = db.query(User).filter(User.id == user.id).with_for_update().first()

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