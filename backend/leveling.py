"""
exp를 주는 모든 경로(독서 기록, 업적 보상 등)가 공유하는 레벨업 계산.
레벨업 임계값(레벨*100)이 여러 파일에 흩어지면 나중에 한쪽만 고치는 실수가 생기기 쉬워서
이 함수 하나로 모은다.
"""

MAX_LEVEL = 30


def apply_exp(user, amount: int) -> dict:
    """user.total_exp/lifetime_exp/level에 exp를 반영하고 레벨업 결과를 돌려준다.
    만렙(MAX_LEVEL)에 도달하면 total_exp를 그 레벨의 요구치(level*100)로 고정해서 게이지가 항상
    가득 찬 상태로 보이게 하고, 그 뒤로 들어오는 exp는 total_exp에 더 반영하지 않는다(레벨업 게이지는
    더 이상 안 차오름). lifetime_exp는 "누적 획득 경험치" 업적 등에 쓰이는 별개의 커리어 총합이라
    만렙 이후에도 계속 쌓인다."""
    if amount <= 0:
        return {"level_up": False, "levels_gained": 0}

    user.lifetime_exp += amount

    if user.level >= MAX_LEVEL:
        user.total_exp = user.level * 100
        return {"level_up": False, "levels_gained": 0}

    user.total_exp += amount

    level_up_occurred = False
    levels_gained = 0
    while user.level < MAX_LEVEL and user.total_exp >= user.level * 100:
        user.total_exp -= user.level * 100
        user.level += 1
        level_up_occurred = True
        levels_gained += 1

    if user.level >= MAX_LEVEL:
        user.total_exp = user.level * 100

    return {"level_up": level_up_occurred, "levels_gained": levels_gained}
