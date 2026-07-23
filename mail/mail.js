// 우편함 화면 로직. home.js는 "modal-mail을 열고 닫는다"만 알고 안의 내용은 신경 안 씀.
// quests.js와 같은 구조(부분 화면 지연 로딩 + 목록 렌더 + 개별/일괄 수령).
(function () {
    const PARTIAL_URL = "mail/mail-partial.html";
    const content = document.getElementById("mail-content");
    const openButton = document.querySelector('[data-modal-target="modal-mail"]');
    const badge = document.getElementById("mail-badge");

    let loaded = false;
    let loading = false;
    let mailData = [];

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
        } catch (error) {
            content.innerHTML =
                `<p class="screen-placeholder">우편함을 불러오지 못했습니다. (${escapeHtml(error.message)})</p>`;
        } finally {
            loading = false;
        }
    }

    function updateBadge() {
        const count = mailData.filter((m) => !m.claimed).length;
        if (badge) {
            badge.textContent = count;
            badge.hidden = count === 0;
        }
    }

    function rewardText(mail) {
        return mail.gold_amount ? `골드 ${Number(mail.gold_amount).toLocaleString()}` : "";
    }

    function renderList() {
        const listEl = document.getElementById("mail-list");
        const claimAllBtn = document.getElementById("mail-claim-all-btn");
        if (!listEl) return;

        if (claimAllBtn) claimAllBtn.disabled = mailData.length === 0 || mailData.every((m) => m.claimed);

        if (mailData.length === 0) {
            listEl.innerHTML = `<p class="screen-placeholder">받은 우편이 없습니다.</p>`;
            return;
        }

        listEl.innerHTML = mailData.map((mail) => {
            const reward = rewardText(mail);
            return `
                <article class="mail-card${mail.claimed ? " mail-claimed" : ""}">
                    <div class="mail-card-main">
                        <div class="mail-card-title">${escapeHtml(mail.title)}</div>
                        ${mail.body ? `<div class="mail-card-body">${escapeHtml(mail.body)}</div>` : ""}
                        ${reward ? `<div class="mail-reward-text">${escapeHtml(reward)}</div>` : ""}
                    </div>
                    <button
                        class="mail-claim-btn${mail.claimed ? " is-claimed" : ""}"
                        type="button"
                        data-mail-id="${mail.id}"
                        ${mail.claimed ? "disabled" : ""}
                    >${mail.claimed ? "수령 완료" : "수령"}</button>
                </article>
            `;
        }).join("");
    }

    async function refreshData() {
        try {
            const res = await fetch(`${API_BASE_URL}/mail/`, { headers: authHeaders() });
            if (!res.ok) return;
            mailData = await res.json();
            updateBadge();
            renderList();
        } catch (error) {
            // 배지/목록은 조용히 실패 - 다음 새로고침/모달 열기 때 다시 시도됨
        }
    }

    async function claimMail(mailId) {
        try {
            const res = await fetch(`${API_BASE_URL}/mail/${mailId}/claim`, {
                method: "POST",
                headers: authHeaders(),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "보상을 받지 못했습니다.");
            await refreshData();
            if (typeof loadProfile === "function") await loadProfile();
            if (typeof showAchievementToast === "function" && data.new_achievements?.length) {
                showAchievementToast(data.new_achievements);
            }
        } catch (error) {
            alert(error.message);
        }
    }

    async function claimAll() {
        try {
            const res = await fetch(`${API_BASE_URL}/mail/claim-all`, {
                method: "POST",
                headers: authHeaders(),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "보상을 받지 못했습니다.");
            await refreshData();
            if (typeof loadProfile === "function") await loadProfile();
            if (typeof showAchievementToast === "function" && data.new_achievements?.length) {
                showAchievementToast(data.new_achievements);
            }
        } catch (error) {
            alert(error.message);
        }
    }

    async function deleteAll() {
        if (mailData.length === 0) return;
        const hasUnclaimed = mailData.some((m) => !m.claimed);
        const message = hasUnclaimed
            ? "아직 받지 않은 보상이 있는 우편이 있습니다. 정말 전체 삭제하시겠습니까?"
            : "우편함을 전부 삭제하시겠습니까?";
        if (!confirm(message)) return;

        try {
            const res = await fetch(`${API_BASE_URL}/mail/delete-all`, {
                method: "POST",
                headers: authHeaders(),
            });
            if (!res.ok) throw new Error("삭제하지 못했습니다.");
            await refreshData();
        } catch (error) {
            alert(error.message);
        }
    }

    function bindInteractions() {
        document.getElementById("mail-list")?.addEventListener("click", (event) => {
            const btn = event.target.closest(".mail-claim-btn");
            if (!btn || btn.disabled) return;
            claimMail(btn.dataset.mailId);
        });

        document.getElementById("mail-claim-all-btn")?.addEventListener("click", claimAll);
        document.getElementById("mail-delete-all-btn")?.addEventListener("click", deleteAll);
    }

    openButton?.addEventListener("click", async () => {
        await ensureLoaded();
        await refreshData();
    });

    window.addEventListener("load", refreshData);
})();
