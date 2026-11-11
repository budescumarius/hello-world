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

### Model 3D (vizualizator BIM) – `app/bim/`
Vizualizator de modele BIM pe telefon, tabletă și calculator, accesibil din fila **Model 3D**. Funcționează offline după prima deschidere.
- **Fișiere BIMx** (`.bimx` publicate din ARCHICAD): se citesc planșele 2D (planuri, secțiuni, fațade), afișate cu zoom până la detaliu, plus proprietățile elementelor și datele proiectului. Modelul 3D din BIMx are un format binar închis și nu se afișează; pentru 3D se folosește exportul IFC.
- **Import IFC** (2x3 / 4) din ARCHICAD, Revit, Allplan, Tekla, Vectorworks etc. Fișierul se procesează local (WebAssembly) și rămâne salvat pe dispozitiv. Se poate deschide și prin link: `bim/?ifc=<adresă fișier .ifc>`. Include un model demonstrativ (casă P+1).
- **3D**: rotire, zoom și deplasare cu degetele sau cu mouse-ul. Dublu-tap pe un element centrează vederea pe el.
- **Mers prin clădire** la persoana întâi: joystick pe ecran sau tastele W A S D. Urci scările, ai coliziuni cu pereții, iar ușile se pot traversa. O minihartă arată nivelul curent și poziția ta.
- **Planuri 2D** pe fiecare nivel, generate din model (secțiune la 1,2 m, pereți tăiați hașurați), cu numele și suprafețele camerelor. Dublu-tap pe plan te duce în 3D exact în acel loc.
- **Proprietăți**: clasă IFC, nivel, gabarit, seturi de proprietăți (Pset), cantități și materiale.
- **Niveluri**: afișare pe nivel, plan, mers sau tăietură axonometrică a etajului.
- **Secțiuni** orizontale și verticale, cu hașura elementelor tăiate.
- **Măsurători** cu prindere de colțuri (Δx / Δy / Δh).
- **Notițe** (pini) pe model, cu unghiul de vedere salvat și export CSV.
- **Vederi salvate**, **rază X**, izolare și ascundere de elemente, straturi pe categorii și căutare.

### Proiectare (desen și calcul) – `app/cad/`
Program de desen pe calculator (cu mouse), în stilul programelor BIM, accesibil din fila **Proiectare**.
- **Desen în plan pe niveluri**: pereți, uși, ferestre, stâlpi, grinzi, plăci, acoperișuri (terasă, o apă, două ape), zone (camere) și cote.
  - Punctele se prind automat de capete, colțuri, mijloace și fețe de pereți.
  - Lungimile și unghiurile exacte se tastează: `4.5` + Enter sau `4.5<90`.
  - Shift desenează doar orizontal sau vertical.
  - Camerele și plăcile se pot detecta automat, cu un clic în interiorul pereților.
- **Editare**: selecție (și cu dreptunghi), mutare, editarea capetelor (pereții legați se întind împreună), copiere, ștergere, anulare/refacere, niveluri cu cote și înălțimi.
- **3D generat automat**, alături de plan sau pe tot ecranul.
- **Proprietăți**: grosimi, înălțimi, materiale, portant/neportant, folosința planșeelor, straturi permanente.
- **Cantități**: beton, zidării, tencuieli, pardoseli, tâmplărie, suprafețe utile, cu export CSV pentru Excel.
- **Calcul sarcini (orientativ, predimensionare)** după SR EN 1990 / 1991-1-1 / 1991-1-3:
  - greutate proprie, încărcări utile pe categorii, pereți despărțitori și zăpadă;
  - arii aferente și coborârea încărcărilor nivel cu nivel până la fundații, cu combinațiile SLU și SLS;
  - verificări orientative pentru zidărie, stâlpi, grinzi și plăci, plus lățimea fundațiilor;
  - afișare colorată pe plan și export CSV.
  - Nu include seismul și vântul și nu înlocuiește proiectul de rezistență semnat de un inginer atestat.
- **Export IFC4**: pereți cu goluri, uși, ferestre, plăci, stâlpi, grinzi, acoperișuri, spații, materiale, Pset-uri și cantități. Se deschide în ARCHICAD, Revit, Allplan etc. Butonul **Model 3D** deschide direct modelul în vizualizator.
- Proiectul se salvează automat în browser. Se poate salva sau deschide ca fișier `.json`.

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
