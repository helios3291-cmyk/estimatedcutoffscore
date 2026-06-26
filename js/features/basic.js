import {
  getBoundaryKeys,
  BOUNDARY_LABELS,
  parseScore,
  validateCutoffs,
  buildGradeRanges,
} from "../core/grades.js";
import {
  combineCutoffs,
  computeContributions,
  validateCombineInputs,
  defaultComponentConfig,
} from "../core/cutoffs.js";
import {
  readJsonFile,
  parseExamCutoffImport,
  pullExamCutoffFromSession,
  buildBasicExcelRows,
  exportToExcel,
} from "../io/export.js";

function readComponentCutoffs(prefix, mode) {
  const keys = getBoundaryKeys(mode);
  const o = {};
  for (const k of keys) o[k] = parseScore(document.getElementById(`${prefix}-${k}`)?.value);
  return o;
}

function writeComponentCutoffs(prefix, cutoffs, mode) {
  const keys = getBoundaryKeys(mode);
  for (const k of keys) {
    const el = document.getElementById(`${prefix}-${k}`);
    if (el && cutoffs[k] != null) el.value = cutoffs[k];
  }
}

function renderBoundaryInputs(containerId, prefix, mode, maxScore) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const keys = getBoundaryKeys(mode);
  container.innerHTML = keys
    .map(
      (k) => `
    <div class="field boundary-field">
      <label for="${prefix}-${k}">${BOUNDARY_LABELS[k]}</label>
      <input type="number" id="${prefix}-${k}" min="0" max="${maxScore}" step="0.1" placeholder="0~${maxScore}">
    </div>`
    )
    .join("");
}

function readComponentConfig() {
  return {
    exam1: {
      weight: parseFloat(document.getElementById("w-exam1").value) || 0,
      max: parseFloat(document.getElementById("max-exam1").value) || 0,
    },
    exam2: {
      weight: parseFloat(document.getElementById("w-exam2").value) || 0,
      max: parseFloat(document.getElementById("max-exam2").value) || 0,
    },
    perf: {
      weight: parseFloat(document.getElementById("w-perf").value) || 0,
      max: parseFloat(document.getElementById("max-perf").value) || 0,
    },
  };
}

function updateBoundaryMaxAttrs(mode, config) {
  renderBoundaryInputs("exam1-boundaries", "e1", mode, config.exam1.max);
  renderBoundaryInputs("exam2-boundaries", "e2", mode, config.exam2.max);
  renderBoundaryInputs("perf-boundaries", "pf", mode, config.perf.max);
}

let appRef;

export function initBasic(app) {
  appRef = app;
  app.perfMaxLocked = app.perfMaxLocked ?? false;
  app.componentConfig = app.componentConfig || defaultComponentConfig();

  const root = document.getElementById("panel-basic");
  root.innerHTML = `
    <section class="card">
      <h2>요소별 반영 비율 · 만점</h2>
      <p class="notice">기여분 = 분할점수 × (반영비율 ÷ 만점). 수행평가는 기본적으로 만점 = 반영비율입니다.</p>
      <div class="table-wrap">
        <table class="data-table config-table">
          <thead>
            <tr><th>요소</th><th>반영 비율 (%)</th><th>만점 (점)</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>정기시험1</td>
              <td><input type="number" id="w-exam1" class="inline-input" min="0" max="100" step="1" value="30"></td>
              <td><input type="number" id="max-exam1" class="inline-input" min="0.1" step="0.1" value="100"></td>
            </tr>
            <tr>
              <td>정기시험2</td>
              <td><input type="number" id="w-exam2" class="inline-input" min="0" max="100" step="1" value="30"></td>
              <td><input type="number" id="max-exam2" class="inline-input" min="0.1" step="0.1" value="100"></td>
            </tr>
            <tr>
              <td>수행평가</td>
              <td><input type="number" id="w-perf" class="inline-input" min="0" max="100" step="1" value="40"></td>
              <td>
                <input type="number" id="max-perf" class="inline-input" min="0.1" step="0.1" value="40">
                <button type="button" id="sync-perf-max" class="text-btn sync-btn">반영비율에 맞추기</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p id="weight-status" class="sum-status ok">반영 비율 합계: 100%</p>
    </section>

    <div class="components-grid">
      <section class="card component-card">
        <div class="card-head-row">
          <h2>정기시험1 분할점수</h2>
          <button type="button" class="secondary-btn small-btn" id="load-exam1-session">도우미 결과 불러오기</button>
        </div>
        <p class="component-max-hint" id="hint-exam1">만점 100점 척도</p>
        <div id="exam1-boundaries" class="boundaries-grid"></div>
        <div class="import-row">
          <input type="file" id="import-exam1" accept=".json" hidden>
          <button type="button" class="secondary-btn small-btn" id="btn-import-exam1">JSON 업로드</button>
        </div>
      </section>
      <section class="card component-card">
        <div class="card-head-row">
          <h2>정기시험2 분할점수</h2>
          <button type="button" class="secondary-btn small-btn" id="load-exam2-session">도우미/조율 결과 불러오기</button>
        </div>
        <p class="component-max-hint" id="hint-exam2">만점 100점 척도</p>
        <div id="exam2-boundaries" class="boundaries-grid"></div>
        <div class="import-row">
          <input type="file" id="import-exam2" accept=".json" hidden>
          <button type="button" class="secondary-btn small-btn" id="btn-import-exam2">JSON 업로드</button>
        </div>
      </section>
      <section class="card component-card">
        <h2>수행평가 분할점수</h2>
        <p class="component-max-hint" id="hint-perf">만점 40점 척도</p>
        <div id="perf-boundaries" class="boundaries-grid"></div>
      </section>
    </div>

    <section class="card">
      <button type="button" id="calc-basic" class="primary-btn">최종 분할점수 산출</button>
      <p id="basic-error" class="error-msg" hidden></p>
    </section>

    <section id="basic-result" class="card" hidden>
      <div class="card-head-row">
        <h2>최종 추정 분할점수</h2>
        <button type="button" id="export-basic-excel" class="secondary-btn small-btn">엑셀로 보내기</button>
      </div>
      <div class="table-wrap">
        <table class="data-table" id="basic-result-table">
          <thead>
            <tr>
              <th>경계</th>
              <th>정기1</th><th>기여</th>
              <th>정기2</th><th>기여</th>
              <th>수행</th><th>기여</th>
              <th>최종</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <h3 class="sub-heading">성취도 구간</h3>
      <div id="grade-ranges" class="grade-ranges"></div>
    </section>
  `;

  function refreshBoundaries() {
    const config = readComponentConfig();
    updateMaxHints(config);
    updateBoundaryMaxAttrs(app.gradeMode, config);
    restoreCutoffsFromState(app);
    bindInputs(app);
  }

  function updateMaxHints(config) {
    document.getElementById("hint-exam1").textContent = `만점 ${config.exam1.max}점 척도`;
    document.getElementById("hint-exam2").textContent = `만점 ${config.exam2.max}점 척도`;
    document.getElementById("hint-perf").textContent = `만점 ${config.perf.max}점 척도`;
  }

  function onConfigInput(changedId) {
    const config = readComponentConfig();

    if (changedId === "w-perf" && !app.perfMaxLocked) {
      document.getElementById("max-perf").value = config.perf.weight;
      config.perf.max = config.perf.weight;
    }

    if (changedId === "max-perf") {
      app.perfMaxLocked = true;
    }

    if (changedId.startsWith("max-")) {
      const cfg = readComponentConfig();
      updateBoundaryMaxAttrs(app.gradeMode, cfg);
      updateMaxHints(cfg);
    }

    updateWeightStatus();
    persistBasic(app);
  }

  refreshBoundaries();
  restoreFromState(app);
  app.registerGradeModeChange(refreshBoundaries);

  document.getElementById("calc-basic").addEventListener("click", () => calculate(app));
  document.getElementById("export-basic-excel").addEventListener("click", () => exportBasic(app));
  document.getElementById("load-exam1-session").addEventListener("click", () => loadSession("mid1", "e1", app));
  document.getElementById("load-exam2-session").addEventListener("click", () => loadSession("mid2", "e2", app));
  document.getElementById("btn-import-exam1").addEventListener("click", () => document.getElementById("import-exam1").click());
  document.getElementById("btn-import-exam2").addEventListener("click", () => document.getElementById("import-exam2").click());
  document.getElementById("import-exam1").addEventListener("change", (e) => importExam(e, "e1", app));
  document.getElementById("import-exam2").addEventListener("change", (e) => importExam(e, "e2", app));

  document.getElementById("sync-perf-max").addEventListener("click", () => {
    const w = parseFloat(document.getElementById("w-perf").value) || 0;
    document.getElementById("max-perf").value = w;
    app.perfMaxLocked = false;
    updateBoundaryMaxAttrs(app.gradeMode, readComponentConfig());
    updateMaxHints(readComponentConfig());
    persistBasic(app);
  });

  ["w-exam1", "w-exam2", "w-perf", "max-exam1", "max-exam2", "max-perf"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => onConfigInput(id));
  });
  updateWeightStatus();
}

function bindInputs(app) {
  const ids = ["w-exam1", "w-exam2", "w-perf", "max-exam1", "max-exam2", "max-perf"];
  const keys = getBoundaryKeys(app.gradeMode);
  for (const p of ["e1", "e2", "pf"]) {
    for (const k of keys) ids.push(`${p}-${k}`);
  }
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => persistBasic(app));
  }
}

function updateWeightStatus() {
  const config = readComponentConfig();
  const sum = Math.round((config.exam1.weight + config.exam2.weight + config.perf.weight) * 10) / 10;
  const el = document.getElementById("weight-status");
  el.textContent = `반영 비율 합계: ${sum}%`;
  el.className = sum === 100 ? "sum-status ok" : "sum-status err";
}

function calculate(app) {
  const mode = app.gradeMode;
  const config = readComponentConfig();
  const exam1 = readComponentCutoffs("e1", mode);
  const exam2 = readComponentCutoffs("e2", mode);
  const perf = readComponentCutoffs("pf", mode);
  const errEl = document.getElementById("basic-error");
  const resultEl = document.getElementById("basic-result");

  const issues = validateCombineInputs(exam1, exam2, perf, config, mode);
  if (issues.length) {
    errEl.textContent = issues[0];
    errEl.hidden = false;
    resultEl.hidden = true;
    return;
  }

  const finalCutoffs = combineCutoffs(exam1, exam2, perf, config, mode);
  const finalIssues = validateCutoffs(finalCutoffs, mode, 100);
  if (finalIssues.length) {
    errEl.textContent = `최종 분할점수가 단조 감소하지 않습니다: ${finalIssues[0]}`;
    errEl.hidden = false;
    resultEl.hidden = true;
    return;
  }

  errEl.hidden = true;
  resultEl.hidden = false;

  app.finalCutoffs = finalCutoffs;
  app.componentConfig = config;
  app.components = { exam1, exam2, perf };

  const keys = getBoundaryKeys(mode);
  const tbody = document.querySelector("#basic-result-table tbody");
  tbody.innerHTML = keys
    .map((k) => {
      const c = computeContributions(exam1, exam2, perf, config, mode, k);
      return `
    <tr>
      <td>${BOUNDARY_LABELS[k]}</td>
      <td>${exam1[k]}</td><td class="contrib">${c.exam1}</td>
      <td>${exam2[k]}</td><td class="contrib">${c.exam2}</td>
      <td>${perf[k]}</td><td class="contrib">${c.perf}</td>
      <td><strong>${finalCutoffs[k]}</strong></td>
    </tr>`;
    })
    .join("");

  const ranges = buildGradeRanges(finalCutoffs, mode);
  document.getElementById("grade-ranges").innerHTML = ranges
    .map((r) => `<div class="grade-range grade-${r.grade}"><span class="grade-badge">${r.grade}</span> ${r.label}</div>`)
    .join("");

  persistBasic(app);
  app.notifyStateChange?.();
}

function exportBasic(app) {
  if (!app.finalCutoffs) {
    alert("먼저 최종 분할점수를 산출해 주세요.");
    return;
  }
  try {
    const ranges = buildGradeRanges(app.finalCutoffs, app.gradeMode);
    const rows = buildBasicExcelRows(
      app.finalCutoffs,
      ranges,
      app.componentConfig,
      app.components
    );
    const now = new Date();
    const fname = `추정분할점수_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.xlsx`;
    exportToExcel(fname, [{ name: "기본산출", rows }]);
  } catch (e) {
    alert(e.message);
  }
}

async function importExam(e, prefix, app) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = await readJsonFile(file);
    const { data: parsed, error } = parseExamCutoffImport(data);
    if (error) {
      alert(error);
      return;
    }
    writeComponentCutoffs(prefix, parsed.cutoffs, app.gradeMode);
    persistBasic(app);
    calculate(app);
  } catch (err) {
    alert(err.message);
  }
  e.target.value = "";
}

function loadSession(exam, prefix, app) {
  const cutoffs = pullExamCutoffFromSession(exam);
  if (!cutoffs) {
    alert("저장된 결과가 없습니다. 정기시험 도우미 또는 정기2 조율에서 먼저 적용해 주세요.");
    return;
  }
  writeComponentCutoffs(prefix, cutoffs, app.gradeMode);
  persistBasic(app);
  calculate(app);
}

function persistBasic(app) {
  const mode = app.gradeMode;
  const config = readComponentConfig();
  app.componentConfig = config;
  app.basicState = {
    componentConfig: config,
    perfMaxLocked: app.perfMaxLocked,
    exam1: readComponentCutoffs("e1", mode),
    exam2: readComponentCutoffs("e2", mode),
    perf: readComponentCutoffs("pf", mode),
  };
  app.persist?.();
}

function restoreCutoffsFromState(app) {
  const s = app.basicState;
  if (!s) return;
  if (s.exam1) writeComponentCutoffs("e1", s.exam1, app.gradeMode);
  if (s.exam2) writeComponentCutoffs("e2", s.exam2, app.gradeMode);
  if (s.perf) writeComponentCutoffs("pf", s.perf, app.gradeMode);
}

function restoreFromState(app) {
  const s = app.basicState;
  if (!s) {
    if (app.componentConfig) {
      document.getElementById("w-exam1").value = app.componentConfig.exam1.weight;
      document.getElementById("w-exam2").value = app.componentConfig.exam2.weight;
      document.getElementById("w-perf").value = app.componentConfig.perf.weight;
      document.getElementById("max-exam1").value = app.componentConfig.exam1.max;
      document.getElementById("max-exam2").value = app.componentConfig.exam2.max;
      document.getElementById("max-perf").value = app.componentConfig.perf.max;
    }
    return;
  }

  if (s.componentConfig) {
    document.getElementById("w-exam1").value = s.componentConfig.exam1.weight;
    document.getElementById("w-exam2").value = s.componentConfig.exam2.weight;
    document.getElementById("w-perf").value = s.componentConfig.perf.weight;
    document.getElementById("max-exam1").value = s.componentConfig.exam1.max;
    document.getElementById("max-exam2").value = s.componentConfig.exam2.max;
    document.getElementById("max-perf").value = s.componentConfig.perf.max;
    app.componentConfig = s.componentConfig;
    app.perfMaxLocked = s.perfMaxLocked ?? false;
  } else if (s.weights) {
    document.getElementById("w-exam1").value = s.weights.exam1;
    document.getElementById("w-exam2").value = s.weights.exam2;
    document.getElementById("w-perf").value = s.weights.perf;
    document.getElementById("max-perf").value = s.weights.perf;
  }

  updateWeightStatus();
}

export function applyExamCutoffsToBasic(exam, cutoffs, app) {
  const prefix = exam === "mid1" ? "e1" : "e2";
  writeComponentCutoffs(prefix, cutoffs, app.gradeMode);
  persistBasic(app);
  calculate(app);
}

export function getConfigForApp(app) {
  return app.componentConfig || app.basicState?.componentConfig || defaultComponentConfig();
}
