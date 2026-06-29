import {
  computeWeightedScore,
  normalizeComponentConfig,
  studentPerfContribution,
} from "./cutoffs.js";
import { predictGrade, distanceToBoundaries, round1 } from "./grades.js";

export function predictStudentGrade(scores, config, finalCutoffs, mode) {
  const { exam1, exam2 } = scores;
  const c = normalizeComponentConfig(config);
  const perfScores = Array.isArray(scores.perfAreas)
    ? scores.perfAreas
    : scores.perf != null
      ? [scores.perf]
      : [];

  if (!Number.isFinite(exam1) || !Number.isFinite(exam2)) {
    return { error: "정기시험 점수를 모두 입력해 주세요." };
  }

  if (perfScores.length !== c.perfAreas.length) {
    return { error: `수행평가 ${c.perfAreas.length}개 영역 점수를 모두 입력해 주세요.` };
  }

  for (let i = 0; i < c.perfAreas.length; i++) {
    if (!Number.isFinite(perfScores[i])) {
      return { error: `수행평가 ${c.perfAreas.length > 1 ? i + 1 : ""} 점수를 입력해 주세요.`.trim() };
    }
  }

  if (!finalCutoffs || !Number.isFinite(finalCutoffs.AB)) {
    return { error: "학기말 분할점수가 설정되지 않았습니다. 1. 기본 탭에서 먼저 계산해 주세요." };
  }

  if (exam1 > c.exam1.max) {
    return { error: `정기시험1 점수는 만점(${c.exam1.max})을 초과할 수 없습니다.` };
  }
  if (exam2 > c.exam2.max) {
    return { error: `정기시험2 점수는 만점(${c.exam2.max})을 초과할 수 없습니다.` };
  }

  for (let i = 0; i < c.perfAreas.length; i++) {
    const label = c.perfAreas.length > 1 ? `수행평가 ${i + 1}` : "수행평가";
    if (perfScores[i] > c.perfAreas[i].max) {
      return { error: `${label} 점수는 만점(${c.perfAreas[i].max})을 초과할 수 없습니다.` };
    }
  }

  const finalScore = computeWeightedScore(exam1, exam2, perfScores, c);
  const prediction = predictGrade(finalScore, finalCutoffs, mode);
  const distances = distanceToBoundaries(finalScore, finalCutoffs, mode);

  const upper = distances.find((d) => d.diff >= 0 && d.diff < 100);
  const lower = [...distances].reverse().find((d) => d.diff < 0);

  return {
    finalScore,
    grade: prediction.grade,
    perfContribution: studentPerfContribution(perfScores, c),
    distances,
    marginAbove: upper ? round1(upper.diff) : null,
    marginBelow: lower ? round1(Math.abs(lower.diff)) : null,
    nearestUpper: upper?.boundary ?? null,
    nearestLower: lower?.boundary ?? null,
    error: null,
  };
}

/** 학급 전체 학기말 성취도 예측 */
export function predictCohortGrades(aligned, config, finalCutoffs, mode) {
  const { studentIds, exam1Scores, exam2Scores, perfScoresByArea, matchedCount, issues } =
    aligned;

  if (issues?.length || !matchedCount) {
    return { rows: [], gradeCounts: {}, matchedCount: 0, error: issues?.[0] || "매칭된 학생이 없습니다." };
  }

  if (!finalCutoffs || !Number.isFinite(finalCutoffs.AB)) {
    return {
      rows: [],
      gradeCounts: {},
      matchedCount: 0,
      error: "학기말 분할점수가 설정되지 않았습니다. 1. 기본 탭에서 「학기말 분할점수 산출」을 먼저 실행해 주세요.",
    };
  }

  const rows = [];
  const gradeCounts = {};

  for (let i = 0; i < studentIds.length; i++) {
    const id = studentIds[i];
    const perfAreas = perfScoresByArea.map((col) => col[i]);
    const result = predictStudentGrade(
      { exam1: exam1Scores[i], exam2: exam2Scores[i], perfAreas },
      config,
      finalCutoffs,
      mode
    );

    if (result.error) {
      return {
        rows: [],
        gradeCounts: {},
        matchedCount: 0,
        error: `${id}: ${result.error}`,
      };
    }

    rows.push({
      id,
      exam1: exam1Scores[i],
      exam2: exam2Scores[i],
      perfAreas,
      finalScore: result.finalScore,
      grade: result.grade,
    });
    gradeCounts[result.grade] = (gradeCounts[result.grade] || 0) + 1;
  }

  return { rows, gradeCounts, matchedCount: rows.length, error: null };
}
