from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Date, Float, Boolean, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    nickname = Column(String, unique=True, index=True, nullable=False)
    age = Column(Integer, nullable=False)
    google_sub = Column(String, unique=True, index=True, nullable=True)  # 구글 계정 고유 ID. 로그인 식별자
    email = Column(String, nullable=True)
    level = Column(Integer, default=1)
    total_exp = Column(Integer, default=0)      # 현재 레벨 내 진행도(레벨업마다 초기화됨)
    lifetime_exp = Column(Integer, default=0)   # 절대 감소하지 않는 진짜 누적 경험치. 업적 판정용
    gold = Column(Integer, default=0)
    gacha_points = Column(Integer, default=0)   # 모집 포인트. 가챠 1회당 적립, 인물 선택에서 소모
    daily_reading_minutes = Column(Integer, default=0)  # 오늘 누적 독서 분. 자정(KST) 지나면 logs.py에서 0으로 리셋
    daily_reading_date = Column(Date, nullable=True)     # daily_reading_minutes가 마지막으로 누적된 날짜(KST 기준)
    lifetime_reading_minutes = Column(Integer, default=0)  # 절대 감소하지 않는 누적 독서 분. 랭킹("누적 독서시간")용
    current_region_id = Column(Integer, ForeignKey("regions.id"), default=1)

    pvp_rank = Column(Integer, nullable=True, unique=True)  # 낮을수록 높은 순위(1등이 최고). 신규 유저는 users.py에서 꼴찌로 배정
    pvp_defense_front_id = Column(Integer, ForeignKey("characters.id"), nullable=True)
    pvp_defense_back_id = Column(Integer, ForeignKey("characters.id"), nullable=True)

    lifetime_gold = Column(Integer, default=0)  # 소비와 무관하게 절대 감소하지 않는 누적 획득 골드. 업적("황금의 사냥꾼") 판정용
    equipped_achievement_id = Column(Integer, ForeignKey("achievements.id"), nullable=True)  # 지금 표시 중인 칭호.
    # 업적 이름 문자열이 아니라 id로 저장해서, 업적 이름이 나중에 바뀌거나 히든 여부를 조회할 때 항상 최신 값을 따라간다.

    logs = relationship("ReadingLog", back_populates="owner")
    characters = relationship("Character", back_populates="owner", foreign_keys="Character.user_id")
    items = relationship("UserItem", back_populates="owner")
    achievements = relationship("UserAchievement", back_populates="owner")


class Character(Base):
    __tablename__ = "characters"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String, default="청년")
    job_class = Column(String, default="초심자")
    rarity = Column(String, default="일반")
    star = Column(Integer, default=1)   # 성(星). 등급별 시작 성: 신화5/전설4/영웅3/희귀2/일반1. 강화 시스템(추후)으로 6까지 올림
    outfit = Column(String, default="beginner_basic.png")
    is_equipped = Column(Integer, default=1)
    is_indestructible = Column(Boolean, default=False)  # "강 희의 파쇄술" 히든 업적 보상 전용 - 강화 파괴 판정이 유지로 바뀜

    owner = relationship("User", back_populates="characters", foreign_keys=[user_id])


class ReadingLog(Base):
    __tablename__ = "reading_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=True)
    dungeon_name = Column(String, default="초심자의 평원")  # 로그 시점 스냅샷(지역이 나중에 개명돼도 기록은 유지)
    difficulty = Column(String)  # session_type에 따라 의미가 다름: reading=장르(문학/비문학), subject/mock_exam=과목명
    session_type = Column(String, default="reading")  # "reading"(독서) | "subject"(과목) | "mock_exam"(모의고사)
    reading_minutes = Column(Integer)
    is_auto_complete = Column(Boolean, default=False)  # mock_exam 전용: 타이머가 끝까지 흘러 자동 제출됐는지
    earned_exp = Column(Integer)
    earned_gold = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="logs")
    region = relationship("Region")


class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    item_type = Column(String, default="outfit")  # "outfit" 또는 "enhancement"
    icon_file = Column(String, nullable=True)      # 의상이 아닌 아이템(강화 아이템 등)의 아이콘 이미지. assets/items/ 안의 파일명
    outfit_file = Column(String, nullable=True)    # 의상 아이템만 사용
    season = Column(String, nullable=True)         # 의상 아이템만 사용
    icon_file = Column(String, nullable=True)       # 의상이 아닌 아이템(강화 아이템 등)의 아이콘 이미지 경로
    description = Column(String, nullable=True)     # 아이템 묘사(플레이버 텍스트)
    rarity = Column(String, default="일반")
    price = Column(Integer, nullable=False)
    source_character = Column(String, nullable=True)  # "이 캐릭터 보유해야 구매 가능" (의상/강화 아이템 공통)
    is_shop_active = Column(Boolean, default=True)  # 상점에 지금 노출할지 여부. 의상은 한정판매라 기본 False로 시드됨
    required_achievement = Column(String, nullable=True)  # 이 업적(Achievement.name)을 달성해야 구매 가능. source_character와 별개 조건
    purchase_limit = Column(Integer, nullable=True)  # 평생 최대 구매 가능 수량. None이면 제한 없음(UserItemPurchase.total_purchased로 판정)
    daily_purchase_limit = Column(Integer, nullable=True)  # 하루 최대 구매 가능 수량(KST 기준). None이면 제한 없음(UserDailyItemPurchase로 판정)

    # 강화 아이템 전용 - 효과를 코드가 아니라 데이터로 표현해서, 새 아이템 추가 시 코드 수정 없이
    # 이 두 필드(행 하나)만 채우면 되게 한다.
    effect_type = Column(String, nullable=True)    # "shift" | "redistribute" | "force"
    effect_params = Column(JSON, nullable=True)     # 효과별 세부 수치 (아래 characters.py 주석 참고)


class UserItem(Base):
    __tablename__ = "user_items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    item_id = Column(Integer, ForeignKey("items.id"))
    quantity = Column(Integer, default=1)  # 지금 쓸 수 있는 수량. 사용(강화 등)하면 줄어들고 0이면 행이 삭제될 수 있다.

    owner = relationship("User", back_populates="items")
    item = relationship("Item")


class UserItemPurchase(Base):
    """구매 한도(purchase_limit)가 있는 아이템 전용 누적 구매 기록.
    UserItem.quantity는 사용하면 줄어들어 행이 삭제되기도 하니, "평생 몇 개 샀는지"는
    따로 떼어서 절대 줄어들지 않는 카운터로 관리해야 재구매 편법을 막을 수 있다."""
    __tablename__ = "user_item_purchases"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    item_id = Column(Integer, ForeignKey("items.id"))
    total_purchased = Column(Integer, default=0)


class UserDailyItemPurchase(Base):
    """UserItemPurchase(평생 누적)와 별개로, 하루 단위 구매 한도(Item.daily_purchase_limit)를
    판정하기 위한 일일 카운터. (user_id, item_id, purchase_date) 조합마다 한 행만 존재."""
    __tablename__ = "user_daily_item_purchases"
    __table_args__ = (UniqueConstraint("user_id", "item_id", "purchase_date", name="uq_user_item_daily"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    item_id = Column(Integer, ForeignKey("items.id"))
    purchase_date = Column(Date, nullable=False)  # KST 기준 날짜
    quantity = Column(Integer, default=0)


class UserStoryProgress(Base):
    """인연 스토리(비주얼노벨) 진행 체크포인트. scene_key/state_json은 전부 프론트(story-engine.js)가
    해석하는 값이라 서버는 그대로 저장/반환만 한다(서사 콘텐츠는 경쟁 요소가 없어 서버가 검증할 실익이 없음).
    티켓 잔량만 서버가 전적으로 관리(UserItem)."""
    __tablename__ = "user_story_progress"
    __table_args__ = (UniqueConstraint("user_id", "story_id", name="uq_user_story"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    story_id = Column(String, nullable=False)          # 예: "ep1_yoondaewoong"
    scene_key = Column(String, nullable=True)           # 이어하기 체크포인트. None이면 미시작
    state_json = Column(JSON, nullable=True)            # choice1/affJuheon 등 클라이언트가 해석하는 진행 변수
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class UserCgUnlock(Base):
    """스토리 CG 도감 잠금 해제 기록. (user_id, story_id, cg_id) 조합마다 한 행."""
    __tablename__ = "user_cg_unlocks"
    __table_args__ = (UniqueConstraint("user_id", "story_id", "cg_id", name="uq_user_cg"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    story_id = Column(String, nullable=False)
    cg_id = Column(String, nullable=False)
    unlocked_at = Column(DateTime, default=datetime.utcnow)


class Region(Base):
    __tablename__ = "regions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    order = Column(Integer, nullable=True)             # 순차 진행 지역만 값이 있음. 상시 오픈 지역(투기장 등)은 None
    required_level = Column(Integer, nullable=False)   # always_open이면 사실상 무시됨
    always_open = Column(Boolean, default=False)        # True면 순서/레벨 상관없이 항상 입장 가능
    description = Column(String, default="")           # 던전 입장 시 보여줄 플레이버 텍스트
    exp_rate = Column(Float, default=1.0)               # 분당 획득 경험치 배율
    gold_rate = Column(Float, default=0.0)              # 분당 획득 골드 배율 (대부분 0, 투기장류만 존재)


class Achievement(Base):
    __tablename__ = "achievements"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, default="")
    condition_type = Column(String, nullable=False)
    condition_value = Column(Integer, nullable=False)
    condition_params = Column(JSON, nullable=True)  # condition_type이 단순 수치 비교를 넘어설 때 쓰는 세부 조건
                                                       # (예: own_characters면 {"names": [...]}). achievements.py 주석 참고.
    is_hidden = Column(Boolean, default=False)  # True면 달성 전까지 이름/조건을 감추고 "???"로 노출

    # 보상 - 코드에 캐릭터/아이템 지급 로직을 흩어두지 않고, 여기 세 필드(데이터)로 표현한다.
    reward_gold = Column(Integer, default=0)
    reward_exp = Column(Integer, default=0)
    reward_items = Column(JSON, nullable=True)  # [{"type": "character"|"item", "name": str, "quantity": int, "indestructible": bool?}]


class UserAchievement(Base):
    __tablename__ = "user_achievements"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    achievement_id = Column(Integer, ForeignKey("achievements.id"))
    earned_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="achievements")
    achievement = relationship("Achievement")


class GachaBanner(Base):
    __tablename__ = "gacha_banners"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)              # 화면에 뜨는 배너 제목 (예: "픽업모집")
    banner_type = Column(String, nullable=False)        # "pickup" 또는 "standard"
    image_file = Column(String, nullable=True)          # 배너 썸네일 파일명 (assets/gacha/ 안)
    start_date = Column(DateTime, nullable=True)         # standard(상시)면 NULL
    end_date = Column(DateTime, nullable=True)           # standard(상시)면 NULL
    is_active = Column(Boolean, default=True)

    pickups = relationship("GachaBannerPickup", back_populates="banner")


class GachaBannerPickup(Base):
    __tablename__ = "gacha_banner_pickups"

    id = Column(Integer, primary_key=True, index=True)
    banner_id = Column(Integer, ForeignKey("gacha_banners.id"))
    character_name = Column(String, nullable=False)     # characters.json의 캐릭터 이름과 일치해야 함
    point_cost = Column(Integer, default=20)             # 모집 포인트로 직접 교환 시 필요한 비용
    rate_up = Column(Float, default=0.5)                 # 이 캐릭터의 등급이 걸렸을 때 확정될 확률 (0~1)

    banner = relationship("GachaBanner", back_populates="pickups")


class PvpBattleLog(Base):
    __tablename__ = "pvp_battle_logs"

    id = Column(Integer, primary_key=True, index=True)
    attacker_id = Column(Integer, ForeignKey("users.id"))
    defender_id = Column(Integer, ForeignKey("users.id"))
    winner_id = Column(Integer, ForeignKey("users.id"))
    rank_changed = Column(Boolean, default=False)  # 3등 이하가 아랫순위와 붙은 "친선전"이면 False
    acknowledged = Column(Boolean, default=False)  # 방어자가 "순위 변동 알림"을 확인했는지
    attacker_rank_before = Column(Integer, nullable=True)
    defender_rank_before = Column(Integer, nullable=True)
    attacker_front_name = Column(String, nullable=True)  # 전투 시점의 공격자 전방/후방 캐릭터명 스냅샷.
    attacker_back_name = Column(String, nullable=True)   # 이후 편성이 바뀌어도 "조합 승수" 업적 판정이 흔들리지 않게 함
    battle_log = Column(String)  # JSON 문자열로 저장된 전투 이벤트 목록 (프론트에서 애니메이션 재생용)
    created_at = Column(DateTime, default=datetime.utcnow)

    attacker = relationship("User", foreign_keys=[attacker_id])
    defender = relationship("User", foreign_keys=[defender_id])


class ActivityLog(Base):
    """퀘스트(일일/주간) 진행도 판정용 범용 활동 기록. 독서/과목/모의고사는 이미 ReadingLog가,
    투기장 입장은 이미 PvpBattleLog가 있으니 그걸 그대로 쓰고, 그 외(모집/강화 아이템 구매/캐릭터 강화
    시도/접속)처럼 시각이 찍힌 로그가 없던 행동만 여기에 남긴다. quests.py가 activity_type과 기간(생성
    시각)으로 세어서 진행도를 계산한다."""
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    activity_type = Column(String, nullable=False)  # "gacha_pull" | "shop_purchase_enhancement" | "character_enhance" | "login" | "story_ticket_use"
    created_at = Column(DateTime, default=datetime.utcnow)


class Quest(Base):
    """일일/주간 퀘스트 정의. achievements.py와 같은 사상: 조건(condition_type/condition_params/
    condition_target)과 보상(reward_type/reward_amount)을 데이터로 표현한다. 업적과 다른 점은 유저별
    달성 상태를 저장하지 않고, 매번 "지금이 속한 기간(일일=KST 자정, 주간=KST 월요일 자정)" 동안 쌓인
    로그만 세어서 진행도를 계산한다는 것 - 그래서 기간이 지나면 자동으로 초기화된다."""
    __tablename__ = "quests"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    period = Column(String, nullable=False)  # "daily" | "weekly"
    condition_type = Column(String, nullable=False)
    condition_params = Column(JSON, nullable=True)
    condition_target = Column(Integer, nullable=False, default=1)
    reward_type = Column(String, nullable=False)  # "exp" | "gold"
    reward_amount = Column(Integer, nullable=False, default=0)
    sort_order = Column(Integer, default=0)


class UserQuestClaim(Base):
    """퀘스트 보상 수령 기록. period_key로 "어느 회차"인지 구분한다(일일="2026-07-20",
    주간="W2026-07-20"(그 주 월요일) - 접두어를 달리 붙여서 같은 날짜 문자열이라도 절대 안 겹치게 함).
    같은 (user_id, quest_id, period_key) 조합은 한 번만 존재할 수 있어 중복 수령을 막는다."""
    __tablename__ = "user_quest_claims"
    __table_args__ = (UniqueConstraint("user_id", "quest_id", "period_key", name="uq_user_quest_period"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    quest_id = Column(Integer, ForeignKey("quests.id"))
    period_key = Column(String, nullable=False)
    claimed_at = Column(DateTime, default=datetime.utcnow)