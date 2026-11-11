'use strict';

// Atlas de glyphes : chaque caractère est rasterisé UNE fois par sharp, avec
// exactement le même pipeline que les photos V1 (SVG, font-family monospace,
// 24px, baseline à 0.8 cellule). Les frames vidéo sont ensuite composées en
// recopiant ces masques — même rendu de police que les posts, sans relancer
// un rendu SVG par frame.

const sharp = require('sharp');

const CELL_W = 13.5, CELL_H = 27, FONT_SIZE = 24;
// Fenêtre plus large que la cellule : l'avance réelle de la police dépasse
// 13.5px, les glyphes débordent légèrement sur les voisins (comme en V1).
const PAD_X = 3, PAD_Y = 4, GLYPH_W = 20, GLYPH_H = 35;
const SLOT_W = 32, SLOT_H = 48, SLOTS_PER_ROW = 40;

const EXTRA_CHARS = '█▓▒░°';

function charset() {
  const chars = [];
  for (let i = 0; i < 256; i++) chars.push(String.fromCharCode(0x2800 + i));
  for (let i = 0x21; i < 0x7F; i++) chars.push(String.fromCharCode(i));
  for (const ch of EXTRA_CHARS) chars.push(ch);
  return chars;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// La cellule fait 13.5px de large : une colonne sur deux tombe sur un demi
// pixel. Deux phases (0 et 0.5) par glyphe évitent tout flou de recalage.
async function buildAtlas() {
  const chars = charset();
  const slots = chars.length * 2;
  const rows = Math.ceil(slots / SLOTS_PER_ROW);
  const width = SLOTS_PER_ROW * SLOT_W, height = rows * SLOT_H;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#000"/>`;
  svg += `<g font-family="monospace" font-size="${FONT_SIZE}" fill="#fff" xml:space="preserve">`;
  for (let i = 0; i < chars.length; i++) {
    for (let phase = 0; phase < 2; phase++) {
      const slot = i * 2 + phase;
      const x = (slot % SLOTS_PER_ROW) * SLOT_W + PAD_X + phase * 0.5;
      const y = Math.floor(slot / SLOTS_PER_ROW) * SLOT_H + PAD_Y + 0.8 * CELL_H;
      svg += `<text x="${x}" y="${y.toFixed(1)}">${escapeXml(chars[i])}</text>`;
    }
  }
  svg += '</g></svg>';
  const raw = await sharp(Buffer.from(svg)).extractChannel(0).raw().toBuffer();

  const masks = new Array(slots);
  for (let slot = 0; slot < slots; slot++) {
    const sx = (slot % SLOTS_PER_ROW) * SLOT_W, sy = Math.floor(slot / SLOTS_PER_ROW) * SLOT_H;
    const mask = new Uint8Array(GLYPH_W * GLYPH_H);
    for (let y = 0; y < GLYPH_H; y++) {
      for (let x = 0; x < GLYPH_W; x++) mask[y * GLYPH_W + x] = raw[(sy + y) * width + sx + x];
    }
    masks[slot] = mask;
  }
  const index = new Map(chars.map((ch, i) => [ch, i]));
  return { masks, index };
}

// Dessine un glyphe dans un framebuffer RGB24, en "lighten" : là où deux
// glyphes voisins se recouvrent, le plus lumineux gagne.
function blit(frame, frameW, frameH, atlas, glyph, px, py, r, g, b, bg) {
  const xi = Math.floor(px), phase = px - xi >= 0.25 ? 1 : 0;
  const mask = atlas.masks[glyph * 2 + phase];
  const x0 = xi - PAD_X, y0 = Math.round(py) - PAD_Y;
  for (let y = 0; y < GLYPH_H; y++) {
    const fy = y0 + y;
    if (fy < 0 || fy >= frameH) continue;
    for (let x = 0; x < GLYPH_W; x++) {
      const a = mask[y * GLYPH_W + x];
      if (a === 0) continue;
      const fx = x0 + x;
      if (fx < 0 || fx >= frameW) continue;
      const o = (fy * frameW + fx) * 3, k = a / 255;
      const vr = bg[0] + (r - bg[0]) * k, vg = bg[1] + (g - bg[1]) * k, vb = bg[2] + (b - bg[2]) * k;
      if (vr > frame[o]) frame[o] = vr;
      if (vg > frame[o + 1]) frame[o + 1] = vg;
      if (vb > frame[o + 2]) frame[o + 2] = vb;
    }
  }
}

module.exports = { CELL_W, CELL_H, buildAtlas, blit };
