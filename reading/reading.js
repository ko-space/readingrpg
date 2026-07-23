// 독서 화면(2단계) 전용 로직. home.js/gacha.js 등과 완전히 독립적으로 동작 - 이 페이지는 별도 HTML이라 공유할 필요 없음.

(function () {
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;
    const REGION_IMAGE_BASE = "assets/regions/";
    const FIREFLY_COUNT = 18;

    // 모의고사 탭의 과목별 소요시간(분). dungeon.js가 duration을 실어 보내지만, 값이 비거나 이상하면 여기서도 검증한다.
    const MOCK_EXAM_MINUTES = { "국어": 80, "수학": 100, "수학(하프)": 50, "영어": 70, "영어(하프)": 40, "탐구": 30 };

    function authHeaders() {
        const token = localStorage.getItem("access_token");
        return token ? { "Authorization": `Bearer ${token}` } : {};
    }

    // URL에서 1단계가 실어 보낸 정보를 읽는다.
    // (예: reading.html?region=초심자의+평원&session_type=mock_exam&difficulty=국어&duration=80)
    const params = new URLSearchParams(window.location.search);
    const regionName = params.get("region");
    const sessionType = params.get("session_type") || "reading"; // "reading" | "subject" | "mock_exam"
    const label = params.get("difficulty"); // session_type에 따라 장르(비문학/문학) 또는 과목명

    if (!regionName || !label || !["reading", "subject", "mock_exam"].includes(sessionType)) {
        alert("잘못된 접근이에요. 로비로 돌아갈게요.");
        window.location.href = "home.html";
        return;
    }

    let durationMs = 0;
    if (sessionType === "mock_exam") {
        const minutes = Number(params.get("duration")) || MOCK_EXAM_MINUTES[label];
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

    // ── 캐릭터: 장착 중인 의상의 '독서 자세' 일러스트 ──
    // outfit은 이제 폴더 경로(예: songjuheon/basic)라, 그 안의 reading.png를 먼저 시도하고
    // 없으면(404) idle.png(기본 서있는 자세)로 자동 대체된다.
    async function loadCharacterIllustration() {
        try {
            const res = await fetch(`${API_BASE_URL}/users/me`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`${res.status}`);
            const data = await res.json();
            const outfit = data.character_info ? data.character_info.outfit : null;
            const imgEl = document.getElementById("reading-character-img");
            if (!outfit) return;

            imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/reading.png`;
            imgEl.onerror = () => {
                imgEl.onerror = null; // 무한 루프 방지
                imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/idle.png`;
            };
        } catch (err) {
            console.error("캐릭터 정보를 불러오지 못했어요.", err);
        }
    }

    // ── 노란 반딧불이가 계속 위로 피어오르는 이펙트 ──
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

    // ── 상단 라벨: 지금 뭘 하고 있는지(장르/과목/모의고사) 보여줌 ──
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

    // ── 시간 누적: 일시정지 구간은 제외하고 누적하는 방식(스톱워치/타이머 공용) ──
    let accumulatedMs = 0;      // 일시정지 시점까지 확정된 누적 시간
    let segmentStartMs = null;  // 현재(재생 중인) 구간이 시작된 시각. 세션이 아직 시작 안 했으면 null
    let isPaused = false;
    let sessionStarted = false;
    let handledEnd = false;
    let tickIntervalId = null;

    function getElapsedMs() {
        if (!sessionStarted) return 0;
        if (isPaused) return accumulatedMs;
        return accumulatedMs + (Date.now() - segmentStartMs);
    }

    function getElapsedMinutes() {
        return Math.floor(getElapsedMs() / 60000);
    }

    function togglePause() {
        if (!sessionStarted || handledEnd) return;
        if (isPaused) {
            segmentStartMs = Date.now();
            isPaused = false;
        } else {
            accumulatedMs += Date.now() - segmentStartMs;
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

    function tick() {
        const stopwatchEl = document.getElementById("reading-stopwatch");
        stopwatchEl.classList.toggle("stopwatch-paused", isPaused);

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
        segmentStartMs = Date.now();
        sessionStarted = true;
        document.getElementById("reading-pause-btn").hidden = false;
        document.getElementById("reading-end-btn").hidden = false;
        tick();
        tickIntervalId = setInterval(tick, 1000);
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

            if (!res.ok) {
                alert(data.detail || "기록 저장에 실패했습니다.");
                endBtn.disabled = false;
                if (pauseBtn) pauseBtn.disabled = false;
                handledEnd = false;
                return;
            }

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
            alert("서버에 연결할 수 없습니다.");
            endBtn.disabled = false;
            if (pauseBtn) pauseBtn.disabled = false;
            handledEnd = false;
        }
    }

    // ── 3단계: 결과를 순서대로(시간 -> EXP -> 골드 -> 레벨업 바) 애니메이션으로 보여줌 ──
    function showCompleteModal(data, elapsedSeconds) {
        const modal = document.getElementById("modal-complete");

        ["stat-row-time", "stat-row-exp", "stat-row-gold", "complete-level-block", "complete-lobby-btn"]
            .forEach((id) => { document.getElementById(id).hidden = true; });

        modal.classList.add("open");

        return runSequence([
            () => revealStatRow("stat-row-time", "stat-value-time", elapsedSeconds, formatHMS),
            () => revealStatRow("stat-row-exp", "stat-value-exp", data.gained_exp, String),
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

            levelChip.textContent = `Lv. ${level}`;
            setBarWidthInstant(fillEl, (exp / (level * 100)) * 100);

            function step() {
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

    function init() {
        loadRegionBackground();
        loadCharacterIllustration();
        spawnFireflies();
        setupModeLabel();
        setupEndButton();
        setupPauseButton();
        setupUtilityStopwatch();
        setupModals();

        if (sessionType === "mock_exam") {
            const stopwatchEl = document.getElementById("reading-stopwatch");
            stopwatchEl.textContent = formatRemaining(durationMs);
            document.getElementById("reading-pause-btn").hidden = true;
            document.getElementById("reading-end-btn").hidden = true;
            runPreCountdown(startSessionClock);
        } else {
            startSessionClock();
        }
    }

    init();
})();
