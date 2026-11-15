'use strict';

// Acte 2 du reel : la silhouette de l'objet que nomme le mot.
// Bibliothèque curatée dans assets/silhouettes (icônes game-icons.net,
// CC BY 3.0) ; index.json associe chaque silhouette à une liste de mots
// (français et anglais, sans accents). Un mot absent de l'index n'a pas de
// silhouette : le reel passe alors directement du mot au blason.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DIR = path.join(__dirname, '..', '..', 'assets', 'silhouettes');
let index = null;

function normalizeWord(word) {
  return word.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function loadIndex() {
  if (!index) {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
    index = new Map();
    for (const entry of data.silhouettes) {
      for (const w of entry.words) index.set(w, entry);
    }
  }
  return index;
}

// Mot exact, puis singulier simple (« tombs » → « tomb »).
function findSilhouette(word) {
  const idx = loadIndex();
  const w = normalizeWord(word);
  return idx.get(w) || (w.endsWith('s') ? idx.get(w.slice(0, -1)) : undefined) || null;
}

// SVG (fond noir + glyphe blanc) → masque { w, h, on } d'au plus maxW × maxH
// points, recadré sur la forme.
async function silhouetteMask(entry, maxW, maxH) {
  const big = await sharp(path.join(DIR, entry.file), { density: 300 }).resize(512, 512)
    .flatten({ background: '#000' }).extractChannel(0).png().toBuffer();
  const lum = await sharp(big).raw().toBuffer();
  let x0 = 512, y0 = 512, x1 = -1, y1 = -1;
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      if (lum[y * 512 + x] > 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error(`silhouette vide: ${entry.file}`);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const scale = Math.min(maxW / bw, maxH / bh);
  const w = Math.max(1, Math.round(bw * scale)), h = Math.max(1, Math.round(bh * scale));
  const crop = await sharp(big).extract({ left: x0, top: y0, width: bw, height: bh }).png().toBuffer();
  const small = await sharp(crop).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).extractChannel(0).raw().toBuffer();
  const on = new Uint8Array(w * h);
  for (let i = 0; i < on.length; i++) on[i] = small[i] > 120 ? 1 : 0;
  return { w, h, on };
}

module.exports = { normalizeWord, findSilhouette, silhouetteMask };
