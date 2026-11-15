'use strict';

const core = require('../core');
const { buildAtlas } = require('./atlas');
const { titleDots } = require('./title');
const { encodeMp4 } = require('./encode');
const { findSilhouette, silhouetteMask } = require('./silhouette');
const scene = require('./scene');

// Rend le reel 9:16 de 20 s du blason (text, entropy) dans `outPath`.
// Si le mot a une silhouette, le reel passe par l'objet (mot → objet →
// blason) ; sinon il va directement du mot au blason.
// `audioPath` est optionnel : sans lui, la piste audio est silencieuse.
// Renvoie la silhouette utilisée (id, auteur, source), à créditer : CC BY 3.0.
async function renderReel(text, entropy, outPath, audioPath) {
  const atlas = await buildAtlas();
  const entry = findSilhouette(text);
  const silhouette = entry ? await silhouetteMask(entry, 124, 150) : null;
  const sc = await scene.buildScene(text, entropy, core, { atlas, titleDots, silhouette });
  const frame = Buffer.alloc(scene.WIDTH * scene.HEIGHT * 3);
  const total = scene.FPS * scene.DURATION;
  await encodeMp4({
    width: scene.WIDTH, height: scene.HEIGHT, fps: scene.FPS, duration: scene.DURATION, outPath, audioPath,
    writeFrames: async (write) => {
      for (let i = 0; i < total; i++) {
        sc.renderFrame(i / scene.FPS, frame);
        await write(Buffer.from(frame)); // copie : le buffer est réécrit à la frame suivante
      }
    },
  });
  return {
    grid: sc.grid,
    coverMs: scene.COVER_MS,
    silhouette: entry ? { id: entry.id, author: entry.author, source: entry.source } : null,
  };
}

module.exports = { renderReel, scene };
