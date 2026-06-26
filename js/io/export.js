import { BOUNDARY_LABELS } from "../core/grades.js";

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch {
        reject(new Error("JSON 파일을 읽을 수 없습니다."));
      }
    };
    reader.onerror = () => reject(new Error("파일을 읽을 수 없습니다."));
    reader.readAsText(file);
  });
}

export function buildExamCutoffExport(exam, mode, pointsByDifficulty, cutoffs, passRates, questions) {
  return {
    type: "exam_cutoff",
    version: 1,
    exam,
    mode,
    pointsByDifficulty,
    cutoffs,
    passRates,
    questions: questions || null,
    exportedAt: new Date().toISOString(),
  };
}

export function parseExamCutoffImport(data) {
  if (!data || data.type !== "exam_cutoff") {
    return { error: "올바른 정기시험 분할점수 파일이 아닙니다." };
  }
  if (!data.cutoffs) {
    return { error: "분할점수 데이터가 없습니다." };
  }
  return { data, error: null };
}

export function exportToExcel(wbName, sheets) {
  if (typeof XLSX === "undefined") {
    throw new Error("엑셀 라이브러리를 불러오지 못했습니다.");
  }

  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, wbName);
}

export function buildBasicExcelRows(finalCutoffs, gradeRanges, config, components) {
  const rows = [
    ["추정 분할점수 — 기본 산출 결과"],
    [],
    ["요소", "반영 비율(%)", "만점(점)"],
    ["정기시험1", config.exam1.weight, config.exam1.max],
    ["정기시험2", config.exam2.weight, config.exam2.max],
    ["수행평가", config.perf.weight, config.perf.max],
    [],
    ["경계", "정기시험1", "정기시험2", "수행평가", "최종"],
  ];

  for (const key of Object.keys(BOUNDARY_LABELS)) {
    if (finalCutoffs[key] === undefined) continue;
    rows.push([
      BOUNDARY_LABELS[key],
      components.exam1[key],
      components.exam2[key],
      components.perf[key],
      finalCutoffs[key],
    ]);
  }

  rows.push([]);
  rows.push(["성취도", "구간"]);
  for (const r of gradeRanges) {
    rows.push([r.grade, r.label]);
  }

  return rows;
}

export function buildExamHelperExcelRows(examLabel, points, cutoffs, passRates) {
  const rows = [
    [`정기시험 도우미 — ${examLabel}`],
    [],
    ["난이도", "배점합"],
    ["하", points.하],
    ["중", points.중],
    ["상", points.상],
    [],
    ["경계", "목표 점수", "하 통과율", "중 통과율", "상 통과율", "예상 점수"],
  ];

  for (const [key, rates] of Object.entries(passRates)) {
    const label = BOUNDARY_LABELS[key] || key;
    const expected = (points.하 * rates.하 + points.중 * rates.중 + points.상 * rates.상).toFixed(1);
    rows.push([
      label,
      cutoffs[key],
      `${(rates.하 * 100).toFixed(1)}%`,
      `${(rates.중 * 100).toFixed(1)}%`,
      `${(rates.상 * 100).toFixed(1)}%`,
      expected,
    ]);
  }

  return rows;
}

const STORAGE_KEY = "estimatedcutoffscore_state";

export function saveAppState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota errors */
  }
}

export function loadAppState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function pushExamCutoffToSession(exam, cutoffs) {
  sessionStorage.setItem(`exam_cutoff_${exam}`, JSON.stringify(cutoffs));
}

export function pullExamCutoffFromSession(exam) {
  try {
    const raw = sessionStorage.getItem(`exam_cutoff_${exam}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
