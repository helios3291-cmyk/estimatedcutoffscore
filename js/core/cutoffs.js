import {
  round1,
  round2,
  getBoundaryKeys,
  validateCutoffs,
  roundInt,
  roundCutoffsMonotonic,
  BOUNDARY_LABELS,
} from "./grades.js";

export const MAX_PERF_AREAS = 4;

export function defaultComponentConfig() {
  return {
    exam1: { weight: 30, max: 100 },
    exam2: { weight: 30, max: 100 },
    perfCount: 1,
    perfAreas: [{ weight: 40, max: 40 }],
  };
}

export function migrateWeightsToConfig(weights) {
  const w1 = weights?.exam1 ?? 30;
  const w2 = weights?.exam2 ?? 30;
  const w3 = weights?.perf ?? 40;
  return {
    exam1: { weight: w1, max: 100 },
    exam2: { weight: w2, max: 100 },
    perfCount: 1,
    perfAreas: [{ weight: w3, max: w3 }],
  };
}

/** Legacy config.perf → perfAreas; ensures perfCount matches array length. */
export function normalizeComponentConfig(config) {
  if (!config) return defaultComponentConfig();

  const base = {
    exam1: config.exam1 || { weight: 30, max: 100 },
    exam2: config.exam2 || { weight: 30, max: 100 },
  };

  if (Array.isArray(config.perfAreas) && config.perfAreas.length) {
    const count = Math.min(MAX_PERF_AREAS, Math.max(1, config.perfCount || config.perfAreas.length));
    return {
      ...base,
      perfCount: count,
      perfAreas: config.perfAreas.slice(0, count).map((a) => ({
        weight: a?.weight ?? 0,
        max: a?.max ?? a?.weight ?? 0,
      })),
    };
  }

  const legacy = config.perf || { weight: 40, max: 40 };
  return {
    ...base,
    perfCount: 1,
    perfAreas: [{ weight: legacy.weight, max: legacy.max }],
  };
}

export function normalizePerfCutoffs(perfOrAreas) {
  if (Array.isArray(perfOrAreas)) return perfOrAreas;
  if (perfOrAreas) return [perfOrAreas];
  return [];
}

export function perfWeightSum(config) {
  const c = normalizeComponentConfig(config);
  return round1(c.perfAreas.reduce((s, a) => s + (a.weight || 0), 0));
}

export function contribute(score, component) {
  if (!Number.isFinite(score) || !component || component.max <= 0) return 0;
  return round1((score * component.weight) / component.max);
}

/** NEIS 합산용 — 중간 반올림 없음 */
export function contributeRaw(score, component) {
  if (!Number.isFinite(score) || !component || component.max <= 0) return 0;
  return (score * component.weight) / component.max;
}

export function perfContributionAtBoundaryRaw(key, perfCutoffs, config) {
  const c = normalizeComponentConfig(config);
  const areas = normalizePerfCutoffs(perfCutoffs);
  let sum = 0;
  for (let i = 0; i < c.perfAreas.length; i++) {
    const cut = areas[i];
    if (cut && cut[key] != null) {
      sum += contributeRaw(cut[key], c.perfAreas[i]);
    }
  }
  return sum;
}

export function perfContributionAtBoundary(key, perfCutoffs, config) {
  return round1(perfContributionAtBoundaryRaw(key, perfCutoffs, config));
}

function studentPerfContributionRaw(perfScores, config) {
  const c = normalizeComponentConfig(config);
  let sum = 0;
  for (let i = 0; i < c.perfAreas.length; i++) {
    const score = Array.isArray(perfScores) ? perfScores[i] : perfScores;
    if (Number.isFinite(score)) {
      sum += contributeRaw(score, c.perfAreas[i]);
    }
  }
  return sum;
}

export function studentPerfContribution(perfScores, config) {
  return round1(studentPerfContributionRaw(perfScores, config));
}

export function combineCutoffs(exam1, exam2, perfCutoffs, config, mode) {
  const keys = getBoundaryKeys(mode);
  const c = normalizeComponentConfig(config);
  const result = {};

  for (const key of keys) {
    const totalSum = round2(
      contributeRaw(exam1[key], c.exam1) +
        contributeRaw(exam2[key], c.exam2) +
        perfContributionAtBoundaryRaw(key, perfCutoffs, c)
    );
    result[key] = roundInt(totalSum);
  }

  return result;
}

/** 정기1·수행 환산점 합만으로 부분(정기2 미반영) 분할점수 */
export function combinePartialCutoffs(exam1, perfCutoffs, config, mode) {
  const keys = getBoundaryKeys(mode);
  const c = normalizeComponentConfig(config);
  const result = {};

  for (const key of keys) {
    const totalSum = round2(
      contributeRaw(exam1[key], c.exam1) + perfContributionAtBoundaryRaw(key, perfCutoffs, c)
    );
    result[key] = roundInt(totalSum);
  }

  return result;
}

export function computeContributions(exam1, exam2, perfCutoffs, config, mode, key) {
  const c = normalizeComponentConfig(config);
  const areas = normalizePerfCutoffs(perfCutoffs);
  const perfByArea = c.perfAreas.map((area, i) =>
    areas[i] && areas[i][key] != null ? round2(contributeRaw(areas[i][key], area)) : 0
  );
  const perfTotal = round2(perfByArea.reduce((s, v) => s + v, 0));

  return {
    exam1: round2(contributeRaw(exam1[key], c.exam1)),
    exam2: round2(contributeRaw(exam2[key], c.exam2)),
    perfByArea,
    perf: perfTotal,
  };
}

export function solveExam2Cutoffs(finalTarget, exam1, perfCutoffs, config, mode) {
  const keys = getBoundaryKeys(mode);
  const c = normalizeComponentConfig(config);
  const { exam2: c2 } = c;
  const rawValues = {};
  const issues = [];

  if (c2.weight === 0) {
    return { cutoffs: null, issues: ["정기시험2 반영 비율이 0%입니다."] };
  }

  for (const key of keys) {
    const other =
      contributeRaw(exam1[key], c.exam1) + perfContributionAtBoundaryRaw(key, perfCutoffs, c);
    const raw = ((finalTarget[key] - other) * c2.max) / c2.weight;
    rawValues[key] = raw;

    if (raw < 0) {
      issues.push(
        `목표 학기말 ${BOUNDARY_LABELS[key]}(${finalTarget[key]})는 정기1+수행 환산점 합이 이미 ${round1(other)}점입니다. 목표를 올리거나 확정 분할점수를 낮춰 주세요.`
      );
    } else if (raw > c2.max) {
      issues.push(
        `목표 학기말 ${BOUNDARY_LABELS[key]}(${finalTarget[key]})는 정기2 만점(${c2.max})을 초과하는 역산값(${round1(raw)})입니다. 목표를 낮추거나 확정 분할점수를 조정해 주세요.`
      );
    }
  }

  if (issues.length) {
    return { cutoffs: null, issues, rawValues };
  }

  const result = roundCutoffsMonotonic(rawValues, mode, c2.max);
  const monoIssues = validateCutoffs(result, mode, c2.max);

  if (monoIssues.length) {
    issues.push(
      "역산된 정기2 경계가 단조 감소하지 않습니다. 목표 비율을 조정해 주세요."
    );
    return { cutoffs: null, issues, rawValues };
  }

  return { cutoffs: result, issues: [], rawValues };
}

export function computeWeightedScoreRaw(exam1, exam2, perfScores, config) {
  const c = normalizeComponentConfig(config);
  return (
    contributeRaw(exam1, c.exam1) +
    contributeRaw(exam2, c.exam2) +
    studentPerfContributionRaw(perfScores, c)
  );
}

/** NEIS 방식 — 환산 합계(소수 둘째 자리) 후 원점수 정수 반올림 */
export function computeWeightedScoreBreakdown(exam1, exam2, perfScores, config) {
  const c = normalizeComponentConfig(config);
  const exam1Contrib = round2(contributeRaw(exam1, c.exam1));
  const exam2Contrib = round2(contributeRaw(exam2, c.exam2));
  const perfByArea = c.perfAreas.map((area, i) => {
    const score = Array.isArray(perfScores) ? perfScores[i] : perfScores;
    return Number.isFinite(score) ? round2(contributeRaw(score, area)) : 0;
  });
  const perfContrib = round2(studentPerfContributionRaw(perfScores, c));
  const totalSum = round2(
    contributeRaw(exam1, c.exam1) +
      contributeRaw(exam2, c.exam2) +
      studentPerfContributionRaw(perfScores, c)
  );
  const rawScore = roundInt(totalSum);

  return {
    exam1: exam1Contrib,
    exam2: exam2Contrib,
    perfByArea,
    perf: perfContrib,
    totalSum,
    rawScore,
  };
}

export function computeWeightedScore(exam1, exam2, perfScores, config) {
  return computeWeightedScoreBreakdown(exam1, exam2, perfScores, config).rawScore;
}

export function validateComponentConfig(config) {
  const issues = [];
  const c = normalizeComponentConfig(config);
  const labels = { exam1: "정기시험1", exam2: "정기시험2" };

  for (const [key, label] of Object.entries(labels)) {
    const comp = c[key];
    if (!comp || !Number.isFinite(comp.weight) || comp.weight < 0) {
      issues.push(`${label} 반영 비율이 올바르지 않습니다.`);
    }
    if (!comp || !Number.isFinite(comp.max) || comp.max <= 0) {
      issues.push(`${label} 만점은 0보다 커야 합니다.`);
    }
  }

  if (!c.perfAreas.length) {
    issues.push("수행평가 영역이 하나 이상 필요합니다.");
  }

  c.perfAreas.forEach((area, i) => {
    const label = c.perfAreas.length > 1 ? `수행평가 ${i + 1}` : "수행평가";
    if (!Number.isFinite(area.weight) || area.weight < 0) {
      issues.push(`${label} 반영 비율이 올바르지 않습니다.`);
    }
    if (!Number.isFinite(area.max) || area.max <= 0) {
      issues.push(`${label} 만점은 0보다 커야 합니다.`);
    }
  });

  if (issues.length) return issues;

  const sum = round1(c.exam1.weight + c.exam2.weight + perfWeightSum(c));
  if (Math.abs(sum - 100) >= 0.05) {
    issues.push(`반영 비율 합이 ${sum}%입니다. 합이 100%가 되도록 조정해 주세요.`);
  }

  if (c.exam2.weight === 0) {
    issues.push("정기시험2 반영 비율이 0%이면 3. 학생 성적 기반 정기시험2 준비 기능을 사용할 수 없습니다.");
  }

  return issues;
}

export function validateCombineInputs(exam1, exam2, perfCutoffs, config, mode) {
  const c = normalizeComponentConfig(config);
  const areas = normalizePerfCutoffs(perfCutoffs);
  const perfIssues = [];

  for (let i = 0; i < c.perfAreas.length; i++) {
    const label = c.perfAreas.length > 1 ? `수행평가 ${i + 1}` : "수행평가";
    perfIssues.push(
      ...validateCutoffs(areas[i] || {}, mode, c.perfAreas[i].max).map((m) => `${label}: ${m}`)
    );
  }

  return [
    ...validateComponentConfig(c),
    ...validateCutoffs(exam1, mode, c.exam1.max).map((m) => `정기시험1: ${m}`),
    ...validateCutoffs(exam2, mode, c.exam2.max).map((m) => `정기시험2: ${m}`),
    ...perfIssues,
  ];
}

export function compareFinals(before, after, mode) {
  const keys = getBoundaryKeys(mode);
  return keys.map((key) => ({
    boundary: key,
    before: before[key],
    after: after[key],
    diff: round1(after[key] - before[key]),
  }));
}

export function configToWeights(config) {
  const c = normalizeComponentConfig(config);
  return {
    exam1: c.exam1.weight,
    exam2: c.exam2.weight,
    perf: perfWeightSum(c),
  };
}

/** @deprecated use perfAreas — kept for display helpers */
export function configPerfLegacy(config) {
  const c = normalizeComponentConfig(config);
  const w = perfWeightSum(c);
  return { weight: w, max: w };
}
