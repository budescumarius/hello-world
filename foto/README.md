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

## Foldere pe șantier
Fiecare șantier poate avea foldere, de ex. **État des lieux**, **Réception**, **Avant / Après**.
- **Admin / responsabil**: creează folderele din pagina șantierului (**+ Folder**), le redenumesc sau le șterg. Când un folder e șters, pozele rămân în șantier, la „General”.
- **Toată lumea**: pe ecranul Foto alege folderul de sub șantier; poza, galeria și notele merg acolo. Aplicația ține minte folderul ales pentru fiecare șantier.
- În pagina șantierului: **📷 Fă poză aici** și **🖼 Din galerie aici** trimit direct în folderul afișat.
- O poză se mută în alt folder din poza mărită: **📁 Folder**.
- În Google Drive / pe NAS: `Poze Șantier / <șantier> / <folder> / poza.jpg`.

## Trimitere direct din galeria telefonului
- **Android**: după instalarea aplicației pe ecranul principal, ea apare în **Partajează**. Selectezi pozele → Foto Șantier → alegi șantierul și folderul → Trimite.
- **iPhone**: Apple nu permite aplicațiilor web să apară în Partajează, așa că se folosește o **scurtătură** (aplicația Scurtături / Raccourcis), făcută o singură dată pe fiecare telefon.
  În aplicație: **Cont → Trimite din galerie → Generează cheia**. Apar cele 2 adrese și pașii. Apoi: Poze → selectezi → Partajează → **Foto Șantier** → alegi șantierul / folderul.
  Cheia e personală: pozele apar pe numele omului și respectă drepturile lui. Din Cont se poate opri oricând.

## Roluri
| Rol | Ce vede | Ce poate modifica / șterge |
|---|---|---|
| **Admin** | Tot: toate șantierele și toate pozele. Gestionează echipa și Google Drive. | Tot. |
| **Responsabil** | Pozele lui + toate pozele de pe șantierele atribuite. Poate crea șantiere și atribui oameni. | Comentează / mută pozele de pe șantierele lui. **Șterge doar pozele lui.** |
| **Muncitor** | Pozele lui + toate pozele de pe șantierele atribuite. Face poze doar pe acestea (sau „Fără șantier”). | **Doar pozele lui.** |

Pozele „Fără șantier” ale altora le vede **doar adminul**, în **Șantiere → Fără șantier** și le poate muta pe șantierul potrivit.

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
Pozele se copiază în Drive / pe NAS imediat după ce sunt făcute. Pentru siguranță, poți adăuga în cPanel → **Cron Jobs** (la 5 minute):
```
php /home/UTILIZATOR/public_html/foto/api.php sync
```
Calea exactă o vezi în File Manager.

## Volum mare (testat)
Aplicația a fost testată ca pentru o firmă mare: **500 de șantiere, 1.000 de angajați, 1.000.000 de poze**.

| Test | Rezultat |
|---|---|
| Galerie (orice rol), derulare | ~2–25 ms pe server, oricât de multe poze |
| Lista de 500 de șantiere / 1.000 de oameni | 7 ms / 5 ms (contoare ținute la zi de baza de date) |
| 100 de oameni simultan, 30 s, activitate amestecată | 150 de acțiuni/s, 0 erori, median 2–11 ms |
| 8 oameni trimit poze în aceeași clipă | 0 erori |
| Actualizarea unei baze existente | automată, o singură dată (1 milion de poze: ~4 s) |

Cum e făcută să meargă repede:
- baza de date ține la zi, singură, numărul de poze, ultima poză și coperta fiecărui șantier și om (triggere SQLite);
- fiecare tip de galerie citește dintr-un index potrivit doar cele ~60 de poze afișate;
- miniaturile se cer grupate (`api/thumbs`, câte 12 într-o cerere) și rămân în memoria telefonului;
- răspunsurile mari pleacă comprimate; trimiterea pozelor nu așteaptă Drive / NAS;
- listele lungi (șantiere, oameni, alegerea șantierului) au căutare (fără diacritice).

**Limite practice pe hosting partajat:** spațiul pe disc (o poză ≈ 300–700 KB, adică 1 milion de poze ≈ 300–700 GB, deci folosește Drive / NAS ca arhivă) și numărul de procese PHP permise de pachet. Peste câteva sute de oameni activi **în același minut**, mută aplicația pe un VPS (vezi mai jos): codul rămâne același.

## NAS (Synology, QNAP, Nextcloud) – opțional
Pe lângă server, pozele se pot copia automat și pe NAS-ul tău: în locul Google Drive sau împreună cu el.
Pe NAS se creează `Poze Șantier / <șantier> / 2026-11-01_09-30_Ion_Popescu_12.jpg`, iar comentariul stă lângă poză, într-un fișier `.txt` cu același nume.
Dacă muți o poză pe alt șantier, o ștergi sau redenumești șantierul, modificarea se face și pe NAS. Tot pe server, aplicația se conectează la NAS prin **WebDAV**.

**Pe Synology (DSM):**
1. **Panou de control → Folder partajat**: alege sau creează un folder, de ex. `photo`.
2. **Panou de control → Utilizator**: creează un utilizator doar pentru aplicație, de ex. `fotoapp`, cu drept de **citire/scriere doar pe acel folder**.
3. **Centru de pachete → WebDAV Server** → instalează → bifează **Activare HTTPS** (port **5006**).
4. NAS-ul trebuie să fie accesibil de pe internet, pentru că serverul de hosting se conectează la el:
   - **Panou de control → Acces extern → DDNS**: adaugă o adresă gratuită, de ex. `numele-tau.synology.me`;
   - **Securitate → Certificat**: adaugă un certificat **Let's Encrypt** pentru acea adresă;
   - în **router**: redirecționează portul **5006** (TCP) către NAS.
     Dacă hostingul blochează porturile neobișnuite, redirecționează portul extern **443** → 5006 pe NAS și folosește adresa fără `:5006`.
5. În aplicație, ca admin: **Cont → Stocare → NAS**:
   - Adresa: `https://numele-tau.synology.me:5006/photo`
   - Utilizator / parolă: cele de la pasul 2
   - apasă **Testează și salvează**. Pozele existente se copiază automat.

Fiecare destinație (Drive / NAS) are comutatorul **„Copiază automat”**, ca s-o poți pune pe pauză. Când o repornești, se trimit pozele rămase.

> **Fără porturi deschise:** dacă nu vrei să expui NAS-ul pe internet, lasă doar Google Drive activ și instalează pe Synology pachetul **Cloud Sync**. El sincronizează folderul „Poze Șantier” din Drive pe NAS.

## Instalare pe server propriu (VPS)
Aplicația are **un singur server** (`php/api.php`), același pe hosting și pe VPS: toate funcțiile (Drive, NAS) și optimizările pentru volum mare sunt peste tot.

### Varianta A – Docker (recomandat, cu HTTPS automat)
Ai nevoie de un VPS (de la ~5 €/lună) cu Docker și de un domeniu, de exemplu `foto.firma-ta.ro`, îndreptat spre server.
```bash
cd foto
# în docker-compose.yml înlocuiește foto.firma-ta.ro cu domeniul tău (în 2 locuri)
docker compose up -d
```
Deschide `https://foto.firma-ta.ro`. La prima pornire creezi contul de **admin**.

Ce pornește: `foto` (PHP 8.3 + Apache, cu opcache), `sync` (copierea în Drive / pe NAS la 5 minute, în locul unui cron) și `caddy` (HTTPS automat cu Let's Encrypt).
Datele (baza de date + pozele) stau în volumul Docker `foto-data`, în afara folderului web.

- **Actualizare:** copiezi fișierele noi, apoi `docker compose up -d --build`.
- **Backup:** `docker compose exec foto tar czf - /data > backup-$(date +%F).tgz`
- **Setări** (opționale, în `docker-compose.yml`): `PUBLIC_URL`, `DRIVE_FOLDER_NAME`, `DATA_DIR`.

### Varianta B – orice server cu PHP și Apache
Exact ca pe cPanel: pui conținutul arhivei `foto-santier-cpanel.zip` într-un folder servit de Apache (cu `AllowOverride All` și `mod_rewrite`), iar pentru Drive / NAS adaugi în cron `php /cale/api.php sync` la 5 minute.

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
5. Pune Client ID și Client secret în aplicație, la **Cont → Stocare** (la fel pe hosting și pe VPS).
6. În aplicație, ca admin: **Cont → Conectează Google Drive** și alege contul Google în care vrei pozele.

Aplicația cere doar acces la fișierele create de ea (`drive.file`). Nu vede restul fișierelor din Drive.
