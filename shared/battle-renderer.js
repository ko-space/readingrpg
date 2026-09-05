// shared/battle-renderer.js
// 전술대회(arena-battle.js)와 (1v1) 친선전(arena-live.js)이 공유하는 전투 화면 렌더러.
// shared/attack-effects.js와 동일한 패턴: IIFE 없이 top-level 함수 선언으로 전역에 노출하고,
// initBattleRenderer(config)로 호출부(각 페이지)의 상태(units 등)에 접근한다 - 이 파일 자신은
// units를 직접 소유하지 않고 호출부가 넘겨준 객체를 그대로 참조한다(그 페이지가 계속 mutate하는
// 살아있는 객체라, 여기서 읽을 때마다 항상 최신값을 본다). statusIconState는 반대로 이 파일이 직접
// 소유한다(관련 함수 전부가 이미 여기로 옮겨왔으므로) - 호출부가 필요하면(코스트카드 "막힘" 판정 등)
// 이 파일이 노출하는 함수를 통해서만 접근한다.
//
// 지금까지 옮겨진 것: "코스트독(스킬카드 게이지) 시스템", 프레임 이미지 존재 확인/캐시, 유닛 스프라이트
// 기본 렌더링(renderUnit/playDeathSequence/방향전환), 상태 아이콘 시스템(setStatusIcon 등),
// findUnitKey, 근접 이동/걷기 애니메이션, 공격/시전/복귀 애니메이션 프레임 재생(playAttackFrames 등)과
// 배우별 애니메이션 체인(chainActorAnim/waitForAnimIdle), 그리고 전투 이벤트 디스패치 자체
// (dispatchEvent(event) - 옛 playNext의 event_type별 거대한 분기)와 그게 의존하던 순수 헬퍼들
// (findHitKey/applySkillHits/captureAndApplyHp/ensureSummonRosterRow/로스터 정렬 등). arena-battle.js의
// playNext는 이제 "이벤트를 언제 처리할지"(eventIndex/setTimeout 페이싱)만 담당하고, 이벤트 하나가
// 오면 dispatchEvent(event)를 부르는 것으로 끝난다 - 이 페이싱 로직은 사전 계산된 data.events[] 배열이
// 있다는 전제라 실시간(친선전)과는 원천적으로 다르므로 공용화 대상이 아니다. 이 파일의 함수들이
// arena-battle.js 쪽을 되불러야 할 때는(예: appendLog) config에 콜백으로 받은 함수를 통해서만 접근한다.

// 호출부(arena-battle.js)는 units 생성 직후(프레임 이미지 프리캐시가 outfitImageBase를 바로 쓰기
// 시작하므로) initBattleRenderer를 한 번 이르게 부르고, currentSimTime처럼 그
// 시점엔 아직 선언 전인 값들은 나머지 초기화가 끝난 뒤(initAttackEffects 직전) 한 번 더 불러 채운다 -
// 그래서 매번 통째로 교체하지 않고 기존 값 위에 병합한다(먼저 채운 필드가 두 번째 호출에서 안 지워짐).
let battleRendererConfig = {
    units: null, currentSimTime: null,
    outfitImageBase: "", profileSpriteVariantOverrides: {}, costDockSides: ["attacker"],
    // deathHandled/attackAnimActive/attackAnimTokens/actorAnimChain: 아직 arena-battle.js가 소유한
    // (playNext에서도 직접 읽고 쓰는) 살아있는 객체 참조 - units와 동일한 방식(statusIconState는
    // 관련 함수 전부가 옮겨왔으므로 이 파일이 직접 소유).
    deathHandled: null, attackAnimActive: null, attackAnimTokens: null, actorAnimChain: null,
    // rangedResolvePending/meleeHitPending: 위와 동일한 이유 - anyActorStillFinishing(playNext의
    // "아직 연출이 안 끝났으면 결과 화면을 미룬다" 판정)이 arena-battle.js 쪽에서도 이 값을 직접 읽는다.
    rangedResolvePending: null, meleeHitPending: null,
    // appendLog/realMsUntilSimTime: 아직 arena-battle.js에만 있는 함수를 콜백으로 받는다(전역이 아니라
    // 그 IIFE 안에서만 접근 가능하므로 bare 식별자로는 못 부름). realMsUntilSimTime은 재생 원점
    // (playbackOriginWallMs 등, playNext의 페이싱 상태)에 의존해서 그쪽에만 남아있다.
    appendLog: null, realMsUntilSimTime: null,
    // getPlaybackSpeed: 배속 토글 버튼이 실시간으로 바꾸는 값(let playbackSpeed)이라 currentSimTime과
    // 같은 이유로 스냅샷이 아니라 매번 다시 읽는 getter 콜백으로 받는다. moveStepBaselineSpeed는 반대로
    // 페이지 로드 시점에 고정되는 상수라 그냥 값으로 받는다.
    getPlaybackSpeed: null, moveStepBaselineSpeed: 1,
    // playRangedAttack: 아직 arena-battle.js/arena-live.js 각자가 소유한 함수(캐릭터별 투사체 스타일
    // 분기, shared/attack-effects.js의 playRangedAttackByStyle을 호출) - 콜백으로 받는다.
    // effectLaunchDelayMs: 원거리 발사/근접 스윙 뒤 실제 명중 판정까지의 지연(ms) - shared/attack-effects.js의
    // initAttackEffects에는 이미 이 값이 전달되고 있었는데, 이 파일(dispatchEvent) 자신은 그동안 bare
    // EFFECT_LAUNCH_DELAY_MS를 참조하고 있었다(이 파일엔 그런 전역이 없음) - 원거리 다중타격/근접
    // 기본공격의 명중 연출(체력바 갱신/피격 이펙트/데미지 숫자)이 매번 ReferenceError로 조용히
    // 중단되던 버그의 원인(확인됨, 실제 브라우저 재현). 기본값 180은 attack-effects.js의 기본값과 동일하게 맞춤.
    playRangedAttack: null, effectLaunchDelayMs: 180,
};

function initBattleRenderer(config) {
    Object.assign(battleRendererConfig, config);
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

// ===== 공격/스킬/복귀/걷기 프레임 이미지 존재 여부 확인 + 캐시 =====
const MAX_ATTACK_FRAMES = 6;
const MAX_SKILL_FRAMES = 9;   // 스킬 시전 전용 사진은 캐릭터당 총 9장까지 넣기로 확정됨
const MAX_RETURN_FRAMES = 9;  // 시전 종료 후 원래 모습으로 복귀하는 전용 사진(return_N.webp), 최대 9장
const MAX_WALK_FRAMES = 6;    // 걷기 전용 사진(walk_N.webp), attack_N.webp와 같은 최대 장수

const frameCountCache = {};
const skillFrameCountCache = {};
const returnFrameCountCache = {};
const walkFrameCountCache = {};

// variant("" 또는 "_type2")는 이의진처럼 상태별로 다른 프레임 세트(attack_type2_N.webp 등)를 쓰는
// 캐릭터를 위한 것 - 캐시 키도 variant별로 따로 둬서 type1/type2 프레임 수를 혼동하지 않는다.
async function getAttackFrameCount(outfit, variant = "") {
    const cacheKey = `${outfit}${variant}`;
    if (frameCountCache[cacheKey] !== undefined) {
        return frameCountCache[cacheKey];
    }

    let count = 0;
    for (let i = 1; i <= MAX_ATTACK_FRAMES; i += 1) {
        const exists = await checkImageExists(
            `${battleRendererConfig.outfitImageBase}${outfit}/attack${variant}_${i}.webp`
        );
        if (!exists) break;
        count = i;
    }

    frameCountCache[cacheKey] = count;
    return count;
}

// 시전(캐스팅) 전용 프레임(skill_N.webp)이 있는지 확인 - attack_N.webp와 같은 규칙으로 캐릭터 outfit
// 폴더 안에서 순서대로 찾는다. 없는 캐릭터는 outfit당 한 번만 404를 확인하고 캐시해서 재확인하지 않는다.
async function getSkillFrameCount(outfit, variant = "") {
    const cacheKey = `${outfit}${variant}`;
    if (skillFrameCountCache[cacheKey] !== undefined) {
        return skillFrameCountCache[cacheKey];
    }

    let count = 0;
    for (let i = 1; i <= MAX_SKILL_FRAMES; i += 1) {
        const exists = await checkImageExists(
            `${battleRendererConfig.outfitImageBase}${outfit}/skill${variant}_${i}.webp`
        );
        if (!exists) break;
        count = i;
    }

    skillFrameCountCache[cacheKey] = count;
    return count;
}

// 시전 종료 후 원래 모습으로 복귀하는 전용 프레임(return_N.webp)이 있는지 확인 - skill_N.webp와 같은 규칙.
async function getReturnFrameCount(outfit, variant = "") {
    const cacheKey = `${outfit}${variant}`;
    if (returnFrameCountCache[cacheKey] !== undefined) {
        return returnFrameCountCache[cacheKey];
    }

    let count = 0;
    for (let i = 1; i <= MAX_RETURN_FRAMES; i += 1) {
        const exists = await checkImageExists(
            `${battleRendererConfig.outfitImageBase}${outfit}/return${variant}_${i}.webp`
        );
        if (!exists) break;
        count = i;
    }

    returnFrameCountCache[cacheKey] = count;
    return count;
}

// 걷는 동안 재생되는 전용 프레임(walk_N.webp)이 있는지 확인 - attack_N.webp와 같은 규칙. 근거리
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
            `${battleRendererConfig.outfitImageBase}${outfit}/walk${variant}_${i}.webp`
        );
        if (!exists) break;
        count = i;
    }

    walkFrameCountCache[cacheKey] = count;
    return count;
}

/*
 * 로비와 동일한 avatar-crop.js 규칙을 대표 프로필과 로스터 프로필에 적용한다.
 * HTML의 frame/thumb 요소가 overflow:hidden이므로 확대된 사진이 카드 밖으로 나오지 않는다.
 * variant가 있으면 idle${variant}.webp를 먼저 시도하고, 없으면(파일 미준비 등) 평소 idle.webp로 대체한다.
 */
function setPortraitImage(imgEl, outfit, variant = "") {
    if (!imgEl || !outfit) return;

    if (variant) {
        imgEl.onerror = () => {
            imgEl.onerror = null;
            imgEl.src = `${battleRendererConfig.outfitImageBase}${outfit}/idle.webp`;
        };
        imgEl.src = `${battleRendererConfig.outfitImageBase}${outfit}/idle${variant}.webp`;
    } else {
        imgEl.onerror = null;
        imgEl.src = `${battleRendererConfig.outfitImageBase}${outfit}/idle.webp`;
    }

    if (typeof applyAvatarCrop === "function") {
        applyAvatarCrop(imgEl, outfit);
    }
}

// ===== 코스트 게이지 + 스킬카드(전방/후방/서포터) =====
// 백엔드가 매 틱 코스트 값을 스트리밍하지 않고(전투당 이벤트가 700~1400개 늘어나 재생이 밀림)
// "변화가 생긴 순간"만 키프레임으로 보낸다(cost_init/cost_rate_change/cast_start의 cost_*
// 필드/cost_turn_skip) - 그 사이 구간은 순수 시간에 비례하는 선형 증가이므로, 프론트는 매 프레임
// currentSimTime()과 마지막 키프레임(anchorCost)만으로 지금 값을 정확히 재구성한다. HP바가
// "절대값 이벤트 + CSS transition 보간"으로 동작하는 것과 같은 철학이다.
// 김국회 "국회의사당" 착지 지점 전용 - 각 진영 후방(back) 슬롯의 "전투 시작 시점" 고정 위치를
// side별로 딱 한 번만 캐시한다(renderUnit이 처음 그 키를 그릴 때, 즉 아직 어떤 이동/넉백 이벤트도
// 재생되기 전). 국회의사당은 실제 그 순간 후방 캐릭터가 어디로 이동해 있든(넉백/근접 접근 등) 항상
// 이 고정 좌표에 소환돼야 하므로(확인된 요청) - 캐스트 시점에 그때그때 다시 재는 방식은 "지금 후방
// 슬롯이 실제로 어디 있는지"를 반영해버려 요구사항과 어긋난다.
const battleStartBackHomeRect = {}; // "attacker-back"/"defender-back" -> DOMRect(최초 1회 측정, 이후 불변)
const costState = {}; // side -> {pool, max, secondsPerPoint, anchorSimTime, displayed, cards[]}
let costDockRunning = false;
// 스킬카드 연속 사용 방지 시각("${side}-${slot}" -> 이 시각(전투 내 시각) 전까지는 CC와 동일한 "막힘"
// UI로 표시) - 실제 쿨다운 시간(SKILL_CARD_COOLDOWN_SECONDS)은 호출부(arena-battle.js/arena-live.js)의
// cast_start 처리 쪽에 남아있고, 여기서는 그 결과값만 읽는다(renderCostSide). 호출부가 이 객체에 직접
// 써야 하므로 그대로 노출한다.
const cardCooldownUntil = {};

// 이도협 "돌직구" 전용 - side별로 "지금 화면에 떠 있는 스트라이크 존" DOM 엘리먼트를 hitKey로 담아둔다.
// skill_resolve(시전, 존을 새김)와 delayed_skill_resolve(귀환, 그 존 자리에서 판정)가 서로 다른 시점에
// 오는 별개의 이벤트라 이렇게 모듈 스코프에 들고 있어야, 귀환 이벤트가 왔을 때 "그 존이 어디 있었는지"를
// 다시 계산하지 않고 그대로 재사용할 수 있다.
const dolljikguActiveZones = {};

// .cost-dock은 화면이 흔들려도 같이 흔들리지 않도록 뷰포트 기준 position:fixed다(HTML상으로도
// .battle-field 밖에 둠 - transform이 걸리는 조상 안에 있으면 fixed 자손이 그 조상 기준으로
// 재배치되는 CSS 규칙 때문에 흔들림을 따라간다, 확인된 버그). 세로(bottom)는 CSS 고정값으로
// 충분하지만, 가로는 .battle-field의 실제 위치를 몰라서는 맞출 수 없다 - .battle-layout이 화면
// 폭에 따라 그리드 컬럼 너비를 바꾸는 반응형 레이아웃이라, 뷰포트 기준 고정 px로는 스킬카드/
// 코스트바가 원래 있던 "필드 오른쪽 끝에서 6px" 자리에 못 맞는다(확인된 버그) - 매번 실측해서
// 인라인 스타일로 맞춘다.
function positionCostDock(dock) {
    const fieldEl = attackEffectsConfig.fieldEl || document.querySelector(".battle-field");
    if (!fieldEl) return;
    const fieldRect = fieldEl.getBoundingClientRect();
    dock.style.left = `${fieldRect.right - 6 - dock.offsetWidth}px`;
}

// 창 크기가 바뀌면(반응형 브레이크포인트 전환 포함) 이미 떠 있는 코스트덕도 다시 맞춰야 한다.
window.addEventListener("resize", () => {
    battleRendererConfig.costDockSides.forEach((side) => {
        const dock = document.getElementById(`cost-dock-${side}`);
        if (dock && !dock.hidden) positionCostDock(dock);
    });
});

function buildCostDockHtml(cards) {
    const cardsHtml = cards.map((card) => `
        <div class="cost-card" data-cost-slot="${card.slot}">
            <div class="cost-card-ring">
                <div class="cost-card-inner">
                    <img class="cost-card-img" src="" alt="">
                    <div class="cost-card-empty">EMPTY</div>
                </div>
                <div class="cost-card-gauge"></div>
            </div>
            <div class="cost-card-cost">${card.card_cost ?? ""}</div>
        </div>
    `).join("");
    return `
        <div class="cost-dock-core">
            <div class="cost-dock-cards">${cardsHtml}</div>
            <div class="cost-dock-bar-row">
                <div class="cost-bar-label">
                    <span class="cost-bar-label-text">COST</span>
                    <span class="cost-bar-value">0</span>
                </div>
                <div class="cost-bar-track">
                    <div class="cost-bar-fill"></div>
                    <div class="cost-bar-segments"></div>
                </div>
                <div class="cost-dock-side-buttons">
                    <div class="cost-auto-badge">AUTO</div>
                </div>
            </div>
        </div>
    `;
}

function initCostSide(event) {
    const units = battleRendererConfig.units;
    costState[event.side] = {
        pool: event.cost_pool, max: event.cost_max,
        secondsPerPoint: null, anchorSimTime: event.time,
        displayed: event.cost_pool, cards: event.cards,
    };
    if (!battleRendererConfig.costDockSides.includes(event.side)) return;

    const dock = document.getElementById(`cost-dock-${event.side}`);
    if (!dock) return;
    dock.innerHTML = buildCostDockHtml(event.cards);
    dock.hidden = false;
    positionCostDock(dock);

    event.cards.forEach((card) => {
        const el = dock.querySelector(`[data-cost-slot="${card.slot}"]`);
        if (!el) return;
        const unitKey = `${event.side}-${card.slot}`;
        const isEmpty = !card.has_skill || !units[unitKey];
        el.classList.toggle("is-empty", isEmpty);
        if (isEmpty) return;
        el.classList.add(`type-${(card.attack_type || "student").toLowerCase()}`);
        setPortraitImage(
            el.querySelector(".cost-card-img"),
            units[unitKey].outfit,
            battleRendererConfig.profileSpriteVariantOverrides[card.name] || ""
        );
    });

    // 참고 이미지처럼 배속 버튼을 AUTO 배지 위에 세로로 쌓는다 - 원래 자리(.battle-timer-row)에
    // 있던 실제 버튼 엘리먼트를 그대로 옮겨온다(복제가 아니라 이동이라 id/클릭 핸들러가 그대로
    // 유지된다). 이미 옮겨져 있으면(양쪽 다 cost_init을 받는 경우는 없지만 방어적으로) 다시
    // 옮기지 않는다.
    const sideButtons = dock.querySelector(".cost-dock-side-buttons");
    const speedToggle = document.getElementById("battle-speed-toggle");
    if (sideButtons && speedToggle && speedToggle.parentElement !== sideButtons) {
        sideButtons.prepend(speedToggle);
        // HTML상 기본은 hidden - cost_init이 오기 전(준비 시간 동안) 원래 자리(타이머 옆)에서
        // 잠깐 보였다가 여기로 "점프"하는 게 눈에 띄지 않도록 옮겨온 뒤에야 보여준다.
        speedToggle.hidden = false;
    }

    if (!costDockRunning) {
        costDockRunning = true;
        requestAnimationFrame(tickCostDock);
    }
}

function anchorCost(side, pool, simTime) {
    const st = costState[side];
    if (!st) return;
    st.pool = pool;
    st.anchorSimTime = simTime;
    st.displayed = pool; // 명시적 소모/보정은 여기서 즉시 반영(단조 클램프 기준점도 같이 리셋)
}

// 안지석 "예산 재배정"/만료 공용 - 카드 숫자 배지의 실제 표시 코스트(card_cost)를 바꾼다. costState의
// cards 배열(부채꼴 게이지 계산 기준)과 DOM 텍스트를 함께 갱신해야, 이후 renderCostSide가 매 프레임
// 계산하는 fill(=displayed/card_cost)도 새 코스트 기준으로 정확히 맞는다.
function setCostCardCost(side, slot, newCost) {
    const st = costState[side];
    const card = st?.cards.find((c) => c.slot === slot);
    if (card) card.card_cost = newCost;
    if (!battleRendererConfig.costDockSides.includes(side)) return;
    const dock = document.getElementById(`cost-dock-${side}`);
    const costEl = dock?.querySelector(`[data-cost-slot="${slot}"] .cost-card-cost`);
    if (costEl) costEl.textContent = String(newCost);
}

function flashCostCard(side, slot, cls) {
    if (!battleRendererConfig.costDockSides.includes(side)) return;
    const dock = document.getElementById(`cost-dock-${side}`);
    const el = dock?.querySelector(`[data-cost-slot="${slot}"]`);
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
}

function renderCostSide(side, simNow) {
    const units = battleRendererConfig.units;
    const st = costState[side];
    if (!st) return;
    let pool = st.pool;
    if (st.secondsPerPoint) {
        pool = Math.min(st.max, st.pool + Math.max(0, simNow - st.anchorSimTime) / st.secondsPerPoint);
    }
    // 재생 커서가 재앵커링되며(playNext) 전투 시각이 몇 ms 뒤로 밀릴 수 있는데, 그때마다 게이지가
    // 찔끔 되감기면 눈에 띈다 - 명시적 소모(anchorCost)가 아니면 표시값은 절대 줄지 않게 한다.
    st.displayed = Math.max(st.displayed, pool);

    if (!battleRendererConfig.costDockSides.includes(side)) return;
    const dock = document.getElementById(`cost-dock-${side}`);
    if (!dock) return;
    const fillEl = dock.querySelector(".cost-bar-fill");
    const valueEl = dock.querySelector(".cost-bar-value");
    if (fillEl) fillEl.style.width = `${(st.displayed / st.max) * 100}%`;
    if (valueEl) valueEl.textContent = Math.floor(st.displayed);

    st.cards.forEach((card) => {
        if (!card.has_skill) return;
        const el = dock.querySelector(`[data-cost-slot="${card.slot}"]`);
        if (!el) return;
        const unitKey = `${side}-${card.slot}`;
        const dead = !units[unitKey] || units[unitKey].hp <= 0;
        // 기절/방임처럼 "행동 불가" 상태여도 코스트가 차오르는 연출은 그대로 보여준다 -
        // statusIconState의 "stun" 아이콘(기절/광역기절/방임이 전부 이 아이콘 하나를 공유해서 켠다)
        // 유무만으로 실시간 판정하되, 다 찬 뒤(fill>=1)에는 실제 발동 가능한 is-ready로 넘어가지
        // 않고 is-blocked-charged에 머문다 - CSS상 is-ready 전용 효과(게이지 사라짐/원래 색)가
        // 안 걸려서, 부채꼴 게이지가 가득 찬 채로 그대로 멈춰있는 것처럼 보인다. CC가 풀려서
        // 아이콘이 사라지는 순간 다음 프레임에 바로 is-ready로 넘어간다. 스킬카드 연속 사용 방지
        // 쿨다운(cardCooldownUntil)도 완전히 같은 "막힘" UI를 공유한다 - 실제 CC 상태가 아니어도
        // 발동 직후 SKILL_CARD_COOLDOWN_SECONDS 동안은 카드가 똑같이 회색으로 보인다.
        const onCooldown = (cardCooldownUntil[unitKey] || 0) > simNow;
        // 신 "제 2 권한"(revive_dead_striker): 되살릴 죽은 STRIKER(전방/후방)가 하나도 없으면
        // 백엔드(_has_revivable_striker)가 코스트를 소모하지 않고 조용히 턴만 넘긴다 - CC 때와
        // 똑같이 카드가 회색으로 보여야 하는데, 그 판정에 필요한 정보(내 팀 전방/후방 생존 여부)는
        // 이미 프론트가 갖고 있으므로 백엔드 이벤트 없이 여기서 직접 계산한다.
        const noRevivableTarget = card.name === "신" && !["front", "back"].some((slot) => {
            const u = units[`${side}-${slot}`];
            return u && u.hp <= 0;
        });
        // 방임석 "제목은 관객이 정하세요"(consume_paint_multi_effect): 보유한 물감(빨강/파랑/노랑)이
        // 하나도 없으면 백엔드(_has_any_paint)가 코스트를 소모하지 않고 조용히 턴만 넘긴다 - 신의
        // noRevivableTarget과 같은 패턴으로, 물감 개수는 이미 statusIconState(paint_gain_resolve로
        // 갱신됨)에 있으므로 백엔드 이벤트 없이 여기서 직접 판정한다.
        const noPaintAvailable = card.name === "방임석" && !["paint_red", "paint_blue", "paint_yellow"].some(
            (iconId) => statusIconState[unitKey]?.[iconId]
        );
        // 이의진 "염색체 변환"(self_type_swap_heal): type2(여성) 상태에서는 코스트가 다 차도 못 쓴다
        // (백엔드 _can_cast_type_swap과 동일한 판정) - isType2는 skill_resolve 디스패치 시점에 이미
        // units[unitKey]에 갱신해두는 값을 그대로 재사용한다(신/방임석과 같은 패턴).
        const isType2Locked = card.name === "이의진" && Boolean(units[unitKey]?.isType2);
        // 김현재: 방향 전환/폭주/지키고 싶은 마음 중 무엇이든 진행 중이면(kimhyeonjaeMode가 null이
        // 아니면) [Active] 카드를 방임석의 "방임"과 동일하게 회색(막힘)으로 보여준다(확인된 요청 -
        // 백엔드 _can_cast_direction_shift도 이 상태들 동안엔 재시전 자체를 이미 막아뒀다).
        const kimhyeonjaeLocked = card.name === "김현재" && Boolean(units[unitKey]?.kimhyeonjaeMode);
        const blocked = !dead && (onCooldown || Boolean(statusIconState[unitKey]?.stun?.sources?.size) || noRevivableTarget || noPaintAvailable || isType2Locked || kimhyeonjaeLocked);
        el.classList.toggle("is-dead", dead);
        el.classList.toggle("is-blocked", blocked);
        const fill = dead ? 0 : Math.min(1, st.displayed / card.card_cost);
        // 변화가 눈에 안 보일 정도로 작으면 다시 안 쓴다(conic-gradient 재계산 절약).
        if (Math.abs((el.dataset.costFill ? Number(el.dataset.costFill) : -1) - fill) >= 0.004) {
            el.dataset.costFill = String(fill);
            el.style.setProperty("--cost-fill", fill.toFixed(3));
        }
        const charged = fill >= 1;
        el.classList.toggle("is-ready", !dead && !blocked && charged);
        el.classList.toggle("is-blocked-charged", !dead && blocked && charged);
    });
}

function tickCostDock() {
    if (!costDockRunning) return;
    const simNow = battleRendererConfig.currentSimTime();
    Object.keys(costState).forEach((side) => renderCostSide(side, simNow));
    requestAnimationFrame(tickCostDock);
}

// ===== 유닛 스프라이트 기본 렌더링(체력바/사망/방향전환) =====

// 이의진처럼 상태(type1/type2)에 따라 다른 스프라이트 파일을 쓰는 캐릭터용 - 평소엔 빈 문자열,
// isType2가 true면 "_type2"를 붙여서 attack_N_type2.webp가 아니라 attack_type2_N.webp 규칙을 맞춘다.
// 윤의 "호"처럼 소환수가 시전자와 같은 outfit 폴더를 공유하면서 접미사로만 구분되는 경우엔
// units[key].spriteVariant(백엔드 clone_sprite_variant, 예: "_ho")가 우선한다 - summon_clone
// 처리부에서 설정. 둘 다 없으면(대부분의 캐릭터, 윤영준의 복제체 등) 기존처럼 접미사 없음.
function spriteVariantSuffix(key) {
    const units = battleRendererConfig.units;
    return units[key]?.spriteVariant || (units[key]?.isType2 ? "_type2" : "");
}

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

// 사망 시: 로그 한 줄 + 사망 디폴트 사진(death${variant}.webp, 아직 없으면 idle 사진을 흑백으로
// 임시 대체) + 투명해지면서 가로 실선 무늬로 스캔되듯 사라지는 연출. variant는 battle_idle/attack과
// 동일하게 spriteVariantSuffix로 정한다 - 윤의 "호"처럼 시전자와 outfit 폴더를 공유하는 소환수도
// 이걸로 자기 전용 사망 그림(예: death_ho.webp)을 따로 쓸 수 있다.
function playDeathSequence(key) {
    const units = battleRendererConfig.units;
    const unit = units[key];
    const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
    if (!unit || !imgEl) return;

    // 근접 유닛이 아직 도착 전(walkAnimActive=true, walk_N.webp 순환 중)에 원거리 공격/광역기로
    // 죽으면, tick()은 hp<=0인 유닛을 그냥 건너뛸 뿐(startMeleeWalker) playWalkFrames의 while
    // 루프 자체는 멈추지 않는다(walkAnimTokens가 안 바뀌면 계속 돎) - stopWalkFrames로 토큰을
    // 갈아치워 확실히 멈추고 walkAnimActive를 리셋해둔다. 안 그러면 이 유닛이 나중에 부활해서 다시
    // 걸어야 할 때, walkAnimActive가 죽기 전 값(true)에 그대로 걸려있어 playWalkFrames가 다시
    // 시작되지 않고(startMeleeWalker의 "!walkAnimActive[key]" 게이트) 그 캐릭터 고유의 걷기 프레임
    // (walk_N.webp) 없이 밋밋한 CSS bob 애니메이션만으로 걷는 버그로 이어진다.
    stopWalkFrames(key);
    // 같은 이유로 CSS 쪽 .walking 클래스(걷기 시작 판정 자체 - meleeWalkZCounter z-index 스탬핑과
    // walk-bob 애니메이션이 여기 걸려있다)도 죽을 때 확실히 지운다. 도착하기 전에(markMeleeArrived를
    // 못 거치고) 죽으면 이 클래스가 안 지워진 채 남는데, 그러면 부활 직후 tick()의
    // "!classList.contains('walking')" 판정이 이미 거짓이 되어 그 첫 걷기 재개 프레임에 z-index를
    // 새로 찍는 로직(reviveWalkTopZ 포함) 자체가 통째로 건너뛰어진다 - 부활한 유닛이 죽기 훨씬
    // 전의 낡은 z-index를 그대로 들고 다시 걷다가 그 사이 다른 유닛에게 가려지는 버그로 이어진다.
    imgEl.classList.remove("walking");

    // renderUnit()이 호출되는 시점(피해 반영 콜백 안)에는 아직 그 콜백 뒤쪽의 "피해" appendLog가
    // 실행되지 않은 경우가 많아, 여기서 즉시 로그를 남기면 "사망"이 "피해"보다 먼저 뜬다. 매크로태스크로
    // 한 틱 미뤄서, 같은 콜백 안에서 이어지는(동기) 피해 로그가 먼저 찍히고 그 다음에 사망 로그가 오게 한다.
    setTimeout(() => battleRendererConfig.appendLog(`${unit.name} 사망!`, null), 0);

    // 호(자폭 소환수): playGoldenSelfDestruct가 이미 캐릭터 자체의 소멸(스케일/빛/페이드)을 맡고
    // 있으므로, 여기서 death.webp로 바꾸거나 .dying 페이드를 얹지 않는다 - 로그만 남기고 끝낸다.
    if (goldenSelfDestructActive[key]) return;

    const variant = spriteVariantSuffix(key);
    // revive-rising(shared/attack-effects.css)이 attack-effects.css가 arena-battle.css보다 뒤에
    // 로드돼(<link> 순서) .dying과 동일 특이도에서 캐스케이드를 이긴다 - 부활 후 이 클래스를 안
    // 지우고 남겨두면, 그다음에 다시 죽어도 .dying의 death-dissolve 애니메이션이 전혀 적용되지
    // 않고(revive-sprite-rise가 이미 끝나 고정해둔 opacity/filter 그대로) 실선무늬 페이드 없이
    // 어중간하게 남는 버그가 있었다 - 죽을 때마다 확실히 지운다.
    imgEl.classList.remove("death-fallback-filter", "revive-rising");
    imgEl.onerror = () => {
        imgEl.onerror = null;
        imgEl.src = `${battleRendererConfig.outfitImageBase}${unit.outfit}/idle.webp`;
        imgEl.classList.add("death-fallback-filter"); // 전용 사망 그림이 없는 캐릭터는 idle을 흑백으로 임시 대체
    };
    imgEl.src = `${battleRendererConfig.outfitImageBase}${unit.outfit}/death${variant}.webp`;

    imgEl.classList.add("dying");
}

// 다단히트(F=ma/GPT 킬러)가 탄환별로 로스터 바를 단계적으로 보여주는 동안, 그 대상을 향한 "이번
// 시퀀스의 표시용 hp"를 여기 남겨둔다. hpOverride만으로는 그 스킬 "자신의" renderUnit 호출만
// 단계적으로 보이고, 그 몇 초 사이 같은 대상을 겨냥한 다른 배우의 이벤트가 override 없이
// renderUnit(key)를 부르면 이미 최종값으로 반영된 unit.hp를 그대로 드러내서 탄환이 도착하기도
// 전에 체력바가 먼저 줄어드는 것처럼 보였다(실제 확인된 버그). 그래서 hpOverride가 없을 때도
// unit.hp보다 먼저 이 값을 본다 - 시퀀스가 끝나면(clearPendingDisplayHp) 지워서 그 뒤로는 다시
// 진짜 unit.hp를 따른다.
const pendingDisplayHp = {}; // unitKey -> number

function setPendingDisplayHp(key, hp) {
    if (key == null) return;
    pendingDisplayHp[key] = hp;
}

function clearPendingDisplayHp(key) {
    if (key == null) return;
    delete pendingDisplayHp[key];
}

// hpOverride: 다단히트(F=ma/GPT 킬러)가 탄환별로 로스터 바를 단계적으로 보여줄 때만 넘긴다.
// units[key].hp 자체는 이벤트 처리 시점에 이미 최종값으로 즉시 반영돼 있어서(다른 배우 이벤트와의
// 순서 보장 때문 - 위 basic_attack 처리부 주석 참고), 그걸 그대로 그리면 첫 탄환에서 이미 다 깎인
// 것처럼 보인다. hpOverride는 오직 로스터 체력바의 표시 폭에만 쓰이고, 사망 판정(isDead)은 항상
// 진짜 unit.hp를 기준으로 해야 한다 - 안 그러면 아직 날아가는 중인 탄환 때문에 사망 연출이
// 너무 일찍 시작돼버린다.
function renderUnit(key, hpOverride) {
    const units = battleRendererConfig.units;
    const attackAnimActive = battleRendererConfig.attackAnimActive;
    const deathHandled = battleRendererConfig.deathHandled;
    const outfitImageBase = battleRendererConfig.outfitImageBase;

    const unit = units[key];
    const rosterEl = document.querySelector(`[data-roster="${key}"]`);
    const isDead = unit.hp <= 0;
    const displayHp = hpOverride != null ? hpOverride : (pendingDisplayHp[key] != null ? pendingDisplayHp[key] : unit.hp);

    if (rosterEl) {
        // 상대팀 체력바 색상을 방어타입별로 다르게 칠하기 위한 훅(arena-battle.css의
        // [data-defense-type] 규칙 참고) - 우리팀은 defenseType과 무관하게 항상 단일 색이라
        // 이 속성이 있어도 CSS가 defender 쪽만 참조한다.
        if (unit.defenseType) rosterEl.dataset.defenseType = unit.defenseType;
        const hpFillEl = rosterEl.querySelector(".roster-hp-fill");
        const hpPercent = Math.max(0, (displayHp / unit.maxHp) * 100);

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

        // 보호막 바 - 0이거나 죽었으면 트랙 자체를 숨긴다(원래부터 보호막이 없는 유닛도 대부분
        // 이 상태). 김크장 같은 서포터 본인은 애초에 로스터 행이 없어 rosterEl이 null이라 여기까지
        // 오지도 않는다 - 이 블록은 항상 보호막을 "받는" 스트라이커 쪽에서만 실행된다.
        const shieldTrackEl = rosterEl.querySelector(".roster-shield-track");
        const shieldFillEl = rosterEl.querySelector(".roster-shield-fill");
        if (shieldTrackEl) {
            const hasShield = !isDead && unit.shield > 0;
            shieldTrackEl.hidden = !hasShield;
            if (hasShield && shieldFillEl) {
                // max_hp 대비가 아니라 "이번에 부여받은 보호막 자체"를 기준으로 채운다 - 그래야
                // 최대 체력의 일부만 보호막으로 받아도(예: 10%) 바가 항상 꽉 찬 상태로 시작하고,
                // 이후 깎이는 만큼만 흰색 트랙이 드러난다(체력 바가 트랙 배경을 드러내는 것과 동일한
                // 방식). unit.shieldMax는 보호막이 늘어날 때만 갱신하고, 0이 되면 초기화해서 다음번
                // 새로 부여될 때 그 값을 기준으로 다시 잡는다.
                if (!unit.shieldMax || unit.shield > unit.shieldMax) unit.shieldMax = unit.shield;
                shieldFillEl.style.width = `${Math.max(0, Math.min(100, (unit.shield / unit.shieldMax) * 100))}%`;
            } else {
                unit.shieldMax = 0;
            }
        }
    }

    // 보호막 오라(전장 스프라이트 주변에 뜨는 캔버스 이펙트) - 로스터 바와 별개로, 스프라이트가
    // 실제로 존재하는 유닛에만 켠다(서포터 본인은 스프라이트가 없어 이 키로는 절대 안 켜짐).
    setShieldAura(key, !isDead && unit.shield > 0);

    const battleEl = document.querySelector(`[data-unit="${key}"]`);
    if (!battleEl) return;

    // renderUnit이 이 키를 그리는 첫 호출 = 아직 그 어떤 이동/넉백 이벤트도 처리되기 전(전투 시작
    // 직전의 초기 렌더 패스) - 국회의사당 착지 지점이 쓸 "진짜 고정 후방 위치"를 여기서 딱 한 번만
    // 캐시해둔다(battleStartBackHomeRect 선언부 주석 참고).
    if (key.endsWith("-back") && !battleStartBackHomeRect[key]) {
        battleStartBackHomeRect[key] = measureHomeRect(battleEl);
    }

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
            // 김현재: 폭주/지키고 싶은 마음 자연 종료로 인한 "즉시 사망"(kimhyeonjae_mode_resolve의
            // death 분기)은 이미 거기서 직접 대기 날개를 끄지만, 그 상태에서 그냥 평범한 적 공격으로
            // 죽는 경우(더 흔함)는 그 이벤트를 안 거치므로 여기서 대신 꺼야 한다 - 그래야 사망 후에도
            // 날개가 화면에 계속 남아있는 버그가 안 생긴다(확인된 버그). 이 캐릭터가 아니면(kimhyeonjaeMode
            // 필드 자체가 없음) 아무 일도 안 한다.
            if (battleRendererConfig.units[key]?.kimhyeonjaeMode) {
                battleRendererConfig.units[key].kimhyeonjaeMode = null;
                setKimHyeonjaeWingAura(key, null);
                khSetMeleeActive(key, false);
            }
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
                // type2 전용 idle 사진은 없음(변신은 전투 중 상태라 로비 초상화 idle.webp는 안 바뀜) -
                // battle_idle_type2.webp가 없는 캐릭터/오타 등으로 로드 실패해도 평상시 idle로 대체된다.
                imgEl.src = `${outfitImageBase}${unit.outfit}/idle.webp`;
            };

            imgEl.src = `${outfitImageBase}${unit.outfit}/battle_idle${variant}.webp`;
            imgEl.classList.toggle("flipped", isFacingFlipped(key)); // 방향은 전투 중 동적으로 바뀔 수 있음
        }
    }

    battleEl.classList.toggle("battle-unit-dead", isDead);
}

// 스트라이커(전방/후방) 한 명만 등록한 편성이면 그 쪽 team.front/back이 null로 내려온다 - 그
// 슬롯은 애초에 units에 키 자체를 안 만든다(존재하지 않는 유닛). 코스트카드/로스터 정렬/
// Object.keys(units) 기반 순회 로직은 이미 복제 소환수처럼 "언제든 늘어날 수 있는 키 집합"을
// 전제로 짜여 있어서, 반대로 "처음부터 한 키가 아예 없는" 경우도 그대로 안전하게 건너뛴다.
function findUnitKey(side, name) {
    const units = battleRendererConfig.units;
    // 전방/후방 중 한쪽이 비어있는 편성(스트라이커 1명)이면 그 슬롯은 애초에 units에 없다.
    if (units[`${side}-front`]?.name === name) {
        return `${side}-front`;
    }

    if (units[`${side}-back`]?.name === name) {
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

// ===== 상태 아이콘(로스터의 버프/디버프/CC 표시) =====
const STATUS_ICON_FILES = {
    atk_up: "Combat_Icon_Buff_ATK.webp",
    maxhp_up: "Combat_Icon_Buff_MAXHP.webp",
    atk_speed_up: "Combat_Icon_Buff_AttackSpeed.webp",
    crit_up: "Combat_Icon_Buff_CriticalDamage.webp",
    crit_chance_up: "Combat_Icon_Buff_CriticalChance.webp",
    rear_priority: "Combat_Icon_Special_AttackRear.webp",
    atk_down: "Combat_Icon_Debuff_ATK.webp",
    maxhp_down: "Combat_Icon_Debuff_MAXHP.webp",
    stun: "Combat_Icon_CC_Stunned.webp",
    knockback: "Combat_Icon_CC_Knockback.webp",
    heal: "Combat_Icon_Recovery_Heal.webp",
    immune: "Combat_Icon_Special_ImmuneDamage.webp",
    paint_red: "Combat_Icon_Special_InkRed.webp",     // 방임석 보유 물감(빨강) - weight로 개수 표시
    paint_blue: "Combat_Icon_Special_InkBlue.webp",   // 방임석 보유 물감(파랑)
    paint_yellow: "Combat_Icon_Special_InkYellow.webp", // 방임석 보유 물감(노랑)
    damage_reduction: "Combat_Icon_Buff_DamageRatio.webp", // 방임석 "방임" - 받는 피해 감소
    lifesteal: "Combat_Icon_Special_Lifesteal.webp", // 윤 "선생 고혈" - 공격 대상이 선생 타입인 동안(고혈)
    madness: "Combat_Icon_Special_Madness.webp", // 김지섭 "격정" 보유 광기 - weight로 개수 표시(paint_red와 동일한 방식)
    move_speed_up: "Combat_Icon_Buff_MoveSpeed.webp", // 김지섭 "격정" 광기 소모 시 이동속도 증가
    cost_reduction: "Combat_Icon_Buff_CostChange.webp", // 안지석 "예산 재배정" 코스트 감소 상태 - weight로 남은 사용 횟수 표시
};

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
    source.untilSimTime = undefined;
    if (opts.untilSimTime !== undefined) {
        // 백엔드 시뮬레이션 시각(예: 스킬이 실제로 발동한 event.time + 지속 초) 기준 - durationMs처럼
        // "지금부터 몇 ms"를 한 번 못박지 않고, 실제 그 상태가 끝나는 시뮬레이션 시각을 저장해뒀다가
        // 매 이벤트 재생마다(rearmAllSimTimers) 그 시점의 실시간 환산값으로 다시 계산한다 - 애니메이션
        // 밀림 등으로 재생이 늦어져도 아이콘이 실제 상태보다 먼저 사라지지 않는다.
        source.untilSimTime = opts.untilSimTime;
        armSimTimer(unitKey, iconId, sourceKey);
    } else if (opts.durationMs) {
        // 회복/넉백처럼 "그 순간을 알려주는" 용도일 뿐 백엔드 상태 지속시간과 무관한 표시는 지금처럼
        // 고정 실시간(ms)으로 충분하다(realMsUntilSimTime로 환산할 시뮬레이션 시각 자체가 없음).
        source.timer = setTimeout(() => clearStatusIconSource(unitKey, iconId, sourceKey), opts.durationMs);
    }

    renderStatusIconTotal(unitKey, iconId);
}

// star_effect_resolve(성급 효과)/trait_resolve(특성) 이벤트가 공유하는 범용 아이콘 처리 - 백엔드
// build_stat_change_dicts가 만들어주는 changes[] 목록(대상/atk/hp/crit/crit_chance/rear_priority/haste
// 부호)을 그대로 읽어서 상태 아이콘을 켠다. effect_type마다 여기 손으로 분기를 하나씩 추가하지
// 않아도 되게 하기 위함 - 예전엔 trait_resolve만 이런 분기가 없어서(성급 효과는 처음부터 이 방식)
// 새 캐릭터를 추가할 때마다 프론트 아이콘 처리를 깜빡하기 쉬웠다(실제로 5개나 빠져 있었음).
function applyStatChangeIcons(changes, source) {
    const units = battleRendererConfig.units;
    (changes || []).forEach((change) => {
        const changedKey = findUnitKey(change.target_side, change.target);
        if (!changedKey) return;
        if (change.atk > 0) setStatusIcon(changedKey, "atk_up", { source });
        if (change.atk < 0) setStatusIcon(changedKey, "atk_down", { source });
        if (change.hp > 0) setStatusIcon(changedKey, "maxhp_up", { source });
        if (change.hp < 0) setStatusIcon(changedKey, "maxhp_down", { source });
        if (change.crit > 0) setStatusIcon(changedKey, "crit_up", { source });
        if (change.crit_chance > 0) setStatusIcon(changedKey, "crit_chance_up", { source });
        if (change.rear_priority > 0) setStatusIcon(changedKey, "rear_priority", { source });
        if (change.haste > 0) setStatusIcon(changedKey, "atk_speed_up", { source });
        // 보호막(김크장류 서포터의 전투 시작 시 부여) - atk/hp와 달리 "얼마나 찼는지" 바를 그려야
        // 해서 아이콘이 아니라 shield_after(그 시점의 실제 보호막 수치)를 곧바로 units에 반영한다.
        // change.shield_after는 shield_sign 여부와 무관하게 항상 실려오므로(build_stat_change_dicts
        // 참고), 이 유닛이 아직 한 번도 안 맞았어도(전투 시작 직후) 보호막 바가 바로 보인다.
        if (change.shield_after !== undefined) {
            units[changedKey].shield = change.shield_after;
            renderUnit(changedKey);
            // shield(부호)가 있을 때만 "막 새로 걸린" 순간이다 - 매 프레임 동기화용으로 딸려오는
            // shield_after(부호 없음)까지 팝인을 재생하면 관련 없는 다른 스탯 변화 이벤트에서도
            // 매번 팝인이 뜬다.
            if (change.shield > 0) playShieldPop(changedKey);
        }
        flashEffectAura(changedKey, (change.atk < 0 || change.hp < 0) ? "debuff" : "buff");
    });
}

function armSimTimer(unitKey, iconId, sourceKey) {
    const entry = statusIconState[unitKey]?.[iconId];
    const source = entry?.sources.get(sourceKey);
    if (!source || source.untilSimTime === undefined) return;
    if (source.timer) clearTimeout(source.timer);
    source.timer = setTimeout(
        () => clearStatusIconSource(unitKey, iconId, sourceKey),
        battleRendererConfig.realMsUntilSimTime(source.untilSimTime)
    );
}

// 이벤트 재생 원점(playbackOriginWallMs/-EventTime)이 갱신될 때마다(playNext) 호출 - 지금까지의
// 실제 재생 지연(애니메이션 대기 등)을 반영한 최신 환산으로 모든 시뮬레이션 시각 기반 아이콘
// 타이머를 다시 잡는다. 앞서 확인한 버그(김남옥 공격속도 버프 아이콘이 실제 상태보다 먼저 사라짐)의
// 원인이 "생성 시점 실시간으로 못박은 타이머가 이후 재생 지연을 반영하지 못함"이었으므로, 매번
// 다시 계산해서 실제 상태 종료 시각과 항상 일치시킨다.
function rearmAllSimTimers() {
    Object.keys(statusIconState).forEach((unitKey) => {
        const icons = statusIconState[unitKey];
        Object.keys(icons).forEach((iconId) => {
            icons[iconId].sources.forEach((source, sourceKey) => {
                if (source.untilSimTime !== undefined) armSimTimer(unitKey, iconId, sourceKey);
            });
        });
    });
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

// ===== 근거리 이동: 매 프레임마다 실제 위치를 재서 조금씩 다가가는 방식 =====
// (예전엔 거리/시간을 미리 계산해서 CSS 트랜지션 하나로 재생했는데, 여러 유닛이 동시에 움직이거나
// 타겟이 도중에 바뀌면 "그 순간의 정확한 위치"를 미리 맞추기가 매우 까다로웠다. 지금은 그냥 매 프레임
// 계속 "지금 실제 위치 기준으로 조금만 더 가자"를 반복해서, 상대가 같이 움직여도 항상 정확하다.)
// 이동 속도 = 초당 "뷰포트 가로폭의 10%" - 고정 픽셀이 아니라 화면 가로에 비례한 값을 쓴다.
// .battle-row의 캐릭터 간격(gap: clamp(56px, 12vw, 300px))도 같은 뷰포트 가로 기준(vw)으로
// 늘어나므로, 속도도 같은 기준으로 비례해야 화면 크기가 달라져도 도착 시간이 거의 그대로 유지된다
// (고정 픽셀 속도였을 땐 넓은 화면일수록 걸어야 할 거리만 늘고 속도는 그대로라 도착이 느려졌었다).
const MOVE_SPEED_VW_PERCENT_PER_SEC = 10;
const APPROACH_OVERLAP = 1;
const ARRIVE_THRESHOLD_PX = 2;
// 이미 도착한(meleeArrived=true) 상태에서 상대가 자기 목표를 향해 계속 걷느라 화면상 위치가 계속
// 조금씩 흔들리면, ARRIVE_THRESHOLD_PX(2px)는 너무 좁아서 매 프레임 "도착"과 "미도착"을 오간다 -
// 그때마다 meleeArrived가 false로 풀리는데, 그 순간 마침 큐에 밀려있던 basic_attack 이벤트의
// waitForMeleeArrival이 도착을 기다리게 되면서, 실제로는 백엔드가 계속 공격을 기록하고 있는데도
// 화면에는 한동안 아무 공격도 안 일어나는 것처럼 밀렸다가 상대가 완전히 멈춰서야 몰아서 재생되는
// 버그가 있었다. 한 번 도착하면, 확실히 멀어지기 전까지(이 값을 넘기 전까지)는 다시 "미도착"으로
// 되돌리지 않는 여유 구간(히스테리시스)을 둔다.
const LOSE_CONTACT_THRESHOLD_PX = 48;
const WALK_FRAME_DURATION_MS = 220;

const meleeTargetKey = {};              // key -> 지금 다가가야 하는 적 슬롯
const meleeArrived = {};                // key -> 그 타겟에 이미 도착했는지
const pendingArrivalResolvers = {};     // key -> 도착을 기다리고 있는 Promise resolve 함수들
const walkerSuspended = {};             // key -> 이동 루프를 잠깐 멈춰둘지(넉백 트랜지션 중 tick()과 충돌 방지)
// key -> 부활 후 다시 걷기 시작하는 그 첫 프레임엔 아래 meleeWalkZCounter 기반 z-index 대신 항상
// 최상단(MELEE_WALK_Z_BASE, 일반 카운터로는 절대 못 넘는 값)을 받아야 하는지. 전투가 길어질수록
// meleeWalkZCounter가 누적돼(공유 카운터라 양 팀 전체의 "걷기 시작" 횟수만큼 계속 증가) 나중에
// 다시 걷기 시작하는 유닛일수록 z-index가 1까지 깎여서, 이미 그 자리 근처에 있던(오래 전부터
// 걷고 있던) 상대 뒤에 완전히 가려져 버린다 - 부활한 캐릭터가 걷는 동안 안 보이다가 도착해서야
// 갑자기 나타나는(=이펙트가 뜬 곳에 캐릭터가 없는) 버그의 원인이었다.
const reviveWalkTopZ = {};
// 근접 유닛이 겹쳐 보일 때 누가 앞/뒤인지는 순전히 DOM 순서(z-index 미지정 = auto)로 정해져서,
// 나중에 걸어와 겹친 유닛이 오히려 원래 있던 유닛보다 앞으로(위로) 그려지는 문제가 있었다 - "걷기를
// 시작하는" 순간(정지 -> walking 전환) 이 카운터를 하나씩 늘려 그 유닛의 z-index로 찍어두면, 더
// 나중에 걷기 시작한 유닛일수록 더 높은 값을 받아 항상 앞선 유닛보다... 앞이 아니라 뒤에 있어야
// 하므로 z-index는 거꾸로(=낮게) 준다. .battle-unit.render-on-top(50)보다는 항상 낮게 유지한다.
let meleeWalkZCounter = 0;
const MELEE_WALK_Z_BASE = 40; // .render-on-top(50)보다 낮게, auto(0 취급)보다는 높게
let walkerRunning = false;
// startMeleeWalker가 다시 호출될 때마다 증가 - attackAnimTokens와 동일한 이유(재시작 시 이전 세대의
// tick() 루프가 확실히 멈추도록). walkerRunning 하나만 보면, 리셋(false) 직후 아주 짧은 틈에 새
// 전투가 다시 시작(true)돼서 이전 tick()의 다음 프레임 체크가 "여전히 유효함"으로 오판할 여지가
// 있다(이 프로젝트에서는 아레나는 전투당 1회만 호출돼 실질적 위험이 없지만, devtest는 같은 화면에서
// 재시작이 가능해 이 보호가 필요하다).
let walkerEpoch = 0;
const walkAnimTokens = {};
const walkAnimActive = {}; // key -> 지금 playWalkFrames 루프가 이미 돌고 있는지(매 tick마다 중복으로 새로 시작하지 않기 위함)

// 최재혁은 ★3부터 후방 적을 우선 공격한다(battle_engine.py의 _select_basic_attack_target과 동일 규칙).
// 일반 유닛은 기본적으로 적 전방을 향해 걷다가 첫 공격 이벤트가 오면 실제 타겟으로 재조정되지만,
// 최재혁은 처음부터 실제 목표(후방)를 알고 있으므로 그 재조정("뜸들임")을 건너뛰고 곧장 걸어간다.
function initialMeleeTargetKey(key) {
    const units = battleRendererConfig.units;
    const side = key.startsWith("attacker") ? "attacker" : "defender";
    const enemySide = side === "attacker" ? "defender" : "attacker";
    const unit = units[key];
    // 스트라이커 1명만 등록된 편성이면 적의 전방/후방 중 한쪽이 비어있을 수 있으므로, 실제로
    // 존재하는 슬롯을 우선한다(없는 자리를 향해 걷기 시작했다가 첫 공격 이벤트에서야 재조정되는
    // 어색한 순간을 없앤다).
    if (unit?.name === "최재혁" && (unit.star || 1) >= 3 && units[`${enemySide}-back`]) {
        return `${enemySide}-back`;
    }
    if (units[`${enemySide}-front`]) return `${enemySide}-front`;
    if (units[`${enemySide}-back`]) return `${enemySide}-back`;
    return `${enemySide}-front`; // 이론상 도달하지 않음(최소 한 명은 등록돼야 출전 가능)
}

// unitKey가 targetKey에게 도달하려면 지금 이 순간 기준으로 얼마나 더(어느 방향으로) 움직여야 하는지.
// 양쪽 다 매 프레임 이 함수로 "실시간" 위치를 재기 때문에, 상대가 동시에 움직여도 항상 정확하다.
// 대상이 자기 등 뒤(진영 기준 반대편)에 있으면 그쪽 면으로 붙는다 - 진행 방향이 고정돼 있지 않다.
function getGapToTarget(unitKey, targetKey) {
    const units = battleRendererConfig.units;
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

// el의 "인라인 transform이 전혀 없다고 가정했을 때"의 위치를 잰다 - 넉백(applyKnockback)이 남긴
// translateX가 쌓여있어도 그 순수 홈(전투 시작) 위치를 구할 수 있다. 동기적으로 지웠다 즉시
// 복원하므로(둘 사이에 화면이 그려지지 않음) 진행 중인 트랜지션에도 영향을 주지 않는다.
function measureHomeRect(el) {
    const saved = el.style.transform;
    el.style.transform = "none";
    const rect = el.getBoundingClientRect();
    el.style.transform = saved;
    return rect;
}

// 지금 실제로 적용돼있는 translateX 값을 읽는다(누적 이동을 위해 필요) - getComputedStyle 대신
// 인라인 style.transform 문자열을 직접 읽는다. 이 el(유닛 래퍼)의 transform은 이 파일의 tick()/
// applyKnockback()만 인라인으로 쓰고(둘 다 translateX(...) 형태), CSS 클래스/애니메이션은 이
// 래퍼가 아니라 자식 .battle-unit-img에만 걸리므로(예: walk-bob) 항상 정확하다. getComputedStyle은
// 호출할 때마다 강제 리플로우를 유발해서, 근접 유닛이 여러 명 동시에 걷는 매 프레임마다(tick())
// 성능에 큰 비용이었다(확인된 렉 원인) - style.transform은 그냥 문자열 읽기라 리플로우가 없다.
function getCurrentTranslateX(el) {
    const value = el.style.transform;
    if (!value) return 0;
    const match = value.match(/translateX\((-?[\d.]+)px\)/);
    return match ? Number(match[1]) : 0;
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
    const units = battleRendererConfig.units;
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

// 이도협 "돌직구" 전용 - applyKnockback과 달리 "상대 진영 방향으로 고정 거리만큼"이 아니라, 화면상의
// 특정 절대 x좌표(스트라이크 존이 새겨졌던 그 자리)로 되돌아가야 한다. 그래서 endX를 상대 거리가 아니라
// (지금 화면 중심 x와 목표 x의 차이)만큼의 델타로 계산해서 기존 translateX에 더한다 - 계산 방식만
// 다를 뿐 실제로 transform을 적용하는 방식(누적 translateX, 트랜지션 종료 후 정리)은 applyKnockback과 동일하다.
function pullUnitToScreenX(targetKey, targetScreenX, durationMs = 260) {
    const el = document.querySelector(`[data-unit="${targetKey}"]`);
    if (!el) return;
    const currentCenter = fieldRelativeCenter(el);
    const delta = targetScreenX - currentCenter.x;
    const startX = getCurrentTranslateX(el);
    const endX = startX + delta;
    el.style.transition = `transform ${durationMs}ms ease-out`;
    requestAnimationFrame(() => {
        el.style.transform = `translateX(${endX}px)`;
    });
    setTimeout(() => {
        el.style.transition = "";
    }, durationMs + 20);
}

// 근접 유닛이 targetKey에 "도착"했을 때의 마무리 처리를 한 곳에 모은다 - tick()이 gap을 재서 정상
// 도착한 경우와, 아래 waitForMeleeArrival의 타임아웃으로 강제 도착 처리된 경우가 모두 이걸 거쳐서
// 걷기 애니메이션 정지/자세 전환/방향 전환/대기 중인 공격 연출 재개를 항상 동일하게 수행한다.
function markMeleeArrived(key, targetKey) {
    const units = battleRendererConfig.units;
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
            imgEl.src = `${battleRendererConfig.outfitImageBase}${outfit}/idle.webp`;
        };
        imgEl.src = `${battleRendererConfig.outfitImageBase}${outfit}/battle_idle${variant}.webp`;
    }
    if (targetKey) faceToward(key, targetKey); // 도착하면 대상 쪽을 확실히 바라본다(등 뒤 대상 포함)
    (pendingArrivalResolvers[key] || []).forEach((resolve) => resolve());
    pendingArrivalResolvers[key] = [];
}

// 김현재 "방향 전환": 원거리 캐릭터인데 이 스킬을 쓰는 동안만 실제로 근접(is_melee=true)이 되어
// 적 쪽으로 걸어간다(백엔드 battle_core.compute_unit_stats/skill_handlers._skill_direction_shift와
// 동일한 전환). units[key].isMelee는 battle build 시점에 딱 한 번 정해지는 값이라 그것만 바꿔서는
// 이미 도는 중인 startMeleeWalker의 tick() 루프가 이 유닛을 새로 챙기지 못한다(meleeTargetKey에
// 아예 등록된 적이 없어 "목표 없음"으로 매번 건너뜀) - 그래서 근접으로 바뀌는 순간 tick()이 원래
// 전투 시작 시 근접 유닛에게 해주는 초기화(meleeTargetKey 배정 + meleeArrived=false)를 여기서
// 대신 해준다. 해제될 때는 반대로 걷기 애니메이션/등록을 전부 정리해서 tick()이 다시는 건드리지
// 않게 한다(위치 자체는 되돌리지 않는다 - 백엔드도 근접으로 이동한 위치를 그대로 유지함).
function khSetMeleeActive(key, active) {
    const units = battleRendererConfig.units;
    const unitInfo = units[key];
    if (!unitInfo) return;
    unitInfo.isMelee = active;
    if (active) {
        meleeTargetKey[key] = initialMeleeTargetKey(key);
        meleeArrived[key] = false;
    } else {
        delete meleeTargetKey[key];
        meleeArrived[key] = false;
        walkerSuspended[key] = false;
        stopWalkFrames(key);
        const el = document.querySelector(`[data-unit="${key}"]`);
        el?.querySelector(".battle-unit-img")?.classList.remove("walking");
    }
}

// 준비시간이 끝나면 호출됨. 모든 근거리 유닛의 최초 목표(적 전방)를 정해두고,
// 전투가 끝날 때까지 계속 도는 이동 루프를 시작한다.
function startMeleeWalker() {
    const units = battleRendererConfig.units;
    Object.keys(units).forEach((key) => {
        if (!units[key].isMelee) return;
        meleeTargetKey[key] = initialMeleeTargetKey(key);
        meleeArrived[key] = false;
    });

    walkerRunning = true;
    const myEpoch = ++walkerEpoch;
    let lastTickMs = null; // 실제 경과 시간(dt)을 재기 위한 기준 - 이전엔 매 rAF 호출마다 고정
    // 픽셀만큼 더해서 고주사율 모니터(120Hz 등)에서 더 빨리 걷는 문제가 있었다. dt를 실제로 재서
    // 곱하면 프레임률과 무관하게 항상 "초당 같은 거리"로 걷는다.

    function tick(now) {
        if (!walkerRunning || walkerEpoch !== myEpoch) return;

        // 탭이 백그라운드에 있다 돌아오는 등 dt가 비정상적으로 커지는 경우를 대비해 한 프레임치
        // (약 100ms) 이상은 걸음이 순간이동하지 않도록 클램프한다.
        const dt = lastTickMs === null ? 1 / 60 : Math.min(0.1, (now - lastTickMs) / 1000);
        lastTickMs = now;
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        const moveSpeedPxPerSec = viewportWidth * MOVE_SPEED_VW_PERCENT_PER_SEC / 100;

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
            if (imgEl && !imgEl.classList.contains("walking")) {
                if (reviveWalkTopZ[key]) {
                    // 부활 직후 첫 걷기 시작 - 일반 규칙(아래)을 타면 오래 진행된 전투일수록
                    // meleeWalkZCounter가 커져 있어 z-index가 거의 항상 1로 깎여서, 그 근처에
                    // 오래 전부터 서 있던 상대 뒤에 가려 보이지 않는다. 되살아난 순간만큼은
                    // 일반 카운터로 절대 도달 못 하는 MELEE_WALK_Z_BASE(=counter가 1일 때 나오는
                    // 39보다 항상 큼)로 못박아 반드시 앞에 보이게 한다.
                    delete reviveWalkTopZ[key];
                    el.style.zIndex = String(MELEE_WALK_Z_BASE);
                } else {
                    // 지금 막 정지 상태에서 걷기로 전환되는 순간(=새로 움직이기 시작)에만 z-index를
                    // 새로 찍는다 - 매 프레임 덮어쓰면 의미가 없다. 값을 점점 낮춰서, 더 나중에
                    // 걷기 시작한 유닛일수록 먼저 있던(또는 먼저 걷기 시작한) 유닛보다 뒤(아래)로
                    // 그려지게 한다(겹쳤을 때 나중에 온 쪽이 앞을 가리는 버그 수정).
                    meleeWalkZCounter += 1;
                    el.style.zIndex = String(Math.max(1, MELEE_WALK_Z_BASE - meleeWalkZCounter));
                }
            }
            if (imgEl) imgEl.classList.add("walking");
            // 걷기 전용 사진(walk_N.webp)이 있으면 그 프레임을 순환 재생 - 없는 캐릭터는 위의 walking
            // 클래스(bob 애니메이션)만 적용된 채로 원래처럼 걷는다(playWalkFrames 내부 폴백).
            if (!walkAnimActive[key]) {
                walkAnimActive[key] = true;
                playWalkFrames(key);
            }

            // 대상이 등 뒤에 있어도 그 방향으로 걸어간다(진행 방향 고정 없음). 이동 방향을 바라보게 반전.
            // 이번 프레임 이동량 = 초당 이동 픽셀(moveSpeedPxPerSec) x 실제 경과 시간(dt) x
            // (이 유닛의 실제 슬롯 속도 비율) x (지금 배속 / 튜닝 기준 배속). 마지막 항 덕분에 배속을
            // 올리면(playbackSpeed가 작아지면) 걷기도 같이 빨라지고, 기본 배속(MOVE_STEP_BASELINE_SPEED)
            // 에서는 항상 1이 곱해져 기존 체감 속도 그대로다.
            const speedScale = (units[key].meleeSpeedRatio || 1) * (battleRendererConfig.moveStepBaselineSpeed / battleRendererConfig.getPlaybackSpeed());
            const stepPx = moveSpeedPxPerSec * dt * speedScale;
            const step = Math.sign(gap) * Math.min(stepPx, Math.abs(gap));
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
    const units = battleRendererConfig.units;
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

// 근거리 유닛이 걷는 동안(startMeleeWalker의 tick) 반복 재생되는 걷기 프레임 애니메이션.
// playAttackFrames와 달리 "한 번" 재생하고 끝나는 게 아니라 도착할 때까지 프레임을 계속 순환한다.
// 토큰 방식은 동일 - stopWalkFrames가 토큰을 갈아치우면 다음 프레임 체크에서 루프가 스스로 멈춘다.
async function playWalkFrames(key) {
    const units = battleRendererConfig.units;
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
        imgEl.src = `${battleRendererConfig.outfitImageBase}${outfit}/walk${variant}_${frameIndex}.webp`;
        await sleep(WALK_FRAME_DURATION_MS);
        frameIndex = (frameIndex % frameCount) + 1;
    }
}

// 도착하거나(더 이상 걷지 않을) 다른 애니메이션으로 넘어갈 때 호출 - 토큰만 갈아치우면 진행 중이던
// playWalkFrames의 while 루프가 다음 프레임 대기 후 스스로 종료된다(별도 취소 신호 불필요).
function stopWalkFrames(key) {
    walkAnimTokens[key] = (walkAnimTokens[key] || 0) + 1;
    walkAnimActive[key] = false;
}

// 공격/스킬/복귀 프레임 재생 시 초당 재생 속도(고정 - 배속과 무관).
const ATTACK_FRAME_DURATION_MS = 60;
const RETURN_FRAME_DURATION_MS = 60; // 복귀 프레임은 서버가 시간을 안 주므로(시전 시간과 무관) 공격 프레임과 같은 고정 속도로 재생

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
    const units = battleRendererConfig.units;
    const attackAnimTokens = battleRendererConfig.attackAnimTokens;
    const attackAnimActive = battleRendererConfig.attackAnimActive;
    if (!key) return;
    attackAnimTokens[key] = (attackAnimTokens[key] || 0) + 1;
    attackAnimActive[key] = false;
    const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
    if (imgEl && units[key]) {
        imgEl.classList.remove("casting", "casting-rainbow", "attacking");
        imgEl.onerror = null;
        imgEl.src = `${battleRendererConfig.outfitImageBase}${units[key].outfit}/battle_idle${spriteVariantSuffix(key)}.webp`;
    }
}

// key(배우)별로 애니메이션 단계가 순서대로만 실행되도록 이어붙인다 - 전역 이벤트 커서는 이 반환값을
// 절대 기다리지 않는다(fire-and-forget). workFn에서 예외가 나도 체인이 영구히 끊겨서 이 배우의
// 이후 모든 애니메이션이 조용히 멈춰버리는 일이 없도록 흡수한다.
function chainActorAnim(key, workFn) {
    const actorAnimChain = battleRendererConfig.actorAnimChain;
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
    const attackAnimActive = battleRendererConfig.attackAnimActive;
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

async function playAttackFrames(key) {
    const units = battleRendererConfig.units;
    const attackAnimTokens = battleRendererConfig.attackAnimTokens;
    const attackAnimActive = battleRendererConfig.attackAnimActive;
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
            `${battleRendererConfig.outfitImageBase}${outfit}/attack${variant}_${i}.webp`;
        await sleep(ATTACK_FRAME_DURATION_MS);
    }

    if (attackAnimTokens[key] === myToken) {
        imgEl.onerror = () => {
            imgEl.onerror = null;
            imgEl.src = `${battleRendererConfig.outfitImageBase}${outfit}/idle.webp`;
        };

        imgEl.src =
            `${battleRendererConfig.outfitImageBase}${outfit}/battle_idle${variant}.webp`;
        attackAnimActive[key] = false;
    }
}

/*
 * 시전(캐스팅) 중 재생되는 프레임 애니메이션. 스킬 전용 프레임(skill_N.webp)이 있으면 그걸 우선 쓰고,
 * 없으면 기본공격 프레임(attack_N.webp)을 그대로 돌려쓴다. 짧은 프레임 묶음을 빠르게 반복 재생하는
 * 대신, 가진 프레임 수만큼을 시전 시간(durationMs) 전체에 고르게 늘려서 "한 번만" 재생한다 -
 * 그래서 시전이 길수록 프레임 하나하나가 더 천천히 넘어가고, 루프하는 느낌 없이 시전 시작부터
 * 끝까지 이어지는 애니메이션처럼 보인다.
 */
async function playCastFrames(key, durationMs) {
    const units = battleRendererConfig.units;
    const attackAnimTokens = battleRendererConfig.attackAnimTokens;
    const attackAnimActive = battleRendererConfig.attackAnimActive;
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

        imgEl.src = `${battleRendererConfig.outfitImageBase}${outfit}/${framePrefix}${variant}_${i}.webp`;
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
    const units = battleRendererConfig.units;
    const attackAnimTokens = battleRendererConfig.attackAnimTokens;
    const attackAnimActive = battleRendererConfig.attackAnimActive;
    if (!key || !units[key]) return;
    attackAnimTokens[key] = (attackAnimTokens[key] || 0) + 1;
    attackAnimActive[key] = false;
    const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
    if (imgEl) {
        imgEl.classList.remove("casting", "casting-rainbow");
        imgEl.onerror = null;
        imgEl.src = `${battleRendererConfig.outfitImageBase}${units[key].outfit}/battle_idle${spriteVariantSuffix(key)}.webp`;
    }
    flashEffectAura(key, "cc");
    battleRendererConfig.appendLog(`${units[key].name}의 [Active] 시전이 기절로 취소됐다!`, side);
}

/*
 * 시전 종료 직후 재생되는 복귀 애니메이션. 전용 프레임(return_N.webp)이 있는 캐릭터만 이 프레임들을
 * 순서대로(1→N) 한 번 재생한 뒤 battle_idle.webp로 정착한다. 서버가 이 동작의 시간을 따로 주지 않으므로
 * (시전 시간과 무관하게) 공격 프레임과 같은 고정 속도(RETURN_FRAME_DURATION_MS)로 재생한다.
 * 전용 프레임이 없는 캐릭터는 호출부가 기존처럼 battle_idle.webp로 바로 스냅한다(폴백, 이 함수는 안 씀).
 */
async function playReturnFrames(key) {
    const units = battleRendererConfig.units;
    const attackAnimTokens = battleRendererConfig.attackAnimTokens;
    const attackAnimActive = battleRendererConfig.attackAnimActive;
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

        imgEl.src = `${battleRendererConfig.outfitImageBase}${outfit}/return${variant}_${i}.webp`;
        await sleep(RETURN_FRAME_DURATION_MS);
    }

    if (attackAnimTokens[key] === myToken) {
        imgEl.onerror = () => {
            imgEl.onerror = null;
            imgEl.src = `${battleRendererConfig.outfitImageBase}${outfit}/idle.webp`;
        };

        imgEl.src = `${battleRendererConfig.outfitImageBase}${outfit}/battle_idle${variant}.webp`;
        attackAnimActive[key] = false;
    }
}

// ===== 이벤트 디스패치 시스템(playNext의 event_type 분기 이전) =====
// rangedResolvePending/meleeHitPending: attackAnimActive 등과 동일한 이유로 여전히
// arena-battle.js가 소유(anyActorStillFinishing이 거기서도 읽음) - config로 참조만 받는다.
    // 캐릭터별 성별 - 서민석 스킬(하트 색)처럼 대상 성별에 따라 연출이 갈리는 경우에 쓴다.
    // 이의진은 염색체 변환 스킬로 전투 중 성별이 바뀌므로, 이 표는 "기본값"일 뿐이고 실제 판정은
    // effectiveGender(key)가 battleRendererConfig.units[key].isType2를 함께 봐서 처리한다.
    const CHARACTER_GENDER = {
        "윤대웅": "남", "윤영준": "남", "김남옥": "여", "이종복": "남", "임소정": "여",
        "이영웅": "남", "불빠따 김어진": "남", "서민석": "남", "강승유": "남",
        "송주헌": "남", "최재혁": "남", "청년": "남", "강 희": "여", "이의진": "남",
        "윤 & 호": "여", // "윤" 본인 기준(소환수 "호"는 이 이름표를 안 쓰고 자기 이름 "호"로 별도 유닛이
        // 되므로, 여기 없는 이름은 effectiveGender가 "남"으로 폴백 - 호는 항상 남성으로 취급된다).
    };

    // 대상의 "지금 이 순간" 성별 - 이의진이 type2(염색체 변환) 상태면 CHARACTER_GENDER의 고정값 대신 "여"로 취급한다.
    function effectiveGender(name, key) {
        if (key && battleRendererConfig.units[key]?.isType2) return "여";
        return CHARACTER_GENDER[name] || "남";
    }
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
        if (event.effect_type === "team_type_hp_buff") {
            const typeLabel = { Teacher: "선생", Student: "학생", Parent: "부모" }[d.type] || d.type;
            return `${event.actor}의 [Special] 발동! 팀 내 ${typeLabel} 타입 캐릭터 최대 체력 ${d.hp_percent}% 증가`;
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
        if (event.effect_type === "gendered_ally_haste") {
            return `${event.actor}의 [Special] 발동! ${d.gender === "남" ? "남성" : "여성"} 아군 공격 속도 ${d.haste_percent}% 증가`;
        }
        return `${event.actor}의 [Special] 발동!`;
    }
    const SKILL_CARD_COOLDOWN_SECONDS = 1.5;
    function eventTargetKey(event) {
        const targetSide =
            event.side === "attacker" ? "defender" : "attacker";
        return findUnitKey(targetSide, event.target);
    }

    function eventActorKey(event) {
        // actor_slot(백엔드가 붙여주는 실제 슬롯)이 있으면 이름 대신 그걸로 특정한다 - 강승유가 윤&호의
        // "호 출격!"을 복제하면 한 팀에 이름이 "호"인 유닛이 두 개(원본 소환수 + 강승유의 복제 소환수)
        // 동시에 존재할 수 있는데, findUnitKey는 이름만 보고 항상 앞쪽 슬롯(summon-front)을 먼저
        // 찾아버려서 강승유의 복제 소환수가 실제로 공격/자폭해도 원본 소환수가 대신 반응하고, 정작
        // 강승유의 복제 소환수는 죽지도 않은 채 화면에 영원히 남아있는 버그가 있었다. actor_slot이
        // 없는(옛 저장된 전투 로그 등) 경우에만 기존 이름 기반 조회로 대체한다.
        if (event.actor_slot) {
            const slotKey = `${event.side}-${event.actor_slot.replace(/_/g, "-")}`;
            if (battleRendererConfig.units[slotKey]) return slotKey;
        }
        return findUnitKey(event.side, event.actor);
    }
    /*
     * 타격 로그: 이제 한 줄을 덮어쓰지 않고, 행동한 쪽 색으로 새 줄을 계속 추가한다.
     * 기본공격의 피해량 자체는 이제 로그에 안 띄운다(화면에 뜨는 피해 숫자 팝업과 중복돼 로그만
     * 지저분해짐) - 다만 피해 숫자만으로는 안 보이는 부가 정보(윤의 자가 회복/호의 자폭)가 있으면
     * 그 부분만 짧게 남긴다.
     */
    function showDamageMessage(event) {
        const parts = [];
        if (event.actor_self_heal) parts.push(`${event.actor} 자신 체력 ${event.actor_self_heal} 회복`);
        if (event.actor_self_destruct) parts.push(`${event.actor} 자폭`);
        if (!parts.length) return;
        battleRendererConfig.appendLog(parts.join(", "), event.side);
    }
    // 스킬 발동 로그에 실제 피해/효과를 덧붙이기 위한 요약 문구. hits(피해 이벤트 배열)를
    // "OOO에게 123만큼 피해(치명타!), XXX에게 45만큼 피해" 식으로 이어붙인다.
    // 실드에 완전히 막혀 실제 피해(hit.damage)가 0이어도, 로그/피해 숫자 표시는 막히기 전 원래
    // 위력(hit.shown_damage - backend/battle_core.py _apply_damage 참고)을 보여준다 - "공격이 허공에
    // 씹힌 것처럼" 안 보이게. HP바 계산처럼 실제 값이 반드시 필요한 곳(gptDisplayHp/bulletDisplayHp
    // 등)은 이 필드를 쓰지 않고 계속 hit.damage(진짜 값)를 그대로 쓴다.
    function hitsSummaryText(hits) {
        if (!hits || !hits.length) return "";
        return hits
            .map((hit) => `${hit.target}에게 ${hit.shown_damage ?? hit.damage}만큼 피해${hit.is_crit ? "(치명타!)" : ""}`)
            .join(", ");
    }
    const MOMENT_ICON_MS = 1200; // 순간 효과(회복, 넉백)는 이 시간만 표시됐다가 사라짐
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
        // 전장 스탠딩(.is-clone)과 동일한 조건(위 summon_clone 핸들러 참고) - 다만 국회의사당처럼 자기만의
        // 실제 그림을 가진 고유 소환수(skipCloneTint)는 "복제/재현"이 아니므로 이 홀로그램 틴트를 건너뛴다.
        rosterEl.querySelector(".roster-unit-img")
            ?.classList.toggle("roster-clone-img", !unit.skipCloneTint && (!unit.spriteVariant || unit.isCopy));
        clearAllStatusIcons(cloneKey);

        // 새로 생긴 행은 폴링(최대 450ms)을 기다리지 않고 즉시 전방/중방/후방 순서에 맞춰 자리잡는다.
        if (isNewRow) reorderRoster(side);
    }
    // ===== 전투 중 위치에 따른 전방/(중방)/후방 판정 + 로스터 정렬 =====
    // 아군은 오른쪽(x가 클수록)이 전방, 적군은 왼쪽(x가 작을수록)이 전방이다. 복제체가 나와 있으면
    // 3명이 전방/중방/후방으로 나뉜다(전투 중 실제 위치 순서). 로스터는 전방이 위, 후방이 아래로
    // 정렬되고, 순서가 바뀌면 두 줄이 부드럽게 자리를 서로 바꾼다. 죽은 유닛은 항상 맨 아래로 보낸다.
    const lastRosterOrder = { attacker: "", defender: "" };
    // battle_core.py의 position_settled_at 타이브레이커와 동일한 목적 - 화면 좌표만으로 정렬하면
    // 어떤 유닛이 다른 유닛의 자리로 걸어 들어와 위치가 같아지는 순간, 실제로는 그쪽이 "더 늦게
    // 도착"했음에도 픽셀 비교 결과에 따라 전방으로 표시될 수 있다(예: 후방 유닛이 전방 유닛 자리로
    // 걸어오면 후방이 되어야 하는데 전방으로 뜨는 버그). 유닛별로 화면 중심 좌표가 마지막으로 "바뀐"
    // 시각을 기록해두고, 좌표가 사실상 같은 두 유닛끼리는 더 늦게 자리 잡은 쪽을 후방으로 정렬한다.
    const ROSTER_POSITION_TIE_EPSILON = 2; // px
    const lastCenter = {};
    const settledAt = {};

    function computeFrontToBackOrder(side) {
        const keys = Object.keys(battleRendererConfig.units).filter((key) => {
            if (!key.startsWith(side) || !battleRendererConfig.units[key]) return false;
            if (!document.querySelector(`[data-roster="${key}"]`)) return false;
            const battleEl = document.querySelector(`[data-unit="${key}"]`);
            return battleEl && !battleEl.hidden;
        });

        const centers = {};
        keys.forEach((key) => {
            const el = document.querySelector(`[data-unit="${key}"]`);
            const rect = el ? el.getBoundingClientRect() : null;
            const center = rect ? rect.left + rect.width / 2 : 0;
            centers[key] = center;
            if (lastCenter[key] === undefined || Math.abs(lastCenter[key] - center) > ROSTER_POSITION_TIE_EPSILON) {
                lastCenter[key] = center;
                settledAt[key] = performance.now();
            }
        });

        keys.sort((a, b) => {
            // battleRendererConfig.units[key].hp는 그 유닛을 죽인 이벤트가 "처리"되는 즉시(윈드업/투사체 이동 등 실제
            // 타격 연출이 재생되기 한참 전에) 동기로 이미 0 이하로 갱신돼 있다(데이터는 즉시 반영,
            // 연출만 지연 - 이 프로젝트 전반의 설계 원칙). 여기서 곧바로 hp<=0을 죽음 판정으로 쓰면,
            // 이 정렬이 450ms 주기 타이머(startRosterOrderWatcher)로 아무 때나 돌기 때문에 화면에서는
            // 아직 멀쩡히 서서 공격받는 중인(사망 연출 시작 전) 캐릭터가 로스터에서 먼저 맨 뒤로
            // 밀려나 보이는 버그가 있었다. deathHandled는 renderUnit이 실제로 playDeathSequence를
            // 재생시키는 바로 그 순간에만 true가 되므로(부활하면 다시 false), 화면에 실제로 죽은
            // 것처럼 보이는 시점과 항상 일치한다.
            const deadA = battleRendererConfig.deathHandled[a] ? 1 : 0;
            const deadB = battleRendererConfig.deathHandled[b] ? 1 : 0;
            if (deadA !== deadB) return deadA - deadB;
            const posDiff = side === "attacker" ? centers[b] - centers[a] : centers[a] - centers[b];
            if (Math.abs(posDiff) > ROSTER_POSITION_TIE_EPSILON) return posDiff;
            // 위치가 사실상 같으면(같은 자리로 걸어옴) 더 늦게 도착한 쪽이 후방(나중 정렬)이 되도록.
            return (settledAt[a] || 0) - (settledAt[b] || 0);
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
    // 스킬 발동(skill_resolve)의 detail.hits[]에 담긴 피해를 대상들에게 반영하고 화면을 갱신한다.
    // side가 주어지면(백엔드가 각 대상에 붙여 보내는 target_side) 그 편에서만 이름을 찾는다 - 이름만으로
    // 양쪽을 다 찾으면(과거 방식) 같은 캐릭터가 양 팀에 모두 있을 때(미러/유사 편성) 항상 attacker 쪽이
    // 먼저 걸려서, 실제로는 적이 맞았는데 화면에는 엉뚱하게 아군이 맞고 죽었다가(다음 갱신에서 원래
    // 체력으로) 되살아난 것처럼 보이는 버그가 있었다. side가 없는 옛 이벤트/호출부만 양쪽 폴백 검색한다.
    function findHitKey(name, side) {
        if (side) return findUnitKey(side, name);
        return findUnitKey("attacker", name) || findUnitKey("defender", name);
    }
    // 배 "개량한복": 대상이 이 타격으로 막 체력 50% 미만이 됐을 때(백엔드가 hit/이벤트에 실어보내는
    // low_hp_shield_seconds) 무적 이펙트(흰색 스페셜 오라 + immune 아이콘)를 재생한다. low_hp_shield_resolve
    // 이벤트(신 등 별도 스킬 경로 - 매 틱 스윕으로 폴백 감지)와 동일한 연출을 공유하되, 이건 그 원인이 된
    // 타격 자신의 착탄 콜백(applyHitVisual/onLetterArrive/스플래시 onLand)에서 직접 불러서, 기본공격의
    // 윈드업/투사체 이동 시간이 끝나기도 전에 무적 아이콘이 먼저 떠버리던 버그 없이 실제 타격이 화면에
    // 닿는 순간과 정확히 같이 뜬다. untilSimTime은 여전히 그 타격의 진짜 백엔드 시각(simTime) 기준으로
    // 계산한다 - 여기서 실제로 "언제 호출되는지"(윈드업만큼 늦어진 실시간)는 무관하고, 지금 이 순간이
    // 시뮬레이션상 몇 초인지만 중요하다(armSimTimer가 알아서 남은 실시간으로 환산).
    function grantLowHpShieldVisual(targetKey, targetName, seconds, simTime) {
        if (!targetKey || !seconds) return;
        flashEffectAura(targetKey, "special");
        setStatusIcon(targetKey, "immune", {
            source: `${targetKey}:low_hp_shield`,
            untilSimTime: simTime + seconds,
        });
        battleRendererConfig.appendLog(`배의 [Passive] 발동! ${targetName} ${seconds}초간 무적`, "trait");
    }
    function applySkillHits(event) {
        const hits = event.detail?.hits || [];
        hits.forEach((hit) => {
            const hitKey = findHitKey(hit.target, hit.target_side);
            if (!hitKey) return;
            battleRendererConfig.units[hitKey].hp = hit.target_hp_after;
            if (hit.target_shield_after !== undefined) {
                const shieldBefore = battleRendererConfig.units[hitKey].shield || 0;
                battleRendererConfig.units[hitKey].shield = hit.target_shield_after;
                if (shieldBefore > 0 && hit.target_shield_after <= 0) playShieldHit(hitKey);
            }
            renderUnit(hitKey);
            flashHit(hitKey, hit.is_crit, hit.type_multiplier, hit.shown_damage ?? hit.damage, hit.invincible_block);
        });
    }
    // 투사체/캔버스 연출(운석, 가스 숨결, 땅불, 물감 등)이 실제로 대상에 "도착"하는 순간까지 화면
    // 반영(렌더/피격 이펙트)을 늦추는 스킬들 전용 - HP 자체는 이 함수로 이벤트 처리 시점에 곧바로
    // (지연 없이) 반영해서 다른 이벤트와의 순서가 절대 꼬이지 않게 하고, 그 직전에 이미 죽어있었는지도
    // 함께 캡처해서 반환한다. 도착 콜백은 이 반환값이 true면 렌더/이펙트를 건너뛰어야 한다 - 안 그러면
    // 그 사이 다른(더 빠른) 이벤트가 같은 대상을 먼저 죽였을 때, 뒤늦게 도착한 이 연출이 죽기 전의
    // 과거 HP 값으로 덮어써서 이미 쓰러진 캐릭터가 되살아나 보이는 버그가 생긴다.
    function captureAndApplyHp(targetKey, newHp, newShield) {
        if (!targetKey || !battleRendererConfig.units[targetKey]) return true;
        const wasAlreadyDead = battleRendererConfig.units[targetKey].hp <= 0;
        // 이미 죽어있었다면 이 갱신은 적용하지 않는다 - "이미 죽어있다"는 건 시간상 이 이벤트보다
        // 나중인(하지만 연출 지연 때문에 화면엔 더 먼저 도착한) 다른 이벤트가 이미 이 유닛을 죽였다는
        // 뜻이라, 이 값을 덮어쓰면 죽은 유닛이 이 낡은 hp로 "부활"해버린다. 그러면 정작 진짜로 죽인
        // 이벤트 자신의 renderUnit이 나중에 실행될 때 hp가 이미 0이 아니게 되어 있어서, 사망 연출이
        // 영영 재생되지 않는 버그로 이어진다(김룡환 "Perfect" 폭탄 라인처럼 각 타격의 착탄을 실제
        // 이벤트 시각보다 늦게 재생하는 스킬에서 실제 배틀로그로 재현/확인됨 - 폭탄은 t=7.15에 강 희를
        // 240까지 깎았지만 화면엔 그보다 한참 늦게 착탄해서, 그사이 t=7.5의 진짜 킬(F=ma 마지막 탄환,
        // hp=0)을 뒤늦게 덮어써버렸다). 호출부는 이 반환값으로 이미 렌더/이펙트를 건너뛰므로, 데이터도
        // 함께 보존해야 그 판단과 실제 상태가 어긋나지 않는다.
        if (!wasAlreadyDead) {
            battleRendererConfig.units[targetKey].hp = newHp;
            // newShield는 보호막이 있는 스킬 결과에만 실려온다(target_shield_after) - 없는 이벤트(예: 회복)는
            // undefined를 넘기므로, 이미 알고 있던 값을 그대로 둔다(0으로 잘못 리셋하지 않는다).
            if (newShield !== undefined) {
                const shieldBefore = battleRendererConfig.units[targetKey].shield || 0;
                battleRendererConfig.units[targetKey].shield = newShield;
                if (shieldBefore > 0 && newShield <= 0) playShieldHit(targetKey);
            }
        }
        return wasAlreadyDead;
    }

function dispatchEvent(event) {
    const eventType = event.event_type || "basic_attack";

    if (eventType === "star_effect_resolve") {
        // 성급별 효과(전투 시작 시 1회) - 스탯이 오르내린 대상마다 해당 상태 아이콘을 켠다.
        // 전투 내내 유지되는 영구 효과라 지속시간 없이 전투가 끝날 때까지(사망 전까지) 계속 떠 있는다.
        // source = "시전자:효과타입" - 성급 효과는 전투 시작 시 1회만 발동하므로 재적용(갱신)은
        // 없고, 서로 다른 캐릭터의 성급 효과가 같은 대상에게 겹칠 때만(source가 달라짐) 중첩된다.
        applyStatChangeIcons(event.detail?.changes, `${event.actor}:${event.effect_type}`);
    } else if (eventType === "trait_resolve") {
        // 전투 시작과 동시에 1회만 판정되는 특성. 아이콘은 star_effect_resolve와 완전히 같은 방식으로
        // event.detail.changes(백엔드 build_stat_change_dicts)를 범용 처리한다(applyStatChangeIcons) -
        // 캐릭터별 effect_type 분기를 프론트에 손으로 추가할 필요가 없어서, 새 캐릭터를 추가해도
        // 백엔드 changes만 제대로 채워지면 아이콘 누락이 구조적으로 생기지 않는다. 스탯 변화가 아닌
        // 특수 처리(파트너 제거)만 effect_type별로 남겨둔다.
        if (event.effect_type === "ally_synergy_remove_absorb" && event.detail?.removed) {
            // 윤대웅(도플갱어): 파트너를 제거(사망 처리) - 흡수 버프 자체는 changes로 아이콘화됨.
            const removedKey = findUnitKey(event.side, event.detail.removed);
            if (removedKey) {
                battleRendererConfig.units[removedKey].hp = 0;
                renderUnit(removedKey);
            }
        }
        applyStatChangeIcons(event.detail?.changes, `${event.actor}:${event.effect_type}`);
        battleRendererConfig.appendLog(traitLogText(event), "trait");
    } else if (eventType === "periodic_star_resolve" && event.effect_type === "periodic_heal_random_striker" && event.detail?.target) {
        // 신 "제 1 권한": 전투 시작 1회가 아니라 배틀 내내 N초마다 반복되는 성급 효과라
        // star_effect_resolve(1회성 스탯 아이콘)와는 별개 이벤트 타입으로 온다. 연출은 이영웅
        // "청진기 진료"(heal_ally_percent_max_hp)와 동일한 하트 낙하(spawnHealingHeart)를 그대로
        // 재사용 - 대상이 매번 서포터 자신이 아니라 랜덤 아군 한 명뿐이라는 점만 다르다.
        // missed(대상이 아직 이동 중이라 하트가 안 맞음)면 하트는 그대로 떨어뜨리되 착지 효과
        // (체력 갱신/오라/상태 아이콘)는 내지 않는다 - _star_periodic_heal_random_striker 참고.
        const healTargetKey = findUnitKey(event.side, event.detail.target);
        if (healTargetKey) {
            if (!event.detail.missed) {
                // unit.hp는 다른 이벤트와의 순서 보장을 위해 지금 즉시 반영해야 하지만, 화면은 하트가
                // 착지할 때까지 예전 값을 보여줘야 한다(확인된 버그 - 하트가 날아가는 중에 이 대상을
                // 겨냥한 다른 이벤트가 renderUnit(healTargetKey)를 부르면 아직 하트가 도착 전인데도
                // 이미 채워진 체력이 그대로 드러났다). setPendingDisplayHp로 회복 전 값을 표시용으로
                // 고정해두고, 착지 콜백에서 clearPendingDisplayHp로 풀어야 진짜 unit.hp가 다시 보인다.
                setPendingDisplayHp(healTargetKey, battleRendererConfig.units[healTargetKey].hp);
                battleRendererConfig.units[healTargetKey].hp = event.detail.target_hp_after;
            }
            spawnHealingHeart(healTargetKey, () => {
                if (event.detail.missed) return;
                clearPendingDisplayHp(healTargetKey);
                renderUnit(healTargetKey);
                flashEffectAura(healTargetKey, "heal");
                setStatusIcon(healTargetKey, "heal", { source: `${event.actor}:periodic_heal`, durationMs: MOMENT_ICON_MS });
            });
        }
        battleRendererConfig.appendLog(
            `${event.actor}의 [Passive] 발동! ${event.detail.target} ${event.detail.missed ? "이동 중이라 회복 실패" : `${event.detail.healed} 회복`}`,
            event.side
        );
    } else if (eventType === "periodic_trait_resolve" && event.effect_type === "periodic_shield_random_non_type_striker" && event.detail?.target) {
        // 신 "제 3 권한": 위 제 1 권한과 같은 이유로 trait_resolve(1회성)와 분리된 신규 이벤트 타입.
        // 연출은 김크장 "외국인 노동자"(전투 시작 시 보호막)와 동일한 방식(applyStatChangeIcons의
        // shield_after 처리 참고) - 보호막 바를 즉시 갱신하고 playShieldPop으로 새로 걸린 순간만
        // 강조한다. 지속되는 상태 아이콘은 따로 없다(보호막 바 자체가 상태 표시).
        const shieldTargetKey = findUnitKey(event.side, event.detail.target);
        if (shieldTargetKey) {
            battleRendererConfig.units[shieldTargetKey].shield = event.detail.target_shield_after;
            renderUnit(shieldTargetKey);
            playShieldPop(shieldTargetKey);
            flashEffectAura(shieldTargetKey, "buff");
        }
        battleRendererConfig.appendLog(`${event.actor}의 [Special] 발동! ${event.detail.target} 보호막 ${event.detail.shield_amount} 부여`, event.side);
    } else if (eventType === "ally_attack_splash_resolve" && event.detail?.hits?.length) {
        // 김국회 "일당 독재": 아군 STRIKER가 기본공격할 때마다 그 대상이 아닌 다른 적 전원에게
        // 추가로 대포알 스플래시가 들어간다. 서포터 본인(김국회)은 전장에 스프라이트가 없으므로
        // eventActorKey가 못 찾아 null을 주고, spawnCannonShellProjectile이 김크장의 GPT 킬러와
        // 동일한 화면 가장자리 폴백으로 발사한다(공격한 아군의 위치가 아니라 항상 김국회 고정 자리).
        const sourceKey = eventActorKey(event);
        event.detail.hits.forEach((hit) => {
            const hitKey = findHitKey(hit.target, hit.target_side);
            if (!hitKey) return;
            const wasAlreadyDead = captureAndApplyHp(hitKey, hit.target_hp_after, hit.target_shield_after);
            const onLand = () => {
                if (wasAlreadyDead) return;
                renderUnit(hitKey);
                flashHit(hitKey, hit.is_crit, hit.type_multiplier, hit.shown_damage ?? hit.damage, hit.invincible_block);
                // 배 "개량한복" - 이 스플래시 포탄이 실제로 착탄하는 이 순간에 맞춰 무적 이펙트도 함께.
                grantLowHpShieldVisual(hitKey, hit.target, hit.low_hp_shield_seconds, event.time);
            };
            spawnCannonShellProjectile(sourceKey, hitKey, onLand, event.side);
        });
        battleRendererConfig.appendLog(`${event.actor}의 [Passive] 발동! ${hitsSummaryText(event.detail.hits)}`, event.side);
    } else if (eventType === "summon_expire_resolve") {
        // 김국회 "국회의사당": 20초 지속시간이 다 되면 전투 결과와 무관하게 자동으로 사라진다 -
        // 죽었을 때와 동일하게 hp를 0으로 반영해서 기존 사망 렌더링(퇴장 페이드 등)을 그대로 태운다.
        const expiredKey = eventActorKey(event);
        if (expiredKey && battleRendererConfig.units[expiredKey]) {
            battleRendererConfig.units[expiredKey].hp = 0;
            renderUnit(expiredKey);
        }
        battleRendererConfig.appendLog(`${event.actor}, 지속시간 종료로 퇴장`, event.side);
    } else if (eventType === "cost_init") {
        initCostSide(event);
    } else if (eventType === "cost_rate_change") {
        anchorCost(event.side, event.cost_pool, event.time);
        const st = costState[event.side];
        if (st) st.secondsPerPoint = event.seconds_per_point;
    } else if (eventType === "cost_turn_skip") {
        // 카드의 회색(막힘) 표시 자체는 renderCostSide가 매 프레임 statusIconState의 stun 아이콘을
        // 직접 확인해서 실시간으로 처리한다(코스트가 다 찼어도 기절 중이면 0%처럼 계속 회색, CC가
        // 풀리는 순간 바로 원래 색으로) - 여기서는 풀 값 보정만 한다. 로그는 남기지 않는다(확인된
        // 설계 - 스킬카드 쿨다운(1.5초)까지 이 이벤트를 쓰게 되면서 너무 자주 발생해 로그가 도배됨).
        anchorCost(event.side, event.cost_pool, event.time);
    } else if (eventType === "cast_start") {
        if (event.cost_pool != null) {
            anchorCost(event.side, event.cost_pool, event.time);
            flashCostCard(event.side, event.actor_slot, "is-firing");
        }
        const actorKey = eventActorKey(event);
        if (actorKey) {
            // 이 시전을 지금(디스패치 시점) 토큰으로 못박아둔다 - interruptCasting은 배우 체인을
            // 거치지 않고 즉시(동기적으로) 실행되므로, 이 클로저가 체인에서 자기 차례를 기다리는
            // 동안 다른 배우의 CC가 이 배우를 기절시켜 시전이 취소될 수 있다. 그때 interruptCasting이
            // battleRendererConfig.attackAnimTokens[actorKey]를 올리므로, 아래에서 실제로 시작하기 직전 토큰이 그대로인지
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
            const castDispatchToken = battleRendererConfig.attackAnimTokens[actorKey] || 0;
            // 시전 자세/애니메이션은 이 배우 전용 체인에 매달아둔다 - waitForAnimIdle이 이 배우 자신의
            // 직전 애니메이션(예: 방금 3번째 기본공격 윈드업)이 끝날 때까지만 기다리고, 다른 배우의
            // 이벤트 처리는 전혀 막지 않는다(전역 커서는 이 체인을 기다리지 않고 곧바로 다음 이벤트로).
            chainActorAnim(actorKey, async () => {
                await waitForAnimIdle(actorKey);
                if (battleRendererConfig.attackAnimTokens[actorKey] !== castDispatchToken) return;
                const castStartImgEl = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
                castStartImgEl?.classList.add("casting");
                // 강승유 전용: 시전 중에는 금빛 펄스 대신 무지개빛으로 물든다.
                if (event.actor === "강승유") castStartImgEl?.classList.add("casting-rainbow");
                await playCastFrames(actorKey, event.duration * 1000 * battleRendererConfig.getPlaybackSpeed());
            });
        }
        // 로그는 체인 밖에서 즉시 남긴다 - 안 그러면 이 배우의 체인이 밀려있는 동안 다른 배우의
        // 나중 이벤트 로그가 먼저 찍혀서 시간 순서가 뒤바뀐다.
        battleRendererConfig.appendLog(`${event.actor}, [Active] 시전 중...`, event.side);
    } else if (eventType === "skill_resolve") {
        const actorKey = eventActorKey(event);
        // 강승유(copy_target_skill)는 event.effect_type이 항상 "copy_target_skill"로 찍히지만,
        // 실제로 복제한 원본 효과 이름은 detail.copied_effect_type에 들어있다 - 그게 있으면 그걸
        // 기준으로 연출을 분기해서, 복제한 스킬의 실제 전용 이펙트가 원본과 동일하게 나오게 한다.
        // (복제할 스킬이 없어 단순 피해로 폴백된 경우엔 copied_effect_type이 없으므로 그대로 event.effect_type을 쓴다.)
        const dispatchEffectType = event.detail?.copied_effect_type || event.effect_type;

        // 스킬카드 연속 사용 방지 - battle_engine._tick_team_cost의 SKILL_CARD_COOLDOWN_SECONDS
        // 게이트와 동일한 값/기준 시점(스킬이 실제로 완료되는 skill_resolve)으로 쿨다운을 건다.
        // actor_slot이 코스트 카드 슬롯 이름(front/back/supporter)과 그대로 일치한다.
        if (event.actor_slot) {
            cardCooldownUntil[`${event.side}-${event.actor_slot}`] = event.time + SKILL_CARD_COOLDOWN_SECONDS;
        }

        // 이의진 "염색체 변환": 복귀 애니메이션(아래 playReturnFrames)이 전환 "후" 모습으로 재생돼야
        // 하므로, return 프레임을 부르기 전에 상태부터 반영해둔다 - spriteVariantSuffix가 이 값을 본다.
        if (dispatchEffectType === "self_type_swap_heal" && actorKey && battleRendererConfig.units[actorKey]) {
            battleRendererConfig.units[actorKey].isType2 = !!event.detail?.type2_active;
        }

        if (actorKey) {
            // "시전 자세 풀기 + 복귀 애니메이션"만 이 배우 전용 체인에 매달아둔다(순수 스프라이트
            // 연출이라 데이터 의존이 없다) - 상태 아이콘/오라 등 나머지는 지금처럼 즉시 반영한다.
            // 안 그러고 이 skill_resolve 전체를 체인에 매달면, 이 배우의 체인이 밀려있는 동안
            // 무관한 다른 배우가 같은 대상을 먼저/나중에 때리는 이벤트가 끼어들 때 체력이 과거
            // 값으로 되돌아가는 회귀가 생길 수 있다. cast_start 때 이미 같은 체인에 playCastFrames가
            // 매달려 있으므로, 체인 순서 자체가 "그게 끝나야 복귀 애니메이션 시작"을 보장한다 -
            // 복귀 전용 프레임(return_N.webp)이 있으면 그걸 재생하고, 없는 캐릭터는 playReturnFrames
            // 내부에서 프레임 0장으로 판정되어 곧바로 battle_idle.webp로 스냅한다(기존과 동일).
            if (battleRendererConfig.units[actorKey]) {
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
                // 커지는 것으로 처리한다 - 실제로 스택 수만큼 커지는 걸 정확히 반영. 아이콘은 stat에 따라
                // 공격력(atk_up)/공격속도(atk_speed_up, 확인된 요청으로 기본값이 됨)를 구분한다.
                flashEffectAura(actorKey, "buff");
                const stackIcon = event.detail.stat === "haste" ? "atk_speed_up" : "atk_up";
                setStatusIcon(actorKey, stackIcon, { source: `${actorKey}:self_stack_buff`, weight: event.detail.stack_count });
            }

            if (dispatchEffectType === "self_shield_duration" && event.detail?.shield_seconds) {
                flashEffectAura(actorKey, "special"); // 무적(실드) = 스페셜(흰색)
                setStatusIcon(actorKey, "immune", {
                    source: `${actorKey}:self_shield_duration`,
                    untilSimTime: event.time + event.detail.shield_seconds,
                });
            }

            if (dispatchEffectType === "cost_reduction_grant" && event.detail?.granted) {
                // 안지석 "예산 재배정": 대상은 항상 시전자 자신의 팀(own_team) 소속이라 event.side를
                // 그대로 대상의 side로 쓴다(target_slot으로 슬롯까지 특정되므로 이름 충돌 걱정도 없음).
                // 코스트 카드 숫자를 즉시 줄이고, 실제 상태 효과 취급이라는 확인된 요청에 따라 카드
                // 배지에 빛나는 파란 글로우(is-cost-reduced)와 로스터 상태 아이콘을 함께 켠다.
                const targetSlot = event.detail.target_slot;
                if (targetSlot) {
                    setCostCardCost(event.side, targetSlot, event.detail.reduced_cost);
                    const targetKey = `${event.side}-${targetSlot}`;
                    const dock = document.getElementById(`cost-dock-${event.side}`);
                    dock?.querySelector(`[data-cost-slot="${targetSlot}"]`)?.classList.add("is-cost-reduced");
                    setStatusIcon(targetKey, "cost_reduction", { source: `${targetKey}:cost_reduction`, weight: event.detail.uses });
                }
            }

            if (dispatchEffectType === "self_cost_scaling_strike" && event.detail?.caster_hp_after != null) {
                // 김지섭 "핏값": summon_clone의 caster_hp_after 처리(윤 "호 출격!")와 동일한 패턴 -
                // 자기 체력을 대가로 치른 걸 파란(debuff) 오라로 보여준다. 대상 쪽 피해는 특별한 처리가
                // 필요 없는 평범한 단일 타격이라, 아래 큰 분기의 기본(else) 경로가 applySkillHits로
                // 그대로 처리한다.
                const selfCostCaster = battleRendererConfig.units[actorKey];
                if (selfCostCaster) {
                    selfCostCaster.hp = event.detail.caster_hp_after;
                    renderUnit(actorKey);
                    flashEffectAura(actorKey, "debuff");
                }
            }

            if (dispatchEffectType === "conditional_target_debuff") {
                // 김남옥: 공격속도 증가는 대상 성별과 무관하게 항상 자신에게 적용되는 버프.
                // source를 자기 자신 고정으로 두어, 반복 시전은 "갱신"으로만 처리되고 중첩되지 않는다.
                flashEffectAura(actorKey, "buff");
                setStatusIcon(actorKey, "atk_speed_up", {
                    source: `${actorKey}:haste`,
                    ...(event.detail?.haste_seconds ? { untilSimTime: event.time + event.detail.haste_seconds } : {}),
                });
            }

            // 복제체(윤영준/강승유)는 기존 전방/후방을 대체하지 않는 추가 유닛 - 시전자 전용 summon 슬롯에
            // 매번 새로 생성한다(clone_slot이 "summon-front"/"summon-back"으로 시전자의 자리를 알려준다).
            // (이미 그 슬롯에 이전 복제체가 있었다면 detail.replaced에 이름이 담겨오지만, 살아있는 아군이 제거되는 일은 없다.)
            if (dispatchEffectType === "summon_clone" && event.detail?.summoned) {
                const cloneKey = `${event.side}-${event.detail.clone_slot || "summon"}`;
                const caster = battleRendererConfig.units[actorKey];

                // 윤(호 출격!): 소환 대가로 자신의 현재 체력을 소모하는 경우(hp_cost_percent가 있는
                // 캐릭터만 해당 - caster_hp_after가 있을 때만) 체력바를 즉시 반영하고 회복과 구분되는
                // 파란(debuff) 오라로 "대가를 치렀다"는 걸 보여준다.
                if (caster && event.detail.caster_hp_after != null) {
                    caster.hp = event.detail.caster_hp_after;
                    renderUnit(actorKey);
                    flashEffectAura(actorKey, "debuff");
                }

                battleRendererConfig.units[cloneKey] = {
                    name: event.detail.clone_name,
                    maxHp: event.detail.clone_hp,
                    hp: event.detail.clone_hp,
                    isMelee: caster ? caster.isMelee : true,
                    // 복제체도 시전자가 서있던 슬롯(전방/후방)의 실제 시뮬레이션 이동 속도 비율을
                    // 그대로 물려받는다 - 백엔드도 clone dict의 melee_speed를 caster에서 그대로
                    // 복사해 쓰므로(skill_handlers.py) 화면과 시뮬레이션이 계속 같은 값을 본다.
                    meleeSpeedRatio: caster ? caster.meleeSpeedRatio : 1,
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
                // 애니메이션 클로저가 나중에 실행되며 battleRendererConfig.units[cloneKey](이미 새 복제체로 바뀜)를
                // 잘못 건드리거나, 새 복제체가 이전 점유자의 밀려있던 체인 뒤에서 최대 수백ms 동안
                // 멈춰 보일 수 있다.
                battleRendererConfig.attackAnimTokens[cloneKey] = (battleRendererConfig.attackAnimTokens[cloneKey] || 0) + 1;
                battleRendererConfig.attackAnimActive[cloneKey] = false;
                battleRendererConfig.rangedResolvePending[cloneKey] = false;
                battleRendererConfig.meleeHitPending[cloneKey] = false;
                delete battleRendererConfig.actorAnimChain[cloneKey];
                delete walkerSuspended[cloneKey];
                getAttackFrameCount(battleRendererConfig.units[cloneKey].outfit);
                ensureSummonRosterRow(cloneKey, battleRendererConfig.units[cloneKey]);
                battleRendererConfig.deathHandled[cloneKey] = false;
                renderUnit(cloneKey);
                // "복제" 계열(윤영준의 복제체, 강승유가 복제한 스킬의 결과물)은 전체적으로 푸른
                // 색감이 돌도록(3D 프린트 홀로그램 느낌) - 다만 윤의 "호"는 복제가 아니라 소환이라
                // 전용 스프라이트(spriteVariant)가 있으면 원래 색 그대로 두고, 그 "호"를 강승유가
                // 복제한 경우(isCopy)에는 소환이 아니라 복제이므로 자기 그림이 있어도 틴트를 씌운다.
                // toggle로 명시적 on/off를 주는 이유는 이 자리에 다른 소환 특성의 결과물이
                // 재소환돼도 이전 틴트 상태가 안 남게 하기 위함.
                document.querySelector(`[data-unit="${cloneKey}"] .battle-unit-img`)
                    ?.classList.toggle("is-clone", !battleRendererConfig.units[cloneKey].spriteVariant || battleRendererConfig.units[cloneKey].isCopy);
                // 호처럼 다른 스프라이트와 겹쳐도 항상 그 위에 그려져야 하는 소환수 - 히트박스
                // 엘리먼트(.battle-unit) 자체에 z-index를 고정으로 올리는 클래스를 토글한다.
                document.querySelector(`[data-unit="${cloneKey}"]`)
                    ?.classList.toggle("render-on-top", Boolean(event.detail.clone_render_on_top));

                // 근거리 복제체는 다른 근접 유닛과 완전히 동일하게 취급한다 - meleeArrived를 false로
                // 두면 이동 루프(tick)가 다음 프레임에 실제 겹침 여부를 직접 재서 판정하고, 도착으로
                // 확인되는 순간에만 faceToward를 걸고 공격을 허용한다(waitForMeleeArrival이 그 전까지
                // 공격 자체를 막는다). 이제 시전자 자리에서 스폰되므로(적 자리가 아님) 다른 근접
                // 유닛과 마찬가지로 실제로 걸어서 접근하는 과정을 거친다.
                if (battleRendererConfig.units[cloneKey].isMelee) {
                    const enemyFrontKey = event.side === "attacker" ? "defender-front" : "attacker-front";
                    meleeTargetKey[cloneKey] = enemyFrontKey;
                    meleeArrived[cloneKey] = false;
                }
            }

            // 김국회 "국회의사당": summon_clone과 같은 전용 summon_front/summon_back 슬롯을 쓰지만,
            // 캐스터(김국회, 서포터라 전장에 자기 스프라이트가 없음) 자신은 밀려나지 않는다 - 대신
            // 그 자리를 원래 차지하고 있던 원거리 아군(displaced_ally)이 히트박스 2배만큼 밀려난다.
            if (dispatchEffectType === "summon_into_ranged_slot" && event.detail?.summoned) {
                const buildingKey = `${event.side}-${event.detail.building_slot}`;
                battleRendererConfig.units[buildingKey] = {
                    name: event.detail.building_name,
                    maxHp: event.detail.building_hp,
                    hp: event.detail.building_hp,
                    isMelee: false,
                    outfit: "parliament/basic",
                    // RANGED_ATTACK_STYLE["국회의사당"]="cannon"과 동일한 값을 직접 지정 - 이 유닛은
                    // 전투 시작 시점의 rawUnit->style 변환(RANGED_ATTACK_STYLE 조회)을 거치지 않고
                    // 여기서 직접 생성되므로, 패시브 스플래시와 같은 대포알 연출이 나오려면 명시해야 한다.
                    style: "cannon",
                    meleeSpeedRatio: 1,
                    spriteVariant: "",
                    meleeOverlapPercent: null,
                    isCopy: false,
                    // 국회의사당은 시전자(김국회)를 복제/재현한 게 아니라 자기만의 실제 그림(parliament
                    // 아웃핏)을 가진 고유 개체라, 다른 summon_clone류(윤영준 복제체 등)와 달리 아래
                    // "홀로그램 파란 틴트"(is-clone/roster-clone-img)를 씌우면 안 된다 - ensureSummonRosterRow가
                    // 이 플래그를 봐서 로스터 초상화 틴트를 건너뛴다.
                    skipCloneTint: true,
                };

                // displaced_ally는 캐스터 자기 팀일 수도, 전투 중 이동/넉백으로 그 자리까지 들어온
                // 적군일 수도 있다(확인된 설계) - 그래서 event.side가 아니라 백엔드가 알려주는
                // displaced_side로 찾는다. 아무도 그 자리에 없으면(원래 있던 아군이 전진했거나 죽는
                // 등) displaced_ally 자체가 없다.
                const displacedKey = event.detail.displaced_ally
                    ? findUnitKey(event.detail.displaced_side, event.detail.displaced_ally)
                    : null;
                // 착지 지점은 항상 캐스터 소속 팀의 "전투 시작 시점" 후방(back) 고정 좌표 - 그 슬롯에
                // 지금 실제로 누가 서 있는지, 그 캐릭터가 그 사이 얼마나 이동(걷기/넉백 등)했는지와
                // 완전히 무관하다(확인된 요청 - battleStartBackHomeRect 선언부 주석 참고). 캐시가 없는
                // 예외적인 경우(그 진영에 애초에 후방 캐릭터가 없었던 편성 등)에만 그 슬롯 엘리먼트를
                // 지금 다시 재는 것으로 대체한다.
                const backSlotKey = `${event.side}-back`;
                const rangedSlotEl = document.querySelector(`[data-unit="${backSlotKey}"]`);
                const buildingEl = document.querySelector(`[data-unit="${buildingKey}"]`);

                if (buildingEl) {
                    buildingEl.hidden = false;
                    // 착지 지점은 전용 summon 슬롯의 기본 CSS 위치(대열 바깥쪽)가 아니라 후방 홈 좌표
                    // (히트박스가 겹치도록) - 그 자리 엘리먼트와의 화면상 델타를 구해서 summon 슬롯
                    // 기본 X 위에 더해준다(summon_clone이 caster 위치로 델타 보정하는 것과 동일한
                    // 방식).
                    let baseX = getCurrentTranslateX(buildingEl);
                    // buildingEl 자신도 measureHomeRect로 재야 한다(확인된 버그) - arena-battle.css의
                    // .battle-unit[data-unit="X-summon-back"]은 스타일시트 자체에 임시 배치용
                    // transform(translateX(calc(100%+90px)) 등, 대열 바깥으로 미리 빼두는 값)이 걸려있어서,
                    // 인라인 style.transform을 빈 문자열("")로만 지우면 그 스타일시트 transform이 그대로
                    // 적용된 "밀려난" 위치가 측정된다("" 지우기는 인라인 값만 없앨 뿐 캐스케이드가
                    // 스타일시트 규칙으로 폴백되기 때문) - measureHomeRect는 "none"으로 명시적으로
                    // 지워서(캐스케이드를 완전히 무시) 진짜 정적 위치를 재므로 안전하다.
                    const slotRect = battleStartBackHomeRect[backSlotKey]
                        || (rangedSlotEl ? measureHomeRect(rangedSlotEl) : null);
                    if (slotRect) {
                        const buildingRect = measureHomeRect(buildingEl);
                        baseX += slotRect.left - buildingRect.left;
                    }

                    // 하늘에서 떨어지는 착지 연출 - X는 위에서 구한 착지 지점에 고정하고 Y만 위에서
                    // 아래로 애니메이션하고, 착지하는 순간(화면 흔들림과 정확히 같은 타이밍에) 밀려나는
                    // 아군의 넉백 상태/효과도 함께 발동한다(확인된 설계 - 낙하 도중이 아니라 착지 순간).
                    buildingEl.style.transition = "none";
                    buildingEl.style.transform = `translate(${baseX}px, -520px)`;
                    void buildingEl.offsetWidth;
                    const FALL_MS = 420;
                    buildingEl.style.transition = `transform ${FALL_MS}ms cubic-bezier(.55,0,1,1)`;
                    requestAnimationFrame(() => {
                        buildingEl.style.transform = `translate(${baseX}px, 0px)`;
                    });
                    setTimeout(() => {
                        buildingEl.style.transition = "";
                        if (attackEffectsConfig.fieldEl) {
                            attackEffectsConfig.fieldEl.classList.remove("ground-fire-shake");
                            void attackEffectsConfig.fieldEl.offsetWidth;
                            attackEffectsConfig.fieldEl.classList.add("ground-fire-shake");
                        }
                        if (displacedKey) {
                            const displacedEl = document.querySelector(`[data-unit="${displacedKey}"]`);
                            if (displacedEl) {
                                flashEffectAura(displacedKey, "cc");
                                setStatusIcon(displacedKey, "knockback", { source: `${displacedKey}:knockback`, durationMs: MOMENT_ICON_MS });
                                // 확인된 설계: 방향은 "밀려나는 유닛의 소속"이 아니라 항상 "캐스터
                                // (event.side)의 소속"으로 정해진다 - 캐스터가 공격자면 오른쪽(+1, 방어자
                                // 방향), 수비자면 왼쪽(-1, 공격자 방향)이 "적진" 방향. 밀려나는 쪽이
                                // 캐스터의 적이든(보통의 경우) 아군이든(적진 깊숙이 들어와 있던 아군이
                                // 적의 국회의사당에 밀리는 경우) 항상 동일.
                                const forwardDir = event.side === "attacker" ? 1 : -1;
                                applyKnockback(displacedKey, {
                                    distance: displacedEl.getBoundingClientRect().width * 2,
                                    durationMs: 320,
                                    knockDir: forwardDir,
                                });
                            }
                        }
                    }, FALL_MS + 20);
                }
                battleRendererConfig.attackAnimTokens[buildingKey] = (battleRendererConfig.attackAnimTokens[buildingKey] || 0) + 1;
                battleRendererConfig.attackAnimActive[buildingKey] = false;
                battleRendererConfig.rangedResolvePending[buildingKey] = false;
                battleRendererConfig.meleeHitPending[buildingKey] = false;
                delete battleRendererConfig.actorAnimChain[buildingKey];
                delete walkerSuspended[buildingKey];
                getAttackFrameCount(battleRendererConfig.units[buildingKey].outfit);
                ensureSummonRosterRow(buildingKey, battleRendererConfig.units[buildingKey]);
                battleRendererConfig.deathHandled[buildingKey] = false;
                renderUnit(buildingKey);
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
                    // untilSimTime 기준은 event.time(스킬이 서버 시뮬레이션에서 실제로 발동한 시각)이
                    // 아니라 battleRendererConfig.currentSimTime()(이 콜백이 실제로 실행되는, 즉 투사체가 화면에 도착하는
                    // "지금")이어야 한다 - 투사체 비행 시간만큼 재생이 실제 시간으로 지연되는 동안
                    // 커서(playbackOriginEventTime)는 이미 훨씬 앞선 이벤트까지 진행했을 수 있어서,
                    // event.time 기준으로 계산하면 목표 시각이 이미 과거가 되어(realMsUntilSimTime이
                    // 0으로 클램프) 아이콘이 뜨자마자(같은 틱 안에) 바로 지워져버리는 버그가 있었다.
                    flashEffectAura(targetKey, "cc");
                    setStatusIcon(targetKey, "stun", {
                        source: `${event.actor}:stun`,
                        untilSimTime: battleRendererConfig.currentSimTime() + (event.detail.stun_seconds || 0),
                    });
                    if (event.detail?.interrupted_cast) interruptCasting(targetKey, event.detail.target_side);
                    battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${hasteText}, ${event.detail.target} ${event.detail.stun_seconds}초 기절`, event.side);
                });
            } else {
                applySkillHits(event);
                battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${hasteText}`, event.side);
            }
        } else if (dispatchEffectType === "stun_target" && event.actor === "김크장" && actorKey && event.detail?.hit) {
            // 김크장 "GPT 킬러": 같은 stun_target 핸들러(송주헌과 공유)를 백엔드에서 그대로 쓰지만,
            // 연출만 이름으로 분기해서 N-O-G-P-T 5탄환 발사를 재생한다. 백엔드가 실제로 탄환마다
            // 전체 공격력의 1/5씩 독립적으로 크리를 굴려 hits를 5개 만들어주므로(bullet_count),
            // 이종복 "F=ma"의 bullet_hits와 동일한 방식으로 각 글자가 도착할 때마다 그 탄환 몫만
            // 체력바/피격 이펙트에 반영한다 - 마지막(T) 탄환의 몫과 기절만 onArrive에서 함께 처리한다.
            const stunTargetKey = event.detail.target ? findHitKey(event.detail.target, event.detail.target_side) : null;
            const gptHits = event.detail?.hits || [];
            if (stunTargetKey) {
                const lastHit = gptHits[gptHits.length - 1];
                // 로스터 체력바 단계적 반영용 - captureAndApplyHp가 곧바로 최종 hp로 덮어쓰기 전의
                // 값을 남겨둔다(이종복 F=ma의 targetHpBeforeThisAttack과 동일한 이유).
                let gptDisplayHp = battleRendererConfig.units[stunTargetKey] ? battleRendererConfig.units[stunTargetKey].hp : null;
                setPendingDisplayHp(stunTargetKey, gptDisplayHp);
                const wasAlreadyDead = lastHit
                    ? captureAndApplyHp(stunTargetKey, lastHit.target_hp_after, lastHit.target_shield_after)
                    : false;
                playGptKillerVolley(actorKey, stunTargetKey, () => {
                    clearPendingDisplayHp(stunTargetKey); // 시퀀스 종료 - 이제부터는 다시 진짜 unit.hp를 따른다
                    if (!wasAlreadyDead) {
                        if (lastHit) {
                            renderUnit(stunTargetKey);
                            flashHit(stunTargetKey, lastHit.is_crit, lastHit.type_multiplier, lastHit.shown_damage ?? lastHit.damage, lastHit.invincible_block);
                        }
                        flashEffectAura(stunTargetKey, "cc");
                        // 김크장 "GPT 킬러": N-O-G-P-T 5탄환이 순차로 날아가는 동안 실제 재생이 밀리므로,
                        // event.time이 아니라 이 콜백(마지막 탄환 도착)이 실제로 실행되는 battleRendererConfig.currentSimTime()을
                        // 기준으로 지속시간을 잡는다 - 안 그러면 목표 시각이 이미 지나있어 기절 아이콘이
                        // 뜨자마자 사라지는 버그가 있었다(realMsUntilSimTime이 0으로 클램프됨).
                        setStatusIcon(stunTargetKey, "stun", {
                            source: `${event.actor}:stun`,
                            untilSimTime: battleRendererConfig.currentSimTime() + (event.detail.stun_seconds || 0),
                        });
                        if (event.detail?.interrupted_cast) interruptCasting(stunTargetKey, event.detail.target_side);
                    }
                    const totalDamage = gptHits.reduce((sum, h) => sum + (h.shown_damage ?? h.damage), 0);
                    const anyCrit = gptHits.some((h) => h.is_crit);
                    const dmgText = gptHits.length ? `, ${totalDamage}만큼 피해${anyCrit ? "(치명타!)" : ""}` : "";
                    battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${event.detail.target} ${event.detail.stun_seconds}초 기절${dmgText}`, event.side);
                }, (letterIndex) => {
                    // 마지막(T) 탄환의 몫은 onArrive에서 최종 상태와 함께 반영하므로 여기서는 건너뛴다
                    // (이종복 F=ma의 "if (i >= bulletHits.length - 1) return;"과 동일한 이유).
                    if (wasAlreadyDead || letterIndex >= gptHits.length - 1) return;
                    const hit = gptHits[letterIndex];
                    if (!hit) return;
                    if (gptDisplayHp != null) gptDisplayHp = Math.max(0, gptDisplayHp - hit.damage);
                    if (hit.target_shield_after !== undefined) battleRendererConfig.units[stunTargetKey].shield = hit.target_shield_after;
                    // 다른 배우 이벤트가 그 사이 이 대상을 이미 더 낮은 체력으로 반영해뒀을 수 있으니
                    // 절대 진짜 현재 체력보다 높게 보여주지 않는다.
                    const gptClampedDisplayHp = gptDisplayHp == null ? undefined : Math.max(battleRendererConfig.units[stunTargetKey].hp, gptDisplayHp);
                    setPendingDisplayHp(stunTargetKey, gptClampedDisplayHp);
                    renderUnit(stunTargetKey, gptClampedDisplayHp);
                    flashHit(stunTargetKey, hit.is_crit, hit.type_multiplier, hit.shown_damage ?? hit.damage, hit.invincible_block);
                }, event.side);
            } else {
                if (gptHits.length) applySkillHits(event);
                battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동!`, event.side);
            }
        } else if (dispatchEffectType === "stun_target" && event.detail?.hit) {
            const stunTargetKey = event.detail.target ? findHitKey(event.detail.target, event.detail.target_side) : null;
            if (stunTargetKey) {
                flashEffectAura(stunTargetKey, "cc");
                setStatusIcon(stunTargetKey, "stun", {
                    source: `${event.actor}:stun`,
                    untilSimTime: event.time + (event.detail.stun_seconds || 0),
                });
                if (event.detail?.interrupted_cast) interruptCasting(stunTargetKey, event.detail.target_side);
            }
            // 송주헌 "격차 벌리기": 기절과 함께 피해도 준다 - hits가 있으면 데미지 숫자/체력바도 반영.
            if (event.detail?.hits?.length) applySkillHits(event);
            const dmgText = event.detail?.hits?.length ? `, ${hitsSummaryText(event.detail.hits)}` : "";
            battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${event.detail.target} ${event.detail.stun_seconds}초 기절${dmgText}`, event.side);
        } else if (dispatchEffectType === "stun_rear_target" && event.detail?.hit) {
            // 배 "유배 보내기": 항상 적의 "후방"(노출도가 가장 낮은 적)을 노린다. 캐스터에서 날아가는
            // 투사체가 아니라 대상 머리 위에서 감옥이 떨어지는 전용 연출(dropPrisonOnTarget) - 피격판정은
            // 감옥이 실제로 대상에게 닿는 순간(onLand)에 나고, 감옥은 그 뒤로도 기절이 끝나는 시뮬레이션
            // 시각까지 대상 위에 계속 얹혀있다가 사라진다(realMsUntilSimTime으로 그 시각에 맞춰 예약).
            const stunTargetKey = event.detail.target ? findHitKey(event.detail.target, event.detail.target_side) : null;
            if (stunTargetKey) {
                const hit = event.detail?.hits?.[0];
                const wasAlreadyDead = hit ? captureAndApplyHp(stunTargetKey, hit.target_hp_after, hit.target_shield_after) : false;
                dropPrisonOnTarget(stunTargetKey, (removePrison) => {
                    // 감옥이 실제로 떨어지기까지도 실제 시간이 걸리므로, 지속시간 기준은 event.time이
                    // 아니라 이 콜백이 실제로 실행되는 battleRendererConfig.currentSimTime()이어야 한다 - 위 GPT 킬러와 동일한
                    // 이유(안 그러면 감옥/기절 아이콘이 뜨자마자 바로 사라지는 버그).
                    const stunUntil = battleRendererConfig.currentSimTime() + (event.detail.stun_seconds || 0);
                    if (!wasAlreadyDead) {
                        if (hit) {
                            renderUnit(stunTargetKey);
                            flashHit(stunTargetKey, hit.is_crit, hit.type_multiplier, hit.shown_damage ?? hit.damage, hit.invincible_block);
                        }
                        flashEffectAura(stunTargetKey, "cc");
                        setStatusIcon(stunTargetKey, "stun", {
                            source: `${event.actor}:stun`,
                            untilSimTime: stunUntil,
                        });
                        if (event.detail?.interrupted_cast) interruptCasting(stunTargetKey, event.detail.target_side);
                    }
                    setTimeout(removePrison, battleRendererConfig.realMsUntilSimTime(stunUntil));
                    const dmgText2 = hit ? `, ${hit.shown_damage ?? hit.damage}만큼 피해${hit.is_crit ? "(치명타!)" : ""}` : "";
                    battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${event.detail.target} ${event.detail.stun_seconds}초 기절${dmgText2}`, event.side);
                });
            } else {
                if (event.detail?.hits?.length) applySkillHits(event);
                battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동!`, event.side);
            }
        } else if (dispatchEffectType === "damage_hp_percent_plus_atk" && actorKey && event.detail?.hits?.length) {
            const hit = event.detail.hits[0];
            const targetKey = findHitKey(hit.target, hit.target_side);
            if (targetKey) {
                const wasAlreadyDead = captureAndApplyHp(targetKey, hit.target_hp_after, hit.target_shield_after);
                spawnMeteorProjectile(actorKey, targetKey, () => {
                    if (wasAlreadyDead) return;
                    renderUnit(targetKey);
                    flashHit(targetKey, hit.is_crit, hit.type_multiplier, hit.shown_damage ?? hit.damage, hit.invincible_block);
                    battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail.hits)}`, event.side);
                });
            } else {
                applySkillHits(event);
                battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail.hits)}`, event.side);
            }
        } else if (dispatchEffectType === "aoe_gendered_damage" && actorKey) {
            // 서민석 "고백" - 하트 투사체가 실제로 대상에 닿는 순간에 맞춰 피해/HP/피격 이펙트를
            // 반영한다(가스 숨결·aoe_enemy_damage와 동일한 패턴, 확인된 요청). HP는 지금(이벤트
            // 처리 시점) 즉시 반영하고(죽음 여부도 함께 캡처), 하트가 도착하는 시점엔 화면(렌더/
            // 이펙트)만 갱신한다 - captureAndApplyHp 참고.
            const heartHits = event.detail?.hits || [];
            const heartDeadFlags = heartHits.map((hit) => captureAndApplyHp(findHitKey(hit.target, hit.target_side), hit.target_hp_after, hit.target_shield_after));
            heartHits.forEach((hit, i) => {
                const targetKey = findHitKey(hit.target, hit.target_side);
                if (!targetKey) return;
                const gender = effectiveGender(hit.target, targetKey);
                spawnHeartProjectile(actorKey, targetKey, gender === "여" ? "heart-red" : "heart-pink", () => {
                    if (heartDeadFlags[i]) return;
                    renderUnit(targetKey);
                    flashHit(targetKey, hit.is_crit, hit.type_multiplier, hit.shown_damage ?? hit.damage, hit.invincible_block);
                });
            });
            battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail?.hits)}`, event.side);
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
                    untilSimTime: event.time + (event.detail?.debuff_seconds || 0),
                });
            }
            battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail.hits)}, 공격력 감소`, event.side);
        } else if (dispatchEffectType === "bonus_damage_knockback" && actorKey && event.detail?.hits?.length) {
            // HP 데이터는 여기서 즉시 반영한다(다른 배우 이벤트와의 HP 역행 방지) - distance를 크게
            // 잡고 applyKnockback 내부의 맵 경계 클램프에 맡기는 실제 밀쳐내기 연출(위치 이동)과 그에
            // 딸린 오라/아이콘/interruptCasting은 이 배우 자신의 시전 자세가 실제로 끝나는 시점에
            // 맞춰야 해서, 위쪽 이 배우 전용 체인(chainActorAnim) 안으로 옮겼다.
            applySkillHits(event);
            battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail.hits)}, 밀쳐냄`, event.side);
        } else if (dispatchEffectType === "aoe_enemy_damage" && actorKey) {
            // 가스 숨결이 화면을 가로질러 실제로 닿는 순간(onArrive)에 맞춰 피해/HP/피격 이펙트를 반영한다 -
            // 예전엔 스킬 발동 즉시 피해가 반영돼서 투사체가 아직 날아가는 중인데 이미 맞은 것처럼 보였다.
            // HP는 지금(이벤트 처리 시점) 즉시 반영하고(죽음 여부도 함께 캡처), 가스가 도착하는
            // 시점엔 화면(렌더/이펙트)만 갱신한다 - captureAndApplyHp 참고.
            const gasHits = event.detail?.hits || [];
            const gasDeadFlags = gasHits.map((hit) => captureAndApplyHp(findHitKey(hit.target, hit.target_side), hit.target_hp_after, hit.target_shield_after));
            spawnGasBreathStream(actorKey, () => {
                gasHits.forEach((hit, i) => {
                    if (gasDeadFlags[i]) return;
                    const hitKey = findHitKey(hit.target, hit.target_side);
                    if (!hitKey) return;
                    renderUnit(hitKey);
                    flashHit(hitKey, hit.is_crit, hit.type_multiplier, hit.shown_damage ?? hit.damage, hit.invincible_block);
                });
            });
            battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail?.hits)}`, event.side);
        } else if (dispatchEffectType === "heal_ally_percent_max_hp" && event.detail?.healed) {
            // 이영웅 "청진기 진료": 아군 전체(자신 포함)가 동시에 대상이라, 각자 머리 위로 하트가
            // 떨어지는 연출(spawnHealingHeart)을 전원에게 띄운다. HP는 다른 배우 이벤트와의 역행을
            // 막기 위해 먼저 전부 즉시 반영해두고(aoe_all_others_damage 등과 동일한 관례), 하트가
            // 도착하는 시점엔 화면 갱신 + 오라만 얹는다. backend/skill_handlers.py가 이미 만피인
            // 아군도 항상 heals에 넣어주므로(회복량 0), 만피여도 하트/오라는 똑같이 뜨고 로그에는
            // "0 회복"으로 남는다 - 발동 자체가 항상 눈에 보이게. missed(아직 이동 중이라 하트가
            // 안 맞음)는 이와 달리 하트만 떨어지고 착지 효과(체력 갱신/오라/상태 아이콘) 자체가 없다.
            // unit.hp는 위 이유로 지금 즉시 반영하지만, 그 사이 이 대상을 겨냥한 다른 이벤트가
            // renderUnit을 먼저 부르면 하트가 도착하기도 전에 이미 채워진 체력이 드러나 버렸다(확인된
            // 버그) - setPendingDisplayHp로 회복 전 값을 표시용으로 고정해두고, 하트 착지 콜백에서
            // clearPendingDisplayHp로 풀어야 그때부터 진짜(회복된) unit.hp가 보인다.
            const heals = event.detail.heals || [];
            heals.forEach((heal) => {
                if (heal.missed) return;
                const healTargetKey = findUnitKey(event.side, heal.target);
                if (healTargetKey) {
                    setPendingDisplayHp(healTargetKey, battleRendererConfig.units[healTargetKey].hp);
                    battleRendererConfig.units[healTargetKey].hp = heal.target_hp_after;
                }
            });
            heals.forEach((heal) => {
                const healTargetKey = findUnitKey(event.side, heal.target);
                if (!healTargetKey) return;
                spawnHealingHeart(healTargetKey, () => {
                    if (heal.missed) return;
                    clearPendingDisplayHp(healTargetKey);
                    renderUnit(healTargetKey);
                    flashEffectAura(healTargetKey, "heal");
                    setStatusIcon(healTargetKey, "heal", { source: `${event.actor}:heal`, durationMs: MOMENT_ICON_MS });
                });
            });
            battleRendererConfig.appendLog(
                `${event.actor}의 [Active] 발동! ${heals.map((h) => h.missed ? `${h.target} 이동 중이라 회복 실패` : `${h.target} ${h.amount} 회복`).join(", ")}`,
                event.side
            );
        } else if (dispatchEffectType === "self_type_swap_heal" && actorKey) {
            // 이의진 "염색체 변환" - isType2는 위에서 이미 토글해뒀다(playReturnFrames가 새 스프라이트로
            // 재생되도록). 여기서는 자힐 반영 + 상태 아이콘/오라만 얹는다(투사체 없는 자기 대상 스킬).
            if (event.detail?.healed_amount) {
                battleRendererConfig.units[actorKey].hp = Math.min(battleRendererConfig.units[actorKey].maxHp, battleRendererConfig.units[actorKey].hp + event.detail.healed_amount);
                renderUnit(actorKey);
            }
            flashEffectAura(actorKey, "heal");
            setStatusIcon(actorKey, "heal", { source: `${actorKey}:type_swap_heal`, durationMs: MOMENT_ICON_MS });
            battleRendererConfig.appendLog(
                `${event.actor}의 [Active] 발동! ${event.detail?.type2_active ? "염색체 변환(type2)" : "염색체 변환(type1)"} - 체력 ${event.detail?.healed_amount || 0} 회복`,
                event.side
            );
        } else if (dispatchEffectType === "aoe_all_others_damage" && actorKey && event.detail?.hits?.length) {
            // 불빠따 김어진 "불빠따" - 발밑에서 좌우로 땅불이 번져나가며, 자신을 제외한 아군 1명 +
            // 적 전체를 때린다. 각 대상은 불이 실제로 그 위치까지 번져야(거리 비례) 피해가 반영된다.
            // HP는 지금 즉시 반영(죽음 여부도 함께 캡처)하고, 불이 도착하는 시점엔 화면만 갱신한다.
            event.detail.hits.forEach((hit) => {
                hit.__wasAlreadyDead = captureAndApplyHp(findHitKey(hit.target, hit.target_side), hit.target_hp_after, hit.target_shield_after);
            });
            spawnGroundFireCanvas(
                actorKey,
                event.detail.hits,
                (hit) => resolveEffectEl(findHitKey(hit.target, hit.target_side)),
                (hit) => {
                    if (hit.__wasAlreadyDead) return;
                    const hitKey = findHitKey(hit.target, hit.target_side);
                    if (!hitKey) return;
                    renderUnit(hitKey);
                    flashHit(hitKey, hit.is_crit, hit.type_multiplier, hit.shown_damage ?? hit.damage, hit.invincible_block);
                }
            );
            battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail.hits)}`, event.side);
        } else if (dispatchEffectType === "positional_bomb_line" && actorKey && event.detail?.impact_fractions) {
            // 김룡환 "Perfect": 폭탄 5발이 착탄점마다 독립적으로 판정되고, 겹치는 구간에 서 있는
            // 대상은 서로 다른 bomb_index에 각각 걸려 같은 이름이 hits에 여러 번 나올 수 있다(그때는
            // 그 폭탄들이 각각 떨어지는 순간마다 한 번씩 따로 체력이 깎여야 한다). 그래서 HP 반영을
            // 미리 몰아서 하지 않고(예전엔 여기서 즉시 다 반영해, 첫 폭탄이 뜨기도 전에 이미 다
            // 깎여있었다 - 이종복 F=ma/김크장 GPT 킬러와 같은 문제), 그 둘과 동일하게 각 폭탄이 실제로
            // 착탄하는 순간(onBombLand)에 그 폭탄 몫의 hits만 캡처+반영한다. 아무도 안 맞아도(범위 밖)
            // 폭탄 5발은 그대로 떨어져야 하므로 hits 유무가 아니라 impact_fractions 존재로만 분기한다.
            const bombHits = event.detail.hits || [];
            playPositionalBombLine(
                event.detail.impact_fractions,
                () => {
                    const dmgText = bombHits.length ? ` ${hitsSummaryText(bombHits)}` : "";
                    battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동!${dmgText}`, event.side);
                },
                (bombIndex) => {
                    bombHits.filter((h) => h.bomb_index === bombIndex).forEach((hit) => {
                        const hitKey = findHitKey(hit.target, hit.target_side);
                        if (!hitKey) return;
                        const wasAlreadyDead = captureAndApplyHp(hitKey, hit.target_hp_after, hit.target_shield_after);
                        if (wasAlreadyDead) return;
                        renderUnit(hitKey);
                        flashHit(hitKey, hit.is_crit, hit.type_multiplier, hit.shown_damage ?? hit.damage, hit.invincible_block);
                    });
                }
            );
        } else if (dispatchEffectType === "revive_dead_striker" && event.detail?.target) {
            // 신 "제 2 권한": 죽은 아군 STRIKER를 되살린다. 데이터(HP)는 다른 이벤트와 동일하게
            // 즉시 반영하되, 스프라이트가 실제로 "다시 나타나는" 시점은 playReviveEffect의 지면
            // 섬광이 끝나는 순간(onRise)에 맞춘다 - 안 그러면 이펙트가 뜨기도 전에 캐릭터가 뿅
            // 하고 먼저 나타나 버린다. 죽어있던 대상이라 eventTargetKey/actorKey 관례 대신
            // findUnitKey로 이름을 직접 찾는다(대상이 스킬의 "target"이지 시전자가 아니므로).
            const reviveKey = findUnitKey(event.side, event.detail.target);
            if (reviveKey && battleRendererConfig.units[reviveKey]) {
                battleRendererConfig.units[reviveKey].hp = event.detail.target_hp_after;
                if (battleRendererConfig.units[reviveKey].isMelee) {
                    // 근접 유닛이 부활하면 반드시 "아직 도착 전"으로 취급해야 startMeleeWalker의
                    // tick()이 다시 걷기 시작한다(playWalkFrames 포함) - 안 그러면 죽기 직전
                    // meleeArrived가 우연히 true로 남아있었을 때(예: 이미 도착해서 싸우다 죽은 경우)
                    // 되살아난 자리와 목표 위치의 gap이 여전히 작아 보여서 tick()이 "그대로 붙어있다"고
                    // 판단해 걷기 코드 자체를 아예 건너뛰어버린다.
                    meleeArrived[reviveKey] = false;
                    // 죽기 직전 위치(걷다 만 좌표)를 그대로 두면, 죽어있는 동안 상대가 근접 위치까지
                    // 계속 걸어와 있어서(둘 다 근접이면 서로 마주보고 계속 다가옴) 부활 시점엔 남은
                    // 거리가 몇십 px뿐인 경우가 흔하다 - 그러면 되살아나자마자 몇 프레임 만에 도착
                    // 처리되어 걷는 모습이 거의 안 보인다. 부활은 항상 "홈 자리에서 다시 시작"으로
                    // 통일한다 - 걷기 오프셋(부모 [data-unit]의 translateX)을 지워 홈으로 되돌리면,
                    // 이후 도착까지 반드시 원래 거리만큼 다시 걸어야 해서 걷기 애니메이션이 항상
                    // 눈에 띄게 재생된다(전투 시작 시 첫 진입과 동일한 느낌).
                    const reviveEl = document.querySelector(`[data-unit="${reviveKey}"]`);
                    if (reviveEl) reviveEl.style.transform = "";
                    // tick()은 hp>0이기만 하면(walkerSuspended가 아닌 이상) 이 시전 프레임부터 곧바로
                    // 걷기를 시작한다 - 그런데 스프라이트는 여전히 "죽은 채"(battle-unit-dead 반투명,
                    // renderUnit을 아직 호출 전)로 보이는 상태다. renderUnit은 아래 onRise(지면 섬광이
                    // 끝난 뒤)에야 호출되므로, 그 사이(길게는 1초 안팎) 동안 눈에 안 보이는 상태로 이미
                    // 걷기가 다 끝나버려서 "걷지 않고 순간이동한 것처럼" 보이고, 부활 이펙트는 처음
                    // 스폰된 홈 자리에 그대로 남아 캐릭터가 실제로 나타나는 자리와도 어긋나 보였다.
                    // 넉백 트랜지션과 완전히 같은 이유로 walkerSuspended를 재사용해 tick()을 잠깐
                    // 멈춰두고, 스프라이트가 실제로 다시 보이는 순간(onRise, renderUnit 직후)에만
                    // 풀어준다 - 그래야 눈에 보이는 상태로만 걷는다.
                    walkerSuspended[reviveKey] = true;
                    // 부활 즉시 걷기 시작하는 이 판(=풀려난 뒤 첫 tick())에서 tick()이 z-index를
                    // meleeWalkZCounter 기반의 낮은 값으로 찍지 않고 반드시 최상단으로 찍게 한다 -
                    // 안 그러면 죽어있던 동안 상대가 이미 그 근처까지 걸어와 있는 경우(흔함), 되살아난
                    // 유닛이 상대 뒤에 완전히 가려진 채로 걷다가 도착해서야 갑자기 나타나 버린다.
                    reviveWalkTopZ[reviveKey] = true;
                }
                playReviveEffect(reviveKey, () => {
                    renderUnit(reviveKey);
                    walkerSuspended[reviveKey] = false;
                    flashEffectAura(reviveKey, "heal");
                    setStatusIcon(reviveKey, "heal", { source: `${reviveKey}:revive`, durationMs: MOMENT_ICON_MS });
                    battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${event.detail.target} 부활(체력 ${event.detail.hp_percent}%)`, event.side);
                });
            }
        } else if (dispatchEffectType === "consume_paint_multi_effect" && actorKey) {
            // 방임석 "제목은 관객이 정하세요": 보유한 물감 색깔별로 각각 독립된 투사체를 동시에 날린다
            // (서민석의 aoe_gendered_damage와 같은 "여러 투사체 병렬 발사" 패턴). 물감이 하나도 없으면
            // SKILL_TARGET_AVAILABILITY_CHECKS(_has_any_paint)가 신의 부활 대상 없음과 동일하게 애초에
            // 카드 발동 자체를 막으므로, 이 이벤트는 항상 최소 한 색은 보유한 채로 도착한다.
            const d = event.detail || {};
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
            let redHit = null;
            let blueShield = null;
            let stunTargets = null;
            if (d.red && d.hits?.length) {
                const hit = d.hits[0];
                const targetKey = findHitKey(hit.target, hit.target_side);
                if (targetKey) {
                    const wasAlreadyDead = captureAndApplyHp(targetKey, hit.target_hp_after, hit.target_shield_after);
                    redHit = { hit, targetKey, wasAlreadyDead };
                }
                logParts.push(hitsSummaryText(d.hits));
            }

            if (d.blue && d.shields?.length) {
                const shield = d.shields[0];
                // 보호막도 항상 시전자와 같은 편(아군) 대상이라 event.side로 바로 찾는다(_target_ref 없음).
                // HP는 안 바뀌므로 target_hp_after를 그대로 넘겨서 captureAndApplyHp가 HP를 덮어써도
                // 값이 유지되고, target_shield_after만 실제로 보호막을 갱신한다.
                const shieldTargetKey = findHitKey(shield.target, event.side);
                if (shieldTargetKey) {
                    const wasAlreadyDead = captureAndApplyHp(shieldTargetKey, shield.target_hp_after, shield.target_shield_after);
                    blueShield = { shield, shieldTargetKey, wasAlreadyDead };
                }
                logParts.push(`${shield.target} 보호막 ${shield.amount} 부여`);
            }

            if (d.yellow && d.stunned?.length) {
                stunTargets = d.stunned;
                logParts.push(`적 전체 ${d.stun_seconds}초 기절`);
            }

            const fireConsumePaintVisuals = () => {
                if (redHit) {
                    const { hit, targetKey, wasAlreadyDead } = redHit;
                    spawnPaintSkillProjectile(actorKey, targetKey, "paint-red", () => {
                        if (wasAlreadyDead) return;
                        renderUnit(targetKey);
                        flashHit(targetKey, hit.is_crit, hit.type_multiplier, hit.shown_damage ?? hit.damage, hit.invincible_block);
                    });
                }

                if (blueShield) {
                    const { shieldTargetKey, wasAlreadyDead } = blueShield;
                    spawnPaintSkillProjectile(actorKey, shieldTargetKey, "paint-blue", () => {
                        if (wasAlreadyDead) return;
                        renderUnit(shieldTargetKey);
                        playShieldPop(shieldTargetKey);
                        flashEffectAura(shieldTargetKey, "buff");
                    });
                }

                if (stunTargets) {
                    // 노란 물감 = 적 전체 기절 - 대표로 첫 대상에게 투사체를 날리고, 도착 시 전원에게 한번에 적용한다.
                    const firstStunKey = findHitKey(stunTargets[0].target, stunTargets[0].target_side);
                    const applyAllStuns = () => {
                        // 투사체가 실제로 도착해야 이 콜백이 실행되므로, event.time이 아니라 지금
                        // (battleRendererConfig.currentSimTime())을 지속시간 기준으로 삼는다 - 위 기절 스킬들과 동일한 이유.
                        const stunUntil = battleRendererConfig.currentSimTime() + (d.stun_seconds || 0);
                        stunTargets.forEach((s) => {
                            const sKey = findHitKey(s.target, s.target_side);
                            // 기절은 HP를 쓰지 않아 되살아나는 위험은 없지만, 그 사이 이미 죽은
                            // 대상에게 기절 아이콘/오라가 뜨는 건 여전히 어색하므로 함께 막는다.
                            if (!sKey || battleRendererConfig.units[sKey].hp <= 0) return;
                            flashEffectAura(sKey, "cc");
                            setStatusIcon(sKey, "stun", {
                                source: `${event.actor}:stun`,
                                untilSimTime: stunUntil,
                            });
                            if (s.interrupted_cast) interruptCasting(sKey, s.target_side);
                        });
                    };
                    if (firstStunKey) spawnPaintSkillProjectile(actorKey, firstStunKey, "paint-yellow", applyAllStuns);
                    else applyAllStuns();
                }

                battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${logParts.join(", ")}`, event.side);
            };

            fireConsumePaintVisuals();
        } else if (dispatchEffectType === "direction_shift" && event.detail?.activated) {
            // 김현재 "방향 전환" 시전 - kimhyeonjae_mode_resolve(폭주/지키고 싶은 마음/종료/사망)와
            // 동일한 스탠딩/아이콘 처리를 여기서도 그대로 한다(이 발동 자체는 매 틱 스윕이 아니라
            // 일반 [Active] 시전 파이프라인을 그대로 타므로 별도 처리가 필요하다).
            khSetMeleeActive(actorKey, true);
            if (actorKey) {
                const unitInfo = battleRendererConfig.units[actorKey];
                if (unitInfo) { unitInfo.spriteVariant = "_active"; unitInfo.kimhyeonjaeMode = "active"; }
                const until = event.time + event.detail.duration_seconds;
                const activeSource = `${actorKey}:kimhyeonjae_active`;
                flashEffectAura(actorKey, "buff");
                setStatusIcon(actorKey, "damage_reduction", { source: activeSource, untilSimTime: until });
                setStatusIcon(actorKey, "move_speed_up", { source: activeSource, untilSimTime: until });
                renderUnit(actorKey);
            }
            battleRendererConfig.appendLog(
                `${event.actor}의 [Active] 발동! ${event.detail.duration_seconds}초간 사거리 근거리 전환 - 매초 체력 ${event.detail.hp_drain_percent_per_second}% 감소, 받는 피해 ${event.detail.damage_reduction_percent}% 감소+반사, 이동속도 ${event.detail.move_speed_percent}% 증가`,
                event.side
            );
        } else if (dispatchEffectType === "strike_zone_return_throw" && event.detail?.hits?.length) {
            // 이도협 "돌직구": 시전 순간엔 존만 새기고 피해는 전혀 없다(HP 갱신 없음) - 아래 기본 분기의
            // applySkillHits를 그대로 쓰면 hit.target_hp_after가 없어 undefined로 체력을 덮어써버리므로
            // (버그 확인됨) 전용 분기가 필요하다. 존은 side별로 dolljikguActiveZones에 담아뒀다가,
            // 나중에(최대 return_delay_seconds 뒤) delayed_skill_resolve가 도착하면 그 좌표를 그대로
            // 다시 읽어 판정 결과를 그 자리에 재생한다.
            const sideZones = dolljikguActiveZones[event.side] || (dolljikguActiveZones[event.side] = {});
            event.detail.hits.forEach((hit) => {
                const hitKey = findHitKey(hit.target, hit.target_side);
                if (!hitKey) return;
                if (sideZones[hitKey]) removeStrikeZone(sideZones[hitKey]);
                sideZones[hitKey] = spawnStrikeZone(hitKey);
            });
            if (actorKey) {
                throwDolljikguBallToWall(actorKey, event.side === "attacker" ? "defender" : "attacker", () => {});
            }
            battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! 스트라이크 존을 새기고 돌직구를 던짐`, event.side);
        } else {
            applySkillHits(event);
            if (dispatchEffectType === "summon_clone" && event.detail?.summoned) {
                battleRendererConfig.appendLog(
                    event.detail.replaced
                        ? `${event.actor}의 [Active] 발동! ${event.detail.clone_name}이(가) 새로 소환되어 이전 소환수를 대체함!`
                        : `${event.actor}의 [Active] 발동! ${event.detail.clone_name}이(가) 전장에 소환됨!`,
                    event.side
                );
            } else if (dispatchEffectType === "summon_into_ranged_slot" && event.detail?.summoned) {
                battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! 국회의사당이 ${event.detail.displaced_ally}의 자리에 소환됨! (${event.detail.duration_seconds}초)`, event.side);
            } else if (dispatchEffectType === "cost_reduction_grant") {
                battleRendererConfig.appendLog(
                    event.detail?.granted
                        ? `${event.actor}의 [Active] 발동! ${event.detail.target} 코스트 ${event.detail.base_cost} -> ${event.detail.reduced_cost} 감소 (${event.detail.uses}회)`
                        : `${event.actor}의 [Active] 발동! 대상 없음`,
                    event.side
                );
            } else if (dispatchEffectType === "self_cost_scaling_strike") {
                // 김지섭 "핏값": 자기 체력을 대가로 치르고 그 누적 손실만큼 위력이 늘어나는 스킬이라,
                // 로그에도 소모한 체력과 대상 피해를 함께 보여준다.
                battleRendererConfig.appendLog(
                    `${event.actor}의 [Active] 발동! 자신의 체력 ${event.detail?.hp_cost ?? 0} 소모 - ${hitsSummaryText(event.detail?.hits || [])}`,
                    event.side
                );
            } else if (dispatchEffectType === "self_stack_buff" && event.detail?.stack_count) {
                // stat에 따라 "공격력"/"공격 속도" 문구를 구분한다(확인된 요청으로 윤대웅은 haste가 기본값).
                const statLabel = event.detail.stat === "haste" ? "공격 속도" : "공격력";
                battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${statLabel} ${event.detail.percent_bonus || 0}% 증가 (${event.detail.stack_count}중첩)`, event.side);
            } else if (dispatchEffectType === "self_shield_duration" && event.detail?.shield_seconds) {
                battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${event.detail.shield_seconds}초간 무적 보호막`, event.side);
            } else if (event.detail?.hits?.length) {
                battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동! ${hitsSummaryText(event.detail.hits)}`, event.side);
            } else {
                battleRendererConfig.appendLog(`${event.actor}의 [Active] 발동!`, event.side);
            }
        }
    } else if (eventType === "delayed_skill_resolve" && event.effect_type === "strike_zone_return_throw") {
        // 이도협 "돌직구" 귀환 판정 - skill_resolve(시전)로부터 최대 return_delay_seconds 뒤에 오는
        // 별개의 이벤트다. hits는 공이 귀환하며 실제로 지나가는 순서 그대로(벽에서 가까운 쪽부터) 온다 -
        // "강제타석"은 더 이상 이벤트 전체를 통째로 대체하는 별도 분기가 아니라, 그 순서상 공이 정확히
        // 불빠따에게 닿는 바로 그 히트 하나가 redirected=True로 표시되는 형태다(확인된 요청 - 아군도
        // 포함한 "자신보다 전방의 모든 인물"이 순서대로 맞다가, 그중 불빠따 차례에서만 정상 피해 대신
        // 그가 대신 받아쳐 적 전원에게 광역 피해를 입히고 그 뒤로는 재생을 멈춘다). HP/보호막은 다른
        // 이벤트와의 순서 보장을 위해 지금 즉시 반영하고(캡처해서 이미 죽어있었는지도 함께 확인 -
        // captureAndApplyHp), 화면(공 귀환/피격/끌어당김/기절/강제타석)은 순서대로 재생한다.
        const actorKey = eventActorKey(event);
        const hits = event.detail?.hits || [];
        const sideZones = dolljikguActiveZones[event.side] || {};

        // 판정 시점에 이미 죽어있던 대상은 백엔드가 hits에서 통째로 빼버린다(_resolve_strike_zone_
        // return_throw의 "if target["hp"] <= 0: continue" 참고) - 그런 대상은 아래 개별 히트 처리
        // (onBallArrive)를 아예 못 받으므로, 그 존만 화면에 영원히 남는 버그가 있었다(확인된 신고 -
        // 상대 불빠따가 공이 돌아오기 전에 다른 공격으로 죽으면 그 존만 안 사라짐). hits에 없는(=죽어서
        // 빠진) 존은 여기서 먼저 정리한다 - 실제로 판정되는 존은 곧이어 onBallArrive가 다시 지워도
        // 무해하다(removeStrikeZone은 이미 지워진 엘리먼트에 대해서도 안전).
        const hitKeysThisResolve = new Set(hits.map((hit) => findHitKey(hit.target, hit.target_side)).filter(Boolean));
        Object.keys(sideZones).forEach((key) => {
            if (!hitKeysThisResolve.has(key)) {
                removeStrikeZone(sideZones[key]);
                delete sideZones[key];
            }
        });

        if (hits.length) {
            // redirected 히트는 자기 자신은 피해를 안 입으므로(target_hp_after가 없음) 최상위
            // captureAndApplyHp 대상에서 빼고, 대신 그 안에 중첩된 redirected_hits(적 전원)를 각각
            // 캡처+반영한다.
            const deadFlags = hits.map((hit) => {
                if (hit.redirected) return false;
                const hitKey = findHitKey(hit.target, hit.target_side);
                return hitKey ? captureAndApplyHp(hitKey, hit.target_hp_after, hit.target_shield_after) : true;
            });
            hits.forEach((hit) => {
                if (!hit.redirected) return;
                (hit.redirected_hits || []).forEach((rh) => {
                    const rhKey = findHitKey(rh.target, rh.target_side);
                    rh.__wasAlreadyDead = rhKey ? captureAndApplyHp(rhKey, rh.target_hp_after, rh.target_shield_after) : true;
                });
            });

            // 벽에서 가까운 쪽부터(hits 순서 그대로) 재생한다 - 참고 데모와 동일하게 벽에서 튕겨온
            // 공이 먼 쪽 존부터 차례로 지나가는 방향.
            const fieldRect = attackEffectsConfig.fieldEl?.getBoundingClientRect();
            const wallSide = event.side === "attacker" ? "defender" : "attacker";
            let chainFromXY = fieldRect
                ? { x: viewportEdgeXRelativeToField(wallSide, fieldRect), y: fieldRect.height / 2 }
                : null;

            const playNext = (i) => {
                if (i >= hits.length) {
                    // 모든 존을 지난 뒤엔(강제타석으로 중간에 끝나지 않았다면) 공이 이도협 본인에게
                    // 완전히 돌아가며 사라진다(확인된 요청 - 참고 데모의 마지막 구간과 동일).
                    if (actorKey && chainFromXY) {
                        throwDolljikguBallReturn(chainFromXY, actorKey, () => {});
                    }
                    return;
                }
                const hit = hits[i];
                const hitKey = findHitKey(hit.target, hit.target_side);
                const zone = hitKey ? sideZones[hitKey] : null;
                const zoneXY = zone ? { x: parseFloat(zone.style.left), y: parseFloat(zone.style.top) } : null;

                const onBallArrive = (arrivedXY) => {
                    chainFromXY = arrivedXY;
                    // zone은 이 콜백이 예약된 시점(위 const zone = ...)에 캡처된 스냅샷이다 - 공이 날아가는
                    // 동안(수백ms) 같은 hitKey로 다음 시전이 먼저 들어와 sideZones[hitKey]를 새 존으로
                    // 덮어쓸 수 있다(확인된 버그 - 같은 대상을 빠르게 연속 시전하거나, 같은 편에 이름이
                    // 같은 유닛이 둘 있어 findHitKey가 둘을 같은 키로 뭉뚱그리는 경우 특히 잦음). 그 상태로
                    // 여기서 무조건 delete하면 방금 새로 생긴(아직 자기 차례를 못 받은) 존이 sideZones에서
                    // 통째로 빠져버려, 그 존은 이후 아무 코드도 참조를 못 해 화면에 영원히 남는다 - 지금
                    // sideZones[hitKey]가 여전히 "나"(zone)를 가리킬 때만 지운다.
                    if (zone) {
                        removeStrikeZone(zone);
                        if (sideZones[hitKey] === zone) delete sideZones[hitKey];
                    }

                    if (hit.redirected) {
                        // 강제타석: 공이 정확히 불빠따에게 닿는 순간 - 그는 맞지 않고, 대신 그 자신의
                        // 일반공격 스윙(attack_N.webp)을 재생한다(확인된 요청. 기본공격 근접 타격과
                        // 동일한 타이밍 규칙으로, 스윙이 몇 프레임(effectLaunchDelayMs) 재생된 뒤에야
                        // 실제로 적 전원에게 반영된다).
                        if (hitKey) playAttackFrames(hitKey);
                        battleRendererConfig.appendLog(
                            `${hit.target}의 [Special] 발동! 강제타석 - 귀환하는 돌직구를 받아침`,
                            event.side
                        );
                        setTimeout(() => {
                            (hit.redirected_hits || []).forEach((rh) => {
                                const rhKey = findHitKey(rh.target, rh.target_side);
                                if (!rhKey || rh.__wasAlreadyDead) return;
                                renderUnit(rhKey);
                                flashHit(rhKey, rh.is_crit, rh.type_multiplier, rh.shown_damage ?? rh.damage, rh.invincible_block);
                            });
                            battleRendererConfig.appendLog(
                                `${hit.target}의 [Special] 적중! ${hitsSummaryText(hit.redirected_hits || [])}`,
                                event.side
                            );
                            // 불빠따에게 되돌아오던 공은 그가 받아치는 순간 이도협에게 돌아가지 않고,
                            // 원래 오던 방향과 반대로(=이도협 본인이 처음 던졌을 때와 같은 방향, 적진
                            // 쪽 벽으로) 다시 한번 날아가다가 맵 끝(벽)에 닿는 순간 사라진다(확인된
                            // 요청) - 이후 남은 재생은 여기서 멈춘다(백엔드도 이 히트 이후로는 판정을
                            // 진행하지 않음).
                            if (hitKey) {
                                throwDolljikguBallToWall(hitKey, event.side === "attacker" ? "defender" : "attacker", () => {});
                            }
                        }, battleRendererConfig.effectLaunchDelayMs);
                        return;
                    }

                    if (hitKey && !deadFlags[i]) {
                        renderUnit(hitKey);
                        flashHit(hitKey, hit.is_crit, hit.type_multiplier, hit.shown_damage ?? hit.damage, hit.invincible_block);
                    }
                    battleRendererConfig.appendLog(
                        `${event.actor}의 [Active] 적중! ${hit.target} ${hit.stayed ? "자리를 지킴" : "자리를 이탈함"} - ${hit.shown_damage ?? hit.damage} 피해`,
                        event.side
                    );

                    if (hit.pulled && hitKey && !deadFlags[i] && zoneXY) {
                        spawnDolljikguPullLine(arrivedXY, zoneXY);
                        pullUnitToScreenX(hitKey, zoneXY.x, 260);
                        setTimeout(() => {
                            renderUnit(hitKey);
                            flashHit(hitKey, hit.pulled_is_crit, hit.type_multiplier, hit.pulled_shown_damage ?? hit.pulled_damage, hit.pulled_invincible_block);
                            flashEffectAura(hitKey, "cc");
                            setStatusIcon(hitKey, "stun", {
                                source: `${event.actor}:strike_zone_pull`,
                                untilSimTime: battleRendererConfig.currentSimTime() + (hit.pulled_stun_seconds || 0),
                            });
                            if (hit.pulled_interrupted_cast) interruptCasting(hitKey, hit.target_side);
                            setTimeout(() => playNext(i + 1), 260);
                        }, 260);
                        return;
                    }
                    setTimeout(() => playNext(i + 1), 220);
                };

                if (hitKey) {
                    throwDolljikguBallReturn(chainFromXY, hitKey, onBallArrive);
                } else {
                    onBallArrive(chainFromXY);
                }
            };
            playNext(0);
        }
    } else if (eventType === "death_trigger_resolve") {
        // 이영웅 "히포크라테스 선서": 자신이 죽는 순간 아군에게 보호막을 부여한다(확인된 요청 - 원래는
        // 회복이었음, 수치는 그대로). 여럿에게 동시에 갈 수 있어(heal_ally_percent_max_hp와 달리)
        // 투사체 연출 없이 곧바로 반영한다.
        (event.detail?.shields || []).forEach((shield) => {
            const shieldTargetKey = findUnitKey(event.side, shield.target);
            if (!shieldTargetKey) return;
            battleRendererConfig.units[shieldTargetKey].hp = shield.target_hp_after;
            battleRendererConfig.units[shieldTargetKey].shield = shield.target_shield_after;
            renderUnit(shieldTargetKey);
            playShieldPop(shieldTargetKey);
            flashEffectAura(shieldTargetKey, "buff");
        });
        battleRendererConfig.appendLog(`${event.actor}의 [Special] 발동! 사망과 함께 아군 보호막 부여`, "trait");
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
    } else if (eventType === "madness_gain_resolve") {
        // 김지섭 "격정": 광기 보유량이 바뀔 때마다(획득/감쇠/소모) 그 즉시 상태 아이콘의 weight를
        // "현재 총 보유량"으로 덮어쓴다(paint_gain_resolve와 완전히 동일한 방식) - 0이 되면(소모 직후,
        // 또는 감쇠로 다 닳으면) 아이콘을 지운다. 광기 자체는 방임석의 물감과 동일하게 지속시간
        // 기반 상태 효과와 무관한 별도 카운터라, 다른 아이콘들과 달리 durationMs/untilSimTime을 아예
        // 쓰지 않는다(확인된 요청).
        const madnessKey = findUnitKey(event.side, event.actor);
        if (madnessKey) {
            const sourceKey = `${madnessKey}:madness`;
            if (event.detail.total > 0) {
                setStatusIcon(madnessKey, "madness", { source: sourceKey, weight: event.detail.total });
            } else {
                clearStatusIconSource(madnessKey, "madness", sourceKey);
            }
        }
    } else if (eventType === "madness_release_resolve") {
        // 김지섭 "격정": 광기가 50에 도달해 전부 소모되며 5초(6성은 7초)간 공격속도/공격력/이동속도가
        // 함께 오르는 순간 - 버프 오라를 한 번 반짝이고, 세 스탯 각각의 상태 아이콘을 백엔드가 실제로
        // 건 임시 버프의 만료 시각(event.time + buff_seconds)에 맞춰 띄운다(conditional_target_debuff의
        // atk_speed_up 처리와 동일한 untilSimTime 패턴). 광기 아이콘 자체는 뒤이어 오는
        // madness_gain_resolve(total:0)가 알아서 지운다.
        const releaseKey = findUnitKey(event.side, event.actor);
        if (releaseKey) {
            flashEffectAura(releaseKey, "buff");
            const until = event.time + (event.detail?.buff_seconds || 0);
            setStatusIcon(releaseKey, "atk_up", { source: `${releaseKey}:madness_release`, untilSimTime: until });
            setStatusIcon(releaseKey, "atk_speed_up", { source: `${releaseKey}:madness_release`, untilSimTime: until });
            setStatusIcon(releaseKey, "move_speed_up", { source: `${releaseKey}:madness_release`, untilSimTime: until });
            battleRendererConfig.appendLog(
                `${event.actor}의 [Passive] 발동! 광기 전부 소모 - ${event.detail?.buff_seconds ?? 0}초간 공격속도 ${event.detail?.haste_percent ?? 0}%, 공격력 ${event.detail?.atk_percent ?? 0}%, 이동속도 ${event.detail?.move_speed_percent ?? 0}% 증가`,
                event.side
            );
        }
    } else if (eventType === "kimhyeonjae_mode_resolve") {
        // 김현재: "방향 전환"(active) -> "폭주"(frenzy) -> "지키고 싶은 마음"(special) -> 사망(death)
        // 상태 전이 - 한 이벤트 타입에 detail.mode로 어느 상태로 바뀌었는지만 실어보낸다. 상태별 전용
        // 아이콘 아트가 아직 없어서 기존 아이콘(공격력/공격속도/이동속도/피해감소)을 재사용한다.
        // 스탠딩도 present/basic의 battle_idle_active/_passive/_special.webp로 갈아입는다 -
        // spriteVariant는 renderUnit이 그대로 battle_idle${variant}.webp로 읽는 범용 필드다.
        const khKey = findUnitKey(event.side, event.actor);
        if (khKey) {
            const mode = event.detail?.mode;
            const unitInfo = battleRendererConfig.units[khKey];
            const until = event.time + (event.detail?.duration_seconds || 0);
            const activeSource = `${khKey}:kimhyeonjae_active`;
            const modeSource = `${khKey}:kimhyeonjae_mode`;

            if (mode === "active") {
                if (unitInfo) unitInfo.spriteVariant = "_active";
                flashEffectAura(khKey, "buff");
                setStatusIcon(khKey, "damage_reduction", { source: activeSource, untilSimTime: until });
                setStatusIcon(khKey, "move_speed_up", { source: activeSource, untilSimTime: until });
                battleRendererConfig.appendLog(
                    `${event.actor}의 [Active] 발동! ${event.detail.duration_seconds}초간 사거리 근거리 전환 - 매초 체력 ${event.detail.hp_drain_percent_per_second}% 감소, 받는 피해 ${event.detail.damage_reduction_percent}% 감소+반사, 이동속도 ${event.detail.move_speed_percent}% 증가`,
                    event.side
                );
            } else if (mode === "frenzy") {
                if (unitInfo) { unitInfo.spriteVariant = "_passive"; unitInfo.kimhyeonjaeMode = "frenzy"; }
                khSetMeleeActive(khKey, false); // "사용 중인 방향 전환 즉시 해제" - 근접 걷기도 함께 취소
                setKimHyeonjaeWingAura(khKey, "frenzy");
                khTriggerFieldShake();
                clearStatusIconSource(khKey, "damage_reduction", activeSource);
                clearStatusIconSource(khKey, "move_speed_up", activeSource);
                flashEffectAura(khKey, "cc");
                setStatusIcon(khKey, "atk_up", { source: modeSource, untilSimTime: until });
                setStatusIcon(khKey, "atk_speed_up", { source: modeSource, untilSimTime: until });
                battleRendererConfig.appendLog(
                    `${event.actor}의 [Passive] 발동! 폭주 - 방향 전환 해제, ${event.detail.duration_seconds}초간 공격력 ${event.detail.atk_percent}%/공격속도 ${event.detail.haste_percent}% 증가 + CC 면역`,
                    event.side
                );
            } else if (mode === "special") {
                if (unitInfo) { unitInfo.spriteVariant = "_special"; unitInfo.kimhyeonjaeMode = "special"; unitInfo.hp = event.detail.hp_after; }
                setKimHyeonjaeWingAura(khKey, "special");
                khTriggerFieldShake();
                flashEffectAura(khKey, "buff");
                setStatusIcon(khKey, "atk_up", { source: modeSource, untilSimTime: until });
                setStatusIcon(khKey, "atk_speed_up", { source: modeSource, untilSimTime: until });
                setStatusIcon(khKey, "damage_reduction", { source: modeSource, untilSimTime: until });
                battleRendererConfig.appendLog(
                    `${event.actor}의 [Special] 발동! 지키고 싶은 마음 - 체력 ${event.detail.heal_amount} 회복, ${event.detail.duration_seconds}초간 공격력 ${event.detail.atk_percent}%/공격속도 ${event.detail.haste_percent}% 증가 + 받는 피해 ${event.detail.damage_reduction_percent}% 감소 + 기본공격 넉백`,
                    event.side
                );
            } else if (mode === "normal") {
                if (unitInfo) { unitInfo.spriteVariant = ""; unitInfo.kimhyeonjaeMode = null; }
                khSetMeleeActive(khKey, false); // 10초 자연 종료 - 근접 걷기를 멈추고 원거리 idle로 복귀
                setKimHyeonjaeWingAura(khKey, null);
                clearStatusIconSource(khKey, "damage_reduction", activeSource);
                clearStatusIconSource(khKey, "move_speed_up", activeSource);
                battleRendererConfig.appendLog(`${event.actor}의 [Active] 종료! 사거리 원거리 복구`, event.side);
            } else if (mode === "death") {
                if (unitInfo) { unitInfo.spriteVariant = ""; unitInfo.kimhyeonjaeMode = null; unitInfo.hp = 0; }
                khSetMeleeActive(khKey, false);
                setKimHyeonjaeWingAura(khKey, null);
                clearAllStatusIcons(khKey);
                battleRendererConfig.appendLog(
                    `${event.actor}의 [${event.detail.from === "special" ? "Special" : "Passive"}] 지속시간 종료 - 즉시 사망`,
                    event.side
                );
            }
            renderUnit(khKey);
        }
    } else if (eventType === "cost_reduction_expire_resolve") {
        // 안지석 "예산 재배정" 만료: 부여받은 사용 횟수를 다 써서 원래 코스트로 되돌아간다 - 카드
        // 숫자/글로우/상태 아이콘을 전부 원상복구한다.
        const expireSlot = event.actor_slot;
        if (expireSlot && event.detail?.restored_cost != null) {
            const expireKey = `${event.side}-${expireSlot}`;
            setCostCardCost(event.side, expireSlot, event.detail.restored_cost);
            const dock = document.getElementById(`cost-dock-${event.side}`);
            dock?.querySelector(`[data-cost-slot="${expireSlot}"]`)?.classList.remove("is-cost-reduced");
            clearStatusIconSource(expireKey, "cost_reduction", `${expireKey}:cost_reduction`);
        }
        battleRendererConfig.appendLog(`${event.actor}의 코스트 감소 효과가 끝나 원래 코스트로 돌아옴`, event.side);
    } else if (eventType === "team_cost_gain_resolve") {
        // 안지석 "학생회 예산": 학생 직업 아군이 고비용 [Active]를 쓸 때마다 팀 코스트를 즉시 불려준다 -
        // anchorCost로 코스트바 표시값도 그 즉시 갱신한다(명시적 소모/획득은 항상 즉시 반영).
        anchorCost(event.side, event.detail.cost_pool, event.time);
        battleRendererConfig.appendLog(
            `${event.actor}의 [Special] 발동! ${event.detail.source_actor}의 [Active] 사용으로 코스트 ${event.detail.amount} 획득`,
            event.side
        );
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
                battleRendererConfig.appendLog(`${event.actor}의 [Special] 발동! 방임 상태(지속 기절, 받는 피해 감소)`, "trait");
            } else {
                clearStatusIconSource(neglectKey, "stun", `${neglectKey}:neglect`);
                clearStatusIconSource(neglectKey, "damage_reduction", `${neglectKey}:neglect`);
                battleRendererConfig.appendLog(`${event.actor}의 방임 상태 해제!`, "trait");
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
                battleRendererConfig.appendLog(`${event.actor}의 [Special] 발동! 고혈 상태(교사 타입 대상 기본공격 시 회복)`, "trait");
            } else {
                clearStatusIconSource(lifestealKey, "lifesteal", `${lifestealKey}:lifesteal`);
                battleRendererConfig.appendLog(`${event.actor}의 고혈 상태 해제!`, "trait");
            }
        }
    } else if (eventType === "low_hp_shield_resolve") {
        // 배 "개량한복" - 기본공격이 원인일 때는 이제 그 타격 자신의 착탄 콜백(applyHitVisual 등)이
        // grantLowHpShieldVisual을 직접 불러서 처리하므로, 이 이벤트는 스킬 피해 등 아직 그 경로로
        // 옮기지 않은 나머지 소스에 대한 폴백(battle_engine._apply_low_hp_shield_grant의 매 틱 스윕)
        // 전용으로만 남는다 - 그런 경로는 원인이 된 타격 자체의 착탄 시점과 완전히 동기화되지는
        // 않지만(기존과 동일한 수준), 최소한 무적이 아예 안 뜨는 것보다는 낫다.
        const shieldKey = findUnitKey(event.side, event.actor);
        grantLowHpShieldVisual(shieldKey, event.actor, event.detail?.seconds || 0, event.time);
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
            battleRendererConfig.units[lockActorKey]?.isMelee &&
            meleeTargetKey[lockActorKey] !== lockTargetKey
        ) {
            meleeTargetKey[lockActorKey] = lockTargetKey;
            meleeArrived[lockActorKey] = false;
        }
    } else {
        // basic_attack (기존 로직 + 원거리 5명 전용 연출)
        const actorKey = eventActorKey(event);
        const targetKey = eventTargetKey(event);
        const actorIsMelee = actorKey && battleRendererConfig.units[actorKey] && battleRendererConfig.units[actorKey].isMelee;
        // 이 이벤트가 적용되기 "전"에 이미 죽어있었는지(=다른 이벤트가 먼저 죽인 상태) 여기서 미리
        // 캡처해둔다 - 아래에서 hp를 곧바로 덮어쓰고 나면, 이 공격 자체가 킬(target_hp_after=0)인
        // 정상적인 경우와 "이미 죽은 대상을 뒤늦게 또 때린" 경우를 더 이상 hp만 보고는 구분할 수 없다.
        const targetWasAlreadyDead = targetKey && battleRendererConfig.units[targetKey] && battleRendererConfig.units[targetKey].hp <= 0;
        // 이종복 "F=ma"(bullet_hits) 로스터 바 단계적 반영용 - 이 공격이 최종 hp를 즉시 덮어쓰기
        // "직전"의 hp를 남겨둔다(아래 renderUnit(targetKey, hpOverride) 참고).
        const targetHpBeforeThisAttack = targetKey && battleRendererConfig.units[targetKey] ? battleRendererConfig.units[targetKey].hp : null;

        // 데이터(HP)는 이벤트 순서 그대로, 그 어떤 지연도 없이 여기서 곧바로 반영한다.
        if (targetKey) {
            battleRendererConfig.units[targetKey].hp = event.target_hp_after;
            if (event.target_shield_after !== undefined) {
                const shieldBefore = battleRendererConfig.units[targetKey].shield || 0;
                battleRendererConfig.units[targetKey].shield = event.target_shield_after;
                if (shieldBefore > 0 && event.target_shield_after <= 0) playShieldHit(targetKey);
            }
        }
        // 윤(영혼 흡수/선생 고혈): 기본공격 자체에 딸려오는 시전자 자가 회복도 데이터는 위와 같은
        // 이유로 즉시 반영한다(연출만 아래 applyHitVisual에서 타격 시점에 맞춰 보여준다).
        if (actorKey && battleRendererConfig.units[actorKey] && event.actor_self_heal) {
            battleRendererConfig.units[actorKey].hp = event.actor_hp_after;
        }
        // 호(자폭 소환수): 이 공격을 명중시키는 즉시 스스로 죽는다 - 데이터는 여기서 즉시 반영하고
        // (호는 이 시점에 이미 도착해서 정지해 있으므로 걷기 루프에 영향 없음), 실제로 사라지는
        // 연출(playDeathSequence)은 아래 applyHitVisual에서 공격이 화면에 닿은 뒤에 재생한다.
        if (actorKey && battleRendererConfig.units[actorKey] && event.actor_self_destruct) {
            battleRendererConfig.units[actorKey].hp = 0;
        }
        // meleeTargetKey는 여기서 직접 건드리지 않는다 - 아래 waitForMeleeArrival이 target이
        // 바뀌었는지 스스로 비교해서 바뀐 경우에만 meleeArrived를 다시 false로 리셋한다. 여기서
        // 미리 값을 같게 만들어버리면 그 비교가 항상 "안 바뀜"으로 나와서, 예전 타겟이 죽어 새
        // 전방으로 타겟이 바뀌어도 이미 meleeArrived=true인 채로 남아 걸어가지 않는 버그가 있었다
        // (예: 전방이 죽어 후방이 새 전방이 됐는데, 상대 근접 유닛이 원래 타겟 자리에 멈춰있음).

        function applyHitVisual() {
            clearPendingDisplayHp(targetKey); // F=ma 시퀀스 종료(단발 공격이면 애초에 설정된 적이 없어 no-op) - 이제부터는 다시 진짜 unit.hp를 따른다
            if (targetKey) {
                renderUnit(targetKey);
                // 이종복 "F=ma": event.is_crit/event.damage는 4탄환을 합산한 값이라, 마지막 탄환
                // 자신의 착탄 이펙트(크리 색/숫자)는 그 탄환 고유의 값(bullet_hits 마지막 항목)을
                // 따로 써야 한다 - 안 그러면 크리 안 난 마지막 탄환이 크리 색으로 반짝이거나, 그
                // 탄환 혼자만의 피해가 아니라 4발 합산 숫자가 뜬다(김크장 "GPT 킬러"는 이미 같은
                // 방식으로 마지막 탄환의 hit.shown_damage를 쓰고 있어서 이 문제가 없다).
                const lastBulletHit = event.bullet_hits ? event.bullet_hits[event.bullet_hits.length - 1] : null;
                const hitIsCrit = lastBulletHit ? lastBulletHit.is_crit : event.is_crit;
                const hitDamage = lastBulletHit ? (lastBulletHit.shown_damage ?? lastBulletHit.damage) : (event.shown_damage ?? event.damage);
                const hitInvincibleBlock = lastBulletHit ? lastBulletHit.invincible_block : event.invincible_block;
                flashHit(targetKey, hitIsCrit, event.type_multiplier, hitDamage, hitInvincibleBlock);
                // 배 "개량한복" - 이 타격(F=ma면 마지막 탄환 고유의 값, 아니면 이 공격 전체)이 막
                // target을 50% 미만으로 떨어뜨렸으면 지금(=실제 착탄 시점) 무적 이펙트를 재생한다.
                // 앞선 탄환이 원인이었던 경우는 onLetterArrive 쪽에서 이미 처리한다.
                const hitLowHpShieldSeconds = lastBulletHit ? lastBulletHit.low_hp_shield_seconds : event.low_hp_shield_seconds;
                grantLowHpShieldVisual(targetKey, event.target, hitLowHpShieldSeconds, event.time);
                // 이의진 type2 기본공격 부가효과(_apply_type2_stun_if_active) - 남성 대상이면 기절.
                // applyHitVisual()은 근접 스윙/원거리 투사체 도착 지연 뒤에 호출될 수 있으므로,
                // event.time이 아니라 지금(battleRendererConfig.currentSimTime())을 지속시간 기준으로 삼는다 - 지연 없이
                // 곧바로 불리는 경로에서는 battleRendererConfig.currentSimTime()이 event.time과 사실상 같은 값이라 안전하다.
                if (event.target_stunned) {
                    flashEffectAura(targetKey, "cc");
                    setStatusIcon(targetKey, "stun", {
                        source: `${event.actor}:stun`,
                        untilSimTime: battleRendererConfig.currentSimTime() + (event.stun_seconds || 0),
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
                if (actorKey) battleRendererConfig.meleeHitPending[actorKey] = true;
                setTimeout(() => {
                    if (actorKey) battleRendererConfig.meleeHitPending[actorKey] = false;
                    applyHitVisual();
                }, battleRendererConfig.effectLaunchDelayMs);
            });
        } else if (actorKey && targetKey) {
            // 원거리는 공격 애니메이션(윈드업)을 먼저 시작하고, 3프레임쯤 재생된 뒤에야 투사체/이펙트가 나간다.
            // 대상이 등 뒤(자기 원거리 자리까지 파고든 적 등)에 있으면 사진을 반전시켜 그쪽으로 발사한다.
            faceToward(actorKey, targetKey);
            if (actorKey) playAttackFrames(actorKey);
            battleRendererConfig.rangedResolvePending[actorKey] = true;
            // 이종복 "F=ma": 백엔드가 대미지를 4탄환으로 실제로 나눠 적용한 결과(bullet_hits)를
            // 실어 보내면, 마지막 글자 전까지는 그 탄환만큼만 체력바/피격 이펙트를 미리 반영한다.
            // 로그(피해 숫자)는 아래 applyHitVisual이 마지막 글자에서 총합(event.damage)으로 한 번만
            // 띄운다 - onLetterArrive는 그 로그에는 관여하지 않는다.
            const bulletHits = event.bullet_hits;
            // 로스터 체력바 표시용 러닝 값 - battleRendererConfig.units[targetKey].hp는 이미 최종값으로 덮어써져 있어서
            // (위 targetHpBeforeThisAttack 캡처 지점 참고) 그걸 그대로 그리면 첫 탄환에서부터 다
            // 깎인 것처럼 보인다. 탄환이 도착할 때마다 그 탄환의 실제 피해량만큼만 로컬로 깎아서
            // 단계적으로 보여주고, 사망 판정에 쓰이는 진짜 battleRendererConfig.units[targetKey].hp는 건드리지 않는다.
            let bulletDisplayHp = targetHpBeforeThisAttack;
            if (bulletHits && !targetWasAlreadyDead && targetKey) setPendingDisplayHp(targetKey, bulletDisplayHp);
            const onLetterArrive = (bulletHits && !targetWasAlreadyDead && targetKey)
                ? (i) => {
                    if (i >= bulletHits.length - 1) return;
                    if (bulletDisplayHp != null) {
                        bulletDisplayHp = Math.max(0, bulletDisplayHp - bulletHits[i].damage);
                    }
                    if (bulletHits[i].target_shield_after !== undefined) {
                        const shieldBefore = battleRendererConfig.units[targetKey].shield || 0;
                        battleRendererConfig.units[targetKey].shield = bulletHits[i].target_shield_after;
                        if (shieldBefore > 0 && bulletHits[i].target_shield_after <= 0) playShieldHit(targetKey);
                    }
                    // 다른 배우 이벤트가 그 사이 이 대상을 이미 더 낮은 체력으로 반영해뒀을 수 있으니
                    // (동시 진행 애니메이션), 절대 진짜 현재 체력보다 높게(덜 깎인 것처럼) 보여주지 않는다.
                    const bulletClampedDisplayHp = bulletDisplayHp == null ? undefined : Math.max(battleRendererConfig.units[targetKey].hp, bulletDisplayHp);
                    setPendingDisplayHp(targetKey, bulletClampedDisplayHp);
                    renderUnit(targetKey, bulletClampedDisplayHp);
                    // 탄환마다 크리티컬을 독립적으로 굴리므로(백엔드), 그 탄환 고유의 is_crit로 반짝인다.
                    flashHit(targetKey, bulletHits[i].is_crit, event.type_multiplier, bulletHits[i].shown_damage ?? bulletHits[i].damage, bulletHits[i].invincible_block);
                    // 배 "개량한복" - 마지막 탄환이 아니라 이 중간 탄환이 target을 50% 미만으로
                    // 떨어뜨린 경우는 여기서(그 탄환 자신이 실제로 착탄하는 이 순간) 처리한다.
                    grantLowHpShieldVisual(targetKey, event.target, bulletHits[i].low_hp_shield_seconds, event.time);
                }
                : null;
            setTimeout(() => {
                battleRendererConfig.playRangedAttack(actorKey, targetKey, () => {
                    battleRendererConfig.rangedResolvePending[actorKey] = false;
                    // 근접 분기(waitForMeleeArrival)와 동일한 가드 - 투사체가 날아가는 동안 대상이
                    // 다른 이벤트로 먼저 죽었다면, 이미 쓰러진 캐릭터에게 피격 이펙트/피해 로그를
                    // 한 번 더 띄우지 않는다(HP는 이미 위에서 즉시 반영돼 있으므로 안전).
                    if (targetWasAlreadyDead) return;
                    applyHitVisual();
                }, onLetterArrive);
            }, battleRendererConfig.effectLaunchDelayMs);
        } else {
            if (actorKey) playAttackFrames(actorKey);
            applyHitVisual();
        }
    }

}
