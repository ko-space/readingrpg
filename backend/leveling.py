"""
exp를 주는 모든 경로(독서 기록, 업적 보상 등)가 공유하는 레벨업 계산.
레벨업 임계값(레벨*100)이 여러 파일에 흩어지면 나중에 한쪽만 고치는 실수가 생기기 쉬워서
이 함수 하나로 모은다.
"""

def apply_exp(user, amount: int) -> dict:
    """user.total_exp/lifetime_exp/level에 exp를 반영하고 레벨업 결과를 돌려준다."""
    if amount <= 0:
        return {"level_up": False, "levels_gained": 0}

    user.total_exp += amount
    user.lifetime_exp += amount

    level_up_occurred = False
    levels_gained = 0
    while user.total_exp >= user.level * 100:
        user.total_exp -= user.level * 100
        user.level += 1
        level_up_occurred = True
        levels_gained += 1

    return {"level_up": level_up_occurred, "levels_gained": levels_gained}
