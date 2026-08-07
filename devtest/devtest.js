// devtest.js - 개발자 전용 스킬/밸런스 테스트 창. 로비와 전혀 연결돼 있지 않다.
// arena-battle.js의 재생 로직(공격 프레임/투사체/근거리 이동)을 참고해 옮겨 적었고,
// cast_start/skill_resolve 이벤트 재생 + 원거리 5명 전용 연출 + 수동 버튼(서버 왕복 없음)이 추가됐다.
(function () {
    "use strict";

    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;

    const PLAYBACK_SPEED = 0.8;
    // 방임 해제 즉시 발동(cast_start 없는 skill_resolve)에 순수 연출용으로 붙이는 시전 자세 재생
    // 시간(arena-battle.js와 동일한 이유 - 백엔드가 시간을 안 주므로 프론트가 임의로 정한 고정값).
    const NEGLECT_RELEASE_POSE_SECONDS = 0.6;
    const PROJECTILE_TRAVEL_MS = 220;
    const MAX_ATTACK_FRAMES = 6;
    const MAX_SKILL_FRAMES = 9; // 스킬 시전 전용 사진은 캐릭터당 총 9장까지 넣기로 확정됨(arena-battle.js와 동일)
    const MAX_WALK_FRAMES = 6; // 걷기 전용 사진(walk_N.png), attack_N.png와 같은 최대 장수(arena-battle.js와 동일)
    const ATTACK_FRAME_DURATION_MS = 60;
    const WALK_FRAME_DURATION_MS = 220;
    const EFFECT_LAUNCH_DELAY_MS = ATTACK_FRAME_DURATION_MS * 3; // 원거리 공격: 애니메이션 3프레임쯤 재생된 뒤 이펙트 발사
    const MOVE_STEP_PX = 4;
    const ARRIVE_THRESHOLD_PX = 2;
    // 이미 도착한 상태에서 상대가 계속 걷느라 화면 위치가 살짝씩 흔들리면 매 프레임 도착/미도착이
    // 갈려서 공격 연출이 밀리는 문제가 있었다(arena-battle.js와 동일) - 확실히 멀어지기 전까지는
    // 다시 "미도착"으로 되돌리지 않는 여유 구간(히스테리시스).
    const LOSE_CONTACT_THRESHOLD_PX = 48;
    const CRIT_CHANCE = 0.10;      // battle_engine.py의 CRIT_CHANCE와 동일 - 수동 버튼도 서버와 같은 확률로 흉내낸다
    const CRIT_MULTIPLIER = 1.5;

    // 원거리 5명 전용 기본공격 연출. 여기 없는(=근거리이거나 목록에 없는) 캐릭터는 기존 걷기+공격프레임 그대로.
    const RANGED_ATTACK_STYLE = {
        "윤대웅": "instant_flash",   // 카메라 셔터 플래시 - 투사체 이동 없음
        "김남옥": "crayon",          // 원통형 크레파스 다트 - 포물선, 대상이 전방이면 진분홍/후방이면 푸른색
        "이종복": "text_particles",  // F/=/m/a 네 글자 순차 발사 - 직선
        "임소정": "electric",        // 캐스터-대상을 잠깐 잇는 푸른 전기
        "서민석": "book",            // 책 던지기 - 포물선, 계속 회전
        "이의진": "eye_laser",       // 눈에서 발사되는 레이저 - type1(빨강)/type2(청록) 두 가지, isType2로 분기(arena-battle.js와 동일)
        "방임석": "paint_gold",      // 물감 투척 - 직선, 항상 황금빛(arena-battle.js와 동일)
    };

    // 캐릭터별 성별 - 서민석 스킬(하트 색)처럼 대상 성별에 따라 연출이 갈리는 경우에 쓴다.
    // 이의진은 염색체 변환 스킬로 전투 중 성별이 바뀌므로, 이 표는 "기본값"일 뿐이고 실제 판정은
    // effectiveGender(name, slot)이 units[slot].isType2를 함께 봐서 처리한다(arena-battle.js와 동일).
    const CHARACTER_GENDER = {
        "윤대웅": "남", "윤영준": "남", "김남옥": "여", "이종복": "남", "임소정": "여",
        "이영웅": "남", "불빠따 김어진": "남", "서민석": "남", "강승유": "남",
        "송주헌": "남", "최재혁": "남", "청년": "남", "강 희": "여", "이의진": "남",
    };

    function effectiveGender(name, slot) {
        if (slot && units[slot]?.isType2) return "여";
        return CHARACTER_GENDER[name] || "남";
    }

    const SLOTS = ["attacker-front", "attacker-back", "defender-front", "defender-back"];

    // 수동 "스킬 사용" 버튼용 - battle_engine.py의 계산식을 그대로 흉내낸다(서버 왕복 없이 로컬에서 즉시 적용).
    const STAR_BASE_STATS = { 1: { hp: 100, atk: 10 }, 2: { hp: 200, atk: 20 }, 3: { hp: 300, atk: 30 }, 4: { hp: 400, atk: 40 }, 5: { hp: 500, atk: 50 }, 6: { hp: 600, atk: 60 } };
    const TYPE_ADVANTAGE = { Parent: "Teacher", Student: "Parent", Teacher: "Student" };

    // hp는 원거리 기준값, atk는 근거리 기준값 - 반대쪽 사거리는 1.5배(battle_engine.py의 RANGE_STAT_MULTIPLIER와 동일).
    function computeBaseStats(star, level, isMelee) {
        const base = STAR_BASE_STATS[star] || STAR_BASE_STATS[1];
        const rangedHp = base.hp + level * 20;
        const meleeAtk = base.atk + level * 2;
        if (isMelee) return { hp: Math.round(rangedHp * 1.5), atk: meleeAtk };
        return { hp: rangedHp, atk: Math.round(meleeAtk * 1.5) };
    }

    function getTypeMultiplier(attackType, defenseType) {
        if (attackType === defenseType) return 1.0;
        if (TYPE_ADVANTAGE[attackType] === defenseType) return 1.5;
        return 0.7;
    }

    let characterCatalog = [];
    let units = {}; // slot -> {name, maxHp, hp, atk, isMelee, outfit, style, attackType, defenseType, gender, status}
    let activeSlot = null;
    const attackAnimActive = {};
    const attackAnimTokens = {};
    // slot -> 그 배우의 애니메이션 단계가 순서대로만 실행되도록 이어붙인 Promise 체인(arena-battle.js와
    // 동일 - chainActorAnim/waitForAnimIdle 참고). 전역 이벤트 커서는 이 체인을 절대 기다리지 않는다.
    const actorAnimChain = {};
    // slot -> 그 유닛이 쏜 원거리 공격의 투사체/이펙트가 아직 목표에 도달하지 않았는지(arena-battle.js와 동일).
    const rangedResolvePending = {};
    // slot -> 그 유닛의 근접 기본공격이 스윙은 시작됐지만 아직 명중 판정이 안 났는지(arena-battle.js와 동일).
    const meleeHitPending = {};
    const frameCountCache = {};
    const skillFrameCountCache = {};
    const walkFrameCountCache = {};
    const walkAnimTokens = {};
    const walkAnimActive = {}; // slot -> 지금 playWalkFrames 루프가 이미 돌고 있는지(arena-battle.js와 동일)
    const meleeTargetKey = {};
    const meleeArrived = {};
    const pendingArrivalResolvers = {};
    const walkerSuspended = {}; // slot -> 이동 루프를 잠깐 멈춰둘지(넉백 트랜지션 중 tick()과 충돌 방지, arena-battle.js와 동일)
    let walkerRunning = false;
    // startMeleeWalker가 다시 호출될 때마다 증가(attackAnimTokens와 동일한 이유, arena-battle.js와 동일) -
    // devtest는 같은 화면에서 전투를 재시작할 수 있어서, walkerRunning 하나만 보면 리셋 직후 아주 짧은
    // 틈에 재시작될 때 이전 세대의 tick() 루프가 "여전히 유효함"으로 오판해 새 전투 위에 겹쳐 돌 수 있다.
    let walkerEpoch = 0;
    let advancedSlot = {}; // slot -> bool, "이동" 버튼으로 앞으로 나간 상태인지(토글)

    // ===== 바라보는 방향(스프라이트 반전) - arena-battle.js와 동일한 로직 =====
    const facingFlipped = {};
    function isFacingFlipped(slot) {
        if (facingFlipped[slot] === undefined) facingFlipped[slot] = slot.startsWith("defender");
        return facingFlipped[slot];
    }
    function setFacing(slot, flipped) {
        if (facingFlipped[slot] === flipped) return;
        facingFlipped[slot] = flipped;
        const battleEl = document.querySelector(`[data-unit="${slot}"]`);
        battleEl?.querySelector(".battle-unit-img")?.classList.toggle("flipped", flipped);
        // 히트박스 정렬도 방향을 따라간다(arena-battle.js와 동일 이유).
        battleEl?.classList.toggle("hitbox-flipped", flipped);
    }
    function faceToward(slot, targetSlot) {
        const el = document.querySelector(`[data-unit="${slot}"]`);
        const targetEl = document.querySelector(`[data-unit="${targetSlot}"]`);
        if (!el || !targetEl) return;
        const rect = el.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const targetIsLeft = (targetRect.left + targetRect.width / 2) < (rect.left + rect.width / 2);
        setFacing(slot, targetIsLeft);
    }

    function authHeaders() {
        const manualToken = document.getElementById("dt-token-input").value.trim();
        const token = manualToken || localStorage.getItem("access_token");
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    // 특성 발동 로그 문구 - arena-battle.js의 traitLogText와 동일 규칙(실제 변경된 수치까지 표시).
    function traitLogText(event) {
        const d = event.detail || {};
        if (event.effect_type === "ally_synergy_remove_absorb") {
            return `${event.actor}의 [Special] 발동! ${d.removed}을(를) 흡수하여 공격력·최대체력 ${d.absorb_percent}% 증가`;
        }
        if (event.effect_type === "ally_synergy_atk_buff") {
            if (d.hp_percent !== undefined) {
                return `${event.actor}의 [Special] 발동! ${d.partner}와(과)의 시너지로 최대 체력 ${d.hp_percent}% 증가`;
            }
            return `${event.actor}의 [Special] 발동! ${d.partner}와(과)의 시너지로 공격력 ${d.atk_percent}% 증가`;
        }
        if (event.effect_type === "ally_job_conditional_team_buff") {
            const parts = [];
            if (d.atk_percent) parts.push(`공격력 ${d.atk_percent}%`);
            if (d.hp_percent) parts.push(`최대 체력 ${d.hp_percent}%`);
            return `${event.actor}의 [Special] 발동! ${d.partner}와(과)의 시너지로 아군 전체 ${parts.join("·")} 증가`;
        }
        if (event.effect_type === "ally_type_conditional_team_buff") {
            const parts = [];
            if (d.atk_percent) parts.push(`공격력 ${d.atk_percent}%`);
            if (d.hp_percent) parts.push(`최대 체력 ${d.hp_percent}%`);
            return `${event.actor}의 [Special] 발동! 아군 전체 ${parts.join("·")} 증가`;
        }
        if (event.effect_type === "team_teacher_hp_buff") {
            return `${event.actor}의 [Special] 발동! 팀 내 선생 타입 캐릭터 최대 체력 ${d.hp_percent}% 증가`;
        }
        if (event.effect_type === "teammate_hp_buff_self_cost") {
            return `${event.actor}의 [Special] 발동! ${d.partner ? `${d.partner} 최대 체력 ${d.hp_percent}% 증가, ` : ""}자신의 최대 체력 ${d.self_hp_loss_percent}% 감소`;
        }
        if (event.effect_type === "battlefield_presence_haste") {
            return `${event.actor}의 [Special] 발동! 전장의 ${d.target_name}에게 반응해 공격 속도 ${d.haste_percent}% 증가`;
        }
        if (event.effect_type === "female_count_haste") {
            return `${event.actor}의 [Special] 발동! 전장 내 여성 ${d.female_count}명 - 공격 속도 ${d.haste_percent}% 증가`;
        }
        if (event.effect_type === "dynamic_grant_rear_priority") {
            return `${event.actor}의 [Special] 발동! ${d.partner}도 후방 적 우선 공격`;
        }
        return `${event.actor}의 [Special] 발동! (${event.effect_type}) ${JSON.stringify(d)}`;
    }

    // 전투 중 표시(로스터 이름표/로그)에서만 이름을 줄여 보여준다(arena-battle.js와 동일한 이유 -
    // "윤 & 호"가 정식 이름이지만 소환수 호가 별도로 나온 뒤엔 중복돼 보인다).
    const BATTLE_DISPLAY_NAME_OVERRIDES = { "윤 & 호": "윤" };
    function battleDisplayText(text) {
        let result = text;
        for (const [full, short] of Object.entries(BATTLE_DISPLAY_NAME_OVERRIDES)) {
            result = result.replaceAll(full, short);
        }
        return result;
    }

    function log(text) {
        const el = document.getElementById("dt-log");
        if (!el) return;
        const line = document.createElement("div");
        line.textContent = battleDisplayText(text);
        el.appendChild(line);
        el.scrollTop = el.scrollHeight;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function configEl(slot) {
        return document.querySelector(`.dt-unit-config[data-slot="${slot}"]`);
    }

    function catalogOf(name) {
        return characterCatalog.find((c) => c.name === name);
    }

    // ───────────────────────── 초기화: 캐릭터 목록 불러와서 셀렉트 채우기 ─────────────────────────

    async function loadCatalog() {
        const res = await fetch(`${API_BASE_URL}/devtest/characters`, { headers: authHeaders() });
        if (!res.ok) {
            log(`캐릭터 목록을 불러오지 못했습니다 (${res.status}). 토큰을 확인하세요.`);
            return;
        }
        characterCatalog = await res.json();

        SLOTS.forEach((slot) => {
            const cfg = configEl(slot);
            const charSelect = cfg.querySelector(".dt-char-select");
            const starSelect = cfg.querySelector(".dt-star-select");

            charSelect.innerHTML = characterCatalog
                .map((c) => `<option value="${c.name}">${c.name} (${c.rarity})</option>`)
                .join("");
            starSelect.innerHTML = [1, 2, 3, 4, 5, 6].map((s) => `<option value="${s}">${s}성</option>`).join("");

            const defaultChar = characterCatalog[SLOTS.indexOf(slot) % characterCatalog.length];
            charSelect.value = defaultChar.name;
            starSelect.value = String(defaultChar.start_star);

            charSelect.addEventListener("change", () => onUnitConfigChange(slot));
            starSelect.addEventListener("change", () => onUnitConfigChange(slot));

            onUnitConfigChange(slot);
        });
    }

    function newStatus() {
        return { atkPercentBonus: 0, atkPercentDebuff: 0, debuffUntil: 0, stunUntil: 0, shieldUntil: 0, stackCount: 0 };
    }

    function onUnitConfigChange(slot) {
        const cfg = configEl(slot);
        const name = cfg.querySelector(".dt-char-select").value;
        const star = Number(cfg.querySelector(".dt-star-select").value);
        const catalog = catalogOf(name);
        if (!catalog) return;

        const skillParamsEl = cfg.querySelector(".dt-skill-params");
        const skillMech = catalog.skill_mechanics;
        const starParams = skillMech ? skillMech.params[String(star)] : null;
        skillParamsEl.value = starParams ? JSON.stringify(starParams, null, 2) : "";

        const outfit = catalog.outfits?.["기본"];
        const isMelee = catalog.range === "근거리";
        const style = RANGED_ATTACK_STYLE[name] || (isMelee ? "melee" : "straight");

        // HP/ATK override 입력이 있으면 그 값을, 없으면 실제 서버 공식(STAR_BASE_STATS + 레벨)으로 기본값을 계산한다.
        const level = Number(cfg.querySelector(".dt-level-input").value) || 1;
        const base = computeBaseStats(star, level, isMelee);
        const hpOverride = cfg.querySelector(".dt-hp-input").value;
        const atkOverride = cfg.querySelector(".dt-atk-input").value;
        const maxHp = hpOverride ? Number(hpOverride) : base.hp;
        const atk = atkOverride ? Number(atkOverride) : base.atk;

        units[slot] = {
            name, maxHp, hp: maxHp, atk, isMelee, outfit, style, star,
            attackType: catalog.attack_type || "Student",
            defenseType: catalog.defense_type || "Student",
            gender: catalog.gender,
            status: newStatus(),
            isType2: false, // 이의진 전용: 염색체 변환 스킬로 수동/전투게시 양쪽에서 토글됨(arena-battle.js와 동일)
        };
        advancedSlot[slot] = false;
        clearAllStatusIcons(slot); // 캐릭터/성급이 바뀌면 이전 유닛의 상태 아이콘은 의미가 없으니 지운다

        // 공격/스킬 프레임 개수를 미리 확인해둔다(arena-battle.js와 동일한 이유) - 안 해두면 이 캐릭터가
        // "처음" 스킬을 쓸 때 그제서야 프레임 탐색(최대 9장 순차 404 확인)을 하느라 실제 시간이 걸리고,
        // 그동안 캐스팅 타이머는 그대로 흘러서 애니메이션이 끝까지 재생되지 못하고 잘리는 버그가 있었다.
        getAttackFrameCount(outfit);
        getSkillFrameCount(outfit);
        if (isMelee) {
            getWalkFrameCount(outfit);
        }
        // _type2 변형은 이의진(염색체 변환) 본인만 실제로 쓴다(arena-battle.js와 동일) - 다른
        // 캐릭터에게까지 존재하지도 않는 type2 프레임을 미리 찾아보게 하면 콘솔에 불필요한 404만 남는다.
        if (name === "이의진") {
            getAttackFrameCount(outfit, "_type2");
            getSkillFrameCount(outfit, "_type2");
            if (isMelee) {
                getWalkFrameCount(outfit, "_type2");
            }
        }

        renderUnit(slot);
    }

    // ───────────────────────── 렌더링(정지 화면) ─────────────────────────

    // slot별로 사망 연출을 이미 재생했는지 - 한 번만 재생되도록 막는다.
    const deathHandled = {};

    // 호(자폭 소환수) 전용: playGoldenSelfDestruct가 진행 중인 슬롯은 자기만의 폭발 연출로 캐릭터를
    // 직접 소멸시키므로, playDeathSequence의 기본 사망 스프라이트 전환을 건너뛴다(arena-battle.js와 동일).
    const goldenSelfDestructActive = {};

    // 사망 시: 로그 한 줄 + 사망 디폴트 사진(death${variant}.png, 아직 없으면 idle 사진을 흑백으로
    // 임시 대체) + 투명해지면서 가로 실선 무늬로 스캔되듯 사라지는 연출. (arena-battle.js의
    // playDeathSequence와 동일 - variant는 spriteVariantSuffix로, 윤의 "호" 같은 소환수도 전용
    // 사망 그림을 따로 쓸 수 있다.)
    function playDeathSequence(slot) {
        const unit = units[slot];
        const imgEl = document.querySelector(`[data-unit="${slot}"] .battle-unit-img`);
        if (!unit || !imgEl) return;

        // arena-battle.js의 playDeathSequence와 동일한 이유로 한 틱 미룬다 - 같은 콜백 안에서 이어지는
        // 피해 로그가 먼저 찍히고 그 다음에 사망 로그가 오게 하기 위함.
        setTimeout(() => log(`${unit.name} 사망!`), 0);

        // 호(자폭 소환수): playGoldenSelfDestruct가 이미 캐릭터 자체의 소멸을 맡고 있으므로 로그만
        // 남기고 끝낸다(arena-battle.js와 동일).
        if (goldenSelfDestructActive[slot]) return;

        const variant = spriteVariantSuffix(slot);
        imgEl.classList.remove("death-fallback-filter");
        imgEl.onerror = () => {
            imgEl.onerror = null;
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.png`;
            imgEl.classList.add("death-fallback-filter");
        };
        imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/death${variant}.png`;

        imgEl.classList.add("dying");
    }

    function renderUnit(slot) {
        const unit = units[slot];
        const el = document.querySelector(`[data-unit="${slot}"]`);
        if (!el || !unit) return;

        const isDead = unit.hp <= 0;
        const imgEl = el.querySelector(".battle-unit-img");

        // 히트박스(.battle-unit) 정렬도 현재 방향을 따라간다(arena-battle.js와 동일).
        el.classList.toggle("hitbox-flipped", isFacingFlipped(slot));

        if (isDead) {
            if (imgEl && !deathHandled[slot]) {
                deathHandled[slot] = true;
                playDeathSequence(slot);
                clearAllStatusIcons(slot);
            }
        } else {
            deathHandled[slot] = false;
            goldenSelfDestructActive[slot] = false;

            if (imgEl) {
                // .dying/.golden-self-destruct는 animation-fill-mode:forwards라서 죽었다가 살아난(=슬롯이
                // 재사용된) 유닛에게 그대로 남아있으면 새 스프라이트가 계속 투명하게 보인다 - 반드시 지운다.
                imgEl.classList.remove("dying", "death-fallback-filter", "golden-self-destruct");

                if (!attackAnimActive[slot]) {
                    const variant = spriteVariantSuffix(slot);
                    imgEl.onerror = () => {
                        imgEl.onerror = null;
                        imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.png`;
                    };
                    imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/battle_idle${variant}.png`;
                    imgEl.classList.toggle("flipped", isFacingFlipped(slot)); // 방향은 전투 중 동적으로 바뀔 수 있음
                }
            }
        }

        const hpFillEl = el.querySelector(".dt-unit-hp-fill");
        if (hpFillEl) {
            const percent = Math.max(0, (unit.hp / unit.maxHp) * 100);
            hpFillEl.style.width = `${percent}%`;
        }

        el.classList.toggle("battle-unit-dead", isDead);
    }

    function renderAll() {
        SLOTS.forEach(renderUnit);
    }

    // 이의진처럼 상태(type1/type2)에 따라 다른 스프라이트 파일을 쓰는 캐릭터용(arena-battle.js와 동일).
    // 윤의 "호"처럼 소환수가 시전자와 같은 outfit 폴더를 접미사로만 구분해 쓰는 경우엔
    // units[slot].spriteVariant(clone_sprite_variant)가 우선한다.
    function spriteVariantSuffix(slot) {
        return units[slot]?.spriteVariant || (units[slot]?.isType2 ? "_type2" : "");
    }

    // ───────────────────────── 유닛 선택(클릭) -> 활성 유닛 ─────────────────────────

    function setupUnitSelection() {
        // summon(복제체) 슬롯도 소환된 뒤에는 클릭으로 활성 유닛 선택이 가능해야 한다.
        [...SLOTS, "attacker-summon-front", "attacker-summon-back", "defender-summon-front", "defender-summon-back"].forEach((slot) => {
            const el = document.querySelector(`[data-unit="${slot}"]`);
            if (!el) return;
            el.addEventListener("click", () => {
                if (!units[slot]) return;
                document.querySelectorAll(".battle-unit").forEach((u) => u.classList.remove("dt-selected"));
                el.classList.add("dt-selected");
                activeSlot = slot;
                document.getElementById("dt-active-unit-name").textContent = `${battleDisplayText(units[slot]?.name || slot)} (${slot})`;
            });
        });
    }

    function opponentFrontSlot(slot) {
        return slot.startsWith("attacker") ? "defender-front" : "attacker-front";
    }

    // 최재혁은 ★3부터 후방 적을 우선 공격한다(battle_engine.py의 _select_basic_attack_target과 동일 규칙).
    // 일반 유닛은 적 전방을 향해 걷다가 첫 공격 이벤트로 실제 타겟으로 재조정되지만, 최재혁은 처음부터
    // 실제 목표(후방)를 알고 있으므로 그 재조정("뜸들임")을 건너뛰고 곧장 걸어간다.
    function initialMeleeTargetKey(slot) {
        const enemySide = slot.startsWith("attacker") ? "defender" : "attacker";
        const unit = units[slot];
        if (unit?.name === "최재혁" && (unit.star || 1) >= 3) {
            return `${enemySide}-back`;
        }
        return `${enemySide}-front`;
    }

    function sideOf(slot) {
        return slot.startsWith("attacker") ? "attacker" : "defender";
    }

    // ───────────────────────── 수동 "스킬 사용" 전용 - 실제 효과 계산(battle_engine.py의 13개 핸들러를 그대로 흉내) ─────────────────────────

    function teammateSlot(slot) {
        return slot.endsWith("front") ? slot.replace("front", "back") : slot.replace("back", "front");
    }

    // summon(복제체) 슬롯도 상대 팀의 유효한 대상이다 - front/back과 별개로 존재하는 추가 자리(캐릭터별로 2개까지).
    function enemySlots(slot) {
        const enemySide = slot.startsWith("attacker") ? "defender" : "attacker";
        return [`${enemySide}-front`, `${enemySide}-back`, `${enemySide}-summon-front`, `${enemySide}-summon-back`];
    }

    // front -> back -> summon-front -> summon-back 순서 그대로 - 복제체라고 최우선 타겟이 되지 않는다
    // (battle_engine.py의 _alive_units와 동일한 규칙). 전방이 우선이고, 전방/후방이 모두 죽어야 복제체가 대상이 된다.
    function aliveEnemyUnits(slot) {
        return enemySlots(slot).filter((s) => units[s] && units[s].hp > 0);
    }

    function aliveEnemyTarget(slot) {
        const units_ = aliveEnemyUnits(slot);
        return units_.length ? units_[0] : null;
    }

    function effectiveAtk(slot) {
        const u = units[slot];
        if (!u) return 0;
        const now = performance.now();
        const debuff = u.status.debuffUntil > now ? u.status.atkPercentDebuff : 0;
        return Math.round(u.atk * (1 + u.status.atkPercentBonus / 100 - debuff / 100));
    }

    function applyDamage(targetSlot, amount) {
        const u = units[targetSlot];
        if (!u) return 0;
        if (u.status.shieldUntil > performance.now()) amount = 0;
        amount = Math.max(0, Math.round(amount));
        u.hp = Math.max(0, u.hp - amount);
        return amount;
    }

    // battle_engine.py의 _roll_damage_atk와 동일 - 피해 공식을 쓸 땐 effectiveAtk 대신 이걸로 공격력을
    // 구하면 10% 확률로 치명타(공격력 1.5배)가 함께 적용된다. [공격력, 치명타여부]를 돌려준다.
    function rollDamageAtk(slot) {
        const atk = effectiveAtk(slot);
        const isCrit = Math.random() < CRIT_CHANCE;
        return [isCrit ? Math.round(atk * CRIT_MULTIPLIER) : atk, isCrit];
    }

    function hitVisual(slot, isCrit, typeMultiplier) {
        renderUnit(slot);
        flashHit(slot, isCrit, typeMultiplier);
    }

    // 캐릭터 하나가 이번 성급에 실제 스킬을 갖고 있는지(있으면 {effect_type, params}) 조회 - copy_target_skill(강승유)에서 씀.
    function skillMechanicsOf(name, star) {
        const catalog = catalogOf(name);
        const mech = catalog?.skill_mechanics;
        const params = mech ? mech.params[String(star)] : null;
        return mech && params ? { effectType: mech.effect_type, params } : null;
    }

    const MANUAL_SKILL_HANDLERS = {
        self_stack_buff(casterSlot, params) {
            const u = units[casterSlot];
            if (u.status.stackCount < params.max_stacks) u.status.stackCount += 1;
            u.status.atkPercentBonus = u.status.stackCount * params.percent_per_stack;
            return { text: `공격력 +${u.status.atkPercentBonus}% (스택 ${u.status.stackCount})` };
        },

        summon_clone(casterSlot, params) {
            // 복제체는 기존 전방/후방 아군을 대체하지 않는 추가 유닛 - 캐스터 본인 전용 summon 슬롯에 매번
            // 새로 생성한다(caster가 front/back 어느 쪽인지에 따라 summon-front/summon-back을 쓰므로, 같은
            // 팀에 summon_clone을 쓰는 캐릭터가 둘이어도 서로의 복제체를 밀어내지 않는다. 재시전 시 자기
            // 자리에 있던 이전 복제체만 교체되고, 살아있는 아군은 절대 제거되지 않는다 - arena-battle.js와 동일).
            const side = sideOf(casterSlot);
            const cloneSlot = `${side}-summon-${casterSlot.endsWith("front") ? "front" : "back"}`;
            const replaced = units[cloneSlot];

            const caster = units[casterSlot];
            const cloneMaxHp = Math.round(caster.maxHp * params.hp_percent / 100);
            const cloneAtk = Math.round(caster.atk * params.atk_percent / 100);
            units[cloneSlot] = {
                // clone_name이 있으면(윤의 "호") 그 이름을 쓴다 - 없으면(대부분의 소환수) 기존처럼 "OO의 복제체".
                name: params.clone_name || `${caster.name}의 복제체`,
                maxHp: cloneMaxHp, hp: cloneMaxHp, atk: cloneAtk,
                isMelee: caster.isMelee,
                // clone_sprite_outfit이 있으면(윤의 "호") 캐스터가 누구든(강승유가 복제해도) 항상 이
                // outfit 폴더의 그림을 쓴다(arena-battle.js summon_clone 핸들러와 동일).
                outfit: params.clone_sprite_outfit || caster.outfit,
                style: caster.style,
                attackType: caster.attackType, defenseType: caster.defenseType, gender: caster.gender,
                status: newStatus(), isClone: true,
                // 아래 넷은 arena-battle.js의 summon_clone 이벤트 핸들러와 동일한 의미(spriteVariantSuffix,
                // getGapToTarget, dt-basic-attack의 자폭 처리, is-clone 틴트 조건이 각각 참고).
                spriteVariant: params.clone_sprite_variant || "",
                meleeOverlapPercent: params.clone_melee_overlap_percent || null,
                selfDestructAfterAttack: Boolean(params.clone_self_destruct),
                isCopy: Boolean(params._isCopy),
            };

            const cloneEl = document.querySelector(`[data-unit="${cloneSlot}"]`);
            const casterEl = document.querySelector(`[data-unit="${casterSlot}"]`);
            // 복제체는 캐스터 본인이 서 있는 바로 그 자리에 생성된다.
            if (cloneEl) {
                cloneEl.hidden = false;
                cloneEl.style.transform = ""; // 이전 복제체가 남긴 인라인 transform이 있으면 먼저 지운다
                // getCurrentTranslateX로 "리셋된 CSS 기본값 포함 현재 translateX"를 읽어서 그 위에 델타를
                // 더해야 한다 - 절대값으로 통째로 덮어쓰면 summon 슬롯의 CSS 기본 transform(칸 밖으로
                // 빼두는 값)이 상쇄되지 않고 그대로 더 얹혀서 엉뚱한 자리에 생성된다.
                if (casterEl) {
                    const cloneRect = cloneEl.getBoundingClientRect();
                    const casterRect = casterEl.getBoundingClientRect();
                    const currentCloneX = getCurrentTranslateX(cloneEl);
                    cloneEl.style.transform = `translateX(${currentCloneX + (casterRect.left - cloneRect.left)}px)`;

                    // 캐스터는 복제체가 자기 자리를 차지한 만큼, 자기 자신의 스프라이트 너비만큼 뒤로
                    // 밀려난다(서로 겹치지 않게) - 청년의 넉백(applyKnockback)과 완전히 같은 방식(부드러운 CSS
                    // 트랜지션 + 넉백(CC기) 오라/아이콘, arena-battle.js와 동일). suspendSelfWalker 덕분에
                    // 트랜지션이 끝나자마자 walker가 깨어나 원래 근접 거리를 목표로 자연스럽게 다시 걸어오므로
                    // 별도의 "복귀" 연출은 필요 없다.
                    flashEffectAura(casterSlot, "cc");
                    setStatusIcon(casterSlot, "knockback", { source: `${casterSlot}:knockback`, durationMs: MOMENT_ICON_MS });
                    // 팀 기준 고정 방향이 아니라 지금 보고 있는 방향의 반대로 밀려난다(arena-battle.js와 동일).
                    const summonKnockDir = isFacingFlipped(casterSlot) ? 1 : -1;
                    applyKnockback(casterSlot, {
                        distance: casterRect.width,
                        durationMs: 380,
                        suspendSelfWalker: true,
                        knockDir: summonKnockDir,
                    });
                }
            }
            // 이전 점유자의 잔여 루프/체인/대기 상태를 전부 정리한다(arena-battle.js와 동일한 이유).
            attackAnimTokens[cloneSlot] = (attackAnimTokens[cloneSlot] || 0) + 1;
            attackAnimActive[cloneSlot] = false;
            rangedResolvePending[cloneSlot] = false;
            meleeHitPending[cloneSlot] = false;
            delete actorAnimChain[cloneSlot];
            delete walkerSuspended[cloneSlot];
            getAttackFrameCount(units[cloneSlot].outfit);
            renderUnit(cloneSlot);
            // "복제" 계열(전용 스프라이트가 없거나, 강승유가 복제해서 만든 경우)만 파란 홀로그램 틴트를
            // 씌운다 - 윤의 "호"는 소환이라 자기 그림 그대로(arena-battle.js summon_clone 핸들러와 동일 조건).
            document.querySelector(`[data-unit="${cloneSlot}"] .battle-unit-img`)
                ?.classList.toggle("is-clone", !units[cloneSlot].spriteVariant || units[cloneSlot].isCopy);
            // 호처럼 다른 스프라이트와 겹쳐도 항상 위에 그려져야 하는 소환수(arena-battle.js와 동일).
            document.querySelector(`[data-unit="${cloneSlot}"]`)
                ?.classList.toggle("render-on-top", Boolean(params.clone_render_on_top));

            // 근거리 복제체는 다른 근접 유닛과 완전히 동일하게 취급한다 - meleeArrived를 false로 두면
            // 이동 루프(tick)가 다음 프레임에 실제 겹침 여부를 직접 재서 판정하고, 도착으로 확인되는
            // 순간에만 faceToward를 걸고 공격을 허용한다(waitForMeleeArrival이 그 전까지 공격을 막음,
            // arena-battle.js와 동일). 이제 캐스터 자리에서 스폰되므로 실제로 걸어서 접근하는 과정을 거친다.
            if (units[cloneSlot].isMelee) {
                const enemyFrontSlot = opponentFrontSlot(casterSlot);
                meleeTargetKey[cloneSlot] = enemyFrontSlot;
                meleeArrived[cloneSlot] = false;
                if (!walkerRunning) startMeleeWalker();
            }

            return {
                text: replaced
                    ? `${units[cloneSlot].name}가 새로운 개체로 교체 소환됨! (HP ${cloneMaxHp} / ATK ${cloneAtk})`
                    : `${units[cloneSlot].name}가 전장에 추가로 소환됨! (HP ${cloneMaxHp} / ATK ${cloneAtk})`,
            };
        },

        conditional_target_debuff(casterSlot, params) {
            const targetSlot = aliveEnemyTarget(casterSlot);
            if (!targetSlot) return { text: "대상 없음" };
            const target = units[targetSlot];
            const now = performance.now();

            // 공격 속도 증가는 대상 성별과 무관하게 항상 적용된다. 기절만 대상이 여성일 때 조건부로 걸린다.
            const caster = units[casterSlot];
            caster.status.hasteUntil = now + params.haste_seconds * 1000; // (수동 모드는 단발성이라 표시용 - 실시간 공격주기엔 반영 안 됨)
            caster.status.hastePercent = params.haste_percent;

            const conditionMet = params.condition !== "target_gender_female" || effectiveGender(target.name, targetSlot) === "여";
            if (conditionMet) {
                target.status.stunUntil = now + params.stun_seconds * 1000;
                renderUnit(targetSlot);
            }

            return {
                text: conditionMet
                    ? `${target.name} ${params.stun_seconds}초 기절 + 자신 공속 ${params.haste_percent}% 증가`
                    : `${target.name}은(는) 여성이 아니라 기절 없음 (자신 공속 ${params.haste_percent}% 증가는 적용됨)`,
                targetSlot, stunned: conditionMet,
            };
        },

        heal_ally_percent_max_hp(casterSlot, params) {
            const allySlot = teammateSlot(casterSlot);
            const ally = units[allySlot];
            if (!ally || ally.hp <= 0) return { text: "회복 대상 없음" };
            const heal = Math.round(ally.maxHp * params.percent / 100);
            ally.hp = Math.min(ally.maxHp, ally.hp + heal);
            renderUnit(allySlot);
            return { text: `${ally.name} 체력 ${heal} 회복`, targetSlot: allySlot };
        },

        self_shield_duration(casterSlot, params) {
            units[casterSlot].status.shieldUntil = performance.now() + params.seconds * 1000;
            return { text: `${params.seconds}초간 무적 실드` };
        },

        // 이의진 "염색체 변환": attack_type을 Student(type1)<->Parent(type2) 사이로 토글하고 자힐.
        // battle_engine.py의 _skill_self_type_swap_heal과 동일 규칙(isType2 = Parent 상태).
        self_type_swap_heal(casterSlot, params) {
            const caster = units[casterSlot];
            const newType = caster.attackType === "Student" ? "Parent" : "Student";
            caster.attackType = newType;
            caster.isType2 = newType === "Parent";
            caster.status.type2StunSeconds = caster.isType2 ? params.type2_stun_seconds : 0;
            const heal = Math.round(caster.maxHp * params.heal_percent / 100);
            caster.hp = Math.min(caster.maxHp, caster.hp + heal);
            renderUnit(casterSlot);
            return {
                text: `${caster.isType2 ? "type2(여)" : "type1(남)"}로 전환, 체력 ${heal} 회복`,
                newAttackType: newType, type2Active: caster.isType2,
            };
        },

        bonus_damage_knockback(casterSlot, params) {
            const targetSlot = aliveEnemyTarget(casterSlot);
            if (!targetSlot) return { text: "대상 없음" };
            const typeMult = getTypeMultiplier(units[casterSlot].attackType, units[targetSlot].defenseType);
            const [atk, isCrit] = rollDamageAtk(casterSlot);
            const damage = atk * params.multiplier / 100 * typeMult;
            const dealt = applyDamage(targetSlot, damage);
            hitVisual(targetSlot, isCrit, typeMult);
            return { text: `${units[targetSlot].name}에게 ${dealt} 피해(밀쳐내기)${isCrit ? " 치명타!" : ""}`, targetSlot };
        },

        aoe_gendered_damage(casterSlot, params) {
            const caster = units[casterSlot];
            const parts = [];
            const hits = [];
            aliveEnemyUnits(casterSlot).forEach((slot) => {
                const t = units[slot];
                const gender = effectiveGender(t.name, slot);
                const mult = gender === "여" ? params.female_multiplier : params.male_multiplier;
                const typeMult = getTypeMultiplier(caster.attackType, t.defenseType);
                const [atk, isCrit] = rollDamageAtk(casterSlot);
                const dealt = applyDamage(slot, atk * mult / 100 * typeMult);
                hitVisual(slot, isCrit, typeMult);
                parts.push(`${t.name} ${dealt}${isCrit ? "(치명타!)" : ""}`);
                hits.push({ targetSlot: slot, gender });
            });
            return { text: `광역 피해: ${parts.join(", ") || "대상 없음"}`, hits };
        },

        copy_target_skill(casterSlot, params) {
            const targetSlot = aliveEnemyTarget(casterSlot);
            if (!targetSlot) return { text: "대상 없음" };
            const targetName = units[targetSlot].name.split("의 복제체")[0];
            const targetStar = Number(configEl(targetSlot)?.querySelector(".dt-star-select")?.value);
            const copied = skillMechanicsOf(targetName, targetStar);

            if (copied && MANUAL_SKILL_HANDLERS[copied.effectType]) {
                const potency = params.potency_percent / 100;
                const scaledParams = {};
                Object.entries(copied.params).forEach(([k, v]) => { scaledParams[k] = typeof v === "number" ? v * potency : v; });
                // 윤의 "호"처럼 clone_copy_stat_percent가 있는 소환 스킬을 복제하면, 강승유 자신의 위력
                // 복제율(potency)과는 별개로 체력/공격력 배율만 한 번 더 이 비율만큼 줄인다(skill_handlers.py의
                // _skill_copy_target_skill과 동일한 이유 - 원본이 직접 소환할 때는 이 값을 안 읽으므로 영향
                // 없음). 위력 복제율에 또 깎이지 않도록 복제 "전" 원본 copied.params에서 읽는다.
                const copyStatPercent = copied.params.clone_copy_stat_percent;
                if (copyStatPercent) {
                    const statFactor = copyStatPercent / 100;
                    if ("hp_percent" in scaledParams) scaledParams.hp_percent *= statFactor;
                    if ("atk_percent" in scaledParams) scaledParams.atk_percent *= statFactor;
                }
                // 복제로 만들어진 결과물임을 표시 - summon_clone 핸들러가 이걸 보고 "소환"이 아니라 "복제"로
                // 취급해 자기 스프라이트(spriteVariant)가 있어도 파란 홀로그램 틴트를 씌운다.
                scaledParams._isCopy = true;
                const result = MANUAL_SKILL_HANDLERS[copied.effectType](casterSlot, scaledParams);
                // targetSlot/hits/stunned 등 원본 핸들러의 결과 필드를 그대로 물려줘야, 바깥 dispatch(setupSkillButton)가
                // 복제된 스킬의 실제 전용 연출(투사체/실드링/치유하트 등)을 원본과 동일하게 재생할 수 있다.
                return { ...result, text: `[${copied.effectType} 복제] ${result.text}`, copiedEffectType: copied.effectType };
            }

            const typeMult = getTypeMultiplier(units[casterSlot].attackType, units[targetSlot].defenseType);
            const [atk, isCrit] = rollDamageAtk(casterSlot);
            const dealt = applyDamage(targetSlot, atk * params.fallback_multiplier / 100 * typeMult);
            hitVisual(targetSlot, isCrit, typeMult);
            return { text: `복제할 스킬 없음 - ${units[targetSlot].name}에게 ${dealt} 피해${isCrit ? " 치명타!" : ""}` };
        },

        stun_target(casterSlot, params) {
            const targetSlot = aliveEnemyTarget(casterSlot);
            if (!targetSlot) return { text: "대상 없음" };
            units[targetSlot].status.stunUntil = performance.now() + params.seconds * 1000;
            renderUnit(targetSlot);
            // 송주헌 "격차 벌리기": multiplier가 있으면 기절과 함께 피해도 준다.
            if (params.multiplier) {
                const caster = units[casterSlot];
                const target = units[targetSlot];
                const typeMult = getTypeMultiplier(caster.attackType, target.defenseType);
                const [atk, isCrit] = rollDamageAtk(casterSlot);
                const dealt = applyDamage(targetSlot, atk * params.multiplier / 100 * typeMult);
                hitVisual(targetSlot, isCrit, typeMult);
                return { text: `${target.name} ${params.seconds}초 기절, 피해 ${dealt}${isCrit ? "(치명타!)" : ""}`, targetSlot };
            }
            return { text: `${units[targetSlot].name} ${params.seconds}초 기절`, targetSlot };
        },

        aoe_enemy_damage(casterSlot, params) {
            const caster = units[casterSlot];
            const parts = [];
            aliveEnemyUnits(casterSlot).forEach((slot) => {
                const t = units[slot];
                const typeMult = getTypeMultiplier(caster.attackType, t.defenseType);
                const [atk, isCrit] = rollDamageAtk(casterSlot);
                const dealt = applyDamage(slot, atk * params.multiplier / 100 * typeMult);
                hitVisual(slot, isCrit, typeMult);
                parts.push(`${t.name} ${dealt}${isCrit ? "(치명타!)" : ""}`);
            });
            return { text: `적 전체 피해: ${parts.join(", ") || "대상 없음"}` };
        },

        damage_hp_percent_plus_atk(casterSlot, params) {
            const targetSlot = aliveEnemyTarget(casterSlot);
            if (!targetSlot) return { text: "대상 없음" };
            const target = units[targetSlot];
            const [atk, isCrit] = rollDamageAtk(casterSlot);
            const damage = target.hp * params.hp_percent / 100 + atk * params.atk_percent / 100;
            const dealt = applyDamage(targetSlot, damage);
            hitVisual(targetSlot, isCrit);
            return { text: `${target.name}에게 ${dealt} 피해${isCrit ? " 치명타!" : ""}`, targetSlot };
        },

        debuff_atk_and_damage(casterSlot, params) {
            const targetSlot = aliveEnemyTarget(casterSlot);
            if (!targetSlot) return { text: "대상 없음" };
            const target = units[targetSlot];
            target.status.atkPercentDebuff = params.atk_debuff_percent;
            target.status.debuffUntil = performance.now() + params.debuff_seconds * 1000;
            const typeMult = getTypeMultiplier(units[casterSlot].attackType, target.defenseType);
            const [atk, isCrit] = rollDamageAtk(casterSlot);
            const dealt = applyDamage(targetSlot, atk * params.multiplier / 100 * typeMult);
            hitVisual(targetSlot, isCrit, typeMult);
            return { text: `${target.name} 공격력 -${params.atk_debuff_percent}% + ${dealt} 피해${isCrit ? " 치명타!" : ""}`, targetSlot };
        },

        aoe_all_others_damage(casterSlot, params) {
            const caster = units[casterSlot];
            const parts = [];
            const allySlot = teammateSlot(casterSlot);
            if (units[allySlot] && units[allySlot].hp > 0) {
                const [atk, isCrit] = rollDamageAtk(casterSlot);
                const dealt = applyDamage(allySlot, atk * params.multiplier / 100);
                hitVisual(allySlot, isCrit);
                parts.push(`${units[allySlot].name} ${dealt}${isCrit ? "(치명타!)" : ""}`);
            }
            aliveEnemyUnits(casterSlot).forEach((slot) => {
                const t = units[slot];
                const typeMult = getTypeMultiplier(caster.attackType, t.defenseType);
                const [atk, isCrit] = rollDamageAtk(casterSlot);
                const dealt = applyDamage(slot, atk * params.multiplier / 100 * typeMult);
                hitVisual(slot, isCrit, typeMult);
                parts.push(`${t.name} ${dealt}${isCrit ? "(치명타!)" : ""}`);
            });
            return { text: `자신 제외 전원 피해: ${parts.join(", ") || "대상 없음"}` };
        },
    };

    // ───────────────────────── 공격 프레임(근거리 기본 연출, 원거리 공용 프레임 재생) ─────────────────────────

    function checkImageExists(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
        });
    }

    // variant("" 또는 "_type2")는 이의진처럼 상태별로 다른 프레임 세트를 쓰는 캐릭터용 - 캐시 키도
    // variant별로 따로 둔다(arena-battle.js와 동일).
    async function getAttackFrameCount(outfit, variant = "") {
        const cacheKey = `${outfit}${variant}`;
        if (frameCountCache[cacheKey] !== undefined) return frameCountCache[cacheKey];
        let count = 0;
        for (let i = 1; i <= MAX_ATTACK_FRAMES; i += 1) {
            const exists = await checkImageExists(`${OUTFIT_IMAGE_BASE}${outfit}/attack${variant}_${i}.png`);
            if (!exists) break;
            count = i;
        }
        frameCountCache[cacheKey] = count;
        return count;
    }

    // 시전 전용 프레임(skill_N.png)이 있는지 확인 - attack_N.png와 같은 규칙, outfit당 한 번만 확인 후 캐시.
    async function getSkillFrameCount(outfit, variant = "") {
        const cacheKey = `${outfit}${variant}`;
        if (skillFrameCountCache[cacheKey] !== undefined) return skillFrameCountCache[cacheKey];
        let count = 0;
        for (let i = 1; i <= MAX_SKILL_FRAMES; i += 1) {
            const exists = await checkImageExists(`${OUTFIT_IMAGE_BASE}${outfit}/skill${variant}_${i}.png`);
            if (!exists) break;
            count = i;
        }
        skillFrameCountCache[cacheKey] = count;
        return count;
    }

    // 걷기 전용 프레임(walk_N.png)이 있는지 확인 - attack_N.png와 같은 규칙(arena-battle.js와 동일).
    async function getWalkFrameCount(outfit, variant = "") {
        const cacheKey = `${outfit}${variant}`;
        if (walkFrameCountCache[cacheKey] !== undefined) return walkFrameCountCache[cacheKey];
        let count = 0;
        for (let i = 1; i <= MAX_WALK_FRAMES; i += 1) {
            const exists = await checkImageExists(`${OUTFIT_IMAGE_BASE}${outfit}/walk${variant}_${i}.png`);
            if (!exists) break;
            count = i;
        }
        walkFrameCountCache[cacheKey] = count;
        return count;
    }

    // 근거리 유닛이 걷는 동안(startMeleeWalker의 tick) 반복 재생되는 걷기 프레임 애니메이션(arena-battle.js와 동일).
    async function playWalkFrames(slot) {
        const el = document.querySelector(`[data-unit="${slot}"]`);
        const imgEl = el?.querySelector(".battle-unit-img");
        const unit = units[slot];
        if (!el || !imgEl || !unit) return;

        const variant = spriteVariantSuffix(slot);
        const myToken = (walkAnimTokens[slot] = (walkAnimTokens[slot] || 0) + 1);
        const frameCount = await getWalkFrameCount(unit.outfit, variant);
        if (walkAnimTokens[slot] !== myToken) return;

        // 걷기 전용 사진이 없는 캐릭터 - 사진은 그대로 두고 CSS bob 애니메이션(walking 클래스)만 적용된 채로 걷는다.
        if (frameCount === 0) return;

        let frameIndex = 1;
        while (walkAnimTokens[slot] === myToken) {
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/walk${variant}_${frameIndex}.png`;
            await sleep(WALK_FRAME_DURATION_MS);
            frameIndex = (frameIndex % frameCount) + 1;
        }
    }

    function stopWalkFrames(slot) {
        walkAnimTokens[slot] = (walkAnimTokens[slot] || 0) + 1;
        walkAnimActive[slot] = false;
    }

    async function playAttackFrames(slot) {
        const el = document.querySelector(`[data-unit="${slot}"]`);
        const imgEl = el?.querySelector(".battle-unit-img");
        const unit = units[slot];
        if (!el || !imgEl || !unit) return;

        const variant = spriteVariantSuffix(slot);
        const myToken = (attackAnimTokens[slot] = (attackAnimTokens[slot] || 0) + 1);
        attackAnimActive[slot] = true;
        const frameCount = await getAttackFrameCount(unit.outfit, variant);
        if (attackAnimTokens[slot] !== myToken) return;

        if (frameCount === 0) {
            imgEl.classList.add("attacking");
            setTimeout(() => {
                imgEl.classList.remove("attacking");
                attackAnimActive[slot] = false;
            }, 300);
            return;
        }

        for (let i = 1; i <= frameCount; i += 1) {
            if (attackAnimTokens[slot] !== myToken) return;
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/attack${variant}_${i}.png`;
            await sleep(ATTACK_FRAME_DURATION_MS);
        }

        if (attackAnimTokens[slot] === myToken) {
            // battle_idle 파일이 없는 캐릭터/의상 조합이면 idle.png로 대체한다(arena-battle.js와 동일).
            imgEl.onerror = () => {
                imgEl.onerror = null;
                imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.png`;
            };
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/battle_idle${variant}.png`;
            attackAnimActive[slot] = false;
        }
    }

    /*
     * 시전(캐스팅) 중 재생되는 프레임 애니메이션. 스킬 전용 프레임(skill_N.png)이 있으면 그걸 우선 쓰고,
     * 없으면 기본공격 프레임(attack_N.png)을 그대로 돌려쓴다. 짧은 프레임 묶음을 빠르게 반복 재생하는
     * 대신, 가진 프레임 수만큼을 시전 시간(durationMs) 전체에 고르게 늘려서 "한 번만" 재생한다 -
     * 그래서 시전이 길수록 프레임 하나하나가 더 천천히 넘어가고, 루프하는 느낌 없이 시전 시작부터
     * 끝까지 이어지는 애니메이션처럼 보인다.
     */
    async function playCastFrames(slot, durationMs) {
        const el = document.querySelector(`[data-unit="${slot}"]`);
        const imgEl = el?.querySelector(".battle-unit-img");
        const unit = units[slot];
        if (!el || !imgEl || !unit) return;

        const variant = spriteVariantSuffix(slot);
        const myToken = (attackAnimTokens[slot] = (attackAnimTokens[slot] || 0) + 1);
        attackAnimActive[slot] = true;

        // 프레임 스케줄의 기준 시각은 프레임 개수 조회 "전"에 찍는다(arena-battle.js와 동일한 이유) -
        // skill_resolve(실제 스킬 발동) 타이밍은 시전이 시작된 시점 + 시전 시간으로 계산되는데, 이
        // 캐릭터가 전투에서 처음 시전해서 getSkillFrameCount/getAttackFrameCount가 캐시 없이 이미지를
        // 실제로 로드해봐야 하는 경우 그 조회 시간만큼 기준이 늦게 찍히면, 스킬 발동이 마지막 시전
        // 프레임보다 먼저 일어나는 것처럼 보이는 어긋남이 생긴다.
        let castStartMs = performance.now();

        const skillFrameCount = await getSkillFrameCount(unit.outfit, variant);
        const usingSkillFrames = skillFrameCount > 0;
        const frameCount = usingSkillFrames ? skillFrameCount : await getAttackFrameCount(unit.outfit, variant);
        const framePrefix = usingSkillFrames ? "skill" : "attack";

        if (attackAnimTokens[slot] !== myToken) return; // 다른 호출이 이미 새 토큰을 발급함 - 그쪽 상태를 건드리지 않는다

        // 조회가 시전 시간을 전부 잡아먹었으면(캐시 미스) 아래 루프의 모든 sleep이 건너뛰어져 프레임이
        // 렌더링될 틈도 없이 마지막 프레임으로 순간이동해버린다(=애니메이션이 재생 안 된 것처럼 보임) -
        // arena-battle.js와 동일하게, 이 드문 경우엔 지금부터 다시 durationMs를 온전히 확보한다.
        if (performance.now() - castStartMs >= durationMs) {
            castStartMs = performance.now();
        }

        if (frameCount === 0) {
            // 스킬/공격 프레임 이미지가 아예 없는 캐릭터는 기존처럼 펄스 글로우만으로 시전 표시.
            // attackAnimActive는 꺼둬야 한다 - skill_resolve 처리 시작부의 대기 게이트가 이 값을 보고
            // 재시도하는데, 여기서 안 꺼두면 그 게이트를 영영 통과 못 해서 재생이 완전히 멈춘다.
            attackAnimActive[slot] = false;
            return;
        }

        const perFrameMs = durationMs / frameCount;
        // 절대 시각 기준으로 스케줄한다(arena-battle.js와 동일한 이유) - 프레임마다 상대 시간으로
        // sleep을 걸면 setTimeout 오차가 프레임 수만큼 누적돼서, 프레임이 많을수록 실제 재생이 서버
        // 시전 시간보다 점점 길어지고 skill_resolve 처리가 늦어진다.
        for (let i = 1; i <= frameCount; i += 1) {
            if (attackAnimTokens[slot] !== myToken) return; // 다른 호출이 이미 새 토큰을 발급함 - 그쪽 상태를 건드리지 않는다
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/${framePrefix}${variant}_${i}.png`;
            const remainingMs = castStartMs + perFrameMs * i - performance.now();
            if (remainingMs > 0) await sleep(remainingMs);
        }

        // 시전 프레임 루프가 끝났으니 skill_resolve 처리를 막던 게이트는 풀어준다(안 그러면 위와
        // 같은 이유로 멈춘다) - 다만 화면(스프라이트)은 마지막 프레임에 그대로 멈춰 둔다. 여기서
        // 곧바로 idle로 스냅하면 이 루프의 타이머와 실제 skill_resolve 처리 시점이 살짝만 어긋나도
        // idle로 풀렸다가 skill_resolve가 다시 풀어주는 이중 전환이 생긴다(arena-battle.js와 동일한 이유).
        if (attackAnimTokens[slot] === myToken) {
            attackAnimActive[slot] = false;
        }
    }

    // Active 시전 중 기절/넉백 등으로 시전이 취소됐을 때 호출한다(백엔드가 발동 자체를 건너뛰므로
    // skill_resolve 이벤트가 아예 오지 않는다 - arena-battle.js와 동일한 이유).
    function interruptCasting(slot) {
        if (!slot || !units[slot]) return;
        attackAnimTokens[slot] = (attackAnimTokens[slot] || 0) + 1;
        attackAnimActive[slot] = false;
        const imgEl = document.querySelector(`[data-unit="${slot}"] .battle-unit-img`);
        if (imgEl) {
            imgEl.classList.remove("casting", "casting-rainbow");
            imgEl.onerror = null;
            imgEl.src = `${OUTFIT_IMAGE_BASE}${units[slot].outfit}/battle_idle${spriteVariantSuffix(slot)}.png`;
        }
        flashEffectAura(slot, "cc");
        log(`[특성] ${units[slot].name}의 시전이 기절로 취소됐다!`);
    }

    // 투사체/캔버스 연출이 실제로 대상에 "도착"하는 순간까지 화면 반영을 늦추는 스킬 전용
    // (arena-battle.js와 동일) - HP는 이 함수로 이벤트 처리 시점에 곧바로 반영하고, 그 직전에 이미
    // 죽어있었는지도 함께 캡처해서 반환한다. 도착 콜백은 이 반환값이 true면 렌더/이펙트를 건너뛰어야
    // 한다 - 안 그러면 그 사이 다른(더 빠른) 이벤트가 같은 대상을 먼저 죽였을 때, 뒤늦게 도착한 연출이
    // 죽기 전의 과거 HP로 덮어써서 이미 쓰러진 캐릭터가 되살아나 보이는 버그가 생긴다.
    function captureAndApplyHp(slot, newHp) {
        if (!slot || !units[slot]) return true;
        const wasAlreadyDead = units[slot].hp <= 0;
        units[slot].hp = newHp;
        return wasAlreadyDead;
    }

    // 치명타 시 대상 머리 위에 "치명타!" 글자가 튀어오르듯 잠깐 떴다 사라진다.
    function showCritLabel(slot) {
        const layer = document.getElementById("projectile-layer");
        const imgEl = document.querySelector(`[data-unit="${slot}"] .battle-unit-img`);
        if (!layer || !imgEl) return;
        const pos = fieldRelativeCenter(imgEl);
        const label = document.createElement("div");
        label.className = "crit-label";
        label.textContent = "치명타!";
        label.style.left = `${pos.x}px`;
        label.style.top = `${pos.y - 46}px`;
        layer.appendChild(label);
        setTimeout(() => label.remove(), 700);
    }

    // 상성(유형 상성) 적중 시 대상 머리 위에 "Weak"(유리, 빨강)/"Resist"(불리, 파랑) 글자를 띄운다(arena-battle.js와 동일).
    function showTypeLabel(slot, kind) {
        const layer = document.getElementById("projectile-layer");
        const imgEl = document.querySelector(`[data-unit="${slot}"] .battle-unit-img`);
        if (!layer || !imgEl) return;
        const pos = fieldRelativeCenter(imgEl);
        const label = document.createElement("div");
        label.className = `type-label type-${kind}`;
        label.textContent = kind === "weak" ? "Weak" : "Resist";
        label.style.left = `${pos.x}px`;
        label.style.top = `${pos.y - 62}px`;
        layer.appendChild(label);
        setTimeout(() => label.remove(), 700);
    }

    function flashHit(slot, isCrit, typeMultiplier) {
        const imgEl = document.querySelector(`[data-unit="${slot}"] .battle-unit-img`);
        if (!imgEl) return;
        if (typeof typeMultiplier === "number") {
            if (typeMultiplier > 1) showTypeLabel(slot, "weak");
            else if (typeMultiplier < 1) showTypeLabel(slot, "resist");
        }
        if (isCrit) {
            imgEl.classList.add("crit-flash");
            showCritLabel(slot);
            setTimeout(() => imgEl.classList.remove("crit-flash"), 400);
            return;
        }
        imgEl.classList.add("hit-flash");
        setTimeout(() => imgEl.classList.remove("hit-flash"), 250);
    }

    // ===== 효과 수신자 오라(arena-battle.js와 동일) =====
    // 스킬 발동 순간 시전자가 카테고리 색으로 번쩍이던 예전 연출 대신, 효과를 "받은" 대상에게
    // 색 오라가 나왔다가 사라진다. CSS(.effect-aura-flash, arena-battle.css)를 그대로 재사용한다.
    const EFFECT_AURA_COLORS = {
        buff: "#ff4d3d", debuff: "#4d8bff", cc: "#b266ff", heal: "#4ee06a", special: "#ffffff",
    };
    function flashEffectAura(slot, kind) {
        const imgEl = document.querySelector(`[data-unit="${slot}"] .battle-unit-img`);
        const color = EFFECT_AURA_COLORS[kind];
        if (!imgEl || !color) return;
        imgEl.classList.remove("effect-aura-flash");
        void imgEl.offsetWidth;
        imgEl.style.setProperty("--effect-aura-color", color);
        imgEl.classList.add("effect-aura-flash");
    }

    // ===== 상태 아이콘(체력바 위, 왼쪽부터 채워짐) - arena-battle.js와 동일한 source-map 방식 =====
    // xN 배지는 서로 다른 원인이 동시에 겹칠 때만 오르고, 같은 원인의 반복(갱신)은 카운트를 늘리지 않는다.
    const STATUS_ICON_FILES = {
        atk_up: "Combat_Icon_Buff_ATK.png", maxhp_up: "Combat_Icon_Buff_MAXHP.png",
        atk_speed_up: "Combat_Icon_Buff_AttackSpeed.png", crit_up: "Combat_Icon_Buff_CriticalDamage.png",
        crit_chance_up: "Combat_Icon_Buff_CriticalChance.png", rear_priority: "Combat_Icon_Special_AttackRear.png",
        atk_down: "Combat_Icon_Debuff_ATK.png",
        maxhp_down: "Combat_Icon_Debuff_MAXHP.png", stun: "Combat_Icon_CC_Stunned.png",
        knockback: "Combat_Icon_CC_Knockback.png", heal: "Combat_Icon_Recovery_Heal.png",
        immune: "Combat_Icon_Special_ImmuneDamage.png",
        paint_red: "Combat_Icon_Special_InkRed.png", paint_blue: "Combat_Icon_Special_InkBlue.png",
        paint_yellow: "Combat_Icon_Special_InkYellow.png", damage_reduction: "Combat_Icon_Buff_DamageRatio.png",
        lifesteal: "Combat_Icon_Special_Lifesteal.png", // 윤 "선생 고혈" - 공격 대상이 선생 타입인 동안(흡혈)
    };
    const MOMENT_ICON_MS = 1200;
    const statusIconState = {}; // slot -> { iconId: { el, sources: Map<sourceKey, {weight, timer}> } }

    function renderStatusIconTotal(slot, iconId) {
        const entry = statusIconState[slot]?.[iconId];
        if (!entry) return;
        const total = [...entry.sources.values()].reduce((sum, s) => sum + s.weight, 0);
        const stackEl = entry.el.querySelector(".roster-status-stack");
        if (stackEl) { stackEl.hidden = total < 2; stackEl.textContent = `x${total}`; }
    }

    function setStatusIcon(slot, iconId, opts = {}) {
        const wrap = document.querySelector(`[data-unit="${slot}"] .dt-status-icons`);
        const file = STATUS_ICON_FILES[iconId];
        if (!wrap || !file) return;

        const state = (statusIconState[slot] = statusIconState[slot] || {});
        let entry = state[iconId];
        if (!entry) {
            const el = document.createElement("span");
            el.className = "roster-status-icon status-icon-pop";
            el.innerHTML = `<img src="assets/arena/${file}" alt=""><span class="roster-status-stack" hidden></span>`;
            wrap.appendChild(el);
            entry = state[iconId] = { el, sources: new Map() };
        }

        const sourceKey = opts.source || "__shared__";
        const weight = opts.weight !== undefined ? opts.weight : 1;
        let source = entry.sources.get(sourceKey);
        if (!source) {
            source = { weight, timer: null };
            entry.sources.set(sourceKey, source);
        } else {
            source.weight = weight;
        }

        if (source.timer) { clearTimeout(source.timer); source.timer = null; }
        if (opts.durationMs) {
            source.timer = setTimeout(() => clearStatusIconSource(slot, iconId, sourceKey), opts.durationMs);
        }
        renderStatusIconTotal(slot, iconId);
    }

    function clearStatusIconSource(slot, iconId, sourceKey) {
        const entry = statusIconState[slot]?.[iconId];
        const source = entry?.sources.get(sourceKey);
        if (!entry || !source) return;
        if (source.timer) clearTimeout(source.timer);
        entry.sources.delete(sourceKey);
        if (entry.sources.size === 0) {
            entry.el.remove();
            delete statusIconState[slot][iconId];
        } else {
            renderStatusIconTotal(slot, iconId);
        }
    }

    function clearAllStatusIcons(slot) {
        const state = statusIconState[slot];
        if (!state) return;
        Object.values(state).forEach((entry) => {
            entry.sources.forEach((source) => { if (source.timer) clearTimeout(source.timer); });
            entry.el.remove();
        });
        delete statusIconState[slot];
    }

    // ───────────────────────── 근거리 이동(전투 게시 재생용 - 실시간 도착 판정) ─────────────────────────

    // 대상이 자기 등 뒤(진영 기준 반대편)에 있어도 그쪽 면으로 붙는다 - 진행 방향이 고정돼있지 않다(arena-battle.js와 동일).
    function getGapToTarget(unitKey, targetKey) {
        const el = document.querySelector(`[data-unit="${unitKey}"]`);
        const targetEl = document.querySelector(`[data-unit="${targetKey}"]`);
        if (!el || !targetEl) return 0;
        const rect = el.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        // overlap이 클수록 "더 깊이 파고들어야"(겹쳐야) 도착 판정이 나서 결과적으로 더 가까이 멈춘다.
        // 호처럼 meleeOverlapPercent가 지정된 유닛은 고정 픽셀 대신 자기 히트박스 너비의 그 비율만큼
        // 파고들어야 도착으로 친다(arena-battle.js와 동일).
        const overlapPercent = units[unitKey]?.meleeOverlapPercent;
        const overlap = overlapPercent ? rect.width * overlapPercent / 100 : 1; // 1 = arena-battle.js의 APPROACH_OVERLAP과 동일
        const myCenter = rect.left + rect.width / 2;
        const targetCenter = targetRect.left + targetRect.width / 2;
        return myCenter <= targetCenter
            ? (targetRect.left - rect.right) + overlap
            : (targetRect.right - rect.left) - overlap;
    }

    function getCurrentTranslateX(el) {
        const value = window.getComputedStyle(el).transform;
        if (!value || value === "none") return 0;
        const match = value.match(/matrix\(([^)]+)\)/);
        if (!match) return 0;
        return Number(match[1].split(",")[4]) || 0;
    }

    // 청년 전용(bonus_damage_knockback): 대상을 "후방으로 이동"한 것으로 취급한다 - 밀려난 뒤 원래
    // 자리로 되돌아오지 않고 그대로 남는다(arena-battle.js와 동일). CSS 트랜지션으로 한 번만 밀어내고
    // 손을 떼는 이유: walker의 tick()도 같은 요소의 인라인 transform을 매 프레임 덮어쓰는데, rAF
    // 루프끼리 계속 경합하면 값이 튈 수 있어서 여기서는 "한 번 점프시키고 끝"으로 처리한다. 정작 이
    // 대상과 접촉해야 했던 반대 진영 근거리 유닛들은 아래에서 명시적으로 "도착 취소" 처리해서, 다시
    // 걸어서 접근하는 과정을 반드시 거치게 한다(그동안은 waitForMeleeArrival이 공격을 막음).
    //
    // suspendSelfWalker: 밀려나는 대상 자신이 근접 유닛이고 지금 다른 목표를 향해 걸어가던 중이면,
    // 위와 같은 이유로 넉백 트랜지션 자체가 씹힌다 - 이 옵션을 켜면 트랜지션이 끝날 때까지 그 유닛만
    // walkerSuspended로 잠깐 재워서 충돌을 막고, 끝나면 자동으로 깨어나 원래 목표를 향해 평소처럼
    // 다시 걸어간다(별도의 "복귀" 연출 불필요). 청년의 기존 적 대상 넉백은 대체로 원거리(비근접)
    // 대상이라 이 문제가 잘 안 드러나서 기본은 꺼둔다(arena-battle.js와 동일).
    function applyKnockback(targetSlot, options = {}) {
        const { distance = 170, durationMs = 220, suspendSelfWalker = false, knockDir: knockDirOverride } = options;
        const el = document.querySelector(`[data-unit="${targetSlot}"]`);
        if (!el) return;

        // knockDir을 명시적으로 넘기면(윤영준의 복제체 생성 넉백 등, arena-battle.js와 동일) 그 값을 우선한다.
        const knockDir = knockDirOverride ?? (targetSlot.startsWith("attacker") ? -1 : 1);
        const startX = getCurrentTranslateX(el);
        let endX = startX + knockDir * distance;

        // 어느 위치에서 맞아도 맵(battle-field) 경계 밖으로는 밀려나지 않게 클램핑한다.
        const fieldEl = document.querySelector(".battle-field");
        if (fieldEl) {
            const fieldRect = fieldEl.getBoundingClientRect();
            const rect = el.getBoundingClientRect();
            const EDGE_PAD = 8;
            const minX = startX + (fieldRect.left + EDGE_PAD - rect.left);
            const maxX = startX + (fieldRect.right - EDGE_PAD - rect.right);
            endX = Math.max(minX, Math.min(maxX, endX));
        }

        if (suspendSelfWalker) walkerSuspended[targetSlot] = true;
        el.style.transition = `transform ${durationMs}ms ease-out`;
        requestAnimationFrame(() => {
            el.style.transform = `translateX(${endX}px)`;
        });
        setTimeout(() => {
            el.style.transition = "";
            if (suspendSelfWalker) walkerSuspended[targetSlot] = false;
        }, durationMs + 20);

        const casterSidePrefix = targetSlot.startsWith("attacker") ? "defender" : "attacker";
        Object.keys(units).forEach((slot) => {
            if (!slot.startsWith(casterSidePrefix) || !units[slot] || !units[slot].isMelee) return;
            meleeArrived[slot] = false;
        });
    }

    // 근접 유닛이 targetKey에 "도착"했을 때의 마무리 처리를 한 곳에 모은다 - tick()이 gap을 재서 정상
    // 도착한 경우와, waitForMeleeArrival의 타임아웃으로 강제 도착 처리된 경우가 모두 이걸 거쳐서
    // 걷기 애니메이션 정지/자세 전환/방향 전환/대기 중인 공격 연출 재개를 항상 동일하게 수행한다
    // (arena-battle.js의 markMeleeArrived와 동일).
    function markMeleeArrived(slot, targetKey) {
        if (meleeArrived[slot]) return;
        meleeArrived[slot] = true;
        const el = document.querySelector(`[data-unit="${slot}"]`);
        const imgEl = el?.querySelector(".battle-unit-img");
        imgEl?.classList.remove("walking");
        stopWalkFrames(slot);
        if (imgEl && units[slot]) {
            const unit = units[slot];
            const variant = spriteVariantSuffix(slot);
            imgEl.onerror = () => {
                imgEl.onerror = null;
                imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.png`;
            };
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/battle_idle${variant}.png`;
        }
        if (targetKey) faceToward(slot, targetKey);
        (pendingArrivalResolvers[slot] || []).forEach((resolve) => resolve());
        pendingArrivalResolvers[slot] = [];
    }

    function startMeleeWalker() {
        Object.keys(units).forEach((slot) => {
            if (!units[slot] || !units[slot].isMelee) return;
            meleeTargetKey[slot] = initialMeleeTargetKey(slot);
            meleeArrived[slot] = false;
        });
        walkerRunning = true;
        const myEpoch = ++walkerEpoch;

        // summon(복제체) 슬롯은 전투 도중에 units에 새로 추가될 수 있으므로, 고정된 SLOTS 대신
        // 매 프레임 Object.keys(units)를 다시 읽어야 새로 생긴 유닛도 즉시 이동을 시작한다.
        function tick() {
            if (!walkerRunning || walkerEpoch !== myEpoch) return;
            Object.keys(units).forEach((slot) => {
                if (!units[slot] || !units[slot].isMelee || units[slot].hp <= 0) return;
                if (walkerSuspended[slot]) return; // 넉백 트랜지션이 끝날 때까지 이 유닛은 건드리지 않는다
                const targetKey = meleeTargetKey[slot];
                if (!targetKey) return;
                const el = document.querySelector(`[data-unit="${slot}"]`);
                const imgEl = el?.querySelector(".battle-unit-img");
                const gap = getGapToTarget(slot, targetKey);

                if (meleeArrived[slot] && Math.abs(gap) <= LOSE_CONTACT_THRESHOLD_PX) {
                    return;
                }

                if (Math.abs(gap) <= ARRIVE_THRESHOLD_PX) {
                    markMeleeArrived(slot, targetKey);
                    return;
                }
                meleeArrived[slot] = false;
                imgEl?.classList.add("walking");
                // 걷기 전용 사진(walk_N.png)이 있으면 그 프레임을 순환 재생(arena-battle.js와 동일).
                if (!walkAnimActive[slot]) {
                    walkAnimActive[slot] = true;
                    playWalkFrames(slot);
                }
                const step = Math.sign(gap) * Math.min(MOVE_STEP_PX, Math.abs(gap));
                setFacing(slot, step < 0);
                const currentX = getCurrentTranslateX(el);
                el.style.transform = `translateX(${currentX + step}px)`;
            });
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    // 안전장치: 각자 독립적으로 "자신에게 가장 노출된 적"을 고르므로 서로가 서로의 목표가 아닌 경우가
    // 흔하다 - 그러면 gap이 끝내 안 좁혀져 이 대기가 자연 도착으로는 영원히 안 풀릴 수 있다(arena-battle.js와
    // 동일한 이유). 이 시간 안에 못 도착하면 강제로 도착 처리하고 진행한다.
    const MELEE_ARRIVAL_TIMEOUT_MS = 6000;

    function waitForMeleeArrival(actorKey, targetKey) {
        if (!units[actorKey] || !units[actorKey].isMelee) return Promise.resolve();
        if (meleeTargetKey[actorKey] !== targetKey) {
            meleeTargetKey[actorKey] = targetKey;
            meleeArrived[actorKey] = false;
        }
        if (meleeArrived[actorKey]) return Promise.resolve();
        return new Promise((resolve) => {
            (pendingArrivalResolvers[actorKey] = pendingArrivalResolvers[actorKey] || []).push(resolve);
            // 타임아웃이 걸릴 때 이미 다른 목표로 바뀌어 있었다면 건드리지 않는다 - 그 새 목표를 위한
            // waitForMeleeArrival 호출이 이미 자기 타임아웃을 새로 걸어뒀을 것이다.
            setTimeout(() => {
                if (meleeTargetKey[actorKey] === targetKey) markMeleeArrived(actorKey, targetKey);
            }, MELEE_ARRIVAL_TIMEOUT_MS);
        });
    }

    // ───────────────────────── 원거리 연출: 직선 / 포물선 / 즉시 플래시 / 텍스트 파티클 ─────────────────────────

    function fieldRelativeCenter(el) {
        const fieldEl = document.querySelector(".battle-field");
        const fieldRect = fieldEl.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 - fieldRect.left, y: rect.top + rect.height / 2 - fieldRect.top };
    }

    function spawnProjectileStraight(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const dot = document.createElement("div");
        dot.className = "projectile-dot";
        dot.style.left = `${start.x}px`;
        dot.style.top = `${start.y}px`;
        layer.appendChild(dot);

        // 시작 위치를 강제 리플로우(void dot.offsetWidth)로 확정시킨 뒤에 트랜지션을 걸어야 한다 -
        // requestAnimationFrame 한 번만으로는 브라우저가 "시작 위치" 상태 변경과 "끝 위치로 트랜지션"
        // 변경을 하나로 묶어버릴 수 있다(특히 DOM 변경이 짧은 시간에 몰릴 때) - 그러면 트랜지션 자체가
        // 발동을 안 하고 투사체가 곧장 끝 위치에 나타나버려서 "날아가는 동작이 생략된" 것처럼 보인다
        // (arena-battle.js와 동일한 이유 - 실제로 재현된 버그).
        void dot.offsetWidth;
        dot.style.transition = `left ${PROJECTILE_TRAVEL_MS}ms linear, top ${PROJECTILE_TRAVEL_MS}ms linear`;
        dot.style.left = `${end.x}px`;
        dot.style.top = `${end.y}px`;
        setTimeout(() => { dot.remove(); onArrive(); }, PROJECTILE_TRAVEL_MS);
    }

    // start->end 방향의 각도(도) - 회전이 필요한 투사체(크레파스/유성)에 쓴다.
    function angleDeg(start, end) {
        return Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
    }

    // 방임석 기본공격/스킬 전용 물감 투척(arena-battle.js와 동일 - 자세한 설명은 그쪽 주석 참고).
    // 기본공격은 항상 황금빛 직선, 스킬은 소모한 물감 색(없으면 흰색)으로 포물선.
    function spawnPaintProjectile(actorSlot, targetSlot, colorClass, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const dot = document.createElement("div");
        dot.className = `paint-projectile ${colorClass}`;
        dot.style.left = `${start.x}px`;
        dot.style.top = `${start.y}px`;
        layer.appendChild(dot);

        // 시작 위치를 강제 리플로우로 확정시킨 뒤에 트랜지션을 건다(spawnProjectileStraight 참고).
        void dot.offsetWidth;
        dot.style.transition = `left ${PROJECTILE_TRAVEL_MS}ms linear, top ${PROJECTILE_TRAVEL_MS}ms linear`;
        dot.style.left = `${end.x}px`;
        dot.style.top = `${end.y}px`;

        setTimeout(() => {
            dot.remove();
            onArrive();
        }, PROJECTILE_TRAVEL_MS);
    }

    function spawnPaintSkillProjectile(actorSlot, targetSlot, colorClass, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const dot = document.createElement("div");
        dot.className = `paint-projectile ${colorClass}`;
        layer.appendChild(dot);

        animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 60, onArrive);
    }

    // ===== 이의진 전용: 눈에서 발사되는 레이저(arena-battle.js와 동일 - 자세한 설명은 그쪽 주석 참고) =====
    // 레이저가 엉뚱한 위치에서 나가면 여기 두 값만 고치면 된다 - fx를 늘리면 오른쪽, fy를 늘리면 아래로.
    const EYE_LASER_ORIGIN = {
        type1: { fx: 0.63, fy: 0.12 },
        type2: { fx: 0.48, fy: 0.17 },
    };

    function imageContentPoint(imgEl, fracX, fracY) {
        const fieldEl = document.querySelector(".battle-field");
        const fieldRect = fieldEl.getBoundingClientRect();
        const boxRect = imgEl.getBoundingClientRect();
        const naturalW = imgEl.naturalWidth || boxRect.width;
        const naturalH = imgEl.naturalHeight || boxRect.height;
        const boxAspect = boxRect.width / boxRect.height;
        const imgAspect = naturalW / naturalH;

        let renderW, renderH, renderLeft, renderTop;
        if (imgAspect > boxAspect) {
            renderW = boxRect.width;
            renderH = renderW / imgAspect;
            renderLeft = boxRect.left;
            renderTop = boxRect.bottom - renderH;
        } else {
            renderH = boxRect.height;
            renderW = renderH * imgAspect;
            renderTop = boxRect.top;
            renderLeft = boxRect.left + (boxRect.width - renderW) / 2;
        }

        const flipped = imgEl.classList.contains("flipped");
        const effFracX = flipped ? (1 - fracX) : fracX;

        return {
            x: renderLeft + effFracX * renderW - fieldRect.left,
            y: renderTop + fracY * renderH - fieldRect.top,
        };
    }

    // 이의진 기본공격 전용: 눈에서 대상까지 레이저 빔이 "자라나며" 뻗어나간다 - width를 0에서 실제
    // 거리까지 트랜지션으로 늘려서, 빔 끝이 실제로 대상 위치에 도달하는 시점과 onArrive가 정확히
    // 일치한다("빔이 직접 닿아야" 피해/기절 판정). variant는 "type1"(빨강) / "type2"(청록).
    function spawnEyeLaserBeam(actorSlot, targetSlot, variant, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const origin = EYE_LASER_ORIGIN[variant] || EYE_LASER_ORIGIN.type1;
        const start = imageContentPoint(actorImg, origin.fx, origin.fy);
        const end = fieldRelativeCenter(targetImg);
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        const angle = angleDeg(start, end);
        const durationMs = Math.max(110, distance * 0.6);

        const wrap = document.createElement("div");
        wrap.className = `eye-laser-wrap eye-laser-${variant}`;
        wrap.style.left = `${start.x}px`;
        wrap.style.top = `${start.y}px`;
        wrap.style.width = "0px";
        wrap.style.transform = `rotate(${angle}deg)`;
        wrap.innerHTML = `<div class="eye-laser-glow"></div><div class="eye-laser-core"></div>`;
        layer.appendChild(wrap);

        const flare = document.createElement("div");
        flare.className = `eye-laser-flare eye-laser-flare-${variant}`;
        flare.style.left = `${start.x}px`;
        flare.style.top = `${start.y}px`;
        layer.appendChild(flare);

        // 시작 상태(width:0)를 강제 리플로우로 확정시킨 뒤에 트랜지션을 건다(spawnProjectileStraight 참고).
        void wrap.offsetWidth;
        wrap.style.transition = `width ${durationMs}ms linear`;
        wrap.style.width = `${distance}px`;

        setTimeout(() => {
            wrap.remove();
            flare.remove();
            onArrive();
        }, durationMs);
    }

    // 포물선 이동 공용 로직: 직선 보간 + 사인 곡선으로 위로 솟았다가 내려오는 오프셋을 매 프레임 계산한다.
    // startTime은 반드시 "첫 프레임이 실제로 실행되는 시각"으로 잡아야 한다(arena-battle.js와 동일한 이유 -
    // 호출 시점 기준으로 잡으면, 메인 스레드가 바빠서 첫 requestAnimationFrame 콜백이 늦게 불리는 경우
    // 그 첫 콜백에서 이미 progress가 1로 계산돼 투사체가 중간 프레임 없이 목표로 순간이동해버린다).
    function animateArcMotion(el, start, end, durationMs, arcHeight, onArrive) {
        let startTime = null;

        function frame(now) {
            if (startTime === null) startTime = now;
            const progress = Math.min(1, (now - startTime) / durationMs);
            const x = start.x + (end.x - start.x) * progress;
            const y = start.y + (end.y - start.y) * progress - Math.sin(progress * Math.PI) * arcHeight;
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
            if (progress < 1) {
                requestAnimationFrame(frame);
            } else {
                el.remove();
                onArrive();
            }
        }
        requestAnimationFrame(frame);
    }

    // 포물선: 직선 보간 + 시간에 따라 위로 솟았다가 내려오는 오프셋(사인 곡선)을 rAF로 매 프레임 계산한다.
    function spawnProjectileArc(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const dot = document.createElement("div");
        dot.className = "projectile-dot";
        layer.appendChild(dot);

        animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 70, onArrive);
    }

    // 김남옥 기본공격 전용: 원통형 크레파스 다트, 포물선. 대상이 전방이면 진분홍, 후방/복제체면 푸른색.
    function spawnCrayonProjectile(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const colorClass = targetSlot.endsWith("-front") ? "crayon-pink" : "crayon-blue";

        const dot = document.createElement("div");
        dot.className = `crayon-projectile ${colorClass}`;
        dot.style.transform = `rotate(${angleDeg(start, end)}deg)`;
        layer.appendChild(dot);

        animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 60, onArrive);
    }

    // 김남옥 스킬(엑스칼리버) 전용: 진분홍+푸른 크레파스 두 개가 나란히 직선으로 동시에 대상에게 날아간다.
    // 여성 대상(기절 성공)일 때만 재생된다 - 공격판정(기절 표시)은 이 투사체가 닿는 순간에 맞춘다.
    function playDualCrayonSkillProjectile(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const angle = angleDeg(start, end);
        const rad = (angle * Math.PI) / 180;
        const durationMs = PROJECTILE_TRAVEL_MS * 1.4;

        // 다트가 둘이라 onArrive는 먼저 처리되는 쪽 하나에만(중복 방지) 매단다.
        let onArriveScheduled = false;
        ["crayon-pink", "crayon-blue"].forEach((colorClass, i) => {
            const perp = i === 0 ? -6 : 6;
            const offX = -Math.sin(rad) * perp;
            const offY = Math.cos(rad) * perp;

            const dot = document.createElement("div");
            dot.className = `crayon-projectile ${colorClass}`;
            dot.style.transform = `rotate(${angle}deg)`;
            dot.style.left = `${start.x + offX}px`;
            dot.style.top = `${start.y + offY}px`;
            layer.appendChild(dot);

            // 시작 위치를 강제 리플로우로 확정시킨 뒤에 트랜지션을 건다(spawnProjectileStraight 참고).
            void dot.offsetWidth;
            dot.style.transition = `left ${durationMs}ms linear, top ${durationMs}ms linear`;
            dot.style.left = `${end.x + offX}px`;
            dot.style.top = `${end.y + offY}px`;

            setTimeout(() => dot.remove(), durationMs);
            if (!onArriveScheduled) {
                onArriveScheduled = true;
                setTimeout(onArrive, durationMs);
            }
        });
    }

    // 이종복 스킬 전용: 붉은 "mg"가 유성처럼 꼬리를 끌며 대상에게 직선으로 날아간다(기본공격보다 큼).
    // 공격판정(피해 반영)은 이 투사체가 닿는 순간에 맞춘다.
    function spawnMeteorProjectile(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const angle = angleDeg(start, end);
        const durationMs = PROJECTILE_TRAVEL_MS * 1.5;

        const el = document.createElement("div");
        el.className = "meteor-projectile";
        el.textContent = "mg";
        el.style.left = `${start.x}px`;
        el.style.top = `${start.y}px`;
        el.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
        layer.appendChild(el);

        // 시작 위치를 강제 리플로우로 확정시킨 뒤에 트랜지션을 건다(spawnProjectileStraight 참고).
        void el.offsetWidth;
        el.style.transition = `left ${durationMs}ms linear, top ${durationMs}ms linear`;
        el.style.left = `${end.x}px`;
        el.style.top = `${end.y}px`;

        setTimeout(() => {
            el.remove();
            onArrive();
        }, durationMs);
    }

    // 강 희 스킬 전용: 얼굴 쪽에서 좁은 부채꼴 초록 입냄새(가스)가 맵 끝까지 길게 뻗어나간다(arena-battle.js와 동일).
    function spawnGasBreathStream(actorSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const fieldEl = document.querySelector(".battle-field");
        if (!layer || !actorImg || !fieldEl) { onArrive(); return; }

        const fieldRect = fieldEl.getBoundingClientRect();
        const isAttacker = actorSlot.startsWith("attacker");
        const start = fieldRelativeCenter(actorImg);
        start.y -= 60;
        const end = { x: isAttacker ? fieldRect.width : 0, y: start.y };
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        const angle = angleDeg(start, end);
        const durationMs = 1150; // 부채꼴 본체 + 연기/입자 애니메이션이 전부 끝날 때까지 넉넉하게 유지

        const wrap = document.createElement("div");
        wrap.className = "gas-breath-wrap";
        wrap.style.left = `${start.x}px`;
        wrap.style.top = `${start.y}px`;
        wrap.style.width = `${length}px`;
        wrap.style.transform = `rotate(${angle}deg)`;
        wrap.style.setProperty("--reach", `${length}px`);
        wrap.innerHTML = `
            <div class="gas-breath-cone"></div>
            <div class="gas-breath-clear"></div>
            <span class="gas-breath-puff gbp1"></span>
            <span class="gas-breath-puff gbp2"></span>
            <span class="gas-breath-puff gbp3"></span>
            <span class="gas-breath-puff gbp4"></span>
            <span class="gas-breath-puff gbp5"></span>
            <span class="gas-breath-particle gbd1"></span>
            <span class="gas-breath-particle gbd2"></span>
            <span class="gas-breath-particle gbd3"></span>
            <span class="gas-breath-particle gbd4"></span>
            <span class="gas-breath-particle gbd5"></span>
            <span class="gas-breath-particle gbd6"></span>
        `;
        layer.appendChild(wrap);

        setTimeout(() => {
            wrap.remove();
            onArrive();
        }, durationMs);
    }

    // 불빠따 김어진 스킬(aoe_all_others_damage) 전용: 캐스터 발밑에서 좌우로 번져나가는 땅불을 캔버스에
    // 직접 그린다(arena-battle.js와 동일 - 참고 데모 ground_slam_fire_toggle_optimized.html의 화염/불씨/
    // 연기/균열 드로잉 로직을 그대로 옮김. 자세한 설명은 그쪽 주석 참고). 좌우 모두 다 번지면(대상
    // 전원에게 닿으면) 곧바로 발밑 쪽부터 좁아지며 사라지는 두 번째 전환으로 자동으로 넘어간다.
    function spawnGroundFireCanvas(actorSlot, hits, onHit) {
        const layer = document.getElementById("projectile-layer");
        const fieldEl = document.querySelector(".battle-field");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        if (!layer || !fieldEl || !actorImg) { hits.forEach(onHit); return; }

        const actorSide = sideOf(actorSlot);
        const fieldRect = fieldEl.getBoundingClientRect();
        const actorRect = actorImg.getBoundingClientRect();
        const groundY = actorRect.bottom - fieldRect.top;
        const casterX = actorRect.left + actorRect.width / 2 - fieldRect.left;

        const targets = hits.map((hit) => {
            const hitSlot = findHitSlot(actorSide, hit.target, hit.target_side);
            const targetImg = hitSlot ? document.querySelector(`[data-unit="${hitSlot}"] .battle-unit-img`) : null;
            if (!targetImg) return { hit, dir: 1, dist: 60 };
            const targetRect = targetImg.getBoundingClientRect();
            const x = targetRect.left + targetRect.width / 2 - fieldRect.left;
            return { hit, dir: x < casterX ? -1 : 1, dist: Math.max(1, Math.abs(x - casterX)) };
        });
        const leftDists = targets.filter((t) => t.dir < 0).map((t) => t.dist);
        const rightDists = targets.filter((t) => t.dir > 0).map((t) => t.dist);
        const maxDistOf = { "-1": leftDists.length ? Math.max(...leftDists) : 60, "1": rightDists.length ? Math.max(...rightDists) : 60 };

        const APPEAR_MS = 520;
        const DISAPPEAR_MS = 480;

        const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
        const canvas = document.createElement("canvas");
        canvas.className = "ground-fire-canvas";
        canvas.style.width = `${fieldRect.width}px`;
        canvas.style.height = `${fieldRect.height}px`;
        canvas.width = Math.round(fieldRect.width * dpr);
        canvas.height = Math.round(fieldRect.height * dpr);
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        layer.appendChild(canvas);

        // 참고 데모의 화면 흔들림 - 불이 터지는 충격 연출(arena-battle.js와 동일).
        fieldEl.classList.remove("ground-fire-shake");
        void fieldEl.offsetWidth;
        fieldEl.classList.add("ground-fire-shake");

        function seeded(index, salt) {
            const v = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
            return v - Math.floor(v);
        }
        function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
        function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
        function clamp01(v) { return Math.max(0, Math.min(1, v)); }

        const reach = Math.max(maxDistOf["-1"], maxDistOf["1"]);
        const flameCount = Math.max(24, Math.ceil(reach / 14));
        const flameSeeds = [];
        for (let i = 0; i < flameCount; i++) {
            flameSeeds.push({
                n: i / Math.max(1, flameCount - 1),
                phase: seeded(i, 1) * Math.PI * 2,
                height: 16 + seeded(i, 2) * 22,
                width: 4 + seeded(i, 3) * 4,
                lean: (seeded(i, 4) - 0.5) * 7,
            });
        }
        const emberSeeds = [];
        for (let i = 0; i < 20; i++) {
            emberSeeds.push({
                n: seeded(i, 5),
                phase: seeded(i, 6) * Math.PI * 2,
                lift: 10 + seeded(i, 7) * 32,
                size: 0.7 + seeded(i, 8) * 1.4,
            });
        }
        const smokeSeeds = [];
        for (let i = 0; i < 10; i++) {
            smokeSeeds.push({
                n: seeded(i, 9),
                phase: seeded(i, 10) * Math.PI * 2,
                lift: 10 + seeded(i, 11) * 22,
                size: 6 + seeded(i, 12) * 11,
            });
        }

        function sideX(direction, normalized) {
            return casterX + direction * normalized * maxDistOf[String(direction)];
        }

        function drawCrack(direction, start, end) {
            if (end - start <= 0.001) return;
            const x0 = sideX(direction, start);
            const x1 = sideX(direction, end);
            const segments = Math.max(3, Math.ceil(Math.abs(x1 - x0) / 40));
            ctx.save();
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            for (let i = 0; i <= segments; i++) {
                const n = i / segments;
                const x = x0 + (x1 - x0) * n;
                const wobble = Math.sin(n * 17 + direction * 2) * 1.8 + Math.sin(n * 43) * 0.9;
                const y = groundY + 2 + wobble;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = "rgba(255,55,12,.20)";
            ctx.lineWidth = 7;
            ctx.stroke();
            ctx.strokeStyle = "rgba(255,124,48,.66)";
            ctx.lineWidth = 1.8;
            ctx.stroke();
            ctx.restore();
        }

        function drawFlames(direction, start, end, time) {
            if (end - start <= 0.001) return;
            const outerX = sideX(direction, end);
            const innerX = sideX(direction, start);
            const minX = Math.min(innerX, outerX);
            const maxX = Math.max(innerX, outerX);

            ctx.save();
            ctx.beginPath();
            ctx.rect(minX - 14, groundY - 64, maxX - minX + 28, 88);
            ctx.clip();
            ctx.globalCompositeOperation = "lighter";

            const groundGlow = ctx.createLinearGradient(minX, groundY, maxX, groundY);
            groundGlow.addColorStop(0, "rgba(255,220,120,.16)");
            groundGlow.addColorStop(.35, "rgba(255,98,20,.28)");
            groundGlow.addColorStop(1, "rgba(255,56,5,.18)");
            ctx.fillStyle = groundGlow;
            ctx.fillRect(minX, groundY - 10, maxX - minX, 22);

            for (const seed of flameSeeds) {
                if (seed.n < start || seed.n > end) continue;
                const x = sideX(direction, seed.n);
                const flicker = Math.sin(time * 0.009 + seed.phase) * 4 + Math.sin(time * 0.018 + seed.phase * 1.7) * 2;
                const flameHeight = Math.max(8, seed.height + flicker);
                const lean = seed.lean * direction + Math.sin(time * 0.006 + seed.phase) * 2.4;

                const gradient = ctx.createLinearGradient(x, groundY + 2, x + lean, groundY - flameHeight);
                gradient.addColorStop(0, "rgba(255,250,190,.92)");
                gradient.addColorStop(.25, "rgba(255,178,52,.88)");
                gradient.addColorStop(.62, "rgba(255,73,9,.67)");
                gradient.addColorStop(1, "rgba(255,30,0,0)");

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.moveTo(x - seed.width, groundY + 2);
                ctx.quadraticCurveTo(x - seed.width * .4 + lean * .35, groundY - flameHeight * .58, x + lean, groundY - flameHeight);
                ctx.quadraticCurveTo(x + seed.width * .55 + lean * .2, groundY - flameHeight * .47, x + seed.width, groundY + 2);
                ctx.closePath();
                ctx.fill();
            }

            const headX = sideX(direction, end);
            const headGlow = ctx.createRadialGradient(headX, groundY - 2, 1, headX, groundY - 2, 26);
            headGlow.addColorStop(0, "rgba(255,245,190,.5)");
            headGlow.addColorStop(.35, "rgba(255,129,31,.22)");
            headGlow.addColorStop(1, "rgba(255,50,0,0)");
            ctx.fillStyle = headGlow;
            ctx.beginPath();
            ctx.arc(headX, groundY - 2, 26, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }

        function drawEmbers(direction, start, end, time) {
            if (end - start <= 0.001) return;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            for (const seed of emberSeeds) {
                const n = start + (end - start) * seed.n;
                const cycle = (time * 0.00034 + seed.phase / (Math.PI * 2)) % 1;
                const x = sideX(direction, n) + Math.sin(time * 0.004 + seed.phase) * 5;
                const y = groundY - cycle * seed.lift;
                ctx.globalAlpha = Math.sin(cycle * Math.PI) * .7;
                ctx.fillStyle = cycle < .42 ? "#fff0a8" : "#ff6b19";
                ctx.beginPath();
                ctx.arc(x, y, seed.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        function drawSmoke(direction, start, end, time) {
            if (end - start <= 0.001) return;
            ctx.save();
            for (const seed of smokeSeeds) {
                const n = start + (end - start) * seed.n;
                const cycle = (time * 0.00013 + seed.phase / (Math.PI * 2)) % 1;
                const x = sideX(direction, n) + Math.sin(time * 0.0015 + seed.phase) * 8;
                const y = groundY - 6 - cycle * seed.lift;
                ctx.globalAlpha = Math.sin(cycle * Math.PI) * .08;
                ctx.fillStyle = "#b08a7b";
                ctx.beginPath();
                ctx.arc(x, y, seed.size * (1 + cycle * .5), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        function drawCenterGlow() {
            const glow = ctx.createRadialGradient(casterX, groundY, 3, casterX, groundY, 100);
            glow.addColorStop(0, "rgba(255,205,115,.16)");
            glow.addColorStop(.34, "rgba(255,90,17,.07)");
            glow.addColorStop(1, "rgba(255,60,0,0)");
            ctx.fillStyle = glow;
            ctx.fillRect(casterX - 100, groundY - 90, 200, 130);
        }

        const range = { "-1": { start: 0, end: 0 }, "1": { start: 0, end: 0 } };

        targets.forEach(({ hit, dir, dist }) => {
            const maxD = maxDistOf[String(dir)];
            setTimeout(() => onHit(hit), maxD > 0 ? (dist / maxD) * APPEAR_MS : 0);
        });

        let phase = "appear";
        let phaseStart = performance.now();

        function frame(now) {
            const elapsed = now - phaseStart;
            if (phase === "appear") {
                const eased = easeOutCubic(clamp01(elapsed / APPEAR_MS));
                range["-1"].end = eased;
                range["1"].end = eased;
                if (elapsed >= APPEAR_MS) {
                    range["-1"].end = 1;
                    range["1"].end = 1;
                    phase = "disappear";
                    phaseStart = now;
                }
            } else {
                const raw = clamp01(elapsed / DISAPPEAR_MS);
                const eased = easeInOutCubic(raw);
                range["-1"].start = eased;
                range["1"].start = eased;
                if (raw >= 1) {
                    canvas.remove();
                    return;
                }
            }

            ctx.clearRect(0, 0, fieldRect.width, fieldRect.height);
            if (range["-1"].end > 0.001 || range["1"].end > 0.001) drawCenterGlow();
            [-1, 1].forEach((dir) => {
                const r = range[String(dir)];
                drawCrack(dir, r.start, r.end);
                drawSmoke(dir, r.start, r.end, now);
                drawFlames(dir, r.start, r.end, now);
                drawEmbers(dir, r.start, r.end, now);
            });

            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    // 호(자폭 소환수) 전용 - arena-battle.js의 playGoldenSelfDestruct와 동일(참고 데모
    // golden_self_destruct_optimized.html의 charge->implode->detonate->after 4단계를 호의 위치/크기에
    // 맞춰 이식, detonate 진입 시각은 EFFECT_LAUNCH_DELAY_MS와 일치). 캐릭터 자체의 빛/스케일/소멸은
    // CSS(golden-self-destruct-char, arena-battle.css)가 맡고,
    // 여기서는 주변 파티클과 국소 화면 흔들림만 캔버스로 그린다.
    function playGoldenSelfDestruct(actorSlot) {
        const layer = document.getElementById("projectile-layer");
        const fieldEl = document.querySelector(".battle-field");
        const imgEl = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        if (!layer || !fieldEl || !imgEl) return;

        goldenSelfDestructActive[actorSlot] = true;
        imgEl.classList.remove("golden-self-destruct");
        void imgEl.offsetWidth;
        imgEl.classList.add("golden-self-destruct");

        const fieldRect = fieldEl.getBoundingClientRect();
        const imgRect = imgEl.getBoundingClientRect();
        const cx = imgRect.left + imgRect.width / 2 - fieldRect.left;
        const cy = imgRect.top + imgRect.height / 2 - fieldRect.top;
        const radius = Math.max(24, imgRect.width * 0.55);

        const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
        const canvas = document.createElement("canvas");
        canvas.className = "golden-self-destruct-canvas";
        canvas.style.width = `${fieldRect.width}px`;
        canvas.style.height = `${fieldRect.height}px`;
        canvas.width = Math.round(fieldRect.width * dpr);
        canvas.height = Math.round(fieldRect.height * dpr);
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        layer.appendChild(canvas);

        const spark = document.createElement("canvas");
        spark.width = spark.height = 64;
        const sparkCtx = spark.getContext("2d");
        const sparkGrad = sparkCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
        sparkGrad.addColorStop(0, "rgba(255,255,240,1)");
        sparkGrad.addColorStop(0.22, "rgba(255,236,164,.98)");
        sparkGrad.addColorStop(0.55, "rgba(255,185,56,.62)");
        sparkGrad.addColorStop(1, "rgba(255,116,0,0)");
        sparkCtx.fillStyle = sparkGrad;
        sparkCtx.fillRect(0, 0, 64, 64);

        const smokeSprite = document.createElement("canvas");
        smokeSprite.width = smokeSprite.height = 96;
        const smokeCtx = smokeSprite.getContext("2d");
        const smokeGrad = smokeCtx.createRadialGradient(48, 48, 0, 48, 48, 48);
        smokeGrad.addColorStop(0, "rgba(255,185,80,.42)");
        smokeGrad.addColorStop(0.35, "rgba(180,98,35,.18)");
        smokeGrad.addColorStop(1, "rgba(70,35,15,0)");
        smokeCtx.fillStyle = smokeGrad;
        smokeCtx.fillRect(0, 0, 96, 96);

        let particles = [];
        let smoke = [];
        let streaks = [];
        let exploded = false;
        for (let i = 0; i < 16; i++) {
            particles.push({
                a: (Math.PI * 2 * i) / 16 + Math.random() * 0.18,
                dist: 8 + Math.random() * 16, life: 0, maxLife: 400 + Math.random() * 200, mode: "in",
            });
        }

        function explode() {
            particles = [];
            smoke = [];
            streaks = [];
            for (let i = 0; i < 20; i++) {
                particles.push({
                    a: Math.PI * 2 * (i / 20) + Math.random() * 0.16,
                    dist: 0, speed: (radius / 26) * (4 + Math.random() * 9),
                    size: radius * (0.16 + Math.random() * 0.16), life: 0, maxLife: 560 + Math.random() * 240, mode: "out",
                });
            }
            for (let i = 0; i < 8; i++) {
                smoke.push({
                    a: Math.PI * 2 * Math.random(), dist: 0, speed: (radius / 26) * (1 + Math.random() * 2.4),
                    size: radius * (0.3 + Math.random() * 0.3), life: 0, maxLife: 700 + Math.random() * 260,
                });
            }
            for (let i = 0; i < 10; i++) {
                streaks.push({ a: Math.PI * 2 * Math.random(), len: radius * (0.7 + Math.random() * 0.7), width: 2 + Math.random() * 3 });
            }
        }

        const startMs = performance.now();
        // detonate 진입 시각이 EFFECT_LAUNCH_DELAY_MS(다른 근접 캐릭터의 명중 판정 시각)와 정확히 같아야
        // 한다 - charge/implode를 원래 참고 데모의 비율(480:160)로 그 시간 안에 압축한다(arena-battle.js와 동일).
        const CHARGE_MS = EFFECT_LAUNCH_DELAY_MS * 0.75;
        const IMPLODE_END_MS = EFFECT_LAUNCH_DELAY_MS;
        const DETONATE_END_MS = IMPLODE_END_MS + 55;
        const TOTAL_MS = DETONATE_END_MS + 765;

        function frame(now) {
            const t = now - startMs;
            let flashAlpha, ringAlpha, ringR, ringR2 = 0, shake = 0;

            if (t < CHARGE_MS) {
                const p = t / CHARGE_MS;
                flashAlpha = 0.12 + p * 0.2;
                ringAlpha = 0.2 + p * 0.22;
                ringR = radius * (0.5 + p * 0.22);
            } else if (t < IMPLODE_END_MS) {
                const p = (t - CHARGE_MS) / (IMPLODE_END_MS - CHARGE_MS);
                flashAlpha = 0.32 + p * 0.24;
                ringAlpha = 0.45 - p * 0.18;
                ringR = radius * (0.72 - p * 0.2);
            } else if (t < DETONATE_END_MS) {
                if (!exploded) { exploded = true; explode(); }
                const p = (t - IMPLODE_END_MS) / (DETONATE_END_MS - IMPLODE_END_MS);
                flashAlpha = 1 - p * 0.15;
                ringAlpha = 0.95;
                ringR = radius * (0.55 + p * 3.4);
                ringR2 = radius * (0.35 + p * 2.2);
                shake = Math.max(2, radius * 0.22) * (1 - p * 0.3);
            } else if (t < TOTAL_MS) {
                const p = (t - DETONATE_END_MS) / (TOTAL_MS - DETONATE_END_MS);
                flashAlpha = Math.max(0, 0.85 - p * 0.85);
                ringAlpha = Math.max(0, 0.78 - p * 0.78);
                ringR = radius * (2.5 + p * 4);
                ringR2 = radius * (1.4 + p * 3);
                shake = Math.max(0, radius * 0.1 * (1 - p));
            } else {
                canvas.remove();
                goldenSelfDestructActive[actorSlot] = false;
                fieldEl.style.transform = "";
                return;
            }

            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.life += 16.67;
                if (p.mode === "in") p.dist += (1.4 - p.life / p.maxLife) * (radius / 30);
                else { p.dist += p.speed; p.speed *= 0.988; }
                if (p.life > p.maxLife) particles.splice(i, 1);
            }
            for (let i = smoke.length - 1; i >= 0; i--) {
                const s = smoke[i];
                s.life += 16.67;
                s.dist += s.speed;
                s.speed *= 0.994;
                s.size += radius * 0.008;
                if (s.life > s.maxLife) smoke.splice(i, 1);
            }

            ctx.clearRect(0, 0, fieldRect.width, fieldRect.height);
            ctx.save();
            ctx.globalCompositeOperation = "lighter";

            if (flashAlpha > 0) {
                const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.95);
                g.addColorStop(0, `rgba(255,255,240,${0.45 * flashAlpha})`);
                g.addColorStop(0.22, `rgba(255,236,162,${0.38 * flashAlpha})`);
                g.addColorStop(0.5, `rgba(255,192,74,${0.22 * flashAlpha})`);
                g.addColorStop(1, "rgba(255,120,0,0)");
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(cx, cy, radius * 0.95, 0, Math.PI * 2);
                ctx.fill();
            }

            [[ringR, ringAlpha, Math.max(2, radius * 0.07)], [ringR2, ringAlpha * 0.75, Math.max(1.5, radius * 0.04)]].forEach(([r, a, w]) => {
                if (a <= 0 || r <= 0) return;
                ctx.save();
                ctx.beginPath();
                ctx.lineWidth = w;
                ctx.strokeStyle = `rgba(255, ${180 + Math.floor(a * 40)}, 72, ${a})`;
                ctx.shadowBlur = radius * 0.16;
                ctx.shadowColor = `rgba(255, 174, 54, ${a * 0.8})`;
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            });

            if (exploded && streaks.length && ringAlpha > 0) {
                ctx.save();
                ctx.translate(cx, cy);
                for (const s of streaks) {
                    ctx.save();
                    ctx.rotate(s.a);
                    const grad = ctx.createLinearGradient(0, 0, s.len, 0);
                    grad.addColorStop(0, `rgba(255,255,240,${0.9 * ringAlpha})`);
                    grad.addColorStop(0.4, `rgba(255,221,125,${0.65 * ringAlpha})`);
                    grad.addColorStop(1, "rgba(255,118,0,0)");
                    ctx.strokeStyle = grad;
                    ctx.lineWidth = s.width;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.lineTo(s.len, 0);
                    ctx.stroke();
                    ctx.restore();
                }
                ctx.restore();
            }

            for (const p of particles) {
                const lifeP = p.life / p.maxLife;
                let px, py, alpha;
                if (p.mode === "in") {
                    const d = radius * 0.9 - p.dist;
                    px = cx + Math.cos(p.a) * d;
                    py = cy + Math.sin(p.a) * d;
                    alpha = Math.max(0, 0.6 - lifeP * 0.5);
                } else {
                    px = cx + Math.cos(p.a) * p.dist;
                    py = cy + Math.sin(p.a) * p.dist;
                    alpha = Math.max(0, 1 - lifeP);
                }
                const size = p.size * (p.mode === "out" ? 1 - lifeP * 0.3 : 1);
                ctx.globalAlpha = alpha;
                ctx.drawImage(spark, px - size / 2, py - size / 2, size, size);
            }
            ctx.globalAlpha = 1;

            for (const s of smoke) {
                const lifeP = s.life / s.maxLife;
                const px = cx + Math.cos(s.a) * (radius * 0.15 + s.dist * 3.4);
                const py = cy + Math.sin(s.a) * (radius * 0.15 + s.dist * 2.6);
                const size = s.size * (1 + lifeP * 1.2);
                ctx.globalAlpha = Math.max(0, 0.4 - lifeP * 0.4);
                ctx.drawImage(smokeSprite, px - size / 2, py - size / 2, size, size);
            }
            ctx.globalAlpha = 1;
            ctx.restore();

            if (shake > 0) {
                const sx = (Math.random() - 0.5) * shake;
                const sy = (Math.random() - 0.5) * shake * 0.6;
                fieldEl.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
            } else {
                fieldEl.style.transform = "";
            }

            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    // 임소정 전기의 발사 시작점(손/지팡이 위치 근사치) - arena-battle.js와 동일. 기본공격/스킬이 서로
    // 다른 지점에서 나가야 해서 따로 둔다.
    const ELECTRIC_ORIGIN_BASIC = { fx: 0.9, fy: 0.27 };
    const ELECTRIC_ORIGIN_SKILL = { fx: 0.9, fy: 0.28 };

    // 임소정 전용: 캐스터-대상을 잠깐 잇는 전기(이동하는 점이 아니라, 두 위치 사이를 잇는 막대를 회전시켜 만든다).
    // 기본공격은 얇고 푸른색(electric-blue), 스킬은 더 두껍고 노란색(electric-yellow)으로 호출한다.
    function playElectricConnector(actorSlot, targetSlot, colorClass, radiusPx, onArrive, origin) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { if (onArrive) onArrive(); return; }

        const o = origin || ELECTRIC_ORIGIN_BASIC;
        const start = imageContentPoint(actorImg, o.fx, o.fy);
        const end = fieldRelativeCenter(targetImg);
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        const angle = angleDeg(start, end);

        const wrap = document.createElement("div");
        wrap.className = "electric-connector-wrap";
        wrap.style.left = `${start.x}px`;
        wrap.style.top = `${start.y}px`;
        wrap.style.width = `${distance}px`;
        wrap.style.height = `${radiusPx}px`;
        wrap.style.marginTop = `${-radiusPx / 2}px`;
        wrap.style.transform = `rotate(${angle}deg)`;

        const beam = document.createElement("div");
        beam.className = `electric-connector ${colorClass}`;
        wrap.appendChild(beam);
        layer.appendChild(wrap);

        setTimeout(() => wrap.remove(), 280);
        if (onArrive) setTimeout(onArrive, 80);
    }

    // 서민석 기본공격 전용: 책 모양 투사체, 포물선(회전은 CSS 애니메이션이 알아서 함).
    function spawnBookProjectile(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const el = document.createElement("div");
        el.className = "book-projectile";
        layer.appendChild(el);

        animateArcMotion(el, start, end, PROJECTILE_TRAVEL_MS * 1.6, 70, onArrive);
    }

    // 서민석 스킬 전용: 하트 모양 투사체, 포물선. colorClass로 "heart-pink"(남성 대상)/"heart-red"(여성 대상) 지정.
    function spawnHeartProjectile(actorSlot, targetSlot, colorClass, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const el = document.createElement("div");
        el.className = `heart-projectile ${colorClass}`;
        el.textContent = "❤";
        layer.appendChild(el);

        animateArcMotion(el, start, end, PROJECTILE_TRAVEL_MS * 1.7, 90, onArrive);
    }

    // 이영웅 스킬 전용: 치유 대상 머리 위에서 초록색 하트(가운데 십자가, 노란 오라)가 천천히 내려온다(arena-battle.js와 동일).
    function spawnHealingHeart(targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !targetImg) { onArrive(); return; }

        const end = fieldRelativeCenter(targetImg);
        const start = { x: end.x, y: end.y - 130 };
        const durationMs = 1000;

        const wrap = document.createElement("div");
        wrap.className = "healing-heart-wrap";
        wrap.style.left = `${start.x}px`;
        wrap.style.top = `${start.y}px`;
        wrap.innerHTML = `
            <div class="healing-heart-aura"></div>
            <div class="healing-heart-glyph">❤</div>
            <div class="healing-heart-cross">+</div>
        `;
        layer.appendChild(wrap);

        // 시작 위치를 강제 리플로우로 확정시킨 뒤에 트랜지션을 건다(spawnProjectileStraight 참고).
        void wrap.offsetWidth;
        wrap.style.transition = `top ${durationMs}ms ease-in`;
        wrap.style.top = `${end.y}px`;

        setTimeout(() => {
            wrap.remove();
            onArrive();
        }, durationMs);
    }

    // 윤대웅 전용: 이동하는 투사체 없이, 대상 위치에서 즉시 플래시만 터진다.
    function playInstantFlash(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !targetImg) { onArrive(); return; }
        const pos = fieldRelativeCenter(targetImg);
        const flash = document.createElement("div");
        flash.className = "dt-instant-flash-dot";
        flash.style.left = `${pos.x}px`;
        flash.style.top = `${pos.y}px`;
        layer.appendChild(flash);
        setTimeout(() => flash.remove(), 250);
        setTimeout(onArrive, 80); // 플래시는 이동시간이 사실상 없으므로 아주 짧게만 대기
    }

    // 이종복 전용: "F", "=", "m", "a" 네 글자가 0.1초 간격으로 직선 발사된다.
    function playTextParticles(actorSlot, targetSlot, onArrive) {
        const letters = ["F", "=", "m", "a"];
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);

        letters.forEach((ch, i) => {
            setTimeout(() => {
                const el = document.createElement("div");
                el.className = "dt-char-particle";
                el.textContent = ch;
                el.style.left = `${start.x}px`;
                el.style.top = `${start.y}px`;
                layer.appendChild(el);
                // 시작 위치를 강제 리플로우로 확정시킨 뒤에 트랜지션을 건다(spawnProjectileStraight 참고) -
                // onArrive는 마지막 글자에만(그 글자가 실제로 도착할 시점 기준) 매단다.
                void el.offsetWidth;
                el.style.transition = `left ${PROJECTILE_TRAVEL_MS}ms linear, top ${PROJECTILE_TRAVEL_MS}ms linear`;
                el.style.left = `${end.x}px`;
                el.style.top = `${end.y}px`;
                setTimeout(() => el.remove(), PROJECTILE_TRAVEL_MS + 50);
                if (i === letters.length - 1) setTimeout(onArrive, PROJECTILE_TRAVEL_MS);
            }, i * 100);
        });
    }

    function playRangedAttack(actorSlot, targetSlot, onArrive) {
        const style = units[actorSlot]?.style || "straight";
        if (style === "arc") spawnProjectileArc(actorSlot, targetSlot, onArrive);
        else if (style === "instant_flash") playInstantFlash(actorSlot, targetSlot, onArrive);
        else if (style === "text_particles") playTextParticles(actorSlot, targetSlot, onArrive);
        else if (style === "crayon") spawnCrayonProjectile(actorSlot, targetSlot, onArrive);
        else if (style === "electric") playElectricConnector(actorSlot, targetSlot, "electric-blue", 5, onArrive, ELECTRIC_ORIGIN_BASIC);
        else if (style === "book") spawnBookProjectile(actorSlot, targetSlot, onArrive);
        else if (style === "eye_laser") spawnEyeLaserBeam(actorSlot, targetSlot, units[actorSlot]?.isType2 ? "type2" : "type1", onArrive);
        else if (style === "paint_gold") spawnPaintProjectile(actorSlot, targetSlot, "paint-gold", onArrive);
        else spawnProjectileStraight(actorSlot, targetSlot, onArrive);
    }

    // ───────────────────────── 수동 버튼: 기본 공격 / 이동 (서버 왕복 없음) ─────────────────────────

    function setupManualButtons() {
        document.getElementById("dt-basic-attack").addEventListener("click", () => {
            if (!activeSlot || !units[activeSlot]) { log("먼저 전장에서 캐릭터를 클릭해 활성 유닛을 선택하세요."); return; }
            // aliveEnemyTarget: front -> back -> summon 순서(가장 앞의 살아있는 자리) - 복제체를 노려보고
            // 싶으면 상대 front/back의 체력을 먼저 0으로 만들어서 복제체만 살아남게 해야 한다.
            const targetSlot = aliveEnemyTarget(activeSlot);
            if (!targetSlot) { log("대상이 없습니다."); return; }

            const actor = units[activeSlot];
            function applyHit() {
                const typeMult = getTypeMultiplier(actor.attackType, units[targetSlot].defenseType);
                const isCrit = Math.random() < CRIT_CHANCE; // 고정 데미지지만 치명타 연출은 실제와 같은 확률로 흉내낸다
                const dummyDamage = Math.round((isCrit ? 10 * CRIT_MULTIPLIER : 10) * typeMult); // 수동 테스트는 눈으로 느낌만 확인하는 용도라 정밀 계산 없이 고정값 기준 + 상성만 반영
                units[targetSlot].hp = Math.max(0, units[targetSlot].hp - dummyDamage);
                renderUnit(targetSlot);
                flashHit(targetSlot, isCrit, typeMult);
                let stunText = "";
                // 이의진 type2(Parent) 상태 기본공격 부가효과 - battle_engine.py의 _apply_type2_stun_if_active와 동일.
                const stunSeconds = actor.status?.type2StunSeconds;
                if (stunSeconds && effectiveGender(units[targetSlot].name, targetSlot) === "남") {
                    units[targetSlot].status.stunUntil = performance.now() + stunSeconds * 1000;
                    flashEffectAura(targetSlot, "cc");
                    setStatusIcon(targetSlot, "stun", { source: `${activeSlot}:stun`, durationMs: stunSeconds * 1000 });
                    stunText = ` (${stunSeconds}초 기절)`;
                }
                log(`[수동] ${actor.name} 기본공격 -> ${units[targetSlot].name} (${dummyDamage} 피해)${isCrit ? " 치명타!" : ""}${stunText}`);
                // 호(자폭 소환수): renderUnit이 hp<=0을 감지해서 자동으로 사망 처리를 한다 - 폭발이 곧
                // 타격이므로, 아래 호출부에서 이 applyHit() 자체를 detonate 시점까지 통째로 미룬다.
                if (actor.selfDestructAfterAttack) {
                    actor.hp = 0;
                    renderUnit(activeSlot);
                    log(`[수동] ${actor.name} 자폭!`);
                }
            }

            if (actor.isMelee) {
                waitForMeleeArrival(activeSlot, targetSlot).then(() => {
                    playAttackFrames(activeSlot);
                    // 호(자폭 소환수): 폭발이 곧 타격이다 - 스윙이 시작되는 이 순간부터 이펙트를 먼저 튼다.
                    if (actor.selfDestructAfterAttack) playGoldenSelfDestruct(activeSlot);
                    // 근접도 원거리처럼 스윙이 몇 프레임 재생된 뒤에야 명중 판정이 난다(arena-battle.js와 동일).
                    meleeHitPending[activeSlot] = true;
                    setTimeout(() => {
                        meleeHitPending[activeSlot] = false;
                        applyHit();
                    }, EFFECT_LAUNCH_DELAY_MS);
                });
                if (!walkerRunning) startMeleeWalker();
            } else {
                // 원거리는 공격 애니메이션(윈드업)을 먼저 시작하고, 3프레임쯤 재생된 뒤에야 이펙트가 나간다.
                faceToward(activeSlot, targetSlot);
                playAttackFrames(activeSlot);
                setTimeout(() => {
                    playRangedAttack(activeSlot, targetSlot, applyHit);
                }, EFFECT_LAUNCH_DELAY_MS);
            }
        });

        document.getElementById("dt-move").addEventListener("click", () => {
            if (!activeSlot || !units[activeSlot]) { log("먼저 전장에서 캐릭터를 클릭해 활성 유닛을 선택하세요."); return; }
            const el = document.querySelector(`[data-unit="${activeSlot}"]`);
            const forwardSign = activeSlot.startsWith("attacker") ? 1 : -1;
            advancedSlot[activeSlot] = !advancedSlot[activeSlot];
            const offset = advancedSlot[activeSlot] ? forwardSign * 120 : 0;
            el.style.transition = "transform 0.4s ease";
            el.style.transform = `translateX(${offset}px)`;
            log(`[수동] ${units[activeSlot].name} 이동 ${advancedSlot[activeSlot] ? "(전진)" : "(복귀)"}`);
        });

        document.getElementById("dt-use-skill").addEventListener("click", () => {
            if (!activeSlot || !units[activeSlot]) { log("먼저 전장에서 캐릭터를 클릭해 활성 유닛을 선택하세요."); return; }

            const cfg = configEl(activeSlot);
            const charName = cfg.querySelector(".dt-char-select").value;
            const star = cfg.querySelector(".dt-star-select").value;
            const catalog = catalogOf(charName);
            const skillMech = catalog?.skill_mechanics;
            const starDefaultParams = skillMech ? skillMech.params[star] : null;
            if (!skillMech || !starDefaultParams) {
                log(`${charName}은(는) ${star}성에 스킬이 없습니다.`);
                return;
            }

            let params = starDefaultParams;
            const raw = cfg.querySelector(".dt-skill-params").value.trim();
            if (raw) {
                try { params = JSON.parse(raw); } catch (err) { log(`스킬 파라미터 JSON 오류: ${err.message}`); return; }
            }

            const actorSlot = activeSlot;
            const imgEl = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
            imgEl?.classList.add("casting");
            // 강승유 전용: 시전 중에는 금빛 펄스 대신 무지개빛으로 물든다.
            if (units[actorSlot]?.name === "강승유") imgEl?.classList.add("casting-rainbow");
            const MANUAL_CAST_MS = 600;
            playCastFrames(actorSlot, MANUAL_CAST_MS);
            log(`[수동] ${units[actorSlot].name} 스킬 시전 시작 (${skillMech.effect_type})`);

            // 수동 모드는 실제 서버 캐스팅 시간 계산 없이 고정 지연만 흉내낸다 - 정확한 타이밍은 "전투 게시"로 확인.
            setTimeout(() => {
                imgEl?.classList.remove("casting", "casting-rainbow");
                // 시전 프레임 루프가 아직 돌고 있으면 즉시 멈추고 평상시 자세로 되돌린다.
                attackAnimTokens[actorSlot] = (attackAnimTokens[actorSlot] || 0) + 1;
                attackAnimActive[actorSlot] = false;
                // 실제 효과(데미지/버프/디버프/회복/기절/실드/소환)를 로컬 유닛 상태에 그대로 적용한다.
                // 이의진(self_type_swap_heal)처럼 이 안에서 isType2가 토글될 수 있으므로, 평상시 자세로
                // 되돌리는 스냅은 핸들러 실행 "후"에 해야 새 상태(type2)의 스프라이트로 정확히 돌아간다.
                const handler = MANUAL_SKILL_HANDLERS[skillMech.effect_type];
                const result = handler ? handler(actorSlot, params) : { text: "(이 효과 타입은 아직 수동 시뮬레이션이 없습니다)" };
                if (imgEl && units[actorSlot]) {
                    imgEl.src = `${OUTFIT_IMAGE_BASE}${units[actorSlot].outfit}/battle_idle${spriteVariantSuffix(actorSlot)}.png`;
                }

                // 강승유(copy_target_skill)가 실제로 복제한 스킬은 result.copiedEffectType에 담겨온다 -
                // 있으면 그걸 기준으로 카테고리/전용 연출을 분기해서 원본 스킬과 동일하게 재생되게 한다.
                const dispatchEffectType = result.copiedEffectType || skillMech.effect_type;

                // 시전자 몸이 카테고리 색으로 번쩍이던 예전 연출은 제거 - 오라는 효과를 "받은" 대상에게만
                // 나왔다가 사라진다(arena-battle.js와 동일). 자기 자신에게 거는 효과(버프/실드)는
                // 시전자가 곧 수신자이므로 시전자에게 뜬다.
                if (dispatchEffectType === "self_stack_buff") {
                    flashEffectAura(actorSlot, "buff");
                    setStatusIcon(actorSlot, "atk_up", { source: `${actorSlot}:self_stack_buff`, weight: units[actorSlot].status.stackCount });
                } else if (dispatchEffectType === "self_shield_duration") {
                    flashEffectAura(actorSlot, "special");
                    setStatusIcon(actorSlot, "immune", { source: `${actorSlot}:self_shield_duration`, durationMs: params.seconds * 1000 });
                } else if (dispatchEffectType === "conditional_target_debuff") {
                    // 공격속도 증가는 대상 성별과 무관하게 항상 자신에게 적용된다.
                    flashEffectAura(actorSlot, "buff");
                    setStatusIcon(actorSlot, "atk_speed_up", { source: `${actorSlot}:haste`, durationMs: params.haste_seconds * 1000 });
                    if (result.stunned && result.targetSlot) {
                        playDualCrayonSkillProjectile(actorSlot, result.targetSlot, () => {
                            flashEffectAura(result.targetSlot, "cc");
                            setStatusIcon(result.targetSlot, "stun", { source: `${actorSlot}:stun`, durationMs: params.stun_seconds * 1000 });
                        });
                    }
                } else if (dispatchEffectType === "stun_target" && result.targetSlot) {
                    flashEffectAura(result.targetSlot, "cc");
                    setStatusIcon(result.targetSlot, "stun", { source: `${actorSlot}:stun`, durationMs: params.seconds * 1000 });
                } else if (dispatchEffectType === "damage_hp_percent_plus_atk" && result.targetSlot) {
                    spawnMeteorProjectile(actorSlot, result.targetSlot, () => {});
                } else if (dispatchEffectType === "aoe_gendered_damage" && result.hits) {
                    result.hits.forEach((hit) => {
                        spawnHeartProjectile(actorSlot, hit.targetSlot, hit.gender === "여" ? "heart-red" : "heart-pink", () => {});
                    });
                } else if (dispatchEffectType === "debuff_atk_and_damage" && result.targetSlot) {
                    playElectricConnector(actorSlot, result.targetSlot, "electric-yellow", 9, null, ELECTRIC_ORIGIN_SKILL);
                    flashEffectAura(result.targetSlot, "debuff");
                    setStatusIcon(result.targetSlot, "atk_down", { source: `${actorSlot}:atk_down`, durationMs: params.debuff_seconds * 1000 });
                } else if (dispatchEffectType === "bonus_damage_knockback" && result.targetSlot) {
                    applyKnockback(result.targetSlot, { distance: 9999, suspendSelfWalker: true });
                    flashEffectAura(result.targetSlot, "cc");
                    setStatusIcon(result.targetSlot, "knockback", { source: `${actorSlot}:knockback`, durationMs: MOMENT_ICON_MS });
                } else if (dispatchEffectType === "aoe_enemy_damage") {
                    spawnGasBreathStream(actorSlot, () => {});
                } else if (dispatchEffectType === "heal_ally_percent_max_hp" && result.targetSlot) {
                    spawnHealingHeart(result.targetSlot, () => {
                        flashEffectAura(result.targetSlot, "heal");
                        setStatusIcon(result.targetSlot, "heal", { source: `${actorSlot}:heal`, durationMs: MOMENT_ICON_MS });
                    });
                } else if (dispatchEffectType === "self_type_swap_heal") {
                    // 이의진 "염색체 변환" - isType2/스프라이트는 위에서 이미 반영됐다. 여기서는 자힐 오라/아이콘만.
                    flashEffectAura(actorSlot, "heal");
                    setStatusIcon(actorSlot, "heal", { source: `${actorSlot}:type_swap_heal`, durationMs: MOMENT_ICON_MS });
                }

                log(`[수동] ${units[actorSlot].name} [Active] 발동! (${skillMech.effect_type}) - ${result.text}`);
            }, MANUAL_CAST_MS);
        });
    }

    // ───────────────────────── 전투 게시: 서버 실제 시뮬레이션 호출 후 재생 ─────────────────────────

    function collectUnitConfig(slot) {
        const cfg = configEl(slot);
        const character_name = cfg.querySelector(".dt-char-select").value;
        const star = Number(cfg.querySelector(".dt-star-select").value);
        const hp = cfg.querySelector(".dt-hp-input").value;
        const atk = cfg.querySelector(".dt-atk-input").value;
        const interval = cfg.querySelector(".dt-interval-input").value;
        const level = cfg.querySelector(".dt-level-input").value;
        const skillParamsRaw = cfg.querySelector(".dt-skill-params").value.trim();

        const body = { character_name, star };
        if (hp) body.hp_override = Number(hp);
        if (atk) body.atk_override = Number(atk);
        if (interval) body.attack_interval_override = Number(interval);
        if (level) body.level_override = Number(level);
        if (skillParamsRaw) {
            try {
                body.skill_params_override = JSON.parse(skillParamsRaw);
            } catch (err) {
                log(`[${slot}] 스킬 파라미터 JSON이 올바르지 않습니다: ${err.message}`);
            }
        }
        return body;
    }

    async function startBattle() {
        walkerRunning = false;
        SLOTS.forEach((slot) => clearAllStatusIcons(slot)); // 서버가 새로 보내는 이벤트로만 상태가 갱신되게, 수동으로 쌓아둔 건 초기화
        Object.keys(walkerSuspended).forEach((slot) => delete walkerSuspended[slot]);
        // 이전 전투에서 남은 배우별 애니메이션 체인도 정리한다 - 이미 완료된(resolved) 체인이라 새
        // 체인이 이어붙어도 기능상 무해하지만, 세션 내 재실행이 잦은 devtest 특성상 위생적으로 비워둔다.
        Object.keys(actorAnimChain).forEach((slot) => delete actorAnimChain[slot]);
        // resetAll과 동일한 이유로 진행 중이던 시전/공격/이동 루프의 토큰도 무효화한다 - 이전 전투가
        // 애니메이션 도중(시전/공격/걷기 중)에 끝나고 곧바로 재시작하면, 그 루프가 여전히 유효하다고
        // 판단해서 새 전투의 화면 위에 이전 전투 캐릭터의 프레임을 계속 덮어쓸 수 있다.
        SLOTS.forEach((slot) => {
            attackAnimTokens[slot] = (attackAnimTokens[slot] || 0) + 1;
            walkAnimTokens[slot] = (walkAnimTokens[slot] || 0) + 1;
            attackAnimActive[slot] = false;
            walkAnimActive[slot] = false;
            rangedResolvePending[slot] = false;
        });

        // 이전 전투에서 남아있던 복제체(summon)는 새 전투 시작 전에 완전히 지운다.
        ["attacker-summon-front", "attacker-summon-back", "defender-summon-front", "defender-summon-back"].forEach((slot) => {
            delete units[slot];
            clearAllStatusIcons(slot);
            const el = document.querySelector(`[data-unit="${slot}"]`);
            if (el) {
                el.hidden = true;
                el.style.transform = "";
                el.querySelector(".battle-unit-img")?.classList.remove("is-clone");
            }
        });
        const body = {
            attacker_front: collectUnitConfig("attacker-front"),
            attacker_back: collectUnitConfig("attacker-back"),
            defender_front: collectUnitConfig("defender-front"),
            defender_back: collectUnitConfig("defender-back"),
        };

        log("전투 게시 요청 중...");
        let res;
        try {
            res = await fetch(`${API_BASE_URL}/devtest/battle`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify(body),
            });
        } catch (err) {
            log(`서버 연결 실패: ${err.message}`);
            return;
        }
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            log(`전투 게시 실패 (${res.status}): ${err.detail || "알 수 없는 오류"}`);
            return;
        }

        const data = await res.json();
        const winnerText = data.attacker_won === true ? "공격" : data.attacker_won === false ? "수비" : "무승부";
        log(`전투 결과 수신 - 이벤트 ${data.events.length}개, 승자: ${winnerText}`);

        const framePrecachePromises = [];
        SLOTS.forEach((slot) => {
            const side = slot.startsWith("attacker") ? "attacker" : "defender";
            const part = slot.endsWith("front") ? "front" : "back";
            const raw = data[`${side}_team`][part];
            units[slot] = {
                name: raw.name, maxHp: raw.max_hp, hp: raw.max_hp, isMelee: raw.is_melee, outfit: raw.outfit, star: raw.star,
                style: RANGED_ATTACK_STYLE[raw.name] || (raw.is_melee ? "melee" : "straight"),
                isType2: false,
            };
            const el = document.querySelector(`[data-unit="${slot}"]`);
            el.style.transform = "translateX(0)";
            el.querySelector(".battle-unit-img")?.classList.remove("is-clone"); // 이전 전투에서 생긴 복제체 색감 초기화
            // 공격/스킬/걷기 프레임 개수 미리 확인(onUnitConfigChange와 동일한 이유) - 캐시돼 있으면 그냥 넘어간다.
            // arena-battle.js와 동일한 이유로 Promise를 모아뒀다가 아래에서 실제로 기다린다 - 안 그러면
            // (특히 devtest는 arena의 1.3초 준비 시간 같은 완충 구간도 없이 곧바로 재생을 시작해서) 첫
            // 스킬에서 캐시 미스가 나 playCastFrames가 자기만의 느린 probe를 다시 돌리는 문제가 있었다.
            framePrecachePromises.push(getAttackFrameCount(units[slot].outfit));
            framePrecachePromises.push(getSkillFrameCount(units[slot].outfit));
            if (units[slot].isMelee) {
                framePrecachePromises.push(getWalkFrameCount(units[slot].outfit));
            }
            // _type2 변형은 이의진 본인만 실제로 쓴다(arena-battle.js와 동일) - 다른 캐릭터에게까지
            // 존재하지도 않는 type2 프레임을 미리 찾아보게 하면 콘솔에 불필요한 404만 남는다.
            if (units[slot].name === "이의진") {
                framePrecachePromises.push(getAttackFrameCount(units[slot].outfit, "_type2"));
                framePrecachePromises.push(getSkillFrameCount(units[slot].outfit, "_type2"));
                if (units[slot].isMelee) {
                    framePrecachePromises.push(getWalkFrameCount(units[slot].outfit, "_type2"));
                }
            }
        });
        renderAll();
        await Promise.all(framePrecachePromises);
        startMeleeWalker();
        playbackOriginWallMs = performance.now();
        playbackOriginEventTime = data.events[0]?.time ?? 0;
        playEvents(data.events, 0);
    }

    function findSlotByName(side, name) {
        const frontSlot = `${side}-front`;
        const backSlot = `${side}-back`;
        const summonFrontSlot = `${side}-summon-front`;
        const summonBackSlot = `${side}-summon-back`;
        if (units[frontSlot]?.name === name) return frontSlot;
        if (units[backSlot]?.name === name) return backSlot;
        if (units[summonFrontSlot]?.name === name) return summonFrontSlot;
        if (units[summonBackSlot]?.name === name) return summonBackSlot;
        return null;
    }

    // side가 주어지면(백엔드가 각 대상에 붙여 보내는 target_side) 그 편에서만 이름을 찾는다 - 이름만으로
    // 찾으면(과거 방식, side 없을 때의 폴백) 같은 캐릭터가 양 팀에 모두 있을 때(미러/유사 편성) 항상
    // "적 쪽 우선"으로 걸려서, own_team을 때리는 효과(aoe_all_others_damage 등)의 대상이 엉뚱하게
    // 적 쪽 동명 캐릭터로 잘못 표시되는 등 실제로 맞은 유닛과 화면에 반영되는 유닛이 어긋날 수 있었다.
    function findHitSlot(actorSide, name, side) {
        if (side) return findSlotByName(side, name);
        const targetSide = actorSide === "attacker" ? "defender" : "attacker";
        return findSlotByName(targetSide, name) || findSlotByName(actorSide, name);
    }

    // 이벤트 재생 시각을 "재생 시작 시점" 기준 절대 목표 시각으로 스케줄하기 위한 기준점.
    // onBattlePosted(또는 재생을 시작하는 지점)이 첫 playEvents() 호출 직전에 채운다.
    let playbackOriginWallMs = 0;
    let playbackOriginEventTime = 0;

    // 안전장치(arena-battle.js와 동일한 이유): cast_start/skill_resolve/"마지막 이벤트" 대기 게이트가
    // 어떤 이유로든 절대 안 풀리면 재생 전체가 영원히 멈춘다 - 같은 대상으로 ANIM_WAIT_TIMEOUT_MS 이상
    // 계속 대기 중이면 그 유닛의 애니메이션 상태를 강제로 idle로 정리하고 진행한다.
    const animWaitStartedAt = {};
    const ANIM_WAIT_TIMEOUT_MS = 1500;

    function shouldForceProceedPast(waitKey) {
        const now = performance.now();
        if (!animWaitStartedAt[waitKey]) {
            animWaitStartedAt[waitKey] = now;
            return false;
        }
        return now - animWaitStartedAt[waitKey] > ANIM_WAIT_TIMEOUT_MS;
    }

    function clearAnimWait(waitKey) {
        delete animWaitStartedAt[waitKey];
    }

    function forceClearAnim(slot) {
        if (!slot) return;
        attackAnimTokens[slot] = (attackAnimTokens[slot] || 0) + 1;
        attackAnimActive[slot] = false;
        const imgEl = document.querySelector(`[data-unit="${slot}"] .battle-unit-img`);
        if (imgEl && units[slot]) {
            imgEl.classList.remove("casting", "casting-rainbow", "attacking");
            imgEl.onerror = null;
            imgEl.src = `${OUTFIT_IMAGE_BASE}${units[slot].outfit}/battle_idle${spriteVariantSuffix(slot)}.png`;
        }
    }

    // slot(배우)별로 애니메이션 단계가 순서대로만 실행되도록 이어붙인다(arena-battle.js와 동일) - 전역
    // 이벤트 커서는 이 반환값을 절대 기다리지 않는다(fire-and-forget). workFn 예외로 체인이 영구히
    // 끊기지 않도록 흡수한다.
    function chainActorAnim(slot, workFn) {
        const prev = actorAnimChain[slot] || Promise.resolve();
        const next = prev.then(workFn).catch(() => {});
        actorAnimChain[slot] = next;
        return next;
    }

    // 다음 애니메이션 단계로 넘어가기 전에 이 배우 자신의 직전 애니메이션이 화면에서 실제로 끝났는지
    // (attackAnimActive)를 기다린다(arena-battle.js와 동일) - 이 배우의 체인 안에서만 대기하므로 다른
    // 배우의 이벤트 처리를 막지 않는다. 기존 워치독을 재사용해 원인을 못 찾아도 무한 대기하지 않는다.
    function waitForAnimIdle(slot) {
        return new Promise((resolve) => {
            function poll() {
                if (!attackAnimActive[slot]) {
                    clearAnimWait(slot);
                    resolve();
                    return;
                }
                if (shouldForceProceedPast(slot)) {
                    forceClearAnim(slot);
                    clearAnimWait(slot);
                    resolve();
                    return;
                }
                requestAnimationFrame(poll);
            }
            poll();
        });
    }

    // 전투가 끝나는 순간까지도 시전/공격 애니메이션이 안 풀린 유닛이 있을 수 있다(arena-battle.js와
    // 동일한 이유) - 결과를 확정하기 직전에 아직 애니메이션 중으로 표시된 유닛을 전부 강제로 idle로 정리한다.
    function forceIdleAllUnits() {
        Object.keys(units).forEach((slot) => {
            if (attackAnimActive[slot]) forceClearAnim(slot);
        });
    }

    // 어느 유닛이든 아직 애니메이션/도착/투사체 처리가 안 끝났으면 "전투 종료" 로그가 먼저 뜨는 걸
    // 막는다(arena-battle.js와 동일) - 배우별 애니메이션 체인(actorAnimChain) 덕분에 여러 배우가 동시에
    // 진행 중일 수 있으므로, "마지막 배우" 한 명만 보던 예전 방식(lastEventActorSlot) 대신 전체 유닛을
    // 순회해서 확인한다.
    function anyActorStillFinishing() {
        return Object.keys(units).some((slot) => {
            if (!units[slot]) return false;
            return attackAnimActive[slot] ||
                (units[slot].isMelee && meleeArrived[slot] === false) ||
                rangedResolvePending[slot] ||
                meleeHitPending[slot] ||
                // 호(자폭 소환수): 명중 판정 자체는 meleeHitPending으로 잡히지만, 그 뒤로도 폭발 파티클/
                // 흔들림 연출이 한동안 더 이어질 수 있다(arena-battle.js와 동일한 이유).
                goldenSelfDestructActive[slot];
        });
    }

    function playEvents(events, index) {
        if (index >= events.length) {
            if (anyActorStillFinishing()) {
                if (!shouldForceProceedPast("lastEvent")) {
                    requestAnimationFrame(() => playEvents(events, index));
                    return;
                }
                // 안전장치 발동 - forceIdleAllUnits(아래)가 애니메이션 정리는 알아서 해준다.
            }
            clearAnimWait("lastEvent");
            forceIdleAllUnits();
            log("=== 전투 종료 ===");
            walkerRunning = false;
            return;
        }

        const event = events[index];
        const actorSide = event.side;
        const targetSide = actorSide === "attacker" ? "defender" : "attacker";
        const actorSlot = event.actor ? findSlotByName(actorSide, event.actor) : null;

        if (event.event_type === "star_effect_resolve") {
            // 성급별 효과(전투 시작 시 1회) - 스탯이 오르내린 대상마다 해당 상태 아이콘을 켠다.
            // 전투 내내 유지되는 영구 효과라 지속시간 없이 사망 전까지 계속 떠 있는다.
            (event.detail?.changes || []).forEach((change) => {
                const changedSlot = findSlotByName(change.target_side, change.target);
                if (!changedSlot) return;
                const source = `${event.actor}:${event.effect_type}`;
                if (change.atk > 0) setStatusIcon(changedSlot, "atk_up", { source });
                if (change.atk < 0) setStatusIcon(changedSlot, "atk_down", { source });
                if (change.hp > 0) setStatusIcon(changedSlot, "maxhp_up", { source });
                if (change.hp < 0) setStatusIcon(changedSlot, "maxhp_down", { source });
                if (change.crit > 0) setStatusIcon(changedSlot, "crit_up", { source });
                if (change.crit_chance > 0) setStatusIcon(changedSlot, "crit_chance_up", { source });
                if (change.rear_priority > 0) setStatusIcon(changedSlot, "rear_priority", { source });
                flashEffectAura(changedSlot, (change.atk < 0 || change.hp < 0) ? "debuff" : "buff");
            });
            log(`[성급효과] ${event.actor} (${event.effect_type}) ${JSON.stringify(event.detail?.changes)}`);
        } else if (event.event_type === "trait_resolve") {
            log(`[특성] ${traitLogText(event)}`);
            if (event.effect_type === "ally_synergy_remove_absorb" && event.detail?.removed) {
                const removedSlot = findSlotByName(actorSide, event.detail.removed);
                if (removedSlot) { units[removedSlot].hp = 0; renderUnit(removedSlot); }
                if (actorSlot) {
                    flashEffectAura(actorSlot, "buff");
                    setStatusIcon(actorSlot, "atk_up", { source: `${actorSlot}:${event.effect_type}` });
                    setStatusIcon(actorSlot, "maxhp_up", { source: `${actorSlot}:${event.effect_type}` });
                }
            } else if (event.effect_type === "ally_synergy_atk_buff" && actorSlot) {
                flashEffectAura(actorSlot, "buff");
                if (event.detail?.hp_percent !== undefined) {
                    setStatusIcon(actorSlot, "maxhp_up", { source: `${actorSlot}:${event.effect_type}` });
                } else {
                    setStatusIcon(actorSlot, "atk_up", { source: `${actorSlot}:${event.effect_type}` });
                }
            } else if (event.effect_type === "dynamic_grant_rear_priority" && event.detail?.partner) {
                const partnerSlot = findSlotByName(actorSide, event.detail.partner);
                if (partnerSlot) {
                    setStatusIcon(partnerSlot, "rear_priority", { source: `${partnerSlot}:${event.effect_type}` });
                }
            }
        } else if (event.event_type === "death_trigger_resolve") {
            // 이영웅 "히포크라테스 선서": 자신이 죽는 순간 아군을 회복.
            (event.detail?.heals || []).forEach((heal) => {
                const healSlot = findSlotByName(actorSide, heal.target);
                if (!healSlot) return;
                units[healSlot].hp = heal.target_hp_after;
                renderUnit(healSlot);
                flashEffectAura(healSlot, "heal");
                setStatusIcon(healSlot, "heal", { source: `${event.actor}:death_heal`, durationMs: 1200 });
            });
            log(`[특성] ${event.actor}의 [Special] 발동! 사망과 함께 아군 회복`);
        } else if (event.event_type === "paint_gain_resolve") {
            // 방임석 "예술가의 혼"(arena-battle.js와 동일) - weight를 "현재 총 보유량"으로 덮어쓰고, 0이면 지운다.
            const paintSlot = findSlotByName(actorSide, event.actor);
            if (paintSlot) {
                const iconId = `paint_${event.detail.color}`;
                const sourceKey = `${paintSlot}:${iconId}`;
                if (event.detail.total > 0) setStatusIcon(paintSlot, iconId, { source: sourceKey, weight: event.detail.total });
                else clearStatusIconSource(paintSlot, iconId, sourceKey);
            }
            log(`[패시브] ${event.actor} +${event.detail.amount} ${event.detail.color} 물감 (합계 ${event.detail.total}) <- ${event.detail.source_actor}`);
        } else if (event.event_type === "neglect_status_resolve") {
            // 방임석 "방임"(arena-battle.js와 동일) - 지속시간 없이 걸어두고, 꺼질 때 직접 지운다.
            const neglectSlot = findSlotByName(actorSide, event.actor);
            if (neglectSlot) {
                if (event.detail?.active) {
                    flashEffectAura(neglectSlot, "cc");
                    setStatusIcon(neglectSlot, "stun", { source: `${neglectSlot}:neglect` });
                    setStatusIcon(neglectSlot, "damage_reduction", { source: `${neglectSlot}:neglect` });
                    if (event.detail.interrupted_cast) interruptCasting(neglectSlot);
                } else {
                    clearStatusIconSource(neglectSlot, "stun", `${neglectSlot}:neglect`);
                    clearStatusIconSource(neglectSlot, "damage_reduction", `${neglectSlot}:neglect`);
                }
            }
            log(`[특성] ${event.actor}의 방임 상태 ${event.detail?.active ? "활성화" : "해제"}`);
        } else if (event.event_type === "lifesteal_status_resolve") {
            // 윤 "선생 고혈"(arena-battle.js와 동일) - 지속시간 없이 걸어두고, 꺼질 때 직접 지운다.
            const lifestealSlot = findSlotByName(actorSide, event.actor);
            if (lifestealSlot) {
                if (event.detail?.active) {
                    flashEffectAura(lifestealSlot, "buff");
                    setStatusIcon(lifestealSlot, "lifesteal", { source: `${lifestealSlot}:lifesteal` });
                } else {
                    clearStatusIconSource(lifestealSlot, "lifesteal", `${lifestealSlot}:lifesteal`);
                }
            }
            log(`[특성] ${event.actor}의 흡혈 상태 ${event.detail?.active ? "활성화" : "해제"}`);
        } else if (event.event_type === "target_lock_resolve") {
            // 백엔드가 새 기본공격 대상을 "확정"한 시점(실제 명중보다 먼저 온다, arena-battle.js와 동일) -
            // 근접 유닛은 이 신호를 받는 즉시 새 목표를 향해 걷기 시작한다.
            const lockTargetSlot = findSlotByName(targetSide, event.target);
            if (
                actorSlot && lockTargetSlot &&
                units[actorSlot]?.isMelee &&
                meleeTargetKey[actorSlot] !== lockTargetSlot
            ) {
                meleeTargetKey[actorSlot] = lockTargetSlot;
                meleeArrived[actorSlot] = false;
            }
        } else if (event.event_type === "cast_start") {
            if (actorSlot) {
                // 이 시전을 지금(디스패치 시점) 토큰으로 못박아둔다(arena-battle.js와 동일한 이유) -
                // interruptCasting은 배우 체인을 거치지 않고 즉시 실행되므로, 이 클로저가 체인에서 자기
                // 차례를 기다리는 동안 다른 배우의 CC가 이 배우를 기절시켜 시전이 취소될 수 있다. 실제로
                // 시작하기 직전 토큰이 그대로인지 다시 확인해서, 다르면(그 사이 취소됨) casting 자세를
                // 아예 시작하지 않는다 - 안 그러면 백엔드가 이미 취소해서 skill_resolve를 절대 안 보낼
                // 시전인데도 재생을 시작해버려서, 마지막 캐스트 프레임에 영구히 멈추는 버그가 있었다.
                //
                // 반드시 "읽기"만 한다(직접 증가시키지 않음, arena-battle.js와 동일한 이유) - 이 시점에
                // 막 끝나가는 3번째 기본공격의 playAttackFrames가 자기 토큰을 쥔 채 프레임 개수 비동기
                // 조회를 기다리고 있을 수 있는데, 여기서 토큰을 올리면 그 호출이 "다른 곳이 이미 새
                // 토큰을 발급했다"고 오인해 애니메이션을 재생하지도 못하고 attackAnimActive를 true로
                // 남긴 채 조용히 중단된다 - 그러면 waitForAnimIdle이 1.5초 워치독에 걸릴 때까지 멈추고,
                // 워치독 자신의 토큰 증가 때문에 이 castDispatchToken 검사도 실패해 캐스팅 애니메이션까지
                // 스킵되는 연쇄 버그("2번 공격 후 시전" + "시전 애니메이션 미재생")로 이어졌었다.
                const castDispatchToken = attackAnimTokens[actorSlot] || 0;
                // 시전 자세/애니메이션은 이 배우 전용 체인에 매달아둔다(arena-battle.js와 동일) - 다른
                // 배우의 이벤트 처리는 전혀 막지 않는다.
                chainActorAnim(actorSlot, async () => {
                    await waitForAnimIdle(actorSlot);
                    if (attackAnimTokens[actorSlot] !== castDispatchToken) return;
                    const castImgEl = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
                    castImgEl?.classList.add("casting");
                    if (event.actor === "강승유") castImgEl?.classList.add("casting-rainbow");
                    await playCastFrames(actorSlot, event.duration * 1000 * PLAYBACK_SPEED);
                });
            }
            log(`[캐스팅] ${event.actor} -> ${event.effect_type} (${event.duration.toFixed(2)}초)`);
        } else if (event.event_type === "skill_resolve") {
            // 강승유(copy_target_skill)는 event.effect_type이 항상 "copy_target_skill"로 찍히지만,
            // 실제로 복제한 원본 효과 이름은 detail.copied_effect_type에 들어있다 - 그게 있으면 그걸
            // 기준으로 연출을 분기해서, 복제한 스킬의 실제 전용 이펙트가 원본과 동일하게 나오게 한다.
            const dispatchEffectType = event.detail?.copied_effect_type || event.effect_type;

            // 이의진 "염색체 변환": 평상시 자세로 되돌아가는 스냅(아래 imgEl.src)이 전환 "후" 모습으로
            // 나와야 하므로, 그 스냅 전에 상태부터 반영해둔다(arena-battle.js와 동일한 순서).
            if (dispatchEffectType === "self_type_swap_heal" && actorSlot && units[actorSlot]) {
                units[actorSlot].isType2 = !!event.detail?.type2_active;
            }

            // 방임 해제 즉시 발동은 cast_start 없이 skill_resolve만 온다(arena-battle.js와 동일한 이유 -
            // 무방비 노출을 막으려고 정상 시전 절차를 건너뛰기 때문). 그대로 두면 시전 자세 없이 곧바로
            // idle로 스냅해버려서 발동감이 없으므로, 순수 연출로만 짧은 시전 자세를 끼워넣는다(백엔드
            // 판정은 이미 끝난 그대로, 재현/딜레이 없음). onNeglectReleasePoseDone은 아래 dispatchEffectType별
            // 분기(이번 이벤트 처리의 나머지, 지금 동기 실행 흐름 안에서 곧 채워짐)가 채워준다 - 이
            // 클로저는 항상 그보다 나중(비동기, playCastFrames가 끝난 뒤)에야 실행되므로 항상 채워진 뒤에 호출된다.
            const isNeglectReleaseTrigger = Boolean(event.detail?.neglect_release_trigger);
            let onNeglectReleasePoseDone = null;
            if (isNeglectReleaseTrigger && actorSlot && units[actorSlot]) {
                chainActorAnim(actorSlot, async () => {
                    await waitForAnimIdle(actorSlot);
                    const poseImgEl = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
                    poseImgEl?.classList.add("casting");
                    await playCastFrames(actorSlot, NEGLECT_RELEASE_POSE_SECONDS * 1000 * PLAYBACK_SPEED);
                    onNeglectReleasePoseDone?.();
                });
            }

            if (actorSlot) {
                // "시전 자세 풀기 + idle 스냅"만 이 배우 전용 체인에 매달아둔다(arena-battle.js와 동일한
                // 이유 - 데이터/상태 아이콘/오라 등 나머지는 지금처럼 즉시 반영해서, 이 배우의 체인이
                // 밀려있는 동안 무관한 다른 배우의 이벤트가 이 대상의 체력을 과거 값으로 되돌리는 회귀를
                // 막는다). cast_start 때 이미 같은 체인에 playCastFrames가 매달려 있으므로, 체인 순서
                // 자체가 "그게 끝나야 idle로 풀림"을 보장한다.
                if (units[actorSlot]) {
                    chainActorAnim(actorSlot, () => {
                        const imgEl = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
                        imgEl?.classList.remove("casting", "casting-rainbow");
                        attackAnimTokens[actorSlot] = (attackAnimTokens[actorSlot] || 0) + 1;
                        attackAnimActive[actorSlot] = false;
                        if (imgEl && units[actorSlot]) {
                            imgEl.src = `${OUTFIT_IMAGE_BASE}${units[actorSlot].outfit}/battle_idle${spriteVariantSuffix(actorSlot)}.png`;
                        }
                        // 청년(밀쳐내기): 이 배우 자신의 시전 자세가 "실제로" 끝난 이 시점에야 밀쳐내기를
                        // 실행한다(arena-battle.js와 동일한 이유 - HP는 아래 동기 분기에서 여전히 즉시 반영).
                        if (dispatchEffectType === "bonus_damage_knockback" && event.detail?.hits?.length) {
                            const hit = event.detail.hits[0];
                            const knockSlot = findHitSlot(actorSide, hit.target, hit.target_side);
                            if (knockSlot) {
                                applyKnockback(knockSlot, { distance: 9999, suspendSelfWalker: true });
                                flashEffectAura(knockSlot, "cc");
                                setStatusIcon(knockSlot, "knockback", { source: `${event.actor}:knockback`, durationMs: MOMENT_ICON_MS });
                                if (event.detail?.interrupted_cast) interruptCasting(knockSlot);
                            }
                        }
                    });
                }
                // 시전자 몸이 카테고리 색으로 번쩍이던 예전 연출은 제거 - 오라는 효과를 "받은" 대상에게만
                // 나왔다가 사라진다(arena-battle.js와 동일).

                if (dispatchEffectType === "self_stack_buff" && event.detail?.stack_count) {
                    flashEffectAura(actorSlot, "buff");
                    setStatusIcon(actorSlot, "atk_up", { source: `${actorSlot}:self_stack_buff`, weight: event.detail.stack_count });
                }

                if (dispatchEffectType === "self_shield_duration" && event.detail?.shield_seconds) {
                    const shieldMs = event.detail.shield_seconds * 1000 * PLAYBACK_SPEED;
                    flashEffectAura(actorSlot, "special");
                    setStatusIcon(actorSlot, "immune", { source: `${actorSlot}:self_shield_duration`, durationMs: shieldMs });
                }

                if (dispatchEffectType === "conditional_target_debuff") {
                    const hasteMs = (event.detail?.haste_seconds || 0) * 1000 * PLAYBACK_SPEED;
                    flashEffectAura(actorSlot, "buff");
                    setStatusIcon(actorSlot, "atk_speed_up", { source: `${actorSlot}:haste`, ...(hasteMs ? { durationMs: hasteMs } : {}) });
                }
            }
            // 복제체(윤영준/강승유)는 기존 전방/후방을 대체하지 않는 추가 유닛 - 시전자 전용 summon 슬롯에
            // 매번 새로 생성한다(clone_slot이 "summon-front"/"summon-back"으로 시전자의 자리를 알려준다,
            // arena-battle.js와 동일). 이미 그 슬롯에 이전 복제체가 있었다면 detail.replaced에 이름이
            // 담겨오지만, 살아있는 아군이 제거되는 일은 없다.
            if (dispatchEffectType === "summon_clone" && event.detail?.summoned) {
                const cloneSlot = `${actorSide}-${event.detail.clone_slot || "summon"}`;
                const caster = actorSlot ? units[actorSlot] : null;

                // 윤(호 출격!): 소환 대가로 자신의 현재 체력을 소모하는 경우(arena-battle.js와 동일한 이유).
                if (caster && event.detail.caster_hp_after != null) {
                    caster.hp = event.detail.caster_hp_after;
                    renderUnit(actorSlot);
                    flashEffectAura(actorSlot, "debuff");
                }

                units[cloneSlot] = {
                    name: event.detail.clone_name,
                    maxHp: event.detail.clone_hp,
                    hp: event.detail.clone_hp,
                    isMelee: caster ? caster.isMelee : true,
                    // clone_sprite_outfit이 있으면(윤의 "호") 시전자가 누구든 항상 이 outfit 폴더의
                    // 그림을 쓴다(arena-battle.js와 동일) - 없으면 시전자 outfit을 그대로 물려받는다.
                    outfit: event.detail.clone_sprite_outfit || (caster ? caster.outfit : null),
                    style: caster ? caster.style : "melee",
                    spriteVariant: event.detail.clone_sprite_variant || "",
                    meleeOverlapPercent: event.detail.clone_melee_overlap_percent || null,
                    // 강승유가 남의 스킬을 복제해서 나온 소환수인지(arena-battle.js와 동일한 이유).
                    isCopy: Boolean(event.detail.copied_from),
                };

                const cloneEl = document.querySelector(`[data-unit="${cloneSlot}"]`);
                const casterEl = actorSlot ? document.querySelector(`[data-unit="${actorSlot}"]`) : null;
                // 복제체는 시전자 본인이 서 있는 바로 그 자리에 생성된다.
                if (cloneEl) {
                    cloneEl.hidden = false;
                    cloneEl.style.transform = ""; // 이전 복제체가 남긴 인라인 transform이 있으면 먼저 지운다
                    // getCurrentTranslateX로 "리셋된 CSS 기본값 포함 현재 translateX"를 읽어서 그 위에
                    // 델타를 더해야 한다 - 절대값으로 통째로 덮어쓰면 summon 슬롯의 CSS 기본 transform이
                    // 상쇄되지 않고 그대로 더 얹혀서 엉뚱한 자리에 생성된다.
                    if (casterEl) {
                        const cloneRect = cloneEl.getBoundingClientRect();
                        const casterRect = casterEl.getBoundingClientRect();
                        const currentCloneX = getCurrentTranslateX(cloneEl);
                        cloneEl.style.transform = `translateX(${currentCloneX + (casterRect.left - cloneRect.left)}px)`;

                        // 시전자는 복제체가 자기 자리를 차지한 만큼, 자기 자신의 스프라이트 너비만큼 뒤로
                        // 밀려난다 - 부드러운 CSS 트랜지션 + 넉백(CC기) 오라/아이콘까지 청년의 넉백과
                        // 동일하다(arena-battle.js와 동일).
                        flashEffectAura(actorSlot, "cc");
                        setStatusIcon(actorSlot, "knockback", { source: `${actorSlot}:knockback`, durationMs: MOMENT_ICON_MS });
                        // 팀 기준 고정 방향이 아니라 지금 보고 있는 방향의 반대로 밀려난다(arena-battle.js와 동일).
                        const summonKnockDir = isFacingFlipped(actorSlot) ? 1 : -1;
                        applyKnockback(actorSlot, {
                            distance: casterRect.width,
                            durationMs: 380,
                            suspendSelfWalker: true,
                            knockDir: summonKnockDir,
                        });
                    }
                }
                // 이전 점유자의 잔여 루프/체인/대기 상태를 전부 정리한다(arena-battle.js와 동일한 이유).
                attackAnimTokens[cloneSlot] = (attackAnimTokens[cloneSlot] || 0) + 1;
                attackAnimActive[cloneSlot] = false;
                rangedResolvePending[cloneSlot] = false;
                meleeHitPending[cloneSlot] = false;
                delete actorAnimChain[cloneSlot];
                delete walkerSuspended[cloneSlot];
                getAttackFrameCount(units[cloneSlot].outfit);
                renderUnit(cloneSlot);
                // "복제" 계열은 전체적으로 푸른 색감이 돌도록(3D 프린트 홀로그램 느낌, arena-battle.js와
                // 동일한 조건) - 윤의 "호"는 소환이라 전용 스프라이트가 있으면 원래 색 그대로 두지만,
                // 강승유가 그 "호"를 복제한 경우(isCopy)는 소환이 아니라 복제이므로 틴트를 씌운다.
                document.querySelector(`[data-unit="${cloneSlot}"] .battle-unit-img`)
                    ?.classList.toggle("is-clone", !units[cloneSlot].spriteVariant || units[cloneSlot].isCopy);
                // 호처럼 다른 스프라이트와 겹쳐도 항상 그 위에 그려져야 하는 소환수(arena-battle.js와 동일).
                document.querySelector(`[data-unit="${cloneSlot}"]`)
                    ?.classList.toggle("render-on-top", Boolean(event.detail.clone_render_on_top));

                // 근거리 복제체는 다른 근접 유닛과 완전히 동일하게 취급한다 - meleeArrived를 false로
                // 두면 이동 루프(tick)가 실제 겹침 여부를 직접 재서 판정하고, 도착이 확인되는 순간에만
                // faceToward를 걸고 공격을 허용한다. 이제 시전자 자리에서 스폰되므로 실제로 걸어서
                // 접근하는 과정을 거친다.
                if (units[cloneSlot].isMelee && actorSlot) {
                    const enemyFrontSlot = opponentFrontSlot(actorSlot);
                    meleeTargetKey[cloneSlot] = enemyFrontSlot;
                    meleeArrived[cloneSlot] = false;
                }
            }
            // 캐릭터 전용 스킬 발사체 연출. 김남옥(여성 대상 기절 성공)·이종복은 투사체가 대상에
            // 닿는 순간에 맞춰 피해/상태 표시를 늦추고, 서민석·임소정은 즉시 반영하면서 투사체만 얹는다.
            if (dispatchEffectType === "conditional_target_debuff" && event.detail?.stunned && actorSlot) {
                const hitSlot = event.detail.target ? findHitSlot(actorSide, event.detail.target, event.detail.target_side) : null;
                if (hitSlot) {
                    playDualCrayonSkillProjectile(actorSlot, hitSlot, () => {
                        flashEffectAura(hitSlot, "cc");
                        setStatusIcon(hitSlot, "stun", {
                            source: `${event.actor}:stun`,
                            durationMs: (event.detail.stun_seconds || 0) * 1000 * PLAYBACK_SPEED,
                        });
                        if (event.detail?.interrupted_cast) interruptCasting(hitSlot);
                    });
                }
            } else if (dispatchEffectType === "stun_target" && event.detail?.hit) {
                const hitSlot = event.detail.target ? findHitSlot(actorSide, event.detail.target, event.detail.target_side) : null;
                if (hitSlot) {
                    flashEffectAura(hitSlot, "cc");
                    setStatusIcon(hitSlot, "stun", {
                        source: `${event.actor}:stun`,
                        durationMs: (event.detail.stun_seconds || 0) * 1000 * PLAYBACK_SPEED,
                    });
                    if (event.detail?.interrupted_cast) interruptCasting(hitSlot);
                }
                // 송주헌 "격차 벌리기": 기절과 함께 피해도 준다 - hits가 있으면 데미지 숫자/체력바도 반영.
                if (event.detail?.hits?.length) {
                    const hit = event.detail.hits[0];
                    const dmgSlot = findHitSlot(actorSide, hit.target, hit.target_side);
                    if (dmgSlot) {
                        units[dmgSlot].hp = hit.target_hp_after;
                        renderUnit(dmgSlot);
                        flashHit(dmgSlot, hit.is_crit, hit.type_multiplier);
                    }
                }
            } else if (dispatchEffectType === "damage_hp_percent_plus_atk" && actorSlot && event.detail?.hits?.length) {
                const hit = event.detail.hits[0];
                const hitSlot = findHitSlot(actorSide, hit.target, hit.target_side);
                if (hitSlot) {
                    const wasAlreadyDead = captureAndApplyHp(hitSlot, hit.target_hp_after);
                    spawnMeteorProjectile(actorSlot, hitSlot, () => {
                        if (wasAlreadyDead) return;
                        renderUnit(hitSlot);
                        flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                    });
                }
            } else if (dispatchEffectType === "aoe_gendered_damage" && actorSlot) {
                (event.detail?.hits || []).forEach((hit) => {
                    const hitSlot = findHitSlot(actorSide, hit.target, hit.target_side);
                    if (!hitSlot) return;
                    units[hitSlot].hp = hit.target_hp_after;
                    renderUnit(hitSlot);
                    flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                    const gender = effectiveGender(hit.target, hitSlot);
                    spawnHeartProjectile(actorSlot, hitSlot, gender === "여" ? "heart-red" : "heart-pink", () => {});
                });
            } else if (dispatchEffectType === "debuff_atk_and_damage" && actorSlot && event.detail?.hits?.length) {
                const hit = event.detail.hits[0];
                const hitSlot = findHitSlot(actorSide, hit.target, hit.target_side);
                if (hitSlot) {
                    units[hitSlot].hp = hit.target_hp_after;
                    renderUnit(hitSlot);
                    flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                    playElectricConnector(actorSlot, hitSlot, "electric-yellow", 9, null, ELECTRIC_ORIGIN_SKILL);
                    flashEffectAura(hitSlot, "debuff");
                    setStatusIcon(hitSlot, "atk_down", {
                        source: `${event.actor}:atk_down`,
                        durationMs: (event.detail?.debuff_seconds || 0) * 1000 * PLAYBACK_SPEED,
                    });
                }
            } else if (dispatchEffectType === "bonus_damage_knockback" && actorSlot && event.detail?.hits?.length) {
                // HP는 여기서 즉시 반영한다 - 실제 밀쳐내기 연출과 그에 딸린 오라/아이콘/interruptCasting은
                // 이 배우 자신의 시전 자세가 실제로 끝나는 시점에 맞춰야 해서 위쪽 체인(chainActorAnim)
                // 안으로 옮겼다(arena-battle.js와 동일한 이유).
                const hit = event.detail.hits[0];
                const hitSlot = findHitSlot(actorSide, hit.target, hit.target_side);
                if (hitSlot) {
                    units[hitSlot].hp = hit.target_hp_after;
                    renderUnit(hitSlot);
                    flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                }
            } else if (dispatchEffectType === "aoe_enemy_damage" && actorSlot) {
                // 가스 숨결이 실제로 닿는 순간에 맞춰 피해/HP/피격 이펙트를 반영한다(arena-battle.js와
                // 동일 - 예전엔 여기서 즉시 반영해서 투사체가 날아가는 중인데 이미 맞은 것처럼 보였다).
                // HP는 지금 즉시 반영(죽음 여부도 함께 캡처)하고, 가스 도착 시점엔 화면만 갱신한다.
                const gasHits = event.detail?.hits || [];
                const gasDeadFlags = gasHits.map((hit) => captureAndApplyHp(findHitSlot(actorSide, hit.target, hit.target_side), hit.target_hp_after));
                spawnGasBreathStream(actorSlot, () => {
                    gasHits.forEach((hit, i) => {
                        if (gasDeadFlags[i]) return;
                        const hitSlot = findHitSlot(actorSide, hit.target, hit.target_side);
                        if (!hitSlot) return;
                        renderUnit(hitSlot);
                        flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                    });
                });
            } else if (dispatchEffectType === "heal_ally_percent_max_hp" && event.detail?.healed) {
                const healSlot = findHitSlot(actorSide, event.detail.target, event.detail.target_side);
                if (healSlot) {
                    const newHp = Math.min(units[healSlot].maxHp, units[healSlot].hp + event.detail.amount);
                    const wasAlreadyDead = captureAndApplyHp(healSlot, newHp);
                    spawnHealingHeart(healSlot, () => {
                        if (wasAlreadyDead) return;
                        renderUnit(healSlot);
                        flashEffectAura(healSlot, "heal");
                        setStatusIcon(healSlot, "heal", { source: `${event.actor}:heal`, durationMs: MOMENT_ICON_MS });
                    });
                }
            } else if (dispatchEffectType === "self_type_swap_heal" && actorSlot) {
                // 이의진 "염색체 변환" - isType2는 위에서 이미 토글해뒀다. 여기서는 자힐 반영 + 오라/아이콘만.
                if (event.detail?.healed_amount) {
                    units[actorSlot].hp = Math.min(units[actorSlot].maxHp, units[actorSlot].hp + event.detail.healed_amount);
                    renderUnit(actorSlot);
                }
                flashEffectAura(actorSlot, "heal");
                setStatusIcon(actorSlot, "heal", { source: `${actorSlot}:type_swap_heal`, durationMs: MOMENT_ICON_MS });
            } else if (dispatchEffectType === "aoe_all_others_damage" && actorSlot && event.detail?.hits?.length) {
                // 불빠따 김어진 "불빠따" - 발밑에서 좌우로 땅불이 번져나가며, 자신을 제외한 아군 1명 +
                // 적 전체를 때린다(arena-battle.js와 동일). 각 대상은 불이 실제로 닿는 시점에 맞춰 반영.
                // HP는 지금 즉시 반영(죽음 여부도 함께 캡처)하고, 불이 도착하는 시점엔 화면만 갱신한다.
                event.detail.hits.forEach((hit) => {
                    hit.__wasAlreadyDead = captureAndApplyHp(findHitSlot(actorSide, hit.target, hit.target_side), hit.target_hp_after);
                });
                spawnGroundFireCanvas(actorSlot, event.detail.hits, (hit) => {
                    if (hit.__wasAlreadyDead) return;
                    const hitSlot = findHitSlot(actorSide, hit.target, hit.target_side);
                    if (!hitSlot) return;
                    renderUnit(hitSlot);
                    flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                });
            } else if (dispatchEffectType === "consume_paint_multi_effect" && actorSlot) {
                // 방임석 "제목은 관객이 정하세요" - 물감 색깔별로 각각 독립된 투사체를 병렬로 날린다
                // (arena-battle.js와 동일). 물감이 하나도 없으면 흰색 단일 투사체로 강한 피해만.
                const d = event.detail || {};
                const hasAnyPaint = d.red || d.blue || d.yellow;

                // 백엔드가 이 스킬 발동 시 보유 물감을 전부 0으로 리셋하는데(arena-battle.js와 동일한
                // 이유), 소모 이벤트 자체엔 그걸 알리는 별도 신호가 없어서 여기서 세 색 아이콘을 직접
                // 지운다 - 안 그러면 소모 전 개수가 화면에 그대로 남는다.
                ["paint_red", "paint_blue", "paint_yellow"].forEach((iconId) => {
                    clearStatusIconSource(actorSlot, iconId, `${actorSlot}:${iconId}`);
                });

                // 물감 계열도 전부 같은 이유(captureAndApplyHp 참고)로 HP는 지금 즉시 반영해서, 무관한
                // 다른 배우 이벤트가 아래 투사체 연출(방임 해제 즉시 발동일 땐 시전 자세 재생까지 끝나야
                // 하므로 더 늦게 뜬다)보다 먼저 처리돼도 체력이 과거 값으로 되돌아가지 않게 한다. 실제
                // 투사체 발사(순수 연출)는 fireConsumePaintVisuals로 묶어서, 평소엔 즉시 실행하고 방임
                // 해제 즉시 발동일 땐 시전 자세가 다 재생된 뒤로 미룬다(arena-battle.js와 동일한 패턴).
                let whiteHit = null;
                let redHit = null;
                let blueHeal = null;
                let stunTargets = null;
                if (!hasAnyPaint && d.hits?.length) {
                    const hit = d.hits[0];
                    const hitSlot = findHitSlot(actorSide, hit.target, hit.target_side);
                    if (hitSlot) {
                        const wasAlreadyDead = captureAndApplyHp(hitSlot, hit.target_hp_after);
                        whiteHit = { hit, hitSlot, wasAlreadyDead };
                    }
                } else {
                    if (d.red && d.hits?.length) {
                        const hit = d.hits[0];
                        const hitSlot = findHitSlot(actorSide, hit.target, hit.target_side);
                        if (hitSlot) {
                            const wasAlreadyDead = captureAndApplyHp(hitSlot, hit.target_hp_after);
                            redHit = { hit, hitSlot, wasAlreadyDead };
                        }
                    }

                    if (d.blue && d.heals?.length) {
                        const heal = d.heals[0];
                        // 회복은 항상 시전자와 같은 편이라 actorSide로 바로 찾는다.
                        const healSlot = findSlotByName(actorSide, heal.target);
                        if (healSlot) {
                            const wasAlreadyDead = captureAndApplyHp(healSlot, heal.target_hp_after);
                            blueHeal = { heal, healSlot, wasAlreadyDead };
                        }
                    }

                    if (d.yellow && d.stunned?.length) {
                        stunTargets = d.stunned;
                    }
                }

                const fireConsumePaintVisuals = () => {
                    if (whiteHit) {
                        const { hit, hitSlot, wasAlreadyDead } = whiteHit;
                        spawnPaintSkillProjectile(actorSlot, hitSlot, "paint-white", () => {
                            if (wasAlreadyDead) return;
                            renderUnit(hitSlot);
                            flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                        });
                    }

                    if (redHit) {
                        const { hit, hitSlot, wasAlreadyDead } = redHit;
                        spawnPaintSkillProjectile(actorSlot, hitSlot, "paint-red", () => {
                            if (wasAlreadyDead) return;
                            renderUnit(hitSlot);
                            flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                        });
                    }

                    if (blueHeal) {
                        const { heal, healSlot, wasAlreadyDead } = blueHeal;
                        spawnPaintSkillProjectile(actorSlot, healSlot, "paint-blue", () => {
                            if (wasAlreadyDead) return;
                            renderUnit(healSlot);
                            flashEffectAura(healSlot, "heal");
                            setStatusIcon(healSlot, "heal", { source: `${event.actor}:paint_heal`, durationMs: MOMENT_ICON_MS });
                        });
                    }

                    if (stunTargets) {
                        const firstStunSlot = findHitSlot(actorSide, stunTargets[0].target, stunTargets[0].target_side);
                        const applyAllStuns = () => {
                            stunTargets.forEach((s) => {
                                const sSlot = findHitSlot(actorSide, s.target, s.target_side);
                                if (!sSlot || units[sSlot].hp <= 0) return;
                                flashEffectAura(sSlot, "cc");
                                setStatusIcon(sSlot, "stun", { source: `${event.actor}:stun`, durationMs: (d.stun_seconds || 0) * 1000 });
                                if (s.interrupted_cast) interruptCasting(sSlot);
                            });
                        };
                        if (firstStunSlot) spawnPaintSkillProjectile(actorSlot, firstStunSlot, "paint-yellow", applyAllStuns);
                        else applyAllStuns();
                    }
                };

                if (isNeglectReleaseTrigger) {
                    onNeglectReleasePoseDone = fireConsumePaintVisuals;
                } else {
                    fireConsumePaintVisuals();
                }
            } else {
                (event.detail?.hits || []).forEach((hit) => {
                    const hitSlot = findHitSlot(actorSide, hit.target, hit.target_side);
                    if (hitSlot) {
                        units[hitSlot].hp = hit.target_hp_after;
                        renderUnit(hitSlot);
                        flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                    }
                });
            }
            log(`[스킬 발동] ${event.actor} (${event.effect_type}) ${JSON.stringify(event.detail)}`);
        } else if (event.event_type === "basic_attack") {
            const targetSlot = findSlotByName(targetSide, event.target);
            // 이 이벤트가 적용되기 "전"에 이미 죽어있었는지 미리 캡처해둔다 - 아래에서 hp를 곧바로
            // 덮어쓰고 나면, 이 공격 자체가 킬(target_hp_after=0)인 정상적인 경우와 "이미 죽은 대상을
            // 뒤늦게 또 때린" 경우를 더 이상 hp만 보고는 구분할 수 없다(arena-battle.js와 동일).
            const targetWasAlreadyDead = targetSlot && units[targetSlot] && units[targetSlot].hp <= 0;
            if (targetSlot) units[targetSlot].hp = event.target_hp_after;
            // 윤(영혼 흡수/선생 고혈): 기본공격에 딸려오는 시전자 자가 회복 데이터도 즉시 반영한다
            // (arena-battle.js와 동일한 이유 - 연출만 아래 applyHitVisual에서 타격 시점에 맞춘다).
            if (actorSlot && units[actorSlot] && event.actor_self_heal) {
                units[actorSlot].hp = event.actor_hp_after;
            }
            // 호(자폭 소환수): 이 공격을 명중시키는 즉시 스스로 죽는다(arena-battle.js와 동일한 이유 -
            // 이미 도착해서 정지한 상태라 걷기 루프에 영향 없다). 연출은 아래 applyHitVisual에서.
            if (actorSlot && units[actorSlot] && event.actor_self_destruct) {
                units[actorSlot].hp = 0;
            }

            function applyHitVisual() {
                if (targetSlot) {
                    renderUnit(targetSlot);
                    flashHit(targetSlot, event.is_crit, event.type_multiplier);
                    // 이의진 type2 기본공격 부가효과(_apply_type2_stun_if_active) - 남성 대상이면 기절.
                    if (event.target_stunned) {
                        flashEffectAura(targetSlot, "cc");
                        setStatusIcon(targetSlot, "stun", {
                            source: `${event.actor}:stun`,
                            durationMs: (event.stun_seconds || 0) * 1000 * PLAYBACK_SPEED,
                        });
                        if (event.interrupted_cast) interruptCasting(targetSlot);
                    }
                }
                if (actorSlot && event.actor_self_heal) {
                    renderUnit(actorSlot);
                    flashEffectAura(actorSlot, "heal");
                    setStatusIcon(actorSlot, "heal", { source: `${actorSlot}:basic_attack_heal`, durationMs: MOMENT_ICON_MS });
                }
                if (actorSlot && event.actor_self_destruct) {
                    renderUnit(actorSlot);
                }
                log(`${event.actor} -> ${event.target} 피해 ${event.damage}${event.is_crit ? " 치명타!" : ""}${event.actor_self_heal ? ` (자가 회복 ${event.actor_self_heal})` : ""}${event.actor_self_destruct ? " (자폭)" : ""}`);
            }

            if (actorSlot && units[actorSlot]?.isMelee) {
                waitForMeleeArrival(actorSlot, targetSlot).then(() => {
                    // 대상이 살아있던 시점에 정당하게 발생한 공격이지만(HP는 이미 위에서 반영됨), 근거리
                    // 유닛이 화면상 실제로 도착하기까지 시간이 걸리는 동안 대상이 다른 이벤트로 먼저 죽었을
                    // 때만 연출을 건너뛴다 - targetWasAlreadyDead는 이 이벤트 적용 전 상태라, 이 공격 자체가
                    // 정상적인 킬인 경우까지 건너뛰지 않는다(그러면 체력바가 안 갱신되고 사망 로그도 없이
                    // 전투만 끝나버리는 버그가 생긴다 - arena-battle.js와 동일).
                    if (targetWasAlreadyDead) return;
                    playAttackFrames(actorSlot);
                    // 호(자폭 소환수): 폭발이 곧 타격이다 - 스윙이 시작되는 이 순간(=아직 명중 판정 전)부터
                    // 이펙트를 먼저 튼다(arena-battle.js와 동일).
                    if (event.actor_self_destruct) playGoldenSelfDestruct(actorSlot);
                    // 근접도 원거리처럼 스윙이 몇 프레임(EFFECT_LAUNCH_DELAY_MS) 재생된 뒤에야 명중
                    // 판정이 난다(arena-battle.js와 동일한 이유).
                    meleeHitPending[actorSlot] = true;
                    setTimeout(() => {
                        meleeHitPending[actorSlot] = false;
                        applyHitVisual();
                    }, EFFECT_LAUNCH_DELAY_MS);
                });
            } else if (actorSlot && targetSlot) {
                // 원거리는 공격 애니메이션(윈드업)을 먼저 시작하고, 3프레임쯤 재생된 뒤에야 이펙트가 나간다.
                // 대상이 등 뒤(허공 공격 버그의 원인이던 케이스)에 있으면 사진을 반전시켜 그쪽으로 발사한다.
                faceToward(actorSlot, targetSlot);
                playAttackFrames(actorSlot);
                rangedResolvePending[actorSlot] = true;
                setTimeout(() => {
                    playRangedAttack(actorSlot, targetSlot, () => {
                        rangedResolvePending[actorSlot] = false;
                        // 근접 분기와 동일한 가드(arena-battle.js와 동일) - 투사체가 날아가는 동안
                        // 대상이 다른 이벤트로 먼저 죽었다면 피격 연출/로그를 다시 띄우지 않는다.
                        if (targetWasAlreadyDead) return;
                        applyHitVisual();
                    });
                }, EFFECT_LAUNCH_DELAY_MS);
            } else {
                if (actorSlot) playAttackFrames(actorSlot);
                applyHitVisual();
            }
        }

        // 이 이벤트를 실제로 "지금" 처리했다는 걸 기준점으로 다시 잡는다(arena-battle.js와 동일한
        // 이유) - cast_start/skill_resolve의 대기 게이트 등으로 이 이벤트 자체가 원래 스케줄보다 늦게
        // 처리됐을 수 있는데, 기준점을 안 갱신하면 그 지연이 다음 이벤트들에 그대로 누적돼서, 시전
        // 애니메이션이 늦게 시작된 만큼 복귀(return) 애니메이션이 재생될 시간도 없이 다음 기본공격이
        // 끼어들어 잘리는 버그가 있었다.
        playbackOriginWallMs = performance.now();
        playbackOriginEventTime = event.time;

        const nextEvent = events[index + 1];
        let delayMs;
        if (nextEvent) {
            const targetWallMs = playbackOriginWallMs + (nextEvent.time - playbackOriginEventTime) * 1000 * PLAYBACK_SPEED;
            // target_lock_resolve는 화면에 아무 것도 그리지 않는 조용한 상태 갱신 이벤트라 최소 16ms
            // 바닥값을 적용할 이유가 없다(arena-battle.js와 동일한 이유) - 넉백처럼 한 틱에 여러 유닛의
            // 타겟이 한꺼번에 재계산되면 이 이벤트가 무더기로 쌓여서, 매번 16ms씩 누적되면 그 뒤의
            // 실제 이벤트들까지 통째로 밀린다.
            const minDelayMs = event.event_type === "target_lock_resolve" ? 0 : 16;
            delayMs = Math.max(minDelayMs, targetWallMs - performance.now());
        } else {
            // arena-battle.js와 동일한 이유(원거리 공격은 attackAnimActive가 꺼진 뒤에도 투사체가
            // 한동안 더 날아가는 중일 수 있다) - 그 시간을 넉넉히 덮는 값을 기다린다.
            delayMs = EFFECT_LAUNCH_DELAY_MS + PROJECTILE_TRAVEL_MS * 2;
        }

        setTimeout(() => playEvents(events, index + 1), delayMs);
    }

    function resetAll() {
        walkerRunning = false;
        document.querySelectorAll(".battle-unit").forEach((el) => {
            el.style.transform = "translateX(0)";
            el.classList.remove("dt-selected", "battle-unit-dead");
            const imgEl = el.querySelector(".battle-unit-img");
            imgEl?.classList.remove("casting", "casting-rainbow", "walking", "attacking", "hit-flash", "crit-flash", "is-clone", "flipped", "effect-aura-flash", "dying", "death-fallback-filter");
            imgEl?.style.removeProperty("--effect-aura-color");
        });
        [...SLOTS, "attacker-summon-front", "attacker-summon-back", "defender-summon-front", "defender-summon-back"].forEach((slot) => {
            clearAllStatusIcons(slot);
            delete facingFlipped[slot];
            delete walkerSuspended[slot];
            delete actorAnimChain[slot];
            // 진행 중이던 시전/공격/이동 루프의 토큰을 무효화한다 - 안 그러면 "초기화" 버튼을 애니메이션
            // 도중(시전/공격/걷기 중)에 눌러도 그 루프의 다음 프레임 체크(attackAnimTokens[slot] !== myToken
            // 같은)가 여전히 유효하다고 판단해서, 방금 새로 설정한 캐릭터의 화면 위에 초기화 이전
            // 캐릭터의 프레임을 계속 덮어써버린다.
            attackAnimTokens[slot] = (attackAnimTokens[slot] || 0) + 1;
            walkAnimTokens[slot] = (walkAnimTokens[slot] || 0) + 1;
            attackAnimActive[slot] = false;
            walkAnimActive[slot] = false;
            rangedResolvePending[slot] = false;
        });
        ["attacker-summon-front", "attacker-summon-back", "defender-summon-front", "defender-summon-back"].forEach((slot) => {
            delete units[slot];
            const el = document.querySelector(`[data-unit="${slot}"]`);
            if (el) el.hidden = true;
        });
        activeSlot = null;
        advancedSlot = {};
        document.getElementById("dt-active-unit-name").textContent = "(전장에서 캐릭터 클릭)";
        document.getElementById("dt-log").innerHTML = "";
        SLOTS.forEach((slot) => onUnitConfigChange(slot));
        log("초기화 완료");
    }

    function init() {
        setupUnitSelection();
        setupManualButtons();
        document.getElementById("dt-start-battle").addEventListener("click", startBattle);
        document.getElementById("dt-reset").addEventListener("click", resetAll);
        loadCatalog();
    }

    init();
})();
