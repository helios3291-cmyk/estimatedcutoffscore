import {
  round1,
  round2,
  getBoundaryKeys,
  TIER_ORDER,
  TIER_DISPLAY_ORDER,
  GRADE_FOR_BOUNDARY,
  boundaryForGradeColumn,
  gradeColumnsForMode,
  passRateGradeColumnsForMode,
  boundaryForPassRateGrade,
  passRateTargetScore,
  TIER_LABELS_KO,
  GRADE_MODE_SIX,
  GRADE_MODE_FIVE,
  snapRatePercent,
  MIN_PASS_RATE_PERCENT,
  HARD_TIER_MIN_PASS_RATE,
  HARD_TIER_RELAXED_MIN_PASS_RATE,
  NORMAL_ABILITY_GAP_MAX,
} from "./grades.js";

const GRADE_MONOTONIC_GAP = 5;

/** 인접 등급 간 최대 통과율 격차 (권장 15%p, 완화 20·25%p) */
export const ADJACENT_GRADE_GAP_PREFERRED = NORMAL_ABILITY_GAP_MAX;
export const ADJACENT_GRADE_GAP_RELAXED = [20, 25];
export const ADJACENT_GAP_CAPS = [15, 20, 25, 999];
export const PREFERRED_ABILITY_GAPS = [ADJACENT_GRADE_GAP_PREFERRED];
export const RELAXED_ABILITY_GAPS = ADJACENT_GRADE_GAP_RELAXED;
export const ABILITY_GAP_LIMITS = [15, 20, 25, 30];
export const ABILITY_GAP_WARN_THRESHOLD = NORMAL_ABILITY_GAP_MAX;

/** 교사 입력 샘플 기반 내장 프리셋 (하→중→상) */
export const PASS_RATE_PRESETS = {
  high: {
    A: { 하: 95, 중: 85, 상: 80 },
    B: { 하: 80, 중: 70, 상: 65 },
    C: { 하: 65, 중: 55, 상: 50 },
    D: { 하: 50, 중: 40, 상: 35 },
    E: { 하: 30, 중: 20, 상: 15 },
  },
  moderate: {
    A: { 하: 90, 중: 80, 상: 65 },
    B: { 하: 75, 중: 65, 상: 55 },
    C: { 하: 60, 중: 50, 상: 40 },
    D: { 하: 45, 중: 35, 상: 25 },
    E: { 하: 30, 중: 20, 상: 15 },
  },
};

export const PRESET_LABELS = { high: "높음", moderate: "보통" };

function cloneMatrix(matrix) {
  const next = {};
  for (const [grade, tiers] of Object.entries(matrix || {})) {
    next[grade] = { ...(tiers || {}) };
  }
  return next;
}

/** 같은 난이도에서 인접 등급 간 최대 통과율 격차 */
export function abilityGapForTier(matrix, tier, gradeCols) {
  return maxAdjacentGradeGapForTier(matrix, tier, gradeCols);
}

export function adjacentGradeGap(matrix, upperGrade, lowerGrade, tier) {
  return (matrix[upperGrade]?.[tier] ?? 0) - (matrix[lowerGrade]?.[tier] ?? 0);
}

export function maxAdjacentGradeGapForTier(matrix, tier, gradeCols) {
  let maxGap = 0;
  for (let i = 1; i < gradeCols.length; i++) {
    maxGap = Math.max(
      maxGap,
      adjacentGradeGap(matrix, gradeCols[i - 1], gradeCols[i], tier)
    );
  }
  return maxGap;
}

export function maxAdjacentGradeGap(matrix, mode) {
  const cols = passRateGradeColumnsForMode(mode);
  let maxGap = 0;
  for (const tier of TIER_ORDER) {
    maxGap = Math.max(maxGap, maxAdjacentGradeGapForTier(matrix, tier, cols));
  }
  return maxGap;
}

function enforceAdjacentGradeGapsForTier(tierRates, gradeCols, maxGap) {
  const cap = Math.max(maxGap, GRADE_MONOTONIC_GAP);
  const out = {};
  for (const g of gradeCols) {
    out[g] = snapRatePercent(tierRates[g] ?? MIN_PASS_RATE_PERCENT);
  }

  for (let round = 0; round < 24; round++) {
    let changed = false;

    out[gradeCols[0]] = snapRatePercent(Math.min(100, out[gradeCols[0]]));

    for (let i = 1; i < gradeCols.length; i++) {
      const upper = gradeCols[i - 1];
      const lower = gradeCols[i];
      const gap = out[upper] - out[lower];

      if (gap < GRADE_MONOTONIC_GAP) {
        const nextUpper = snapRatePercent(out[lower] + GRADE_MONOTONIC_GAP);
        if (nextUpper !== out[upper]) {
          out[upper] = nextUpper;
          changed = true;
        }
      } else if (gap > cap) {
        const nextUpper = snapRatePercent(out[lower] + cap);
        if (nextUpper !== out[upper]) {
          out[upper] = nextUpper;
          changed = true;
        }
      }
    }

    for (const g of gradeCols) {
      const clamped = snapRatePercent(Math.max(MIN_PASS_RATE_PERCENT, Math.min(100, out[g])));
      if (clamped !== out[g]) {
        out[g] = clamped;
        changed = true;
      }
    }

    if (!changed) break;
  }

  return out;
}

export function enforceAdjacentGradeGapMatrix(matrix, mode, maxGap) {
  const cols = passRateGradeColumnsForMode(mode);
  const next = cloneMatrix(matrix);

  for (const tier of TIER_ORDER) {
    const tierRates = {};
    for (const g of cols) {
      tierRates[g] = next[g]?.[tier] ?? MIN_PASS_RATE_PERCENT;
    }
    const fixed = enforceAdjacentGradeGapsForTier(tierRates, cols, maxGap);
    for (const g of cols) {
      if (!next[g]) next[g] = {};
      next[g][tier] = fixed[g];
    }
  }

  return next;
}

/** @deprecated 인접 등급 격차 규칙 — enforceAdjacentGradeGapMatrix 사용 */
export function enforceAbilityGapMatrix(matrix, mode, maxGap) {
  return enforceAdjacentGradeGapMatrix(matrix, mode, maxGap);
}

export function matrixMatchesCutoffs(tierRows, matrix, cutoffs, mode, tolerance = 0.05) {
  const expected = expectedScoresByGrade(tierRows, matrix, mode);
  const grades = passRateGradeColumnsForMode(mode);

  for (const grade of grades) {
    const target = passRateTargetScore(grade, cutoffs, mode);
    if (target == null) continue;
    if (Math.abs((expected[grade] ?? 0) - target) >= tolerance) return false;
  }

  return true;
}

export function applyAbilityGapWithCutoffs(matrix, tierRows, cutoffs, mode) {
  const limits = ABILITY_GAP_LIMITS;
  let fallback = cloneMatrix(matrix);

  for (const maxGap of limits) {
    let candidate = cloneMatrix(matrix);
    for (let pass = 0; pass < 3; pass++) {
      candidate = enforceTierMonotonicMatrix(candidate, mode);
      candidate = enforceGradeMonotonicMatrix(candidate, mode);
    }
    candidate = enforceAdjacentGradeGapMatrix(candidate, mode, maxGap);
    candidate = enforcePassRateMatrix(candidate, mode);
    fallback = candidate;
    if (matrixMatchesCutoffs(tierRows, candidate, cutoffs, mode)) {
      return { matrix: candidate, maxGapUsed: maxGap, matched: true };
    }
  }

  return { matrix: fallback, maxGapUsed: limits[limits.length - 1], matched: false };
}

export function tiersExceedingAbilityGap(matrix, mode, threshold = ABILITY_GAP_WARN_THRESHOLD) {
  const cols = passRateGradeColumnsForMode(mode);
  const violations = [];
  for (const tier of TIER_ORDER) {
    if (maxAdjacentGradeGapForTier(matrix, tier, cols) > threshold) {
      violations.push(tier);
    }
  }
  return violations;
}

const BOUNDARY_TO_PASS_GRADE = {
  AB: "A",
  BC: "B",
  CD: "C",
  DE: "D",
  E_fail: "E",
};

const TEMPLATE_BASE = { 하: 0.95, 중: 0.78, 상: 0.55 };
const BOUNDARY_SCALE = { AB: 1.0, BC: 0.88, CD: 0.74, DE: 0.58, E_fail: 0.42 };

export function aggregatePointsByDifficulty(questions) {
  const totals = { 상: 0, 중: 0, 하: 0 };
  for (const q of questions) {
    if (TIER_ORDER.includes(q.tier) && Number.isFinite(q.point)) {
      totals[q.tier] = round1(totals[q.tier] + q.point);
    }
  }
  return totals;
}

export function validatePointsByDifficulty(points) {
  const issues = [];
  const sum = round1(TIER_ORDER.reduce((a, t) => a + (points[t] || 0), 0));

  for (const tier of TIER_ORDER) {
    const v = points[tier];
    if (!Number.isFinite(v) || v < 0) {
      issues.push(`${tier} 난이도 배점합이 올바르지 않습니다.`);
    }
  }

  if (Math.abs(sum - 100) >= 0.05) {
    issues.push(`난이도별 배점 합이 ${sum}점입니다. 합이 100점이 되도록 조정해 주세요.`);
  }

  return issues;
}

function clampRate(r) {
  return Math.max(0, Math.min(1, round1(r * 1000) / 1000));
}

export function expectedScore(points, rates) {
  let sum = 0;
  for (const tier of TIER_ORDER) {
    sum += (points[tier] || 0) * (rates[tier] || 0);
  }
  return round1(sum);
}

function initialRatesForBoundary(targetScore, points, boundaryKey) {
  const scale = BOUNDARY_SCALE[boundaryKey] ?? 0.7;
  const rates = {};
  let raw = {};

  for (const tier of TIER_ORDER) {
    raw[tier] = clampRate(TEMPLATE_BASE[tier] * scale);
  }

  let score = expectedScore(points, raw);
  const target = round1(targetScore);

  if (Math.abs(score - target) < 0.05) {
    return raw;
  }

  const midPoint = points.중 || 0;
  if (midPoint > 0) {
    const other =
      (points.하 || 0) * raw.하 + (points.상 || 0) * raw.상;
    let midRate = (target - other) / midPoint;
    midRate = clampRate(midRate);
    raw.중 = midRate;
    score = expectedScore(points, raw);

    if (Math.abs(score - target) >= 0.05) {
      const totalP = (points.하 || 0) + (points.중 || 0) + (points.상 || 0);
      if (totalP > 0) {
        const uniform = clampRate(target / totalP);
        raw = { 하: uniform, 중: uniform, 상: uniform };
      }
    }
  }

  for (const tier of TIER_ORDER) {
    rates[tier] = raw[tier];
  }

  return rates;
}

export function calibrateGradeColumnRates(points, targetScore, boundaryKey = "AB") {
  const target = round1(targetScore);
  if (!Number.isFinite(target)) {
    return {
      하: MIN_PASS_RATE_PERCENT,
      중: MIN_PASS_RATE_PERCENT,
      상: MIN_PASS_RATE_PERCENT,
    };
  }

  const seed = initialRatesForBoundary(target, points, boundaryKey);
  let best = {
    하: snapRatePercent((seed.하 || 0) * 100),
    중: snapRatePercent((seed.중 || 0) * 100),
    상: snapRatePercent((seed.상 || 0) * 100),
  };
  let bestErr = Math.abs(scoreFromPercentRates(points, best) - target);

  for (let mid = MIN_PASS_RATE_PERCENT; mid <= 100; mid += 5) {
    for (let high = MIN_PASS_RATE_PERCENT; high <= mid - GRADE_MONOTONIC_GAP; high += 5) {
      for (let low = mid; low <= 100; low += 5) {
        const candidate = { 하: low, 중: mid, 상: high };
        const err = Math.abs(scoreFromPercentRates(points, candidate) - target);
        if (err < bestErr) {
          bestErr = err;
          best = { ...candidate };
        }
      }
    }
  }

  return best;
}

function scoreFromPercentRates(points, ratesPct) {
  const rates = {};
  for (const tier of TIER_ORDER) {
    rates[tier] = (ratesPct[tier] || 0) / 100;
  }
  return expectedScore(points, rates);
}

function recalibrateAllColumns(matrix, points, cutoffs, mode) {
  const cols = passRateGradeColumnsForMode(mode);
  const next = cloneMatrix(matrix);

  for (const grade of cols) {
    const boundary = boundaryForPassRateGrade(grade);
    const target = passRateTargetScore(grade, cutoffs, mode);
    if (target == null || !boundary) continue;
    next[grade] = calibrateGradeColumnRates(points, target, boundary);
  }

  return next;
}

const SOLVER_TIER_KEYS = ["하", "중", "상"];
const GRADE_STEP_OFFSETS = { A: 0, B: 5, C: 10, D: 15, E: 20 };

function clonePresetMatrix(presetKey, mode) {
  const preset = PASS_RATE_PRESETS[presetKey];
  const cols = passRateGradeColumnsForMode(mode);
  const matrix = {};
  for (const grade of cols) {
    if (preset?.[grade]) matrix[grade] = { ...preset[grade] };
  }
  return matrix;
}

export function selectPresetKey(tierRows, cutoffs, mode) {
  let bestKey = "high";
  let bestErr = Infinity;
  for (const key of Object.keys(PASS_RATE_PRESETS)) {
    const matrix = clonePresetMatrix(key, mode);
    const err = cutoffErrorSum(matrix, tierRows, cutoffs, mode);
    if (err < bestErr || (err === bestErr && key === "high")) {
      bestErr = err;
      bestKey = key;
    }
  }
  return bestKey;
}

function totalTierPoints(tierRows) {
  return TIER_ORDER.reduce((sum, tier) => {
    const row = tierRows.find((r) => r.tier === tier);
    return sum + (row?.pointsSum ?? 0);
  }, 0);
}

export function shiftMatrixColumnsToCutoffs(matrix, tierRows, cutoffs, mode) {
  const cols = passRateGradeColumnsForMode(mode);
  let next = cloneMatrix(matrix);
  const totalPoints = totalTierPoints(tierRows);

  for (let pass = 0; pass < 3; pass++) {
    for (const grade of cols) {
      const target = passRateTargetScore(grade, cutoffs, mode);
      if (target == null) continue;
      const current = expectedScoreFromMatrix(tierRows, next, grade);
      const scoreDelta = round1(target - current);
      if (Math.abs(scoreDelta) < 0.05) continue;

      const rateShift =
        totalPoints > 0 ? Math.round(((scoreDelta * 100) / totalPoints) / 5) * 5 : 0;
      if (rateShift === 0) continue;

      if (!next[grade]) next[grade] = {};
      for (const tier of TIER_ORDER) {
        next[grade][tier] = snapRatePercent((next[grade][tier] ?? 0) + rateShift);
      }
    }
  }

  return next;
}

function projectFeasibleMatrix(matrix, mode, maxAdjacentGap) {
  let next = cloneMatrix(matrix);
  const cap = Number.isFinite(maxAdjacentGap) ? maxAdjacentGap : 999;

  for (let pass = 0; pass < 6; pass++) {
    if (cap < 999) {
      next = enforceAdjacentGradeGapMatrix(next, mode, cap);
    }
    next = enforcePassRateMatrix(next, mode);
  }

  return next;
}

function cutoffErrorSum(matrix, tierRows, cutoffs, mode) {
  const expected = expectedScoresByGrade(tierRows, matrix, mode);
  const grades = passRateGradeColumnsForMode(mode);
  let sum = 0;

  for (const grade of grades) {
    const target = passRateTargetScore(grade, cutoffs, mode);
    if (target == null) continue;
    sum += Math.abs((expected[grade] ?? 0) - target);
  }

  return sum;
}

function passRateObjective(matrix, tierRows, cutoffs, mode) {
  let score = cutoffErrorSum(matrix, tierRows, cutoffs, mode);
  const cols = passRateGradeColumnsForMode(mode);
  const bottom = cols[cols.length - 1];

  for (const tier of TIER_ORDER) {
    for (let i = 1; i < cols.length; i++) {
      const gap = adjacentGradeGap(matrix, cols[i - 1], cols[i], tier);
      if (gap > NORMAL_ABILITY_GAP_MAX) {
        score += (gap - NORMAL_ABILITY_GAP_MAX) * 0.35;
      }
    }
  }

  const hardRate = matrix[bottom]?.상 ?? 0;
  if (hardRate < HARD_TIER_MIN_PASS_RATE) {
    score += (HARD_TIER_MIN_PASS_RATE - hardRate) * 0.35;
  }

  return score;
}

function seedFromColumnCalibrate(cutoffs, points, mode) {
  let matrix = {};

  for (const boundary of getBoundaryKeys(mode)) {
    const grade = BOUNDARY_TO_PASS_GRADE[boundary];
    const target = cutoffs[boundary];
    if (!grade || !Number.isFinite(target)) continue;
    matrix[grade] = calibrateGradeColumnRates(points, target, boundary);
  }

  if (mode === GRADE_MODE_FIVE && Number.isFinite(cutoffs.DE)) {
    const eTarget = passRateTargetScore("E", cutoffs, mode);
    if (eTarget != null) {
      matrix.E = calibrateGradeColumnRates(points, eTarget, "E_fail");
    }
  }

  return matrix;
}

function matrixFromATierRates(aRates, mode) {
  const cols = passRateGradeColumnsForMode(mode);
  const matrix = {};
  for (const grade of cols) {
    const off = GRADE_STEP_OFFSETS[grade] ?? 0;
    matrix[grade] = {
      하: (aRates.하 ?? 0) - off,
      중: (aRates.중 ?? 0) - off,
      상: (aRates.상 ?? 0) - off,
    };
  }
  return matrix;
}

function seedFromPreset(cutoffs, tierRows, mode) {
  const presetKey = selectPresetKey(tierRows, cutoffs, mode);
  const shifted = shiftMatrixColumnsToCutoffs(clonePresetMatrix(presetKey, mode), tierRows, cutoffs, mode);
  return { matrix: shifted, presetKey };
}

function optimizePassRateMatrix(initial, tierRows, cutoffs, mode, maxAdjacentGap) {
  const seeds = [initial, seedFromColumnCalibrate(cutoffs, tierRowsToPoints(tierRows), mode)];

  let best = null;
  let bestObj = Infinity;

  for (const raw of seeds) {
    const result = localSearchPassRates(raw, tierRows, cutoffs, mode, maxAdjacentGap);
    if (result.objective < bestObj) {
      bestObj = result.objective;
      best = result.matrix;
    }
  }

  return { matrix: best, objective: bestObj };
}

function tierRowsToPoints(tierRows) {
  const points = { 상: 0, 중: 0, 하: 0 };
  for (const row of tierRows) {
    if (row.tier && Number.isFinite(row.pointsSum)) {
      points[row.tier] = round1(row.pointsSum);
    }
  }
  return points;
}

function localSearchPassRates(initial, tierRows, cutoffs, mode, maxAdjacentGap, maxIter = 2500) {
  const cols = passRateGradeColumnsForMode(mode);
  let best = projectFeasibleMatrix(initial, mode, maxAdjacentGap);
  let bestObj = passRateObjective(best, tierRows, cutoffs, mode);
  let current = cloneMatrix(best);

  for (let iter = 0; iter < maxIter; iter++) {
    let improved = false;

    for (const grade of cols) {
      for (const tier of SOLVER_TIER_KEYS) {
        for (const delta of [-GRADE_MONOTONIC_GAP, GRADE_MONOTONIC_GAP]) {
          const trialRaw = cloneMatrix(current);
          if (!trialRaw[grade]) trialRaw[grade] = {};
          trialRaw[grade][tier] = (trialRaw[grade][tier] ?? 0) + delta;
          const trial = projectFeasibleMatrix(trialRaw, mode, maxAdjacentGap);
          const obj = passRateObjective(trial, tierRows, cutoffs, mode);

          if (obj < bestObj) {
            bestObj = obj;
            best = trial;
            current = trial;
            improved = true;
          }
        }
      }
    }

    if (!improved) break;
  }

  return { matrix: best, objective: bestObj };
}

/** exam-helper 제안 계산 — 프리셋 기반 + 규칙 feasible + 목표 분할점수 L1 오차 최소화 */
export function buildPassRateMatrixFromCutoffs(cutoffs, points, mode, tierRows = null) {
  const rows = tierRows || buildTierRowsBasic(points);
  const { matrix: presetSeed, presetKey } = seedFromPreset(cutoffs, rows, mode);

  let resultMatrix = null;
  let bestObj = Infinity;
  let chosenGapCap = 25;

  for (const maxGap of ADJACENT_GAP_CAPS) {
    const { matrix, objective } = optimizePassRateMatrix(presetSeed, rows, cutoffs, mode, maxGap);
    if (matrix && objective < bestObj) {
      bestObj = objective;
      resultMatrix = matrix;
      chosenGapCap = maxGap;
    }
  }

  if (!resultMatrix) {
    resultMatrix = projectFeasibleMatrix(presetSeed, mode, 25);
  }

  for (const hardMin of HARD_TIER_MIN_CANDIDATES) {
    const candidate = setHardTierMinimum(resultMatrix, mode, hardMin);
    const refined = localSearchPassRates(candidate, rows, cutoffs, mode, chosenGapCap, 800);
    if (refined.objective <= bestObj + 0.01) {
      resultMatrix = refined.matrix;
      bestObj = refined.objective;
    }
    if (achievedHardTierMin(resultMatrix, mode) >= hardMin) break;
  }

  resultMatrix = projectFeasibleMatrix(resultMatrix, mode, chosenGapCap);

  const adjacentGapUsed = maxAdjacentGradeGap(resultMatrix, mode);
  const adjacentGapMatched = matrixMatchesCutoffs(rows, resultMatrix, cutoffs, mode);

  return {
    matrix: resultMatrix,
    presetKey,
    presetLabel: PRESET_LABELS[presetKey] ?? presetKey,
    adjacentGapUsed,
    adjacentGapMatched,
    adjacentGapCapUsed: chosenGapCap < 999 ? chosenGapCap : null,
    abilityGapUsed: adjacentGapUsed,
    abilityGapMatched: adjacentGapMatched,
    hardTierMinUsed: achievedHardTierMin(resultMatrix, mode),
    cutoffErrorSum: cutoffErrorSum(resultMatrix, rows, cutoffs, mode),
  };
}

const HARD_TIER_MIN_CANDIDATES = [
  HARD_TIER_MIN_PASS_RATE,
  15,
  10,
  HARD_TIER_RELAXED_MIN_PASS_RATE,
];

function lowestPassRateGrade(mode) {
  const cols = passRateGradeColumnsForMode(mode);
  return cols[cols.length - 1];
}

function setHardTierMinimum(matrix, mode, minRate) {
  const bottom = lowestPassRateGrade(mode);
  const next = cloneMatrix(matrix);
  if (!next[bottom]) next[bottom] = {};
  const floor = snapRatePercent(minRate, HARD_TIER_RELAXED_MIN_PASS_RATE);
  next[bottom].상 = Math.max(next[bottom].상 ?? 0, floor);
  return enforcePassRateMatrix(next, mode);
}

function achievedHardTierMin(matrix, mode) {
  const bottom = lowestPassRateGrade(mode);
  const rate = matrix[bottom]?.상 ?? 0;
  for (const min of HARD_TIER_MIN_CANDIDATES) {
    if (rate >= min) return min;
  }
  return HARD_TIER_RELAXED_MIN_PASS_RATE;
}

export function collectPassRateWarnings(matrix, mode) {
  const cols = passRateGradeColumnsForMode(mode);
  const warnings = [];
  const bottom = cols[cols.length - 1];

  const hardRate = matrix[bottom]?.상 ?? 0;
  if (hardRate < HARD_TIER_MIN_PASS_RATE) {
    warnings.push({ grade: bottom, tier: "상", kind: "hard-min" });
  }

  for (const tier of TIER_ORDER) {
    for (let i = 1; i < cols.length; i++) {
      const upper = cols[i - 1];
      const lower = cols[i];
      const gap = adjacentGradeGap(matrix, upper, lower, tier);
      if (gap > NORMAL_ABILITY_GAP_MAX) {
        warnings.push({ grade: upper, tier, kind: "ability-gap" });
        warnings.push({ grade: lower, tier, kind: "ability-gap" });
      }
    }
  }

  return warnings;
}

export function solvePassRatesForCutoffs(cutoffs, pointsByDifficulty, mode) {
  const keys = getBoundaryKeys(mode);
  const result = {};

  for (const key of keys) {
    const target = cutoffs[key];
    if (!Number.isFinite(target)) continue;
    result[key] = initialRatesForBoundary(target, pointsByDifficulty, key);
  }

  return result;
}

export function adjustPassRate(points, rates, fixedTiers, tierToSolve, targetScore) {
  const next = { ...rates };
  const target = round1(targetScore);

  for (const tier of fixedTiers) {
    next[tier] = clampRate(next[tier]);
  }

  const otherSum = TIER_ORDER.filter((t) => t !== tierToSolve).reduce(
    (a, t) => a + (points[t] || 0) * (next[t] || 0),
    0
  );
  const denom = points[tierToSolve] || 0;

  if (denom <= 0) {
    return { rates: next, score: expectedScore(points, next), error: `${tierToSolve} 배점이 0입니다.` };
  }

  next[tierToSolve] = clampRate((target - otherSum) / denom);
  const score = expectedScore(points, next);

  return { rates: next, score, error: null };
}

export function distributeItemRates(items, tierRates) {
  return items.map((item) => ({
    ...item,
    passRate: tierRates[item.tier] ?? 0,
  }));
}

export function validateQuestions(questions) {
  const issues = [];
  if (!questions.length) {
    issues.push("문항을 1개 이상 입력해 주세요.");
    return issues;
  }

  let sum = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!Number.isFinite(q.point) || q.point <= 0) {
      issues.push(`${i + 1}번 문항 배점이 올바르지 않습니다.`);
    }
    if (!TIER_ORDER.includes(q.tier)) {
      issues.push(`${i + 1}번 문항 난이도를 선택해 주세요.`);
    }
    sum += Number.isFinite(q.point) ? q.point : 0;
  }

  sum = round1(sum);
  if (Math.abs(sum - 100) >= 0.05) {
    issues.push(`문항 배점 합이 ${sum}점입니다. 합이 100점이 되도록 조정해 주세요.`);
  }

  return issues;
}

export function passRatesToMatrix(passRates, mode) {
  const matrix = {};
  const keys = getBoundaryKeys(mode);

  for (const boundary of keys) {
    const grade = BOUNDARY_TO_PASS_GRADE[boundary];
    if (!grade || !passRates[boundary]) continue;
    matrix[grade] = {};
    for (const tier of TIER_ORDER) {
      matrix[grade][tier] = snapRatePercent((passRates[boundary][tier] || 0) * 100);
    }
  }

  return enforcePassRateMatrix(matrix, mode);
}

/** 같은 난이도에서 A > B > C > D > E (인접 등급 간 최소 5%p) — 상위 등급부터 상한 적용 */
function enforceGradeRatesForTier(gradeRates, gradeCols) {
  const out = { ...gradeRates };
  let prevCap = 100;

  for (const grade of gradeCols) {
    let val = snapRatePercent(out[grade] ?? 0);
    if (grade === gradeCols[0]) {
      val = Math.min(prevCap, val);
    } else {
      val = Math.min(prevCap - GRADE_MONOTONIC_GAP, val);
    }
    val = Math.max(MIN_PASS_RATE_PERCENT, val);
    val = snapRatePercent(val);
    out[grade] = val;
    prevCap = val;
  }

  return out;
}

export function enforceGradeMonotonicMatrix(matrix, mode) {
  const cols = passRateGradeColumnsForMode(mode);
  const next = { ...matrix };

  for (const tier of TIER_ORDER) {
    const tierRates = {};
    for (const grade of cols) {
      tierRates[grade] = next[grade]?.[tier] ?? 0;
    }
    const fixed = enforceGradeRatesForTier(tierRates, cols);
    for (const grade of cols) {
      if (!next[grade]) next[grade] = {};
      next[grade][tier] = fixed[grade];
    }
  }

  return next;
}

export function validateGradeMonotonicMatrix(matrix, mode) {
  const cols = passRateGradeColumnsForMode(mode);
  const issues = [];

  for (const tier of TIER_ORDER) {
    for (let i = 1; i < cols.length; i++) {
      const upper = cols[i - 1];
      const lower = cols[i];
      const upperRate = matrix[upper]?.[tier] ?? 0;
      const lowerRate = matrix[lower]?.[tier] ?? 0;
      if (upperRate - lowerRate < GRADE_MONOTONIC_GAP) {
        issues.push({ grade: lower, tier, kind: "grade" });
      }
    }
  }

  return issues;
}

/** 난이도·성취도 단조 조건을 모두 적용 */
export function enforcePassRateMatrix(matrix, mode) {
  let next = { ...matrix };
  for (let pass = 0; pass < 3; pass++) {
    next = enforceGradeMonotonicMatrix(next, mode);
    next = enforceTierMonotonicMatrix(next, mode);
  }
  return next;
}

const TIER_MONOTONIC_ORDER = ["하", "중", "상"];

function enforceTierRates(rates) {
  const next = { ...rates };
  next.상 = snapRatePercent(next.상 ?? 0);
  next.중 = snapRatePercent(Math.max(next.상 + GRADE_MONOTONIC_GAP, next.중 ?? 0));
  next.하 = snapRatePercent(Math.max(next.중 + GRADE_MONOTONIC_GAP, next.하 ?? 0));
  next.하 = Math.min(100, next.하);
  return next;
}

export function enforceTierMonotonicMatrix(matrix, mode) {
  const cols = passRateGradeColumnsForMode(mode);
  const next = { ...matrix };
  for (const grade of cols) {
    if (!next[grade]) continue;
    next[grade] = enforceTierRates(next[grade]);
  }
  return next;
}

export function validateTierMonotonicMatrix(matrix, mode) {
  const cols = passRateGradeColumnsForMode(mode);
  const issues = [];

  for (const grade of cols) {
    const rates = matrix[grade];
    if (!rates) continue;
    const easy = rates.하 ?? 0;
    const mid = rates.중 ?? 0;
    const hard = rates.상 ?? 0;
    if (easy <= mid) {
      issues.push({ grade, tier: "중", kind: "tier" });
    }
    if (mid <= hard) {
      issues.push({ grade, tier: "상", kind: "tier" });
    }
  }

  return issues;
}

export function matrixToPassRates(matrix, mode) {
  const result = {};
  const keys = getBoundaryKeys(mode);

  for (const boundary of keys) {
    const grade = BOUNDARY_TO_PASS_GRADE[boundary];
    if (!grade || !matrix[grade]) continue;
    result[boundary] = {};
    for (const tier of TIER_ORDER) {
      result[boundary][tier] = Math.max(0, Math.min(100, matrix[grade][tier] || 0)) / 100;
    }
  }

  return result;
}

export function buildTierRowsBasic(points) {
  return TIER_DISPLAY_ORDER.map((tier) => ({
    type: "전체",
    tier,
    tierLabel: TIER_LABELS_KO[tier],
    questionNums: "-",
    questionCount: "-",
    pointsSum: points[tier] || 0,
  }));
}

export function buildTierRowsFromQuestions(questions) {
  const groups = new Map();

  for (const q of questions) {
    const key = q.tier;
    if (!groups.has(key)) {
      groups.set(key, { tier: q.tier, nums: [], points: 0 });
    }
    const g = groups.get(key);
    g.nums.push(q.num);
    g.points = round1(g.points + q.point);
  }

  const tierOrder = { 하: 0, 중: 1, 상: 2 };

  return [...groups.values()]
    .sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier])
    .map((g) => ({
      type: "전체",
      tier: g.tier,
      tierLabel: TIER_LABELS_KO[g.tier],
      questionNums: g.nums.join(", "),
      questionCount: g.nums.length,
      pointsSum: g.points,
    }));
}

export function expectedScoreFromMatrix(tierRows, matrix, grade) {
  const rates = matrix[grade];
  if (!rates) return 0;
  let sum = 0;
  for (const row of tierRows) {
    const pts = typeof row.pointsSum === "number" ? row.pointsSum : 0;
    sum += pts * ((rates[row.tier] || 0) / 100);
  }
  return round2(sum);
}

export function expectedScoresByGrade(tierRows, matrix, mode) {
  const cols = passRateGradeColumnsForMode(mode);
  const scores = {};
  for (const grade of cols) {
    scores[grade] = expectedScoreFromMatrix(tierRows, matrix, grade);
  }
  return scores;
}

export function computeExamCutoffsFromPassMatrix(tierRows, matrix, mode) {
  const expected = expectedScoresByGrade(tierRows, matrix, mode);
  const cutoffs = {};
  for (const grade of passRateGradeColumnsForMode(mode)) {
    const boundary = boundaryForPassRateGrade(grade);
    if (!boundary) continue;
    if (mode === GRADE_MODE_FIVE && boundary === "E_fail") continue;
    cutoffs[boundary] = expected[grade];
  }
  return cutoffs;
}
