'use strict';
/* Assistant IA : panneau de discussion accessible partout (bouton en bas à droite). */

const AI_SUGGEST = [
  ['Calculer des matériaux', 'Calcule les matériaux pour '],
  ['Préparer un devis', 'Prépare un devis pour '],
  ['Demande de prix (mail)', 'Prépare un mail de demande de prix au fournisseur pour '],
  ['Commande fournisseur', 'Prépare une commande pour le chantier '],
  ['Question technique', 'Comment réaliser '],
];
const aiState = { conv: null, msgs: [], busy: false };
const aiKey = () => `ai_conv_${(S.firm && S.firm.id) || 1}`;

// Markdown simple (titres, gras, listes, tableaux, code, liens) – le texte est échappé d'abord
function aiMd(src) {
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = String(src || '').split('\n'); const out = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(l); i += 2; const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<div class="ai-tbl"><table><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table></div>`);
      continue;
    }
    if (/^\s*[-*•]\s+/.test(l)) { const it = []; while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) it.push(lines[i++].replace(/^\s*[-*•]\s+/, '')); out.push(`<ul>${it.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { const it = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) it.push(lines[i++].replace(/^\s*\d+[.)]\s+/, '')); out.push(`<ol>${it.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`); continue; }
    const h = l.match(/^(#{1,4})\s+(.*)/); if (h) { out.push(`<p class="ai-h">${inline(h[2])}</p>`); i++; continue; }
    if (!l.trim()) { i++; continue; }
    const para = []; while (i < lines.length && lines[i].trim() && !/^\s*([-*•]|\d+[.)])\s+|^#{1,4}\s|^\s*\|/.test(lines[i])) para.push(lines[i++]);
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); else i++;
  }
  return out.join('');
}

function aiActionHtml(a, i) {
  if (a.type === 'quote' || a.type === 'order') {
    return `<div class="ai-act"><span class="ai-act-ic">${a.type === 'quote' ? I.calc : I.truck}</span><div class="grow"><b>${a.type === 'quote' ? 'Devis' : 'Commande'} ${esc(a.number || '')}</b><br><small class="muted">${esc(a.title || '')} · ${money(a.total)} HT · brouillon</small></div><a class="btn sm primary" href="${a.link}" data-close-ai>Ouvrir</a></div>`;
  }
  if (a.type === 'email') {
    return `<div class="ai-act"><span class="ai-act-ic">${I.mail}</span><div class="grow"><b>${esc(a.subject)}</b><br><small class="muted">À : ${esc((a.to || []).map((t) => t.name || t.email).join(', ') || '—')}</small></div><button class="btn sm primary" data-mail="${i}">Vérifier et envoyer</button></div>`;
  }
  return '';
}

function aiDraw() {
  const box = $('#ai-msgs'); if (!box) return;
  if (!aiState.msgs.length) {
    box.innerHTML = `<div class="ai-empty"><div class="ai-hello">${I.spark} Bonjour ${esc((S.me.name || '').split(' ')[0])} !</div>
      <p class="muted">Je peux calculer des quantités et des prix, préparer un devis, une commande ou un mail de demande de prix, et répondre à vos questions techniques. Je crée des brouillons : rien n'est envoyé sans vous.</p>
      <div class="ai-sugg">${AI_SUGGEST.map(([l, p], i) => `<button class="chip" data-sugg="${i}">${esc(l)}</button>`).join('')}</div></div>`;
  } else {
    let n = 0; const acts = [];
    box.innerHTML = aiState.msgs.map((m) => {
      if (m.role === 'user') return `<div class="ai-msg me"><div class="ai-bub">${esc(m.text).replace(/\n/g, '<br>')}</div></div>`;
      const a = (m.actions || []).map((x) => { acts.push(x); return aiActionHtml(x, n++); }).join('');
      return `<div class="ai-msg bot"><div class="ai-bub">${m.error ? `<p class="late">${esc(m.text)}</p>` : aiMd(m.text)}${a}</div></div>`;
    }).join('') + (aiState.busy ? `<div class="ai-msg bot"><div class="ai-bub ai-wait"><span class="dots"><i></i><i></i><i></i></span> L'assistant réfléchit… <small class="muted">(calculs et recherches : jusqu'à une minute)</small></div></div>` : '');
    $$('[data-mail]', box).forEach((b) => { b.onclick = () => aiMail(acts[+b.dataset.mail]); });
  }
  $$('[data-sugg]', box).forEach((b) => { b.onclick = () => { const t = $('#ai-in'); t.value = AI_SUGGEST[+b.dataset.sugg][1]; t.focus(); t.setSelectionRange(t.value.length, t.value.length); }; });
  $$('[data-close-ai]', box).forEach((b) => { b.addEventListener('click', () => aiToggle(false)); });
  box.scrollTop = box.scrollHeight;
}

function aiMail(a) {
  sendMailDialog({
    subject: a.subject, body: a.body,
    recipients: (a.to || []).map((t) => ({ name: t.name || t.email, email: t.email, group: 'Destinataires proposés', checked: true })),
    ref: { type: 'mail' }, projectId: a.projectId || null,
  });
}

async function aiSend(text) {
  text = text.trim(); if (!text || aiState.busy) return;
  aiState.msgs.push({ role: 'user', text }); aiState.busy = true; aiDraw();
  const h1 = $('.top-title h1');
  try {
    const r = await api('POST', 'ai/chat', { conv_id: aiState.conv, text, context: { page: location.hash, label: h1 ? h1.textContent.trim() : '' } });
    aiState.conv = r.conv_id; try { localStorage.setItem(aiKey(), r.conv_id); } catch (e) { /* stockage indisponible */ }
    aiState.msgs.push({ role: 'assistant', text: r.reply, actions: r.actions });
    $('#ai-title').textContent = r.title || 'Assistant';
  } catch (e) {
    aiState.msgs.push({ role: 'assistant', text: e.message, error: true });
  } finally { aiState.busy = false; aiDraw(); }
}

async function aiOpenConv(id) {
  aiState.conv = id; aiState.msgs = [];
  try { localStorage.setItem(aiKey(), id || ''); } catch (e) { /* stockage indisponible */ }
  $('#ai-title').textContent = 'Assistant';
  if (id) {
    try { const c = await api('GET', `ai/conv/${id}`); aiState.msgs = c.messages; $('#ai-title').textContent = c.title; } catch (e) { aiState.conv = null; }
  }
  aiDraw();
}

async function aiHistory() {
  const list = await api('GET', 'ai/convs');
  const m = modal(`${mhead('Conversations')}<div class="m-body">${list.length ? list.map((c) => `<div class="ai-hist"><button class="link-btn grow" data-open="${c.id}"><b>${esc(c.title)}</b><br><small class="muted">${fmtDT(c.updated_at)}</small></button><button class="icon-btn sm" data-del="${c.id}" aria-label="Supprimer">${I.trash}</button></div>`).join('') : '<p class="muted">Aucune conversation.</p>'}</div>`);
  $$('[data-open]', m.el).forEach((b) => { b.onclick = () => { m.close(); aiOpenConv(+b.dataset.open); }; });
  $$('[data-del]', m.el).forEach((b) => { b.onclick = async () => { if (!confirm('Supprimer cette conversation ?')) return; await api('DELETE', `ai/conv/${b.dataset.del}`); b.closest('.ai-hist').remove(); if (+b.dataset.del === aiState.conv) aiOpenConv(null); }; });
}

function aiToggle(open) {
  const p = $('#ai-panel'); if (!p) return;
  p.classList.toggle('show', open);
  document.body.classList.toggle('ai-open', open);
  if (open) setTimeout(() => { if (!('ontouchstart' in window)) $('#ai-in').focus(); }, 100);
}

function aiMount() {
  if (!S.ai || $('#ai-fab')) return;
  document.body.insertAdjacentHTML('beforeend', `<button id="ai-fab" class="ai-fab" aria-label="Assistant IA">${I.spark}<span>Assistant</span></button>
    <aside id="ai-panel" class="ai-panel" aria-label="Assistant IA"><header class="ai-head"><span class="ai-logo">${I.spark}</span><b id="ai-title" class="grow">Assistant</b>
      <button class="icon-btn" data-ai="hist" title="Conversations">${I.hist}</button><button class="icon-btn" data-ai="new" title="Nouvelle conversation">${I.plus}</button><button class="icon-btn" data-ai="close" aria-label="Fermer">✕</button></header>
      <div id="ai-msgs" class="ai-msgs"></div>
      <form class="ai-foot" id="ai-form"><textarea id="ai-in" rows="2" placeholder="Ex. : dalle de 30 m² en 15 cm, combien de béton et quel prix ?"></textarea><button class="btn primary" type="submit" aria-label="Envoyer">${I.send}</button></form></aside>`);
  $('#ai-fab').onclick = () => aiToggle(true);
  $('[data-ai=close]').onclick = () => aiToggle(false);
  $('[data-ai=new]').onclick = () => aiOpenConv(null);
  $('[data-ai=hist]').onclick = () => aiHistory();
  const inp = $('#ai-in');
  $('#ai-form').onsubmit = (e) => { e.preventDefault(); const t = inp.value; inp.value = ''; aiSend(t); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); $('#ai-form').requestSubmit(); } });
  let saved = null; try { saved = +localStorage.getItem(aiKey()) || null; } catch (e) { /* stockage indisponible */ }
  aiOpenConv(saved);
}

// ---------------------------------------------------------------- Paramètres › Assistant IA
function aiSettings(page) {
  const s = (S.settings.ai && typeof S.settings.ai === 'object') ? S.settings.ai : {};
  const platform = S.me.super && S.firm.own !== false;
  const fields = [
    { name: 'key', label: 'Clé API Anthropic', type: 'password', placeholder: s.hasKey ? '•••••••• (inchangée)' : 'sk-ant-…', cls: 'full' },
    ...(platform ? [{ name: 'ownOnly', label: 'Réserver cette clé à ma firme (sinon elle sert aussi aux firmes sans clé)', type: 'check', cls: 'full' }] : []),
  ];
  page.innerHTML = `<div class="card"><div class="card-h"><h3>Assistant IA</h3>${S.ai ? badge('Actif', '#2f9e44') : badge('Inactif', '#868e96')}</div>
    <form>${fieldsGrid(fields, { key: '', ownOnly: !!s.ownOnly })}<div class="btns"><button class="btn primary" type="submit">Enregistrer</button><button class="btn" type="button" data-test ${s.hasKey || S.ai ? '' : 'disabled'}>Tester</button>${s.hasKey ? '<button class="btn danger ghost" type="button" data-clear>Retirer la clé</button>' : ''}</div></form></div>
    <div class="card"><div class="card-h"><h3>Comment ça marche</h3></div><ol class="steps">
      <li>Créez une clé sur <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> (Settings › API keys) et ajoutez du crédit : l'assistant est facturé à l'usage par Anthropic.</li>
      <li>Collez la clé ici. Le bouton <b>Assistant</b> apparaît alors en bas à droite de toutes les pages, pour tous les utilisateurs de la firme.</li>
      <li>L'assistant lit la bibliothèque de prix, les contacts, les chantiers et les devis de la firme ; il crée des <b>brouillons</b> de devis et de commandes et prépare des emails que vous relisez avant l'envoi.</li>
      <li>La clé reste sur le serveur ; elle n'est jamais envoyée aux navigateurs.</li>
      ${S.me.super ? '<li>En tant que gestionnaire de la plateforme, votre clé sert aussi aux autres firmes qui n\'ont pas la leur (sauf si vous la réservez à votre firme).</li>' : ''}
    </ol></div>`;
  const form = $('form', page);
  const save = async (v) => { await api('PUT', 'settings', { ai: v }); const b = await api('GET', 'bootstrap'); S.settings = b.settings || {}; S.ai = b.ai; render(); };
  form.onsubmit = async (e) => { e.preventDefault(); const v = readFields(form, fields); await save({ key: v.key, ownOnly: !!v.ownOnly }); toast('Assistant IA enregistré'); };
  const cl = $('[data-clear]', page); if (cl) cl.onclick = async () => { if (confirm('Retirer la clé API ?')) { await save({ key: '', clearKey: true }); toast('Clé retirée'); } };
  $('[data-test]', page).onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { const r = await api('POST', 'ai/test'); toast(`Connexion réussie (${r.model})`, 4000); } catch (err) { toast(err.message, 8000); } finally { b.disabled = false; }
  };
}
