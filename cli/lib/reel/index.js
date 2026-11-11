'use strict';

const core = require('../core');
const { buildAtlas } = require('./atlas');
const { titleDots } = require('./title');
const { encodeMp4 } = require('./encode');
const scene = require('./scene');

// Rend le reel 9:16 de 15 s du blason (text, entropy) dans `outPath`.
// `audioPath` est optionnel : sans lui, la piste audio est silencieuse.
async function renderReel(text, entropy, outPath, audioPath) {
  const atlas = await buildAtlas();
  const sc = await scene.buildScene(text, entropy, core, { atlas, titleDots });
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
  return { grid: sc.grid, coverMs: scene.COVER_MS };
}

module.exports = { renderReel, scene };
