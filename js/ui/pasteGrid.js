const DEFAULT_CLASS_COLS = 10;
const DEFAULT_STUDENT_ROWS = 28;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function textToGridRows(text) {
  if (!text?.trim()) return [];
  return text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => line.split(/\t/).map((c) => c.trim()));
}

export function gridRowsToText(rows) {
  if (!rows?.length) return "";
  let maxCols = 0;
  for (const row of rows) {
    maxCols = Math.max(maxCols, row.length);
  }

  let lastRow = rows.length - 1;
  while (lastRow > 0) {
    const row = rows[lastRow];
    if (row.some((c, i) => i > 0 && String(c ?? "").trim() !== "")) break;
    lastRow--;
  }

  let lastCol = maxCols - 1;
  while (lastCol > 0) {
    let hasData = false;
    for (let r = 0; r <= lastRow; r++) {
      if (String(rows[r]?.[lastCol] ?? "").trim() !== "") {
        hasData = true;
        break;
      }
    }
    if (hasData) break;
    lastCol--;
  }

  return rows
    .slice(0, lastRow + 1)
    .map((row) => {
      const cells = [];
      for (let c = 0; c <= lastCol; c++) {
        cells.push(row[c] ?? "");
      }
      return cells.join("\t");
    })
    .join("\n");
}

function buildEmptyGrid(classCols, studentRows) {
  const header = ["반번호", ...Array.from({ length: classCols }, (_, i) => String(i + 1))];
  const body = Array.from({ length: studentRows }, (_, i) => [
    String(i + 1),
    ...Array(classCols).fill(""),
  ]);
  return [header, ...body];
}

function normalizeGridRows(rows, minClassCols, minStudentRows) {
  if (!rows.length) {
    return buildEmptyGrid(minClassCols, minStudentRows);
  }

  const classCols = Math.max(minClassCols, rows[0].length - 1);
  const studentRows = Math.max(minStudentRows, rows.length - 1);
  const header = rows[0];
  const corner = header[0] || "반번호";
  const classHeaders = Array.from({ length: classCols }, (_, i) => header[i + 1] ?? String(i + 1));

  const out = [[corner, ...classHeaders]];

  for (let r = 0; r < studentRows; r++) {
    const src = rows[r + 1] || [];
    const rowNum = src[0] || String(r + 1);
    const data = Array.from({ length: classCols }, (_, c) => src[c + 1] ?? "");
    out.push([rowNum, ...data]);
  }

  return out;
}

function renderPasteGrid(host, rows) {
  const classCols = rows[0].length - 1;
  const headerCells = rows[0]
    .map(
      (cell, c) =>
        `<th class="${c === 0 ? "paste-grid-corner" : "paste-grid-col-head"}">${escapeHtml(cell)}</th>`
    )
    .join("");

  const bodyRows = rows
    .slice(1)
    .map((row, ri) => {
      const rowHead = `<th class="paste-grid-row-head">${escapeHtml(row[0])}</th>`;
      const cells = row
        .slice(1)
        .map(
          (cell, ci) =>
            `<td><input type="text" class="paste-grid-cell" data-r="${ri + 1}" data-c="${ci + 1}" value="${escapeHtml(cell)}" spellcheck="false" autocomplete="off"></td>`
        )
        .join("");
      return `<tr>${rowHead}${cells}</tr>`;
    })
    .join("");

  host.innerHTML = `
    <div class="paste-grid-scroll">
      <table class="paste-grid-table" role="grid" aria-label="성적 붙여넣기">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <p class="paste-grid-hint">NEIS 「XLS data」 파일을 엑셀에서 연 뒤 범위를 복사해 표 안 아무 셀이나 선택하고 <kbd>Ctrl+V</kbd> 하세요. 직접 입력도 가능합니다.</p>`;
}

function readGridFromHost(host) {
  const table = host.querySelector(".paste-grid-table");
  if (!table) return [];

  const header = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent.trim());
  const rows = [header];

  table.querySelectorAll("tbody tr").forEach((tr) => {
    const rowHead = tr.querySelector(".paste-grid-row-head")?.textContent.trim() ?? "";
    const inputs = tr.querySelectorAll(".paste-grid-cell");
    rows.push([rowHead, ...Array.from(inputs, (inp) => inp.value.trim())]);
  });

  return rows;
}

function bindPasteGridEvents(host, api) {
  if (host.dataset.pasteBound) return;
  host.dataset.pasteBound = "1";
  host.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain");
    if (!text?.trim()) return;
    e.preventDefault();
    api.setText(text);
  });

  host.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      const input = e.target;
      if (!input.classList?.contains("paste-grid-cell")) return;
      e.preventDefault();
      const tr = input.closest("tr");
      const next = tr?.nextElementSibling?.querySelector(
        `.paste-grid-cell[data-c="${input.dataset.c}"]`
      );
      next?.focus();
      next?.select();
    }
  });
}

/**
 * @param {HTMLElement} host
 * @param {{ initialText?: string, classCols?: number, studentRows?: number }} options
 */
export function initPasteGridElement(host, options = {}) {
  if (!host) return null;

  const minClassCols = options.classCols ?? DEFAULT_CLASS_COLS;
  const minStudentRows = options.studentRows ?? DEFAULT_STUDENT_ROWS;

  const api = {
    getText() {
      return gridRowsToText(readGridFromHost(host));
    },
    setText(text) {
      const parsed = textToGridRows(text);
      const rows = normalizeGridRows(parsed, minClassCols, minStudentRows);
      renderPasteGrid(host, rows);
      bindPasteGridEvents(host, api);
    },
    focus() {
      host.querySelector(".paste-grid-cell")?.focus();
    },
  };

  const initial = options.initialText?.trim()
    ? options.initialText
    : gridRowsToText(buildEmptyGrid(minClassCols, minStudentRows));

  api.setText(initial);
  host._pasteGrid = api;
  return api;
}

export function getPasteGridText(hostOrId) {
  const host = typeof hostOrId === "string" ? document.getElementById(hostOrId) : hostOrId;
  return host?._pasteGrid?.getText() ?? "";
}

export function setPasteGridText(hostOrId, text) {
  const host = typeof hostOrId === "string" ? document.getElementById(hostOrId) : hostOrId;
  host?._pasteGrid?.setText(text);
}
