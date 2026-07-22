// 퀘스트 화면 로직. home.js는 "modal-quests를 열고 닫는다"만 알고 안의 내용은 신경 안 씀.
(function () {
    const PARTIAL_URL = "quests/quests-partial.html";
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.

    const content = document.getElementById("quests-content");
    const openButton = document.querySelector('[data-modal-target="modal-quests"]');

    let loaded = false;
    let loading = false;
    let currentPeriod = "daily";
    let questData = { daily: [], weekly: [] };

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

    function rewardText(quest) {
        const label = quest.reward_type === "exp" ? "EXP" : "골드";
        return `${label} ${Number(quest.reward_amount).toLocaleString()}`;
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
            await refreshData();
        } catch (error) {
            content.innerHTML =
                `<p class="screen-placeholder">퀘스트를 불러오지 못했습니다. (${escapeHtml(error.message)})</p>`;
        } finally {
            loading = false;
        }
    }

    async function refreshData() {
        const listEl = document.getElementById("quest-list");
        if (listEl) listEl.innerHTML = `<p class="screen-placeholder">불러오는 중...</p>`;

        try {
            const res = await fetch(`${API_BASE_URL}/quests/`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`${res.status}`);
            questData = await res.json();
            renderList();
        } catch (error) {
            if (listEl) {
                listEl.innerHTML =
                    `<p class="screen-placeholder">퀘스트를 불러오지 못했어요. (${escapeHtml(error.message)})</p>`;
            }
        }
    }

    function renderList() {
        const listEl = document.getElementById("quest-list");
        const summaryEl = document.getElementById("quest-summary-count");
        const claimAllBtn = document.getElementById("quest-claim-all-btn");
        if (!listEl) return;

        const quests = questData[currentPeriod] || [];
        const completedCount = quests.filter((q) => q.claimed).length;
        const claimableCount = quests.filter((q) => q.claimable).length;

        if (summaryEl) summaryEl.textContent = `${completedCount} / ${quests.length}`;
        if (claimAllBtn) claimAllBtn.disabled = claimableCount === 0;

        if (quests.length === 0) {
            listEl.innerHTML = `<p class="screen-placeholder">표시할 퀘스트가 없습니다.</p>`;
            return;
        }

        listEl.innerHTML = quests.map((quest) => {
            const percent = Math.min(100, (quest.progress_current / quest.progress_target) * 100);
            const btnLabel = quest.claimed ? "수령 완료" : "받기";

            return `
                <article class="quest-card${quest.claimed ? " quest-claimed" : ""}">
                    <div class="quest-card-main">
                        <div class="quest-card-name">${escapeHtml(quest.name)}</div>
                        <div class="quest-progress-line">
                            <div class="quest-progress-track">
                                <div class="quest-progress-fill" style="width:${percent}%"></div>
                            </div>
                            <span class="quest-progress-text">${quest.progress_current.toLocaleString()} / ${quest.progress_target.toLocaleString()}</span>
                        </div>
                        <div class="quest-reward-text">${escapeHtml(rewardText(quest))}</div>
                    </div>
                    <button
                        class="quest-claim-btn${quest.claimed ? " is-claimed" : ""}"
                        type="button"
                        data-quest-id="${quest.id}"
                        ${!quest.claimable || quest.claimed ? "disabled" : ""}
                    >${btnLabel}</button>
                </article>
            `;
        }).join("");
    }

    async function claimQuest(questId) {
        try {
            const res = await fetch(`${API_BASE_URL}/quests/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ quest_id: Number(questId) }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "보상을 받지 못했습니다.");
            await refreshData();
            if (typeof loadProfile === "function") await loadProfile();
        } catch (error) {
            alert(error.message);
        }
    }

    async function claimAll() {
        try {
            const res = await fetch(`${API_BASE_URL}/quests/claim-all?period=${currentPeriod}`, {
                method: "POST",
                headers: authHeaders(),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "보상을 받지 못했습니다.");
            await refreshData();
            if (typeof loadProfile === "function") await loadProfile();
        } catch (error) {
            alert(error.message);
        }
    }

    function bindInteractions() {
        const tabNav = document.getElementById("quest-tab-nav");
        tabNav?.querySelectorAll(".quest-tab-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                tabNav.querySelectorAll(".quest-tab-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                currentPeriod = btn.dataset.period;
                renderList();
            });
        });

        document.getElementById("quest-list")?.addEventListener("click", (event) => {
            const btn = event.target.closest(".quest-claim-btn");
            if (!btn || btn.disabled) return;
            claimQuest(btn.dataset.questId);
        });

        document.getElementById("quest-claim-all-btn")?.addEventListener("click", claimAll);
    }

    openButton?.addEventListener("click", async () => {
        await ensureLoaded();
        if (loaded) await refreshData();
    });
})();
