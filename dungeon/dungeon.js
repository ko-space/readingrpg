// 지역 입장 카드 전용 로직. home.js는 이 파일의 존재를 몰라도 됨.
// 좌우 화살표로 지역을 탐색하고, 잠금(레벨 부족) 여부에 따라 사진/문구/입장버튼 상태를 바꾼다.

(function () {
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const REGION_IMAGE_BASE = "assets/regions/";

    let regions = [];
    let userLevel = 1;
    let userSilver = 0;
    let unlockedRegionNames = [];
    let currentIndex = 0;

    function authHeaders() {
        const token = localStorage.getItem("access_token");
        return token ? { "Authorization": `Bearer ${token}` } : {};
    }

    async function refreshUnlockedRegions() {
        try {
            const res = await fetch(`${API_BASE_URL}/regions/unlocked`, { headers: authHeaders() });
            if (!res.ok) return;
            const data = await res.json();
            unlockedRegionNames = data.unlocked_region_names || [];
        } catch (err) {
            console.error("지역 해금 정보를 불러오지 못했어요.", err);
        }
    }

    async function init() {
        let currentRegionName = null;

        try {
            const [regionsRes, meRes] = await Promise.all([
                fetch(`${API_BASE_URL}/regions/`),
                fetch(`${API_BASE_URL}/users/me`, { headers: authHeaders() }),
                refreshUnlockedRegions(),
            ]);
            if (!regionsRes.ok || !meRes.ok) throw new Error("응답 실패");

            regions = await regionsRes.json();
            const me = await meRes.json();
            userLevel = me.user_info.level;
            userSilver = me.user_info.silver;
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
        // 페이지 이동 순간까지 공용 입장 오버레이(shared/home.js)로 덮어서, 넘어가는 동안 빈 화면이
        // 안 보이게 한다 - reading.html에 도착하면 그쪽의 region-loading-overlay가 이어받는다.
        if (typeof showLobbyEnteringOverlay === "function") showLobbyEnteringOverlay();
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

    function formatRateText(region) {
        const parts = [];
        const expPer10Min = Math.round(region.exp_rate * 10);
        if (expPer10Min > 0) parts.push(`${expPer10Min} EXP`);
        const silverPer10Min = Math.round((region.silver_rate || 0) * 10);
        if (silverPer10Min > 0) parts.push(`${silverPer10Min} 실버`);
        const goldPer10Min = Math.round((region.gold_rate || 0) * 10);
        if (goldPer10Min > 0) parts.push(`${goldPer10Min} 골드`);
        return `${parts.join(" · ") || "0 EXP"} / 10분`;
    }

    async function handlePurchaseClick(region) {
        const enterBtn = document.getElementById("dungeon-enter-btn");
        enterBtn.disabled = true;
        try {
            const res = await fetch(`${API_BASE_URL}/regions/unlock?region_name=${encodeURIComponent(region.name)}`, {
                method: "POST",
                headers: authHeaders(),
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.detail || "해금에 실패했습니다.");
                enterBtn.disabled = false;
                return;
            }
            userSilver = data.left_silver;
            await refreshUnlockedRegions();
            renderCurrentRegion();
        } catch (err) {
            console.error("지역 해금에 실패했어요.", err);
            enterBtn.disabled = false;
        }
    }

    function renderCurrentRegion() {
        const region = regions[currentIndex];
        const isLevelUnlocked = userLevel >= region.required_level;
        const needsPurchase = region.unlock_price_silver != null && !unlockedRegionNames.includes(region.name);
        const isFullyUnlocked = isLevelUnlocked && !needsPurchase;

        const thumbEl = document.getElementById("dungeon-thumb");
        const lockEl = document.getElementById("dungeon-thumb-lock");
        const rateEl = document.getElementById("region-rate");
        const nameEl = document.getElementById("region-name");
        const enterBtn = document.getElementById("dungeon-enter-btn");
        const FALLBACK_GRADIENT = "linear-gradient(to bottom, #bfe3f7, #a8d98c)";

        nameEl.textContent = region.name;
        // 이전 렌더에서 구매 모드로 바뀌었을 수 있으니 매번 기본 상태(모달 여는 입장 버튼)로 되돌린다.
        enterBtn.onclick = null;
        enterBtn.dataset.modalTarget = "modal-dungeon";
        enterBtn.classList.remove("dungeon-enter-btn-purchase");
        enterBtn.textContent = "입장하기";

        if (isFullyUnlocked) {
            thumbEl.classList.remove("locked");
            lockEl.hidden = true;
            // 이미지+그라데이션을 같이 겹쳐 넣어서, 이미지가 404 나도 그라데이션이 그대로 보이게 함
            thumbEl.style.backgroundImage = region.image_file
                ? `url('${REGION_IMAGE_BASE}${region.image_file}'), ${FALLBACK_GRADIENT}`
                : FALLBACK_GRADIENT;

            rateEl.textContent = formatRateText(region);
            enterBtn.disabled = false;
        } else if (!isLevelUnlocked) {
            thumbEl.classList.add("locked");
            lockEl.hidden = false;
            thumbEl.style.backgroundImage = "";

            rateEl.textContent = `레벨${region.required_level} 부터 입장 가능`;
            enterBtn.disabled = true;
        } else {
            // 레벨은 됐지만 구매(해금)가 아직 안 된 지역 - 입장하기 대신 구매 버튼으로 바꾼다.
            thumbEl.classList.add("locked");
            lockEl.hidden = false;
            thumbEl.style.backgroundImage = "";

            rateEl.textContent = `${region.unlock_price_silver}실버로 해금`;
            enterBtn.disabled = false;
            enterBtn.removeAttribute("data-modal-target");
            enterBtn.textContent = "실버로 해금하기";
            enterBtn.classList.add("dungeon-enter-btn-purchase");
            enterBtn.onclick = (e) => {
                e.stopPropagation();
                handlePurchaseClick(region);
            };
        }
    }

    // dungeon.js는 defer로 로드되므로, 이 시점엔 DOM이 이미 다 파싱되어 있음
    init();
})();