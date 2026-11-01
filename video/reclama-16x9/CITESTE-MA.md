# Reclama BâtiPro – proiect HyperFrames (16:9, 67 s)

## Instalare (o singură dată)
1. Instalează **Node.js 22** (nodejs.org, versiunea LTS) și **FFmpeg** (Windows: `winget install ffmpeg`; Mac: `brew install ffmpeg`).
2. Deschide un terminal în acest folder.

Variantă fără terminal: aplicația **HyperFrames Studio** (hyperframes.dev/studio/download) – deschizi acest folder în ea.

## Folosire
- `npm run dev` – deschide editorul în browser: vezi video-ul, muți clipurile pe timeline, modifici.
- `npm run render` – face fișierul MP4 final.

## Ce modifici unde (în index.html)
- Textele: între `<h1>`, `<h2>`, `<p>`.
- Momentul unei scene: `data-start` / `data-duration` pe `<section class="scene clip">`.
- Când apare un element în scenă: `data-at="1.4"` (secunde de la începutul scenei).
- Ecranele: `assets/ecrane/*.jpg`.
- Vocea: `assets/voce/01.wav` … `09.wav` (textul lor e în `assets/voce/textes.txt`). Refaci o replică cu:
  `npx hyperframes tts "Votre texte ici" -v ff_siwis -o assets/voce/03.wav`
  apoi pui `data-duration` al `<audio id="v3">` la noua durată.
- Muzica: decomentează linia `<audio id="music">` de la final și pune fișierul `assets/musique.mp3` (cu licență comercială).

Voce: Kokoro TTS, vocea SIWIS (CC BY 4.0) – menționează „Voix : Kokoro TTS (SIWIS, CC BY 4.0)” în descriere.
