const STANDING_CROP_OVERRIDES = {
    "god/basic": {xPercent: 50, yPercent: 10, scale: 3.0}
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
