#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");
const https = require("https");
const unzipper = require("unzipper");

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
        rgbaShiftH: randomInRange(-2, 2),           // Décalage horizontal des canaux
        rgbaShiftV: randomInRange(-1, 1),           // Décalage vertical des canaux

        // Vignette TRÈS subtile (quasi invisible mais modifie le fingerprint)
        // angle proche de PI/2 (1.57) = très peu de vignette
        vignetteAngle: randomInRange(1.3, 1.5),
        vignetteX0: randomInRange(0.48, 0.52),
        vignetteY0: randomInRange(0.48, 0.52),

        // Légère distorsion de lens (nouveau)
        lensK1: randomInRange(-0.02, 0.02),
        lensK2: randomInRange(-0.01, 0.01),

        // Audio : pitch shift variable
        pitchShift: randomInRange(0.98, 1.03),      // -2% à +3%

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
    pitchShift: 1.01,
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
    const waveFilter = `rgbashift=rh=${rgbaShiftH}:rv=${rgbaShiftV}:gh=${-rgbaShiftH}:gv=${-rgbaShiftV}:bh=${Math.round(rgbaShiftH/2)}:bv=${Math.round(rgbaShiftV/2)}`;

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
    const speedFilter = effects.speed !== 1.0 ? `setpts=${(1/effects.speed).toFixed(4)}*PTS` : '';

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

    // Pitch shift sans changer la durée:
    const sampleRate = 48000;
    const atempoCompensation = (1 / effects.pitchShift).toFixed(6);
    const pitchFilter = `asetrate=${sampleRate}*${effects.pitchShift},aresample=${sampleRate},atempo=${atempoCompensation}`;

    // NOUVEAU: Ajustement de vitesse audio pour correspondre à la vidéo
    // atempo accepte des valeurs entre 0.5 et 2.0
    const speedFilter = effects.speed !== 1.0 ? `,atempo=${effects.speed.toFixed(4)}` : '';

    return `"${bassFilter},${trebleFilter},${pitchFilter}${speedFilter}"`;
}

/**
 * Local heuristic to extract "best moments" from a video you don't own.
 * Assumptions:
 *  - The already downloaded video file is `video_temp.mp4` in the current folder (exeDir).
 *  - Only signals accessible without analytics are used: timestamps in description/comments + scene cuts.
 *  - N fixed-length windows are proposed around the peaks of the combined score.
 *
 * Score per second = 3 * (nearby timestamp) + 1 * (scene cut density).
 * A window (spanSeconds) is slid and the best non-overlapping are taken.
 *
 * @param {string} videoUrl YouTube URL
 * @param {object} [opts]
 * @param {number} [opts.maxHighlights=5] Number of segments to return
 * @param {number} [opts.spanSeconds=30] Duration of a segment in seconds
 * @param {number} [opts.sceneThreshold=0.4] ffmpeg scene detection threshold
 * @param {boolean} [opts.includeComments=true] Enable comment parsing (can be slow)
 * @returns {Array<{start:number,end:number,score:number,reason:string}>}
 */
function getBestMoments(videoUrl, opts = {}) {
    const {
        maxHighlights = 5,
        spanSeconds = 61, // par défaut 61 secondes
        sceneThreshold = 0.4,
        includeComments = true,
    } = opts;

    const exeDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
    const ytDlp = path.join(exeDir, "yt-dlp.exe");
    const ffmpeg = path.join(exeDir, "ffmpeg.exe");
    const tempFile = path.join(exeDir, "video_temp.mp4");

    if (!fs.existsSync(tempFile)) {
        console.warn("getBestMoments: video file not found: " + tempFile);
        return [];
    }
    if (!fs.existsSync(ytDlp)) {
        console.warn("getBestMoments: yt-dlp.exe not found.");
        return [];
    }
    if (!fs.existsSync(ffmpeg)) {
        console.warn("getBestMoments: ffmpeg.exe not found.");
        return [];
    }

    // 1. Durée de la vidéo
    let duration = 0;
    try {
        // Force writing to stderr; execSync returns the error which we capture to read the duration
        execSync(`"${ffmpeg}" -i "${tempFile}" -hide_banner`, { stdio: "pipe" });
    } catch (err) {
        const output = (err.stderr ? err.stderr.toString() : "") + (err.stdout ? err.stdout.toString() : "");
        const match = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
        if (match) {
            const [, h, m, s] = match;
            duration = (+h) * 3600 + (+m) * 60 + parseFloat(s);
        }
    }
    if (!duration || isNaN(duration)) {
        console.warn("getBestMoments: duration not determined.");
        return [];
    }

    // 2. Retrieve description (+ possible comments)
    let rawText = "";
    try {
        rawText += execSync(`"${ytDlp}" --get-description "${videoUrl}"`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    } catch { /* ignore */ }
    if (includeComments) {
        try {
            // Can be slow/large; can be limited later
            rawText += "\n" + execSync(`"${ytDlp}" --get-comments "${videoUrl}"`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
        } catch { /* ignore */ }
    }

    // 3. Extract timestamps (MM:SS or HH:MM:SS) -> seconds
    const timestampRegex = /\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/g; // capture HH:MM:SS ou MM:SS
    const timestampSeconds = [];
    let m;
    while ((m = timestampRegex.exec(rawText)) !== null) {
        const [, hOpt, mPart, sPart] = m;
        const hVal = hOpt ? parseInt(hOpt, 10) : 0;
        const minVal = parseInt(mPart, 10);
        const secVal = parseInt(sPart, 10);
        const total = hVal * 3600 + minVal * 60 + secVal;
        if (!isNaN(total) && total <= duration) timestampSeconds.push(total);
    }

    // Frequency per second (window ±5s)
    const timestampWeightRadius = 5;
    const tsPresence = new Array(Math.ceil(duration) + 1).fill(0);
    timestampSeconds.forEach(sec => {
        const start = Math.max(0, sec - timestampWeightRadius);
        const end = Math.min(tsPresence.length - 1, sec + timestampWeightRadius);
        for (let i = start; i <= end; i++) tsPresence[i] += 1;
    });

    // 4. Scene detection -> list of times (secs) where significant change
    let sceneCuts = [];
    try {
        const cutOutput = execSync(`"${ffmpeg}" -i "${tempFile}" -vf "select='gt(scene,${sceneThreshold})',showinfo" -f null - 2>&1`, { encoding: "utf-8" });
        const ptsRegex = /pts_time:([0-9]+\.[0-9]+)/g;
        let mm;
        while ((mm = ptsRegex.exec(cutOutput)) !== null) {
            const t = parseFloat(mm[1]);
            if (!isNaN(t) && t <= duration) sceneCuts.push(t);
        }
    } catch {
        // silent fallback
    }
    sceneCuts.sort((a, b) => a - b);

    // Cut density per second (±2s)
    const sceneRadius = 2;
    const cutDensity = new Array(Math.ceil(duration) + 1).fill(0);
    for (const cut of sceneCuts) {
        const base = Math.round(cut);
        const start = Math.max(0, base - sceneRadius);
        const end = Math.min(cutDensity.length - 1, base + sceneRadius);
        for (let i = start; i <= end; i++) cutDensity[i] += 1;
    }

    // 5. Combined score per second
    const scores = new Array(Math.ceil(duration) + 1).fill(0);
    for (let i = 0; i < scores.length; i++) {
        scores[i] = tsPresence[i] * 3 + cutDensity[i] * 1; // pondérations simples
    }

    // 6. Sliding window to find best segments
    const windowScores = [];
    const span = spanSeconds;
    const maxStart = Math.max(0, Math.floor(duration - span));
    // Pré-calcul somme cumulative pour vitesse
    const prefix = [0];
    for (let i = 0; i < scores.length; i++) prefix.push(prefix[prefix.length - 1] + scores[i]);
    function sumRange(a, b) { // inclusif a..b
        return prefix[b + 1] - prefix[a];
    }
    for (let start = 0; start <= maxStart; start++) {
        const end = Math.min(scores.length - 1, start + span - 1);
        const wScore = sumRange(start, end) / (end - start + 1); // moyenne
        windowScores.push({ start, end: start + span, score: wScore });
    }
    // Sort by descending score
    windowScores.sort((a, b) => b.score - a.score);

    // 7. Non-overlapping selection of top N
    const chosen = [];
    for (const w of windowScores) {
        if (chosen.length >= maxHighlights) break;
        if (chosen.some(c => !(w.end <= c.start || w.start >= c.end))) continue; // overlap
        const reasonParts = [];
        // Indices of ts in the window
        const tsCount = timestampSeconds.filter(ts => ts >= w.start && ts <= w.end).length;
        if (tsCount) reasonParts.push(`${tsCount} timestamps`);
        const cutsCount = sceneCuts.filter(sc => sc >= w.start && sc <= w.end).length;
        if (cutsCount) reasonParts.push(`${cutsCount} coupes`);
        if (reasonParts.length === 0) reasonParts.push("relative activity");
        chosen.push({ start: w.start, end: Math.min(duration, w.end), score: w.score, reason: reasonParts.join(", ") });
    }

    // If nothing selected, fallback: start of the video
    if (chosen.length === 0) {
        chosen.push({ start: 0, end: Math.min(duration, span), score: 0, reason: "fallback" });
    }

    return chosen;
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
        }
    }

    // Highlights mode?
    const highlightAns = await ask("Automatically extract best moments (61s segments)? (y/n): ");
    const highlightMode = highlightAns.trim().toLowerCase() === "y";
    let highlightCount = 5;
    let includeComments = true;
    let rangesInput = "";
    let useAllVideo = false;
    let formatChoice, useBlurFill, autoSplitAns, autoSplit = false;

    if (highlightMode) {
        const hc = await ask("Number of highlight segments wanted? (default=5): ");
        if (hc && !isNaN(parseInt(hc.trim(), 10)) && parseInt(hc.trim(), 10) > 0) {
            highlightCount = parseInt(hc.trim(), 10);
        }
        const commentsAns = await ask("Include comment analysis (slower)? (Y/n): ");
        includeComments = commentsAns.trim().toLowerCase() !== "n";
        // formatChoice = await ask("Phone format (1) or landscape + blurred bars (2)? (1/2, default=1): ");
        useBlurFill = true
    } else {
        // Ask if we want the whole video (classic mode)
        const allVideoAns = await ask("Use the whole video? (y/n): ");
        useAllVideo = allVideoAns.trim().toLowerCase() === "y";
        if (useAllVideo) {
            // formatChoice = await ask("Phone format (1) or landscape + blurred bars (2)? (1/2, default=1): ");
            useBlurFill = true
            autoSplitAns = await ask("Automatically split the video into segments? (Y/n): ");
            autoSplit = autoSplitAns.trim().toLowerCase() !== "n";
        } else {
            rangesInput = await ask("Enter ranges (hh:mm:ss-hh:mm:ss, separated by commas):\n");
            // formatChoice = await ask("Phone format (1) or landscape + blurred bars (2)? (1/2, default=1): ");
            useBlurFill = true
            autoSplitAns = await ask("Automatically split ranges into 61s segments? (Y/n): ");
            autoSplit = autoSplitAns.trim().toLowerCase() !== "n";
        }
    }

    // Ask for segment length if auto split is chosen
    let segmentLength = 61; // default duration in seconds (était 60)
    if (autoSplit) {
        const segLenAns = await ask("Segment duration in seconds? (default=61): ");
        if (segLenAns && segLenAns.trim() !== "") {
            const maybeNum = parseInt(segLenAns.trim(), 10);
            if (!isNaN(maybeNum) && maybeNum > 0) {
                segmentLength = maybeNum;
            } else {
                console.log("Invalid value. Using 61s by default.");
            }
        }
    }

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

    // Build ranges
    let expandedRanges = [];
    if (highlightMode) {
        console.log("\n🔍 Calculating best moments…");
        const highlights = getBestMoments(youtubeURL, { maxHighlights: highlightCount, spanSeconds: segmentLength, includeComments });
        if (!highlights.length) {
            console.log("⚠️ No highlight detected, fallback to start of video.");
        } else {
            console.log("✅ Highlights found:");
            highlights.forEach((h, idx) => {
                console.log(`#${idx + 1} ${h.start}s → ${h.end}s (${Math.round(h.end - h.start)}s) score=${h.score.toFixed(2)} reasons: ${h.reason}`);
            });
        }
        expandedRanges = highlights.map(h => ({ start: h.start, end: h.end }));
        if (!expandedRanges.length) expandedRanges = [{ start: 0, end: segmentLength }];
    } else if (useAllVideo) {
        // Determine video duration
        let videoDuration = 0;
        try {
            const ffprobeOut = execSync(`"${ffmpeg}" -i "${tempFile}" -hide_banner`, { stdio: "pipe" });
        } catch (err) {
            const output = err.stderr ? err.stderr.toString() : "";
            const match = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
            if (match) {
                const [, h, m, s] = match;
                videoDuration = (+h) * 3600 + (+m) * 60 + (+s);
            } else {
                console.error("⛔ Could not determine video duration.");
                process.exit(1);
            }
        }
        // Split into 61s segments
        const targetSegment = segmentLength;
        if (autoSplit) {
            expandedRanges = [];
            let cur = 0;
            while (cur + targetSegment <= videoDuration) {
                expandedRanges.push({ start: cur, end: cur + targetSegment });
                cur += targetSegment;
            }
            if (cur < videoDuration) expandedRanges.push({ start: cur, end: videoDuration });
        } else {
            expandedRanges = [{ start: 0, end: videoDuration }];
        }
    } else {
        const ranges = rangesInput
            .split(",")
            .map(r => r.trim())
            .filter(r => r.includes("-"))
            .map(r => {
                const [s, e] = r.split("-");
                return { start: toSeconds(s), end: toSeconds(e) };
            });
        // Split into 61s segments
        const targetSegment = segmentLength;
        expandedRanges = autoSplit
            ? ranges.flatMap(({ start, end }) => {
                const segments = [];
                if (end <= start) return segments;
                let cur = start;
                while (cur + targetSegment <= end) {
                    segments.push({ start: cur, end: cur + targetSegment });
                    cur += targetSegment;
                }
                if (cur < end) segments.push({ start: cur, end });
                return segments;
            })
            : ranges;
    }

    console.log(`\n🧩 Segments to process: ${expandedRanges.length}`);
    if (highlightMode) {
        console.log("(Automatic highlights mode)");
    }

    // Vérifier si le logo est activé et existe
    const logoFile = path.join(exeDir, EFFECTS.logo.file);
    const hasLogoFile = fs.existsSync(logoFile);
    if (EFFECTS.logo.enabled && !hasLogoFile) {
        console.warn(`⚠️ Logo activé mais fichier "${EFFECTS.logo.file}" non trouvé. Logo désactivé.`);
    }

    // Vérifier si le watermark existe
    const watermarkFile = path.join(exeDir, 'watermark.png');
    const hasWatermarkFile = fs.existsSync(watermarkFile);
    if (hasWatermarkFile) {
        console.log(`✅ Watermark trouvé: watermark.png (sera appliqué sur la vidéo)`);
    }

    // Add logic to create a specific subfolder
    const videoName = youtubeURL ? youtubeURL.split('v=')[1] || 'video' : 'video';
    const downloadDate = new Date().toISOString().split('T')[0];
    let videoTitle = "video";
    if (youtubeURL) {
        try {
            const metadata = execSync(`"${ytDlp}" --get-title "${youtubeURL}"`, { encoding: "utf-8" });
            videoTitle = metadata.trim().replace(/[^a-zA-Z0-9-_ ]/g, "_"); // Clean title
        } catch {
            console.warn("⚠️ Could not retrieve video title. Using default name.");
        }
    }
    // Update to replace spaces with underscores in title
    videoTitle = 'output_' + videoTitle.replace(/\s+/g, "_");
    // Update to handle paths correctly in both Node.js and .exe cases
    const outputDir = path.join(exeDir, `${videoTitle}_${downloadDate}`);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    console.log("\n🎭 MODE ANTI-DÉTECTION ACTIVÉ - Chaque segment aura des effets UNIQUES");

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

        // 📝 MÉTADONNÉES UNIQUES pour éviter le fingerprinting
        const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const fakeDate = new Date(Date.now() - Math.floor(Math.random() * 86400000 * 30)); // Date aléatoire dans les 30 derniers jours
        const metadataArgs = `-metadata title="clip_${uniqueId}" ` +
            `-metadata creation_time="${fakeDate.toISOString()}" ` +
            `-metadata encoder="custom_${Math.random().toString(36).slice(2, 8)}" ` +
            `-metadata comment="${Math.random().toString(36).slice(2, 18)}"`;

        const outName = path.join(outputDir, `segment_${i + 1}_${start}s_${end}s_${useBlurFill ? "blur" : "crop"}.mp4`);

        // Construire les inputs FFmpeg: vidéo + watermark (optionnel) + logo (optionnel)
        // Ordre: [0:v]=vidéo, [1:v]=watermark, [2:v]=logo (ou [1:v]=logo si pas de watermark)
        const watermarkInput = hasWatermark ? `-i "${watermarkFile}" ` : '';
        const logoInput = hasLogo ? `-i "${logoFile}" ` : '';
        const needsFilterComplex = hasLogo || hasWatermark;
        const filterFlag = needsFilterComplex ? '-filter_complex' : '-vf';

        const cmd =
            `"${ffmpeg}" -y -ss ${start} -t ${duration} -i "${tempFile}" ${watermarkInput}${logoInput}` +
            `${filterFlag} ${videoFilter} -af ${audioFilter} ` +
            `-c:v libx264 -preset ${uniqueEffects.preset} -crf ${uniqueEffects.crf} ` +
            `-c:a aac -b:a ${Math.floor(randomInRange(120, 136))}k ` +
            `${metadataArgs} "${outName}"`;

        console.log(`\n🔄 Processing range #${i + 1} → ${outName}`);
        console.log(`   🎲 Effets: sat=${uniqueEffects.saturation.toFixed(2)} hue=${uniqueEffects.hue.toFixed(1)}° speed=${uniqueEffects.speed.toFixed(3)} pitch=${uniqueEffects.pitchShift.toFixed(3)}${hasWatermark ? ' +watermark' : ''}`);
        try {
            execSync(cmd, { stdio: "inherit" });
        } catch {
            console.error(`⛔ Failed to cut range #${i + 1}.`);
        }
    }

    const del = await ask("\nDelete video_temp.mp4? (y/n): ");
    if (del.toLowerCase() === "y" && fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
        console.log("✅ Temporary file deleted.");
    }

    console.log("\n✅ All done!");
    await ask("Press Enter to exit...");
    rl.close();
})();
