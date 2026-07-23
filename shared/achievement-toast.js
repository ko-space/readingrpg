(function () {
    let overlayEl = null;
    const queue = [];
    let showing = false;

    function ensureOverlay() {
        if (overlayEl) return overlayEl;

        overlayEl = document.createElement("div");
        overlayEl.className = "ach-toast-overlay";
        overlayEl.hidden = true;
        overlayEl.innerHTML = `
            <div class="ach-toast-box">
                <div class="ach-toast-banner">업적 달성!</div>
                <div class="ach-toast-icon">
                    <img src="assets/icons/trophy.png" alt="" onerror="this.outerHTML='🏆'">
                </div>
                <div class="ach-toast-name" id="ach-toast-name">-</div>
                <p class="ach-toast-desc" id="ach-toast-desc"></p>
                <div class="ach-toast-reward" id="ach-toast-reward"></div>
                <button class="ach-toast-confirm" id="ach-toast-confirm" type="button">확인</button>
            </div>
        `;
        document.body.appendChild(overlayEl);

        overlayEl.querySelector("#ach-toast-confirm").addEventListener("click", closeCurrent);
        overlayEl.addEventListener("click", (event) => {
            if (event.target === overlayEl) closeCurrent();
        });

        return overlayEl;
    }

    function describeReward(ach) {
        const parts = [];
        if (ach.reward_gold) parts.push(`골드 ${Number(ach.reward_gold).toLocaleString()}`);
        if (ach.reward_exp) parts.push(`EXP ${Number(ach.reward_exp).toLocaleString()}`);
        (ach.reward_items || []).forEach((item) => {
            parts.push(`${item.name} x${item.quantity || 1}`);
        });
        return parts.length ? `보상: ${parts.join(" · ")}` : "";
    }

    function showNext() {
        if (queue.length === 0) {
            showing = false;
            return;
        }
        showing = true;

        const ach = queue.shift();
        const overlay = ensureOverlay();
        const box = overlay.querySelector(".ach-toast-box");

        overlay.querySelector("#ach-toast-name").textContent = ach.name;
        overlay.querySelector("#ach-toast-desc").textContent = ach.description || "";
        overlay.querySelector("#ach-toast-reward").textContent = describeReward(ach);
        box.classList.toggle("ach-toast-hidden-glow", !!ach.is_hidden);

        overlay.hidden = false;
        // 재생 중 다시 열릴 때도 등장 애니메이션이 매번 다시 보이도록 클래스를 리셋한다.
        box.classList.remove("ach-toast-enter");
        void box.offsetWidth;
        box.classList.add("ach-toast-enter");
    }

    function closeCurrent() {
        if (overlayEl) overlayEl.hidden = true;
        showNext();
    }

    window.showAchievementToast = function showAchievementToast(achievements) {
        if (!achievements || achievements.length === 0) return;
        queue.push(...achievements);
        if (!showing) showNext();
    };
})();
