import type { Phase } from "./protocol";

/** 게임 중인 단계 (로비 제외). 기획서의 "한 판 흐름"과 같다. */
export type TimedPhase = Exclude<Phase, "lobby">;

/** 단계별 시간(초). 총 240초 = 4분. */
export const PHASE_SECONDS: Record<TimedPhase, number> = {
  ban: 10,
  draft: 40,
  placement: 20,
  explore: 20,
  forge: 20,
  battle: 120,
  result: 10,
};

/** 게임이 흐르는 순서. 마지막 단계(result)가 끝나면 로비로 돌아간다. */
export const PHASE_ORDER: readonly TimedPhase[] = [
  "ban",
  "draft",
  "placement",
  "explore",
  "forge",
  "battle",
  "result",
];

export function isTimedPhase(phase: Phase): phase is TimedPhase {
  return phase !== "lobby";
}

/** 다음 단계. 로비에서는 게임이 시작될 때 첫 단계로, result 다음에는 로비로 간다. */
export function nextPhase(phase: Phase): Phase {
  if (phase === "lobby") return PHASE_ORDER[0]!;
  const index = PHASE_ORDER.indexOf(phase);
  return PHASE_ORDER[index + 1] ?? "lobby";
}

export function phaseDurationMs(phase: TimedPhase, scale = 1): number {
  return Math.round(PHASE_SECONDS[phase] * 1000 * scale);
}
