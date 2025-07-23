# YoutubeTo1MinClips

**YoutubeTo1MinClips** est un outil qui télécharge une vidéo YouTube, la découpe en clips de 1 minute maximum, et recadre les vidéos au format portrait (1080×1920) avec audio.  
Tout se fait en local, sans dépendances globales, grâce à `yt-dlp` et `ffmpeg` inclus dans le projet.

## Installation

1. Téléchargez le ZIP projet depuis [GitHub](https://github.com/nikoazax2/YoutubeTo1MinClips/archive/refs/heads/main.zip)
2. Extrayez l'archive dans un dossier de votre choix
3. Lancez l'exécutable `maindl.exe`

C'est tout ! Le logiciel téléchargera automatiquement les binaires nécessaires (`yt-dlp.exe` et `ffmpeg.exe`) s'ils ne sont pas déjà présents dans le dossier.

## Fonctionnalités

- Télécharge une vidéo YouTube au format `.mp4`
- Découpe la vidéo entre deux timecodes spécifiés (début et fin)
- Génère plusieurs clips de 1 minute maximum chacun
- Recadre les vidéos au format portrait 9:16 (1080×1920)
- Conserve l’audio
- Fonctionne avec un script Node.js ou un `.exe` Windows sans Node installé

## Structure du projet

```

YoutubeTo1MinClips/
├── maindl.js # Script Node.js interactif
├── yt-dlp.exe # Binaire yt-dlp (Windows)
├── ffmpeg.exe # Binaire ffmpeg (Windows)
├── maindl.exe # (optionnel) Exécutable compilé avec pkg

```

## Pré-requis

- Si vous utilisez le script Node.js :
  - [Node.js](https://nodejs.org/) installé
- Si vous utilisez l’exécutable `.exe` :
  - Aucun pré-requis
  - Les binaires `ffmpeg.exe` et `yt-dlp.exe` doivent être dans le même dossier que le script ou l’exécutable

## Utilisation

### Avec Node.js

```bash
node maindl.js
```

### Avec l’exécutable

```bash
./maindl.exe
```

Le programme vous demandera :

- le lien YouTube
- le timecode de début (exemple : `00:00`)
- le timecode de fin (exemple : `05:00`)

Puis il produira plusieurs fichiers dans le même dossier, par exemple :

```
video_temp_part1_portrait.mp4
video_temp_part2_portrait.mp4
…
```

## Notes

- Les vidéos sont découpées proprement avec FFmpeg pour une qualité optimale.
- Les sous-titres automatiques TikTok ne sont pas générés par cet outil.
- Ce projet est conçu pour Windows. Une adaptation pour Linux/Mac est possible en utilisant les binaires appropriés.
