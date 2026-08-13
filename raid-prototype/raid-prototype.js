// 독서 RPG 토벌전 — 수동 조작 매커니즘 샌드박스.
// 자동으로 진행되는 전투 루프는 없다 - 모든 상태 변화는 아래 조작판 버튼을 눌러야만 일어난다.
// 실제 게임(백엔드/계정/캐릭터 소유)과는 완전히 분리돼 있고, 스프라이트만 backend/static/outfits의
// 실제 이미지 파일(그중에서도 배틀 전용인 battle_idle/attack_N/skill_N/return_N)을 상대경로로 그대로
// 읽어와서 보여준다.
(() => {
    "use strict";

    // ── 밸런스 상수(전부 placeholder) ───────────────────────────────────
    const BOSS_MAX_HP = 60000;
    const TOWER_MAX_HP = 3000;
    const FRONT_MAX_HP = 900;
    const BOSS_ATK = 900;

    const GROGGY_MAX = 100;
    const GROGGY_PER_DAMAGE = GROGGY_MAX / (BOSS_MAX_HP * 0.35);
    const GROGGY_VULNERABLE_MULT = 1.5; // 보스 스킬 윈드업(텔레그래프) 중 준 피해 보너스
    const GROGGY_COUNTER_BONUS = 15;
    const GROGGY_STUN_MS = 4000;

    const ULTIMATE_MAX = 100;
    const ULTIMATE_FORCE_CHARGE_ON_CAST = 25;
    const ULTIMATE_DOT_TICK_MS = 500;
    const ULTIMATE_DOT_DAMAGE = 40;
    const ULTIMATE_DELAY_MS = 3000;
    const ULTIMATE_BURST_ATK_PERCENT = 9.0; // 900%

    const TELEGRAPH_MS = 1000;
    const COUNTER_WINDOW_MS = 300;

    const FIELD_MIN_LEFT = 20; // % - 전방 캐릭터 이동 가능 범위(방어탑~보스 사이)
    const FIELD_MAX_LEFT = 76;
    const FRONT_MOVE_STEP = 7;
    const FIST_ZONE_WIDTH = 16; // % - "영광의 주먹" 판정 폭

    // 보스는 CC(기절/넉백 등 행동 불가/제어 계열 상태이상)에 면역이다 - 그로기는 이 raid 전용의 별개
    // 메커니즘이라 여기 안 걸리고 항상 통한다(kind: "groggy"는 아래 집합에 없음).
    const CC_KINDS = new Set(["stun", "knockback"]);

    // 실제 게임(arena/arena-battle.js의 STATUS_ICON_FILES)과 동일한 아이콘 이미지를 그대로 재사용한다.
    // 상태 효과 배지는 텍스트가 아니라 이 아이콘으로 표시된다(assets/arena/에 이미 있는 파일들).
    const STATUS_ICON_BASE = "../assets/arena/";
    const STATUS_ICON_FILES = {
        stun: "Combat_Icon_CC_Stunned.webp",
        knockback: "Combat_Icon_CC_Knockback.webp",
        groggy: "Combat_Icon_CC_Stunned.webp", // 그로기 전용 아이콘은 따로 없어서 같은 "기절"류 아이콘 재사용
        debuff: "Combat_Icon_Debuff_ATK.webp",
        buff: "Combat_Icon_Buff_ATK.webp",
    };

    // cardMultiplier = Active(스킬카드), specialMultiplier = Special(trait) - 실제 게임의 skill_effects(Active)/
    // trait_effects(Special) 두 카테고리에 대응. Passive(star_effects)는 즉발 피해가 아니라 상시 버프라
    // 별도 배율 없이 상태 배지로만 표현한다(아래 allyPassiveToggle).
    const ALLIES = {
        front: { label: "전방", cardMultiplier: 3.0, specialMultiplier: 2.0 },
        back1: { label: "후방1", cardMultiplier: 2.5, specialMultiplier: 1.6 },
        back2: { label: "후방2", cardMultiplier: 2.5, specialMultiplier: 1.6 },
    };

    // 공격력은 실제 게임(backend/battle_core.py의 compute_unit_stats)과 같은 방향으로 계산한다 -
    // 근거리 기준값에 원거리는 ×1.5(화력형), 근거리는 그대로(맷집형은 체력 쪽이라 이 프로토타입에선
    // 생략하고 딜 위주로만 반영). 실제 스탯 절대값(성급 10~60 단위)은 이 raid 자체의 보스 체력
    // (placeholder 6만)과 스케일이 안 맞아서, 기존에 잡아둔 프로토타입용 크기는 유지하고 방향성(비율)만
    // 실제 공식과 맞췄다. "전부 ★5로 통일" - 성급별 차이는 배제하고 근거리/원거리 특성만 반영한다.
    const MELEE_BASE_ATK = { front: 380, back1: 260, back2: 260 };
    const RANGE_ATK_MULTIPLIER = 1.5;

    // characters.json에서 그대로 뽑아온 실제 캐릭터 목록(희귀도 → 가나다 순, backend/characters.json과
    // 동일한 정렬 컨벤션) - 스프라이트 선택용. is_hidden 캐릭터도 이 프로토타입은 개발용이라 그대로 포함.
    // gender/atkType(공격타입)은 characters.json 그대로 - 조건부 특성(여성 대상, 학생 타입 아군 등)
    // 판정에 실제로 쓰인다(아래 CHARACTER_MECHANICS 참고).
    const CHARACTER_CATALOG = [
        { rarity: "신화", name: "방임석", outfit: "artist/basic", range: "원거리", gender: "남", atkType: "Parent" },
        { rarity: "신화", name: "윤대웅", outfit: "photographer/basic", range: "원거리", gender: "남", atkType: "Teacher" },
        { rarity: "신화", name: "윤영준", outfit: "tutor/basic", range: "근거리", gender: "남", atkType: "Parent" },
        { rarity: "전설", name: "김남옥", outfit: "ceo/basic", range: "원거리", gender: "여", atkType: "Teacher" },
        { rarity: "전설", name: "윤 & 호", outfit: "mage_2/basic", range: "근거리", gender: "여", atkType: "Student" },
        { rarity: "전설", name: "이종복", outfit: "mage/basic", range: "원거리", gender: "남", atkType: "Teacher" },
        { rarity: "전설", name: "임소정", outfit: "sj/basic", range: "원거리", gender: "여", atkType: "Teacher" },
        { rarity: "영웅", name: "불빠따 김어진", outfit: "batter/basic", range: "근거리", gender: "남", atkType: "Teacher" },
        { rarity: "영웅", name: "이영웅", outfit: "hero/basic", range: "근거리", gender: "남", atkType: "Parent" },
        { rarity: "영웅", name: "이의진", outfit: "international/basic", range: "원거리", gender: "남", atkType: "Student" },
        { rarity: "희귀", name: "강승유", outfit: "ksy/basic", range: "근거리", gender: "남", atkType: "Student" },
        { rarity: "희귀", name: "서민석", outfit: "sms/basic", range: "원거리", gender: "남", atkType: "Student" },
        { rarity: "희귀", name: "송주헌", outfit: "sjh/basic", range: "근거리", gender: "남", atkType: "Student" },
        { rarity: "일반", name: "강 희", outfit: "student/basic", range: "근거리", gender: "여", atkType: "Student" },
        { rarity: "일반", name: "청년", outfit: "beginner/basic", range: "근거리", gender: "남", atkType: "Parent" },
        { rarity: "일반", name: "최재혁", outfit: "mage_weak/basic", range: "근거리", gender: "남", atkType: "Student" },
    ];
    const OUTFIT_INFO = {};
    CHARACTER_CATALOG.forEach((c) => { OUTFIT_INFO[c.outfit] = c; });

    // 보스(황녕순) 자체 신원 - 기획서 기준 공격타입:학생/방어타입:부모, 성별은 미지정. 조건부 특성(여성
    // 대상 기절, 교사 타입 대상 흡혈 등)이 보스에게 실제로 통하는지 판정할 때 이 값을 기준으로 삼는다 -
    // 안 맞으면(대부분 안 맞음) 조건부 효과 없이 로그로만 "조건 불일치"를 알려준다.
    const BOSS_GENDER = null;
    const BOSS_ATK_TYPE = "Student";
    const BOSS_DEFENSE_TYPE = "Parent";

    // ── 실제 캐릭터 패시브(star_mechanics)/액티브(skill_mechanics)/스페셜(trait_mechanics) 데이터 ──
    // outfit 경로를 키로 매칭(g.outfits[key]가 이미 outfit 경로) - 전부 characters.json의 ★5 파라미터
    // (params["5"])를 그대로 사용한다("전부 ★5로 통일" 컨벤션). 복제/소환 계열(윤영준/윤 & 호/강승유)은
    // active: null - 아직 이 프로토타입에서 구현하지 않는다(요청사항).
    const CHARACTER_MECHANICS = {
        "artist/basic": {
            name: "방임석",
            paintCategories: [], // 자기 자신의 액티브 사용은 물감을 만들지 않는다(소모만 함)
            active: { kind: "paint_consume", skillName: "제목은 관객이 정하세요",
                redPercent: 150, bluePercent: 5, yellowSeconds: 0.5, noPaintMultiplier: 150 },
            special: { kind: "self_dr_buff", traitName: "방임", drPercent: 50 },
            passive: { kind: "paint_gain_toggle", starName: "예술가의 혼" },
        },
        "photographer/basic": {
            name: "윤대웅",
            paintCategories: ["yellow"],
            active: { kind: "self_stack_buff", skillName: "카메라 업그레이드", percentPerStack: 15, maxStacks: 6 },
            special: { kind: "synergy_remove_absorb", traitName: "도플갱어", partnerName: "윤영준", absorbPercent: 120 },
            passive: { kind: "self_atk_buff", starName: "올라운더", atkPercent: 5 },
        },
        "tutor/basic": {
            name: "윤영준",
            paintCategories: ["blue"],
            active: null,
            special: { kind: "synergy_atk_buff", traitName: "대노", partnerName: "강 희", atkPercent: 30 },
            passive: { kind: "self_atk_buff", starName: "올라운더", atkPercent: 5 },
        },
        "ceo/basic": {
            name: "김남옥",
            paintCategories: ["yellow"],
            active: { kind: "conditional_female_stun_haste", skillName: "엑스칼리버",
                baseMultiplier: 100, stunSeconds: 1, hastePercent: 20, hasteSeconds: 2 },
            special: { kind: "job_conditional_team_hp_buff", traitName: "자애심", jobType: "Student", hpPercent: 20 },
            passive: { kind: "self_atk_buff", starName: "몽땅 투척", atkPercent: 5 },
        },
        "mage_2/basic": {
            name: "윤 & 호",
            paintCategories: ["blue"],
            active: null,
            special: { kind: "type_lifesteal", traitName: "선생 고혈", targetType: "Teacher", healAmount: 5 },
            passive: { kind: "kill_heal_toggle", starName: "영혼 흡수", percent: 15 },
        },
        "mage/basic": {
            name: "이종복",
            paintCategories: ["red"],
            active: { kind: "damage_hp_percent_plus_atk", skillName: "질량 충격파", hpPercent: 20, atkMultiplierPercent: 200 },
            special: { kind: "synergy_atk_buff", traitName: "유일한 대마법사", partnerName: "임소정", atkPercent: 40 },
            passive: { kind: "team_hp_buff_toggle", starName: "완전 비탄성 충돌", hpPercent: 15 },
        },
        "sj/basic": {
            name: "임소정",
            paintCategories: ["yellow", "red"],
            active: { kind: "debuff_atk_and_damage", skillName: "전자기파", atkDebuffPercent: 10, debuffSeconds: 1.5, multiplierPercent: 300 },
            special: { kind: "synergy_atk_buff", traitName: "유일한 대마법사", partnerName: "이종복", atkPercent: 40 },
            passive: { kind: "team_atk_buff", starName: "과탐런 양성소", atkPercent: 15 },
        },
        "batter/basic": {
            name: "불빠따 김어진",
            paintCategories: ["red"],
            active: { kind: "aoe_all_others_damage", skillName: "불빠따", multiplierPercent: 150 },
            special: { kind: "type_conditional_team_hp_buff", traitName: "교권 보호", atkType: "Teacher", hpPercent: 40 },
            passive: { kind: "gender_damage_bonus_toggle", starName: "선 넘지 마라", gender: "남", bonusPercent: 30 },
        },
        "hero/basic": {
            name: "이영웅",
            paintCategories: ["blue"],
            active: { kind: "heal_all_allies", skillName: "청진기 진료", healPercent: 10 },
            special: { kind: "death_heal_arm", traitName: "히포크라테스 선서", percent: 10 },
            passive: { kind: "boss_atk_debuff_toggle", starName: "수면 부족", percent: 25 },
        },
        "international/basic": {
            name: "이의진",
            paintCategories: ["blue"],
            active: { kind: "self_type_swap_heal", skillName: "염색체 변환", healPercent: 5, type2StunSeconds: 0.5 },
            special: { kind: "presence_haste", traitName: "복수", targetName: "이영웅", hastePercent: 30 },
            passive: { kind: "crit_multiplier_toggle", starName: "따가운 레이저", multiplier: 3.0 },
        },
        "ksy/basic": {
            name: "강승유",
            paintCategories: ["red"],
            active: null,
            special: { kind: "job_conditional_team_atk_buff", traitName: "친근감", jobType: "Student", atkPercent: 15, hpPercent: 15 },
            passive: { kind: "self_atk_buff", starName: "준비 태세", atkPercent: 15 },
        },
        "sms/basic": {
            name: "서민석",
            paintCategories: ["red"],
            active: { kind: "aoe_gendered_damage", skillName: "고백", maleMultiplierPercent: 150, femaleMultiplierPercent: 300 },
            special: { kind: "female_count_haste", traitName: "본능", percentPerFemale: 20 },
            passive: { kind: "gender_team_atk_buff", starName: "행복", gender: "여", atkPercent: 25 },
        },
        "sjh/basic": {
            name: "송주헌",
            paintCategories: ["yellow", "red"],
            active: { kind: "stun_target", skillName: "격차 벌리기", stunSeconds: 2, multiplierPercent: 150 },
            special: { kind: "teammate_hp_buff_self_cost", traitName: "페이스 메이커", hpPercent: 75, selfHpLossPercent: 50 },
            passive: { kind: "team_hp_buff_toggle", starName: "강화의 손길", hpPercent: 25 },
        },
        "student/basic": {
            name: "강 희",
            paintCategories: ["red"],
            active: { kind: "aoe_enemy_damage", skillName: "생화학 구취 브레스", multiplierPercent: 200 },
            special: { kind: "type_conditional_team_atk_buff", traitName: "광역 도발", atkType: "Teacher", atkPercent: 25 },
            passive: { kind: "self_hp_buff_toggle", starName: "철면피", hpPercent: 25 },
        },
        "beginner/basic": {
            name: "청년",
            paintCategories: ["red", "yellow"],
            active: { kind: "damage_knockback", skillName: "강한 타격", multiplierPercent: 300 },
            special: { kind: "synergy_hp_buff", traitName: "???", partnerName: "송주헌", hpPercent: 45 },
            passive: { kind: "self_atk_buff", starName: "스팀팩", atkPercent: 25 },
        },
        "mage_weak/basic": {
            name: "최재혁",
            paintCategories: ["blue"],
            active: { kind: "self_shield", skillName: "환상살", seconds: 1.5 },
            special: { kind: "rear_priority_toggle", traitName: "마법사 아카데미" },
            passive: { kind: "rear_priority_toggle", starName: "설교와 수정" },
        },
    };

    const OUTFIT_BASE = "../backend/static/outfits/";
    const MAX_ATTACK_FRAMES = 6;
    const MAX_SKILL_FRAMES = 9;
    const MAX_RETURN_FRAMES = 9;
    const ATTACK_FRAME_MS = 90;
    const SKILL_FRAME_MS = 90;
    const RETURN_FRAME_MS = 90;
    // 전술대회(arena-battle.js)와 동일한 컨벤션 - 클릭 즉시가 아니라 공격 애니메이션이 3프레임쯤 재생된
    // 뒤에야 실제 투사체가 발사되고, 데미지도 그 투사체가 보스에게 도착하는 순간에 반영된다.
    const EFFECT_LAUNCH_DELAY_MS = ATTACK_FRAME_MS * 3;
    const PROJECTILE_TRAVEL_MS = 260;

    // 보스 공격 정의 - kind: 'single'(텔레그래프 없음) / 'aoe'(전방+탑) / 'fist'(포지셔닝 회피+카운터) / 'dot'(추가 지속틱)
    const BOSS_MOVES = {
        "boss-single": { name: "침", kind: "single", dmgPercent: 1.0 },
        "boss-jab": { name: "쨉", kind: "aoe", dmgPercent: 1.5 },
        "boss-straight": { name: "스트레이트", kind: "aoe", dmgPercent: 1.2 },
        "boss-fist": { name: "영광의 주먹", kind: "fist", dmgPercent: 1.3 },
        "boss-palm": { name: "영광의 손바닥", kind: "aoe", dmgPercent: 1.1 },
        "boss-roar": { name: "영광의 포효", kind: "dot", dmgPercent: 0.4 },
    };

    // ── DOM ──────────────────────────────────────────────────────────────
    const el = {
        bossHpFillRed: document.getElementById("boss-hp-fill-red"),
        bossHpFillOrange: document.getElementById("boss-hp-fill-orange"),
        bossHpFillYellow: document.getElementById("boss-hp-fill-yellow"),
        bossHpText: document.getElementById("boss-hp-text"),
        groggyFill: document.getElementById("groggy-fill"),
        ultimateSegFills: Array.from(document.querySelectorAll(".ultimate-seg-fill")),
        bossAvatarImg: document.getElementById("boss-avatar-img"),
        bossAvatarFallback: document.getElementById("boss-avatar-fallback"),
        phaseBadge: document.getElementById("phase-badge"),
        towerHpFill: document.getElementById("tower-hp-fill"),
        towerHpText: document.getElementById("tower-hp-text"),
        backHpFills: Array.from(document.querySelectorAll('.unit-hp-fill[data-shared="back"]')),
        towerUnit: document.getElementById("tower-unit"),
        frontUnit: document.getElementById("front-unit"),
        frontHpFill: document.getElementById("front-hp-fill"),
        frontSprite: document.getElementById("front-sprite"),
        back1Sprite: document.getElementById("back1-sprite"),
        back2Sprite: document.getElementById("back2-sprite"),
        back1Unit: document.getElementById("back1-unit"),
        back2Unit: document.getElementById("back2-unit"),
        bossUnit: document.getElementById("boss-unit"),
        bossSprite: document.getElementById("boss-sprite"),
        bossFallback: document.getElementById("boss-fallback"),
        towerBox: document.querySelector("#tower-unit .tower-box"),
        field: document.getElementById("field"),
        telegraphZone: document.getElementById("telegraph-zone"),
        bossTelegraphLabel: document.getElementById("boss-telegraph-label"),
        logPanel: document.getElementById("log-panel"),
        controlPanel: document.getElementById("control-panel"),
        frontOutfitInput: document.getElementById("front-outfit-input"),
        back1OutfitInput: document.getElementById("back1-outfit-input"),
        back2OutfitInput: document.getElementById("back2-outfit-input"),
        applySpritesBtn: document.getElementById("apply-sprites-btn"),
    };

    const STATUS_ROW_EL = {
        tower: document.getElementById("tower-status"),
        back1: document.getElementById("back1-status"),
        back2: document.getElementById("back2-status"),
        front: document.getElementById("front-status"),
        boss: document.getElementById("boss-status-row"),
    };

    const SPRITE_EL = { front: el.frontSprite, back1: el.back1Sprite, back2: el.back2Sprite };

    function log(message, cls) {
        const row = document.createElement("div");
        if (cls) row.className = cls;
        row.textContent = message;
        el.logPanel.prepend(row);
        while (el.logPanel.childNodes.length > 40) el.logPanel.removeChild(el.logPanel.lastChild);
    }

    // ── 상태 ─────────────────────────────────────────────────────────────
    let g = null;

    function freshState() {
        return {
            bossMaxHp: BOSS_MAX_HP,
            bossHp: BOSS_MAX_HP,
            bossAtkMultiplier: 1, // 보스 공격력 배율 - 일부 아군 패시브/액티브의 "보스 공격력 감소" 효과가 여기 누적된다
            groggy: 0,
            groggyStunUntilMs: 0,
            groggyStunTimer: null,
            ultimate: 0,
            ultimateCasting: false,
            ultimateDotTimer: null,
            ultimateHitTimeout: null,
            towerHp: TOWER_MAX_HP,
            frontHp: FRONT_MAX_HP,
            frontAlive: true,
            frontLeftPercent: 45,
            frontShieldUntilMs: 0, // 최재혁 "환상살"(self_shield) 등 - 이 시각까지 전방 피해 무효
            pendingAction: null, // { def, zoneLeft, resolveAtMs, resolveTimer, counterFlipTimer, counteredBy }
            outfits: { front: "beginner/basic", back1: "beginner/basic", back2: "beginner/basic" },
            allyRange: { front: "근거리", back1: "근거리", back2: "근거리" },
            allyCharacterName: { front: "청년", back1: "청년", back2: "청년" },
            allyBaseAtk: { front: MELEE_BASE_ATK.front, back1: MELEE_BASE_ATK.back1, back2: MELEE_BASE_ATK.back2 },
            // 패시브/스페셜/액티브(카메라 업그레이드류 중첩)가 각각 얼마나 공격력 %를 보태는지 - 출처별로
            // 따로 누적해야 패시브를 껐을 때 스페셜/중첩 보너스까지 같이 날아가지 않는다.
            allyAtkBonusSources: { front: { passive: 0, special: 0, skillStack: 0 }, back1: { passive: 0, special: 0, skillStack: 0 }, back2: { passive: 0, special: 0, skillStack: 0 } },
            allyAtk: { front: MELEE_BASE_ATK.front, back1: MELEE_BASE_ATK.back1, back2: MELEE_BASE_ATK.back2 },
            allySkillStacks: { front: 0, back1: 0, back2: 0 }, // 윤대웅 "카메라 업그레이드" 등 중첩형 액티브
            allyIsType2: { front: false, back1: false, back2: false }, // 이의진 "염색체 변환" - 기본공격 눈레이저 type1/type2 분기용
            paint: { red: 0, blue: 0, yellow: 0 }, // 방임석 전용 - 다른 아군이 액티브를 쓸 때마다 쌓인다
            status: { tower: [], back1: [], back2: [], front: [], boss: [] },
        };
    }

    function resetAll() {
        if (g) {
            if (g.groggyStunTimer) clearTimeout(g.groggyStunTimer);
            clearUltimateCast();
            clearPendingAction();
        }
        // outfits/allyRange/allyCharacterName/allyBaseAtk는 "캐릭터 선택" 설정이라 리셋해도 유지한다 -
        // 반면 패시브/스페셜로 쌓인 보너스, 스킬 중첩, 물감, 보호막, 보스 공격력 배율은 전투 중 상태라
        // freshState()가 만든 깨끗한 값(전부 0)으로 되돌아가야 한다.
        const keepOutfits = g ? g.outfits : null;
        const keepRange = g ? g.allyRange : null;
        const keepNames = g ? g.allyCharacterName : null;
        const keepBaseAtk = g ? g.allyBaseAtk : null;
        g = freshState();
        if (keepOutfits) g.outfits = keepOutfits;
        if (keepRange) g.allyRange = keepRange;
        if (keepNames) g.allyCharacterName = keepNames;
        if (keepBaseAtk) g.allyBaseAtk = keepBaseAtk;
        ["front", "back1", "back2"].forEach(recomputeAllyAtk);
        el.logPanel.innerHTML = "";
        el.frontUnit.classList.remove("dead", "hit-shake");
        el.bossUnit.classList.remove("groggy-stunned");
        hideTelegraph();
        applyFrontPosition();
        Object.keys(STATUS_ROW_EL).forEach(renderStatusRow);
        log("── 전체 리셋 ──", "log-notice");
        updateUI();
    }

    // ── 상태 효과(상태이상/버프/디버프) - HP 바 위에 배지로 표시 ─────────────
    function applyStatus(unitKey, id, label, kind) {
        if (unitKey === "boss" && CC_KINDS.has(kind)) {
            log(`보스는 CC(기절/넉백 등) 상태이상에 면역이라 "${label}" 효과가 통하지 않았습니다.`, "log-notice");
            return false;
        }
        const list = g.status[unitKey];
        const existing = list.find((s) => s.id === id);
        if (existing) { existing.label = label; existing.kind = kind; }
        else list.push({ id, label, kind });
        renderStatusRow(unitKey);
        return true;
    }

    function clearStatus(unitKey, id) {
        g.status[unitKey] = g.status[unitKey].filter((s) => s.id !== id);
        renderStatusRow(unitKey);
    }

    function hasStatusId(unitKey, id) {
        return g.status[unitKey].some((s) => s.id === id);
    }

    function renderStatusRow(unitKey) {
        const rowEl = STATUS_ROW_EL[unitKey];
        if (!rowEl) return;
        rowEl.innerHTML = "";
        g.status[unitKey].forEach((s) => {
            const badge = document.createElement("span");
            badge.className = `status-badge kind-${s.kind}`;
            badge.title = s.label;
            const file = STATUS_ICON_FILES[s.kind];
            if (file) {
                const img = document.createElement("img");
                img.src = `${STATUS_ICON_BASE}${file}`;
                img.alt = s.label;
                badge.appendChild(img);
            } else {
                badge.textContent = s.label; // 아이콘이 없는 kind는 텍스트로 폴백
            }
            rowEl.appendChild(badge);
        });
    }

    // ── 데미지/그로기 공용 ───────────────────────────────────────────────
    function isVulnerableWindow() {
        // 보스가 스킬 윈드업(텔레그래프) 중이면 "취약 구간" 보너스(기믹 추천 2번) - 기본공격도 동일 적용.
        return Boolean(g.pendingAction && g.pendingAction.def.kind !== "single" && !g.pendingAction.resolved);
    }

    function dealDamageToBoss(amount, sourceLabel, logOverride) {
        if (g.bossHp <= 0) { log("보스 체력이 이미 0입니다.", "log-notice"); return; }
        g.bossHp = Math.max(0, g.bossHp - amount);
        const groggyGain = amount * GROGGY_PER_DAMAGE * (isVulnerableWindow() ? GROGGY_VULNERABLE_MULT : 1);
        addGroggy(groggyGain);
        playHitEffect("boss");
        log(logOverride || `${sourceLabel} → 보스에게 ${Math.round(amount)} 피해`, "log-dmg");
        if (g.bossHp <= 0) triggerKillHealPassives();
        updateUI();
    }

    // 윤 & 호의 패시브 "영혼 흡수"(kill_heal_percent) - 실제로는 "적 캐릭터 처치 시" 발동하는데, 이 raid는
    // 적이 보스 하나뿐이라 보스 격파 순간을 그 트리거로 취급한다.
    function triggerKillHealPassives() {
        ["front", "back1", "back2"].forEach((k) => {
            const mech = CHARACTER_MECHANICS[g.outfits[k]];
            if (mech && mech.passive && mech.passive.kind === "kill_heal_toggle" && hasStatusId(k, "passive_buff")) {
                healLowestAlly(mech.passive.percent, `${ALLIES[k].label}(${mech.name})의 패시브 "${mech.passive.starName}"(처치 회복)`);
            }
        });
    }

    function addGroggy(amount) {
        if (g.groggy >= GROGGY_MAX) return;
        g.groggy = Math.min(GROGGY_MAX, g.groggy + amount);
        if (g.groggy >= GROGGY_MAX) triggerGroggyStun();
    }

    function triggerGroggyStun() {
        g.groggy = 0;
        g.groggyStunUntilMs = performance.now() + GROGGY_STUN_MS;
        el.bossUnit.classList.add("groggy-stunned");
        applyStatus("boss", "groggy_stun", "기절(그로기)", "groggy");
        if (g.groggyStunTimer) clearTimeout(g.groggyStunTimer);
        g.groggyStunTimer = setTimeout(() => {
            el.bossUnit.classList.remove("groggy-stunned");
            clearStatus("boss", "groggy_stun");
        }, GROGGY_STUN_MS);

        if (g.pendingAction && !g.pendingAction.resolved) {
            clearPendingAction();
            log("그로기 발동! 진행 중이던 보스 행동이 취소됩니다.", "log-notice");
        } else if (g.ultimateCasting) {
            clearUltimateCast();
            log("그로기 발동! 필살기 시전이 통째로 취소됩니다.", "log-notice");
        } else {
            log("그로기 발동! 보스가 잠시 무력화됩니다.", "log-notice");
        }
        updateUI();
    }

    function killFront() {
        if (!g.frontAlive) return;
        g.frontAlive = false;
        el.frontUnit.classList.add("dead");
        log("전방 캐릭터 쓰러짐 - [부활] 버튼을 눌러야 복귀합니다(그동안 보스는 방어 탑을 직접 공격).", "log-dmg");
    }

    function reviveFront() {
        g.frontAlive = true;
        g.frontHp = FRONT_MAX_HP;
        el.frontUnit.classList.remove("dead");
        log("전방 캐릭터 부활!", "log-heal");
        updateUI();
    }

    function hitFront(dmg) {
        if (!g.frontAlive) { hitTower(dmg); return; }
        if (performance.now() < g.frontShieldUntilMs) { log("전방이 보호막으로 피해를 완전히 무효화했습니다.", "log-heal"); return; }
        g.frontHp = Math.max(0, g.frontHp - dmg);
        shake(el.frontUnit);
        playHitEffect("front");
        log(`전방이 ${Math.round(dmg)} 피해를 입었습니다.`, "log-dmg");
        if (g.frontHp <= 0) killFront();
    }

    function hitFrontAndTower(dmg) {
        if (g.frontAlive) {
            if (performance.now() < g.frontShieldUntilMs) {
                log("전방이 보호막으로 피해를 완전히 무효화했습니다.", "log-heal");
            } else {
                g.frontHp = Math.max(0, g.frontHp - dmg);
                shake(el.frontUnit);
                playHitEffect("front");
                if (g.frontHp <= 0) killFront();
            }
        }
        hitTower(dmg * 0.6);
    }

    function hitTower(dmg) {
        g.towerHp = Math.max(0, g.towerHp - dmg);
        shake(el.towerUnit);
        playHitEffect("tower");
        log(`방어 탑이 ${Math.round(dmg)} 피해를 입었습니다.`, "log-dmg");
    }

    function shake(elm) {
        elm.classList.remove("hit-shake");
        void elm.offsetWidth;
        elm.classList.add("hit-shake");
    }

    // ── 공격 이펙트: 맞는 순간 스프라이트가 붉게 번쩍 + 맞은 자리에 짧은 충격파 ──────
    function flashHitTargets(unitKey) {
        if (unitKey === "boss") return [el.bossSprite, el.bossFallback];
        if (unitKey === "tower") return [el.towerBox];
        const spriteEl = SPRITE_EL[unitKey];
        return spriteEl ? [spriteEl] : [];
    }

    function fieldRelativeCenter(anchorEl) {
        const fieldRect = el.field.getBoundingClientRect();
        const rect = anchorEl.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 - fieldRect.left, y: rect.top + rect.height / 2 - fieldRect.top };
    }

    function spawnImpactBurst(anchorEl) {
        if (!anchorEl) return;
        const pos = fieldRelativeCenter(anchorEl);
        const burst = document.createElement("div");
        burst.className = "impact-burst";
        burst.style.left = `${pos.x}px`;
        burst.style.top = `${pos.y}px`;
        el.field.appendChild(burst);
        setTimeout(() => burst.remove(), 400);
    }

    // 투기장(arena-battle.js의 spawnProjectile)과 같은 방식 - 시작 위치를 잡은 뒤 강제 리플로우(void
    // offsetWidth)로 확정시키고 나서야 transition을 걸어야, 브라우저가 두 스타일 변경을 한 프레임으로
    // 묶어버려(코얼레싱) 투사체가 날지 않고 순간이동해버리는 문제가 안 생긴다.
    function spawnProjectile(fromEl, toEl, kindClass, onArrive) {
        if (!fromEl || !toEl) { if (onArrive) onArrive(); return; }
        const start = fieldRelativeCenter(fromEl);
        const end = fieldRelativeCenter(toEl);
        const dot = document.createElement("div");
        dot.className = `attack-projectile kind-${kindClass}`;
        dot.style.left = `${start.x}px`;
        dot.style.top = `${start.y}px`;
        el.field.appendChild(dot);
        void dot.offsetWidth;
        dot.style.transition = `left ${PROJECTILE_TRAVEL_MS}ms linear, top ${PROJECTILE_TRAVEL_MS}ms linear`;
        dot.style.left = `${end.x}px`;
        dot.style.top = `${end.y}px`;
        setTimeout(() => {
            dot.remove();
            if (onArrive) onArrive();
        }, PROJECTILE_TRAVEL_MS);
    }

    function playHitEffect(unitKey) {
        const targets = flashHitTargets(unitKey);
        targets.forEach((t) => {
            if (!t) return;
            t.classList.remove("hit-flash");
            void t.offsetWidth;
            t.classList.add("hit-flash");
        });
        spawnImpactBurst(targets[0]);
    }

    // flashEffectAura/angleDeg/animateArcMotion/spawnPaintSkillProjectile/spawnMeteorProjectile/
    // spawnHeartProjectile/spawnHealingHeart/spawnGasBreathStream/playElectricBolt은 이제
    // shared/attack-effects.js가 전술대회/개발자화면과 공유로 제공한다(중복 방지) - 이 파일은 시작부
    // initAttackEffects(...) 호출로 resolveUnitEl/fieldEl만 이 화면에 맞게 알려준다.

    // 불빠따 "불빠따" 전용 - shared의 spawnGroundFireCanvas는 "여러 대상(hits 배열)"을 전제로 하는
    // 시그니처라(전술대회는 적 전체+아군 1명을 동시에 때림), 이 raid는 보스 하나뿐이라 가짜 hit 객체
    // 1개로 어댑팅한다.
    function spawnGroundFireCanvasForBoss(fromEl, onArrive) {
        spawnGroundFireCanvas(fromEl, [{ boss: true }], () => el.bossUnit, () => onArrive());
    }

    // ── 전방 이동 ────────────────────────────────────────────────────────
    function moveFront(dir) {
        g.frontLeftPercent = Math.min(FIELD_MAX_LEFT, Math.max(FIELD_MIN_LEFT, g.frontLeftPercent + dir * FRONT_MOVE_STEP));
        applyFrontPosition();
    }
    function applyFrontPosition() {
        el.frontUnit.style.left = `${g.frontLeftPercent}%`;
    }

    // ── 스프라이트 애니메이션(실제 game과 동일한 attack_N/skill_N/return_N 프레임 컨벤션) ──
    const frameCountCache = {}; // `${outfit}:${prefix}` -> 실제 존재하는 프레임 수
    const animTokens = { front: 0, back1: 0, back2: 0 };

    function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

    function checkImageExists(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
        });
    }

    async function getFrameCount(outfit, prefix, max) {
        const cacheKey = `${outfit}:${prefix}`;
        if (frameCountCache[cacheKey] !== undefined) return frameCountCache[cacheKey];
        let count = 0;
        for (let i = 1; i <= max; i++) {
            // eslint-disable-next-line no-await-in-loop
            const exists = await checkImageExists(`${OUTFIT_BASE}${outfit}/${prefix}_${i}.webp`);
            if (!exists) break;
            count = i;
        }
        frameCountCache[cacheKey] = count;
        return count;
    }

    async function playFrames(imgEl, outfit, prefix, frameMs, maxFrames, isStale) {
        const count = await getFrameCount(outfit, prefix, maxFrames);
        if (count === 0 || isStale()) return false;
        for (let i = 1; i <= count; i++) {
            if (isStale()) return false;
            imgEl.src = `${OUTFIT_BASE}${outfit}/${prefix}_${i}.webp`;
            // eslint-disable-next-line no-await-in-loop
            await sleep(frameMs);
        }
        return !isStale();
    }

    // 배틀 전용 스프라이트만 쓴다 - 로비/프로필용 idle.webp 대신 battle_idle.webp를 우선 쓰고,
    // 그 outfit에 battle_idle.webp가 없을 때만 idle.webp로 폴백한다.
    async function setIdleSprite(imgEl, outfit) {
        const hasBattleIdle = await checkImageExists(`${OUTFIT_BASE}${outfit}/battle_idle.webp`);
        imgEl.src = `${OUTFIT_BASE}${outfit}/${hasBattleIdle ? "battle_idle" : "idle"}.webp`;
    }

    // 기본공격/스킬 모션을 실제로 재생한다(피해 판정 로직과는 독립적으로 병행) - 스킬은 재생이 끝나면
    // return_N 프레임으로 복귀 동작까지 재생한 뒤 idle로 돌아온다.
    // 반환하는 Promise는 "캐스팅(공격/스킬) 프레임 재생이 끝난 시점"에 resolve된다 - return 프레임/idle
    // 복귀는 그 뒤로 이어지지만 별도로 흘러가고(fire-and-forget), 이 Promise는 기다리지 않는다. 실제
    // 게임(arena-battle.js)의 cast_start->skill_resolve 타이밍과 동일하게, 스킬의 실제 효과(투사체 발사/
    // 데미지)는 "캐스팅 자세가 다 끝난 시점"에 발동해야 한다 - 기본공격처럼 스윙 도중(3프레임쯤)에
    // 미리 발동하면 안 된다(스킬은 프레임 수가 더 많아 스윙 컨벤션을 그대로 쓰면 애니메이션이 끝나기도
    // 전에 효과가 먼저 터지는 버그가 생긴다).
    function playUnitAnimation(key, kind) {
        const imgEl = SPRITE_EL[key];
        const outfit = g.outfits[key];
        if (!imgEl || !outfit) return Promise.resolve();
        const myToken = ++animTokens[key];
        const isStale = () => animTokens[key] !== myToken;

        const frameMs = kind === "attack" ? ATTACK_FRAME_MS : SKILL_FRAME_MS;
        const maxFrames = kind === "attack" ? MAX_ATTACK_FRAMES : MAX_SKILL_FRAMES;
        const castDone = playFrames(imgEl, outfit, kind, frameMs, maxFrames, isStale);

        castDone.then(async () => {
            if (isStale()) return;

            if (kind === "skill") {
                await playFrames(imgEl, outfit, "return", RETURN_FRAME_MS, MAX_RETURN_FRAMES, isStale);
                if (isStale()) return;
            }

            // 공격/스킬(+스킬의 return)이 끝나면 예외 없이 항상 배틀 대기 자세로 되돌아온다 - 프레임이
            // 아예 없던 경우든, return까지 다 재생한 경우든 마지막엔 반드시 idle로 복귀시킨다
            // (return까지 다 재생하고도 idle로 안 돌아오던 게 버그였다).
            await setIdleSprite(imgEl, outfit);
        });

        return castDone;
    }

    // ── 아군 조작 - 공용 헬퍼 ────────────────────────────────────────────
    function recomputeAllyAtk(key) {
        const src = g.allyAtkBonusSources[key];
        const totalPercent = src.passive + src.special + src.skillStack;
        g.allyAtk[key] = Math.max(1, Math.round(g.allyBaseAtk[key] * (1 + totalPercent / 100)));
    }

    function findAllySlotWithCharacter(name) {
        return ["front", "back1", "back2"].find((k) => g.allyCharacterName[k] === name) || null;
    }

    function hasAllyAtkType(atkType) {
        return ["front", "back1", "back2"].some((k) => {
            const info = OUTFIT_INFO[g.outfits[k]];
            return info && info.atkType === atkType;
        });
    }

    function countAllyGender(gender) {
        return ["front", "back1", "back2"].filter((k) => {
            const info = OUTFIT_INFO[g.outfits[k]];
            return info && info.gender === gender;
        }).length;
    }

    function adjustBossAtkMultiplier(delta) {
        g.bossAtkMultiplier = Math.max(0.1, g.bossAtkMultiplier + delta);
    }

    // key가 "front"면 전방 개인 체력을, 그 외(back1/back2/tower 아무거나)는 방어탑 공용 체력 풀을
    // 회복시킨다(후방 2명은 이미 방어탑과 체력 풀을 공유 - updateUI의 backHpFills 참고).
    function healUnit(key, percent, sourceLabel, flatAmount) {
        if (key === "front") {
            if (!g.frontAlive) { log(`${sourceLabel} - 전방이 쓰러진 상태라 회복할 수 없습니다.`, "log-notice"); return; }
            const amount = flatAmount != null ? flatAmount : FRONT_MAX_HP * (percent / 100);
            g.frontHp = Math.min(FRONT_MAX_HP, g.frontHp + amount);
            log(`${sourceLabel} - 전방 체력 ${Math.round(amount)} 회복.`, "log-heal");
        } else {
            const amount = flatAmount != null ? flatAmount : TOWER_MAX_HP * (percent / 100);
            g.towerHp = Math.min(TOWER_MAX_HP, g.towerHp + amount);
            log(`${sourceLabel} - 방어 탑/후방 체력 ${Math.round(amount)} 회복.`, "log-heal");
        }
        updateUI();
    }

    // "체력이 가장 낮은 아군" - 전방(개인 풀)과 방어탑/후방(공용 풀)을 비율(%)로 비교해서 더 급한 쪽을 고른다.
    function healLowestAlly(percent, sourceLabel) {
        const frontRatio = g.frontAlive ? g.frontHp / FRONT_MAX_HP : Infinity;
        const towerRatio = g.towerHp / TOWER_MAX_HP;
        healUnit(frontRatio <= towerRatio ? "front" : "back1", percent, sourceLabel);
    }

    // 방임석 전용 - "자신을 제외한 전장 내 인물"이 액티브(스킬 카드)를 쓸 때마다, 그 스킬의 효과
    // 종류(skill_categories: red=피해/blue=회복·특수/yellow=강화·약화·CC)에 따라 물감을 1개씩 획득한다.
    function gainPaintFromActiveUse(actingKey) {
        const painterKey = findAllySlotWithCharacter("방임석");
        if (!painterKey || painterKey === actingKey) return;
        if (!hasStatusId(painterKey, "passive_buff")) return; // 패시브를 꺼두면 물감도 안 쌓인다
        const actingMech = CHARACTER_MECHANICS[g.outfits[actingKey]];
        if (!actingMech || !actingMech.paintCategories.length) return;
        actingMech.paintCategories.forEach((color) => { g.paint[color] += 1; });
        log(`방임석의 패시브 "예술가의 혼" 발동! 물감 획득 → 빨강 ${g.paint.red} / 파랑 ${g.paint.blue} / 노랑 ${g.paint.yellow}`, "log-notice");
    }

    // ── 아군 조작 - 기본공격(전부 공용 투사체) ──────────────────────────────
    // 전술대회와 동일한 컨벤션: 클릭 즉시 데미지가 아니라, 공격 애니메이션이 EFFECT_LAUNCH_DELAY_MS만큼
    // (3프레임쯤) 재생된 뒤에야 투사체가 발사되고, 그 투사체가 보스에게 도착하는 순간에 데미지가 반영된다.
    // 기본공격은 근거리/원거리 상관없이 이 공용 투사체 하나로 통일한다(요청사항).
    // 실제 게임(shared/attack-effects.js의 RANGED_ATTACK_STYLE)에 전용 기본공격 연출이 등록된
    // 캐릭터(윤대웅/김남옥/이종복/임소정/서민석/이의진/방임석)는 그 연출을 그대로 쓰고, 그 외(근거리
    // 전부 + 목록에 없는 원거리)는 요청대로 raid 자체 공용 투사체를 그대로 쓴다.
    function allyBasicAttack(key) {
        if (key === "front" && !g.frontAlive) { log("전방이 쓰러진 상태라 공격할 수 없습니다.", "log-notice"); return; }
        playUnitAnimation(key, "attack");
        const style = RANGED_ATTACK_STYLE[g.allyCharacterName[key]];
        setTimeout(() => {
            const onArrive = () => dealDamageToBoss(g.allyAtk[key], `${ALLIES[key].label} 기본공격`);
            if (style) {
                playRangedAttackByStyle(style, SPRITE_EL[key], el.bossUnit, onArrive, { isType2: g.allyIsType2[key] });
            } else {
                spawnProjectile(SPRITE_EL[key], el.bossUnit, "basic", onArrive);
            }
        }, EFFECT_LAUNCH_DELAY_MS);
    }

    // ── 아군 조작 - 액티브(skill_effects/skill_mechanics, "스킬 카드") ─────────
    function allySkillCard(key) {
        if (key === "front" && !g.frontAlive) { log("전방이 쓰러진 상태라 스킬을 쓸 수 없습니다.", "log-notice"); return; }

        // "영광의 주먹" 텔레그래프 마지막 0.3초 안이면 카운터로 처리(기믹 추천 1번) - 어느 유닛의 카드든
        // 상관없다. 카운터는 정확한 타이밍에 반응하는 게 핵심이라 윈드업/투사체 지연 없이 그 자리에서 즉시 처리한다.
        const action = g.pendingAction;
        const nowMs = performance.now();
        if (action && action.def.kind === "fist" && !action.resolved &&
            nowMs >= action.resolveAtMs - COUNTER_WINDOW_MS && nowMs < action.resolveAtMs) {
            action.counteredBy = key;
            playUnitAnimation(key, "skill");
            addGroggy(GROGGY_COUNTER_BONUS);
            log(`${ALLIES[key].label} 스킬 카드로 "영광의 주먹" 완전 반격! (그로기 보너스 +${GROGGY_COUNTER_BONUS})`, "log-notice");
            el.telegraphZone.classList.add("counter-ready");
            updateUI();
            return;
        }

        const mech = CHARACTER_MECHANICS[g.outfits[key]];
        if (!mech || !mech.active) {
            log(`${ALLIES[key].label}(${mech ? mech.name : "?"})의 액티브는 복제/소환 계열이라 이 프로토타입에서 아직 구현하지 않았습니다.`, "log-notice");
            return;
        }

        gainPaintFromActiveUse(key);
        playUnitAnimation(key, "skill").then(() => performActiveEffect(key, mech));
    }

    // 실제 skill_mechanics의 effect_type별로 분기 - 보스 하나만 있는 raid에 맞게 단순화하되, 숫자(★5
    // 파라미터)와 조건(여성 대상 등)은 실제 캐릭터 값을 그대로 쓴다.
    // 캐릭터별 실제 이펙트(arena-battle.js와 동일한 함수/CSS를 그대로 이식) - 캐릭터 이펙트가 없는
    // 경우(자기 자신에게 거는 버프/회복/CC 시도)는 투사체 없이 flashEffectAura만 나오는 것도 실제
    // 게임과 동일하다(예: 엑스칼리버는 보스가 여성이 아니라 기절 조건이 안 맞으면 크레용 투사체 자체가
    // 안 나가고 자기 자신 공속 버프 오라만 뜬다 - arena의 conditional_target_debuff 처리와 동일).
    function performActiveEffect(key, mech) {
        const a = mech.active;
        const label = `${ALLIES[key].label}(${mech.name})`;
        const spriteEl = SPRITE_EL[key];
        switch (a.kind) {
            case "paint_consume": {
                const { red, blue, yellow } = g.paint;
                if (red + blue + yellow === 0) {
                    const dmg = g.allyAtk[key] * (a.noPaintMultiplier / 100);
                    spawnPaintSkillProjectile(spriteEl, el.bossUnit, "paint-white", () => {
                        dealDamageToBoss(dmg, `${label}의 "${a.skillName}"(물감 없음)`);
                    });
                    return;
                }
                const dmg = red * g.allyAtk[key] * (a.redPercent / 100);
                const healPercent = blue * a.bluePercent;
                const stunSeconds = yellow * a.yellowSeconds;
                g.paint = { red: 0, blue: 0, yellow: 0 };
                // arena와 동일 - 소모한 물감 색깔별로 각각 독립된 투사체를 동시에 날린다.
                if (dmg > 0) {
                    spawnPaintSkillProjectile(spriteEl, el.bossUnit, "paint-red", () => {
                        dealDamageToBoss(dmg, `${label}의 "${a.skillName}"(빨강 물감 ${red}개)`);
                    });
                }
                if (healPercent > 0) {
                    spawnPaintSkillProjectile(spriteEl, el.bossUnit, "paint-blue", () => {
                        healLowestAlly(healPercent, `${label}의 "${a.skillName}"(파랑 물감 ${blue}개)`);
                    });
                }
                if (stunSeconds > 0) {
                    spawnPaintSkillProjectile(spriteEl, el.bossUnit, "paint-yellow", () => {
                        const applied = applyStatus("boss", "paint_stun", `기절(${stunSeconds.toFixed(1)}초, 노랑 물감 ${yellow}개)`, "stun");
                        if (applied) flashEffectAura("boss", "cc");
                    });
                }
                return;
            }
            case "self_stack_buff": {
                const stacks = Math.min(a.maxStacks, (g.allySkillStacks[key] || 0) + 1);
                g.allySkillStacks[key] = stacks;
                g.allyAtkBonusSources[key].skillStack = stacks * a.percentPerStack;
                recomputeAllyAtk(key);
                flashEffectAura(key, "buff"); // 투사체 없이 자기 자신에게 오라만(arena와 동일)
                log(`${label}의 "${a.skillName}" 발동! 공격력 중첩 ${stacks}/${a.maxStacks}(누적 +${stacks * a.percentPerStack}%)`, "log-notice");
                updateUI();
                return;
            }
            case "conditional_female_stun_haste": {
                // arena에서도 이 스킬은 대상이 여성일 때만 크레용 투사체가 나간다 - 보스는 성별
                // 미지정이라 투사체 없이 자기 자신 공속 버프 오라만 뜬다(피해는 raid 프로토타입에서만
                // 보정으로 남겨둔 기본 피해).
                const dmg = g.allyAtk[key] * (a.baseMultiplier / 100);
                dealDamageToBoss(dmg, `${label}의 "${a.skillName}"`);
                log(`"${a.skillName}"의 기절 조건(대상 여성)이 보스와 맞지 않아 기절은 발동하지 않았습니다.`, "log-notice");
                applyStatus(key, "haste_buff", `공격속도 증가(${a.hastePercent}%, ${a.hasteSeconds}초)`, "buff");
                flashEffectAura(key, "buff");
                setTimeout(() => clearStatus(key, "haste_buff"), a.hasteSeconds * 1000);
                return;
            }
            case "damage_hp_percent_plus_atk": {
                spawnMeteorProjectile(spriteEl, el.bossUnit, () => {
                    const dmg = g.bossHp * (a.hpPercent / 100) + g.allyAtk[key] * (a.atkMultiplierPercent / 100);
                    dealDamageToBoss(dmg, `${label}의 "${a.skillName}"`);
                });
                return;
            }
            case "debuff_atk_and_damage": {
                playElectricBolt(spriteEl, el.bossUnit, false, () => {
                    const dmg = g.allyAtk[key] * (a.multiplierPercent / 100);
                    dealDamageToBoss(dmg, `${label}의 "${a.skillName}"`);
                    const applied = applyStatus("boss", "atk_debuff_paint", `공격력 감소(${a.atkDebuffPercent}%, ${a.debuffSeconds}초)`, "debuff");
                    if (applied) {
                        flashEffectAura("boss", "debuff");
                        adjustBossAtkMultiplier(-a.atkDebuffPercent / 100);
                        setTimeout(() => { clearStatus("boss", "atk_debuff_paint"); adjustBossAtkMultiplier(a.atkDebuffPercent / 100); }, a.debuffSeconds * 1000);
                    }
                }, ELECTRIC_ORIGIN_SKILL);
                return;
            }
            case "aoe_all_others_damage": {
                spawnGroundFireCanvasForBoss(spriteEl, () => {
                    const dmg = g.allyAtk[key] * (a.multiplierPercent / 100);
                    dealDamageToBoss(dmg, `${label}의 "${a.skillName}"`);
                });
                return;
            }
            case "aoe_enemy_damage": {
                spawnGasBreathStream(spriteEl, () => {
                    const dmg = g.allyAtk[key] * (a.multiplierPercent / 100);
                    dealDamageToBoss(dmg, `${label}의 "${a.skillName}"`);
                });
                return;
            }
            case "heal_all_allies": {
                // 이제 아군 한 명이 아니라 전체를 동시에 회복시킨다(실제 게임과 동일) - death_heal_ally류의
                // 다른 "여럿을 동시에" 효과와 마찬가지로 투사체 없이 곧바로 반영한다. 이 raid는 체력 풀이
                // 전방(개인)/방어탑+후방(공용) 둘뿐이라 각각 한 번씩만 회복하면 "전체 회복"이 된다
                // (후방1·2는 이미 같은 공용 풀을 공유하므로 두 번 회복시킬 필요가 없다).
                if (g.frontAlive) {
                    healUnit("front", a.healPercent, `${label}의 "${a.skillName}"`);
                    flashEffectAura("front", "heal");
                }
                healUnit("back1", a.healPercent, `${label}의 "${a.skillName}"`);
                flashEffectAura("back1", "heal");
                flashEffectAura("back2", "heal");
                return;
            }
            case "self_type_swap_heal": {
                g.allyIsType2[key] = !g.allyIsType2[key]; // [type1]<->[type2] 전환 - 기본공격 눈레이저 색도 같이 바뀐다
                healUnit(key, a.healPercent, `${label}의 "${a.skillName}"(${g.allyIsType2[key] ? "type2" : "type1"}로 전환)`);
                if (g.allyIsType2[key]) applyStatus(key, "type_swap", `염색체 전환 상태(기본공격 시 남성 적 ${a.type2StunSeconds}초 기절)`, "buff");
                else clearStatus(key, "type_swap");
                flashEffectAura(key, "heal");
                return;
            }
            case "aoe_gendered_damage": {
                // arena와 동일 - 대상 성별에 따라 heart-red/heart-pink. 보스는 성별 미지정이라 항상 pink.
                const multiplier = BOSS_GENDER === "여" ? a.femaleMultiplierPercent : a.maleMultiplierPercent;
                spawnHeartProjectile(spriteEl, el.bossUnit, BOSS_GENDER === "여" ? "heart-red" : "heart-pink", () => {
                    const dmg = g.allyAtk[key] * (multiplier / 100);
                    dealDamageToBoss(dmg, `${label}의 "${a.skillName}"(보스 성별 미지정 → 남성 배율 적용)`);
                });
                return;
            }
            case "stun_target": {
                // arena에서도 이 스킬은 전용 투사체 없이 명중 즉시 flashHit+오라만 나온다.
                const dmg = g.allyAtk[key] * (a.multiplierPercent / 100);
                dealDamageToBoss(dmg, `${label}의 "${a.skillName}"`);
                const applied = applyStatus("boss", "sjh_stun", `기절(${a.stunSeconds}초)`, "stun");
                if (applied) flashEffectAura("boss", "cc");
                return;
            }
            case "damage_knockback": {
                // arena에서도 이 스킬은 전용 투사체 없이 명중 즉시 flashHit+넉백 오라만 나온다.
                const dmg = g.allyAtk[key] * (a.multiplierPercent / 100);
                dealDamageToBoss(dmg, `${label}의 "${a.skillName}"`);
                const applied = applyStatus("boss", "knockback_hit", "넉백", "knockback");
                if (applied) flashEffectAura("boss", "cc");
                return;
            }
            case "self_shield": {
                if (key === "front") g.frontShieldUntilMs = performance.now() + a.seconds * 1000;
                applyStatus(key, "shield_buff", `보호막(${a.seconds}초간 피해 무효)`, "buff");
                flashEffectAura(key, "special");
                setTimeout(() => clearStatus(key, "shield_buff"), a.seconds * 1000);
                log(`${label}의 "${a.skillName}" 발동! ${a.seconds}초간 모든 피해를 무효화합니다.`, "log-notice");
                return;
            }
            default:
                return;
        }
    }

    // ── 아군 조작 - 스페셜(trait_effects/trait_mechanics) ──────────────────
    // 실제 게임에서 조건부로 발동하는 "[Special]" 계열. 전용 스프라이트가 따로 없어서(attack_N/skill_N/
    // return_N 세 세트뿐) Active와 같은 skill_N→return_N 모션을 그대로 재사용한다. 클릭 = "지금 조건을
    // 확인하고 발동"이라, 조건이 실제로 안 맞으면(파트너 없음/보스 타입 불일치 등) 발동하지 않고 로그로만 알린다.
    function allySpecial(key) {
        if (key === "front" && !g.frontAlive) { log("전방이 쓰러진 상태라 스페셜을 쓸 수 없습니다.", "log-notice"); return; }
        const mech = CHARACTER_MECHANICS[g.outfits[key]];
        if (!mech) return;
        playUnitAnimation(key, "skill").then(() => performSpecialEffect(key, mech));
    }

    function performSpecialEffect(key, mech) {
        const s = mech.special;
        const label = `${ALLIES[key].label}(${mech.name})`;
        const teamKeys = ["front", "back1", "back2"];
        switch (s.kind) {
            case "self_dr_buff": {
                applyStatus(key, "special_dr", `[Special] ${s.traitName}(받는 피해 ${s.drPercent}% 감소)`, "buff");
                flashEffectAura(key, "buff");
                log(`${label}의 [Special] "${s.traitName}" 발동! 받는 피해 ${s.drPercent}% 감소.`, "log-notice");
                return;
            }
            case "synergy_remove_absorb":
            case "synergy_atk_buff": {
                const partnerKey = findAllySlotWithCharacter(s.partnerName);
                if (!partnerKey) { log(`${label}의 [Special] "${s.traitName}"은(는) ${s.partnerName}이(가) 편성에 없어 발동하지 않았습니다.`, "log-notice"); return; }
                const pct = s.kind === "synergy_remove_absorb" ? s.absorbPercent : s.atkPercent;
                g.allyAtkBonusSources[key].special += pct;
                recomputeAllyAtk(key);
                flashEffectAura(key, "buff");
                log(`${label}의 [Special] "${s.traitName}" 발동! (${s.partnerName} 시너지) 공격력 +${pct}%.`, "log-notice");
                updateUI();
                return;
            }
            case "job_conditional_team_hp_buff": {
                if (!hasAllyAtkType(s.jobType)) { log(`${label}의 [Special] "${s.traitName}"은(는) 직업:${s.jobType} 아군이 없어 발동하지 않았습니다.`, "log-notice"); return; }
                teamKeys.forEach((k) => { applyStatus(k, "team_hp_buff", `[Special] 최대 체력 +${s.hpPercent}%`, "buff"); flashEffectAura(k, "buff"); });
                log(`${label}의 [Special] "${s.traitName}" 발동! 아군 전체 최대 체력 +${s.hpPercent}%.`, "log-notice");
                return;
            }
            case "type_lifesteal": {
                if (BOSS_ATK_TYPE !== s.targetType && BOSS_DEFENSE_TYPE !== s.targetType) {
                    log(`${label}의 [Special] "${s.traitName}"은(는) 보스가 ${s.targetType} 타입이 아니라 흡혈이 발동하지 않았습니다.`, "log-notice");
                    return;
                }
                healUnit(key, null, `${label}의 [Special] "${s.traitName}"`, s.healAmount);
                flashEffectAura(key, "heal");
                return;
            }
            case "type_conditional_team_hp_buff": {
                if (!hasAllyAtkType(s.atkType)) { log(`${label}의 [Special] "${s.traitName}"은(는) ${s.atkType} 타입 아군이 없어 발동하지 않았습니다.`, "log-notice"); return; }
                teamKeys.forEach((k) => { applyStatus(k, "team_hp_buff", `[Special] 최대 체력 +${s.hpPercent}%`, "buff"); flashEffectAura(k, "buff"); });
                log(`${label}의 [Special] "${s.traitName}" 발동! 아군 전체 최대 체력 +${s.hpPercent}%.`, "log-notice");
                return;
            }
            case "death_heal_arm": {
                healLowestAlly(s.percent, `${label}의 [Special] "${s.traitName}"(사망 트리거를 미리 시연)`);
                return;
            }
            case "presence_haste": {
                const partnerKey = findAllySlotWithCharacter(s.targetName);
                if (!partnerKey) { log(`${label}의 [Special] "${s.traitName}"은(는) ${s.targetName}이(가) 편성에 없어 발동하지 않았습니다.`, "log-notice"); return; }
                applyStatus(key, "haste_buff", `[Special] 공격속도 +${s.hastePercent}%`, "buff");
                flashEffectAura(key, "buff");
                log(`${label}의 [Special] "${s.traitName}" 발동! (${s.targetName} 존재) 공격속도 +${s.hastePercent}%.`, "log-notice");
                return;
            }
            case "job_conditional_team_atk_buff": {
                if (!hasAllyAtkType(s.jobType)) { log(`${label}의 [Special] "${s.traitName}"은(는) 직업:${s.jobType} 아군이 없어 발동하지 않았습니다.`, "log-notice"); return; }
                teamKeys.forEach((k) => {
                    g.allyAtkBonusSources[k].special += s.atkPercent;
                    recomputeAllyAtk(k);
                    applyStatus(k, "team_hp_buff", `[Special] 최대 체력 +${s.hpPercent}%`, "buff");
                    flashEffectAura(k, "buff");
                });
                log(`${label}의 [Special] "${s.traitName}" 발동! 아군 전체 공격력 +${s.atkPercent}%, 최대 체력 +${s.hpPercent}%.`, "log-notice");
                updateUI();
                return;
            }
            case "female_count_haste": {
                const count = countAllyGender("여");
                if (count === 0) { log(`${label}의 [Special] "${s.traitName}"은(는) 여성 아군이 없어 발동하지 않았습니다.`, "log-notice"); return; }
                applyStatus(key, "haste_buff", `[Special] 공격속도 +${count * s.percentPerFemale}%`, "buff");
                flashEffectAura(key, "buff");
                log(`${label}의 [Special] "${s.traitName}" 발동! 여성 아군 ${count}명 × ${s.percentPerFemale}% = 공격속도 +${count * s.percentPerFemale}%.`, "log-notice");
                return;
            }
            case "teammate_hp_buff_self_cost": {
                teamKeys.filter((k) => k !== key).forEach((k) => { applyStatus(k, "team_hp_buff", `[Special] 최대 체력 +${s.hpPercent}%`, "buff"); flashEffectAura(k, "buff"); });
                if (key === "front" && g.frontAlive) g.frontHp = Math.max(1, g.frontHp - g.frontHp * (s.selfHpLossPercent / 100));
                else g.towerHp = Math.max(0, g.towerHp - g.towerHp * (s.selfHpLossPercent / 100));
                flashEffectAura(key, "debuff");
                log(`${label}의 [Special] "${s.traitName}" 발동! 다른 아군 최대 체력 +${s.hpPercent}%, 자신 체력 ${s.selfHpLossPercent}% 소모.`, "log-notice");
                updateUI();
                return;
            }
            case "type_conditional_team_atk_buff": {
                if (!hasAllyAtkType(s.atkType)) { log(`${label}의 [Special] "${s.traitName}"은(는) ${s.atkType} 타입 아군이 없어 발동하지 않았습니다.`, "log-notice"); return; }
                teamKeys.forEach((k) => { g.allyAtkBonusSources[k].special += s.atkPercent; recomputeAllyAtk(k); flashEffectAura(k, "buff"); });
                log(`${label}의 [Special] "${s.traitName}" 발동! 아군 전체 공격력 +${s.atkPercent}%.`, "log-notice");
                updateUI();
                return;
            }
            case "synergy_hp_buff": {
                const partnerKey = findAllySlotWithCharacter(s.partnerName);
                if (!partnerKey) { log(`${label}의 [Special] "${s.traitName}"은(는) ${s.partnerName}이(가) 편성에 없어 발동하지 않았습니다.`, "log-notice"); return; }
                applyStatus(key, "team_hp_buff", `[Special] 최대 체력 +${s.hpPercent}%`, "buff");
                flashEffectAura(key, "buff");
                log(`${label}의 [Special] "${s.traitName}" 발동! (${s.partnerName} 시너지) 최대 체력 +${s.hpPercent}%.`, "log-notice");
                return;
            }
            case "rear_priority_toggle": {
                applyStatus(key, "special_rear", `[Special] ${s.traitName}(후방 적 우선 공격 부여)`, "buff");
                flashEffectAura(key, "special");
                log(`${label}의 [Special] "${s.traitName}" 발동!`, "log-notice");
                return;
            }
            default:
                return;
        }
    }

    // ── 아군 조작 - 패시브(star_effects/star_mechanics) ────────────────────
    // 상시 적용되는 성급 효과라 실제 게임에서도 "시전 모션"이 없다. 여기서는 발동/해제를 토글해서 HP 바
    // 위 상태 배지로만 있고 없음을 보여준다(스프라이트 애니메이션 없음) - 실제 이름/수치를 그대로 쓴다.
    function allyPassiveToggle(key) {
        const mech = CHARACTER_MECHANICS[g.outfits[key]];
        const p = mech && mech.passive;
        const id = "passive_buff";
        const label = p ? p.starName : "패시브(성급 효과)";
        const nameTag = mech ? mech.name : "";
        if (hasStatusId(key, id)) {
            clearStatus(key, id);
            if (mech) applyPassiveEffect(key, mech, false);
            log(`${ALLIES[key].label}(${nameTag})의 패시브 "${label}" 해제.`, "log-notice");
        } else {
            applyStatus(key, id, label, "buff");
            if (mech) applyPassiveEffect(key, mech, true);
            log(`${ALLIES[key].label}(${nameTag})의 패시브 "${label}" 활성화.`, "log-notice");
        }
        updateUI();
    }

    // 이 raid 새드박스의 데미지 계산식에는 치명타/성별 데미지 보너스/후방 우선순위 타겟팅이 없어서,
    // 그런 종류의 패시브는 배지(적용 여부 표시)로만 남고 수치는 실제로 반영되지 않는다 - 반면 공격력 %
    // 계열(자기 자신/성별 한정/팀 전체)과 보스 공격력 감소는 실제 전투 수치에 그대로 반영된다.
    function applyPassiveEffect(key, mech, turningOn) {
        const p = mech.passive;
        const sign = turningOn ? 1 : -1;
        switch (p.kind) {
            case "self_atk_buff":
                g.allyAtkBonusSources[key].passive += sign * p.atkPercent;
                recomputeAllyAtk(key);
                return;
            case "team_atk_buff":
                ["front", "back1", "back2"].forEach((k) => {
                    g.allyAtkBonusSources[k].passive += sign * p.atkPercent;
                    recomputeAllyAtk(k);
                });
                return;
            case "gender_team_atk_buff":
                ["front", "back1", "back2"].forEach((k) => {
                    const info = OUTFIT_INFO[g.outfits[k]];
                    if (info && info.gender === p.gender) {
                        g.allyAtkBonusSources[k].passive += sign * p.atkPercent;
                        recomputeAllyAtk(k);
                    }
                });
                return;
            case "boss_atk_debuff_toggle":
                adjustBossAtkMultiplier(sign * -(p.percent / 100));
                return;
            default:
                return;
        }
    }

    // ── 보스 조작 ────────────────────────────────────────────────────────
    function bossAction(actionKey) {
        const def = BOSS_MOVES[actionKey];
        if (!def) return;

        if (g.groggyStunUntilMs > performance.now()) { log("보스가 그로기로 무력화된 상태라 행동할 수 없습니다.", "log-notice"); return; }
        if (g.ultimateCasting) { log("필살기 시전 중에는 다른 행동을 할 수 없습니다.", "log-notice"); return; }
        if (g.pendingAction && !g.pendingAction.resolved) { log("이미 예고 중인 행동이 있습니다.", "log-notice"); return; }

        if (def.kind === "single") {
            // 텔레그래프 없이 즉시 처리.
            el.bossTelegraphLabel.textContent = `${def.name}!`;
            hitFront(BOSS_ATK * def.dmgPercent * g.bossAtkMultiplier);
            setTimeout(() => { el.bossTelegraphLabel.textContent = ""; }, 500);
            updateUI();
            return;
        }

        const action = { def, resolved: false, counteredBy: null, zoneLeft: null };
        if (def.kind === "fist") {
            action.zoneLeft = FIELD_MIN_LEFT + Math.random() * (FIELD_MAX_LEFT - FIELD_MIN_LEFT);
            el.telegraphZone.style.left = `${action.zoneLeft - FIST_ZONE_WIDTH / 2}%`;
            el.telegraphZone.classList.remove("hidden", "counter-ready");
            action.counterFlipTimer = setTimeout(() => {
                if (g.pendingAction === action && !action.resolved) el.telegraphZone.classList.add("counter-ready");
            }, TELEGRAPH_MS - COUNTER_WINDOW_MS);
        }
        el.bossTelegraphLabel.textContent = `${def.name} 예고!`;

        action.resolveAtMs = performance.now() + TELEGRAPH_MS;
        action.resolveTimer = setTimeout(() => resolveBossAction(action), TELEGRAPH_MS);
        g.pendingAction = action;
        updateUI();
    }

    function resolveBossAction(action) {
        if (action.resolved) return;
        action.resolved = true;
        if (g.pendingAction === action) g.pendingAction = null;
        hideTelegraph();

        if (action.counteredBy) return; // 완전 무효화

        if (action.def.kind === "fist") {
            const frontInZone = Math.abs(g.frontLeftPercent - action.zoneLeft) <= FIST_ZONE_WIDTH / 2;
            if (!frontInZone) {
                log('"영광의 주먹" 회피 성공!', "log-heal");
                updateUI();
                return;
            }
            hitFrontAndTower(BOSS_ATK * action.def.dmgPercent * g.bossAtkMultiplier);
            updateUI();
            return;
        }

        hitFrontAndTower(BOSS_ATK * action.def.dmgPercent * g.bossAtkMultiplier);

        if (action.def.kind === "dot") {
            let ticks = 0;
            const dotTimer = setInterval(() => {
                ticks += 1;
                if (ticks > 2) { clearInterval(dotTimer); return; }
                hitFrontAndTower(BOSS_ATK * 0.25 * g.bossAtkMultiplier);
                updateUI();
            }, 700);
        }
        updateUI();
    }

    function clearPendingAction() {
        if (!g.pendingAction) { hideTelegraph(); return; }
        const action = g.pendingAction;
        if (action.resolveTimer) clearTimeout(action.resolveTimer);
        if (action.counterFlipTimer) clearTimeout(action.counterFlipTimer);
        action.resolved = true;
        g.pendingAction = null;
        hideTelegraph();
    }

    function hideTelegraph() {
        el.telegraphZone.classList.remove("counter-ready");
        el.telegraphZone.classList.add("hidden");
        el.bossTelegraphLabel.textContent = "";
    }

    // ── 필살기 ───────────────────────────────────────────────────────────
    function startUltimateCast() {
        if (g.ultimateCasting) { log("이미 필살기를 시전 중입니다.", "log-notice"); return; }
        if (g.groggyStunUntilMs > performance.now()) { log("보스가 그로기로 무력화된 상태라 시전할 수 없습니다.", "log-notice"); return; }
        clearPendingAction();

        g.ultimateCasting = true;
        g.ultimate = 0;
        addGroggy(ULTIMATE_FORCE_CHARGE_ON_CAST); // 기믹 추천 3번 - 시전 시작 시 그로기 강제 충전
        log('보스 필살기 「분노의 흔들거림」 시전 시작! 지금 몰아쳐서 그로기를 채우면 저지할 수 있습니다.', "log-notice");
        el.bossTelegraphLabel.textContent = "필살기 시전 중 - 분노의 흔들거림";

        g.ultimateDotTimer = setInterval(() => {
            g.towerHp = Math.max(0, g.towerHp - ULTIMATE_DOT_DAMAGE);
            log(`필살기 지속 피해 - 방어 탑에 ${ULTIMATE_DOT_DAMAGE} 피해`, "log-dmg");
            updateUI();
        }, ULTIMATE_DOT_TICK_MS);

        g.ultimateHitTimeout = setTimeout(() => {
            const dmg = g.allyAtk.front * ULTIMATE_BURST_ATK_PERCENT;
            g.towerHp = Math.max(0, g.towerHp - dmg);
            log(`필살기 폭발! 방어 탑에 ${Math.round(dmg)}의 큰 피해!`, "log-dmg");
            clearUltimateCast();
            updateUI();
        }, ULTIMATE_DELAY_MS);

        updateUI();
    }

    function clearUltimateCast() {
        if (g.ultimateDotTimer) { clearInterval(g.ultimateDotTimer); g.ultimateDotTimer = null; }
        if (g.ultimateHitTimeout) { clearTimeout(g.ultimateHitTimeout); g.ultimateHitTimeout = null; }
        g.ultimateCasting = false;
        el.bossTelegraphLabel.textContent = "";
    }

    // ── 화면 렌더 ────────────────────────────────────────────────────────
    // 체력바 3단 색상 레이어(위: 노랑 66.7~100% / 가운데: 주황 33.3~66.7% / 아래: 빨강 0~33.3%) -
    // 세 레이어 다 항상 전체 폭(overlay)에 걸쳐 그려두고, 각자 "자기 구간"에서만 폭이 줄어들게 해서
    // 위 레이어가 닳을수록 아래 레이어가 서서히 드러나 보이게 한다(자기 구간보다 체력이 높으면 100%로
    // 꽉 차서 위 레이어에 완전히 가려져 있다가, 체력이 그 구간까지 내려와야 비로소 자기가 줄기 시작).
    const HP_TIERS = [
        { el: null, low: 0, high: 100 / 3 }, // 빨강(가장 아래)
        { el: null, low: 100 / 3, high: 200 / 3 }, // 주황(가운데)
        { el: null, low: 200 / 3, high: 100 }, // 노랑(가장 위)
    ];
    function updateBossHpTiers(bossPct) {
        HP_TIERS[0].el = el.bossHpFillRed;
        HP_TIERS[1].el = el.bossHpFillOrange;
        HP_TIERS[2].el = el.bossHpFillYellow;
        let leadingAssigned = false;
        for (let i = HP_TIERS.length - 1; i >= 0; i--) {
            const tier = HP_TIERS[i];
            const width = Math.max(0, Math.min(100, ((bossPct - tier.low) / (tier.high - tier.low)) * 100));
            tier.el.style.width = `${width}%`;
            // 노랑부터 순서대로 확인해서 폭이 0보다 큰 첫 티어 = 지금 실제로 깎이고 있는(맨 위에 드러난) 티어.
            const isLeading = !leadingAssigned && width > 0;
            tier.el.classList.toggle("hp-tier-leading", isLeading);
            if (isLeading) leadingAssigned = true;
        }
    }

    function updateUI() {
        const bossPct = (g.bossHp / g.bossMaxHp) * 100;
        updateBossHpTiers(bossPct);
        el.bossHpText.textContent = `${Math.round(g.bossHp).toLocaleString()} / ${g.bossMaxHp.toLocaleString()}`;
        el.groggyFill.style.width = `${g.groggy}%`;

        // 필살 게이지는 값 자체는 하나(0~100)지만, 참고 이미지처럼 세그먼트 3개로 나눠서 왼쪽부터
        // 순서대로 차오르는 것처럼 보여준다 - 세그먼트 하나당 100/3만큼을 담당.
        // 아래에서 위로 차오르는 형식이라 width가 아니라 height를 채운다(CSS: .ultimate-seg가
        // align-items:flex-end라 height가 늘어나면 바닥에서부터 위로 자라 보인다).
        const segSpan = ULTIMATE_MAX / el.ultimateSegFills.length;
        el.ultimateSegFills.forEach((fillEl, i) => {
            const segFilled = Math.max(0, Math.min(segSpan, g.ultimate - i * segSpan));
            fillEl.style.height = `${(segFilled / segSpan) * 100}%`;
        });

        const phase = bossPct <= 50 ? 2 : 1;
        el.phaseBadge.textContent = `${phase}페이즈`;
        el.phaseBadge.classList.toggle("phase-2", phase === 2);

        const towerPct = Math.max(0, (g.towerHp / TOWER_MAX_HP) * 100);
        el.towerHpFill.style.width = `${towerPct}%`;
        el.towerHpText.textContent = Math.round(g.towerHp).toLocaleString();
        el.backHpFills.forEach((elm) => { elm.style.width = `${towerPct}%`; });

        const frontPct = Math.max(0, (g.frontHp / FRONT_MAX_HP) * 100);
        el.frontHpFill.style.width = `${frontPct}%`;
    }

    // ── 캐릭터 선택 드롭다운 ─────────────────────────────────────────────
    const OUTFIT_SELECT_EL = { front: el.frontOutfitInput, back1: el.back1OutfitInput, back2: el.back2OutfitInput };

    function populateCharacterSelects() {
        const groups = {};
        CHARACTER_CATALOG.forEach((c) => { (groups[c.rarity] = groups[c.rarity] || []).push(c); });

        Object.values(OUTFIT_SELECT_EL).forEach((selectEl) => {
            selectEl.innerHTML = "";
            Object.keys(groups).forEach((rarity) => {
                const optgroup = document.createElement("optgroup");
                optgroup.label = rarity;
                groups[rarity].forEach((c) => {
                    const opt = document.createElement("option");
                    opt.value = c.outfit;
                    opt.dataset.range = c.range;
                    opt.dataset.name = c.name;
                    opt.textContent = `${c.name} (${c.range})`;
                    optgroup.appendChild(opt);
                });
                selectEl.appendChild(optgroup);
            });
        });
        // 기본값: 전방/후방1/후방2 전부 "청년"(beginner/basic)으로 시작.
        Object.values(OUTFIT_SELECT_EL).forEach((selectEl) => { selectEl.value = "beginner/basic"; });
    }

    // ── 스프라이트/스탯 적용 ─────────────────────────────────────────────
    function applySprites() {
        ["front", "back1", "back2"].forEach((key) => {
            const selectEl = OUTFIT_SELECT_EL[key];
            const selectedOption = selectEl.options[selectEl.selectedIndex];
            const outfit = selectEl.value || "beginner/basic";
            const range = (selectedOption && selectedOption.dataset.range) || "근거리";
            const name = (selectedOption && selectedOption.dataset.name) || "청년";

            g.outfits[key] = outfit;
            g.allyRange[key] = range;
            g.allyCharacterName[key] = name;
            g.allyBaseAtk[key] = range === "근거리" ? MELEE_BASE_ATK[key] : Math.round(MELEE_BASE_ATK[key] * RANGE_ATK_MULTIPLIER);
            // 캐릭터가 바뀌면 이전 캐릭터 기준으로 쌓여있던 패시브/스페셜/스킬 중첩 보너스와 상태 배지는
            // 더 이상 의미가 없으므로 이 슬롯만 깨끗하게 초기화한다.
            g.allyAtkBonusSources[key] = { passive: 0, special: 0, skillStack: 0 };
            g.allySkillStacks[key] = 0;
            g.allyIsType2[key] = false;
            g.status[key] = [];
            recomputeAllyAtk(key);
            renderStatusRow(key);

            setIdleSprite(SPRITE_EL[key], outfit);
        });
        updateUI();
    }

    // ── 조작판 버튼 라우팅 ───────────────────────────────────────────────
    const ACTIONS = {
        "front-move-left": () => moveFront(-1),
        "front-move-right": () => moveFront(1),
        "front-basic": () => allyBasicAttack("front"),
        "front-passive": () => allyPassiveToggle("front"),
        "front-skill": () => allySkillCard("front"),
        "front-special": () => allySpecial("front"),
        "front-revive": () => reviveFront(),
        "back1-basic": () => allyBasicAttack("back1"),
        "back1-passive": () => allyPassiveToggle("back1"),
        "back1-skill": () => allySkillCard("back1"),
        "back1-special": () => allySpecial("back1"),
        "back2-basic": () => allyBasicAttack("back2"),
        "back2-passive": () => allyPassiveToggle("back2"),
        "back2-skill": () => allySkillCard("back2"),
        "back2-special": () => allySpecial("back2"),
        "boss-single": () => bossAction("boss-single"),
        "boss-jab": () => bossAction("boss-jab"),
        "boss-straight": () => bossAction("boss-straight"),
        "boss-fist": () => bossAction("boss-fist"),
        "boss-palm": () => bossAction("boss-palm"),
        "boss-roar": () => bossAction("boss-roar"),
        "boss-ultimate": () => startUltimateCast(),
        "force-groggy": () => triggerGroggyStun(),
        "add-ultimate": () => { g.ultimate = Math.min(ULTIMATE_MAX, g.ultimate + 25); updateUI(); },
        "test-cc-on-boss": () => applyStatus("boss", "test_stun", "기절(테스트)", "stun"),
        "test-debuff-on-front": () => applyStatus("front", "test_debuff", "공격력 감소(테스트)", "debuff"),
        "reset-all": () => resetAll(),
    };

    el.controlPanel.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;
        const fn = ACTIONS[btn.dataset.action];
        if (fn) fn();
    });

    window.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") moveFront(-1);
        if (e.key === "ArrowRight") moveFront(1);
    });

    el.applySpritesBtn.addEventListener("click", applySprites);

    // ── 시작 ─────────────────────────────────────────────────────────────
    // shared/attack-effects.js(전술대회/개발자화면과 공유하는 이펙트 렌더링 모듈)에게 이 화면의 DOM
    // 컨벤션을 알려준다 - flashHitTargets(key)[0]이 보스/탑/아군 등 문자열 키를 실제 엘리먼트로
    // 리졸브해주는 기존 헬퍼라 그대로 재사용한다.
    initAttackEffects({
        resolveUnitEl: (key) => flashHitTargets(key)[0],
        fieldEl: el.field,
    });
    resetAll();
    populateCharacterSelects();
    applySprites();
})();
