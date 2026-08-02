(function () {
    const PARTIAL_URL = "inventory/inventory-partial.html";
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;
    const TYPE_LABELS = { Teacher: "교사", Parent: "부모", Student: "학생" };
    // 스킬 3분류 - 필드명은 그대로(star_effects=Passive, skill_effects=Active, trait_effects=Special)
    // 두고 화면에만 새 명칭을 쓴다. fallbackName은 "이름:설명" 형식이 아닌 텍스트(주로 Passive)일 때
    // 버튼에 표시할 이름이 없어서 대신 쓰는 값.
    const ABILITY_META = {
        passive: { field: "star_effects", bracket: "Passive", fallbackName: "패시브" },
        active: { field: "skill_effects", bracket: "Active", fallbackName: "액티브" },
        special: { field: "trait_effects", bracket: "Special", fallbackName: "스페셜" },
    };

    const modal = document.getElementById("modal-character");
    const box = document.getElementById("inventory-modal-box");
    const content = document.getElementById("inventory-content");
    const openButton = document.querySelector('[data-modal-target="modal-character"]');

    let loaded = false;
    let loading = false;
    let inventoryData = { characters: [], catalog_order: [] };
    let itemData = [];
    let selectedGroup = null;
    let activeListTab = "characters";

    function authHeaders(json = false) {
        const token = localStorage.getItem("access_token");
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        if (json) headers["Content-Type"] = "application/json";
        return headers;
    }

    function stars(n) {
        return "★".repeat(Math.max(0, Math.min(6, Number(n) || 0)));
    }

    function setMode(mode) {
        box.classList.remove("inventory-mode-menu", "inventory-mode-list", "inventory-mode-detail");
        box.classList.add(`inventory-mode-${mode}`);
        ["inventory-menu-view", "inventory-list-view", "inventory-detail-view"].forEach((id) => {
            const view = document.getElementById(id);
            if (view) view.hidden = id !== `inventory-${mode}-view`;
        });
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
            setMode("menu");
        } catch (error) {
            content.innerHTML = `<p class="inventory-empty">인벤토리를 불러오지 못했습니다. (${error.message})</p>`;
        } finally {
            loading = false;
        }
    }

    async function refreshData() {
        const [charactersRes, itemsRes] = await Promise.all([
            fetch(`${API_BASE_URL}/characters/inventory`, { headers: authHeaders() }),
            fetch(`${API_BASE_URL}/shop/my-items`, { headers: authHeaders() }),
        ]);

        if (!charactersRes.ok) {
            const body = await charactersRes.json().catch(() => ({}));
            throw new Error(body.detail || "인물 정보를 불러오지 못했습니다.");
        }
        inventoryData = await charactersRes.json();
        // 재화 아이템(스토리모드 티켓 등)은 상단바/스토리 화면에서만 보여주고 인벤토리 아이템 목록엔 노출하지 않는다.
        const allMyItems = itemsRes.ok ? await itemsRes.json() : [];
        itemData = allMyItems.filter((item) => item.item_type !== "currency");
    }

    function bindInteractions() {
        document.getElementById("inventory-open-characters")?.addEventListener("click", () => openList("characters"));
        document.getElementById("inventory-open-items")?.addEventListener("click", () => openList("items"));
        document.getElementById("inventory-list-back")?.addEventListener("click", () => setMode("menu"));
        document.getElementById("inventory-character-tab")?.addEventListener("click", () => switchListTab("characters"));
        document.getElementById("inventory-item-tab")?.addEventListener("click", () => switchListTab("items"));
        document.getElementById("inventory-detail-back")?.addEventListener("click", () => {
            setMode("list");
            switchListTab("characters");
        });
        document.getElementById("inventory-outfit-button")?.addEventListener("click", toggleOutfitPanel);
        document.getElementById("inventory-equip-button")?.addEventListener("click", equipSelectedCharacter);
        document.getElementById("inventory-subinfo-close")?.addEventListener("click", closeAbilityModal);
        document.getElementById("inventory-subinfo-overlay")?.addEventListener("click", (e) => {
            if (e.target.id === "inventory-subinfo-overlay") closeAbilityModal();
        });
    }

    async function openList(tab) {
        activeListTab = tab;
        setMode("list");
        showLoading();
        try {
            await refreshData();
            switchListTab(tab);
        } catch (error) {
            showEmpty(error.message);
        }
    }

    function showLoading() {
        const grid = document.getElementById("inventory-character-grid");
        const itemGrid = document.getElementById("inventory-item-grid");
        if (grid) grid.innerHTML = "";
        if (itemGrid) itemGrid.innerHTML = "";
        showEmpty("불러오는 중...", true);
    }

    function showEmpty(message, visible = true) {
        const empty = document.getElementById("inventory-empty");
        if (!empty) return;
        empty.textContent = message;
        empty.hidden = !visible;
    }

    // 탭 전환 도중 렌더링이 실패해도(예: 데이터 형식 문제) 조용히 아무 반응 없는 것처럼
    // 보이지 않도록, 에러를 잡아서 화면에 표시하고 콘솔에도 남긴다.
    function switchListTab(tab) {
        activeListTab = tab;
        document.getElementById("inventory-character-tab")?.classList.toggle("active", tab === "characters");
        document.getElementById("inventory-item-tab")?.classList.toggle("active", tab === "items");
        document.getElementById("inventory-character-grid").hidden = tab !== "characters";
        document.getElementById("inventory-item-grid").hidden = tab !== "items";

        try {
            if (tab === "characters") renderCharacterGrid();
            else renderItemGrid();
        } catch (error) {
            console.error("인벤토리 탭 렌더링 오류:", error);
            showEmpty(`화면을 그리지 못했습니다. (${error.message})`, true);
        }
    }

    function applyCrop(img, outfit) {
        if (typeof applyAvatarCrop === "function") applyAvatarCrop(img, outfit);
        else {
            img.style.objectFit = "cover";
            img.style.objectPosition = "50% 10%";
        }
    }

    function renderCharacterGrid() {
        const grid = document.getElementById("inventory-character-grid");
        grid.innerHTML = "";
        const groups = inventoryData.characters || [];
        showEmpty(groups.length ? "" : "보유한 인물이 없습니다.", groups.length === 0);

        groups.forEach((group, index) => {
            const card = document.createElement("button");
            card.className = "inventory-character-card";
            card.type = "button";
            card.style.animationDelay = `${Math.min(index, 15) * 35}ms`;
            card.innerHTML = `
                <div class="inventory-card-portrait">
                    <img alt="${escapeHtml(group.name)}" loading="lazy" decoding="async">
                    ${group.is_equipped ? '<span class="inventory-card-equipped">장착 중</span>' : ""}
                    <div class="inventory-card-star-overlay">${stars(group.star)}</div>
                </div>
                <div class="inventory-card-name">${escapeHtml(group.name)}</div>
                <div class="inventory-card-meta">★${group.star} · ${group.count}명</div>
            `;
            const img = card.querySelector("img");
            img.src = `${OUTFIT_IMAGE_BASE}${group.outfit}/idle.png`;
            img.onerror = () => { img.style.visibility = "hidden"; };
            applyCrop(img, group.outfit);
            card.addEventListener("click", () => openDetail(group));
            grid.appendChild(card);
        });
    }

    const OUTCOME_LABELS = { success: "성공", maintain: "유지", destroy: "파괴", super_success: "슈퍼 성공" };

    // 강화 아이템의 effect_type/effect_params(데이터)를 사람이 읽을 문장으로 바꾼다. (shop.js/enhancement.js와 같은 로직)
    function describeEffect(item) {
        if (item.item_type !== "enhancement" || !item.effect_type) return "";
        const p = item.effect_params || {};

        if (item.effect_type === "shift") {
            return `기능: ${OUTCOME_LABELS[p.from] || p.from} 확률 ${p.amount}%p를 ${OUTCOME_LABELS[p.to] || p.to} 확률로 옮깁니다.`;
        }
        if (item.effect_type === "redistribute") {
            const ratioText = Object.entries(p.ratio || {})
                .map(([key, weight]) => `${OUTCOME_LABELS[key] || key} ${weight}`)
                .join(" : ");
            return `기능: ${OUTCOME_LABELS[p.remove] || p.remove} 확률을 없애고, 남은 확률을 ${ratioText} 비율로 재분배합니다.`;
        }
        if (item.effect_type === "force") {
            const base = `기능: 강화 결과를 반드시 ${OUTCOME_LABELS[p.outcome] || p.outcome}으로 만듭니다.`;
            return p.outcome === "destroy" ? `${base} 인물 1장으로 강화가 가능합니다.` : base;
        }
        if (item.effect_type === "super_success_shift") {
            return `기능: 강화 시 성공 확률 ${Math.abs(p.success_delta || 0)}%p를 슈퍼 성공(2성치 강화) 확률로 옮깁니다.`;
        }
        if (item.effect_type === "material_substitute") {
            return "기능: 강화 시 재료 인물 카드 1장을 대신합니다.";
        }
        if (item.effect_type === "next_enhance_buff") {
            return `기능: 강화 성공 시, 그 캐릭터의 다음 강화에서 파괴 확률 ${Math.abs(p.destroy_delta || 0)}%p 감소, 성공 확률 ${p.success_delta || 0}%p 증가 효과를 예약합니다.`;
        }
        if (item.effect_type === "dust_convert") {
            return "기능: 강화 성공/유지/파괴 확률이 사라지고, 성급별 확률로 인물 3장이 먼지 1개로 바뀝니다. 다른 강화 아이템과 함께 사용할 수 없습니다.";
        }
        return "";
    }

    function renderItemGrid() {
        const grid = document.getElementById("inventory-item-grid");
        grid.innerHTML = "";
        showEmpty(itemData.length ? "" : "보유한 아이템이 없습니다.", itemData.length === 0);

        itemData.forEach((item, index) => {
            const row = document.createElement("div");
            row.className = "inventory-item-row";
            row.style.animationDelay = `${Math.min(index, 15) * 35}ms`;
            row.innerHTML = `
                <div class="inventory-item-row-portrait">
                    <img alt="${escapeHtml(item.name)}" loading="lazy" decoding="async">
                    <span class="inventory-item-row-quantity">×${item.quantity}</span>
                </div>
                <div class="inventory-item-row-body">
                    <div class="inventory-item-row-name">${escapeHtml(item.name)}</div>
                    <div class="inventory-item-row-desc">${escapeHtml(item.description || "")}</div>
                    <div class="inventory-item-row-effect">${escapeHtml(describeEffect(item))}</div>
                </div>
            `;
            const img = row.querySelector("img");
            img.src = item.item_type === "enhancement"
                ? (item.icon_file || "")
                : `${OUTFIT_IMAGE_BASE}${item.outfit_file}/idle.png`;
            img.onerror = () => { img.style.visibility = "hidden"; };
            if (item.item_type !== "enhancement") applyCrop(img, item.outfit_file);
            grid.appendChild(row);
        });
    }

    function openDetail(group) {
        selectedGroup = { ...group };
        setMode("detail");
        renderDetail();
        restartDetailAnimations();
    }

    function restartDetailAnimations() {
        const left = document.getElementById("inventory-detail-left");
        const right = document.getElementById("inventory-detail-right");
        [left, right].forEach((el) => {
            el.classList.remove("entering");
            void el.offsetWidth;
            el.classList.add("entering");
        });
    }

    function renderDetail() {
        const g = selectedGroup;
        if (!g) return;

        const standing = document.getElementById("inventory-standing-image");
        standing.src = `${OUTFIT_IMAGE_BASE}${g.outfit}/idle.png`;
        standing.alt = g.name;
        standing.onerror = () => { standing.style.visibility = "hidden"; };
        standing.style.visibility = "visible";

        document.getElementById("inventory-detail-rarity").textContent = `${g.rarity} · ${g.job_class}`;
        document.getElementById("inventory-detail-name").textContent = g.name;
        document.getElementById("inventory-detail-stars").textContent = stars(g.star);
        document.getElementById("inventory-detail-count").textContent = `${g.count}명 보유`;
        document.getElementById("inventory-info-rarity").textContent = g.rarity;
        document.getElementById("inventory-info-job").textContent = g.job_class;
        document.getElementById("inventory-info-gender").textContent = g.gender || "-";
        document.getElementById("inventory-info-range").textContent = g.range;
        document.getElementById("inventory-info-attack").textContent = TYPE_LABELS[g.attack_type] || g.attack_type;
        document.getElementById("inventory-info-defense").textContent = TYPE_LABELS[g.defense_type] || g.defense_type;
        document.getElementById("inventory-description").textContent = g.description || "설명이 없습니다.";

        const equipButton = document.getElementById("inventory-equip-button");
        equipButton.disabled = Boolean(g.is_equipped);
        equipButton.textContent = g.is_equipped ? "현재 로비에 장착 중" : "로비에 장착하기";

        renderAbilities();
        renderOutfitChoices();
        document.getElementById("inventory-outfit-panel").hidden = true;
        closeAbilityModal();
    }

    // 성급별 텍스트가 "이 성급엔 효과 없음"을 나타낼 때 쓰는 자리표시 문구(주로 패시브) - 문자열 자체는
    // 채워져 있어서 단순 truthy 체크로는 "있음"으로 오판된다.
    const NO_EFFECT_TEXT = "해당 성급의 별도 효과가 없습니다.";

    function isAbilityAvailable(text) {
        return Boolean(text) && text !== NO_EFFECT_TEXT;
    }

    // "이름: 설명" 형식에서 이름만 떼어낸다. 패시브는 보통 콜론이 없는 설명뿐이라 이름이 없는 채로 온다.
    function splitAbilityText(text) {
        if (!text) return { name: "", desc: "" };
        const idx = text.indexOf(":");
        if (idx === -1) return { name: "", desc: text.trim() };
        return { name: text.slice(0, idx).trim(), desc: text.slice(idx + 1).trim() };
    }

    // 지금 성급에 아직 잠긴 능력이라도 버튼엔 이름을 보여줘야 하므로, 이 캐릭터의 전 성급(1~6)을 훑어서
    // "이름: 설명" 형식이 처음 나오는 성급의 이름을 능력의 "정식 이름"으로 쓴다(성급이 올라가도 이름 자체는
    // 안 바뀌는 게 원칙이라 어느 성급에서 찾든 같은 이름이어야 정상). 패시브처럼 애초에 이름이 없는
    // 능력은 못 찾으면 fallback으로 대체된다 - 나중에 characters.json의 star_effects에 "이름: 설명"
    // 형식으로 이름을 채우면 코드 변경 없이 자동으로 이 이름이 뜬다.
    function findCanonicalAbilityName(effectsByStar) {
        for (let star = 1; star <= 6; star++) {
            const text = effectsByStar?.[String(star)];
            if (!isAbilityAvailable(text)) continue;
            const { name } = splitAbilityText(text);
            if (name) return name;
        }
        return "";
    }

    // 숫자(퍼센트/배수 등 뒤에 붙는 단위 포함)를 굵게 강조. escapeHtml을 숫자 매치 앞뒤로만 따로 적용해서,
    // "&#039;" 같은 엔티티 안의 숫자가 강조 정규식에 걸려 태그가 깨지는 일이 없게 한다.
    function highlightNumbers(rawText) {
        const NUM_RE = /\d+(?:\.\d+)?(?:%|배|회|초|명|x|X)?/g;
        let out = "";
        let lastIndex = 0;
        let match;
        while ((match = NUM_RE.exec(rawText)) !== null) {
            out += escapeHtml(rawText.slice(lastIndex, match.index));
            out += `<strong class="subinfo-number">${escapeHtml(match[0])}</strong>`;
            lastIndex = match.index + match[0].length;
        }
        out += escapeHtml(rawText.slice(lastIndex));
        return out;
    }

    // 카드 자체의 현재 성급(g.star) 기준으로만 보여준다 - 예전처럼 다른 성급을 미리 눌러보는 기능은 없앰.
    function renderAbilities() {
        const g = selectedGroup;
        const key = String(g.star);

        const expMultiplier = g.exp_multiplier?.[key];
        const expSubjects = g.exp_subjects || [];
        document.getElementById("inventory-info-exp-subject").textContent = expSubjects.length ? expSubjects.join(", ") : "-";
        document.getElementById("inventory-info-exp-rate").textContent = expMultiplier == null ? "-" : `${expMultiplier}배`;

        Object.entries(ABILITY_META).forEach(([kind, meta]) => {
            const effectsByStar = g[meta.field] || {};
            renderAbilityGroup(kind, meta, effectsByStar[key], findCanonicalAbilityName(effectsByStar));
        });
    }

    function renderAbilityGroup(kind, meta, text, canonicalName) {
        const holder = document.getElementById(`inventory-ability-${kind}`);
        if (!holder) return;
        holder.innerHTML = "";

        const { desc } = splitAbilityText(text);
        const available = isAbilityAvailable(text);
        const label = canonicalName || meta.fallbackName;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "inventory-ability-btn";
        button.disabled = !available;
        button.innerHTML = `
            <span>${escapeHtml(label)}</span>
            ${!available ? `<img class="inventory-skill-trait-lock" src="assets/icons/lock.png" alt="" onerror="this.outerHTML='🔒'">` : ""}
        `;
        if (available) {
            button.addEventListener("click", () => openAbilityModal(meta.bracket, desc));
        }
        holder.appendChild(button);
    }

    function openAbilityModal(bracket, desc) {
        document.getElementById("inventory-subinfo-title").textContent = `[${bracket}]`;
        document.getElementById("inventory-subinfo-body").innerHTML = highlightNumbers(desc);
        document.getElementById("inventory-subinfo-overlay").hidden = false;
    }

    function closeAbilityModal() {
        document.getElementById("inventory-subinfo-overlay").hidden = true;
    }

    function getOutfitChoices() {
        const choices = [];
        const seen = new Set();
        const push = (name, path, owned = true) => {
            if (!path || seen.has(path)) return;
            seen.add(path);
            choices.push({ name, path, owned });
        };

        push("기본", selectedGroup.outfits?.["기본"], true);
        itemData
            .filter((item) => item.source_character === selectedGroup.name && item.quantity > 0)
            .forEach((item) => push(item.season || item.name, item.outfit_file, true));
        push("현재", selectedGroup.outfit, true);
        return choices;
    }

    function renderOutfitChoices() {
        const list = document.getElementById("inventory-outfit-list");
        list.innerHTML = "";
        getOutfitChoices().forEach((choice) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "inventory-outfit-choice";
            button.classList.toggle("active", choice.path === selectedGroup.outfit);
            button.textContent = choice.name;
            button.addEventListener("click", () => changeOutfit(choice.path));
            list.appendChild(button);
        });
    }

    function toggleOutfitPanel() {
        const panel = document.getElementById("inventory-outfit-panel");
        panel.hidden = !panel.hidden;
    }

    async function changeOutfit(outfitFile) {
        try {
            const res = await fetch(`${API_BASE_URL}/characters/apply-outfit`, {
                method: "POST",
                headers: authHeaders(true),
                body: JSON.stringify({
                    character_id: selectedGroup.character_id,
                    outfit_file: outfitFile,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "의상을 변경하지 못했습니다.");
            selectedGroup.outfit = data.current_outfit;
            const original = inventoryData.characters.find(
                (row) => row.character_id === selectedGroup.character_id
            );
            if (original) original.outfit = data.current_outfit;
            renderDetail();
        } catch (error) {
            alert(error.message);
        }
    }

    async function equipSelectedCharacter() {
        if (!selectedGroup) return;
        const button = document.getElementById("inventory-equip-button");
        button.disabled = true;
        try {
            const res = await fetch(`${API_BASE_URL}/characters/equip`, {
                method: "POST",
                headers: authHeaders(true),
                body: JSON.stringify({ character_id: selectedGroup.character_id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "인물을 장착하지 못했습니다.");

            if (typeof closeModal === "function") closeModal("modal-character");
            else modal?.classList.remove("open");
            if (typeof loadProfile === "function") await loadProfile();
        } catch (error) {
            alert(error.message);
            button.disabled = false;
        }
    }

    function resetToMenu() {
        if (loaded) {
            setMode("menu");
            const outfitPanel = document.getElementById("inventory-outfit-panel");
            if (outfitPanel) outfitPanel.hidden = true;
        }
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    openButton?.addEventListener("click", async () => {
        await ensureLoaded();
        resetToMenu();
    });
    modal?.querySelector("[data-modal-close]")?.addEventListener("click", resetToMenu);

    // 로비 상단바의 작은 프로필 사진(avatar-img)과 로비 중앙의 큰 캐릭터 일러스트(avatar-img-large)를
    // 누르면, 메뉴를 거치지 않고 곧바로 인벤토리의 "인물" 목록으로 이동한다.
    async function openToCharacterList() {
        if (typeof openModal === "function") openModal("modal-character");
        await ensureLoaded();
        openList("characters");
    }
    document.getElementById("avatar-img")?.addEventListener("click", openToCharacterList);
    document.getElementById("avatar-img-large")?.addEventListener("click", openToCharacterList);
})();