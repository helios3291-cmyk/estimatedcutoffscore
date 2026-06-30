import { GRADE_MODE_FIVE, GRADE_MODE_SIX } from "./core/grades.js";
import { getAppReadiness, readinessBarHtml } from "./core/readiness.js";
import {
  saveAppState,
  loadAppState,
  clearAllStorage,
  loadProfiles,
  upsertProfile,
  deleteProfile,
} from "./io/export.js";
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

function updateReadinessBar() {
  const el = document.getElementById("app-readiness");
  if (!el) return;
  el.innerHTML = readinessBarHtml(getAppReadiness(app));
}

app.registerStateChange(updateReadinessBar);

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

const STUDENT_STATE_KEYS = new Set([
  "exam1Students",
  "exam1Paste",
  "perfStudentsByArea",
  "perfPastes",
  "exam2ActualStudents",
  "exam2ActualPaste",
]);

function clearStudentDataInSemesterState(semesterState) {
  const next = { ...(semesterState || {}) };
  next.exam1Students = [];
  next.exam1Paste = "";
  next.perfStudentsByArea = [];
  next.perfPastes = [];
  next.exam2ActualStudents = [];
  next.exam2ActualPaste = "";

  // derived caches
  delete next.lastRatios;
  delete next.lastResult;
  return next;
}

function buildProfileStateFromApp(app) {
  const semester = { ...(app.semesterState || {}) };
  for (const k of STUDENT_STATE_KEYS) delete semester[k];

  return {
    gradeMode: app.gradeMode,
    componentConfig: app.componentConfig,
    perfMaxLocked: app.perfMaxLocked,
    basicState: app.basicState,
    helperState: app.helperState,
    finalCutoffs: app.finalCutoffs,
    studentState: app.studentState, // includes individual inputs; student dataset is stored in semesterState, so ok
    semesterState: semester,
  };
}

function applyProfileStateToApp(app, profileState) {
  if (!profileState) return { ok: false, error: "프로필 데이터가 비어 있습니다." };

  app.gradeMode = profileState.gradeMode || app.gradeMode;
  app.componentConfig = profileState.componentConfig || app.componentConfig;
  app.perfMaxLocked = profileState.perfMaxLocked ?? app.perfMaxLocked;
  app.basicState = profileState.basicState ?? app.basicState;
  app.helperState = profileState.helperState ?? app.helperState;
  app.finalCutoffs = profileState.finalCutoffs ?? app.finalCutoffs;
  app.studentState = profileState.studentState ?? app.studentState;

  app.semesterState = {
    ...(app.semesterState || {}),
    ...(profileState.semesterState || {}),
  };

  document.querySelectorAll('input[name="grade-mode"]').forEach((el) => {
    el.checked = el.value === app.gradeMode;
  });

  app.refreshBasicUI?.();
  app.gradeModeCallbacks.forEach((fn) => fn());
  app.refreshSemesterPasteUI?.();
  app.notifyStateChange?.();
  persist();
  return { ok: true };
}

function buildGuideHtml() {
  return `
    <div class="guide-section">
      <h3>학생 성적 데이터 입력</h3>
      <ul class="guide-steps">
        <li>NEIS에서 학생 성적을 <strong>「XLS data」</strong>로 다운로드한 뒤, 엑셀에서 해당 시트 범위를 복사해 3·4번 탭 붙여넣기 표에 넣습니다.</li>
      </ul>
    </div>

    <div class="guide-section">
      <h3>저장 안내</h3>
      <ul class="guide-steps">
        <li>이 도구의 저장은 <strong>브라우저 로컬 저장소(localStorage/sessionStorage)</strong>에만 저장됩니다.</li>
        <li>학생 데이터 포함 모든 값은 <strong>서버로 전송·저장되지 않습니다</strong> (브라우저를 바꾸거나 저장소를 삭제하면 사라질 수 있습니다).</li>
      </ul>
    </div>

    <div class="guide-section">
      <h3>정기시험1 실시 전</h3>
      <ol class="guide-steps">
        <li>1. 기본 탭에서 <strong>요소별 반영비율·만점</strong>을 입력합니다.</li>
        <li>2. 정기시험별 추정분할점수 산출 탭에서 <strong>정기시험1</strong>의 예상 통과율(성취도별·난이도별)을 확인합니다.</li>
      </ol>
      <div class="guide-flow">1. 기본 → 2. 정기시험별 추정분할점수 산출</div>
    </div>

    <div class="guide-section">
      <h3>정기시험1 완료 후</h3>
      <ol class="guide-steps">
        <li>3. 학생 성적 기반 정기시험2 준비 탭에서 <strong>정기시험1 학생 데이터</strong>를 입력하고 「정기시험1 데이터 반영」합니다.</li>
        <li>정기시험1 결과 분석(성취도별 비율 등)을 확인합니다.</li>
      </ol>
      <div class="guide-flow">3. 학생 성적 기반 정기시험2 준비(정기1) → 분석</div>
    </div>

    <div class="guide-section">
      <h3>정기시험1 및 수행평가 완료 후</h3>
      <ol class="guide-steps">
        <li>3번 탭에서 <strong>수행평가 학생 데이터</strong>까지 입력하고 「수행평가 데이터 반영」합니다.</li>
        <li>정기시험1+수행 결과 분석을 확인합니다.</li>
      </ol>
      <div class="guide-flow">3. 학생 성적 기반 정기시험2 준비(정기1+수행) → 분석</div>
    </div>

    <div class="guide-section">
      <h3>정기시험2 실시 전</h3>
      <ol class="guide-steps">
        <li>3번 탭에서 목표 학기말 성취도별 비율을 입력하고 <strong>정기시험2 추정 분할점수 초안</strong>을 산출합니다.</li>
        <li>필요 시 초안을 1. 기본 탭에 적용해 시뮬레이션합니다.</li>
      </ol>
      <div class="guide-flow">3. 목표비율 입력 → 정기2 초안 산출 → (선택) 1. 기본에 적용</div>
    </div>

    <div class="guide-section">
      <h3>정기시험2 실시 완료 후</h3>
      <ol class="guide-steps">
        <li>4. 학기말 성적 분석 탭에서 <strong>실제 정기시험2 학생 데이터</strong>를 입력하고 「데이터 반영」합니다.</li>
        <li>같은 탭에서 <strong>전체 학생 학기말 성적 예측</strong>을 실행합니다.</li>
      </ol>
      <div class="guide-flow">4. 학기말 성적 분석(정기2) → 전체 학생 학기말 성적 예측</div>
    </div>
  `;
}

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
  app.refreshSemesterPasteUI?.();
  app.gradeModeCallbacks.forEach((fn) => fn());
  updateReadinessBar();
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
  updateReadinessBar();
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

updateReadinessBar();

restore();

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function bindUtilityBar() {
  const btnResetAll = document.getElementById("btn-reset-all");
  const btnResetStudents = document.getElementById("btn-reset-students");
  const btnSave = document.getElementById("btn-profile-save");
  const btnLoad = document.getElementById("btn-profile-load");
  const btnDelete = document.getElementById("btn-profile-manage");
  const btnOpenGuide = document.getElementById("btn-open-guide");
  const btnCloseGuide = document.getElementById("btn-close-guide");
  const guideModal = document.getElementById("guide-modal");
  const guideContent = document.getElementById("guide-content");

  if (guideContent) guideContent.innerHTML = buildGuideHtml();

  if (btnOpenGuide && guideModal) {
    btnOpenGuide.addEventListener("click", () => {
      guideModal.hidden = false;
    });
  }
  if (btnCloseGuide && guideModal) {
    btnCloseGuide.addEventListener("click", () => {
      guideModal.hidden = true;
    });
  }
  if (guideModal) {
    guideModal.addEventListener("click", (e) => {
      if (e.target === guideModal) guideModal.hidden = true;
    });
  }

  if (btnResetAll) {
    btnResetAll.addEventListener("click", () => {
      const ok = confirm(
        "전체 초기화를 실행할까요?\n- 학생 데이터 포함 모든 입력/설정/저장값이 삭제됩니다.\n- 저장된 프로필은 유지됩니다.\n- 브라우저 로컬 저장소에서 삭제되며 되돌릴 수 없습니다."
      );
      if (!ok) return;
      clearAllStorage();
      location.reload();
    });
  }

  if (btnResetStudents) {
    btnResetStudents.addEventListener("click", () => {
      const ok = confirm(
        "학생 데이터만 초기화할까요?\n- 정기1/수행/정기2 실제 학생 데이터(붙여넣기 포함)만 삭제됩니다.\n- 설정/분할점수/프로필은 유지됩니다."
      );
      if (!ok) return;
      app.semesterState = clearStudentDataInSemesterState(app.semesterState);
      persist();
      app.refreshSemesterPasteUI?.();
      app.notifyStateChange?.();
      alert("학생 데이터가 초기화되었습니다.");
    });
  }

  function listProfileNames() {
    const doc = loadProfiles();
    return (doc.profiles || []).map((p) => p.name).filter(Boolean);
  }

  if (btnSave) {
    btnSave.addEventListener("click", () => {
      const name = prompt("저장할 프로필 이름을 입력해 주세요.");
      if (name == null) return;
      const trimmed = String(name).trim();
      if (!trimmed) {
        alert("프로필 이름이 비어 있습니다.");
        return;
      }

      const names = listProfileNames();
      if (names.includes(trimmed)) {
        const ok = confirm(`\"${trimmed}\" 프로필이 이미 있습니다. 덮어쓸까요?`);
        if (!ok) return;
      }

      const profileState = buildProfileStateFromApp(app);
      const res = upsertProfile(trimmed, profileState);
      if (!res.ok) {
        alert(res.error || "프로필 저장에 실패했습니다.");
        return;
      }
      alert(`프로필이 저장되었습니다: ${trimmed}`);
    });
  }

  if (btnLoad) {
    btnLoad.addEventListener("click", () => {
      const names = listProfileNames();
      if (!names.length) {
        alert("저장된 프로필이 없습니다.");
        return;
      }
      const selected = prompt(`불러올 프로필 이름을 입력해 주세요.\n\n- ${names.join("\n- ")}`);
      if (selected == null) return;

      const doc = loadProfiles();
      const profile = (doc.profiles || []).find((p) => p?.name === String(selected).trim());
      if (!profile) {
        alert("해당 이름의 프로필을 찾지 못했습니다.");
        return;
      }

      const ok = confirm(
        `\"${profile.name}\" 프로필을 불러올까요?\n(학생 데이터는 변경되지 않으며, 설정/분할점수/입력값이 덮어써집니다.)`
      );
      if (!ok) return;

      const res = applyProfileStateToApp(app, profile.state);
      if (!res.ok) {
        alert(res.error || "프로필 적용에 실패했습니다.");
        return;
      }
      alert(`프로필을 불러왔습니다: ${profile.name}`);
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener("click", () => {
      const names = listProfileNames();
      if (!names.length) {
        alert("삭제할 프로필이 없습니다.");
        return;
      }
      const selected = prompt(`삭제할 프로필 이름을 입력해 주세요.\n\n- ${names.join("\n- ")}`);
      if (selected == null) return;
      const name = String(selected).trim();
      if (!name) return;
      const ok = confirm(`\"${name}\" 프로필을 삭제할까요? (되돌릴 수 없습니다)`);
      if (!ok) return;
      const res = deleteProfile(name);
      if (!res.ok) {
        alert(res.error || "프로필 삭제에 실패했습니다.");
        return;
      }
      alert(`프로필을 삭제했습니다: ${name}`);
    });
  }
}

bindUtilityBar();

app.switchTab = switchTab;
window.__cutoffApp = app;
