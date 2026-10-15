# Timberway — site nou (FR / NL / EN)

Site modern pentru Timberway (mobilier la comandă, tâmplărie, restaurare), adaptat pentru mobil, în **trei limbi (franceză, neerlandeză, engleză)**, cu **panou de administrare** din care adaugi proiecte (albume) și poze.

## Ce conține

**Site public**
- Prima pagină: hero cu sloganul „Your Space. Our Work. Your Way.”, servicii (bucătării, mobilier, băi, scări, parchet, restaurare), angajamentul Timberway, realizări cu filtre pe categorii, procesul în 3 pași, despre noi (atelierul din Vilvoorde, fondatorul), întrebări frecvente, formular de contact
- Pagină pentru fiecare proiect, cu galerie foto și lightbox (swipe pe telefon, săgeți pe desktop)
- Comutator de limbă NL / FR / EN; limba se alege automat după browser și se ține minte
- Pe mobil: meniu tip hamburger și o bară fixă jos cu **Sună**, **WhatsApp** și **Ofertă gratuită**
- Pozele proiectelor apar automat în fundalul paginii principale

**Admin (`/admin`)**
- Login cu utilizator și parolă (parolă hash-uită cu scrypt, sesiune în cookie semnat, limită la încercările de login)
- **Proiecte**: creezi, editezi sau ștergi un proiect, cu titlu și descriere în NL/FR/EN, categorie, localitate, an, publicat sau ciornă, evidențiat
- **Poze**: încărcare multiplă direct din telefon (galerie sau cameră) ori prin drag & drop. Pozele sunt micșorate automat în browser înainte de upload. Poți alege coperta, reordona, adăuga descrieri și șterge
- **Mesaje**: cererile de ofertă trimise din formularul de pe site
- **Setări**: numele firmei, telefon, WhatsApp, e-mail, adresă, TVA, fondator, program, Facebook/Instagram, slogan și schimbarea parolei

## Calculator de buget și notificări

- **/estimate**: clientul alege tipul de mobilă, dimensiunile, materialul și opțiunile, vede modelul în 3D și primește un interval de preț. Grila de prețuri se modifică din admin → **Prețuri**.
- **Notificări pe e-mail**: în admin → Setări → „Notificări” pui adresa la care vrei să primești cererile de ofertă. E-mailurile pleacă prin `sendmail`-ul serverului (există pe găzduirea cPanel), deci nu e nevoie de parolă SMTP. Butonul „Trimite e-mail de test” verifică dacă merge.

## Pornire

```bash
npm install
npm run create-admin -- admin ParolaTaSigura123   # creează contul de admin
npm start                                         # http://localhost:3000
```

Pentru a importa proiectele Timberway, cu poze (14 proiecte; cele fără poze rămân ascunse):

```bash
npm run seed               # adaugă proiectele cu poze
npm run seed -- --remove   # le șterge
```

Pozele proiectelor se pun în `seed/photos/<proiect>/` (ex. `seed/photos/ixelles/01.webp`, `02.webp`…). Se iau în ordinea numelui, iar ultima poză devine copertă.

Fără parolă (`npm run create-admin -- admin`) se generează una aleatorie și se afișează o singură dată.

Variabile opționale: `PORT`, `DATA_DIR` (implicit `./data`), `UPLOAD_DIR` (implicit `./uploads`), `SESSION_SECRET`.

## Punere online (Render)

Fișierul `render.yaml` configurează totul: serverul, un disc permanent pentru baza de date și poze, și parola de admin.

1. Intră pe https://render.com și fă-ți cont cu **GitHub**. Când ți se cere, dă-i acces la repository-ul `hello-world`.
2. **New → Blueprint**, alege `hello-world` și branch-ul `claude/timberway-clone-mobile-27pjd8`.
3. La `ADMIN_PASSWORD` scrie parola de admin (minim 10 caractere), apoi **Apply**.
4. După 3–5 minute site-ul e live la `https://timberway-xxxx.onrender.com`, iar adminul la `/admin` (utilizator `admin`).

La prima pornire se creează contul de admin și se importă automat proiectele cu poze. La pornirile următoare nu se mai importă nimic, ca să nu se piardă modificările făcute din admin.

**Cost:** planul Starter (~7 $/lună) plus discul (~0,25 $/GB/lună). Planul gratuit nu are disc permanent, așa că pozele încărcate din admin s-ar pierde la fiecare repornire.

**Domeniul timberway.be:** în Render → Settings → Custom Domains adaugi `www.timberway.be` și `timberway.be`, apoi pui la firma de unde ai domeniul înregistrările DNS pe care ți le arată Render. HTTPS-ul se configurează automat.

Fă backup periodic la discul `/var/data` (baza de date și pozele).

## Idei pentru mai departe
- Recenzii Google reale (în loc de testimoniale inventate)
- Secțiune „înainte / după” pentru renovări
- Calculator orientativ de preț pentru terase sau carporturi
- Notificare pe e-mail la fiecare cerere de ofertă nouă (SMTP)
- Logo-ul și pozele reale ale firmei (logo-ul e în `public/img/logo.svg`)

Cât timp un proiect nu are poze, site-ul afișează automat o ilustrație potrivită categoriei (din `public/img/illustrations/`, generate cu `node scripts/generate-illustrations.js`).
