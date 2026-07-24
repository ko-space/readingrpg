// API_BASE_URL/GOOGLE_CLIENT_ID는 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.

const avatarImg = document.getElementById('avatar-img');
const avatarImgLarge = document.getElementById('avatar-img-large');
const nicknameValue = document.getElementById('nickname-value');
const titleValue = document.getElementById('title-value');
const levelValue = document.getElementById('level-value');
const expFill = document.getElementById('exp-bar-fill');
const expText = document.getElementById('exp-text');
const goldValue = document.getElementById('gold-value');
const storyTicketValue = document.getElementById('story-ticket-value');
const regionName = document.getElementById('region-name');
const regionRate = document.getElementById('region-rate');
const clockValue = document.getElementById('clock-value');

// 크롭 설정(AVATAR_CROP_OVERRIDES, DEFAULT_AVATAR_CROP, applyAvatarCrop)은 shared/avatar-crop.js에 있음.
// home.html에서 이 파일보다 먼저 로드되므로 여기서 바로 씀.
const OUTFIT_IMAGE_BASE = `${API_BASE_URL}/static/outfits/`;

// 이미지가 없을 때 보여줄 기본 아바타 (간단한 얼굴 아이콘, 손그림 스케치에 맞춘 자리표시자)
const DEFAULT_AVATAR =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E" +
    "%3Ccircle cx='50' cy='50' r='50' fill='%23333'/%3E" +
    "%3Ccircle cx='35' cy='40' r='5' fill='%23fff'/%3E" +
    "%3Ccircle cx='65' cy='40' r='5' fill='%23fff'/%3E" +
    "%3Cpath d='M30 62 Q50 82 70 62' stroke='%23fff' stroke-width='4' fill='none' stroke-linecap='round'/%3E" +
    "%3C/svg%3E";

window.onload = loadProfile;
setupModals();

let currentOpenModal = null;

function setupModals() {
    document.querySelectorAll('[data-modal-target]').forEach((btn) => {
        btn.addEventListener('click', () => {
            openModal(btn.dataset.modalTarget);
            if (btn.dataset.modalTarget === 'modal-daily') loadDailySummary();
        });
    });

    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
        overlay.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal(overlay.id));
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && currentOpenModal) closeModal(currentOpenModal);
    });
}

function openModal(modalId) {
    if (currentOpenModal) closeModal(currentOpenModal);
    document.getElementById(modalId)?.classList.add('open');
    currentOpenModal = modalId;
}

function closeModal(modalId) {
    document.getElementById(modalId)?.classList.remove('open');
    if (currentOpenModal === modalId) currentOpenModal = null;
}

// ── 지역 입장/전술대회 입장 공통 "입장하는 중" 오버레이 (arena.js/dungeon.js가 호출) ──
// arena-battle.js의 BATTLE_TIPS와 같은 목록(공용 모듈을 안 쓰는 컨벤션이라 그대로 복사).
const LOBBY_ENTERING_TIPS = [
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
let lobbyEnteringDotTimer = null;

function showLobbyEnteringOverlay() {
    const overlay = document.getElementById("lobby-entering-overlay");
    if (!overlay) return;
    const dotsEl = document.getElementById("lobby-entering-dots");
    const tipEl = document.getElementById("lobby-entering-tip");
    if (tipEl) tipEl.textContent = LOBBY_ENTERING_TIPS[Math.floor(Math.random() * LOBBY_ENTERING_TIPS.length)];

    let dotCount = 1;
    if (dotsEl) dotsEl.textContent = ".";
    clearInterval(lobbyEnteringDotTimer);
    lobbyEnteringDotTimer = setInterval(() => {
        dotCount = (dotCount % 3) + 1;
        if (dotsEl) dotsEl.textContent = ".".repeat(dotCount);
    }, 400);

    overlay.hidden = false;
}

function hideLobbyEnteringOverlay() {
    clearInterval(lobbyEnteringDotTimer);
    const overlay = document.getElementById("lobby-entering-overlay");
    if (overlay) overlay.hidden = true;
}

async function loadProfile() {
    const token = localStorage.getItem('access_token');
    if (!token) {
        alert("로그인이 필요합니다.");
        window.location.href = "index.html";
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/users/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            localStorage.removeItem('access_token');
            alert("세션이 만료되었습니다. 다시 로그인해주세요.");
            window.location.href = "index.html";
            return;
        }

        const data = await res.json();
        renderProfile(data);
    } catch (error) {
        console.error("서버 통신 에러:", error);
        alert("서버에 연결할 수 없습니다.");
    }
}

function renderProfile(data) {
    const user = data.user_info;
    const character = data.character_info;
    const region = data.region_info;

    nicknameValue.textContent = user.nickname;

    // 오늘 누적 독서시간(시:분) - 자정(KST) 지나면 백엔드가 자동으로 0부터 다시 시작함
    const dailyMinutes = user.daily_reading_minutes || 0;
    const dailyHours = Math.floor(dailyMinutes / 60);
    const dailyMins = dailyMinutes % 60;
    clockValue.textContent = `${String(dailyHours).padStart(2, '0')}:${String(dailyMins).padStart(2, '0')}`;
    levelValue.textContent = user.level;
    goldValue.textContent = user.gold.toLocaleString();
    if (storyTicketValue) storyTicketValue.textContent = (user.story_ticket_count || 0).toLocaleString();

    titleValue.textContent = user.equipped_title || "칭호 없음";
    titleValue.classList.toggle("title-hidden-shine", !!user.equipped_title_is_hidden);

    // 다음 레벨까지 필요한 경험치는 백엔드 규칙상 level * 100
    const expNeeded = user.level * 100;
    const expPercent = Math.min(100, Math.max(0, (user.total_exp / expNeeded) * 100));
    expFill.style.width = `${expPercent}%`;
    expText.textContent = `${user.total_exp} / ${expNeeded} EXP`;

    // 아바타: 작은 원형(상단)과 큰 전신(중앙) 둘 다 같은 이미지를 사용
    let avatarSrc = DEFAULT_AVATAR;
    if (character && character.outfit) {
        avatarSrc = `${OUTFIT_IMAGE_BASE}${character.outfit}/idle.png`;
    }
    avatarImg.src = avatarSrc;
    avatarImg.onerror = () => { avatarImg.src = DEFAULT_AVATAR; };

    // 원형 프로필만 캐릭터별 크롭값 적용 (큰 전신 이미지는 object-fit:contain이라 크롭 자체가 필요 없음)
    applyAvatarCrop(avatarImg, character && character.outfit);

    avatarImgLarge.src = avatarSrc;
    avatarImgLarge.onerror = () => { avatarImgLarge.src = DEFAULT_AVATAR; };

    if (region) {
        regionName.textContent = region.name;
        const expPer10Min = Math.round(region.exp_rate * 10);
        regionRate.textContent = `${expPer10Min} EXP / 10분`;
    } else {
        regionName.textContent = "알 수 없음";
        regionRate.textContent = "-";
    }

}

// "N시간 M분 S초" 포맷 - 분 단위로만 기록되는 학습시간을 초 단위까지 일관되게 표시(초는 항상 0).
function formatHms(totalMinutes) {
    const totalSeconds = Math.max(0, Math.round(totalMinutes)) * 60;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}시간 ${minutes}분 ${seconds}초`;
}

// {"비문학": 45, "문학": 0} 같은 항목별 분을 "비문학: N시간 M분 S초" 줄들로 렌더링한다.
function renderDailySummaryList(listEl, breakdown) {
    listEl.innerHTML = '';
    Object.entries(breakdown).forEach(([label, minutes]) => {
        const row = document.createElement('div');
        row.className = 'daily-summary-item';
        row.innerHTML = `<span>${label}</span><span>${formatHms(minutes)}</span>`;
        listEl.appendChild(row);
    });
}

async function loadDailySummary() {
    const readingListEl = document.getElementById('daily-reading-list');
    const subjectListEl = document.getElementById('daily-subject-list');
    if (!readingListEl || !subjectListEl) return;

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
        const res = await fetch(`${API_BASE_URL}/logs/daily-summary`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        renderDailySummaryList(readingListEl, data.reading || {});
        renderDailySummaryList(subjectListEl, data.subject || {});
    } catch (error) {
        readingListEl.innerHTML = '<div class="daily-summary-item">불러오지 못했습니다</div>';
        subjectListEl.innerHTML = '<div class="daily-summary-item">불러오지 못했습니다</div>';
    }
}