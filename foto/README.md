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

## Instalare pe hosting cPanel (cel mai simplu)
Ai nevoie doar de PHP 7.4 sau mai nou, cu SQLite. Aproape orice hosting cPanel le are.

1. **Ia arhiva** `foto-santier-cpanel.zip`. Dacă ai codul, o creezi cu `./build-cpanel.sh`, iar ea apare în `dist/`.
2. **Alege adresa.** Recomandat: un subdomeniu, de exemplu `foto.firma-ta.ro`.
   cPanel → **Domains** (sau **Subdomains**) → creează `foto`. cPanel îți arată folderul lui, de exemplu `public_html/foto`.
   Merge și într-un subfolder al site-ului existent, de exemplu `firma-ta.ro/foto`.
3. **Urcă fișierele.** cPanel → **File Manager** → intră în acel folder → **Upload** → alegi zip-ul → click dreapta pe el → **Extract**. Apoi poți șterge zip-ul.
   ⚠️ Fișierul `.htaccess` e ascuns. Ca să-l vezi: **Settings → Show Hidden Files**.
4. **Activează HTTPS.** cPanel → **SSL/TLS Status** → **Run AutoSSL**. Fără HTTPS, aplicația nu se poate instala pe telefon.
5. **Prima pornire.** Deschide `https://foto.firma-ta.ro` și creează contul de **admin**. Gata!

Aplicația își creează singură folderul `data/`, cu baza de date și pozele. Accesul la el din browser este blocat.
**Backup:** descarcă folderul `data/` din File Manager (click dreapta → Compress → Download).

**Dacă ceva nu merge:**
- *Eroare „Nu pot crea folderul de date”*: dă folderului aplicației permisiuni `755` (click dreapta → Change Permissions).
- *Pagina se deschide, dar logarea dă eroare 404*: verifică dacă fișierul `.htaccess` a fost urcat (vezi pasul 3).
- *Eroare legată de SQLite*: cPanel → **Select PHP Version** → bifează extensiile `pdo_sqlite` și `sqlite3`. Alege PHP 8.x.

**Google Drive pe cPanel:** Client ID și Client secret se pun direct în aplicație, la **Cont → Stocare**. Nu trebuie editat niciun fișier.
Pozele se copiază în Drive imediat după ce sunt făcute. Pentru siguranță, poți adăuga în cPanel → **Cron Jobs** (la 5 minute):
```
php /home/UTILIZATOR/public_html/foto/api.php drive-sync
```
Calea exactă o vezi în File Manager.

## Instalare pe server propriu (VPS)

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
   La *Authorized redirect URIs* pune: `https://foto.firma-ta.ro/api/drive/callback`. Dacă aplicația e într-un subfolder: `https://firma-ta.ro/foto/api/drive/callback`.
   Adresa exactă o vezi în aplicație, la **Cont → Stocare**.
5. Pe cPanel: pune Client ID și Client secret în aplicație, la **Cont → Stocare**. Pe VPS/Docker: pune `GOOGLE_CLIENT_ID` și `GOOGLE_CLIENT_SECRET` în `docker-compose.yml` și repornește serverul.
6. În aplicație, ca admin: **Cont → Conectează Google Drive** și alege contul Google în care vrei pozele.

Aplicația cere doar acces la fișierele create de ea (`drive.file`). Nu vede restul fișierelor din Drive.
