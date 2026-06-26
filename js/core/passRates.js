import { round1, getBoundaryKeys, TIER_ORDER } from "./grades.js";

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
