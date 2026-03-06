const form = document.getElementById("calculator-form");
const monthInput = document.getElementById("month");
const salesInput = document.getElementById("sales");
const percentInput = document.getElementById("percent");
const advanceInput = document.getElementById("advance");
const clearBtn = document.getElementById("clear-btn");

const summary = document.getElementById("summary");
const commissionEl = document.getElementById("commission");
const advanceEl = document.getElementById("advance-view");
const payoutEl = document.getElementById("payout");
const noteEl = document.getElementById("note");

const ronFormatter = new Intl.NumberFormat("ro-RO", {
  style: "currency",
  currency: "RON",
  minimumFractionDigits: 2,
});

function formatMonth(isoMonth) {
  if (!isoMonth) return "-";
  const [year, month] = isoMonth.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat("ro-RO", { month: "long", year: "numeric" }).format(date);
}

function numberValue(input) {
  return Number.parseFloat(input.value || "0");
}

function setDefaultMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  monthInput.value = `${y}-${m}`;
}

function resetResult() {
  summary.textContent = 'Completeaza campurile si apasa "Calculeaza".';
  commissionEl.textContent = "-";
  advanceEl.textContent = "-";
  payoutEl.textContent = "-";
  noteEl.textContent = "";
  noteEl.className = "note";
}

function renderResult(month, commission, advance, payout) {
  summary.textContent = `Pentru ${formatMonth(month)} la vanzari totale de ${ronFormatter.format(numberValue(salesInput))} si procent ${percentInput.value}%`;
  commissionEl.textContent = ronFormatter.format(commission);
  advanceEl.textContent = ronFormatter.format(advance);
  payoutEl.textContent = ronFormatter.format(payout);

  noteEl.className = "note";
  if (payout >= 0) {
    noteEl.textContent = "Calcul finalizat. Suma este pozitiva pentru plata de final de luna.";
    noteEl.classList.add("good");
  } else {
    noteEl.textContent = "Atentie: avansul depaseste comisionul calculat.";
    noteEl.classList.add("warn");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const sales = numberValue(salesInput);
  const percent = numberValue(percentInput);
  const advance = numberValue(advanceInput);

  if (sales < 0 || percent < 0 || advance < 0) {
    noteEl.textContent = "Valorile trebuie sa fie pozitive.";
    noteEl.className = "note warn";
    return;
  }

  const commission = (sales * percent) / 100;
  const payout = commission - advance;

  renderResult(monthInput.value, commission, advance, payout);
});

clearBtn.addEventListener("click", () => {
  form.reset();
  setDefaultMonth();
  advanceInput.value = "0";
  resetResult();
});

setDefaultMonth();
resetResult();
