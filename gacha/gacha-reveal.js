// 캐릭터 획득 연출(가챠 뽑기/포인트 모집/업적 보상 등 어디서 획득했든 공통). 획득한 곳에서
// window.showCharacterReveal(characters, onClose)를 호출해서 띄운다. 이 파일은 호출부와 별개로 동작 -
// 호출부가 이 파일 내부를 몰라도 되고, 이 파일도 호출부 내부를 몰라도 됨.
// characters: [{ id, name, rarity, job_class, description, outfit, gender, attack_type, defense_type,
//                skill_name, trait_name, is_pickup, is_duplicate }, ...]
// 같은 이름의 캐릭터가 여러 장 섞여 있으면 이름 기준으로 중복 제거해서 한 번만 보여주고,
// 서로 다른 캐릭터가 여러 명이면 큐에 쌓아뒀다가 하나씩(빈 화면 클릭 또는 "장착하기" 클릭 시) 순차 재생한다.
(function () {
    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;

    const DOORS_CLOSE_MS = 500;     // 1. 문 닫히는 시간
    const DOORS_OPEN_MS = 800;      // 2~3. 문 열리며 캐릭터 커지는 시간
    const GAP_BEFORE_OPEN_MS = 400; // 문 다 닫히고 나서, 열리기 시작하기 전까지의 정적 대기시간
    const WAIT_AFTER_OPEN_MS = 500; // 문 다 열리고 나서 대기 시간

    let overlayEl = null;
    let timers = [];
    let skipped = false;
    let showing = false;
    const queue = [];               // { character, onCloseIfLast }
    let currentOnCloseIfLast = null;

    function authHeaders() {
        const token = localStorage.getItem("access_token");
        return token ? { "Authorization": `Bearer ${token}` } : {};
    }

    function clearTimers() {
        timers.forEach(clearTimeout);
        timers = [];
    }

    const TYPE_LABELS = { Teacher: "교사", Parent: "부모", Student: "학생" };

    function buildOverlay() {
        const el = document.createElement("div");
        el.id = "gacha-reveal-overlay";
        el.className = "gacha-reveal-overlay";
        el.innerHTML = `
            <div class="reveal-door reveal-door-left"></div>
            <div class="reveal-door reveal-door-right"></div>
            <div class="reveal-stage">
                <div class="reveal-bg" id="reveal-bg"></div>
                <div class="reveal-character-wrap">
                    <div class="reveal-character-glow" id="reveal-character-glow"></div>
                    <img class="reveal-character-img" id="reveal-character-img" src="" alt="">
                </div>
            </div>
            <div class="reveal-side-panel">
                <div class="reveal-info-row">
                    <div class="reveal-info-label">희귀도</div>
                    <div class="reveal-info-value" id="reveal-rarity-value"></div>
                </div>
                <div class="reveal-info-row">
                    <div class="reveal-info-label">직업</div>
                    <div class="reveal-info-value" id="reveal-job-value"></div>
                </div>
                <div class="reveal-info-row">
                    <div class="reveal-info-label">성별</div>
                    <div class="reveal-info-value" id="reveal-gender-value"></div>
                </div>
                <div class="reveal-info-row">
                    <div class="reveal-info-label">공격 타입</div>
                    <div class="reveal-info-value" id="reveal-attack-type-value"></div>
                </div>
                <div class="reveal-info-row">
                    <div class="reveal-info-label">방어 타입</div>
                    <div class="reveal-info-value" id="reveal-defense-type-value"></div>
                </div>
                <div class="reveal-info-row">
                    <div class="reveal-info-label">스킬</div>
                    <div class="reveal-info-value" id="reveal-skill-value"></div>
                </div>
                <div class="reveal-info-row">
                    <div class="reveal-info-label">특성</div>
                    <div class="reveal-info-value" id="reveal-trait-value"></div>
                </div>
                <button class="reveal-equip-btn" id="reveal-equip-btn">장착하기</button>
            </div>
            <div class="reveal-bottom-panel">
                <div class="reveal-name-block">
                    <div class="reveal-tags" id="reveal-tags"></div>
                    <div class="reveal-name" id="reveal-name"></div>
                </div>
                <div class="reveal-desc-box">
                    <div class="reveal-desc" id="reveal-desc"></div>
                </div>
            </div>
            <button class="reveal-skip-btn" id="reveal-skip-btn">SKIP ▸▸</button>
        `;
        document.body.appendChild(el);
        return el;
    }

    function getOverlay() {
        if (!overlayEl) overlayEl = buildOverlay();
        return overlayEl;
    }

    // 스타일 변경을 한 프레임 확실히 "그려지게" 한 다음에 콜백을 실행한다.
    // rAF 하나만 쓰면 브라우저가 같은 프레임에 여러 변경을 합쳐버려 트랜지션이 씹힐 수 있어서,
    // 두 번 중첩해서 "이전 상태가 실제로 페인트된 다음"을 보장한다.
    function nextPaint(callback) {
        requestAnimationFrame(() => requestAnimationFrame(callback));
    }

    // ── 5. 연출 도중 클릭하면 즉시 최종 상태로 점프 ──────────────────
    function skipToEnd(overlay) {
        if (skipped) return;
        skipped = true;
        clearTimers();
        overlay.classList.add("no-transition");
        overlay.classList.add("doors-closed", "doors-open", "slide-left", "panels-shown");
        nextPaint(() => overlay.classList.remove("no-transition"));
    }

    // ── 6. 최종 화면에서 클릭(또는 장착하기)하면 다음 캐릭터로 넘어가거나, 큐가 비었으면 완전히 닫힌다 ──
    // (이번 배치의 마지막 캐릭터였다면, 그 배치를 요청할 때 넘겨받은 onClose를 여기서 실행한다 - 예를 들어
    // 뽑기와 함께 새로 달성한 업적이 있으면, 이 연출을 다 본 뒤에야 업적 알림이 뜨도록 넘겨받은 콜백.)
    function closeReveal(overlay) {
        const callback = currentOnCloseIfLast;
        currentOnCloseIfLast = null;
        if (callback) callback();

        if (queue.length > 0) {
            playNextInQueue(overlay);
        } else {
            overlay.classList.remove("open");
            showing = false;
        }
    }

    async function handleEquip(overlay, characterId) {
        const equipBtn = overlay.querySelector("#reveal-equip-btn");
        if (!characterId) {
            alert("이 캐릭터는 장착할 수 없어요 (id를 못 찾음).");
            return;
        }
        equipBtn.disabled = true;
        try {
            const res = await fetch(`${API_BASE_URL}/characters/equip`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ character_id: characterId })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.detail || "장착에 실패했어요.");
                equipBtn.disabled = false;
                return;
            }
            if (typeof loadProfile === "function") loadProfile();
            closeReveal(overlay);
        } catch (err) {
            alert("서버에 연결할 수 없어요.");
            equipBtn.disabled = false;
        }
    }

    // 신규/중복(NEW! 또는 중복)과 픽업 여부(PICK UP!)를 서로 독립적으로 판단해서 조합한다.
    function renderTags(overlay, isPickup, isDuplicate) {
        const tagsEl = overlay.querySelector("#reveal-tags");
        tagsEl.innerHTML = "";

        if (isDuplicate) {
            const dup = document.createElement("span");
            dup.className = "reveal-tag reveal-tag-duplicate";
            dup.textContent = "중복";
            tagsEl.appendChild(dup);
        } else {
            const newTag = document.createElement("span");
            newTag.className = "reveal-tag reveal-tag-shine";
            newTag.textContent = "✨ NEW! ✨";
            tagsEl.appendChild(newTag);
        }

        // 픽업이면 신규든 중복이든 상관없이 PICK UP!을 추가로 붙인다.
        // (상시모집에서 뽑았을 땐 배너별 필터링 덕분에 isPickup이 항상 false로 넘어와서 자동으로 안 붙음)
        if (isPickup) {
            const pickupTag = document.createElement("span");
            pickupTag.className = "reveal-tag reveal-tag-shine";
            pickupTag.textContent = "✨ PICK UP! ✨";
            tagsEl.appendChild(pickupTag);
        }
    }

    // character: { id, name, rarity, job_class, description, outfit, gender, attack_type, defense_type,
    //              skill_name, trait_name, is_pickup, is_duplicate }
    function playReveal(overlay, character) {
        skipped = false;
        clearTimers();

        // 상태를 "문 닫히기 전" 초기 모습으로 순간 리셋 (트랜지션 없이)
        overlay.className = "gacha-reveal-overlay open no-transition";

        overlay.querySelector("#reveal-bg").className = `reveal-bg rarity-${character.rarity}`;
        overlay.querySelector("#reveal-character-glow").className = `reveal-character-glow rarity-${character.rarity}`;
        overlay.querySelector("#reveal-character-img").className = `reveal-character-img rarity-${character.rarity}`;
        overlay.querySelector("#reveal-character-img").src = `${OUTFIT_IMAGE_BASE}${character.outfit}/idle.png`;
        overlay.querySelector("#reveal-rarity-value").textContent = character.rarity;
        overlay.querySelector("#reveal-job-value").textContent = character.job_class || "-";
        overlay.querySelector("#reveal-gender-value").textContent = character.gender || "-";
        overlay.querySelector("#reveal-attack-type-value").textContent = TYPE_LABELS[character.attack_type] || character.attack_type || "-";
        overlay.querySelector("#reveal-defense-type-value").textContent = TYPE_LABELS[character.defense_type] || character.defense_type || "-";
        overlay.querySelector("#reveal-skill-value").textContent = character.skill_name || "없음";
        overlay.querySelector("#reveal-trait-value").textContent = character.trait_name || "없음";
        overlay.querySelector("#reveal-name").textContent = character.name;
        overlay.querySelector("#reveal-desc").textContent = character.description || "";
        renderTags(overlay, character.is_pickup, character.is_duplicate);

        const equipBtn = overlay.querySelector("#reveal-equip-btn");
        equipBtn.disabled = false;
        equipBtn.textContent = "장착하기";
        equipBtn.onclick = (e) => {
            e.stopPropagation();
            handleEquip(overlay, character.id);
        };

        overlay.onclick = () => {
            if (!overlay.classList.contains("panels-shown")) {
                skipToEnd(overlay);
            } else {
                closeReveal(overlay);
            }
        };
        overlay.querySelector("#reveal-skip-btn").onclick = (e) => {
            e.stopPropagation();
            skipToEnd(overlay);
        };

        // ── 실제 연출 시퀀스 시작 ──
        // no-transition을 확실히 "한 프레임 그려진 뒤"에 떼어내고, 그 다음 프레임에 doors-closed를 붙여야
        // 브라우저가 "off-screen(트랜지션 꺼짐) -> off-screen(트랜지션 켜짐) -> center(트랜지션 켜짐)" 순서를
        // 각각 별도 프레임으로 인식해서 애니메이션이 확실히 재생된다.
        nextPaint(() => {
            overlay.classList.remove("no-transition");
            nextPaint(() => {
                // 1. 문 닫힘
                overlay.classList.add("doors-closed");

                timers.push(setTimeout(() => {
                    // 2~3. 문 열림 + 캐릭터 확대 (문 다 닫히고 나서 잠깐 정적을 두고 시작)
                    timers.push(setTimeout(() => {
                        overlay.classList.add("doors-open");

                        timers.push(setTimeout(() => {
                            // 4. 캐릭터 슬라이드 + 패널 등장
                            overlay.classList.add("slide-left", "panels-shown");
                        }, DOORS_OPEN_MS + WAIT_AFTER_OPEN_MS));
                    }, GAP_BEFORE_OPEN_MS));
                }, DOORS_CLOSE_MS));
            });
        });
    }

    function playNextInQueue(overlay) {
        const { character, onCloseIfLast } = queue.shift();
        currentOnCloseIfLast = onCloseIfLast;
        playReveal(overlay, character);
    }

    // 같은 이름의 캐릭터가 여러 장 섞여 있으면(예: 업적 보상으로 같은 캐릭터를 quantity>1 받은 경우)
    // 이름 기준으로 첫 번째 것만 남기고 나머지는 버려서, 연출이 "한 번만" 재생되게 한다.
    function dedupeByName(characters) {
        const seen = new Set();
        const result = [];
        (characters || []).forEach((c) => {
            if (!c || seen.has(c.name)) return;
            seen.add(c.name);
            result.push(c);
        });
        return result;
    }

    // characters: 획득한 캐릭터 목록(배열). onClose(선택): 이 배치를 전부 다 보고 닫은 뒤에 실행할 콜백
    // (업적 알림처럼, 획득 연출과 안 겹치게 미뤄야 하는 것들).
    window.showCharacterReveal = function (characters, onClose) {
        const list = dedupeByName(characters);
        if (list.length === 0) {
            if (onClose) onClose();
            return;
        }

        list.forEach((character, i) => {
            queue.push({ character, onCloseIfLast: i === list.length - 1 ? (onClose || null) : null });
        });

        if (!showing) {
            showing = true;
            playNextInQueue(getOverlay());
        }
    };
})();