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
    // 근접 유닛 걷기 속도(MOVE_SPEED_VW_PERCENT_PER_SEC)는 이 초기값 기준으로 튜닝된 값이다 - 배속이
    // 바뀌어도 그 기준(0.8) 대비 비율로 걷는 속도를 보정해서, 배속을 바꾸기 전 원래 느낌(기본값에서의
    // 체감 속도)은 그대로 유지한 채 배속에 맞춰서만 빨라지고 느려지게 한다(startMeleeWalker 참고).
    const MOVE_STEP_BASELINE_SPEED = playbackSpeed;
    const PREP_MS = 1300;
    const PROJECTILE_TRAVEL_MS = 220;
    // 공격/스킬/복귀/걷기 프레임 이미지 존재 확인 최대 장수(MAX_ATTACK_FRAMES 등)와 그 캐시,
    // APPROACH_OVERLAP/WALK_FRAME_DURATION_MS는 shared/battle-renderer.js로 이전됨(getAttackFrameCount 등).
    const ATTACK_FRAME_DURATION_MS = 60;
    const RETURN_FRAME_DURATION_MS = 60; // 복귀 프레임은 서버가 시간을 안 주므로(시전 시간과 무관) 공격 프레임과 같은 고정 속도로 재생
    const EFFECT_LAUNCH_DELAY_MS = ATTACK_FRAME_DURATION_MS * 3; // 원거리 공격: 애니메이션 3프레임쯤 재생된 뒤 이펙트 발사



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
    // walkAnimTokens/walkAnimActive는 shared/battle-renderer.js로 이전됨(playWalkFrames/stopWalkFrames와 함께).

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

    // sleep/checkImageExists/getAttackFrameCount/getSkillFrameCount/getReturnFrameCount/getWalkFrameCount는
    // shared/battle-renderer.js로 이전됨 - 아래 playWalkFrames/playAttackFrames/playCastFrames 등이
    // 여전히 이 전역 함수들을 그대로 호출한다(bare 식별자 -> 전역 스코프로 자동 해석).

    /*
     * 로그 한 줄을 새로 추가한다(기존처럼 한 줄을 계속 덮어쓰지 않고 쌓인다).
     * side가 "attacker"면 파란색(아군), "defender"면 빨간색(적군), 그 외(null)는 금색(시스템 메시지).
     * 반환된 엘리먼트를 나중에 다시 손대면(예: 준비 카운트다운) "같은 줄을 계속 갱신"하는 것도 가능하다.
     */
    const MAX_LOG_LINES = 24; // 이보다 많아지면 오래된 줄부터 지움


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


    // 윤처럼 전투 로스터 "프로필"(idle 사진) 하나만 별도 그림을 쓰고 싶은 캐릭터용 - battle_idle/
    // attack 등 실제 전투 스프라이트는 그대로 두고 이 로스터 초상화만 idle${variant}.webp로 바꾼다.
    // 호는 별도 표에 넣지 않는다 - 이미 units[cloneKey].spriteVariant("_ho")가 있어서 그걸 그대로 쓴다.
    const PROFILE_SPRITE_VARIANT_OVERRIDES = { "윤 & 호": "_yoon" };

    // setPortraitImage는 shared/battle-renderer.js로 이전됨 - 아래 로스터 프로필 렌더링 등이 여전히
    // 이 전역 함수를 그대로 호출한다.

    function buildUnit(rawUnit) {
        return {
            name: rawUnit.name,
            maxHp: rawUnit.max_hp,
            hp: rawUnit.max_hp,
            // 보호막(김크장류 서포터가 부여) - 전투 시작 시 이미 차 있을 수 있지만, 그 초기값은 이벤트가
            // 아니라 전투 시작 특성 판정 결과라 프론트로 안 넘어온다. 0에서 시작해도, 그 유닛이 실제로
            // 뭔가에 맞는 첫 이벤트(target_shield_after)에서 곧바로 정확한 값으로 갱신된다 - 그 전까지는
            // 보호막 바가 잠깐 안 보일 뿐 체력 계산 자체에는 영향이 없다.
            shield: 0,
            isMelee: rawUnit.is_melee,
            // 백엔드 시뮬레이션이 실제로 쓰는 슬롯별 이동 속도(전방/후방)를 전방 기준 비율로 받아온다
            // (battle_core.py의 melee_speed_ratio) - 걷기 루프(startMeleeWalker)가 그대로 곱해 써서
            // 화면 걷는 속도가 시뮬레이션이 실제로 판정하는 속도 차이와 일치하게 한다.
            meleeSpeedRatio: rawUnit.melee_speed_ratio || 1,
            outfit: rawUnit.outfit,
            star: rawUnit.star,
            style: RANGED_ATTACK_STYLE[rawUnit.name] || (rawUnit.is_melee ? "melee" : "straight"),
            isType2: false, // 이의진 전용: 염색체 변환(self_type_swap_heal) 스킬로 전투 중 true/false 토글됨
        };
    }

    // spriteVariantSuffix는 shared/battle-renderer.js로 이전됨 - 아래 여러 애니메이션 함수가 여전히
    // 이 전역 함수를 그대로 호출한다.

    // initialMeleeTargetKey는 shared/battle-renderer.js로 이전됨 - 아래 startMeleeWalker(그것도
    // 이전됨) 등이 여전히 이 전역 함수를 그대로 호출한다.

    // 스트라이커(전방/후방) 한 명만 등록한 편성이면 그 쪽 team.front/back이 null로 내려온다 - 그
    // 슬롯은 애초에 units에 키 자체를 안 만든다(존재하지 않는 유닛). 코스트카드/로스터 정렬/
    // Object.keys(units) 기반 순회 로직은 이미 복제 소환수처럼 "언제든 늘어날 수 있는 키 집합"을
    // 전제로 짜여 있어서, 반대로 "처음부터 한 키가 아예 없는" 경우도 그대로 안전하게 건너뛴다.
    const units = {};
    if (data.attacker_team.front) units["attacker-front"] = buildUnit(data.attacker_team.front);
    if (data.attacker_team.back) units["attacker-back"] = buildUnit(data.attacker_team.back);
    if (data.defender_team.front) units["defender-front"] = buildUnit(data.defender_team.front);
    if (data.defender_team.back) units["defender-back"] = buildUnit(data.defender_team.back);
    // 서포터(김크장류)는 전장에 스프라이트/로스터 행이 없다(ENABLE_SUPPORTER_SLOT이 True일 때만 이
    // 필드가 실제로 옴) - 그래도 units 딕셔너리에는 넣어둬야 [Active]/[Special] 이벤트의 actor로
    // 이름이 잡힐 때 findUnitKey가 찾을 수 있다. 사거리 연출 등 스프라이트를 전제로 하는 함수들은
    // data-unit/data-roster 엘리먼트가 없으면(document.querySelector가 null) 이미 옵셔널 체이닝으로
    // 방어돼 있어 조용히 스킵된다.
    if (data.attacker_team.supporter) units["attacker-supporter"] = buildUnit(data.attacker_team.supporter);
    if (data.defender_team.supporter) units["defender-supporter"] = buildUnit(data.defender_team.supporter);

    // 빈 슬롯은 전장에서 보이지 않게(다른 3명의 위치엔 영향 없도록 display:none이 아니라
    // visibility:hidden - .battle-row는 flex라 display:none이면 남은 유닛들이 재배치된다) 하고,
    // 로스터 쪽엔 EMPTY로 표시한다(코스트카드의 기존 "EMPTY" 표기와 동일한 관례).
    ["attacker-front", "attacker-back", "defender-front", "defender-back"].forEach((key) => {
        if (units[key]) return;
        const battleEl = document.querySelector(`[data-unit="${key}"]`);
        if (battleEl) battleEl.style.visibility = "hidden";
        const rosterEl = document.querySelector(`[data-roster="${key}"]`);
        if (rosterEl) {
            rosterEl.classList.add("roster-unit-empty-slot");
            const nameEl = rosterEl.querySelector(".roster-unit-name");
            if (nameEl) nameEl.textContent = "EMPTY";
            const hpTrack = rosterEl.querySelector(".roster-hp-track");
            if (hpTrack) hpTrack.style.visibility = "hidden";
        }
    });

    // shared/battle-renderer.js에 units를 최대한 일찍 알려준다 - 바로 아래 프레임 이미지 프리캐시가
    // getAttackFrameCount 등(battle-renderer.js로 이전됨)을 즉시 호출하기 시작하는데, 그 함수들은
    // outfitImageBase를 이 config에서 읽는다. statusIconState/currentSimTime처럼 이 시점엔 아직 선언
    // 전인 값들은 파일 끝(initAttackEffects 직전)에서 한 번 더 불러 마저 채운다(initBattleRenderer는
    // 매번 병합이라 여기서 먼저 채운 값이 안 지워짐).
    // attackAnimActive는 파일 맨 위에서 이미 선언돼 있고, stopWalkFrames/appendLog/clearAllStatusIcons는
    // function 선언이라 이 시점에 텍스트상 아직 아래에 있어도 호이스팅으로 이미 값이 존재한다 - 그래서
    // 이 이른 호출에 함께 넘겨도 안전하다. deathHandled만은 진짜 const라 아직 선언 전이라 여기 못 넣고,
    // 바로 그 선언 직후(몇 줄 아래)에서 별도로 한 번 더 채운다(initBattleRenderer는 병합이라 안전).
    initBattleRenderer({
        units,
        outfitImageBase: OUTFIT_IMAGE_BASE,
        profileSpriteVariantOverrides: PROFILE_SPRITE_VARIANT_OVERRIDES,
        attackAnimActive,
        attackAnimTokens,
        actorAnimChain,
        appendLog,
        realMsUntilSimTime,
        // 배속 토글 버튼이 실시간으로 바꾸는 값이라(let playbackSpeed) 스냅샷이 아니라 매번 다시
        // 읽는 getter로 넘긴다 - MOVE_STEP_BASELINE_SPEED는 반대로 페이지 로드 시점에 고정되는 값.
        getPlaybackSpeed: () => playbackSpeed,
        moveStepBaselineSpeed: MOVE_STEP_BASELINE_SPEED,
        rangedResolvePending,
        meleeHitPending,
        // dispatchEvent(근접/원거리 기본공격 명중 처리)가 직접 쓰는 값들 - initAttackEffects에는 이미
        // 넘기고 있었지만 이 파일(battle-renderer.js) 자신에게는 안 넘기고 있어서, bare 식별자 참조가
        // ReferenceError로 조용히 실패해 기본공격 명중 연출(체력바/피격이펙트/데미지숫자)이 전부
        // 재생되지 않던 버그가 있었다(확인됨, 실제 브라우저 재현 - 전술대회/친선전 공통).
        playRangedAttack,
        effectLaunchDelayMs: EFFECT_LAUNCH_DELAY_MS,
    });

    // findUnitKey는 shared/battle-renderer.js로 이전됨 - 아래 playNext 등이 여전히 이 전역 함수를
    // 그대로 호출한다.

    // ===== 코스트 게이지 + 스킬카드(전방/후방/서포터) =====
    // 코스트독 렌더링 시스템(costState/COST_DOCK_SIDES/buildCostDockHtml/initCostSide/anchorCost/
    // flashCostCard/renderCostSide/tickCostDock/cardCooldownUntil)은 shared/battle-renderer.js로
    // 이전됨 - 아래 playNext의 cost_init/cost_rate_change/cost_turn_skip/cast_start 처리가 여전히
    // 이 전역 함수/객체들을 그대로 호출·참조한다(bare 식별자 -> 전역 스코프로 자동 해석).
    // 실제 쿨다운 시간(발동 직후 카드가 회색으로 막히는 시간)만은 이 값을 쓰는 곳(cast_start 처리)이
    // 여기 있어서 그대로 로컬로 남긴다 - battle-renderer.js는 cardCooldownUntil의 "결과값"만 읽는다.

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
    // 다시 불릴 수 있어서(다른 유닛의 이벤트 등), 한 번만 재생되도록 막는다. renderUnit 자체는
    // shared/battle-renderer.js로 이전됐지만, 이 객체는 computeFrontToBackOrder(로스터 정렬)와
    // 복제체 재소환 리셋 지점 등 arena-battle.js 쪽에서도 여전히 읽고 쓰므로 선언은 여기 남기고
    // initBattleRenderer의 config로 참조만 넘긴다.
    const deathHandled = {};
    initBattleRenderer({ deathHandled });

    // isFacingFlipped/setFacing/faceToward/playDeathSequence/renderUnit은 shared/battle-renderer.js로
    // 이전됨(facingFlipped도 그쪽 소유) - 아래 근접 워커/애니메이션 함수들이 여전히 이 전역 함수들을
    // 그대로 호출한다.

    // renderUnit(key, hpOverride)에 forEach가 그대로 콜백으로 넘어가면 forEach의 두 번째 인자(배열
    // 인덱스)가 hpOverride로 잘못 들어가버린다(0번째 유닛은 hpOverride=0 -> 체력 0%, 1번째는 1 ->
    // 거의 0%...) - 전투 시작 직후(실제 이벤트가 아직 하나도 처리되기 전) 로스터 체력바가 텅 비어
    // 보이다가 첫 star_effect_resolve/trait_resolve에서야 정상으로 돌아오는 버그의 원인이었다.
    Object.keys(units).forEach((key) => renderUnit(key));

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

    // getGapToTarget/measureHomeRect/getCurrentTranslateX/applyKnockback/markMeleeArrived/
    // startMeleeWalker/waitForMeleeArrival/근접 이동 관련 상태(meleeTargetKey 등)는 전부
    // shared/battle-renderer.js로 이전됨 - 아래 playNext 등이 여전히 이 전역 함수들을 그대로 호출한다.

    // ===== 이의진 전용: 눈에서 발사되는 레이저 =====
    // .battle-unit-img는 width/height가 고정된 박스이고 실제 그림은 object-fit:contain +
    // object-position:bottom center로 그 안에 들어간다 - 세로가 긴 인물 그림이라 항상 "박스 높이에
    // 맞춰 축소되고, 가로는 중앙 정렬"되는 쪽으로 렌더링된다(그래서 그림의 실제 가로 폭은 박스보다
    // 좁고, 상하는 박스와 정확히 일치). 그래서 "눈 위치"처럼 그림 안의 특정 지점을 조준하려면
    // 박스 중심이 아니라 실제로 그려지는 그림의 사각형을 다시 계산해야 한다.
    //
    // fx/fy는 그 그림(현재 표시된 attack 프레임 원본 픽셀 기준) 안에서 눈이 있는 비율(0~1, 왼쪽위 기준).
    // ▶ 레이저가 엉뚱한 위치에서 나가면 여기 두 값만 고치면 된다 - fx를 늘리면 오른쪽으로,
    //   fy를 늘리면 아래쪽으로 발사 지점이 이동한다. type1은 attack_1.webp, type2는 attack_type2_1.webp
    //   기준으로 눈금을 맞췄다(공격 프레임 3번째 즈음에 발사되므로 attack_3 기준으로 다시 맞춰도 된다).

    function playRangedAttack(actorKey, targetKey, onArrive, onLetterArrive) {
        const style = units[actorKey]?.style || "straight";
        playRangedAttackByStyle(style, actorKey, targetKey, onArrive, { isType2: units[actorKey]?.isType2, onLetterArrive });
    }


    // 화면에 "연출"을 그리지 않는 조용한 상태 갱신 이벤트들 - 최소 대기(16ms)를 적용하지 않는다
    // (target_lock_resolve/cost_* 주석은 아래 minDelayMs 계산부 참고).
    const SILENT_EVENT_TYPES = new Set(["target_lock_resolve", "cost_init", "cost_rate_change", "cost_turn_skip"]);

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
                electricBoltActive[key] ||
                // 신의 부활 이펙트도 같은 이유(지면 섬광~파티클이 끝나기 전에 "전투 종료!"가 뜨면 안 됨).
                reviveEffectActive[key];
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
    // shouldForceProceedPast/clearAnimWait/forceClearAnim/chainActorAnim/waitForAnimIdle/
    // playAttackFrames/playCastFrames/interruptCasting/playReturnFrames와 그 상태
    // (animWaitStartedAt/ANIM_WAIT_TIMEOUT_MS)는 전부 shared/battle-renderer.js로 이전됨 -
    // 아래 playNext 등이 여전히 이 전역 함수들을 그대로 호출한다.


    // 치명타 시 대상 머리 위에 "치명타!" 글자가 튀어오르듯 잠깐 떴다 사라진다.
    // 상성(유형 상성) 적중 시 대상 머리 위에 "Weak"(유리, 주황 글씨·진한 빨강 테두리)/"Resist"(불리,
    // 하늘색 글씨·진한 파랑 테두리) 글자를 띄운다. damage(선택)가 있으면 그 글자 바로 밑에 <br>로 피해
    // 숫자를 이어붙인다(별도 엘리먼트로 독립 배치하지 않음 - 같은 팝업 안의 두 번째 줄이라 위치 계산
    // 없이 항상 정확히 그 밑에 나온다). isCrit이면 그 숫자 뒤에 가시 돋친 붉은 타원을 추가로 얹는다
    // (더 이상 "치명타!" 글자 자체는 안 뜬다 - CSS .label-damage-crit-burst 참고). 같은 대상이 짧은
    // 시간에 여러 번 맞으면 팝업들이 전부 같은 자리에서 시작해 겹쳐 안 읽히므로, jitterPoint로 작은
    // 원 안에서 무작위로 살짝 흩어지게 한다.
    function showTypeLabel(key, kind, damage, isCrit) {
        const layer = document.getElementById("projectile-layer");
        const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
        if (!layer || !imgEl) return;
        const pos = fieldRelativeCenter(imgEl);
        const jittered = jitterPoint({ x: pos.x, y: pos.y - 62 }, 16);
        const label = document.createElement("div");
        label.className = `type-label type-${kind}`;
        const text = kind === "weak" ? "Weak" : "Resist";
        label.innerHTML = damage != null
            ? `<span class="label-text">${text}</span><br><span class="label-damage label-damage-${kind}${isCrit ? " label-damage-crit-burst" : ""}">${Math.round(damage).toLocaleString()}</span>`
            : text;
        label.style.left = `${jittered.x}px`;
        label.style.top = `${jittered.y}px`;
        layer.appendChild(label);
        setTimeout(() => label.remove(), 520);
    }

    // 피해 숫자(weak/resist 글자가 전혀 없는 평범한 타격 전용) - 흰 글씨로 대상 머리 위 기본 위치에
    // 홀로 떴다 사라진다. isCrit이면 뒤에 가시 돋친 붉은 타원을 얹는다(showTypeLabel과 동일). 같은
    // 이유로(짧은 시간에 여러 번 맞으면 겹침) jitterPoint로 작은 원 안에서 무작위로 살짝 흩어지게 한다.
    function showDamageLabel(key, damage, isCrit) {
        const layer = document.getElementById("projectile-layer");
        const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
        if (!layer || !imgEl) return;
        const pos = fieldRelativeCenter(imgEl);
        const jittered = jitterPoint({ x: pos.x, y: pos.y - 30 }, 16);
        const label = document.createElement("div");
        label.className = `damage-label${isCrit ? " label-damage-crit-burst" : ""}`;
        label.textContent = Math.round(damage).toLocaleString();
        label.style.left = `${jittered.x}px`;
        label.style.top = `${jittered.y}px`;
        layer.appendChild(label);
        setTimeout(() => label.remove(), 520);
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
    // STATUS_ICON_FILES/statusIconState/renderStatusIconTotal/setStatusIcon/applyStatChangeIcons/
    // armSimTimer/rearmAllSimTimers/clearStatusIconSource/clearAllStatusIcons는 전부
    // shared/battle-renderer.js로 이전됨 - 아래 realMsUntilSimTime/currentSimTime(재생 페이싱 상태에
    // 묶여 있어 여기 남음)과 playNext 등은 여전히 그 전역 함수들을 그대로 호출한다.

    // 이벤트 재생 원점(playbackOriginWallMs/-EventTime)이 갱신될 때마다(playNext) 호출 - 지금까지의
    // 실제 재생 지연(애니메이션 대기 등)을 반영한 최신 환산으로 모든 시뮬레이션 시각 기반 아이콘
    // 타이머를 다시 잡는다. 앞서 확인한 버그(김남옥 공격속도 버프 아이콘이 실제 상태보다 먼저 사라짐)의
    // 원인이 "생성 시점 실시간으로 못박은 타이머가 이후 재생 지연을 반영하지 못함"이었으므로, 매번
    // 다시 계산해서 실제 상태 종료 시각과 항상 일치시킨다.
    function realMsUntilSimTime(simTime) {
        const targetWallMs = playbackOriginWallMs + (simTime - playbackOriginEventTime) * 1000 * playbackSpeed;
        return Math.max(0, targetWallMs - performance.now());
    }

    // realMsUntilSimTime의 역함수 - "지금 재생 커서 기준 전투 내 시각"(초)을 구한다. 상단 전투 타이머
    // (battleTimerStartWallMs 계열)와는 다른 시계다 - 그쪽은 재생 지연과 무관하게 항상 일정하게 흐르는
    // "실제 경과 시간" 표시용이고, 이건 이벤트 재생 원점(playbackOriginWallMs/-EventTime, playNext이
    // 매 이벤트 처리 시각으로 재설정)과 정확히 동기화돼야 한다 - 코스트 게이지가 cast_start보다 먼저
    // 가득 차 보이면(재생이 밀렸는데 게이지만 실시간으로 계속 찼다면) 안 되기 때문에 반드시 이쪽을 쓴다.
    function currentSimTime() {
        return playbackOriginEventTime + (performance.now() - playbackOriginWallMs) / (1000 * playbackSpeed);
    }

    // armSimTimer/rearmAllSimTimers/clearStatusIconSource/clearAllStatusIcons도 shared/battle-renderer.js로
    // 이전됨(realMsUntilSimTime 콜백을 config로 받아서 씀) - rearmAllSimTimers는 아래 playNext가 여전히
    // 이 전역 함수를 그대로 호출한다.


    let rosterOrderTimer = null;

    function startRosterOrderWatcher() {
        rosterOrderTimer = setInterval(() => {
            reorderRoster("attacker");
            reorderRoster("defender");
        }, 450);
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

        dispatchEvent(event);

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
        rearmAllSimTimers();

        const nextEvent = data.events[eventIndex];
        let delayMs;
        if (nextEvent) {
            const targetWallMs = playbackOriginWallMs + (nextEvent.time - playbackOriginEventTime) * 1000 * playbackSpeed;
            // target_lock_resolve는 화면에 아무 것도 그리지 않는 조용한 상태 갱신용 이벤트라 최소 16ms
            // 대기(다른 이벤트들이 눈에 보이는 연출 한 프레임만큼은 걸리도록 두는 바닥값)를 적용할
            // 이유가 없다 - 넉백처럼 한 틱에 여러 유닛의 타겟이 한꺼번에 재계산되면 target_lock_resolve가
            // 무더기로 쌓이는데, 매번 16ms씩 걸리면 그게 다 더해져서 그 뒤에 나오는 실제 공격/스킬
            // 이벤트들까지 통째로 밀리고, 청년이 편성돼 넉백을 자주 쓸수록 전장의 모든 캐릭터가
            // 다같이 느려지는 것처럼 보였다. 코스트 관련 조용한 상태 갱신 이벤트(cost_init/
            // cost_rate_change/cost_turn_skip)도 같은 이유로 예외 - cast_start는 실제 캐스팅 연출을
            // 태우므로 이 예외에 넣지 않는다.
            const minDelayMs = SILENT_EVENT_TYPES.has(eventType) ? 0 : 16;
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
        costDockRunning = false;
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

    // shared/battle-renderer.js에 마지막으로 남은 값(currentSimTime - 페이싱 상태에 묶여있어 이 시점에야
    // 선언됨)을 채운다. units/outfitImageBase 등은 이미 이른 initBattleRenderer 호출에서 채워졌다.
    // costDockSides는 안 넘기면 모듈 기본값(["attacker"] - 전술대회는 참고 이미지와 동일하게 내 편만
    // 그린다)을 그대로 쓴다. 친선전(arena-live.js)은 양쪽 다 넘겨서 두 진영 코스트독을 모두 그릴 것이다.
    initBattleRenderer({ currentSimTime });

    // shared/attack-effects.js(개발자화면과 공유하는 이펙트 렌더링 모듈)에게 이 화면의 DOM 컨벤션을 알려준다.
    initAttackEffects({
        resolveUnitEl: (key) => document.querySelector(`[data-unit="${key}"] .battle-unit-img`),
        fieldEl: document.querySelector(".battle-field"),
        layerEl: document.getElementById("projectile-layer"),
        showTypeLabel,
        showDamageLabel,
        effectLaunchDelayMs: EFFECT_LAUNCH_DELAY_MS,
        // 걷기(speedScale)와 동일한 기준(MOVE_STEP_BASELINE_SPEED = 초기 playbackSpeed) - 배속을
        // 바꿔도 매번 최신 playbackSpeed를 읽도록 getter로 넘긴다(정적 값이면 배속 토글 후 새로 계산 안 됨).
        getSpeedMultiplier: () => playbackSpeed / MOVE_STEP_BASELINE_SPEED,
    });

    startPreparation();
})();