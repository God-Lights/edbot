# COMMANDER 웹 클라이언트

체스판 자동 전투를 브라우저에서 합니다. 빌드 단계 없이 순수 HTML/CSS/JavaScript(ES 모듈)로 만들었고,
서버(`../server`)가 **같은 주소에서 정적 파일로 내보냅니다.** (`wrangler.jsonc`의 `assets`)
그래서 로그인 쿠키(`gl_session`)와 WebSocket 모두 같은 출처로 처리되고, **iPad 앱과 같은 서버를 쓰므로 웹과 iPad가 서로 대전할 수 있습니다.**

## 실행

```bash
cd server
echo "REQUIRE_AUTH=false" > .dev.vars   # 로컬 개발: 로그인 검사 끄기
npm run dev                             # http://localhost:8787
```

브라우저에서 `http://localhost:8787` 을 열면 로비가 나옵니다. 연습 대전(봇)이나 방 만들기로 시작하세요.
운영 서버에서는 `https://edgame-api.officialgl.com` 입니다. 주소에 `?room=ABCD` 를 붙이면 그 방으로 바로 들어갑니다.

## 구성

| 파일 | 하는 일 |
|---|---|
| `index.html`, `style.css` | 껍데기와 스타일 |
| `js/main.js` | 화면 그리기(로비·방·결과), 클릭/드래그 처리, 시작 |
| `js/state.js` | 앱 상태, 서버로 보내는 행동, 자동 배치 |
| `js/conn.js` | WebSocket 연결, ping, 토큰 재접속, 서버 시계 보정 |
| `js/api.js` | HTTP API (로그인 확인, 방 만들기, 도감, 랭킹) |
| `js/prep.js` | 준비 화면: 판, 대기석, 상점, 자원 패널, 첫 판 안내 |
| `js/combat.js` | 전투 재생: 서버가 기록한 프레임을 박자 사이로 보간 |
| `js/replay.js` | 다시 보기 모달 (일시정지, 속도, 라운드 선택, 되감기) |
| `js/sfx.js` | WebAudio로 합성한 효과음 (파일 없음) |
| `js/guide.js`, `js/ranking.js` | 가이드, 랭킹 모달 |
| `assets/` | 로고, 기물 아이콘(Xhess) |

## 알아둘 점

- 서버가 보내는 메시지(`/ws/:code`)와 `GET /api/chess` 도감을 iPad 앱과 똑같이 씁니다. 규칙은 모두 서버에 있고 웹은 화면만 그립니다.
- 로그인은 GL Account 쿠키입니다. 로그인하지 않으면 방을 만들 수 없고, 로그인 검사를 끈 개발 서버에서는 이름으로 들어갑니다.
- **빠른 대전**(레이팅 비슷한 상대 매칭), **관전**(`/?watch=방코드`), **다시 보기**, 봇 난이도 선택이 있습니다.
- 터치 화면에서는 드래그 대신 "기물 누르기 → 칸 누르기"로 놓으세요.
