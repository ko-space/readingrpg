// 상점 의상 카드와 전술대회(투기장 PVP) 모달의 "스탠딩 일러스트"용 크롭.
// 아바타 크롭(avatar-crop.js: 얼굴 위주로 강하게 확대)과 달리, 명치 부근을 중심점으로 잡아
// 머리부터 명치까지의 상반신이 확대되어 보이게 한다.
// 이미지마다 인물 위치가 다른 특수한 경우는 avatar-crop과 같은 방식으로 여기 오버라이드를 추가한다.
const STANDING_CROP_OVERRIDES = {
    // "outfit_file": { xPercent: 50, yPercent: 18, scale: 2.0 },
};
const DEFAULT_STANDING_CROP = { xPercent: 50, yPercent: 5, scale: 2.0 };

function applyStandingCrop(imgEl, outfit) {
    const crop = (outfit && STANDING_CROP_OVERRIDES[outfit]) || DEFAULT_STANDING_CROP;
    imgEl.style.objectFit = "cover";
    imgEl.style.objectPosition = `${crop.xPercent}% ${crop.yPercent}%`;
    imgEl.style.transform = crop.scale ? `scale(${crop.scale})` : "none";
    imgEl.style.transformOrigin = `${crop.xPercent}% ${crop.yPercent}%`;
}
