import { expect, test } from "bun:test";
import { connectLink, connectPage, qrSvg, qrTerminal } from "./connect";

test("접속 링크는 주소와 이름을 담는다", () => {
  const link = connectLink("http://192.168.0.5:8787", "내 서버");
  const u = new URL(link);
  expect(u.protocol).toBe("commander:");
  expect(u.searchParams.get("url")).toBe("http://192.168.0.5:8787");
  expect(u.searchParams.get("name")).toBe("내 서버");
});

test("QR을 SVG와 터미널 글자로 만든다", () => {
  expect(qrSvg("http://a")).toContain("<svg");
  const t = qrTerminal("commander://connect?url=http%3A%2F%2F1.2.3.4%3A8787");
  expect(t.split("\n").length).toBeGreaterThan(10);
});

test("접속 화면은 이름을 이스케이프한다", () => {
  const html = connectPage('<b>"x"', ["http://1.2.3.4:8787"]);
  expect(html).not.toContain("<b>");
  expect(html).toContain("1.2.3.4:8787");
});
