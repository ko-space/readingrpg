// arena-battle.js

(function () {
    "use strict";

    const raw = sessionStorage.getItem("pvp_battle_result");
    const data = raw ? JSON.parse(raw) : null;
    const battleScreen = document.querySelector(".battle-screen");

    if (!data) {
        const loadingOverlay = document.getElementById("battle-loading-overlay");
        if (loadingOverlay) loadingOverlay.hidden = true; // 입장 데이터가 없으면 암전 화면을 계속 띄워둘 이유가 없다
        if (battleScreen) {
            battleScreen.innerHTML =
                `<p class="screen-placeholder" style="padding:40px;text-align:center;">
                    전투 데이터를 찾을 수 없어요. 투기장에서 '전투'를 눌러야 이 창이 정상적으로 열려요.
                </p>`;
        }
        return;
    }

    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;

    // 배속 토글 버튼(battle-speed-toggle)이 재생 도중 이 값을 바꿀 수 있어야 해서 let - applyBattleSpeedState()
    // 참고.
    let playbackSpeed = 0.8;
    // 방임 해제 즉시 발동(cast_start 없는 skill_resolve)에 순수 연출용으로 붙이는 시전 자세 재생
    // 시간 - 백엔드가 시간을 안 주므로(판정은 이미 즉시 끝남) 프론트가 임의로 정한 짧은 고정값.
    const NEGLECT_RELEASE_POSE_SECONDS = 0.6;
    const PREP_MS = 1300;
    const APPROACH_OVERLAP = 1;
    const PROJECTILE_TRAVEL_MS = 220;
    const MAX_ATTACK_FRAMES = 6;
    const MAX_SKILL_FRAMES = 9; // 스킬 시전 전용 사진은 캐릭터당 총 9장까지 넣기로 확정됨
    const MAX_RETURN_FRAMES = 9; // 시전 종료 후 원래 모습으로 복귀하는 전용 사진(return_N.png), 최대 9장
    const MAX_WALK_FRAMES = 6; // 걷기 전용 사진(walk_N.png), attack_N.png와 같은 최대 장수
    const ATTACK_FRAME_DURATION_MS = 60;
    const WALK_FRAME_DURATION_MS = 220;
    const RETURN_FRAME_DURATION_MS = 60; // 복귀 프레임은 서버가 시간을 안 주므로(시전 시간과 무관) 공격 프레임과 같은 고정 속도로 재생
    const EFFECT_LAUNCH_DELAY_MS = ATTACK_FRAME_DURATION_MS * 3; // 원거리 공격: 애니메이션 3프레임쯤 재생된 뒤 이펙트 발사

    // 원거리 5명 전용 기본공격 연출. 여기 없는(=근거리이거나 목록에 없는) 캐릭터는 기존 직선 투사체 그대로.
    const RANGED_ATTACK_STYLE = {
        "윤대웅": "instant_flash",   // 카메라 셔터 플래시 - 투사체 이동 없음
        "김남옥": "crayon",          // 원통형 크레파스 다트 - 포물선, 대상이 전방이면 진분홍/후방이면 푸른색
        "이종복": "text_particles",  // F/=/m/a 네 글자 순차 발사 - 직선
        "임소정": "electric",        // 캐스터-대상을 잠깐 잇는 푸른 전기
        "서민석": "book",            // 책 던지기 - 포물선, 계속 회전
        "이의진": "eye_laser",       // 눈에서 발사되는 레이저 - type1(빨강)/type2(청록) 두 가지, isType2로 분기
        "방임석": "paint_gold",      // 물감 투척 - 직선, 항상 황금빛(기본공격은 물감 색과 무관)
    };

    // 캐릭터별 성별 - 서민석 스킬(하트 색)처럼 대상 성별에 따라 연출이 갈리는 경우에 쓴다.
    // 이의진은 염색체 변환 스킬로 전투 중 성별이 바뀌므로, 이 표는 "기본값"일 뿐이고 실제 판정은
    // effectiveGender(key)가 units[key].isType2를 함께 봐서 처리한다.
    const CHARACTER_GENDER = {
        "윤대웅": "남", "윤영준": "남", "김남옥": "여", "이종복": "남", "임소정": "여",
        "이영웅": "남", "불빠따 김어진": "남", "서민석": "남", "강승유": "남",
        "송주헌": "남", "최재혁": "남", "청년": "남", "강 희": "여", "이의진": "남",
    };

    // 대상의 "지금 이 순간" 성별 - 이의진이 type2(염색체 변환) 상태면 CHARACTER_GENDER의 고정값 대신 "여"로 취급한다.
    function effectiveGender(name, key) {
        if (key && units[key]?.isType2) return "여";
        return CHARACTER_GENDER[name] || "남";
    }

    // 스킬 발동(skill_resolve) 시 어떤 카테고리 연출을 입힐지 - 캐릭터 고유 연출은 devtest.css에서 다듬는다.
    const SKILL_VFX_CATEGORY = {
        self_stack_buff: "buff",
        summon_clone: "summon",
        conditional_target_debuff: "debuff",
        heal_ally_percent_max_hp: "heal",
        self_shield_duration: "shield",
        bonus_damage_knockback: "aoe",
        aoe_gendered_damage: "aoe",
        copy_target_skill: "aoe",
        stun_target: "stun",
        aoe_enemy_damage: "aoe",
        damage_hp_percent_plus_atk: "aoe",
        debuff_atk_and_damage: "debuff",
        aoe_all_others_damage: "aoe",
    };

    const frameCountCache = {};
    const skillFrameCountCache = {};
    const returnFrameCountCache = {};
    const walkFrameCountCache = {};
    const attackAnimActive = {};
    const attackAnimTokens = {};
    // key -> 그 배우의 애니메이션 단계(윈드업 -> 시전 -> 복귀)가 순서대로만 실행되도록 이어붙인
    // Promise 체인(chainActorAnim/waitForAnimIdle 참고). 전역 이벤트 커서(eventIndex)는 이 체인을
    // 절대 기다리지 않는다 - 체인은 오직 "같은 배우 자신의 이전 단계가 끝난 뒤 다음 단계가 시작"만
    // 그 배우 자신에게 보장하고, 다른 배우의 이벤트 처리는 전혀 막지 않는다.
    const actorAnimChain = {};
    // key -> 그 유닛이 쏜 원거리 공격의 투사체/이펙트가 아직 목표에 도달하지 않았는지(playRangedAttack의
    // onArrive 콜백이 아직 안 불렸는지). attackAnimActive는 윈드업 프레임이 끝나면 곧바로 꺼지는데,
    // 실제 피해 반영(HP바 갱신 + 사망 로그)은 투사체가 도착해야 일어나므로 별도로 추적한다 - 마지막
    // 이벤트가 원거리 공격일 때, 투사체가 아직 날아가는 중인데 "전투 종료!"가 먼저 떠버리는 걸 막는다.
    const rangedResolvePending = {};
    // key -> 그 유닛의 근접 기본공격이 스윙은 시작됐지만 아직 명중 판정(applyHitVisual)이 안 났는지 -
    // rangedResolvePending과 동일한 이유. 근접도 이제 원거리처럼 스윙이 몇 프레임 재생된 뒤에야 판정이
    // 나므로(EFFECT_LAUNCH_DELAY_MS), attackAnimActive만으로는(스윙 프레임 수가 적은 캐릭터는 판정
    // 전에 attackAnimActive가 먼저 꺼질 수 있음) "아직 안 끝났다"를 놓칠 수 있어 따로 추적한다.
    const meleeHitPending = {};
    const walkAnimTokens = {};
    const walkAnimActive = {}; // key -> 지금 playWalkFrames 루프가 이미 돌고 있는지(매 tick마다 중복으로 새로 시작하지 않기 위함)

    // 좌측(나) 패널 안의 스크롤 로그 패널. 박스/테두리 없이 배경 위에 색 텍스트만 쌓인다.
    const logPanelEl = document.getElementById("battle-log-panel");

    // 화면 맨 위의 전투 제한시간 카운트다운. battle_engine.py의 MAX_BATTLE_DURATION(회복형 조합 등으로
    // 전투가 안 끝날 때의 강제 종료 상한)과 그대로 대응된다 - 경과 시간이 아니라 "이 시간이 다 되면
    // 강제로 끝난다"는 남은 시간을 mm:ss로 보여준다. 값 자체는 여전히 백엔드의 게임 내 시간(event.time,
    // 초 단위)을 그대로 쓴다 - 실제 기기 시계가 아니라 이벤트가 재생되는 시점의 전투 자체 시간 기준.
    const battleTimerEl = document.getElementById("battle-timer");
    const MAX_BATTLE_DURATION_SECONDS = 180; // backend/battle_engine.py의 MAX_BATTLE_DURATION과 동일하게 유지할 것

    function updateBattleTimer(seconds) {
        if (!battleTimerEl || typeof seconds !== "number") return;
        const total = Math.max(0, Math.floor(MAX_BATTLE_DURATION_SECONDS - seconds));
        const mm = String(Math.floor(total / 60)).padStart(2, "0");
        const ss = String(total % 60).padStart(2, "0");
        battleTimerEl.textContent = `${mm}:${ss}`;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function checkImageExists(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
        });
    }

    // variant("" 또는 "_type2")는 이의진처럼 상태별로 다른 프레임 세트(attack_type2_N.png 등)를 쓰는
    // 캐릭터를 위한 것 - 캐시 키도 variant별로 따로 둬서 type1/type2 프레임 수를 혼동하지 않는다.
    async function getAttackFrameCount(outfit, variant = "") {
        const cacheKey = `${outfit}${variant}`;
        if (frameCountCache[cacheKey] !== undefined) {
            return frameCountCache[cacheKey];
        }

        let count = 0;

        for (let i = 1; i <= MAX_ATTACK_FRAMES; i += 1) {
            const exists = await checkImageExists(
                `${OUTFIT_IMAGE_BASE}${outfit}/attack${variant}_${i}.png`
            );

            if (!exists) break;
            count = i;
        }

        frameCountCache[cacheKey] = count;
        return count;
    }

    // 시전(캐스팅) 전용 프레임(skill_N.png)이 있는지 확인 - attack_N.png와 같은 규칙으로 캐릭터 outfit
    // 폴더 안에서 순서대로 찾는다. 없는 캐릭터는 outfit당 한 번만 404를 확인하고 캐시해서 재확인하지 않는다.
    async function getSkillFrameCount(outfit, variant = "") {
        const cacheKey = `${outfit}${variant}`;
        if (skillFrameCountCache[cacheKey] !== undefined) {
            return skillFrameCountCache[cacheKey];
        }

        let count = 0;

        for (let i = 1; i <= MAX_SKILL_FRAMES; i += 1) {
            const exists = await checkImageExists(
                `${OUTFIT_IMAGE_BASE}${outfit}/skill${variant}_${i}.png`
            );

            if (!exists) break;
            count = i;
        }

        skillFrameCountCache[cacheKey] = count;
        return count;
    }

    // 시전 종료 후 원래 모습으로 복귀하는 전용 프레임(return_N.png)이 있는지 확인 - skill_N.png와 같은 규칙.
    async function getReturnFrameCount(outfit, variant = "") {
        const cacheKey = `${outfit}${variant}`;
        if (returnFrameCountCache[cacheKey] !== undefined) {
            return returnFrameCountCache[cacheKey];
        }

        let count = 0;

        for (let i = 1; i <= MAX_RETURN_FRAMES; i += 1) {
            const exists = await checkImageExists(
                `${OUTFIT_IMAGE_BASE}${outfit}/return${variant}_${i}.png`
            );

            if (!exists) break;
            count = i;
        }

        returnFrameCountCache[cacheKey] = count;
        return count;
    }

    // 걷는 동안 재생되는 전용 프레임(walk_N.png)이 있는지 확인 - attack_N.png와 같은 규칙. 근거리
    // 캐릭터 전용(원거리는 애초에 걷지 않음). 없는 캐릭터는 0이 캐시되고, 그러면 기존처럼 걷기 중에도
    // 사진은 그대로 두고 CSS bob 애니메이션(walking 클래스)만 적용된다(호출부의 폴백).
    async function getWalkFrameCount(outfit, variant = "") {
        const cacheKey = `${outfit}${variant}`;
        if (walkFrameCountCache[cacheKey] !== undefined) {
            return walkFrameCountCache[cacheKey];
        }

        let count = 0;

        for (let i = 1; i <= MAX_WALK_FRAMES; i += 1) {
            const exists = await checkImageExists(
                `${OUTFIT_IMAGE_BASE}${outfit}/walk${variant}_${i}.png`
            );

            if (!exists) break;
            count = i;
        }

        walkFrameCountCache[cacheKey] = count;
        return count;
    }

    /*
     * 로그 한 줄을 새로 추가한다(기존처럼 한 줄을 계속 덮어쓰지 않고 쌓인다).
     * side가 "attacker"면 파란색(아군), "defender"면 빨간색(적군), 그 외(null)는 금색(시스템 메시지).
     * 반환된 엘리먼트를 나중에 다시 손대면(예: 준비 카운트다운) "같은 줄을 계속 갱신"하는 것도 가능하다.
     */
    const MAX_LOG_LINES = 24; // 이보다 많아지면 오래된 줄부터 지움

    // 전투 중 표시(로스터 이름표/로그)에서만 이름을 줄여 보여준다 - 캐릭터 데이터상 정식 이름은
    // "윤 & 호"지만, 소환수 호가 화면에 별도로 나온 뒤엔 이름표/로그에 "윤 & 호"라고 또 쓰는 게
    // 중복돼 보인다. 인벤토리/가챠 등 다른 화면은 이 치환과 무관하게 원래 이름을 그대로 쓴다.
    // 로그 문장은 이름이 "윤 & 호의 공격!"처럼 문장 중간에 부분 문자열로 섞여 나오므로, 정확히
    // 일치하는 이름 하나만 다루는 매핑이 아니라 문자열 치환으로 처리한다.
    const BATTLE_DISPLAY_NAME_OVERRIDES = { "윤 & 호": "윤" };
    function battleDisplayText(text) {
        let result = text;
        for (const [full, short] of Object.entries(BATTLE_DISPLAY_NAME_OVERRIDES)) {
            result = result.replaceAll(full, short);
        }
        return result;
    }

    function appendLog(text, side) {
        if (!logPanelEl) return null;

        // "win"/"lose"/"draw"는 전투 종료 결과 전용 - 승리(초록)/패배(빨강)/무승부(회색)로 구분해서 보여준다.
        const entry = document.createElement("div");
        entry.className = `battle-log-entry ${
            side === "attacker" ? "log-ally" :
            side === "defender" ? "log-enemy" :
            side === "trait" ? "log-trait" :
            side === "win" ? "log-win" :
            side === "lose" ? "log-lose" :
            side === "draw" ? "log-draw" :
            "log-system"
        }`;
        entry.textContent = battleDisplayText(text);
        logPanelEl.appendChild(entry);

        // 맨 위(가장 오래된) 줄부터 지워서, 항상 최근 줄들만 남고 계속 위로 밀려 올라가는 형태가 되게 한다.
        while (logPanelEl.children.length > MAX_LOG_LINES) {
            logPanelEl.removeChild(logPanelEl.firstElementChild);
        }

        logPanelEl.scrollTop = logPanelEl.scrollHeight;
        return entry;
    }

    // 특성 발동 로그는 "발동했다"는 사실뿐 아니라 실제로 어떤 수치가 바뀌었는지까지 보여준다.
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
        return `${event.actor}의 [Special] 발동!`;
    }

    // 윤처럼 전투 로스터 "프로필"(idle 사진) 하나만 별도 그림을 쓰고 싶은 캐릭터용 - battle_idle/
    // attack 등 실제 전투 스프라이트는 그대로 두고 이 로스터 초상화만 idle${variant}.png로 바꾼다.
    // 호는 별도 표에 넣지 않는다 - 이미 units[cloneKey].spriteVariant("_ho")가 있어서 그걸 그대로 쓴다.
    const PROFILE_SPRITE_VARIANT_OVERRIDES = { "윤 & 호": "_yoon" };

    /*
     * 로비와 동일한 avatar-crop.js 규칙을 대표 프로필과 로스터 프로필에 적용한다.
     * HTML의 frame/thumb 요소가 overflow:hidden이므로 확대된 사진이 카드 밖으로 나오지 않는다.
     * variant가 있으면 idle${variant}.png를 먼저 시도하고, 없으면(파일 미준비 등) 평소 idle.png로 대체한다.
     */
    function setPortraitImage(imgEl, outfit, variant = "") {
        if (!imgEl || !outfit) return;

        if (variant) {
            imgEl.onerror = () => {
                imgEl.onerror = null;
                imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/idle.png`;
            };
            imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/idle${variant}.png`;
        } else {
            imgEl.onerror = null;
            imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/idle.png`;
        }

        if (typeof applyAvatarCrop === "function") {
            applyAvatarCrop(imgEl, outfit);
        }
    }

    function buildUnit(rawUnit) {
        return {
            name: rawUnit.name,
            maxHp: rawUnit.max_hp,
            hp: rawUnit.max_hp,
            isMelee: rawUnit.is_melee,
            outfit: rawUnit.outfit,
            star: rawUnit.star,
            style: RANGED_ATTACK_STYLE[rawUnit.name] || (rawUnit.is_melee ? "melee" : "straight"),
            isType2: false, // 이의진 전용: 염색체 변환(self_type_swap_heal) 스킬로 전투 중 true/false 토글됨
        };
    }

    // 이의진처럼 상태(type1/type2)에 따라 다른 스프라이트 파일을 쓰는 캐릭터용 - 평소엔 빈 문자열,
    // isType2가 true면 "_type2"를 붙여서 attack_N_type2.png가 아니라 attack_type2_N.png 규칙을 맞춘다.
    // 윤의 "호"처럼 소환수가 시전자와 같은 outfit 폴더를 공유하면서 접미사로만 구분되는 경우엔
    // units[key].spriteVariant(백엔드 clone_sprite_variant, 예: "_ho")가 우선한다 - summon_clone
    // 처리부에서 설정. 둘 다 없으면(대부분의 캐릭터, 윤영준의 복제체 등) 기존처럼 접미사 없음.
    function spriteVariantSuffix(key) {
        return units[key]?.spriteVariant || (units[key]?.isType2 ? "_type2" : "");
    }

    // 최재혁은 ★3부터 후방 적을 우선 공격한다(battle_engine.py의 _select_basic_attack_target과 동일 규칙).
    // 일반 유닛은 기본적으로 적 전방을 향해 걷다가 첫 공격 이벤트가 오면 실제 타겟으로 재조정되지만,
    // 최재혁은 처음부터 실제 목표(후방)를 알고 있으므로 그 재조정("뜸들임")을 건너뛰고 곧장 걸어간다.
    function initialMeleeTargetKey(key) {
        const side = key.startsWith("attacker") ? "attacker" : "defender";
        const enemySide = side === "attacker" ? "defender" : "attacker";
        const unit = units[key];
        if (unit?.name === "최재혁" && (unit.star || 1) >= 3) {
            return `${enemySide}-back`;
        }
        return `${enemySide}-front`;
    }

    const units = {
        "attacker-front": buildUnit(data.attacker_team.front),
        "attacker-back": buildUnit(data.attacker_team.back),
        "defender-front": buildUnit(data.defender_team.front),
        "defender-back": buildUnit(data.defender_team.back),
    };

    function findUnitKey(side, name) {
        if (units[`${side}-front`].name === name) {
            return `${side}-front`;
        }

        if (units[`${side}-back`].name === name) {
            return `${side}-back`;
        }

        if (units[`${side}-summon-front`] && units[`${side}-summon-front`].name === name) {
            return `${side}-summon-front`;
        }

        if (units[`${side}-summon-back`] && units[`${side}-summon-back`].name === name) {
            return `${side}-summon-back`;
        }

        return null;
    }

    // ===== 좌우 플레이어 패널 =====
    function renderPlayerPanel(side, info) {
        const avatarEl = document.getElementById(`${side}-avatar`);
        const nameEl = document.getElementById(`${side}-name`);
        const levelEl = document.getElementById(`${side}-level`);
        const titleEl = document.getElementById(`${side}-title`);

        if (info.lobby_outfit) {
            setPortraitImage(avatarEl, info.lobby_outfit);
        }

        if (nameEl) nameEl.textContent = info.nickname;
        if (levelEl) levelEl.textContent = info.level;
        if (titleEl) {
            titleEl.textContent = info.title || "칭호 없음";
            // 히든 업적 칭호는 로비 상단바와 동일하게 금색으로 표시 (achievement-toast.css의 공용 클래스)
            titleEl.classList.toggle("title-hidden-shine", !!info.title_is_hidden);
        }
    }

    renderPlayerPanel("attacker", data.attacker_info);
    renderPlayerPanel("defender", data.defender_info);

    // 로스터의 프로필에도 로비와 같은 avatar-crop을 적용한다.
    Object.keys(units).forEach((key) => {
        const rosterEl = document.querySelector(`[data-roster="${key}"]`);
        if (!rosterEl) return;

        const nameEl = rosterEl.querySelector(".roster-unit-name");
        const portraitEl = rosterEl.querySelector(".roster-unit-img");

        if (nameEl) nameEl.textContent = battleDisplayText(units[key].name);
        setPortraitImage(portraitEl, units[key].outfit, PROFILE_SPRITE_VARIANT_OVERRIDES[units[key].name] || "");
    });

    // ===== 중앙 전투 유닛 상태 =====
    // key별로 사망 연출을 이미 재생했는지 - 죽은 뒤에도 hp가 그대로 0인 채로 renderUnit이 계속
    // 다시 불릴 수 있어서(다른 유닛의 이벤트 등), 한 번만 재생되도록 막는다.
    const deathHandled = {};

    // 호(자폭 소환수) 전용: playGoldenSelfDestruct가 진행 중인 키는 자기만의 폭발 연출로 캐릭터를
    // 직접 소멸시키므로, playDeathSequence의 기본 사망 스프라이트 전환(death.png + .dying 페이드)을
    // 건너뛴다 - 사망 로그/로스터 체력바/상태 아이콘 정리 등 나머지 사망 처리는 그대로 진행된다.
    const goldenSelfDestructActive = {};

    // 임소정 전기 이펙트: playElectricBolt가 진행 중인 키는 명중 판정(onArrive) 뒤에도 스파크
    // 잔상이 한동안 더 남아있을 수 있다 - anyActorStillFinishing 참고(잔상이 채 끝나기도 전에
    // "전투 종료!"가 뜨는 걸 막는다).
    const electricBoltActive = {};

    // ===== 바라보는 방향(스프라이트 반전) =====
    // 기본값: 아군은 오른쪽(적진), 적군은 왼쪽(아군진)을 본다. 전투 중 공격 대상이 자기 등 뒤로
    // 넘어가면(예: 최재혁이 적 후방 자리까지 파고든 경우) 그쪽을 바라보도록 사진을 반전한다 -
    // 예전에 근접캐가 허공에 대고 공격하는 것처럼 보이던 버그의 원인이 "방향 전환이 없어서"였다.
    const facingFlipped = {};

    function isFacingFlipped(key) {
        if (facingFlipped[key] === undefined) facingFlipped[key] = key.startsWith("defender");
        return facingFlipped[key];
    }

    function setFacing(key, flipped) {
        if (facingFlipped[key] === flipped) return;
        facingFlipped[key] = flipped;
        const battleEl = document.querySelector(`[data-unit="${key}"]`);
        battleEl?.querySelector(".battle-unit-img")?.classList.toggle("flipped", flipped);
        // 방향이 바뀌면 그림이 넘치는 방향도 반대가 되므로, 히트박스 정렬(왼쪽/오른쪽 끝에 맞춤)도
        // 같이 뒤집어서 항상 "지금 보고 있는 방향 쪽"으로만 넘치게 한다(반대쪽=화면 바깥쪽 넘침 방지).
        battleEl?.classList.toggle("hitbox-flipped", flipped);
    }

    // 대상이 자신의 왼쪽에 있으면 왼쪽을(반전), 오른쪽에 있으면 오른쪽을 바라본다.
    function faceToward(key, targetKey) {
        const el = document.querySelector(`[data-unit="${key}"]`);
        const targetEl = document.querySelector(`[data-unit="${targetKey}"]`);
        if (!el || !targetEl) return;
        const rect = el.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const targetIsLeft = (targetRect.left + targetRect.width / 2) < (rect.left + rect.width / 2);
        setFacing(key, targetIsLeft);
    }

    // 사망 시: 로그 한 줄 + 사망 디폴트 사진(death${variant}.png, 아직 없으면 idle 사진을 흑백으로
    // 임시 대체) + 투명해지면서 가로 실선 무늬로 스캔되듯 사라지는 연출. variant는 battle_idle/attack과
    // 동일하게 spriteVariantSuffix로 정한다 - 윤의 "호"처럼 시전자와 outfit 폴더를 공유하는 소환수도
    // 이걸로 자기 전용 사망 그림(예: death_ho.png)을 따로 쓸 수 있다.
    function playDeathSequence(key) {
        const unit = units[key];
        const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
        if (!unit || !imgEl) return;

        // renderUnit()이 호출되는 시점(피해 반영 콜백 안)에는 아직 그 콜백 뒤쪽의 "피해" appendLog가
        // 실행되지 않은 경우가 많아, 여기서 즉시 로그를 남기면 "사망"이 "피해"보다 먼저 뜬다. 매크로태스크로
        // 한 틱 미뤄서, 같은 콜백 안에서 이어지는(동기) 피해 로그가 먼저 찍히고 그 다음에 사망 로그가 오게 한다.
        setTimeout(() => appendLog(`${unit.name} 사망!`, null), 0);

        // 호(자폭 소환수): playGoldenSelfDestruct가 이미 캐릭터 자체의 소멸(스케일/빛/페이드)을 맡고
        // 있으므로, 여기서 death.png로 바꾸거나 .dying 페이드를 얹지 않는다 - 로그만 남기고 끝낸다.
        if (goldenSelfDestructActive[key]) return;

        const variant = spriteVariantSuffix(key);
        imgEl.classList.remove("death-fallback-filter");
        imgEl.onerror = () => {
            imgEl.onerror = null;
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.png`;
            imgEl.classList.add("death-fallback-filter"); // 전용 사망 그림이 없는 캐릭터는 idle을 흑백으로 임시 대체
        };
        imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/death${variant}.png`;

        imgEl.classList.add("dying");
    }

    function renderUnit(key) {
        const unit = units[key];
        const rosterEl = document.querySelector(`[data-roster="${key}"]`);
        const isDead = unit.hp <= 0;

        if (rosterEl) {
            const hpFillEl = rosterEl.querySelector(".roster-hp-fill");
            const hpPercent = Math.max(0, (unit.hp / unit.maxHp) * 100);

            if (hpFillEl) {
                if (isDead) {
                    // 사망 판정은 즉시 적용되는데 체력바만 애니메이션(0.25초)으로 천천히 줄면,
                    // 그 사이 "안 비었는데 죽은 것"처럼 보인다. 죽었을 땐 트랜지션 없이 바로 0%로 만든다.
                    hpFillEl.style.transition = "none";
                    hpFillEl.style.width = "0%";
                    void hpFillEl.offsetWidth;
                    hpFillEl.style.transition = "";
                } else {
                    hpFillEl.style.width = `${hpPercent}%`;
                }
            }

            rosterEl.classList.toggle("roster-unit-dead", isDead);
        }

        const battleEl = document.querySelector(`[data-unit="${key}"]`);
        if (!battleEl) return;

        const imgEl = battleEl.querySelector(".battle-unit-img");
        if (!imgEl) return;

        // 히트박스(.battle-unit) 정렬도 현재 바라보는 방향을 따라간다 - setFacing에서도 갱신되지만,
        // 여기서도 매번 동기화해두면 어떤 경로로 렌더링되든 항상 최신 방향과 일치한다.
        battleEl.classList.toggle("hitbox-flipped", isFacingFlipped(key));

        if (isDead) {
            if (!deathHandled[key]) {
                deathHandled[key] = true;
                playDeathSequence(key);
                clearAllStatusIcons(key);
            }
        } else {
            deathHandled[key] = false; // 복제체 재소환 등으로 슬롯이 재사용될 때를 대비해 리셋
            goldenSelfDestructActive[key] = false;

            // .dying/.golden-self-destruct는 animation-fill-mode:forwards라서 슬롯이 재사용돼도 그대로
            // 남아있으면 새 스프라이트가 계속 투명하게 보인다 - 살아있을 땐 반드시 지운다.
            imgEl.classList.remove("dying", "death-fallback-filter", "golden-self-destruct");

            if (!attackAnimActive[key]) {
                const variant = spriteVariantSuffix(key);
                imgEl.onerror = () => {
                    imgEl.onerror = null;
                    // type2 전용 idle 사진은 없음(변신은 전투 중 상태라 로비 초상화 idle.png는 안 바뀜) -
                    // battle_idle_type2.png가 없는 캐릭터/오타 등으로 로드 실패해도 평상시 idle로 대체된다.
                    imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.png`;
                };

                imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/battle_idle${variant}.png`;
                imgEl.classList.toggle("flipped", isFacingFlipped(key)); // 방향은 전투 중 동적으로 바뀔 수 있음
            }
        }

        battleEl.classList.toggle("battle-unit-dead", isDead);
    }

    Object.keys(units).forEach(renderUnit);

    // 전투 시작 전 공격/스킬/복귀 프레임 개수를 전부 미리 확인해둔다. 이걸 안 해두면 각 캐릭터가
    // "처음" 스킬을 쓰거나 복귀 애니메이션을 재생할 때 그제서야 프레임 개수를 탐색하는데(최대 9장까지
    // 순차적으로 404 확인), 그 탐색 자체가 실제 시간을 꽤 잡아먹는다 - 그동안 서버가 정해둔 이벤트
    // 타임라인은 그대로 흘러가서, 탐색이 끝나기도 전에 다음 이벤트(skill_resolve 등)가 같은 유닛의
    // 애니메이션 토큰을 갈아치워버리고, 결과적으로 "모든 캐릭터의 첫 스킬 사용"만 애니메이션이 끝까지
    // 재생되지 못하고 중간에 잘리는 버그로 이어졌다. 두 번째 사용부터는 캐시가 이미 있어서 즉시
    // 반환되므로 이 문제가 없었다 - 그래서 아예 전투 시작 시점에 한꺼번에 미리 채워둔다.
    //
    // 이 probe들은 fire-and-forget(await 안 함)이었는데, 그러면 준비 시간(1.3초) 동안 probe가 다
    // 안 끝났을 때(캐릭터 수가 많거나 네트워크가 느릴 때) 전투 첫 스킬이 그 즉시 발동돼버려서, 결국
    // playCastFrames가 캐시 미스로 자기만의 느린 probe를 처음부터 다시 돌리는 - 애초에 이 프리캐시가
    // 막으려던 바로 그 문제가 그대로 재현되는 경우가 있었다(특히 전투 첫 스킬에서 두드러짐). 모든
    // probe의 Promise를 모아뒀다가, 아래에서 전투 시작을 이 전부가 끝날 때까지 실제로 기다리게 한다.
    const framePrecachePromises = [];
    Object.values(units).forEach((unit) => {
        framePrecachePromises.push(getAttackFrameCount(unit.outfit));
        framePrecachePromises.push(getSkillFrameCount(unit.outfit));
        framePrecachePromises.push(getReturnFrameCount(unit.outfit));
        if (unit.isMelee) {
            framePrecachePromises.push(getWalkFrameCount(unit.outfit));
        }
        // _type2 변형은 이의진(염색체 변환) 본인만 실제로 쓴다 - 다른 캐릭터에게까지 존재하지도 않는
        // type2 프레임을 미리 찾아보게 하면 콘솔에 불필요한 404만 남는다.
        if (unit.name === "이의진") {
            framePrecachePromises.push(getAttackFrameCount(unit.outfit, "_type2"));
            framePrecachePromises.push(getSkillFrameCount(unit.outfit, "_type2"));
            framePrecachePromises.push(getReturnFrameCount(unit.outfit, "_type2"));
            if (unit.isMelee) {
                framePrecachePromises.push(getWalkFrameCount(unit.outfit, "_type2"));
            }
        }
    });
    const framePrecacheReady = Promise.all(framePrecachePromises);

    // ===== 근거리 이동: 매 프레임마다 실제 위치를 재서 조금씩 다가가는 방식 =====
    // (예전엔 거리/시간을 미리 계산해서 CSS 트랜지션 하나로 재생했는데, 여러 유닛이 동시에 움직이거나
    // 타겟이 도중에 바뀌면 "그 순간의 정확한 위치"를 미리 맞추기가 매우 까다로웠다. 지금은 그냥 60fps로
    // 계속 "지금 실제 위치 기준으로 조금만 더 가자"를 반복해서, 상대가 같이 움직여도 항상 정확하다.)
    const MOVE_STEP_PX = 3;        // 한 프레임(약 16ms)마다 이동하는 픽셀
    const ARRIVE_THRESHOLD_PX = 2;
    // 이미 도착한(meleeArrived=true) 상태에서 상대가 자기 목표를 향해 계속 걷느라 화면상 위치가 계속
    // 조금씩 흔들리면, ARRIVE_THRESHOLD_PX(2px)는 너무 좁아서 매 프레임 "도착"과 "미도착"을 오간다 -
    // 그때마다 meleeArrived가 false로 풀리는데, 그 순간 마침 큐에 밀려있던 basic_attack 이벤트의
    // waitForMeleeArrival이 도착을 기다리게 되면서, 실제로는 백엔드가 계속 공격을 기록하고 있는데도
    // 화면에는 한동안 아무 공격도 안 일어나는 것처럼 밀렸다가 상대가 완전히 멈춰서야 몰아서 재생되는
    // 버그가 있었다. 한 번 도착하면, 확실히 멀어지기 전까지(이 값을 넘기 전까지)는 다시 "미도착"으로
    // 되돌리지 않는 여유 구간(히스테리시스)을 둔다.
    const LOSE_CONTACT_THRESHOLD_PX = 48;

    const meleeTargetKey = {};              // key -> 지금 다가가야 하는 적 슬롯
    const meleeArrived = {};                // key -> 그 타겟에 이미 도착했는지
    const pendingArrivalResolvers = {};     // key -> 도착을 기다리고 있는 Promise resolve 함수들
    const walkerSuspended = {};             // key -> 이동 루프를 잠깐 멈춰둘지(넉백 트랜지션 중 tick()과 충돌 방지)
    let walkerRunning = false;
    // startMeleeWalker가 다시 호출될 때마다 증가 - attackAnimTokens와 동일한 이유(재시작 시 이전 세대의
    // tick() 루프가 확실히 멈추도록). walkerRunning 하나만 보면, 리셋(false) 직후 아주 짧은 틈에 새
    // 전투가 다시 시작(true)돼서 이전 tick()의 다음 프레임 체크가 "여전히 유효함"으로 오판할 여지가
    // 있다(이 프로젝트에서는 아레나는 전투당 1회만 호출돼 실질적 위험이 없지만, devtest는 같은 화면에서
    // 재시작이 가능해 이 보호가 필요하다).
    let walkerEpoch = 0;

    // unitKey가 targetKey에게 도달하려면 지금 이 순간 기준으로 얼마나 더(어느 방향으로) 움직여야 하는지.
    // 양쪽 다 매 프레임 이 함수로 "실시간" 위치를 재기 때문에, 상대가 동시에 움직여도 항상 정확하다.
    // 대상이 자기 등 뒤(진영 기준 반대편)에 있으면 그쪽 면으로 붙는다 - 진행 방향이 고정돼 있지 않다.
    function getGapToTarget(unitKey, targetKey) {
        const el = document.querySelector(`[data-unit="${unitKey}"]`);
        const targetEl = document.querySelector(`[data-unit="${targetKey}"]`);
        if (!el || !targetEl) return 0;

        const rect = el.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        // overlap이 클수록 "더 깊이 파고들어야"(겹쳐야) 도착 판정이 나서 결과적으로 더 가까이 멈춘다.
        // 윤의 "호"처럼 meleeOverlapPercent가 지정된 유닛은 고정 픽셀(APPROACH_OVERLAP) 대신 자기
        // 히트박스 너비의 그 비율만큼 실제로 파고들어야 도착으로 친다(예: 50 -> 몸의 절반이 상대와
        // 겹쳐야 공격 시작) - summon_clone의 clone_melee_overlap_percent가 전달해준 값.
        const overlapPercent = units[unitKey]?.meleeOverlapPercent;
        const overlap = overlapPercent ? rect.width * overlapPercent / 100 : APPROACH_OVERLAP;

        const myCenter = rect.left + rect.width / 2;
        const targetCenter = targetRect.left + targetRect.width / 2;

        // 내가 대상보다 왼쪽에 있으면 대상의 왼쪽 면에, 오른쪽에 있으면 오른쪽 면에 붙는다.
        return myCenter <= targetCenter
            ? (targetRect.left - rect.right) + overlap
            : (targetRect.right - rect.left) - overlap;
    }

    // 지금 실제로 적용돼있는 translateX 값을 읽는다(누적 이동을 위해 필요).
    function getCurrentTranslateX(el) {
        const value = window.getComputedStyle(el).transform;
        if (!value || value === "none") return 0;
        const match = value.match(/matrix\(([^)]+)\)/);
        if (!match) return 0;
        const parts = match[1].split(",").map(Number);
        return parts[4] || 0;
    }

    // 청년 전용(bonus_damage_knockback): 대상을 "후방으로 이동"한 것으로 취급한다 - 밀려난 뒤 원래
    // 자리로 되돌아오지 않고 그대로 남는다. CSS 트랜지션으로 한 번만 밀어내고 손을 떼는 이유: walker의
    // tick()도 같은 요소의 인라인 transform을 매 프레임 덮어쓰는데, rAF 루프끼리 계속 경합하면 값이
    // 튈 수 있어서 여기서는 "한 번 점프시키고 끝"으로 처리한다. 대상 쪽(밀려난 유닛 자신)이 근거리라
    // 원래 자기 타겟을 향해 walker가 계속 움직이던 중이었다면 그쪽은 그대로 이어지고, 정작 이 대상과
    // 접촉해야 했던 반대 진영 근거리 유닛들은 아래에서 명시적으로 "도착 취소" 처리해서, 실제 거리와
    // 무관하게 다시 걸어서 접근하는 과정을 반드시 거치게 한다(그동안은 waitForMeleeArrival이 공격을 막음).
    // suspendSelfWalker: 밀려나는 대상 자신이 근접 유닛이고 지금 다른 목표를 향해 걸어가던 중이면,
    // walker의 tick()이 매 프레임 같은 요소의 transform을 덮어써서 넉백 트랜지션이 통째로 씹힌다 -
    // 이 옵션을 켜면 트랜지션이 끝날 때까지 그 유닛만 walkerSuspended로 잠깐 재워서 충돌을 막고,
    // 끝나면 자동으로 깨어나 원래 목표를 향해 평소처럼 다시 걸어간다(별도의 "복귀" 연출 불필요).
    // 청년의 기존 적 대상 넉백은 대체로 원거리(비근접) 대상이라 이 문제가 잘 안 드러나서 기본은 꺼둔다.
    function applyKnockback(targetKey, options = {}) {
        const { distance = 170, durationMs = 220, suspendSelfWalker = false, knockDir: knockDirOverride } = options;
        const el = document.querySelector(`[data-unit="${targetKey}"]`);
        if (!el) return;

        // 기본은 자기 진영 뒤쪽으로(팀 기준 고정 방향). knockDir을 명시적으로 넘기면(예: 윤영준의
        // 복제체 생성 넉백 - 지금 보고 있는 방향의 반대로) 그 값을 그대로 쓴다.
        const knockDir = knockDirOverride ?? (targetKey.startsWith("attacker") ? -1 : 1);
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

        if (suspendSelfWalker) walkerSuspended[targetKey] = true;
        el.style.transition = `transform ${durationMs}ms ease-out`;
        requestAnimationFrame(() => {
            el.style.transform = `translateX(${endX}px)`;
        });
        setTimeout(() => {
            el.style.transition = "";
            if (suspendSelfWalker) walkerSuspended[targetKey] = false;
        }, durationMs + 20);

        const casterSidePrefix = targetKey.startsWith("attacker") ? "defender" : "attacker";
        Object.keys(units).forEach((key) => {
            if (!key.startsWith(casterSidePrefix) || !units[key] || !units[key].isMelee) return;
            meleeArrived[key] = false;
        });
    }

    // 근접 유닛이 targetKey에 "도착"했을 때의 마무리 처리를 한 곳에 모은다 - tick()이 gap을 재서 정상
    // 도착한 경우와, 아래 waitForMeleeArrival의 타임아웃으로 강제 도착 처리된 경우가 모두 이걸 거쳐서
    // 걷기 애니메이션 정지/자세 전환/방향 전환/대기 중인 공격 연출 재개를 항상 동일하게 수행한다.
    function markMeleeArrived(key, targetKey) {
        if (meleeArrived[key]) return;
        meleeArrived[key] = true;
        const el = document.querySelector(`[data-unit="${key}"]`);
        const imgEl = el?.querySelector(".battle-unit-img");
        if (imgEl) imgEl.classList.remove("walking");
        stopWalkFrames(key);
        if (imgEl && units[key]) {
            const outfit = units[key].outfit;
            const variant = spriteVariantSuffix(key);
            imgEl.onerror = () => {
                imgEl.onerror = null;
                imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/idle.png`;
            };
            imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/battle_idle${variant}.png`;
        }
        if (targetKey) faceToward(key, targetKey); // 도착하면 대상 쪽을 확실히 바라본다(등 뒤 대상 포함)
        (pendingArrivalResolvers[key] || []).forEach((resolve) => resolve());
        pendingArrivalResolvers[key] = [];
    }

    // 준비시간이 끝나면 호출됨. 모든 근거리 유닛의 최초 목표(적 전방)를 정해두고,
    // 전투가 끝날 때까지 계속 도는 이동 루프를 시작한다.
    function startMeleeWalker() {
        Object.keys(units).forEach((key) => {
            if (!units[key].isMelee) return;
            meleeTargetKey[key] = initialMeleeTargetKey(key);
            meleeArrived[key] = false;
        });

        walkerRunning = true;
        const myEpoch = ++walkerEpoch;

        function tick() {
            if (!walkerRunning || walkerEpoch !== myEpoch) return;

            Object.keys(units).forEach((key) => {
                if (!units[key].isMelee) return;
                if (units[key].hp <= 0) return;
                if (walkerSuspended[key]) return; // 넉백 트랜지션이 끝날 때까지 이 유닛은 건드리지 않는다

                const targetKey = meleeTargetKey[key];
                if (!targetKey) return;

                const el = document.querySelector(`[data-unit="${key}"]`);
                const targetEl = document.querySelector(`[data-unit="${targetKey}"]`);
                if (!el || !targetEl) return;

                const imgEl = el.querySelector(".battle-unit-img");
                const gap = getGapToTarget(key, targetKey);

                // 이미 도착한 상태면, 상대가 자기 목표를 향해 계속 걷느라 화면 위치가 살짝씩 흔들려도
                // (LOSE_CONTACT_THRESHOLD_PX 이내) 다시 걷지 않고 그대로 붙어서 싸운다 - ARRIVE_THRESHOLD_PX
                // 만으로 판정하면 매 프레임 도착/미도착이 갈려서 공격 연출이 밀리는 문제가 있었다.
                if (meleeArrived[key] && Math.abs(gap) <= LOSE_CONTACT_THRESHOLD_PX) {
                    return;
                }

                if (Math.abs(gap) <= ARRIVE_THRESHOLD_PX) {
                    markMeleeArrived(key, targetKey);
                    return;
                }

                meleeArrived[key] = false;
                if (imgEl) imgEl.classList.add("walking");
                // 걷기 전용 사진(walk_N.png)이 있으면 그 프레임을 순환 재생 - 없는 캐릭터는 위의 walking
                // 클래스(bob 애니메이션)만 적용된 채로 원래처럼 걷는다(playWalkFrames 내부 폴백).
                if (!walkAnimActive[key]) {
                    walkAnimActive[key] = true;
                    playWalkFrames(key);
                }

                // 대상이 등 뒤에 있어도 그 방향으로 걸어간다(진행 방향 고정 없음). 이동 방향을 바라보게 반전.
                const step = Math.sign(gap) * Math.min(MOVE_STEP_PX, Math.abs(gap));
                setFacing(key, step < 0);
                const currentX = getCurrentTranslateX(el);
                el.style.transform = `translateX(${currentX + step}px)`;
            });

            requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
    }

    // 안전장치: 목표가 다른 아군을 쫓아 계속 이동 중이면(각자 독립적으로 "자신에게 가장 노출된 적"을
    // 고르므로, 서로가 서로의 목표가 아닌 경우가 흔하다) gap이 끝내 ARRIVE_THRESHOLD_PX 안으로 안
    // 좁혀질 수 있다 - 그러면 이 대기가 자연 도착으로는 영원히 안 풀려서 그 공격의 연출(체력바/사망
    // 로그/공격 애니메이션)이 무기한 보류된다. 이 시간 안에 못 도착하면 강제로 도착 처리하고 진행한다.
    const MELEE_ARRIVAL_TIMEOUT_MS = 6000;

    // 근거리 유닛이 targetKey에 도착할 때까지 기다린다. 타겟이 이전과 다르면(=이전 타겟이 죽어서
    // 새로운 상대를 노려야 하면) 이동 루프가 자동으로 그쪽을 향해 다시 움직이기 시작한다.
    function waitForMeleeArrival(actorKey, targetKey) {
        if (!units[actorKey] || !units[actorKey].isMelee) return Promise.resolve();

        if (meleeTargetKey[actorKey] !== targetKey) {
            meleeTargetKey[actorKey] = targetKey;
            meleeArrived[actorKey] = false;
        }

        if (meleeArrived[actorKey]) return Promise.resolve();

        return new Promise((resolve) => {
            if (!pendingArrivalResolvers[actorKey]) pendingArrivalResolvers[actorKey] = [];
            pendingArrivalResolvers[actorKey].push(resolve);
            // 타임아웃이 걸릴 때 이미 다른 목표로 바뀌어 있었다면 건드리지 않는다 - 그 새 목표를 위한
            // waitForMeleeArrival 호출이 이미 자기 타임아웃을 새로 걸어뒀을 것이다.
            setTimeout(() => {
                if (meleeTargetKey[actorKey] === targetKey) markMeleeArrived(actorKey, targetKey);
            }, MELEE_ARRIVAL_TIMEOUT_MS);
        });
    }

    // ===== 원거리 투사체 =====
    function spawnProjectile(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const fieldEl = document.querySelector(".battle-field");
        const actorImg = document.querySelector(
            `[data-unit="${actorKey}"] .battle-unit-img`
        );
        const targetImg = document.querySelector(
            `[data-unit="${targetKey}"] .battle-unit-img`
        );

        if (!layer || !fieldEl || !actorImg || !targetImg) {
            onArrive();
            return;
        }

        const fieldRect = fieldEl.getBoundingClientRect();
        const actorRect = actorImg.getBoundingClientRect();
        const targetRect = targetImg.getBoundingClientRect();

        const startX =
            actorRect.left + actorRect.width / 2 - fieldRect.left;
        const startY =
            actorRect.top + actorRect.height / 2 - fieldRect.top;
        const endX =
            targetRect.left + targetRect.width / 2 - fieldRect.left;
        const endY =
            targetRect.top + targetRect.height / 2 - fieldRect.top;

        const dot = document.createElement("div");
        dot.className = "projectile-dot";
        dot.style.left = `${startX}px`;
        dot.style.top = `${startY}px`;
        layer.appendChild(dot);

        // 시작 위치를 반드시 한 번 리플로우로 "확정"시킨 뒤에 트랜지션을 걸어야 한다 - requestAnimationFrame
        // 한 번만으로는 부족하다(브라우저가 두 상태 변경을 하나로 묶어버릴 수 있음). 이벤트가 몰려서
        // DOM 변경이 짧은 시간에 여럿 겹치는 상황(예: 두 원거리 캐릭터가 동시에 스킬을 쓸 때)에서
        // 특히 잘 드러났다 - 트랜지션이 아예 발동을 안 하고 투사체가 곧장 목표 지점에 나타나버려서
        // "날아가는 동작이 생략된" 것처럼 보였다. void dot.offsetWidth로 강제 리플로우하면(이 코드베이스의
        // 기존 관례 - playGoldenSelfDestruct의 클래스 재시작과 동일한 기법) 시작 위치가 반드시 한 번
        // 반영된 뒤에야 다음 줄의 변경이 "전환 대상"으로 인식되어 트랜지션이 확실히 재생된다.
        void dot.offsetWidth;
        dot.style.transition =
            `left ${PROJECTILE_TRAVEL_MS}ms linear, ` +
            `top ${PROJECTILE_TRAVEL_MS}ms linear`;
        dot.style.left = `${endX}px`;
        dot.style.top = `${endY}px`;

        setTimeout(() => {
            dot.remove();
            onArrive();
        }, PROJECTILE_TRAVEL_MS);
    }

    function fieldRelativeCenter(el) {
        const fieldEl = document.querySelector(".battle-field");
        const fieldRect = fieldEl.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 - fieldRect.left, y: rect.top + rect.height / 2 - fieldRect.top };
    }

    // start->end 방향의 각도(도) - 회전이 필요한 투사체(크레파스/유성)에 쓴다.
    function angleDeg(start, end) {
        return Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
    }

    // 방임석 기본공격 전용: 황금빛 물감 투척, 직선(기본공격은 물감 색과 무관하게 항상 황금빛).
    function spawnPaintProjectile(actorKey, targetKey, colorClass, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const dot = document.createElement("div");
        dot.className = `paint-projectile ${colorClass}`;
        dot.style.left = `${start.x}px`;
        dot.style.top = `${start.y}px`;
        layer.appendChild(dot);

        // 시작 위치를 강제 리플로우로 확정시킨 뒤에 트랜지션을 건다(spawnProjectile 참고).
        void dot.offsetWidth;
        dot.style.transition = `left ${PROJECTILE_TRAVEL_MS}ms linear, top ${PROJECTILE_TRAVEL_MS}ms linear`;
        dot.style.left = `${end.x}px`;
        dot.style.top = `${end.y}px`;

        setTimeout(() => {
            dot.remove();
            onArrive();
        }, PROJECTILE_TRAVEL_MS);
    }

    // 방임석 스킬 전용: 물감 투척, 포물선. colorClass로 색 지정 - 물감이 없으면 흰색, 있으면
    // 소모한 물감 색(빨강/파랑/노랑) 중 대표색 하나(우선순위: 빨강>노랑>파랑, 아래 호출부에서 결정).
    function spawnPaintSkillProjectile(actorKey, targetKey, colorClass, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const dot = document.createElement("div");
        dot.className = `paint-projectile ${colorClass}`;
        layer.appendChild(dot);

        animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 60, onArrive);
    }

    // ===== 이의진 전용: 눈에서 발사되는 레이저 =====
    // .battle-unit-img는 width/height가 고정된 박스이고 실제 그림은 object-fit:contain +
    // object-position:bottom center로 그 안에 들어간다 - 세로가 긴 인물 그림이라 항상 "박스 높이에
    // 맞춰 축소되고, 가로는 중앙 정렬"되는 쪽으로 렌더링된다(그래서 그림의 실제 가로 폭은 박스보다
    // 좁고, 상하는 박스와 정확히 일치). 그래서 "눈 위치"처럼 그림 안의 특정 지점을 조준하려면
    // 박스 중심이 아니라 실제로 그려지는 그림의 사각형을 다시 계산해야 한다.
    //
    // fx/fy는 그 그림(현재 표시된 attack 프레임 원본 픽셀 기준) 안에서 눈이 있는 비율(0~1, 왼쪽위 기준).
    // ▶ 레이저가 엉뚱한 위치에서 나가면 여기 두 값만 고치면 된다 - fx를 늘리면 오른쪽으로,
    //   fy를 늘리면 아래쪽으로 발사 지점이 이동한다. type1은 attack_1.png, type2는 attack_type2_1.png
    //   기준으로 눈금을 맞췄다(공격 프레임 3번째 즈음에 발사되므로 attack_3 기준으로 다시 맞춰도 된다).
    const EYE_LASER_ORIGIN = {
        type1: { fx: 0.63, fy: 0.12 },
        type2: { fx: 0.48, fy: 0.17 },
    };

    // imgEl 안에서 (fracX, fracY) 비율 위치에 해당하는 화면 좌표를 .battle-field 기준 상대좌표로 계산한다.
    // (object-fit:contain + object-position:bottom center 규칙을 그대로 재현 - renderUnit 등에서 쓰는
    // .battle-unit-img CSS와 반드시 같이 맞춰야 한다.) flipped(좌우 반전) 상태면 fracX도 뒤집는다.
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
            // 이 프로젝트의 인물 그림들은 대부분 세로로 길어서 실제로는 잘 안 타는 분기지만, 혹시
            // 가로로 더 넓은 그림이 들어오면(폭 기준으로 맞춰짐) 원칙대로 계산해둔다.
            renderW = boxRect.width;
            renderH = renderW / imgAspect;
            renderLeft = boxRect.left;
            renderTop = boxRect.bottom - renderH; // object-position: bottom
        } else {
            renderH = boxRect.height;
            renderW = renderH * imgAspect;
            renderTop = boxRect.top;
            renderLeft = boxRect.left + (boxRect.width - renderW) / 2; // object-position: center(가로)
        }

        const flipped = imgEl.classList.contains("flipped");
        const effFracX = flipped ? (1 - fracX) : fracX;

        return {
            x: renderLeft + effFracX * renderW - fieldRect.left,
            y: renderTop + fracY * renderH - fieldRect.top,
        };
    }

    // 이의진 기본공격 전용: 눈에서 대상까지 레이저 빔이 "자라나며" 뻗어나간다. 폭(width)을 0에서
    // 실제 거리까지 트랜지션으로 늘리는 방식이라, 빔의 끝(대상 쪽)이 실제로 화면 위에서 대상 위치에
    // 도달하는 시점과 onArrive 호출 시점이 정확히 일치한다 - 즉 "빔이 직접 닿아야" 피해/기절 판정이
    // 반영된다(다른 투사체들의 onArrive 패턴과 동일한 원칙). variant는 "type1"(빨강) / "type2"(청록).
    function spawnEyeLaserBeam(actorKey, targetKey, variant, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const origin = EYE_LASER_ORIGIN[variant] || EYE_LASER_ORIGIN.type1;
        const start = imageContentPoint(actorImg, origin.fx, origin.fy);
        const end = fieldRelativeCenter(targetImg);
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        const angle = angleDeg(start, end);
        // 거리에 비례한 이동시간 - 기존 직선 투사체(PROJECTILE_TRAVEL_MS, 필드 절반 거리 기준 감각)와
        // 비슷하게 맞추되 빔이라 조금 더 빠르게 뻗어나간다.
        const durationMs = Math.max(110, distance * 0.6);

        const wrap = document.createElement("div");
        wrap.className = `eye-laser-wrap eye-laser-${variant}`;
        wrap.style.left = `${start.x}px`;
        wrap.style.top = `${start.y}px`;
        wrap.style.width = "0px";
        wrap.style.transform = `rotate(${angle}deg)`;
        wrap.innerHTML = `
            <div class="eye-laser-glow"></div>
            <div class="eye-laser-core"></div>
        `;
        layer.appendChild(wrap);

        // 발사 지점(눈)에서 잠깐 번쩍이는 발광 - eye_laser_switch.html의 origin-flare에 해당.
        const flare = document.createElement("div");
        flare.className = `eye-laser-flare eye-laser-flare-${variant}`;
        flare.style.left = `${start.x}px`;
        flare.style.top = `${start.y}px`;
        layer.appendChild(flare);

        // 시작 상태(width:0)를 강제 리플로우로 확정시킨 뒤에 트랜지션을 건다(spawnProjectile 참고).
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
    // el은 이미 layer에 붙어있어야 하고, 도착하면 el을 제거하고 onArrive를 부른다.
    //
    // startTime은 반드시 "첫 프레임이 실제로 실행되는 시각"으로 잡아야 한다(호출 시점의 performance.now()가
    // 아니라) - 이벤트가 몰려서 메인 스레드가 잠깐 바빴던 직후처럼 requestAnimationFrame(frame)을 예약한
    // 뒤 브라우저가 첫 콜백을 늦게 불러주면(수백ms 뒤), 그 첫 콜백에서조차 이미 durationMs를 넘겨버려서
    // progress가 곧장 1로 계산되고 - 중간 프레임이 단 한 번도 그려지지 못한 채 투사체가 목표 지점으로
    // "순간이동"해버린다(날아가는 동작이 통째로 생략되는 버그의 원인). 첫 콜백의 now를 기준점으로 삼으면
    // 실제로 얼마나 늦게 시작됐든 상관없이 항상 progress=0인 프레임이 최소 한 번은 그려진다.
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

    // 포물선: 직선 보간 + 사인 곡선으로 위로 솟았다가 내려오는 오프셋을 매 프레임 계산한다(기본 원거리 폴백용).
    function spawnProjectileArc(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const dot = document.createElement("div");
        dot.className = "projectile-dot";
        layer.appendChild(dot);

        animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 70, onArrive);
    }

    // 김남옥 기본공격 전용: 원통형 크레파스 다트, 포물선. 대상이 전방이면 진분홍, 후방/복제체면 푸른색.
    function spawnCrayonProjectile(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const colorClass = targetKey.endsWith("-front") ? "crayon-pink" : "crayon-blue";

        const dot = document.createElement("div");
        dot.className = `crayon-projectile ${colorClass}`;
        dot.style.transform = `rotate(${angleDeg(start, end)}deg)`;
        layer.appendChild(dot);

        animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 60, onArrive);
    }

    // 김남옥 스킬(엑스칼리버) 전용: 진분홍+푸른 크레파스 두 개가 나란히 직선으로 동시에 대상에게 날아간다.
    // 여성 대상(기절 성공)일 때만 재생된다 - 공격판정(기절 표시)은 이 투사체가 닿는 순간에 맞춘다.
    function playDualCrayonSkillProjectile(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const angle = angleDeg(start, end);
        const rad = (angle * Math.PI) / 180;
        const durationMs = PROJECTILE_TRAVEL_MS * 1.4;

        // 다트가 둘이라 onArrive는 먼저 처리되는 쪽 하나에만(중복 방지) 매단다.
        let onArriveScheduled = false;
        ["crayon-pink", "crayon-blue"].forEach((colorClass, i) => {
            // 두 다트가 겹쳐서 하나처럼 안 보이도록, 진행 방향과 수직으로 살짝 어긋나게 띄운다.
            const perp = i === 0 ? -6 : 6;
            const offX = -Math.sin(rad) * perp;
            const offY = Math.cos(rad) * perp;

            const dot = document.createElement("div");
            dot.className = `crayon-projectile ${colorClass}`;
            dot.style.transform = `rotate(${angle}deg)`;
            dot.style.left = `${start.x + offX}px`;
            dot.style.top = `${start.y + offY}px`;
            layer.appendChild(dot);

            // 시작 위치를 강제 리플로우로 확정시킨 뒤에 트랜지션을 건다(spawnProjectile 참고).
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
    function spawnMeteorProjectile(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
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

        // 시작 위치를 강제 리플로우로 확정시킨 뒤에 트랜지션을 건다(spawnProjectile 참고).
        void el.offsetWidth;
        el.style.transition = `left ${durationMs}ms linear, top ${durationMs}ms linear`;
        el.style.left = `${end.x}px`;
        el.style.top = `${end.y}px`;

        setTimeout(() => {
            el.remove();
            onArrive();
        }, durationMs);
    }

    // 강 희 스킬 전용: 얼굴 쪽에서 초록색 부채꼴 입냄새(가스)가 좁은 각도로 길게 뿜어져 나와 맵 끝까지
    // 날아간다(적 전원에게 이미 반영된 피해에 시각 효과만 곁들임). wrap이 위치·회전·사거리(--reach)를
    // 잡고, 그 안의 부채꼴 본체(cone)+입 쪽부터 지워지는 wipe(clear)+연기 덩어리(puff) 5개+작은 입자
    // (particle) 6개가 각자의 CSS 애니메이션으로 순차 재생된다.
    function spawnGasBreathStream(actorKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const fieldEl = document.querySelector(".battle-field");
        if (!layer || !actorImg || !fieldEl) { onArrive(); return; }

        const fieldRect = fieldEl.getBoundingClientRect();
        const isAttacker = actorKey.startsWith("attacker");
        const start = fieldRelativeCenter(actorImg);
        start.y -= 60; // 얼굴 높이 정도로 살짝 위에서 시작
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
        // 연기/입자가 날아가는 거리(--reach)를 실제 사거리(length)에 비례시켜서, 맵 크기가 달라져도
        // 항상 부채꼴 끝부분 근처까지 뻗어나가 보이게 한다.
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
    // 직접 그린다(참고 데모 ground_slam_fire_toggle_optimized.html의 화염/불씨/연기/균열 드로잉 로직을
    // 그대로 옮김). 그 데모는 버튼으로 "번짐"과 "사그라듦"을 따로 눌렀지만, 여기서는 두 단계를 자동으로
    // 이어붙인다 - 좌우 모두 다 번져서(대상 전원에게 닿아서) 시야에 꽉 찬 순간, 곧바로 발밑 쪽부터
    // 좁아지며 사라지는 두 번째 전환으로 넘어간다(참고 데모의 extinguish()와 동일한 방식 - 끝지점은
    // 고정한 채 시작지점만 0→1로 밀고 들어가서, 결과적으로 "발끝부터" 사라지는 것처럼 보인다).
    // 아군 1명 + 적 전체를 동시에 때리는 스킬이라 좌/우 양쪽에 독립적인 최대 사거리를 두고, 각 대상은
    // 불이 실제로 그 x좌표까지 번진 시점(자기 쪽 사거리 대비 거리 비율)에 맞춰 onHit이 불린다.
    function spawnGroundFireCanvas(actorKey, hits, onHit) {
        const layer = document.getElementById("projectile-layer");
        const fieldEl = document.querySelector(".battle-field");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        if (!layer || !fieldEl || !actorImg) { hits.forEach(onHit); return; }

        const fieldRect = fieldEl.getBoundingClientRect();
        const actorRect = actorImg.getBoundingClientRect();
        const groundY = actorRect.bottom - fieldRect.top;
        const casterX = actorRect.left + actorRect.width / 2 - fieldRect.left;

        // 대상마다 캐스터 기준 좌(-1)/우(1) 방향과 거리를 구한다.
        const targets = hits.map((hit) => {
            const hitKey = findHitKey(hit.target, hit.target_side);
            const targetImg = hitKey ? document.querySelector(`[data-unit="${hitKey}"] .battle-unit-img`) : null;
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

        // 참고 데모의 화면 흔들림 - 불이 터지는 충격 연출. 좌우 패널은 .battle-field 바깥이라 안 흔들린다.
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

        // 좌(-1)/우(1) 각각 [start, end](0~1) 구간을 따로 관리한다 - 사거리가 달라서 한쪽이 먼저 다
        // 번지고 먼저 사그라들 수 있다. 번지는 동안은 end가 0->1로 커지고(start는 0 고정), 사그라들
        // 때는 end를 1에 고정한 채 start가 0->1로 따라붙어서 "발끝부터" 사라지는 것처럼 보인다.
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

    // 호(자폭 소환수) 전용 - 사용자가 제공한 참고 데모(golden_self_destruct_optimized.html)의 4단계
    // (charge=응축 -> implode=수축 -> detonate=폭발 -> after=여운)를 캐릭터 스프라이트 크기에 맞춰
    // 이식했다. 데모는 화면 중앙의 캐릭터 하나를 위한 데모였지만, 여기서는 실제 호의 위치/크기를
    // 기준으로 좌표와 반지름을 잡는다. 캐릭터 자체의 빛/스케일/소멸은 CSS(golden-self-destruct-char,
    // arena-battle.css)가 맡고, 여기서는 그 주변에 그려지는 파티클(코어 플래시/링/스파크/연기/스트릭)과
    // 국소 화면 흔들림만 캔버스로 그린다. 실제 사망 처리(HP 반영/사망 로그/roster 등)는 기존과 동일하게
    // 명중 시점에 따로 일어난다 - playDeathSequence가 goldenSelfDestructActive를 보고 자기 몫의 사망
    // 스프라이트 전환만 건너뛴다.
    //
    // 공격 애니메이션이 "시작"되는 시점(스윙 재생 시작, 명중보다 먼저)에 호출한다 - 다른 근접 캐릭터와
    // 마찬가지로 실제 명중 판정은 EFFECT_LAUNCH_DELAY_MS(스윙 몇 프레임 재생 후)에 나므로, charge/implode
    // (응축/수축 - 아직 멀쩡히 빛나기만 하는 "뜸들이는" 구간)를 그 안에 다 압축해서, detonate(폭발/흔들림
    // 절정) 진입 시각이 EFFECT_LAUNCH_DELAY_MS와 정확히 일치하도록 맞췄다 - 화면이 흔들리는 바로 그
    // 순간에 다른 캐릭터들과 동일한 타이밍으로 명중 판정(대상 피격 + 자신의 소멸)이 함께 난다.
    function playGoldenSelfDestruct(actorKey) {
        const layer = document.getElementById("projectile-layer");
        const fieldEl = document.querySelector(".battle-field");
        const imgEl = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        if (!layer || !fieldEl || !imgEl) return;

        goldenSelfDestructActive[actorKey] = true;
        imgEl.classList.remove("golden-self-destruct");
        void imgEl.offsetWidth; // 재시전(재소환 후 재자폭 등) 시에도 애니메이션이 처음부터 다시 재생되도록 리플로우
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

        // 참고 데모와 동일한 방식 - 작은 오프스크린 캔버스에 방사형 그라디언트로 스파크/연기 한 장을
        // 미리 그려두고, 매 프레임 drawImage로 재사용한다(직접 arc를 여러 번 그리는 것보다 훨씬 싸다).
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

        // detonate 단계로 넘어가는 순간 한 번만 호출 - 안쪽으로 모이던 파티클을 비우고 바깥으로 터지는
        // 파티클/연기/스트릭을 새로 채운다(참고 데모의 explode()와 동일).
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
        // detonate(폭발/흔들림 절정) 진입 시각이 다른 근접 캐릭터의 명중 판정 시각(EFFECT_LAUNCH_DELAY_MS)과
        // 정확히 같아야 한다 - charge/implode(응축/수축)를 원래 참고 데모의 비율(480:160 ≈ 3:1)을
        // 유지한 채 그 시간 안에 압축해 넣는다. 폭발 자체(원래도 60ms 안팎의 짧은 burst)와 그 뒤 여운은
        // 원래 데모와 비슷한 길이를 그대로 둔다 - 뜸들이는 시간이 짧아졌다고 폭발/여운까지 짧아질 이유는 없다.
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
                goldenSelfDestructActive[actorKey] = false;
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

            // 이번 프레임에 실제로 그려질 범위(캐릭터 중심 기준 반경)를 링 크기로부터 어림잡아, 매번
            // 필드 전체를 clearRect하는 대신 그만큼만 지운다 - 필드 전체 크기 캔버스를 매 프레임 통째로
            // 지우고 다시 그리는 게 렉의 두 번째 원인이었다(아래 shadowBlur 제거와 함께 호 폭발의
            // 프레임당 비용을 크게 줄인다). 파티클/스모크/스트릭이 링보다 더 멀리 튈 수 있는 극단치까지
            // 감안해 넉넉히(2.6배 + 여유폭) 잡아서 클리핑/잔상이 생길 일은 없게 한다.
            const clearR = Math.max(ringR, ringR2, radius * 0.95) * 2.6 + radius * 1.5;
            const clearX = Math.max(0, cx - clearR);
            const clearY = Math.max(0, cy - clearR);
            const clearW = Math.min(fieldRect.width, cx + clearR) - clearX;
            const clearH = Math.min(fieldRect.height, cy + clearR) - clearY;
            ctx.clearRect(clearX, clearY, clearW, clearH);
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

            // 링은 shadowBlur(도형을 오프스크린에 그려 블러 컨볼루션을 적용하는, Canvas2D에서 가장 비싼
            // 축에 속하는 연산) 대신 굵고 옅은 stroke + 얇고 밝은 stroke 두 겹으로 "번지는" 느낌을
            // 흉내낸다 - 링이 detonate~after 구간에서 캐릭터 크기의 최대 6.5배까지 자라는데, 그 큰
            // 도형에 shadowBlur를 매 프레임 두 겹 적용하는 게 호 폭발 렉의 가장 유력한 원인이었다.
            [[ringR, ringAlpha, Math.max(2, radius * 0.07)], [ringR2, ringAlpha * 0.75, Math.max(1.5, radius * 0.04)]].forEach(([r, a, w]) => {
                if (a <= 0 || r <= 0) return;
                ctx.beginPath();
                ctx.lineWidth = w * 3.2;
                ctx.strokeStyle = `rgba(255, 174, 54, ${a * 0.35})`;
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.stroke();

                ctx.beginPath();
                ctx.lineWidth = w;
                ctx.strokeStyle = `rgba(255, ${180 + Math.floor(a * 40)}, 72, ${a})`;
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.stroke();
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

            // 국소 화면 흔들림 - 김어진의 ground-fire-shake(고정 CSS 키프레임)보다 작고 짧게, 폭발
            // 타이밍(detonate~after)에 맞춰서만 세기가 오르내리도록 직접 계산한다. 호는 작은 소환수라
            // 화면 전체가 크게 흔들리면 과하므로 radius 기준으로 세기를 잡는다.
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

    // 임소정 전기의 발사 시작점
    // fx(오른쪽일수록 값이 큼)/fy(아래쪽일수록 값이 큼)
    const ELECTRIC_ORIGIN_BASIC = { fx: 0.9, fy: 0.27 };
    const ELECTRIC_ORIGIN_SKILL = { fx: 0.9, fy: 0.28 };

    // 임소정 전용 번개 - 참고 데모(blue_chain_and_yellow_ultimate.html)의 지그재그 번개 줄기를 캔버스에
    // 그린다(호의 playGoldenSelfDestruct와 같은 방식: 필드 크기의 캔버스를 만들어 requestAnimationFrame으로
    // 직접 그리다가 끝나면 제거). x1,y1->x2,y2를 여러 구간으로 쪼개고, 각 구간을 진행 방향에 수직인
    // 방향으로 무작위로 흔들어(가운데일수록 많이 흔들리도록 sin 곡선으로 스케일) 지그재그 경로를 만든다.
    function makeLightningPath(x1, y1, x2, y2, segments, wobble) {
        const pts = [{ x: x1, y: y1 }];
        for (let i = 1; i < segments; i++) {
            const t = i / segments;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;
            const nx = -(y2 - y1), ny = (x2 - x1);
            const nLen = Math.hypot(nx, ny) || 1;
            const scale = 0.45 + Math.sin(t * Math.PI) * 0.9;
            pts.push({
                x: x + (nx / nLen) * (Math.random() * 2 - 1) * wobble * scale,
                y: y + (ny / nLen) * (Math.random() * 2 - 1) * wobble * scale,
            });
        }
        pts.push({ x: x2, y: y2 });
        return pts;
    }

    // 번개 줄기 한 가닥을 두 겹으로 그린다 - 바깥쪽(색이 있는 굵은 겹, 그림자 번짐)과 안쪽(거의 흰색인
    // 얇은 코어) - 참고 데모의 drawBolt와 동일한 구성.
    function drawLightningBolt(ctx, pts, width, alpha, isUlt) {
        if (alpha <= 0) return;
        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.shadowBlur = isUlt ? 24 : 18;
        ctx.shadowColor = isUlt ? `rgba(255,210,90,${0.72 * alpha})` : `rgba(120,208,255,${0.62 * alpha})`;
        ctx.strokeStyle = isUlt ? `rgba(255,197,62,${0.92 * alpha})` : `rgba(76,165,255,${0.86 * alpha})`;
        // 굵기(lineWidth)는 기본공격/스킬 공통 - 색/글로우(shadowBlur)만 다르게 해서 굵기 차이 없이
        // 색으로만 구분되게 한다.
        ctx.lineWidth = width + 3;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            const prev = pts[i - 1], cur = pts[i];
            const mx = (prev.x + cur.x) * 0.5, my = (prev.y + cur.y) * 0.5;
            ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();

        ctx.shadowBlur = isUlt ? 10 : 6;
        ctx.strokeStyle = isUlt ? `rgba(255,252,225,${0.97 * alpha})` : `rgba(244,250,255,${0.96 * alpha})`;
        ctx.lineWidth = Math.max(1.2, width * 0.42);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            const prev = pts[i - 1], cur = pts[i];
            const mx = (prev.x + cur.x) * 0.5, my = (prev.y + cur.y) * 0.5;
            ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        }
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
        ctx.restore();
    }

    // 임소정 전용: 캐스터-대상을 잇는 메인 번개 줄기 + 가지 + 스파크(기본공격=isUlt false, 푸른색.
    // 스킬=isUlt true, 노란색+가지 더 많고 스파크 더 많고 착탄 섬광까지 - 굵기는 기본공격과 동일).
    // 충격 링은 넣었다가 뺐다 - 큰 원을 shadowBlur와 함께 매 프레임 그리는 비용이 커서 렉을 유발했다.
    // 전기는 사실상 즉발이라 onArrive는 기존 electric-connector와 동일하게 짧게(80ms)만 대기한 뒤 부른다
    // (null이면 안 부름 - 스킬처럼 이미 피해를 즉시 반영해둔 경우) - 그 뒤로도 스파크 잔상은
    // electricBoltActive가 꺼질 때까지 이어진다.
    function playElectricBolt(actorKey, targetKey, isUlt, onArrive, origin) {
        const layer = document.getElementById("projectile-layer");
        const fieldEl = document.querySelector(".battle-field");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !fieldEl || !actorImg || !targetImg) { if (onArrive) onArrive(); return; }

        const fieldRect = fieldEl.getBoundingClientRect();
        const o = origin || ELECTRIC_ORIGIN_BASIC;
        const start = imageContentPoint(actorImg, o.fx, o.fy);
        const end = fieldRelativeCenter(targetImg);

        electricBoltActive[actorKey] = true;

        const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
        const canvas = document.createElement("canvas");
        canvas.className = "electric-bolt-canvas";
        canvas.style.width = `${fieldRect.width}px`;
        canvas.style.height = `${fieldRect.height}px`;
        canvas.width = Math.round(fieldRect.width * dpr);
        canvas.height = Math.round(fieldRect.height * dpr);
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        layer.appendChild(canvas);

        // 스파크 스프라이트(참고 데모의 makeSpark) - 매 프레임 drawImage로 재사용.
        const sparkSprite = document.createElement("canvas");
        sparkSprite.width = sparkSprite.height = 48;
        const sparkCtx = sparkSprite.getContext("2d");
        const sparkGrad = sparkCtx.createRadialGradient(24, 24, 0, 24, 24, 24);
        sparkGrad.addColorStop(0, "rgba(255,255,255,1)");
        sparkGrad.addColorStop(0.2, isUlt ? "rgba(255,234,154,.96)" : "rgba(194,231,255,.96)");
        sparkGrad.addColorStop(0.5, isUlt ? "rgba(255,186,42,.62)" : "rgba(102,192,255,.58)");
        sparkGrad.addColorStop(1, "rgba(0,0,0,0)");
        sparkCtx.fillStyle = sparkGrad;
        sparkCtx.fillRect(0, 0, 48, 48);

        const bolts = [{
            pts: makeLightningPath(start.x, start.y, end.x, end.y, isUlt ? 13 : 11, isUlt ? 32 : 20),
            life: 0, maxLife: isUlt ? 340 : 220, alpha: 1, width: 3.7,
        }];
        const branchCount = isUlt ? 4 : 2;
        for (let i = 0; i < branchCount; i++) {
            const main = bolts[0].pts;
            const src = main[2 + Math.floor(Math.random() * Math.max(1, main.length - 4))];
            const t = 0.55 + Math.random() * 0.4;
            const spread = isUlt ? 55 : 24;
            bolts.push({
                pts: makeLightningPath(
                    src.x, src.y,
                    start.x + (end.x - start.x) * t + (Math.random() * 2 - 1) * spread,
                    start.y + (end.y - start.y) * t + (Math.random() * 2 - 1) * spread * 0.85,
                    isUlt ? 6 : 5, isUlt ? 20 : 12
                ),
                life: 0, maxLife: isUlt ? 250 : 170, alpha: isUlt ? 0.88 : 0.82, width: 2.1,
            });
        }

        const sparks = [];
        function spawnBoltSpark(atEnd) {
            const baseX = atEnd ? end.x : start.x;
            const baseY = atEnd ? end.y : start.y;
            const a = Math.random() * Math.PI * 2 - Math.PI;
            const speed = (0.6 + Math.random() * 2.0) * (isUlt ? 1.5 : 1);
            sparks.push({
                x: baseX + (Math.random() * 20 - 10), y: baseY + (Math.random() * 20 - 10),
                vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
                size: (isUlt ? 10 : 7) + Math.random() * (isUlt ? 9 : 8),
                life: 0, maxLife: (isUlt ? 280 : 220) + Math.random() * (isUlt ? 240 : 200),
            });
        }
        const sparkCount = isUlt ? 28 : 12;
        for (let i = 0; i < sparkCount; i++) spawnBoltSpark(Math.random() < 0.6);

        const startMs = performance.now();
        const totalMs = isUlt ? 820 : 420;
        const flashUntilMs = isUlt ? startMs + 220 : 0;

        function frame(now) {
            const t = now - startMs;
            if (t >= totalMs) {
                canvas.remove();
                electricBoltActive[actorKey] = false;
                return;
            }
            const dt = 16.67;

            ctx.clearRect(0, 0, fieldRect.width, fieldRect.height);
            ctx.save();
            ctx.globalCompositeOperation = "lighter";

            // 궁극기 착탄 섬광 - 호 자폭 연출(playGoldenSelfDestruct)의 flashAlpha와 같은 방식으로
            // 대상 위치에 짧게 방사형 그라디언트를 반짝인 뒤 사그라뜨린다.
            if (isUlt && now < flashUntilMs) {
                const flashAlpha = Math.max(0, 1 - (flashUntilMs - now) / 220);
                const g = ctx.createRadialGradient(end.x, end.y, 0, end.x, end.y, 70);
                g.addColorStop(0, `rgba(255,250,230,${0.75 * (1 - flashAlpha)})`);
                g.addColorStop(0.4, `rgba(255,228,116,${0.4 * (1 - flashAlpha)})`);
                g.addColorStop(1, "rgba(255,180,0,0)");
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(end.x, end.y, 70, 0, Math.PI * 2);
                ctx.fill();
            }

            for (let i = bolts.length - 1; i >= 0; i--) {
                const b = bolts[i];
                b.life += dt;
                if (b.life >= b.maxLife) { bolts.splice(i, 1); continue; }
                drawLightningBolt(ctx, b.pts, b.width, (1 - b.life / b.maxLife) * b.alpha, isUlt);
            }

            for (let i = sparks.length - 1; i >= 0; i--) {
                const s = sparks[i];
                s.life += dt; s.x += s.vx * dt * 0.06; s.y += s.vy * dt * 0.06; s.vx *= 0.992; s.vy *= 0.992;
                if (s.life >= s.maxLife) { sparks.splice(i, 1); continue; }
                const p = s.life / s.maxLife;
                const size = s.size * (1 - p * 0.25);
                ctx.globalAlpha = 1 - p;
                ctx.drawImage(sparkSprite, s.x - size / 2, s.y - size / 2, size, size);
            }
            ctx.globalAlpha = 1;

            ctx.restore();
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);

        if (onArrive) setTimeout(onArrive, 80);
    }

    // 서민석 기본공격 전용: 책 모양 투사체, 포물선(책이 계속 회전하는 건 CSS 애니메이션이 알아서 함).
    function spawnBookProjectile(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const el = document.createElement("div");
        el.className = "book-projectile";
        layer.appendChild(el);

        animateArcMotion(el, start, end, PROJECTILE_TRAVEL_MS * 1.6, 70, onArrive);
    }

    // 서민석 스킬 전용: 하트 모양 투사체, 포물선. colorClass로 "heart-pink"(남성 대상)/"heart-red"(여성 대상) 지정.
    function spawnHeartProjectile(actorKey, targetKey, colorClass, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const el = document.createElement("div");
        el.className = `heart-projectile ${colorClass}`;
        el.textContent = "❤";
        layer.appendChild(el);

        animateArcMotion(el, start, end, PROJECTILE_TRAVEL_MS * 1.7, 90, onArrive);
    }

    // 이영웅 스킬 전용: 치유 대상 머리 위에서 초록색 하트(가운데 십자가, 노란 오라)가 천천히 내려온다.
    // 대상에게 닿는 순간(onArrive)에 맞춰 치유 판정을 반영한다.
    function spawnHealingHeart(targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
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

        // 시작 위치를 강제 리플로우로 확정시킨 뒤에 트랜지션을 건다(spawnProjectile 참고).
        void wrap.offsetWidth;
        wrap.style.transition = `top ${durationMs}ms ease-in`;
        wrap.style.top = `${end.y}px`;

        setTimeout(() => {
            wrap.remove();
            onArrive();
        }, durationMs);
    }

    // 윤대웅 전용: 투사체 이동 없이 대상 위치에서 즉시 플래시만 터진다(카메라 셔터).
    function playInstantFlash(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !targetImg) { onArrive(); return; }
        const pos = fieldRelativeCenter(targetImg);
        const flash = document.createElement("div");
        flash.className = "dt-instant-flash-dot";
        flash.style.left = `${pos.x}px`;
        flash.style.top = `${pos.y}px`;
        layer.appendChild(flash);
        setTimeout(() => flash.remove(), 250);
        setTimeout(onArrive, 80);
    }

    // 이종복 전용: "F", "=", "m", "a" 네 글자가 0.1초 간격으로 직선 발사된다.
    function playTextParticles(actorKey, targetKey, onArrive) {
        const letters = ["F", "=", "m", "a"];
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
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
                // 시작 위치를 강제 리플로우로 확정시킨 뒤에 트랜지션을 건다(spawnProjectile 참고) -
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

    function playRangedAttack(actorKey, targetKey, onArrive) {
        const style = units[actorKey]?.style || "straight";
        if (style === "arc") spawnProjectileArc(actorKey, targetKey, onArrive);
        else if (style === "instant_flash") playInstantFlash(actorKey, targetKey, onArrive);
        else if (style === "text_particles") playTextParticles(actorKey, targetKey, onArrive);
        else if (style === "crayon") spawnCrayonProjectile(actorKey, targetKey, onArrive);
        else if (style === "electric") playElectricBolt(actorKey, targetKey, false, onArrive, ELECTRIC_ORIGIN_BASIC);
        else if (style === "book") spawnBookProjectile(actorKey, targetKey, onArrive);
        else if (style === "eye_laser") spawnEyeLaserBeam(actorKey, targetKey, units[actorKey]?.isType2 ? "type2" : "type1", onArrive);
        else if (style === "paint_gold") spawnPaintProjectile(actorKey, targetKey, "paint-gold", onArrive);
        else spawnProjectile(actorKey, targetKey, onArrive);
    }


    let eventIndex = 0;
    // 이벤트 재생 시각을 "재생 시작 시점" 기준 절대 목표 시각으로 스케줄하기 위한 기준점.
    // startPreparation()이 첫 playNext() 호출 직전에 채운다.
    let playbackOriginWallMs = 0;
    let playbackOriginEventTime = 0;
    // 이벤트 목록을 다 돌았을 때(showResult 직전) 어느 유닛이든 아직 공격/시전 애니메이션 중이거나
    // (근거리) 목표에 도착 전이거나 원거리 투사체가 아직 안 도착했으면, 그 연출/피해·사망 로그가
    // 뜨기도 전에 "전투 종료!" 로그가 먼저 떠버리는 걸 막는다 - 배우별 애니메이션 체인(actorAnimChain)
    // 덕분에 이제 여러 배우가 동시에 진행 중일 수 있으므로, "이벤트상 마지막 배우" 한 명만 보던
    // 예전 방식(lastEventActorKey) 대신 전체 유닛을 순회해서 확인한다.
    function anyActorStillFinishing() {
        return Object.keys(units).some((key) => {
            if (!units[key]) return false;
            return attackAnimActive[key] ||
                (units[key].isMelee && meleeArrived[key] === false) ||
                rangedResolvePending[key] ||
                meleeHitPending[key] ||
                // 호(자폭 소환수): 명중 판정 자체는 meleeHitPending으로 이미 잡히지만, 그 뒤로도 폭발
                // 파티클/흔들림 연출이 한동안 더 이어질 수 있다 - 이걸 빼먹으면 폭발이 채 끝나기도
                // 전에 "전투 종료!"가 떠버린다.
                goldenSelfDestructActive[key] ||
                // 임소정 번개도 같은 이유(명중 판정 뒤에도 스파크 잔상이 남는다).
                electricBoltActive[key];
        });
    }

    // 상단 전투 타이머: 예전엔 이벤트 재생에 쓰는 playbackOriginWallMs/-EventTime(playNext이 매 이벤트마다
    // 다시 잡는 원점)을 시계에도 그대로 재사용했는데, 그 값엔 이미 playbackSpeed가 반영돼 있는데
    // (재생 스케줄 자체가 playbackSpeed로 압축된 값) 시계가 거기에 playbackSpeed를 한 번 더 곱해서
    // 실제보다 느리게 차오르다가, 이벤트가 처리될 때마다 원점이 앞으로 다시 잡히면서 그 차이를
    // 한꺼번에 따라잡는 톱니 패턴이 됐다 - 평균적으로는 실제보다 빠르게 가는 것처럼 느껴지고, 이벤트가
    // 몰릴 때는 눈에 띄게 훅 뛰기도 했던 원인이 이것이었다.
    //
    // 이제는 재생 진행(이벤트 처리/애니메이션 대기 등)과 완전히 무관하게, "이번 구간이 시작된 실제 시각
    // (battleTimerStartWallMs) + 그 이전 구간까지 이미 누적된 표시값(battleTimerBaseSeconds)"만 기준으로
    // 매 프레임 계산해서 보여준다 - 재설정도, 따라잡기도, 상한 클램프도 필요 없다. 구간을 나눠둔 이유는
    // 배속 토글 버튼(battle-speed-toggle) 때문 - 배속이 바뀌는 순간 분모(playbackSpeed)만 바뀌면 그
    // 자리에서 표시값이 훅 튀므로, 바뀌는 순간 지금까지 값을 base에 굳혀두고 그 시점부터 새 배속으로
    // 새 구간을 시작한다(아래 battle-speed-toggle 클릭 핸들러 참고).
    let battleTimerRunning = false;
    let battleTimerStartWallMs = 0;
    let battleTimerBaseSeconds = 0;

    function tickBattleTimer() {
        if (!battleTimerRunning) return;
        const realElapsedSeconds = (performance.now() - battleTimerStartWallMs) / 1000;
        updateBattleTimer(battleTimerBaseSeconds + realElapsedSeconds / playbackSpeed);
        requestAnimationFrame(tickBattleTimer);
    }

    function startBattleTimer() {
        if (battleTimerRunning) return;
        battleTimerRunning = true;
        battleTimerStartWallMs = performance.now();
        battleTimerBaseSeconds = 0;
        requestAnimationFrame(tickBattleTimer);
    }

    function stopBattleTimer() {
        battleTimerRunning = false;
    }

    // 배속 토글 버튼: 누를 때마다 화살표 2개/하늘색(0.8배) -> 3개/노란색(0.6배, 더 빠름) ->
    // 1개/흰색(1배, 배속 없음) -> 다시 2개로 순환한다. 이벤트 재생 스케줄(playNext)과 시전/버프
    // 지속시간 등은 전부 그때그때 playbackSpeed를 읽어 쓰므로, 바뀐 배속은 진행 중인 이벤트를 억지로
    // 되돌리지 않고 다음 이벤트 스케줄부터 자연스럽게 반영된다.
    const BATTLE_SPEED_STATES = [
        { speed: 0.8, arrows: "››", className: "speed-sky" },
        { speed: 0.6, arrows: "›››", className: "speed-yellow" },
        { speed: 1, arrows: "›", className: "speed-white" },
    ];
    let battleSpeedStateIndex = 0;
    const battleSpeedToggleEl = document.getElementById("battle-speed-toggle");

    function applyBattleSpeedState() {
        const state = BATTLE_SPEED_STATES[battleSpeedStateIndex];
        playbackSpeed = state.speed;
        if (battleSpeedToggleEl) {
            battleSpeedToggleEl.textContent = state.arrows;
            BATTLE_SPEED_STATES.forEach((s) => battleSpeedToggleEl.classList.remove(s.className));
            battleSpeedToggleEl.classList.add(state.className);
        }
    }

    if (battleSpeedToggleEl) {
        battleSpeedToggleEl.addEventListener("click", () => {
            // 시계가 지금까지 보여주던 값을 그대로 이어받도록, "배속이 바뀌기 직전" 배속 기준으로
            // 지금까지 흐른 실제 시간을 base에 굳혀두고 원점을 다시 잡는다 - applyBattleSpeedState()가
            // playbackSpeed를 새 값으로 바꾸기 전에 반드시 먼저 계산해야 한다.
            if (battleTimerRunning) {
                const realElapsedSeconds = (performance.now() - battleTimerStartWallMs) / 1000;
                battleTimerBaseSeconds += realElapsedSeconds / playbackSpeed;
                battleTimerStartWallMs = performance.now();
            }
            battleSpeedStateIndex = (battleSpeedStateIndex + 1) % BATTLE_SPEED_STATES.length;
            applyBattleSpeedState();
        });
    }
    applyBattleSpeedState();

    // 안전장치: cast_start/skill_resolve/"마지막 이벤트" 대기 게이트가 아직 원인을 다 못 찾은 어떤
    // 이유로든 절대 안 풀리면, 재생 전체가 그 자리에서 영원히 멈춘다(가장 나쁜 결과) - 같은 대상으로
    // ANIM_WAIT_TIMEOUT_MS 이상 계속 대기 중이면, 그 유닛의 애니메이션 상태를 강제로 idle로 정리하고
    // 그냥 진행한다. 정상적인 경우엔 항상 그 전에 자연스럽게 풀리므로 이 타임아웃에 걸릴 일이 없다.
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

    function forceClearAnim(key) {
        if (!key) return;
        attackAnimTokens[key] = (attackAnimTokens[key] || 0) + 1;
        attackAnimActive[key] = false;
        const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
        if (imgEl && units[key]) {
            imgEl.classList.remove("casting", "casting-rainbow", "attacking");
            imgEl.onerror = null;
            imgEl.src = `${OUTFIT_IMAGE_BASE}${units[key].outfit}/battle_idle${spriteVariantSuffix(key)}.png`;
        }
    }

    // key(배우)별로 애니메이션 단계가 순서대로만 실행되도록 이어붙인다 - 전역 이벤트 커서는 이 반환값을
    // 절대 기다리지 않는다(fire-and-forget). workFn에서 예외가 나도 체인이 영구히 끊겨서 이 배우의
    // 이후 모든 애니메이션이 조용히 멈춰버리는 일이 없도록 흡수한다.
    function chainActorAnim(key, workFn) {
        const prev = actorAnimChain[key] || Promise.resolve();
        const next = prev.then(workFn).catch(() => {});
        actorAnimChain[key] = next;
        return next;
    }

    // 다음 애니메이션 단계(예: 시전 자세)로 넘어가기 전에, 이 배우 자신의 직전 애니메이션(예: 방금
    // 끝낸 기본공격 윈드업)이 화면에서 실제로 끝났는지(attackAnimActive)를 기다린다. 이 대기는 이
    // 배우의 체인 안에서만 일어나므로 다른 배우의 이벤트 처리를 막지 않는다. 원인을 못 찾아도
    // ANIM_WAIT_TIMEOUT_MS 안에 안 풀리면 강제로 idle 처리하고 진행한다(기존 워치독 재사용 - 예전엔
    // playNext를 직접 막던 위치에 있었지만, 이제 이 배우 전용 체인 안으로 옮겨졌을 뿐 로직은 동일하다).
    function waitForAnimIdle(key) {
        return new Promise((resolve) => {
            function poll() {
                if (!attackAnimActive[key]) {
                    clearAnimWait(key);
                    resolve();
                    return;
                }
                if (shouldForceProceedPast(key)) {
                    forceClearAnim(key);
                    clearAnimWait(key);
                    resolve();
                    return;
                }
                requestAnimationFrame(poll);
            }
            poll();
        });
    }

    function eventTargetKey(event) {
        const targetSide =
            event.side === "attacker" ? "defender" : "attacker";
        return findUnitKey(targetSide, event.target);
    }

    function eventActorKey(event) {
        return findUnitKey(event.side, event.actor);
    }

    // 치명타 시 대상 머리 위에 "치명타!" 글자가 튀어오르듯 잠깐 떴다 사라진다.
    function showCritLabel(key) {
        const layer = document.getElementById("projectile-layer");
        const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
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

    // 상성(유형 상성) 적중 시 대상 머리 위에 "Weak"(유리, 빨강)/"Resist"(불리, 파랑) 글자를 띄운다.
    // 치명타 라벨과 같은 UI 계열이지만, Weak는 조금 작고 Resist는 그보다 더 작으며 기울어지는 연출이 없다.
    function showTypeLabel(key, kind) {
        const layer = document.getElementById("projectile-layer");
        const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
        if (!layer || !imgEl) return;
        const pos = fieldRelativeCenter(imgEl);
        const label = document.createElement("div");
        label.className = `type-label type-${kind}`;
        label.textContent = kind === "weak" ? "Weak" : "Resist";
        label.style.left = `${pos.x}px`;
        label.style.top = `${pos.y - 62}px`; // 치명타 라벨(-46px)과 겹치지 않도록 조금 더 위에서 시작
        layer.appendChild(label);
        setTimeout(() => label.remove(), 700);
    }

    // isCrit이면 기본 피격 플래시보다 훨씬 화려한 연출(더 강한 확대/발광 + "치명타!" 라벨)을 대신 재생한다.
    // typeMultiplier가 1보다 크면(유리한 상성) "Weak", 1보다 작으면(불리한 상성) "Resist" 라벨을 함께 띄운다.
    function flashHit(key, isCrit, typeMultiplier) {
        const imgEl = document.querySelector(
            `[data-unit="${key}"] .battle-unit-img`
        );

        if (!imgEl) return;

        if (typeof typeMultiplier === "number") {
            if (typeMultiplier > 1) showTypeLabel(key, "weak");
            else if (typeMultiplier < 1) showTypeLabel(key, "resist");
        }

        if (isCrit) {
            imgEl.classList.add("crit-flash");
            showCritLabel(key);
            setTimeout(() => {
                imgEl.classList.remove("crit-flash");
            }, 400);
            return;
        }

        imgEl.classList.add("hit-flash");

        setTimeout(() => {
            imgEl.classList.remove("hit-flash");
        }, 250);
    }

    // 근거리 유닛이 걷는 동안(startMeleeWalker의 tick) 반복 재생되는 걷기 프레임 애니메이션.
    // playAttackFrames와 달리 "한 번" 재생하고 끝나는 게 아니라 도착할 때까지 프레임을 계속 순환한다.
    // 토큰 방식은 동일 - stopWalkFrames가 토큰을 갈아치우면 다음 프레임 체크에서 루프가 스스로 멈춘다.
    async function playWalkFrames(key) {
        const el = document.querySelector(`[data-unit="${key}"]`);
        if (!el) return;

        const imgEl = el.querySelector(".battle-unit-img");
        if (!imgEl) return;

        const outfit = units[key].outfit;
        const variant = spriteVariantSuffix(key);
        const myToken = (walkAnimTokens[key] = (walkAnimTokens[key] || 0) + 1);

        const frameCount = await getWalkFrameCount(outfit, variant);
        if (walkAnimTokens[key] !== myToken) return;

        // 걷기 전용 사진이 없는 캐릭터 - 사진은 그대로 두고(원래처럼) CSS bob 애니메이션만 적용된 채로 걷는다.
        if (frameCount === 0) return;

        let frameIndex = 1;
        while (walkAnimTokens[key] === myToken) {
            imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/walk${variant}_${frameIndex}.png`;
            await sleep(WALK_FRAME_DURATION_MS);
            frameIndex = (frameIndex % frameCount) + 1;
        }
    }

    // 도착하거나(더 이상 걷지 않음) 다른 애니메이션으로 넘어갈 때 호출 - 토큰만 갈아치우면 진행 중이던
    // playWalkFrames의 while 루프가 다음 프레임 대기 후 스스로 종료된다(별도 취소 신호 불필요).
    function stopWalkFrames(key) {
        walkAnimTokens[key] = (walkAnimTokens[key] || 0) + 1;
        walkAnimActive[key] = false;
    }

    async function playAttackFrames(key) {
        const el = document.querySelector(`[data-unit="${key}"]`);
        if (!el) return;

        const imgEl = el.querySelector(".battle-unit-img");
        if (!imgEl) return;

        const outfit = units[key].outfit;
        const variant = spriteVariantSuffix(key);
        const myToken =
            (attackAnimTokens[key] = (attackAnimTokens[key] || 0) + 1);

        attackAnimActive[key] = true;

        const frameCount = await getAttackFrameCount(outfit, variant);

        if (attackAnimTokens[key] !== myToken) return;

        if (frameCount === 0) {
            imgEl.classList.add("attacking");

            setTimeout(() => {
                imgEl.classList.remove("attacking");
                attackAnimActive[key] = false;
            }, 300);

            return;
        }

        for (let i = 1; i <= frameCount; i += 1) {
            if (attackAnimTokens[key] !== myToken) return;

            imgEl.src =
                `${OUTFIT_IMAGE_BASE}${outfit}/attack${variant}_${i}.png`;
            await sleep(ATTACK_FRAME_DURATION_MS);
        }

        if (attackAnimTokens[key] === myToken) {
            imgEl.onerror = () => {
                imgEl.onerror = null;
                imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/idle.png`;
            };

            imgEl.src =
                `${OUTFIT_IMAGE_BASE}${outfit}/battle_idle${variant}.png`;
            attackAnimActive[key] = false;
        }
    }

    /*
     * 시전(캐스팅) 중 재생되는 프레임 애니메이션. 스킬 전용 프레임(skill_N.png)이 있으면 그걸 우선 쓰고,
     * 없으면 기본공격 프레임(attack_N.png)을 그대로 돌려쓴다. 짧은 프레임 묶음을 빠르게 반복 재생하는
     * 대신, 가진 프레임 수만큼을 시전 시간(durationMs) 전체에 고르게 늘려서 "한 번만" 재생한다 -
     * 그래서 시전이 길수록 프레임 하나하나가 더 천천히 넘어가고, 루프하는 느낌 없이 시전 시작부터
     * 끝까지 이어지는 애니메이션처럼 보인다.
     */
    async function playCastFrames(key, durationMs) {
        const el = document.querySelector(`[data-unit="${key}"]`);
        const imgEl = el?.querySelector(".battle-unit-img");
        if (!el || !imgEl || !units[key]) return;

        const outfit = units[key].outfit;
        const variant = spriteVariantSuffix(key);
        const myToken =
            (attackAnimTokens[key] = (attackAnimTokens[key] || 0) + 1);

        attackAnimActive[key] = true;

        // 프레임 스케줄의 기준 시각은 반드시 "시전이 시작된 지금" 찍어야 한다 - skill_resolve(투사체
        // 발사 등 실제 스킬 발동)의 타이밍도 이 시전이 시작된 시점 + 시전 시간(durationMs)으로 백엔드
        // 기준 계산되기 때문이다. 프레임 개수 조회(getSkillFrameCount/getAttackFrameCount) 뒤로 기준
        // 시각을 늦게 찍으면, 이 캐릭터가 전투에서 "처음" 시전하는 순간처럼 이미지 파일 존재 여부를
        // 실제로 하나씩 로드해봐야 하는 경우(캐시 미스) 그 조회 시간만큼 스킬 발동(투사체 발사 등)이
        // 시전 애니메이션의 마지막 프레임보다 먼저 일어나는 것처럼 보이는 어긋남이 생긴다 - 기준을
        // 조회 "전"에 찍어두면, 조회에 시간이 걸려도 아래 절대 시각 스케줄(remainingMs)이 자연히
        // 따라잡아서 마지막 프레임은 항상 "시전 시작 + durationMs"에 정확히 표시된다.
        let castStartMs = performance.now();

        const skillFrameCount = await getSkillFrameCount(outfit, variant);
        const usingSkillFrames = skillFrameCount > 0;
        const frameCount = usingSkillFrames ? skillFrameCount : await getAttackFrameCount(outfit, variant);
        const framePrefix = usingSkillFrames ? "skill" : "attack";

        if (attackAnimTokens[key] !== myToken) return; // 다른 호출이 이미 새 토큰을 발급함 - 그쪽 상태를 건드리지 않는다

        // 프레임 개수 조회(캐시 미스 시 이미지를 실제로 하나씩 로드해봐야 해서 느릴 수 있음)가 시전
        // 시간 전체를 이미 다 잡아먹었으면, 아래 루프의 매 프레임 remainingMs가 전부 0 이하로 계산돼
        // sleep이 전부 건너뛰어진다 - 그러면 프레임들이 렌더링될 틈도 없이(브라우저에 한 번도 양보하지
        // 않고) 연속으로 src만 바뀌어, 화면엔 마지막 프레임으로 순간이동한 것처럼(=시전 애니메이션이
        // 아예 재생 안 된 것처럼) 보인다. 이 드문 경우(주로 그 캐릭터의 첫 시전)엔 skill_resolve와의
        // 정밀 동기화를 포기하고, 지금 이 순간부터 다시 durationMs를 온전히 확보해 최소한 애니메이션
        // 자체는 눈에 보이게 한다.
        if (performance.now() - castStartMs >= durationMs) {
            castStartMs = performance.now();
        }

        if (frameCount === 0) {
            // 스킬/공격 프레임 이미지가 아예 없는 캐릭터는 기존처럼 펄스 글로우만으로 시전 표시.
            // attackAnimActive는 꺼둬야 한다 - skill_resolve 처리 시작부의 "아직 애니메이션 중이면
            // 대기" 게이트가 이 값을 보고 재시도하는데, 여기서 안 꺼두면 그 게이트를 영영 통과 못 해서
            // 첫 스킬 발동에서 재생이 완전히 멈춘다(실제로 발생했던 회귀).
            attackAnimActive[key] = false;
            return;
        }

        const perFrameMs = durationMs / frameCount;
        // 프레임마다 매번 perFrameMs만큼 sleep을 새로 걸면(상대 시간 방식), setTimeout 자체의 오차가
        // 프레임 수만큼 누적된다 - 스킬 프레임이 많을수록 실제 재생이 서버가 계산한 시전 시간보다
        // 점점 더 길어지고, 그만큼 skill_resolve 처리가 늦어져서 화면이 마지막 프레임에 오래 멈춰
        // 있다가, 뒤이은 기본공격 시점과 맞물려 복귀(return) 애니메이션이 다 재생되기도 전에
        // 잘리는 문제로 이어졌다. playNext의 절대 시각 스케줄과 같은 방식으로, "시전 시작 시점 +
        // 누적 프레임 시간"이라는 절대 목표 시각까지 남은 시간만 sleep해서 오차가 쌓이지 않게 한다.
        for (let i = 1; i <= frameCount; i += 1) {
            if (attackAnimTokens[key] !== myToken) return; // 다른 호출이 이미 새 토큰을 발급함 - 그쪽 상태를 건드리지 않는다

            imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/${framePrefix}${variant}_${i}.png`;
            const remainingMs = castStartMs + perFrameMs * i - performance.now();
            // remainingMs가 0 이하(이미 이 프레임의 목표 시각을 지남)라고 await 자체를 건너뛰면, 뒤이은
            // 프레임들의 remainingMs도 연쇄로 계속 음수라 반복문이 한 번도 브라우저에 제어권을 넘기지
            // 않고(=한 번도 페인트되지 않고) 곧바로 여러 프레임의 src를 연달아 덮어써버린다 - 화면엔
            // 몇 프레임이 통째로 사라지고 훅 건너뛴 것처럼(=시전 애니메이션이 비정상적으로 빨라진
            // 것처럼) 보인다. 호의 폭발 연출처럼 캔버스 작업이 무거워 메인 스레드가 잠깐 멈췄다 풀릴 때
            // 특히 두드러졌다. Math.max(0, ...)로 무조건 await해서 늦었어도 프레임마다 최소 한 번은
            // 브라우저에 제어권을 넘겨(페인트 기회를 줘서) 밀린 만큼 빠르게는 재생하되 프레임이 통째로
            // 스킵되지는 않게 한다.
            await sleep(Math.max(0, remainingMs));
        }

        // 시전 프레임 루프가 다 끝났으니 skill_resolve 처리를 막고 있던 게이트는 풀어준다(안 그러면
        // 위와 같은 이유로 재생이 멈춘다) - 다만 화면(스프라이트)은 마지막 프레임에 그대로 멈춰 둔다.
        // 여기서 곧바로 idle로 스냅하면, 이 루프 자체의 타이머(매 프레임 sleep 누적)와 실제
        // skill_resolve가 처리되는 시점(playNext의 절대 시각 스케줄)이 아주 살짝만 어긋나도 - 캐스팅
        // 자세가 먼저 idle로 풀렸다가, 뒤늦게 skill_resolve가 처리되며 playReturnFrames가 다시 한번
        // idle로의 복귀 연출을 재생하는(사실상 두 번 풀리는) 버그가 있었다. idle로의 실제 시각적
        // 전환은 오직 skill_resolve 쪽 playReturnFrames(또는 기절 등으로 취소됐을 때 interruptCasting)만
        // 담당한다.
        if (attackAnimTokens[key] === myToken) {
            attackAnimActive[key] = false;
        }
    }

    // Active 시전 중 기절 등으로 시전이 취소됐을 때 호출한다(백엔드가 발동 자체를 건너뛰므로
    // skill_resolve 이벤트가 아예 오지 않는다 - 그 이벤트에 얹혀서 처리되는 평소의 "casting" 클래스
    // 제거/복귀 애니메이션 로직을 못 타므로 별도로 정리해줘야 한다). 토큰을 새로 발급해서 진행 중이던
    // playCastFrames 루프를 즉시 멈추고, 평상시 자세로 바로 스냅한다.
    function interruptCasting(key, side) {
        if (!key || !units[key]) return;
        attackAnimTokens[key] = (attackAnimTokens[key] || 0) + 1;
        attackAnimActive[key] = false;
        const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
        if (imgEl) {
            imgEl.classList.remove("casting", "casting-rainbow");
            imgEl.onerror = null;
            imgEl.src = `${OUTFIT_IMAGE_BASE}${units[key].outfit}/battle_idle${spriteVariantSuffix(key)}.png`;
        }
        flashEffectAura(key, "cc");
        appendLog(`${units[key].name}의 [Active] 시전이 기절로 취소됐다!`, side);
    }

    /*
     * 시전 종료 직후 재생되는 복귀 애니메이션. 전용 프레임(return_N.png)이 있는 캐릭터만 이 프레임들을
     * 순서대로(1→N) 한 번 재생한 뒤 battle_idle.png로 정착한다. 서버가 이 동작의 시간을 따로 주지 않으므로
     * (시전 시간과 무관하게) 공격 프레임과 같은 고정 속도(RETURN_FRAME_DURATION_MS)로 재생한다.
     * 전용 프레임이 없는 캐릭터는 호출부가 기존처럼 battle_idle.png로 바로 스냅한다(폴백, 이 함수는 안 씀).
     */
    async function playReturnFrames(key) {
        const el = document.querySelector(`[data-unit="${key}"]`);
        const imgEl = el?.querySelector(".battle-unit-img");
        if (!el || !imgEl || !units[key]) return;

        const outfit = units[key].outfit;
        // 호출부(skill_resolve)가 isType2 토글을 이 함수를 부르기 "전에" 반영해두므로, 염색체 변환처럼
        // 시전 도중 상태가 바뀌는 스킬이면 복귀 프레임은 자동으로 전환 후(새 상태) 모습으로 재생된다.
        const variant = spriteVariantSuffix(key);
        const myToken =
            (attackAnimTokens[key] = (attackAnimTokens[key] || 0) + 1);

        attackAnimActive[key] = true;

        const frameCount = await getReturnFrameCount(outfit, variant);

        if (attackAnimTokens[key] !== myToken) return;

        for (let i = 1; i <= frameCount; i += 1) {
            if (attackAnimTokens[key] !== myToken) return;

            imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/return${variant}_${i}.png`;
            await sleep(RETURN_FRAME_DURATION_MS);
        }

        if (attackAnimTokens[key] === myToken) {
            imgEl.onerror = () => {
                imgEl.onerror = null;
                imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/idle.png`;
            };

            imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/battle_idle${variant}.png`;
            attackAnimActive[key] = false;
        }
    }

    /*
     * 타격 로그: 이제 한 줄을 덮어쓰지 않고, 행동한 쪽 색으로 새 줄을 계속 추가한다.
     */
    function showDamageMessage(event) {
        // 윤(영혼 흡수/선생 고혈): 기본공격에 자가 회복이 딸려온 경우(actor_self_heal) 같은 줄에 이어붙인다.
        const healText = event.actor_self_heal ? ` (자신 체력 ${event.actor_self_heal} 회복)` : "";
        // 호(자폭 소환수): 이 공격을 끝으로 스스로 사라진다는 걸 같은 줄에 표시한다.
        const selfDestructText = event.actor_self_destruct ? " (자폭)" : "";
        appendLog(
            `${event.actor}의 공격! ${event.target}에게 ${event.damage}만큼 피해!${event.is_crit ? " 치명타!" : ""}${healText}${selfDestructText}`,
            event.side
        );
    }

    // 스킬 발동 로그에 실제 피해/효과를 덧붙이기 위한 요약 문구. hits(피해 이벤트 배열)를
    // "OOO에게 123만큼 피해(치명타!), XXX에게 45만큼 피해" 식으로 이어붙인다.
    function hitsSummaryText(hits) {
        if (!hits || !hits.length) return "";
        return hits
            .map((hit) => `${hit.target}에게 ${hit.damage}만큼 피해${hit.is_crit ? "(치명타!)" : ""}`)
            .join(", ");
    }

    // ===== 효과 수신자 오라 =====
    // 스킬 발동 순간 시전자 몸이 번쩍이던 예전 연출 대신, 효과를 "받은" 대상에게 색 오라가
    // 나왔다가 사라진다(이영웅에게 회복받는 대상과 같은 방식). 같은 대상이 연달아 효과를 받으면
    // 애니메이션이 처음부터 다시 재생되며 "나중에 받은 효과"의 색으로 바뀐다.
    const EFFECT_AURA_COLORS = {
        buff: "#ff4d3d",     // 버프(공격력/최대체력/공격속도 증가 등) - 붉은색
        debuff: "#4d8bff",   // 디버프(공격력/최대체력 감소) - 파란색
        cc: "#b266ff",       // CC기(기절, 넉백 등) - 보라색
        heal: "#4ee06a",     // 회복 - 연두색
        special: "#ffffff",  // 스페셜(무적 등) - 흰색
    };
    const EFFECT_AURA_FLASH_MS = 900; // @keyframes effect-aura-flash의 실제 재생시간(0.9s)과 반드시 일치해야 한다.

    // unitKey -> 마지막으로 건 트리거의 토큰 - 재트리거(다른 효과가 곧바로 겹쳐 들어옴)됐을 때, 예전
    // 트리거의 정리 타이머가 방금 새로 켠 오라를 실수로 지우지 않게 막는다(attackAnimTokens와 동일한 패턴).
    const auraFlashTokens = {};

    function flashEffectAura(unitKey, kind) {
        const imgEl = document.querySelector(`[data-unit="${unitKey}"] .battle-unit-img`);
        const color = EFFECT_AURA_COLORS[kind];
        if (!imgEl || !color) return;
        imgEl.classList.remove("effect-aura-flash");
        void imgEl.offsetWidth; // 강제 리플로우 - 연속으로 받아도 애니메이션이 다시 재생되게
        imgEl.style.setProperty("--effect-aura-color", color);
        imgEl.classList.add("effect-aura-flash");
        // animationend에 의존하면 안 된다 - hit-flash/crit-flash처럼 같은 filter 속성을 쓰는 다른
        // 애니메이션이 이후 겹치면(특히 공격을 자주 주고받는 전방 캐릭터), 이 오라 애니메이션 자체가
        // 우선순위에서 밀려 끝까지 재생되지 못해 animationend가 영영 안 오는 경우가 실제로 있었다 -
        // 그러면 클래스가 무한정 남아있다가, 나중에 우연히 그 경쟁이 풀리는 순간 뒤늦게 재생되며
        // "공격할 때마다 상관없는 오라가 계속 생겼다 사라지는" 것처럼 보인다. flashHit(hit-flash/
        // crit-flash)이 이미 쓰고 있는 것과 동일하게, 실제 CSS 지속시간에 맞춘 타이머로 무조건 지운다.
        const myToken = (auraFlashTokens[unitKey] = (auraFlashTokens[unitKey] || 0) + 1);
        setTimeout(() => {
            if (auraFlashTokens[unitKey] === myToken) imgEl.classList.remove("effect-aura-flash");
        }, EFFECT_AURA_FLASH_MS);
    }

    // ===== 로스터 상태 아이콘 =====
    // 상태가 걸리면 로스터의 이름 바로 옆부터 아이콘이 하나씩 채워지고, 상태가 끝나면 사라진다.
    //
    // xN 배지는 "같은 원인이 반복 갱신"되는 게 아니라 "서로 다른 원인이 동시에 겹쳐" 있을 때만 올라간다.
    // 예) 임소정과 김남옥이 각자의 성급 특성으로 같은 아군에게 공격력 증가를 부여하면 x2가 맞지만,
    // 김남옥이 자기 공속버프를 반복 시전해서 지속시간만 갱신되는 건 카운트를 늘리지 않는다(같은 source).
    // 그래서 각 발동을 source 키(누가/무엇을 원인으로)로 구분해서 관리한다: 같은 source가 다시 걸리면
    // 그 source의 타이머만 리셋(갱신)하고, 처음 보는 source면 새로 추가(중첩)한다. 표시 카운트 = 활성
    // source 수의 합(윤대웅의 자가 중첩 스킬처럼 "한 source가 자체적으로 커지는" 경우는 weight로 반영).
    const STATUS_ICON_FILES = {
        atk_up: "Combat_Icon_Buff_ATK.png",
        maxhp_up: "Combat_Icon_Buff_MAXHP.png",
        atk_speed_up: "Combat_Icon_Buff_AttackSpeed.png",
        crit_up: "Combat_Icon_Buff_CriticalDamage.png",
        crit_chance_up: "Combat_Icon_Buff_CriticalChance.png",
        rear_priority: "Combat_Icon_Special_AttackRear.png",
        atk_down: "Combat_Icon_Debuff_ATK.png",
        maxhp_down: "Combat_Icon_Debuff_MAXHP.png",
        stun: "Combat_Icon_CC_Stunned.png",
        knockback: "Combat_Icon_CC_Knockback.png",
        heal: "Combat_Icon_Recovery_Heal.png",
        immune: "Combat_Icon_Special_ImmuneDamage.png",
        paint_red: "Combat_Icon_Special_InkRed.png",     // 방임석 보유 물감(빨강) - weight로 개수 표시
        paint_blue: "Combat_Icon_Special_InkBlue.png",   // 방임석 보유 물감(파랑)
        paint_yellow: "Combat_Icon_Special_InkYellow.png", // 방임석 보유 물감(노랑)
        damage_reduction: "Combat_Icon_Buff_DamageRatio.png", // 방임석 "방임" - 받는 피해 감소
        lifesteal: "Combat_Icon_Special_Lifesteal.png", // 윤 "선생 고혈" - 공격 대상이 선생 타입인 동안(고혈)
    };
    const MOMENT_ICON_MS = 1200; // 순간 효과(회복, 넉백)는 이 시간만 표시됐다가 사라짐

    const statusIconState = {}; // unitKey -> { iconId: { el, sources: Map<sourceKey, {weight, timer}> } }

    function renderStatusIconTotal(unitKey, iconId) {
        const entry = statusIconState[unitKey]?.[iconId];
        if (!entry) return;
        const total = [...entry.sources.values()].reduce((sum, s) => sum + s.weight, 0);
        const stackEl = entry.el.querySelector(".roster-status-stack");
        if (stackEl) {
            stackEl.hidden = total < 2;
            stackEl.textContent = `x${total}`;
        }
    }

    // opts.source: 이 효과를 일으킨 원인의 고유 키(보통 "행위자:효과종류"). 생략하면 항상 같은
    // 익명 source로 취급되어 재호출 시 카운트가 늘지 않고 그저 갱신만 된다.
    // opts.weight: 이 source 하나가 차지하는 중첩 수(윤대웅 스킬처럼 서버가 스택 수를 직접 셀 때 사용). 기본 1.
    function setStatusIcon(unitKey, iconId, opts = {}) {
        const rosterEl = document.querySelector(`[data-roster="${unitKey}"]`);
        const wrap = rosterEl?.querySelector(".roster-status-icons");
        const file = STATUS_ICON_FILES[iconId];
        if (!wrap || !file) return;

        const state = (statusIconState[unitKey] = statusIconState[unitKey] || {});
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
            source.weight = weight; // 같은 source 재적용 - 새로 중첩하지 않고 무게만 갱신(자가 중첩 스킬용)
        }

        // 지속시간이 있으면 그 source만 그 시점에 제거(재적용 시 타이머 리셋). 없으면 전투 끝(사망)까지 유지.
        if (source.timer) { clearTimeout(source.timer); source.timer = null; }
        if (opts.durationMs) {
            source.timer = setTimeout(() => clearStatusIconSource(unitKey, iconId, sourceKey), opts.durationMs);
        }

        renderStatusIconTotal(unitKey, iconId);
    }

    function clearStatusIconSource(unitKey, iconId, sourceKey) {
        const entry = statusIconState[unitKey]?.[iconId];
        const source = entry?.sources.get(sourceKey);
        if (!entry || !source) return;
        if (source.timer) clearTimeout(source.timer);
        entry.sources.delete(sourceKey);
        if (entry.sources.size === 0) {
            entry.el.remove();
            delete statusIconState[unitKey][iconId];
        } else {
            renderStatusIconTotal(unitKey, iconId);
        }
    }

    function clearAllStatusIcons(unitKey) {
        const state = statusIconState[unitKey];
        if (!state) return;
        Object.entries(state).forEach(([iconId, entry]) => {
            entry.sources.forEach((source) => { if (source.timer) clearTimeout(source.timer); });
            entry.el.remove();
        });
        delete statusIconState[unitKey];
    }

    // ===== 복제체(summon) 로스터 행 =====
    // 복제체가 소환되면 로스터에도 한 줄이 생겨서 전방/중방/후방 정렬에 함께 참여한다.
    // 재소환(교체)되면 기존 행을 재사용하고 상태를 초기화한다.
    function ensureSummonRosterRow(cloneKey, unit) {
        let rosterEl = document.querySelector(`[data-roster="${cloneKey}"]`);
        const side = cloneKey.startsWith("attacker") ? "attacker" : "defender";
        const panel = document.querySelector(`.player-panel[data-side="${side}"]`);
        if (!panel) return;

        const isNewRow = !rosterEl;
        if (!rosterEl) {
            rosterEl = document.createElement("div");
            rosterEl.className = "roster-unit roster-row-appear";
            rosterEl.dataset.roster = cloneKey;
            rosterEl.innerHTML = `
                <div class="roster-unit-thumb"><img class="roster-unit-img" src="" alt=""></div>
                <div class="roster-unit-body">
                    <div class="roster-name-row">
                        <div class="roster-unit-name">-</div>
                        <div class="roster-status-icons"></div>
                    </div>
                    <div class="roster-hp-track"><div class="roster-hp-fill"></div></div>
                </div>
            `;
            // 아군 패널은 로스터 밑에 전투 로그가 있으므로 로그 바로 앞에 끼워 넣는다.
            const logPanel = panel.querySelector(".battle-log-panel");
            if (logPanel) panel.insertBefore(rosterEl, logPanel);
            else panel.appendChild(rosterEl);
            rosterEl.addEventListener("animationend", () => rosterEl.classList.remove("roster-row-appear"), { once: true });
        }

        rosterEl.classList.remove("roster-unit-dead");
        const nameEl = rosterEl.querySelector(".roster-unit-name");
        if (nameEl) nameEl.textContent = battleDisplayText(unit.name); // 서버가 "윤영준의 복제체" 형태로 이름을 내려준다
        setPortraitImage(rosterEl.querySelector(".roster-unit-img"), unit.outfit, unit.spriteVariant || "");
        // 전장 스탠딩(.is-clone)과 동일한 조건(위 summon_clone 핸들러 참고).
        rosterEl.querySelector(".roster-unit-img")
            ?.classList.toggle("roster-clone-img", !unit.spriteVariant || unit.isCopy);
        clearAllStatusIcons(cloneKey);

        // 새로 생긴 행은 폴링(최대 450ms)을 기다리지 않고 즉시 전방/중방/후방 순서에 맞춰 자리잡는다.
        if (isNewRow) reorderRoster(side);
    }

    // ===== 전투 중 위치에 따른 전방/(중방)/후방 판정 + 로스터 정렬 =====
    // 아군은 오른쪽(x가 클수록)이 전방, 적군은 왼쪽(x가 작을수록)이 전방이다. 복제체가 나와 있으면
    // 3명이 전방/중방/후방으로 나뉜다(전투 중 실제 위치 순서). 로스터는 전방이 위, 후방이 아래로
    // 정렬되고, 순서가 바뀌면 두 줄이 부드럽게 자리를 서로 바꾼다. 죽은 유닛은 항상 맨 아래로 보낸다.
    const lastRosterOrder = { attacker: "", defender: "" };
    let rosterOrderTimer = null;

    function computeFrontToBackOrder(side) {
        const keys = Object.keys(units).filter((key) => {
            if (!key.startsWith(side) || !units[key]) return false;
            if (!document.querySelector(`[data-roster="${key}"]`)) return false;
            const battleEl = document.querySelector(`[data-unit="${key}"]`);
            return battleEl && !battleEl.hidden;
        });

        const centers = {};
        keys.forEach((key) => {
            const el = document.querySelector(`[data-unit="${key}"]`);
            const rect = el ? el.getBoundingClientRect() : null;
            centers[key] = rect ? rect.left + rect.width / 2 : 0;
        });

        keys.sort((a, b) => {
            const deadA = units[a].hp <= 0 ? 1 : 0;
            const deadB = units[b].hp <= 0 ? 1 : 0;
            if (deadA !== deadB) return deadA - deadB;
            return side === "attacker" ? centers[b] - centers[a] : centers[a] - centers[b];
        });
        return keys;
    }

    function reorderRoster(side) {
        const order = computeFrontToBackOrder(side);
        const signature = order.join("|");
        if (!order.length || signature === lastRosterOrder[side]) return;
        lastRosterOrder[side] = signature;

        const panel = document.querySelector(`.player-panel[data-side="${side}"]`);
        if (!panel) return;
        const rows = order.map((key) => document.querySelector(`[data-roster="${key}"]`)).filter(Boolean);

        // FLIP: 원래 위치 기록 -> DOM 순서 변경 -> 이동량만큼 역변환 -> 트랜지션으로 제자리 복귀
        const firstTops = new Map(rows.map((row) => [row, row.getBoundingClientRect().top]));
        const anchor = panel.querySelector(".battle-log-panel");
        rows.forEach((row) => {
            if (anchor) panel.insertBefore(row, anchor);
            else panel.appendChild(row);
        });
        rows.forEach((row) => {
            const dy = firstTops.get(row) - row.getBoundingClientRect().top;
            if (!dy) return;
            row.style.transition = "none";
            row.style.transform = `translateY(${dy}px)`;
        });
        void panel.offsetWidth;
        rows.forEach((row) => {
            row.style.transition = "transform 380ms cubic-bezier(.2, .75, .25, 1)";
            row.style.transform = "";
        });
        setTimeout(() => rows.forEach((row) => { row.style.transition = ""; }), 420);
    }

    function startRosterOrderWatcher() {
        rosterOrderTimer = setInterval(() => {
            reorderRoster("attacker");
            reorderRoster("defender");
        }, 450);
    }

    // 스킬 발동(skill_resolve)의 detail.hits[]에 담긴 피해를 대상들에게 반영하고 화면을 갱신한다.
    // side가 주어지면(백엔드가 각 대상에 붙여 보내는 target_side) 그 편에서만 이름을 찾는다 - 이름만으로
    // 양쪽을 다 찾으면(과거 방식) 같은 캐릭터가 양 팀에 모두 있을 때(미러/유사 편성) 항상 attacker 쪽이
    // 먼저 걸려서, 실제로는 적이 맞았는데 화면에는 엉뚱하게 아군이 맞고 죽었다가(다음 갱신에서 원래
    // 체력으로) 되살아난 것처럼 보이는 버그가 있었다. side가 없는 옛 이벤트/호출부만 양쪽 폴백 검색한다.
    function findHitKey(name, side) {
        if (side) return findUnitKey(side, name);
        return findUnitKey("attacker", name) || findUnitKey("defender", name);
    }

    function applySkillHits(event) {
        const hits = event.detail?.hits || [];
        hits.forEach((hit) => {
            const hitKey = findHitKey(hit.target, hit.target_side);
            if (!hitKey) return;
            units[hitKey].hp = hit.target_hp_after;
            renderUnit(hitKey);
            flashHit(hitKey, hit.is_crit, hit.type_multiplier);
        });
    }

    // 투사체/캔버스 연출(운석, 가스 숨결, 땅불, 물감 등)이 실제로 대상에 "도착"하는 순간까지 화면
    // 반영(렌더/피격 이펙트)을 늦추는 스킬들 전용 - HP 자체는 이 함수로 이벤트 처리 시점에 곧바로
    // (지연 없이) 반영해서 다른 이벤트와의 순서가 절대 꼬이지 않게 하고, 그 직전에 이미 죽어있었는지도
    // 함께 캡처해서 반환한다. 도착 콜백은 이 반환값이 true면 렌더/이펙트를 건너뛰어야 한다 - 안 그러면
    // 그 사이 다른(더 빠른) 이벤트가 같은 대상을 먼저 죽였을 때, 뒤늦게 도착한 이 연출이 죽기 전의
    // 과거 HP 값으로 덮어써서 이미 쓰러진 캐릭터가 되살아나 보이는 버그가 생긴다.
    function captureAndApplyHp(targetKey, newHp) {
        if (!targetKey || !units[targetKey]) return true;
        const wasAlreadyDead = units[targetKey].hp <= 0;
        units[targetKey].hp = newHp;
        return wasAlreadyDead;
    }

    function playNext() {
        if (eventIndex >= data.events.length) {
            // 어느 유닛이든 아직 애니메이션/도착/투사체 처리가 안 끝났으면, 그 연출·피해·사망 로그가
            // 실제로는 아직 안 끝난 것이다 - 조금 더 기다렸다가 다시 확인한다.
            if (anyActorStillFinishing()) {
                if (!shouldForceProceedPast("lastEvent")) {
                    requestAnimationFrame(playNext);
                    return;
                }
                // 안전장치 발동 - 위 조건 중 뭐가 됐든 원인을 못 찾아도 결과 화면은 반드시 뜬다.
                // forceIdleAllUnits(showResult 안에서 호출됨)가 애니메이션 정리는 알아서 해준다.
            }
            clearAnimWait("lastEvent");
            showResult();
            return;
        }

        const event = data.events[eventIndex];
        const eventType = event.event_type || "basic_attack";

        if (eventType === "star_effect_resolve") {
            // 성급별 효과(전투 시작 시 1회) - 스탯이 오르내린 대상마다 해당 상태 아이콘을 켠다.
            // 전투 내내 유지되는 영구 효과라 지속시간 없이 전투가 끝날 때까지(사망 전까지) 계속 떠 있는다.
            (event.detail?.changes || []).forEach((change) => {
                const changedKey = findUnitKey(change.target_side, change.target);
                if (!changedKey) return;
                // source = "시전자:효과타입" - 성급 효과는 전투 시작 시 1회만 발동하므로 재적용(갱신)은
                // 없고, 서로 다른 캐릭터의 성급 효과가 같은 대상에게 겹칠 때만(source가 달라짐) 중첩된다.
                const source = `${event.actor}:${event.effect_type}`;
                if (change.atk > 0) setStatusIcon(changedKey, "atk_up", { source });
                if (change.atk < 0) setStatusIcon(changedKey, "atk_down", { source });
                if (change.hp > 0) setStatusIcon(changedKey, "maxhp_up", { source });
                if (change.hp < 0) setStatusIcon(changedKey, "maxhp_down", { source });
                // 이의진: 치명타 피해량/확률 증가(self_crit_multiplier) - 스탯 변화는 아니지만 같은
                // 방식(전투 끝까지 유지)으로 아이콘을 띄운다.
                if (change.crit > 0) setStatusIcon(changedKey, "crit_up", { source });
                if (change.crit_chance > 0) setStatusIcon(changedKey, "crit_chance_up", { source });
                // 최재혁(또는 "마법사 아카데미"로 부여받은 아군): 후방 적 우선 공격 - 마찬가지로 스탯
                // 변화는 아니지만 전투 내내 유지되는 상태라 같은 방식으로 아이콘만 띄운다.
                if (change.rear_priority > 0) setStatusIcon(changedKey, "rear_priority", { source });
                flashEffectAura(changedKey, (change.atk < 0 || change.hp < 0) ? "debuff" : "buff");
            });
        } else if (eventType === "trait_resolve") {
            // 전투 시작과 동시에 1회만 판정되는 특성 - 파트너 제거(도플갱어) 등은 즉시 반영한다.
            const traitActorKey = eventActorKey(event);
            if (event.effect_type === "ally_synergy_remove_absorb" && event.detail?.removed) {
                const removedKey = findUnitKey(event.side, event.detail.removed);
                if (removedKey) {
                    units[removedKey].hp = 0;
                    renderUnit(removedKey);
                }
                if (traitActorKey) {
                    // 흡수 = 공격력·최대체력 증가 버프를 받은 것
                    flashEffectAura(traitActorKey, "buff");
                    setStatusIcon(traitActorKey, "atk_up", { source: `${traitActorKey}:${event.effect_type}` });
                    setStatusIcon(traitActorKey, "maxhp_up", { source: `${traitActorKey}:${event.effect_type}` });
                }
            } else if (event.effect_type === "ally_synergy_atk_buff" && traitActorKey) {
                // stat이 "hp"면(청년 - 송주헌과의 시너지) 체력 버프, 그 외(기본값)는 공격력 버프.
                flashEffectAura(traitActorKey, "buff");
                if (event.detail?.hp_percent !== undefined) {
                    setStatusIcon(traitActorKey, "maxhp_up", { source: `${traitActorKey}:${event.effect_type}` });
                } else {
                    setStatusIcon(traitActorKey, "atk_up", { source: `${traitActorKey}:${event.effect_type}` });
                }
            } else if (event.effect_type === "dynamic_grant_rear_priority" && event.detail?.partner) {
                // 최재혁 "마법사 아카데미": 파트너(아군 마법사)도 후방 우선 타겟팅을 받는다 - 캐스터 본인의
                // 아이콘은 star_effect_resolve(self_rear_priority)가 이미 띄우므로, 여기선 파트너 몫만 켠다.
                const partnerKey = findUnitKey(event.side, event.detail.partner);
                if (partnerKey) {
                    setStatusIcon(partnerKey, "rear_priority", { source: `${partnerKey}:${event.effect_type}` });
                }
            }
            appendLog(traitLogText(event), "trait");
        } else if (eventType === "cast_start") {
            const actorKey = eventActorKey(event);
            if (actorKey) {
                // 이 시전을 지금(디스패치 시점) 토큰으로 못박아둔다 - interruptCasting은 배우 체인을
                // 거치지 않고 즉시(동기적으로) 실행되므로, 이 클로저가 체인에서 자기 차례를 기다리는
                // 동안 다른 배우의 CC가 이 배우를 기절시켜 시전이 취소될 수 있다. 그때 interruptCasting이
                // attackAnimTokens[actorKey]를 올리므로, 아래에서 실제로 시작하기 직전 토큰이 그대로인지
                // 다시 확인해서 다르면(그 사이 취소됨) casting 자세를 아예 시작하지 않는다 - 안 그러면
                // 백엔드가 이미 취소해서 skill_resolve를 절대 안 보낼 시전인데도 재생을 시작해버려서,
                // 그 캐릭터가 마지막 캐스트 프레임에 영구히 멈춰버리는 버그가 있었다.
                //
                // 여기서는 반드시 "읽기"만 해야 한다(직접 증가시키면 안 됨) - 이 시점에 막 끝나가는
                // 직전 애니메이션(예: 3번째 기본공격의 playAttackFrames)이 자기 토큰을 잡아둔 채
                // getAttackFrameCount 같은 비동기 조회를 기다리고 있을 수 있는데, 여기서 토큰을
                // 증가시키면 "다른 호출이 이미 새 토큰을 발급했다"는 신호로 오인되어 그 3번째 공격
                // 애니메이션이 재생되지도 못하고 조용히 중단되면서 attackAnimActive를 true로 남겨둔
                // 채 끝나버린다(그 상태를 자기가 아니라 "새 토큰을 발급한 쪽"이 이어받는다고 가정하고
                // 일부러 안 건드리는 기존 관례 때문 - 그런데 여기서 미리 토큰만 올리고 아무 애니메이션도
                // 시작 안 하면 그 관례가 깨진다). 그러면 다음 줄의 waitForAnimIdle이 attackAnimActive가
                // 영원히 안 꺼진 채로 기다리다 1.5초 워치독에 걸려서야 겨우 풀리고, 그 워치독 자신의
                // 토큰 증가 때문에 이 castDispatchToken 검사도 실패해 캐스팅 애니메이션까지 스킵됐었다
                // (실제로 "2번 공격 후 시전"+"시전 애니메이션 미재생"으로 함께 나타난 회귀). 순수하게
                // 읽기만 하면 자연 완료(토큰 안 바뀜)와 진짜 인터럽트(다른 함수가 토큰을 올림)를 여전히
                // 정확히 구분하면서도, 이 코드 자신이 실수로 진행 중인 애니메이션을 무효화하지 않는다.
                const castDispatchToken = attackAnimTokens[actorKey] || 0;
                // 시전 자세/애니메이션은 이 배우 전용 체인에 매달아둔다 - waitForAnimIdle이 이 배우 자신의
                // 직전 애니메이션(예: 방금 3번째 기본공격 윈드업)이 끝날 때까지만 기다리고, 다른 배우의
                // 이벤트 처리는 전혀 막지 않는다(전역 커서는 이 체인을 기다리지 않고 곧바로 다음 이벤트로).
                chainActorAnim(actorKey, async () => {
                    await waitForAnimIdle(actorKey);
                    if (attackAnimTokens[actorKey] !== castDispatchToken) return;
                    const castStartImgEl = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
                    castStartImgEl?.classList.add("casting");
                    // 강승유 전용: 시전 중에는 금빛 펄스 대신 무지개빛으로 물든다.
                    if (event.actor === "강승유") castStartImgEl?.classList.add("casting-rainbow");
                    await playCastFrames(actorKey, event.duration * 1000 * playbackSpeed);
                });
            }
            // 로그는 체인 밖에서 즉시 남긴다 - 안 그러면 이 배우의 체인이 밀려있는 동안 다른 배우의
            // 나중 이벤트 로그가 먼저 찍혀서 시간 순서가 뒤바뀐다.
            appendLog(`${event.actor}, [Active] 시전 중...`, event.side);
        } else if (eventType === "skill_resolve") {
            const actorKey = eventActorKey(event);
            // 강승유(copy_target_skill)는 event.effect_type이 항상 "copy_target_skill"로 찍히지만,
            // 실제로 복제한 원본 효과 이름은 detail.copied_effect_type에 들어있다 - 그게 있으면 그걸
            // 기준으로 연출을 분기해서, 복제한 스킬의 실제 전용 이펙트가 원본과 동일하게 나오게 한다.
            // (복제할 스킬이 없어 단순 피해로 폴백된 경우엔 copied_effect_type이 없으므로 그대로 event.effect_type을 쓴다.)
            const dispatchEffectType = event.detail?.copied_effect_type || event.effect_type;

            // 이의진 "염색체 변환": 복귀 애니메이션(아래 playReturnFrames)이 전환 "후" 모습으로 재생돼야
            // 하므로, return 프레임을 부르기 전에 상태부터 반영해둔다 - spriteVariantSuffix가 이 값을 본다.
            if (dispatchEffectType === "self_type_swap_heal" && actorKey && units[actorKey]) {
                units[actorKey].isType2 = !!event.detail?.type2_active;
            }

            // 방임(neglect) 해제 즉시 발동은 백엔드가 cast_start 없이 skill_resolve만 보낸다(무방비
            // 노출을 막으려고 정상 시전 절차 자체를 건너뛰기 때문 - battle_engine.py 참고). 그래서
            // 이 배우 체인엔 평소처럼 앞서 매달려있는 playCastFrames가 없어 시전 자세가 전혀 안 뜨고,
            // 곧바로 아래(2451번 줄)의 "casting 해제 + 복귀 애니메이션"만 얹혀서 마치 아무 자세도 없이
            // "복귀"만 하는 것처럼 보인다. 이걸 순수 연출로만 보정한다 - 백엔드 판정(HP 등)은 이미
            // 이 시점에 다 끝난 상태 그대로 두고(재현/딜레이 없음), 화면에만 "시전 자세가 짧게 재생된
            // 뒤에 효과가 터진다"는 인상을 준다. onNeglectReleasePoseDone은 아래 dispatchEffectType별
            // 분기(이번 이벤트 처리의 나머지, 지금 이 동기 실행 흐름 안에서 곧 채워짐)가 채워주는데,
            // 이 클로저 자신은 항상 그보다 나중(비동기, playCastFrames가 끝난 뒤)에야 실행되므로 항상
            // 채워진 뒤에 호출된다.
            const isNeglectReleaseTrigger = Boolean(event.detail?.neglect_release_trigger);
            let onNeglectReleasePoseDone = null;
            if (isNeglectReleaseTrigger && actorKey && units[actorKey]) {
                chainActorAnim(actorKey, async () => {
                    await waitForAnimIdle(actorKey);
                    const poseImgEl = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
                    poseImgEl?.classList.add("casting");
                    await playCastFrames(actorKey, NEGLECT_RELEASE_POSE_SECONDS * 1000 * playbackSpeed);
                    onNeglectReleasePoseDone?.();
                });
            }

            if (actorKey) {
                // "시전 자세 풀기 + 복귀 애니메이션"만 이 배우 전용 체인에 매달아둔다(순수 스프라이트
                // 연출이라 데이터 의존이 없다) - 상태 아이콘/오라 등 나머지는 지금처럼 즉시 반영한다.
                // 안 그러고 이 skill_resolve 전체를 체인에 매달면, 이 배우의 체인이 밀려있는 동안
                // 무관한 다른 배우가 같은 대상을 먼저/나중에 때리는 이벤트가 끼어들 때 체력이 과거
                // 값으로 되돌아가는 회귀가 생길 수 있다. cast_start 때 이미 같은 체인에 playCastFrames가
                // 매달려 있으므로, 체인 순서 자체가 "그게 끝나야 복귀 애니메이션 시작"을 보장한다 -
                // 복귀 전용 프레임(return_N.png)이 있으면 그걸 재생하고, 없는 캐릭터는 playReturnFrames
                // 내부에서 프레임 0장으로 판정되어 곧바로 battle_idle.png로 스냅한다(기존과 동일).
                if (units[actorKey]) {
                    chainActorAnim(actorKey, async () => {
                        const castImgEl = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
                        castImgEl?.classList.remove("casting", "casting-rainbow");
                        // 청년(밀쳐내기): 이 배우 자신의 시전 자세가 "실제로" 끝난 이 시점에야 밀쳐내기를
                        // 실행한다 - waitForAnimIdle이 이 배우의 직전 애니메이션 때문에 시전 자세 시작
                        // 자체가 늦어졌을 때, 전역 커서는 그 지연을 모른 채 정상 스케줄대로 이 skill_resolve를
                        // 처리해버려서(HP 등 데이터는 즉시 반영하는 게 맞지만) 시전 자세가 채 끝나기도
                        // 전에 밀쳐내기 연출이 먼저 나가버리는 버그가 있었다. 순수 연출(위치 이동)이라
                        // 데이터 의존이 없으므로, 이 배우 전용 체인에 매달아도 다른 배우와의 HP 역행
                        // 위험이 없다(applySkillHits로 인한 HP 반영은 아래 동기 분기에서 여전히 즉시 처리).
                        if (dispatchEffectType === "bonus_damage_knockback" && event.detail?.hits?.length) {
                            const hit = event.detail.hits[0];
                            const knockTargetKey = findHitKey(hit.target, hit.target_side);
                            if (knockTargetKey) {
                                applyKnockback(knockTargetKey, { distance: 9999, suspendSelfWalker: true });
                                flashEffectAura(knockTargetKey, "cc");
                                setStatusIcon(knockTargetKey, "knockback", { source: `${event.actor}:knockback`, durationMs: MOMENT_ICON_MS });
                                if (event.detail?.interrupted_cast) interruptCasting(knockTargetKey, hit.target_side);
                            }
                        }
                        await playReturnFrames(actorKey);
                    });
                }
                // 시전자 몸이 카테고리 색으로 번쩍이던 예전 연출은 제거 - 오라는 이제 효과를 "받은"
                // 대상에게만 나왔다가 사라진다(flashEffectAura). 자기 자신에게 거는 효과(버프/실드)는
                // 시전자가 곧 수신자이므로 시전자에게 뜨는 게 맞다.

                if (dispatchEffectType === "self_stack_buff" && event.detail?.stack_count) {
                    // 윤대웅: 지속되는 윤곽선 오라 대신, 버프를 받는 순간마다 붉은 오라가 나왔다가 사라진다.
                    // 자기 자신이 유일한 source라서 재시전은 "새 중첩"이 아니라 같은 source의 무게(weight)가
                    // 커지는 것으로 처리한다 - 실제로 스택 수만큼 커지는 걸 정확히 반영.
                    flashEffectAura(actorKey, "buff");
                    setStatusIcon(actorKey, "atk_up", { source: `${actorKey}:self_stack_buff`, weight: event.detail.stack_count });
                }

                if (dispatchEffectType === "self_shield_duration" && event.detail?.shield_seconds) {
                    const shieldMs = event.detail.shield_seconds * 1000 * playbackSpeed;
                    flashEffectAura(actorKey, "special"); // 무적(실드) = 스페셜(흰색)
                    setStatusIcon(actorKey, "immune", { source: `${actorKey}:self_shield_duration`, durationMs: shieldMs });
                }

                if (dispatchEffectType === "conditional_target_debuff") {
                    // 김남옥: 공격속도 증가는 대상 성별과 무관하게 항상 자신에게 적용되는 버프.
                    // source를 자기 자신 고정으로 두어, 반복 시전은 "갱신"으로만 처리되고 중첩되지 않는다.
                    const hasteMs = (event.detail?.haste_seconds || 0) * 1000 * playbackSpeed;
                    flashEffectAura(actorKey, "buff");
                    setStatusIcon(actorKey, "atk_speed_up", { source: `${actorKey}:haste`, ...(hasteMs ? { durationMs: hasteMs } : {}) });
                }

                // 복제체(윤영준/강승유)는 기존 전방/후방을 대체하지 않는 추가 유닛 - 시전자 전용 summon 슬롯에
                // 매번 새로 생성한다(clone_slot이 "summon-front"/"summon-back"으로 시전자의 자리를 알려준다).
                // (이미 그 슬롯에 이전 복제체가 있었다면 detail.replaced에 이름이 담겨오지만, 살아있는 아군이 제거되는 일은 없다.)
                if (dispatchEffectType === "summon_clone" && event.detail?.summoned) {
                    const cloneKey = `${event.side}-${event.detail.clone_slot || "summon"}`;
                    const caster = units[actorKey];

                    // 윤(호 출격!): 소환 대가로 자신의 현재 체력을 소모하는 경우(hp_cost_percent가 있는
                    // 캐릭터만 해당 - caster_hp_after가 있을 때만) 체력바를 즉시 반영하고 회복과 구분되는
                    // 파란(debuff) 오라로 "대가를 치렀다"는 걸 보여준다.
                    if (caster && event.detail.caster_hp_after != null) {
                        caster.hp = event.detail.caster_hp_after;
                        renderUnit(actorKey);
                        flashEffectAura(actorKey, "debuff");
                    }

                    units[cloneKey] = {
                        name: event.detail.clone_name,
                        maxHp: event.detail.clone_hp,
                        hp: event.detail.clone_hp,
                        isMelee: caster ? caster.isMelee : true,
                        // clone_sprite_outfit이 있으면(윤의 "호") 시전자가 누구든(강승유가 복제해도) 항상
                        // 이 outfit 폴더의 그림을 쓴다 - 없으면(대부분의 소환수) 시전자 outfit을 그대로 물려받는다.
                        outfit: event.detail.clone_sprite_outfit || (caster ? caster.outfit : null),
                        style: caster ? caster.style : "melee",
                        // 윤의 "호"처럼 시전자와 같은 outfit 폴더를 공유하되 접미사로만 구분되는 스프라이트를
                        // 쓰는 경우(spriteVariantSuffix 참고) - 없으면(대부분의 소환수) 시전자와 완전히 같은 그림.
                        spriteVariant: event.detail.clone_sprite_variant || "",
                        // 호처럼 목표 히트박스에 이 비율(%)만큼 실제로 파고들어야 도착으로 치는 소환수
                        // (getGapToTarget 참고) - 없으면(대부분의 소환수) 기존처럼 살짝만 닿아도 도착.
                        meleeOverlapPercent: event.detail.clone_melee_overlap_percent || null,
                        // 강승유의 "성대모사"처럼 남의 스킬을 복제해서 나온 소환수인지 - 윤의 "호"는 소환
                        // 계열이라 자기 그림 그대로 두지만(spriteVariant는 있어도 복제는 아님), 강승유가
                        // 그 "호 출격!"을 복제하면(copy_target_skill) 결과물은 소환이 아니라 "복제"이므로
                        // 자기 그림(spriteVariant)이 있어도 아래 홀로그램 틴트를 씌운다.
                        isCopy: Boolean(event.detail.copied_from),
                    };

                    const cloneEl = document.querySelector(`[data-unit="${cloneKey}"]`);
                    const casterEl = document.querySelector(`[data-unit="${actorKey}"]`);
                    // 복제체는 시전자 본인이 서 있는 바로 그 자리에 생성된다.
                    if (cloneEl) {
                        cloneEl.hidden = false;
                        cloneEl.style.transform = ""; // 이전 복제체가 남긴 인라인 transform이 있으면 먼저 지운다
                        // getCurrentTranslateX로 "현재(방금 리셋한 CSS 기본값 포함) translateX"를 읽어서
                        // 그 위에 델타를 더해야 한다 - transform을 절대값으로 통째로 덮어쓰면서 델타를
                        // "리셋된 위치 기준"으로만 계산하면, summon 슬롯의 CSS 기본 transform(칸 밖으로
                        // 빼두는 값)이 통째로 상쇄되지 않고 그대로 더 얹혀서 엉뚱한 자리에 생성된다.
                        if (casterEl) {
                            const cloneRect = cloneEl.getBoundingClientRect();
                            const casterRect = casterEl.getBoundingClientRect();
                            const currentCloneX = getCurrentTranslateX(cloneEl);
                            cloneEl.style.transform = `translateX(${currentCloneX + (casterRect.left - cloneRect.left)}px)`;

                            // 시전자는 복제체가 자기 자리를 차지한 만큼, 자기 자신의 스프라이트 너비만큼 뒤로
                            // 밀려난다(서로 겹치지 않게) - 청년의 넉백(applyKnockback)과 완전히 같은 방식: CSS
                            // 트랜지션으로 부드럽게 밀려나고(한 번 점프시키고 손을 뗀다), 넉백(CC기) 오라/아이콘도 동일하게 뜬다.
                            // 밀려난 뒤 되돌아오는 별도 연출은 없다 - suspendSelfWalker 덕분에 트랜지션이
                            // 끝나자마자 walker가 깨어나 원래 근접 거리를 목표로 자연스럽게 다시 걸어온다.
                            flashEffectAura(actorKey, "cc");
                            setStatusIcon(actorKey, "knockback", { source: `${actorKey}:knockback`, durationMs: MOMENT_ICON_MS });
                            // 복제체 생성 넉백은 팀 기준 고정 방향이 아니라, 지금 보고 있는 방향의 반대로
                            // 밀려난다(등 뒤로 물러나는 느낌) - isFacingFlipped(false=오른쪽을 봄 -> 왼쪽으로
                            // 넉백, true=왼쪽을 봄 -> 오른쪽으로 넉백).
                            const summonKnockDir = isFacingFlipped(actorKey) ? 1 : -1;
                            applyKnockback(actorKey, {
                                distance: casterRect.width,
                                durationMs: 380,
                                suspendSelfWalker: true,
                                knockDir: summonKnockDir,
                            });
                        }
                    }
                    // 이전 점유자가 이 슬롯에서 애니메이션 도중(시전/공격 등)에 교체됐을 수 있으므로,
                    // 그 잔여 루프/체인/대기 상태를 전부 정리한다 - 안 그러면 이전 점유자의 진행 중이던
                    // 애니메이션 클로저가 나중에 실행되며 units[cloneKey](이미 새 복제체로 바뀜)를
                    // 잘못 건드리거나, 새 복제체가 이전 점유자의 밀려있던 체인 뒤에서 최대 수백ms 동안
                    // 멈춰 보일 수 있다.
                    attackAnimTokens[cloneKey] = (attackAnimTokens[cloneKey] || 0) + 1;
                    attackAnimActive[cloneKey] = false;
                    rangedResolvePending[cloneKey] = false;
                    meleeHitPending[cloneKey] = false;
                    delete actorAnimChain[cloneKey];
                    delete walkerSuspended[cloneKey];
                    getAttackFrameCount(units[cloneKey].outfit);
                    ensureSummonRosterRow(cloneKey, units[cloneKey]);
                    deathHandled[cloneKey] = false;
                    renderUnit(cloneKey);
                    // "복제" 계열(윤영준의 복제체, 강승유가 복제한 스킬의 결과물)은 전체적으로 푸른
                    // 색감이 돌도록(3D 프린트 홀로그램 느낌) - 다만 윤의 "호"는 복제가 아니라 소환이라
                    // 전용 스프라이트(spriteVariant)가 있으면 원래 색 그대로 두고, 그 "호"를 강승유가
                    // 복제한 경우(isCopy)에는 소환이 아니라 복제이므로 자기 그림이 있어도 틴트를 씌운다.
                    // toggle로 명시적 on/off를 주는 이유는 이 자리에 다른 소환 특성의 결과물이
                    // 재소환돼도 이전 틴트 상태가 안 남게 하기 위함.
                    document.querySelector(`[data-unit="${cloneKey}"] .battle-unit-img`)
                        ?.classList.toggle("is-clone", !units[cloneKey].spriteVariant || units[cloneKey].isCopy);
                    // 호처럼 다른 스프라이트와 겹쳐도 항상 그 위에 그려져야 하는 소환수 - 히트박스
                    // 엘리먼트(.battle-unit) 자체에 z-index를 고정으로 올리는 클래스를 토글한다.
                    document.querySelector(`[data-unit="${cloneKey}"]`)
                        ?.classList.toggle("render-on-top", Boolean(event.detail.clone_render_on_top));

                    // 근거리 복제체는 다른 근접 유닛과 완전히 동일하게 취급한다 - meleeArrived를 false로
                    // 두면 이동 루프(tick)가 다음 프레임에 실제 겹침 여부를 직접 재서 판정하고, 도착으로
                    // 확인되는 순간에만 faceToward를 걸고 공격을 허용한다(waitForMeleeArrival이 그 전까지
                    // 공격 자체를 막는다). 이제 시전자 자리에서 스폰되므로(적 자리가 아님) 다른 근접
                    // 유닛과 마찬가지로 실제로 걸어서 접근하는 과정을 거친다.
                    if (units[cloneKey].isMelee) {
                        const enemyFrontKey = event.side === "attacker" ? "defender-front" : "attacker-front";
                        meleeTargetKey[cloneKey] = enemyFrontKey;
                        meleeArrived[cloneKey] = false;
                    }
                }
            }

            // 캐릭터 전용 스킬 발사체 연출. 김남옥(여성 대상 기절 성공)·이종복은 투사체가 대상에
            // 닿는 순간에 맞춰 피해/상태 표시를 늦추고, 서민석·임소정은 즉시 반영하면서 투사체만 얹는다.
            // (dispatchEffectType 기준으로 분기하므로, 강승유가 이 스킬들을 복제했을 때도 동일하게 탄다.)
            if (dispatchEffectType === "conditional_target_debuff" && actorKey) {
                // 공격속도 증가는 대상 성별과 무관하게 항상 발동, 기절은 조건(대상 여성) 충족 시에만.
                const hasteText = `공격 속도 ${event.detail?.haste_percent || 0}% 증가`;
                const targetKey = event.detail?.stunned && event.detail.target
                    ? findHitKey(event.detail.target, event.detail.target_side) : null;
                if (targetKey) {
                    playDualCrayonSkillProjectile(actorKey, targetKey, () => {
                        // 기절(CC기) = 보라색 오라 + 기절 아이콘(지속시간 동안). source=시전자 - 같은
                        // 캐릭터가 다시 기절시키면 중첩이 아니라 갱신(지속시간만 새로 시작).
                        flashEffectAura(targetKey, "cc");
                        setStatusIcon(targetKey, "stun", {
                            source: `${event.actor}:stun`,
                            durationMs: (event.detail.stun_seconds || 0) * 1000 * playbackSpeed,
                        });
                        if (event.detail?.interrupted_cast) interruptCasting(targetKey, event.detail.target_side);
                        appendLog(`${event.actor}의 [Active] 발동! ${hasteText}, ${event.detail.target} ${event.detail.stun_seconds}초 기절`, event.side);
                    });
                } else {
                    applySkillHits(event);
                    appendLog(`${event.actor}의 [Active] 발동! ${hasteText}`, event.side);
                }
            } else if (dispatchEffectType === "stun_target" && event.detail?.hit) {
                const stunTargetKey = event.detail.target ? findHitKey(event.detail.target, event.detail.target_side) : null;
                if (stunTargetKey) {
                    flashEffectAura(stunTargetKey, "cc");
                    setStatusIcon(stunTargetKey, "stun", {
                        source: `${event.actor}:stun`,
                        durationMs: (event.detail.stun_seconds || 0) * 1000 * playbackSpeed,
                    });
                    if (event.detail?.interrupted_cast) interruptCasting(stunTargetKey, event.detail.target_side);
                }
                // 송주헌 "격차 벌리기": 기절과 함께 피해도 준다 - hits가 있으면 데미지 숫자/체력바도 반영.
                if (event.detail?.hits?.length) applySkillHits(event);
                const dmgText = event.detail?.hits?.length ? `, ${hitsSummaryText(event.detail.hits)}` : "";
                appendLog(`${event.actor}의 [Active] 발동! ${event.detail.target} ${event.detail.stun_seconds}초 기절${dmgText}`, event.side);
            } else if (dispatchEffectType === "damage_hp_percent_plus_atk" && actorKey && event.detail?.hits?.length) {
                const hit = event.detail.hits[0];
                const targetKey = findHitKey(hit.target, hit.target_side);
                if (targetKey) {
                    const wasAlreadyDead = captureAndApplyHp(targetKey, hit.target_hp_after);
                    spawnMeteorProjectile(actorKey, targetKey, () => {
                        if (wasAlreadyDead) return;
                        renderUnit(targetKey);
                        flashHit(targetKey, hit.is_crit, hit.type_multiplier);
                        appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail.hits)}`, event.side);
                    });
                } else {
                    applySkillHits(event);
                    appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail.hits)}`, event.side);
                }
            } else if (dispatchEffectType === "aoe_gendered_damage" && actorKey) {
                applySkillHits(event);
                (event.detail?.hits || []).forEach((hit) => {
                    const targetKey = findHitKey(hit.target, hit.target_side);
                    if (!targetKey) return;
                    const gender = effectiveGender(hit.target, targetKey);
                    spawnHeartProjectile(actorKey, targetKey, gender === "여" ? "heart-red" : "heart-pink", () => {});
                });
                appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail?.hits)}`, event.side);
            } else if (dispatchEffectType === "debuff_atk_and_damage" && actorKey && event.detail?.hits?.length) {
                applySkillHits(event);
                const hit = event.detail.hits[0];
                const targetKey = findHitKey(hit.target, hit.target_side);
                if (targetKey) {
                    playElectricBolt(actorKey, targetKey, true, null, ELECTRIC_ORIGIN_SKILL);
                    // 공격력 감소(디버프) = 파란색 오라 + 공격력 감소 아이콘(지속시간 동안)
                    flashEffectAura(targetKey, "debuff");
                    setStatusIcon(targetKey, "atk_down", {
                        source: `${event.actor}:atk_down`,
                        durationMs: (event.detail?.debuff_seconds || 0) * 1000 * playbackSpeed,
                    });
                }
                appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail.hits)}, 공격력 감소`, event.side);
            } else if (dispatchEffectType === "bonus_damage_knockback" && actorKey && event.detail?.hits?.length) {
                // HP 데이터는 여기서 즉시 반영한다(다른 배우 이벤트와의 HP 역행 방지) - distance를 크게
                // 잡고 applyKnockback 내부의 맵 경계 클램프에 맡기는 실제 밀쳐내기 연출(위치 이동)과 그에
                // 딸린 오라/아이콘/interruptCasting은 이 배우 자신의 시전 자세가 실제로 끝나는 시점에
                // 맞춰야 해서, 위쪽 이 배우 전용 체인(chainActorAnim) 안으로 옮겼다.
                applySkillHits(event);
                appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail.hits)}, 밀쳐냄`, event.side);
            } else if (dispatchEffectType === "aoe_enemy_damage" && actorKey) {
                // 가스 숨결이 화면을 가로질러 실제로 닿는 순간(onArrive)에 맞춰 피해/HP/피격 이펙트를 반영한다 -
                // 예전엔 스킬 발동 즉시 피해가 반영돼서 투사체가 아직 날아가는 중인데 이미 맞은 것처럼 보였다.
                // HP는 지금(이벤트 처리 시점) 즉시 반영하고(죽음 여부도 함께 캡처), 가스가 도착하는
                // 시점엔 화면(렌더/이펙트)만 갱신한다 - captureAndApplyHp 참고.
                const gasHits = event.detail?.hits || [];
                const gasDeadFlags = gasHits.map((hit) => captureAndApplyHp(findHitKey(hit.target, hit.target_side), hit.target_hp_after));
                spawnGasBreathStream(actorKey, () => {
                    gasHits.forEach((hit, i) => {
                        if (gasDeadFlags[i]) return;
                        const hitKey = findHitKey(hit.target, hit.target_side);
                        if (!hitKey) return;
                        renderUnit(hitKey);
                        flashHit(hitKey, hit.is_crit, hit.type_multiplier);
                    });
                });
                appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail?.hits)}`, event.side);
            } else if (dispatchEffectType === "heal_ally_percent_max_hp" && event.detail?.healed) {
                const healTargetKey = findHitKey(event.detail.target, event.detail.target_side);
                if (healTargetKey) {
                    // 회복도 같은 이유(captureAndApplyHp 참고)로 HP는 지금 즉시 반영한다 - 안 그러면 그
                    // 사이 대상이 다른 이벤트로 먼저 죽었을 때, 뒤늦게 도착한 회복 연출이 죽기 전 HP에
                    // 회복량을 더해 이미 쓰러진 캐릭터를 되살릴 수 있다.
                    const newHp = Math.min(units[healTargetKey].maxHp, units[healTargetKey].hp + event.detail.amount);
                    const wasAlreadyDead = captureAndApplyHp(healTargetKey, newHp);
                    spawnHealingHeart(healTargetKey, () => {
                        if (wasAlreadyDead) return;
                        renderUnit(healTargetKey);
                        // 회복 = 연두색 오라 + 회복 아이콘(회복되는 순간 생겼다가 사라짐)
                        flashEffectAura(healTargetKey, "heal");
                        setStatusIcon(healTargetKey, "heal", { source: `${event.actor}:heal`, durationMs: MOMENT_ICON_MS });
                        appendLog(`${event.actor}의 [Active] 발동! ${event.detail.target} 체력 ${event.detail.amount} 회복`, event.side);
                    });
                } else {
                    appendLog(`${event.actor}의 [Active] 발동!`, event.side);
                }
            } else if (dispatchEffectType === "self_type_swap_heal" && actorKey) {
                // 이의진 "염색체 변환" - isType2는 위에서 이미 토글해뒀다(playReturnFrames가 새 스프라이트로
                // 재생되도록). 여기서는 자힐 반영 + 상태 아이콘/오라만 얹는다(투사체 없는 자기 대상 스킬).
                if (event.detail?.healed_amount) {
                    units[actorKey].hp = Math.min(units[actorKey].maxHp, units[actorKey].hp + event.detail.healed_amount);
                    renderUnit(actorKey);
                }
                flashEffectAura(actorKey, "heal");
                setStatusIcon(actorKey, "heal", { source: `${actorKey}:type_swap_heal`, durationMs: MOMENT_ICON_MS });
                appendLog(
                    `${event.actor}의 [Active] 발동! ${event.detail?.type2_active ? "염색체 변환(type2)" : "염색체 변환(type1)"} - 체력 ${event.detail?.healed_amount || 0} 회복`,
                    event.side
                );
            } else if (dispatchEffectType === "aoe_all_others_damage" && actorKey && event.detail?.hits?.length) {
                // 불빠따 김어진 "불빠따" - 발밑에서 좌우로 땅불이 번져나가며, 자신을 제외한 아군 1명 +
                // 적 전체를 때린다. 각 대상은 불이 실제로 그 위치까지 번져야(거리 비례) 피해가 반영된다.
                // HP는 지금 즉시 반영(죽음 여부도 함께 캡처)하고, 불이 도착하는 시점엔 화면만 갱신한다.
                event.detail.hits.forEach((hit) => {
                    hit.__wasAlreadyDead = captureAndApplyHp(findHitKey(hit.target, hit.target_side), hit.target_hp_after);
                });
                spawnGroundFireCanvas(actorKey, event.detail.hits, (hit) => {
                    if (hit.__wasAlreadyDead) return;
                    const hitKey = findHitKey(hit.target, hit.target_side);
                    if (!hitKey) return;
                    renderUnit(hitKey);
                    flashHit(hitKey, hit.is_crit, hit.type_multiplier);
                });
                appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail.hits)}`, event.side);
            } else if (dispatchEffectType === "consume_paint_multi_effect" && actorKey) {
                // 방임석 "제목은 관객이 정하세요": 보유한 물감 색깔별로 각각 독립된 투사체를 동시에 날린다
                // (서민석의 aoe_gendered_damage와 같은 "여러 투사체 병렬 발사" 패턴). 물감이 하나도
                // 없으면 흰색 투사체 하나로 강한 단일 피해만 준다.
                const d = event.detail || {};
                const hasAnyPaint = d.red || d.blue || d.yellow;
                const logParts = [];

                // 백엔드는 이 스킬이 발동하는 순간 보유 물감(빨강/파랑/노랑)을 예외 없이 전부 0으로
                // 리셋한다 - paint_gain_resolve(물감을 "얻을 때")는 아이콘을 갱신/제거하는데, 이 스킬로
                // "소모할 때"는 그런 이벤트가 따로 없어서 여기서 직접 세 색 아이콘을 전부 지워야 한다.
                // 안 그러면 실제로는 0개인데 화면엔 소모 전 개수가 그대로 남아있는 것처럼 보인다.
                ["paint_red", "paint_blue", "paint_yellow"].forEach((iconId) => {
                    clearStatusIconSource(actorKey, iconId, `${actorKey}:${iconId}`);
                });

                // 물감 계열도 전부 같은 이유(captureAndApplyHp 참고)로 HP는 지금 즉시 반영해서, 무관한
                // 다른 배우가 같은 대상을 잇달아 때리는 이벤트가 아래 투사체 연출(방임 해제 즉시
                // 발동일 땐 시전 자세 재생까지 끝나야 하므로 더 늦게 뜬다)보다 먼저 처리돼도 체력이
                // 과거 값으로 되돌아가지 않게 한다. 실제 투사체 발사(순수 연출)는 fireConsumePaintVisuals로
                // 묶어서, 평소엔 즉시 실행하고 방임 해제 즉시 발동일 땐 시전 자세가 다 재생된 뒤로 미룬다.
                let whiteHit = null;
                let redHit = null;
                let blueHeal = null;
                let stunTargets = null;
                if (!hasAnyPaint && d.hits?.length) {
                    const hit = d.hits[0];
                    const targetKey = findHitKey(hit.target, hit.target_side);
                    if (targetKey) {
                        const wasAlreadyDead = captureAndApplyHp(targetKey, hit.target_hp_after);
                        whiteHit = { hit, targetKey, wasAlreadyDead };
                    }
                    logParts.push(hitsSummaryText(d.hits));
                } else {
                    if (d.red && d.hits?.length) {
                        const hit = d.hits[0];
                        const targetKey = findHitKey(hit.target, hit.target_side);
                        if (targetKey) {
                            const wasAlreadyDead = captureAndApplyHp(targetKey, hit.target_hp_after);
                            redHit = { hit, targetKey, wasAlreadyDead };
                        }
                        logParts.push(hitsSummaryText(d.hits));
                    }

                    if (d.blue && d.heals?.length) {
                        const heal = d.heals[0];
                        // 회복은 항상 시전자와 같은 편(아군) 대상이라 event.side로 바로 찾는다(_target_ref 없음).
                        const healTargetKey = findHitKey(heal.target, event.side);
                        if (healTargetKey) {
                            const wasAlreadyDead = captureAndApplyHp(healTargetKey, heal.target_hp_after);
                            blueHeal = { heal, healTargetKey, wasAlreadyDead };
                        }
                        logParts.push(`${heal.target} 체력 ${heal.amount} 회복`);
                    }

                    if (d.yellow && d.stunned?.length) {
                        stunTargets = d.stunned;
                        logParts.push(`적 전체 ${d.stun_seconds}초 기절`);
                    }
                }

                const fireConsumePaintVisuals = () => {
                    if (whiteHit) {
                        const { hit, targetKey, wasAlreadyDead } = whiteHit;
                        spawnPaintSkillProjectile(actorKey, targetKey, "paint-white", () => {
                            if (wasAlreadyDead) return;
                            renderUnit(targetKey);
                            flashHit(targetKey, hit.is_crit, hit.type_multiplier);
                        });
                    }

                    if (redHit) {
                        const { hit, targetKey, wasAlreadyDead } = redHit;
                        spawnPaintSkillProjectile(actorKey, targetKey, "paint-red", () => {
                            if (wasAlreadyDead) return;
                            renderUnit(targetKey);
                            flashHit(targetKey, hit.is_crit, hit.type_multiplier);
                        });
                    }

                    if (blueHeal) {
                        const { heal, healTargetKey, wasAlreadyDead } = blueHeal;
                        spawnPaintSkillProjectile(actorKey, healTargetKey, "paint-blue", () => {
                            if (wasAlreadyDead) return;
                            renderUnit(healTargetKey);
                            flashEffectAura(healTargetKey, "heal");
                            setStatusIcon(healTargetKey, "heal", { source: `${event.actor}:paint_heal`, durationMs: MOMENT_ICON_MS });
                        });
                    }

                    if (stunTargets) {
                        // 노란 물감 = 적 전체 기절 - 대표로 첫 대상에게 투사체를 날리고, 도착 시 전원에게 한번에 적용한다.
                        const firstStunKey = findHitKey(stunTargets[0].target, stunTargets[0].target_side);
                        const applyAllStuns = () => {
                            stunTargets.forEach((s) => {
                                const sKey = findHitKey(s.target, s.target_side);
                                // 기절은 HP를 쓰지 않아 되살아나는 위험은 없지만, 그 사이 이미 죽은
                                // 대상에게 기절 아이콘/오라가 뜨는 건 여전히 어색하므로 함께 막는다.
                                if (!sKey || units[sKey].hp <= 0) return;
                                flashEffectAura(sKey, "cc");
                                setStatusIcon(sKey, "stun", {
                                    source: `${event.actor}:stun`,
                                    durationMs: (d.stun_seconds || 0) * 1000 * playbackSpeed,
                                });
                                if (s.interrupted_cast) interruptCasting(sKey, s.target_side);
                            });
                        };
                        if (firstStunKey) spawnPaintSkillProjectile(actorKey, firstStunKey, "paint-yellow", applyAllStuns);
                        else applyAllStuns();
                    }

                    appendLog(`${event.actor}의 [Active] 발동! ${logParts.join(", ")}`, event.side);
                };

                if (isNeglectReleaseTrigger) {
                    onNeglectReleasePoseDone = fireConsumePaintVisuals;
                } else {
                    fireConsumePaintVisuals();
                }
            } else {
                applySkillHits(event);
                if (dispatchEffectType === "summon_clone" && event.detail?.summoned) {
                    appendLog(
                        event.detail.replaced
                            ? `${event.actor}의 [Active] 발동! ${event.detail.clone_name}이(가) 새로 소환되어 이전 소환수를 대체함!`
                            : `${event.actor}의 [Active] 발동! ${event.detail.clone_name}이(가) 전장에 소환됨!`,
                        event.side
                    );
                } else if (dispatchEffectType === "self_stack_buff" && event.detail?.stack_count) {
                    appendLog(`${event.actor}의 [Active] 발동! 공격력 ${event.detail.atk_percent_bonus || 0}% 증가 (${event.detail.stack_count}중첩)`, event.side);
                } else if (dispatchEffectType === "self_shield_duration" && event.detail?.shield_seconds) {
                    appendLog(`${event.actor}의 [Active] 발동! ${event.detail.shield_seconds}초간 무적 보호막`, event.side);
                } else if (event.detail?.hits?.length) {
                    appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail.hits)}`, event.side);
                } else {
                    appendLog(`${event.actor}의 [Active] 발동!`, event.side);
                }
            }
        } else if (eventType === "death_trigger_resolve") {
            // 이영웅 "히포크라테스 선서": 자신이 죽는 순간 아군을 회복시킨다. 회복은 여럿에게 동시에
            // 갈 수 있어(heal_ally_percent_max_hp와 달리) 투사체 연출 없이 곧바로 반영한다.
            (event.detail?.heals || []).forEach((heal) => {
                const healTargetKey = findUnitKey(event.side, heal.target);
                if (!healTargetKey) return;
                units[healTargetKey].hp = heal.target_hp_after;
                renderUnit(healTargetKey);
                flashEffectAura(healTargetKey, "heal");
                setStatusIcon(healTargetKey, "heal", { source: `${event.actor}:death_heal`, durationMs: MOMENT_ICON_MS });
            });
            appendLog(`${event.actor}의 [Special] 발동! 사망과 함께 아군 회복`, "trait");
        } else if (eventType === "paint_gain_resolve") {
            // 방임석 "예술가의 혼": 물감을 얻을 때마다 상태 아이콘의 weight를 "현재 총 보유량"으로
            // 그대로 덮어쓴다(윤대웅의 self_stack_buff와 같은 방식) - 소모돼서 0이 되면 아이콘을 지운다.
            const paintKey = findUnitKey(event.side, event.actor);
            if (paintKey) {
                const iconId = `paint_${event.detail.color}`;
                const sourceKey = `${paintKey}:${iconId}`;
                if (event.detail.total > 0) {
                    setStatusIcon(paintKey, iconId, { source: sourceKey, weight: event.detail.total });
                } else {
                    clearStatusIconSource(paintKey, iconId, sourceKey);
                }
            }
        } else if (eventType === "neglect_status_resolve") {
            // 방임석 "방임": 학생 타입 아군이 있는 동안 지속 기절 + 받는 피해 감소. 고정 지속시간이 아니라
            // 그 아군이 죽는 순간 조건이 풀려서 해제되는 조건부 상태라 durationMs 없이 걸어두고("영구"가
            // 아니라 "조건이 유지되는 동안"이라는 뜻), 꺼질 때(active:false) 직접 지운다.
            const neglectKey = findUnitKey(event.side, event.actor);
            if (neglectKey) {
                if (event.detail?.active) {
                    flashEffectAura(neglectKey, "cc");
                    setStatusIcon(neglectKey, "stun", { source: `${neglectKey}:neglect` });
                    setStatusIcon(neglectKey, "damage_reduction", { source: `${neglectKey}:neglect` });
                    if (event.detail.interrupted_cast) interruptCasting(neglectKey, event.side);
                    appendLog(`${event.actor}의 [Special] 발동! 방임 상태(지속 기절, 받는 피해 감소)`, "trait");
                } else {
                    clearStatusIconSource(neglectKey, "stun", `${neglectKey}:neglect`);
                    clearStatusIconSource(neglectKey, "damage_reduction", `${neglectKey}:neglect`);
                    appendLog(`${event.actor}의 방임 상태 해제!`, "trait");
                }
            }
        } else if (eventType === "lifesteal_status_resolve") {
            // 윤 "선생 고혈": 지금 확정된 공격 대상이 선생 타입인 동안(공격/방어 상관없이) "고혈" 상태 -
            // neglect_status_resolve와 동일한 패턴(고정 지속시간 없이 조건이 유지되는 동안만 걸어두고,
            // 대상이 바뀌거나 죽어서 조건이 풀리면 직접 지운다).
            const lifestealKey = findUnitKey(event.side, event.actor);
            if (lifestealKey) {
                if (event.detail?.active) {
                    flashEffectAura(lifestealKey, "buff");
                    setStatusIcon(lifestealKey, "lifesteal", { source: `${lifestealKey}:lifesteal` });
                    appendLog(`${event.actor}의 [Special] 발동! 고혈 상태(교사 타입 대상 기본공격 시 회복)`, "trait");
                } else {
                    clearStatusIconSource(lifestealKey, "lifesteal", `${lifestealKey}:lifesteal`);
                    appendLog(`${event.actor}의 고혈 상태 해제!`, "trait");
                }
            }
        } else if (eventType === "target_lock_resolve") {
            // 백엔드가 새 기본공격 대상을 "확정"한 시점(실제 명중보다 먼저 온다) - 근접 유닛은 이 신호를
            // 받는 즉시 새 목표를 향해 걷기 시작한다. 예전엔 이 정보가 따로 없어서 실제로 명중한
            // basic_attack 이벤트로만 목표 변경을 알 수 있었는데, 근접 유닛이 걸어가서 명중시키기까지는
            // 시간이 걸리므로(특히 최재혁처럼 먼 후방을 쫓을 때) 그 사이 화면에서는 여전히 옛 목표
            // 옆에 서있다가, 뒤늦게 밀려있던 공격들이 한꺼번에 재생되는 것처럼 보이는 버그가 있었다.
            const lockActorKey = eventActorKey(event);
            const lockTargetKey = eventTargetKey(event);
            if (
                lockActorKey && lockTargetKey &&
                units[lockActorKey]?.isMelee &&
                meleeTargetKey[lockActorKey] !== lockTargetKey
            ) {
                meleeTargetKey[lockActorKey] = lockTargetKey;
                meleeArrived[lockActorKey] = false;
            }
        } else {
            // basic_attack (기존 로직 + 원거리 5명 전용 연출)
            const actorKey = eventActorKey(event);
            const targetKey = eventTargetKey(event);
            const actorIsMelee = actorKey && units[actorKey] && units[actorKey].isMelee;
            // 이 이벤트가 적용되기 "전"에 이미 죽어있었는지(=다른 이벤트가 먼저 죽인 상태) 여기서 미리
            // 캡처해둔다 - 아래에서 hp를 곧바로 덮어쓰고 나면, 이 공격 자체가 킬(target_hp_after=0)인
            // 정상적인 경우와 "이미 죽은 대상을 뒤늦게 또 때린" 경우를 더 이상 hp만 보고는 구분할 수 없다.
            const targetWasAlreadyDead = targetKey && units[targetKey] && units[targetKey].hp <= 0;

            // 데이터(HP)는 이벤트 순서 그대로, 그 어떤 지연도 없이 여기서 곧바로 반영한다.
            if (targetKey) {
                units[targetKey].hp = event.target_hp_after;
            }
            // 윤(영혼 흡수/선생 고혈): 기본공격 자체에 딸려오는 시전자 자가 회복도 데이터는 위와 같은
            // 이유로 즉시 반영한다(연출만 아래 applyHitVisual에서 타격 시점에 맞춰 보여준다).
            if (actorKey && units[actorKey] && event.actor_self_heal) {
                units[actorKey].hp = event.actor_hp_after;
            }
            // 호(자폭 소환수): 이 공격을 명중시키는 즉시 스스로 죽는다 - 데이터는 여기서 즉시 반영하고
            // (호는 이 시점에 이미 도착해서 정지해 있으므로 걷기 루프에 영향 없음), 실제로 사라지는
            // 연출(playDeathSequence)은 아래 applyHitVisual에서 공격이 화면에 닿은 뒤에 재생한다.
            if (actorKey && units[actorKey] && event.actor_self_destruct) {
                units[actorKey].hp = 0;
            }
            // meleeTargetKey는 여기서 직접 건드리지 않는다 - 아래 waitForMeleeArrival이 target이
            // 바뀌었는지 스스로 비교해서 바뀐 경우에만 meleeArrived를 다시 false로 리셋한다. 여기서
            // 미리 값을 같게 만들어버리면 그 비교가 항상 "안 바뀜"으로 나와서, 예전 타겟이 죽어 새
            // 전방으로 타겟이 바뀌어도 이미 meleeArrived=true인 채로 남아 걸어가지 않는 버그가 있었다
            // (예: 전방이 죽어 후방이 새 전방이 됐는데, 상대 근접 유닛이 원래 타겟 자리에 멈춰있음).

            function applyHitVisual() {
                if (targetKey) {
                    renderUnit(targetKey);
                    flashHit(targetKey, event.is_crit, event.type_multiplier);
                    // 이의진 type2 기본공격 부가효과(_apply_type2_stun_if_active) - 남성 대상이면 기절.
                    if (event.target_stunned) {
                        flashEffectAura(targetKey, "cc");
                        setStatusIcon(targetKey, "stun", {
                            source: `${event.actor}:stun`,
                            durationMs: (event.stun_seconds || 0) * 1000 * playbackSpeed,
                        });
                        if (event.interrupted_cast) {
                            interruptCasting(targetKey, event.side === "attacker" ? "defender" : "attacker");
                        }
                    }
                }
                // 윤(영혼 흡수/선생 고혈): 시전자 자가 회복 연출 - 데이터는 이미 위에서 즉시 반영됐고,
                // 여기서는 타격이 실제로 화면에 닿는 시점에 맞춰 체력바 갱신 + 회복 오라만 보여준다.
                if (actorKey && event.actor_self_heal) {
                    renderUnit(actorKey);
                    flashEffectAura(actorKey, "heal");
                    setStatusIcon(actorKey, "heal", { source: `${actorKey}:basic_attack_heal`, durationMs: MOMENT_ICON_MS });
                }
                // 호(자폭 소환수): renderUnit이 hp<=0을 감지해서 자동으로(golden-self-destruct가 활성
                // 상태면 playDeathSequence의 사망 스프라이트 전환은 건너뛰고) 사망 처리를 한다. 자폭
                // 공격은 아래 waitForMeleeArrival 콜백에서 applyHitVisual() 호출 자체를 폭발(detonate)
                // 순간까지 통째로 미루므로, 여기서는 그냥 즉시 부르면 된다(대상 피격도 같은 타이밍).
                if (actorKey && event.actor_self_destruct) {
                    renderUnit(actorKey);
                }
                showDamageMessage(event);
            }

            if (actorIsMelee) {
                waitForMeleeArrival(actorKey, targetKey).then(() => {
                    // 이 공격은 백엔드에서 대상이 살아있던 시점에 정당하게 발생했지만(HP는 이미 위에서
                    // 즉시 반영됨), 근거리 유닛이 화면상 실제로 도착하기까지는 시간이 걸린다 - 그 사이에
                    // 대상이 다른 이벤트로 먼저 죽어 화면에서 이미 쓰러진 상태였다면, 지금 와서 스윙/피격
                    // 연출을 재생하면 "이미 죽은 캐릭터를 한 번 더 때리는" 것처럼 보인다. targetWasAlreadyDead는
                    // 이 이벤트가 적용되기 전 상태를 미리 캡처해둔 값이라, 이 공격 자체가 정상적인 킬(방금
                    // hp가 0이 됨)인 경우까지 건너뛰지 않는다 - 그걸 건너뛰면 renderUnit이 호출되지 않아
                    // 체력바가 옛 값에 멈춰있고 사망 로그도 안 뜬 채로 전투만 끝나버리는 버그가 있었다.
                    if (targetWasAlreadyDead) return;
                    if (actorKey) playAttackFrames(actorKey);
                    // 호(자폭 소환수): 폭발이 곧 타격이다 - 스윙이 시작되는 이 순간(=아직 명중 판정 전,
                    // "뜸들이는" 구간)부터 이펙트를 먼저 튼다. playGoldenSelfDestruct 내부에서 detonate
                    // (흔들림 절정) 진입 시각을 EFFECT_LAUNCH_DELAY_MS에 맞춰뒀으므로, 아래에서 명중
                    // 판정을 미루는 시점과 정확히 겹친다.
                    if (actorKey && event.actor_self_destruct) playGoldenSelfDestruct(actorKey);
                    // 근접도 원거리(아래 else-if 분기)처럼 스윙이 몇 프레임(EFFECT_LAUNCH_DELAY_MS) 재생된
                    // 뒤에야 명중 판정이 난다 - 예전엔 스윙 시작과 동시에 판정이 나서, 근접 캐릭터만 유독
                    // 무기가 닿기도 전에 이미 맞은 것처럼 보였다.
                    if (actorKey) meleeHitPending[actorKey] = true;
                    setTimeout(() => {
                        if (actorKey) meleeHitPending[actorKey] = false;
                        applyHitVisual();
                    }, EFFECT_LAUNCH_DELAY_MS);
                });
            } else if (actorKey && targetKey) {
                // 원거리는 공격 애니메이션(윈드업)을 먼저 시작하고, 3프레임쯤 재생된 뒤에야 투사체/이펙트가 나간다.
                // 대상이 등 뒤(자기 원거리 자리까지 파고든 적 등)에 있으면 사진을 반전시켜 그쪽으로 발사한다.
                faceToward(actorKey, targetKey);
                if (actorKey) playAttackFrames(actorKey);
                rangedResolvePending[actorKey] = true;
                setTimeout(() => {
                    playRangedAttack(actorKey, targetKey, () => {
                        rangedResolvePending[actorKey] = false;
                        // 근접 분기(waitForMeleeArrival)와 동일한 가드 - 투사체가 날아가는 동안 대상이
                        // 다른 이벤트로 먼저 죽었다면, 이미 쓰러진 캐릭터에게 피격 이펙트/피해 로그를
                        // 한 번 더 띄우지 않는다(HP는 이미 위에서 즉시 반영돼 있으므로 안전).
                        if (targetWasAlreadyDead) return;
                        applyHitVisual();
                    });
                }, EFFECT_LAUNCH_DELAY_MS);
            } else {
                if (actorKey) playAttackFrames(actorKey);
                applyHitVisual();
            }
        }

        eventIndex += 1;

        // 이 이벤트를 실제로 "지금" 처리했다는 걸 기준점으로 다시 잡는다 - cast_start/skill_resolve의
        // "아직 애니메이션 중이면 대기" 재시도 게이트 등으로 이 이벤트 자체가 원래 스케줄보다 늦게
        // 처리됐을 수 있는데, 기준점을 안 갱신하면 그 지연이 보상되지 않고 그대로 다음 이벤트들에
        // 누적돼서 밀린다 - 특히 시전 애니메이션이 늦게 시작되면(직전 기본공격 윈드업이 아직 재생
        // 중이라 cast_start 자체가 밀리는 경우가 흔함) skill_resolve까지 통째로 밀리고, 그 뒤를 잇는
        // 복귀(return) 애니메이션이 재생될 시간도 없이 다음 기본공격이 끼어들어 잘리는 버그가 있었다.
        // 매번 "방금 처리한 이 이벤트 시각 = 지금"으로 원점을 다시 잡으면, 이번 지연은 여기서 끝나고
        // 다음 이벤트는 다시 정상적인(밀리지 않은) 상대 시간만큼만 기다리게 된다.
        playbackOriginWallMs = performance.now();
        playbackOriginEventTime = event.time;

        const nextEvent = data.events[eventIndex];
        let delayMs;
        if (nextEvent) {
            const targetWallMs = playbackOriginWallMs + (nextEvent.time - playbackOriginEventTime) * 1000 * playbackSpeed;
            // target_lock_resolve는 화면에 아무 것도 그리지 않는 조용한 상태 갱신용 이벤트라 최소 16ms
            // 대기(다른 이벤트들이 눈에 보이는 연출 한 프레임만큼은 걸리도록 두는 바닥값)를 적용할
            // 이유가 없다 - 넉백처럼 한 틱에 여러 유닛의 타겟이 한꺼번에 재계산되면 target_lock_resolve가
            // 무더기로 쌓이는데, 매번 16ms씩 걸리면 그게 다 더해져서 그 뒤에 나오는 실제 공격/스킬
            // 이벤트들까지 통째로 밀리고, 청년이 편성돼 넉백을 자주 쓸수록 전장의 모든 캐릭터가
            // 다같이 느려지는 것처럼 보였다.
            const minDelayMs = eventType === "target_lock_resolve" ? 0 : 16;
            delayMs = Math.max(minDelayMs, targetWallMs - performance.now());
        } else {
            // 마지막 이벤트 뒤에는 다음 이벤트가 없어 절대 시각 스케줄을 쓸 수 없다 - 원거리 공격은
            // 애니메이션 플래그(attackAnimActive)가 꺼진 뒤에도 투사체가 한동안 더 날아가는 중일 수
            // 있으므로(EFFECT_LAUNCH_DELAY_MS + 투사체 비행 시간), 그 시간을 넉넉히 덮는 값을 우선
            // 기다린다. 그래도 부족하면(근거리 도착 지연 등) 위쪽의 재시도 체크가 추가로 기다려준다.
            delayMs = EFFECT_LAUNCH_DELAY_MS + PROJECTILE_TRAVEL_MS * 2;
        }

        setTimeout(playNext, delayMs);
    }

    // 전투가 끝나는 순간까지도 시전/공격 애니메이션이 안 풀린 유닛이 있을 수 있다 - 예를 들어 마지막
    // 틱에 막 시전을 시작했는데 그 직후 상대 팀이 전멸해서 백엔드가 그 시전의 skill_resolve를 아예
    // 안 만드는 경우(전투가 끝나버려서), 그 유닛은 skill_resolve도 interruptCasting도 못 받아 화면에
    // 영원히 마지막 캐스팅 프레임에 멈춰 있게 된다("상대 원거리가 마지막 스킬 애니메이션에서 멈춰있는"
    // 버그). 결과 화면을 띄우기 직전에 아직 애니메이션 중으로 표시된 유닛을 전부 강제로 idle로 정리한다.
    function forceIdleAllUnits() {
        Object.keys(units).forEach((key) => {
            if (attackAnimActive[key]) forceClearAnim(key);
        });
    }

    function showResult() {
        walkerRunning = false;
        stopBattleTimer();
        forceIdleAllUnits();
        if (rosterOrderTimer) { clearInterval(rosterOrderTimer); rosterOrderTimer = null; }

        // attacker_won: true(승리)/false(패배)/null(무승부, 양팀 동시 전멸 시).
        const outcome = data.attacker_won === true ? "win" : data.attacker_won === false ? "lose" : "draw";
        const outcomeText = outcome === "win" ? "승리!" : outcome === "lose" ? "패배..." : "무승부";
        appendLog(`전투 종료! ${outcomeText}`, outcome);

        const resultEl = document.getElementById("battle-result");
        const textEl = document.getElementById("battle-result-text");
        const goldEl = document.getElementById("battle-result-gold");

        if (!resultEl || !textEl) return;

        textEl.textContent = outcomeText;
        textEl.className = `battle-result-text battle-${outcome}`;

        if (data.rank_changed) {
            textEl.textContent += ` 내 순위: ${data.my_new_rank}등`;
        }

        if (goldEl) {
            if (data.attacker_won === true && data.gold_reward) {
                goldEl.textContent = `+${data.gold_reward}G`;
                goldEl.hidden = false;
            } else {
                goldEl.hidden = true;
            }
        }

        resultEl.hidden = false;

        const notifyAchievements = () => {
            if (typeof showAchievementToast === "function" && data.new_achievements?.length) {
                showAchievementToast(data.new_achievements);
            }
        };
        if (typeof showCharacterReveal === "function" && data.new_characters?.length) {
            showCharacterReveal(data.new_characters, notifyAchievements);
        } else {
            notifyAchievements();
        }
    }

    document
        .getElementById("battle-close-btn")
        ?.addEventListener("click", () => {
            window.location.href = "home.html";
        });

    /*
     * 준비 시간(1.3초) 카운트다운은 그대로 유지하되, 매 프레임마다 새 줄을 추가하는 대신
     * 로그의 '같은 한 줄'을 계속 갱신하다가, 끝나면 그 줄을 "전투 시작!"으로 확정한다.
     * (매 프레임 새 줄을 추가하면 로그가 수십~수백 줄로 순식간에 도배되기 때문)
     */
    function startPreparation() {
        // 준비 시간 타이머와는 별개로, 위에서 시작해둔 프레임 프리캐시(framePrecacheReady)가 진짜로
        // 다 끝나야만 재생을 시작한다 - 캐릭터가 많거나 네트워크가 느려서 준비 시간(1.3초) 안에 probe가
        // 안 끝나면, 타이머만 보고 시작했을 때 첫 스킬에서 캐시 미스가 나는 문제가 있었다(위 주석 참고).
        // 보통은 프리캐시가 훨씬 먼저 끝나므로 실제 체감 대기시간에는 차이가 없다.
        function beginPlayback() {
            startMeleeWalker();
            startRosterOrderWatcher();
            playbackOriginWallMs = performance.now();
            playbackOriginEventTime = data.events[0]?.time ?? 0;
            startBattleTimer();
            playNext();
        }

        const prepEntry = appendLog("전투 준비 중...", null);

        if (!prepEntry) {
            const prepTimer = new Promise((resolve) => setTimeout(resolve, PREP_MS));
            Promise.all([framePrecacheReady, prepTimer]).then(beginPlayback);
            return;
        }

        const startedAt = performance.now();

        function updatePreparation(now) {
            const elapsed = now - startedAt;
            const remainingMs = Math.max(0, PREP_MS - elapsed);
            const remainingSeconds = (remainingMs / 1000).toFixed(1);

            prepEntry.textContent =
                remainingMs > 0
                    ? `전투 준비 중... ${remainingSeconds}초`
                    : "전투 시작!";

            if (remainingMs > 0) {
                requestAnimationFrame(updatePreparation);
            }
        }

        requestAnimationFrame(updatePreparation);

        const prepTimer = new Promise((resolve) => setTimeout(resolve, PREP_MS));
        Promise.all([framePrecacheReady, prepTimer]).then(() => {
            prepEntry.textContent = "전투 시작!";
            beginPlayback();
        });
    }

    // "입장하는 중..."(점 애니메이션 + 랜덤 팁)은 로비(home.html)에서 이 페이지로 넘어오기 전에
    // 이미 다 보여줬다(shared/home.js의 showLobbyEnteringOverlay) - 여기서는 그 암전을 그대로 이어받고
    // 있다가, 전투 준비가 시작될 수 있는 순간 바로 걷어서 중복 연출 없이 매끄럽게 이어지게 한다.
    const battleLoadingOverlay = document.getElementById("battle-loading-overlay");
    if (battleLoadingOverlay) battleLoadingOverlay.hidden = true;
    startPreparation();
})();