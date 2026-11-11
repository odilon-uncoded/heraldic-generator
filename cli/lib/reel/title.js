'use strict';

// Titre d'intro : le mot composé en gothique (Jacquard 24, OFL, embarquée
// dans cli/assets/fonts) puis réduit à une matrice de points braille — la même
// matière que le blason.

const path = require('path');
const sharp = require('sharp');

const FONT_FILE = path.join(__dirname, '..', '..', 'assets', 'fonts', 'Jacquard24-Regular.ttf');
const FONT_FAMILY = 'Jacquard 24';

function escapePango(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Renvoie { w, h, on } : `on[y*w+x]` vaut 1 pour un point allumé. Le mot est
// mis à l'échelle pour tenir dans maxW x maxH points.
async function titleDots(word, maxW, maxH) {
  const label = word.charAt(0).toUpperCase() + word.slice(1);
  const rendered = await sharp({
    text: {
      text: `<span foreground="white">${escapePango(label)}</span>`,
      font: `${FONT_FAMILY} 200`,
      fontfile: FONT_FILE,
      rgba: true,
      dpi: 72,
    },
  }).png().toBuffer();
  const trimmed = await sharp(rendered).trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const scale = Math.min(maxW / meta.width, maxH / meta.height);
  const w = Math.max(1, Math.round(meta.width * scale)), h = Math.max(1, Math.round(meta.height * scale));
  const alpha = await sharp(trimmed).resize(w, h, { fit: 'fill' }).ensureAlpha().extractChannel(3).raw().toBuffer();
  const on = new Uint8Array(w * h);
  for (let i = 0; i < on.length; i++) on[i] = alpha[i] > 110 ? 1 : 0;
  return { w, h, on };
}

module.exports = { titleDots };
