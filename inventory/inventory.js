(function () {
    const PARTIAL_URL = "inventory/inventory-partial.html";
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;
    const TYPE_LABELS = { Teacher: "교사", Parent: "부모", Student: "학생" };

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
        document.getElementById("inventory-skill-btn")?.addEventListener("click", () => openSkillTraitModal("skill"));
        document.getElementById("inventory-trait-btn")?.addEventListener("click", () => openSkillTraitModal("trait"));
        document.getElementById("inventory-subinfo-close")?.addEventListener("click", closeSkillTraitModal);
        document.getElementById("inventory-subinfo-overlay")?.addEventListener("click", (e) => {
            if (e.target.id === "inventory-subinfo-overlay") closeSkillTraitModal();
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
                    <img alt="${escapeHtml(group.name)}">
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

    const OUTCOME_LABELS = { success: "성공", maintain: "유지", destroy: "파괴" };

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
                    <img alt="${escapeHtml(item.name)}">
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

        renderStarButtons(g.star);
        renderOutfitChoices();
        document.getElementById("inventory-outfit-panel").hidden = true;
        closeSkillTraitModal();
    }

    function renderStarButtons(initialStar) {
        const holder = document.getElementById("inventory-star-buttons");
        holder.innerHTML = "";

        // 캐릭터 등급별 시작 성급보다 낮은 성급은 이 캐릭터에게 구조적으로 존재하지 않는다
        // (예: 신화 등급은 ★5부터 시작하므로 ★1~★4는 애초에 있을 수 없음).
        const startStar = selectedGroup.start_star || 1;

        for (let star = 1; star <= 6; star++) {
            const ownedGroup = (inventoryData.characters || []).find(
                (row) => row.name === selectedGroup.name && row.star === star
            );
            const exists = star >= startStar;      // 이 캐릭터 등급상 가능한 성급인지
            const unlocked = Boolean(ownedGroup);   // 실제로 보유(달성)한 적 있는지

            const button = document.createElement("button");
            button.type = "button";
            button.className = "inventory-star-button";
            if (ownedGroup) button.classList.add("owned");
            if (star === initialStar) button.classList.add("selected");

            if (!exists) {
                // 구조상 존재하지 않는 성급: 자물쇠 없이 그냥 비활성화
                button.classList.add("nonexistent");
                button.disabled = true;
            } else if (!unlocked) {
                // 존재는 하지만 아직 달성 못 한 성급: 자물쇠 표시하고 비활성화
                button.classList.add("locked");
                button.disabled = true;
            }

            const lockIcon = (exists && !unlocked)
                ? `<img class="inventory-star-lock" src="assets/icons/lock.png" alt="" onerror="this.outerHTML='🔒'">`
                : "";

            button.innerHTML = `
                ★${star}
                ${ownedGroup ? `<span class="inventory-star-owned-count">${ownedGroup.count}</span>` : ""}
                ${lockIcon}
            `;

            if (exists && unlocked) {
                button.addEventListener("click", () => selectStarInfo(star, button));
            }

            holder.appendChild(button);
        }
        showStarEffect(initialStar);
    }

    function selectStarInfo(star, button) {
        document.querySelectorAll(".inventory-star-button").forEach((b) => b.classList.remove("selected"));
        button.classList.add("selected");
        showStarEffect(star);
    }

    function showStarEffect(star) {
        const key = String(star);
        const effect = selectedGroup.star_effects?.[key] || "해당 성급의 변경사항이 아직 등록되지 않았습니다.";
        const expMultiplier = selectedGroup.exp_multiplier?.[key];
        const expSubjects = selectedGroup.exp_subjects || [];
        const expLabel = expMultiplier == null
            ? "-"
            : expSubjects.length
                ? `${expSubjects.join(", ")}에서 ${expMultiplier}배`
                : `${expMultiplier}배`;
        const skill = selectedGroup.skill_effects?.[key];
        const trait = selectedGroup.trait_effects?.[key];

        document.getElementById("inventory-star-effect").innerHTML = `
            <div class="star-effect-title">★${star}</div>
            <div class="star-effect-row"><span>EXP 배수</span><strong>${expLabel}</strong></div>
            <div class="star-effect-row"><span>효과</span><span>${escapeHtml(effect)}</span></div>
        `;

        // 스킬/특성은 텍스트 표시 대신 버튼 형태 - 이 성급에 없으면 버튼을 비활성화하고 자물쇠 아이콘을 보여준다.
        // 버튼을 누르면 openSkillTraitModal()이 이 값을 그대로 서브 모달에 띄운다.
        updateSkillTraitButton("skill", skill);
        updateSkillTraitButton("trait", trait);

        // 성급을 바꿨는데 지금 열려 있던 서브 모달이 있으면(예: 스킬 보다가 성급 변경) 새 값으로 갱신
        if (!document.getElementById("inventory-subinfo-overlay").hidden) {
            const openKind = document.getElementById("inventory-subinfo-overlay").dataset.kind;
            if (openKind) openSkillTraitModal(openKind);
        }
    }

    function updateSkillTraitButton(kind, text) {
        const btn = document.getElementById(`inventory-${kind}-btn`);
        if (!btn) return;
        const available = Boolean(text);
        btn.disabled = !available;
        btn.dataset.text = text || "";
        const lockIcon = btn.querySelector(".inventory-skill-trait-lock");
        if (lockIcon) lockIcon.hidden = available;
    }

    function openSkillTraitModal(kind) {
        const btn = document.getElementById(`inventory-${kind}-btn`);
        if (!btn || btn.disabled) return;
        const overlay = document.getElementById("inventory-subinfo-overlay");
        overlay.dataset.kind = kind;
        document.getElementById("inventory-subinfo-title").textContent = kind === "skill" ? "스킬" : "특성";
        document.getElementById("inventory-subinfo-body").textContent = btn.dataset.text || "정보가 없습니다.";
        overlay.hidden = false;
    }

    function closeSkillTraitModal() {
        const overlay = document.getElementById("inventory-subinfo-overlay");
        overlay.hidden = true;
        delete overlay.dataset.kind;
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
})();