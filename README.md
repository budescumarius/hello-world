# MADIBU Control (MVP)

Aplicație web simplă pentru firme mici de construcții (max 2 șantiere, echipă mică), orientată pe controlul marjei și al costurilor reale.

## Ce include MVP-ul

- Calculator profit pe proiect (cost real, profit, marjă %).
- Alertă automată când marja scade sub prag.
- Pontaj echipă (check-in / check-out, ore reale).
- Raport zilnic (ce s-a făcut, probleme, link poză).
- Dosar centralizat de date în browser (localStorage).
- Generator ofertă rapidă în franceză + print către PDF.

## Cum o lansezi local

### Varianta recomandată (server local)

1. Verifică să ai instalat **Node.js** și **Python 3**.
2. Rulează:

```bash
npm run start
```

3. Deschide în browser:

- `http://localhost:4173`

### Variantă rapidă (fără server)

- Poți deschide direct fișierul `index.html` în browser.

## Cum o testezi

### 1) Verificare sintaxă JavaScript

```bash
npm run check
```

### 2) Smoke tests (fără dependențe externe)

```bash
npm test
```

Testele verifică:

- existența formularelor cheie în UI,
- prezența logicii de bază în `app.js`,
- stilurile de alertă în CSS.

### 3) Test manual (5 minute)

1. Creezi un proiect nou.
2. Adaugi costuri + ore estimate.
3. Adaugi un pontaj cu ore mai mari decât estimatele.
4. Verifici că apare alertă de depășire.
5. Generezi o ofertă FR și apeși **Printează PDF**.

## Observații

- Datele sunt salvate local în browser (`localStorage`, key: `madibu-control-v1`).
- Este un MVP demo front-end (fără autentificare, backend, multi-user).
- Pentru producție recomandat: React + Firebase (Auth, Firestore, Storage, Functions).
