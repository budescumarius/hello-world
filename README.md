# Aplicații pentru construcții

- **`web/` – BâtiPro**: aplicație web multi-utilizator (PHP + MySQL) în stilul **Vertuoza**, cu partea **Aproplan** integrată pe fiecare șantier. Se instalează pe un domeniu propriu (cPanel). Vezi [`web/README.md`](web/README.md).
- **`app/` – Șantier**: aplicația offline (PWA) pentru iPhone/iPad, descrisă mai jos.

# Șantier – aplicație pentru iPhone și iPad

Aplicație web instalabilă (PWA) pentru urmărirea șantierelor: planuri, puncte de observație/defecte, fotografii, firme, ședințe și rapoarte PDF. Funcționează **offline**, iar datele rămân pe dispozitiv.

## Funcții
- **Proiecte** cu beneficiar, adresă și responsabil.
- **Planuri**: import PDF (fiecare pagină devine un plan) sau imagini/fotografii. Le poți mări cu două degete și muta pe ecran.
- **Puncte pe plan**: atingi „+ Punct”, apoi locul de pe plan. Fiecare punct are titlu, descriere, status (Deschis / În lucru / Rezolvat / Închis), prioritate, categorie, firmă responsabilă, termen, fotografii (cu desen/adnotare), comentarii și istoric.
- **Listă de puncte** cu căutare și filtre (status, firmă, plan, întârziate).
- **Firme / subcontractori** cu date de contact și statistici.
- **Ședințe de șantier**: participanți, discuții, puncte urmărite → **proces-verbal PDF** cu loc de semnături.
- **Rapoarte PDF** cu planurile și pinii, un extras de plan la fiecare punct și fotografiile. **Export CSV** pentru Excel.

### Gestiune (devize, facturi, costuri, planning)
- **Clienți**: firme sau persoane fizice, cu CUI/TVA, adresă și sold de încasat.
- **Catalog de prețuri**: materiale, manoperă, utilaje și subcontractări, cu cost, marjă și preț calculat automat. Import/export CSV, actualizare procentuală a prețurilor.
- **Devize / oferte**: capitole și articole (manual sau din catalog), cote de TVA diferite pe linii, discount, taxare inversă. Vezi costul și marja internă. PDF profesional cu logo, de trimis clientului. Statusuri: Ciornă / Trimis / Acceptat / Refuzat.
- **Facturi** direct din deviz: integrală, **avans %**, **situații de lucrări** (% realizat cumulat, cu deducerea proporțională a avansului) și **finală** (soldul rămas). Facturi libere, note de credit, **încasări** parțiale și facturi restante. Export CSV pentru contabil.
- **Costuri de șantier**: cheltuieli (cu foto după bon/factură) și ore lucrate. Comparație **estimat vs. real** pe tipuri, buget, facturat, încasat și profit.
- **Planning (Gantt)** pe proiect și pentru toate șantierele împreună. Etapele se pot genera automat din capitolele devizului.
- **Setări**: datele firmei, logo, monedă, cote TVA, prefixe și numerotare pentru devize și facturi.
- **Backup / restaurare** a tuturor datelor într-un fișier JSON (îl poți salva în iCloud Drive / Fișiere).

## Publicare
1. Pe GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. La fiecare push pe `master`, workflow-ul `.github/workflows/pages.yml` publică folderul `app/`.
3. Aplicația va fi la `https://<utilizator>.github.io/<repo>/`.

## Instalare pe iPhone / iPad
Deschide adresa în **Safari** → **Partajează** → **Adaugă pe ecranul principal**.

## Rulare locală
```bash
cd app && python3 -m http.server 8000
# deschide http://localhost:8000
```
