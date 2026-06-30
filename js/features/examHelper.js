import {
  getBoundaryKeys,
  BOUNDARY_LABELS,
  parseExamCutoffScore,
  formatExamCutoffScore,
  validateCutoffs,
  TIER_ORDER,
  TIER_KEYS,
  gradeColumnsForMode,
  passRateGradeColumnsForMode,
  passRateTargetScore,
  snapRatePercent,
  round2,
} from "../core/grades.js";
import {
  aggregatePointsByDifficulty,
  validatePointsByDifficulty,
  validateQuestions,
  matrixToPassRates,
  buildPassRateMatrixFromCutoffs,
  buildTierRowsBasic,
  buildTierRowsFromQuestions,
  enforcePassRateMatrix,
  validateTierMonotonicMatrix,
  validateGradeMonotonicMatrix,
  computeExamCutoffsFromPassMatrix,
  expectedScoresByGrade,
  collectPassRateWarnings,
} from "../core/passRates.js";
import {
  buildExamHelperExcelRows,
  exportToExcel,
  pushExamCutoffToSession,
} from "../io/export.js";
import { applyExamCutoffsToBasic } from "./basic.js";

const EXAM_LABELS = { mid1: "정기시험1", mid2: "정기시험2" };

export function initExamHelper(app) {
  const root = document.getElementById("panel-exam-helper");
  root.innerHTML = `
    <section class="card">
      <h2>대상 시험</h2>
      <div class="field">
        <label for="helper-exam">적용 시험</label>
        <select id="helper-exam">
          <option value="mid1">정기시험1</option>
          <option value="mid2">정기시험2</option>
        </select>
      </div>
      <div class="mode-toggle">
        <button type="button" class="mode-btn active" data-mode="basic">기본 모드 (난이도별 배점합)</button>
        <button type="button" class="mode-btn" data-mode="detail">세부 설정 모드 (문항별)</button>
      </div>
    </section>

    <section id="helper-basic-panel" class="card">
      <h2>난이도별 배점합</h2>
      <div class="difficulty-counts">
        <div class="field tier low"><label for="pts-low">하 배점합</label><input type="number" id="pts-low" min="0" step="0.1" value="30"></div>
        <div class="field tier mid"><label for="pts-mid">중 배점합</label><input type="number" id="pts-mid" min="0" step="0.1" value="50"></div>
        <div class="field tier high"><label for="pts-high">상 배점합</label><input type="number" id="pts-high" min="0" step="0.1" value="20"></div>
      </div>
      <p id="pts-sum-status" class="sum-status ok">합계: 100점</p>
    </section>

    <section id="helper-detail-panel" class="card" hidden>
      <div class="card-head-row">
        <h2>문항별 설정</h2>
        <button type="button" id="add-question" class="secondary-btn small-btn">문항 추가</button>
      </div>
      <div class="table-wrap">
        <table class="data-table editor-table">
          <thead>
            <tr><th>번호</th><th>배점</th><th>난이도</th><th>유형</th><th></th></tr>
          </thead>
          <tbody id="question-body"></tbody>
        </table>
      </div>
      <p id="detail-sum-status" class="sum-status ok"></p>
    </section>

    <section class="card">
      <h2>목표 추정 분할점수</h2>
      <div id="helper-cutoffs" class="boundaries-grid"></div>
      <button type="button" id="calc-helper" class="primary-btn">성취도별, 난이도별 예상 통과율 제안</button>
      <p id="helper-error" class="error-msg" hidden></p>
    </section>

    <section id="helper-result" class="card" hidden>
      <div class="card-head-row">
        <h2>성취도별 · 난이도별 예상 통과율</h2>
        <div class="btn-group">
          <button type="button" id="export-helper-excel" class="secondary-btn small-btn">엑셀 저장</button>
          <button type="button" id="apply-helper-basic" class="primary-btn small-btn">기본 산출에 적용</button>
        </div>
      </div>
      <p class="notice">제안 통과율은 <strong>성취도·난이도 규칙을 우선</strong>합니다. 같은 난이도에서 A &gt; B &gt; … &gt; E(인접 5%p), 쉬움 &gt; 보통 &gt; 어려움 순서를 지키며, 목표 분할점수와 다소 차이가 날 수 있습니다. 셀 값은 직접 수정할 수 있습니다.</p>
      <p class="notice">통과율은 5% 단위 정수입니다. 상·하위 능력자 격차가 15%p를 넘거나, 최고 난이도(상)의 최하위 능력자 통과율이 20% 미만이면 목표 점수 맞춤을 위해 규칙이 완화된 것으로, 해당 칸에 붉은 테두리가 표시됩니다.</p>
      <div class="table-wrap">
        <table class="data-table pass-rate-table" id="pass-rate-table">
          <thead>
            <tr>
              <th rowspan="2">난이도</th>
              <th rowspan="2">해당문항번호</th>
              <th rowspan="2">문항수</th>
              <th rowspan="2">배점합</th>
              <th colspan="5" id="rate-header-span">최소능력자 예상정답률(%)</th>
            </tr>
            <tr id="grade-col-header"></tr>
          </thead>
          <tbody id="pass-rate-body"></tbody>
          <tfoot id="pass-rate-foot"></tfoot>
        </table>
      </div>
      <div id="helper-computed-cutoffs"></div>
    </section>
  `;

  app.helperState = app.helperState || {
    inputMode: "basic",
    exam: "mid1",
    points: { 하: 30, 중: 50, 상: 20 },
    cutoffs: {},
    passRates: {},
    passRateMatrix: {},
    tierRows: [],
    questions: defaultQuestions(),
  };

  function renderPassRateTable(points, cutoffs, options = {}) {
    const gradeCols = passRateGradeColumnsForMode(app.gradeMode);
    app.helperState.tierRows = getTierRows();
    const tierRows = app.helperState.tierRows;

    let matrix;
    if (options.fromMatrix) {
      matrix = cloneMatrixForHelper(options.fromMatrix);
    } else if (options.skipBuild && app.helperState.passRateMatrix) {
      matrix = app.helperState.passRateMatrix;
    } else {
      const built = buildPassRateMatrixFromCutoffs(cutoffs, points, app.gradeMode, tierRows);
      matrix = built.matrix;
      app.helperState.abilityGapUsed = built.abilityGapUsed;
      app.helperState.abilityGapMatched = built.abilityGapMatched;
      app.helperState.hardTierMinUsed = built.hardTierMinUsed;
    }

    app.helperState.passRateMatrix = matrix;
    app.helperState.passRates = matrixToPassRates(matrix, app.gradeMode);

    const headerSpan = document.getElementById("rate-header-span");
    headerSpan.colSpan = gradeCols.length;
    headerSpan.textContent = "최소능력자 예상정답률(%)";

    document.getElementById("grade-col-header").innerHTML = gradeCols
      .map((g) => `<th class="grade-col">${g}</th>`)
      .join("");

    document.getElementById("pass-rate-body").innerHTML = tierRows
      .map(
        (row) => {
        const rateCells = gradeCols
          .map((grade) => {
            const val = matrix[grade]?.[row.tier] ?? 0;
            return `
            <td>
              <input type="number" class="rate-cell-input"
                data-tier="${row.tier}" data-grade="${grade}"
                min="0" max="100" step="5" value="${val}">
            </td>`;
          })
          .join("");

        return `
        <tr class="tier-row tier-row-${TIER_KEYS[row.tier]}">
          <td class="tier-label tier-label-${TIER_KEYS[row.tier]}">${row.tierLabel}</td>
          <td class="qnums">${row.questionNums}</td>
          <td>${row.questionCount}</td>
          <td>${row.pointsSum}</td>
          ${rateCells}
        </tr>`;
      })
      .join("");

    renderPassRateFooter(tierRows, matrix, cutoffs);
    renderComputedCutoffs(tierRows, matrix, cutoffs);

    document.querySelectorAll(".rate-cell-input").forEach((input) => {
      input.addEventListener("input", () => onRateCellChange(input, tierRows, cutoffs));
    });
    updateRateWarnings(matrix, gradeCols);
  }

  function cloneMatrixForHelper(matrix) {
    const next = {};
    for (const [grade, tiers] of Object.entries(matrix || {})) {
      next[grade] = { ...(tiers || {}) };
    }
    return next;
  }

  function getTierRows() {
    if (app.helperState.inputMode === "detail") {
      return buildTierRowsFromQuestions(readQuestions());
    }
    return buildTierRowsBasic(readPoints());
  }

  function defaultQuestions() {
    const tierPlan = [
      ...Array(7).fill("상"),
      ...Array(7).fill("중"),
      ...Array(6).fill("하"),
    ];
    return tierPlan.map((tier, i) => ({
      num: i + 1,
      point: 5,
      tier,
      type: "선택형",
    }));
  }

  function renderCutoffInputs() {
    const keys = getBoundaryKeys(app.gradeMode);
    document.getElementById("helper-cutoffs").innerHTML = keys
      .map(
        (k) => `
      <div class="field boundary-field">
        <label for="hc-${k}">${BOUNDARY_LABELS[k]}</label>
        <input type="number" id="hc-${k}" min="0" max="100" step="0.01" value="${app.helperState.cutoffs[k] != null ? formatExamCutoffScore(app.helperState.cutoffs[k]) : ""}">
      </div>`
      )
      .join("");
  }

  function readPoints() {
    return {
      하: parseFloat(document.getElementById("pts-low").value) || 0,
      중: parseFloat(document.getElementById("pts-mid").value) || 0,
      상: parseFloat(document.getElementById("pts-high").value) || 0,
    };
  }

  function readCutoffs() {
    const keys = getBoundaryKeys(app.gradeMode);
    const o = {};
    for (const k of keys) o[k] = parseExamCutoffScore(document.getElementById(`hc-${k}`)?.value);
    return o;
  }

  function readQuestions() {
    const rows = document.querySelectorAll("#question-body tr");
    const questions = [];
    rows.forEach((row, i) => {
      questions.push({
        num: i + 1,
        point: parseFloat(row.querySelector(".q-point")?.value) || 0,
        tier: row.querySelector(".q-tier")?.value || "중",
        type: row.querySelector(".q-type")?.value || "선택형",
      });
    });
    return questions;
  }

  function renderQuestions() {
    const qs = app.helperState.questions || defaultQuestions();
    document.getElementById("question-body").innerHTML = qs
      .map(
        (q, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><input type="number" class="q-point" min="0.1" step="0.1" value="${q.point}"></td>
        <td>
          <select class="q-tier tier-input tier-input-${TIER_KEYS[q.tier]}">
            ${TIER_ORDER.map((t) => `<option value="${t}"${q.tier === t ? " selected" : ""}>${t}</option>`).join("")}
          </select>
        </td>
        <td>
          <select class="q-type">
            <option value="선택형"${q.type === "선택형" ? " selected" : ""}>선택형</option>
            <option value="서답형"${q.type === "서답형" ? " selected" : ""}>서답형</option>
          </select>
        </td>
        <td><button type="button" class="text-btn remove-q">삭제</button></td>
      </tr>`
      )
      .join("");

    document.querySelectorAll(".remove-q").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const row = e.target.closest("tr");
        row.remove();
        renumberQuestions();
        updateDetailSum();
        persistHelper(app);
      });
    });

    document.querySelectorAll("#question-body input, #question-body select").forEach((el) => {
      el.addEventListener("input", () => {
        updateDetailSum();
        persistHelper(app);
      });
      el.addEventListener("change", () => {
        updateDetailSum();
        persistHelper(app);
      });
    });
    updateDetailSum();
  }

  function renumberQuestions() {
    document.querySelectorAll("#question-body tr").forEach((row, i) => {
      row.cells[0].textContent = i + 1;
    });
  }

  function updatePointsSum() {
    const pts = readPoints();
    const sum = Math.round((pts.하 + pts.중 + pts.상) * 10) / 10;
    const el = document.getElementById("pts-sum-status");
    el.textContent = `합계: ${sum}점`;
    el.className = Math.abs(sum - 100) < 0.05 ? "sum-status ok" : "sum-status err";
  }

  function updateDetailSum() {
    const qs = readQuestions();
    const sum = Math.round(qs.reduce((a, q) => a + q.point, 0) * 10) / 10;
    const el = document.getElementById("detail-sum-status");
    el.textContent = `문항 배점 합: ${sum}점`;
    el.className = Math.abs(sum - 100) < 0.05 ? "sum-status ok" : "sum-status err";
  }

  function getPointsForCalc() {
    if (app.helperState.inputMode === "detail") {
      const qs = readQuestions();
      return aggregatePointsByDifficulty(qs);
    }
    return readPoints();
  }

  function updateRateWarnings(matrix, gradeCols) {
    document.querySelectorAll(".rate-cell-input").forEach((input) => {
      input.classList.remove("rate-input-warn", "rate-input-tier-warn", "rate-input-grade-warn");
    });

    for (const warn of collectPassRateWarnings(matrix, app.gradeMode)) {
      const input = document.querySelector(
        `.rate-cell-input[data-tier="${warn.tier}"][data-grade="${warn.grade}"]`
      );
      input?.classList.add("rate-input-warn");
    }

    for (const issue of validateGradeMonotonicMatrix(matrix, app.gradeMode)) {
      const input = document.querySelector(
        `.rate-cell-input[data-tier="${issue.tier}"][data-grade="${issue.grade}"]`
      );
      input?.classList.add("rate-input-grade-warn");
    }

    for (const issue of validateTierMonotonicMatrix(matrix, app.gradeMode)) {
      const input = document.querySelector(
        `.rate-cell-input[data-tier="${issue.tier}"][data-grade="${issue.grade}"]`
      );
      input?.classList.add("rate-input-tier-warn");
    }
  }

  function onRateCellChange(input, tierRows, cutoffs) {
    const tier = input.dataset.tier;
    const grade = input.dataset.grade;
    const val = snapRatePercent(parseInt(input.value, 10) || 0);
    input.value = val;

    if (!app.helperState.passRateMatrix[grade]) {
      app.helperState.passRateMatrix[grade] = {};
    }
    app.helperState.passRateMatrix[grade][tier] = val;

    app.helperState.passRateMatrix = enforcePassRateMatrix(
      app.helperState.passRateMatrix,
      app.gradeMode
    );

    const gradeCols = passRateGradeColumnsForMode(app.gradeMode);
    for (const g of gradeCols) {
      const cellInput = document.querySelector(
        `.rate-cell-input[data-tier="${tier}"][data-grade="${g}"]`
      );
      if (cellInput) cellInput.value = app.helperState.passRateMatrix[g]?.[tier] ?? 0;
    }

    app.helperState.passRates = matrixToPassRates(
      app.helperState.passRateMatrix,
      app.gradeMode
    );
    renderPassRateFooter(tierRows, app.helperState.passRateMatrix, cutoffs);
    renderComputedCutoffs(tierRows, app.helperState.passRateMatrix, cutoffs);
    updateRateWarnings(app.helperState.passRateMatrix, gradeCols);
    persistHelper(app);
  }

  function renderComputedCutoffs(tierRows, matrix, cutoffs) {
    const el = document.getElementById("helper-computed-cutoffs");
    if (!el) return;

    const computed = computeExamCutoffsFromPassMatrix(tierRows, matrix, app.gradeMode);
    const keys = getBoundaryKeys(app.gradeMode);

    el.innerHTML = `
      <h3 class="sub-heading">역산 추정 분할점수</h3>
      <p class="notice">위 제안 통과율로 계산한 A/B, B/C, … 경계값입니다.</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>경계</th><th>목표</th><th>역산</th><th>차이</th></tr>
          </thead>
          <tbody>
            ${keys
              .map((k) => {
                const target = cutoffs[k];
                const value = computed[k];
                const diff =
                  target != null && value != null ? round2(value - target) : null;
                const match = diff != null && Math.abs(diff) < 0.05;
                return `
              <tr>
                <td>${BOUNDARY_LABELS[k]}</td>
                <td>${target != null ? formatExamCutoffScore(target) : "-"}</td>
                <td><strong>${value != null ? value.toFixed(2) : "-"}</strong></td>
                <td class="${match ? "diff-pos" : "diff-neg"}">${diff != null ? `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}` : "-"}</td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`;
  }

  function renderPassRateFooter(tierRows, matrix, cutoffs) {
    const gradeCols = passRateGradeColumnsForMode(app.gradeMode);
    const expected = expectedScoresByGrade(tierRows, matrix, app.gradeMode);

    const targetCells = gradeCols
      .map((grade) => {
        const target = passRateTargetScore(grade, cutoffs, app.gradeMode);
        return `<td>${target != null ? target : "-"}</td>`;
      })
      .join("");

    const expectedCells = gradeCols
      .map((grade) => {
        const score = expected[grade];
        const target = passRateTargetScore(grade, cutoffs, app.gradeMode);
        const match =
          target != null && Math.abs(score - target) < 0.05 ? "match" : "mismatch";
        return `<td class="expected-${match}">${score.toFixed(2)}</td>`;
      })
      .join("");

    document.getElementById("pass-rate-foot").innerHTML = `
      <tr class="footer-target">
        <td colspan="4"><strong>목표 분할점수</strong></td>
        ${targetCells}
      </tr>
      <tr class="footer-expected">
        <td colspan="4"><strong>예상 점수</strong></td>
        ${expectedCells}
      </tr>`;
  }

  function calculateHelper() {
    const errEl = document.getElementById("helper-error");
    const resultEl = document.getElementById("helper-result");
    const cutoffs = readCutoffs();
    const cutoffIssues = validateCutoffs(cutoffs, app.gradeMode);

    let pointIssues = [];
    if (app.helperState.inputMode === "detail") {
      const qs = readQuestions();
      pointIssues = validateQuestions(qs);
      app.helperState.questions = qs;
    } else {
      pointIssues = validatePointsByDifficulty(readPoints());
    }

    const issues = [...pointIssues, ...cutoffIssues];
    if (issues.length) {
      errEl.textContent = issues[0];
      errEl.hidden = false;
      resultEl.hidden = true;
      return;
    }

    const points = getPointsForCalc();

    app.helperState.cutoffs = cutoffs;
    app.helperState.points = points;
    app.helperState.exam = document.getElementById("helper-exam").value;

    errEl.hidden = true;
    resultEl.hidden = false;

    renderPassRateTable(points, cutoffs);
    persistHelper(app);
  }

  function persistHelper(app) {
    app.helperState.points = app.helperState.inputMode === "detail"
      ? aggregatePointsByDifficulty(readQuestions())
      : readPoints();
    app.helperState.cutoffs = readCutoffs();
    app.helperState.exam = document.getElementById("helper-exam").value;
    if (app.helperState.inputMode === "detail") {
      app.helperState.questions = readQuestions();
    }
    app.persist?.();
  }

  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      app.helperState.inputMode = btn.dataset.mode;
      document.getElementById("helper-basic-panel").hidden = btn.dataset.mode === "detail";
      document.getElementById("helper-detail-panel").hidden = btn.dataset.mode === "basic";
      persistHelper(app);
    });
  });

  ["pts-low", "pts-mid", "pts-high"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      updatePointsSum();
      persistHelper(app);
    });
  });

  document.getElementById("add-question").addEventListener("click", () => {
    app.helperState.questions = readQuestions();
    app.helperState.questions.push({
      num: app.helperState.questions.length + 1,
      point: 5,
      tier: "중",
      type: "선택형",
    });
    renderQuestions();
    persistHelper(app);
  });

  document.getElementById("calc-helper").addEventListener("click", calculateHelper);

  document.getElementById("export-helper-excel").addEventListener("click", () => {
    try {
      const exam = document.getElementById("helper-exam").value;
      const rows = buildExamHelperExcelRows(
        EXAM_LABELS[exam],
        app.helperState.tierRows,
        app.helperState.cutoffs,
        app.helperState.passRateMatrix,
        app.gradeMode
      );
      exportToExcel(`정기시험도우미_${exam}.xlsx`, [{ name: "통과율", rows }]);
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById("apply-helper-basic").addEventListener("click", () => {
    const exam = document.getElementById("helper-exam").value;
    const tierRows = app.helperState.tierRows?.length
      ? app.helperState.tierRows
      : getTierRows();
    const computed = computeExamCutoffsFromPassMatrix(
      tierRows,
      app.helperState.passRateMatrix,
      app.gradeMode
    );
    if (!Object.keys(computed).length) {
      alert("먼저 성취도별, 난이도별 예상 통과율 제안을 실행해 주세요.");
      return;
    }
    pushExamCutoffToSession(exam, computed, exam === "mid2" ? "helper" : null);
    applyExamCutoffsToBasic(exam, computed, app);
    alert(`${EXAM_LABELS[exam]} 추정 분할점수(소수 둘째 자리)가 1. 기본 탭에 적용되었습니다.`);
    app.switchTab?.("basic");
  });

  app.registerGradeModeChange(() => {
    renderCutoffInputs();
    const keys = getBoundaryKeys(app.gradeMode);
    for (const k of keys) {
      const el = document.getElementById(`hc-${k}`);
      if (el) el.addEventListener("input", () => persistHelper(app));
    }
    if (!document.getElementById("helper-result").hidden && app.helperState.cutoffs) {
      renderPassRateTable(app.helperState.points, app.helperState.cutoffs);
    }
  });

  renderCutoffInputs();
  renderQuestions();
  updatePointsSum();

  if (app.helperState) {
    document.getElementById("helper-exam").value = app.helperState.exam || "mid1";
    if (app.helperState.inputMode === "detail") {
      document.querySelector('.mode-btn[data-mode="detail"]').click();
    }
    if (app.helperState.points) {
      document.getElementById("pts-low").value = app.helperState.points.하 ?? 30;
      document.getElementById("pts-mid").value = app.helperState.points.중 ?? 50;
      document.getElementById("pts-high").value = app.helperState.points.상 ?? 20;
    }
    if (app.helperState.questions?.length) renderQuestions();
    updatePointsSum();
  }

  app.focusExamHelper = (examKey) => focusExamHelper(app, examKey);
}

export function getHelperStateForSave(app) {
  return app.helperState || null;
}

/** 2번 탭 목표 분할점수에 exam2 초안 등 적용 */
export function applyExamCutoffsToHelper(exam, cutoffs, app) {
  focusExamHelper(app, exam);
  app.helperState = app.helperState || {};

  const keys = getBoundaryKeys(app.gradeMode);
  for (const k of keys) {
    const el = document.getElementById(`hc-${k}`);
    if (el && cutoffs[k] != null) el.value = formatExamCutoffScore(cutoffs[k]);
  }

  app.helperState.cutoffs = { ...cutoffs };
  app.helperState.exam = exam === "mid2" ? "mid2" : "mid1";

  const resultEl = document.getElementById("helper-result");
  if (resultEl) resultEl.hidden = true;

  app.persist?.();
}

/** 1. 기본 탭 바로가기 — 대상 시험 선택 후 exam-helper 탭으로 이동 */
export function focusExamHelper(app, examKey) {
  const select = document.getElementById("helper-exam");
  const exam = examKey === "mid2" ? "mid2" : "mid1";
  if (select) select.value = exam;
  app.helperState = app.helperState || {};
  app.helperState.exam = exam;
  app.persist?.();
}
