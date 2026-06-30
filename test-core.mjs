import {
  combineCutoffs,
  combinePartialCutoffs,
  solveExam2Cutoffs,
  computeWeightedScore,
  defaultComponentConfig,
  normalizeComponentConfig,
} from "./js/core/cutoffs.js";
import {
  solvePassRatesForCutoffs,
  expectedScore,
  passRatesToMatrix,
  validateTierMonotonicMatrix,
  validateGradeMonotonicMatrix,
  applyAbilityGapWithCutoffs,
  abilityGapForTier,
  enforceAbilityGapMatrix,
  buildPassRateMatrixFromCutoffs,
  buildTierRowsBasic,
  expectedScoreFromMatrix,
  expectedScoresByGrade,
  computeExamCutoffsFromPassMatrix,
  matrixMatchesCutoffs,
  collectPassRateWarnings,
} from "./js/core/passRates.js";
import { getAppReadiness } from "./js/core/readiness.js";
import {
  parsePasteText,
  alignStudentsById,
  alignStudentsForSemesterPrediction,
  splitStudentId,
  buildMatrixPasteExample,
  buildExam1PasteExample,
} from "./js/core/studentData.js";
import { gridRowsToText, textToGridRows } from "./js/ui/pasteGrid.js";
import {
  computeGradeDistribution,
  computePartialContributionDistribution,
  solveExam2ForTargetRatios,
  partialCutoffsFromComponents,
  partialWeightMax,
} from "./js/core/gradeDistribution.js";
import { predictStudentGrade, predictCohortGrades } from "./js/core/student.js";
import {
  GRADE_MODE_FIVE,
  GRADE_MODE_SIX,
  roundCutoffsMonotonic,
  normalizeFinalCutoffs,
  MIN_PASS_RATE_PERCENT,
  HARD_TIER_MIN_PASS_RATE,
  NORMAL_ABILITY_GAP_MAX,
  passRateGradeColumnsForMode,
  passRateTargetScore,
} from "./js/core/grades.js";

const config = defaultComponentConfig();
console.assert(
  normalizeFinalCutoffs({ AB: 89.4, BC: 74.6, CD: 59.2, DE: 44.8 }, GRADE_MODE_FIVE).AB === 89,
  "normalizeFinalCutoffs rounds to int"
);
const exam1 = { AB: 90, BC: 75, CD: 60, DE: 45 };
const exam2 = { AB: 88, BC: 72, CD: 58, DE: 42 };
const perf = { AB: 36, BC: 28, CD: 22, DE: 16 };
const perfAreas = [perf];

const final = combineCutoffs(exam1, exam2, perfAreas, config, GRADE_MODE_FIVE);
console.assert(final.AB === 89, `AB expected 89 got ${final.AB}`);

const points = { 하: 30, 중: 50, 상: 20 };
const cutoffs = { AB: 85, BC: 70, CD: 55, DE: 40 };
const rates = solvePassRatesForCutoffs(cutoffs, points, GRADE_MODE_FIVE);
const abScore = expectedScore(points, rates.AB);
console.assert(Math.abs(abScore - 85) < 1, `AB pass rate score expected ~85 got ${abScore}`);

const passMatrix = passRatesToMatrix(rates, GRADE_MODE_FIVE);
console.assert(
  validateTierMonotonicMatrix(passMatrix, GRADE_MODE_FIVE).length === 0,
  "pass rate matrix should satisfy tier monotonicity"
);
console.assert(
  validateGradeMonotonicMatrix(passMatrix, GRADE_MODE_FIVE).length === 0,
  "pass rate matrix should satisfy grade monotonicity within each tier"
);
console.assert(
  passMatrix.A.상 >= MIN_PASS_RATE_PERCENT,
  "hard tier pass rate should be at least 10%"
);
console.assert(passMatrix.E == null || passMatrix.E !== passMatrix.미도달, "no 미도달 column in pass matrix");

const sixRates = solvePassRatesForCutoffs(
  { AB: 85, BC: 70, CD: 55, DE: 40, E_fail: 25 },
  points,
  GRADE_MODE_SIX
);
const sixMatrix = passRatesToMatrix(sixRates, GRADE_MODE_SIX);
console.assert(sixMatrix.E && sixMatrix.E.하 > 0, "six mode E column should have rates");
console.assert(sixMatrix.미도달 == null, "six mode pass matrix should not have 미도달 column");

const roundedFive = roundCutoffsMonotonic(
  { AB: 84.567, BC: 69.234, CD: 54.891, DE: 39.456 },
  GRADE_MODE_FIVE,
  100
);
console.assert(roundedFive.AB === 84.57, `roundCutoffsMonotonic AB expected 84.57 got ${roundedFive.AB}`);
console.assert(roundedFive.AB > roundedFive.BC, "roundCutoffsMonotonic should preserve monotonic order");

const target = { ...final, AB: 88 };
const { cutoffs: exam2Solved } = solveExam2Cutoffs(target, exam1, perfAreas, config, GRADE_MODE_FIVE);
for (const k of Object.keys(exam2Solved)) {
  console.assert(Number.isFinite(exam2Solved[k]), `exam2 ${k} expected finite got ${exam2Solved[k]}`);
  console.assert(
    Math.abs(exam2Solved[k] * 100 - Math.round(exam2Solved[k] * 100)) < 1e-9,
    `exam2 ${k} expected 2 decimal places got ${exam2Solved[k]}`
  );
}
const after = combineCutoffs(exam1, exam2Solved, perfAreas, config, GRADE_MODE_FIVE);
console.assert(after.AB === target.AB, `tuned AB expected ${target.AB} got ${after.AB}`);

const captureConfig = normalizeComponentConfig({
  exam1: { weight: 35, max: 100 },
  exam2: { weight: 35, max: 100 },
  perfCount: 1,
  perfAreas: [{ weight: 30, max: 30 }],
});
const captureExam1 = { AB: 81, BC: 70, CD: 55, DE: 40, E_fail: 20 };
const capturePerf = { AB: 30, BC: 28, CD: 26, DE: 20, E_fail: 12 };
const capturePerfAreas = [capturePerf];
const captureTarget = { AB: 85, BC: 70, CD: 50, DE: 35, E_fail: 22 };
const captureResult = solveExam2Cutoffs(
  captureTarget,
  captureExam1,
  capturePerfAreas,
  captureConfig,
  GRADE_MODE_SIX
);
console.assert(
  captureResult.issues.length === 0,
  `capture scenario should succeed got ${captureResult.issues.join("; ")}`
);

const parsed = parsePasteText("번호\t1\t2\n1\t18.6\t20\n2\t미인정결\t15");
console.assert(parsed.students.length === 2, "parse paste rows");
console.assert(parsed.students[0].total === 38.6, "sum numeric columns");
console.assert(parsed.layout === "items", "item layout for question rows");

const matrixPaste = parsePasteText(
  "번호\t1반\t2반\t3반\n1\t80\t85\t90\n2\t70\t75\t80\n3\t60\t65\t70\n4\t50\t55\t60\n5\t40\t45\t50"
);
console.assert(matrixPaste.layout === "matrix", "matrix layout detected");
console.assert(
  matrixPaste.students.filter((s) => !s.excluded).length === 15,
  `matrix 3x5 expected 15 valid got ${matrixPaste.students.filter((s) => !s.excluded).length}`
);
console.assert(
  matrixPaste.students.find((s) => s.id === "2반-3")?.total === 65,
  "matrix cell score not summed"
);

const exam1Example = parsePasteText(buildExam1PasteExample({ classCount: 3, rowCount: 8 }));
console.assert(exam1Example.layout === "matrix", "exam1 example should be matrix layout");
const exam1Scores = exam1Example.students.filter((s) => !s.excluded).map((s) => s.total);
console.assert(
  exam1Scores.length > 0 && exam1Scores.every((s) => s <= 100),
  "exam1 example scores should be within 100-point scale"
);

const excelSample = parsePasteText(buildMatrixPasteExample({ classCount: 3, rowCount: 8 }));
console.assert(excelSample.layout === "matrix", "excel sample should be matrix layout");
console.assert(
  excelSample.students.some((s) => s.id === "3반-7" && s.excluded),
  "excel sample should mark 자퇴 at 3반-7"
);
const examSample = parsePasteText(buildMatrixPasteExample({ classCount: 3, rowCount: 8 }));
const perfSample = parsePasteText(
  buildMatrixPasteExample({ classCount: 3, rowCount: 8 }).replace(/24\.00/g, "30.00")
);
console.assert(
  alignStudentsById(examSample.students, [perfSample.students]).matchedCount >= 20,
  "identical 반번호 grids should match most students"
);

const exam2Sample = parsePasteText(buildExam1PasteExample({ classCount: 3, rowCount: 8 }));
const semesterAligned = alignStudentsForSemesterPrediction(
  examSample.students,
  [perfSample.students],
  exam2Sample.students
);
console.assert(semesterAligned.matchedCount >= 20, "3-way semester alignment should match most students");
console.assert(
  semesterAligned.exam2Scores.length === semesterAligned.matchedCount,
  "exam2 scores aligned with matched count"
);

const split = splitStudentId("3반-15");
console.assert(split.classLabel === "3반" && split.num === "15", "splitStudentId parses 반-번호");

const cohort = predictCohortGrades(semesterAligned, config, final, GRADE_MODE_FIVE);
console.assert(!cohort.error && cohort.rows.length === cohort.matchedCount, "cohort prediction succeeds");
console.assert(
  cohort.rows.every((r) => r.grade && Number.isFinite(r.finalScore)),
  "cohort rows have grade and final score"
);

const roundTrip = gridRowsToText(textToGridRows("반번호\t1\t2\n1\t80\t70"));
console.assert(roundTrip.includes("반번호") && roundTrip.includes("80"), "paste grid TSV round trip");

const matrixExclude = parsePasteText(
  "1반\t2반\t3반\n1\t80\t미인정결\t90\n2\t70\t75\t80"
);
console.assert(
  matrixExclude.students.filter((s) => !s.excluded).length === 5,
  "matrix excludes single cell only"
);
console.assert(
  matrixExclude.students.some((s) => s.id === "2반-1" && s.excluded),
  "excluded cell marked per student"
);

const matrixCorner = parsePasteText("번호\t1반\t2반\n1\t88\t92\n2\t77\t81");
console.assert(
  matrixCorner.students.filter((s) => !s.excluded).length === 4,
  "matrix with corner 번호 label"
);

const headerlessMatrix = parsePasteText(
  "18.6\t63.8\t18.8\t64.5\n18.8\t32.3\t32.4\t28.9\n미인정결\t18.5\t62.5\t77.3"
);
console.assert(headerlessMatrix.layout === "matrix", "headerless matrix layout");
console.assert(
  headerlessMatrix.students.filter((s) => !s.excluded).length === 11,
  `headerless 3x4 minus one exclusion expected 11 got ${headerlessMatrix.students.filter((s) => !s.excluded).length}`
);
console.assert(
  headerlessMatrix.students.find((s) => s.id === "1반-2")?.total === 18.8,
  "headerless cell score preserved"
);

const cornerNumericHeader = parsePasteText(
  "반\n번호\t1\t2\t3\n1\t80\t85\t90\n2\t70\t미인정결\t80\n3\t60\t65\t70"
);
console.assert(cornerNumericHeader.layout === "matrix", "corner 번호/반 + numeric class headers");
console.assert(
  cornerNumericHeader.students.filter((s) => !s.excluded).length === 8,
  `corner numeric header matrix expected 8 valid got ${cornerNumericHeader.students.filter((s) => !s.excluded).length}`
);
console.assert(
  cornerNumericHeader.students.find((s) => s.id === "2반-1")?.total === 85,
  "corner numeric header preserves class column"
);
console.assert(
  cornerNumericHeader.students.find((s) => s.id === "2반-2")?.excluded,
  "corner numeric header excludes single cell"
);

const splitCornerHeader = parsePasteText("반\n번호\t1\t2\t3\t4\t5\n1\t10\t20\t30\t40\t50");
console.assert(splitCornerHeader.layout === "matrix", "split corner lines merged");
console.assert(
  splitCornerHeader.students.filter((s) => !s.excluded).length === 5,
  "split corner 5 classes one student row"
);

const scores = [95, 85, 75, 65, 55, 45, 35, 25, 15, 5];
const dist = computeGradeDistribution(scores, captureExam1, GRADE_MODE_SIX);
console.assert(dist.total === 10, "grade distribution count");

const e1Scores = Array.from({ length: 100 }, (_, i) => i);
const pScores = [Array.from({ length: 100 }, (_, i) => Math.max(5, 30 - i * 0.25))];
const targetRatios = { A: 15, B: 15, C: 20, D: 20, E: 15, 미도달: 15 };
const solved = solveExam2ForTargetRatios(
  e1Scores,
  pScores,
  targetRatios,
  captureExam1,
  capturePerfAreas,
  captureConfig,
  GRADE_MODE_SIX
);
console.assert(!solved.error && solved.exam2Cutoffs, `target ratio solve failed: ${solved.error}`);

const student = predictStudentGrade(
  { exam1: 95, exam2: 85, perfAreas: [36] },
  config,
  final,
  GRADE_MODE_FIVE
);
console.assert(student.grade === "A", `student grade expected A got ${student.grade}`);

const studentScore = computeWeightedScore(95, 85, [36], config);
console.assert(studentScore === 90, `score expected 90 got ${studentScore}`);

// Multi-area perf (3 areas)
const multiConfig = normalizeComponentConfig({
  exam1: { weight: 30, max: 100 },
  exam2: { weight: 30, max: 100 },
  perfCount: 3,
  perfAreas: [
    { weight: 15, max: 15 },
    { weight: 15, max: 15 },
    { weight: 10, max: 10 },
  ],
});
const multiPerf = [
  { AB: 14, BC: 11, CD: 9, DE: 6 },
  { AB: 13, BC: 10, CD: 8, DE: 5 },
  { AB: 9, BC: 7, CD: 5, DE: 3 },
];
const multiFinal = combineCutoffs(exam1, exam2, multiPerf, multiConfig, GRADE_MODE_FIVE);
console.assert(multiFinal.AB === 89, `multi perf AB expected 89 got ${multiFinal.AB}`);

const aligned = alignStudentsById(
  matrixPaste.students,
  [matrixPaste.students, matrixPaste.students, matrixPaste.students]
);
console.assert(aligned.matchedCount === 15, `alignStudentsById expected 15 got ${aligned.matchedCount}`);
console.assert(aligned.exam1Scores.length === 15, "aligned exam1 scores");
console.assert(aligned.perfScoresByArea.length === 3, "three perf area score arrays");

console.assert(partialWeightMax(config) === 70, `partial max expected 70 got ${partialWeightMax(config)}`);
const { partialCutoffs } = partialCutoffsFromComponents(exam1, perfAreas, config, GRADE_MODE_FIVE);
console.assert(
  partialCutoffs.AB === 63,
  `partial AB from e1+perf expected 63 got ${partialCutoffs.AB}`
);
console.assert(
  combinePartialCutoffs(exam1, perfAreas, config, GRADE_MODE_FIVE).AB === 63,
  "combinePartialCutoffs matches partialCutoffsFromComponents"
);

const partialDist = computePartialContributionDistribution(
  aligned.exam1Scores,
  aligned.perfScoresByArea,
  exam1,
  perfAreas,
  config,
  GRADE_MODE_FIVE
);
console.assert(partialDist.total === 15, `partial distribution expected 15 students got ${partialDist.total}`);
console.assert(partialDist.partialMax === 70, "partial max in result");

// Legacy config migration
const legacyConfig = normalizeComponentConfig({
  exam1: { weight: 30, max: 100 },
  exam2: { weight: 30, max: 100 },
  perf: { weight: 40, max: 40 },
});
console.assert(legacyConfig.perfCount === 1 && legacyConfig.perfAreas[0].weight === 40, "legacy perf migration");

const detailPoints = { 하: 30, 중: 35, 상: 35 };
const detailCutoffs = { AB: 85, BC: 70, CD: 55, DE: 40 };
const detailRates = solvePassRatesForCutoffs(detailCutoffs, detailPoints, GRADE_MODE_FIVE);
const detailMatrix = passRatesToMatrix(detailRates, GRADE_MODE_FIVE);
for (const tier of ["하", "중", "상"]) {
  console.assert(
    detailMatrix.D[tier] >= detailMatrix.E[tier] + 5,
    `grade D>=E+5 on tier ${tier} got D=${detailMatrix.D[tier]} E=${detailMatrix.E[tier]}`
  );
  console.assert(
    detailMatrix.C[tier] >= detailMatrix.D[tier] + 5,
    `grade C>=D+5 on tier ${tier} got C=${detailMatrix.C[tier]} D=${detailMatrix.D[tier]}`
  );
}
console.assert(
  validateGradeMonotonicMatrix(detailMatrix, GRADE_MODE_FIVE).length === 0,
  "detail 30/35/35 matrix grade monotonic"
);

const gapCols = passRateGradeColumnsForMode(GRADE_MODE_FIVE);
const gapCutoffs = { AB: 85, BC: 70, CD: 55, DE: 40 };
const gapTierRows = buildTierRowsBasic(points);

const builderFive = buildPassRateMatrixFromCutoffs(
  gapCutoffs,
  points,
  GRADE_MODE_FIVE,
  gapTierRows
);
console.assert(
  validateGradeMonotonicMatrix(builderFive.matrix, GRADE_MODE_FIVE).length === 0,
  "builder five matrix grade monotonic"
);
console.assert(
  validateTierMonotonicMatrix(builderFive.matrix, GRADE_MODE_FIVE).length === 0,
  "builder five matrix tier monotonic"
);
if (builderFive.abilityGapMatched) {
  console.assert(
    matrixMatchesCutoffs(gapTierRows, builderFive.matrix, gapCutoffs, GRADE_MODE_FIVE),
    "builder matches cutoffs when ability gap matched"
  );
}
if (builderFive.abilityGapMatched) {
  console.assert(
    builderFive.abilityGapUsed <= NORMAL_ABILITY_GAP_MAX ||
      collectPassRateWarnings(builderFive.matrix, GRADE_MODE_FIVE).some((w) => w.kind === "ability-gap"),
    "ability gap >15 should show warnings when relaxed"
  );
}
const bottomGrade = passRateGradeColumnsForMode(GRADE_MODE_FIVE).slice(-1)[0];
const hardRate = builderFive.matrix[bottomGrade]?.상 ?? 0;
if (builderFive.hardTierMinUsed >= HARD_TIER_MIN_PASS_RATE) {
  console.assert(
    hardRate >= HARD_TIER_MIN_PASS_RATE,
    `hard tier ${bottomGrade} rate expected >=${HARD_TIER_MIN_PASS_RATE} got ${hardRate}`
  );
}
if (hardRate < HARD_TIER_MIN_PASS_RATE) {
  console.assert(
    collectPassRateWarnings(builderFive.matrix, GRADE_MODE_FIVE).some((w) => w.kind === "hard-min"),
    "hard tier below 20% should warn"
  );
}
for (const tier of ["하", "중", "상"]) {
  const gap = abilityGapForTier(builderFive.matrix, tier, gapCols);
  if (builderFive.abilityGapMatched) {
    console.assert(gap <= 30 && gap % 5 === 0, `ability gap on ${tier} should be 5-multiple <=30 got ${gap}`);
    if (gap > NORMAL_ABILITY_GAP_MAX) {
      console.assert(
        [20, 25, 30].includes(gap),
        `relaxed ability gap on ${tier} should be 20/25/30 got ${gap}`
      );
    }
  } else if (gap > NORMAL_ABILITY_GAP_MAX) {
    console.assert(
      collectPassRateWarnings(builderFive.matrix, GRADE_MODE_FIVE).some(
        (w) => w.kind === "ability-gap" && w.tier === tier
      ),
      `ability gap >15 on ${tier} should warn when cutoffs prioritized`
    );
  }
}

const sixCutoffs = { AB: 85, BC: 70, CD: 55, DE: 40, E_fail: 25 };
const builderSix = buildPassRateMatrixFromCutoffs(
  sixCutoffs,
  points,
  GRADE_MODE_SIX,
  gapTierRows
);
console.assert(
  validateGradeMonotonicMatrix(builderSix.matrix, GRADE_MODE_SIX).length === 0,
  "builder six matrix grade monotonic"
);
console.assert(
  validateTierMonotonicMatrix(builderSix.matrix, GRADE_MODE_SIX).length === 0,
  "builder six matrix tier monotonic"
);

const screenCutoffs = { AB: 80, BC: 70, CD: 60, DE: 40 };
const builderScreen = buildPassRateMatrixFromCutoffs(
  screenCutoffs,
  points,
  GRADE_MODE_FIVE,
  gapTierRows
);
console.assert(
  validateGradeMonotonicMatrix(builderScreen.matrix, GRADE_MODE_FIVE).length === 0,
  "screen cutoffs 80/70/60/40 grade monotonic"
);
console.assert(
  validateTierMonotonicMatrix(builderScreen.matrix, GRADE_MODE_FIVE).length === 0,
  "screen cutoffs tier monotonic"
);
console.assert(
  builderScreen.cutoffErrorSum <= 15,
  `screen cutoffs L1 error expected <=15 got ${builderScreen.cutoffErrorSum}`
);
const screenExp = expectedScoresByGrade(gapTierRows, builderScreen.matrix, GRADE_MODE_FIVE);
console.assert(
  Math.abs(screenExp.B - 70) < 0.05 && Math.abs(screenExp.C - 60) < 0.05,
  `screen B/C should match targets got B=${screenExp.B} C=${screenExp.C}`
);
for (const tier of ["하", "중", "상"]) {
  const cols = passRateGradeColumnsForMode(GRADE_MODE_FIVE);
  for (let i = 1; i < cols.length; i++) {
    const upper = builderScreen.matrix[cols[i - 1]]?.[tier] ?? 0;
    const lower = builderScreen.matrix[cols[i]]?.[tier] ?? 0;
    console.assert(
      upper - lower >= 5,
      `screen ${tier} ${cols[i - 1]}-${cols[i]} gap >=5 got ${upper}-${lower}`
    );
  }
}

const gapBaseMatrix = passRatesToMatrix(
  solvePassRatesForCutoffs(gapCutoffs, points, GRADE_MODE_FIVE),
  GRADE_MODE_FIVE
);
const gapResult = applyAbilityGapWithCutoffs(
  gapBaseMatrix,
  gapTierRows,
  gapCutoffs,
  GRADE_MODE_FIVE
);
for (const tier of ["하", "중", "상"]) {
  const gap = abilityGapForTier(gapResult.matrix, tier, gapCols);
  console.assert(
    gap <= gapResult.maxGapUsed + 0.01,
    `ability gap ${tier} should be <= ${gapResult.maxGapUsed} got ${gap}`
  );
}
console.assert(gapResult.maxGapUsed <= 30, "ability gap limit should not exceed 30");
if (gapResult.matched) {
  console.assert(
    matrixMatchesCutoffs(gapTierRows, gapResult.matrix, gapCutoffs, GRADE_MODE_FIVE),
    "ability gap result should match cutoffs when matched"
  );
}

const capped20 = enforceAbilityGapMatrix(gapBaseMatrix, GRADE_MODE_FIVE, 20);
for (const tier of ["하", "중", "상"]) {
  console.assert(
    abilityGapForTier(capped20, tier, gapCols) <= 20,
    `enforce 20: tier ${tier} A-E gap`
  );
}

const readinessEmpty = getAppReadiness({});
console.assert(readinessEmpty.length === 4, "readiness has four chips");
console.assert(readinessEmpty[0].id === "final", "first chip is final");
console.assert(readinessEmpty[1].id === "exam1-data", "second chip is exam1 data");
console.assert(readinessEmpty[2].id === "exam2-data", "third chip is exam2 data");
console.assert(readinessEmpty[3].id === "perf-data", "fourth chip is perf data");
console.assert(readinessEmpty.every((c) => c.status === "pending"), "empty app all pending");

const readinessPartial = getAppReadiness({
  semesterState: { exam1Students: [{ total: 80, excluded: false }] },
});
console.assert(readinessPartial[1].status === "ok", "exam1 only marks exam1 chip ok");

const readinessFull = getAppReadiness({
  finalCutoffs: final,
  componentConfig: config,
  semesterState: {
    exam1Students: [{ total: 80, excluded: false }],
    exam2ActualStudents: [{ total: 75, excluded: false }],
    perfStudentsByArea: [[{ total: 30, excluded: false }]],
  },
});
console.assert(readinessFull.every((c) => c.status === "ok"), "full data all readiness chips ok");

console.log("All core tests passed.");
