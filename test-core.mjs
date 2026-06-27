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
} from "./js/core/passRates.js";
import { parsePasteText, alignStudentsById } from "./js/core/studentData.js";
import {
  computeGradeDistribution,
  computePartialContributionDistribution,
  solveExam2ForTargetRatios,
  partialCutoffsFromComponents,
  partialWeightMax,
} from "./js/core/gradeDistribution.js";
import { predictStudentGrade } from "./js/core/student.js";
import {
  GRADE_MODE_FIVE,
  GRADE_MODE_SIX,
  snapCutoffsMonotonic,
  normalizeFinalCutoffs,
  MIN_PASS_RATE_PERCENT,
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

const target = { ...final, AB: 88 };
const { cutoffs: exam2Solved } = solveExam2Cutoffs(target, exam1, perfAreas, config, GRADE_MODE_FIVE);
for (const k of Object.keys(exam2Solved)) {
  console.assert(exam2Solved[k] % 5 === 0, `exam2 ${k} expected multiple of 5 got ${exam2Solved[k]}`);
}
const after = combineCutoffs(exam1, exam2Solved, perfAreas, config, GRADE_MODE_FIVE);
console.assert(after.AB === 89, `tuned AB expected 89 got ${after.AB}`);

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

console.log("All core tests passed.");
