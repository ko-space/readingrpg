// 업적 화면 로직. home.js는 "modal-achievements를 열고 닫는다"만 알고 안의 내용은 신경 안 씀.
(function () {
    const PARTIAL_URL = "achievements/achievements-partial.html";
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.

    const content = document.getElementById("achievements-content");
    const openButton = document.querySelector('[data-modal-target="modal-achievements"]');

    let loaded = false;
    let loading = false;

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

    // reward_gold/reward_exp/reward_items(데이터)를 사람이 읽을 문장으로 바꾼다.
    function describeReward(ach) {
        if (ach.reward_gold == null && ach.reward_exp == null && ach.reward_items == null) {
            return "";
        }
        const parts = [];
        if (ach.reward_gold) parts.push(`골드 ${Number(ach.reward_gold).toLocaleString()}`);
        if (ach.reward_exp) parts.push(`EXP ${Number(ach.reward_exp).toLocaleString()}`);
        (ach.reward_items || []).forEach((item) => {
            parts.push(`${item.name} x${item.quantity || 1}`);
        });
        return parts.length ? `보상: ${parts.join(" · ")}` : "";
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
                `<p class="screen-placeholder">업적을 불러오지 못했습니다. (${escapeHtml(error.message)})</p>`;
        } finally {
            loading = false;
        }
    }

    async function refreshData() {
        const res = await fetch(`${API_BASE_URL}/achievements/`, { headers: authHeaders() });
        const achievements = res.ok ? await res.json() : [];

        const earnedCount = achievements.filter((a) => a.earned).length;
        const countEl = document.getElementById("ach-summary-count");
        if (countEl) countEl.textContent = `${earnedCount} / ${achievements.length} 달성`;

        renderList("ach-general-list", achievements.filter((a) => !a.is_hidden));
        renderList("ach-hidden-list", achievements.filter((a) => a.is_hidden));
    }

    // 미달성 업적을 위로, 달성한 업적은 아래로(회색으로) 보낸다. 각 그룹 안에서는 서버가 준 순서(id순)를 유지.
    function sortForDisplay(items) {
        return [...items].sort((a, b) => (a.earned === b.earned) ? 0 : a.earned ? 1 : -1);
    }

    function renderList(listElId, itemsRaw) {
        const listEl = document.getElementById(listElId);
        if (!listEl) return;

        const items = sortForDisplay(itemsRaw);

        if (items.length === 0) {
            listEl.innerHTML = `<p class="ach-empty-inline">업적이 없습니다.</p>`;
            return;
        }

        listEl.innerHTML = "";
        items.forEach((ach) => {
            const locked = !ach.earned;
            const lockedHidden = locked && ach.is_hidden;
            const rewardText = lockedHidden ? "" : describeReward(ach);
            const target = ach.progress_target || 1;
            const current = Math.max(0, Math.min(ach.progress_current || 0, target));
            const percent = Math.round((current / target) * 100);

            const iconFile = ach.earned ? "trophy.png" : lockedHidden ? "lock.png" : "book.png";
            const iconFallback = ach.earned ? "🏆" : lockedHidden ? "🔒" : "📖";

            const card = document.createElement("div");
            card.className = `ach-card${ach.earned ? " ach-completed" : ""}`;
            card.innerHTML = `
                <div class="ach-card-icon">
                    <img src="assets/icons/${iconFile}" alt="" onerror="this.outerHTML='${iconFallback}'">
                </div>
                <div class="ach-card-body">
                    <div class="ach-card-name">${escapeHtml(ach.name)}</div>
                    <div class="ach-card-desc">${escapeHtml(ach.description)}</div>
                    <div class="ach-progress-row">
                        <div class="ach-progress-track">
                            <div class="ach-progress-fill" style="width:${percent}%"></div>
                        </div>
                        <div class="ach-progress-count">${current.toLocaleString()} / ${target.toLocaleString()}</div>
                    </div>
                    ${rewardText ? `<div class="ach-card-reward">${escapeHtml(rewardText)}</div>` : ""}
                    ${ach.earned_at ? `<div class="ach-card-earned-at">${new Date(ach.earned_at).toLocaleDateString("ko-KR")} 달성</div>` : ""}
                </div>
            `;

            listEl.appendChild(card);
        });
    }

    function scrollToSection(btn) {
        const targetEl = document.getElementById(btn.dataset.section);
        const scrollOuter = document.getElementById("ach-scroll-outer");
        if (targetEl && scrollOuter) {
            scrollOuter.scrollTo({ left: targetEl.offsetLeft, behavior: "smooth" });
        }
        document.querySelectorAll(".ach-index-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
    }

    function bindInteractions() {
        document.querySelectorAll(".ach-index-btn").forEach((btn) => {
            btn.addEventListener("click", () => scrollToSection(btn));
        });
    }

    openButton?.addEventListener("click", async () => {
        await ensureLoaded();
        if (loaded) await refreshData();
    });
})();
