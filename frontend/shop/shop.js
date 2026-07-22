// 상점 화면 로직. home.js는 "modal-shop을 열고 닫는다"만 알고 안의 내용은 신경 안 씀.
(function () {
    const PARTIAL_URL = "shop/shop-partial.html";
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;

    const OUTCOME_LABELS = { success: "성공", maintain: "유지", destroy: "파괴" };

    const modal = document.getElementById("modal-shop");
    const content = document.getElementById("shop-content");
    const openButton = document.querySelector('[data-modal-target="modal-shop"]');

    let loaded = false;
    let loading = false;
    let allItems = [];
    let myItemQuantities = {}; // item_id -> quantity
    let myGold = 0;
    let myCharacterNames = new Set();
    let selectedItem = null;
    let selectedQty = 1;

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

    function itemImageSrc(item) {
        if (item.item_type === "enhancement" || item.item_type === "currency") return item.icon_file || "";
        return item.outfit_file ? `${OUTFIT_IMAGE_BASE}${item.outfit_file}/idle.png` : "";
    }

    // 강화 아이템의 effect_type/effect_params(데이터)를 사람이 읽을 문장으로 바꾼다. (재화 아이템은 effect_type이 없어 자연히 빈 문자열)
    function describeEffect(item) {
        if (!item.effect_type) return "";
        const p = item.effect_params || {};

        if (item.effect_type === "shift") {
            return `강화 시 ${OUTCOME_LABELS[p.from] || p.from} 확률 ${p.amount}%p를 ${OUTCOME_LABELS[p.to] || p.to} 확률로 옮깁니다.`;
        }
        if (item.effect_type === "redistribute") {
            const ratioText = Object.entries(p.ratio || {})
                .map(([key, weight]) => `${OUTCOME_LABELS[key] || key} ${weight}`)
                .join(" : ");
            return `강화 시 ${OUTCOME_LABELS[p.remove] || p.remove} 확률을 없애고, 남은 확률을 ${ratioText} 비율로 재분배합니다.`;
        }
        if (item.effect_type === "force") {
            const base = `강화 결과를 반드시 ${OUTCOME_LABELS[p.outcome] || p.outcome}으로 만듭니다.`;
            return p.outcome === "destroy" ? `${base} 인물 1장으로 강화가 가능합니다.` : base;
        }
        return "";
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
                `<p class="screen-placeholder">상점을 불러오지 못했습니다. (${escapeHtml(error.message)})</p>`;
        } finally {
            loading = false;
        }
    }

    async function refreshData() {
        const [itemsRes, myItemsRes, meRes, invRes] = await Promise.all([
            fetch(`${API_BASE_URL}/shop/items`, { headers: authHeaders() }),
            fetch(`${API_BASE_URL}/shop/my-items`, { headers: authHeaders() }),
            fetch(`${API_BASE_URL}/users/me`, { headers: authHeaders() }),
            fetch(`${API_BASE_URL}/characters/inventory`, { headers: authHeaders() }),
        ]);

        allItems = itemsRes.ok ? await itemsRes.json() : [];
        const myItems = myItemsRes.ok ? await myItemsRes.json() : [];
        myItemQuantities = {};
        myItems.forEach((row) => { myItemQuantities[row.item_id] = row.quantity; });

        if (meRes.ok) {
            const me = await meRes.json();
            myGold = Number(me.user_info.gold) || 0;
            const goldEl = document.getElementById("shop-my-gold");
            if (goldEl) goldEl.textContent = myGold.toLocaleString();
        }

        if (invRes.ok) {
            const inv = await invRes.json();
            myCharacterNames = new Set((inv.characters || []).map((c) => c.name));
        }

        renderOutfitRow();
        renderItemRow();
        renderCurrencyRow();

        // 확인 팝업이 이미 열려 있는 채로 refreshData가 다시 불릴 수도 있으니(구매 직후 등),
        // 열려 있으면 최신 조건으로 버튼 상태도 같이 갱신한다.
        if (selectedItem) updateBuyAvailability();
    }

    function bindInteractions() {
        document.querySelectorAll(".shop-index-btn").forEach((btn) => {
            btn.addEventListener("click", () => scrollToSection(btn));
        });

        document.getElementById("shop-confirm-close-x")?.addEventListener("click", closeConfirm);
        document.getElementById("shop-confirm-overlay")?.addEventListener("click", (event) => {
            if (event.target.id === "shop-confirm-overlay") closeConfirm();
        });

        document.getElementById("shop-qty-minus")?.addEventListener("click", () => {
            if (selectedQty > 1) {
                selectedQty -= 1;
                updateQtyDisplay();
            }
        });
        document.getElementById("shop-qty-plus")?.addEventListener("click", () => {
            selectedQty += 1;
            updateQtyDisplay();
        });

        document.getElementById("shop-confirm-buy")?.addEventListener("click", purchaseSelected);

        document.getElementById("shop-result-confirm")?.addEventListener("click", closeResult);
        document.getElementById("shop-result-overlay")?.addEventListener("click", (event) => {
            if (event.target.id === "shop-result-overlay") closeResult();
        });
    }

    function scrollToSection(btn) {
        const targetEl = document.getElementById(btn.dataset.section);
        const scrollOuter = document.getElementById("shop-scroll-outer");
        if (targetEl && scrollOuter) {
            scrollOuter.scrollTo({ left: targetEl.offsetLeft, behavior: "smooth" });
        }
        document.querySelectorAll(".shop-index-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
    }

    // ── 의상: 세로로 긴 카드(스탠딩 이미지). 지금은 한정판매 슬롯이 비어있으면 안내 문구만 ──
    function renderOutfitRow() {
        const row = document.getElementById("shop-outfit-row");
        if (!row) return;

        const outfitItems = allItems.filter((item) => (item.item_type || "outfit") === "outfit");

        if (outfitItems.length === 0) {
            row.innerHTML = `<p class="shop-empty-inline">아직은 판매중인 의상이 없습니다.</p>`;
            return;
        }

        row.innerHTML = "";
        outfitItems.forEach((item, index) => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "shop-outfit-card";
            card.style.animationDelay = `${index * 45}ms`;
            card.innerHTML = `
                <div class="shop-outfit-portrait">
                    <img alt="${escapeHtml(item.name)}">
                </div>
                <div class="shop-outfit-name">${escapeHtml(item.name)}</div>
                <div class="shop-outfit-price">${Number(item.price).toLocaleString()}G</div>
            `;
            const img = card.querySelector("img");
            img.src = itemImageSrc(item);
            img.onerror = () => { img.style.visibility = "hidden"; };
            // 스탠딩 일러스트는 전신 그대로가 아니라 명치 부근을 중심으로 확대해서 보여준다.
            if (typeof applyStandingCrop === "function") applyStandingCrop(img, item.outfit_file);
            card.addEventListener("click", () => openConfirm(item));
            row.appendChild(card);
        });
    }

    // ── 아이템: 작은 정사각형 카드 ──
    function renderItemRow() {
        const row = document.getElementById("shop-item-row");
        if (!row) return;

        const items = allItems.filter((item) => item.item_type === "enhancement");

        if (items.length === 0) {
            row.innerHTML = `<p class="shop-empty-inline">판매 중인 아이템이 없습니다.</p>`;
            return;
        }

        row.innerHTML = "";
        items.forEach((item, index) => {
            const owned = myItemQuantities[item.id] || 0;
            const card = document.createElement("button");
            card.type = "button";
            card.className = "shop-item-card-sq";
            card.style.animationDelay = `${index * 35}ms`;
            card.innerHTML = `
                <div class="shop-item-sq-portrait">
                    <img alt="${escapeHtml(item.name)}">
                    ${owned > 0 ? `<span class="shop-card-owned">${owned}</span>` : ""}
                </div>
                <div class="shop-item-sq-price">${Number(item.price).toLocaleString()}G</div>
            `;
            const img = card.querySelector("img");
            img.src = itemImageSrc(item);
            img.onerror = () => { img.style.visibility = "hidden"; };
            card.addEventListener("click", () => openConfirm(item));
            row.appendChild(card);
        });
    }

    // ── 재화: 아이템 탭과 같은 정사각형 카드 레이아웃 재사용 ──
    function renderCurrencyRow() {
        const row = document.getElementById("shop-currency-row");
        if (!row) return;

        const items = allItems.filter((item) => item.item_type === "currency");

        if (items.length === 0) {
            row.innerHTML = `<p class="shop-empty-inline">판매 중인 재화가 없습니다.</p>`;
            return;
        }

        row.innerHTML = "";
        items.forEach((item, index) => {
            const owned = myItemQuantities[item.id] || 0;
            const card = document.createElement("button");
            card.type = "button";
            card.className = "shop-item-card-sq";
            card.style.animationDelay = `${index * 35}ms`;
            card.innerHTML = `
                <div class="shop-item-sq-portrait">
                    <img alt="${escapeHtml(item.name)}">
                    ${owned > 0 ? `<span class="shop-card-owned">${owned}</span>` : ""}
                </div>
                <div class="shop-item-sq-price">${Number(item.price).toLocaleString()}G</div>
            `;
            const img = card.querySelector("img");
            img.src = itemImageSrc(item);
            img.onerror = () => { img.style.visibility = "hidden"; };
            card.addEventListener("click", () => openConfirm(item));
            row.appendChild(card);
        });
    }

    // 의상 아이템은 로비 상단 아바타와 같은 크롭(얼굴 위주로 확대)을 적용하고,
    // 그 외(강화/재화 아이템 아이콘)는 CSS 기본값(object-fit: contain, 여백)을 그대로 쓴다.
    function applyConfirmIconCrop(imgEl, item) {
        if (item.item_type === "outfit" && typeof applyAvatarCrop === "function") {
            imgEl.style.padding = "0";
            applyAvatarCrop(imgEl, item.outfit_file);
        } else {
            imgEl.style.padding = "";
            imgEl.style.objectFit = "";
            imgEl.style.objectPosition = "";
            imgEl.style.transform = "";
            imgEl.style.transformOrigin = "";
        }
    }

    // ── 구매 모달 ──
    function openConfirm(item) {
        selectedItem = item;
        selectedQty = 1;

        const iconEl = document.getElementById("shop-confirm-icon");
        iconEl.src = itemImageSrc(item);
        iconEl.onerror = () => { iconEl.style.visibility = "hidden"; };
        iconEl.style.visibility = "visible";
        applyConfirmIconCrop(iconEl, item);

        document.getElementById("shop-confirm-name").textContent = item.name;
        document.getElementById("shop-confirm-effect").textContent = describeEffect(item);
        document.getElementById("shop-confirm-condition").textContent = describeCondition(item);

        // 의상은 한 장씩만(수량 조절 없음), 강화/재화 아이템은 여러 개 살 수 있게 화살표 표시
        const qtyRow = document.getElementById("shop-qty-row");
        qtyRow.hidden = item.item_type === "outfit";

        updateQtyDisplay();
        document.getElementById("shop-confirm-overlay").hidden = false;
    }

    // 구매 조건(캐릭터 보유/업적 달성/한정 수량)을 한 줄로 설명한다.
    function describeCondition(item) {
        const parts = [];
        if (item.source_character) parts.push(`'${item.source_character}' 보유 시 구매 가능`);
        if (item.required_achievement) parts.push(`업적 '${item.required_achievement}' 달성 시 구매 가능`);
        if (item.purchase_limit != null) {
            parts.push(`${item.purchase_limit}회 한정 (구매 ${item.purchased_count || 0}/${item.purchase_limit})`);
        }
        if (item.daily_purchase_limit != null) {
            parts.push(`하루 ${item.daily_purchase_limit}개 한정 (오늘 ${item.daily_purchased_count || 0}/${item.daily_purchase_limit})`);
        }
        return parts.join(" · ");
    }

    // 지금 상태로 구매 가능한지 확인해서, 불가능하면 사유를 보여주고 버튼 자체를 눌러도 반응하지
    // 않게 비활성화한다. 서버에 요청을 보내봤다가 실패해서 브라우저 alert가 뜨는 걸 미리 막기 위함.
    function updateBuyAvailability() {
        if (!selectedItem) return;

        const reasons = [];
        const totalPrice = selectedItem.price * selectedQty;

        if (selectedItem.source_character && !myCharacterNames.has(selectedItem.source_character)) {
            reasons.push(`'${selectedItem.source_character}' 보유가 필요합니다.`);
        }
        if (selectedItem.required_achievement && !selectedItem.achievement_unlocked) {
            reasons.push(`'${selectedItem.required_achievement}' 업적 달성이 필요합니다.`);
        }
        if (selectedItem.purchase_limit != null) {
            const remaining = selectedItem.purchase_limit - (selectedItem.purchased_count || 0);
            if (remaining <= 0) {
                reasons.push("이미 구매 한도를 초과했습니다.");
            } else if (selectedQty > remaining) {
                reasons.push(`최대 ${remaining}개까지만 구매할 수 있습니다.`);
            }
        }
        if (selectedItem.daily_purchase_limit != null) {
            const remainingToday = selectedItem.daily_purchase_limit - (selectedItem.daily_purchased_count || 0);
            if (remainingToday <= 0) {
                reasons.push("오늘 구매 가능한 수량을 모두 소진했습니다.");
            } else if (selectedQty > remainingToday) {
                reasons.push(`오늘은 최대 ${remainingToday}개까지만 구매할 수 있습니다.`);
            }
        }
        if (myGold < totalPrice) {
            reasons.push(`골드가 부족합니다. (필요 ${totalPrice.toLocaleString()}G / 보유 ${myGold.toLocaleString()}G)`);
        }

        document.getElementById("shop-confirm-buy").disabled = reasons.length > 0;

        const reasonEl = document.getElementById("shop-confirm-blocked-reason");
        reasonEl.hidden = reasons.length === 0;
        reasonEl.textContent = reasons.join(" ");
    }

    function updateQtyDisplay() {
        document.getElementById("shop-qty-value").textContent = selectedQty;
        document.getElementById("shop-confirm-total-price").textContent =
            Number(selectedItem.price * selectedQty).toLocaleString();
        updateBuyAvailability();
    }

    function closeConfirm() {
        document.getElementById("shop-confirm-overlay").hidden = true;
        selectedItem = null;
        selectedQty = 1;
    }

    async function purchaseSelected() {
        if (!selectedItem) return;
        const buyBtn = document.getElementById("shop-confirm-buy");
        buyBtn.disabled = true;

        try {
            const res = await fetch(`${API_BASE_URL}/shop/purchase`, {
                method: "POST",
                headers: authHeaders(true),
                body: JSON.stringify({ item_id: selectedItem.id, quantity: selectedQty }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "구매에 실패했습니다.");

            const purchasedItem = selectedItem;
            const purchasedQty = selectedQty;
            closeConfirm();
            showResult(purchasedItem, purchasedQty);

            await refreshData();
            if (typeof loadProfile === "function") await loadProfile();
        } catch (error) {
            alert(error.message);
        } finally {
            buyBtn.disabled = false;
        }
    }

    // ── 획득 결과: 가챠 리빌과 같은 톤의 화면 ──
    function showResult(item, qty) {
        const iconEl = document.getElementById("shop-result-icon");
        iconEl.src = itemImageSrc(item);
        iconEl.onerror = () => { iconEl.style.visibility = "hidden"; };
        iconEl.style.visibility = "visible";
        applyConfirmIconCrop(iconEl, item);

        document.getElementById("shop-result-name").textContent =
            qty > 1 ? `${item.name} x${qty}` : item.name;
        document.getElementById("shop-result-desc").textContent = describeEffect(item);
        document.getElementById("shop-result-overlay").hidden = false;
    }

    function closeResult() {
        document.getElementById("shop-result-overlay").hidden = true;
    }

    function resetToDefault() {
        if (!loaded) return;
        const scrollOuter = document.getElementById("shop-scroll-outer");
        if (scrollOuter) scrollOuter.scrollTo({ left: 0 });
        document.querySelectorAll(".shop-index-btn").forEach((b, i) => b.classList.toggle("active", i === 0));
    }

    openButton?.addEventListener("click", async () => {
        await ensureLoaded();
        if (loaded) {
            resetToDefault();
            await refreshData();
        }
    });

    // 상점 모달이 열려있는 동안은 body에 클래스를 붙여서, 골드 표시(#gold-chip)만 어두워지지 않게 한다.
    // home.js가 모달을 어떻게 열고 닫든(버튼 클릭/바깥 클릭/ESC 등) 항상 정확히 반영되도록,
    // 클래스 변화를 직접 지켜보는 방식(MutationObserver)을 쓴다.
    if (modal) {
        const shopModalObserver = new MutationObserver(() => {
            document.body.classList.toggle("shop-modal-open", modal.classList.contains("open"));
        });
        shopModalObserver.observe(modal, { attributes: true, attributeFilter: ["class"] });
    }
})();