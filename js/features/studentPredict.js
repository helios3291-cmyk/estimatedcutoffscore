import { predictStudentGrade } from "../core/student.js";
import { BOUNDARY_LABELS, getBoundaryKeys } from "../core/grades.js";
import { getConfigForApp } from "./basic.js";

function updateScoreInputLimits(config) {
  const e1 = document.getElementById("s-exam1");
  const e2 = document.getElementById("s-exam2");
  const pf = document.getElementById("s-perf");
  if (e1) {
    e1.max = config.exam1.max;
    document.getElementById("label-s-exam1").textContent = `정기시험1 (만점 ${config.exam1.max})`;
  }
  if (e2) {
    e2.max = config.exam2.max;
    document.getElementById("label-s-exam2").textContent = `정기시험2 (만점 ${config.exam2.max})`;
  }
  if (pf) {
    pf.max = config.perf.max;
    document.getElementById("label-s-perf").textContent = `수행평가 (만점 ${config.perf.max})`;
  }
}

export function initStudentPredict(app) {
  const root = document.getElementById("panel-student");
  root.innerHTML = `
    <section class="card">
      <h2>학생 점수 입력</h2>
      <div class="weights-grid">
        <div class="field"><label id="label-s-exam1" for="s-exam1">정기시험1 (만점 100)</label><input type="number" id="s-exam1" min="0" max="100" step="0.1" placeholder="점수"></div>
        <div class="field"><label id="label-s-exam2" for="s-exam2">정기시험2 (만점 100)</label><input type="number" id="s-exam2" min="0" max="100" step="0.1" placeholder="점수"></div>
        <div class="field"><label id="label-s-perf" for="s-perf">수행평가 (만점 40)</label><input type="number" id="s-perf" min="0" max="40" step="0.1" placeholder="점수"></div>
      </div>
      <p id="student-weight-display" class="weight-display"></p>
      <button type="button" id="load-final-cutoffs" class="secondary-btn small-btn">기본 산출 최종 분할점수 불러오기</button>
    </section>

    <section class="card">
      <h2>최종 분할점수 (판정 기준)</h2>
      <p class="notice">기본 산출 탭에서 계산한 값을 자동으로 불러오거나 직접 입력할 수 있습니다.</p>
      <div id="student-cutoffs" class="boundaries-grid"></div>
      <button type="button" id="calc-student" class="primary-btn">성취도 예측</button>
      <p id="student-error" class="error-msg" hidden></p>
    </section>

    <section id="student-result" class="card" hidden>
      <h2>예측 결과</h2>
      <div class="prediction-hero">
        <div class="prediction-grade" id="pred-grade">-</div>
        <div class="prediction-detail">
          <p>최종 점수: <strong id="pred-final">-</strong></p>
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
  `;

  function renderCutoffInputs() {
    const keys = getBoundaryKeys(app.gradeMode);
    const cutoffs = app.studentState?.finalCutoffs || app.finalCutoffs || {};
    document.getElementById("student-cutoffs").innerHTML = keys
      .map(
        (k) => `
      <div class="field boundary-field">
        <label for="sc-${k}">${BOUNDARY_LABELS[k]}</label>
        <input type="number" id="sc-${k}" min="0" max="100" step="0.1" value="${cutoffs[k] ?? ""}">
      </div>`
      )
      .join("");
    bindInputs();
  }

  function readFinalCutoffs() {
    const keys = getBoundaryKeys(app.gradeMode);
    const o = {};
    for (const k of keys) {
      o[k] = parseFloat(document.getElementById(`sc-${k}`)?.value);
      if (!Number.isFinite(o[k])) o[k] = null;
    }
    return o;
  }

  function updateWeightDisplay() {
    const c = getConfigForApp(app);
    document.getElementById("student-weight-display").textContent =
      `반영: 정기1 ${c.exam1.weight}%/${c.exam1.max}점 · 정기2 ${c.exam2.weight}%/${c.exam2.max}점 · 수행 ${c.perf.weight}%/${c.perf.max}점`;
    updateScoreInputLimits(c);
  }

  function calculateStudent() {
    const errEl = document.getElementById("student-error");
    const resultEl = document.getElementById("student-result");

    const scores = {
      exam1: parseFloat(document.getElementById("s-exam1").value),
      exam2: parseFloat(document.getElementById("s-exam2").value),
      perf: parseFloat(document.getElementById("s-perf").value),
    };

    const finalCutoffs = readFinalCutoffs();
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
        <td>${d.value}</td>
        <td class="${d.diff >= 0 ? "diff-pos" : "diff-neg"}">${d.diff >= 0 ? "+" : ""}${d.diff}</td>
      </tr>`
      )
      .join("");

    app.studentState = { scores, finalCutoffs };
    app.persist?.();
  }

  function bindInputs() {
    ["s-exam1", "s-exam2", "s-perf"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => persistStudent(app));
    });
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
        perf: parseFloat(document.getElementById("s-perf").value) || null,
      },
      finalCutoffs: readFinalCutoffs(),
    };
    app.persist?.();
  }

  document.getElementById("calc-student").addEventListener("click", calculateStudent);

  document.getElementById("load-final-cutoffs").addEventListener("click", () => {
    if (!app.finalCutoffs) {
      alert("기본 산출 탭에서 먼저 최종 분할점수를 계산해 주세요.");
      return;
    }
    const keys = getBoundaryKeys(app.gradeMode);
    for (const k of keys) {
      const el = document.getElementById(`sc-${k}`);
      if (el) el.value = app.finalCutoffs[k];
    }
    persistStudent(app);
  });

  app.registerGradeModeChange(() => {
    renderCutoffInputs();
    updateWeightDisplay();
  });

  app.registerStateChange(() => {
    updateWeightDisplay();
    if (app.finalCutoffs) {
      const keys = getBoundaryKeys(app.gradeMode);
      for (const k of keys) {
        const el = document.getElementById(`sc-${k}`);
        if (el && !el.value) el.value = app.finalCutoffs[k];
      }
    }
  });

  if (app.studentState?.scores) {
    document.getElementById("s-exam1").value = app.studentState.scores.exam1 ?? "";
    document.getElementById("s-exam2").value = app.studentState.scores.exam2 ?? "";
    document.getElementById("s-perf").value = app.studentState.scores.perf ?? "";
  }

  renderCutoffInputs();
  updateWeightDisplay();
}
