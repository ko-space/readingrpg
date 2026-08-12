import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv()
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

# 로컬에서 테스트용으로 서버를 돌렸는데 .env의 DATABASE_URL이 (바꾸는 걸 깜빡해서) 여전히 운영
# DB를 가리키고 있으면, 시딩/테스트 조작이 그대로 실제 서비스에 반영되는 사고가 난다 - 실제로
# 한 번 겪었다(로컬 서버 실행이 공유 운영 DB의 퀘스트 조건을 조용히 덮어씀). PROD_PROJECT_REF는
# 운영 Supabase 연결 문자열의 사용자명 부분(프로젝트 URL에도 그대로 노출되는 식별자일 뿐, 비밀번호가
# 아니라서 여기 하드코딩해도 안전하다)이고, 배포 환경(Cloud Run)은 APP_ENV=production을 환경변수로
# 설정해두므로 이 검사를 그대로 통과한다. 정말로 로컬에서 운영 DB에 일회성으로 붙어야 한다면
# ALLOW_PROD_DB=1로 명시적으로 우회할 수 있다.
PROD_PROJECT_REF = "postgres.oshrywptesraepsdbjth"
APP_ENV = os.getenv("APP_ENV", "local")

if (
    SQLALCHEMY_DATABASE_URL
    and PROD_PROJECT_REF in SQLALCHEMY_DATABASE_URL
    and APP_ENV != "production"
    and os.getenv("ALLOW_PROD_DB") != "1"
):
    raise SystemExit(
        "\n\n"
        "🚫 지금 DATABASE_URL이 운영(프로덕션) DB를 가리키고 있는데 APP_ENV가 'production'이 아닙니다.\n"
        "로컬 테스트 목적이었다면 backend/.env의 DATABASE_URL을 별도의 로컬/테스트용 DB로 바꿔주세요.\n"
        "정말로 지금 운영 DB에 연결해야 한다면(예: 일회성 점검) ALLOW_PROD_DB=1을 설정하고 다시 실행하세요.\n"
    )

# pool_pre_ping: 커넥션을 실제로 쓰기 전에 살아있는지 먼저 확인한다.
# pool_recycle: 커넥션을 280초 이상 유휴 상태로 들고 있지 않고 미리 갈아치운다.
#   Supabase pooler가 유휴 연결을 서버 쪽에서 먼저 끊어버리는 경우가 있는데,
#   그 타이밍보다 우리가 먼저 갈아치우면 "server closed the connection unexpectedly"가 줄어든다.
# connect_args의 connect_timeout(초): 지정 안 하면 응답 없는 연결 시도(네트워크 문제 등)에
# psycopg2가 사실상 무한정 대기해서, 그 위의 재시도 로직(main.py의 _create_tables_with_retry)이
# 첫 시도에서부터 멈춰버려 재시도 자체를 못 해본다. 짧게 끊어서 실패를 빠르게 감지해야 재시도가 의미 있다.
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=280,
    connect_args={"connect_timeout": 10},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()