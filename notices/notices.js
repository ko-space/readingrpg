(function () {
    const PARTIAL_URL = "notices/notices-partial.html";
    const content = document.getElementById("notices-content");
    const openButton = document.querySelector('[data-modal-target="modal-alerts"]');
    const badge = document.getElementById("notice-badge");

    let loaded = false;
    let loading = false;
    let noticeData = [];

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
                `<p class="screen-placeholder">공지를 불러오지 못했습니다. (${escapeHtml(error.message)})</p>`;
        } finally {
            loading = false;
        }
    }

    function updateBadge() {
        const unreadCount = noticeData.filter((n) => !n.read).length;
        if (badge) {
            badge.textContent = unreadCount;
            badge.hidden = unreadCount === 0;
        }
    }

    function renderList() {
        const listEl = document.getElementById("notice-list");
        if (!listEl) return;

        if (noticeData.length === 0) {
            listEl.innerHTML = `<p class="screen-placeholder">등록된 공지가 없습니다.</p>`;
            return;
        }

        listEl.innerHTML = noticeData.map((n) => `
            <button class="notice-row" type="button" data-notice-id="${n.id}">
                <span class="notice-row-title">${escapeHtml(n.title)}</span>
                ${n.read ? "" : '<span class="notice-new-dot"></span>'}
            </button>
        `).join("");
    }

    async function refreshData() {
        try {
            const res = await fetch(`${API_BASE_URL}/notices/`, { headers: authHeaders() });
            if (!res.ok) return;
            noticeData = await res.json();
            updateBadge();
            renderList();
        } catch (error) {
        }
    }

    async function openDetail(noticeId) {
        const notice = noticeData.find((n) => n.id === Number(noticeId));
        const overlay = document.getElementById("notice-detail-overlay");
        if (!notice || !overlay) return;

        const img = document.getElementById("notice-detail-image");
        const title = document.getElementById("notice-detail-title");
        const body = document.getElementById("notice-detail-body");

        if (notice.image_file) {
            img.onerror = () => { img.hidden = true; };
            img.src = notice.image_file;
            img.hidden = false;
        } else {
            img.hidden = true;
        }
        title.textContent = notice.title;
        body.textContent = notice.body;
        overlay.hidden = false;

        if (!notice.read) {
            notice.read = true;
            renderList();
            updateBadge();
            try {
                await fetch(`${API_BASE_URL}/notices/${noticeId}/read`, {
                    method: "POST",
                    headers: authHeaders(),
                });
            } catch (error) {
                // 다음에 다시열면 재시도
            }
        }
    }

    function closeDetail() {
        const overlay = document.getElementById("notice-detail-overlay");
        if (overlay) overlay.hidden = true;
    }

    function bindInteractions() {
        document.getElementById("notice-list")?.addEventListener("click", (event) => {
            const row = event.target.closest(".notice-row");
            if (!row) return;
            openDetail(row.dataset.noticeId);
        });

        document.getElementById("notice-detail-close")?.addEventListener("click", closeDetail);
        document.getElementById("notice-detail-overlay")?.addEventListener("click", (event) => {
            if (event.target.id === "notice-detail-overlay") closeDetail();
        });
    }

    openButton?.addEventListener("click", async () => {
        await ensureLoaded();
        await refreshData();
    });

    window.addEventListener("load", refreshData);
})();
