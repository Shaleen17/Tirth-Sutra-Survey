const TOTAL_STEPS = 7;
const DRAFT_KEY = "tirth_sutra_survey_draft_v1";
const STEP_LABELS = {
  1: "who we are hearing from",
  2: "current spiritual content habits",
  3: "first concept resonance",
  4: "real usage intent",
  5: "trust and adoption blockers",
  6: "recommendation strength",
  7: "optional early community signup"
};
const BAR_COLORS = ["#c59b4d", "#dc8840", "#7b4d38", "#b45a39", "#e0b868", "#9f7452", "#d0956a"];

const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const progressPct = document.getElementById("progressPct");
const progressWrap = document.getElementById("progressWrap");
const liveStatusPill = document.getElementById("liveStatusPill");
const liveStatusHelp = document.getElementById("liveStatusHelp");
const sidebarSyncLabel = document.getElementById("sidebarSyncLabel");
const sidebarSyncCopy = document.getElementById("sidebarSyncCopy");

let currentStep = 1;
let eventSource = null;
let fallbackRefresh = null;

function defaultState() {
  return {
    age: "",
    loc: "",
    dev: "",
    platform: [],
    freq_curr: "",
    pain: "",
    appeal: "",
    appeal_feat: [],
    usage_intent: "",
    retention: [],
    switch: "",
    barrier: [],
    trust: [],
    pay: "",
    nps: 0,
    open: "",
    name: "",
    email: "",
    phone: "",
    extraContext: "",
    betaInterest: false,
    contactConsent: false
  };
}

let formState = defaultState();

function normalizeStepOrder() {
  const stepsWrap = document.getElementById("stepsWrap");
  const surveyCard = document.querySelector(".survey-card");
  const completionPanel = document.getElementById("completionPanel");
  [1, 2, 3, 4, 5, 6, 7].forEach((stepNumber) => {
    const step = document.getElementById("step" + stepNumber);
    if (step) stepsWrap.appendChild(step);
  });
  if (completionPanel) surveyCard.appendChild(completionPanel);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    formState = { ...defaultState(), ...JSON.parse(raw) };
  } catch (error) {
    formState = defaultState();
  }
}

function saveDraft() {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(formState));
}

function clearDraft() {
  sessionStorage.removeItem(DRAFT_KEY);
}

function setLiveStatus(mode, helpText) {
  liveStatusPill.className = "live-pill " + mode;
  sidebarSyncLabel.textContent = mode === "online" ? "Live with MongoDB" : mode === "waiting" ? "Reconnecting..." : "Sync issue";
  liveStatusPill.textContent = mode === "online" ? "Live and synced" : mode === "waiting" ? "Reconnecting..." : "Needs attention";
  liveStatusHelp.textContent = helpText;
  sidebarSyncCopy.textContent = helpText;
}

function syncChoiceButtons() {
  document.querySelectorAll(".choice-btn").forEach((button) => {
    const field = button.dataset.field;
    const value = button.dataset.value;
    const selected = Array.isArray(formState[field]) ? formState[field].includes(value) : formState[field] === value;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function buildNpsGrid() {
  const grid = document.getElementById("npsGrid");
  grid.innerHTML = "";
  for (let score = 1; score <= 10; score += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nps-btn" + (formState.nps === score ? " selected" : "");
    button.textContent = String(score);
    button.setAttribute("aria-pressed", formState.nps === score ? "true" : "false");
    button.addEventListener("click", () => {
      formState.nps = score;
      saveDraft();
      buildNpsGrid();
    });
    grid.appendChild(button);
  }
}

function updateInputsFromState() {
  document.getElementById("openText").value = formState.open || "";
  document.getElementById("nameInput").value = formState.name || "";
  document.getElementById("emailInput").value = formState.email || "";
  document.getElementById("phoneInput").value = formState.phone || "";
  document.getElementById("contextInput").value = formState.extraContext || "";
  document.getElementById("betaInterestInput").checked = Boolean(formState.betaInterest);
  document.getElementById("contactConsentInput").checked = Boolean(formState.contactConsent);
  document.querySelector('label[for="betaInterestInput"]').classList.toggle("selected", Boolean(formState.betaInterest));
  document.querySelector('label[for="contactConsentInput"]').classList.toggle("selected", Boolean(formState.contactConsent));
}

function updateProgress() {
  const pct = Math.round((currentStep / TOTAL_STEPS) * 100);
  progressFill.style.width = pct + "%";
  progressPct.textContent = pct + "%";
  progressLabel.textContent = "Step " + currentStep + " of " + TOTAL_STEPS + " - " + STEP_LABELS[currentStep];
}

function setMode(mode) {
  document.querySelectorAll(".mode-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  document.getElementById("surveyView").classList.toggle("active", mode === "survey");
  document.getElementById("dashboardView").classList.toggle("active", mode === "dashboard");
  if (mode === "dashboard") {
    fetchInsights();
  }
}

function flashValidation(id, message) {
  const el = document.getElementById(id);
  if (message) el.textContent = message;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 2800);
}

function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateStep(stepNumber) {
  if (stepNumber === 1) return Boolean(formState.age && formState.loc && formState.dev);
  if (stepNumber === 2) return formState.platform.length > 0 && Boolean(formState.freq_curr && formState.pain);
  if (stepNumber === 3) return Boolean(formState.appeal);
  if (stepNumber === 4) return Boolean(formState.usage_intent && formState.switch);
  if (stepNumber === 5) return formState.barrier.length > 0 && Boolean(formState.pay);
  if (stepNumber === 6) return formState.nps > 0;
  if (stepNumber === 7) {
    const email = formState.email.trim();
    const phone = formState.phone.trim();
    if (email && !validateEmail(email)) {
      flashValidation("validation7", "Please enter a valid email address, or leave it blank.");
      return false;
    }
    if (phone && phone.replace(/\D/g, "").length < 8) {
      flashValidation("validation7", "Please enter a fuller WhatsApp number, or leave it blank.");
      return false;
    }
    if ((email || phone) && !formState.contactConsent) {
      flashValidation("validation7", "Please allow contact if you would like the team to use your email or WhatsApp.");
      return false;
    }
  }
  return true;
}

function showStep(stepNumber) {
  document.querySelectorAll(".step").forEach((step) => step.classList.remove("active"));
  document.getElementById("step" + stepNumber).classList.add("active");
  document.getElementById("completionPanel").classList.remove("active");
  progressWrap.style.display = "";
  currentStep = stepNumber;
  updateProgress();
  document.querySelector(".survey-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function moveToNextStep(targetStep) {
  if (!validateStep(currentStep)) {
    if (currentStep !== 7) flashValidation("validation" + currentStep);
    return;
  }
  showStep(targetStep);
}

function handleChoiceSelection(button) {
  const field = button.dataset.field;
  const kind = button.dataset.kind;
  const value = button.dataset.value;
  const max = Number(button.dataset.max || 0);

  if (kind === "single") {
    formState[field] = value;
  } else {
    const currentValues = Array.isArray(formState[field]) ? [...formState[field]] : [];
    const index = currentValues.indexOf(value);
    if (index >= 0) {
      currentValues.splice(index, 1);
    } else {
      if (max > 0 && currentValues.length >= max) {
        button.animate(
          [{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }],
          { duration: 180 }
        );
        return;
      }
      currentValues.push(value);
    }
    formState[field] = currentValues;
  }

  saveDraft();
  syncChoiceButtons();
}

function attachFieldListeners() {
  document.querySelectorAll(".choice-btn").forEach((button) => {
    button.addEventListener("click", () => handleChoiceSelection(button));
  });
  document.querySelectorAll("[data-next]").forEach((button) => {
    button.addEventListener("click", () => moveToNextStep(Number(button.dataset.next)));
  });
  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => showStep(Number(button.dataset.back)));
  });
  document.querySelectorAll(".mode-btn").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
}

function buildCompletion() {
  const badges = [];
  if (formState.appeal) badges.push(formState.appeal);
  if (formState.usage_intent) badges.push(formState.usage_intent);
  if (formState.nps) badges.push("NPS " + formState.nps + "/10");
  if (formState.betaInterest) badges.push("Wants beta access");
  document.getElementById("completionBadges").innerHTML = badges.map((item) => "<span>" + escapeHtml(item) + "</span>").join("");

  const isHabitSignal = ["Multiple times a day", "Once a day"].includes(formState.usage_intent);
  document.getElementById("completionMessage").textContent = isHabitSignal
    ? "Your response has been saved, and you look like a strong early adopter. The live dashboard already reflects it."
    : "Your response has been saved. Honest answers like this are exactly what helps shape the right product.";
}

async function submitSurvey() {
  if (!validateStep(7)) return;

  const submitButton = document.getElementById("submitBtn");
  submitButton.disabled = true;
  submitButton.textContent = "Submitting...";

  try {
    const payload = {
      ...formState,
      open: formState.open.trim(),
      name: formState.name.trim(),
      email: formState.email.trim(),
      phone: formState.phone.trim(),
      extraContext: formState.extraContext.trim()
    };

    const response = await fetch("/api/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("Submission failed");
    }

    const result = await response.json();
    if (result.insights) renderDashboard(result.insights);

    clearDraft();
    buildCompletion();
    document.querySelectorAll(".step").forEach((step) => step.classList.remove("active"));
    progressWrap.style.display = "none";
    document.getElementById("completionPanel").classList.add("active");
  } catch (error) {
    flashValidation("validation7", "We could not save the response right now. Please try again in a moment.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit feedback";
  }
}

function resetSurvey() {
  formState = defaultState();
  clearDraft();
  syncChoiceButtons();
  buildNpsGrid();
  updateInputsFromState();
  showStep(1);
  setMode("survey");
}

async function shareSurveyLink() {
  const shareUrl = window.location.href;
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Tirth Sutra Founding Survey",
        text: "Share your feedback on the Tirth Sutra community idea.",
        url: shareUrl
      });
      return;
    } catch (error) {
      // Fall through to clipboard.
    }
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    const button = document.getElementById("shareSurveyBtn");
    button.textContent = "Link copied";
    setTimeout(() => {
      button.textContent = "Share survey link";
    }, 1800);
  } catch (error) {
    window.prompt("Copy this link:", shareUrl);
  }
}

function formatPercent(value) {
  return typeof value === "number" && Number.isFinite(value) ? value + "%" : "-";
}

function formatMetric(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function formatDateTime(value) {
  if (!value) return "Waiting for data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waiting for data";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function renderBarList(targetId, entries) {
  const target = document.getElementById(targetId);
  if (!entries || entries.length === 0) {
    target.innerHTML = '<div class="empty-state">No responses for this section yet.</div>';
    return;
  }

  const maxCount = Math.max(...entries.map((entry) => entry.count));
  target.innerHTML = entries.map((entry, index) => {
    const width = maxCount > 0 ? Math.round((entry.count / maxCount) * 100) : 0;
    const color = BAR_COLORS[index % BAR_COLORS.length];
    return `
      <div class="bar-item">
        <div class="bar-meta">
          <strong>${escapeHtml(entry.label)}</strong>
          <span>${entry.count} · ${entry.pct}%</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%;background:linear-gradient(90deg, ${color}, #f0d3a0)"></div>
        </div>
      </div>
    `;
  }).join("");
}

function renderCommentList(comments) {
  const target = document.getElementById("commentList");
  if (!comments || comments.length === 0) {
    target.innerHTML = '<div class="empty-state">No open text feedback yet.</div>';
    return;
  }

  target.innerHTML = comments.map((comment) => `
    <article class="comment-card">
      <p>${escapeHtml(comment.text)}</p>
      <footer>
        ${comment.usageIntent ? `<span class="comment-pill">${escapeHtml(comment.usageIntent)}</span>` : ""}
        ${comment.location ? `<span class="comment-pill">${escapeHtml(comment.location)}</span>` : ""}
        <span>${escapeHtml(formatDateTime(comment.createdAt))}</span>
      </footer>
    </article>
  `).join("");
}

function renderDashboard(insights) {
  if (!insights) return;
  document.getElementById("metricTotal").textContent = formatMetric(insights.totalResponses);
  document.getElementById("metricNps").textContent = formatMetric(insights.metrics.npsScore);
  document.getElementById("metricDaily").textContent = formatPercent(insights.metrics.dailyUsagePct);
  document.getElementById("metricAppeal").textContent = formatPercent(insights.metrics.strongAppealPct);
  document.getElementById("metricBeta").textContent = formatPercent(insights.metrics.betaInterestPct);

  document.getElementById("dDetractors").textContent = formatPercent(insights.metrics.detractorPct);
  document.getElementById("dPassives").textContent = formatPercent(insights.metrics.passivePct);
  document.getElementById("dPromoters").textContent = formatPercent(insights.metrics.promoterPct);
  document.getElementById("dScore").textContent = formatMetric(insights.metrics.npsScore);
  document.getElementById("dashUpdatedAt").textContent = "Updated " + formatDateTime(insights.updatedAt);

  renderBarList("usageBars", insights.sections.usageIntent);
  renderBarList("appealBars", insights.sections.appeal);
  renderBarList("featureBars", insights.sections.appealFeatures);
  renderBarList("retentionBars", insights.sections.retention);
  renderBarList("barrierBars", insights.sections.barrier);
  renderBarList("trustBars", insights.sections.trust);
  renderBarList("switchBars", insights.sections.switchIntent);
  renderBarList("payBars", insights.sections.paymentIntent);
  renderBarList("ageBars", insights.sections.age);
  renderBarList("devotionBars", insights.sections.devotion);
  renderCommentList(insights.comments);
}

async function fetchInsights() {
  try {
    const response = await fetch("/api/insights", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Failed to fetch insights");
    renderDashboard(await response.json());
    setLiveStatus("online", "Live dashboard sync is active. New submissions should appear automatically.");
  } catch (error) {
    setLiveStatus("offline", "The dashboard could not fetch fresh data right now. Check the server or MongoDB connection.");
  }
}

function connectLiveUpdates() {
  if (eventSource) eventSource.close();

  setLiveStatus("waiting", "Opening a live connection for real-time dashboard updates.");
  eventSource = new EventSource("/api/stream");

  eventSource.addEventListener("open", () => {
    setLiveStatus("online", "Live dashboard sync is active. New submissions should appear automatically.");
  });

  eventSource.addEventListener("insights", (event) => {
    try {
      renderDashboard(JSON.parse(event.data));
      setLiveStatus("online", "Live dashboard sync is active. New submissions should appear automatically.");
    } catch (error) {
      setLiveStatus("waiting", "A live update arrived but could not be parsed. Background refresh will continue.");
    }
  });

  eventSource.onerror = () => {
    setLiveStatus("waiting", "The live channel dropped. We are retrying and polling as backup.");
  };

  if (fallbackRefresh) clearInterval(fallbackRefresh);
  fallbackRefresh = setInterval(fetchInsights, 30000);
}

function hydrateFromDraft() {
  readDraft();
  syncChoiceButtons();
  buildNpsGrid();
  updateInputsFromState();
  updateProgress();
}

function attachValueListeners() {
  document.getElementById("openText").addEventListener("input", (event) => {
    formState.open = event.target.value.slice(0, 1200);
    saveDraft();
  });
  document.getElementById("nameInput").addEventListener("input", (event) => {
    formState.name = event.target.value.slice(0, 80);
    saveDraft();
  });
  document.getElementById("emailInput").addEventListener("input", (event) => {
    formState.email = event.target.value.slice(0, 160);
    saveDraft();
  });
  document.getElementById("phoneInput").addEventListener("input", (event) => {
    formState.phone = event.target.value.slice(0, 32);
    saveDraft();
  });
  document.getElementById("contextInput").addEventListener("input", (event) => {
    formState.extraContext = event.target.value.slice(0, 120);
    saveDraft();
  });
  document.getElementById("betaInterestInput").addEventListener("change", (event) => {
    formState.betaInterest = event.target.checked;
    document.querySelector('label[for="betaInterestInput"]').classList.toggle("selected", event.target.checked);
    saveDraft();
  });
  document.getElementById("contactConsentInput").addEventListener("change", (event) => {
    formState.contactConsent = event.target.checked;
    document.querySelector('label[for="contactConsentInput"]').classList.toggle("selected", event.target.checked);
    saveDraft();
  });

  document.getElementById("submitBtn").addEventListener("click", submitSurvey);
  document.getElementById("refreshDashboardBtn").addEventListener("click", fetchInsights);
  document.getElementById("backToSurveyBtn").addEventListener("click", () => setMode("survey"));
  document.getElementById("openDashboardBtn").addEventListener("click", () => setMode("dashboard"));
  document.getElementById("jumpToDashboardBtn").addEventListener("click", () => setMode("dashboard"));
  document.getElementById("shareSurveyBtn").addEventListener("click", shareSurveyLink);
  document.getElementById("resetSurveyBtn").addEventListener("click", resetSurvey);
}

attachFieldListeners();
attachValueListeners();
normalizeStepOrder();
hydrateFromDraft();
fetchInsights();
connectLiveUpdates();

window.addEventListener("beforeunload", () => {
  if (eventSource) eventSource.close();
  if (fallbackRefresh) clearInterval(fallbackRefresh);
});
