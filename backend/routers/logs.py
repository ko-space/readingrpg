from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
from database import get_db
from models import User, ReadingLog, Region, UserRegionUnlock, ReadingSessionState
from schemas import LogCreate, ReadingSessionStartRequest, ReadingSessionTokenRequest
from security import get_current_user
from leveling import apply_exp
from achievements import check_and_grant_achievements, get_character_catalog

router = APIRouter(prefix="/logs", tags=["logs"])

GOLD_MINE_REGION_NAME = "종말의 금광"  # 레벨 조건 외에 구매(UserRegionUnlock) 여부도 확인해야 하는 유일한 지역

DIFFICULTY_MULTIPLIER = {"문학": 1.0, "비문학": 1.5}
SUBJECT_SET = {"국어", "수학", "영어", "탐구", "기타"}
MOCK_EXAM_MINUTES = {
    "국어": 80, "수학": 100, "수학(하프)": 50, "영어": 70, "영어(하프)": 40,
    "한국사": 30, "탐구": 30, "탐구(2회분)": 62, "한문/제2외국어": 40,
}
DAILY_READING_MINUTES_CAP = 18 * 60  # 하루 최대 인정 독서시간(1080분) - session_type과 무관하게
# 그날(KST) 누적된 daily_reading_minutes 전체에 적용된다. 순수하게 "하루 최대 인정 시간" 게임
# 규칙이다.

# ── 세션 시간 조작 방지(근본 수정) ──────────────────────────────────────────────
# 예전엔 클라이언트(reading.js)가 자체 타이머로 계산한 reading_minutes를 그대로 믿었다. 그런데
# 타이머 안에는 "화면이 꺼져있던 동안(백그라운드 탭 등)의 공백을 보정"하는 correctSuspendedGap이
# 있었는데, 이 보정이 Date.now()(기기 시스템 시계 - 사용자가 설정에서 바로 바꿀 수 있음)와
# performance.now()(조작 불가능한 엔진 내부 시계)의 차이로 "공백"을 판단했다. 즉 세션 도중 기기
# 시간을 몇 시간 앞으로 돌리기만 하면, 실제로는 몇 초도 안 지났는데 그 차이 전체가 상한 없이
# "경과 시간"으로 인정돼버렸다(실제 신고 사례 - 664분짜리 세션이 71분 만에 기록됨).
# 근본 수정: 클라이언트가 "얼마나 지났다"고 보고하는 값을 아예 신뢰하지 않는다. 대신 서버가
# ReadingSessionState 행에 세션 상태를 직접 들고 있다가, 클라이언트가 짧은 주기(HEARTBEAT_INTERVAL_
# SECONDS)로 보내는 "확인" 요청이 도착할 때마다 서버 자신의 시계(datetime.utcnow() - 클라이언트가
# 절대 건드릴 수 없음)로 "지난번 확인 이후 실제로 얼마나 지났는지"를 직접 재서 그대로(상한 없이)
# 누적한다 - 그 값이 얼마나 크든, 그건 "서버가 직접 측정한 실제 벽시계 경과 시간"이므로 클라이언트가
# 조작할 방법이 없다(예전 취약점은 클라이언트가 보고하는 값을 믿었다는 게 문제였지, 확인 간격이
# 길다는 것 자체는 문제가 아니다). 탭을 다른 앱 뒤로 보내두고 몇 시간이 지나도(다른 곳에서 읽고
# 있는 동안 이 탭은 그냥 시간만 재는 용도로 백그라운드에 있는 경우 등, 확인된 의도된 사용법) 일시
# 정지만 누르지 않았다면 그 시간 전부가 정상적으로 인정된다 - 확인 간격에 상한을 두면 이 정상적인
# 사용까지 함께 깎여나가므로(실제로 문제가 됐던 부분) 상한을 두지 않는다.
HEARTBEAT_INTERVAL_SECONDS = 60  # 클라이언트가 하트비트를 보내는 주기(참고용 - 서버는 실제 간격을 그때그때 잰다).
# 이 주기 자체는 순전히 "화면 표시를 서버 값에 자주 맞춰 보여주기 위한" 용도일 뿐, 보안이나 상한과는
# 무관하다 - 하트비트가 어쩌다 한 번도 안 와도(탭 방치, 네트워크 단절 등) 다음 확인 때 그 사이 실제로
# 흐른 시간 전부가(상한 없이) 그대로 인정된다. (Supabase egress 절감을 위해 15초 -> 60초로 완화 -
# 상한이 없으니 자주 확인해야 할 보안상 이유가 사라졌고, 화면은 로컬 타이머로 매초 갱신되므로 체감
# 차이도 없다.)
# 모의고사의 "하프" 변형은 배수 판정에서 원래 과목과 같은 것으로 취급한다(수학과 영어만 하프가 있음).
# 한국사/한문·제2외국어는 독립 과목이 아니라 "기타" 공부시간으로 합산된다(탐구 앞뒤에 끼워 넣은
# 모의고사 전용 과목 - 과목(subject) 탭에는 없음). 탐구(2회분)는 실제 탐구와 같은 과목이라 그대로 매핑.
MOCK_EXAM_BASE_SUBJECT = {
    "수학(하프)": "수학", "영어(하프)": "영어", "한국사": "기타", "한문/제2외국어": "기타",
    "탐구(2회분)": "탐구",
}
KST = timezone(timedelta(hours=9))

# 표시상으로는 응시 1건("탐구(2회분)", 62분)이지만, 실제 기록은 "탐구" 모의고사를 N회 본 것으로
# 남겨야 한다(업적/도전과제/퀘스트가 전부 ReadingLog 행 개수 + 회차별 reading_minutes 임계치로 응시
# 횟수를 세는 구조라 - quests.py의 session_count, achievements.py의 session_type_count,
# challenges.py의 daily_full_mock_exam_set 참고). 그래서 저장 시점에만 "탐구" 행 N개로 쪼갠다 -
# 그 뒤로는 어떤 카운팅 로직도 "탐구(2회분)"이라는 문자열을 몰라도 된다.
MOCK_EXAM_SPLIT = {"탐구(2회분)": ("탐구", 2)}


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


def _equipped_character_silver_multiplier(equipped, matched_subject: str | None) -> float:
    """_equipped_character_exp_multiplier와 완전히 같은 판정이지만 exp_multiplier/exp_subjects 대신
    silver_multiplier/silver_subjects를 본다(김크장처럼 EXP가 아니라 실버에 배수가 붙는 캐릭터용).
    한 캐릭터가 exp/실버 배수를 둘 다 갖는 경우는 아직 없어서 완전히 독립적으로 계산한다."""
    if not matched_subject or not equipped:
        return 1.0
    catalog = get_character_catalog(equipped.name)
    if not catalog or matched_subject not in (catalog.get("silver_subjects") or []):
        return 1.0
    multiplier = (catalog.get("silver_multiplier") or {}).get(str(equipped.star))
    return multiplier if multiplier is not None else 1.0


def _equipped_character_gold_multiplier(equipped) -> float:
    """exp/실버 배수(_equipped_character_exp_multiplier/_equipped_character_silver_multiplier)와 달리
    신(gold_multiplier)은 과목 일치 여부와 무관하게 항상 적용된다 - 어떤 세션이든(과목이 뭐든) 그
    성급의 배수가 그대로 곱해진다. gold_rate가 0이 아닌 지역(종말의 금광/투기장)에서만 실질적인
    체감이 있다."""
    if not equipped:
        return 1.0
    catalog = get_character_catalog(equipped.name)
    if not catalog:
        return 1.0
    multiplier = (catalog.get("gold_multiplier") or {}).get(str(equipped.star))
    return multiplier if multiplier is not None else 1.0

def _today_kst():
    # 서버가 어느 시간대에서 돌든(Render는 보통 UTC) 상관없이, 한국 기준 자정에 맞춰 초기화되도록
    # 항상 KST로 변환한 날짜를 씀.
    return datetime.now(KST).date()


def _session_cutoff_utc(started_at: datetime) -> datetime:
    """이 세션이 자동 종료되는 한국시간 밤 11시 59분 컷오프를 UTC naive datetime으로 계산한다 -
    reading.js의 computeCutoffWallMs와 동일한 규칙이지만, 여기서는 클라이언트가 절대 조작할 수 없는
    서버 자신의 started_at(/session/start 호출 시 서버 시계로 찍은 값)을 기준으로 삼는다.
    (확인된 버그 - 이 컷오프가 예전엔 클라이언트에만 있고 서버는 전혀 몰라서, 자정 전에 끝난
    세션이라도 탭을 닫아뒀다가 다음날에야 다시 열어 제출하면 그 순간(다음날)의 시각이 그대로
    accumulated_seconds에 얹히고 ReadingLog.created_at도 "다음날"로 찍혀, "오늘의 독서시간"에
    전날 공부한 시간이 엉뚱하게 다음날 몫으로 잡히는 문제가 있었다)."""
    started_kst = started_at + timedelta(hours=9)
    cutoff_kst = datetime(started_kst.year, started_kst.month, started_kst.day, 23, 59, 0)
    if cutoff_kst <= started_kst:
        cutoff_kst += timedelta(days=1)
    return cutoff_kst - timedelta(hours=9)


def _resolve_difficulty_multiplier(session_type: str, difficulty: str) -> float:
    """session_type/difficulty 조합이 유효한지 확인하고 그 배율(문학/비문학 등)을 돌려준다 - 유효하지
    않으면 400을 던진다. /session/start(세션을 열 때)와 _apply_reading_reward(최종 정산 때) 양쪽에서
    똑같이 쓴다 - 제출 시점엔 세션 시작 때 이미 검증된 값이라 사실상 항상 통과하지만, 방어적으로 한 번
    더 확인한다."""
    if session_type == "reading":
        if difficulty not in DIFFICULTY_MULTIPLIER:
            raise HTTPException(status_code=400, detail=f"존재하지 않는 장르입니다: {difficulty}")
        return DIFFICULTY_MULTIPLIER[difficulty]
    if session_type == "subject":
        if difficulty not in SUBJECT_SET:
            raise HTTPException(status_code=400, detail=f"존재하지 않는 과목입니다: {difficulty}")
        return 1.0
    if session_type == "mock_exam":
        if difficulty not in MOCK_EXAM_MINUTES:
            raise HTTPException(status_code=400, detail=f"존재하지 않는 모의고사 과목입니다: {difficulty}")
        return 1.0
    raise HTTPException(status_code=400, detail=f"존재하지 않는 학습 유형입니다: {session_type}")


def _validate_region_access(db: Session, user: User, dungeon_name: str) -> Region:
    region = db.query(Region).filter(Region.name == dungeon_name).first()
    if not region:
        raise HTTPException(status_code=400, detail=f"존재하지 않는 던전(지역)입니다: {dungeon_name}")
    if not region.always_open and user.level < region.required_level:
        raise HTTPException(
            status_code=403,
            detail=f"'{region.name}'은(는) 레벨 {region.required_level} 이상부터 입장할 수 있습니다."
        )
    if region.name == GOLD_MINE_REGION_NAME:
        unlocked = db.query(UserRegionUnlock).filter(
            UserRegionUnlock.user_id == user.id, UserRegionUnlock.region_id == region.id,
        ).first()
        if not unlocked:
            raise HTTPException(status_code=403, detail=f"'{region.name}'은(는) 먼저 구매해야 입장할 수 있습니다.")
    return region


def _get_active_session_state(db: Session, user_id: int):
    return db.query(ReadingSessionState).filter(ReadingSessionState.user_id == user_id).first()


def _flush_session_seconds(state: ReadingSessionState, now: datetime | None = None):
    """지난번 확인(last_heartbeat_at) 이후 실제로 흐른 시간 전부를(상한 없이) 누적한다 - 하트비트/
    일시정지/최종 제출 어디서 불러도 항상 같은 규칙. 서버 자신의 시계(now)만 쓰므로 클라이언트가
    무엇을 보내든(또는 기기 시간을 조작하든) 전혀 영향을 못 준다 - 확인 간격이 아무리 길어도(탭을
    다른 앱 뒤로 보내둔 채 몇 시간이 지난 경우 등, 의도된 사용법) 그 전체가 "서버가 직접 잰 실제
    벽시계 경과 시간"이므로 그대로 인정해도 안전하다. 일시정지 중이면 누적하지 않고 확인 시각만
    갱신한다."""
    now = now or datetime.utcnow()
    # 밤 11시 59분(KST) 컷오프를 넘긴 시각은 이 세션 몫으로 인정하지 않는다 - 탭이 닫혀있던 동안
    # 쌓인 "공백"은 원래 상한 없이 전부 인정하는 게 의도된 설계이지만(위 HEARTBEAT_INTERVAL_SECONDS
    # 설명 참고), 그 공백이 자정을 넘겨버리면 다음날 다시 열었을 때의 시각이 그대로 얹혀서 "오늘의
    # 독서시간"이 엉뚱한 날짜에 잡히는 문제로 이어진다. effective_now로 클램프해서 이후로는 더 이상
    # 누적되지 않게 하고, last_heartbeat_at도 같이 고정해 반복 호출에도 델타가 0으로 안정된다.
    effective_now = min(now, _session_cutoff_utc(state.started_at))
    if not state.is_paused:
        delta = (effective_now - state.last_heartbeat_at).total_seconds()
        state.accumulated_seconds += max(0.0, delta)
    state.last_heartbeat_at = effective_now


def _apply_reading_reward(
    db: Session, user: User, region: Region, session_type: str, difficulty: str,
    reading_minutes: int, is_auto_complete: bool, client_token: str, created_at: datetime,
) -> dict:
    """실제 보상 계산 + 저장 - 기존 add_reading_log의 핵심 로직을 그대로 옮긴 것. reading_minutes는
    이제 호출부(제출 엔드포인트, 또는 세션 갈아타기로 인한 자동 정산)가 서버 하트비트 누적치로부터
    이미 계산해 넘겨주는 값이라, 여기서는 예전처럼 클라이언트 원본값을 다루지 않는다.

    created_at: ReadingLog에 찍을 시각 - "지금(제출이 실제로 처리되는 시각)"이 아니라 호출부가
    _flush_session_seconds로 이미 컷오프에 맞춰 클램프해둔 state.last_heartbeat_at을 그대로
    넘겨받는다. 탭을 닫아뒀다가 다음날에야 다시 열어 만료된 세션을 제출하는 경우, "지금"을 그대로
    쓰면 전날 공부한 시간이 ReadingLog.created_at 기준으로 다음날 몫이 돼버려 "오늘의 독서시간"이
    엉뚱하게 잡히는 버그가 있었다(확인된 신고)."""
    difficulty_multiplier = _resolve_difficulty_multiplier(session_type, difficulty)
    if session_type == "mock_exam":
        # 모의고사는 정해진 시간만큼만 흐르는 세션이라, 서버가 확인한 값이라도 표에 정의된 시간을
        # 넘지 않게 자른다(제출을 미루고 계속 하트비트를 보낸 경우 등에 대한 방어적 상한).
        reading_minutes = min(reading_minutes, MOCK_EXAM_MINUTES[difficulty])
    reading_minutes = max(0, reading_minutes)

    # 하루 누적 상한(18시간) 적용 - 오늘(KST) 자정이 지났으면 먼저 리셋하고, 남은 여유만큼만 인정한다.
    today = _today_kst()
    if user.daily_reading_date != today:
        user.daily_reading_minutes = 0
        user.daily_reading_date = today
    remaining_daily_cap = max(0, DAILY_READING_MINUTES_CAP - user.daily_reading_minutes)
    reading_minutes = min(reading_minutes, remaining_daily_cap)

    equipped = _get_equipped_character(user)
    matched_subject = _resolve_matched_subject(session_type, difficulty)
    character_exp_multiplier = _equipped_character_exp_multiplier(equipped, matched_subject)
    character_silver_multiplier = _equipped_character_silver_multiplier(equipped, matched_subject)
    character_gold_multiplier = _equipped_character_gold_multiplier(equipped)

    # 지역별 과목 보너스(예: 지혜의 신전의 국어/영어) - exp에만 적용되고 실버에는 적용되지 않는다.
    region_subject_multiplier = 1.0
    for subject_key, multiplier in (region.subject_bonus_rules or {}).items():
        if difficulty and difficulty.startswith(subject_key):
            region_subject_multiplier = multiplier
            break

    gained_exp = int(
        reading_minutes * region.exp_rate * difficulty_multiplier
        * character_exp_multiplier * region_subject_multiplier
    )
    gained_gold = int(reading_minutes * region.gold_rate * character_gold_multiplier)
    gained_silver = int(reading_minutes * region.silver_rate * character_silver_multiplier)

    user.gold += gained_gold
    user.lifetime_gold += gained_gold
    user.silver += gained_silver
    user.daily_reading_minutes += reading_minutes
    user.lifetime_reading_minutes += reading_minutes
    user.current_region_id = region.id

    split = MOCK_EXAM_SPLIT.get(difficulty) if session_type == "mock_exam" else None
    if split:
        split_difficulty, split_count = split
        base_minutes, extra_minutes = divmod(reading_minutes, split_count)
        base_exp, extra_exp = divmod(gained_exp, split_count)
        base_gold, extra_gold = divmod(gained_gold, split_count)
        base_silver, extra_silver = divmod(gained_silver, split_count)
        for i in range(split_count):
            is_last = i == split_count - 1  # 나눠떨어지지 않는 나머지는 마지막 회차에 몰아준다(합계는 항상 보존됨)
            db.add(ReadingLog(
                user_id=user.id, region_id=region.id, dungeon_name=region.name,
                difficulty=split_difficulty, session_type=session_type,
                reading_minutes=base_minutes + (extra_minutes if is_last else 0),
                equipped_character_name=equipped.name if equipped else None,
                earned_exp=base_exp + (extra_exp if is_last else 0),
                earned_gold=base_gold + (extra_gold if is_last else 0),
                earned_silver=base_silver + (extra_silver if is_last else 0),
                is_auto_complete=is_auto_complete,
                client_token=client_token,
                created_at=created_at,
            ))
    else:
        db.add(ReadingLog(
            user_id=user.id,
            region_id=region.id,
            dungeon_name=region.name,
            difficulty=difficulty,
            session_type=session_type,
            reading_minutes=reading_minutes,
            equipped_character_name=equipped.name if equipped else None,
            created_at=created_at,
            earned_exp=gained_exp,
            earned_gold=gained_gold,
            earned_silver=gained_silver,
            is_auto_complete=is_auto_complete and session_type == "mock_exam",
            client_token=client_token,
        ))

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
        "gained_silver": gained_silver,
        "reading_minutes": reading_minutes,  # 서버가 실제로 인정한 시간 - 프론트가 결과 화면의 "시간" 표시에 이 값을 써야 한다.
        "start_level": start_level,
        "start_exp": start_exp,
        "current_level": user.level,
        "current_exp": user.total_exp,
        "lifetime_exp": user.lifetime_exp,
        "daily_reading_minutes": user.daily_reading_minutes,
        "level_up": level_result["level_up"],
        "levels_gained": level_result["levels_gained"],
        "new_achievements": new_achievements,
        "new_characters": new_characters,
    }


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


@router.post("/session/start")
def start_reading_session(
    req: ReadingSessionStartRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """새 독서/과목/모의고사 세션을 서버에 등록한다(근본 수정 - 시간은 이제부터 서버가 직접 잰다).
    같은 client_token으로 다시 부르면(새로고침 등으로 인한 복구) 기존 누적치를 그대로 두고 확인
    시각만 지금으로 당긴다. 다른 세션이 이미 진행 중이었다면(예: 끝맺지 않고 다른 던전/과목으로
    이동) 유실 없이 먼저 정산해서 보상을 지급한 뒤 새 세션을 연다."""
    region = _validate_region_access(db, user, req.dungeon_name)
    _resolve_difficulty_multiplier(req.session_type, req.difficulty)  # 유효성만 확인(값은 여기서 안 씀)

    now = datetime.utcnow()
    existing = _get_active_session_state(db, user.id)
    banked_previous = None
    if existing:
        if existing.client_token == req.client_token:
            # 새로고침/재접속으로 인한 복구 - _flush_session_seconds와 동일한 규칙으로 그 사이 공백을
            # (밤 11시 59분 컷오프까지는 상한 없이) 얹어준 뒤 이어서 잰다.
            _flush_session_seconds(existing, now)
            db.commit()
            return {
                "accumulated_minutes": int(existing.accumulated_seconds // 60),
                "accumulated_seconds": existing.accumulated_seconds,
                "banked_previous": None,
            }

        _flush_session_seconds(existing, now)
        old_region = db.query(Region).filter(Region.id == existing.region_id).first()
        old_minutes = int(existing.accumulated_seconds // 60)
        old_session_type, old_difficulty, old_token = existing.session_type, existing.difficulty, existing.client_token
        old_created_at = existing.last_heartbeat_at  # 컷오프에 맞춰 이미 클램프된 시각(위 _flush_session_seconds 참고)
        db.delete(existing)
        db.commit()
        if old_region and old_minutes >= 1:
            result = _apply_reading_reward(
                db, user, old_region, old_session_type, old_difficulty, old_minutes, True, old_token, old_created_at,
            )
            banked_previous = {
                "dungeon_name": old_region.name, "difficulty": old_difficulty,
                "reading_minutes": result["reading_minutes"], "gained_exp": result["gained_exp"],
                "gained_gold": result["gained_gold"], "gained_silver": result["gained_silver"],
            }

    db.add(ReadingSessionState(
        user_id=user.id, region_id=region.id, dungeon_name=region.name,
        session_type=req.session_type, difficulty=req.difficulty,
        started_at=now, last_heartbeat_at=now, accumulated_seconds=0.0, is_paused=False,
        client_token=req.client_token,
    ))
    db.commit()
    return {"accumulated_minutes": 0, "accumulated_seconds": 0.0, "banked_previous": banked_previous}


@router.post("/session/heartbeat")
def reading_session_heartbeat(
    req: ReadingSessionTokenRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """클라이언트가 짧은 주기(HEARTBEAT_INTERVAL_SECONDS)로 "아직 읽고 있다"고 알려올 때마다 호출.
    서버 자신의 시계로 지난 확인 이후 실제로 흐른 시간 전부를(상한 없이) 누적한다."""
    state = _get_active_session_state(db, user.id)
    if not state or state.client_token != req.client_token:
        raise HTTPException(status_code=404, detail="진행 중인 세션을 찾을 수 없습니다. 페이지를 새로고침해주세요.")
    _flush_session_seconds(state)
    db.commit()
    return {
        "accumulated_minutes": int(state.accumulated_seconds // 60),
        "accumulated_seconds": state.accumulated_seconds,
        "is_paused": state.is_paused,
    }


@router.post("/session/pause")
def pause_reading_session(
    req: ReadingSessionTokenRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    state = _get_active_session_state(db, user.id)
    if not state or state.client_token != req.client_token:
        raise HTTPException(status_code=404, detail="진행 중인 세션을 찾을 수 없습니다.")
    _flush_session_seconds(state)  # 일시정지를 누르는 그 순간까지는 정상적으로 인정한다.
    state.is_paused = True
    db.commit()
    return {"accumulated_minutes": int(state.accumulated_seconds // 60), "accumulated_seconds": state.accumulated_seconds}


@router.post("/session/resume")
def resume_reading_session(
    req: ReadingSessionTokenRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    state = _get_active_session_state(db, user.id)
    if not state or state.client_token != req.client_token:
        raise HTTPException(status_code=404, detail="진행 중인 세션을 찾을 수 없습니다.")
    state.is_paused = False
    state.last_heartbeat_at = datetime.utcnow()  # 일시정지 동안의 공백은 인정하지 않는다(재개 시점부터 새로 시작).
    db.commit()
    return {"accumulated_minutes": int(state.accumulated_seconds // 60), "accumulated_seconds": state.accumulated_seconds}


@router.post("/")
def add_reading_log(
    log_data: LogCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """세션을 마무리하고 보상을 지급한다. dungeon_name/difficulty/session_type/reading_minutes는
    더 이상 클라이언트에게서 받지 않는다(근본 수정) - client_token으로 서버에 등록된
    ReadingSessionState를 찾아, 그 세션 동안 하트비트로 확인된 시간만큼만 정산한다."""
    # client_token으로 이미 저장된 기록이 있으면(응답을 못 받은 재시도 등) 새로 처리하지 않고 그대로
    # 돌려준다 - 세션 상태(ReadingSessionState)는 첫 시도가 성공하며 이미 지워졌을 수 있어도, 저장된
    # 결과만으로 충분히 같은 응답을 재현할 수 있다.
    existing_rows = db.query(ReadingLog).filter(
        ReadingLog.user_id == user.id,
        ReadingLog.client_token == log_data.client_token,
    ).all()
    if existing_rows:
        return {
            "message": "같은 학습 기록이 이미 저장됐어요. 이전 결과를 그대로 보여드려요.",
            "gained_exp": sum(row.earned_exp or 0 for row in existing_rows),
            "gained_gold": sum(row.earned_gold or 0 for row in existing_rows),
            "gained_silver": sum(row.earned_silver or 0 for row in existing_rows),
            "reading_minutes": sum(row.reading_minutes or 0 for row in existing_rows),
            # 재시도 응답에는 원래 정밀한 초 단위 값이 남아있지 않다(ReadingLog는 분 단위로만 저장) -
            # 어쩔 수 없이 저장된 분 값을 초로 환산해 대체한다(정밀 표시가 안 되는 드문 경로일 뿐,
            # 최초 성공 응답에서는 항상 정밀한 값이 내려간다).
            "reading_seconds": sum(row.reading_minutes or 0 for row in existing_rows) * 60,
            "start_level": user.level,
            "start_exp": user.total_exp,
            "current_level": user.level,
            "current_exp": user.total_exp,
            "lifetime_exp": user.lifetime_exp,
            "daily_reading_minutes": user.daily_reading_minutes,
            "level_up": False,
            "levels_gained": 0,
            "new_achievements": [],
            "new_characters": [],
        }

    state = _get_active_session_state(db, user.id)
    if not state or state.client_token != log_data.client_token:
        raise HTTPException(
            status_code=400,
            detail="진행 중인 세션을 찾을 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.",
        )

    region = db.query(Region).filter(Region.id == state.region_id).first()
    if not region:
        db.delete(state)
        db.commit()
        raise HTTPException(status_code=400, detail="세션이 시작된 지역을 더 이상 찾을 수 없습니다.")

    _flush_session_seconds(state)
    raw_accumulated_seconds = state.accumulated_seconds
    reading_minutes = int(raw_accumulated_seconds // 60)
    session_type, difficulty, client_token = state.session_type, state.difficulty, state.client_token
    session_created_at = state.last_heartbeat_at  # 컷오프에 맞춰 이미 클램프된 시각(위 _flush_session_seconds 참고)
    db.delete(state)
    db.commit()

    result = _apply_reading_reward(
        db, user, region, session_type, difficulty, reading_minutes, log_data.is_auto_complete, client_token,
        session_created_at,
    )
    # 완료 화면의 "시간" 표시는 초 단위까지 자연스럽게 보여야 하는데(확인된 요청 - 예전엔 초까지
    # 나왔음), reading_minutes는 보상 계산 기준(정수 분 - 초 단위 잔여분은 보상에 반영되지 않고 그냥
    # 버려짐)이라 그대로 쓰면 항상 ":00"으로 끝나는 부자연스러운 값이 된다. 정밀한 초 단위 값을 함께
    # 내려주되, 일일 상한 등으로 실제 인정된 분이 더 적게 잘렸을 수 있으므로(_apply_reading_reward
    # 내부) 표시 시간이 실제로 보상받은 분보다 1분 이상 많아 보이지 않도록 함께 잘라준다.
    result["reading_seconds"] = min(raw_accumulated_seconds, result["reading_minutes"] * 60 + 59)
    return result