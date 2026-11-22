import { expect, test } from "bun:test";
import { buildResponse, hostName, instanceName, parseQuestions, SERVICE, wantsUs, type Advert } from "./mdns";

const ad: Advert = { name: "내 컴퓨터 서버", ips: ["192.168.0.5"], port: 8787, txt: { name: "내 컴퓨터 서버", ip: "192.168.0.5", port: "8787", ed: "expert", proto: "1" } };

function query(name: string, type: number): Buffer {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(1, 4);
  const labels = name.split(".").flatMap((l) => [Buffer.from([Buffer.byteLength(l)]), Buffer.from(l)]);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(1, 2);
  return Buffer.concat([head, ...labels, Buffer.from([0]), tail]);
}

test("서비스를 찾는 질문에만 답한다", () => {
  expect(wantsUs(parseQuestions(query(SERVICE, 12)), ad)).toBe(true);
  expect(wantsUs(parseQuestions(query("_http._tcp.local", 12)), ad)).toBe(false);
  expect(wantsUs(parseQuestions(query(instanceName(ad), 33)), ad)).toBe(true);
});

test("응답 패킷은 PTR 하나와 덧붙임(SRV, TXT, A)을 담는다", () => {
  const r = buildResponse(ad);
  expect(r.readUInt16BE(2)).toBe(0x8400);
  expect(r.readUInt16BE(6)).toBe(1);
  expect(r.readUInt16BE(10)).toBe(3);
  expect(parseQuestions(r)).toEqual([]); // 응답은 질문으로 읽지 않는다
  expect(r.includes(Buffer.from("ip=192.168.0.5"))).toBe(true);
  expect(r.includes(Buffer.from([192, 168, 0, 5]))).toBe(true);
});

test("깨진 패킷에도 멈추지 않는다", () => {
  expect(parseQuestions(Buffer.from([1, 2, 3]))).toEqual([]);
  const bad = query(SERVICE, 12).subarray(0, 20);
  expect(Array.isArray(parseQuestions(bad))).toBe(true);
  expect(hostName(ad)).toMatch(/^commander-[0-9a-f]+\.local$/);
});
