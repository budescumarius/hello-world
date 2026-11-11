// Starea aplicației de proiectare, comună tuturor modulelor.
import { DEFAULTS, newProject } from './model.js';

export const A = {
  p: newProject(),
  storey: 's1',
  tool: 'select',
  sel: new Set(),
  defaults: JSON.parse(JSON.stringify(DEFAULTS)),
  showLoads: false,
  loads: null, // rezultatele ultimului calcul de sarcini
  undo: [],
  redo: [],
  listeners: new Set(),
};

// Anunță toate modulele că ceva s-a schimbat. kind: 'model' (geometrie), 'sel' (selecție), 'view' (doar afișare)
export function emit(kind = 'model') {
  if (kind === 'model') A.loads = null;
  for (const f of A.listeners) f(kind);
}
export const on = (f) => A.listeners.add(f);

// Înainte de orice modificare a modelului: salvăm starea pentru Anulează
export function snapshot() {
  A.undo.push(JSON.stringify(A.p));
  if (A.undo.length > 100) A.undo.shift();
  A.redo.length = 0;
}
export function undo() {
  if (!A.undo.length) return false;
  A.redo.push(JSON.stringify(A.p));
  A.p = JSON.parse(A.undo.pop());
  cleanSel();
  emit('model');
  return true;
}
export function redo() {
  if (!A.redo.length) return false;
  A.undo.push(JSON.stringify(A.p));
  A.p = JSON.parse(A.redo.pop());
  cleanSel();
  emit('model');
  return true;
}
function cleanSel() {
  for (const id of [...A.sel]) if (!A.p.elements.some((e) => e.id === id)) A.sel.delete(id);
  if (!A.p.storeys.some((s) => s.id === A.storey)) A.storey = A.p.storeys[0].id;
}
export function deleteElements(ids) {
  const set = new Set(ids);
  // golurile dispar odată cu peretele lor
  for (const e of A.p.elements) if ((e.type === 'door' || e.type === 'window') && set.has(e.wall)) set.add(e.id);
  A.p.elements = A.p.elements.filter((e) => !set.has(e.id));
  for (const id of set) A.sel.delete(id);
}
