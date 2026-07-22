(function () {
    "use strict";

    const PARTIAL_URL = "enhancement/enhancement-partial.html";
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;
    const OUTCOME_LABELS = { success: "성공", maintain: "유지", destroy: "파괴" };

    const contentEl = document.getElementById("enhancement-content");
    const modalEl = document.getElementById("modal-enhancement");
    const openButton = document.querySelector(
        '[data-modal-target="modal-enhancement"]'
    );

    let loaded = false;
    let loading = false;
    let enhancementData = {
        gold: 0,
        required_copies: 3,
        rules: {},
        characters: [],
    };
    let selectedCharacter = null;
    let myEnhancementItems = []; // /shop/my-items 중 item_type === "enhancement"만
    let selectedItemIds = [];    // 이번 강화에 사용할 UserItem의 item_id 목록 (중복 없음)
    let pendingAchievements = []; // 결과 모달을 닫은 뒤에 보여줄 업적 알림 (동시에 뜨면 서로 가려서 뒤로 미룸)
    let pendingCharacters = [];   // 결과 모달을 닫은 뒤에 보여줄 업적 보상 캐릭터 획득 연출

    function authHeaders(json = false) {
        const token = localStorage.getItem("access_token");
        const headers = token
            ? { Authorization: `Bearer ${token}` }
            : {};

        if (json) {
            headers["Content-Type"] = "application/json";
        }

        return headers;
    }

    function stars(value) {
        return "★".repeat(Math.max(0, Math.min(6, Number(value) || 0)));
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function applyCrop(imgEl, outfit) {
        if (!imgEl || !outfit) return;

        if (typeof applyAvatarCrop === "function") {
            applyAvatarCrop(imgEl, outfit);
        } else {
            imgEl.style.objectFit = "cover";
            imgEl.style.objectPosition = "50% 10%";
        }
    }

    function setPortrait(imgEl, outfit, altText) {
        if (!imgEl || !outfit) return;

        imgEl.style.visibility = "visible";
        imgEl.alt = altText || "";
        imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/idle.png`;
        imgEl.onerror = () => {
            imgEl.style.visibility = "hidden";
        };

        applyCrop(imgEl, outfit);
    }

    // ── 강화 아이템 효과를 사람이 읽을 문장으로 (shop.js와 같은 로직) ──
    function describeEffect(item) {
        if (!item.effect_type) return "";
        const p = item.effect_params || {};

        if (item.effect_type === "shift") {
            return `${OUTCOME_LABELS[p.from] || p.from} ${p.amount}%p → ${OUTCOME_LABELS[p.to] || p.to}`;
        }
        if (item.effect_type === "redistribute") {
            const ratioText = Object.entries(p.ratio || {})
                .map(([key, weight]) => `${OUTCOME_LABELS[key] || key} ${weight}`)
                .join(" : ");
            return `${OUTCOME_LABELS[p.remove] || p.remove} 제거, ${ratioText}로 재분배`;
        }
        if (item.effect_type === "force") {
            const base = `반드시 ${OUTCOME_LABELS[p.outcome] || p.outcome}`;
            // 파괴가 확정이면 재료를 잃을 이유가 없으니, 카드 한 장만으로도 강화(=파괴)를 시도할 수 있다.
            return p.outcome === "destroy" ? `${base}, 1장으로 강화 가능` : base;
        }
        return "";
    }

    // ── 선택된 아이템들을 기본 확률표에 적용해서 미리보기 계산 (백엔드 계산 로직과 동일한 규칙) ──
    function applyShift(rule, params) {
        const result = { ...rule };
        const moved = Math.min(params.amount, result[params.from] || 0);
        result[params.from] = (result[params.from] || 0) - moved;
        result[params.to] = (result[params.to] || 0) + moved;
        return result;
    }

    function applyRedistribute(rule, params) {
        const result = { ...rule };
        const freed = result[params.remove] || 0;
        const ratio = params.ratio || {};
        const totalRatio = Object.values(ratio).reduce((a, b) => a + b, 0) || 1;
        Object.entries(ratio).forEach(([key, weight]) => {
            result[key] = (result[key] || 0) + freed * (weight / totalRatio);
        });
        result[params.remove] = 0;
        return result;
    }

    function applyForce(rule, params) {
        return { success: 0, maintain: 0, destroy: 0, [params.outcome]: 100, cost: rule.cost };
    }

    // 지금 선택된 아이템 정의 목록. 확률 미리보기와 "카드 몇 장 필요한지" 계산이 둘 다 이걸 쓴다.
    function getSelectedItemDefs() {
        return myEnhancementItems.filter((item) => selectedItemIds.includes(item.item_id));
    }

    // "강 희의 파쇄기"(파괴 확정)를 지금 선택했는지 - 선택했으면 재료 없이 카드 1장만으로 강화를 시도할 수 있다.
    function hasForceDestroySelected() {
        return getSelectedItemDefs().some(
            (item) => item.effect_type === "force" && item.effect_params?.outcome === "destroy"
        );
    }

    function computePreviewRule(baseRule, items) {
        if (!baseRule) return null;

        const forceDestroy = items.find(
            (item) => item.effect_type === "force" && item.effect_params?.outcome === "destroy"
        );
        if (forceDestroy) {
            return applyForce(baseRule, forceDestroy.effect_params);
        }

        let result = { ...baseRule };
        items.forEach((item) => {
            if (item.effect_type === "shift") result = applyShift(result, item.effect_params);
            else if (item.effect_type === "redistribute") result = applyRedistribute(result, item.effect_params);
            else if (item.effect_type === "force") result = applyForce(result, item.effect_params);
        });
        return result;
    }

    async function ensureLoaded() {
        if (loaded || loading || !contentEl) return;

        loading = true;

        try {
            const res = await fetch(PARTIAL_URL);
            if (!res.ok) {
                throw new Error(`강화 화면 파일 ${res.status}`);
            }

            contentEl.innerHTML = await res.text();
            bindInteractions();
            loaded = true;

            await refreshEnhancementData();
        } catch (error) {
            contentEl.innerHTML =
                `<p class="enhancement-empty">` +
                `강화 화면을 불러오지 못했습니다. (${escapeHtml(error.message)})` +
                `</p>`;
        } finally {
            loading = false;
        }
    }

    async function refreshEnhancementData(preferredSelection = null) {
        const res = await fetch(
            `${API_BASE_URL}/characters/enhancement`,
            { headers: authHeaders() }
        );

        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(
                body.detail || "강화 정보를 불러오지 못했습니다."
            );
        }

        enhancementData = body;

        document.getElementById(
            "enhancement-gold-value"
        ).textContent = Number(body.gold || 0).toLocaleString();

        renderCharacterGrid();

        const selection =
            findCharacterGroup(preferredSelection) ||
            findCharacterGroup(selectedCharacter) ||
            body.characters.find(
                (row) => row.enhancement?.eligible
            ) ||
            body.characters[0] ||
            null;

        selectCharacter(selection);
    }

    function findCharacterGroup(target) {
        if (!target) return null;

        return enhancementData.characters.find(
            (row) =>
                row.name === target.name &&
                Number(row.star) === Number(target.star)
        );
    }

    function renderCharacterGrid() {
        const grid = document.getElementById(
            "enhancement-character-grid"
        );
        const empty = document.getElementById(
            "enhancement-empty"
        );

        grid.innerHTML = "";

        const groups = enhancementData.characters || [];

        if (groups.length === 0) {
            empty.textContent = "보유한 캐릭터가 없습니다.";
            empty.hidden = false;
            return;
        }

        empty.hidden = true;

        groups.forEach((group) => {
            const card = document.createElement("button");
            const eligible = Boolean(group.enhancement?.eligible);

            card.type = "button";
            card.className =
                `enhancement-character-card` +
                `${eligible ? "" : " unavailable"}`;

            if (
                selectedCharacter &&
                selectedCharacter.name === group.name &&
                Number(selectedCharacter.star) === Number(group.star)
            ) {
                card.classList.add("selected");
            }

            card.innerHTML = `
                <div class="enhancement-card-portrait">
                    <img alt="${escapeHtml(group.name)}">
                    <span class="enhancement-card-count">×${group.count}</span>
                    <div class="enhancement-card-stars">
                        ${stars(group.star)}
                    </div>
                </div>

                <div class="enhancement-card-name">
                    ${escapeHtml(group.name)}
                </div>

                <div class="enhancement-card-meta">
                    ★${group.star} · ${eligible ? "강화 가능" : "재료 부족"}
                </div>
            `;

            const imgEl = card.querySelector("img");
            setPortrait(imgEl, group.outfit, group.name);

            card.addEventListener("click", () => {
                selectedItemIds = []; // 캐릭터를 바꾸면 아이템 선택도 초기화
                selectCharacter(group);
            });

            grid.appendChild(card);
        });
    }

    function selectCharacter(group) {
        selectedCharacter = group || null;

        document
            .querySelectorAll(".enhancement-character-card")
            .forEach((card, index) => {
                const row = enhancementData.characters[index];

                card.classList.toggle(
                    "selected",
                    Boolean(
                        group &&
                        row &&
                        row.name === group.name &&
                        Number(row.star) === Number(group.star)
                    )
                );
            });

        renderSelectedCharacter();
    }

    function renderSelectedCharacter() {
        const currentImg = document.getElementById(
            "enhancement-current-image"
        );
        const targetImg = document.getElementById(
            "enhancement-target-image"
        );
        const submitButton = document.getElementById(
            "enhancement-submit-button"
        );
        const warning = document.getElementById(
            "enhancement-warning"
        );

        if (!selectedCharacter) {
            currentImg.removeAttribute("src");
            targetImg.removeAttribute("src");

            document.getElementById(
                "enhancement-current-name"
            ).textContent = "캐릭터를 선택하세요";

            document.getElementById(
                "enhancement-current-stars"
            ).textContent = "-";

            document.getElementById(
                "enhancement-target-stars"
            ).textContent = "-";

            document.getElementById(
                "enhancement-current-count"
            ).textContent = "보유 수량 -";

            document.getElementById(
                "enhancement-target-name"
            ).textContent = "다음 성급";

            setRuleText(null);
            renderSelectedItemsSummary();
            submitButton.disabled = true;
            warning.classList.remove("danger");
            warning.textContent = "강화할 캐릭터를 선택하세요.";
            return;
        }

        const group = selectedCharacter;
        const enhancement = group.enhancement || {};
        const baseRule = enhancement.rule || null;

        setPortrait(currentImg, group.outfit, group.name);
        setPortrait(targetImg, group.outfit, group.name);

        document.getElementById(
            "enhancement-current-name"
        ).textContent = group.name;

        document.getElementById(
            "enhancement-target-name"
        ).textContent = group.name;

        document.getElementById(
            "enhancement-current-stars"
        ).textContent = stars(group.star);

        document.getElementById(
            "enhancement-target-stars"
        ).textContent = enhancement.next_star
            ? stars(enhancement.next_star)
            : "최대";

        document.getElementById(
            "enhancement-current-count"
        ).textContent = `${group.count}장 보유`;

        // "강 희의 파쇄기"를 지금 선택했으면 재료 없이 카드 1장만 있어도 되고, 아니면 기존 3장이 필요하다.
        // (백엔드가 준 enhancement.required_copies는 "그 아이템을 어딘가 보유는 하고 있는지"에 대한
        // 힌트일 뿐이라, 실제 이번 시도에 뭘 선택했는지는 여기서 다시 계산해야 정확하다.)
        const shredderSelected = hasForceDestroySelected();
        const requiredForThisAttempt = shredderSelected ? 1 : (enhancementData.required_copies || 3);

        document.getElementById(
            "enhancement-required-count"
        ).textContent =
            group.star >= 6
                ? "최대 성급"
                : `같은 카드 ${requiredForThisAttempt}장 필요`;

        // 선택된 아이템을 반영한 확률 미리보기
        const selectedItemDefs = getSelectedItemDefs();
        const previewRule = baseRule ? computePreviewRule(baseRule, selectedItemDefs) : null;
        setRuleText(previewRule);
        renderSelectedItemsSummary();

        const hasCopies = group.count >= requiredForThisAttempt;
        const hasGold = baseRule
            ? Number(enhancementData.gold) >= Number(baseRule.cost)
            : false;
        const eligible = Boolean(
            enhancement.eligible && hasCopies && hasGold
        );

        submitButton.disabled = !eligible;
        warning.classList.toggle("danger", !eligible);

        if (!baseRule) {
            warning.textContent = "★6 인물은 더 이상 강화할 수 없습니다.";
        } else if (!hasCopies) {
            warning.textContent = `같은 이름 + 같은 성급 인물이 ${requiredForThisAttempt}장 필요합니다.`;
        } else if (!hasGold) {
            warning.textContent =
                `골드가 부족합니다. ${Number(baseRule.cost).toLocaleString()}G가 필요합니다.`;
        } else {
            warning.classList.remove("danger");
            warning.textContent = requiredForThisAttempt === 1
                ? "인물 1장이 소모됩니다."
                : `성공·유지 시 재료 ${requiredForThisAttempt - 1}장, 파괴 시 선택된 ${requiredForThisAttempt}장이 모두 소모됩니다.`;
        }
    }

    function setRuleText(rule) {
        document.getElementById(
            "enhancement-success-rate"
        ).textContent = rule ? `${Math.round(rule.success)}%` : "-";

        document.getElementById(
            "enhancement-maintain-rate"
        ).textContent = rule ? `${Math.round(rule.maintain)}%` : "-";

        document.getElementById(
            "enhancement-destroy-rate"
        ).textContent = rule ? `${Math.round(rule.destroy)}%` : "-";

        document.getElementById(
            "enhancement-cost"
        ).textContent = rule
            ? `${Number(rule.cost).toLocaleString()}G`
            : "-";
    }

    // 선택된 아이템 요약을 "현재/목표" 패널 아래에 작게 보여준다.
    function renderSelectedItemsSummary() {
        const box = document.getElementById("enhancement-selected-items");
        if (!box) return;

        const selectedDefs = getSelectedItemDefs();

        if (selectedDefs.length === 0) {
            box.hidden = true;
            box.innerHTML = "";
            return;
        }

        box.hidden = false;
        box.innerHTML = selectedDefs
            .map((item) => `<span class="enhancement-selected-chip">${escapeHtml(item.name)}</span>`)
            .join("");
    }

    // ── 강화 아이템 선택 모달 ──
    async function openItemModal() {
        const modal = document.getElementById("enhancement-item-modal");
        modal.hidden = false;

        const listEl = document.getElementById("enhancement-item-list");
        listEl.innerHTML = `<p class="enhancement-empty">불러오는 중...</p>`;

        try {
            const res = await fetch(`${API_BASE_URL}/shop/my-items`, { headers: authHeaders() });
            const rows = res.ok ? await res.json() : [];
            myEnhancementItems = rows.filter((row) => row.item_type === "enhancement");
        } catch (error) {
            myEnhancementItems = [];
        }

        renderItemList();
    }

    function renderItemList() {
        const listEl = document.getElementById("enhancement-item-list");
        const emptyEl = document.getElementById("enhancement-item-empty");

        listEl.innerHTML = "";
        emptyEl.hidden = myEnhancementItems.length !== 0;

        // 더 이상 안 가지고 있거나 강화 대상이 바뀌어 사라진 선택은 정리
        selectedItemIds = selectedItemIds.filter((id) =>
            myEnhancementItems.some((item) => item.item_id === id)
        );

        myEnhancementItems.forEach((item) => {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "enhancement-item-row";
            row.classList.toggle("selected", selectedItemIds.includes(item.item_id));
            row.innerHTML = `
                <div class="enhancement-item-row-icon">
                    <img alt="${escapeHtml(item.name)}">
                </div>
                <div class="enhancement-item-row-body">
                    <div class="enhancement-item-row-name">${escapeHtml(item.name)}</div>
                    <div class="enhancement-item-row-effect">${escapeHtml(describeEffect(item))}</div>
                </div>
                <div class="enhancement-item-row-qty">보유 ${item.quantity}</div>
                <div class="enhancement-item-row-check">✓</div>
            `;

            const img = row.querySelector("img");
            img.src = item.icon_file || "";
            img.onerror = () => { img.style.visibility = "hidden"; };

            row.addEventListener("click", () => toggleItemSelection(item.item_id));
            listEl.appendChild(row);
        });
    }

    function toggleItemSelection(itemId) {
        if (selectedItemIds.includes(itemId)) {
            selectedItemIds = selectedItemIds.filter((id) => id !== itemId);
        } else {
            selectedItemIds = [...selectedItemIds, itemId];
        }
        renderItemList();
        renderSelectedCharacter(); // 확률 미리보기 즉시 갱신
    }

    function closeItemModal() {
        document.getElementById("enhancement-item-modal").hidden = true;
    }

    function bindInteractions() {
        document
            .getElementById("enhancement-item-button")
            ?.addEventListener("click", openItemModal);

        document
            .getElementById("enhancement-item-close")
            ?.addEventListener("click", closeItemModal);

        document
            .getElementById("enhancement-item-apply")
            ?.addEventListener("click", closeItemModal);

        document
            .getElementById("enhancement-item-modal")
            ?.addEventListener("click", (event) => {
                if (event.target.id === "enhancement-item-modal") {
                    closeItemModal();
                }
            });

        document
            .getElementById("enhancement-submit-button")
            ?.addEventListener("click", runEnhancement);

        document
            .getElementById("enhancement-result-confirm")
            ?.addEventListener("click", async () => {
                document.getElementById(
                    "enhancement-result-modal"
                ).hidden = true;

                await refreshEnhancementData(selectedCharacter);

                if (typeof loadProfile === "function") {
                    await loadProfile();
                }

                const notifyAchievements = () => {
                    if (typeof showAchievementToast === "function" && pendingAchievements.length) {
                        showAchievementToast(pendingAchievements);
                    }
                    pendingAchievements = [];
                };
                if (typeof showCharacterReveal === "function" && pendingCharacters.length) {
                    showCharacterReveal(pendingCharacters, notifyAchievements);
                } else {
                    notifyAchievements();
                }
                pendingCharacters = [];
            });
    }

    async function runEnhancement() {
        if (!selectedCharacter) return;

        const submitButton = document.getElementById(
            "enhancement-submit-button"
        );

        submitButton.disabled = true;
        submitButton.textContent = "강화 중...";

        try {
            const res = await fetch(
                `${API_BASE_URL}/characters/enhance`,
                {
                    method: "POST",
                    headers: authHeaders(true),
                    body: JSON.stringify({
                        character_name: selectedCharacter.name,
                        star: selectedCharacter.star,
                        item_ids: selectedItemIds,
                    }),
                }
            );

            const body = await res.json().catch(() => ({}));

            if (!res.ok) {
                throw new Error(
                    body.detail || "강화에 실패했습니다."
                );
            }

            selectedItemIds = []; // 사용한 아이템은 소모됐으니 선택 초기화
            pendingAchievements = body.new_achievements || [];
            pendingCharacters = body.new_characters || [];
            showResultModal(body);
        } catch (error) {
            showResultModal({
                outcome: "destroy",
                message: error.message,
                is_error: true,
            });
        } finally {
            submitButton.textContent = "강화하기";
            submitButton.disabled = false;
        }
    }

    function showResultModal(result) {
        const modal = document.getElementById(
            "enhancement-result-modal"
        );
        const box = modal.querySelector(
            ".enhancement-result-box"
        );
        const title = document.getElementById(
            "enhancement-result-title"
        );
        const message = document.getElementById(
            "enhancement-result-message"
        );
        const emblem = document.getElementById(
            "enhancement-result-emblem"
        );

        box.classList.remove("success", "maintain", "destroy");
        box.classList.add(result.outcome || "destroy");

        if (result.is_error) {
            title.textContent = "강화 불가";
            emblem.textContent = "!";
        } else if (result.outcome === "success") {
            title.textContent = "강화 성공!";
            emblem.textContent = "★";
        } else if (result.outcome === "maintain") {
            title.textContent = "강화 유지";
            emblem.textContent = "◇";
        } else {
            title.textContent = "강화 실패";
            emblem.textContent = "✕";
        }

        let text = result.message || "결과를 확인할 수 없습니다.";
        if (result.used_items && result.used_items.length > 0) {
            text += ` (사용한 아이템: ${result.used_items.join(", ")})`;
        }
        message.textContent = text;
        modal.hidden = false;
    }

    function closeInnerModals() {
        const itemModal = document.getElementById(
            "enhancement-item-modal"
        );
        const resultModal = document.getElementById(
            "enhancement-result-modal"
        );

        if (itemModal) itemModal.hidden = true;
        if (resultModal) resultModal.hidden = true;
    }

    openButton?.addEventListener("click", async () => {
        try {
            await ensureLoaded();

            if (loaded) {
                closeInnerModals();
                selectedItemIds = [];
                await refreshEnhancementData(selectedCharacter);
            }
        } catch (error) {
            contentEl.innerHTML =
                `<p class="enhancement-empty">${escapeHtml(error.message)}</p>`;
        }
    });

    modalEl
        ?.querySelector("[data-modal-close]")
        ?.addEventListener("click", closeInnerModals);
})();