// 같은 와이파이에서 앱이 서버를 찾을 수 있게 알린다. (Bonjour/mDNS: _commander._tcp)
// 필요한 만큼만 구현한 작은 응답기다: 질문(PTR/SRV/TXT/ANY)에 대한 답과, 켤 때 한 번 알림.
import dgram from "node:dgram";

export const SERVICE = "_commander._tcp.local";
const GROUP = "224.0.0.251";
const MDNS_PORT = 5353;
const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33, ANY: 255 } as const;

export interface Advert {
  /** 사람이 보는 서버 이름 (서비스 인스턴스 이름) */
  name: string;
  /** 이 컴퓨터의 와이파이 IPv4 주소들 */
  ips: string[];
  port: number;
  /** TXT 레코드(앱이 읽는다): name, ip, port, ed(에디션), proto */
  txt: Record<string, string>;
}

function utf8Cut(text: string, max: number): string {
  let out = "";
  for (const ch of text) {
    if (Buffer.byteLength(out + ch) > max) break;
    out += ch;
  }
  return out;
}

function encodeName(name: string): Buffer {
  const parts: Buffer[] = [];
  for (const label of name.split(".")) {
    const bytes = Buffer.from(utf8Cut(label, 63));
    parts.push(Buffer.from([bytes.length]), bytes);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function record(name: string, type: number, ttl: number, data: Buffer, flush = true): Buffer {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(flush ? 0x8001 : 1, 2);
  head.writeUInt32BE(ttl, 4);
  head.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodeName(name), head, data]);
}

function txtData(txt: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(txt)) {
    const bytes = Buffer.from(utf8Cut(`${k}=${v}`, 255));
    parts.push(Buffer.from([bytes.length]), bytes);
  }
  return parts.length ? Buffer.concat(parts) : Buffer.from([0]);
}

export function instanceName(ad: Advert): string {
  return `${utf8Cut(ad.name.replace(/\./g, "·"), 60)}.${SERVICE}`;
}

export function hostName(ad: Advert): string {
  let h = 0;
  for (const ch of `${ad.name}:${ad.port}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return `commander-${h.toString(16)}.local`;
}

/** 서비스 알림 응답 패킷을 만든다 (PTR + SRV, TXT, A는 덧붙임) */
export function buildResponse(ad: Advert, ttl = 120): Buffer {
  const inst = instanceName(ad);
  const host = hostName(ad);
  const srv = Buffer.alloc(6);
  srv.writeUInt16BE(0, 0);
  srv.writeUInt16BE(0, 2);
  srv.writeUInt16BE(ad.port, 4);
  const answers = [record(SERVICE, TYPE.PTR, ttl, encodeName(inst), false)];
  const extra = [
    record(inst, TYPE.SRV, ttl, Buffer.concat([srv, encodeName(host)])),
    record(inst, TYPE.TXT, ttl, txtData(ad.txt)),
    ...ad.ips.map((ip) => record(host, TYPE.A, ttl, Buffer.from(ip.split(".").map(Number)))),
  ];
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0x8400, 2); // 응답 + 권한 있는 답
  head.writeUInt16BE(answers.length, 6);
  head.writeUInt16BE(extra.length, 10);
  return Buffer.concat([head, ...answers, ...extra]);
}

function readName(buf: Buffer, start: number): { name: string; next: number } | null {
  const labels: string[] = [];
  let pos = start;
  let next = -1;
  for (let hops = 0; hops < 32; hops++) {
    if (pos >= buf.length) return null;
    const len = buf[pos]!;
    if (len === 0) return { name: labels.join("."), next: next >= 0 ? next : pos + 1 };
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) return null;
      if (next < 0) next = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1]!;
      continue;
    }
    if (pos + 1 + len > buf.length) return null;
    labels.push(buf.toString("utf8", pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  return null;
}

/** 질문 패킷(응답이 아닌 것)에서 질문 목록을 읽는다. 깨졌으면 빈 목록. */
export function parseQuestions(buf: Buffer): Array<{ name: string; type: number }> {
  if (buf.length < 12 || (buf.readUInt16BE(2) & 0x8000) !== 0) return [];
  const count = buf.readUInt16BE(4);
  const out: Array<{ name: string; type: number }> = [];
  let pos = 12;
  for (let i = 0; i < count; i++) {
    const n = readName(buf, pos);
    if (!n || n.next + 4 > buf.length) return out;
    out.push({ name: n.name.toLowerCase(), type: buf.readUInt16BE(n.next) });
    pos = n.next + 4;
  }
  return out;
}

/** 이 질문들이 우리 서비스를 찾는 것인가 */
export function wantsUs(questions: Array<{ name: string; type: number }>, ad: Advert): boolean {
  const inst = instanceName(ad).toLowerCase();
  return questions.some(
    (q) =>
      (q.name === SERVICE && (q.type === TYPE.PTR || q.type === TYPE.ANY)) ||
      (q.name === inst && (q.type === TYPE.SRV || q.type === TYPE.TXT || q.type === TYPE.ANY)),
  );
}

/** 알림을 시작한다. 소켓을 못 열면(포트 점유·방화벽) 조용히 null. 돌려받은 함수로 멈춘다. */
export function startMdns(ad: Advert, log: (msg: string) => void = () => {}): (() => void) | null {
  let socket: dgram.Socket;
  try {
    socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  } catch (error) {
    log(`서버 자동 찾기를 켜지 못했다: ${error instanceof Error ? error.message : error}`);
    return null;
  }
  const response = buildResponse(ad);
  const send = () => socket.send(response, MDNS_PORT, GROUP, () => {});
  socket.on("error", (error) => {
    log(`서버 자동 찾기를 쓸 수 없다: ${error.message}`);
    try { socket.close(); } catch { /* 이미 닫힘 */ }
  });
  socket.on("message", (msg) => {
    if (wantsUs(parseQuestions(msg), ad)) send();
  });
  socket.bind(MDNS_PORT, () => {
    try {
      socket.setMulticastTTL(255);
      socket.setMulticastLoopback(true);
      for (const ip of ad.ips) {
        try { socket.addMembership(GROUP, ip); } catch { /* 그 어댑터는 건너뜀 */ }
      }
      if (ad.ips.length === 0) socket.addMembership(GROUP);
      send();
      setTimeout(send, 1000).unref();
    } catch (error) {
      log(`서버 자동 찾기를 쓸 수 없다: ${error instanceof Error ? error.message : error}`);
    }
  });
  socket.unref();
  return () => {
    try { socket.close(); } catch { /* 이미 닫힘 */ }
  };
}
