'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../lib/core');
const { buildAtlas } = require('../lib/reel/atlas');
const { titleDots } = require('../lib/reel/title');
const scene = require('../lib/reel/scene');

const frameBytes = scene.WIDTH * scene.HEIGHT * 3;
let atlasPromise;
const build = (text, entropy) => {
  atlasPromise = atlasPromise || buildAtlas();
  return atlasPromise.then((atlas) => scene.buildScene(text, entropy, core, { atlas, titleDots }));
};
const litPixels = (frame) => {
  let n = 0;
  for (let i = 0; i < frame.length; i += 3) if (frame[i] > 40) n++;
  return n;
};

test('la pousse retombe sur le blason de buildGrid, toutes symétries confondues', async () => {
  // buildScene lève si la grille finale diffère de buildGrid.
  for (const text of ['tenebre', 'argile', 'cryptographic', 'lock-up', 'épave', 'x']) {
    for (const entropy of [0, 12345, 0xFFFFFFFF]) {
      const sc = await build(text, entropy);
      assert.equal(sc.grid.seed, core.buildGrid(text, entropy).seed);
      assert.ok(sc.bloomEnd < 13.2, `pousse terminée avant la dissolution (${sc.bloomEnd})`);
    }
  }
});

test('les frames sont déterministes pour (texte, entropie)', async () => {
  const a = await build('chateau', 42), b = await build('chateau', 42);
  const fa = Buffer.alloc(frameBytes), fb = Buffer.alloc(frameBytes);
  for (const t of [1.0, 2.2, 3.1, 5.0, scene.COVER_MS / 1000, 13.8]) {
    a.renderFrame(t, fa); b.renderFrame(t, fb);
    assert.ok(fa.equals(fb), `frame t=${t}`);
  }
});

test('la boucle part du noir et y revient, le blason est visible à la couverture', async () => {
  const sc = await build('chateau', 42);
  const frame = Buffer.alloc(frameBytes);
  sc.renderFrame(0, frame);
  assert.equal(litPixels(frame), 0);
  sc.renderFrame(scene.DURATION - 1 / scene.FPS, frame);
  assert.equal(litPixels(frame), 0);
  sc.renderFrame(scene.COVER_MS / 1000, frame);
  assert.ok(litPixels(frame) > 5000);
});
