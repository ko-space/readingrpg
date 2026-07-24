import json
from database import SessionLocal
from models import (
    Item, Region, Achievement, GachaBanner, GachaBannerPickup, Quest, UserQuestClaim,
    UserItem, UserItemPurchase, UserDailyItemPurchase, Notice, Challenge,
)

with open("characters.json", "r", encoding="utf-8") as f:
    CHARACTER_POOL = json.load(f)

RARITY_PRICE = {"일반": 100, "희귀": 300, "영웅": 700, "전설": 1500}
SEASON_MULTIPLIER = {"기본": 1.0, "여름": 1.5, "겨울": 1.5}

# 수영복 스킨은 일반 계절 의상과 달리 상점에 상시 진열되는 고가 스킨.
# (구매 로직 자체는 열려 있지만, 착용 이펙트가 구현되기 전까지는 사실상 못 사게 가격을 높게 잡아둠)
SWIMSUIT_SEASON = "수영복"
SWIMSUIT_PRICE = 1_000_000

def seed_shop_items():
    db = SessionLocal()
    try:
        # 캐릭터 이름 + 계절 조합으로 중복을 판단한다.
        # (outfit_file 기준으로 하면, 서로 다른 캐릭터가 같은 이미지 파일을 공유할 때
        #  한쪽이 이미 있다는 이유로 다른 쪽이 통째로 빠지는 버그가 생긴다.)
        existing_rows = {
            (row.source_character, row.season): row
            for row in db.query(Item).filter(Item.item_type == "outfit").all()
        }
        changed = False

        for rarity, char_list in CHARACTER_POOL.items():
            base_price = RARITY_PRICE.get(rarity, 100)
            for char in char_list:
                for season, outfit_file in char["outfits"].items():
                    key = (char["name"], season)

                    if season == SWIMSUIT_SEASON:
                        # 문구는 "OOO의 수영복 의상"이 아니라 "수영복 OOO"으로 통일한다.
                        name = f"수영복 {char['name']}"
                        price = SWIMSUIT_PRICE
                        is_active = True
                    else:
                        name = f"{char['name']}의 {season} 의상"
                        price = int(base_price * SEASON_MULTIPLIER.get(season, 1.0))
                        is_active = False  # 의상은 한정판매 시스템으로 노출 - 관리자가 직접 활성화하기 전까진 상점에 안 뜸

                    row = existing_rows.get(key)
                    if row:
                        # 수영복 스킨은 이름/가격/진열 여부가 코드에서 정한 값과 항상 일치해야 하므로 매번 갱신.
                        # 일반 계절 의상은 관리자가 직접 활성화했을 수 있어 is_shop_active를 건드리지 않는다.
                        if season == SWIMSUIT_SEASON:
                            row.name = name
                            row.outfit_file = outfit_file
                            row.price = price
                            row.is_shop_active = True
                            changed = True
                        continue

                    db.add(Item(
                        name=name,
                        item_type="outfit",
                        outfit_file=outfit_file,
                        season=season,
                        rarity=rarity,
                        price=price,
                        source_character=char["name"],
                        is_shop_active=is_active,
                    ))
                    existing_rows[key] = True
                    changed = True

        # 청년/송주헌의 예전 "여름 의상"은 수영복 스킨으로 대체되었다(characters.json에서 제거됨).
        # DB에 남은 행을 지우지 않으면 유령 항목으로 계속 남으므로, 참조 기록부터 같이 정리한다.
        for char_name in ("청년", "송주헌"):
            stale_rows = db.query(Item).filter(
                Item.item_type == "outfit",
                Item.source_character == char_name,
                Item.season == "여름",
            ).all()
            for stale in stale_rows:
                db.query(UserItem).filter(UserItem.item_id == stale.id).delete()
                db.query(UserItemPurchase).filter(UserItemPurchase.item_id == stale.id).delete()
                db.query(UserDailyItemPurchase).filter(UserDailyItemPurchase.item_id == stale.id).delete()
                db.delete(stale)
                changed = True

        if changed:
            db.commit()
    finally:
        db.close()

def seed_enhancement_items():
    """
    강화 도움 아이템. 효과는 코드에 if문으로 박아넣지 않고 effect_type/effect_params(데이터)로 표현한다 -
    나중에 아이템이 늘어나도 characters.py의 계산 로직(shift/redistribute/force 세 종류)은 안 건드리고
    이 함수에 행만 추가하면 된다.
    """
    db = SessionLocal()
    try:
        items = [
            {
                "name": "송주헌의 독서대",
                "source_character": "송주헌",
                "price": 300,
                "icon_file": "assets/items/songjuheon_desk.png",
                "description": "방치되어 있지만 존재는 합니다.",
                "effect_type": "shift",
                "effect_params": {"from": "maintain", "to": "success", "amount": 10},
            },
            {
                "name": "김남옥의 크레파스",
                "source_character": "김남옥",
                "price": 300,
                "icon_file": "assets/items/namok_crayon.png",
                "description": "어린이가 사용하는 물건이니 조심히 다루세요.",
                "effect_type": "shift",
                "effect_params": {"from": "destroy", "to": "maintain", "amount": 10},
            },
            {
                "name": "윤영준의 오페라 하우스",
                "source_character": "윤영준",
                "price": 1500,
                "icon_file": "assets/items/youngjun_opera.png",
                "description": "조심하세요. 윤영준의 수행평가는 복불복입니다.",
                "effect_type": "redistribute",
                "effect_params": {"remove": "maintain", "ratio": {"success": 1.5, "destroy": 1}},
            },
            {
                "name": "강 희의 파쇄기",
                "source_character": "강 희",
                "price": 50,
                "icon_file": "assets/items/ganghee_shredder.png",
                "description": "이것은 어디에다가 쓰는 걸까요?",
                "effect_type": "force",
                "effect_params": {"outcome": "destroy"},
            },
            {
                "name": "초심자의 행운",
                "source_character": None,
                "required_achievement": "튜닝의 끝은 순정",
                "purchase_limit": 1,
                "price": 1000,
                "icon_file": "assets/items/초심자의 행운.png",
                "description": "튜닝의 끝은 순정입니다.",
                "effect_type": "force",
                "effect_params": {"outcome": "success"},
            },
        ]

        existing_rows = {row.name: row for row in db.query(Item).filter(Item.item_type == "enhancement").all()}
        changed = False

        for item in items:
            row = existing_rows.get(item["name"])
            if row:
                # 이미 있는 행이면 최신 값으로 갱신한다(icon_file 등을 나중에 추가/수정해도
                # 서버 재시작만으로 반영되게 하기 위함 - 예전엔 "이미 있으면 건너뛰기"만 해서
                # icon_file 같은 새 필드가 기존 행엔 절대 안 채워지는 문제가 있었다).
                row.price = item["price"]
                row.icon_file = item["icon_file"]
                row.description = item["description"]
                row.source_character = item.get("source_character")
                row.effect_type = item["effect_type"]
                row.effect_params = item["effect_params"]
                row.required_achievement = item.get("required_achievement")
                row.purchase_limit = item.get("purchase_limit")
                row.is_shop_active = True
            else:
                db.add(Item(
                    name=item["name"],
                    item_type="enhancement",
                    rarity="희귀",
                    price=item["price"],
                    icon_file=item["icon_file"],
                    description=item["description"],
                    source_character=item.get("source_character"),
                    effect_type=item["effect_type"],
                    effect_params=item["effect_params"],
                    required_achievement=item.get("required_achievement"),
                    purchase_limit=item.get("purchase_limit"),
                    is_shop_active=True,
                ))
            changed = True

        if changed:
            db.commit()
    finally:
        db.close()


def seed_currency_items():
    """재화 아이템(강화/의상과 별개인 item_type="currency"). 강화 아이템과 동일한
    upsert 패턴(existing_rows by name)을 그대로 따른다."""
    db = SessionLocal()
    try:
        items = [
            {
                "name": "스토리모드 티켓",
                "price": 25,
                "icon_file": "assets/items/story_ticket.png",
                "description": "인연 스토리에서 씬을 하나 볼 때마다 1장씩 사용됩니다.",
                "daily_purchase_limit": 5,
            },
            {
                "name": "투기장모드 티켓",
                "price": 4,
                "icon_file": "assets/items/arena_ticket.png",
                "description": "전술경연 대회에서 전투를 시도할 때마다 1장씩 사용됩니다.",
                "daily_purchase_limit": 10,
            },
        ]

        existing_rows = {row.name: row for row in db.query(Item).filter(Item.item_type == "currency").all()}
        changed = False

        for item in items:
            row = existing_rows.get(item["name"])
            if row:
                row.price = item["price"]
                row.icon_file = item["icon_file"]
                row.description = item["description"]
                row.daily_purchase_limit = item.get("daily_purchase_limit")
                row.is_shop_active = True
            else:
                db.add(Item(
                    name=item["name"],
                    item_type="currency",
                    rarity="희귀",
                    price=item["price"],
                    icon_file=item["icon_file"],
                    description=item["description"],
                    daily_purchase_limit=item.get("daily_purchase_limit"),
                    is_shop_active=True,
                ))
            changed = True

        if changed:
            db.commit()
    finally:
        db.close()


def seed_regions():
    # 지역 = 던전. 하나의 장소가 곧 "레벨이 되면 열리는 지역"이자 "독서 세션을 진행하는 던전"이다.
    db = SessionLocal()
    try:
        if db.query(Region).count() == 0:
            REGIONS = [
                {
                    "name": "초심자의 평원",
                    "order": 1,
                    "required_level": 1,
                    "always_open": False,
                    "description": "평화로운 초원의 모습과 잔잔한 자연 백색소음이 들려온다.",
                    "exp_rate": 1.0,
                    "gold_rate": 0.0,
                },
                {
                    "name": "잊혀진 서고",
                    "order": 2,
                    "required_level": 5,
                    "always_open": False,
                    "description": "먼지 쌓인 책장 사이로 은은한 종이 냄새가 감돈다.",
                    "exp_rate": 1.2,
                    "gold_rate": 0.0,
                },
                {
                    "name": "안개 낀 협곡",
                    "order": 3,
                    "required_level": 10,
                    "always_open": False,
                    "description": "짙은 안개 속에서 무언가 부스럭거리는 소리가 들려온다.",
                    "exp_rate": 1.4,
                    "gold_rate": 0.0,
                },
                {
                    "name": "지혜의 신전",
                    "order": 4,
                    "required_level": 25,
                    "always_open": False,
                    "description": "고요한 정적 속에 오래된 지혜가 깃들어 있는 듯하다.",
                    "exp_rate": 1.8,
                    "gold_rate": 0.0,
                },
                {
                    "name": "투기장",
                    "order": None,
                    "required_level": 1,
                    "always_open": True,
                    "description": "거친 함성과 무기 부딪히는 소리로 가득한 전장이다.",
                    "exp_rate": 0.5,
                    "gold_rate": 1.0,
                },
            ]
            for region in REGIONS:
                db.add(Region(**region))
            db.commit()
    finally:
        db.close()

ACHIEVEMENTS = [
    # ── 일반 업적 ──────────────────────────────────────────
    {
        "name": "개명인",
        "description": "윤대웅과 윤영준을 모두 보유",
        "condition_type": "own_characters",
        "condition_value": 1,
        "condition_params": {"names": ["윤대웅", "윤영준"]},
        "reward_gold": 500,
    },
    {
        "name": "삼총사 조련사",
        "description": "서민석, 강승유, 송주헌을 ★3 이상으로 보유",
        "condition_type": "own_characters_star",
        "condition_value": 3,
        "condition_params": {"names": ["서민석", "강승유", "송주헌"], "star": 3},
        "reward_gold": 333,
        "reward_exp": 333,
        "reward_items": [{"type": "item", "name": "송주헌의 독서대", "quantity": 3}],
    },
    {
        "name": "마법사 조련사",
        "description": "임소정, 이종복, 최재혁을 ★4 이상으로 보유",
        "condition_type": "own_characters_star",
        "condition_value": 3,
        "condition_params": {"names": ["임소정", "이종복", "최재혁"], "star": 4},
        "reward_items": [
            {"type": "character", "name": "임소정", "quantity": 2},
            {"type": "character", "name": "이종복", "quantity": 2},
            {"type": "character", "name": "최재혁", "quantity": 2},
        ],
    },
    {
        "name": "독서광",
        "description": "하루 독서 시간 5시간 달성",
        "condition_type": "daily_session_minutes",
        "condition_value": 300,
        "condition_params": {"session_type": "reading"},
        "reward_gold": 50,
    },
    {
        "name": "첫 페이지를 넘기다",
        "description": "지역 입장 1회 달성",
        "condition_type": "reading_session_count",
        "condition_value": 1,
        "reward_gold": 25,
    },
    {
        "name": "투기광",
        "description": "투기장 PVP 100승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 100,
        "reward_gold": 500,
    },
    {
        "name": "몰입의 시작",
        "description": "누적 경험치 100 달성",
        "condition_type": "total_exp",
        "condition_value": 100,
        "reward_gold": 25,
    },
    {
        "name": "고요한 집중력",
        "description": "누적 경험치 250 달성",
        "condition_type": "total_exp",
        "condition_value": 250,
        "reward_gold": 25,
    },
    {
        "name": "지식의 폭풍",
        "description": "누적 경험치 500 달성",
        "condition_type": "total_exp",
        "condition_value": 500,
        "reward_gold": 25,
    },
    {
        "name": "불멸의 독서가",
        "description": "누적 경험치 1000 달성",
        "condition_type": "total_exp",
        "condition_value": 1000,
        "reward_gold": 25,
    },
    {
        "name": "전설의 서고지기",
        "description": "누적 경험치 2000 달성",
        "condition_type": "total_exp",
        "condition_value": 2000,
        "reward_gold": 25,
    },
    {
        "name": "성장하는 모험가",
        "description": "레벨 10에 도달",
        "condition_type": "level",
        "condition_value": 10,
        "reward_gold": 50,
    },
    {
        "name": "황금의 사냥꾼",
        "description": "누적 골드 1000 획득",
        "condition_type": "gold",
        "condition_value": 1000,
        "reward_gold": 50,
    },
    {
        "name": "업적 사냥꾼",
        "description": "업적 10개 달성",
        "condition_type": "achievement_count",
        "condition_value": 10,
        "reward_gold": 100,
    },
    {
        "name": "스토리 수집가",
        "description": "인연 스토리 도감 CG 1장 수집",
        "condition_type": "cg_count",
        "condition_value": 1,
        "reward_gold": 50,
    },
    {
        "name": "이야기꾼",
        "description": "인연 스토리 도감 CG 4장 수집",
        "condition_type": "cg_count",
        "condition_value": 4,
        "reward_gold": 100,
    },
    {
        "name": "노벨 문학상",
        "description": "인연 스토리 도감 CG 10장 수집",
        "condition_type": "cg_count",
        "condition_value": 10,
        "reward_gold": 300,
    },
    {
        "name": "실모단",
        "description": "모의고사 20회 시행",
        "condition_type": "session_type_count",
        "condition_value": 20,
        "condition_params": {"session_type": "mock_exam"},
        "reward_gold": 100,
    },
    {
        "name": "담요단",
        "description": "기타 공부 누적 24시간 달성",
        "condition_type": "subject_minutes",
        "condition_value": 1440,
        "condition_params": {"subjects": ["기타"]},
        "reward_gold": 100,
    },
    {
        "name": "국어의 왕",
        "description": "국어 공부 누적 24시간 달성",
        "condition_type": "subject_minutes",
        "condition_value": 1440,
        "condition_params": {"subjects": ["국어"]},
        "reward_gold": 50,
    },
    {
        "name": "영어의 왕",
        "description": "영어 공부 누적 24시간 달성",
        "condition_type": "subject_minutes",
        "condition_value": 1440,
        "condition_params": {"subjects": ["영어"]},
        "reward_gold": 50,
    },
    {
        "name": "수학의 왕",
        "description": "수학 공부 누적 24시간 달성",
        "condition_type": "subject_minutes",
        "condition_value": 1440,
        "condition_params": {"subjects": ["수학"]},
        "reward_gold": 50,
    },
    {
        "name": "탐구의 왕",
        "description": "탐구 공부 누적 24시간 달성",
        "condition_type": "subject_minutes",
        "condition_value": 1440,
        "condition_params": {"subjects": ["탐구"]},
        "reward_gold": 50,
    },
    {
        "name": "국어의 신",
        "description": "국어 공부 누적 100시간 달성",
        "condition_type": "subject_minutes",
        "condition_value": 6000,
        "condition_params": {"subjects": ["국어"]},
        "reward_gold": 100,
    },
    {
        "name": "영어의 신",
        "description": "영어 공부 누적 100시간 달성",
        "condition_type": "subject_minutes",
        "condition_value": 6000,
        "condition_params": {"subjects": ["영어"]},
        "reward_gold": 100,
    },
    {
        "name": "수학의 신",
        "description": "수학 공부 누적 100시간 달성",
        "condition_type": "subject_minutes",
        "condition_value": 6000,
        "condition_params": {"subjects": ["수학"]},
        "reward_gold": 100,
    },
    {
        "name": "탐구의 신",
        "description": "탐구 공부 누적 100시간 달성",
        "condition_type": "subject_minutes",
        "condition_value": 6000,
        "condition_params": {"subjects": ["탐구"]},
        "reward_gold": 100,
    },
    {
        "name": "공부의 왕",
        "description": "공부 누적 100시간 달성",
        "condition_type": "study_minutes",
        "condition_value": 6000,
        "reward_gold": 50,
    },
    {
        "name": "공부의 신",
        "description": "공부 누적 300시간 달성",
        "condition_type": "study_minutes",
        "condition_value": 18000,
        "reward_gold": 100,
    },
    {
        "name": "티켓 자판기",
        "description": "스토리모드 티켓 100장 구매",
        "condition_type": "item_purchase_total",
        "condition_value": 100,
        "condition_params": {"item_name": "스토리모드 티켓"},
        "reward_gold": 500,
    },
    # ── 히든 업적 ──────────────────────────────────────────
    {
        "name": "강 희의 파쇄술",
        "description": "인벤토리의 모든 캐릭터를 파괴",
        "condition_type": "empty_inventory",
        "condition_value": 1,
        "is_hidden": True,
        # 보상 윤영준은 파괴되지 않는 특별판. 청년 ★1도 같이 지급된다(PVP 자동 배치 시스템이
        # 최소 편성 인원을 요구하기 때문에, 빈 인벤토리 상태로 남지 않게 한다).
        "reward_items": [
            {"type": "character", "name": "윤영준", "quantity": 1, "indestructible": True},
            {"type": "character", "name": "청년", "quantity": 1},
        ],
    },
    {
        "name": "튜닝의 끝은 순정",
        "description": "★6 청년 보유",
        "condition_type": "character_star",
        "condition_value": 1,
        "condition_params": {"name": "청년", "star": 6},
        "is_hidden": True,
        "reward_gold": 9999,
    },
    {
        "name": "제작자의 가호",
        "description": "PVP에서 청년과 송주헌의 조합으로 100승 달성",
        "condition_type": "combo_pvp_wins",
        "condition_value": 100,
        "condition_params": {"names": ["청년", "송주헌"]},
        "is_hidden": True,
        "reward_items": [
            {"type": "character", "name": "청년", "quantity": 100},
            {"type": "character", "name": "송주헌", "quantity": 100},
        ],
    },
    {
        "name": "히든 업적 달성!",
        "description": "히든 업적 3개 이상 달성",
        "condition_type": "hidden_achievement_count",
        "condition_value": 3,
        "is_hidden": True,
        "reward_gold": 5000,
    },
    {
        "name": "Ep.1 히든 엔딩",
        "description": "인연 스토리 Episode 1 히든 엔딩 CG 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": "ep1_yoondaewoong", "cg_id": "hidden"},
        "is_hidden": True,
        "reward_items": [{"type": "character", "name": "윤대웅", "quantity": 1}],
    },
    {
        "name": "ester CAD!",
        "description": "윤영준과 송주헌을 윤영준의 오페라 하우스와 송주헌의 독서대를 모두 사용하여 각각 1회 이상 강화 성공",
        "condition_type": "activity_types_all",
        "condition_value": 2,
        "condition_params": {"types": ["enhance_success_opera_desk:윤영준", "enhance_success_opera_desk:송주헌"]},
        "is_hidden": True,
        "reward_gold": 1362,
    },
    {
        "name": "허수",
        "description": "지역 입장 10회 연속 1시간 미만 플레이 타임 달성",
        "condition_type": "short_session_streak",
        "condition_value": 10,
        "condition_params": {"max_minutes": 60},
        "is_hidden": True,
        "reward_gold": 666,
    },
    {
        "name": "상남자",
        "description": "★6 강화 단계에서 강화 아이템 없이 강화 시도 1회 달성",
        "condition_type": "activity_total",
        "condition_value": 1,
        "condition_params": {"activity_type": "enhance_attempt_star6_no_item"},
        "is_hidden": True,
        "reward_gold": 9999,
    },
    {
        "name": "ALL COLLECTOR",
        "description": "모든 캐릭터를 보유",
        "condition_type": "own_all_characters",
        "condition_value": 1,
        "is_hidden": True,
        "reward_gold": 4000,
    },
]


def seed_achievements():
    db = SessionLocal()
    try:
        existing_rows = {row.name: row for row in db.query(Achievement).all()}
        changed = False

        for ach in ACHIEVEMENTS:
            row = existing_rows.get(ach["name"])
            if row:
                # 값이 바뀌었을 수도 있으니(조건/보상 밸런스 조정 등) 매번 최신 데이터로 덮어쓴다.
                # UserAchievement는 이름이 아니라 achievement_id를 참조하므로, 이미 딴 유저의 기록은 그대로 유지된다.
                row.description = ach.get("description", "")
                row.condition_type = ach["condition_type"]
                row.condition_value = ach["condition_value"]
                row.condition_params = ach.get("condition_params")
                row.is_hidden = ach.get("is_hidden", False)
                row.reward_gold = ach.get("reward_gold", 0)
                row.reward_exp = ach.get("reward_exp", 0)
                row.reward_items = ach.get("reward_items")
            else:
                db.add(Achievement(
                    name=ach["name"],
                    description=ach.get("description", ""),
                    condition_type=ach["condition_type"],
                    condition_value=ach["condition_value"],
                    condition_params=ach.get("condition_params"),
                    is_hidden=ach.get("is_hidden", False),
                    reward_gold=ach.get("reward_gold", 0),
                    reward_exp=ach.get("reward_exp", 0),
                    reward_items=ach.get("reward_items"),
                ))
            changed = True

        if changed:
            db.commit()
    finally:
        db.close()


STORY_ID_EP1 = "ep1_yoondaewoong"

CHALLENGES = [
    # ── 스토리모드 도전과제: 인연 스토리 Episode 1 CG 갤러리 순서(story-engine.js의 CG_GALLERY_ITEMS)와
    # 1:1로 대응한다 ──────────────────────────────────────────
    {
        "name": "도감 Episode 1 No.1 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "bad"},
        "reward_gold": 200,
    },
    {
        "name": "도감 Episode 1 No.2 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "normal"},
        "reward_gold": 200,
    },
    {
        "name": "도감 Episode 1 No.3 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "juheon"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "송주헌", "quantity": 1}],
    },
    {
        "name": "도감 Episode 1 No.4 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "seungyu"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "강승유", "quantity": 1}],
    },
    {
        "name": "도감 Episode 1 No.5 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "yeongwoong"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "이영웅", "quantity": 1}],
    },
    {
        "name": "도감 Episode 1 No.6 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "ganghee"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "강 희", "quantity": 1}],
    },
    {
        "name": "도감 Episode 1 No.7 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "true_seungyu"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "송주헌", "quantity": 2}],
    },
    {
        "name": "도감 Episode 1 No.8 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "true_ganghee"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "강 희", "quantity": 2}],
    },
    {
        "name": "도감 Episode 1 No.9 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "true_yeongwoong"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "이영웅", "quantity": 2}],
    },
    {
        "name": "도감 Episode 1 No.10 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "true_juheon"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "송주헌", "quantity": 2}],
    },
    {
        "name": "도감 Episode 1 No.11 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "hidden"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "송주헌", "quantity": 3}],
    },

    # ── 도전과제(일반) ──────────────────────────────────────────
    {
        "name": "강화 성공 누적 10회 달성",
        "condition_type": "activity_total",
        "condition_value": 10,
        "condition_params": {"activity_type": "character_enhance_success"},
        "reward_gold": 500,
    },
    {
        "name": "강화 파괴 누적 10회 달성",
        "condition_type": "activity_total",
        "condition_value": 10,
        "condition_params": {"activity_type": "character_enhance_destroy"},
        "reward_gold": 500,
    },
    {
        "name": "아이템 누적 10회 구매",
        "condition_type": "activity_total",
        "condition_value": 10,
        "condition_params": {"activity_type": "shop_purchase_enhancement"},
        "reward_gold": 200,
    },
    {
        "name": "아이템 누적 10회 사용",
        "condition_type": "activity_total",
        "condition_value": 10,
        "condition_params": {"activity_type": "item_use"},
        "reward_gold": 200,
    },
    {
        "name": "인연 스토리 누적 10회 플레이",
        "condition_type": "activity_total",
        "condition_value": 10,
        "condition_params": {"activity_type": "story_ticket_use"},
        "reward_gold": 200,
    },
    {
        "name": "지역 입장 30분 이상 누적 10회 플레이",
        "condition_type": "region_session_count",
        "condition_value": 10,
        "condition_params": {"min_minutes": 30},
        "reward_gold": 200,
    },
    {
        "name": "전술대회 누적 10회 플레이",
        "condition_type": "pvp_battle_total",
        "condition_value": 10,
        "reward_gold": 100,
    },
    {
        "name": "인연 스토리 누적 50회 플레이",
        "condition_type": "activity_total",
        "condition_value": 50,
        "condition_params": {"activity_type": "story_ticket_use"},
        "reward_gold": 500,
    },
    {
        "name": "지역 입장 30분 이상 누적 50회 플레이",
        "condition_type": "region_session_count",
        "condition_value": 50,
        "condition_params": {"min_minutes": 30},
        "reward_gold": 500,
    },
    {
        "name": "전술대회 누적 50회 플레이",
        "condition_type": "pvp_battle_total",
        "condition_value": 50,
        "reward_gold": 200,
    },

    # ── 투기장 도전과제 ──────────────────────────────────────────
    {
        "name": "전술대회 랭킹 1위 달성",
        "condition_type": "pvp_rank_reached",
        "condition_value": 1,
        "condition_params": {"rank": 1},
        "reward_gold": 200,
    },
    {
        "name": "★5 이상 캐릭터로 전술대회 전투 참여 1회",
        "condition_type": "pvp_battle_with_star",
        "condition_value": 1,
        "condition_params": {"min_star": 5},
        "reward_gold": 200,
    },
    {
        "name": "전술대회 누적 10승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 10,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 20승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 20,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 30승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 30,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 40승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 40,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 50승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 50,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 60승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 60,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 70승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 70,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 80승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 80,
        "reward_gold": 100,
    },

    # ── 메인 게임 도전과제 ──────────────────────────────────────────
    {
        "name": "송주헌과 함께 독서로 누적 500exp 획득",
        "condition_type": "character_reading_exp",
        "condition_value": 500,
        "condition_params": {"character_name": "송주헌"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "송주헌", "quantity": 3}],
    },
    {
        "name": "청년과 함께 독서로 누적 500exp 획득",
        "condition_type": "character_reading_exp",
        "condition_value": 500,
        "condition_params": {"character_name": "청년"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "청년", "quantity": 9}],
    },
    {
        "name": "직업:학생과 함께 과목으로 누적 1000exp 획득",
        "condition_type": "job_class_subject_exp",
        "condition_value": 1000,
        "condition_params": {"job_class": "학생"},
        "reward_gold": 500,
    },
    {
        "name": "직업:마법사를 사용해 과목으로 누적 1000exp 획득",
        "condition_type": "job_class_subject_exp",
        "condition_value": 1000,
        "condition_params": {"job_class": "마법사"},
        "reward_gold": 500,
    },
    {
        "name": "여성 캐릭터를 사용해 과목으로 누적 1000exp 획득",
        "condition_type": "gender_subject_exp",
        "condition_value": 1000,
        "condition_params": {"gender": "여"},
        "reward_gold": 500,
    },
    {
        "name": "지역 입장 2시간 연속 집중 누적 3회 달성",
        "condition_type": "region_session_count",
        "condition_value": 3,
        "condition_params": {"min_minutes": 120},
        "reward_gold": 200,
    },
    {
        "name": "지역 입장 2시간 연속 집중 누적 5회 달성",
        "condition_type": "region_session_count",
        "condition_value": 5,
        "condition_params": {"min_minutes": 120},
        "reward_gold": 200,
    },
    {
        "name": "지역 입장 2시간 연속 집중 누적 7회 달성",
        "condition_type": "region_session_count",
        "condition_value": 7,
        "condition_params": {"min_minutes": 120},
        "reward_gold": 200,
    },
    {
        "name": "지역 입장 2시간 연속 집중 누적 9회 달성",
        "condition_type": "region_session_count",
        "condition_value": 9,
        "condition_params": {"min_minutes": 120},
        "reward_gold": 200,
    },
    {
        "name": "하루 동안 국어·영어·수학·탐구(2과목) 모의고사 전부 응시 1회",
        "condition_type": "daily_full_mock_exam_set",
        "condition_value": 1,
        "reward_gold": 1000,
    },
]


def seed_challenges():
    db = SessionLocal()
    try:
        existing_rows = {row.name: row for row in db.query(Challenge).all()}
        changed = False

        for c in CHALLENGES:
            row = existing_rows.get(c["name"])
            if row:
                row.description = c.get("description", "")
                row.condition_type = c["condition_type"]
                row.condition_value = c["condition_value"]
                row.condition_params = c.get("condition_params")
                row.reward_gold = c.get("reward_gold", 0)
                row.reward_exp = c.get("reward_exp", 0)
                row.reward_items = c.get("reward_items")
            else:
                db.add(Challenge(
                    name=c["name"],
                    description=c.get("description", ""),
                    condition_type=c["condition_type"],
                    condition_value=c["condition_value"],
                    condition_params=c.get("condition_params"),
                    reward_gold=c.get("reward_gold", 0),
                    reward_exp=c.get("reward_exp", 0),
                    reward_items=c.get("reward_items"),
                ))
            changed = True

        if changed:
            db.commit()
    finally:
        db.close()


QUESTS = [
    # ── 일일 퀘스트 (KST 자정에 초기화) ──────────────────────────────────────────
    {
        "name": "독서 문학/비문학 30분",
        "period": "daily",
        "condition_type": "session_minutes",
        "condition_params": {"session_type": "reading"},
        "condition_target": 30,
        "reward_type": "item",
        "reward_amount": 2,
        "reward_item_name": "스토리모드 티켓",
        "sort_order": 1,
    },
    {
        "name": "모의고사 1회",
        "period": "daily",
        "condition_type": "session_count",
        "condition_params": {"session_type": "mock_exam"},
        "condition_target": 1,
        "reward_type": "gold",
        "reward_amount": 90,
        "sort_order": 2,
    },
    {
        "name": "투기장 입장 3회",
        "period": "daily",
        "condition_type": "pvp_battle_count",
        "condition_target": 3,
        "reward_type": "exp",
        "reward_amount": 10,
        "sort_order": 3,
    },
    {
        "name": "과목 공부 1시간",
        "period": "daily",
        "condition_type": "session_minutes",
        "condition_params": {"session_type": "subject"},
        "condition_target": 60,
        "reward_type": "item",
        "reward_amount": 5,
        "reward_item_name": "투기장모드 티켓",
        "sort_order": 4,
    },
    {
        "name": "모집 1회",
        "period": "daily",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "gacha_pull"},
        "condition_target": 1,
        "reward_type": "exp",
        "reward_amount": 10,
        "sort_order": 5,
    },
    {
        "name": "강화 아이템 구매 1회",
        "period": "daily",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "shop_purchase_enhancement"},
        "condition_target": 1,
        "reward_type": "exp",
        "reward_amount": 10,
        "sort_order": 6,
    },
    {
        "name": "스토리모드 티켓 사용 1회",
        "period": "daily",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "story_ticket_use"},
        "condition_target": 1,
        "reward_type": "gold",
        "reward_amount": 60,
        "sort_order": 7,
    },
    {
        "name": "일일 접속",
        "period": "daily",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "login"},
        "condition_target": 1,
        "reward_type": "exp",
        "reward_amount": 10,
        "sort_order": 8,
    },
    {
        "name": "일일 퀘스트 6개 달성",
        "period": "daily",
        "condition_type": "quest_claims_in_period",
        "condition_target": 6,
        "reward_type": "gold",
        "reward_amount": 150,
        "sort_order": 9,
    },
    # ── 주간 퀘스트 (KST 월요일 자정에 초기화) ────────────────────────────────────
    {
        "name": "독서 문학/비문학 200분",
        "period": "weekly",
        "condition_type": "session_minutes",
        "condition_params": {"session_type": "reading"},
        "condition_target": 200,
        "reward_type": "item",
        "reward_amount": 3,
        "reward_item_name": "스토리모드 티켓",
        "sort_order": 1,
    },
    {
        "name": "영어 모의고사 2회",
        "period": "weekly",
        "condition_type": "session_count",
        "condition_params": {"session_type": "mock_exam", "difficulty": "영어"},
        "condition_target": 2,
        "reward_type": "gold",
        "reward_amount": 150,
        "sort_order": 2,
    },
    {
        "name": "투기장 입장 10회",
        "period": "weekly",
        "condition_type": "pvp_battle_count",
        "condition_target": 10,
        "reward_type": "exp",
        "reward_amount": 30,
        "sort_order": 3,
    },
    {
        "name": "과목 공부 24시간",
        "period": "weekly",
        "condition_type": "session_minutes",
        "condition_params": {"session_type": "subject"},
        "condition_target": 1440,
        "reward_type": "exp",
        "reward_amount": 50,
        "sort_order": 4,
    },
    {
        "name": "모집 5회",
        "period": "weekly",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "gacha_pull"},
        "condition_target": 5,
        "reward_type": "item",
        "reward_amount": 10,
        "reward_item_name": "투기장모드 티켓",
        "sort_order": 5,
    },
    {
        "name": "강화 아이템 구매 5회",
        "period": "weekly",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "shop_purchase_enhancement"},
        "condition_target": 5,
        "reward_type": "exp",
        "reward_amount": 30,
        "sort_order": 6,
    },
    {
        "name": "스토리모드 티켓 사용 10회",
        "period": "weekly",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "story_ticket_use"},
        "condition_target": 10,
        "reward_type": "gold",
        "reward_amount": 150,
        "sort_order": 7,
    },
    {
        "name": "접속 5회",
        "period": "weekly",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "login"},
        "condition_target": 5,
        "reward_type": "exp",
        "reward_amount": 30,
        "sort_order": 8,
    },
    {
        "name": "주간 퀘스트 6개 달성",
        "period": "weekly",
        "condition_type": "quest_claims_in_period",
        "condition_target": 6,
        "reward_type": "gold",
        "reward_amount": 300,
        "sort_order": 9,
    },
]


def seed_quests():
    db = SessionLocal()
    try:
        existing_rows = {row.name: row for row in db.query(Quest).all()}
        changed = False

        for q in QUESTS:
            row = existing_rows.get(q["name"])
            if row:
                # 밸런스 조정(조건/보상 수치 변경)이 서버 재시작만으로 반영되도록 매번 최신 값으로 덮어쓴다.
                # UserQuestClaim은 이름이 아니라 quest_id를 참조하므로 이미 받은 보상 기록은 그대로 유지된다.
                row.period = q["period"]
                row.condition_type = q["condition_type"]
                row.condition_params = q.get("condition_params")
                row.condition_target = q["condition_target"]
                row.reward_type = q["reward_type"]
                row.reward_amount = q["reward_amount"]
                row.reward_item_name = q.get("reward_item_name")
                row.sort_order = q.get("sort_order", 0)
            else:
                db.add(Quest(
                    name=q["name"],
                    period=q["period"],
                    condition_type=q["condition_type"],
                    condition_params=q.get("condition_params"),
                    condition_target=q["condition_target"],
                    reward_type=q["reward_type"],
                    reward_amount=q["reward_amount"],
                    reward_item_name=q.get("reward_item_name"),
                    sort_order=q.get("sort_order", 0),
                ))
            changed = True

        # QUESTS 목록에서 개명/삭제된 퀘스트는 정리한다 - 안 지우면 목록에 유령 항목으로 계속 남는다.
        # UserQuestClaim은 quest_id를 참조하므로, 남아있는 클레임 기록부터 같이 지워야 참조가 끊기지 않는다.
        current_names = {q["name"] for q in QUESTS}
        for name, row in existing_rows.items():
            if name not in current_names:
                db.query(UserQuestClaim).filter(UserQuestClaim.quest_id == row.id).delete()
                db.delete(row)
                changed = True

        if changed:
            db.commit()
    finally:
        db.close()


def seed_gacha_banners():
    # 프론트(gacha-partial.html)에 이미 만들어둔 픽업모집/상시모집 두 배너를 그대로 반영
    db = SessionLocal()
    try:
        if db.query(GachaBanner).count() == 0:
            pickup = GachaBanner(
                name="픽업모집",
                banner_type="pickup",
                image_file="pickup-banner.png",
                start_date=None,
                end_date=None,
                is_active=True,
            )
            standard = GachaBanner(
                name="상시모집",
                banner_type="standard",
                image_file="standard-banner.png",
                start_date=None,
                end_date=None,
                is_active=True,
            )
            db.add(pickup)
            db.add(standard)
            db.commit()
            db.refresh(pickup)

            db.add(GachaBannerPickup(
                banner_id=pickup.id,
                character_name="송주헌",
                point_cost=20,
            ))
            db.commit()
    finally:
        db.close()


NOTICES = [
    {
        "title": "독서 RPG 정식 출시!",
        "image_file": "assets/notices/launch.png",
        "body": (
            "안녕하세요, 독서 RPG 개발진입니다.\n\n"
            "오랜 준비 끝에 독서 RPG가 정식으로 출시되었습니다!\n"
            "그동안 제작에 함께해주신 모든 분들께 진심으로 감사드립니다.\n\n"
            "독서 RPG는 여러분의 독서와 공부 시간을 캐릭터 성장으로 이어주는 건강한 게임입니다. "
            "매일 꾸준히 기록을 쌓아 인물을 모으고, 투기장에서 실력을 겨루고, "
            "스토리를 통해 새로운 이야기를 만나보세요.\n\n"
            "앞으로도 다양한 컨텐츠와 이벤트로 찾아뵙겠습니다. 많은 관심과 응원 부탁드립니다!\n\n\n"
            "안녕하세요, 독서 RPG의 개발자 고우주입니다.\n"
            "이번 RPG의 총괄 프로그래밍 및 투기장모드 기획/구성을 담당하였는데요. "
            "많은 시간을 투자하였으니 완성도에는 자신이 있다고 말할 수 있습니다. "
            "또한 투기장모드는 이번 RPG를 개발하면서 가장 많은 노력과 시간을 들였다고 해도 과언이 아닙니다. "
            "다만 웹게임의 특정상 발견하지 못한 버그들이 존재할 수 있는데요, "
            "가벼운 버그들은 그냥 게임의 일부로 너그럽게 받아들이고 즐겨주시면 감사하겠습니다.\n"
            "게임 플레이에 지장을 줄 정도의 버그를 발견하셨다면 제게 제보해 주세요. "
            "확인 후 최대한 빠르게 수정하겠습니다.\n"
            "항상 여러분의 곁에서 응원합니다.\n\n"
            "안녕하세요, 독서 RPG의 개발자 송주헌입니다.\n"
            "이번 RPG 게임의 스토리모드를 기획하고 구성을 중점적으로 맡았는데요. "
            "라이트 노벨, 코믹요소를 담아 풍부한 시나리오를 구성하려 노력했습니다. "
            "여러 앤딩이 재미있고 감동 넘치는 앤딩이 있습니다. "
            "모든 앤딩 도감을 획득하기는 쉽지 않을 정도로 복잡하고 또 깊게 만들었으니 재밌게 즐겨주세요.\n"
            "화이팅!"
        ),
    },
    {
        "title": "인연 스토리 Episode 1 '우정의 시작' OPEN!",
        "image_file": "assets/notices/relationship1.png",
        "body": (
            "안녕하세요, 독서RPG입니다.\n\n"
            "인연 스토리 Episode 1이 공개되었습니다.\n"
            "여러 인물들과의 상호작용을 통해 우정을 쌓아보세요!\n"
            "스토리모드 티켓을 꾸준히 모아 하나의 완결된 스토리를 완성해보세요!\n"
            "추후에 제작할 episode 2, 3는 더 복잡한 요소와 신박하고 재미있는 상황을 통해 구성할 예정입니다.\n"
            "감사합니다."
        ),
    },
    {
        "title": "전술대회 시즌1 OPEN!",
        "image_file": "assets/notices/competition1.png",
        "body": (
            "안녕하세요, 독서RPG입니다.\n\n"
            "전술대회 시즌1이 시작되었습니!.\n"
            "플레이어들을 공격하여 실력을 겨뤄 보세요!\n"
            "방어 편성을 적절하게 하여 순위를 지켜 보세요!\n"
            "추후에 공개할 토벌전은 더 복잡한 요소와 신박하고 재미있는 매커니즘으로 구성할 예정입니다.\n"
            "감사합니다."
        ),
    },
    {
        "title": "7.24 패치노트",
        "image_file": "assets/notices/7.24note.png",
        "body": (
            "안녕하세요, 독서RPG입니다.\n\n"
            "7.24 패치내역을 알려드리겠습니다.\n"
            "- 시간 표시를 전부 한국시간으로 통일\n"
            "- 일일퀘스트 '18시 이후 접속'을 '일일 접속'으로 변경\n"
            "- 퀘스트 보상 변경\n"
            "- 퀘스트 보상 수령을 낙관적 UI로 변경\n"
            "- 퀘스트 '도전과제' 추가\n"
            "- 달성된 미수령 퀘스트 있을 때 퀘스트 버튼에 알림 표시 추가\n"
            "- 설정에 '지역에서 캐릭터 끄기' 스위치 추가\n"
            "- 전술대회 디자인 변경\n"
            "- 전술대회 보상(공격/방어 성공 시 각 5골드) 추가\n"
            "- 신규 재화: 투기장모드 티켓\n"
            "- 투기장 후보 규칙 순위 기반으로 전면 개편 + 리롤\n"
            "- 업적이 투기장 전투에서만 확인되는 버그 수정\n"
            "- 대전 이력 최근 50개만 표시되게 제한\n"
            "- 대전 이력에 공격 항목 추가\n"
            "- 독서 완료 문구가 느리게 뜨는 문제 수정\n"
            "- 좋은화면(패드 전용 화면) 반응형 패치\n"
            "- 실모단 업적 버그 수정\n"
            "- '윤영준의 오페라하우스' 디자인 개선"
        ),
    },
]


def seed_notices():
    db = SessionLocal()
    try:
        existing_rows = {row.title: row for row in db.query(Notice).all()}
        changed = False

        for n in NOTICES:
            row = existing_rows.get(n["title"])
            if row:
                row.image_file = n.get("image_file")
                row.body = n["body"]
            else:
                db.add(Notice(
                    title=n["title"],
                    image_file=n.get("image_file"),
                    body=n["body"],
                ))
            changed = True

        if changed:
            db.commit()
    finally:
        db.close()