// 중복 로그인 감시. 로그인 중인 페이지(home/arena-battle/reading/story-relationship/devtest)에서
// 공통으로 불러온다. 주기적으로 서버에 "나 아직 살아있다"는 하트비트를 보내고,
//   - 401: 다른 기기/브라우저에서 같은 계정으로 로그인해 세션 자체가 넘어감 -> 토큰 지우고 로그인 화면으로.
//   - 409: 같은 로그인을 다른 탭(주로 같은 브라우저의 새 창)이 먼저 쓰고 있음 -> 이 탭만 화면을 덮어 막는다.
//         (토큰은 유효하므로 지우지 않는다 - 막힌 동안은 더 짧은 주기로 자동 재시도해서, 먼저 쓰던
//         탭이 닫히거나 만료되면 새로고침 없이도 스스로 풀린다.)
//
// 탭이 닫힐 때 자리를 즉시 반납하는 releaseTabOnUnload(pagehide 훅)는 한동안 아예 제거돼 있었다 -
// pagehide는 탭을 진짜로 닫을 때뿐 아니라 같은 탭에서 다른 페이지로 이동할 때도 그대로 발생하는데,
// keepalive 요청이라 페이지가 이미 넘어간 뒤에도 백그라운드에서 살아있다가, 새 페이지가 이미 정상
// 하트비트로 같은 tab_id 자리를 재청구한 "이후"에 뒤늦게 서버에 도달해 그 자리를 도로 비워버리는
// 회귀가 있었다. 그런데 훅을 통째로 없애니 "탭을 닫고 금방 다시 로그인/새로고침"하는 흔한 경우까지
// 전부 SESSION_TIMEOUT_SECONDS(90초)를 꽉 채워 기다려야 하는 부작용이 생겨서(다른 창을 닫아도 나머지
// 창의 "이미 접속 중" 표시가 새로고침해도 안 풀리는 문제), 아래처럼 LOAD_ID(탭이 아니라 "이 페이지가
// 로드된 1회"마다 새로 발급 - 같은 탭이어도 페이지 이동하면 새로 발급됨)를 같이 실어보내는 방식으로
// 다시 넣었다. 서버(routers/auth.py의 release_tab)가 tab_id뿐 아니라 이 LOAD_ID까지 지금 활성 claim과
// 일치할 때만 반납을 받아들이므로, 낡은(같은 탭의 이전 페이지가 보낸) 반납 요청이 뒤늦게 도착해도
// 이미 새 페이지가 자기 LOAD_ID로 갱신해둔 최신 claim을 잘못 지우지 않는다 - 원래 경합은 이렇게
// 없앤 채로, 진짜 탭 종료 시엔 즉시 반납되는 이점만 되살렸다.
// API_BASE_URL은 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.
(function () {
    const HEARTBEAT_INTERVAL_MS = 30000;
    // 막혔을 때(409) 재시도하는 주기 - 옛 탭의 release-tab이 유실돼서 막힌 경우, 서버의
    // SESSION_TIMEOUT_SECONDS(90초)가 지나면 자동으로 풀리는데도 평소 30초 주기로만 재시도하면
    // 체감상 오래 막혀있는 것처럼 느껴진다. 이 주기로 빠르게 재시도해서 최대한 빨리 자동 복구한다.
    const BLOCKED_RETRY_INTERVAL_MS = 5000;
    // 이 시간이 지나도록 계속 막혀있으면(다른 기기에서 진짜로 같은 계정을 쓰고 있는 경우) 더 이상
    // 빠르게 재시도하지 않고 평소 주기로 돌아간다 - 정말로 오래 막힌 상태에서 서버에 불필요한
    // 요청을 계속 쏘지 않기 위함.
    const BLOCKED_FAST_RETRY_LIMIT_MS = 120000;
    let stopped = false;
    let blocked = false;
    let blockedSinceMs = null;

    function getTabId() {
        let id = sessionStorage.getItem("tab_id");
        if (!id) {
            id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
            sessionStorage.setItem("tab_id", id);
        }
        return id;
    }

    // tab_id와 달리 sessionStorage에 저장하지 않는다 - "이 페이지가 로드된 1회"를 식별해야 하므로, 같은
    // 탭 안에서 다른 페이지로 이동하면(=이 스크립트가 다시 처음부터 실행되면) 매번 새로 발급돼야 한다.
    const LOAD_ID = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}-${Math.random()}`;

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

    function hideBlockedOverlay() {
        document.getElementById("dup-session-overlay")?.remove();
    }

    // 409로 막힌 뒤 다음 하트비트를 언제 다시 보낼지 정한다 - 막 막힌 지 얼마 안 됐으면(옛 탭의
    // release-tab이 유실돼서 막힌, 곧 저절로 풀릴 흔한 경우) 훨씬 자주 재시도해서 서버의
    // SESSION_TIMEOUT_SECONDS가 지나는 즉시 자동으로 복구되게 한다. 그 이후로도 계속 막혀있으면
    // (다른 기기에서 실제로 쓰고 있는 경우) 평소 주기로 돌아가 불필요한 요청을 줄인다.
    function scheduleNextHeartbeat() {
        if (stopped) return;
        const useFastRetry = blocked && blockedSinceMs != null &&
            (Date.now() - blockedSinceMs) < BLOCKED_FAST_RETRY_LIMIT_MS;
        setTimeout(sendHeartbeat, useFastRetry ? BLOCKED_RETRY_INTERVAL_MS : HEARTBEAT_INTERVAL_MS);
    }

    async function sendHeartbeat() {
        const token = localStorage.getItem("access_token");
        if (!token || stopped) return;

        try {
            const res = await fetch(`${API_BASE_URL}/auth/heartbeat`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ tab_id: getTabId(), load_id: LOAD_ID }),
            });

            if (res.status === 401) {
                stopped = true;
                localStorage.removeItem("access_token");
                alert("다른 기기에서 로그인되어 접속이 종료되었습니다.");
                window.location.href = "index.html";
                return;
            }
            if (res.status === 409) {
                if (!blocked) blockedSinceMs = Date.now();
                blocked = true;
                showBlockedOverlay("이미 접속 중인 계정입니다.");
            } else if (res.ok && blocked) {
                // 막혀있다가 방금(옛 탭의 세션이 만료되는 등의 이유로) 풀렸다 - 오버레이를 걷어낸다.
                blocked = false;
                blockedSinceMs = null;
                hideBlockedOverlay();
            }
        } catch (error) {
            // 네트워크 문제로는 세션을 끊지 않는다. 다음 하트비트에서 다시 시도.
            console.error("세션 하트비트 실패:", error);
        }

        scheduleNextHeartbeat();
    }

    // 탭이 닫히거나(진짜 종료) 같은 탭에서 사이트 내 다른 페이지로 이동할 때 둘 다 발생한다 - 후자의
    // 경우 이 요청이 새 페이지의 첫 하트비트보다 늦게 서버에 도달해도, 서버가 tab_id뿐 아니라 LOAD_ID까지
    // 함께 확인해서 이미 새 페이지가 갱신해둔 최신 claim을 잘못 지우지 않는다(파일 상단 주석 참고).
    // keepalive: true로 페이지가 이미 언로드된 뒤에도 요청이 배경에서 계속 전송되게 한다.
    function releaseTabOnUnload() {
        const token = localStorage.getItem("access_token");
        if (!token) return;
        fetch(`${API_BASE_URL}/auth/release-tab`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ tab_id: getTabId(), load_id: LOAD_ID }),
            keepalive: true,
        }).catch(() => {}); // 페이지가 이미 넘어가는 중이라 실패해도 딱히 할 수 있는 게 없다 - 다음 자연 만료로 대체.
    }

    if (localStorage.getItem("access_token")) {
        sendHeartbeat(); // 이 안에서 scheduleNextHeartbeat()를 스스로 이어 불러 계속 반복한다.
        window.addEventListener("pagehide", releaseTabOnUnload);
    }
})();
