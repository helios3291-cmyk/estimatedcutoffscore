import { validStudentTotals } from "./studentData.js";
import { getConfigForApp } from "../features/basic.js";

/** 작업 준비 상태 — UI 표시용 */
export function getAppReadiness(app) {
  const exam1Count = validStudentTotals(app.semesterState?.exam1Students || []).length;
  const exam2Count = validStudentTotals(app.semesterState?.exam2ActualStudents || []).length;

  const config = getConfigForApp(app);
  const perfLists = app.semesterState?.perfStudentsByArea || [];
  const perfAreasNeeded = config.perfCount || 1;
  const perfOk =
    perfLists.length >= perfAreasNeeded &&
    perfLists.slice(0, perfAreasNeeded).every((list) => validStudentTotals(list).length > 0);

  const perfValid = perfLists.reduce(
    (max, list) => Math.max(max, validStudentTotals(list).length),
    0
  );

  return [
    {
      id: "final",
      label: "학기말 분할점수 산출",
      status: app.finalCutoffs ? "ok" : "pending",
      hint: app.finalCutoffs
        ? "학기말 분할점수 산출 완료"
        : "1. 기본 탭에서 「학기말 분할점수 산출」 필요",
    },
    {
      id: "exam1-data",
      label: "정기시험1 학생 데이터 입력",
      status: exam1Count > 0 ? "ok" : "pending",
      hint:
        exam1Count > 0
          ? `유효 ${exam1Count}명`
          : "3. 학생 성적 기반 정기시험2 준비 탭에서 정기시험1 데이터 반영",
    },
    {
      id: "exam2-data",
      label: "정기시험2 학생 데이터 입력",
      status: exam2Count > 0 ? "ok" : "pending",
      hint:
        exam2Count > 0
          ? `유효 ${exam2Count}명`
          : "4. 학기말 성적 분석 탭에서 정기2 데이터 반영",
    },
    {
      id: "perf-data",
      label: "수행평가 학생 데이터 입력",
      status: perfOk ? "ok" : perfLists.some((l) => validStudentTotals(l).length > 0) ? "partial" : "pending",
      hint: perfOk
        ? `유효 ${perfValid}명 (영역 ${perfAreasNeeded}개)`
        : "3번 탭에서 수행평가 데이터 반영",
    },
  ];
}

export function readinessBarHtml(items) {
  const chips = items
    .map((item) => {
      const icon = item.status === "ok" ? "✓" : item.status === "partial" ? "◐" : "○";
      return `<span class="readiness-chip ${item.status}" title="${item.hint}">${icon} ${item.label}</span>`;
    })
    .join("");

  return `
    <div class="readiness-panel">
      <p class="readiness-title">작업 준비 상황</p>
      <div class="readiness-chips">${chips}</div>
    </div>`;
}
