# MADIBU Control (React model)

Am migrat proiectul la un model React (Vite), inspirat din structura pe care ai trimis-o.

## Ce ai acum

- App React în `src/App.jsx` cu:
  - proiecte,
  - pontaj,
  - costuri,
  - calcul profit + marjă.
- Entry point React în `src/main.jsx`.
- Stiluri de bază în `src/app.css`.
- Versiunea statică anterioară a fost păstrată în folderul `legacy/`.

## Cum pornești aplicația

```bash
npm install
npm run dev
```

Apoi deschizi:

- `http://localhost:5173`

## Build producție

```bash
npm run build
npm run preview
```

## Observații

- Modelul actual este React local-first (fără Firebase activ).
- Dacă vrei, următorul pas este integrarea completă cu Firebase Auth + Firestore exact pe structura codului tău.
