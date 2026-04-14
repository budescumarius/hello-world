const storageKey = "madibu-control-v1";

const state = JSON.parse(localStorage.getItem(storageKey) || "null") || {
  projects: [],
  timesheets: [],
  reports: [],
};

const el = {
  projectForm: document.querySelector("#projectForm"),
  costForm: document.querySelector("#costForm"),
  timesheetForm: document.querySelector("#timesheetForm"),
  reportForm: document.querySelector("#reportForm"),
  offerForm: document.querySelector("#offerForm"),
  printOffer: document.querySelector("#printOffer"),
  costProject: document.querySelector("#costProject"),
  timesheetProject: document.querySelector("#timesheetProject"),
  reportProject: document.querySelector("#reportProject"),
  projectTable: document.querySelector("#projectTable"),
  alerts: document.querySelector("#alerts"),
  offerOutput: document.querySelector("#offerOutput"),
};

const save = () => localStorage.setItem(storageKey, JSON.stringify(state));

const euro = (n) => Number(n || 0).toFixed(2);

const getProject = (id) => state.projects.find((p) => p.id === id);

function refreshProjectSelects() {
  const options = state.projects
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join("");
  [el.costProject, el.timesheetProject, el.reportProject].forEach((select) => {
    select.innerHTML = `<option value="">Selectează</option>${options}`;
  });
}

function calcTimesheetHours(projectId) {
  return state.timesheets
    .filter((t) => t.projectId === projectId)
    .reduce((acc, t) => acc + t.hours, 0);
}

function drawDashboard() {
  el.projectTable.innerHTML = "";
  el.alerts.innerHTML = "";

  state.projects.forEach((project) => {
    const laborCost = project.hours * project.hourRate;
    const totalCost = laborCost + project.materials + project.subcontractors;
    const profit = project.quotedPrice - totalCost;
    const margin = project.quotedPrice > 0 ? (profit / project.quotedPrice) * 100 : 0;
    const realHours = calcTimesheetHours(project.id);

    if (margin < project.marginThreshold) {
      const cls = margin < 25 ? "bad" : "warn";
      const msg = `Lucrarea ${project.name} este sub prag: ${margin.toFixed(1)}%`;
      el.alerts.innerHTML += `<div class="alert ${cls}">⚠️ ${msg}</div>`;
    }

    if (realHours > project.hours && project.hours > 0) {
      el.alerts.innerHTML += `<div class="alert bad">⏱️ ${project.name}: ore depășite (${realHours.toFixed(
        1
      )}/${project.hours})</div>`;
    }

    el.projectTable.innerHTML += `
      <tr>
        <td>${project.name}</td>
        <td>${euro(totalCost)}</td>
        <td>${euro(project.quotedPrice)}</td>
        <td>${euro(profit)}</td>
        <td>${margin.toFixed(1)}%</td>
        <td>${realHours.toFixed(1)}</td>
      </tr>
    `;
  });

  if (!state.projects.length) {
    el.projectTable.innerHTML = `<tr><td colspan="6">Nu există proiecte.</td></tr>`;
  }
}

el.projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const project = {
    id: crypto.randomUUID(),
    name: document.querySelector("#projectName").value.trim(),
    quotedPrice: Number(document.querySelector("#quotedPrice").value),
    marginThreshold: Number(document.querySelector("#marginThreshold").value),
    hours: 0,
    hourRate: 30,
    materials: 0,
    subcontractors: 0,
  };
  state.projects.push(project);
  save();
  refreshProjectSelects();
  drawDashboard();
  el.projectForm.reset();
});

el.costForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const project = getProject(el.costProject.value);
  if (!project) return;
  project.hours = Number(document.querySelector("#hours").value);
  project.hourRate = Number(document.querySelector("#hourRate").value);
  project.materials = Number(document.querySelector("#materials").value);
  project.subcontractors = Number(document.querySelector("#subcontractors").value);
  save();
  drawDashboard();
  el.costForm.reset();
});

el.timesheetForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const projectId = el.timesheetProject.value;
  const start = new Date(document.querySelector("#checkIn").value);
  const end = new Date(document.querySelector("#checkOut").value);
  const hours = Math.max(0, (end - start) / 3600000);
  state.timesheets.push({
    projectId,
    worker: document.querySelector("#workerName").value.trim(),
    start: start.toISOString(),
    end: end.toISOString(),
    hours,
  });
  save();
  drawDashboard();
  el.timesheetForm.reset();
});

el.reportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.reports.push({
    projectId: el.reportProject.value,
    doneToday: document.querySelector("#doneToday").value.trim(),
    issues: document.querySelector("#issues").value.trim(),
    photoUrl: document.querySelector("#photoUrl").value.trim(),
    createdAt: new Date().toISOString(),
  });
  save();
  el.reportForm.reset();
  alert("Raport salvat.");
});

el.offerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const client = document.querySelector("#clientName").value.trim();
  const title = document.querySelector("#offerTitle").value.trim();
  const hours = Number(document.querySelector("#offerHours").value);
  const rate = Number(document.querySelector("#offerRate").value);
  const materials = Number(document.querySelector("#offerMaterials").value);
  const margin = Number(document.querySelector("#offerMargin").value) / 100;

  const baseCost = hours * rate + materials;
  const total = baseCost * (1 + margin);

  el.offerOutput.textContent = `DEVIS PROFESSIONNEL\n\nClient: ${client}\nObjet: ${title}\n\nHeures: ${hours} x ${euro(
    rate
  )} € = ${euro(hours * rate)} €\nMatériaux: ${euro(materials)} €\nCoût estimé: ${euro(
    baseCost
  )} €\nMarge: ${(margin * 100).toFixed(0)}%\nTOTAL HT: ${euro(total)} €\n\nValidité: 30 jours.`;
});

el.printOffer.addEventListener("click", () => {
  if (!el.offerOutput.textContent.trim()) {
    alert("Generează întâi oferta.");
    return;
  }
  window.print();
});

refreshProjectSelects();
drawDashboard();
