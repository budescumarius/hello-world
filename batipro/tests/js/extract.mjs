// Charge des fonctions EXACTEMENT telles qu'écrites dans assets/*.js (sans les copier ni les modifier),
// dans un contexte isolé, pour tester les calculs financiers existants de BatiPro.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as acorn from 'acorn';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

// Source d'une déclaration de premier niveau (function, async function, const/let) par son nom
function declarations(file, names) {
  const src = readFileSync(join(ASSETS, file), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const found = {};
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration' && names.includes(node.id.name)) found[node.id.name] = src.slice(node.start, node.end);
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (d.id.type === 'Identifier' && names.includes(d.id.name)) found[d.id.name] = `${node.kind} ${src.slice(d.start, d.end)};`;
      }
    }
  }
  const missing = names.filter((n) => !found[n]);
  if (missing.length) throw new Error(`${file} : déclaration(s) introuvable(s) : ${missing.join(', ')}`);
  return names.map((n) => found[n]).join('\n');
}

// Fonctions financières utilisées par les tests (fichier → noms)
export const SOURCES = {
  'core.js': ['num', 'r2', 'DAY', 'dnum'],
  'data.js': ['company', 'vatList', 'defVat', 'totals', 'invState'],
  'purchase.js': ['purchVat', 'purchTtc', 'purchPaid', 'purchRest', 'purchState'],
  'achats.js': ['expenseParts', 'expenseFor', 'expenseAmountFor'],
  'chantier.js': ['projectFinance'],
};

/** Contexte isolé avec la date du jour figée et des réglages d'entreprise fictifs. */
export function loadFinance({ todayIso = '2026-11-01', settings = { company: { vatRates: [21, 12, 6, 0], defaultVat: 21 } } } = {}) {
  const ctx = vm.createContext({ S: { me: { id: 1 }, users: [], settings, ready: true }, today: () => todayIso, Math, Number, String, Object, Array, JSON, isNaN, parseFloat, Date });
  for (const [file, names] of Object.entries(SOURCES)) vm.runInContext(declarations(file, names), ctx, { filename: file });
  // expose les fonctions (les const de premier niveau ne sont pas des propriétés du contexte)
  return vm.runInContext(`({ num, r2, dnum, totals, invState, purchVat, purchTtc, purchPaid, purchRest, purchState, expenseParts, expenseFor, expenseAmountFor, projectFinance })`, ctx);
}

/** Empreinte du code source des fonctions testées : change si quelqu'un modifie un calcul. */
export function sourceDigest() {
  return Object.entries(SOURCES).map(([f, n]) => declarations(f, n)).join('\n');
}
