// 도움말 화면 로직. home.js는 "modal-help를 열고 닫는다"만 알고 안의 내용은 신경 안 씀.
// assets/help/ 안의 이미지들을 이름 순서대로 화살표로 넘겨보는 단순 갤러리 - 서버 API가 필요 없다.
(function () {
    const PARTIAL_URL = "help/help-partial.html";
    const IMAGE_BASE = "assets/help/";
    // 파일명 규칙: "NN.jpg"가 원본, "NN-M.jpg"는 그 뒤에 이어지는 보충 이미지.
    // 이름 문자열 그대로 정렬하면 "-"가 "."보다 앞서서 순서가 꼬이므로(00-1 < 00) 직접 순서를 나열해둔다.
    const IMAGES = [
        "00.jpg", "00-1.jpg",
        "01.jpg", "01-1.jpg",
        "02.jpg",
        "03.jpg",
        "04.jpg",
        "05.jpg", "05-1.jpg",
        "06.jpg", "06-1.jpg",
        "07.jpg", "07-1.jpg",
        "08.jpg", "08-1.jpg",
        "09.jpg",
        "10.jpg", "10-1.jpg", "10-2.jpg",
        "11.jpg", "11-1.jpg", "11-2.jpg", "11-3.jpg",
        "12.jpg", "12-1.jpg", "12-2.jpg", "12-3.jpg",
    ];

    const content = document.getElementById("help-content");
    const openButton = document.querySelector('[data-modal-target="modal-help"]');
    const modal = document.getElementById("modal-help");

    let loaded = false;
    let loading = false;
    let index = 0;

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    async function ensureLoaded() {
        if (loaded || loading || !content) return;
        loading = true;
        try {
            const res = await fetch(PARTIAL_URL);
            if (!res.ok) throw new Error(`화면 파일 ${res.status}`);
            content.innerHTML = await res.text();
            bindInteractions();
            loaded = true;
        } catch (error) {
            content.innerHTML =
                `<p class="screen-placeholder">도움말을 불러오지 못했습니다. (${escapeHtml(error.message)})</p>`;
        } finally {
            loading = false;
        }
    }

    function render() {
        const img = document.getElementById("help-image");
        const count = document.getElementById("help-page-count");
        const prevBtn = document.getElementById("help-prev");
        const nextBtn = document.getElementById("help-next");
        if (!img) return;

        img.src = IMAGE_BASE + IMAGES[index];
        if (count) count.textContent = `${index + 1} / ${IMAGES.length}`;
        if (prevBtn) prevBtn.disabled = index === 0;
        if (nextBtn) nextBtn.disabled = index === IMAGES.length - 1;
    }

    function goPrev() {
        if (index === 0) return;
        index -= 1;
        render();
    }

    function goNext() {
        if (index >= IMAGES.length - 1) return;
        index += 1;
        render();
    }

    function bindInteractions() {
        document.getElementById("help-prev")?.addEventListener("click", goPrev);
        document.getElementById("help-next")?.addEventListener("click", goNext);
    }

    document.addEventListener("keydown", (event) => {
        if (!modal || !modal.classList.contains("open")) return;
        if (event.key === "ArrowLeft") goPrev();
        else if (event.key === "ArrowRight") goNext();
    });

    openButton?.addEventListener("click", async () => {
        index = 0;
        await ensureLoaded();
        if (loaded) render();
    });
})();
