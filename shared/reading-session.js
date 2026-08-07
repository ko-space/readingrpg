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
            // 새벽 1시 컷오프(서버/reading.js와 동일한 규칙)를 이미 지난 세션은 더 이상 유효하지
            // 않다 - 복구하지 않고 조용히 지운다(어차피 서버도 그만큼은 인정해주지 않는다).
            if (typeof session.cutoffWallMs === "number" && Date.now() >= session.cutoffWallMs) {
                clear();
                return null;
            }
            return session;
        } catch (err) {
            return null;
        }
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

    return { save, load, clear, buildUrl };
})();
