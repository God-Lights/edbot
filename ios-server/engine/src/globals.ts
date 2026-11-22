// 서버 엔진보다 먼저 불러야 하는 전역 설치. (ES 모듈은 import 순서대로 실행된다)
import { installWebSocketGlobals } from "../../../local-server/src/runtime/websocket";
installWebSocketGlobals();

// 브라우저(WKWebView)의 Request는 Upgrade, Connection, Host, Origin, Cookie 같은 "금지 헤더"를 조용히 지운다.
// 서버 코드는 Upgrade: websocket 과 Origin, Cookie 를 읽으므로, 헤더를 지우지 않는 Request 로 바꿔 끼운다.
// (Request 를 다시 감싸는 `new Request(request)` 도 같은 규칙을 거친다.)
const NativeRequest = globalThis.Request;

class OpenRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init);
    const source = init?.headers ?? (typeof input === "object" && "headers" in input ? (input as Request).headers : undefined);
    // new Headers() 는 금지 헤더를 거르지 않는다(guard: none).
    Object.defineProperty(this, "headers", { value: new Headers(source as HeadersInit | undefined), enumerable: true });
  }
}

(globalThis as unknown as { Request: unknown }).Request = OpenRequest;
