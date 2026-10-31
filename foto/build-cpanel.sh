#!/bin/sh
# Creează arhiva pentru hosting cPanel: dist/foto-santier-cpanel.zip
set -e
cd "$(dirname "$0")"
rm -rf dist/cpanel && mkdir -p dist/cpanel
cp -r public/* dist/cpanel/
cp php/api.php php/.htaccess dist/cpanel/
rm -f dist/foto-santier-cpanel.zip
(cd dist/cpanel && zip -qr ../foto-santier-cpanel.zip . -x '.DS_Store')
rm -rf dist/cpanel
echo "Gata: dist/foto-santier-cpanel.zip"
