import {
  getBoundaryKeys,
  BOUNDARY_LABELS,
  parseScore,
  validateCutoffs,
} from "../core/grades.js";
import {
  combineCutoffs,
  solveExam2Cutoffs,
} from "../core/cutoffs.js";
import { pushExamCutoffToSession } from "../io/export.js";
import { applyExamCutoffsToBasic, getConfigForApp } from "./basic.js";

function getConfig(app) {
  return getConfigForApp(app);
}

export function initExam2Tuner(app) {
  const root = document.getElementById("panel-exam2-tuner");
  root.innerHTML = `
    <section class="card">
      <h2>반영 비율 · 만점</h2>
      <p class="notice">기본 산출 탭의 설정을 사용합니다. 변경은 기본 산출 탭에서 해 주세요.</p>
      <p id="tuner-weight-display" class="weight-display"></p>
    </section>

    <div class="components-grid two-col">
      <section class="card">
        <h2>정기시험1 분할점수 (확정)</h2>
        <p id="tuner-hint-exam1" class="component-max-hint"></p>
        <div id="tuner-exam1" class="boundaries-grid"></div>
        <button type="button" id="tuner-load-exam1" class="secondary-btn small-btn">기본 산출에서 불러오기</button>
      </section>
      <section class="card">
        <h2>수행평가 분할점수 (확정)</h2>
        <p id="tuner-hint-perf" class="component-max-hint"></p>
        <div id="tuner-perf" class="boundaries-grid"></div>
        <button type="button" id="tuner-load-perf" class="secondary-btn small-btn">기본 산출에서 불러오기</button>
      </section>
    </div>

    <section class="card">
      <h2>목표 최종 분할점수</h2>
      <p class="component-max-hint">만점 100점 척도 (최종)</p>
      <div id="tuner-target" class="boundaries-grid"></div>
      <button type="button" id="tuner-load-target" class="secondary-btn small-btn">기본 산출 최종값 불러오기</button>
    </section>

    <section class="card">
      <button type="button" id="calc-tuner" class="primary-btn">정기시험2 분할점수 초안 계산</button>
      <p id="tuner-error" class="error-msg" hidden></p>
    </section>

    <section id="tuner-result" class="card" hidden>
      <div class="card-head-row">
        <h2>초안 결과</h2>
        <button type="button" id="apply-tuner-basic" class="primary-btn small-btn">기본 산출에 적용</button>
      </div>
      <p id="tuner-exam2-hint" class="component-max-hint"></p>
      <h3 class="sub-heading">권장 정기시험2 분할점수</h3>
      <div class="table-wrap">
        <table class="data-table" id="tuner-exam2-table">
          <thead><tr><th>경계</th><th>권장값</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <h3 class="sub-heading">비교: 초안 반영 전 vs 초안 반영 후 최종</h3>
      <div class="table-wrap">
        <table class="data-table" id="tuner-compare-table">
          <thead><tr><th>경계</th><th>정기1+수행만 반영</th><th>목표 최종</th><th>초안 반영 후 최종</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>
  `;

  function renderBoundaryGroup(containerId, prefix, values, maxScore) {
    const keys = getBoundaryKeys(app.gradeMode);
    const container = document.getElementById(containerId);
    container.innerHTML = keys
      .map(
        (k) => `
      <div class="field boundary-field">
        <label for="${prefix}-${k}">${BOUNDARY_LABELS[k]}</label>
        <input type="number" id="${prefix}-${k}" min="0" max="${maxScore}" step="0.1" value="${values?.[k] ?? ""}">
      </div>`
      )
      .join("");
  }

  function renderInputs() {
    const config = getConfig(app);
    renderBoundaryGroup("tuner-exam1", "t1", app.tunerState?.exam1, config.exam1.max);
    renderBoundaryGroup("tuner-perf", "tp", app.tunerState?.perf, config.perf.max);
    renderBoundaryGroup("tuner-target", "tt", app.tunerState?.target, 100);
    document.getElementById("tuner-hint-exam1").textContent = `만점 ${config.exam1.max}점 척도`;
    document.getElementById("tuner-hint-perf").textContent = `만점 ${config.perf.max}점 척도`;
    document.getElementById("tuner-exam2-hint").textContent =
      `만점 ${config.exam2.max}점 척도 · 반영 ${config.exam2.weight}%`;
    updateWeightDisplay(app);
  }

  function readGroup(prefix) {
    const keys = getBoundaryKeys(app.gradeMode);
    const o = {};
    for (const k of keys) o[k] = parseScore(document.getElementById(`${prefix}-${k}`)?.value);
    return o;
  }

  function writeGroup(prefix, values) {
    const keys = getBoundaryKeys(app.gradeMode);
    for (const k of keys) {
      const el = document.getElementById(`${prefix}-${k}`);
      if (el && values?.[k] != null) el.value = values[k];
    }
  }

  function updateWeightDisplay(app) {
    const c = getConfig(app);
    document.getElementById("tuner-weight-display").textContent =
      `정기1 ${c.exam1.weight}%/${c.exam1.max}점 · 정기2 ${c.exam2.weight}%/${c.exam2.max}점 · 수행 ${c.perf.weight}%/${c.perf.max}점`;
  }

  function calculateTuner() {
    const errEl = document.getElementById("tuner-error");
    const resultEl = document.getElementById("tuner-result");
    const config = getConfig(app);

    const exam1 = readGroup("t1");
    const perf = readGroup("tp");
    const target = readGroup("tt");
    const emptyExam2 = {};
    getBoundaryKeys(app.gradeMode).forEach((k) => (emptyExam2[k] = 0));

    const inputIssues = [
      ...validateCutoffs(exam1, app.gradeMode, config.exam1.max).map((m) => `정기1: ${m}`),
      ...validateCutoffs(perf, app.gradeMode, config.perf.max).map((m) => `수행: ${m}`),
      ...validateCutoffs(target, app.gradeMode, 100).map((m) => `목표: ${m}`),
    ];

    if (config.exam2.weight === 0) {
      inputIssues.push("정기2 반영 비율이 0%입니다.");
    }

    if (inputIssues.length) {
      errEl.textContent = inputIssues[0];
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    const { cutoffs: exam2Suggested, issues } = solveExam2Cutoffs(
      target,
      exam1,
      perf,
      config,
      app.gradeMode
    );

    if (issues.length) {
      errEl.textContent = issues[0];
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    errEl.hidden = true;
    resultEl.hidden = false;

    app.tunerState = { exam1, perf, target, exam2Suggested };
    app.tunerResult = { exam2Suggested, target, exam1, perf };

    const keys = getBoundaryKeys(app.gradeMode);
    document.querySelector("#tuner-exam2-table tbody").innerHTML = keys
      .map((k) => `<tr><td>${BOUNDARY_LABELS[k]}</td><td><strong>${exam2Suggested[k]}</strong></td></tr>`)
      .join("");

    const beforeFinal = combineCutoffs(exam1, emptyExam2, perf, config, app.gradeMode);
    const afterFinal = combineCutoffs(exam1, exam2Suggested, perf, config, app.gradeMode);

    document.querySelector("#tuner-compare-table tbody").innerHTML = keys
      .map(
        (k) => `
      <tr>
        <td>${BOUNDARY_LABELS[k]}</td>
        <td>${beforeFinal[k]}</td>
        <td>${target[k]}</td>
        <td><strong>${afterFinal[k]}</strong></td>
      </tr>`
      )
      .join("");

    persistTuner(app);
  }

  document.getElementById("calc-tuner").addEventListener("click", calculateTuner);

  document.getElementById("tuner-load-exam1").addEventListener("click", () => {
    if (app.components?.exam1 || app.basicState?.exam1) {
      writeGroup("t1", app.components?.exam1 || app.basicState.exam1);
    } else {
      alert("기본 산출 탭에 정기1 데이터가 없습니다.");
    }
  });

  document.getElementById("tuner-load-perf").addEventListener("click", () => {
    if (app.components?.perf || app.basicState?.perf) {
      writeGroup("tp", app.components?.perf || app.basicState.perf);
    } else {
      alert("기본 산출 탭에 수행평가 데이터가 없습니다.");
    }
  });

  document.getElementById("tuner-load-target").addEventListener("click", () => {
    if (app.finalCutoffs) {
      writeGroup("tt", app.finalCutoffs);
    } else {
      alert("기본 산출 탭에서 먼저 최종 분할점수를 계산해 주세요.");
    }
  });

  document.getElementById("apply-tuner-basic").addEventListener("click", () => {
    if (!app.tunerResult?.exam2Suggested) {
      alert("먼저 초안을 계산해 주세요.");
      return;
    }
    pushExamCutoffToSession("mid2", app.tunerResult.exam2Suggested);
    applyExamCutoffsToBasic("mid2", app.tunerResult.exam2Suggested, app);
    alert("정기시험2 분할점수가 기본 산출 탭에 적용되었습니다.");
    app.switchTab?.("basic");
  });

  app.registerGradeModeChange(() => {
    renderInputs();
    bindPersist(app);
  });

  app.registerStateChange(() => updateWeightDisplay(app));

  function bindPersist(app) {
    const keys = getBoundaryKeys(app.gradeMode);
    for (const p of ["t1", "tp", "tt"]) {
      for (const k of keys) {
        const el = document.getElementById(`${p}-${k}`);
        if (el) el.addEventListener("input", () => persistTuner(app));
      }
    }
  }

  function persistTuner(app) {
    app.tunerState = {
      exam1: readGroup("t1"),
      perf: readGroup("tp"),
      target: readGroup("tt"),
      exam2Suggested: app.tunerResult?.exam2Suggested,
    };
    app.persist?.();
  }

  if (app.tunerState) {
    renderInputs();
    writeGroup("t1", app.tunerState.exam1);
    writeGroup("tp", app.tunerState.perf);
    writeGroup("tt", app.tunerState.target);
  } else {
    renderInputs();
  }
  bindPersist(app);
}
