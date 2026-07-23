// 인연 스토리 Episode 1(윤대웅) 엔진. 원본 프로토타입(독서 RPG - 씬 1_윤대웅실루엣_사전적용수정.html)의
// 대사/분기 데이터와 연출 로직을 그대로 이식하되, 이미지는 base64 대신 assets/story/ep1/ 파일 경로를 쓰고,
// 진행상황·CG 도감·티켓 소모는 localStorage 대신 /story 서버 API로 저장한다.
// home.html의 story/story.js가 이 페이지로 navigate만 시켜주고, 그 뒤로는 이 파일이 전부 담당한다.

// API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
const STORY_ID = "ep1_yoondaewoong";
const AUTO_USE_STORAGE_KEY = "story_ep1_auto_use_tickets"; // 티켓 자동사용 여부는 서버 저장 대상이 아닌 브라우저별 UI 설정

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
let autoUseTickets = localStorage.getItem(AUTO_USE_STORAGE_KEY) === "1";

function withPlayerName(str) {
    return String(str ?? "").split("__PLAYER_NAME__").join(PLAYER_NAME);
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
        unlockedCgSet = new Set(state.unlocked_cgs || []);
        ticketBalance = state.ticket_balance || 0;
    }

    PLAYER.name = PLAYER_NAME;
    updateTicketChips();
}

// 체크포인트 저장. 서버는 scene_key/state를 그대로 저장/반환만 하고 해석하지 않으므로,
// 원본의 saveCheckpoint처럼 실패해도(네트워크 문제 등) 진행을 막지 않는다(await 하지 않고 fire-and-forget).
function serverSaveCheckpoint(sceneKey) {
    const state = { choice1, affJuheon, affSeungyu, affYeongwoong, affGanghee };
    cachedProgress = { scene_key: sceneKey, state };
    fetch(`${API_BASE_URL}/story/progress`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ story_id: STORY_ID, scene_key: sceneKey, state }),
    }).catch(() => {});
}

function serverClearProgress() {
    cachedProgress = null;
    fetch(`${API_BASE_URL}/story/progress?story_id=${encodeURIComponent(STORY_ID)}`, {
        method: "DELETE",
        headers: authHeaders(),
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
        await fetch(`${API_BASE_URL}/story/unlock-cg`, {
            method: "POST",
            headers: authHeaders(true),
            body: JSON.stringify({ story_id: STORY_ID, cg_id: id }),
        });
    } catch (error) { /* 갤러리는 다음 /story/state 조회 시 다시 맞춰짐 */ }
}

const ASSET_BASE = "assets/story/ep1/";

const CHAR_IMG = {
  seungyu_true_stand: ASSET_BASE + "characters/seungyu_true_stand.png",
  ganghee_true_stand: ASSET_BASE + "characters/ganghee_true_stand.png",
  juheon: ASSET_BASE + "characters/juheon.webp",
  seungyu: ASSET_BASE + "characters/seungyu.webp",
  juheon_sil: ASSET_BASE + "characters/juheon_sil.webp",
  seungyu_sil: ASSET_BASE + "characters/seungyu_sil.webp",
  senior_sil: ASSET_BASE + "characters/senior_sil.webp",
  yeongwoong: ASSET_BASE + "characters/yeongwoong.webp",
  ganghee: ASSET_BASE + "characters/ganghee.webp",
  ganghee2: ASSET_BASE + "characters/ganghee2.png",
  yoondaewoong: ASSET_BASE + "characters/yoondaewoong.webp",
};

const BG = {
  true_seungyu_cg: ASSET_BASE + "backgrounds/true_seungyu_cg.png",
  true_ganghee_cg: ASSET_BASE + "backgrounds/true_ganghee_cg.png",
  true_yeongwoong_cg: ASSET_BASE + "backgrounds/true_yeongwoong_cg.png",
  true_juheon_cg: ASSET_BASE + "backgrounds/true_juheon_cg.png",
  collector_cafe: ASSET_BASE + "backgrounds/collector_cafe.png",
  collector_boxing_gym: ASSET_BASE + "backgrounds/collector_boxing_gym.png",
  collector_spring: ASSET_BASE + "backgrounds/collector_spring.png",
  juheon_hidden_end_photo: ASSET_BASE + "backgrounds/juheon_hidden_end_photo.png",
  ganghee_end_photo: ASSET_BASE + "backgrounds/ganghee_end_photo.png",
  normal_end_photo: ASSET_BASE + "backgrounds/normal_end_photo.png",
  juheon_end_photo: ASSET_BASE + "backgrounds/juheon_end_photo.png",
  yeongwoong_end_photo: ASSET_BASE + "backgrounds/yeongwoong_end_photo.png",
  classroom: ASSET_BASE + "backgrounds/classroom.jpg",
  hagutgil: ASSET_BASE + "backgrounds/hagutgil.jpg",
  gym: ASSET_BASE + "backgrounds/gym.jpg",
  field: ASSET_BASE + "backgrounds/field.jpg",
  banjukdong: ASSET_BASE + "backgrounds/banjukdong.jpg",
  alley: ASSET_BASE + "backgrounds/alley.jpg",
  schoolgate: ASSET_BASE + "backgrounds/schoolgate.jpg",
  end1_cg: ASSET_BASE + "backgrounds/end1_cg.jpg",
  seungyu_ending: ASSET_BASE + "backgrounds/seungyu_ending.jpg",
};
const PLAYER = { name: '__PLAYER_NAME__', sub: '', key: null, hideSub: true };
const JUHEON = { name: '송주헌', sub: '학생', key: 'juheon' };
const SEUNGYU = { name: '강승유', sub: '학생', key: 'seungyu' };
const YEONGWOONG = { name: '이영웅', sub: '영웅', key: 'yeongwoong' };
const GANGHEE = { name: '강 희', sub: '1반 학생', key: 'ganghee' };
const GANGHEE2 = { name: '강 희', sub: '1반 학생', key: 'ganghee2' };
const SEUNGYU_ADULT = { name: '강승유', sub: '복싱선수', key: 'seungyu' };
const GANGHEE_ADULT = { name: '강 희', sub: '의사', key: 'ganghee' };
const JUHEON_ADULT = { name: '송주헌', sub: 'ester CAD CEO', key: 'juheon' };
const JUHEON_SEUNGYU = { name: '송주헌, 강승유', sub: '학생', key: null };
const UNKNOWN1 = { name: '???', sub: '', key: 'seungyu_sil' };
const UNKNOWN2 = { name: '???', sub: '', key: 'juheon_sil' };


const TRUE_ENDING_CG = [
  {
    id:'true_seungyu',
    label:'TRUE ENDING CG · 강승유',
    src:BG.true_seungyu_cg,
  },
  {
    id:'true_ganghee',
    label:'TRUE ENDING CG · 강 희',
    src:BG.true_ganghee_cg,
  },
  {
    id:'true_yeongwoong',
    label:'TRUE ENDING CG · 이영웅',
    src:BG.true_yeongwoong_cg,
  },
  {
    id:'true_juheon',
    label:'TRUE ENDING CG · 송주헌',
    src:BG.true_juheon_cg,
  },
];

/* =========================================================
   씬 1 - 교실
   ========================================================= */
const SCENE1_START = [
  {type:'narration', text:'교실 안에는 학생들이 두세 명뿐이다. 몇몇 아이들은 창가에 앉아 쏟아지는 햇볕을 맞이하며 독서에 빠져 있다.', stopBgm:true},
  {type:'narration', text:'사각거리는 책장 넘어가는 소리가 공기를 채운다. 그와 동시에 먼 운동장에서 아이들이 웅성거리는 소리가 창문 너머로 들려온다.'},
  {type:'narration', text:'그 평화로운 풍경 한가운데, 창가 맨 뒷자리에 송주헌이 앉아 있다.', chars:{left:null, right:'juheon'}, bgm:'You are the One'},
  {type:'narration', text:'항상 무표정한 얼굴로 창밖만 바라보던 그가, 오늘은 웬일인지 책 한 권을 손에 쥐고 있다.'},
  {type:'thought', text:'(주헌이가 책을 읽고 있는 것은 처음 보는 것 같은데..... 무슨 책이지?)'},
  {type:'thought', text:'(호기심에 슬쩍 훔쳐보니, 그가 읽고 있는 것은 내가 가장 좋아하는 작가의 신작 소설이다.)'},
  {type:'thought', text:'(흥분감에 심장이 조금 빠르게 뛰기 시작함이 느껴온다.)'},
  {type:'thought', text:'(그리고 나의 시선을 읽었는지 내 쪽으로 시선을 보내다 우연히 눈이 마주쳤다.)'},
];

const SCENE1_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    {label:'① 용기를 내어 다가가 말을 건다.', key:'1', affection:-1},
    {label:'② 멀리서 손짓으로 인사한다.', key:'2', affection:-1},
    {label:'③ 자연스레 안본척 하면서 돌아선다.', key:'3', affection:+1},
  ]
};

const SCENE1_BRANCHES = {
  '1': [
    {type:'narration', text:'내가 주헌의 자리 앞으로 조심스럽게 다가간다.'},
    {type:'narration', text:'그는 내가 다가오는 것을 알아챘는지 읽던 책을 마무리하고 가만히 기다리고 있다.'},
    {type:'line', speaker:PLAYER, text:'안녕? 그거 내가 아는 책 같은데, OOO작가의 XXX 맞지?'},
    {type:'line', speaker:JUHEON, text:'아니야.'},
    {type:'narration', text:'주헌이 감정을 배제하며 말했다. 시선은 아무것도 없는 정면을 바라보면서 말이다.'},
    {type:'narration', text:'그리고 그다음 추가적인 말이나 인사 없이 그대로 교실 밖으로 떠나버렸다.'},
    {type:'narration', text:'그가 떠나자 책상에 놓여있는 책을 들쳐봤고, OOO작가의 XXX이 맞다...'},
    {type:'narration', text:'여름이었다.'},
    {type:'thought', text:'말 거는 것을 싫어하는 모양인가보다. X발...'},
  ],
  '2': [
    {type:'narration', text:'내가 손을 가볍게 들어 좌우로 두 번 휘젓는다.'},
    {type:'narration', text:'얼굴은 미소를 띄우고 눈을 조금 크게 떠본다.'},
    {type:'narration', text:'이를 봤는지 그는 시선을 나에게 고정한다. 그리고..'},
    {type:'narration', text:'인상을.. 찡그린다?'},
    {type:'narration', text:'그리고 그는 다시 시선을 책으로 돌려 읽던 부분을 마저 읽는 모양이다.'},
    {type:'thought', text:'말 거는 것을 싫어하는 모양인가보다.'},
  ],
  '3': [
    {type:'narration', text:'내가 헛기침을 하면서, 목을 한번 꺾어주고 스트레칭을 하며 돌아서 교실 밖으로 나간다.'},
    {type:'narration', text:'많이 해본 솜씨인지 숙련도가 높다.'},
    {type:'narration', text:'그 때, 뒤에서 누군가가 피식, 짧게 웃는 소리가 들려온다.'},
    {type:'narration', text:'나는 기분이 상하고 또 누군지 궁금해서 돌아본다.'},
    {type:'narration', text:'주헌의 얼굴에 미미한 웃음을 남긴 채로 다시 책을 읽고 있다.'},
    {type:'narration', text:'분명 그가 웃었던 것 같다.'},
    {type:'thought', text:'나는 그래도 괜찮은 신호를 받은 것 같다는 생각을 하며 유유히 화장실로 들어간다.'},
  ]
};

/* =========================================================
   씬 2 - 하굣길
   ========================================================= */

// choice1이 '1' 또는 '2'일 때 공통으로 이어지는 인트로
const SCENE2_INTRO_12 = [
  {type:'narration', text:'여름인지라 저녁시간이 돼도 여전히 덥다.', clearBg:true, noBgFade:true, chars:{left:null, right:null}, stopBgm:true},
  {type:'narration', text:'노을이 예쁘장하게 일고 여러 자연 백색 소음들이 들려온다.', showBg:'hagutgil', chars:{left:null, right:null}},
  {type:'narration', text:'아까 주헌이에게 퇴짜맞은 뒤로 그에게 한마디 하지 않고, 수업만 듣다가 학교 일정이 마무리되었다.'},
  {type:'thought', text:'내가 문제였던걸까.'},
  {type:'thought', text:'몇번이고 생각해보지만 내 문제가 아니라 그 애가 성격이 좀 뒤틀린 것 같다.'},
  {type:'narration', text:'(...)'},
  {type:'narration', text:'그렇게 혼자 하교를 하던 중 익숙한 실루엣을 발견했다.'},
  {type:'narration', text:'주헌이와 승유가 나란히 걷고 있었다.'},
  {type:'narration', text:'이전 상황 때문에 나로서도 기분이 조금 상한지라 그냥 지나쳐 갔다.'},
  {type:'narration', text:'그 순간, 뒤에서 강승유가 나를 큰소리로 부른다.', chars:{left:'seungyu', right:'juheon'}},
  {type:'line', speaker:SEUNGYU, text:'야! __PLAYER_NAME__! 같이가자~'},
];

const SCENE2_CHOICE_12 = {
  prompt: '어떻게 할까?',
  options: [
    {label:'① 모른 척하며 집으로 질주한다.', key:'1'},
    {label:'② 승유를 반갑게 맞이하며 합류한다.', key:'2'},
    {label:'③ 일단 모른 척하고 "다시 말 걸면 그때 돌아봐야지." 하고 생각한다.', key:'3'},
  ]
};

// choice1이 '3'일 때 이어지는 인트로 (분위기가 다름)
const SCENE2_INTRO_3 = [
  {type:'narration', text:'여름인지라 저녁시간이 돼도 여전히 덥다.', clearBg:true, noBgFade:true, chars:{left:null, right:null}, stopBgm:true},
  {type:'narration', text:'노을이 예쁘장하게 일고 여러 자연 백색 소음들이 들려온다.', showBg:'hagutgil', chars:{left:null, right:null}, bgm:'Lovely-Fidelity'},
  {type:'thought', text:'몇 시간 전 주헌이의 웃음이 머릿속에 맴돈다.'},
  {type:'narration', text:'그렇지만 뒤로 그에게 한마디도 하지 않았던 터라, 다시 접점이 생기기를 기대하며 수업만 듣다가 학교 일정이 마무리되었다.'},
  {type:'thought', text:'흐뭇하다.'},
  {type:'narration', text:'(...)'},
  {type:'narration', text:'그 뒤, 혼자 하교를 하던 중 익숙한 실루엣을 발견했다.'},
  {type:'narration', text:'주헌이와 승유가 나란히 걷고 있었다.'},
  {type:'line', speaker:PLAYER, text:'승유야. 안녕!'},
  {type:'narration', text:'평소에 승유랑은 그래도 친하게 지내던 터라 용기내어 말을 걸어본다.'},
  {type:'narration', text:'그 순간, 강승유와 송주헌이 뒤를 돌더니 인사를 한다.', chars:{left:'seungyu', right:'juheon'}},
  {type:'line', speaker:JUHEON_SEUNGYU, text:'야 ㅎㅇ?'},
];

const SCENE2_CHOICE_3 = {
  prompt: '어떻게 할까?',
  options: [
    {label:'① 어. 다들 안녕? 어디 가는 중?', key:'1'},
    {label:'② 아 XX X같네, 넌 뭐야? XX', key:'2'},
  ]
};

// (choice1, choice2) 조합별 엔딩
const ENDINGS = {
  '1-1': {
    juheon:-1, seungyu:-1,
    lines:[
      {type:'narration', text:'나는 아까 주헌의 태도에 기분이 상해 같이 있는게 싫어서 도망쳐 나왔다.', chars:{left:null, right:null}},
      {type:'narration', text:'뒤에서 승유가 나를 부르는 소리가 몇 번 더 있었지만, 그 후 아무 소리도 들리지 않았다.'},
      {type:'narration', text:'누구보다 빠르게 뛰쳐나왔기 때문이다.'},
      {type:'narration', text:'(...)'},
      {type:'narration', text:'숨이 차서 인근 빌라 뒤에서 숨을 고르는 중에 어디서 익숙한 목소리로 소리가 들려왔다.', chars:{left:'seungyu_sil', right:'juheon_sil'}},
      {type:'line', speaker:UNKNOWN1, text:'아니 걔 그냥 도망가는데? 뭐냐 진짜?'},
      {type:'line', speaker:UNKNOWN2, text:'아, 점심시간 때, 나 기분이 좀 안좋았어서 __PLAYER_NAME__한테 좀 마음 상하게 한 것 같아서, 좀 친해지려고 불러봤는데 도망가네..'},
      {type:'line', speaker:UNKNOWN2, text:'아까는 좀 활발한 애처럼 굴더니 지금은 왜 꽁무니 빼지 좀, 그렇다..'},
      {type:'line', speaker:UNKNOWN1, text:'그러냐 ㅋㅋ. 안되겠다. 내가 왕따시켜야겠다.'},
      {type:'line', speaker:UNKNOWN2, text:'그러지마..'},
      {type:'line', speaker:UNKNOWN1, text:'농담이야 농담 ㅋㅋ'},
      {type:'narration', text:'(...)', chars:{left:null, right:null}, stopBgm:true},
      {type:'narration', text:'그리고 소음이 잠잠해진다. 멀리 떠나간 모양이다.'},
      {type:'thought', text:'하.. 어쩌지..'},
      {type:'narration', text:'그렇게 그냥 집에 돌아왔다.'},
    ]
  },
  '2-1': null, // 아래에서 1-1과 동일하게 채움
  '1-2': {
    juheon:+1, seungyu:+1,
    lines:[
      {type:'line', speaker:PLAYER, text:'어.. 어! 승유 안녕?!'},
      {type:'narration', text:'약간, 당황한 톤으로 내 입에서 말이 나온다. 그러자 그 둘은 호탕하게 웃는다.'},
      {type:'narration', text:'뭐지.. 하는 생각으로 일단 합류한다.'},
      {type:'narration', text:'그때, 주헌이가 말을 건다.', chars:{left:'seungyu', right:'juheon'}},
      {type:'line', speaker:JUHEON, text:'아까는 미안해. 좀 기분이 안좋았어서.'},
      {type:'line', speaker:JUHEON, text:'너 성격 맘에 든다. 적극적이네.'},
      {type:'line', speaker:SEUNGYU, text:'그래~ 원래 낯은 많이 가려도 괜찮은 애야.'},
      {type:'line', speaker:SEUNGYU, text:'그보다 넌 어디를 그렇게 빨리 가?'},
      {type:'line', speaker:PLAYER, text:'어! 나 집가~ 그냥 원래 걸음이 빨라서 ㅋㅋ'},
      {type:'line', speaker:JUHEON_SEUNGYU, text:'그래 내일보자~'},
      {type:'narration', text:'그렇게 작별인사를 한 뒤 집에 돌아왔다.', stopBgm:true},
    ]
  },
  '2-2': {
    juheon:-1, seungyu:+1,
    lines:[
      {type:'line', speaker:PLAYER, text:'어.. 어! 승유 안녕?!'},
      {type:'narration', text:'약간, 당황한 톤으로 내 입에서 말이 나온다. 그러자 그 둘은 호탕하게 웃는다.'},
      {type:'narration', text:'뭐지.. 하는 생각으로 일단 합류한다.'},
      {type:'narration', text:'그때, 주헌이가 말을 건다.', chars:{left:'seungyu', right:'juheon'}},
      {type:'line', speaker:JUHEON, text:'아까는 미안해. 좀 기분이 안좋았어서.'},
      {type:'line', speaker:SEUNGYU, text:'그래~ 원래 낯은 많이 가려도 괜찮은 애야. 그보다 넌 어디를 그렇게 빨리 가?'},
      {type:'line', speaker:PLAYER, text:'어! 나 집가~ 그냥 원래 걸음이 빨라서 ㅋㅋ'},
      {type:'line', speaker:SEUNGYU, text:'그래 내일보자~'},
      {type:'narration', text:'그렇게 작별인사를 한 뒤 집에 돌아왔다.', stopBgm:true},
    ]
  },
  '1-3': {
    juheon:-1, seungyu:0,
    lines:[
      {type:'narration', text:'(...)', chars:{left:null, right:null}},
      {type:'narration', text:'(...)'},
      {type:'narration', text:'(..?)'},
      {type:'thought', text:'근데, 다시 말 안 걸었다. 하..!'},
      {type:'narration', text:'그렇게 그냥 집에 돌아왔다.', stopBgm:true},
    ]
  },
  '2-3': {
    juheon:+1, seungyu:0,
    lines:[
      {type:'narration', text:'(...)', chars:{left:null, right:null}},
      {type:'narration', text:'(...)'},
      {type:'narration', text:'(..?)'},
      {type:'thought', text:'근데, 다시 말 안 걸었다. 하..!'},
      {type:'narration', text:'그 순간 뒤에서 말소리가 들려왔다.', chars:{left:null, right:'juheon'}},
      {type:'line', speaker:JUHEON, text:'쟤 성격은 파악한거 같다. 괜찮은 애 같네.'},
      {type:'narration', text:'그 뒤, 집에 돌아왔다.', stopBgm:true},
    ]
  },
  '3-1': {
    juheon:+1, seungyu:+1,
    lines:[
      {type:'narration', text:'긍정적으로 보이는 표정과 함께, 답신은 먼저 승유에게서 돌아왔다.'},
      {type:'line', speaker:SEUNGYU, text:'우리는 할거 없어서 그냥 하교하는 중임 ㅇㅇ'},
      {type:'narration', text:'그 뒤, 주헌이가 이어서 말했다.'},
      {type:'line', speaker:JUHEON, text:'어. 넌 어디가는데?'},
      {type:'line', speaker:JUHEON, text:'그나저나 아까 반에서 제일 늦게 나오지 않았나? 빠르네 너?'},
      {type:'line', speaker:PLAYER, text:'어! 나 집가~ 그냥 원래 걸음이 좀 빨라서 ㅋㅋ'},
      {type:'narration', text:'그렇게 우리는 합류해서 여러 잡 소재들로 시시덕 거리면서 같이 하교하였다.'},
      {type:'narration', text:'오늘 좀 괜찮게 하루를 보냈을지도 모르겠다.'},
      {type:'narration', text:'그렇게 작별인사를 한 뒤 집에 돌아왔다.', stopBgm:true},
    ]
  },
  '3-2': {
    gameOver:true,
    lines:[
      {type:'line', speaker:PLAYER, text:'아, XX…… 진짜 X같네. 넌 또 뭔데 난데없이 끼어들고 난리야, XX?', stopBgm:true},
      {type:'narration', text:'짜증이 머릿끝까지 솟구친 나는 순간적으로 이성을 잃고 홧김에 거친 욕설을 쏟아냈다.'},
      {type:'narration', text:'내 거친 언사에 순간 주변의 공기가 거짓말처럼 차갑게 식어 내렸다.', clearBg:true, noBgFade:true, chars:{left:null, right:null}},
      {type:'narration', text:'하지만 마주 선 승유의 표정은 분노로 일그러지기는커녕, 오히려 어처구니없다는 듯 차갑게 식어 내려가고 있었다.'},
      {type:'narration', text:'승유가 아무 말 없이 무심하게 자신의 자켓 옷매무새를 가다듬고 가방을 바닥에 스르륵 내려놓았다.'},
      {type:'narration', text:'그 순간, 녀석의 넓은 어깨와 굳은살 박힌 주먹, 그리고 오랫동안 단련된 특유의 매서운 체구와 눈빛이 그제야 눈에 들어왔다.', showBg:'end1_cg', noBgFade:true, impact:true, chars:{left:null, right:null}, bgm:'Dinner Punch'},
      {type:'narration', text:'(……!!!)'},
      {type:'narration', text:'(아.)'},
      {type:'narration', text:'생각났다. 머릿속에 까맣게 잊고 있던 치명적인 사실 하나가 뒤늦게 번개처럼 뇌리를 스쳤다.'},
      {type:'thought', text:'강승유…… 이 새끼, 중학교 때부터 도 대회와 전국 체전을 싹쓸이했던 아마추어 복싱 선수 출신이었지.'},
      {type:'narration', text:'깨달았을 때는 이미 모든 게 한참 늦어 있었다.'},
      {type:'narration', text:'말이 끝나기도 전에 바람을 가르는 날카로운 파공음이 귀를 찢었다.'},
      {type:'narration', text:'원, 투.'},
      {type:'narration', text:'시야가 기괴하게 뒤틀리며 눈앞에서 노란 번개가 튀었다.'},
      {type:'narration', text:'복부에 꽂히는 묵직한 딥 바디 블로우에 숨이 턱 막히며 허리가 절로 꺾였고,'},
      {type:'narration', text:'곧이어 턱관절을 정확히 흔드는 숏 훅이 날아왔다.'},
      {type:'narration', text:'가드조차 올리지 못한 채, 나는 바닥을 구르며 비명조차 지르지 못하고 허우적거렸다.'},
      {type:'narration', text:'그렇게 나는 처참하고 완벽하게 개쳐맞았다.'},
      {type:'narration', text:'하지만 진짜 지옥은 그 폭행이 끝난 뒤부터 시작되었다.'},
      {type:'narration', text:'그날 사건은 순식간에 온 학교에 소문이 퍼졌다.'},
      {type:'narration', text:'선제 시비를 걸었다가 복싱부 출신에게 일방적으로 두들겨 맞은 한심한 녀석.'},
      {type:'narration', text:'아이들의 차가운 시선과 야유, 손가락질 속에서 나는 순식간에 교내 최하위 계급으로 추락했고, 사실상 완벽하게 매장당했다.'},
      {type:'narration', text:'어딜 가든 귓가를 맴도는 비웃음 소리, 아무도 짝을 해주려 하지 않는 고립감.'},
      {type:'narration', text:'홧김에 뱉은 욕설 한마디와 한순간의 자만심이 불러온 결과는 너무나도 참혹했다.'},
      {type:'narration', text:'내 남은 학교생활은 그야말로 벗어날 수 없는 지옥이 되었다.'},
    ]
  },
};
ENDINGS['2-1'] = ENDINGS['1-1']; // 텍스트 동일, 선택1과 무관

/* =========================================================
   씬 3 - 학교 강당 (체육 풋살 시간) - 루트 1 (송주헌 호감도 음수)
   ========================================================= */
const SCENE3_INTRO = [
  {type:'narration', text:'연속되는 자습 시간 속에 지루함을 달래줄 체육 시간이 시작됐다.', showBg:'gym', chars:{left:null, right:null}, bgm:'Hello SY'},
  {type:'narration', text:'내리쬐는 태양볕이 운동장 모래바람과 만나 숨이 턱턱 막히는 날씨지만 실내 풋살이라 좋다.'},
  {type:'narration', text:'팀 조 편성이 끝났다.'},
  {type:'narration', text:'주헌의 모습은 운동장 구석 스탠드 그늘 밑에 누워있는 것 말고는 보이지 않는다.'},
  {type:'thought', text:'나를 철저히 외면하는 분위기다.'},
  {type:'narration', text:'하지만 내 옆에는 든든한 피지컬의 강승유가 서 있다.', chars:{left:'seungyu', right:null}},
  {type:'thought', text:'이 녀석만큼은 믿을 만하다.'},
  {type:'line', speaker:SEUNGYU, text:'야, __PLAYER_NAME__! 우리 같은 팀이네?'},
  {type:'line', speaker:SEUNGYU, text:'오늘 내가 뒤에서 카보베르데 골키퍼, "보지냐"로 다 막아줄 테니까 넌 전방에서 공격만 해라. 오케이?'},
  {type:'thought', text:'수행평가 점수가 걸려있으니 대충 뛸 수도 없다. 이 상황에서 나는 어떻게 행동해야 할까?'},
];

const SCENE3_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    {label:'① 승유의 든든한 리드에 맞춰 적극적으로 침투 패스를 찔러준다.', key:'1'},
    {label:'② "내 사전에 패스란 없다." "라민 야말"에 빙의해 무지성 드리블로 돌파한다.', key:'2'},
    {label:'③ 공이 무서우니 골대 근처에서 숨만 쉬며 \'홍명보\' 전술을 펼친다.', key:'3'},
  ]
};

const SCENE3_BRANCHES = {
  '1': {
    seungyu:+1, yeongwoong:-1,
    lines:[
      {type:'narration', text:'(...)'},
      {type:'narration', text:'(...)'},
      {type:'narration', text:'(!!!)'},
      {type:'narration', text:'승유는 골키퍼였다. 나는 전방 압박 공격수로서 그의 리드 소리가 들리지 않는다.'},
      {type:'narration', text:'하지만, 나는 빈 공간으로 눈치 빠르게 질주했다.'},
      {type:'narration', text:'그 후 나는 예리한 침투 패스를 팀원에게 하였다. 팀원은 패스를 받아 가볍게 툭 차 넣었다.'},
      {type:'narration', text:'강당 계단에서 지켜보던 반 애들, 심지어 적팀 3학년 선배들까지 오오- 하며 어수선한 분위기로 박수를 보낸다.'},
      {type:'line', speaker:SEUNGYU, text:'나이스! __PLAYER_NAME__ 너 축구 좀 치는데? 호흡 지렸다 방금!'},
      {type:'line', speaker:SEUNGYU, text:'근데 내 콜 못 들었어?'},
      {type:'line', speaker:PLAYER, text:'멀어서 안들렸어! 그래도 이겨서 좋네.'},
      {type:'narration', text:'승유는 수긍했고, 그래도 골을 넣어서 좋은지 별 신경을 안쓰는 것 같다.'},
      {type:'narration', text:'한편, 우리 반 관객 중 주헌이와 눈이 마주친 것 같기도 하지만, 그는 이내 고개를 돌려버렸다.'},
      {type:'thought', text:'아무래도 상관없다. 오늘 팀플레이는 완벽했으니까.'},
      {type:'narration', text:'이번 학기 체육 수행평가는 안심해도 될 것 같다.'},
      {type:'thought', text:'그런데 저기 보이는 상대 골기퍼 3학년 선배의 기분이 안좋아 보인다?', chars:{left:'seungyu', right:'senior_sil'}, stopBgm:true},
    ]
  },
  '2': {
    seungyu:-1, yeongwoong:+1,
    lines:[
      {type:'narration', text:'승유를 비롯한 반 아이들이 패스하라고 뒤에서 목이 터져라 소리를 지르지만, 며칠 전 본 월드컵 경기의 라민 야말만 생각날 뿐이다.'},
      {type:'narration', text:'또한, 내 귀에는 관중들의 웅장한 함성소리가 들린다.'},
      {type:'narration', text:'수비수 세 명을 앞에 두고 화려한 헛다리 짚기를 시도했다.'},
      {type:'narration', text:'그리고 내 다리가 먼저 꼬였다. 우스꽝스럽다.'},
      {type:'narration', text:'바로 공을 뺏기고 패배했다.'},
      {type:'thought', text:'하...'},
      {type:'line', speaker:SEUNGYU, text:'야... 괜찮냐? 아니 패스를 하라니까 왜 혼자 몸개그를 하고 있어... 진짜 골 때리는 놈이네 이거 ㅋㅋㅋ'},
      {type:'narration', text:'승유가 꿀잼 직관을 했다는 표정으로 큭큭대며 나를 일으켜 세워준다.'},
      {type:'thought', text:'아픔보다 쪽팔림이 더 크게 밀려온다.'},
      {type:'narration', text:'그렇게 말하는 승유의 표정이 왠지 모르게 열받아보인다..'},
      {type:'narration', text:'한편, 상대편 3학년 선배들은 축제 분위기이다.', chars:{left:'seungyu', right:'senior_sil'}},
      {type:'narration', text:'그 중, 나를 유독 집중해서 보며 웃고있는 선배가 눈에 들어온다.'},
      {type:'narration', text:'이번 학기 체육 수행평가는 조금 힘들 것 같다.', stopBgm:true},
    ]
  },
  '3': {
    seungyu:0, yeongwoong:0,
    lines:[
      {type:'narration', text:'체육 시간에 굳이 땀을 흘리며 칼로리를 소모해야 할 이유를 찾지 못했다.'},
      {type:'narration', text:'나는 우리편 골대 근처 구석탱이에서 마치 바람에 흔들리는 갈대처럼 조용히 서 있었다.'},
      {type:'line', speaker:SEUNGYU, text:'야! __PLAYER_NAME__! 너 거기서 뭐 해? 설영우 따라하냐? 좀 뛰어봐!'},
      {type:'line', speaker:PLAYER, text:'아, 승유야. 나 고려대 입학하는게 꿈이거든 잘 알아봤어.'},
      {type:'narration', text:'개소리를 지껄여본다. 그냥 뛰기 귀찮을 뿐이다.'},
      {type:'narration', text:'결국, 아무런 기여 없이 경기가 끝났다. 무승부로 막을 내렸다.'},
      {type:'narration', text:'승유가 황당하다는 듯 한숨을 쉬며 내 어깨를 툭 친다.', stopBgm:true},
    ]
  },
};

/* =========================================================
   씬 3b - 학교 강당 (체육 풋살 시간) - 씬2 종료 시 송주헌 호감도 0 또는 양수
   ========================================================= */
const SCENE3B_INTRO = [
  {type:'narration', text:'연속되는 자습 시간 속에 지루함을 달래줄 체육 시간이 시작됐다.', showBg:'gym', chars:{left:null, right:null}, bgm:'Hello SY'},
  {type:'narration', text:'내리쬐는 태양볕이 운동장 모래바람과 만나 숨이 턱턱 막히는 날씨지만 실내 풋살이라 좋다.'},
  {type:'narration', text:'팀 조 편성이 끝났다. 풋살 수행평가 당일이라 약간 떨리기도 한다.'},
  {type:'narration', text:'그런데 상대팀 라인업이 예사롭지 않다.'},
  {type:'narration', text:'강승유, 그리고 무려 \'송주헌\'이 쌍두마차로 팀을 리드하고 있다.', chars:{left:'seungyu', right:'juheon'}},
  {type:'narration', text:'항상 귀찮은 표정으로 교실 창밖만 보던 주헌이지만 의외로 풋살을 잘한다.'},
  {type:'narration', text:'오늘은 웬일인지 적극적으로 체육복 소매를 걷어붙이며 가벼운 스트레칭을 하고 있다.'},
  {type:'narration', text:'그에 반해, 우리팀은 강희를 비롯한 어중이떠중이들밖에 없었다.'},
  {type:'narration', text:'휘슬이 불려 경기가 시작하기를 기다리는 중 저 편에서 목소리가 들려왔다.'},
  {type:'line', speaker:SEUNGYU, text:'오, 라인업 대박인데? 야, 주헌아. 너 오늘 공격할래? "메시"처럼 활약해봐!'},
  {type:'line', speaker:JUHEON, text:'아무래도 상관없어. 빨리 끝내고 쉬자.'},
  {type:'narration', text:'귀찮다는 듯 무심하게 뱉은 말치고는 주헌이의 눈빛에 묘한 승부욕이 서려 있는 듯하다.'},
  {type:'thought', text:'아무래도 이 게임을 어떻게 해보기 위해 전략이 필요할 것 같다.'},
];

const SCENE3B_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    {label:'① 같은 팀 강희를 칭찬해주며 승리를 기원한다.', key:'1'},
    {label:'② "홍명보"에 빙의해 백패스 전략을 팀원들에게 알린다.', key:'2'},
    {label:'③ "내 사전에 패스란 없다." "라민 야말"에 빙의해 묵묵히 경기할 마음을 먹는다.', key:'3'},
  ]
};

const SCENE3B_BRANCHES = {
  '1': {
    juheon:0, seungyu:0, ganghee:+1,
    lines:[
      {type:'line', speaker:PLAYER, text:'희야! 힘내보자! 너 수비 완전 김민재급이던데, 우리 할 수 있어!', stopBgm:true},
      {type:'narration', text:'그 말이 끝나자마자, 강희는 나에게 얼굴을 돌리고 성큼성큼 다가온다.', chars:{left:null, right:'ganghee'}},
      {type:'narration', text:'그 후, 얼굴에 희번뜩한 미소를 띄우며 말을... 말을 하기 시작했다.', chars:{left:null, right:'ganghee2'}, bgm:'Kurumi BGM'},
      {type:'line', speaker:GANGHEE2, text:'어? 그래? 그러자. 우리 잘할 수 있어. 아니, 무엇보다 내가 잘 할 수 있지. 나는 잘하니까.'},
      {type:'line', speaker:GANGHEE2, text:'어제 다른 반이랑 경기한 거 봤어? 그때 내가 상대편 공 다 뺐어서 점유율 개발랐었는데.'},
      {type:'line', speaker:GANGHEE2, text:'그때 더군다나 3학년 선배들이랑 해서 벨런스도 안 맞을뻔했지 뭐야.'},
      {type:'line', speaker:GANGHEE2, text:'왜 안 맞은게 아니고, 안 맞을 뻔했냐고? 내가 우리 팀에 떡하니 있는데 어떡해. 상대 팀도 받아들여야지.'},
      {type:'line', speaker:GANGHEE2, text:'그나저나 이러고 저러고 그러고 이래서 이렇고...'},
      {type:'narration', text:'(...)'},
      {type:'narration', text:'(...)'},
      {type:'thought', text:'난 한마디 했다.', stopBgm:true},
    ]
  },
  '2': {
    juheon:0, seungyu:0, ganghee:0,
    lines:[
      {type:'line', speaker:PLAYER, text:'하지만 저희는 준비하는 과정에 있어서는 \'그런 것들을 운동장에 얼마만큼 잘 구현시킬 수 있느냐\'를 가지고 준비를 하기 때문에,'},
      {type:'line', speaker:PLAYER, text:'결과를 미리 알고 한다고 하면 그 방법대로 하겠지만 그렇지 않고 이런 식으로 결과가 나오면 물론 여러 가지 이유를 댈 수도 있습니다.'},
      {type:'line', speaker:PLAYER, text:'하지만 이런 큰 무대에서 했던 결과는 저는 모든 게 감독의 책임이라고 생각해요.'},
      {type:'line', speaker:PLAYER, text:'여러분 모두 백패스 전략을 사용합시다.'},
      {type:'narration', text:'(...)'},
      {type:'narration', text:'(...)'},
      {type:'narration', text:'아무도 반응을 안해줬다.'},
      {type:'narration', text:'그렇게 휘슬이 경기 시작을 알리고, 우리팀 상대팀 너나 할 것 없이 모두 열심히 경기를 뛰었다.'},
      {type:'narration', text:'경기는 무승부로 막을 내렸고, 수행평가에서 감점 당하지 않을 수 있었다.', stopBgm:true},
    ]
  },
  '3': {
    juheon:0, seungyu:+1, ganghee:0,
    lines:[
      {type:'thought', text:'주인공은 과묵한 법. 나는 휘슬이 경기 시작을 알릴 때까지 잠자코 있었다.'},
      {type:'narration', text:'그리고 휘슬이 경기 시작을 알렸다.'},
      {type:'narration', text:'우리 팀 상대 팀 너나 할 것 없이 모두 열심히 경기를 뛰었다.'},
      {type:'narration', text:'마침내 내게로 공이 왔다.'},
      {type:'thought', text:'시작해볼까.'},
      {type:'narration', text:'(!!!)', stopBgm:true},
      {type:'narration', text:'(...)'},
      {type:'thought', text:'그렇다. 현실은 판타지 세계가 아니다. 빙의할 수 있을 리가 없다.', bgm:'Gang X Hee'},
      {type:'narration', text:'그렇게 다리가 꼬여 허무하게 실점하고 말았다. 우리 팀의 원망의 눈초리를 너무도 쉽게 여기저기에서 읽어낼 수 있었다.'},
      {type:'line', speaker:SEUNGYU, text:'ㅋㅋ __PLAYER_NAME__! 고마워~'},
      {type:'narration', text:'강승유가 나를 멀찍이 떨어져서 재밌다는 듯한 눈빛으로 쳐다보고 있다.'},
      {type:'narration', text:'최악의 상황이 됬지만 승유는 즐거워 보인다.'},
      {type:'thought', text:'내 모습은 비참했지만, 이 정도면 청신호로 여겨지니 일단은 이걸로 된걸까.', stopBgm:true},
    ]
  },
};

/* =========================================================
   씬 4b - 학교 운동장 (부고컵 축구 대회) - 씬3b 이후, 주헌 호감도 양수 & 강희 호감도 비양수
   ========================================================= */
const SCENE4B_INTRO = [
  {type:'narration', text:'얼마 후, 학교 최대 행사 중 하나인 부고컵 축구 대회날이 다가왔다.', showBg:'field', bgm:'FUNNY'},
  {type:'narration', text:'우리 편은 강승유, 송주헌, 강희와 함께 최고의 팀으로 구성되었다.', chars:{left:'seungyu', right:'juheon'}},
  {type:'narration', text:'결승전까지 쉽게 올라갔고, 마침내 결승날 경기 시작 전 몸을 풀고 있는 상황 앞에 마주했다.'},
  {type:'narration', text:'얼마 후, 경기의 시작을 알리는 휘슬이 울렸다.'},
  {type:'thought', text:'나는 내 포지션에서 최선을 다하겠다고 마음을 먹었다.'},
  {type:'thought', text:'그리고 또, 잘 해야겠다고도 마음을 먹었다.'},
  {type:'line', speaker:SEUNGYU, text:'다같이 힘내보자!'},
  {type:'line', speaker:JUHEON, text:'아무래도 결승이니까 이기고 싶네.'},
  {type:'narration', text:'그 후, 몸을 다 풀고 라인업으로 상대편과 마주했다.'},
  {type:'narration', text:'상대는 2학년 3반, 역시 강팀답게 결승전에서 붙었다.'},
  {type:'narration', text:'이제 경기가 시작됐다. 전과는 다른 수준 높은 경기가 경기장을 가득 채웠다.'},
  {type:'narration', text:'그 순간 상대방 수비수가 강승유의 발목을 노리는 백태클을 했고, 그대로 그 수비수는 퇴장당했다.'},
  {type:'narration', text:'페널티킥 상황이다.'},
  {type:'narration', text:'원래 이런 상황에서는 승유가 잘 차주는데 승유의 부상이 심각하다.'},
  {type:'line', speaker:SEUNGYU, text:'아.. 좀 제대로 걸려서 이거 내가 차기 힘들 것 같은데 ㅋㅋ..'},
  {type:'narration', text:'시간이 없다. 누군가가 공을 차야한다.'},
  {type:'thought', text:'나의 전략 분석에 의하면 다음과 같이 해석된다.'},
  {type:'thought', text:'강승유의 성공률은 80%, 하지만 부상당한 상태이고,'},
  {type:'thought', text:'송주헌의 성공률은 40%에 경기 막바지라 조금 지쳐 보인다.'},
  {type:'thought', text:'그리고 강 희의 성공률은 65%이고 체력은 남아돈다?'},
  {type:'thought', text:'참고로 나는 성공률 0%다..'},
];

const SCENE4B_CHOICE = {
  prompt: '누구에게 페널티킥을 맡길까?',
  options: [
    {label:'① 강승유에게 페널티킥을 권유한다.', key:'1'},
    {label:'② 송주헌에게 페널티킥을 권유한다.', key:'2'},
    {label:'③ 강 희에게 페널티킥을 권유한다.', key:'3'},
  ]
};

const SCENE4B_OUTCOMES = {
  '1': {
    juheon:0, seungyu:0, ganghee:0,
    lines:[
      {type:'narration', text:'나는 발목을 절뚝이는 승유의 어깨를 잡았다.'},
      {type:'line', speaker:PLAYER, text:'승유야, 부상이 심한 건 아는데... 그래도 우리 팀 에이스는 너잖아. 한 번만 딛고 차보자.'},
      {type:'line', speaker:SEUNGYU, text:'후우... 그래, 네가 그렇게까지 말하는데 도망칠 순 없지. 결승인데 끝까지 책임진다.'},
      {type:'narration', text:'승유가 이를 악물고 페널티 스폿으로 걸어 나갔다. 골키퍼의 심리전이 이어지고, 휘슬이 울렸다.'},
      {type:'narration', text:'승유가 디딤발을 딛는 순간— 악 소리도 내지 못한 채 발목에 무리가 간 듯 중심이 무너졌다.', stopBgm:true},
      {type:'narration', text:'툭 건드려진 공은 힘없이 굴러가 상대 골키퍼의 품에 허무하게 안겼다.'},
      {type:'narration', text:'실축이다.'},
      {type:'line', speaker:SEUNGYU, text:'미안하다, 얘들아... 진짜 발목이 안 따라주네...', bgm:"FUNNY! arrange"},
      {type:'narration', text:'미안해서 고개를 들지 못한다.'},
      {type:'line', speaker:JUHEON, text:'하아... 아쉽게 됐네. 뭐 어쩌겠냐,'},
      {type:'narration', text:'주저앉은 승유의 등을 토닥이며 씁쓸하게 라인업으로 복귀한다.'},
      {type:'line', speaker:GANGHEE, text:'거 봐! 내가 차겠다고 할 때 나 장난치는 줄 알았지? 내가 엉터리 같아 보였냐고! 아까 나한테 기회를 줬으면 지금쯤 세리머니하고 있었을 텐데, 아이고 아까워라!'},
      {type:'narration', text:'강 희가 옆에서 쉴 새 없이 투덜대며 쫑알거리지만, 결승전 실축의 묵직한 침묵 속에 묻혔다.'},
      {type:'narration', text:'승유는 미안함에, 주헌이는 아쉬움에 젖어 들었을 뿐, 서로를 탓하지도 특별히 가까워지지도 않은 채 분위기만 무거워졌다.', stopBgm:true},
    ]
  },
  '2': {
    juheon:-1, seungyu:0, ganghee:0,
    lines:[
      {type:'narration', text:'나는 결승전을 꼭 이기고 싶다던 주헌이의 눈빛을 떠올렸다.'},
      {type:'line', speaker:PLAYER, text:'주헌아, 네가 차라. 네가 우리 팀을 결승까지 이끌었잖아. 네가 마무리해.'},
      {type:'line', speaker:JUHEON, text:'내... 내가? 후우, 그래... 이기고 싶으니까. 내가 해결한다.'},
      {type:'narration', text:'주헌이가 땀 범벅이 된 얼굴을 유니폼 소매로 훔치며 앞으로 나섰다.'},
      {type:'narration', text:'전후반 내내 뛰어다닌 탓에 다리가 묘하게 떨리는 게 멀리서도 보였다.'},
      {type:'narration', text:'삐익- 휘슬 소리와 함께 주헌이가 강하게 오른발을 휘둘렀다.', stopBgm:true},
      {type:'narration', text:'쾅!! 묵직한 파열음이 울렸지만, 지친 다리 탓에 임팩트가 빗나간 공은 골대 상단을 사정없이 강타하며 허공으로 튕겨 나갔다.'},
      {type:'narration', text:'(...)'},
      {type:'narration', text:'홈런이다.', bgm:"FUNNY! arrange"},
      {type:'narration', text:'머리를 감싸 쥐며 자리에 털썩 주저앉는다. 내 손을 쳐다보며 깊은 자책감에 빠진다.'},
      {type:'narration', text:'주헌이는 기회를 날려버렸다는 압박감 때문에 신경이 날카로워진 듯하다.'},
      {type:'narration', text:'다가가 위로를 건네려 했지만, 녀석은 미간을 찌푸린 채 내 시선을 피해버렸다.'},
      {type:'narration', text:'이기고 싶었던 마음이 컸던 만큼, 자신에게 기회를 준 나에게도 묘한 부담감과 짜증이 섞인 듯 호감도가 뚝 떨어지는 소리가 들렸다.', stopBgm:true},
    ]
  },
  '3': {
    juheon:+1, seungyu:+1, ganghee:+1,
    lines:[
      {type:'narration', text:'나는 벤치에서부터 몸을 풀며 온갖 호들갑을 떨고 있던 강 희에게 공을 쥐여주었다.', chars:{left:null, right:'ganghee'}, stopBgm:true},
      {type:'line', speaker:PLAYER, text:'강 희, 널 믿는다. 가서 꽂고 와라.'},
      {type:'line', speaker:GANGHEE, text:'하하하! 드디어 이 부고의 위대한 구세주이자 주인공인 강 희 님의 진가를 알아보는구나!', bgm:'Kurumi BGM'},
      {type:'line', speaker:GANGHEE, text:'얘들아 똑똑히 봐라? 축구란 말이지, 발목으로 차는 게 아니라 이 넘치는 소울과 완벽한 폼으로 차는 거거든? 저 골키퍼 눈빛 보이지? 이미 내 기에 질렸어, 질렸다고!'},
      {type:'narration', text:'공을 페널티 스폿에 놓는 순간까지도 쉴 새 없이 나불대던 강 희였지만, 신기하게도 눈빛만큼은 가벼워 보이지 않았다.'},
      {type:'thought', text:'아닌가.'},
      {type:'narration', text:'체력이 남아돌아 쌩쌩한 디딤발이 잔디를 힘차게 밟았고, 이내 정확하고 날카로운 궤적을 그리며 공이 골대 오른쪽 구석 상단에 꽂혔다!'},
      {type:'narration', text:'찰각— 하는 그물 소리와 함께 골인이다!'},
      {type:'line', speaker:GANGHEE, text:'으하하하!! 봤냐?! 내 완벽한 라보나 킥 지렸지? 야, __PLAYER_NAME__! 너 진짜 사람 볼 줄 안다!'},
      {type:'line', speaker:GANGHEE, text:'내 PK 성공률은 그냥 숫자가 아니라 신뢰의 보증수표라고! 다들 나한테 절해라!'},
      {type:'narration', text:'강 희가 나에게 달려와 격하게 헤드락을 걸며 승리의 잘난 척을 퍼붓는다.'},
      {type:'narration', text:'평소 같으면 시끄럽다고 귀를 막았겠지만, 결승전 선제골 앞에서는 장사가 없다.'},
      {type:'narration', text:'부상으로 앓던 승유도 "와, 대박이다 진짜 ㅋㅋㅋ" 하며 환하게 웃었고, 주헌이도 기분이 좋아 보였다.', stopBgm:true},
    ]
  }
};

/* =========================================================
   씬 4 - 학교 운동장 (부고컵 축구 대회) - 씬3 이후 이어짐
   ========================================================= */
const SCENE4_INTRO = [
  {type:'narration', text:'얼마 후, 학교 최대 행사 중 하나인 부고컵 축구 대회날이 다가왔다.', showBg:'field', bgm:'FUNNY'},
  {type:'narration', text:'우리 편은 적당한 조합이었지만, 상대편은 까다로운 인물 둘이 있었다.'},
  {type:'narration', text:'강승유, 이영웅이다.', chars:{left:'seungyu', right:'yeongwoong'}},
  {type:'narration', text:'그 둘은, 같은 중학교 출신이라 합이 잘 맞는다.'},
  {type:'narration', text:'얼마 후, 경기의 시작을 알리는 휘슬이 울렸다.'},
  {type:'thought', text:'나는 내 포지션에서 최선을 다하겠다고 마음을 먹었다.'},
  {type:'line', speaker:SEUNGYU, text:'영웅이형! 패스해줘!'},
  {type:'line', speaker:YEONGWOONG, text:'ㅇㅋㅇㅋ 패스 잘 받아봐!'},
  {type:'narration', text:'한층 흥분된 분위기 속에서 강승유와 이영웅의 패스플레이가 돋보인다.'},
  {type:'narration', text:'그 순간 팀원이 이영웅의 발목을 노리는 백태클을 노렸고, 그대로 우리 팀원은 퇴장당했다.'},
  {type:'narration', text:'페널티킥 상황이다. 그리고 나는 골키퍼다.'},
  {type:'thought', text:'심장이 터질 것 같다. 골대 앞에 서니 안 그래도 넓은 운동장이 무슨 태평양처럼 광활해 보인다.'},
  {type:'thought', text:'백태클로 퇴장당해 나를 이 지옥에 홀로 버려둔 우리 팀원의 등짝을 스파이크로 후려치고 싶은 심정이다.'},
  {type:'narration', text:'페널티 스폿 뒤에서 이영웅이 붉어진 얼굴로 공을 돌려놓고 있다.'},
  {type:'narration', text:'발목이 조금 시큰거리는 모양인데도 눈빛만큼은 매섭다. 물론 머리도 크다.'},
  {type:'thought', text:'에어컨 나오는 교실을 두고 내가 왜 여기서 야수들의 눈빛을 받아내고 있어야 하는 걸까.'},
  {type:'line', speaker:SEUNGYU, text:'영웅이 형! 저 새끼 다리 떨고 있다! 그냥 구석으로 가볍게 꽂아버려!'},
  {type:'line', speaker:YEONGWOONG, text:'후우... 걱정 마라. 형 킥 정교한 거 알잖아.'},
  {type:'narration', text:'이영웅이 뒤로 물러나며 디딤발을 고르기 시작한다.'},
  {type:'narration', text:'휘슬 소리가 내 고막을 찢을 듯이 울리고, 이영웅이 질주한다.'},
  {type:'narration', text:'나는 그의 움직임을 매섭게 노려보았다. 그는 왼쪽 구석으로 시선을 보낸다.'},
];

const SCENE4_CHOICE = {
  prompt: '몸을 어느 쪽으로 던질까?',
  options: [
    {label:'① 내 자신을 기준으로 골대 왼쪽을 막는다.'},
    {label:'② 내 자신을 기준으로 골대 중앙을 막는다.'},
    {label:'③ 내 자신을 기준으로 골대 오른쪽을 막는다.'},
  ]
};

const SCENE4_OUTCOMES = {
  a: {
    seungyu:+1, yeongwoong:-1,
    lines:[
      {type:'narration', text:'이영웅의 발이 공에 닿는 순간, 나는 본능적으로 몸을 웅장하게 던졌다.', stopBgm:true},
      {type:'narration', text:'퍽-!!'},
      {type:'narration', text:'둔탁한 파열음과 함께 내 손끝에 강렬한 저항감이 느껴졌다.'},
      {type:'narration', text:'공은 내 손을 맞고 그대로 라인 밖으로 튕겨 나갔다. 슈퍼 세이브다!', bgm:'I won'},
      {type:'line', speaker:YEONGWOONG, text:'아, X발... 그걸 읽었다고?'},
      {type:'narration', text:'큰 머리를 감싸 쥐며 허탈하게 지면을 내려다본다.'},
      {type:'narration', text:'스탠드에서 경기를 보던 반 애들이 오오오!! 하며 단체로 소리를 지른다.'},
      {type:'narration', text:'관중석의 열기가 순식간에 뒤집혔다.'},
      {type:'narration', text:'그때, 상대 팀인 강승유가 어이없다는 듯 헛웃음을 치며 나에게 다가왔다.'},
      {type:'line', speaker:SEUNGYU, text:'와... 야, __PLAYER_NAME__! 너 방금 반사신경 뭐냐? 영웅이 형 피케이 슛을 막네? 대박이다 진짜 ㅋㅋㅋ'},
      {type:'narration', text:'강승유가 적팀인데도 리스펙한다는 표정으로 내 어깨를 툭 치고 지나간다.'},
      {type:'narration', text:'주저앉아 아쉬워하는 이영웅의 실루엣 뒤로 땀방울이 흩날린다.'},
      {type:'thought', text:'내 손끝은 얼얼했지만 기분만큼은 최고였다.'},
    ]
  },
  b: {
    seungyu:+1, yeongwoong:-1,
    lines:[
      {type:'narration', text:'이영웅의 발이 공에 닿는 순간, 나는 본능적으로 몸을 웅장하게 던졌다.', stopBgm:true},
      {type:'narration', text:'퍽-!!'},
      {type:'narration', text:'둔탁한 파열음이 들렸지만 내 손끝에는 아무 저항감도 느껴지지 않았다.'},
      {type:'narration', text:'공은 골대를 맞고 그대로 라인 밖으로 튕겨 나갔다.', bgm:'I won'},
      {type:'line', speaker:YEONGWOONG, text:'아, X발... 그걸 읽었다고?'},
      {type:'narration', text:'큰 머리를 감싸 쥐며 허탈하게 지면을 내려다본다.'},
      {type:'narration', text:'스탠드에서 경기를 보던 반 애들이 오오오!! 하며 단체로 소리를 지른다.'},
      {type:'narration', text:'관중석의 열기가 순식간에 뒤집혔다.'},
      {type:'narration', text:'그때, 상대 팀인 강승유가 어이없다는 듯 헛웃음을 치며 나에게 다가왔다.'},
      {type:'line', speaker:SEUNGYU, text:'와... 야, __PLAYER_NAME__! 너 방금 반사신경 뭐냐? 영웅이 형 피케이 슛을 막네? 대박이다 진짜 ㅋㅋㅋ'},
      {type:'narration', text:'강승유가 적팀인데도 리스펙한다는 표정으로 내 어깨를 툭 치고 지나간다.'},
      {type:'narration', text:'주저앉아 아쉬워하는 이영웅의 실루엣 뒤로 땀방울이 흩날린다.'},
      {type:'thought', text:'내 손끝은 얼얼했지만 기분만큼은 최고였다.'},
    ]
  },
  c: {
    seungyu:0, yeongwoong:+1,
    lines:[
      {type:'narration', text:'이영웅의 디딤발 각도가 내가 움직이는 방향을 향하는 것을 포착했다.', stopBgm:true},
      {type:'narration', text:'나는 회심의 미소를 지으며 그 방향으로 튀어 올랐다.'},
      {type:'narration', text:'휘익-'},
      {type:'narration', text:'하지만 공은 내 몸과 정확히 반대 방향으로 그물을 찢을 듯이 꽂혔다.'},
      {type:'narration', text:'디딤발 각도까지 페이크였던 것이다. 완벽하게 낚였다..', bgm:'I lost'},
      {type:'line', speaker:YEONGWOONG, text:'나이스!!'},
      {type:'narration', text:'골망이 흔들리는 것을 보며 주먹을 불끈 쥐고 강승유에게 달려간다.'},
      {type:'line', speaker:SEUNGYU, text:'역시 영웅이 형!! 킥 지렸다 방금! 야, __PLAYER_NAME__! 까비까비~ 근데 방향 완전 반대로 속았네 ㅋㅋ'},
      {type:'narration', text:'강승유는 이영웅과 신나게 하이파이브를 하며 득점의 기쁨을 나누고 있다.'},
      {type:'narration', text:'나에게는 영혼 없는 위로만 건넸을 뿐, 시선은 이미 영웅이 형에게 고정되어 있다.'},
      {type:'narration', text:'모래바람을 뒤집어쓴 채 씁쓸하게 일어났다.'},
      {type:'narration', text:'날씨는 더럽게 덥고, 상대편의 분위기는 하늘을 찌른다.'},
      {type:'thought', text:'이 판은 스토리가 좀 꼬인 것 같다.'},
    ]
  },
};

/* =========================================================
   씬 5 - 씬4 이후 (강승유 호감도 vs 이영웅 호감도로 루트 분기)
   ========================================================= */

// 강승유 루트 - 반죽동 카페
const SCENE5_SEUNGYU_INTRO = [
  {type:'narration', text:'축구 대회가 끝나고 온몸이 모래투성이에 뻐근하기 짝이 없다.', stopBgm:true},
  {type:'narration', text:'승유 녀석이 갑자기 시원한 거나 마시자며 나를 반죽동 829 카페로 반강제로 끌고 왔다.', showBg:'banjukdong', chars:{left:'seungyu', right:null}, bgm:'Constant Daily Routine'},
  {type:'narration', text:'에어컨 바람이 피부에 닿는 순간 천국이 있다면 여기일 거라는 확신이 들었다.'},
  {type:'narration', text:'통유리창 너머로 매미 소리가 웅장하게 들려온다.'},
  {type:'line', speaker:SEUNGYU, text:'야, __PLAYER_NAME__. 너 오늘 골대 앞에서 고생했으니까 내가 특별히 사준다. 오케이?'},
  {type:'thought', text:'갑작스러운 녀석의 호의에 감동했지만, 이 상황에서 나는 천차만별인 가격 중 얼마로 주문해야 할지 고민된다.'},
];

const SCENE5_SEUNGYU_CHOICE = {
  prompt: '무엇을 주문할까?',
  options: [
    {label:'① 아이스 아메리카노 3000 won', key:'1'},
    {label:'② 아이스티 샷추가 3000 won', key:'2'},
    {label:'③ 바닐라 라떼 3000 won', key:'3'},
  ]
};

const SCENE5_SEUNGYU_OUTCOMES = {
  '1': {
    seungyu:0,
    lines:[
      {type:'narration', text:'피로를 씻어내기엔 역시 쌉싸름하고 깔끔한 아이스 아메리카노가 최고다. 나는 주저 없이 아아를 골랐다.'},
      {type:'line', speaker:SEUNGYU, text:'오, 역시 얼죽아냐? 사장님, 여기 아아 하나랑 제 거 하나 주세요.'},
      {type:'narration', text:'음료가 나오고 우리는 구석 테이블에 자리를 잡았다.'},
      {type:'narration', text:'승유는 내 소박한 초이스에 별다른 감흥은 없는지, 그냥 평범하게 오늘 축구 경기 때 있었던 비하인드 스토리나 반 애들 리액션에 대해 조잘조잘 떠들기 시작했다.'},
      {type:'narration', text:'시원한 커피 덕분에 갈증은 완벽하게 해소되었고, 대화도 물 흐르듯 무난하게 흘러갔다.'},
      {type:'thought', text:'딱 평타 치는 평화로운 휴식 시간이다.', stopBgm:true},
    ]
  },
  '2': {
    seungyu:0,
    lines:[
      {type:'narration', text:'단쓴단쓴의 진리이자 요즘 학생들의 고정 픽, 아샷추를 골랐다. 3천 원에 이 정도 도파민 충전이면 참을 수 없지.'},
      {type:'line', speaker:SEUNGYU, text:'너 아샷추 먹냐? 그거 은근 맛 특이해서 호불호 갈리던데... 뭐, 네 취향이니까 존중한다. 사장님, 여기 아샷추 하나요!'},
      {type:'narration', text:'음료가 나오자 승유는 내가 컵을 들고 아샷추를 들이키는 모습을 신기하다는 듯 쳐다본다.'},
      {type:'narration', text:'"그게 진짜 무슨 맛으로 먹는 거냐?"며 한 입만 달라고 할까 말까 눈치를 살피는 것 같기도 하다.'},
      {type:'narration', text:'묘한 메뉴 초이스 덕분에 대화 소재가 잠깐 음료수 맛 평가로 튀었을 뿐, 이내 다시 축구 얘기로 자연스럽게 넘어가며 무난하게 마무리되었다.', stopBgm:true},
    ]
  },
  '3': {
    seungyu:+1,
    lines:[
      {type:'narration', text:'지친 몸에는 역시 당 충전이 필수다. 달달하고 부드러운 바닐라 라떼를 선택했다.', stopBgm:true},
      {type:'line', speaker:SEUNGYU, text:'헉...! 너 방금 바닐라 라떼라고 했냐? 헐, 대박. 너 뭘 좀 아는 새끼구나?!', bgm:'GYM CLASS'},
      {type:'narration', text:'내 주문을 들은 승유의 눈빛이 갑자기 초롱초롱해지더니 내 어깨를 덥석 잡는다.'},
      {type:'line', speaker:SEUNGYU, text:'이게 내 최애 음료거든! 남고생 녀석들은 맨날 쓸데없이 똥폼 잡는다고 아아만 처먹어서 나 혼자 달달한 거 시키기 묘하게 눈치 보였는데... 와, 여기서 취향이 통하네!'},
      {type:'line', speaker:SEUNGYU, text:'사장님! 여기 바닐라 라떼 두 잔이요! 시럽 팍팍 넣어주세요!'},
      {type:'narration', text:'음료가 나오자 승유는 세상을 다 가진 표정으로 빨대를 꽂는다.'},
      {type:'narration', text:'자기랑 음료 취향이 똑같은 놈은 처음 본다며, 오늘 경기 막판 세이브보다 네 음료 초이스가 훨씬 더 짜릿했다며 폭풍 칭찬을 쏟아낸다.'},
      {type:'thought', text:'달콤한 라떼 향만큼 승유와의 거리도 부쩍 좁혀진 기분이다. 오늘 메뉴 선택은 대성공이다.', stopBgm:true},
    ]
  }
};

// 송주헌 루트 - 반죽동 328 카페 (씬4b 이후, 주헌 호감도 > 승유 호감도)
const SCENE5_JUHEON_INTRO = [
  {type:'narration', text:'축구 대회가 끝나고 며칠 뒤, 유독 지쳐 보이는 주헌이를 데리고 반죽동 328에 위치한 조용한 카페로 들어왔다.', showBg:'banjukdong', chars:{left:null, right:'juheon'}, stopBgm:true},
  {type:'narration', text:'통유리창 너머로 지는 노을이 카페 안을 은은하게 비추고 있다.', bgm:'Daily Repeat'},
  {type:'narration', text:'주헌이는 의자에 깊숙이 몸을 파묻은 채, 피로가 덜 풀린 눈으로 메뉴판을 가만히 응시하고 있다.'},
  {type:'narration', text:'결승전 때 누구보다 책임감이 무거웠던 녀석이기에, 오늘은 내가 기분 좋게 한턱내며 기운을 북돋아 주고 싶다.'},
  {type:'line', speaker:PLAYER, text:'주헌아, 오늘 내가 시원하게 쏜다. 결승전 때 너 진짜 고생 많았잖아. 부담 갖지 말고 골라봐.'},
  {type:'narration', text:'잠시 놀란 듯 눈을 동그랗게 떴다가, 이내 옅은 미소를 지으며 고개를 끄덕인다.'},
  {type:'line', speaker:JUHEON, text:'어... 네가 사준다고? 웬일이냐. 고맙긴 한데... 막상 고르려니까 다 비슷비슷해 보이네.'},
  {type:'narration', text:'피곤해서 메뉴를 고르는 것조차 귀찮아 보이는 주헌이.'},
  {type:'thought', text:'이 타이밍에 나는 어떻게 주문을 제안해야 녀석의 마음을 저격할 수 있을까?'},
  {type:'narration', text:'(...)'},
  {type:'narration', text:'(...)'},
  {type:'narration', text:'(!!!)'},
  {type:'narration', text:'그런데 돈이 6000 won 밖에 없다.'},
  {type:'thought', text:'제한 조건 내에서 최선의 선택을 해야한다.'},
];

const SCENE5_JUHEON_CHOICE = {
  prompt: '무엇을 주문할까?',
  options: [
    {label:'① 아이스 아메리카노 3000 won', key:'1'},
    {label:'② 아이스티 샷추가 3000 won', key:'2'},
    {label:'③ 바닐라 라떼 3000 won', key:'3'},
  ]
};

const SCENE5_JUHEON_OUTCOMES = {
  '1': {
    juheon:+1,
    lines:[
      {type:'narration', text:'가장 안전하고 깔끔한 아이스 아메리카노 두 잔을 주문했다. 내 지갑의 평화도 지키고, 주헌이의 피로도 날려버릴 최고의 선택이다.'},
      {type:'line', speaker:JUHEON, text:'오, 아아 좋지. 마침 입안이 텁텁해서 깔끔한 게 당겼는데 고맙다. 잘 마실게.'},
      {type:'narration', text:'음료가 나오고 시원한 아아를 한 모금 쭉 들이킨 주헌이가 비로소 깊은 한숨을 내쉬며 미소를 짓는다.'},
      {type:'narration', text:'녀석은 컵 표면에 맺힌 물방울을 툭툭 건드리며, 결승전 때 받았던 부담감과 묵직했던 책임감에 대해 조근조근 털어놓기 시작한다.'},
      {type:'narration', text:'녀석의 진중하고 담백한 성격에 딱 들어맞는 씁쓸하고 시원한 티타임 덕분에, 주헌이와의 유대감이 한층 더 깊고 단단해진 기분이다.', stopBgm:true},
    ]
  },
  '2': {
    juheon:0,
    lines:[
      {type:'narration', text:'요즘 유행하는 단쓴단쓴의 정석, 아샷추 두 잔을 주문해 카운터에서 받아왔다. 6,000원 결제도 완벽하게 세이프다.'},
      {type:'line', speaker:JUHEON, text:'어... 이게 뭐야? 아이스티에 샷을 추가한 거라고? 그런 메뉴도 있나... 나 이건 한 번도 안 먹어봤는데.'},
      {type:'narration', text:'조심스럽게 빨대를 물고 한 모금 마신 주헌이의 미간이 미묘하게 좁혀진다.'},
      {type:'narration', text:'달콤한 복숭아 맛 뒤로 훅 치고 들어오는 에스프레소의 쓴맛에 적응하기 힘든 모양이다.'},
      {type:'line', speaker:JUHEON, text:'맛이... 되게 오묘하네.'},
      {type:'narration', text:'고개를 갸웃거리는 주헌이. 새로운 경험을 시켜주긴 했지만 녀석의 확고한 취향을 저격하진 못해, 대화는 그저 아샷추 맛에 대한 기묘한 감상평으로 흘러가며 무난하게 마무리되었다.', stopBgm:true},
    ]
  },
  '3': {
    juheon:0,
    lines:[
      {type:'narration', text:'당 충전이 시급해 보여 달달하고 부드러운 바닐라 라떼 두 잔을 주문했다. 금액도 정확히 6,000원으로 맞아떨어졌다.'},
      {type:'line', speaker:JUHEON, text:'아, 바닐라 라떼구나... 마음은 고마운데, 사실 지금 몸이 너무 지쳐서 그런가 우유 들어간 달달한 건 별로 안 땡기네. 그냥 갈증 해소되는 시원하고 깔끔한 게 마시고 싶었는데...'},
      {type:'narration', text:'주헌이는 차마 내가 사준 음료를 남기진 못하고 억지로 빨아 마시지만, 텁텁함이 가시지 않는지 연신 입술을 축인다.'},
      {type:'narration', text:'지친 상태에서 달고 무거운 음료를 먹인 탓에 녀석의 텐션은 여전히 바닥을 기어 다니고 있다.'},
      {type:'narration', text:'기운을 북돋아 주려던 내 의도와 달리 녀석의 현재 기분 상태를 완벽하게 파악하지 못한 것 같아 미안한 정적이 감돈다.', stopBgm:true},
    ]
  }
};

/* =========================================================
   씬 6 (송주헌 루트 분기) - 집, 메신저 대화 (BugoTalk)
   ========================================================= */

// 송주헌 호감도 3 미만
const SCENE6_JUHEON_LOW_INTRO = [
  {type:'narration', text:'주헌이와 카페에서 속 깊은 이야기를 나눈 뒤로, 녀석은 전보다 나를 훨씬 편하게 대하기 시작했다.', bgm:'Midnight Trip'},
  {type:'narration', text:'생기부도 끝냈고 침대에 누워 뒹굴거리던 중, 문득 혼자 하기엔 심심하다는 생각이 들어 녀석에게 게임을 하자고 꼬셔보기로 했다. 휴대폰을 들어 주헌이에게 톡을 보냈다.', openChat:'juheon'},
  {type:'chat', from:'player', text:'주헌아, 자냐? 폰 겜이든 컴퓨터 겜이든 뭐 하나 접속 고? 심심하다.'},
  {type:'narration', text:'잠시 후, 주헌이답게 지나치게 정직하고 진중한 답장이 돌아왔다.'},
  {type:'chat', from:JUHEON, text:'안 자는데, 오늘 학원 갔다 왔더니 몸이 좀 무겁네. 내일 학교도 가야 하는데... 굳이 이 시간에 겜을 해야겠냐?'},
  {type:'narration', text:'거절하는 듯하면서도 톡을 바로 읽은 걸 보니, 조금만 밀어붙이면 넘어올 것 같다.'},
  {type:'thought', text:'피곤해하는 주헌이를 침대에서 일으켜 세우기 위해 나는 어떤 선택을 할까?'},
];

const SCENE6_JUHEON_LOW_CHOICE = {
  prompt: '어떤 제안을 할까?',
  options: [
    {label:'① 롤 5인큐 ㄱ?', key:'1'},
    {label:'② 우리 독서 RPG 게임 할래?', key:'2'},
  ]
};

const SCENE6_JUHEON_LOW_OUTCOMES = {
  '1': {
    juheon:0,
    lines:[
      {type:'chat', from:'player', text:'피곤할 땐 도파민 장전이지. 롤 5인큐 ㄱ? 멤버 모아봄.'},
      {type:'chat', from:JUHEON, text:'5인큐는 무슨 ㅋㅋㅋ 지금 이 시간에 멤버 세 명을 어디서 구하냐?'},
      {type:'chat', from:JUHEON, text:'그리고 5인큐 돌리면 한 판으로 절대 안 끝나잖아. 나 오늘 학원 늦게까지 남아서 진짜 지쳤어. 그렇게 빡세게는 못 달린다. 그냥 얌전히 잘래.'},
      {type:'narration', text:'주헌이는 밤늦게 대규모로 모여서 기를 써야 하는 5인큐 제안에 고개를 절레절레 저었다.'},
      {type:'narration', text:'녀석의 피로도를 고려하지 않은 너무 하드코어한 제안이었던 탓에, 주헌이는 단칼에 거절하고 침대 속으로 기어 들어갔다. 게임은커녕 톡마저 끊겨버려 호감도는 요지부동이다.', closeChat:true},
    ]
  },
  '2': {
    juheon:0,
    lines:[
      {type:'chat', from:'player', text:'그럼 우리 독서 RPG 게임 할래? 잔잔하고 괜찮은데.'},
      {type:'chat', from:JUHEON, text:'독서 RPG...? 그건 또 무슨 해괴망측한 게임이냐?'},
      {type:'chat', from:JUHEON, text:'내가 알기론 그거 내년에 만들어지는 게임인데?'},
      {type:'chat', from:'player', text:'(헉)'},
      {type:'chat', from:JUHEON, text:'안 그래도 오늘 학원에서 시대 서프 풀고 와서 머리 터질 것 같은데, 또 글자를 읽으라고? ㅋㅋㅋ 야, 그건 나한테 게임이 아니라 고문이야, 고문. 난 패스할래.'},
      {type:'narration', text:'주헌이는 생전 처음 듣는 \'독서 RPG\'라는 장르에 황당하다는 반응을 보였다.'},
      {type:'narration', text:'먼 훗날 그 게임이 최고 인기 게임이 될 것인 줄 모르고...'},
      {type:'narration', text:'안 그래도 뇌 용량이 과부하 걸린 고등학생에게 독서라는 단어는 역효과만 불러일으킨 듯하다.'},
      {type:'narration', text:'주헌이는 나보고 혼자 열심히 읽으라며 조용히 폰을 내려놓았고, 대화는 허무하게 종료되었다.', closeChat:true},
    ]
  }
};

// 송주헌 호감도 3 이상 - 주관식 답변(키워드 분기) 포함
const SCENE6_JUHEON_HIGH_INTRO = [
  {type:'narration', text:'주헌이와 카페에서 속 깊은 이야기를 나눈 뒤로, 녀석은 전보다 나를 훨씬 편하게 대하기 시작했다.', bgm:'Midnight Trip'},
  {type:'narration', text:'생기부도 끝냈고 침대에 누워 뒹굴거리던 중, 문득 혼자 하기엔 심심하다는 생각이 들어 녀석에게 게임을 하자고 꼬셔보기로 했다. 휴대폰을 들어 주헌이에게 톡을 보냈다.', openChat:'juheon'},
  {type:'chat', from:'player', text:'주헌아, 자냐? 컴퓨터 겜 같이 할래? 심심하다.'},
  {type:'narration', text:'잠시 후, 주헌이답게 답장이 돌아왔다.'},
  {type:'chat', from:JUHEON, text:'어떤거 하고 싶은데?'},
  {type:'narration', text:'톡을 바로 읽은 걸 보니, 조금만 밀어붙이면 넘어올 것 같다.'},
  {type:'chat', from:'player', text:'우리 독서 RPG 게임 할래? 이거 재밌잖아.'},
  {type:'chat', from:JUHEON, text:'독서 RPG? 나 그거 되게 잘해. 투기장 랭킹 1등이야~'},
  {type:'chat', from:'player', text:'그래? 그거 나는 최근에 시작해서 레벨 좀 낮아. 근데, 건강하게 할 수 있는 게임이라 정말 좋은 것 같아. 그치?'},
  {type:'chat', from:JUHEON, text:'인정! 이거 게임 왤캐 재밌는지 모르겠어. 공부를 통해 게임을 한다는 발상이 공부 동기를 엄청나게 올려주는 거 같아. 내가 고수니까 특별히 이 게임에 대해 꿀팁 알려줄게. 궁금한거 있어?'},
];

const SCENE6_JUHEON_HIGH_OUTCOME_A = {
  // 질문에 "히든 업적" 키워드만 포함된 경우
  juheon:0,
  lines:[
    {type:'chat', from:JUHEON, text:'히든 업적? 그건 내가 어렴풋하게 알아. 너랑 내가 함께 협심해서 투기장에서 승리해보면 어떨까?'},
    {type:'thought', text:'주헌이는 이해가 안되는 말만 계속한다. 이것은 메타발언인가? 모르겠다.', closeChat:true},
  ]
};

const SCENE6_JUHEON_HIGH_OUTCOME_B = {
  // 질문에 "반죽동" 키워드만 포함된 경우
  juheon:0,
  lines:[
    {type:'chat', from:JUHEON, text:'반죽동? 반죽동 골목 번호가 무엇을 의미하는지 물어보는 거야?'},
    {type:'chat', from:'player', text:'어 알려줘.'},
    {type:'chat', from:JUHEON, text:'세 골목 번호는 그 인물들의 특별한 숫자를 상징해. 이 숫자의 합을 나에게 물어보면 재미있는 일이 일어날지도 몰라.'},
    {type:'thought', text:'주헌이는 이해가 안되는 말만 계속한다. 이것은 메타발언인가? 모르겠다.', closeChat:true},
  ]
};

const SCENE6_JUHEON_HIGH_OUTCOME_D = {
  // 세 키워드 모두 포함되지 않은 경우
  juheon:0,
  lines:[
    {type:'chat', from:JUHEON, text:'어.. 미안. "히든 업적" 이런 건 내가 잘 아는데, 그것은 내가 잘 몰라서.'},
    {type:'chat', from:'player', text:'괜찮아! 모험 게임은 원래 자력으로 뚫어가는 맛이 있지~', closeChat:true},
  ]
};

const SCENE6_JUHEON_HIGH_OUTCOME_E = {
  // 키워드가 2개 이상 포함된 경우
  juheon:0,
  lines:[
    {type:'chat', from:JUHEON, text:'질문이 너무 복잡한 것 같아서 이해를 못하겠어.'},
    {type:'chat', from:'player', text:'미안 내가 설명을 못했지? 괜찮아! 모험 게임은 원래 자력으로 뚫어가는 맛이 있지~', closeChat:true},
  ]
};


// 송주헌 엔딩 (씬6 이후, 주헌 호감도 3 이상)
const SCENE6_JUHEON_HIGH_ENDING = [
  {type:'narration', text:'그 다사다난했던 사건들이 지나간 뒤, 내 삶은 언제 그랬냐는 듯 평범하고 무던한 학교 생활로 돌아왔다.', showBg:'schoolgate', chars:{left:null, right:null}, stopBgm:true},
  {type:'narration', text:'지루한 수업을 듣고, 쉬는 시간엔 짧은 휴식을 취하며, 시험과 입시라는 막연한 중압감을 버텨내는 지극히 보통의 하루하루.'},
  {type:'narration', text:'하지만 이전과 드라마틱하게 달라진 게 단 하나 있다면…… 내 곁에는 언제나 나를 묵묵히 받쳐주는 주헌이가 있다는 사실이다.'},
  {type:'thought', text:'혼자서 모든 고민과 무게를 홀로 짊어지고 지낼 때는 정말이지 전혀 알지 못했다.'},
  {type:'thought', text:'내가 진심으로 마음을 열고 기댈 수 있는 진짜 친구라는 존재가 내 삶 전반에 얼마나 커다란 안도감을 가져다주는지.'},
  {type:'thought', text:'세상의 모든 관계란 결코 모두를 만족시킬 수 없는 법이다.'},
  {type:'thought', text:'열 명의 사람이 있다면, 그중 한 명은 이유도 없이 나를 미워하거나 겉돌게 만들 것이고, 또 다른 한 명은 그저 나라는 사람 자체를 이유 없이 좋아하고 아껴줄 테니까.'},
  {type:'thought', text:'그 불완전한 세상 속에서 우리가 해야 하는 진짜 역할은, 나를 미워하는 사람들의 시선에 억지로 맞추려 진을 빼는 것이 아니라…… 나를 있는 그대로 인정하고 좋아해 주는 단 한 사람, 혹은 내 마음의 에너지 한도 내에서 서로를 의지하고 또 의지가 되어줄 수 있는 소중한 인연들에게 마음을 다하는 것이었다.'},
  {type:'thought', text:'그리고 지금 내 세상에서, 나를 가장 단단하고 온전하게 지탱해 주는 그 고마운 존재는 바로 주헌이다.', showBg:'juheon_end_photo', chars:{left:null, right:null}, bgm:'You are the One'},
  {type:'line', speaker:JUHEON, text:'……야. 우리 오늘 외식하자. 9평도 끝났는데 맛있는 거나 먹으러 가자고. 이번엔 내가 쏠 테니까.', chars:{left:null, right:null}},
  {type:'narration', text:'툭 던지듯 무심하게 말하지만, 특유의 무뚝뚝한 표정 뒤로 은근히 나를 챙겨주려는 다정함이 묻어난다.'},
  {type:'narration', text:'평소엔 말수가 적고 무심해 보여도, 내가 힘들어하거나 결정적인 순간이 오면 누구보다 먼저 내 편이 되어주던 녀석다운 제안이었다.'},
  {type:'narration', text:'녀석의 진심 어린 한마디에 내 마음속에 남아있던 시험 스트레스가 싹 가셔나가는 기분이 들었다.'},
  {type:'line', speaker:PLAYER, text:'오! 진짜? 웬일이야, 주헌이가 쏜다니! 고마워, 오늘 진짜 비싼 거 골라서 개많이 먹어야지 ㅋㅋㅋ!'},
  {type:'line', speaker:JUHEON, text:'……어. 많이 먹어라. 먹고 싶은 거 다 골라.', chars:{left:null, right:null}},
  {type:'narration', text:'슬그머니 입꼬리를 올리며 나지막하게 웃는 녀석의 얼굴을 보니 나도 모르게 기분 좋은 웃음이 터져 나온다.'},
  {type:'narration', text:'노을빛이 붉게 물드는 교정을 녀석과 나란히 어깨를 맞대고 걸어 나간다.'},
  {type:'narration', text:'누군가에게 온전히 이해받고, 든든하게 의지할 수 있는 누군가가 곁에 있다는 이 감각.'},
  {type:'thought', text:'나는 지금, 더할 나위 없이 소중하고 완벽하게 행복하다.'},
];

/* ---- 히든 엔딩 (질문에 "1362" 키워드만 포함된 경우) ---- */
const YOONDAEWOONG = { name: '윤대웅', sub: '사진작가', key: 'yoondaewoong' };

const SCENE6_JUHEON_HIDDEN_CHAT = [
  {type:'chat', from:JUHEON, text:'...', stopBgm:true},
  {type:'chat', from:JUHEON, text:'...'},
  {type:'chat', from:JUHEON, text:'...'},
  {type:'chat', from:'player', text:'왜 그래?'},
  {type:'chat', from:'player', text:'무섭게..'},
  {type:'chat', from:JUHEON, text:'드디어 넌 나를 비롯한 우리들을 많이 알아간 것 같아. 네게 소개해주고 싶은 사람이 있어. 30분 뒤에 학교 정문에서 만나자.'},
  {type:'chat', from:'player', text:'어.. 알겠어.'},
  {type:'narration', text:'그렇게 나는 휴대전화를 끄고, 준비를 간단히 마친 뒤, 학교 정문으로 뛰어 갔다.', closeChat:true},
];

const SCENE6_JUHEON_HIDDEN_INTRO = [
  {
    type:'line',
    speaker:YOONDAEWOONG,
    text:'주헌이가 소개해준 학생이 너니? 이름은 __PLAYER_NAME__(이)라고 들었는데 맞아?',
    showBg:'schoolgate',
    chars:{left:null, right:'yoondaewoong'},
        deferVisualsUntilBg:true,
mysterySpeaker:true,
    mysterySilhouette:'right'
  },
  {
    type:'line',
    speaker:PLAYER,
    text:'네. 혹시 누구세요?',
    revealCharacter:'right'
  },
  {type:'line', speaker:YOONDAEWOONG, text:'나는 우정이 깃든 아름다운 세상을 사진첩에 담는 사진 작가 윤대웅이라고 해.', bgm:'Hurting Boxing'},
  {type:'line', speaker:YOONDAEWOONG, text:'주헌이는 내 프로젝트를 계승하기 위해 같이 협업하는 사이지.'},
  {type:'line', speaker:YOONDAEWOONG, text:'네가 주헌이의 소개를 받았다니 대단하구나. 쉽지 않았을 것 같아.'},
  {type:'line', speaker:PLAYER, text:'네.. 혹시 그 프로젝트가 무엇인지 알 수 있을까요?'},
  {type:'line', speaker:YOONDAEWOONG, text:'우리는 앞에선 보이지 않는 숨겨진 것들의 미학을 탐구하는 자야. 주헌이가 네게 정보를 흘렸을 텐데? 알고 있니? 몰랐었다면 다음에 만났을 때, 히든 업적에 관해 물어봐.'},
  {type:'line', speaker:YOONDAEWOONG, text:'아무튼, 너의 추론력과 사교성으로 봤을 때, 우리 "ester CAD"팀에 들어올 자격이 충분한 것 같네.'},
];

const SCENE6_JUHEON_HIDDEN_ENDING = [
  {
    type:'narration',
    text:'그 많은 다사다난한 사건들을 거쳐, 나는 결국 ‘ester CAD’의 정식 멤버로 합류하게 되었다.',
    clearBg:true,
    chars:{left:null, right:null},
    stopBgm:true
  },
  {type:'thought', text:'사실 처음 권유를 받았을 당시엔 머릿속이 엉켜 고민을 정말 많이 했다.'},
  {type:'thought', text:'내가 과연 이런 비밀스럽고 기묘한 활동에 적응할 수 있을지, 내 적성에 맞는 일인지 전혀 확신이 서지 않았기 때문이다.'},
  {type:'thought', text:'하지만 지금 돌아보면, 그때의 고민들이 얼마나 부질없고 기우에 불과했는지 깨닫게 된다.'},
  {type:'thought', text:'이 어두우면서도 매혹적인 팀 안에서 주헌이, 그리고 대웅 아저씨와 함께 깊은 수수께끼 같은 프로젝트를 직접 기획하고 설계하는 것.'},
  {type:'thought', text:'그리고 일과가 끝나면 아무 일도 없었다는 듯 함께 하교하며 소소하고 즐거운 일상을 나누는 것.'},
  {type:'thought', text:'그것만으로도 내 삶은 이전과는 비교할 수 없을 만큼 입체적이고 진한 색으로 물들어가고 있었다.'},
  {type:'thought', text:'우리는 세상에 숨겨진 비밀스러운 요소와 룰을 파헤치는 활동을 주로 하지만…… 때로는 역으로 우리만의 ‘숨겨진 해답’을 세상 곳곳에 배치하여, 누군가 그것을 찾아냈을 때 잊지 못할 행운과 기쁨을 선사하는 일도 하고 있다.'},

  // 위 독백까지 검은 화면을 유지하고, 이 발화부터 CG를 표시
  {
    type:'line',
    speaker:YOONDAEWOONG,
    text:'어이! __PLAYER_NAME__! 오늘도 제시간에 딱 맞춰 왔구나!',
    showBg:'juheon_hidden_end_photo',
    chars:{left:null, right:null},
    bgm: 'The Quiet Arrival'
  },
  {type:'line', speaker:YOONDAEWOONG, text:'후후, 다들 주목. 오늘은 우리 ‘ester CAD’ 프로젝트가 세상에 닻을 올린 지 정확히 3주년이 되는 뜻깊은 날이다! 그래서 오늘은 내가 특별히 예약해 둔 고급 레스토랑에서 근사하게 회식을 하려고 하는데…… 다들 준비됐나?', chars:{left:null, right:null}},
  {type:'line', speaker:JUHEON, text:'……아저씨! 그런 중요한 이야기는 저한테 먼저 해주셨어야죠! 왜 저만 쏙 빼놓고 기습 발표를 하시는 건데요!', chars:{left:null, right:null}},
  {type:'line', speaker:YOONDAEWOONG, text:'하하하! 원래 이런 깜짝 이벤트는 다 같이 한자리에 모였을 때 터뜨려야 제맛이지! 섭섭해하지 마라, 주헌아.', chars:{left:null, right:null}},
  {type:'line', speaker:YOONDAEWOONG, text:'그보다 곧 예약 시간이 다 되어가니 늦기 전에 어서 움직이자고!', chars:{left:null, right:null}},
  {type:'line', speaker:PLAYER, text:'네, 아저씨! 지금 당장 가요!', chars:{left:null, right:null}},
  {type:'narration', text:'투덜거리는 주헌이의 어깨를 툭 치며 활짝 웃어 보인다.', chars:{left:null, right:null}},
  {type:'thought', text:'수면 아래 숨겨진 세계를 탐구하는 우리들의 비밀스러운 여정.', chars:{left:null, right:null}},
  {type:'thought', text:'그리고 그 위험천만하면서도 아름다운 궤도를 함께 걸어갈 소중한 동료들.', chars:{left:null, right:null}},
  {type:'thought', text:'내 평범했던 일상은 이제 그 누구도 흉내 낼 수 없는 가장 특별하고 완벽한 이야기로 채워져 가고 있다.', chars:{left:null, right:null}},
];

// 이영웅 루트 - 반죽동 골목
const SCENE5_YEONGWOONG_INTRO = [
  {type:'narration', text:'반죽동 205 근처의 한산한 골목길을 걸어가고 있을 때였다.', showBg:'alley', chars:{left:null, right:null}},
  {type:'narration', text:'저 멀리 골목 모퉁이에서부터 무시무시한 존재감을 뿜어내는 실루엣 하나가 걸어오고 있었다.'},
  {type:'narration', text:'길을 가던 동네 고양이들도 슬금슬금 피하게 만드는 저 껄렁한 걸음걸이, 그리고 멀리서 봐도 비율상 유독 독보적인 존재감을 자랑하는 저 거대한 머리 크기...'},
  {type:'thought', text:'틀림없다. 축구 대회 때 상대 팀이었던 3학년 이영웅 선배다.'},
  {type:'thought', text:'평소 성격 더럽고 이미지가 안 좋은 선배라, 굳이 길거리에서 마주쳐서 좋을 게 없다.'},
  {type:'narration', text:'나는 최대한 땅바닥만 보며 스치듯 지나가려고 발걸음을 재촉했다.'},
  {type:'narration', text:'하지만...'},
  {type:'narration', text:'터벅, 터벅... 스윽-', chars:{left:null, right:'yeongwoong'}},
  {type:'line', speaker:YEONGWOONG, text:'야.'},
  {type:'narration', text:'그 거대한 실루엣이 내 앞을 턱 가로막았다.', bgm:'Daily Routine'},
  {type:'narration', text:'올려다본 이영웅 선배의 미간은 이미 사정없이 찌푸려져 있었다.'},
  {type:'thought', text:'기분 안 좋은 날 걸리면 진짜 피곤해지는 타임이다.'},
  {type:'line', speaker:YEONGWOONG, text:'너 지금 눈을 어디다 두고 다니냐? 선배가 눈앞에 지나가는데 그냥 생까고 가네?'},
  {type:'line', speaker:PLAYER, text:'아... 죄송합니다. 못 보고 지나칠 뻔했습니다.'},
  {type:'line', speaker:YEONGWOONG, text:'못 봐? 야, 내 머리 크기가 이만해서 저 멀리서도 다 보였을 텐데 안 보였다고?'},
  {type:'narration', text:'스스로 대두인 걸 아는 건지 모르는 건지, 선배는 픽 웃으며 내 어깨를 툭 친다.'},
  {type:'narration', text:'말투는 장난 같지만 눈빛에는 3학년 특유의 꼽주는 선배 포스가 가득 배어있다.'},
  {type:'thought', text:'축구부 짬바에서 나오는 위압감이 장난 아니다.'},
  {type:'line', speaker:YEONGWOONG, text:'우연히 길에서 마주쳤으면 똑바로 서서 인사부터 박는 게 부고 국룰 아니냐? 인사 안 하냐, 새끼야?'},
];

const SCENE5_YEONGWOONG_CHOICE = {
  prompt: '어떻게 인사할까?',
  options: [
    {label:'① "죄송합니다 선배님! 안녕하십니까!"', key:'1'},
    {label:'② "아, 선배님 후광이 너무 눈부셔서 미처 뵙지 못했습니다."', key:'2'},
  ]
};

const SCENE5_YEONGWOONG_OUTCOMES = {
  '1': {
    yeongwoong:-1,
    lines:[
      {type:'line', speaker:YEONGWOONG, text:'안녕 안하지 새끼야. 네가 기분 다 말아먹었는데, 골때리는 새끼네. 이거', stopBgm:true},
      {type:'narration', text:'이영웅은 그러고 그냥 지나쳐 간다.'},
      {type:'narration', text:'(...)'},
      {type:'narration', text:'(...)'},
      {type:'thought', text:'뭐지..'},
    ]
  },
  '2': {
    yeongwoong:+1,
    lines:[
      {type:'line', speaker:YEONGWOONG, text:'후광? 얘 존나 웃기네. 이거 말발 봐라?'},
      {type:'narration', text:'머리는 한층 부풀어 올랐지만, 그와 동시에 입꼬리도 미묘하게 올라가 있다.'},
      {type:'narration', text:'그러고 그냥 주머니에 손을 꽂은 채 골목 저편으로 사라졌다.', stopBgm:true},
    ]
  }
};

/* =========================================================
   씬 6 - 모모톡 (씬5 이후, 강승유/이영웅 루트별 채팅)
   ========================================================= */

// 강승유 루트 - 집, 밤
const SCENE6_SEUNGYU_INTRO = [
  {type:'narration', text:'치열했던 축구 대회의 여운도 완전히 가시고, 평화롭다 못해 지루한 일상으로 돌아왔다.', bgm:'Midnight Trip'},
  {type:'narration', text:'침대에 대자로 뻗어 스마트폰으로 숏폼 영상을 하염없이 내리던 그때, 익숙한 진동음과 함께 강승유의 프로필이 화면 상단에 팝업됐다.', openChat:'seungyu'},
  {type:'chat', from:SEUNGYU, text:'야, __PLAYER_NAME__. 자냐? ㅋㅋㅋ'},
  {type:'chat', from:'player', text:'눈 시퍼렇게 뜨고 폰 보는 중. 왜.'},
  {type:'chat', from:SEUNGYU, text:'아니 ㅋㅋㅋ 방금 편의점 갔다 오면서 우리 학교 쪽 지나왔거든?'},
  {type:'chat', from:SEUNGYU, text:'근데 이 시간에 교문 앞에 웬 사람이 서 있는 거임.'},
  {type:'chat', from:'player', text:'이 시간에 학교에 사람이 왜 있어. 야간 경비 아저씨겠지.'},
  {type:'chat', from:SEUNGYU, text:'ㄴㄴ 절대 아님. 경비 아저씨 패딩이 아니라, 검은색 옷을 위아래로 맞춰 입고 모자까지 푹 눌러쓰고 있더라니까?'},
  {type:'chat', from:SEUNGYU, text:'가만히 서서 본관 쪽만 뚫어지게 쳐다보고 있는데, 진짜 멀리서 보니까 무슨 코난에 나오는 검은 그림자 범인 실루엣인 줄 알았음;; 눈도 안 보이고 개소름 돋더라.'},
  {type:'narration', text:'녀석의 장난기 섞인 문자에 나도 모르게 헛웃음이 나왔다.'},
  {type:'narration', text:'평소에도 워낙 과장이 심하고 스릴러 병에 걸린 녀석이라 이번에도 대수롭지 않게 넘기려 했다.'},
  {type:'narration', text:'하지만... 머릿속에 묘하게 밤의 텅 빈 학교 건물이 그려지며 으스스한 기분이 감돌았다.'},
  {type:'chat', from:'player', text:'야, 밤중에 무섭게 개소리 마라. 그냥 야자 끝나는 자식 기다리는 학부모님이시겠지.'},
  {type:'chat', from:SEUNGYU, text:'에이, 학부모 비주얼이 아니라니까? 분위기 존나 다크했음.'},
  {type:'chat', from:SEUNGYU, text:'암튼 밤에 학교 근처 얼씬도 하지 마라 ㅋㅋㅋ 너 골키퍼 할 때 보니까 몸은 잘 날려도 둔해서 쫓아오면 제일 먼저 잡히기 딱 좋음 ㅇㅇ'},
  {type:'chat', from:'player', text:'맞짱 깔래? 너나 조심해라 ㅋㅋㅋ'},
  {type:'chat', from:SEUNGYU, text:'ㅋㅋㅋㅋ 난 내일 진로과제연구 벼락치기 해야 해서 이만 자러 간다. 너도 헛것 보지 말고 빨리 자라~'},
];

const SCENE6_SEUNGYU_CHOICE = {
  prompt: '어떻게 답장할까?',
  options: [
    {label:'① 아무 말 없이 공포 유튜브 채널 "기묘한 밤"의 최신 영상을 보낸다.', key:'1'},
    {label:'② 그냥 잔다.', key:'2'},
  ]
};

const SCENE6_SEUNGYU_OUTCOMES = {
  '1': {
    seungyu:+1,
    lines:[
      {type:'narration', text:'며칠 전 알고리즘에 떠서 봤던 기억이 난다.'},
      {type:'narration', text:'마침 썸네일부터 시커먼 실루엣이 그려진, 피가 거꾸로 솟을 만큼 오싹한 영상이다. 링크를 복사해 아무 말 없이 승유에게 전송했다.'},
      {type:'narration', text:'1분 뒤... 분명 자러 간다던 녀석의 1이 빛의 속도로 사라졌다.'},
      {type:'chat', from:SEUNGYU, text:'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ'},
      {type:'chat', from:'player', text:'벼락치기 힘내라고 ㅋ'},
      {type:'chat', from:SEUNGYU, text:'와... 근데 너 "기묘한 밤" 채널 보냐? 대박 ㅋㅋㅋ 이거 아는 애들 진짜 별로 없는데!'},
      {type:'chat', from:SEUNGYU, text:'나 여기 알람 설정까지 해두고 새 영상 올라올 때마다 챙겨보는 찐팬임;; 방금 보내준 거 이번에 새로 올라온 폐교 에피소드 맞지?'},
      {type:'chat', from:'player', text:'어, 니가 말한 검은 실루엣이랑 비슷해 보여서 보냄.'},
      {type:'narration', text:'뜻밖의 공포 채널 취향 저격으로 승유에게서 긍정적인 답변이 왔다.', closeChat:true},
      {type:'narration', text:'녀석의 폭풍 답장을 받아주며, 나는 만족스러운 미소를 지으며 스마트폰을 내려놓았다.'},
    ]
  },
  '2': {
    seungyu:0,
    lines:[
      {type:'narration', text:'강승유와의 톡이 끊기고 메신저 창을 닫았다.', closeChat:true},
      {type:'narration', text:'스마트폰의 차가운 블루라이트가 어두운 방 안을 비춘다.'},
      {type:'narration', text:'창문 너머로 스산한 밤바람 소리가 들려오고, 녀석이 말한 \'검은 실루엣\'이라는 단어가 묘하게 뇌리에 박혀 쉽게 잠이 오지 않을 것 같은 밤이다.'},
    ]
  }
};




// COLLECTOR ENDING
// 히든 엔딩을 제외한 6개의 엔딩을 모두 수집한 뒤,
// 다른 캐릭터 엔딩 조건을 만족하지 않는 새 회차에서 재생
const SCENE_COLLECTOR_ENDING = [
  {
    type:'narration',
    text:'치열하고 다사다난했던 그 수많은 사건들을 지나, 어느덧 1년하고도 조금 넘는 시간이 흐른 지금.',
    clearBg:true,
    chars:{left:null, centerLeft:null, centerRight:null, right:null},
    bgm:'Messenger of Midnight'
  },
  {
    type:'narration',
    text:'교정에 흩날리던 봄꽃과 무더운 여름날의 녹음, 붉게 물들던 가을을 지나 마침내 차가운 입시의 계절이 찾아왔다.',
    showBg:'schoolgate',
    chars:{left:null, centerLeft:null, centerRight:null, right:null}
  },
  {type:'narration', text:'그리고 오늘, 내 인생의 가장 커다란 결전이었던 수능 시험이 마침내 끝이 났다.'},
  {type:'thought', text:'시험장에 들어서기 직전까지만 해도 심장이 터질 듯이 긴장되고 두려웠지만…… 문득 돌아본 내 곁에는 언제나 나를 받쳐주는 승유와 주헌이, 그리고 희가 함께 있었기에 견뎌낼 수 있었다.'},
  {type:'thought', text:'혼자서 헤매던 외로운 일상 속에서, 이들과 인연을 맺고 서로의 마음을 채워나가며 모았던 그 수많은 기억의 조각들.'},
  {type:'thought', text:'그 모든 시간들이 하나로 모여 지금의 나를 형성하고, 나를 그 어떤 순간보다 단단하게 만들어 주었던 것이다.'},
  {type:'narration', text:'마침내 수능을 마치는 종소리가 울리고……'},
  {
    type:'narration',
    text:'우리는 차가운 겨울 바람을 피해 학교 근처의 작고 따스한 카페로 모였다.',
    showBg:'collector_cafe',
    chars:{left:null, centerLeft:null, centerRight:null, right:null}
  },
  {
    type:'narration',
    text:'주황빛 조명 아래, 김이 모락모락 피어오르는 음료를 사이에 두고 마주 앉은 네 사람.',
    chars:{left:'seungyu_true_stand', centerLeft:'juheon', centerRight:null, right:'ganghee_true_stand'}
  },
  {type:'line', speaker:SEUNGYU, text:'아아~! 드디어 이 빌어먹을 수능이 끝났다!! 야, 너네들 오늘 시험 어땠어? 난 국어 비문학 지문 읽다가 뇌 누수 오는 줄 알았는데…… 좀 어렵지 않았냐?'},
  {type:'line', speaker:GANGHEE, text:'글쎄? 난 생각보다 꽤 잘 본 것 같은데? 내가 예측했던 출제 경향이랑 딱 맞아떨어지더라고. 후후, 너네는 어때?'},
  {type:'line', speaker:JUHEON, text:'……어. 나도. 무난하게 평소 나오던 대로 나온 것 같아.'},
  {type:'line', speaker:SEUNGYU, text:'뭐야?! 너네 다들 시험지가 좀 쉬웠냐?! 젠장, 나는 이번에 진짜 역대급으로 어렵길래 ‘아, 나만 잘 보면 대박이다’ 싶어서 속으로 싱글벙글했는데…… 까비 ㅋㅋㅋ!'},
  {type:'line', speaker:PLAYER, text:'하하, 뭐야 승유야 ㅋㅋㅋ 어, 나도 큰 실수 없이 잘 치른 것 같아. 기대했던 것 이상으로 괜찮게 나왔어!'},
  {type:'line', speaker:SEUNGYU, text:'오~ 대박! 결국 우리 네 명 다 대성공이라는 거잖아? 오늘 완전 잔칫날이네!'},
  {type:'line', speaker:GANGHEE, text:'그러게 말이야. 이제 답안지 채점이고 뭐고 다 잊고, 대학 가면 뭐 하고 놀지부터 계획 짜야 하는 거 아니야?'},
  {type:'line', speaker:JUHEON, text:'……그래. 고생 많았다, 다들.'},
  {type:'narration', text:'주헌이의 나지막한 노고와 승유의 시끄러운 환호, 그리고 희의 자신감 넘치는 웃음소리가 카페 안을 따스하게 채운다.'},
  {type:'narration', text:'수험표를 틀어쥐고 서로의 선전을 축하하며, 앞으로 펼쳐질 수천 가지의 미래와 행복한 이야기들을 끊임없이 터뜨렸다.'},
  {type:'thought', text:'지난날 내가 써내려왔던 모든 선택과 인연들이 모여, 마치 완성된 하나의 아름다운 앨범처럼 내 앞에 펼쳐지는 기분이었다.'},
  {type:'thought', text:'그 무엇 하나 빠짐없이 소중하게 모아온 우리들의 조각들.'},
  {type:'thought', text:'그것들이 만들어낸 오늘이라는 최고의 결말 속에서…… 나는 지금, 세상 그 누구보다 충만하고 행복하다.'},
  {type:'narration', text:'카페 안의 따스한 온기에 젖어 한참을 깔깔거리며 이야기를 나누던 바로 그때.'},
  {
    type:'narration',
    text:'딸랑거리는 맑은 종소리와 함께, 바깥의 차가운 겨울 바람을 한껏 머금은 누군가가 문을 열고 안으로 걸어 들어왔다.',
    chars:{left:'seungyu_true_stand', centerLeft:'juheon', centerRight:'ganghee_true_stand', right:'senior_sil'},
    stopBgm:true
  },
  {
    type:'narration',
    text:'시원시원한 체구와 익숙하고 미더운 얼굴…… 바로 영웅이 형이었다.',
    chars:{left:'seungyu_true_stand', centerLeft:'juheon', centerRight:'ganghee_true_stand', right:'yeongwoong'},
    clearDim:true,
    bgm: 'Daily Routine'
  },
  {type:'line', speaker:YEONGWOONG, text:'어이! 너네들 그동안 잘 지냈냐? 승유 이 녀석이 수능 끝난 기념으로 형 얼굴 좀 보러 오라고 난리를 치길래 바쁜 시간 쪼개서 달려왔더니…… 크, 이렇게 다 모여 있었구만!'},
  {type:'line', speaker:SEUNGYU, text:'오~! 형 진짜 오셨네요! 안녕하세요~!'},
  {type:'line', speaker:PLAYER, text:'영웅이 형! 진짜 오랜만이에요, 보고 싶었어요!'},
  {type:'line', speaker:YEONGWOONG, text:'하하! 이 새끼, 형 보고 싶었단 말은 잘해요. 오늘 다들 고생 많았다! 가자, 형이 오늘 수능 끝난 기념으로 고기 원 없이 쏜다!'},
  {type:'narration', text:'반가운 고함과 왁자지껄한 인사가 카페 안을 가득 채웠다.'},
  {type:'narration', text:'우리는 카페를 나와 가벼운 발걸음으로 근처 고깃집으로 자리를 옮겼다.'},
  {type:'narration', text:'지글지글 소리를 내며 불판 위에서 노릇하게 익어가는 고기 냄새, 모락모락 피어오르는 연기 사이로 끊임없이 오가는 술잔과 음료수 잔의 마찰음.'},
  {type:'thought', text:'생각해 보면, 영웅이 형까지 포함해 이렇게 우리 모두가 한자리에 다시 모인 게 대체 얼마 만인지 모른다.'},
  {type:'thought', text:'작년에 의대에 당당히 입학한 형은 치열하고 바쁜 대학 생활을 보내느라 정신이 없었고, 우리 역시 고3이라는 팍팍하고 숨 막히는 입시의 터널을 버텨내느라 다 같이 한자리에 모이는 것조차 쉽지 않은 일이었다.'},
  {type:'thought', text:'하지만 각자의 궤도를 돌다 돌아와 다시 만난 지금, 마치 어제도 만났던 사람들처럼 자연스럽게 서로의 자리를 채워주고 있었다.'},
  {type:'thought', text:'투덜거리면서도 서로에게 고기를 얹어주는 승유와 주헌이, 엉뚱한 한마디로 분위기를 자빠뜨리는 희, 그리고 선배로서 든든하게 우리를 바라보며 잔을 기울이는 영웅이 형까지.'},
  {type:'thought', text:'오랜만에 마주하는 이 친근하고 다정한 풍경을 가만히 바라보고 있자니, 가슴 깊은 곳에서부터 뭉클한 온기가 차올랐다.'},
  {type:'thought', text:'다시 다 같이 모여 마음 놓고 웃을 수 있다는 게, 이렇게 한 사람 한 사람과 소중한 인연으로 이어져 있다는 게 얼마나 커다란 기적이자 축복인지.'},
  {type:'thought', text:'다시 보니 참 좋다…… 정말이지 너무나도 좋다.'},
  {type:'thought', text:'수많은 고민과 시련의 갈림길을 지나 마침내 도착한 오늘.'},
  {type:'thought', text:'나는 조용히 잔을 들며 마음속으로 깊이 소원해 본다.'},
  {type:'thought', text:'앞으로 펼쳐질 내 인생의 남은 페이지들에도, 바로 오늘처럼 다사롭고 무결한 기쁨만이 가득하기를.'},

  {type:'timecard', text:'10년 후...', nextBg:'collector_spring', stopBgm:true},

  {
    type:'narration',
    text:'수능날 밤, 뜨거운 고깃집에서 서로의 미래를 축하하며 잔을 부딪쳤던 그날로부터 어느덧 10년이라는 긴 세월이 흘렀다.',
    chars:{left:null, centerLeft:null, centerRight:null, right:null}
  },
  {type:'narration', text:'각자의 꿈을 향해 거칠게 달려간 우리들은 어느새 번듯한 사회인이 되었고, 나는 오랜만에 옛 친구들의 얼굴을 하나씩 직접 확인하기 위해 발걸음을 옮겼다.'},

  {
    type:'narration',
    text:'가장 먼저 찾아간 곳은 수천 명의 함성으로 쿠쿵거리며 흔들리는 거대한 실내 체육관이었다.',
    showBg:'collector_boxing_gym',
    chars:{left:null, centerLeft:null, centerRight:null, right:null}
  },
  {type:'narration', text:'화려한 조명 아래, 사각의 링 위에서 땀방울을 흩뿌리며 상대의 가드를 폭발적인 콤비네이션으로 부수는 녀석이 보였다.'},
  {type:'narration', text:'땡! 경기 종료를 알리는 벨 소리와 함께 심판이 녀석의 손을 높이 들어 올렸다.'},
  {type:'narration', text:'‘동급 최연소 세계 챔피언 타이틀 방어 성공’이라는 전광판의 문구와 함께, 승유가 챔피언 벨트를 어깨에 걸쳐 메고 링 아래의 나를 발견했다.'},
  {type:'line', speaker:SEUNGYU_ADULT, text:'야! 너 왔냐?! 봤지? 이 형님이 세계 최연소 챔피언 타이틀 또 지켜내는 거! 나 아직 안 죽었다니까!', showBg:'true_seungyu_cg', chars:{left:null, centerLeft:null, centerRight:null, right:null}, bgm:'Hello SY'},
  {type:'narration', text:'링을 딛고 가볍게 뛰어내린 승유가 땀에 젖은 얼굴로 해맑게 웃으며 내 어깨를 툭 쳤다.'},
  {type:'narration', text:'학창 시절 복싱 선수 출신이라고 까불던 녀석은 마침내 주먹 하나로 세계 정상에 섰지만, 나를 바라보는 그 순수하고 뜨거운 눈빛만큼은 10년 전 교문 앞에서 손을 흔들던 그 시절 그대로였다.'},

  {
    type:'narration',
    text:'두 번째로 발걸음을 옮긴 곳은 서늘한 소독약 냄새가 진동하는 한 대학병원의 흉부외과 동이었다.',
    clearBg:true,
    chars:{left:null, centerLeft:null, centerRight:null, right:null},
    stopBgm:true
  },
  {type:'narration', text:'녹색 수술복을 입고 청진기를 목에 걸은 채, 수많은 차트와 모니터 사이를 바쁘게 오가는 녀석.', showBg:'true_ganghee_cg', bgm:'Kurumi BGM'},
  {type:'narration', text:'이제 막 흉부외과에 입성한 신입 의사 강희였다.'},
  {type:'line', speaker:GANGHEE_ADULT, text:'왔어? 하아…… 흉부외과는 진짜 사람이 할 짓이 못 되네. 사흘째 제대로 잠도 못 잤다니까?'},
  {type:'line', speaker:GANGHEE_ADULT, text:'그래도 뭐…… 어쩌겠어. 옛날에 열심히 공부해둔 터로 이젠 진짜 사람 목숨을 건져내고 있는데! 후후, 나 멋있지?'},
  {type:'narration', text:'지쳐 피곤함이 가득한 눈빛 속에서도, 환자의 생명을 짊어진 책임감과 특유의 다정한 자신감이 엿보였다.'},
  {type:'narration', text:'처음엔 그저 엉뚱하고 사차원인 줄로만 알았던 희는, 이제 타인의 가장 깊은 숨통을 살려내는 누구보다 훌륭한 의사로 성장해 있었다.'},

  {
    type:'narration',
    text:'세 번째로 도착한 곳은 강남 한복판, 세련되고 화려한 인테리어가 돋보이는 대형 성형외과 의원이었다.',
    clearBg:true,
    chars:{left:null, centerLeft:null, centerRight:null, right:null},
    stopBgm:true
  },
  {type:'narration', text:'원장실 문을 열고 들어가자, 고급스러운 원목 책상 뒤에서 맞춤 정장을 차려입은 영웅이 형이 나를 반갑게 맞이해 주었다.', showBg:'true_yeongwoong_cg', bgm:'Static in the Static'},
  {type:'narration', text:'어느 정도 업계에서 확고한 지위와 명성을 얻은 형이었지만…… 문득 바라본 형의 얼굴이 어딘가 모르게 달라져 있었다.'},
  {type:'line', speaker:PLAYER, text:'어…… 형, 오랜만이에요! 근데…… 어, 형 얼굴이 뭔가 많이 변하신 것 같은데요……?'},
  {type:'line', speaker:YEONGWOONG, text:'ㅋㅋㅋ 하하하! 이 새끼, 단번에 알아보네! 야, 성형외과 원장이 자기 얼굴에 직접 임상실험을 좀 해봐야 손님들한테 신뢰가 빡! 가지 않겠냐?'},
  {type:'line', speaker:YEONGWOONG, text:'어때? 형 손길이 직접 닿은 얼굴인데, 거울보고 해봤어 ㅋㅋ. 전보다 훨씬 더 날렵하고 잘생겨졌지? 하하하!'},
  {type:'narration', text:'여전한 털털함과 거침없는 호탕함에 나도 모르게 폭소가 터져 나왔다.'},
  {type:'narration', text:'자기 일에 대한 엄청난 자부심과 유쾌함으로 수많은 사람들에게 새로운 삶을 선물하는 형은, 여전히 내 삶의 가장 크고 든든한 영웅이었다.'},

  {
    type:'narration',
    text:'그리고 마침내, 나는 도시의 가장 높은 빌딩 마천루에 위치한 마지막 장소로 향했다.',
    clearBg:true,
    chars:{left:null, centerLeft:null, centerRight:null, right:null},
    stopBgm:true
  },
  {type:'narration', text:'‘ester CAD’ — 수면 아래 숨겨진 세계의 미학과 비밀을 탐구하던 그 조그만 팀은, 어느덧 세상을 뒤흔드는 거대한 혁신 기업으로 거듭나 있었다.'},
  {type:'narration', text:'두꺼운 원목 문을 열고 들어서자, 통유리창 너머로 도시의 야경을 굽어보고 있던 주헌이가 천천히 뒤를 돌아보았다.'},
  {type:'narration', text:'완벽하게 재단된 슈트를 입고 ‘ester CAD’의 CEO로서 묵직한 아우라를 풍기는 주헌이.', showBg:'true_juheon_cg', bgm:'You are the One arrange'},
  {type:'line', speaker:JUHEON_ADULT, text:'……왔냐.'},
  {type:'line', speaker:JUHEON_ADULT, text:'10년이라는 시간이 지났는데도…… 넌 여전하네.'},
  {type:'narration', text:'녀석은 슬그머니 특유의 옅은 미소를 지으며 무심하게 의자를 끌어내어 내게 내밀었다.'},
  {type:'line', speaker:JUHEON_ADULT, text:'들어와라. 네가 언제 찾아오든 앉을 수 있게, CEO실 옆의 이 자리는 10년 동안 단 한 번도 비워둔 적 없으니까.'},
  {type:'line', speaker:JUHEON_ADULT, text:'우리가 함께 파헤치고 만들어왔던 그 숨겨진 조각들이…… 결국엔 이렇게 멋진 세상을 만들었어.'},
  {type:'narration', text:'주헌이의 나지막한 목소리와 함께, 창밖으로 펼쳐진 수만 개의 반짝이는 도시 불빛들이 눈에 들어왔다.'},
  {type:'thought', text:'세계 최연소 복싱 챔피언이 된 승유.'},
  {type:'thought', text:'사람의 심장을 살려내는 의사가 된 희.'},
  {type:'thought', text:'자신만의 신념으로 타인의 아름다움을 완성하는 영웅이 형.'},
  {type:'thought', text:'그리고 숨겨진 미학을 세상에 펼쳐내는 최고경영자가 된 주헌이까지.'},
  {type:'thought', text:'치열했던 고교 시절, 서로를 믿고 의지하며 끌어모았던 그 모든 인연과 기억의 조각들.'},
  {type:'thought', text:'그 소중한 수집품들이 마침내 완벽한 하나의 궤적을 이루어, 10년 후의 오늘을 이토록 찬란하게 빛내고 있었다.'},
  {type:'thought', text:'나는 주헌이가 건넨 잔을 들며, 노을빛보다 다정한 눈으로 창밖의 세상을 바라보았다.'},
  {type:'thought', text:'모든 선택이 옳았고, 모든 인연이 소중했다.'},
  {type:'thought', text:'나는 지금, 내 생애 가장 완벽하고 충만한 기쁨 속에 서 있다.'},
];

// 강 희 엔딩 (씬에 상관없이 강 희 호감도가 양수인 경우)
const SCENE_GANGHEE_ENDING = [
  {type:'narration', text:'그 수많은 소동과 복잡했던 일들이 지난 뒤, 내 삶은 다시 무던하고 평범한 학교 생활로 돌아왔다.', showBg:'classroom', chars:{left:null, right:null}},
  {type:'narration', text:'지루한 수업을 듣고, 종이 울리면 쉬는 시간을 즐기며, 시험 기간이 오면 한숨을 쉬는 지극히 보통의 매일매일.'},
  {type:'narration', text:'하지만 이전과 드라마틱하게 달라진 점이 단 하나 있다면…… 지금 내 곁에는 ‘강희’라는 조금 특별한 애가 자리 잡았다는 사실이다.'},
  {type:'thought', text:'사실 강희에게는 조금 실례되는 생각일지도 모르지만, 처음 녀석을 알게 되었을 때는 사차원에다 속을 알 수 없는 약간 이상한 애라고만 생각했었다.'},
  {type:'thought', text:'하지만 함께 시간을 보내고 교류가 늘어갈수록, 강희에 대해 내가 알지 못했던 여러 모습을 새로이 알 수 있었다.'},
  {type:'thought', text:'엉뚱해 보이는 겉모습 뒤에 숨겨진 의외의 섬세함이나, 남들은 쉽게 지나칠 작은 부분까지 다정하게 챙겨줄 줄 아는 따뜻함 같은 것들.'},
  {type:'thought', text:'그렇게 서로의 일상에 스며들다 보니, 어느새 우리는 서로가 서로에게 자연스럽게 기댈 수 있고 마음을 터놓을 수 있는 든든한 의지의 존재가 되어 있었다.', showBg:'ganghee_end_photo', chars:{left:null, right:null}, bgm:'Ganghee Portrait'},
  {type:'line', speaker:GANGHEE, text:'어이, 거기 고3! 골머리 썩고 있지 말고 이리로 가져와 봐. 내가 네 생활기록부 한 번 컨펌해 줄까? 흠, 남들 같으면 거들떠도 안 보겠지만…… 넌 나랑 친하니까 특별히 엄청 열심히, 꼼꼼하게 봐줄게! ㅋㅋㅋ', chars:{left:null, right:null}},
  {type:'narration', text:'자신만만한 표정으로 손가락을 튕기며 생기부 서류를 내놓으라는 듯 손을 내미는 강희.'},
  {type:'narration', text:'평소엔 장난기 가득한 얼굴을 하다가도, 나를 도와줄 때만큼은 누구보다 진지해지는 녀석의 엉뚱하면서도 미미한 다정함에 나도 모르게 푸근한 웃음이 터져 나온다.'},
  {type:'line', speaker:PLAYER, text:'오, 진짜? 고맙다 희야! 크, 네 덕분에 나 나중에 원하는 대학 잘 붙으면 내가 진짜 맛있는 거 풀코스로 쏠게. 진짜 고맙다 ㅋㅋㅋ!'},
  {type:'line', speaker:GANGHEE, text:'오호~ 말로만 그러기 없기다? 나 비싼 거 먹을 거니까 딱 기억해 둬라!', chars:{left:null, right:null}},
  {type:'narration', text:'티격태격 장난을 주고받으며 교실 창문 너머로 따스한 햇살이 내려앉는 것을 느낀다.'},
  {type:'thought', text:'거창하거나 극적인 변화는 없을지라도, 서로를 온전히 이해해 주는 누군가와 함께 걸어가는 이 순간.', chars:{left:null, right:null}},
  {type:'thought', text:'나는 지금, 이대로의 일상이 딱 마음에 들고 괜찮은 것 같다.'},
];

// 평범한 일상 엔딩 (씬6 종료 후 다른 엔딩 조건을 충족하지 못한 경우)
const SCENE6_NORMAL_ENDING = [
  {type:'narration', text:'그 수많은 소동과 사건들이 지난 뒤, 내 삶은 언제 그랬냐는 듯 무던하고 평범한 학교 생활로 되돌아왔다.', showBg:'schoolgate', chars:{left:null, right:null}},
  {type:'narration', text:'특별히 가까워진 사람도, 눈에 띄게 멀어진 사람도 없이, 나는 여전히 타인과 적당한 거리를 유지한 채 고요한 내 궤도를 돌고 있다.'},
  {type:'thought', text:'돌이켜보면 삶이란, 그리고 사람과 사람 사이의 관계라는 것은 결코 뜻대로 풀리는 법이 없다.'},
  {type:'thought', text:'뜨겁게 불타오르다가도 허무하게 식어버리고, 서로를 이해하려 애쓸수록 오히려 깊은 오해의 골만 파이기도 하니까.'},
  {type:'thought', text:'그래서 나는 생각한다.'},
  {type:'thought', text:'굳이 누군가의 마음 깊숙한 곳에 특별한 사람으로 남으려 애쓰기보다, 그 누구에게도 미움받지 않고 무탈하게 지나가는 삶이라면…… 그걸로 충분히 만족해야겠다고.'},
  {type:'thought', text:'‘소탐대실’이라 하지 않는가.'},
  {type:'thought', text:'손에 쥐지도 못할 자그마한 욕심이나 온기에 집착하다 보면, 정작 지켜내야 할 나 자신의 일상마저 어느 순간 모조리 망가져 있을 테니 말이다.'},
  {type:'thought', text:'아직 세상에는 내가 알지 못하는 수많은 부류의 사람들이 존재하고, 내가 경험해 보지 못한 아득히 넓은 세계가 나를 기다리고 있다.', showBg:'normal_end_photo', chars:{left:null, right:null}, bgm:'Fading Static'},
  {type:'thought', text:'지나간 일들에 연연하며 제자리에 머물기에는, 다가올 날들이 너무나 까마득하게 길다.'},
  {type:'thought', text:'비록 흉터처럼 남은 기억들도 있지만, 복잡했던 여러 사건들을 겪어내며 나 역시 이전보다 한층 더 단단해지고 성숙해졌음을 느낀다.'},
  {type:'thought', text:'특별하지 않아도 괜찮다. 유난스럽지 않아도 상관없다.'},
  {type:'thought', text:'조용히 나만의 속도로 걸어 나갈, 눈앞에 다가올 미지의 미래가…… 나는 지금, 너무나도 기대된다.'},
];

// 강승유 엔딩 (씬6 이후, 승유 호감도 3 이상)
const SCENE6_SEUNGYU_HIGH_ENDING = [
  {type:'narration', text:'그 사건이 지나간 뒤, 내 하루는 거짓말처럼 이전과 다름없는 평범한 일상으로 되돌아왔다.', showBg:'schoolgate', chars:{left:null, right:null}},
  {type:'narration', text:'아침이면 졸린 눈을 비비며 교문을 지나고, 지루한 수업 시간을 버텨내며, 오후가 되면 주황빛으로 물드는 교실 창밖을 멍하니 바라보는 그런 보통의 학교 생활.'},
  {type:'narration', text:'하지만 전과 드라마틱하게 달라진 게 단 하나 있다면…… 지금 내 옆에는, 그 무엇보다 든든하고 친밀한 승유가 존재한다는 것이다.'},
  {type:'thought', text:'혼자서 모든 감정과 무게를 짊어지고 지낼 때는 전혀 몰랐었다.'},
  {type:'thought', text:'언제든 돌아보면 그 자리에 있고, 내가 흔들릴 때 군말 없이 어깨를 내어줄 수 있는 \'친구\'라는 존재가 내 삶 전반에 얼마나 크고 깊은 온기를 더해주는지.'},
  {type:'thought', text:'어쩌면 세상의 모든 관계란 결코 모두를 만족시킬 수 없을지도 모른다.'},
  {type:'thought', text:'열 명의 사람이 있다면, 그중 한 명은 이유도 없이 나를 미워하거나 비난할 것이고, 또 다른 한 명은 그저 나라는 이유 하나만으로 다정하게 손을 내밀어 줄 테니까.'},
  {type:'thought', text:'그 불완전한 세상 속에서 우리가 해야 하는 진짜 역할은, 나를 무작정 미워하는 사람들에게 진을 빼는 것이 아니라…… 이유 없이 나를 좋아해 주는 단 한 사람, 혹은 내 마음의 에너지 한도 내에서 서로를 보듬을 수 있는 소중한 몇 명에게 기꺼이 의지하고 또 의지가 되어주는 일이었다.'},
  {type:'thought', text:'그리고 지금 내 세상에서, 나를 온전히 받쳐주는 그 다정하고 단단한 존재는 바로 승유다.'},
  {type:'line', speaker:SEUNGYU, text:'야! 거기서 멍하니 뭐 해, ㅋㅋㅋ! 빨리 안 오냐? 오늘 우리 9평 끝난 기념으로 맛있는 거 먹으러 가기로 한 날이잖아!', showBg:'seungyu_ending', chars:{left:null, right:null}, bgm:'Fading Echoes'},
  {type:'narration', text:'교문 앞, 노을빛을 등지고 서서 나를 향해 해맑게 손을 흔드는 승유의 모습이 보인다.'},
  {type:'narration', text:'익숙하게 투덜거리면서도 입가에는 숨길 수 없는 미소가 가득 걸려 있는 녀석.'},
  {type:'narration', text:'그 별것 아닌 손짓 하나에 내 안에 남아있던 마지막 불안과 외로움마저 사르르 녹아내리는 기분이 들었다.'},
  {type:'line', speaker:PLAYER, text:'어! 금방 갈게, 승유야!'},
  {type:'narration', text:'가방끈을 고쳐 매고, 나를 기다리고 있는 승유를 향해 가벼운 발걸음으로 달려간다.'},
  {type:'narration', text:'시원한 저녁 바람이 뺨을 스치고, 맞은편에서 다정하게 나를 맞이하는 녀석의 온기가 느껴진다.'},
  {type:'narration', text:'누군가에게 완벽하게 이해받고, 누군가와 온전히 이어져 있다는 이 감각.'},
  {type:'thought', text:'나는 지금, 더할 나위 없이 소중하고 완벽하게 행복하다.'},
];

// 이영웅 루트 - 집(메신저 대화), 주말 오후
const SCENE6_YEONGWOONG_INTRO = [
  {type:'narration', text:'골목길에서의 아찔한 첫 만남 이후, 운명의 장난인지 이영웅 선배와 같은 동아리에 들어가게 되었다.'},
  {type:'narration', text:'처음엔 그 악명 높은 더러운 성격에 숨도 못 쉴 줄 알았는데, 맨날 틱틱대면서도 은근히 츤데레처럼 챙겨주는 선배의 짬바 덕분에 지금은 선후배 사이를 넘어 제법 친한 형 동생 사이가 되었다.'},
  {type:'narration', text:'주말 오후, 침대에 누워 뒹굴거리다 보니 몸이 은근히 근질근질해졌다.'},
  {type:'narration', text:'나는 휴대폰을 들고 영웅 선배의 카톡 창을 켰다.', openChat:'yeongwoong', bgm:'Midnight Trip'},
  {type:'chat', from:'player', text:'선배님, 날씨도 좋은데 주말에 배드민턴 한 판 때리실래요?'},
  {type:'narration', text:'카톡을 보내기가 무섭게 \'1\'이 사라지더니, 특유의 까칠한 말투가 화면을 채운다.'},
  {type:'chat', from:YEONGWOONG, text:'야, 미쳤냐? 곧 수능인 고3한테 배드민턴?'},
  {type:'chat', from:YEONGWOONG, text:'너 진짜 나한테 라켓으로 뚝배기 깨지고 싶어서 환장했냐? 형 지금 누워있다 건들지 마라.'},
  {type:'narration', text:'예상대로 순순히 나올 인물이 아니다.'},
];

const SCENE6_YEONGWOONG_CHOICE = {
  prompt: '어떻게 답장할까?',
  options: [
    {label:'① "쫄?" 이라고 보낸다.', key:'1'},
    {label:'② "원래, 적절한 기분 전환도 필요한 법이에요." 라고 보낸다.', key:'2'},
  ]
};

const SCENE6_YEONGWOONG_OUTCOMES = {
  '1': {
    yeongwoong:+1,
    lines:[
      {type:'narration', text:'그리고 연달아 메시지를 보냈다.'},
      {type:'chat', from:'player', text:'쫄?'},
      {type:'chat', from:'player', text:'에이, 설마 저한테 질까 봐 쫄으신 건 아니죠? ㅋ'},
      {type:'chat', from:YEONGWOONG, text:'아, 이 새끼가 진짜 선을 넘네?'},
      {type:'chat', from:YEONGWOONG, text:'너 딱 기다려라. 진짜 오늘 코트 위에서 네 면상에 스매싱 꽂아버릴라니까.'},
      {type:'chat', from:'player', text:'ㅋㅋㅋ 그럼 30분 뒤에 학교 강당 코트에서 뵙는 걸로 알겠습니다?'},
      {type:'chat', from:YEONGWOONG, text:'어. 라켓 들고 기어 나와라. 늦으면 진짜 뒤진다.'},
      {type:'narration', text:'도발에 부들부들 떠는 이영웅이었다.', closeChat:true, stopBgm:true},
    ]
  },
  '2': {
    yeongwoong:-1,
    lines:[
      {type:'chat', from:'player', text:'원래, 적절한 기분 전환도 필요한 법이에요.'},
      {type:'chat', from:'player', text:'에이, 선배님 체력 보충 하셔야죠.'},
      {type:'chat', from:YEONGWOONG, text:'ㄴㅈ ㄲㅈ.'},
      {type:'chat', from:'player', text:'아 예? 배드민턴 같이해요~ 형?'},
      {type:'narration', text:'(...)', closeChat:true},
      {type:'narration', text:'(...)'},
      {type:'narration', text:'그렇게 영웅 선배한테 차단당한 오늘이었다.', stopBgm:true},
    ]
  }
};

// 이영웅 엔딩 (씬6 이후, 영웅 호감도 2 이상)
const SCENE6_YEONGWOONG_HIGH_ENDING = [
  {type:'narration', text:'그 파란만장했던 사건들이 지나간 뒤, 나는 다시 평범하고 무던한 학교 생활로 되돌아왔다.', showBg:'schoolgate', chars:{left:null, right:null}},
  {type:'narration', text:'수업 종이 울리면 자리에 앉고, 쉬는 시간엔 친구들과 소소한 잡담을 나누며, 매일 반복되는 시험과 입시의 압박을 견뎌내는 지극히 보통의 날들.'},
  {type:'narration', text:'하지만 이전과 비교했을 때 드라마틱하게 달라진 게 단 하나 있다면…… 내 곁에는 언제나 나를 든든하게 받쳐주는 영웅이 형이 있다는 것이다.'},
  {type:'thought', text:'혼자서 모든 고민과 무게를 홀로 짊어지고 지낼 때는 정말이지 전혀 알지 못했다.'},
  {type:'thought', text:'내가 진심으로 존경하고 기댈 수 있는 선배라는 존재가 내 삶 전반에 얼마나 커다란 울타리가 되어주고, 마음의 평온을 가져다주는지.'},
  {type:'thought', text:'세상의 모든 관계란 결코 모두를 만족시킬 수 없는 법이다.'},
  {type:'thought', text:'열 명의 사람이 있다면, 그중 한 명은 아무런 이유도 없이 나를 미워하거나 폄하할 것이고, 또 다른 한 명은 그저 나라는 사람 자체를 이유 없이 좋아하고 아껴줄 테니까.'},
  {type:'thought', text:'그 속에서 우리가 해야 하는 진짜 역할은, 나를 싫어하는 사람들에게 잘 보이려 애쓰며 에너지를 쏟아붓는 게 아니라…… 나를 있는 그대로 받아들여 주는 단 한 사람, 혹은 내가 감당할 수 있는 테두리 안에서 서로를 믿고 의지할 수 있는 소중한 인연들에게 마음을 다하는 것이었다.'},
  {type:'thought', text:'그리고 지금 내 삶에서, 나를 가장 단단하게 지탱해 주는 그 의지되는 존재가 바로 영웅이 형이다.', showBg:'yeongwoong_end_photo', chars:{left:null, right:null}, bgm:'Clutter'},
  {type:'line', speaker:YEONGWOONG, text:'야! 이 새끼 ㅋㅋㅋ 거기서 똥폼 잡고 혼자 분위기 타고 뭐 하냐? ㅋㅋㅋ 형이 너 얼굴 좀 보려고 바쁜 시간 쪼개서 친히 와줬다. 그래, 오늘 본 9평은 잘 쳤냐?', chars:{left:null, right:null}},
  {type:'narration', text:'교문 옆 벤치에 앉아 있던 내 앞에, 특유의 시원시원한 웃음을 지으며 영웅이 형이 다가왔다.'},
  {type:'narration', text:'치열한 노력 끝에 당당히 건국대 의대에 진학해 바쁜 대학 생활을 보내면서도, 형은 나를 잊지 않고 종종 이렇게 찾아와 내 안부를 묻곤 했다.'},
  {type:'narration', text:'여전히 거칠지만 특유의 장난기 속에 묻어나는 따뜻한 온기. 형의 얼굴을 보자마자 마음속에 뭉쳐있던 시험에 대한 스트레스가 뻥 뚫리는 기분이 들었다.'},
  {type:'line', speaker:PLAYER, text:'아, 망했어요 형 ㅠㅠㅠ…… 진짜 말도 마세요. 오늘 맛있는 거 사주실 거죠? 형이 쏘시는 거죠?!'},
  {type:'line', speaker:YEONGWOONG, text:'하하! 이 새끼 이거 형을 무슨 걸어 다니는 지갑으로 아나? 오냐, 형이 의대생의 넓은 마음으로 오늘 맛있는 거 실컷 쏘마. 따라와라!'},
  {type:'narration', text:'투덜거리는 내 머리를 헝클어뜨리며 앞장서 걸어가는 형의 등 뒤를 따라 걸음을 옮긴다.'},
  {type:'narration', text:'나보다 한참 앞서 걸어가며 길을 밝혀주는 형의 뒷모습이 오늘따라 더욱 크고 미더워 보였다.'},
  {type:'narration', text:'어두웠던 일상 속에서 나를 이끌어준 형이 있기에, 다가올 미래도 전혀 두렵지 않다.'},
  {type:'thought', text:'나는 지금, 더할 나위 없이 행복하다.'},
];
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
const JUHEON_ENDING_VISUAL_CUE = '그리고 지금 내 세상에서, 나를 가장 단단하고 온전하게 지탱해 주는 그 고마운 존재는 바로 주헌이다.';

const el = {
  stage: document.getElementById('stage'),
  box: document.getElementById('box'),
  text: document.getElementById('line-text'),
  nameplate: document.getElementById('nameplate'),
  nameMain: document.getElementById('name-main'),
  nameSub: document.getElementById('name-sub'),
  charLeft: document.getElementById('char-left'),
  charLeftImg: document.getElementById('char-left-img'),
  charCenterLeft: document.getElementById('char-center-left'),
  charCenterLeftImg: document.getElementById('char-center-left-img'),
  charCenterRight: document.getElementById('char-center-right'),
  charCenterRightImg: document.getElementById('char-center-right-img'),
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
};

let curLeftKey = null;
let curCenterLeftKey = null;
let curCenterRightKey = null;
let curRightKey = null;

/* ---- 모모톡 스타일 채팅 UI ---- */
const CONTACT_LIST = [
  { key:'seungyu', name:'강승유' },
  { key:'juheon', name:'송주헌' },
  { key:'ganghee', name:'강 희' },
  { key:'yeongwoong', name:'이영웅' },
];

function openChat(activeKey){
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
   씬 데이터의 각 줄에 bgm:'키' 를 붙이면 그 시점부터 assets/story/ep1/bgm/키.mp3 를 반복 재생한다.
   키에 확장자를 직접 쓰면(bgm:'키.wav', bgm:'키.ogg' 등) 그 확장자를 그대로 사용한다.
   이미 그 곡이 재생 중이면 아무 것도 하지 않는다(끊기지 않고 계속 흐름) - "한 씬에 기본적으로 하나,
   같은 곡이 다시 지정돼도 처음부터 다시 재생하지 않음"이라는 요구사항에 맞춘 것.
   같은 줄에 bgm 대신 stopBgm:true 를 쓰면 재생 중이던 곡을 그 자리에서 끊는다. */
const BGM_BASE = 'assets/story/ep1/bgm/';
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
  if(currentBgmKey === key) return;
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

  const file = /\.[a-z0-9]+$/i.test(key) ? key : `${key}.mp3`;
  el.bgmPlayer.src = `${BGM_BASE}${file}`;
  el.bgmPlayer.currentTime = 0;
  // 브라우저의 자동재생 정책상, 사용자가 아직 페이지를 한 번도 클릭하지 않은 채로 재생을 시도하면
  // play()가 거부될 수 있다 - 이 경우 조용히 무시한다(다음 클릭/줄 진행 때 자연히 다시 시도됨).
  el.bgmPlayer.play().catch(()=>{});
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

function updateCastLayout(){
  const presentCount = [
    curLeftKey,
    curCenterLeftKey,
    curCenterRightKey,
    curRightKey,
  ].filter(Boolean).length;

  el.stage.classList.toggle('trio-cast', presentCount === 3);
  el.stage.classList.toggle('quad-cast', presentCount >= 4);
}

// 같은 인물의 스프라이트만 바뀌는 경우(예: 강희 -> 강희2, 표정/모습 교체)를 판별하기 위한 그룹핑.
// CAST_SPEAKER_ALIASES(말할 때 음영 처리용)와 별개로, "다른 키지만 같은 사람"만 모아둔다.
const CHAR_IDENTITY_ALIASES = {
  seungyu_true_stand: 'seungyu',
  ganghee_true_stand: 'ganghee',
  senior_sil: 'yeongwoong',
  ganghee2: 'ganghee',
};
function characterIdentity(key){
  if(!key) return null;
  return CHAR_IDENTITY_ALIASES[key] || key;
}

const SPRITE_DIP_MS = 240;   // 같은 인물 표정 교체: 살짝 내려갔다(또는 다시 올라오는) 편도 시간
const SPRITE_EXIT_MS = 500;  // 퇴장 트랜지션(opacity/transform .5s)과 맞춤 - 다 내려간 뒤에야 이미지를 지운다

function playSlotEnter(container, image, key){
  container.classList.remove('dim', 'mystery-silhouette', 'mystery-revealing');
  image.src = CHAR_IMG[key];
  container.classList.remove('show');
  void container.offsetWidth; // 강제 리플로우 - show를 다시 붙였을 때 진입 트랜지션이 확실히 재생되게 함
  container.classList.add('show');
}

function playSlotExit(container, image){
  container.classList.remove('show');
  window.setTimeout(()=>{
    // 그 사이에 다른 인물이 이미 등장해버렸다면(show가 다시 붙었다면) 그 이미지를 건드리지 않는다.
    if(!container.classList.contains('show')) image.removeAttribute('src');
  }, SPRITE_EXIT_MS);
}

function setCharacterSlot(container, image, key, instant){
  if(key){
    if(container.classList.contains('show') && image.getAttribute('src') === CHAR_IMG[key]){
      return; // 이미 같은 모습으로 나와 있음 - dip/교체 연출에서 방금 막 처리된 경우
    }
    if(instant){
      container.classList.remove('dim', 'mystery-silhouette', 'mystery-revealing');
      image.src = CHAR_IMG[key];
      container.classList.add('show');
      return;
    }
    playSlotEnter(container, image, key);
  } else if(container.classList.contains('show')){
    if(instant){
      container.classList.remove('show', 'dim', 'mystery-silhouette', 'mystery-revealing');
      image.removeAttribute('src');
      return;
    }
    playSlotExit(container, image);
  } else {
    container.classList.remove(
      'show',
      'dim',
      'mystery-silhouette',
      'mystery-revealing'
    );
    image.removeAttribute('src');
  }
}

const CHAR_SLOT_DEFS = [
  {name:'left', container:()=>el.charLeft, image:()=>el.charLeftImg, get:()=>curLeftKey, set:(k)=>{curLeftKey=k;}},
  {name:'centerLeft', container:()=>el.charCenterLeft, image:()=>el.charCenterLeftImg, get:()=>curCenterLeftKey, set:(k)=>{curCenterLeftKey=k;}},
  {name:'centerRight', container:()=>el.charCenterRight, image:()=>el.charCenterRightImg, get:()=>curCenterRightKey, set:(k)=>{curCenterRightKey=k;}},
  {name:'right', container:()=>el.charRight, image:()=>el.charRightImg, get:()=>curRightKey, set:(k)=>{curRightKey=k;}},
];

// line.chars 안에 "이미 나와 있던 자리"의 값이 바뀌는 슬롯이 있으면(단순 신규 등장/완전 퇴장이 아니라),
// 같은 인물의 표정 교체는 살짝 내려갔다 올라오는 연출로, 다른 인물로의 교체는 기존 인물이 완전히
// 내려간 뒤 새 인물이 올라오는 연출로 먼저 재생한다. 이 연출이 진행되는 동안은 대사창을 잠깐 숨기고,
// 끝나면 renderCurrent()를 다시 불러서(같은 idx) 이어서 진행한다. 처리할 게 없으면 false를 반환해서
// 호출부가 곧바로 setChars로 넘어가게 한다(등장/퇴장만 있는 보통의 경우).
function tryPlayCharacterHandoff(chars){
  const changing = CHAR_SLOT_DEFS
    .filter(def => def.name in chars)
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
    dipSlots.forEach(s => {
      s.image.src = CHAR_IMG[s.newKey];
      s.container.classList.remove('sprite-dip-down'); // 같은 sprite-dip 트랜지션 속도를 유지한 채 다시 올라옴
      s.def.set(s.newKey);
    });
    handoffSlots.forEach(s => {
      playSlotEnter(s.container, s.image, s.newKey);
      s.def.set(s.newKey);
    });
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

  if('left' in chars){
    curLeftKey = chars.left;
    setCharacterSlot(el.charLeft, el.charLeftImg, chars.left, instant);
  }
  if('centerLeft' in chars){
    curCenterLeftKey = chars.centerLeft;
    setCharacterSlot(
      el.charCenterLeft,
      el.charCenterLeftImg,
      chars.centerLeft,
      instant
    );
  }
  if('centerRight' in chars){
    curCenterRightKey = chars.centerRight;
    setCharacterSlot(
      el.charCenterRight,
      el.charCenterRightImg,
      chars.centerRight,
      instant
    );
  }
  if('right' in chars){
    curRightKey = chars.right;
    setCharacterSlot(el.charRight, el.charRightImg, chars.right, instant);
  }

  updateCastLayout();
}

function clearAllCharacterDim(){
  [
    el.charLeft,
    el.charCenterLeft,
    el.charCenterRight,
    el.charRight,
  ].forEach(slot => slot.classList.remove('dim'));
}

function hideAllCharacters(){
  setChars({
    left:null,
    centerLeft:null,
    centerRight:null,
    right:null,
  });
}

const MYSTERY_REVEAL_MS = 1250;

function applyMysterySilhouetteImmediately(side){
  const target = side === 'left' ? el.charLeft : el.charRight;

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

  const target = side === 'left' ? el.charLeft : el.charRight;
  mysteryRevealTransitioning = true;

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
};

function normalizeCastSpeakerKey(key){
  return CAST_SPEAKER_ALIASES[key] || key;
}

function applySpeakingDim(speakerKey){
  // 나레이션과 독백은 직전에 지정된 연출용 음영을 유지한다.
  if(!speakerKey) return;

  const slots = [
    {key:curLeftKey, element:el.charLeft},
    {key:curCenterLeftKey, element:el.charCenterLeft},
    {key:curCenterRightKey, element:el.charCenterRight},
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

  backgroundTransitioning = true;
  typing = true;
  el.sceneFade.classList.add('active');

  window.setTimeout(()=>{
    setBg(nextBgKey);

    // 검은 화면 뒤에서 새 배경과 현재 대사를 먼저 준비한 뒤,
    // 오버레이를 걷어내며 페이드인한다.
    renderCurrent();

    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        el.sceneFade.classList.remove('active');
        window.setTimeout(()=>{
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

  timeCardTransitioning = true;
  backgroundTransitioning = true;
  typing = false;
  clearInterval(typeTimer);
  hideAllCharacters();

  el.dialogueWrap.classList.add('hidden');
  el.hint.style.visibility = 'hidden';
  el.sceneFade.classList.add('active');

  window.setTimeout(()=>{
    setBg(null);
    el.timeCardText.textContent = withPlayerName(line.text) || '10년 후...';
    el.timeCard.classList.add('show');
    el.timeCard.setAttribute('aria-hidden', 'false');

    window.setTimeout(()=>{
      el.timeCard.classList.remove('show');

      window.setTimeout(()=>{
        el.timeCard.setAttribute('aria-hidden', 'true');
        setBg(line.nextBg || null);

        requestAnimationFrame(()=>{
          requestAnimationFrame(()=>{
            el.sceneFade.classList.remove('active');

            window.setTimeout(()=>{
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

function playQueue(newQueue, endCallback){
  queue = newQueue;
  idx = 0;
  onQueueEnd = endCallback;
  juheonEndingVisualActive = false;
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

  if(line.stopBgm){
    playBgm(null);
  } else if(line.bgm){
    playBgm(line.bgm);
  }

  const hasBackgroundRequest = Boolean(line.clearBg || line.showBg);
  const requestedBgKey = line.clearBg ? null : (line.showBg || currentBgKey);
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
        centerLeft:el.charCenterLeft,
        centerRight:el.charCenterRight,
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

  if(line.impact){ triggerImpactShake(); }

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
  el.dialogueWrap.classList.remove('hidden');

  el.box.classList.remove('thought','narration','speech');
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
    } else {
      // 기본 캐릭터 또는 공동 대사 - 모든 스탠딩을 밝게
      clearAllCharacterDim();
    }
  }

  typeText(withPlayerName(line.text), reverseType);
}

function typeText(full, reverse){
  typing = true;
  el.text.textContent = '';
  el.hint.style.visibility = 'hidden';
  let i = reverse ? full.length - 1 : 0;
  clearInterval(typeTimer);
  typeTimer = setInterval(()=>{
    if(reverse){
      el.text.textContent = full[i] + el.text.textContent;
      i--;
      if(i < 0){
        clearInterval(typeTimer);
        typing = false;
        el.hint.style.visibility = 'visible';
      }
    } else {
      el.text.textContent += full[i];
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
  if(
    el.choiceLayer.classList.contains('show') ||
    el.endLayer.classList.contains('show') ||
    mysteryRevealTransitioning ||
    timeCardTransitioning ||
    backgroundTransitioning
  ) return;
  if(typing){
    clearInterval(typeTimer);
    const line = queue[idx];
    el.text.textContent = withPlayerName(line.text);
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
   - 게이트에 도달하자마자(티켓 소모 성공 여부와 무관하게) 지금까지 온 지점(currentSceneKey)을 먼저
     체크포인트로 저장해둔다. 이걸 안 하면 취소/티켓부족으로 못 넘어갔을 때 저장된 진행이 하나도 없어서
     "이어보기"가 아예 안 뜨고, 다시 시도할 때마다 입장 티켓을 새로 내고 처음부터 다시 봐야 했다.
   ========================================================= */
function gateNextScene(sceneKey, proceedFn){
  if(currentSceneKey){
    serverSaveCheckpoint(currentSceneKey);
  }

  function afterTicketOk(){
    currentSceneKey = sceneKey;
    serverSaveCheckpoint(sceneKey);
    proceedFn();
  }
  function afterTicketFail(){
    showTicketInsufficientModal();
  }
  function tryConsume(){
    consumeTicketOnServer().then(ok=>{
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
    const has1362 = typed.includes('1362');
    const matchCount = [hasHidden, hasBanjuk, has1362].filter(Boolean).length;

    let outcome;
    let isHiddenEnding = false;
    if(matchCount >= 2){
      outcome = SCENE6_JUHEON_HIGH_OUTCOME_E;
    } else if(matchCount === 0){
      outcome = SCENE6_JUHEON_HIGH_OUTCOME_D;
    } else if(has1362){
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
        el.charCenterLeftImg.removeAttribute('src');
        el.charCenterRightImg.removeAttribute('src');
        el.charRightImg.removeAttribute('src');

        playQueue(SCENE6_JUHEON_HIDDEN_INTRO.slice(), ()=>{
          // 배경 페이드가 시작되기 전에 윤대웅 스탠딩을 완전히 제거한다.
          hideAllCharacters();
          clearAllCharacterDim();
          el.charLeftImg.removeAttribute('src');
          el.charCenterLeftImg.removeAttribute('src');
          el.charCenterRightImg.removeAttribute('src');
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

const CG_GALLERY_ITEMS = [
  { id:'bad',          title:'BAD ENDING',        imageKeys:['end1_cg'] },
  { id:'normal',       title:'평범한 일상 엔딩', imageKeys:['normal_end_photo'] },
  { id:'juheon',       title:'송주헌 엔딩',       imageKeys:['juheon_end_photo'] },
  { id:'seungyu',      title:'강승유 엔딩',       imageKeys:['seungyu_ending'] },
  { id:'yeongwoong',   title:'이영웅 엔딩',       imageKeys:['yeongwoong_end_photo'] },
  { id:'ganghee',      title:'강 희 엔딩',        imageKeys:['ganghee_end_photo'] },

  { id:'true_seungyu',   title:'TRUE ENDING CG · 강승유',   trueEndingIndex:0 },
  { id:'true_ganghee',   title:'TRUE ENDING CG · 강 희',    trueEndingIndex:1 },
  { id:'true_yeongwoong',title:'TRUE ENDING CG · 이영웅',   trueEndingIndex:2 },
  { id:'true_juheon',    title:'TRUE ENDING CG · 송주헌',   trueEndingIndex:3 },

  { id:'hidden',       title:'HIDDEN ENDING',     imageKeys:['juheon_hidden_end_photo'] },
];

/* HIDDEN ENDING은 TRUE ENDING 해금 조건에 포함하지 않는다. */
const TRUE_ENDING_REQUIREMENTS = [
  'bad',
  'normal',
  'juheon',
  'seungyu',
  'yeongwoong',
  'ganghee',
];

const TRUE_ENDING_GALLERY_IDS = [
  'true_seungyu',
  'true_ganghee',
  'true_yeongwoong',
  'true_juheon',
];

const ENDING_CG_ID_BY_TITLE = {
  'BAD END': 'bad',
  'BAD ENDING': 'bad',
  '평범한 일상 END': 'normal',
  'NORMAL END': 'normal',
  '송주헌 END': 'juheon',
  '강승유 END': 'seungyu',
  '이영웅 END': 'yeongwoong',
  '강 희 END': 'ganghee',
  'TRUE ENDING': 'true',
  'TRUE END': 'true',
  '컬렉터 ENDING': 'true',
  'COLLECTOR END': 'true',
  'COLLECTOR ENDING': 'true',
  '히든 ENDING': 'hidden',
  'HIDDEN ENDING': 'hidden',
  'HIDDEN END': 'hidden',
};

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

// 도감은 에피소드별 섹션으로 나눠 표시한다. Episode 2/3의 CG는 아직 없으므로 빈 안내 문구만 보여준다.
const GALLERY_EPISODE_SECTIONS = [
  { label:'Episode 1', items: CG_GALLERY_ITEMS },
  { label:'Episode 2', items: [] },
  { label:'Episode 3', items: [] },
];

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
    lockImg.src = 'assets/icons/lock.png';
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
}

function closeGalleryModal(){
  const modal = document.getElementById('gallery-modal');
  if(!modal) return;

  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
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
  el.endAffection.innerHTML = `송주헌 호감도: ${affJuheon}<br>강승유 호감도: ${affSeungyu}<br>이영웅 호감도: ${affYeongwoong}<br>강희 호감도: ${affGanghee}`;
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

// 이어하기는 이미 티켓을 내고 도달했던 지점을 다시 보여주는 것뿐이므로, 게이트(gateNextScene)를
// 다시 거치는 playSceneX가 아니라 실제 렌더링만 하는 renderSceneX로 바로 연결한다(티켓 중복 소모 방지).
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
  document.getElementById('ep1-status').textContent = cachedProgress ? '이어하기' : '우정의 시작';
}

function updateEpisodeDetailScreen(){
  const startBtn = document.getElementById('episode-detail-start-btn');
  const restartBtn = document.getElementById('episode-detail-restart-btn');
  startBtn.textContent = cachedProgress ? '이어보기' : '시작하기';
  restartBtn.style.display = cachedProgress ? '' : 'none';
  document.getElementById('vn-autouse-toggle').checked = autoUseTickets;
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
  showLobbyScreen('episodeDetail');
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
  startGame();
});

// 이어보기/시작하기 버튼: 확인 모달 없이 바로 티켓 소모를 시도한다(취소할 "이전 씬"이 아직 없으므로).
document.getElementById('episode-detail-start-btn').addEventListener('click', async ()=>{
  // 이어보기: 이미 티켓을 내고 도달했던 지점을 다시 보여주는 것뿐이라 티켓을 새로 쓰지 않는다.
  if(cachedProgress){
    lobbyWrap.classList.add('hidden');
    resumeGame(cachedProgress);
    return;
  }

  const ok = await consumeTicketOnServer();
  if(!ok){
    showTicketInsufficientModal();
    return;
  }
  lobbyWrap.classList.add('hidden');
  startGame();
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
  if(currentSceneKey) serverSaveCheckpoint(currentSceneKey);
  exitToLobby();
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
  await fetchStoryState();
  renderGallery();
  updateEpisodeCardLabel();
})();
