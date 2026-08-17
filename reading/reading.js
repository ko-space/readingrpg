// 독서 화면(2단계) 전용 로직. home.js/gacha.js 등과 완전히 독립적으로 동작 - 이 페이지는 별도 HTML이라 공유할 필요 없음.

(function () {
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;
    const REGION_IMAGE_BASE = "assets/regions/";
    const FIREFLY_COUNT = 18;
    const MAX_LEVEL = 30; // backend/leveling.py의 MAX_LEVEL과 반드시 같은 값으로 유지

    // 모의고사 탭의 과목별 소요시간(분). dungeon.js가 duration을 실어 보내지만, 값이 비거나 이상하면 여기서도 검증한다.
    const MOCK_EXAM_MINUTES = {
        "국어": 80, "수학": 100, "수학(하프)": 50, "영어": 70, "영어(하프)": 40,
        "한국사": 30, "탐구": 30, "탐구(2회분)": 62, "한문/제2외국어": 40,
    };

    // 로딩 오버레이 자체(검은 배경)는 hidden 속성이 없는 한 CSS 기본값으로 이미 보이지만, "입장하는
    // 중..." 뒤의 점 애니메이션은 JS가 켜줘야 시작된다. 아래 세션 복구 로직이 URL과 저장된 세션이
    // 다를 때 confirm()으로 화면을 막아버릴 수 있는데, 그게 뜨는 동안에도 최소한 이 점 애니메이션은
    // 실제로 움직이고 있어야 "멈춰있는 화면"처럼 보이지 않는다 - 그래서 파일 맨 위에서 가장 먼저 켠다.
    // 실제 배경/캐릭터 이미지 로딩(showRegionEntrance)은 세션이 확정된 뒤 이어서 진행하고, 이 타이머는
    // 그때 가서 멈춘다.
    const regionLoadingOverlayEl = document.getElementById("region-loading-overlay");
    const regionLoadingDotsEl = document.getElementById("region-loading-dots");
    let regionLoadingDotCount = 1;
    if (regionLoadingDotsEl) regionLoadingDotsEl.textContent = ".";
    const regionLoadingDotTimer = setInterval(() => {
        regionLoadingDotCount = (regionLoadingDotCount % 3) + 1;
        if (regionLoadingDotsEl) regionLoadingDotsEl.textContent = ".".repeat(regionLoadingDotCount);
    }, 400);

    function authHeaders() {
        const token = localStorage.getItem("access_token");
        return token ? { "Authorization": `Bearer ${token}` } : {};
    }

    // ── 화면/절전 잠금 방지: 독서·모의고사 도중 컴퓨터가 잠들면 탭이 완전히 멈춰서(백그라운드 탭
    // 쓰로틀링보다 훨씬 심함) 타이머 확인 자체가 안 된다. Wake Lock API를 지원하는 브라우저에서만
    // 동작하고(구형 브라우저는 조용히 무시), 탭이 안 보이게 되면 브라우저가 잠금을 자동으로 풀기
    // 때문에 다시 보일 때마다 재요청해야 한다(유튜브 등이 재생 중 화면을 안 끄는 것과 같은 API).
    let wakeLock = null;
    async function requestWakeLock() {
        if (!("wakeLock" in navigator)) return;
        try {
            wakeLock = await navigator.wakeLock.request("screen");
        } catch (err) {
            console.error("화면 잠금 방지 요청 실패:", err);
        }
    }
    function releaseWakeLock() {
        wakeLock?.release();
        wakeLock = null;
    }

    // URL에서 1단계가 실어 보낸 정보를 읽는다.
    // (예: reading.html?region=초심자의+평원&session_type=mock_exam&difficulty=국어&duration=80)
    const params = new URLSearchParams(window.location.search);

    // 탭을 실수로 닫았다가 reading.html로 돌아왔을 때(직접 재접속하거나, home.js가 곧장 돌려보내서)
    // 끝내지 못한 세션이 남아있으면 그 진행 시간을 이어서 잰다 - shared/reading-session.js 참고.
    // URL이 그 저장된 세션과 다른 걸 가리키면(예: 방치된 옛 세션이 있는 채로 새로 다른 과목을
    // 골라 들어온 경우) 무엇을 원하는지 사용자에게 직접 확인한다 - 그렇지 않으면 진짜로 새로
    // 시작하려는 선택이 조용히 무시될 수 있다.
    let restoredSession = window.ReadingSession ? window.ReadingSession.load() : null;
    // 새벽 1시 컷오프를 이미 지난 세션은 이어서 잴 수 없다 - 하지만 컷오프 전까지 쌓인 시간은 실제로
    // 공부한 시간이므로, 이걸로 계속하는 대신 따로 떼어내 은행 처리(bankExpiredSession, init()에서
    // 호출)해서 자동 제출한다. 지금 시작하려는(또는 이어서 하려는) 세션과는 완전히 별개로 취급한다.
    let expiredSessionToBank = null;
    if (restoredSession && window.ReadingSession.isExpired(restoredSession)) {
        expiredSessionToBank = restoredSession;
        restoredSession = null;
    }
    if (restoredSession) {
        const urlRegion = params.get("region");
        const urlTargetsSomethingElse = urlRegion && (
            urlRegion !== restoredSession.region ||
            (params.get("session_type") || "reading") !== restoredSession.sessionType ||
            params.get("difficulty") !== restoredSession.difficulty
        );
        if (urlTargetsSomethingElse) {
            const resume = window.confirm(
                `끝내지 않은 독서 세션이 있어요 (${restoredSession.region} · ${restoredSession.difficulty}).\n` +
                `이어서 하시겠어요? ("취소"를 누르면 지금 고른 걸로 새로 시작해요.)`
            );
            if (resume) {
                window.history.replaceState(null, "", window.ReadingSession.buildUrl(restoredSession));
            } else {
                window.ReadingSession.clear();
                restoredSession = null;
            }
        }
    }

    const regionName = restoredSession ? restoredSession.region : params.get("region");
    const sessionType = (restoredSession ? restoredSession.sessionType : params.get("session_type")) || "reading"; // "reading" | "subject" | "mock_exam"
    const label = restoredSession ? restoredSession.difficulty : params.get("difficulty"); // session_type에 따라 장르(비문학/문학) 또는 과목명

    if (!regionName || !label || !["reading", "subject", "mock_exam"].includes(sessionType)) {
        // URL 자체는 잘못됐어도, 떼어낸 만료 세션(expiredSessionToBank)이 있다면 그 진행 시간은
        // 여전히 유효하니 로비로 돌려보내기 전에 먼저 은행 처리를 시도한다 - 안 그러면 이 경로에서
        // 유실될 수 있다(bankExpiredSession은 함수 선언이라 호이스팅되어 이 시점에도 호출 가능).
        if (expiredSessionToBank) bankExpiredSession(expiredSessionToBank);
        alert("잘못된 접근이에요. 로비로 돌아갈게요.");
        window.location.href = "home.html";
        return;
    }

    let durationMs = 0;
    if (sessionType === "mock_exam") {
        const minutes = (restoredSession && Number(restoredSession.duration)) || Number(params.get("duration")) || MOCK_EXAM_MINUTES[label];
        if (!minutes) {
            alert("잘못된 접근이에요. 로비로 돌아갈게요.");
            window.location.href = "home.html";
            return;
        }
        durationMs = minutes * 60000;
    }

    // ── 배경: 선택한 지역의 사진 (없으면 lobby.css의 기본 그라데이션이 그대로 보임) ──
    async function loadRegionBackground() {
        try {
            const res = await fetch(`${API_BASE_URL}/regions/`);
            if (!res.ok) throw new Error(`${res.status}`);
            const regions = await res.json();
            const region = regions.find((r) => r.name === regionName);
            if (region && region.image_file) {
                document.getElementById("reading-bg").style.backgroundImage =
                    `url('${REGION_IMAGE_BASE}${region.image_file}')`;
            }
        } catch (err) {
            console.error("지역 배경을 불러오지 못했어요.", err);
        }
    }

    // 설정의 "지역에서 인물 숨기기" 스위치 - settings.js가 이 페이지에도 로드되지만 reading.js는
    // IIFE로 감싸여 있어 그냥 함수로 두면 안 보이므로 window에 직접 노출한다(loadProfile과 같은 방식).
    // 계정(DB)에 저장된 값이라 페이지 로드 시엔 loadCharacterIllustration이 /users/me 응답으로
    // 바로 반영하고, 설정창에서 스위치를 켜고 끌 때만 이 함수로 즉시 반영한다.
    window.applyRegionCharacterVisibility = function (hide) {
        const imgEl = document.getElementById("reading-character-img");
        if (!imgEl) return;
        imgEl.hidden = Boolean(hide);
    };

    // 설정의 "지역에서 효과 숨기기" 스위치 - 반딧불이 이펙트를 껐다 켰다 한다. 위와 같은 이유로
    // window에 노출한다. 끄면 이미 떠 있는 반딧불이를 지우고, 켜면(아직 하나도 없을 때만) 새로 띄운다
    // - 스위치를 여러 번 눌러도 반딧불이가 계속 쌓이지 않게.
    window.applyRegionEffectsVisibility = function (hide) {
        const layer = document.getElementById("firefly-layer");
        if (!layer) return;
        if (hide) {
            layer.innerHTML = "";
        } else if (layer.children.length === 0) {
            spawnFireflies();
        }
    };

    async function loadCharacterIllustration() {
        try {
            const res = await fetch(`${API_BASE_URL}/users/me`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`${res.status}`);
            const data = await res.json();
            // settings.js가 표시 설정 스위치를 그리기 전에 이 캐시부터 확인한다 - 그러면 설정창을 여는
            // 순간 스위치가 "꺼짐"으로 잠깐 보였다가 저장된 값으로 바뀌는 깜빡임 없이 바로 정확하게 뜬다.
            window.__latestUserProfile = data;
            const outfit = data.character_info ? data.character_info.outfit : null;
            const imgEl = document.getElementById("reading-character-img");
            applyRegionCharacterVisibility(data.user_info?.hide_region_character);
            applyRegionEffectsVisibility(data.user_info?.hide_region_effects);
            if (!outfit) return;

            imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/reading.webp`;
            imgEl.onerror = () => {
                imgEl.onerror = null; // 무한 루프 방지
                imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/idle.webp`;
            };
        } catch (err) {
            console.error("캐릭터 정보를 불러오지 못했어요.", err);
        }
    }

    // 반딧불이
    function spawnFireflies() {
        const layer = document.getElementById("firefly-layer");
        for (let i = 0; i < FIREFLY_COUNT; i++) {
            const fly = document.createElement("div");
            fly.className = "firefly";
            fly.style.left = `${Math.random() * 100}%`;
            fly.style.animationDelay = `${(Math.random() * 8).toFixed(2)}s`;
            fly.style.animationDuration = `${(6 + Math.random() * 5).toFixed(2)}s`;
            layer.appendChild(fly);
        }
    }

    // 독서, 과목, 모의고사 표시
    function setupModeLabel() {
        const labelEl = document.getElementById("reading-mode-label");
        const timeLabelEl = document.getElementById("reading-time-label");
        if (sessionType === "reading") {
            labelEl.textContent = `장르: ${label}`;
            timeLabelEl.textContent = "독서 시간";
        } else if (sessionType === "subject") {
            labelEl.textContent = `과목: ${label}`;
            timeLabelEl.textContent = "독서 시간";
        } else {
            labelEl.textContent = `모의고사 · ${label} (${Math.round(durationMs / 60000)}분)`;
            timeLabelEl.textContent = "시험 시간";
        }
        labelEl.hidden = false;
    }

    // 모의고사 전용 - 스톱워치 좌우의 -5분/+5분 버튼으로 시험 시간을 직접 늘리거나 줄인다(실제
    // 종이 시험보다 일찍/늦게 시작했을 때 맞추기 위함). 서버는 어차피 과목별 정해진 시간(MOCK_EXAM_MINUTES)
    // 이상은 절대 인정하지 않으므로, 여기서 durationMs를 얼마든지 늘려도 보상이 그만큼 더 나가진 않는다 -
    // 순수하게 화면에 보이는 카운트다운(및 자동 제출 시점)만 조정하는 것.
    function setupMockExamAdjustButtons() {
        const minusBtn = document.getElementById("mock-exam-minus-btn");
        const plusBtn = document.getElementById("mock-exam-plus-btn");
        if (!minusBtn || !plusBtn) return;
        minusBtn.hidden = false;
        plusBtn.hidden = false;

        const ADJUST_MS = 5 * 60000;
        function adjustDuration(deltaMs) {
            if (handledEnd) return;
            durationMs = Math.max(0, durationMs + deltaMs);
            const stopwatchEl = document.getElementById("reading-stopwatch");
            stopwatchEl.textContent = formatRemaining(durationMs - getElapsedMs());
            persistActiveSession();
        }
        minusBtn.addEventListener("click", () => adjustDuration(-ADJUST_MS));
        plusBtn.addEventListener("click", () => adjustDuration(ADJUST_MS));
    }

    // ── 시간 누적: 일시정지 구간은 제외하고 누적하는 방식(스톱워치/타이머 공용) ──
    let accumulatedMs = 0;      // 일시정지 시점까지 확정된 누적 시간
    let segmentStartMs = null;  // 현재(재생 중인) 구간이 시작된 시각. 세션이 아직 시작 안 했으면 null
    let isPaused = false;
    let sessionStarted = false;
    let handledEnd = false;
    let tickIntervalId = null;
    let cutoffPerfMs = Infinity; // 이 performance.now() 값을 넘기면 더 이상 경과시간이 안 쌓인다(아래 참고)
    let cutoffWallMs = Infinity; // 위와 같은 컷오프의 Date.now() 버전 - localStorage 저장은 벽시계 기준이라야
                                  // 페이지를 새로 열었을 때(performance.now()가 0으로 리셋됨)도 비교할 수 있다.
    let hiddenSinceWallMs = null; // 탭/화면이 안 보이게 된 시점의 Date.now() - 다시 보일 때 이 구간만 보정(아래 startSessionClock 참고)
    let hiddenSincePerfMs = null; // 같은 순간의 performance.now() - 벽시계와 비교해서 "실제로 모자란 만큼"만 계산하는 데 씀

    // segmentStartMs/accumulatedMs는 Date.now()가 아니라 performance.now()(모노토닉 시계) 기준이다 -
    // Date.now()는 기기의 날짜/시간 설정을 그대로 반영하므로, 세션 도중 사용자가 시스템 시간을 미래로
    // 돌리면 그만큼 elapsed가 그대로 부풀려져서 독서시간을 조작할 수 있었다. performance.now()는
    // 페이지가 로드된 시점 기준으로 실제 흐른 시간만 단조 증가하므로 시스템 시간 변경에 영향받지 않는다.
    //
    // 지역입장을 다음날 새벽까지 켜놓고 방치하는 걸 막기 위해, 세션 시작 시점에 "다음(가장 가까운
    // 미래의) 한국시간 오전 1시"를 한 번 계산해서 performance.now() 기준 값으로 고정해둔다(cutoffPerfMs).
    // Date.now()는 이 계산에 딱 한 번만 참고용으로 쓰이고, 이후로는 다시 보지 않으므로 세션 도중
    // 시스템 시간을 바꿔도 이 컷오프 자체는 영향받지 않는다. 서버(logs.py)도 같은 규칙을 다시 한번
    // 검증하므로, 여기서는 "깜빡 잊고 켜둔" 흔한 경우를 화면에서 바로 반영해주는 역할이다.
    function computeCutoffWallMs(nowWallMs) {
        const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
        const kstNowMs = nowWallMs + KST_OFFSET_MS;
        const kstNowDate = new Date(kstNowMs);
        let cutoffKstMs = Date.UTC(
            kstNowDate.getUTCFullYear(), kstNowDate.getUTCMonth(), kstNowDate.getUTCDate(),
            1, 0, 0, 0
        );
        if (cutoffKstMs <= kstNowMs) cutoffKstMs += 24 * 60 * 60 * 1000; // 오늘 01시를 이미 지났으면 내일 01시
        return cutoffKstMs - KST_OFFSET_MS;
    }

    function getElapsedMs() {
        if (!sessionStarted) return 0;
        if (isPaused) return accumulatedMs;
        const cappedNow = Math.min(performance.now(), cutoffPerfMs);
        return accumulatedMs + Math.max(0, cappedNow - segmentStartMs);
    }

    function getElapsedMinutes() {
        return Math.floor(getElapsedMs() / 60000);
    }

    function togglePause() {
        if (!sessionStarted || handledEnd) return;
        if (isPaused) {
            segmentStartMs = performance.now();
            isPaused = false;
        } else {
            const cappedNow = Math.min(performance.now(), cutoffPerfMs);
            accumulatedMs += Math.max(0, cappedNow - segmentStartMs);
            isPaused = true;
        }
        document.getElementById("reading-pause-btn").textContent = isPaused ? "재개" : "일시정지";
        tick();
    }

    function setupPauseButton() {
        document.getElementById("reading-pause-btn")?.addEventListener("click", togglePause);
    }

    // ── 독서 시계 옆 보조 스톱워치: 세션 기록/보상과 완전히 무관한 단순 유틸리티. 숫자는 아무 의미 없음 ──
    function setupUtilityStopwatch() {
        const displayEl = document.getElementById("utility-stopwatch-display");
        const toggleBtn = document.getElementById("utility-stopwatch-toggle");
        const resetBtn = document.getElementById("utility-stopwatch-reset");
        if (!displayEl || !toggleBtn || !resetBtn) return;

        let elapsedMs = 0;
        let segmentStart = null;
        let running = false;
        let intervalId = null;

        function render() {
            const ms = elapsedMs + (running ? Date.now() - segmentStart : 0);
            const totalSeconds = Math.floor(ms / 1000);
            const mm = Math.floor(totalSeconds / 60);
            const ss = totalSeconds % 60;
            displayEl.textContent = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
        }

        toggleBtn.addEventListener("click", () => {
            if (running) {
                elapsedMs += Date.now() - segmentStart;
                running = false;
                clearInterval(intervalId);
                toggleBtn.textContent = "시작";
                toggleBtn.classList.remove("running");
            } else {
                segmentStart = Date.now();
                running = true;
                intervalId = setInterval(render, 1000);
                toggleBtn.textContent = "정지";
                toggleBtn.classList.add("running");
            }
        });

        resetBtn.addEventListener("click", () => {
            elapsedMs = 0;
            segmentStart = running ? Date.now() : null;
            render();
        });

        render();
    }

    // ── 매초 화면 갱신: 과목/독서는 카운트업(경과) 숫자, 모의고사는 카운트다운(남은 시간) 타이머 숫자 ──
    function formatRemaining(ms) {
        const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
        const mm = Math.floor(totalSeconds / 60);
        const ss = totalSeconds % 60;
        return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    }

    // 매초 진행 상황을 localStorage에 남긴다 - 탭이 갑자기 닫혀도(크래시, 강제 종료 등) 최대 1초
    // 오차 안에서 진행 시간을 복구할 수 있다. 저장하는 accumulatedMs는 "지금까지 확정된" 값이라,
    // 나중에 복구할 땐 이 값에서 새 구간을 시작하기만 하면 된다(탭이 닫혀있던 시간은 포함되지 않음).
    function persistActiveSession() {
        if (!sessionStarted || handledEnd || !window.ReadingSession) return;
        window.ReadingSession.save({
            region: regionName,
            sessionType,
            difficulty: label,
            duration: sessionType === "mock_exam" ? Math.round(durationMs / 60000) : undefined,
            accumulatedMs: getElapsedMs(),
            cutoffWallMs,
        });
    }

    function tick() {
        const stopwatchEl = document.getElementById("reading-stopwatch");
        stopwatchEl.classList.toggle("stopwatch-paused", isPaused);
        persistActiveSession();

        // 새벽 1시(KST) 컷오프에 도달하면 모의고사가 시간 종료로 자동 제출되는 것과 동일하게, 독서/과목도
        // 그 시점까지 쌓인 시간을 자동으로 종료·제출한다 - 탭을 그대로 켜놓은 채 자정을 넘겨도 그때까지
        // 공부한 시간은 보상으로 이어지게 하기 위함(예전엔 아무 처리 없이 그냥 시간이 멈춰있기만 했다).
        if (!handledEnd && Date.now() >= cutoffWallMs) {
            handleEndReading(true);
            return;
        }

        if (sessionType === "mock_exam") {
            const remainingMs = durationMs - getElapsedMs();
            stopwatchEl.textContent = formatRemaining(remainingMs);
            if (remainingMs <= 0 && !handledEnd) {
                handleEndReading(true);
            }
        } else {
            const totalMinutes = Math.floor(getElapsedMs() / 60000);
            const hh = Math.floor(totalMinutes / 60);
            const mm = totalMinutes % 60;
            stopwatchEl.textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        }
    }

    // ── 모의고사 전용: 어두운 화면 10초 카운트다운 후 자동으로 시험 타이머 시작 ──
    function runPreCountdown(onDone) {
        const overlay = document.getElementById("mock-countdown-overlay");
        const numberEl = document.getElementById("mock-countdown-number");
        overlay.hidden = false;
        let n = 10;
        numberEl.textContent = String(n);
        const countdownTimer = setInterval(() => {
            n -= 1;
            if (n <= 0) {
                clearInterval(countdownTimer);
                overlay.hidden = true;
                onDone();
            } else {
                numberEl.textContent = String(n);
            }
        }, 1000);
    }

    function startSessionClock() {
        // 복구된 세션이 있으면 거기서 확정된 누적 시간부터 이어서 잰다 - 탭이 닫혀있던 구간은
        // 세지 않는다(그 시간엔 실제로 독서를 안 했으니까). cutoffWallMs도 원래 세션이 시작될 때
        // 계산해둔 값을 그대로 이어받아야, 탭을 닫았다 늦게 열어서 컷오프에 가까워진 경우에도
        // 컷오프 자체가 새로 밀리지 않는다(이미 컷오프를 지난 세션은 여기까지 오지 않는다 -
        // expiredSessionToBank로 먼저 걸러져 자동 제출된다).
        accumulatedMs = restoredSession ? Math.max(0, Number(restoredSession.accumulatedMs) || 0) : 0;
        segmentStartMs = performance.now();
        cutoffWallMs = (restoredSession && typeof restoredSession.cutoffWallMs === "number")
            ? restoredSession.cutoffWallMs
            : computeCutoffWallMs(Date.now());
        cutoffPerfMs = segmentStartMs + (cutoffWallMs - Date.now());
        sessionStarted = true;
        document.getElementById("reading-pause-btn").hidden = false;
        document.getElementById("reading-end-btn").hidden = false;
        tick();
        tickIntervalId = setInterval(tick, 1000);

        // 모의고사는 40~100분 넘게 도는데, 브라우저는 백그라운드 탭의 setInterval을 강하게 쓰로틀링한다
        // (심하면 분 단위로 한 번만 실행) - getElapsedMs()는 performance.now() 기반이라 계산 자체는 항상 정확하지만,
        // 그 계산을 "확인하는" tick() 호출이 늦게 오면 시간이 다 됐는데도 한참 뒤에야 자동종료가 걸린다.
        // 탭이 다시 보이는(포그라운드로 돌아오는) 순간 즉시 한 번 더 확인해서 이 지연을 없앤다.
        //
        // 아이패드 등 일부 모바일 브라우저는 화면이 꺼지면(document.hidden = true) 탭 자체를 완전히
        // 멈춰버려서, performance.now()가 꺼져 있던 시간만큼 정확히 전진하지 않는 경우가 있다(단순
        // 탭 전환처럼 실제로는 안 멈추는 경우도 많다 - 그럴 땐 performance.now()가 이미 정확하다).
        // 그래서 숨겨진 구간의 두 시계(Date.now() 벽시계, performance.now())를 같이 재서, performance.now()가
        // "실제로 모자란 만큼"(deficit)만 segmentStartMs에 보정해 넣는다 - 이미 정상적으로 흘렀으면
        // deficit이 0이라 아무것도 더해지지 않는다(이걸 안 하고 무조건 벽시계 구간을 통째로 더하면,
        // performance.now()가 실제로는 안 멈췄던 경우에 시간이 두 번 반영돼 카운트가 빨리 가버린다).
        // 실제로 보고 있는 동안(포그라운드)은 여전히 performance.now()만 쓰므로 기기 시간 조작 방지
        // 효과는 유지된다.
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                hiddenSinceWallMs = Date.now();
                hiddenSincePerfMs = performance.now();
                return;
            }
            if (hiddenSinceWallMs != null && sessionStarted && !isPaused && !handledEnd) {
                const wallElapsed = Math.max(0, Date.now() - hiddenSinceWallMs);
                const perfElapsed = Math.max(0, performance.now() - hiddenSincePerfMs);
                const deficit = wallElapsed - perfElapsed;
                if (deficit > 0) segmentStartMs -= deficit;
            }
            hiddenSinceWallMs = null;
            hiddenSincePerfMs = null;
            if (sessionStarted && !handledEnd) tick();
        });
    }

    // 컷오프가 지나 더 이상 이어서 잴 수 없는 이전 세션을 조용히 서버에 자동 제출해 보상을 지급한다 -
    // 모의고사가 시간이 다 되면 자동으로 끝나는 것과 같은 취급이다. 지금 이 페이지가 새로 시작하려는(또는
    // 이어서 하려는) 세션과는 완전히 별개로 동작하며, 그 흐름을 막지 않는다. 실패하면(네트워크 오류 등)
    // localStorage에서 지우지 않고 그대로 남겨둬 다음 접속 때 다시 시도할 수 있게 한다.
    async function bankExpiredSession(session) {
        const elapsedMinutes = Math.floor((Number(session.accumulatedMs) || 0) / 60000);
        if (elapsedMinutes < 1) {
            window.ReadingSession?.clear();
            return;
        }
        try {
            const res = await fetch(`${API_BASE_URL}/logs/`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                    dungeon_name: session.region,
                    difficulty: session.difficulty,
                    reading_minutes: elapsedMinutes,
                    session_type: session.sessionType,
                    is_auto_complete: true,
                }),
                // "잘못된 접근" 경로에서는 이 요청을 보낸 직후 곧장 home.html로 리다이렉트하므로,
                // keepalive 없이는 페이지 전환에 요청 자체가 취소될 수 있다(session-guard.js의
                // releaseTabOnUnload와 동일한 이유).
                keepalive: true,
            });
            if (!res.ok) return;
            const data = await res.json();
            window.ReadingSession?.clear();
            alert(
                `새벽 1시가 지나면서 이전 학습이 자동으로 종료·저장됐어요.\n` +
                `${session.difficulty} · ${elapsedMinutes}분 (+${data.gained_exp} EXP, +${data.gained_silver} 실버, +${data.gained_gold} 골드)`
            );
        } catch (err) {
            console.error("만료된 세션 자동 저장 실패:", err);
        }
    }

    // ── 종료: 실제로 기록을 저장하고, 결과를 순차 애니메이션으로 보여줌 ──
    function setupEndButton() {
        const endBtn = document.getElementById("reading-end-btn");
        endBtn.textContent = sessionType === "mock_exam" ? "포기하기" : "독서 종료";

        endBtn.addEventListener("click", () => {
            if (sessionType === "mock_exam") {
                document.querySelector("#modal-confirm-leave .reading-confirm-text").textContent =
                    "모의고사를 포기하고 돌아가시겠습니까? 지금까지 흐른 시간만 기록돼요.";
                document.getElementById("modal-confirm-leave").classList.add("open");
                return;
            }
            const elapsedMinutes = getElapsedMinutes();
            if (elapsedMinutes < 1) {
                document.querySelector("#modal-confirm-leave .reading-confirm-text").textContent =
                    "1분도 못 채우다니~~~ 보상을 포기하고 돌아가겠습니까?";
                document.getElementById("modal-confirm-leave").classList.add("open");
            } else {
                handleEndReading();
            }
        });

        document.getElementById("confirm-leave-yes")?.addEventListener("click", () => {
            document.getElementById("modal-confirm-leave").classList.remove("open");
            handleEndReading(); // 1분 미만이어도, 혹은 모의고사 포기여도 그대로 진행 - 지금까지의 시간만 기록됨
        });

        document.getElementById("confirm-leave-no")?.addEventListener("click", () => {
            document.getElementById("modal-confirm-leave").classList.remove("open");
        });
    }

    async function handleEndReading(isAuto) {
        if (handledEnd) return;
        handledEnd = true;

        if (tickIntervalId) clearInterval(tickIntervalId);

        let elapsedMinutes = getElapsedMinutes();
        if (sessionType === "mock_exam") {
            elapsedMinutes = Math.min(elapsedMinutes, Math.round(durationMs / 60000));
        }
        const elapsedSeconds = Math.floor(getElapsedMs() / 1000);

        const endBtn = document.getElementById("reading-end-btn");
        endBtn.disabled = true;
        const pauseBtn = document.getElementById("reading-pause-btn");
        if (pauseBtn) pauseBtn.disabled = true;
        const minusBtn = document.getElementById("mock-exam-minus-btn");
        if (minusBtn) minusBtn.disabled = true;
        const plusBtn = document.getElementById("mock-exam-plus-btn");
        if (plusBtn) plusBtn.disabled = true;

        // 모달은 서버 응답(EXP/골드 계산)을 기다리지 않고 즉시 뜨되, 아직 저장이 끝난 게 아니므로
        // "저장 중..."(입장 중... 오버레이와 동일한 점 애니메이션)으로 먼저 보여준다 - 응답이 도착해야
        // "독서 완료!"로 바뀌고 통계 줄들이 채워진다.
        ["stat-row-time", "stat-row-exp", "stat-row-gold", "complete-level-block", "complete-lobby-btn"]
            .forEach((id) => { document.getElementById(id).hidden = true; });
        document.getElementById("modal-complete").classList.add("open");

        const savingDotsEl = document.getElementById("reading-complete-dots");
        let savingDotCount = 1;
        if (savingDotsEl) savingDotsEl.textContent = ".";
        const savingDotTimer = setInterval(() => {
            savingDotCount = (savingDotCount % 3) + 1;
            if (savingDotsEl) savingDotsEl.textContent = ".".repeat(savingDotCount);
        }, 400);

        try {
            const res = await fetch(`${API_BASE_URL}/logs/`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                    dungeon_name: regionName,
                    difficulty: label,
                    reading_minutes: elapsedMinutes,
                    session_type: sessionType,
                    is_auto_complete: !!isAuto
                })
            });
            const data = await res.json();

            clearInterval(savingDotTimer);

            if (!res.ok) {
                document.getElementById("modal-complete").classList.remove("open");
                alert(data.detail || "기록 저장에 실패했습니다.");
                endBtn.disabled = false;
                if (pauseBtn) pauseBtn.disabled = false;
                handledEnd = false;
                return;
            }

            // 서버 저장이 끝났으니 안전망으로 남겨둔 진행 상황은 지운다 - 안 지우면 다음에 reading.html에
            // 다시 들어갔을 때 이미 보상까지 받은 옛 세션이 계속 복구 대상으로 남는다.
            window.ReadingSession?.clear();

            releaseWakeLock();
            document.getElementById("reading-complete-title").textContent = "독서 완료!";
            showCompleteModal(data, elapsedSeconds).then(() => {
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
            });
        } catch (err) {
            clearInterval(savingDotTimer);
            document.getElementById("modal-complete").classList.remove("open");
            alert("서버에 연결할 수 없습니다.");
            endBtn.disabled = false;
            if (pauseBtn) pauseBtn.disabled = false;
            handledEnd = false;
        }
    }

    // ── 3단계: 결과를 순서대로(시간 -> EXP -> 골드 -> 레벨업 바) 애니메이션으로 보여줌 ──
    // 모달 자체는 handleEndReading이 서버 응답을 기다리지 않고 이미 열어뒀다 - 여기서는 그 안의
    // 통계 줄들만 서버가 돌려준 실제 수치로 순서대로 채운다.
    function showCompleteModal(data, elapsedSeconds) {
        return runSequence([
            () => revealStatRow("stat-row-time", "stat-value-time", elapsedSeconds, formatHMS),
            () => revealStatRow("stat-row-exp", "stat-value-exp", data.gained_exp, String),
            () => revealStatRow("stat-row-silver", "stat-value-silver", data.gained_silver, String),
            () => revealStatRow("stat-row-gold", "stat-value-gold", data.gained_gold, String),
            () => revealLevelBar(data),
        ]);
    }

    function runSequence(steps) {
        return steps.reduce((chain, step) => chain.then(step), Promise.resolve());
    }

    function revealStatRow(rowId, valueId, target, formatFn) {
        return new Promise((resolve) => {
            document.getElementById(rowId).hidden = false;
            animateCountUp(document.getElementById(valueId), 0, target, 700, formatFn, resolve);
        });
    }

    // 숫자가 0에서 target까지 아주 빠르게 올라가는 카운트업 효과 (예: 5면 1,2,3,4,5가 빠르게 스쳐감)
    function animateCountUp(el, from, to, durationMsArg, formatFn, onDone) {
        const startTime = performance.now();
        function tick(now) {
            const progress = Math.min(1, (now - startTime) / durationMsArg);
            const current = Math.round(from + (to - from) * progress);
            el.textContent = formatFn(current);
            if (progress < 1) {
                requestAnimationFrame(tick);
            } else {
                el.textContent = formatFn(to);
                if (onDone) onDone();
            }
        }
        requestAnimationFrame(tick);
    }

    function formatHMS(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    // 레벨업 바: start_level/start_exp에서 시작해서 gained_exp만큼 채워나가다가,
    // 한 레벨이 꽉 차면(=100%) 레벨 숫자가 반짝이며 다음 숫자로 바뀌고 바는 다시 0%부터 채워짐.
    // 백엔드의 레벨업 while문(레벨*100마다 레벨업)과 완전히 동일한 규칙으로 재현함.
    function revealLevelBar(data) {
        return new Promise((resolve) => {
            const block = document.getElementById("complete-level-block");
            const levelChip = document.getElementById("complete-level-chip");
            const fillEl = document.getElementById("complete-exp-fill");
            block.hidden = false;

            let level = data.start_level;
            let exp = data.start_exp;
            let remaining = data.gained_exp;

            levelChip.textContent = level >= MAX_LEVEL ? `Lv. ${level} MAX` : `Lv. ${level}`;
            setBarWidthInstant(fillEl, level >= MAX_LEVEL ? 100 : (exp / (level * 100)) * 100);

            function step() {
                // 이미 만렙이면(백엔드도 이 이상 total_exp를 안 채움) 게이지를 그대로 가득 찬 채로 끝낸다 -
                // 안 그러면 남은 remaining을 계속 다음 레벨 요구치에 채워나가다 만렙을 넘어(Lv.31 등)
                // 잠깐 표시되는 버그가 있었다(로비로 돌아가면 서버 값으로 다시 그려져서 안 보일 뿐).
                if (level >= MAX_LEVEL) {
                    setBarWidthInstant(fillEl, 100);
                    finish();
                    return;
                }

                const needed = level * 100;
                const spaceLeft = needed - exp;

                if (remaining >= spaceLeft) {
                    // 이번 레벨을 끝까지 채우고 다음 레벨로 넘어감
                    fillEl.style.transition = "width 0.5s ease-in-out";
                    fillEl.style.width = "100%";
                    remaining -= spaceLeft;

                    setTimeout(() => {
                        level += 1;
                        exp = 0;

                        if (level >= MAX_LEVEL) {
                            levelChip.textContent = `Lv. ${level} MAX`;
                            levelChip.classList.add("level-flash");
                            setTimeout(() => levelChip.classList.remove("level-flash"), 500);
                            setBarWidthInstant(fillEl, 100);
                            finish();
                            return;
                        }

                        levelChip.textContent = `Lv. ${level}`;
                        levelChip.classList.add("level-flash");
                        setTimeout(() => levelChip.classList.remove("level-flash"), 500);

                        setBarWidthInstant(fillEl, 0);

                        if (remaining > 0) {
                            setTimeout(step, 150);
                        } else {
                            finish();
                        }
                    }, 550);
                } else {
                    exp += remaining;
                    remaining = 0;
                    fillEl.style.transition = "width 0.5s ease-in-out";
                    fillEl.style.width = `${Math.min(100, (exp / needed) * 100)}%`;
                    setTimeout(finish, 600);
                }
            }

            function finish() {
                document.getElementById("complete-lobby-btn").hidden = false;
                resolve();
            }

            setTimeout(step, 200);
        });
    }

    // 트랜지션 없이 즉시 특정 %로 맞춘 다음, 강제 리플로우로 확실히 반영시키고 트랜지션을 다시 켬
    function setBarWidthInstant(el, percent) {
        el.style.transition = "none";
        el.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        void el.offsetWidth;
    }

    // ── 이 페이지만의 아주 단순한 모달 열기/닫기 (home.js와 동일한 패턴, 이 페이지는 별도 문서라 재사용은 못 함) ──
    function setupModals() {
        document.querySelectorAll("[data-modal-target]").forEach((btn) => {
            btn.addEventListener("click", () => {
                document.getElementById(btn.dataset.modalTarget)?.classList.add("open");
            });
        });
        document.querySelectorAll(".modal-overlay").forEach((overlay) => {
            if (overlay.id === "modal-complete") return; // 완료 모달은 "로비로" 버튼으로만 닫힘 - 바깥 클릭으로 못 닫음
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) overlay.classList.remove("open");
            });
            overlay.querySelector("[data-modal-close]")?.addEventListener("click", () => {
                overlay.classList.remove("open");
            });
        });

        document.getElementById("complete-lobby-btn")?.addEventListener("click", () => {
            window.location.href = "home.html";
        });
    }

    // 페이지 진입 즉시(암전) "입장하는 중"을 보여주다가, 배경/캐릭터 이미지 요청이 끝나면 가린다
    // (arena-battle.js의 showBattleEntrance와 같은 목적 - 서버/이미지 로딩 지연이 빈 화면으로 보이지 않게).
    // 점 애니메이션 자체는 파일 맨 위에서 이미 시작해뒀으므로(regionLoadingDotTimer), 여기서는 실제
    // 배경/캐릭터 로딩만 진행하고 끝나면 그 타이머를 멈추고 오버레이를 가린다.
    function showRegionEntrance() {
        Promise.all([loadRegionBackground(), loadCharacterIllustration()]).finally(() => {
            clearInterval(regionLoadingDotTimer);
            if (regionLoadingOverlayEl) regionLoadingOverlayEl.hidden = true;
        });
    }

    function init() {
        if (expiredSessionToBank) {
            bankExpiredSession(expiredSessionToBank);
        }
        showRegionEntrance();
        // 반딧불이는 loadCharacterIllustration()이 /users/me 응답(hide_region_effects)을 받은 뒤에
        // applyRegionEffectsVisibility로 띄운다 - 여기서 무조건 먼저 띄우면 설정과 상관없이 항상 보인다.
        setupModeLabel();
        setupEndButton();
        setupPauseButton();
        setupUtilityStopwatch();
        setupModals();

        requestWakeLock();
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) requestWakeLock();
        });

        // 세션이 진행되는 동안(끝내기 전) 탭을 닫거나 새로고침하려 하면 브라우저 기본 경고창을
        // 띄운다 - localStorage 복구가 있어도, 애초에 실수로 닫는 것 자체를 한 번 더 막아주는 게 낫다.
        window.addEventListener("beforeunload", (e) => {
            if (!sessionStarted || handledEnd) return;
            e.preventDefault();
            e.returnValue = "";
        });

        if (sessionType === "mock_exam") {
            const stopwatchEl = document.getElementById("reading-stopwatch");
            stopwatchEl.textContent = formatRemaining(durationMs);
            document.getElementById("reading-pause-btn").hidden = true;
            document.getElementById("reading-end-btn").hidden = true;
            setupMockExamAdjustButtons();
            // 이어서 하는 세션은 이미 한 번 카운트다운을 보고 시작한 것이므로 다시 보여주지 않는다.
            if (restoredSession) {
                startSessionClock();
            } else {
                runPreCountdown(startSessionClock);
            }
        } else {
            startSessionClock();
        }
    }

    init();
})();
