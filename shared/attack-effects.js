// 캐릭터 공격/스킬 시각 효과 - 전술대회(arena/arena-battle.js), 개발자화면(devtest/devtest.js),
// 토벌전(raid-prototype/raid-prototype.js) 세 화면이 공유하는 렌더링 함수 모음. 원래는 arena-battle.js
// 안에만 있던 코드였는데 devtest.js가 거의 동일한 사본을 통째로 들고 있었고, raid-prototype이 세 번째
// 사본이 될 뻔해서 이 파일로 뽑아냈다 - "언제/왜 이 효과를 재생하는가"(백엔드 이벤트 파싱, HP 반영,
// 로그, 애니메이션 체이닝 타이밍)는 각 화면 자기 코드에 그대로 남아있고, 이 파일은 순수하게 "화면 위에
// 무엇을 어떻게 그리는가"만 담당한다.
//
// 각 화면은 자기 DOM 컨벤션이 다르므로(arena/devtest는 문자열 키 + [data-unit] 셀렉터, raid-prototype은
// 이미 리졸브된 엘리먼트를 직접 넘김) 페이지 로드 시 한 번 initAttackEffects(config)를 불러서 그
// 컨벤션을 알려준다. 이후 모든 함수는 문자열 키/DOM 엘리먼트 둘 다 그대로 받아들인다.
//
// EFFECT_TYPE_VISUALS는 characters.json의 skill_mechanics.effect_type -> 이 파일이 제공하는 전용
// 이펙트 함수 이름 매핑이다. 새 캐릭터가 생기거나 새 전용 이펙트를 추가할 때 이 파일 하나에만 함수를
// 쓰고 표에 등록하면 세 화면 모두 자동으로 같은 이펙트를 쓸 수 있다. 표에 없는 effect_type은 전용
// 투사체가 없다는 뜻 - 각 화면은 flashHit/flashEffectAura만으로 충분하다.

let attackEffectsConfig = {
    resolveUnitEl: (key) => key,
    fieldEl: null,
    layerEl: null,
    showTypeLabel: null, // (key, "weak"|"resist") - 로스터 상성 라벨(있는 화면만)
    showCritLabel: null, // (key) - 치명타 라벨(있는 화면만)
    effectLaunchDelayMs: 180, // playGoldenSelfDestruct의 detonate 진입 시각 - 호출 화면의 EFFECT_LAUNCH_DELAY_MS와 일치해야 함
};

function initAttackEffects(config) {
    attackEffectsConfig = {
        resolveUnitEl: config.resolveUnitEl,
        fieldEl: config.fieldEl,
        layerEl: config.layerEl || config.fieldEl,
        showTypeLabel: config.showTypeLabel || null,
        showCritLabel: config.showCritLabel || null,
        effectLaunchDelayMs: config.effectLaunchDelayMs || 180,
    };
}

// 문자열 키(예: "attacker-front")면 페이지가 알려준 방식으로 리졸브하고, 이미 DOM 엘리먼트면 그대로 쓴다.
function resolveEffectEl(keyOrEl) {
    if (!keyOrEl) return null;
    return typeof keyOrEl === "string" ? attackEffectsConfig.resolveUnitEl(keyOrEl) : keyOrEl;
}

function fieldRelativeCenter(el) {
    const fieldRect = attackEffectsConfig.fieldEl.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - fieldRect.left, y: rect.top + rect.height / 2 - fieldRect.top };
}

// imgEl 안에서 (fracX, fracY) 비율 위치에 해당하는 화면 좌표를 필드 기준 상대좌표로 계산한다.
// (object-fit:contain + object-position:bottom center 규칙을 그대로 재현.) flipped(좌우 반전) 상태면 fracX도 뒤집는다.
function imageContentPoint(imgEl, fracX, fracY) {
    const fieldRect = attackEffectsConfig.fieldEl.getBoundingClientRect();
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

// start->end 방향의 각도(도) - 회전이 필요한 투사체(크레파스/유성)에 쓴다.
function angleDeg(start, end) {
    return Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
}

// 포물선 이동 공용 로직: 직선 보간 + 사인 곡선으로 위로 솟았다가 내려오는 오프셋을 매 프레임 계산한다.
// el은 이미 layer에 붙어있어야 하고, 도착하면 el을 제거하고 onArrive를 부른다. startTime은 반드시
// "첫 프레임이 실제로 실행되는 시각"으로 잡아야 한다 - 안 그러면 메인 스레드가 바빴던 직후 첫 콜백이
// 늦게 불릴 때 progress가 곧장 1로 계산돼서 투사체가 순간이동해버린다.
function animateArcMotion(el, start, end, durationMs, arcHeight, onArrive) {
    let startTime = null;
    function frame(now) {
        if (startTime === null) startTime = now;
        const progress = Math.min(1, (now - startTime) / durationMs);
        const x = start.x + (end.x - start.x) * progress;
        const y = start.y + (end.y - start.y) * progress - Math.sin(progress * Math.PI) * arcHeight;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        if (progress < 1) requestAnimationFrame(frame);
        else { el.remove(); onArrive(); }
    }
    requestAnimationFrame(frame);
}

// ===== 원거리 투사체(범용) =====
function spawnProjectile(actorKeyOrEl, targetKeyOrEl, onArrive) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    if (!layer || !actorImg || !targetImg) { onArrive(); return; }

    const start = fieldRelativeCenter(actorImg);
    const end = fieldRelativeCenter(targetImg);

    const dot = document.createElement("div");
    dot.className = "projectile-dot";
    dot.style.left = `${start.x}px`;
    dot.style.top = `${start.y}px`;
    layer.appendChild(dot);

    // 시작 위치를 반드시 한 번 리플로우로 "확정"시킨 뒤에 트랜지션을 걸어야 한다 - 안 그러면 브라우저가
    // 두 상태 변경을 하나로 묶어버려서 투사체가 날아가는 동작 없이 곧장 목표 지점에 나타날 수 있다.
    void dot.offsetWidth;
    dot.style.transition = `left ${PROJECTILE_TRAVEL_MS}ms linear, top ${PROJECTILE_TRAVEL_MS}ms linear`;
    dot.style.left = `${end.x}px`;
    dot.style.top = `${end.y}px`;

    setTimeout(() => {
        dot.remove();
        onArrive();
    }, PROJECTILE_TRAVEL_MS);
}

// 포물선: 직선 보간 + 사인 곡선(기본 원거리 폴백용).
function spawnProjectileArc(actorKeyOrEl, targetKeyOrEl, onArrive) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    if (!layer || !actorImg || !targetImg) { onArrive(); return; }

    const start = fieldRelativeCenter(actorImg);
    const end = fieldRelativeCenter(targetImg);
    const dot = document.createElement("div");
    dot.className = "projectile-dot";
    layer.appendChild(dot);

    animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 70, onArrive);
}

const PROJECTILE_TRAVEL_MS = 260;

// ===== 방임석 전용: 물감 투척 =====
// 기본공격 - 직선, 항상 황금빛(colorClass="paint-gold" 고정).
function spawnPaintProjectile(actorKeyOrEl, targetKeyOrEl, colorClass, onArrive) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    if (!layer || !actorImg || !targetImg) { onArrive(); return; }

    const start = fieldRelativeCenter(actorImg);
    const end = fieldRelativeCenter(targetImg);
    const dot = document.createElement("div");
    dot.className = `paint-projectile ${colorClass}`;
    dot.style.left = `${start.x}px`;
    dot.style.top = `${start.y}px`;
    layer.appendChild(dot);

    void dot.offsetWidth;
    dot.style.transition = `left ${PROJECTILE_TRAVEL_MS}ms linear, top ${PROJECTILE_TRAVEL_MS}ms linear`;
    dot.style.left = `${end.x}px`;
    dot.style.top = `${end.y}px`;

    setTimeout(() => {
        dot.remove();
        onArrive();
    }, PROJECTILE_TRAVEL_MS);
}

// 스킬("제목은 관객이 정하세요") - 포물선. colorClass: 물감 없으면 흰색, 있으면 소모한 물감 색.
function spawnPaintSkillProjectile(actorKeyOrEl, targetKeyOrEl, colorClass, onArrive) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    if (!layer || !actorImg || !targetImg) { onArrive(); return; }

    const start = fieldRelativeCenter(actorImg);
    const end = fieldRelativeCenter(targetImg);
    const dot = document.createElement("div");
    dot.className = `paint-projectile ${colorClass}`;
    layer.appendChild(dot);

    animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 60, onArrive);
}

// ===== 김남옥 전용: 원통형 크레파스 다트 =====
// 기본공격 - 포물선. 대상이 전방이면 진분홍, 후방/복제체면 푸른색(colorClass는 호출부가 결정).
function spawnCrayonProjectile(actorKeyOrEl, targetKeyOrEl, colorClass, onArrive) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    if (!layer || !actorImg || !targetImg) { onArrive(); return; }

    const start = fieldRelativeCenter(actorImg);
    const end = fieldRelativeCenter(targetImg);

    const dot = document.createElement("div");
    dot.className = `crayon-projectile ${colorClass}`;
    dot.style.transform = `rotate(${angleDeg(start, end)}deg)`;
    layer.appendChild(dot);

    animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 60, onArrive);
}

// 스킬("엑스칼리버") - 진분홍+푸른 크레파스 두 개가 나란히 직선으로 동시에 대상에게 날아간다.
function playDualCrayonSkillProjectile(actorKeyOrEl, targetKeyOrEl, onArrive) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    if (!layer || !actorImg || !targetImg) { onArrive(); return; }

    const start = fieldRelativeCenter(actorImg);
    const end = fieldRelativeCenter(targetImg);
    const angle = angleDeg(start, end);
    const rad = (angle * Math.PI) / 180;
    const durationMs = PROJECTILE_TRAVEL_MS * 1.4;

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

// ===== 이종복 전용: 붉은 "mg"가 유성처럼 꼬리를 끌며 날아간다 ("질량 충격파") =====
function spawnMeteorProjectile(actorKeyOrEl, targetKeyOrEl, onArrive) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
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

    void el.offsetWidth;
    el.style.transition = `left ${durationMs}ms linear, top ${durationMs}ms linear`;
    el.style.left = `${end.x}px`;
    el.style.top = `${end.y}px`;

    setTimeout(() => {
        el.remove();
        onArrive();
    }, durationMs);
}

// ===== 강 희 전용: 얼굴 쪽에서 뿜어져 나오는 좁은 부채꼴 초록 입냄새(가스) ("생화학 구취 브레스") =====
// wrap이 시작점(얼굴)에서 사거리(length)만큼의 폭/회전을 잡고, --reach(=length)를 자식들에게 물려줘서
// 연기/입자가 실제 사거리에 비례해 날아가게 한다. 적 전체를 동시에 때리는 스킬이라 도착 판정은 항상
// 이 함수 전체가 끝나는 시점(durationMs 후)에 한 번에 난다.
function spawnGasBreathStream(actorKeyOrEl, onArrive) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    const fieldEl = attackEffectsConfig.fieldEl;
    if (!layer || !actorImg || !fieldEl) { onArrive(); return; }

    const fieldRect = fieldEl.getBoundingClientRect();
    const start = fieldRelativeCenter(actorImg);
    start.y -= 60; // 얼굴 높이 정도로 살짝 위에서 시작
    const end = { x: fieldRect.width, y: start.y };
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const angle = angleDeg(start, end);
    const durationMs = 1150;

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

// ===== 불빠따 김어진 전용: 캐스터 발밑에서 좌우로 번져나가는 땅불(캔버스) ("불빠따") =====
// 아군 1명 + 적 전체를 동시에 때리는 스킬이라 좌/우 양쪽에 독립적인 최대 사거리를 두고, 각 대상은
// 불이 실제로 그 x좌표까지 번진 시점(자기 쪽 사거리 대비 거리 비율)에 맞춰 onHit이 불린다. hits는
// { target, target_side, ... } 형태의 배열(호출부의 데이터 그대로) - 여기서는 위치 계산에만 쓴다.
function spawnGroundFireCanvas(actorKeyOrEl, hits, resolveHitElFn, onHit) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    const fieldEl = attackEffectsConfig.fieldEl;
    if (!layer || !fieldEl || !actorImg) { hits.forEach(onHit); return; }

    const fieldRect = fieldEl.getBoundingClientRect();
    const actorRect = actorImg.getBoundingClientRect();
    const groundY = actorRect.bottom - fieldRect.top;
    const casterX = actorRect.left + actorRect.width / 2 - fieldRect.left;

    // 대상마다 캐스터 기준 좌(-1)/우(1) 방향과 거리를 구한다.
    const targets = hits.map((hit) => {
        const targetImg = resolveHitElFn(hit);
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

    // 불이 터지는 충격 연출(화면 흔들림) - 필드 전체에 건다.
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
    // 번지고 먼저 사그라들 수 있다.
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

// ===== 임소정 전용: 캐스터-대상을 잇는 지그재그 번개 ("전자기파") =====
const ELECTRIC_ORIGIN_BASIC = { fx: 0.9, fy: 0.27 };
const ELECTRIC_ORIGIN_SKILL = { fx: 0.9, fy: 0.28 };
const electricBoltActive = {};

// x1,y1->x2,y2를 여러 구간으로 쪼개고, 각 구간을 진행 방향에 수직인 방향으로 무작위로 흔들어(가운데일수록
// 많이 흔들리도록 sin 곡선으로 스케일) 지그재그 경로를 만든다.
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

// 번개 줄기 한 가닥을 두 겹으로 그린다 - 바깥쪽(색이 있는 굵은 겹, 그림자 번짐)과 안쪽(거의 흰색인 얇은 코어).
function drawLightningBolt(ctx, pts, width, alpha, isUlt) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowBlur = isUlt ? 24 : 18;
    ctx.shadowColor = isUlt ? `rgba(255,210,90,${0.72 * alpha})` : `rgba(120,208,255,${0.62 * alpha})`;
    ctx.strokeStyle = isUlt ? `rgba(255,197,62,${0.92 * alpha})` : `rgba(76,165,255,${0.86 * alpha})`;
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

// 캐스터-대상을 잇는 메인 번개 줄기 + 가지 + 스파크(기본공격=isUlt false, 푸른색. 스킬=isUlt true,
// 노란색+가지 더 많고 스파크 더 많고 착탄 섬광까지). 전기는 사실상 즉발이라 onArrive는 짧게(80ms)만
// 대기한 뒤 부른다(null이면 안 부름 - 이미 피해를 즉시 반영해둔 경우) - 그 뒤로도 스파크 잔상은
// electricBoltActive가 꺼질 때까지 이어진다.
function playElectricBolt(actorKeyOrEl, targetKeyOrEl, isUlt, onArrive, origin) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    const fieldEl = attackEffectsConfig.fieldEl;
    if (!layer || !fieldEl || !actorImg || !targetImg) { if (onArrive) onArrive(); return; }

    const fieldRect = fieldEl.getBoundingClientRect();
    const o = origin || ELECTRIC_ORIGIN_BASIC;
    const start = imageContentPoint(actorImg, o.fx, o.fy);
    const end = fieldRelativeCenter(targetImg);
    const actorKey = typeof actorKeyOrEl === "string" ? actorKeyOrEl : actorImg;

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

// ===== 서민석 전용: 하트 모양 투사체 ("고백") - 포물선. 대상 여성이면 heart-red, 아니면 heart-pink =====
function spawnHeartProjectile(actorKeyOrEl, targetKeyOrEl, colorClass, onArrive) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    if (!layer || !actorImg || !targetImg) { onArrive(); return; }

    const start = fieldRelativeCenter(actorImg);
    const end = fieldRelativeCenter(targetImg);
    const el = document.createElement("div");
    el.className = `heart-projectile ${colorClass}`;
    el.textContent = "❤";
    layer.appendChild(el);

    animateArcMotion(el, start, end, PROJECTILE_TRAVEL_MS * 1.7, 90, onArrive);
}

// ===== 이영웅 전용: 치유 대상 머리 위에서 초록 하트가 천천히 내려온다 ("청진기 진료") =====
function spawnHealingHeart(targetKeyOrEl, onArrive) {
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
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

    void wrap.offsetWidth;
    wrap.style.transition = `top ${durationMs}ms ease-in`;
    wrap.style.top = `${end.y}px`;

    setTimeout(() => {
        wrap.remove();
        onArrive();
    }, durationMs);
}

// ===== 피격/오라(범용) =====
function flashHit(keyOrEl, isCrit, typeMultiplier) {
    const imgEl = resolveEffectEl(keyOrEl);
    if (!imgEl) return;

    const key = typeof keyOrEl === "string" ? keyOrEl : null;
    if (typeof typeMultiplier === "number" && key) {
        if (typeMultiplier > 1) attackEffectsConfig.showTypeLabel?.(key, "weak");
        else if (typeMultiplier < 1) attackEffectsConfig.showTypeLabel?.(key, "resist");
    }

    if (isCrit) {
        imgEl.classList.add("crit-flash");
        if (key) attackEffectsConfig.showCritLabel?.(key);
        setTimeout(() => imgEl.classList.remove("crit-flash"), 400);
        return;
    }

    imgEl.classList.add("hit-flash");
    setTimeout(() => imgEl.classList.remove("hit-flash"), 250);
}

const EFFECT_AURA_COLORS = {
    buff: "#ff4d3d",
    debuff: "#4d8bff",
    cc: "#b266ff",
    heal: "#4ee06a",
    special: "#ffffff",
};
const auraFlashTokens = {};

// 효과를 "받은" 대상에게 색 오라가 나왔다가 사라진다. 색은 EFFECT_AURA_COLORS 기준(버프=붉은색,
// 디버프=파란색, CC기=보라색, 회복=연두색, 스페셜(무적 등)=흰색).
function flashEffectAura(keyOrEl, kind) {
    const imgEl = resolveEffectEl(keyOrEl);
    const color = EFFECT_AURA_COLORS[kind];
    if (!imgEl || !color) return;
    const tokenKey = typeof keyOrEl === "string" ? keyOrEl : imgEl;
    imgEl.classList.remove("effect-aura-flash");
    void imgEl.offsetWidth;
    imgEl.style.setProperty("--effect-aura-color", color);
    imgEl.classList.add("effect-aura-flash");
    const myToken = (auraFlashTokens[tokenKey] = (auraFlashTokens[tokenKey] || 0) + 1);
    setTimeout(() => {
        if (auraFlashTokens[tokenKey] === myToken) imgEl.classList.remove("effect-aura-flash");
    }, 900);
}

// ===== 원거리 기본공격 스타일 매핑/디스패치 =====
// 캐릭터 이름 -> 원거리 기본공격 전용 연출 스타일. 여기 없는(=근거리이거나 목록에 없는) 캐릭터는
// 각 화면이 자체적으로 근접 이동/공용 직선 투사체(spawnProjectile)로 처리한다. 새 캐릭터의 기본공격
// 전용 연출을 추가할 때도 이 표 하나 + 위 spawnXxx 함수 하나만 있으면 세 화면 모두에 반영된다.
const RANGED_ATTACK_STYLE = {
    "윤대웅": "instant_flash",   // 카메라 셔터 플래시 - 투사체 이동 없음
    "김남옥": "crayon",          // 원통형 크레파스 다트 - 포물선, 대상이 전방이면 진분홍/후방이면 푸른색
    "이종복": "text_particles",  // F/=/m/a 네 글자 순차 발사 - 직선
    "임소정": "electric",        // 캐스터-대상을 잠깐 잇는 푸른 전기
    "서민석": "book",            // 책 던지기 - 포물선, 계속 회전
    "이의진": "eye_laser",       // 눈에서 발사되는 레이저 - type1(빨강)/type2(청록) 두 가지, isType2로 분기
    "방임석": "paint_gold",      // 물감 투척 - 직선, 항상 황금빛(기본공격은 물감 색과 무관)
};

// style 문자열(RANGED_ATTACK_STYLE의 값) 기준으로 실제 전용 연출 함수를 호출한다. 호출부는
// "이 배우의 style이 뭔지"(자기 units 레지스트리 조회)만 알아서 넘기면 된다 - opts.isType2는
// 이의진 전용(염색체 변환 상태에 따라 eye_laser의 type1/type2가 갈림).
function playRangedAttackByStyle(style, actorKeyOrEl, targetKeyOrEl, onArrive, opts = {}) {
    if (style === "instant_flash") playInstantFlash(actorKeyOrEl, targetKeyOrEl, onArrive);
    else if (style === "text_particles") playTextParticles(actorKeyOrEl, targetKeyOrEl, onArrive);
    else if (style === "crayon") {
        // 원래(arena-battle.js) 기준: 대상이 "-front" 슬롯이면 진분홍, 아니면(후방/복제체) 푸른색.
        // 문자열 키가 아닌 대상(예: raid-prototype처럼 보스를 DOM 엘리먼트로 직접 넘기는 화면)은
        // front/back 구분이 없으므로 주 타겟이라는 뜻에서 진분홍을 기본값으로 쓴다.
        const colorClass = typeof targetKeyOrEl === "string" && !targetKeyOrEl.endsWith("-front") ? "crayon-blue" : "crayon-pink";
        spawnCrayonProjectile(actorKeyOrEl, targetKeyOrEl, colorClass, onArrive);
    }
    else if (style === "electric") playElectricBolt(actorKeyOrEl, targetKeyOrEl, false, onArrive, ELECTRIC_ORIGIN_BASIC);
    else if (style === "book") spawnBookProjectile(actorKeyOrEl, targetKeyOrEl, onArrive);
    else if (style === "eye_laser") spawnEyeLaserBeam(actorKeyOrEl, targetKeyOrEl, opts.isType2 ? "type2" : "type1", onArrive);
    else if (style === "paint_gold") spawnPaintProjectile(actorKeyOrEl, targetKeyOrEl, "paint-gold", onArrive);
    else if (style === "arc") spawnProjectileArc(actorKeyOrEl, targetKeyOrEl, onArrive);
    else spawnProjectile(actorKeyOrEl, targetKeyOrEl, onArrive);
}

// effect_type(스킬 매커니즘) -> 이 파일이 제공하는 전용 이펙트 함수 이름. 여기 없는 effect_type은
// 전용 투사체가 없다는 뜻(flashHit/flashEffectAura만으로 충분) - arena-battle.js의 dispatchEffectType
// 분기를 참고해서 정리했다. 방임석(consume_paint_multi_effect, 물감 색깔별로 여러 번 호출하는 다중
// 분기), 김남옥(conditional_target_debuff, 대상이 여성일 때만 발동하는 조건부), 이영웅
// (heal_ally_percent_max_hp, 아군 전체 각자에게 spawnHealingHeart를 반복 호출)은 단순 1:1 매핑으로
// 표현되지 않아 이 표에 넣지 않았다 - 호출부가 직접 spawnPaintSkillProjectile/
// playDualCrayonSkillProjectile/spawnHealingHeart를 호출해서 판단한다.
const EFFECT_TYPE_VISUALS = {
    damage_hp_percent_plus_atk: "spawnMeteorProjectile",  // 이종복 "질량 충격파"
    aoe_gendered_damage: "spawnHeartProjectile",           // 서민석 "고백"
    aoe_enemy_damage: "spawnGasBreathStream",               // 강 희 "생화학 구취 브레스"
    aoe_all_others_damage: "spawnGroundFireCanvas",         // 불빠따 김어진 "불빠따"
    debuff_atk_and_damage: "playElectricBolt",              // 임소정 "전자기파"
};

// ===== 기본공격 전용 이펙트(캐릭터별 원거리 기본공격 연출) =====
// 이의진 전용 - 눈에서 발사되는 레이저(참고 파일 eye_laser_switch.html). fx/fy는 attack 프레임 원본
// 픽셀 기준 눈 위치 비율(0~1, 왼쪽위 기준) - 레이저가 엉뚱한 위치에서 나가면 여기 두 값만 고치면 된다.
// type1(빨강, 기본 상태) / type2(청록, 변신 상태 전용 - 지글거리는 플리커가 얹힌다).
const EYE_LASER_ORIGIN = {
    type1: { fx: 0.63, fy: 0.12 },
    type2: { fx: 0.48, fy: 0.17 },
};

// 눈에서 대상까지 레이저 빔이 "자라나며" 뻗어나간다. 폭(width)을 0에서 실제 거리까지 트랜지션으로
// 늘리는 방식이라, 빔의 끝(대상 쪽)이 실제로 화면 위에서 대상 위치에 도달하는 시점과 onArrive 호출
// 시점이 정확히 일치한다 - 즉 "빔이 직접 닿아야" 피해/기절 판정이 반영된다.
function spawnEyeLaserBeam(actorKeyOrEl, targetKeyOrEl, variant, onArrive) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
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
    wrap.innerHTML = `
        <div class="eye-laser-glow"></div>
        <div class="eye-laser-core"></div>
    `;
    layer.appendChild(wrap);

    const flare = document.createElement("div");
    flare.className = `eye-laser-flare eye-laser-flare-${variant}`;
    flare.style.left = `${start.x}px`;
    flare.style.top = `${start.y}px`;
    layer.appendChild(flare);

    void wrap.offsetWidth;
    wrap.style.transition = `width ${durationMs}ms linear`;
    wrap.style.width = `${distance}px`;

    setTimeout(() => {
        wrap.remove();
        flare.remove();
        onArrive();
    }, durationMs);
}

// 서민석 기본공격 전용: 책 모양 투사체, 포물선(책이 계속 회전하는 건 CSS 애니메이션이 알아서 함).
function spawnBookProjectile(actorKeyOrEl, targetKeyOrEl, onArrive) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    if (!layer || !actorImg || !targetImg) { onArrive(); return; }

    const start = fieldRelativeCenter(actorImg);
    const end = fieldRelativeCenter(targetImg);
    const el = document.createElement("div");
    el.className = "book-projectile";
    layer.appendChild(el);

    animateArcMotion(el, start, end, PROJECTILE_TRAVEL_MS * 1.6, 70, onArrive);
}

// 윤대웅 전용: 투사체 이동 없이 대상 위치에서 즉시 플래시만 터진다(카메라 셔터).
function playInstantFlash(actorKeyOrEl, targetKeyOrEl, onArrive) {
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
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
function playTextParticles(actorKeyOrEl, targetKeyOrEl, onArrive) {
    const letters = ["F", "=", "m", "a"];
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
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
            void el.offsetWidth;
            el.style.transition = `left ${PROJECTILE_TRAVEL_MS}ms linear, top ${PROJECTILE_TRAVEL_MS}ms linear`;
            el.style.left = `${end.x}px`;
            el.style.top = `${end.y}px`;
            setTimeout(() => el.remove(), PROJECTILE_TRAVEL_MS + 50);
            if (i === letters.length - 1) setTimeout(onArrive, PROJECTILE_TRAVEL_MS);
        }, i * 100);
    });
}

// ===== 호(자폭 소환수) 전용: 캐릭터 스프라이트 자체의 황금빛 폭발 =====
// unitKey -> 자폭 연출이 진행 중인지 - 명중 판정 뒤에도 파티클/화면 흔들림이 잠깐 더 남아있을 수 있어서,
// 각 화면의 "이 유닛이 아직 애니메이션 중인가" 판정(anyActorStillFinishing 등)이 이 값도 함께 본다.
const goldenSelfDestructActive = {};

// 참고 데모(golden_self_destruct_optimized.html)의 4단계(charge=응축 -> implode=수축 -> detonate=폭발
// -> after=여운)를 캐릭터 스프라이트 크기에 맞춰 이식했다. 캐릭터 자체의 빛/스케일/소멸은 CSS
// (.golden-self-destruct, 실제 재생시간은 golden-self-destruct-char 키프레임의 1000ms 고정값)가 맡고,
// 여기서는 그 주변에 그려지는 파티클(코어 플래시/링/스파크/연기/스트릭)과 국소 화면 흔들림만 캔버스로
// 그린다. 실제 사망 처리(HP 반영/사망 로그 등)는 명중 시점에 따로 일어난다.
//
// 공격 애니메이션이 "시작"되는 시점(스윙 재생 시작, 명중보다 먼저)에 호출한다 - 다른 근접 캐릭터와
// 마찬가지로 실제 명중 판정은 attackEffectsConfig.effectLaunchDelayMs(스윙 몇 프레임 재생 후)에 나므로,
// charge/implode(응축/수축 - 아직 멀쩡히 빛나기만 하는 "뜸들이는" 구간)를 그 안에 다 압축해서, detonate
// (폭발/흔들림 절정) 진입 시각이 그 시간과 정확히 일치하도록 맞췄다 - 화면이 흔들리는 바로 그 순간에
// 다른 캐릭터들과 동일한 타이밍으로 명중 판정(대상 피격 + 자신의 소멸)이 함께 난다.
function playGoldenSelfDestruct(actorKeyOrEl) {
    const imgEl = resolveEffectEl(actorKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    const fieldEl = attackEffectsConfig.fieldEl;
    if (!layer || !fieldEl || !imgEl) return;
    const actorKey = typeof actorKeyOrEl === "string" ? actorKeyOrEl : imgEl;

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
    // detonate(폭발/흔들림 절정) 진입 시각이 다른 근접 캐릭터의 명중 판정 시각(effectLaunchDelayMs)과
    // 정확히 같아야 한다 - charge/implode(응축/수축)를 원래 참고 데모의 비율(480:160 ≈ 3:1)을
    // 유지한 채 그 시간 안에 압축해 넣는다. 폭발 자체(원래도 60ms 안팎의 짧은 burst)와 그 뒤 여운은
    // 원래 데모와 비슷한 길이를 그대로 둔다 - 뜸들이는 시간이 짧아졌다고 폭발/여운까지 짧아질 이유는 없다.
    const CHARGE_MS = attackEffectsConfig.effectLaunchDelayMs * 0.75;
    const IMPLODE_END_MS = attackEffectsConfig.effectLaunchDelayMs;
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
