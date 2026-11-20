import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../src/protocol";

describe("parseClientMessage", () => {
  it("올바른 ready, ping을 받아들인다", () => {
    expect(parseClientMessage('{"t":"ready","ready":true}')).toEqual({ t: "ready", ready: true });
    expect(parseClientMessage('{"t":"ping","ts":123}')).toEqual({ t: "ping", ts: 123 });
  });

  it("ban, pick, place, lock을 받아들인다", () => {
    expect(parseClientMessage('{"t":"ban","characterId":"richmond"}')).toEqual({
      t: "ban",
      characterId: "richmond",
    });
    expect(parseClientMessage('{"t":"pick","characterId":"lappus"}')).toEqual({
      t: "pick",
      characterId: "lappus",
    });
    expect(parseClientMessage('{"t":"place","characterId":"lappus","lane":"center"}')).toEqual({
      t: "place",
      characterId: "lappus",
      lane: "center",
    });
    expect(parseClientMessage('{"t":"lock"}')).toEqual({ t: "lock" });
  });

  it("ban, pick, place의 잘못된 값은 null", () => {
    expect(parseClientMessage('{"t":"ban"}')).toBeNull();
    expect(parseClientMessage('{"t":"ban","characterId":""}')).toBeNull();
    expect(parseClientMessage('{"t":"pick","characterId":5}')).toBeNull();
    expect(parseClientMessage(`{"t":"pick","characterId":"${"x".repeat(65)}"}`)).toBeNull();
    expect(parseClientMessage('{"t":"place","characterId":"lappus"}')).toBeNull();
    expect(parseClientMessage('{"t":"place","characterId":"lappus","lane":"top"}')).toBeNull();
    expect(parseClientMessage('{"t":"place","lane":"center"}')).toBeNull();
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
