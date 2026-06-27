import { GRADE_MODE_FIVE, GRADE_MODE_SIX } from "./core/grades.js";
import { saveAppState, loadAppState } from "./io/export.js";
import { defaultComponentConfig, migrateWeightsToConfig, normalizeComponentConfig } from "./core/cutoffs.js";
import { initBasic } from "./features/basic.js";
import { initExamHelper } from "./features/examHelper.js";
import { initExam2Tuner } from "./features/exam2Tuner.js";
import { initStudentPredict } from "./features/studentPredict.js";

const app = {
  gradeMode: GRADE_MODE_FIVE,
  finalCutoffs: null,
  componentConfig: defaultComponentConfig(),
  perfMaxLocked: false,
  components: null,
  basicState: null,
  helperState: null,
  semesterState: null,
  studentState: null,
  gradeModeCallbacks: [],
  stateChangeCallbacks: [],
  notifyStateChange: null,
};

app.registerGradeModeChange = (fn) => {
  app.gradeModeCallbacks.push(fn);
};

app.registerStateChange = (fn) => {
  app.stateChangeCallbacks.push(fn);
};

app.notifyStateChange = () => {
  app.stateChangeCallbacks.forEach((fn) => fn());
};

function persist() {
  const state = {
    gradeMode: app.gradeMode,
    basicState: app.basicState,
    helperState: app.helperState,
    semesterState: app.semesterState,
    studentState: app.studentState,
    finalCutoffs: app.finalCutoffs,
    componentConfig: app.componentConfig,
    perfMaxLocked: app.perfMaxLocked,
    components: app.components,
    activeTab: document.querySelector(".tab-btn.active")?.dataset.tab || "basic",
  };
  saveAppState(state);
}

app.persist = persist;

function restore() {
  const saved = loadAppState();
  if (!saved) return;

  app.gradeMode = saved.gradeMode || GRADE_MODE_FIVE;
  app.basicState = saved.basicState;
  app.helperState = saved.helperState;
  app.semesterState = saved.semesterState || saved.tunerState;
  app.studentState = saved.studentState;
  app.finalCutoffs = saved.finalCutoffs;
  app.components = saved.components;
  app.perfMaxLocked = saved.perfMaxLocked ?? false;

  if (saved.componentConfig) {
    app.componentConfig = normalizeComponentConfig(saved.componentConfig);
  } else if (saved.basicState?.componentConfig) {
    app.componentConfig = normalizeComponentConfig(saved.basicState.componentConfig);
  } else if (saved.weights || saved.basicState?.weights) {
    app.componentConfig = migrateWeightsToConfig(saved.weights || saved.basicState.weights);
  }

  document.querySelectorAll('input[name="grade-mode"]').forEach((el) => {
    el.checked = el.value === app.gradeMode;
  });

  if (saved.activeTab) {
    switchTab(saved.activeTab);
  }

  app.refreshBasicUI?.();
  app.gradeModeCallbacks.forEach((fn) => fn());
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${tabId}`);
  });
  persist();
}

function onGradeModeChange(mode) {
  app.gradeMode = mode;
  app.gradeModeCallbacks.forEach((fn) => fn());
  persist();
}

document.querySelectorAll('input[name="grade-mode"]').forEach((el) => {
  el.addEventListener("change", () => {
    if (el.checked) onGradeModeChange(el.value);
  });
});

initBasic(app);
initExamHelper(app);
initExam2Tuner(app);
initStudentPredict(app);

restore();

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

app.switchTab = switchTab;
window.__cutoffApp = app;
