# 설치 안내 그림 (`web/install.html`)

- `mock.html` + `shoot.cjs`: SideStore 설치 과정의 **예시 그림**(iloader, LocalDevVPN, 개발자 앱 신뢰, 개발자 모드, My Apps)을 만든다.
  ```bash
  OUT=/tmp/out node design/install-mock/shoot.cjs   # 그다음 PNG를 JPG로 바꿔 web/assets/install/step-*.jpg 로
  ```
- `annotate-screenshots.py`: 실제 iPad 스크린샷(SideStore News·Sources·Add Source)에 금색 테두리와 번호를 그린다.
  ```bash
  python3 design/install-mock/annotate-screenshots.py <스크린샷 폴더(5.jpg, 6.jpg, 7.jpg)> web/assets/install
  ```
설치 순서는 SideStore 공식 안내(docs.sidestore.io, 2026-10 기준: iloader + LocalDevVPN)를 따랐다. 안내가 바뀌면 그림과 본문을 함께 고친다.
