// 스토리(modal-minigame) 전용 로직. home.js는 이 파일의 존재를 몰라도 됨 -
// home.js는 그냥 "modal-minigame을 열고 닫는다"만 알고, 안에 뭐가 들어있는지는 신경 안 씀.
// 인연 스토리는 arena-battle.html과 같은 패턴으로, 모달 안에 욱여넣지 않고
// 별도 전체화면 페이지(story-relationship.html)로 이동한다(비주얼노벨 16:9 무대 + 자체 미니 로비를
// 작은 모달 박스 안에 구겨넣는 것이 무리라서, 기존에도 PVP 전투가 arena-battle.html로 이동하던
// 방식을 그대로 따름).

(function () {
    const choiceView = document.getElementById("story-choice-view");

    // 입장하기 버튼 -> 항상 "인연/서브 스토리" 선택 화면부터 다시 보여줌
    function showStoryChoice() {
        if (choiceView) choiceView.hidden = false;
    }

    document.querySelectorAll('[data-modal-target="modal-minigame"]').forEach((btn) => {
        btn.addEventListener("click", showStoryChoice);
    });

    document.getElementById("story-choice-relationship")?.addEventListener("click", () => {
        window.location.href = "story-relationship.html";
    });
})();
