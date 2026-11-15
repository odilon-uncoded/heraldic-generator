'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../lib/core');
const { buildAtlas } = require('../lib/reel/atlas');
const { titleDots } = require('../lib/reel/title');
const { findSilhouette, silhouetteMask, normalizeWord } = require('../lib/reel/silhouette');
const scene = require('../lib/reel/scene');

const frameBytes = scene.WIDTH * scene.HEIGHT * 3;
let atlasPromise;
const build = async (text, entropy) => {
  atlasPromise = atlasPromise || buildAtlas();
  const atlas = await atlasPromise;
  const entry = findSilhouette(text);
  const silhouette = entry ? await silhouetteMask(entry, 124, 150) : null;
  return scene.buildScene(text, entropy, core, { atlas, titleDots, silhouette });
};
const litPixels = (frame) => {
  let n = 0;
  for (let i = 0; i < frame.length; i += 3) if (frame[i] > 40) n++;
  return n;
};

test('silhouettes : mots français et anglais, accents et pluriels', () => {
  assert.equal(findSilhouette('Donjon').id, 'castle');
  assert.equal(findSilhouette('château').id, 'castle');
  assert.equal(findSilhouette('crâne').id, 'skull');
  assert.equal(findSilhouette('tombs').id, 'tombstone');
  assert.equal(findSilhouette('argile'), null);
  assert.equal(normalizeWord(' Épave '), 'epave');
});

test('chaque silhouette de la bibliothèque se charge en masque non vide', async () => {
  const { silhouettes } = require('../assets/silhouettes/index.json');
  for (const entry of silhouettes) {
    const m = await silhouetteMask(entry, 124, 150);
    assert.ok(m.w <= 124 && m.h <= 150 && m.on.some((v) => v === 1), entry.id);
  }
});

test('la pousse retombe sur le blason de buildGrid, avec ou sans silhouette', async () => {
  // buildScene lève si la grille finale diffère de buildGrid.
  for (const text of ['donjon', 'crâne', 'argile', 'cryptographic', 'lock-up', 'x']) {
    for (const entropy of [0, 12345, 0xFFFFFFFF]) {
      const sc = await build(text, entropy);
      assert.equal(sc.grid.seed, core.buildGrid(text, entropy).seed);
      assert.ok(sc.bloomEnd < scene.COVER_MS / 1000, `pousse terminée avant la couverture (${sc.bloomEnd})`);
    }
  }
});

test('les frames sont déterministes pour (texte, entropie)', async () => {
  const a = await build('donjon', 42), b = await build('donjon', 42);
  const fa = Buffer.alloc(frameBytes), fb = Buffer.alloc(frameBytes);
  for (const t of [1.0, 3.1, 5.5, 8.6, scene.COVER_MS / 1000, 18.9]) {
    a.renderFrame(t, fa); b.renderFrame(t, fb);
    assert.ok(fa.equals(fb), `frame t=${t}`);
  }
});

test('la boucle part du noir et y revient, le blason est visible à la couverture', async () => {
  for (const text of ['donjon', 'argile']) {
    const sc = await build(text, 42);
    const frame = Buffer.alloc(frameBytes);
    sc.renderFrame(0, frame);
    assert.equal(litPixels(frame), 0, `${text} t=0`);
    sc.renderFrame(scene.DURATION - 1 / scene.FPS, frame);
    assert.equal(litPixels(frame), 0, `${text} fin`);
    sc.renderFrame(scene.COVER_MS / 1000, frame);
    assert.ok(litPixels(frame) > 5000, `${text} couverture`);
  }
});

test("l'objet est affiché pendant sa tenue", async () => {
  const sc = await build('donjon', 42);
  const frame = Buffer.alloc(frameBytes);
  sc.renderFrame(6, frame);
  assert.ok(litPixels(frame) > 20000);
});
