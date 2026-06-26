import { BOUNDARY_LABELS, gradeColumnsForMode } from "../core/grades.js";

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

export function buildExamCutoffExport(exam, mode, pointsByDifficulty, cutoffs, passRates, questions, passRateMatrix, tierRows) {
  return {
    type: "exam_cutoff",
    version: 2,
    exam,
    mode,
    pointsByDifficulty,
    cutoffs,
    passRates,
    passRateMatrix: passRateMatrix || null,
    tierRows: tierRows || null,
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

export function buildExamHelperExcelRows(examLabel, tierRows, cutoffs, passRateMatrix, mode) {
  const gradeCols = gradeColumnsForMode(mode);
  const rows = [
    [`정기시험 도우미 — ${examLabel}`],
    [],
    ["문항구분", "난이도", "해당문항번호", "문항수", "배점합", ...gradeCols],
  ];

  for (const row of tierRows) {
    rows.push([
      row.type,
      row.tierLabel,
      row.questionNums,
      row.questionCount,
      row.pointsSum,
      ...gradeCols.map((g) => passRateMatrix[g]?.[row.tier] ?? 0),
    ]);
  }

  rows.push([]);
  rows.push(["목표 분할점수", "", "", "", "", ...gradeCols.map((g) => {
    const b = { A: "AB", B: "BC", C: "CD", D: "DE", E: "DE", 미도달: "E_fail" }[g];
    return cutoffs[b] ?? "";
  })]);

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
