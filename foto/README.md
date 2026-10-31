# Foto Șantier – poze de pe șantier pentru toată echipa

O aplicație simplă pentru telefon. Echipa face poze pe șantier, iar pozele ajung imediat pe server și, dacă vrei, și în **Google Drive**, într-un folder separat pentru fiecare șantier.

## Cum se folosește (muncitor)
1. Deschide aplicația (o dată te loghezi, apoi rămâi conectat).
2. Alege **șantierul** din butonul de sus. Aplicația ține minte ultima alegere. Poți lăsa și **„Fără șantier”**.
3. Apasă butonul mare **📷 Fă poză**. Gata!
   - Opțional: scrie un **comentariu** înainte de poză sau adaugă-l după, din poză.
   - **📝 Doar notă**: un mesaj fără poză (ex. „lipsește ciment”).
   - **🖼 Din galerie**: trimite mai multe poze deja făcute.

**E rapid:** poza e micșorată în telefon (≈300–600 KB în loc de 3–5 MB) și se trimite în fundal, așa că poți face imediat următoarea poză.
**Merge și fără semnal:** pozele rămân în telefon și se trimit singure când revine internetul.

## Roluri
| Rol | Ce poate face |
|---|---|
| **Admin** | Vede toate șantierele și toate pozele. Creează șantiere, adaugă oameni, atribuie șantiere, conectează Google Drive. |
| **Responsabil** | Vede șantierele atribuite lui și **toate** pozele de pe ele. Poate crea șantiere (i se atribuie automat) și poate alege cine lucrează pe ele. |
| **Muncitor** | Poate alege doar șantierele atribuite lui sau „Fără șantier”. Vede doar pozele lui. |

Pozele „Fără șantier” le vede adminul în **Șantiere → Fără șantier** și le poate muta pe șantierul potrivit.

## Instalare pe server

### Varianta A – Docker (recomandat, cu HTTPS automat)
Ai nevoie de un server mic (VPS de ~5 €/lună) și de un domeniu, de exemplu `foto.firma-ta.ro`, îndreptat spre server.
```bash
cd foto
# în docker-compose.yml înlocuiește foto.firma-ta.ro cu domeniul tău (în 2 locuri)
docker compose up -d
```
Deschide `https://foto.firma-ta.ro`. La prima pornire creezi contul de **admin**.

### Varianta B – direct cu Node.js (versiunea 22.13 sau mai nouă)
```bash
cd foto
npm install
npm start          # pornește pe http://localhost:3000
```
Variabile de configurare: `PORT`, `DATA_DIR` (implicit `./data`), `PUBLIC_URL`.

Toate datele sunt în folderul `data/`: baza de date `santier.db` și pozele în `photos/AAAA-LL/`. **Backup = copiezi folderul `data/`.**

> Pentru instalare pe telefon (Safari → Partajează → „Adaugă pe ecranul principal”, sau Chrome → „Instalează aplicația”) e nevoie de **HTTPS**.

## Google Drive (opțional)
Pozele se salvează **mereu** pe server. Dacă activezi Drive, fiecare poză este copiată automat în
`Poze Șantier / <nume șantier> / 2026-10-31_14-05-22_Ion_Popescu_123.jpg`, cu comentariul în descrierea fișierului.
Dacă muți o poză pe alt șantier sau o ștergi, se actualizează și în Drive.

1. Intră pe https://console.cloud.google.com/ și creează un proiect.
2. **APIs & Services → Library**: activează **Google Drive API**.
3. **OAuth consent screen**: alege tipul *External*, completează numele aplicației, apoi apasă **Publish app** („In production”). Dacă rămâne în „Testing”, Google deconectează aplicația după 7 zile.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   La *Authorized redirect URIs* pune: `https://foto.firma-ta.ro/api/drive/callback`.
   Adresa exactă o vezi în aplicație, la **Cont → Stocare**.
5. Pune `GOOGLE_CLIENT_ID` și `GOOGLE_CLIENT_SECRET` în `docker-compose.yml` (sau ca variabile de mediu) și repornește serverul.
6. În aplicație, ca admin: **Cont → Conectează Google Drive** și alege contul Google în care vrei pozele.

Aplicația cere doar acces la fișierele create de ea (`drive.file`). Nu vede restul fișierelor din Drive.
