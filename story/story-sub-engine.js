// 서브 스토리 공용 재생 엔진. 오랜만의_재회_S1-13_프로토타입.html의 렌더링 로직(대사 타입/씬 전환/
// 암전/타임카드/채팅/편지 연출)을 그대로 옮기고, 사이트 통합 레이어(화 단위 티켓 소모+영구 잠금해제,
// 로비/화선택 모달)를 추가했다. 향후 추가되는 서브 스토리도 이 파일을 그대로 재사용하고,
// story/scenario/<story_id>.js만 새로 만들면 된다(그 파일이 이 스크립트보다 먼저 로드되어
// STORY_ID/BG/CHAR_IMG/CHAPTERS 등을 전역으로 제공하는 계약).
// API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.

// 대화 기록 모달의 독백(thought) 표시용 - 원문 대부분은 이미 괄호가 씌워져 있지만 아닌 경우도 있어서,
// 없으면 씌워준다.
function wrapInParens(str) {
    const trimmed = String(str ?? "").trim();
    return (trimmed.startsWith("(") && trimmed.endsWith(")")) ? str : `(${str})`;
}

// 효과음(story-engine.js의 SE_BASE/playSe를 그대로 이식 - 이 엔진엔 지금까지 소리 재생 자체가
// 없었다). 씬 데이터에 se:'파일이름'(assets/story/shared/SE/ 안의 .ogg 파일, 확장자 생략 가능)을
// 직접 지정해서 어떤 줄에든 자유롭게 붙일 수 있다(renderCurrent 참고). story-engine.js와 달리 SE 맵을
// 따로 안 두는 이유: 시나리오 파일(예: sub1_kimnamok.js)이 이 엔진 스크립트보다 "먼저" 로드되는
// 계약이라(파일 맨 위 주석 참고), 시나리오 쪽에서 여기 정의될 SE.키를 참조할 수 없다 - 그래서
// 파일 이름 문자열을 시나리오가 직접 들고 있는다.
const SE_BASE = 'assets/story/shared/SE/';
function playSe(key) {
    if (!key) return;
    const audio = new Audio(`${SE_BASE}${key}.ogg`);
    audio.volume = 0.85;
    audio.play().catch(() => {});
}

// BGM(story-engine.js의 playBgm/cancelBgmFade를 그대로 이식 - sub1_kimnamok.js가 이미 bgm:'키'
// 필드를 갖고 있었지만 이 엔진에 재생 로직 자체가 없어서 조용히 무시되고 있었다). assets/story/shared/bgm/
// 를 공유하므로 파일 이름 규칙(playSe와 달리 SE 맵 부재 이유와 무관 - bgm은 원래도 문자열 키를 그대로
// 파일명으로 쓴다)은 story-engine.js와 완전히 동일하다.
const BGM_BASE = 'assets/story/shared/bgm/';
const BGM_FADE_MS = 500;
let currentBgmKey = null;
let bgmFadeTimer = null;

function cancelBgmFade() {
    if (bgmFadeTimer !== null) {
        clearInterval(bgmFadeTimer);
        bgmFadeTimer = null;
    }
    el.bgmPlayer.volume = 1;
}

function playBgm(key) {
    if (currentBgmKey === key) {
        if (key && el.bgmPlayer.paused) el.bgmPlayer.play().catch(() => {});
        return;
    }
    currentBgmKey = key;
    cancelBgmFade();

    if (!key) {
        const player = el.bgmPlayer;
        const startVolume = player.volume;
        const stepMs = 20;
        const steps = Math.max(1, Math.round(BGM_FADE_MS / stepMs));
        let step = 0;
        bgmFadeTimer = setInterval(() => {
            step += 1;
            player.volume = Math.max(0, startVolume * (1 - step / steps));
            if (step >= steps) {
                clearInterval(bgmFadeTimer);
                bgmFadeTimer = null;
                player.pause();
                player.removeAttribute('src');
                player.volume = startVolume;
            }
        }, stepMs);
        return;
    }

    const file = /\.(mp3|ogg|wav|flac|m4a|aac)$/i.test(key) ? key : `${key}.mp3`;
    el.bgmPlayer.src = `${BGM_BASE}${file}`;
    el.bgmPlayer.currentTime = 0;
    el.bgmPlayer.play().catch(() => {});
}

let PLAYER_NAME = "플레이어";
// 대사 원문의 '__PLAYER_NAME__'을 실제 유저 닉네임으로 치환한다(인연 스토리와 동일한 플레이스홀더 -
// 시나리오 데이터 자체는 이 토큰을 그대로 유지하고, 화면에 표시되는 시점에만 바꿔치기한다).
function withPlayerName(str) {
    return String(str ?? "").split("__PLAYER_NAME__").join(PLAYER_NAME);
}

function authHeaders(json = false) {
    const token = localStorage.getItem("access_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (json) headers["Content-Type"] = "application/json";
    return headers;
}

let ticketBalance = 0;
let unlockedChapters = new Set();
let currentChapterIndex = 0;

// 김남옥 서브스토리 해금 조건: "김남옥 보유"(확인된 요청) - 다른 두 서브스토리(이의진/이종복)처럼
// 아직 콘텐츠 자체가 없어서 무조건 잠긴 "준비 중"과는 다르게, 콘텐츠는 이미 있고 이 캐릭터를
// 뽑았는지 여부로만 갈리므로 문구도 구분한다("미보유").
let hasKimnamok = false;

async function fetchKimnamokOwnership() {
    try {
        const res = await fetch(`${API_BASE_URL}/characters/`, { headers: authHeaders() });
        if (!res.ok) return false;
        const rows = await res.json();
        return rows.some((c) => c.name === '김남옥');
    } catch (err) {
        return false;
    }
}

// 흰색 자물쇠 아이콘(확인된 요청) - assets/icons/lock_white.webp를 그대로 쓴다.
const LOCK_ICON_HTML = '<img class="episode-story-lock-icon" src="assets/icons/lock_white.webp" alt="">';

function applyKimnamokLockState() {
    const card = document.getElementById('kimnamok-card');
    const btn = document.getElementById('btn-enter-kimnamok');
    if (!card || !btn) return;
    card.classList.toggle('locked', !hasKimnamok);
    btn.disabled = !hasKimnamok;
    btn.innerHTML = hasKimnamok ? '입장' : LOCK_ICON_HTML;
}

async function fetchStoryState() {
    const [meRes, stateRes] = await Promise.all([
        fetch(`${API_BASE_URL}/users/me`, { headers: authHeaders() }),
        fetch(`${API_BASE_URL}/story/state?story_id=${encodeURIComponent(STORY_ID)}`, { headers: authHeaders() }),
    ]);
    if (meRes.ok) {
        const me = await meRes.json();
        PLAYER_NAME = me.user_info?.nickname || PLAYER_NAME;
    }
    // PLAYER가 직접 말할 때(이름표/대화 기록)도 실제 닉네임이 나오도록 인연 스토리와 동일하게
    // PLAYER 객체 자체를 직접 덮어쓴다(scenario 파일의 PLAYER.name='__PLAYER_NAME__' 참고).
    PLAYER.name = PLAYER_NAME;
    if (stateRes.ok) {
        const data = await stateRes.json();
        ticketBalance = data.ticket_balance || 0;
        unlockedChapters = new Set(data.unlocked_cgs || []);
    }
    updateTicketChip();
}

function updateTicketChip() {
    el.ticketValue.textContent = ticketBalance;
}

async function consumeTicketOnServer() {
    const res = await fetch(`${API_BASE_URL}/story/consume-ticket`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ story_id: STORY_ID }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    ticketBalance = data.ticket_balance;
    updateTicketChip();
    return true;
}

function unlockChapterOnServer(chapterId) {
    return fetch(`${API_BASE_URL}/story/unlock-chapter`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ story_id: STORY_ID, cg_id: chapterId }),
    }).catch(() => {});
}

/* =========================================================
   엔진 (프로토타입의 narration/thought/line 렌더링과 scene-fade/time-card 전환 로직 그대로)
   ========================================================= */
const el = {
    stage: document.getElementById('stage'),
    box: document.getElementById('box'),
    text: document.getElementById('line-text'),
    nameplate: document.getElementById('nameplate'),
    nameMain: document.getElementById('name-main'),
    nameSub: document.getElementById('name-sub'),
    charLeft: document.getElementById('char-left'),
    charLeftImg: document.getElementById('char-left-img'),
    charRight: document.getElementById('char-right'),
    charRightImg: document.getElementById('char-right-img'),
    charCenter: document.getElementById('char-center'),
    charCenterImg: document.getElementById('char-center-img'),
    itemDisplay: document.getElementById('item-display'),
    itemDisplayImg: document.getElementById('item-display-img'),
    bgmPlayer: document.getElementById('bgm-player'),
    phoneLayer: document.getElementById('phone-layer'),
    phoneContacts: document.getElementById('phone-contacts'),
    chatMessages: document.getElementById('chat-messages'),
    phoneCompose: document.getElementById('phone-compose'),
    phoneComposeInput: document.getElementById('phone-compose-input'),
    phoneComposeSend: document.getElementById('phone-compose-send'),
    hint: document.getElementById('advance-hint'),
    dialogueWrap: document.getElementById('dialogue-wrap'),
    sceneFade: document.getElementById('scene-fade'),
    timeCard: document.getElementById('time-card-overlay'),
    timeCardText: document.getElementById('time-card-text'),
    letterLayer: document.getElementById('letter-layer'),
    letterEnvelope: document.getElementById('letter-envelope'),
    letterEnvelopeImg: document.getElementById('letter-envelope-img'),
    letterPaper: document.getElementById('letter-paper'),
    letterPaperImg: document.getElementById('letter-paper-img'),
    letterPaperText: document.getElementById('letter-paper-text'),
    lobbyWrap: document.getElementById('lobby-wrap'),
    ticketValue: document.getElementById('vn-ticket-value'),
    kimnamokThumb: document.getElementById('kimnamok-thumb'),
    chapterModal: document.getElementById('chapter-modal'),
    chapterModalClose: document.getElementById('chapter-modal-close'),
    chapterList: document.getElementById('chapter-list'),
    ticketConfirmModal: document.getElementById('vn-ticket-confirm-modal'),
    ticketConfirmText: document.getElementById('vn-ticket-confirm-text'),
    ticketConfirmOk: document.getElementById('vn-ticket-confirm-ok'),
    ticketConfirmCancel: document.getElementById('vn-ticket-confirm-cancel'),
    ticketInsufficientModal: document.getElementById('vn-ticket-insufficient-modal'),
    ticketInsufficientOk: document.getElementById('vn-ticket-insufficient-ok'),
    chapterEndCinematic: document.getElementById('chapter-end-cinematic'),
    cecTbcText: document.getElementById('cec-tbc-text'),
    cecStamp: document.getElementById('cec-stamp'),
    cecCurtainTop: document.getElementById('cec-curtain-top'),
    cecCurtainBottom: document.getElementById('cec-curtain-bottom'),
    cecBanner: document.getElementById('cec-banner'),
    cecBannerText: document.getElementById('cec-banner-text'),
    stageTopBtns: document.getElementById('stage-top-btns'),
    logModal: document.getElementById('vn-log-modal'),
    logModalContent: document.getElementById('vn-log-modal-content'),
    menuModal: document.getElementById('vn-menu-modal'),
};

let QUEUE = [];
let idx = 0;
let typing = false;
let typeTimer = null;
let typeTargetEl = null;
let typeFullText = ""; // withPlayerName()까지 적용된, 실제로 타이핑 중인 완성 문자열(스킵 시 재사용)
let currentBgKey = null;
let backgroundTransitioning = false;
let timeCardTransitioning = false;
let letterTransitioning = false;
let chapterEndCinematicActive = false;
let curLeftKey = null;
let curCenterKey = null;
let curRightKey = null;
const SPRITE_EXIT_MS = 500; // #char-left/#char-right/#char-center의 opacity/transform 트랜지션(.5s)과 맞춤
// 대화 기록(대사) 모달용 - type:'line'(실제 발화)과 type:'thought'(독백)만 쌓고 narration/chat은
// 제외한다(인연 스토리와 동일). 화가 새로 시작될 때만 비운다(startChapter 참고).
let dialogueHistory = [];

function setBg(key) {
    currentBgKey = key && BG[key] ? key : null;
    if (!currentBgKey) {
        el.stage.style.backgroundImage = 'none';
        el.stage.style.backgroundColor = '#000';
        return;
    }
    el.stage.style.backgroundColor = '#000';
    el.stage.style.backgroundImage = `url('${BG[currentBgKey]}')`;
}

function fadeToBackground(nextBgKey, white, onDone) {
    backgroundTransitioning = true;
    // playTimeCard와 동일한 이유로 전환이 시작되자마자 대사창을 곧바로 숨긴다 - 안 그러면 암전이 걷히는
    // 동안(다음 줄이 아직 렌더링되기 전) 직전 대사가 새 배경 위에 그대로 남아 보이는 문제가 있었다.
    el.dialogueWrap.classList.add('hidden');
    if (white) el.sceneFade.classList.add('white');
    el.sceneFade.classList.add('active');
    window.setTimeout(() => {
        setBg(nextBgKey);
        // 암전 중에 이전 씬 스탠딩을 정리 - 안 그러면 다음 씬으로 넘어갔을 때
        // 새로 지정한 인물이 나오기 전까지 직전 인물이 그대로 남아 보이는 문제가 생긴다.
        setChars({ left: null, right: null, center: null });
        window.setTimeout(() => {
            el.sceneFade.classList.remove('active'); // 여기서 opacity 1->0 트랜지션(.65s)이 시작됨
            // white는 이 트랜지션이 실제로 다 끝난 뒤에야 뗀다 - background(#fff/#000)엔 트랜지션이
            // 없어서, active와 동시에 떼면 opacity가 아직 안 줄었는데 흰색이 검정으로 순간 전환되어
            // "흰색이 너무 빨리 사라지는" 것처럼 보였다(실제로는 화면이 검게 바뀐 채 계속 옅어지는
            // 중이었을 뿐). opacity가 0에 도달한 뒤(=화면에 안 보이는 뒤)에 색을 되돌리면 안전하다.
            window.setTimeout(() => {
                if (white) el.sceneFade.classList.remove('white');
                backgroundTransitioning = false;
                (onDone || renderCurrent)();
            }, 650);
        }, 80);
    }, 650);
}

// type:'reveal' 전용 - 대사창 없이(말풍선/나레이션 박스 자체를 아예 숨긴 채) 배경+스탠딩만 바꿔
// 보여주고, holdMs만큼 저절로 기다렸다가(클릭 없이) 다음 줄로 자동 진행한다. 흰 암전(white:true)으로
// 전환한 뒤 대사 없이 인물만 세워두는 회상 진입 연출 등에 쓴다.
let revealHolding = false;

function playSilentReveal(line) {
    const applyAndHold = () => {
        if (line.chars) setChars(line.chars);
        el.dialogueWrap.classList.add('hidden');
        revealHolding = true;
        window.setTimeout(() => {
            revealHolding = false;
            idx++;
            renderCurrent();
        }, line.holdMs ?? 1500);
    };
    if (line.bg && line.bg !== currentBgKey) {
        fadeToBackground(line.bg, line.white, applyAndHold);
    } else {
        applyAndHold();
    }
}

// 아이템 등장(story-engine.js의 playItemReveal/playItemHide를 그대로 이식 - 이 엔진엔 효과음 재생
// 자체가 없어 그 부분만 뺐다) - type:'itemReveal'/'itemHide' 전용. 대사창을 숨긴 채 중앙 캐릭터가
// 옆으로 비켜서고(#char-center.item-reveal-shift), 그 다음 아이템이 사각형 컨테이너 안에서 떠오르듯
// 나타난다(#item-display.show). line.item에는 완성된 이미지 URL을 직접 넘긴다.
const ITEM_SLIDE_MS = 500;   // #char-center.item-reveal-shift의 opacity/transform 트랜지션과 맞춘 값
const ITEM_FADE_MS = 500;    // #item-display.show의 opacity/transform 트랜지션과 맞춘 값
const ITEM_REVEAL_HOLD_MS = 300; // 아이템이 다 나타난 뒤 다음 줄로 넘어가기 전 짧게 두는 여백
let itemRevealHolding = false;

function playItemReveal(line) {
    itemRevealHolding = true;
    el.dialogueWrap.classList.add('hidden');
    el.charCenter.classList.add('item-reveal-shift');
    window.setTimeout(() => {
        el.itemDisplayImg.src = line.item || '';
        void el.itemDisplay.offsetWidth; // 연속 재생에도 트랜지션이 처음부터 다시 재생되도록 강제 리플로우
        el.itemDisplay.classList.add('show');
        window.setTimeout(() => {
            window.setTimeout(() => {
                itemRevealHolding = false;
                idx++;
                renderCurrent();
            }, ITEM_REVEAL_HOLD_MS);
        }, ITEM_FADE_MS);
    }, ITEM_SLIDE_MS);
}

function playItemHide(line) {
    itemRevealHolding = true;
    el.dialogueWrap.classList.add('hidden');
    el.itemDisplay.classList.remove('show');
    window.setTimeout(() => {
        el.charCenter.classList.remove('item-reveal-shift');
        window.setTimeout(() => {
            window.setTimeout(() => {
                itemRevealHolding = false;
                idx++;
                renderCurrent();
            }, ITEM_REVEAL_HOLD_MS);
        }, ITEM_SLIDE_MS);
    }, ITEM_FADE_MS);
}

function applyCharSlotTransform(image, key) {
    const scale = CHAR_SCALE[key] || 1;
    const offsetY = CHAR_OFFSET_Y[key] || 0;
    const transforms = [];
    if (offsetY) transforms.push(`translateY(${offsetY}px)`);
    if (scale !== 1) transforms.push(`scale(${scale})`);
    image.style.transform = transforms.join(' ');
    image.style.transformOrigin = 'bottom center';
}

function setCharSlot(container, image, key) {
    if (key) {
        image.src = CHAR_IMG[key];
        applyCharSlotTransform(image, key);
        container.classList.add('show');
    } else {
        container.classList.remove('show');
        image.removeAttribute('src');
        image.style.transform = '';
    }
}

// 인연 스토리 playSlotsEnterBatched와 동일한 이유(등장 트랜지션은 remove('show') 상태가 실제로
// 반영된 뒤에야 add('show')해야 재생됨) - 슬롯이 몇 개든 강제 리플로우를 딱 1회만 실행한다.
function playCharSlotsEnterBatched(entries) {
    entries.forEach(({ container, image, key }) => {
        container.classList.remove('dim');
        image.src = CHAR_IMG[key];
        applyCharSlotTransform(image, key);
        container.classList.remove('show');
    });
    if (entries.length > 0) void el.stage.offsetWidth;
    entries.forEach(({ container }) => container.classList.add('show'));
}

const CHAR_SLOT_DEFS = [
    { name: 'left', container: () => el.charLeft, image: () => el.charLeftImg, get: () => curLeftKey, set: (k) => { curLeftKey = k; } },
    { name: 'center', container: () => el.charCenter, image: () => el.charCenterImg, get: () => curCenterKey, set: (k) => { curCenterKey = k; } },
    { name: 'right', container: () => el.charRight, image: () => el.charRightImg, get: () => curRightKey, set: (k) => { curRightKey = k; } },
];

// 인연 스토리 컬렉터 엔딩의 대사 교차(story-engine.js tryPlayCharacterHandoff)와 동일한 방식 - 이미
// 나와 있던 자리의 인물이 "다른" 인물로 바뀌면(예: 화학 교사 -> 방임석/김남옥), 그 자리를 먼저 완전히
// 퇴장시키고(트랜지션 0.5초) 다 사라진 뒤에야 바뀐 모습으로 다시 등장시킨다 - 이때 같은 chars 갱신
// 안에서 함께 새로 합류하는 다른 자리(예: 오른쪽에 새로 나타나는 인물)도 같은 타이밍에 맞춰 함께
// 등장시킨다. 그동안은 대사창을 숨겨서 겹쳐 보이는 어색함을 없애고, 다 끝나면 renderCurrent()를
// 다시 불러(같은 idx) 이어서 진행한다. 대상이 없으면(단순 등장/퇴장만 있는 보통의 경우) false를
// 돌려줘서 호출부가 기존처럼 즉시 반영하게 한다.
function trySmoothCharacterHandoff(chars) {
    const changing = CHAR_SLOT_DEFS
        .filter((def) => def.name in chars)
        .map((def) => ({ def, newKey: chars[def.name], container: def.container() }))
        .filter((s) => s.newKey && s.newKey !== s.def.get());

    const hasHandoff = changing.some((s) => s.def.get() && s.container.classList.contains('show'));
    if (!hasHandoff) return false;

    el.dialogueWrap.classList.add('hidden');
    changing.forEach((s) => {
        if (s.def.get() && s.container.classList.contains('show')) s.container.classList.remove('show');
    });

    window.setTimeout(() => {
        changing.forEach((s) => s.def.set(s.newKey));
        playCharSlotsEnterBatched(changing.map((s) => ({ container: s.def.container(), image: s.def.image(), key: s.newKey })));
        renderCurrent();
    }, SPRITE_EXIT_MS);

    return true;
}

// setChars의 반환값(true=부드러운 교차가 예약돼 진행 중)을 호출부(renderCurrent)가 보고, 그 경우
// 이번 패스에서는 대사/텍스트 렌더링을 건너뛰어야 한다 - trySmoothCharacterHandoff의 타임아웃이
// 끝나면 renderCurrent()를 다시 불러 같은 줄을 이어서 정상적으로 렌더링한다.
function setChars(chars) {
    if (!chars) return false;
    if (trySmoothCharacterHandoff(chars)) return true;
    if ('left' in chars) { setCharSlot(el.charLeft, el.charLeftImg, chars.left); curLeftKey = chars.left; }
    if ('right' in chars) { setCharSlot(el.charRight, el.charRightImg, chars.right); curRightKey = chars.right; }
    if ('center' in chars) { setCharSlot(el.charCenter, el.charCenterImg, chars.center); curCenterKey = chars.center; }
    return false;
}

// 말하는 사람만 밝게, 나머지는 어둡게(story-sub.css의 .dim 참고) - 2명 이상 동시에 있을 때만 동작.
function normalizeCastSpeakerKey(key) {
    return CAST_SPEAKER_ALIASES[key] || key;
}

function clearAllCharacterDim() {
    el.charLeft.classList.remove('dim');
    el.charCenter.classList.remove('dim');
    el.charRight.classList.remove('dim');
}

function applySpeakingDim(speakerKey) {
    // 나레이션과 독백은 직전에 지정된 음영을 그대로 유지한다.
    if (!speakerKey) return;

    const slots = [
        { key: curLeftKey, element: el.charLeft },
        { key: curCenterKey, element: el.charCenter },
        { key: curRightKey, element: el.charRight },
    ].filter((slot) => slot.key);

    if (slots.length <= 1) {
        clearAllCharacterDim();
        return;
    }

    slots.forEach((slot) => {
        const normalizedKey = normalizeCastSpeakerKey(slot.key);
        slot.element.classList.toggle('dim', normalizedKey !== speakerKey);
    });
}

/* ---- BugoTalk 채팅 UI ---- */
function openChat(activeKey) {
    playSe('SE_MomoTalk_01');
    el.phoneContacts.innerHTML = '';
    CONTACT_LIST.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'phone-contact' + (c.key === activeKey ? ' active' : '');
        row.innerHTML = `<span class="avatar">${c.name[0]}</span><span>${c.name}</span>`;
        el.phoneContacts.appendChild(row);
    });
    el.chatMessages.innerHTML = '';
    el.phoneLayer.classList.add('show');
}
function closeChat() {
    el.phoneLayer.classList.remove('show');
    el.phoneCompose.classList.remove('show');
}
function addChatBubble(from, text) {
    const isPlayer = (from === 'player');
    const row = document.createElement('div');
    row.className = 'chat-bubble-row ' + (isPlayer ? 'out' : 'in');
    const avatar = isPlayer ? '' : `<span class="avatar">${from.name[0]}</span>`;
    row.innerHTML = `${avatar}<span class="chat-bubble"></span>`;
    el.chatMessages.appendChild(row);
    row.querySelector('.chat-bubble').textContent = withPlayerName(text);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

// 자유 입력 채팅(플레이어가 직접 타이핑) - 지금 시나리오는 전부 대사가 미리 쓰인 chat 줄만 쓰지만,
// 인연 스토리와 동일하게 앞으로의 서브 스토리가 자유 입력을 쓸 수 있도록 그대로 이식해둔다.
function showComposeInput(onSubmit) {
    el.phoneCompose.classList.add('show');
    el.phoneComposeInput.value = '';
    el.phoneComposeInput.focus();
    el.phoneComposeInput.onclick = (e) => { e.stopPropagation(); };
    const submit = () => {
        const val = el.phoneComposeInput.value.trim();
        if (!val) return;
        el.phoneCompose.classList.remove('show');
        el.phoneComposeSend.onclick = null;
        el.phoneComposeInput.onkeydown = null;
        addChatBubble('player', val);
        onSubmit(val);
    };
    el.phoneComposeSend.onclick = (e) => { e.stopPropagation(); submit(); };
    el.phoneComposeInput.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { submit(); }
    };
}

/* ---- 편지 연출: 속지가 겉지 뒤에 숨어 있다가 위로 올라오며 나타나고, 이어서 확대된다 ---- */
function openLetter() {
    letterTransitioning = true;
    el.letterEnvelopeImg.src = IMG_ENVELOPE;
    el.letterPaperImg.src = IMG_LETTERPAPER;
    el.letterPaperText.textContent = '';
    el.letterPaper.classList.remove('rise', 'enlarge');
    el.letterLayer.classList.add('show');
    window.setTimeout(() => {
        el.letterEnvelope.classList.add('show');
        window.setTimeout(() => {
            el.letterPaper.classList.add('rise');
            window.setTimeout(() => {
                el.letterPaper.classList.add('enlarge');
                window.setTimeout(() => {
                    letterTransitioning = false;
                    idx++;
                    renderCurrent();
                }, 650);
            }, 850);
        }, 550);
    }, 50);
}
function closeLetter() {
    letterTransitioning = true;
    el.letterPaper.classList.remove('enlarge');
    window.setTimeout(() => {
        el.letterPaper.classList.remove('rise');
        el.letterEnvelope.classList.remove('show');
        window.setTimeout(() => {
            el.letterLayer.classList.remove('show');
            el.letterPaperText.textContent = '';
            letterTransitioning = false;
            idx++;
            renderCurrent();
        }, 800);
    }, 650);
}

// 순서: ①화면이 완전히 검게 덮인다 → ②문구가 뜬다 → ③문구가 사라진다 →
// ④(여전히 암전 상태에서) 배경이 바뀐다 → ⑤암전이 걷히며 새 배경이 드러난다.
// 대사창은 전환이 시작되자마자(암전이 채 덮이기도 전에) 곧바로 숨긴다 - 안 그러면 암전이 걷힌
// 직후부터 다음 줄이 렌더링되기 전까지 짧게(650ms) 직전 대사가 다시 보이는 문제가 생긴다
// (story-engine.js의 playTimeCard와 동일한 이유로 el.dialogueWrap을 가장 먼저 숨김).
function playTimeCard(line) {
    if (timeCardTransitioning) return;

    timeCardTransitioning = true;
    // renderCurrent()는 timecard 타입을 만나면 곧바로 여기로 넘기고 return하기 때문에, 거기 있는
    // line.stopBgm/line.bgm 처리를 거치지 않는다 - story-engine.js의 playTimeCard와 동일한 이유로
    // 여기서 따로 처리한다.
    if (line.stopBgm) {
        playBgm(null);
    } else if (line.bgm) {
        playBgm(line.bgm);
    }
    if (line.white) {
        el.sceneFade.classList.add('white');
        el.timeCard.classList.add('white');
    }
    el.dialogueWrap.classList.add('hidden');
    el.hint.style.visibility = 'hidden';
    setChars({ left: null, right: null, center: null });
    el.sceneFade.classList.add('active');
    window.setTimeout(() => {
        el.timeCardText.textContent = line.text;
        el.timeCard.classList.add('show');
        window.setTimeout(() => {
            el.timeCard.classList.remove('show');
            window.setTimeout(() => {
                if (line.bg) setBg(line.bg);
                window.setTimeout(() => {
                    el.sceneFade.classList.remove('active');
                    window.setTimeout(() => {
                        timeCardTransitioning = false;
                        el.sceneFade.classList.remove('white');
                        el.timeCard.classList.remove('white');
                        idx++;
                        renderCurrent();
                    }, 650);
                }, 250);
            }, 650);
        }, 1400);
    }, 650);
}

function renderCurrent() {
    if (idx >= QUEUE.length) {
        playChapterEndCinematic();
        return;
    }
    const line = QUEUE[idx];

    if (line.type === 'timecard') {
        playTimeCard(line);
        return;
    }
    if (line.type === 'letterOpen') {
        if (line.chars && setChars(line.chars)) return;
        openLetter();
        return;
    }
    if (line.type === 'letterClose') {
        closeLetter();
        return;
    }
    if (line.type === 'reveal') {
        playSilentReveal(line);
        return;
    }
    if (line.type === 'itemReveal') {
        playItemReveal(line);
        return;
    }
    if (line.type === 'itemHide') {
        playItemHide(line);
        return;
    }
    if (line.se) { playSe(line.se); }

    if (line.stopBgm) {
        playBgm(null);
    } else if (line.bgm) {
        playBgm(line.bgm);
    }

    if (line.clearBg && currentBgKey !== null) {
        fadeToBackground(null);
        return;
    }
    if (line.bg && line.bg !== currentBgKey) {
        fadeToBackground(line.bg);
        return;
    }

    if (line.chars && setChars(line.chars)) return;

    if (line.openChat) { openChat(line.openChat); }

    if (line.type === 'chat') {
        el.dialogueWrap.classList.add('hidden');
        addChatBubble(line.from, line.text);
        typing = false;
        return;
    }

    if (line.type === 'letter') {
        el.dialogueWrap.classList.add('hidden');
        typeText(el.letterPaperText, withPlayerName(line.text));
        return;
    }

    el.dialogueWrap.classList.remove('hidden');
    el.box.classList.remove('thought', 'narration', 'speech');

    if (line.type === 'narration') {
        el.box.classList.add('narration');
        el.nameplate.style.display = 'none';
        applySpeakingDim(null); // 직전 음영을 그대로 유지
    } else if (line.type === 'thought') {
        el.box.classList.add('thought');
        el.nameplate.style.display = 'none';
        applySpeakingDim(null);
        dialogueHistory.push({ isMonologue: true, text: wrapInParens(withPlayerName(line.text)) });
    } else if (line.type === 'line') {
        el.box.classList.add('speech');
        el.nameplate.style.display = 'flex';
        el.nameMain.textContent = line.speaker.name;
        el.nameSub.textContent = line.speaker.sub || '';
        el.nameSub.style.display = line.speaker.sub ? '' : 'none';
        if (line.speaker.key) {
            applySpeakingDim(line.speaker.key);
        } else {
            // 화면에 없는 화자(플레이어 등) 또는 공동 대사 - 모든 스탠딩을 밝게
            clearAllCharacterDim();
        }
        // PLAYER.name은 fetchStoryState()에서 실제 닉네임으로 덮어써지므로(더 이상 항상 '나'가
        // 아님), 이름이 아니라 참조로 판정해야 한다(인연 스토리와 동일).
        dialogueHistory.push({
            isPlayer: line.speaker === PLAYER,
            name: line.speaker.name,
            avatarKey: line.speaker.key || null,
            text: withPlayerName(line.text),
        });
    }

    typeText(el.text, withPlayerName(line.text));
}

function typeText(target, full) {
    typing = true;
    typeTargetEl = target;
    typeFullText = full;
    target.textContent = '';
    el.hint.style.visibility = 'hidden';
    let i = 0;
    clearInterval(typeTimer);
    typeTimer = setInterval(() => {
        target.textContent += full[i];
        i++;
        if (i >= full.length) {
            clearInterval(typeTimer);
            typing = false;
            el.hint.style.visibility = 'visible';
        }
    }, 38);
}

function advance() {
    // 자동재생 정책으로 이전 play() 시도가 막혔던 bgm이 있다면, 지금 이 클릭(확실한 사용자 제스처)에
    // 실어서 다시 시도한다(story-engine.js의 advance()와 동일).
    if (currentBgmKey && el.bgmPlayer.paused) el.bgmPlayer.play().catch(() => {});
    if (chapterEndCinematicActive || timeCardTransitioning || backgroundTransitioning || letterTransitioning || revealHolding || itemRevealHolding) return;
    if (typing) {
        clearInterval(typeTimer);
        typeTargetEl.textContent = typeFullText;
        typing = false;
        el.hint.style.visibility = 'visible';
        return;
    }
    const currentLine = QUEUE[idx];
    if (currentLine && currentLine.type === 'chat' && currentLine.closeChat) {
        closeChat();
    }
    idx++;
    renderCurrent();
}

/* =========================================================
   화(chapter) 선택 / 티켓 소모 / 영구 잠금해제
   ========================================================= */
function chapterState(i) {
    const chapter = CHAPTERS[i];
    if (unlockedChapters.has(chapter.id)) return 'unlocked';
    if (i === 0 || unlockedChapters.has(CHAPTERS[i - 1].id)) return 'available';
    return 'locked';
}

function renderChapterList() {
    el.chapterList.innerHTML = '';
    CHAPTERS.forEach((chapter, i) => {
        const state = chapterState(i);
        const btn = document.createElement('button');
        btn.className = `chapter-btn chapter-${state}`;
        const statusHtml = state === 'unlocked'
            ? '재입장'
            : state === 'available'
                ? '<img class="vn-ticket-icon" src="assets/items/story_ticket.webp" alt="" onerror="this.style.display=\'none\'"> 입장'
                : '<img class="chapter-lock-icon" src="assets/icons/lock_white.webp" alt="" onerror="this.outerHTML=\'🔒\'">';
        btn.innerHTML = `
            <span class="chapter-btn-num">${i + 1}</span>
            <span class="chapter-btn-info">
                <span class="chapter-btn-title">${chapter.title}${chapter.subtitle ? ' · ' + chapter.subtitle : ''}</span>
            </span>
            <span class="chapter-btn-status">${statusHtml}</span>
        `;
        if (state === 'unlocked') {
            btn.addEventListener('click', () => { closeChapterModal(); startChapter(i); });
        } else if (state === 'available') {
            btn.addEventListener('click', () => {
                el.ticketConfirmText.innerHTML = `${chapter.title}를 잠금 해제하고<br>입장하시겠습니까?<br>(티켓 1장 소모)`;
                showTicketConfirmModal(() => tryConsumeAndUnlockChapter(i), () => {});
            });
        } else {
            btn.disabled = true;
        }
        el.chapterList.appendChild(btn);
    });
}

async function openChapterModal() {
    await fetchStoryState();
    renderChapterList();
    el.chapterModal.classList.add('show');
}
function closeChapterModal() {
    el.chapterModal.classList.remove('show');
}

async function tryConsumeAndUnlockChapter(chapterIndex) {
    const chapter = CHAPTERS[chapterIndex];
    const ok = await consumeTicketOnServer();
    if (!ok) {
        showTicketInsufficientModal();
        return;
    }
    await unlockChapterOnServer(chapter.id);
    unlockedChapters.add(chapter.id);
    closeChapterModal();
    startChapter(chapterIndex);
}

function showTicketConfirmModal(onOk, onCancel) {
    const modal = el.ticketConfirmModal;
    el.ticketConfirmOk.onclick = () => { modal.classList.remove('show'); onOk(); };
    el.ticketConfirmCancel.onclick = () => { modal.classList.remove('show'); onCancel(); };
    modal.classList.add('show');
}
function showTicketInsufficientModal() {
    el.ticketInsufficientModal.classList.add('show');
    el.ticketInsufficientOk.onclick = () => el.ticketInsufficientModal.classList.remove('show');
}

function startChapter(chapterIndex) {
    currentChapterIndex = chapterIndex;
    QUEUE = CHAPTERS[chapterIndex].scenes.flat();
    idx = 0;
    currentBgKey = null;
    dialogueHistory = []; // 새 화 시작 - 대화 기록도 처음부터 다시 쌓는다
    setChars({ left: null, right: null, center: null });
    el.lobbyWrap.classList.add('hide');
    el.dialogueWrap.classList.remove('hidden');
    renderCurrent();
}

// 화 종료 연출 타이밍(ms) - 값 하나하나가 story-sub.css의 transition-duration과 맞물려 있으므로
// 여기 값을 바꾸면 CSS 쪽도 같이 맞춰야 한다.
const CEC_BLUR_MS = 400;               // 블러+비네트가 덮이는 시간(빠르게 서서히)
const CEC_TBC_SLIDE_MS = 550;          // "To Be Continued..."가 우측에서 슬라이드로 들어오는 시간
const CEC_HOLD_BEFORE_CLOSE_MS = 1500; // 문구가 멈춘 뒤 상하 커튼이 닫히기 시작하기까지의 대기(요청: 1.5초)
const CEC_CURTAIN_CLOSE_MS = 500;      // 상하 커튼이 닫히는 시간(가챠 도어와 동일한 easing/속도, 방향만 위아래)
const CEC_CURTAIN_REOPEN_MS = 650;     // 상하 커튼이 열리는 시간
const CEC_BANNER_HOLD_MS = 1500;       // 다음화 배너가 보이는 시간(1차 재오픈 시작 시점부터)

function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// 화(chapter) 안의 씬들을 순서대로 훑어 처음 나오는 bg 값을 찾는다 - 다음 화 예고 배너 뒤에 그 화의
// 첫 배경을 미리 블러 상태로 보여주기 위함.
function findFirstBg(chapterIndex) {
    const chapter = CHAPTERS[chapterIndex];
    if (!chapter) return null;
    for (const scene of chapter.scenes) {
        for (const line of scene) {
            if (line.bg) return line.bg;
        }
    }
    return null;
}

// 순서: ①블러+비네트가 덮인다 -> ②"To Be Continued..."가 슬라이드로 들어와 우하단에 멈춘다(마지막
// 화라면 대신 화면 중앙에 "완결" 도장이 쾅 찍힌다 - 확인된 요청) -> ③1.5초 후 화면이 상하로(가챠
// 도어와 같은 방식이지만 위아래 방향) 닫힌다 -> ④닫힌 순간 다음 화의 첫 배경(블러 상태)을 미리
// 깔아두고 곧바로 다시 열어 흰 띠 배너("다음화"+제목)를 드러낸다(배너 뒤에는 캐릭터 없이 블러된
// 다음 배경만 있음) -> ⑤다시 한번 상하로 닫히면서 배너/문구/블러를 걷어내고 그 뒤에 Episode 선택
// 화면 + 화 선택 모달을 미리 띄워둔다 -> ⑥열리면 그 화면이 또렷하게 드러난다.
async function playChapterEndCinematic() {
    if (chapterEndCinematicActive) return;
    chapterEndCinematicActive = true;
    el.dialogueWrap.classList.add('hidden');
    closeChat();

    const isLastChapter = !CHAPTERS[currentChapterIndex + 1];

    el.chapterEndCinematic.classList.add('show');
    await wait(CEC_BLUR_MS);

    if (isLastChapter) {
        el.cecStamp.classList.add('show');
    } else {
        el.cecTbcText.classList.add('show');
    }
    await wait(CEC_TBC_SLIDE_MS + CEC_HOLD_BEFORE_CLOSE_MS);

    el.cecCurtainTop.classList.add('closed');
    el.cecCurtainBottom.classList.add('closed');
    await wait(CEC_CURTAIN_CLOSE_MS);

    // 화면이 완전히 덮인 시점 - 다음 화 배너 문구 + 다음 화의 첫 배경(블러 상태)을 준비해두고 다시 연다.
    const nextChapterIndex = currentChapterIndex + 1;
    const nextChapter = CHAPTERS[nextChapterIndex];
    el.cecBannerText.innerHTML = nextChapter
        ? `다음화<br>${nextChapter.title}${nextChapter.subtitle ? ' · ' + nextChapter.subtitle : ''}`
        : '다음 이야기를<br>기대해 주세요';
    const nextBg = nextChapter ? findFirstBg(nextChapterIndex) : null;
    if (nextBg) setBg(nextBg);
    setChars({ left: null, right: null, center: null });
    el.cecBanner.classList.add('show');
    el.cecCurtainTop.classList.remove('closed');
    el.cecCurtainBottom.classList.remove('closed');
    el.cecCurtainTop.classList.add('reopen');
    el.cecCurtainBottom.classList.add('reopen');
    await wait(CEC_BANNER_HOLD_MS);

    // 두 번째로 닫는다 - 이번엔 페이드아웃이 아니라 문(커튼)으로 화면을 다시 덮은 뒤, 그 뒤에서
    // 배너/문구/블러를 걷어내고 로비+화선택 모달을 미리 띄워둔다.
    el.cecCurtainTop.classList.remove('reopen');
    el.cecCurtainBottom.classList.remove('reopen');
    el.cecCurtainTop.classList.add('closed');
    el.cecCurtainBottom.classList.add('closed');
    await wait(CEC_CURTAIN_CLOSE_MS);

    el.cecTbcText.classList.remove('show');
    el.cecStamp.classList.remove('show');
    el.cecBanner.classList.remove('show');
    el.chapterEndCinematic.classList.add('no-backdrop');
    returnToLobby();
    showLobbyScreen('lobby-episodes');
    openChapterModal();

    el.cecCurtainTop.classList.remove('closed');
    el.cecCurtainBottom.classList.remove('closed');
    el.cecCurtainTop.classList.add('reopen');
    el.cecCurtainBottom.classList.add('reopen');
    await wait(CEC_CURTAIN_REOPEN_MS);

    // 다음 연출을 위해 전부 초기 상태로 되돌려둔다.
    el.chapterEndCinematic.classList.remove('show', 'no-backdrop');
    el.cecCurtainTop.classList.remove('closed', 'reopen');
    el.cecCurtainBottom.classList.remove('closed', 'reopen');
    chapterEndCinematicActive = false;
}

function returnToLobby() {
    playBgm(null);
    closeChat();
    el.letterLayer.classList.remove('show');
    el.letterPaper.classList.remove('rise', 'enlarge');
    el.letterEnvelope.classList.remove('show');
    el.itemDisplay.classList.remove('show');
    el.charCenter.classList.remove('item-reveal-shift');
    itemRevealHolding = false;
    setChars({ left: null, right: null, center: null });
    currentBgKey = null;
    el.lobbyWrap.classList.remove('hide');
    showLobbyScreen('lobby-home');
}

// 확대(ui-zoomed) 상태일 때는 #stage 클릭이 진행이 아니라 확대 해제부터 처리한다(인연 스토리와 동일).
el.stage.addEventListener('click', () => {
    if (el.stage.classList.contains('ui-zoomed')) { el.stage.classList.remove('ui-zoomed'); return; }
    advance();
});

/* ---- 신규: 확대(UI 숨기기) ---- */
document.getElementById('zoom-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    el.stage.classList.add('ui-zoomed');
});

/* ---- 신규: 대화 기록(대사) 모달 ---- */
function renderDialogueLog() {
    el.logModalContent.innerHTML = '';
    dialogueHistory.forEach(entry => {
        if (entry.isMonologue) {
            const mono = document.createElement('div');
            mono.className = 'log-monologue';
            mono.textContent = entry.text;
            el.logModalContent.appendChild(mono);
            return;
        }

        const row = document.createElement('div');
        row.className = entry.isPlayer ? 'log-entry log-entry-player' : 'log-entry log-entry-other';

        if (!entry.isPlayer && entry.avatarKey && CHAR_IMG[entry.avatarKey]) {
            const avatar = document.createElement('div');
            avatar.className = 'log-avatar';
            const img = document.createElement('img');
            img.src = CHAR_IMG[entry.avatarKey];
            img.alt = entry.name;
            if (typeof applyAvatarCrop === 'function') applyAvatarCrop(img, entry.avatarKey);
            avatar.appendChild(img);
            row.appendChild(avatar);
        }

        const card = document.createElement('div');
        card.className = entry.isPlayer ? 'log-bubble-card log-bubble-card-player' : 'log-bubble-card log-bubble-card-other';

        const nameEl = document.createElement('div');
        nameEl.className = 'log-speaker-name';
        nameEl.textContent = entry.name;
        card.appendChild(nameEl);

        const bubble = document.createElement('div');
        bubble.className = 'log-bubble';
        bubble.textContent = entry.text;
        card.appendChild(bubble);

        row.appendChild(card);
        el.logModalContent.appendChild(row);
    });
    el.logModalContent.scrollTop = el.logModalContent.scrollHeight;
}

document.getElementById('log-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    renderDialogueLog();
    el.logModal.classList.add('show');
});
document.getElementById('vn-log-modal-close').addEventListener('click', (e) => {
    e.stopPropagation();
    el.logModal.classList.remove('show');
});
el.logModal.addEventListener('click', (event) => {
    if (event.target === el.logModal) el.logModal.classList.remove('show');
});

/* ---- 신규: 스토리 진행 중 메뉴 모달 ----
   이어하기 = 모달만 닫고 계속, 종료 = 화 선택 모달을 다시 띄운 채로 Episode 선택 화면 복귀
   (서브 스토리는 화 단위 영구 잠금해제만 있고 씬 단위 체크포인트가 없으므로, 저장할 진행상황이
   따로 없다 - 나가면 그 화는 처음부터 다시 재생된다). */
document.getElementById('menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    el.menuModal.classList.add('show');
});
document.getElementById('vn-menu-resume').addEventListener('click', () => {
    el.menuModal.classList.remove('show');
});
el.menuModal.addEventListener('click', (event) => {
    if (event.target === el.menuModal) el.menuModal.classList.remove('show');
});
document.getElementById('vn-menu-exit').addEventListener('click', () => {
    el.menuModal.classList.remove('show');
    returnToLobby();
    showLobbyScreen('lobby-episodes');
    openChapterModal();
});

/* ---- 신규: 키보드 조작 ---- */
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        if (!el.lobbyWrap.classList.contains('hide')) return; // 로비가 보이는 중이면 확대 대상이 없음
        el.stage.classList.toggle('ui-zoomed');
        return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        if (!el.lobbyWrap.classList.contains('hide')) return; // 로비 화면
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
        if (document.querySelector('.vn-ticket-modal.show, #chapter-modal.show, #vn-log-modal.show')) return;
        event.preventDefault();
        advance();
    }
});

/* ---- 로비 ---- */
function showLobbyScreen(id) {
    document.querySelectorAll('.lobby-screen').forEach(s => s.classList.remove('show'));
    document.getElementById(id).classList.add('show');
}
document.querySelectorAll('.lobby-screen').forEach(s => {
    s.style.backgroundImage = `url('${BG_LOBBY_SHELF}')`;
});
el.kimnamokThumb.src = CHAR_IMG.kimnamok_ceo;
if (typeof applyAvatarCrop === 'function') applyAvatarCrop(el.kimnamokThumb);

document.getElementById('btn-episodes').addEventListener('click', () => {
    showLobbyScreen('lobby-episodes');
});
document.getElementById('episodes-back-btn').addEventListener('click', () => {
    showLobbyScreen('lobby-home');
});
document.getElementById('btn-exit').addEventListener('click', () => {
    window.location.href = 'home.html';
});
document.getElementById('btn-enter-kimnamok').addEventListener('click', () => {
    if (!hasKimnamok) return; // 버튼이 disabled라 정상 클릭으로는 여기 못 오지만, 방어적으로 한 번 더 막는다.
    openChapterModal();
});
el.chapterModalClose.addEventListener('click', closeChapterModal);
el.chapterModal.addEventListener('click', (event) => {
    if (event.target === el.chapterModal) closeChapterModal();
});

/* ---- 초기화 ---- */
(async function init() {
    await fetchStoryState();
    hasKimnamok = await fetchKimnamokOwnership();
    applyKimnamokLockState();
})();
