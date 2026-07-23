// 브라우저 뒤로가기/앞으로가기 버튼을 무력화한다. 페이지 진입 시 더미 히스토리 엔트리를 하나 쌓아두고,
// popstate(뒤로/앞으로 버튼 클릭)가 발생할 때마다 같은 자리로 다시 밀어넣어 실제 이동을 막는다.
// 주의: 브라우저는 "다음에 어디로 이동할지"를 스크립트가 미리 알 수 없게 막아두기 때문에, 목적지가
// 이 사이트 안인지 밖인지 가려서 막을 방법은 없다 - 이 페이지에 머무는 동안은 방향에 관계없이 전부 막는다.
(function () {
    history.pushState(null, "", location.href);
    window.addEventListener("popstate", () => {
        history.pushState(null, "", location.href);
    });
})();
