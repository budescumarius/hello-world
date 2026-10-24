# BâtiPro – vânzare pe abonament, partea legală și găzduire

Ghid practic pentru a vinde BâtiPro altor firme (lunar sau anual). Fișierul nu este accesibil din browser (`.htaccess` blochează `.md`).

---

## 1. Cum funcționează (pe scurt)

1. O firmă nouă intră pe pagina de conectare → **« Essayez gratuitement 14 jours »** → completează numele firmei, e-mailul, parola și bifează acceptarea condițiilor. Nu dă card.
2. Are imediat contul ei, complet separat de al tău și de al celorlalți (aceeași instalare, date izolate pe firmă). Sus apare banda « Essai gratuit : encore X jours ».
3. Cu 3 zile înainte de final primește o notificare și un e-mail. La final, accesul se blochează (datele rămân). Administratorul firmei vede doar pagina **« Mon abonnement »**.
4. Alege formula → plătește la Mollie (Bancontact, card, domiciliere) → revine în aplicație, contul se deblochează imediat.
5. Mollie reînnoiește plata automat în fiecare lună sau an. La fiecare plată:
   - aplicația creează **automat factura** în firma ta (Madibu Group, Argent → Factures, seria ta normală de facturi);
   - clientul o vede în « Mon abonnement »;
   - tu primești o notificare.
6. Dacă o plată eșuează, clientul are **7 zile de grație**, apoi accesul se blochează până plătește.
7. Clientul poate oricând să își schimbe formula, să **rezilieze**, să **exporte toate datele** (ZIP) sau să ceară ștergerea contului.

Tu (super-administrator) vezi totul în **Plateforme**:
- venitul lunar recurent (MRR);
- starea fiecărei firme;
- butonul 🪙, cu care poți oferi gratuit, prelungi sau schimba formula unei firme;
- firmele de șters după 90 de zile.

Firmele pe care le aveai deja rămân « Sans abonnement » (gratuit, nelimitat) până le schimbi tu.

---

## 2. Lansare – pașii, în ordine

### A. Datele firmei tale (5 min)
**Paramètres → Entreprise** (în firma Madibu Group): numele, adresa completă, TVA, **număr BCE** (*Numéro d'entreprise*), e-mail, telefon, site.

Ele apar automat în CGU, în politica de confidențialitate, în mențiunile legale și pe facturile de abonament.

### B. Contul Mollie (1–3 zile, verificare)
1. Creează contul pe **mollie.com** ca firmă (Madibu Group). Ai nevoie de:
   - buletinul tău;
   - extrasul de cont;
   - **o pagină web publică cu prețurile, condițiile (CGV) și datele de contact.**
   
   Mollie verifică site-ul înainte de activare. Poți folosi pagina de prezentare (vezi pasul E) și link-urile `legal.php`.
2. Activează metodele de plată:
   - **Bancontact**;
   - **carte bancare**;
   - **SEPA Direct Debit** (domiciliere). Aceasta e obligatorie pentru reînnoirea automată: prima plată prin Bancontact sau card creează un mandat SEPA, iar următoarele plăți se fac automat.
3. Mollie → *Développeurs → Clés API*: copiază mai întâi cheia **test_…**.
4. Pune autentificarea în doi pași (2FA) și pe contul Mollie.

### C. Configurare în aplicație (10 min)
**Plateforme → Vente en ligne (abonnements)**:
1. Lipește cheia `test_…`.
2. Verifică formulele și prețurile, zilele de probă (14) și de grație (7).
3. Bifează **« Ouvrir les inscriptions »** → Enregistrer.
4. Fă un test complet:
   - înscrie o firmă de test cu alt e-mail;
   - plătește în modul test (Mollie îți arată o pagină de test unde alegi « paid »);
   - verifică factura;
   - reziliază.
5. Când totul e bine, înlocuiește cu cheia **live_…**.

Adresa de notificare Mollie (webhook) se transmite automat la fiecare plată; nu trebuie configurată nimic în Mollie.

**Formulele actuale** (le poți schimba oricând; o schimbare se aplică doar clienților noi și la schimbarea de formulă):

| Formula | Versiune | Lunar | Anual | Utilizatori birou | Accese teren |
|---|---|---|---|---|---|
| Simplifié | simplificată | 24 € | 240 € | 1 | — |
| Avancé | completă | 69 € | 690 € | 3 | 10 |
| Avancé Équipe | completă | 119 € | 1 190 € | 10 | 50 |

Prețurile sunt fără TVA. Anualul = 10 luni (2 luni gratuite). Limitele sunt verificate automat: dacă un client vrea un utilizator în plus, aplicația îi cere să treacă la formula superioară.

### D. Documentele legale (verificare de către jurist – recomandat)
**Plateforme → Vente en ligne → Documents légaux.** Paginile publice sunt:
- `legal.php?doc=mentions`
- `legal.php?doc=cgu`
- `legal.php?doc=confidentialite`
- `legal.php?doc=dpa`

Le-am scris pentru o vânzare **B2B în Belgia**, după dreptul belgian și RGPD:
- **CGU / CGV:**
  - doar clienți profesioniști;
  - 14 zile de probă;
  - plată în avans și reînnoire automată;
  - reziliere oricând, cu efect la finalul perioadei plătite;
  - 7 zile de grație;
  - răspunderea ta limitată la sumele plătite în ultimele 12 luni;
  - datele păstrate 90 de zile după final;
  - dreptul belgian și tribunalul ales de tine.
- **Politica de confidențialitate:** ce date colectezi despre clienții tăi, cât timp, cine le primește, drepturile lor, autoritatea APD, doar cookie de sesiune (deci fără banner de cookie-uri).
- **DPA (acord de prelucrare, art. 28 RGPD):** clientul e responsabil de datele lui (clienți, muncitori), tu ești « sous-traitant ». Conține lista sub-procesatorilor (Hostico, Mollie, Peppyrus, Anthropic pentru asistentul AI opțional), notificarea în 48 h a unei breșe și ștergerea la final.
- **Mențiuni legale.**

La înscriere, aplicația salvează pentru fiecare client **versiunea, data, IP-ul și browserul** cu care a acceptat. E dovada ta în caz de litigiu.

> ⚠️ Sunt modele serioase, dar **nu înlocuiesc un avocat**. O verificare de către un avocat belgian specializat în IT/RGPD costă de obicei câteva sute de euro și merită făcută o dată, înainte de primii clienți plătitori. Dacă modifici textele, schimbă și data « En vigueur le ».

### E. Restul formalităților (o dată)
- **BCE:**
  - verifică la contabil sau la guichet d'entreprises că Madibu Group are înscrise activitățile de **editare de software / servicii informatice** (coduri NACE pentru software și găzduire de date);
  - dacă nu, adaugă-le.
- **Contabil:**
  - facturile de abonament intră în seria ta normală de facturi;
  - aplicația pune 21 % TVA pentru firmele belgiene și **autolichidare** (« autoliquidation ») pentru firmele din alte țări UE cu număr de TVA valid.
  
  Spune-i contabilului că ai acest venit nou.
- **Peppol:** din 2026, facturile B2B între firme belgiene trebuie trimise electronic. Notificarea « Paiement reçu » îți spune când factura trebuie trimisă prin Peppol: deschizi factura → Peppol (un clic).
- **Marca:** verifică dacă numele « BâtiPro » e liber la **BOIP** (Benelux) și EUIPO înainte să investești în publicitate. Există deja produse cu nume asemănătoare. Dacă e ocupat, alege acum un nume propriu și înregistrează-l (Benelux: câteva sute de euro).
- **Asigurare:** RC profesională IT plus o asigurare cyber (pierdere de date, atac). Întreabă-ți brokerul.
- **Registrul de prelucrări (RGPD art. 30):** un tabel simplu cu ce date ai, de ce, cât timp și cine le vede. Poți copia structura din politica de confidențialitate.
- **Site de prezentare:** o pagină simplă (poate fi pe madibugroup.be) cu:
  - ce face aplicația, cu capturi de ecran;
  - prețurile;
  - butonul « Essai gratuit » → `https://batipro.madibugroup.be/#/inscription`;
  - link-urile către documentele legale.

  Mollie cere această pagină, iar clienții au nevoie de ea ca să te găsească.

---

## 3. Găzduire (hosting)

### Unde ești acum
**Hostico, găzduire partajată cPanel** (`/home2/madibugr/batipro.madibugroup.be`). E **bun pentru început**: până la aproximativ **10–20 de firme** și câteva zeci de utilizatori activi.

Ce ai deja:
- HTTPS obligatoriu;
- protecție contra spargerii parolelor;
- 2FA;
- backup zilnic automat (14 zile + 12 luni), cu o copie trimisă pe e-mail în fiecare săptămână;
- cron la 5 minute.

Verifică în contul Hostico în ce **țară** e serverul (România = UE ✓). Documentele legale spun « Hostico (Roumanie, Union européenne) »; schimbă textul dacă e altundeva.

### Ce să faci chiar acum (gratuit sau aproape)
1. **Monitorizare:** cont gratuit pe **UptimeRobot**, cu o verificare la 5 minute pe `https://batipro.madibugroup.be/legal.php`. Primești e-mail sau SMS dacă site-ul cade.
2. **E-mail profesional de trimitere:**
   - în cPanel → *Email Deliverability*, repară **SPF și DKIM** (butonul « Repair»);
   - adaugă un DMARC simplu (`v=DMARC1; p=none; rua=mailto:tu@madibugroup.be`).

   Fără ele, e-mailurile de facturi și notificări ajung în spam la clienți.
3. **Copie de siguranță în afara Hostico:**
   - backupul săptămânal vine deja pe e-mail;
   - descarcă în plus, o dată pe lună, arhiva completă (Plateforme → Sauvegardes → ZIP complet) pe un disc sau cloud personal.
4. **2FA peste tot:** contul tău BâtiPro, cPanel Hostico, Mollie, e-mail.
5. **Versiune PHP:** cPanel → *Select PHP Version* → **8.2 sau 8.3**, cu extensiile `pdo_mysql`, `curl`, `zip`, `mbstring`, `openssl`, `gd`, `opcache` bifate.
6. **Copie de test (staging):**
   - un subdomeniu, de exemplu `test.madibugroup.be`, cu o bază de date separată;
   - acolo încerci fiecare actualizare înainte s-o pui pe site-ul real.

### Când treci la un server dedicat (VPS)
Semnale:
- mai mult de 15–20 de firme plătitoare;
- lentoare la ore de vârf;
- e-mailuri refuzate (limita de trimitere a găzduirii partajate, de obicei câteva sute pe oră);
- spațiu pe disc aproape plin din cauza pozelor.

Opțiuni (toate în UE):

| Varianta | Pentru cine | Cost aproximativ |
|---|---|---|
| **Hostico VPS / cPanel** | rămâi la același furnizor, aceeași interfață cPanel | mediu |
| **Combell** (Belgia) | găzduire administrată, suport în franceză/olandeză, imagine „belgiană” pentru clienți | mai scump |
| **Hetzner Cloud** (Germania/Finlanda) sau **OVHcloud** (Franța) | foarte bun raport preț/putere; necesită un panou (de ex. Ploi, RunCloud, cPanel) sau un administrator | ieftin |

Mutarea se face simplu:
1. copiezi fișierele și baza de date (*Sauvegardes → restaurare*);
2. schimbi DNS-ul;
3. actualizezi lista sub-procesatorilor în DPA (și anunți clienții cu 30 de zile înainte, cum scrie în contract).

### Când crești mai mult
- **E-mail tranzacțional dedicat**, cu servere în UE: Brevo sau Mailjet (Franța). Configurezi SMTP-ul lor în aplicație și adaugi furnizorul în lista sub-procesatorilor.
- **Fișiere (poze, planuri) pe stocare separată** și backup automat zilnic către un al doilea furnizor (de ex. Backblaze B2 UE sau un bucket S3 la Hetzner/OVH).
- **Domeniu propriu pentru produs** (de ex. un `.be` sau `.eu` cu numele mărcii), în loc de subdomeniul madibugroup.be. Arată mai profesionist și separă produsul de firma de construcții.

---

## 4. Sfaturi de vânzare
- **Primii 3–5 clienți:** firme pe care le cunoști. Oferă-le 2–3 luni gratuite sau un preț redus pe viață în schimbul feedbackului. Butonul 🪙 din Plateforme îți permite să le prelungești proba sau să le pui „Sans abonnement”.
- **Prețul:** formulele actuale sunt sub multe programe de construcții din Belgia, care pornesc adesea de la peste 50–100 €/utilizator/lună. Nu coborî prea mult: suportul îți consumă timp.
- **Anualul:** împinge-l (2 luni gratuite). Primești banii în avans și pierzi mai puțini clienți.
- **Suportul:**
  - un e-mail dedicat (de ex. support@…);
  - răspuns în aceeași zi lucrătoare;
  - o pagină de întrebări frecvente.
- **Demo:** un cont de demonstrație cu date fictive (proiecte, devize, facturi), pe care îl arăți la întâlniri.
- **Urmărește în Plateforme:**
  - MRR-ul;
  - probele care nu se transformă în clienți plătitori;
  - motivele de reziliere (clientul le scrie la reziliere).

---

## 5. Ce depinde de cine
- **Aplicația** rulează **doar pe serverul tău** (Hostico). Nu depinde de Claude sau de abonamentul Claude. Dacă nu mai ai Claude, aplicația merge mai departe la fel.
- **Asistentul AI din aplicație** (opțional) folosește cheia API Anthropic pe care o pui tu în Paramètres; se plătește separat, după consum.
  > ⚠️ Dacă cheia ta (firma Madibu) **nu** are bifat « Réserver cette clé à ma firme », toate firmele-client fără cheie proprie o folosesc și **tu plătești consumul lor**. Pentru vânzare: bifează opțiunea (fiecare client își pune cheia lui) sau include AI-ul doar în formulele scumpe.
- **Plățile** depind de Mollie, iar **Peppol** de Peppyrus. Dacă unul dintre ei e indisponibil, aplicația funcționează în continuare; doar plata sau trimiterea așteaptă.
