import {
  getBoundaryKeys,
  BOUNDARY_LABELS,
} from "../core/grades.js";
import {
  computeGradeDistribution,
  computePartialContributionDistribution,
  parseTargetRatios,
  solveExam2ForTargetRatios,
  gradeListForMode,
  partialWeightMax,
} from "../core/gradeDistribution.js";
import {
  parsePasteText,
  validStudentTotals,
  summarizeStudentData,
  alignStudentsById,
} from "../core/studentData.js";
import {
  applyExamCutoffsToBasic,
  getConfigForApp,
  syncSemesterCutoffsFromBasic,
} from "./basic.js";
import { pushExamCutoffToSession } from "../io/export.js";

function getConfig(app) {
  return getConfigForApp(app);
}

function ratioTableHtml(ratios, counts, total) {
  const grades = Object.keys(ratios);
  return `
    <table class="data-table">
      <thead><tr><th>성취도</th><th>학생 수</th><th>비율(%)</th></tr></thead>
      <tbody>
        ${grades
          .map(
            (g) =>
              `<tr><td>${g}</td><td>${counts[g] ?? 0}</td><td>${ratios[g] ?? 0}%</td></tr>`
          )
          .join("")}
        <tr class="footer-target"><td><strong>합계</strong></td><td><strong>${total}</strong></td><td>100%</td></tr>
      </tbody>
    </table>`;
}

function renderPerfInputSections(app) {
  const config = getConfig(app);
  const container = document.getElementById("sf-perf-inputs");
  if (!container) return;

  const count = config.perfCount || 1;
  const pastes = app.semesterState?.perfPastes || [];

  container.innerHTML = Array.from({ length: count }, (_, i) => {
    const label = count > 1 ? `수행평가 ${i + 1}` : "수행평가";
    return `
      <div class="perf-input-block">
        <h3 class="sub-heading">${label}</h3>
        <textarea id="sf-perf-paste-${i}" class="paste-area" rows="5" placeholder="엑셀에서 복사한 범위를 붙여 넣으세요">${pastes[i] ?? ""}</textarea>
        <p id="sf-perf-stats-${i}" class="component-max-hint"></p>
      </div>`;
  }).join("");
}

function fillTargetRatiosFromCombined(ratios, app) {
  const grades = gradeListForMode(app.gradeMode);
  for (const g of grades) {
    const el = document.getElementById(`sf-tr-${g}`);
    if (el && ratios[g] != null) el.value = ratios[g];
  }
  app.semesterState.targetRatios = { ...ratios };
}

export function initExam2Tuner(app) {
  const root = document.getElementById("panel-exam2-tuner");
  root.innerHTML = `
    <section class="card">
      <h2>학생 성적 데이터 입력</h2>
      <p class="notice">엑셀에서 시트 범위를 <strong>복사·붙여넣기</strong>(탭/쉼표 구분). <strong>반×번호 행렬</strong>(모서리 <code>반/번호</code>, 열=1·2·3… 또는 1반·2반…, 행=번호, 셀=학생 총점) 또는 <strong>문항별 행</strong>(첫 열=번호, 이후 열=문항 점수 합산) 형식을 지원합니다. 미인정결·질병결·자퇴 등은 해당 학생만 비율 계산에서 제외됩니다. 수행평가 영역 수는 <strong>기본 산출 탭</strong> 설정을 따릅니다.</p>
      <div>
        <h3 class="sub-heading">정기시험1</h3>
        <textarea id="sf-exam1-paste" class="paste-area" rows="6" placeholder="엑셀에서 복사한 범위를 붙여 넣으세요"></textarea>
        <p id="sf-exam1-stats" class="component-max-hint"></p>
      </div>
      <div id="sf-perf-inputs" class="components-grid"></div>
      <button type="button" id="sf-parse-data" class="primary-btn">데이터 반영</button>
      <p id="sf-parse-error" class="error-msg" hidden></p>
    </section>

    <section class="card">
      <button type="button" id="sf-calc-ratios" class="primary-btn full-width">정기시험1 및 수행평가 점수 기반 학생 성적 분석</button>
      <p id="sf-ratio-error" class="error-msg" hidden></p>
    </section>

    <section id="sf-ratio-result" class="card" hidden>
      <h2>정기시험1만 반영한 성취도별 학생 비율</h2>
      <p class="notice">정기1 원점수와 정기1 분할점수를 직접 비교합니다 (반영비율·환산 미적용).</p>
      <div id="sf-ratio-exam1"></div>

      <h2 class="sub-heading">정기시험1과 수행평가를 반영한 성취도별 학생 비율</h2>
      <p class="notice" id="sf-ratio-combined-desc">정기2 미반영. 정기1·수행 분할점수의 환산점 합으로 A/B, B/C, … 경계를 설정하고, 학생별 정기1·수행 환산점 합과 비교합니다 (만점 = 정기1+수행 반영비율 합).</p>
      <div id="sf-ratio-combined"></div>
      <p id="sf-ratio-combined-skip" class="notice" hidden></p>
    </section>

    <section class="card">
      <h2>정기시험2 추정분할점수 초안</h2>
      <p class="notice">정기2 분할점수가 아직 확정되지 않았다는 전제입니다. 위 <strong>정기1+수행 비율</strong>을 참고하여, 모든 학생이 정기2에서 정기1과 동일한 점수를 받는다고 가정할 때 목표 <strong>최종</strong> 성취도 비율(합 100%)에 맞는 정기2 A/B, B/C, … 분할점수 초안을 산출합니다.</p>
      <div id="sf-target-ratios" class="boundaries-grid"></div>
      <button type="button" id="sf-calc-exam2" class="primary-btn">초안 산출</button>
      <p id="sf-exam2-error" class="error-msg" hidden></p>
    </section>

    <section id="sf-exam2-result" class="card" hidden>
      <div class="card-head-row">
        <h2>정기시험2 추정분할점수 초안</h2>
        <button type="button" id="sf-apply-exam2" class="primary-btn small-btn">기본 산출에 적용</button>
      </div>
      <div class="table-wrap">
        <table class="data-table" id="sf-exam2-table">
          <thead><tr><th>경계</th><th>초안값</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <h3 class="sub-heading">목표 최종 분할점수 (역산 기준)</h3>
      <div class="table-wrap">
        <table class="data-table" id="sf-final-table">
          <thead><tr><th>경계</th><th>목표 최종</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div id="sf-raw-values-wrap"></div>
      <div id="sf-achieved-wrap"></div>
    </section>
  `;

  app.semesterState = app.semesterState || {
    exam1Students: [],
    perfStudentsByArea: [],
    exam1Cutoffs: null,
    perfCutoffs: null,
    finalCutoffs: null,
    exam2Cutoffs: null,
    targetRatios: {},
    lastResult: null,
  };

  if (app.semesterState.perfStudents?.length && !app.semesterState.perfStudentsByArea?.length) {
    app.semesterState.perfStudentsByArea = [app.semesterState.perfStudents];
  }

  function renderTargetRatioInputs() {
    const grades = gradeListForMode(app.gradeMode);
    document.getElementById("sf-target-ratios").innerHTML = grades
      .map(
        (g) => `
      <div class="field boundary-field">
        <label for="sf-tr-${g}">${g} (%)</label>
        <input type="number" id="sf-tr-${g}" min="0" max="100" step="0.1"
          value="${app.semesterState.targetRatios?.[g] ?? ""}">
      </div>`
      )
      .join("");
  }

  function readTargetRatios() {
    const grades = gradeListForMode(app.gradeMode);
    const inputs = {};
    for (const g of grades) {
      inputs[g] = document.getElementById(`sf-tr-${g}`)?.value;
    }
    return parseTargetRatios(inputs, app.gradeMode);
  }

  function parseDataInputs() {
    const errEl = document.getElementById("sf-parse-error");
    errEl.hidden = true;

    const config = getConfig(app);
    const count = config.perfCount || 1;

    const exam1Parsed = parsePasteText(document.getElementById("sf-exam1-paste").value);
    const perfParsedList = [];

    for (let i = 0; i < count; i++) {
      perfParsedList.push(parsePasteText(document.getElementById(`sf-perf-paste-${i}`)?.value || ""));
    }

    const issues = [...(exam1Parsed.issues || [])];
    perfParsedList.forEach((p, i) => {
      if (p.issues?.length) issues.push(`수행${count > 1 ? i + 1 : ""}: ${p.issues[0]}`);
    });

    if (issues.length) {
      errEl.textContent = issues[0];
      errEl.hidden = false;
    }

    app.semesterState.exam1Students = exam1Parsed.students;
    app.semesterState.perfStudentsByArea = perfParsedList.map((p) => p.students);

    const s1 = summarizeStudentData(exam1Parsed.students);
    document.getElementById("sf-exam1-stats").textContent = s1
      ? `유효 ${s1.count}명 (제외 ${s1.excluded}명) · 평균 ${s1.mean} · 표준편차 ${s1.std}`
      : "유효 데이터 없음";

    for (let i = 0; i < count; i++) {
      const s2 = summarizeStudentData(perfParsedList[i].students);
      const label = count > 1 ? `수행${i + 1}` : "수행";
      document.getElementById(`sf-perf-stats-${i}`).textContent = s2
        ? `${label} · 유효 ${s2.count}명 (제외 ${s2.excluded}명) · 평균 ${s2.mean} · 표준편차 ${s2.std}`
        : `${label} · 유효 데이터 없음`;
    }

    app.semesterState.exam1Paste = document.getElementById("sf-exam1-paste").value;
    app.semesterState.perfPastes = Array.from({ length: count }, (_, i) =>
      document.getElementById(`sf-perf-paste-${i}`)?.value || ""
    );

    app.persist?.();
  }

  function getAlignedScores() {
    const config = getConfig(app);
    const perfLists = app.semesterState.perfStudentsByArea || [];
    while (perfLists.length < config.perfCount) perfLists.push([]);

    return alignStudentsById(app.semesterState.exam1Students, perfLists.slice(0, config.perfCount));
  }

  function calcRatios() {
    const errEl = document.getElementById("sf-ratio-error");
    const resultEl = document.getElementById("sf-ratio-result");
    const combinedEl = document.getElementById("sf-ratio-combined");
    const combinedSkipEl = document.getElementById("sf-ratio-combined-skip");
    const combinedDescEl = document.getElementById("sf-ratio-combined-desc");

    const sync = syncSemesterCutoffsFromBasic(app);
    if (!sync.ok) {
      errEl.textContent = sync.error;
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    const e1 = app.semesterState.exam1Cutoffs;
    const pf = app.semesterState.perfCutoffs;
    const config = getConfig(app);
    const partialMax = partialWeightMax(config);

    const exam1Scores = validStudentTotals(app.semesterState.exam1Students);

    if (!exam1Scores.length) {
      errEl.textContent = "정기시험1 유효 학생 데이터가 없습니다.";
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    const d1 = computeGradeDistribution(exam1Scores, e1, app.gradeMode);
    document.getElementById("sf-ratio-exam1").innerHTML = ratioTableHtml(
      d1.ratios,
      d1.counts,
      d1.total
    );

    errEl.hidden = true;
    resultEl.hidden = false;

    const pfOk = Array.isArray(pf) && pf.length === config.perfCount && pf.every(Boolean);
    const hasPerfData = (app.semesterState.perfStudentsByArea || []).some(
      (list) => validStudentTotals(list).length > 0
    );

    if (pfOk && hasPerfData) {
      const aligned = getAlignedScores();
      if (aligned.issues.length) {
        combinedEl.innerHTML = "";
        combinedEl.hidden = true;
        combinedSkipEl.textContent = aligned.issues[0];
        combinedSkipEl.hidden = false;
        app.semesterState.lastRatios = { exam1: d1, combined: null };
      } else {
        const d2 = computePartialContributionDistribution(
          aligned.exam1Scores,
          aligned.perfScoresByArea,
          e1,
          pf,
          config,
          app.gradeMode
        );
        combinedDescEl.textContent = `정기2 미반영. 정기1·수행 분할점수의 환산점 합으로 A/B, B/C, … 경계를 설정하고, 학생별 정기1·수행 환산점 합과 비교합니다 (만점 ${partialMax}%).`;
        combinedEl.innerHTML = ratioTableHtml(d2.ratios, d2.counts, d2.total);
        combinedEl.hidden = false;
        combinedSkipEl.hidden = true;
        app.semesterState.lastRatios = { exam1: d1, combined: d2, matchedCount: aligned.matchedCount };
        fillTargetRatiosFromCombined(d2.ratios, app);
      }
    } else {
      combinedEl.innerHTML = "";
      combinedEl.hidden = true;
      combinedSkipEl.textContent = pfOk
        ? "수행평가 유효 학생 데이터가 없어 계산하지 않습니다."
        : "수행평가 분할점수·학생 데이터가 없어 계산하지 않습니다.";
      combinedSkipEl.hidden = false;
      app.semesterState.lastRatios = { exam1: d1, combined: null };
    }

    app.persist?.();
  }

  function calcExam2Targets() {
    const errEl = document.getElementById("sf-exam2-error");
    const resultEl = document.getElementById("sf-exam2-result");
    const { ratios, error } = readTargetRatios();

    if (error) {
      errEl.textContent = error;
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    const sync = syncSemesterCutoffsFromBasic(app);
    if (!sync.ok) {
      errEl.textContent = sync.error;
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    const e1 = app.semesterState.exam1Cutoffs;
    const pf = app.semesterState.perfCutoffs;
    const config = getConfig(app);

    const pfOk = Array.isArray(pf) && pf.length === config.perfCount && pf.every(Boolean);
    const aligned = getAlignedScores();

    if (!e1 || !pfOk || !aligned.exam1Scores.length) {
      errEl.textContent = aligned.issues[0] || "학생 데이터와 분할점수를 모두 준비해 주세요.";
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    app.semesterState.targetRatios = ratios;
    const result = solveExam2ForTargetRatios(
      aligned.exam1Scores,
      aligned.perfScoresByArea,
      ratios,
      e1,
      pf,
      config,
      app.gradeMode
    );

    if (result.error || !result.exam2Cutoffs) {
      errEl.textContent = result.error || "정기2 추정분할점수 초안을 계산할 수 없습니다.";
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    errEl.hidden = true;
    resultEl.hidden = false;
    app.semesterState.lastResult = result;

    const keys = getBoundaryKeys(app.gradeMode);
    document.querySelector("#sf-exam2-table tbody").innerHTML = keys
      .map(
        (k) =>
          `<tr><td>${BOUNDARY_LABELS[k]}</td><td><strong>${result.exam2Cutoffs[k]}</strong></td></tr>`
      )
      .join("");

    document.querySelector("#sf-final-table tbody").innerHTML = keys
      .map(
        (k) =>
          `<tr><td>${BOUNDARY_LABELS[k]}</td><td>${result.targetFinal[k]}</td></tr>`
      )
      .join("");

    if (result.rawValues) {
      document.getElementById("sf-raw-values-wrap").innerHTML = `
        <h3 class="sub-heading">정기2 역산 원값 (5점 반올림 전)</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>경계</th><th>원값</th></tr></thead>
            <tbody>${keys
              .map(
                (k) =>
                  `<tr><td>${BOUNDARY_LABELS[k]}</td><td>${Math.round(result.rawValues[k] * 10) / 10}</td></tr>`
              )
              .join("")}</tbody>
          </table>
        </div>`;
    } else {
      document.getElementById("sf-raw-values-wrap").innerHTML = "";
    }

    if (result.achieved) {
      document.getElementById("sf-achieved-wrap").innerHTML = `
        <h3 class="sub-heading">가정 적용 후 예상 최종 비율</h3>
        ${ratioTableHtml(result.achieved.ratios, result.achieved.counts, result.achieved.total)}`;
    }

    app.persist?.();
  }

  document.getElementById("sf-parse-data").addEventListener("click", () => parseDataInputs());
  document.getElementById("sf-calc-ratios").addEventListener("click", calcRatios);
  document.getElementById("sf-calc-exam2").addEventListener("click", calcExam2Targets);

  document.getElementById("sf-apply-exam2").addEventListener("click", () => {
    const cutoffs = app.semesterState.lastResult?.exam2Cutoffs;
    if (!cutoffs) {
      alert("먼저 정기시험2 추정분할점수 초안을 산출해 주세요.");
      return;
    }
    pushExamCutoffToSession("mid2", cutoffs);
    applyExamCutoffsToBasic("mid2", cutoffs, app);
    alert("정기시험2 추정분할점수 초안이 기본 산출 탭에 적용되었습니다.");
    app.switchTab?.("basic");
  });

  app.registerGradeModeChange(() => {
    renderTargetRatioInputs();
  });

  app.registerStateChange(() => {
    renderPerfInputSections(app);
  });

  renderTargetRatioInputs();
  renderPerfInputSections(app);

  if (app.semesterState.exam1Paste) {
    document.getElementById("sf-exam1-paste").value = app.semesterState.exam1Paste;
  }
}
