// arena-battle.js

(function () {
    "use strict";

    const raw = sessionStorage.getItem("pvp_battle_result");
    const data = raw ? JSON.parse(raw) : null;
    const battleScreen = document.querySelector(".battle-screen");

    if (!data) {
        const loadingOverlay = document.getElementById("battle-loading-overlay");
        if (loadingOverlay) loadingOverlay.hidden = true; // 입장 데이터가 없으면 암전 화면을 계속 띄워둘 이유가 없다
        if (battleScreen) {
            battleScreen.innerHTML =
                `<p class="screen-placeholder" style="padding:40px;text-align:center;">
                    전투 데이터를 찾을 수 없어요. 투기장에서 '전투'를 눌러야 이 창이 정상적으로 열려요.
                </p>`;
        }
        return;
    }

    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;

    const PLAYBACK_SPEED = 0.8;
    const PREP_MS = 1300;
    const BATTLE_ENTRANCE_MS = 4000;
    const BATTLE_ENTRANCE_DOT_MS = 450;
    // 나중에 계속 추가할 예정 - 우선 몇 개만 채워둔 것.
    const BATTLE_TIPS = [
        "전방 유닛이 쓰러지면 후방 유닛이 앞으로 올라와 그 자리를 대신합니다.",
        "근접 캐릭터는 상대 유닛과 맞닿아야 기본 공격을 시작합니다.",
        "같은 원인으로 다시 걸린 상태 효과는 중첩되지 않고 지속시간만 갱신됩니다.",
        "치명타가 적중할 확률은 매우 낮습니다.",
        "스토리모드에서 인물이 등장하는 장소에 집중하세요.",
        "강화 도움 아이템을 종류별로 사용하여 확률을 높이세요.",
        "강희의 파쇄기 아이템을 사용하면 1장으로도 강화가 가능합니다.",
        "방어타입과 공격타입을 고려해서 투기장 경기를 진행하세요.",
        "원거리 캐릭터는 근거리 캐릭터에 비해 공격력이 높습니다.",
        "근거리 캐릭터는 원거리 캐릭터에 비해 체력이 높습니다.",
        "캐릭터의 성별에 따라 투기장에서 전략적 플레이가 가능합니다.",
        "후방에 원거리 캐릭터를 배치하면 좋습니다.",
        "전방에 근거리 캐릭터를 배치하면 좋습니다.",
        "인물의 HP 위에 인물의 상태가 표시됩니다.",
        "붉은색 상태 아이콘은 버프를 의미합니다.",
        "푸른색 상태 아이콘은 디버프를 의미합니다.",
        "보라색 상태 아이콘은 CC기를 의미합니다.",
        "초록색 상태 아이콘은 회복을 의미합니다.",
        "회색 상태 아이콘은 뭘까요?",
        "히든 업적의 해금조건은 알 수 없지만, 진행 상황은 알 수 있습니다.",
        "스토리모드 티켓은 하루에 5개밖에 구매하지 못합니다.",
        "캐릭터별로 지역 입장에서의 능력이 다릅니다.",
        "스토리모드 앤딩에는 히든 앤딩이 존재합니다.",
        "히든 업적 달성 보상을 얻기 위해 히든 업적을 달성해보세요.",
        "ester CAD라는 비밀 조직이 존재합니다.",
        "캐릭터 5성 달성시 투기장 고유 스킬이 추가됩니다.",
        "6성 캐릭터는 무지막지하게 강력합니다.",
        "10레벨이 되는데 4500이상의 exp가 필요합니다.",
        "5성 -> 6성 강화를 아이템 없이 시도해볼까요?",
    ];
    const APPROACH_OVERLAP = 100;
    const PROJECTILE_TRAVEL_MS = 220;
    const MAX_ATTACK_FRAMES = 6;
    const MAX_SKILL_FRAMES = 9; // 스킬 시전 전용 사진은 캐릭터당 총 9장까지 넣기로 확정됨
    const ATTACK_FRAME_DURATION_MS = 60;
    const EFFECT_LAUNCH_DELAY_MS = ATTACK_FRAME_DURATION_MS * 3; // 원거리 공격: 애니메이션 3프레임쯤 재생된 뒤 이펙트 발사

    // 원거리 5명 전용 기본공격 연출. 여기 없는(=근거리이거나 목록에 없는) 캐릭터는 기존 직선 투사체 그대로.
    const RANGED_ATTACK_STYLE = {
        "윤대웅": "instant_flash",   // 카메라 셔터 플래시 - 투사체 이동 없음
        "김남옥": "crayon",          // 원통형 크레파스 다트 - 포물선, 대상이 전방이면 진분홍/후방이면 푸른색
        "이종복": "text_particles",  // F/=/m/a 네 글자 순차 발사 - 직선
        "임소정": "electric",        // 캐스터-대상을 잠깐 잇는 푸른 전기
        "서민석": "book",            // 책 던지기 - 포물선, 계속 회전
    };

    // 캐릭터별 성별 - 서민석 스킬(하트 색)처럼 대상 성별에 따라 연출이 갈리는 경우에 쓴다.
    const CHARACTER_GENDER = {
        "윤대웅": "남", "윤영준": "남", "김남옥": "여", "이종복": "남", "임소정": "여",
        "이영웅": "남", "불빠따 김어진": "남", "서민석": "남", "강승유": "남",
        "송주헌": "남", "최재혁": "남", "청년": "남", "강 희": "여",
    };

    // 스킬 발동(skill_resolve) 시 어떤 카테고리 연출을 입힐지 - 캐릭터 고유 연출은 devtest.css에서 다듬는다.
    const SKILL_VFX_CATEGORY = {
        self_stack_buff: "buff",
        summon_clone: "summon",
        conditional_target_debuff: "debuff",
        heal_ally_percent_max_hp: "heal",
        self_shield_duration: "shield",
        bonus_damage_knockback: "aoe",
        aoe_gendered_damage: "aoe",
        copy_target_skill: "aoe",
        stun_target: "stun",
        aoe_enemy_damage: "aoe",
        damage_hp_percent_plus_atk: "aoe",
        debuff_atk_and_damage: "debuff",
        aoe_all_others_damage: "aoe",
    };

    const frameCountCache = {};
    const skillFrameCountCache = {};
    const attackAnimActive = {};
    const attackAnimTokens = {};

    // 좌측(나) 패널 안의 스크롤 로그 패널. 박스/테두리 없이 배경 위에 색 텍스트만 쌓인다.
    const logPanelEl = document.getElementById("battle-log-panel");

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function checkImageExists(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
        });
    }

    async function getAttackFrameCount(outfit) {
        if (frameCountCache[outfit] !== undefined) {
            return frameCountCache[outfit];
        }

        let count = 0;

        for (let i = 1; i <= MAX_ATTACK_FRAMES; i += 1) {
            const exists = await checkImageExists(
                `${OUTFIT_IMAGE_BASE}${outfit}/attack_${i}.png`
            );

            if (!exists) break;
            count = i;
        }

        frameCountCache[outfit] = count;
        return count;
    }

    // 시전(캐스팅) 전용 프레임(skill_N.png)이 있는지 확인 - attack_N.png와 같은 규칙으로 캐릭터 outfit
    // 폴더 안에서 순서대로 찾는다. 없는 캐릭터는 outfit당 한 번만 404를 확인하고 캐시해서 재확인하지 않는다.
    async function getSkillFrameCount(outfit) {
        if (skillFrameCountCache[outfit] !== undefined) {
            return skillFrameCountCache[outfit];
        }

        let count = 0;

        for (let i = 1; i <= MAX_SKILL_FRAMES; i += 1) {
            const exists = await checkImageExists(
                `${OUTFIT_IMAGE_BASE}${outfit}/skill_${i}.png`
            );

            if (!exists) break;
            count = i;
        }

        skillFrameCountCache[outfit] = count;
        return count;
    }

    /*
     * 로그 한 줄을 새로 추가한다(기존처럼 한 줄을 계속 덮어쓰지 않고 쌓인다).
     * side가 "attacker"면 파란색(아군), "defender"면 빨간색(적군), 그 외(null)는 금색(시스템 메시지).
     * 반환된 엘리먼트를 나중에 다시 손대면(예: 준비 카운트다운) "같은 줄을 계속 갱신"하는 것도 가능하다.
     */
    const MAX_LOG_LINES = 24; // 이보다 많아지면 오래된 줄부터 지움

    function appendLog(text, side) {
        if (!logPanelEl) return null;

        const entry = document.createElement("div");
        entry.className = `battle-log-entry ${
            side === "attacker" ? "log-ally" : side === "defender" ? "log-enemy" : side === "trait" ? "log-trait" : "log-system"
        }`;
        entry.textContent = text;
        logPanelEl.appendChild(entry);

        // 맨 위(가장 오래된) 줄부터 지워서, 항상 최근 줄들만 남고 계속 위로 밀려 올라가는 형태가 되게 한다.
        while (logPanelEl.children.length > MAX_LOG_LINES) {
            logPanelEl.removeChild(logPanelEl.firstElementChild);
        }

        logPanelEl.scrollTop = logPanelEl.scrollHeight;
        return entry;
    }

    // 특성 발동 로그는 "발동했다"는 사실뿐 아니라 실제로 어떤 수치가 바뀌었는지까지 보여준다.
    function traitLogText(event) {
        const d = event.detail || {};
        if (event.effect_type === "ally_synergy_remove_absorb") {
            return `${event.actor}의 특성 발동! ${d.removed}을(를) 흡수하여 공격력·최대체력 ${d.absorb_percent}% 증가`;
        }
        if (event.effect_type === "ally_synergy_atk_buff") {
            return `${event.actor}의 특성 발동! ${d.partner}와(과)의 시너지로 공격력 ${d.atk_percent}% 증가`;
        }
        return `${event.actor}의 특성 발동!`;
    }

    /*
     * 로비와 동일한 avatar-crop.js 규칙을 대표 프로필과 로스터 프로필에 적용한다.
     * HTML의 frame/thumb 요소가 overflow:hidden이므로 확대된 사진이 카드 밖으로 나오지 않는다.
     */
    function setPortraitImage(imgEl, outfit) {
        if (!imgEl || !outfit) return;

        imgEl.onerror = null;
        imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/idle.png`;

        if (typeof applyAvatarCrop === "function") {
            applyAvatarCrop(imgEl, outfit);
        }
    }

    function buildUnit(rawUnit) {
        return {
            name: rawUnit.name,
            maxHp: rawUnit.max_hp,
            hp: rawUnit.max_hp,
            isMelee: rawUnit.is_melee,
            outfit: rawUnit.outfit,
            star: rawUnit.star,
            style: RANGED_ATTACK_STYLE[rawUnit.name] || (rawUnit.is_melee ? "melee" : "straight"),
        };
    }

    // 최재혁은 ★3부터 후방 적을 우선 공격한다(battle_engine.py의 _select_basic_attack_target과 동일 규칙).
    // 일반 유닛은 기본적으로 적 전방을 향해 걷다가 첫 공격 이벤트가 오면 실제 타겟으로 재조정되지만,
    // 최재혁은 처음부터 실제 목표(후방)를 알고 있으므로 그 재조정("뜸들임")을 건너뛰고 곧장 걸어간다.
    function initialMeleeTargetKey(key) {
        const side = key.startsWith("attacker") ? "attacker" : "defender";
        const enemySide = side === "attacker" ? "defender" : "attacker";
        const unit = units[key];
        if (unit?.name === "최재혁" && (unit.star || 1) >= 3) {
            return `${enemySide}-back`;
        }
        return `${enemySide}-front`;
    }

    const units = {
        "attacker-front": buildUnit(data.attacker_team.front),
        "attacker-back": buildUnit(data.attacker_team.back),
        "defender-front": buildUnit(data.defender_team.front),
        "defender-back": buildUnit(data.defender_team.back),
    };

    function findUnitKey(side, name) {
        if (units[`${side}-front`].name === name) {
            return `${side}-front`;
        }

        if (units[`${side}-back`].name === name) {
            return `${side}-back`;
        }

        if (units[`${side}-summon`] && units[`${side}-summon`].name === name) {
            return `${side}-summon`;
        }

        return null;
    }

    // ===== 좌우 플레이어 패널 =====
    function renderPlayerPanel(side, info) {
        const avatarEl = document.getElementById(`${side}-avatar`);
        const nameEl = document.getElementById(`${side}-name`);
        const levelEl = document.getElementById(`${side}-level`);
        const titleEl = document.getElementById(`${side}-title`);

        if (info.lobby_outfit) {
            setPortraitImage(avatarEl, info.lobby_outfit);
        }

        if (nameEl) nameEl.textContent = info.nickname;
        if (levelEl) levelEl.textContent = info.level;
        if (titleEl) {
            titleEl.textContent = info.title || "칭호 없음";
            // 히든 업적 칭호는 로비 상단바와 동일하게 금색으로 표시 (achievement-toast.css의 공용 클래스)
            titleEl.classList.toggle("title-hidden-shine", !!info.title_is_hidden);
        }
    }

    renderPlayerPanel("attacker", data.attacker_info);
    renderPlayerPanel("defender", data.defender_info);

    // 로스터의 프로필에도 로비와 같은 avatar-crop을 적용한다.
    Object.keys(units).forEach((key) => {
        const rosterEl = document.querySelector(`[data-roster="${key}"]`);
        if (!rosterEl) return;

        const nameEl = rosterEl.querySelector(".roster-unit-name");
        const portraitEl = rosterEl.querySelector(".roster-unit-img");

        if (nameEl) nameEl.textContent = units[key].name;
        setPortraitImage(portraitEl, units[key].outfit);
    });

    // ===== 중앙 전투 유닛 상태 =====
    // key별로 사망 연출을 이미 재생했는지 - 죽은 뒤에도 hp가 그대로 0인 채로 renderUnit이 계속
    // 다시 불릴 수 있어서(다른 유닛의 이벤트 등), 한 번만 재생되도록 막는다.
    const deathHandled = {};

    // ===== 바라보는 방향(스프라이트 반전) =====
    // 기본값: 아군은 오른쪽(적진), 적군은 왼쪽(아군진)을 본다. 전투 중 공격 대상이 자기 등 뒤로
    // 넘어가면(예: 최재혁이 적 후방 자리까지 파고든 경우) 그쪽을 바라보도록 사진을 반전한다 -
    // 예전에 근접캐가 허공에 대고 공격하는 것처럼 보이던 버그의 원인이 "방향 전환이 없어서"였다.
    const facingFlipped = {};

    function isFacingFlipped(key) {
        if (facingFlipped[key] === undefined) facingFlipped[key] = key.startsWith("defender");
        return facingFlipped[key];
    }

    function setFacing(key, flipped) {
        if (facingFlipped[key] === flipped) return;
        facingFlipped[key] = flipped;
        document.querySelector(`[data-unit="${key}"] .battle-unit-img`)?.classList.toggle("flipped", flipped);
    }

    // 대상이 자신의 왼쪽에 있으면 왼쪽을(반전), 오른쪽에 있으면 오른쪽을 바라본다.
    function faceToward(key, targetKey) {
        const el = document.querySelector(`[data-unit="${key}"]`);
        const targetEl = document.querySelector(`[data-unit="${targetKey}"]`);
        if (!el || !targetEl) return;
        const rect = el.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const targetIsLeft = (targetRect.left + targetRect.width / 2) < (rect.left + rect.width / 2);
        setFacing(key, targetIsLeft);
    }

    // 사망 시: 로그 한 줄 + 사망 디폴트 사진(death.png, 아직 없으면 idle 사진을 흑백으로 임시 대체) +
    // 투명해지면서 가로 실선 무늬로 스캔되듯 사라지는 연출.
    function playDeathSequence(key) {
        const unit = units[key];
        const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
        if (!unit || !imgEl) return;

        appendLog(`${unit.name} 사망!`, null);

        imgEl.classList.remove("death-fallback-filter");
        imgEl.onerror = () => {
            imgEl.onerror = null;
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.png`;
            imgEl.classList.add("death-fallback-filter"); // 아직 death.png가 없는 캐릭터는 idle을 흑백으로 임시 대체
        };
        imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/death.png`;

        imgEl.classList.add("dying");
    }

    function renderUnit(key) {
        const unit = units[key];
        const rosterEl = document.querySelector(`[data-roster="${key}"]`);
        const isDead = unit.hp <= 0;

        if (rosterEl) {
            const hpFillEl = rosterEl.querySelector(".roster-hp-fill");
            const hpPercent = Math.max(0, (unit.hp / unit.maxHp) * 100);

            if (hpFillEl) {
                if (isDead) {
                    // 사망 판정은 즉시 적용되는데 체력바만 애니메이션(0.25초)으로 천천히 줄면,
                    // 그 사이 "안 비었는데 죽은 것"처럼 보인다. 죽었을 땐 트랜지션 없이 바로 0%로 만든다.
                    hpFillEl.style.transition = "none";
                    hpFillEl.style.width = "0%";
                    void hpFillEl.offsetWidth;
                    hpFillEl.style.transition = "";
                } else {
                    hpFillEl.style.width = `${hpPercent}%`;
                }
            }

            rosterEl.classList.toggle("roster-unit-dead", isDead);
        }

        const battleEl = document.querySelector(`[data-unit="${key}"]`);
        if (!battleEl) return;

        const imgEl = battleEl.querySelector(".battle-unit-img");
        if (!imgEl) return;

        if (isDead) {
            if (!deathHandled[key]) {
                deathHandled[key] = true;
                playDeathSequence(key);
                clearAllStatusIcons(key);
            }
        } else {
            deathHandled[key] = false; // 복제체 재소환 등으로 슬롯이 재사용될 때를 대비해 리셋

            // .dying은 animation-fill-mode:forwards라서 슬롯이 재사용돼도 그대로 남아있으면
            // 새 스프라이트가 계속 투명하게 보인다 - 살아있을 땐 반드시 지운다.
            imgEl.classList.remove("dying", "death-fallback-filter");

            if (!attackAnimActive[key]) {
                imgEl.onerror = () => {
                    imgEl.onerror = null;
                    imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.png`;
                };

                imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/battle_idle.png`;
                imgEl.classList.toggle("flipped", isFacingFlipped(key)); // 방향은 전투 중 동적으로 바뀔 수 있음
            }
        }

        battleEl.classList.toggle("battle-unit-dead", isDead);
    }

    Object.keys(units).forEach(renderUnit);

    // 전투 시작 전 공격 프레임을 미리 확인한다.
    Object.values(units).forEach((unit) => {
        getAttackFrameCount(unit.outfit);
    });

    // ===== 근거리 이동: 매 프레임마다 실제 위치를 재서 조금씩 다가가는 방식 =====
    // (예전엔 거리/시간을 미리 계산해서 CSS 트랜지션 하나로 재생했는데, 여러 유닛이 동시에 움직이거나
    // 타겟이 도중에 바뀌면 "그 순간의 정확한 위치"를 미리 맞추기가 매우 까다로웠다. 지금은 그냥 60fps로
    // 계속 "지금 실제 위치 기준으로 조금만 더 가자"를 반복해서, 상대가 같이 움직여도 항상 정확하다.)
    const MOVE_STEP_PX = 3;        // 한 프레임(약 16ms)마다 이동하는 픽셀
    const ARRIVE_THRESHOLD_PX = 2;

    const meleeTargetKey = {};              // key -> 지금 다가가야 하는 적 슬롯
    const meleeArrived = {};                // key -> 그 타겟에 이미 도착했는지
    const pendingArrivalResolvers = {};     // key -> 도착을 기다리고 있는 Promise resolve 함수들
    const approachGapExtra = {};            // key -> 접근을 얼마나 덜(뒤에서) 멈출지 - 복제체 뒤에 서는 윤영준 등
    const cloneRetreated = {};              // key -> 복제체 소환으로 이미 한 번 물러났는지(같은 전투에서 또 물러나지 않도록)
    let walkerRunning = false;

    // unitKey가 targetKey에게 도달하려면 지금 이 순간 기준으로 얼마나 더(어느 방향으로) 움직여야 하는지.
    // 양쪽 다 매 프레임 이 함수로 "실시간" 위치를 재기 때문에, 상대가 동시에 움직여도 항상 정확하다.
    // 대상이 자기 등 뒤(진영 기준 반대편)에 있으면 그쪽 면으로 붙는다 - 진행 방향이 고정돼 있지 않다.
    function getGapToTarget(unitKey, targetKey) {
        const el = document.querySelector(`[data-unit="${unitKey}"]`);
        const targetEl = document.querySelector(`[data-unit="${targetKey}"]`);
        if (!el || !targetEl) return 0;

        const rect = el.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        // overlap이 클수록 "더 깊이 파고들어야"(겹쳐야) 도착 판정이 나서 결과적으로 더 가까이 멈춘다.
        // approachGapExtra는 반대로 "평소보다 더 멀리서(덜 파고들고) 멈춘다"는 뜻이라 overlap을 줄여야
        // 한다 - 늘리면 반대로 더 깊이 다가가야 도착 판정이 나서, 물러난 캐릭터가 도로 앞으로 끌려온다.
        const overlap = APPROACH_OVERLAP - (approachGapExtra[unitKey] || 0);

        const myCenter = rect.left + rect.width / 2;
        const targetCenter = targetRect.left + targetRect.width / 2;

        // 내가 대상보다 왼쪽에 있으면 대상의 왼쪽 면에, 오른쪽에 있으면 오른쪽 면에 붙는다.
        return myCenter <= targetCenter
            ? (targetRect.left - rect.right) + overlap
            : (targetRect.right - rect.left) - overlap;
    }

    // 지금 실제로 적용돼있는 translateX 값을 읽는다(누적 이동을 위해 필요).
    function getCurrentTranslateX(el) {
        const value = window.getComputedStyle(el).transform;
        if (!value || value === "none") return 0;
        const match = value.match(/matrix\(([^)]+)\)/);
        if (!match) return 0;
        const parts = match[1].split(",").map(Number);
        return parts[4] || 0;
    }

    // 청년 전용(bonus_damage_knockback): 대상을 "후방으로 이동"한 것으로 취급한다 - 밀려난 뒤 원래
    // 자리로 되돌아오지 않고 그대로 남는다. CSS 트랜지션으로 한 번만 밀어내고 손을 떼는 이유: walker의
    // tick()도 같은 요소의 인라인 transform을 매 프레임 덮어쓰는데, rAF 루프끼리 계속 경합하면 값이
    // 튈 수 있어서 여기서는 "한 번 점프시키고 끝"으로 처리한다. 대상 쪽(밀려난 유닛 자신)이 근거리라
    // 원래 자기 타겟을 향해 walker가 계속 움직이던 중이었다면 그쪽은 그대로 이어지고, 정작 이 대상과
    // 접촉해야 했던 반대 진영 근거리 유닛들은 아래에서 명시적으로 "도착 취소" 처리해서, 실제 거리와
    // 무관하게 다시 걸어서 접근하는 과정을 반드시 거치게 한다(그동안은 waitForMeleeArrival이 공격을 막음).
    function applyKnockback(targetKey) {
        const el = document.querySelector(`[data-unit="${targetKey}"]`);
        if (!el) return;

        const knockDir = targetKey.startsWith("attacker") ? -1 : 1; // 자기 진영 뒤쪽으로
        const KNOCK_DISTANCE = 170; // 후방 원거리 유닛이 맵 밖으로 밀려나지 않도록 예전(420px)보다 크게 줄임
        const startX = getCurrentTranslateX(el);
        let endX = startX + knockDir * KNOCK_DISTANCE;

        // 어느 위치에서 맞아도 맵(battle-field) 경계 밖으로는 밀려나지 않게 클램핑한다.
        const fieldEl = document.querySelector(".battle-field");
        if (fieldEl) {
            const fieldRect = fieldEl.getBoundingClientRect();
            const rect = el.getBoundingClientRect();
            const EDGE_PAD = 8;
            const minX = startX + (fieldRect.left + EDGE_PAD - rect.left);
            const maxX = startX + (fieldRect.right - EDGE_PAD - rect.right);
            endX = Math.max(minX, Math.min(maxX, endX));
        }

        el.style.transition = "transform 220ms ease-out";
        requestAnimationFrame(() => {
            el.style.transform = `translateX(${endX}px)`;
        });
        setTimeout(() => { el.style.transition = ""; }, 240);

        const casterSidePrefix = targetKey.startsWith("attacker") ? "defender" : "attacker";
        Object.keys(units).forEach((key) => {
            if (!key.startsWith(casterSidePrefix) || !units[key] || !units[key].isMelee) return;
            meleeArrived[key] = false;
        });
    }

    // 준비시간이 끝나면 호출됨. 모든 근거리 유닛의 최초 목표(적 전방)를 정해두고,
    // 전투가 끝날 때까지 계속 도는 이동 루프를 시작한다.
    function startMeleeWalker() {
        Object.keys(units).forEach((key) => {
            if (!units[key].isMelee) return;
            meleeTargetKey[key] = initialMeleeTargetKey(key);
            meleeArrived[key] = false;
        });

        walkerRunning = true;

        function tick() {
            if (!walkerRunning) return;

            Object.keys(units).forEach((key) => {
                if (!units[key].isMelee) return;
                if (units[key].hp <= 0) return;

                const targetKey = meleeTargetKey[key];
                if (!targetKey) return;

                const el = document.querySelector(`[data-unit="${key}"]`);
                const targetEl = document.querySelector(`[data-unit="${targetKey}"]`);
                if (!el || !targetEl) return;

                const imgEl = el.querySelector(".battle-unit-img");
                const gap = getGapToTarget(key, targetKey);

                if (Math.abs(gap) <= ARRIVE_THRESHOLD_PX) {
                    if (!meleeArrived[key]) {
                        meleeArrived[key] = true;
                        if (imgEl) imgEl.classList.remove("walking");
                        faceToward(key, targetKey); // 도착하면 대상 쪽을 확실히 바라본다(등 뒤 대상 포함)
                        (pendingArrivalResolvers[key] || []).forEach((resolve) => resolve());
                        pendingArrivalResolvers[key] = [];
                    }
                    return;
                }

                meleeArrived[key] = false;
                if (imgEl) imgEl.classList.add("walking");

                // 대상이 등 뒤에 있어도 그 방향으로 걸어간다(진행 방향 고정 없음). 이동 방향을 바라보게 반전.
                const step = Math.sign(gap) * Math.min(MOVE_STEP_PX, Math.abs(gap));
                setFacing(key, step < 0);
                const currentX = getCurrentTranslateX(el);
                el.style.transform = `translateX(${currentX + step}px)`;
            });

            requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
    }

    // 근거리 유닛이 targetKey에 도착할 때까지 기다린다. 타겟이 이전과 다르면(=이전 타겟이 죽어서
    // 새로운 상대를 노려야 하면) 이동 루프가 자동으로 그쪽을 향해 다시 움직이기 시작한다.
    function waitForMeleeArrival(actorKey, targetKey) {
        if (!units[actorKey] || !units[actorKey].isMelee) return Promise.resolve();

        if (meleeTargetKey[actorKey] !== targetKey) {
            meleeTargetKey[actorKey] = targetKey;
            meleeArrived[actorKey] = false;
        }

        if (meleeArrived[actorKey]) return Promise.resolve();

        return new Promise((resolve) => {
            if (!pendingArrivalResolvers[actorKey]) pendingArrivalResolvers[actorKey] = [];
            pendingArrivalResolvers[actorKey].push(resolve);
        });
    }

    // ===== 원거리 투사체 =====
    function spawnProjectile(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const fieldEl = document.querySelector(".battle-field");
        const actorImg = document.querySelector(
            `[data-unit="${actorKey}"] .battle-unit-img`
        );
        const targetImg = document.querySelector(
            `[data-unit="${targetKey}"] .battle-unit-img`
        );

        if (!layer || !fieldEl || !actorImg || !targetImg) {
            onArrive();
            return;
        }

        const fieldRect = fieldEl.getBoundingClientRect();
        const actorRect = actorImg.getBoundingClientRect();
        const targetRect = targetImg.getBoundingClientRect();

        const startX =
            actorRect.left + actorRect.width / 2 - fieldRect.left;
        const startY =
            actorRect.top + actorRect.height / 2 - fieldRect.top;
        const endX =
            targetRect.left + targetRect.width / 2 - fieldRect.left;
        const endY =
            targetRect.top + targetRect.height / 2 - fieldRect.top;

        const dot = document.createElement("div");
        dot.className = "projectile-dot";
        dot.style.left = `${startX}px`;
        dot.style.top = `${startY}px`;
        layer.appendChild(dot);

        requestAnimationFrame(() => {
            dot.style.transition =
                `left ${PROJECTILE_TRAVEL_MS}ms linear, ` +
                `top ${PROJECTILE_TRAVEL_MS}ms linear`;
            dot.style.left = `${endX}px`;
            dot.style.top = `${endY}px`;
        });

        setTimeout(() => {
            dot.remove();
            onArrive();
        }, PROJECTILE_TRAVEL_MS);
    }

    function fieldRelativeCenter(el) {
        const fieldEl = document.querySelector(".battle-field");
        const fieldRect = fieldEl.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 - fieldRect.left, y: rect.top + rect.height / 2 - fieldRect.top };
    }

    // start->end 방향의 각도(도) - 회전이 필요한 투사체(크레파스/유성)에 쓴다.
    function angleDeg(start, end) {
        return Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
    }

    // 포물선 이동 공용 로직: 직선 보간 + 사인 곡선으로 위로 솟았다가 내려오는 오프셋을 매 프레임 계산한다.
    // el은 이미 layer에 붙어있어야 하고, 도착하면 el을 제거하고 onArrive를 부른다.
    function animateArcMotion(el, start, end, durationMs, arcHeight, onArrive) {
        const startTime = performance.now();

        function frame(now) {
            const progress = Math.min(1, (now - startTime) / durationMs);
            const x = start.x + (end.x - start.x) * progress;
            const y = start.y + (end.y - start.y) * progress - Math.sin(progress * Math.PI) * arcHeight;
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
            if (progress < 1) {
                requestAnimationFrame(frame);
            } else {
                el.remove();
                onArrive();
            }
        }
        requestAnimationFrame(frame);
    }

    // 포물선: 직선 보간 + 사인 곡선으로 위로 솟았다가 내려오는 오프셋을 매 프레임 계산한다(기본 원거리 폴백용).
    function spawnProjectileArc(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const dot = document.createElement("div");
        dot.className = "projectile-dot";
        layer.appendChild(dot);

        animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 70, onArrive);
    }

    // 김남옥 기본공격 전용: 원통형 크레파스 다트, 포물선. 대상이 전방이면 진분홍, 후방/복제체면 푸른색.
    function spawnCrayonProjectile(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const colorClass = targetKey.endsWith("-front") ? "crayon-pink" : "crayon-blue";

        const dot = document.createElement("div");
        dot.className = `crayon-projectile ${colorClass}`;
        dot.style.transform = `rotate(${angleDeg(start, end)}deg)`;
        layer.appendChild(dot);

        animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 60, onArrive);
    }

    // 김남옥 스킬(엑스칼리버) 전용: 진분홍+푸른 크레파스 두 개가 나란히 직선으로 동시에 대상에게 날아간다.
    // 여성 대상(기절 성공)일 때만 재생된다 - 공격판정(기절 표시)은 이 투사체가 닿는 순간에 맞춘다.
    function playDualCrayonSkillProjectile(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const angle = angleDeg(start, end);
        const rad = (angle * Math.PI) / 180;
        const durationMs = PROJECTILE_TRAVEL_MS * 1.4;

        ["crayon-pink", "crayon-blue"].forEach((colorClass, i) => {
            // 두 다트가 겹쳐서 하나처럼 안 보이도록, 진행 방향과 수직으로 살짝 어긋나게 띄운다.
            const perp = i === 0 ? -6 : 6;
            const offX = -Math.sin(rad) * perp;
            const offY = Math.cos(rad) * perp;

            const dot = document.createElement("div");
            dot.className = `crayon-projectile ${colorClass}`;
            dot.style.transform = `rotate(${angle}deg)`;
            dot.style.left = `${start.x + offX}px`;
            dot.style.top = `${start.y + offY}px`;
            layer.appendChild(dot);

            requestAnimationFrame(() => {
                dot.style.transition = `left ${durationMs}ms linear, top ${durationMs}ms linear`;
                dot.style.left = `${end.x + offX}px`;
                dot.style.top = `${end.y + offY}px`;
            });
            setTimeout(() => dot.remove(), durationMs);
        });

        setTimeout(onArrive, durationMs);
    }

    // 이종복 스킬 전용: 붉은 "mg"가 유성처럼 꼬리를 끌며 대상에게 직선으로 날아간다(기본공격보다 큼).
    // 공격판정(피해 반영)은 이 투사체가 닿는 순간에 맞춘다.
    function spawnMeteorProjectile(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const angle = angleDeg(start, end);
        const durationMs = PROJECTILE_TRAVEL_MS * 1.5;

        const el = document.createElement("div");
        el.className = "meteor-projectile";
        el.textContent = "mg";
        el.style.left = `${start.x}px`;
        el.style.top = `${start.y}px`;
        el.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
        layer.appendChild(el);

        requestAnimationFrame(() => {
            el.style.transition = `left ${durationMs}ms linear, top ${durationMs}ms linear`;
            el.style.left = `${end.x}px`;
            el.style.top = `${end.y}px`;
        });

        setTimeout(() => {
            el.remove();
            onArrive();
        }, durationMs);
    }

    // 강 희 스킬 전용: 얼굴 쪽에서 초록색 부채꼴 입냄새(가스)가 좁은 각도로 길게 뿜어져 나와 맵 끝까지
    // 날아간다(적 전원에게 이미 반영된 피해에 시각 효과만 곁들임). wrap이 위치·회전·사거리(--reach)를
    // 잡고, 그 안의 부채꼴 본체(cone)+입 쪽부터 지워지는 wipe(clear)+연기 덩어리(puff) 5개+작은 입자
    // (particle) 6개가 각자의 CSS 애니메이션으로 순차 재생된다.
    function spawnGasBreathStream(actorKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const fieldEl = document.querySelector(".battle-field");
        if (!layer || !actorImg || !fieldEl) { onArrive(); return; }

        const fieldRect = fieldEl.getBoundingClientRect();
        const isAttacker = actorKey.startsWith("attacker");
        const start = fieldRelativeCenter(actorImg);
        start.y -= 60; // 얼굴 높이 정도로 살짝 위에서 시작
        const end = { x: isAttacker ? fieldRect.width : 0, y: start.y };
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        const angle = angleDeg(start, end);
        const durationMs = 1150; // 부채꼴 본체 + 연기/입자 애니메이션이 전부 끝날 때까지 넉넉하게 유지

        const wrap = document.createElement("div");
        wrap.className = "gas-breath-wrap";
        wrap.style.left = `${start.x}px`;
        wrap.style.top = `${start.y}px`;
        wrap.style.width = `${length}px`;
        wrap.style.transform = `rotate(${angle}deg)`;
        // 연기/입자가 날아가는 거리(--reach)를 실제 사거리(length)에 비례시켜서, 맵 크기가 달라져도
        // 항상 부채꼴 끝부분 근처까지 뻗어나가 보이게 한다.
        wrap.style.setProperty("--reach", `${length}px`);
        wrap.innerHTML = `
            <div class="gas-breath-cone"></div>
            <div class="gas-breath-clear"></div>
            <span class="gas-breath-puff gbp1"></span>
            <span class="gas-breath-puff gbp2"></span>
            <span class="gas-breath-puff gbp3"></span>
            <span class="gas-breath-puff gbp4"></span>
            <span class="gas-breath-puff gbp5"></span>
            <span class="gas-breath-particle gbd1"></span>
            <span class="gas-breath-particle gbd2"></span>
            <span class="gas-breath-particle gbd3"></span>
            <span class="gas-breath-particle gbd4"></span>
            <span class="gas-breath-particle gbd5"></span>
            <span class="gas-breath-particle gbd6"></span>
        `;
        layer.appendChild(wrap);

        setTimeout(() => {
            wrap.remove();
            onArrive();
        }, durationMs);
    }

    // 임소정 전용: 캐스터-대상을 잠깐 잇는 전기(이동하는 점이 아니라, 두 위치 사이를 잇는 막대를 회전시켜 만든다).
    // 기본공격은 얇고 푸른색(electric-blue), 스킬은 더 두껍고 노란색(electric-yellow)으로 호출한다.
    // 전기는 사실상 즉발이라 onArrive는 아주 짧게만 대기한 뒤 부른다(null이면 안 부름 - 스킬처럼 이미
    // 피해를 즉시 반영해둔 경우).
    function playElectricConnector(actorKey, targetKey, colorClass, radiusPx, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { if (onArrive) onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        const angle = angleDeg(start, end);

        // 바깥 wrap은 위치/회전/크기만 담당(정적, JS가 한 번만 설정)하고, 안쪽 beam이 지글거리는
        // 애니메이션(scaleX/skewX/밝기)을 맡는다 - 회전(transform: rotate)과 지글거림 애니메이션이
        // 같은 transform 속성을 두고 서로 덮어쓰지 않도록 두 요소로 분리했다.
        const wrap = document.createElement("div");
        wrap.className = "electric-connector-wrap";
        wrap.style.left = `${start.x}px`;
        wrap.style.top = `${start.y}px`;
        wrap.style.width = `${distance}px`;
        wrap.style.height = `${radiusPx}px`;
        wrap.style.marginTop = `${-radiusPx / 2}px`;
        wrap.style.transform = `rotate(${angle}deg)`;

        const beam = document.createElement("div");
        beam.className = `electric-connector ${colorClass}`;
        wrap.appendChild(beam);
        layer.appendChild(wrap);

        setTimeout(() => wrap.remove(), 280);
        if (onArrive) setTimeout(onArrive, 80);
    }

    // 서민석 기본공격 전용: 책 모양 투사체, 포물선(책이 계속 회전하는 건 CSS 애니메이션이 알아서 함).
    function spawnBookProjectile(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const el = document.createElement("div");
        el.className = "book-projectile";
        layer.appendChild(el);

        animateArcMotion(el, start, end, PROJECTILE_TRAVEL_MS * 1.6, 70, onArrive);
    }

    // 서민석 스킬 전용: 하트 모양 투사체, 포물선. colorClass로 "heart-pink"(남성 대상)/"heart-red"(여성 대상) 지정.
    function spawnHeartProjectile(actorKey, targetKey, colorClass, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const el = document.createElement("div");
        el.className = `heart-projectile ${colorClass}`;
        el.textContent = "❤";
        layer.appendChild(el);

        animateArcMotion(el, start, end, PROJECTILE_TRAVEL_MS * 1.7, 90, onArrive);
    }

    // 이영웅 스킬 전용: 치유 대상 머리 위에서 초록색 하트(가운데 십자가, 노란 오라)가 천천히 내려온다.
    // 대상에게 닿는 순간(onArrive)에 맞춰 치유 판정을 반영한다.
    function spawnHealingHeart(targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !targetImg) { onArrive(); return; }

        const end = fieldRelativeCenter(targetImg);
        const start = { x: end.x, y: end.y - 130 };
        const durationMs = 1000;

        const wrap = document.createElement("div");
        wrap.className = "healing-heart-wrap";
        wrap.style.left = `${start.x}px`;
        wrap.style.top = `${start.y}px`;
        wrap.innerHTML = `
            <div class="healing-heart-aura"></div>
            <div class="healing-heart-glyph">❤</div>
            <div class="healing-heart-cross">+</div>
        `;
        layer.appendChild(wrap);

        requestAnimationFrame(() => {
            wrap.style.transition = `top ${durationMs}ms ease-in`;
            wrap.style.top = `${end.y}px`;
        });

        setTimeout(() => {
            wrap.remove();
            onArrive();
        }, durationMs);
    }

    // 윤대웅 전용: 투사체 이동 없이 대상 위치에서 즉시 플래시만 터진다(카메라 셔터).
    function playInstantFlash(actorKey, targetKey, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !targetImg) { onArrive(); return; }
        const pos = fieldRelativeCenter(targetImg);
        const flash = document.createElement("div");
        flash.className = "dt-instant-flash-dot";
        flash.style.left = `${pos.x}px`;
        flash.style.top = `${pos.y}px`;
        layer.appendChild(flash);
        setTimeout(() => flash.remove(), 250);
        setTimeout(onArrive, 80);
    }

    // 이종복 전용: "F", "=", "m", "a" 네 글자가 0.1초 간격으로 직선 발사된다.
    function playTextParticles(actorKey, targetKey, onArrive) {
        const letters = ["F", "=", "m", "a"];
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetKey}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);

        letters.forEach((ch, i) => {
            setTimeout(() => {
                const el = document.createElement("div");
                el.className = "dt-char-particle";
                el.textContent = ch;
                el.style.left = `${start.x}px`;
                el.style.top = `${start.y}px`;
                layer.appendChild(el);
                requestAnimationFrame(() => {
                    el.style.transition = `left ${PROJECTILE_TRAVEL_MS}ms linear, top ${PROJECTILE_TRAVEL_MS}ms linear`;
                    el.style.left = `${end.x}px`;
                    el.style.top = `${end.y}px`;
                });
                setTimeout(() => el.remove(), PROJECTILE_TRAVEL_MS + 50);
            }, i * 100);
        });
        setTimeout(onArrive, letters.length * 100 + PROJECTILE_TRAVEL_MS);
    }

    function playRangedAttack(actorKey, targetKey, onArrive) {
        const style = units[actorKey]?.style || "straight";
        if (style === "arc") spawnProjectileArc(actorKey, targetKey, onArrive);
        else if (style === "instant_flash") playInstantFlash(actorKey, targetKey, onArrive);
        else if (style === "text_particles") playTextParticles(actorKey, targetKey, onArrive);
        else if (style === "crayon") spawnCrayonProjectile(actorKey, targetKey, onArrive);
        else if (style === "electric") playElectricConnector(actorKey, targetKey, "electric-blue", 5, onArrive);
        else if (style === "book") spawnBookProjectile(actorKey, targetKey, onArrive);
        else spawnProjectile(actorKey, targetKey, onArrive);
    }


    let eventIndex = 0;

    function eventTargetKey(event) {
        const targetSide =
            event.side === "attacker" ? "defender" : "attacker";
        return findUnitKey(targetSide, event.target);
    }

    function eventActorKey(event) {
        return findUnitKey(event.side, event.actor);
    }

    // 치명타 시 대상 머리 위에 "치명타!" 글자가 튀어오르듯 잠깐 떴다 사라진다.
    function showCritLabel(key) {
        const layer = document.getElementById("projectile-layer");
        const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
        if (!layer || !imgEl) return;
        const pos = fieldRelativeCenter(imgEl);
        const label = document.createElement("div");
        label.className = "crit-label";
        label.textContent = "치명타!";
        label.style.left = `${pos.x}px`;
        label.style.top = `${pos.y - 46}px`;
        layer.appendChild(label);
        setTimeout(() => label.remove(), 700);
    }

    // 상성(유형 상성) 적중 시 대상 머리 위에 "Weak"(유리, 빨강)/"Resist"(불리, 파랑) 글자를 띄운다.
    // 치명타 라벨과 같은 UI 계열이지만, Weak는 조금 작고 Resist는 그보다 더 작으며 기울어지는 연출이 없다.
    function showTypeLabel(key, kind) {
        const layer = document.getElementById("projectile-layer");
        const imgEl = document.querySelector(`[data-unit="${key}"] .battle-unit-img`);
        if (!layer || !imgEl) return;
        const pos = fieldRelativeCenter(imgEl);
        const label = document.createElement("div");
        label.className = `type-label type-${kind}`;
        label.textContent = kind === "weak" ? "Weak" : "Resist";
        label.style.left = `${pos.x}px`;
        label.style.top = `${pos.y - 62}px`; // 치명타 라벨(-46px)과 겹치지 않도록 조금 더 위에서 시작
        layer.appendChild(label);
        setTimeout(() => label.remove(), 700);
    }

    // isCrit이면 기본 피격 플래시보다 훨씬 화려한 연출(더 강한 확대/발광 + "치명타!" 라벨)을 대신 재생한다.
    // typeMultiplier가 1보다 크면(유리한 상성) "Weak", 1보다 작으면(불리한 상성) "Resist" 라벨을 함께 띄운다.
    function flashHit(key, isCrit, typeMultiplier) {
        const imgEl = document.querySelector(
            `[data-unit="${key}"] .battle-unit-img`
        );

        if (!imgEl) return;

        if (typeof typeMultiplier === "number") {
            if (typeMultiplier > 1) showTypeLabel(key, "weak");
            else if (typeMultiplier < 1) showTypeLabel(key, "resist");
        }

        if (isCrit) {
            imgEl.classList.add("crit-flash");
            showCritLabel(key);
            setTimeout(() => {
                imgEl.classList.remove("crit-flash");
            }, 400);
            return;
        }

        imgEl.classList.add("hit-flash");

        setTimeout(() => {
            imgEl.classList.remove("hit-flash");
        }, 250);
    }

    async function playAttackFrames(key) {
        const el = document.querySelector(`[data-unit="${key}"]`);
        if (!el) return;

        const imgEl = el.querySelector(".battle-unit-img");
        if (!imgEl) return;

        const outfit = units[key].outfit;
        const myToken =
            (attackAnimTokens[key] = (attackAnimTokens[key] || 0) + 1);

        attackAnimActive[key] = true;

        const frameCount = await getAttackFrameCount(outfit);

        if (attackAnimTokens[key] !== myToken) return;

        if (frameCount === 0) {
            imgEl.classList.add("attacking");

            setTimeout(() => {
                imgEl.classList.remove("attacking");
                attackAnimActive[key] = false;
            }, 300);

            return;
        }

        for (let i = 1; i <= frameCount; i += 1) {
            if (attackAnimTokens[key] !== myToken) return;

            imgEl.src =
                `${OUTFIT_IMAGE_BASE}${outfit}/attack_${i}.png`;
            await sleep(ATTACK_FRAME_DURATION_MS);
        }

        if (attackAnimTokens[key] === myToken) {
            imgEl.onerror = () => {
                imgEl.onerror = null;
                imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/idle.png`;
            };

            imgEl.src =
                `${OUTFIT_IMAGE_BASE}${outfit}/battle_idle.png`;
            attackAnimActive[key] = false;
        }
    }

    /*
     * 시전(캐스팅) 중 재생되는 프레임 애니메이션. 스킬 전용 프레임(skill_N.png)이 있으면 그걸 우선 쓰고,
     * 없으면 기본공격 프레임(attack_N.png)을 그대로 돌려쓴다. 짧은 프레임 묶음을 빠르게 반복 재생하는
     * 대신, 가진 프레임 수만큼을 시전 시간(durationMs) 전체에 고르게 늘려서 "한 번만" 재생한다 -
     * 그래서 시전이 길수록 프레임 하나하나가 더 천천히 넘어가고, 루프하는 느낌 없이 시전 시작부터
     * 끝까지 이어지는 애니메이션처럼 보인다.
     */
    async function playCastFrames(key, durationMs) {
        const el = document.querySelector(`[data-unit="${key}"]`);
        const imgEl = el?.querySelector(".battle-unit-img");
        if (!el || !imgEl || !units[key]) return;

        const outfit = units[key].outfit;
        const myToken =
            (attackAnimTokens[key] = (attackAnimTokens[key] || 0) + 1);

        attackAnimActive[key] = true;

        const skillFrameCount = await getSkillFrameCount(outfit);
        const usingSkillFrames = skillFrameCount > 0;
        const frameCount = usingSkillFrames ? skillFrameCount : await getAttackFrameCount(outfit);
        const framePrefix = usingSkillFrames ? "skill" : "attack";

        if (attackAnimTokens[key] !== myToken) return;

        if (frameCount === 0) {
            // 스킬/공격 프레임 이미지가 아예 없는 캐릭터는 기존처럼 펄스 글로우만으로 시전 표시.
            return;
        }

        const perFrameMs = durationMs / frameCount;

        for (let i = 1; i <= frameCount; i += 1) {
            if (attackAnimTokens[key] !== myToken) return;

            imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/${framePrefix}_${i}.png`;
            await sleep(perFrameMs);
        }

        if (attackAnimTokens[key] === myToken) {
            imgEl.onerror = () => {
                imgEl.onerror = null;
                imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/idle.png`;
            };

            imgEl.src = `${OUTFIT_IMAGE_BASE}${outfit}/battle_idle.png`;
            attackAnimActive[key] = false;
        }
    }

    /*
     * 타격 로그: 이제 한 줄을 덮어쓰지 않고, 행동한 쪽 색으로 새 줄을 계속 추가한다.
     */
    function showDamageMessage(event) {
        appendLog(
            `${event.actor}의 공격! ${event.target}에게 ${event.damage}만큼 피해!${event.is_crit ? " 치명타!" : ""}`,
            event.side
        );
    }

    // ===== 효과 수신자 오라 =====
    // 스킬 발동 순간 시전자 몸이 번쩍이던 예전 연출 대신, 효과를 "받은" 대상에게 색 오라가
    // 나왔다가 사라진다(이영웅에게 회복받는 대상과 같은 방식). 같은 대상이 연달아 효과를 받으면
    // 애니메이션이 처음부터 다시 재생되며 "나중에 받은 효과"의 색으로 바뀐다.
    const EFFECT_AURA_COLORS = {
        buff: "#ff4d3d",     // 버프(공격력/최대체력/공격속도 증가 등) - 붉은색
        debuff: "#4d8bff",   // 디버프(공격력/최대체력 감소) - 파란색
        cc: "#b266ff",       // CC기(기절, 넉백 등) - 보라색
        heal: "#4ee06a",     // 회복 - 연두색
        special: "#ffffff",  // 스페셜(무적 등) - 흰색
    };

    function flashEffectAura(unitKey, kind) {
        const imgEl = document.querySelector(`[data-unit="${unitKey}"] .battle-unit-img`);
        const color = EFFECT_AURA_COLORS[kind];
        if (!imgEl || !color) return;
        imgEl.classList.remove("effect-aura-flash");
        void imgEl.offsetWidth; // 강제 리플로우 - 연속으로 받아도 애니메이션이 다시 재생되게
        imgEl.style.setProperty("--effect-aura-color", color);
        imgEl.classList.add("effect-aura-flash");
    }

    // ===== 로스터 상태 아이콘 =====
    // 상태가 걸리면 로스터의 이름 바로 옆부터 아이콘이 하나씩 채워지고, 상태가 끝나면 사라진다.
    //
    // xN 배지는 "같은 원인이 반복 갱신"되는 게 아니라 "서로 다른 원인이 동시에 겹쳐" 있을 때만 올라간다.
    // 예) 임소정과 김남옥이 각자의 성급 특성으로 같은 아군에게 공격력 증가를 부여하면 x2가 맞지만,
    // 김남옥이 자기 공속버프를 반복 시전해서 지속시간만 갱신되는 건 카운트를 늘리지 않는다(같은 source).
    // 그래서 각 발동을 source 키(누가/무엇을 원인으로)로 구분해서 관리한다: 같은 source가 다시 걸리면
    // 그 source의 타이머만 리셋(갱신)하고, 처음 보는 source면 새로 추가(중첩)한다. 표시 카운트 = 활성
    // source 수의 합(윤대웅의 자가 중첩 스킬처럼 "한 source가 자체적으로 커지는" 경우는 weight로 반영).
    const STATUS_ICON_FILES = {
        atk_up: "Combat_Icon_Buff_ATK.png",
        maxhp_up: "Combat_Icon_Buff_MAXHP.png",
        atk_speed_up: "Combat_Icon_Buff_AttackSpeed.png",
        atk_down: "Combat_Icon_Debuff_ATK.png",
        maxhp_down: "Combat_Icon_Debuff_MAXHP.png",
        stun: "Combat_Icon_CC_Stunned.png",
        knockback: "Combat_Icon_CC_Knockback.png",
        heal: "Combat_Icon_Recovery_Heal.png",
        immune: "Combat_Icon_Special_ImmuneDamage.png",
    };
    const MOMENT_ICON_MS = 1200; // 순간 효과(회복, 넉백)는 이 시간만 표시됐다가 사라짐

    const statusIconState = {}; // unitKey -> { iconId: { el, sources: Map<sourceKey, {weight, timer}> } }

    function renderStatusIconTotal(unitKey, iconId) {
        const entry = statusIconState[unitKey]?.[iconId];
        if (!entry) return;
        const total = [...entry.sources.values()].reduce((sum, s) => sum + s.weight, 0);
        const stackEl = entry.el.querySelector(".roster-status-stack");
        if (stackEl) {
            stackEl.hidden = total < 2;
            stackEl.textContent = `x${total}`;
        }
    }

    // opts.source: 이 효과를 일으킨 원인의 고유 키(보통 "행위자:효과종류"). 생략하면 항상 같은
    // 익명 source로 취급되어 재호출 시 카운트가 늘지 않고 그저 갱신만 된다.
    // opts.weight: 이 source 하나가 차지하는 중첩 수(윤대웅 스킬처럼 서버가 스택 수를 직접 셀 때 사용). 기본 1.
    function setStatusIcon(unitKey, iconId, opts = {}) {
        const rosterEl = document.querySelector(`[data-roster="${unitKey}"]`);
        const wrap = rosterEl?.querySelector(".roster-status-icons");
        const file = STATUS_ICON_FILES[iconId];
        if (!wrap || !file) return;

        const state = (statusIconState[unitKey] = statusIconState[unitKey] || {});
        let entry = state[iconId];

        if (!entry) {
            const el = document.createElement("span");
            el.className = "roster-status-icon status-icon-pop";
            el.innerHTML = `<img src="assets/arena/${file}" alt=""><span class="roster-status-stack" hidden></span>`;
            wrap.appendChild(el);
            entry = state[iconId] = { el, sources: new Map() };
        }

        const sourceKey = opts.source || "__shared__";
        const weight = opts.weight !== undefined ? opts.weight : 1;
        let source = entry.sources.get(sourceKey);
        if (!source) {
            source = { weight, timer: null };
            entry.sources.set(sourceKey, source);
        } else {
            source.weight = weight; // 같은 source 재적용 - 새로 중첩하지 않고 무게만 갱신(자가 중첩 스킬용)
        }

        // 지속시간이 있으면 그 source만 그 시점에 제거(재적용 시 타이머 리셋). 없으면 전투 끝(사망)까지 유지.
        if (source.timer) { clearTimeout(source.timer); source.timer = null; }
        if (opts.durationMs) {
            source.timer = setTimeout(() => clearStatusIconSource(unitKey, iconId, sourceKey), opts.durationMs);
        }

        renderStatusIconTotal(unitKey, iconId);
    }

    function clearStatusIconSource(unitKey, iconId, sourceKey) {
        const entry = statusIconState[unitKey]?.[iconId];
        const source = entry?.sources.get(sourceKey);
        if (!entry || !source) return;
        if (source.timer) clearTimeout(source.timer);
        entry.sources.delete(sourceKey);
        if (entry.sources.size === 0) {
            entry.el.remove();
            delete statusIconState[unitKey][iconId];
        } else {
            renderStatusIconTotal(unitKey, iconId);
        }
    }

    function clearAllStatusIcons(unitKey) {
        const state = statusIconState[unitKey];
        if (!state) return;
        Object.entries(state).forEach(([iconId, entry]) => {
            entry.sources.forEach((source) => { if (source.timer) clearTimeout(source.timer); });
            entry.el.remove();
        });
        delete statusIconState[unitKey];
    }

    // ===== 복제체(summon) 로스터 행 =====
    // 복제체가 소환되면 로스터에도 한 줄이 생겨서 전방/중방/후방 정렬에 함께 참여한다.
    // 재소환(교체)되면 기존 행을 재사용하고 상태를 초기화한다.
    function ensureSummonRosterRow(cloneKey, unit) {
        let rosterEl = document.querySelector(`[data-roster="${cloneKey}"]`);
        const side = cloneKey.startsWith("attacker") ? "attacker" : "defender";
        const panel = document.querySelector(`.player-panel[data-side="${side}"]`);
        if (!panel) return;

        const isNewRow = !rosterEl;
        if (!rosterEl) {
            rosterEl = document.createElement("div");
            rosterEl.className = "roster-unit roster-row-appear";
            rosterEl.dataset.roster = cloneKey;
            rosterEl.innerHTML = `
                <div class="roster-unit-thumb"><img class="roster-unit-img" src="" alt=""></div>
                <div class="roster-unit-body">
                    <div class="roster-name-row">
                        <div class="roster-unit-name">-</div>
                        <div class="roster-status-icons"></div>
                    </div>
                    <div class="roster-hp-track"><div class="roster-hp-fill"></div></div>
                </div>
            `;
            // 아군 패널은 로스터 밑에 전투 로그가 있으므로 로그 바로 앞에 끼워 넣는다.
            const logPanel = panel.querySelector(".battle-log-panel");
            if (logPanel) panel.insertBefore(rosterEl, logPanel);
            else panel.appendChild(rosterEl);
            rosterEl.addEventListener("animationend", () => rosterEl.classList.remove("roster-row-appear"), { once: true });
        }

        rosterEl.classList.remove("roster-unit-dead");
        const nameEl = rosterEl.querySelector(".roster-unit-name");
        if (nameEl) nameEl.textContent = unit.name; // 서버가 "윤영준의 복제체" 형태로 이름을 내려준다
        setPortraitImage(rosterEl.querySelector(".roster-unit-img"), unit.outfit);
        rosterEl.querySelector(".roster-unit-img")?.classList.toggle("roster-clone-img", true);
        clearAllStatusIcons(cloneKey);

        // 새로 생긴 행은 폴링(최대 450ms)을 기다리지 않고 즉시 전방/중방/후방 순서에 맞춰 자리잡는다.
        if (isNewRow) reorderRoster(side);
    }

    // ===== 전투 중 위치에 따른 전방/(중방)/후방 판정 + 로스터 정렬 =====
    // 아군은 오른쪽(x가 클수록)이 전방, 적군은 왼쪽(x가 작을수록)이 전방이다. 복제체가 나와 있으면
    // 3명이 전방/중방/후방으로 나뉜다(전투 중 실제 위치 순서). 로스터는 전방이 위, 후방이 아래로
    // 정렬되고, 순서가 바뀌면 두 줄이 부드럽게 자리를 서로 바꾼다. 죽은 유닛은 항상 맨 아래로 보낸다.
    const lastRosterOrder = { attacker: "", defender: "" };
    let rosterOrderTimer = null;

    function computeFrontToBackOrder(side) {
        const keys = Object.keys(units).filter((key) => {
            if (!key.startsWith(side) || !units[key]) return false;
            if (!document.querySelector(`[data-roster="${key}"]`)) return false;
            const battleEl = document.querySelector(`[data-unit="${key}"]`);
            return battleEl && !battleEl.hidden;
        });

        const centers = {};
        keys.forEach((key) => {
            const el = document.querySelector(`[data-unit="${key}"]`);
            const rect = el ? el.getBoundingClientRect() : null;
            centers[key] = rect ? rect.left + rect.width / 2 : 0;
        });

        keys.sort((a, b) => {
            const deadA = units[a].hp <= 0 ? 1 : 0;
            const deadB = units[b].hp <= 0 ? 1 : 0;
            if (deadA !== deadB) return deadA - deadB;
            return side === "attacker" ? centers[b] - centers[a] : centers[a] - centers[b];
        });
        return keys;
    }

    function reorderRoster(side) {
        const order = computeFrontToBackOrder(side);
        const signature = order.join("|");
        if (!order.length || signature === lastRosterOrder[side]) return;
        lastRosterOrder[side] = signature;

        const panel = document.querySelector(`.player-panel[data-side="${side}"]`);
        if (!panel) return;
        const rows = order.map((key) => document.querySelector(`[data-roster="${key}"]`)).filter(Boolean);

        // FLIP: 원래 위치 기록 -> DOM 순서 변경 -> 이동량만큼 역변환 -> 트랜지션으로 제자리 복귀
        const firstTops = new Map(rows.map((row) => [row, row.getBoundingClientRect().top]));
        const anchor = panel.querySelector(".battle-log-panel");
        rows.forEach((row) => {
            if (anchor) panel.insertBefore(row, anchor);
            else panel.appendChild(row);
        });
        rows.forEach((row) => {
            const dy = firstTops.get(row) - row.getBoundingClientRect().top;
            if (!dy) return;
            row.style.transition = "none";
            row.style.transform = `translateY(${dy}px)`;
        });
        void panel.offsetWidth;
        rows.forEach((row) => {
            row.style.transition = "transform 380ms cubic-bezier(.2, .75, .25, 1)";
            row.style.transform = "";
        });
        setTimeout(() => rows.forEach((row) => { row.style.transition = ""; }), 420);
    }

    function startRosterOrderWatcher() {
        rosterOrderTimer = setInterval(() => {
            reorderRoster("attacker");
            reorderRoster("defender");
        }, 450);
    }

    // 최재혁 전용(self_shield_duration) - 캐릭터를 감싸는 푸른 원형 보호막. .battle-unit의 자식으로 붙여서
    // 걷기(translateX)를 따라 자동으로 함께 움직이게 하고, 실드 지속시간이 끝나면 스스로 제거된다.
    function spawnShieldRing(actorKey, durationMs) {
        const unitEl = document.querySelector(`[data-unit="${actorKey}"]`);
        if (!unitEl) return;
        unitEl.querySelector(".shield-ring-wrap")?.remove();

        const wrap = document.createElement("div");
        wrap.className = "shield-ring-wrap";
        wrap.innerHTML = `<div class="shield-ring"></div>`;
        unitEl.appendChild(wrap);

        setTimeout(() => wrap.remove(), durationMs);
    }

    // 스킬 발동(skill_resolve)의 detail.hits[]에 담긴 피해를 대상들에게 반영하고 화면을 갱신한다.
    // 스킬 이벤트의 target 이름만으로는 어느 편인지 알 수 없어서(자해 스킬도 있음) 양쪽을 다 찾아본다.
    function findHitKey(name) {
        return findUnitKey("attacker", name) || findUnitKey("defender", name);
    }

    function applySkillHits(event) {
        const hits = event.detail?.hits || [];
        hits.forEach((hit) => {
            const hitKey = findHitKey(hit.target);
            if (!hitKey) return;
            units[hitKey].hp = hit.target_hp_after;
            renderUnit(hitKey);
            flashHit(hitKey, hit.is_crit, hit.type_multiplier);
        });
    }

    function playNext() {
        if (eventIndex >= data.events.length) {
            showResult();
            return;
        }

        const event = data.events[eventIndex];
        const eventType = event.event_type || "basic_attack";

        if (eventType === "cast_start") {
            // 3번째 기본공격 직후 곧바로 자신의 시전으로 넘어가는 경우, 서버 기록상 두 이벤트가 같은
            // 시각이라 원래는 거의 지연이 없다 - 하지만 화면에서는 그 공격의 윈드업/프레임 애니메이션이
            // 아직 재생 중일 수 있으므로(attackAnimActive), 그게 끝날 때까지 eventIndex를 그대로 두고
            // 짧은 간격으로 재시도한다. 실제 시각 기준 flag라서 다른 유닛 이벤트가 사이에 끼어들어도 정확하다.
            const castActorKey = eventActorKey(event);
            if (castActorKey && attackAnimActive[castActorKey]) {
                setTimeout(playNext, 20);
                return;
            }
        }

        if (eventType === "star_effect_resolve") {
            // 성급별 효과(전투 시작 시 1회) - 스탯이 오르내린 대상마다 해당 상태 아이콘을 켠다.
            // 전투 내내 유지되는 영구 효과라 지속시간 없이 전투가 끝날 때까지(사망 전까지) 계속 떠 있는다.
            (event.detail?.changes || []).forEach((change) => {
                const changedKey = findUnitKey(change.target_side, change.target);
                if (!changedKey) return;
                // source = "시전자:효과타입" - 성급 효과는 전투 시작 시 1회만 발동하므로 재적용(갱신)은
                // 없고, 서로 다른 캐릭터의 성급 효과가 같은 대상에게 겹칠 때만(source가 달라짐) 중첩된다.
                const source = `${event.actor}:${event.effect_type}`;
                if (change.atk > 0) setStatusIcon(changedKey, "atk_up", { source });
                if (change.atk < 0) setStatusIcon(changedKey, "atk_down", { source });
                if (change.hp > 0) setStatusIcon(changedKey, "maxhp_up", { source });
                if (change.hp < 0) setStatusIcon(changedKey, "maxhp_down", { source });
                flashEffectAura(changedKey, (change.atk < 0 || change.hp < 0) ? "debuff" : "buff");
            });
        } else if (eventType === "trait_resolve") {
            // 전투 시작과 동시에 1회만 판정되는 특성 - 파트너 제거(도플갱어) 등은 즉시 반영한다.
            const traitActorKey = eventActorKey(event);
            if (event.effect_type === "ally_synergy_remove_absorb" && event.detail?.removed) {
                const removedKey = findUnitKey(event.side, event.detail.removed);
                if (removedKey) {
                    units[removedKey].hp = 0;
                    renderUnit(removedKey);
                }
                if (traitActorKey) {
                    // 흡수 = 공격력·최대체력 증가 버프를 받은 것
                    flashEffectAura(traitActorKey, "buff");
                    setStatusIcon(traitActorKey, "atk_up", { source: `${traitActorKey}:${event.effect_type}` });
                    setStatusIcon(traitActorKey, "maxhp_up", { source: `${traitActorKey}:${event.effect_type}` });
                }
            } else if (event.effect_type === "ally_synergy_atk_buff" && traitActorKey) {
                flashEffectAura(traitActorKey, "buff");
                setStatusIcon(traitActorKey, "atk_up", { source: `${traitActorKey}:${event.effect_type}` });
            }
            appendLog(traitLogText(event), "trait");
        } else if (eventType === "cast_start") {
            const actorKey = eventActorKey(event);
            if (actorKey) {
                const castStartImgEl = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
                castStartImgEl?.classList.add("casting");
                // 강승유 전용: 시전 중에는 금빛 펄스 대신 무지개빛으로 물든다.
                if (event.actor === "강승유") castStartImgEl?.classList.add("casting-rainbow");
                playCastFrames(actorKey, event.duration * 1000 * PLAYBACK_SPEED);
            }
            appendLog(`${event.actor}, 스킬 시전 중...`, event.side);
        } else if (eventType === "skill_resolve") {
            const actorKey = eventActorKey(event);
            // 강승유(copy_target_skill)는 event.effect_type이 항상 "copy_target_skill"로 찍히지만,
            // 실제로 복제한 원본 효과 이름은 detail.copied_effect_type에 들어있다 - 그게 있으면 그걸
            // 기준으로 연출을 분기해서, 복제한 스킬의 실제 전용 이펙트가 원본과 동일하게 나오게 한다.
            // (복제할 스킬이 없어 단순 피해로 폴백된 경우엔 copied_effect_type이 없으므로 그대로 event.effect_type을 쓴다.)
            const dispatchEffectType = event.detail?.copied_effect_type || event.effect_type;
            if (actorKey) {
                const castImgEl = document.querySelector(`[data-unit="${actorKey}"] .battle-unit-img`);
                castImgEl?.classList.remove("casting", "casting-rainbow");
                // 시전 프레임 루프가 아직 돌고 있으면 즉시 멈추고 평상시 자세로 되돌린다(타이밍이 살짝 어긋나도 안전).
                attackAnimTokens[actorKey] = (attackAnimTokens[actorKey] || 0) + 1;
                attackAnimActive[actorKey] = false;
                if (castImgEl && units[actorKey]) {
                    castImgEl.onerror = () => {
                        castImgEl.onerror = null;
                        castImgEl.src = `${OUTFIT_IMAGE_BASE}${units[actorKey].outfit}/idle.png`;
                    };
                    castImgEl.src = `${OUTFIT_IMAGE_BASE}${units[actorKey].outfit}/battle_idle.png`;
                }
                // 시전자 몸이 카테고리 색으로 번쩍이던 예전 연출은 제거 - 오라는 이제 효과를 "받은"
                // 대상에게만 나왔다가 사라진다(flashEffectAura). 자기 자신에게 거는 효과(버프/실드)는
                // 시전자가 곧 수신자이므로 시전자에게 뜨는 게 맞다.

                if (dispatchEffectType === "self_stack_buff" && event.detail?.stack_count) {
                    // 윤대웅: 지속되는 윤곽선 오라 대신, 버프를 받는 순간마다 붉은 오라가 나왔다가 사라진다.
                    // 자기 자신이 유일한 source라서 재시전은 "새 중첩"이 아니라 같은 source의 무게(weight)가
                    // 커지는 것으로 처리한다 - 실제로 스택 수만큼 커지는 걸 정확히 반영.
                    flashEffectAura(actorKey, "buff");
                    setStatusIcon(actorKey, "atk_up", { source: `${actorKey}:self_stack_buff`, weight: event.detail.stack_count });
                }

                if (dispatchEffectType === "self_shield_duration" && event.detail?.shield_seconds) {
                    const shieldMs = event.detail.shield_seconds * 1000 * PLAYBACK_SPEED;
                    flashEffectAura(actorKey, "special"); // 무적(실드) = 스페셜(흰색)
                    setStatusIcon(actorKey, "immune", { source: `${actorKey}:self_shield_duration`, durationMs: shieldMs });
                    spawnShieldRing(actorKey, shieldMs);
                }

                if (dispatchEffectType === "conditional_target_debuff") {
                    // 김남옥: 공격속도 증가는 대상 성별과 무관하게 항상 자신에게 적용되는 버프.
                    // source를 자기 자신 고정으로 두어, 반복 시전은 "갱신"으로만 처리되고 중첩되지 않는다.
                    const hasteMs = (event.detail?.haste_seconds || 0) * 1000 * PLAYBACK_SPEED;
                    flashEffectAura(actorKey, "buff");
                    setStatusIcon(actorKey, "atk_speed_up", { source: `${actorKey}:haste`, ...(hasteMs ? { durationMs: hasteMs } : {}) });
                }

                // 복제체(윤영준)는 기존 전방/후방을 대체하지 않는 3번째 유닛 - 전용 summon 슬롯에 매번 새로 생성한다.
                // (이미 그 슬롯에 이전 복제체가 있었다면 detail.replaced에 이름이 담겨오지만, 살아있는 아군이 제거되는 일은 없다.)
                if (dispatchEffectType === "summon_clone" && event.detail?.summoned) {
                    const cloneKey = `${event.side}-summon`;
                    const caster = units[actorKey];

                    units[cloneKey] = {
                        name: event.detail.clone_name,
                        maxHp: event.detail.clone_hp,
                        hp: event.detail.clone_hp,
                        isMelee: caster ? caster.isMelee : true,
                        outfit: caster ? caster.outfit : null,
                        style: caster ? caster.style : "melee",
                    };

                    const cloneEl = document.querySelector(`[data-unit="${cloneKey}"]`);
                    const casterEl = document.querySelector(`[data-unit="${actorKey}"]`);
                    if (cloneEl) {
                        cloneEl.hidden = false;
                        cloneEl.style.transform = ""; // 우선 자연 위치로 리셋한 뒤 아래에서 캐스터 자리로 옮긴다
                        // 복제체는 윤영준이 서 있던 바로 그 자리를 차지한다.
                        if (casterEl) {
                            const cloneRect = cloneEl.getBoundingClientRect();
                            const casterRect = casterEl.getBoundingClientRect();
                            cloneEl.style.transform = `translateX(${casterRect.left - cloneRect.left}px)`;
                        }
                    }
                    // 원본(윤영준)은 복제체보다 뒤로 물러난다 - 스프라이트 폭만큼만, 부드럽게(CSS 트랜지션).
                    // 물러난 만큼 접근 간격(approachGapExtra)도 똑같이 넓혀서, 이동 루프가 다음 프레임에
                    // "아직 안 도착했다"며 도로 앞으로 끌어오지 않고 물러난 자리에서 자연스럽게 멈춘다.
                    // 같은 전투에서 스킬을 또 쓰더라도 딱 한 번만 물러나야 한다 - 안 그러면 "현재 위치"
                    // 기준으로 매번 더 물러나서 누적되며 도망치는 것처럼 보이는 버그가 있었다.
                    if (casterEl && !cloneRetreated[actorKey]) {
                        const retreatSign = event.side === "attacker" ? -1 : 1;
                        const spriteWidth = casterEl.querySelector(".battle-unit-img")?.getBoundingClientRect().width || 130;
                        const casterX = getCurrentTranslateX(casterEl);
                        casterEl.style.transition = "transform 320ms ease-out";
                        requestAnimationFrame(() => {
                            casterEl.style.transform = `translateX(${casterX + retreatSign * spriteWidth}px)`;
                        });
                        setTimeout(() => { casterEl.style.transition = ""; }, 340);
                        approachGapExtra[actorKey] = spriteWidth;
                        meleeArrived[actorKey] = false;
                        cloneRetreated[actorKey] = true;
                    }
                    attackAnimActive[cloneKey] = false;
                    getAttackFrameCount(units[cloneKey].outfit);
                    ensureSummonRosterRow(cloneKey, units[cloneKey]);
                    deathHandled[cloneKey] = false;
                    renderUnit(cloneKey);
                    // 복제체는 원본과 구분되게 전체적으로 푸른 색감이 돌도록(3D 프린트 홀로그램 느낌)
                    document.querySelector(`[data-unit="${cloneKey}"] .battle-unit-img`)?.classList.add("is-clone");

                    // 근거리 복제체라면 이동 루프가 새로 생긴 자리를 즉시 인식하도록 목표를 잡아준다.
                    if (units[cloneKey].isMelee) {
                        meleeTargetKey[cloneKey] = event.side === "attacker" ? "defender-front" : "attacker-front";
                        meleeArrived[cloneKey] = false;
                    }
                }
            }

            // 캐릭터 전용 스킬 발사체 연출. 김남옥(여성 대상 기절 성공)·이종복은 투사체가 대상에
            // 닿는 순간에 맞춰 피해/상태 표시를 늦추고, 서민석·임소정은 즉시 반영하면서 투사체만 얹는다.
            // (dispatchEffectType 기준으로 분기하므로, 강승유가 이 스킬들을 복제했을 때도 동일하게 탄다.)
            if (dispatchEffectType === "conditional_target_debuff" && event.detail?.stunned && actorKey) {
                const targetKey = event.detail.target ? findHitKey(event.detail.target) : null;
                if (targetKey) {
                    playDualCrayonSkillProjectile(actorKey, targetKey, () => {
                        // 기절(CC기) = 보라색 오라 + 기절 아이콘(지속시간 동안). source=시전자 - 같은
                        // 캐릭터가 다시 기절시키면 중첩이 아니라 갱신(지속시간만 새로 시작).
                        flashEffectAura(targetKey, "cc");
                        setStatusIcon(targetKey, "stun", {
                            source: `${event.actor}:stun`,
                            durationMs: (event.detail.stun_seconds || 0) * 1000 * PLAYBACK_SPEED,
                        });
                        appendLog(`${event.actor}의 스킬 발동!`, event.side);
                    });
                } else {
                    applySkillHits(event);
                    appendLog(`${event.actor}의 스킬 발동!`, event.side);
                }
            } else if (dispatchEffectType === "stun_target" && event.detail?.hit) {
                const stunTargetKey = event.detail.target ? findHitKey(event.detail.target) : null;
                if (stunTargetKey) {
                    flashEffectAura(stunTargetKey, "cc");
                    setStatusIcon(stunTargetKey, "stun", {
                        source: `${event.actor}:stun`,
                        durationMs: (event.detail.stun_seconds || 0) * 1000 * PLAYBACK_SPEED,
                    });
                }
                appendLog(`${event.actor}의 스킬 발동!`, event.side);
            } else if (dispatchEffectType === "damage_hp_percent_plus_atk" && actorKey && event.detail?.hits?.length) {
                const hit = event.detail.hits[0];
                const targetKey = findHitKey(hit.target);
                if (targetKey) {
                    spawnMeteorProjectile(actorKey, targetKey, () => {
                        units[targetKey].hp = hit.target_hp_after;
                        renderUnit(targetKey);
                        flashHit(targetKey, hit.is_crit, hit.type_multiplier);
                        appendLog(`${event.actor}의 스킬 발동!`, event.side);
                    });
                } else {
                    applySkillHits(event);
                    appendLog(`${event.actor}의 스킬 발동!`, event.side);
                }
            } else if (dispatchEffectType === "aoe_gendered_damage" && actorKey) {
                applySkillHits(event);
                (event.detail?.hits || []).forEach((hit) => {
                    const targetKey = findHitKey(hit.target);
                    if (!targetKey) return;
                    const gender = CHARACTER_GENDER[hit.target] || "남";
                    spawnHeartProjectile(actorKey, targetKey, gender === "여" ? "heart-red" : "heart-pink", () => {});
                });
                appendLog(`${event.actor}의 스킬 발동!`, event.side);
            } else if (dispatchEffectType === "debuff_atk_and_damage" && actorKey && event.detail?.hits?.length) {
                applySkillHits(event);
                const hit = event.detail.hits[0];
                const targetKey = findHitKey(hit.target);
                if (targetKey) {
                    playElectricConnector(actorKey, targetKey, "electric-yellow", 9, null);
                    // 공격력 감소(디버프) = 파란색 오라 + 공격력 감소 아이콘(지속시간 동안)
                    flashEffectAura(targetKey, "debuff");
                    setStatusIcon(targetKey, "atk_down", {
                        source: `${event.actor}:atk_down`,
                        durationMs: (event.detail?.debuff_seconds || 0) * 1000 * PLAYBACK_SPEED,
                    });
                }
                appendLog(`${event.actor}의 스킬 발동!`, event.side);
            } else if (dispatchEffectType === "bonus_damage_knockback" && actorKey && event.detail?.hits?.length) {
                applySkillHits(event);
                const hit = event.detail.hits[0];
                const targetKey = findHitKey(hit.target);
                if (targetKey) {
                    applyKnockback(targetKey);
                    // 넉백(CC기) = 보라색 오라 + 넉백 아이콘(순간 표시 후 사라짐)
                    flashEffectAura(targetKey, "cc");
                    setStatusIcon(targetKey, "knockback", { source: `${event.actor}:knockback`, durationMs: MOMENT_ICON_MS });
                }
                appendLog(`${event.actor}의 스킬 발동!`, event.side);
            } else if (dispatchEffectType === "aoe_enemy_damage" && actorKey) {
                applySkillHits(event);
                spawnGasBreathStream(actorKey, () => {});
                appendLog(`${event.actor}의 스킬 발동!`, event.side);
            } else if (dispatchEffectType === "heal_ally_percent_max_hp" && event.detail?.healed) {
                const healTargetKey = findHitKey(event.detail.target);
                if (healTargetKey) {
                    spawnHealingHeart(healTargetKey, () => {
                        units[healTargetKey].hp = Math.min(units[healTargetKey].maxHp, units[healTargetKey].hp + event.detail.amount);
                        renderUnit(healTargetKey);
                        // 회복 = 연두색 오라 + 회복 아이콘(회복되는 순간 생겼다가 사라짐)
                        flashEffectAura(healTargetKey, "heal");
                        setStatusIcon(healTargetKey, "heal", { source: `${event.actor}:heal`, durationMs: MOMENT_ICON_MS });
                        appendLog(`${event.actor}의 스킬 발동! ${event.detail.target} 체력 ${event.detail.amount} 회복`, event.side);
                    });
                } else {
                    appendLog(`${event.actor}의 스킬 발동!`, event.side);
                }
            } else {
                applySkillHits(event);
                if (dispatchEffectType === "summon_clone" && event.detail?.summoned) {
                    appendLog(
                        event.detail.replaced
                            ? `${event.actor}의 복제체가 새로운 복제체로 교체 소환됨!`
                            : `${event.actor}의 복제체가 전장에 추가로 소환됨!`,
                        event.side
                    );
                } else {
                    appendLog(`${event.actor}의 스킬 발동!`, event.side);
                }
            }
        } else {
            // basic_attack (기존 로직 + 원거리 5명 전용 연출)
            const actorKey = eventActorKey(event);
            const targetKey = eventTargetKey(event);
            const actorIsMelee = actorKey && units[actorKey] && units[actorKey].isMelee;

            // 데이터(HP)는 이벤트 순서 그대로, 그 어떤 지연도 없이 여기서 곧바로 반영한다.
            if (targetKey) {
                units[targetKey].hp = event.target_hp_after;
            }
            if (actorIsMelee && targetKey) {
                meleeTargetKey[actorKey] = targetKey;
            }

            function applyHitVisual() {
                if (targetKey) {
                    renderUnit(targetKey);
                    flashHit(targetKey, event.is_crit, event.type_multiplier);
                }
                showDamageMessage(event);
            }

            if (actorIsMelee) {
                waitForMeleeArrival(actorKey, targetKey).then(() => {
                    if (actorKey) playAttackFrames(actorKey);
                    applyHitVisual();
                });
            } else if (actorKey && targetKey) {
                // 원거리는 공격 애니메이션(윈드업)을 먼저 시작하고, 3프레임쯤 재생된 뒤에야 투사체/이펙트가 나간다.
                // 대상이 등 뒤(자기 원거리 자리까지 파고든 적 등)에 있으면 사진을 반전시켜 그쪽으로 발사한다.
                faceToward(actorKey, targetKey);
                if (actorKey) playAttackFrames(actorKey);
                setTimeout(() => {
                    playRangedAttack(actorKey, targetKey, applyHitVisual);
                }, EFFECT_LAUNCH_DELAY_MS);
            } else {
                if (actorKey) playAttackFrames(actorKey);
                applyHitVisual();
            }
        }

        eventIndex += 1;

        const nextEvent = data.events[eventIndex];
        const delayMs = nextEvent
            ? Math.max(
                50,
                (nextEvent.time - event.time) *
                    1000 *
                    PLAYBACK_SPEED
            )
            : 500;

        setTimeout(playNext, delayMs);
    }

    function showResult() {
        walkerRunning = false;
        if (rosterOrderTimer) { clearInterval(rosterOrderTimer); rosterOrderTimer = null; }
        appendLog("전투 종료!", null);

        const resultEl = document.getElementById("battle-result");
        const textEl = document.getElementById("battle-result-text");

        if (!resultEl || !textEl) return;

        textEl.textContent = data.attacker_won ? "승리!" : "패배...";
        textEl.className =
            `battle-result-text ` +
            `${data.attacker_won ? "battle-win" : "battle-lose"}`;

        if (data.rank_changed) {
            textEl.textContent += ` 내 순위: ${data.my_new_rank}등`;
        }

        resultEl.hidden = false;

        const notifyAchievements = () => {
            if (typeof showAchievementToast === "function" && data.new_achievements?.length) {
                showAchievementToast(data.new_achievements);
            }
        };
        if (typeof showCharacterReveal === "function" && data.new_characters?.length) {
            showCharacterReveal(data.new_characters, notifyAchievements);
        } else {
            notifyAchievements();
        }
    }

    document
        .getElementById("battle-close-btn")
        ?.addEventListener("click", () => {
            window.location.href = "home.html";
        });

    /*
     * 준비 시간(1.3초) 카운트다운은 그대로 유지하되, 매 프레임마다 새 줄을 추가하는 대신
     * 로그의 '같은 한 줄'을 계속 갱신하다가, 끝나면 그 줄을 "전투 시작!"으로 확정한다.
     * (매 프레임 새 줄을 추가하면 로그가 수십~수백 줄로 순식간에 도배되기 때문)
     */
    function startPreparation() {
        const prepEntry = appendLog("전투 준비 중...", null);

        if (!prepEntry) {
            setTimeout(() => {
                startMeleeWalker();
                startRosterOrderWatcher();
                playNext();
            }, PREP_MS);
            return;
        }

        const startedAt = performance.now();

        function updatePreparation(now) {
            const elapsed = now - startedAt;
            const remainingMs = Math.max(0, PREP_MS - elapsed);
            const remainingSeconds = (remainingMs / 1000).toFixed(1);

            prepEntry.textContent =
                remainingMs > 0
                    ? `전투 준비 중... ${remainingSeconds}초`
                    : "전투 시작!";

            if (remainingMs > 0) {
                requestAnimationFrame(updatePreparation);
            }
        }

        requestAnimationFrame(updatePreparation);

        setTimeout(() => {
            prepEntry.textContent = "전투 시작!";

            startMeleeWalker();
            startRosterOrderWatcher();
            playNext();
        }, PREP_MS);
    }

    // 페이지 진입 즉시 화면 전체를 덮은 암전 위에 "입장하는 중..."(점 1~3개 반복)과 랜덤 팁을
    // 4초간 보여준 뒤에야 실제 전투 준비(startPreparation)를 시작한다.
    function showBattleEntrance(onDone) {
        const overlay = document.getElementById("battle-loading-overlay");
        if (!overlay) { onDone(); return; }

        const dotsEl = document.getElementById("battle-loading-dots");
        const tipEl = document.getElementById("battle-loading-tip");
        if (tipEl) tipEl.textContent = BATTLE_TIPS[Math.floor(Math.random() * BATTLE_TIPS.length)];

        let dotCount = 1;
        if (dotsEl) dotsEl.textContent = ".";
        const dotTimer = setInterval(() => {
            dotCount = (dotCount % 3) + 1;
            if (dotsEl) dotsEl.textContent = ".".repeat(dotCount);
        }, BATTLE_ENTRANCE_DOT_MS);

        setTimeout(() => {
            clearInterval(dotTimer);
            overlay.hidden = true;
            onDone();
        }, BATTLE_ENTRANCE_MS);
    }

    showBattleEntrance(startPreparation);
})();