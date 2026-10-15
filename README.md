# Site firmă construcții din lemn (NL / FR / EN)

Site modern, adaptat pentru mobil, în **trei limbi (neerlandeză, franceză, engleză)**, cu **panou de administrare** din care adaugi proiecte (albume) și poze.

## Ce conține

**Site public**
- Prima pagină: hero, servicii, „De ce lemn?”, realizări (proiecte cu filtre pe categorii), procesul în 4 pași, despre noi, întrebări frecvente, formular de ofertă gratuită
- Pagină pentru fiecare proiect, cu galerie foto și lightbox (swipe pe telefon, săgeți pe desktop)
- Comutator de limbă NL / FR / EN; limba se alege automat după browser și se ține minte
- Pe mobil: meniu tip hamburger și o bară fixă jos cu **Sună**, **WhatsApp** și **Ofertă gratuită**
- Pozele proiectelor apar automat în fundalul paginii principale

**Admin (`/admin`)**
- Login cu utilizator și parolă (parolă hash-uită cu scrypt, sesiune în cookie semnat, limită la încercările de login)
- **Proiecte**: creezi, editezi sau ștergi un proiect, cu titlu și descriere în NL/FR/EN, categorie, localitate, an, publicat sau ciornă, evidențiat
- **Poze**: încărcare multiplă direct din telefon (galerie sau cameră) ori prin drag & drop. Pozele sunt micșorate automat în browser înainte de upload. Poți alege coperta, reordona, adăuga descrieri și șterge
- **Mesaje**: cererile de ofertă trimise din formularul de pe site
- **Setări**: numele firmei, telefon, WhatsApp, e-mail, adresă, TVA, Facebook/Instagram, slogan, zonă de activitate, cifrele de pe prima pagină și schimbarea parolei

## Pornire

```bash
npm install
npm run create-admin -- admin ParolaTaSigura123   # creează contul de admin
npm start                                         # http://localhost:3000
```

Pentru a vedea site-ul plin înainte să ai poze proprii, adaugă 6 proiecte demo cu ilustrații:

```bash
npm run demo               # adaugă proiectele demo
npm run demo -- --remove   # le șterge când pui proiectele reale
```

Fără parolă (`npm run create-admin -- admin`) se generează una aleatorie și se afișează o singură dată.

Variabile opționale: `PORT`, `DATA_DIR` (implicit `./data`), `UPLOAD_DIR` (implicit `./uploads`), `SESSION_SECRET`.

## Găzduire

Ai nevoie de un server cu Node.js 18+ (de exemplu un VPS, Render, Railway sau Fly.io) cu **disc persistent** pentru `data/` și `uploads/`. Pune site-ul în spatele HTTPS, ca cookie-ul de login să fie marcat `Secure`.

Fă backup periodic la `data/db.json` și la folderul `uploads/`.

## Idei pentru mai departe
- Recenzii Google reale (în loc de testimoniale inventate)
- Secțiune „înainte / după” pentru renovări
- Calculator orientativ de preț pentru terase sau carporturi
- Notificare pe e-mail la fiecare cerere de ofertă nouă (SMTP)
- Logo-ul și pozele reale ale firmei (logo-ul e în `public/img/logo.svg`)

Cât timp un proiect nu are poze, site-ul afișează automat o ilustrație potrivită categoriei (din `public/img/illustrations/`, generate cu `node scripts/generate-illustrations.js`).
