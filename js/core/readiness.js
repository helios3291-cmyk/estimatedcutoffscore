import { normalizeComponentConfig } from "./cutoffs.js";
import { validStudentTotals } from "./studentData.js";

function hasCutoffs(obj) {
  return obj && obj.AB != null && Number.isFinite(obj.AB);
}

/** 탭별 준비 상태 — UI 표시용 */
export function getAppReadiness(app) {
  const config = normalizeComponentConfig(
    app.componentConfig || app.basicState?.componentConfig
  );
  const e1 = app.components?.exam1 || app.basicState?.exam1;
  const pf = app.components?.perfAreas || app.basicState?.perfAreas || [];
  const pfOk =
    Array.isArray(pf) &&
    pf.length === config.perfCount &&
    pf.every((p) => hasCutoffs(p));

  const exam1Data = validStudentTotals(app.semesterState?.exam1Students || []).length;
  const hasPerfData = (app.semesterState?.perfStudentsByArea || []).some(
    (list) => validStudentTotals(list).length > 0
  );

  const items = [
    {
      id: "basic",
      label: "기본 산출",
      ok: hasCutoffs(e1) && pfOk,
      hint: hasCutoffs(e1) && pfOk ? "분할점수 입력됨" : "정기1·수행 분할점수 입력",
    },
    {
      id: "basic-final",
      label: "최종 산출",
      ok: !!app.finalCutoffs,
      hint: app.finalCutoffs ? "최종 분할점수 산출 완료" : "「최종 분할점수 산출」 필요",
    },
    {
      id: "semester",
      label: "성적 분석",
      ok: hasCutoffs(e1) && pfOk && exam1Data > 0,
      hint:
        exam1Data > 0
          ? `정기1 데이터 ${exam1Data}명`
          : "학생 성적 붙여넣기·분석",
    },
    {
      id: "student",
      label: "학생 예측",
      ok: !!app.finalCutoffs,
      hint: app.finalCutoffs ? "예측 가능" : "기본 산출에서 최종 산출 후",
    },
  ];

  if (hasCutoffs(e1) && pfOk && hasPerfData && exam1Data > 0) {
    const sem = items.find((i) => i.id === "semester");
    if (sem) sem.hint = `정기1 ${exam1Data}명 · 수행 데이터 있음`;
  }

  return items;
}

export function readinessBarHtml(items) {
  return items
    .map(
      (item) =>
        `<span class="readiness-chip ${item.ok ? "ok" : "pending"}" title="${item.hint}">${item.ok ? "✓" : "○"} ${item.label}</span>`
    )
    .join("");
}
