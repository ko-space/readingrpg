const AVATAR_CROP_OVERRIDES = {
    "beginner/basic": { xPercent: 50, yPercent: 0, scale: 1.5 },
    "tutor/basic": { xPercent: 50, yPercent: 0, scale: 2.0 },
    "photographer/basic": { xPercent: 50, yPercent: 3, scale: 4.0 },
    "sj/basic": { xPercent: 50, yPercent: 10, scale: 3.0 },
};
const DEFAULT_AVATAR_CROP = { xPercent: 50, yPercent: 0, scale: 4.0 };

// 크롭값 적용 로직
function applyAvatarCrop(imgEl, outfit) {
    const crop = (outfit && AVATAR_CROP_OVERRIDES[outfit]) || DEFAULT_AVATAR_CROP;
    imgEl.style.objectFit = "cover";
    imgEl.style.objectPosition = `${crop.xPercent}% ${crop.yPercent}%`;
    imgEl.style.transform = crop.scale ? `scale(${crop.scale})` : "none";
    imgEl.style.transformOrigin = `${crop.xPercent}% ${crop.yPercent}%`;
}
