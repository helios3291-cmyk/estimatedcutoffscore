export const TIER_ORDER = ["상", "중", "하"];
export const TIER_DISPLAY_ORDER = ["하", "중", "상"];
export const TIER_KEYS = { 상: "high", 중: "mid", 하: "low" };

export const GRADE_MODE_FIVE = "five";
export const GRADE_MODE_SIX = "six";

export const BOUNDARY_KEYS_FIVE = ["AB", "BC", "CD", "DE"];
export const BOUNDARY_KEYS_SIX = ["AB", "BC", "CD", "DE", "E_fail"];

export const BOUNDARY_LABELS = {
  AB: "A/B",
  BC: "B/C",
  CD: "C/D",
  DE: "D/E",
  E_fail: "E/미도달",
};

export const GRADE_LABELS = ["A", "B", "C", "D", "E", "미도달"];

export function round1(n) {
  return Math.round(n * 10) / 10;
}

export const MIN_PASS_RATE_PERCENT = 10;
export const HARD_TIER_MIN_PASS_RATE = 20;
export const HARD_TIER_RELAXED_MIN_PASS_RATE = 5;
export const NORMAL_ABILITY_GAP_MAX = 15;

export function round2(n) {
  return Math.round(n * 100) / 100;
}

export function roundInt(n) {
  return Math.round(n);
}

export function snapRatePercent(n, minPercent = MIN_PASS_RATE_PERCENT) {
  const floor = Number.isFinite(minPercent) ? minPercent : MIN_PASS_RATE_PERCENT;
  return Math.max(floor, Math.min(100, Math.round(n / 5) * 5));
}

export function snapScore5(n, max) {
  return Math.max(0, Math.min(max, Math.round(n / 5) * 5));
}

export function snapCutoffsMonotonic(rawCutoffs, mode, maxScore) {
  const keys = getBoundaryKeys(mode);
  const result = {};
  let prev = maxScore + 5;

  for (const key of keys) {
    let snapped = snapScore5(rawCutoffs[key] ?? 0, maxScore);
    if (snapped >= prev) {
      snapped = Math.max(0, Math.floor((prev - 1) / 5) * 5);
    }
    result[key] = snapped;
    prev = snapped;
  }

  return result;
}

/** 정기2 역산 초안 — 소수 둘째 자리, 단조 감소 */
export function roundCutoffsMonotonic(rawCutoffs, mode, maxScore) {
  const keys = getBoundaryKeys(mode);
  const result = {};
  let prev = maxScore + 0.01;

  for (const key of keys) {
    let val = round2(Math.max(0, Math.min(maxScore, rawCutoffs[key] ?? 0)));
    if (val >= prev) {
      val = round2(Math.max(0, prev - 0.01));
    }
    result[key] = val;
    prev = val;
  }

  return result;
}

export const TIER_LABELS_KO = { 하: "쉬움", 중: "보통", 상: "어려움" };

export const GRADE_FOR_BOUNDARY = {
  AB: "A",
  BC: "B",
  CD: "C",
  DE: "D",
  E_fail: "E",
};

export const BOUNDARY_FOR_GRADE = {
  A: "AB",
  B: "BC",
  C: "CD",
  D: "DE",
  E: "E_fail",
};

export function gradeColumnsForMode(mode) {
  return mode === GRADE_MODE_SIX ? ["A", "B", "C", "D", "E", "미도달"] : ["A", "B", "C", "D", "E"];
}

/** 통과율 표: 미도달 열 없음, E/미도달 경계는 E열에 표시 */
export function passRateGradeColumnsForMode(mode) {
  return ["A", "B", "C", "D", "E"];
}

const PASS_RATE_GRADE_TO_BOUNDARY = {
  A: "AB",
  B: "BC",
  C: "CD",
  D: "DE",
  E: "E_fail",
};

export function boundaryForPassRateGrade(grade) {
  return PASS_RATE_GRADE_TO_BOUNDARY[grade] ?? null;
}

export function passRateTargetScore(grade, cutoffs, mode) {
  const boundary = boundaryForPassRateGrade(grade);
  if (!boundary) return null;
  if (grade === "E" && mode === GRADE_MODE_FIVE && cutoffs.E_fail == null) {
    return cutoffs.DE != null ? round2(cutoffs.DE * 0.85) : null;
  }
  return cutoffs[boundary] != null ? round2(cutoffs[boundary]) : null;
}

export function boundaryForGradeColumn(grade, mode) {
  if (grade === "미도달") return "E_fail";
  return BOUNDARY_FOR_GRADE[grade] ?? null;
}

export function getBoundaryKeys(mode) {
  return mode === GRADE_MODE_SIX ? BOUNDARY_KEYS_SIX : BOUNDARY_KEYS_FIVE;
}

/** 최종 분할점수 — 소수 첫째 자리 반올림 정수 */
export function normalizeFinalCutoffs(cutoffs, mode) {
  const keys = getBoundaryKeys(mode);
  const out = {};
  for (const k of keys) {
    out[k] = cutoffs?.[k] != null ? roundInt(cutoffs[k]) : null;
  }
  return out;
}

export function parseScore(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? round1(n) : null;
}

/** 정기시험 추정 분할점수 — 소수 둘째 자리 */
export function parseExamCutoffScore(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? round2(n) : null;
}

export function formatExamCutoffScore(n) {
  return formatScore2(n);
}

/** 표시용 — 소수 둘째 자리 */
export function formatScore2(n) {
  return n != null && Number.isFinite(n) ? n.toFixed(2) : "";
}

export function validateCutoffs(cutoffs, mode, maxScore = 100) {
  const keys = getBoundaryKeys(mode);
  const issues = [];

  for (const key of keys) {
    const v = cutoffs[key];
    if (v === null || v === undefined || !Number.isFinite(v)) {
      issues.push(`${BOUNDARY_LABELS[key]} 경계값을 입력해 주세요.`);
      continue;
    }
    if (v < 0 || v > maxScore) {
      issues.push(`${BOUNDARY_LABELS[key]} 경계값은 0~${maxScore} 사이여야 합니다.`);
    }
  }

  if (issues.length) return issues;

  for (let i = 0; i < keys.length - 1; i++) {
    const higher = cutoffs[keys[i]];
    const lower = cutoffs[keys[i + 1]];
    if (higher <= lower) {
      issues.push(
        `${BOUNDARY_LABELS[keys[i]]}(${higher})는 ${BOUNDARY_LABELS[keys[i + 1]]}(${lower})보다 커야 합니다.`
      );
    }
  }

  return issues;
}

export function validateWeights(weights) {
  const issues = [];
  const { exam1, exam2, perf } = weights;
  const values = [exam1, exam2, perf];

  if (values.some((v) => !Number.isFinite(v) || v < 0)) {
    issues.push("반영 비율은 0 이상의 숫자여야 합니다.");
    return issues;
  }

  const sum = round1(exam1 + exam2 + perf);
  if (Math.abs(sum - 100) >= 0.05) {
    issues.push(`반영 비율 합이 ${sum}%입니다. 합이 100%가 되도록 조정해 주세요.`);
  }

  if (exam2 === 0) {
    issues.push("정기시험2 반영 비율이 0%이면 3. 학생 성적 기반 정기시험2 준비 기능을 사용할 수 없습니다.");
  }

  return issues;
}

export function buildGradeRanges(finalCutoffs, mode) {
  const keys = getBoundaryKeys(mode);
  const ranges = [];

  ranges.push({
    grade: "A",
    min: roundInt(finalCutoffs.AB),
    max: 100,
    label: `A  ≥  ${roundInt(finalCutoffs.AB)}`,
  });

  const mids = [
    { grade: "B", high: "AB", low: "BC" },
    { grade: "C", high: "BC", low: "CD" },
    { grade: "D", high: "CD", low: "DE" },
  ];

  for (const { grade, high, low } of mids) {
    const highVal = roundInt(finalCutoffs[high]);
    const lowVal = roundInt(finalCutoffs[low]);
    ranges.push({
      grade,
      min: lowVal,
      max: highVal,
      label: `${grade}  ${lowVal} ~ ${highVal - 1}`,
    });
  }

  if (mode === GRADE_MODE_SIX) {
    const eFail = roundInt(finalCutoffs.E_fail);
    const deVal = roundInt(finalCutoffs.DE);
    ranges.push({
      grade: "E",
      min: eFail,
      max: deVal,
      label: `E  ${eFail} ~ ${deVal - 1}`,
    });
    ranges.push({
      grade: "미도달",
      min: 0,
      max: eFail,
      label: `미도달  <  ${eFail}`,
    });
  } else {
    ranges.push({
      grade: "E",
      min: 0,
      max: roundInt(finalCutoffs.DE),
      label: `E  <  ${roundInt(finalCutoffs.DE)}`,
    });
  }

  return ranges;
}

export function predictGrade(score, finalCutoffs, mode) {
  const s = roundInt(score);
  if (!Number.isFinite(s)) return { grade: null, error: "점수가 올바르지 않습니다." };

  if (s >= finalCutoffs.AB) return { grade: "A", score: s };
  if (s >= finalCutoffs.BC) return { grade: "B", score: s };
  if (s >= finalCutoffs.CD) return { grade: "C", score: s };
  if (s >= finalCutoffs.DE) return { grade: "D", score: s };

  if (mode === GRADE_MODE_SIX) {
    if (s >= finalCutoffs.E_fail) return { grade: "E", score: s };
    return { grade: "미도달", score: s };
  }

  return { grade: "E", score: s };
}

export function distanceToBoundaries(score, finalCutoffs, mode) {
  const keys = getBoundaryKeys(mode);
  const s = round1(score);
  const distances = [];

  for (const key of keys) {
    distances.push({
      boundary: BOUNDARY_LABELS[key],
      value: finalCutoffs[key],
      diff: round1(s - finalCutoffs[key]),
    });
  }

  return distances;
}
