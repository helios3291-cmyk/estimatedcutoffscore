import {
  combineCutoffs,
  solveExam2Cutoffs,
  computeWeightedScore,
  defaultComponentConfig,
} from "./js/core/cutoffs.js";
import { solvePassRatesForCutoffs, expectedScore } from "./js/core/passRates.js";
import { predictStudentGrade } from "./js/core/student.js";
import { GRADE_MODE_FIVE } from "./js/core/grades.js";

const config = defaultComponentConfig();
const exam1 = { AB: 90, BC: 75, CD: 60, DE: 45 };
const exam2 = { AB: 88, BC: 72, CD: 58, DE: 42 };
const perf = { AB: 36, BC: 28, CD: 22, DE: 16 };

const final = combineCutoffs(exam1, exam2, perf, config, GRADE_MODE_FIVE);
console.assert(final.AB === 89, `AB expected 89 got ${final.AB}`);

const points = { 하: 30, 중: 50, 상: 20 };
const cutoffs = { AB: 85, BC: 70, CD: 55, DE: 40 };
const rates = solvePassRatesForCutoffs(cutoffs, points, GRADE_MODE_FIVE);
const abScore = expectedScore(points, rates.AB);
console.assert(Math.abs(abScore - 85) < 1, `AB pass rate score expected ~85 got ${abScore}`);

const target = { ...final, AB: 88 };
const { cutoffs: exam2Solved } = solveExam2Cutoffs(target, exam1, perf, config, GRADE_MODE_FIVE);
for (const k of Object.keys(exam2Solved)) {
  console.assert(exam2Solved[k] % 5 === 0, `exam2 ${k} expected multiple of 5 got ${exam2Solved[k]}`);
}
const after = combineCutoffs(exam1, exam2Solved, perf, config, GRADE_MODE_FIVE);
console.assert(after.AB === 89, `tuned AB expected 89 got ${after.AB}`);

const student = predictStudentGrade(
  { exam1: 95, exam2: 85, perf: 36 },
  config,
  final,
  GRADE_MODE_FIVE
);
console.assert(student.grade === "A", `student grade expected A got ${student.grade}`);

const studentScore = computeWeightedScore(95, 85, 36, config);
console.assert(studentScore === 90, `score expected 90 got ${studentScore}`);

console.log("All core tests passed.");
