// 인력 거래소 화면 로직. home.js는 "modal-trade를 열고 닫는다"만 알고 안의 내용은 신경 안 씀.
(function () {
    const PARTIAL_URL = "trade/trade-partial.html";
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;

    // backend/routers/market.py의 상수들과 동일한 값 - 서버가 최종 판정하지만,
    // 입력하는 즉시 "이 가격은 안 된다"를 보여주기 위한 프론트 쪽 미리보기용 사본.
    const MARKET_PRICE_CAP = 1_000_000;
    const MARKET_FEE_MULTIPLIER = 1.2;
    const MARKET_MIN_FEE = 500;

    function computeDisplayPrice(price) {
        const fee = Math.max(Math.ceil(price * (MARKET_FEE_MULTIPLIER - 1)), MARKET_MIN_FEE);
        return price + fee;
    }

    // 여름/겨울 시즌 의상은 model.webp는 물론 idle.webp조차 아직 없는 경우가 많다(캐릭터당 기본 의상
    // 사진만 먼저 준비되는 경우가 흔함) - 그 상태로 캐릭터가 시즌 의상을 입은 채 등록/보유되면 두
    // 포즈 다 실패해서 완전히 안 보이는 캐릭터가 된다. 마지막 안전망으로 그 캐릭터의 "기본" 의상
    // 사진까지 시도한 뒤에야 포기한다(완전히 다른 옷이지만, 아예 안 보이는 것보다는 낫다).
    function outfitFallbackChain(outfit, poses) {
        const [character] = outfit.split("/");
        const candidates = poses.map((pose) => `${outfit}/${pose}`);
        if (!outfit.endsWith("/basic")) {
            poses.forEach((pose) => candidates.push(`${character}/basic/${pose}`));
        }
        return candidates;
    }

    // imgEl.src를 candidates 순서대로 시도하다가, 전부 실패하면 onAllFailed를 부른다(기본은 숨김).
    function loadImageWithFallback(imgEl, outfit, poses, onAllFailed) {
        const candidates = outfitFallbackChain(outfit, poses);
        let index = 0;
        const tryNext = () => {
            if (index >= candidates.length) {
                imgEl.onerror = null;
                (onAllFailed || (() => { imgEl.style.visibility = "hidden"; }))();
                return;
            }
            imgEl.src = `${OUTFIT_IMAGE_BASE}${candidates[index++]}`;
        };
        imgEl.onerror = tryNext;
        tryNext();
    }

    const modal = document.getElementById("modal-trade");
    const content = document.getElementById("trade-content");
    const openButton = document.querySelector('[data-modal-target="modal-trade"]');

    let loaded = false;
    let loading = false;
    let myUserId = null;
    let mySilver = 0; // 재화 이원화 이후 거래소는 실버로 거래된다(활용처: 강화·거래·상점 아이템 구매)
    let browseListings = []; // /market/의 전체 매물(최대 10개)
    let visibleBrowseListings = []; // 그중 화면에 실제로 보여주는 3개(pickRandomSubset)
    let marketCap = 10; // /market/ 응답의 market_cap(서버 backend/routers/market.py의 MARKET_CAP)
    let registeredToday = 0; // /market/my-listings 응답의 registered_today
    let dailyRegisterLimit = 2; // /market/my-listings 응답의 daily_limit(DAILY_REGISTER_LIMIT)
    let myInventory = []; // /characters/inventory-detailed의 characters 배열(같은 이름+성급 묶음, 성급별로 분리됨)
    let pvpDefenseIds = new Set(); // 지금 전술대회 방어 편성(전방/후방)에 쓰이는 캐릭터 id
    let selectedListing = null; // 거래 탭에서 선택된 매물
    let selectedGroup = null;   // 등록 탭에서 선택된 내 인물 그룹
    let selectedGroupLockedReason = null; // null | "equipped" | "defending" - 선택된 그룹이 등록 불가한 이유
    let pendingConfirmAction = null; // #trade-confirm-overlay의 "확인"을 누르면 실행할 함수(구매/등록 공용)

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

    function stars(n) {
        return "★".repeat(Math.max(0, Math.min(6, Number(n) || 0)));
    }

    function applyCrop(img, outfit) {
        if (typeof applyAvatarCrop === "function") applyAvatarCrop(img, outfit);
        else {
            img.style.objectFit = "cover";
            img.style.objectPosition = "50% 10%";
        }
    }

    // 전체 매물(최대 10개, MARKET_CAP) 중 화면엔 3개만 무작위로 보여준다 - "목록 갱신" 버튼을
    // 누를 때마다(loadBrowse 재호출) 새로 뽑힌다. 배열을 직접 건드리지 않도록 복사본에서 뽑는다.
    function pickRandomSubset(array, count) {
        const pool = [...array];
        const picked = [];
        while (picked.length < count && pool.length > 0) {
            const idx = Math.floor(Math.random() * pool.length);
            picked.push(pool.splice(idx, 1)[0]);
        }
        return picked;
    }

    // 상세 패널 발밑 그림자 폭을 스탠딩 이미지의 실제 렌더 폭(img.clientWidth)에 정확히 맞춘다.
    // object-fit:contain이라도 이 이미지는 명시적 width/height가 없어 브라우저가 원본 비율 그대로
    // max-width/max-height 안에서 크기를 정하므로, clientWidth가 곧 화면에 보이는 캐릭터 폭과 같다.
    function applyStandingShadowWidth(imgEl, shadowEl) {
        if (!imgEl || !shadowEl || !imgEl.clientWidth) return;
        shadowEl.style.width = `${imgEl.clientWidth}px`;
    }

    // 이미지가 로드될 때마다(포즈/캐릭터가 바뀔 때) 다시 재고, 창 크기가 바뀌어도(max-height:40vh라
    // 뷰포트에 따라 크기가 변함) 다시 잰다. 같은 URL을 다시 선택해 onload가 안 뜨는 경우를 대비해
    // 지금 즉시 한 번도 시도해둔다.
    function bindStandingShadow(imgEl, shadowEl) {
        if (!imgEl || !shadowEl) return;
        const apply = () => applyStandingShadowWidth(imgEl, shadowEl);
        imgEl.onload = apply;
        apply();
    }

    async function ensureLoaded() {
        if (loaded || loading || !content) return;
        loading = true;
        try {
            const res = await fetch(PARTIAL_URL, { cache: "no-store" });
            if (!res.ok) throw new Error(`화면 파일 ${res.status}`);
            content.innerHTML = await res.text();
            bindInteractions();
            loaded = true;
            await refreshAll();
        } catch (error) {
            content.innerHTML = `<p class="screen-placeholder">거래소를 불러오지 못했습니다. (${escapeHtml(error.message)})</p>`;
        } finally {
            loading = false;
        }
    }

    // 구매/등록 공용 확인 모달. onConfirm은 "확인"을 눌렀을 때만 실행되고, "취소"나 바깥에서
    // 다시 부르면(다른 액션이 먼저 확인창을 채가는 경우는 없음) 그냥 버려진다.
    function openConfirm(title, desc, onConfirm) {
        document.getElementById("trade-confirm-title").textContent = title;
        document.getElementById("trade-confirm-desc").textContent = desc;
        pendingConfirmAction = onConfirm;
        document.getElementById("trade-confirm-overlay").hidden = false;
    }

    function bindInteractions() {
        document.querySelectorAll(".trade-tab-btn").forEach((btn) => {
            btn.addEventListener("click", () => switchTab(btn.dataset.tradeTab));
        });
        document.getElementById("trade-price-input")?.addEventListener("input", updateRegisterPreview);
        document.getElementById("trade-result-confirm")?.addEventListener("click", () => {
            document.getElementById("trade-result-overlay").hidden = true;
        });

        // "구매"/"등록하기" 둘 다 바로 API를 부르지 않고 확인 모달을 먼저 띄운다 - 실제 요청은
        // 그 모달의 "확인"을 눌러야 진행된다.
        document.getElementById("trade-buy-button")?.addEventListener("click", () => {
            if (!selectedListing) return;
            openConfirm(
                "정말로 구매하시겠습니까?",
                `'${selectedListing.name}'을(를) ${selectedListing.display_price.toLocaleString()}실버에 구매합니다.`,
                buySelected
            );
        });
        document.getElementById("trade-register-button")?.addEventListener("click", () => {
            openConfirm(
                "정말 등록하시겠어요?",
                "등록한 캐릭터는 판매되거나 자정에 초기화되기 전까지 취소할 수 없습니다.",
                registerSelected
            );
        });
        document.getElementById("trade-confirm-cancel")?.addEventListener("click", () => {
            document.getElementById("trade-confirm-overlay").hidden = true;
            pendingConfirmAction = null;
        });
        document.getElementById("trade-confirm-ok")?.addEventListener("click", async () => {
            document.getElementById("trade-confirm-overlay").hidden = true;
            const action = pendingConfirmAction;
            pendingConfirmAction = null;
            if (action) await action();
        });
        document.getElementById("trade-browse-refresh-btn")?.addEventListener("click", loadBrowse);

        // max-height:40vh라 뷰포트 크기에 따라 스탠딩 이미지의 실제 렌더 폭도 바뀐다 - 창 크기가
        // 바뀔 때마다 지금 보이는 쪽(둘 중 하나만 실제로 열려있음) 그림자 폭을 다시 맞춘다.
        window.addEventListener("resize", () => {
            applyStandingShadowWidth(
                document.getElementById("trade-browse-standing"),
                document.getElementById("trade-browse-standing-shadow")
            );
            applyStandingShadowWidth(
                document.getElementById("trade-register-standing"),
                document.getElementById("trade-register-standing-shadow")
            );
        });
    }

    function switchTab(tab) {
        document.querySelectorAll(".trade-tab-btn").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.tradeTab === tab);
        });
        document.getElementById("trade-browse-view").hidden = tab !== "browse";
        document.getElementById("trade-register-view").hidden = tab !== "register";
    }

    async function refreshAll() {
        // loadMyInventory는 pvpDefenseIds를 참고해서 카드를 그리므로, 방어 편성 정보가 반드시
        // 먼저(또는 동시에 기다린 뒤) 갱신돼 있어야 한다 - 그래서 Promise.all로 함께 기다린 뒤
        // 마지막에 인벤토리를 그린다.
        await Promise.all([loadSilver(), loadBrowse(), loadPvpDefense(), loadMyListingCount()]);
        await loadMyInventory();
    }

    async function loadSilver() {
        try {
            const res = await fetch(`${API_BASE_URL}/users/me`, { headers: authHeaders() });
            const data = await res.json();
            mySilver = data.user_info?.silver ?? 0;
            const silverEl = document.getElementById("trade-my-silver");
            if (silverEl) silverEl.textContent = mySilver.toLocaleString();
        } catch (err) {
            console.error("실버 정보를 불러오지 못했어요.", err);
        }
    }

    async function loadBrowse() {
        try {
            const res = await fetch(`${API_BASE_URL}/market/`, { headers: authHeaders() });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "거래소 목록을 불러오지 못했습니다.");
            browseListings = data.listings || [];
            myUserId = data.my_user_id ?? myUserId;
            marketCap = data.market_cap ?? marketCap;
            const marketCountEl = document.getElementById("trade-market-count");
            if (marketCountEl) marketCountEl.textContent = `거래 인물 ${browseListings.length}/${marketCap}`;
            visibleBrowseListings = pickRandomSubset(browseListings, 3);
            renderBrowseGrid();
        } catch (err) {
            console.error("거래소 목록을 불러오지 못했어요.", err);
        }
    }

    async function loadMyInventory() {
        try {
            // 인벤토리 목록용 /characters/inventory는 캐릭터당 가장 높은 성급 한 줄로 접어서 내려준다
            // (인벤토리 화면 전용 요청) - 거래소는 어떤 성급 사본을 팔지 직접 골라야 하므로(강화
            // 화면처럼) 접지 않은 /inventory-detailed를 쓴다(확인된 버그: 접힌 데이터로는 방어
            // 편성에 안 쓰는 낮은 성급 여분이 있어도 그 성급을 골라 등록할 방법이 없었다).
            const res = await fetch(`${API_BASE_URL}/characters/inventory-detailed`, { headers: authHeaders() });
            const data = await res.json();
            myInventory = data.characters || [];
            renderRegisterGrid();
        } catch (err) {
            console.error("보유 인물을 불러오지 못했어요.", err);
        }
    }

    async function loadPvpDefense() {
        try {
            const res = await fetch(`${API_BASE_URL}/pvp/defense`, { headers: authHeaders() });
            const data = await res.json();
            // 서포터 슬롯도 방어 편성에 포함된다(전방/후방과 동일하게 등록 불가 대상이어야 함) -
            // 예전엔 front/back만 넣어서 서포터가 출전 중이어도 "출전 중" 표시 없이 등록 가능했다
            // (확인된 버그).
            pvpDefenseIds = new Set(
                [data.front?.id, data.back?.id, data.supporter?.id].filter((id) => id != null)
            );
        } catch (err) {
            console.error("전술대회 방어 편성 정보를 불러오지 못했어요.", err);
            pvpDefenseIds = new Set();
        }
    }

    async function loadMyListingCount() {
        try {
            const res = await fetch(`${API_BASE_URL}/market/my-listings`, { headers: authHeaders() });
            const data = await res.json();
            registeredToday = data.registered_today ?? 0;
            dailyRegisterLimit = data.daily_limit ?? dailyRegisterLimit;
            const el = document.getElementById("trade-daily-count");
            if (el) el.textContent = `오늘 등록: ${registeredToday} / ${dailyRegisterLimit}`;
        } catch (err) {
            console.error("등록 현황을 불러오지 못했어요.", err);
        }
    }

    // ── 거래(구매) 탭 ──────────────────────────────────────────
    function renderBrowseGrid() {
        const grid = document.getElementById("trade-browse-grid");
        const empty = document.getElementById("trade-browse-empty");
        if (!grid) return;
        grid.innerHTML = "";
        clearBrowseDetail();

        if (browseListings.length === 0) {
            if (empty) empty.hidden = false;
            grid.hidden = true; // height:100%인 채로 비어있으면 빈 안내문이 그 아래로 밀려 안 보인다
            return;
        }
        if (empty) empty.hidden = true;
        grid.hidden = false;

        // 매물 개수(1~3)에 따라 열 구성이 달라진다 - 1개면 가운데에 크게 하나, 2개면 절반씩 같은
        // 크기로, 3개면 기존처럼 중앙이 더 크게. 열 구성은 CSS(.trade-standing-grid-count-N)가
        // 담당하고, 여기선 그 카운트 클래스만 붙인다.
        const count = visibleBrowseListings.length;
        grid.classList.remove(
            "trade-standing-grid-count-1",
            "trade-standing-grid-count-2",
            "trade-standing-grid-count-3"
        );
        grid.classList.add(`trade-standing-grid-count-${count}`);

        // "중앙이 가장 크게"는 정확히 3장일 때만 의미가 있다 - 1개는 어차피 혼자라 기본(가장 큰)
        // 크기 그대로, 2개는 서로 같은 크기여야 하므로 이 구분을 적용하지 않는다.
        const isThreeUp = count === 3;

        visibleBrowseListings.forEach((listing, index) => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "trade-standing-card";
            if (isThreeUp) card.classList.add(index === 1 ? "trade-standing-card-center" : "trade-standing-card-side");
            card.innerHTML = `
                <div class="trade-standing-card-frame">
                    <div class="trade-standing-card-shadow"></div>
                    <img alt="${escapeHtml(listing.name)}" loading="lazy" decoding="async">
                    <div class="trade-standing-card-star">${stars(listing.star)}</div>
                </div>
                <div class="trade-card-name">${escapeHtml(listing.name)}</div>
                <div class="trade-card-meta">${listing.display_price.toLocaleString()}S</div>
            `;
            const img = card.querySelector("img");
            // reading.js가 reading.webp를 쓰는 것과 같은 방식 - "인물 선택" 목록 전용 포즈(model.webp).
            // 아직 그 포즈가 없는 캐릭터는 idle.webp로, 그것도 없으면(시즌 의상 등) 기본 의상으로 대체된다.
            loadImageWithFallback(img, listing.outfit, ["model.webp", "idle.webp"]);
            bindStandingShadow(img, card.querySelector(".trade-standing-card-shadow"));
            card.dataset.listingId = listing.id;
            card.addEventListener("click", () => selectListing(listing));
            grid.appendChild(card);
        });
    }

    function clearBrowseDetail() {
        selectedListing = null;
        const emptyEl = document.getElementById("trade-browse-detail-empty");
        const contentEl = document.getElementById("trade-browse-detail-content");
        if (emptyEl) emptyEl.hidden = false;
        if (contentEl) contentEl.hidden = true;
    }

    function selectListing(listing) {
        selectedListing = listing;
        document.getElementById("trade-browse-grid").querySelectorAll(".trade-standing-card").forEach((el) => {
            el.classList.toggle("trade-standing-card-selected", el.dataset.listingId === String(listing.id));
        });
        document.getElementById("trade-browse-detail-empty").hidden = true;
        document.getElementById("trade-browse-detail-content").hidden = false;

        const standing = document.getElementById("trade-browse-standing");
        standing.style.visibility = "visible";
        loadImageWithFallback(standing, listing.outfit, ["idle.webp"], () => { standing.style.visibility = "hidden"; });
        bindStandingShadow(standing, document.getElementById("trade-browse-standing-shadow"));

        document.getElementById("trade-browse-name").textContent = listing.name;
        document.getElementById("trade-browse-stars").textContent = stars(listing.star);
        document.getElementById("trade-browse-seller").textContent = listing.seller_nickname || "-";
        document.getElementById("trade-buy-price").textContent = listing.display_price.toLocaleString();

        const buyBtn = document.getElementById("trade-buy-button");
        const reasonEl = document.getElementById("trade-buy-blocked-reason");
        const isMine = myUserId != null && listing.seller_id === myUserId;
        if (isMine) {
            buyBtn.disabled = true;
            reasonEl.hidden = false;
            reasonEl.textContent = "자신이 등록한 인물은 구매할 수 없습니다.";
        } else if (mySilver < listing.display_price) {
            buyBtn.disabled = true;
            reasonEl.hidden = false;
            reasonEl.textContent = "실버가 부족합니다.";
        } else {
            buyBtn.disabled = false;
            reasonEl.hidden = true;
        }
    }

    async function buySelected() {
        if (!selectedListing) return;
        const buyBtn = document.getElementById("trade-buy-button");
        buyBtn.disabled = true;
        try {
            const res = await fetch(`${API_BASE_URL}/market/buy`, {
                method: "POST",
                headers: authHeaders(true),
                body: JSON.stringify({ listing_id: selectedListing.id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "구매에 실패했습니다.");

            showResult("구매 완료!", data.message);
            await refreshAll();
            if (typeof loadProfile === "function") await loadProfile();
        } catch (error) {
            alert(error.message);
            buyBtn.disabled = false;
        }
    }

    // ── 등록 탭 ──────────────────────────────────────────
    function renderRegisterGrid() {
        const grid = document.getElementById("trade-register-grid");
        const empty = document.getElementById("trade-register-empty");
        if (!grid) return;
        grid.innerHTML = "";
        clearRegisterDetail();

        if (myInventory.length === 0) {
            if (empty) empty.hidden = false;
            return;
        }
        if (empty) empty.hidden = true;

        myInventory.forEach((group) => {
            // 보유 사본이 1장뿐이고 그게 장착 중이거나 전술대회 방어 편성에 쓰이는 중이면 등록할
            // 수 있는 사본이 아예 없다 - 2장 이상이면 다른 사본으로 등록 가능하므로 그대로 활성화.
            const isOnlyCopy = group.count === 1;
            const isDefending = isOnlyCopy && pvpDefenseIds.has(group.character_id);
            const isEquipped = isOnlyCopy && !isDefending && Boolean(group.is_equipped);
            const isLocked = isDefending || isEquipped;

            const card = document.createElement("button");
            card.type = "button";
            card.className = "trade-character-card" + (isLocked ? " unavailable" : "");
            card.innerHTML = `
                <div class="trade-card-portrait">
                    <img alt="${escapeHtml(group.name)}" loading="lazy" decoding="async">
                    ${isLocked ? `<span class="trade-card-badge">${isDefending ? "출전 중" : "장착 중"}</span>` : ""}
                    ${group.count > 1 ? `<span class="trade-card-count">×${group.count}</span>` : ""}
                    <div class="trade-card-star-overlay">${stars(group.star)}</div>
                </div>
                <div class="trade-card-name">${escapeHtml(group.name)}</div>
                <div class="trade-card-meta">★${group.star} · ${isLocked ? (isDefending ? "출전 중" : "장착 중") : "등록 가능"}</div>
            `;
            const img = card.querySelector("img");
            loadImageWithFallback(img, group.outfit, ["idle.webp"]);
            applyCrop(img, group.outfit);
            // 등록 불가 캐릭터도 선택은 가능하게 둔다(흐린 채로 클릭은 되고, 대신 아래 등록하기
            // 버튼이 비활성화되고 사유가 빨간 글씨로 표시된다).
            card.addEventListener("click", () => selectGroup(group, isLocked ? (isDefending ? "defending" : "equipped") : null));
            grid.appendChild(card);
        });
    }

    function clearRegisterDetail() {
        selectedGroup = null;
        selectedGroupLockedReason = null;
        const emptyEl = document.getElementById("trade-register-detail-empty");
        const contentEl = document.getElementById("trade-register-detail-content");
        if (emptyEl) emptyEl.hidden = false;
        if (contentEl) contentEl.hidden = true;
    }

    function selectGroup(group, lockedReason) {
        selectedGroup = group;
        selectedGroupLockedReason = lockedReason;
        document.getElementById("trade-register-detail-empty").hidden = true;
        document.getElementById("trade-register-detail-content").hidden = false;

        const standing = document.getElementById("trade-register-standing");
        standing.style.visibility = "visible";
        loadImageWithFallback(standing, group.outfit, ["idle.webp"], () => { standing.style.visibility = "hidden"; });
        bindStandingShadow(standing, document.getElementById("trade-register-standing-shadow"));

        document.getElementById("trade-register-name").textContent = group.name;
        document.getElementById("trade-register-stars").textContent = stars(group.star);

        const priceInput = document.getElementById("trade-price-input");
        priceInput.min = 1;
        priceInput.max = MARKET_PRICE_CAP;
        priceInput.value = 1;

        updateRegisterPreview();
    }

    // type="number"라도 소수점 입력 자체는 막아주지 않는다("100.5" 등) - 그대로 보내면 서버가
    // price: int라 거절하면서 FastAPI 기본 검증 에러(문자열이 아니라 배열)를 그대로 던져서 alert에
    // 이상하게 표시된다. 항상 정수로 내림해서 애초에 그런 값이 안 나가게 한다.
    function getEnteredPrice() {
        const raw = Number(document.getElementById("trade-price-input").value);
        return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    }

    // 등록 가능 여부/가격에 관한 안내문을 전부 이 한 자리(#trade-price-hint)에 보여준다 - 평소엔
    // 회색 안내, 문제가 있으면(등록 불가 캐릭터 / 최소가 미만) 그 자리를 빨간 경고 문구로 대체한다.
    function updateRegisterPreview() {
        if (!selectedGroup) return;
        const price = getEnteredPrice();
        const displayPrice = computeDisplayPrice(price);
        document.getElementById("trade-display-price-preview").textContent = displayPrice.toLocaleString();

        const hintEl = document.getElementById("trade-price-hint");
        const btn = document.getElementById("trade-register-button");

        // 캐릭터 자체는 등록 가능해도, 오늘 등록 한도를 다 썼거나 거래소 매물이 가득 찼으면
        // 애초에 등록할 수 없다 - 어떤 캐릭터를 골랐든 적용되는 조건이라 가장 먼저 확인한다.
        if (registeredToday >= dailyRegisterLimit) {
            hintEl.classList.add("is-blocked");
            hintEl.textContent = `오늘은 더 이상 등록할 수 없습니다. (하루 최대 ${dailyRegisterLimit}개)`;
            btn.disabled = true;
            return;
        }

        if (browseListings.length >= marketCap) {
            hintEl.classList.add("is-blocked");
            hintEl.textContent = `지금은 거래소에 매물이 가득 찼습니다. (최대 ${marketCap}개)`;
            btn.disabled = true;
            return;
        }

        if (selectedGroupLockedReason) {
            hintEl.classList.add("is-blocked");
            hintEl.textContent = selectedGroupLockedReason === "defending"
                ? "전술대회 방어 편성에 사용 중이라 등록할 수 없습니다."
                : "장착 중이라 등록할 수 없습니다.";
            btn.disabled = true;
            return;
        }

        if (price < 1) {
            hintEl.classList.add("is-blocked");
            hintEl.textContent = "가격은 1실버 이상이어야 합니다.";
            btn.disabled = true;
        } else if (price > MARKET_PRICE_CAP) {
            hintEl.classList.add("is-blocked");
            hintEl.textContent = `가격은 최대 ${MARKET_PRICE_CAP.toLocaleString()}실버까지 등록할 수 있습니다.`;
            btn.disabled = true;
        } else {
            hintEl.classList.remove("is-blocked");
            hintEl.textContent = `수수료 ${(displayPrice - price).toLocaleString()}실버가 붙어 구매자는 ${displayPrice.toLocaleString()}실버를 지불하게 됩니다.`;
            btn.disabled = false;
        }
    }

    async function registerSelected() {
        if (!selectedGroup || selectedGroupLockedReason) return;
        if (registeredToday >= dailyRegisterLimit || browseListings.length >= marketCap) return;
        const price = getEnteredPrice();
        const btn = document.getElementById("trade-register-button");
        btn.disabled = true;
        try {
            const res = await fetch(`${API_BASE_URL}/market/register`, {
                method: "POST",
                headers: authHeaders(true),
                body: JSON.stringify({ character_name: selectedGroup.name, star: selectedGroup.star, price }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "등록에 실패했습니다.");

            showResult("등록 완료!", data.message);
            await refreshAll();
        } catch (error) {
            alert(error.message);
            btn.disabled = false;
        }
    }

    function showResult(title, desc) {
        document.getElementById("trade-result-title").textContent = title;
        document.getElementById("trade-result-desc").textContent = desc;
        document.getElementById("trade-result-overlay").hidden = false;
    }

    openButton?.addEventListener("click", async () => {
        await ensureLoaded();
        if (loaded) {
            switchTab("browse");
            await refreshAll();
        }
    });
})();
