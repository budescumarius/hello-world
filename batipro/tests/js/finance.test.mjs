// Tests de caractérisation des calculs financiers ACTUELS de BatiPro (assets/*.js, code inchangé).
// Les valeurs attendues sont calculées à la main. Elles servent de référence pour le futur portage en PHP
// (module PILOTAGE) : le PHP devra donner exactement les mêmes résultats.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { loadFinance, sourceDigest } from './extract.mjs';

const F = loadFinance();
const SC = JSON.parse(readFileSync(new URL('../fixtures/finance-scenarios.json', import.meta.url), 'utf8'));
const plain = (x) => JSON.parse(JSON.stringify(x)); // objets du contexte isolé → objets comparables

test('totals : remise répartie par taux de TVA (EN 16931), options exclues, déboursé et marge', () => {
  const t = plain(F.totals(SC.documents.devis_remise_2_taux));
  assert.equal(t.net, 1100);
  assert.equal(t.discount, 110);
  assert.equal(t.base, 990);
  assert.deepEqual(t.vats, [
    { rate: 21, lines: 1000, allowance: 100, base: 900, vat: 189 },
    { rate: 6, lines: 100, allowance: 10, base: 90, vat: 5.4 },
  ]);
  assert.equal(t.vat, 194.4);
  assert.equal(t.total, 1184.4);
  assert.equal(t.cost, 660);
  assert.deepEqual(t.costBy, { mat: 600, mo: 60 });
  assert.equal(t.margin, 330);
});

test('totals : autoliquidation = TVA à zéro', () => {
  const t = F.totals(SC.documents.autoliquidation);
  assert.equal(t.vat, 0);
  assert.equal(t.total, 1000);
  assert.equal(t.margin, 300);
});

test('totals : note de crédit = montants négatifs', () => {
  const t = F.totals(SC.documents.note_de_credit);
  assert.equal(t.base, -200);
  assert.equal(t.vat, -42);
  assert.equal(t.total, -242);
});

test('totals : ouvrage avec déboursé ventilé par type', () => {
  const t = plain(F.totals(SC.documents.ouvrage_cout_ventile));
  assert.equal(t.cost, 270);
  assert.deepEqual(t.costBy, { mat: 120, mo: 150 });
});

test('invState : statut de paiement des factures (payé = somme des paiements encodés)', () => {
  const s = (k) => F.invState(SC.invoices[k]);
  assert.equal(s('brouillon').s, 'brouillon');
  assert.equal(s('emise_non_echue').s, 'impayee');
  assert.equal(s('emise_non_echue').rest, 1210);
  assert.equal(s('emise_en_retard').s, 'retard');
  assert.equal(s('partielle').s, 'partielle');
  assert.equal(s('partielle').rest, 710);
  assert.equal(s('partielle_en_retard').s, 'retard', 'le retard prime sur « partiellement payée »');
  assert.equal(s('payee_en_deux_fois').s, 'payee');
  assert.equal(s('payee_en_deux_fois').paid, 1210, 'les montants « 210,00 » saisis avec virgule sont acceptés');
  assert.equal(s('avoir').s, 'avoir');
});

test('purch* : factures fournisseurs (TTC, plusieurs taux, paiements, anciens achats)', () => {
  const P = (k) => SC.purchases[k];
  assert.equal(F.purchTtc(P('a_payer').data), 1210);
  assert.equal(F.purchState(P('a_payer')), 'apayer');
  assert.equal(F.purchTtc(P('plusieurs_taux').data), 1316);
  assert.equal(F.purchTtc(P('ttc_force').data), 1300, 'un TTC encodé l\'emporte sur le calcul');
  assert.equal(F.purchPaid(P('ancien_paye').data), 1210, 'ancien achat « payé » sans détail = payé en entier');
  assert.equal(F.purchState(P('ancien_paye')), 'payee');
  assert.equal(F.purchRest(P('partiel').data), 810);
  assert.equal(F.purchState(P('partiel')), 'partiel');
  assert.equal(F.purchState(P('partiel_en_retard')), 'retard');
  assert.equal(F.purchState(P('refusee')), 'refusee');
  assert.equal(F.purchState(P('a_valider')), 'avalider');
});

test('expenseParts : ventilation d\'un achat sur plusieurs chantiers', () => {
  const e = SC.project.all.expense[1];
  assert.deepEqual(plain(F.expenseParts(e)), [
    { pid: 10, amount: 200, category: 'st' },
    { pid: 11, amount: 999, category: 'st' },
  ]);
  assert.equal(F.expenseAmountFor(e, 10), 200);
  assert.equal(F.expenseAmountFor(SC.project.all.expense[0], 10), 300);
});

test('projectFinance : aperçu financier d\'un chantier', () => {
  const f = plain(F.projectFinance(SC.project.p, SC.project.all));
  assert.equal(f.budget, 990, 'devis acceptés (HTVA après remise), le budget libre est ignoré');
  assert.equal(f.est, 660);
  assert.deepEqual(f.estBy, { mat: 600, mo: 60 });
  assert.deepEqual(f.realBy, { mat: 300, st: 200, mo: 360 }, 'achats ventilés + heures × taux ; achat refusé et autre chantier exclus');
  assert.equal(f.real, 860);
  assert.equal(f.engaged, 100, 'commandes non facturées ni annulées');
  assert.equal(f.invoiced, 400, 'HTVA, brouillon exclu, note de crédit déduite');
  assert.equal(f.cashed, 200);
  assert.equal(f.due, 330, 'TTC restant à encaisser, hors note de crédit');
  assert.equal(f.hours, 8);
  assert.equal(f.margin, 30, 'budget − max(déboursé prévu ; réel + engagé)');
});

test('num : comportement actuel des montants saisis (limite connue)', () => {
  assert.equal(F.num('1234,56'), 1234.56);
  assert.equal(F.num(' 1 234,56 '), 1234.56);
  assert.equal(F.num(''), 0);
  // LIMITE ACTUELLE : le point des milliers n'est pas géré (« 1.234,56 » → 1,234). À ne pas reproduire dans le Pilotage.
  assert.equal(F.num('1.234,56'), 1.234);
});

test('référence dorée : résultats identiques au fichier fixtures/finance-golden.json', () => {
  const golden = JSON.parse(readFileSync(new URL('../fixtures/finance-golden.json', import.meta.url), 'utf8'));
  const digest = createHash('sha256').update(sourceDigest()).digest('hex');
  assert.equal(golden.sourceDigest, digest,
    'le code d\'un calcul financier a changé : vérifier l\'impact, puis régénérer avec « npm run golden »');
});
