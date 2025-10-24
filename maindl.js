#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");
const https = require("https");
const unzipper = require("unzipper");

// Suppression de l'accélération : la vidéo sera traitée à vitesse normale

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
 * Heuristique locale pour extraire des "meilleurs moments" d'une vidéo qui ne t'appartient pas.
 * Hypothèses:
 *  - Le fichier vidéo déjà téléchargé est `video_temp.mp4` dans le dossier courant (exeDir).
 *  - On utilise uniquement des signaux accessibles sans analytics: timestamps dans description/commentaires + coupures de scène.
 *  - On propose N fenêtres de longueur fixe autour des pics de score combiné.
 *
 * Score par seconde = 3 * (timestamp proche) + 1 * (densité de coupes de scène).
 * On glisse une fenêtre (spanSeconds) et on prend les meilleures non-chevauchantes.
 *
 * @param {string} videoUrl URL YouTube
 * @param {object} [opts]
 * @param {number} [opts.maxHighlights=5] Nombre de segments à retourner
 * @param {number} [opts.spanSeconds=30] Durée d'un segment en secondes
 * @param {number} [opts.sceneThreshold=0.4] Seuil de détection de scène ffmpeg
 * @param {boolean} [opts.includeComments=true] Activer parse des commentaires (peut être lent)
 * @returns {Array<{start:number,end:number,score:number,reason:string}>}
 */
function getBestMoments(videoUrl, opts = {}) {
    const {
        maxHighlights = 5,
        spanSeconds = 30,
        sceneThreshold = 0.4,
        includeComments = true,
    } = opts;

    const exeDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
    const ytDlp = path.join(exeDir, "yt-dlp.exe");
    const ffmpeg = path.join(exeDir, "ffmpeg.exe");
    const tempFile = path.join(exeDir, "video_temp.mp4");

    if (!fs.existsSync(tempFile)) {
        console.warn("getBestMoments: fichier vidéo introuvable: " + tempFile);
        return [];
    }
    if (!fs.existsSync(ytDlp)) {
        console.warn("getBestMoments: yt-dlp.exe introuvable.");
        return [];
    }
    if (!fs.existsSync(ffmpeg)) {
        console.warn("getBestMoments: ffmpeg.exe introuvable.");
        return [];
    }

    // 1. Durée de la vidéo
    let duration = 0;
    try {
        // On force l'écriture dans stderr; execSync renvoie l'erreur qu'on capture pour lire la durée
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
        console.warn("getBestMoments: durée non déterminée.");
        return [];
    }

    // 2. Récupération description (+ éventuels commentaires)
    let rawText = "";
    try {
        rawText += execSync(`"${ytDlp}" --get-description "${videoUrl}"`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    } catch { /* ignore */ }
    if (includeComments) {
        try {
            // Peut être lent / gros; on peut limiter plus tard
            rawText += "\n" + execSync(`"${ytDlp}" --get-comments "${videoUrl}"`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
        } catch { /* ignore */ }
    }

    // 3. Extraction timestamps (MM:SS ou HH:MM:SS) -> secondes
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

    // Fréquence par seconde (fenêtre ±5s)
    const timestampWeightRadius = 5;
    const tsPresence = new Array(Math.ceil(duration) + 1).fill(0);
    timestampSeconds.forEach(sec => {
        const start = Math.max(0, sec - timestampWeightRadius);
        const end = Math.min(tsPresence.length - 1, sec + timestampWeightRadius);
        for (let i = start; i <= end; i++) tsPresence[i] += 1;
    });

    // 4. Détection de scènes -> liste des times (secs) où changement significatif
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
        // fallback silencieux
    }
    sceneCuts.sort((a, b) => a - b);

    // Densité de coupes par seconde (±2s)
    const sceneRadius = 2;
    const cutDensity = new Array(Math.ceil(duration) + 1).fill(0);
    for (const cut of sceneCuts) {
        const base = Math.round(cut);
        const start = Math.max(0, base - sceneRadius);
        const end = Math.min(cutDensity.length - 1, base + sceneRadius);
        for (let i = start; i <= end; i++) cutDensity[i] += 1;
    }

    // 5. Score combiné par seconde
    const scores = new Array(Math.ceil(duration) + 1).fill(0);
    for (let i = 0; i < scores.length; i++) {
        scores[i] = tsPresence[i] * 3 + cutDensity[i] * 1; // pondérations simples
    }

    // 6. Sliding window pour repérer meilleurs segments
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
    // Trie par score décroissant
    windowScores.sort((a, b) => b.score - a.score);

    // 7. Sélection non-chevauchante des top N
    const chosen = [];
    for (const w of windowScores) {
        if (chosen.length >= maxHighlights) break;
        if (chosen.some(c => !(w.end <= c.start || w.start >= c.end))) continue; // overlap
        const reasonParts = [];
        // Indices de ts dans la fenêtre
        const tsCount = timestampSeconds.filter(ts => ts >= w.start && ts <= w.end).length;
        if (tsCount) reasonParts.push(`${tsCount} timestamps`);
        const cutsCount = sceneCuts.filter(sc => sc >= w.start && sc <= w.end).length;
        if (cutsCount) reasonParts.push(`${cutsCount} coupes`);
        if (reasonParts.length === 0) reasonParts.push("activité relative");
        chosen.push({ start: w.start, end: Math.min(duration, w.end), score: w.score, reason: reasonParts.join(", ") });
    }

    // Si rien sélectionné, fallback: début de la vidéo
    if (chosen.length === 0) {
        chosen.push({ start: 0, end: Math.min(duration, span), score: 0, reason: "fallback" });
    }

    return chosen;
}

async function downloadFFmpeg(destFolder) {
    console.log("\nffmpeg.exe introuvable. Téléchargement en cours…");
    const zipPath = path.join(destFolder, "ffmpeg.zip");
    const ffmpegUrl =
        "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-7.0.2-essentials_build.zip";

    await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(zipPath);
        const options = { headers: { "User-Agent": "Mozilla/5.0" } };

        https
            .get(ffmpegUrl, options, response => {
                if (response.statusCode !== 200) {
                    return reject(new Error(`Échec téléchargement : HTTP ${response.statusCode}`));
                }
                response.pipe(file);
                file.on("finish", () => file.close(resolve));
            })
            .on("error", err => {
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                reject(err);
            });
    });

    console.log("✅ Archive téléchargée. Extraction…");
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
        console.error("⛔ Impossible de trouver ffmpeg.exe après extraction.");
        process.exit(1);
    }
    console.log("✅ ffmpeg.exe installé avec succès.\n");
}

(async () => {
    const exeDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
    const ytDlp = path.join(exeDir, "yt-dlp.exe");
    const ffmpeg = path.join(exeDir, "ffmpeg.exe");
    const tempFile = path.join(exeDir, "video_temp.mp4");

    let videoExists = fs.existsSync(tempFile) && fs.statSync(tempFile).size > 1000;

    let youtubeURL;
    if (!videoExists) {
        youtubeURL = await ask("Lien YouTube : ");
    } else {
        const reuse = await ask("Une vidéo existe déjà. La réutiliser ? (o/n) : ");
        if (reuse.toLowerCase() === "n") {
            videoExists = false; // Indique qu'il n'y a pas de vidéo existante à réutiliser
            youtubeURL = await ask("Lien YouTube : ");
        }
    }

    // Mode highlights ?
    const highlightAns = await ask("Extraire automatiquement les meilleurs moments (segments de 60s) ? (o/n) : ");
    const highlightMode = highlightAns.trim().toLowerCase() === "o";
    let highlightCount = 5;
    let includeComments = true;
    let rangesInput = "";
    let useAllVideo = false;
    let formatChoice, useBlurFill, autoSplitAns, autoSplit = false;

    if (highlightMode) {
        const hc = await ask("Nombre de segments de highlights souhaités ? (défaut=5) : ");
        if (hc && !isNaN(parseInt(hc.trim(), 10)) && parseInt(hc.trim(), 10) > 0) {
            highlightCount = parseInt(hc.trim(), 10);
        }
        const commentsAns = await ask("Inclure analyse des commentaires (plus lent) ? (O/n) : ");
        includeComments = commentsAns.trim().toLowerCase() !== "n";
        // formatChoice = await ask("Format téléphone recadré (1) ou paysage + bandes floutées (2) ? (1/2, défaut=1) : ");
        useBlurFill = true
    } else {
        // Demande si on veut toute la vidéo (mode classique)
        const allVideoAns = await ask("Prendre toute la vidéo ? (o/n) : ");
        useAllVideo = allVideoAns.trim().toLowerCase() === "o";
        if (useAllVideo) {
            // formatChoice = await ask("Format téléphone recadré (1) ou paysage + bandes floutées (2) ? (1/2, défaut=1) : ");
            useBlurFill = true
            autoSplitAns = await ask("Découper automatiquement la vidéo en segments ? (O/n) : ");
            autoSplit = autoSplitAns.trim().toLowerCase() !== "n";
        } else {
            rangesInput = await ask("Saisis les plages (hh:mm:ss-hh:mm:ss, séparées par des virgules) :\n");
            // formatChoice = await ask("Format téléphone recadré (1) ou paysage + bandes floutées (2) ? (1/2, défaut=1) : ");
            useBlurFill = true
            autoSplitAns = await ask("Découper automatiquement les plages en segments de 60s ? (O/n) : ");
            autoSplit = autoSplitAns.trim().toLowerCase() !== "n";
        }
    }

    // Demande de la durée des segments si découpe automatique choisie
    let segmentLength = 60; // durée par défaut en secondes
    if (autoSplit) {
        const segLenAns = await ask("Durée des segments en secondes ? (défaut=60) : ");
        if (segLenAns && segLenAns.trim() !== "") {
            const maybeNum = parseInt(segLenAns.trim(), 10);
            if (!isNaN(maybeNum) && maybeNum > 0) {
                segmentLength = maybeNum;
            } else {
                console.log("Valeur invalide. Utilisation de 60s par défaut.");
            }
        }
    }

    if (!fs.existsSync(ytDlp)) {
        console.error("⛔ yt-dlp.exe introuvable.");
        process.exit(1);
    }
    if (!fs.existsSync(ffmpeg)) {
        await downloadFFmpeg(exeDir);
    }

    // téléchargement si besoin
    if (!videoExists) {
        console.log("\n⬇️ Téléchargement de la vidéo…");
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
                console.error("⛔ Erreur de téléchargement. Format demandé non disponible.");
                // Affiche la liste des formats disponibles
                console.log("\nListe des formats disponibles :\n");
                try {
                    execSync(`"${ytDlp}" --list-formats "${youtubeURL}"`, { stdio: "inherit" });
                } catch {
                    console.error("Impossible d'obtenir la liste des formats.");
                    process.exit(1);
                }
                // Demande à l'utilisateur les formats vidéo et audio séparés
                videoFormat = await ask("Code du format vidéo (ex: 232) : ");
                audioFormat = await ask("Code du format audio (ex: 233-1) : ");
                if (!videoFormat || !audioFormat) {
                    console.error("⛔ Aucun format saisi.");
                    process.exit(1);
                }
                separateDownload = true;
                break;
            }
        }
        if (!downloadSuccess && separateDownload) {
            // Téléchargement séparé vidéo et audio
            const tempVideo = path.join(exeDir, "video_temp_onlyvideo.mp4");
            const tempAudio = path.join(exeDir, "video_temp_onlyaudio.m4a");
            try {
                execSync(`"${ytDlp}" --no-continue --no-part --force-overwrites -f "${videoFormat}" -o "${tempVideo}" "${youtubeURL}"`, { stdio: "inherit" });
                execSync(`"${ytDlp}" --no-continue --no-part --force-overwrites -f "${audioFormat}" -o "${tempAudio}" "${youtubeURL}"`, { stdio: "inherit" });
            } catch {
                console.error("⛔ Erreur lors du téléchargement séparé vidéo ou audio.");
                process.exit(1);
            }
            // Fusionne vidéo et audio avec ffmpeg
            try {
                execSync(`"${ffmpeg}" -y -i "${tempVideo}" -i "${tempAudio}" -c:v copy -c:a aac -b:a 128k "${tempFile}"`, { stdio: "inherit" });
                fs.unlinkSync(tempVideo);
                fs.unlinkSync(tempAudio);
                downloadSuccess = true;
            } catch {
                console.error("⛔ Erreur lors de la fusion vidéo+audio avec ffmpeg.");
                process.exit(1);
            }
        }
        if (!downloadSuccess) {
            console.error("⛔ Erreur lors du téléchargement. Vérifie que yt-dlp.exe fonctionne.");
            process.exit(1);
        }
        console.log("✅ Vidéo téléchargée et fusionnée.");
    } else {
        console.log("✅ Réutilisation de video_temp.mp4");
    }

    // La vidéo sera traitée à vitesse normale, pas d'accélération

    // Construction des plages
    let expandedRanges = [];
    if (highlightMode) {
        console.log("\n🔍 Calcul des meilleurs moments…");
        const highlights = getBestMoments(youtubeURL, { maxHighlights: highlightCount, spanSeconds: 60, includeComments });
        if (!highlights.length) {
            console.log("⚠️ Aucun highlight détecté, fallback sur début de la vidéo.");
        } else {
            console.log("✅ Highlights trouvés:");
            highlights.forEach((h, idx) => {
                console.log(`#${idx + 1} ${h.start}s → ${h.end}s (${Math.round(h.end - h.start)}s) score=${h.score.toFixed(2)} raisons: ${h.reason}`);
            });
        }
        expandedRanges = highlights.map(h => ({ start: h.start, end: h.end }));
        if (!expandedRanges.length) expandedRanges = [{ start: 0, end: 60 }];
    } else if (useAllVideo) {
        // Détermine la durée de la vidéo
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
                console.error("⛔ Impossible de déterminer la durée de la vidéo.");
                process.exit(1);
            }
        }
        // On découpe en segments de 60s
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
        // On découpe en segments de 60s
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

    console.log(`\n🧩 Segments à traiter: ${expandedRanges.length}`);
    if (highlightMode) {
        console.log("(Mode highlights automatique)");
    }

    // filtre FFmpeg corrigé
    const cropFilter = useBlurFill
        ? `"split=2[main][bg];` +
        `[main]scale=1080:-1[fg];` +
        `[bg]scale=1080:1920:force_original_aspect_ratio=increase,boxblur=20:1,crop=1080:1920[bl];` +
        `[bl][fg]overlay=(W-w)/2:(H-h)/2"`
        : `"crop='min(iw,ih*9/16)':'min(ih,iw*16/9)':(iw-ow)/2:(ih-oh)/2,scale=1080:1920"`;

    // Ajout de la logique pour créer un sous-dossier spécifique
    const videoName = youtubeURL ? youtubeURL.split('v=')[1] || 'video' : 'video';
    const downloadDate = new Date().toISOString().split('T')[0];
    let videoTitle = "video";
    if (youtubeURL) {
        try {
            const metadata = execSync(`"${ytDlp}" --get-title "${youtubeURL}"`, { encoding: "utf-8" });
            videoTitle = metadata.trim().replace(/[^a-zA-Z0-9-_ ]/g, "_"); // Nettoyage du titre
        } catch {
            console.warn("⚠️ Impossible de récupérer le titre de la vidéo. Utilisation du nom par défaut.");
        }
    }
    // Mise à jour pour remplacer les espaces par des underscores dans le titre
    videoTitle = 'output_' + videoTitle.replace(/\s+/g, "_");
    // Mise à jour pour gérer correctement les chemins dans les deux cas (Node.js et .exe)
    const outputDir = path.join(exeDir, `${videoTitle}_${downloadDate}`);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    // traitement de chaque plage
    for (let i = 0; i < expandedRanges.length; i++) {
        const { start, end } = expandedRanges[i];
        if (end <= start) {
            console.warn(`⚠️ Plage ${i + 1} ignorée (fin ≤ début).`);
            continue;
        }
        const duration = end - start;
        const outName = path.join(outputDir, `segment_${i + 1}_${start}s_${end}s_${useBlurFill ? "blur" : "crop"}.mp4`);

        // Utilisation de la vidéo originale pour les découpes
        const cmd =
            `"${ffmpeg}" -y -ss ${start} -t ${duration} -i "${tempFile}" ` +
            `-vf ${cropFilter} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k "${outName}"`;

        console.log(`\n🔄 Traitement plage #${i + 1} → ${outName}`);
        try {
            execSync(cmd, { stdio: "inherit" });
        } catch {
            console.error(`⛔ Échec découpe plage #${i + 1}.`);
        }
    }

    const del = await ask("\nSupprimer video_temp.mp4 ? (o/n) : ");
    if (del.toLowerCase() === "o" && fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
        console.log("✅ Fichier temporaire supprimé.");
    }

    console.log("\n✅ Tout est terminé !");
    await ask("Appuie sur Entrée pour quitter...");
    rl.close();
})();
