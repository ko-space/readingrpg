// 중복 로그인 감시. 로그인 중인 페이지(home/arena-battle/reading/story-relationship/devtest)에서
// 공통으로 불러온다. 주기적으로 서버에 "나 아직 살아있다"는 하트비트를 보내고,
//   - 401: 다른 기기/브라우저에서 같은 계정으로 로그인해 세션 자체가 넘어감 -> 토큰 지우고 로그인 화면으로.
//   - 409: 같은 로그인을 다른 탭(주로 같은 브라우저의 새 창)이 먼저 쓰고 있음 -> 이 탭만 화면을 덮어 막는다.
//         (토큰은 유효하므로 지우지 않는다 - 먼저 쓰던 탭이 닫히면 새로고침으로 다시 쓸 수 있다.)
// API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
(function () {
    const HEARTBEAT_INTERVAL_MS = 30000;
    let stopped = false;

    function getTabId() {
        let id = sessionStorage.getItem("tab_id");
        if (!id) {
            id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
            sessionStorage.setItem("tab_id", id);
        }
        return id;
    }

    function showBlockedOverlay(message) {
        if (document.getElementById("dup-session-overlay")) return;
        const overlay = document.createElement("div");
        overlay.id = "dup-session-overlay";
        overlay.style.cssText =
            "position:fixed;inset:0;z-index:999999;background:rgba(10,10,15,0.92);" +
            "display:flex;align-items:center;justify-content:center;text-align:center;" +
            "color:#fff;font-size:20px;font-family:inherit;padding:24px;";
        overlay.innerHTML = `<div>${message}</div>`;
        document.body.appendChild(overlay);
    }

    async function sendHeartbeat() {
        const token = localStorage.getItem("access_token");
        if (!token || stopped) return;

        try {
            const res = await fetch(`${API_BASE_URL}/auth/heartbeat`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ tab_id: getTabId() }),
            });

            if (res.status === 401) {
                stopped = true;
                localStorage.removeItem("access_token");
                alert("다른 기기에서 로그인되어 접속이 종료되었습니다.");
                window.location.href = "index.html";
                return;
            }
            if (res.status === 409) {
                stopped = true;
                showBlockedOverlay("이미 접속 중인 계정입니다.");
            }
        } catch (error) {
            // 네트워크 문제로는 세션을 끊지 않는다. 다음 하트비트에서 다시 시도.
            console.error("세션 하트비트 실패:", error);
        }
    }

    function releaseTabOnUnload() {
        const token = localStorage.getItem("access_token");
        if (!token || stopped) return;
        // keepalive: 페이지가 언로드되는 도중에도 요청이 살아서 서버까지 도달한다.
        // 이 사이트의 다른 페이지로 이동하는 경우에도 호출되지만, 같은 tab_id로 다음 페이지가 바로
        // 재청구하므로(sessionStorage는 탭이 유지되는 한 페이지 이동에도 살아있음) 문제없다.
        fetch(`${API_BASE_URL}/auth/release-tab`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ tab_id: getTabId() }),
            keepalive: true,
        }).catch(() => {});
    }

    if (localStorage.getItem("access_token")) {
        sendHeartbeat();
        setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
        window.addEventListener("pagehide", releaseTabOnUnload);
    }
})();
