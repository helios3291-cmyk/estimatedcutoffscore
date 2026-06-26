import { round1, getBoundaryKeys, validateCutoffs } from "./grades.js";

export function defaultComponentConfig() {
  return {
    exam1: { weight: 30, max: 100 },
    exam2: { weight: 30, max: 100 },
    perf: { weight: 40, max: 40 },
  };
}

export function migrateWeightsToConfig(weights) {
  const w1 = weights?.exam1 ?? 30;
  const w2 = weights?.exam2 ?? 30;
  const w3 = weights?.perf ?? 40;
  return {
    exam1: { weight: w1, max: 100 },
    exam2: { weight: w2, max: 100 },
    perf: { weight: w3, max: w3 },
  };
}

export function contribute(score, component) {
  if (!Number.isFinite(score) || !component || component.max <= 0) return 0;
  return round1((score * component.weight) / component.max);
}

export function combineCutoffs(exam1, exam2, perf, config, mode) {
  const keys = getBoundaryKeys(mode);
  const result = {};

  for (const key of keys) {
    result[key] = round1(
      contribute(exam1[key], config.exam1) +
        contribute(exam2[key], config.exam2) +
        contribute(perf[key], config.perf)
    );
  }

  return result;
}

export function computeContributions(exam1, exam2, perf, config, mode, key) {
  return {
    exam1: contribute(exam1[key], config.exam1),
    exam2: contribute(exam2[key], config.exam2),
    perf: contribute(perf[key], config.perf),
  };
}

export function solveExam2Cutoffs(finalTarget, exam1, perf, config, mode) {
  const keys = getBoundaryKeys(mode);
  const { exam2: c2 } = config;
  const result = {};
  const issues = [];

  if (c2.weight === 0) {
    return { cutoffs: null, issues: ["정기시험2 반영 비율이 0%입니다."] };
  }

  for (const key of keys) {
    const other =
      contribute(exam1[key], config.exam1) + contribute(perf[key], config.perf);
    const raw = ((finalTarget[key] - other) * c2.max) / c2.weight;
    result[key] = round1(raw);

    if (result[key] < 0 || result[key] > c2.max) {
      issues.push(
        `${key} 경계: 역산값 ${result[key]}이(가) 0~${c2.max} 범위를 벗어납니다.`
      );
    }
  }

  const monoIssues = validateCutoffs(result, mode, c2.max);
  issues.push(...monoIssues);

  return { cutoffs: result, issues };
}

export function computeWeightedScore(exam1, exam2, perf, config) {
  return round1(
    contribute(exam1, config.exam1) +
      contribute(exam2, config.exam2) +
      contribute(perf, config.perf)
  );
}

export function validateComponentConfig(config) {
  const issues = [];
  const labels = { exam1: "정기시험1", exam2: "정기시험2", perf: "수행평가" };

  for (const [key, label] of Object.entries(labels)) {
    const c = config[key];
    if (!c || !Number.isFinite(c.weight) || c.weight < 0) {
      issues.push(`${label} 반영 비율이 올바르지 않습니다.`);
    }
    if (!c || !Number.isFinite(c.max) || c.max <= 0) {
      issues.push(`${label} 만점은 0보다 커야 합니다.`);
    }
  }

  if (issues.length) return issues;

  const sum = round1(config.exam1.weight + config.exam2.weight + config.perf.weight);
  if (Math.abs(sum - 100) >= 0.05) {
    issues.push(`반영 비율 합이 ${sum}%입니다. 합이 100%가 되도록 조정해 주세요.`);
  }

  if (config.exam2.weight === 0) {
    issues.push("정기시험2 반영 비율이 0%이면 정기2 조율 기능을 사용할 수 없습니다.");
  }

  return issues;
}

export function validateCombineInputs(exam1, exam2, perf, config, mode) {
  return [
    ...validateComponentConfig(config),
    ...validateCutoffs(exam1, mode, config.exam1.max).map((m) => `정기시험1: ${m}`),
    ...validateCutoffs(exam2, mode, config.exam2.max).map((m) => `정기시험2: ${m}`),
    ...validateCutoffs(perf, mode, config.perf.max).map((m) => `수행평가: ${m}`),
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

// Legacy alias for weight-only access
export function configToWeights(config) {
  return {
    exam1: config.exam1.weight,
    exam2: config.exam2.weight,
    perf: config.perf.weight,
  };
}
