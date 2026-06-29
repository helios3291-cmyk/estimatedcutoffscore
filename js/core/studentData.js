const EXCLUDED_TOKENS = ["미인정결", "질병결", "자퇴", "결석", "미응시", ""];

function parseCellValue(raw) {
  if (raw == null) return { kind: "empty" };
  const text = String(raw).trim();
  if (!text) return { kind: "empty" };
  if (EXCLUDED_TOKENS.some((t) => t && text.includes(t))) {
    return { kind: "excluded", note: text };
  }
  const n = parseFloat(text.replace(/,/g, ""));
  if (Number.isFinite(n)) return { kind: "score", value: n };
  return { kind: "excluded", note: text };
}

function isHeaderRow(cells) {
  const joined = cells.map((c) => String(c ?? "")).join(" ");
  return /반|번호|문항|name|num/i.test(joined);
}

function isCornerLabel(cell) {
  const text = String(cell ?? "").trim();
  if (!text) return true;
  const compact = text.replace(/\s+/g, "");
  if (/반/.test(compact) && /번호/.test(compact)) return true;
  if (/^반$/i.test(compact)) return true;
  return false;
}

function isNumericClassHeader(cell) {
  const text = String(cell ?? "").trim();
  return /^\d+$/.test(text);
}

function isClassColumnHeader(cell) {
  const text = String(cell ?? "").trim();
  if (!text) return false;
  if (isCornerLabel(cell)) return false;
  if (/문항|item|question/i.test(text)) return false;
  if (/^번호$|^num$|^no$/i.test(text)) return false;
  if (/반/.test(text)) return true;
  if (/^\d+\s*[-–]\s*\d+$/.test(text)) return true;
  return false;
}

function isStudentNumberCell(cell) {
  const text = String(cell ?? "").trim();
  return /^\d+$/.test(text);
}

function rowScoreLikeCells(row) {
  let scores = 0;
  let excluded = 0;
  let empty = 0;
  for (const cell of row) {
    const parsed = parseCellValue(cell);
    if (parsed.kind === "score") scores++;
    else if (parsed.kind === "excluded") excluded++;
    else empty++;
  }
  return { scores, excluded, empty };
}

function rowNumericSum(row) {
  let sum = 0;
  for (const cell of row) {
    const parsed = parseCellValue(cell);
    if (parsed.kind === "score") sum += parsed.value;
  }
  return sum;
}

function looksLikeHeaderlessScoreMatrix(rows) {
  const dataRows = rows.filter((row) => row?.some((c) => String(c ?? "").trim() !== ""));
  if (dataRows.length < 2) return false;

  const headerRow = dataRows[0];
  if (isCornerLabel(headerRow[0]) && headerRow.slice(1).filter(isNumericClassHeader).length >= 2) {
    return false;
  }

  const firstJoined = headerRow.map((c) => String(c ?? "")).join(" ");
  if (/문항|item|question/i.test(firstJoined)) return false;
  if (headerRow.some((c) => isClassColumnHeader(c))) return false;

  let wideRows = 0;
  let highSumRows = 0;
  let checked = 0;

  for (const row of dataRows.slice(0, Math.min(12, dataRows.length))) {
    const { scores, excluded } = rowScoreLikeCells(row);
    const active = scores + excluded;
    if (active < 2) continue;
    checked++;
    if (active >= 4) wideRows++;
    if (scores >= 2 && rowNumericSum(row) > 120) highSumRows++;
  }

  if (checked < 2) return false;
  return wideRows >= 2 && highSumRows >= Math.max(2, Math.ceil(checked * 0.5));
}

function inferMatrixColumnCount(rows) {
  return Math.max(
    0,
    ...rows.map((row) => {
      if (!row?.length) return 0;
      for (let i = row.length - 1; i >= 0; i--) {
        if (String(row[i] ?? "").trim() !== "") return i + 1;
      }
      return 0;
    })
  );
}

function buildImplicitClassLabels(count) {
  return Array.from({ length: count }, (_, i) => `${i + 1}반`);
}

function normalizeClassLabel(cell) {
  const text = String(cell ?? "").trim().replace(/\s+/g, "");
  if (/^\d+$/.test(text)) return `${text}반`;
  return text;
}

function detectGridLayout(rows) {
  if (!rows?.length) return "items";

  const firstJoined = rows[0].map((c) => String(c ?? "")).join(" ");
  if (/문항|item|question/i.test(firstJoined)) return "items";

  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const row = rows[i];
    if (!row?.length) continue;

    if (isCornerLabel(row[0])) {
      const numericHeaders = row.slice(1).filter(isNumericClassHeader);
      if (numericHeaders.length >= 2) {
        let numericRows = 0;
        for (let r = i + 1; r < Math.min(i + 8, rows.length); r++) {
          if (isStudentNumberCell(rows[r]?.[0])) numericRows++;
        }
        if (numericRows >= 1) return "matrix";
      }
      continue;
    }

    const classHeaders = isClassColumnHeader(row[0])
      ? row.filter((c) => isClassColumnHeader(c))
      : row.slice(1).filter(isClassColumnHeader);
    if (classHeaders.length < 1) continue;

    let numericRows = 0;
    for (let r = i + 1; r < Math.min(i + 8, rows.length); r++) {
      if (isStudentNumberCell(rows[r]?.[0])) numericRows++;
    }
    if (numericRows >= 1) return "matrix";
  }

  if (looksLikeHeaderlessScoreMatrix(rows)) return "matrix";

  return "items";
}

function parseMatrixStructure(rows) {
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const row = rows[i];
    if (!row?.length) continue;

    if (isCornerLabel(row[0])) {
      const numericHeaders = row.slice(1).filter(isNumericClassHeader);
      if (numericHeaders.length >= 2) {
        return {
          classLabels: numericHeaders.map(normalizeClassLabel),
          dataStartRow: i + 1,
        };
      }
    }

    const col0IsClass = isClassColumnHeader(row[0]);
    const classLabels = [];

    if (col0IsClass) {
      for (let j = 0; j < row.length; j++) {
        const label = String(row[j] ?? "").trim();
        if (!label) continue;
        if (isClassColumnHeader(label)) {
          classLabels.push(normalizeClassLabel(label));
        } else if (classLabels.length > 0) {
          break;
        }
      }
    } else {
      for (let j = 1; j < row.length; j++) {
        const label = String(row[j] ?? "").trim();
        if (!label) continue;
        if (isClassColumnHeader(label)) {
          classLabels.push(normalizeClassLabel(label));
        } else if (classLabels.length > 0) {
          break;
        }
      }
    }

    if (classLabels.length >= 1) {
      return { classLabels, dataStartRow: i + 1 };
    }
  }

  return { classLabels: [], dataStartRow: 1, headerless: false };
}

function parseHeaderlessClassMatrix(rows) {
  const colCount = inferMatrixColumnCount(rows);
  if (colCount < 2) {
    return { students: [], issues: ["반×번호 행렬 형식을 인식하지 못했습니다."] };
  }

  const classLabels = buildImplicitClassLabels(colCount);
  const students = [];
  const issues = [];
  let rowNum = 0;

  for (const row of rows) {
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;
    rowNum++;

    for (let c = 0; c < colCount; c++) {
      const classLabel = classLabels[c];
      const parsed = parseCellValue(row[c]);
      const id = `${classLabel}-${rowNum}`;

      if (parsed.kind === "empty") {
        students.push({ id, total: null, excluded: true, note: "빈 셀" });
        continue;
      }
      if (parsed.kind === "excluded") {
        students.push({ id, total: null, excluded: true, note: parsed.note });
        continue;
      }

      students.push({
        id,
        total: Math.round(parsed.value * 100) / 100,
        excluded: false,
        note: "",
      });
    }
  }

  const valid = students.filter((s) => !s.excluded && Number.isFinite(s.total));
  if (!valid.length) {
    issues.push("유효한 숫자 성적이 없습니다. 결시·자퇴 등은 비율 계산에서 제외됩니다.");
  }

  return { students, issues, layout: "matrix" };
}

function parseClassMatrix(rows) {
  const structure = parseMatrixStructure(rows);
  if (!structure.classLabels.length) {
    if (looksLikeHeaderlessScoreMatrix(rows)) return parseHeaderlessClassMatrix(rows);
    return { students: [], issues: ["반×번호 행렬 헤더를 찾을 수 없습니다."] };
  }

  const { classLabels, dataStartRow } = structure;

  const students = [];
  const issues = [];

  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;

    const numLabel = String(row[0] ?? "").trim();
    if (!numLabel || !isStudentNumberCell(numLabel)) continue;

    for (let c = 0; c < classLabels.length; c++) {
      const classLabel = classLabels[c];
      const parsed = parseCellValue(row[c + 1]);
      const id = `${classLabel}-${numLabel}`;

      if (parsed.kind === "empty") {
        students.push({ id, total: null, excluded: true, note: "빈 셀" });
        continue;
      }
      if (parsed.kind === "excluded") {
        students.push({ id, total: null, excluded: true, note: parsed.note });
        continue;
      }

      students.push({
        id,
        total: Math.round(parsed.value * 100) / 100,
        excluded: false,
        note: "",
      });
    }
  }

  const valid = students.filter((s) => !s.excluded && Number.isFinite(s.total));
  if (!valid.length) {
    issues.push("유효한 숫자 성적이 없습니다. 결시·자퇴 등은 비율 계산에서 제외됩니다.");
  }

  return { students, issues, layout: "matrix" };
}

function parseItemRows(rows) {
  let start = 0;
  if (isHeaderRow(rows[0])) start = 1;

  const students = [];
  const issues = [];

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;

    const id = String(row[0] ?? i - start + 1).trim();
    const scoreCells = row.slice(1);
    const numeric = [];
    let excluded = false;
    let note = "";

    for (const cell of scoreCells) {
      const parsed = parseCellValue(cell);
      if (parsed.kind === "score") numeric.push(parsed.value);
      else if (parsed.kind === "excluded") {
        excluded = true;
        note = parsed.note || note;
      }
    }

    if (excluded || numeric.length === 0) {
      students.push({ id, total: null, excluded: true, note });
      continue;
    }

    const total = Math.round(numeric.reduce((a, b) => a + b, 0) * 100) / 100;
    students.push({ id, total, items: numeric, excluded: false, note: "" });
  }

  const valid = students.filter((s) => !s.excluded && Number.isFinite(s.total));
  if (!valid.length) {
    issues.push("유효한 숫자 성적이 없습니다. 결시·자퇴 등은 비율 계산에서 제외됩니다.");
  }

  return { students, issues, layout: "items" };
}

export function parseScoreGrid(rows) {
  if (!rows?.length) {
    return { students: [], issues: ["데이터가 비어 있습니다."] };
  }

  const layout = detectGridLayout(rows);
  if (layout === "matrix") return parseClassMatrix(rows);
  return parseItemRows(rows);
}

function normalizePasteRows(lines) {
  const rows = lines.map((line) => line.split(/\t|,|;/).map((c) => c.trim()));

  if (
    rows.length >= 2 &&
    rows[0].length === 1 &&
    /^반$/i.test(String(rows[0][0] ?? "").trim()) &&
    /^번호$/i.test(String(rows[1]?.[0] ?? "").trim())
  ) {
    rows[0] = [`${rows[0][0]}\n${rows[1][0]}`, ...rows[1].slice(1)];
    rows.splice(1, 1);
  }

  return rows;
}

export function parsePasteText(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  const rows = normalizePasteRows(lines);
  return parseScoreGrid(rows);
}

export function validStudentTotals(students) {
  return students.filter((s) => !s.excluded && Number.isFinite(s.total)).map((s) => s.total);
}

export function summarizeStudentData(students) {
  const totals = validStudentTotals(students);
  if (!totals.length) return null;
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const variance =
    totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length;
  return {
    count: totals.length,
    excluded: students.filter((s) => s.excluded).length,
    mean: Math.round(mean * 100) / 100,
    std: Math.round(Math.sqrt(variance) * 100) / 100,
    min: Math.min(...totals),
    max: Math.max(...totals),
  };
}

function exampleCellScore(n, c, maxScore) {
  if (maxScore >= 90) {
    const raw = 38 + ((n * 17 + c * 23) % 58) + ((n + c) % 9) * 0.35;
    const score = Math.min(maxScore, Math.round(raw * 100) / 100);
    return score.toFixed(2);
  }
  const base = c === 3 && n >= 6 ? maxScore * 0.8 : maxScore;
  return (base - (n % 3)).toFixed(2);
}

/** 엑셀 반×번호 행렬 붙여넣기 예시 (탭 구분) */
export function buildMatrixPasteExample({
  classCount = 10,
  rowCount = 8,
  maxScore = 30,
} = {}) {
  const classHeaders = Array.from({ length: classCount }, (_, i) => String(i + 1));
  const lines = [[`반번호`, ...classHeaders].join("\t")];

  for (let n = 1; n <= rowCount; n++) {
    const cells = [String(n)];
    for (let c = 1; c <= classCount; c++) {
      if (n === 3 && c === 1) {
        cells.push("");
      } else if (n === 7 && c === 3) {
        cells.push("자퇴");
      } else if (n === rowCount && c <= classCount - 4) {
        cells.push("");
      } else {
        cells.push(exampleCellScore(n, c, maxScore));
      }
    }
    lines.push(cells.join("\t"));
  }

  return lines.join("\n");
}

/** 정기시험1 예시 — 100점 만점 가상 데이터 */
export function buildExam1PasteExample(options = {}) {
  return buildMatrixPasteExample({ maxScore: 100, classCount: 10, rowCount: 8, ...options });
}

/** 수행평가 예시 — 기본 30점 만점 가상 데이터 */
export function buildPerfPasteExample(options = {}) {
  return buildMatrixPasteExample({ maxScore: 30, classCount: 10, rowCount: 8, ...options });
}

export function pasteFormatGuideHtml() {
  return `
    <div class="paste-format-guide">
      <p class="paste-format-desc">아래 표는 엑셀 시트와 같은 <strong>반×번호</strong> 격자입니다. 1행에 반(1·2·3…), 1열에 학생 번호, 모서리는 <code>반번호</code>입니다. 정기1·수행평가 모두 같은 행·열 구조로 입력하세요.</p>
    </div>`;
}

function scoreById(students) {
  const map = new Map();
  for (const s of students || []) {
    if (s?.id != null) map.set(String(s.id), s);
  }
  return map;
}

/**
 * Align exam1 and perf-area student lists by student id.
 * Returns { exam1Scores, perfScoresByArea, matchedCount, issues }.
 */
export function alignStudentsById(exam1Students, perfStudentsByArea) {
  const examMap = scoreById(exam1Students);
  const perfMaps = (perfStudentsByArea || []).map((list) => scoreById(list));
  const areaCount = perfMaps.length;

  const ids = [...examMap.keys()].filter((id) => {
    const e1 = examMap.get(id);
    if (!e1 || e1.excluded || !Number.isFinite(e1.total)) return false;
    for (const pm of perfMaps) {
      const p = pm.get(id);
      if (!p || p.excluded || !Number.isFinite(p.total)) return false;
    }
    return true;
  });

  if (!ids.length) {
    return {
      exam1Scores: [],
      perfScoresByArea: perfMaps.map(() => []),
      matchedCount: 0,
      issues: ["정기1과 수행평가 데이터에서 공통 학생을 찾지 못했습니다. 엑셀처럼 1행에 반(1·2·3…), 1열에 번호, 모서리에 반번호 헤더를 넣어 두 시트의 행·열 구조가 같은지 확인해 주세요."],
    };
  }

  ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const exam1Scores = ids.map((id) => examMap.get(id).total);
  const perfScoresByArea = perfMaps.map((pm) => ids.map((id) => pm.get(id).total));

  return {
    exam1Scores,
    perfScoresByArea,
    matchedCount: ids.length,
    issues: [],
  };
}

/** id "3반-7" → { classLabel, num } */
export function splitStudentId(id) {
  const m = String(id).match(/^(.+반)-(\d+)$/);
  if (!m) return { classLabel: id, num: "" };
  return { classLabel: m[1], num: m[2] };
}

/**
 * 정기1·수행·실제 정기2 공통 학생 정렬 (학급 학기말 예측용).
 */
export function alignStudentsForSemesterPrediction(
  exam1Students,
  perfStudentsByArea,
  exam2Students
) {
  const examMap = scoreById(exam1Students);
  const exam2Map = scoreById(exam2Students);
  const perfMaps = (perfStudentsByArea || []).map((list) => scoreById(list));

  const ids = [...examMap.keys()].filter((id) => {
    const e1 = examMap.get(id);
    const e2 = exam2Map.get(id);
    if (!e1 || e1.excluded || !Number.isFinite(e1.total)) return false;
    if (!e2 || e2.excluded || !Number.isFinite(e2.total)) return false;
    for (const pm of perfMaps) {
      const p = pm.get(id);
      if (!p || p.excluded || !Number.isFinite(p.total)) return false;
    }
    return true;
  });

  if (!ids.length) {
    return {
      studentIds: [],
      exam1Scores: [],
      exam2Scores: [],
      perfScoresByArea: perfMaps.map(() => []),
      matchedCount: 0,
      issues: [
        "정기1·수행평가·실제 정기2 데이터에서 공통 학생을 찾지 못했습니다. 3. 실제 학생 성적 기반 정기시험2 추정 준비 탭에서 세 데이터 모두 반번호 헤더·같은 행·열 구조로 「데이터 반영」했는지 확인해 주세요.",
      ],
    };
  }

  ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return {
    studentIds: ids,
    exam1Scores: ids.map((id) => examMap.get(id).total),
    exam2Scores: ids.map((id) => exam2Map.get(id).total),
    perfScoresByArea: perfMaps.map((pm) => ids.map((id) => pm.get(id).total)),
    matchedCount: ids.length,
    issues: [],
  };
}
