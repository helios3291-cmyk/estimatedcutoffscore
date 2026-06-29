import { validStudentTotals } from "./studentData.js";

/** 탭별 준비 상태 — UI 표시용 (학기말 산출 + 학생 데이터) */
export function getAppReadiness(app) {
  const exam1Count = validStudentTotals(app.semesterState?.exam1Students || []).length;
  const hasPerfData = (app.semesterState?.perfStudentsByArea || []).some(
    (list) => validStudentTotals(list).length > 0
  );

  let dataStatus = "pending";
  let dataHint = "학생 성적 붙여넣기·데이터 반영";

  if (exam1Count > 0 && hasPerfData) {
    dataStatus = "ok";
    dataHint = `정기1 ${exam1Count}명 · 수행 데이터 있음`;
  } else if (exam1Count > 0) {
    dataStatus = "partial";
    dataHint = `정기1 ${exam1Count}명 · 수행 데이터 없음`;
  } else if (hasPerfData) {
    dataStatus = "partial";
    dataHint = "수행 데이터만 있음 · 정기1 데이터 필요";
  }

  return [
    {
      id: "final",
      label: "학기말 산출",
      status: app.finalCutoffs ? "ok" : "pending",
      hint: app.finalCutoffs ? "학기말 분할점수 산출 완료" : "「학기말 분할점수 산출」 필요",
    },
    {
      id: "student-data",
      label: "학생 데이터",
      status: dataStatus,
      hint: dataHint,
    },
  ];
}

export function readinessBarHtml(items) {
  return items
    .map((item) => {
      const icon = item.status === "ok" ? "✓" : item.status === "partial" ? "◐" : "○";
      return `<span class="readiness-chip ${item.status}" title="${item.hint}">${icon} ${item.label}</span>`;
    })
    .join("");
}
