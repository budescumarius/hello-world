# MADIBU Control (MVP)

Aplicație web simplă pentru firme mici de construcții (max 2 șantiere, echipă mică), orientată pe controlul marjei și al costurilor reale.

## Ce include MVP-ul

- Calculator profit pe proiect (cost real, profit, marjă %).
- Alertă automată când marja scade sub prag.
- Pontaj echipă (check-in / check-out, ore reale).
- Raport zilnic (ce s-a făcut, probleme, link poză).
- Dosar centralizat de date în browser (localStorage).
- Generator ofertă rapidă în franceză + print către PDF.

## Cum rulezi

Nu are nevoie de build.

1. Deschide fișierul `index.html` în browser.
2. Datele sunt salvate local în browser (`localStorage`).

## Observații

- Este un MVP demo front-end (fără autentificare, backend, multi-user).
- Pentru producție recomandat: React + Firebase (Auth, Firestore, Storage, Functions).
