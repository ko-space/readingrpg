from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
from database import get_db
from models import User, ReadingLog, Region
from schemas import LogCreate
from security import get_current_user
from leveling import apply_exp
from achievements import check_and_grant_achievements, get_character_catalog

router = APIRouter(prefix="/logs", tags=["logs"])

DIFFICULTY_MULTIPLIER = {"문학": 1.0, "비문학": 1.5}
SUBJECT_SET = {"국어", "수학", "영어", "탐구", "기타"}
MOCK_EXAM_MINUTES = {
    "국어": 80, "수학": 100, "수학(하프)": 50, "영어": 70, "영어(하프)": 40,
    "한국사": 30, "탐구": 30, "한문/제2외국어": 40,
}
DAILY_READING_MINUTES_CAP = 18 * 60  # 하루 최대 인정 독서시간(1080분) - 기기 시스템 시간을 조작해서
# 한 번에 비정상적으로 긴 시간을 보고하는 부정행위를 막기 위한 상한. session_type과 무관하게 그날(KST)
# 누적된 daily_reading_minutes 전체에 적용된다.
# 모의고사의 "하프" 변형은 배수 판정에서 원래 과목과 같은 것으로 취급한다(수학과 영어만 하프가 있음).
# 한국사/한문·제2외국어는 독립 과목이 아니라 "기타" 공부시간으로 합산된다(탐구 앞뒤에 끼워 넣은
# 모의고사 전용 과목 - 과목(subject) 탭에는 없음).
MOCK_EXAM_BASE_SUBJECT = {"수학(하프)": "수학", "영어(하프)": "영어", "한국사": "기타", "한문/제2외국어": "기타"}
KST = timezone(timedelta(hours=9))


def _resolve_matched_subject(session_type: str, difficulty: str) -> str | None:
    """이번 기록이 어떤 "과목"에 해당하는지 판정한다. 캐릭터의 exp_subjects와 대조해서 성급별 EXP
    배수를 적용할지 결정하는 데 쓰인다. 독서(문학/비문학)는 장르와 무관하게 항상 "독서" 과목 취급."""
    if session_type == "reading":
        return "독서"
    if session_type == "subject":
        return difficulty
    if session_type == "mock_exam":
        return MOCK_EXAM_BASE_SUBJECT.get(difficulty, difficulty)
    return None


def _get_equipped_character(user):
    return next((c for c in user.characters if c.is_equipped == 1), None)


def _equipped_character_exp_multiplier(equipped, matched_subject: str | None) -> float:
    """지금 장착 중인 캐릭터가 이번 학습의 과목에 지정돼 있으면 그 캐릭터의 성급별 EXP 배수를,
    아니면(장착 캐릭터가 없거나, 지정 과목이 아니거나, 그 성급에 배수가 없으면) 1.0(배수 없음)을 돌려준다."""
    if not matched_subject or not equipped:
        return 1.0
    catalog = get_character_catalog(equipped.name)
    if not catalog or matched_subject not in (catalog.get("exp_subjects") or []):
        return 1.0
    multiplier = (catalog.get("exp_multiplier") or {}).get(str(equipped.star))
    return multiplier if multiplier is not None else 1.0

def _today_kst():
    # 서버가 어느 시간대에서 돌든(Render는 보통 UTC) 상관없이, 한국 기준 자정에 맞춰 초기화되도록
    # 항상 KST로 변환한 날짜를 씀.
    return datetime.now(KST).date()


def _next_1am_kst_at_or_after(moment_kst: datetime) -> datetime:
    """moment_kst(KST 기준 datetime) 이후(그 시각 포함) 가장 가까운 한국시간 오전 1시를 구한다."""
    candidate = moment_kst.replace(hour=1, minute=0, second=0, microsecond=0)
    if candidate < moment_kst:
        candidate += timedelta(days=1)
    return candidate


READING_GENRES = ["비문학", "문학"]
SUBJECT_DISPLAY_ORDER = ["국어", "영어", "수학", "탐구", "기타"]


@router.get("/daily-summary")
def get_daily_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """오늘(KST) 학습 시간 - 로비 '오늘의 독서 현황' 모달용.
    독서(진)은 장르(비문학/문학)별로, 과목은 과목명별로 각각 나눠서 합산한다.
    모의고사(mock_exam)는 시간만 반영 - 별도 항목 없이 해당 과목의 합계에 그대로 더해진다
    ("수학(하프)"/"영어(하프)"는 MOCK_EXAM_BASE_SUBJECT로 원래 과목에 합산).
    created_at은 UTC로 저장되므로 "오늘(KST)" 하루를 UTC 구간으로 변환해서 필터링한다."""
    today_kst = _today_kst()
    start_utc = datetime(today_kst.year, today_kst.month, today_kst.day, tzinfo=KST).astimezone(timezone.utc).replace(tzinfo=None)
    end_utc = start_utc + timedelta(days=1)
    rows = db.query(ReadingLog).filter(
        ReadingLog.user_id == user.id,
        ReadingLog.created_at >= start_utc,
        ReadingLog.created_at < end_utc,
    ).all()

    reading = {genre: 0 for genre in READING_GENRES}
    subject = {name: 0 for name in SUBJECT_DISPLAY_ORDER}

    for row in rows:
        minutes = row.reading_minutes or 0
        if row.session_type == "reading" and row.difficulty in reading:
            reading[row.difficulty] += minutes
        elif row.session_type == "subject" and row.difficulty in subject:
            subject[row.difficulty] += minutes
        elif row.session_type == "mock_exam":
            base_subject = MOCK_EXAM_BASE_SUBJECT.get(row.difficulty, row.difficulty)
            if base_subject in subject:
                subject[base_subject] += minutes

    return {"reading": reading, "subject": subject}


@router.post("/")
def add_reading_log(
    log_data: LogCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    region = db.query(Region).filter(Region.name == log_data.dungeon_name).first()
    if not region:
        raise HTTPException(status_code=400, detail=f"존재하지 않는 던전(지역)입니다: {log_data.dungeon_name}")

    if not region.always_open and user.level < region.required_level:
        raise HTTPException(
            status_code=403,
            detail=f"'{region.name}'은(는) 레벨 {region.required_level} 이상부터 입장할 수 있습니다."
        )

    if log_data.session_type == "reading":
        if log_data.difficulty not in DIFFICULTY_MULTIPLIER:
            raise HTTPException(status_code=400, detail=f"존재하지 않는 장르입니다: {log_data.difficulty}")
        difficulty_multiplier = DIFFICULTY_MULTIPLIER[log_data.difficulty]
        reading_minutes = log_data.reading_minutes
    elif log_data.session_type == "subject":
        if log_data.difficulty not in SUBJECT_SET:
            raise HTTPException(status_code=400, detail=f"존재하지 않는 과목입니다: {log_data.difficulty}")
        difficulty_multiplier = 1.0
        reading_minutes = log_data.reading_minutes
    elif log_data.session_type == "mock_exam":
        if log_data.difficulty not in MOCK_EXAM_MINUTES:
            raise HTTPException(status_code=400, detail=f"존재하지 않는 모의고사 과목입니다: {log_data.difficulty}")
        difficulty_multiplier = 1.0
        # 모의고사는 정해진 시간만큼만 자동으로 흐르는 세션이라, 클라이언트 값을 그대로 믿지 않고 상한을 건다.
        reading_minutes = min(log_data.reading_minutes, MOCK_EXAM_MINUTES[log_data.difficulty])
    else:
        raise HTTPException(status_code=400, detail=f"존재하지 않는 학습 유형입니다: {log_data.session_type}")

    if reading_minutes < 0:
        raise HTTPException(status_code=400, detail="독서 시간은 0 이상이어야 합니다.")

    # 지역입장(세션)을 다음날 새벽까지 켜놓고 방치하는 것을 막는 컷오프 - 서버는 실제 세션 시작 시각을
    # 모르니, "지금 - 신고된 경과분"을 시작 시각으로 역산해서 그 이후 가장 가까운 한국시간 오전 1시를
    # 구한다. 그 컷오프를 넘겨서까지 신고된 시간이 있다면 초과분은 잘라낸다(프론트 타이머도 1시가
    # 지나면 더 이상 누적하지 않게 되어 있는 것과 같은 규칙 - 여기서는 그걸 서버에서도 강제한다).
    now_kst = datetime.now(KST)
    inferred_start_kst = now_kst - timedelta(minutes=reading_minutes)
    session_cutoff_kst = _next_1am_kst_at_or_after(inferred_start_kst)
    if now_kst > session_cutoff_kst:
        allowed_minutes = max(0, int((session_cutoff_kst - inferred_start_kst).total_seconds() // 60))
        reading_minutes = min(reading_minutes, allowed_minutes)

    # 하루 누적 상한(18시간) 적용 - 오늘(KST) 자정이 지났으면 먼저 리셋하고, 남은 여유만큼만 인정한다.
    # 보상(exp/gold)도 이 잘라낸 reading_minutes를 기준으로 계산되므로, 기기 시간을 조작해 한 번에
    # 몰아서 보고해도 상한을 넘는 만큼은 보상이 발생하지 않는다.
    today = _today_kst()
    if user.daily_reading_date != today:
        user.daily_reading_minutes = 0
        user.daily_reading_date = today
    remaining_daily_cap = max(0, DAILY_READING_MINUTES_CAP - user.daily_reading_minutes)
    if remaining_daily_cap <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"하루 최대 독서 시간({DAILY_READING_MINUTES_CAP // 60}시간)을 이미 채웠습니다.",
        )
    reading_minutes = min(reading_minutes, remaining_daily_cap)

    equipped = _get_equipped_character(user)
    matched_subject = _resolve_matched_subject(log_data.session_type, log_data.difficulty)
    character_exp_multiplier = _equipped_character_exp_multiplier(equipped, matched_subject)

    gained_exp = int(reading_minutes * region.exp_rate * difficulty_multiplier * character_exp_multiplier)
    gained_gold = int(reading_minutes * region.gold_rate)

    user.gold += gained_gold
    user.lifetime_gold += gained_gold

    # 일일 독서시간 누적 (리셋은 위 상한 계산 때 이미 처리됨)
    user.daily_reading_minutes += reading_minutes
    user.lifetime_reading_minutes += reading_minutes

    # 로비의 "현재 지역" 표시(region_info)가 가리키는 값 - /regions/advance(순차 진행)는 프론트에서
    # 아무도 호출하지 않아 사실상 죽은 경로라, 대신 "가장 최근에 입장해 학습을 완료한 지역"으로
    # 갱신한다. 이 함수는 던전 화면에서 지역을 자유롭게 골라 들어온 뒤 세션을 마칠 때마다 호출되므로,
    # 여기서 갱신하는 게 곧 "최근 입장 지역"과 같은 의미가 된다.
    user.current_region_id = region.id

    new_log = ReadingLog(
        user_id=user.id,
        region_id=region.id,
        dungeon_name=region.name,
        difficulty=log_data.difficulty,
        session_type=log_data.session_type,
        reading_minutes=reading_minutes,
        equipped_character_name=equipped.name if equipped else None,
        earned_exp=gained_exp,
        earned_gold=gained_gold,
        is_auto_complete=log_data.is_auto_complete and log_data.session_type == "mock_exam",
    )
    db.add(new_log)

    start_level = user.level   # 이번 독서로 exp가 반영되기 '전' 상태 - 프론트 레벨업 바 애니메이션의 시작점
    start_exp = user.total_exp

    level_result = apply_exp(user, gained_exp)

    db.commit()
    db.refresh(user)

    new_achievements, new_characters = check_and_grant_achievements(db, user)

    return {
        "message": "독서 기록이 성공적으로 저장되었습니다!",
        "gained_exp": gained_exp,
        "gained_gold": gained_gold,
        "start_level": start_level,
        "start_exp": start_exp,
        "current_level": user.level,
        "current_exp": user.total_exp,
        "lifetime_exp": user.lifetime_exp,
        "daily_reading_minutes": user.daily_reading_minutes,
        "level_up": level_result["level_up"],
        "levels_gained": level_result["levels_gained"],
        "new_achievements": new_achievements,
        "new_characters": new_characters
    }