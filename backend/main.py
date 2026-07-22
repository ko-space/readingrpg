import os
import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import OperationalError
from database import Base, engine
import models
from seed import seed_shop_items, seed_regions, seed_achievements, seed_gacha_banners, seed_enhancement_items, seed_quests, seed_currency_items
from routers import users, logs, gacha, shop, regions, ranking, characters, auth, pvp, achievements, devtest, quests, story

MAX_STARTUP_RETRIES = 5

def _create_tables_with_retry():
    for attempt in range(1, MAX_STARTUP_RETRIES + 1):
        try:
            Base.metadata.create_all(bind=engine)
            return
        except OperationalError as e:
            if attempt == MAX_STARTUP_RETRIES:
                print(f"[startup] DB 연결 {MAX_STARTUP_RETRIES}번 다 실패했습니다. DATABASE_URL과 Supabase 프로젝트 상태를 확인하세요.")
                raise
            wait_seconds = attempt * 2
            print(f"[startup] DB 연결 실패 ({attempt}/{MAX_STARTUP_RETRIES}). {wait_seconds}초 후 재시도합니다... ({e.__class__.__name__})")
            time.sleep(wait_seconds)

_create_tables_with_retry()
seed_shop_items()
seed_regions()
seed_achievements()
seed_gacha_banners()
seed_enhancement_items()
seed_quests()
seed_currency_items()

app = FastAPI()

# .env의 ALLOWED_ORIGINS에 콤마로 구분해서 넣으면 됨. 예:
# ALLOWED_ORIGINS=https://아이디.github.io,http://127.0.0.1:5500
allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(logs.router)
app.include_router(gacha.router)
app.include_router(shop.router)
app.include_router(ranking.router)
app.include_router(regions.router)
app.include_router(characters.router)
app.include_router(pvp.router)
app.include_router(achievements.router)
app.include_router(devtest.router)
app.include_router(quests.router)
app.include_router(story.router)

# backend/static/outfits/ 안의 파일들을 http://.../static/outfits/파일명 으로 그대로 서빙
os.makedirs("static/outfits", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def read_root():
    return {"message": "서버 정상 작동중"}