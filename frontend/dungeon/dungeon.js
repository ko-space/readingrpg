// 지역 입장 카드 전용 로직. home.js는 이 파일의 존재를 몰라도 됨.
// 좌우 화살표로 지역을 탐색하고, 잠금(레벨 부족) 여부에 따라 사진/문구/입장버튼 상태를 바꾼다.

(function () {
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const REGION_IMAGE_BASE = "assets/regions/";

    let regions = [];
    let userLevel = 1;
    let currentIndex = 0;

    function authHeaders() {
        const token = localStorage.getItem("access_token");
        return token ? { "Authorization": `Bearer ${token}` } : {};
    }

    async function init() {
        let currentRegionName = null;

        try {
            const [regionsRes, meRes] = await Promise.all([
                fetch(`${API_BASE_URL}/regions/`),
                fetch(`${API_BASE_URL}/users/me`, { headers: authHeaders() })
            ]);
            if (!regionsRes.ok || !meRes.ok) throw new Error("응답 실패");

            regions = await regionsRes.json();
            const me = await meRes.json();
            userLevel = me.user_info.level;
            currentRegionName = me.region_info ? me.region_info.name : null;
        } catch (err) {
            console.error("지역 정보를 불러오지 못했어요.", err);
            return;
        }

        if (!regions || regions.length === 0) return;

        const foundIndex = regions.findIndex((r) => r.name === currentRegionName);
        currentIndex = foundIndex >= 0 ? foundIndex : 0;

        setupArrows();
        setupDungeonTabs();
        setupGenreButtons();
        renderCurrentRegion();
    }

    // ── 1단계: 독서/과목/모의고사 탭 전환 ──────────
    function setupDungeonTabs() {
        document.querySelectorAll(".dungeon-tab-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".dungeon-tab-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                const tab = btn.dataset.dungeonTab;
                document.querySelectorAll(".dungeon-tab-panel").forEach((panel) => {
                    panel.hidden = panel.dataset.dungeonPanel !== tab;
                });
            });
        });
    }

    // ── 1단계: 방식 선택 -> 새 페이지(reading.html)로 이동 ──────────
    function setupGenreButtons() {
        document.getElementById("genre-btn-nonfiction")?.addEventListener("click", () => {
            goToReading("reading", "비문학");
        });
        document.getElementById("genre-btn-literature")?.addEventListener("click", () => {
            goToReading("reading", "문학");
        });

        document.querySelectorAll("[data-subject-name]").forEach((btn) => {
            btn.addEventListener("click", () => goToReading("subject", btn.dataset.subjectName));
        });

        document.querySelectorAll("[data-mock-subject]").forEach((btn) => {
            btn.addEventListener("click", () => {
                goToReading("mock_exam", btn.dataset.mockSubject, btn.dataset.mockMinutes);
            });
        });
    }

    function goToReading(sessionType, label, mockMinutes) {
        const region = regions[currentIndex];
        if (!region) return;
        const params = new URLSearchParams({ region: region.name, session_type: sessionType, difficulty: label });
        if (mockMinutes) params.set("duration", mockMinutes);
        window.location.href = `reading.html?${params.toString()}`;
    }

    function setupArrows() {
        const leftBtn = document.getElementById("region-nav-left");
        const rightBtn = document.getElementById("region-nav-right");

        leftBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            currentIndex = (currentIndex - 1 + regions.length) % regions.length;
            renderCurrentRegion();
        });

        rightBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            currentIndex = (currentIndex + 1) % regions.length;
            renderCurrentRegion();
        });
    }

    function renderCurrentRegion() {
        const region = regions[currentIndex];
        const isUnlocked = userLevel >= region.required_level;

        const thumbEl = document.getElementById("dungeon-thumb");
        const lockEl = document.getElementById("dungeon-thumb-lock");
        const rateEl = document.getElementById("region-rate");
        const nameEl = document.getElementById("region-name");
        const enterBtn = document.getElementById("dungeon-enter-btn");
        const FALLBACK_GRADIENT = "linear-gradient(to bottom, #bfe3f7, #a8d98c)";

        nameEl.textContent = region.name;

        if (isUnlocked) {
            thumbEl.classList.remove("locked");
            lockEl.hidden = true;
            // 이미지+그라데이션을 같이 겹쳐 넣어서, 이미지가 404 나도 그라데이션이 그대로 보이게 함
            thumbEl.style.backgroundImage = region.image_file
                ? `url('${REGION_IMAGE_BASE}${region.image_file}'), ${FALLBACK_GRADIENT}`
                : FALLBACK_GRADIENT;

            const expPer10Min = Math.round(region.exp_rate * 10);
            rateEl.textContent = `${expPer10Min} EXP / 10분`;
            enterBtn.disabled = false;
        } else {
            thumbEl.classList.add("locked");
            lockEl.hidden = false;
            thumbEl.style.backgroundImage = "";

            rateEl.textContent = `레벨${region.required_level} 부터 입장 가능`;
            enterBtn.disabled = true;
        }
    }

    // dungeon.js는 defer로 로드되므로, 이 시점엔 DOM이 이미 다 파싱되어 있음
    init();
})();