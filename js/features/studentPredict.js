import { predictStudentGrade, predictCohortGrades } from "../core/student.js";
import { BOUNDARY_LABELS, getBoundaryKeys, normalizeFinalCutoffs, roundInt } from "../core/grades.js";
import { getConfigForApp } from "./basic.js";
import { perfWeightSum } from "../core/cutoffs.js";
import {
  alignStudentsForSemesterPrediction,
  splitStudentId,
  validStudentTotals,
} from "../core/studentData.js";
import { gradeListForMode } from "../core/gradeDistribution.js";
import { exportToExcel, buildCohortExcelRows } from "../io/export.js";

function renderPerfScoreInputs(app) {
  const config = getConfigForApp(app);
  const container = document.getElementById("student-perf-inputs");
  if (!container) return;

  const saved = app.studentState?.scores?.perfAreas || [];
  container.innerHTML = config.perfAreas
    .map((area, i) => {
      const label = config.perfAreas.length > 1 ? `수행평가 ${i + 1}` : "수행평가";
      return `
        <div class="field">
          <label id="label-s-perf-${i}" for="s-perf-${i}">${label} (만점 ${area.max})</label>
          <input type="number" id="s-perf-${i}" min="0" max="${area.max}" step="0.1" placeholder="점수" value="${saved[i] ?? ""}">
        </div>`;
    })
    .join("");

  bindPerfInputs(app);
}

function bindPerfInputs(app) {
  const config = getConfigForApp(app);
  for (let i = 0; i < config.perfAreas.length; i++) {
    const el = document.getElementById(`s-perf-${i}`);
    if (el) el.addEventListener("input", () => persistStudent(app));
  }
}

function updateScoreInputLimits(config) {
  const e1 = document.getElementById("s-exam1");
  const e2 = document.getElementById("s-exam2");
  if (e1) {
    e1.max = config.exam1.max;
    document.getElementById("label-s-exam1").textContent = `정기시험1 (만점 ${config.exam1.max})`;
  }
  if (e2) {
    e2.max = config.exam2.max;
    document.getElementById("label-s-exam2").textContent = `정기시험2 (만점 ${config.exam2.max})`;
  }
}

function fillCutoffInputs(cutoffs, mode) {
  const normalized = normalizeFinalCutoffs(cutoffs, mode);
  for (const k of getBoundaryKeys(mode)) {
    const el = document.getElementById(`sc-${k}`);
    if (el && normalized[k] != null) el.value = normalized[k];
  }
  return normalized;
}

/** 1. 기본 탭의 학기말 분할점수 → 학생 예측 입력란 동기화 */
export function syncFinalCutoffsFromBasic(app) {
  if (!app.finalCutoffs) return false;
  const normalized = fillCutoffInputs(app.finalCutoffs, app.gradeMode);
  app.studentState = {
    ...(app.studentState || {}),
    finalCutoffs: normalized,
  };
  return true;
}

export function initStudentPredict(app) {
  const root = document.getElementById("panel-student");
  root.innerHTML = `
    <section class="card">
      <h2>학생 점수 입력</h2>
      <div class="weights-grid">
        <div class="field"><label id="label-s-exam1" for="s-exam1">정기시험1 (만점 100)</label><input type="number" id="s-exam1" min="0" max="100" step="0.1" placeholder="점수"></div>
        <div class="field"><label id="label-s-exam2" for="s-exam2">정기시험2 (만점 100)</label><input type="number" id="s-exam2" min="0" max="100" step="0.1" placeholder="점수"></div>
      </div>
      <div id="student-perf-inputs" class="weights-grid"></div>
      <p id="student-weight-display" class="weight-display"></p>
    </section>

    <section class="card">
      <h2>학기말 분할점수 (판정 기준)</h2>
      <p class="notice">1. 기본 탭에서 「학기말 분할점수 산출」 시 아래 값이 자동 반영됩니다 (정수).</p>
      <div id="student-cutoffs" class="boundaries-grid"></div>
      <button type="button" id="calc-student" class="primary-btn">성취도 예측</button>
      <p id="student-error" class="error-msg" hidden></p>
    </section>

    <section id="student-result" class="card" hidden>
      <h2>예측 결과</h2>
      <div class="prediction-hero">
        <div class="prediction-grade" id="pred-grade">-</div>
        <div class="prediction-detail">
          <p>학기말 점수: <strong id="pred-final">-</strong></p>
          <p id="pred-margin"></p>
        </div>
      </div>
      <h3 class="sub-heading">경계와의 거리</h3>
      <div class="table-wrap">
        <table class="data-table" id="distance-table">
          <thead><tr><th>경계</th><th>분할점수</th><th>차이 (+ 위)</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>학급 학기말 성적 예측</h2>
      <p class="notice">전제: 1. 기본 탭에서 「학기말 분할점수 산출」 완료, 3. 실제 학생 성적 기반 정기시험2 추정 준비 탭에서 정기1·수행·<strong>실제 정기2</strong> 데이터 「데이터 반영」 완료.</p>
      <button type="button" id="calc-cohort" class="primary-btn">학기말 성적 예측</button>
      <p id="cohort-error" class="error-msg" hidden></p>
    </section>

    <section id="cohort-result" class="card" hidden>
      <div class="card-head-row">
        <h2>학급 학기말 성적 예측 결과</h2>
        <button type="button" id="cohort-export" class="secondary-btn small-btn">엑셀로보내기</button>
      </div>
      <p id="cohort-summary" class="sample-summary"></p>
      <div class="table-wrap">
        <table class="data-table" id="cohort-table">
          <thead></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>
  `;

  function renderCutoffInputs() {
    const keys = getBoundaryKeys(app.gradeMode);
    const raw = app.studentState?.finalCutoffs || app.finalCutoffs || {};
    const cutoffs = normalizeFinalCutoffs(raw, app.gradeMode);
    document.getElementById("student-cutoffs").innerHTML = keys
      .map(
        (k) => `
      <div class="field boundary-field">
        <label for="sc-${k}">${BOUNDARY_LABELS[k]}</label>
        <input type="number" id="sc-${k}" min="0" max="100" step="1" value="${cutoffs[k] ?? ""}">
      </div>`
      )
      .join("");
    bindCutoffInputs();
  }

  function readFinalCutoffs() {
    const keys = getBoundaryKeys(app.gradeMode);
    const o = {};
    for (const k of keys) {
      o[k] = parseFloat(document.getElementById(`sc-${k}`)?.value);
      if (!Number.isFinite(o[k])) o[k] = null;
    }
    return normalizeFinalCutoffs(o, app.gradeMode);
  }

  function readPerfScores() {
    const config = getConfigForApp(app);
    return config.perfAreas.map((_, i) => parseFloat(document.getElementById(`s-perf-${i}`)?.value));
  }

  function updateWeightDisplay() {
    const c = getConfigForApp(app);
    const perfParts = c.perfAreas.map((a, i) =>
      c.perfAreas.length > 1 ? `수행${i + 1} ${a.weight}%/${a.max}점` : `수행 ${a.weight}%/${a.max}점`
    );
    document.getElementById("student-weight-display").textContent =
      `반영: 정기1 ${c.exam1.weight}%/${c.exam1.max}점 · 정기2 ${c.exam2.weight}%/${c.exam2.max}점 · ${perfParts.join(" · ")} (수행 합 ${perfWeightSum(c)}%)`;
    updateScoreInputLimits(c);
    renderPerfScoreInputs(app);
  }

  function calculateStudent() {
    const errEl = document.getElementById("student-error");
    const resultEl = document.getElementById("student-result");

    if (!app.finalCutoffs) {
      errEl.textContent = "1. 기본 탭에서 학기말 분할점수를 먼저 산출해 주세요.";
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    const finalCutoffs = syncFinalCutoffsFromBasic(app)
      ? app.studentState.finalCutoffs
      : fillCutoffInputs(app.finalCutoffs, app.gradeMode);

    const scores = {
      exam1: parseFloat(document.getElementById("s-exam1").value),
      exam2: parseFloat(document.getElementById("s-exam2").value),
      perfAreas: readPerfScores(),
    };

    const config = getConfigForApp(app);
    const result = predictStudentGrade(scores, config, finalCutoffs, app.gradeMode);

    if (result.error) {
      errEl.textContent = result.error;
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    errEl.hidden = true;
    resultEl.hidden = false;

    document.getElementById("pred-grade").textContent = result.grade;
    document.getElementById("pred-grade").className = `prediction-grade grade-${result.grade}`;
    document.getElementById("pred-final").textContent = `${result.finalScore}점`;

    let margin = "";
    if (result.nearestUpper) {
      margin += `${result.nearestUpper} 경계보다 ${result.marginAbove}점 위`;
    }
    if (result.nearestLower) {
      if (margin) margin += " · ";
      margin += `${result.nearestLower} 경계보다 ${result.marginBelow}점 아래`;
    }
    document.getElementById("pred-margin").textContent = margin;

    document.querySelector("#distance-table tbody").innerHTML = result.distances
      .map(
        (d) => `
      <tr>
        <td>${d.boundary}</td>
        <td>${roundInt(d.value)}</td>
        <td class="${d.diff >= 0 ? "diff-pos" : "diff-neg"}">${d.diff >= 0 ? "+" : ""}${d.diff}</td>
      </tr>`
      )
      .join("");

    app.studentState = { scores, finalCutoffs };
    app.persist?.();
  }

  function bindCutoffInputs() {
    getBoundaryKeys(app.gradeMode).forEach((k) => {
      const el = document.getElementById(`sc-${k}`);
      if (el) el.addEventListener("input", () => persistStudent(app));
    });
  }

  function persistStudent(app) {
    app.studentState = {
      scores: {
        exam1: parseFloat(document.getElementById("s-exam1").value) || null,
        exam2: parseFloat(document.getElementById("s-exam2").value) || null,
        perfAreas: readPerfScores().map((v) => (Number.isFinite(v) ? v : null)),
      },
      finalCutoffs: readFinalCutoffs(),
    };
    app.persist?.();
  }

  document.getElementById("calc-student").addEventListener("click", calculateStudent);

  let lastCohortResult = null;

  function calculateCohort() {
    const errEl = document.getElementById("cohort-error");
    const resultEl = document.getElementById("cohort-result");

    if (!app.finalCutoffs) {
      errEl.textContent = "1. 기본 탭에서 학기말 분할점수를 먼저 산출해 주세요.";
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    const config = getConfigForApp(app);
    const semester = app.semesterState || {};
    const exam1 = semester.exam1Students || [];
    const exam2 = semester.exam2ActualStudents || [];
    const perfByArea = semester.perfStudentsByArea || [];

    if (!validStudentTotals(exam1).length) {
      errEl.textContent = "3번 탭에서 정기1 학생 데이터를 반영해 주세요.";
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }
    if (!validStudentTotals(exam2).length) {
      errEl.textContent = "3번 탭 하단 실제 정기2 학생 데이터를 반영해 주세요.";
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    const aligned = alignStudentsForSemesterPrediction(exam1, perfByArea, exam2);
    const finalCutoffs = syncFinalCutoffsFromBasic(app)
      ? app.studentState.finalCutoffs
      : normalizeFinalCutoffs(app.finalCutoffs, app.gradeMode);

    const result = predictCohortGrades(aligned, config, finalCutoffs, app.gradeMode);

    if (result.error) {
      errEl.textContent = result.error;
      errEl.hidden = false;
      resultEl.hidden = true;
      lastCohortResult = null;
      return;
    }

    errEl.hidden = true;
    resultEl.hidden = false;
    lastCohortResult = result;

    const perfHeaders = config.perfAreas.map((_, i) =>
      config.perfAreas.length > 1 ? `수행${i + 1}` : "수행"
    );
    document.querySelector("#cohort-table thead").innerHTML = `
      <tr>
        <th>반</th><th>번호</th><th>정기1</th><th>정기2</th>
        ${perfHeaders.map((h) => `<th>${h}</th>`).join("")}
        <th>학기말 점수</th><th>예상 성취도</th>
      </tr>`;

    document.querySelector("#cohort-table tbody").innerHTML = result.rows
      .map((row) => {
        const { classLabel, num } = splitStudentId(row.id);
        const perfCells = row.perfAreas.map((s) => `<td>${s}</td>`).join("");
        return `
      <tr>
        <td>${classLabel}</td>
        <td>${num}</td>
        <td>${row.exam1}</td>
        <td>${row.exam2}</td>
        ${perfCells}
        <td><strong>${row.finalScore}</strong></td>
        <td class="grade-cell grade-${row.grade}">${row.grade}</td>
      </tr>`;
      })
      .join("");

    const grades = gradeListForMode(app.gradeMode);
    const summaryParts = grades
      .filter((g) => result.gradeCounts[g])
      .map((g) => `${g} ${result.gradeCounts[g]}명`);
    document.getElementById("cohort-summary").textContent = `매칭 ${result.matchedCount}명 · ${summaryParts.join(" · ")}`;
  }

  document.getElementById("calc-cohort").addEventListener("click", calculateCohort);

  document.getElementById("cohort-export").addEventListener("click", () => {
    if (!lastCohortResult?.rows?.length) return;
    const config = getConfigForApp(app);
    try {
      exportToExcel("학급_학기말_성적_예측.xlsx", [
        {
          name: "예측",
          rows: buildCohortExcelRows(lastCohortResult.rows, config),
        },
      ]);
    } catch (e) {
      alert(e.message || "엑셀보내기에 실패했습니다.");
    }
  });

  ["s-exam1", "s-exam2"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => persistStudent(app));
  });

  app.registerGradeModeChange(() => {
    renderCutoffInputs();
    updateWeightDisplay();
  });

  app.registerStateChange(() => {
    updateWeightDisplay();
    if (syncFinalCutoffsFromBasic(app)) {
      app.persist?.();
    }
  });

  if (app.studentState?.scores) {
    document.getElementById("s-exam1").value = app.studentState.scores.exam1 ?? "";
    document.getElementById("s-exam2").value = app.studentState.scores.exam2 ?? "";
  }

  renderCutoffInputs();
  syncFinalCutoffsFromBasic(app);
  updateWeightDisplay();

  if (app.studentState?.scores?.perfAreas) {
    app.studentState.scores.perfAreas.forEach((v, i) => {
      const el = document.getElementById(`s-perf-${i}`);
      if (el && v != null) el.value = v;
    });
  } else if (app.studentState?.scores?.perf != null) {
    const el = document.getElementById("s-perf-0");
    if (el) el.value = app.studentState.scores.perf;
  }
}
