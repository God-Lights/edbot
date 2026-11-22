// 서버 엔진보다 먼저 불러야 하는 전역 설치. (ES 모듈은 import 순서대로 실행된다)
import { installWebSocketGlobals } from "../../../local-server/src/runtime/websocket";
installWebSocketGlobals();
