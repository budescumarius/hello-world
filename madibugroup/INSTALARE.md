# Site-ul Madibu Group – ghid de instalare

Site nou pentru www.madibugroup.be, cu panou de administrare. Înlocuiește vechiul WordPress.
Nu are nevoie de bază de date: conținutul se păstrează în fișiere (`data/`), iar pozele în `uploads/`.

## Ce conține

**Site public (franceză + neerlandeză):**
- **Pagini:** acasă, servicii („Métiers”, 5 pagini), realizări (cu filtre, galerie foto pe ecran mare și comparator înainte/după), blog („Journal”), contact.
- **Formularul de cerere de deviz:** mesajul ajunge pe e-mail și rămâne salvat în panoul de administrare.
- **Ce îi aduce pe vizitatori înapoi:** blog, proiectele „Chantier en cours”, abonare la noutăți, flux RSS (`/feed.xml`), distribuire pe Facebook și WhatsApp.
- **SEO:** sitemap (`/sitemap.xml`) și date structurate pentru Google. Adresele vechi din WordPress redirecționează (301) către paginile noi.
- **Pagina /pontaj:** e păstrată, cu formularul Smartsheet, și nu apare pe Google.

**Panoul de administrare (`/admin`):**
- **Realizări:** adaugi, modifici sau ștergi proiecte. Pozele le încarci prin glisare sau direct de pe telefon și le reordonezi tot prin glisare. Alegi coperta și perechea înainte/după.
- **Journal (blog):** scrii articole cu poze, cu previzualizare. Le poți și programa la o dată viitoare.
- **Mesaje:** cererile de deviz primite.
- **Abonați:** export CSV pentru Brevo sau Mailchimp.
- **Setări:** telefon, e-mail, adresă, TVA, Facebook/Instagram, Google Analytics, pozele serviciilor, parola.

## Cerințe pe hosting

- PHP **8.1 sau mai nou**, cu extensiile **GD** și **fileinfo** (sunt instalate standard pe cPanel).
- Apache cu `mod_rewrite` (standard).

## Instalare (cPanel → File Manager)

1. **Fă o copie completă** a site-ului actual (fișiere + baza de date). Backup-ul bazei de date îl ai deja.
2. În `public_html`, creează folderul `_wordpress-vechi`. Mută în el fișierele WordPress:
   - folderele `wp-admin` și `wp-includes`;
   - toate fișierele `wp-*.php`, plus `index.php`, `.htaccess`, `xmlrpc.php` și `license.txt`.

   **Nu muta `wp-content`.** Acolo sunt pozele proiectelor și site-ul nou le folosește.
3. Încarcă tot conținutul folderului `madibugroup/` în `public_html`, inclusiv fișierele `.htaccess`. Activează „Show hidden files” ca să le vezi.
4. Verifică permisiunile: folderele `data/` și `uploads/` trebuie să permită scrierea (755, sau 775 dacă 755 nu merge).
5. Deschide **https://www.madibugroup.be/admin/**. Site-ul îți cere un **cod de instalare**: deschide în File Manager fișierul `data/setup-code.txt`, copiază codul, apoi alege parola (minimum 10 caractere).
6. În panou, apasă **„Optimiser les photos”**. Pozele vechi (unele de câțiva MB) sunt copiate în `uploads/`, micșorate și curățate de datele GPS. Lasă pagina deschisă până scrie „Terminé”.
7. După ce verifici că site-ul arată bine, poți șterge `_wordpress-vechi` și apoi `wp-content`.

## Important – securitate

Backup-ul WordPress conținea, în clar, **parola SMTP** a contului de e-mail și o **cheie Google API**:
- **Schimbă parola** contului de e-mail folosit pentru SMTP.
- **Șterge sau restricționează** cheia Google Maps API din Google Cloud Console.
- **Nu publica fișierul backup** nicăieri.

## De completat din panou

- **Proiecte:** comuna, descrierea și tipul fiecăruia. Acum sunt doar titlul, anul și pozele, pentru că WordPress nu avea alte informații.
- **Setări:** numărul de TVA (BCE).
- **Pozele serviciilor:** sunt pozele de ilustrație din vechiul site. Înlocuiește-le cu poze de pe șantierele voastre.
- **Recenzii:** cele două de pe pagina principală sunt preluate de pe vechiul site. Le modifici în `app/strings.php` (`quote_1`, `quote_2`).
- **Traduceri:** pentru varianta în neerlandeză a proiectelor și articolelor, completează tab-ul „Nederlands”. Dacă rămâne gol, se afișează textul în franceză.

## Test local

```bash
cd madibugroup && php -S 127.0.0.1:8000 index.php
# site:  http://127.0.0.1:8000
# admin: http://127.0.0.1:8000/admin/
```
