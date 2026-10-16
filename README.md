# Șantier – aplicație pentru iPhone și iPad

Aplicație web instalabilă (PWA) pentru urmărirea șantierelor: planuri, puncte de observație/defecte, fotografii, firme, ședințe și rapoarte PDF. Funcționează **offline**, iar datele rămân pe dispozitiv.

## Funcții
- **Proiecte** cu beneficiar, adresă și responsabil.
- **Planuri**: import PDF (fiecare pagină devine un plan) sau imagini/fotografii. Le poți mări cu două degete și muta pe ecran.
- **Puncte pe plan**: atingi planul → **„Adaugă punct aici”** (sau ții apăsat pe plan). Fiecare punct are titlu, descriere, status (Deschis / În lucru / Rezolvat / Închis), prioritate, categorie, firmă responsabilă, termen, fotografii (cu desen/adnotare), comentarii și istoric.
- **Listă de puncte** cu căutare și filtre (status, firmă, plan, întârziate).
- **Firme / subcontractori** cu date de contact și statistici.
- **Ședințe de șantier**: participanți, discuții, puncte urmărite → **proces-verbal PDF** cu loc de semnături.
- **Rapoarte PDF** cu planurile și pinii, un extras de plan la fiecare punct și fotografiile. **Export CSV** pentru Excel.
- **Backup / restaurare** a tuturor datelor într-un fișier JSON (îl poți salva în iCloud Drive / Fișiere).

## Server propriu (Hostico sau orice găzduire cu cPanel, PHP și MySQL)
Cu server, datele stau într-o bază de date MySQL și sunt aceleași pe telefon, iPad și calculator. Echipa se conectează cu utilizator și parolă. Aplicația merge și fără internet: modificările se trimit automat când revine conexiunea.

1. **cPanel → MySQL Databases (Baze de date MySQL)**: creează o bază de date, un utilizator și o parolă, apoi adaugă utilizatorul la bază cu **ALL PRIVILEGES**.
2. **cPanel → File Manager**: urcă tot conținutul folderului `app/` în `public_html/` (sau într-un subfolder, de ex. `public_html/santier/`). Se poate urca arhiva `santier.zip` și apoi da **Extract**.
3. Deschide în browser `https://domeniul-tau.ro/api/install.php`, completează datele bazei (server: `localhost`) și creează contul de administrator.
4. Șterge fișierul `api/install.php` din File Manager.
5. Deschide `https://domeniul-tau.ro/` și conectează-te. Din meniul **Cont și sincronizare → Utilizatori** poți adăuga colegi.

### Trimitere e-mail din aplicație
Fiecare utilizator își setează adresa de pe care trimite: **meniul ⋯ → Adresa mea de e-mail (trimitere)**.
- **Adresă pe domeniul tău (Hostico)**: o creezi în cPanel → **Email Accounts**. Serverul e de obicei `mail.domeniul-tau`, port 465 SSL, iar utilizatorul e adresa completă.
- **Gmail**: ai nevoie de o *parolă pentru aplicații*, creată din Cont Google → Securitate, cu verificarea în 2 pași activată.
- Butonul **„Trimite-mi un e-mail de test”** verifică setările.

După generarea unui PV sau raport, butonul **„Trimite pe e-mail din aplicație”**:
- deschide lista firmelor din proiect, unde bifezi destinatarii, plus câmpuri pentru alte adrese și CC;
- completează automat subiectul și mesajul din șablon; le poți modifica înainte de trimitere;
- atașează PDF-ul.

Șabloanele se editează din **meniul ⋯ → Șabloane e-mail**.

Parola SMTP se păstrează criptată pe server și nu ajunge pe telefoane.

Notă: certificatul **SSL (https)** trebuie să fie activ (cPanel → SSL/TLS Status / AutoSSL), altfel iPhone-ul nu poate instala aplicația pentru folosire offline.

Planurile și fotografiile se salvează în `api/uploads/` (protejat, accesibil doar prin aplicație). Dacă un PDF/imagine mare nu urcă, mărește `upload_max_filesize` și `post_max_size` din cPanel → **Select PHP Version → Options**.

## Publicare pe GitHub Pages (fără server, datele doar pe dispozitiv)
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
