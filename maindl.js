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
    return new Promise((resolve) => rl.question(question, resolve));
}

function toSeconds(time) {
    const [m, s] = time.split(":").map(Number);
    return m * 60 + s;
}

async function downloadFFmpeg(destFolder) {
    console.log("\nffmpeg.exe introuvable. Téléchargement en cours…");
    const zipPath = path.join(destFolder, "ffmpeg.zip");
    const ffmpegUrl =
        "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-7.0.2-essentials_build.zip";

    await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(zipPath);
        const options = {
            headers: {
                "User-Agent": "Mozilla/5.0",
            },
        };

        https
            .get(ffmpegUrl, options, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Échec téléchargement : HTTP ${response.statusCode}`));
                    return;
                }

                response.pipe(file);
                file.on("finish", () => {
                    file.close(resolve);
                });
            })
            .on("error", (err) => {
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                reject(err);
            });
    });

    console.log("✅ Archive téléchargée. Extraction…");

    await fs
        .createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: destFolder }))
        .promise();

    const folders = fs
        .readdirSync(destFolder)
        .filter((f) => fs.statSync(path.join(destFolder, f)).isDirectory());
    let found = false;
    for (const folder of folders) {
        const ffmpegCandidate = path.join(
            destFolder,
            folder,
            "bin",
            "ffmpeg.exe"
        );
        if (fs.existsSync(ffmpegCandidate)) {
            fs.copyFileSync(ffmpegCandidate, path.join(destFolder, "ffmpeg.exe"));
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
    let youtubeURL = await ask("Lien YouTube : ");
    const startTime = await ask("Timecode de début (mm:ss, laisser vide pour 00:00) : ");
    const endTime = await ask("Timecode de fin (mm:ss, laisser vide pour toute la vidéo) : ");
    youtubeURL = youtubeURL || 'https://www.youtube.com/watch?v=y6120QOlsfU';

    const startSec = startTime ? toSeconds(startTime) : 0;

    const tempFile = "video_temp.mp4";

    const exeDir =
        process.pkg !== undefined
            ? path.dirname(process.execPath)
            : __dirname;

    const ytDlpPath = path.join(exeDir, "yt-dlp.exe");
    const ffmpegPath = path.join(exeDir, "ffmpeg.exe");

    if (!fs.existsSync(ytDlpPath)) {
        console.error("⛔ yt-dlp.exe est introuvable dans le dossier.");
        process.exit(1);
    }

    if (!fs.existsSync(ffmpegPath)) {
        await downloadFFmpeg(exeDir);
    }

    console.log("\n⬇️ Téléchargement de la vidéo…");

    if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
    }

    try {
        execSync(
            `"${ytDlpPath}" --no-continue --no-part --force-overwrites -f "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]" -o "${tempFile}" "${youtubeURL}"`,
            { stdio: "inherit" }
        );

    } catch (err) {
        console.error("⛔ Erreur lors du téléchargement. Vérifie que yt-dlp.exe fonctionne.");
        process.exit(1);
    }

    if (!fs.existsSync(tempFile) || fs.statSync(tempFile).size < 1000) {
        console.error("⛔ Le fichier vidéo est vide ou invalide.");
        process.exit(1);
    }

    console.log("✅ Téléchargement terminé.");

    let endSec;

    if (!endTime) {
        console.log("⏳ Détermination de la durée de la vidéo…");
        const ffmpegCmd = `"${ffmpegPath}" -i "${tempFile}" -hide_banner`;
        try {
            execSync(ffmpegCmd, { stdio: "pipe" });
        } catch (err) {
            const output = err.stderr.toString();
            const match = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
            if (match) {
                const [, h, m, s] = match;
                endSec = (+h) * 3600 + (+m) * 60 + (+s);
                console.log(`✅ Durée détectée : ${h}:${m}:${s}`);
            } else {
                console.error("⛔ Impossible de déterminer la durée de la vidéo.");
                process.exit(1);
            }
        }
    } else {
        endSec = toSeconds(endTime);
    }

    if (endSec <= startSec) {
        console.error("⛔ Le temps de fin doit être après le début.");
        process.exit(1);
    }

    const duration = endSec - startSec;
    const numParts = Math.ceil(duration / 60);

    const baseName = path.basename(tempFile, path.extname(tempFile));

    console.log(
        `\nDécoupe + crop + audio de la vidéo téléchargée de ${startTime || "00:00"} à ${endTime || "fin"} en ${numParts} parties.\n`
    );

    for (let i = 0; i < numParts; i++) {
        const partStart = startSec + i * 60;
        let partDuration = 60;
        if (partStart + partDuration > endSec) {
            partDuration = endSec - partStart;
        }

        const output = `${baseName}_part${i + 1}_portrait.mp4`;

        const cropFilter = `"crop='min(iw,ih*9/16)':'min(ih,iw*16/9)':(iw-ow)/2:(ih-oh)/2,scale=1080:1920"`;

        const cmd =
            `"${ffmpegPath}" -y -ss ${partStart} -t ${partDuration} -i "${tempFile}" ` +
            `-vf ${cropFilter} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k "${output}"`;

        console.log(`Exécution : ${cmd}`);
        try {
            execSync(cmd, { stdio: "inherit" });
        } catch (err) {
            console.error("⛔ Erreur pendant le découpage avec FFmpeg.");
            process.exit(1);
        }
    }

    fs.unlinkSync(tempFile);

    console.log("\n✅ Tout est terminé avec succès !");
    await ask("\nAppuie sur Entrée pour quitter...");
    rl.close();
})();
