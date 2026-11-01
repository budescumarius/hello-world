#!/bin/sh
# Creează arhiva pentru hosting cPanel: dist/foto-santier-cpanel.zip
# Codul (app.js, sw.js, styles.css) este micșorat cu esbuild, dacă e disponibil.
set -e
cd "$(dirname "$0")"
OUT=dist/cpanel
rm -rf "$OUT" && mkdir -p "$OUT"
cp -r public/* "$OUT"/
cp php/api.php php/.htaccess "$OUT"/

ESBUILD="${ESBUILD:-$(command -v esbuild || true)}"
[ -z "$ESBUILD" ] && npx --yes esbuild@0.24 --version >/dev/null 2>&1 && ESBUILD="npx --yes esbuild@0.24"
if [ -n "$ESBUILD" ]; then
  for f in app.js sw.js; do $ESBUILD "public/$f" --minify --target=es2020 --charset=utf8 --log-level=warning --outfile="$OUT/$f"; done
  $ESBUILD public/styles.css --minify --target=safari14 --charset=utf8 --log-level=warning --outfile="$OUT/styles.css"
  echo "Cod micșorat cu esbuild."
else
  echo "esbuild lipsește: codul rămâne nemicșorat."
fi

rm -f dist/foto-santier-cpanel.zip
(cd "$OUT" && zip -qr ../foto-santier-cpanel.zip . -x '.DS_Store')
rm -rf "$OUT"
echo "Gata: dist/foto-santier-cpanel.zip"
