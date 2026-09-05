// 인연 스토리 Episode 1(윤대웅) 엔진. 원본 프로토타입(독서 RPG - 씬 1_윤대웅실루엣_사전적용수정.html)의
// 연출 로직을 그대로 이식하되, 진행상황·CG 도감·티켓 소모는 localStorage 대신 /story 서버 API로 저장한다.
// home.html의 story/story.js가 이 페이지로 navigate만 시켜주고, 그 뒤로는 이 파일이 전부 담당한다.
// 대사/분기/캐릭터/배경 등 실제 "글 부분"은 story/scenario/ep1_yoondaewoong.js로 분리되어 있다 -
// 이 파일은 그 데이터를 소비하는 엔진(재생/렌더링/씬 흐름) 로직만 담당한다. HTML에서 반드시
// scenario 파일을 이 스크립트보다 먼저 로드해야 한다(story-relationship.html 참고).

// API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.

function authHeaders(json = false) {
    const token = localStorage.getItem("access_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (json) headers["Content-Type"] = "application/json";
    return headers;
}

let PLAYER_NAME = "기본 캐릭터";
let ticketBalance = 0;
let cachedProgress = null;      // {scene_key, state} | null
let currentSceneKey = null;     // 지금 플레이 중인 씬(메뉴의 "저장 및 종료"가 저장할 체크포인트)
let unlockedCgSet = new Set();  // CG_GALLERY_ITEMS의 id 모음(서버에서 받아온 값을 그대로 캐시)
// storySecrets: 히든 엔딩 트리거 키워드 등 - 실제 값은 이 파일(공개 저장소)에 없고 /story/state
// 응답으로만 온다(backend/routers/story.py 참고). 저장소를 읽어서는 알아낼 수 없게 하려는 목적이라,
// 네트워크 탭까지 막지는 못한다(확인된 요청 - 그 수준까지는 안 막아도 됨).
let storySecrets = {};
let autoUseTickets = localStorage.getItem(AUTO_USE_STORAGE_KEY) === "1";

// 지금 로비/스테이지에서 활성화된 에피소드 번호(1|2) - 로비 카드 클릭 시 activateEpisodeBundle로
// STORY_ID/CHAR_IMG/BG/... 전역을 그 에피소드의 값으로 통째로 바꿔치기한 뒤 갱신된다. 이 값 자체를
// 참조하는 곳은 로비 UI(카드/상세화면) 배선뿐이고, 렌더링 엔진(renderCurrent 등)은 activateEpisodeBundle이
// 갈아끼운 전역들만 보고 동작하므로 어느 에피소드인지 몰라도 상관없다.
let activeEpisode = 1;

// "저장 및 종료"(vn-menu-save-exit)가 지금 이 순간의 진행 상태를 체크포인트로 저장할 때 쓸 state 객체를
// 만드는 함수 - 기본값은 ep1의 기존 동작(choice1/affJuheon 등)과 완전히 같다. Episode 2처럼 다른 플래그
// 집합을 쓰는 에피소드는 자기 카드를 클릭한 시점에 이 포인터를 자기 것으로 바꿔치기한다(startGame2/
// resumeGame2 참고) - serverSaveCheckpoint(sceneKey, stateOverride)의 stateOverride 자리에 이 함수의
// 결과를 넘기면, 언제 "저장 및 종료"를 누르든 지금 활성화된 에피소드에 맞는 모양으로 저장된다.
let getCurrentEpisodeState = () => ({ choice1, affJuheon, affSeungyu, affYeongwoong, affGanghee });

// Episode 1(ep1_yoondaewoong.js)/Episode 2(ep2_choijaehyeok.js)는 STORY_ID/CHAR_IMG/BG/PLAYER/
// CG_GALLERY_ITEMS/TRUE_ENDING_REQUIREMENTS/TRUE_ENDING_GALLERY_IDS/ENDING_CG_ID_BY_TITLE라는 같은
// 이름의 var를 공유한다(각 시나리오 파일이 자기 값을 EP1_BUNDLE/EP2_BUNDLE로 스냅샷해둔다) - 이 함수가
// 그 전역들을 통째로 넘겨받은 번들의 값으로 교체해서 "지금부터 렌더링 엔진이 이 에피소드를 그린다"를
// 구현한다. AUTO_USE_STORAGE_KEY도 함께 바뀌므로, 자동사용 티켓 설정은 에피소드마다 독립적으로 켜고 끌 수 있다.
function activateEpisodeBundle(bundle){
  STORY_ID = bundle.STORY_ID;
  AUTO_USE_STORAGE_KEY = bundle.AUTO_USE_STORAGE_KEY;
  ASSET_BASE = bundle.ASSET_BASE;
  CHAR_IMG = bundle.CHAR_IMG;
  BG = bundle.BG;
  PLAYER = bundle.PLAYER;
  CG_GALLERY_ITEMS = bundle.CG_GALLERY_ITEMS;
  TRUE_ENDING_REQUIREMENTS = bundle.TRUE_ENDING_REQUIREMENTS;
  TRUE_ENDING_GALLERY_IDS = bundle.TRUE_ENDING_GALLERY_IDS;
  ENDING_CG_ID_BY_TITLE = bundle.ENDING_CG_ID_BY_TITLE;
  autoUseTickets = localStorage.getItem(AUTO_USE_STORAGE_KEY) === "1";
  // 상세화면(시작하기/이어하기 버튼)을 보는 동안 이 에피소드의 배경/캐릭터 이미지를 전부 미리 받아둔다
  // (신고받아 추가 - preloadImages 선언부 주석 참고).
  preloadImages(CHAR_IMG);
  preloadImages(BG);
}

function withPlayerName(str) {
    return String(str ?? "").split("__PLAYER_NAME__").join(PLAYER_NAME);
}

// 대화 기록 모달의 독백(thought) 표시용 - 원문 대부분은 이미 괄호가 씌워져 있지만 아닌 경우도 있어서,
// 없으면 씌워준다.
function wrapInParens(str) {
    const trimmed = String(str ?? "").trim();
    return (trimmed.startsWith("(") && trimmed.endsWith(")")) ? str : `(${str})`;
}

function updateTicketChips() {
    document.querySelectorAll(
        "#vn-ticket-value-home, #vn-ticket-value-episodes, #vn-ticket-value-detail, #vn-ticket-value-stage"
    ).forEach((el) => { el.textContent = ticketBalance; });
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

    if (stateRes.ok) {
        const state = await stateRes.json();
        cachedProgress = state.progress || null;
        // unlockedCgSet은 매번 새로 교체하지 않고 누적한다 - 도감(갤러리)은 활성 에피소드와 무관하게
        // Episode 1/2 CG를 항상 함께 보여줘야 하는데(GALLERY_EPISODE_SECTIONS 참고), STORY_ID는 이
        // 함수가 호출되는 시점에 활성화된 딱 한 에피소드만 가리킨다. 그래서 여기서 지운 뒤 다시 채우면
        // "방금 안 불러온" 다른 에피소드의 해금 기록이 지워진 것처럼 보이는 문제가 생긴다. 두 에피소드의
        // cg_id 네임스페이스가 겹치지 않는 한(ep2는 'ep2_' 접두사를 쓴다) 누적이 항상 안전하다.
        (state.unlocked_cgs || []).forEach(id => unlockedCgSet.add(id));
        ticketBalance = state.ticket_balance || 0;
        storySecrets = state.secrets || {};
    }

    PLAYER.name = PLAYER_NAME;
    updateTicketChips();
}

// fetchStoryState()는 그 순간 활성화된 딱 한 에피소드(STORY_ID)의 unlocked_cgs만 받아온다. 그래서
// 페이지를 처음 열었을 때(기본 활성 에피소드=Episode 1)만 fetchStoryState를 부르면, 이전 세션에서
// Episode 2를 플레이해 실제로 서버에 해금해둔 CG라도 이번 로드에서는 한 번도 조회되지 않아 도감에서
// 잠긴 것처럼 보인다(새로고침하면 방금 전 세션에서 쌓인 unlockedCgSet 메모리도 함께 날아가므로 더
// 두드러진다). 그래서 등록된 모든 에피소드(EPISODE_REGISTRY)의 story_id를 한 번에 조회해 unlockedCgSet만
// 채워둔다 - cachedProgress/ticketBalance 등은 건드리지 않는다(그건 여전히 "현재 활성 에피소드" 것이어야
// 하므로 fetchStoryState의 몫으로 남긴다).
async function fetchAllUnlockedCgs() {
    const storyIds = Object.values(EPISODE_REGISTRY).map(info => info.dataBundle().STORY_ID);
    await Promise.all(storyIds.map(async (storyId) => {
        try {
            const res = await fetch(`${API_BASE_URL}/story/state?story_id=${encodeURIComponent(storyId)}`, { headers: authHeaders() });
            if (!res.ok) return;
            const state = await res.json();
            (state.unlocked_cgs || []).forEach(id => unlockedCgSet.add(id));
        } catch (error) {
            // 네트워크 실패는 무시 - 도감이 그 에피소드 몫만 덜 채워진 채로 남을 뿐, 페이지 진입 자체를
            // 막을 정도의 문제는 아니다.
        }
    }));
}

// 체크포인트 저장. 서버는 scene_key/state를 그대로 저장/반환만 하고 해석하지 않으므로,
// 원본의 saveCheckpoint처럼 실패해도(네트워크 문제 등) 진행을 막지 않는다. 게이트를 짧은 간격으로 연달아
// 통과하면(예: 티켓 자동사용 ON으로 빠르게 클릭) 호출도 연달아 일어나는데, 서로 다른 fetch를 순서
// 보장 없이 fire-and-forget으로 쏘면 네트워크 타이밍에 따라 나중에 보낸(다음 씬) 요청이 먼저 보낸
// (이전 씬) 요청보다 서버에 먼저 반영되고 그 위에 이전 씬 저장이 덮어쓸 수 있다 - 그래서 직전 저장이
// 끝난 뒤에만 다음 저장을 보내도록 프라미스 체인으로 순서를 강제한다.
let checkpointSaveChain = Promise.resolve();
// stateOverride: Episode 2 등 ep1과 다른 플래그 집합(choice1/affJuheon 등이 아닌 자기만의 변수)을 쓰는
// 에피소드가 저장할 state 객체를 직접 넘길 때 쓴다 - 안 넘기면(ep1의 기존 호출부는 전부 이렇게 부른다)
// 지금처럼 ep1 전용 변수들을 그대로 읽는다.
function serverSaveCheckpoint(sceneKey, stateOverride) {
    const state = stateOverride || { choice1, affJuheon, affSeungyu, affYeongwoong, affGanghee };
    cachedProgress = { scene_key: sceneKey, state };
    // keepalive: 이 저장이 응답을 기다리는 동안 유저가 "나가기"로 홈에 갔다가(예: 티켓 구매) 돌아오는
    // 등 페이지를 이동하면, keepalive 없이는 브라우저가 아직 안 끝난 이 요청을 그대로 중단시켜서 체크포인트가
    // 저장되지 않은 채로 남는다 - "이어보기"가 예전 씬부터 재생되며 같은 장면이 반복되는 것처럼 보이는 원인이었다.
    checkpointSaveChain = checkpointSaveChain.then(() =>
        fetch(`${API_BASE_URL}/story/progress`, {
            method: "POST",
            headers: authHeaders(true),
            body: JSON.stringify({ story_id: STORY_ID, scene_key: sceneKey, state }),
            keepalive: true,
        }).catch(() => {})
    );
    return checkpointSaveChain;
}

function serverClearProgress() {
    cachedProgress = null;
    fetch(`${API_BASE_URL}/story/progress?story_id=${encodeURIComponent(STORY_ID)}`, {
        method: "DELETE",
        headers: authHeaders(),
        keepalive: true,
    }).catch(() => {});
}

async function consumeTicketOnServer() {
    try {
        const res = await fetch(`${API_BASE_URL}/story/consume-ticket`, {
            method: "POST",
            headers: authHeaders(true),
            body: JSON.stringify({ story_id: STORY_ID }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        ticketBalance = data.ticket_balance ?? ticketBalance;
        updateTicketChips();
        return true;
    } catch (error) {
        return false;
    }
}

async function serverUnlockCG(id) {
    unlockedCgSet.add(id);
    try {
        const res = await fetch(`${API_BASE_URL}/story/unlock-cg`, {
            method: "POST",
            headers: authHeaders(true),
            body: JSON.stringify({ story_id: STORY_ID, cg_id: id }),
        });
        const data = await res.json();
        // quests.js/gacha.js와 동일한 패턴 - 이 CG(주로 히든 엔딩) 해금으로 새로 달성한 업적이
        // 캐릭터를 보상으로 줬으면, 퀘스트/가챠와 똑같은 등장 연출부터 보여주고 업적 알림은 그
        // 연출이 닫힌 뒤에 띄운다(확인된 요청 - 예전엔 아무 연출 없이 조용히 지급됐음).
        const notifyAchievements = () => {
            if (typeof showAchievementToast === "function" && data.new_achievements?.length) {
                showAchievementToast(data.new_achievements);
            }
        };
        if (typeof playQuestRewardCinematic === "function" && data.new_characters?.length) {
            playQuestRewardCinematic(data.new_characters, notifyAchievements);
        } else if (typeof showCharacterReveal === "function" && data.new_characters?.length) {
            showCharacterReveal(data.new_characters, notifyAchievements);
        } else {
            notifyAchievements();
        }
    } catch (error) { /* 갤러리는 다음 /story/state 조회 시 다시 맞춰짐 */ }
}

// 배경/캐릭터 이미지를 미리 브라우저 캐시에 올려둔다 - 안 그러면 그 배경/인물이 씬에 처음 등장하는
// 순간에야 다운로드+디코드가 시작돼서, 그 찰나 동안 늦게 나타나는 것처럼 보인다(특히 용량이 유독 컸던
// 강희/승유의 "정면 스탠딩" 변형에서 두드러졌다 - 그 png 3장은 webp로 다시 압축해서 실제 용량 자체도
// 6~8배 줄였다). new Image().src만 지정해두면 실제 <img>/background-image에 쓰이기 전에도 브라우저가
// 다운로드+디코드를 미리 끝내둔다.
function preloadImages(srcMap){
  Object.values(srcMap || {}).forEach((src) => { if(src) new Image().src = src; });
}
// 스크립트 로드 시점에는 아직 activateEpisodeBundle이 한 번도 안 불려서 CHAR_IMG가 ep1_yoondaewoong.js가
// 심어둔 기본값(ep1 캐릭터) 그대로다 - 로비 화면을 보는 동안 일단 이것부터 예열한다. BG/ep2 쪽은
// activateEpisodeBundle이 에피소드 카드를 누르는 즉시(시작하기 버튼을 누르기 전, 상세화면을 보는
// 동안) 마저 예열한다(신고받아 추가 - 이전엔 배경은 아예 예열되지 않았고, 캐릭터도 스크립트 로드
// 시점의 ep1 값만 한 번 예열돼서 Episode 2로 전환하면 다시 예열되지 않았다).
preloadImages(CHAR_IMG);

/* =========================================================
   엔진
   ========================================================= */
let queue = [];
let idx = 0;
let typing = false;
let typeTimer = null;
let affJuheon = 0;
let affSeungyu = 0;
let affYeongwoong = 0;
let affGanghee = 0;
let choice1 = null;
let onQueueEnd = null;
let juheonEndingVisualActive = false;
let currentBgKey = null;
let backgroundTransitioning = false;
let mysteryRevealTransitioning = false;
let timeCardTransitioning = false;
let skipInterval = null; // 컨트롤 키를 누르고 있는 동안 advance()를 빠르게 반복 호출하는 초고속 스킵
// 대화 기록(대사) 모달용 - 새 플레이 세션이 시작될 때만 비운다(startGame/resumeGame 참고). playQueue는
// 선택지 분기 등 훨씬 잦은 단위로도 불려서 거기서 비우면 선택지를 고를 때마다 이전 기록이 사라진다.
// type:'line'(실제 발화)과 type:'thought'(독백)만 쌓고 narration/chat은 제외한다.
let dialogueHistory = [];

const el = {
  stage: document.getElementById('stage'),
  box: document.getElementById('box'),
  text: document.getElementById('line-text'),
  nameplate: document.getElementById('nameplate'),
  nameMain: document.getElementById('name-main'),
  nameSub: document.getElementById('name-sub'),
  charLeft: document.getElementById('char-left'),
  charLeftImg: document.getElementById('char-left-img'),
  charCenter: document.getElementById('char-center'),
  charCenterImg: document.getElementById('char-center-img'),
  charRight: document.getElementById('char-right'),
  charRightImg: document.getElementById('char-right-img'),
  choiceLayer: document.getElementById('choice-layer'),
  endLayer: document.getElementById('end-layer'),
  endTitle: document.getElementById('end-title'),
  endAffection: document.getElementById('end-affection'),
  hint: document.getElementById('advance-hint'),
  dialogueWrap: document.getElementById('dialogue-wrap'),
  phoneLayer: document.getElementById('phone-layer'),
  phoneContacts: document.getElementById('phone-contacts'),
  chatMessages: document.getElementById('chat-messages'),
  phoneCompose: document.getElementById('phone-compose'),
  phoneComposeInput: document.getElementById('phone-compose-input'),
  phoneComposeSend: document.getElementById('phone-compose-send'),
  sceneFade: document.getElementById('scene-fade'),
  timeCard: document.getElementById('time-card-overlay'),
  timeCardText: document.getElementById('time-card-text'),
  bgmPlayer: document.getElementById('bgm-player'),
  fxFlash: document.getElementById('fx-flash'),
  fxShockwave: document.getElementById('fx-shockwave'),
  fxLetterboxTop: document.getElementById('fx-letterbox-top'),
  fxLetterboxBottom: document.getElementById('fx-letterbox-bottom'),
  fxGlitch: document.getElementById('fx-glitch'),
  fxSpeedlines: document.getElementById('fx-speedlines'),
  propInputLayer: document.getElementById('prop-input-layer'),
  propInputLabel: document.getElementById('prop-input-label'),
  propInputField: document.getElementById('prop-input-field'),
  propInputConfirm: document.getElementById('prop-input-confirm'),
  itemDisplay: document.getElementById('item-display'),
  itemDisplayImg: document.getElementById('item-display-img'),
  letterLayer: document.getElementById('letter-layer'),
  letterEnvelope: document.getElementById('letter-envelope'),
  letterEnvelopeImg: document.getElementById('letter-envelope-img'),
  letterPaper: document.getElementById('letter-paper'),
  letterPaperImg: document.getElementById('letter-paper-img'),
  letterPaperText: document.getElementById('letter-paper-text'),
};

let curLeftKey = null;
let curCenterKey = null;
// center 슬롯은 "혼자 등장" 스포트라이트와 그룹(트리오)의 가운데 자리를 겸한다 - 이번 setChars 갱신에
// left/right가 함께 채워지면 'group'(세로 fade+rise), center만 있으면 'solo'(가로 slide)로 정해진다.
let curCenterMode = 'solo';
let curRightKey = null;

/* ---- 모모톡 스타일 채팅 UI ---- */

function openChat(activeKey){
  playSe(SE.CHAT_OPEN);
  el.phoneContacts.innerHTML = '';
  CONTACT_LIST.forEach(c=>{
    const row = document.createElement('div');
    row.className = 'phone-contact' + (c.key === activeKey ? ' active' : '');
    row.innerHTML = `<span class="avatar">${c.name[0]}</span><span>${c.name}</span>`;
    el.phoneContacts.appendChild(row);
  });
  el.chatMessages.innerHTML = '';
  el.phoneLayer.classList.add('show');
}

function closeChat(){
  el.phoneLayer.classList.remove('show');
  el.phoneCompose.classList.remove('show');
}

function addChatBubble(from, text){
  const isPlayer = (from === 'player');
  const row = document.createElement('div');
  row.className = 'chat-bubble-row ' + (isPlayer ? 'out' : 'in');
  const avatar = isPlayer ? '' : `<span class="avatar">${from.name[0]}</span>`;
  row.innerHTML = `${avatar}<span class="chat-bubble"></span>`;
  el.chatMessages.appendChild(row);
  row.querySelector('.chat-bubble').textContent = withPlayerName(text);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

function showComposeInput(onSubmit){
  el.phoneCompose.classList.add('show');
  el.phoneComposeInput.value = '';
  el.phoneComposeInput.focus();
  el.phoneComposeInput.onclick = (e)=>{ e.stopPropagation(); };
  const submit = ()=>{
    const val = el.phoneComposeInput.value.trim();
    if(!val) return;
    el.phoneCompose.classList.remove('show');
    el.phoneComposeSend.onclick = null;
    el.phoneComposeInput.onkeydown = null;
    addChatBubble('player', val);
    onSubmit(val);
  };
  el.phoneComposeSend.onclick = (e)=>{ e.stopPropagation(); submit(); };
  el.phoneComposeInput.onkeydown = (e)=>{
    e.stopPropagation();
    if(e.key === 'Enter'){ submit(); }
  };
}

// 모모톡 채팅과 무관한 범용 소품(상자 자물쇠 등) 텍스트 입력 - showComposeInput은 채팅창이 열려 있어야만
// 보이는 구조라(#phone-compose가 #phone-layer 안에 중첩) 채팅과 무관한 장면에는 쓸 수 없어서 따로 둔다.
function showPropInput(label, onSubmit){
  el.propInputLabel.textContent = label || '';
  el.propInputField.value = '';
  el.propInputLayer.classList.add('show');
  window.setTimeout(()=>{ el.propInputField.focus(); }, 50);
  const submit = ()=>{
    const val = el.propInputField.value.trim();
    if(!val) return;
    el.propInputLayer.classList.remove('show');
    el.propInputConfirm.onclick = null;
    el.propInputField.onkeydown = null;
    onSubmit(val);
  };
  el.propInputConfirm.onclick = (e)=>{ e.stopPropagation(); submit(); };
  el.propInputField.onkeydown = (e)=>{
    e.stopPropagation();
    if(e.key === 'Enter'){ submit(); }
  };
}

function setBg(key){
  currentBgKey = key && BG[key] ? key : null;

  if(!currentBgKey){
    el.stage.style.backgroundImage = 'none';
    el.stage.style.backgroundColor = '#000';
    return;
  }

  el.stage.style.backgroundColor = '#000';
  el.stage.style.backgroundImage = `url('${BG[currentBgKey]}')`;
}

/* ---- BGM ----
   씬 데이터의 각 줄에 bgm:'키' 를 붙이면 그 시점부터 assets/story/shared/bgm/키.mp3 를 반복 재생한다.
   키에 확장자를 직접 쓰면(bgm:'키.wav', bgm:'키.ogg', bgm:'키.flac' 등) 그 확장자를 그대로 사용한다 -
   flac도 이미 이 방식으로 지원된다(요청됨, 크로미움 계열/파이어폭스는 <audio>에서 flac을 그대로
   재생할 수 있다 - 별도 엔진 수정 불필요, assets/story/shared/bgm/에 .flac 파일만 놓고 그 파일명대로
   확장자까지 적어서 지정하면 된다).
   이미 그 곡이 재생 중이면 아무 것도 하지 않는다(끊기지 않고 계속 흐름) - "한 씬에 기본적으로 하나,
   같은 곡이 다시 지정돼도 처음부터 다시 재생하지 않음"이라는 요구사항에 맞춘 것.
   같은 줄에 bgm 대신 stopBgm:true 를 쓰면 재생 중이던 곡을 그 자리에서 끊는다.
   원래 ep1 전용 폴더(assets/story/ep1/bgm/)에 있던 곡들을 Episode 2도 같은 곡을 재사용할 수 있도록
   shared로 옮겼다(요청됨) - envelope/paper(편지)를 이미 assets/story/shared/letter/에서 공유하는 것과
   같은 패턴. bgm:'키' 값 자체(파일 이름)는 그대로라 ep1 시나리오 데이터는 고칠 필요가 없었다. */
const BGM_BASE = 'assets/story/shared/bgm/';
const BGM_FADE_MS = 500;
let currentBgmKey = null;
let bgmFadeTimer = null;

function cancelBgmFade(){
  if(bgmFadeTimer !== null){
    clearInterval(bgmFadeTimer);
    bgmFadeTimer = null;
  }
  el.bgmPlayer.volume = 1;
}

function playBgm(key){
  if(currentBgmKey === key){
    // 이미 같은 곡으로 지정은 돼 있지만(currentBgmKey), 브라우저 자동재생 정책 등으로 그때의 play()가
    // 거부돼서 실제로는 소리가 안 나고 있을 수 있다 - 그대로 두면 나중에 어떤 줄이 다시 같은 곡을
    // 지정해도 "이미 재생 중"으로 오판해서 영영 재시도를 안 한다(몇몇 bgm이 안 들리던 원인). 실제로
    // 멈춰있으면(=지난 play()가 실패했던 경우) 다시 시도한다.
    if(key && el.bgmPlayer.paused) el.bgmPlayer.play().catch(()=>{});
    return;
  }
  currentBgmKey = key;
  cancelBgmFade(); // 페이드아웃 도중 새 곡이 지정되면 페이드를 취소하고 볼륨을 원래대로

  if(!key){
    const player = el.bgmPlayer;
    const startVolume = player.volume;
    const stepMs = 20;
    const steps = Math.max(1, Math.round(BGM_FADE_MS / stepMs));
    let step = 0;
    bgmFadeTimer = setInterval(()=>{
      step += 1;
      player.volume = Math.max(0, startVolume * (1 - step / steps));
      if(step >= steps){
        clearInterval(bgmFadeTimer);
        bgmFadeTimer = null;
        player.pause();
        player.removeAttribute('src');
        player.volume = startVolume;
      }
    }, stepMs);
    return;
  }

  // 확장자 판별은 실제 오디오 확장자 목록으로만 한다 - 예전엔 "점 + 영숫자로 끝나는가"만 봐서
  // 'll.Responsibility'처럼 곡 제목 자체에 점이 들어간 키를 "이미 확장자가 붙었다"고 오판해 .mp3를
  // 붙이지 않은 채로 존재하지 않는 파일을 요청하는 버그가 있었다(도감에서 히든 엔딩 CG의 bgm이
  // 재생되지 않던 원인 - 신고받아 수정).
  const file = /\.(mp3|ogg|wav|flac|m4a|aac)$/i.test(key) ? key : `${key}.mp3`;
  el.bgmPlayer.src = `${BGM_BASE}${file}`;
  el.bgmPlayer.currentTime = 0;
  // 브라우저의 자동재생 정책상, 사용자가 아직 페이지를 한 번도 클릭하지 않은 채로 재생을 시도하면
  // play()가 거부될 수 있다 - 이 경우 조용히 무시한다(다음 클릭/줄 진행 때 자연히 다시 시도됨).
  el.bgmPlayer.play().catch(()=>{});
}

/* ---- 효과음(SE) ----
   씬 데이터의 각 줄에 se:'키' 를 붙이면 assets/story/shared/SE/키.ogg 를 한 번 재생한다(범용 - 어느
   에피소드든 재사용 가능). bgmPlayer(반복, 단일 트랙 하나만 재생)와 달리 효과음은 같은 줄에서 여러
   개가(예: impact+hitFlash) 동시에 겹쳐 울려야 자연스러운 경우가 많아서, 공유 <audio> 엘리먼트 하나를
   재사용하지 않고 재생할 때마다 새 Audio 인스턴스를 만든다 - 안 그러면 두 번째 재생이 src를 바꾸면서
   첫 번째 소리를 끊어버린다.
   SE 테이블은 이미 있는 이펙트 필드(explosion/impact/hitFlash/glitch/shockReveal/comedyBounce/
   cameraPunch/staggerCollapse/letterbox/itemReveal/itemHide/openChat/letterOpen/letterClose/
   revealCharacter)마다 어울리는 기본 효과음을 하나씩 골라 자동으로 붙여준다(씬 데이터를 한 줄도 고치지
   않아도 ep1/ep2 모두에 즉시 적용됨) - 다만 whiteout처럼 같은 필드라도 맥락에 따라 전혀 다른 소리가
   맞는 경우(기억 소거의 화이트아웃 vs 귀환의 돌 순간이동 vs 차원문이 열리는 빛 등)는 기본값을 두지
   않고, 씬 데이터에 se:'키'를 직접 지정해서 맥락에 맞는 소리를 고르게 한다. */
const SE_BASE = 'assets/story/shared/SE/';
const SE = {
  HIT: 'SE_Hit_02',
  IMPACT: 'SE_Earthquake_01',
  RUMBLE: 'SE_Earthquake_01',
  EXPLOSION: 'SE_BoomEffect_01',
  EXPLOSION_LARGE: 'SE_Boom_01',
  GLITCH: 'SE_Glitch_01',
  SHOCK_REVEAL: 'SE_Appear_02a',
  COMEDY_BOUNCE: 'SE_Flick_01',
  CAMERA_PUNCH: 'SE_Snap_01',
  STAGGER_COLLAPSE: 'SE_Fall_03',
  LETTERBOX_SHOW: 'SE_SlideClose_01',
  LETTERBOX_HIDE: 'SE_SlideOpen_01',
  ITEM_REVEAL: 'SE_Gear_02',
  ITEM_HIDE: 'SE_Fade_01',
  CHAT_OPEN: 'SE_MomoTalk_01',
  LETTER_OPEN: 'SE_PourPaper_01',
  LETTER_CLOSE: 'SE_PourPaper_02',
  CALL_CONNECT: 'SE_Radio_01',
  SPRITE_DIP: 'SE_Gear_02',
};
function playSe(key){
  if(!key) return;
  const file = /\.(mp3|ogg|wav|flac|m4a|aac)$/i.test(key) ? key : `${key}.ogg`;
  const audio = new Audio(`${SE_BASE}${file}`);
  audio.volume = 0.85;
  audio.play().catch(()=>{});
}

function triggerImpactShake(){
  el.stage.classList.remove('impact-shake');
  // 같은 CG가 연속으로 호출되어도 애니메이션이 다시 재생되도록 강제 리플로우
  void el.stage.offsetWidth;
  el.stage.classList.add('impact-shake');

  window.setTimeout(()=>{
    el.stage.classList.remove('impact-shake');
  }, 760);
}

// 지진(rumble) - "쿠구구구……." 같은 지속적인 진동/긴장감 연출 전용(요청됨). triggerImpactShake는
// 확대+명암 플래시가 있는 한 번의 타격용이라 "미세하게 진동" 같은 서서히 차오르는 느낌과는 안 맞아서,
// 화면이 좌우로 살짝, 더 오래(1.2s) 흔들리기만 하는 별도의 연출을 둔다(story-relationship.css의
// rumbleShake 참고).
const RUMBLE_SHAKE_MS = 1200;
function triggerRumbleShake(){
  el.stage.classList.remove('rumble-shake');
  void el.stage.offsetWidth;
  el.stage.classList.add('rumble-shake');

  window.setTimeout(()=>{
    el.stage.classList.remove('rumble-shake');
  }, RUMBLE_SHAKE_MS);
}

// ===== Episode 2 신규 연출 - 범용 함수(story-relationship.css의 #fx-* 규칙과 짝을 이룬다,
// 어느 에피소드에서든 line.explosion/glitch/shockReveal/letterbox/staggerCollapse로 재사용 가능) =====

// 화면 폭발: 흰/주황 플래시 + CSS로만 그리는 확장형 충격파 링 + 기존 화면 흔들림을 함께 재생한다.
// large=true면("필살기"급) 플래시/링이 더 크고 오래 간다.
function triggerExplosion(large){
  triggerImpactShake();
  const dur = large ? 900 : 600;

  [el.fxFlash, el.fxShockwave].forEach(node => {
    node.classList.remove('show', 'large');
    void node.offsetWidth; // 연속 호출에도 애니메이션이 처음부터 다시 재생되도록 강제 리플로우
    node.classList.add('show');
    if(large) node.classList.add('large');
  });
  window.setTimeout(()=>{
    el.fxFlash.classList.remove('show', 'large');
    el.fxShockwave.classList.remove('show', 'large');
  }, dur);
}

// 시네마틱 레터박스: 상하 검은 띠가 좁혀 들어와 전투/대결 긴장감을 연출한다.
// show=false를 넘기면(또는 인자 없이) 다시 걷는다 - 사라질 때까지 유지되므로 씬 데이터가 명시적으로 켜고 끈다.
function setLetterbox(show){
  playSe(show ? SE.LETTERBOX_SHOW : SE.LETTERBOX_HIDE);
  el.fxLetterboxTop.classList.toggle('show', Boolean(show));
  el.fxLetterboxBottom.classList.toggle('show', Boolean(show));
}

// 글리치/정전: RGB 채널 분리 + 스캔라인 깜빡임을 짧게 재생하고 스스로 사라진다
// ("모든 전자기기가 동시에 꺼지고 화면에 낯선 인물이 나타난다" 같은 장면 전용).
function triggerGlitch(){
  el.fxGlitch.classList.remove('show');
  void el.fxGlitch.offsetWidth;
  el.fxGlitch.classList.add('show');
  window.setTimeout(()=>{ el.fxGlitch.classList.remove('show'); }, 650);
}

// 충격 리빌: 방사형 스피드라인 버스트 + 급격한 화이트아웃 한 프레임. 정체 공개/반전의 순간에 쓴다.
function triggerShockReveal(){
  el.fxSpeedlines.classList.remove('show');
  void el.fxSpeedlines.offsetWidth;
  el.fxSpeedlines.classList.add('show');
  window.setTimeout(()=>{ el.fxSpeedlines.classList.remove('show'); }, 500);
}

// 스탠딩 비틀거리다 쓰러짐: 좌우로 휘청인 뒤 무릎이 꺾이듯 회전+하강하며 페이드아웃된다. 그 자리에
// 아무도 없으면 조용히 아무 일도 하지 않는다. 순수 비주얼 효과라 slot 상태(curXKey)는 건드리지 않고,
// 그 뒤 그 자리를 실제로 비우거나 다른 인물로 바꾸는 것은 항상 씬 데이터의 몫이다(chars:{...:null} 등) -
// 그때 setCharacterSlot/playSlotsEnterBatched가 이 클래스도 함께 정리한다.
function triggerStaggerCollapse(side){
  const containers = { left: el.charLeft, center: el.charCenter, right: el.charRight };
  const container = containers[side];
  if(!container || !container.classList.contains('show')) return;
  container.classList.remove('stagger-collapse');
  void container.offsetWidth;
  container.classList.add('stagger-collapse');
  // 소리는 비틀거리기 시작할 때가 아니라 실제로 바닥에 완전히 쓰러지는 순간(요청됨)에 맞춰야 한다 -
  // staggerCollapseLeftAnchor/RightAnchor 키프레임(story-relationship.css)을 보면 90% 지점에서 이미
  // 회전+하강이 끝나 있고(90%~100%는 그 자세 그대로 페이드아웃만 한다), 그 직전인 STAGGER_COLLAPSE_MS의
  // 85% 지점에서 재생하면 몸이 바닥에 닿는 타이밍과 거의 겹친다.
  window.setTimeout(()=>{ playSe(SE.STAGGER_COLLAPSE); }, Math.round(STAGGER_COLLAPSE_MS * 0.85));
}

// 피격 시 캐릭터 스프라이트가 짧게 밝게/붉게 번쩍인다(전투 타격감). 그 자리에 아무도 없으면 무시.
function triggerHitFlash(side){
  const imgs = { left: el.charLeftImg, center: el.charCenterImg, right: el.charRightImg };
  const img = imgs[side];
  const container = { left: el.charLeft, center: el.charCenter, right: el.charRight }[side];
  if(!img || !container || !container.classList.contains('show')) return;
  img.classList.remove('hit-flash');
  void img.offsetWidth;
  img.classList.add('hit-flash');
}

// 코미디성 개그 타격 - stagger-collapse(쓰러짐)와 달리 통통 튀듯 흔들리다 원래 자세로 돌아온다.
// 강 희의 구취 브레스에 김현재가 기절하는 장면처럼, 심각하지 않은 코믹한 피격에 쓴다.
function triggerComedyBounce(side){
  const imgs = { left: el.charLeftImg, center: el.charCenterImg, right: el.charRightImg };
  const img = imgs[side];
  const container = { left: el.charLeft, center: el.charCenter, right: el.charRight }[side];
  if(!img || !container || !container.classList.contains('show')) return;
  img.classList.remove('comedy-bounce');
  void img.offsetWidth;
  img.classList.add('comedy-bounce');
}

// 카메라 펀치인 - 대사의 임팩트를 강조하고 싶을 때 화면 전체가 아주 짧게 훅 확대됐다 되돌아온다.
// 흔들리지 않는다는 점에서 triggerImpactShake와 다르다(타격이 아니라 "강조"용).
function triggerCameraPunch(){
  el.stage.classList.remove('camera-punch');
  void el.stage.offsetWidth;
  el.stage.classList.add('camera-punch');
}

// 화이트아웃 - 시간이동처럼 "빛에 삼켜지는" 전환에 쓴다(암전의 흰색 버전). show=true로 덮고,
// false로 걷는다 - 씬 데이터가 명시적으로 켜고 끈다(setLetterbox와 같은 패턴).
// instant=true(noBgFade가 걸린 줄)면 트랜지션 없이 즉시 걷어낸다 - 안 그러면 scene-fade의 .65s
// 오퍼시티 트랜지션 동안 흰 화면이 서서히 걷히는데, 그 위에서 같은 줄의 impact(화면 흔들림)가 먼저
// 트리거돼도 아직 거의 새하얀 상태라 흔들림이 안 보이는 버그가 있었다(신고받아 수정 - 재혁 쌍욕
// 앤딩과 같은 "화이트아웃 -> 흔들림+CG 즉시 등장" 연출에서 흔들림만 안 보이던 원인).
function setWhiteout(show, instant){
  if(instant){
    el.sceneFade.style.transition = 'none';
    el.sceneFade.classList.toggle('white', Boolean(show));
    el.sceneFade.classList.toggle('active', Boolean(show));
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        el.sceneFade.style.transition = '';
      });
    });
    return;
  }
  el.sceneFade.classList.toggle('white', Boolean(show));
  el.sceneFade.classList.toggle('active', Boolean(show));
}

// #scene-fade의 opacity 트랜지션(.65s ease, story-relationship.css 참고)과 맞춘 값 - 화면이
// 실제로 다 하얘지는 데 걸리는 시간만큼 대사 등장을 늦춰야 한다.
const WHITEOUT_FADE_MS = 650;
let whiteoutRevealHolding = false;
let whiteoutRevealedGeneration = -1;
let whiteoutRevealedIdx = -1;

// whiteout:true이면서 텍스트도 갖고 있는 줄 전용 - 대사창을 먼저 숨기고 화이트아웃을 켠 뒤, 화면이
// 실제로 다 하얘질 때까지 기다렸다가 같은 줄을 다시 렌더링한다(이번엔 whiteoutRevealedIdx가 일치해서
// 이 분기를 건너뛰고 평소처럼 타이핑을 시작한다) - #dialogue-wrap이 #scene-fade보다 위에 오도록
// story-relationship.css에 #scene-fade.white ~ #dialogue-wrap 규칙을 함께 둬서, 다 하얘진 뒤에는
// 대사가 그 하얀 배경 위에 올바르게 보인다.
function playWhiteoutTextReveal(line, forIdx){
  const startedGeneration = queueGeneration;
  whiteoutRevealHolding = true;
  el.dialogueWrap.classList.add('hidden');
  setWhiteout(true);
  window.setTimeout(()=>{
    if(queueGeneration !== startedGeneration) return; // playQueue 주석 참고
    whiteoutRevealHolding = false;
    whiteoutRevealedGeneration = startedGeneration;
    whiteoutRevealedIdx = forIdx;
    renderCurrent();
  }, WHITEOUT_FADE_MS);
}

// CSS staggerCollapseLeftAnchor/RightAnchor 애니메이션 재생 시간(.95s)과 맞춘 값.
const STAGGER_COLLAPSE_MS = 950;
let staggerCollapseHolding = false;
let staggerCollapseRevealedGeneration = -1;
let staggerCollapseRevealedIdx = -1;

// staggerCollapse가 걸린 줄 전용 - whiteout과 같은 패턴이다(playWhiteoutTextReveal 참고). 캐릭터가
// 쓰러지는 동안 대사창을 숨겨뒀다가(요청됨 - 안 그러면 쓰러지는 도중에도 다음 대사가 이미 옆에 보여
// 산만했다), 쓰러짐 애니메이션이 실제로 끝날 때까지 기다린 뒤 같은 줄을 다시 렌더링한다(이번엔
// staggerCollapseRevealedIdx가 일치해서 이 분기를 건너뛰고 평소처럼 대사창이 열리며 타이핑을 시작한다).
function playStaggerCollapseReveal(line, forIdx){
  const startedGeneration = queueGeneration;
  staggerCollapseHolding = true;
  el.dialogueWrap.classList.add('hidden');
  triggerStaggerCollapse(line.staggerCollapse);
  window.setTimeout(()=>{
    if(queueGeneration !== startedGeneration) return; // playQueue 주석 참고
    staggerCollapseHolding = false;
    staggerCollapseRevealedGeneration = startedGeneration;
    staggerCollapseRevealedIdx = forIdx;
    renderCurrent();
  }, STAGGER_COLLAPSE_MS);
}

// 통화/화면(TV 중계, 영상통화 등) 속 인물 - 흐릿한 화질+푸르스름한 색조+스캔라인+지지직 노이즈가
// 명시적으로 끌 때까지 계속된다(setLetterbox와 같은 온/오프 패턴). slot을 넘기면 그 자리에만 켜고
// 나머지는 끈다 - 동시에 두 명이 화면에 나오는 경우는 없다고 가정한, 가장 단순한 형태. slot을
// null/false로 넘기거나 생략하면(예: 화면이 꺼지는 순간) 전부 끈다.
// tvStaticSpeakingSlot에 있는 인물이 화면 너머로 "처음" 입을 열 때만 통화/방송 연결음을 한 번 재생하기
// 위한 상태(요청됨) - 매 대사마다 울리면 시끄러우니, tv-static이 새로 켜질 때마다 초기화하고 그 뒤
// 첫 대사에서만 tvStaticSpokenOnce를 true로 바꾼다(applySpeakingDim 호출부 근처의 dispatch 참고).
let tvStaticSpeakingSlot = null;
let tvStaticSpokenOnce = false;
function setCharTvStatic(slot){
  tvStaticSpeakingSlot = slot || null;
  tvStaticSpokenOnce = false;
  [el.charLeft, el.charCenter, el.charRight].forEach(c => {
    c.classList.remove('tv-static');
    c.style.removeProperty('--tv-mask-image');
  });
  const containers = { left: el.charLeft, center: el.charCenter, right: el.charRight };
  const imgs = { left: el.charLeftImg, center: el.charCenterImg, right: el.charRightImg };
  const container = containers[slot];
  const img = imgs[slot];
  if(!container) return;
  // 스캔라인/색조 오버레이가 사각형이 아니라 지금 보이는 스탠딩의 실루엣에만 씌워지도록(요청됨),
  // 그 스탠딩과 같은 이미지를 CSS 마스크로 쓴다(story-relationship.css의 #char-*.tv-static .tv-scan-mask
  // 참고). img.src(DOM 프로퍼티)를 써야 한다 - getAttribute('src')는 JS가 원래 넣은 상대경로 문자열
  // 그대로라, 이 값을 커스텀 프로퍼티에 그대로 넣으면 mask-image: var(...)를 실제로 소비하는
  // story-relationship.css 파일의 위치(story/) 기준으로 다시 해석되어 경로가 한 단계 어긋나
  // (story/assets/... 처럼) 이미지를 못 찾는다 - 그래서 마스크가 아예 안 보이는 원인이었다(신고받아
  // 수정). img.src는 브라우저가 문서 기준으로 이미 정규화해준 절대 URL이라 어디서 소비되든 항상 옳다.
  const src = img && img.src;
  if(src) container.style.setProperty('--tv-mask-image', `url("${src}")`);
  container.classList.add('tv-static');
}

// tv-static이 켜진 슬롯의 인물이 실제로 말하는 첫 대사에서만(요청됨 - 화면 너머 목소리가 처음 들리는
// 순간이라 통화/방송 연결음이 자연스럽다. 그 뒤로 계속 말할 때마다 울리면 시끄러우니 한 번만) 통화
// 효과음을 재생한다. line.type==='line' 분기에서 applySpeakingDim과 같은 자리에서 호출한다.
function maybePlayTvStaticFirstSpeakSe(speakerKey){
  if(!tvStaticSpeakingSlot || tvStaticSpokenOnce || !speakerKey) return;
  const slotKeys = { left: curLeftKey, center: curCenterKey, right: curRightKey };
  const occupant = slotKeys[tvStaticSpeakingSlot];
  if(!occupant || normalizeCastSpeakerKey(occupant) !== normalizeCastSpeakerKey(speakerKey)) return;
  tvStaticSpokenOnce = true;
  playSe(SE.CALL_CONNECT);
}

// 아이템 등장(귀환의 돌 등) - type:'itemReveal'/'itemHide' 전용 연출. 대사창을 숨긴 채(요청됨) 중앙
// 캐릭터가 옆으로 비켜서고(#char-center.item-reveal-shift, .5s), 그 다음 아이템이 사각형 컨테이너
// 안에서 떠오르듯 나타난다(#item-display.show, .5s). 순서를 완전히 끝낸 뒤에야(각 단계의 CSS
// 트랜지션 시간만큼 실제로 기다린 뒤) idx를 올리고 다음 줄로 자동 진행한다 - 반대(itemHide)는 역순.
// line.item에는 완성된 이미지 URL을 직접 넘긴다(편지의 envelope/paper와 같은 이유로, 엔진은 어느
// 아이템인지 모른 채로 둔다). line.chars를 함께 주면(예: 표정이 바뀐 스탠딩) 비켜서는 동작이 끝난
// 직후 그 모습으로 즉시 바꿔치기한다(강 희처럼 스프라이트가 바뀌는 경우 - dip 애니메이션 없이
// 곧바로 교체하는 이유는, 이미 비켜선 자리에서 다시 dip까지 겹치면 동작이 너무 많아져 번잡해 보여서다).
const ITEM_SLIDE_MS = 500;   // #char-center.item-reveal-shift의 opacity/transform 트랜지션과 맞춘 값
const ITEM_FADE_MS = 500;    // #item-display.show의 opacity/transform 트랜지션과 맞춘 값
const ITEM_REVEAL_HOLD_MS = 300; // 아이템이 다 나타난 뒤 다음 줄로 넘어가기 전 짧게 두는 여백
let itemRevealHolding = false;

function playItemReveal(line){
  const startedGeneration = queueGeneration;
  itemRevealHolding = true;
  el.dialogueWrap.classList.add('hidden');
  el.charCenter.classList.add('item-reveal-shift');

  function showItemBox(){
    if(queueGeneration !== startedGeneration) return; // playQueue 주석 참고
    playSe(SE.ITEM_REVEAL);
    el.itemDisplayImg.src = line.item || '';
    void el.itemDisplay.offsetWidth; // 연속 재생에도 트랜지션이 처음부터 다시 재생되도록 강제 리플로우
    el.itemDisplay.classList.add('show');
    window.setTimeout(()=>{
      if(queueGeneration !== startedGeneration) return;
      window.setTimeout(()=>{
        if(queueGeneration !== startedGeneration) return;
        itemRevealHolding = false;
        idx++;
        renderCurrent();
      }, ITEM_REVEAL_HOLD_MS);
    }, ITEM_FADE_MS);
  }

  window.setTimeout(()=>{
    if(queueGeneration !== startedGeneration) return;
    if(line.chars){
      // 아이템을 꺼내는 주체가 화면의 그 인물일 때만(요청됨) - 강 희 케이스와 같은 dip 기법(살짝
      // 내려갔다 올라오며 스탠딩 교체)으로 "꺼내는" 동작을 표현한 뒤에야 아이템이 나타난다. line.chars가
      // 없으면(예: 이미 놓여있던 물건, 마법으로 나타나는 경우) 이 단계 없이 곧장 아이템만 나타난다.
      el.charCenter.classList.add('sprite-dip', 'sprite-dip-down');
      window.setTimeout(()=>{
        if(queueGeneration !== startedGeneration) return;
        setChars(line.chars, true);
        el.charCenter.classList.remove('sprite-dip-down');
        window.setTimeout(()=>{
          if(queueGeneration !== startedGeneration) return;
          el.charCenter.classList.remove('sprite-dip');
        }, SPRITE_DIP_MS);
        showItemBox();
      }, SPRITE_DIP_MS);
    } else {
      showItemBox();
    }
  }, ITEM_SLIDE_MS);
}

function playItemHide(line){
  const startedGeneration = queueGeneration;
  playSe(SE.ITEM_HIDE);
  itemRevealHolding = true;
  el.dialogueWrap.classList.add('hidden');
  el.itemDisplay.classList.remove('show');
  window.setTimeout(()=>{
    if(queueGeneration !== startedGeneration) return;
    el.charCenter.classList.remove('item-reveal-shift');
    window.setTimeout(()=>{
      if(queueGeneration !== startedGeneration) return;
      window.setTimeout(()=>{
        if(queueGeneration !== startedGeneration) return;
        itemRevealHolding = false;
        idx++;
        renderCurrent();
      }, ITEM_REVEAL_HOLD_MS);
    }, ITEM_SLIDE_MS);
  }, ITEM_FADE_MS);
}

// 편지 연출(story/story-sub-engine.js의 openLetter/closeLetter를 그대로 이식) - 겉지가 먼저
// 페이드인되고, 속지가 그 뒤에서 위로 올라오며 나타난 뒤(rise), 확대되며(enlarge) 내용이 읽힌다.
// line.envelope/line.paper로 이미지 경로를 넘긴다(에피소드마다 다른 편지지를 쓸 수 있도록 엔진은
// 경로를 모른 채로 둔다 - imageSrcs와 같은 이유).
let letterTransitioning = false;
function openLetter(line){
  // playTimeCard와 같은 이유로 세대를 검사한다(playQueue 주석 참고) - 저장 및 종료로 편지 연출 도중
  // 로비로 나갔다 다른 씬을 시작하면, 지연된 콜백이 그 새 씬을 덮어쓰지 않도록 막는다.
  const startedGeneration = queueGeneration;
  playSe(SE.LETTER_OPEN);
  letterTransitioning = true;
  el.letterEnvelopeImg.src = line.envelope || '';
  el.letterPaperImg.src = line.paper || '';
  el.letterPaperText.textContent = '';
  el.letterPaper.classList.remove('rise', 'enlarge');
  el.letterEnvelope.classList.remove('show');
  el.letterLayer.classList.add('show');
  window.setTimeout(()=>{
    if(queueGeneration !== startedGeneration) return;
    el.letterEnvelope.classList.add('show');
    window.setTimeout(()=>{
      if(queueGeneration !== startedGeneration) return;
      el.letterPaper.classList.add('rise');
      window.setTimeout(()=>{
        if(queueGeneration !== startedGeneration) return;
        el.letterPaper.classList.add('enlarge');
        window.setTimeout(()=>{
          if(queueGeneration !== startedGeneration) return;
          letterTransitioning = false;
          idx++;
          renderCurrent();
        }, 650);
      }, 850);
    }, 550);
  }, 50);
}
function closeLetter(){
  const startedGeneration = queueGeneration;
  playSe(SE.LETTER_CLOSE);
  letterTransitioning = true;
  el.letterPaper.classList.remove('enlarge');
  window.setTimeout(()=>{
    if(queueGeneration !== startedGeneration) return;
    el.letterPaper.classList.remove('rise');
    el.letterEnvelope.classList.remove('show');
    window.setTimeout(()=>{
      if(queueGeneration !== startedGeneration) return;
      el.letterLayer.classList.remove('show');
      el.letterPaperText.textContent = '';
      letterTransitioning = false;
      idx++;
      renderCurrent();
    }, 800);
  }, 650);
}

// 대사창을 아예 숨긴 채(문구 없이) 위 이펙트들만 재생하고, holdMs만큼 저절로 기다렸다가(클릭 없이)
// 다음 줄로 자동 진행한다 - "누군가 정신을 잃는다"처럼 대사로 설명하는 대신 연출만으로 전달하고 싶은
// 순간에 쓴다(story/scenario/ep2_choijaehyeok.js 참고). 서브 스토리 엔진의 playSilentReveal(type:'reveal')과
// 같은 발상이다. advance()는 silentEffectHolding이 켜져 있는 동안 클릭을 무시해서, 대기 중 스트레이
// 클릭이 다음 줄을 건너뛰지 않게 막는다.
let silentEffectHolding = false;
// showBg/clearBg를 지원한다("배경만 1초 떠 있다가 폭발과 함께 다음 배경으로 바뀐다" 같은 연출 -
// story/scenario/ep2_choijaehyeok.js 참고). noBgFade 없이 배경이 바뀌면 fadeToBackground(비동기,
// SCENE_FADE_MS)를 거치는데, 그 함수는 완료 후 자기 스스로 renderCurrent()를 다시 불러 "같은 idx"를
// 재진입시킨다 - 그 재진입 시점엔 currentBgKey가 이미 목표값과 같아져 있으므로 아래 분기가 자연스럽게
// 이펙트 재생 단계로 넘어간다(별도 콜백 배선 없이 재진입만으로 순서가 맞아떨어진다).
function playSilentEffectBeat(line){
  const startedGeneration = queueGeneration;
  el.dialogueWrap.classList.add('hidden');
  if(line.chars) setChars(line.chars, true);

  function playEffectsAndHold(){
    if(queueGeneration !== startedGeneration) return; // playQueue 주석 참고
    // whiteout:false를 여기서 지원하면(예: 과거 도착 씬) 배경 전환과 동시에 흰 화면이 서서히 걷히는
    // 동안 대사창은 계속 숨겨져 있다가, holdMs가 다 지난 뒤에야(=페이드가 실제로 끝난 뒤) 다음 줄의
    // 대사가 나타난다 - whiteout:true와 대사가 같이 있는 줄 전용인 playWhiteoutTextReveal과 달리, 이
    // 줄 자체엔 대사가 없으므로(silentEffect는 항상 무대사 비트) 별도 지연 없이 그냥 여기서 같이 켠다.
    // impact 등 다른 이펙트보다 먼저 걷어야 흰 화면에 가려 안 보이지 않는다(신고받아 수정 - noBgFade가
    // 걸려있으면 트랜지션 없이 즉시 걷는다).
    if('whiteout' in line){ setWhiteout(line.whiteout, Boolean(line.noBgFade)); }
    // explosion은 내부적으로 triggerImpactShake도 함께 재생하므로(triggerExplosion 참고), 같은 줄에
    // impact:true까지 같이 있으면 효과음을 두 개(굉음+지진음) 동시에 새로 재생하게 되는데, 이때 하나가
    // 묻혀 안 들리는 경우가 있었다(신고받아 수정) - explosion이 있으면 그쪽 굉음만 재생해 폭발음이
    // 항상 확실히 들리게 한다.
    if(line.explosion){ triggerExplosion(line.explosion === 'large'); playSe(line.explosion === 'large' ? SE.EXPLOSION_LARGE : SE.EXPLOSION); }
    else if(line.impact){ triggerImpactShake(); playSe(SE.IMPACT); }
    if(line.rumble){ triggerRumbleShake(); playSe(SE.RUMBLE); }
    if(line.glitch){ triggerGlitch(); playSe(SE.GLITCH); }
    if(line.shockReveal){ triggerShockReveal(); playSe(SE.SHOCK_REVEAL); }
    if(line.staggerCollapse){ triggerStaggerCollapse(line.staggerCollapse); }
    if(line.hitFlash){ triggerHitFlash(line.hitFlash); playSe(SE.HIT); }
    if(line.comedyBounce){ triggerComedyBounce(line.comedyBounce); playSe(SE.COMEDY_BOUNCE); }
    if(line.cameraPunch){ triggerCameraPunch(); playSe(SE.CAMERA_PUNCH); }
    if(line.se){ playSe(line.se); }
    silentEffectHolding = true;
    window.setTimeout(()=>{
      if(queueGeneration !== startedGeneration) return; // playQueue 주석 참고
      silentEffectHolding = false;
      idx++;
      renderCurrent();
    }, line.holdMs ?? 800);
  }

  const normalizedShowBg = line.showBg && BG[line.showBg] ? line.showBg : null;
  const requestedBgKey = line.clearBg ? null : normalizedShowBg;
  const hasBgRequest = Boolean(line.clearBg || normalizedShowBg);
  if(hasBgRequest && requestedBgKey !== currentBgKey){
    if(!line.noBgFade){
      silentEffectHolding = true; // fadeToBackground 대기 중에도 advance()가 다음 줄로 새지 않게 막는다
      fadeToBackground(requestedBgKey);
      return;
    }
    setBg(requestedBgKey);
  }
  playEffectsAndHold();
}

let castLayoutDowngradeTimer = null;
let castLayoutAppliedCount = 0; // 마지막으로 실제 화면에 반영된(트랜지션 지연 없이 적용 완료된) 인원 수

// curXKey들은 setChars가 exit를 시작하는 바로 그 순간 이미 null로 바뀌지만(퇴장 애니메이션은 아직
// SPRITE_EXIT_MS 동안 진행 중), left/right/height는 트랜지션 대상이 아니라서(opacity/transform/filter만
// 트랜지션됨) 인원수가 줄어드는 순간 stage 클래스(trio-cast)를 곧바로 떼면 아직 페이드아웃 중인
// 캐릭터들이 다음 인원수의(더 좁은/기본) 위치·크기로 화면에서 순간이동해버린 뒤에야 흐려지는 것처럼
// 보인다("사라질 때 부자연스럽다"의 원인). 인원이 줄 때만 실제 퇴장 트랜지션이 끝나는 시점까지 클래스
// 전환을 미루고, 인원이 늘 때(새 캐릭터 등장)는 기존 인원도 곧바로 새 배치로 자연스럽게 모여들도록 즉시
// 반영한다. center는 'group' 모드일 때만(그룹의 가운데 자리로 쓰일 때만) 인원수에 포함 - 'solo'
// 스포트라이트는 항상 혼자이므로 트리오 배치 대상이 아니다.
function updateCastLayout(){
  const presentCount = [
    curLeftKey,
    curCenterMode === 'group' ? curCenterKey : null,
    curRightKey,
  ].filter(Boolean).length;

  if(castLayoutDowngradeTimer){
    clearTimeout(castLayoutDowngradeTimer);
    castLayoutDowngradeTimer = null;
  }

  const apply = (count) => {
    castLayoutAppliedCount = count;
    el.stage.classList.toggle('trio-cast', count === 3);
  };

  if(presentCount < castLayoutAppliedCount){
    castLayoutDowngradeTimer = window.setTimeout(()=>{
      castLayoutDowngradeTimer = null;
      apply(presentCount);
    }, SPRITE_EXIT_MS);
    return;
  }

  apply(presentCount);
}

// 같은 인물의 스프라이트만 바뀌는 경우(예: 강 희 -> 강 희2, 표정/모습 교체)를 판별하기 위한 그룹핑.
// CAST_SPEAKER_ALIASES(말할 때 음영 처리용)와 별개로, "다른 키지만 같은 사람"만 모아둔다.
const CHAR_IDENTITY_ALIASES = {
  seungyu_true_stand: 'seungyu',
  ganghee_true_stand: 'ganghee',
  senior_sil: 'yeongwoong',
  ganghee2: 'ganghee',
  juheon_sword: 'juheon',
  yeongwoong_armed: 'yeongwoong',
};
function characterIdentity(key){
  if(!key) return null;
  return CHAR_IDENTITY_ALIASES[key] || key;
}

const SPRITE_DIP_MS = 240;   // 같은 인물 표정 교체: 살짝 내려갔다(또는 다시 올라오는) 편도 시간
const SPRITE_EXIT_MS = 500;  // 퇴장 트랜지션(opacity/transform .5s)과 맞춤 - 다 내려간 뒤에야 이미지를 지운다

function playSlotEnter(container, image, key){
  playSlotsEnterBatched([{container, image, key}]);
}

// 등장 트랜지션을 재생하려면 "remove('show') 직후 상태가 브라우저에 실제로 반영된 뒤"에야 add('show')를
// 해야 한다(안 그러면 트랜지션 없이 최종 상태로 바로 점프해버림) - 그래서 강제 리플로우(offsetWidth 읽기)가
// 필요하다. 문제는 이 강제 리플로우 자체가 레이아웃을 동기적으로 다시 계산시키는 무거운 연산이라, 3~4명이
// 동시에 등장/교체될 때(컬렉터 엔딩 카페/재회 씬 등) 슬롯마다 따로따로 호출하면 그만큼 반복돼서 눈에 띄는
// 렉의 원인이 됐다. 여러 슬롯을 한 번에 준비해두고 강제 리플로우를 딱 1회만 실행한 뒤 한꺼번에 'show'를
// 붙이면, 슬롯이 몇 개든 리플로우 비용은 항상 1번으로 끝난다.
function playSlotsEnterBatched(entries){
  entries.forEach(({container, image, key}) => {
    container.classList.remove('dim', 'mystery-silhouette', 'mystery-revealing', 'stagger-collapse', 'tv-static');
    image.src = CHAR_IMG[key];
    container.classList.remove('show');
  });
  if(entries.length > 0) void el.stage.offsetWidth; // 강제 리플로우(전체 슬롯 통틀어 딱 1회)
  entries.forEach(({container}) => container.classList.add('show'));
}

function playSlotExit(container, image){
  container.classList.remove('show');
  window.setTimeout(()=>{
    // 그 사이에 다른 인물이 이미 등장해버렸다면(show가 다시 붙었다면) 그 이미지를 건드리지 않는다.
    if(!container.classList.contains('show')) image.removeAttribute('src');
  }, SPRITE_EXIT_MS);
}

function setCharacterSlot(container, image, key, instant, pendingEnters){
  if(key){
    // stagger-collapse(쓰러짐)가 걸려 있으면 "이미 같은 모습으로 나와 있음"이 아니다 - 그 애니메이션은
    // forwards로 끝 프레임(회전+투명도 0)에 멈춰 있는 상태라, 여기서 그냥 return해버리면 캐릭터가 계속
    // 쓰러진 채 안 보이거나(다음 씬에서 같은 인물을 다시 세울 때), 이후 다른 stagger-collapse가 다시
    // 걸릴 때 강제 리플로우로 0% 키프레임(직립+불투명)까지 순간이동한 뒤 곧장 또 쓰러지는 것처럼
    // 보이는 버그가 있었다(신고받아 수정) - 아래로 흘려보내 정상적인 등장 연출(stagger-collapse 제거
    // 포함)을 다시 타게 한다.
    if(container.classList.contains('show') && !container.classList.contains('stagger-collapse') && image.getAttribute('src') === CHAR_IMG[key]){
      return; // 이미 같은 모습으로 나와 있음 - dip/교체 연출에서 방금 막 처리된 경우
    }
    if(instant){
      container.classList.remove('dim', 'mystery-silhouette', 'mystery-revealing', 'stagger-collapse', 'tv-static');
      image.src = CHAR_IMG[key];
      container.classList.add('show');
      return;
    }
    // 여기서 곧바로 재생하지 않고 pendingEnters에 모아둔다 - setChars가 같은 호출 안의 다른 슬롯들과
    // 함께 강제 리플로우를 1번만 실행하도록(playSlotsEnterBatched 참고, 3~4명 동시 등장 렉 방지).
    if(pendingEnters){
      pendingEnters.push({container, image, key});
    } else {
      playSlotEnter(container, image, key);
    }
  } else if(container.classList.contains('show')){
    if(instant){
      container.classList.remove('show', 'dim', 'mystery-silhouette', 'mystery-revealing', 'stagger-collapse', 'tv-static');
      image.removeAttribute('src');
      return;
    }
    playSlotExit(container, image);
  } else {
    container.classList.remove(
      'show',
      'dim',
      'mystery-silhouette',
      'mystery-revealing',
      'stagger-collapse',
      'tv-static'
    );
    image.removeAttribute('src');
  }
}

const CHAR_SLOT_DEFS = [
  {name:'left', container:()=>el.charLeft, image:()=>el.charLeftImg, get:()=>curLeftKey, set:(k)=>{curLeftKey=k;}},
  {name:'center', container:()=>el.charCenter, image:()=>el.charCenterImg, get:()=>curCenterKey, set:(k)=>{curCenterKey=k;}},
  {name:'right', container:()=>el.charRight, image:()=>el.charRightImg, get:()=>curRightKey, set:(k)=>{curRightKey=k;}},
];
function charSlotDef(name){ return CHAR_SLOT_DEFS.find(d => d.name === name); }

// 같은 인물이 center<->left/right 사이를 실제로 "옮겨가는" 경우만 감지해서 옆으로 미끄러지는 연출을
// 재생한다(그 외의 모든 등장/퇴장은 다른 캐릭터들과 통일된 세로 fade+rise를 쓴다 - #char-center 기본
// CSS 참고). "이동"의 정의: 한쪽 자리(from)에 있던 인물이 사라지고(newKey=null), 동시에 다른 자리
// (to)에 바로 그 인물이 새로 나타난다(같은 characterIdentity, 그 자리는 원래 비어있었음). center<->left,
// center<->right 두 조합만 지원한다(left<->right 직행은 현재 어떤 씬에서도 쓰지 않는다).
function tryPlaySlotShift(chars){
  const pairs = [['center','left'], ['center','right']];
  let shift = null;
  for(const [a, b] of pairs){
    const defA = charSlotDef(a), defB = charSlotDef(b);
    const aOld = defA.get(), bOld = defB.get();
    const aNew = a in chars ? chars[a] : aOld;
    const bNew = b in chars ? chars[b] : bOld;
    if(aOld && defA.container().classList.contains('show') && aNew === null &&
       bNew && bNew !== bOld && characterIdentity(bNew) === characterIdentity(aOld)){
      shift = {from:a, to:b, defFrom:defA, defTo:defB, key:bNew};
      break;
    }
    if(bOld && defB.container().classList.contains('show') && bNew === null &&
       aNew && aNew !== aOld && characterIdentity(aNew) === characterIdentity(bOld)){
      shift = {from:b, to:a, defFrom:defB, defTo:defA, key:aNew};
      break;
    }
  }
  if(!shift) return false;

  // 슬롯 순서(left < center < right)로 "to가 from보다 화면 오른쪽인지"를 판정해 이동 방향을 정한다.
  const order = {left:0, center:1, right:2};
  const dirOut = order[shift.to] > order[shift.from] ? 'right' : 'left'; // from이 사라지는 방향
  const dirIn = dirOut === 'right' ? 'left' : 'right'; // to가 나타나는 시작 방향(from 쪽에서 이어받음)

  el.dialogueWrap.classList.add('hidden');

  // center가 이동의 도착지면 항상 솔로(그룹의 일원이 아니라 그 인물 혼자 옮겨온 것) - 반대로 center가
  // 출발지면 그 자리는 어차피 비므로 모드는 다음 setChars 갱신 때 새로 정해진다.
  if(shift.to === 'center'){
    curCenterMode = 'solo';
    el.charCenter.classList.remove('mode-group');
  }

  const fromContainer = shift.defFrom.container(), fromImage = shift.defFrom.image();
  const toContainer = shift.defTo.container(), toImage = shift.defTo.image();

  fromContainer.classList.remove('show');
  fromContainer.classList.add(dirOut === 'right' ? 'shift-offset-right' : 'shift-offset-left');

  toContainer.classList.remove('show', 'shift-offset-left', 'shift-offset-right');
  toImage.src = CHAR_IMG[shift.key];
  toContainer.classList.add(dirIn === 'right' ? 'shift-offset-right' : 'shift-offset-left');
  void el.stage.offsetWidth; // 강제 리플로우 - to의 시작 오프셋을 실제로 커밋한 뒤에야 show로 넘어가야 함
  toContainer.classList.remove(dirIn === 'right' ? 'shift-offset-right' : 'shift-offset-left');
  toContainer.classList.add('show');

  shift.defFrom.set(null);
  shift.defTo.set(shift.key);
  updateCastLayout();

  window.setTimeout(()=>{
    fromContainer.classList.remove('shift-offset-right', 'shift-offset-left');
    fromImage.removeAttribute('src');
    renderCurrent();
  }, SPRITE_EXIT_MS);

  return true;
}

// center에 혼자 있던 인물 쪽으로 새 인물이 하나 더 등장해서 "둘이 되는" 순간 전용 연출. 인물이 둘일
// 때는 기본적으로 left+right에 대칭으로 배치돼야 한다는 원칙(신고받아 확정 - 예전엔 center+옆칸으로
// 둬서 한쪽만 화면 정중앙을 차지하는 비대칭 구도가 됐었다)에 따라, center의 기존 인물은 결국
// 옆(left/right)으로 옮겨가고 새 인물은 반대쪽 빈자리에 등장하며 center 자체는 완전히 빈다(그룹
// 모드로 전환되지 않는다). "새로 합류하는 자리(left/right)에 나타나는 인물이 사실 방금까지 center에
// 있던 바로 그 인물"일 때만 성립하므로, tryPlaySoloToGroupTransition보다 먼저 검사해서 이 경우를
// 가로챈다.
//
// 실제로 화면을 가로질러 미끄러지는 슬라이드여야 한다(신고받아 두 번 수정 - 처음엔 opacity가 0인
// .shift-offset-* 클래스로 살짝 어긋난 위치에서 사라졌다 나타나는 것에 가까웠고, 그다음엔 아예 세로
// 퇴장/등장(가라앉음/떠오름)으로 바꿨는데 둘 다 "슬라이드"가 아니라 "교체"처럼 보인다는 피드백을
// 받았다). center 컨테이너와 도착 슬롯의 실제 화면 좌표 차이(px)를 getBoundingClientRect()로 구해서,
// center에 있던 스탠딩 이미지 자체를 그 거리만큼 opacity 유지한 채(사라지지 않고) 옆으로 미끄러뜨린
// 뒤, 도착한 순간 실제 슬롯으로 매끄럽게 넘겨받는다.
function tryPlayCenterSlideToSideTransition(chars){
  const centerDef = charSlotDef('center');
  const centerOld = centerDef.get();
  if(!centerOld || !centerDef.container().classList.contains('show')) return false;

  let landingName = null;
  for(const name of ['right', 'left']){
    const def = charSlotDef(name);
    if(name in chars && chars[name] && characterIdentity(chars[name]) === characterIdentity(centerOld) &&
       !(def.get() && def.container().classList.contains('show'))){
      landingName = name;
      break;
    }
  }
  if(!landingName) return false;

  const enteringName = landingName === 'right' ? 'left' : 'right';
  if(!(enteringName in chars) || !chars[enteringName]) return false;
  const enteringDef = charSlotDef(enteringName);
  if(enteringDef.get() && enteringDef.container().classList.contains('show')) return false;
  if(characterIdentity(chars[enteringName]) === characterIdentity(centerOld)) return false;

  el.dialogueWrap.classList.add('hidden');

  const landingDef = charSlotDef(landingName);
  const fromContainer = centerDef.container(), fromImage = centerDef.image();
  const landingContainer = landingDef.container(), landingImage = landingDef.image();
  const movingKey = centerOld;
  const newComerKey = chars[enteringName];

  const fromRect = fromContainer.getBoundingClientRect();
  const landingRect = landingContainer.getBoundingClientRect();
  const deltaX = (landingRect.left + landingRect.width / 2) - (fromRect.left + fromRect.width / 2);

  fromContainer.style.zIndex = '5';
  void fromContainer.offsetWidth; // 강제 리플로우 - 지금 transform(정지 상태)을 먼저 커밋한다
  fromContainer.style.transition = `transform ${SPRITE_EXIT_MS}ms ease`;
  fromContainer.style.transform = `translate(calc(-50% + ${deltaX}px), 0)`;

  window.setTimeout(()=>{
    // 슬라이드가 끝난 지점이 곧 landing 슬롯의 실제 위치이므로, from을 감추는 것과 동시에 landing을
    // 트랜지션 없이 그 모습 그대로 켜면 자연스럽게 이어져 보인다.
    fromContainer.classList.remove('show');
    fromContainer.style.transition = '';
    fromContainer.style.transform = '';
    fromContainer.style.zIndex = '';
    fromImage.removeAttribute('src');
    centerDef.set(null);

    landingDef.set(movingKey);
    landingContainer.style.transition = 'none';
    landingImage.src = CHAR_IMG[movingKey];
    landingContainer.classList.add('show');
    void landingContainer.offsetWidth;
    landingContainer.style.transition = '';

    const pendingEnters = [];
    const enteringDef2 = charSlotDef(enteringName);
    enteringDef2.set(newComerKey);
    setCharacterSlot(enteringDef2.container(), enteringDef2.image(), newComerKey, false, pendingEnters);
    if(pendingEnters.length > 0) playSlotsEnterBatched(pendingEnters);
    updateCastLayout();
    renderCurrent();
  }, SPRITE_EXIT_MS);

  return true;
}

// center에 있던 인물이 "다른" 인물로 바뀌면서 동시에 left/right 중 하나 이상이 새로 채워지는 경우
// (=혼자 있던 스포트라이트가 그룹으로 전환되는 순간)만 특별 취급한다. center의 기존 인물이 완전히
// 사라지는 연출을 먼저 보여준 뒤에야 그룹 셋이 함께 등장해야 한다는 요구사항 때문에, 이 경우엔
// 좌/우와 center를 한 박자 어긋나게(center 퇴장 -> 대기 -> 셋 동시 등장) 처리한다. 반대 방향(그룹이
// 흩어지고 center에 다른 인물이 혼자 들어오는 경우)은 대칭되는 tryPlayGroupToSoloTransition(바로
// 아래)이 똑같은 방식(퇴장 먼저, 그 다음 등장)으로 처리한다 - 아래 leftJoining/rightJoining 조건이
// "누군가 새로 합류하는" 이 함수만의 경우를 가른다.
function tryPlaySoloToGroupTransition(chars){
  const leftDef = charSlotDef('left'), centerDef = charSlotDef('center'), rightDef = charSlotDef('right');

  if(!('center' in chars) || !chars.center) return false;
  const centerOld = centerDef.get();
  if(!centerOld || !centerDef.container().classList.contains('show')) return false;
  if(characterIdentity(chars.center) === characterIdentity(centerOld)) return false;

  const isJoining = (def, key) => key && !(def.get() && def.container().classList.contains('show'));
  const leftJoining = 'left' in chars && isJoining(leftDef, chars.left);
  const rightJoining = 'right' in chars && isJoining(rightDef, chars.right);
  if(!leftJoining && !rightJoining) return false;

  el.dialogueWrap.classList.add('hidden');
  centerDef.container().classList.remove('show');

  window.setTimeout(()=>{
    const pendingEnters = [];
    if('left' in chars){ leftDef.set(chars.left); setCharacterSlot(leftDef.container(), leftDef.image(), chars.left, false, pendingEnters); }
    curCenterMode = (chars.left || chars.right) ? 'group' : 'solo';
    el.charCenter.classList.toggle('mode-group', curCenterMode === 'group');
    centerDef.set(chars.center);
    setCharacterSlot(centerDef.container(), centerDef.image(), chars.center, false, pendingEnters);
    if('right' in chars){ rightDef.set(chars.right); setCharacterSlot(rightDef.container(), rightDef.image(), chars.right, false, pendingEnters); }
    if(pendingEnters.length > 0) playSlotsEnterBatched(pendingEnters);
    updateCastLayout();
    renderCurrent();
  }, SPRITE_EXIT_MS);

  return true;
}

// tryPlaySoloToGroupTransition과 정확히 대칭되는 반대 방향 - 그룹(트리오)에서 누군가 완전히 떠나며
// center에 다른 인물이 혼자 등장하는 경우(예: 컬렉터 엔딩에서 영웅의 대사가 시작되는 순간)다. 예전엔
// 이 방향만 "셋이 동시에 사라지고 center가 즉시 교체"되도록 만들었는데, 그러면 center의 옛 인물이
// 화면에 사라지는 모습 자체가 안 보이고(같은 리플로우 트릭 안에서 이미지가 바로 바뀜) 새 인물이
// "뙇" 하고 나타나는 것처럼 보였다 - 다른 모든 캐릭터의 등장(완전한 퇴장 -> 대기 -> 등장)과 느낌이
// 달라서, 이제는 반대 방향과 동일하게 그룹 전체가 먼저 완전히 퇴장한 뒤에야 center의 새 인물이
// 등장하도록 통일한다(그만큼 시간은 더 걸리지만, 대사창은 그동안 계속 숨겨져 있다).
function tryPlayGroupToSoloTransition(chars){
  const leftDef = charSlotDef('left'), centerDef = charSlotDef('center'), rightDef = charSlotDef('right');

  if(!('center' in chars) || !chars.center) return false;
  const centerOld = centerDef.get();
  if(centerOld && characterIdentity(chars.center) === characterIdentity(centerOld)) return false;

  const isLeaving = (def, key) => key === null && def.get() && def.container().classList.contains('show');
  const leftLeaving = 'left' in chars && isLeaving(leftDef, chars.left);
  const rightLeaving = 'right' in chars && isLeaving(rightDef, chars.right);
  if(!leftLeaving && !rightLeaving) return false;

  el.dialogueWrap.classList.add('hidden');

  // 왼쪽/오른쪽은 평소와 똑같은 퇴장 경로(setCharacterSlot의 populated->null, playSlotExit)를 그대로
  // 쓰고, center에 이미 다른 인물이 있었다면 "교체"가 아니라 그것도 똑같이 완전히 퇴장시킨다.
  if('left' in chars) { leftDef.set(null); setCharacterSlot(leftDef.container(), leftDef.image(), null, false); }
  if('right' in chars) { rightDef.set(null); setCharacterSlot(rightDef.container(), rightDef.image(), null, false); }
  if(centerOld && centerDef.container().classList.contains('show')){
    centerDef.set(null);
    setCharacterSlot(centerDef.container(), centerDef.image(), null, false);
  }

  window.setTimeout(()=>{
    curCenterMode = 'solo';
    el.charCenter.classList.remove('mode-group');
    centerDef.set(chars.center);
    setCharacterSlot(centerDef.container(), centerDef.image(), chars.center, false);
    updateCastLayout();
    renderCurrent();
  }, SPRITE_EXIT_MS);

  return true;
}

// line.chars 안에 "이미 나와 있던 자리"의 값이 바뀌는 슬롯이 있으면(단순 신규 등장/완전 퇴장이 아니라),
// 같은 인물의 표정 교체는 살짝 내려갔다 올라오는 연출로, 다른 인물로의 교체는 기존 인물이 완전히
// 내려간 뒤 새 인물이 올라오는 연출로 먼저 재생한다. 이 연출이 진행되는 동안은 대사창을 잠깐 숨기고,
// 끝나면 renderCurrent()를 다시 불러서(같은 idx) 이어서 진행한다. 처리할 게 없으면 false를 반환해서
// 호출부가 곧바로 setChars로 넘어가게 한다(등장/퇴장만 있는 보통의 경우).
function tryPlayCharacterHandoff(chars){
  // center는 그룹(트리오)의 가운데 자리와 "혼자 등장" 스포트라이트를 겸하는 슬롯이라, left/right가
  // 같은 chars 갱신 안에서 함께 바뀐다는 건 "그룹<->솔로 전체가 한꺼번에 전환되는 중"이라는 뜻이다.
  // 이때 center의 인물 교체까지 같은 자리에서 페이드 스왑(handoff)으로 처리해버리면 좌우 캐릭터의
  // 퇴장/등장과 타이밍이 어긋난다(handoff는 별도의 renderCurrent 재귀 패스로 좌우 처리를 한 박자 뒤로
  // 미룬다) - "셋이 동시에 사라지고 혼자 등장"이 아니라 두 박자로 나뉘어 보이게 된다. 그래서 이 경우엔
  // center도 일반 setChars 경로로 넘겨서 좌/우 퇴장·등장과 같은 타이밍에 한 번에 처리되게 한다(같은
  // 자리 안에서의 인물 교체 자체는 playSlotsEnterBatched의 remove->reflow->add 트릭으로 여전히
  // 매끄럽게 전환된다 - setChars/setCharacterSlot 참고). left/right 없이 center만 바뀌는 경우(예:
  // 솔로 상태에서의 표정 교체)는 지금처럼 dip/handoff로 부드럽게 처리한다.
  const centerEligible = !('left' in chars || 'right' in chars);

  const changing = CHAR_SLOT_DEFS
    .filter(def => def.name in chars)
    .filter(def => def.name !== 'center' || centerEligible)
    .map(def => ({def, newKey:chars[def.name], curKey:def.get(), container:def.container(), image:def.image()}))
    .filter(s => s.newKey && s.newKey !== s.curKey && s.curKey && s.container.classList.contains('show'));

  const dipSlots = changing.filter(s => characterIdentity(s.newKey) === characterIdentity(s.curKey));
  const handoffSlots = changing.filter(s => characterIdentity(s.newKey) !== characterIdentity(s.curKey));

  if(dipSlots.length === 0 && handoffSlots.length === 0) return false;

  el.dialogueWrap.classList.add('hidden');

  dipSlots.forEach(s => s.container.classList.add('sprite-dip', 'sprite-dip-down'));
  handoffSlots.forEach(s => s.container.classList.remove('show'));

  const waitMs = handoffSlots.length > 0 ? SPRITE_EXIT_MS : SPRITE_DIP_MS;

  window.setTimeout(()=>{
    // 같은 인물의 스탠딩만 바뀌는 순간(요청됨 - 주헌이 칼을 드는 순간, 강 희가 ganghee2로 바뀌는
    // 순간 등)에 딸깍 하고 장비가 바뀌는 듯한 효과음을 붙인다. dip 슬롯이 실제로 이미지를 갈아끼우는
    // 바로 이 시점이 "스프라이트가 변하는" 순간이다.
    if(dipSlots.length > 0){ playSe(SE.SPRITE_DIP); }
    dipSlots.forEach(s => {
      s.image.src = CHAR_IMG[s.newKey];
      s.container.classList.remove('sprite-dip-down'); // 같은 sprite-dip 트랜지션 속도를 유지한 채 다시 올라옴
      s.def.set(s.newKey);
    });
    playSlotsEnterBatched(handoffSlots.map(s => ({container:s.container, image:s.image, key:s.newKey})));
    handoffSlots.forEach(s => s.def.set(s.newKey));
    if(dipSlots.length > 0){
      window.setTimeout(()=>{
        dipSlots.forEach(s => s.container.classList.remove('sprite-dip'));
      }, SPRITE_DIP_MS);
    }
    renderCurrent();
  }, waitMs);

  return true;
}

function setChars(chars, instant){
  if(!chars) return;

  // 새로 등장하는 슬롯들은 여기 모아뒀다가 마지막에 한꺼번에 처리한다(playSlotsEnterBatched) -
  // 3~4명이 동시에 등장하는 씬(컬렉터 엔딩 카페/재회 등)에서 슬롯마다 강제 리플로우를 따로따로
  // 하면 그게 그대로 렉으로 느껴졌다.
  const pendingEnters = [];

  if('left' in chars){
    curLeftKey = chars.left;
    setCharacterSlot(el.charLeft, el.charLeftImg, chars.left, instant, pendingEnters);
  }
  if('center' in chars){
    // center는 그룹의 가운데 자리와 솔로 스포트라이트를 겸한다 - 같은 갱신에 left/right가 함께
    // 채워지면 그룹의 일원(세로 fade+rise), center만 있으면 혼자 등장(가로 slide)이다. .show를 붙이기
    // 전에 모드 클래스를 먼저 맞춰둬야 등장 트랜지션이 올바른 방향으로 재생된다(story-relationship.css
    // #char-center.mode-group 참고). 퇴장(chars.center가 null)일 때는 모드를 새로 판단할 근거가 없으니
    // 마지막으로 등장했을 때의 모드를 그대로 유지한 채 퇴장한다.
    if(chars.center){
      curCenterMode = (chars.left || chars.right) ? 'group' : 'solo';
      el.charCenter.classList.toggle('mode-group', curCenterMode === 'group');
    }
    curCenterKey = chars.center;
    setCharacterSlot(el.charCenter, el.charCenterImg, chars.center, instant, pendingEnters);
  }
  if('right' in chars){
    curRightKey = chars.right;
    setCharacterSlot(el.charRight, el.charRightImg, chars.right, instant, pendingEnters);
  }

  if(pendingEnters.length > 0) playSlotsEnterBatched(pendingEnters);

  updateCastLayout();
}

function clearAllCharacterDim(){
  [
    el.charLeft,
    el.charCenter,
    el.charRight,
  ].forEach(slot => slot.classList.remove('dim'));
}

function hideAllCharacters(){
  setChars({
    left:null,
    center:null,
    right:null,
  });
}

const MYSTERY_REVEAL_MS = 1250;

function applyMysterySilhouetteImmediately(side){
  const target = side === 'left' ? el.charLeft : side === 'center' ? el.charCenter : el.charRight;

  // 화면에 그려지기 전에 검은 실루엣 상태를 확정한다.
  target.style.transition = 'none';
  target.classList.remove('mystery-revealing');
  target.classList.add('mystery-silhouette');

  // offsetWidth 강제 리플로우만으로는 filter처럼 paint 단계에서 처리되는 속성엔 불충분해서
  // (레이아웃은 즉시 갱신돼도 filter 트랜지션이 여전히 애니메이션되는 경우가 있었다),
  // 실제로 한 프레임이 "검은 상태 그대로" 그려지고 난 뒤(rAF 2번)에야 transition을 되살린다.
  // 이래야 다음 씬으로 전환되기 전에 이미 완전히 검은 채로 화면에 나타난다.
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      target.style.transition = '';
    });
  });
}

function revealMysteryCharacter(side){
  if(mysteryRevealTransitioning) return;

  const startedGeneration = queueGeneration;
  const target = side === 'left' ? el.charLeft : side === 'center' ? el.charCenter : el.charRight;
  mysteryRevealTransitioning = true;
  playSe(SE.REVEAL_CHARACTER);

  // 플레이어의 질문 대사를 지운 뒤 윤대웅만 화면에 남긴다.
  el.dialogueWrap.classList.add('hidden');
  el.hint.style.visibility = 'hidden';
  target.classList.remove('dim');

  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      target.classList.add('mystery-revealing');
    });
  });

  window.setTimeout(()=>{
    if(queueGeneration !== startedGeneration) return; // playQueue 주석 참고
    target.classList.remove('mystery-silhouette', 'mystery-revealing');
    mysteryRevealTransitioning = false;
    idx++;
    renderCurrent();
  }, MYSTERY_REVEAL_MS);
}

const CAST_SPEAKER_ALIASES = {
  seungyu_true_stand:'seungyu',
  ganghee_true_stand:'ganghee',
  senior_sil:'yeongwoong',
  // ganghee2(같은 인물의 표정 교체 스탠딩)가 CHAR_IDENTITY_ALIASES에는 있는데 여기 빠져 있어서,
  // ganghee2로 스탠딩이 바뀐 뒤 그 인물(강 희, speaker.key==='ganghee')이 말해도 "다른 사람"으로
  // 오판해 화면이 어둡게(dim) 처리되는 버그가 있었다(신고받아 수정) - juheon_sword(칼을 든 송주헌
  // 스탠딩)도 같은 이유로 처음부터 함께 등록한다(요청됨).
  ganghee2:'ganghee',
  juheon_sword:'juheon',
  yeongwoong_armed:'yeongwoong',
};

function normalizeCastSpeakerKey(key){
  return CAST_SPEAKER_ALIASES[key] || key;
}

function applySpeakingDim(speakerKey){
  // 나레이션과 독백은 직전에 지정된 연출용 음영을 유지한다.
  if(!speakerKey) return;

  const slots = [
    {key:curLeftKey, element:el.charLeft},
    {key:curCenterKey, element:el.charCenter},
    {key:curRightKey, element:el.charRight},
  ].filter(slot => slot.key);

  if(slots.length <= 1){
    clearAllCharacterDim();
    return;
  }

  slots.forEach(slot => {
    const normalizedKey = normalizeCastSpeakerKey(slot.key);
    slot.element.classList.toggle('dim', normalizedKey !== speakerKey);
  });
}

// 원본의 #affection-debug 개발용 오버레이는 제거했으므로, 씬 흐름 곳곳의 updateDebug() 호출은
// 그대로 두되(로직 변경 리스크를 줄이기 위해 씬 데이터/분기 함수는 최대한 원본 그대로 유지) 아무 것도 하지 않는다.
function updateDebug(){}

const SCENE_FADE_MS = 650;

function fadeToBackground(nextBgKey){
  if(!el.sceneFade || backgroundTransitioning){
    setBg(nextBgKey);
    renderCurrent();
    return;
  }

  const startedGeneration = queueGeneration;
  backgroundTransitioning = true;
  typing = true;
  el.sceneFade.classList.add('active');

  window.setTimeout(()=>{
    if(queueGeneration !== startedGeneration) return; // playQueue 주석 참고
    setBg(nextBgKey);

    // 검은 화면 뒤에서 새 배경과 현재 대사를 먼저 준비한 뒤,
    // 오버레이를 걷어내며 페이드인한다.
    renderCurrent();

    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        if(queueGeneration !== startedGeneration) return;
        el.sceneFade.classList.remove('active');
        window.setTimeout(()=>{
          if(queueGeneration !== startedGeneration) return;
          backgroundTransitioning = false;
        }, SCENE_FADE_MS);
      });
    });
  }, SCENE_FADE_MS);
}

const TIME_CARD_FADE_MS = 650;
const TIME_CARD_HOLD_MS = 1100;

function playTimeCard(line){
  if(timeCardTransitioning) return;

  // 이 타임카드가 예약하는 모든 지연된(setTimeout) 단계는 실행되는 시점에 이 세대가 여전히 "지금
  // 재생 중인 큐"인지 확인한다 - 그 사이 저장 및 종료 등으로 다른 playQueue()가 시작됐다면(세대가
  // 바뀌었다면) 아무 것도 하지 않고 멈춘다(playQueue 주석 참고 - 새 큐를 엉뚱하게 덮어쓰는 것을 막는다).
  const startedGeneration = queueGeneration;
  timeCardTransitioning = true;
  backgroundTransitioning = true;
  typing = false;
  clearInterval(typeTimer);
  hideAllCharacters();

  // renderCurrent()는 timecard 타입을 만나면 곧바로 여기로 넘기고 return하기 때문에, 거기 있는
  // line.stopBgm/line.bgm 처리를 거치지 않는다 - 그래서 여기서 따로 처리해줘야 한다(안 그러면 타임카드
  // 줄에 stopBgm:true/bgm:'...'을 붙여도 조용히 무시됐다).
  if(line.stopBgm){
    playBgm(null);
  } else if(line.bgm){
    playBgm(line.bgm);
  }

  el.dialogueWrap.classList.add('hidden');
  el.hint.style.visibility = 'hidden';
  el.sceneFade.classList.add('active');

  window.setTimeout(()=>{
    if(queueGeneration !== startedGeneration) return;
    setBg(null);
    el.timeCardText.textContent = withPlayerName(line.text) || '10년 후...';
    el.timeCard.classList.add('show');
    el.timeCard.setAttribute('aria-hidden', 'false');

    window.setTimeout(()=>{
      if(queueGeneration !== startedGeneration) return;
      el.timeCard.classList.remove('show');

      window.setTimeout(()=>{
        if(queueGeneration !== startedGeneration) return;
        el.timeCard.setAttribute('aria-hidden', 'true');
        setBg(line.nextBg || null);

        requestAnimationFrame(()=>{
          requestAnimationFrame(()=>{
            if(queueGeneration !== startedGeneration) return;
            el.sceneFade.classList.remove('active');

            window.setTimeout(()=>{
              if(queueGeneration !== startedGeneration) return;
              backgroundTransitioning = false;
              timeCardTransitioning = false;
              idx++;
              renderCurrent();
            }, SCENE_FADE_MS);
          });
        });
      }, TIME_CARD_FADE_MS);
    }, TIME_CARD_HOLD_MS);
  }, SCENE_FADE_MS);
}

// 타임카드/편지/실루엣 리빌/무성 이펙트처럼 idx++ 없이도 화면이 진행되는 "지연된 콜백"들이
// window.setTimeout으로 몇 단계씩 이어지는 동안, 그 큐 자체가 다른 playQueue() 호출로 완전히
// 바뀌어버릴 수 있다(예: 정상적인 진행이라면 advance()의 xxxTransitioning 가드가 막아주지만, 메뉴의
// "저장 및 종료"는 currentSceneKey만 저장하고 곧장 로비로 돌아가버려서 그 가드를 거치지 않는다 -
// 로비에서 다시 이 에피소드로 들어오면 그 사이 새 playQueue()가 시작되는데, 오래된 콜백이 그제서야
// 발동하면 지금 활성화된(완전히 다른) 씬의 idx/배경을 엉뚱하게 덮어써버린다). 그래서 각 콜백은 자신이
// 예약될 당시의 세대(generation)를 기억해뒀다가, 실제로 실행되는 시점에 지금 세대와 다르면(그 사이
// 새 큐가 시작됐다면) 아무것도 하지 않고 조용히 멈춘다.
let queueGeneration = 0;

function playQueue(newQueue, endCallback){
  queue = newQueue;
  idx = 0;
  queueGeneration++;
  // 이전 큐가 남겨둔 진행-중 가드는 새 큐에는 의미가 없다 - 리셋하지 않으면(예: 저장 및 종료로
  // 타임카드 도중 로비로 나갔다가 다시 들어온 경우) advance()가 새 큐에서도 계속 막혀버린다.
  // 그 이전 큐의 지연된 콜백 자체는 각자 queueGeneration을 검사해 스스로 멈춘다(아래 각 함수 참고).
  timeCardTransitioning = false;
  backgroundTransitioning = false;
  mysteryRevealTransitioning = false;
  silentEffectHolding = false;
  letterTransitioning = false;
  whiteoutRevealHolding = false;
  staggerCollapseHolding = false;
  itemRevealHolding = false;
  // itemReveal/itemHide는 항상 같은 큐 배열 안에서 쌍으로 끝나야 정상이지만, "저장 및 종료"로 아이템이
  // 떠 있는 도중 나갔다가 새 플레이를 시작하는 등 그 짝이 재생되지 못하고 큐가 통째로 버려지는 경우
  // 위의 불리언 플래그만 리셋해서는 부족하다 - 실제 DOM(#item-display.show, 캐릭터가 비켜선
  // #char-center.item-reveal-shift)이 그대로 남아, 새 큐(심지어 새 플레이의 첫 씬)에서도 아이템이
  // 화면 가운데에 계속 떠 있는 것처럼 보이는 버그가 있었다. 새 큐가 시작될 때마다 무조건 정리한다.
  el.itemDisplay.classList.remove('show');
  el.charCenter.classList.remove('item-reveal-shift');
  onQueueEnd = endCallback;
  juheonEndingVisualActive = false;
  // dialogueHistory는 여기서 비우지 않는다 - playQueue는 선택지 분기 등 훨씬 잦은 단위로도 호출되는데,
  // 매번 비우면 선택지를 고를 때마다 그 전까지의 대화 기록이 사라져버린다(startGame/resumeGame 참고 -
  // 실제 새 플레이 세션이 시작될 때만 비운다).
  renderCurrent();
}

function renderCurrent(){
  if(idx >= queue.length){
    const cb = onQueueEnd;
    onQueueEnd = null;
    if(cb) cb();
    return;
  }
  const line = queue[idx];

  if(line.type === 'timecard'){
    playTimeCard(line);
    return;
  }
  if(line.type === 'silentEffect'){
    playSilentEffectBeat(line);
    return;
  }
  if(line.type === 'letterOpen'){
    if(line.chars) setChars(line.chars, true);
    openLetter(line);
    return;
  }
  if(line.type === 'letterClose'){
    closeLetter();
    return;
  }
  if(line.type === 'letter'){
    el.dialogueWrap.classList.add('hidden');
    typeText(withPlayerName(line.text), false, el.letterPaperText);
    return;
  }
  if(line.type === 'itemReveal'){
    playItemReveal(line);
    return;
  }
  if(line.type === 'itemHide'){
    playItemHide(line);
    return;
  }
  // whiteout:true인 줄은 화면이 다 하얘질 때까지 대사창을 숨겼다가, 다 하얘진 뒤에야 그 위로
  // 대사가 나타나야 한다(요청됨 - 안 그러면 #scene-fade(z-index:999)가 #dialogue-wrap(z-index:5)보다
  // 위에 있어서 타이핑 중인 글자가 하얀 화면에 점점 가려지다가 결국 완전히 안 보이게 된다).
  // whiteoutRevealedAtIdx로 "이 (세대,idx)는 이미 지연을 거쳤다"를 기억해뒀다가, 지연 후 같은 줄을
  // 다시 렌더링할 때는 이 분기를 건너뛰고 아래 평소 처리(타이핑 등)로 자연스럽게 이어간다.
  if(line.whiteout === true && !(whiteoutRevealedGeneration === queueGeneration && whiteoutRevealedIdx === idx)){
    playWhiteoutTextReveal(line, idx);
    return;
  }
  if(line.staggerCollapse && !(staggerCollapseRevealedGeneration === queueGeneration && staggerCollapseRevealedIdx === idx)){
    playStaggerCollapseReveal(line, idx);
    return;
  }

  if(line.stopBgm){
    playBgm(null);
  } else if(line.bgm){
    playBgm(line.bgm);
  }

  const hasBackgroundRequest = Boolean(line.clearBg || line.showBg);
  // setBg()는 BG에 없는 키를 항상 null로 정규화한다(설정한 배경이 아직 그려지지 않은 경우 등 -
  // "빈 배경 자동 폴백" 패턴, EP2_CG_GALLERY_ITEMS의 아직 없는 CG와 같은 방식). 여기서도 같은 규칙으로
  // 정규화해야 currentBgKey(이미 null로 정규화된 값)와 비교했을 때 "바뀔 게 없다"고 올바르게 판단한다 -
  // 안 그러면 showBg가 가리키는 원본 문자열이 계속 currentBgKey(null)와 달라 보여서 매 렌더링마다
  // fadeToBackground가 다시 불리고, backgroundTransitioning이 아직 true인 동안 재진입하면
  // fadeToBackground<->renderCurrent가 서로를 동기적으로 무한 호출해 콜스택이 터진다.
  const normalizedShowBg = line.showBg && BG[line.showBg] ? line.showBg : null;
  const requestedBgKey = line.clearBg ? null : (normalizedShowBg || currentBgKey);
  const deferVisualsUntilBg = Boolean(
    line.deferVisualsUntilBg &&
    hasBackgroundRequest &&
    requestedBgKey !== currentBgKey &&
    !line.noBgFade
  );

  // 일반 장면은 기존처럼 스탠딩을 즉시 반영한다.
  // 히든 인트로는 페이드아웃이 끝나 검은 화면이 된 뒤에만
  // 윤대웅 실루엣을 준비하여 전환 중 선출현을 막는다.
  if(line.chars && !deferVisualsUntilBg){
    // noBgFade(화면이 즉시 암전/컷되는 지점)에서는 캐릭터도 슬라이드 없이 같이 즉시 사라져야
    // 화면과 안 어긋난다 - 이때는 등장/퇴장 연출과 dip/교체 연출을 전부 건너뛴다.
    const instant = Boolean(line.noBgFade);
    if(!instant && tryPlayCenterSlideToSideTransition(line.chars)) return;
    if(!instant && tryPlaySoloToGroupTransition(line.chars)) return;
    if(!instant && tryPlayGroupToSoloTransition(line.chars)) return;
    if(!instant && tryPlaySlotShift(line.chars)) return;
    if(!instant && tryPlayCharacterHandoff(line.chars)) return;
    setChars(line.chars, instant);
  }

  if(!deferVisualsUntilBg){
    if(line.clearDim){
      clearAllCharacterDim();
    }
    if(Array.isArray(line.dimSlots)){
      const dimTargets = {
        left:el.charLeft,
        center:el.charCenter,
        right:el.charRight,
      };
      line.dimSlots.forEach(slot => {
        dimTargets[slot]?.classList.add('dim');
      });
    }

    if(line.mysterySilhouette === 'left'){
      applyMysterySilhouetteImmediately('left');
    } else if(line.mysterySilhouette === 'right'){
      applyMysterySilhouetteImmediately('right');
    } else if(line.mysterySilhouette === 'center'){
      applyMysterySilhouetteImmediately('center');
    }
  }

  if(
    hasBackgroundRequest &&
    requestedBgKey !== currentBgKey &&
    !line.noBgFade
  ){
    fadeToBackground(requestedBgKey);
    return;
  }

  if(hasBackgroundRequest && requestedBgKey !== currentBgKey){
    setBg(requestedBgKey);
  }

  // whiteout을 걷는 처리(false)는 impact 등 다른 이펙트보다 먼저 해야 한다 - 안 그러면 아직 흰 화면이
  // 안 걷힌 상태에서 화면 흔들림 등이 먼저 재생돼 버려서 보이지 않는다(신고받아 수정). noBgFade가
  // 걸린 줄이면 트랜지션 없이 즉시 걷어내 그 아래 배경/CG가 바로 드러난 채로 흔들림이 보이게 한다.
  if('whiteout' in line){ setWhiteout(line.whiteout, Boolean(line.noBgFade)); }
  // explosion은 내부적으로 triggerImpactShake도 함께 재생하므로(triggerExplosion 참고), 같은 줄에
  // impact:true까지 같이 있으면 효과음을 두 개(굉음+지진음) 동시에 새로 재생하게 되는데, 이때 하나가
  // 묻혀 안 들리는 경우가 있었다(신고받아 수정) - explosion이 있으면 그쪽 굉음만 재생해 폭발음이
  // 항상 확실히 들리게 한다.
  if(line.explosion){ triggerExplosion(line.explosion === 'large'); playSe(line.explosion === 'large' ? SE.EXPLOSION_LARGE : SE.EXPLOSION); }
  else if(line.impact){ triggerImpactShake(); playSe(SE.IMPACT); }
  if(line.rumble){ triggerRumbleShake(); playSe(SE.RUMBLE); }
  if(line.glitch){ triggerGlitch(); playSe(SE.GLITCH); }
  if(line.shockReveal){ triggerShockReveal(); playSe(SE.SHOCK_REVEAL); }
  if('letterbox' in line){ setLetterbox(line.letterbox); }
  // staggerCollapse는 위쪽의 이른 early-return(playStaggerCollapseReveal)에서 이미 재생 + 대사창
  // 숨김/지연까지 처리했으므로 여기서 다시 트리거하지 않는다(이중 재생 방지).
  if(line.hitFlash){ triggerHitFlash(line.hitFlash); playSe(SE.HIT); }
  if(line.comedyBounce){ triggerComedyBounce(line.comedyBounce); playSe(SE.COMEDY_BOUNCE); }
  if(line.cameraPunch){ triggerCameraPunch(); playSe(SE.CAMERA_PUNCH); }
  if('tvStatic' in line){ setCharTvStatic(line.tvStatic); }
  // 다른 이펙트 필드와 무관하게(또는 함께) 씬 데이터가 직접 효과음을 지정하고 싶을 때(예: whiteout처럼
  // 같은 필드라도 맥락마다 다른 소리가 맞는 경우) - line.se로 어떤 줄에든 자유롭게 붙일 수 있다.
  if(line.se){ playSe(line.se); }

  // 송주헌 호감도 3 이상 엔딩: 지정 문장부터 CG 배경만 표시하고 스탠딩은 숨김
  if(line.text === JUHEON_ENDING_VISUAL_CUE){
    juheonEndingVisualActive = true;
  }
  if(juheonEndingVisualActive){
    setChars({left:null, right:null});
  }

  if(line.openChat){ openChat(line.openChat); }

  if(line.type === 'chat'){
    el.dialogueWrap.classList.add('hidden');
    addChatBubble(line.from, line.text);
    // chat 타입의 closeChat은 즉시 닫지 않고,
    // 사용자가 마지막 메시지를 확인한 뒤 넘길 때 닫는다.
    typing = false;
    return;
  }
  if(line.closeChat){ closeChat(); }
  // 대사창을 여기서 바로 보이게 하지 않는다 - 특히 타임카드(10년 후 등) 직후처럼 dialogueWrap이
  // 한동안 hidden이었던 경우, 안에 남아있던 "이전 대사" 텍스트가 지워지기 전에 먼저 보여버려서
  // 배경이 페이드인된 직후 잠깐 이전 대사가 스쳐 지나가듯 보이는 문제가 있었다. typeText가 텍스트를
  // 비우는 바로 그 순간에 같이 보이게 해서(아래) 빈 상태로만 나타나게 한다.

  el.box.classList.remove('thought','narration','speech');
  // 감정이 격해지는 대사(절규, 절박한 외침 등)는 line.emphasis:true로 표시해두면 폰트를 키워서
  // 보여준다(요청됨) - narration/thought/speech와 독립적인 별도 클래스라 toggle로 처리한다.
  el.box.classList.toggle('emphasis', Boolean(line.emphasis));
  let reverseType = false;
  if(line.type === 'narration'){
    el.box.classList.add('narration');
    el.nameplate.style.display = 'none';
    reverseType = false;
    applySpeakingDim(null);
  } else if(line.type === 'thought'){
    el.box.classList.add('thought');
    el.nameplate.style.display = 'none';
    reverseType = false;
    applySpeakingDim(null);

    // 대화 기록 모달용 - 독백은 화자 표시 없이 괄호로만 얇게 보여준다(renderDialogueLog 참고).
    // 원문에 이미 괄호가 있으면 그대로, 없으면 괄호를 씌운다.
    dialogueHistory.push({ isMonologue: true, text: wrapInParens(withPlayerName(line.text)) });
  } else if(line.type === 'line'){
    el.box.classList.add('speech');
    el.nameplate.style.display = 'flex';
    if(line.mysterySpeaker){
      el.nameMain.textContent = '???';
      el.nameSub.textContent = '???';
      el.nameSub.style.display = '';
    } else {
      el.nameMain.textContent = line.speaker.name;
      el.nameSub.textContent = line.speaker.sub || '';
      el.nameSub.style.display = line.speaker.hideSub ? 'none' : '';
    }
    reverseType = false;
    if(line.speaker.key){
      applySpeakingDim(line.speaker.key);
      maybePlayTvStaticFirstSpeakSe(line.speaker.key);
    } else {
      // 기본 캐릭터 또는 공동 대사 - 모든 스탠딩을 밝게
      clearAllCharacterDim();
    }

    // 대화 기록 모달용 - DOM(nameMain 등)을 다시 읽지 않고 같은 판정을 직접 한 번 더 계산한다
    // (el.nameMain.textContent를 읽으면 화면 표시 타이밍에 종속되기 쉬워서 더 안전하다). 이름 아래
    // 직업(sub)은 로그에서는 안 보여주기로 해서 여기서는 담지 않는다.
    dialogueHistory.push({
      isPlayer: line.speaker === PLAYER,
      name: line.mysterySpeaker ? '???' : withPlayerName(line.speaker.name),
      avatarKey: line.speaker.key || null,
      text: withPlayerName(line.text),
    });
  }

  typeText(withPlayerName(line.text), reverseType);
}

// target: 기본은 el.text(대사창)지만, 편지 연출(type:'letter')처럼 다른 요소에 타이핑해야 할 때
// 넘긴다 - advance()가 타이핑 중 클릭 시 "즉시 완성"할 대상도 이 typeTargetEl을 그대로 참조한다.
let typeTargetEl = null;
function typeText(full, reverse, target){
  typing = true;
  typeTargetEl = target || el.text;
  typeTargetEl.textContent = '';
  if(typeTargetEl === el.text){
    el.dialogueWrap.classList.remove('hidden'); // renderCurrent 참고 - 텍스트를 비운 직후에 보여준다
  }
  el.hint.style.visibility = 'hidden';
  let i = reverse ? full.length - 1 : 0;
  clearInterval(typeTimer);
  typeTimer = setInterval(()=>{
    if(reverse){
      typeTargetEl.textContent = full[i] + typeTargetEl.textContent;
      i--;
      if(i < 0){
        clearInterval(typeTimer);
        typing = false;
        el.hint.style.visibility = 'visible';
      }
    } else {
      typeTargetEl.textContent += full[i];
      i++;
      if(i >= full.length){
        clearInterval(typeTimer);
        typing = false;
        el.hint.style.visibility = 'visible';
      }
    }
  }, 38);
}

function advance(){
  // 자동재생 정책으로 이전 play() 시도가 막혔던 bgm이 있다면, 지금 이 클릭(확실한 사용자 제스처)에
  // 실어서 다시 시도한다 - playBgm의 재시도(같은 곡이 다시 지정될 때만 재시도)와 별개로, 씬 안에서
  // 그 곡이 다시 지정되지 않는 경우까지 폭넓게 커버한다.
  if(currentBgmKey && el.bgmPlayer.paused) el.bgmPlayer.play().catch(()=>{});
  if(
    el.choiceLayer.classList.contains('show') ||
    el.endLayer.classList.contains('show') ||
    mysteryRevealTransitioning ||
    timeCardTransitioning ||
    backgroundTransitioning ||
    silentEffectHolding ||
    letterTransitioning ||
    whiteoutRevealHolding ||
    staggerCollapseHolding ||
    itemRevealHolding
  ) return;
  if(typing){
    clearInterval(typeTimer);
    const line = queue[idx];
    typeTargetEl.textContent = withPlayerName(line.text);
    typing = false;
    el.hint.style.visibility = 'visible';
    return;
  }
  const currentLine = queue[idx];

  if(currentLine && currentLine.revealCharacter){
    revealMysteryCharacter(currentLine.revealCharacter);
    return;
  }

  if(currentLine && currentLine.type === 'chat' && currentLine.closeChat){
    closeChat();
  }

  idx++;
  renderCurrent();
}

function showChoiceGeneric(choiceData, onPick){
  el.choiceLayer.innerHTML = '';
  const prompt = document.createElement('div');
  prompt.style.color = '#f3efe6';
  prompt.style.fontSize = '15px';
  prompt.style.marginBottom = '6px';
  prompt.textContent = choiceData.prompt;
  el.choiceLayer.appendChild(prompt);

  choiceData.options.forEach(opt=>{
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = opt.label;
    btn.onclick = (e)=>{
      e.stopPropagation();
      el.choiceLayer.classList.remove('show');
      onPick(opt);
    };
    el.choiceLayer.appendChild(btn);
  });

  el.choiceLayer.classList.add('show');
}

/* =========================================================
   씬 전환 티켓 게이팅
   - saveCheckpoint()가 호출되던 자리(=다음 씬으로 넘어가는 경계)마다 게이트를 통과해야 한다.
   - 자동사용 OFF: 확인 모달 -> 확인 시 티켓 소모 -> 성공하면 진행, 실패하면 부족 모달.
   - 자동사용 ON: 모달 없이 즉시 티켓 소모 시도 -> 실패하면 부족 모달.
   - 취소/부족 모달 확인 시 항상 스토리 메인 화면으로 돌아간다(진행 중이던 씬은 렌더링되지 않음).
   - 게이트에 도달하자마자(티켓 소모 성공 여부와 무관하게) 체크포인트를 "가려는 다음 씬(sceneKey)"으로
     바로 저장해둔다. 선택은 이미 끝난 상태라 다음 씬이 이미 확정돼 있기 때문이다. 예전에는 여기서
     직전 씬(currentSceneKey)을 저장했는데, 그러면 확인 취소나 티켓 부족으로 못 넘어간 뒤 - 특히
     상점 등 다른 페이지에 들렀다 티켓을 사고 돌아오거나 새로고침을 해서 메모리 상태가 날아간 경우 -
     로비의 "이어보기"가 서버에 저장된 직전 씬 처음부터 다시 재생되면서 이미 끝낸 선택이 무시되고
     티켓만 다시 나가는 문제가 있었다. 다음 씬을 미리 저장해두면 언제 다시 들어오든(같은 세션이든
     새로고침 후든) "이어보기"가 정확히 이 다음 씬으로 재개된다(아직 실제로 보여준 적은 없으므로
     내용을 미리 새는 것은 아니고, 재개 시에도 여전히 티켓을 낸다 - 아래 이어보기 버튼 핸들러 참고).
   ========================================================= */
// 확인 모달을 닫은 뒤 서버에 티켓 소모를 요청하고 응답을 기다리는 구간이 있는데, 그동안 화면이
// 아무 반응 없이 멈춘 것처럼 보인다는 신고를 받아 그 사이에 로딩 표시를 띄운다(자동 사용 설정일 때도
// 확인 모달 없이 곧장 같은 대기가 생기므로 두 경로 모두 여기서 한 번에 처리한다).
function showSceneLoading(){
  document.getElementById('vn-scene-loading-modal').classList.add('show');
}
function hideSceneLoading(){
  document.getElementById('vn-scene-loading-modal').classList.remove('show');
}

function gateNextScene(sceneKey, proceedFn, stateOverride){
  serverSaveCheckpoint(sceneKey, stateOverride);

  function afterTicketOk(){
    currentSceneKey = sceneKey;
    proceedFn();
  }
  function afterTicketFail(){
    showTicketInsufficientModal();
  }
  function tryConsume(){
    showSceneLoading();
    consumeTicketOnServer().then(ok=>{
      hideSceneLoading();
      if(ok) afterTicketOk(); else afterTicketFail();
    });
  }

  if(autoUseTickets){
    tryConsume();
  } else {
    showTicketConfirmModal(tryConsume, returnToStoryMainScreen);
  }
}

/* ---- 씬1 흐름 ---- */
function playScene1(){

  setBg('classroom');
  el.charLeft.classList.remove('show');
  el.charRight.classList.remove('show');
  curLeftKey = null;
  curRightKey = null;
  playQueue(SCENE1_START.slice(), showScene1Choice);

}

function showScene1Choice(){
  showChoiceGeneric(SCENE1_CHOICE, (opt)=>{
    choice1 = opt.key;
    affJuheon += opt.affection;
    updateDebug();
    playQueue(SCENE1_BRANCHES[opt.key].slice(), playScene2Intro);
  });
}

/* ---- 씬2 흐름 ---- */
function playScene2Intro(){
  gateNextScene('scene2', renderScene2Intro);
}
function renderScene2Intro(){
  if(choice1 === '3'){
    playQueue(SCENE2_INTRO_3.slice(), showScene2Choice3);
  } else {
    playQueue(SCENE2_INTRO_12.slice(), showScene2Choice12);
  }
}

function showScene2Choice12(){
  showChoiceGeneric(SCENE2_CHOICE_12, (opt)=>{
    playEnding(choice1 + '-' + opt.key);
  });
}

function showScene2Choice3(){
  showChoiceGeneric(SCENE2_CHOICE_3, (opt)=>{
    playEnding('3-' + opt.key);
  });
}

function playEnding(key){
  const ending = ENDINGS[key];
  playQueue(ending.lines.slice(), ()=>{
    if(ending.gameOver){
      showGameOver();
    } else {
      affJuheon += ending.juheon;
      affSeungyu += ending.seungyu;
      updateDebug();
      if(affJuheon < 0){
        playScene3();
      } else {
        playScene3b();
      }
    }
  });
}

/* ---- 씬3 흐름 (체육관 풋살 - 루트 1: 주헌 호감도 음수) ---- */
function playScene3(){
  gateNextScene('scene3a', renderScene3);
}
function renderScene3(){
  playQueue(SCENE3_INTRO.slice(), showScene3Choice);
}

function showScene3Choice(){
  showChoiceGeneric(SCENE3_CHOICE, (opt)=>{
    playScene3Branch(opt.key);
  });
}

function playScene3Branch(key){
  const branch = SCENE3_BRANCHES[key];
  playQueue(branch.lines.slice(), ()=>{
    affSeungyu += branch.seungyu;
    affYeongwoong += branch.yeongwoong;
    updateDebug();
    playScene4();
  });
}

/* ---- 씬3b 흐름 (체육관 풋살 - 루트 2: 주헌 호감도 0 또는 양수) ---- */
function playScene3b(){
  gateNextScene('scene3b', renderScene3b);
}
function renderScene3b(){
  playQueue(SCENE3B_INTRO.slice(), showScene3bChoice);
}

function showScene3bChoice(){
  showChoiceGeneric(SCENE3B_CHOICE, (opt)=>{
    playScene3bBranch(opt.key);
  });
}

function playScene3bBranch(key){
  const branch = SCENE3B_BRANCHES[key];
  playQueue(branch.lines.slice(), ()=>{
    affJuheon += branch.juheon;
    affSeungyu += branch.seungyu;
    affGanghee += branch.ganghee;
    updateDebug();
    if(affGanghee > 0){
      playGangheeEnding();
    } else {
      playScene4b();
    }
  });
}

/* ---- 씬4b 흐름 (부고컵 축구대회 - 씬3b 이후) ---- */
function playScene4b(){
  gateNextScene('scene4b', renderScene4b);
}
function renderScene4b(){
  playQueue(SCENE4B_INTRO.slice(), showScene4bChoice);
}

function showScene4bChoice(){
  showChoiceGeneric(SCENE4B_CHOICE, (opt)=>{
    const outcome = SCENE4B_OUTCOMES[opt.key];
    playQueue(outcome.lines.slice(), ()=>{
      affJuheon += outcome.juheon;
      affSeungyu += outcome.seungyu;
      affGanghee += outcome.ganghee;
      updateDebug();
      if(affGanghee > 0){
        playGangheeEnding();
      } else if(affJuheon > affSeungyu){
        playScene5Juheon();
      } else {
        playScene5Seungyu();
      }
    });
  });
}

/* ---- 씬5 흐름 (씬4b 이후, 주헌 호감도 > 승유 호감도) ---- */
function playScene5Juheon(){
  gateNextScene('scene5_juheon', renderScene5Juheon);
}
function renderScene5Juheon(){
  playQueue(SCENE5_JUHEON_INTRO.slice(), showScene5JuheonChoice);
}

function showScene5JuheonChoice(){
  showChoiceGeneric(SCENE5_JUHEON_CHOICE, (opt)=>{
    const outcome = SCENE5_JUHEON_OUTCOMES[opt.key];
    playQueue(outcome.lines.slice(), ()=>{
      affJuheon += outcome.juheon;
      updateDebug();
      if(affJuheon >= 3){
        playScene6JuheonHigh();
      } else {
        playScene6JuheonLow();
      }
    });
  });
}

function playGangheeEnding(){
  closeChat();

  // 강 희 엔딩 시작 시 스탠딩은 즉시 제거하고,
  // 첫 번째 교실 배경으로 자연스럽게 전환한다.
  el.charLeft.classList.remove('show', 'dim');
  el.charRight.classList.remove('show', 'dim');
  el.charLeftImg.removeAttribute('src');
  el.charRightImg.removeAttribute('src');
  curLeftKey = null;
  curRightKey = null;

  playQueue(SCENE_GANGHEE_ENDING.slice(), ()=>{
    showEnd('강 희 END');
  });
}

function playCollectorEnding(){
  closeChat();
  hideAllCharacters();

  playQueue(SCENE_COLLECTOR_ENDING.slice(), ()=>{
    showEnd('COLLECTOR END');
  });
}

function playNormalEnding(){
  if(affGanghee > 0){
    playGangheeEnding();
    return;
  }

  if(isCollectorEndingReady()){
    playCollectorEnding();
    return;
  }

  closeChat();
  el.charLeft.classList.remove('show');
  el.charRight.classList.remove('show');
  el.charLeftImg.removeAttribute('src');
  el.charRightImg.removeAttribute('src');
  curLeftKey = null;
  curRightKey = null;

  playQueue(SCENE6_NORMAL_ENDING.slice(), ()=>{
    showEnd('NORMAL END');
  });
}

/* ---- 씬6 흐름 (송주헌 루트 분기, BugoTalk) ---- */
function playScene6JuheonLow(){
  gateNextScene('scene6_juheon_low', renderScene6JuheonLow);
}
function renderScene6JuheonLow(){
  el.charLeft.classList.remove('show');
  el.charRight.classList.remove('show');
  curLeftKey = null;
  curRightKey = null;
  playQueue(SCENE6_JUHEON_LOW_INTRO.slice(), showScene6JuheonLowChoice);
}

function showScene6JuheonLowChoice(){
  showChoiceGeneric(SCENE6_JUHEON_LOW_CHOICE, (opt)=>{
    const outcome = SCENE6_JUHEON_LOW_OUTCOMES[opt.key];
    playQueue(outcome.lines.slice(), ()=>{
      affJuheon += outcome.juheon;
      updateDebug();

      if(affGanghee > 0){
        playGangheeEnding();
      } else {
        playNormalEnding();
      }
    });
  });
}

function playScene6JuheonHigh(){
  gateNextScene('scene6_juheon_high', renderScene6JuheonHigh);
}
function renderScene6JuheonHigh(){
  el.charLeft.classList.remove('show');
  el.charRight.classList.remove('show');
  curLeftKey = null;
  curRightKey = null;
  playQueue(SCENE6_JUHEON_HIGH_INTRO.slice(), showScene6JuheonHighInput);
}

function showScene6JuheonHighInput(){
  showComposeInput((typed)=>{
    const hasHidden = typed.includes('히든 업적') || typed.includes('히든업적');
    const hasBanjuk = typed.includes('반죽동');
    // 히든 엔딩 키워드는 이 파일에 없다 - /story/state가 내려준 storySecrets에서만 가져온다(위
    // storySecrets 선언부 주석 참고). 값이 아직 없으면(private_seed.py 미설정 등) 빈 문자열이라
    // includes('')가 항상 true가 되는 걸 막기 위해 명시적으로 false 처리한다.
    const hiddenEndingKeyword = storySecrets.hidden_ending_keyword || "";
    const hasHiddenEndingKeyword = hiddenEndingKeyword.length > 0 && typed.includes(hiddenEndingKeyword);
    const matchCount = [hasHidden, hasBanjuk, hasHiddenEndingKeyword].filter(Boolean).length;

    let outcome;
    let isHiddenEnding = false;
    if(matchCount >= 2){
      outcome = SCENE6_JUHEON_HIGH_OUTCOME_E;
    } else if(matchCount === 0){
      outcome = SCENE6_JUHEON_HIGH_OUTCOME_D;
    } else if(hasHiddenEndingKeyword){
      isHiddenEnding = true;
    } else if(hasBanjuk){
      outcome = SCENE6_JUHEON_HIGH_OUTCOME_B;
    } else {
      outcome = SCENE6_JUHEON_HIGH_OUTCOME_A;
    }

    if(isHiddenEnding){
      affJuheon += 1;
      updateDebug();
      playQueue(SCENE6_JUHEON_HIDDEN_CHAT.slice(), ()=>{
        closeChat();

        // 학교 정문 전환을 시작하기 전에 이전 스탠딩과 이미지 잔상을 전부 제거한다.
        hideAllCharacters();
        clearAllCharacterDim();
        el.charLeftImg.removeAttribute('src');
        el.charCenterImg.removeAttribute('src');
        el.charRightImg.removeAttribute('src');

        playQueue(SCENE6_JUHEON_HIDDEN_INTRO.slice(), ()=>{
          // 배경 페이드가 시작되기 전에 윤대웅 스탠딩을 완전히 제거한다.
          hideAllCharacters();
          clearAllCharacterDim();
          el.charLeftImg.removeAttribute('src');
          el.charCenterImg.removeAttribute('src');
          el.charRightImg.removeAttribute('src');

          playQueue(SCENE6_JUHEON_HIDDEN_ENDING.slice(), ()=>{
            showEnd('HIDDEN END');
          });
        });

      });
    } else {
      playQueue(outcome.lines.slice(), ()=>{
        affJuheon += outcome.juheon;
        updateDebug();
        closeChat();

        if(affGanghee > 0){
          playGangheeEnding();
        } else {
          playQueue(SCENE6_JUHEON_HIGH_ENDING.slice(), ()=>{
            showEnd('송주헌 END');
          });
        }

      });
    }
  });
}

/* ---- 씬4 흐름 (부고컵 축구대회 - 씬3 이후 이어짐) ---- */
function playScene4(){
  gateNextScene('scene4', renderScene4);
}
function renderScene4(){
  playQueue(SCENE4_INTRO.slice(), showScene4Choice);
}

function showScene4Choice(){
  showChoiceGeneric(SCENE4_CHOICE, ()=>{
    // 선택과 무관하게 1/3 확률로 무작위 결과 결정
    const keys = ['a','b','c'];
    const picked = keys[Math.floor(Math.random()*3)];
    playScene4Outcome(picked);
  });
}

function playScene4Outcome(key){
  const outcome = SCENE4_OUTCOMES[key];
  playQueue(outcome.lines.slice(), ()=>{
    affSeungyu += outcome.seungyu;
    affYeongwoong += outcome.yeongwoong;
    updateDebug();
    if(affSeungyu >= affYeongwoong){
      playScene5Seungyu();
    } else {
      playScene5Yeongwoong();
    }
  });
}

/* ---- 씬5 흐름 (씬4 이후, 강승유/이영웅 호감도 비교로 루트 분기) ---- */
function playScene5Seungyu(){
  gateNextScene('scene5_seungyu', renderScene5Seungyu);
}
function renderScene5Seungyu(){
  playQueue(SCENE5_SEUNGYU_INTRO.slice(), showScene5SeungyuChoice);
}

function showScene5SeungyuChoice(){
  showChoiceGeneric(SCENE5_SEUNGYU_CHOICE, (opt)=>{
    const outcome = SCENE5_SEUNGYU_OUTCOMES[opt.key];
    playQueue(outcome.lines.slice(), ()=>{
      affSeungyu += outcome.seungyu;
      updateDebug();
      playScene6Seungyu();
    });
  });
}

function playScene5Yeongwoong(){
  gateNextScene('scene5_yeongwoong', renderScene5Yeongwoong);
}
function renderScene5Yeongwoong(){
  playQueue(SCENE5_YEONGWOONG_INTRO.slice(), showScene5YeongwoongChoice);
}

function showScene5YeongwoongChoice(){
  showChoiceGeneric(SCENE5_YEONGWOONG_CHOICE, (opt)=>{
    const outcome = SCENE5_YEONGWOONG_OUTCOMES[opt.key];
    playQueue(outcome.lines.slice(), ()=>{
      affYeongwoong += outcome.yeongwoong;
      updateDebug();
      playScene6Yeongwoong();
    });
  });
}

/* ---- 씬6 흐름 (모모톡 스타일 채팅) ---- */
function playScene6Seungyu(){
  gateNextScene('scene6_seungyu', renderScene6Seungyu);
}
function renderScene6Seungyu(){
  el.charLeft.classList.remove('show');
  el.charRight.classList.remove('show');
  curLeftKey = null;
  curRightKey = null;
  playQueue(SCENE6_SEUNGYU_INTRO.slice(), showScene6SeungyuChoice);
}

function showScene6SeungyuChoice(){
  showChoiceGeneric(SCENE6_SEUNGYU_CHOICE, (opt)=>{
    const outcome = SCENE6_SEUNGYU_OUTCOMES[opt.key];
    playQueue(outcome.lines.slice(), ()=>{
      affSeungyu += outcome.seungyu;
      updateDebug();
      if(affGanghee > 0){
        playGangheeEnding();
      } else if(affSeungyu >= 3){

        el.charLeft.classList.remove('show');
        el.charRight.classList.remove('show');
        curLeftKey = null;
        curRightKey = null;
        playQueue(SCENE6_SEUNGYU_HIGH_ENDING.slice(), ()=>{
          showEnd('강승유 END');
        });

      } else {
        playNormalEnding();
      }
    });
  });
}

function playScene6Yeongwoong(){
  gateNextScene('scene6_yeongwoong', renderScene6Yeongwoong);
}
function renderScene6Yeongwoong(){
  el.charLeft.classList.remove('show');
  el.charRight.classList.remove('show');
  curLeftKey = null;
  curRightKey = null;
  playQueue(SCENE6_YEONGWOONG_INTRO.slice(), showScene6YeongwoongChoice);
}

function showScene6YeongwoongChoice(){
  showChoiceGeneric(SCENE6_YEONGWOONG_CHOICE, (opt)=>{
    const outcome = SCENE6_YEONGWOONG_OUTCOMES[opt.key];
    playQueue(outcome.lines.slice(), ()=>{
      affYeongwoong += outcome.yeongwoong;
      updateDebug();
      if(affGanghee > 0){
        playGangheeEnding();
      } else if(affYeongwoong >= 2){

        el.charLeft.classList.remove('show');
        el.charRight.classList.remove('show');
        curLeftKey = null;
        curRightKey = null;
        playQueue(SCENE6_YEONGWOONG_HIGH_ENDING.slice(), ()=>{
          showEnd('이영웅 END');
        });

      } else {
        playNormalEnding();
      }
    });
  });
}

function isCollectorEndingReady(){
  return TRUE_ENDING_REQUIREMENTS.every(id => unlockedCgSet.has(id));
}

// 서버(/story/unlock-cg)에 저장하고, 렌더링에 쓰는 로컬 캐시(unlockedCgSet)도 즉시 갱신한다.
function unlockCG(id){
  if(id === 'true'){
    if(!TRUE_ENDING_REQUIREMENTS.every(req => unlockedCgSet.has(req))) return;
    TRUE_ENDING_GALLERY_IDS.forEach(trueId => serverUnlockCG(trueId));
  } else {
    const item = CG_GALLERY_ITEMS.find(entry => entry.id === id);
    if(!item) return;
    serverUnlockCG(id);
  }

  if(document.getElementById('lobby-gallery')?.classList.contains('show')){
    renderGallery();
  }
}

function getGalleryImages(item){
  if(Number.isInteger(item.trueEndingIndex)){
    const entry = TRUE_ENDING_CG[item.trueEndingIndex];
    return entry ? [{
      src:entry.src,
      label:'',
    }] : [];
  }

  // imageSrcs: 이미 완성된 URL 문자열 배열(에피소드 자기 파일이 로드되는 시점에 자기만의 BG 객체로
  // 직접 만들어둔 값) - 도감은 지금 활성화된 에피소드와 무관하게 모든 에피소드의 CG를 항상 함께 보여줘야
  // 하는데, imageKeys+전역 BG[key] 방식은 그 시점에 활성화된(activateEpisodeBundle) BG가 어느 에피소드
  // 것인지에 따라 결과가 달라져서(다른 에피소드 항목은 키를 못 찾음) 안전하지 않다. 그래서 새 에피소드는
  // imageSrcs를 쓰고, ep1의 기존 항목들은 지금처럼 imageKeys+BG[key]를 그대로 쓴다(항상 안전 - ep1은
  // 처음부터 활성화된 채로 시작하고, 이 조회 시점엔 그 값이 최신이 아닐 수 있다는 점은 동일하게 남지만
  // 기존 동작을 하나도 바꾸지 않기 위해 그대로 둔다).
  if(Array.isArray(item.imageSrcs)){
    return item.imageSrcs.filter(Boolean).map(src => ({ src, label:'' }));
  }

  return (item.imageKeys || []).map(key => ({
    src:BG[key] || null,
    label:'',
  }));
}

function getGalleryThumbnail(item){
  const images = getGalleryImages(item);
  const found = images.find(image => image.src);
  return found ? found.src : null;
}

function buildGalleryCard(item){
  const thumbnail = getGalleryThumbnail(item);
  const hasImage = Boolean(thumbnail);
  const isUnlocked = unlockedCgSet.has(item.id) && hasImage;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `gallery-card${isUnlocked ? ' unlocked' : ' locked'}`;
  button.disabled = !isUnlocked;
  button.dataset.cgId = item.id;
  button.setAttribute('aria-label', isUnlocked ? '수집한 CG 열기' : '잠긴 CG');

  if(isUnlocked){
    const image = document.createElement('img');
    image.className = 'gallery-thumb';
    image.src = thumbnail;
    image.alt = '';
    button.appendChild(image);
    button.addEventListener('click', () => openGalleryModal(item));
  }else{
    const lock = document.createElement('div');
    lock.className = 'gallery-lock';
    const lockImg = document.createElement('img');
    lockImg.src = 'assets/icons/lock.webp';
    lockImg.alt = '';
    lockImg.className = 'gallery-lock-icon';
    lockImg.onerror = () => { lock.textContent = '🔒'; };
    lock.appendChild(lockImg);
    button.appendChild(lock);
  }

  return { button, isUnlocked };
}

function renderGallery(){
  const grid = document.getElementById('gallery-grid');
  const summary = document.getElementById('gallery-summary');
  if(!grid || !summary) return;

  grid.innerHTML = '';
  let visibleUnlockedCount = 0;
  let totalCount = 0;

  GALLERY_EPISODE_SECTIONS.forEach(section => {
    const title = document.createElement('div');
    title.className = 'gallery-ep-title';
    title.textContent = section.label;
    grid.appendChild(title);

    if(section.items.length === 0){
      const empty = document.createElement('div');
      empty.className = 'gallery-ep-empty';
      empty.textContent = '준비중입니다.';
      grid.appendChild(empty);
      return;
    }

    const sectionGrid = document.createElement('div');
    sectionGrid.className = 'gallery-ep-grid';
    section.items.forEach(item => {
      const { button, isUnlocked } = buildGalleryCard(item);
      if(isUnlocked) visibleUnlockedCount += 1;
      totalCount += 1;
      sectionGrid.appendChild(button);
    });
    grid.appendChild(sectionGrid);
  });

  summary.textContent = `${visibleUnlockedCount} / ${totalCount}`;
}

function openGalleryModal(item){
  const modal = document.getElementById('gallery-modal');
  const title = document.getElementById('gallery-modal-title');
  const content = document.getElementById('gallery-modal-content');
  if(!modal || !title || !content) return;

  const image = getGalleryImages(item).find(entry => entry.src);
  if(!unlockedCgSet.has(item.id) || !image) return;

  title.textContent = '';
  content.innerHTML = '';

  const img = document.createElement('img');
  img.className = 'gallery-modal-single';
  img.src = image.src;
  img.alt = '';
  content.appendChild(img);

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  if(item.bgm) playBgm(item.bgm);
}

function closeGalleryModal(){
  const modal = document.getElementById('gallery-modal');
  if(!modal) return;

  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  playBgm(null);
}

function showEnd(title){
  const galleryId = ENDING_CG_ID_BY_TITLE[title];
  if(galleryId){
    unlockCG(galleryId);
  }

  closeChat();
  serverClearProgress();
  currentSceneKey = null;
  el.endLayer.classList.remove('gameover');
  el.endTitle.textContent = title || '이야기 끝';
  el.endAffection.innerHTML = `송주헌 호감도: ${affJuheon}<br>강승유 호감도: ${affSeungyu}<br>이영웅 호감도: ${affYeongwoong}<br>강 희 호감도: ${affGanghee}`;
  el.endLayer.classList.add('show');
}

function showGameOver(){
  unlockCG('bad');
  closeChat();
  serverClearProgress();
  currentSceneKey = null;
  el.endLayer.classList.add('gameover');
  el.endTitle.textContent = 'BAD END';
  el.endAffection.textContent = '';
  el.endLayer.classList.add('show');
}

function startGame(){
  serverClearProgress();
  currentSceneKey = 'scene1';
  choice1 = null;
  affJuheon = 0;
  affSeungyu = 0;
  affYeongwoong = 0;
  affGanghee = 0;
  dialogueHistory = []; // 새 플레이 세션 시작 - 대화 기록도 처음부터 다시 쌓는다
  el.endLayer.classList.remove('show');
  el.choiceLayer.classList.remove('show');
  closeChat();
  el.dialogueWrap.classList.remove('hidden');
  updateDebug();
  playScene1();
}

function resumeGame(progress){
  currentSceneKey = progress.scene_key || 'scene1';
  const state = progress.state || {};
  choice1 = state.choice1 ?? null;
  affJuheon = state.affJuheon || 0;
  affSeungyu = state.affSeungyu || 0;
  affYeongwoong = state.affYeongwoong || 0;
  affGanghee = state.affGanghee || 0;
  dialogueHistory = []; // 체크포인트에는 지난 대화 기록이 없으므로 이어하는 시점부터 새로 쌓는다
  el.endLayer.classList.remove('show');
  el.choiceLayer.classList.remove('show');
  closeChat();
  el.dialogueWrap.classList.remove('hidden');
  updateDebug();
  const fn = SCENE_FUNCS[progress.scene_key] || playScene1;
  fn();
}

document.getElementById('box').addEventListener('click', advance);
document.getElementById('phone-layer').addEventListener('click', advance);
document.getElementById('letter-layer').addEventListener('click', advance);
// 엔딩 창의 "로비로" 버튼: 엔딩을 봤으면 회차가 끝난 것이므로 스토리 메인 화면으로 돌아간다.
document.getElementById('restart-btn').addEventListener('click', (e)=>{
  e.stopPropagation();
  el.endLayer.classList.remove('show');
  el.endLayer.classList.remove('gameover');
  returnToStoryMainScreen();
});

/* ---- 로비 ---- */
const lobbyWrap = document.getElementById('lobby-wrap');
const lobbyScreens = {
  home: document.getElementById('lobby-home'),
  episodes: document.getElementById('lobby-episodes'),
  episodeDetail: document.getElementById('lobby-episode-detail'),
  gallery: document.getElementById('lobby-gallery'),
};

// 이어하기 진입 자체는 버튼 클릭 핸들러에서 이미 티켓을 낸 뒤 호출되므로, 여기서는 씬 전환 게이트
// (gateNextScene)를 다시 거치는 playSceneX가 아니라 실제 렌더링만 하는 renderSceneX로 바로 연결한다
// (게이트를 한 번 더 거치면 같은 지점에 대해 티켓이 2번 나가버림).
const SCENE_FUNCS = {
  scene1: playScene1,
  scene2: renderScene2Intro,
  scene3a: renderScene3,
  scene3b: renderScene3b,
  scene4: renderScene4,
  scene4b: renderScene4b,
  scene5_seungyu: renderScene5Seungyu,
  scene5_yeongwoong: renderScene5Yeongwoong,
  scene5_juheon: renderScene5Juheon,
  scene6_seungyu: renderScene6Seungyu,
  scene6_yeongwoong: renderScene6Yeongwoong,
  scene6_juheon_low: renderScene6JuheonLow,
  scene6_juheon_high: renderScene6JuheonHigh,
};

function showLobbyScreen(key){
  Object.values(lobbyScreens).forEach(s => s.classList.remove('show'));
  lobbyScreens[key].classList.add('show');
  closeGalleryModal();

  if(key === 'episodes'){ updateEpisodeCardLabel(); }
  if(key === 'episodeDetail'){ updateEpisodeDetailScreen(); }
  if(key === 'gallery'){ renderGallery(); }
}

function updateEpisodeCardLabel(){
  // Episode 1 카드는 지금까지처럼 cachedProgress(마지막으로 fetchStoryState한 에피소드의 진행 상태)를
  // 그대로 반영한다. Episode 2 카드는 아직 진입해보지 않은 상태에서도 두 에피소드의 진행 상태를 동시에
  // 알아야 정확한 라벨을 보여줄 수 있는데, 지금은 cachedProgress가 "활성 에피소드 하나"만 담을 수 있어서
  // (activateEpisodeBundle 참고) 목록 화면 단계에서는 고정 부제만 보여준다 - 실제 이어하기 여부는
  // Episode 2 카드를 눌러 상세화면(fetchStoryState로 그 에피소드 상태를 새로 받아옴)에 들어가면 정확하게 보인다.
  document.getElementById('ep1-status').textContent = cachedProgress ? '이어하기' : '우정의 시작';
}

// Episode 2/3처럼 이후 추가되는 에피소드도 이 하나로 등록해서 재사용한다 - title/desc는 상세화면에
// JS로 채워 넣고(기존엔 HTML에 Episode 1 문구가 하드코딩돼 있었다), 시작/이어하기/다시시작 버튼은
// bundle.startGame/resumeGame을 호출한다. bundle이 없으면(예: 아직 "준비 중"인 에피소드) 카드 자체가
// 클릭 핸들러를 안 받는다.
const EPISODE_REGISTRY = {
  1: {
    title: 'Episode 1',
    subtitle: '우정의 시작',
    desc: '평범한 학교 생활 속, 우연이 겹치며 시작되는 인연 이야기.',
    dataBundle: () => EP1_BUNDLE,
    startGame: () => startGame(),
    resumeGame: (progress) => resumeGame(progress),
    getState: () => ({ choice1, affJuheon, affSeungyu, affYeongwoong, affGanghee }),
  },
};
// Episode 2(story/scenario/ep2_choijaehyeok.js)는 ep1보다 먼저 로드되지만 이 스크립트(story-engine.js)
// 보다는 나중이 아니라 먼저 로드된다(story-relationship.html의 스크립트 순서 참고) - 그래서 지금
// (story-engine.js가 평가되는 이 시점) EP2_BUNDLE/startGame2/resumeGame2/getEp2State는 이미 전역에
// 존재한다. typeof 가드는 순서가 바뀌거나 아직 Episode 2 파일이 없는 상태에서도 이 스크립트 전체가
// 죽지 않게 하기 위한 최소한의 방어다.
if(typeof EP2_BUNDLE !== 'undefined'){
  EPISODE_REGISTRY[2] = {
    title: 'Episode 2',
    subtitle: '멸망의 서막',
    desc: '최재혁이 꺼낸 멸망의 징조에 관한 이야기, 일상을 지켜낼 수 있을까.',
    dataBundle: () => EP2_BUNDLE,
    startGame: () => startGame2(),
    resumeGame: (progress) => resumeGame2(progress),
    getState: () => getEp2State(),
  };
}

function updateEpisodeDetailScreen(){
  const info = EPISODE_REGISTRY[activeEpisode];
  document.querySelector('#lobby-episode-detail .lobby-header-title').textContent = info.title;
  document.querySelector('.episode-detail-title').textContent = `${info.title} · ${info.subtitle}`;
  document.querySelector('.episode-detail-desc').textContent = info.desc;

  const startBtn = document.getElementById('episode-detail-start-btn');
  const restartBtn = document.getElementById('episode-detail-restart-btn');
  startBtn.textContent = cachedProgress ? '이어보기' : '시작하기';
  restartBtn.style.display = cachedProgress ? '' : 'none';
  document.getElementById('vn-autouse-toggle').checked = autoUseTickets;
}

// 로비 카드를 눌러 특정 에피소드로 들어갈 때 공통으로 거치는 진입점 - 활성 번들을 바꾸고
// (activateEpisodeBundle), "저장 및 종료"가 쓸 state 포인터도 그 에피소드 것으로 바꾼 뒤, 그 에피소드
// 자신의 story_id로 진행 상태를 새로 받아와야(fetchStoryState) 상세화면의 이어하기 여부가 정확해진다.
function enterEpisodeDetail(episodeNum){
  const info = EPISODE_REGISTRY[episodeNum];
  if(!info) return; // 아직 "준비 중"인 에피소드 - 카드에 클릭 핸들러 자체가 없어야 하지만 방어적으로 무시
  activeEpisode = episodeNum;
  activateEpisodeBundle(info.dataBundle());
  getCurrentEpisodeState = info.getState;
  fetchStoryState().then(()=>{
    showLobbyScreen('episodeDetail');
  });
}

function returnToStoryMainScreen(){
  playBgm(null);
  lobbyWrap.classList.remove('hidden');
  showLobbyScreen('home');
}

function exitToLobby(){
  playBgm(null);
  lobbyWrap.classList.remove('hidden');
  showLobbyScreen('episodes');
}

document.getElementById('btn-episodes').addEventListener('click', ()=> showLobbyScreen('episodes'));
document.getElementById('btn-gallery').addEventListener('click', ()=> showLobbyScreen('gallery'));
document.getElementById('btn-exit').addEventListener('click', ()=>{
  window.location.href = 'home.html';
});

document.querySelectorAll('.lobby-back').forEach(btn=>{
  if(btn.id === 'episode-detail-back-btn') return; // 아래에서 따로 처리(에피소드 목록으로)
  if(btn.id === 'episode-detail-restart-btn') return; // "처음부터 다시 시작"은 화면 이동 버튼이 아님
  btn.addEventListener('click', ()=> showLobbyScreen('home'));
});
document.getElementById('episode-detail-back-btn').addEventListener('click', ()=> showLobbyScreen('episodes'));

document.getElementById('episode-card-1').addEventListener('click', ()=>{
  enterEpisodeDetail(1);
});
document.getElementById('episode-card-2')?.addEventListener('click', ()=>{
  enterEpisodeDetail(2);
});

// "처음부터 다시 시작": 저장된 진행(이어하기 지점)만 초기화하고 - CG 도감 해금은 별개 데이터라 유지됨 -
// 저장이 없을 때 "시작하기"를 누른 것과 동일하게 티켓 소모 후 첫 씬부터 시작한다.
document.getElementById('episode-detail-restart-btn').addEventListener('click', async (e)=>{
  e.stopPropagation();
  serverClearProgress();
  updateEpisodeDetailScreen();

  const ok = await consumeTicketOnServer();
  if(!ok){
    showTicketInsufficientModal();
    return;
  }
  lobbyWrap.classList.add('hidden');
  EPISODE_REGISTRY[activeEpisode].startGame();
});

// 시작하기 버튼(진행 기록 없음): 확인 모달 없이 바로 티켓 소모를 시도한다(취소할 "이전 씬"이 아직 없으므로).
document.getElementById('episode-detail-start-btn').addEventListener('click', async ()=>{
  if(cachedProgress){
    // 이어보기: 체크포인트는 항상 "직전 선택 이후 도달한(아직 못 봤을 수도 있는) 다음 씬"을 가리킨다
    // (gateNextScene이 게이트를 여는 즉시 저장해두므로, 확인 취소나 티켓 부족으로 못 넘어갔던 경우도
    // 포함). 씬 전환 게이트와 똑같이, 자동사용이 꺼져 있으면 "다음 장면에서 티켓을 사용하시겠습니까?"
    // 확인을 거치고 켜져 있으면 곧바로 소모한다 - 예전처럼 무료 재방문을 허용하면 그 씬의 선택을
    // 몇 번이고 공짜로 다시 시도해서 호감도 등을 유리한 쪽으로 골라잡는 악용이 가능했다.
    function tryResume(){
      consumeTicketOnServer().then(ok=>{
        if(ok){
          lobbyWrap.classList.add('hidden');
          EPISODE_REGISTRY[activeEpisode].resumeGame(cachedProgress);
        } else {
          showTicketInsufficientModal();
        }
      });
    }
    if(autoUseTickets){
      tryResume();
    } else {
      showTicketConfirmModal(tryResume, ()=>{});
    }
    return;
  }

  const ok = await consumeTicketOnServer();
  if(!ok){
    showTicketInsufficientModal();
    return;
  }
  lobbyWrap.classList.add('hidden');
  EPISODE_REGISTRY[activeEpisode].startGame();
});

/* ---- 신규: 스토리 진행 중 메뉴 모달 ----
   이어하기/바탕 클릭 = 모달만 닫고 계속, 저장 및 종료 = 현재 씬을 체크포인트로 저장하고 스토리 로비로. */
const menuModal = document.getElementById('vn-menu-modal');

document.getElementById('menu-btn').addEventListener('click', (e)=>{
  e.stopPropagation();
  menuModal.classList.add('show');
});
document.getElementById('vn-menu-resume').addEventListener('click', ()=>{
  menuModal.classList.remove('show');
});
menuModal.addEventListener('click', (event)=>{
  if(event.target === menuModal) menuModal.classList.remove('show');
});
document.getElementById('vn-menu-save-exit').addEventListener('click', ()=>{
  menuModal.classList.remove('show');
  if(currentSceneKey) serverSaveCheckpoint(currentSceneKey, getCurrentEpisodeState());
  exitToLobby();
});

/* ---- 신규: 대화 기록(대사) 모달 ----
   dialogueHistory(현재 씬 구간에서 재생된 line 타입만, renderCurrent 참고)를 그대로 목록으로 그린다.
   내가 한 대사는 사진 없는 카드, 다른 사람은 CHAR_IMG 원본 스탠딩 일러스트를 avatar-crop.js로 얼굴만
   잘라서 카드 앞에 붙인다 - 캐릭터별 위치 보정이 필요해지면 shared/avatar-crop.js의
   AVATAR_CROP_OVERRIDES에 그 캐릭터의 key(예: 'juheon')를 outfit 키와 같은 방식으로 추가하면 된다. */
const logModal = document.getElementById('vn-log-modal');
const logModalContent = document.getElementById('vn-log-modal-content');

function renderDialogueLog(){
  logModalContent.innerHTML = '';
  dialogueHistory.forEach(entry => {
    if(entry.isMonologue){
      const mono = document.createElement('div');
      mono.className = 'log-monologue';
      mono.textContent = entry.text;
      logModalContent.appendChild(mono);
      return;
    }

    const row = document.createElement('div');
    row.className = entry.isPlayer ? 'log-entry log-entry-player' : 'log-entry log-entry-other';

    if(!entry.isPlayer && entry.avatarKey && CHAR_IMG[entry.avatarKey]){
      const avatar = document.createElement('div');
      avatar.className = 'log-avatar';
      const img = document.createElement('img');
      img.src = CHAR_IMG[entry.avatarKey];
      img.alt = entry.name;
      applyAvatarCrop(img, entry.avatarKey);
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
    logModalContent.appendChild(row);
  });
  // 스크롤이 필요한 만큼 쌓였으면 방금 재생된(가장 아래) 대사가 바로 보이게 시작한다.
  logModalContent.scrollTop = logModalContent.scrollHeight;
}

document.getElementById('log-btn').addEventListener('click', (e)=>{
  e.stopPropagation();
  renderDialogueLog();
  logModal.classList.add('show');
});
document.getElementById('vn-log-modal-close').addEventListener('click', (event)=>{
  event.stopPropagation();
  logModal.classList.remove('show');
});
logModal.addEventListener('click', (event)=>{
  if(event.target === logModal) logModal.classList.remove('show');
});

/* ---- 신규: 확대(UI 숨기기) ----
   대사창/상단 버튼(자기 자신 포함)을 CSS(#stage.ui-zoomed, story-relationship.css 참고)로 숨겨서
   배경/스탠딩만 보이게 한다. 버튼 자체가 같이 숨어버리므로 다시 누를 방법이 없다 - 대신 #stage 아무
   곳이나 클릭하면(숨겨진 요소들은 display:none이라 클릭이 그대로 배경까지 뚫고 들어온다) 원래대로
   돌아온다. zoom-btn 클릭은 stopPropagation으로 막아서, 켜는 바로 그 클릭이 버블링을 타고 올라가
   곧바로 #stage의 클릭 리스너에 걸려 즉시 다시 꺼지는 걸 방지한다. */
document.getElementById('zoom-btn').addEventListener('click', (e)=>{
  e.stopPropagation();
  el.stage.classList.add('ui-zoomed');
});
el.stage.addEventListener('click', ()=>{
  if(el.stage.classList.contains('ui-zoomed')) el.stage.classList.remove('ui-zoomed');
});

document.getElementById('gallery-modal-close').addEventListener('click', (event)=>{
  event.stopPropagation();
  closeGalleryModal();
});

document.getElementById('gallery-modal').addEventListener('click', (event)=>{
  if(event.target.id === 'gallery-modal'){
    closeGalleryModal();
  }
});

document.addEventListener('keydown', (event)=>{
  if(event.key === 'Escape'){
    closeGalleryModal();
    // 로비 화면(#lobby-wrap이 안 숨겨진 상태)에서는 확대 기능 자체가 없으니 여기서 끝낸다 -
    // 위 closeGalleryModal()만으로 충분(도감 모달은 로비에서만 열린다).
    if(!lobbyWrap.classList.contains('hidden')) return;
    // ESC를 확대(zoom-btn) 버튼과 동일하게 - 이미 확대 중이면 해제, 아니면 확대.
    el.stage.classList.toggle('ui-zoomed');
    return;
  }

  if(event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar'){
    // 로비 화면, 텍스트 입력 중(모모톡 작성창 등), 모달이 열려있을 때는 대사 진행과 무관하므로
    // 스페이스바의 기본 스크롤 동작 등 평소 키 동작을 그대로 둔다.
    if(!lobbyWrap.classList.contains('hidden')) return;
    const active = document.activeElement;
    if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    if(document.querySelector('.vn-ticket-modal.show, #vn-log-modal.show, #gallery-modal.show')) return;
    event.preventDefault();
    advance();
    return;
  }

  if(event.key === 'Control'){
    if(skipInterval) return; // 키 반복입력으로 여러 번 눌려도 인터벌은 하나만
    if(!lobbyWrap.classList.contains('hidden')) return;
    const active = document.activeElement;
    if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    if(document.querySelector('.vn-ticket-modal.show, #vn-log-modal.show, #gallery-modal.show')) return;
    // advance()는 선택지/엔딩 화면이 떠 있으면(el.choiceLayer/el.endLayer .show) 그리고 각종
    // 전환 중(backgroundTransitioning 등)에는 스스로 아무것도 하지 않으므로, 여기서 반복 호출해도
    // 선택지가 멋대로 골라지거나 전환이 깨지지 않는다 - 그냥 빠르게 스팸해서 "누르고 있는 동안 초고속
    // 스킵"을 구현한다(첫 호출은 타이핑 중인 대사를 즉시 완성, 다음 호출이 실제로 다음 줄로 넘김).
    skipInterval = window.setInterval(advance, 20);
    return;
  }
});
document.addEventListener('keyup', (event)=>{
  if(event.key === 'Control' && skipInterval){
    clearInterval(skipInterval);
    skipInterval = null;
  }
});
// 컨트롤을 누른 채 알트탭 등으로 포커스가 빠지면 keyup을 못 받을 수 있어 스킵이 멈추지 않는 것을 방지
window.addEventListener('blur', ()=>{
  if(skipInterval){
    clearInterval(skipInterval);
    skipInterval = null;
  }
});

/* ---- 신규: 티켓 자동사용 토글 ---- */
document.getElementById('vn-autouse-toggle').addEventListener('change', (e)=>{
  if(e.target.checked){
    document.getElementById('vn-autouse-info-modal').classList.add('show');
  } else {
    autoUseTickets = false;
    localStorage.setItem(AUTO_USE_STORAGE_KEY, '0');
  }
});
document.getElementById('vn-autouse-info-ok').addEventListener('click', ()=>{
  autoUseTickets = true;
  localStorage.setItem(AUTO_USE_STORAGE_KEY, '1');
  document.getElementById('vn-autouse-info-modal').classList.remove('show');
});

/* ---- 신규: 씬 전환 티켓 확인/부족 모달 ---- */
function showTicketConfirmModal(onOk, onCancel){
  const modal = document.getElementById('vn-ticket-confirm-modal');
  const okBtn = document.getElementById('vn-ticket-confirm-ok');
  const cancelBtn = document.getElementById('vn-ticket-confirm-cancel');
  okBtn.onclick = ()=>{ modal.classList.remove('show'); onOk(); };
  cancelBtn.onclick = ()=>{ modal.classList.remove('show'); onCancel(); };
  modal.classList.add('show');
}

function showTicketInsufficientModal(){
  const modal = document.getElementById('vn-ticket-insufficient-modal');
  const okBtn = document.getElementById('vn-ticket-insufficient-ok');
  const close = ()=>{ modal.classList.remove('show'); returnToStoryMainScreen(); };
  okBtn.onclick = close;
  modal.onclick = (event)=>{ if(event.target === modal) close(); };
  modal.classList.add('show');
}

/* ---- 초기화 ---- */
(async function init(){
  await Promise.all([fetchStoryState(), fetchAllUnlockedCgs()]);
  renderGallery();
  updateEpisodeCardLabel();
})();
