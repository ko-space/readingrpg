# -*- coding: utf-8 -*-
"""
배포할 때마다 실행: 모든 페이지의 로컬 .js/.css 참조에 ?v=<VERSION> 캐시버스팅 쿼리스트링을
붙이거나 최신 값으로 갱신한다.

왜 필요한가: 이 프로젝트는 번들러가 없어서(파일마다 그냥 <script src="...">로 직접 로드) 파일
내용이 바뀌어도 URL 자체는 그대로다 - 브라우저가 예전 버전을 캐시해두고 있으면 새로 배포해도
유저는 계속 옛날 스크립트를 쓰게 되고, 그러다 페이지가 기대하는 API 응답 모양과 옛날 JS의 가정이
어긋나면 "캐시를 지워야만 정상 작동"하는 문제로 이어진다(2026-08-20, 독서 저장 후 home.html로
돌아갈 때 이 증상이 보고됨 - trade.js/trade.css에만 이미 이 방식이 부분 적용돼 있었음).

사용법: backend를 배포하기 전에 저장소 루트에서
    python scripts/bump_cache_version.py [버전문자열]
버전문자열을 생략하면 오늘 날짜(YYYYMMDD)를 쓴다. 같은 날 두 번 이상 배포한다면
"20260820b"처럼 직접 접미사를 붙여서 인자로 넘기면 된다.

외부(http://, https://) 참조는 절대 건드리지 않는다.
"""
import re
import sys
import io
from datetime import date
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

VERSION = sys.argv[1] if len(sys.argv) > 1 else date.today().strftime("%Y%m%d")
ROOT = Path(__file__).resolve().parent.parent

# <script src>/<link href>를 실제로 갖고 있는 "완성된" HTML 문서만 대상으로 한다 - *-partial.html
# 조각 파일들은 부모 페이지(home.html 등)가 이미 로드해둔 스크립트를 그대로 쓰는 구조라 자체
# 참조가 없다(확인됨). 새 전체 페이지(head/script 태그를 직접 갖는 .html)를 추가하면 여기 리스트에도 추가해야 한다.
TARGET_FILES = [
    "arena-battle.html",
    "arena-live.html",
    "devtest.html",
    "home.html",
    "index.html",
    "reading.html",
    "story-relationship.html",
    "raid-prototype/index.html",
]

# src="..." 또는 href="..." 안의 로컬 .js/.css 경로만 대상으로 한다(http/https 제외).
ATTR_RE = re.compile(r'(src|href)="([^"]+\.(?:js|css))(\?v=[^"]*)?"')


def bump(match):
    attr, path, _old_query = match.groups()
    return f'{attr}="{path}?v={VERSION}"'


def main():
    total_changed = 0
    for rel in TARGET_FILES:
        path = ROOT / rel
        if not path.exists():
            print(f"SKIP (not found): {rel}")
            continue
        text = path.read_text(encoding="utf-8")
        new_text, count = ATTR_RE.subn(bump, text)
        if count:
            path.write_text(new_text, encoding="utf-8")
            total_changed += count
            print(f"{rel}: {count}개 태그 갱신")
        else:
            print(f"{rel}: 대상 태그 없음")
    print(f"\n총 {total_changed}개 태그에 버전 v={VERSION} 적용")


if __name__ == "__main__":
    main()
