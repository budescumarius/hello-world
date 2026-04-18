import { useMemo, useState } from "react";
import "./app.css";

const HOURLY_RATE = 35;

const initialProjects = [
  {
    id: "p1",
    name: "Ixelles - Lepoutre 15",
    client: "Claude et Olivier Bringer",
    quotedPrice: 85000,
    estimatedHours: 700,
    targetMargin: 30,
    status: "active",
  },
];

const initialTimeEntries = [
  { id: "t1", projectId: "p1", workerName: "Marius", date: "2026-04-13", startTime: "08:00", endTime: "16:30", breakMinutes: 30 },
];

const initialCosts = [
  { id: "c1", projectId: "p1", category: "materials", supplier: "BigMat", amount: 9200, date: "2026-04-10" },
];

const euro = (v) => new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(v || 0));

const hoursBetween = (startTime, endTime, breakMinutes = 0) => {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const total = eh * 60 + em - (sh * 60 + sm) - Number(breakMinutes || 0);
  return Math.max(0, Math.round((total / 60) * 100) / 100);
};

export default function App() {
  const [projects, setProjects] = useState(initialProjects);
  const [timeEntries, setTimeEntries] = useState(initialTimeEntries);
  const [costEntries, setCostEntries] = useState(initialCosts);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjects[0]?.id || "");

  const [newProject, setNewProject] = useState({ name: "", client: "", quotedPrice: "", estimatedHours: "", targetMargin: 30, status: "active" });
  const [newTime, setNewTime] = useState({ projectId: selectedProjectId, workerName: "", date: "", startTime: "08:00", endTime: "16:00", breakMinutes: 30 });
  const [newCost, setNewCost] = useState({ projectId: selectedProjectId, category: "materials", supplier: "", amount: "", date: "" });

  const metrics = useMemo(() => projects.map((project) => {
    const entries = timeEntries.filter((t) => t.projectId === project.id);
    const costs = costEntries.filter((c) => c.projectId === project.id);
    const totalHours = entries.reduce((s, e) => s + hoursBetween(e.startTime, e.endTime, e.breakMinutes), 0);
    const laborCost = totalHours * HOURLY_RATE;
    const directCosts = costs.reduce((s, c) => s + Number(c.amount || 0), 0);
    const totalCost = laborCost + directCosts;
    const quoted = Number(project.quotedPrice || 0);
    const profit = quoted - totalCost;
    const margin = quoted > 0 ? (profit / quoted) * 100 : 0;
    return { ...project, totalHours, totalCost, profit, margin, risk: margin < 25 ? "high" : margin < Number(project.targetMargin) ? "medium" : "low" };
  }), [projects, timeEntries, costEntries]);

  const selected = metrics.find((p) => p.id === selectedProjectId) || metrics[0];

  const addProject = () => {
    if (!newProject.name || !newProject.quotedPrice) return;
    const item = { ...newProject, id: crypto.randomUUID(), quotedPrice: Number(newProject.quotedPrice), estimatedHours: Number(newProject.estimatedHours || 0), targetMargin: Number(newProject.targetMargin || 30) };
    setProjects((p) => [item, ...p]);
    setSelectedProjectId(item.id);
    setNewProject({ name: "", client: "", quotedPrice: "", estimatedHours: "", targetMargin: 30, status: "active" });
  };

  const addTime = () => {
    if (!newTime.projectId || !newTime.workerName || !newTime.date) return;
    setTimeEntries((p) => [{ id: crypto.randomUUID(), ...newTime }, ...p]);
    setNewTime({ projectId: selectedProjectId, workerName: "", date: "", startTime: "08:00", endTime: "16:00", breakMinutes: 30 });
  };

  const addCost = () => {
    if (!newCost.projectId || !newCost.amount || !newCost.date) return;
    setCostEntries((p) => [{ id: crypto.randomUUID(), ...newCost, amount: Number(newCost.amount) }, ...p]);
    setNewCost({ projectId: selectedProjectId, category: "materials", supplier: "", amount: "", date: "" });
  };

  return (
    <main className="wrap">
      <h1>MADIBU Control — React model</h1>
      <section className="grid">
        <article className="card">
          <h2>Proiecte</h2>
          <input placeholder="Nume proiect" value={newProject.name} onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} />
          <input placeholder="Client" value={newProject.client} onChange={(e) => setNewProject({ ...newProject, client: e.target.value })} />
          <input type="number" placeholder="Valoare ofertată" value={newProject.quotedPrice} onChange={(e) => setNewProject({ ...newProject, quotedPrice: e.target.value })} />
          <input type="number" placeholder="Ore estimate" value={newProject.estimatedHours} onChange={(e) => setNewProject({ ...newProject, estimatedHours: e.target.value })} />
          <button onClick={addProject}>Adaugă proiect</button>
          <ul>
            {metrics.map((p) => (
              <li key={p.id}><button className="link" onClick={() => setSelectedProjectId(p.id)}>{p.name} — {p.margin.toFixed(1)}%</button></li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Pontaj</h2>
          <select value={newTime.projectId} onChange={(e) => setNewTime({ ...newTime, projectId: e.target.value })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input placeholder="Muncitor" value={newTime.workerName} onChange={(e) => setNewTime({ ...newTime, workerName: e.target.value })} />
          <input type="date" value={newTime.date} onChange={(e) => setNewTime({ ...newTime, date: e.target.value })} />
          <input type="time" value={newTime.startTime} onChange={(e) => setNewTime({ ...newTime, startTime: e.target.value })} />
          <input type="time" value={newTime.endTime} onChange={(e) => setNewTime({ ...newTime, endTime: e.target.value })} />
          <button onClick={addTime}>Adaugă pontaj</button>
        </article>

        <article className="card">
          <h2>Cost</h2>
          <select value={newCost.projectId} onChange={(e) => setNewCost({ ...newCost, projectId: e.target.value })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input placeholder="Furnizor" value={newCost.supplier} onChange={(e) => setNewCost({ ...newCost, supplier: e.target.value })} />
          <input type="number" placeholder="Sumă" value={newCost.amount} onChange={(e) => setNewCost({ ...newCost, amount: e.target.value })} />
          <input type="date" value={newCost.date} onChange={(e) => setNewCost({ ...newCost, date: e.target.value })} />
          <button onClick={addCost}>Adaugă cost</button>
        </article>
      </section>

      {selected && (
        <section className="card">
          <h2>{selected.name}</h2>
          <p>Venit: {euro(selected.quotedPrice)}</p>
          <p>Ore totale: {selected.totalHours.toFixed(2)} (x {HOURLY_RATE}€/h)</p>
          <p>Cost total: {euro(selected.totalCost)}</p>
          <p>Profit: {euro(selected.profit)}</p>
          <p className={selected.risk === "high" ? "bad" : selected.risk === "medium" ? "warn" : "ok"}>Marjă: {selected.margin.toFixed(1)}%</p>
        </section>
      )}
    </main>
  );
}
