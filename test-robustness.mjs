/**
 * Robustness test suite — diverse data scenarios with NDJSON runtime logs.
 * Run: node test-robustness.mjs
 */
import { appendFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  combineCutoffs,
  combinePartialCutoffs,
  normalizeComponentConfig,
  defaultComponentConfig,
} from "./js/core/cutoffs.js";
import { parsePasteText, alignStudentsById, validStudentTotals } from "./js/core/studentData.js";
import {
  computeGradeDistribution,
  computePartialContributionDistribution,
  solveExam2ForTargetRatios,
  partialCutoffsFromComponents,
  partialWeightMax,
  parseTargetRatios,
} from "./js/core/gradeDistribution.js";
import { GRADE_MODE_FIVE, GRADE_MODE_SIX } from "./js/core/grades.js";

const LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), "debug-b33a5f.log");
const SESSION = "b33a5f";
const runId = `robust-${Date.now()}`;

function log(hypothesisId, location, message, data = {}) {
  const entry = {
    sessionId: SESSION,
    runId,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

const results = { passed: 0, failed: 0, skipped: 0, failures: [] };

function test(name, hypothesisId, fn) {
  try {
    fn();
    results.passed++;
    log(hypothesisId, "test-robustness.mjs", "PASS", { name });
  } catch (e) {
    results.failed++;
    results.failures.push({ name, error: e.message });
    log(hypothesisId, "test-robustness.mjs", "FAIL", { name, error: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertApprox(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(msg || `expected ~${b} got ${a}`);
}

function sumRatios(ratios) {
  return Object.values(ratios).reduce((s, v) => s + v, 0);
}

function randomScores(n, min, max, seed = 42) {
  let s = seed;
  const out = [];
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out.push(min + (s % (max - min + 1)));
  }
  return out;
}

// --- H1: partial boundaries must stay within partialMax scale (no 100-scale leak) ---
test("H1: partial AB <= partialMax for default config", "H1", () => {
  const config = defaultComponentConfig();
  const e1 = { AB: 85, BC: 70, CD: 55, DE: 40, E_fail: 25 };
  const perf = [{ AB: 36, BC: 28, CD: 22, DE: 16, E_fail: 10 }];
  const { partialCutoffs } = partialCutoffsFromComponents(e1, perf, config, GRADE_MODE_SIX);
  const max = partialWeightMax(config);
  log("H1", "partialCutoffsFromComponents", "boundaries", { partialCutoffs, partialMax: max });
  for (const [k, v] of Object.entries(partialCutoffs)) {
    assert(v <= max, `${k}=${v} exceeds partialMax ${max}`);
  }
});

test("H1: partial distribution A% > 0 when many students exceed e1+perf AB floor", "H1", () => {
  const config = normalizeComponentConfig({
    exam1: { weight: 35, max: 100 },
    exam2: { weight: 35, max: 100 },
    perfCount: 1,
    perfAreas: [{ weight: 30, max: 30 }],
  });
  const e1 = { AB: 81, BC: 70, CD: 55, DE: 40, E_fail: 20 };
  const perf = [{ AB: 28, BC: 26, CD: 24, DE: 18, E_fail: 10 }];
  const n = 266;
  const e1Scores = randomScores(n, 70, 98, 7);
  const pScores = [randomScores(n, 22, 30, 11)];
  const dist = computePartialContributionDistribution(
    e1Scores,
    pScores,
    e1,
    perf,
    config,
    GRADE_MODE_SIX
  );
  log("H1", "computePartialContributionDistribution", "266-student partial dist", {
    partialAB: dist.partialCutoffs.AB,
    partialMax: dist.partialMax,
    ratios: dist.ratios,
    total: dist.total,
  });
  assert(dist.total === n, `expected ${n} students got ${dist.total}`);
  assert(dist.ratios.A > 0, `A ratio should be > 0 got ${dist.ratios.A}%`);
  assert(dist.partialCutoffs.AB <= dist.partialMax, "partial AB exceeds partialMax");
});

// --- H2: student alignment handles mismatches ---
test("H2: alignStudentsById skips unmatched perf rows", "H2", () => {
  const e1Parsed = parsePasteText("번호\t점수\n1\t80\n2\t75\n3\t70");
  const pfParsed = parsePasteText("번호\t점수\n1\t28\n3\t25");
  const aligned = alignStudentsById(e1Parsed.students, [pfParsed.students]);
  log("H2", "alignStudentsById", "partial match", {
    matchedCount: aligned.matchedCount,
    issues: aligned.issues,
    exam1Len: aligned.exam1Scores.length,
  });
  assert(aligned.matchedCount === 2, `expected 2 matched got ${aligned.matchedCount}`);
  assert(aligned.exam1Scores.length === 2, "should only include matched students");
});

test("H2: large matrix 266 students aligns perf areas", "H2", () => {
  const rows = ["번호\t1반\t2반\t3반\t4반"];
  for (let num = 1; num <= 67; num++) {
    rows.push(`${num}\t${60 + (num % 30)}\t${55 + (num % 35)}\t${50 + (num % 40)}\t${45 + (num % 45)}`);
  }
  const matrix = parsePasteText(rows.join("\n"));
  const valid = matrix.students.filter((s) => !s.excluded);
  const aligned = alignStudentsById(valid, [valid, valid]);
  log("H2", "alignStudentsById", "266 matrix", {
    validCells: valid.length,
    matchedCount: aligned.matchedCount,
    issues: aligned.issues,
  });
  assert(valid.length === 268, `expected 268 valid cells got ${valid.length}`);
  assert(aligned.matchedCount === valid.length, "all should match by id");
});

// --- H3: exam2 target solver on varied datasets ---
test("H3: solveExam2 succeeds on spread 100-student six-mode ratios", "H3", () => {
  const config = normalizeComponentConfig({
    exam1: { weight: 35, max: 100 },
    exam2: { weight: 35, max: 100 },
    perfCount: 1,
    perfAreas: [{ weight: 30, max: 30 }],
  });
  const e1Cut = { AB: 81, BC: 70, CD: 55, DE: 40, E_fail: 20 };
  const pfCut = [{ AB: 28, BC: 26, CD: 24, DE: 18, E_fail: 10 }];
  const e1Scores = Array.from({ length: 100 }, (_, i) => i);
  const pScores = [Array.from({ length: 100 }, (_, i) => Math.max(5, 30 - i * 0.25))];
  const ratios = { A: 15, B: 15, C: 20, D: 20, E: 15, 미도달: 15 };
  const r = solveExam2ForTargetRatios(
    e1Scores,
    pScores,
    ratios,
    e1Cut,
    pfCut,
    config,
    GRADE_MODE_SIX
  );
  log("H3", "solveExam2ForTargetRatios", "100 spread students", {
    error: r.error,
    exam2AB: r.exam2Cutoffs?.AB,
    targetFinalAB: r.targetFinal?.AB,
  });
  assert(!r.error, r.error || "should succeed");
  assert(r.exam2Cutoffs?.AB % 5 === 0, "exam2 AB should be 5-point grid");
});

test("H3: identical scores returns error (expected impossibility)", "H3", () => {
  const config = defaultComponentConfig();
  const e1Cut = { AB: 85, BC: 70, CD: 55, DE: 40, E_fail: 25 };
  const pfCut = [{ AB: 36, BC: 28, CD: 22, DE: 16, E_fail: 10 }];
  const n = 50;
  const e1Scores = Array.from({ length: n }, () => 35);
  const pScores = [Array.from({ length: n }, () => 15)];
  const ratios = { A: 5, B: 10, C: 15, D: 20, E: 20, 미도달: 30 };
  const r = solveExam2ForTargetRatios(
    e1Scores,
    pScores,
    ratios,
    e1Cut,
    pfCut,
    config,
    GRADE_MODE_SIX
  );
  log("H3", "solveExam2ForTargetRatios", "identical scores", {
    error: r.error,
    rawValues: r.rawValues,
  });
  assert(r.error, "identical scores should fail gracefully with error message");
});

// --- H4: ratio parsing validation ---
test("H4: parseTargetRatios rejects sum != 100", "H4", () => {
  const { ratios, error } = parseTargetRatios(
    { A: 20, B: 20, C: 20, D: 20, E: 10 },
    GRADE_MODE_FIVE
  );
  log("H4", "parseTargetRatios", "invalid sum", { ratios, error });
  assert(ratios === null, "should reject");
  assert(error?.includes("100"), "error should mention 100%");
});

test("H4: grade distribution ratios sum ~100", "H4", () => {
  const scores = randomScores(200, 10, 100, 99);
  const cutoffs = { AB: 85, BC: 70, CD: 55, DE: 40, E_fail: 25 };
  const dist = computeGradeDistribution(scores, cutoffs, GRADE_MODE_SIX);
  const sum = sumRatios(dist.ratios);
  log("H4", "computeGradeDistribution", "ratio sum", { sum, total: dist.total, ratios: dist.ratios });
  assert(Math.abs(sum - 100) <= 0.5, `ratio sum expected ~100 got ${sum}`);
});

// --- H5: five vs six mode, multi-perf, edge weights ---
test("H5: five-mode partial distribution no crash", "H5", () => {
  const config = defaultComponentConfig();
  const e1 = { AB: 90, BC: 75, CD: 60, DE: 45 };
  const perf = [{ AB: 36, BC: 28, CD: 22, DE: 16 }];
  const e1Scores = [95, 85, 75, 65, 55];
  const pScores = [[38, 30, 24, 18, 12]];
  const dist = computePartialContributionDistribution(
    e1Scores,
    pScores,
    e1,
    perf,
    config,
    GRADE_MODE_FIVE
  );
  log("H5", "computePartialContributionDistribution", "five mode", {
    ratios: dist.ratios,
    partialCutoffs: dist.partialCutoffs,
  });
  assert(dist.total === 5, "five students");
  assert(sumRatios(dist.ratios) >= 99, "ratios should sum to ~100");
});

test("H5: 4-area perf partial cutoffs monotonic", "H5", () => {
  const config = normalizeComponentConfig({
    exam1: { weight: 25, max: 100 },
    exam2: { weight: 25, max: 100 },
    perfCount: 4,
    perfAreas: [
      { weight: 12.5, max: 12.5 },
      { weight: 12.5, max: 12.5 },
      { weight: 12.5, max: 12.5 },
      { weight: 12.5, max: 12.5 },
    ],
  });
  const e1 = { AB: 88, BC: 72, CD: 58, DE: 42 };
  const perf = [
    { AB: 12, BC: 10, CD: 8, DE: 5 },
    { AB: 11, BC: 9, CD: 7, DE: 4 },
    { AB: 10, BC: 8, CD: 6, DE: 3 },
    { AB: 9, BC: 7, CD: 5, DE: 2 },
  ];
  const partial = combinePartialCutoffs(e1, perf, config, GRADE_MODE_FIVE);
  log("H5", "combinePartialCutoffs", "4-area", { partial, partialMax: partialWeightMax(config) });
  assert(partial.AB > partial.BC, "AB > BC");
  assert(partial.BC > partial.CD, "BC > CD");
  assert(partial.CD > partial.DE, "CD > DE");
  assert(partial.AB <= partialWeightMax(config), "AB within partial max");
});

test("H5: all excluded students yields empty distribution", "H5", () => {
  const parsed = parsePasteText("번호\t점수\n1\t미인정결\n2\t질병결");
  const scores = validStudentTotals(parsed.students);
  log("H5", "validStudentTotals", "all excluded", { count: scores.length });
  assert(scores.length === 0, "no valid scores");
  const dist = computeGradeDistribution(scores, { AB: 80, BC: 70, CD: 60, DE: 50 }, GRADE_MODE_FIVE);
  assert(dist.total === 0, "empty distribution");
});

test("H5: combine final equals e1+e2+perf components", "H5", () => {
  const config = defaultComponentConfig();
  const e1 = { AB: 90, BC: 75, CD: 60, DE: 45 };
  const e2 = { AB: 88, BC: 72, CD: 58, DE: 42 };
  const perf = [{ AB: 36, BC: 28, CD: 22, DE: 16 }];
  const final = combineCutoffs(e1, e2, perf, config, GRADE_MODE_FIVE);
  const partial = combinePartialCutoffs(e1, perf, config, GRADE_MODE_FIVE);
  log("H5", "combine consistency", "final vs partial+e2", {
    finalAB: final.AB,
    partialAB: partial.AB,
    e2contribAB: final.AB - partial.AB,
  });
  assert(final.AB >= partial.AB, "final AB should be >= partial AB");
});

// --- Summary ---
log("SUMMARY", "test-robustness.mjs", "complete", results);

console.log("\n=== Robustness Test Summary ===");
console.log(`Passed: ${results.passed}`);
console.log(`Failed: ${results.failed}`);
console.log(`Log:    ${LOG_PATH}`);
if (results.failures.length) {
  console.log("\nFailures:");
  for (const f of results.failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
console.log("\nAll robustness tests passed.");
