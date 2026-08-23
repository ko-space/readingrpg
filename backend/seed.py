import json
from database import SessionLocal
from models import (
    Item, Region, Achievement, GachaBanner, Quest, UserQuestClaim,
    UserItem, UserItemPurchase, UserDailyItemPurchase, Notice, Challenge,
    UserChallengeClaim, MarketState, StorySecret,
)
from character_visibility import is_hidden_override

# 히든 업적의 실제 조건/보상과 스토리 히든 콘텐츠의 정답값은 이 저장소(공개 GitHub)에 커밋하지 않는다 -
# private_seed.py(.gitignore에 등록됨, 로컬/운영 서버에만 직접 올려둠)가 있으면 그걸 쓰고, 없으면(신규
# 체크아웃, CI 등) 조용히 빈 값으로 넘어간다 - 히든 콘텐츠만 시딩이 안 될 뿐 나머지는 정상 동작해야 한다.
try:
    from private_seed import HIDDEN_ACHIEVEMENTS, STORY_SECRETS, HIDDEN_ITEM_REQUIREMENTS
except ImportError:
    HIDDEN_ACHIEVEMENTS, STORY_SECRETS, HIDDEN_ITEM_REQUIREMENTS = [], [], {}

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
                if is_hidden_override(char["name"], char.get("is_hidden", False)):
                    continue  # 아직 공개 전인 캐릭터(예: 이의진)의 의상은 상점 Item으로 시딩하지 않는다
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
                "price": 1000,
                "currency": "silver",
                "icon_file": "assets/items/songjuheon_desk.webp",
                "description": "방치되어 있지만 존재는 합니다.",
                "effect_type": "shift",
                "effect_params": {"from": "maintain", "to": "success", "amount": 10},
            },
            {
                "name": "김남옥의 크레파스",
                "source_character": "김남옥",
                "price": 500,
                "currency": "silver",
                "icon_file": "assets/items/namok_crayon.webp",
                "description": "어린이가 사용하는 물건이니 조심히 다루세요.",
                "effect_type": "shift",
                "effect_params": {"from": "destroy", "to": "maintain", "amount": 10},
            },
            {
                "name": "윤영준의 오페라 하우스",
                "source_character": "윤영준",
                "price": 2500,
                "currency": "silver",
                "icon_file": "assets/items/youngjun_opera.webp",
                "description": "조심하세요. 윤영준의 수행평가는 복불복입니다.",
                "effect_type": "redistribute",
                "effect_params": {"remove": "maintain", "ratio": {"success": 1.5, "destroy": 1}},
            },
            {
                "name": "강 희의 파쇄기",
                "source_character": "강 희",
                "price": 100,
                "currency": "silver",
                "icon_file": "assets/items/ganghee_shredder.webp",
                "description": "이것은 어디에다가 쓰는 걸까요?",
                "effect_type": "force",
                "effect_params": {"outcome": "destroy"},
            },
            {
                "name": "초심자의 행운",
                "source_character": None,
                # required_achievement는 여기 없다 - 아래에서 HIDDEN_ITEM_REQUIREMENTS(private_seed.py)로
                # 채운다. 어떤 업적이 필요한지 자체가 그 업적의 달성 조건에 대한 힌트라 공개 저장소에
                # 남기지 않는다(확인된 요청).
                "purchase_limit": 1,
                "price": 1500,
                "currency": "gold",  # 재화 이원화 이후에도 골드로 유지(다른 8종과 달리 실버로 안 바뀜)
                "icon_file": "assets/items/초심자의 행운.webp",
                "description": "어느 업적을 달성해야 살 수 있는 걸까요?",
                "effect_type": "force",
                "effect_params": {"outcome": "success"},
            },
            {
                "name": "최재혁의 마법 영약",
                "source_character": "최재혁",
                "price": 750,
                "currency": "silver",
                "icon_file": "assets/items/jaehyuk_elixir.webp",
                "description": "모든 것을 형태가 없는 재로 만들어버리는 영약입니다.",
                # 별도 effect_type: 성공/유지/파괴 확률표를 통째로 대체한다(성급별 "먼지 생성" 확률).
                # 성공하면 재료 3장이 전부 소모되고 먼지 1개를 얻는다. 실패하면 아무 카드도 소모되지 않는다
                # (골드와 아이템 자체만 소모). 다른 강화 아이템과 함께 쓸 수 없다(enhance_character에서 검증).
                "effect_type": "dust_convert",
                "effect_params": {"1": 5, "2": 10, "3": 25, "4": 50, "5": 75},
            },
            {
                "name": "먼지",
                "source_character": None,
                "price": 0,  # 상점에서 팔지 않음(마법 영약 성공 시에만 획득) - is_shop_active를 항상 False로 고정
                "currency": "silver",
                "icon_file": "assets/items/dust.webp",
                "description": "이 힘은, 대체 뭐지? 무언가... '뭔가'가 있다!",
                # 강화 시 재료 카드 1장을 대신한다(material_substitute) - shift/redistribute/force처럼 확률에
                # 관여하지 않고, _choose_enhancement_cards가 필요로 하는 실제 캐릭터 카드 수를 1장 줄여준다.
                "effect_type": "material_substitute",
                "effect_params": {},
                "is_shop_active": False,
            },
            {
                "name": "이의진의 연분홍색 크록스",
                "source_character": "이의진",
                "price": 1500,
                "currency": "silver",
                "icon_file": "assets/items/eujin_crocs.webp",
                "description": "행운을 시험해볼까요?",
                # 성공 확률 중 일부를 슈퍼 성공(2성치 강화)으로 옮긴다 - shift와 비슷하지만 "성공" 항목을
                # 두 종류(success/super_success)로 쪼갠다는 점이 달라서 별도 effect_type으로 둔다.
                "effect_type": "super_success_shift",
                "effect_params": {"success_delta": -5, "super_success_delta": 5},
            },
            {
                "name": "강승유의 마우스피스",
                "source_character": "강승유",
                "price": 1750,
                "currency": "silver",
                "icon_file": "assets/items/seungyu_piece.webp",
                "description": "일종의 보험이라고 생각하세요.",
                # 이번 강화가 성공(슈퍼 성공 포함)하면, 그 카드의 "다음" 강화 시도에 파괴 -10%p/성공 +10%p를
                # 1회 예약해둔다(CharacterEnhanceBuff 테이블). 이번 판정 자체에는 영향 없음.
                "effect_type": "next_enhance_buff",
                "effect_params": {"destroy_delta": -10, "success_delta": 10},
            },
        ]
        for item in items:
            if item["name"] in HIDDEN_ITEM_REQUIREMENTS:
                item["required_achievement"] = HIDDEN_ITEM_REQUIREMENTS[item["name"]]

        existing_rows = {row.name: row for row in db.query(Item).filter(Item.item_type == "enhancement").all()}
        changed = False

        for item in items:
            is_shop_active = item.get("is_shop_active", True)
            row = existing_rows.get(item["name"])
            if row:
                # 이미 있는 행이면 최신 값으로 갱신한다(icon_file 등을 나중에 추가/수정해도
                # 서버 재시작만으로 반영되게 하기 위함 - 예전엔 "이미 있으면 건너뛰기"만 해서
                # icon_file 같은 새 필드가 기존 행엔 절대 안 채워지는 문제가 있었다).
                row.price = item["price"]
                row.currency = item.get("currency", "silver")
                row.icon_file = item["icon_file"]
                row.description = item["description"]
                row.source_character = item.get("source_character")
                row.effect_type = item["effect_type"]
                row.effect_params = item["effect_params"]
                row.required_achievement = item.get("required_achievement")
                row.purchase_limit = item.get("purchase_limit")
                row.is_shop_active = is_shop_active
            else:
                db.add(Item(
                    name=item["name"],
                    item_type="enhancement",
                    rarity="희귀",
                    price=item["price"],
                    currency=item.get("currency", "silver"),
                    icon_file=item["icon_file"],
                    description=item["description"],
                    source_character=item.get("source_character"),
                    effect_type=item["effect_type"],
                    effect_params=item["effect_params"],
                    required_achievement=item.get("required_achievement"),
                    purchase_limit=item.get("purchase_limit"),
                    is_shop_active=is_shop_active,
                ))
            changed = True

        if changed:
            db.commit()
    finally:
        db.close()


def seed_currency_items():
    """티켓 아이템(item_type="ticket"). 재화 이원화 이전엔 item_type="currency"(재화 취급)였는데,
    인벤토리/상점에서 진짜 아이템처럼 보이고 관리되도록 "ticket"으로 재분류했다 - 이름 기준으로
    조회해야 기존에 item_type="currency"로 심어져있던 행이 새 행으로 중복 생성되지 않고 그대로
    갱신된다(강화 아이템과 동일한 upsert 패턴, 다만 필터를 item_type이 아니라 이름으로 건다)."""
    db = SessionLocal()
    try:
        items = [
            {
                "name": "스토리모드 티켓",
                "price": 125,
                "icon_file": "assets/items/story_ticket.webp",
                "description": "인연 스토리에서 씬을 하나 볼 때마다 1장씩 사용됩니다.",
                "daily_purchase_limit": 7,
            },
            {
                "name": "투기장모드 티켓",
                "price": 20,
                "icon_file": "assets/items/arena_ticket.webp",
                "description": "전술경연 대회에서 전투를 시도할 때마다 1장씩 사용됩니다.",
                "daily_purchase_limit": 10,
            },
        ]

        names = [item["name"] for item in items]
        existing_rows = {row.name: row for row in db.query(Item).filter(Item.name.in_(names)).all()}
        changed = False

        for item in items:
            row = existing_rows.get(item["name"])
            if row:
                row.item_type = "ticket"
                row.currency = "silver"
                row.price = item["price"]
                row.icon_file = item["icon_file"]
                row.description = item["description"]
                row.daily_purchase_limit = item.get("daily_purchase_limit")
                row.is_shop_active = True
            else:
                db.add(Item(
                    name=item["name"],
                    item_type="ticket",
                    currency="silver",
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


REGIONS = [
    {
        "name": "초심자의 평원",
        "order": 1,
        "required_level": 1,
        "always_open": False,
        "description": "평화로운 초원의 모습과 잔잔한 자연 백색소음이 들려온다.",
        "exp_rate": 1.0,
        "gold_rate": 0.0,
        "silver_rate": 1.0,
    },
    {
        "name": "잊혀진 서고",
        "order": 2,
        "required_level": 5,
        "always_open": False,
        "description": "먼지 쌓인 책장 사이로 은은한 종이 냄새가 감돈다.",
        "exp_rate": 1.2,
        "gold_rate": 0.0,
        "silver_rate": 1.0,
    },
    {
        "name": "안개 낀 협곡",
        "order": 3,
        "required_level": 10,
        "always_open": False,
        "description": "짙은 안개 속에서 무언가 부스럭거리는 소리가 들려온다.",
        "exp_rate": 1.0,
        "gold_rate": 0.0,
        "silver_rate": 1.5,
    },
    {
        "name": "지혜의 신전",
        "order": 4,
        "required_level": 25,
        "always_open": False,
        "description": "고요한 정적 속에 오래된 지혜가 깃들어 있는 듯하다.",
        "exp_rate": 1.0,
        "gold_rate": 0.0,
        "silver_rate": 1.0,
        "subject_bonus_rules": {"국어": 1.5, "영어": 1.5},
    },
    {
        "name": "마법사의 은광",
        "order": 5,
        "required_level": 30,
        "always_open": False,
        "description": "은빛 광맥이 은은하게 빛나지만, 이곳에서는 지식이 쌓이는 감각이 느껴지지 않는다.",
        "exp_rate": 0.0,
        "gold_rate": 0.0,
        "silver_rate": 3.0,
    },
    {
        "name": "종말의 금광",
        "order": 6,
        "required_level": 30,
        "always_open": False,
        "description": "세상의 끝에서 채굴되는 황금은 그 무엇보다 무겁고 값지다.",
        "exp_rate": 0.0,
        "gold_rate": 0.1,
        "silver_rate": 0.0,
    },
    {
        "name": "투기장",
        "order": None,
        "required_level": 1,
        "always_open": True,
        "description": "거친 함성과 무기 부딪히는 소리로 가득한 전장이다.",
        "exp_rate": 0.5,
        "gold_rate": 1.0,
        "silver_rate": 0.0,
    },
]


def seed_regions():
    # 지역 = 던전. 하나의 장소가 곧 "레벨이 되면 열리는 지역"이자 "독서 세션을 진행하는 던전"이다.
    # (예전엔 count()==0일 때만 시딩해서 REGIONS를 고쳐도 반영이 안 되는 버그가 있었다 - 다른 시더처럼
    # 이름 기준 upsert로 교체)
    db = SessionLocal()
    try:
        existing_rows = {row.name: row for row in db.query(Region).all()}
        changed = False
        for r in REGIONS:
            row = existing_rows.get(r["name"])
            if row:
                row.order = r["order"]
                row.required_level = r["required_level"]
                row.always_open = r["always_open"]
                row.description = r["description"]
                row.exp_rate = r["exp_rate"]
                row.gold_rate = r["gold_rate"]
                row.silver_rate = r.get("silver_rate", 0.0)
                row.subject_bonus_rules = r.get("subject_bonus_rules")
            else:
                db.add(Region(**r))
            changed = True
        if changed:
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
        "description": "윤 & 호, 이종복, 임소정, 최재혁을 ★4 이상으로 보유",
        "condition_type": "own_characters_star",
        "condition_value": 4,
        "condition_params": {"names": ["윤 & 호", "이종복", "임소정", "최재혁"], "star": 4},
        "reward_items": [
            {"type": "character", "name": "윤 & 호", "quantity": 2},
            {"type": "character", "name": "이종복", "quantity": 2},
            {"type": "character", "name": "임소정", "quantity": 2},
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
        "condition_params": {"subjects": ["기타", "한국사", "한문/제2외국어"]},
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
]

# 히든 업적의 실제 조건/보상은 위 공개 목록에 없다 - private_seed.py(있으면)에서만 병합한다.
ACHIEVEMENTS += HIDDEN_ACHIEVEMENTS


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


def seed_story_secrets():
    """STORY_SECRETS(private_seed.py, 없으면 빈 리스트)를 story_secrets 테이블에 upsert한다. 이 값
    자체가 공개 저장소에 없으므로, private_seed.py가 없는 환경(신규 체크아웃/CI)에서는 그냥 아무
    것도 하지 않는다 - 히든 콘텐츠 트리거만 동작 안 할 뿐 나머지 기능에는 영향이 없다."""
    if not STORY_SECRETS:
        return
    db = SessionLocal()
    try:
        existing_rows = {
            (row.story_id, row.key): row for row in db.query(StorySecret).all()
        }
        changed = False
        for secret in STORY_SECRETS:
            row = existing_rows.get((secret["story_id"], secret["key"]))
            if row:
                row.value = secret["value"]
            else:
                db.add(StorySecret(
                    story_id=secret["story_id"], key=secret["key"], value=secret["value"],
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
        "name": "인연 스토리 도감 Episode 1 No.1 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "bad"},
        "reward_gold": 200,
    },
    {
        "name": "인연 스토리 도감 Episode 1 No.2 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "normal"},
        "reward_gold": 200,
    },
    {
        "name": "인연 스토리 도감 Episode 1 No.3 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "juheon"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "송주헌", "quantity": 1}],
    },
    {
        "name": "인연 스토리 도감 Episode 1 No.4 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "seungyu"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "강승유", "quantity": 1}],
    },
    {
        "name": "인연 스토리 도감 Episode 1 No.5 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "yeongwoong"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "이영웅", "quantity": 1}],
    },
    {
        "name": "인연 스토리 도감 Episode 1 No.6 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "ganghee"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "강 희", "quantity": 1}],
    },
    {
        "name": "인연 스토리 도감 Episode 1 No.7 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "true_seungyu"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "송주헌", "quantity": 2}],
    },
    {
        "name": "인연 스토리 도감 Episode 1 No.8 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "true_ganghee"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "강 희", "quantity": 2}],
    },
    {
        "name": "인연 스토리 도감 Episode 1 No.9 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "true_yeongwoong"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "이영웅", "quantity": 2}],
    },
    {
        "name": "인연 스토리 도감 Episode 1 No.10 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "true_juheon"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "송주헌", "quantity": 2}],
    },
    {
        "name": "인연 스토리 도감 Episode 1 No.11 획득",
        "condition_type": "cg_unlocked",
        "condition_value": 1,
        "condition_params": {"story_id": STORY_ID_EP1, "cg_id": "hidden"},
        "reward_gold": 200,
        "reward_items": [{"type": "character", "name": "송주헌", "quantity": 3}],
    },
    {
        "name": "인연 스토리 누적 100회 플레이",
        "condition_type": "activity_total",
        "condition_value": 100,
        "condition_params": {"activity_type": "story_ticket_use"},
        "reward_gold": 200,
    },
    {
        "name": "인연 스토리 누적 150회 플레이",
        "condition_type": "activity_total",
        "condition_value": 150,
        "condition_params": {"activity_type": "story_ticket_use"},
        "reward_gold": 200,
    },
    {
        "name": "인연 스토리 누적 200회 플레이",
        "condition_type": "activity_total",
        "condition_value": 200,
        "condition_params": {"activity_type": "story_ticket_use"},
        "reward_gold": 200,
    },
    {
        "name": "인연 스토리 앤딩 5회 보기",
        "condition_type": "activity_total",
        "condition_value": 5,
        "condition_params": {"activity_type": "ep1_ending_reached"},
        "reward_gold": 300,
    },
    {
        "name": "인연 스토리 앤딩 10회 보기",
        "condition_type": "activity_total",
        "condition_value": 10,
        "condition_params": {"activity_type": "ep1_ending_reached"},
        "reward_gold": 300,
    },
    {
        "name": "인연 스토리 앤딩 30회 보기",
        "condition_type": "activity_total",
        "condition_value": 30,
        "condition_params": {"activity_type": "ep1_ending_reached"},
        "reward_gold": 300,
    },
    {
        "name": "인연 스토리 앤딩 50회 보기",
        "condition_type": "activity_total",
        "condition_value": 50,
        "condition_params": {"activity_type": "ep1_ending_reached"},
        "reward_gold": 300,
    },
    {
        "name": "인연 스토리 앤딩 100회 보기",
        "condition_type": "activity_total",
        "condition_value": 100,
        "condition_params": {"activity_type": "ep1_ending_reached"},
        "reward_gold": 300,
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
        "name": "강화 성공 누적 50회 달성",
        "condition_type": "activity_total",
        "condition_value": 50,
        "condition_params": {"activity_type": "character_enhance_success"},
        "reward_gold": 500,
    },
    {
        "name": "강화 파괴 누적 50회 달성",
        "condition_type": "activity_total",
        "condition_value": 50,
        "condition_params": {"activity_type": "character_enhance_destroy"},
        "reward_gold": 500,
    },
    {
        "name": "아이템 누적 50회 구매",
        "condition_type": "activity_total",
        "condition_value": 50,
        "condition_params": {"activity_type": "shop_purchase_enhancement"},
        "reward_gold": 200,
    },
    {
        "name": "아이템 누적 50회 사용",
        "condition_type": "activity_total",
        "condition_value": 50,
        "condition_params": {"activity_type": "item_use"},
        "reward_gold": 200,
    },
    {
        "name": "강화 슈퍼 성공 누적 1회 달성",
        "condition_type": "activity_total",
        "condition_value": 1,
        "condition_params": {"activity_type": "character_enhance_super_success"},
        "reward_gold": 500,
    },
    {
        "name": "강화 슈퍼 성공 누적 3회 달성",
        "condition_type": "activity_total",
        "condition_value": 3,
        "condition_params": {"activity_type": "character_enhance_super_success"},
        "reward_gold": 500,
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
        "reward_gold": 200,
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
        "name": "★5 이상 인물로 전술대회 전투 참여 1회",
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
    {
        "name": "전술대회 누적 100승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 100,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 150승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 150,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 200승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 200,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 250승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 250,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 300승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 300,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 350승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 350,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 400승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 400,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 450승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 450,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 누적 500승 달성",
        "condition_type": "pvp_wins",
        "condition_value": 500,
        "reward_gold": 100,
    },
    {
        "name": "전술대회 1회 접속",
        "condition_type": "pvp_battle_total",
        "condition_value": 1,
        "reward_gold": 50,
    },

    # ── 거래 도전과제 ──────────────────────────────────────────
    {
        "name": "인력 거래소에서 인물 등록 5회",
        "condition_type": "market_activity_count",
        "condition_value": 5,
        "condition_params": {"action": "register"},
        "reward_gold": 200,
    },
    {
        "name": "인력 거래소에서 인물 등록 10회",
        "condition_type": "market_activity_count",
        "condition_value": 10,
        "condition_params": {"action": "register"},
        "reward_gold": 200,
    },
    {
        "name": "인력 거래소에서 인물 등록 20회",
        "condition_type": "market_activity_count",
        "condition_value": 20,
        "condition_params": {"action": "register"},
        "reward_gold": 200,
    },
    {
        "name": "인력 거래소에서 인물 구매 1회",
        "condition_type": "market_activity_count",
        "condition_value": 1,
        "condition_params": {"action": "buy"},
        "reward_gold": 200,
    },
    {
        "name": "인력 거래소에서 인물 구매 3회",
        "condition_type": "market_activity_count",
        "condition_value": 3,
        "condition_params": {"action": "buy"},
        "reward_gold": 200,
    },
    {
        "name": "인력 거래소에서 인물 구매 5회",
        "condition_type": "market_activity_count",
        "condition_value": 5,
        "condition_params": {"action": "buy"},
        "reward_gold": 200,
    },
    {
        "name": "인력 거래소에서 인물 구매 10회",
        "condition_type": "market_activity_count",
        "condition_value": 10,
        "condition_params": {"action": "buy"},
        "reward_gold": 200,
    },
    {
        "name": "인력 거래소에서 ★4 이상 인물 구매 1회",
        "condition_type": "market_activity_count",
        "condition_value": 1,
        "condition_params": {"action": "buy", "min_star": 4},
        "reward_gold": 200,
    },
    {
        "name": "인력 거래소에서 ★3 이상 인물 구매 3회",
        "condition_type": "market_activity_count",
        "condition_value": 3,
        "condition_params": {"action": "buy", "min_star": 3},
        "reward_gold": 200,
    },
    {
        "name": "인력 거래소에서 ★5 이상 인물 구매 1회",
        "condition_type": "market_activity_count",
        "condition_value": 1,
        "condition_params": {"action": "buy", "min_star": 5},
        "reward_gold": 200,
    },

    # ── 랭킹 도전과제 ──────────────────────────────────────────
    {
        "name": "오늘의 독서시간 랭킹 1위 달성 1회",
        "condition_type": "ranking_top1_count",
        "condition_value": 1,
        "condition_params": {"category": "reading_daily"},
        "reward_gold": 200,
    },
    {
        "name": "주간 독서시간 랭킹 1위 달성 1회",
        "condition_type": "ranking_top1_count",
        "condition_value": 1,
        "condition_params": {"category": "reading_weekly"},
        "reward_gold": 200,
    },
    {
        "name": "보유 골드 랭킹 1위 달성 1회",
        "condition_type": "ranking_top1_live",
        "condition_value": 1,
        "condition_params": {"metric": "gold"},
        "reward_gold": 200,
    },
    {
        "name": "칭호 수 랭킹 1위 달성 1회",
        "condition_type": "ranking_top1_live",
        "condition_value": 1,
        "condition_params": {"metric": "titles"},
        "reward_gold": 200,
    },
    {
        "name": "PvP 승수 랭킹 1위 달성 1회",
        "condition_type": "ranking_top1_live",
        "condition_value": 1,
        "condition_params": {"metric": "pvp_wins"},
        "reward_gold": 200,
    },
    {
        "name": "오늘의 독서시간 랭킹 1위 달성 3회",
        "condition_type": "ranking_top1_count",
        "condition_value": 3,
        "condition_params": {"category": "reading_daily"},
        "reward_gold": 200,
    },
    {
        "name": "주간 독서시간 랭킹 1위 달성 3회",
        "condition_type": "ranking_top1_count",
        "condition_value": 3,
        "condition_params": {"category": "reading_weekly"},
        "reward_gold": 200,
    },
    {
        "name": "오늘의 독서시간 랭킹 1위 달성 5회",
        "condition_type": "ranking_top1_count",
        "condition_value": 5,
        "condition_params": {"category": "reading_daily"},
        "reward_gold": 200,
    },
    {
        "name": "오늘의 독서시간 랭킹 1위 달성 10회",
        "condition_type": "ranking_top1_count",
        "condition_value": 10,
        "condition_params": {"category": "reading_daily"},
        "reward_gold": 200,
    },

    # ── 모집 도전과제 ──────────────────────────────────────────
    {
        "name": "모집 10회",
        "condition_type": "activity_total",
        "condition_value": 10,
        "condition_params": {"activity_type": "gacha_pull"},
        "reward_gold": 100,
    },
    {
        "name": "모집 50회",
        "condition_type": "activity_total",
        "condition_value": 50,
        "condition_params": {"activity_type": "gacha_pull"},
        "reward_gold": 100,
    },
    {
        "name": "모집 100회",
        "condition_type": "activity_total",
        "condition_value": 100,
        "condition_params": {"activity_type": "gacha_pull"},
        "reward_gold": 100,
    },
    {
        "name": "★1, ★2, ★3, ★4, ★5 인물 전부 모집",
        "condition_type": "gacha_pull_all_rarities",
        "condition_value": 5,
        "reward_gold": 500,
    },
    {
        "name": "★3 이상 픽업 인물 모집 1회",
        "condition_type": "gacha_pull_pickup_count",
        "condition_value": 1,
        "condition_params": {"min_star": 3},
        "reward_gold": 200,
    },
    {
        "name": "★3 이상 픽업 인물 모집 3회",
        "condition_type": "gacha_pull_pickup_count",
        "condition_value": 3,
        "condition_params": {"min_star": 3},
        "reward_gold": 200,
    },
    {
        "name": "★5 인물 모집 1회",
        "condition_type": "gacha_pull_rarity_count",
        "condition_value": 1,
        "condition_params": {"rarity": "신화"},
        "reward_gold": 200,
    },
    {
        "name": "★4 인물 모집 2회",
        "condition_type": "gacha_pull_rarity_count",
        "condition_value": 2,
        "condition_params": {"rarity": "전설"},
        "reward_gold": 200,
    },
    {
        "name": "★3 인물 모집 3회",
        "condition_type": "gacha_pull_rarity_count",
        "condition_value": 3,
        "condition_params": {"rarity": "영웅"},
        "reward_gold": 200,
    },
    {
        "name": "★3 이상 인물 2번 연속으로 모집",
        "condition_type": "gacha_pull_star_streak",
        "condition_value": 1,
        "condition_params": {"min_star": 3, "streak": 2},
        "reward_gold": 500,
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
        "name": "전부 직업이 학생인 인물과 함께 과목으로 누적 1000exp 획득",
        "condition_type": "job_class_subject_exp",
        "condition_value": 1000,
        "condition_params": {"job_class": "학생"},
        "reward_gold": 500,
    },
    {
        "name": "전부 직업이 마법사인 인물과 함께 과목으로 누적 1000exp 획득",
        "condition_type": "job_class_subject_exp",
        "condition_value": 1000,
        "condition_params": {"job_class": "마법사"},
        "reward_gold": 500,
    },
    {
        "name": "여성 인물과 함께 과목으로 누적 1000exp 획득",
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
    {
        "name": "하루에 국어·영어·수학·탐구를 각각 1시간 이상 공부하기 1회",
        "condition_type": "daily_all_subjects_study_days",
        "condition_value": 1,
        "condition_params": {"min_minutes": 60},
        "reward_gold": 200,
    },
    {
        "name": "하루에 국어·영어·수학·탐구를 각각 1시간 이상 공부하기 3회",
        "condition_type": "daily_all_subjects_study_days",
        "condition_value": 3,
        "condition_params": {"min_minutes": 60},
        "reward_gold": 200,
    },
    {
        "name": "하루에 국어·영어·수학·탐구를 각각 1시간 이상 공부하기 7회",
        "condition_type": "daily_all_subjects_study_days",
        "condition_value": 7,
        "condition_params": {"min_minutes": 60},
        "reward_gold": 200,
    },
    {
        "name": "사진 작가, 화백, 가정 교사 중 하나와 함께 누적 1000exp 획득",
        "condition_type": "character_filter_exp",
        "condition_value": 1000,
        "condition_params": {"job_classes": ["사진 작가", "화백", "가정 교사"]},
        "reward_gold": 500,
    },
    {
        "name": "동남아 유학생, 영웅 직업 중 하나와 함께 누적 1000exp 획득",
        "condition_type": "character_filter_exp",
        "condition_value": 1000,
        "condition_params": {"job_classes": ["동남아 유학생", "영웅"]},
        "reward_gold": 500,
    },
    {
        "name": "★1 인물과 함께 누적 200exp 획득",
        "condition_type": "character_filter_exp",
        "condition_value": 200,
        "condition_params": {"rarity": "일반"},
        "reward_gold": 500,
    },
    {
        "name": "★1 인물과 함께 누적 500exp 획득",
        "condition_type": "character_filter_exp",
        "condition_value": 500,
        "condition_params": {"rarity": "일반"},
        "reward_gold": 500,
    },
    {
        "name": "전부 직업이 학생인 인물과 함께 과목으로 누적 2000exp 획득",
        "condition_type": "job_class_subject_exp",
        "condition_value": 2000,
        "condition_params": {"job_class": "학생"},
        "reward_gold": 500,
    },
    {
        "name": "전부 직업이 마법사인 인물과 함께 과목으로 누적 2000exp 획득",
        "condition_type": "job_class_subject_exp",
        "condition_value": 2000,
        "condition_params": {"job_class": "마법사"},
        "reward_gold": 500,
    },
    {
        "name": "여성 인물과 함께 과목으로 누적 2000exp 획득",
        "condition_type": "gender_subject_exp",
        "condition_value": 2000,
        "condition_params": {"gender": "여"},
        "reward_gold": 500,
    },
    # ── 레벨업 도전과제(Lv. 2~30, 만렙 30) ──────────────────────────
    {
        "name": "Lv. 2 달성",
        "condition_type": "level",
        "condition_value": 2,
        "reward_gold": 100,
    },
    {
        "name": "Lv. 3 달성",
        "condition_type": "level",
        "condition_value": 3,
        "reward_items": [{"type": "item", "name": "송주헌의 독서대", "quantity": 1}],
    },
    {
        "name": "Lv. 4 달성",
        "condition_type": "level",
        "condition_value": 4,
        "reward_gold": 100,
    },
    {
        "name": "Lv. 5 달성",
        "condition_type": "level",
        "condition_value": 5,
        "reward_items": [{"type": "item", "name": "스토리모드 티켓", "quantity": 5}],
    },
    {
        "name": "Lv. 6 달성",
        "condition_type": "level",
        "condition_value": 6,
        "reward_gold": 100,
    },
    {
        "name": "Lv. 7 달성",
        "condition_type": "level",
        "condition_value": 7,
        "reward_items": [{"type": "item", "name": "투기장모드 티켓", "quantity": 10}],
    },
    {
        "name": "Lv. 8 달성",
        "condition_type": "level",
        "condition_value": 8,
        "reward_gold": 100,
    },
    {
        "name": "Lv. 9 달성",
        "condition_type": "level",
        "condition_value": 9,
        "reward_items": [{"type": "item", "name": "강 희의 파쇄기", "quantity": 5}],
    },
    {
        "name": "Lv. 10 달성",
        "condition_type": "level",
        "condition_value": 10,
        "reward_gold": 100,
    },
    {
        "name": "Lv. 11 달성",
        "condition_type": "level",
        "condition_value": 11,
        "reward_items": [{"type": "item", "name": "최재혁의 마법 영약", "quantity": 2}],
    },
    {
        "name": "Lv. 12 달성",
        "condition_type": "level",
        "condition_value": 12,
        "reward_gold": 100,
    },
    {
        "name": "Lv. 13 달성",
        "condition_type": "level",
        "condition_value": 13,
        "reward_items": [{"type": "item", "name": "이의진의 연분홍색 크록스", "quantity": 1}],
    },
    {
        "name": "Lv. 14 달성",
        "condition_type": "level",
        "condition_value": 14,
        "reward_gold": 100,
    },
    {
        "name": "Lv. 15 달성",
        "condition_type": "level",
        "condition_value": 15,
        "reward_items": [{"type": "item", "name": "투기장모드 티켓", "quantity": 15}],
    },
    {
        "name": "Lv. 16 달성",
        "condition_type": "level",
        "condition_value": 16,
        "reward_gold": 100,
    },
    {
        "name": "Lv. 17 달성",
        "condition_type": "level",
        "condition_value": 17,
        "reward_items": [{"type": "item", "name": "스토리모드 티켓", "quantity": 7}],
    },
    {
        "name": "Lv. 18 달성",
        "condition_type": "level",
        "condition_value": 18,
        "reward_gold": 100,
    },
    {
        "name": "Lv. 19 달성",
        "condition_type": "level",
        "condition_value": 19,
        "reward_items": [{"type": "item", "name": "김남옥의 크레파스", "quantity": 3}],
    },
    {
        "name": "Lv. 20 달성",
        "condition_type": "level",
        "condition_value": 20,
        "reward_gold": 500,
    },
    {
        "name": "Lv. 21 달성",
        "condition_type": "level",
        "condition_value": 21,
        "reward_items": [{"type": "gacha_points", "quantity": 5}],
    },
    {
        "name": "Lv. 22 달성",
        "condition_type": "level",
        "condition_value": 22,
        "reward_gold": 150,
    },
    {
        "name": "Lv. 23 달성",
        "condition_type": "level",
        "condition_value": 23,
        "reward_items": [{"type": "item", "name": "강승유의 마우스피스", "quantity": 1}],
    },
    {
        "name": "Lv. 24 달성",
        "condition_type": "level",
        "condition_value": 24,
        "reward_gold": 150,
    },
    {
        "name": "Lv. 25 달성",
        "condition_type": "level",
        "condition_value": 25,
        "reward_items": [{"type": "item", "name": "투기장모드 티켓", "quantity": 20}],
    },
    {
        "name": "Lv. 26 달성",
        "condition_type": "level",
        "condition_value": 26,
        "reward_gold": 150,
    },
    {
        "name": "Lv. 27 달성",
        "condition_type": "level",
        "condition_value": 27,
        "reward_items": [{"type": "item", "name": "스토리모드 티켓", "quantity": 10}],
    },
    {
        "name": "Lv. 28 달성",
        "condition_type": "level",
        "condition_value": 28,
        "reward_gold": 150,
    },
    {
        "name": "Lv. 29 달성",
        "condition_type": "level",
        "condition_value": 29,
        "reward_gold": 777,
    },
    {
        "name": "Lv. 30 달성",
        "condition_type": "level",
        "condition_value": 30,
        "reward_items": [{"type": "item", "name": "윤영준의 오페라 하우스", "quantity": 1}],
    },
]


# 이번 재화 시스템 개편에서 문구를 다듬으며 이름이 바뀐 "기존에 이미 운영 DB에 있던" 도전과제들
# (old_name, new_name). seed_challenges()는 이름 기준 upsert라 이름이 바뀌면 그냥 새 행을 만들고
# 옛 행은 그대로 남겨두는데, 그러면 이미 옛 이름으로 받은 유저가 새 이름으로 또 받을 수 있게 된다
# (조건은 똑같은데 행만 2개가 되므로) - 그래서 시딩 전에 옛 이름 행을 새 이름으로 먼저 개명해서
# 하나의 행(과 그 유저별 수령 기록)을 그대로 이어가게 한다.
# new_name 행이 이미 존재하는 경우(이 마이그레이션이 생기기 전 코드로 한 번이라도 배포/시딩된 적이
# 있어서 두 이름이 동시에 만들어져버린 경우)에는 단순 스킵이 아니라 실제로 두 행을 병합한다 -
# old_name 행에 걸린 UserChallengeClaim을 new_name 행으로 옮기고(둘 다에 이미 수령 기록이 있는
# 유저는 중복분만 지운다), old_name 행은 지운다. 두 경우 모두 한 번 처리되고 나면 old_name을 가진
# 행이 없어지므로 이후 실행에서는 조용히 스킵된다(멱등).
CHALLENGE_RENAMES = [
    ("도감 Episode 1 No.1 획득", "인연 스토리 도감 Episode 1 No.1 획득"),
    ("도감 Episode 1 No.2 획득", "인연 스토리 도감 Episode 1 No.2 획득"),
    ("도감 Episode 1 No.3 획득", "인연 스토리 도감 Episode 1 No.3 획득"),
    ("도감 Episode 1 No.4 획득", "인연 스토리 도감 Episode 1 No.4 획득"),
    ("도감 Episode 1 No.5 획득", "인연 스토리 도감 Episode 1 No.5 획득"),
    ("도감 Episode 1 No.6 획득", "인연 스토리 도감 Episode 1 No.6 획득"),
    ("도감 Episode 1 No.7 획득", "인연 스토리 도감 Episode 1 No.7 획득"),
    ("도감 Episode 1 No.8 획득", "인연 스토리 도감 Episode 1 No.8 획득"),
    ("도감 Episode 1 No.9 획득", "인연 스토리 도감 Episode 1 No.9 획득"),
    ("도감 Episode 1 No.10 획득", "인연 스토리 도감 Episode 1 No.10 획득"),
    ("도감 Episode 1 No.11 획득", "인연 스토리 도감 Episode 1 No.11 획득"),
    ("★5 이상 캐릭터로 전술대회 전투 참여 1회", "★5 이상 인물로 전술대회 전투 참여 1회"),
    ("여성 캐릭터를 사용해 과목으로 누적 1000exp 획득", "여성 인물과 함께 과목으로 누적 1000exp 획득"),
    ("직업:학생과 함께 과목으로 누적 1000exp 획득", "전부 직업이 학생인 인물과 함께 과목으로 누적 1000exp 획득"),
    ("직업:마법사를 사용해 과목으로 누적 1000exp 획득", "전부 직업이 마법사인 인물과 함께 과목으로 누적 1000exp 획득"),
]


def seed_challenges():
    db = SessionLocal()
    try:
        rename_changed = False
        for old_name, new_name in CHALLENGE_RENAMES:
            old_row = db.query(Challenge).filter(Challenge.name == old_name).first()
            if not old_row:
                continue
            new_row = db.query(Challenge).filter(Challenge.name == new_name).first()
            if not new_row:
                # 깨끗한 경우: 그냥 이름만 바꿔서 행(과 수령 기록)을 그대로 이어간다.
                old_row.name = new_name
                rename_changed = True
                continue

            # 두 이름의 행이 이미 둘 다 있는 경우: old_row에 걸린 수령 기록을 new_row로 옮기고 병합한다.
            old_claims = db.query(UserChallengeClaim).filter(
                UserChallengeClaim.challenge_id == old_row.id
            ).all()
            for claim in old_claims:
                dup = db.query(UserChallengeClaim).filter(
                    UserChallengeClaim.user_id == claim.user_id,
                    UserChallengeClaim.challenge_id == new_row.id,
                ).first()
                if dup:
                    # 이 유저는 이미 두 이름 다 수령한 상태(버그가 실제로 발동했던 경우) - 중복 기록만 지운다.
                    db.delete(claim)
                else:
                    claim.challenge_id = new_row.id
            # UserChallengeClaim 쪽 UPDATE/DELETE를 먼저 DB에 반영해야, 뒤이은 challenges 행 삭제가
            # "아직 이 행을 참조하는 수령 기록이 남아있다"는 외래키 위반 없이 통과한다(Challenge와
            # UserChallengeClaim 사이엔 ORM relationship이 없어 flush 순서가 자동으로 안 맞춰짐 - 실제로
            # 이 순서 문제 때문에 배포가 한 번 실패했었다).
            db.flush()
            db.delete(old_row)
            rename_changed = True
        if rename_changed:
            db.commit()

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
    # ── 일일 퀘스트 (KST 자정에 초기화) - 재화 시스템 개편으로 전면 교체됨 ──────────────
    {
        "name": "독서 문학/비문학 30분",
        "period": "daily",
        "condition_type": "session_minutes",
        "condition_params": {"session_type": "reading"},
        "condition_target": 30,
        "reward_type": "silver",
        "reward_amount": 300,
        "sort_order": 1,
    },
    {
        "name": "과목 공부 2시간",
        "period": "daily",
        "condition_type": "session_minutes",
        "condition_params": {"session_types": ["subject", "mock_exam"]},
        "condition_target": 120,
        "reward_type": "silver",
        "reward_amount": 500,
        "sort_order": 2,
    },
    {
        "name": "과목 공부 4시간",
        "period": "daily",
        "condition_type": "session_minutes",
        "condition_params": {"session_types": ["subject", "mock_exam"]},
        "condition_target": 240,
        "reward_type": "gold",
        "reward_amount": 30,
        "sort_order": 3,
    },
    {
        "name": "모의고사 1회",
        "period": "daily",
        "condition_type": "session_count",
        "condition_params": {"session_type": "mock_exam"},
        "condition_target": 1,
        "reward_type": "gold",
        "reward_amount": 20,
        "sort_order": 4,
    },
    {
        "name": "투기장 입장 3회",
        "period": "daily",
        "condition_type": "pvp_battle_count",
        "condition_target": 3,
        "reward_type": "silver",
        "reward_amount": 500,
        "sort_order": 5,
    },
    {
        "name": "모집 1회",
        "period": "daily",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "gacha_pull"},
        "condition_target": 1,
        "reward_type": "item",
        "reward_amount": 2,
        "reward_item_name": "스토리모드 티켓",
        "sort_order": 6,
    },
    {
        "name": "강화 아이템 구매 1회",
        "period": "daily",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "shop_purchase_enhancement"},
        "condition_target": 1,
        "reward_type": "item",
        "reward_amount": 5,
        "reward_item_name": "투기장모드 티켓",
        "sort_order": 7,
    },
    {
        "name": "스토리모드 티켓 사용 1회",
        "period": "daily",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "story_ticket_use"},
        "condition_target": 1,
        "reward_type": "silver",
        "reward_amount": 500,
        "sort_order": 8,
    },
    {
        "name": "일일 접속",
        "period": "daily",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "login"},
        "condition_target": 1,
        "reward_type": "silver",
        "reward_amount": 200,
        "sort_order": 9,
    },
    {
        "name": "일일 퀘스트 6개 달성",
        "period": "daily",
        "condition_type": "quest_claims_in_period",
        "condition_target": 6,
        "reward_type": "gold",
        "reward_amount": 50,
        "sort_order": 10,
    },
    # ── 주간 퀘스트 (KST 월요일 자정에 초기화) - 재화 시스템 개편으로 전면 교체됨 ─────────
    {
        "name": "독서 문학/비문학 180분",
        "period": "weekly",
        "condition_type": "session_minutes",
        "condition_params": {"session_type": "reading"},
        "condition_target": 180,
        "reward_type": "silver",
        "reward_amount": 1400,
        "sort_order": 1,
    },
    {
        "name": "과목 공부 36시간",
        "period": "weekly",
        "condition_type": "session_minutes",
        "condition_params": {"session_types": ["subject", "mock_exam"]},
        "condition_target": 2160,
        "reward_type": "silver",
        "reward_amount": 1400,
        "sort_order": 2,
    },
    {
        "name": "모의고사 10회",
        "period": "weekly",
        "condition_type": "session_count",
        "condition_params": {"session_type": "mock_exam"},
        "condition_target": 10,
        "reward_type": "gold",
        "reward_amount": 90,
        "sort_order": 3,
    },
    {
        "name": "투기장 입장 15회",
        "period": "weekly",
        "condition_type": "pvp_battle_count",
        "condition_target": 15,
        "reward_type": "gold",
        "reward_amount": 60,
        "sort_order": 4,
    },
    {
        "name": "모집 5회",
        "period": "weekly",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "gacha_pull"},
        "condition_target": 5,
        "reward_type": "silver",
        "reward_amount": 1400,
        "sort_order": 5,
    },
    {
        "name": "강화 아이템 구매 10회",
        "period": "weekly",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "shop_purchase_enhancement"},
        "condition_target": 10,
        "reward_type": "item",
        "reward_amount": 4,
        "reward_item_name": "스토리모드 티켓",
        "sort_order": 6,
    },
    {
        "name": "스토리모드 티켓 사용 10회",
        "period": "weekly",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "story_ticket_use"},
        "condition_target": 10,
        "reward_type": "item",
        "reward_amount": 10,
        "reward_item_name": "투기장모드 티켓",
        "sort_order": 7,
    },
    {
        "name": "거래 구매 1회",
        "period": "weekly",
        "condition_type": "market_activity_count",
        "condition_params": {"action": "buy"},
        "condition_target": 1,
        "reward_type": "silver",
        "reward_amount": 1400,
        "sort_order": 8,
    },
    {
        "name": "접속 5회",
        "period": "weekly",
        "condition_type": "activity_count",
        "condition_params": {"activity_type": "login"},
        "condition_target": 5,
        "reward_type": "silver",
        "reward_amount": 1000,
        "sort_order": 9,
    },
    {
        "name": "주간 퀘스트 6개 달성",
        "period": "weekly",
        "condition_type": "quest_claims_in_period",
        "condition_target": 6,
        "reward_type": "gold",
        "reward_amount": 150,
        "sort_order": 10,
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
    # 픽업모집/상시모집 두 배너 행 자체만 보장해둔다(최초 1회). 실제로 "지금 어떤 픽업이 활성 상태여야
    # 하는지"는 날짜/시각 기반이라 routers/gacha.py의 PICKUP_SCHEDULE + 매 요청마다 확인하는
    # _sync_pickup_banner가 담당하므로 여기서는 관여하지 않는다.
    db = SessionLocal()
    try:
        changed = False
        pickup = db.query(GachaBanner).filter(GachaBanner.banner_type == "pickup").first()
        if pickup is None:
            db.add(GachaBanner(
                name="픽업모집",
                banner_type="pickup",
                image_file="pickup-banner.webp",
                start_date=None,
                end_date=None,
                is_active=True,
            ))
            changed = True
        # "상시모집" 배너는 pickup과 달리 _sync_pickup_banner가 갱신해주지 않는 정적 행이라,
        # image_file 등 필드가 바뀌면(예: 확장자 변경) 재시작만으로 반영되도록 매번 값을 맞춰둔다.
        standard = db.query(GachaBanner).filter(GachaBanner.banner_type == "standard").first()
        if standard is None:
            db.add(GachaBanner(
                name="상시모집",
                banner_type="standard",
                image_file="standard-banner.webp",
                start_date=None,
                end_date=None,
                is_active=True,
            ))
            changed = True
        elif standard.image_file != "standard-banner.webp":
            standard.image_file = "standard-banner.webp"
            changed = True
        if changed:
            db.commit()
    finally:
        db.close()


NOTICES = [
    {
        "title": "독서 RPG 정식 출시!",
        "image_file": "assets/notices/launch.webp",
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
        "image_file": "assets/notices/relationship1.webp",
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
        "image_file": "assets/notices/competition1.webp",
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
        "image_file": "assets/notices/7.24note.webp",
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
    {
        "title": "[인물 소개 - 이의진]",
        "image_file": "assets/notices/eujin.webp",
        "body": (
            "\"나는 이의진이라고 해. 왜 눈을 뜨지 않냐고? 묻지마. 다쳐.\"\n\n"
            "연분홍색 크록스가 매력 포인트입니다. 그는 왜 눈을 뜨지 않는 걸까요?"
        ),
    },
    {
        "title": "7.27 패치노트",
        "image_file": "assets/notices/7.27note.webp",
        "body": (
            "안녕하세요, 독서RPG입니다.\n\n"
            "7.27 패치내역을 알려드리겠습니다.\n"
            "- 신규 인물 \"이의진\"\n"
            "[[red]]2026.7.27 21:20부터 새로운 픽업 모집과 함께 이의진을 모집할 수 있습니다.[[/red]]\n"
            "[[red]]모집포인트는 새로운 픽업이 시작되면 골드로 전환됩니다.[[/red]]\n"
            "- 신규 아이템 4종 추가\n"
            "    - 최재혁의 마법 영약\n"
            "    - 먼지\n"
            "    - 이의진의 연분홍색 크록스\n"
            "    - 강승유의 마우스피스\n"
            "- 아이템 가격 조정\n"
            "- 스토리모드 티켓 버그 수정\n"
            "- 기기 시간 설정을 변경하여 독서 시간을 임의로 늘릴 수 있었던 오류 수정\n"
            "- 절전 모드 전환 시 독서 시간이 정상적으로 기록되지 않던 오류 수정\n"
            "- 독서 시간 측정이 매일 오전 1시에 자동으로 종료되도록 변경\n"
            "- 일일 최대 독서 시간을 18시간으로 조정\n"
            "- 캐릭터 3종의 스킬 모션 및 이펙트 추가\n\n"
            "[[red]]서비스 내 오류 또는 비정상적인 동작을 발견한 경우, 이를 고의로 악용하지 마시고 "
            "개발진들에게 제보해 주시기 바랍니다. 오류를 인지한 상태에서 반복적으로 악용하거나 "
            "부당한 이익을 취한 사실이 확인될 경우, 운영 정책에 따라 계정이 영구 이용 제한될 수 있습니다.[[/red]]"
        ),
    },
    {
            "title": "[인물 소개 - 방임석]",
            "image_file": "assets/notices/imseok.webp",
            "body": (
                "\"오임석입니다. 지도는 하지 않습니다. 재능은 간섭받지 않을 때 가장 아름답게 피어나거든요.\"\n\n"
                "그는 학생의 자율성을 존중했을 뿐. 방치한 것이 아닙니다.\n\n"
                "[[red]]2026.8.4 21:20부터 새로운 픽업 모집과 함께 방임석을 모집할 수 있습니다.[[/red]]\n"
                "[[red]]모집포인트는 새로운 픽업이 시작되면 골드로 전환됩니다.[[/red]]"
            ),
        },
    {
            "title": "[인물 소개 - 윤 & 호]",
            "image_file": "assets/notices/y&h.webp",
            "body": (
                "\"사람들은 의견을 모을 때 머리를 맞댄다던데, 우리는 배를 맞대는 쪽이 더 잘 맞는 것 같아.\"\n\n"
                "둘은 절대 떨어지지 않습니다.\n\n"
                "[[red]]2026.8.11 21:20부터 새로운 픽업 모집과 함께 윤 & 호를 모집할 수 있습니다.[[/red]]\n"
                "[[red]]모집포인트는 새로운 픽업이 시작되면 골드로 전환됩니다.[[/red]]"
                ),
            },
    {
        "title": "독서 RPG ver. 0.5.1 패치노트",
        "image_file": "assets/notices/8.21note.webp",
        "body": (
            "안녕하세요, 독서RPG입니다.\n\n"
            "0.5.1 패치내역을 알려드리겠습니다.\n\n"
            "[[h]]신규 재화 \"실버\"[[/h]]\n"
            "신규 재화 [[gold]]실버[[/gold]]가 게임에 새롭게 도입됩니다! 지역 입장과 퀘스트 등 다양한 경로를 통해 "
            "획득할 수 있으며, 모집을 제외한 다양한 분야에서 활용 가능합니다.\n\n"
            "[[h]]투기장 시스템 개편[[/h]]\n"
            "투기장 시스템이 새롭게 개편됩니다! 이전에 [Active] 스킬은 기본공격 3회 후 자동으로 발동되었으나, "
            "이제는 스킬별 [[gold]]코스트[[/gold]]가 찰 시 자동으로 사용됩니다. 스킬별 코스트는 실제 게임을 "
            "참고해주세요.\n\n"
            "[[h]]기타 버그 수정[[/h]]\n"
            "- 김남옥의 스킬 지속시간과 상태 아이콘의 지속 시간이 일치하지 않는 버그 수정\n"
            "- 퀘스트의 표시 조건과 서버 조건이 일치하지 않는 버그 수정\n\n"
            "[[h]]투기장 인물 밸런스 패치[[/h]]\n"
            "[[table]]인물|방향성\n"
            "윤대웅|[[blue]]조정[[/blue]]\n"
            "윤영준|유지\n"
            "김남옥|유지\n"
            "이영웅|[[green]]상향[[/green]]\n"
            "최재혁|유지\n"
            "청년|유지\n"
            "서민석|유지\n"
            "강승유|유지\n"
            "송주헌|유지\n"
            "강 희|유지\n"
            "이종복|유지\n"
            "임소정|유지\n"
            "불빠따 김어진|[[green]]상향[[/green]]\n"
            "이의진|유지\n"
            "윤 & 호|유지\n"
            "방임석|[[green]]상향[[/green]]\n"
            "배|[[gold]]신규[[/gold]]\n"
            "신|[[gold]]신규[[/gold]]\n"
            "김크장|[[gold]]신규[[/gold]]\n"
            "김룡환|[[gold]]신규[[/gold]]\n"
            "김국회|[[gold]]신규[[/gold]][[/table]]\n"
            "[[hr]]\n"
            "[[h]]1. 시스템: 인물 내구력 업데이트[[/h]]\n"
            "최근 투기장 전투 이력 중, active 스킬을 여러 번 쓰지 못하고 인물이 전사하는 상황이 많이 발생하여 "
            "전투가 박진감 넘치지 않았습니다. 흥미진진한 전장이 될 수 있도록 관련 능력치를 조정합니다.\n\n"
            "체력: 100% → [[green]]125%[[/green]]\n"
            "공격력: 100% → [[blue]]75%[[/blue]]\n\n"
            "[[h]]2. 상향[[/h]]\n"
            "[[gold]]불빠따 김어진[[/gold]]\n\n"
            "현재 불빠따 김어진은 \"불\"을 사용하여 전장을 태워버리는 컨셉에 맞지 않게 active 스킬의 데미지가 "
            "너무 약한 문제가 있었습니다. 이에 따라 데미지를 버프하였습니다.\n\n"
            "active 타인에 공격력: 150%/300% → [[green]]250%/450%[[/green]]\n\n"
            "[[gold]]방임석[[/gold]]\n\n"
            "현재 방임석은 5성 신화 캐릭터임에도 불구하고 아무도 쓰지 않는 상황이 발생하였습니다. 그 문제점 중 "
            "핵심은 active 공격력 부족과 \"방임\" special 기능 때문입니다. 여기서 \"방임\" 능력은 오히려 자신 "
            "기절이라는 디버프 때문에 전장에서 제 능력을 발휘하지 못하는 모습을 보였습니다. 그에 따라 방임의 "
            "기존 컨셉은 유지하되 능력치를 버프합니다.\n\n"
            "active\n"
            "빨간 물감: 공격 대상에게 공격력의 150% 피해 → [[green]]200% 피해[[/green]]\n"
            "파란 물감: 체력이 가장 낮은 아군의 최대 체력 5% 회복 → "
            "[[green]]체력이 가장 낮은 아군에게 최대 체력의 5% 보호막 부여[[/green]]\n"
            "노란 물감: 적 전체를 0.5초 기절 → [[green]]0.75초 기절[[/green]]\n\n"
            "special\n"
            "아군 학생 타입 보유 인물이 존재하는 동안 자신 기절, 받는 피해량 50% 감소 → "
            "[[green]]60% 감소[[/green]]\n\n"
            "[[gold]]이영웅[[/gold]]\n\n"
            "이영웅은 투기장에서 꾸준한 장점을 보여주고 있는 캐릭터입니다. 하지만, 5성 이영웅의 special 기능인 "
            "\"히포크라테스 선서\"의 메커니즘 중 사망 시 아군 회복 메커니즘의 이점을 찾기 힘들었습니다. 가령 "
            "이영웅을 전방에 배치할 시 이영웅이 죽을 시 아군은 이미 100%의 체력을 유지하는 경우가 태반이기 "
            "때문입니다. 그래서 이를 유의미한 기술로 바꾸기 위해 버프를 진행합니다.\n\n"
            "special\n"
            "자신이 죽을 때, 아군에게 이영웅 최대 체력의 10% 회복 → [[green]]최대 체력의 10% 보호막[[/green]]\n\n"
            "[[h]]3. 조정[[/h]]\n"
            "[[gold]]윤대웅[[/gold]]\n\n"
            "윤대웅은 시간이 지날수록 쎄지는 컨셉에 맞지 않게 현재 active 스킬의 가치가 떨어지는 평가를 받고 "
            "있습니다. 따라서 이 컨셉에 맞도록 active 스킬의 메커니즘을 수정합니다.\n\n"
            "active\n"
            "전투 종료 시까지 자신의 공격력 15% 증가, 최대 6회 중첩 → "
            "[[blue]]자신의 공격속도 15% 증가, 최대 6회 중첩[[/blue]]\n\n"
            "[[h]]4. 신규[[/h]]\n"
            "이제 [[gold]]배[[/gold]], [[gold]]신[[/gold]], [[gold]]김크장[[/gold]], [[gold]]김룡환[[/gold]], "
            "[[gold]]김국회[[/gold]]가 새롭게 독서 RPG에 추가됩니다! [[gold]]SUPPORTER[[/gold]] 포지션이 신설되며 "
            "더 강력한 전략을 사용할 수 있는 투기장을 접해보세요. 순서대로 영웅, 신화, 일반, 희귀, 전설 등급으로 "
            "출시됩니다.\n\n"
            "감사합니다."
        ),
    },
    {
        "title": "[특별 픽업 모집 예고]",
        "image_file": "assets/notices/supporter.webp",
        "body": (
            "새로운 특별 픽업 모집이 시작될 예정입니다!\n\n"
            "8/21 21:30 ~ 8/24 21:29: ★1 김크장, ★2 김룡환\n"
            "8/24 21:30 ~ 8/27 21:29:  ★3 배, ★4 김국회\n"
            "8/30 21:30 ~ 9/2 21:29:  ★5 신"
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


def seed_market_state():
    """인력 거래소 전체 매물 상한(10개) 체크용 잠금 행(id=1) 하나만 존재하면 되는 싱글턴 테이블 -
    없으면 만들어두기만 하면 되고 값 자체는 없다(routers/market.py가 이 행을 with_for_update로
    잠그기만 한다)."""
    db = SessionLocal()
    try:
        if not db.query(MarketState).filter(MarketState.id == 1).first():
            db.add(MarketState(id=1))
            db.commit()
    finally:
        db.close()