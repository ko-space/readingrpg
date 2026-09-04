// 서브 스토리 1화(김남옥 편) "오랜만의 재회"의 대사/분기 데이터. 원본 프로토타입
// (오랜만의_재회_S1-13_프로토타입.html)의 대사를 그대로 이식하되, 이미지는 base64 대신
// assets/story/sub1_kimnamok/ 파일 경로를 쓴다. story/story-sub-engine.js가 이 파일을 전역으로
// 소비하므로, HTML에서 반드시 이 스크립트를 story-sub-engine.js보다 먼저 로드해야 한다.

const STORY_ID = "sub1_kimnamok";
const ASSET_BASE = "assets/story/sub1_kimnamok/";

const BG = {
  livingroom: ASSET_BASE + "backgrounds/livingroom.webp",
  classroom: ASSET_BASE + "backgrounds/classroom.webp",
  home2: ASSET_BASE + "backgrounds/home2.webp",
  building: ASSET_BASE + "backgrounds/building.webp",
  lobby: ASSET_BASE + "backgrounds/lobby.webp",
  office: ASSET_BASE + "backgrounds/office.webp",
  labdark: ASSET_BASE + "backgrounds/labdark.webp",
  labbright: ASSET_BASE + "backgrounds/labbright.webp",
  labsunset: ASSET_BASE + "backgrounds/labsunset.webp",
  teachersoffice: ASSET_BASE + "backgrounds/teachersoffice.webp",
  apartment: ASSET_BASE + "backgrounds/apartment.webp",
};
const CHAR_IMG = {
  kimnamok: ASSET_BASE + "characters/kimnamok.webp",
  employee1: ASSET_BASE + "characters/employee1.webp",
  kimnamok_ceo: ASSET_BASE + "characters/kimnamok_ceo.webp",
  bangimseok_uniform: ASSET_BASE + "characters/bangimseok_uniform.webp",
  kimnamok_uniform: ASSET_BASE + "characters/kimnamok_uniform.webp",
  kimnamok_uniform_front: ASSET_BASE + "characters/kimnamok_uniform_front.webp",
  bangimseok_labcoat: ASSET_BASE + "characters/bangimseok_labcoat.webp",
  kimnamok_labcoat: ASSET_BASE + "characters/kimnamok_labcoat.webp",
  kimnamok_labcoat_front: ASSET_BASE + "characters/kimnamok_labcoat_front.webp",
  teacher_chem: ASSET_BASE + "characters/teacher_chem.webp",
  yoon_youngjun: ASSET_BASE + "characters/yoon_youngjun.webp",
  samsung: ASSET_BASE + "characters/samsung.webp",
  unknown: ASSET_BASE + "characters/unknown.webp",
};
// 편지 겉지/속지는 캐릭터와 무관한 범용 종이 텍스처라 story/scenario/ep2_choijaehyeok.js(Episode 2의
// 편지 연출)와 함께 assets/story/shared/letter/에서 공유한다 - 각 에피소드 폴더에 중복 보관하지 않는다.
const SHARED_STORY_ASSET_BASE = "assets/story/shared/";
const IMG_ENVELOPE = SHARED_STORY_ASSET_BASE + "letter/envelope.webp";
const IMG_LETTERPAPER = SHARED_STORY_ASSET_BASE + "letter/paper.webp";
const BG_LOBBY_SHELF = ASSET_BASE + "lobby/shelf.webp";
const IMG_CRAYON_BOX = ASSET_BASE + "items/namok_crayon.webp"; // 부러지지 않는 크레파스 발명 장면 아이템 등장(itemReveal)용

// name은 인연 스토리와 동일하게 '__PLAYER_NAME__' 플레이스홀더로 두고, story-sub-engine.js의
// fetchStoryState()가 실제 닉네임을 받아오는 즉시 PLAYER.name을 직접 덮어쓴다(PLAYER가 말할 때
// 나오는 이름표/대화 기록에 실제 닉네임이 표시됨). 대사 문장 중간에 등장인물 이름이 필요한 곳은
// 이 객체와 별개로 텍스트에 '__PLAYER_NAME__'을 그대로 적어두면 withPlayerName()이 치환해준다.
const PLAYER = { name: '__PLAYER_NAME__', sub: '', key: null };
const ANCHOR = { name: '강삼성', sub: '앵커', key: 'samsung' };
const KIMNAMOK = { name: '김남옥', sub: '과학 교사', key: 'kimnamok' };
const KIMNAMOK_CEO = { name: '김남옥', sub: '대표', key: 'kimnamok_ceo' };
const EMPLOYEE1 = { name: '직원', sub: '직원', key: 'employee1' };

// S#7~9 (약 30년 전, 고등학생 시절) 등장인물
const BANGIMSEOK_STUDENT = { name: '방임석', sub: '학생', key: 'bangimseok_uniform' };
const KIMNAMOK_STUDENT = { name: '김남옥', sub: '학생', key: 'kimnamok_uniform' };
const BANGIMSEOK_LAB = { name: '방임석', sub: '학생', key: 'bangimseok_labcoat' };
const KIMNAMOK_LAB = { name: '김남옥', sub: '학생', key: 'kimnamok_labcoat' };
// 화면(chars)에는 여전히 kimnamok_labcoat_front(정면 스탠딩)가 나오지만, 이 상수의 key는 일부러
// 측면(kimnamok_labcoat)을 가리킨다 - 대화 기록(story-sub-engine.js의 renderDialogueLog)은
// line.speaker.key로 초상화를 고르므로, 정면이 아니라 측면 스탠딩이 기록에 남게 된다(인연 스토리
// 컬렉터 엔딩의 seungyu_true_stand/SEUNGYU 분리와 동일한 방식). 화면 밝기 대비(applySpeakingDim)는
// CAST_SPEAKER_ALIASES에 kimnamok_labcoat_front->kimnamok_labcoat 별칭이 있어 그대로 정상 동작한다.
const KIMNAMOK_LAB_FRONT = { name: '김남옥', sub: '학생', key: 'kimnamok_labcoat' };
const CHEM_TEACHER = { name: '화학 교사', sub: '교사', key: 'teacher_chem' };
const CLUBMATE1 = { name: '동아리 부원', sub: '학생', key: 'unknown' };
const CLUBMATE = { name: '동아리 부원', sub: '학생', key: 'unknown' };

// S#11~12 (약 20년 전, 교사 시절) 등장인물
const YOON_YOUNGJUN = { name: '윤영준', sub: '교사', key: 'yoon_youngjun' };

/* ---- 모모톡 스타일 채팅 UI - 인연 스토리와 동일하게, 대화 상대 목록을 별도 데이터로 둔다 ---- */
const CONTACT_LIST = [
  { key: 'kimnamok', name: '김남옥' },
];

/* =========================================================
   S#1 나의 집 (낮/안)
   ========================================================= */
const SCENE1 = [
  {type:'narration', bg:'livingroom', text:'TV에서 뉴스가 흘러나온다.'},
  {type:'line', speaker:ANCHOR, text:'지난 주, 소개했던 통닭집의 비둘기 양식 논란에 이어 시민들과 밀접한 연관이 있는 문구산업의 이슈가 보고되고 있는데요.', se:'SE_Radio_01'},
  {type:'line', speaker:ANCHOR, text:"국내 문구업계를 뒤흔든 혁신.\n절대 부러지지 않는 '김남옥 크레파스'를 개발한 (주)남옥크레파스의 김남옥 대표가 올해의 혁신 CEO로 선정되었습니다."},
  {type:'narration', text:'그 후, TV 화면은 현장 캐스팅으로 넘어갔고, 인터뷰를 하는 한 여성의 모습이 비친다.'},
  {type:'narration', text:'깔끔한 정장을 입고 수많은 기자들 앞에서 미소를 짓는 CEO.'},
  {type:'narration', text:'하지만 그 얼굴은 나에게 너무도 익숙했다.'},
  {type:'thought', speaker:PLAYER, text:'...어?'},
  {type:'thought', speaker:PLAYER, text:'김... 남옥 선생님?', bgm:'14.Fruitful Blossom'},
  {type:'narration', text:'잠시 리모컨을 든 손이 멈춘다.'},
  {type:'narration', text:'뉴스에서는 그녀의 성공담이 계속 흘러나온다.'},
  {type:'line', speaker:ANCHOR, text:'전직 교사 출신으로 알려진 김남옥 대표는... 절대 파괴되지 않는 크레파스를 개발해 세계 시장을 석권...'},
  {type:'narration', text:'나는 믿기지 않는다는 표정으로 TV를 뚫어져라 쳐다본다.'},
];

/* =========================================================
   S#2 회상 - 교실 (낮/안)
   ========================================================= */
const SCENE2 = [
  {type:'timecard', text:'회상 - 교실', bg:'classroom'},
  {type:'narration', chars:{right:'kimnamok'}, text:'교실. 칠판 앞에서 학생들에게 웃으며 수업하던 김남옥.'},
  {type:'narration', text:'누구에게나 친절했지만, 유독 나에게는 조금 더 따뜻했다. 더 특별하게 대해주는 것 같았다.'},
  {type:'narration', text:'시험을 망쳐 풀이 죽어 있을 때도, 진로 때문에 고민할 때도, 항상 먼저 다가와 이야기를 들어주던 선생님.'},
  {type:'line', speaker:KIMNAMOK, text:'괜찮아. 사람은 성적보다 중요한 게 훨씬 많단다.'},
  {type:'line', speaker:KIMNAMOK, text:'인간은 옥텟규칙에 얽매일 필요가 없잖니?'},
  {type:'thought', speaker:PLAYER, text:'(그 한마디가 아직도 기억에 남아 있었다.)'},
  {type:'thought', speaker:PLAYER, text:'(금속 원소에서의 자유전자처럼 살라는, 그리고 때로는 리간드가 되어서 불안정해져도 된다는 말.)'},
  {type:'thought', speaker:PLAYER, text:'(결국, 불안정한 리간드가 다양한 원소들과 결합하여 안정해지며 멋진 물질을 만들어내듯이 나도 이 실패와 방황을 딛고 일어날 수 있다는 말.)'},
  {type:'thought', speaker:PLAYER, text:'(화학 선생님답게 나에게 들려주었던 아름다운 비유였다.)'},
  {type:'thought', speaker:PLAYER, text:'(인생은 어쩌면 아주 미세한 원자와 결을 같이 하는지도 모르겠다. 그만큼 나에게는 엄청난 힘이 되는 격언이었다.)'},
];

/* =========================================================
   S#3 나의 집 (낮/안)
   ========================================================= */
const SCENE3 = [
  {type:'thought', speaker:PLAYER, bg:'home2', chars:{right:null}, text:'...설마 진짜 그 선생님 맞는 거겠지?'},
  {type:'narration', text:"인터넷으로 검색한다. '김남옥 CEO' 사진을 확대한다."},
  {type:'narration', text:'분명하다. 예전보다 훨씬 성숙해졌지만, 그 미소는 그대로였다.'},
  {type:'narration', text:'나는 한참 동안 화면만 바라본다.'},
  {type:'narration', text:"휴대폰을 든다. 연락처를 뒤져본다.\n다행히도 졸업할 때 받은 번호가 아직 저장되어 있다. '김남옥 선생님'"},
  {type:'thought', speaker:PLAYER, text:'...아직 번호가 살아 있으려나.'},
  {type:'narration', text:'잠시 망설인다. 10년이 넘는 시간이 흘렀다. 갑자기 연락하는 것이 실례일 수도 있다. 하지만...'},
  {type:'narration', text:"'띠링' 결국 메시지를 보낸다."},
  {type:'chat', openChat:'kimnamok', from:'player', text:'안녕하세요, 선생님. 오래전에 가르침을 받았던 __PLAYER_NAME__입니다.'},
  {type:'chat', from:'player', text:'오늘 뉴스를 보고 너무 반가워 연락드렸습니다. 혹시 시간 괜찮으시면 한번 찾아뵙고 싶습니다.'},
  {type:'narration', text:'메시지를 보내고 휴대폰을 내려놓는다.'},
  {type:'thought', speaker:PLAYER, text:'읽씹이면 어쩌지...'},
  {type:'narration', text:'5분. 10분. 30분. 답장은 오지 않는다.'},
  {type:'narration', text:'나는 괜히 머쓱한 웃음을 짓고 다른 일을 하려던 순간.'},
  {type:'narration', text:'띠링. 휴대폰이 울린다.'},
  {type:'chat', from:KIMNAMOK_CEO, closeChat:true, text:'__PLAYER_NAME__(이)구나! 정말 오랜만이네. 나도 네 이름을 보자마자 바로 기억났어. 내일 회사로 와. 오랜만에 얼굴도 보고 이야기나 하자.'},
  {type:'narration', text:'나는 잠시 멍하니 화면을 바라본다.'},
  {type:'thought', speaker:PLAYER, text:'...아직도 기억하고 계셨네.'},
];

/* =========================================================
   S#4 남옥크레파스 본사 (낮/밖)
   ========================================================= */
const SCENE4 = [
  {type:'timecard', text:'다음 날', bg:'building'},
  {type:'narration', text:"초고층 건물. 건물 외벽에는 거대한 로고가 붙어 있다.\n『NAMOK CRAYON』"},
  {type:'narration', text:'수많은 직원들이 분주하게 드나든다.'},
  {type:'narration', text:'나는 건물을 올려다본다.'},
  {type:'thought', speaker:PLAYER, text:'...선생님이 정말 이런 회사를...'},
];

/* =========================================================
   S#5 남옥크레파스 본사 (낮/안)
   ========================================================= */
const SCENE5 = [
  {type:'narration', bg:'lobby', chars:{left:'employee1'}, text:'안으로 들어간다. 직원들이 정중히 안내한다.', stopBgm:true},
  {type:'line', speaker:EMPLOYEE1, text:'대표님께서 기다리고 계십니다.'},
  {type:'narration', bg:'office', chars:{left:null}, text:'엘리베이터가 최고층으로 올라간다.'},
  {type:'narration', text:'문이 열리고, 대표실 문 앞. 잠시 숨을 고른 뒤, 노크를 한다.'},
  {type:'narration', text:'똑똑.'},
  {type:'narration', text:'안에서 익숙한 목소리가 들려온다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'들어와.'},
  {type:'narration', chars:{right:'kimnamok_ceo'}, text:'문이 천천히 열리고, 정장을 입은 CEO 김남옥과 오랜 세월을 지나 다시 마주한다.'},
  {type:'narration', text:'김남옥은 미소를 지으며 자리에서 일어난다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'정말 오랜만이네. 많이 컸구나.'},
  {type:'narration', text:'나는 옅게 웃으며 인사를 건넨다.'},
  {type:'line', speaker:PLAYER, text:'안녕하세요, 선생님.'},
  {type:'narration', text:'우리는 서로를 바라보며 반가운 미소를 지었다.'},
];

/* =========================================================
   S#6 남옥크레파스 본사 김남옥 대표실 (낮/안)
   * S#5와 같은 장소(대표실)에서 바로 이어지므로 씬 전환(암전/타임카드) 없이 계속 진행
   ========================================================= */
const SCENE6 = [
  {type:'narration', text:'대표실 안. 통유리 너머로 도시의 풍경이 한눈에 내려다보인다.', bgm:'1-08. Daily Routine 247'},
  {type:'narration', text:'한쪽에는 각종 상패와 특허증이 진열되어 있고, 다른 한쪽에는 수십 가지의 크레파스 제품이 전시되어 있다.'},
  {type:'narration', text:'내가 어릴 적에 주로 쓰던 낡아빠진 몽땅 크레파스와는 차원이 다른 느낌의 고고함을 풍기고 있었다.'},
  {type:'narration', text:'선생님은 차를 한 잔 따라 내 앞에 내려놓았다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'천천히 마셔. 이런 데까지 오느라 고생했네.'},
  {type:'line', speaker:PLAYER, text:'감사합니다.'},
  {type:'narration', text:'잠시 정적이 흐른다.'},
  {type:'narration', text:'나는 방 안을 둘러봤다. 뉴스에서 보았던 것보다 훨씬 큰 회사. 수많은 특허증. 그리고 세계 각국에서 받은 상들.'},
  {type:'narration', text:'나는 감탄을 감추지 못했다.'},
  {type:'line', speaker:PLAYER, text:'정말 대단하세요, 선생님.'},
  {type:'narration', text:'선생님은 작게 웃었다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'그렇게까지 대단한 사람은 아니야.'},
  {type:'line', speaker:PLAYER, text:'아니에요. 예전엔 학교에서 학생들을 가르치셨잖아요. 그런데 지금은 세계적인 크레파스 회사를 운영하고 계시고….'},
  {type:'narration', text:'잠시 말을 멈춘다. 그리고 조심스럽게 묻는다.'},
  {type:'line', speaker:PLAYER, text:'어떻게 교사에서 회사 대표가 되신 거예요?'},
  {type:'narration', text:'선생님은 바로 대답하지 않았다. 그녀는 창밖을 바라보며 잠시 고요한 정적이 흘렀다.'},
  {type:'narration', text:'그녀의 표정에는 웃음이 사라져 있었다.'},
  {type:'narration', text:'나는 괜히 실례되는 질문을 했나 싶어 말을 돌리려 했다.'},
  {type:'line', speaker:PLAYER, text:'죄송해요. 괜한 걸 물었네요.'},
  {type:'narration', text:'선생님은 침착하게 피식 웃으면서 고개를 젓는다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'아니. 언젠가는 누군가에게 이야기해야 할 일이었어.'},
  {type:'narration', text:'선생님은 책상 서랍을 천천히 열었다. 안에는 오래된 종이 한 장이 들어 있었다. 세월이 지나 가장자리가 누렇게 변한 메모.'},
  {type:'narration', text:'선생님은 그것을 조심스럽게 꺼냈다. 나는 자연스럽게 시선을 보냈다.'},
  {type:'narration', text:"종이 위에는 익숙하지 않은 필체로 적혀 있었다.\n『절대 파괴되지 않는 크레파스』"},
  {type:'narration', text:"그리고 그 아래. 작게 적혀 있는 한 사람의 이름.\n『방임석』"},
  {type:'narration', text:'나는 어렴풋하게 들어봤던 이름이었다.'},
  {type:'line', speaker:PLAYER, text:'방... 임석?'},
  {type:'narration', text:'선생님은 그 이름을 한동안 바라보았다. 아무런 소리 없이 알 수 없는 표정을 한 채로. 마치 오래전 기억을 떠올리듯.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'내가 이 자리에 올 수 있었던 건... 사실 내 힘만은 아니었어.'},
  {type:'narration', text:'나는 선생님의 놀라운 발언에 의아한 표정을 지었다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'그 사람이 아니었다면, 난 아직도 평범한 교사로 살고 있었을 거야.'},
  {type:'narration', text:'나는 이 사건의 전말이 더욱 궁금해졌다.'},
  {type:'line', speaker:PLAYER, text:'그분이... 공동 개발자였나요?'},
  {type:'narration', text:'선생님은 옅은 미소를 짓지만, 그 미소에는 그리움이 묻어 있었다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'공동 개발자이기도 했고...'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'......'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'...내 첫사랑이었어.', stopBgm:true},
  {type:'narration', text:'나의 눈이 튀어나올 듯이 커졌다.'},
  {type:'line', speaker:PLAYER, text:'첫사랑...이요?'},
  {type:'narration', text:'선생님은 창밖을 바라보았다. 따뜻한 햇살이 대표실 안으로 비친다. 그녀는 천천히 숨을 내쉰다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'모든 건... 고등학교 화학실에서 시작됐어.'},
  {type:'narration', text:'그녀의 눈동자가 먼 과거를 향한다.'},
  // 대사 없이 흰 암전으로 전환해 30년 전 화학실(labdark)의 교복 차림 두 사람을 보여준 뒤,
  // 클릭 없이 1.5초 저절로 대기했다가 화 종료 연출(To Be Continued)로 자동 진행된다.
  {type:'reveal', bg:'labdark', white:true, chars:{left:'bangimseok_uniform', right:'kimnamok_uniform'}, holdMs:1500},
];

/* =========================================================
   S#7 공주사대부고 화학실 (낮/안/약 30년 전)
   * "화면이 하얗게 번지더니, 시계바늘이 거꾸로 돌아가기 시작한다"에 맞춰
     기존의 검은 암전이 아닌 흰색 화이트아웃으로 회상에 진입한다.
   ========================================================= */
const SCENE7 = [
  {type:'timecard', text:'약 30년 전\n공주사대부고 화학실', bg:'labdark', white:true},
  {type:'narration', text:'창밖으로는 따스한 봄바람이 불어오고, 복도에는 학생들의 웃음소리가 울려 퍼진다.'},
  {type:'narration', text:'화학 동아리실. 방과 후. 실험복을 입은 학생들이 삼삼오오 모여 실험을 하고 있다.'},
  {type:'narration', chars:{right:'kimnamok_uniform'}, text:'그중에서도 가장 눈에 띄는 한 소녀. 단정하게 교복을 입고 있는 김남옥.'},
  {type:'narration', text:'공부도 잘하고, 성격도 밝아 학교에서 인기가 많은 학생이었다.'},
  {type:'narration', text:'그리고 무엇보다도 출중한 외모를 가지고 있어 또래 남학생들이 함부로 접근하지 못할 위압감 혹은 존재감 같은 것이 있었다.'},
  {type:'narration', text:'하지만 그녀에게는 한 가지 특징이 있었다. 무언가를 발명하는 것에는 별다른 흥미가 없었다. 그녀에게 화학은 그저 재미있는 취미일 뿐이었다.'},
  {type:'narration', text:'그때. 실험실 문이 열리며 한 남학생이 들어온다.'},
  {type:'narration', chars:{left:'bangimseok_uniform'}, text:'양손 가득 붓을 들고, 어딘가 피곤해 보이는 얼굴. 하지만 눈빛만큼은 누구보다 진지했다.'},
  {type:'narration', text:'그가 바로 방임석이었다. 그는 화학 괴짜이자 4차원 인간으로 소문이 자자했던 학생이었다.'},
  {type:'line', speaker:CLUBMATE1, text:'임석 왔네.', bgm:'1-14. Sugar story'},
  {type:'line', speaker:BANGIMSEOK_STUDENT, text:'미안, 조금 늦었어.'},
  {type:'narration', text:'그는 가방을 내려놓자마자 실험대를 정리하기 시작한다. 정확하고 빈틈없는 손놀림. 실험 도구의 위치까지 하나하나 맞춘다.'},
  {type:'narration', text:'김남옥은 그런 모습을 보며 웃는다.'},
  {type:'line', speaker:KIMNAMOK_STUDENT, text:'또 그렇게 각 맞추는 거야?'},
  {type:'line', speaker:BANGIMSEOK_STUDENT, text:'실험은 정확해야 하니까.'},
  {type:'line', speaker:KIMNAMOK_STUDENT, text:'조금 틀어져도 아무 일 안 일어나.'},
  {type:'line', speaker:BANGIMSEOK_STUDENT, text:"그 '조금' 때문에 실패하는 게 실험이야."},
  {type:'narration', text:'남옥은 장난스럽게 시험관 하나를 살짝 비뚤게 놓는다. 임석은 아무 말 없이 다시 반듯하게 고쳐 놓는다. 둘은 동시에 웃음을 터뜨린다.'},
  {type:'narration', text:'동아리 친구들은 익숙하다는 듯 고개를 절레절레 흔든다.'},
  {type:'line', speaker:CLUBMATE, text:'또 시작이네.'},
];

/* =========================================================
   S#8 공주사대부고 화학실 (낮/안/약 30년 전/어느 날)
   ========================================================= */
const SCENE8 = [
  {type:'timecard', text:'어느 날', bg:'labbright'},
  {type:'narration', chars:{left:'teacher_chem'}, text:'화학 교사는 새로운 과제를 내준다.'},
  {type:'line', speaker:CHEM_TEACHER, text:'이번 동아리 발표는 자유 주제다. 일상생활을 조금이라도 편리하게 만들 수 있는 물건을 하나 만들어 보렴.'},
  {type:'narration', chars:{left:'bangimseok_labcoat', right:'kimnamok_labcoat'}, text:'학생들은 각자 팀을 꾸리기 시작한다. 누군가는 세제를, 누군가는 접착제를, 누군가는 향수를 만들겠다고 이야기한다.'},
  {type:'narration', text:'남옥은 귀찮다는 표정으로 팔짱을 낀다.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'그냥 적당히 만들면 되겠지.'},
  {type:'narration', text:'그 말을 들은 임석은 조용히 노트를 펼친다. 거기에는 수십 개의 아이디어가 빼곡히 적혀 있었다.'},
  {type:'narration', text:'남옥은 놀란다.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'언제 이런 걸 다 적었어?'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'생각날 때마다.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'...진짜 연구원 체질이다.'},
  {type:'narration', text:"임석은 한 페이지를 펼쳐 보인다. 거기에는 짧게 적혀 있었다.\n'절대 부러지지 않는 크레파스'"},
  {type:'narration', text:'남옥은 피식 웃는다.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'크레파스?'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'아이들은 크레파스를 자주 부러뜨리잖아. 안 부러지는 크레파스가 있다면 어떨까?'},
  {type:'narration', text:'남옥은 어깨를 으쓱한다.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'그게 가능하면 좋긴 하겠네.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'가능한지 확인해 보자.'},
];

/* =========================================================
   S#9 공주사대부고 화학실 (낮/안/약 30년 전/며칠 후)
   * S#7과 같은 배경(labdark)을 다시 사용
   ========================================================= */
const SCENE9 = [
  {type:'timecard', text:'며칠 후', bg:'labdark'},
  {type:'narration', chars:{left:'bangimseok_labcoat', right:'kimnamok_labcoat'}, text:'두 사람은 방과 후마다 화학실에 남았다. 각종 왁스와 안료, 고분자 재료를 섞고, 굳히고, 부러뜨리고, 다시 만들기를 반복한다.'},
  {type:'narration', text:'실패. 또 실패. 실험대 위에는 부러진 크레파스가 산처럼 쌓여 간다.'},
  {type:'narration', text:'남옥은 의자에 털썩 앉는다.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'아, 안 되겠다. 오늘만 몇 번째야?'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'서른두 번째.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'그걸 다 세고 있었어?'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'당연하지.'},
  {type:'narration', text:'남옥은 웃음을 터뜨린다.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'넌 정말 이상한 사람이야.'},
  {type:'narration', text:'임석도 희미하게 웃는다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'칭찬으로 들을게.'},
  {type:'narration', text:'그리고... 어느 늦은 저녁. 노을이 화학실을 붉게 물들인다.'},
  {type:'narration', text:'두 사람은 마지막이라 생각하며 새로운 배합을 만든다. 혼합물을 틀에 붓고, 조심스럽게 굳힌다.'},
  {type:'itemReveal', item:IMG_CRAYON_BOX},
  {type:'narration', text:'완성된 크레파스 하나. 남옥이 손에 든다. 가볍게 힘을 준다.'},
  {type:'narration', text:"'딱.' ...부러지지 않는다. 조금 더 세게. 여전히 멀쩡하다.", se:'SE_Hit_04'},
  {type:'narration', text:'임석이 직접 실험대 위에 내려쳐 본다. 탕!', se:'SE_Hit_04'},
  {type:'narration', text:'크레파스는 흠집조차 나지 않는다.'},
  {type:'narration', text:'두 사람은 서로를 바라본다. 믿기지 않는 표정.'},
  {type:'narration', text:'남옥이 다시 한번 바닥에 던진다. 툭. 멀쩡하다.', se:'SE_Hit_04'},
  {type:'narration', text:'이번에는 망치를 가져온다. 쾅!', se:'SE_Hit_04'},
  {type:'narration', text:'망치 끝이 튕겨 나간다. 크레파스는 그대로였다.'},
  {type:'narration', text:'잠시 화학실이 조용해진다. 정적을 깬 것은 남옥의 웃음이었다.'},
  {type:'itemHide'},
  {type:'line', speaker:KIMNAMOK_LAB_FRONT, chars:{right:'kimnamok_labcoat_front'}, text:'뭐야, 이거. 진짜 안 부러지잖아?'},
  {type:'narration', text:'임석은 크레파스를 손바닥 위에 올려놓고 한참 바라본다. 그의 눈빛은 어느 때보다도 진지했다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'...해냈네.'},
  {type:'narration', text:"그는 조용히 노트를 펼친다. 그리고 제목을 적는다.\n『김남옥의 크레파스』"},
  {type:'narration', text:'남옥이 의아한 표정을 짓는다.'},
  {type:'line', speaker:KIMNAMOK_LAB_FRONT, text:'왜 내 이름이야?'},
  {type:'narration', text:'임석은 웃으며 대답한다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'네가 처음 끝까지 포기하지 않고 같이 만든 발명이니까. 그리고 이름이 더 잘 어울려.'},
  {type:'narration', chars:{right:'kimnamok_labcoat'}, text:'남옥은 조금 부끄러운 듯 웃으며 고개를 돌린다.'},
  {type:'narration', text:'하지만 그 순간만큼은 두 사람 모두 알지 못했다. 화학실에서 태어난 작은 크레파스 하나가, 훗날 한 사람의 인생을 완전히 바꾸게 될 것이라는 사실을.'},
];

/* =========================================================
   S#10 공주사대부고 화학실 (저녁/안/약 30년 전/발명 직후)
   * S#9와 같은 날 저녁, 노을이 짙어진 같은 장소 - 배경만 노을 버전으로 교체
   ========================================================= */
const SCENE10 = [
  {type:'narration', bg:'labsunset', text:'노을이 화학실을 붉게 물들이고 있었다.', stopBgm:true},
  {type:'narration', chars:{left:'bangimseok_labcoat', right:'kimnamok_labcoat'}, text:'실험대 위에는 방금 완성된 크레파스 하나.'},
  {type:'narration', text:'이미 여러 차례 확인했음에도 방임석은 그것을 몇 번이고 내려쳐 본다. 망치. 쇠막대. 실험대 모서리. 크레파스에는 흠집 하나 생기지 않는다.'},
  {type:'narration', text:'그는 숨을 크게 들이마신다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'...됐다. 정말 됐어.'},
  {type:'narration', text:'김남옥은 신기하다는 듯 웃으며 크레파스를 손가락 사이에서 빙글빙글 돌린다.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'신기하네. 동아리 발표 때 애들 놀라겠다.'},
  {type:'narration', text:'방임석은 그녀를 바라본다. 놀람이 아니라, 확신에 찬 눈빛이었다.'},
  {type:'narration', text:"그는 가방에서 노트를 꺼낸다. 빠르게 무언가를 적는다.\n'특허.' '산업화.' '생산.' '응용 소재.'"},
  {type:'narration', text:'김남옥은 그 노트를 보고 웃는다.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'...너 또 시작이다.'},
  {type:'narration', text:'방임석은 노트를 그녀 앞에 밀어놓는다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'남옥. 우리 특허 내자.'},
  {type:'narration', text:'남옥은 피식 웃는다.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'농담이지?'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'아니. 난 진심이야.'},
  {type:'narration', text:'김남옥은 웃음을 거둔다.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'...우리 학생이야.', bgm:'03.Interface Hard Arrange'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'학생도 발명할 수 있어.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'그걸 누가 도와주는데?'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'찾으면 돼.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'돈은?'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'벌면 돼.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'실패하면?'},
  {type:'narration', text:'잠시 침묵. 방임석은 단호하게 말한다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'다시 하면 돼.'},
  {type:'narration', text:'김남옥은 한숨을 쉰다.'},
  {type:'line', speaker:KIMNAMOK_LAB, text:'임석. 세상은 그렇게 단순하지 않아. 난 대학도 가야 하고. 취직도 해야 하고. 안정적으로 살아야 해.'},
  {type:'narration', text:'방임석의 표정이 굳어진다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'안정? 이 발명이 있는데? 남들이 평생 한 번도 못 만들 걸 우리가 만들었어.'},
  {type:'narration', text:'그는 크레파스를 집어 들며 외친다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'이게 얼마나 대단한 건지 정말 몰라?'},
  {type:'narration', chars:{right:'kimnamok_labcoat_front'}, text:'김남옥도 목소리가 높아진다.'},
  {type:'line', speaker:KIMNAMOK_LAB_FRONT, text:'안다고! 안 부러지는 크레파스인 거! 근데 그게 내 인생을 걸 만큼 중요한 일은 아니잖아!'},
  {type:'narration', text:'화학실 안이 조용해진다. 다른 동아리 학생들이 둘을 바라본다. 방임석은 주변 시선도 신경 쓰지 않는다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'넌 왜 항상 여기서 멈추려고 해? 조금만 더 가면 되는데.'},
  {type:'line', speaker:KIMNAMOK_LAB_FRONT, text:'그 조금이 몇 년일지 누가 알아! 난 그렇게 살고 싶지 않아!'},
  {type:'narration', text:'방임석은 노트를 꽉 움켜쥔다. 종이가 구겨질 정도였다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'...난. 이걸 평생 연구할 수도 있어.'},
  {type:'narration', text:'김남옥은 믿을 수 없다는 표정을 짓는다.'},
  {type:'line', speaker:KIMNAMOK_LAB_FRONT, text:'...뭐?'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'진심이야. 대학을 가도. 직장을 다녀도. 난 끝까지 연구할 거야. 이건 반드시 세상에 나와야 해.'},
  {type:'narration', text:'남옥은 고개를 젓는다.'},
  {type:'line', speaker:KIMNAMOK_LAB_FRONT, text:'...미쳤네. 나중에 교사가 되면 애들도 막 내팽겨치고 방임하고 무시하고!! ...자기 할 것만 하겠네. 정말.'},
  {type:'narration', text:'침묵이 고요하게 공간을 매운다. 노을이 점점 어두워진다.'},
  {type:'narration', text:'방임석은 조용히 말한다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'하... 같이 해보자고... 혼자서는 하고 싶지 않아.'},
  {type:'narration', text:'김남옥은 한참 동안 말이 없다.'},
  {type:'narration', text:'그녀는 임석을 좋아하는 마음이 있었다. 이 학교에서 처음 봤을 때부터 풍기는 올곧은 너드미가 그녀의 취향이었을지도 모른다.'},
  {type:'narration', text:'하지만 그녀는 동시에 이 사회도 냉철히 알고 있었다. 누군가를 배척하고, 매장하고, 이용하고, 착취하고... 이러한 현실을 누구보다도 잘 안다고 자부하는 그녀였기에 그의 꿈은 너무 거대하고 불안정함을 확신하는 지경에 이르렀다.'},
  {type:'line', speaker:KIMNAMOK_LAB_FRONT, text:'...미안. 난 못 해.'},
  {type:'narration', text:'그 한마디에 방임석의 눈빛이 흔들린다. 잠시 웃어 보이려 하지만 실패한다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'...그래. 알겠어.'},
  {type:'narration', text:'그는 노트를 가방에 넣는다. 실험대 위에 놓인 크레파스를 조용히 바라본다.'},
  {type:'narration', text:'그리고 혼잣말처럼 중얼거린다.'},
  {type:'line', speaker:BANGIMSEOK_LAB, text:'...그럼 내가 끝까지 가 볼게.', stopBgm:true},
  {type:'narration', text:'그렇게 두 사람은 다시 대화하지 않았다. 서로의 방향이 너무도 확실했기에, 어긋난 방향을 억지로 맞추려다가 얼마나 뒤틀릴지도 알고 있었기에, 멀어지는 선택을 했다.'},
  {type:'narration', text:'크레파스 이야기는 더 이상 나오지 않았다.'},
];

/* =========================================================
   S#11 공주사대부고 교무실 (저녁/안/약 20년 전)
   ========================================================= */
const SCENE11 = [
  {type:'timecard', text:'그로부터 10년 후', bg:'classroom'},
  {type:'narration', chars:{center:'kimnamok'}, text:"화학 교사가 된 김남옥은 교탁 앞에서 학생들에게 수업을 하고 있다. 칠판에는 큼지막하게 적혀 있다.\n『과학 - 물질의 성질』"},
  {type:'narration', text:'학생들은 수업에 집중하고, 남옥은 학생들의 질문에 하나하나 웃으며 답해 준다. 예전 학생이었던 __PLAYER_NAME__에게도 그랬던 것처럼.'},
  {type:'narration', bg:'teachersoffice', chars:{center:null}, text:'종례가 끝난 뒤. 교무실.'},
  {type:'narration', chars:{right:'kimnamok', left:'yoon_youngjun'}, text:'동료 교사 윤영준이 말을 건다.'},
  {type:'line', speaker:YOON_YOUNGJUN, text:'김 선생님, 오늘도 야자 감독하세요?'},
  {type:'line', speaker:KIMNAMOK, text:'시험 문제만 조금 만들고 가려고요. 그리고 학생들 감독해야죠.'},
  {type:'line', speaker:YOON_YOUNGJUN, text:'참 성실하시네요. 3D 프린터기 쓸 일 있으시면 저에게 맡겨주세요!'},
  {type:'narration', text:'남옥은 웃으며 고개를 끄덕인다. 평범하지만 행복한 일상. 학생들을 가르치는 삶에도 만족하고 있었다.'},
];

/* =========================================================
   S#12 김남옥의 집 (밤/안/약 20년 전)
   ========================================================= */
const SCENE12 = [
  {type:'narration', bg:'apartment', text:'퇴근 후. 현관문을 열고 집에 들어선다.'},
  {type:'narration', text:"그때. 우편함에 낯선 봉투 하나가 꽂혀 있다. 발신인도, 주소도 적혀 있지 않다. 오직 그녀의 이름만 적혀 있다.\n『김남옥 귀하』"},
  {type:'narration', chars:{right:'kimnamok'}, text:'남옥은 의아한 표정으로 봉투를 집어 든다.'},
  {type:'narration', text:'집 안. 식탁에 앉아 봉투를 조심스럽게 연다. 안에는 두꺼운 서류철 하나와 편지 한 장.'},
  {type:'narration', text:'편지를 펼치는 순간, 익숙한 글씨체가 눈에 들어온다. 남옥의 손이 미세하게 떨린다.'},
  {type:'line', speaker:KIMNAMOK, text:'...설마.'},
  {type:'narration', text:'편지의 첫 문장. 남옥에게. 그 한 줄만으로도 누가 보낸 것인지 알 수 있었다. 방임석.', bgm:'2.11 Starry Confession'},
  {type:'narration', text:'그녀는 숨을 삼키며 편지를 읽기 시작한다.'},
  {type:'letterOpen', chars:{right:null}},
  {type:'letter', text:'남옥. 오랜만이네. 네가 이 편지를 읽고 있다는 건, 이 자료가 무사히 네 손에 도착했다는 뜻이겠지.'},
  {type:'letter', text:'예전에 우리 둘이 화학실에서 만들었던 크레파스. 난 그날 이후에도 그 발명을 계속 연구했어. 생각보다 훨씬 오래 걸렸고, 수도 없이 실패했지만... 결국 완성했어.'},
  {type:'letter', text:'우리가 그때 상상했던 것보다 훨씬 뛰어난 결과물이 나왔어.'},
  {type:'letter', text:'이 연구는 원래 우리 둘의 것이야. 그래서 내가 혼자 특허를 내거나, 내 이름으로 세상에 발표하는 건 옳지 않다고 생각했어.'},
  {type:'letter', text:'모든 연구 자료와 실험 기록, 제조 공정, 필요한 내용은 전부 이 서류에 담아 두었어. 이제 이 발명을 어떻게 할지는 네가 결정해 줘.'},
  {type:'narration', text:'남옥은 급히 서류철을 펼친다. 수백 장의 실험 기록. 배합 비율. 실패 사례. 수정 과정. 생산 방법.'},
  {type:'narration', text:"그리고 마지막 페이지에는.\n『최종 제조 공식』"},
  {type:'narration', text:'남옥은 말을 잃는다.'},
  {type:'narration', text:'편지의 마지막 장.'},
  {type:'letter', text:'그리고... 미안하다. 네 곁을 그렇게 떠났던 것도. 아무 말 없이 사라졌던 것도.'},
  {type:'letter', text:'언젠가는 직접 찾아가 설명하고 싶었지만, 지금의 나는 그러지 못할 것 같아.'},
  {type:'letter', text:'그래서 부탁 하나만 할게. 이 연구가 세상에 도움이 될 수 있다고 생각한다면, 대신 세상 밖으로 꺼내 줘. 그걸로 충분해.'},
  {type:'letter', text:'건강하게 지내.\n- 방임석'},
  {type:'letterClose'},
  {type:'narration', text:'편지는 거기서 끝이었다.'},
  {type:'narration', chars:{right:'kimnamok'}, text:'남옥은 한참 동안 편지를 내려놓지 못한다. 방 안은 너무나 조용했다. 시계 초침 소리만 들린다.'},
  {type:'narration', text:'그녀는 조심스럽게 의자에 기대어 눈을 감는다. 수많은 기억들이 스쳐 지나간다. 화학실. 노을. 실험복. 특허를 내자. 이건 정말 대단한 발명이야.'},
  {type:'narration', text:'그때는 웃어넘겼던 그의 말들이, 이제야 하나씩 이해되기 시작했다.'},
  {type:'narration', text:'남옥의 눈가가 붉어진다.'},
  {type:'line', speaker:KIMNAMOK, text:'...바보. 왜 이제야...'},
  {type:'narration', text:'눈물이 한 방울, 편지 위로 떨어진다.'},
  {type:'narration', text:'그녀는 다시 실험 기록을 펼친다. 페이지를 넘길수록 놀라움은 커져 갔다.'},
  {type:'narration', text:"'이 정도까지 연구했다고...?' '혼자서... 이 모든 걸...?'"},
  {type:'narration', text:'그 기록에는 10년이라는 시간이 고스란히 담겨 있었다. 한 사람이 포기하지 않고 쌓아 올린 집념이었다.'},
  {type:'narration', text:'남옥은 마지막 페이지를 덮는다. 그리고 결심한 듯 깊게 숨을 들이쉰다.'},
  {type:'narration', text:'책상 위에 편지를 가지런히 올려놓고, 혼잣말처럼 중얼거린다.'},
  {type:'line', speaker:KIMNAMOK, text:'네가 끝까지 믿었던 발명이잖아. 이번에는...'},
  {type:'narration', text:'잠시 말을 멈춘다. 창밖의 밤하늘을 올려다본다.'},
  {type:'line', speaker:KIMNAMOK, text:'...내가 이어갈게.', stopBgm:true},
  {type:'narration', text:'편지 한 장. 그리고 그 옆에 놓인 두꺼운 연구 자료. 한 사람의 10년이, 이제 다른 한 사람의 새로운 인생을 움직이기 시작한다.'},
];

/* =========================================================
   S#13 남옥크레파스 본사 김남옥 대표실 (낮/안)
   * S#5~6에서 쓰던 대표실 배경(office)과 정장 김남옥(kimnamok_ceo)을 그대로 재사용
   ========================================================= */
const SCENE13 = [
  {type:'narration', bg:'office', chars:{right:'kimnamok_ceo'}, text:'선생님은 천천히 말을 멈췄다. 대표실 안에는 적막이 흘렀고, 나는 한동안 아무 말도 할 수 없을 것 같았다.'},
  {type:'narration', text:'눈앞에 있는 세계적인 CEO가, 사실은 한 사람의 꿈을 대신 이어받아 여기까지 왔다는 사실이 쉽게 믿기지 않았다.'},
  {type:'narration', text:'잠시 후, 나는 조심스럽게 입을 열었다.'},
  {type:'line', speaker:PLAYER, text:'...그래서 그 연구 자료로 사업을 시작하신 거군요.', bgm:'2-04. Alkaline Tears'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'처음엔 많이 망설였어. 이게 정말 맞는 일인지. 내가 그 사람의 연구를 이어받아도 되는 건지.'},
  {type:'narration', text:'잠시 선생님의 시선이 책상 위에 놓인 오래된 편지로 옮겨 갔다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:"하지만 편지를 수십 번 읽고 또 읽었어. '세상 밖으로 꺼내 달라.' 그 한 문장이 계속 마음에 남더라."},
  {type:'narration', text:'그리고 선생님은 나에게 그 후에 CEO가 되는 과정을 자세히 설명해주었다.'},
  {type:'narration', text:'먼저 특허청에 특허를 출원했던 과정, 그동안 벌어두었던 돈으로 연구소에서 밤새 연구원들과 제조 공정을 다듬었던 과정,'},
  {type:'narration', text:"작은 사무실에서 몇 안되는 직원들과 끊임없는 회의를 했던 과정, 생산 과정, 마트 문구 코너에 처음으로 '김남옥의 크레파스'가 진열되는 과정을... 전부 다 말이다."},
  {type:'narration', text:'인터넷에서 입소문이 퍼지고, 해외 계약이 성사되고, 공장이 증설되고, 회사가 점점 커져가는 과정도 빠짐없이 이야기해 주었다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'모든 게 정말 순식간이었어. 특허가 등록되고. 제품이 알려지고. 투자도 들어오고. 정신을 차려 보니 내가 회사를 운영하고 있더라.'},
  {type:'line', speaker:PLAYER, text:'정말 영화 같은 이야기네요.'},
  {type:'narration', text:'선생님도 희미하게 웃었다. 하지만 그 미소는 오래가지 못하고 창밖을 바라보았다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'그런데... 정작 가장 먼저 이걸 봤어야 할 사람은. 끝내 나타나지 않았어.'},
  {type:'narration', text:'나는 조용히 그녀를 바라보았다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'편지를 남긴 이후로. 방임석은 완전히 사라졌어. 휴대전화 번호도 없어. 주소도 없어. 아는 사람도 없어.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'경찰에 실종 신고를 할 수도 없었어. 어디로 간 건지. 살아는 있는 건지. ...아무것도 모르겠더라.'},
  {type:'narration', text:'선생님은 애써 담담하게 말했지만, 목소리에는 짙은 그리움이 묻어 있었다.'},
  {type:'narration', text:'나는 의아해했다. 무언가 머릿속에 떠올랐기 때문이었다.'},
  {type:'line', speaker:PLAYER, text:'...잠깐만요.'},
  {type:'narration', text:'선생님이 시선을 돌렸다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'응?'},
  {type:'line', speaker:PLAYER, text:'방임석이라고 하셨죠?'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'그래.'},
  {type:'line', speaker:PLAYER, text:'혹시... 키 크고. 조용한 성격에. 빵떡 모자하고. 항상 커다란 붓 같은 걸 들고 다니던 사람 맞나요?'},
  {type:'narration', text:'선생님의 표정이 순식간에 놀란 표정으로 바뀌었다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'...맞아. 너... 임석이를 알아?'},
  {type:'narration', text:'그렇다. 내 기억 속에 있었다.'},
  {type:'line', speaker:PLAYER, text:'네. 설명을 들으니까 생각났어요.'},
  {type:'narration', text:'선생님은 자리에서 몸을 앞으로 숙이며 긴장한 표정으로 나에게 물었다.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'...어디서?'},
  {type:'narration', text:'나는 곧바로 대답했다.'},
  {type:'line', speaker:PLAYER, text:'예전에 제가 다니던 학교. 어울림관에서 일하시는 분이 계셨거든요. 그분이 방임석 선생님이었어요.'},
  {type:'line', speaker:PLAYER, text:'아 맞아. 학생들을 방임해서 방임석이라고 애들이 놀렸던 기억도 생각나네요. 아마, 임석 선생님께서 학교에 근무하시던 시절에 선생님께서도 근무하셨을걸요?'},
  {type:'narration', text:'순간. 선생님의 눈동자가 크게 흔들렸다. 믿을 수 없다는 표정.'},
  {type:'line', speaker:KIMNAMOK_CEO, text:'...정말?'},
  {type:'line', speaker:PLAYER, text:'확실하다고는 못 하지만. 외모도. 분위기도. 선생님이 말씀하신 것과 거의 같아요.'},
  {type:'line', speaker:PLAYER, text:'아마 저희 학생 또래에서 임석 선생님을 기억하던 친구는 아마 없을 것이기 때문에 기억에 없는 게 지금 생각해 보면 당연한 것 같아요.'},
  {type:'narration', text:'선생님은 한동안 말을 잇지 못했다.'},
  {type:'narration', text:'10년 동안 찾지 못했던 사람. 그 사람의 흔적이, 예상치 못한 곳, 그것도 아주 아주 아주 아주 아주 아주 가까운 곳에서 들려온 것이다.'},
  {type:'narration', text:'선생님은 떨리는 손으로 책상 위의 편지를 바라보았다.'},
  {type:'narration', text:'나는 선생님의 진실된 이야기를 듣고 임석 선생님께 궁금증만이 계속 감돌았다.'},
  {type:'narration', text:"왜 우리들을 그렇게까지 방임했던 것인지... '재능은 간섭받지 않을 때 가장 아름답게 피어난다'는 말로 왜 우리를 현혹해왔던 것인지..."},
  {type:'narration', text:'그리고 그 이유가 그 크레파스였다면 왜 그렇게 그것에 집착했으며 결국 바라는게 무엇인지...'},
];

// 인물별로 스탠딩 크기를 줄이고 싶을 때 쓰는 배율표 (기본은 1 = 100%) - yoon_youngjun 전용 축소값은
// 제거함(다른 인물과 동일한 기본 크기/위치 로직을 그대로 적용받는다).
const CHAR_SCALE = {};
// 인물별로 위치를 위/아래로 살짝 옮기고 싶을 때 쓰는 오프셋(px, 음수면 위로)
const CHAR_OFFSET_Y = {};

// 말하는 사람 음영 처리(story-sub-engine.js의 applySpeakingDim 참고)용 - "다른 키지만 같은 사람"인
// 경우만 여기 등록한다(예: 인연 스토리의 seungyu_true_stand -> seungyu). kimnamok_labcoat_front는
// 화면(chars)에서만 쓰고 대화 기록/화자 키는 kimnamok_labcoat를 쓰기로 했으므로(KIMNAMOK_LAB_FRONT
// 참고), 밝기 대비 비교 시에도 같은 사람으로 인식되도록 여기 등록해야 한다.
const CAST_SPEAKER_ALIASES = {
  kimnamok_labcoat_front: 'kimnamok_labcoat',
};

// 화(chapter) 단위 그룹핑 - 화별로 티켓 1장을 소모해 영구 잠금해제한다(story-sub-engine.js 참고).
// 이전 화가 잠금해제되어 있어야 다음 화가 입장 가능해진다(순차 잠금).
const CHAPTERS = [
  { id: 'chapter1', title: '1화', subtitle: '뜻밖의 재회', scenes: [SCENE1, SCENE2, SCENE3, SCENE4, SCENE5, SCENE6] },
  { id: 'chapter2', title: '2화', subtitle: '화학실의 약속', scenes: [SCENE7, SCENE8, SCENE9, SCENE10, SCENE11] },
  { id: 'chapter3', title: '3화', subtitle: '편지', scenes: [SCENE12, SCENE13] },
];
