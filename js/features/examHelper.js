import {
  getBoundaryKeys,
  BOUNDARY_LABELS,
  parseScore,
  validateCutoffs,
  TIER_ORDER,
  TIER_KEYS,
} from "../core/grades.js";
import {
  aggregatePointsByDifficulty,
  validatePointsByDifficulty,
  solvePassRatesForCutoffs,
  adjustPassRate,
  expectedScore,
  validateQuestions,
  distributeItemRates,
} from "../core/passRates.js";
import {
  downloadJson,
  buildExamCutoffExport,
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
      <button type="button" id="calc-helper" class="primary-btn">통과율 제안 계산</button>
      <p id="helper-error" class="error-msg" hidden></p>
    </section>

    <section id="helper-result" class="card" hidden>
      <div class="card-head-row">
        <h2>성취도별 · 난이도별 예상 통과율</h2>
        <div class="btn-group">
          <button type="button" id="export-helper-json" class="secondary-btn small-btn">JSON 저장</button>
          <button type="button" id="export-helper-excel" class="secondary-btn small-btn">엑셀 저장</button>
          <button type="button" id="apply-helper-basic" class="primary-btn small-btn">기본 산출에 적용</button>
        </div>
      </div>
      <p class="notice">아래 통과율은 조정 가능한 제안값입니다. 슬라이더로 미세 조정하면 예상 점수가 갱신됩니다.</p>
      <div id="pass-rate-panels"></div>
      <div id="item-rate-table-wrap" class="table-wrap" hidden>
        <h3 class="sub-heading">문항별 통과율 (난이도별 비례 배분)</h3>
        <table class="data-table" id="item-rate-table">
          <thead><tr><th>문항</th><th>배점</th><th>난이도</th><th>유형</th><th>통과율</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>
  `;

  app.helperState = app.helperState || {
    inputMode: "basic",
    exam: "mid1",
    points: { 하: 30, 중: 50, 상: 20 },
    cutoffs: {},
    passRates: {},
    questions: defaultQuestions(),
  };

  let fixedTierForAdjust = "중";

  function defaultQuestions() {
    return Array.from({ length: 5 }, (_, i) => ({
      num: i + 1,
      point: 20,
      tier: TIER_ORDER[i % 3],
      type: i % 2 === 0 ? "선택형" : "서답형",
    }));
  }

  function renderCutoffInputs() {
    const keys = getBoundaryKeys(app.gradeMode);
    document.getElementById("helper-cutoffs").innerHTML = keys
      .map(
        (k) => `
      <div class="field boundary-field">
        <label for="hc-${k}">${BOUNDARY_LABELS[k]}</label>
        <input type="number" id="hc-${k}" min="0" max="100" step="0.1" value="${app.helperState.cutoffs[k] ?? ""}">
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
    for (const k of keys) o[k] = parseScore(document.getElementById(`hc-${k}`)?.value);
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

  function renderPassRatePanels(passRates, points, cutoffs) {
    const container = document.getElementById("pass-rate-panels");
    const keys = getBoundaryKeys(app.gradeMode);

    container.innerHTML = keys
      .map((key) => {
        const rates = passRates[key] || { 하: 0, 중: 0, 상: 0 };
        const score = expectedScore(points, rates);
        return `
        <div class="pass-panel" data-boundary="${key}">
          <h3>${BOUNDARY_LABELS[key]} 경계 — 목표 ${cutoffs[key]}점 · 예상 ${score}점</h3>
          <div class="slider-grid">
            ${TIER_ORDER.map(
              (tier) => `
              <div class="slider-field tier ${TIER_KEYS[tier]}">
                <label>${tier} 통과율 <span class="rate-val" data-tier="${tier}">${(rates[tier] * 100).toFixed(1)}%</span></label>
                <input type="range" class="rate-slider" data-tier="${tier}" min="0" max="100" step="0.5" value="${(rates[tier] * 100).toFixed(1)}">
              </div>`
            ).join("")}
          </div>
          <div class="adjust-row">
            <label>자동 맞춤 축:</label>
            <select class="solve-tier">
              ${TIER_ORDER.map((t) => `<option value="${t}"${t === fixedTierForAdjust ? " selected" : ""}>${t}</option>`).join("")}
            </select>
          </div>
        </div>`;
      })
      .join("");

    container.querySelectorAll(".pass-panel").forEach((panel) => {
      const boundary = panel.dataset.boundary;
      const solveSelect = panel.querySelector(".solve-tier");

      solveSelect.addEventListener("change", () => {
        fixedTierForAdjust = solveSelect.value;
      });

      panel.querySelectorAll(".rate-slider").forEach((slider) => {
        slider.addEventListener("input", () => {
          const tier = slider.dataset.tier;
          const solveTier = panel.querySelector(".solve-tier").value;
          const fixedTiers = TIER_ORDER.filter((t) => t !== solveTier);
          const current = { ...app.helperState.passRates[boundary] };
          current[tier] = parseFloat(slider.value) / 100;

          for (const ft of fixedTiers) {
            if (ft !== tier) {
              const otherSlider = panel.querySelector(`.rate-slider[data-tier="${ft}"]`);
              current[ft] = parseFloat(otherSlider.value) / 100;
            }
          }

          const result = adjustPassRate(points, current, fixedTiers, solveTier, cutoffs[boundary]);
          app.helperState.passRates[boundary] = result.rates;
          refreshPanel(panel, boundary, points, cutoffs);
          renderItemRatesIfDetail();
          persistHelper(app);
        });
      });
    });
  }

  function refreshPanel(panel, boundary, points, cutoffs) {
    const rates = app.helperState.passRates[boundary];
    const score = expectedScore(points, rates);
    panel.querySelector("h3").textContent =
      `${BOUNDARY_LABELS[boundary]} 경계 — 목표 ${cutoffs[boundary]}점 · 예상 ${score}점`;

    TIER_ORDER.forEach((tier) => {
      const val = panel.querySelector(`.rate-val[data-tier="${tier}"]`);
      const slider = panel.querySelector(`.rate-slider[data-tier="${tier}"]`);
      if (val) val.textContent = `${(rates[tier] * 100).toFixed(1)}%`;
      if (slider) slider.value = (rates[tier] * 100).toFixed(1);
    });
  }

  function renderItemRatesIfDetail() {
    const wrap = document.getElementById("item-rate-table-wrap");
    if (app.helperState.inputMode !== "detail") {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const qs = readQuestions();
    const tbody = document.querySelector("#item-rate-table tbody");
    const firstKey = getBoundaryKeys(app.gradeMode)[0];
    const tierRates = app.helperState.passRates[firstKey] || {};

    tbody.innerHTML = distributeItemRates(qs, tierRates)
      .map(
        (q) => `
      <tr>
        <td>${q.num}</td>
        <td>${q.point}</td>
        <td><span class="tier-badge ${TIER_KEYS[q.tier]}">${q.tier}</span></td>
        <td>${q.type}</td>
        <td>${(q.passRate * 100).toFixed(1)}%</td>
      </tr>`
      )
      .join("");
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
    const passRates = solvePassRatesForCutoffs(cutoffs, points, app.gradeMode);

    app.helperState.cutoffs = cutoffs;
    app.helperState.points = points;
    app.helperState.passRates = passRates;
    app.helperState.exam = document.getElementById("helper-exam").value;

    errEl.hidden = true;
    resultEl.hidden = false;

    renderPassRatePanels(passRates, points, cutoffs);
    renderItemRatesIfDetail();
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

  document.getElementById("export-helper-json").addEventListener("click", () => {
    const exam = document.getElementById("helper-exam").value;
    const data = buildExamCutoffExport(
      exam,
      app.helperState.inputMode,
      app.helperState.points,
      app.helperState.cutoffs,
      app.helperState.passRates,
      app.helperState.questions
    );
    downloadJson(data, `exam_cutoff_${exam}.json`);
  });

  document.getElementById("export-helper-excel").addEventListener("click", () => {
    try {
      const exam = document.getElementById("helper-exam").value;
      const rows = buildExamHelperExcelRows(
        EXAM_LABELS[exam],
        app.helperState.points,
        app.helperState.cutoffs,
        app.helperState.passRates
      );
      exportToExcel(`정기시험도우미_${exam}.xlsx`, [{ name: "통과율", rows }]);
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById("apply-helper-basic").addEventListener("click", () => {
    const exam = document.getElementById("helper-exam").value;
    pushExamCutoffToSession(exam, app.helperState.cutoffs);
    applyExamCutoffsToBasic(exam, app.helperState.cutoffs, app);
    alert(`${EXAM_LABELS[exam]} 분할점수가 기본 산출 탭에 적용되었습니다.`);
    app.switchTab?.("basic");
  });

  app.registerGradeModeChange(() => {
    renderCutoffInputs();
    const keys = getBoundaryKeys(app.gradeMode);
    for (const k of keys) {
      const el = document.getElementById(`hc-${k}`);
      if (el) el.addEventListener("input", () => persistHelper(app));
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
}

export function getHelperStateForSave(app) {
  return app.helperState || null;
}
