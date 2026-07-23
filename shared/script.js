// API_BASE_URL/GOOGLE_CLIENT_ID는 shared/api-config.js가 이 스크립트보다 먼저 로드되어 전역으로 제공한다.

const nicknameInput = document.getElementById('nickname');
const ageInput = document.getElementById('age');
const signupFields = document.getElementById('signup-fields');
const btnCompleteSignup = document.getElementById('btn-complete-signup');

// 구글 인증은 끝났지만 아직 우리 서버엔 가입 전인 유저의 id_token을 잠깐 들고 있는 변수
let pendingIdToken = null;

if (localStorage.getItem('access_token')) {
    window.location.href = "home.html";
}

window.onload = () => {
    if (!window.google) {
        console.error("Google Identity Services 스크립트를 불러오지 못했습니다.");
        return;
    }

    google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential
    });

    google.accounts.id.renderButton(
        document.getElementById('g_id_signin'),
        { theme: 'filled_black', shape: 'pill', size: 'large', text: 'continue_with', width: 280 }
    );
};

// 구글 로그인 성공 시 구글이 호출해주는 콜백. response.credential이 id_token이다.
async function handleGoogleCredential(response) {
    pendingIdToken = response.credential;
    await attemptLogin(pendingIdToken);
}

// 기존 가입자인지 먼저 확인
async function attemptLogin(idToken) {
    try {
        const res = await fetch(`${API_BASE_URL}/auth/google/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_token: idToken })
        });

        if (res.ok) {
            const data = await res.json();
            saveSessionAndGoHome(data);
            return;
        }

        if (res.status === 404) {
            // 신규 유저 -> 닉네임/나이를 입력받아 회원가입으로 이어간다
            signupFields.hidden = false;
            btnCompleteSignup.hidden = false;
            alert("처음 오셨네요! 닉네임과 나이를 입력하고 '가입 완료'를 눌러주세요.");
            return;
        }

        const errorData = await res.json();
        alert(errorData.detail || "로그인에 실패했습니다.");
    } catch (error) {
        console.error("서버 통신 에러:", error);
        alert("서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.");
    }
}

btnCompleteSignup.addEventListener('click', async () => {
    if (!pendingIdToken) {
        alert("먼저 구글 로그인을 진행해주세요.");
        return;
    }

    const nickname = nicknameInput.value.trim();
    const age = ageInput.value.trim();

    if (!nickname || !age) {
        alert("닉네임과 나이를 모두 입력해주세요.");
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/auth/google/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_token: pendingIdToken,
                nickname: nickname,
                age: parseInt(age, 10)
            })
        });

        if (res.ok) {
            const data = await res.json();
            saveSessionAndGoHome(data);
        } else {
            const errorData = await res.json();
            alert(errorData.detail || "회원가입에 실패했습니다.");
        }
    } catch (error) {
        console.error("서버 통신 에러:", error);
        alert("서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.");
    }
});

function saveSessionAndGoHome(data) {
    localStorage.setItem('access_token', data.access_token);
    window.location.href = "home.html";
}
