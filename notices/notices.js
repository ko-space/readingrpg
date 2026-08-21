(function () {
    const PARTIAL_URL = "notices/notices-partial.html";
    const content = document.getElementById("notices-content");
    const openButton = document.querySelector('[data-modal-target="modal-alerts"]');
    const badge = document.getElementById("notice-badge");

    let loaded = false;
    let loading = false;
    let noticeData = [];

    function authHeaders() {
        const token = localStorage.getItem("access_token");
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    // 인라인 색 강조만 처리한다(표 칸 텍스트에도 재사용) - [[red]]/[[green]]/[[blue]]/[[gold]]...[[/태그]].
    // 마커가 아닌 부분은 전부 escapeHtml을 거치므로 안전하다(임의 HTML 삽입 불가).
    function renderInline(text) {
        const src = String(text ?? "");
        const re = /\[\[(red|green|blue|gold)\]\]([\s\S]*?)\[\[\/\1\]\]/g;
        let out = "";
        let lastIndex = 0;
        let m;
        while ((m = re.exec(src))) {
            out += escapeHtml(src.slice(lastIndex, m.index));
            out += `<span class="notice-${m[1]}">${escapeHtml(m[2])}</span>`;
            lastIndex = re.lastIndex;
        }
        out += escapeHtml(src.slice(lastIndex));
        return out;
    }

    // 헤더1|헤더2\n값1|값2\n... 형태(|로 칸, 줄바꿈으로 행 구분, 첫 줄=헤더)를 실제 <table>로 바꾼다.
    // 칸 텍스트에도 renderInline을 적용해서 표 안에서도 색 강조를 쓸 수 있다(예: 방향성 칸).
    function renderTable(inner) {
        const rows = inner.trim().split("\n").filter((row) => row.trim()).map((row) => row.split("|").map((cell) => cell.trim()));
        if (!rows.length) return "";
        const [headerRow, ...bodyRows] = rows;
        const theadHtml = `<tr>${headerRow.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr>`;
        const tbodyHtml = bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("");
        return `<table class="notice-table"><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table>`;
    }

    // 공지 본문의 아주 단순한 마커 언어(마크다운이 아니라 seed.py 전용 최소 문법 - 그 외 마크업은 없음).
    // 지원 마커:
    //   [[red]] [[green]] [[blue]] [[gold]] ...[[/태그]] : 색 강조(renderInline, 표 칸 안에서도 동작)
    //   [[h]]...[[/h]] : 섹션 제목
    //   [[hr]] : 구분선
    //   [[table]]헤더1|헤더2\n값1|값2\n...[[/table]] : 표(renderTable 참고)
    // 닫는 태그가 없는 등 마크업이 깨지면 해당 여는 마커를 그냥 리터럴 텍스트로 표시한다(방어적 처리).
    function renderNoticeBody(text) {
        const src = String(text ?? "");
        const markerRe = /\[\[(h|hr|table)\]\]/g;
        let out = "";
        let i = 0;
        while (i < src.length) {
            markerRe.lastIndex = i;
            const m = markerRe.exec(src);
            if (!m) {
                out += renderInline(src.slice(i));
                break;
            }
            out += renderInline(src.slice(i, m.index));
            const tag = m[1];
            if (tag === "hr") {
                out += `<hr class="notice-hr">`;
                i = m.index + m[0].length;
                continue;
            }
            const closeTag = `[[/${tag}]]`;
            const closeIdx = src.indexOf(closeTag, m.index + m[0].length);
            if (closeIdx === -1) {
                out += escapeHtml(m[0]);
                i = m.index + m[0].length;
                continue;
            }
            const inner = src.slice(m.index + m[0].length, closeIdx);
            out += tag === "table" ? renderTable(inner) : `<div class="notice-h">${renderInline(inner)}</div>`;
            i = closeIdx + closeTag.length;
        }
        return out;
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
                `<p class="screen-placeholder">공지를 불러오지 못했습니다. (${escapeHtml(error.message)})</p>`;
        } finally {
            loading = false;
        }
    }

    function updateBadge() {
        const unreadCount = noticeData.filter((n) => !n.read).length;
        if (badge) {
            badge.textContent = unreadCount;
            badge.hidden = unreadCount === 0;
        }
    }

    function renderList() {
        const listEl = document.getElementById("notice-list");
        if (!listEl) return;

        if (noticeData.length === 0) {
            listEl.innerHTML = `<p class="screen-placeholder">등록된 공지가 없습니다.</p>`;
            return;
        }

        listEl.innerHTML = noticeData.map((n) => `
            <button class="notice-row" type="button" data-notice-id="${n.id}">
                <span class="notice-row-title">${escapeHtml(n.title)}</span>
                ${n.read ? "" : '<span class="notice-new-dot"></span>'}
            </button>
        `).join("");
    }

    async function refreshData() {
        try {
            const res = await fetch(`${API_BASE_URL}/notices/`, { headers: authHeaders() });
            if (!res.ok) return;
            noticeData = await res.json();
            updateBadge();
            renderList();
        } catch (error) {
        }
    }

    async function openDetail(noticeId) {
        const notice = noticeData.find((n) => n.id === Number(noticeId));
        const overlay = document.getElementById("notice-detail-overlay");
        if (!notice || !overlay) return;

        const img = document.getElementById("notice-detail-image");
        const title = document.getElementById("notice-detail-title");
        const body = document.getElementById("notice-detail-body");

        if (notice.image_file) {
            img.onerror = () => { img.hidden = true; };
            img.src = notice.image_file;
            img.hidden = false;
        } else {
            img.hidden = true;
        }
        title.textContent = notice.title;
        body.innerHTML = renderNoticeBody(notice.body);
        overlay.hidden = false;

        if (!notice.read) {
            notice.read = true;
            renderList();
            updateBadge();
            try {
                await fetch(`${API_BASE_URL}/notices/${noticeId}/read`, {
                    method: "POST",
                    headers: authHeaders(),
                });
            } catch (error) {
                // 다음에 다시열면 재시도
            }
        }
    }

    function closeDetail() {
        const overlay = document.getElementById("notice-detail-overlay");
        if (overlay) overlay.hidden = true;
    }

    function bindInteractions() {
        document.getElementById("notice-list")?.addEventListener("click", (event) => {
            const row = event.target.closest(".notice-row");
            if (!row) return;
            openDetail(row.dataset.noticeId);
        });

        document.getElementById("notice-detail-close")?.addEventListener("click", closeDetail);
        document.getElementById("notice-detail-overlay")?.addEventListener("click", (event) => {
            if (event.target.id === "notice-detail-overlay") closeDetail();
        });
    }

    openButton?.addEventListener("click", async () => {
        await ensureLoaded();
        await refreshData();
    });

    window.addEventListener("load", refreshData);
})();
