// 여러 페이지가 공유하는 설정값(동작 로직이 아니라 상수값이라, 이 프로젝트의 "페이지마다 자기 로직을
// 복붙하고 공용 모듈은 안 만든다" 컨벤션의 예외로 이 파일 하나에만 모아둔다). 각 HTML은 자기 페이지의
// 다른 <script>보다 먼저 이 파일을 불러와야 한다.
const PRODUCTION_API_URL = "https://34.64.103.104.sslip.io";
const API_BASE_URL =
    (location.hostname === "localhost" || location.hostname === "127.0.0.1")
        ? "http://127.0.0.1:8000"
        : PRODUCTION_API_URL;

const GOOGLE_CLIENT_ID = "268578042051-m9t1domcipbfn5d9a22f6qv68o4b22fh.apps.googleusercontent.com";

// (1v1) 친선전 실시간 중계(Supabase Realtime)용 - anon 키는 원래 클라이언트에 노출되도록 설계된 키라
// (RLS로 권한을 통제) 여기 상수로 박아둬도 안전하다. service_role 키는 백엔드에만 있고 절대 여기 안 옴.
const SUPABASE_URL = "https://oshrywptesraepsdbjth.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zaHJ5d3B0ZXNyYWVwc2RianRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5OTY5MzksImV4cCI6MjA5OTU3MjkzOX0.LRe3p9JQsFXZsLOBOeHczrUtmyzkXCyOhp8LkVAK0MA";
