// 중복 로그인 감시. 로그인 중인 페이지(home/arena-battle/reading/story-relationship/devtest)에서
// 공통으로 불러온다. 주기적으로 서버에 "나 아직 살아있다"는 하트비트를 보내고,
//   - 401: 다른 기기/브라우저에서 같은 계정으로 로그인해 세션 자체가 넘어감 -> 토큰 지우고 로그인 화면으로.
//   - 409: 같은 로그인을 다른 탭(주로 같은 브라우저의 새 창)이 먼저 쓰고 있음 -> 이 탭만 화면을 덮어 막는다.
//         (토큰은 유효하므로 지우지 않는다 - 막힌 동안은 더 짧은 주기로 자동 재시도해서, 먼저 쓰던
//         탭이 닫히거나 만료되면 새로고침 없이도 스스로 풀린다.)
//
// 탭이 닫힐 때 자리를 즉시 반납하는 releaseTabOnUnload(pagehide 훅)는 예전에 있었지만 제거했다 -
// pagehide는 탭을 진짜로 닫을 때뿐 아니라 같은 탭에서 다른 페이지로 이동할 때도 그대로 발생하는데,
// keepalive 요청이라 페이지가 이미 넘어간 뒤에도 백그라운드에서 살아있다가, 새 페이지가 이미 정상
// 하트비트로 같은 tab_id 자리를 재청구한 "이후"에 뒤늦게 서버에 도달할 수 있었다. 그러면 방금 정상
// 청구된 자리가 도로 비워지고, 그 틈을 다른 요청이 채가면 정작 지금 쓰고 있는 진짜 탭이 다음
// 하트비트에서 "이미 다른 탭이 쓰고 있다"고 튕겨나가는 회귀가 있었다(특히 페이지 로드 즉시 자동으로
// 다음 페이지로 넘어가는 흐름에서 이 경합이 좁은 시간 안에 자주 발생). 로그아웃은 서버가 /auth/logout
// 에서 active_tab_id를 직접 지우므로 이 훅이 없어도 영향 없고, "탭을 그냥 닫아버린" 경우만 최대
// SESSION_TIMEOUT_SECONDS(90초) 뒤 자연 만료 + 위 자동 재시도로(새로고침 없이) 조금 늦게 풀린다.
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

    if (localStorage.getItem("access_token")) {
        sendHeartbeat(); // 이 안에서 scheduleNextHeartbeat()를 스스로 이어 불러 계속 반복한다.
    }
})();
