// 가챠 전용 로직. home.js는 이 파일의 존재를 몰라도 됨 -
// home.js는 그냥 "modal-gacha를 열고 닫는다"만 알고, 안에 뭐가 들어있는지는 신경 안 씀.

(function () {
    const GACHA_PARTIAL_URL = "gacha/gacha-partial.html"; // gacha.js는 gacha/ 폴더에 있지만, fetch는 이 스크립트를 실행하는 home.html(루트) 기준으로 경로를 찾음

    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;

    const contentEl = document.getElementById("gacha-content");

    let loaded = false;
    let loading = false;
    let banners = [];
    let currentBannerId = null;
    let pickupButtons = []; // { btn, pickupId, cost, purchased }

    function authHeaders() {
        const token = localStorage.getItem("access_token");
        return token ? { "Authorization": `Bearer ${token}` } : {};
    }

    async function loadGachaPartial() {
        if (loaded || loading || !contentEl) return;
        loading = true;

        try {
            const res = await fetch(GACHA_PARTIAL_URL);
            if (!res.ok) throw new Error(`${res.status}`);
            contentEl.innerHTML = await res.text();
            loaded = true;
            await initGachaInteractions();
        } catch (err) {
            contentEl.innerHTML = `<p class="screen-placeholder">가챠 화면을 불러오지 못했어요. (${err.message})</p>`;
            loaded = false;
        } finally {
            loading = false;
        }
    }

    async function initGachaInteractions() {
        setupPullButton();
        setupCharacterSelectNav();
        setupRateInfoModal();
        await Promise.all([loadBanners(), loadPoints()]);
    }

    // ── 배너 불러오기 & 렌더링 ─────────────────────────────────
    async function loadBanners() {
        const carouselEl = contentEl.querySelector("#gacha-banner-carousel");
        try {
            const res = await fetch(`${API_BASE_URL}/gacha/banners`);
            if (!res.ok) throw new Error(`${res.status}`);
            banners = await res.json();
        } catch (err) {
            carouselEl.innerHTML = `<p class="screen-placeholder">배너를 불러오지 못했어요. (${err.message})</p>`;
            return;
        }

        if (banners.length === 0) {
            carouselEl.innerHTML = `<p class="screen-placeholder">지금 열려있는 배너가 없어요.</p>`;
            return;
        }

        carouselEl.innerHTML = "";
        banners.forEach((banner) => {
            const btn = document.createElement("button");
            btn.className = "banner-thumb";
            btn.dataset.bannerId = banner.id;

            const img = document.createElement("img");
            img.src = `assets/gacha/${banner.image_file}`;
            img.alt = banner.name;
            img.onerror = () => { img.style.display = "none"; };
            btn.appendChild(img);

            btn.addEventListener("click", () => selectBanner(banner.id));
            carouselEl.appendChild(btn);
        });

        selectBanner(banners[0].id);
    }

    function selectBanner(bannerId) {
        currentBannerId = bannerId;
        const banner = banners.find((b) => b.id === bannerId);
        if (!banner) return;

        contentEl.querySelectorAll(".banner-thumb").forEach((t) => {
            t.classList.toggle("active", Number(t.dataset.bannerId) === bannerId);
        });

        contentEl.querySelector("#gacha-title").textContent = banner.name;
        contentEl.querySelector("#gacha-period-text").textContent = formatPeriodText(banner);

        const rateTextEl = contentEl.querySelector("#gacha-pickup-rate-text");
        if (banner.banner_type === "pickup" && banner.pickups && banner.pickups.length > 0) {
            const names = banner.pickups.map((p) => p.character_name).join(", ");
            rateTextEl.textContent = `${names} 모집 확률 UP!`;
            rateTextEl.hidden = false;
        } else {
            rateTextEl.hidden = true;
        }

        renderPickupList(banner);
    }

    function formatPeriodText(banner) {
        if (banner.banner_type === "standard") return "언제든지 환영! 상시 OPEN 하고 있는 상시 모집을 통해 당신만의 운명을 시험해 봐요!";
        if (!banner.start_date || !banner.end_date) return "기간 미정";

        const fmt = (iso) => new Date(iso).toLocaleString("ko-KR", {
            year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
        });
        return `${fmt(banner.start_date)} ~ ${fmt(banner.end_date)}까지`;
    }

    // ── 모집 포인트 초기값 불러오기 (/users/me) ───────────────────
    async function loadPoints() {
        const pointValueEl = contentEl.querySelector("#gacha-point-value");
        try {
            const res = await fetch(`${API_BASE_URL}/users/me`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`${res.status}`);
            const data = await res.json();
            pointValueEl.textContent = data.user_info.gacha_points;
        } catch (err) {
            pointValueEl.textContent = "?";
        }
    }

    function setPoints(value) {
        const pointValueEl = contentEl.querySelector("#gacha-point-value");
        pointValueEl.textContent = value;
        refreshPickupButtons(value);
    }

    // ── 모집 버튼: 실제 /gacha/ 뽑기 API 호출 ──────────────────────
    function setupPullButton() {
        const pullBtn = contentEl.querySelector("#gacha-pull-btn");

        pullBtn?.addEventListener("click", async () => {
            pullBtn.disabled = true;
            try {
                const url = currentBannerId
                    ? `${API_BASE_URL}/gacha/?banner_id=${currentBannerId}`
                    : `${API_BASE_URL}/gacha/`;
                const res = await fetch(url, {
                    method: "POST",
                    headers: authHeaders()
                });
                const data = await res.json();

                if (!res.ok) {
                    alert(data.detail || "모집에 실패했어요.");
                    return;
                }

                setPoints(data.gacha_points);

                // 골드가 서버에서 이미 차감됐으니, 연출을 어떻게 닫든(빈 공간 클릭/장착하기) 상관없이
                // 홈 화면 골드 표시가 항상 즉시 최신 상태가 되도록 여기서 바로 갱신해준다.
                if (typeof loadProfile === "function") loadProfile();

                // gacha-reveal.js가 전역에 노출해둔 함수. 문 열림/캐릭터 등장 연출을 담당.
                // 업적 알림은 그 연출을 다 보고 닫은 뒤에 뜨도록 onClose로 넘긴다.
                const notifyAchievements = () => {
                    if (typeof showAchievementToast === "function" && data.new_achievements?.length) {
                        showAchievementToast(data.new_achievements);
                    }
                };
                // 이번에 뽑은 캐릭터 + 이 뽑기로 새로 달성한 업적이 캐릭터를 보상으로 줬다면 그것도 이어서 순차 재생.
                const revealCharacters = [
                    { ...data.character, is_pickup: data.is_pickup, is_duplicate: data.is_duplicate },
                    ...(data.new_characters || []),
                ];
                if (typeof showCharacterReveal === "function") {
                    showCharacterReveal(revealCharacters, notifyAchievements);
                } else {
                    alert(`모집 완료! ${data.character.name} [${data.character.rarity}] 획득!`);
                    notifyAchievements();
                }
            } catch (err) {
                alert("서버에 연결할 수 없어요. 서버가 켜져 있는지 확인하세요.");
            } finally {
                pullBtn.disabled = false;
            }
        });
    }

    // ── 인물 선택 뷰 전환 ─────────────────────────────────────
    function setupCharacterSelectNav() {
        const mainView = contentEl.querySelector("#gacha-main-view");
        const selectView = contentEl.querySelector("#gacha-select-view");
        const openBtn = contentEl.querySelector("#gacha-select-open-btn");
        const backBtn = contentEl.querySelector("#gacha-select-back-btn");

        openBtn?.addEventListener("click", () => {
            mainView.hidden = true;
            selectView.hidden = false;
        });

        backBtn?.addEventListener("click", () => {
            selectView.hidden = true;
            mainView.hidden = false;
        });
    }

    const RARITY_ORDER = ["신화", "전설", "영웅", "희귀", "일반"];

    // ── i버튼: 지금 선택된 배너 기준 캐릭터별 실제 획득 확률(소수점 5자리)을 모달로 보여준다 ──
    function setupRateInfoModal() {
        const modal = contentEl.querySelector("#gacha-rate-modal");
        const infoBtn = contentEl.querySelector("#gacha-rate-info-btn");
        const closeBtn = contentEl.querySelector("#gacha-rate-modal-close");
        if (!modal || !infoBtn) return;

        infoBtn.addEventListener("click", async () => {
            modal.hidden = false;
            await loadAndRenderRates();
        });

        closeBtn?.addEventListener("click", () => { modal.hidden = true; });
        modal.addEventListener("click", (event) => {
            if (event.target === modal) modal.hidden = true;
        });
    }

    async function loadAndRenderRates() {
        const listEl = contentEl.querySelector("#gacha-rate-list");
        const noticeEl = contentEl.querySelector("#gacha-rate-pickup-notice");
        if (!listEl) return;

        listEl.innerHTML = `<p class="screen-placeholder">불러오는 중...</p>`;
        try {
            const url = currentBannerId
                ? `${API_BASE_URL}/gacha/rates?banner_id=${currentBannerId}`
                : `${API_BASE_URL}/gacha/rates`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${res.status}`);
            const data = await res.json();

            noticeEl.hidden = !data.is_pickup_banner;

            listEl.innerHTML = "";
            RARITY_ORDER.forEach((rarityName) => {
                const group = data.rarities.find((r) => r.rarity === rarityName);
                if (!group) return;

                const groupEl = document.createElement("div");
                groupEl.className = "gacha-rate-group";
                groupEl.innerHTML = `
                    <div class="gacha-rate-group-title">
                        <span>${group.rarity}</span>
                        <span>${group.tier_probability_percent.toFixed(5)}%</span>
                    </div>
                `;

                group.characters.forEach((c) => {
                    const rowEl = document.createElement("div");
                    rowEl.className = `gacha-rate-row${c.is_pickup ? " is-pickup" : ""}`;
                    rowEl.innerHTML = `<span>${c.name}${c.is_pickup ? " (PICK UP)" : ""}</span><span>${c.percent.toFixed(5)}%</span>`;
                    groupEl.appendChild(rowEl);
                });

                listEl.appendChild(groupEl);
            });
        } catch (err) {
            listEl.innerHTML = `<p class="screen-placeholder">확률 정보를 불러오지 못했어요. (${err.message})</p>`;
        }
    }

    // ── 인물 선택 카드 렌더링 (선택된 배너의 실제 픽업 목록) ──────────
    function renderPickupList(banner) {
        const listEl = contentEl.querySelector("#gacha-pickup-list");
        if (!listEl) return;

        listEl.innerHTML = "";
        pickupButtons = [];

        if (!banner.pickups || banner.pickups.length === 0) {
            listEl.innerHTML = `<p class="screen-placeholder">이 배너엔 포인트로 선택할 수 있는 인물이 없어요.</p>`;
            return;
        }

        banner.pickups.forEach((pickup) => {
            const card = document.createElement("div");
            card.className = "gacha-pickup-card";
            card.innerHTML = `
                <div class="gacha-pickup-top">
                    <div class="gacha-pickup-photo-frame">
                        <img class="gacha-pickup-photo" src="${pickup.outfit ? OUTFIT_IMAGE_BASE + pickup.outfit + '/idle.png' : ''}"
                             alt="${pickup.character_name}" onerror="this.removeAttribute('src');this.style.background='#ddd';">
                    </div>
                    <div class="gacha-pickup-info">
                        <div class="gacha-pickup-name">${pickup.character_name}</div>
                        <div class="gacha-pickup-desc">${pickup.description || ""}</div>
                    </div>
                </div>
                <button class="gacha-pickup-recruit-btn">모집 (${pickup.point_cost} 포인트)</button>
            `;

            const recruitBtn = card.querySelector(".gacha-pickup-recruit-btn");
            const entry = { btn: recruitBtn, pickupId: pickup.pickup_id, cost: pickup.point_cost, purchased: false };
            pickupButtons.push(entry);

            // 로비 프로필과 같은 크롭 설정(home.js에 정의됨)을 재사용하되,
            // 칸이 더 작아서(64px vs 150px) scale에 보정 배율을 곱해 살짝 덜 확대되게 함
            const photoImg = card.querySelector(".gacha-pickup-photo");
            const crop = (pickup.outfit && AVATAR_CROP_OVERRIDES[pickup.outfit]) || DEFAULT_AVATAR_CROP;
            const GACHA_SCALE_ADJUST = 0.8; // 이 숫자만 조정하면 됨 (작을수록 덜 확대)
            const gachaScale = crop.scale ? crop.scale * GACHA_SCALE_ADJUST : 1;
            photoImg.style.objectFit = "cover";
            photoImg.style.objectPosition = `${crop.xPercent}% ${crop.yPercent}%`;
            photoImg.style.transform = `scale(${gachaScale})`;
            photoImg.style.transformOrigin = `${crop.xPercent}% ${crop.yPercent}%`;

            recruitBtn.addEventListener("click", () => selectPickupCharacter(entry, pickup.character_name));

            listEl.appendChild(card);
        });

        const currentPoints = Number(contentEl.querySelector("#gacha-point-value").textContent) || 0;
        refreshPickupButtons(currentPoints);
    }

    async function selectPickupCharacter(entry, characterName) {
        entry.btn.disabled = true;
        try {
            const res = await fetch(`${API_BASE_URL}/gacha/select`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ pickup_id: entry.pickupId })
            });
            const data = await res.json();

            if (!res.ok) {
                alert(data.detail || "선택에 실패했어요.");
                entry.btn.disabled = false;
                return;
            }

            entry.purchased = true;
            entry.btn.textContent = "선택 완료";
            setPoints(data.left_points);
            if (typeof loadProfile === "function") loadProfile();

            const notifyAchievements = () => {
                if (typeof showAchievementToast === "function" && data.new_achievements?.length) {
                    showAchievementToast(data.new_achievements);
                }
            };
            const revealCharacters = [
                { ...data.character, is_pickup: true, is_duplicate: data.is_duplicate },
                ...(data.new_characters || []),
            ];
            if (typeof showCharacterReveal === "function") {
                showCharacterReveal(revealCharacters, notifyAchievements);
            } else {
                alert(data.message);
                notifyAchievements();
            }
        } catch (err) {
            alert("서버에 연결할 수 없어요. 서버가 켜져 있는지 확인하세요.");
            entry.btn.disabled = false;
        }
    }

    // 현재 보유 포인트를 기준으로 각 인물 선택 버튼을 켜고 끈다.
    function refreshPickupButtons(currentPoints) {
        pickupButtons.forEach(({ btn, cost, purchased }) => {
            if (purchased) {
                btn.disabled = true;
                return;
            }
            btn.disabled = currentPoints < cost;
        });
    }

    // 가챠 모달을 여는 모든 버튼에, 처음 눌렸을 때만 파셜을 불러오는 리스너를 건다.
    document.querySelectorAll('[data-modal-target="modal-gacha"]').forEach((btn) => {
        btn.addEventListener("click", loadGachaPartial);
    });
})();