"""
"도전과제" 조건 판정 + 보상 지급 엔진. achievements.py와 철학은 같다(condition_type/condition_params로
조건을 표현하고, 정말 새로운 종류의 조건이 생길 때만 compute_progress()의 if/elif 사슬에 분기 하나를
추가한다) - 하지만 UserAchievement/칭호(equipped_achievement_id) 쪽 로직은 전혀 참조하지 않는 완전히
별개의 시스템이다. 업적은 조건 충족 시 자동 지급되지만, 도전과제는 퀘스트처럼 조건 충족 후 사용자가
직접 "받기"를 눌러야 지급된다(그래서 이 모듈은 achievements.py의 check_and_grant_achievements 같은
자동지급 함수를 두지 않고, 지급은 routers/challenges.py의 claim 엔드포인트가 담당한다).
"""
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session

from models import Character, ReadingLog, PvpBattleLog, ActivityLog, UserCgUnlock, Challenge
from achievements import get_character_catalog
from quests import MOCK_EXAM_MINUTES

KST = timezone(timedelta(hours=9))


def _job_class_matches(actual_job_class: str | None, target_job_class: str) -> bool:
    """"학생" 조건은 "1반 학생"도 포함한다(더 세분화된 직업 라벨이지만 상위 분류로는 학생이므로)."""
    if actual_job_class == target_job_class:
        return True
    if target_job_class == "학생" and actual_job_class == "1반 학생":
        return True
    return False


def _mock_exam_counted(row: ReadingLog) -> bool:
    """모의고사는 그 난이도의 지정 시간 이상 기록됐어야 "봤다"로 인정한다 (quests.py/achievements.py와 동일 기준)."""
    return row.reading_minutes >= MOCK_EXAM_MINUTES.get(row.difficulty, float("inf"))


def compute_progress(db: Session, user, challenge: Challenge) -> dict:
    """조건 타입별로 (현재값, 목표값)을 계산한다. current >= target이면 "받기" 버튼이 활성화된다."""
    ctype = challenge.condition_type
    params = challenge.condition_params or {}
    target = challenge.condition_value or 1
    current = 0

    if ctype == "cg_unlocked":
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
        rows = db.query(ReadingLog).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type == "reading",
            ReadingLog.equipped_character_name == params.get("character_name"),
        ).all()
        current = sum(row.earned_exp or 0 for row in rows)

    elif ctype == "job_class_subject_exp":
        target_job_class = params.get("job_class")
        rows = db.query(ReadingLog).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type.in_(["subject", "mock_exam"]),
            ReadingLog.equipped_character_name.isnot(None),
        ).all()
        current = 0
        for row in rows:
            catalog = get_character_catalog(row.equipped_character_name)
            if catalog and _job_class_matches(catalog.get("job_class"), target_job_class):
                current += row.earned_exp or 0

    elif ctype == "gender_subject_exp":
        target_gender = params.get("gender")
        rows = db.query(ReadingLog).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type.in_(["subject", "mock_exam"]),
            ReadingLog.equipped_character_name.isnot(None),
        ).all()
        current = 0
        for row in rows:
            catalog = get_character_catalog(row.equipped_character_name)
            if catalog and catalog.get("gender") == target_gender:
                current += row.earned_exp or 0

    elif ctype == "daily_full_mock_exam_set":
        # 하루(KST)에 국어+영어+수학+탐구(2회)가 전부 "봤다"로 인정되는 날이 하나라도 있는지.
        target = 1
        rows = db.query(ReadingLog).filter(
            ReadingLog.user_id == user.id,
            ReadingLog.session_type == "mock_exam",
        ).all()
        by_day: dict[str, list[ReadingLog]] = {}
        for row in rows:
            if not _mock_exam_counted(row):
                continue
            day_key = row.created_at.replace(tzinfo=timezone.utc).astimezone(KST).date().isoformat()
            by_day.setdefault(day_key, []).append(row)

        current = 0
        for day_rows in by_day.values():
            difficulties = [row.difficulty for row in day_rows]
            has_korean = any(d.startswith("국어") for d in difficulties)
            has_english = any(d.startswith("영어") for d in difficulties)
            has_math = any(d.startswith("수학") for d in difficulties)
            tamgu_count = sum(1 for d in difficulties if d == "탐구")
            if has_korean and has_english and has_math and tamgu_count >= 2:
                current = 1
                break

    return {"current": max(0, min(current, target)), "target": target}
