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
    // 서브 스토리(story-sub-engine.js) 대화 기록 초상화 예시 - CHAR_IMG 키를 그대로 override 키로 쓴다.
    // yoon_youngjun.webp는 캔버스 위쪽에 여백이 커서(쪼그려 앉은 자세) 기본값(yPercent:0)으로는
    // 얼굴이 아니라 빈 공간이 잘려서, 얼굴 위치에 맞춰 yPercent를 내렸다.
    "yoon_youngjun": { xPercent: 50, yPercent: 28, scale: 4.0 },
    "samsung": { xPercent: 50, yPercent: 0, scale: 2.0 },
    "employee1": { xPercent: 50, yPercent: 0, scale: 2.0 },
    "kimnamok": { xPercent: 50, yPercent: 6, scale: 4.0 },
    "unknown": { xPercent: 50, yPercent: 0, scale: 1.3 },
    "kimnamok_uniform": { xPercent: 50, yPercent: 8, scale: 4.0 },   
    "kimnamok_labcoat": { xPercent: 50, yPercent: 8, scale: 4.0 }, 
    "teacher_chem": { xPercent: 55, yPercent: 0, scale: 3.0 },  
};
const DEFAULT_AVATAR_CROP = { xPercent: 50, yPercent: 0, scale: 4.0 };

function applyAvatarCrop(imgEl, outfit) {
    const crop = (outfit && AVATAR_CROP_OVERRIDES[outfit]) || DEFAULT_AVATAR_CROP;
    imgEl.style.objectFit = "cover";
    imgEl.style.objectPosition = `${crop.xPercent}% ${crop.yPercent}%`;
    imgEl.style.transform = crop.scale ? `scale(${crop.scale})` : "none";
    imgEl.style.transformOrigin = `${crop.xPercent}% ${crop.yPercent}%`;
}
