"""
캐릭터 공개 여부의 DB 오버라이드. characters.json의 is_hidden은 코드 배포가 있어야 바뀌지만,
character_visibility 테이블에 행을 넣어두면 서버 재시작만으로(코드 수정 없이) 뒤집을 수 있다.
achievements.py/battle_engine.py/routers/characters.py/routers/gacha.py/seed.py/routers/devtest.py가
각자 독립적으로 characters.json을 읽는 이 프로젝트 구조상, is_hidden을 "체크하는" 모든 지점에서
직접 dict 값을 보는 대신 이 모듈의 is_hidden_override()를 거치게 해서 한 곳만 고치면 전부 반영되게 한다.

지연 로딩 + 프로세스 전체 캐시: 첫 호출 시점(테이블이 이미 만들어진 뒤)에 한 번만 DB를 읽는다.
main.py에서 seed_character_visibility()를 테이블 생성 직후, 다른 시딩보다 먼저 호출해야 한다.
"""
from database import SessionLocal
from models import CharacterVisibility

_override_cache = None  # None = 아직 안 읽음. dict(비어있어도 됨) = 읽음.


def is_hidden_override(character_name: str, json_value: bool) -> bool:
    """이 캐릭터가 지금 실제로 숨김 상태인지. DB에 행이 있으면 그 값을, 없으면 characters.json 값을 따른다."""
    global _override_cache
    if _override_cache is None:
        db = SessionLocal()
        try:
            _override_cache = {
                row.character_name: row.is_hidden
                for row in db.query(CharacterVisibility).all()
            }
        finally:
            db.close()
    return _override_cache.get(character_name, json_value)


def seed_character_visibility():
    """characters.json에서 is_hidden: true인 캐릭터마다 기준 행을 만들어둔다(이미 있으면 안 건드림 -
    관리자가 DB에서 직접 False로 뒤집어둔 값이 재시작/재배포로 다시 True로 덮어써지지 않게 하기 위함)."""
    import json
    with open("characters.json", "r", encoding="utf-8") as f:
        character_pool = json.load(f)

    hidden_names = [
        char["name"]
        for char_list in character_pool.values()
        for char in char_list
        if char.get("is_hidden")
    ]
    if not hidden_names:
        return

    db = SessionLocal()
    try:
        existing = {
            row.character_name
            for row in db.query(CharacterVisibility)
            .filter(CharacterVisibility.character_name.in_(hidden_names))
            .all()
        }
        for name in hidden_names:
            if name in existing:
                continue
            db.add(CharacterVisibility(character_name=name, is_hidden=True))
        db.commit()
    finally:
        db.close()
