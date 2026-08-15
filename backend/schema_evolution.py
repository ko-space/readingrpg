"""이 프로젝트엔 마이그레이션 도구(Alembic 등)가 없다 - 유일한 스키마 적용 수단인
Base.metadata.create_all()(main.py)은 없는 테이블만 만들고, 이미 존재하는 테이블에 새 컬럼을
추가하지는 않는다(models.py의 CharacterEnhanceBuff 주석 참고 - 예전엔 이 문제를 "컬럼 추가 대신
새 테이블 분리"로 피해갔다). 재화 시스템 개편처럼 기존 테이블에 컬럼을 여러 개 추가해야 하는
경우가 생겨서, 아주 가벼운 보정 스텝을 하나 둔다 - 정식 마이그레이션 도구가 아니라 "이 컬럼이
없으면 추가한다"만 하는 일회성 헬퍼다. main.py에서 create_all() 직후·시딩 이전에 호출한다.

NEW_COLUMNS에 (테이블명, 컬럼명, DDL 조각)을 추가해나가는 방식으로 쓴다 - 이미 컬럼이 있으면
조용히 건너뛰므로 여러 번 실행해도 안전하다(멱등).
"""
from sqlalchemy import inspect, text
from database import engine

NEW_COLUMNS = [
    # 재화 이원화(실버/골드) - 재화 시스템 개편 1단계
    ("users", "silver", "INTEGER NOT NULL DEFAULT 0"),
    ("items", "currency", "VARCHAR NOT NULL DEFAULT 'gold'"),
    ("mails", "silver_amount", "INTEGER NOT NULL DEFAULT 0"),
    # 지역 시스템 개편 - 재화 시스템 개편 4단계
    ("regions", "silver_rate", "FLOAT NOT NULL DEFAULT 0"),
    ("regions", "subject_bonus_rules", "JSON"),
    ("reading_logs", "earned_silver", "INTEGER NOT NULL DEFAULT 0"),
    # 전술대회 서포터(3번째) 슬롯 - 등록만 미리 지원, 실제 전투 반영은 battle_core.ENABLE_SUPPORTER_SLOT 참고
    ("users", "pvp_defense_supporter_id", "INTEGER"),
]


def evolve_schema():
    inspector = inspect(engine)
    with engine.connect() as conn:
        for table_name, column_name, ddl in NEW_COLUMNS:
            if not inspector.has_table(table_name):
                # create_all()이 아직 안 만든 새 테이블이면 이 함수가 신경 쓸 필요가 없다
                # (다음 create_all() 호출 때 컬럼까지 포함해서 알아서 만들어진다).
                continue
            existing_columns = {col["name"] for col in inspector.get_columns(table_name)}
            if column_name in existing_columns:
                continue
            try:
                conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"))
                conn.commit()
                print(f"[schema_evolution] {table_name}.{column_name} 컬럼을 추가했습니다.")
            except Exception as e:
                print(f"[schema_evolution] {table_name}.{column_name} 추가 실패: {e}")
