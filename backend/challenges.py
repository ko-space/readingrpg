"""
"도전과제" 조건 판정 + 보상 지급 엔진. achievements.py와 철학은 같다(condition_type/condition_params로
조건을 표현하고, 정말 새로운 종류의 조건이 생길 때만 compute_progress()의 if/elif 사슬에 분기 하나를
추가한다) - 하지만 UserAchievement/칭호(equipped_achievement_id) 쪽 로직은 전혀 참조하지 않는 완전히
별개의 시스템이다. 업적은 조건 충족 시 자동 지급되지만, 도전과제는 퀘스트처럼 조건 충족 후 사용자가
직접 "받기"를 눌러야 지급된다(그래서 이 모듈은 achievements.py의 check_and_grant_achievements 같은
자동지급 함수를 두지 않고, 지급은 routers/challenges.py의 claim 엔드포인트가 담당한다).
"""
from datetime import datetime, timezone, timedelta
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import (
    Character, ReadingLog, PvpBattleLog, ActivityLog, UserCgUnlock, Challenge,
    MarketActivityLog, GachaPullLog, RankingTop1Log, RankingPeriodCursor, User, UserAchievement,
)
from achievements import get_all_character_catalogs
from quests import MOCK_EXAM_MINUTES, _bounds_utc_naive

KST = timezone(timedelta(hours=9))
ADMIN_USER_ID = 1  # ranking.py/pvp.py와 동일한 관리자 계정 - 랭킹 1위 판정에서 제외
RARITY_START_STAR = {"신화": 5, "전설": 4, "영웅": 3, "희귀": 2, "일반": 1}  # characters.py와 동일(이 프로젝트 컨벤션)


def _job_class_matches(actual_job_class: str | None, target_job_class: str) -> bool:
    """"학생" 조건은 "1반 학생"도 포함한다(더 세분화된 직업 라벨이지만 상위 분류로는 학생이므로)."""
    if actual_job_class == target_job_class:
        return True
    if target_job_class == "학생" and actual_job_class == "1반 학생":
        return True
    return False


def compute_progress(db: Session, user, challenge: Challenge) -> dict:
    """조건 타입별로 (현재값, 목표값)을 계산한다. current >= target이면 "받기" 버튼이 활성화된다."""
    ctype = challenge.condition_type
    params = challenge.condition_params or {}
    target = challenge.condition_value or 1
    current = 0

    if ctype == "level":
        current = user.level

    elif ctype == "cg_unlocked":
        target = 1
        exists = db.query(UserCgUnlock).filter(
            UserCgUnlock.user_id == user.id,
            UserCgUnlock.story_id == params.get("story_id"),
            UserCgUnlock.cg_id == params.get("cg_id"),
        ).first()
        current = 1 if exists else 0

    elif ctype == "activity_total":
        current = db.query(ActivityLog).filter(
            ActivityLog.user_id == user.id,
            ActivityLog.activity_type == params.get("activity_type"),
        ).count()

    elif ctype == "pvp_battle_total":
        current = db.query(PvpBattleLog).filter(PvpBattleLog.attacker_id == user.id).count()

    elif ctype == "pvp_wins":
        current = db.query(PvpBattleLog).filter(
            PvpBattleLog.attacker_id == user.id,
            PvpBattleLog.winner_id == user.id,
        ).count()

    elif ctype == "pvp_rank_reached":
        target = 1
        wanted_rank = params.get("rank", 1)
        current = 1 if user.pvp_rank == wanted_rank else 0

    elif ctype == "pvp_battle_with_star":
        # 공격자로 참여했던 전적(attacker_front_name/back_name 스냅샷)의 이름들 중, 지금 그 이름의
        # 캐릭터를 지정 성급 이상으로 보유하고 있으면 인정. 방어 참여는 스냅샷이 없어 판정 불가라 제외.
        target = 1
        min_star = params.get("min_star", 5)
        used_names = set()
        rows = db.query(PvpBattleLog.attacker_front_name, PvpBattleLog.attacker_back_name).filter(
            PvpBattleLog.attacker_id == user.id
        ).all()
        for front_name, back_name in rows:
            used_names.add(front_name)
            used_names.add(back_name)
        current = 0
        for name in used_names:
            best = (
                db.query(Character.star)
                .filter(Character.user_id == user.id, Character.name == name)
                .order_by(Character.star.desc())
                .first()
            )
            if best and best[0] >= min_star:
                current = 1
                break

    elif ctype == "region_session_count":
        min_minutes = params.get("min_minutes", 30)
        current = db.query(ReadingLog).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.reading_minutes >= min_minutes,
        ).count()

    elif ctype == "character_reading_exp":
        current = db.query(func.sum(ReadingLog.earned_exp)).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type == "reading",
            ReadingLog.equipped_character_name == params.get("character_name"),
        ).scalar() or 0

    elif ctype == "job_class_subject_exp":
        # 어떤 캐릭터가 이 직업에 해당하는지는 DB가 아니라 정적 카탈로그(characters.json)만 보면
        # 알 수 있으므로, 유저의 학습 로그를 통째로 가져와 한 줄씩 대조하는 대신 미리 이름 목록을
        # 추려서 SQL IN 필터 + SUM으로 한 번에 집계한다.
        target_job_class = params.get("job_class")
        matching_names = [
            name for name, cat in get_all_character_catalogs().items()
            if _job_class_matches(cat.get("job_class"), target_job_class)
        ]
        current = (db.query(func.sum(ReadingLog.earned_exp)).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type.in_(["subject", "mock_exam"]),
            ReadingLog.equipped_character_name.in_(matching_names),
        ).scalar() or 0) if matching_names else 0

    elif ctype == "gender_subject_exp":
        target_gender = params.get("gender")
        matching_names = [
            name for name, cat in get_all_character_catalogs().items()
            if cat.get("gender") == target_gender
        ]
        current = (db.query(func.sum(ReadingLog.earned_exp)).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type.in_(["subject", "mock_exam"]),
            ReadingLog.equipped_character_name.in_(matching_names),
        ).scalar() or 0) if matching_names else 0

    elif ctype == "daily_full_mock_exam_set":
        # 하루(KST)에 국어+영어+수학+탐구(2회)가 전부 "봤다"로 인정되는 날이 하나라도 있는지. 행 전체가
        # 아니라 날짜별 그룹핑에 필요한 3개 컬럼만 가져온다(egress 절감 - 나머지 컬럼은 안 씀).
        target = 1
        rows = db.query(
            ReadingLog.created_at, ReadingLog.difficulty, ReadingLog.reading_minutes
        ).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type == "mock_exam",
        ).all()
        by_day: dict[str, list[str]] = {}
        for created_at, difficulty, reading_minutes in rows:
            if (reading_minutes or 0) < MOCK_EXAM_MINUTES.get(difficulty, float("inf")):
                continue
            day_key = created_at.replace(tzinfo=timezone.utc).astimezone(KST).date().isoformat()
            by_day.setdefault(day_key, []).append(difficulty)

        current = 0
        for difficulties in by_day.values():
            has_korean = any(d.startswith("국어") for d in difficulties)
            has_english = any(d.startswith("영어") for d in difficulties)
            has_math = any(d.startswith("수학") for d in difficulties)
            tamgu_count = sum(1 for d in difficulties if d == "탐구")
            if has_korean and has_english and has_math and tamgu_count >= 2:
                current = 1
                break

    elif ctype == "market_activity_count":
        # 거래소 등록/구매 이력(MarketActivityLog) 기준 - params.action이 "register"|"buy",
        # params.min_star가 있으면 그 성급 이상만 인정("N성 이상 인물 구매" 등). quests.py의
        # 동명 condition_type과 같은 개념이지만 이쪽은 기간 제한이 없다(도전과제는 누적).
        q = db.query(MarketActivityLog).filter(
            MarketActivityLog.user_id == user.id,
            MarketActivityLog.action == params.get("action"),
        )
        if params.get("min_star"):
            q = q.filter(MarketActivityLog.star >= params["min_star"])
        current = q.count()

    elif ctype == "ranking_top1_count":
        # "오늘의/주간 독서시간 랭킹 1위 달성 N회" - _close_ranking_periods_if_needed가 기간이 끝날
        # 때마다 미리 기록해둔 RankingTop1Log를 그냥 센다(동점자는 전원 각자 한 행씩 가짐).
        current = db.query(RankingTop1Log).filter(
            RankingTop1Log.user_id == user.id,
            RankingTop1Log.category == params.get("category"),
        ).count()

    elif ctype == "ranking_top1_live":
        # "보유 골드"/"칭호 수"/"PvP 승수" 랭킹 1위(1회) - 기간 개념이 없어 그냥 "지금 내 값이 전체
        # 최댓값 이상인가"를 실시간으로 비교한다(ranking.py의 정렬 기준과 동일한 값을 쓴다). 동점자는
        # 전원 인정(사용자 확정 사항)이므로 "최댓값과 같거나 큼"으로 판정.
        target = 1
        metric = params.get("metric")
        my_value = 0
        max_value = 0
        if metric == "gold":
            my_value = user.gold
            max_value = db.query(func.max(User.gold)).filter(User.id != ADMIN_USER_ID).scalar() or 0
        elif metric == "titles":
            my_value = db.query(UserAchievement).filter(UserAchievement.user_id == user.id).count()
            counts = (
                db.query(UserAchievement.user_id, func.count(UserAchievement.id))
                .join(User, User.id == UserAchievement.user_id)
                .filter(User.id != ADMIN_USER_ID)
                .group_by(UserAchievement.user_id)
                .all()
            )
            max_value = max((c for _, c in counts), default=0)
        elif metric == "pvp_wins":
            my_value = db.query(PvpBattleLog).filter(
                PvpBattleLog.attacker_id == user.id, PvpBattleLog.winner_id == user.id
            ).count()
            counts = (
                db.query(PvpBattleLog.winner_id, func.count(PvpBattleLog.id))
                .filter(
                    PvpBattleLog.attacker_id == PvpBattleLog.winner_id,
                    PvpBattleLog.winner_id != ADMIN_USER_ID,
                )
                .group_by(PvpBattleLog.winner_id)
                .all()
            )
            max_value = max((c for _, c in counts), default=0)
        current = 1 if my_value > 0 and my_value >= max_value else 0

    elif ctype == "gacha_pull_all_rarities":
        # "1,2,3,4,5성 인물 전부 모집" - 모집 시 시작 성급을 정하는 5개 등급(일반~신화)을 전부
        # 한 번 이상 뽑아봤는지. target은 5로 고정.
        target = 5
        rarities = {
            row[0] for row in db.query(GachaPullLog.rarity).filter(GachaPullLog.user_id == user.id).distinct().all()
        }
        current = len(rarities & set(RARITY_START_STAR.keys()))

    elif ctype == "gacha_pull_pickup_count":
        min_star = params.get("min_star", 3)
        qualifying = {r for r, s in RARITY_START_STAR.items() if s >= min_star}
        current = db.query(GachaPullLog).filter(
            GachaPullLog.user_id == user.id,
            GachaPullLog.was_pickup == True,
            GachaPullLog.rarity.in_(qualifying),
        ).count()

    elif ctype == "gacha_pull_rarity_count":
        current = db.query(GachaPullLog).filter(
            GachaPullLog.user_id == user.id,
            GachaPullLog.rarity == params.get("rarity"),
        ).count()

    elif ctype == "gacha_pull_star_streak":
        # "3성 이상 인물 2번 연속으로 모집" - 가장 최근 N번의 모집이 전부 지정 성급 이상이었는지.
        target = 1
        min_star = params.get("min_star", 3)
        streak = params.get("streak", 2)
        qualifying = {r for r, s in RARITY_START_STAR.items() if s >= min_star}
        recent = (
            db.query(GachaPullLog)
            .filter(GachaPullLog.user_id == user.id)
            .order_by(GachaPullLog.id.desc())
            .limit(streak)
            .all()
        )
        current = 1 if len(recent) == streak and all(r.rarity in qualifying for r in recent) else 0

    elif ctype == "daily_all_subjects_study_days":
        # "하루에 국어·영어·수학·탐구를 각각 N분 이상 공부하기" - 그런 날이 며칠이나 있었는지. 날짜별
        # 그룹핑에 필요한 3개 컬럼만 가져온다(egress 절감 - 나머지 컬럼은 안 씀).
        required_subjects = ["국어", "영어", "수학", "탐구"]
        min_minutes = params.get("min_minutes", 60)
        rows = db.query(
            ReadingLog.created_at, ReadingLog.difficulty, ReadingLog.reading_minutes
        ).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type.in_(["subject", "mock_exam"]),
        ).all()
        by_day: dict[str, dict[str, int]] = {}
        for created_at, difficulty, reading_minutes in rows:
            if not difficulty:
                continue
            day_key = created_at.replace(tzinfo=timezone.utc).astimezone(KST).date().isoformat()
            bucket = by_day.setdefault(day_key, {})
            for subject in required_subjects:
                if difficulty.startswith(subject):
                    bucket[subject] = bucket.get(subject, 0) + (reading_minutes or 0)
                    break
        current = sum(
            1 for bucket in by_day.values()
            if all(bucket.get(subject, 0) >= min_minutes for subject in required_subjects)
        )

    elif ctype == "character_filter_exp":
        # job_class_subject_exp/gender_subject_exp의 일반화판 - job_classes(목록, OR 조건) 또는
        # rarity로 캐릭터를 거르고, session_type 제한 없이(독서 포함) earned_exp를 합산한다. 마찬가지로
        # 정적 카탈로그에서 먼저 이름을 추려 SQL IN + SUM으로 집계한다.
        job_classes = params.get("job_classes")
        rarity = params.get("rarity")
        matching_names = [
            name for name, cat in get_all_character_catalogs().items()
            if (not job_classes or any(_job_class_matches(cat.get("job_class"), jc) for jc in job_classes))
            and (not rarity or cat.get("rarity") == rarity)
        ]
        current = (db.query(func.sum(ReadingLog.earned_exp)).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.equipped_character_name.in_(matching_names),
        ).scalar() or 0) if matching_names else 0

    return {"current": max(0, min(current, target)), "target": target}


def _close_ranking_period(db: Session, category: str, period_key: str):
    """category의 "마지막으로 마감 처리한 기간"이 이 period_key가 아니면(즉 아직 처리 안 됐으면),
    그 기간(이미 끝난 하루/한 주)의 독서시간 1위(동점자 전원)를 RankingTop1Log에 기록하고 커서를
    갱신한다. period_key 형식은 quests.py와 동일("2026-07-20" / "W2026-07-20")."""
    cursor = db.query(RankingPeriodCursor).filter(RankingPeriodCursor.category == category).first()
    if not cursor:
        cursor = RankingPeriodCursor(category=category, last_processed_period_key=None)
        db.add(cursor)
        db.flush()
    if cursor.last_processed_period_key == period_key:
        return

    period = "daily" if category == "reading_daily" else "weekly"
    start, end = _bounds_utc_naive(period, period_key)
    rows = (
        db.query(ReadingLog.user_id, func.sum(ReadingLog.reading_minutes).label("total"))
        .filter(
            ReadingLog.created_at >= start,
            ReadingLog.created_at < end,
            ReadingLog.user_id != ADMIN_USER_ID,
        )
        .group_by(ReadingLog.user_id)
        .all()
    )
    cursor.last_processed_period_key = period_key
    if rows:
        max_total = max(r.total or 0 for r in rows)
        if max_total > 0:
            winners = [r.user_id for r in rows if (r.total or 0) == max_total]
            already = {
                row.user_id for row in db.query(RankingTop1Log.user_id).filter(
                    RankingTop1Log.category == category, RankingTop1Log.period_key == period_key,
                ).all()
            }
            for uid in winners:
                if uid not in already:
                    db.add(RankingTop1Log(user_id=uid, category=category, period_key=period_key))
    db.commit()


def close_ranking_periods_if_needed(db: Session):
    """"오늘의 독서시간"/"주간 독서시간" 랭킹 1위 도전과제 판정용 - 예약 스케줄러가 없어서, 아무
    요청이나(routers/users.py의 /users/me) 들어올 때마다 "어제"/"지난 주"가 이미 끝났는데 그 기간의
    1위를 아직 안 기록해뒀으면 지금 기록한다. 여러 날 동안 요청이 아예 없었으면 그 사이 날짜는
    건너뛸 수 있다(스케줄러가 없는 이 프로젝트의 구조적 한계 - 매일 요청이 들어오는 실사용 조건에서는
    문제되지 않는다)."""
    yesterday = datetime.now(KST).date() - timedelta(days=1)
    _close_ranking_period(db, "reading_daily", yesterday.isoformat())

    today = datetime.now(KST).date()
    this_monday = today - timedelta(days=today.weekday())
    last_monday = this_monday - timedelta(days=7)
    _close_ranking_period(db, "reading_weekly", f"W{last_monday.isoformat()}")
