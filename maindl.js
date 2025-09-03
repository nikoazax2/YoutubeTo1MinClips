#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");
const https = require("https");
const unzipper = require("unzipper");

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

    // Demande si on veut toute la vidéo
    const allVideoAns = await ask("Prendre toute la vidéo ? (o/n) : ");
    let rangesInput = "";
    let useAllVideo = allVideoAns.trim().toLowerCase() === "o";
    let formatChoice, useBlurFill, autoSplitAns, autoSplit;
    if (useAllVideo) {
        // On prendra toute la vidéo, on déterminera la durée plus tard
        formatChoice = await ask("Format téléphone recadré (1) ou paysage + bandes floutées (2) ? (1/2, défaut=1) : ");
        useBlurFill = formatChoice.trim() === "2";
        autoSplitAns = await ask("Découper automatiquement la vidéo en segments de 60s ? (O/n) : ");
        autoSplit = autoSplitAns.trim().toLowerCase() !== "n";
    } else {
        // On demande les plages
        rangesInput = await ask("Saisis les plages (hh:mm:ss-hh:mm:ss, séparées par des virgules) :\n");
        formatChoice = await ask("Format téléphone recadré (1) ou paysage + bandes floutées (2) ? (1/2, défaut=1) : ");
        useBlurFill = formatChoice.trim() === "2";
        autoSplitAns = await ask("Découper automatiquement les plages en segments de 60s ? (O/n) : ");
        autoSplit = autoSplitAns.trim().toLowerCase() !== "n";
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
        let formatString = "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]";
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

    // Accélération de la vidéo de 1,5 %
        const acceleratedFile = path.join(exeDir, "video_temp_accelerated.mp4");
        try {
            console.log("\n⚡ Accélération de la vidéo de 20 %...");
            execSync(
                `"${ffmpeg}" -y -i "${tempFile}" -filter:v "setpts=0.833*PTS" -filter:a "atempo=1.2" "${acceleratedFile}"`,
                { stdio: "inherit" }
            );
            console.log("✅ Vidéo accélérée enregistrée sous video_temp_accelerated.mp4");
        } catch {
            console.error("⛔ Échec de l'accélération de la vidéo.");
            process.exit(1);
        }

    // parse des plages
    let expandedRanges = [];
    if (useAllVideo) {
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
    // Pour que chaque segment fasse 1 min après accélération, on découpe par 60 / 0.833 ≈ 72.04 secondes
    const accelFactor = 0.833;
    const targetSegment = 60 / accelFactor; // ≈ 72.04
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
    // Pour que chaque segment fasse 1 min après accélération, on découpe par 60 / 0.833 ≈ 72.04 secondes
    const accelFactor = 0.833;
    const targetSegment = 60 / accelFactor; // ≈ 72.04
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

        // Utilisation de la vidéo accélérée pour les découpes
        const cmd =
            `"${ffmpeg}" -y -ss ${start} -t ${duration} -i "${acceleratedFile}" ` +
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
