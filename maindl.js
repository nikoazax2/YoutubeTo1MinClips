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
  const tempFile = "video_temp.mp4";
  let videoExists = fs.existsSync(tempFile) && fs.statSync(tempFile).size > 1000;

  let youtubeURL;
  if (!videoExists) {
    youtubeURL = await ask("Lien YouTube : ");
  } else {
    const reuse = await ask("Une vidéo existe déjà. La réutiliser ? (o/n) : ");
    if (reuse.toLowerCase() === "n") {
      youtubeURL = await ask("Lien YouTube : ");
    }
  }

  // on demande plusieurs plages
  const rangesInput = await ask(
    "Saisis les plages (hh:mm:ss-hh:mm:ss, séparées par des virgules) :\n"
  );
  const formatChoice = await ask(
    "Format téléphone recadré (1) ou paysage + bandes floutées (2) ? (1/2, défaut=1) : "
  );
  const useBlurFill = formatChoice.trim() === "2";

  // option: découper automatiquement les plages en segments de 60 secondes
  const autoSplitAns = await ask(
    "Découper automatiquement les plages en segments de 60s ? (o/N) : "
  );
  const autoSplit = autoSplitAns.trim().toLowerCase() === "o";

  const exeDir = process.pkg ? path.dirname(process.execPath) : __dirname;
  const ytDlp = path.join(exeDir, "yt-dlp.exe");
  const ffmpeg = path.join(exeDir, "ffmpeg.exe");

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
    try {
      execSync(
        `"${ytDlp}" --no-continue --no-part --force-overwrites ` +
          `-f "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]" ` +
          `-o "${tempFile}" "${youtubeURL}"`,
        { stdio: "inherit" }
      );
    } catch {
      console.error("⛔ Erreur de téléchargement.");
      process.exit(1);
    }
    console.log("✅ Vidéo téléchargée.");
  } else {
    console.log("✅ Réutilisation de video_temp.mp4");
  }

  // parse des plages
  const ranges = rangesInput
    .split(",")
    .map(r => r.trim())
    .filter(r => r.includes("-"))
    .map(r => {
      const [s, e] = r.split("-");
      return { start: toSeconds(s), end: toSeconds(e) };
    });

  // expansion en segments de 60s si demandé (le dernier segment peut être <60s)
  const expandedRanges = autoSplit
    ? ranges.flatMap(({ start, end }) => {
        const segments = [];
        if (end <= start) return segments;
        let cur = start;
        while (cur + 60 <= end) {
          segments.push({ start: cur, end: cur + 60 });
          cur += 60;
        }
        if (cur < end) segments.push({ start: cur, end });
        return segments;
      })
    : ranges;

  console.log(`\n🧩 Segments à traiter: ${expandedRanges.length}`);

  // filtre FFmpeg corrigé
  const cropFilter = useBlurFill
    ? `"split=2[main][bg];` +
      `[main]scale=1080:-1[fg];` +
      `[bg]scale=1080:1920:force_original_aspect_ratio=increase,boxblur=10:1,crop=1080:1920[bl];` +
      `[bl][fg]overlay=(W-w)/2:(H-h)/2"`
    : `"crop='min(iw,ih*9/16)':'min(ih,iw*16/9)':(iw-ow)/2:(ih-oh)/2,scale=1080:1920"`;

  // traitement de chaque plage
  for (let i = 0; i < expandedRanges.length; i++) {
    const { start, end } = expandedRanges[i];
    if (end <= start) {
      console.warn(`⚠️ Plage ${i + 1} ignorée (fin ≤ début).`);
      continue;
    }
    const duration = end - start;
    const outName = `segment_${i + 1}_${start}s_${end}s_${useBlurFill ? "blur" : "crop"}.mp4`;

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
