// 설정 화면 로직. home.html/reading.html 둘 다에서 쓰는 공용 스크립트라 페이지별 상태를 전혀 몰라도 되게 짰다.
// 각 페이지의 모달 열기/닫기 스크립트(home.js/reading.js)는 "modal-settings를 열고 닫는다"만 알면 됨.
(function () {
    const PARTIAL_URL = "settings/settings-partial.html";
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.

    const content = document.getElementById("settings-content");
    if (!content) return; // 이 페이지엔 설정 모달 자체가 없음

    let loaded = false;
    let loading = false;

    function authHeaders(json = false) {
        const token = localStorage.getItem("access_token");
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        if (json) headers["Content-Type"] = "application/json";
        return headers;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    // 로비 상단바가 있는 페이지(home.html)면 즉시 최신 정보로 갱신, 없는 페이지(reading.html)면 그냥 넘어간다.
    function refreshLobbyProfile() {
        if (typeof loadProfile === "function") loadProfile();
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
            await loadCurrentNickname();
            await loadTitleList();
        } catch (error) {
            content.innerHTML =
                `<p class="screen-placeholder">설정을 불러오지 못했습니다. (${escapeHtml(error.message)})</p>`;
        } finally {
            loading = false;
        }
    }

    async function loadCurrentNickname() {
        const input = document.getElementById("settings-nickname-input");
        if (!input) return;
        try {
            const res = await fetch(`${API_BASE_URL}/users/me`, { headers: authHeaders() });
            if (!res.ok) return;
            const data = await res.json();
            input.value = data.user_info.nickname;
        } catch (err) {
            console.error("닉네임 정보를 불러오지 못했어요.", err);
        }
    }

    async function saveNickname() {
        const input = document.getElementById("settings-nickname-input");
        const msgEl = document.getElementById("settings-nickname-msg");
        const saveBtn = document.getElementById("settings-nickname-save-btn");
        if (!input || !msgEl) return;

        const nickname = input.value.trim();
        if (!nickname) {
            msgEl.textContent = "닉네임을 입력해주세요.";
            msgEl.className = "settings-hint settings-hint-error";
            return;
        }

        saveBtn.disabled = true;
        try {
            const res = await fetch(`${API_BASE_URL}/users/nickname`, {
                method: "POST",
                headers: authHeaders(true),
                body: JSON.stringify({ nickname }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "닉네임 변경에 실패했어요.");

            msgEl.textContent = data.message;
            msgEl.className = "settings-hint settings-hint-success";
            refreshLobbyProfile();
        } catch (error) {
            msgEl.textContent = error.message;
            msgEl.className = "settings-hint settings-hint-error";
        } finally {
            saveBtn.disabled = false;
        }
    }

    async function loadTitleList() {
        const listEl = document.getElementById("settings-title-list");
        if (!listEl) return;
        listEl.innerHTML = `<p class="screen-placeholder">불러오는 중...</p>`;

        try {
            const res = await fetch(`${API_BASE_URL}/achievements/`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`${res.status}`);
            const achievements = await res.json();
            const earned = achievements.filter((a) => a.earned);

            listEl.innerHTML = "";

            const noneRow = buildTitleRow(null, "칭호 없음", !earned.some((a) => a.equipped));
            listEl.appendChild(noneRow);

            if (earned.length === 0) {
                const emptyHint = document.createElement("p");
                emptyHint.className = "settings-hint";
                emptyHint.textContent = "아직 달성한 업적이 없어요. 업적을 달성하면 여기서 칭호로 고를 수 있어요.";
                listEl.appendChild(emptyHint);
                return;
            }

            earned.forEach((ach) => {
                listEl.appendChild(buildTitleRow(ach.id, ach.name, ach.equipped, ach.is_hidden));
            });
        } catch (error) {
            listEl.innerHTML = `<p class="screen-placeholder">칭호 목록을 불러오지 못했어요.</p>`;
        }
    }

    function buildTitleRow(achievementId, label, isEquipped, isHidden) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `settings-title-row${isEquipped ? " settings-title-equipped" : ""}${isHidden ? " settings-title-hidden-glow" : ""}`;
        row.innerHTML = `
            <span class="settings-title-name">${escapeHtml(label)}</span>
            <span class="settings-title-check">${isEquipped ? "✓ 장착중" : ""}</span>
        `;
        row.addEventListener("click", () => equipTitle(achievementId));
        return row;
    }

    async function equipTitle(achievementId) {
        try {
            const res = await fetch(`${API_BASE_URL}/achievements/equip`, {
                method: "POST",
                headers: authHeaders(true),
                body: JSON.stringify({ achievement_id: achievementId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "칭호 변경에 실패했어요.");
            await loadTitleList();
            refreshLobbyProfile();
        } catch (error) {
            alert(error.message);
        }
    }

    async function handleLogout() {
        try {
            await fetch(`${API_BASE_URL}/auth/logout`, { method: "POST", headers: authHeaders() });
        } catch (error) {
            console.error("로그아웃 요청 실패:", error);
        }
        localStorage.removeItem("access_token");
        window.location.href = "index.html";
    }

    function bindInteractions() {
        document.getElementById("settings-nickname-save-btn")?.addEventListener("click", saveNickname);
        document.getElementById("settings-nickname-input")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") saveNickname();
        });
        document.getElementById("settings-logout-btn")?.addEventListener("click", handleLogout);
    }

    document.querySelectorAll('[data-modal-target="modal-settings"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
            await ensureLoaded();
            if (loaded) {
                await loadCurrentNickname();
                await loadTitleList();
            }
        });
    });
})();
