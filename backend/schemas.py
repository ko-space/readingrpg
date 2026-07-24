import re
from pydantic import BaseModel, field_validator

# 한글 1자는 2, 영문/숫자 1자는 1로 계산해서 총합 16 이하 (한글 8자/영문 16자 내외 규칙과 동일)
NICKNAME_ALLOWED = re.compile(r'^[가-힣A-Za-z0-9]+$')
NICKNAME_MAX_WEIGHT = 16


def _validate_nickname(v: str) -> str:
    if not v or not NICKNAME_ALLOWED.match(v):
        raise ValueError("닉네임은 한글/영문/숫자만 사용할 수 있고 공백·특수문자는 쓸 수 없습니다.")
    weight = sum(2 if '가' <= ch <= '힣' else 1 for ch in v)
    if weight > NICKNAME_MAX_WEIGHT:
        raise ValueError("닉네임이 너무 깁니다. (한글 8자 또는 영문 16자 이내)")
    return v


class GoogleSignupRequest(BaseModel):
    id_token: str
    nickname: str
    age: int

    @field_validator("nickname")
    @classmethod
    def check_nickname(cls, v: str) -> str:
        return _validate_nickname(v)


class GoogleLoginRequest(BaseModel):
    id_token: str


class HeartbeatRequest(BaseModel):
    tab_id: str  # 브라우저 탭마다 하나씩 생기는 식별자(sessionStorage 보관). 같은 계정이어도 다른 탭이면 다르다.


class LogCreate(BaseModel):
    dungeon_name: str
    difficulty: str  # session_type="reading"이면 장르(문학/비문학), 아니면 과목명
    reading_minutes: int
    session_type: str = "reading"  # "reading" | "subject" | "mock_exam"
    is_auto_complete: bool = False  # mock_exam 전용: 타이머가 끝까지 흘러 자동 제출됐는지("포기하기"로 중도 종료하면 False)


class PurchaseRequest(BaseModel):
    item_id: int
    quantity: int = 1


class EquipRequest(BaseModel):
    character_id: int


class ApplyOutfitRequest(BaseModel):
    item_id: int


class GachaSelectRequest(BaseModel):
    pickup_id: int


class PvpDefenseRequest(BaseModel):
    front_character_id: int
    back_character_id: int


class PvpBattleRequest(BaseModel):
    defender_id: int


class CharacterOutfitRequest(BaseModel):
    character_id: int
    outfit_file: str


class EnhancementRequest(BaseModel):
    character_name: str
    star: int
    item_ids: list[int] = []  # 이번 강화에 사용할 UserItem id 목록 (같은 아이템 중복 선택 불가)


class EquipTitleRequest(BaseModel):
    achievement_id: int | None = None  # None이면 칭호를 해제(미착용)한다.


class QuestClaimRequest(BaseModel):
    quest_id: int


class ChallengeClaimRequest(BaseModel):
    challenge_id: int


class StoryProgressRequest(BaseModel):
    story_id: str
    scene_key: str | None = None
    state: dict | None = None


class StoryUnlockCgRequest(BaseModel):
    story_id: str
    cg_id: str


class StoryConsumeTicketRequest(BaseModel):
    story_id: str


class NicknameUpdateRequest(BaseModel):
    nickname: str

    @field_validator("nickname")
    @classmethod
    def check_nickname(cls, v: str) -> str:
        return _validate_nickname(v)


class DevTestUnitConfig(BaseModel):
    """개발자 테스트 창 전용 - 실제 보유 캐릭터가 아니라 임의의 이름/성급/수치로 유닛을 구성한다."""
    character_name: str
    star: int
    hp_override: int | None = None
    atk_override: int | None = None
    attack_interval_override: float | None = None
    level_override: int | None = None
    skill_params_override: dict | None = None


class DevTestBattleRequest(BaseModel):
    attacker_front: DevTestUnitConfig
    attacker_back: DevTestUnitConfig
    defender_front: DevTestUnitConfig
    defender_back: DevTestUnitConfig