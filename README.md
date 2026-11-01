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
### Stoc personal (materiale date din stocul propriu)
- **Dau material**: material (se creează automat la prima scriere), cantitate, **data și ora** (completate automat, modificabile), cui (persoană / firmă), șantier, notă și **poze**.
- **Retur**: marchezi la dare „Retur așteptat: Da”, iar lista **De returnat** arată, pe persoane, ce mai ai de primit. Atingi un rând → retur cu cantitatea precompletată (poate fi și parțial).
- **Intrare în stoc** (opțional): dacă îți notezi și ce cumperi / aduci, aplicația arată cât mai ai **în stoc**.
- Fișă pe fiecare material (dat, returnat, la cine este, istoric), tab **Stoc** în fiecare proiect cu ce ai dat pe acel șantier, **export CSV** pentru Excel.

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
