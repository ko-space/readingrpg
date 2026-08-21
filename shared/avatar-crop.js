const AVATAR_CROP_OVERRIDES = {
    "beginner/basic": { xPercent: 50, yPercent: 0, scale: 1.5 },
    "tutor/basic": { xPercent: 50, yPercent: 0, scale: 2.0 },
    "photographer/basic": { xPercent: 50, yPercent: 3, scale: 4.0 },
    "sj/basic": { xPercent: 50, yPercent: 10, scale: 3.0 },
    "mage/basic": { xPercent: 50, yPercent: 2, scale: 4.0 },
    "beginner/swimsuit": { xPercent: 50, yPercent: 0, scale: 1.5 },
    "international/basic": { xPercent: 50, yPercent: 0, scale: 3.0 },
    "mage_2/basic": { xPercent: 47, yPercent: 20, scale: 3.5 },
    "chris/basic": { xPercent: 50, yPercent: 0, scale: 2.5 },
    "back/basic": { xPercent: 50, yPercent: 1, scale: 2.5 },
    "soldier/basic": { xPercent: 50, yPercent: 5, scale: 2.3 },
    "parliament/basic": { xPercent: 50, yPercent: 0, scale: 1.5 },
    "god/basic": { xPercent: 50, yPercent: 10, scale: 3.0 },
};
const DEFAULT_AVATAR_CROP = { xPercent: 50, yPercent: 0, scale: 4.0 };

function applyAvatarCrop(imgEl, outfit) {
    const crop = (outfit && AVATAR_CROP_OVERRIDES[outfit]) || DEFAULT_AVATAR_CROP;
    imgEl.style.objectFit = "cover";
    imgEl.style.objectPosition = `${crop.xPercent}% ${crop.yPercent}%`;
    imgEl.style.transform = crop.scale ? `scale(${crop.scale})` : "none";
    imgEl.style.transformOrigin = `${crop.xPercent}% ${crop.yPercent}%`;
}
