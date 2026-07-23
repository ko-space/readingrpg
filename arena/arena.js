// 투기장(PVP) 전용 로직. home.js는 이 파일의 존재를 몰라도 됨 -
// home.js는 그냥 "modal-arena를 열고 닫는다"만 알고, 안에 뭐가 들어있는지는 신경 안 씀.

(function () {
    const PVP_PARTIAL_URL = "arena/arena-partial.html";
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;

    const modalBox = document.getElementById("arena-modal-box");
    const choiceView = document.getElementById("arena-choice-view");
    const contentEl = document.getElementById("pvp-content");

    let loaded = false;
    let loading = false;
    let myInventory = []; // /characters/inventory 결과 (같은 이름+같은 성급은 하나로 묶여있음)
    let myDefense = { front: null, back: null }; // /pvp/defense 결과 (지금 저장된 방어 편성)

    function authHeaders() {
        const token = localStorage.getItem("access_token");
        return token ? { "Authorization": `Bearer ${token}` } : {};
    }

    // 백엔드가 내려주는 created_at은 시간대 표시가 없는 UTC(datetime.utcnow() 기준) 문자열이다.
    // Z/오프셋이 없는 ISO 문자열을 new Date()에 그대로 넣으면 UTC가 아니라 "보는 사람의 로컬 시간"으로
    // 잘못 해석되므로(예: 실제 UTC 10시를 KST 10시로 착각), Z를 붙여 UTC임을 명시하고, 표시할 때도
    // 보는 사람의 시스템 시간대와 무관하게 항상 한국 시간(KST)으로 고정해서 보여준다.
    function formatKst(isoString, options) {
        const withZ = /[zZ]$|[+-]\d\d:\d\d$/.test(isoString) ? isoString : `${isoString}Z`;
        return new Date(withZ).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", ...options });
    }

    // ── 입장 시 'PVE(토벌전) / PVP(전술대회)' 선택 화면부터 보여줌 ──────────────────
    async function showArenaChoice() {
        if (modalBox) modalBox.classList.remove("arena-expanded");
        if (choiceView) choiceView.hidden = false;
        if (contentEl) contentEl.hidden = true;
        await updatePvpChoiceAvailability();
    }

    // 전술대회는 서로 다른 이름의 캐릭터를 2명 이상 보유해야 입장 가능 (방어 편성에 전방/후방이 필요하므로)
    async function updatePvpChoiceAvailability() {
        const pvpBtn = document.getElementById("arena-choice-pvp");
        if (!pvpBtn) return;

        try {
            const res = await fetch(`${API_BASE_URL}/characters/inventory`, { headers: authHeaders() });
            const data = await res.json();
            const distinctNames = new Set((data.characters || []).map((c) => c.name));

            if (distinctNames.size < 2) {
                pvpBtn.disabled = true;
                pvpBtn.querySelector(".arena-choice-soon")?.remove();
                const notice = document.createElement("span");
                notice.className = "arena-choice-soon";
                notice.textContent = "캐릭터 2명 이상 필요";
                pvpBtn.appendChild(notice);
            } else {
                pvpBtn.disabled = false;
                pvpBtn.querySelector(".arena-choice-soon")?.remove();
            }
        } catch (err) {
            console.error("캐릭터 보유 현황을 확인하지 못했어요.", err);
        }
    }

    // '전술대회' 선택 시: 모달이 부드럽게 커지면서 PVP 화면으로 전환됨
    async function enterPvp() {
        if (modalBox) modalBox.classList.add("arena-expanded");
        if (choiceView) choiceView.hidden = true;
        if (contentEl) contentEl.hidden = false;
        const alreadyLoaded = loaded;
        await loadPvpPartial();
        // 나갔다가 다시 들어올 때마다 후보 목록을 새로 뽑는다(리롤) - 첫 진입은 loadPvpPartial이
        // 이미 초기 로딩 과정에서 한 번 불러오므로 중복 호출하지 않는다.
        if (alreadyLoaded) await loadOpponents();
    }

    async function loadPvpPartial() {
        if (loaded || loading || !contentEl) return;
        loading = true;
        try {
            const res = await fetch(PVP_PARTIAL_URL);
            if (!res.ok) throw new Error(`${res.status}`);
            contentEl.innerHTML = await res.text();
            loaded = true;
            await initPvpInteractions();
        } catch (err) {
            contentEl.innerHTML = `<p class="screen-placeholder">투기장 화면을 불러오지 못했어요. (${err.message})</p>`;
            loaded = false;
        } finally {
            loading = false;
        }
    }

    async function initPvpInteractions() {
        setupViewNav();
        setupRefreshButton();
        setupDefenseSave();
        await checkRankChangeNotice();
        await Promise.all([loadMyProfileAndDefense(), loadOpponents()]);
    }

    // ── 뷰 전환 (메인 / 방어 편성 변경 / 대전 이력) ──────────────────────
    function showView(viewId) {
        ["pvp-main-view", "pvp-defense-picker-view", "pvp-history-view"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.hidden = id !== viewId;
        });
    }

    function setupViewNav() {
        document.getElementById("pvp-defense-change-btn")?.addEventListener("click", async () => {
            await openDefensePicker();
        });
        document.getElementById("pvp-defense-back-btn")?.addEventListener("click", () => showView("pvp-main-view"));

        document.getElementById("pvp-history-btn")?.addEventListener("click", async () => {
            await openHistoryView();
        });
        document.getElementById("pvp-history-back-btn")?.addEventListener("click", () => showView("pvp-main-view"));
    }

    // ── 순위 변동 알림 ──────────────────────────
    async function checkRankChangeNotice() {
        try {
            const res = await fetch(`${API_BASE_URL}/pvp/rank-change-notice`, { headers: authHeaders() });
            if (!res.ok) return;
            const notices = await res.json();
            if (notices.length === 0) return;

            const overlay = document.getElementById("pvp-notice-overlay");
            const listEl = document.getElementById("pvp-notice-list");
            listEl.innerHTML = notices.map((n) => {
                const when = formatKst(n.created_at);
                return `<div class="pvp-notice-item">'${n.attacker_nickname}'님에게 순위를 빼앗겼어요. (${when})</div>`;
            }).join("");
            overlay.hidden = false;

            document.getElementById("pvp-notice-ack-btn").onclick = async () => {
                await Promise.all(notices.map((n) =>
                    fetch(`${API_BASE_URL}/pvp/rank-change-notice/${n.id}/ack`, {
                        method: "POST",
                        headers: authHeaders()
                    })
                ));
                overlay.hidden = true;
                await loadOpponents();
            };
        } catch (err) {
            console.error("순위 변동 알림을 불러오지 못했어요.", err);
        }
    }

    // ── 좌측 패널: 내 프로필 + 방어 편성 스탠딩 ──────────────────────
    async function loadMyProfileAndDefense() {
        try {
            const [meRes, defenseRes] = await Promise.all([
                fetch(`${API_BASE_URL}/users/me`, { headers: authHeaders() }),
                fetch(`${API_BASE_URL}/pvp/defense`, { headers: authHeaders() }),
            ]);
            const me = await meRes.json();
            myDefense = await defenseRes.json();

            const avatarEl = document.getElementById("pvp-my-avatar");
            if (me.character_info?.outfit && avatarEl) {
                avatarEl.src = `${OUTFIT_IMAGE_BASE}${me.character_info.outfit}/idle.png`;
                if (typeof applyAvatarCrop === "function") applyAvatarCrop(avatarEl, me.character_info.outfit);
            }
            document.getElementById("pvp-my-nickname").textContent = me.user_info.nickname;

            renderDefenseStanding();
        } catch (err) {
            console.error("내 정보를 불러오지 못했어요.", err);
        }
    }

    // 저장된 방어 편성을 좌측 스탠딩 일러스트로 표시.
    // 전신 그대로가 아니라 상점 의상 카드와 같은 스탠딩 크롭(명치 부근 확대)을 적용한다.
    function renderDefenseStanding() {
        ["front", "back"].forEach((slot) => {
            const unit = myDefense[slot];
            const imgEl = document.getElementById(`defense-${slot}-img`);
            const nameEl = document.getElementById(`defense-${slot}-name`);
            const starEl = document.getElementById(`defense-${slot}-star`);
            const slotEl = imgEl.closest(".defense-standing-slot");

            if (unit) {
                imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.png`;
                imgEl.style.display = "";
                if (typeof applyStandingCrop === "function") applyStandingCrop(imgEl, unit.outfit);
                slotEl.classList.remove("defense-standing-empty");
                nameEl.textContent = unit.name;
                starEl.textContent = `★${unit.star}`;
            } else {
                imgEl.removeAttribute("src");
                imgEl.style.display = "none";
                slotEl.classList.add("defense-standing-empty");
                nameEl.textContent = "미설정";
                starEl.textContent = "";
            }
        });
    }

    // 방어 유닛 하나를 사진+우하단 노란 별 배지로 그린다. 이름은 표시하지 않는다.
    function renderOpponentUnitThumb(unit) {
        if (!unit) {
            return `<div class="opp-unit-thumb opp-unit-empty"></div>`;
        }
        return `
            <div class="opp-unit-thumb">
                <img src="${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.png" data-outfit="${unit.outfit}" alt="">
                <span class="opp-unit-star">★${unit.star}</span>
            </div>
        `;
    }

    // ── 후보 목록 ──────────────────────────────────────────
    function setupRefreshButton() {
        document.getElementById("pvp-refresh-btn")?.addEventListener("click", loadOpponents);
    }

    async function loadOpponents() {
        const listEl = document.getElementById("pvp-opponent-list");
        listEl.innerHTML = `<p class="screen-placeholder">불러오는 중...</p>`;

        try {
            const res = await fetch(`${API_BASE_URL}/pvp/opponents`, { headers: authHeaders() });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `${res.status}`);

            document.getElementById("pvp-my-rank").textContent = data.my_rank;

            if (data.opponents.length === 0) {
                listEl.innerHTML = `<p class="screen-placeholder">지금은 도전할 수 있는 상대가 없어요.</p>`;
                return;
            }

            listEl.innerHTML = "";
            data.opponents.forEach((opp) => {
                const card = document.createElement("div");
                card.className = "pvp-opponent-card";
                card.innerHTML = `
                    <div class="pvp-opponent-avatar-frame">
                        <img class="pvp-opponent-avatar" src="${opp.lobby_outfit ? OUTFIT_IMAGE_BASE + opp.lobby_outfit + '/idle.png' : ''}" data-outfit="${opp.lobby_outfit || ''}" alt="">
                    </div>
                    <div class="pvp-opponent-rank">${opp.pvp_rank}등</div>
                    <div class="pvp-opponent-defense">
                        ${renderOpponentUnitThumb(opp.defense?.back)}
                        ${renderOpponentUnitThumb(opp.defense?.front)}
                    </div>
                    <div class="pvp-opponent-info">
                        <div class="pvp-opponent-name">${opp.nickname}</div>
                        <div class="pvp-opponent-level">Lv. ${opp.level}${opp.rank_changeable ? "" : " · 친선전(순위 변동 없음)"}</div>
                    </div>
                    <button class="pvp-fight-btn">전투</button>
                `;
                if (opp.lobby_outfit && typeof applyAvatarCrop === "function") {
                    applyAvatarCrop(card.querySelector(".pvp-opponent-avatar"), opp.lobby_outfit);
                }
                card.querySelectorAll(".opp-unit-thumb img").forEach((img) => {
                    if (img.dataset.outfit && typeof applyAvatarCrop === "function") {
                        applyAvatarCrop(img, img.dataset.outfit);
                    }
                });
                card.querySelector(".pvp-fight-btn").addEventListener("click", () => startBattle(opp.id));
                listEl.appendChild(card);
            });
        } catch (err) {
            listEl.innerHTML = `<p class="screen-placeholder">후보를 불러오지 못했어요. (${err.message})</p>`;
        }
    }

    // ── 전투 시작 ──────────────────────────────────────────
    async function startBattle(defenderId) {
        // 서버 응답을 기다리는 동안(+ 전투 화면으로 넘어가는 순간까지) 빈 화면이 보이지 않도록
        // 버튼을 누르자마자 바로 암전을 띄운다. 성공하면 페이지 이동으로 자연스럽게 사라지고,
        // 실패하면 다시 감춰서 원래 화면으로 돌아온다.
        const overlay = document.getElementById("pvp-entering-overlay");
        const dotsEl = document.getElementById("pvp-entering-dots");
        if (overlay) overlay.hidden = false;
        let dotCount = 1;
        if (dotsEl) dotsEl.textContent = ".";
        const dotTimer = setInterval(() => {
            dotCount = (dotCount % 3) + 1;
            if (dotsEl) dotsEl.textContent = ".".repeat(dotCount);
        }, 400);

        try {
            const res = await fetch(`${API_BASE_URL}/pvp/battle`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ defender_id: defenderId })
            });
            const data = await res.json();
            if (!res.ok) {
                clearInterval(dotTimer);
                if (overlay) overlay.hidden = true;
                alert(data.detail || "전투에 실패했어요.");
                return;
            }
            sessionStorage.setItem("pvp_battle_result", JSON.stringify(data));
            // 여기서 암전을 다시 걷지 않는다 - 곧바로 페이지 이동이 시작되므로, 이동 순간까지
            // 그대로 덮여있다가 전투 화면 자체의 battle-loading-overlay로 자연스럽게 이어진다.
            window.location.href = "arena-battle.html";
        } catch (err) {
            clearInterval(dotTimer);
            if (overlay) overlay.hidden = true;
            alert("서버에 연결할 수 없어요.");
        }
    }

    // ── 방어 편성 변경 ──────────────────────────────────────────
    // 캐릭터 후보는 /characters/inventory(같은 이름+같은 성급을 한 장으로 묶은 목록)를 쓴다.
    // 그리고 드롭다운을 열 때마다 '지금 저장된 편성'으로 미리 선택해둔다(초기화되지 않게).
    async function openDefensePicker() {
        showView("pvp-defense-picker-view");
        const frontSelect = document.getElementById("pvp-front-select");
        const backSelect = document.getElementById("pvp-back-select");
        frontSelect.innerHTML = `<option>불러오는 중...</option>`;
        backSelect.innerHTML = "";

        try {
            const res = await fetch(`${API_BASE_URL}/characters/inventory`, { headers: authHeaders() });
            const data = await res.json();
            myInventory = data.characters || [];
        } catch (err) {
            frontSelect.innerHTML = `<option>캐릭터를 불러오지 못했어요</option>`;
            return;
        }

        if (myInventory.length === 0) {
            frontSelect.innerHTML = `<option>보유한 캐릭터가 없어요</option>`;
            backSelect.innerHTML = "";
            return;
        }

        const optionsHtml = myInventory
            .map((c) => `<option value="${c.character_id}">${c.name} (${c.rarity} ★${c.star})</option>`)
            .join("");
        frontSelect.innerHTML = optionsHtml;
        backSelect.innerHTML = optionsHtml;

        preselectDefenseOption(frontSelect, myDefense.front);
        preselectDefenseOption(backSelect, myDefense.back);
    }

    // 지금 저장된 캐릭터를 드롭다운에서 미리 선택해둔다. 그 정확한 카드가 목록에 없으면(강화 등으로
    // 대표 카드가 바뀐 경우) 같은 이름의 아무 카드로라도 맞춰준다.
    function preselectDefenseOption(selectEl, savedUnit) {
        if (!savedUnit) {
            if (selectEl.options.length > 1) selectEl.selectedIndex = 1; // 후방 기본값이 전방과 안 겹치게
            return;
        }
        const exact = Array.from(selectEl.options).find((o) => Number(o.value) === savedUnit.id);
        if (exact) {
            selectEl.value = exact.value;
            return;
        }
        const sameNameIndex = myInventory.findIndex((c) => c.name === savedUnit.name);
        if (sameNameIndex >= 0) selectEl.selectedIndex = sameNameIndex;
    }

    function setupDefenseSave() {
        document.getElementById("pvp-defense-save-btn")?.addEventListener("click", async () => {
            const frontId = Number(document.getElementById("pvp-front-select").value);
            const backId = Number(document.getElementById("pvp-back-select").value);

            if (!frontId || !backId) {
                alert("전방/후방 캐릭터를 선택해주세요.");
                return;
            }

            try {
                const res = await fetch(`${API_BASE_URL}/pvp/defense`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...authHeaders() },
                    body: JSON.stringify({ front_character_id: frontId, back_character_id: backId })
                });
                const data = await res.json();
                if (!res.ok) {
                    alert(data.detail || "저장에 실패했어요.");
                    return;
                }
                await loadMyProfileAndDefense(); // 저장된 새 편성을 좌측 스탠딩에 즉시 반영
                showView("pvp-main-view");
            } catch (err) {
                alert("서버에 연결할 수 없어요.");
            }
        });
    }

    // ── 대전 이력 ──────────────────────────────────────────
    async function openHistoryView() {
        showView("pvp-history-view");
        const listEl = document.getElementById("pvp-history-list");
        listEl.innerHTML = `<p class="screen-placeholder">불러오는 중...</p>`;

        try {
            const res = await fetch(`${API_BASE_URL}/pvp/history`, { headers: authHeaders() });
            const logs = await res.json();
            if (logs.length === 0) {
                listEl.innerHTML = `<p class="screen-placeholder">아직 대전 기록이 없어요.</p>`;
                return;
            }
            listEl.innerHTML = logs.map((log) => {
                const when = formatKst(log.created_at);
                const resultClass = log.result === "승리" ? "pvp-history-win" : "pvp-history-lose";
                const roleClass = log.role === "attack" ? "pvp-history-role-attack" : "pvp-history-role-defense";
                const roleLabel = log.role === "attack" ? "공격" : "방어";
                return `
                    <div class="pvp-history-item">
                        <span class="pvp-history-role ${roleClass}">${roleLabel}</span>
                        <span class="pvp-history-opponent">${log.opponent_nickname}</span>
                        <span class="${resultClass}">${log.result}</span>
                        <span class="pvp-history-time">${when}</span>
                    </div>
                `;
            }).join("");
        } catch (err) {
            listEl.innerHTML = `<p class="screen-placeholder">이력을 불러오지 못했어요.</p>`;
        }
    }

    document.querySelectorAll('[data-modal-target="modal-arena"]').forEach((btn) => {
        btn.addEventListener("click", showArenaChoice);
    });

    document.getElementById("arena-choice-pvp")?.addEventListener("click", enterPvp);
})();