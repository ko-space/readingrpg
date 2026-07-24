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
    let challengeData = [];

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

    function updateQuestBadge() {
        const badge = document.getElementById("quest-badge");
        if (!badge) return;
        const questClaimable = ["daily", "weekly"].reduce(
            (sum, period) => sum + (questData[period] || []).filter((q) => q.claimable && !q.claimed).length,
            0
        );
        const challengeClaimable = challengeData.filter((c) => c.claimable && !c.claimed).length;
        const claimableCount = questClaimable + challengeClaimable;
        badge.textContent = claimableCount;
        badge.hidden = claimableCount === 0;
    }

    function rewardText(quest) {
        if (quest.reward_type === "item") return `${quest.reward_item_name} ${Number(quest.reward_amount).toLocaleString()}개`;
        const label = quest.reward_type === "exp" ? "EXP" : "골드";
        return `${label} ${Number(quest.reward_amount).toLocaleString()}`;
    }

    function challengeRewardText(challenge) {
        const parts = [];
        if (challenge.reward_gold) parts.push(`골드 ${Number(challenge.reward_gold).toLocaleString()}`);
        if (challenge.reward_exp) parts.push(`EXP ${Number(challenge.reward_exp).toLocaleString()}`);
        (challenge.reward_items || []).forEach((item) => {
            if (item.type === "character") parts.push(`${item.name} x${item.quantity}`);
            else if (item.type === "item") parts.push(`${item.name} ${item.quantity}개`);
        });
        return parts.join(" · ") || "보상 없음";
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
            const [questRes, challengeRes] = await Promise.all([
                fetch(`${API_BASE_URL}/quests/`, { headers: authHeaders() }),
                fetch(`${API_BASE_URL}/challenges/`, { headers: authHeaders() }),
            ]);
            if (!questRes.ok) throw new Error(`${questRes.status}`);
            questData = await questRes.json();
            challengeData = challengeRes.ok ? await challengeRes.json() : [];
            renderList();
            updateQuestBadge();
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

        const isChallengeTab = currentPeriod === "challenge";
        const items = isChallengeTab ? challengeData : (questData[currentPeriod] || []);
        const completedCount = items.filter((q) => q.claimed).length;
        const claimableCount = items.filter((q) => q.claimable).length;

        if (summaryEl) summaryEl.textContent = `${completedCount} / ${items.length}`;
        if (claimAllBtn) claimAllBtn.disabled = claimableCount === 0;

        if (items.length === 0) {
            listEl.innerHTML = `<p class="screen-placeholder">표시할 항목이 없습니다.</p>`;
            return;
        }

        // 표시 순서: 완료(수령 가능) -> 진행 중 -> 이미 보상 받음. 원본 배열 순서(sort_order 등)는
        // 건드리지 않도록 정렬은 렌더링용 복사본에서만 한다.
        const rank = (item) => (item.claimed ? 2 : item.claimable ? 0 : 1);
        const sortedItems = items.slice().sort((a, b) => rank(a) - rank(b));

        listEl.innerHTML = sortedItems.map((item) => {
            const percent = Math.min(100, (item.progress_current / item.progress_target) * 100);
            const btnLabel = item.claimed ? "수령 완료" : "받기";
            const idAttr = isChallengeTab ? `data-challenge-id="${item.id}"` : `data-quest-id="${item.id}"`;
            const reward = isChallengeTab ? challengeRewardText(item) : rewardText(item);
            const description = isChallengeTab && item.description
                ? `<div class="quest-card-desc">${escapeHtml(item.description)}</div>`
                : "";

            return `
                <article class="quest-card${item.claimed ? " quest-claimed" : ""}">
                    <div class="quest-card-main">
                        <div class="quest-card-name">${escapeHtml(item.name)}</div>
                        ${description}
                        <div class="quest-progress-line">
                            <div class="quest-progress-track">
                                <div class="quest-progress-fill" style="width:${percent}%"></div>
                            </div>
                            <span class="quest-progress-text">${item.progress_current.toLocaleString()} / ${item.progress_target.toLocaleString()}</span>
                        </div>
                        <div class="quest-reward-text">${escapeHtml(reward)}</div>
                    </div>
                    <button
                        class="quest-claim-btn${item.claimed ? " is-claimed" : ""}"
                        type="button"
                        ${idAttr}
                        ${!item.claimable || item.claimed ? "disabled" : ""}
                    >${btnLabel}</button>
                </article>
            `;
        }).join("");
    }

    async function claimQuest(questId) {
        const quests = questData[currentPeriod] || [];
        const quest = quests.find((q) => q.id === Number(questId));
        if (!quest || quest.claimed || !quest.claimable) return;

        // 낙관적 UI: 서버 응답을 기다리지 않고 즉시 수령 완료로 표시한다 - 실패하면 되돌린다.
        // claimed와 claimable을 둘 다 갱신해야 한다 - 배지 카운트는 "claimable && !claimed"로 세는데,
        // claimable을 안 지우면 나중에 questData가 부분적으로만 갱신되는 경로가 생겼을 때 다시 세어질
        // 여지가 남는다.
        quest.claimed = true;
        quest.claimable = false;
        renderList();
        updateQuestBadge();

        try {
            const res = await fetch(`${API_BASE_URL}/quests/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ quest_id: Number(questId) }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "보상을 받지 못했습니다.");
            if (typeof loadProfile === "function") await loadProfile();
            if (typeof showAchievementToast === "function" && data.new_achievements?.length) {
                showAchievementToast(data.new_achievements);
            }
        } catch (error) {
            quest.claimed = false;
            quest.claimable = true;
            renderList();
            updateQuestBadge();
            alert(error.message);
        }
    }

    async function claimChallenge(challengeId) {
        const challenge = challengeData.find((c) => c.id === Number(challengeId));
        if (!challenge || challenge.claimed || !challenge.claimable) return;

        challenge.claimed = true;
        challenge.claimable = false;
        renderList();
        updateQuestBadge();

        try {
            const res = await fetch(`${API_BASE_URL}/challenges/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ challenge_id: Number(challengeId) }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "보상을 받지 못했습니다.");
            if (typeof loadProfile === "function") await loadProfile();
        } catch (error) {
            challenge.claimed = false;
            challenge.claimable = true;
            renderList();
            updateQuestBadge();
            alert(error.message);
        }
    }

    async function claimAll() {
        const isChallengeTab = currentPeriod === "challenge";
        const items = isChallengeTab ? challengeData : (questData[currentPeriod] || []);
        const claimableIds = items.filter((q) => q.claimable && !q.claimed).map((q) => q.id);
        if (claimableIds.length === 0) return;

        items.forEach((q) => { if (q.claimable) { q.claimed = true; q.claimable = false; } });
        renderList();
        updateQuestBadge();

        const url = isChallengeTab
            ? `${API_BASE_URL}/challenges/claim-all`
            : `${API_BASE_URL}/quests/claim-all?period=${currentPeriod}`;

        try {
            const res = await fetch(url, {
                method: "POST",
                headers: authHeaders(),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "보상을 받지 못했습니다.");
            if (typeof loadProfile === "function") await loadProfile();
            if (typeof showAchievementToast === "function" && data.new_achievements?.length) {
                showAchievementToast(data.new_achievements);
            }
        } catch (error) {
            claimableIds.forEach((id) => {
                const q = items.find((qq) => qq.id === id);
                if (q) { q.claimed = false; q.claimable = true; }
            });
            renderList();
            updateQuestBadge();
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
            if (btn.dataset.challengeId) claimChallenge(btn.dataset.challengeId);
            else claimQuest(btn.dataset.questId);
        });

        document.getElementById("quest-claim-all-btn")?.addEventListener("click", claimAll);
    }

    openButton?.addEventListener("click", async () => {
        await ensureLoaded();
        if (loaded) await refreshData();
    });

    // 퀘스트 화면을 열기 전에도 버튼에 미수령 알림(불)을 보여줘야 하므로, 홈 진입 시점부터
    // 미리 한 번 불러온다(mail.js와 동일한 패턴) - #quest-list가 아직 없어도 refreshData는
    // 안전하게 데이터만 받아와 배지를 갱신한다.
    window.addEventListener("load", refreshData);
})();
