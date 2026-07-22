// 랭킹 화면 로직. home.js는 "modal-ranking을 열고 닫는다"만 알고 안의 내용은 신경 안 씀.
(function () {
    const PARTIAL_URL = "ranking/ranking-partial.html";
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;

    const content = document.getElementById("ranking-content");
    const openButton = document.querySelector('[data-modal-target="modal-ranking"]');

    let loaded = false;
    let loading = false;

    // 그룹(독서/재화·칭호/투기장) 안에 서브 랭킹 2개씩. 값 포맷터도 여기서 같이 관리해서
    // 새 랭킹 종류가 추가돼도 이 표에 항목 하나만 더하면 되게 한다.
    const GROUPS = {
        reading: [
            { key: "reading_lifetime", label: "누적 독서시간", format: formatMinutes },
            { key: "reading_daily", label: "오늘 독서시간", format: formatMinutes },
        ],
        wealth: [
            { key: "gold", label: "보유 골드", format: (v) => `${v.toLocaleString()} G` },
            { key: "titles", label: "칭호 수", format: (v) => `${v.toLocaleString()}개` },
        ],
        pvp: [
            { key: "pvp_rank", label: "PVP 등수", format: (v) => `${v.toLocaleString()}등` },
            { key: "pvp_wins", label: "PVP 승수", format: (v) => `${v.toLocaleString()}승` },
        ],
    };

    let currentGroup = "reading";
    let currentSubKey = GROUPS.reading[0].key;

    function formatMinutes(totalMinutes) {
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
    }

    function authHeaders() {
        const token = localStorage.getItem("access_token");
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    async function ensureLoaded() {
        if (loaded || loading || !content) return;
        loading = true;
        try {
            const res = await fetch(PARTIAL_URL);
            if (!res.ok) throw new Error(`화면 파일 ${res.status}`);
            content.innerHTML = await res.text();
            bindInteractions();
            loaded = true;
            await loadCurrent();
        } catch (error) {
            content.innerHTML =
                `<p class="screen-placeholder">랭킹을 불러오지 못했습니다. (${escapeHtml(error.message)})</p>`;
        } finally {
            loading = false;
        }
    }

    function renderSubNav() {
        const subNav = document.getElementById("rank-sub-nav");
        if (!subNav) return;
        subNav.innerHTML = GROUPS[currentGroup]
            .map((sub, i) => `
                <button class="rank-sub-btn${i === 0 ? " active" : ""}" data-key="${sub.key}" type="button">
                    ${escapeHtml(sub.label)}
                </button>
            `).join("");
        currentSubKey = GROUPS[currentGroup][0].key;

        subNav.querySelectorAll(".rank-sub-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                subNav.querySelectorAll(".rank-sub-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                currentSubKey = btn.dataset.key;
                loadCurrent();
            });
        });
    }

    function bindInteractions() {
        const groupNav = document.getElementById("rank-group-nav");
        groupNav?.querySelectorAll(".rank-group-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                groupNav.querySelectorAll(".rank-group-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                currentGroup = btn.dataset.group;
                renderSubNav();
                loadCurrent();
            });
        });
        renderSubNav();
    }

    async function loadCurrent() {
        const listEl = document.getElementById("rank-list");
        if (!listEl) return;
        listEl.innerHTML = `<p class="screen-placeholder">불러오는 중...</p>`;

        const meta = GROUPS[currentGroup].find((s) => s.key === currentSubKey);

        try {
            const res = await fetch(`${API_BASE_URL}/ranking/${currentSubKey}`, { headers: authHeaders() });
            const rows = res.ok ? await res.json() : [];

            if (rows.length === 0) {
                listEl.innerHTML = `<p class="screen-placeholder">아직 순위에 오른 사람이 없어요.</p>`;
                return;
            }

            listEl.innerHTML = "";
            rows.forEach((row) => {
                const rankClass = row.rank <= 3 ? ` rank-top rank-top-${row.rank}` : "";
                const item = document.createElement("div");
                item.className = `rank-row${rankClass}`;
                item.innerHTML = `
                    <div class="rank-badge">${row.rank}</div>
                    <div class="rank-avatar-frame">
                        <img class="rank-avatar" src="${row.lobby_outfit ? OUTFIT_IMAGE_BASE + row.lobby_outfit + "/idle.png" : ""}" alt="">
                    </div>
                    <div class="rank-info">
                        <div class="rank-nickname">${escapeHtml(row.nickname)}</div>
                        <div class="rank-level">Lv. ${row.level}</div>
                    </div>
                    <div class="rank-value">${escapeHtml(meta.format(row.value))}</div>
                `;
                if (row.lobby_outfit && typeof applyAvatarCrop === "function") {
                    applyAvatarCrop(item.querySelector(".rank-avatar"), row.lobby_outfit);
                }
                listEl.appendChild(item);
            });
        } catch (error) {
            listEl.innerHTML = `<p class="screen-placeholder">랭킹을 불러오지 못했어요. (${escapeHtml(error.message)})</p>`;
        }
    }

    openButton?.addEventListener("click", async () => {
        await ensureLoaded();
        if (loaded) await loadCurrent();
    });
})();
