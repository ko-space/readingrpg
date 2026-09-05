// 인연 스토리 Episode 2(최재혁 - 귀환의 돌)의 대사/분기/캐릭터/배경 데이터 + 씬 흐름 글루 함수.
// story/story-engine.js(엔진)가 이 파일을 전역으로 소비하므로, HTML에서 반드시 이 스크립트를
// story-engine.js보다 먼저(그리고 story/scenario/ep1_yoondaewoong.js보다는 나중에) 로드해야 한다
// (story-relationship.html 참고). ep1_yoondaewoong.js와 달리 씬 흐름 함수(playXXX/renderXXX)까지
// 이 파일 안에 전부 넣어서, 어느 파일을 봐도 "Episode 2 콘텐츠"를 한 곳에서 확인할 수 있게 했다
// (ep1은 엔진 파일 안에 글루 함수가 섞여 있는 구조인데, 새 에피소드까지 그 파일에 계속 얹으면
// 유지보수가 어려워질 것 같아 여기서부터는 분리했다).
//
// STORY_ID/CHAR_IMG/BG/PLAYER/CG_GALLERY_ITEMS/TRUE_ENDING_REQUIREMENTS/TRUE_ENDING_GALLERY_IDS/
// ENDING_CG_ID_BY_TITLE라는 이름의 전역은 ep1_yoondaewoong.js도 똑같이 선언한다(둘 다 var라 충돌은
// 안 나지만 마지막에 로드된 값이 이긴다) - 그래서 여기서는 그 이름들을 다시 선언하지 않고, EP2_BUNDLE
// 이라는 별도 객체에 이 파일만의 값을 담아둔다. 실제로 "지금부터 Episode 2를 그린다"가 되는 시점은
// story-engine.js의 activateEpisodeBundle(EP2_BUNDLE)이 호출될 때뿐이다(로비 Episode 2 카드 클릭).

const EP2_STORY_ID = "ep2_choijaehyeok";
const EP2_AUTO_USE_STORAGE_KEY = "story_ep2_auto_use_tickets";
const EP2_ASSET_BASE = "assets/story/ep2/";

const EP2_CHAR_IMG = {
  jaehyuk: EP2_ASSET_BASE + "characters/jaehyuk.webp",
  jaehyuk_past: EP2_ASSET_BASE + "characters/jaehyuk_past.webp",
  hyunjae: EP2_ASSET_BASE + "characters/hyunjae.webp",
  jongbok: EP2_ASSET_BASE + "characters/jongbok.webp",
  jongbok_past: EP2_ASSET_BASE + "characters/jongbok_past.webp",
  sojung: EP2_ASSET_BASE + "characters/sojung.webp",
  sojung_past: EP2_ASSET_BASE + "characters/sojung_past.webp",
  juheon: EP2_ASSET_BASE + "characters/juheon.webp",
  juheon_sword: EP2_ASSET_BASE + "characters/juheon_sword.webp",
  seungyu: EP2_ASSET_BASE + "characters/seungyu.webp",
  ganghee: EP2_ASSET_BASE + "characters/ganghee.webp",
  ganghee2: EP2_ASSET_BASE + "characters/ganghee2.webp",
  yeongwoong: EP2_ASSET_BASE + "characters/yeongwoong.webp",
  yeongwoong_armed: EP2_ASSET_BASE + "characters/yeongwoong_armed.webp",
};

const EP2_BG = {
  player_home: EP2_ASSET_BASE + "backgrounds/player_home.webp",
  fight: EP2_ASSET_BASE + "backgrounds/fight.webp",
  alley: EP2_ASSET_BASE + "backgrounds/alley.webp",
  jaehyuk_mansion: EP2_ASSET_BASE + "backgrounds/jaehyuk_mansion.webp",
  jaehyuk_mansion_inside: EP2_ASSET_BASE + "backgrounds/jaehyuk_mansion_inside.webp",
  empty_plain: EP2_ASSET_BASE + "backgrounds/empty_plain.webp",
  empty_ruins: EP2_ASSET_BASE + "backgrounds/empty_ruins.webp",
  grand_plaza_day: EP2_ASSET_BASE + "backgrounds/grand_plaza_day.webp",
  grand_plaza_ruins: EP2_ASSET_BASE + "backgrounds/grand_plaza_ruins.webp",
  dungeon_inside: EP2_ASSET_BASE + "backgrounds/dungeon_inside.webp",
  mage_academy: EP2_ASSET_BASE + "backgrounds/mage_academy.webp",
  mage_dungeon: EP2_ASSET_BASE + "backgrounds/mage_dungeon.webp",
  mage_tower: EP2_ASSET_BASE + "backgrounds/mage_tower.webp",
  majukdong_cafe: EP2_ASSET_BASE + "backgrounds/majukdong_cafe.webp",
  monsterpie_shop: EP2_ASSET_BASE + "backgrounds/monsterpie_shop.webp",
  end1: EP2_ASSET_BASE + "backgrounds/end1.webp",
  end2: EP2_ASSET_BASE + "backgrounds/end2.webp",
  end3: EP2_ASSET_BASE + "backgrounds/end3.webp",
  end4: EP2_ASSET_BASE + "backgrounds/end4.webp",
  end5: EP2_ASSET_BASE + "backgrounds/end5.webp",
  end6: EP2_ASSET_BASE + "backgrounds/end6.webp",
  end7: EP2_ASSET_BASE + "backgrounds/end7.webp",
  end8: EP2_ASSET_BASE + "backgrounds/end8.webp",
  end9: EP2_ASSET_BASE + "backgrounds/end9.webp",
  end10: EP2_ASSET_BASE + "backgrounds/end10.webp",
  end11: EP2_ASSET_BASE + "backgrounds/end11.webp",
  end12: EP2_ASSET_BASE + "backgrounds/end12.webp",
  end13: EP2_ASSET_BASE + "backgrounds/end13.webp",
  end14: EP2_ASSET_BASE + "backgrounds/end14.webp",
  end15: EP2_ASSET_BASE + "backgrounds/end15.webp",
  end16: EP2_ASSET_BASE + "backgrounds/end16.webp",
  end17: EP2_ASSET_BASE + "backgrounds/end17.webp",
  end18: EP2_ASSET_BASE + "backgrounds/end18.webp",
  end19: EP2_ASSET_BASE + "backgrounds/end19.webp",
  end20: EP2_ASSET_BASE + "backgrounds/end20.webp",
  end21: EP2_ASSET_BASE + "backgrounds/end21.webp",
  end22: EP2_ASSET_BASE + "backgrounds/end22.webp",
};

const EP2_PLAYER = { name: '__PLAYER_NAME__', sub: '', key: null, hideSub: true };

// 최재혁의 편지(S#2, "김남옥의 서브스토리 편지 씬과 같은 방식으로" 요청됨) - 겉지/속지는 캐릭터와
// 무관한 범용 종이 텍스처라 story/scenario/sub1_kimnamok.js와 함께 assets/story/shared/letter/에서
// 공유한다(에피소드 폴더마다 중복 보관하지 않는다).
const EP2_IMG_ENVELOPE = "assets/story/shared/letter/envelope.webp";
const EP2_IMG_LETTERPAPER = "assets/story/shared/letter/paper.webp";

// 귀환의 돌/마법봉/펜던트(type:'itemReveal'/'itemHide' 전용, story-engine.js 참고)
const EP2_IMG_RETURN_STONE = EP2_ASSET_BASE + "items/return_stone.webp";
const EP2_IMG_MAGIC_WAND = EP2_ASSET_BASE + "items/magic_wand.webp";
const EP2_IMG_PENDANT = EP2_ASSET_BASE + "items/pendant.webp";

// ep1에 등장했던 인물(송주헌/이영웅/강승유/강 희)은 ep1 컬렉터 엔딩(story/scenario/ep1_yoondaewoong.js
// SCENE_COLLECTOR_ENDING)에서 밝혀진 성인 직업을 sub로 쓴다(JUHEON_ADULT="ester CAD CEO"와 동일 회사,
// SEUNGYU_ADULT="복싱선수", GANGHEE_ADULT="의사" 표기를 그대로 따름 - 이영웅은 ep1엔 별도 "_ADULT"
// 상수 없이 성형외과 원장으로 등장원장으로 묘사된다). 나머지 신규 인물(최재혁/김현재/이종복/임소정)은
// 전부 "마법사"(김현재는 스크립트 자체가 "대마법사"로 지칭).
const JAEHYUK = { name: '최재혁', sub: '마법사', key: 'jaehyuk' };
const HYUNJAE = { name: '김현재', sub: '마법사', key: 'hyunjae' };
// 이종복/임소정은 귀환의 돌로 200년 전 과거로 돌아갔을 때(대광장 편)만 등장하므로 항상 젊은 시절
// 스탠딩(_past)으로 보여준다.
const JONGBOK2 = { name: '이종복', sub: '마법사', key: 'jongbok_past' };
const SOJUNG2 = { name: '임소정', sub: '마법사', key: 'sojung_past' };
// "???"로 표시되는 대화 상대들 - 전부 실존 인물(김현재/이종복/임소정)이고 얼굴(스탠딩)은 처음부터
// 그 인물 그대로 보이지만, 정체가 아직 밝혀지지 않은 대사 구간에서는 이름표만 "???"로 가린다(요청됨).
// 임소정은(이종복과 달리) 대광장 편에서 자기 이름을 끝까지 한 번도 밝히지 않아서 원문 그대로 계속
// "???"인 채로 남는다.
const HYUNJAE_VEILED = { name: '???', sub: '', key: 'hyunjae' };
const JONGBOK_VEILED = { name: '???', sub: '', key: 'jongbok_past' };
const SOJUNG2_VEILED = { name: '???', sub: '', key: 'sojung_past' };
const JUHEON2 = { name: '송주헌', sub: 'ester CAD CEO', key: 'juheon' };
const JUHEON2_SWORD = { name: '송주헌', sub: 'ester CAD CEO', key: 'juheon_sword' };
const YEONGWOONG2 = { name: '이영웅', sub: '영웅', key: 'yeongwoong' };
const SEUNGYU2 = { name: '강승유', sub: '복싱선수', key: 'seungyu' };
const GANGHEE2_ADULT = { name: '강 희', sub: '의사', key: 'ganghee' };

/* =========================================================
   S#1 - 최재혁의 대저택 (현재/낮)
   ========================================================= */
const EP2_S1_INTRO = [
  { type:'narration', text:'낡은 철문을 지나 대저택 안으로 들어섰다. 이곳에 오는 것도 정말 오랜만이다. 어릴 때부터 알고 지낸 최재혁. 가끔씩 찾아뵙기는 했지만, 오늘은 왠지 직접 얼굴을 보고 싶었다.', showBg:'jaehyuk_mansion_inside', chars:{center:null}, bgm:'10. someday, sometime' },
  { type:'line', speaker:EP2_PLAYER, text:'할아버지, 계세요?' },
  { type:'narration', text:'(거실 안쪽에서 익숙한 목소리가 들려왔다.)' },
  { type:'line', speaker:JAEHYUK, text:'……왔냐. 문은 좀 살살 열어라. 그거 생각보다 오래된 거다.', chars:{center:'jaehyuk'} },
  { type:'narration', text:'재혁의 얼굴은 여전히 늙지 않고 청년 시절의 모습을 고이 담아두고 있었다. 하지만 소파에 앉아 있던 재혁은 평소와 약간 달랐다. 미묘했지만, 표정이 굳어 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'요즘 어떻게 지내셨어요?' },
  { type:'line', speaker:JAEHYUK, text:'나는 괜찮다. 하지만 세상은 그렇지 않아. 때가 도래한 것이야. 이제 나도 꽁꽁 숨기고만 있을 순 없겠군..' },
  { type:'line', speaker:EP2_PLAYER, text:'...네?' },
  { type:'narration', text:'재혁이 천천히 나를 바라봤다.' },
  { type:'line', speaker:JAEHYUK, text:'이제 얼마 남지 않았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭐가요?' },
  { type:'line', speaker:JAEHYUK, text:'세계가 멸망할 날이. 아마 인간들은 느끼지 못할 거야.' },
  { type:'thought', text:'(순간, 말문이 막혔다. 무슨 소리를 하시는 건지 모르겠다.)' },
  { type:'line', speaker:EP2_PLAYER, text:'할아버지, 무슨 말씀을...' },
  { type:'line', speaker:JAEHYUK, text:'그리고 나는 마법사다. 물론 나도 300년이 더 되게 살아서 허약해졌지만.' },
  { type:'line', speaker:EP2_PLAYER, text:'...예?' },
  { type:'thought', text:'(이상한 말과는 다르게 얼굴은 진지한 표정이었다.)' },
  { type:'line', speaker:JAEHYUK, text:'지금부터 하는 이야기는 믿기 어려울 게다.' },
  { type:'line', speaker:JAEHYUK, text:'하지만 네가 믿든 말든 상관없다. 그것 또한 이 세계가 돌아가는 방식일지도 모르니 말이야.' },
  { type:'line', speaker:JAEHYUK, text:'변화는 항상 존재하고 그에 대한 선택 그리고 책임은 개개인의 몫이니 말이야.' },
  { type:'line', speaker:JAEHYUK, text:'그런데.' },
  { type:'line', speaker:JAEHYUK, text:'선택할 거면 알고 선택해.' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'line', speaker:JAEHYUK, text:'모르고 있다가 전부 빼앗긴 뒤에 "나는 몰랐으니까 어쩔 수 없었어."' },
  { type:'line', speaker:JAEHYUK, text:'그런 소리나 하는 꼴은 보기 싫으니까.' },
  { type:'line', speaker:EP2_PLAYER, text:'왜 저한테 그렇게까지…….' },
  { type:'line', speaker:JAEHYUK, text:'왜긴 왜야.' },
  { type:'narration', text:'재혁이 자리에서 일어났다.' },
  { type:'line', speaker:JAEHYUK, text:'네놈이니까 그렇지.' },
  { type:'line', speaker:JAEHYUK, text:'거창한 이유 같은 건 없어.' },
  { type:'line', speaker:JAEHYUK, text:'세계를 사랑해서?' },
  { type:'line', speaker:JAEHYUK, text:'인류가 위대해서?' },
  { type:'line', speaker:JAEHYUK, text:'그딴 건 나도 몰라.' },
  { type:'line', speaker:JAEHYUK, text:'300년이나 살았으면 인간이 얼마나 답답한 생물인지 질릴 만큼 봤다고.' },
  { type:'line', speaker:JAEHYUK, text:'싸우고. 배신하고. 별것도 아닌 걸로 서로 미워하고. 진짜 지겹도록.' },
  { type:'line', speaker:EP2_PLAYER, text:'그럼 왜 지키려고 하는데요?' },
  { type:'line', speaker:JAEHYUK, text:'그래서 뭐? 사람이 한심하면 죽어도 되는 거냐?' },
  { type:'line', speaker:JAEHYUK, text:'틀린 선택을 했으면 인생 전체가 틀린 게 돼?' },
  { type:'line', speaker:JAEHYUK, text:'서로 싸웠으면 내일 다시 화해할 기회도 없어?' },
  { type:'line', speaker:JAEHYUK, text:'아니잖아.' },
  { type:'line', speaker:JAEHYUK, text:'네놈도 맨날 별것도 아닌 걸로 웃잖아.' },
  { type:'line', speaker:JAEHYUK, text:'친구랑 싸우고도 또 만나고. 뭐가 그렇게 좋은지 시끄럽게 떠들어대고.' },
  { type:'line', speaker:JAEHYUK, text:'그런 게 살아가는 거 아니냐.' },
  { type:'narration', text:'그곳에는 거대한 금속 상자가 놓여 있었다.' },
  { type:'line', speaker:JAEHYUK, text:'그런데 누가 나타나서. "이 세계는 잘못됐으니까 없애겠습니다. 더 나은 세상을 만들겠습니다."' },
  { type:'line', speaker:JAEHYUK, text:'그렇게 말하면...... 아, 그렇습니까 하고 다 내줘야 하냐?' },
  { type:'line', speaker:JAEHYUK, text:'웃기지 마. 나는 싫어.' },
  { type:'line', speaker:JAEHYUK, text:'네놈들이 내일도 살아 있는 걸 보고 싶다. 다시 여기 찾아와서 시끄럽게 떠드는 것도 보고 싶어.' },
  { type:'line', speaker:JAEHYUK, text:'그 정도 이유면 충분하잖아.' },
  { type:'line', speaker:JAEHYUK, text:'저기에 과거를 바꿀 수 있는 방법이 있어.' },
  { type:'narration', text:'나는 상자를 바라봤다.' },
  { type:'narration', text:'그리고 다시 재혁을 바라봤다.' },
  { type:'thought', text:'아무래도 오늘은 평범한 안부 인사로 끝날 것 같지 않았다.' },
];

const EP2_S1_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 커다란 상자에 대해 관심을 가진다.', key:'1' },
    { label:'② 재혁을 이해하고 다른 주제로 대화한다.', key:'2' },
    { label:'③ 과거를 바꾸는 것은 말도 안 된다며 재혁을 질타한다.', key:'3' },
    { label:'④ 최재혁에게 쌍욕을 박는다.', key:'4' },
  ],
};

const EP2_S1_BRANCHES = {
  '1': [
    { type:'narration', text:'나는 상자 앞으로 다가갔다.' },
    { type:'line', speaker:EP2_PLAYER, text:'잠깐만요. 진짜 과거로 갈 수 있다고요?' },
    { type:'line', speaker:JAEHYUK, text:'그래.' },
    { type:'narration', text:'가까이서 보니 더 이상했다. 거대한 금속 상자 곳곳에 알아볼 수 없는 문양이 새겨져 있었다.' },
    { type:'line', speaker:EP2_PLAYER, text:'여기 안에 뭐가 들었어요?' },
    { type:'line', speaker:JAEHYUK, text:'귀환의 돌.' },
    { type:'line', speaker:EP2_PLAYER, text:'귀환의 돌?' },
    { type:'itemReveal', item:EP2_IMG_RETURN_STONE, chars:{center:'jaehyuk'} },
    { type:'line', speaker:JAEHYUK, text:'과거 이 세계 멸망 사태가 벌어지게 되는 시발점. 그곳으로 돌아가기 위한 물건이다.' },
    { type:'itemHide' },
    { type:'line', speaker:EP2_PLAYER, text:'그게 정말 가능해요?' },
    { type:'narration', text:'재혁의 표정이 순간 굳었다.' },
    { type:'line', speaker:JAEHYUK, text:'시간과 공간의 상대성을 믿는가? 하나를 알고 둘을 알지 못하는 군.' },
    { type:'line', speaker:JAEHYUK, text:'인류는 아직 시간과 공간의 가역성에 대한 실마리를 찾지 못하고 있지.' },
    { type:'line', speaker:JAEHYUK, text:'어줍잖은 사고 실험을 통해서 안된다고 단정이나 하고 말이야.' },
    { type:'line', speaker:EP2_PLAYER, text:'그게 무슨 뜻이에요?' },
    { type:'line', speaker:JAEHYUK, text:'마법이론은 이미 현대 과학기술 수준을 월등히도 뛰어넘었어. 그리고 다양한 경우에 대한 시행착오를 겪었지.' },
    { type:'line', speaker:JAEHYUK, text:'그리고 지금 이렇게 인류를 살도록 하는 것이 최선이라는 것을 느꼈어.' },
    { type:'line', speaker:JAEHYUK, text:'아마 이 멸망을 의도하고 있는 것도 지금의 대마법사 그분.. 그분의 의도일 지도 모르겠다.' },
    { type:'line', speaker:JAEHYUK, text:'그리고 내가 이 돌을 만든 이유는 단순하다.' },
    { type:'narration', text:'잠시 침묵이 흘렀다.' },
    { type:'line', speaker:JAEHYUK, text:'난 그래도 네놈들이 좋다.' },
    { type:'thought', text:'갑자기 심장이 묘하게 뛰기 시작했다.', stopBgm:true },
  ],
  '2': [
    { type:'narration', text:'나는 장치를 잠시 바라보다가 고개를 저었다.' },
    { type:'line', speaker:EP2_PLAYER, text:'할아버지가 요즘 많이 힘드신가 봐요.' },
    { type:'line', speaker:JAEHYUK, text:'……뭐?' },
    { type:'line', speaker:EP2_PLAYER, text:'세계가 멸망한다거나, 마법사라거나… 너무 무서운 이야기잖아요.' },
    { type:'narration', text:'재혁은 한동안 아무 말이 없었다.' },
    { type:'narration', text:'그러다 피식 웃었다.' },
    { type:'line', speaker:JAEHYUK, text:'그래. 네가 그렇게 생각하는 것도 당연하지.' },
    { type:'line', speaker:EP2_PLAYER, text:'그래도 건강은 잘 챙기세요. 요즘 식사는 제대로 하세요?' },
    { type:'line', speaker:JAEHYUK, text:'쓸데없는 걱정을 하는구나.' },
    { type:'line', speaker:EP2_PLAYER, text:'제가 할아버지 안부 물으러 온 거니까요.' },
    { type:'narration', text:'그제야 재혁의 얼굴에 조금 미소가 번졌다. 우리는 한동안 옛날 이야기를 나눴다. 내가 어렸을 때 이 집에서 놀았던 이야기, 부모님에 대한 이야기, 그리고 최근 어떻게 지내고 있는지.' },
    { type:'narration', text:'시간이 꽤 지나 자리에서 일어났다.' },
    { type:'line', speaker:EP2_PLAYER, text:'저는 이제 가볼게요.' },
    { type:'line', speaker:JAEHYUK, text:'그래.' },
    { type:'narration', text:'현관으로 향하는 순간, 뒤에서 재혁의 목소리가 들렸다.' },
    { type:'line', speaker:JAEHYUK, text:'혹시 이상한 일이 생기거든… 나를 찾아오너라.' },
    { type:'narration', text:'나는 뒤돌아보며 웃었다.' },
    { type:'line', speaker:EP2_PLAYER, text:'네.' },
    { type:'narration', text:'대수롭지 않게 집을 나섰다.' },
    { type:'thought', text:'하지만 이상하게도 마지막에 본 재혁의 눈빛이 계속 머릿속에 남았다.', stopBgm:true },
  ],
  '3': [
    { type:'narration', text:'나는 어이가 없다는 듯 상자를 바라봤다.' },
    { type:'line', speaker:EP2_PLAYER, text:'할아버지, 과거로 갈 수 있다니요.' },
    { type:'line', speaker:JAEHYUK, text:'왜.' },
    { type:'line', speaker:EP2_PLAYER, text:'혹시 문과에요? 상대성 이론 몰라요? 하 참.. 어처구니가 없어서 ㅋㅋ' },
    { type:'narration', text:'재혁의 표정이 굳었다.' },
    { type:'line', speaker:EP2_PLAYER, text:'그리고 마법사라니… 에이 그러면 내가 독서 RPG 제작자로 되겠네? 세계가 멸망한다는 것도 그렇고요.' },
    { type:'line', speaker:JAEHYUK, text:'네가 믿지 않는다고 해서 거짓이 되는 것은 아니다.' },
    { type:'line', speaker:EP2_PLAYER, text:'그럼 증명해 보세요.' },
    { type:'narration', text:'나는 상자를 가르킨다.' },
    { type:'line', speaker:EP2_PLAYER, text:'정말 과거로 갈 수 있으면 해보시라구요.' },
    { type:'narration', text:'잠시 침묵이 흘렀다.' },
    { type:'narration', text:'재혁은 나를 바라보다가 낮은 목소리로 말했다.' },
    { type:'line', speaker:JAEHYUK, text:'아직은 안 돼.' },
    { type:'line', speaker:EP2_PLAYER, text:'거봐요.' },
    { type:'narration', text:'나는 한숨을 내쉬었다.' },
    { type:'line', speaker:EP2_PLAYER, text:'할아버지, 요즘 많이 외로우신 거 아니에요? 혼자 이런 걸 만들면서 이상한 생각을 하시는 것 같은데…' },
    { type:'line', speaker:JAEHYUK, text:'그만.' },
    { type:'narration', text:'평소에는 한 번도 화를 내지 않던 재혁의 목소리가 차갑게 변했다.' },
    { type:'line', speaker:JAEHYUK, text:'네가 무엇을 믿든 상관없다. 하지만 곧 네 눈으로 확인하게 될 것이다.' },
    { type:'line', speaker:EP2_PLAYER, text:'무슨 말이에요?' },
    { type:'line', speaker:JAEHYUK, text:'그때도 지금처럼 웃을 수 있는지 보자꾸나.' },
    { type:'thought', text:'나는 더 이상 대화할 의미가 없다고 생각했다.' },
    { type:'line', speaker:EP2_PLAYER, text:'저 갈게요.' },
    { type:'narration', text:'현관을 나서며 뒤를 돌아봤다.' },
    { type:'narration', text:'이상하게도 그의 표정은 화난 사람의 얼굴이 아니었다.' },
    { type:'thought', text:'마치… 무언가를 기다리는 사람처럼 보였다.', stopBgm:true },
  ],
};

const EP2_S1_BAD_END = [
  { type:'line', speaker:EP2_PLAYER, text:'재혁아!!! XX 뭐라는거야 XXXX야!!', emphasis:true, stopBgm:true },
  // 강승유 배드 엔드(ep1_yoondaewoong.js SCENE4_OUTCOMES)와 동일한 기법 - 이 줄부터 배경을 즉시(페이드
  // 없이) 검은 화면으로 끊고, 몇 줄 뒤 "퍽!"에서 CG 배경이 같은 방식으로(noBgFade) 나타나며 impact
  // 흔들림도 함께 터진다.
  { type:'narration', text:'순간 거실의 공기가 얼어붙었다.', clearBg:true, noBgFade:true, chars:{center:null} },
  { type:'line', speaker:JAEHYUK, text:'…….' },
  { type:'line', speaker:EP2_PLAYER, text:'세계가 멸망하네, 마법사네, 타임머신이네! 나이가 몇인데 아직도 이런—', emphasis:true },
  { type:'narration', text:'퍽!', showBg:'end1', noBgFade:true, impact:true, chars:{center:null}, bgm:'Dinner Punch', se:'SE_Close_01' },
  { type:'line', speaker:EP2_PLAYER, text:'억!' },
  { type:'narration', text:'눈앞이 번쩍했다.' },
  { type:'narration', text:'나는 그대로 바닥에 나뒹굴었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭐야…….' },
  { type:'narration', text:'입안에서 피 맛이 났다.' },
  { type:'line', speaker:JAEHYUK, text:'마법을 쓸 필요가 없구나.' },
  { type:'narration', text:'재혁이 주먹을 털며 말했다.' },
  { type:'line', speaker:JAEHYUK, text:'이게 훨씬 빠르다.' },
  { type:'line', speaker:EP2_PLAYER, text:'아니, 잠깐…….' },
  // 대사창을 아예 숨긴 채 impact+explosion만 재생하고 800ms 뒤 클릭 없이 자동으로 다음 줄로 넘어간다
  // (playSilentEffectBeat, story-engine.js 참고) - "다시 무언가가 날아왔다"를 글로 설명하는 대신
  // 연출 자체로 두 번째 타격을 전달한다.
  { type:'silentEffect', impact:true, explosion:true },
  { type:'narration', text:'그리고 내 의식은 그대로 끊겼다.', clearBg:true, noBgFade:true, stopBgm:true },
  { type:'timecard', text:'다음 날 아침', nextBg:'empty_plain' },
  { type:'line', speaker:EP2_PLAYER, text:'으…….', chars:{center:null} },
  { type:'narration', text:'머리를 부여잡고 일어났다.' },
  { type:'narration', text:'어젯밤 일이 꿈처럼 느껴졌다.' },
  { type:'narration', text:'나는 다시 그 저택을 찾아갔다.' },
  { type:'narration', text:'그런데 그곳에는 아무것도 없었다.', bgm:'2-04. Alkaline Tears' },
  { type:'line', speaker:EP2_PLAYER, text:'……어?' },
  { type:'narration', text:'분명 어제까지 있었던 거대한 대저택이 흔적도 없이 사라져 있었다.' },
  { type:'narration', text:'집이 있던 자리에는 풀만 무성했다.' },
  { type:'narration', text:'나는 멍하니 그곳을 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'대체…… 뭐야?' },
  { type:'narration', text:'나는 그냥 집으로 돌아왔다. 최재혁의 말이 계속 머릿속을 맴돌았다.' },
  { type:'thought', text:'세계가 멸망한다.' },
  { type:'narration', text:'처음에는 운석이라도 떨어지는 줄 알았다. 아니면 전쟁이나 대규모 학살 같은 끔찍한 사건을 말하는 줄 알았다.' },
  { type:'narration', text:'하지만 다음 날 아침, 뉴스를 보면서 이상한 생각이 들었다.', showBg:'player_home' },
  { type:'line', speaker:EP2_PLAYER, text:'저출산, 고령화….' },
  { type:'narration', text:'화면에는 줄어드는 출생률과 늘어나는 노인 인구에 대한 이야기가 나오고 있었다.' },
  { type:'narration', text:'다른 뉴스에서는 세대 갈등과 젠더 갈등이 끊임없이 이어지고 있었다.' },
  { type:'narration', text:'인터넷을 켜자 사람들은 서로를 이해하려 하기보다 자신과 다른 집단을 공격하고 있었다.' },
  { type:'narration', text:'지역, 세대, 성별, 빈부, 정치 성향….' },
  { type:'narration', text:'사람들은 점점 더 작은 집단으로 갈라지고 있었다.' },
  { type:'narration', text:'나는 문득 어제 재혁이 했던 말을 떠올렸다.' },
  { type:'thought', text:'세계가 멸망할 날이 얼마 남지 않았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'...이런 걸 말한 건가?' },
  { type:'narration', text:'도시는 여전히 멀쩡했다.' },
  { type:'narration', text:'사람들은 출근하고, 학교에 가고, 웃으며 이야기를 나누고 있었다.' },
  { type:'narration', text:'그런데 어쩌면 멸망이란 건 세상이 하루아침에 사라지는 게 아닐지도 모른다.' },
  { type:'narration', text:'서로를 믿지 못하고, 아이가 태어나지 않고, 세대가 단절되고, 사람들이 서로를 적으로 생각하기 시작하는 것.' },
  { type:'narration', text:'그렇게 사회를 이루던 연결이 하나씩 끊어지는 것.' },
  { type:'line', speaker:EP2_PLAYER, text:'설마…….' },
  { type:'thought', text:'최재혁이 말한 "멸망"은 이미 시작된 게 아닐까?' },
];

/* =========================================================
   S#2 - 다음 날 아침 (S#1 선택① 경로 전용 인트로 - 재혁을 다시 찾아갈지, 늦잠을 잘지, 조사할지)
   ========================================================= */
const EP2_S2_MORNING_INTRO = [
  { type:'timecard', text:'다음 날 아침', nextBg:'player_home' },
  { type:'thought', text:'눈을 뜨자마자 어제의 일이 떠올랐다.', bgm:'14.Fruitful Blossom' },
  { type:'thought', text:'귀환의 돌. 마법사. 그리고 세계의 멸망.' },
  { type:'line', speaker:EP2_PLAYER, text:'대체 무슨 소리였던 거야…….' },
  { type:'narration', text:'침대에 누운 채 천장을 바라봤다.' },
  { type:'thought', text:'평소 같았으면 그냥 웃어넘겼을 이야기다.' },
  { type:'thought', text:'하지만 어제 봤던 귀환의 돌은 분명 신비로워 보였다.' },
  { type:'thought', text:'무엇보다 재혁의 표정이 마음에 걸렸다.' },
  { type:'thought', text:'농담을 하는 사람의 얼굴이 아니었다.' },
  { type:'thought', text:'난 그래도 네놈들이 좋다.' },
  { type:'thought', text:'그 말도 계속 머릿속을 맴돌았다.' },
  { type:'thought', text:'대체 나한테 뭘 원하는 걸까?' },
  { type:'narration', text:'한참을 고민하다가 몸을 일으켰다.' },
  { type:'thought', text:'지금이라도 재혁을 다시 찾아가 물어볼까.' },
  { type:'thought', text:'아니면 그냥 어제 일은 잊어버리고 평범한 일상으로 돌아갈까.' },
  { type:'narration', text:'그런데 한 가지 방법이 더 있었다.' },
  { type:'thought', text:'대마법사.' },
  { type:'thought', text:'재혁이 멸망을 의도하고 있는 자가 대마법사라고 했었다.' },
  { type:'thought', text:'인터넷으로 먼저 조사해보는 것도 나쁘지 않을 것 같다.' },
  { type:'narration', text:'나는 한숨을 내쉬며 휴대폰을 집어 들었다.' },
  { type:'thought', text:'오늘 하루가 평범하게 흘러갈 것 같지는 않았다.' },
];

const EP2_S2_MORNING_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 최재혁을 다시 찾아가본다.', key:'1' },
    { label:'② 아무 생각하지 말고 그냥 늦잠을 잔다.', key:'2' },
    { label:'③ \'대마법사\'에 대해 직접 조사해본다.', key:'3' },
  ],
};

// 재혁을 다시 찾아간다 - 귀환의 돌을 받고 그대로 200년 전으로 빨려 들어간다(대광장 편으로 직행,
// 며칠 뒤 벌어지는 "세상이 멈춘다" 사건과는 아예 다른 별도 타임라인).
const EP2_S2_MORNING_BRANCH1 = [
  { type:'narration', text:'나는 결국 다시 최재혁의 저택을 찾아갔다.', showBg:'jaehyuk_mansion' },
  { type:'narration', text:'문을 두드리기도 전에 문이 열렸다.', se:'SE_DoorOpen_01'},
  { type:'line', speaker:JAEHYUK, text:'올 줄 알았다.', chars:{center:'jaehyuk'} },
  { type:'line', speaker:EP2_PLAYER, text:'……기다리고 있었어요?' },
  { type:'line', speaker:JAEHYUK, text:'그래. 오늘이 정확한 때다.' },
  { type:'narration', text:'재혁은 곧장 나를 안으로 이끌었다.', showBg:'jaehyuk_mansion_inside' },
  { type:'narration', text:'그의 주머니에서 무언가 빛나고 있었다.' },
  { type:'narration', text:'재혁은 주머니에서 어제 봤던 귀환의 돌을 조심스럽게 꺼냈다.' },
  { type:'itemReveal', item:EP2_IMG_RETURN_STONE, chars:{center:'jaehyuk'} },
  { type:'narration', text:'재혁은 돌을 바라보며 조용히 말했다.' },
  { type:'line', speaker:JAEHYUK, text:'나는 이것을 만드는 데 평생을 바쳤다.' },
  { type:'line', speaker:JAEHYUK, text:'그런데 웃기지. 겨우 완성하고 나니까 정작 내 몸이 먼저 한계에 와버렸어.' },
  { type:'narration', text:'그의 손이 미세하게 떨리고 있었다.' },
  { type:'line', speaker:JAEHYUK, text:'이제 내 몸으로는 과거로 갈 수 없다.' },
  { type:'line', speaker:EP2_PLAYER, text:'그럼…….' },
  { type:'line', speaker:JAEHYUK, text:'그래서 네가 가야 한다.' },
  { type:'line', speaker:EP2_PLAYER, text:'제가요?' },
  { type:'line', speaker:JAEHYUK, text:'과거로 가서 바꿔야 할 것이 있다.' },
  { type:'narration', text:'나는 믿을 수 없다는 표정으로 그를 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭘 바꾸라는 건데요?' },
  { type:'narration', text:'재혁은 대답하지 않았다.' },
  { type:'itemHide' },
  { type:'narration', text:'대신 귀환의 돌을 내 쪽으로 밀었다.' },
  { type:'line', speaker:JAEHYUK, text:'그건 과거에 도착하면 알게 될 것이다.' },
  { type:'line', speaker:EP2_PLAYER, text:'잠깐만요. 그런 중요한 일을 설명도 없이 저한테 맡긴다고요?' },
  { type:'line', speaker:JAEHYUK, text:'모든 것을 설명할 시간은 없다.' },
  { type:'narration', text:'재혁이 처음으로 간절한 표정을 지었다.' },
  { type:'line', speaker:JAEHYUK, text:'부탁한다.' },
  { type:'narration', text:'그 순간, 귀환의 돌에서 희미한 빛이 흘러나왔다.' },
  { type:'thought', text:'그리고 순식간에 빛이 나를 먹여 삼켰다.', whiteout:true, cameraPunch:true, stopBgm:true, se:'SE_Teleport_01a' },
];

// 늦잠을 잔다 - 저녁까지 자다가 원인 불명의 정전 뉴스를 본다. 이 경로와 아래 조사 경로는 모두
// "며칠 뒤 세상이 멈춘다" 사건(EP2_CRISIS_CONVERGENCE_INTRO)으로 합류한다.
const EP2_S2_MORNING_BRANCH2 = [
  { type:'narration', text:'나는 휴대폰을 내려놓았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'아무래도 꿈을 너무 생생하게 꿨나 보네.' },
  { type:'thought', text:'과거 회귀고, 마법사고, 세계의 멸망이라니.' },
  { type:'thought', text:'생각할수록 머리만 아팠다.' },
  { type:'line', speaker:EP2_PLAYER, text:'오늘 하루 정도는 그냥 쉬자.' },
  { type:'narration', text:'나는 다시 이불 속으로 파고들었다.' },
  { type:'narration', text:'눈을 감자 어제의 일이 떠올랐다.' },
  { type:'thought', text:'난 그래도 네놈들이 좋다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……아, 몰라.' },
  { type:'narration', text:'그렇게 중얼거리며 잠을 청했다.' },
  { type:'narration', text:'얼마나 시간이 지났을까.' },
  { type:'narration', text:'눈을 뜨자 방 안이 어두워져 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'어……?' },
  { type:'narration', text:'휴대폰을 확인했다.' },
  { type:'narration', text:'오후 6시.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭐야. 하루를 통째로 날렸네.' },
  { type:'narration', text:'그때 TV에 긴급 뉴스가 떴다.', glitch:true },
  { type:'narration', text:'[긴급 속보]' },
  { type:'narration', text:'나는 무심코 화면을 눌렀다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……뭐야?' },
  { type:'narration', text:'뉴스에는 정부가 발표한 긴급 대책과 함께, 원인을 알 수 없는 대규모 정전이 발생했다는 내용이 나오고 있었다.' },
  { type:'narration', text:'그리고 마지막 문장이 눈에 들어왔다.' },
  { type:'narration', text:'[전문가들은 사회 기반 시설에 대한 추가적인 혼란 가능성을 배제할 수 없다고 밝혔습니다.]' },
  { type:'narration', text:'나는 잠시 화면을 바라봤다.' },
  { type:'narration', text:'어제 재혁이 했던 말이 떠올랐다.' },
  { type:'thought', text:'세계가 멸망할 날이 얼마 남지 않았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'설마…….' },
  { type:'narration', text:'나는 곧바로 휴대폰을 내려놓았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'아니야. 우연이겠지.' },
  { type:'thought', text:'그렇게 생각하고 싶었다.', stopBgm:true },
];

// '대마법사'에 대해 조사한다 - 인터넷에서 재혁의 말과 정확히 들어맞는 오래된 문서를 발견한다.
const EP2_S2_MORNING_BRANCH3 = [
  { type:'narration', text:'나는 검색창을 열었다.' },
  { type:'thought', text:'대마법사.' },
  { type:'narration', text:'처음에는 게임이나 판타지 소설 같은 결과만 나왔다.' },
  { type:'line', speaker:EP2_PLAYER, text:'역시 이런 건가…….' },
  { type:'narration', text:'그런데 검색어를 조금씩 바꿔보던 중 이상한 결과 하나가 눈에 들어왔다.' },
  { type:'narration', text:'[ester CAD 바라기 작성 - 대마법사에 관한 기록]' },
  { type:'narration', text:'어떤 이상한 사람이 올린 오래된 문서였다.' },
  { type:'narration', text:'문서를 열자 믿기 힘든 내용이 적혀 있었다.' },
  { type:'narration', text:'「마법 이론은 이미 현대 과학 기술을 뛰어넘었다.」' },
  { type:'narration', text:'「우리 눈에 보이지는 않지만 우리는 결국 마법사들의 설계대로 살게 된다.」' },
  { type:'line', speaker:EP2_PLAYER, text:'……뭐야, 이거.' },
  { type:'narration', text:'스크롤을 내렸다.' },
  { type:'narration', text:'그리고 마지막 문장에서 손가락이 멈췄다.', glitch:true },
  { type:'narration', text:'「이제는 유일한 대마법사만이 존재하고 그 대마법사에 의해 우리는 결국 멸망하게 된다.」' },
  { type:'thought', text:'어제 재혁이가 말했던 내용과 똑같았다.' },
  { type:'thought', text:'우연이라고 생각하기에는 너무 정확했다.' },
  { type:'narration', text:'문서의 작성자에 대해 알아보려 했지만, 그 외에 작성자에 대해 알 수 있는 정보는 단 하나도 존재하지 않았다.' },
  { type:'narration', text:'대신 프로필 소개 가장 아래에 이상한 문장이 하나 남아 있었다.' },
  { type:'narration', text:'「그가 다시 돌아오는 날, 세계의 운명도 함께 돌아간다.」' },
  { type:'narration', text:'나는 화면을 한참 바라봤다.' },
  { type:'thought', text:'이건 단순한 판타지 이야기가 아니었다.' },
  { type:'thought', text:'적어도 누군가는 귀환의 돌과 대마법사에 대해 알고 있었다.' },
  { type:'narration', text:'나는 급하게 휴대폰을 챙겼다.' },
  { type:'line', speaker:EP2_PLAYER, text:'최재혁…….' },
  { type:'thought', text:'이제 직접 물어봐야 했다.' },
  { type:'thought', text:'대체 재혁은 누구이며, 왜 나에게 과거로 가라고 하는 걸까?', stopBgm:true },
];

/* =========================================================
   S#2 - 최재혁의 대저택, 편지 (S#1 선택② 경로 전용) - 편지 연출은 story-sub-engine.js의
   openLetter/closeLetter를 story-engine.js에 이식한 것을 그대로 사용한다(요청됨).
   ========================================================= */
const EP2_S2_LETTER_INTRO = [
  { type:'narration', text:'그다음 날, 나는 여느 때처럼 최재혁 할아버지를 찾아갔다.', showBg:'jaehyuk_mansion' },
  { type:'line', speaker:EP2_PLAYER, text:'할아버지, 계세요?' },
  { type:'narration', text:'대답이 없었다.', showBg:'jaehyuk_mansion_inside' },
  { type:'narration', text:'집 안으로 들어가 보니 이상하게도 모든 것이 정리되어 있었다. 사람의 흔적이 사라진 것처럼 조용했다.', bgm:'Fading Static' },
  { type:'narration', text:'그리고 책상 위에 작은 상자 하나와 펜던트 하나가 놓여 있었다.' },
  { type:'narration', text:'그 옆에는 짧은 편지가 있었다.' },
  { type:'letterOpen', envelope:EP2_IMG_ENVELOPE, paper:EP2_IMG_LETTERPAPER },
  // 편지지 한 장에 다 담기엔 너무 길어서(뒷부분이 잘림) sub1_kimnamok.js의 편지 연출처럼 여러 장의
  // type:'letter' 줄로 끊어 클릭할 때마다 다음 내용이 새로 타이핑되게 한다 - 편지(겉지/속지)는 그동안
  // 계속 펼쳐진 채로 있고 내용만 갱신된다.
  { type:'letter', text:'나에게 무슨 일이 생겼다면 이 편지를 읽고 있겠지.' },
  { type:'letter', text:'이 상자는 오래전 정체불명의 마법사가 남긴 물건이다. 아카데미에서도 결국 열지 못했다.\n이제는 네게 맡긴다.' },
  { type:'letter', text:'왜 네놈이냐고?\n내가 믿으니까. 그거면 됐잖아.' },
  { type:'letter', text:'그리고 펜던트.\n정말 위험한 순간이 오면 깨뜨려.\n네 힘으로는 아무것도 할 수 없는데도, 그래도 포기하고 싶지 않다면.\n그때 내가 간다.' },
  { type:'letter', text:'그러니까 혼자 다 짊어지지 마.\n\n— 최재혁' },
  { type:'letterClose' },
  { type:'itemReveal', item:EP2_IMG_PENDANT },
  { type:'narration', text:'나는 펜던트를 손에 쥐었다.' },
  { type:'thought', text:'대체 무슨 일이 벌어지고 있는 걸까.' },
  { type:'itemHide' },
];

const EP2_S2_LETTER_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 펜던트를 챙긴다.', key:'1' },
    { label:'② 편지만 읽고 그냥 나간다.', key:'2' },
    { label:'③ 상자의 비밀문자를 입력해본다.', key:'3' },
  ],
};

const EP2_S2_LETTER_BRANCH1 = [
  { type:'narration', text:'나는 잠시 고민하다가 펜던트를 집어 들었다.' },
  { type:'narration', text:'차갑고 묵직한 감촉이 손끝에 느껴졌다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이걸 깨뜨리면… 할아버지가 나타난다는 거지?' },
  { type:'thought', text:'정말 믿기 힘든 이야기였다.' },
  { type:'thought', text:'하지만 지금까지 벌어진 일을 생각하면 완전히 무시할 수도 없었다.' },
  { type:'narration', text:'나는 펜던트를 주머니에 넣었다.', stopBgm:true },
];

const EP2_S2_LETTER_BRANCH2 = [
  { type:'narration', text:'나는 편지를 다시 내려놓았다.' },
  { type:'thought', text:'작은 상자도, 펜던트도 더 이상 보고 싶지 않았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……이제 그만하자.' },
  { type:'thought', text:'할아버지가 남긴 이야기들은 여전히 이해할 수 없었다.' },
  { type:'thought', text:'마법 아카데미니, 의문의 상자니, 위험할 때 자신을 소환하라는 펜던트니.' },
  { type:'thought', text:'지금까지는 그냥 이상한 이야기라고 생각했다.' },
  { type:'narration', text:'나는 아무것도 가져가지 않은 채 자리에서 일어났다.' },
  { type:'line', speaker:EP2_PLAYER, text:'잘 계세요, 할아버지.' },
  { type:'narration', text:'대답은 돌아오지 않았다.' },
  { type:'narration', text:'나는 그대로 저택을 빠져나왔다.', stopBgm:true },
];

const EP2_S2_BOX_INTRO = [
  { type:'narration', text:'나는 책상 위의 작은 상자를 집어 들었다.' },
  { type:'narration', text:'손바닥만 한 크기였다.' },
  { type:'narration', text:'겉보기에는 평범했지만, 자세히 보니 한쪽에 글귀가 적혀 있었고, 무언가를 입력할 수 있는 작은 장치가 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'비밀문자같은 건가?' },
  { type:'thought', text:'편지에는 비밀문자에 대한 힌트가 없었다.' },
];

const EP2_S2_BOX_HOME = [
  { type:'narration', text:'나는 상자를 집으로 가져왔다.', showBg:'player_home' },
  { type:'narration', text:'책상 위에 올려놓고 한참 동안 바라봤지만, 아무리 생각해도 답이 떠오르지 않았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'대체 뭘 입력하라는 거야?' },
  { type:'narration', text:'상자에 적힌 글귀를 다시 읽어봤다.' },
  { type:'narration', text:'「오스스 떨리어 왔다. 광활한 자연 @$#%@$#%.\n수도없이 바람이 일고 @#$%@$#%.\n그는 @#$%번째 !#$!@#를 좋아했다.」' },
  { type:'thought', text:'문제는 중간중간 적힌 문자가 도저히 알아볼 수 없다는 것이었다.' },
  { type:'thought', text:'고대 문자일까?' },
  { type:'thought', text:'아니면 마법사들이 사용하는 암호일까?' },
  { type:'narration', text:'나는 몇 시간 동안 여러 숫자와 단어를 입력해봤지만 전부 실패했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……진짜 모르겠네.' },
];

const EP2_S2_BOX_SUCCESS = [
  { type:'narration', text:'삑.', stopBgm:true },
  { type:'narration', text:'잠시 아무런 반응이 없었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'역시 틀렸나…….' },
  { type:'narration', text:'그 순간.' },
  { type:'narration', text:'「신은 네 부름에 응답했다.」', glitch:true },
  { type:'narration', text:'상자 안쪽에서 목소리가 울려 퍼졌다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……뭐?' },
  { type:'narration', text:'철컥.' },
  { type:'narration', text:'상자의 잠금장치가 스스로 풀렸다.' },
  { type:'narration', text:'나는 조심스럽게 뚜껑을 열었다.' },
  { type:'narration', text:'그 안에는 이상한 물건 하나가 들어 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이건…….' },
  { type:'itemReveal', item:EP2_IMG_MAGIC_WAND },
  { type:'narration', text:'얼핏 보면 바리깡처럼 생겼다.' },
  { type:'narration', text:'하지만 손잡이를 잡는 순간, 손끝에서 미세한 진동이 느껴졌다.' },
  { type:'thought', text:'평범한 물건이 아니었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'마법봉……?' },
  { type:'narration', text:'나는 그것을 조심스럽게 들어 올렸다.' },
  { type:'narration', text:'그리고 그 순간.' },
  { type:'narration', text:'마법봉 끝에서 아주 작은 빛이 번쩍였다.', shockReveal:true },
  { type:'itemHide' },
];

const EP2_S2_BOX_FAIL = [
  { type:'narration', text:'삑.', stopBgm:true },
  { type:'narration', text:'……' },
  { type:'narration', text:'아무런 반응이 없었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'틀렸나?' },
  { type:'narration', text:'나는 다시 입력해봤다.' },
  { type:'narration', text:'삑.' },
  { type:'narration', text:'여전히 아무 일도 일어나지 않았다.' },
  { type:'narration', text:'그런데 갑자기 상자에서 빛이 빠져나가기 시작했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……어?' },
  { type:'narration', text:'희미하게 빛나던 문양이 하나둘 꺼졌다.' },
  { type:'narration', text:'마지막 빛마저 사라지자 상자는 완전히 평범한 금속 상자로 변해버렸다.' },
  { type:'line', speaker:EP2_PLAYER, text:'잠깐…….' },
  { type:'narration', text:'뚜껑을 열려고 했지만 움직이지 않았다.' },
  { type:'narration', text:'몇 번을 시도해도 소용없었다.' },
  { type:'thought', text:'마치 처음부터 열 수 없는 상자였던 것처럼.' },
  { type:'narration', text:'나는 결국 상자를 내려놓았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……이제 영원히 못 여는 건가?' },
  { type:'narration', text:'대답은 없었다.' },
  { type:'narration', text:'상자는 그저 조용히 책상 위에 놓여 있었다.' },
];

/* =========================================================
   S#2 - S#1 선택③ 경로(재혁을 질타함) - ep1의 "TRUE ENDING CG · 송주헌"(true_juheon)을 이미
   봤는지에 따라 완전히 갈라진다. ep1의 CG_GALLERY_ITEMS 배열에서 정확히 10번째 항목이 true_juheon이라
   "epi1 ending10"을 그 순번으로 해석했다(다른 채점표가 없어 가장 근거 있는 추정).
   ========================================================= */
function hasSeenEp1Ending10(){
  return unlockedCgSet.has('true_juheon');
}

const EP2_S2_SEEN10_INTRO = [
  { type:'narration', text:'저택을 나온 뒤에도 기분이 영 찜찜했다.', showBg:'player_home', stopBgm:true },
  { type:'thought', text:'마법사라니, 귀환의 돌이라니…….' },
  { type:'thought', text:'아무리 생각해도 말이 안 되는 이야기였다.' },
  { type:'line', speaker:EP2_PLAYER, text:'됐어. 그냥 잊자.' },
  { type:'narration', text:'나는 휴대폰을 꺼내 카톡을 켰다.', bgm:'Midnight Trip' },
  { type:'thought', text:'이런 황당한 이야기를 계속 생각하고 있어 봐야 머리만 아플 뿐이었다.' },
  { type:'thought', text:'오랜만에 친구들과 이야기를 하다 보면 기분도 좀 나아질 것 같았다.' },
  { type:'narration', text:'연락처를 한참 내려보다가 익숙한 이름들이 눈에 들어왔다.' },
];

const EP2_S2_SEEN10_CHOICE = {
  prompt: '누구에게 연락할까?',
  options: [
    { label:'① 송주헌에게 연락한다.', key:'juheon' },
    { label:'② 이영웅에게 연락한다.', key:'yeongwoong' },
    { label:'③ 강승유에게 연락한다.', key:'seungyu' },
    { label:'④ 강 희에게 연락한다.', key:'ganghee' },
  ],
};

const EP2_S2_CONTACT_JUHEON = [
  { type:'narration', text:'나는 휴대폰을 들어 주헌에게 메시지를 보냈다.', openChat:'juheon' },
  { type:'chat', from:'player', text:'주헌아, 뭐 하냐?' },
  { type:'chat', from:JUHEON2, text:'오랜만에 연락했네.' },
  { type:'chat', from:'player', text:'그냥. 뭐하고 지내나 해서.' },
  { type:'chat', from:JUHEON2, text:'바쁘게 지내고 있지. 요즘 CEO가 된 뒤로 쉴 시간이 없어.' },
  { type:'chat', from:'player', text:'그러냐.. 조만간 한번 만나자' },
  { type:'chat', from:JUHEON2, text:'그래.' },
  { type:'chat', from:JUHEON2, text:'혹시 힘들면 계속 연락해.', closeChat:true },
  { type:'thought', text:'나는 그 메시지를 한참 바라봤다.', stopBgm:true },
];

const EP2_S2_CONTACT_YEONGWOONG = [
  { type:'narration', text:'나는 휴대폰을 들어 영웅에게 메시지를 보냈다.', openChat:'yeongwoong' },
  { type:'chat', from:'player', text:'영웅이형, 뭐 해요?' },
  { type:'chat', from:YEONGWOONG2, text:'야 진짜 오랜만이네 ㅋㅋ.' },
  { type:'chat', from:'player', text:'요즘도 바빠요?' },
  { type:'chat', from:YEONGWOONG2, text:'야. 형 이래 보여도 병원장이야 ㅋㅋ 진짜 연락할 시간도 없어 ㅋㅋ.' },
  { type:'chat', from:'player', text:'그러면 한번 만나기는 힘들겠네요 ㅠㅠ.' },
  { type:'chat', from:YEONGWOONG2, text:'ㅋㅋ 뭔데 그래?' },
  { type:'chat', from:YEONGWOONG2, text:'혹시 엄청 힘든 일 있으면 형 불러라 ㅋㅋ. 함 보자 ㅋㅋ', closeChat:true },
  { type:'thought', text:'나는 그 메시지를 한참 바라봤다.', stopBgm:true },
];

const EP2_S2_CONTACT_SEUNGYU = [
  { type:'narration', text:'나는 휴대폰을 들어 승유에게 메시지를 보냈다.', openChat:'seungyu' },
  { type:'chat', from:'player', text:'승유 하이?' },
  { type:'chat', from:SEUNGYU2, text:'야 진짜 오랜만이다 ㅋㅋ. 잘 지내냐?' },
  { type:'chat', from:'player', text:'잘 지내지 ㅋㅋ. 넌 어떰?' },
  { type:'chat', from:SEUNGYU2, text:'복싱 챔피언 되고 나서 광고 들어오고 난리도 아니다 ㅋㅋ 나 성공했다?ㅋㅋ' },
  { type:'chat', from:'player', text:'와 대박 ㅋㅋ 조만간 볼까?' },
  { type:'chat', from:SEUNGYU2, text:'ㅋㅋ 언제? 시간 한번 내볼게 ㅋㅋ' },
  { type:'chat', from:SEUNGYU2, text:'그래도 오랜만에 대화하니까 좋다 ㅋㅋ', closeChat:true },
  { type:'thought', text:'나는 그 메시지를 한참 바라봤다.', stopBgm:true },
];

const EP2_S2_CONTACT_GANGHEE = [
  { type:'narration', text:'나는 휴대폰을 들어 희에게 메시지를 보냈다.', openChat:'ganghee' },
  { type:'chat', from:'player', text:'희하~' },
  { type:'chat', from:GANGHEE2_ADULT, text:'오랜만이야. 연락 먼저해줬네 잘지내? 난 좋아. 요즘 괜찮은 거 같아. 연락 기다리고 있었는데 고맙네. 언제 볼까?' },
  { type:'chat', from:'player', text:'어.. 잘 지내. 조만간 한번 볼까? 일은 어때?' },
  { type:'chat', from:GANGHEE2_ADULT, text:'나 왜 이렇게 많이 갈구는 지 모르겠어 일 하는거 힘들다 ㅠ. 하고 싶은 일이라서 계속 좋을 줄만 알았는데. 아니더라고 ㅠ' },
  { type:'chat', from:GANGHEE2_ADULT, text:'내가 또 손은 좋잖아. 어제도 좀 어려운 거 있었는데 결국 잘 끝냈어 ㅇㅇ' },
  { type:'chat', from:GANGHEE2_ADULT, text:'나 아니었으면 좀 오래 걸렸을 수도 있어' },
  { type:'chat', from:GANGHEE2_ADULT, text:'물론 교수님은 그런 거 말 안 해주고 또 갈구더라' },
  { type:'chat', from:GANGHEE2_ADULT, text:'그래도 뭐 어떡해 내가 잘해야지 ㅇㅇ' },
  { type:'chat', from:'player', text:'어.', closeChat:true },
  { type:'thought', text:'나는 그 메시지를 한참 바라봤다.', stopBgm:true },
];

/* =========================================================
   위기(CRISIS) 루트 - 며칠 뒤 세상이 멈춘다 (S#2의 ②③길 - 늦잠/조사/편지사건/카톡 4인 연락 - 이 전부
   여기로 합류). 아래 EP2_CRISIS_ 접두사 상수/함수들이 전부 이 루트에 속한다. 원문 기준 raw S#3 챕터에서
   시작해 s#4, s#5 챕터의 전투까지 이어진다 - 아래 대광장(EP2_PLAZA_, EP2_CAFE_ 접두사, 귀환의 돌로
   200년 전으로 가는 별도 타임라인)과는 절대 서로 합류하지 않는 완전히 다른 갈래다.
   ========================================================= */
const CIRCLED_NUMS = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨'];

const EP2_CRISIS_CONVERGENCE_INTRO = [
  { type:'narration', text:'그 일이 있고 며칠이 지났다.', showBg:'player_home' },
  { type:'narration', text:'그리고 어느 날 저녁.' },
  { type:'narration', text:'18시 40분.' },
  { type:'narration', text:'갑자기 세상이 멈췄다.', glitch:true },
  { type:'line', speaker:EP2_PLAYER, text:'……뭐야?' },
  { type:'narration', text:'집 안의 불이 꺼졌다.' },
  { type:'narration', text:'휴대폰도, 컴퓨터도, TV도.' },
  { type:'narration', text:'모든 전자기기가 동시에 작동을 멈췄다.' },
  { type:'narration', text:'그런데 잠시 후.' },
  { type:'narration', text:'꺼져 있던 모든 화면에 동시에 하나의 영상이 나타났다.', chars:{center:'hyunjae'}, tvStatic:'center', bgm:'16. Crucial Issue' },
  { type:'narration', text:'화면에는 정체를 알 수 없는 남자가 서 있었다. 그는 앞이 밝은지 실눈을 뜨고 있었다.' },
  { type:'narration', text:'검은 옷을 입은 남자는 아무런 표정 없이 카메라를 바라보고 있었다.' },
  { type:'narration', text:'그리고 말했다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'이 세계는 이미 가망이 없다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'수많은 기회를 주었지만, 인간은 아무것도 바꾸지 않았다.' },
  { type:'narration', text:'잠시 침묵.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'그러므로 내가 직접 끝내겠다.' },
  { type:'narration', text:'화면이 꺼졌다.', clearBg:true, tvStatic:null, chars:{center:null} },
  { type:'narration', text:'나는 화면을 바라보다 자리에서 벌떡 일어났다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……최재혁 할아버지.' },
  { type:'thought', text:'분명 그 사람이 무언가 알고 있을 것이다.' },
  { type:'narration', text:'나는 곧장 집을 뛰쳐나와 최재혁의 대저택으로 향했다.' },
  { type:'narration', text:'숨이 턱 끝까지 차오를 때까지 달렸다.' },
  { type:'narration', text:'하지만 도착한 순간.', stopBgm:true },
  { type:'narration', text:'나는 걸음을 멈췄다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……어?', showBg:'empty_plain' },
  { type:'narration', text:'대저택이 있어야 할 자리가 텅 비어 있었다.' },
  { type:'narration', text:'건물은 흔적조차 없었다.' },
  { type:'narration', text:'그리고 그곳에 한 남자가 서 있었다.', chars:{center:'hyunjae'}, shockReveal:true, bgm:'2-08. Agnus Dei' },
  { type:'narration', text:'검은 옷.' },
  { type:'narration', text:'무표정한 얼굴.' },
  { type:'narration', text:'조금 전 모든 화면에서 봤던 바로 그 남자였다.' },
  { type:'narration', text:'그가 천천히 나를 바라봤다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'드디어 왔군.' },
  { type:'narration', text:'나는 본능적으로 뒷걸음질쳤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……당신 누구야?' },
  { type:'narration', text:'남자는 대답 대신 희미하게 웃었다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'마지막 남은 반역자인가.' },
];

function playEp2CrisisEndResister(){
  if(isEp2CollectorEndingReady()){
    playQueue(EP2_CRISIS_END_RESISTER_DIRECT.concat(EP2_CRISIS_END_COLLECTOR_TAIL), ()=> showEp2Ending('COLLECTOR END', EP2_ENDING_CATEGORY_BY_TITLE['COLLECTOR END']));
    return;
  }
  playQueue(EP2_CRISIS_END_RESISTER_DIRECT.concat(EP2_CRISIS_END_RESISTER_TAIL), ()=> showEp2Ending('비운의 저항자 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['비운의 저항자 앤딩']));
}

// 실제 도달한 상태(펜던트/마법봉 보유 여부, S#2에서 연락한 친구)에 따라 선택지 개수가 달라지고,
// 번호도 자동으로 당겨진다(원본 지문 "다른 선택지가 앞으로 한 칸씩 당겨짐(번호도)"을 그대로 구현).
// "친구를 부른다" 선택지는 S#2에서 실제로 연락한 그 한 명(ep2ContactedFriend)만 노출된다(요청받아
// 수정 - 이전엔 엔딩10만 봤으면 연락 여부와 무관하게 4명이 전부 노출됐다). 연락도 안 하고 펜던트도
// 마법봉도 없어서 정말 아무 선택지도 만들 수 없을 때는 선택지 자체를 띄우지 않고 곧장 1번(저항)으로
// 진행한다.
function showEp2CrisisConvergenceChoice(){
  if(!ep2ContactedFriend && !ep2HasPendant && !ep2HasWand){
    playEp2CrisisEndResister();
    return;
  }
  const raw = [{ text:'일단 상황을 지켜보다가 혼자 검은 옷을 입은 남자에게 저항한다.', key:'resist' }];
  if(ep2HasPendant) raw.push({ text:'펜던트를 깨뜨린다.', key:'pendant' });
  if(ep2HasWand) raw.push({ text:'마법봉을 겨눈다.', key:'wand' });
  const FRIEND_CALL_TEXT = {
    juheon:'송주헌을 부른다.',
    yeongwoong:'이영웅을 부른다.',
    seungyu:'강승유를 부른다.',
    ganghee:'강 희를 부른다.',
  };
  if(ep2ContactedFriend && FRIEND_CALL_TEXT[ep2ContactedFriend]){
    raw.push({ text:FRIEND_CALL_TEXT[ep2ContactedFriend], key:ep2ContactedFriend });
  }
  const options = raw.map((o, i)=> ({ label:`${CIRCLED_NUMS[i]} ${o.text}`, key:o.key }));
  // 원문(독서 RPG 스토리모드 episode 2 S#1.txt)의 챕터 헤더를 소문자까지 포함해 다시 대조해보면(총
  // 6개: S#1/S#2/S#3/s#4/s#5/s#6) 펜던트(재혁 소환, 1437줄)·마법봉(협력 히든 앤딩, 1465~1515줄)·
  // 4명 소환의 "도착" 장면(송주헌 1547/이영웅 1583/강승유 1627/강희 1664~1740줄)까지는 전부 S#3
  // (958~1744줄) 범위 안에 있다. 그런데 강 희 루트만 그 자리에서 완결되고(1740줄에서 엔딩), 나머지
  // 넷(재혁/송주헌/이영웅/강승유)의 "실제 전투"는 그다음 챕터인 s#4(1745줄~)에서 시작한다(대조 확인:
  // 재혁전 2252줄, 송주헌전 2419줄, 이영웅전 2584줄, 강승유전 2746줄 - 넷 다 "김현재-죽이기 전에
  // 하나 묻지."로 시작하는 동일한 리드인). 대광장 루트는 이 S#3→s#4 경계(건물 선택→카페 진입)에
  // gateNextScene 티켓 게이트가 있는데 위기 루트는 없어서 두 루트의 티켓 소모량이 어긋나 있었다
  // (신고받아 수정 - S#2/S#3 구분이 애매해 보인다던 원인). 강 희/마법봉/저항 3갈래는 S#3 안에서
  // 완결되므로 그대로 게이트 없이 둔다.
  showChoiceGeneric({ prompt:'어떻게 할까?', options }, (opt)=>{
    if(opt.key === 'resist'){
      playEp2CrisisEndResister();
    } else if(opt.key === 'pendant'){
      playQueue(EP2_CRISIS_PENDANT_SUMMON.slice(), ()=> gateNextScene('ep2_scene4_jaehyuk', playEp2CrisisBattleJaehyuk, getEp2State()));
    } else if(opt.key === 'wand'){
      playQueue(EP2_CRISIS_END_COLLAB.slice(), ()=> showEp2Ending('악당과의 협력 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['악당과의 협력 앤딩']));
    } else if(opt.key === 'juheon'){
      playQueue(EP2_CRISIS_FRIEND_JUHEON.slice(), ()=> gateNextScene('ep2_scene4_juheon', playEp2CrisisBattleJuheon, getEp2State()));
    } else if(opt.key === 'yeongwoong'){
      playQueue(EP2_CRISIS_FRIEND_YEONGWOONG.slice(), ()=> gateNextScene('ep2_scene4_yeongwoong', playEp2CrisisBattleYeongwoong, getEp2State()));
    } else if(opt.key === 'seungyu'){
      playQueue(EP2_CRISIS_FRIEND_SEUNGYU.slice(), ()=> gateNextScene('ep2_scene4_seungyu', playEp2CrisisBattleSeungyu, getEp2State()));
    } else if(opt.key === 'ganghee'){
      playQueue(EP2_CRISIS_END_GANGHEE.slice(), ()=> showEp2Ending('강 희 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['강 희 앤딩']));
    }
  });
}

/* ---- ① 저항 -> 비운의 저항자 앤딩(ep2_end2, BAD END) ----
   원문에서 이 엔딩은 도달 경로가 4갈래(직접 저항 / 재혁 소환 전투에서 무피해로 패배 / 영웅 회복
   반복 시도 중 패배 / 승유 방어 준비 중 패배)인데, "기억을 지우고 눈을 뜬다" 이후의 결말 텍스트는
   네 경로 전부 토씨 하나 다르지 않고 완전히 동일하다(원문 대조 확인됨, 사소한 오타 차이도 없었음) -
   경로마다 이 긴 공용 결말을 그대로 베껴 쓰지 않도록 여기서 한 번만 정의해 모든 경로가 공유한다.
   지금은 직접 저항(EP2_CRISIS_END_RESISTER_DIRECT) 경로만 구현돼 있고, 나머지 세 전투 경로는
   해당 전투의 2라운드 선택지 구현 시 자기만의 짧은 도입부 뒤에 이 TAIL을 이어붙이면 된다. */
const EP2_CRISIS_END_RESISTER_TAIL = [
  { type:'narration', text:'나는 눈을 떴다.', showBg:'player_home', whiteout:false, chars:{left:null, center:null, right:null} },
  { type:'narration', text:'익숙한 방이었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'내가…… 언제 잠들었지?', bgm:'2-12. Moment' },
  { type:'thought', text:'무슨 꿈을 꾼 것 같았지만 기억나지 않았다.' },
  { type:'narration', text:'나는 평소처럼 하루를 시작했다.' },
  { type:'narration', text:'출근하고, 사람들과 이야기하고, 집으로 돌아왔다.' },
  { type:'narration', text:'그런데 저녁 뉴스를 보던 순간이었다.', showBg:'end2' },
  { type:'narration', text:'[심화되는 세대 갈등, 해결책은?]' },
  { type:'narration', text:'[저출산과 고령화 문제, 더욱 심각해져]' },
  { type:'narration', text:'[갈수록 깊어지는 젠더·지역 간 갈등]' },
  { type:'narration', text:'나는 화면을 바라보다가 무심코 미간을 찌푸렸다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……또 이런 이야기네.' },
  { type:'thought', text:'왜인지 모르겠다.' },
  { type:'thought', text:'이런 뉴스를 볼 때마다 이상하게 마음 한구석이 불편했다.' },
  { type:'thought', text:'마치 내가 이미 이 문제에 대해 아주 오래전부터 고민해왔던 것처럼.' },
  { type:'thought', text:'하지만 그 이유는 떠오르지 않았다.' },
  { type:'narration', text:'나는 결국 TV를 껐다.' },
  { type:'narration', text:'그리고 아무것도 모른 채 평범한 일상으로 돌아갔다.' },
];
const EP2_CRISIS_END_RESISTER_DIRECT = [
  { type:'narration', text:'나는 아무 말도 하지 않고 남자를 바라봤다.' },
  { type:'thought', text:'상황을 더 지켜봐야 했다.' },
  { type:'narration', text:'하지만 남자는 내 침묵을 다른 의미로 받아들인 듯했다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'지금 보니까 마법사도 아니네.' },
  { type:'narration', text:'그의 입가에 희미한 미소가 번졌다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'한낱 인간 주제에 무엇을 할 수 있지?' },
  { type:'line', speaker:EP2_PLAYER, text:'그건…… 해봐야 아는 거 아닌가?' },
  { type:'narration', text:'나는 주위를 둘러봤다.' },
  { type:'narration', text:'그리고 그대로 그에게 달려들었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……!' },
  { type:'narration', text:'남자는 가볍게 몸을 피했다.' },
  { type:'narration', text:'몇 번이나 달려들었지만 손끝 하나 건드릴 수 없었다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'쓸데없는 저항이군.' },
  { type:'line', speaker:EP2_PLAYER, text:'닥쳐!', emphasis:true },
  { type:'narration', text:'나는 다시 주먹을 휘둘렀다.' },
  { type:'narration', text:'그 순간 남자의 손끝에서 희미한 빛이 번졌다.', glitch:true },
  { type:'line', speaker:HYUNJAE_VEILED, text:'그렇다면 네게서 이 일을 기억할 필요도 없겠지.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭐……?' },
  { type:'thought', text:'순간 머리가 새하얘졌다.', whiteout:true, stopBgm:true, se:'SE_Vanish_01'  },
  { type:'thought', text:'무언가가 머릿속을 휘젓는 듯한 감각.' },
  { type:'narration', text:'그리고 마지막으로 남자의 목소리가 들렸다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'잊어라.'},
];

/* ---- COLLECTOR END(ep2_end20/21, 원문 4829~4899줄) ----
   조건: 히든 엔딩(ep2_end22)과 컬렉터 엔딩 자신을 제외한 21개 CG를 전부 모은 상태로 이 저항(①) 선택에
   도달. 그 지점까지의 대사는 원문에서도 비운의 저항자 앤딩과 토씨 하나 다르지 않은 완전 동일 텍스트라
   EP2_CRISIS_END_RESISTER_DIRECT를 그대로 재사용하고, 마지막 줄 "잊어라."의 whiteout:true를 기억 소거의
   암전이 아니라 차원문이 열리는 빛으로 재활용해 이 TAIL로 이어붙인다(원문 그대로 "……" 직후 "그 순간.
   콰아앙!"으로 급전환). CG20/21은 실제 원화가 있는 두 장뿐이라(다른 엔딩들과 달리) 원문의
   [[하얀색으로 물들이기]]/[[CG 재생]] 지문을 그대로 살려 mid-scene 배경 전환으로 노출한다. */
const EP2_CRISIS_END_COLLECTOR_TAIL = [
  { type:'narration', text:'그 순간.', whiteout:false, chars:{center:null}, stopBgm:true },
  { type:'narration', text:'콰아앙!', impact:true },
  { type:'narration', text:'공간 한가운데가 갈라졌다.' },
  { type:'narration', text:'검은 틈 사이로 눈부신 빛이 쏟아졌다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'뭐야……?' },
  { type:'narration', text:'김현재가 처음으로 당황한 표정을 지었다.' },
  { type:'narration', text:'차원문 너머에서 익숙한 목소리가 들렸다.' },
  { type:'line', speaker:JAEHYUK, text:'모두들…… 집합!', emphasis:true },
  { type:'line', speaker:EP2_PLAYER, text:'……최재혁?' },
  { type:'narration', text:'차원문이 완전히 열렸다.', whiteout:true, se:'SE_Portal_01' },
  { type:'narration', text:'가장 먼저 임소정이 걸어 나왔다.', showBg:'end20', noBgFade:true, whiteout:false, bgm:'Track_327' },
  { type:'narration', text:'그 뒤로 이종복, 송주헌, 강 희, 강승유, 이영웅이 차례로 모습을 드러냈다.' },
  { type:'line', speaker:JAEHYUK, text:'늦어서 미안하다.' },
  { type:'line', speaker:JAEHYUK, text:'하지만 이번에는 혼자 싸우게 두지 않겠어.', emphasis:true },
  { type:'narration', text:'남자의 표정이 굳었다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'……어떻게 이곳까지.' },
  { type:'narration', text:'이종복이 마법진을 펼쳤다.' },
  { type:'line', speaker:JONGBOK2, text:'네놈이 세상을 끝내겠다면.' },
  { type:'line', speaker:SOJUNG2, text:'우리 모두가 네 앞을 가로막겠다.' },
  { type:'narration', text:'주헌이 주먹을 쥐었다.' },
  { type:'line', speaker:JUHEON2, text:'이번엔 숫자로 밀어붙이는 거야?' },
  { type:'line', speaker:SEUNGYU2, text:'좋네. 나 이런 거 좋아해.' },
  { type:'narration', text:'강 희도 한 걸음 앞으로 나섰다.' },
  { type:'line', speaker:GANGHEE2_ADULT, text:'__PLAYER_NAME__, 뒤로 빠져!' },
  { type:'narration', text:'이영웅은 조용히 김현재를 바라봤다.' },
  { type:'line', speaker:YEONGWOONG2, text:'끝내자.' },
  { type:'narration', text:'나는 믿기지 않는 표정으로 그들을 바라봤다.', showBg:'end21', noBgFade:true },
  { type:'narration', text:'혼자서는 아무것도 할 수 없다고 생각했다.' },
  { type:'narration', text:'하지만 지금은 달랐다.' },
  { type:'narration', text:'김현재가 천천히 손을 들어 올렸다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'……어리석은 것들.' },
  { type:'narration', text:'최재혁이 오른손을 들어 올렸다.' },
  { type:'line', speaker:JAEHYUK, text:'어리석어도 상관없다.' },
  { type:'narration', text:'수많은 마법진이 하늘을 뒤덮었다.' },
  { type:'line', speaker:JAEHYUK, text:'우리는 함께 선택했으니까.', emphasis:true },
  { type:'narration', text:'그리고 모두가 동시에 김현재를 향해 달려들었다.' },
  { type:'narration', text:'이것은 한 사람의 저항이 아니었다.' },
  { type:'narration', text:'모두가 함께 선택한 마지막 저항이었다.' },
];

/* ---- ② 펜던트 -> 최재혁 소환, 대치(전투 직전 컷) ---- */
const EP2_CRISIS_PENDANT_SUMMON = [
  { type:'narration', text:'나는 본능적으로 주머니를 뒤졌다.' },
  { type:'narration', text:'손끝에 익숙한 펜던트가 잡혔다.' },
  { type:'itemReveal', item:EP2_IMG_PENDANT },
  { type:'thought', text:'최재혁 할아버지가 남긴 마지막 수단.' },
  { type:'line', speaker:EP2_PLAYER, text:'……이게 정말 될까?' },
  { type:'narration', text:'나는 망설이지 않고 펜던트를 힘껏 깨뜨렸다.' },
  { type:'itemHide' },
  { type:'narration', text:'쩌적!', impact:true, whiteout:true, se:'SE_Clink_01' },
  // 이 시점에 center에는 이미 김현재(hyunjae)가 있다(EP2_CRISIS_CONVERGENCE_INTRO에서부터 계속) -
  // 인물이 둘일 때는 기본적으로 left+right에 대칭 배치되어야 하므로(신고받아 수정), 재혁이 left에
  // 나타나면서 김현재가 여유롭게 right로 밀려나는 연출(tryPlayCenterSlideToSideTransition 참고)이
  // 트리거되도록 chars:{left, right}를 함께 지정한다(예전엔 재혁을 left에 등장시켰지만 이 트랜지션
  // 자체가 없어서 김현재가 안 밀려나는 버그가 있었고, 그다음엔 center+right로 고쳤다가 다시 이
  // 원칙에 맞춰 left+right로 확정했다).
  { type:'line', speaker:EP2_PLAYER, text:'뭐야……!', whiteout:false, chars:{left:'jaehyuk', right:'hyunjae'}, mysterySilhouette:'left' },
  { type:'narration', text:'빛이 한곳으로 모이더니 사람의 형상을 만들어냈다.', revealCharacter:'left' },
  { type:'line', speaker:JAEHYUK, text:'……이런 날이 벌써 도래하다니.' },
  { type:'narration', text:'재혁은 주변을 둘러보다가 검은 옷의 남자를 발견했다.' },
  { type:'narration', text:'그의 표정이 순식간에 굳었다.' },
  { type:'line', speaker:JAEHYUK, text:'김현재…….' },
  { type:'narration', text:'검은 옷의 남자도 재혁을 바라봤다.' },
  { type:'line', speaker:HYUNJAE, text:'최재혁.' },
  { type:'line', speaker:JAEHYUK, text:'네놈이 감히……!' },
  { type:'narration', text:'재혁의 오른손에서 무언가 보이지 않는 힘이 느껴진다.' },
  { type:'narration', text:'김현재 역시 손을 들어 올렸다.' },
  { type:'line', speaker:HYUNJAE, text:'결국 네가 그 펜던트를 남겼군.' },
  { type:'line', speaker:JAEHYUK, text:'이날을 위해서였다.' },
  { type:'narration', text:'두 사람 사이에서 강렬한 마력이 충돌하기 시작했다.' },
  { type:'narration', text:'쿠구구구…….', rumble:true },
  { type:'narration', text:'주변의 공기가 흔들리고 땅이 미세하게 진동했다.' },
  { type:'narration', text:'나는 두 사람 사이에 서서 아무것도 하지 못한 채 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'잠깐만요……!' },
  { type:'narration', text:'하지만 누구도 내 말을 듣지 않았다.' },
  { type:'narration', text:'재혁이 이를 악물었다.' },
  { type:'line', speaker:JAEHYUK, text:'김현재. 네가 무슨 짓을 벌이려는지는 모르겠지만…….' },
  { type:'line', speaker:JAEHYUK, text:'이번에는 내가 막겠다.' },
  { type:'narration', text:'김현재 역시 천천히 손을 들어 올렸다.' },
  { type:'line', speaker:HYUNJAE, text:'그렇다면 막아봐라.' },
  { type:'narration', text:'두 사람의 시선이 맞부딪혔다.' },
  { type:'narration', text:'콰직!', cameraPunch:true },
  { type:'narration', text:'공간이 일그러졌다.' },
  { type:'thought', text:'전투가 시작되기 직전이었다.', stopBgm:true },
];

const EP2_CRISIS_BATTLE_JAEHYUK_INTRO = [
  { type:'narration', text:'콰아앙!', showBg:'empty_plain', noBgFade:true, impact:true },
  { type:'narration', text:'먼저 움직인 것은 최재혁이었다.', bgm:'2-09. CrossFire' },
  { type:'line', speaker:JAEHYUK, text:'받아라, 김현재!' },
  { type:'narration', text:'그가 오른손을 치켜들고 김현재를 향해 주먹을 날렸다.' },
  { type:'narration', text:'김현재가 손을 휘두르자 검은 장벽이 나타나 공격을 막아냈다.' },
  { type:'line', speaker:HYUNJAE, text:'역시 너답군, 재혁.' },
  { type:'line', speaker:JAEHYUK, text:'입 닥쳐!' },
  { type:'narration', text:'재혁은 다시 주먹을 쥐었다.' },
  { type:'narration', text:'김현재의 시선이 완전히 재혁에게 집중되었다.' },
  { type:'narration', text:'그 순간 재혁이 나를 바라봤다.' },
  { type:'line', speaker:JAEHYUK, text:'__PLAYER_NAME__!' },
  { type:'line', speaker:EP2_PLAYER, text:'네!' },
  { type:'line', speaker:JAEHYUK, text:'내가 녀석의 시선을 끌겠다.' },
  { type:'narration', text:'재혁이 품에서 무언가를 꺼냈다.' },
  { type:'narration', text:'철컥.' },
  { type:'narration', text:'하얀빛을 두른 장검이었다.', shockReveal:true },
  { type:'line', speaker:JAEHYUK, text:'이걸 받아.' },
  { type:'narration', text:'나는 검을 받아들었다.' },
  { type:'thought', text:'생각보다 묵직했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이걸로 뭘 하라는 거예요?' },
  { type:'line', speaker:JAEHYUK, text:'녀석의 방어가 무너지는 순간이 반드시 온다.' },
  { type:'narration', text:'재혁이 다시 김현재를 향해 몸을 돌렸다.' },
  { type:'line', speaker:JAEHYUK, text:'그때 망설이지 말고 공격해.' },
  { type:'line', speaker:EP2_PLAYER, text:'하지만…….' },
  { type:'line', speaker:JAEHYUK, text:'시간이 없다!' },
  { type:'narration', text:'김현재의 검은 장벽에 금이 가기 시작했다.' },
  { type:'narration', text:'재혁은 이를 악물었다.' },
  { type:'line', speaker:JAEHYUK, text:'내가 마지막까지 녀석의 시선을 붙잡겠다.' },
  { type:'narration', text:'재혁의 오른손에서 더 강한 힘이 느껴졌다.' },
  { type:'line', speaker:JAEHYUK, text:'그러니 네가 마지막 일격을 맡아라.' },
  { type:'narration', text:'나는 장검을 두 손으로 움켜쥐었다.' },
  { type:'narration', text:'눈앞에는 검은 옷의 남자가 있었다.' },
  { type:'narration', text:'그리고 최재혁의 목소리가 울렸다.' },
  { type:'line', speaker:JAEHYUK, text:'지금이다!', cameraPunch:true },
  { type:'narration', text:'김현재의 시선은 완전히 재혁에게 쏠려 있었다.' },
  { type:'narration', text:'나는 장검을 움켜쥐고 달려들었다.' },
];

const EP2_CRISIS_BATTLE_JAEHYUK_CHOICE = {
  prompt: '어디를 노릴까?',
  options: [
    { label:'① 적의 전방을 공격한다.', key:'front' },
    { label:'② 적의 후방을 공격한다.', key:'back' },
  ],
};

const EP2_CRISIS_BATTLE_JAEHYUK_FRONT = [
  { type:'narration', text:'나는 망설이지 않고 김현재의 정면을 향해 달려들었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'으아아아!', emphasis:true },
  { type:'narration', text:'장검을 힘껏 휘둘렀다.' },
  { type:'narration', text:'하지만 김현재가 갑자기 고개를 돌렸다.' },
  { type:'line', speaker:HYUNJAE, text:'……뻔한 수작이군.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭐……?' },
  { type:'narration', text:'김현재의 눈빛이 나를 정확히 향했다.' },
  { type:'narration', text:'콰앙!', explosion:true },
  { type:'narration', text:'검은 마법이 폭발하며 나를 집어삼켰다.' },
  { type:'line', speaker:EP2_PLAYER, text:'크아악!', hitFlash:'right' },
  { type:'narration', text:'나는 그대로 바닥을 굴렀다.' },
  { type:'narration', text:'몸 곳곳에서 통증이 느껴졌다.' },
  { type:'line', speaker:JAEHYUK, text:'__PLAYER_NAME__!' },
  { type:'narration', text:'최재혁이 다급하게 나를 불렀다.' },
  { type:'narration', text:'김현재는 차갑게 말했다.' },
  { type:'line', speaker:HYUNJAE, text:'내 시선을 끌었다고 해서 네가 보이지 않는 것은 아니야. 네 움직임은 너무 둔하고 약해빠졌어!' },
  { type:'thought', text:'나는 장검을 놓치지 않으려고 이를 악물었다.' },
];

const EP2_CRISIS_BATTLE_JAEHYUK_BACK = [
  { type:'narration', text:'나는 순간적으로 방향을 틀었다.' },
  { type:'narration', text:'김현재의 시선은 여전히 최재혁에게 고정되어 있었다.' },
  { type:'line', speaker:JAEHYUK, text:'……지금이다!' },
  { type:'narration', text:'나는 몸을 낮추고 그의 뒤쪽으로 빠르게 파고들었다.' },
  { type:'line', speaker:HYUNJAE, text:'뭐……?' },
  { type:'narration', text:'김현재가 뒤늦게 고개를 돌렸다.' },
  { type:'narration', text:'하지만 이미 늦었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'받아라!', emphasis:true },
  { type:'narration', text:'장검이 그의 등을 깊게 베었다.' },
  { type:'narration', text:'서걱!', impact:true, hitFlash:'right' },
  { type:'line', speaker:HYUNJAE, text:'크윽……!' },
  { type:'narration', text:'검은 피가 바닥으로 떨어졌다.' },
  { type:'narration', text:'김현재가 비틀거리며 한쪽 무릎을 꿇었다.', staggerCollapse:'right' },
  { type:'narration', text:'최재혁이 놀랐다.' },
  { type:'line', speaker:JAEHYUK, text:'!!!' },
  { type:'narration', text:'나는 거친 숨을 내쉬며 장검을 바라봤다.' },
  { type:'thought', text:'처음부터 이것이 재혁의 작전이었다.' },
  { type:'thought', text:'시선을 끌고, 빈틈을 만든다.' },
  { type:'thought', text:'그리고 그 틈을 내가 찌른다.' },
  { type:'narration', text:'김현재가 상처를 붙잡으며 천천히 나를 바라봤다.' },
  { type:'narration', text:'그 눈빛에는 처음으로 분노가 서려 있었다.' },
  { type:'line', speaker:HYUNJAE, text:'……제법이군.' },
];

/* ---- 2라운드: 최재혁의 무적기를 누구에게 쓸지(1라운드에서 데미지를 입혔는지에 따라 결과가 갈린다) ---- */
const EP2_CRISIS_BATTLE_JAEHYUK_ROUND2_INTRO = [
  { type:'narration', text:'그 뒤로도 여러 번의 공방이 있었다.', bgm:'2-09. CrossFire', showBg:'empty_plain' },
  { type:'narration', text:'현재는 잠시 눈을 감았다.' },
  { type:'narration', text:'그러자 그의 상처 주변으로 검은 마력이 모여들기 시작했다.' },
  // 1라운드 후방공격(BACK) 경로였다면 김현재가 staggerCollapse로 쓰러진 채 그대로였다 - 상처가
  // 회복되는 이 대사에서 다시 일어서는 스탠딩을 세운다(전방공격 경로였다면 원래도 서 있었으므로
  // 같은 인물 재지정은 아무 변화 없이 무시된다).
  { type:'narration', text:'상처가 서서히 봉합됐다.', chars:{right:'hyunjae'} },
  { type:'line', speaker:HYUNJAE, text:'아직 끝난 게 아니다.' },
  { type:'narration', text:'김현재가 다시 손을 들어 올렸다.' },
  // "콰아아앙!" 대사를 없애고 대신 대사 없는 폭발 이펙트와 함께 배경을 폐허(empty_ruins)로 바꾼다(요청됨).
  { type:'silentEffect', showBg:'empty_ruins', noBgFade:true, explosion:'large', holdMs:900 },
  { type:'narration', text:'검은 마법진이 하늘을 뒤덮었다.' },
  { type:'narration', text:'주변의 공기가 무겁게 짓눌렸다.' },
  { type:'line', speaker:JAEHYUK, text:'이건…….' },
  { type:'line', speaker:HYUNJAE, text:'필살기다.' },
  { type:'line', speaker:HYUNJAE, text:'이 세계의 모든 것을…… 끝내주마.' },
  { type:'narration', text:'거대한 검은 빛이 하늘에서 모이기 시작했다.' },
  { type:'narration', text:'나는 장검을 꽉 움켜쥐었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'재혁 할아버지! 어떻게 해야 해요?' },
  { type:'narration', text:'최재혁은 잠시 침묵하다가 나를 바라봤다.' },
  { type:'line', speaker:JAEHYUK, text:'한 가지 방법이 있다.' },
  { type:'narration', text:'재혁이 천천히 오른손을 들어 올렸다.' },
  { type:'line', speaker:JAEHYUK, text:'내 오른손에 닿은 마법은 사라진다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……사라진다고요?' },
  { type:'line', speaker:JAEHYUK, text:'그래. 막는 것도, 튕겨내는 것도 아니야.' },
  { type:'line', speaker:JAEHYUK, text:'닿는 순간 그 마법 자체가 없어지는 거다.' },
  { type:'narration', text:'재혁은 자신의 떨리는 오른손을 바라봤다.' },
  { type:'line', speaker:JAEHYUK, text:'문제는 내 몸이 예전 같지 않다는 거야.' },
  { type:'line', speaker:JAEHYUK, text:'저 정도 공격이 쏟아지면 한쪽을 지키는 것만으로도 한계다.' },
  { type:'line', speaker:JAEHYUK, text:'네 쪽으로 오는 마법을 지울지.' },
  { type:'line', speaker:JAEHYUK, text:'아니면 내 쪽으로 오는 마법을 지울지.' },
  { type:'narration', text:'나는 아무 말도 하지 못했다.' },
  { type:'narration', text:'최재혁은 희미하게 웃었다.' },
  { type:'line', speaker:JAEHYUK, text:'선택은 네게 달려 있다.' },
  { type:'narration', text:'하늘을 뒤덮은 검은 마법진이 더욱 커졌다.' },
  { type:'thought', text:'시간이 얼마 남지 않았다.' },
];
const EP2_CRISIS_BATTLE_JAEHYUK_ROUND2_CHOICE = {
  prompt: '무적기를 누구에게 사용할까?',
  options: [
    { label:'① 최재혁에게 무적기를 사용한다.', key:'jaehyuk' },
    { label:'② 나에게 무적기를 사용한다.', key:'self' },
  ],
};
/* ---- ①+1라운드 후방공격(데미지O) -> 재혁과 승리 앤딩(ep2_end4) ---- */
const EP2_CRISIS_BATTLE_JAEHYUK_PROTECT_JAEHYUK_WIN = [
  { type:'narration', text:'나는 망설이지 않고 말했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'재혁 할아버지에게 써주세요.' },
  { type:'narration', text:'최재혁이 눈을 크게 떴다.' },
  { type:'line', speaker:JAEHYUK, text:'……정말 괜찮겠어?' },
  { type:'line', speaker:EP2_PLAYER, text:'네. 방법을 생각해냈어요.' },
  { type:'narration', text:'나는 이미 상처를 입은 김현재를 바라봤다.' },
  { type:'narration', text:'그의 움직임은 이전보다 확실히 느려져 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'할아버지가 무적 상태가 된다면…… 제가 할아버지 뒤에 있으면 돼요.' },
  { type:'line', speaker:JAEHYUK, text:'내 뒤에?' },
  { type:'line', speaker:EP2_PLAYER, text:'네. 김현재의 공격을 할아버지가 전부 막아주세요. 그러면 저도 피해를 입지 않을 거예요.' },
  { type:'narration', text:'최재혁은 잠시 생각하더니 피식 웃었다.' },
  { type:'line', speaker:JAEHYUK, text:'제법 대담한 생각이군.' },
  { type:'line', speaker:JAEHYUK, text:'좋다. 해보자.' },
  { type:'narration', text:'순간 보이지 않는 빛이 폭발했다.' },
  { type:'narration', text:'최재혁의 오른손으로 빛이 스며들었다.' },
  { type:'narration', text:'김현재가 거대한 검은 마법을 쏟아냈다.' },
  { type:'narration', text:'콰아아아앙!', explosion:'large' },
  { type:'narration', text:'하지만 모든 공격은 최재혁의 오른손에 막혔다.' },
  { type:'narration', text:'나는 재빨리 그의 뒤로 몸을 숨겼다.' },
  { type:'line', speaker:EP2_PLAYER, text:'지금이에요!' },
  { type:'line', speaker:JAEHYUK, text:'김현재!' },
  { type:'narration', text:'재혁이 주먹을 쥐었다.' },
  { type:'line', speaker:JAEHYUK, text:'이것으로 끝내겠다!' },
  { type:'narration', text:'김현재가 마지막으로 마법을 쏘아냈다.' },
  { type:'narration', text:'하지만 최재혁의 몸은 흔들리지 않았다.' },
  { type:'narration', text:'그리고 바로 그 순간.' },
  { type:'line', speaker:JAEHYUK, text:'받아라!', emphasis:true },
  // 재혁 쌍욕 앤딩(ep2_end1, EP2_S1_BAD_END)과 동일한 기법 - 화면 흔들림(impact)과 함께 CG가 노페이드로
  // 즉시 나타나고, 그 위로 스탠딩이 가려지지 않도록 둘 다 지운다(요청됨).
  { type:'narration', text:'콰아아아앙!', showBg:'end4', noBgFade:true, impact:true, chars:{left:null, right:null} },
  { type:'narration', text:'최재혁의 주먹이 김현재를 꿰뚫는다.' },
  { type:'line', speaker:HYUNJAE, text:'……재혁…….' },
  { type:'narration', text:'김현재의 몸에서 검은 마력이 빠져나갔다.' },
  // 스탠딩은 이미 위 CG(end4)로 가려진 상태라 staggerCollapse를 또 재생할 필요가 없다(가려진 채로
  // 대사창만 950ms 동안 의미 없이 숨겨지는 것을 방지).
  { type:'narration', text:'그는 마지막으로 우리를 바라보더니 천천히 무너졌다.' },
  { type:'narration', text:'정적이 찾아왔다.', stopBgm:true },
  { type:'narration', text:'나는 믿기지 않는 표정으로 쓰러진 김현재를 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'끝난…… 건가요?' },
  { type:'line', speaker:JAEHYUK, text:'그래.' },
  { type:'line', speaker:JAEHYUK, text:'끝났다.' },
  // CG를 거두고 다시 배경(전투 씬)으로 돌아온다 - 재혁은 계속 대사가 있으므로 다시 세우고, 쓰러진
  // 김현재는 그대로 화면에 없는 채로 둔다(요청됨).
  { type:'narration', text:'김현재가 쓰러진 뒤, 세상은 거짓말처럼 조용해졌다.', showBg:'empty_plain', noBgFade:true, chars:{left:'jaehyuk'}, bgm:'10. someday, sometime' },
  { type:'narration', text:'꺼져 있던 전자기기들이 하나둘 다시 켜졌다.' },
  { type:'narration', text:'정전도 끝났다.' },
  { type:'narration', text:'뉴스에서는 원인을 알 수 없는 전 세계적인 정전 사태가 발생했다고 보도했지만, 누구도 그 진실을 알 수 없었다.' },
  { type:'narration', text:'최재혁 할아버지는 한동안 말없이 하늘을 바라봤다.' },
  { type:'line', speaker:JAEHYUK, text:'……됐네.' },
  { type:'line', speaker:EP2_PLAYER, text:'네.' },
  { type:'narration', text:'나는 천천히 주변을 둘러봤다.' },
  { type:'narration', text:'무너질 것 같았던 세계가 다시 제자리로 돌아가고 있었다.' },
  { type:'narration', text:'사람들은 다시 일상으로 돌아갔다.' },
  { type:'narration', text:'누군가는 가족에게 전화를 걸었고, 누군가는 길거리에서 서로를 도왔다.' },
  { type:'narration', text:'물론 세상의 문제들이 전부 사라진 것은 아니었다.' },
  { type:'narration', text:'갈등도, 불평도, 서로를 이해하지 못하는 일도 여전히 존재했다.' },
  { type:'narration', text:'하지만 적어도 이제 그것을 바꿀 기회는 남아 있었다.' },
  { type:'narration', text:'최재혁이 내 어깨를 두드렸다.' },
  { type:'line', speaker:JAEHYUK, text:'네가 이 세계를 구했구나.' },
  { type:'narration', text:'나는 고개를 저었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'아뇨.' },
  { type:'narration', text:'잠시 생각하다 웃었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'저 혼자서는 아무것도 못 했을 거예요.' },
  { type:'narration', text:'나는 하늘을 바라봤다.' },
  { type:'narration', text:'세계는 완벽하지 않았다.' },
  { type:'narration', text:'하지만 살아갈 수 있었다.' },
  { type:'thought', text:'멸망을 막는다는 건 세상을 완벽하게 만드는 것이 아니라, 사람들이 다시 한번 서로를 선택할 수 있도록 기회를 남겨두는 것일지도 모른다.' },
  { type:'narration', text:'그날 이후.' },
  { type:'narration', text:'나는 평범한 일상으로 돌아갔다.' },
  { type:'narration', text:'조금은 달라진 세상에서.' },
  { type:'narration', text:'그리고 조금은 달라진 나 자신과 함께.' },
];
/* ---- ①+1라운드 전방공격(데미지X) -> 김현재에 의한 죽음 앤딩(ep2_end9) ---- */
// "김현재에 의한 죽음 앤딩"(ep2_end9)은 재혁/주헌/영웅 전투 각각에서 서로 다른 경위로 도달하지만,
// 결정타를 맞고 쓰러지는 순간부터의 텍스트는 원문에서 토씨 하나 다르지 않고 완전히 동일하다(원문
// 대조 확인됨) - 비운의 저항자 앤딩의 TAIL과 같은 이유로 여기서도 한 번만 정의해 공유한다.
const EP2_CRISIS_END_DEATH_TAIL = [
  { type:'narration', text:'콰아아앙!', showBg:'end9', noBgFade:true, explosion:'large', chars:{left:null, right:null}, bgm:'2-09. Blood Stained Faith' },
  { type:'narration', text:'강렬한 충격이 온몸을 집어삼켰다.' },
  { type:'narration', text:'시야가 흐려졌다.' },
  { type:'narration', text:'몸에서 힘이 빠져나갔다.' },
  { type:'narration', text:'나는 천천히 바닥으로 쓰러졌다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……아.' },
  { type:'thought', text:'손끝 하나 움직일 수 없었다.' },
  { type:'thought', text:'나는 마법사가 아니다.' },
  { type:'thought', text:'강력한 마법도 사용할 수 없고, 거대한 공격을 막아낼 수도 없다.' },
  { type:'thought', text:'잠시나마 그 사실을 잊고 있었던 것 같다.' },
  { type:'line', speaker:EP2_PLAYER, text:'나는…… 인간이었지.' },
  { type:'thought', text:'그것이 마지막으로 떠오른 생각이었다.' },
  { type:'narration', text:'그리고 시야가 완전히 어두워졌다.' },
];
const EP2_CRISIS_BATTLE_JAEHYUK_PROTECT_JAEHYUK_DEATH_LEADIN = [
  { type:'narration', text:'나는 최재혁의 뒤로 몸을 숨기려 했다.' },
  { type:'narration', text:'하지만 이미 늦었다.', stopBgm:true },
  { type:'narration', text:'김현재의 손끝에서 거대한 검은 빛이 폭발했다.', explosion:'large' },
  { type:'line', speaker:JAEHYUK, text:'……!' },
  { type:'narration', text:'순간, 일격이 나를 향해 날아왔다.' },
  { type:'line', speaker:JAEHYUK, text:'__PLAYER_NAME__!' },
  { type:'narration', text:'최재혁의 목소리가 들렸다.' },
  { type:'narration', text:'하지만 오른손의 보호는 그에게만 집중되어 있었다.' },
  { type:'narration', text:'나는 피할 수 없었다.' },
];
/* ---- ②+1라운드 후방공격(데미지O) -> 최재혁의 희생 앤딩(ep2_end10) ---- */
const EP2_CRISIS_BATTLE_JAEHYUK_PROTECT_SELF_SACRIFICE = [
  { type:'narration', text:'최재혁의 오른손에서 무적의 빛이 완성됐다.' },
  { type:'line', speaker:JAEHYUK, text:'지금이야!' },
  { type:'narration', text:'나는 장검을 움켜쥐고 김현재를 향해 달려들었다.' },
  { type:'narration', text:'김현재는 최재혁에게 시선을 고정한 채 필살 마법을 준비하고 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이번에는…….' },
  { type:'narration', text:'나는 이를 악물고 검을 휘둘렀다.' },
  { type:'narration', text:'서걱!', impact:true, hitFlash:'right' },
  { type:'line', speaker:HYUNJAE, text:'크윽……!', staggerCollapse:'right' },
  { type:'narration', text:'공격은 확실히 먹혀들었다.' },
  { type:'narration', text:'하지만 동시에 김현재의 검은 마법이 폭발했다.', explosion:'large', stopBgm:true },
  { type:'line', speaker:EP2_PLAYER, text:'재혁 할아버지!' },
  { type:'narration', text:'오른손을 들고 있던 최재혁의 몸이 크게 흔들렸다.' },
  { type:'narration', text:'그는 나를 바라보며 희미하게 웃었다.' },
  { type:'line', speaker:JAEHYUK, text:'……잘했다.' },
  { type:'narration', text:'그리고 다음 순간.' },
  { type:'narration', text:'그의 몸이 힘없이 무너졌다.', staggerCollapse:'left' },
  { type:'line', speaker:EP2_PLAYER, text:'……어?' },
  { type:'narration', text:'나는 장검을 떨어뜨렸다.' },
  { type:'narration', text:'주변을 둘러봤다.' },
  { type:'narration', text:'최재혁도 쓰러져 있었다.', showBg:'end10', chars:{left:null, center:null, right:null}, bgm:'1-13. Aira' },
  { type:'narration', text:'김현재 역시 피투성이가 된 채 바닥에 엎어져 있었다.' },
  { type:'narration', text:'나를 제외하고는 아무도 움직이지 않았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'아…….' },
  { type:'narration', text:'손이 떨리기 시작했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'안 돼…….', emphasis:true },
  { type:'narration', text:'나는 최재혁에게 달려갔다.' },
  { type:'line', speaker:EP2_PLAYER, text:'할아버지!', emphasis:true },
  { type:'narration', text:'대답이 없었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'일어나세요.' },
  { type:'narration', text:'나는 그의 몸을 흔들었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'제발…….', emphasis:true },
  { type:'narration', text:'아무런 반응도 없었다.' },
  { type:'narration', text:'그제야 현실이 밀려왔다.' },
  { type:'thought', text:'내가 살아남았다.' },
  { type:'thought', text:'하지만 내가 의지했던 사람들은 모두 쓰러졌다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……왜.' },
  { type:'narration', text:'나는 피로 물든 평원을 바라봤다.' },
  { type:'narration', text:'그리고 결국 참았던 감정을 터뜨렸다.' },
  { type:'line', speaker:EP2_PLAYER, text:'왜 이렇게까지 해야 하는데!', emphasis:true },
  { type:'line', speaker:EP2_PLAYER, text:'으아아아아아!', emphasis:true },
  { type:'narration', text:'내 절규가 텅 빈 광장에 울려 퍼졌다.' },
  { type:'narration', text:'얼마나 시간이 흘렀을까.' },
  { type:'narration', text:'나는 여전히 그 자리에 앉아 있었다.' },
  { type:'narration', text:'아무도 일어나지 않았다.' },
  { type:'narration', text:'그리고 세상은 아무 일도 없었다는 듯 움직이기 시작했다.' },
  { type:'narration', text:'정전은 끝났고, 사람들은 다시 일상으로 돌아갔다.' },
  { type:'narration', text:'하지만 나에게는 아무것도 예전과 같지 않았다.' },
  { type:'narration', text:'나는 마지막으로 최재혁의 얼굴을 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……할아버지.' },
  { type:'narration', text:'대답은 없었다.' },
  { type:'narration', text:'나는 천천히 자리에서 일어났다.' },
  { type:'thought', text:'세상을 구했다고 하기엔 너무 많은 것을 잃었다.' },
  { type:'thought', text:'하지만 그가 마지막까지 지키려 했던 것이 무엇인지는 알 것 같았다.' },
  { type:'narration', text:'나는 하늘을 올려다봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……살아갈게요.' },
  { type:'narration', text:'그리고 피로 물든 광장을 뒤로한 채 걸어갔다.' },
];
/* ---- ②+1라운드 전방공격(데미지X) -> 비운의 저항자 앤딩(ep2_end2, 공용 TAIL 재사용) ---- */
const EP2_CRISIS_BATTLE_JAEHYUK_PROTECT_SELF_RESIST_LEADIN = [
  { type:'narration', text:'나는 아무것도 하지 못했다.' },
  { type:'narration', text:'눈앞으로 거대한 검은 마법이 다가오고 있었다.' },
  { type:'narration', text:'도망칠 수도 없었다.' },
  { type:'narration', text:'검을 휘두를 수도 없었다.' },
  { type:'narration', text:'그저 가만히 서 있었다.' },
  { type:'narration', text:'콰아아앙!', explosion:'large' },
  { type:'narration', text:'강렬한 빛과 충격이 나를 덮쳤다.', whiteout:true, stopBgm:true },
  { type:'narration', text:'……' },
  { type:'narration', text:'나는 천천히 눈을 떴다.', showBg:'empty_ruins', whiteout:false },
  { type:'line', speaker:EP2_PLAYER, text:'……살아있어?' },
  { type:'narration', text:'몸을 움직여봤다.' },
  { type:'narration', text:'상처는 있었지만 움직일 수 있었다.' },
  { type:'narration', text:'그리고 곧바로 주변을 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'재혁 할아버지……?' },
  { type:'narration', text:'대답은 없었다.' },
  { type:'narration', text:'최재혁은 바닥에 쓰러져 있었다.' },
  { type:'narration', text:'움직이지 않았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'narration', text:'나는 아무 말도 할 수 없었다.' },
  { type:'narration', text:'그때 김현재가 천천히 나를 바라봤다.', chars:{center:'hyunjae'} },
  { type:'line', speaker:HYUNJAE, text:'결국 너는 살아남았군.' },
  { type:'narration', text:'그의 손끝에서 검은 마법진이 나타났다.' },
  { type:'line', speaker:HYUNJAE, text:'하지만 너까지 죽일 필요는 없겠지.' },
  { type:'line', speaker:EP2_PLAYER, text:'무슨…….' },
  { type:'line', speaker:HYUNJAE, text:'인간은 그저 남겨둬도 된다.' },
  { type:'narration', text:'김현재가 손을 내밀었다.' },
  { type:'line', speaker:HYUNJAE, text:'모든 것을 기억할 필요는 없으니까.' },
  { type:'narration', text:'검은 빛이 내 머릿속으로 스며들었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……잠깐!' },
  { type:'narration', text:'순간 머리가 깨질 듯 아파왔다.', whiteout:true, se:'SE_Vanish_01' },
  { type:'narration', text:'최재혁의 얼굴이 흐려졌다.' },
  { type:'narration', text:'김현재의 모습도 흐려졌다.' },
  { type:'narration', text:'그리고 내가 지금까지 겪었던 모든 일이 하나씩 사라지기 시작했다.' },
  { type:'line', speaker:HYUNJAE, text:'잊어라.' },
];

function playEp2CrisisBattleJaehyuk(){
  // EP2_CRISIS_BATTLE_JAEHYUK_INTRO 첫 줄엔 chars가 없다(펜던트 소환 씬에서 그대로 이어짐) - 이
  // 지점(ep2_scene4_jaehyuk)으로 직접 이어하기하면 재혁/김현재가 안 보이는 채로 시작하는 버그가
  // 있었다(신고받아 수정).
  setChars({left:'jaehyuk', center:null, right:'hyunjae'}, true);
  playQueue(EP2_CRISIS_BATTLE_JAEHYUK_INTRO.slice(), ()=>{
    showChoiceGeneric(EP2_CRISIS_BATTLE_JAEHYUK_CHOICE, (opt)=>{
      ep2JaehyukDamageDealt = opt.key === 'back';
      const outcome = opt.key === 'front' ? EP2_CRISIS_BATTLE_JAEHYUK_FRONT : EP2_CRISIS_BATTLE_JAEHYUK_BACK;
      // 원문 s#4->s#5 경계(무적기 2라운드 진입) - 씬 번호가 바뀌므로 티켓 게이트(신고받아 추가).
      playQueue(outcome.slice(), ()=> gateNextScene('ep2_scene5_jaehyuk', playEp2CrisisBattleJaehyukRound2Intro, getEp2State()));
    });
  });
}

function playEp2CrisisBattleJaehyukRound2Intro(){
  // ROUND2_INTRO 첫 줄엔 showBg/chars가 없다(1라운드에서 그대로 이어짐) - 이어하기 대비
  // 씬 시작점에 명시한다(신고받아 수정 - 안 그러면 재혁/김현재가 안 보이는 채로 시작한다).
  setBg('empty_plain');
  setChars({left:'jaehyuk', center:null, right:'hyunjae'}, true);
  playQueue(EP2_CRISIS_BATTLE_JAEHYUK_ROUND2_INTRO.slice(), showEp2CrisisBattleJaehyukRound2Choice);
}
function showEp2CrisisBattleJaehyukRound2Choice(){
  showChoiceGeneric(EP2_CRISIS_BATTLE_JAEHYUK_ROUND2_CHOICE, (opt)=>{
    if(opt.key === 'jaehyuk'){
      if(ep2JaehyukDamageDealt){
        playQueue(EP2_CRISIS_BATTLE_JAEHYUK_PROTECT_JAEHYUK_WIN.slice(), ()=> showEp2Ending('재혁과 승리 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['재혁과 승리 앤딩']));
      } else {
        playQueue(EP2_CRISIS_BATTLE_JAEHYUK_PROTECT_JAEHYUK_DEATH_LEADIN.concat(EP2_CRISIS_END_DEATH_TAIL), ()=> showEp2Ending('김현재에 의한 죽음 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['김현재에 의한 죽음 앤딩']));
      }
    } else {
      if(ep2JaehyukDamageDealt){
        playQueue(EP2_CRISIS_BATTLE_JAEHYUK_PROTECT_SELF_SACRIFICE.slice(), ()=> showEp2Ending('최재혁의 희생 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['최재혁의 희생 앤딩']));
      } else {
        playQueue(EP2_CRISIS_BATTLE_JAEHYUK_PROTECT_SELF_RESIST_LEADIN.concat(EP2_CRISIS_END_RESISTER_TAIL), ()=> showEp2Ending('비운의 저항자 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['비운의 저항자 앤딩']));
      }
    }
  });
}

/* ---- ③ 마법봉 -> 히든 앤딩: 악당과의 협력 앤딩(ep2_end22) ---- */
const EP2_CRISIS_END_COLLAB = [
  { type:'narration', text:'나는 본능적으로 주머니를 뒤졌다.' },
  { type:'narration', text:'손에 잡힌 것은 며칠 전 그 상자에서 발견한 이상한 마법봉이었다.' },
  { type:'narration', text:'바리깡처럼 생긴 마법봉.' },
  { type:'narration', text:'나는 그것을 꺼내 그에게 겨눴다.' },
  // 마법봉을 꺼내는 주체가 김현재가 아니라 주인공(플레이어) 자신이므로 chars를 주지 않는다 -
  // 그러면 지금 center에 있는 김현재는 옆으로 비켜서기만 하고(기본 동작), 스탠딩이 바뀌는 dip
  // 연출(내려갔다 올라오는 것)은 건너뛴다(요청됨).
  { type:'itemReveal', item:EP2_IMG_MAGIC_WAND },
  { type:'line', speaker:HYUNJAE_VEILED, text:'…….', hitFlash:'center', stopBgm:true },
  { type:'narration', text:'그의 표정이 처음으로 크게 흔들렸다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'어떻게?' },
  { type:'narration', text:'그가 한 걸음 다가왔다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'어떻게 네가 그것을 가지고 있지?', bgm:'17. Formless Dream' },
  { type:'line', speaker:EP2_PLAYER, text:'이게 뭔데요?' },
  { type:'narration', text:'그는 마법봉을 바라보며 중얼거렸다.' },
  { type:'line', speaker:HYUNJAE, text:'그건…… 나 김현재의 후계자를 찾기 위한 최후의 방편이었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'후계자?' },
  { type:'line', speaker:HYUNJAE, text:'내가 틀렸을 때.' },
  { type:'line', speaker:HYUNJAE, text:'나를 멈출 사람에게 넘기기 위해서.' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'line', speaker:HYUNJAE, text:'그걸 들고 내 앞에 섰다는 건, 네 대답은 이미 정해졌다는 뜻이겠지.' },
  { type:'line', speaker:EP2_PLAYER, text:'그래요.' },
  { type:'line', speaker:EP2_PLAYER, text:'당신이 틀렸다고 생각합니다.' },
  { type:'narration', text:'처음으로 김현재가 아무 말도 하지 못했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'그러니까 멈추세요.', stopBgm:true },
  { type:'itemHide' },
  { type:'narration', text:'잠시 침묵이 흘렀다.' },
  { type:'narration', text:'그는 나를 바라봤다.' },
  { type:'line', speaker:HYUNJAE, text:'……그래.' },
  { type:'line', speaker:HYUNJAE, text:'그게 네 선택이라면.' },
  { type:'line', speaker:HYUNJAE, text:'이번에는 내가 받아들이지.' },
  { type:'line', speaker:HYUNJAE, text:'그럼…….' },
  { type:'line', speaker:HYUNJAE, text:'더 이상 내가 관여할 필요도 없겠지.' },
  { type:'narration', text:'김현재는 등을 돌렸다.' },
  { type:'line', speaker:HYUNJAE, text:'잘 살아라.' },
  { type:'line', speaker:EP2_PLAYER, text:'잠깐만요! 어디 가는데요?' },
  { type:'narration', text:'그는 대답하지 않았다.' },
  { type:'narration', text:'그저 천천히 걸어가더니 사람들 사이로 사라졌다.', clearBg:true, chars:{center:null} },
  { type:'narration', text:'그 후 세계는 조금씩 변하기 시작했다.' },
  { type:'narration', text:'사람들은 서로를 이해하려 노력했고, 갈등을 해결하기 위해 대화하기 시작했다.' },
  { type:'narration', text:'무너질 것 같았던 사회는 다시 균형을 찾아갔다.' },
  { type:'narration', text:'그리고 어느 날.' },
  { type:'narration', text:'나는 몸스터치라는 햄버거 가게에 들어갔다.', showBg:'monsterpie_shop' },
  { type:'line', speaker:EP2_PLAYER, text:'햄버거 하나 주세요.' },
  { type:'narration', text:'주문을 하고 자리에 앉으려는데, 주방 쪽에서 익숙한 얼굴이 보였다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……어?' },
  { type:'narration', text:'나는 눈을 의심했다.' },
  { type:'thought', text:'설마…….' },
  // 이 시점에 스탠딩 대신 히든 엔딩 CG(end22)를 보여준다(요청됨) - 이후 대사는 ep1의 CG 연출(예:
  // true_juheon)과 동일하게 스탠딩 없이 CG를 배경으로 삼아 이어진다.
  { type:'narration', text:'앞치마를 두른 남자가 나를 바라봤다.', showBg:'end22', bgm:'11.Responsibility' },
  { type:'line', speaker:EP2_PLAYER, text:'어라?' },
  { type:'line', speaker:EP2_PLAYER, text:'대마법사님? 여기서 뭐 해요?' },
  { type:'narration', text:'김현재는 잠시 나를 바라보다 태연하게 대답했다.' },
  { type:'line', speaker:HYUNJAE, text:'야.' },
  { type:'narration', text:'그가 감자튀김을 집어 먹으며 말했다.' },
  { type:'line', speaker:HYUNJAE, text:'나도 살긴 살아야지.' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'narration', text:'나는 어이가 없어 웃음을 터뜨렸다.' },
  { type:'thought', text:'세계의 멸망을 이야기하던 대마법사가 햄버거 가게에서 아르바이트를 하고 있다니.' },
  { type:'thought', text:'어쩌면 이것이야말로 가장 평범하고 이상적인 결말일지도 모른다.' },
];

/* ---- ④ 송주헌 소환 ---- */
const EP2_CRISIS_FRIEND_JUHEON = [
  { type:'narration', text:'나는 다급하게 휴대폰을 꺼냈다.' },
  { type:'thought', text:'지금 이 상황을 혼자 해결할 수 있을 것 같지 않았다.' },
  { type:'narration', text:'곧바로 송주헌에게 메신저를 보냈다.', openChat:'juheon' },
  { type:'chat', from:'player', text:'주헌아, 여기로 급히 와야 할 것 같아.' },
  { type:'chat', from:'player', text:'지금 상황은 너도 잘 알 거라고 생각해.' },
  { type:'chat', from:'player', text:'주소 보낼게.' },
  { type:'narration', text:'나는 현재 위치를 찍어 보냈다.' },
  { type:'narration', text:'메시지를 보내자마자 1이 사라졌다. 그리고 답장이 왔다.' },
  { type:'chat', from:JUHEON2, text:'알겠어.', closeChat:true },
  { type:'narration', text:'나는 휴대폰을 내려놓고 주변을 살폈다.' },
  { type:'narration', text:'검은 옷의 남자, 김현재는 여전히 아무 말 없이 나를 바라보고 있었다.' },
  { type:'narration', text:'시간이 얼마나 흘렀을까.' },
  { type:'narration', text:'멀리서 익숙한 목소리가 들렸다.' },
  { type:'line', speaker:JUHEON2, text:'야! __PLAYER_NAME__!' },
  // 목소리만 들리고 아직 눈에 보이지는 않는 시점이라 스탠딩은 아직 안 세운다 - 실제로 "고개를 돌려"
  // 그를 발견하는 이 줄에서 등장시킨다. 인물이 둘일 때는 기본적으로 left+right에 대칭 배치되어야
  // 하므로(신고받아 수정 - 예전엔 center+right로 둬서 비대칭 구도였다), center에 혼자 있던 김현재가
  // 여유롭게 right로 밀려나고 주헌이 left에 등장하는 연출(대사창은 그 사이 자동으로 숨겨진다)이
  // 트리거되도록 chars:{left, right}를 한 줄에 함께 지정한다(tryPlayCenterSlideToSideTransition 참고).
  { type:'narration', text:'고개를 돌리자 송주헌이 숨을 헐떡이며 뛰어오고 있었다.', chars:{left:'juheon', right:'hyunjae'} },
  { type:'line', speaker:JUHEON2, text:'대체 무슨 일이야? 갑자기 이런 곳으로 오라고 하면…….' },
  { type:'narration', text:'주헌은 말을 멈췄다.' },
  { type:'narration', text:'눈앞에 서 있는 그를 발견했기 때문이다.' },
  { type:'line', speaker:JUHEON2, text:'……뭐야, 저 사람?' },
  { type:'narration', text:'그의 표정도 처음으로 변했다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'……송주헌.' },
  { type:'line', speaker:JUHEON2, text:'내 이름을 어떻게 알아?' },
  { type:'narration', text:'두 사람 사이에 묘한 긴장감이 흘렀다.' },
  { type:'thought', text:'이제부터가 진짜 시작인가…….', clearBg:true, stopBgm:true },
];

// 씬 전환 연출(요청됨): 배경이 암전된 채로 위 마지막 대사가 끝나면, 대사·스탠딩 없이 empty_plain이
// 1초간 유지되다가 큰 폭발과 함께 empty_ruins로 바뀌고, 폭발이 끝난 뒤에야 스탠딩+대사가 함께 나온다.
const EP2_CRISIS_BATTLE_JUHEON_INTRO = [
  { type:'silentEffect', showBg:'empty_plain', chars:{left:null, center:null}, holdMs:1000 },
  { type:'silentEffect', showBg:'empty_ruins', noBgFade:true, explosion:'large', holdMs:900 },
  // 인물이 둘일 때는 기본적으로 left+right에 대칭 배치되어야 하므로(신고받아 수정 - 예전엔 김현재를
  // center에 둬서 비대칭 구도였다), 김현재도 right에 세운다. 아래 이 배틀 전체의 hitFlash/staggerCollapse
  // 중 김현재를 겨냥하던 'center'도 전부 'right'로 함께 맞췄다.
  { type:'narration', text:'김현재는 손을 들어 올린 채 우리를 바라봤다.', chars:{left:'juheon', right:'hyunjae'} },
  { type:'narration', text:'하지만 곧 공격을 멈췄다.' },
  { type:'line', speaker:HYUNJAE, text:'……죽이기 전에 하나 묻지.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭘?' },
  { type:'line', speaker:HYUNJAE, text:'너희는 지금 세상을 보고도 아무것도 느끼지 못하나?' },
  { type:'narration', text:'김현재의 목소리는 의외로 차분했다.' },
  { type:'line', speaker:JUHEON2, text:'뭘 말하고 싶은건데' },
  { type:'line', speaker:HYUNJAE, text:'이미 멸망은 시작됐다.' },
  { type:'narration', text:'김현재가 우리를 바라봤다.' },
  { type:'line', speaker:HYUNJAE, text:'나는 단지 마지막을 조금 앞당기려는 것뿐이다. 그리고 아주 서서히 스며들도록' },
  { type:'line', speaker:EP2_PLAYER, text:'그건 네가 판단할 일이 아니야.' },
  { type:'line', speaker:EP2_PLAYER, text:'인간은 계속 잘못하지만, 그걸 고치려고도 해.' },
  { type:'narration', text:'김현재가 피식 웃었다.' },
  { type:'line', speaker:HYUNJAE, text:'그래서 바뀌었나?' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'line', speaker:HYUNJAE, text:'수십 년, 수백 년 동안 같은 문제가 반복되고 있다. 갈등은 더욱 깊어지고, 사람들은 자신과 다른 사람을 이해하려 하지 않는다.' },
  { type:'line', speaker:JUHEON2, text:'그래도 살아가는 사람들에게서 선택할 권리까지 빼앗을 순 없어.' },
  { type:'line', speaker:HYUNJAE, text:'선택?' },
  { type:'line', speaker:HYUNJAE, text:'그 선택 때문에 이 세계가 여기까지 온 거다.' },
  { type:'narration', text:'나는 김현재를 똑바로 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'그렇다고 네가 모든 사람의 선택을 대신할 자격이 생기는 건 아니야.' },
  { type:'narration', text:'잠시 정적이 흘렀다.' },
  { type:'narration', text:'김현재의 손끝에서 검은 마력이 피어올랐다.', glitch:true, bgm:'2-09. CrossFire' },
  { type:'line', speaker:HYUNJAE, text:'……결국 너희도 인간의 편인가.' },
  { type:'line', speaker:EP2_PLAYER, text:'그래.' },
  { type:'narration', text:'나는 주먹을 꽉 쥐었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'적어도 나는 이 세계가 어떻게 끝날지, 내가 직접 보고 결정하겠어.' },
  { type:'narration', text:'김현재가 천천히 손을 들어 올렸다.' },
  { type:'line', speaker:HYUNJAE, text:'그렇다면 더 이상 말할 필요도 없겠군.' },
  { type:'narration', text:'주변의 공기가 무겁게 가라앉았다.' },
  { type:'line', speaker:HYUNJAE, text:'마지막으로 기회를 주겠다.' },
  { type:'line', speaker:EP2_PLAYER, text:'거절한다.' },
  { type:'narration', text:'김현재의 눈빛이 차갑게 변했다.' },
  { type:'line', speaker:HYUNJAE, text:'그럼 직접 증명해 봐라.' },
  { type:'narration', text:'그 순간, 검은 마법이 폭발했다.', explosion:'large' },
  { type:'narration', text:'나는 본능적으로 몸을 굴려 피했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'주헌아!' },
  { type:'line', speaker:JUHEON2, text:'알아!', chars:{left:'juheon_sword'} },
  { type:'narration', text:'주헌이 바닥에 떨어진 돌멩이를 집어 김현재에게 던졌다.' },
  { type:'narration', text:'쨍!' },
  { type:'narration', text:'김현재의 주변에 마법 방어막이 생겼다.' },
  { type:'line', speaker:HYUNJAE, text:'소용없다.' },
  { type:'narration', text:'하지만 그 짧은 순간, 김현재의 시선이 주헌에게 향했다.' },
  { type:'thought', text:'나는 깨달았다.' },
  { type:'thought', text:'마법을 이길 수 없다면, 마법을 쓰지 못하게 하면 된다.' },
  { type:'narration', text:'김현재가 다시 손을 들어 올렸다.' },
  { type:'line', speaker:HYUNJAE, text:'끝내주마.' },
  { type:'narration', text:'나는 이를 악물고 달려들었다.', cameraPunch:true },
];

const EP2_CRISIS_BATTLE_JUHEON_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 김현재에게 강한 타격을 준다.', key:'strike' },
    { label:'② 김현재를 기절시킨다.', key:'knockout' },
  ],
};

const EP2_CRISIS_BATTLE_JUHEON_STRIKE = [
  { type:'narration', text:'나는 이를 악물고 김현재에게 달려들었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'지금이야!' },
  { type:'narration', text:'주헌과 함께 몸을 부딪치자 김현재의 균형이 무너졌다.' },
  { type:'line', speaker:HYUNJAE, text:'……!' },
  { type:'narration', text:'나는 그대로 주먹을 휘둘렀다.' },
  { type:'narration', text:'퍽!', impact:true, hitFlash:'right' },
  { type:'narration', text:'김현재의 몸이 몇 걸음 뒤로 밀려났다.' },
  { type:'line', speaker:EP2_PLAYER, text:'먹혔다!' },
  { type:'narration', text:'하지만 김현재는 천천히 고개를 들었다.' },
  { type:'narration', text:'입가에 묻은 피를 손등으로 닦았다.' },
  { type:'line', speaker:HYUNJAE, text:'……재미있군.' },
  { type:'narration', text:'그의 눈빛이 완전히 달라졌다.' },
  { type:'line', speaker:HYUNJAE, text:'처음부터 이 정도로 진심을 냈어야 했나.' },
  { type:'narration', text:'주변의 검은 마력이 폭발적으로 증가했다.', glitch:true },
  { type:'narration', text:'쿠구구구…….', rumble:true },
  { type:'line', speaker:HYUNJAE, text:'이제 봐주지 않겠다.' },
  { type:'thought', text:'나는 침을 삼켰다.' },
  { type:'thought', text:'방금 공격이 통했다고 좋아할 상황이 아니었다.' },
  { type:'thought', text:'오히려 지금부터가 진짜 싸움이었다.' },
];

const EP2_CRISIS_BATTLE_JUHEON_KNOCKOUT = [
  { type:'narration', text:'나는 김현재의 시선을 피하며 빈틈을 노렸다.' },
  { type:'line', speaker:JUHEON2, text:'지금!' },
  { type:'narration', text:'나는 곧바로 달려들었다.' },
  { type:'narration', text:'김현재가 마법을 사용하려는 순간, 나는 그의 팔을 붙잡아 움직임을 막았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이거나 받아!' },
  { type:'narration', text:'퍽!', impact:true, hitFlash:'right' },
  { type:'narration', text:'강한 타격이 김현재의 머리를 가격했다.' },
  { type:'line', speaker:HYUNJAE, text:'……큭.' },
  { type:'narration', text:'그의 몸이 휘청거렸다.' },
  { type:'narration', text:'그리고 그대로 무릎을 꿇었다.' },
  { type:'narration', text:'털썩.', staggerCollapse:'right' },
  { type:'narration', text:'김현재가 바닥에 쓰러졌다.' },
  { type:'line', speaker:EP2_PLAYER, text:'기절한 건가?' },
  { type:'narration', text:'주헌이 조심스럽게 다가갔다.' },
  { type:'line', speaker:JUHEON2, text:'잠깐은 그런 것 같아.' },
  { type:'narration', text:'우리는 서로를 바라봤다.' },
  { type:'thought', text:'하지만 안심할 수는 없었다.' },
  { type:'thought', text:'세계의 멸망을 선언한 마법사가 눈앞에 쓰러져 있었다.' },
  { type:'thought', text:'그리고 우리는 아직 그가 왜 이런 일을 벌였는지, 무엇을 준비했는지도 알지 못했다.' },
];

/* ---- 2라운드: 주헌이 미끼가 되겠다고 나서고, 그를 희생시킬지/다른 전략을 찾을지 ---- */
const EP2_CRISIS_BATTLE_JUHEON_ROUND2_INTRO = [
  { type:'narration', text:'김현재의 공격이 쉴 새 없이 이어졌다.', bgm:'2-09. CrossFire' },
  { type:'narration', text:'콰앙!', impact:true, hitFlash:'left' },
  { type:'line', speaker:JUHEON2, text:'크윽!' },
  { type:'narration', text:'우리는 간신히 공격을 피하며 뒤로 물러났다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이대로는 못 버텨!' },
  { type:'narration', text:'주헌이 숨을 고르며 말했다.' },
  { type:'line', speaker:JUHEON2, text:'__PLAYER_NAME__, 이제 최후의 수단을 써야 할 것 같아.' },
  { type:'line', speaker:EP2_PLAYER, text:'최후의 수단?' },
  { type:'narration', text:'주헌이 김현재를 바라봤다.' },
  { type:'line', speaker:JUHEON2, text:'내가 미끼가 될게.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭐?' },
  { type:'line', speaker:JUHEON2, text:'내가 녀석의 시선을 끌고 공격을 받아낼 거야. 그동안 네가 빈틈을 노리는 거지.' },
  { type:'narration', text:'주헌이 씁쓸하게 웃었다.' },
  { type:'line', speaker:JUHEON2, text:'내가 페이스메이커가 되는 거야.' },
  { type:'line', speaker:EP2_PLAYER, text:'그게 무슨 뜻인지 알고 하는 말이야?' },
  { type:'line', speaker:JUHEON2, text:'알아.' },
  { type:'narration', text:'주헌은 잠시 침묵했다.' },
  { type:'line', speaker:JUHEON2, text:'어쩌면 내가 살아남지 못할 수도 있겠지.' },
  { type:'line', speaker:EP2_PLAYER, text:'그럼 안 돼.' },
  { type:'line', speaker:JUHEON2, text:'하지만 다른 방법이 없어.' },
  { type:'narration', text:'김현재가 다시 손을 들어 올렸다.' },
  { type:'narration', text:'검은 마법진이 우리 머리 위에 나타났다.' },
  { type:'narration', text:'주헌이 나를 바라봤다.' },
  { type:'line', speaker:JUHEON2, text:'결정해. 지금 시간이 없어.' },
  { type:'narration', text:'나는 주먹을 꽉 쥐었다.' },
  { type:'thought', text:'주헌을 희생시키면 김현재에게 결정적인 공격을 가할 수 있을지도 모른다.' },
  { type:'thought', text:'하지만 그 대가는 너무나 컸다.' },
  { type:'thought', text:'친구를 희생해서라도 세계를 구해야 하는가.' },
  { type:'thought', text:'아니면 다른 방법을 찾아야 하는가.' },
  { type:'thought', text:'나는 쉽게 결정을 내릴 수 없었다.' },
];
const EP2_CRISIS_BATTLE_JUHEON_ROUND2_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 주헌을 희생시킨다.', key:'sacrifice' },
    { label:'② 다른 전략을 생각해본다.', key:'strategize' },
  ],
};
/* ---- ①+1라운드 기절(knockout) -> 송주헌과 승리 앤딩(ep2_end5) ---- */
const EP2_CRISIS_BATTLE_JUHEON_SACRIFICE_WIN = [
  { type:'narration', text:'나는 망설이다가 말했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'그래 그렇게 한번 해보자.' },
  { type:'narration', text:'주헌이 잠시 눈을 크게 떴다. 그러다 입을 열었다.' },
  { type:'line', speaker:JUHEON2, text:'……어.' },
  { type:'narration', text:'나는 김현재를 바라봤다.' },
  { type:'narration', text:'그의 움직임은 주헌이가 시선을 끈다면 내가 충분히 타격할 수 있을 정도였다.' },
  { type:'line', speaker:EP2_PLAYER, text:'네가 시선을 끈다면…… 내가 단숨에 뒤를 공격할게.' },
  { type:'line', speaker:JUHEON2, text:'…….' },
  { type:'line', speaker:EP2_PLAYER, text:'최대한 피해다녀. 죽을 생각 하지 말고.' },
  { type:'narration', text:'주헌은 잠시 생각하더니 그 말에 피식 웃었다.' },
  { type:'line', speaker:JUHEON2, text:'그래, 믿어볼게.' },
  { type:'narration', text:'김현재가 손을 내밀어 마법진을 준비했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'좋다. 해보자.' },
  { type:'line', speaker:JUHEON2, text:'야! 이 멍청한년아!', emphasis:true },
  { type:'narration', text:'김현재가 거대한 검은 마법을 송주헌에게 쏟아냈다.' },
  { type:'narration', text:'콰아아아앙!', explosion:'large' },
  { type:'narration', text:'하지만 모든 공격은 발 빠른 송주헌의 움직임에 회피되었다.' },
  { type:'narration', text:'나는 재빨리 김현재의 뒤로 달려갔다.' },
  { type:'thought', text:'지금이야!' },
  { type:'narration', text:'내 손끝에는 의지에 불타오르는 혈류가 흘렀다.' },
  { type:'narration', text:'그리고 바로 그 순간.' },
  { type:'line', speaker:EP2_PLAYER, text:'받아라!' },
  { type:'narration', text:'콰아아아앙!', impact:true, hitFlash:'right' },
  { type:'narration', text:'내 주먹이 김현재의 심장을 꿰뚫었다.' },
  { type:'line', speaker:HYUNJAE, text:'……__PLAYER_NAME__…….' },
  { type:'narration', text:'김현재의 몸에서 검은 마력이 빠져나갔다.' },
  { type:'narration', text:'그는 마지막으로 우리를 바라보더니 천천히 무너졌다.', staggerCollapse:'right', stopBgm:true },
  { type:'narration', text:'정적이 찾아왔다.' },
  { type:'narration', text:'나는 믿기지 않는 표정으로 쓰러진 김현재를 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'끝난…… 건가?' },
  { type:'narration', text:'송주헌은 거칠게 숨을 내쉬며 고개를 끄덕였다.' },
  { type:'line', speaker:JUHEON2, text:'그래.' },
  { type:'narration', text:'난 천천히 숨을 골랐다.' },
  { type:'line', speaker:EP2_PLAYER, text:'끝났다.' },
  { type:'narration', text:'김현재가 쓰러진 뒤, 세상은 거짓말처럼 조용해졌다.' },
  { type:'narration', text:'꺼져 있던 전자기기들이 하나둘 다시 켜졌다.' },
  { type:'narration', text:'정전도 끝났다.' },
  { type:'narration', text:'뉴스에서는 원인을 알 수 없는 전 세계적인 정전 사태가 발생했다고 보도했지만, 누구도 그 진실을 알 수 없었다.' },
  { type:'narration', text:'주헌이는 한동안 말없이 하늘을 바라봤다.', showBg:'end5', chars:{left:null, center:null, right:null}, bgm:'You are the One arrange' },
  { type:'line', speaker:EP2_PLAYER, text:'……됐네.' },
  { type:'line', speaker:JUHEON2, text:'어.' },
  { type:'narration', text:'나는 천천히 주변을 둘러봤다.' },
  { type:'narration', text:'무너질 것 같았던 세계가 다시 제자리로 돌아가고 있었다.' },
  { type:'narration', text:'사람들은 다시 일상으로 돌아갔다.' },
  { type:'narration', text:'누군가는 가족에게 전화를 걸었고, 누군가는 길거리에서 서로를 도왔다.' },
  { type:'narration', text:'물론 세상의 문제들이 전부 사라진 것은 아니었다.' },
  { type:'narration', text:'갈등도, 불평도, 서로를 이해하지 못하는 일도 여전히 존재했다.' },
  { type:'narration', text:'하지만 적어도 이제 그것을 바꿀 기회는 남아 있었다.' },
  { type:'narration', text:'송주헌이 내 어깨를 두드렸다.' },
  { type:'line', speaker:JUHEON2, text:'적절한 타이밍에 잘 불러줬어.' },
  { type:'narration', text:'나는 옅게 미소를 지었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'고마워.' },
  { type:'narration', text:'잠시 생각하다 웃었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'나 혼자였으면 아무것도 못 했을 거야.' },
  { type:'narration', text:'나는 하늘을 바라봤다.' },
  { type:'narration', text:'세계는 완벽하지 않았다.' },
  { type:'narration', text:'하지만 살아갈 수 있었다.' },
  { type:'thought', text:'멸망을 막는다는 건 세상을 완벽하게 만드는 것이 아니라, 사람들이 다시 한번 서로를 선택할 수 있도록 기회를 남겨두는 것일지도 모른다.' },
  { type:'narration', text:'그날 이후.' },
  { type:'narration', text:'나는 평범한 일상으로 돌아갔다.' },
  { type:'narration', text:'조금은 달라진 세상에서.' },
  { type:'narration', text:'그리고 조금은 달라진 나 자신과 함께.' },
];
/* ---- ①+1라운드 강한 타격(stunned 아님) -> 송주헌의 희생 앤딩(ep2_end11) ---- */
const EP2_CRISIS_BATTLE_JUHEON_SACRIFICE_DEATH = [
  { type:'line', speaker:JUHEON2, text:'지금이야!' },
  { type:'narration', text:'주헌이가 다급하게 소리쳤다.' },
  { type:'narration', text:'나는 김현재를 향해 달려들었다.' },
  { type:'narration', text:'김현재는 필살 마법을 준비하고 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이번에는…….' },
  { type:'narration', text:'나는 이를 악물고 주먹을 휘둘렀다.' },
  { type:'narration', text:'쾅!', impact:true, hitFlash:'right' },
  { type:'narration', text:'주먹이 정확히 김현재의 오른쪽 턱에 꽂혔다.' },
  { type:'line', speaker:HYUNJAE, text:'크윽……!' },
  { type:'narration', text:'공격은 확실히 먹혀들었다.' },
  { type:'narration', text:'하지만 동시에 김현재의 검은 마법이 폭발했다.', explosion:'large', stopBgm:true },
  { type:'line', speaker:EP2_PLAYER, text:'송주헌!' },
  { type:'narration', text:'주헌의 몸이 크게 흔들렸다.' },
  { type:'narration', text:'주헌이는 나를 바라보며 희미하게 웃었다.' },
  { type:'line', speaker:JUHEON2, text:'……잘했다.' },
  { type:'narration', text:'그리고 다음 순간.' },
  { type:'narration', text:'주헌의 몸이 힘없이 무너졌다.', staggerCollapse:'left' },
  { type:'line', speaker:EP2_PLAYER, text:'……어?' },
  { type:'narration', text:'나는 허탈감에 휩싸였다.' },
  { type:'narration', text:'다시 김현재를 쳐다봤다.' },
  { type:'narration', text:'김현재 역시 피투성이가 된 채 바닥에 엎어져 있었다.' , staggerCollapse:'right'},
  { type:'narration', text:'나를 제외하고는 아무도 움직이지 않았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'아…….' },
  { type:'narration', text:'손이 떨리기 시작했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'안 돼…….', emphasis:true },
  { type:'narration', text:'나는 주헌에게 달려갔다.', showBg:'end11', chars:{left:null, center:null, right:null}, bgm:'2-07. Morose Dreamer' },
  { type:'line', speaker:EP2_PLAYER, text:'야 송주헌!', emphasis:true },
  { type:'narration', text:'대답이 없었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'일어나 장난치지 말고.' },
  { type:'narration', text:'나는 주헌의 몸을 흔들었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'제발…….. 일어나라고!!', emphasis:true },
  { type:'narration', text:'아무런 반응도 없었다.' },
  { type:'narration', text:'그제야 현실이 밀려왔다.' },
  { type:'thought', text:'내가 살아남았다.' },
  { type:'thought', text:'하지만 내가 의지했던 사람은 모두 쓰러졌다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……왜.' },
  { type:'narration', text:'나는 피로 물든 평원을 바라봤다.' },
  { type:'narration', text:'그리고 결국 참았던 감정을 터뜨렸다.' },
  { type:'line', speaker:EP2_PLAYER, text:'왜 이렇게까지 해야 하는데!', emphasis:true },
  { type:'line', speaker:EP2_PLAYER, text:'으아아아아아!', emphasis:true },
  { type:'narration', text:'내 절규가 텅 빈 평원에 울려 퍼졌다.' },
  { type:'narration', text:'얼마나 시간이 흘렀을까.' },
  { type:'narration', text:'나는 여전히 그 자리에 앉아 있었다.' },
  { type:'narration', text:'아무도 일어나지 않았다.' },
  { type:'narration', text:'그리고 세상은 아무 일도 없었다는 듯 움직이기 시작했다.' },
  { type:'narration', text:'정전은 끝났고, 사람들은 다시 일상으로 돌아갔다.' },
  { type:'narration', text:'하지만 나에게는 아무것도 예전과 같지 않았다.' },
  { type:'narration', text:'나는 마지막으로 송주헌의 얼굴을 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……주헌아.' },
  { type:'narration', text:'대답은 없었다.' },
  { type:'narration', text:'나는 천천히 자리에서 일어났다.' },
  { type:'thought', text:'세상을 구했다고 하기엔 너무 많은 것을 잃었다.' },
  { type:'thought', text:'하지만 그가 마지막까지 지키려 했던 것이 무엇인지는 알 것 같았다.' },
  { type:'narration', text:'나는 하늘을 올려다봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……살아갈게.' },
  { type:'narration', text:'그리고 피로 물든 광장을 뒤로한 채 걸어갔다.' },
];
/* ---- ②(다른 전략을 생각) -> 김현재에 의한 죽음 앤딩(ep2_end9, 공용 TAIL 재사용) ---- */
const EP2_CRISIS_BATTLE_JUHEON_STRATEGIZE_LEADIN = [
  { type:'line', speaker:EP2_PLAYER, text:'안 돼.' },
  { type:'narration', text:'나는 고개를 저었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'주헌아, 널 희생시킬 수는 없어.' },
  { type:'line', speaker:JUHEON2, text:'그럼 어떻게 하려고?' },
  { type:'line', speaker:EP2_PLAYER, text:'……다른 방법을 찾아보자.' },
  { type:'narration', text:'우리는 짧은 순간 서로를 바라봤다.' },
  { type:'narration', text:'주헌도 결국 고개를 끄덕였다.' },
  { type:'line', speaker:JUHEON2, text:'좋아. 어떻게든 찾아보자.' },
  { type:'narration', text:'하지만 현실은 우리에게 고민할 시간을 주지 않았다.', stopBgm:true },
  { type:'narration', text:'쿠구구구…….', rumble:true },
  { type:'narration', text:'김현재의 마법진이 다시 거대한 빛을 뿜어냈다.' },
  { type:'line', speaker:HYUNJAE, text:'시간이 다 됐군.' },
  { type:'narration', text:'순간.' },
  { type:'narration', text:'검은 일격이 나를 향해 날아왔다.' },
  { type:'line', speaker:JUHEON2, text:'__PLAYER_NAME__!' },
  { type:'narration', text:'나는 피하려고 몸을 움직였다.' },
  { type:'narration', text:'하지만 늦었다.' },
];

function playEp2CrisisBattleJuheon(){
  // INTRO의 첫 silentEffect는 left/center만 비우고 right는 안 건드린다 - 완전히 다른 씬에서 넘어오면
  // right에 엉뚱한 인물이 잠깐 남아있을 수 있어 여기서 셋 다 확실히 비운다(신고받아 수정).
  setChars({left:null, center:null, right:null}, true);
  playQueue(EP2_CRISIS_BATTLE_JUHEON_INTRO.slice(), ()=>{
    showChoiceGeneric(EP2_CRISIS_BATTLE_JUHEON_CHOICE, (opt)=>{
      ep2JuheonStunned = opt.key === 'knockout';
      const outcome = opt.key === 'strike' ? EP2_CRISIS_BATTLE_JUHEON_STRIKE : EP2_CRISIS_BATTLE_JUHEON_KNOCKOUT;
      // 원문 s#4->s#5 경계(2라운드 진입) - 씬 번호가 바뀌므로 티켓 게이트(신고받아 추가).
      playQueue(outcome.slice(), ()=> gateNextScene('ep2_scene5_juheon', playEp2CrisisBattleJuheonRound2Intro, getEp2State()));
    });
  });
}

function playEp2CrisisBattleJuheonRound2Intro(){
  // ROUND2_INTRO 첫 줄엔 showBg/chars가 없다(1라운드에서 그대로 이어짐) - 이어하기 대비
  // 씬 시작점에 명시한다(신고받아 수정 - 안 그러면 주헌/김현재가 안 보이는 채로 시작한다). 1라운드에서
  // 주헌이 칼을 든 스탠딩(juheon_sword)으로 바뀐 뒤로는 계속 그 상태여야 하므로(요청됨) 여기서도
  // juheon이 아니라 juheon_sword로 되돌려야 한다.
  setBg('empty_ruins');
  setChars({left:'juheon_sword', center:null, right:'hyunjae'}, true);
  playQueue(EP2_CRISIS_BATTLE_JUHEON_ROUND2_INTRO.slice(), showEp2CrisisBattleJuheonRound2Choice);
}
function showEp2CrisisBattleJuheonRound2Choice(){
  showChoiceGeneric(EP2_CRISIS_BATTLE_JUHEON_ROUND2_CHOICE, (opt)=>{
    if(opt.key === 'sacrifice'){
      if(ep2JuheonStunned){
        playQueue(EP2_CRISIS_BATTLE_JUHEON_SACRIFICE_WIN.slice(), ()=> showEp2Ending('송주헌과 승리 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['송주헌과 승리 앤딩']));
      } else {
        playQueue(EP2_CRISIS_BATTLE_JUHEON_SACRIFICE_DEATH.slice(), ()=> showEp2Ending('송주헌의 희생 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['송주헌의 희생 앤딩']));
      }
    } else {
      playQueue(EP2_CRISIS_BATTLE_JUHEON_STRATEGIZE_LEADIN.concat(EP2_CRISIS_END_DEATH_TAIL), ()=> showEp2Ending('김현재에 의한 죽음 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['김현재에 의한 죽음 앤딩']));
    }
  });
}

/* ---- ⑤ 이영웅 소환 ---- */
const EP2_CRISIS_FRIEND_YEONGWOONG = [
  { type:'narration', text:'나는 다급하게 휴대폰을 꺼냈다.' },
  { type:'thought', text:'지금 이 상황을 혼자 해결할 수 있을 것 같지 않았다.' },
  { type:'narration', text:'곧바로 이영웅에게 메신저를 보냈다.', openChat:'yeongwoong' },
  { type:'chat', from:'player', text:'영웅이형! 여기로 급히 와야 할 것 같아요.' },
  { type:'chat', from:'player', text:'지금 상황은 형도 잘 아실 것 같아요.' },
  { type:'chat', from:'player', text:'주소 보내드리겠습니다.' },
  { type:'narration', text:'나는 현재 위치를 찍어 보냈다.' },
  { type:'narration', text:'메시지를 보내자마자 1이 사라졌다. 그리고 답장이 왔다.' },
  { type:'chat', from:YEONGWOONG2, text:'그래 간다..', closeChat:true },
  { type:'narration', text:'나는 휴대폰을 내려놓고 주변을 살폈다.' },
  { type:'narration', text:'검은 옷의 남자, 김현재는 여전히 아무 말 없이 나를 바라보고 있었다.' },
  { type:'narration', text:'시간이 얼마나 흘렀을까.' },
  { type:'narration', text:'멀리서 익숙한 목소리가 들렸다.' },
  { type:'line', speaker:YEONGWOONG2, text:'야! __PLAYER_NAME__!' },
  // 목소리만 들리는 시점이라 아직 스탠딩을 세우지 않고, 실제로 고개를 돌려 발견하는 이 줄에서 등장시킨다
  // - 인물이 둘일 때는 기본적으로 left+right에 대칭 배치되어야 하므로(신고받아 수정), center에
  // 혼자 있던 김현재가 여유롭게 right로 밀려나고 영웅이 left에 등장하는 연출(대사창은 그 사이
  // 자동으로 숨겨진다)이 트리거되도록 chars:{left, right}를 한 줄에 함께 지정한다
  // (tryPlayCenterSlideToSideTransition 참고).
  { type:'narration', text:'고개를 돌리자 이영웅이 숨을 헐떡이며 뛰어오고 있었다.', chars:{left:'yeongwoong', right:'hyunjae'} },
  { type:'line', speaker:YEONGWOONG2, text:'대체 무슨 일이야? 갑자기 이런 곳으로 오라고 하면…….' },
  { type:'narration', text:'영웅은 말을 멈췄다.' },
  { type:'narration', text:'눈앞에 서 있는 그를 발견했기 때문이다.' },
  { type:'line', speaker:YEONGWOONG2, text:'……뭐야, 저 사람?' },
  { type:'narration', text:'그의 표정도 처음으로 변했다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'……이영웅.' },
  { type:'line', speaker:YEONGWOONG2, text:'내 이름을 어떻게 알아?' },
  { type:'narration', text:'두 사람 사이에 묘한 긴장감이 흘렀다.' },
  { type:'thought', text:'이제부터가 진짜 시작인가…….', clearBg:true, stopBgm:true },
];

// 씬 전환 연출(요청됨): 배경이 암전된 채로 위 마지막 대사가 끝나면, 대사·스탠딩 없이 empty_plain이
// 1초간 유지되다가 큰 폭발과 함께 empty_ruins로 바뀌고, 폭발이 끝난 뒤에야 스탠딩+대사가 함께 나온다.
const EP2_CRISIS_BATTLE_YEONGWOONG_INTRO = [
  { type:'silentEffect', showBg:'empty_plain', chars:{left:null, center:null}, holdMs:1000 },
  { type:'silentEffect', showBg:'empty_ruins', noBgFade:true, explosion:'large', holdMs:900 },
  // 인물이 둘일 때는 기본적으로 left+right에 대칭 배치되어야 하므로(신고받아 수정), 김현재도 right에
  // 세운다. 아래 이 배틀 전체의 hitFlash/staggerCollapse 중 김현재를 겨냥하던 'center'도 전부
  // 'right'로 함께 맞췄다.
  { type:'narration', text:'김현재는 손을 들어 올린 채 우리를 바라봤다.', chars:{left:'yeongwoong', right:'hyunjae'} },
  { type:'narration', text:'하지만 곧 공격을 멈췄다.' },
  { type:'line', speaker:HYUNJAE, text:'……죽이기 전에 하나 묻지.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭘?' },
  { type:'line', speaker:HYUNJAE, text:'너희는 지금 세상을 보고도 아무것도 느끼지 못하나?' },
  { type:'narration', text:'김현재의 목소리는 의외로 차분했다.' },
  { type:'line', speaker:YEONGWOONG2, text:'뭘 말하고 싶은건데!' },
  { type:'line', speaker:HYUNJAE, text:'이미 멸망은 시작됐다.' },
  { type:'narration', text:'김현재가 우리를 바라봤다.' },
  { type:'line', speaker:HYUNJAE, text:'나는 단지 마지막을 조금 앞당기려는 것뿐이다. 그리고 아주 서서히 스며들도록' },
  { type:'line', speaker:EP2_PLAYER, text:'그건 네가 판단할 일이 아니야.' },
  { type:'line', speaker:EP2_PLAYER, text:'인간은 계속 잘못하지만, 그걸 고치려고도 해.' },
  { type:'narration', text:'김현재가 피식 웃었다.' },
  { type:'line', speaker:HYUNJAE, text:'그래서 바뀌었나?' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'line', speaker:HYUNJAE, text:'수십 년, 수백 년 동안 같은 문제가 반복되고 있다. 갈등은 더욱 깊어지고, 사람들은 자신과 다른 사람을 이해하려 하지 않는다.' },
  { type:'narration', text:'이영웅이 한 걸음 앞으로 나섰다.' },
  { type:'line', speaker:YEONGWOONG2, text:'그래도 살아가는 사람들에게서 선택할 권리까지 빼앗을 순 없어.' },
  { type:'narration', text:'김현재의 표정이 굳었다.' },
  { type:'line', speaker:HYUNJAE, text:'선택?' },
  { type:'line', speaker:HYUNJAE, text:'그 선택 때문에 이 세계가 여기까지 온 거다.' },
  { type:'narration', text:'나는 김현재를 똑바로 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'그렇다고 네가 모든 사람의 선택을 대신할 자격이 생기는 건 아니야.' },
  { type:'narration', text:'잠시 정적이 흘렀다.' },
  { type:'narration', text:'김현재의 손끝에서 검은 마력이 피어올랐다.', glitch:true, bgm:'2-09. CrossFire' },
  { type:'line', speaker:HYUNJAE, text:'……결국 너희도 인간의 편인가.' },
  { type:'line', speaker:EP2_PLAYER, text:'그래.' },
  { type:'narration', text:'나는 주먹을 꽉 쥐었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'적어도 나는 이 세계가 어떻게 끝날지, 내가 직접 보고 결정하겠어.' },
  { type:'narration', text:'김현재가 천천히 손을 들어 올렸다.' },
  { type:'line', speaker:HYUNJAE, text:'그렇다면 더 이상 말할 필요도 없겠군.' },
  { type:'narration', text:'주변의 공기가 무겁게 가라앉았다.' },
  { type:'line', speaker:HYUNJAE, text:'마지막으로 기회를 주겠다.' },
  { type:'line', speaker:EP2_PLAYER, text:'거절할게.' },
  { type:'narration', text:'김현재의 눈빛이 차갑게 변했다.' },
  { type:'line', speaker:HYUNJAE, text:'그럼 직접 증명해 봐라.' },
  { type:'narration', text:'그 순간, 검은 마법이 폭발했다.', explosion:'large' },
  { type:'narration', text:'나는 본능적으로 몸을 굴려 피했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'영웅이 형!' },
  { type:'line', speaker:YEONGWOONG2, text:'알아!', chars:{left:'yeongwoong_armed'} },
  { type:'narration', text:'이영웅이 바닥에 떨어진 돌멩이를 집어 김현재에게 던졌다.' },
  { type:'narration', text:'쨍!' },
  { type:'narration', text:'김현재의 주변에 마법 방어막이 생겼다.' },
  { type:'line', speaker:HYUNJAE, text:'소용없다.' },
  { type:'narration', text:'그리고 그 짧은 순간, 김현재의 시선이 이영웅에게 향했다.' },
  { type:'thought', text:'나는 갈등했다.' },
];

const EP2_CRISIS_BATTLE_YEONGWOONG_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 김현재에게 강한 타격을 준다.', key:'strike' },
    { label:'② 영웅이 형에게 우리의 기력을 회복시켜 달라고 한다.', key:'recover' },
  ],
};

const EP2_CRISIS_BATTLE_YEONGWOONG_STRIKE = [
  { type:'narration', text:'나는 이를 악물고 김현재에게 달려들었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'지금이야!' },
  { type:'narration', text:'이영웅과 함께 몸을 부딪치자 김현재의 균형이 무너졌다.' },
  { type:'line', speaker:HYUNJAE, text:'……!' },
  { type:'narration', text:'나는 그대로 주먹을 휘둘렀다.' },
  { type:'narration', text:'퍽!', impact:true, hitFlash:'right' },
  { type:'narration', text:'김현재의 몸이 몇 걸음 뒤로 밀려났다.' },
  { type:'line', speaker:EP2_PLAYER, text:'먹혔다!' },
  { type:'narration', text:'하지만 김현재는 천천히 고개를 들었다.' },
  { type:'narration', text:'입가에 묻은 피를 손등으로 닦았다.' },
  { type:'line', speaker:HYUNJAE, text:'……재미있군.' },
  { type:'narration', text:'그의 눈빛이 완전히 달라졌다.' },
  { type:'line', speaker:HYUNJAE, text:'처음부터 이 정도로 진심을 냈어야 했나.' },
  { type:'narration', text:'주변의 검은 마력이 폭발적으로 증가했다.', glitch:true },
  { type:'narration', text:'쿠구구구…….', rumble:true },
  { type:'line', speaker:HYUNJAE, text:'이제 봐주지 않겠다.' },
  { type:'thought', text:'나는 침을 삼켰다.' },
  { type:'thought', text:'방금 공격이 통했다고 좋아할 상황이 아니었다.' },
  { type:'thought', text:'오히려 지금부터가 진짜 싸움이었다.' },
];

const EP2_CRISIS_BATTLE_YEONGWOONG_RECOVER = [
  { type:'narration', text:'나는 영웅이 형을 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'형, 우리 기력부터 회복해야 할 것 같아요!' },
  { type:'line', speaker:YEONGWOONG2, text:'……그래.' },
  { type:'narration', text:'이영웅은 품에서 작은 알약 하나를 꺼냈다.' },
  { type:'narration', text:'그리고 나에게 힘껏 던졌다.' },
  { type:'line', speaker:YEONGWOONG2, text:'일단 이걸 먹어둬.' },
  { type:'narration', text:'나는 알약을 받아들었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이게 뭔데요?' },
  { type:'line', speaker:YEONGWOONG2, text:'기력을 회복시켜주는 약이야. 내 포카리스웨트에도 들어있지.' },
  { type:'narration', text:'말을 마친 영웅이 형도 자신의 알약 하나를 꺼내 그대로 씹었다.' },
  { type:'line', speaker:YEONGWOONG2, text:'너도 먹어.' },
  { type:'narration', text:'나는 잠시 망설이다가 알약을 입에 넣었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'narration', text:'꿀꺽.' },
  { type:'thought', text:'하지만 아무런 변화도 느껴지지 않았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'형…… 효과가 있는 거 맞아요?' },
  { type:'line', speaker:YEONGWOONG2, text:'조금 기다려봐.' },
  { type:'narration', text:'영웅이 형이 김현재를 바라봤다.' },
  { type:'narration', text:'그 순간.' },
  { type:'narration', text:'콰앙!', explosion:true },
  { type:'narration', text:'김현재의 마법이 다시 우리를 향해 날아왔다.' },
  { type:'line', speaker:YEONGWOONG2, text:'피해!' },
  { type:'narration', text:'나는 몸을 굴려 공격을 피했다.' },
  { type:'narration', text:'바닥이 크게 파이며 돌조각이 사방으로 튀었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'지금은 효과를 기다릴 때가 아니겠네요.' },
  { type:'line', speaker:YEONGWOONG2, text:'그래.' },
  { type:'narration', text:'영웅이 형이 주먹을 꽉 쥐었다.' },
  { type:'line', speaker:YEONGWOONG2, text:'일단 살아남자.' },
  { type:'narration', text:'김현재가 다시 마법진을 펼쳤다.' },
  { type:'narration', text:'나는 다시 자세를 잡았다.' },
  { type:'thought', text:'아직 알약의 효과는 느껴지지 않았다.' },
  { type:'thought', text:'하지만 싸움은 이제 막 시작됐을 뿐이었다.' },
];

/* ---- 2라운드: 다시 강한 타격을 노릴지, 영웅이 형에게 한 번 더 회복을 부탁할지 ---- */
const EP2_CRISIS_BATTLE_YEONGWOONG_ROUND2_INTRO = [
  { type:'narration', text:'김현재의 공격이 쉴 새 없이 이어졌다.', bgm:'2-09. CrossFire' },
  { type:'narration', text:'콰앙!', impact:true },
  { type:'line', speaker:EP2_PLAYER, text:'크윽!' },
  { type:'narration', text:'우리는 간신히 공격을 피하며 뒤로 물러났다.' },
  { type:'line', speaker:YEONGWOONG2, text:'이대로는 못 버텨!' },
  { type:'line', speaker:YEONGWOONG2, text:'__PLAYER_NAME__아, 다시 한번 해보자!' },
  { type:'narration', text:'검은 마법진이 우리 머리 위에 나타났다.' },
  { type:'narration', text:'이영웅이 나를 바라봤다.' },
  { type:'line', speaker:YEONGWOONG2, text:'결정해. 지금 시간이 없어.' },
  { type:'narration', text:'나는 주먹을 꽉 쥐었다.' },
  { type:'thought', text:'어떻게 해야 김현재에게 결정적인 공격을 가할 수 있을까.' },
  { type:'thought', text:'나는 쉽게 결정을 내릴 수 없었다.' },
];
const EP2_CRISIS_BATTLE_YEONGWOONG_ROUND2_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 김현재에게 강한 타격을 준다.', key:'strike' },
    { label:'② 영웅이 형에게 우리의 기력을 회복시켜 달라고 한다.', key:'recover' },
  ],
};
// ①(강한 타격)은 1라운드에서 무엇을 골랐든 결과가 김현재에 의한 죽음으로 동일하지만, 김현재가
// "같은 수법"(1라운드도 타격)인지 "낯선 수작"(1라운드는 회복)인지 알아보는 대사 한 줄만 다르다
// (원문 대조 확인 - 그 한 줄만 빼면 완전히 동일). ep2PlazaWandererTail과 같은 이유로 그 한 줄만
// 매개변수로 받는 공용 함수로 뺀다.
function ep2YeongwoongStrikeDeathLeadin(hyunjaeLine){
  return [
    { type:'narration', text:'나는 이를 악물고 김현재에게 달려들었다.' },
    { type:'line', speaker:EP2_PLAYER, text:'지금이다!' },
    { type:'narration', text:'하지만 김현재는 이미 내 움직임을 읽고 있었다.' },
    { type:'line', speaker:HYUNJAE, text:hyunjaeLine },
    { type:'narration', text:'그가 몸을 틀어 내 공격을 가볍게 피했다.' },
    { type:'line', speaker:EP2_PLAYER, text:'……!' },
    { type:'narration', text:'순간, 그의 손끝에서 검은빛이 폭발했다.', explosion:'large', stopBgm:true },
    { type:'narration', text:'검은 일격이 나를 향해 날아왔다.' },
    { type:'line', speaker:YEONGWOONG2, text:'__PLAYER_NAME__!' },
    { type:'narration', text:'나는 피하려고 몸을 움직였다.' },
    { type:'narration', text:'하지만 늦었다.' },
  ];
}
/* ---- ②(회복)+1라운드 강한 타격(데미지O) -> 이영웅과 승리 앤딩(ep2_end6) ---- */
const EP2_CRISIS_BATTLE_YEONGWOONG_RECOVER_WIN = [
  { type:'narration', text:'나는 다시 영웅이 형을 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'형, 한 번 더 회복할 수 있어요?' },
  { type:'narration', text:'영웅이 형은 잠시 나를 바라봤다.' },
  { type:'line', speaker:YEONGWOONG2, text:'이번에는 제대로 버텨보자.' },
  { type:'narration', text:'알약을 삼키자 조금씩 몸에 힘이 돌아오기 시작했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……효과가 온다.' },
  { type:'narration', text:'영웅이 형도 고개를 끄덕였다.' },
  { type:'line', speaker:YEONGWOONG2, text:'좋아. 이번엔 같이 간다.' },
  { type:'narration', text:'우리는 서로 눈을 마주쳤다.' },
  { type:'narration', text:'그리고 동시에 김현재를 향해 달려들었다.' },
  { type:'narration', text:'김현재가 마법진을 펼쳤지만, 이번에는 쉽게 물러서지 않았다.' },
  { type:'narration', text:'영웅이 형이 그의 공격을 받아내는 사이 나는 빈틈을 파고들었다.' },
  { type:'line', speaker:YEONGWOONG2, text:'지금!' },
  { type:'narration', text:'콰앙!', impact:true, hitFlash:'right' },
  { type:'narration', text:'우리의 공격이 동시에 적중했다.' },
  { type:'narration', text:'김현재가 크게 휘청거렸다.' },
  { type:'line', speaker:HYUNJAE, text:'크윽……!' },
  { type:'narration', text:'나는 마지막 힘을 다해 검을 휘둘렀다.' },
  { type:'narration', text:'영웅이 형의 공격이 이어졌다.' },
  { type:'narration', text:'결국 김현재는 균형을 잃고 바닥에 쓰러졌다.', staggerCollapse:'right', stopBgm:true },
  { type:'line', speaker:YEONGWOONG2, text:'……해냈어.' },
  { type:'narration', text:'영웅이 형이 거칠게 숨을 내쉬었다.' },
  { type:'narration', text:'나는 쓰러진 김현재를 바라봤다.' },
  { type:'narration', text:'김현재가 쓰러진 뒤, 세상은 거짓말처럼 조용해졌다.' },
  { type:'narration', text:'꺼져 있던 전자기기들이 하나둘 다시 켜졌다.' },
  { type:'narration', text:'정전도 끝났다.' },
  { type:'narration', text:'뉴스에서는 원인을 알 수 없는 전 세계적인 정전 사태가 발생했다고 보도했지만, 누구도 그 진실을 알 수 없었다.' },
  { type:'narration', text:'이영웅은 한껏 들뜬 모습으로 하늘을 바라봤다.', showBg:'end6', chars:{left:null, center:null, right:null}, bgm:'1-14. Sugar story' },
  { type:'line', speaker:YEONGWOONG2, text:'이겼어! 우리가 이겼다고!!', emphasis:true },
  { type:'line', speaker:EP2_PLAYER, text:'네. 형…….' },
  { type:'narration', text:'나는 천천히 주변을 둘러봤다.' },
  { type:'narration', text:'무너질 것 같았던 세계가 다시 제자리로 돌아가고 있었다.' },
  { type:'narration', text:'사람들은 다시 일상으로 돌아갔다.' },
  { type:'narration', text:'누군가는 가족에게 전화를 걸었고, 누군가는 길거리에서 서로를 도왔다.' },
  { type:'narration', text:'물론 세상의 문제들이 전부 사라진 것은 아니었다.' },
  { type:'narration', text:'갈등도, 불평도, 서로를 이해하지 못하는 일도 여전히 존재했다.' },
  { type:'narration', text:'하지만 적어도 이제 그것을 바꿀 기회는 남아 있었다.' },
  { type:'narration', text:'이영웅이 내 어깨를 두드렸다.' },
  { type:'line', speaker:YEONGWOONG2, text:'우리 케미가 진짜 미쳤지 않냐? ㅋㅋ.' },
  { type:'narration', text:'나는 고개를 저었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'아뇨. 형이 다 한걸요.' },
  { type:'narration', text:'잠시 생각하다 웃었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'저 혼자서는 아무것도 못 했을 거예요.' },
  { type:'narration', text:'나는 하늘을 바라봤다.' },
  { type:'narration', text:'세계는 완벽하지 않았다.' },
  { type:'narration', text:'하지만 살아갈 수 있었다.' },
  { type:'thought', text:'멸망을 막는다는 건 세상을 완벽하게 만드는 것이 아니라, 사람들이 다시 한번 서로를 선택할 수 있도록 기회를 남겨두는 것일지도 모른다.' },
  { type:'narration', text:'그날 이후.' },
  { type:'narration', text:'나는 평범한 일상으로 돌아갔다.' },
  { type:'narration', text:'조금은 달라진 세상에서.' },
  { type:'narration', text:'그리고 조금은 달라진 나 자신과 함께.' },
];
/* ---- ②(회복)+1라운드도 회복(데미지 없음) -> 비운의 저항자 앤딩(ep2_end2, 공용 TAIL 재사용) ---- */
const EP2_CRISIS_BATTLE_YEONGWOONG_RECOVER_RESIST_LEADIN = [
  { type:'narration', text:'나는 다시 영웅이 형을 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'형, 한 번 더 회복할 수 있어요?' },
  { type:'narration', text:'영웅이 형은 잠시 나를 바라봤다.' },
  { type:'narration', text:'하지만 그 순간.' },
  { type:'narration', text:'김현재가 낮게 웃었다.' },
  { type:'line', speaker:HYUNJAE, text:'그렇게 버틸 셈인가…….' },
  { type:'line', speaker:EP2_PLAYER, text:'……!' },
  { type:'narration', text:'김현재의 손끝에 검은 마법진이 나타났다.' },
  { type:'line', speaker:HYUNJAE, text:'끝없는 싸움에서 인간이 할 수 있는 건 결국 한계가 있다.' },
  { type:'narration', text:'검은빛이 천천히 퍼져나갔다.' },
  { type:'line', speaker:HYUNJAE, text:'차라리 모두 잊어버리는 게 편할 것이다.' },
  { type:'line', speaker:EP2_PLAYER, text:'잠깐……!' },
  { type:'narration', text:'검은 마법이 우리를 덮쳤다.', explosion:'large', stopBgm:true },
  { type:'narration', text:'순간 머리가 깨질 듯 아파왔다.' },
  { type:'narration', text:'눈앞의 모든 것이 흐려졌다.' },
  { type:'narration', text:'김현재의 모습도.' },
  { type:'narration', text:'영웅이 형의 모습도.' },
  { type:'narration', text:'그리고 지금까지 내가 겪었던 모든 일이 하나씩 사라지기 시작했다.', whiteout:true, se:'SE_Vanish_01' },
];

function playEp2CrisisBattleYeongwoong(){
  // INTRO의 첫 silentEffect는 left/center만 비우고 right는 안 건드린다 - 완전히 다른 씬에서 넘어오면
  // right에 엉뚱한 인물이 잠깐 남아있을 수 있어 여기서 셋 다 확실히 비운다(신고받아 수정).
  setChars({left:null, center:null, right:null}, true);
  playQueue(EP2_CRISIS_BATTLE_YEONGWOONG_INTRO.slice(), ()=>{
    showChoiceGeneric(EP2_CRISIS_BATTLE_YEONGWOONG_CHOICE, (opt)=>{
      ep2YeongwoongDamageDealt = opt.key === 'strike';
      const outcome = opt.key === 'strike' ? EP2_CRISIS_BATTLE_YEONGWOONG_STRIKE : EP2_CRISIS_BATTLE_YEONGWOONG_RECOVER;
      // 원문 s#4->s#5 경계(2라운드 진입) - 씬 번호가 바뀌므로 티켓 게이트(신고받아 추가).
      playQueue(outcome.slice(), ()=> gateNextScene('ep2_scene5_yeongwoong', playEp2CrisisBattleYeongwoongRound2Intro, getEp2State()));
    });
  });
}

function playEp2CrisisBattleYeongwoongRound2Intro(){
  // ROUND2_INTRO 첫 줄엔 showBg/chars가 없다(1라운드에서 그대로 이어짐) - 이어하기 대비
  // 씬 시작점에 명시한다(신고받아 수정 - 안 그러면 영웅/김현재가 안 보이는 채로 시작한다). 1라운드에서
  // 영웅이 무장한 스탠딩(yeongwoong_armed)으로 바뀐 뒤로는 계속 그 상태여야 하므로(요청됨) 여기서도
  // yeongwoong이 아니라 yeongwoong_armed로 되돌려야 한다.
  setBg('empty_ruins');
  setChars({left:'yeongwoong_armed', center:null, right:'hyunjae'}, true);
  playQueue(EP2_CRISIS_BATTLE_YEONGWOONG_ROUND2_INTRO.slice(), showEp2CrisisBattleYeongwoongRound2Choice);
}
function showEp2CrisisBattleYeongwoongRound2Choice(){
  showChoiceGeneric(EP2_CRISIS_BATTLE_YEONGWOONG_ROUND2_CHOICE, (opt)=>{
    if(opt.key === 'strike'){
      const hyunjaeLine = ep2YeongwoongDamageDealt ? '같은 수법은 통하지 않는다.' : '나에게 그런 수작은 통하지 않는다.';
      playQueue(ep2YeongwoongStrikeDeathLeadin(hyunjaeLine).concat(EP2_CRISIS_END_DEATH_TAIL), ()=> showEp2Ending('김현재에 의한 죽음 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['김현재에 의한 죽음 앤딩']));
    } else if(ep2YeongwoongDamageDealt){
      playQueue(EP2_CRISIS_BATTLE_YEONGWOONG_RECOVER_WIN.slice(), ()=> showEp2Ending('이영웅과 승리 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['이영웅과 승리 앤딩']));
    } else {
      playQueue(EP2_CRISIS_BATTLE_YEONGWOONG_RECOVER_RESIST_LEADIN.concat(EP2_CRISIS_END_RESISTER_TAIL), ()=> showEp2Ending('비운의 저항자 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['비운의 저항자 앤딩']));
    }
  });
}

/* ---- ⑥ 강승유 소환 ---- */
const EP2_CRISIS_FRIEND_SEUNGYU = [
  { type:'narration', text:'나는 다급하게 휴대폰을 꺼냈다.' },
  { type:'thought', text:'지금 이 상황을 혼자 해결할 수 있을 것 같지 않았다.' },
  { type:'narration', text:'곧바로 강승유에게 메신저를 보냈다.', openChat:'seungyu' },
  { type:'chat', from:'player', text:'승유야! 여기로 급히 와야 할 것 같아 지금 당장!' },
  { type:'chat', from:'player', text:'지금 상황은 너도 잘 알고 있지?' },
  { type:'chat', from:'player', text:'주소 보낼게.' },
  { type:'narration', text:'나는 현재 위치를 찍어 보냈다.' },
  { type:'narration', text:'메시지를 보내자마자 1이 사라졌다. 그리고 답장이 왔다.' },
  { type:'chat', from:SEUNGYU2, text:'뭔데 그래? 일단 바로 달려갈게.', closeChat:true },
  { type:'narration', text:'나는 휴대폰을 내려놓고 주변을 살폈다.' },
  { type:'narration', text:'검은 옷의 남자, 김현재는 여전히 아무 말 없이 나를 바라보고 있었다.' },
  { type:'narration', text:'시간이 얼마나 흘렀을까.' },
  { type:'narration', text:'멀리서 익숙한 목소리가 들렸다.' },
  { type:'line', speaker:SEUNGYU2, text:'야! __PLAYER_NAME__!' },
  // 목소리만 들리는 시점이라 아직 스탠딩을 세우지 않고, 실제로 고개를 돌려 발견하는 이 줄에서 등장시킨다
  // - 인물이 둘일 때는 기본적으로 left+right에 대칭 배치되어야 하므로(신고받아 수정), center에
  // 혼자 있던 김현재가 여유롭게 right로 밀려나고 승유가 left에 등장하는 연출(대사창은 그 사이
  // 자동으로 숨겨진다)이 트리거되도록 chars:{left, right}를 한 줄에 함께 지정한다
  // (tryPlayCenterSlideToSideTransition 참고).
  { type:'narration', text:'고개를 돌리자 강승유가 숨을 헐떡이며 뛰어오고 있었다.', chars:{left:'seungyu', right:'hyunjae'} },
  { type:'line', speaker:SEUNGYU2, text:'대체 무슨 일이야? 갑자기 이런 곳으로 오라고 하면…….' },
  { type:'narration', text:'승유는 말을 멈췄다.' },
  { type:'narration', text:'눈앞에 서 있는 그를 발견했기 때문이다.' },
  { type:'line', speaker:SEUNGYU2, text:'……뭐야, 저 사람?' },
  { type:'narration', text:'그의 표정도 처음으로 변했다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'……강승유.' },
  { type:'line', speaker:SEUNGYU2, text:'내 이름을 어떻게 알아?' },
  { type:'narration', text:'두 사람 사이에 묘한 긴장감이 흘렀다.' },
  { type:'thought', text:'이제부터가 진짜 시작인가…….', clearBg:true, stopBgm:true },
];

// 씬 전환 연출(요청됨): 배경이 암전된 채로 위 마지막 대사가 끝나면, 대사·스탠딩 없이 empty_plain이
// 1초간 유지되다가 큰 폭발과 함께 empty_ruins로 바뀌고, 폭발이 끝난 뒤에야 스탠딩+대사가 함께 나온다.
const EP2_CRISIS_BATTLE_SEUNGYU_INTRO = [
  { type:'silentEffect', showBg:'empty_plain', chars:{left:null, center:null}, holdMs:1000 },
  { type:'silentEffect', showBg:'empty_ruins', noBgFade:true, explosion:'large', holdMs:900 },
  // 인물이 둘일 때는 기본적으로 left+right에 대칭 배치되어야 하므로(신고받아 수정), 김현재도 right에
  // 세운다. 아래 이 배틀 전체의 hitFlash/staggerCollapse 중 김현재를 겨냥하던 'center'도 전부
  // 'right'로 함께 맞췄다.
  { type:'narration', text:'김현재는 손을 들어 올린 채 우리를 바라봤다.', chars:{left:'seungyu', right:'hyunjae'} },
  { type:'narration', text:'하지만 곧 공격을 멈췄다.' },
  { type:'line', speaker:HYUNJAE, text:'……죽이기 전에 하나 묻지.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭘?' },
  { type:'line', speaker:HYUNJAE, text:'너희는 지금 세상을 보고도 아무것도 느끼지 못하나?' },
  { type:'narration', text:'김현재의 목소리는 의외로 차분했다.' },
  { type:'line', speaker:SEUNGYU2, text:'뭘 말하고 싶은건데!' },
  { type:'line', speaker:HYUNJAE, text:'이미 멸망은 시작됐다.' },
  { type:'narration', text:'김현재가 우리를 바라봤다.' },
  { type:'line', speaker:HYUNJAE, text:'나는 단지 마지막을 조금 앞당기려는 것뿐이다. 그리고 아주 서서히 스며들도록' },
  { type:'line', speaker:EP2_PLAYER, text:'그건 네가 판단할 일이 아니야.' },
  { type:'line', speaker:EP2_PLAYER, text:'인간은 계속 잘못하지만, 그걸 고치려고도 해.' },
  { type:'narration', text:'김현재가 피식 웃었다.' },
  { type:'line', speaker:HYUNJAE, text:'그래서 바뀌었나?' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'line', speaker:HYUNJAE, text:'수십 년, 수백 년 동안 같은 문제가 반복되고 있다. 갈등은 더욱 깊어지고, 사람들은 자신과 다른 사람을 이해하려 하지 않는다.' },
  { type:'line', speaker:SEUNGYU2, text:'그래도 살아가는 사람들에게서 선택할 권리까지 빼앗을 순 없어.' },
  { type:'narration', text:'김현재의 표정이 굳었다.' },
  { type:'line', speaker:HYUNJAE, text:'선택?' },
  { type:'narration', text:'그가 낮게 말했다.' },
  { type:'narration', text:'나는 김현재를 똑바로 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'그렇다고 네가 모든 사람의 선택을 대신할 자격이 생기는 건 아니야.' },
  { type:'narration', text:'잠시 정적이 흘렀다.' },
  { type:'narration', text:'김현재의 손끝에서 검은 마력이 피어올랐다.', glitch:true, bgm:'2-09. CrossFire' },
  { type:'line', speaker:HYUNJAE, text:'……결국 너희도 인간의 편인가.' },
  { type:'line', speaker:EP2_PLAYER, text:'그래.' },
  { type:'narration', text:'나는 주먹을 꽉 쥐었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'적어도 나는 이 세계가 어떻게 끝날지, 내가 직접 보고 결정하겠어.' },
  { type:'narration', text:'김현재가 천천히 손을 들어 올렸다.' },
  { type:'line', speaker:HYUNJAE, text:'그렇다면 더 이상 말할 필요도 없겠군.' },
  { type:'narration', text:'주변의 공기가 무겁게 가라앉았다.' },
  { type:'line', speaker:HYUNJAE, text:'마지막으로 기회를 주겠다.' },
  { type:'line', speaker:EP2_PLAYER, text:'거절한다.' },
  { type:'narration', text:'김현재의 눈빛이 차갑게 변했다.' },
  { type:'line', speaker:HYUNJAE, text:'그럼 직접 증명해 봐라.' },
  { type:'narration', text:'그 순간, 검은 마법이 폭발했다.', explosion:'large' },
  { type:'narration', text:'나는 본능적으로 몸을 굴려 피했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'승유야!' },
  { type:'line', speaker:SEUNGYU2, text:'알아!' },
  { type:'narration', text:'강승유가 바닥에 떨어진 돌멩이를 집어 김현재에게 던졌다.' },
  { type:'narration', text:'쨍!' },
  { type:'narration', text:'김현재의 주변에 마법 방어막이 생겼다.' },
  { type:'line', speaker:HYUNJAE, text:'소용없다.' },
  { type:'narration', text:'그리고 그 짧은 순간, 김현재의 시선이 강승유에게 향했다.' },
  { type:'thought', text:'나는 갈등했다.' },
];

const EP2_CRISIS_BATTLE_SEUNGYU_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 김현재에게 강한 타격을 준다.', key:'strike' },
    { label:'② 강승유에게 복싱 기술을 선보이라고 한다.', key:'boxing' },
  ],
};

const EP2_CRISIS_BATTLE_SEUNGYU_STRIKE = [
  { type:'narration', text:'나는 이를 악물고 김현재에게 달려들었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'지금이야!' },
  { type:'narration', text:'강승유와 함께 몸을 부딪치자 김현재의 균형이 무너졌다.' },
  { type:'line', speaker:HYUNJAE, text:'……!' },
  { type:'narration', text:'나는 그대로 주먹을 휘둘렀다.' },
  { type:'narration', text:'퍽!', impact:true, hitFlash:'right', stopBgm:true },
  { type:'narration', text:'김현재의 몸이 몇 걸음 뒤로 밀려났다.' },
  { type:'line', speaker:EP2_PLAYER, text:'먹혔다!' },
  { type:'narration', text:'하지만 김현재는 천천히 고개를 들었다.' },
  { type:'narration', text:'입가에 묻은 피를 손등으로 닦았다.' },
  { type:'line', speaker:HYUNJAE, text:'……재미있군.' },
  { type:'narration', text:'그의 눈빛이 완전히 달라졌다.' },
  { type:'line', speaker:HYUNJAE, text:'처음부터 이 정도로 진심을 냈어야 했나.' },
  { type:'narration', text:'주변의 검은 마력이 폭발적으로 증가했다.', glitch:true },
  { type:'narration', text:'쿠구구구…….', rumble:true },
  { type:'line', speaker:HYUNJAE, text:'이제 봐주지 않겠다.' },
  { type:'thought', text:'나는 침을 삼켰다.' },
  { type:'thought', text:'방금 공격이 통했다고 좋아할 상황이 아니었다.' },
  { type:'thought', text:'오히려 지금부터가 진짜 싸움이었다.' },
];

const EP2_CRISIS_BATTLE_SEUNGYU_BOXING = [
  { type:'narration', text:'나는 강승유를 바라봤다.' },
  { type:'thought', text:'김현재의 시선이 승유에게 향한 지금이 기회였다.' },
  { type:'line', speaker:EP2_PLAYER, text:'승유야!' },
  { type:'line', speaker:SEUNGYU2, text:'왜?' },
  { type:'line', speaker:EP2_PLAYER, text:'복싱 기술…… 보여줄 수 있어?' },
  { type:'narration', text:'승유가 잠시 나를 바라봤다.' },
  { type:'narration', text:'그리고 피식 웃었다.' },
  { type:'line', speaker:HYUNJAE, text:'이제야 내 차례네.' },
  { type:'narration', text:'김현재가 손을 들어 올렸다.' },
  { type:'line', speaker:SEUNGYU2, text:'무슨 수작이지?' },
  { type:'narration', text:'순간 검은 마법이 폭발했다.', explosion:true },
  { type:'narration', text:'쾅!' },
  { type:'narration', text:'하지만 승유는 뒤로 물러나지 않았다.' },
  { type:'narration', text:'왼쪽.' },
  { type:'narration', text:'오른쪽.' },
  { type:'narration', text:'그리고 다시 왼쪽.' },
  { type:'narration', text:'빠른 스탭으로 마법의 궤적을 절묘하게 피해냈다.' },
  { type:'line', speaker:HYUNJAE, text:'……뭐?' },
  { type:'narration', text:'김현재가 당황한 순간.' },
  { type:'narration', text:'승유가 그대로 거리를 좁혔다.' },
  { type:'line', speaker:SEUNGYU2, text:'간다!' },
  { type:'narration', text:'퍽!', impact:true, hitFlash:'right' },
  { type:'narration', text:'왼손이 정확히 김현재의 얼굴에 꽂혔다.' },
  { type:'narration', text:'그리고 곧바로 이어지는 오른손.' },
  { type:'narration', text:'퍽!', impact:true, hitFlash:'right' },
  { type:'narration', text:'원투 펀치가 정확하게 적중했다.' },
  { type:'narration', text:'김현재의 몸이 크게 휘청거렸다.' },
  { type:'line', speaker:HYUNJAE, text:'크……윽…….' },
  { type:'narration', text:'승유는 멈추지 않았다.' },
  { type:'line', speaker:SEUNGYU2, text:'아직 끝난 거 아니야!' },
  { type:'narration', text:'마지막 주먹이 김현재의 턱을 강하게 올려쳤다.' },
  { type:'narration', text:'퍽!', impact:true, hitFlash:'right', cameraPunch:true, stopBgm:true },
  { type:'narration', text:'김현재의 눈이 풀렸다.' },
  { type:'line', speaker:HYUNJAE, text:'…….' },
  { type:'narration', text:'털썩.', staggerCollapse:'right' },
  { type:'narration', text:'그는 그대로 바닥에 쓰러졌다.' },
  { type:'narration', text:'나는 믿기지 않는 표정으로 승유를 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……기절한 거야?' },
  { type:'narration', text:'승유가 주먹을 털며 말했다.' },
  { type:'line', speaker:SEUNGYU2, text:'응.' },
  { type:'narration', text:'그리고 쓰러진 김현재를 내려다봤다.' },
  { type:'line', speaker:SEUNGYU2, text:'마법사라고 주먹까지 강한 건 아니잖아.' },
  { type:'narration', text:'나는 어이가 없어 웃었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……그건 맞네.' },
];

// 승유의 1라운드 선택(강한 타격/복싱)은 다른 두 소환 전투와 마찬가지로 곧장 결말로 가지 않고 항상
// 2라운드로 이어진다(요청받아 수정 - 이전엔 복싱을 곧장 승리로 끝냈었다). 다만 원문에 1라운드 선택이
// 2라운드 결과에 영향을 준다는 근거가 없어서(요청받아 재수정 - 한때 강한 타격을 줬으면 2라운드 선택과
// 무관하게 죽음 앤딩으로 강제하는 안을 시도했다가, 원문에 없는 내용이라 되돌렸다), 1라운드 선택은
// 순수하게 연출(리드인 대사)만 다르고 결과에는 전혀 관여하지 않는다 - 2라운드 선택(성대모사/준비태세)
// 만으로 승리/저항자 배드엔드가 갈린다.
function playEp2CrisisBattleSeungyu(){
  // INTRO의 첫 silentEffect는 left/center만 비우고 right는 안 건드린다 - 완전히 다른 씬에서 넘어오면
  // right에 엉뚱한 인물이 잠깐 남아있을 수 있어 여기서 셋 다 확실히 비운다(신고받아 수정).
  setChars({left:null, center:null, right:null}, true);
  playQueue(EP2_CRISIS_BATTLE_SEUNGYU_INTRO.slice(), ()=>{
    showChoiceGeneric(EP2_CRISIS_BATTLE_SEUNGYU_CHOICE, (opt)=>{
      const outcome = opt.key === 'boxing' ? EP2_CRISIS_BATTLE_SEUNGYU_BOXING : EP2_CRISIS_BATTLE_SEUNGYU_STRIKE;
      // 원문 s#4->s#5 경계(2라운드 진입) - 씬 번호가 바뀌므로 티켓 게이트(신고받아 추가).
      playQueue(outcome.slice(), ()=> gateNextScene('ep2_scene5_seungyu', playEp2CrisisBattleSeungyuRound2Intro, getEp2State()));
    });
  });
}

/* ---- 2라운드(강한 타격 경로 전용): 승유에게 성대모사를 시킬지, 준비태세만 갖추게 할지 ---- */
const EP2_CRISIS_BATTLE_SEUNGYU_ROUND2_INTRO = [
  { type:'narration', text:'그렇게 꽤 많은 시간이 지나갔다.' },
  { type:'narration', text:'다시는 일어날 것 같지 않던 김현재가 더 각성한 모습으로 일어났다.', bgm:'2-03. NRG FielD', chars:{right:'hyunjae'} },
  { type:'narration', text:'그리고 김현재의 공격이 쉴 새 없이 이어졌다.' },
  { type:'narration', text:'콰앙!', impact:true },
  { type:'line', speaker:EP2_PLAYER, text:'크윽!' },
  { type:'narration', text:'우리는 간신히 공격을 피하며 뒤로 물러났다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이대로는 못 버텨!' },
  { type:'narration', text:'강승유가 숨을 고르며 말했다.' },
  { type:'line', speaker:SEUNGYU2, text:'__PLAYER_NAME__, 다시 한번 해보자!' },
  { type:'narration', text:'검은 마법진이 우리 머리 위에 나타났다.' },
  { type:'narration', text:'강승유가 나를 바라봤다.' },
  { type:'line', speaker:SEUNGYU2, text:'결정해. 지금 시간이 없어.' },
  { type:'narration', text:'나는 주먹을 꽉 쥐었다.' },
  { type:'thought', text:'어떻게 해야 김현재에게 결정적인 공격을 가할 수 있을까.' },
  { type:'thought', text:'나는 쉽게 결정을 내릴 수 없었다.' },
];
const EP2_CRISIS_BATTLE_SEUNGYU_ROUND2_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 승유에게 준비태세를 갖추라고 한다.', key:'brace' },
    { label:'② 승유에게 성대모사를 시킨다.', key:'mimic' },
  ],
};
/* ---- ①(준비태세, 소극적 대응) -> 비운의 저항자 앤딩(ep2_end2, 공용 TAIL 재사용) ---- */
const EP2_CRISIS_BATTLE_SEUNGYU_BRACE_RESIST_LEADIN = [
  { type:'narration', text:'나는 다시 강승유를 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'준비태세를 갖춰!!', emphasis:true },
  { type:'narration', text:'강승유는 잠시 나를 바라봤다.' },
  { type:'narration', text:'하지만 그 순간.' },
  { type:'narration', text:'김현재가 낮게 웃었다.' },
  { type:'line', speaker:HYUNJAE, text:'그렇게 버틸 셈인가…….' },
  { type:'line', speaker:EP2_PLAYER, text:'……!' },
  { type:'narration', text:'김현재의 손끝에 검은 마법진이 나타났다.' },
  { type:'line', speaker:HYUNJAE, text:'끝없는 싸움에서 인간이 할 수 있는 건 결국 한계가 있다.' },
  { type:'narration', text:'검은빛이 천천히 퍼져나갔다.' },
  { type:'line', speaker:HYUNJAE, text:'차라리 모두 잊어버리는 게 편할 것이다.' },
  { type:'line', speaker:EP2_PLAYER, text:'잠깐……!' },
  { type:'narration', text:'검은 마법이 우리를 덮쳤다.', explosion:'large', stopBgm:true },
  { type:'narration', text:'순간 머리가 깨질 듯 아파왔다.' },
  { type:'narration', text:'눈앞의 모든 것이 흐려졌다.' },
  { type:'narration', text:'김현재의 모습도.' },
  { type:'narration', text:'강승유의 모습도.' },
  { type:'narration', text:'그리고 지금까지 내가 겪었던 모든 기억도.', whiteout:true, se:'SE_Vanish_01' },
];
/* ---- ②(성대모사) -> 강승유와의 승리 앤딩(ep2_end7) ---- */
const EP2_CRISIS_BATTLE_SEUNGYU_MIMIC_WIN = [
  { type:'narration', text:'검은 마법진이 우리 머리 위에 나타났다.' },
  { type:'narration', text:'나는 김현재를 바라보다 문득 한 가지 생각이 떠올랐다.' },
  { type:'line', speaker:EP2_PLAYER, text:'승유야.', stopBgm:true },
  { type:'line', speaker:SEUNGYU2, text:'응?' },
  { type:'line', speaker:EP2_PLAYER, text:'성대모사 해봐.' },
  { type:'line', speaker:SEUNGYU2, text:'……뭐?' },
  { type:'line', speaker:EP2_PLAYER, text:'김현재 성대모사.' },
  { type:'line', speaker:SEUNGYU2, text:'지금 이 상황에서?' },
  { type:'line', speaker:EP2_PLAYER, text:'그래. 최대한 똑같이.' },
  { type:'narration', text:'승유는 잠시 김현재를 바라보더니 목소리를 낮췄다.' },
  { type:'line', speaker:SEUNGYU2, text:'……인간은 결국 멸망할 운명이다.' },
  { type:'narration', text:'나는 소름이 돋았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'똑같아.' },
  { type:'narration', text:'김현재가 순간 움직임을 멈췄다.' },
  { type:'line', speaker:HYUNJAE, text:'……뭐?' },
  { type:'narration', text:'승유는 다시 김현재의 목소리를 흉내 냈다.' },
  { type:'line', speaker:SEUNGYU2, text:'멸망의 마법을 해제한다.' },
  { type:'narration', text:'그러자 김현재의 마법진이 순간적으로 흔들렸다.' },
  { type:'line', speaker:HYUNJAE, text:'……!' },
  { type:'narration', text:'나는 깨달았다.' },
  { type:'thought', text:'김현재의 마법은 단순한 의지만으로 움직이는 게 아니었다.', bgm:'Hello SY'  },
  { type:'thought', text:'일부 명령은 그의 목소리를 통해 발동되고 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'승유야! 계속해!' },
  { type:'narration', text:'승유는 곧바로 김현재의 목소리를 흉내 냈다.' },
  { type:'line', speaker:SEUNGYU2, text:'방어 마법 해제.' },
  { type:'narration', text:'철컥.' },
  { type:'narration', text:'김현재의 방어막이 사라졌다.' },
  { type:'line', speaker:HYUNJAE, text:'이게…… 무슨!' },
  { type:'line', speaker:SEUNGYU2, text:'지금!' },
  { type:'narration', text:'나는 망설이지 않고 달려들었다.' },
  { type:'narration', text:'그리고 그대로 김현재에게 강한 일격을 날렸다.' },
  { type:'narration', text:'콰앙!', impact:true, hitFlash:'right' },
  { type:'narration', text:'김현재의 몸이 뒤로 날아갔다.' },
  { type:'line', speaker:HYUNJAE, text:'크아악!' },
  { type:'narration', text:'그는 바닥을 굴렀다.', staggerCollapse:'right' },
  { type:'narration', text:'승유가 숨을 헐떡이며 말했다.', showBg:'end7', chars:{left:null, center:null, right:null} },
  { type:'line', speaker:SEUNGYU2, text:'……이래서 성대모사가 중요하다니까.' },
  { type:'narration', text:'나는 어이가 없어 웃었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'그게 복싱보다 강할 줄은 몰랐네.' },
  { type:'narration', text:'김현재는 분노에 찬 얼굴로 천천히 일어났다.' },
  { type:'line', speaker:HYUNJAE, text:'감히…… 내 목소리를…….' },
  { type:'narration', text:'하지만 이미 늦었다.' },
  { type:'narration', text:'우리는 그의 약점을 알아냈다.' },
  { type:'narration', text:'그 뒤로는 말도 안 되게 순탄했다.' },
  { type:'narration', text:'마법을 제대로 쓸 줄 모르는 마법사는 그저 이빨 빠진 호랑이에 불과했다.' },
  { type:'narration', text:'그렇게 김현재를 쓰러뜨렸다.' },
  { type:'narration', text:'김현재가 쓰러진 뒤, 세상은 거짓말처럼 조용해졌다.' },
  { type:'narration', text:'꺼져 있던 전자기기들이 하나둘 다시 켜졌다.' },
  { type:'narration', text:'정전도 끝났다.' },
  { type:'narration', text:'뉴스에서는 원인을 알 수 없는 전 세계적인 정전 사태가 발생했다고 보도했지만, 누구도 그 진실을 알 수 없었다.' },
  // 원문에서 승유의 대사가 "복싱 챔피언"과 "성대모사" 둘 다를 언급하며 마무리되는데, 그건 성대모사로
  // 이겼을 때만 성립하는 농담이라(복싱으로 이미 이겼다면 앞뒤가 안 맞는다) 성대모사 승리 전용 마무리다.
  { type:'narration', text:'승유는 한동안 말없이 하늘을 바라봤다.' },
  { type:'line', speaker:SEUNGYU2, text:'…….' },
  { type:'line', speaker:EP2_PLAYER, text:'힘들었다.' },
  { type:'narration', text:'나는 천천히 주변을 둘러봤다.' },
  { type:'narration', text:'무너질 것 같았던 세계가 다시 제자리로 돌아가고 있었다.' },
  { type:'narration', text:'사람들은 다시 일상으로 돌아갔다.' },
  { type:'narration', text:'누군가는 가족에게 전화를 걸었고, 누군가는 길거리에서 서로를 도왔다.' },
  { type:'narration', text:'물론 세상의 문제들이 전부 사라진 것은 아니었다.' },
  { type:'narration', text:'갈등도, 불평도, 서로를 이해하지 못하는 일도 여전히 존재했다.' },
  { type:'narration', text:'하지만 적어도 이제 그것을 바꿀 기회는 남아 있었다.' },
  { type:'narration', text:'승유가 내 어깨를 두드렸다.' },
  { type:'line', speaker:SEUNGYU2, text:'어때 이 복싱 챔피언의 힘이 ㅋㅋ.' },
  { type:'narration', text:'나는 고개를 저었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'아니 성대모사로 이긴거잖아 ㅋㅋ.' },
  { type:'narration', text:'잠시 생각하다 웃었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'그래도 네가 있어서 이리 될 수 있었던 것 같다…….' },
  { type:'narration', text:'나는 하늘을 바라봤다.' },
  { type:'narration', text:'세계는 완벽하지 않았다.' },
  { type:'narration', text:'하지만 살아갈 수 있었다.' },
  { type:'thought', text:'멸망을 막는다는 건 세상을 완벽하게 만드는 것이 아니라, 사람들이 다시 한번 서로를 선택할 수 있도록 기회를 남겨두는 것일지도 모른다.' },
  { type:'narration', text:'그날 이후.' },
  { type:'narration', text:'나는 평범한 일상으로 돌아갔다.' },
  { type:'narration', text:'조금은 달라진 세상에서.' },
  { type:'narration', text:'그리고 조금은 달라진 나 자신과 함께.' },
];

function playEp2CrisisBattleSeungyuRound2Intro(){
  // ROUND2_INTRO는 "다시는 일어날 것 같지 않던 김현재가... 일어났다" 줄에서 김현재가 다시 등장하는
  // 연출이라(요청됨), 그 전까지는 화면에서 비어 있어야 한다 - 이어하기 대비 씬 시작점에도 승유만
  // 명시하고(신고받아 수정 - 안 그러면 이어하기 시 승유가 안 보이는 채로 시작한다) 김현재는 비워둔다.
  setBg('empty_ruins');
  setChars({left:'seungyu', center:null, right:null}, true);
  playQueue(EP2_CRISIS_BATTLE_SEUNGYU_ROUND2_INTRO.slice(), showEp2CrisisBattleSeungyuRound2Choice);
}
function showEp2CrisisBattleSeungyuRound2Choice(){
  showChoiceGeneric(EP2_CRISIS_BATTLE_SEUNGYU_ROUND2_CHOICE, (opt)=>{
    if(opt.key === 'brace'){
      playQueue(EP2_CRISIS_BATTLE_SEUNGYU_BRACE_RESIST_LEADIN.concat(EP2_CRISIS_END_RESISTER_TAIL), ()=> showEp2Ending('비운의 저항자 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['비운의 저항자 앤딩']));
    } else {
      playQueue(EP2_CRISIS_BATTLE_SEUNGYU_MIMIC_WIN.slice(), ()=> showEp2Ending('강승유와의 승리 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['강승유와의 승리 앤딩']));
    }
  });
}

/* ---- ⑦ 강 희 소환 -> 강 희 앤딩(ep2_end3, 완결) ---- */
const EP2_CRISIS_END_GANGHEE = [
  { type:'narration', text:'나는 다급하게 휴대폰을 꺼냈다.' },
  { type:'thought', text:'지금 이 상황을 혼자 해결할 수 있을 것 같지 않았다.' },
  { type:'narration', text:'곧바로 강 희에게 메신저를 보냈다.', openChat:'ganghee' },
  { type:'chat', from:'player', text:'희야! 여기로 급히 와야 할 것 같아 지금 당장!' },
  { type:'chat', from:'player', text:'지금 상황은 너도 잘 알고 있지?' },
  { type:'chat', from:'player', text:'주소 보낼게.' },
  { type:'narration', text:'나는 현재 위치를 찍어 보냈다.' },
  { type:'narration', text:'메시지를 보내자마자 1이 사라졌다. 그리고 답장이 왔다.' },
  { type:'chat', from:GANGHEE2_ADULT, text:'오케이! 바로 달려갈게!', closeChat:true },
  { type:'narration', text:'나는 휴대폰을 내려놓고 주변을 살폈다.' },
  { type:'narration', text:'검은 옷의 남자, 김현재는 여전히 아무 말 없이 나를 바라보고 있었다.' },
  { type:'narration', text:'시간이 얼마나 흘렀을까.' },
  { type:'narration', text:'멀리서 익숙한 목소리가 들렸다.' },
  { type:'line', speaker:GANGHEE2_ADULT, text:'야! __PLAYER_NAME__!' },
  // 목소리만 들리는 시점이라 아직 스탠딩을 세우지 않고, 실제로 고개를 돌려 발견하는 이 줄에서 등장시킨다
  // - 인물이 둘일 때는 기본적으로 left+right에 대칭 배치되어야 하므로(신고받아 수정), center에
  // 혼자 있던 김현재가 여유롭게 right로 밀려나고 강 희가 left에 등장하는 연출(대사창은 그 사이
  // 자동으로 숨겨진다)이 트리거되도록 chars:{left, right}를 한 줄에 함께 지정한다
  // (tryPlayCenterSlideToSideTransition 참고). 이 씬은(다른 세 친구와 달리) 배경 초기화 없이 쭉
  // 이어지므로, 김현재는 씬이 끝날 때까지 계속 right에 남아있다 - 아래 구취 브레스 콤보 이펙트도
  // 그에 맞춰 right를 겨냥한다.
  { type:'narration', text:'고개를 돌리자 강 희가 숨을 헐떡이며 뛰어오고 있었다.', chars:{left:'ganghee', right:'hyunjae'} },
  { type:'line', speaker:GANGHEE2_ADULT, text:'내가 전광석화처럼 달려왔어!' },
  { type:'narration', text:'강 희는 말을 멈추지 않고 저기 멀리 있는 형체를 바라봤다.' },
  { type:'narration', text:'눈앞에 서 있는 그를 발견했기 때문이다.' },
  { type:'line', speaker:GANGHEE2_ADULT, text:'……뭐야, 쟤?' },
  { type:'narration', text:'그의 표정도 처음으로 변했다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'너는…………강 희.' },
  { type:'line', speaker:GANGHEE2_ADULT, text:'내 이름을 어떻게 알아?' },
  { type:'narration', text:'두 사람 사이에 묘한 긴장감이 흘렀다.' },
  { type:'thought', text:'이제부터가 진짜 시작인가…….', stopBgm:true },
  { type:'narration', text:'강 희는 김현재를 한참 바라보더니 갑자기 내 앞으로 나섰다.' },
  { type:'line', speaker:GANGHEE2_ADULT, text:'__PLAYER_NAME__! 비켜!' },
  { type:'line', speaker:EP2_PLAYER, text:'어?' },
  { type:'line', speaker:GANGHEE2_ADULT, text:'내가 저 녀석을 죽일게!' },
  // 숨을 들이마시는 순간 스탠딩을 ganghee2로 바꾼다(요청됨) - ganghee/ganghee2는 같은 인물의 표정
  // 교체(CHAR_IDENTITY_ALIASES)라 퇴장/재등장이 아니라 살짝 내려갔다 올라오는 dip 연출로 자연스럽게
  // 바뀐다.
  { type:'narration', text:'강 희가 크게 숨을 들이마셨다.', chars:{left:'ganghee2'} },
  { type:'thought', text:'설마…….' },
  { type:'line', speaker:GANGHEE2_ADULT, text:'7일간 양치 안 한 생화학 구취 브레스!!' },
  { type:'line', speaker:EP2_PLAYER, text:'잠깐, 희야!' },
  // 다른 엔딩 CG 등장 지점(재혁 쌍욕 앤딩 등)과 동일한 기법 - CG가 노페이드로 즉시 나타나고 그 위로
  // 스탠딩이 가려지지 않도록 지운다(요청됨). comedyBounce는 어차피 같은 박자에 스탠딩이 가려지므로
  // 보이지 않아 뺐고, 화면 흔들림(cameraPunch)만 그대로 유지한다.
  { type:'narration', text:'푸우우우우우웅!!', showBg:'end3', noBgFade:true, cameraPunch:true, chars:{left:null, right:null}, bgm:'Kurumi BGM' },
  { type:'narration', text:'상상을 초월하는 악취가 주변을 휩쓸었다.' },
  { type:'narration', text:'그는 처음으로 당황한 표정을 지었다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'그게…….' },
  { type:'narration', text:'그가 코를 막으며 뒤로 물러났다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'그게 먹힐 거라고 생각하나?' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'line', speaker:HYUNJAE, text:'겨우 이런 것으로 대마법사인 나 김현재를…….' },
  { type:'narration', text:'김현재가 말을 이어가려는 순간.' },
  { type:'line', speaker:HYUNJAE, text:'……엌.' },
  { type:'narration', text:'그의 눈이 풀렸다.' },
  // 스탠딩은 이미 위 CG(end3)로 가려진 상태라 staggerCollapse를 또 재생할 필요가 없다.
  { type:'narration', text:'털썩.' },
  { type:'narration', text:'김현재는 그대로 쓰러졌다.' },
  { type:'narration', text:'나는 한동안 아무 말도 하지 못했다.' },
  { type:'narration', text:'강 희가 뿌듯한 표정으로 나를 바라봤다.' },
  { type:'line', speaker:GANGHEE2_ADULT, text:'봤지?' },
  { type:'line', speaker:EP2_PLAYER, text:'……응.' },
  { type:'line', speaker:GANGHEE2_ADULT, text:'역시 나야.' },
  { type:'narration', text:'그 순간 멈춰 있던 전자기기들이 하나둘 켜지기 시작했다.' },
  { type:'narration', text:'꺼져 있던 가로등이 다시 밝혀지고, 휴대폰에도 통신이 돌아왔다.' },
  { type:'narration', text:'세계는 다시 정상으로 돌아왔다.' },
  { type:'narration', text:'그날 이후 특별한 일은 일어나지 않았다.' },
  { type:'thought', text:'김현재가 왜 그런 일을 벌였는지, 그가 정확히 무엇을 계획했는지는 결국 알 수 없었다.' },
  { type:'thought', text:'하지만 적어도 세상은 다시 평범해졌다.', stopBgm:true },
  { type:'narration', text:'그리고 나 역시 평범한 일상으로 돌아갔다.' },
  { type:'narration', text:'가끔 강 희와 만나 밥을 먹고, 쓸데없는 이야기를 하며 시간을 보냈다.', showBg:'alley' },
  { type:'line', speaker:GANGHEE2_ADULT, text:'__PLAYER_NAME__!', chars:{left:'ganghee', right:null}, bgm:'Ganghee Portrait' },
  { type:'line', speaker:EP2_PLAYER, text:'왜?' },
  { type:'line', speaker:GANGHEE2_ADULT, text:'오늘 뭐 먹을래?' },
  { type:'line', speaker:EP2_PLAYER, text:'아무거나.' },
  { type:'line', speaker:GANGHEE2_ADULT, text:'그럼 네가 사!' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'thought', text:'나는 문득 그날의 일을 떠올렸다.' },
  { type:'thought', text:'세계의 운명이 걸린 싸움도 결국 이렇게 끝났다.' },
  { type:'thought', text:'어쩌면 평범한 일상이란, 이런 사소한 순간들이 모여 만들어지는 것인지도 모른다.' },
  { type:'narration', text:'나는 강 희와 함께 천천히 길을 걸었다.' },
  { type:'narration', text:'그리고 생각했다.' },
  { type:'thought', text:'이 정도면…… 나쁘지 않은 결말일지도 모르겠다.' },
];

/* =========================================================
   대광장(PLAZA) 루트 - 귀환의 돌로 200년 전으로 돌아간 별도 타임라인(S#2의 ① 재혁 재방문 경로 전용).
   위 위기(CRISIS) 루트와는 절대 서로 합류하지 않는다. 원문 기준 raw S#3 챕터에서 시작해 카페
   미니게임(s#4) 이후 던전 고백/아카데미·탑 마법 대결과 그 엔딩들까지 전부 이어붙어 있다.
   ========================================================= */
const EP2_PLAZA_ARRIVAL = [
  // 직전 씬(EP2_S2_MORNING_BRANCH1)이 whiteout:true로 끝나 화면이 완전히 하얀 채로 이 씬이 시작된다 -
  // 대사 없는 silentEffect 비트로 배경을 먼저 갈아끼운 뒤(noBgFade라 즉시 전환) 흰 화면만 홀로 서서히
  // 걷히게 하고, 그동안 대사창은 숨겨둔다(요청됨) - holdMs가 #scene-fade의 opacity 트랜지션(.65s)보다
  // 살짝 길어야 다 걷힌 뒤에 대사가 나타난다.
  { type:'silentEffect', showBg:'grand_plaza_day', whiteout:false, chars:{center:null}, holdMs:700 },
  { type:'narration', text:'눈을 떴을 때 나는 낯선 대광장 한가운데 서 있었다.',  bgm:'2.10 Chilling Out'},
  { type:'line', speaker:EP2_PLAYER, text:'여기가…… 어디야?' },
  { type:'narration', text:'현대의 건물은 보이지 않았다.' },
  { type:'narration', text:'광장 주변에는 거대한 건물이 세 채 서 있었다.' },
  { type:'narration', text:'첫 번째 건물에는 학교처럼 보였는데, 마법사 아카데미라고 적혀 있었다.', showBg:'mage_academy' },
  { type:'narration', text:'두 번째 건물은 하늘을 찌를 듯한 마법사의 탑이었다.', showBg:'mage_tower' },
  { type:'narration', text:'그리고 세 번째 건물 입구에는 어두운 계단과 함께 마법사의 던전이라는 문구가 새겨져 있었다.', showBg:'mage_dungeon' },
  { type:'narration', text:'나는 세 건물을 번갈아 바라봤다.', showBg:'grand_plaza_day' },
  { type:'line', speaker:EP2_PLAYER, text:'대체 어디부터 들어가야 하는 거야?' },
];

const EP2_PLAZA_CHOICE = {
  prompt: '어디로 들어갈까?',
  options: [
    { label:'① 마법사 아카데미에 들어간다.', key:'academy' },
    { label:'② 마법사의 탑에 들어간다.', key:'tower' },
    { label:'③ 마법사의 던전에 들어간다.', key:'dungeon' },
  ],
};

const EP2_PLAZA_ACADEMY = [
  { type:'narration', text:'나는 세 건물 중 무언가 이끌리는 마법사 아카데미로 들어갔다.', showBg:'mage_academy' },
  { type:'narration', text:'문을 열자 넓은 복도가 나타났다.' },
  { type:'narration', text:'벽에는 수많은 마법진과 오래된 책들이 가득했다.' },
  { type:'line', speaker:JONGBOK_VEILED, text:'어? 처음 보는 얼굴인데.' },
  { type:'narration', text:'뒤에서 목소리가 들렸다.' },
  { type:'narration', text:'돌아보니 한 남자가 나를 바라보고 있었다.', shockReveal:true, chars:{center:'jongbok_past'} },
  { type:'line', speaker:EP2_PLAYER, text:'누구세요?' },
  { type:'line', speaker:JONGBOK2, text:'이종복. 이곳의 마법사야.' },
  { type:'narration', text:'그는 나를 위아래로 훑어보았다.' },
  { type:'line', speaker:JONGBOK2, text:'그런데 이상하네.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭐가요?' },
  { type:'line', speaker:JONGBOK2, text:'너한테서는 이 시대의 마법사에게서는 느껴지지 않는 마력이 느껴져.' },
  { type:'narration', text:'나는 순간 굳어버렸다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……마력?' },
  { type:'narration', text:'종복은 의미심장하게 웃었다.', stopBgm:true },
];

const EP2_PLAZA_TOWER = [
  { type:'narration', text:'나는 세 건물 중 이상하게도 마음이 끌리는 마법사의 탑으로 들어갔다.', showBg:'mage_tower' },
  { type:'narration', text:'문을 열자 끝이 보이지 않을 만큼 높은 계단이 나타났다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……이걸 다 올라가야 하는 건가?' },
  { type:'narration', text:'한숨을 쉬며 계단을 오르던 순간.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'넌 누구냐.', chars:{center:'sojung_past'} },
  { type:'narration', text:'위에서 목소리가 들렸다.' },
  { type:'narration', text:'어렴풋이 검은 그림자가 나를 내려다보고 있는 것이 보였다.' },
  { type:'line', speaker:EP2_PLAYER, text:'누구세요?' },
  { type:'narration', text:'그녀가 천천히 계단을 내려오며 모습을 드러냈다.', chars:{center:'sojung_past'}, shockReveal:true },
  { type:'line', speaker:SOJUNG2_VEILED, text:'내가 먼저 물었어.' },
  { type:'narration', text:'그녀는 천천히 계단을 내려오며 나를 훑어봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'저는 __PLAYER_NAME__인데요.' },
  { type:'narration', text:'그녀가 잠시 눈을 가늘게 떴다.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'신비로운 기운이 느껴져.' },
  { type:'line', speaker:EP2_PLAYER, text:'네?' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'혼란스러운 일들이 일어나고 있었군.' },
  { type:'thought', text:'그녀는 알 수 없는 말만 계속했다.', stopBgm:true },
];

const EP2_PLAZA_DUNGEON = [
  { type:'narration', text:'나는 세 건물 중 무언가 이끌리는 마법사의 던전으로 들어갔다.', showBg:'mage_dungeon' },
  { type:'thought', text:'자고로 회귀를 했으면 던전을 가는게 정배가 아니겠는가.' },
  { type:'narration', text:'문을 열자 광활한 동굴 내부가 펼쳐졌다. 그 조그만한 건물에서 이러한 큰 공간이 나올줄은 상상도 못했다.', showBg:'dungeon_inside' },
  { type:'narration', text:'그렇게 나는 일단 앞으로 걸었다.' },
  { type:'line', speaker:HYUNJAE_VEILED, text:'어이 거기! 혼자 다니면 위험해!', chars:{center:'hyunjae'} },
  { type:'narration', text:'옆쪽 벤치에서 누군가가 나에게 말을 걸었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'혹시. 누구세요?' },
  { type:'narration', text:'벤치에 앉아 있던 남자가 몸을 일으켰다.', shockReveal:true },
  { type:'line', speaker:HYUNJAE, text:'나? 김현재야 김현재. 대마법사를 꿈꾸는 방랑자!' },
  { type:'narration', text:'현재는 나에게 친근하게 다가왔다.' },
  { type:'thought', text:'이 곳이 어떤 곳인지 파악해야 하는 나로서 천운이 아니겠는가.', stopBgm:true },
];

/* ---- 대광장 3인 카페(마죽동) 호감도 미니게임 - 같은 3가지 음료를 누구와 마시느냐에 따라
   반응과 호감도 증감이 전부 다르다 ---- */
const EP2_CAFE_CHOICE = {
  prompt: '무엇을 마실까?',
  options: [
    { label:'① 용의 비늘이 첨가된 아메리카노를 선택한다.', key:'dragon' },
    { label:'② 고블린의 피가 들어간 아샷추를 선택한다.', key:'goblin' },
    { label:'③ 엘프의 귀가 들어간 바닐라 라떼를 선택한다.', key:'elf' },
  ],
};

const EP2_CAFE_HYUNJAE_INTRO = [
  { type:'line', speaker:HYUNJAE, text:'난 이 던전을 관리하고 있지. 아무래도 여기서는 나보다 던전 구조를 잘 아는 사람이 없을거야!' },
  { type:'narration', text:'그는 나를 잠시 바라보더니 말했다.' },
  { type:'line', speaker:HYUNJAE, text:'몬스터를 잡으러 온 건가?' },
  { type:'line', speaker:EP2_PLAYER, text:'아니, 그건 아니고…….' },
  { type:'line', speaker:HYUNJAE, text:'뭐, 상관없지.' },
  { type:'narration', text:'김현재는 나를 데리고 던전 안쪽으로 걸어갔다.' },
  { type:'narration', text:'그런데 예상과 달리 몬스터가 있는 곳이 아니라 작은 카페 앞에 멈춰 섰다.', showBg:'majukdong_cafe', bgm:'1-08. Daily Routine 247' },
  { type:'narration', text:'간판에는 [마죽동111]이라고 적혀 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……카페?' },
  { type:'line', speaker:HYUNJAE, text:'던전에 왔으면 여기부터 들러야지.' },
  { type:'narration', text:'김현재가 메뉴판을 내밀었다.' },
  { type:'line', speaker:HYUNJAE, text:'하나 골라.' },
  { type:'narration', text:'나는 메뉴판을 바라봤다.' },
  { type:'narration', text:'용의 비늘이 첨가된 아메리카노 — 5000G' },
  { type:'narration', text:'고블린의 피가 들어간 아샷추 — 5000G' },
  { type:'narration', text:'엘프의 귀가 들어간 바닐라 라떼 — 5000G' },
  { type:'line', speaker:EP2_PLAYER, text:'……이게 진짜 음료라고요?' },
  { type:'line', speaker:HYUNJAE, text:'그럼 뭐겠어?' },
  { type:'narration', text:'김현재는 아무렇지도 않게 카페 의자에 앉았다.' },
  { type:'line', speaker:HYUNJAE, text:'천천히 골라. 던전은 도망가지 않으니까.' },
  { type:'narration', text:'나는 메뉴판을 다시 바라봤다.' },
  { type:'thought', text:'대체 이 시대의 카페는 왜 이런 것만 파는 걸까?' },
];

const EP2_CAFE_HYUNJAE_DRAGON = [
  { type:'narration', text:'나는 메뉴판을 바라보다가 아메리카노를 가리켰다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이걸로 주세요.' },
  { type:'line', speaker:HYUNJAE, text:'용의 비늘 아메리카노?' },
  { type:'line', speaker:EP2_PLAYER, text:'네.' },
  { type:'narration', text:'김현재가 묘한 표정으로 나를 바라봤다.' },
  { type:'line', speaker:HYUNJAE, text:'하필 그걸 고르네. ㅋㅋ' },
  { type:'line', speaker:EP2_PLAYER, text:'왜요?' },
  { type:'line', speaker:HYUNJAE, text:'맛이 별로거든.' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'thought', text:'이미 주문을 취소하기엔 늦었다.' },
  { type:'narration', text:'잠시 후 컵이 내 앞에 놓였다.' },
  { type:'narration', text:'나는 조심스럽게 한 모금 마셨다.' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'line', speaker:HYUNJAE, text:'어때?' },
  { type:'line', speaker:EP2_PLAYER, text:'커피 맛인데…… 뭔가 비늘 씹히는 느낌인데요.' },
  { type:'narration', text:'김현재가 피식 웃었다.' },
  { type:'line', speaker:HYUNJAE, text:'그러니까 별로라고 했잖아.' },
  { type:'narration', text:'나는 말없이 커피를 내려놓았다.', stopBgm:true },
];

const EP2_CAFE_HYUNJAE_GOBLIN = [
  { type:'narration', text:'나는 메뉴판을 한참 바라보다 아샷추를 가리켰다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이걸로 주세요.' },
  { type:'line', speaker:HYUNJAE, text:'……고블린의 피 아샷추?' },
  { type:'narration', text:'김현재가 눈썹을 치켜올렸다.' },
  { type:'line', speaker:HYUNJAE, text:'취향 한번 특이하네.ㅋㅋ' },
  { type:'line', speaker:EP2_PLAYER, text:'그냥 아샷추잖아요.' },
  { type:'line', speaker:HYUNJAE, text:'그래. 재료가 조금 다를 뿐이지.' },
  { type:'narration', text:'잠시 후 음료가 나왔다.' },
  { type:'narration', text:'나는 별 의심 없이 한 모금 마셨다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……윽.' },
  { type:'line', speaker:HYUNJAE, text:'왜?' },
  { type:'line', speaker:EP2_PLAYER, text:'생각보다 피 맛이 강한데요?' },
  { type:'narration', text:'김현재가 태연하게 대답했다.' },
  { type:'line', speaker:HYUNJAE, text:'고블린 피를 넣었으니까.' },
  { type:'line', speaker:EP2_PLAYER, text:'그걸 지금 말하면 어떡해요!' },
  { type:'narration', text:'김현재는 웃음을 터뜨렸다.' },
  { type:'line', speaker:HYUNJAE, text:'재미있는 녀석이네.' },
  { type:'thought', text:'하지만 어딘가 미묘한 표정이었다.', stopBgm:true },
];

const EP2_CAFE_HYUNJAE_ELF = [
  { type:'narration', text:'나는 메뉴판을 보다가 바닐라 라떼를 가리켰다.' },
  { type:'line', speaker:EP2_PLAYER, text:'저는 이걸로 할게요.' },
  { type:'line', speaker:HYUNJAE, text:'엘프의 귀 바닐라 라떼?' },
  { type:'narration', text:'김현재가 잠시 나를 바라봤다.' },
  { type:'line', speaker:HYUNJAE, text:'의외인데.' },
  { type:'line', speaker:EP2_PLAYER, text:'왜요?' },
  { type:'line', speaker:HYUNJAE, text:'던전에 처음 온 놈들은 보통 가장 강해 보이는 걸 고르거든.' },
  { type:'line', speaker:EP2_PLAYER, text:'저는 그냥 무난한 게 좋아서요.' },
  { type:'narration', text:'잠시 후 음료가 나왔다.' },
  { type:'narration', text:'나는 조심스럽게 한 모금 마셨다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……생각보다 맛있네요.' },
  { type:'line', speaker:HYUNJAE, text:'그렇지?ㅋㅋ' },
  { type:'narration', text:'김현재의 표정이 처음으로 조금 풀렸다.' },
  { type:'line', speaker:HYUNJAE, text:'엘프의 귀는 향이 강해서 바닐라와 잘 어울려.' },
  { type:'line', speaker:EP2_PLAYER, text:'그걸 직접 먹어봤어요?' },
  { type:'line', speaker:HYUNJAE, text:'……그건 비밀이다.' },
  { type:'narration', text:'김현재가 피식 웃었다.' },
  { type:'thought', text:'왠지 처음보다 분위기가 조금 편해진 것 같았다.', stopBgm:true },
];

const EP2_CAFE_SOJUNG_INTRO = [
  { type:'narration', text:'그러다 갑자기 몸을 돌렸다.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'따라와.' },
  { type:'line', speaker:EP2_PLAYER, text:'어디로 가는데요?' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'마죽동 333.', bgm:'1-08. Daily Routine 247' },
  { type:'line', speaker:EP2_PLAYER, text:'……카페요?' },
  { type:'narration', text:'그녀는 아무렇지도 않게 대답했다.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'탑에 손님이 오면 차를 대접하는 것이 예의니까.' },
  { type:'narration', text:'잠시 후 우리는 탑 내부에 있는 작은 카페에 도착했다.', showBg:'majukdong_cafe' },
  { type:'narration', text:'그녀는 메뉴판을 내밀었다.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'원하는 것을 골라.' },
  { type:'narration', text:'메뉴판에는 세 가지 음료가 적혀 있었다.' },
  { type:'narration', text:'용의 비늘이 첨가된 아메리카노 — 5000G' },
  { type:'narration', text:'고블린의 피가 들어간 아샷추 — 5000G' },
  { type:'narration', text:'엘프의 귀가 들어간 바닐라 라떼 — 5000G' },
  { type:'narration', text:'나는 메뉴판과 그녀를 번갈아 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……마법사들은 대체 뭘 마시는 거예요?' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'취향에 따라 다르지.' },
  { type:'narration', text:'그녀는 의미심장하게 웃었다.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'네 선택이 앞으로의 운명을 조금 바꿀지도 모르고.' },
];

const EP2_CAFE_SOJUNG_DRAGON = [
  { type:'narration', text:'나는 메뉴판을 바라보다가 아메리카노를 가리켰다.' },
  { type:'line', speaker:EP2_PLAYER, text:'저는 이걸로 할게요.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'용의 비늘 아메리카노…….' },
  { type:'narration', text:'그녀가 살짝 미소 지었다.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'좋은 선택이야.' },
  { type:'line', speaker:EP2_PLAYER, text:'맛있나요?' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'용의 비늘은 마력을 안정시키는 효과가 있거든.' },
  { type:'narration', text:'잠시 후 잔이 내 앞에 놓였다.' },
  { type:'narration', text:'한 모금 마시자 진한 커피 향과 함께 묘하게 따뜻한 기운이 몸속으로 퍼졌다.' },
  { type:'line', speaker:EP2_PLAYER, text:'어……?' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'느껴지지?' },
  { type:'narration', text:'그녀가 나를 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'네. 이상하게 몸이 편해진 것 같아요.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'역시.' },
  { type:'narration', text:'그녀가 의미심장하게 웃었다.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'너에게는 그게 필요했나 보네.', stopBgm:true },
];

const EP2_CAFE_SOJUNG_GOBLIN = [
  { type:'narration', text:'나는 잠시 고민하다가 아샷추를 가리켰다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이걸로 주세요.' },
  { type:'narration', text:'그녀의 표정이 굳었다.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'고블린의 피……?' },
  { type:'line', speaker:EP2_PLAYER, text:'네.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'정말 그걸 마시겠다는 거야?' },
  { type:'line', speaker:EP2_PLAYER, text:'메뉴에 있잖아요.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'……그렇긴 하지.' },
  { type:'narration', text:'잠시 후 음료가 나왔다.' },
  { type:'narration', text:'나는 한 모금 마셨다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……으.' },
  { type:'thought', text:'생각보다 훨씬 비릿했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'맛이 이상한데요.' },
  { type:'narration', text:'그녀가 차갑게 말했다.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'당연하지. 고블린의 피니까.' },
  { type:'line', speaker:EP2_PLAYER, text:'그걸 왜 이렇게 당당하게 말하세요?' },
  { type:'narration', text:'그녀는 한숨을 내쉬었다.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'다음부터는 신중하게 선택하도록 해.' },
  { type:'thought', text:'왠지 처음보다 거리가 멀어진 느낌이었다.', stopBgm:true },
];

const EP2_CAFE_SOJUNG_ELF = [
  { type:'narration', text:'나는 메뉴판을 보다가 바닐라 라떼를 가리켰다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이걸로 할게요.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'엘프의 귀 바닐라 라떼.' },
  { type:'narration', text:'그녀는 별다른 표정 없이 주문했다.' },
  { type:'narration', text:'잠시 후 음료가 나왔다.' },
  { type:'narration', text:'나는 한 모금 마셨다.' },
  { type:'line', speaker:EP2_PLAYER, text:'음…….' },
  { type:'narration', text:'달콤하고 부드러운 맛이었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'맛있네요.' },
  { type:'narration', text:'하지만 그녀는 내 음료를 바라보며 말했다.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'엘프의 귀는 섬세한 마력을 지닌 재료야.' },
  { type:'line', speaker:EP2_PLAYER, text:'그래서요?' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'그걸 단순히 맛으로만 소비하다니.' },
  { type:'line', speaker:EP2_PLAYER, text:'……네?' },
  { type:'narration', text:'그녀는 한숨을 내쉬었다.' },
  { type:'line', speaker:SOJUNG2_VEILED, text:'너는 아직 마법의 가치를 모르는구나.' },
  { type:'narration', text:'나는 괜히 눈치를 보며 컵을 내려놓았다.', stopBgm:true },
];

const EP2_CAFE_JONGBOK_INTRO = [
  { type:'line', speaker:JONGBOK2, text:'그래. 네 몸에서 아주 희미하지만 특별한 마력이 느껴져.' },
  { type:'line', speaker:EP2_PLAYER, text:'저는 마법 같은 건 해본 적도 없는데요.' },
  { type:'line', speaker:JONGBOK2, text:'그럴 리가 없는데…….' },
  { type:'narration', text:'종복은 잠시 나를 바라보다가 고개를 갸웃했다.' },
  { type:'line', speaker:JONGBOK2, text:'뭐, 지금 당장 알아낼 필요는 없겠지.' },
  { type:'line', speaker:EP2_PLAYER, text:'그럼 뭘 하려고요?' },
  { type:'line', speaker:JONGBOK2, text:'일단 마죽동 555에 가자.', bgm:'1-08. Daily Routine 247' },
  { type:'line', speaker:EP2_PLAYER, text:'……마죽동?' },
  { type:'line', speaker:JONGBOK2, text:'우리 아카데미에 있는 카페야.' },
  { type:'narration', text:'종복이 아무렇지도 않게 복도를 걸어갔다.' },
  { type:'narration', text:'잠시 후 넓은 휴게 공간 한쪽에 작은 카페가 나타났다.', showBg:'majukdong_cafe' },
  { type:'narration', text:'[마죽동 555]' },
  { type:'line', speaker:EP2_PLAYER, text:'여기서 뭐 하는데요?' },
  { type:'line', speaker:JONGBOK2, text:'마법사도 목이 마르거든.' },
  { type:'narration', text:'종복이 메뉴판을 내밀었다.' },
  { type:'narration', text:'메뉴판에는 익숙하면서도 전혀 익숙하지 않은 음료 세 가지가 적혀 있었다.' },
  { type:'narration', text:'용의 비늘이 첨가된 아메리카노 — 5000G' },
  { type:'narration', text:'고블린의 피가 들어간 아샷추 — 5000G' },
  { type:'narration', text:'엘프의 귀가 들어간 바닐라 라떼 — 5000G' },
  { type:'narration', text:'나는 메뉴판을 멍하니 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……이게 정말 음료 맞죠?' },
  { type:'narration', text:'종복이 웃었다.' },
  { type:'line', speaker:JONGBOK2, text:'마셔보면 알겠지.' },
  { type:'line', speaker:EP2_PLAYER, text:'아니, 재료부터 좀 이상한데요?' },
  { type:'line', speaker:JONGBOK2, text:'그래서 더 맛있는 거야.' },
  { type:'narration', text:'나는 한숨을 쉬며 메뉴판을 다시 바라봤다.' },
  { type:'thought', text:'대체 셋 중 뭘 골라야 하는 거지?' },
];

const EP2_CAFE_JONGBOK_DRAGON = [
  { type:'narration', text:'나는 메뉴판을 바라보다 아메리카노를 가리켰다.' },
  { type:'line', speaker:EP2_PLAYER, text:'저는 이걸로 할게요.' },
  { type:'narration', text:'이종복의 표정이 미묘하게 변했다.' },
  { type:'line', speaker:JONGBOK2, text:'용의 비늘 아메리카노?' },
  { type:'line', speaker:EP2_PLAYER, text:'네.' },
  { type:'line', speaker:JONGBOK2, text:'하필 그걸…….' },
  { type:'line', speaker:EP2_PLAYER, text:'왜요? 맛있는 거 아닌가요?' },
  { type:'narration', text:'종복은 어깨를 으쓱했다.' },
  { type:'line', speaker:JONGBOK2, text:'용의 비늘은 마력이 강한 재료야. 초보자가 마시면 속이 불편할 수도 있어.' },
  { type:'narration', text:'잠시 후 음료가 나왔다.' },
  { type:'narration', text:'나는 한 모금 마셨다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……윽.' },
  { type:'narration', text:'곧바로 얼굴을 찡그렸다.' },
  { type:'narration', text:'종복이 웃음을 참으며 말했다.' },
  { type:'line', speaker:JONGBOK2, text:'그러게 말했잖아.' },
  { type:'line', speaker:EP2_PLAYER, text:'이걸 왜 메뉴에 넣어놓은 거예요?' },
  { type:'line', speaker:JONGBOK2, text:'마법사들은 가끔 별난 걸 좋아하거든.', stopBgm:true },
];

const EP2_CAFE_JONGBOK_GOBLIN = [
  { type:'narration', text:'나는 메뉴판을 살펴보다 아샷추를 가리켰다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이걸로 주세요.' },
  { type:'line', speaker:JONGBOK2, text:'오?' },
  { type:'narration', text:'이종복의 눈이 반짝였다.' },
  { type:'line', speaker:JONGBOK2, text:'고블린의 피 아샷추를 고르는 사람은 오랜만인데.' },
  { type:'line', speaker:EP2_PLAYER, text:'맛있어요?' },
  { type:'line', speaker:JONGBOK2, text:'나는 꽤 좋아해.' },
  { type:'narration', text:'잠시 후 음료가 나왔다.' },
  { type:'narration', text:'나는 조심스럽게 한 모금 마셨다.' },
  { type:'line', speaker:EP2_PLAYER, text:'어……?' },
  { type:'thought', text:'생각보다 괜찮았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'의외로 맛있는데요?' },
  { type:'narration', text:'종복이 만족스럽게 웃었다.' },
  { type:'line', speaker:JONGBOK2, text:'그렇지? 고블린의 피 특유의 쌉싸름한 맛이 커피랑 잘 어울려.' },
  { type:'line', speaker:EP2_PLAYER, text:'이런 걸 좋아하는 사람이었군요.' },
  { type:'line', speaker:JONGBOK2, text:'너도 생각보다 취향이 괜찮은데?' },
  { type:'narration', text:'그가 웃으며 내 어깨를 가볍게 두드렸다.', stopBgm:true },
];

const EP2_CAFE_JONGBOK_ELF = [
  { type:'narration', text:'나는 잠시 고민하다 바닐라 라떼를 가리켰다.' },
  { type:'line', speaker:EP2_PLAYER, text:'저는 이걸로 할게요.' },
  { type:'line', speaker:JONGBOK2, text:'엘프의 귀 바닐라 라떼.' },
  { type:'narration', text:'이종복은 별다른 반응 없이 주문했다.' },
  { type:'narration', text:'잠시 후 음료가 나왔다.' },
  { type:'narration', text:'나는 한 모금 마셨다.' },
  { type:'line', speaker:EP2_PLAYER, text:'달콤하네요.' },
  { type:'line', speaker:JONGBOK2, text:'그렇지.' },
  { type:'narration', text:'종복은 내 음료를 한번 바라보고는 다시 책을 펼쳤다.' },
  { type:'line', speaker:JONGBOK2, text:'엘프의 귀는 향이 강해서 바닐라와 잘 어울려.' },
  { type:'line', speaker:EP2_PLAYER, text:'이걸 자주 마셔요?' },
  { type:'line', speaker:JONGBOK2, text:'가끔.' },
  { type:'narration', text:'그는 다시 책을 읽기 시작했다.' },
  { type:'thought', text:'딱히 특별한 반응은 없었다.' },
  { type:'narration', text:'나도 조용히 음료를 마셨다.', stopBgm:true },
];

/* =========================================================
   씬 흐름 글루 함수 - ep1의 playSceneN/renderSceneN/gateNextScene/showChoiceGeneric 패턴을 그대로 따른다.
   ========================================================= */
function playEp2S1(){
  setBg('jaehyuk_mansion_inside');
  el.charLeft.classList.remove('show');
  el.charRight.classList.remove('show');
  el.charCenter.classList.remove('show');
  curLeftKey = null;
  curRightKey = null;
  curCenterKey = null;
  playQueue(EP2_S1_INTRO.slice(), showEp2S1Choice);
}

function showEp2S1Choice(){
  showChoiceGeneric(EP2_S1_CHOICE, (opt)=>{
    ep2Choice1 = opt.key;
    if(opt.key === '4'){
      playQueue(EP2_S1_BAD_END.slice(), ()=> showEp2Ending('재혁 쌍욕 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['재혁 쌍욕 앤딩']));
      return;
    }
    playQueue(EP2_S1_BRANCHES[opt.key].slice(), ()=> gateNextScene('ep2_scene2', playEp2S2, getEp2State()));
  });
}

/* =========================================================
   S#2 진입 라우터 - ep2Choice1(S#1에서 고른 선택)에 따라 완전히 다른 인트로로 갈라진다.
   ========================================================= */
function playEp2S2(){
  el.charLeft.classList.remove('show');
  el.charRight.classList.remove('show');
  el.charCenter.classList.remove('show');
  curLeftKey = null; curRightKey = null; curCenterKey = null;
  // setBg를 미리 부르지 않는다 - ep1의 gateNextScene 진입점(renderScene2Intro 등)과 같은 관례로,
  // 각 큐의 첫 줄 자신의 showBg(noBgFade 없음)가 fadeToBackground를 통해 암전 -> 배경 교체 -> 페이드인
  // 순서로 자연스럽게 전환한다. 여기서 먼저 setBg를 부르면 암전 전에 배경이 미리 바뀌어버린다.
  if(ep2Choice1 === '1'){
    playQueue(EP2_S2_MORNING_INTRO.slice(), showEp2S2MorningChoice);
  } else if(ep2Choice1 === '2'){
    playQueue(EP2_S2_LETTER_INTRO.slice(), showEp2S2LetterChoice);
  } else {
    playEp2S2Choice3Intro();
  }
}

function showEp2S2MorningChoice(){
  showChoiceGeneric(EP2_S2_MORNING_CHOICE, (opt)=>{
    if(opt.key === '1'){
      playQueue(EP2_S2_MORNING_BRANCH1.slice(), ()=> gateNextScene('ep2_scene3_plaza', playEp2PlazaArrival, getEp2State()));
      return;
    }
    const branch = opt.key === '2' ? EP2_S2_MORNING_BRANCH2 : EP2_S2_MORNING_BRANCH3;
    playQueue(branch.slice(), ()=> gateNextScene('ep2_scene3_convergence', playEp2CrisisConvergence, getEp2State()));
  });
}

function showEp2S2LetterChoice(){
  showChoiceGeneric(EP2_S2_LETTER_CHOICE, (opt)=>{
    if(opt.key === '1'){
      ep2HasPendant = true;
      playQueue(EP2_S2_LETTER_BRANCH1.slice(), ()=> gateNextScene('ep2_scene3_convergence', playEp2CrisisConvergence, getEp2State()));
    } else if(opt.key === '2'){
      playQueue(EP2_S2_LETTER_BRANCH2.slice(), ()=> gateNextScene('ep2_scene3_convergence', playEp2CrisisConvergence, getEp2State()));
    } else {
      playQueue(EP2_S2_BOX_INTRO.slice(), ()=> playQueue(EP2_S2_BOX_HOME.slice(), showEp2S2BoxInput));
    }
  });
}

// 정답은 이 파일(공개 저장소)에 없고 /story/state가 내려준 storySecrets에서만 온다(story-engine.js의
// storySecrets 선언부 주석, ep1의 히든 엔딩 키워드와 같은 패턴). 값이 아직 없으면(private_seed.py
// 미설정 등) 빈 문자열이라 정상적으로 항상 실패 처리된다.
function showEp2S2BoxInput(){
  showPropInput('상자에 문구를 입력해보자.', (typed)=>{
    const normalized = typed.replace(/\s+/g, '');
    const boxPassword = storySecrets.box_password || "";
    if(boxPassword.length > 0 && normalized === boxPassword){
      ep2HasWand = true;
      playQueue(EP2_S2_BOX_SUCCESS.slice(), ()=> gateNextScene('ep2_scene3_convergence', playEp2CrisisConvergence, getEp2State()));
    } else {
      playQueue(EP2_S2_BOX_FAIL.slice(), ()=> gateNextScene('ep2_scene3_convergence', playEp2CrisisConvergence, getEp2State()));
    }
  });
}

// ep1의 "TRUE ENDING CG · 송주헌"(true_juheon)을 이미 봤는지에 따라 완전히 갈라진다 - 못 봤으면
// 카톡으로 친구에게 연락하는 선택지 자체를 거치지 못한 채(대마법사에 대해 알아볼 준비가 안 됐다는
// 뜻으로) 곧장 며칠 뒤 합류 지점(S#3)으로 넘어간다. ep2ContactedFriend가 계속 null로 남으므로,
// 합류 지점(showEp2CrisisConvergenceChoice)에서 펜던트/마법봉도 없다면 자동으로 저항 루트로
// 진행된다.
function playEp2S2Choice3Intro(){
  if(!hasSeenEp1Ending10()){
    gateNextScene('ep2_scene3_convergence', playEp2CrisisConvergence, getEp2State());
    return;
  }
  playQueue(EP2_S2_SEEN10_INTRO.slice(), showEp2S2Seen10Choice);
}

function showEp2S2Seen10Choice(){
  showChoiceGeneric(EP2_S2_SEEN10_CHOICE, (opt)=>{
    ep2ContactedFriend = opt.key;
    const branches = {
      juheon: EP2_S2_CONTACT_JUHEON,
      yeongwoong: EP2_S2_CONTACT_YEONGWOONG,
      seungyu: EP2_S2_CONTACT_SEUNGYU,
      ganghee: EP2_S2_CONTACT_GANGHEE,
    };
    playQueue(branches[opt.key].slice(), ()=> gateNextScene('ep2_scene3_convergence', playEp2CrisisConvergence, getEp2State()));
  });
}

/* =========================================================
   위기(CRISIS) 루트 진입점 - showEp2CrisisConvergenceChoice와 EP2_CRISIS_ 접두사 상수들은 위쪽
   "위기(CRISIS) 루트" 섹션에서 이미 정의되어 있다.
   ========================================================= */
function playEp2CrisisConvergence(){
  el.charLeft.classList.remove('show');
  el.charRight.classList.remove('show');
  el.charCenter.classList.remove('show');
  curLeftKey = null; curRightKey = null; curCenterKey = null;
  playQueue(EP2_CRISIS_CONVERGENCE_INTRO.slice(), showEp2CrisisConvergenceChoice);
}

/* =========================================================
   대광장(PLAZA) 루트 진입점 - EP2_PLAZA_ 접두사와 EP2_CAFE_ 접두사 상수들은 위쪽에서 이미 정의되어
   있다.
   ========================================================= */
function playEp2PlazaArrival(){
  el.charLeft.classList.remove('show');
  el.charRight.classList.remove('show');
  el.charCenter.classList.remove('show');
  curLeftKey = null; curRightKey = null; curCenterKey = null;
  playQueue(EP2_PLAZA_ARRIVAL.slice(), showEp2PlazaChoice);
}

function showEp2PlazaChoice(){
  showChoiceGeneric(EP2_PLAZA_CHOICE, (opt)=>{
    ep2PlazaPath = opt.key;
    const introMap = {
      academy: EP2_PLAZA_ACADEMY,
      tower: EP2_PLAZA_TOWER,
      dungeon: EP2_PLAZA_DUNGEON,
    };
    playQueue(introMap[opt.key].slice(), ()=> gateNextScene('ep2_scene4_cafe', playEp2CafeIntro, getEp2State()));
  });
}

function playEp2CafeIntro(){
  // 이 인트로들의 첫 줄에는 showBg가 없다(카페에 들어서기 전, 방금까지 있던 건물 안에서 이어지는
  // 대사이기 때문) - 정상 진행이라면 직전 씬의 배경이 그대로 남아있어 문제없지만, 티켓 소모 후
  // 이 지점에서 이어하기(체크포인트 재진입)하면 배경이 아예 없거나 엉뚱한 채로 남는 버그가 있었다
  // (신고받아 수정 - 씬 시작점엔 항상 배경을 명시). 각 경로가 있던 건물 배경으로 맞춰준다.
  setBg({ academy:'mage_academy', tower:'mage_tower', dungeon:'mage_dungeon' }[ep2PlazaPath]);
  // 같은 이유로 인물도 명시한다 - 안 그러면 이어하기 시 이종복/임소정/김현재가 안 보이는 채로
  // 시작하거나(신고받아 수정), 전혀 다른 씬에서 남아있던 인물이 엉뚱하게 같이 보일 수 있어 left/right도
  // 함께 비운다.
  setChars({ left:null, right:null, ...{ academy:{center:'jongbok_past'}, tower:{center:'sojung_past'}, dungeon:{center:'hyunjae'} }[ep2PlazaPath] }, true);
  const introMap = {
    academy: EP2_CAFE_JONGBOK_INTRO,
    tower: EP2_CAFE_SOJUNG_INTRO,
    dungeon: EP2_CAFE_HYUNJAE_INTRO,
  };
  playQueue(introMap[ep2PlazaPath].slice(), showEp2CafeChoice);
}

// 같은 3가지 음료라도 누구와 마시느냐에 따라 호감도 증감이 전부 다르다(원본 지문의 "호감도 +1/-1/변함없음").
// 던전 루트(dungeon)는 김현재 한 명뿐이라 기존 ep2CafeAffection을 그대로 쓰고, 아카데미/탑 루트는
// 바로 다음 대광장에서 이종복·임소정 둘 다 등장해 "카페에서 만난 인물이 아닌 쪽"을 도울 수도 있으므로
// 두 사람의 호감도를 따로 추적해야 한다(ep2AffJongbok/ep2AffSojung, 아래 대광장 대결 섹션 참고).
function showEp2CafeChoice(){
  showChoiceGeneric(EP2_CAFE_CHOICE, (opt)=>{
    const outcomeMap = {
      academy: { dragon:[EP2_CAFE_JONGBOK_DRAGON, -1], goblin:[EP2_CAFE_JONGBOK_GOBLIN, 1], elf:[EP2_CAFE_JONGBOK_ELF, 0] },
      tower:   { dragon:[EP2_CAFE_SOJUNG_DRAGON, 1], goblin:[EP2_CAFE_SOJUNG_GOBLIN, -1], elf:[EP2_CAFE_SOJUNG_ELF, -1] },
      dungeon: { dragon:[EP2_CAFE_HYUNJAE_DRAGON, -1], goblin:[EP2_CAFE_HYUNJAE_GOBLIN, -1], elf:[EP2_CAFE_HYUNJAE_ELF, 1] },
    };
    const [lines, delta] = outcomeMap[ep2PlazaPath][opt.key];
    if(ep2PlazaPath === 'academy') ep2AffJongbok += delta;
    else if(ep2PlazaPath === 'tower') ep2AffSojung += delta;
    else ep2CafeAffection += delta;
    // 원문 s#4->s#5 경계(마죽동 카페 이후, 던전 루트는 "인간 혐오 고백" 씬으로/아카데미·탑 루트는
    // "대광장 이종복-임소정 대결" 씬으로 넘어가는 지점) - 씬 번호가 바뀌므로 여기서도 티켓을 소모한다
    // (신고받아 추가 - 위기 루트 4곳과 동일한 원리).
    const nextFn = ep2PlazaPath === 'dungeon'
      ? ()=> gateNextScene('ep2_scene5_dungeon', playEp2DungeonConfessionIntro, getEp2State())
      : ()=> gateNextScene('ep2_scene5_plazafight', playEp2PlazaFightIntro, getEp2State());
    playQueue(lines.slice(), nextFn);
  });
}

/* =========================================================
   던전(DUNGEON) 루트 전용 - 카페 이후 김현재의 인간 혐오 발언에 어떻게 반응하는지에 따라 호감도가
   갈리고(ep2CafeAffection), 최종적으로 "이곳에 남을지 / 귀환의 돌로 돌아갈지" 선택으로 이어진다.
   ========================================================= */
const EP2_DUNGEON_CONFESSION_INTRO = [
  { type:'narration', text:'카페를 나온 우리는 던전 깊숙한 곳으로 들어갔다.' },
  { type:'narration', text:'축축한 동굴을 지나자 김현재가 갑자기 입을 열었다.' },
  { type:'line', speaker:HYUNJAE, text:'나는 인간이 싫어.', bgm:'2-04. Alkaline Tears' },
  { type:'line', speaker:EP2_PLAYER, text:'……네?' },
  { type:'narration', text:'뜬금없는 말에 걸음을 멈췄다.' },
  { type:'line', speaker:HYUNJAE, text:'인간은 욕심이 많아. 자신들이 가진 것보다 더 많은 것을 원하지.' },
  { type:'line', speaker:HYUNJAE, text:'마법도, 땅도, 다른 종족의 것까지 빼앗으려 한다. 그러면서 자기들이 가장 위대한 종족이라고 생각하지.' },
  { type:'narration', text:'나는 아무 말도 하지 않았다.' },
  { type:'line', speaker:HYUNJAE, text:'그래서 인간과 엮이는 건 질색이야.' },
  { type:'narration', text:'그제야 깨달았다.' },
  { type:'narration', text:'나는 아직 김현재에게 내가 인간이라는 사실을 말하지 않았다.' },
  { type:'thought', text:'내가 인간이라는 걸 알게 된다면…… 어떻게 될까?' },
  { type:'narration', text:'김현재가 뒤를 돌아봤다.' },
  { type:'line', speaker:HYUNJAE, text:'왜 그래? 얼굴이 안 좋네.' },
  { type:'narration', text:'나는 잠시 입을 다물었다.' },
  { type:'thought', text:'지금이라도 사실을 말해야 할까.' },
  { type:'thought', text:'아니면 그의 말에 맞장구치며 넘어가야 할까.' },
];
const EP2_DUNGEON_CONFESSION_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 내가 인간이라고 솔직하게 말한다.', key:'honest' },
    { label:'② 인간을 폄하하는 그의 말에 공감해준다.', key:'agree' },
  ],
};
const EP2_DUNGEON_CONFESSION_HONEST = [
  { type:'narration', text:'나는 한참 고민하다 입을 열었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'저…… 인간이에요.' },
  { type:'narration', text:'김현재의 표정이 굳었다.' },
  { type:'line', speaker:HYUNJAE, text:'뭐?' },
  { type:'narration', text:'그의 미간이 확실하게 찌푸려졌다.' },
  { type:'line', speaker:HYUNJAE, text:'왜 지금 말하는 거지?' },
  { type:'line', speaker:EP2_PLAYER, text:'말할 타이밍을 놓쳤어요. 죄송해요.' },
  { type:'narration', text:'김현재는 한동안 아무 말도 하지 않았다.' },
  { type:'narration', text:'나는 긴장한 채 그의 반응을 기다렸다.' },
  { type:'narration', text:'그러다 김현재가 갑자기 한숨을 내쉬었다.' },
  { type:'line', speaker:HYUNJAE, text:'……그런데 이상하군.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭐가요?' },
  { type:'line', speaker:HYUNJAE, text:'네가 인간이라고 생각하니 기분이 나빠야 하는데.' },
  { type:'narration', text:'그는 잠시 생각에 잠겼다.' },
  { type:'line', speaker:HYUNJAE, text:'마죽동에서 음료를 고를 때도 그렇고…… 던전에 들어와서도 내 말을 잘 들어줬지.' },
  { type:'line', speaker:EP2_PLAYER, text:'그게 왜요?' },
  { type:'line', speaker:HYUNJAE, text:'보통 내가 생각하던 인간과는 다르다는 거다.' },
  { type:'narration', text:'김현재가 피식 웃었다.' },
  { type:'line', speaker:HYUNJAE, text:'모든 인간이 내가 싫어하는 인간은 아닐지도 모르겠군.' },
  { type:'narration', text:'나는 안도의 숨을 내쉬었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'그럼 저 계속 같이 있어도 되는 거죠?' },
  { type:'line', speaker:HYUNJAE, text:'이미 같이 다니고 있잖아.' },
  { type:'line', speaker:HYUNJAE, text:'가자. 아직 던전은 끝나지 않았으니까.' },
  { type:'narration', text:'나는 그의 뒤를 따라 걸었다.' },
  { type:'narration', text:'조금 전보다 발걸음이 가벼워진 것 같았다.', stopBgm:true },
];
const EP2_DUNGEON_CONFESSION_AGREE = [
  { type:'narration', text:'나는 잠시 고민하다 고개를 끄덕였다.' },
  { type:'line', speaker:EP2_PLAYER, text:'그럴 수도 있겠네요.' },
  { type:'narration', text:'김현재가 나를 바라봤다.' },
  { type:'line', speaker:HYUNJAE, text:'그렇지?' },
  { type:'line', speaker:EP2_PLAYER, text:'욕심 때문에 다른 종족과 싸우는 건 인간도 똑같은 것 같아요.' },
  { type:'line', speaker:HYUNJAE, text:'역시 그렇게 생각하는군.' },
  { type:'narration', text:'김현재는 만족한 듯 다시 걸음을 옮겼다.' },
  { type:'narration', text:'나는 그의 뒤를 따라가며 조용히 입을 다물었다.' },
  { type:'thought', text:'사실 나는 인간이었다.' },
  { type:'thought', text:'방금 내가 한 말이 거짓말이라는 사실이 조금 찔렸다.' },
  { type:'thought', text:'하지만 굳이 지금 말할 필요는 없었다.' },
  { type:'line', speaker:HYUNJAE, text:'인간이라……. 언젠가는 이 세계에서 사라져야 할 종족일지도 모르지.' },
  { type:'narration', text:'나는 순간 걸음을 멈췄다.' },
  { type:'narration', text:'그 말을 듣자 이상하게 가슴이 답답해졌다.' },
  { type:'narration', text:'하지만 아무 말도 하지 않았다.' },
  { type:'narration', text:'나는 그저 그의 뒤를 따라 던전 깊숙한 곳으로 걸어갔다.', stopBgm:true },
];
function playEp2DungeonConfessionIntro(){
  // EP2_DUNGEON_CONFESSION_INTRO 첫 줄엔 showBg/chars가 없다(카페에서 이어지는 대사) - 이어하기로
  // 이 지점에 바로 들어오면 배경/김현재가 안 맞을 수 있어 씬 시작점에 명시한다(신고받아 수정).
  setBg('dungeon_inside');
  setChars({left:null, center:'hyunjae', right:null}, true);
  playQueue(EP2_DUNGEON_CONFESSION_INTRO.slice(), showEp2DungeonConfessionChoice);
}
function showEp2DungeonConfessionChoice(){
  showChoiceGeneric(EP2_DUNGEON_CONFESSION_CHOICE, (opt)=>{
    // 원문 s#5->s#6 경계(귀환의 돌이 다시 빛나는 최종 선택 진입) - 씬 번호가 바뀌므로 티켓 게이트.
    if(opt.key === 'honest'){
      ep2CafeAffection += 1;
      playQueue(EP2_DUNGEON_CONFESSION_HONEST.slice(), ()=> gateNextScene('ep2_scene6_dungeon', playEp2DungeonFinalChoiceIntro, getEp2State()));
    } else {
      playQueue(EP2_DUNGEON_CONFESSION_AGREE.slice(), ()=> gateNextScene('ep2_scene6_dungeon', playEp2DungeonFinalChoiceIntro, getEp2State()));
    }
  });
}

const EP2_DUNGEON_FINAL_CHOICE_INTRO = [
  { type:'narration', text:'그렇게 김현재와 함께 던전을 돌아다니며 여러 날을 보냈다.' },
  { type:'narration', text:'처음에는 모든 것이 낯설었다.' },
  { type:'narration', text:'몬스터를 잡고, 마법사들과 이야기를 나누고, 마죽동에서 이상한 음료를 마시는 것도 어느새 익숙해졌다.' },
  { type:'narration', text:'갈 곳이 없던 나를 위해 김현재는 주막까지 구해줬다.' },
  { type:'line', speaker:HYUNJAE, text:'당분간 여기서 지내.' },
  { type:'line', speaker:EP2_PLAYER, text:'이렇게까지 해줘도 괜찮아요?' },
  { type:'line', speaker:HYUNJAE, text:'갈 곳 없는 놈을 내버려 두는 것도 이상하잖아.' },
  { type:'narration', text:'그렇게 며칠을 함께 지냈다.' },
  { type:'narration', text:'어느 순간부터 이곳의 생활이 꽤 편하게 느껴지기 시작했다.' },
  { type:'narration', text:'그러던 어느 날 밤.' },
  { type:'narration', text:'주막 방에서 주머니를 정리하던 중이었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……어?' },
  { type:'itemReveal', item:EP2_IMG_RETURN_STONE },
  { type:'narration', text:'잊고 있던 물건 하나가 손에 잡혔다.' },
  { type:'narration', text:'최재혁 할아버지가 건네준 귀환의 돌이었다.' },
  { type:'narration', text:'그런데 돌에서 희미한 빛이 새어 나오고 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이게 왜…….' },
  { type:'narration', text:'손에 쥐는 순간 빛이 더욱 강해졌다.' },
  { type:'narration', text:'나는 직감했다.' },
  { type:'thought', text:'이제 선택해야 한다.' },
  { type:'thought', text:'이곳에 남을 것인가.' },
  { type:'thought', text:'아니면 원래 세계로 돌아갈 것인가.' },

];
const EP2_DUNGEON_FINAL_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 이곳에 남는다.', key:'stay' },
    { label:'② 귀환의 돌을 사용해 원래 세계로 돌아간다.', key:'return' },
  ],
};
/* ---- ① 이곳에 남는다 -> 김현재 방랑자 앤딩(ep2_end16) ---- */
const EP2_DUNGEON_END_STAY = [
  { type:'itemHide' },  
  { type:'narration', text:'나는 귀환의 돌을 멀리 던져버렸다. 돌은 그 자리에서 산산조각이 되었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……여기에 남을게.' },
  { type:'narration', text:'그날 이후로도 나는 김현재와 함께 지냈다.', showBg:'end16', chars:{center:null}, bgm:'1-08. Daily Routine 247' },
  { type:'narration', text:'시간은 생각보다 빠르게 흘렀다.' },
  { type:'narration', text:'던전을 돌고, 마법사들과 어울리고, 가끔은 마죽동에 들러 음료를 마셨다.' },
  { type:'narration', text:'그런데 어느 날 거울을 보다가 이상한 점을 발견했다.' },
  { type:'narration', text:'내 얼굴에 작은 주름이 생겨 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……벌써 이렇게 됐나.' },
  { type:'narration', text:'김현재는 그대로였다.' },
  { type:'narration', text:'나는 결국 그에게 사실을 털어놓았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'현재야.' },
  { type:'line', speaker:HYUNJAE, text:'왜?' },
  { type:'line', speaker:EP2_PLAYER, text:'나…… 인간이야.' },
  { type:'narration', text:'김현재는 잠시 나를 바라봤다.' },
  { type:'narration', text:'놀란 표정이었지만 예전처럼 적대적이지는 않았다.' },
  { type:'line', speaker:HYUNJAE, text:'알고 있었어.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭐?' },
  { type:'line', speaker:HYUNJAE, text:'네가 처음 왔을 때부터 어느 정도는 짐작했지.' },
  { type:'line', speaker:HYUNJAE, text:'하지만 이제 확실해졌군.' },
  { type:'narration', text:'나는 씁쓸하게 웃었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'난 인간이라 늙어. 언젠가는 죽겠지.' },
  { type:'narration', text:'잠시 침묵이 흘렀다.' },
  { type:'line', speaker:EP2_PLAYER, text:'그러니까 부탁 하나만 할게.' },
  { type:'line', speaker:HYUNJAE, text:'뭔데?' },
  { type:'line', speaker:EP2_PLAYER, text:'인류를 멸망시킬 생각이라면…… 그러지 마.' },
  { type:'narration', text:'김현재는 한동안 아무 말도 하지 않았다.' },
  { type:'narration', text:'그러다 의미심장한 미소를 지었다.' },
  { type:'line', speaker:HYUNJAE, text:'네가 아직도 그렇게 생각하고 있구나.' },
  { type:'line', speaker:EP2_PLAYER, text:'뭘?' },
  { type:'narration', text:'그는 등을 돌렸다.' },
  { type:'line', speaker:HYUNJAE, text:'인류의 멸망이 내가 결정할 수 있는 일이라고.' },
  { type:'line', speaker:EP2_PLAYER, text:'…….' },
  { type:'line', speaker:HYUNJAE, text:'이미 시작된 일은, 누군가의 마음만으로 멈출 수 없는 법이야.' },
  { type:'narration', text:'나는 그 말의 의미를 이해할 수 없었다.' },
  { type:'narration', text:'그리고 김현재는 나에게 무언가를 건넸다.' },
  { type:'narration', text:'그것은 쪽지였다. 거기에는 이렇게 적혀있었다.' },
  { type:'narration', text:'『이 쪽지는 어느 고대 도시의 나그네 이야기에서 최초로 시작되어 일 년에 한 바퀴를 돌면서 받는 사람에게 행운을 주었고, 지금은 당신에게로 옮겨진 이 쪽지는 일정한 수열을 이루면서 전 세계적으로 퍼져나가고 있습니다. 또한 쪽지는 당신 곁을 떠나야 합니다. 이 편지를 포함해서 7통을 행운이 필요한 사람에게 보내 주셔야 합니다. 혹 미신이라 하실지 모르지만 사실입니다.』' },
  { type:'line', speaker:EP2_PLAYER, text:'이게 뭐야……' },
  { type:'narration', text:'그리고 그날 밤.' },
  { type:'narration', text:'김현재는 평소보다 훨씬 늦게까지 던전 깊숙한 곳에 있었다.' },
];
/* ---- ② 귀환의 돌로 귀환, 김현재 호감도 2 미만 -> 그대로인 세상 앤딩(ep2_end15, 공용) ---- */
const EP2_DUNGEON_END_RETURN_LOW = [
  { type:'itemHide' },
  { type:'narration', text:'나는 귀환의 돌을 손에 쥐었다.' },
  { type:'narration', text:'이곳에서 지낸 시간이 짧지는 않았지만, 결국 돌아가기로 했다.', bgm:'Fading Static' },
  { type:'narration', text:'나는 김현재를 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'현재야.' },
  { type:'line', speaker:HYUNJAE, text:'왜?' },
  { type:'line', speaker:EP2_PLAYER, text:'한 가지만 부탁할게.' },
  { type:'narration', text:'나는 잠시 망설이다 입을 열었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'인류의 멸망을 막아줘.' },
  { type:'narration', text:'김현재의 표정이 굳었다.' },
  { type:'narration', text:'무언가 대답하려는 듯 입을 열었지만, 나는 그 말을 들을 용기가 없었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'미안해.' },
  { type:'narration', text:'귀환의 돌이 강하게 빛났다.' },
  { type:'narration', text:'순간 시야가 새하얗게 물들었다.', whiteout:true, se:'SE_Teleport_01a' },
  { type:'narration', text:'눈을 떴다.', showBg:'player_home', noBgFade:true, whiteout:false, chars:{center:null} },
  { type:'narration', text:'익숙한 천장이 보였다.' },
  { type:'narration', text:'내 방이었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……돌아왔구나.' },
  { type:'narration', text:'휴대폰을 확인했다.' },
  { type:'narration', text:'날짜도, 시간도 내가 떠났던 때와 크게 다르지 않았다.' },
  { type:'narration', text:'거리로 나가보니 세상은 아무 일도 없었다는 듯 돌아가고 있었다.' },
  { type:'narration', text:'사람들은 출근하고 있었고, 뉴스에서는 저출산과 고령화에 대한 이야기가 흘러나왔다.' },
  { type:'narration', text:'인터넷에서는 세대 갈등과 젠더 갈등이 끊이지 않았다.' },
  { type:'narration', text:'정치와 지역, 빈부의 문제로 사람들은 계속 서로를 비난하고 있었다.' },
  { type:'narration', text:'나는 멍하니 화면을 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……아무것도 변하지 않았어.' },
  { type:'narration', text:'세계는 그대로였다.', showBg:'end15', noBgFade:true },
  { type:'narration', text:'아니.' },
  { type:'narration', text:'어쩌면 내가 떠나기 전부터 이미 무언가가 조금씩 무너지고 있었던 걸지도 모른다.' },
  { type:'narration', text:'그때 문득 김현재의 마지막 표정이 떠올랐다.' },
  { type:'narration', text:'나는 아직 그의 대답을 듣지 못했다.' },
];
/* ---- ② 귀환의 돌로 귀환, 김현재 호감도 2 이상 -> 김현재의 행복한 세상 앤딩(ep2_end12) ---- */
const EP2_DUNGEON_END_RETURN_HIGH = [
  { type:'itemHide' },
  { type:'narration', text:'나는 귀환의 돌을 손에 쥐었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'현재야.' },
  { type:'line', speaker:EP2_PLAYER, text:'나 이제 돌아가.', bgm:'2.11 Starry Confession' },
  { type:'narration', text:'그는 아무 말도 하지 않았다.' },
  { type:'narration', text:'나는 잠시 망설이다가 말했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'부탁 하나만 할게.' },
  { type:'line', speaker:HYUNJAE, text:'뭔데?' },
  { type:'line', speaker:EP2_PLAYER, text:'멸망을 막아줘.' },
  { type:'narration', text:'김현재의 눈빛이 흔들렸다.' },
  { type:'line', speaker:HYUNJAE, text:'…….' },
  { type:'narration', text:'그가 무언가 말하려는 순간, 귀환의 돌이 강하게 빛났다.' },
  { type:'line', speaker:EP2_PLAYER, text:'미안. 대답은 다음에 들을게.' },
  { type:'narration', text:'나는 그대로 귀환의 돌을 작동시켰다.', whiteout:true, se:'SE_Teleport_01a' },
  { type:'narration', text:'눈을 뜨자 익숙한 방이 보였다.', showBg:'player_home', noBgFade:true, whiteout:false, chars:{center:null} },
  { type:'narration', text:'현실로 돌아온 것이다.' },
  { type:'narration', text:'처음에는 아무것도 달라진 게 없어 보였다.' },
  { type:'narration', text:'하지만 밖으로 나가자 이상한 점들이 하나둘 눈에 들어왔다.' },
  { type:'narration', text:'횡단보도에서 한 사람이 유모차를 끌던 노인에게 먼저 길을 양보하고 있었다.', showBg:'end12' },
  { type:'narration', text:'카페에서는 누군가 주문이 늦어졌다고 화를 내는 대신 직원에게 괜찮다며 웃었다.' },
  { type:'narration', text:'휴대폰을 확인하자 더 놀라운 일이 벌어지고 있었다.' },
  { type:'narration', text:'인터넷에서는 서로 다른 세대와 성별을 비난하는 글보다 서로의 입장을 이해하려는 글이 훨씬 많이 보였다.' },
  { type:'narration', text:'뉴스에서는 지역 간 갈등을 줄이기 위한 협력과 청년·노년층을 위한 새로운 정책들이 연이어 보도되고 있었다.' },
  { type:'narration', text:'아주 작은 변화였다.' },
  { type:'narration', text:'하지만 분명히 느낄 수 있었다.' },
  { type:'narration', text:'사람들이 조금씩 서로를 바라보기 시작했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……이게 대체 어떻게 된 거지?' },
  { type:'narration', text:'나는 주머니 속 귀환의 돌을 바라봤다.' },
  { type:'narration', text:'그리고 문득 김현재가 떠올랐다.' },
  { type:'thought', text:'그가 내 부탁을 들어준 것일까?' },
  { type:'thought', text:'아니면…….' },
  { type:'narration', text:'나는 알 수 없었다.' },
  { type:'narration', text:'하지만 한 가지는 확실했다.' },
  { type:'narration', text:'세계는 변하기 시작했다.' },
  { type:'narration', text:'아주 미미하게.' },
  { type:'narration', text:'그러나 확실하고 강렬하게.' },
];
function playEp2DungeonFinalChoiceIntro(){
  // EP2_DUNGEON_FINAL_CHOICE_INTRO 첫 줄엔 showBg/chars가 없다 - 이어하기 대비 씬 시작점에 명시한다
  // (신고받아 수정).
  setBg('dungeon_inside');
  setChars({left:null, center:'hyunjae', right:null}, true);
  playQueue(EP2_DUNGEON_FINAL_CHOICE_INTRO.slice(), showEp2DungeonFinalChoice);
}
function showEp2DungeonFinalChoice(){
  showChoiceGeneric(EP2_DUNGEON_FINAL_CHOICE, (opt)=>{
    if(opt.key === 'stay'){
      playQueue(EP2_DUNGEON_END_STAY.slice(), ()=> showEp2Ending('김현재 방랑자 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['김현재 방랑자 앤딩']));
    } else if(ep2CafeAffection >= 2){
      playQueue(EP2_DUNGEON_END_RETURN_HIGH.slice(), ()=> showEp2Ending('김현재의 행복한 세상 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['김현재의 행복한 세상 앤딩']));
    } else {
      playQueue(EP2_DUNGEON_END_RETURN_LOW.slice(), ()=> showEp2Ending('그대로인 세상 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['그대로인 세상 앤딩']));
    }
  });
}

/* =========================================================
   아카데미/탑(academy/tower) 공용 루트 - 카페 이후 대광장에서 이종복과 임소정이 마법의 보편화를 두고
   충돌하는 장면으로 합류한다(어느 카페를 갔든 둘 다 등장). 돕는 쪽에 따라 ep2AffJongbok/ep2AffSojung가
   갈리고, 화해를 시도하면 즉시 배드엔드로 끝난다.
   ========================================================= */
const EP2_PLAZA_FIGHT_INTRO = [
  { type:'narration', text:'나는 그곳에 도착한 뒤, 당분간 머물 수 있는 작은 거처를 구했다.' },
  { type:'narration', text:'낯선 시대였다.' },
  { type:'narration', text:'내가 알고 있던 역사와는 전혀 다른 세계였기에, 나는 이곳이 어떤 곳인지 조금씩 조사하기 시작했다.' },
  { type:'narration', text:'그러던 어느 날.' },
  { type:'narration', text:'대광장 쪽에서 큰 소리가 들려왔다.', showBg:'grand_plaza_day' },
  { type:'line', speaker:JONGBOK2, text:'임소정. 마법은 더 이상 마법사들만의 것이 아니야!', chars:{left:'jongbok_past', right:'sojung_past'}, emphasis:true, bgm:'17. Formless Dream' },
  { type:'narration', text:'광장 한가운데서 이종복과 임소정이 서로를 마주 보고 있었다.' },
  { type:'line', speaker:SOJUNG2, text:'모든 인간에게 마법을 가르치겠다는 건가?' },
  { type:'narration', text:'임소정이 차갑게 물었다.' },
  { type:'line', speaker:JONGBOK2, text:'그래. 마법을 독점하는 시대는 끝나야 해.' },
  { type:'line', speaker:SOJUNG2, text:'힘을 가진 자가 책임질 수 없다면 그 힘은 재앙이 된다.' },
  { type:'line', speaker:JONGBOK2, text:'그건 힘을 가진 자들이 결정할 문제가 아니야!' },
  { type:'narration', text:'두 사람의 마법이 충돌했다.' },
  { type:'narration', text:'이종복은 빨간색 마법진을 그리며 질량 충격파를 쏘아댔고, 임소정도 거기에 맞서 전자기파를 발사했다.' },
  { type:'narration', text:'두 마법은 아름답게 공중에서 만나 흡수, 상쇄를 반복하고 있었다.' },
  // 대사 없이 폭발 이펙트와 함께 배경만 대광장(낮)에서 폐허로 바뀐다(요청됨) - 친구 소환 전투 인트로의
  // 암전+폭발 전환(EP2_CRISIS_BATTLE_JUHEON_INTRO 등)과 같은 silentEffect 패턴이지만, 그쪽과 달리
  // 스탠딩(이종복/임소정)은 그대로 유지한다(chars를 지정하지 않음).
  { type:'silentEffect', showBg:'grand_plaza_ruins', noBgFade:true, explosion:'large', holdMs:900 },
  { type:'narration', text:'광장 바닥이 갈라지고 주변의 마법진이 연쇄적으로 빛났다.' },
  { type:'line', speaker:SOJUNG2, text:'이종복! 당장 멈춰!' },
  { type:'line', speaker:JONGBOK2, text:'싫어!' },
  { type:'line', speaker:SOJUNG2, text:'그렇다면……!' },
  { type:'narration', text:'임소정의 손끝에 거대한 마법진이 나타났다.' },
  { type:'narration', text:'하지만 이종복 역시 마지막 마법을 준비하고 있었다.' },
  { type:'narration', text:'두 사람 모두 물러설 생각이 없어 보였다.' },
  { type:'narration', text:'그리고 다음 순간.' },
  { type:'narration', text:'두 마법이 정면으로 충돌했다.', impact:true },
  { type:'line', speaker:SOJUNG2, text:'으윽!', hitFlash:'right' },
  { type:'line', speaker:JONGBOK2, text:'크윽!', hitFlash:'left' },
  { type:'narration', text:'서로의 마법이 균형을 이루며 폭발 직전까지 치달았다.' },
  { type:'thought', text:'재혁 할아버지가 나에게 무언가를 말하고자 하는 것 같았다. 이 일이 아주 중요한 사건이라고.' },
  { type:'thought', text:'나는 무언가를 해야만 했다.' },
];
const EP2_PLAZA_FIGHT_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 마법의 보편화를 주장하는 이종복을 도운다.', key:'jongbok' },
    { label:'② 마법의 보편화를 반대하는 임소정을 도운다.', key:'sojung' },
    { label:'③ 둘의 화해와 절충을 도운다.', key:'mediate' },
  ],
};
/* ---- ① 이종복을 도운다(호감도 +1) ---- */
const EP2_PLAZA_FIGHT_HELP_JONGBOK = [
  { type:'narration', text:'나는 두 사람 사이로 나섰다.', stopBgm:true },
  { type:'line', speaker:EP2_PLAYER, text:'임소정 대마법사님!' },
  { type:'narration', text:'임소정의 시선이 나에게 향했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'그러시면 안 돼요!' },
  { type:'line', speaker:EP2_PLAYER, text:'마법은 일부 마법사들만의 것이 되어서는 안 된다고 생각해요. 모두가 마법을 사용할 수 있게 하는 게 좋을 것 같아요!' },
  { type:'narration', text:'잠시 정적이 흘렀다.' },
  { type:'narration', text:'임소정의 표정이 차갑게 굳었다.' },
  { type:'line', speaker:SOJUNG2, text:'……네놈까지도 이상한 신념에 얽매여 헛소리만 지껄이는구나.', bgm:'03.Interface Hard Arrange' },
  { type:'narration', text:'그녀의 손끝에서 거대한 전류가 일렁였다.' },
  { type:'line', speaker:SOJUNG2, text:'그렇다면 네놈부터 처리해주마.' },
  { type:'line', speaker:JONGBOK2, text:'안 돼!', emphasis:true },
  { type:'line', speaker:JONGBOK2, text:'무고한 자들을 대상으로 마법을 사용하지 말라는 규율을 잊었는가!' },
  { type:'line', speaker:SOJUNG2, text:'무고하다고?' },
  { type:'line', speaker:SOJUNG2, text:'이상한 가치관을 보유하는 것 자체가 이미 커다란 죄를 지었다고 판단했다.' },
  { type:'line', speaker:JONGBOK2, text:'임소정…….' },
  { type:'line', speaker:JONGBOK2, text:'나는 네가 이 정도로 변해버렸을 줄은 몰랐다.' },
  { type:'narration', text:'그의 주변에 붉은 마법진이 겹겹이 펼쳐졌다.' },
  { type:'line', speaker:JONGBOK2, text:'그렇다면 나 역시 더 이상 봐줄 수 없겠군.' },
  { type:'narration', text:'순간, 거대한 질량 충격파가 광장을 휩쓸었다.' },
  { type:'narration', text:'콰아아앙!', impact:true, hitFlash:'right' },
  { type:'narration', text:'임소정의 몸이 충격에 휘말려 멀리 날아갔다.', staggerCollapse:'right' },
  { type:'line', speaker:SOJUNG2, text:'으윽……!' },
  { type:'narration', text:'그녀는 피를 흘리며 몸을 일으켰다.', chars:{right:'sojung_past'} },
  { type:'line', speaker:SOJUNG2, text:'……오늘은 물러나겠다.' },
  { type:'narration', text:'순간 그녀의 발밑에 마법진이 나타났다.' },
  { type:'line', speaker:SOJUNG2, text:'하지만 이걸로 끝이라고 생각하지 마라.' },
  { type:'narration', text:'번쩍!', chars:{right:null} },
  { type:'narration', text:'임소정은 그대로 사라졌다.' },
  { type:'narration', text:'광장에는 무거운 침묵만이 남았다.', stopBgm:true },
];
/* ---- ② 임소정을 도운다(호감도 +1) ---- */
const EP2_PLAZA_FIGHT_HELP_SOJUNG = [
  { type:'narration', text:'나는 두 사람의 싸움을 바라보며 깊은 생각에 빠졌다.', stopBgm:true },
  { type:'thought', text:'아무래도 내가 나서서 이종복 대마법사님께 의견을 전달해야겠어.' },
  { type:'thought', text:'미래의 인류를 알고 있는 내가 보기에는…… 마법이 보편화되어서는 안 될 것 같았다.' },
  { type:'thought', text:'사람들에게 마법이 주어진다면, 그 힘은 어떻게 사용될까?' },
  { type:'narration', text:'그 순간이었다.' },
  { type:'line', speaker:SOJUNG2, text:'……이제 끝이다, 이종복.', bgm:'03.Interface Hard Arrange' },
  { type:'narration', text:'임소정의 목소리가 들렸다.' },
  { type:'narration', text:'그녀의 주변으로 검은 마법진이 겹겹이 펼쳐졌다.' },
  { type:'line', speaker:JONGBOK2, text:'그건…… 붕괴마법!' },
  { type:'narration', text:'이종복의 얼굴이 굳었다.' },
  { type:'narration', text:'콰아아앙!', showBg:'fight', noBgFade:true, explosion:'large', chars:{left:null, right:null} },
  { type:'narration', text:'검은 빛이 이종복의 몸을 집어삼켰다.' },
  { type:'line', speaker:JONGBOK2, text:'크아아악!' },
  { type:'narration', text:'붕괴마법.' },
  { type:'narration', text:'신체와 영혼을 강제로 분리시켜 육체 자체를 붕괴시키는 금지된 마법이었다.' },
  { type:'narration', text:'이종복의 몸이 서서히 무너지기 시작했다.' },
  { type:'line', speaker:JONGBOK2, text:'임소정…… 네가…… 이런 마법까지……!', emphasis:true },
  { type:'narration', text:'임소정은 차가운 표정으로 그를 바라봤다.' },
  { type:'line', speaker:SOJUNG2, text:'마법을 누구에게나 나누겠다는 네 이상이야말로 이 세계를 무너뜨릴 것이다.' },
  { type:'line', speaker:JONGBOK2, text:'아아아악!', emphasis:true },
  { type:'narration', text:'이종복의 절규가 대광장 전체에 울려 퍼졌다.' },
  { type:'narration', text:'서서히 몸이 빨갛게 변해가면서 형체를 잃어갔다.', chars:{left:null} },
  { type:'narration', text:'나는 그 모습을 바라보며 굳어버렸다.' },
  { type:'thought', text:'내가 옳은 선택을 한 것인지조차 알 수 없었다.', stopBgm:true },
];
/* ---- ③ 화해를 돕는다 -> 즉시 배드엔드: 두 대마법사에 의한 죽음 앤딩(ep2_end8) ---- */
const EP2_PLAZA_FIGHT_MEDIATE_BADEND = [
  { type:'narration', text:'나는 두 사람 사이를 바라봤다.' },
  { type:'narration', text:'이종복은 마법의 보편화를 주장했고, 임소정은 그것을 막으려 했다.', stopBgm:true },
  { type:'narration', text:'나는 어느 한쪽도 선택하고 싶지 않았다.' },
  { type:'line', speaker:EP2_PLAYER, text:'두 분 다…… 잠시 멈춰주세요.' },
  { type:'narration', text:'두 사람의 시선이 동시에 나에게 향했다.' },
  { type:'line', speaker:EP2_PLAYER, text:'마법을 모두에게 주는 것도, 완전히 막는 것도 답은 아닐 수 있잖아요.' },
  { type:'line', speaker:EP2_PLAYER, text:'서로 조금씩 양보하면…… 방법을 찾을 수 있을 거예요.' },
  { type:'narration', text:'하지만 돌아온 것은 침묵이었다.' },
  { type:'line', speaker:JONGBOK2, text:'그래서 네가 하고 싶은 말이 뭐지?' },
  { type:'line', speaker:EP2_PLAYER, text:'저는…….' },
  { type:'narration', text:'말이 나오지 않았다.' },
  { type:'line', speaker:SOJUNG2, text:'확고한 신념 하나 없이 양쪽 모두에게 옳은 소리만 하려는군.' },
  { type:'line', speaker:EP2_PLAYER, text:'그게 아니라…….' },
  { type:'line', speaker:SOJUNG2, text:'그런 자가 가장 위험한 법이지.' },
  { type:'line', speaker:JONGBOK2, text:'소정의 말이 맞는 것 같군.' },
  { type:'line', speaker:EP2_PLAYER, text:'두 분…….' },
  { type:'narration', text:'두 사람의 마법진이 동시에 빛났다.' },
  { type:'line', speaker:EP2_PLAYER, text:'잠깐만요!', emphasis:true },
  { type:'narration', text:'나는 뒷걸음질쳤다.' },
  { type:'narration', text:'하지만 이미 늦었다.' },
  { type:'narration', text:'두 개의 마법이 나를 향해 날아왔다.', showBg:'end8', noBgFade:true, explosion:'large', chars:{left:null, right:null}, bgm:'09.Final Destination of Ark' },
  { type:'narration', text:'그리고—' },
  { type:'narration', text:'여기까지가 내 이야기다.' },
  { type:'narration', text:'내가 왜 그곳에 갔는지.' },
  { type:'narration', text:'무엇을 보았는지.' },
  { type:'narration', text:'그리고 마지막 순간에 무엇을 선택했는지.' },
  { type:'narration', text:'지금 생각해보면 나는 아무것도 선택하지 않았다.' },
  { type:'narration', text:'마법이든, 인간이든.' },
  { type:'narration', text:'어느 한쪽의 손도 제대로 잡지 못했다.' },
  { type:'thought', text:'어쩌면 확고한 이념이 없는 것만큼 최악인 것도 없었을 것이다.' },
  { type:'narration', text:'나는 마지막 순간까지도 고민하고 있었다.' },
  { type:'thought', text:'어느 쪽이 옳은 거지?' },
  { type:'narration', text:'그 답을 찾기도 전에 세상이 뒤집혔다.' },
  { type:'narration', text:'빛이 시야를 가득 채웠다.' },
  { type:'narration', text:'그리고 모든 것이 끝났다.' },
];
function playEp2PlazaFightIntro(){
  // 직전 카페 씬이 어느 경로였든(아카데미=이종복, 탑=임소정) 그 상대가 center 슬롯에 그대로 남아있는
  // 채로 이 씬의 첫 줄이 left/right만 채우면(chars:{left:'jongbok_past', right:'sojung_past'}) center의
  // 인물이 지워지지 않아 같은 사람이 두 슬롯에 겹쳐 보이는 버그가 있었다(신고받아 수정) - 씬 진입 시
  // 세 슬롯을 전부 비워 새로 시작한다.
  el.charLeft.classList.remove('show');
  el.charCenter.classList.remove('show');
  el.charRight.classList.remove('show');
  curLeftKey = null; curCenterKey = null; curRightKey = null;
  // EP2_PLAZA_FIGHT_INTRO 첫 줄에도 showBg가 없다 - 이어하기 대비 씬 시작점에 명시한다(신고받아 수정).
  setBg('grand_plaza_day');
  playQueue(EP2_PLAZA_FIGHT_INTRO.slice(), showEp2PlazaFightChoice);
}
function showEp2PlazaFightChoice(){
  showChoiceGeneric(EP2_PLAZA_FIGHT_CHOICE, (opt)=>{
    // 원문 s#5->s#6 경계(대광장 재건 이후 귀환의 돌 선택 진입) - 씬 번호가 바뀌므로 티켓 게이트.
    // (화해/절충 선택은 그 자리에서 즉시 배드엔드로 끝나 s#6까지 가지 않으므로 게이트가 없다.)
    if(opt.key === 'jongbok'){
      ep2AffJongbok += 1;
      playQueue(EP2_PLAZA_FIGHT_HELP_JONGBOK.slice(), ()=> gateNextScene('ep2_scene6_plazafight', playEp2PlazaStayOrReturnIntro, getEp2State()));
    } else if(opt.key === 'sojung'){
      ep2AffSojung += 1;
      playQueue(EP2_PLAZA_FIGHT_HELP_SOJUNG.slice(), ()=> gateNextScene('ep2_scene6_plazafight', playEp2PlazaStayOrReturnIntro, getEp2State()));
    } else {
      playQueue(EP2_PLAZA_FIGHT_MEDIATE_BADEND.slice(), ()=> showEp2Ending('두 대마법사에 의한 죽음 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['두 대마법사에 의한 죽음 앤딩']));
    }
  });
}

const EP2_PLAZA_STAY_OR_RETURN_INTRO = [
  { type:'narration', text:'그렇게 모든 일이 지나갔다.', stopBgm:true },
  { type:'narration', text:'놀랍게도 이 세계는 아무 일도 없었다는 듯 다시 움직이기 시작했다.' },
  { type:'narration', text:'무너졌던 대광장은 마법사들이 힘을 합쳐 재건하기 시작했고, 불과 며칠 만에 원래 모습을 되찾았다.', showBg:'grand_plaza_day' },
  { type:'narration', text:'서로 싸우던 마법사들이 한마음으로 움직이는 모습을 보며 생각했다.' },
  { type:'thought', text:'협력한다는 건…… 이런 걸까.' },
  { type:'narration', text:'하지만 한 가지는 확실히 달라져 있었다.' },
  { type:'narration', text:'마법의 보편화를 둘러싼 논쟁은 이제 한쪽으로 완전히 기울어져 있었다.' },
  { type:'narration', text:'누군가는 떠났고, 누군가는 다쳤다.' },
  { type:'thought', text:'결국 통일이라는 것은 누군가의 희생 없이는 이루기 힘든 걸까.' },
  { type:'thought', text:'아니면 세상이라는 게 원래 그런 걸까.' },
  { type:'thought', text:'한쪽이 얻으면 다른 한쪽은 잃는 제로섬 게임.' },
  { type:'narration', text:'나는 아직 답을 찾지 못했다.' },
  { type:'narration', text:'그때였다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……응?' },
  { type:'narration', text:'주머니에서 무언가 빛나고 있었다.' },
  { type:'itemReveal', item:EP2_IMG_RETURN_STONE },
  { type:'narration', text:'꺼내보니 잊고 있었던 귀환의 돌이었다.' },
  { type:'narration', text:'희미한 빛이 점점 강해지고 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'이제…… 결정해야 하는 건가.' },
  { type:'narration', text:'나는 귀환의 돌을 바라봤다.' },
  { type:'thought', text:'이곳에 남을 것인가.' },
  { type:'thought', text:'아니면 원래 세계로 돌아갈 것인가.' },
  { type:'narration', text:'손끝에 돌의 온기가 느껴졌다.' },
  { type:'narration', text:'이번에는 누구도 대신 결정해주지 않는다.' },
];
const EP2_PLAZA_STAY_OR_RETURN_CHOICE = {
  prompt: '어떻게 할까?',
  options: [
    { label:'① 이곳에 남는다.', key:'stay' },
    { label:'② 귀환의 돌을 사용해 원래 세계로 돌아간다.', key:'return' },
  ],
};
// 방랑자 엔딩 3종의 도입부(귀환의 돌을 다시 넣고 남기로 함)는 공통이고, 그 뒤 누가 찾아오는지만 다르다.
const EP2_PLAZA_END_STAY_INTRO = [
  { type:'narration', text:'나는 한참 동안 귀환의 돌을 바라봤다.' },
  { type:'itemHide' },
  { type:'line', speaker:EP2_PLAYER, text:'……여기에 남을게.' },
  { type:'narration', text:'원래 세계로 돌아가는 것도, 이곳에 남는 것도 쉬운 선택은 아니었다.' },
  { type:'narration', text:'하지만 이미 너무 많은 것을 보고 겪었다.' },
  { type:'narration', text:'나는 이곳에서 내 방식대로 살아보기로 했다.' },
];
// 방랑자 엔딩 3종의 결말부(마을을 떠돌며 살아가기로 함)도 공통이다 - 누가 찾아왔는지 회상하는
// 마지막 두 문장만 살짝 다르다(원문 그대로: 임소정 루트는 "아직도 모르겠다", 이종복 루트는
// "다시 생각을 거듭할수록 미지로 빠져만 간다", 평범한 루트는 "아직도 모르겠다").
function ep2PlazaWandererTail(lastThought){
  return [
    { type:'narration', text:'그 후로 나는 마법사들과 어울리려고 노력했다.', showBg:'end19', bgm:'Defective_Pixel' },
    { type:'narration', text:'하지만 생각보다 쉽지 않았다.' },
    { type:'narration', text:'나는 마법사도 아니었고, 이 시대의 사람도 아니었다.' },
    { type:'narration', text:'서로의 가치관과 살아온 방식은 너무나 달랐다.' },
    { type:'narration', text:'그래서 어느 순간부터는 굳이 누군가에게 속하려 하지 않았다.' },
    { type:'narration', text:'마을을 떠나고, 숲을 지나고, 때로는 던전에 들어갔다.' },
    { type:'narration', text:'정해진 목적지도 없이 이곳저곳을 돌아다녔다.' },
    { type:'narration', text:'누군가는 나를 방랑자라고 불렀다.' },
    { type:'narration', text:'나도 그 이름이 싫지는 않았다.' },
    { type:'narration', text:'가끔 마법사들을 만나기도 했다.' },
    { type:'narration', text:'이종복과 임소정의 이야기를 들을 때면 그날의 광장이 떠올랐다.' },
    { type:'thought', text:lastThought },
    { type:'thought', text:'다만 한 가지는 알 것 같았다.' },
    { type:'thought', text:'세상은 누군가의 선택 하나만으로 움직이지 않는다.' },
    { type:'narration', text:'그리고 나는 그 세상을 직접 돌아다니며 알아가기로 했다.' },
    { type:'narration', text:'언젠가 다시 돌아갈 날이 올지도 모른다.' },
    { type:'narration', text:'혹은 영원히 이곳에서 살아갈지도 모른다.' },
    { type:'narration', text:'그건 이제 중요하지 않았다.' },
    { type:'narration', text:'나는 오늘도 배낭을 메고 길을 걷는다.' },
    { type:'narration', text:'목적지는 없다.' },
    { type:'narration', text:'그저 내가 선택한 길을 따라.' },
  ];
}
/* ---- ①-소정 호감도 +2 -> 노란색 보석 방랑자 앤딩(ep2_end17) ---- */
const EP2_PLAZA_END_STAY_SOJUNG_MID = [
  { type:'narration', text:'그리고 얼마 뒤, 임소정이 나를 찾아왔다.', chars:{center:'sojung_past'} },
  { type:'line', speaker:SOJUNG2, text:'난 너의 정체를 처음부터 알고 있었어. 하지만 그와 동시에 이상한 기운도 공존하고 있었지.' },
  { type:'line', speaker:SOJUNG2, text:'일은 마무리되었지만 네가 바라왔던 것이 이것이 아니겠지. 물론 너희 종족을 완전 배척하겠다는 뜻은 아니었어.' },
  { type:'line', speaker:SOJUNG2, text:'하지만, 나이를 먹을수록 미래에 대한 직감이 느껴진다랄까. 너의 운명마저도 희미하지만 보이네.' },
  { type:'line', speaker:SOJUNG2, text:'네게 필요한 것을 마지막으로 전해줄게.' },
  { type:'narration', text:'그렇게 임소정은 나에게 노란색 보석 하나를 주었다.', showBg:'end17', chars:{center:null}, bgm:'Static in the Static' },
  { type:'narration', text:'물론 이것을 전해주자마자 순간이동으로 사라진 바람에 이것이 무엇을 의미하는지는 못 물어봤다.' },
  { type:'narration', text:'보석을 자세히 보니 어떠한 글귀가 써져있었다.' },
  { type:'narration', text:'『2706m22A』' },
  { type:'thought', text:'나중에 쓰게 되는 날이 오겠지…….' },
];
/* ---- ①-종복 호감도 +2 -> 보라색 보석 방랑자 앤딩(ep2_end18) ---- */
const EP2_PLAZA_END_STAY_JONGBOK_MID = [
  { type:'narration', text:'그리고 얼마 뒤, 이종복이 나를 찾아왔다.', chars:{center:'jongbok_past'} },
  { type:'line', speaker:JONGBOK2, text:'너의 선택이 이 마법계에 큰 변화를 일으켰고, 나는 그에 고맙기 따름이다.' },
  { type:'line', speaker:JONGBOK2, text:'네 생각을 묻지는 않을게. 그리고 네 목적지도 묻지 않을게. 그저 네가 하고 싶은 대로 살아가거라.' },
  { type:'line', speaker:JONGBOK2, text:'그래도 마지막 조우가 될 예정이니 네게 준비한 게 있어. 네게 필요한 것을 마지막으로 전해줄게.' },
  { type:'narration', text:'그렇게 이종복은 나에게 보라색 보석 하나를 주었다. 그리고 터벅터벅 걸어갔다.', showBg:'end18', chars:{center:null}, bgm:'I lost' },
  { type:'narration', text:'난 이것이 무엇을 의미하는지를 몰랐다.' },
  { type:'line', speaker:EP2_PLAYER, text:'대마법사님! 이게 무슨 보석입니까!?' },
  { type:'narration', text:'이종복은 가만히 멈춰섰다. 잠시 정적이 흘렀다.' },
  { type:'line', speaker:JONGBOK2, text:'보석의 이용처는 개인만이 알고 있을 것. 이 보석이 정해진 규칙이다.' },
  { type:'narration', text:'그 말을 뒤로 종복은 걸음을 이어나갔다.' },
  { type:'narration', text:'보석을 자세히 보니 어떠한 글귀가 써져있었다.' },
  { type:'narration', text:'『2706k1821t』' },
  { type:'thought', text:'나중에 쓰게 되는 날이 오겠지…….' },
];
function playEp2PlazaStayOrReturnIntro(){
  // EP2_PLAZA_STAY_OR_RETURN_INTRO 첫 줄엔 showBg가 없다(직전 대결의 폐허 배경에서 이어지다가 3번째
  // 줄에서야 재건된 grand_plaza_day로 바뀐다) - 이어하기 대비 씬 시작점에 폐허 배경을 명시한다
  // (신고받아 수정).
  setBg('grand_plaza_ruins');
  playQueue(EP2_PLAZA_STAY_OR_RETURN_INTRO.slice(), showEp2PlazaStayOrReturnChoice);
}
function showEp2PlazaStayOrReturnChoice(){
  showChoiceGeneric(EP2_PLAZA_STAY_OR_RETURN_CHOICE, (opt)=>{
    if(opt.key === 'stay'){
      if(ep2AffJongbok >= 2){
        playQueue(EP2_PLAZA_END_STAY_INTRO.concat(EP2_PLAZA_END_STAY_JONGBOK_MID, ep2PlazaWandererTail('누가 옳았는지는 다시 생각을 거듭할수록 미지로 빠져만 간다.')),
          ()=> showEp2Ending('보라색 보석 방랑자 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['보라색 보석 방랑자 앤딩']));
      } else if(ep2AffSojung >= 2){
        playQueue(EP2_PLAZA_END_STAY_INTRO.concat(EP2_PLAZA_END_STAY_SOJUNG_MID, ep2PlazaWandererTail('누가 옳았는지는 아직도 모르겠다.')),
          ()=> showEp2Ending('노란색 보석 방랑자 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['노란색 보석 방랑자 앤딩']));
      } else {
        playQueue(EP2_PLAZA_END_STAY_INTRO.concat(ep2PlazaWandererTail('누가 옳았는지는 아직도 모르겠다.')),
          ()=> showEp2Ending('평범한 방랑자 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['평범한 방랑자 앤딩']));
      }
      return;
    }
    if(ep2AffJongbok >= 2){
      playQueue(EP2_PLAZA_END_RETURN_JONGBOK.slice(), ()=> showEp2Ending('이종복의 행복한 세상 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['이종복의 행복한 세상 앤딩']));
    } else if(ep2AffSojung >= 2){
      playQueue(EP2_PLAZA_END_RETURN_SOJUNG.slice(), ()=> showEp2Ending('임소정의 행복한 세상 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['임소정의 행복한 세상 앤딩']));
    } else {
      playQueue(EP2_PLAZA_END_RETURN_NORMAL.slice(), ()=> showEp2Ending('그대로인 세상 앤딩', EP2_ENDING_CATEGORY_BY_TITLE['그대로인 세상 앤딩']));
    }
  });
}
/* ---- ②-소정 호감도 +2 -> 임소정의 행복한 세상 앤딩(ep2_end13) ---- */
const EP2_PLAZA_END_RETURN_SOJUNG = [
  { type:'narration', text:'나는 결국 귀환의 돌을 사용하기로 했다.' },
  { type:'itemHide' },
  { type:'narration', text:'손에 돌을 꼭 쥐었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……이제 돌아가자.' },
  { type:'narration', text:'눈앞이 새하얗게 변했다.', whiteout:true, se:'SE_Teleport_01a' },
  { type:'narration', text:'그리고 다시 눈을 떴을 때.', showBg:'player_home', whiteout:false, chars:{left:null, right:null} },
  { type:'narration', text:'나는 익숙한 거리 한복판에 서 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……돌아왔어.' },
  { type:'narration', text:'처음에는 아무것도 달라 보이지 않았다.' },
  { type:'narration', text:'하지만 곧 이상한 점을 발견했다.' },
  { type:'narration', text:'나는 휴대폰을 꺼내 마법사, 마법 아카데미, 임소정, 이종복을 차례로 검색했다.', showBg:'end13', bgm:'Daily Repeat' },
  { type:'narration', text:'아무것도 나오지 않았다.' },
  { type:'narration', text:'단순히 기록이 없는 정도가 아니었다.' },
  { type:'narration', text:'마법사라는 개념 자체가 이 세상에서 지워진 것처럼 느껴졌다.' },
  { type:'narration', text:'역사에도, 인터넷에도, 소설에도.' },
  { type:'narration', text:'심지어 사람들이 상상 속에서 만들어낸 이야기들 속에서도 마법사의 흔적은 찾아볼 수 없었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……설마.' },
  { type:'narration', text:'나는 한참 동안 검색 화면을 바라봤다.' },
  { type:'thought', text:'내가 겪었던 모든 일이 정말 존재했던 걸까?' },
  { type:'thought', text:'그 세계와 그곳에서 만난 사람들은…… 정말 있었던 걸까?' },
  { type:'narration', text:'하지만 현실의 세계는 너무나 평온했다.' },
  { type:'narration', text:'사람들은 평소처럼 살아가고 있었다.' },
  { type:'narration', text:'사회는 조금씩 문제를 해결해 나가고 있었고, 세상은 특별한 혼란 없이 흘러갔다.' },
  { type:'narration', text:'나는 문득 임소정의 마지막 모습을 떠올렸다.' },
  { type:'narration', text:'그녀가 무엇을 선택했는지는 알 수 없었다.' },
  { type:'narration', text:'다만 한 가지는 확실했다.' },
  { type:'narration', text:'마법이 없는 세계는, 내가 알고 있던 세계보다 평온했다.' },
  { type:'narration', text:'나는 휴대폰을 내려놓았다.' },
  { type:'narration', text:'그리고 아무 말 없이 다시 걸었다.' },
];
/* ---- ②-종복 호감도 +2 -> 이종복의 행복한 세상 앤딩(ep2_end14) ---- */
const EP2_PLAZA_END_RETURN_JONGBOK = [
  { type:'itemHide' },  
  { type:'narration', text:'나는 귀환의 돌을 손에 쥐었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……이제 돌아가자.' },
  { type:'narration', text:'돌에서 강한 빛이 뿜어져 나왔다.' },
  { type:'narration', text:'순간 눈앞의 모든 것이 새하얗게 변했다.', whiteout:true, se:'SE_Teleport_01a' },
  { type:'narration', text:'그리고 다시 눈을 떴을 때.', showBg:'player_home', noBgFade:true, whiteout:false, chars:{left:null, right:null} },
  { type:'narration', text:'나는 익숙한 거리 한복판에 서 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……돌아왔다.' },
  { type:'narration', text:'하지만 곧 이상한 점을 발견했다.' },
  { type:'narration', text:'거리 곳곳에서 사람들이 마법을 사용하고 있었다.', showBg:'end14', bgm:'05. Luminous Memory' },
  { type:'narration', text:'누군가는 마법으로 물건을 옮기고 있었고, 누군가는 간단한 치유 마법으로 상처를 치료하고 있었다.' },
  { type:'narration', text:'뉴스를 확인하자 더욱 놀라운 이야기가 나오고 있었다.' },
  { type:'narration', text:'[마법 기술의 민간 활용 확대]' },
  { type:'narration', text:'[마법사와 일반 시민 간 교류 프로그램 확대]' },
  { type:'narration', text:'[마법을 활용한 의료·에너지 산업의 발전]' },
  { type:'narration', text:'나는 한동안 화면을 바라봤다.' },
  { type:'narration', text:'내가 걱정했던 일은 일어나지 않았다.' },
  { type:'narration', text:'인간들이 마법을 이용해 서로를 해치거나, 욕심 때문에 세상을 망가뜨리는 일도 없었다.' },
  { type:'narration', text:'오히려 마법사와 인간은 서로의 지식을 나누며 새로운 사회를 만들어가고 있었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……이렇게 되는 건가.' },
  { type:'narration', text:'나는 이종복을 떠올렸다.' },
  { type:'narration', text:'그가 원했던 세상이었다.' },
  { type:'narration', text:'마법은 더 이상 소수의 전유물이 아니었다.' },
  { type:'narration', text:'그리고 세상은 생각보다 평화롭게 돌아가고 있었다.' },
  { type:'narration', text:'하지만 나는 문득 하늘을 올려다봤다.' },
  { type:'thought', text:'이 평화가…… 과연 유지될 수 있을까?' },
  { type:'narration', text:'사람의 욕심은 사라진 것이 아니다.' },
  { type:'narration', text:'힘이 모두에게 주어졌을 뿐이다.' },
  { type:'narration', text:'나는 아무 말 없이 하늘을 바라봤다.' },
];
/* ---- ②-둘 다 호감도 2 미만 -> 그대로인 세상 앤딩(ep2_end15, 공용) ---- */
const EP2_PLAZA_END_RETURN_NORMAL = [
  { type:'itemHide' },
  { type:'narration', text:'나는 귀환의 돌을 손에 쥐었다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……이제 돌아가자.' },
  { type:'narration', text:'돌에서 강한 빛이 뿜어져 나왔다.' },
  { type:'narration', text:'순간 눈앞의 모든 것이 새하얗게 변했다.', whiteout:true, se:'SE_Teleport_01a' },
  { type:'narration', text:'그리고 다시 눈을 떴을 때.', showBg:'end15', whiteout:false, chars:{left:null, right:null} },
  { type:'narration', text:'나는 익숙한 거리 한복판에 서 있었다.', bgm:'Fading Static'  },
  { type:'line', speaker:EP2_PLAYER, text:'……돌아왔다.' },
  { type:'narration', text:'휴대폰을 확인했다.' },
  { type:'narration', text:'날짜도, 시간도 내가 떠났던 때와 크게 다르지 않았다.' },
  { type:'narration', text:'거리로 나가보니 세상은 아무 일도 없었다는 듯 돌아가고 있었다.' },
  { type:'narration', text:'사람들은 출근하고 있었고, 뉴스에서는 저출산과 고령화에 대한 이야기가 흘러나왔다.' },
  { type:'narration', text:'인터넷에서는 세대 갈등과 젠더 갈등이 끊이지 않았다.' },
  { type:'narration', text:'정치와 지역, 빈부의 문제로 사람들은 계속 서로를 비난하고 있었다.' },
  { type:'narration', text:'나는 멍하니 화면을 바라봤다.' },
  { type:'line', speaker:EP2_PLAYER, text:'……아무것도 변하지 않았어.' },
  { type:'narration', text:'세계는 그대로였다.' },
  { type:'narration', text:'아니.' },
  { type:'narration', text:'어쩌면 내가 떠나기 전부터 이미 무언가가 조금씩 무너지고 있었던 걸지도 모른다.' },
];

// title: 엔딩 고유 이름(예: '재혁 쌍욕 앤딩'). ENDING_CG_ID_BY_TITLE 조회 키로도 쓰인다.
// category: 원본 스크립트 부록("Episode 2 Ending CG NUMBER")에 표기된 분류(예: 'BAD END', '강 희 END',
// 'DEATH END', 'HAPPY END'...) - 최종 화면에는 title 대신 이 category만 그대로 보여준다(요청됨).
// COLLECTOR END처럼 그 자체가 이름이자 분류인 경우(category===title) title을 그대로 쓴다.
// 'BAD END'/'DEATH END' 분류일 때 el.endLayer에 gameover 스타일(ep1의 showGameOver와 동일한 붉은
// 톤)을, 'SAD END' 분류일 때 별도의 푸른 톤(sadend)을 적용한다(요청됨).
function showEp2Ending(title, category){
  const galleryId = ENDING_CG_ID_BY_TITLE[title];
  if(galleryId){ unlockCG(galleryId); }
  closeChat();
  serverClearProgress();
  currentSceneKey = null;
  // DEATH END도 BAD END와 같은 붉은 연출을 쓰고(요청됨), SAD END는 별도의 푸른 연출을 쓴다.
  el.endLayer.classList.toggle('gameover', category === 'BAD END' || category === 'DEATH END');
  el.endLayer.classList.toggle('sadend', category === 'SAD END');
  const showCategory = category && category !== title;
  el.endTitle.textContent = showCategory ? category : (title || '이야기 끝');
  el.endAffection.textContent = '';
  el.endLayer.classList.add('show');
}

/* =========================================================
   Episode 2 진입점(startGame2/resumeGame2) - ep1의 startGame/resumeGame과 동일한 역할이지만
   ep1 전용 변수(choice1/affJuheon 등) 대신 이 파일만의 상태(ep2Choice1)를 쓴다.
   ========================================================= */
let ep2Choice1 = null;        // S#1의 선택(1/2/3/4)
let ep2HasPendant = false;    // S#2-② 편지 사건에서 펜던트를 챙겼는가(S#3 합류 지점의 선택지에 영향)
let ep2HasWand = false;       // S#2-②-상자 퍼즐 성공 시 마법봉 획득(S#3 합류 지점의 선택지에 영향)
let ep2ContactedFriend = null;// S#2-③(ep1 엔딩10 시청) 카톡 연락 대상(juheon/yeongwoong/seungyu/ganghee)
let ep2PlazaPath = null;      // S#3 대광장에서 고른 건물(academy/tower/dungeon)
let ep2CafeAffection = 0;     // 대광장 카페 미니게임 호감도 누적(던전 루트 - 김현재 한 명뿐이라 공용)
let ep2AffJongbok = 0;        // 아카데미/탑 루트 - 이종복 호감도(카페 + 대광장 대결에서 누적)
let ep2AffSojung = 0;         // 아카데미/탑 루트 - 임소정 호감도(카페 + 대광장 대결에서 누적)
let ep2JaehyukDamageDealt = false; // 재혁 소환 전투 1라운드에서 후방공격(데미지 O)을 골랐는지 - 2라운드
                                    // 무적기 선택의 결과(승리/죽음/희생/저항자)가 이 값에 따라 갈린다
let ep2JuheonStunned = false;      // 주헌 소환 전투 1라운드에서 기절시키기(knockout)를 골랐는지 - 2라운드
                                    // 주헌을 미끼로 쓸 때 승리/희생 여부가 이 값에 따라 갈린다
let ep2YeongwoongDamageDealt = false; // 영웅 소환 전투 1라운드에서 강한 타격(데미지 O)을 골랐는지 -
                                       // 2라운드 회복 선택의 결과(승리/저항자)가 이 값에 따라 갈린다

function getEp2State(){
  return {
    ep2Choice1, ep2HasPendant, ep2HasWand, ep2ContactedFriend, ep2PlazaPath, ep2CafeAffection,
    ep2AffJongbok, ep2AffSojung, ep2JaehyukDamageDealt, ep2JuheonStunned,
    ep2YeongwoongDamageDealt,
  };
}

function startGame2(){
  serverClearProgress();
  currentSceneKey = 'ep2_scene1';
  ep2Choice1 = null;
  ep2HasPendant = false;
  ep2HasWand = false;
  ep2ContactedFriend = null;
  ep2PlazaPath = null;
  ep2CafeAffection = 0;
  ep2AffJongbok = 0;
  ep2AffSojung = 0;
  ep2JaehyukDamageDealt = false;
  ep2JuheonStunned = false;
  ep2YeongwoongDamageDealt = false;
  dialogueHistory = [];
  el.endLayer.classList.remove('show');
  el.choiceLayer.classList.remove('show');
  closeChat();
  el.dialogueWrap.classList.remove('hidden');
  playEp2S1();
}

function resumeGame2(progress){
  currentSceneKey = progress.scene_key || 'ep2_scene1';
  const state = progress.state || {};
  ep2Choice1 = state.ep2Choice1 ?? null;
  ep2HasPendant = state.ep2HasPendant ?? false;
  ep2HasWand = state.ep2HasWand ?? false;
  ep2ContactedFriend = state.ep2ContactedFriend ?? null;
  ep2PlazaPath = state.ep2PlazaPath ?? null;
  ep2CafeAffection = state.ep2CafeAffection ?? 0;
  ep2AffJongbok = state.ep2AffJongbok ?? 0;
  ep2AffSojung = state.ep2AffSojung ?? 0;
  ep2JaehyukDamageDealt = state.ep2JaehyukDamageDealt ?? false;
  ep2JuheonStunned = state.ep2JuheonStunned ?? false;
  ep2YeongwoongDamageDealt = state.ep2YeongwoongDamageDealt ?? false;
  dialogueHistory = [];
  el.endLayer.classList.remove('show');
  el.choiceLayer.classList.remove('show');
  closeChat();
  el.dialogueWrap.classList.remove('hidden');
  const fn = SCENE_FUNCS2[progress.scene_key] || playEp2S1;
  fn();
}

// 각 씬 키는 ep1과 동일하게 "그 지점까지 도달했음"만 표시한다 - 예를 들어 ep2_scene2는 S#1의 선택에
// 따라 완전히 다른 인트로로 갈라지는데(playEp2S2 참고), 그 갈림은 ep2Choice1(이미 위 state에 저장됨)로
// 재현되므로 씬 키 자체를 더 잘게 쪼갤 필요가 없다.
const SCENE_FUNCS2 = {
  ep2_scene1: playEp2S1,
  ep2_scene2: playEp2S2,
  ep2_scene3_plaza: playEp2PlazaArrival,
  ep2_scene4_cafe: playEp2CafeIntro,
  ep2_scene3_convergence: playEp2CrisisConvergence,
  // 위기(CRISIS) 루트의 s#4 진입점 4곳(showEp2CrisisConvergenceChoice 참고) - 대광장 루트의
  // ep2_scene4_cafe와 대칭을 맞추기 위해 추가됨(신고받아 수정).
  ep2_scene4_jaehyuk: playEp2CrisisBattleJaehyuk,
  ep2_scene4_juheon: playEp2CrisisBattleJuheon,
  ep2_scene4_yeongwoong: playEp2CrisisBattleYeongwoong,
  ep2_scene4_seungyu: playEp2CrisisBattleSeungyu,
  // 원문 s#4->s#5, s#5->s#6 경계 8곳(씬 번호가 바뀔 때마다 티켓을 소모하도록 신고받아 추가) -
  // 대광장 루트(던전/아카데미·탑)는 각각 2단계(2라운드 진입, 최종 선택 진입), 위기 루트 4명은
  // 각각 1단계(무적기/2라운드 진입)만 s#6까지 가지 않고 s#5 안에서 엔딩으로 끝난다.
  ep2_scene5_dungeon: playEp2DungeonConfessionIntro,
  ep2_scene5_plazafight: playEp2PlazaFightIntro,
  ep2_scene6_dungeon: playEp2DungeonFinalChoiceIntro,
  ep2_scene6_plazafight: playEp2PlazaStayOrReturnIntro,
  ep2_scene5_jaehyuk: playEp2CrisisBattleJaehyukRound2Intro,
  ep2_scene5_juheon: playEp2CrisisBattleJuheonRound2Intro,
  ep2_scene5_yeongwoong: playEp2CrisisBattleYeongwoongRound2Intro,
  ep2_scene5_seungyu: playEp2CrisisBattleSeungyuRound2Intro,
};

/* =========================================================
   CG 도감 + 컬렉터 엔딩 조건 - 원본 스크립트 맨 끝의 "Episode 2 Ending CG NUMBER" 목록(END1~22)을
   그대로 옮긴다. 아직 그려지지 않은 CG는 imageSrcs를 빈 배열로 둬서(getGalleryImages 참고) 도감에서
   빈 배경으로 표시된다 - 이후 단계에서 그림이 생기면 EP2_BG에 항목만 추가하고 여기 imageSrcs를
   채우면 된다(다른 코드는 손댈 필요 없음).
   ========================================================= */
const EP2_CG_GALLERY_ITEMS = [
  { id:'ep2_end1',  title:'재혁 쌍욕 앤딩',            imageSrcs:[EP2_BG.end1], bgm:'Dinner Punch' },
  { id:'ep2_end2',  title:'비운의 저항자 앤딩',         imageSrcs:[EP2_BG.end2], bgm:'2-12. Moment' },
  { id:'ep2_end3',  title:'강 희 앤딩',                imageSrcs:[EP2_BG.end3], bgm:'Kurumi BGM' },
  { id:'ep2_end4',  title:'재혁과 승리 앤딩',           imageSrcs:[EP2_BG.end4], bgm:'2-09. CrossFire' },
  { id:'ep2_end5',  title:'송주헌과 승리 앤딩',         imageSrcs:[EP2_BG.end5], bgm:'You are the One arrange' },
  { id:'ep2_end6',  title:'이영웅과 승리 앤딩',         imageSrcs:[EP2_BG.end6], bgm:'1-14. Sugar story' },
  { id:'ep2_end7',  title:'강승유와의 승리 앤딩',       imageSrcs:[EP2_BG.end7], bgm:'Hello SY' },
  { id:'ep2_end8',  title:'두 대마법사에 의한 죽음 앤딩', imageSrcs:[EP2_BG.end8], bgm:'09.Final Destination of Ark' },
  { id:'ep2_end9',  title:'김현재에 의한 죽음 앤딩',     imageSrcs:[EP2_BG.end9], bgm:'2-09. Blood Stained Faith' },
  { id:'ep2_end10', title:'최재혁의 희생 앤딩',         imageSrcs:[EP2_BG.end10], bgm:'1-13. Aira' },
  { id:'ep2_end11', title:'송주헌의 희생 앤딩',         imageSrcs:[EP2_BG.end11], bgm:'2-07. Morose Dreamer' },
  { id:'ep2_end12', title:'김현재의 행복한 세상 앤딩',   imageSrcs:[EP2_BG.end12], bgm:'2.11 Starry Confession' },
  { id:'ep2_end13', title:'임소정의 행복한 세상 앤딩',   imageSrcs:[EP2_BG.end13], bgm:'Daily Repeat' },
  { id:'ep2_end14', title:'이종복의 행복한 세상 앤딩',   imageSrcs:[EP2_BG.end14], bgm:'05. Luminous Memory' },
  { id:'ep2_end15', title:'그대로인 세상 앤딩',         imageSrcs:[EP2_BG.end15], bgm:'Fading Static' },
  { id:'ep2_end16', title:'김현재 방랑자 앤딩',         imageSrcs:[EP2_BG.end16], bgm:'1-08. Daily Routine 247' },
  { id:'ep2_end17', title:'노란색 보석 방랑자 앤딩',     imageSrcs:[EP2_BG.end17], bgm:'Static in the Static' },
  { id:'ep2_end18', title:'보라색 보석 방랑자 앤딩',     imageSrcs:[EP2_BG.end18], bgm:'I lost' },
  { id:'ep2_end19', title:'평범한 방랑자 앤딩',         imageSrcs:[EP2_BG.end19], bgm:'Defective_Pixel' },
  // END20/21은 원본 부록에도 둘 다 그냥 "COLLECTOR END"로만 적혀 있다 - 서로 다른 엔딩이 아니라 컬렉터
  // 엔딩 하나가 CG 두 장을 함께 공개하는 것뿐이라, 플레이어에게 표시되는 엔딩 이름도 "COLLECTOR END"
  // 하나뿐이다(showEp2Ending('COLLECTOR END')가 TRUE_ENDING_GALLERY_IDS를 통해 이 둘을 한 번에
  // 해금한다 - unlockCG의 id==='true' 분기, ep1의 트루 엔딩과 동일한 방식). 도감 카드 제목에 "· 1"/"· 2"
  // 같은 구분자를 붙이지 않는다.
  { id:'ep2_end20', title:'COLLECTOR END',            imageSrcs:[EP2_BG.end20], bgm:'Track_327' },
  { id:'ep2_end21', title:'COLLECTOR END',            imageSrcs:[EP2_BG.end21], bgm:'Track_327' },
  { id:'ep2_end22', title:'악당과의 협력 앤딩',         imageSrcs:[EP2_BG.end22], bgm:'11.Responsibility' },
];

// 히든 엔딩(ep2_end22)과 컬렉터 엔딩 자신(ep2_end20/21)은 컬렉터 조건에 포함하지 않는다(ep1과 동일한 규칙).
const EP2_TRUE_ENDING_REQUIREMENTS = [
  'ep2_end1','ep2_end2','ep2_end3','ep2_end4','ep2_end5','ep2_end6','ep2_end7','ep2_end8','ep2_end9',
  'ep2_end10','ep2_end11','ep2_end12','ep2_end13','ep2_end14','ep2_end15','ep2_end16','ep2_end17',
  'ep2_end18','ep2_end19',
];
const EP2_TRUE_ENDING_GALLERY_IDS = ['ep2_end20', 'ep2_end21'];

const EP2_ENDING_CG_ID_BY_TITLE = {
  '재혁 쌍욕 앤딩': 'ep2_end1',
  '비운의 저항자 앤딩': 'ep2_end2',
  '강 희 앤딩': 'ep2_end3',
  '재혁과 승리 앤딩': 'ep2_end4',
  '송주헌과 승리 앤딩': 'ep2_end5',
  '이영웅과 승리 앤딩': 'ep2_end6',
  '강승유와의 승리 앤딩': 'ep2_end7',
  '두 대마법사에 의한 죽음 앤딩': 'ep2_end8',
  '김현재에 의한 죽음 앤딩': 'ep2_end9',
  '최재혁의 희생 앤딩': 'ep2_end10',
  '송주헌의 희생 앤딩': 'ep2_end11',
  '김현재의 행복한 세상 앤딩': 'ep2_end12',
  '임소정의 행복한 세상 앤딩': 'ep2_end13',
  '이종복의 행복한 세상 앤딩': 'ep2_end14',
  '그대로인 세상 앤딩': 'ep2_end15',
  '김현재 방랑자 앤딩': 'ep2_end16',
  '노란색 보석 방랑자 앤딩': 'ep2_end17',
  '보라색 보석 방랑자 앤딩': 'ep2_end18',
  '평범한 방랑자 앤딩': 'ep2_end19',
  'COLLECTOR END': 'true',
  '악당과의 협력 앤딩': 'ep2_end22',
};

// showEp2Ending(title, category)의 두 번째 인자용 - 원본 스크립트 부록("Episode 2 Ending CG NUMBER")에
// 적힌 분류를 title별로 그대로 옮겼다. COLLECTOR END는 이름 자체가 분류라 괄호를 안 붙인다(showEp2Ending이
// category===title이면 자동으로 생략).
const EP2_ENDING_CATEGORY_BY_TITLE = {
  '재혁 쌍욕 앤딩': 'BAD END',
  '비운의 저항자 앤딩': 'BAD END',
  '강 희 앤딩': '강 희 END',
  '재혁과 승리 앤딩': '최재혁 END',
  '송주헌과 승리 앤딩': '송주헌 END',
  '이영웅과 승리 앤딩': '이영웅 END',
  '강승유와의 승리 앤딩': '강승유 END',
  '두 대마법사에 의한 죽음 앤딩': 'DEATH END',
  '김현재에 의한 죽음 앤딩': 'DEATH END',
  '최재혁의 희생 앤딩': 'SAD END',
  '송주헌의 희생 앤딩': 'SAD END',
  '김현재의 행복한 세상 앤딩': 'HAPPY END',
  '임소정의 행복한 세상 앤딩': 'HAPPY END',
  '이종복의 행복한 세상 앤딩': 'HAPPY END',
  '그대로인 세상 앤딩': 'NORMAL END',
  '김현재 방랑자 앤딩': '김현재 END',
  '노란색 보석 방랑자 앤딩': '임소정 END',
  '보라색 보석 방랑자 앤딩': '이종복 END',
  '평범한 방랑자 앤딩': 'NORMAL END',
  'COLLECTOR END': 'COLLECTOR END',
  '악당과의 협력 앤딩': 'HIDDEN END',
};

function isEp2CollectorEndingReady(){
  return EP2_TRUE_ENDING_REQUIREMENTS.every(id => unlockedCgSet.has(id));
}

const EP2_BUNDLE = {
  STORY_ID: EP2_STORY_ID,
  AUTO_USE_STORAGE_KEY: EP2_AUTO_USE_STORAGE_KEY,
  ASSET_BASE: EP2_ASSET_BASE,
  CHAR_IMG: EP2_CHAR_IMG,
  BG: EP2_BG,
  PLAYER: EP2_PLAYER,
  CG_GALLERY_ITEMS: EP2_CG_GALLERY_ITEMS,
  TRUE_ENDING_REQUIREMENTS: EP2_TRUE_ENDING_REQUIREMENTS,
  TRUE_ENDING_GALLERY_IDS: EP2_TRUE_ENDING_GALLERY_IDS,
  ENDING_CG_ID_BY_TITLE: EP2_ENDING_CG_ID_BY_TITLE,
};

// 도감(갤러리)은 활성 에피소드와 무관하게 Episode 1/2/3을 항상 함께 보여준다 - 그래서 두 에피소드
// 데이터가 전부 로드된 이 시점(ep1_yoondaewoong.js가 이미 로드된 뒤)에 한 번만 구성한다. ep1_yoondaewoong.js
// 자신은 이 배열을 더 이상 선언하지 않는다(예전엔 그 파일에 있었고 Episode 2/3 자리를 빈 배열로 예약해뒀었다).
const GALLERY_EPISODE_SECTIONS = [
  { label:'Episode 1', items: EP1_BUNDLE.CG_GALLERY_ITEMS },
  { label:'Episode 2', items: EP2_CG_GALLERY_ITEMS },
  { label:'Episode 3', items: [] },
];
