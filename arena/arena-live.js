// arena-live.js - (1v1) 실시간 친선전. arena/arena-battle.js(전술대회, 사전계산된 이벤트 배열을
// setTimeout으로 재생)와 달리, Supabase Realtime 채널(match:{room_code})로 이벤트가 실시간으로
// 도착하는 대로 shared/battle-renderer.js의 dispatchEvent(event)를 그때그때 불러준다. 전투 스테이지
// 자체(유닛 스프라이트/로스터/코스트덕/이펙트)는 arena-battle.js와 완전히 동일한 DOM 컨벤션과
// shared/battle-renderer.js·shared/attack-effects.js를 그대로 재사용한다.
//
// 서버(backend/routers/pvp_live.py)의 이벤트/코스트게이트 로직은 호스트=attacker/게스트=defender로
// 고정돼 있다. 하지만 "게스트도 자기 팀이 항상 화면 아래쪽(attacker 자리)에 보이게" 하기로
// 확정했으므로(확인된 요청), 게스트일 때만 도착하는 모든 데이터(로스터/이벤트/브로드캐스트로 보내는
// 발동 요청)의 attacker<->defender 라벨을 remapSide로 뒤집는다 - 그 결과 battle-renderer.js 등
// 공유 모듈은 "누가 진짜 호스트인지" 전혀 알 필요가 없다(항상 attacker=나, defender=상대로만 본다).

(function () {
    "use strict";

    const raw = sessionStorage.getItem("pvp_live_room");
    const roomInfo = raw ? JSON.parse(raw) : null;
    const battleScreen = document.querySelector(".battle-screen");

    if (!roomInfo || !roomInfo.room_code || !roomInfo.role) {
        const loadingOverlay = document.getElementById("battle-loading-overlay");
        if (loadingOverlay) loadingOverlay.hidden = true;
        if (battleScreen) {
            battleScreen.innerHTML =
                `<p class="screen-placeholder" style="padding:40px;text-align:center;">
                    입장 정보를 찾을 수 없어요. 투기장에서 '1:1 친선전'으로 방을 만들거나 입장해야 이 창이 정상적으로 열려요.
                </p>`;
        }
        return;
    }

    const ROOM_CODE = roomInfo.room_code;
    const IS_HOST = roomInfo.role === "host";
    const IS_GUEST = !IS_HOST;

    // API_BASE_URL/SUPABASE_URL/SUPABASE_ANON_KEY는 shared/api-config.js가 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;
    const WS_BASE_URL = API_BASE_URL.replace(/^http/, "ws");

    function authToken() {
        return localStorage.getItem("access_token") || "";
    }

    // ── 상대 원근(perspective) 리매핑 - 게스트일 때만 attacker<->defender를 뒤집는다 ──────────
    function remapSideToken(value) {
        if (!IS_GUEST || typeof value !== "string") return value;
        if (value === "attacker") return "defender";
        if (value === "defender") return "attacker";
        if (value.startsWith("attacker-")) return `defender-${value.slice("attacker-".length)}`;
        if (value.startsWith("defender-")) return `attacker-${value.slice("defender-".length)}`;
        return value;
    }

    // 이벤트/로스터 객체를 얕게가 아니라 몇 단계 중첩(카드 배열, 히트 배열 등)까지 훑어서 attacker/
    // defender 문자열 필드를 전부 뒤집는다 - 게스트가 아니면 원본을 그대로 돌려준다(불필요한 복사 없음).
    function remapDeep(value, depth) {
        if (!IS_GUEST) return value;
        if (typeof value === "string") return remapSideToken(value);
        if (Array.isArray(value)) return value.map((v) => remapDeep(v, depth + 1));
        if (value && typeof value === "object" && depth < 4) {
            const out = {};
            Object.keys(value).forEach((k) => { out[k] = remapDeep(value[k], depth + 1); });
            return out;
        }
        return value;
    }

    // ── arena-battle.js와 동일한 로컬 상태(shared 모듈이 IIFE로 감싸지 않은 전역 함수라, 이쪽에서
    // config로 넘기는 값만 서로 볼 수 있다 - shared/battle-renderer.js:2-19 주석 참고) ──────────
    const attackAnimActive = {};
    const attackAnimTokens = {};
    const actorAnimChain = {};
    const rangedResolvePending = {};
    const meleeHitPending = {};
    const deathHandled = {};
    const PROFILE_SPRITE_VARIANT_OVERRIDES = { "윤 & 호": "_yoon" };
    const EFFECT_LAUNCH_DELAY_MS = 60 * 3;
    const PROJECTILE_TRAVEL_MS = 220;
    const MAX_BATTLE_DURATION_SECONDS = 180; // backend/battle_core.py의 MAX_BATTLE_DURATION과 동일하게 유지할 것
    const SILENT_EVENT_TYPES = new Set(["target_lock_resolve", "cost_init", "cost_rate_change", "cost_turn_skip"]);
    const MAX_LOG_LINES = 24;

    const logPanelEl = document.getElementById("battle-log-panel");
    const battleTimerEl = document.getElementById("live-vs-label"); // 매치 시작 전엔 상대를 찾는 문구, 시작 후엔 타이머로 재사용

    function appendLog(text, side) {
        if (!logPanelEl) return null;
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
        while (logPanelEl.children.length > MAX_LOG_LINES) {
            logPanelEl.removeChild(logPanelEl.firstElementChild);
        }
        logPanelEl.scrollTop = logPanelEl.scrollHeight;
        return entry;
    }

    function updateBattleTimer(seconds) {
        if (!battleTimerEl || typeof seconds !== "number") return;
        const total = Math.max(0, Math.floor(MAX_BATTLE_DURATION_SECONDS - seconds));
        const mm = String(Math.floor(total / 60)).padStart(2, "0");
        const ss = String(total % 60).padStart(2, "0");
        battleTimerEl.textContent = `${mm}:${ss}`;
    }

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

    function playRangedAttack(actorKey, targetKey, onArrive, onLetterArrive) {
        const style = units[actorKey]?.style || "straight";
        playRangedAttackByStyle(style, actorKey, targetKey, onArrive, { isType2: units[actorKey]?.isType2, onLetterArrive });
    }

    function buildUnit(rawUnit) {
        return {
            name: rawUnit.name,
            maxHp: rawUnit.max_hp,
            hp: rawUnit.max_hp,
            shield: 0,
            isMelee: rawUnit.is_melee,
            meleeSpeedRatio: rawUnit.melee_speed_ratio || 1,
            outfit: rawUnit.outfit,
            star: rawUnit.star,
            style: RANGED_ATTACK_STYLE[rawUnit.name] || (rawUnit.is_melee ? "melee" : "straight"),
            isType2: false,
        };
    }

    // 상대를 찾기 전(대기 화면)에는 상대가 누군지 전혀 모르므로, 그 자리를 "청년"(가장 기본 캐릭터)
    // 그림으로 채워둔다(확인된 요청) - 실제 전투에 참여하지 않는 순수 자리채움이라 전투 스탯은
    // 아무 의미가 없다(max_hp=1 등 더미값).
    const OPPONENT_PLACEHOLDER_UNIT = { name: "청년", max_hp: 1, is_melee: true, melee_speed_ratio: 1, outfit: "beginner/basic", star: 1 };

    // arena-battle.js의 renderPlayerPanel과 동일 - 아바타/이름/레벨/칭호 표시. info가 비어있거나
    // 아직 모르는 값(상대를 찾기 전)이면 화면 기본 텍스트("-"/"칭호 없음")가 그대로 유지된다.
    function renderPlayerProfile(side, info) {
        const avatarEl = document.getElementById(`${side}-avatar`);
        const nameEl = document.getElementById(`${side}-name`);
        const levelEl = document.getElementById(`${side}-level`);
        const titleEl = document.getElementById(`${side}-title`);
        if (info.lobby_outfit) setPortraitImage(avatarEl, info.lobby_outfit);
        if (nameEl) nameEl.textContent = info.nickname || (side === "attacker" ? "나" : "상대");
        if (levelEl) levelEl.textContent = info.level != null ? info.level : "-";
        if (titleEl) {
            titleEl.textContent = info.title || "칭호 없음";
            titleEl.classList.toggle("title-hidden-shine", !!info.title_is_hidden);
        }
    }

    function renderRosterUnits(keys) {
        keys.forEach((key) => {
            const rosterEl = document.querySelector(`[data-roster="${key}"]`);
            if (!rosterEl || !units[key]) return;
            const nameEl = rosterEl.querySelector(".roster-unit-name");
            const portraitEl = rosterEl.querySelector(".roster-unit-img");
            if (nameEl) nameEl.textContent = battleDisplayText(units[key].name);
            setPortraitImage(portraitEl, units[key].outfit, PROFILE_SPRITE_VARIANT_OVERRIDES[units[key].name] || "");
            renderUnit(key);
        });
    }

    // ── 실시간 재생 시계(arena-battle.js의 playbackOriginWallMs/-EventTime과 같은 목적이지만, 이쪽은
    // 사전에 다음 이벤트 시각을 알 수 없으므로 "마지막으로 처리한 이벤트 시각 + 그 뒤로 흐른 실제
    // 시간"만으로 계산한다 - 서버가 이미 실제 시간(asyncio.sleep(TICK))으로 페이싱해서 보내주므로
    // 배속 개념 자체가 없다(재생 속도를 임의로 바꾸면 서버 진행과 어긋난다). ──────────────────
    let latestSimTime = 0;
    let latestSimWallMs = performance.now();

    function currentSimTime() {
        return latestSimTime + (performance.now() - latestSimWallMs) / 1000;
    }

    function realMsUntilSimTime(simTime) {
        return Math.max(0, (simTime - currentSimTime()) * 1000);
    }

    function markSimTime(eventTime) {
        latestSimTime = eventTime;
        latestSimWallMs = performance.now();
    }

    let units = {};
    // renderPreMatchPreview가 대기 화면 단계(아래 IS_HOST 조기 호출)에서부터 참조하므로, 그 호출보다
    // 먼저 선언돼 있어야 한다 - 원래 "매치 시작 시점" 섹션에 있던 선언을 여기로 옮겼다(안 그러면 아직
    // 실행되지 않은 let 선언을 앞에서 참조하게 돼 TDZ ReferenceError가 남, 확인된 버그).
    let matchStarted = false;

    function anyActorStillFinishing() {
        return Object.keys(units).some((key) => {
            if (!units[key]) return false;
            return attackAnimActive[key] ||
                (units[key].isMelee && meleeArrived[key] === false) ||
                rangedResolvePending[key] ||
                meleeHitPending[key] ||
                goldenSelfDestructActive[key] ||
                electricBoltActive[key] ||
                reviveEffectActive[key];
        });
    }

    function forceIdleAllUnits() {
        Object.keys(units).forEach((key) => {
            if (attackAnimActive[key]) forceClearAnim(key);
        });
    }

    // ── 대기/연결 오버레이 ──────────────────────────────────────────
    const waitingOverlay = document.getElementById("live-waiting-overlay");
    const waitingTitleEl = document.getElementById("live-status-title");
    const waitingDescEl = document.getElementById("live-status-desc");
    const waitingCodeBox = document.getElementById("live-room-code-box");
    const waitingCodeValue = document.getElementById("live-room-code-value");
    const waitingCloseBtn = document.getElementById("live-status-close-btn");

    function showWaitingStatus(title, desc, { showCode = false, showClose = false } = {}) {
        if (waitingTitleEl) waitingTitleEl.textContent = title;
        if (waitingDescEl) waitingDescEl.textContent = desc || "";
        if (waitingCodeBox) waitingCodeBox.hidden = !showCode;
        if (showCode && waitingCodeValue) waitingCodeValue.textContent = ROOM_CODE;
        if (waitingCloseBtn) waitingCloseBtn.hidden = !showClose;
        if (waitingOverlay) waitingOverlay.hidden = false;
    }

    function hideWaitingStatus() {
        if (waitingOverlay) waitingOverlay.hidden = true;
    }

    waitingCloseBtn?.addEventListener("click", () => { window.location.href = "home.html"; });

    document.getElementById("battle-close-btn")?.addEventListener("click", () => {
        window.location.href = "home.html";
    });

    const battleLoadingOverlay = document.getElementById("battle-loading-overlay");
    if (battleLoadingOverlay) battleLoadingOverlay.hidden = true;

    setupManualControls();

    showWaitingStatus(
        IS_HOST ? "상대를 기다리는 중입니다..." : "방에 입장하는 중입니다...",
        IS_HOST ? "이 코드를 친구에게 알려주세요." : "",
        { showCode: IS_HOST },
    );

    // 호스트는 방을 만드는 시점(arena.js:hostLiveRoom)에 이미 my_roster/my_profile을 받아 sessionStorage에
    // 실어뒀으므로, 대기 화면이 뜨는 즉시(match_found를 기다리지 않고) 바로 미리보기를 그릴 수 있다.
    // 게스트는 join 응답이 와야 알 수 있으므로 startAsGuest 안에서 별도로 부른다.
    if (IS_HOST && roomInfo.my_roster) {
        renderPreMatchPreview(roomInfo.my_roster, roomInfo.my_profile);
    }

    // ── 매치 시작 시점: match_found로 받은 로스터로 전투 스테이지를 세팅 ──────────────────
    function applyEmptySlotStyling(key) {
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
    }

    // 매치 시작 전(대기 화면) 단계에서도 내 로스터는 실제로, 상대 로스터는 "청년" 자리채움으로
    // 미리 보여준다(확인된 요청) - create_room/join_room 응답에 my_roster/my_profile을 함께
    // 실어주므로 match_found를 기다릴 필요가 없다. matchStarted가 되면(진짜 상대 데이터로 다시
    // 그려짐) 아무 효과가 없도록 가드한다.
    function renderPreMatchPreview(myRoster, myProfile) {
        if (matchStarted || !myRoster) return;
        units = {};
        if (myRoster.front) units["attacker-front"] = buildUnit(myRoster.front);
        if (myRoster.back) units["attacker-back"] = buildUnit(myRoster.back);
        if (myRoster.supporter) units["attacker-supporter"] = buildUnit(myRoster.supporter);
        units["defender-front"] = buildUnit(OPPONENT_PLACEHOLDER_UNIT);
        units["defender-back"] = buildUnit(OPPONENT_PLACEHOLDER_UNIT);

        initBattleRenderer({
            units, outfitImageBase: OUTFIT_IMAGE_BASE, profileSpriteVariantOverrides: PROFILE_SPRITE_VARIANT_OVERRIDES,
            attackAnimActive, attackAnimTokens, actorAnimChain, appendLog, realMsUntilSimTime,
            getPlaybackSpeed: () => 1, moveStepBaselineSpeed: 1, rangedResolvePending, meleeHitPending,
            playRangedAttack, effectLaunchDelayMs: EFFECT_LAUNCH_DELAY_MS, deathHandled, currentSimTime,
        });

        if (!units["attacker-back"]) applyEmptySlotStyling("attacker-back");
        renderRosterUnits(Object.keys(units));
        renderPlayerProfile("attacker", myProfile || {});
        renderPlayerProfile("defender", {});
    }

    async function startMatch(payload) {
        if (matchStarted) return;
        matchStarted = true;
        hideWaitingStatus();
        if (joinTimeoutTimer) { clearTimeout(joinTimeoutTimer); joinTimeoutTimer = null; }

        // host_team/guest_team은 서버 라벨 그대로(호스트=attacker/게스트=defender) 온다 - 내가
        // 게스트면 내 팀(guest_team)을 attacker-* 자리에, 상대 팀(host_team)을 defender-* 자리에
        // 배정한다(확정된 미러링 규칙). 호스트는 반대로 그대로 배정. 프로필(아바타/레벨/칭호)도 동일.
        const myTeamView = IS_HOST ? payload.host_team : payload.guest_team;
        const oppTeamView = IS_HOST ? payload.guest_team : payload.host_team;
        const myProfile = IS_HOST ? payload.host_profile : payload.guest_profile;
        const oppProfile = IS_HOST ? payload.guest_profile : payload.host_profile;

        units = {};
        if (myTeamView.front) units["attacker-front"] = buildUnit(myTeamView.front);
        if (myTeamView.back) units["attacker-back"] = buildUnit(myTeamView.back);
        if (oppTeamView.front) units["defender-front"] = buildUnit(oppTeamView.front);
        if (oppTeamView.back) units["defender-back"] = buildUnit(oppTeamView.back);
        if (myTeamView.supporter) units["attacker-supporter"] = buildUnit(myTeamView.supporter);
        if (oppTeamView.supporter) units["defender-supporter"] = buildUnit(oppTeamView.supporter);

        ["attacker-front", "attacker-back", "defender-front", "defender-back"].forEach((key) => {
            if (!units[key]) applyEmptySlotStyling(key);
        });

        renderPlayerProfile("attacker", myProfile || {});
        renderPlayerProfile("defender", oppProfile || {});

        initBattleRenderer({
            units,
            outfitImageBase: OUTFIT_IMAGE_BASE,
            profileSpriteVariantOverrides: PROFILE_SPRITE_VARIANT_OVERRIDES,
            // 전술대회(arena-battle.js)와 동일하게 내 코스트덕만 그린다(확인된 요청) - 상대 카드/게이지는
            // 안 보여준다. 기본값이 이미 ["attacker"]라 굳이 안 넘겨도 되지만, 의도를 명시적으로 남겨둔다.
            costDockSides: ["attacker"],
            attackAnimActive,
            attackAnimTokens,
            actorAnimChain,
            appendLog,
            realMsUntilSimTime,
            getPlaybackSpeed: () => 1,
            moveStepBaselineSpeed: 1,
            rangedResolvePending,
            meleeHitPending,
            // dispatchEvent(근접/원거리 기본공격 명중 처리)가 직접 쓰는 값들 - 안 넘기면 bare 식별자
            // 참조가 ReferenceError로 조용히 실패해 기본공격 명중 연출이 전부 재생되지 않는다(확인된
            // 버그 - shared/battle-renderer.js 쪽에서 함께 고침, arena-battle.js도 동일하게 수정됨).
            playRangedAttack,
            effectLaunchDelayMs: EFFECT_LAUNCH_DELAY_MS,
        });
        initBattleRenderer({ deathHandled, currentSimTime });

        renderRosterUnits(Object.keys(units));

        initAttackEffects({
            resolveUnitEl: (key) => document.querySelector(`[data-unit="${key}"] .battle-unit-img`),
            fieldEl: document.querySelector(".battle-field"),
            layerEl: document.getElementById("projectile-layer"),
            showTypeLabel,
            showDamageLabel,
            effectLaunchDelayMs: EFFECT_LAUNCH_DELAY_MS,
            getSpeedMultiplier: () => 1,
        });

        // 프레임 프리캐시(전술대회와 동일한 이유 - 처음 스킬/복귀 애니메이션이 프레임 탐색 때문에
        // 끊기지 않도록 미리 확인해둔다) - 실시간이라 굳이 인위적인 "준비 시간"을 넣지 않고, 프리캐시가
        // 끝나는 대로 곧장 로그를 띄운다(그 사이 도착한 이벤트는 큐에 쌓여 있다가 이어서 재생됨).
        const framePrecachePromises = [];
        Object.values(units).forEach((unit) => {
            framePrecachePromises.push(getAttackFrameCount(unit.outfit));
            framePrecachePromises.push(getSkillFrameCount(unit.outfit));
            framePrecachePromises.push(getReturnFrameCount(unit.outfit));
            if (unit.isMelee) framePrecachePromises.push(getWalkFrameCount(unit.outfit));
        });
        await Promise.all(framePrecachePromises);

        startMeleeWalker();
        rosterOrderTimer = setInterval(() => {
            reorderRoster("attacker");
            reorderRoster("defender");
        }, 450);
        latestSimWallMs = performance.now();
        appendLog("전투 시작!", null);
        requestAnimationFrame(tickBattleTimer);

        liveDispatchLoop();
    }

    let rosterOrderTimer = null;
    let battleTimerRunning = true;

    function tickBattleTimer() {
        if (!battleTimerRunning) return;
        updateBattleTimer(currentSimTime());
        requestAnimationFrame(tickBattleTimer);
    }

    // ── 이벤트 큐: battle_event 브로드캐스트가 도착하는 대로 push, dispatch 루프가 순서대로 소비 ──
    const eventQueue = [];
    let queueWaiters = [];
    let matchEnded = false;
    let matchEndPayload = null;

    function pushEvents(events) {
        events.forEach((raw) => eventQueue.push(remapDeep(raw, 0)));
        if (queueWaiters.length) {
            const waiters = queueWaiters;
            queueWaiters = [];
            waiters.forEach((resolve) => resolve());
        }
    }

    function waitForQueue() {
        if (eventQueue.length || matchEnded) return Promise.resolve();
        return new Promise((resolve) => queueWaiters.push(resolve));
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function liveDispatchLoop() {
        while (true) {
            if (eventQueue.length === 0) {
                if (matchEnded) break;
                await waitForQueue();
                continue;
            }
            const event = eventQueue.shift();
            const eventType = event.event_type || "basic_attack";
            dispatchEvent(event);
            markSimTime(event.time);
            rearmAllSimTimers();
            if (!SILENT_EVENT_TYPES.has(eventType)) {
                await sleep(16);
            }
        }

        while (anyActorStillFinishing() && !shouldForceProceedPast("lastEvent")) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        clearAnimWait("lastEvent");
        showResult();
    }

    function showResult() {
        battleTimerRunning = false;
        forceIdleAllUnits();
        if (rosterOrderTimer) { clearInterval(rosterOrderTimer); rosterOrderTimer = null; }

        const reason = matchEndPayload?.reason || "finished";
        const resultEl = document.getElementById("battle-result");
        const textEl = document.getElementById("battle-result-text");
        if (!resultEl || !textEl) return;

        if (reason !== "finished") {
            const REASON_TEXT = {
                host_disconnected: IS_HOST ? "연결이 끊어졌습니다." : "상대의 연결이 끊어졌습니다.",
                guest_disconnected: IS_GUEST ? "연결이 끊어졌습니다." : "상대의 연결이 끊어졌습니다.",
                server_error: "서버 오류로 매치가 중단되었습니다.",
            };
            textEl.textContent = REASON_TEXT[reason] || "매치가 종료되었습니다.";
            textEl.className = "battle-result-text battle-draw";
            appendLog(textEl.textContent, "draw");
            resultEl.hidden = false;
            return;
        }

        // 서버의 attacker_won은 항상 "호스트가 이겼는가"다 - 내가 게스트면 뒤집어서 "내가 이겼는가"로 해석한다.
        const hostWon = matchEndPayload?.attacker_won;
        const myWon = hostWon === null ? null : (IS_HOST ? hostWon : !hostWon);
        const outcome = myWon === true ? "win" : myWon === false ? "lose" : "draw";
        const outcomeText = outcome === "win" ? "승리!" : outcome === "lose" ? "패배..." : "무승부";
        appendLog(`전투 종료! ${outcomeText}`, outcome);

        textEl.textContent = outcomeText;
        textEl.className = `battle-result-text battle-${outcome}`;
        resultEl.hidden = false;
    }

    // ── Supabase Realtime 연결 ──────────────────────────────────────
    let realtimeClient = null;
    let channel = null;
    let hostWs = null;

    function handleMatchFoundMessage(message) {
        const payload = message.payload || {};
        startMatch(payload);
    }

    function handleBattleEventMessage(message) {
        const payload = message.payload || {};
        if (Array.isArray(payload.events)) pushEvents(payload.events);
    }

    function handleMatchEndMessage(message) {
        const payload = message.payload || {};
        matchEndPayload = payload;
        matchEnded = true;
        if (queueWaiters.length) {
            const waiters = queueWaiters;
            queueWaiters = [];
            waiters.forEach((resolve) => resolve());
        }
        // 매치가 시작도 되기 전에(상대를 못 찾음/입장 실패 등) 끝난 경우 - 대기 오버레이에서 바로 안내.
        if (!matchStarted) {
            const REASON_TEXT = {
                guest_not_found: "제한 시간 안에 상대가 들어오지 않았어요.",
                guest_invalid: "상대의 편성 정보를 확인할 수 없어요.",
            };
            showWaitingStatus(
                "매치를 시작할 수 없습니다.",
                REASON_TEXT[payload.reason] || "잠시 후 다시 시도해주세요.",
                { showClose: true },
            );
        }
    }

    async function connectRealtime() {
        realtimeClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        channel = realtimeClient.channel(`match:${ROOM_CODE}`);
        channel.on("broadcast", { event: "match_found" }, handleMatchFoundMessage);
        channel.on("broadcast", { event: "battle_event" }, handleBattleEventMessage);
        channel.on("broadcast", { event: "match_end" }, handleMatchEndMessage);

        await new Promise((resolve, reject) => {
            channel.subscribe((status) => {
                if (status === "SUBSCRIBED") resolve();
                else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
            });
        });
    }

    // ── 수동 스킬 발동 + 오토 토글 (내 쪽 코스트덕만, arena-live.css가 상대 쪽은 pointer-events로
    // 아예 막아둔다) - 클릭 자체는 "내가 보는 화면 기준 attacker"에서 일어나므로, 서버로 보낼 때는
    // remapSideToken으로 진짜 서버 라벨(호스트=attacker/게스트=defender)로 되돌린다(자기 자신의
    // 역함수라 그대로 다시 호출하면 됨). ────────────────────────────────────────────
    function sendBroadcast(eventName, payload) {
        if (!channel) return;
        channel.send({ type: "broadcast", event: eventName, payload });
    }

    let autoOn = false;

    function setupManualControls() {
        const myDock = document.getElementById("cost-dock-attacker");
        if (!myDock) return;
        myDock.addEventListener("click", (e) => {
            const card = e.target.closest(".cost-card.is-ready");
            if (card) {
                sendBroadcast("activate_skill", { side: remapSideToken("attacker") });
                return;
            }
            const badge = e.target.closest(".cost-auto-badge");
            if (badge) {
                autoOn = !autoOn;
                badge.classList.toggle("is-on", autoOn);
                sendBroadcast("set_auto", { side: remapSideToken("attacker"), auto: autoOn });
            }
        });
    }

    async function startAsHost() {
        await connectRealtime();
        // 호스트의 앵커 웹소켓 - 이게 열려있는 동안만 매치가 존재한다(끊기면 그 즉시 서버가 종료).
        hostWs = new WebSocket(`${WS_BASE_URL}/pvp_live/ws/${ROOM_CODE}?token=${encodeURIComponent(authToken())}`);
        hostWs.addEventListener("close", (event) => {
            if (!matchStarted && !matchEnded && event.code !== 1000) {
                showWaitingStatus("연결에 실패했습니다.", "다시 시도해주세요.", { showClose: true });
            }
        });
    }

    // join API는 방 코드가 실제로 존재하는지(호스트가 그 채널을 듣고 있는지) 전혀 검증하지 않는다
    // (무상태 설계 - 검증할 대상 자체가 서버에 없음, backend/routers/pvp_live.py의 join_room 참고) -
    // 코드를 잘못 입력해도 항상 200으로 응답한다. 그대로 두면 게스트 화면이 "상대의 응답을 기다리는
    // 중입니다..."에서 닫기 버튼도 없이 영원히 멈춘다(확인된 버그) - 일정 시간 안에 match_found/
    // match_end가 안 오면 타임아웃으로 안내하고 돌아갈 수 있게 한다.
    const GUEST_JOIN_TIMEOUT_MS = 30000;
    let joinTimeoutTimer = null;

    async function startAsGuest() {
        // 채널 구독을 먼저 끝낸 뒤에 join을 호출한다(경합 회피 - arena.js:submitJoinLiveRoom 주석 참고).
        await connectRealtime();
        // 호스트(host_anchor)의 on_presence_leave가 "게스트 이탈"을 감지하려면 게스트도 이 채널에
        // presence로 참여(track)해야 한다 - 호스트만 track하고 게스트는 안 해서, 게스트가 탭을 닫아도
        // 호스트 쪽 state["guest_left"]가 영원히 True가 안 되던 버그(확인됨) - 페이로드 내용 자체는
        // 서버가 안 읽으므로(존재 여부/이탈 여부만 씀) 의미 없는 값이어도 무방하다. 실패해도(네트워크
        // 순단 등) 매치 자체를 막을 정도는 아니라 조용히 넘어간다.
        try { await channel.track({ role: "guest" }); } catch (err) { /* noop */ }
        try {
            const res = await fetch(`${API_BASE_URL}/pvp_live/rooms/${ROOM_CODE}/join`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${authToken()}` },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showWaitingStatus("입장에 실패했습니다.", data.detail || "방 코드를 다시 확인해주세요.", { showClose: true });
                return;
            }
            // "상대의 응답을 기다리는 중입니다" 같은 별도 상태 문구로 안 바꾼다(확인된 요청) - 그 문구로
            // 갱신하는 시점과 match_found가 도착해 startMatch가 이미 대기 화면을 걷어내는 시점이 경합할
            // 수 있어서(특히 호스트가 이미 준비돼 있으면 거의 동시), 매치가 막 시작됐는데 그 위로 대기
            // 화면이 다시 덮이는 버그가 있었다 - 처음 뜬 "방에 입장하는 중입니다..."를 그대로 두고, 내
            // 로스터 미리보기만 그 뒤에서 준비해둔다.
            renderPreMatchPreview(data.my_roster, data.my_profile);
            joinTimeoutTimer = setTimeout(() => {
                if (!matchStarted && !matchEnded) {
                    showWaitingStatus("상대를 찾지 못했습니다.", "방 코드를 다시 확인해주세요.", { showClose: true });
                }
            }, GUEST_JOIN_TIMEOUT_MS);
        } catch (err) {
            showWaitingStatus("서버에 연결할 수 없어요.", "", { showClose: true });
        }
    }

    window.addEventListener("beforeunload", () => {
        try { hostWs?.close(1000); } catch (err) { /* noop */ }
        try { channel?.unsubscribe(); } catch (err) { /* noop */ }
    });

    (IS_HOST ? startAsHost() : startAsGuest()).catch(() => {
        showWaitingStatus("서버에 연결할 수 없어요.", "새로고침 후 다시 시도해주세요.", { showClose: true });
    });
})();
