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
  normalizeComponentConfig,
  normalizePerfCutoffs,
  MAX_PERF_AREAS,
  perfWeightSum,
} from "../core/cutoffs.js";
import {
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

function renderBoundaryInputs(containerId, prefix, mode, maxScore, step = "0.1") {
  const container = document.getElementById(containerId);
  if (!container) return;
  const keys = getBoundaryKeys(mode);
  container.innerHTML = keys
    .map(
      (k) => `
    <div class="field boundary-field">
      <label for="${prefix}-${k}">${BOUNDARY_LABELS[k]}</label>
      <input type="number" id="${prefix}-${k}" min="0" max="${maxScore}" step="${step}" placeholder="0~${maxScore}">
    </div>`
    )
    .join("");
}

function readPerfCount() {
  const checked = document.querySelector('input[name="perf-count"]:checked');
  return Math.min(MAX_PERF_AREAS, Math.max(1, parseInt(checked?.value || "1", 10)));
}

function readComponentConfig() {
  const perfCount = readPerfCount();
  const perfAreas = [];
  for (let i = 0; i < perfCount; i++) {
    perfAreas.push({
      weight: parseFloat(document.getElementById(`w-perf-${i}`)?.value) || 0,
      max: parseFloat(document.getElementById(`max-perf-${i}`)?.value) || 0,
    });
  }
  return normalizeComponentConfig({
    exam1: {
      weight: parseFloat(document.getElementById("w-exam1").value) || 0,
      max: parseFloat(document.getElementById("max-exam1").value) || 0,
    },
    exam2: {
      weight: parseFloat(document.getElementById("w-exam2").value) || 0,
      max: parseFloat(document.getElementById("max-exam2").value) || 0,
    },
    perfCount,
    perfAreas,
  });
}

function readPerfCutoffs(mode) {
  const count = readPerfCount();
  const areas = [];
  for (let i = 0; i < count; i++) {
    areas.push(readComponentCutoffs(`pf${i}`, mode));
  }
  return areas;
}

function renderConfigTable(app) {
  const config = app.componentConfig ? normalizeComponentConfig(app.componentConfig) : defaultComponentConfig();
  const count = config.perfCount || 1;
  const tbody = document.getElementById("config-table-body");
  if (!tbody) return;

  let rows = `
    <tr>
      <td>정기시험1</td>
      <td><input type="number" id="w-exam1" class="inline-input" min="0" max="100" step="1" value="${config.exam1.weight}"></td>
      <td><input type="number" id="max-exam1" class="inline-input" min="0.1" step="0.1" value="${config.exam1.max}"></td>
    </tr>
    <tr>
      <td>정기시험2</td>
      <td><input type="number" id="w-exam2" class="inline-input" min="0" max="100" step="1" value="${config.exam2.weight}"></td>
      <td><input type="number" id="max-exam2" class="inline-input" min="0.1" step="0.1" value="${config.exam2.max}"></td>
    </tr>`;

  for (let i = 0; i < count; i++) {
    const area = config.perfAreas[i] || { weight: 0, max: 0 };
    const label = count > 1 ? `수행평가 ${i + 1}` : "수행평가";
    rows += `
    <tr>
      <td>${label}</td>
      <td><input type="number" id="w-perf-${i}" class="inline-input" min="0" max="100" step="1" value="${area.weight}"></td>
      <td>
        <input type="number" id="max-perf-${i}" class="inline-input" min="0.1" step="0.1" value="${area.max}">
        <button type="button" class="text-btn sync-btn sync-perf-max" data-idx="${i}">반영 비율에 맞추기</button>
      </td>
    </tr>`;
  }

  const selectedCount = config.perfCount || count;
  rows += `
    <tr class="perf-count-row">
      <td>수행평가 영역 수</td>
      <td colspan="2">
        <div class="perf-count-inline">
          ${[1, 2, 3, 4]
            .map(
              (n) => `
            <label class="radio-label radio-inline">
              <input type="radio" name="perf-count" value="${n}" ${n === selectedCount ? "checked" : ""}>
              ${n}개
            </label>`
            )
            .join("")}
        </div>
      </td>
    </tr>`;

  tbody.innerHTML = rows;
}

function renderPerfCards(app) {
  const config = readComponentConfig();
  const grid = document.getElementById("perf-cards-grid");
  if (!grid) return;

  grid.innerHTML = config.perfAreas
    .map((area, i) => {
      const label = config.perfAreas.length > 1 ? `수행평가 ${i + 1}` : "수행평가";
      return `
      <section class="card component-card">
        <h2>${label} 분할점수</h2>
        <p class="component-max-hint" id="hint-perf-${i}">만점 ${area.max}점 척도</p>
        <div id="perf-${i}-boundaries" class="boundaries-grid"></div>
      </section>`;
    })
    .join("");

  for (let i = 0; i < config.perfAreas.length; i++) {
    renderBoundaryInputs(`perf-${i}-boundaries`, `pf${i}`, app.gradeMode, config.perfAreas[i].max);
    const saved = app.basicState?.perfAreas?.[i];
    if (saved) writeComponentCutoffs(`pf${i}`, saved, app.gradeMode);
    else if (app.basicState?.perf && i === 0) writeComponentCutoffs(`pf0`, app.basicState.perf, app.gradeMode);
  }
}

function updateBoundaryMaxAttrs(mode, config) {
  renderBoundaryInputs("exam1-boundaries", "e1", mode, config.exam1.max, "0.01");
  renderBoundaryInputs("exam2-boundaries", "e2", mode, config.exam2.max, "0.01");
  for (let i = 0; i < config.perfAreas.length; i++) {
    renderBoundaryInputs(`perf-${i}-boundaries`, `pf${i}`, mode, config.perfAreas[i].max);
  }
}

function updateMaxHints(config) {
  document.getElementById("hint-exam1").textContent = `만점 ${config.exam1.max}점 척도`;
  document.getElementById("hint-exam2").textContent = `만점 ${config.exam2.max}점 척도`;
  for (let i = 0; i < config.perfAreas.length; i++) {
    const el = document.getElementById(`hint-perf-${i}`);
    if (el) el.textContent = `만점 ${config.perfAreas[i].max}점 척도`;
  }
}

let appRef;

export function initBasic(app) {
  appRef = app;
  app.perfMaxLocked = app.perfMaxLocked ?? {};
  app.componentConfig = normalizeComponentConfig(app.componentConfig || defaultComponentConfig());

  const root = document.getElementById("panel-basic");
  root.innerHTML = `
    <section class="card">
      <h2>요소별 반영 비율 · 만점</h2>
      <p class="notice">환산점 = 분할점수 × (반영 비율 ÷ 만점). 수행평가는 기본적으로 영역별 만점 = 반영 비율입니다.</p>
      <div class="table-wrap">
        <table class="data-table config-table">
          <thead>
            <tr><th>요소</th><th>반영 비율 (%)</th><th>만점 (점)</th></tr>
          </thead>
          <tbody id="config-table-body"></tbody>
        </table>
      </div>
      <p id="weight-status" class="sum-status ok">반영 비율 합계: 100%</p>
    </section>

    <div class="components-grid">
      <section class="card component-card">
        <div class="card-head-row">
          <h2>정기시험1 분할점수</h2>
          <button type="button" class="secondary-btn small-btn" id="load-exam1-session">정기시험별 산출 결과에서 불러오기</button>
        </div>
        <p class="notice exam-source-notice">
          산출 결과를 직접 입력하시거나,
          <button type="button" class="link-btn tab-shortcut" data-tab="exam-helper" data-exam="mid1">2. 정기시험별 추정분할점수 산출</button>
          탭을 활용하세요.
        </p>
        <p class="component-max-hint" id="hint-exam1">만점 100점 척도</p>
        <div id="exam1-boundaries" class="boundaries-grid"></div>
      </section>
      <section class="card component-card">
        <div class="card-head-row">
          <h2>정기시험2 분할점수</h2>
          <div class="btn-group">
            <button type="button" class="secondary-btn small-btn" id="load-exam2-helper">정기시험별 산출 결과에서 불러오기</button>
            <button type="button" class="secondary-btn small-btn" id="load-exam2-semester">학기말 초안 산출 결과에서 불러오기</button>
          </div>
        </div>
        <p class="notice exam-source-notice">
          산출 결과를 직접 입력하시거나,
          <button type="button" class="link-btn tab-shortcut" data-tab="exam-helper" data-exam="mid2">2. 정기시험별 추정분할점수 산출</button>
          ·
          <button type="button" class="link-btn tab-shortcut" data-tab="exam2-tuner">3. 학생 성적 기반 정기시험2 준비</button>
          탭을 활용하세요.
        </p>
        <p class="component-max-hint" id="hint-exam2">만점 100점 척도</p>
        <div id="exam2-boundaries" class="boundaries-grid"></div>
      </section>
    </div>

    <div id="perf-cards-grid" class="components-grid"></div>

    <section class="card">
      <button type="button" id="calc-basic" class="primary-btn">학기말 분할점수 산출</button>
      <p id="basic-error" class="error-msg" hidden></p>
    </section>

    <section id="basic-result" class="card" hidden>
      <div class="card-head-row">
        <h2>학기말 추정 분할점수</h2>
        <button type="button" id="export-basic-excel" class="secondary-btn small-btn">엑셀로 보내기</button>
      </div>
      <div class="table-wrap">
        <table class="data-table" id="basic-result-table">
          <thead id="basic-result-head"></thead>
          <tbody></tbody>
        </table>
      </div>
      <h3 class="sub-heading">성취도 구간</h3>
      <div id="grade-ranges" class="grade-ranges"></div>
    </section>
  `;

  function rebuildPerfUI(preserveCutoffs) {
    const prev = preserveCutoffs ? readPerfCutoffs(app.gradeMode) : null;
    renderConfigTable(app);
    renderPerfCards(app);
    bindConfigInputs(app, onPerfCountChange);
    if (prev) {
      for (let i = 0; i < prev.length; i++) {
        writeComponentCutoffs(`pf${i}`, prev[i], app.gradeMode);
      }
    }
    updateWeightStatus();
  }

  function refreshBoundaries() {
    const config = readComponentConfig();
    updateMaxHints(config);
    updateBoundaryMaxAttrs(app.gradeMode, config);
    restoreCutoffsFromState(app);
    bindInputs(app);
  }

  function onConfigInput(changedId) {
    const config = readComponentConfig();

    const perfMatch = changedId.match(/^w-perf-(\d+)$/);
    if (perfMatch) {
      const idx = parseInt(perfMatch[1], 10);
      if (!app.perfMaxLocked[idx]) {
        const w = parseFloat(document.getElementById(`w-perf-${idx}`).value) || 0;
        document.getElementById(`max-perf-${idx}`).value = w;
      }
    }

    if (changedId.startsWith("max-perf-")) {
      const idx = parseInt(changedId.replace("max-perf-", ""), 10);
      app.perfMaxLocked[idx] = true;
    }

    if (changedId.startsWith("max-")) {
      const cfg = readComponentConfig();
      updateBoundaryMaxAttrs(app.gradeMode, cfg);
      updateMaxHints(cfg);
    }

    updateWeightStatus();
    persistBasic(app);
  }

  function onPerfCountChange() {
    const newCount = readPerfCount();
    const oldConfig = normalizeComponentConfig(app.componentConfig || readComponentConfig());
    const oldAreas = oldConfig.perfAreas;
    const oldCutoffs = readPerfCutoffs(app.gradeMode);

    const newAreas = [];
    for (let i = 0; i < newCount; i++) {
      if (oldAreas[i]) {
        newAreas.push({ ...oldAreas[i] });
      } else {
        const totalPerf = perfWeightSum(oldConfig) || 40;
        const perArea = Math.round((totalPerf / newCount) * 10) / 10;
        newAreas.push({ weight: perArea, max: perArea });
      }
    }

    app.componentConfig = normalizeComponentConfig({
      ...readComponentConfig(),
      perfCount: newCount,
      perfAreas: newAreas,
    });

    rebuildPerfUI(false);

    for (let i = 0; i < Math.min(oldCutoffs.length, newCount); i++) {
      writeComponentCutoffs(`pf${i}`, oldCutoffs[i], app.gradeMode);
    }

    refreshBoundaries();
    persistBasic(app);
    app.notifyStateChange?.();
  }

  renderConfigTable(app);
  renderPerfCards(app);
  restoreFromState(app);
  refreshBoundaries();
  app.registerGradeModeChange(refreshBoundaries);

  document.getElementById("calc-basic").addEventListener("click", () => calculate(app));
  document.getElementById("export-basic-excel").addEventListener("click", () => exportBasic(app));
  document.getElementById("load-exam1-session").addEventListener("click", () => loadSession("mid1", "e1", app));
  document.getElementById("load-exam2-helper").addEventListener("click", () => loadExam2FromHelper(app));
  document.getElementById("load-exam2-semester").addEventListener("click", () => loadExam2FromSemester(app));

  root.querySelectorAll(".tab-shortcut").forEach((btn) => {
    btn.addEventListener("click", () => {
      const exam = btn.dataset.exam || "mid1";
      app.focusExamHelper?.(exam);
      app.switchTab?.(btn.dataset.tab || "exam-helper");
    });
  });

  bindConfigInputs(app, onPerfCountChange);
  updateWeightStatus();

  app.refreshBasicUI = () => {
    restoreFromState(app);
    refreshBoundaries();
    bindConfigInputs(app, onPerfCountChange);
  };
}

function bindConfigInputs(app, onPerfCountChange) {
  ["w-exam1", "w-exam2", "max-exam1", "max-exam2"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => onConfigInputDelegated(id, app));
  });

  const count = readPerfCount();
  for (let i = 0; i < count; i++) {
    for (const id of [`w-perf-${i}`, `max-perf-${i}`]) {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => onConfigInputDelegated(id, app));
    }
    const syncBtn = document.querySelector(`.sync-perf-max[data-idx="${i}"]`);
    if (syncBtn) {
      syncBtn.addEventListener("click", () => {
        const w = parseFloat(document.getElementById(`w-perf-${i}`).value) || 0;
        document.getElementById(`max-perf-${i}`).value = w;
        app.perfMaxLocked[i] = false;
        updateBoundaryMaxAttrs(app.gradeMode, readComponentConfig());
        updateMaxHints(readComponentConfig());
        persistBasic(app);
      });
    }
  }

  if (onPerfCountChange) {
    document.querySelectorAll('input[name="perf-count"]').forEach((el) => {
      el.addEventListener("change", () => {
        if (el.checked) onPerfCountChange();
      });
    });
  }
}

function onConfigInputDelegated(changedId, app) {
  const config = readComponentConfig();
  const perfMatch = changedId.match(/^w-perf-(\d+)$/);
  if (perfMatch) {
    const idx = parseInt(perfMatch[1], 10);
    if (!app.perfMaxLocked[idx]) {
      const w = parseFloat(document.getElementById(`w-perf-${idx}`).value) || 0;
      document.getElementById(`max-perf-${idx}`).value = w;
    }
  }
  if (changedId.startsWith("max-perf-")) {
    const idx = parseInt(changedId.replace("max-perf-", ""), 10);
    app.perfMaxLocked[idx] = true;
  }
  if (changedId.startsWith("max-")) {
    updateBoundaryMaxAttrs(app.gradeMode, readComponentConfig());
    updateMaxHints(readComponentConfig());
  }
  updateWeightStatus();
  persistBasic(app);
}

function bindInputs(app) {
  const ids = ["w-exam1", "w-exam2", "max-exam1", "max-exam2"];
  const keys = getBoundaryKeys(app.gradeMode);
  for (const p of ["e1", "e2"]) {
    for (const k of keys) ids.push(`${p}-${k}`);
  }
  for (let i = 0; i < readPerfCount(); i++) {
    for (const k of keys) ids.push(`pf${i}-${k}`);
  }
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => persistBasic(app));
  }
}

function updateWeightStatus() {
  const config = readComponentConfig();
  const sum = Math.round((config.exam1.weight + config.exam2.weight + perfWeightSum(config)) * 10) / 10;
  const el = document.getElementById("weight-status");
  el.textContent = `반영 비율 합계: ${sum}% (수행 ${perfWeightSum(config)}%)`;
  el.className = sum === 100 ? "sum-status ok" : "sum-status err";
}

function buildResultTableHead(config) {
  const perfCols = config.perfAreas.map((_, i) =>
    config.perfAreas.length > 1 ? `수행${i + 1}` : "수행"
  );
  return `
    <tr>
      <th>경계</th>
      <th>정기1</th><th>정기1환산</th>
      <th>정기2</th><th>정기2환산</th>
      ${perfCols.map((l) => `<th>${l}</th><th>${l}환산</th>`).join("")}
      <th>학기말 점수</th>
    </tr>`;
}

function calculate(app) {
  const mode = app.gradeMode;
  const config = readComponentConfig();
  const exam1 = readComponentCutoffs("e1", mode);
  const exam2 = readComponentCutoffs("e2", mode);
  const perfAreas = readPerfCutoffs(mode);
  const errEl = document.getElementById("basic-error");
  const resultEl = document.getElementById("basic-result");

  const issues = validateCombineInputs(exam1, exam2, perfAreas, config, mode);
  if (issues.length) {
    errEl.textContent = issues[0];
    errEl.hidden = false;
    resultEl.hidden = true;
    return;
  }

  const finalCutoffs = combineCutoffs(exam1, exam2, perfAreas, config, mode);
  const finalIssues = validateCutoffs(finalCutoffs, mode, 100);
  if (finalIssues.length) {
    errEl.textContent = `학기말 분할점수가 단조 감소하지 않습니다: ${finalIssues[0]}`;
    errEl.hidden = false;
    resultEl.hidden = true;
    return;
  }

  errEl.hidden = true;
  resultEl.hidden = false;

  app.finalCutoffs = finalCutoffs;
  app.componentConfig = config;
  app.components = { exam1, exam2, perfAreas };

  const keys = getBoundaryKeys(mode);
  document.getElementById("basic-result-head").innerHTML = buildResultTableHead(config);

  const tbody = document.querySelector("#basic-result-table tbody");
  tbody.innerHTML = keys
    .map((k) => {
      const c = computeContributions(exam1, exam2, perfAreas, config, mode, k);
      const perfCells = c.perfByArea
        .map((contrib, i) => {
          const score = perfAreas[i][k];
          return `<td>${score ?? ""}</td><td class="contrib">${contrib}</td>`;
        })
        .join("");
      return `
    <tr>
      <td>${BOUNDARY_LABELS[k]}</td>
      <td>${exam1[k]}</td><td class="contrib">${c.exam1}</td>
      <td>${exam2[k]}</td><td class="contrib">${c.exam2}</td>
      ${perfCells}
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
    alert("먼저 학기말 분할점수를 산출해 주세요.");
    return;
  }
  try {
    const ranges = buildGradeRanges(app.finalCutoffs, app.gradeMode);
    const rows = buildBasicExcelRows(
      app.finalCutoffs,
      ranges,
      app.componentConfig,
      app.components,
      app.gradeMode
    );
    const now = new Date();
    const fname = `추정_분할점수_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.xlsx`;
    exportToExcel(fname, [{ name: "기본산출", rows }]);
  } catch (e) {
    alert(e.message);
  }
}


function loadSession(exam, prefix, app) {
  const cutoffs = pullExamCutoffFromSession(exam);
  if (!cutoffs) {
    alert("저장된 결과가 없습니다. 2. 정기시험별 추정분할점수 산출 탭에서 먼저 적용해 주세요.");
    return;
  }
  writeComponentCutoffs(prefix, cutoffs, app.gradeMode);
  persistBasic(app);
  calculate(app);
}

function loadExam2FromHelper(app) {
  const cutoffs =
    pullExamCutoffFromSession("mid2", "helper") || pullExamCutoffFromSession("mid2");
  if (!cutoffs) {
    alert(
      "저장된 결과가 없습니다. 2. 정기시험별 추정분할점수 산출 탭에서 정기시험2를 선택하고 「기본 산출에 적용」을 먼저 실행해 주세요."
    );
    return;
  }
  writeComponentCutoffs("e2", cutoffs, app.gradeMode);
  persistBasic(app);
  calculate(app);
}

function loadExam2FromSemester(app) {
  const cutoffs =
    pullExamCutoffFromSession("mid2", "semester") ||
    app.semesterState?.lastResult?.exam2Cutoffs;
  if (!cutoffs) {
    alert(
      "저장된 초안이 없습니다. 3. 학생 성적 기반 정기시험2 준비 탭에서 정기시험2 초안을 산출한 뒤 「기본 산출에 적용」을 실행해 주세요."
    );
    return;
  }
  writeComponentCutoffs("e2", cutoffs, app.gradeMode);
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
    perfAreas: readPerfCutoffs(mode),
  };
  app.persist?.();
}

function restoreCutoffsFromState(app) {
  const s = app.basicState;
  if (!s) return;
  if (s.exam1) writeComponentCutoffs("e1", s.exam1, app.gradeMode);
  if (s.exam2) writeComponentCutoffs("e2", s.exam2, app.gradeMode);
  const perfAreas = s.perfAreas || (s.perf ? [s.perf] : null);
  if (perfAreas) {
    for (let i = 0; i < perfAreas.length; i++) {
      writeComponentCutoffs(`pf${i}`, perfAreas[i], app.gradeMode);
    }
  }
}

function restoreFromState(app) {
  const s = app.basicState;
  const config = s?.componentConfig
    ? normalizeComponentConfig(s.componentConfig)
    : normalizeComponentConfig(app.componentConfig);

  app.componentConfig = config;

  renderConfigTable(app);
  renderPerfCards(app);

  if (s?.componentConfig || config) {
    document.getElementById("w-exam1").value = config.exam1.weight;
    document.getElementById("w-exam2").value = config.exam2.weight;
    document.getElementById("max-exam1").value = config.exam1.max;
    document.getElementById("max-exam2").value = config.exam2.max;
    for (let i = 0; i < config.perfAreas.length; i++) {
      const wEl = document.getElementById(`w-perf-${i}`);
      const mEl = document.getElementById(`max-perf-${i}`);
      if (wEl) wEl.value = config.perfAreas[i].weight;
      if (mEl) mEl.value = config.perfAreas[i].max;
    }
    app.perfMaxLocked = s?.perfMaxLocked ?? {};
  } else if (s?.weights) {
    document.getElementById("w-exam1").value = s.weights.exam1;
    document.getElementById("w-exam2").value = s.weights.exam2;
    document.getElementById("w-perf-0").value = s.weights.perf;
    document.getElementById("max-perf-0").value = s.weights.perf;
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
  return normalizeComponentConfig(
    app.componentConfig || app.basicState?.componentConfig || defaultComponentConfig()
  );
}

export function getPerfCutoffsForApp(app) {
  const components = app.components;
  if (components?.perfAreas) return components.perfAreas;
  if (app.basicState?.perfAreas) return app.basicState.perfAreas;
  if (components?.perf) return [components.perf];
  if (app.basicState?.perf) return [app.basicState.perf];
  return [];
}

export function getExam1CutoffsForApp(app) {
  return app.components?.exam1 || app.basicState?.exam1 || null;
}

/** 학생 성적 탭 분석·정기2 초안용 — 기본 산출 분할점수를 semesterState에 동기화 */
export function syncSemesterCutoffsFromBasic(app) {
  const config = getConfigForApp(app);
  const e1 = getExam1CutoffsForApp(app);
  const pf = getPerfCutoffsForApp(app);

  if (!e1 || e1.AB == null) {
    return { ok: false, error: "1. 기본 탭에서 정기1 분할점수를 입력해 주세요." };
  }

  app.semesterState = app.semesterState || {};
  app.semesterState.exam1Cutoffs = { ...e1 };

  const pfOk =
    Array.isArray(pf) && pf.length === config.perfCount && pf.every((p) => p && p.AB != null);
  app.semesterState.perfCutoffs = pfOk ? pf.map((p) => ({ ...p })) : null;

  const e2 = app.components?.exam2 || app.basicState?.exam2;
  app.semesterState.exam2Cutoffs = e2 ? { ...e2 } : null;
  app.semesterState.finalCutoffs = app.finalCutoffs ? { ...app.finalCutoffs } : null;

  return { ok: true, pfOk };
}
