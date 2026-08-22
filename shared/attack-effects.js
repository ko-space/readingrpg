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
    showTypeLabel: null, // (key, "weak"|"resist", damage, isCrit) - 로스터 상성 라벨(있는 화면만)
    showDamageLabel: null, // (key, damage, isCrit) - 피해 숫자 라벨(있는 화면만)
    effectLaunchDelayMs: 180, // playGoldenSelfDestruct의 detonate 진입 시각 - 호출 화면의 EFFECT_LAUNCH_DELAY_MS와 일치해야 함
    getSpeedMultiplier: () => 1, // 배속 연동(아래 speedMs 참고) - 호출 화면이 안 넘기면 항상 1배(고정 속도)
};

function initAttackEffects(config) {
    attackEffectsConfig = {
        resolveUnitEl: config.resolveUnitEl,
        fieldEl: config.fieldEl,
        layerEl: config.layerEl || config.fieldEl,
        showTypeLabel: config.showTypeLabel || null,
        showDamageLabel: config.showDamageLabel || null,
        effectLaunchDelayMs: config.effectLaunchDelayMs || 180,
        getSpeedMultiplier: config.getSpeedMultiplier || (() => 1),
    };
}

// 투사체/이펙트 재생 시간을 배속에 맞춰 늘이거나 줄인다 - 걷기(speedScale)와 캐스팅 애니메이션
// (playCastFrames)은 이미 playbackSpeed에 연동돼 있는데, 이 파일의 투사체 durationMs들은 전부 고정된
// 실제 ms 상수라 배속을 늦춰도 항상 같은 속도로 날아가는 불일치가 있었다 - 모든 setTimeout/CSS
// transition/animateArcMotion 재생 시간에 이 함수를 거치게 해서 나머지 연출과 같은 배속을 타게 한다.
function speedMs(ms) {
    return ms * attackEffectsConfig.getSpeedMultiplier();
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

// 짧은 시간에 같은 대상이 여러 번 맞으면(다단히트/근처 아군 동시 피격 등) 피해 숫자 팝업들이 전부
// 같은 지점에서 시작해 서로 겹쳐 안 읽히는 문제가 있었다 - 작은 원(반지름 jitterRadius) 안의 균등한
// 무작위 지점만큼 중심에서 살짝 어긋난 좌표를 돌려준다(showDamageLabel/showTypeLabel 전용). 반지름을
// sqrt(난수)로 스케일해야 넓이 기준으로 고르게 퍼진다(그냥 난수*r만 쓰면 중심 쪽으로 쏠림).
function jitterPoint(center, jitterRadius) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * jitterRadius;
    return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
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

// "화면 맨 끝" 폴백 전용(김크장/김국회처럼 서포터라 전장에 스프라이트가 없는 시전자) - .battle-field는
// 좌우 292px 로스터 패널 + 22px 간격을 낀 3단 그리드의 가운데 칸이라, 필드 자신의 경계(0~fieldRect.width)는
// 실제 화면(뷰포트) 가장자리보다 훨씬 안쪽이다. 필드가 아니라 진짜 뷰포트 가장자리를 기준으로 계산해서
// 필드 상대좌표로 변환한다 - side가 "defender"면 오른쪽(로스터 패널까지 지난) 가장자리, 아니면 왼쪽.
function viewportEdgeXRelativeToField(side, fieldRect) {
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    return side === "defender" ? viewportWidth - fieldRect.left + 20 : -fieldRect.left - 20;
}

// 포물선 이동 공용 로직: 직선 보간 + 사인 곡선으로 위로 솟았다가 내려오는 오프셋을 매 프레임 계산한다.
// el은 이미 layer에 붙어있어야 하고, 도착하면 el을 제거하고 onArrive를 부른다. startTime은 반드시
// "첫 프레임이 실제로 실행되는 시각"으로 잡아야 한다 - 안 그러면 메인 스레드가 바빴던 직후 첫 콜백이
// 늦게 불릴 때 progress가 곧장 1로 계산돼서 투사체가 순간이동해버린다.
function animateArcMotion(el, start, end, durationMs, arcHeight, onArrive) {
    const scaledDurationMs = speedMs(durationMs); // 이 함수 하나로 크레파스/하트/책/대포알 등 대부분의 포물선 투사체가 배속에 연동된다
    let startTime = null;
    function frame(now) {
        if (startTime === null) startTime = now;
        const progress = Math.min(1, (now - startTime) / scaledDurationMs);
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
    const travelMs = speedMs(PROJECTILE_TRAVEL_MS);
    dot.style.transition = `left ${travelMs}ms linear, top ${travelMs}ms linear`;
    dot.style.left = `${end.x}px`;
    dot.style.top = `${end.y}px`;

    setTimeout(() => {
        dot.remove();
        onArrive();
    }, travelMs);
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
    const travelMs = speedMs(PROJECTILE_TRAVEL_MS);
    dot.style.transition = `left ${travelMs}ms linear, top ${travelMs}ms linear`;
    dot.style.left = `${end.x}px`;
    dot.style.top = `${end.y}px`;

    setTimeout(() => {
        dot.remove();
        onArrive();
    }, travelMs);
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

// ===== 김국회 전용: 대포알(cannon_basic_attack.html 참고 데모 포팅) =====
// 국회의사당 기본공격과 "일당 독재" 패시브 스플래시가 함께 쓴다 - 포신 발사(머즐 플래시) -> 탄도
// 비행(크레파스와 같은 회전+포물선 방식, animateArcMotion 재사용) -> 착탄 폭발(임팩트 버스트) 순서.
// 포신이 스프라이트의 오른쪽 위쪽에 있어서(확인된 설계), 정중앙이 아니라 이 지점에서 발사된다 -
// 임소정의 ELECTRIC_ORIGIN_BASIC과 동일한 패턴(imageContentPoint, 좌우 반전 자동 보정).
const PARLIAMENT_CANNON_ORIGIN = { fx: 1, fy: 0.1 };

function spawnCannonMuzzleFlash(x, y) {
    const layer = attackEffectsConfig.layerEl;
    if (!layer) return;
    // CSS의 animation(cannon-muzzle-flash-pop 등)은 고정 시간으로 선언돼있어 배속과 무관하게 항상
    // 같은 속도로 돈다 - animationDuration을 인라인으로 덮어써서 CSS 쪽도 speedMs에 맞춰 늘이거나
    // 줄이고, 제거 타이밍(setTimeout)도 같은 값을 써서 애니메이션이 실제로 끝난 뒤에 지운다.
    const flashMs = speedMs(200);
    const flash = document.createElement("div");
    flash.className = "cannon-muzzle-flash";
    flash.style.left = `${x}px`;
    flash.style.top = `${y}px`;
    flash.style.animationDuration = `${flashMs}ms`;
    layer.appendChild(flash);
    setTimeout(() => flash.remove(), flashMs);

    // 참고 데모(cannon_basic_attack.html)의 burst(muzzleP,10,105,.22,'spark') - 포신에서 스파크
    // 파티클이 사방으로 튀는 부분을 CSS 애니메이션으로 재현(캔버스 대신 - 기본공격마다 매번 도는
    // 가벼운 이펙트라 개별 div가 더 싸다). 각도/거리를 매번 무작위로 흩어서 진짜 파편처럼 보이게 한다.
    const sparkMs = speedMs(240);
    const SPARK_COUNT = 9;
    for (let i = 0; i < SPARK_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 26 + Math.random() * 30;
        const spark = document.createElement("div");
        spark.className = "cannon-spark";
        spark.style.left = `${x}px`;
        spark.style.top = `${y}px`;
        spark.style.setProperty("--spark-dx", `${Math.cos(angle) * dist}px`);
        spark.style.setProperty("--spark-dy", `${Math.sin(angle) * dist}px`);
        spark.style.animationDuration = `${sparkMs}ms`;
        layer.appendChild(spark);
        setTimeout(() => spark.remove(), sparkMs);
    }
}

function spawnCannonShellProjectile(actorKeyOrEl, targetKeyOrEl, onArrive, casterSide, useBulletSprite = false) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    const fieldEl = attackEffectsConfig.fieldEl;
    if (!layer || !fieldEl || !targetImg) { onArrive(); return; }

    // 시전자 스프라이트를 못 찾으면(김국회처럼 서포터라 전장에 위치가 없는 경우) 김크장의 GPT 킬러
    // (playGptKillerVolley)와 동일하게 필드가 아니라 진짜 화면(뷰포트) 가장자리에서 발사한다
    // (viewportEdgeXRelativeToField) - casterSide로 소속 진영 쪽을 고른다.
    const fieldRect = fieldEl.getBoundingClientRect();
    const start = actorImg
        ? imageContentPoint(actorImg, PARLIAMENT_CANNON_ORIGIN.fx, PARLIAMENT_CANNON_ORIGIN.fy)
        : { x: viewportEdgeXRelativeToField(casterSide, fieldRect), y: fieldRect.height * 0.4 - 40 };
    const end = fieldRelativeCenter(targetImg);

    spawnCannonMuzzleFlash(start.x, start.y);

    const shell = document.createElement("div");
    shell.className = "cannon-shell";
    // 국회의사당 본인의 기본공격만 static/objects의 전용 탄환 이미지를 쓴다(확인된 요청) - "일당 독재"
    // 패시브 스플래시(useBulletSprite 없이 호출됨)는 원래 대포알 모양 그대로 유지한다. 뒤쪽 불꽃(::after)은
    // attack-effects.css의 .cannon-shell-sprite::after가 위치만 재조정할 뿐 모양/색은 그대로 둔다.
    if (useBulletSprite) {
        shell.classList.add("cannon-shell-sprite");
        shell.style.backgroundImage = `url(${API_BASE_URL}/static/objects/parliament_bullet.webp)`;
    }
    shell.style.transform = `rotate(${angleDeg(start, end)}deg)`;
    layer.appendChild(shell);

    const arcHeight = Math.max(28, Math.min(62, Math.abs(end.x - start.x) * 0.12));
    animateArcMotion(shell, start, end, PROJECTILE_TRAVEL_MS * 2, arcHeight, onArrive);
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
    const durationMs = speedMs(PROJECTILE_TRAVEL_MS * 1.4);

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
    const durationMs = speedMs(PROJECTILE_TRAVEL_MS * 1.5);

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

// ===== 배 전용: 대상 머리 위에서 떨어지는 감옥 ("유배 보내기") =====
// 다른 투사체와 달리 캐스터에서 날아가는 게 아니라 대상 바로 위에서 아래로 떨어진다. 피격판정은 감옥이
// 실제로 대상에게 닿는 시점(떨어지는 애니메이션이 끝나는 순간)에 나야 하므로, onLand(removeFn)이 그
// 시점에 불린다 - removeFn을 호출부가 직접 들고 있다가(기절 지속시간은 재생 배속/되감기에 따라 실제
// ms가 달라지므로, 그 환산은 이 공유 파일이 아니라 각 화면 자신의 realMsUntilSimTime이 맡는다) 기절이
// 끝나는 시뮬레이션 시각에 맞춰 직접 불러서 감옥을 치운다.
function dropPrisonOnTarget(targetKeyOrEl, onLand) {
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    const fieldEl = attackEffectsConfig.fieldEl;
    if (!layer || !fieldEl || !targetImg) { onLand(() => {}); return; }

    // fieldRelativeCenter는 대상의 세로 "중앙"을 주는데, .prison-drop-effect의 transform이
    // translate(-50%, -100%)라 top 좌표가 감옥의 "바닥"이 된다 - 중앙에 맞추면 감옥이 캐릭터 몸통
    // 중간에서 멈춰버린다. 캐릭터 스프라이트의 실제 바닥(발밑, getBoundingClientRect().bottom)까지
    // 떨어지도록 착지 지점을 다시 계산한다.
    const fieldRect = fieldEl.getBoundingClientRect();
    const imgRect = targetImg.getBoundingClientRect();
    const groundX = imgRect.left + imgRect.width / 2 - fieldRect.left;
    const groundY = imgRect.bottom - fieldRect.top;
    const fallMs = speedMs(380);

    const el = document.createElement("img");
    el.className = "prison-drop-effect";
    el.src = `${API_BASE_URL}/static/objects/back_prison.webp`;
    el.style.left = `${groundX}px`;
    el.style.top = `${groundY - 260}px`;
    layer.appendChild(el);

    void el.offsetWidth;
    el.style.transition = `top ${fallMs}ms cubic-bezier(0.55, 0, 1, 0.45)`;
    el.style.top = `${groundY}px`;

    let removed = false;
    const removeFn = () => {
        if (removed) return;
        removed = true;
        // 캐릭터가 죽을 때와 같은 실선무늬 스캔 디졸브(death-dissolve, arena-battle.css)로 사라지게
        // 한다 - 이 이펙트는 arena/devtest 공용이라 캐릭터 CSS에 기대지 않고 같은 키프레임을 여기
        // (attack-effects.css)에도 복제해뒀다. 애니메이션이 끝난 뒤에야 실제로 DOM에서 지운다.
        el.classList.add("prison-dissolving");
        setTimeout(() => el.remove(), speedMs(1100));
    };
    setTimeout(() => {
        el.classList.add("prison-drop-landed");
        onLand(removeFn);
    }, fallMs);
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
    // 적은 항상 시전자 반대편 진영에 있다 - attacker는 왼쪽 끝(fieldRect.width)을, defender는
    // 오른쪽... 이 아니라 그 반대(viewportEdgeXRelativeToField와 같은 관례: attacker=왼쪽 진영이라
    // 오른쪽 끝을 향해, defender=오른쪽 진영이라 왼쪽 끝(0)을 향해) 뿜는다. actorKeyOrEl의
    // "attacker-"/"defender-" 접두어(데이터 키)로 소속 진영을 판정한다 - 예전엔 시전자의 "지금 화면
    // 위치"(필드 중앙 기준 좌/우)로 판정했는데, 근접 접근 등으로 시전자가 걸어서 필드 중앙을 넘어간
    // 상태(예: 상대편 강 희가 맵 끝까지 이동한 뒤 시전)에서는 실제 소속 진영과 반대로 판정돼 브레스가
    // 거꾸로 나가는 버그가 있었다(확인된 버그). 진영을 알 수 없는 호출(레이드 프로토타입처럼 DOM
    // 엘리먼트를 직접 넘기는 경우)만 기존 위치 기반 추정으로 되돌아간다.
    const side = typeof actorKeyOrEl === "string" ? actorKeyOrEl.split("-")[0] : null;
    const endX = side === "attacker" ? fieldRect.width
        : side === "defender" ? 0
        : (start.x < fieldRect.width / 2 ? fieldRect.width : 0);
    const end = { x: endX, y: start.y };
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const angle = angleDeg(start, end);
    const durationMs = speedMs(1150);

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

    if (onArrive) setTimeout(onArrive, speedMs(80));
}

// 유니코드 하트(❤)는 iOS/iPadOS Safari에서 CSS color를 무시하는 고정색 이모지로 그려져 SVG로 대체
const HEART_SVG_MARKUP = `
    <svg viewBox="0 0 32 29" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 28C16 28 1 18.5 1 9.7C1 4.6 5 1 9.6 1C12.7 1 15 2.7 16 5.3C17 2.7 19.3 1 22.4 1C27 1 31 4.6 31 9.7C31 18.5 16 28 16 28Z"
              fill="currentColor" stroke="rgba(0,0,0,0.18)" stroke-width="0.6"/>
    </svg>
`;

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
    el.innerHTML = HEART_SVG_MARKUP;
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
    const durationMs = speedMs(1000);

    const wrap = document.createElement("div");
    wrap.className = "healing-heart-wrap";
    wrap.style.left = `${start.x}px`;
    wrap.style.top = `${start.y}px`;
    wrap.innerHTML = `
        <div class="healing-heart-aura"></div>
        <div class="healing-heart-glyph">${HEART_SVG_MARKUP}</div>
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
// damage(선택)가 있으면 피해 숫자를 함께 띄운다. weak/resist 글자가 뜨는 타격이면 별도로 뜨는 게
// 아니라 그 글자 자신의 두 번째 줄로(같은 팝업 안에 <br>) 곧바로 붙어서 나온다(showTypeLabel이 damage를
// 받아 처리). 아무 글자도 없는 평범한 타격이면 showDamageLabel이 대상 머리 위 기본 위치에 독립적으로
// 띄운다. 치명타는 더 이상 "치명타!" 글자를 따로 띄우지 않는다 - isCrit을 그대로 넘겨서, 숫자(위 둘 중
// 어느 쪽으로 뜨든) 뒤에 붉은 가시 돋친 타원 배경만 추가로 얹는다(showTypeLabel/showDamageLabel의
// isCrit 처리, CSS .label-damage-crit-burst 참고).
function flashHit(keyOrEl, isCrit, typeMultiplier, damage) {
    const imgEl = resolveEffectEl(keyOrEl);
    if (!imgEl) return;

    const key = typeof keyOrEl === "string" ? keyOrEl : null;
    let typeKind = null;
    if (typeof typeMultiplier === "number" && key) {
        if (typeMultiplier > 1) typeKind = "weak";
        else if (typeMultiplier < 1) typeKind = "resist";
    }

    imgEl.classList.add(isCrit ? "crit-flash" : "hit-flash");
    setTimeout(() => imgEl.classList.remove(isCrit ? "crit-flash" : "hit-flash"), isCrit ? 400 : 250);

    if (key) {
        if (typeKind) attackEffectsConfig.showTypeLabel?.(key, typeKind, damage, isCrit);
        else if (damage != null) attackEffectsConfig.showDamageLabel?.(key, damage, isCrit);
    }
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
    "국회의사당": "cannon",      // 대포알 - 포신 발사(머즐 플래시) -> 포물선 비행 -> 착탄 폭발
};

// style 문자열(RANGED_ATTACK_STYLE의 값) 기준으로 실제 전용 연출 함수를 호출한다. 호출부는
// "이 배우의 style이 뭔지"(자기 units 레지스트리 조회)만 알아서 넘기면 된다 - opts.isType2는
// 이의진 전용(염색체 변환 상태에 따라 eye_laser의 type1/type2가 갈림).
function playRangedAttackByStyle(style, actorKeyOrEl, targetKeyOrEl, onArrive, opts = {}) {
    if (style === "instant_flash") playInstantFlash(actorKeyOrEl, targetKeyOrEl, onArrive);
    else if (style === "text_particles") playTextParticles(actorKeyOrEl, targetKeyOrEl, onArrive, opts.onLetterArrive);
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
    else if (style === "cannon") spawnCannonShellProjectile(actorKeyOrEl, targetKeyOrEl, onArrive, undefined, true);
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
    const durationMs = speedMs(Math.max(110, distance * 0.6));

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
    setTimeout(() => flash.remove(), speedMs(250));
    setTimeout(onArrive, speedMs(80));
}

// 이종복 전용: "F", "=", "m", "a" 네 글자가 0.1초 간격으로 직선 발사된다.
// onLetterArrive(i) - 선택. 글자 하나가 도착할 때마다(마지막 포함) 호출된다. 이종복 "F=ma" 기본공격이
// 실제로 대미지를 4등분해서 각 글자 도착에 맞춰 체력바를 순서대로 반영하는 데 쓴다(호출부인
// arena-battle.js/devtest.js 참고) - 이 함수 자체는 언제나처럼 순수 연출만 담당하고, "그 도착 시점에
// 무엇을 반영할지"는 호출부가 결정한다.
function playTextParticles(actorKeyOrEl, targetKeyOrEl, onArrive, onLetterArrive) {
    const letters = ["F", "=", "m", "a"];
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    if (!layer || !actorImg || !targetImg) { onArrive(); return; }

    const start = fieldRelativeCenter(actorImg);
    const end = fieldRelativeCenter(targetImg);
    const travelMs = speedMs(PROJECTILE_TRAVEL_MS);

    letters.forEach((ch, i) => {
        setTimeout(() => {
            const el = document.createElement("div");
            el.className = "dt-char-particle";
            el.textContent = ch;
            el.style.left = `${start.x}px`;
            el.style.top = `${start.y}px`;
            layer.appendChild(el);
            void el.offsetWidth;
            el.style.transition = `left ${travelMs}ms linear, top ${travelMs}ms linear`;
            el.style.left = `${end.x}px`;
            el.style.top = `${end.y}px`;
            setTimeout(() => el.remove(), travelMs + 50);
            setTimeout(() => {
                if (onLetterArrive) onLetterArrive(i);
                if (i === letters.length - 1) onArrive();
            }, travelMs);
        }, speedMs(i * 100));
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


// ===== 신 "제 2 권한"(부활) 전용 =====
// 참고 데모(preview.html)의 4단계(지면 섬광 -> 룬 서클/링 확장 -> 상승 파티클 -> 여운)를 캐릭터
// 스프라이트 크기에 맞게 이식했다. 데모는 캐릭터 자체를 캔버스로 직접 그리지만, 실제 게임은 진짜
// <img> 스프라이트가 있으므로 그건 CSS(.revive-rising, attack-effects.css)로 등장시키고, 여기서는
// 그 주변의 지면 섬광/룬 서클/링/파티클만 국소 캔버스로 그린다. 최적화 원칙은 playGoldenSelfDestruct와
// 동일: 필드 전체 캔버스를 만들되 매 프레임 실제로 그려지는 좁은 영역만 clearRect하고, 파티클은
// 개수를 낮게 캡(최대 18개)한 채 미리 그려둔 작은 스프라이트를 drawImage로 재사용한다.
const reviveEffectActive = {};
// unitKey -> revive-rising을 새로 붙일 때마다 증가하는 토큰. 그 클래스를 지우는 setTimeout이 자기
// 토큰이 여전히 최신인지 확인해서, 그 사이 다시 죽었다 부활한 새 인스턴스의 revive-rising까지 잘못
// 지우는 걸 막는다(스킬 쿨다운상 사실상 불가능에 가깝지만, 방어적으로).
const reviveRiseTokens = {};

// onRise: 지면 섬광이 끝나고 캐릭터가 실제로 다시 나타나야 하는 순간(약 220ms 후)에 정확히 한 번
// 호출된다 - 호출부(arena-battle.js)가 여기서 renderUnit/로그/상태 아이콘 등 "부활 처리 자체"를
// 맡는다. 이 함수 자신은 캐릭터에 revive-rising 클래스를 붙였다 떼는 것과 순수 시각 효과만 담당한다.
function playReviveEffect(unitKeyOrEl, onRise) {
    const imgEl = resolveEffectEl(unitKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    const fieldEl = attackEffectsConfig.fieldEl;
    if (!layer || !fieldEl || !imgEl) { if (onRise) onRise(); return; }
    const unitKey = typeof unitKeyOrEl === "string" ? unitKeyOrEl : imgEl;

    reviveEffectActive[unitKey] = true;

    const fieldRect = fieldEl.getBoundingClientRect();
    const imgRect = imgEl.getBoundingClientRect();
    const cx = imgRect.left + imgRect.width / 2 - fieldRect.left;
    const cy = imgRect.bottom - fieldRect.top - 4;
    const radius = Math.max(30, imgRect.width * 0.62);

    const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
    const canvas = document.createElement("canvas");
    canvas.className = "revive-effect-canvas";
    canvas.style.width = `${fieldRect.width}px`;
    canvas.style.height = `${fieldRect.height}px`;
    canvas.width = Math.round(fieldRect.width * dpr);
    canvas.height = Math.round(fieldRect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layer.appendChild(canvas);

    // 파티클 공용 스프라이트 두 종류(청록/금빛)를 미리 그려두고 매 프레임 drawImage로 재사용한다
    // (golden-self-destruct의 spark 패턴과 동일한 이유 - arc()를 파티클마다 매번 그리는 것보다 훨씬 싸다).
    function makeDot(colorStops) {
        const c = document.createElement("canvas");
        c.width = c.height = 32;
        const g = c.getContext("2d");
        const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
        colorStops.forEach(([stop, color]) => grad.addColorStop(stop, color));
        g.fillStyle = grad;
        g.fillRect(0, 0, 32, 32);
        return c;
    }
    const moteSprite = makeDot([[0, "rgba(255,255,255,1)"], [0.35, "rgba(160,235,255,.9)"], [1, "rgba(120,210,255,0)"]]);
    const goldSprite = makeDot([[0, "rgba(255,250,230,1)"], [0.35, "rgba(255,224,140,.9)"], [1, "rgba(255,200,90,0)"]]);

    let particles = [];
    let rings = [];
    let risen = false;

    function spawnBurst() {
        for (let i = 0; i < 18; i++) {
            particles.push({
                x: cx + (Math.random() - 0.5) * radius * 1.1,
                y: cy + (Math.random() - 0.5) * radius * 0.4,
                vx: (Math.random() - 0.5) * 14,
                vy: -(50 + Math.random() * 90),
                size: 3 + Math.random() * 4,
                life: 0, maxLife: 0.5 + Math.random() * 0.5,
                gold: Math.random() < 0.3,
            });
        }
    }

    const FLASH_MS = speedMs(220);
    const RISE_MS = speedMs(430);
    const AFTER_MS = speedMs(500);
    const TOTAL_MS = FLASH_MS + RISE_MS + AFTER_MS;

    const startMs = performance.now();
    let lastMs = startMs;

    function frame(now) {
        const dt = Math.min(0.033, (now - lastMs) / 1000);
        lastMs = now;
        const t = now - startMs;

        let flashPower, ringPower;
        if (t < FLASH_MS) {
            flashPower = t / FLASH_MS;
            ringPower = flashPower * 0.5;
        } else if (t < FLASH_MS + RISE_MS) {
            if (!risen) {
                risen = true;
                rings.push({ r: radius * 0.6, a: 0.4, life: 0, max: 0.6 });
                rings.push({ r: radius * 0.8, a: 0.28, life: 0, max: 0.75 });
                spawnBurst();
                imgEl.classList.remove("dying", "death-fallback-filter");
                void imgEl.offsetWidth;
                imgEl.classList.add("revive-rising");
                if (onRise) onRise();
                // .revive-rising(attack-effects.css)의 애니메이션(revive-sprite-rise) 자체는 0.85초짜리
                // 1회성인데, 클래스를 안 지우면 애니메이션이 끝난 뒤에도 계속 붙어있는다 - CSS 캐스케이드
                // 상 이후 발동되는 .battle-unit-img.walking(walk-bob, arena-battle.css)의 animation
                // 선언이 이 클래스의 뒤늦은 스타일시트 로드 순서 때문에 영원히 밀려서, 부활한 캐릭터는
                // 전용 걷기 프레임(walk_N.webp)이 없는 한 걸을 때 통통 튀는 효과가 다시 죽을 때까지
                // 평생 안 나오는 버그로 이어졌다. 애니메이션 재생 시간(0.85초, CSS와 반드시 일치)만큼
                // 기다렸다가 지워서 그 이후엔 walking 클래스가 정상적으로 애니메이션을 가져가게 한다.
                const riseToken = (reviveRiseTokens[unitKey] = (reviveRiseTokens[unitKey] || 0) + 1);
                setTimeout(() => {
                    if (reviveRiseTokens[unitKey] === riseToken) imgEl.classList.remove("revive-rising");
                }, 850);
            }
            const p = (t - FLASH_MS) / RISE_MS;
            flashPower = 1;
            ringPower = 1 - p * 0.2;
        } else if (t < TOTAL_MS) {
            const p = (t - FLASH_MS - RISE_MS) / AFTER_MS;
            flashPower = Math.max(0, 1 - p);
            ringPower = Math.max(0, 0.8 - p * 0.8);
        } else {
            canvas.remove();
            reviveEffectActive[unitKey] = false;
            return;
        }

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life += dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 40 * dt;
            if (p.life >= p.maxLife) particles.splice(i, 1);
        }
        for (let i = rings.length - 1; i >= 0; i--) {
            const r = rings[i];
            r.life += dt;
            r.r += radius * 0.9 * dt;
            if (r.life >= r.max) rings.splice(i, 1);
        }

        // playGoldenSelfDestruct와 동일한 이유로 필드 전체가 아니라 캐릭터 주변 좁은 영역만 지운다 -
        // 위(상승 파티클)로 더 넓게, 아래(지면)로는 좁게 잡는다.
        const clearR = radius * 2.6;
        const clearX = Math.max(0, cx - clearR);
        const clearYTop = Math.max(0, cy - clearR * 1.6);
        const clearYBottom = Math.min(fieldRect.height, cy + clearR * 0.5);
        const clearW = Math.min(fieldRect.width, cx + clearR) - clearX;
        ctx.clearRect(clearX, clearYTop, clearW, clearYBottom - clearYTop);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";

        if (flashPower > 0.01) {
            ctx.globalAlpha = 0.10 + flashPower * 0.22;
            ctx.fillStyle = "#68ebff";
            ctx.beginPath();
            ctx.ellipse(cx, cy, radius * (0.85 + flashPower * 0.2), radius * 0.32, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 0.06 + flashPower * 0.14;
            ctx.fillStyle = "#ffe07f";
            ctx.beginPath();
            ctx.ellipse(cx, cy, radius * 0.6, radius * 0.22, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        if (ringPower > 0.01) {
            ctx.globalAlpha = 0.14 + ringPower * 0.3;
            ctx.strokeStyle = "#9ceeff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(cx, cy, radius * 0.68, radius * 0.24, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        for (const r of rings) {
            const rp = r.life / r.max;
            ctx.globalAlpha = r.a * (1 - rp);
            ctx.strokeStyle = "#9ceeff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(cx, cy, r.r, r.r * 0.34, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        for (const p of particles) {
            const lp = p.life / p.maxLife;
            ctx.globalAlpha = Math.max(0, 1 - lp);
            const sprite = p.gold ? goldSprite : moteSprite;
            ctx.drawImage(sprite, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
        }

        ctx.restore();
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}


// ============================================================================
// ===== 보호막(수치형 - 김크장류 지원가가 부여) 공용 비주얼 =====
// 이 캐릭터 하나가 아니라 "보호막"이라는 개념 자체의 고정 비주얼이다 - 앞으로 다른 캐릭터가 보호막을
// 걸어도 여기 있는 함수들을 그대로 재사용한다. 참고 데모(foreign_worker_skills_HQ_readable_letters.html)의
// SF 에너지 필드를 캐릭터 크기에 맞게 이식했다. 비싼 그라디언트/블러/육각형 패턴은 220x220 오프스크린
// 캔버스에 딱 한 번만 그려두고(makeShieldAuraSprite, 지연 생성 후 캐시), 매 프레임에는 그 결과 이미지를
// drawImage로 재사용만 한다 - 그래야 아군 전체가 동시에 보호막을 두르고 있어도 프레임마다 그라디언트를
// 다시 계산하지 않아 가볍다.
// ============================================================================

function makeShieldAuraSprite() {
    const c = document.createElement("canvas");
    c.width = 220; c.height = 220;
    const g = c.getContext("2d");
    const cx = 110, cy = 110;

    const rg = g.createRadialGradient(cx, cy - 8, 18, cx, cy, 101);
    rg.addColorStop(0, "rgba(190,248,255,0)");
    rg.addColorStop(0.52, "rgba(132,225,255,.035)");
    rg.addColorStop(0.79, "rgba(120,220,255,.10)");
    rg.addColorStop(1, "rgba(165,241,255,.025)");
    g.fillStyle = rg;
    g.beginPath(); g.arc(cx, cy, 100, 0, Math.PI * 2); g.fill();

    g.save();
    g.shadowColor = "#83e4ff";
    g.shadowBlur = 16;
    g.strokeStyle = "rgba(171,241,255,.78)";
    g.lineWidth = 2.2;
    g.beginPath(); g.arc(cx, cy, 92, 0, Math.PI * 2); g.stroke();
    g.restore();

    g.strokeStyle = "rgba(213,251,255,.34)";
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, 84, 0, Math.PI * 2); g.stroke();

    g.lineCap = "round";
    for (let i = 0; i < 12; i++) {
        const a = i * Math.PI * 2 / 12;
        const gap = 0.17;
        g.strokeStyle = i % 3 === 0 ? "rgba(217,252,255,.62)" : "rgba(126,226,255,.26)";
        g.lineWidth = i % 3 === 0 ? 2.1 : 1.15;
        g.beginPath();
        g.arc(cx, cy, 97, a + gap, a + Math.PI / 7 - gap);
        g.stroke();
    }

    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 - Math.PI / 8;
        const x = cx + Math.cos(a) * 92, y = cy + Math.sin(a) * 92;
        g.fillStyle = i % 2 ? "rgba(144,231,255,.72)" : "rgba(226,253,255,.92)";
        g.beginPath(); g.arc(x, y, i % 2 ? 1.7 : 2.3, 0, Math.PI * 2); g.fill();
    }

    g.strokeStyle = "rgba(151,234,255,.09)";
    g.lineWidth = 0.8;
    const hexR = 19;
    for (let row = -2; row <= 2; row++) {
        for (let col = -2; col <= 2; col++) {
            const hx = cx + col * 31 + (row & 1) * 15.5;
            const hy = cy + row * 27;
            if (Math.hypot(hx - cx, hy - cy) > 66) continue;
            g.beginPath();
            for (let k = 0; k < 6; k++) {
                const a = Math.PI / 3 * k;
                const x = hx + Math.cos(a) * hexR;
                const y = hy + Math.sin(a) * hexR;
                k ? g.lineTo(x, y) : g.moveTo(x, y);
            }
            g.closePath(); g.stroke();
        }
    }
    return c;
}

let shieldAuraSprite = null;
function getShieldAuraSprite() {
    if (!shieldAuraSprite) shieldAuraSprite = makeShieldAuraSprite();
    return shieldAuraSprite;
}

// 보호막을 두르고 있는 유닛 목록(unitKey들) - 여러 명이 동시에 보호막을 둘러도 캔버스 하나를 공유한다
// (유닛마다 캔버스를 새로 만들지 않는다). 이 목록이 비면 루프 자체가 멈추고 캔버스도 지운다.
const shieldAuraActive = new Set();
let shieldAuraCanvas = null;
let shieldAuraLoopRunning = false;

function shieldAuraStep() {
    if (shieldAuraActive.size === 0) {
        shieldAuraLoopRunning = false;
        if (shieldAuraCanvas) { shieldAuraCanvas.remove(); shieldAuraCanvas = null; }
        return;
    }
    const fieldEl = attackEffectsConfig.fieldEl;
    const layer = attackEffectsConfig.layerEl;
    if (!fieldEl || !layer) { shieldAuraLoopRunning = false; return; }

    const fieldRect = fieldEl.getBoundingClientRect();
    if (!shieldAuraCanvas || !shieldAuraCanvas.isConnected) {
        const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
        shieldAuraCanvas = document.createElement("canvas");
        shieldAuraCanvas.className = "shield-aura-canvas";
        shieldAuraCanvas.style.width = `${fieldRect.width}px`;
        shieldAuraCanvas.style.height = `${fieldRect.height}px`;
        shieldAuraCanvas.width = Math.round(fieldRect.width * dpr);
        shieldAuraCanvas.height = Math.round(fieldRect.height * dpr);
        shieldAuraCanvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
        layer.appendChild(shieldAuraCanvas);
    }
    const ctx = shieldAuraCanvas.getContext("2d");
    ctx.clearRect(0, 0, fieldRect.width, fieldRect.height);

    const sprite = getShieldAuraSprite();
    const t = performance.now() / 1000;
    let i = 0;
    for (const key of shieldAuraActive) {
        i++;
        const el = resolveEffectEl(key);
        if (!el || !el.isConnected) continue;
        const pos = fieldRelativeCenter(el);
        const pulse = 1 + 0.03 * Math.sin(t * 2.4 + i * 1.7);
        // 보호막 지름 = 히트박스(캐릭터 스프라이트) 높이 - 캐릭터마다 스프라이트 크기가 달라도
        // 항상 그 캐릭터 몸에 딱 맞게 둘러지도록, 고정값 대신 매 프레임 실제 렌더 높이를 읽는다.
        const hitboxHeight = el.getBoundingClientRect().height || 118;
        const size = hitboxHeight * pulse;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.5 + 0.08 * Math.sin(t * 2.1 + i);
        ctx.drawImage(sprite, pos.x - size / 2, pos.y - 8 - size / 2, size, size);
        ctx.restore();
    }
    requestAnimationFrame(shieldAuraStep);
}

// unitKey에 보호막 오라를 켜거나 끈다 - 매 프레임 units[key].shield > 0 여부로 그냥 호출하면 된다
// (이미 켜진 유닛을 다시 켜도, 이미 꺼진 유닛을 다시 꺼도 안전 - Set이라 중복이 없다).
function setShieldAura(unitKey, active) {
    if (!unitKey) return;
    if (active) {
        shieldAuraActive.add(unitKey);
        if (!shieldAuraLoopRunning) {
            shieldAuraLoopRunning = true;
            requestAnimationFrame(shieldAuraStep);
        }
    } else {
        shieldAuraActive.delete(unitKey);
    }
}

// 보호막이 "막 생겼을 때"(전투 시작 시 부여 등) 1회 재생하는 확산 팝인 - 오라 스프라이트를 재사용해서
// 별도 그라디언트 계산 없이 가볍다. 최대 620ms짜리 자기 완결형 캔버스 - 끝나면 스스로 지운다.
function playShieldPop(unitKeyOrEl) {
    const el = resolveEffectEl(unitKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    const fieldEl = attackEffectsConfig.fieldEl;
    if (!layer || !fieldEl || !el) return;
    let pos = fieldRelativeCenter(el);
    const sprite = getShieldAuraSprite();

    const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
    const fieldRect = fieldEl.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    canvas.className = "shield-pop-canvas";
    canvas.style.width = `${fieldRect.width}px`;
    canvas.style.height = `${fieldRect.height}px`;
    canvas.width = Math.round(fieldRect.width * dpr);
    canvas.height = Math.round(fieldRect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layer.appendChild(canvas);

    const startMs = performance.now();
    const totalMs = 620;
    function frame(now) {
        const t = now - startMs;
        if (t >= totalMs) { canvas.remove(); return; }
        const k = t / totalMs;
        const fade = 1 - k;
        const ease = 1 - Math.pow(1 - k, 3);
        // playShieldHit과 동일한 이유 - 부여되는 순간 대상이 아직 움직이는 중이어도(전투 시작 직후
        // 첫걸음 등) 제자리에 고정되지 않고 계속 따라가도록 매 프레임 위치를 다시 잰다.
        if (el.isConnected) pos = fieldRelativeCenter(el);
        ctx.clearRect(0, 0, fieldRect.width, fieldRect.height);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.translate(pos.x, pos.y - 16);
        ctx.globalAlpha = fade * 0.78;
        const size = 110 + ease * 96;
        ctx.drawImage(sprite, -size / 2 - ease * 24, -size / 2 - ease * 24, size + ease * 48, size + ease * 48);
        ctx.strokeStyle = `rgba(221,252,255,${fade * 0.86})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 45 + ease * 54, -2.7, -0.25);
        ctx.stroke();
        ctx.restore();
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

// 보호막이 완전히 깨졌을 때(0이 됐을 때) 짧게 터지는 링 + 파편 - 부분 흡수(타격)는 더 이상 연출하지
// 않고, 이 "파괴" 순간에만 호출한다.
function playShieldHit(unitKeyOrEl) {
    const el = resolveEffectEl(unitKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    const fieldEl = attackEffectsConfig.fieldEl;
    if (!layer || !fieldEl || !el) return;
    let pos = fieldRelativeCenter(el);
    pos.y -= 16;

    const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
    const fieldRect = fieldEl.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    canvas.className = "shield-pop-canvas";
    canvas.style.width = `${fieldRect.width}px`;
    canvas.style.height = `${fieldRect.height}px`;
    canvas.width = Math.round(fieldRect.width * dpr);
    canvas.height = Math.round(fieldRect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layer.appendChild(canvas);

    const startMs = performance.now();
    const totalMs = 460;
    function frame(now) {
        const t = now - startMs;
        if (t >= totalMs) { canvas.remove(); return; }
        const k = t / totalMs;
        const fade = 1 - k;
        // 대상이 아직 걷는 중(넉백/근접 이동)이어도 제자리에서 안 터지고 그 위치를 계속 따라가도록,
        // 시작할 때 한 번만 좌표를 재는 게 아니라 매 프레임 다시 잰다(shieldAuraStep과 동일한 방식).
        if (el.isConnected) {
            pos = fieldRelativeCenter(el);
            pos.y -= 16;
        }
        ctx.clearRect(0, 0, fieldRect.width, fieldRect.height);
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = `rgba(220,252,255,${fade * 0.9})`;
        ctx.lineWidth = 2.3;
        ctx.beginPath(); ctx.arc(0, 0, 58 + k * 22, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = `rgba(92,218,255,${fade * 0.55})`;
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(0, 0, 62 + k * 15, 0, Math.PI * 2); ctx.stroke();

        ctx.strokeStyle = `rgba(180,242,255,${fade * 0.75})`;
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4 + 0.22;
            const r1 = 52 + k * 15, r2 = 68 + k * 42;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
            ctx.lineTo(Math.cos(a + 0.05) * r2, Math.sin(a + 0.05) * r2);
            ctx.stroke();
        }
        ctx.restore();
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

// ============================================================================
// ===== 김크장 전용: GPT 킬러 (N-O-G-P-T 5탄환 연속 발사) =====
// 참고 데모의 고퀄 발사체(halo+dark core+letter+ring+fins)를 글자별로 캐시해서 재사용한다. 백엔드는
// 탄환별로 대미지를 쪼개지 않고(이종복의 F=ma와 달리) 총합 한 번에 판정하므로, 이 함수는 순수하게
// 연출만 담당하고 실제 피해/기절 반영은 호출부(arena-battle.js)가 마지막 글자 도착 시점에 처리한다.
// ============================================================================

const GPT_BULLET_LETTERS = ["N", "O", "G", "P", "T"];
const gptBulletSprites = new Map();

function makeGptBulletSprite(letter) {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    const g = c.getContext("2d");
    const cx = 64, cy = 64;
    const isT = letter === "T";
    const coreGlow = isT ? "#ffe56c" : "#89ebff";
    const outerGlow = isT ? "rgba(255,210,50,0)" : "rgba(52,188,255,0)";
    const ringColor = isT ? "rgba(255,236,140,.95)" : "rgba(215,251,255,.95)";
    const accentColor = isT ? "rgba(255,218,72,.68)" : "rgba(91,221,255,.68)";

    const halo = g.createRadialGradient(cx, cy, 8, cx, cy, 56);
    halo.addColorStop(0, "rgba(255,255,255,.95)");
    halo.addColorStop(0.14, coreGlow);
    halo.addColorStop(0.34, isT ? "rgba(255,226,92,.78)" : "rgba(128,234,255,.78)");
    halo.addColorStop(0.62, isT ? "rgba(255,211,64,.20)" : "rgba(90,217,255,.20)");
    halo.addColorStop(1, outerGlow);
    g.fillStyle = halo;
    g.beginPath(); g.arc(cx, cy, 56, 0, Math.PI * 2); g.fill();

    const core = g.createRadialGradient(cx, cy - 3, 4, cx, cy, 27);
    core.addColorStop(0, isT ? "rgba(85,65,0,.96)" : "rgba(8,29,39,.96)");
    core.addColorStop(1, isT ? "rgba(40,29,0,.98)" : "rgba(2,15,22,.98)");
    g.fillStyle = core;
    g.beginPath(); g.arc(cx, cy, 24, 0, Math.PI * 2); g.fill();

    g.save();
    g.shadowColor = coreGlow;
    g.shadowBlur = 14;
    g.strokeStyle = ringColor;
    g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, 26, 0, Math.PI * 2); g.stroke();
    g.restore();

    g.strokeStyle = accentColor;
    g.lineWidth = 1.8;
    g.beginPath(); g.arc(cx, cy, 34, -1.0, 0.55); g.stroke();
    g.beginPath(); g.arc(cx, cy, 34, 1.25, 2.75); g.stroke();
    g.beginPath(); g.arc(cx, cy, 34, 3.45, 5.1); g.stroke();

    g.fillStyle = accentColor;
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.35;
        g.save(); g.translate(cx, cy); g.rotate(a);
        g.beginPath(); g.moveTo(31, -2.2); g.lineTo(43, 0); g.lineTo(31, 2.2); g.closePath(); g.fill();
        g.restore();
    }

    // 글자: 두꺼운 외곽선 2겹 + 흰 채움 - 작은 스프라이트 안에서도 또렷이 읽히도록.
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "1000 42px Arial Black,Arial,sans-serif";
    g.lineJoin = "round"; g.miterLimit = 2;
    g.lineWidth = 8;
    g.strokeStyle = isT ? "#2a2000" : "#02131c";
    g.strokeText(letter, cx, cy + 1);
    g.lineWidth = 3;
    g.strokeStyle = isT ? "rgba(255,236,155,.85)" : "rgba(180,244,255,.85)";
    g.strokeText(letter, cx, cy + 1);
    g.fillStyle = "#ffffff";
    g.fillText(letter, cx, cy + 1);

    g.fillStyle = "rgba(255,255,255,.28)";
    g.beginPath(); g.arc(cx - 7, cy - 8, 4, 0, Math.PI * 2); g.fill();

    return c;
}

function getGptBulletSprite(letter) {
    if (!gptBulletSprites.has(letter)) gptBulletSprites.set(letter, makeGptBulletSprite(letter));
    return gptBulletSprites.get(letter);
}

function drawGptBullet(ctx, b, nowSec) {
    const sprite = getGptBulletSprite(b.letter);
    const isT = b.letter === "T";
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    // trail 최대 7포인트 고정이라 연산량이 항상 일정하다.
    if (b.trail.length > 1) {
        for (let i = 1; i < b.trail.length; i++) {
            const a = i / b.trail.length;
            const [x1, y1] = b.trail[i - 1];
            const [x2, y2] = b.trail[i];
            ctx.strokeStyle = isT ? `rgba(255,225,88,${a * 0.13})` : `rgba(91,217,255,${a * 0.13})`;
            ctx.lineWidth = 5 + a * 8;
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.strokeStyle = isT ? `rgba(255,250,198,${a * 0.42})` : `rgba(207,250,255,${a * 0.42})`;
            ctx.lineWidth = 0.8 + a * 2.0;
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
    }

    ctx.translate(b.x, b.y);
    const spin = nowSec * 3.5 + b.phase;
    ctx.rotate(spin);
    ctx.strokeStyle = isT ? "rgba(255,231,105,.48)" : "rgba(138,235,255,.40)";
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(0, 0, 20, -1.1, 0.7); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 25, 1.9, 3.9); ctx.stroke();
    ctx.rotate(-spin);
    ctx.drawImage(sprite, -32, -32, 64, 64);
    ctx.restore();
}

function drawGptFxEffect(ctx, e) {
    const k = e.t / e.d;
    const fade = 1 - k;
    if (e.type === "hit") {
        ctx.save(); ctx.translate(e.x, e.y);
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = `rgba(194,247,255,${fade * 0.82})`;
        ctx.lineWidth = 2.2;
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + 0.18;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
            ctx.lineTo(Math.cos(a) * (17 + k * 32), Math.sin(a) * (17 + k * 32));
            ctx.stroke();
        }
        ctx.strokeStyle = `rgba(93,220,255,${fade * 0.55})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 9 + k * 30, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    } else if (e.type === "muzzle") {
        ctx.save(); ctx.translate(e.x, e.y);
        ctx.globalCompositeOperation = "lighter";
        ctx.rotate(k * 0.7);
        ctx.fillStyle = `rgba(204,249,255,${fade * 0.72})`;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4;
            const r = i % 2 ? 6 + k * 10 : 18 + k * 25;
            const xx = Math.cos(a) * r, yy = Math.sin(a) * r;
            i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = `rgba(112,226,255,${fade * 0.7})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 8 + k * 25, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    }
}

// actorKeyOrEl에서 targetKeyOrEl로 N-O-G-P-T 5글자를 0.13초 간격으로 순차 발사한다. 시전자가 필드
// 왼쪽에 있으면 화면 왼쪽 끝에서, 오른쪽에 있으면 오른쪽 끝에서 발사한다(spawnGasBreathStream과 같은
// 판정 방식 - 원래 스킬 설명의 "왼쪽(상대는 오른쪽) 끝에서 살짝 윗부분"과 일치). onLetterArrive(i)는
// 글자 하나(마지막 T 포함)가 도착할 때마다 호출 - 실제 피해/기절 반영은 호출부가 마지막 글자에서 담당.
// onArrive는 5발이 전부 도착한 뒤 1회 호출.
function playGptKillerVolley(actorKeyOrEl, targetKeyOrEl, onArrive, onLetterArrive, casterSide) {
    const actorImg = resolveEffectEl(actorKeyOrEl);
    const targetImg = resolveEffectEl(targetKeyOrEl);
    const layer = attackEffectsConfig.layerEl;
    const fieldEl = attackEffectsConfig.fieldEl;
    if (!layer || !fieldEl || !targetImg) { if (onArrive) onArrive(); return; }

    const fieldRect = fieldEl.getBoundingClientRect();
    // 시전자 스프라이트를 못 찾으면(김크장처럼 서포터라 전장에 위치가 없는 경우) 필드가 아니라 진짜
    // 화면(뷰포트) 가장자리에서 발사한다(viewportEdgeXRelativeToField) - casterSide로 소속 진영 쪽을 고른다.
    const actorPos = actorImg
        ? fieldRelativeCenter(actorImg)
        : { x: viewportEdgeXRelativeToField(casterSide, fieldRect), y: fieldRect.height * 0.4 };
    const originX = actorPos.x;
    const originY = actorPos.y - 40;

    const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
    const canvas = document.createElement("canvas");
    canvas.className = "gpt-killer-canvas";
    canvas.style.width = `${fieldRect.width}px`;
    canvas.style.height = `${fieldRect.height}px`;
    canvas.width = Math.round(fieldRect.width * dpr);
    canvas.height = Math.round(fieldRect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layer.appendChild(canvas);

    const bullets = [];
    let effects = [];
    let resolved = 0;
    const total = GPT_BULLET_LETTERS.length;
    const speed = 1100; // px/s
    const dt = 1 / 60;

    GPT_BULLET_LETTERS.forEach((letter, i) => {
        setTimeout(() => {
            bullets.push({ letter, x: originX, y: originY + i * 5, trail: [], phase: i * 1.37 });
            effects.push({ type: "muzzle", x: originX, y: originY + i * 5, t: 0, d: 0.18 });
        }, i * 130);
    });

    function frame() {
        if (!targetImg.isConnected) { canvas.remove(); if (onArrive) onArrive(); return; }
        ctx.clearRect(0, 0, fieldRect.width, fieldRect.height);
        const targetPos = fieldRelativeCenter(targetImg);
        const tx = targetPos.x, ty = targetPos.y - 14;
        const nowSec = performance.now() / 1000;

        for (let i = bullets.length - 1; i >= 0; i--) {
            const b = bullets[i];
            const dx = tx - b.x, dy = ty - b.y;
            const dist = Math.hypot(dx, dy);
            const step = speed * dt;
            b.trail.push([b.x, b.y]);
            if (b.trail.length > 7) b.trail.shift();

            if (dist <= Math.max(step, 18)) {
                b.x = tx; b.y = ty;
                drawGptBullet(ctx, b, nowSec);
                bullets.splice(i, 1);
                resolved++;
                const letterIndex = GPT_BULLET_LETTERS.indexOf(b.letter);
                effects.push({ type: "hit", x: tx, y: ty, t: 0, d: 0.30 });
                if (onLetterArrive) onLetterArrive(letterIndex);
            } else {
                b.x += dx / dist * step;
                b.y += dy / dist * step;
                drawGptBullet(ctx, b, nowSec);
            }
        }

        for (const e of effects) { e.t += dt; drawGptFxEffect(ctx, e); }
        effects = effects.filter((e) => e.t < e.d);

        if (resolved >= total && bullets.length === 0 && effects.length === 0) {
            canvas.remove();
            if (onArrive) onArrive();
            return;
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}


// ============================================================================
// ===== 김룡환 전용: Perfect (10등분 전장 위치 기반 폭탄 5발 수직 낙하) =====
// 참고 데모(perfect_skill_demo_vertical_2v2_semicircle.html)를 그대로 포팅 - 전장 상단에서 착탄점으로
// 곧장 낙하하는 폭탄 5발, 착탄 시 반원형(지면 아래는 클립으로 가림)으로 터지는 폭발+범위링. 백엔드가
// 보내는 impact_fractions(0~1, 공격자 후방=0~방어자 후방=1)는 이 화면의 실제 픽셀 좌표계와 무관한
// 추상 좌표라, 항상 존재하는 홈 슬롯 4개(공격자 후방/전방, 방어자 전방/후방)의 실제 화면 X를 읽어
// 구간별 선형보간으로 변환한다 - 그래야 화면 크기/레이아웃이 달라져도 착탄점이 항상 정확한 자리에 뜬다.
// ============================================================================

// 홈 슬롯 4개는 "지금 그 자리를 차지한 유닛이 어디 서 있는가"가 아니라 "전장의 그 구역 자체가 화면
// 어디인가"를 나타내는 좌표축 기준점이어야 한다. 근접 유닛은 walker(tick)가 매 프레임 [data-unit]에
// translateX를 직접 써서 실제로 걸어 다가가고, 죽거나 넉백당한 유닛은 그 transform이 그대로 남는다
// (applyKnockback 등) - fieldRelativeCenter(라이브 rect)를 그대로 쓰면 상대가 한 명뿐이라 그 자리로
// 근접 유닛들이 몰려 있을 때 방어자 전방/후방 두 기준점이 사실상 같은 화면 위치로 겹쳐버려서, 폭탄
// 5발의 착탄점이 넓게 퍼지지 못하고 한 지점(그 몰려있는 자리)에만 우르르 떨어지는 것처럼 보인다.
// transform을 동기적으로 껐다 재는 measureHomeRect와 같은 방식으로 "홈(전투 시작) 위치"를 읽어야
// 항상 4개 기준점이 화면에 고르게 퍼진 채로 유지된다.
function fieldRelativeHomeCenter(el) {
    const fieldRect = attackEffectsConfig.fieldEl.getBoundingClientRect();
    // 근접 유닛의 걷기(startMeleeWalker)와 넉백(applyKnockback)은 전달받은 el(.battle-unit-img) 자신이
    // 아니라 그 부모(.battle-unit, [data-unit])에 인라인 translateX를 건다 - el 자신의 transform만
    // 지워서는(예전 버전) 이 이동이 전혀 안 지워져서, 실제로 걸어간 만큼 "홈" 위치가 계속 어긋났다.
    // el 자신의 transform(좌우 반전 scaleX)은 그대로 둬야 하므로 부모만 따로 잠깐 지운다.
    const parent = el.closest("[data-unit]") || el;
    const saved = parent.style.transform;
    parent.style.transform = "none";
    const rect = el.getBoundingClientRect();
    parent.style.transform = saved;
    return { x: rect.left + rect.width / 2 - fieldRect.left, y: rect.top + rect.height / 2 - fieldRect.top };
}

// fraction(0~1)을 필드 기준 {x,y} 픽셀 좌표로 변환. Y는 전열(공격자 전방-방어자 전방) 대치선의 평균
// 높이를 "지면"으로 삼는다 - 두 팀 캐릭터가 실제로 서 있는 높이라 폭발이 발밑 근처에서 터지는 것처럼 보인다.
function bombLineImpactPoint(fraction) {
    const refs = [
        { frac: 0, key: "attacker-back" },
        { frac: 1 / 3, key: "attacker-front" },
        { frac: 2 / 3, key: "defender-front" },
        { frac: 1, key: "defender-back" },
    ].map((r) => {
        const el = resolveEffectEl(r.key);
        return el ? { frac: r.frac, pos: fieldRelativeHomeCenter(el) } : null;
    }).filter(Boolean);
    if (refs.length < 2) return null;

    let lo = refs[0], hi = refs[refs.length - 1];
    for (let i = 0; i < refs.length - 1; i++) {
        if (fraction >= refs[i].frac && fraction <= refs[i + 1].frac) { lo = refs[i]; hi = refs[i + 1]; break; }
    }
    const span = hi.frac - lo.frac;
    const t = span > 0 ? (fraction - lo.frac) / span : 0;
    const x = lo.pos.x + (hi.pos.x - lo.pos.x) * t;

    // 폭발이 "캐릭터 위에 떨어져서" 맞히는 게 아니라 "땅에 닿아 터진 범위 안에 캐릭터가 서 있어서"
    // 맞는 것이므로, 반원 클립의 밑변(지면)은 캐릭터의 몸 중심이 아니라 발밑(히트박스 바닥)과
    // 맞아야 한다 - fieldRelativeCenter의 y(세로 중심) 대신 실제 바닥(rect.bottom)을 쓴다.
    const frontEls = [resolveEffectEl("attacker-front"), resolveEffectEl("defender-front")].filter(Boolean);
    const fieldRect = attackEffectsConfig.fieldEl.getBoundingClientRect();
    const groundY = frontEls.length
        ? frontEls.reduce((sum, el) => sum + (el.getBoundingClientRect().bottom - fieldRect.top), 0) / frontEls.length
        : lo.pos.y;
    return { x, y: groundY };
}

let bombLineSprite = null;
function getBombLineSprite() {
    if (bombLineSprite) return bombLineSprite;
    const c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    const g = c.getContext("2d");
    const cx = 64, cy = 64;

    const halo = g.createRadialGradient(cx, cy, 8, cx, cy, 58);
    halo.addColorStop(0, "rgba(255,255,255,.95)");
    halo.addColorStop(0.16, "rgba(255,231,150,.95)");
    halo.addColorStop(0.38, "rgba(255,191,62,.82)");
    halo.addColorStop(0.65, "rgba(255,170,35,.18)");
    halo.addColorStop(1, "rgba(255,144,16,0)");
    g.fillStyle = halo;
    g.beginPath(); g.arc(cx, cy, 58, 0, Math.PI * 2); g.fill();

    const core = g.createRadialGradient(cx, cy - 3, 4, cx, cy, 24);
    core.addColorStop(0, "rgba(72,37,4,.98)");
    core.addColorStop(1, "rgba(27,12,1,.98)");
    g.fillStyle = core;
    g.beginPath(); g.arc(cx, cy, 22, 0, Math.PI * 2); g.fill();

    g.save();
    g.shadowColor = "#ffd973";
    g.shadowBlur = 16;
    g.strokeStyle = "rgba(255,239,178,.98)";
    g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, 24, 0, Math.PI * 2); g.stroke();
    g.restore();

    g.strokeStyle = "rgba(255,204,93,.72)";
    g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, 31, -1.02, 0.6); g.stroke();
    g.beginPath(); g.arc(cx, cy, 31, 1.1, 2.7); g.stroke();
    g.beginPath(); g.arc(cx, cy, 31, 3.45, 5.0); g.stroke();

    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.35;
        g.save(); g.translate(cx, cy); g.rotate(a);
        g.fillStyle = "rgba(255,214,110,.68)";
        g.beginPath(); g.moveTo(29, -2.4); g.lineTo(41, 0); g.lineTo(29, 2.4); g.closePath(); g.fill();
        g.restore();
    }

    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "1000 28px Arial Black,Arial,sans-serif";
    g.lineWidth = 7;
    g.strokeStyle = "#291400";
    g.strokeText("!", cx, cy + 1);
    g.lineWidth = 2.5;
    g.strokeStyle = "rgba(255,240,173,.92)";
    g.strokeText("!", cx, cy + 1);
    g.fillStyle = "#ffffff";
    g.fillText("!", cx, cy + 1);

    bombLineSprite = c;
    return c;
}

let bombLineExplosionSprite = null;
function getBombLineExplosionSprite() {
    if (bombLineExplosionSprite) return bombLineExplosionSprite;
    const c = document.createElement("canvas");
    c.width = 320; c.height = 320;
    const g = c.getContext("2d");
    const cx = 160, cy = 160;

    const rg = g.createRadialGradient(cx, cy, 10, cx, cy, 130);
    rg.addColorStop(0, "rgba(255,255,255,.95)");
    rg.addColorStop(0.10, "rgba(255,241,184,.98)");
    rg.addColorStop(0.24, "rgba(255,195,74,.95)");
    rg.addColorStop(0.46, "rgba(255,130,35,.68)");
    rg.addColorStop(0.70, "rgba(255,86,26,.30)");
    rg.addColorStop(1, "rgba(255,86,26,0)");
    g.fillStyle = rg;
    g.beginPath(); g.arc(cx, cy, 130, 0, Math.PI * 2); g.fill();

    g.save();
    g.translate(cx, cy);
    g.fillStyle = "rgba(255,239,166,.60)";
    g.beginPath();
    for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        const r = i % 2 ? 42 : 88;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill();
    g.restore();

    g.save();
    g.shadowColor = "#ffcf6b";
    g.shadowBlur = 20;
    g.strokeStyle = "rgba(255,240,180,.86)";
    g.lineWidth = 4;
    g.beginPath(); g.arc(cx, cy, 102, 0, Math.PI * 2); g.stroke();
    g.restore();

    bombLineExplosionSprite = c;
    return c;
}

let bombLineRangeSprite = null;
function getBombLineRangeSprite() {
    if (bombLineRangeSprite) return bombLineRangeSprite;
    const c = document.createElement("canvas");
    c.width = 260; c.height = 260;
    const g = c.getContext("2d");
    const cx = 130, cy = 130;
    g.strokeStyle = "rgba(255,223,125,.92)";
    g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, 102, 0, Math.PI * 2); g.stroke();

    g.strokeStyle = "rgba(255,173,70,.48)";
    g.lineWidth = 10;
    g.beginPath(); g.arc(cx, cy, 92, -0.7, 0.7); g.stroke();
    g.beginPath(); g.arc(cx, cy, 92, 2.25, 3.9); g.stroke();

    bombLineRangeSprite = c;
    return c;
}

// impactFractions: 백엔드 detail.impact_fractions(길이 5, 0~1). onBombLand(bombIndex)는 폭탄이 실제로
// 착탄하는 그 순간마다 호출 - 호출부(arena-battle.js)가 그 bomb_index에 해당하는 hits만 골라 데미지/
// 체력바를 그 타이밍에 반영한다(GPT 킬러의 onLetterArrive와 동일한 "단계별 콜백" 패턴). onArrive는
// 폭탄 5발 + 모든 폭발 이펙트가 완전히 끝난 뒤 1회 호출.
function playPositionalBombLine(impactFractions, onArrive, onBombLand) {
    const layer = attackEffectsConfig.layerEl;
    const fieldEl = attackEffectsConfig.fieldEl;
    if (!layer || !fieldEl || !impactFractions || !impactFractions.length) { if (onArrive) onArrive(); return; }

    const points = impactFractions.map(bombLineImpactPoint);
    if (points.some((p) => !p)) { if (onArrive) onArrive(); return; }

    const LAUNCH_GAP_MS = 140;
    const FALL_SPEED_PX_S = 1380;
    const BLAST_DURATION = 0.48;
    const DROP_MARK_DURATION = 0.20;
    const START_Y_OFFSET = -520; // 전장 상단 바깥에서 낙하 시작(필드 높이와 무관하게 항상 화면 위에서 시작)

    const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
    const fieldRect = fieldEl.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    canvas.className = "bomb-line-canvas";
    canvas.style.width = `${fieldRect.width}px`;
    canvas.style.height = `${fieldRect.height}px`;
    canvas.width = Math.round(fieldRect.width * dpr);
    canvas.height = Math.round(fieldRect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layer.appendChild(canvas);

    const bombSprite = getBombLineSprite();
    const explosionSprite = getBombLineExplosionSprite();
    const rangeSprite = getBombLineRangeSprite();

    let bombs = [];
    let effects = [];
    let landed = 0;

    points.forEach((p, i) => {
        setTimeout(() => {
            bombs.push({ index: i, x: p.x, y: p.y + START_Y_OFFSET, targetX: p.x, targetY: p.y, phase: i * 0.9 });
            effects.push({ type: "dropMark", x: p.x, y: p.y + START_Y_OFFSET, t: 0, d: DROP_MARK_DURATION });
        }, i * LAUNCH_GAP_MS);
    });

    function resolveExplosion(x, y, bombIndex) {
        effects.push({ type: "explosion", x, y, t: 0, d: BLAST_DURATION });
        landed++;
        if (onBombLand) onBombLand(bombIndex);
    }

    function drawBomb(b, nowSec) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const lg = ctx.createLinearGradient(b.x, b.y - 52, b.x, b.y + 2);
        lg.addColorStop(0, "rgba(255,178,57,0)");
        lg.addColorStop(0.65, "rgba(255,198,82,.22)");
        lg.addColorStop(1, "rgba(255,253,220,.70)");
        ctx.strokeStyle = lg;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y - 46);
        ctx.lineTo(b.x, b.y - 8);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(nowSec * 4.0 + b.phase);
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(bombSprite, -34, -34, 68, 68);
        ctx.restore();
    }

    function drawEffect(e) {
        const k = e.t / e.d;
        const fade = 1 - k;
        if (e.type === "dropMark") {
            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = `rgba(255,221,133,${fade * 0.78})`;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, 8 + k * 24, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
        } else if (e.type === "explosion") {
            // 탄환 하나당 폭발도 하나 - 예전엔 "explosion"(중심 버스트)과 "range"(범위 링)를 서로 다른
            // 길이의 타이머로 따로 재생해서, 하나가 먼저 꺼진 뒤에도 다른 하나가 잠깐 더 남아 있다가
            // 꺼지는 게 "같은 자리에서 두 번 터지는" 것처럼 보였다. 이제 폭발 하나에 버스트+범위링을
            // 같은 타이머(k/fade)로 함께 그려서 한 번만 터지고 한 번에 사라진다.
            ctx.save();
            ctx.translate(e.x, e.y);
            // 지면 아래는 보이지 않도록 상반부만 클립(참고 데모와 동일한 "반원형" 처리) - 클립 기준선(0)이
            // 이제 캐릭터 발밑(bombLineImpactPoint가 구하는 groundY)과 맞으므로, 폭발도 정확히 그 높이에서 잘린다.
            ctx.beginPath();
            ctx.rect(-260, -260, 520, 260);
            ctx.clip();
            ctx.globalCompositeOperation = "lighter";
            const scale = 0.62 + k * 0.88;
            ctx.globalAlpha = fade * 0.95;
            ctx.drawImage(explosionSprite, -160 * scale, -160 * scale, 320 * scale, 320 * scale);
            ctx.strokeStyle = `rgba(255,239,181,${fade * 0.9})`;
            ctx.lineWidth = 3.2;
            ctx.beginPath(); ctx.arc(0, 0, 32 + k * 84, Math.PI, Math.PI * 2); ctx.stroke();

            const rangeScale = 0.68 + k * 0.64;
            ctx.globalAlpha = fade * 0.55;
            ctx.drawImage(rangeSprite, -130 * rangeScale, -130 * rangeScale, 260 * rangeScale, 260 * rangeScale);
            ctx.restore();
        }
    }

    const dt = 1 / 60;
    function frame(now) {
        const nowSec = now / 1000;
        ctx.clearRect(0, 0, fieldRect.width, fieldRect.height);

        for (let i = bombs.length - 1; i >= 0; i--) {
            const b = bombs[i];
            const step = FALL_SPEED_PX_S * dt;
            if (b.y + step >= b.targetY) {
                b.y = b.targetY;
                resolveExplosion(b.targetX, b.targetY, b.index);
                bombs.splice(i, 1);
            } else {
                b.y += step;
                drawBomb(b, nowSec);
            }
        }

        for (const e of effects) { e.t += dt; drawEffect(e); }
        effects = effects.filter((e) => e.t < e.d);

        if (landed >= points.length && bombs.length === 0 && effects.length === 0) {
            canvas.remove();
            if (onArrive) onArrive();
            return;
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
