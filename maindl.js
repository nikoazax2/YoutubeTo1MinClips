#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");
const https = require("https");
const unzipper = require("unzipper");

// Whisper pour la transcription locale (via @xenova/transformers)
let whisperPipeline = null;

async function initWhisper() {
    if (whisperPipeline) return whisperPipeline;
    try {
        const { pipeline } = await import('@xenova/transformers');
        console.log("🔄 Chargement du modèle Whisper (première utilisation peut prendre du temps)...");
        whisperPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', {
            quantized: true // Utilise le modèle quantifié pour de meilleures performances
        });
        console.log("✅ Modèle Whisper chargé!");
        return whisperPipeline;
    } catch (err) {
        console.error("⚠️ Impossible de charger @xenova/transformers:", err.message);
        return null;
    }
}

// Speed-up removed: the video will be processed at normal speed

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function ask(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

function toSeconds(time) {
    const parts = time.split(":").map(Number);
    if (parts.length === 3) {
        const [h, m, s] = parts;
        return h * 3600 + m * 60 + s;
    } else if (parts.length === 2) {
        const [m, s] = parts;
        return m * 60 + s;
    } else {
        return parts[0] || 0;
    }
}

/**
 * SYSTÈME ANTI-DÉTECTION AVANCÉ
 * Génère des variations aléatoires pour chaque segment afin de tromper
 * les algorithmes de fingerprinting de TikTok/YouTube/Instagram.
 */

// Fonction utilitaire pour générer un nombre aléatoire dans une plage
function randomInRange(min, max, decimals = 4) {
    const value = min + Math.random() * (max - min);
    return parseFloat(value.toFixed(decimals));
}

// Fonction utilitaire pour choisir aléatoirement dans un tableau
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Génère un ensemble d'effets UNIQUES pour chaque segment
 * Chaque appel retourne des valeurs différentes pour contourner la détection
 */
function generateUniqueEffects() {
    return {
        // Colorimétrie avec variations
        saturation: randomInRange(1.01, 1.06),      // +1% à +6% saturation
        contrast: randomInRange(1.00, 1.04),        // +0% à +4% contraste
        gamma: randomInRange(0.98, 1.04),           // -2% à +4% gamma
        brightness: randomInRange(-0.02, 0.03),     // -2% à +3% luminosité

        // Nouvelles modifications de couleur (anti-détection TikTok)
        hue: randomInRange(-5, 5),                  // Rotation teinte -5° à +5°
        colorTempR: randomInRange(0.97, 1.03),      // Balance rouge
        colorTempG: randomInRange(0.98, 1.02),      // Balance vert
        colorTempB: randomInRange(0.96, 1.04),      // Balance bleu

        // Micro-rotation variable (en degrés)
        rotationDeg: randomInRange(0.1, 0.5),       // 0.1° à 0.5°

        // Zoom variable
        zoom: randomInRange(1.01, 1.04),            // 1% à 4% de zoom

        // Décalage horizontal/vertical variable
        panX: randomInRange(2, 12),
        panY: randomInRange(1, 8),

        // Grain variable (bruit)
        grain: randomInRange(2, 6),

        // Flou/netteté variable
        blur: randomInRange(0.2, 0.6),

        // Ondulation/vaguelettes subtiles (décalage chromatique quasi invisible)
        rgbaShiftH: randomInRange(0, 0),           // Décalage horizontal des canaux
        rgbaShiftV: randomInRange(0, 0),           // Décalage vertical des canaux

        // Vignette TRÈS subtile (quasi invisible mais modifie le fingerprint)
        // angle proche de PI/2 (1.57) = très peu de vignette
        vignetteAngle: randomInRange(1.3, 1.5),
        vignetteX0: randomInRange(0.48, 0.52),
        vignetteY0: randomInRange(0.48, 0.52),

        // Légère distorsion de lens (nouveau)
        lensK1: randomInRange(-0.02, 0.02),
        lensK2: randomInRange(-0.01, 0.01),

        // Audio : pitch shift désactivé pour maintenir la vitesse originale
        pitchShift: 1.0,                            // Pas de modification du pitch

        // Audio : EQ variable
        bassGain: randomInRange(0.5, 2.5),          // +0.5 à +2.5 dB basses
        trebleGain: randomInRange(-1.5, 0.5),       // -1.5 à +0.5 dB aigus

        // Vitesse désactivée pour éviter désynchronisation audio/vidéo
        speed: 1.0,                                 // Toujours 1.0 pour garder sync

        // Miroir horizontal (flip)
        mirror: true,

        // Logo/Watermark
        logo: {
            enabled: true,
            file: 'logo.jpg',
            position: 'bd',
            scale: randomInRange(0.10, 0.14),       // Taille variable
            opacity: randomInRange(0.85, 1.0),      // Opacité variable
            margin: Math.floor(randomInRange(8, 15)),
        },

        // Paramètres d'encodage variables (nouveau)
        crf: Math.floor(randomInRange(21, 25)),     // Qualité variable
        preset: randomChoice(['fast', 'medium']),   // Preset variable
    };
}

// Effets par défaut (utilisés pour l'affichage des valeurs de base)
const EFFECTS = {
    saturation: 1.02,
    contrast: 1.01,
    gamma: 1.01,
    brightness: 0.01,
    hue: 0,
    colorTempR: 1.0,
    colorTempG: 1.0,
    colorTempB: 1.0,
    rotationDeg: 0.2,
    zoom: 1.02,
    panX: 5,
    panY: 3,
    grain: 3,
    blur: 0.3,
    vignetteAngle: 1.4,
    vignetteX0: 0.5,
    vignetteY0: 0.5,
    lensK1: 0,
    lensK2: 0,
    pitchShift: 1.0,
    bassGain: 1.5,
    trebleGain: -0.5,
    speed: 1.0,
    mirror: true,
    logo: {
        enabled: true,
        file: 'logo.jpg',
        position: 'bd',
        scale: 0.12,
        opacity: 1,
        margin: 10,
    },
    crf: 23,
    preset: 'fast',
};

/**
 * Retourne la position du logo pour FFmpeg overlay
 * @param {string} position - hg, hd, bg, bd
 * @param {number} margin - marge en pixels
 * @returns {string} - expression overlay pour FFmpeg
 */
function getLogoPosition(position, margin) {
    const positions = {
        'hg': `${margin}:${margin}`,                      // haut-gauche
        'hd': `W-w-${margin}:${margin}`,                  // haut-droite
        'bg': `${margin}:H-h-${margin}`,                  // bas-gauche
        'bd': `W-w-${margin}:H-h-${margin}`,              // bas-droite
    };
    return positions[position] || positions['bd'];
}

/**
 * Construit la chaîne de filtres vidéo pour les effets de transformation.
 * ANTI-DÉTECTION: Inclut colorimétrie, hue, colorbalance, vignette, rotation, zoom, grain, miroir, logo et watermark.
 * @param {boolean} useBlurFill - Si true, utilise le format blur fill, sinon crop simple
 * @param {boolean} hasLogo - Si true, le logo sera ajouté
 * @param {boolean} hasWatermark - Si true, le watermark sera ajouté par-dessus la vidéo
 * @param {object} effects - Effets uniques générés pour ce segment
 * @returns {string} - La chaîne de filtres vidéo pour FFmpeg
 */
function buildVideoFilter(useBlurFill, hasLogo = false, hasWatermark = false, effects = EFFECTS) {
    const rotationRad = (effects.rotationDeg * Math.PI / 180).toFixed(6);

    // Filtre de colorimétrie de base
    const colorFilter = `eq=saturation=${effects.saturation}:contrast=${effects.contrast}:gamma=${effects.gamma}:brightness=${effects.brightness}`;

    // NOUVEAU: Filtre de teinte (hue shift) - très efficace anti-détection
    const hueFilter = `hue=h=${effects.hue}`;

    // NOUVEAU: Balance des couleurs RGB (colorbalance) - modifie le fingerprint
    const colorBalanceFilter = `colorbalance=rs=${(effects.colorTempR - 1).toFixed(3)}:gs=${(effects.colorTempG - 1).toFixed(3)}:bs=${(effects.colorTempB - 1).toFixed(3)}`;

    // Remplacé vignette par un léger décalage de couleur (invisible mais modifie le fingerprint)
    // curves permet de modifier très légèrement les tons sans effet visible
    const curvesFilter = `curves=r='0/0 1/1':g='0/0 1/1':b='0/0.01 1/0.99'`;

    // NOUVEAU: Vaguelettes/ondulations subtiles via décalage chromatique (rgbashift)
    // Décale légèrement les canaux R/G/B - quasi invisible mais modifie chaque pixel
    const rgbaShiftH = effects.rgbaShiftH || 0;
    const rgbaShiftV = effects.rgbaShiftV || 0;
    const waveFilter = `rgbashift=rh=${rgbaShiftH}:rv=${rgbaShiftV}:gh=${-rgbaShiftH}:gv=${-rgbaShiftV}:bh=${Math.round(rgbaShiftH / 2)}:bv=${Math.round(rgbaShiftV / 2)}`;

    // Filtre de rotation avec zoom intégré
    const zoomScale = `scale=iw*${effects.zoom}:ih*${effects.zoom}`;
    const rotateFilter = `rotate=${rotationRad}:c=black@0:ow=rotw(${rotationRad}):oh=roth(${rotationRad})`;

    // Filtre de grain (noise) - avec composante couleur pour plus d'unicité
    const grainFilter = `noise=alls=${effects.grain}:allf=t+u`;

    // Filtre de flou subtil
    const blurFilter = `unsharp=5:5:${effects.blur}:5:5:0`;

    // Filtre miroir horizontal
    const mirrorFilter = effects.mirror ? ',hflip' : '';

    // NOUVEAU: Filtre de vitesse vidéo (setpts) - très efficace contre fingerprinting
    const speedFilter = effects.speed !== 1.0 ? `setpts=${(1 / effects.speed).toFixed(4)}*PTS` : '';

    // Combinaison des filtres de couleur avancés (sans vignette qui cachait la vidéo)
    const advancedColorFilters = `${colorFilter},${hueFilter},${colorBalanceFilter},${curvesFilter},${waveFilter}`;

    // Logo overlay (si activé)
    const logoPos = getLogoPosition(effects.logo.position, effects.logo.margin);
    const logoScale = `scale=1080*${effects.logo.scale}:-1`;
    const logoOpacity = effects.logo.opacity < 1 ? `,format=rgba,colorchannelmixer=aa=${effects.logo.opacity}` : '';

    // Ajout conditionnel du filtre de vitesse
    const speedPart = speedFilter ? `,${speedFilter}` : '';

    // Index des inputs: [0:v]=vidéo, [1:v]=watermark (si présent), [2:v]=logo (si watermark+logo) ou [1:v]=logo (si logo seul)
    const watermarkInput = hasWatermark ? (hasLogo ? '[1:v]' : '[1:v]') : '';
    const logoInput = hasLogo ? (hasWatermark ? '[2:v]' : '[1:v]') : '';

    // Base de transformation vidéo
    const videoTransform = `${zoomScale},${rotateFilter},crop=iw/${effects.zoom}:ih/${effects.zoom}:(iw-iw/${effects.zoom})/2+${effects.panX}:(ih-ih/${effects.zoom})/2+${effects.panY},${advancedColorFilters},${grainFilter},${blurFilter}${mirrorFilter}${speedPart}`;

    if (useBlurFill) {
        // Format blur fill: fond flou + vidéo centrée
        let filter = `"split=2[main][bg];` +
            `[main]${videoTransform},scale=1080:-1[fg];` +
            `[bg]scale=1080:1920:force_original_aspect_ratio=increase,boxblur=20:1,crop=1080:1920[bl];`;

        if (hasWatermark && hasLogo) {
            // Watermark + Logo: watermark sur fg, puis logo, puis sur blur
            filter += `${watermarkInput}scale=1080:-1[wm];` +
                `[fg][wm]overlay=0:(H-h)/2[fgwm];` +
                `${logoInput}${logoScale}${logoOpacity}[logo];` +
                `[fgwm][logo]overlay=${logoPos}[fglogo];` +
                `[bl][fglogo]overlay=(W-w)/2:(H-h)/2"`;
        } else if (hasWatermark) {
            // Watermark seul: watermark sur fg, puis sur blur
            filter += `${watermarkInput}scale=1080:-1[wm];` +
                `[fg][wm]overlay=0:(H-h)/2[fgwm];` +
                `[bl][fgwm]overlay=(W-w)/2:(H-h)/2"`;
        } else if (hasLogo) {
            // Logo seul
            filter += `${logoInput}${logoScale}${logoOpacity}[logo];` +
                `[fg][logo]overlay=${logoPos}[fglogo];` +
                `[bl][fglogo]overlay=(W-w)/2:(H-h)/2"`;
        } else {
            // Ni watermark ni logo
            filter += `[bl][fg]overlay=(W-w)/2:(H-h)/2"`;
        }
        return filter;
    } else {
        // Format crop simple
        let filter = `"${videoTransform},` +
            `crop='min(iw,ih*9/16)':'min(ih,iw*16/9)':(iw-ow)/2:(ih-oh)/2,scale=1080:1920[vid];`;

        if (hasWatermark && hasLogo) {
            filter += `${watermarkInput}scale=1080:1920[wm];` +
                `[vid][wm]overlay=0:0[vidwm];` +
                `${logoInput}${logoScale}${logoOpacity}[logo];` +
                `[vidwm][logo]overlay=${logoPos}"`;
        } else if (hasWatermark) {
            filter += `${watermarkInput}scale=1080:1920[wm];` +
                `[vid][wm]overlay=0:0"`;
        } else if (hasLogo) {
            filter += `${logoInput}${logoScale}${logoOpacity}[logo];` +
                `[vid][logo]overlay=${logoPos}"`;
        } else {
            // Enlever le [vid]; final et fermer les guillemets
            filter = `"${videoTransform},` +
                `crop='min(iw,ih*9/16)':'min(ih,iw*16/9)':(iw-ow)/2:(ih-oh)/2,scale=1080:1920"`;
        }
        return filter;
    }
}

/**
 * Construit la chaîne de filtres audio pour les effets de transformation.
 * ANTI-DÉTECTION: Inclut EQ variable, pitch shift et ajustement de vitesse.
 * @param {object} effects - Effets uniques générés pour ce segment
 * @returns {string} - La chaîne de filtres audio pour FFmpeg
 */
function buildAudioFilter(effects = EFFECTS) {
    // EQ: bass et treble filters avec valeurs variables
    const bassFilter = `bass=g=${effects.bassGain}:f=100`;
    const trebleFilter = `treble=g=${effects.trebleGain}:f=3000`;

    // Pitch shift: seulement si pitchShift != 1.0 pour éviter désynchronisation
    let pitchFilter = '';
    if (effects.pitchShift !== 1.0) {
        const sampleRate = 48000;
        const atempoCompensation = (1 / effects.pitchShift).toFixed(6);
        pitchFilter = `,asetrate=${sampleRate}*${effects.pitchShift},aresample=${sampleRate},atempo=${atempoCompensation}`;
    }

    // Ajustement de vitesse audio pour correspondre à la vidéo
    // atempo accepte des valeurs entre 0.5 et 2.0
    const speedFilter = effects.speed !== 1.0 ? `,atempo=${effects.speed.toFixed(4)}` : '';

    return `"${bassFilter},${trebleFilter}${pitchFilter}${speedFilter}"`;
}

/**
 * Télécharge les sous-titres YouTube (auto-générés ou manuels)
 * @param {string} youtubeUrl - URL de la vidéo YouTube
 * @param {string} outputDir - Dossier de sortie
 * @param {string} ytDlpPath - Chemin vers yt-dlp
 * @returns {string|null} - Chemin vers le fichier SRT ou null si pas de sous-titres
 */
function downloadYoutubeSubtitles(youtubeUrl, outputDir, ytDlpPath) {
    const srtFile = path.join(outputDir, "youtube_subs.fr.srt");
    const vttFile = path.join(outputDir, "youtube_subs.fr.vtt");

    console.log("\n📝 Téléchargement des sous-titres YouTube...");

    try {
        // Essayer d'abord les sous-titres manuels français
        execSync(
            `"${ytDlpPath}" --write-sub --sub-lang fr --sub-format srt --skip-download -o "${path.join(outputDir, 'youtube_subs')}" "${youtubeUrl}"`,
            { stdio: 'pipe' }
        );
        if (fs.existsSync(srtFile)) {
            console.log("✅ Sous-titres manuels FR téléchargés!");
            return srtFile;
        }
    } catch { /* pas de sous-titres manuels */ }

    try {
        // Essayer les sous-titres auto-générés français
        execSync(
            `"${ytDlpPath}" --write-auto-sub --sub-lang fr --sub-format srt --skip-download -o "${path.join(outputDir, 'youtube_subs')}" "${youtubeUrl}"`,
            { stdio: 'pipe' }
        );
        if (fs.existsSync(srtFile)) {
            console.log("✅ Sous-titres auto-générés FR téléchargés!");
            return srtFile;
        }
        // Parfois yt-dlp télécharge en VTT, convertir si nécessaire
        if (fs.existsSync(vttFile)) {
            // Lire et convertir VTT en SRT basique
            const vttContent = fs.readFileSync(vttFile, 'utf-8');
            const srtContent = convertVttToSrt(vttContent);
            fs.writeFileSync(srtFile, srtContent);
            fs.unlinkSync(vttFile);
            console.log("✅ Sous-titres auto-générés FR convertis!");
            return srtFile;
        }
    } catch { /* pas de sous-titres auto FR */ }

    console.log("⚠️ Pas de sous-titres français disponibles sur YouTube.");
    return null;
}

/**
 * Convertit un fichier VTT en SRT
 * @param {string} vttContent - Contenu du fichier VTT
 * @returns {string} - Contenu au format SRT
 */
function convertVttToSrt(vttContent) {
    // Supprimer l'en-tête WEBVTT
    let content = vttContent.replace(/^WEBVTT\n\n/, '');
    // Supprimer les lignes de métadonnées (Kind:, Language:, etc.)
    content = content.replace(/^(Kind|Language):.*\n/gm, '');
    // Convertir les timestamps VTT (00:00:00.000) en SRT (00:00:00,000)
    content = content.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');
    // Ajouter les numéros de séquence
    let index = 1;
    const blocks = content.trim().split(/\n\n+/);
    const srtBlocks = blocks.map(block => {
        if (block.includes('-->')) {
            return `${index++}\n${block}`;
        }
        return '';
    }).filter(b => b);
    return srtBlocks.join('\n\n');
}

/**
 * Extrait les sous-titres correspondant aux segments sélectionnés
 * @param {string} srtFile - Fichier SRT source complet
 * @param {Array} segments - Liste des segments [{start, end}, ...]
 * @param {string} outputFile - Fichier SRT de sortie
 * @returns {string|null} - Chemin vers le fichier SRT extrait
 */
function extractSubtitlesForSegments(srtFile, segments, outputFile) {
    if (!fs.existsSync(srtFile)) return null;

    const content = fs.readFileSync(srtFile, 'utf-8');
    const blocks = content.split(/\n\n+/).filter(b => b.trim());

    let newSubs = [];
    let newIndex = 1;
    let timeOffset = 0; // Offset cumulé pour ajuster les timecodes

    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
        const { start: segStart, end: segEnd } = segments[segIdx];

        for (const block of blocks) {
            const lines = block.split('\n');
            if (lines.length < 2) continue;

            // Trouver la ligne de timecode
            let timeLineIdx = 0;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('-->')) {
                    timeLineIdx = i;
                    break;
                }
            }

            const timeLine = lines[timeLineIdx];
            const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
            if (!timeMatch) continue;

            const subStart = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
            const subEnd = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;

            // Vérifier si ce sous-titre est dans le segment actuel
            if (subStart >= segStart && subEnd <= segEnd) {
                // Ajuster les timecodes par rapport au début du clip concaténé
                const adjustedStart = subStart - segStart + timeOffset;
                const adjustedEnd = subEnd - segStart + timeOffset;

                const newStartStr = formatSrtTime(adjustedStart);
                const newEndStr = formatSrtTime(adjustedEnd);

                const textLines = lines.slice(timeLineIdx + 1).join('\n');
                newSubs.push(`${newIndex}\n${newStartStr} --> ${newEndStr}\n${textLines}`);
                newIndex++;
            }
        }

        // Ajouter la durée du segment à l'offset pour le prochain segment
        timeOffset += (segEnd - segStart);
    }

    if (newSubs.length === 0) {
        console.log("⚠️ Aucun sous-titre trouvé pour ces segments.");
        return null;
    }

    fs.writeFileSync(outputFile, newSubs.join('\n\n'));
    console.log(`✅ ${newSubs.length} sous-titres extraits pour le clip.`);
    return outputFile;
}

/**
 * Formate un temps en secondes en format SRT (HH:MM:SS,mmm)
 */
function formatSrtTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * Incruste les sous-titres dans la vidéo
 * @param {string} videoFile - Vidéo source
 * @param {string} srtFile - Fichier SRT
 * @param {string} outputFile - Vidéo de sortie
 * @param {string} ffmpegPath - Chemin vers ffmpeg
 * @returns {boolean}
 */
function burnSubtitles(videoFile, srtFile, outputFile, ffmpegPath) {
    console.log("\n📝 Incrustation des sous-titres...");

    // Style des sous-titres: petits, positionnés dans la zone de blur (sous la vidéo)
    // MarginV=580 pour positionner sous la vidéo centrée (dans le blur du bas)
    // MarginL et MarginR pour éviter le dépassement horizontal
    // WrapStyle=2 pour retour à la ligne automatique si texte trop long
    const subtitleStyle = "FontName=Arial,FontSize=14,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Bold=1,Outline=1,Shadow=1,MarginV=580,MarginL=50,MarginR=50,WrapStyle=2,Alignment=2";

    // Échapper les caractères spéciaux pour Windows
    const srtFileEscaped = srtFile.replace(/\\/g, '/').replace(/:/g, '\\:');

    const cmd = `"${ffmpegPath}" -y -i "${videoFile}" -vf "subtitles='${srtFileEscaped}':force_style='${subtitleStyle}'" -c:a copy "${outputFile}"`;

    try {
        execSync(cmd, { stdio: 'inherit' });
        console.log("✅ Sous-titres incrustés avec succès!");
        return true;
    } catch (err) {
        console.error("⛔ Échec incrustation sous-titres:", err.message);
        return false;
    }
}

/**
 * Extrait l'audio d'une vidéo en format WAV 16kHz mono (requis par Whisper)
 * @param {string} videoFile - Chemin vers la vidéo source
 * @param {string} outputWav - Chemin vers le fichier WAV de sortie
 * @param {string} ffmpegPath - Chemin vers ffmpeg
 * @returns {boolean} - true si succès
 */
function extractAudioForWhisper(videoFile, outputWav, ffmpegPath) {
    console.log("🎵 Extraction audio pour Whisper...");
    const cmd = `"${ffmpegPath}" -y -i "${videoFile}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputWav}"`;
    try {
        execSync(cmd, { stdio: 'pipe' });
        console.log("✅ Audio extrait en WAV 16kHz mono.");
        return true;
    } catch (err) {
        console.error("⛔ Échec extraction audio:", err.message);
        return false;
    }
}

/**
 * Transcrit un fichier audio avec Whisper et génère un fichier SRT
 * @param {string} audioFile - Fichier WAV 16kHz mono
 * @param {string} outputSrt - Fichier SRT de sortie
 * @param {string} language - Langue ('fr', 'en', 'auto')
 * @returns {Promise<string|null>} - Chemin du SRT ou null si échec
 */
async function transcribeWithWhisper(audioFile, outputSrt, language = 'fr') {
    console.log("\n🎤 Transcription avec Whisper (cela peut prendre du temps)...");

    try {
        const transcriber = await initWhisper();
        if (!transcriber) {
            console.log("⚠️ Whisper non disponible.");
            return null;
        }

        // Transcrire avec @xenova/transformers
        const result = await transcriber(audioFile, {
            language: language,
            task: 'transcribe',
            return_timestamps: true,
            chunk_length_s: 30,
            stride_length_s: 5
        });

        if (!result || !result.chunks || result.chunks.length === 0) {
            // Si pas de chunks mais du texte, créer un seul segment
            if (result && result.text) {
                const srtContent = `1\n00:00:00,000 --> 00:01:00,000\n${result.text.trim()}\n`;
                fs.writeFileSync(outputSrt, srtContent);
                console.log("✅ Transcription terminée: 1 segment.");
                return outputSrt;
            }
            console.log("⚠️ Aucune transcription générée.");
            return null;
        }

        // Convertir les chunks en format SRT
        const srtContent = result.chunks.map((chunk, index) => {
            const startTime = chunk.timestamp[0] || 0;
            const endTime = chunk.timestamp[1] || startTime + 5;
            const startSrt = formatSrtTime(startTime);
            const endSrt = formatSrtTime(endTime);
            return `${index + 1}\n${startSrt} --> ${endSrt}\n${chunk.text.trim()}\n`;
        }).join('\n');

        fs.writeFileSync(outputSrt, srtContent);
        console.log(`✅ Transcription terminée: ${result.chunks.length} segments.`);
        return outputSrt;

    } catch (err) {
        console.error("⛔ Erreur Whisper:", err.message);
        return null;
    }
}

/**
 * Génère les sous-titres pour un clip vidéo avec Whisper
 * @param {string} videoFile - Vidéo à transcrire
 * @param {string} outputDir - Dossier de sortie
 * @param {number} clipNumber - Numéro du clip
 * @param {string} ffmpegPath - Chemin vers ffmpeg
 * @returns {Promise<string|null>} - Chemin du SRT ou null
 */
async function generateWhisperSubtitles(videoFile, outputDir, clipNumber, ffmpegPath) {
    const tempWav = path.join(outputDir, `temp_audio_clip${clipNumber}.wav`);
    const srtFile = path.join(outputDir, `clip_${clipNumber}_whisper.srt`);

    // Extraire l'audio
    if (!extractAudioForWhisper(videoFile, tempWav, ffmpegPath)) {
        return null;
    }

    // Transcrire avec Whisper
    const result = await transcribeWithWhisper(tempWav, srtFile, 'fr');

    // Nettoyer le fichier WAV temporaire
    if (fs.existsSync(tempWav)) {
        fs.unlinkSync(tempWav);
    }

    return result;
}

async function downloadFFmpeg(destFolder) {
    console.log("\nffmpeg.exe not found. Downloading…");
    const zipPath = path.join(destFolder, "ffmpeg.zip");
    const ffmpegUrl =
        "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-7.0.2-essentials_build.zip";

    await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(zipPath);
        const options = { headers: { "User-Agent": "Mozilla/5.0" } };

        https
            .get(ffmpegUrl, options, response => {
                if (response.statusCode !== 200) {
                    return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
                }
                response.pipe(file);
                file.on("finish", () => file.close(resolve));
            })
            .on("error", err => {
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                reject(err);
            });
    });

    console.log("✅ Archive downloaded. Extracting…");
    await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: destFolder })).promise();

    const folders = fs
        .readdirSync(destFolder)
        .filter(f => fs.statSync(path.join(destFolder, f)).isDirectory());
    let found = false;
    for (const folder of folders) {
        const cand = path.join(destFolder, folder, "bin", "ffmpeg.exe");
        if (fs.existsSync(cand)) {
            fs.copyFileSync(cand, path.join(destFolder, "ffmpeg.exe"));
            found = true;
            break;
        }
    }
    fs.unlinkSync(zipPath);
    if (!found) {
        console.error("⛔ Could not find ffmpeg.exe after extraction.");
        process.exit(1);
    }
    console.log("✅ ffmpeg.exe successfully installed.\n");
}

(async () => {
    const exeDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
    const ytDlp = path.join(exeDir, "yt-dlp.exe");
    const ffmpeg = path.join(exeDir, "ffmpeg.exe");
    const tempFile = path.join(exeDir, "video_temp.mp4");

    let videoExists = fs.existsSync(tempFile) && fs.statSync(tempFile).size > 1000;

    let youtubeURL;
    if (!videoExists) {
        youtubeURL = await ask("YouTube link: ");
    } else {
        const reuse = await ask("A video already exists. Reuse it? (y/n): ");
        if (reuse.toLowerCase() === "n") {
            videoExists = false; // Indicates that there is no existing video to reuse
            youtubeURL = await ask("YouTube link: ");
        } else {
            // Demander l'URL pour les sous-titres même si on réutilise la vidéo
            youtubeURL = await ask("YouTube link (pour sous-titres, laisser vide pour ignorer): ");
            if (!youtubeURL.trim()) youtubeURL = null;
        }
    }

    const segmentDuration = 21; // Chaque segment fait 21 secondes
    const gapBetweenSegments = 3; // 3 secondes entre chaque segment
    const clipTotalDuration = segmentDuration * 3 + gapBetweenSegments * 2; // 21+3+21+3+21 = 69s par clip, mais on prend 63s pour la prochaine vidéo
    const clipAdvance = 63; // Avance de 63s entre chaque clip (pas de gap entre vidéos)

    if (!fs.existsSync(ytDlp)) {
        console.error("⛔ yt-dlp.exe not found.");
        process.exit(1);
    }
    if (!fs.existsSync(ffmpeg)) {
        await downloadFFmpeg(exeDir);
    }

    // Download if needed
    if (!videoExists) {
        console.log("\n⬇️ Downloading video…");
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        let formatString = "609+234";
        let downloadSuccess = false;
        let tryCount = 0;
        let separateDownload = false;
        let videoFormat = "609"; // Default video format ID
        let audioFormat = "234"; // Default audio format ID
        while (!downloadSuccess && tryCount < 2) {
            try {
                execSync(
                    `"${ytDlp}" --no-continue --no-part --force-overwrites -f "${formatString}" -o "${tempFile}" "${youtubeURL}"`,
                    { stdio: "inherit" }
                );
                downloadSuccess = true;
            } catch {
                tryCount++;
                console.error("⛔ Download error. Requested format not available.");
                // Show available formats
                console.log("\nAvailable formats list:\n");
                try {
                    execSync(`"${ytDlp}" --list-formats "${youtubeURL}"`, { stdio: "inherit" });
                } catch {
                    console.error("Could not get format list.");
                    process.exit(1);
                }
                // Ask user for separate video and audio formats
                videoFormat = await ask("Video format code (e.g. 232): ");
                audioFormat = await ask("Audio format code (e.g. 233-1): ");
                if (!videoFormat || !audioFormat) {
                    console.error("⛔ No format entered.");
                    process.exit(1);
                }
                separateDownload = true;
                break;
            }
        }
        if (!downloadSuccess && separateDownload) {
            // Separate video and audio download
            const tempVideo = path.join(exeDir, "video_temp_onlyvideo.mp4");
            const tempAudio = path.join(exeDir, "video_temp_onlyaudio.m4a");
            try {
                execSync(`"${ytDlp}" --no-continue --no-part --force-overwrites -f "${videoFormat}" -o "${tempVideo}" "${youtubeURL}"`, { stdio: "inherit" });
                execSync(`"${ytDlp}" --no-continue --no-part --force-overwrites -f "${audioFormat}" -o "${tempAudio}" "${youtubeURL}"`, { stdio: "inherit" });
            } catch {
                console.error("⛔ Error during separate video or audio download.");
                process.exit(1);
            }
            // Merge video and audio with ffmpeg
            try {
                execSync(`"${ffmpeg}" -y -i "${tempVideo}" -i "${tempAudio}" -c:v copy -c:a aac -b:a 128k "${tempFile}"`, { stdio: "inherit" });
                fs.unlinkSync(tempVideo);
                fs.unlinkSync(tempAudio);
                downloadSuccess = true;
            } catch {
                console.error("⛔ Error merging video+audio with ffmpeg.");
                process.exit(1);
            }
        }
        if (!downloadSuccess) {
            console.error("⛔ Download error. Check that yt-dlp.exe works.");
            process.exit(1);
        }
        console.log("✅ Video downloaded and merged.");
    } else {
        console.log("✅ Reusing video_temp.mp4");
    }

    // The video will be processed at normal speed, no acceleration

    // Vérifier si le logo est activé et existe
    const logoFile = path.join(exeDir, EFFECTS.logo.file);
    const hasLogoFile = fs.existsSync(logoFile);
    if (EFFECTS.logo.enabled && !hasLogoFile) {
        console.warn(`⚠️ Logo activé mais fichier "${EFFECTS.logo.file}" non trouvé. Logo désactivé.`);
    }

    // Vérifier si le watermark existe
    const watermarkFile = path.join(exeDir, 'watermark.png');
    const hasWatermarkFile = false;

    // Créer le dossier de sortie
    const downloadDate = new Date().toISOString().split('T')[0];
    let videoTitle = "video";
    if (youtubeURL) {
        try {
            const metadata = execSync(`"${ytDlp}" --get-title "${youtubeURL}"`, { encoding: "utf-8" });
            videoTitle = metadata.trim().replace(/[^a-zA-Z0-9-_ ]/g, "_");
        } catch {
            console.warn("⚠️ Could not retrieve video title. Using default name.");
        }
    }
    videoTitle = 'output_' + videoTitle.replace(/\s+/g, "_");
    const outputDir = path.join(exeDir, `${videoTitle}_${downloadDate}`);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    // 📝 Télécharger les sous-titres YouTube une seule fois
    let youtubeSrtFile = null;
    if (youtubeURL && 1 == 2) {
        youtubeSrtFile = downloadYoutubeSubtitles(youtubeURL, outputDir, ytDlp);
    }

    // 📋 PHASE 1: GÉNÉRATION AUTOMATIQUE DES CLIPS
    console.log("\n" + "=".repeat(50));
    console.log("📋 PHASE 1: GÉNÉRATION AUTOMATIQUE DES CLIPS");
    console.log("=".repeat(50));

    // Obtenir la durée totale de la vidéo
    let videoDuration = 0;
    try {
        const durationOutput = execSync(
            `"${ffmpeg}" -i "${tempFile}" 2>&1`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).toString();
        const durationMatch = durationOutput.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
        if (durationMatch) {
            videoDuration = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[3]);
        }
    } catch (err) {
        // ffmpeg retourne une erreur mais affiche quand même la durée
        const output = err.stderr ? err.stderr.toString() : err.stdout ? err.stdout.toString() : '';
        const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
        if (durationMatch) {
            videoDuration = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[3]);
        }
    }

    if (videoDuration === 0) {
        console.error("⛔ Impossible de déterminer la durée de la vidéo.");
        process.exit(1);
    }

    const videoDurationMin = Math.floor(videoDuration / 60);
    const videoDurationSec = videoDuration % 60;
    console.log(`\n📊 Durée de la vidéo: ${videoDurationMin}:${videoDurationSec.toString().padStart(2, '0')} (${videoDuration}s)`);

    // Demander le timecode de départ
    const startTimecode = await ask("\nTimecode de départ (ex: 1:30, défaut 0:00): ");
    let currentPosition = startTimecode.trim() ? toSeconds(startTimecode.trim()) : 0;

    // Demander le mode vidéo: blur fill ou plein écran (crop centré)
    console.log("\n📐 Mode vidéo:");
    console.log("   1. Fond flou (blur) - la vidéo est centrée avec un fond flou");
    console.log("   2. Plein écran (crop) - la vidéo est centrée et recadrée (on perd les bords)");
    const videoModeChoice = await ask("Choisir le mode (1 ou 2, défaut 1): ");
    const useBlurFill = videoModeChoice.trim() !== "2";

    // Générer automatiquement tous les clips
    // Structure d'un clip: segment1(21s) + gap(3s) + segment2(21s) + gap(3s) + segment3(21s) = 69s de vidéo source
    // Mais on avance de 63s pour le prochain clip (les 3 segments de 21s)
    const allClipsData = [];
    let clipNum = 0;

    while (currentPosition + clipAdvance <= videoDuration) {
        clipNum++;

        // Calculer les 3 segments pour ce clip
        // Segment 1: currentPosition → currentPosition + 21s
        // Segment 2: currentPosition + 21s + 3s → currentPosition + 21s + 3s + 21s
        // Segment 3: currentPosition + 21s + 3s + 21s + 3s → currentPosition + 21s + 3s + 21s + 3s + 21s
        const seg1Start = currentPosition;
        const seg2Start = currentPosition + segmentDuration + gapBetweenSegments; // +21s +3s
        const seg3Start = currentPosition + (segmentDuration + gapBetweenSegments) * 2; // +21s +3s +21s +3s

        const expandedRanges = [
            { start: seg1Start, end: seg1Start + segmentDuration },
            { start: seg2Start, end: seg2Start + segmentDuration },
            { start: seg3Start, end: seg3Start + segmentDuration }
        ];

        // Vérifier que le dernier segment ne dépasse pas la durée
        if (expandedRanges[2].end > videoDuration) {
            break;
        }

        allClipsData.push({ clipNumber: clipNum, ranges: expandedRanges });

        // Avancer de 63s pour le prochain clip
        currentPosition += clipAdvance;
    }

    // Afficher le récapitulatif
    console.log(`\n✅ ${allClipsData.length} clip(s) seront générés:\n`);
    allClipsData.forEach(clip => {
        const r = clip.ranges;
        const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
        console.log(`   Clip #${clip.clipNumber}: ${formatTime(r[0].start)}-${formatTime(r[0].end)} | ${formatTime(r[1].start)}-${formatTime(r[1].end)} | ${formatTime(r[2].start)}-${formatTime(r[2].end)}`);
    });

    if (allClipsData.length === 0) {
        console.log("⚠️ Aucun clip à générer (vidéo trop courte ou timecode de départ trop avancé).");
        rl.close();
        process.exit(0);
    }

    const confirm = await ask(`\n▶️ Lancer la génération de ${allClipsData.length} clip(s) ? (o/n): `);
    if (confirm.toLowerCase() !== "o" && confirm.toLowerCase() !== "oui" && confirm.toLowerCase() !== "y") {
        console.log("❌ Génération annulée.");
        rl.close();
        process.exit(0);
    }

    // 🎬 PHASE 2: CRÉATION DE TOUS LES CLIPS
    console.log("\n" + "=".repeat(50));
    console.log(`🎬 PHASE 2: CRÉATION DE ${allClipsData.length} CLIP(S)`);
    console.log("=".repeat(50));

    for (const clipData of allClipsData) {
        const { clipNumber, ranges: expandedRanges } = clipData;

        console.log(`\n${"─".repeat(40)}`);
        console.log(`📹 Création du clip #${clipNumber}/${allClipsData.length}`);
        console.log(`${"─".repeat(40)}`);

        console.log("\n🎭 MODE ANTI-DÉTECTION ACTIVÉ - Effets UNIQUES");

        // Stocker les chemins des segments temporaires pour la concaténation
        const tempSegmentFiles = [];

        // Process each range with UNIQUE effects per segment
        for (let i = 0; i < expandedRanges.length; i++) {
            const { start, end } = expandedRanges[i];
            if (end <= start) {
                console.warn(`⚠️ Range ${i + 1} ignored (end ≤ start).`);
                continue;
            }
            const duration = end - start;

            // 🎲 GÉNÉRATION D'EFFETS UNIQUES POUR CE SEGMENT
            const uniqueEffects = generateUniqueEffects();
            const hasLogo = uniqueEffects.logo.enabled && hasLogoFile;
            const hasWatermark = hasWatermarkFile;

            // Construire les filtres avec les effets uniques
            const videoFilter = buildVideoFilter(useBlurFill, hasLogo, hasWatermark, uniqueEffects);
            const audioFilter = buildAudioFilter(uniqueEffects);

            // Fichier temporaire pour ce segment
            const tempSegmentName = path.join(outputDir, `temp_segment_${i + 1}.mp4`);
            tempSegmentFiles.push(tempSegmentName);

            // Construire les inputs FFmpeg: vidéo + watermark (optionnel) + logo (optionnel)
            const watermarkInput = hasWatermark ? `-i "${watermarkFile}" ` : '';
            const logoInput = hasLogo ? `-i "${logoFile}" ` : '';
            const needsFilterComplex = hasLogo || hasWatermark;
            const filterFlag = needsFilterComplex ? '-filter_complex' : '-vf';

            const cmd =
                `"${ffmpeg}" -y -ss ${start} -t ${duration} -i "${tempFile}" ${watermarkInput}${logoInput}` +
                `${filterFlag} ${videoFilter} -af ${audioFilter} ` +
                `-c:v libx264 -preset ${uniqueEffects.preset} -crf ${uniqueEffects.crf} ` +
                `-c:a aac -b:a ${Math.floor(randomInRange(120, 136))}k ` +
                `"${tempSegmentName}"`;

            console.log(`\n🔄 Extraction segment #${i + 1} (${duration}s)`);
            console.log(`   🎲 Effets: sat=${uniqueEffects.saturation.toFixed(2)} hue=${uniqueEffects.hue.toFixed(1)}°${hasWatermark ? ' +watermark' : ''}`);
            try {
                execSync(cmd, { stdio: "inherit" });
            } catch {
                console.error(`⛔ Échec extraction segment #${i + 1}.`);
            }
        }

        // 🎬 CONCATÉNATION des 3 segments en un seul clip (~1m)
        console.log("\n🎬 Concaténation des 3 segments en un clip de ~1m...");

        // Créer le fichier de liste pour ffmpeg concat
        const concatListFile = path.join(outputDir, "concat_list.txt");
        const concatListContent = tempSegmentFiles.map(f => `file '${f.replace(/\\/g, "/")}'`).join("\n");
        fs.writeFileSync(concatListFile, concatListContent);

        // 📝 MÉTADONNÉES UNIQUES pour le clip final
        const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const fakeDate = new Date(Date.now() - Math.floor(Math.random() * 86400000 * 30));
        const metadataArgs = `-metadata title="clip_${uniqueId}" ` +
            `-metadata creation_time="${fakeDate.toISOString()}" ` +
            `-metadata encoder="custom_${Math.random().toString(36).slice(2, 8)}" ` +
            `-metadata comment="${Math.random().toString(36).slice(2, 18)}"`;

        const finalOutputName = path.join(outputDir, `clip_${clipNumber}_1m.mp4`);

        const concatCmd = `"${ffmpeg}" -y -f concat -safe 0 -i "${concatListFile}" -c copy ${metadataArgs} "${finalOutputName}"`;

        try {
            execSync(concatCmd, { stdio: "inherit" });
            console.log(`\n✅ Clip #${clipNumber} créé: ${finalOutputName}`);

            // Supprimer les fichiers temporaires
            console.log("🧹 Nettoyage des segments temporaires...");
            tempSegmentFiles.forEach(f => {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            });
            if (fs.existsSync(concatListFile)) fs.unlinkSync(concatListFile);
            console.log("✅ Fichiers temporaires supprimés.");

            // 🎤 SOUS-TITRES AUTOMATIQUES (Whisper ou YouTube)
            let clipSrtFile = null;

            // Priorité 1: Whisper (transcription locale via @xenova/transformers)
            console.log("\n🎤 Génération des sous-titres avec Whisper...");
            clipSrtFile = await generateWhisperSubtitles(finalOutputName, outputDir, clipNumber, ffmpeg);

            // Priorité 2: Sous-titres YouTube (si Whisper non disponible ou a échoué)
            if (!clipSrtFile && youtubeSrtFile) {
                console.log("\n📝 Extraction des sous-titres YouTube pour ce clip...");
                const ytSrtFile = path.join(outputDir, `clip_${clipNumber}_subs.srt`);
                clipSrtFile = extractSubtitlesForSegments(youtubeSrtFile, expandedRanges, ytSrtFile);
            }

            // Incrustation des sous-titres si disponibles
            if (clipSrtFile) {
                const subtitledOutput = path.join(outputDir, `clip_${clipNumber}_1m_subtitled.mp4`);

                if (burnSubtitles(finalOutputName, clipSrtFile, subtitledOutput, ffmpeg)) {
                    // Remplacer le fichier original par la version sous-titrée
                    fs.unlinkSync(finalOutputName);
                    fs.renameSync(subtitledOutput, finalOutputName);
                    console.log("✅ Vidéo finale avec sous-titres incrustés!");
                }

                // Supprimer le fichier SRT du clip après utilisation
                if (fs.existsSync(clipSrtFile)) fs.unlinkSync(clipSrtFile);
            }

        } catch {
            console.error("⛔ Échec de la concaténation.");
        }
    } // Fin de la boucle for

    // 🧹 NETTOYAGE FINAL
    console.log("\n" + "=".repeat(50));
    console.log("🧹 NETTOYAGE");
    console.log("=".repeat(50));

    const del = await ask("\nSupprimer video_temp.mp4 ? (o/n): ");
    if (del.toLowerCase() === "o" || del.toLowerCase() === "y") {
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
            console.log("✅ Fichier temporaire supprimé.");
        }
    }

    // Supprimer le fichier de sous-titres YouTube
    if (youtubeSrtFile && fs.existsSync(youtubeSrtFile)) {
        fs.unlinkSync(youtubeSrtFile);
    }

    console.log(`\n✅ Terminé! ${allClipsData.length} clip(s) créé(s) dans: ${outputDir}`);
    await ask("Appuyez sur Entrée pour quitter...");
    rl.close();
})();
