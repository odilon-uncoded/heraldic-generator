const test = require('node:test');
const assert = require('node:assert/strict');
const assertLoose = require('node:assert');
const core = require('../lib/core');

test('constantes de grille figées', () => {
  const { COLS, ROWS, DOT_W, DOT_H } = core;
  assert.equal(COLS, 80);
  assert.equal(ROWS, 50);
  assert.equal(DOT_W, 160);
  assert.equal(DOT_H, 200);
});

test('hashString déterministe', () => {
  const { hashString } = core;
  assert.equal(hashString('sthol'), hashString('sthol'));
  assert.notEqual(hashString('sthol'), hashString('kaldrek'));
});

test('mulberry32 reproductible', () => {
  const { mulberry32 } = core;
  const a = mulberry32(123), b = mulberry32(123);
  assertLoose.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('slugify utilise la forme échappée des diacritiques', () => {
  const { slugify } = core;
  assert.equal(slugify('Épée Ardente'), 'epee-ardente');
  assert.equal(slugify(''), 'blason');
});

test('deriveParams: même famille pour même familyRng, micro variable', () => {
  const { mulberry32, deriveParams } = core;
  const p1 = deriveParams(mulberry32(42), mulberry32(1));
  const p2 = deriveParams(mulberry32(42), mulberry32(2));
  assert.deepEqual(p1.symmetry, p2.symmetry);
  assert.equal(p1.paletteBias, p2.paletteBias);
  assert.notDeepEqual(p1.clusters, p2.clusters);
});

test('deriveParams: bornes des paramètres', () => {
  const { mulberry32, deriveParams } = core;
  const p = deriveParams(mulberry32(7), mulberry32(9));
  assert.ok(['axial', 'radial'].includes(p.symmetry.type));
  assert.ok(p.clusters.length >= 3 && p.clusters.length <= 7);
  assert.ok(p.jitter >= 0.3 && p.jitter <= 0.8);
  for (const c of p.clusters) {
    assert.ok(c.distance >= 0.15 && c.distance <= 0.9);
    assert.ok(c.particleCount > 0);
  }
});

test('gaussianRandom: renvoie un nombre fini', () => {
  const { mulberry32, gaussianRandom } = core;
  const rng = mulberry32(3);
  for (let i = 0; i < 20; i++) assert.ok(Number.isFinite(gaussianRandom(rng)));
});

test('generateParticles: respecte la symétrie radiale (k centres)', () => {
  const { mulberry32, generateParticles } = core;
  const params = { symmetry: { type: 'radial', k: 4 }, sectorAngle: Math.PI / 2,
    clusters: [{ angle: 0.3, distance: 0.5, radius: 0.1, particleCount: 10 }],
    jitter: 0.5, paletteBias: 0.5, densityBand: 1 };
  const pts = generateParticles(params, mulberry32(1), 160, 200);
  assert.equal(pts.length, 4 * 10);
  for (const p of pts) { assert.ok(Number.isFinite(p.x)); assert.ok(Number.isFinite(p.y)); }
});

test('generateParticles: axial = 2 centres miroir', () => {
  const { mulberry32, generateParticles } = core;
  const params = { symmetry: { type: 'axial', k: 2 }, sectorAngle: Math.PI,
    clusters: [{ angle: 0.3, distance: 0.5, radius: 0.1, particleCount: 5 }],
    jitter: 0.5, paletteBias: 0.5, densityBand: 1 };
  const pts = generateParticles(params, mulberry32(1), 160, 200);
  assert.equal(pts.length, 2 * 5);
});

test('rasterizeToDotField: longueur et normalisation', () => {
  const { rasterizeToDotField } = core;
  const field = rasterizeToDotField([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 10 }], 160, 200);
  assert.equal(field.length, 160 * 200);
  let max = 0; for (const v of field) if (v > max) max = v;
  assert.equal(max, 1);
  assert.equal(field[5 * 160 + 5], 1);
  assert.equal(field[10 * 160 + 10], 0.5);
});

test('rasterizeToDotField: ignore les points hors champ', () => {
  const { rasterizeToDotField } = core;
  const field = rasterizeToDotField([{ x: -1, y: 5 }, { x: 999, y: 5 }], 160, 200);
  let sum = 0; for (const v of field) sum += v;
  assert.equal(sum, 0);
});

test('dotFieldToBraille: dimensions de la grille', () => {
  const { dotFieldToBraille } = core;
  const field = new Float64Array(160 * 200);
  const cells = dotFieldToBraille(field, 80, 50);
  assert.equal(cells.length, 50);
  assert.equal(cells[0].length, 80);
});

test('dotFieldToBraille: champ vide = blank braille U+2800', () => {
  const { dotFieldToBraille } = core;
  const cells = dotFieldToBraille(new Float64Array(160 * 200), 80, 50);
  assert.equal(cells[0][0].char, '⠀');
  assert.equal(cells[0][0].intensity, 0);
  assert.equal(cells[0][0].layer, 'braille');
});

test('dotFieldToBraille: point haut-gauche allume dot1 (0x2801)', () => {
  const { dotFieldToBraille } = core;
  const field = new Float64Array(160 * 200);
  field[0] = 1;
  const cells = dotFieldToBraille(field, 80, 50);
  assert.equal(cells[0][0].char, '⠁');
});

test('dotFieldToBraille: cellule pleine = 0x28FF', () => {
  const { dotFieldToBraille } = core;
  const field = new Float64Array(160 * 200);
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) field[dy * 160 + dx] = 1;
  const cells = dotFieldToBraille(field, 80, 50);
  assert.equal(cells[0][0].char, '⣿');
  assert.equal(cells[0][0].intensity, 1);
});

test('dotFieldToBraille: gamma relève un point faible sous le seuil linéaire', () => {
  const { dotFieldToBraille } = core;
  const field = new Float64Array(160 * 200);
  field[0] = 0.02;
  const cells = dotFieldToBraille(field, 80, 50);
  assert.equal(cells[0][0].char, '⠁');
});

function blankGrid(cols, rows) {
  return core.dotFieldToBraille(new Float64Array(cols * 2 * rows * 4), cols, rows);
}

test('overlayStructural: cadre braille fermé (coins alignés sur l’intérieur)', () => {
  const cells = blankGrid(80, 50);
  core.overlayStructural(cells, {});
  assert.equal(cells[0][0].char, '⡏');
  assert.equal(cells[0][79].char, '⢹');
  assert.equal(cells[49][0].char, '⣇');
  assert.equal(cells[49][79].char, '⣸');
  assert.equal(cells[0][0].layer, 'struct');
});

test('overlayStructural: n’écrit plus de ligne data dans la grille', () => {
  const cells = blankGrid(80, 50);
  core.overlayStructural(cells, {});
  const hasDataLayer = cells.some(row => row.some(c => c.layer === 'data'));
  assert.equal(hasDataLayer, false);
});

test('formatSeedLine: hex sur 8 caractères + rev + unit', () => {
  const { formatSeedLine } = core;
  const line = formatSeedLine({ seed: 0x7F3A, rev: '2.6', unit: 'UNIT/D-01' });
  assert.equal(line, 'SEED 0x00007F3A  REV 2.6  UNIT/D-01');
});

test('colorize: couleurs par layer', () => {
  const cells = [[
    { char: '⣿', intensity: 1, layer: 'braille' },
    { char: '│', intensity: 1, layer: 'struct' },
    { char: 'S', intensity: 1, layer: 'data' },
  ]];
  const grid = core.colorize(cells, { paletteBias: 0.5 });
  assert.equal(grid.cells[0][2].color, '#E61919');
  assert.equal(grid.cells[0][1].color, '#8A9AD4');
  assert.ok(/^rgb\(/.test(grid.cells[0][0].color));
});

test('buildGrid: grille complète bien formée', () => {
  const { buildGrid, COLS, ROWS } = core;
  const grid = buildGrid('sthol', 0xABCDEF01);
  assert.equal(grid.cols, COLS);
  assert.equal(grid.rows, ROWS);
  assert.equal(grid.cells.length, ROWS);
  assert.equal(grid.cells[0].length, COLS);
  assert.equal(grid.seed, (grid.seed >>> 0));
  assert.ok(grid.cells.every(row => row.every(c => typeof c.color === 'string')));
});

test('buildGrid: déterministe pour (texte, entropy) fixés', () => {
  const { buildGrid } = core;
  const a = buildGrid('sthol', 42);
  const b = buildGrid('sthol', 42);
  const flat = g => g.cells.map(r => r.map(c => c.char).join('')).join('\n');
  assert.equal(flat(a), flat(b));
});

test('buildGrid: vrai hasard — entropies différentes = grilles différentes', () => {
  const { buildGrid } = core;
  const flat = g => g.cells.map(r => r.map(c => c.char).join('')).join('\n');
  assert.notEqual(flat(buildGrid('sthol', 1)), flat(buildGrid('sthol', 2)));
});

test('buildGrid: même mot = même seed de famille (symétrie stable)', () => {
  const { buildGrid } = core;
  const g1 = buildGrid('sthol', 111);
  const g2 = buildGrid('sthol', 222);
  const frameChar = g => g.cells[0][0].char;
  assert.equal(frameChar(g1), frameChar(g2));
});

test('buildGrid: opts.clean saute overlayStructural — aucune cellule layer "struct"', () => {
  const { buildGrid } = core;
  const grid = buildGrid('sthol', 42, { clean: true });
  const hasStructLayer = grid.cells.some(row => row.some(c => c.layer === 'struct'));
  assert.equal(hasStructLayer, false);
});

test('buildGrid: sans opts.clean, le cadre reste présent (non-régression)', () => {
  const { buildGrid } = core;
  const grid = buildGrid('sthol', 42);
  assert.equal(grid.cells[0][0].layer, 'struct');
});


// Garde-fou : une rotation seule à 3 ou 4 branches dessine un moulinet
// (triskèle / svastika). Ces familles doivent toujours être miroir.
test('symétrie : radial k=3 et k=4 sont toujours miroir', () => {
  const { mulberry32, deriveParams } = core;
  for (let seed = 0; seed < 500; seed++) {
    const { symmetry } = deriveParams(mulberry32(seed), mulberry32(1));
    if (symmetry.type === 'radial' && symmetry.k <= 4) {
      assert.equal(symmetry.mirror, true, `seed ${seed}: k=${symmetry.k} sans miroir`);
    }
  }
});

test('symétrie : les centres miroir sont invariants par réflexion verticale', () => {
  const { mulberry32, generateParticles } = core;
  for (const k of [3, 4]) {
    const W = 160, H = 200;
    const params = { symmetry: { type: 'radial', k, mirror: true }, sectorAngle: 2 * Math.PI / k,
      clusters: [{ angle: 0.37, distance: 0.6, radius: 0, particleCount: 1 }],
      jitter: 0.5, paletteBias: 0.5, densityBand: 1 };
    const pts = generateParticles(params, mulberry32(1), W, H);
    assert.equal(pts.length, 2 * k);
    const key = (x, y) => `${x.toFixed(6)},${y.toFixed(6)}`;
    const set = new Set(pts.map((p) => key(p.x, p.y)));
    for (const p of pts) {
      assert.ok(set.has(key(W - p.x, p.y)), `k=${k}: reflet manquant pour ${key(p.x, p.y)}`);
    }
  }
});
