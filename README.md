# YoutubeTo1MinClips

**YoutubeTo1MinClips** est un outil qui télécharge une vidéo YouTube, la découpe en clips de 1 minute maximum, et recadre les vidéos au format portrait (1080×1920) **ou ajoute des bandes floutées en paysage** avec audio.  
Tout se fait en local, sans dépendances globales, grâce à `yt-dlp` et `ffmpeg` inclus dans le projet.

➡️ Le but est de faciliter la création de clips courts pour TikTok, Instagram Reels, ou YouTube Shorts à partir de vidéos YouTube.

## Installation

1. Téléchargez le ZIP du projet ici : [YoutubeTo1MinClips.zip](https://github.com/nikoazax2/YoutubeTo1MinClips/archive/refs/heads/main.zip)
2. Extrayez l'archive dans un dossier de votre choix
3. Lancez l'exécutable `maindl.exe`

C'est tout ! Le logiciel téléchargera automatiquement les binaires nécessaires (`yt-dlp.exe` et `ffmpeg.exe`) s'ils ne sont pas déjà présents dans le dossier.

## Fonctionnalités

- Télécharge une vidéo YouTube au format `.mp4`
- Découpe la vidéo entre deux timecodes spécifiés (début et fin)
- Génère plusieurs clips de 1 minute maximum chacun
- **Deux modes de recadrage vidéo :**
  - **Portrait 9:16 (1080×1920)**
  - **Paysage avec bandes floutées (blur fill)** pour conserver l'intégralité de l'image sans crop
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
- le format de sortie :
  - **1** : téléphone recadré (portrait 9:16)
  - **2** : paysage avec bandes floutées (blur fill)

Puis il produira plusieurs fichiers dans le même dossier, par exemple :

```
video_temp_part1_portrait.mp4
video_temp_part2_portrait.mp4
video_temp_part1_blurfill.mp4
video_temp_part2_blurfill.mp4
…
```

## Notes

- Les vidéos sont découpées proprement avec FFmpeg pour une qualité optimale.
- Le mode "bandes floutées" (blur fill) permet de générer des vidéos paysage adaptées aux réseaux sociaux tout en gardant l'intégralité de l'image.
- Les sous-titres automatiques TikTok ne sont pas générés par cet outil.
- Ce projet est conçu pour Windows. Une adaptation pour Linux/Mac est possible en utilisant les binaires appropriés.
