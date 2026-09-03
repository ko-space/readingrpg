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
    let myDefense = { front: null, back: null, supporter: null }; // /pvp/defense 결과 (지금 저장된 방어 편성)
    let myArenaTicketCount = 0; // /users/me의 arena_ticket_count - 전투 버튼 활성화 여부를 결정

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

    // 대전 이력 목록 전용 - "n분 전"처럼 상대 시간으로 보여준다(참고 시안과 동일). formatKst와 같은
    // 이유로 Z를 붙여 UTC임을 명시한 뒤 Date.now()와의 차이를 구한다(타임존은 상관없음 - 두 시각의
    // 차이는 어느 타임존으로 봐도 동일).
    function formatRelativeTime(isoString) {
        const withZ = /[zZ]$|[+-]\d\d:\d\d$/.test(isoString) ? isoString : `${isoString}Z`;
        const diffSec = Math.floor((Date.now() - new Date(withZ).getTime()) / 1000);
        if (diffSec < 60) return "방금 전";
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}분 전`;
        const diffHour = Math.floor(diffMin / 60);
        if (diffHour < 24) return `${diffHour}시간 전`;
        const diffDay = Math.floor(diffHour / 24);
        return `${diffDay}일 전`;
    }

    // ── 입장 시 'PVE(토벌전) / PVP(전술대회)' 선택 화면부터 보여줌 ──────────────────
    async function showArenaChoice() {
        if (modalBox) modalBox.classList.remove("arena-expanded");
        if (choiceView) choiceView.hidden = false;
        if (contentEl) contentEl.hidden = true;
        const liveContentEl = document.getElementById("live-content");
        if (liveContentEl) liveContentEl.hidden = true;
        showLiveView("live-choice-view"); // 다음에 다시 들어올 때 항상 선택 화면부터 시작
        await updatePvpChoiceAvailability();
    }

    // 전술대회는 스트라이커(전방/후방) 한 명 이상만 보유하면 입장 가능(예전엔 전방/후방 둘 다 필요해서
    // 2명 이상이었지만, 이제 한 명만 등록해도 EMPTY 자리인 채로 출전할 수 있다).
    async function updatePvpChoiceAvailability() {
        const pvpBtn = document.getElementById("arena-choice-pvp");
        if (!pvpBtn) return;

        try {
            const res = await fetch(`${API_BASE_URL}/characters/inventory`, { headers: authHeaders() });
            const data = await res.json();
            const distinctNames = new Set((data.characters || []).map((c) => c.name));

            if (distinctNames.size < 1) {
                pvpBtn.disabled = true;
                pvpBtn.querySelector(".arena-choice-soon")?.remove();
                const notice = document.createElement("span");
                notice.className = "arena-choice-soon";
                notice.textContent = "캐릭터 1명 이상 필요";
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
        // 나갔다가 다시 들어올 때마다 티켓 보유수(상점에서 방금 샀을 수 있음)와 후보 목록을 새로
        // 불러온다(리롤) - 첫 진입은 loadPvpPartial이 이미 초기 로딩 과정에서 한 번 불러오므로
        // 중복 호출하지 않는다. myArenaTicketCount가 먼저 갱신돼야 후보 카드의 전투 버튼
        // 활성화 여부가 맞게 그려진다.
        if (alreadyLoaded) {
            await loadMyProfileAndDefense();
            await loadOpponents();
        }
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
        setupTicketInsufficientOk();
        setupReportModal();
        await checkRankChangeNotice();
        // 후보 카드의 전투 버튼이 티켓 보유수를 보고 활성화 여부를 정하므로, myArenaTicketCount가
        // 먼저 채워진 뒤에 loadOpponents가 카드를 그려야 한다(Promise.all로 동시에 돌리면 순서가 꼬일 수 있음).
        await loadMyProfileAndDefense();
        await loadOpponents();
    }

    function setupTicketInsufficientOk() {
        document.getElementById("pvp-ticket-insufficient-ok-btn")?.addEventListener("click", () => {
            const overlay = document.getElementById("pvp-ticket-insufficient-overlay");
            if (overlay) overlay.hidden = true;
        });
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
                avatarEl.src = `${OUTFIT_IMAGE_BASE}${me.character_info.outfit}/idle.webp`;
                if (typeof applyAvatarCrop === "function") applyAvatarCrop(avatarEl, me.character_info.outfit);
            }
            document.getElementById("pvp-my-nickname").textContent = me.user_info.nickname;
            myArenaTicketCount = me.user_info.arena_ticket_count ?? 0;
            const ticketValueEl = document.getElementById("pvp-ticket-value");
            if (ticketValueEl) ticketValueEl.textContent = myArenaTicketCount;

            renderDefenseStanding();
        } catch (err) {
            console.error("내 정보를 불러오지 못했어요.", err);
        }
    }

    // 저장된 방어 편성을 좌측 스탠딩 일러스트로 표시.
    // 전신 그대로가 아니라 상점 의상 카드와 같은 스탠딩 크롭(명치 부근 확대)을 적용한다.
    function renderDefenseStanding() {
        ["front", "back", "supporter"].forEach((slot) => {
            const unit = myDefense[slot];
            const imgEl = document.getElementById(`defense-${slot}-img`);
            const nameEl = document.getElementById(`defense-${slot}-name`);
            const starEl = document.getElementById(`defense-${slot}-star`);
            const slotEl = imgEl.closest(".defense-standing-slot");

            if (unit) {
                imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.webp`;
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
    // extraClass: 서포터 칸을 전방/후방과 살짝 떨어뜨리는 등, 슬롯별 위치 보정용 수식 클래스(선택).
    function renderOpponentUnitThumb(unit, extraClass = "") {
        const cls = extraClass ? ` ${extraClass}` : "";
        if (!unit) {
            return `<div class="opp-unit-thumb opp-unit-empty${cls}"></div>`;
        }
        return `
            <div class="opp-unit-thumb${cls}">
                <img src="${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.webp" data-outfit="${unit.outfit}" alt="">
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
                const friendlyText = opp.rank_changeable ? "" : "친선전 · 순위 변동 없음";
                card.innerHTML = `
                    <div class="opponent-main-row">
                        <div class="pvp-opponent-avatar-frame">
                            <img class="pvp-opponent-avatar" src="${opp.lobby_outfit ? OUTFIT_IMAGE_BASE + opp.lobby_outfit + '/idle.webp' : ''}" data-outfit="${opp.lobby_outfit || ''}" alt="">
                        </div>
                        <div class="pvp-opponent-rank">${opp.pvp_rank}등</div>
                        <div class="formation-preview">
                            <div class="formation-line"></div>
                            <div class="pvp-opponent-defense">
                                ${renderOpponentUnitThumb(opp.defense?.front)}
                                ${renderOpponentUnitThumb(opp.defense?.back)}
                                ${renderOpponentUnitThumb(opp.defense?.supporter, "opp-unit-thumb-supporter")}
                            </div>
                            <div class="formation-line"></div>
                        </div>
                        <button class="pvp-fight-btn" type="button" ${myArenaTicketCount <= 0 ? `disabled title="투기장모드 티켓이 부족합니다"` : ""}>전투</button>
                    </div>
                    <div class="opponent-meta-row">
                        <span class="pvp-opponent-level">Lv.${opp.level}</span>
                        <span class="pvp-opponent-name">${opp.nickname}</span>
                        ${friendlyText ? `<span class="friendly-label">${friendlyText}</span>` : ""}
                    </div>
                `;
                if (opp.lobby_outfit && typeof applyAvatarCrop === "function") {
                    applyAvatarCrop(card.querySelector(".pvp-opponent-avatar"), opp.lobby_outfit);
                }
                card.querySelectorAll(".opp-unit-thumb img").forEach((img) => {
                    if (img.dataset.outfit && typeof applyAvatarCrop === "function") {
                        applyAvatarCrop(img, img.dataset.outfit);
                    }
                });
                card.querySelector(".pvp-fight-btn").addEventListener("click", (event) => startBattle(opp.id, event.currentTarget));
                listEl.appendChild(card);
            });
        } catch (err) {
            listEl.innerHTML = `<p class="screen-placeholder">후보를 불러오지 못했어요. (${err.message})</p>`;
        }
    }

    // ── 전투 시작 ──────────────────────────────────────────
    async function startBattle(defenderId, button) {
        // 서버 응답을 기다리는 동안(+ 전투 화면으로 넘어가는 순간까지) 빈 화면이 보이지 않도록
        // 버튼을 누르자마자 바로 공용 입장 오버레이(shared/home.js)를 띄운다. 성공하면 페이지 이동으로
        // 자연스럽게 사라지고, 실패하면 다시 감춰서 원래 화면으로 돌아온다.
        if (typeof showLobbyEnteringOverlay === "function") showLobbyEnteringOverlay();

        try {
            const res = await fetch(`${API_BASE_URL}/pvp/battle`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ defender_id: defenderId })
            });
            const data = await res.json();
            if (!res.ok) {
                if (typeof hideLobbyEnteringOverlay === "function") hideLobbyEnteringOverlay();
                if (typeof data.detail === "string" && data.detail.includes("티켓")) {
                    const overlay = document.getElementById("pvp-ticket-insufficient-overlay");
                    if (overlay) {
                        overlay.hidden = false;
                        return;
                    }
                }
                alert(data.detail || "전투에 실패했어요.");
                return;
            }
            sessionStorage.setItem("pvp_battle_result", JSON.stringify(data));
            // 여기서 오버레이를 다시 걷지 않는다 - 곧바로 페이지 이동이 시작되므로, 이동 순간까지
            // 그대로 덮여있다가 전투 화면 자체의 battle-loading-overlay로 자연스럽게 이어진다.
            window.location.href = "arena-battle.html";
        } catch (err) {
            if (typeof hideLobbyEnteringOverlay === "function") hideLobbyEnteringOverlay();
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
        const supporterSelect = document.getElementById("pvp-supporter-select");
        frontSelect.innerHTML = `<option>불러오는 중...</option>`;
        backSelect.innerHTML = "";
        supporterSelect.innerHTML = "";

        try {
            const res = await fetch(`${API_BASE_URL}/characters/inventory`, { headers: authHeaders() });
            const data = await res.json();
            myInventory = data.characters || [];
        } catch (err) {
            frontSelect.innerHTML = `<option>캐릭터를 불러오지 못했어요</option>`;
            return;
        }

        const emptyOptionHtml = `<option value="">없음</option>`;

        if (myInventory.length === 0) {
            frontSelect.innerHTML = `<option>보유한 캐릭터가 없어요</option>`;
            backSelect.innerHTML = "";
            supporterSelect.innerHTML = emptyOptionHtml;
            return;
        }

        // 전방/후방은 최소 한 명만 있으면 되므로 "없음"을 선택할 수 있게 맨 앞에 넣어둔다.
        // 서포터는 기본공격 없이 스킬만 쓰는 역할이라 전방/후방(기본공격 슬롯)에는 배치할 수 없다 -
        // striker(또는 unit_role 미지정 - 기존 캐릭터 전원 기본값)만 후보로 남긴다.
        const strikerOptionsHtml = myInventory
            .filter((c) => c.unit_role !== "supporter")
            .map((c) => `<option value="${c.character_id}">${c.name} (${c.rarity} ★${c.star})</option>`)
            .join("");
        frontSelect.innerHTML = emptyOptionHtml + strikerOptionsHtml;
        backSelect.innerHTML = emptyOptionHtml + strikerOptionsHtml;
        // 조력자 칸에는 unit_role이 "supporter"인 캐릭터만 배치할 수 있다 - 지금 도감 전원이
        // "striker"라 실제로는 항상 "없음"만 뜨지만, 서포터 캐릭터가 추가되면 자동으로 채워진다.
        const supporterOptionsHtml = myInventory
            .filter((c) => c.unit_role === "supporter")
            .map((c) => `<option value="${c.character_id}">${c.name} (${c.rarity} ★${c.star})</option>`)
            .join("");
        supporterSelect.innerHTML = emptyOptionHtml + supporterOptionsHtml;

        preselectDefenseOption(frontSelect, myDefense.front);
        preselectDefenseOption(backSelect, myDefense.back);
        preselectDefenseOption(supporterSelect, myDefense.supporter);
    }

    // 지금 저장된 캐릭터를 드롭다운에서 미리 선택해둔다. 그 정확한 카드가 목록에 없으면(강화 등으로
    // 대표 카드가 바뀐 경우) 같은 이름의 아무 카드로라도 맞춰준다. 저장된 게 없으면(그 슬롯을 비워둔
    // 상태) "없음"을 선택해둔다.
    function preselectDefenseOption(selectEl, savedUnit) {
        if (!savedUnit) {
            selectEl.value = "";
            return;
        }
        const options = Array.from(selectEl.options);
        const exact = options.find((o) => Number(o.value) === savedUnit.id);
        if (exact) {
            selectEl.value = exact.value;
            return;
        }
        // 이 select 자신의 옵션 목록(전체 myInventory가 아니라, 조력자처럼 역할로 걸러진 부분집합일
        // 수도 있음) 안에서 같은 이름의 다른 사본을 찾는다.
        const sameName = options.find((o) => {
            const c = myInventory.find((item) => String(item.character_id) === o.value);
            return c && c.name === savedUnit.name;
        });
        if (sameName) selectEl.value = sameName.value;
    }

    function setupDefenseSave() {
        document.getElementById("pvp-defense-save-btn")?.addEventListener("click", async () => {
            const frontId = Number(document.getElementById("pvp-front-select").value) || null;
            const backId = Number(document.getElementById("pvp-back-select").value) || null;
            const supporterId = Number(document.getElementById("pvp-supporter-select").value) || null;

            if (!frontId && !backId) {
                alert("전방 또는 후방 중 최소 한 명은 선택해주세요.");
                return;
            }

            try {
                const res = await fetch(`${API_BASE_URL}/pvp/defense`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...authHeaders() },
                    body: JSON.stringify({
                        front_character_id: frontId,
                        back_character_id: backId,
                        supporter_character_id: supporterId,
                    })
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
    // 참고 시안처럼 한 행에 [결과/시간/공수 아이콘/상대 아이콘/레벨+닉네임+칭호/리포트 버튼]을
    // 압축해서 보여준다(확인된 요청 - 예전엔 텍스트만 넓게 늘어놓은 한 줄이었음).
    function resultClassFor(result) {
        return result === "승리" ? "pvp-history-win" : result === "무승부" ? "pvp-history-draw" : "pvp-history-lose";
    }

    // 칭호 배지 - 히든 업적 칭호면 배지 배경을 어둡게 깔고, 안쪽 텍스트에 이미 있는 title-hidden-shine
    // (금색 그라디언트 반짝임, achievement-toast.css/home.js와 동일한 효과 재사용)을 입힌다(확인된 요청).
    function renderTitleBadge(title, isHidden, pillClass) {
        const cls = isHidden ? `${pillClass} ${pillClass}-hidden` : pillClass;
        const inner = isHidden ? `<span class="title-hidden-shine">${title || ""}</span>` : (title || "");
        return `<span class="${cls}">${inner}</span>`;
    }

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
                const when = formatRelativeTime(log.created_at);
                const roleClass = log.role === "attack" ? "pvp-history-role-attack" : "pvp-history-role-defense";
                const roleIcon = log.role === "attack" ? "assets/icons/attack.webp" : "assets/icons/defense.webp";
                const roleLabel = log.role === "attack" ? "공격" : "방어";
                const iconSrc = log.opponent_outfit ? `${OUTFIT_IMAGE_BASE}${log.opponent_outfit}/idle.webp` : "";
                return `
                    <div class="pvp-history-item">
                        <span class="pvp-history-result-col">
                            <span class="pvp-history-result ${resultClassFor(log.result)}">${log.result === "승리" ? "Win" : log.result === "무승부" ? "Draw" : "Lose"}</span>
                            <span class="pvp-history-time">${when}</span>
                        </span>
                        <span class="pvp-history-divider"></span>
                        <span class="pvp-history-role ${roleClass}">
                            <img class="pvp-history-role-icon" src="${roleIcon}" alt="">
                            <span class="pvp-history-role-label">${roleLabel}</span>
                        </span>
                        <span class="pvp-history-divider"></span>
                        <span class="pvp-history-char-icon-frame">
                            <img class="pvp-history-char-icon" src="${iconSrc}" data-outfit="${log.opponent_outfit || ""}" alt="" onerror="this.style.visibility='hidden'">
                        </span>
                        <span class="pvp-history-player">
                            <span class="pvp-history-player-name">Lv.${log.opponent_level ?? "-"} ${log.opponent_nickname}</span>
                            ${renderTitleBadge(log.opponent_title, log.opponent_title_hidden, "pvp-history-player-title")}
                        </span>
                        <button class="pvp-history-report-btn" type="button" data-log-id="${log.id}">리포트</button>
                    </div>
                `;
            }).join("");

            listEl.querySelectorAll(".pvp-history-char-icon").forEach((img) => {
                if (img.dataset.outfit && typeof applyAvatarCrop === "function") {
                    applyAvatarCrop(img, img.dataset.outfit);
                }
            });
        } catch (err) {
            listEl.innerHTML = `<p class="screen-placeholder">이력을 불러오지 못했어요.</p>`;
        }
    }

    // ── 전투 리포트: 인물별 대미지 막대그래프 (me는 항상 왼쪽 고정, 확인된 요청) ──
    function setupReportModal() {
        const overlay = document.getElementById("pvp-report-overlay");
        if (!overlay) return;

        document.getElementById("pvp-history-list")?.addEventListener("click", (event) => {
            const btn = event.target.closest(".pvp-history-report-btn");
            if (!btn) return;
            openReportModal(btn.dataset.logId);
        });

        document.getElementById("pvp-report-close-btn")?.addEventListener("click", closeReportModal);
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) closeReportModal();
        });
    }

    function closeReportModal() {
        const overlay = document.getElementById("pvp-report-overlay");
        if (overlay) overlay.hidden = true;
    }

    async function openReportModal(logId) {
        const overlay = document.getElementById("pvp-report-overlay");
        const bodyEl = document.getElementById("pvp-report-body");
        if (!overlay || !bodyEl) return;

        bodyEl.innerHTML = `<p class="screen-placeholder">불러오는 중...</p>`;
        overlay.hidden = false;

        try {
            const res = await fetch(`${API_BASE_URL}/pvp/history/${logId}`, { headers: authHeaders() });
            const data = await res.json();
            if (!res.ok) {
                bodyEl.innerHTML = `<p class="screen-placeholder">${data.detail || "리포트를 불러오지 못했어요."}</p>`;
                return;
            }
            bodyEl.innerHTML = renderReportBody(data);
            bodyEl.querySelectorAll(".pvp-report-unit-icon, .pvp-report-side-avatar").forEach((img) => {
                if (img.dataset.outfit && typeof applyAvatarCrop === "function") {
                    applyAvatarCrop(img, img.dataset.outfit);
                }
            });
        } catch (err) {
            bodyEl.innerHTML = `<p class="screen-placeholder">서버에 연결할 수 없어요.</p>`;
        }
    }

    // 슬롯은 항상 전방→후방→조력자 순서로 그린다(확인된 요청) - 백엔드(/pvp/history/{id})도 이미 이
    // 순서로 units 배열을 만들어 내려주므로, 여기서는 그 순서를 그대로 따르기만 하면 된다(재정렬 금지).
    // 참고 시안과 거의 동일하게: [공수 아이콘/Win-Lose 로고/정사각형 프로필/레벨+닉네임+칭호] 헤더 →
    // 구분선 → 인물별 막대그래프(대미지 숫자는 막대 "꼭대기"에 붙어서 막대 높이를 그대로 따라간다) →
    // 두 컬럼 사이에 VS 배지(확인된 요청).
    function renderReportBody(data) {
        const allUnits = [...data.me.units, ...data.opponent.units];
        const maxDamage = Math.max(1, ...allUnits.map((u) => u.damage || 0));
        const meIsWin = data.result === "승리";
        const meResultClass = resultClassFor(data.result);
        const oppResultClass = meIsWin ? "pvp-history-lose" : data.result === "무승부" ? "pvp-history-draw" : "pvp-history-win";
        const meResultLabel = data.result === "승리" ? "Win" : data.result === "무승부" ? "Draw" : "Lose";
        const oppResultLabel = meIsWin ? "Lose" : data.result === "무승부" ? "Draw" : "Win";
        const meRole = data.role; // "attack" | "defense" - 요청한 사용자(me) 본인의 역할
        const oppRole = meRole === "attack" ? "defense" : "attack";

        const renderUnit = (unit) => {
            const barClass = unit.unit_role === "supporter" ? "pvp-report-unit-bar-supporter" : "pvp-report-unit-bar-striker";
            const heightPercent = Math.max(4, Math.round(((unit.damage || 0) / maxDamage) * 100));
            const iconSrc = unit.outfit ? `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.webp` : "";
            return `
                <div class="pvp-report-unit">
                    <div class="pvp-report-unit-bar-track">
                        <div class="pvp-report-unit-bar ${barClass}" style="height:${heightPercent}%">
                            <span class="pvp-report-unit-value">${(unit.damage || 0).toLocaleString()}</span>
                        </div>
                    </div>
                    <span class="pvp-report-unit-icon-frame">
                        <img class="pvp-report-unit-icon" src="${iconSrc}" data-outfit="${unit.outfit || ""}" alt="" onerror="this.style.visibility='hidden'">
                    </span>
                    <span class="pvp-report-unit-name">${unit.name}</span>
                </div>
            `;
        };

        const renderSide = (side, sideClass, resultClass, resultLabel, role) => {
            const roleIconSrc = role === "attack" ? "assets/icons/attack.webp" : "assets/icons/defense.webp";
            const roleIconClass = role === "attack" ? "pvp-history-role-attack" : "pvp-history-role-defense";
            const avatarSrc = side.outfit ? `${OUTFIT_IMAGE_BASE}${side.outfit}/idle.webp` : "";
            return `
                <div class="pvp-report-side ${sideClass}">
                    <div class="pvp-report-side-header">
                        <img class="pvp-report-side-role-icon ${roleIconClass}" src="${roleIconSrc}" alt="">
                        <span class="pvp-report-side-badge ${resultClass}">${resultLabel}</span>
                        <span class="pvp-report-side-avatar-frame">
                            <img class="pvp-report-side-avatar" src="${avatarSrc}" data-outfit="${side.outfit || ""}" alt="" onerror="this.style.visibility='hidden'">
                        </span>
                        <div class="pvp-report-side-info">
                            <div class="pvp-report-side-name">Lv.${side.level ?? "-"} ${side.nickname}</div>
                            ${renderTitleBadge(side.title, side.title_hidden, "pvp-report-side-title")}
                        </div>
                    </div>
                    <div class="pvp-report-side-divider"></div>
                    <div class="pvp-report-bars">${side.units.map(renderUnit).join("")}</div>
                </div>
            `;
        };

        return `
            <div class="pvp-report-sides">
                ${renderSide(data.me, "pvp-report-side-me", meResultClass, meResultLabel, meRole)}
                <span class="pvp-report-vs">VS</span>
                ${renderSide(data.opponent, "pvp-report-side-opponent", oppResultClass, oppResultLabel, oppRole)}
            </div>
        `;
    }

    // ── 1:1 친선전(실시간) - 방 만들기/입장하기 ──────────────────────
    // 실제 대전 화면(arena-live.html)에서 웹소켓/Realtime 연결과 "상대 기다리는 중" 진행 상황을
    // 전부 처리하므로, 여기서는 방 코드 발급/입장 요청만 하고 sessionStorage로 역할(role)과
    // room_code를 넘겨준 뒤 이동한다(pvp_battle_result와 동일한 패턴).
    function showLiveChoice() {
        if (choiceView) choiceView.hidden = true;
        const liveContentEl = document.getElementById("live-content");
        if (liveContentEl) liveContentEl.hidden = false;
        showLiveView("live-choice-view");
    }

    function showLiveView(viewId) {
        ["live-choice-view", "live-host-view", "live-join-view"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.hidden = id !== viewId;
        });
    }

    function backToArenaChoice() {
        const liveContentEl = document.getElementById("live-content");
        if (liveContentEl) liveContentEl.hidden = true;
        if (choiceView) choiceView.hidden = false;
    }

    async function hostLiveRoom() {
        const errorEl = document.getElementById("live-host-error");
        const statusEl = document.getElementById("live-host-status");
        const codeEl = document.getElementById("live-room-code-display");
        errorEl.hidden = true;
        codeEl.textContent = "------";
        statusEl.textContent = "방을 만드는 중...";
        showLiveView("live-host-view");

        try {
            const res = await fetch(`${API_BASE_URL}/pvp_live/rooms`, { method: "POST", headers: authHeaders() });
            const data = await res.json();
            if (!res.ok) {
                statusEl.textContent = "";
                errorEl.textContent = data.detail || "방을 만들지 못했어요.";
                errorEl.hidden = false;
                return;
            }
            codeEl.textContent = data.room_code;
            statusEl.textContent = "대전 화면으로 이동합니다...";
            // my_roster/my_profile을 함께 저장해서, arena-live.js가 match_found를 기다리지 않고
            // 페이지가 뜨자마자 바로 내 로스터/프로필을 그릴 수 있게 한다(확인된 요청).
            sessionStorage.setItem("pvp_live_room", JSON.stringify({
                role: "host", room_code: data.room_code, my_roster: data.my_roster, my_profile: data.my_profile,
            }));
            if (typeof showLobbyEnteringOverlay === "function") showLobbyEnteringOverlay();
            // 방금 발급된 코드를 잠깐이라도 눈으로 확인/복사할 시간을 준 뒤 이동한다(어차피
            // arena-live.html 첫 화면에서도 같은 코드를 계속 보여준다).
            setTimeout(() => { window.location.href = "arena-live.html"; }, 1200);
        } catch (err) {
            statusEl.textContent = "";
            errorEl.textContent = "서버에 연결할 수 없어요.";
            errorEl.hidden = false;
        }
    }

    function openLiveJoinView() {
        document.getElementById("live-join-error").hidden = true;
        const input = document.getElementById("live-code-input");
        if (input) input.value = "";
        showLiveView("live-join-view");
        input?.focus();
    }

    // 실제 입장 API(POST /pvp_live/rooms/{code}/join) 호출은 여기서 하지 않는다 - 그 요청 자체가
    // 서버 안에서 guest_ready 재전송(최대 1.2초)을 끝낸 뒤에야 응답하는데, 그동안 호스트가 이미
    // match_found를 브로드캐스트해버릴 수 있다. 이 페이지(홈 화면 모달)의 게스트 브라우저는 아직
    // Realtime 채널을 구독하기 전이라 그 브로드캐스트를 그대로 놓친다(확인된 경합) - 그래서 형식
    // 검증만 여기서 하고, 실제 join 호출은 arena-live.js가 채널 구독을 먼저 끝낸 뒤에 하도록 미룬다.
    function submitJoinLiveRoom() {
        const input = document.getElementById("live-code-input");
        const errorEl = document.getElementById("live-join-error");
        const code = (input?.value || "").trim();
        errorEl.hidden = true;

        if (!/^\d{6}$/.test(code)) {
            errorEl.textContent = "6자리 숫자 코드를 입력해주세요.";
            errorEl.hidden = false;
            return;
        }

        sessionStorage.setItem("pvp_live_room", JSON.stringify({ role: "guest", room_code: code }));
        if (typeof showLobbyEnteringOverlay === "function") showLobbyEnteringOverlay();
        window.location.href = "arena-live.html";
    }

    document.querySelectorAll('[data-modal-target="modal-arena"]').forEach((btn) => {
        btn.addEventListener("click", showArenaChoice);
    });

    document.getElementById("arena-choice-pvp")?.addEventListener("click", enterPvp);

    document.getElementById("arena-choice-live")?.addEventListener("click", showLiveChoice);
    document.getElementById("live-choice-back-btn")?.addEventListener("click", backToArenaChoice);
    document.getElementById("live-choice-host")?.addEventListener("click", hostLiveRoom);
    document.getElementById("live-host-cancel-btn")?.addEventListener("click", () => showLiveView("live-choice-view"));
    document.getElementById("live-choice-join")?.addEventListener("click", openLiveJoinView);
    document.getElementById("live-join-back-btn")?.addEventListener("click", () => showLiveView("live-choice-view"));
    document.getElementById("live-join-submit-btn")?.addEventListener("click", submitJoinLiveRoom);
    document.getElementById("live-code-input")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitJoinLiveRoom();
    });
    document.getElementById("live-code-input")?.addEventListener("input", (e) => {
        e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    });
})();