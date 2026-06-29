import {
  getBoundaryKeys,
  predictGrade,
  roundInt,
  round2,
  round1,
  GRADE_MODE_SIX,
} from "./grades.js";
import {
  contribute,
  computeWeightedScore,
  solveExam2Cutoffs,
  combinePartialCutoffs,
  normalizeComponentConfig,
  normalizePerfCutoffs,
  perfContributionAtBoundary,
  studentPerfContribution,
  perfWeightSum,
} from "./cutoffs.js";

export const GRADE_LIST_SIX = ["A", "B", "C", "D", "E", "미도달"];
export const GRADE_LIST_FIVE = ["A", "B", "C", "D", "E"];

export function gradeListForMode(mode) {
  return mode === GRADE_MODE_SIX ? GRADE_LIST_SIX : GRADE_LIST_FIVE;
}

function emptyCounts(mode) {
  const counts = {};
  for (const g of gradeListForMode(mode)) counts[g] = 0;
  return counts;
}

export function computeGradeDistribution(scores, cutoffs, mode) {
  const counts = emptyCounts(mode);
  let n = 0;

  for (const score of scores) {
    if (!Number.isFinite(score)) continue;
    const { grade } = predictGrade(score, cutoffs, mode);
    if (grade && counts[grade] != null) {
      counts[grade]++;
      n++;
    }
  }

  return { counts, total: n, ratios: countsToRatios(counts, n) };
}

function countsToRatios(counts, total) {
  const ratios = {};
  if (!total) {
    for (const g of Object.keys(counts)) ratios[g] = 0;
    return ratios;
  }
  for (const [g, c] of Object.entries(counts)) {
    ratios[g] = Math.round((c / total) * 1000) / 10;
  }
  return ratios;
}

/** 정기1 + 수행 반영비율 합 (예: 70) */
export function partialWeightMax(config) {
  const c = normalizeComponentConfig(config);
  return round1(c.exam1.weight + perfWeightSum(c));
}

/** 정기1·수행 분할점수로 정기2 미반영 부분 경계(환산점 합) 산출 */
export function partialCutoffsFromComponents(exam1Cutoffs, perfCutoffs, config, mode) {
  const c = normalizeComponentConfig(config);
  return {
    partialCutoffs: combinePartialCutoffs(exam1Cutoffs, perfCutoffs, config, mode),
    partialMax: partialWeightMax(c),
  };
}

/**
 * @param {number[]} exam1Scores
 * @param {number[][]} perfScoresByArea
 * @param {object} exam1Cutoffs — 정기1 분할점수
 * @param {object[]|object} perfCutoffs — 수행 분할점수 (영역별)
 */
export function computePartialContributionDistribution(
  exam1Scores,
  perfScoresByArea,
  exam1Cutoffs,
  perfCutoffs,
  config,
  mode
) {
  const c = normalizeComponentConfig(config);
  const { partialCutoffs, partialMax } = partialCutoffsFromComponents(
    exam1Cutoffs,
    perfCutoffs,
    config,
    mode
  );

  const counts = emptyCounts(mode);
  const len = exam1Scores.length;
  let n = 0;

  for (let i = 0; i < len; i++) {
    const e1 = exam1Scores[i];
    if (!Number.isFinite(e1)) continue;

    const areaScores = c.perfAreas.map((_, ai) => perfScoresByArea[ai]?.[i]);
    if (areaScores.some((s) => !Number.isFinite(s))) continue;

    const partial = round2(contribute(e1, c.exam1) + studentPerfContribution(areaScores, c));
    const { grade } = predictGrade(partial, partialCutoffs, mode);
    if (grade && counts[grade] != null) {
      counts[grade]++;
      n++;
    }
  }

  return { counts, total: n, ratios: countsToRatios(counts, n), partialCutoffs, partialMax };
}

export function parseTargetRatios(inputs, mode) {
  const grades = gradeListForMode(mode);
  const ratios = {};
  let sum = 0;
  for (const g of grades) {
    const v = parseFloat(inputs[g]);
    ratios[g] = Number.isFinite(v) ? Math.max(0, v) : 0;
    sum += ratios[g];
  }
  if (Math.abs(sum - 100) > 0.5) {
    return { ratios: null, error: `목표 비율 합이 ${round2(sum)}%입니다. 100%가 되도록 입력해 주세요.` };
  }
  return { ratios, error: null };
}

function finalCutoffsFromTargetRatios(finalScores, ratios, mode) {
  const sorted = [...finalScores].filter(Number.isFinite).sort((a, b) => b - a);
  const n = sorted.length;
  if (!n) return { cutoffs: null, error: "학기말 점수를 계산할 학생이 없습니다." };

  const grades = gradeListForMode(mode);
  const counts = {};
  let assigned = 0;

  for (let i = 0; i < grades.length; i++) {
    const g = grades[i];
    const isLast = i === grades.length - 1;
    counts[g] = isLast ? n - assigned : Math.round((n * ratios[g]) / 100);
    assigned += counts[g];
  }

  const boundaries = {};
  const keys = getBoundaryKeys(mode);
  let idx = 0;

  for (let gi = 0; gi < grades.length - 1; gi++) {
    idx += counts[grades[gi]];
    const boundaryKey = keys[gi];
    if (!boundaryKey) break;
    if (idx <= 0) boundaries[boundaryKey] = sorted[0] + 1;
    else if (idx >= n) boundaries[boundaryKey] = Math.max(0, sorted[n - 1] - 1);
    else boundaries[boundaryKey] = sorted[idx - 1];
  }

  for (const key of keys) {
    if (boundaries[key] == null) boundaries[key] = 0;
    boundaries[key] = roundInt(boundaries[key]);
  }

  for (let i = 0; i < keys.length - 1; i++) {
    if (boundaries[keys[i]] <= boundaries[keys[i + 1]]) {
      boundaries[keys[i + 1]] = Math.max(0, boundaries[keys[i]] - 1);
    }
  }

  return { cutoffs: boundaries, error: null, counts };
}

export function solveExam2ForTargetRatios(
  exam1Scores,
  perfScoresByArea,
  targetRatios,
  exam1Cutoffs,
  perfCutoffs,
  config,
  mode
) {
  const c = normalizeComponentConfig(config);
  const len = exam1Scores.length;
  const finalScores = [];

  for (let i = 0; i < len; i++) {
    const e1 = exam1Scores[i];
    if (!Number.isFinite(e1)) continue;

    const areaScores = c.perfAreas.map((_, ai) => perfScoresByArea[ai]?.[i]);
    if (areaScores.some((s) => !Number.isFinite(s))) continue;

    const e2 = e1;
    finalScores.push(computeWeightedScore(e1, e2, areaScores, c));
  }

  const { cutoffs: targetFinal, error, counts } = finalCutoffsFromTargetRatios(
    finalScores,
    targetRatios,
    mode
  );
  if (error) return { error, exam2Cutoffs: null, targetFinal: null };

  const keys = getBoundaryKeys(mode);
  const areas = normalizePerfCutoffs(perfCutoffs);

  for (const key of keys) {
    const floor = roundInt(contribute(exam1Cutoffs[key], c.exam1) + perfContributionAtBoundary(key, areas, c));
    if (targetFinal[key] < floor) targetFinal[key] = floor;
  }
  for (let i = 0; i < keys.length - 1; i++) {
    if (targetFinal[keys[i]] <= targetFinal[keys[i + 1]]) {
      targetFinal[keys[i + 1]] = Math.max(0, targetFinal[keys[i]] - 1);
    }
  }

  const result = solveExam2Cutoffs(targetFinal, exam1Cutoffs, areas, c, mode);
  if (result.issues.length) {
    return { error: result.issues.join(" "), exam2Cutoffs: null, targetFinal, projectedCounts: counts, rawValues: result.rawValues };
  }

  const achieved = computeGradeDistribution(
    finalScores,
    combineCutoffsForDistribution(exam1Cutoffs, result.cutoffs, areas, c, mode),
    mode
  );

  return {
    error: null,
    exam2Cutoffs: result.cutoffs,
    targetFinal,
    projectedCounts: counts,
    achieved,
    exam1Stats: statsFromScores(exam1Scores),
    rawValues: result.rawValues,
  };
}

function combineCutoffsForDistribution(exam1, exam2, perfCutoffs, config, mode) {
  const keys = getBoundaryKeys(mode);
  const c = normalizeComponentConfig(config);
  const out = {};
  for (const key of keys) {
    out[key] = roundInt(
      contribute(exam1[key], c.exam1) +
        contribute(exam2[key], c.exam2) +
        perfContributionAtBoundary(key, perfCutoffs, c)
    );
  }
  return out;
}

function statsFromScores(scores) {
  const vals = scores.filter(Number.isFinite);
  if (!vals.length) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return {
    mean: round2(mean),
    std: round2(Math.sqrt(variance)),
    n: vals.length,
  };
}
