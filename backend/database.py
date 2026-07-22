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
engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True, pool_recycle=280)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()