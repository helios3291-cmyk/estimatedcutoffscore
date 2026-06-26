import { computeWeightedScore } from "./cutoffs.js";
import { predictGrade, distanceToBoundaries, round1 } from "./grades.js";

export function predictStudentGrade(scores, config, finalCutoffs, mode) {
  const { exam1, exam2, perf } = scores;

  if (![exam1, exam2, perf].every((v) => Number.isFinite(v))) {
    return { error: "학생 점수를 모두 입력해 주세요." };
  }

  if (!finalCutoffs || !Number.isFinite(finalCutoffs.AB)) {
    return { error: "최종 분할점수가 설정되지 않았습니다. 기본 산출 탭에서 먼저 계산해 주세요." };
  }

  if (exam1 > config.exam1.max) {
    return { error: `정기시험1 점수는 만점(${config.exam1.max})을 초과할 수 없습니다.` };
  }
  if (exam2 > config.exam2.max) {
    return { error: `정기시험2 점수는 만점(${config.exam2.max})을 초과할 수 없습니다.` };
  }
  if (perf > config.perf.max) {
    return { error: `수행평가 점수는 만점(${config.perf.max})을 초과할 수 없습니다.` };
  }

  const finalScore = computeWeightedScore(exam1, exam2, perf, config);
  const prediction = predictGrade(finalScore, finalCutoffs, mode);
  const distances = distanceToBoundaries(finalScore, finalCutoffs, mode);

  const upper = distances.find((d) => d.diff >= 0 && d.diff < 100);
  const lower = [...distances].reverse().find((d) => d.diff < 0);

  return {
    finalScore,
    grade: prediction.grade,
    distances,
    marginAbove: upper ? round1(upper.diff) : null,
    marginBelow: lower ? round1(Math.abs(lower.diff)) : null,
    nearestUpper: upper?.boundary ?? null,
    nearestLower: lower?.boundary ?? null,
    error: null,
  };
}
