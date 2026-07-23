// devtest.js - 개발자 전용 스킬/밸런스 테스트 창. 로비와 전혀 연결돼 있지 않다.
// arena-battle.js의 재생 로직(공격 프레임/투사체/근거리 이동)을 참고해 옮겨 적었고,
// cast_start/skill_resolve 이벤트 재생 + 원거리 5명 전용 연출 + 수동 버튼(서버 왕복 없음)이 추가됐다.
(function () {
    "use strict";

    // API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
    const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;

    const PLAYBACK_SPEED = 0.8;
    const PROJECTILE_TRAVEL_MS = 220;
    const MAX_ATTACK_FRAMES = 6;
    const MAX_SKILL_FRAMES = 9; // 스킬 시전 전용 사진은 캐릭터당 총 9장까지 넣기로 확정됨(arena-battle.js와 동일)
    const ATTACK_FRAME_DURATION_MS = 60;
    const EFFECT_LAUNCH_DELAY_MS = ATTACK_FRAME_DURATION_MS * 3; // 원거리 공격: 애니메이션 3프레임쯤 재생된 뒤 이펙트 발사
    const MOVE_STEP_PX = 4;
    const ARRIVE_THRESHOLD_PX = 2;
    const CRIT_CHANCE = 0.10;      // battle_engine.py의 CRIT_CHANCE와 동일 - 수동 버튼도 서버와 같은 확률로 흉내낸다
    const CRIT_MULTIPLIER = 1.5;

    // 원거리 5명 전용 기본공격 연출. 여기 없는(=근거리이거나 목록에 없는) 캐릭터는 기존 걷기+공격프레임 그대로.
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

    const SLOTS = ["attacker-front", "attacker-back", "defender-front", "defender-back"];

    // 수동 "스킬 사용" 버튼용 - battle_engine.py의 계산식을 그대로 흉내낸다(서버 왕복 없이 로컬에서 즉시 적용).
    const STAR_BASE_STATS = { 1: { hp: 100, atk: 10 }, 2: { hp: 200, atk: 20 }, 3: { hp: 300, atk: 30 }, 4: { hp: 400, atk: 40 }, 5: { hp: 500, atk: 50 }, 6: { hp: 600, atk: 60 } };
    const TYPE_ADVANTAGE = { Parent: "Teacher", Student: "Parent", Teacher: "Student" };

    // hp는 원거리 기준값, atk는 근거리 기준값 - 반대쪽 사거리는 1.5배(battle_engine.py의 RANGE_STAT_MULTIPLIER와 동일).
    function computeBaseStats(star, level, isMelee) {
        const base = STAR_BASE_STATS[star] || STAR_BASE_STATS[1];
        const rangedHp = base.hp + level * 20;
        const meleeAtk = base.atk + level * 2;
        if (isMelee) return { hp: Math.round(rangedHp * 1.5), atk: meleeAtk };
        return { hp: rangedHp, atk: Math.round(meleeAtk * 1.5) };
    }

    function getTypeMultiplier(attackType, defenseType) {
        if (attackType === defenseType) return 1.0;
        if (TYPE_ADVANTAGE[attackType] === defenseType) return 1.5;
        return 0.7;
    }

    let characterCatalog = [];
    let units = {}; // slot -> {name, maxHp, hp, atk, isMelee, outfit, style, attackType, defenseType, gender, status}
    let activeSlot = null;
    const attackAnimActive = {};
    const attackAnimTokens = {};
    const frameCountCache = {};
    const skillFrameCountCache = {};
    const meleeTargetKey = {};
    const meleeArrived = {};
    const pendingArrivalResolvers = {};
    const approachGapExtra = {}; // slot -> 접근을 얼마나 덜(뒤에서) 멈출지 - 복제체 뒤에 서는 윤영준 등(arena-battle.js와 동일)
    let walkerRunning = false;
    let advancedSlot = {}; // slot -> bool, "이동" 버튼으로 앞으로 나간 상태인지(토글)

    // ===== 바라보는 방향(스프라이트 반전) - arena-battle.js와 동일한 로직 =====
    const facingFlipped = {};
    function isFacingFlipped(slot) {
        if (facingFlipped[slot] === undefined) facingFlipped[slot] = slot.startsWith("defender");
        return facingFlipped[slot];
    }
    function setFacing(slot, flipped) {
        if (facingFlipped[slot] === flipped) return;
        facingFlipped[slot] = flipped;
        document.querySelector(`[data-unit="${slot}"] .battle-unit-img`)?.classList.toggle("flipped", flipped);
    }
    function faceToward(slot, targetSlot) {
        const el = document.querySelector(`[data-unit="${slot}"]`);
        const targetEl = document.querySelector(`[data-unit="${targetSlot}"]`);
        if (!el || !targetEl) return;
        const rect = el.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const targetIsLeft = (targetRect.left + targetRect.width / 2) < (rect.left + rect.width / 2);
        setFacing(slot, targetIsLeft);
    }

    function authHeaders() {
        const manualToken = document.getElementById("dt-token-input").value.trim();
        const token = manualToken || localStorage.getItem("access_token");
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    // 특성 발동 로그 문구 - arena-battle.js의 traitLogText와 동일 규칙(실제 변경된 수치까지 표시).
    function traitLogText(event) {
        const d = event.detail || {};
        if (event.effect_type === "ally_synergy_remove_absorb") {
            return `${event.actor}의 특성 발동! ${d.removed}을(를) 흡수하여 공격력·최대체력 ${d.absorb_percent}% 증가`;
        }
        if (event.effect_type === "ally_synergy_atk_buff") {
            return `${event.actor}의 특성 발동! ${d.partner}와(과)의 시너지로 공격력 ${d.atk_percent}% 증가`;
        }
        return `${event.actor}의 특성 발동! (${event.effect_type}) ${JSON.stringify(d)}`;
    }

    function log(text) {
        const el = document.getElementById("dt-log");
        if (!el) return;
        const line = document.createElement("div");
        line.textContent = text;
        el.appendChild(line);
        el.scrollTop = el.scrollHeight;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function configEl(slot) {
        return document.querySelector(`.dt-unit-config[data-slot="${slot}"]`);
    }

    function catalogOf(name) {
        return characterCatalog.find((c) => c.name === name);
    }

    // ───────────────────────── 초기화: 캐릭터 목록 불러와서 셀렉트 채우기 ─────────────────────────

    async function loadCatalog() {
        const res = await fetch(`${API_BASE_URL}/devtest/characters`, { headers: authHeaders() });
        if (!res.ok) {
            log(`캐릭터 목록을 불러오지 못했습니다 (${res.status}). 토큰을 확인하세요.`);
            return;
        }
        characterCatalog = await res.json();

        SLOTS.forEach((slot) => {
            const cfg = configEl(slot);
            const charSelect = cfg.querySelector(".dt-char-select");
            const starSelect = cfg.querySelector(".dt-star-select");

            charSelect.innerHTML = characterCatalog
                .map((c) => `<option value="${c.name}">${c.name} (${c.rarity})</option>`)
                .join("");
            starSelect.innerHTML = [1, 2, 3, 4, 5, 6].map((s) => `<option value="${s}">${s}성</option>`).join("");

            const defaultChar = characterCatalog[SLOTS.indexOf(slot) % characterCatalog.length];
            charSelect.value = defaultChar.name;
            starSelect.value = String(defaultChar.start_star);

            charSelect.addEventListener("change", () => onUnitConfigChange(slot));
            starSelect.addEventListener("change", () => onUnitConfigChange(slot));

            onUnitConfigChange(slot);
        });
    }

    function newStatus() {
        return { atkPercentBonus: 0, atkPercentDebuff: 0, debuffUntil: 0, stunUntil: 0, shieldUntil: 0, stackCount: 0 };
    }

    function onUnitConfigChange(slot) {
        const cfg = configEl(slot);
        const name = cfg.querySelector(".dt-char-select").value;
        const star = Number(cfg.querySelector(".dt-star-select").value);
        const catalog = catalogOf(name);
        if (!catalog) return;

        const skillParamsEl = cfg.querySelector(".dt-skill-params");
        const skillMech = catalog.skill_mechanics;
        const starParams = skillMech ? skillMech.params[String(star)] : null;
        skillParamsEl.value = starParams ? JSON.stringify(starParams, null, 2) : "";

        const outfit = catalog.outfits?.["기본"];
        const isMelee = catalog.range === "근거리";
        const style = RANGED_ATTACK_STYLE[name] || (isMelee ? "melee" : "straight");

        // HP/ATK override 입력이 있으면 그 값을, 없으면 실제 서버 공식(STAR_BASE_STATS + 레벨)으로 기본값을 계산한다.
        const level = Number(cfg.querySelector(".dt-level-input").value) || 1;
        const base = computeBaseStats(star, level, isMelee);
        const hpOverride = cfg.querySelector(".dt-hp-input").value;
        const atkOverride = cfg.querySelector(".dt-atk-input").value;
        const maxHp = hpOverride ? Number(hpOverride) : base.hp;
        const atk = atkOverride ? Number(atkOverride) : base.atk;

        units[slot] = {
            name, maxHp, hp: maxHp, atk, isMelee, outfit, style, star,
            attackType: catalog.attack_type || "Student",
            defenseType: catalog.defense_type || "Student",
            gender: catalog.gender,
            status: newStatus(),
        };
        advancedSlot[slot] = false;
        clearAllStatusIcons(slot); // 캐릭터/성급이 바뀌면 이전 유닛의 상태 아이콘은 의미가 없으니 지운다
        renderUnit(slot);
    }

    // ───────────────────────── 렌더링(정지 화면) ─────────────────────────

    // slot별로 사망 연출을 이미 재생했는지 - 한 번만 재생되도록 막는다.
    const deathHandled = {};

    // 사망 시: 로그 한 줄 + 사망 디폴트 사진(death.png, 아직 없으면 idle 사진을 흑백으로 임시 대체) +
    // 투명해지면서 가로 실선 무늬로 스캔되듯 사라지는 연출. (arena-battle.js의 playDeathSequence와 동일)
    function playDeathSequence(slot) {
        const unit = units[slot];
        const imgEl = document.querySelector(`[data-unit="${slot}"] .battle-unit-img`);
        if (!unit || !imgEl) return;

        log(`${unit.name} 사망!`);

        imgEl.classList.remove("death-fallback-filter");
        imgEl.onerror = () => {
            imgEl.onerror = null;
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.png`;
            imgEl.classList.add("death-fallback-filter");
        };
        imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/death.png`;

        imgEl.classList.add("dying");
    }

    function renderUnit(slot) {
        const unit = units[slot];
        const el = document.querySelector(`[data-unit="${slot}"]`);
        if (!el || !unit) return;

        const isDead = unit.hp <= 0;
        const imgEl = el.querySelector(".battle-unit-img");

        if (isDead) {
            if (imgEl && !deathHandled[slot]) {
                deathHandled[slot] = true;
                playDeathSequence(slot);
                clearAllStatusIcons(slot);
            }
        } else {
            deathHandled[slot] = false;

            if (imgEl) {
                // .dying은 animation-fill-mode:forwards라서 죽었다가 살아난(=슬롯이 재사용된) 유닛에게
                // 그대로 남아있으면 새 스프라이트가 계속 투명하게 보인다 - 살아있을 땐 반드시 지운다.
                imgEl.classList.remove("dying", "death-fallback-filter");

                if (!attackAnimActive[slot]) {
                    imgEl.onerror = () => {
                        imgEl.onerror = null;
                        imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/idle.png`;
                    };
                    imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/battle_idle.png`;
                    imgEl.classList.toggle("flipped", isFacingFlipped(slot)); // 방향은 전투 중 동적으로 바뀔 수 있음
                }
            }
        }

        const hpFillEl = el.querySelector(".dt-unit-hp-fill");
        if (hpFillEl) {
            const percent = Math.max(0, (unit.hp / unit.maxHp) * 100);
            hpFillEl.style.width = `${percent}%`;
        }

        el.classList.toggle("battle-unit-dead", isDead);
    }

    function renderAll() {
        SLOTS.forEach(renderUnit);
    }

    // ───────────────────────── 유닛 선택(클릭) -> 활성 유닛 ─────────────────────────

    function setupUnitSelection() {
        // summon(복제체) 슬롯도 소환된 뒤에는 클릭으로 활성 유닛 선택이 가능해야 한다.
        [...SLOTS, "attacker-summon", "defender-summon"].forEach((slot) => {
            const el = document.querySelector(`[data-unit="${slot}"]`);
            if (!el) return;
            el.addEventListener("click", () => {
                if (!units[slot]) return;
                document.querySelectorAll(".battle-unit").forEach((u) => u.classList.remove("dt-selected"));
                el.classList.add("dt-selected");
                activeSlot = slot;
                document.getElementById("dt-active-unit-name").textContent = `${units[slot]?.name || slot} (${slot})`;
            });
        });
    }

    function opponentFrontSlot(slot) {
        return slot.startsWith("attacker") ? "defender-front" : "attacker-front";
    }

    // 최재혁은 ★3부터 후방 적을 우선 공격한다(battle_engine.py의 _select_basic_attack_target과 동일 규칙).
    // 일반 유닛은 적 전방을 향해 걷다가 첫 공격 이벤트로 실제 타겟으로 재조정되지만, 최재혁은 처음부터
    // 실제 목표(후방)를 알고 있으므로 그 재조정("뜸들임")을 건너뛰고 곧장 걸어간다.
    function initialMeleeTargetKey(slot) {
        const enemySide = slot.startsWith("attacker") ? "defender" : "attacker";
        const unit = units[slot];
        if (unit?.name === "최재혁" && (unit.star || 1) >= 3) {
            return `${enemySide}-back`;
        }
        return `${enemySide}-front`;
    }

    function sideOf(slot) {
        return slot.startsWith("attacker") ? "attacker" : "defender";
    }

    // ───────────────────────── 수동 "스킬 사용" 전용 - 실제 효과 계산(battle_engine.py의 13개 핸들러를 그대로 흉내) ─────────────────────────

    function teammateSlot(slot) {
        return slot.endsWith("front") ? slot.replace("front", "back") : slot.replace("back", "front");
    }

    // summon(복제체) 슬롯도 상대 팀의 유효한 대상이다 - front/back과 별개로 존재하는 3번째 자리.
    function enemySlots(slot) {
        const enemySide = slot.startsWith("attacker") ? "defender" : "attacker";
        return [`${enemySide}-front`, `${enemySide}-back`, `${enemySide}-summon`];
    }

    // 복제체(미끼)가 있으면 front/back 배치와 무관하게 항상 최우선 타겟이 된다 - battle_engine.py의 _alive_units와 동일한 규칙.
    function aliveEnemyUnits(slot) {
        const alive = enemySlots(slot).filter((s) => units[s] && units[s].hp > 0);
        alive.sort((a, b) => (units[a].isClone ? 0 : 1) - (units[b].isClone ? 0 : 1));
        return alive;
    }

    function aliveEnemyTarget(slot) {
        const units_ = aliveEnemyUnits(slot);
        return units_.length ? units_[0] : null;
    }

    function effectiveAtk(slot) {
        const u = units[slot];
        if (!u) return 0;
        const now = performance.now();
        const debuff = u.status.debuffUntil > now ? u.status.atkPercentDebuff : 0;
        return Math.round(u.atk * (1 + u.status.atkPercentBonus / 100 - debuff / 100));
    }

    function applyDamage(targetSlot, amount) {
        const u = units[targetSlot];
        if (!u) return 0;
        if (u.status.shieldUntil > performance.now()) amount = 0;
        amount = Math.max(0, Math.round(amount));
        u.hp = Math.max(0, u.hp - amount);
        return amount;
    }

    // battle_engine.py의 _roll_damage_atk와 동일 - 피해 공식을 쓸 땐 effectiveAtk 대신 이걸로 공격력을
    // 구하면 10% 확률로 치명타(공격력 1.5배)가 함께 적용된다. [공격력, 치명타여부]를 돌려준다.
    function rollDamageAtk(slot) {
        const atk = effectiveAtk(slot);
        const isCrit = Math.random() < CRIT_CHANCE;
        return [isCrit ? Math.round(atk * CRIT_MULTIPLIER) : atk, isCrit];
    }

    function hitVisual(slot, isCrit, typeMultiplier) {
        renderUnit(slot);
        flashHit(slot, isCrit, typeMultiplier);
    }

    // 캐릭터 하나가 이번 성급에 실제 스킬을 갖고 있는지(있으면 {effect_type, params}) 조회 - copy_target_skill(강승유)에서 씀.
    function skillMechanicsOf(name, star) {
        const catalog = catalogOf(name);
        const mech = catalog?.skill_mechanics;
        const params = mech ? mech.params[String(star)] : null;
        return mech && params ? { effectType: mech.effect_type, params } : null;
    }

    const MANUAL_SKILL_HANDLERS = {
        self_stack_buff(casterSlot, params) {
            const u = units[casterSlot];
            if (u.status.stackCount < params.max_stacks) u.status.stackCount += 1;
            u.status.atkPercentBonus = u.status.stackCount * params.percent_per_stack;
            return { text: `공격력 +${u.status.atkPercentBonus}% (스택 ${u.status.stackCount})` };
        },

        summon_clone(casterSlot, params) {
            // 복제체는 기존 전방/후방 아군을 대체하지 않는 3번째 유닛 - 캐스터와 같은 편의 전용 summon 슬롯에
            // 매번 새로 생성한다(이전 복제체가 있었다면 그것만 교체되고, 살아있는 아군은 절대 제거되지 않는다).
            const side = sideOf(casterSlot);
            const cloneSlot = `${side}-summon`;
            const replaced = units[cloneSlot];

            const caster = units[casterSlot];
            const cloneMaxHp = Math.round(caster.maxHp * params.hp_percent / 100);
            const cloneAtk = Math.round(caster.atk * params.atk_percent / 100);
            units[cloneSlot] = {
                name: `${caster.name}의 복제체`, maxHp: cloneMaxHp, hp: cloneMaxHp, atk: cloneAtk,
                isMelee: caster.isMelee, outfit: caster.outfit, style: caster.style,
                attackType: caster.attackType, defenseType: caster.defenseType, gender: caster.gender,
                status: newStatus(), isClone: true,
            };

            const cloneEl = document.querySelector(`[data-unit="${cloneSlot}"]`);
            const casterEl = document.querySelector(`[data-unit="${casterSlot}"]`);
            if (cloneEl) {
                cloneEl.hidden = false;
                cloneEl.style.transform = "";
                // 복제체는 캐스터가 서 있던 바로 그 자리를 차지한다(arena-battle.js와 동일).
                if (casterEl) {
                    const cloneRect = cloneEl.getBoundingClientRect();
                    const casterRect = casterEl.getBoundingClientRect();
                    cloneEl.style.transform = `translateX(${casterRect.left - cloneRect.left}px)`;
                }
            }
            // 원본(캐스터)은 복제체보다 뒤로 물러난다 - 스프라이트 폭만큼만, 부드럽게(CSS 트랜지션).
            if (casterEl) {
                const retreatSign = side === "attacker" ? -1 : 1;
                const spriteWidth = casterEl.querySelector(".battle-unit-img")?.getBoundingClientRect().width || 130;
                const casterX = getCurrentTranslateX(casterEl);
                casterEl.style.transition = "transform 320ms ease-out";
                requestAnimationFrame(() => {
                    casterEl.style.transform = `translateX(${casterX + retreatSign * spriteWidth}px)`;
                });
                setTimeout(() => { casterEl.style.transition = ""; }, 340);
                approachGapExtra[casterSlot] = spriteWidth;
                meleeArrived[casterSlot] = false;
            }
            attackAnimActive[cloneSlot] = false;
            getAttackFrameCount(units[cloneSlot].outfit);
            renderUnit(cloneSlot);
            document.querySelector(`[data-unit="${cloneSlot}"] .battle-unit-img`)?.classList.add("is-clone");

            if (units[cloneSlot].isMelee) {
                meleeTargetKey[cloneSlot] = opponentFrontSlot(cloneSlot);
                meleeArrived[cloneSlot] = false;
                if (!walkerRunning) startMeleeWalker();
            }

            return {
                text: replaced
                    ? `복제체가 새로운 복제체로 교체 소환됨! (HP ${cloneMaxHp} / ATK ${cloneAtk})`
                    : `복제체가 전장에 추가로 소환됨! (HP ${cloneMaxHp} / ATK ${cloneAtk})`,
            };
        },

        conditional_target_debuff(casterSlot, params) {
            const targetSlot = aliveEnemyTarget(casterSlot);
            if (!targetSlot) return { text: "대상 없음" };
            const target = units[targetSlot];
            const now = performance.now();

            // 공격 속도 증가는 대상 성별과 무관하게 항상 적용된다. 기절만 대상이 여성일 때 조건부로 걸린다.
            const caster = units[casterSlot];
            caster.status.hasteUntil = now + params.haste_seconds * 1000; // (수동 모드는 단발성이라 표시용 - 실시간 공격주기엔 반영 안 됨)
            caster.status.hastePercent = params.haste_percent;

            const conditionMet = params.condition !== "target_gender_female" || target.gender === "여";
            if (conditionMet) {
                target.status.stunUntil = now + params.stun_seconds * 1000;
                renderUnit(targetSlot);
            }

            return {
                text: conditionMet
                    ? `${target.name} ${params.stun_seconds}초 기절 + 자신 공속 ${params.haste_percent}% 증가`
                    : `${target.name}은(는) 여성이 아니라 기절 없음 (자신 공속 ${params.haste_percent}% 증가는 적용됨)`,
                targetSlot, stunned: conditionMet,
            };
        },

        heal_ally_percent_max_hp(casterSlot, params) {
            const allySlot = teammateSlot(casterSlot);
            const ally = units[allySlot];
            if (!ally || ally.hp <= 0) return { text: "회복 대상 없음" };
            const heal = Math.round(ally.maxHp * params.percent / 100);
            ally.hp = Math.min(ally.maxHp, ally.hp + heal);
            renderUnit(allySlot);
            return { text: `${ally.name} 체력 ${heal} 회복`, targetSlot: allySlot };
        },

        self_shield_duration(casterSlot, params) {
            units[casterSlot].status.shieldUntil = performance.now() + params.seconds * 1000;
            return { text: `${params.seconds}초간 무적 실드` };
        },

        bonus_damage_knockback(casterSlot, params) {
            const targetSlot = aliveEnemyTarget(casterSlot);
            if (!targetSlot) return { text: "대상 없음" };
            const typeMult = getTypeMultiplier(units[casterSlot].attackType, units[targetSlot].defenseType);
            const [atk, isCrit] = rollDamageAtk(casterSlot);
            const damage = atk * params.multiplier / 100 * typeMult;
            const dealt = applyDamage(targetSlot, damage);
            hitVisual(targetSlot, isCrit, typeMult);
            return { text: `${units[targetSlot].name}에게 ${dealt} 피해(밀쳐내기)${isCrit ? " 치명타!" : ""}`, targetSlot };
        },

        aoe_gendered_damage(casterSlot, params) {
            const caster = units[casterSlot];
            const parts = [];
            const hits = [];
            aliveEnemyUnits(casterSlot).forEach((slot) => {
                const t = units[slot];
                const mult = t.gender === "여" ? params.female_multiplier : params.male_multiplier;
                const typeMult = getTypeMultiplier(caster.attackType, t.defenseType);
                const [atk, isCrit] = rollDamageAtk(casterSlot);
                const dealt = applyDamage(slot, atk * mult / 100 * typeMult);
                hitVisual(slot, isCrit, typeMult);
                parts.push(`${t.name} ${dealt}${isCrit ? "(치명타!)" : ""}`);
                hits.push({ targetSlot: slot, gender: t.gender });
            });
            return { text: `광역 피해: ${parts.join(", ") || "대상 없음"}`, hits };
        },

        copy_target_skill(casterSlot, params) {
            const targetSlot = aliveEnemyTarget(casterSlot);
            if (!targetSlot) return { text: "대상 없음" };
            const targetName = units[targetSlot].name.split("의 복제체")[0];
            const targetStar = Number(configEl(targetSlot)?.querySelector(".dt-star-select")?.value);
            const copied = skillMechanicsOf(targetName, targetStar);

            if (copied && MANUAL_SKILL_HANDLERS[copied.effectType]) {
                const potency = params.potency_percent / 100;
                const scaledParams = {};
                Object.entries(copied.params).forEach(([k, v]) => { scaledParams[k] = typeof v === "number" ? v * potency : v; });
                const result = MANUAL_SKILL_HANDLERS[copied.effectType](casterSlot, scaledParams);
                // targetSlot/hits/stunned 등 원본 핸들러의 결과 필드를 그대로 물려줘야, 바깥 dispatch(setupSkillButton)가
                // 복제된 스킬의 실제 전용 연출(투사체/실드링/치유하트 등)을 원본과 동일하게 재생할 수 있다.
                return { ...result, text: `[${copied.effectType} 복제] ${result.text}`, copiedEffectType: copied.effectType };
            }

            const typeMult = getTypeMultiplier(units[casterSlot].attackType, units[targetSlot].defenseType);
            const [atk, isCrit] = rollDamageAtk(casterSlot);
            const dealt = applyDamage(targetSlot, atk * params.fallback_multiplier / 100 * typeMult);
            hitVisual(targetSlot, isCrit, typeMult);
            return { text: `복제할 스킬 없음 - ${units[targetSlot].name}에게 ${dealt} 피해${isCrit ? " 치명타!" : ""}` };
        },

        stun_target(casterSlot, params) {
            const targetSlot = aliveEnemyTarget(casterSlot);
            if (!targetSlot) return { text: "대상 없음" };
            units[targetSlot].status.stunUntil = performance.now() + params.seconds * 1000;
            renderUnit(targetSlot);
            return { text: `${units[targetSlot].name} ${params.seconds}초 기절`, targetSlot };
        },

        aoe_enemy_damage(casterSlot, params) {
            const caster = units[casterSlot];
            const parts = [];
            aliveEnemyUnits(casterSlot).forEach((slot) => {
                const t = units[slot];
                const typeMult = getTypeMultiplier(caster.attackType, t.defenseType);
                const [atk, isCrit] = rollDamageAtk(casterSlot);
                const dealt = applyDamage(slot, atk * params.multiplier / 100 * typeMult);
                hitVisual(slot, isCrit, typeMult);
                parts.push(`${t.name} ${dealt}${isCrit ? "(치명타!)" : ""}`);
            });
            return { text: `적 전체 피해: ${parts.join(", ") || "대상 없음"}` };
        },

        damage_hp_percent_plus_atk(casterSlot, params) {
            const targetSlot = aliveEnemyTarget(casterSlot);
            if (!targetSlot) return { text: "대상 없음" };
            const target = units[targetSlot];
            const [atk, isCrit] = rollDamageAtk(casterSlot);
            const damage = target.hp * params.hp_percent / 100 + atk * params.atk_percent / 100;
            const dealt = applyDamage(targetSlot, damage);
            hitVisual(targetSlot, isCrit);
            return { text: `${target.name}에게 ${dealt} 피해${isCrit ? " 치명타!" : ""}`, targetSlot };
        },

        debuff_atk_and_damage(casterSlot, params) {
            const targetSlot = aliveEnemyTarget(casterSlot);
            if (!targetSlot) return { text: "대상 없음" };
            const target = units[targetSlot];
            target.status.atkPercentDebuff = params.atk_debuff_percent;
            target.status.debuffUntil = performance.now() + params.debuff_seconds * 1000;
            const typeMult = getTypeMultiplier(units[casterSlot].attackType, target.defenseType);
            const [atk, isCrit] = rollDamageAtk(casterSlot);
            const dealt = applyDamage(targetSlot, atk * params.multiplier / 100 * typeMult);
            hitVisual(targetSlot, isCrit, typeMult);
            return { text: `${target.name} 공격력 -${params.atk_debuff_percent}% + ${dealt} 피해${isCrit ? " 치명타!" : ""}`, targetSlot };
        },

        aoe_all_others_damage(casterSlot, params) {
            const caster = units[casterSlot];
            const parts = [];
            const allySlot = teammateSlot(casterSlot);
            if (units[allySlot] && units[allySlot].hp > 0) {
                const [atk, isCrit] = rollDamageAtk(casterSlot);
                const dealt = applyDamage(allySlot, atk * params.multiplier / 100);
                hitVisual(allySlot, isCrit);
                parts.push(`${units[allySlot].name} ${dealt}${isCrit ? "(치명타!)" : ""}`);
            }
            aliveEnemyUnits(casterSlot).forEach((slot) => {
                const t = units[slot];
                const typeMult = getTypeMultiplier(caster.attackType, t.defenseType);
                const [atk, isCrit] = rollDamageAtk(casterSlot);
                const dealt = applyDamage(slot, atk * params.multiplier / 100 * typeMult);
                hitVisual(slot, isCrit, typeMult);
                parts.push(`${t.name} ${dealt}${isCrit ? "(치명타!)" : ""}`);
            });
            return { text: `자신 제외 전원 피해: ${parts.join(", ") || "대상 없음"}` };
        },
    };

    // ───────────────────────── 공격 프레임(근거리 기본 연출, 원거리 공용 프레임 재생) ─────────────────────────

    function checkImageExists(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
        });
    }

    async function getAttackFrameCount(outfit) {
        if (frameCountCache[outfit] !== undefined) return frameCountCache[outfit];
        let count = 0;
        for (let i = 1; i <= MAX_ATTACK_FRAMES; i += 1) {
            const exists = await checkImageExists(`${OUTFIT_IMAGE_BASE}${outfit}/attack_${i}.png`);
            if (!exists) break;
            count = i;
        }
        frameCountCache[outfit] = count;
        return count;
    }

    // 시전 전용 프레임(skill_N.png)이 있는지 확인 - attack_N.png와 같은 규칙, outfit당 한 번만 확인 후 캐시.
    async function getSkillFrameCount(outfit) {
        if (skillFrameCountCache[outfit] !== undefined) return skillFrameCountCache[outfit];
        let count = 0;
        for (let i = 1; i <= MAX_SKILL_FRAMES; i += 1) {
            const exists = await checkImageExists(`${OUTFIT_IMAGE_BASE}${outfit}/skill_${i}.png`);
            if (!exists) break;
            count = i;
        }
        skillFrameCountCache[outfit] = count;
        return count;
    }

    async function playAttackFrames(slot) {
        const el = document.querySelector(`[data-unit="${slot}"]`);
        const imgEl = el?.querySelector(".battle-unit-img");
        const unit = units[slot];
        if (!el || !imgEl || !unit) return;

        const myToken = (attackAnimTokens[slot] = (attackAnimTokens[slot] || 0) + 1);
        attackAnimActive[slot] = true;
        const frameCount = await getAttackFrameCount(unit.outfit);
        if (attackAnimTokens[slot] !== myToken) return;

        if (frameCount === 0) {
            imgEl.classList.add("attacking");
            setTimeout(() => {
                imgEl.classList.remove("attacking");
                attackAnimActive[slot] = false;
            }, 300);
            return;
        }

        for (let i = 1; i <= frameCount; i += 1) {
            if (attackAnimTokens[slot] !== myToken) return;
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/attack_${i}.png`;
            await sleep(ATTACK_FRAME_DURATION_MS);
        }

        if (attackAnimTokens[slot] === myToken) {
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/battle_idle.png`;
            attackAnimActive[slot] = false;
        }
    }

    /*
     * 시전(캐스팅) 중 재생되는 프레임 애니메이션. 스킬 전용 프레임(skill_N.png)이 있으면 그걸 우선 쓰고,
     * 없으면 기본공격 프레임(attack_N.png)을 그대로 돌려쓴다. 짧은 프레임 묶음을 빠르게 반복 재생하는
     * 대신, 가진 프레임 수만큼을 시전 시간(durationMs) 전체에 고르게 늘려서 "한 번만" 재생한다 -
     * 그래서 시전이 길수록 프레임 하나하나가 더 천천히 넘어가고, 루프하는 느낌 없이 시전 시작부터
     * 끝까지 이어지는 애니메이션처럼 보인다.
     */
    async function playCastFrames(slot, durationMs) {
        const el = document.querySelector(`[data-unit="${slot}"]`);
        const imgEl = el?.querySelector(".battle-unit-img");
        const unit = units[slot];
        if (!el || !imgEl || !unit) return;

        const myToken = (attackAnimTokens[slot] = (attackAnimTokens[slot] || 0) + 1);
        attackAnimActive[slot] = true;

        const skillFrameCount = await getSkillFrameCount(unit.outfit);
        const usingSkillFrames = skillFrameCount > 0;
        const frameCount = usingSkillFrames ? skillFrameCount : await getAttackFrameCount(unit.outfit);
        const framePrefix = usingSkillFrames ? "skill" : "attack";

        if (attackAnimTokens[slot] !== myToken) return;

        if (frameCount === 0) {
            // 스킬/공격 프레임 이미지가 아예 없는 캐릭터는 기존처럼 펄스 글로우만으로 시전 표시.
            return;
        }

        const perFrameMs = durationMs / frameCount;

        for (let i = 1; i <= frameCount; i += 1) {
            if (attackAnimTokens[slot] !== myToken) return;
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/${framePrefix}_${i}.png`;
            await sleep(perFrameMs);
        }

        if (attackAnimTokens[slot] === myToken) {
            imgEl.src = `${OUTFIT_IMAGE_BASE}${unit.outfit}/battle_idle.png`;
            attackAnimActive[slot] = false;
        }
    }

    // 치명타 시 대상 머리 위에 "치명타!" 글자가 튀어오르듯 잠깐 떴다 사라진다.
    function showCritLabel(slot) {
        const layer = document.getElementById("projectile-layer");
        const imgEl = document.querySelector(`[data-unit="${slot}"] .battle-unit-img`);
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

    // 상성(유형 상성) 적중 시 대상 머리 위에 "Weak"(유리, 빨강)/"Resist"(불리, 파랑) 글자를 띄운다(arena-battle.js와 동일).
    function showTypeLabel(slot, kind) {
        const layer = document.getElementById("projectile-layer");
        const imgEl = document.querySelector(`[data-unit="${slot}"] .battle-unit-img`);
        if (!layer || !imgEl) return;
        const pos = fieldRelativeCenter(imgEl);
        const label = document.createElement("div");
        label.className = `type-label type-${kind}`;
        label.textContent = kind === "weak" ? "Weak" : "Resist";
        label.style.left = `${pos.x}px`;
        label.style.top = `${pos.y - 62}px`;
        layer.appendChild(label);
        setTimeout(() => label.remove(), 700);
    }

    function flashHit(slot, isCrit, typeMultiplier) {
        const imgEl = document.querySelector(`[data-unit="${slot}"] .battle-unit-img`);
        if (!imgEl) return;
        if (typeof typeMultiplier === "number") {
            if (typeMultiplier > 1) showTypeLabel(slot, "weak");
            else if (typeMultiplier < 1) showTypeLabel(slot, "resist");
        }
        if (isCrit) {
            imgEl.classList.add("crit-flash");
            showCritLabel(slot);
            setTimeout(() => imgEl.classList.remove("crit-flash"), 400);
            return;
        }
        imgEl.classList.add("hit-flash");
        setTimeout(() => imgEl.classList.remove("hit-flash"), 250);
    }

    // ===== 효과 수신자 오라(arena-battle.js와 동일) =====
    // 스킬 발동 순간 시전자가 카테고리 색으로 번쩍이던 예전 연출 대신, 효과를 "받은" 대상에게
    // 색 오라가 나왔다가 사라진다. CSS(.effect-aura-flash, arena-battle.css)를 그대로 재사용한다.
    const EFFECT_AURA_COLORS = {
        buff: "#ff4d3d", debuff: "#4d8bff", cc: "#b266ff", heal: "#4ee06a", special: "#ffffff",
    };
    function flashEffectAura(slot, kind) {
        const imgEl = document.querySelector(`[data-unit="${slot}"] .battle-unit-img`);
        const color = EFFECT_AURA_COLORS[kind];
        if (!imgEl || !color) return;
        imgEl.classList.remove("effect-aura-flash");
        void imgEl.offsetWidth;
        imgEl.style.setProperty("--effect-aura-color", color);
        imgEl.classList.add("effect-aura-flash");
    }

    // ===== 상태 아이콘(체력바 위, 왼쪽부터 채워짐) - arena-battle.js와 동일한 source-map 방식 =====
    // xN 배지는 서로 다른 원인이 동시에 겹칠 때만 오르고, 같은 원인의 반복(갱신)은 카운트를 늘리지 않는다.
    const STATUS_ICON_FILES = {
        atk_up: "Combat_Icon_Buff_ATK.png", maxhp_up: "Combat_Icon_Buff_MAXHP.png",
        atk_speed_up: "Combat_Icon_Buff_AttackSpeed.png", atk_down: "Combat_Icon_Debuff_ATK.png",
        maxhp_down: "Combat_Icon_Debuff_MAXHP.png", stun: "Combat_Icon_CC_Stunned.png",
        knockback: "Combat_Icon_CC_Knockback.png", heal: "Combat_Icon_Recovery_Heal.png",
        immune: "Combat_Icon_Special_ImmuneDamage.png",
    };
    const MOMENT_ICON_MS = 1200;
    const statusIconState = {}; // slot -> { iconId: { el, sources: Map<sourceKey, {weight, timer}> } }

    function renderStatusIconTotal(slot, iconId) {
        const entry = statusIconState[slot]?.[iconId];
        if (!entry) return;
        const total = [...entry.sources.values()].reduce((sum, s) => sum + s.weight, 0);
        const stackEl = entry.el.querySelector(".roster-status-stack");
        if (stackEl) { stackEl.hidden = total < 2; stackEl.textContent = `x${total}`; }
    }

    function setStatusIcon(slot, iconId, opts = {}) {
        const wrap = document.querySelector(`[data-unit="${slot}"] .dt-status-icons`);
        const file = STATUS_ICON_FILES[iconId];
        if (!wrap || !file) return;

        const state = (statusIconState[slot] = statusIconState[slot] || {});
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
            source.weight = weight;
        }

        if (source.timer) { clearTimeout(source.timer); source.timer = null; }
        if (opts.durationMs) {
            source.timer = setTimeout(() => clearStatusIconSource(slot, iconId, sourceKey), opts.durationMs);
        }
        renderStatusIconTotal(slot, iconId);
    }

    function clearStatusIconSource(slot, iconId, sourceKey) {
        const entry = statusIconState[slot]?.[iconId];
        const source = entry?.sources.get(sourceKey);
        if (!entry || !source) return;
        if (source.timer) clearTimeout(source.timer);
        entry.sources.delete(sourceKey);
        if (entry.sources.size === 0) {
            entry.el.remove();
            delete statusIconState[slot][iconId];
        } else {
            renderStatusIconTotal(slot, iconId);
        }
    }

    function clearAllStatusIcons(slot) {
        const state = statusIconState[slot];
        if (!state) return;
        Object.values(state).forEach((entry) => {
            entry.sources.forEach((source) => { if (source.timer) clearTimeout(source.timer); });
            entry.el.remove();
        });
        delete statusIconState[slot];
    }

    // 최재혁 전용(self_shield_duration) - 캐릭터를 감싸는 푸른 원형 보호막(arena-battle.js와 동일).
    function spawnShieldRing(slot, durationMs) {
        const unitEl = document.querySelector(`[data-unit="${slot}"]`);
        if (!unitEl) return;
        unitEl.querySelector(".shield-ring-wrap")?.remove();

        const wrap = document.createElement("div");
        wrap.className = "shield-ring-wrap";
        wrap.innerHTML = `<div class="shield-ring"></div>`;
        unitEl.appendChild(wrap);

        setTimeout(() => wrap.remove(), durationMs);
    }

    // ───────────────────────── 근거리 이동(전투 게시 재생용 - 실시간 도착 판정) ─────────────────────────

    // 대상이 자기 등 뒤(진영 기준 반대편)에 있어도 그쪽 면으로 붙는다 - 진행 방향이 고정돼있지 않다(arena-battle.js와 동일).
    function getGapToTarget(unitKey, targetKey) {
        const el = document.querySelector(`[data-unit="${unitKey}"]`);
        const targetEl = document.querySelector(`[data-unit="${targetKey}"]`);
        if (!el || !targetEl) return 0;
        const rect = el.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        // overlap이 클수록 "더 깊이 파고들어야"(겹쳐야) 도착 판정이 나서 결과적으로 더 가까이 멈춘다.
        // approachGapExtra는 반대로 "평소보다 더 멀리서(덜 파고들고) 멈춘다"는 뜻이라 overlap을 줄여야
        // 한다 - 늘리면 반대로 더 깊이 다가가야 도착 판정이 나서, 물러난 캐릭터가 도로 앞으로 끌려온다.
        const overlap = 100 - (approachGapExtra[unitKey] || 0);
        const myCenter = rect.left + rect.width / 2;
        const targetCenter = targetRect.left + targetRect.width / 2;
        return myCenter <= targetCenter
            ? (targetRect.left - rect.right) + overlap
            : (targetRect.right - rect.left) - overlap;
    }

    function getCurrentTranslateX(el) {
        const value = window.getComputedStyle(el).transform;
        if (!value || value === "none") return 0;
        const match = value.match(/matrix\(([^)]+)\)/);
        if (!match) return 0;
        return Number(match[1].split(",")[4]) || 0;
    }

    // 청년 전용(bonus_damage_knockback): 대상을 "후방으로 이동"한 것으로 취급한다 - 밀려난 뒤 원래
    // 자리로 되돌아오지 않고 그대로 남는다(arena-battle.js와 동일). CSS 트랜지션으로 한 번만 밀어내고
    // 손을 떼는 이유: walker의 tick()도 같은 요소의 인라인 transform을 매 프레임 덮어쓰는데, rAF
    // 루프끼리 계속 경합하면 값이 튈 수 있어서 여기서는 "한 번 점프시키고 끝"으로 처리한다. 정작 이
    // 대상과 접촉해야 했던 반대 진영 근거리 유닛들은 아래에서 명시적으로 "도착 취소" 처리해서, 다시
    // 걸어서 접근하는 과정을 반드시 거치게 한다(그동안은 waitForMeleeArrival이 공격을 막음).
    function applyKnockback(targetSlot) {
        const el = document.querySelector(`[data-unit="${targetSlot}"]`);
        if (!el) return;

        const knockDir = targetSlot.startsWith("attacker") ? -1 : 1;
        const KNOCK_DISTANCE = 170; // 후방 원거리 유닛이 맵 밖으로 밀려나지 않도록 줄임(arena-battle.js와 동일)
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

        const casterSidePrefix = targetSlot.startsWith("attacker") ? "defender" : "attacker";
        Object.keys(units).forEach((slot) => {
            if (!slot.startsWith(casterSidePrefix) || !units[slot] || !units[slot].isMelee) return;
            meleeArrived[slot] = false;
        });
    }

    function startMeleeWalker() {
        Object.keys(units).forEach((slot) => {
            if (!units[slot] || !units[slot].isMelee) return;
            meleeTargetKey[slot] = initialMeleeTargetKey(slot);
            meleeArrived[slot] = false;
        });
        walkerRunning = true;

        // summon(복제체) 슬롯은 전투 도중에 units에 새로 추가될 수 있으므로, 고정된 SLOTS 대신
        // 매 프레임 Object.keys(units)를 다시 읽어야 새로 생긴 유닛도 즉시 이동을 시작한다.
        function tick() {
            if (!walkerRunning) return;
            Object.keys(units).forEach((slot) => {
                if (!units[slot] || !units[slot].isMelee || units[slot].hp <= 0) return;
                const targetKey = meleeTargetKey[slot];
                if (!targetKey) return;
                const el = document.querySelector(`[data-unit="${slot}"]`);
                const imgEl = el?.querySelector(".battle-unit-img");
                const gap = getGapToTarget(slot, targetKey);

                if (Math.abs(gap) <= ARRIVE_THRESHOLD_PX) {
                    if (!meleeArrived[slot]) {
                        meleeArrived[slot] = true;
                        imgEl?.classList.remove("walking");
                        faceToward(slot, targetKey);
                        (pendingArrivalResolvers[slot] || []).forEach((resolve) => resolve());
                        pendingArrivalResolvers[slot] = [];
                    }
                    return;
                }
                meleeArrived[slot] = false;
                imgEl?.classList.add("walking");
                const step = Math.sign(gap) * Math.min(MOVE_STEP_PX, Math.abs(gap));
                setFacing(slot, step < 0);
                const currentX = getCurrentTranslateX(el);
                el.style.transform = `translateX(${currentX + step}px)`;
            });
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function waitForMeleeArrival(actorKey, targetKey) {
        if (!units[actorKey] || !units[actorKey].isMelee) return Promise.resolve();
        if (meleeTargetKey[actorKey] !== targetKey) {
            meleeTargetKey[actorKey] = targetKey;
            meleeArrived[actorKey] = false;
        }
        if (meleeArrived[actorKey]) return Promise.resolve();
        return new Promise((resolve) => {
            (pendingArrivalResolvers[actorKey] = pendingArrivalResolvers[actorKey] || []).push(resolve);
        });
    }

    // ───────────────────────── 원거리 연출: 직선 / 포물선 / 즉시 플래시 / 텍스트 파티클 ─────────────────────────

    function fieldRelativeCenter(el) {
        const fieldEl = document.querySelector(".battle-field");
        const fieldRect = fieldEl.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 - fieldRect.left, y: rect.top + rect.height / 2 - fieldRect.top };
    }

    function spawnProjectileStraight(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const dot = document.createElement("div");
        dot.className = "projectile-dot";
        dot.style.left = `${start.x}px`;
        dot.style.top = `${start.y}px`;
        layer.appendChild(dot);

        requestAnimationFrame(() => {
            dot.style.transition = `left ${PROJECTILE_TRAVEL_MS}ms linear, top ${PROJECTILE_TRAVEL_MS}ms linear`;
            dot.style.left = `${end.x}px`;
            dot.style.top = `${end.y}px`;
        });
        setTimeout(() => { dot.remove(); onArrive(); }, PROJECTILE_TRAVEL_MS);
    }

    // start->end 방향의 각도(도) - 회전이 필요한 투사체(크레파스/유성)에 쓴다.
    function angleDeg(start, end) {
        return Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
    }

    // 포물선 이동 공용 로직: 직선 보간 + 사인 곡선으로 위로 솟았다가 내려오는 오프셋을 매 프레임 계산한다.
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

    // 포물선: 직선 보간 + 시간에 따라 위로 솟았다가 내려오는 오프셋(사인 곡선)을 rAF로 매 프레임 계산한다.
    function spawnProjectileArc(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const dot = document.createElement("div");
        dot.className = "projectile-dot";
        layer.appendChild(dot);

        animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 70, onArrive);
    }

    // 김남옥 기본공격 전용: 원통형 크레파스 다트, 포물선. 대상이 전방이면 진분홍, 후방/복제체면 푸른색.
    function spawnCrayonProjectile(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const colorClass = targetSlot.endsWith("-front") ? "crayon-pink" : "crayon-blue";

        const dot = document.createElement("div");
        dot.className = `crayon-projectile ${colorClass}`;
        dot.style.transform = `rotate(${angleDeg(start, end)}deg)`;
        layer.appendChild(dot);

        animateArcMotion(dot, start, end, PROJECTILE_TRAVEL_MS * 1.6, 60, onArrive);
    }

    // 김남옥 스킬(엑스칼리버) 전용: 진분홍+푸른 크레파스 두 개가 나란히 직선으로 동시에 대상에게 날아간다.
    // 여성 대상(기절 성공)일 때만 재생된다 - 공격판정(기절 표시)은 이 투사체가 닿는 순간에 맞춘다.
    function playDualCrayonSkillProjectile(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const angle = angleDeg(start, end);
        const rad = (angle * Math.PI) / 180;
        const durationMs = PROJECTILE_TRAVEL_MS * 1.4;

        ["crayon-pink", "crayon-blue"].forEach((colorClass, i) => {
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
    function spawnMeteorProjectile(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
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

    // 강 희 스킬 전용: 얼굴 쪽에서 좁은 부채꼴 초록 입냄새(가스)가 맵 끝까지 길게 뻗어나간다(arena-battle.js와 동일).
    function spawnGasBreathStream(actorSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const fieldEl = document.querySelector(".battle-field");
        if (!layer || !actorImg || !fieldEl) { onArrive(); return; }

        const fieldRect = fieldEl.getBoundingClientRect();
        const isAttacker = actorSlot.startsWith("attacker");
        const start = fieldRelativeCenter(actorImg);
        start.y -= 60;
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
    function playElectricConnector(actorSlot, targetSlot, colorClass, radiusPx, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { if (onArrive) onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        const angle = angleDeg(start, end);

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

    // 서민석 기본공격 전용: 책 모양 투사체, 포물선(회전은 CSS 애니메이션이 알아서 함).
    function spawnBookProjectile(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const el = document.createElement("div");
        el.className = "book-projectile";
        layer.appendChild(el);

        animateArcMotion(el, start, end, PROJECTILE_TRAVEL_MS * 1.6, 70, onArrive);
    }

    // 서민석 스킬 전용: 하트 모양 투사체, 포물선. colorClass로 "heart-pink"(남성 대상)/"heart-red"(여성 대상) 지정.
    function spawnHeartProjectile(actorSlot, targetSlot, colorClass, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !actorImg || !targetImg) { onArrive(); return; }

        const start = fieldRelativeCenter(actorImg);
        const end = fieldRelativeCenter(targetImg);
        const el = document.createElement("div");
        el.className = `heart-projectile ${colorClass}`;
        el.textContent = "❤";
        layer.appendChild(el);

        animateArcMotion(el, start, end, PROJECTILE_TRAVEL_MS * 1.7, 90, onArrive);
    }

    // 이영웅 스킬 전용: 치유 대상 머리 위에서 초록색 하트(가운데 십자가, 노란 오라)가 천천히 내려온다(arena-battle.js와 동일).
    function spawnHealingHeart(targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
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

    // 윤대웅 전용: 이동하는 투사체 없이, 대상 위치에서 즉시 플래시만 터진다.
    function playInstantFlash(actorSlot, targetSlot, onArrive) {
        const layer = document.getElementById("projectile-layer");
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
        if (!layer || !targetImg) { onArrive(); return; }
        const pos = fieldRelativeCenter(targetImg);
        const flash = document.createElement("div");
        flash.className = "dt-instant-flash-dot";
        flash.style.left = `${pos.x}px`;
        flash.style.top = `${pos.y}px`;
        layer.appendChild(flash);
        setTimeout(() => flash.remove(), 250);
        setTimeout(onArrive, 80); // 플래시는 이동시간이 사실상 없으므로 아주 짧게만 대기
    }

    // 이종복 전용: "F", "=", "m", "a" 네 글자가 0.1초 간격으로 직선 발사된다.
    function playTextParticles(actorSlot, targetSlot, onArrive) {
        const letters = ["F", "=", "m", "a"];
        const layer = document.getElementById("projectile-layer");
        const actorImg = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
        const targetImg = document.querySelector(`[data-unit="${targetSlot}"] .battle-unit-img`);
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

    function playRangedAttack(actorSlot, targetSlot, onArrive) {
        const style = units[actorSlot]?.style || "straight";
        if (style === "arc") spawnProjectileArc(actorSlot, targetSlot, onArrive);
        else if (style === "instant_flash") playInstantFlash(actorSlot, targetSlot, onArrive);
        else if (style === "text_particles") playTextParticles(actorSlot, targetSlot, onArrive);
        else if (style === "crayon") spawnCrayonProjectile(actorSlot, targetSlot, onArrive);
        else if (style === "electric") playElectricConnector(actorSlot, targetSlot, "electric-blue", 5, onArrive);
        else if (style === "book") spawnBookProjectile(actorSlot, targetSlot, onArrive);
        else spawnProjectileStraight(actorSlot, targetSlot, onArrive);
    }

    // ───────────────────────── 수동 버튼: 기본 공격 / 이동 (서버 왕복 없음) ─────────────────────────

    function setupManualButtons() {
        document.getElementById("dt-basic-attack").addEventListener("click", () => {
            if (!activeSlot || !units[activeSlot]) { log("먼저 전장에서 캐릭터를 클릭해 활성 유닛을 선택하세요."); return; }
            const targetSlot = aliveEnemyTarget(activeSlot); // 복제체(미끼)가 있으면 그쪽이 우선 타겟
            if (!targetSlot) { log("대상이 없습니다."); return; }

            const actor = units[activeSlot];
            function applyHit() {
                const typeMult = getTypeMultiplier(actor.attackType, units[targetSlot].defenseType);
                const isCrit = Math.random() < CRIT_CHANCE; // 고정 데미지지만 치명타 연출은 실제와 같은 확률로 흉내낸다
                const dummyDamage = Math.round((isCrit ? 10 * CRIT_MULTIPLIER : 10) * typeMult); // 수동 테스트는 눈으로 느낌만 확인하는 용도라 정밀 계산 없이 고정값 기준 + 상성만 반영
                units[targetSlot].hp = Math.max(0, units[targetSlot].hp - dummyDamage);
                renderUnit(targetSlot);
                flashHit(targetSlot, isCrit, typeMult);
                log(`[수동] ${actor.name} 기본공격 -> ${units[targetSlot].name} (${dummyDamage} 피해)${isCrit ? " 치명타!" : ""}`);
            }

            if (actor.isMelee) {
                waitForMeleeArrival(activeSlot, targetSlot).then(() => {
                    playAttackFrames(activeSlot);
                    applyHit();
                });
                if (!walkerRunning) startMeleeWalker();
            } else {
                // 원거리는 공격 애니메이션(윈드업)을 먼저 시작하고, 3프레임쯤 재생된 뒤에야 이펙트가 나간다.
                faceToward(activeSlot, targetSlot);
                playAttackFrames(activeSlot);
                setTimeout(() => {
                    playRangedAttack(activeSlot, targetSlot, applyHit);
                }, EFFECT_LAUNCH_DELAY_MS);
            }
        });

        document.getElementById("dt-move").addEventListener("click", () => {
            if (!activeSlot || !units[activeSlot]) { log("먼저 전장에서 캐릭터를 클릭해 활성 유닛을 선택하세요."); return; }
            const el = document.querySelector(`[data-unit="${activeSlot}"]`);
            const forwardSign = activeSlot.startsWith("attacker") ? 1 : -1;
            advancedSlot[activeSlot] = !advancedSlot[activeSlot];
            const offset = advancedSlot[activeSlot] ? forwardSign * 120 : 0;
            el.style.transition = "transform 0.4s ease";
            el.style.transform = `translateX(${offset}px)`;
            log(`[수동] ${units[activeSlot].name} 이동 ${advancedSlot[activeSlot] ? "(전진)" : "(복귀)"}`);
        });

        document.getElementById("dt-use-skill").addEventListener("click", () => {
            if (!activeSlot || !units[activeSlot]) { log("먼저 전장에서 캐릭터를 클릭해 활성 유닛을 선택하세요."); return; }

            const cfg = configEl(activeSlot);
            const charName = cfg.querySelector(".dt-char-select").value;
            const star = cfg.querySelector(".dt-star-select").value;
            const catalog = catalogOf(charName);
            const skillMech = catalog?.skill_mechanics;
            const starDefaultParams = skillMech ? skillMech.params[star] : null;
            if (!skillMech || !starDefaultParams) {
                log(`${charName}은(는) ${star}성에 스킬이 없습니다.`);
                return;
            }

            let params = starDefaultParams;
            const raw = cfg.querySelector(".dt-skill-params").value.trim();
            if (raw) {
                try { params = JSON.parse(raw); } catch (err) { log(`스킬 파라미터 JSON 오류: ${err.message}`); return; }
            }

            const actorSlot = activeSlot;
            const imgEl = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
            imgEl?.classList.add("casting");
            // 강승유 전용: 시전 중에는 금빛 펄스 대신 무지개빛으로 물든다.
            if (units[actorSlot]?.name === "강승유") imgEl?.classList.add("casting-rainbow");
            const MANUAL_CAST_MS = 600;
            playCastFrames(actorSlot, MANUAL_CAST_MS);
            log(`[수동] ${units[actorSlot].name} 스킬 시전 시작 (${skillMech.effect_type})`);

            // 수동 모드는 실제 서버 캐스팅 시간 계산 없이 고정 지연만 흉내낸다 - 정확한 타이밍은 "전투 게시"로 확인.
            setTimeout(() => {
                imgEl?.classList.remove("casting", "casting-rainbow");
                // 시전 프레임 루프가 아직 돌고 있으면 즉시 멈추고 평상시 자세로 되돌린다.
                attackAnimTokens[actorSlot] = (attackAnimTokens[actorSlot] || 0) + 1;
                attackAnimActive[actorSlot] = false;
                if (imgEl && units[actorSlot]) {
                    imgEl.src = `${OUTFIT_IMAGE_BASE}${units[actorSlot].outfit}/battle_idle.png`;
                }
                // 실제 효과(데미지/버프/디버프/회복/기절/실드/소환)를 로컬 유닛 상태에 그대로 적용한다.
                const handler = MANUAL_SKILL_HANDLERS[skillMech.effect_type];
                const result = handler ? handler(actorSlot, params) : { text: "(이 효과 타입은 아직 수동 시뮬레이션이 없습니다)" };

                // 강승유(copy_target_skill)가 실제로 복제한 스킬은 result.copiedEffectType에 담겨온다 -
                // 있으면 그걸 기준으로 카테고리/전용 연출을 분기해서 원본 스킬과 동일하게 재생되게 한다.
                const dispatchEffectType = result.copiedEffectType || skillMech.effect_type;

                // 시전자 몸이 카테고리 색으로 번쩍이던 예전 연출은 제거 - 오라는 효과를 "받은" 대상에게만
                // 나왔다가 사라진다(arena-battle.js와 동일). 자기 자신에게 거는 효과(버프/실드)는
                // 시전자가 곧 수신자이므로 시전자에게 뜬다.
                if (dispatchEffectType === "self_stack_buff") {
                    flashEffectAura(actorSlot, "buff");
                    setStatusIcon(actorSlot, "atk_up", { source: `${actorSlot}:self_stack_buff`, weight: units[actorSlot].status.stackCount });
                } else if (dispatchEffectType === "self_shield_duration") {
                    flashEffectAura(actorSlot, "special");
                    setStatusIcon(actorSlot, "immune", { source: `${actorSlot}:self_shield_duration`, durationMs: params.seconds * 1000 });
                    spawnShieldRing(actorSlot, params.seconds * 1000);
                } else if (dispatchEffectType === "conditional_target_debuff") {
                    // 공격속도 증가는 대상 성별과 무관하게 항상 자신에게 적용된다.
                    flashEffectAura(actorSlot, "buff");
                    setStatusIcon(actorSlot, "atk_speed_up", { source: `${actorSlot}:haste`, durationMs: params.haste_seconds * 1000 });
                    if (result.stunned && result.targetSlot) {
                        playDualCrayonSkillProjectile(actorSlot, result.targetSlot, () => {
                            flashEffectAura(result.targetSlot, "cc");
                            setStatusIcon(result.targetSlot, "stun", { source: `${actorSlot}:stun`, durationMs: params.stun_seconds * 1000 });
                        });
                    }
                } else if (dispatchEffectType === "stun_target" && result.targetSlot) {
                    flashEffectAura(result.targetSlot, "cc");
                    setStatusIcon(result.targetSlot, "stun", { source: `${actorSlot}:stun`, durationMs: params.seconds * 1000 });
                } else if (dispatchEffectType === "damage_hp_percent_plus_atk" && result.targetSlot) {
                    spawnMeteorProjectile(actorSlot, result.targetSlot, () => {});
                } else if (dispatchEffectType === "aoe_gendered_damage" && result.hits) {
                    result.hits.forEach((hit) => {
                        spawnHeartProjectile(actorSlot, hit.targetSlot, hit.gender === "여" ? "heart-red" : "heart-pink", () => {});
                    });
                } else if (dispatchEffectType === "debuff_atk_and_damage" && result.targetSlot) {
                    playElectricConnector(actorSlot, result.targetSlot, "electric-yellow", 9, null);
                    flashEffectAura(result.targetSlot, "debuff");
                    setStatusIcon(result.targetSlot, "atk_down", { source: `${actorSlot}:atk_down`, durationMs: params.debuff_seconds * 1000 });
                } else if (dispatchEffectType === "bonus_damage_knockback" && result.targetSlot) {
                    applyKnockback(result.targetSlot);
                    flashEffectAura(result.targetSlot, "cc");
                    setStatusIcon(result.targetSlot, "knockback", { source: `${actorSlot}:knockback`, durationMs: MOMENT_ICON_MS });
                } else if (dispatchEffectType === "aoe_enemy_damage") {
                    spawnGasBreathStream(actorSlot, () => {});
                } else if (dispatchEffectType === "heal_ally_percent_max_hp" && result.targetSlot) {
                    spawnHealingHeart(result.targetSlot, () => {
                        flashEffectAura(result.targetSlot, "heal");
                        setStatusIcon(result.targetSlot, "heal", { source: `${actorSlot}:heal`, durationMs: MOMENT_ICON_MS });
                    });
                }

                log(`[수동] ${units[actorSlot].name} 스킬 발동! (${skillMech.effect_type}) - ${result.text}`);
            }, MANUAL_CAST_MS);
        });
    }

    // ───────────────────────── 전투 게시: 서버 실제 시뮬레이션 호출 후 재생 ─────────────────────────

    function collectUnitConfig(slot) {
        const cfg = configEl(slot);
        const character_name = cfg.querySelector(".dt-char-select").value;
        const star = Number(cfg.querySelector(".dt-star-select").value);
        const hp = cfg.querySelector(".dt-hp-input").value;
        const atk = cfg.querySelector(".dt-atk-input").value;
        const interval = cfg.querySelector(".dt-interval-input").value;
        const level = cfg.querySelector(".dt-level-input").value;
        const skillParamsRaw = cfg.querySelector(".dt-skill-params").value.trim();

        const body = { character_name, star };
        if (hp) body.hp_override = Number(hp);
        if (atk) body.atk_override = Number(atk);
        if (interval) body.attack_interval_override = Number(interval);
        if (level) body.level_override = Number(level);
        if (skillParamsRaw) {
            try {
                body.skill_params_override = JSON.parse(skillParamsRaw);
            } catch (err) {
                log(`[${slot}] 스킬 파라미터 JSON이 올바르지 않습니다: ${err.message}`);
            }
        }
        return body;
    }

    async function startBattle() {
        walkerRunning = false;
        SLOTS.forEach((slot) => clearAllStatusIcons(slot)); // 서버가 새로 보내는 이벤트로만 상태가 갱신되게, 수동으로 쌓아둔 건 초기화
        Object.keys(approachGapExtra).forEach((slot) => delete approachGapExtra[slot]);

        // 이전 전투에서 남아있던 복제체(summon)는 새 전투 시작 전에 완전히 지운다.
        ["attacker-summon", "defender-summon"].forEach((slot) => {
            delete units[slot];
            clearAllStatusIcons(slot);
            const el = document.querySelector(`[data-unit="${slot}"]`);
            if (el) {
                el.hidden = true;
                el.style.transform = "";
                el.querySelector(".battle-unit-img")?.classList.remove("is-clone");
            }
        });
        const body = {
            attacker_front: collectUnitConfig("attacker-front"),
            attacker_back: collectUnitConfig("attacker-back"),
            defender_front: collectUnitConfig("defender-front"),
            defender_back: collectUnitConfig("defender-back"),
        };

        log("전투 게시 요청 중...");
        let res;
        try {
            res = await fetch(`${API_BASE_URL}/devtest/battle`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify(body),
            });
        } catch (err) {
            log(`서버 연결 실패: ${err.message}`);
            return;
        }
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            log(`전투 게시 실패 (${res.status}): ${err.detail || "알 수 없는 오류"}`);
            return;
        }

        const data = await res.json();
        log(`전투 결과 수신 - 이벤트 ${data.events.length}개, 승자: ${data.attacker_won ? "공격" : "수비"}`);

        SLOTS.forEach((slot) => {
            const side = slot.startsWith("attacker") ? "attacker" : "defender";
            const part = slot.endsWith("front") ? "front" : "back";
            const raw = data[`${side}_team`][part];
            units[slot] = {
                name: raw.name, maxHp: raw.max_hp, hp: raw.max_hp, isMelee: raw.is_melee, outfit: raw.outfit, star: raw.star,
                style: RANGED_ATTACK_STYLE[raw.name] || (raw.is_melee ? "melee" : "straight"),
            };
            const el = document.querySelector(`[data-unit="${slot}"]`);
            el.style.transform = "translateX(0)";
            el.querySelector(".battle-unit-img")?.classList.remove("is-clone"); // 이전 전투에서 생긴 복제체 색감 초기화
        });
        renderAll();
        startMeleeWalker();
        playEvents(data.events, 0);
    }

    function findSlotByName(side, name) {
        const frontSlot = `${side}-front`;
        const backSlot = `${side}-back`;
        const summonSlot = `${side}-summon`;
        if (units[frontSlot]?.name === name) return frontSlot;
        if (units[backSlot]?.name === name) return backSlot;
        if (units[summonSlot]?.name === name) return summonSlot;
        return null;
    }

    // 스킬 이벤트의 target 이름만으로는 어느 편인지 알 수 없어서(자해 스킬도 있음) 양쪽을 다 찾아본다.
    function findHitSlot(actorSide, name) {
        const targetSide = actorSide === "attacker" ? "defender" : "attacker";
        return findSlotByName(targetSide, name) || findSlotByName(actorSide, name);
    }

    function playEvents(events, index) {
        if (index >= events.length) {
            log("=== 전투 종료 ===");
            walkerRunning = false;
            return;
        }

        const event = events[index];
        const actorSide = event.side;
        const targetSide = actorSide === "attacker" ? "defender" : "attacker";
        const actorSlot = event.actor ? findSlotByName(actorSide, event.actor) : null;

        if (event.event_type === "cast_start" && actorSlot && attackAnimActive[actorSlot]) {
            // 3번째 기본공격 직후 곧바로 자신의 시전으로 넘어가는 경우, 그 공격의 윈드업/프레임
            // 애니메이션이 아직 재생 중일 수 있다(attackAnimActive) - 그게 끝날 때까지 index를
            // 그대로 두고 짧은 간격으로 재시도한다.
            setTimeout(() => playEvents(events, index), 20);
            return;
        }

        if (event.event_type === "star_effect_resolve") {
            // 성급별 효과(전투 시작 시 1회) - 스탯이 오르내린 대상마다 해당 상태 아이콘을 켠다.
            // 전투 내내 유지되는 영구 효과라 지속시간 없이 사망 전까지 계속 떠 있는다.
            (event.detail?.changes || []).forEach((change) => {
                const changedSlot = findSlotByName(change.target_side, change.target);
                if (!changedSlot) return;
                const source = `${event.actor}:${event.effect_type}`;
                if (change.atk > 0) setStatusIcon(changedSlot, "atk_up", { source });
                if (change.atk < 0) setStatusIcon(changedSlot, "atk_down", { source });
                if (change.hp > 0) setStatusIcon(changedSlot, "maxhp_up", { source });
                if (change.hp < 0) setStatusIcon(changedSlot, "maxhp_down", { source });
                flashEffectAura(changedSlot, (change.atk < 0 || change.hp < 0) ? "debuff" : "buff");
            });
            log(`[성급효과] ${event.actor} (${event.effect_type}) ${JSON.stringify(event.detail?.changes)}`);
        } else if (event.event_type === "trait_resolve") {
            log(`[특성] ${traitLogText(event)}`);
            if (event.effect_type === "ally_synergy_remove_absorb" && event.detail?.removed) {
                const removedSlot = findSlotByName(actorSide, event.detail.removed);
                if (removedSlot) { units[removedSlot].hp = 0; renderUnit(removedSlot); }
                if (actorSlot) {
                    flashEffectAura(actorSlot, "buff");
                    setStatusIcon(actorSlot, "atk_up", { source: `${actorSlot}:${event.effect_type}` });
                    setStatusIcon(actorSlot, "maxhp_up", { source: `${actorSlot}:${event.effect_type}` });
                }
            } else if (event.effect_type === "ally_synergy_atk_buff" && actorSlot) {
                flashEffectAura(actorSlot, "buff");
                setStatusIcon(actorSlot, "atk_up", { source: `${actorSlot}:${event.effect_type}` });
            }
        } else if (event.event_type === "cast_start") {
            if (actorSlot) {
                const castImgEl = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
                castImgEl?.classList.add("casting");
                if (event.actor === "강승유") castImgEl?.classList.add("casting-rainbow");
                playCastFrames(actorSlot, event.duration * 1000 * PLAYBACK_SPEED);
            }
            log(`[캐스팅] ${event.actor} -> ${event.effect_type} (${event.duration.toFixed(2)}초)`);
        } else if (event.event_type === "skill_resolve") {
            // 강승유(copy_target_skill)는 event.effect_type이 항상 "copy_target_skill"로 찍히지만,
            // 실제로 복제한 원본 효과 이름은 detail.copied_effect_type에 들어있다 - 그게 있으면 그걸
            // 기준으로 연출을 분기해서, 복제한 스킬의 실제 전용 이펙트가 원본과 동일하게 나오게 한다.
            const dispatchEffectType = event.detail?.copied_effect_type || event.effect_type;
            if (actorSlot) {
                const imgEl = document.querySelector(`[data-unit="${actorSlot}"] .battle-unit-img`);
                imgEl?.classList.remove("casting", "casting-rainbow");
                // 시전 프레임 루프가 아직 돌고 있으면 즉시 멈추고 평상시 자세로 되돌린다(타이밍이 살짝 어긋나도 안전).
                attackAnimTokens[actorSlot] = (attackAnimTokens[actorSlot] || 0) + 1;
                attackAnimActive[actorSlot] = false;
                if (imgEl && units[actorSlot]) {
                    imgEl.src = `${OUTFIT_IMAGE_BASE}${units[actorSlot].outfit}/battle_idle.png`;
                }
                // 시전자 몸이 카테고리 색으로 번쩍이던 예전 연출은 제거 - 오라는 효과를 "받은" 대상에게만
                // 나왔다가 사라진다(arena-battle.js와 동일).

                if (dispatchEffectType === "self_stack_buff" && event.detail?.stack_count) {
                    flashEffectAura(actorSlot, "buff");
                    setStatusIcon(actorSlot, "atk_up", { source: `${actorSlot}:self_stack_buff`, weight: event.detail.stack_count });
                }

                if (dispatchEffectType === "self_shield_duration" && event.detail?.shield_seconds) {
                    const shieldMs = event.detail.shield_seconds * 1000 * PLAYBACK_SPEED;
                    flashEffectAura(actorSlot, "special");
                    setStatusIcon(actorSlot, "immune", { source: `${actorSlot}:self_shield_duration`, durationMs: shieldMs });
                    spawnShieldRing(actorSlot, shieldMs);
                }

                if (dispatchEffectType === "conditional_target_debuff") {
                    const hasteMs = (event.detail?.haste_seconds || 0) * 1000 * PLAYBACK_SPEED;
                    flashEffectAura(actorSlot, "buff");
                    setStatusIcon(actorSlot, "atk_speed_up", { source: `${actorSlot}:haste`, ...(hasteMs ? { durationMs: hasteMs } : {}) });
                }
            }
            // 복제체(윤영준)는 기존 전방/후방을 대체하지 않는 3번째 유닛 - 전용 summon 슬롯에 매번 새로 생성한다.
            // (이미 그 슬롯에 이전 복제체가 있었다면 detail.replaced에 이름이 담겨오지만, 살아있는 아군이 제거되는 일은 없다.)
            if (dispatchEffectType === "summon_clone" && event.detail?.summoned) {
                const cloneSlot = `${actorSide}-summon`;
                const caster = actorSlot ? units[actorSlot] : null;

                units[cloneSlot] = {
                    name: event.detail.clone_name,
                    maxHp: event.detail.clone_hp,
                    hp: event.detail.clone_hp,
                    isMelee: caster ? caster.isMelee : true,
                    outfit: caster ? caster.outfit : null,
                    style: caster ? caster.style : "melee",
                };

                const cloneEl = document.querySelector(`[data-unit="${cloneSlot}"]`);
                const casterEl = actorSlot ? document.querySelector(`[data-unit="${actorSlot}"]`) : null;
                if (cloneEl) {
                    cloneEl.hidden = false;
                    cloneEl.style.transform = "";
                    if (casterEl) {
                        const cloneRect = cloneEl.getBoundingClientRect();
                        const casterRect = casterEl.getBoundingClientRect();
                        cloneEl.style.transform = `translateX(${casterRect.left - cloneRect.left}px)`;
                    }
                }
                if (casterEl && actorSlot) {
                    const retreatSign = actorSide === "attacker" ? -1 : 1;
                    const spriteWidth = casterEl.querySelector(".battle-unit-img")?.getBoundingClientRect().width || 130;
                    const casterX = getCurrentTranslateX(casterEl);
                    casterEl.style.transition = "transform 320ms ease-out";
                    requestAnimationFrame(() => {
                        casterEl.style.transform = `translateX(${casterX + retreatSign * spriteWidth}px)`;
                    });
                    setTimeout(() => { casterEl.style.transition = ""; }, 340);
                    approachGapExtra[actorSlot] = spriteWidth;
                    meleeArrived[actorSlot] = false;
                }
                attackAnimActive[cloneSlot] = false;
                getAttackFrameCount(units[cloneSlot].outfit);
                renderUnit(cloneSlot);
                // 복제체는 원본과 구분되게 전체적으로 푸른 색감이 돌도록(3D 프린트 홀로그램 느낌)
                document.querySelector(`[data-unit="${cloneSlot}"] .battle-unit-img`)?.classList.add("is-clone");

                if (units[cloneSlot].isMelee) {
                    meleeTargetKey[cloneSlot] = opponentFrontSlot(cloneSlot);
                    meleeArrived[cloneSlot] = false;
                }
            }
            // 캐릭터 전용 스킬 발사체 연출. 김남옥(여성 대상 기절 성공)·이종복은 투사체가 대상에
            // 닿는 순간에 맞춰 피해/상태 표시를 늦추고, 서민석·임소정은 즉시 반영하면서 투사체만 얹는다.
            if (dispatchEffectType === "conditional_target_debuff" && event.detail?.stunned && actorSlot) {
                const hitSlot = event.detail.target ? findHitSlot(actorSide, event.detail.target) : null;
                if (hitSlot) {
                    playDualCrayonSkillProjectile(actorSlot, hitSlot, () => {
                        flashEffectAura(hitSlot, "cc");
                        setStatusIcon(hitSlot, "stun", {
                            source: `${event.actor}:stun`,
                            durationMs: (event.detail.stun_seconds || 0) * 1000 * PLAYBACK_SPEED,
                        });
                    });
                }
            } else if (dispatchEffectType === "stun_target" && event.detail?.hit) {
                const hitSlot = event.detail.target ? findHitSlot(actorSide, event.detail.target) : null;
                if (hitSlot) {
                    flashEffectAura(hitSlot, "cc");
                    setStatusIcon(hitSlot, "stun", {
                        source: `${event.actor}:stun`,
                        durationMs: (event.detail.stun_seconds || 0) * 1000 * PLAYBACK_SPEED,
                    });
                }
            } else if (dispatchEffectType === "damage_hp_percent_plus_atk" && actorSlot && event.detail?.hits?.length) {
                const hit = event.detail.hits[0];
                const hitSlot = findHitSlot(actorSide, hit.target);
                if (hitSlot) {
                    spawnMeteorProjectile(actorSlot, hitSlot, () => {
                        units[hitSlot].hp = hit.target_hp_after;
                        renderUnit(hitSlot);
                        flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                    });
                }
            } else if (dispatchEffectType === "aoe_gendered_damage" && actorSlot) {
                (event.detail?.hits || []).forEach((hit) => {
                    const hitSlot = findHitSlot(actorSide, hit.target);
                    if (!hitSlot) return;
                    units[hitSlot].hp = hit.target_hp_after;
                    renderUnit(hitSlot);
                    flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                    const gender = CHARACTER_GENDER[hit.target] || "남";
                    spawnHeartProjectile(actorSlot, hitSlot, gender === "여" ? "heart-red" : "heart-pink", () => {});
                });
            } else if (dispatchEffectType === "debuff_atk_and_damage" && actorSlot && event.detail?.hits?.length) {
                const hit = event.detail.hits[0];
                const hitSlot = findHitSlot(actorSide, hit.target);
                if (hitSlot) {
                    units[hitSlot].hp = hit.target_hp_after;
                    renderUnit(hitSlot);
                    flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                    playElectricConnector(actorSlot, hitSlot, "electric-yellow", 9, null);
                    flashEffectAura(hitSlot, "debuff");
                    setStatusIcon(hitSlot, "atk_down", {
                        source: `${event.actor}:atk_down`,
                        durationMs: (event.detail?.debuff_seconds || 0) * 1000 * PLAYBACK_SPEED,
                    });
                }
            } else if (dispatchEffectType === "bonus_damage_knockback" && actorSlot && event.detail?.hits?.length) {
                const hit = event.detail.hits[0];
                const hitSlot = findHitSlot(actorSide, hit.target);
                if (hitSlot) {
                    units[hitSlot].hp = hit.target_hp_after;
                    renderUnit(hitSlot);
                    flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                    applyKnockback(hitSlot);
                    flashEffectAura(hitSlot, "cc");
                    setStatusIcon(hitSlot, "knockback", { source: `${event.actor}:knockback`, durationMs: MOMENT_ICON_MS });
                }
            } else if (dispatchEffectType === "aoe_enemy_damage" && actorSlot) {
                (event.detail?.hits || []).forEach((hit) => {
                    const hitSlot = findHitSlot(actorSide, hit.target);
                    if (!hitSlot) return;
                    units[hitSlot].hp = hit.target_hp_after;
                    renderUnit(hitSlot);
                    flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                });
                spawnGasBreathStream(actorSlot, () => {});
            } else if (dispatchEffectType === "heal_ally_percent_max_hp" && event.detail?.healed) {
                const healSlot = findHitSlot(actorSide, event.detail.target);
                if (healSlot) {
                    spawnHealingHeart(healSlot, () => {
                        units[healSlot].hp = Math.min(units[healSlot].maxHp, units[healSlot].hp + event.detail.amount);
                        renderUnit(healSlot);
                        flashEffectAura(healSlot, "heal");
                        setStatusIcon(healSlot, "heal", { source: `${event.actor}:heal`, durationMs: MOMENT_ICON_MS });
                    });
                }
            } else {
                (event.detail?.hits || []).forEach((hit) => {
                    const hitSlot = findHitSlot(actorSide, hit.target);
                    if (hitSlot) {
                        units[hitSlot].hp = hit.target_hp_after;
                        renderUnit(hitSlot);
                        flashHit(hitSlot, hit.is_crit, hit.type_multiplier);
                    }
                });
            }
            log(`[스킬 발동] ${event.actor} (${event.effect_type}) ${JSON.stringify(event.detail)}`);
        } else if (event.event_type === "basic_attack") {
            const targetSlot = findSlotByName(targetSide, event.target);
            if (targetSlot) units[targetSlot].hp = event.target_hp_after;

            function applyHitVisual() {
                if (targetSlot) { renderUnit(targetSlot); flashHit(targetSlot, event.is_crit, event.type_multiplier); }
                log(`${event.actor} -> ${event.target} 피해 ${event.damage}${event.is_crit ? " 치명타!" : ""}`);
            }

            if (actorSlot && units[actorSlot]?.isMelee) {
                waitForMeleeArrival(actorSlot, targetSlot).then(() => {
                    playAttackFrames(actorSlot);
                    applyHitVisual();
                });
            } else if (actorSlot && targetSlot) {
                // 원거리는 공격 애니메이션(윈드업)을 먼저 시작하고, 3프레임쯤 재생된 뒤에야 이펙트가 나간다.
                // 대상이 등 뒤(허공 공격 버그의 원인이던 케이스)에 있으면 사진을 반전시켜 그쪽으로 발사한다.
                faceToward(actorSlot, targetSlot);
                playAttackFrames(actorSlot);
                setTimeout(() => {
                    playRangedAttack(actorSlot, targetSlot, applyHitVisual);
                }, EFFECT_LAUNCH_DELAY_MS);
            } else {
                if (actorSlot) playAttackFrames(actorSlot);
                applyHitVisual();
            }
        }

        const nextEvent = events[index + 1];
        const delayMs = nextEvent ? Math.max(50, (nextEvent.time - event.time) * 1000 * PLAYBACK_SPEED) : 400;

        setTimeout(() => playEvents(events, index + 1), delayMs);
    }

    function resetAll() {
        walkerRunning = false;
        document.querySelectorAll(".battle-unit").forEach((el) => {
            el.style.transform = "translateX(0)";
            el.classList.remove("dt-selected", "battle-unit-dead");
            const imgEl = el.querySelector(".battle-unit-img");
            imgEl?.classList.remove("casting", "casting-rainbow", "walking", "attacking", "hit-flash", "crit-flash", "is-clone", "flipped", "effect-aura-flash", "dying", "death-fallback-filter");
            imgEl?.style.removeProperty("--effect-aura-color");
        });
        [...SLOTS, "attacker-summon", "defender-summon"].forEach((slot) => {
            clearAllStatusIcons(slot);
            delete facingFlipped[slot];
            delete approachGapExtra[slot];
        });
        ["attacker-summon", "defender-summon"].forEach((slot) => {
            delete units[slot];
            const el = document.querySelector(`[data-unit="${slot}"]`);
            if (el) el.hidden = true;
        });
        activeSlot = null;
        advancedSlot = {};
        document.getElementById("dt-active-unit-name").textContent = "(전장에서 캐릭터 클릭)";
        document.getElementById("dt-log").innerHTML = "";
        SLOTS.forEach((slot) => onUnitConfigChange(slot));
        log("초기화 완료");
    }

    function init() {
        setupUnitSelection();
        setupManualButtons();
        document.getElementById("dt-start-battle").addEventListener("click", startBattle);
        document.getElementById("dt-reset").addEventListener("click", resetAll);
        loadCatalog();
    }

    init();
})();
