#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const crypto = require('crypto');
const { spawn } = require('child_process');

const { buildGrid, slugify, mulberry32, formatSeedLine } = require('../lib/core');
const { serializeText, serializeAnsi, serializeSvg, cellsToAnsi } = require('../lib/serialize');
const { serializeSvgToPngBuffer } = require('../lib/png');
const { computeDecodeFrame, DECODE_DURATION_MS, DECODE_STAGGER_MS } = require('../lib/animate');
const { renderReel } = require('../lib/reel');

const BANNER = `▗▖ ▗▖▗▄▄▄▖▗▄▄▖  ▗▄▖ ▗▖   ▗▄▄▄ ▗▄▄▄▖ ▗▄▄▖
▐▌ ▐▌▐▌   ▐▌ ▐▌▐▌ ▐▌▐▌   ▐▌  █  █  ▐▌
▐▛▀▜▌▐▛▀▀▘▐▛▀▚▖▐▛▀▜▌▐▌   ▐▌  █  █  ▐▌
▐▌ ▐▌▐▙▄▄▖▐▌ ▐▌▐▌ ▐▌▐▙▄▄▖▐▙▄▄▀▗▄█▄▖▝▚▄▄▖
CLI v0.4.0 — tape /help`;

const EXPORT_FORMATS = ['png', 'png-story', 'png-clean', 'png-clean-story', 'mp4', 'mp4-story', 'mp4-clean', 'mp4-clean-story', 'reel', 'txt', 'ans', 'svg'];
const STORY_HEIGHT = 1920;

function svgOptsFor(grid, story, clean) {
  const opts = { seedLine: !clean };
  if (story) opts.canvasH = STORY_HEIGHT;
  return opts;
}

const VIDEO_FPS = 30;
const VIDEO_HOLD_MS = 1200;

async function renderFramePng(grid, cells, cellW, cellH, canvasH, seedLine) {
  const svg = serializeSvg({ cols: grid.cols, rows: grid.rows, cells, meta: grid.meta }, { cellW, cellH, canvasH, seedLine });
  return serializeSvgToPngBuffer(svg);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('ffmpeg introuvable — installe-le (brew install ffmpeg / apt install ffmpeg) pour exporter en vidéo'));
      } else {
        reject(err);
      }
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg a échoué (code ${code}): ${stderr.slice(-500)}`));
    });
  });
}

async function encodeVideo(grid, cellW, cellH, outPath, canvasH, seedLine) {
  const totalDurationMs = DECODE_STAGGER_MS + DECODE_DURATION_MS + VIDEO_HOLD_MS;
  const totalFrames = Math.ceil(totalDurationMs / (1000 / VIDEO_FPS));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heraldic-'));
  const rng = mulberry32(grid.seed >>> 0);
  try {
    for (let i = 0; i < totalFrames; i++) {
      const t = i * (1000 / VIDEO_FPS);
      const frame = computeDecodeFrame(grid, t, rng);
      const png = await renderFramePng(grid, frame.cells, cellW, cellH, canvasH, seedLine);
      fs.writeFileSync(path.join(tmpDir, `frame-${String(i).padStart(4, '0')}.png`), png);
    }
    // H.264/yuv420p requires even width/height; input 1377px → 1376px.
    await runFfmpeg(['-y', '-framerate', String(VIDEO_FPS), '-i', path.join(tmpDir, 'frame-%04d.png'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p', outPath]);
  } catch (err) {
    fs.rmSync(outPath, { force: true });
    throw err;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function makeEntropy() {
  return crypto.randomBytes(4).readUInt32BE(0) >>> 0;
}

let currentText = '';
let currentEntropy = null;
let pendingExport = Promise.resolve();
let currentGrid = null;
let quitting = false;

const FRAME_INTERVAL_MS = 50;
let generation = 0;
let pendingGenerate = Promise.resolve();

function playDecodeAnimation(grid, myGeneration) {
  if (!process.stdout.isTTY) {
    console.log(serializeAnsi(grid));
    return Promise.resolve();
  }
  const rng = mulberry32(grid.seed >>> 0);
  const start = Date.now();
  let first = true;
  process.stdout.write('\x1b[?25l');
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (generation !== myGeneration) {
        clearInterval(timer);
        resolve();
        return;
      }
      const t = Date.now() - start;
      const frame = computeDecodeFrame(grid, t, rng);
      if (!first) process.stdout.write(`\x1b[${grid.rows}A\x1b[0J`);
      process.stdout.write(cellsToAnsi(frame.cells) + '\n');
      first = false;
      if (frame.done) {
        clearInterval(timer);
        console.log(`\n${formatSeedLine(grid.meta)}`);
        process.stdout.write('\x1b[?25h');
        resolve();
      }
    }, FRAME_INTERVAL_MS);
  });
}

async function generate(text, entropy) {
  currentText = text;
  currentEntropy = entropy;
  currentGrid = buildGrid(text, entropy);
  generation += 1;
  pendingGenerate = playDecodeAnimation(currentGrid, generation);
  await pendingGenerate;
}

function requireGrid() {
  if (!currentGrid) {
    console.log('aucun blason généré — tape un mot d’abord');
    return false;
  }
  return true;
}

// Reel 9:16 de 15 s (intro gothique, pousse du blason, tenue, dissolution).
// `audioArg` : chemin optionnel d'une piste à mixer ; sinon piste silencieuse.
async function runReelExport(audioArg) {
  const text = currentText, entropy = currentEntropy; // capture avant tout await
  const filename = `${slugify(text)}-reel.mp4`;
  let audioPath;
  if (audioArg) {
    audioPath = path.resolve(audioArg.replace(/^~(?=$|\/)/, os.homedir()));
    if (!fs.existsSync(audioPath)) throw new Error(`piste audio introuvable: ${audioPath}`);
  }
  console.log('rendu du reel (15 s, ~20 s de calcul)…');
  try {
    await renderReel(text, entropy, filename, audioPath);
  } catch (err) {
    fs.rmSync(filename, { force: true });
    throw err;
  }
  console.log(`écrit: ${filename}`);
}

async function runExport(fmt, extra) {
  if (fmt === 'reel') return runReelExport(extra);
  const clean = fmt.includes('-clean');
  const story = fmt.includes('-story');
  const suffix = (clean ? '-clean' : '') + (story ? '-story' : '');
  const ext = fmt.replace('-clean', '').replace('-story', '');
  const filename = `${slugify(currentText)}${suffix}.${ext}`;
  const grid = clean ? buildGrid(currentText, currentEntropy, { clean: true }) : currentGrid;
  if (fmt === 'txt') {
    fs.writeFileSync(filename, serializeText(grid));
  } else if (fmt === 'ans') {
    fs.writeFileSync(filename, serializeAnsi(grid));
  } else if (fmt === 'svg') {
    fs.writeFileSync(filename, serializeSvg(grid));
  } else if (ext === 'png') {
    const buffer = await serializeSvgToPngBuffer(serializeSvg(grid, svgOptsFor(grid, story, clean)));
    fs.writeFileSync(filename, buffer);
  } else if (ext === 'mp4') {
    const canvasH = story ? STORY_HEIGHT : undefined;
    await encodeVideo(grid, 13.5, 27, filename, canvasH, !clean);
  }
  console.log(`écrit: ${filename}`);
}

function handleExport(arg, extra) {
  if (!arg || !EXPORT_FORMATS.includes(arg)) {
    console.log(`format invalide — formats valides: ${EXPORT_FORMATS.join(', ')}`);
    return;
  }
  if (!requireGrid()) return;
  pendingExport = runExport(arg, extra).catch((err) => {
    console.log(`échec écriture fichier: ${err.message}`);
  });
}

const COMMANDS = {
  help() {
    console.log([
      'commandes disponibles :',
      '  <texte>              génère un blason à partir du texte',
      '  /reroll               nouveau tirage du même texte',
      '  /export <fmt>         exporte le dernier blason (fmt: png, png-story, png-clean, png-clean-story, mp4, mp4-story, mp4-clean, mp4-clean-story, reel, txt, ans, svg)',
      '  /export reel [audio]  reel 9:16 de 15 s ; chemin de piste audio optionnel',
      '  /clear                 vide l’écran',
      '  /quit                  quitte le programme',
      '  /help                  affiche cette liste',
    ].join('\n'));
  },
  async reroll() {
    if (!requireGrid()) return;
    await generate(currentText, makeEntropy());
  },
  clear() {
    console.clear();
  },
  quit() {
    quitting = true;
    pendingExport.then(() => rl.close());
  },
};

async function handleLine(raw) {
  const text = raw.trim();
  if (text.length === 0) return;
  if (text[0] === '/') {
    const [name, ...rest] = text.slice(1).split(/\s+/);
    const key = name.toLowerCase();
    if (key === 'export') { handleExport(rest[0] ? rest[0].toLowerCase() : undefined, rest.slice(1).join(' ') || undefined); return; }
    if (Object.hasOwn(COMMANDS, key)) { await COMMANDS[key](); return; }
    console.log(`commande inconnue: /${name} — tape /help`);
    return;
  }
  await generate(text, makeEntropy());
}

console.log(BANNER);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'heraldic:~$ ',
});

rl.prompt();
rl.on('line', async (line) => {
  if (quitting) return;
  await handleLine(line);
  rl.prompt();
});
rl.on('close', () => {
  Promise.all([pendingExport, pendingGenerate]).finally(() => process.exit(0));
});
