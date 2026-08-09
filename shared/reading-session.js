// 독서/모의고사 진행 중 상태를 localStorage에 남김.
window.ReadingSession = (function () {
    const STORAGE_KEY = "active_reading_session";

    function save(session) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        } catch (err) {
            // localStorage를 못 쓰는 환경(용량 초과, 시크릿 모드 등)이어도 독서 자체는 계속돼야 하므로
            // 조용히 무시한다 - 이 저장은 어디까지나 안전망이지 기능의 필수 조건이 아니다.
        }
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const session = JSON.parse(raw);
            if (!session || typeof session !== "object" || !session.region || !session.sessionType || !session.difficulty) {
                return null;
            }
            return session;
        } catch (err) {
            return null;
        }
    }

    // 새벽 1시 컷오프(서버/reading.js와 동일한 규칙)를 이미 지난 세션인지. 지났다면 더 이상 이어서
    // 잴 순 없지만, 컷오프 전까지 쌓인 시간(accumulatedMs)은 실제로 공부한 시간이니 그냥 버리면 안 된다
    // - reading.js가 이 값을 그대로 자동 제출해서(모의고사가 시간 종료 시 자동 제출되는 것과 동일한
    // 취급) 보상을 지급한 뒤에 지운다. load()가 알아서 지우지 않는 이유도 이 때문 - 호출부가 먼저
    // isExpired로 판단해서 제출을 시도하고, 성공했을 때만 clear()해야 유실 없이 안전하다.
    function isExpired(session) {
        return typeof session.cutoffWallMs === "number" && Date.now() >= session.cutoffWallMs;
    }

    function clear() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (err) {
            // save()와 같은 이유로 무시.
        }
    }

    function buildUrl(session) {
        const p = new URLSearchParams();
        p.set("region", session.region);
        p.set("session_type", session.sessionType);
        p.set("difficulty", session.difficulty);
        if (session.duration) p.set("duration", session.duration);
        return `reading.html?${p.toString()}`;
    }

    return { save, load, clear, buildUrl, isExpired };
})();
