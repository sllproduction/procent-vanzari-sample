const MONEY_TOLERANCE = 1;
const MAX_FILE_SIZE = 8 * 1024 * 1024;

const state = {
  selectedFile: null,
  previewUrl: null,
  busyAnalyze: false,
  busySave: false,
  busySettings: false,
  detected: {
    cash_detected: null,
    card_detected: null,
    total_detected: null,
  },
  reports: [],
  calendarCursor: null,
};

const currencyFormatter = new Intl.NumberFormat("ro-RO", {
  style: "currency",
  currency: "RON",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const monthFormatter = new Intl.DateTimeFormat("ro-RO", {
  month: "long",
  year: "numeric",
});

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.dataset.page !== "app") {
    return;
  }

  initApp().catch((error) => {
    console.error(error);
    showToast("Aplicatia nu a putut porni. Reincarca pagina.", "error");
  });
});

async function initApp() {
  await requireSession();
  setDefaultDates();
  bindEvents();

  await Promise.all([loadSettings(), loadHistory(), loadMonthSummary()]);
  renderCalendar();
}

function bindEvents() {
  byId("imageInput").addEventListener("change", onImageSelected);
  byId("analyzeBtn").addEventListener("click", onAnalyzeClick);
  byId("saveForm").addEventListener("submit", onSaveSubmit);
  byId("cashInput").addEventListener("input", updateConsistencyHint);
  byId("cardInput").addEventListener("input", updateConsistencyHint);
  byId("totalInput").addEventListener("input", updateConsistencyHint);
  byId("workDate").addEventListener("change", renderCalendar);
  byId("summaryMonth").addEventListener("change", () => {
    syncCalendarToSummaryMonth();
    renderCalendar();
    loadMonthSummary().catch((error) => {
      console.error(error);
      showToast(error.message || "Nu am putut incarca rezumatul lunar.", "error");
    });
  });
  byId("calendarPrevBtn").addEventListener("click", () => {
    shiftCalendarMonth(-1).catch((error) => {
      console.error(error);
      showToast(error.message || "Nu am putut schimba luna.", "error");
    });
  });
  byId("calendarNextBtn").addEventListener("click", () => {
    shiftCalendarMonth(1).catch((error) => {
      console.error(error);
      showToast(error.message || "Nu am putut schimba luna.", "error");
    });
  });
  byId("settingsForm").addEventListener("submit", onSettingsSubmit);
  byId("logoutBtn").addEventListener("click", onLogoutClick);
}

async function requireSession() {
  const me = await apiRequest("/api/me", { method: "GET" }, { allowUnauthorized: true });
  if (!me.authenticated) {
    window.location.href = "/login";
    throw new Error("No active session");
  }
}

function setDefaultDates() {
  const today = getTodayIsoDate();
  byId("workDate").value = today;
  byId("summaryMonth").value = today.slice(0, 7);
  state.calendarCursor = parseMonthToDate(today.slice(0, 7));
}

function onImageSelected(event) {
  const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
  state.selectedFile = file;
  state.detected = { cash_detected: null, card_detected: null, total_detected: null };

  const analyzeBtn = byId("analyzeBtn");
  const preview = byId("imagePreview");
  const warnings = byId("analyzeWarnings");
  const debugBox = byId("debugBox");
  const debugText = byId("ocrDebug");

  warnings.textContent = "";
  warnings.className = "inline-msg";
  debugText.textContent = "";
  debugBox.classList.add("hidden");

  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }

  if (!file) {
    analyzeBtn.disabled = true;
    preview.classList.add("hidden");
    preview.removeAttribute("src");
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    analyzeBtn.disabled = true;
    showToast("Fisierul depaseste 8MB. Alege o imagine mai mica.", "error");
    return;
  }

  state.previewUrl = URL.createObjectURL(file);
  preview.src = state.previewUrl;
  preview.classList.remove("hidden");
  analyzeBtn.disabled = false;
}

async function onAnalyzeClick() {
  if (state.busyAnalyze) {
    return;
  }

  if (!state.selectedFile) {
    showToast("Selecteaza mai intai o imagine.", "error");
    return;
  }

  const analyzeBtn = byId("analyzeBtn");
  setButtonLoading(analyzeBtn, true, "Analizez...", "Analizeaza poza");
  state.busyAnalyze = true;

  try {
    const formData = new FormData();
    formData.append("image", state.selectedFile);

    const data = await apiRequest("/api/analyze", {
      method: "POST",
      body: formData,
    });

    state.detected = {
      cash_detected: data.cash_detected ?? null,
      card_detected: data.card_detected ?? null,
      total_detected: data.total_detected ?? null,
    };

    applyDetectedValues(data);
    renderAnalyzeInfo(data);
    updateConsistencyHint();
    showToast("Analiza OCR finalizata. Verifica valorile inainte de salvare.", "success");
  } catch (error) {
    showToast(error.message || "Analiza OCR a esuat.", "error");
  } finally {
    state.busyAnalyze = false;
    setButtonLoading(analyzeBtn, false, "Analizez...", "Analizeaza poza");
    byId("analyzeBtn").disabled = !state.selectedFile;
  }
}

function applyDetectedValues(data) {
  if (data.cash_detected !== null && data.cash_detected !== undefined) {
    byId("cashInput").value = moneyToInput(data.cash_detected);
  }
  if (data.card_detected !== null && data.card_detected !== undefined) {
    byId("cardInput").value = moneyToInput(data.card_detected);
  }
  if (data.total_detected !== null && data.total_detected !== undefined) {
    byId("totalInput").value = moneyToInput(data.total_detected);
  }
}

function renderAnalyzeInfo(data) {
  const warningsNode = byId("analyzeWarnings");
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];
  const notes = Array.isArray(data.parse_notes) ? data.parse_notes : [];

  if (warnings.length === 0) {
    warningsNode.textContent = "OCR a detectat valori. Verifica manual inainte de salvare.";
    warningsNode.className = "inline-msg good";
  } else {
    const text = [...warnings, ...notes].join(" ");
    warningsNode.textContent = text;
    warningsNode.className = "inline-msg warn";
  }

  const debugBox = byId("debugBox");
  const debugText = byId("ocrDebug");
  if (typeof data.ocr_text === "string" && data.ocr_text.trim().length > 0) {
    debugText.textContent = data.ocr_text;
    debugBox.classList.remove("hidden");
  } else {
    debugText.textContent = "";
    debugBox.classList.add("hidden");
  }
}

function updateConsistencyHint() {
  const cash = parseMoneyInput(byId("cashInput").value);
  const card = parseMoneyInput(byId("cardInput").value);
  const total = parseMoneyInput(byId("totalInput").value);
  const hint = byId("consistencyHint");

  hint.className = "inline-msg";

  if (cash === null || card === null || total === null) {
    hint.textContent = "Completeaza cash, card si total pentru verificare.";
    return;
  }

  const delta = Math.abs((cash + card) - total);
  if (delta <= MONEY_TOLERANCE) {
    hint.textContent = "OK: cash + card este apropiat de total.";
    hint.classList.add("good");
  } else {
    hint.textContent = `Atentie: diferenta este ${currencyFormatter.format(delta)} intre cash+card si total.`;
    hint.classList.add("warn");
  }
}

async function onSaveSubmit(event) {
  event.preventDefault();

  if (state.busySave) {
    return;
  }

  const workDate = byId("workDate").value;
  const cashConfirmed = parseMoneyInput(byId("cashInput").value);
  const cardConfirmed = parseMoneyInput(byId("cardInput").value);
  const totalConfirmed = parseMoneyInput(byId("totalInput").value);
  const notes = byId("notesInput").value || "";

  if (!workDate) {
    showToast("Selecteaza data.", "error");
    return;
  }
  if (cashConfirmed === null || cardConfirmed === null || totalConfirmed === null) {
    showToast("Cash, card si total sunt obligatorii.", "error");
    return;
  }

  const saveBtn = byId("saveBtn");
  setButtonLoading(saveBtn, true, "Se salveaza...", "Confirma si salveaza");
  state.busySave = true;

  try {
    const payload = {
      work_date: workDate,
      cash_confirmed: cashConfirmed,
      card_confirmed: cardConfirmed,
      total_confirmed: totalConfirmed,
      notes,
      image_filename: state.selectedFile ? state.selectedFile.name : null,
      cash_detected: state.detected.cash_detected,
      card_detected: state.detected.card_detected,
      total_detected: state.detected.total_detected,
    };

    const response = await apiRequest("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.warning) {
      showToast(`Salvat cu avertisment: ${response.warning}`, "error");
    } else {
      showToast("Raport salvat cu succes.", "success");
    }

    await Promise.all([loadHistory(), loadMonthSummary()]);
    updateConsistencyHint();
  } catch (error) {
    showToast(error.message || "Nu am putut salva raportul.", "error");
  } finally {
    state.busySave = false;
    setButtonLoading(saveBtn, false, "Se salveaza...", "Confirma si salveaza");
  }
}

async function loadHistory() {
  const data = await apiRequest("/api/history?limit=100", { method: "GET" });
  const rows = Array.isArray(data.reports) ? data.reports : [];
  state.reports = rows;
  const list = byId("historyList");

  if (rows.length === 0) {
    list.innerHTML = '<li class="history-empty">Nu exista rapoarte salvate inca.</li>';
    renderCalendar();
    return;
  }

  list.innerHTML = rows
    .map((row) => {
      const notes = row.notes ? `<p class="history-notes">${escapeHtml(row.notes)}</p>` : "";
      return `
        <li class="history-item">
          <div class="history-head">
            <strong>${escapeHtml(row.work_date || "-")}</strong>
            <span>${formatMoney(row.total_confirmed)}</span>
          </div>
          <p class="history-values">
            Cash: ${formatMoney(row.cash_confirmed)} | Card: ${formatMoney(row.card_confirmed)}
          </p>
          ${notes}
        </li>
      `;
    })
    .join("");

  renderCalendar();
}

function syncCalendarToSummaryMonth() {
  const monthValue = byId("summaryMonth").value;
  if (!isValidMonthValue(monthValue)) {
    return;
  }
  state.calendarCursor = parseMonthToDate(monthValue);
}

async function shiftCalendarMonth(delta) {
  if (!state.calendarCursor) {
    syncCalendarToSummaryMonth();
  }
  if (!state.calendarCursor) {
    state.calendarCursor = parseMonthToDate(getTodayIsoDate().slice(0, 7));
  }

  state.calendarCursor = new Date(
    state.calendarCursor.getFullYear(),
    state.calendarCursor.getMonth() + delta,
    1,
  );

  byId("summaryMonth").value = toMonthValue(state.calendarCursor);
  renderCalendar();
  await loadMonthSummary();
}

function renderCalendar() {
  const grid = byId("calendarGrid");
  const label = byId("calendarMonthLabel");
  const hint = byId("calendarHint");
  const selectedWorkDate = byId("workDate").value;
  hint.className = "inline-msg";
  hint.textContent = "Tip: apasa pe o zi pentru a completa rapid campul Data.";

  if (!state.calendarCursor) {
    syncCalendarToSummaryMonth();
  }
  if (!state.calendarCursor) {
    state.calendarCursor = parseMonthToDate(getTodayIsoDate().slice(0, 7));
  }

  const year = state.calendarCursor.getFullYear();
  const monthIndex = state.calendarCursor.getMonth();
  const monthValue = toMonthValue(state.calendarCursor);

  label.textContent = monthFormatter.format(new Date(year, monthIndex, 1));

  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const leadingBlankCells = (firstDay.getDay() + 6) % 7;
  const daysInMonth = lastDay.getDate();

  const reportsByDay = new Map();
  for (const report of state.reports) {
    if (!report?.work_date || !report.work_date.startsWith(`${monthValue}-`)) {
      continue;
    }
    const day = Number.parseInt(report.work_date.slice(8, 10), 10);
    if (!Number.isFinite(day)) {
      continue;
    }
    const existing = reportsByDay.get(day) || { count: 0, total: 0 };
    existing.count += 1;
    existing.total += Number(report.total_confirmed) || 0;
    reportsByDay.set(day, existing);
  }

  const todayIso = getTodayIsoDate();
  const cells = [];

  for (let index = 0; index < leadingBlankCells; index += 1) {
    cells.push('<span class="calendar-empty" aria-hidden="true"></span>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDate = `${monthValue}-${String(day).padStart(2, "0")}`;
    const reportInfo = reportsByDay.get(day);
    const classes = ["calendar-day"];

    if (isoDate === todayIso) {
      classes.push("today");
    }
    if (isoDate === selectedWorkDate) {
      classes.push("selected");
    }
    if (reportInfo) {
      classes.push("has-report");
    }

    cells.push(`
      <button
        type="button"
        class="${classes.join(" ")}"
        data-date="${isoDate}"
        data-count="${reportInfo ? reportInfo.count : 0}"
        data-total="${reportInfo ? roundMoney(reportInfo.total) : 0}"
        aria-label="Data ${isoDate}"
      >
        <span class="day-number">${day}</span>
        <span class="day-dot" aria-hidden="true"></span>
      </button>
    `);
  }

  const cellCount = leadingBlankCells + daysInMonth;
  const trailingBlankCells = (7 - (cellCount % 7)) % 7;
  for (let index = 0; index < trailingBlankCells; index += 1) {
    cells.push('<span class="calendar-empty" aria-hidden="true"></span>');
  }

  grid.innerHTML = cells.join("");

  grid.querySelectorAll(".calendar-day").forEach((button) => {
    button.addEventListener("click", () => {
      const date = button.dataset.date;
      const count = Number.parseInt(button.dataset.count || "0", 10);
      const total = Number.parseFloat(button.dataset.total || "0");

      byId("workDate").value = date;
      renderCalendar();

      hint.className = "inline-msg";
      if (count > 0) {
        hint.textContent = `Ai ${count} raport(e) pe ${date}. Total confirmat: ${formatMoney(total)}.`;
        hint.classList.add("good");
      } else {
        hint.textContent = `Data selectata: ${date}. Poti salva un raport nou pentru aceasta zi.`;
      }
    });
  });

}

async function loadMonthSummary() {
  const month = byId("summaryMonth").value;
  if (!month) {
    return;
  }

  const data = await apiRequest(`/api/month-summary?month=${encodeURIComponent(month)}`, {
    method: "GET",
  });

  byId("monthlyTotal").textContent = formatMoney(data.monthly_total_confirmed);
  byId("monthlyCommissionPercent").textContent = `${Number(data.commission_percent).toFixed(2)}%`;
  byId("monthlyCommissionAmount").textContent = formatMoney(data.commission_amount);
  byId("monthlyCount").textContent = String(data.count_of_days ?? 0);
}

async function loadSettings() {
  const data = await apiRequest("/api/settings", { method: "GET" });
  byId("commissionInput").value = Number(data.commission_percent).toFixed(2);
}

async function onSettingsSubmit(event) {
  event.preventDefault();
  if (state.busySettings) {
    return;
  }

  const commission = parseMoneyInput(byId("commissionInput").value);
  if (commission === null || commission <= 0 || commission > 100) {
    showToast("Comisionul trebuie sa fie intre 0.01 si 100.", "error");
    return;
  }

  const saveSettingsBtn = byId("saveSettingsBtn");
  setButtonLoading(saveSettingsBtn, true, "Se salveaza...", "Salveaza comisionul");
  state.busySettings = true;

  try {
    const response = await apiRequest("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commission_percent: commission }),
    });

    byId("commissionInput").value = Number(response.commission_percent).toFixed(2);
    await loadMonthSummary();
    showToast("Comision actualizat.", "success");
  } catch (error) {
    showToast(error.message || "Nu am putut salva comisionul.", "error");
  } finally {
    state.busySettings = false;
    setButtonLoading(saveSettingsBtn, false, "Se salveaza...", "Salveaza comisionul");
  }
}

async function onLogoutClick() {
  try {
    await apiRequest("/api/logout", { method: "POST" }, { allowUnauthorized: true });
  } catch {
    // Best effort logout.
  }
  window.location.href = "/login";
}

async function apiRequest(path, options = {}, config = {}) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error("Eroare de retea.");
  }

  const contentType = response.headers.get("content-type") || "";
  let body = null;
  if (contentType.includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }

  if (response.status === 401 && !config.allowUnauthorized) {
    window.location.href = "/login";
    throw new Error("Sesiune expirata.");
  }

  if (!response.ok) {
    throw new Error((body && body.error) || "Cerere esuata.");
  }

  return body || {};
}

function setButtonLoading(button, loading, loadingText, defaultText) {
  button.disabled = loading;
  button.textContent = loading ? loadingText : defaultText;
}

function showToast(text, type) {
  const toast = byId("toast");
  toast.textContent = text;
  toast.className = "toast";
  if (type === "error") {
    toast.classList.add("warn");
  } else if (type === "success") {
    toast.classList.add("good");
  }
  toast.classList.remove("hidden");

  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 3200);
}

function parseMoneyInput(raw) {
  if (raw === null || raw === undefined) {
    return null;
  }
  const value = String(raw).trim();
  if (!value) {
    return null;
  }
  return normalizeRomanianNumber(value);
}

function normalizeRomanianNumber(value) {
  let normalized = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!normalized || !/\d/.test(normalized)) {
    return null;
  }

  const commaCount = (normalized.match(/,/g) || []).length;
  const dotCount = (normalized.match(/\./g) || []).length;

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, "").replace(/,/g, ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (commaCount > 0) {
    if (/,\d{1,2}$/.test(normalized)) {
      normalized = normalized.replace(/,/g, ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (dotCount > 1) {
    const chunks = normalized.split(".");
    const decimalChunk = chunks.pop();
    if (decimalChunk && decimalChunk.length <= 2) {
      normalized = `${chunks.join("")}.${decimalChunk}`;
    } else {
      normalized = chunks.join("") + (decimalChunk || "");
    }
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return roundMoney(parsed);
}

function moneyToInput(value) {
  return Number(value).toFixed(2);
}

function formatMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return currencyFormatter.format(numeric);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getTodayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidMonthValue(value) {
  if (typeof value !== "string") {
    return false;
  }
  if (!/^\d{4}-\d{2}$/.test(value)) {
    return false;
  }
  const month = Number.parseInt(value.slice(5, 7), 10);
  return month >= 1 && month <= 12;
}

function parseMonthToDate(value) {
  if (!isValidMonthValue(value)) {
    return null;
  }
  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  return new Date(year, month - 1, 1);
}

function toMonthValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
