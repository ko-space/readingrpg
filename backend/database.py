import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv()
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")
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