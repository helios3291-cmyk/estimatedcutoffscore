import {
  BOUNDARY_LABELS,
  getBoundaryKeys,
  passRateGradeColumnsForMode,
  boundaryForPassRateGrade,
} from "../core/grades.js";
import { normalizeComponentConfig, computeContributions } from "../core/cutoffs.js";
import { computeExamCutoffsFromPassMatrix } from "../core/passRates.js";
import { splitStudentId } from "../core/studentData.js";

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

export function buildBasicExcelRows(finalCutoffs, gradeRanges, config, components, mode) {
  const c = normalizeComponentConfig(config);
  const perfAreas = components.perfAreas || (components.perf ? [components.perf] : []);
  const keys = getBoundaryKeys(mode);

  const rows = [
    ["추정 분할점수 — 기본 산출 결과"],
    [],
    ["요소", "반영 비율(%)", "만점(점)"],
    ["정기시험1", c.exam1.weight, c.exam1.max],
    ["정기시험2", c.exam2.weight, c.exam2.max],
  ];

  c.perfAreas.forEach((area, i) => {
    const label = c.perfAreas.length > 1 ? `수행평가 ${i + 1}` : "수행평가";
    rows.push([label, area.weight, area.max]);
  });

  rows.push([]);
  const perfHeaderPairs = c.perfAreas.flatMap((_, i) => {
    const label = c.perfAreas.length > 1 ? `수행${i + 1}` : "수행";
    return [label, `${label}환산`];
  });
  rows.push(["경계", "정기1", "정기1환산", "정기2", "정기2환산", ...perfHeaderPairs, "학기말 점수"]);

  for (const key of keys) {
    if (finalCutoffs[key] === undefined) continue;
    const cont = computeContributions(
      components.exam1,
      components.exam2,
      perfAreas,
      c,
      mode,
      key
    );
    const perfCells = cont.perfByArea.flatMap((contrib, i) => [perfAreas[i][key], contrib]);
    rows.push([
      BOUNDARY_LABELS[key],
      components.exam1[key],
      cont.exam1,
      components.exam2[key],
      cont.exam2,
      ...perfCells,
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
  const gradeCols = passRateGradeColumnsForMode(mode);
  const rows = [
    [`정기시험 추정 분할점수 산출 — ${examLabel}`],
    [],
    ["난이도", "해당문항번호", "문항수", "배점합", ...gradeCols],
  ];

  for (const row of tierRows) {
    rows.push([
      row.tierLabel,
      row.questionNums,
      row.questionCount,
      row.pointsSum,
      ...gradeCols.map((g) => passRateMatrix[g]?.[row.tier] ?? 0),
    ]);
  }

  rows.push([]);
  rows.push([
    "목표 분할점수",
    "",
    "",
    "",
    ...gradeCols.map((g) => {
      const b = boundaryForPassRateGrade(g);
      return b ? cutoffs[b] ?? "" : "";
    }),
  ]);

  const computed = computeExamCutoffsFromPassMatrix(tierRows, passRateMatrix, mode);
  rows.push([
    "역산 분할점수",
    "",
    "",
    "",
    ...gradeCols.map((g) => {
      const b = boundaryForPassRateGrade(g);
      return b && computed[b] != null ? computed[b] : "";
    }),
  ]);

  return rows;
}

const STORAGE_KEY = "estimatedcutoffscore_state";
const PROFILES_KEY = "estimatedcutoffscore_profiles";

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

export function clearAllStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PROFILES_KEY);
  } catch {
    /* ignore */
  }

  try {
    sessionStorage.removeItem("exam_cutoff_mid2_helper");
    sessionStorage.removeItem("exam_cutoff_mid2_semester");
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("exam_cutoff_")) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

function normalizeProfileName(name) {
  return String(name || "").trim();
}

export function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !Array.isArray(parsed.profiles)) return { version: 1, profiles: [] };
    return { version: parsed.version || 1, profiles: parsed.profiles };
  } catch {
    return { version: 1, profiles: [] };
  }
}

export function saveProfiles(doc) {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

export function upsertProfile(name, state) {
  const profileName = normalizeProfileName(name);
  if (!profileName) return { ok: false, error: "프로필 이름이 비어 있습니다." };

  const doc = loadProfiles();
  const now = new Date().toISOString();
  const next = (doc.profiles || []).filter((p) => p?.name && p.name !== profileName);
  next.unshift({ name: profileName, createdAt: now, state });

  const saved = saveProfiles({ version: 1, updatedAt: now, profiles: next });
  return saved ? { ok: true } : { ok: false, error: "로컬 저장소에 저장할 수 없습니다." };
}

export function deleteProfile(name) {
  const profileName = normalizeProfileName(name);
  const doc = loadProfiles();
  const next = (doc.profiles || []).filter((p) => p?.name && p.name !== profileName);
  const now = new Date().toISOString();
  const saved = saveProfiles({ version: 1, updatedAt: now, profiles: next });
  return saved ? { ok: true } : { ok: false, error: "로컬 저장소에서 삭제할 수 없습니다." };
}

export function examCutoffSessionKey(exam, source = null) {
  if (exam === "mid2" && source === "helper") return "exam_cutoff_mid2_helper";
  if (exam === "mid2" && source === "semester") return "exam_cutoff_mid2_semester";
  return `exam_cutoff_${exam}`;
}

export function pushExamCutoffToSession(exam, cutoffs, source = null) {
  sessionStorage.setItem(examCutoffSessionKey(exam, source), JSON.stringify(cutoffs));
}

export function pullExamCutoffFromSession(exam, source = null) {
  try {
    const raw = sessionStorage.getItem(examCutoffSessionKey(exam, source));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function buildCohortExcelRows(rows, config) {
  const perfHeaders = config.perfAreas.map((_, i) =>
    config.perfAreas.length > 1 ? `수행${i + 1}` : "수행"
  );
  const header = ["반", "번호", "정기1", "정기2", ...perfHeaders, "학기말 점수", "예상 성취도"];
  const dataRows = rows.map((row) => {
    const { classLabel, num } = splitStudentId(row.id);
    return [classLabel, num, row.exam1, row.exam2, ...row.perfAreas, row.finalScore, row.grade];
  });
  return [header, ...dataRows];
}
