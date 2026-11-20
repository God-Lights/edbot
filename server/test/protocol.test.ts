import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../src/protocol";

describe("parseClientMessage", () => {
  it("올바른 ready, ping을 받아들인다", () => {
    expect(parseClientMessage('{"t":"ready","ready":true}')).toEqual({ t: "ready", ready: true });
    expect(parseClientMessage('{"t":"ping","ts":123}')).toEqual({ t: "ping", ts: 123 });
  });

  it("형식이 틀리면 null", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage("[]")).toBeNull();
    expect(parseClientMessage("null")).toBeNull();
    expect(parseClientMessage('{"t":"ready"}')).toBeNull();
    expect(parseClientMessage('{"t":"ready","ready":"yes"}')).toBeNull();
    expect(parseClientMessage('{"t":"ping","ts":"1"}')).toBeNull();
    expect(parseClientMessage('{"t":"unknown"}')).toBeNull();
  });

  it("문자열이 아니거나 너무 길면 null", () => {
    expect(parseClientMessage(new ArrayBuffer(8))).toBeNull();
    expect(parseClientMessage(`{"t":"ping","ts":1,"pad":"${"x".repeat(5000)}"}`)).toBeNull();
  });
});
