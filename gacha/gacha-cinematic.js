// 가챠 모집 시네마틱 연출(간판인물 인트로 -> [10연차: 보석 미리보기] -> 신규 캐릭터는 공격/방어
// 타입+대사+몸통 카메라 워크 -> 기존 showCharacterReveal(gacha-reveal.js)로 마무리 -> [10연차: 모아보기]).
// gacha_reveal.html 프로토타입의 연출/타이밍/스킵 로직을 실제 에셋(assets/gacha)과 실제 뽑기 데이터로
// 그대로 이식한 것 - 최종 캐릭터 결과 화면 자체는 새로 안 만들고 gacha-reveal.js를 그대로 호출한다.
//
// 버튼 클릭 시 서버 응답을 기다리지 않고 인트로부터 바로 시작한다(로딩 체감 없이 인트로 연출 자체가
// 그 시간을 가려준다) - gacha.js가 fetch 완료 전의 Promise를 그대로 넘겨주면, 이 안에서 실제 데이터가
// 필요해지는 시점(등급별 빛 색을 정하는 순간)에야 그 Promise를 기다린다.
(function () {
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;
    const GACHA_ASSET_BASE = "assets/gacha/";

    // ── 테스트용 강제 플래그 ──────────────────────────────────────────
    // true인 동안엔 실제 is_duplicate와 무관하게(청년 제외) 항상 "신규" 연출을 보여준다 - 신규 연출을
    // 다시 확인하기 위해 잠시 true로 전환했다(확인된 요청).
    const FORCE_SHOW_NEW_FOR_TESTING = false;

    const TYPE_BG = { Student: "bg-student.webp", Teacher: "bg-teacher.webp", Parent: "bg-parent.webp" };
    const TYPE_ICON = { Student: "student.webp", Teacher: "teacher.webp", Parent: "parent.webp" };
    const TYPE_LABEL = { Student: "학생", Teacher: "교사", Parent: "부모" }; // gacha-reveal.js의 TYPE_LABELS와 동일
    const JEWEL_FILE = { 신화: "jewel-신화.webp", 전설: "jewel-전설.webp", 영웅: "jewel-영웅.webp", 희귀: "jewel-희귀.webp", 일반: "jewel-일반.webp" };
    // 하체/상체 카메라 워크 단계의 배경 - 공격/방어 타입 배경(TYPE_BG) 대신 등급별 배경으로 바뀐다
    // (확인된 요청). gacha-reveal.css가 이미 쓰고 있는 것과 같은 파일(assets/gacha/bg-{등급}.webp).
    const RARITY_BG = { 신화: "bg-신화.webp", 전설: "bg-전설.webp", 영웅: "bg-영웅.webp", 희귀: "bg-희귀.webp", 일반: "bg-일반.webp" };
    // 간판인물 접근+빛 폭발 색 - gacha_reveal.html 프로토타입의 RARITIES 팔레트와 동일(신화만 무지개 -
    // rainbow는 applyBurstColor에서 특별 처리). 일반만 프로토타입의 흰색(#ffffff) 대신 은은한 연두색을
    // 그대로 유지한다(확인된 요청 - 흰색 빛은 신화 등급과 구분이 잘 안 돼서).
    // 희귀만 gacha-reveal.css의 캐릭터 오라 색(.reveal-character-glow.rarity-희귀, #5adc78 계열)에
    // 맞춰뒀다(확인된 요청 - 희귀는 반대로 오라 쪽이 기준, 나머지 등급은 이 표의 색이 기준이라
    // gacha-reveal.css 쪽 오라를 여기 값에 맞춰 바꿨다).
    const RARITY_BURST_COLOR = { 신화: "rainbow", 전설: "#f5da8a", 영웅: "#c9a3f5", 희귀: "#5adc78", 일반: "#bedcb4" };
    const RAINBOW_STOPS = "#ffc9c9, #ffe0b3, #fff6b3, #c2f7d1, #bfe6ff, #d6c7ff, #ffc9f0, #ffc9c9";

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    let overlayEl = null;
    let runToken = 0;
    let skipRequested = false;
    let midClickResolver = null;
    let summaryClickResolver = null;

    // ── DOM 구성(최초 1회) ──────────────────────────────────────────
    function buildOverlay() {
        const el = document.createElement("div");
        el.id = "gc-overlay";
        el.className = "gc-overlay";
        el.innerHTML = `
            <div class="gc-intro-layer" id="gc-intro-layer">
                <div class="gc-intro-bg"></div>
                <div class="gc-char-slot gc-left" id="gc-char2-slot">
                    <img class="gc-char-art gc-on" id="gc-char2-base" src="${GACHA_ASSET_BASE}person1-1.webp" alt="">
                    <img class="gc-char-art" id="gc-char2-point" src="${GACHA_ASSET_BASE}person1-2.webp" alt="">
                </div>
                <div class="gc-char-slot gc-right" id="gc-char1-slot">
                    <img class="gc-char-art gc-on" id="gc-char1-base" src="${GACHA_ASSET_BASE}person2-1.webp" alt="">
                    <img class="gc-char-art" id="gc-char1-point" src="${GACHA_ASSET_BASE}person2-2.webp" alt="">
                </div>
                <div class="gc-light-rays" id="gc-light-rays"></div>
                <div class="gc-light-burst" id="gc-light-burst"></div>
                <div class="gc-white-flash" id="gc-white-flash"></div>
                <div class="gc-intro-door gc-intro-door-left" id="gc-intro-door-left"></div>
                <div class="gc-intro-door gc-intro-door-right" id="gc-intro-door-right"></div>
            </div>

            <div class="gc-mid-layer" id="gc-mid-layer">
                <div class="gc-mid-bg"></div>
                <div class="gc-mid-jewels" id="gc-mid-jewels"></div>
                <div class="gc-mid-prompt" id="gc-mid-prompt">화면을 클릭하면 계속됩니다</div>
            </div>

            <div class="gc-teaser-layer" id="gc-teaser-layer">
                <div class="gc-teaser-bg" id="gc-teaser-bg"></div>
                <div class="gc-camera" id="gc-camera">
                    <div class="gc-char-zone" id="gc-char-zone">
                        <img class="gc-char-full" id="gc-char-full" src="" alt="">
                    </div>
                </div>
                <div class="gc-teaser-whiten" id="gc-teaser-whiten"></div>
                <div class="gc-icon-row" id="gc-icon-row">
                    <div class="gc-icon-chip-wrap">
                        <img class="gc-icon-chip" id="gc-icon-atk" src="" alt="">
                        <div class="gc-icon-label" id="gc-icon-atk-label"></div>
                    </div>
                    <div class="gc-icon-chip-wrap">
                        <img class="gc-icon-chip" id="gc-icon-def" src="" alt="">
                        <div class="gc-icon-label" id="gc-icon-def-label"></div>
                    </div>
                </div>
                <div class="gc-desc-layer" id="gc-desc-layer">
                    <div class="gc-desc-sparkle" id="gc-desc-sparkle"></div>
                    <div class="gc-desc-box" id="gc-desc-box">
                        <span class="gc-quote-mark">"</span><span id="gc-desc-text"></span><span class="gc-quote-mark">"</span>
                    </div>
                </div>
            </div>

            <div class="gc-summary-layer" id="gc-summary-layer">
                <div class="gc-summary-title">10회 모집 결과</div>
                <div class="gc-summary-grid" id="gc-summary-grid"></div>
                <div class="gc-mid-prompt show">클릭하면 닫힙니다</div>
            </div>

            <div class="gc-blackout" id="gc-blackout"></div>
        `;
        document.body.appendChild(el);

        el.querySelector("#gc-mid-layer").addEventListener("click", () => {
            if (midClickResolver) { const r = midClickResolver; midClickResolver = null; r(); }
        });
        el.querySelector("#gc-summary-layer").addEventListener("click", () => {
            if (summaryClickResolver) { const r = summaryClickResolver; summaryClickResolver = null; r(); }
        });

        return el;
    }

    function getOverlay() {
        if (!overlayEl) overlayEl = buildOverlay();
        return overlayEl;
    }

    // gc-sweep은 .gc-overlay 바깥, document.body의 직속 자식으로 따로 둔다 - .gc-overlay가
    // position:fixed+z-index:495로 자기만의 스태킹 컨텍스트를 만들어서, 그 안에 있으면 스윕의 z-index를
    // 아무리 올려도 gacha-reveal-overlay(z-index:500, 역시 body 직속) "위"로는 절대 못 올라간다 -
    // 신규 티저 종료 시점에 이미 열려있던 최종 화면(gacha-reveal-overlay)까지 스윕이 덮고 지나가야
    // 하므로, 처음부터 body 직속으로 만들어서 두 오버레이보다 항상 위(z-index:600)에 있게 한다.
    let sweepEl = null;
    function getSweepEl() {
        if (!sweepEl) {
            sweepEl = document.createElement("div");
            sweepEl.className = "gc-sweep";
            sweepEl.id = "gc-sweep";
            // 내부 띠(gc-sweep-band)는 각도만 고정으로 담당 - gc-sweep(바깥)은 화면 좌표 그대로 이동만
            // 담당한다(gacha-cinematic.css의 .gc-sweep 주석 참고 - 회전+이동을 한 요소에 같이 넣으면
            // 이동 방향이 뒤틀리는 문제가 있었음).
            const band = document.createElement("div");
            band.className = "gc-sweep-band";
            sweepEl.appendChild(band);
            document.body.appendChild(sweepEl);
        }
        return sweepEl;
    }

    // gc-sweep과 똑같은 이유로 SKIP 버튼도 body 직속으로 둔다(확인된 버그) - .gc-overlay 안에 있으면
    // 캐릭터별 최종 화면(gacha-reveal-overlay, z-index:500)이 뜨는 동안 그 아래 깔려서 "active"
    // 클래스가 붙어 있어도 안 보이고 클릭도 안 됐다 - 정작 스킵이 가장 필요한 구간(각 캐릭터를 다
    // 훑어본 뒤, 다음으로 넘어가길 기다리는 최종 화면)에서 스킵 버튼 자체가 안 뜨는 버그였다.
    let skipBtnEl = null;
    function getSkipBtnEl() {
        if (!skipBtnEl) {
            skipBtnEl = document.createElement("button");
            skipBtnEl.className = "gc-skip-btn";
            skipBtnEl.id = "gc-skip-btn";
            skipBtnEl.textContent = "SKIP ▶▶";
            // 스킵 버튼을 눌렀을 때 skipRequested만 조용히 세워두면(이후 중복 캐릭터에만 영향) 지금
            // 보고 있는 최종 화면 자체는 그대로 남아있어서 "눌러도 아무 반응이 없다"로 보인다(확인된
            // 버그) - 지금 최종 화면(gacha-reveal-overlay)이 열려 있으면 그 화면을 실제로 클릭한 것과
            // 동일하게 처리해서(showCharacterReveal 자신의 onclick 분기 - panels-shown이면 다음으로
            // 넘어가고, 아직 자기 진입 애니메이션 중이면 그 애니메이션만 즉시 끝낸다) 스킵을 누르는
            // 즉시 다음 화면으로 넘어가는 게 눈에 보이게 한다.
            skipBtnEl.addEventListener("click", (e) => {
                e.stopPropagation();
                skipToEnd();
                const revealOverlay = document.querySelector(".gacha-reveal-overlay.open");
                if (revealOverlay) revealOverlay.click();
            });
            document.body.appendChild(skipBtnEl);
        }
        return skipBtnEl;
    }

    function q(overlay, id) { return overlay.querySelector(`#${id}`); }

    // ── 등급별 빛 색 적용 ──────────────────────────────────────────
    function hexToRgba(hex, alpha) {
        const h = hex.replace("#", "");
        const r = parseInt(h.substring(0, 2), 16);
        const g = parseInt(h.substring(2, 4), 16);
        const b = parseInt(h.substring(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    function applyBurstColor(overlay, rarityName) {
        const c = RARITY_BURST_COLOR[rarityName] || RARITY_BURST_COLOR["일반"];
        if (c === "rainbow") {
            const conic = `conic-gradient(from 0deg, ${RAINBOW_STOPS})`;
            q(overlay, "gc-light-burst").style.background = conic;
            q(overlay, "gc-light-rays").style.background =
                `repeating-conic-gradient(from 0deg, #ffc9c9 0deg 4deg, transparent 4deg 8deg, ` +
                `#ffe0b3 8deg 12deg, transparent 12deg 16deg, #fff6b3 16deg 20deg, transparent 20deg 24deg, ` +
                `#c2f7d1 24deg 28deg, transparent 28deg 32deg, #bfe6ff 32deg 36deg, transparent 36deg 40deg, ` +
                `#d6c7ff 40deg 44deg, transparent 44deg 48deg, #ffc9f0 48deg 52deg, transparent 52deg 56deg)`;
            q(overlay, "gc-white-flash").style.background = conic;
            q(overlay, "gc-blackout").style.background = conic;
            return;
        }
        q(overlay, "gc-light-burst").style.background =
            `radial-gradient(circle, #fff 0%, ${c} 32%, ${hexToRgba(c, 0.32)} 58%, ${hexToRgba(c, 0)} 78%)`;
        q(overlay, "gc-light-rays").style.background =
            `repeating-conic-gradient(from 0deg, ${hexToRgba(c, 0.5)} 0deg 4deg, transparent 4deg 16deg)`;
        q(overlay, "gc-white-flash").style.background = c;
        q(overlay, "gc-blackout").style.background = c;
    }

    // ── 전체 초기화(리셋) ──────────────────────────────────────────
    function resetAll(overlay) {
        const introLayer = q(overlay, "gc-intro-layer");
        introLayer.classList.remove("show", "gc-doors-closed", "gc-doors-open");
        q(overlay, "gc-char2-slot").classList.remove("gc-move-in", "show");
        q(overlay, "gc-char1-slot").classList.remove("gc-move-in", "show");
        q(overlay, "gc-char2-base").classList.add("gc-on");
        q(overlay, "gc-char2-point").classList.remove("gc-on");
        q(overlay, "gc-char1-base").classList.add("gc-on");
        q(overlay, "gc-char1-point").classList.remove("gc-on");
        q(overlay, "gc-light-burst").classList.remove("gc-burst", "gc-charging");
        q(overlay, "gc-light-rays").classList.remove("gc-burst");
        q(overlay, "gc-white-flash").classList.remove("gc-flash");

        q(overlay, "gc-mid-layer").classList.remove("show");
        q(overlay, "gc-mid-jewels").innerHTML = "";
        q(overlay, "gc-mid-prompt").classList.remove("show");
        midClickResolver = null;

        resetTeaser(overlay);

        q(overlay, "gc-summary-layer").classList.remove("show");
        q(overlay, "gc-summary-grid").innerHTML = "";
        summaryClickResolver = null;

        const blackout = q(overlay, "gc-blackout");
        blackout.style.background = "#e6e6e6";
        blackout.style.transition = "";
        blackout.classList.remove("clear");

        getSkipBtnEl().classList.remove("active");
        skipRequested = false;
    }

    function resetTeaser(overlay) {
        const teaserLayer = q(overlay, "gc-teaser-layer");
        teaserLayer.classList.remove("show");
        const bg = q(overlay, "gc-teaser-bg");
        bg.classList.remove("show", "dim");
        const camera = q(overlay, "gc-camera");
        camera.style.transition = "none";
        camera.style.transform = "scale(1) translate(0,0)";
        const charZone = q(overlay, "gc-char-zone");
        charZone.style.opacity = 0;
        charZone.classList.remove("gc-rising", "gc-rising-out");
        q(overlay, "gc-teaser-whiten").classList.remove("show");
        q(overlay, "gc-icon-row").classList.remove("show");
        q(overlay, "gc-icon-atk").classList.remove("pop");
        q(overlay, "gc-icon-def").classList.remove("pop");
        q(overlay, "gc-desc-layer").classList.remove("show");
        q(overlay, "gc-desc-box").classList.remove("pop");
        q(overlay, "gc-desc-sparkle").classList.remove("sparkle-play");
        getSweepEl().classList.remove("sweeping");
    }

    // ── 1단계: 인트로(간판인물) - 등급 데이터 없이 시작 가능한 앞부분 ──
    // 로비 화면 위로 문이 닫히는 것부터 먼저 보여준다(확인된 요청) - .gc-overlay 배경이 투명해야
    // (gacha-cinematic.css 참고) 문이 닫히는 동안 그 틈으로 로비가 계속 비친다. 간판인물은 문이
    // "완전히 닫힌 뒤"에야(화면 밖에서는 안 보이는 상태로) 기본 포즈로 세팅한다 - 그 전에 미리
    // 세팅해두면 문이 닫히기도 전에 인물이 먼저 튀어나와 보이는 문제가 있었다.
    async function playIntroPreamble(overlay, token) {
        const introLayer = q(overlay, "gc-intro-layer");
        const char2Slot = q(overlay, "gc-char2-slot");
        const char1Slot = q(overlay, "gc-char1-slot");
        const blackout = q(overlay, "gc-blackout");

        introLayer.classList.add("show");
        blackout.classList.add("clear");

        // 문 닫힘(로비 화면이 아직 보이는 채로 문이 슬라이드해 들어와 덮는다) - .gc-intro-door의
        // transition(0.5s)과 맞춰서 기다린다.
        introLayer.classList.add("gc-doors-closed");
        await wait(500);
        if (token !== runToken) return false;

        // 문 뒤에서(화면이 이미 가려진 상태) 인물을 기본 포즈로 세워둔다 - 트랜지션 없이 즉시.
        char2Slot.style.transition = "none";
        char1Slot.style.transition = "none";
        char2Slot.classList.add("show");
        char1Slot.classList.add("show");
        void char2Slot.offsetWidth;
        char2Slot.style.transition = "";
        char1Slot.style.transition = "";

        await wait(300); // 짧은 정적
        if (token !== runToken) return false;
        introLayer.classList.add("gc-doors-open"); // 열리는 순간 이미 서 있는 두 간판인물이 곧바로 보인다.
        await wait(900);
        if (token !== runToken) return false;

        // 포즈 전환(서로를 향한 자세로) - 이 대기(POSE_SWAP_DELAY_MS)를 늘리면 포즈가 바뀌는 시점이 늦춰진다.
        const POSE_SWAP_DELAY_MS = 500;
        await wait(POSE_SWAP_DELAY_MS);
        if (token !== runToken) return false;
        q(overlay, "gc-char2-base").classList.remove("gc-on");
        q(overlay, "gc-char2-point").classList.add("gc-on");
        q(overlay, "gc-char1-base").classList.remove("gc-on");
        q(overlay, "gc-char1-point").classList.add("gc-on");

        // 포즈가 다 바뀐 뒤 잠깐 있다가(POSE_TO_MOVE_DELAY_MS) 서로를 향해 다가서기 시작하고,
        // 그 직후 빛이 터진다(playIntroBurst). 다가서는 거리 자체는 CSS
        // (.gc-char-slot.gc-left.gc-move-in / .gc-right.gc-move-in, gacha-cinematic.css)에서 조정한다.
        const POSE_TO_MOVE_DELAY_MS = 450;
        await wait(POSE_TO_MOVE_DELAY_MS);
        if (token !== runToken) return false;
        char2Slot.classList.add("gc-move-in");
        char1Slot.classList.add("gc-move-in");
        // 다가서는 동안부터 은은하게 두근거리는 예열 상태를 켜둔다 - 실제 폭발은 서버 응답(등급)을
        // 기다려야 해서(특히 10연차는 느릴 수 있음) 다가선 뒤에도 바로 안 터질 수 있는데, 이 예열이
        // 그 대기 시간 내내 계속 재생되므로 화면이 멈춘 것처럼 보이지 않는다(확인된 요청).
        q(overlay, "gc-light-burst").classList.add("gc-charging");
        await wait(1100);
        return token === runToken;
    }

    // ── 1단계 후반: 등급을 알아야 하는 빛 폭발 부분 ──────────────────
    async function playIntroBurst(overlay, rarityName, token) {
        const blackout = q(overlay, "gc-blackout");
        applyBurstColor(overlay, rarityName);
        q(overlay, "gc-light-burst").classList.remove("gc-charging");
        q(overlay, "gc-white-flash").classList.add("gc-flash");
        q(overlay, "gc-light-rays").classList.add("gc-burst");
        q(overlay, "gc-light-burst").classList.add("gc-burst");
        await wait(500);
        if (token !== runToken) return false;
        blackout.classList.remove("clear"); // 흰 화면을 그대로 붙잡아 이어감
        await wait(700);
        q(overlay, "gc-intro-layer").classList.remove("show");
        return token === runToken;
    }

    // ── 퀘스트/도전과제 캐릭터 보상 전용 인트로: 간판인물 접근+빛 폭발 없이, 문이 닫혔다 열리면
    // 곧장 배경(gc-intro-bg)이 드러나는 것으로 끝난다(확인된 요청 - "손가락 맞대고 터지는" 가챠
    // 특유의 뽑기 연출은 빼고, 문 열림까지만 재사용). 뒤이어 playRarityGemReveal이 그 배경 위로
    // 보석을 띄우면서 자연스럽게 이어진다.
    async function playDoorOnlyIntro(overlay, token) {
        const introLayer = q(overlay, "gc-intro-layer");
        const blackout = q(overlay, "gc-blackout");

        introLayer.classList.add("show");
        blackout.classList.add("clear");

        introLayer.classList.add("gc-doors-closed");
        await wait(500);
        if (token !== runToken) return false;

        await wait(300); // 짧은 정적(playIntroPreamble과 동일한 타이밍)
        if (token !== runToken) return false;
        introLayer.classList.add("gc-doors-open");
        await wait(700);
        if (token !== runToken) return false;

        introLayer.classList.remove("show", "gc-doors-closed", "gc-doors-open");
        return token === runToken;
    }

    // ── 10연차 전용: 보석 10개 미리보기 ────────────────────────────
    async function playMidSection(overlay, pulls, token) {
        const midLayer = q(overlay, "gc-mid-layer");
        const midJewels = q(overlay, "gc-mid-jewels");
        const midPrompt = q(overlay, "gc-mid-prompt");
        const blackout = q(overlay, "gc-blackout");

        midJewels.innerHTML = "";
        const jewelEls = pulls.map(() => {
            const img = document.createElement("img");
            img.className = "gc-mid-jewel";
            midJewels.appendChild(img);
            return img;
        });

        midLayer.classList.add("show");
        blackout.classList.add("clear");
        // 보석이 나오기 시작하는 시점부터 스킵 버튼을 계속 띄워둔다(확인된 요청) - 그 전(인트로)엔
        // 스킵할 대상이 아직 없으므로 노출하지 않는다.
        getSkipBtnEl().classList.add("active");
        await wait(300);
        if (token !== runToken) return false;

        for (let i = 0; i < pulls.length; i++) {
            if (token !== runToken) return false;
            const rarity = pulls[i].character.rarity;
            jewelEls[i].src = `${GACHA_ASSET_BASE}${JEWEL_FILE[rarity] || JEWEL_FILE["일반"]}`;
            jewelEls[i].classList.add("pop");
            if (!skipRequested) await wait(180);
        }
        if (token !== runToken) return false;

        if (!skipRequested) {
            midPrompt.classList.add("show");
            await new Promise((resolve) => { midClickResolver = resolve; });
            midClickResolver = null;
            if (token !== runToken) return false;
            midPrompt.classList.remove("show");
        }

        midLayer.classList.remove("show");
        blackout.classList.remove("clear");
        await wait(skipRequested ? 100 : 300);
        return token === runToken;
    }

    // ── 캐릭터별 등급 보석 등장 -> 배경이 등급 색으로 전환 (1회/10회 공통, 확인된 요청) ──────
    // playOnePullReveal(캐릭터 개인 연출)이 시작되기 직전에 캐릭터마다 한 번씩 재생된다 - 전체를
    // 시작할 때 한 번만 도는 playIntroBurst(가장 높은 등급 색)/playMidSection(10연차 전용, 보석
    // 10개를 한꺼번에 미리보기)과는 별개로 "지금 나온 이 캐릭터"의 등급을 알려주는 개인화된
    // 도입부다. 배경은 playMidSection과 완전히 같은 gc-mid-bg를 그대로 재사용하고(확인된 요청),
    // 배경이 등급 색으로 바뀌는 부분도 새로 만들지 않고 playMidSection/playOnePullReveal의 전환
    // 커튼과 동일한 로직(applyBurstColor + gc-blackout 페이드)을 그대로 재사용한다(확인된 요청).
    // isNew: 10연차 루프가 이 캐릭터를 신규로 판정했는지 - 신규는 스킵을 눌러도 항상 전체 재생돼야
    // 하므로(확인된 요청 - "신규 캐릭터는 스킵 안됨") skipRequested와 무관하게 항상 전체 타이밍을
    // 채운다. 1회 모집(호출부가 안 넘김)은 기본값 true로 항상 전체 재생된다.
    async function playRarityGemReveal(overlay, character, token, isNew = true) {
        const midLayer = q(overlay, "gc-mid-layer");
        const midJewels = q(overlay, "gc-mid-jewels");
        const blackout = q(overlay, "gc-blackout");
        // skipRequested는 스냅샷이 아니라 매번 실시간으로 확인한다(playMidSection의 잔물결 대기와
        // 같은 관례) - 이 캐릭터의 보석 연출이 재생되는 도중에 스킵을 눌러도 그 즉시 반영되게 한다.
        const playFull = () => isNew || !skipRequested;

        midJewels.innerHTML = "";
        const gem = document.createElement("img");
        gem.className = "gc-mid-jewel gc-mid-jewel-solo";
        midJewels.appendChild(gem);
        // 보석이 가운데 "부착"되는 순간(날아오는 트랜지션이 끝나는 시점) 양옆으로 퍼지는 충격파
        // (확인된 요청) - 절대 위치라 gc-mid-jewels의 flex 정렬과 무관하게 항상 보석 중심에 겹친다.
        const shockwave = document.createElement("div");
        shockwave.className = "gc-gem-shockwave";
        midJewels.appendChild(shockwave);

        midLayer.classList.add("show");
        // 직전 단계(playIntroBurst)의 폭발 색 화면이 이 보석 화면으로 순간 전환되지 않고 자연스럽게
        // 페이드아웃되며 이어지게 한다(확인된 요청 - 10연차 보석 미리보기 playMidSection과 동일하게
        // gc-blackout의 기본 트랜지션(0.45s, gacha-cinematic.css)을 그대로 쓴다. 한때 transition:none
        // 으로 순간 전환시켰던 적이 있는데 그게 오히려 부자연스럽다는 피드백을 받아 되돌림).
        blackout.classList.add("clear");
        await wait(150);
        if (token !== runToken) return false;

        gem.src = `${GACHA_ASSET_BASE}${JEWEL_FILE[character.rarity] || JEWEL_FILE["일반"]}`;
        gem.classList.add("pop");
        // .gc-mid-jewel-solo.pop의 날아오는 트랜지션(0.5s)이 끝나는 시점에 맞춰 충격파를 터뜨린다.
        if (playFull()) await wait(500);
        shockwave.classList.add("play");
        if (playFull()) await wait(400);
        if (token !== runToken) return false;

        // 배경이 등급 색으로 바뀌는 전환(기존 로직 그대로) - 그 뒤에 이어지는 playOnePullReveal
        // 자신의 전환 커튼이 같은 색을 다시 한번 적용하며 다음 장면을 준비하므로 자연스럽게 이어진다.
        blackout.style.transition = "opacity 0.4s ease";
        applyBurstColor(overlay, character.rarity);
        blackout.classList.remove("clear");
        await wait(playFull() ? 450 : 120);
        if (token !== runToken) return false;

        midLayer.classList.remove("show");
        return token === runToken;
    }

    // ── 신규 캐릭터 전용: 공격/방어 타입+대사 -> 몸통 카메라 워크 ──────
    // "화면이 살짝 흰색으로 변하기 시작할 때" 카메라 위치를 이미 옮겨두는 트릭(transition:none + 강제
    // 리플로우 후 transition 복구) - 암전이 다 걷히기 전에 카메라가 이미 새 위치에 가 있어야, 다시
    // 밝아졌을 때 카메라가 "아직도 움직이는 중"인 것처럼 보이는 어색함이 없다.
    function snapCamera(camera, transform) {
        camera.style.transition = "none";
        camera.style.transform = transform;
        void camera.offsetWidth;
        camera.style.transition = "transform 0.7s ease";
    }

    // 이 함수가 시작되는 시점엔 이미 playOnePullReveal의 "모집 사이 전환 커튼" 단계에서 resetTeaser +
    // 배경/사진/아이콘/대사 텍스트 준비 + teaserLayer/타입배경(dim)/아이콘 행 노출까지 끝나 있다
    // (확인된 요청 - 로비가 순간적으로 비치는 문제를 막는 커튼 뒤에서 다음 장면을 미리 준비해두는
    // 매커니즘과 통합됨). 여기서는 이미 보이는 아이콘을 순서대로 "팝"시키는 것부터 시작한다.
    async function playNewCharacterTeaser(overlay, character, token) {
        const bg = q(overlay, "gc-teaser-bg");
        const camera = q(overlay, "gc-camera");
        const charZone = q(overlay, "gc-char-zone");
        const iconRow = q(overlay, "gc-icon-row");
        const iconAtk = q(overlay, "gc-icon-atk");
        const iconDef = q(overlay, "gc-icon-def");
        const descLayer = q(overlay, "gc-desc-layer");
        const descBox = q(overlay, "gc-desc-box");
        const blackout = q(overlay, "gc-blackout");

        iconAtk.classList.add("pop");
        await wait(150);
        if (token !== runToken) return false;
        iconDef.classList.add("pop");
        await wait(1300);
        if (token !== runToken) return false;

        // 흰색 암전 깜박임 없이 - 타입 아이콘이 자연스럽게(opacity 트랜지션) 사라지면서 동시에 반짝이는
        // 스파클 이펙트 + 대사창이 자연스럽게 나타난다(확인된 요청).
        iconRow.classList.remove("show");
        iconAtk.classList.remove("pop");
        iconDef.classList.remove("pop");
        descLayer.classList.add("show");
        const sparkle = q(overlay, "gc-desc-sparkle");
        sparkle.classList.remove("sparkle-play");
        void sparkle.offsetWidth;
        sparkle.classList.add("sparkle-play");
        await wait(250);
        if (token !== runToken) return false;
        descBox.classList.add("pop");
        await wait(1800);
        if (token !== runToken) return false;

        // 화이트 플래시 속도를 하체/상체 구간 모두 동일하게 0.4s로 통일한다(확인된 요청).
        blackout.style.transition = "opacity 0.4s ease";
        blackout.classList.remove("clear");
        // 암전(화이트닝)이 시작되는 바로 그 순간 뒤에서 다음 배경(등급 배경)을 미리 준비해둔다
        // (확인된 요청) - 암전이 화면을 덮는 짧은 시간 동안 이미 바뀌어 있어야, 암전이 걷힐 때
        // 배경이 다시 바뀌는 게 보이지 않고 바로 새 배경이 드러난다. 몸통 카메라 워크 단계부터는
        // 배경이 공격 타입이 아니라 등급 배경으로 바뀐다(확인된 요청). 대기 시간(450ms)은 트랜지션
        // (0.4s=400ms)이 완전히 끝난 뒤에야 다음 단계로 넘어가도록 여유를 둔 것 - 트랜지션 도중에
        // 넘어가면 화면이 채 안 하얘진 상태에서 아래 내용이 바뀌어버린다.
        const rarityBg = RARITY_BG[character.rarity] || RARITY_BG["일반"];
        bg.style.backgroundImage = `url('${GACHA_ASSET_BASE}${rarityBg}')`;
        await wait(450);
        if (token !== runToken) return false;
        descLayer.classList.remove("show");
        descBox.classList.remove("pop");

        bg.classList.remove("dim");
        charZone.style.opacity = 1;
        // 하체/상체를 비추는 동안 캐릭터가 계속 아주 조금씩 위로 떠오른다(확인된 요청) - 두 확대 단계를
        // 합친 시간(900+450+900=2250ms)에 맞춰 gc-rise 애니메이션(2.25s)이 그 사이 내내 재생된다.
        charZone.classList.remove("gc-rising");
        void charZone.offsetWidth;
        charZone.classList.add("gc-rising");
        // 하체 먼저, 그 다음 상체 순서(확인된 요청) - 화면이 완전히 하얀 지금(카메라 점프 자체가 안
        // 보이는 시점) 위치를 옮겨둔다.
        snapCamera(camera, "scale(1.9) translate(0%, -18%)"); // 하체

        blackout.classList.add("clear");
        await wait(900);
        if (token !== runToken) return false;

        // 하체->상체 사이 화이트 플래시(확인된 버그 수정) - 화면이 완전히 하얗게 덮인 뒤에야 카메라를
        // 상체 위치로 옮긴다. 예전엔 화이트닝이 시작되는 것과 동시에 카메라를 옮겨서, 트랜지션이
        // 느려진 만큼(0.4s) 화면이 다 덮이기 전에 상체가 먼저 살짝 보여버리는 문제가 있었다 - 이제는
        // 완전히 하얀 상태에서(카메라 점프 자체가 안 보임) 옮기고, 그 즉시 다시 걷으며 상체를 드러낸다.
        blackout.classList.remove("clear");
        await wait(450);
        if (token !== runToken) return false;
        snapCamera(camera, "scale(1.9) translate(0%, 24%)"); // 상체
        blackout.classList.add("clear");
        await wait(900);
        if (token !== runToken) return false;

        // 상체까지 비춘 뒤 배경이 서서히 살짝 하얘진다(확인된 요청) - 이 상태 그대로 대각선 스윕으로
        // 넘어가서(playOnePullReveal) 최종 화면이 나온다. 최종 화면은 이 티저 레이어와 완전히 별개라
        // 하얘진 채로 남지 않고 "원래대로" 보인다.
        q(overlay, "gc-teaser-whiten").classList.add("show");
        // 캐릭터가 여기서 멈추지 않고 계속 떠오르며 서서히 사라진다(확인된 요청) - gc-rising이 멈춘
        // 지점에서 그대로 이어받는다(remove+reflow+add로 gc-rising-out을 새로 트리거).
        charZone.classList.remove("gc-rising");
        void charZone.offsetWidth;
        charZone.classList.add("gc-rising-out");
        // 캐릭터가 떠오르며 사라지는 것과 "동시에" 대각선 스윕(빛)을 시작한다(확인된 요청) - 원래는
        // 캐릭터 페이드아웃이 다 끝난 뒤에야 스윕을 시작했는데, 그 사이 빈 공백(#gc-overlay 자체는
        // 투명이라 아무것도 안 덮는 구간) 때문에 로비가 순간적으로 비쳤다(실제 재현 확인) - 스윕을
        // 겹쳐서 그 공백 자체를 없앤다. 이후 playOnePullReveal은 이 스윕을 다시 트리거하지 않고,
        // 여기서 이미 시작된 스윕이 화면을 거의 다 덮는 시점(SWEEP_SWAP_DELAY_MS)까지만 기다린다.
        playDiagonalSweep();
        await wait(SWEEP_SWAP_DELAY_MS);
        return token === runToken;
    }

    // ── 신규 티저 종료(또는 중복이라 티저 자체를 건너뛴 경우) -> 최종 화면 전환: 문 닫힘/열림 없이
    // 화면 전체를 대각선(우측 아래 -> 좌측 위)으로 쓸고 지나가는 반짝이는 빛으로 전환한다. 스윕이
    // 화면을 거의 다 덮은 시점에 맞춰 티저를 숨기고(이미 가려져 있어 안 보임) 최종 화면을 띄운다 -
    // 최종 화면 쪽 확대(0.3배->1배) 애니메이션은 되살려뒀으므로(gacha-reveal.js) 스윕이 지나가는
    // 동안 자연스럽게 이어서 재생된다.
    const SWEEP_SWAP_DELAY_MS = 380; // 스윕 애니메이션(0.9s) 중 화면을 거의 다 덮는 시점
    const CURTAIN_HOLD_MS = 350; // 커튼이 완전히 불투명한 채로 유지되는 시간(신규/중복 공통)
    // 중복 모집 전용(확인된 요청): 최종 화면을 연 시점(스윕이 이미 SWEEP_SWAP_DELAY_MS(380ms)만큼
    // 지나간 상태)부터 스윕이 화면을 완전히 벗어날 때까지 남은 시간 - 이 시간 동안 최종 화면의 실제
    // 캐릭터 스프라이트(reveal-character-wrap)가 확대되며 왼쪽으로 이동하다가, 스윕이 완전히 화면을
    // 벗어나는 바로 그 순간 멈춘다(toRevealCharacter의 _dupSlideMs로 gacha-reveal.js에 전달됨).
    const DUP_SLIDE_MS = 900 - SWEEP_SWAP_DELAY_MS;
    // body 직속인 gc-sweep(z-index:600)을 써서 두 오버레이(gc-overlay 495, gacha-reveal-overlay 500)
    // 보다도 위로 지나간다 - 신규 티저 종료든 중복 전환이든, 이미 열려있거나 막 열리는 최종 화면 위까지
    // 덮으며 지나가야 하기 때문(확인된 설계).
    function playDiagonalSweep() {
        const sweep = getSweepEl();
        sweep.classList.remove("sweeping");
        void sweep.offsetWidth;
        sweep.classList.add("sweeping");
    }

    // ── 신규 여부 판정(청년은 항상 예외, 테스트 플래그는 청년 제외 전원에 적용) ──
    // teasedThisBatch(선택, 10연차 전용): 같은 10연차 안에서 이미 신규 연출을 한 번 보여준 캐릭터
    // 이름 집합 - 같은 캐릭터가 한 배치 안에서 또 나오면(테스트 플래그로 "신규"처럼 보이더라도)
    // 두 번째부터는 신규 티저를 생략한다(확인된 요청).
    function isEffectivelyNew(pull, teasedThisBatch) {
        if (pull.character.name === "청년") return false;
        if (teasedThisBatch && teasedThisBatch.has(pull.character.name)) return false;
        return FORCE_SHOW_NEW_FOR_TESTING || !pull.is_duplicate;
    }

    // 최종 화면은 이제 신규/중복 모두 "즉시 진입" 모드(문 닫힘/열림 애니메이션 없이, 대각선 스윕이
    // 그 전환을 대신함 - 확인된 요청)로만 들어간다 - gacha-reveal.js의 확대(0.3배->1배)/옆으로 밀림/
    // 정보 패널 등장 자체는 그대로 살아있다.
    // 중복(isNew=false)은 _dupSlideSync/_dupSlideMs를 추가로 넘긴다(확인된 요청) - gacha-reveal.js가
    // 이 값을 보고, 기본(신규) 타이밍(INSTANT_WAIT_AFTER_OPEN_MS 뒤 slide-left) 대신 최종 화면을 열자마자
    // 곧바로(이미 화면을 지나가고 있는 스윕과 동시에) 확대+이동을 시작해서 DUP_SLIDE_MS 후 정확히 멈추는
    // dup-slide 타이밍을 쓴다.
    // 신규(isNew=true)는 _preEnlarged를 넘긴다(확인된 요청) - 티저에서 이미 "상체"까지 확대해서 보여줬으니
    // 최종 화면에서 또 한 번 커지는 게 아니라, 처음부터 확대된 채로 등장해서 slide-left 때는 이동만
    // 일어나게(중복처럼 확대→이동을 다시 재생하지 않음) 한다.
    function toRevealCharacter(pull, isNew) {
        const extra = isNew ? { _preEnlarged: true } : { _dupSlideSync: true, _dupSlideMs: DUP_SLIDE_MS };
        return { ...pull.character, is_pickup: pull.is_pickup, is_duplicate: pull.is_duplicate, _instantEntry: true, ...extra };
    }

    // showCharacterReveal(gacha-reveal.js)는 이미 그 자신의 클릭/장착하기로 닫는 상호작용 + 자체 SKIP
    // 버튼을 갖고 있으므로, 그 위에 "다음 결과 보기" 클릭을 한 번 더 요구하지 않는다(중복 클릭 방지) -
    // 이 함수가 반환하는 Promise는 그 창이 닫혀야 풀린다.
    // isNew는 호출부(playSinglePullCinematic/playTenPullCinematic)가 미리 판정해서 넘긴다 - 10연차의
    // teasedThisBatch 판정과 "신규면 그 이름을 배치에 기록" 시점을 호출부가 일관되게 관리하기 위함.
    // allowSkipButton: 스킵은 10연차 전용 개념이라(확인된 요청) 1회 모집에서는 최종 화면에서도 스킵
    // 버튼을 아예 띄우지 않는다 - playSinglePullCinematic은 이 값을 안 넘겨 기본값 false로 둔다.
    async function playOnePullReveal(overlay, pull, isNew, token, allowSkipButton = false) {
        const blackout = q(overlay, "gc-blackout");
        const teaserLayer = q(overlay, "gc-teaser-layer");
        const bg = q(overlay, "gc-teaser-bg");

        // ── 모집 사이 전환 커튼 ──────────────────────────────────────
        // 직전 결과 화면이 닫히는 순간 로비 화면이 잠깐 비치던 문제(확인된 버그)를, 화면 전체를 이번
        // 캐릭터의 희귀도 색으로 덮는 커튼으로 막는다(보석 미리보기 -> 첫 결과 전환과 같은 색/매커니즘 -
        // applyBurstColor + blackout 페이드, 확인된 요청). 커튼이 덮인 채로 뒤에서 다음 장면(신규면
        // 타입 배경+아이콘/사진/대사, 중복이면 곧장 신규 연출의 "상체를 다 비춘 뒤" 장면)을 미리
        // 준비해두고, 커튼이 페이드아웃되면 이미 준비된 장면이 바로 보인다.
        // 직전까지는 결과 화면(gacha-reveal.js)만 화면을 덮고 있었고, 그 화면이 닫히는 순간 #gc-overlay
        // 자신은 투명하므로(문 닫힘 연출을 위해 필요) 아무것도 안 덮인 채로 로비가 그대로 드러난다 -
        // 여기서 opacity를 트랜지션으로 서서히 올리면 그 램프 구간 내내 로비가 비쳐 보인다(직접 확인된
        // 버그 재현). 그래서 opaque 전환 자체는 트랜지션 없이 순간적으로 스냅해야 하고("remove+reflow"
        // 트릭), 나중에 준비가 끝난 뒤 "빠져나갈 때"만 트랜지션 있는 페이드아웃을 쓴다.
        resetTeaser(overlay);
        blackout.style.transition = "none";
        applyBurstColor(overlay, pull.character.rarity);
        blackout.classList.remove("clear");
        void blackout.offsetWidth;
        blackout.style.transition = "opacity 0.45s ease";

        teaserLayer.classList.add("show");
        if (isNew) {
            const atkBg = TYPE_BG[pull.character.attack_type] || TYPE_BG.Student;
            bg.style.backgroundImage = `url('${GACHA_ASSET_BASE}${atkBg}')`;
            bg.classList.add("show", "dim");
            q(overlay, "gc-icon-row").classList.add("show");
            q(overlay, "gc-char-full").src = `${OUTFIT_IMAGE_BASE}${pull.character.outfit}/idle.webp`;
            q(overlay, "gc-icon-atk-label").textContent = `공격 · ${TYPE_LABEL[pull.character.attack_type] || pull.character.attack_type || "-"}`;
            q(overlay, "gc-icon-def-label").textContent = `방어 · ${TYPE_LABEL[pull.character.defense_type] || pull.character.defense_type || "-"}`;
            q(overlay, "gc-icon-atk").src = `${GACHA_ASSET_BASE}${TYPE_ICON[pull.character.attack_type] || TYPE_ICON.Student}`;
            q(overlay, "gc-icon-def").src = `${GACHA_ASSET_BASE}${TYPE_ICON[pull.character.defense_type] || TYPE_ICON.Student}`;
            q(overlay, "gc-desc-text").textContent = pull.character.gacha_quote || "";
        } else {
            // 중복: 문 닫힘/열림 연출도, 아이콘/대사/몸통 확대(하체->상체)도, 별도 "테저용" 캐릭터
            // 스프라이트도 없다(확인된 버그 수정) - 예전엔 여기서 camera/gc-char-full로 확대+이동을
            // 흉내냈지만, 그 스프라이트가 실제 최종 화면(gacha-reveal.js의 reveal-character-img)과는
            // 다른 DOM 이미지라서 테저가 끝나고 최종 화면이 열리는 순간 다른 스프라이트로 "바뀌는"
            // 것처럼 보이는 불연속이 있었다. 이제는 커튼 뒤에서 아무것도 준비하지 않고, 곧장 최종
            // 화면을 열어서 그 실제 스프라이트 위에서 확대+이동을 재생한다(아래 else 분기 참고) -
            // "최종 화면의 캐릭터 스프라이트를 그 전 연출 스프라이트와 같은 것으로" 하라는 요청.
        }

        await wait(CURTAIN_HOLD_MS);
        if (token !== runToken) return false;

        if (isNew) {
            blackout.classList.add("clear");
            await wait(120);
            if (token !== runToken) return false;
            blackout.style.background = "#e6e6e6"; // 커튼 색은 여기서만 쓰고, 내부 전환용 회색으로 되돌려둠
            // 신규 티저 쪽은 자기 자신의 끝(상체 이후 페이드아웃)에서 스윕을 직접 트리거하고 그 스윕이
            // 화면을 거의 다 덮는 시점까지 기다린 뒤 돌아온다 - 최종 화면 전환용 스윕은 여기 한 번뿐이다.
            const finished = await playNewCharacterTeaser(overlay, pull.character, token);
            if (!finished || token !== runToken) return false;
        } else {
            // 중복은 커튼을 걷지 않는다(확인된 버그 수정) - 뒤에 아무것도 준비해두지 않으므로, 커튼을
            // 투명하게 걷으면 #gc-overlay 자신의 투명 배경(문 닫힘 연출을 위해 원래 투명함)을 통해
            // 로비가 그대로 잠깐 비쳐 보인다. 최종 화면(z-index:500)과 스윕(z-index:600)은 이 커튼
            // (z-index:50, #gc-overlay(495) 안)보다 항상 위에 있으므로 계속 불투명하게 놔둬도 전혀
            // 문제없다 - 어차피 곧 그 위로 덮인다(다음 캐릭터 차례엔 resetTeaser가 다시 스냅 리셋한다).
            blackout.style.background = "#e6e6e6";
            // 신규 티저가 자기 자신의 끝에서 하는 것과 완전히 같은 방식(body 직속 gc-sweep,
            // z-index:600 - 두 오버레이 위를 모두 덮으며 지나감)으로 곧장 최종 화면 전환용 스윕을
            // 재생한다(확인된 요청). 스윕이 화면을 거의 다 덮는 시점(SWEEP_SWAP_DELAY_MS)까지만
            // 기다린 뒤 최종 화면을 연다 - 그 순간부터는 이미 화면을 지나가고 있는 이 스윕이 계속
            // 그 위를 덮으며 지나가고, 남은 시간(DUP_SLIDE_MS) 동안 최종 화면 자신의 스프라이트가
            // 확대되며 왼쪽으로 이동하다가 스윕이 완전히 화면을 벗어나는 순간 멈춘다(toRevealCharacter의
            // _dupSlideSync/_dupSlideMs, gacha-reveal.js 참고).
            playDiagonalSweep();
            await wait(SWEEP_SWAP_DELAY_MS);
            if (token !== runToken) return false;
        }

        q(overlay, "gc-teaser-layer").classList.remove("show");

        // 신규 캐릭터는 티저(연출) 동안만 스킵 버튼을 숨기고, 각자의 최종 화면(showCharacterReveal)에
        // 들어서는 순간부터는 신규/중복 구분 없이 항상 다시 띄운다(확인된 요청) - 최종 화면은 이미
        // 다 보여준 뒤 클릭을 기다리는 정적인 상태라 스킵을 눌러도 "이번 캐릭터"에는 아무 영향이 없지만,
        // 이후 남은 중복 캐릭터들을 건너뛰기 위해 언제든 누를 수 있어야 한다. 1회 모집(allowSkipButton
        // false)은 건너뛸 다음 캐릭터 자체가 없으므로 아예 띄우지 않는다(확인된 요청).
        if (allowSkipButton) getSkipBtnEl().classList.add("active");
        await new Promise((resolve) => showCharacterReveal([toRevealCharacter(pull, isNew)], resolve));
        return token === runToken;
    }

    // ── 10연차 모아보기(정사각형 + 실제 캐릭터 사진, avatar-crop 적용) ──
    // 클릭하면 닫히고 오버레이 자체도 사라진다(가챠 모달로 복귀) - 반환하는 Promise가 그 시점에 풀린다.
    async function showSummary(overlay, pulls) {
        const grid = q(overlay, "gc-summary-grid");
        grid.innerHTML = "";
        pulls.forEach((pull) => {
            const item = document.createElement("div");
            item.className = "gc-summary-item";
            item.innerHTML = `
                <div class="gc-summary-face">
                    <div class="gc-summary-face-inner"><img alt=""></div>
                </div>
                <div class="gc-summary-name"></div>
            `;
            const img = item.querySelector("img");
            img.src = `${OUTFIT_IMAGE_BASE}${pull.character.outfit}/idle.webp`;
            applyAvatarCrop(img, pull.character.outfit);
            item.querySelector(".gc-summary-name").textContent = pull.character.name;
            grid.appendChild(item);
        });

        q(overlay, "gc-mid-layer").classList.remove("show");
        q(overlay, "gc-teaser-layer").classList.remove("show");
        // blackout(z-index:50)이 summary-layer(z-index:30)보다 위라 opaque 상태로 두면 모아보기
        // 그리드가 뜨자마자 바로 가려져버린다(확인된 버그) - 반대로 투명하게 걷어내야 한다.
        q(overlay, "gc-blackout").classList.add("clear");
        q(overlay, "gc-summary-layer").classList.add("show");

        await new Promise((resolve) => { summaryClickResolver = resolve; });
        summaryClickResolver = null;
        overlay.classList.remove("open");
        q(overlay, "gc-summary-layer").classList.remove("show");
    }

    // ── 스킵(10연차 전용, 보석 미리보기가 뜬 뒤부터 노출) ─────────────
    // 신규 캐릭터 연출은 스킵 중에도 항상 전체 재생되고, 중복 캐릭터 등장 씬만 통째로 생략된다.
    // 중간(보석 미리보기) 클릭 대기만 즉시 통과시키고, 결과화면을 닫는 상호작용 자체는 스킵과 무관하다.
    // 버튼 자체는 눌러도 사라지지 않고 계속 떠 있는다(확인된 요청) - 신규 캐릭터 연출 중에만
    // playTenPullCinematic의 루프에서 별도로 숨긴다(눌러도 의미가 없는 구간이라서).
    function skipToEnd() {
        if (skipRequested) return;
        skipRequested = true;
        if (midClickResolver) { const r = midClickResolver; midClickResolver = null; r(); }
    }

    // ── 외부 공개 API ────────────────────────────────────────────
    // resultPromise: fetch 응답을 await ok/data 형태로 감싼 Promise({ ok, data }) - 인트로 전반부는
    // 이 값이 필요 없어서(등급을 몰라도 시작 가능) 기다리지 않고 곧바로 재생을 시작한다.
    // onResult(data): resultPromise가 성공으로 풀리는 즉시(빛 폭발 직전) 한 번 호출 - 호출부가 골드/
    // 포인트 UI를 연출이 끝나길 기다리지 않고 그 시점에 바로 갱신할 수 있게 한다.
    window.playSinglePullCinematic = async function (resultPromise, onResult) {
        runToken++;
        const token = runToken;
        const overlay = getOverlay();
        overlay.classList.add("no-transition", "open");
        resetAll(overlay);
        void overlay.offsetWidth;
        overlay.classList.remove("no-transition");

        const preambleOk = await playIntroPreamble(overlay, token);
        if (!preambleOk) return { aborted: true };

        let outcome;
        try {
            outcome = await resultPromise;
        } catch (err) {
            overlay.classList.remove("open");
            return { error: "서버에 연결할 수 없어요. 서버가 켜져 있는지 확인하세요." };
        }
        if (token !== runToken) return { aborted: true };
        if (!outcome.ok) {
            overlay.classList.remove("open");
            return { error: outcome.data?.detail || "모집에 실패했어요." };
        }
        const data = outcome.data;
        if (onResult) onResult(data);

        const burstOk = await playIntroBurst(overlay, data.character.rarity, token);
        if (!burstOk) return { aborted: true };

        const pull = { character: data.character, is_duplicate: data.is_duplicate, is_pickup: data.is_pickup };
        const gemOk = await playRarityGemReveal(overlay, pull.character, token);
        if (!gemOk) return { aborted: true };
        // 스킵은 10연차 전용 개념이라(확인된 요청) allowSkipButton을 안 넘겨 1회 모집에서는 스킵
        // 버튼이 아예 활성화되지 않는다(playOnePullReveal 참고) - 그래도 혹시 모를 잔존 상태에 대비해
        // 모집이 끝나는 시점에 한 번 더 확실히 꺼둔다(body 직속 요소라 안 꺼지면 로비까지 계속 보임).
        const revealOk = await playOnePullReveal(overlay, pull, isEffectivelyNew(pull), token);
        getSkipBtnEl().classList.remove("active");
        overlay.classList.remove("open");
        if (!revealOk) return { aborted: true };
        return { data };
    };

    // resultPromise가 성공하면 { ok: true, data: { results: [...], ... } } 형태.
    window.playTenPullCinematic = async function (resultPromise, onResult) {
        runToken++;
        const token = runToken;
        const overlay = getOverlay();
        overlay.classList.add("no-transition", "open");
        resetAll(overlay);
        void overlay.offsetWidth;
        overlay.classList.remove("no-transition");

        const preambleOk = await playIntroPreamble(overlay, token);
        if (!preambleOk) return { aborted: true };

        let outcome;
        try {
            outcome = await resultPromise;
        } catch (err) {
            overlay.classList.remove("open");
            return { error: "서버에 연결할 수 없어요. 서버가 켜져 있는지 확인하세요." };
        }
        if (token !== runToken) return { aborted: true };
        if (!outcome.ok) {
            overlay.classList.remove("open");
            return { error: outcome.data?.detail || "모집에 실패했어요." };
        }
        const data = outcome.data;
        if (onResult) onResult(data);

        const pulls = data.results.map((r) => ({ character: r.character, is_duplicate: r.is_duplicate, is_pickup: r.is_pickup }));
        // 인트로 빛의 색은 10개 중 가장 높은 등급(RARITY_BURST_COLOR 맵의 정의 순서 = 신화가 가장 앞).
        const RARITY_ORDER = ["신화", "전설", "영웅", "희귀", "일반"];
        const topRarity = pulls.reduce((best, p) => (
            RARITY_ORDER.indexOf(p.character.rarity) < RARITY_ORDER.indexOf(best) ? p.character.rarity : best
        ), pulls[0].character.rarity);

        const burstOk = await playIntroBurst(overlay, topRarity, token);
        if (!burstOk) return { aborted: true };

        const midOk = await playMidSection(overlay, pulls, token);
        if (!midOk) { getSkipBtnEl().classList.remove("active"); return { aborted: true }; }

        const skipBtn = getSkipBtnEl();
        const teasedThisBatch = new Set();
        for (let i = 0; i < pulls.length; i++) {
            if (token !== runToken) return { aborted: true };
            const pull = pulls[i];
            const isNew = isEffectivelyNew(pull, teasedThisBatch);
            const skipThisOne = !isNew && skipRequested;
            if (skipThisOne) continue;
            if (isNew) teasedThisBatch.add(pull.character.name);

            // 신규 캐릭터 연출은 스킵을 눌러도 항상 전체 재생되어 눌러봤자 의미가 없으므로, 그 동안만
            // 스킵 버튼을 숨긴다(확인된 요청) - playOnePullReveal이 각자의 최종 화면에 들어서는 순간
            // 다시 띄워준다(신규/중복 공통, 확인된 요청). 등급 보석 도입부도 이 캐릭터의 연출에
            // 포함되므로 같은 구간(숨김) 안에서 재생한다.
            if (isNew) skipBtn.classList.remove("active");
            const gemOk = await playRarityGemReveal(overlay, pull.character, token, isNew);
            if (!gemOk) return { aborted: true };
            const ok = await playOnePullReveal(overlay, pull, isNew, token, true);
            if (!ok) return { aborted: true };
        }

        skipBtn.classList.remove("active");
        await showSummary(overlay, pulls); // 클릭하면 풀리고, 그 안에서 오버레이도 함께 닫는다.
        if (token !== runToken) return { aborted: true };
        return { data };
    };

    // ── 퀘스트/도전과제 캐릭터 보상 전용(확인된 요청): 1회 모집과 같은 결과 화면(등급 보석 등장 ->
    // 신규면 공격/방어 타입+대사+몸통 카메라 워크 -> showCharacterReveal)을 그대로 재사용하되, 앞부분의
    // 간판인물 접근+빛 폭발(가챠 특유의 "뽑기" 연출)은 빼고 문이 닫혔다 열리면 곧장 배경에서 보석이
    // 나오는 것으로 시작한다. 서버 응답을 이미 받은 뒤 호출하는 구조라(quests.js가 fetch 완료 후 호출)
    // 1회/10연차와 달리 Promise가 아니라 캐릭터 배열을 직접 받는다.
    // characters: [{ ...캐릭터 정보, is_duplicate, is_pickup }, ...] - challenges.py/achievements.py의
    // new_characters 응답 형태 그대로. 여러 명이 한 번에 지급돼도(예: 도전과제가 캐릭터 여러 명을
    // 한꺼번에 주는 경우) 10연차처럼 한 명씩 순차 재생하고, 신규 캐릭터는 항상 전체 재생된다(확인된
    // 요청 - "신규 캐릭터는 그 연출도 볼 수 있게").
    window.playQuestRewardCinematic = async function (characters, onClose) {
        if (!characters || characters.length === 0) {
            if (onClose) onClose();
            return;
        }
        runToken++;
        const token = runToken;
        const overlay = getOverlay();
        overlay.classList.add("no-transition", "open");
        resetAll(overlay);
        void overlay.offsetWidth;
        overlay.classList.remove("no-transition");

        const doorsOk = await playDoorOnlyIntro(overlay, token);
        if (!doorsOk) {
            overlay.classList.remove("open");
            if (onClose) onClose();
            return;
        }

        const pulls = characters.map((c) => ({ character: c, is_duplicate: c.is_duplicate, is_pickup: c.is_pickup }));
        const multiple = pulls.length > 1;
        const skipBtn = getSkipBtnEl();
        const teasedThisBatch = new Set();

        for (let i = 0; i < pulls.length; i++) {
            if (token !== runToken) break;
            const pull = pulls[i];
            const isNew = isEffectivelyNew(pull, teasedThisBatch);
            const skipThisOne = multiple && !isNew && skipRequested;
            if (skipThisOne) continue;
            if (isNew) teasedThisBatch.add(pull.character.name);

            if (isNew) skipBtn.classList.remove("active");
            const gemOk = await playRarityGemReveal(overlay, pull.character, token, isNew);
            if (!gemOk) break;
            const ok = await playOnePullReveal(overlay, pull, isNew, token, multiple);
            if (!ok) break;
        }

        skipBtn.classList.remove("active");
        overlay.classList.remove("open");
        if (onClose) onClose();
    };
})();
