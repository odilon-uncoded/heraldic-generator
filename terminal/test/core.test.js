const test = require('node:test');
const assert = require('node:assert/strict');
const assertLoose = require('node:assert');
const { loadBlasonCore } = require('./support/extract-core');

test('constantes de grille figées', () => {
  const { COLS, ROWS, DOT_W, DOT_H } = loadBlasonCore();
  assert.equal(COLS, 80);
  assert.equal(ROWS, 50);
  assert.equal(DOT_W, 160);
  assert.equal(DOT_H, 200);
});

test('hashString déterministe', () => {
  const { hashString } = loadBlasonCore();
  assert.equal(hashString('sthol'), hashString('sthol'));
  assert.notEqual(hashString('sthol'), hashString('kaldrek'));
});

test('mulberry32 reproductible', () => {
  const { mulberry32 } = loadBlasonCore();
  const a = mulberry32(123), b = mulberry32(123);
  assertLoose.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('slugify utilise la forme échappée des diacritiques', () => {
  const { slugify } = loadBlasonCore();
  assert.equal(slugify('Épée Ardente'), 'epee-ardente');
  assert.equal(slugify(''), 'blason');
});

test('deriveParams: même famille pour même familyRng, micro variable', () => {
  const { mulberry32, deriveParams } = loadBlasonCore();
  const p1 = deriveParams(mulberry32(42), mulberry32(1));
  const p2 = deriveParams(mulberry32(42), mulberry32(2));
  // macro stable (dépend de familyRng seul)
  assert.deepEqual(p1.symmetry, p2.symmetry);
  assert.equal(p1.paletteBias, p2.paletteBias);
  // micro variable (dépend de variantRng)
  assert.notDeepEqual(p1.clusters, p2.clusters);
});

test('deriveParams: bornes des paramètres', () => {
  const { mulberry32, deriveParams } = loadBlasonCore();
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
  const { mulberry32, gaussianRandom } = loadBlasonCore();
  const rng = mulberry32(3);
  for (let i = 0; i < 20; i++) assert.ok(Number.isFinite(gaussianRandom(rng)));
});

test('generateParticles: respecte la symétrie radiale (k centres)', () => {
  const { mulberry32, generateParticles } = loadBlasonCore();
  const params = { symmetry: { type: 'radial', k: 4 }, sectorAngle: Math.PI / 2,
    clusters: [{ angle: 0.3, distance: 0.5, radius: 0.1, particleCount: 10 }],
    jitter: 0.5, paletteBias: 0.5, densityBand: 1, frame: 'box' };
  const pts = generateParticles(params, mulberry32(1), 160, 200);
  assert.equal(pts.length, 4 * 10); // k centres × particleCount
  for (const p of pts) { assert.ok(Number.isFinite(p.x)); assert.ok(Number.isFinite(p.y)); }
});

test('generateParticles: axial = 2 centres miroir', () => {
  const { mulberry32, generateParticles } = loadBlasonCore();
  const params = { symmetry: { type: 'axial', k: 2 }, sectorAngle: Math.PI,
    clusters: [{ angle: 0.3, distance: 0.5, radius: 0.1, particleCount: 5 }],
    jitter: 0.5, paletteBias: 0.5, densityBand: 1, frame: 'box' };
  const pts = generateParticles(params, mulberry32(1), 160, 200);
  assert.equal(pts.length, 2 * 5);
});

test('rasterizeToDotField: longueur et normalisation', () => {
  const { rasterizeToDotField } = loadBlasonCore();
  const field = rasterizeToDotField([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 10 }], 160, 200);
  assert.equal(field.length, 160 * 200);
  let max = 0; for (const v of field) if (v > max) max = v;
  assert.equal(max, 1); // pic normalisé à 1
  assert.equal(field[5 * 160 + 5], 1); // cellule à 2 hits = max
  assert.equal(field[10 * 160 + 10], 0.5); // cellule à 1 hit = moitié
});

test('rasterizeToDotField: ignore les points hors champ', () => {
  const { rasterizeToDotField } = loadBlasonCore();
  const field = rasterizeToDotField([{ x: -1, y: 5 }, { x: 999, y: 5 }], 160, 200);
  let sum = 0; for (const v of field) sum += v;
  assert.equal(sum, 0);
});

test('dotFieldToBraille: dimensions de la grille', () => {
  const { dotFieldToBraille } = loadBlasonCore();
  const field = new Float64Array(160 * 200);
  const cells = dotFieldToBraille(field, 80, 50);
  assert.equal(cells.length, 50);
  assert.equal(cells[0].length, 80);
});

test('dotFieldToBraille: champ vide = blank braille U+2800', () => {
  const { dotFieldToBraille } = loadBlasonCore();
  const cells = dotFieldToBraille(new Float64Array(160 * 200), 80, 50);
  assert.equal(cells[0][0].char, '⠀');
  assert.equal(cells[0][0].intensity, 0);
  assert.equal(cells[0][0].layer, 'braille');
});

test('dotFieldToBraille: point haut-gauche allume dot1 (0x2801)', () => {
  const { dotFieldToBraille } = loadBlasonCore();
  const field = new Float64Array(160 * 200);
  field[0] = 1; // sous-point (0,0)
  const cells = dotFieldToBraille(field, 80, 50);
  assert.equal(cells[0][0].char, '⠁'); // dot1
});

test('dotFieldToBraille: cellule pleine = 0x28FF', () => {
  const { dotFieldToBraille } = loadBlasonCore();
  const field = new Float64Array(160 * 200);
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) field[dy * 160 + dx] = 1;
  const cells = dotFieldToBraille(field, 80, 50);
  assert.equal(cells[0][0].char, '⣿');
  assert.equal(cells[0][0].intensity, 1);
});

test('dotFieldToBraille: gamma relève un point faible sous le seuil linéaire', () => {
  const { dotFieldToBraille } = loadBlasonCore();
  const field = new Float64Array(160 * 200);
  // 0.02 linéaire < 0.06 (seuil) → éteint sans gamma ; 0.02^0.55 ≈ 0.116 > 0.06 → allumé
  field[0] = 0.02;
  const cells = dotFieldToBraille(field, 80, 50);
  assert.equal(cells[0][0].char, '⠁');
});

function blankGrid(core, cols, rows) {
  return core.dotFieldToBraille(new Float64Array(cols * 2 * rows * 4), cols, rows);
}

test('overlayStructural: cadre braille fermé (coins alignés sur l’intérieur)', () => {
  const core = loadBlasonCore();
  const cells = blankGrid(core, 80, 50);
  core.overlayStructural(cells, {});
  assert.equal(cells[0][0].char, '⡏');
  assert.equal(cells[0][79].char, '⢹');
  assert.equal(cells[49][0].char, '⣇');
  assert.equal(cells[49][79].char, '⣸');
  assert.equal(cells[0][0].layer, 'struct');
});

test('overlayStructural: n\u2019écrit plus de ligne data dans la grille', () => {
  const core = loadBlasonCore();
  const cells = blankGrid(core, 80, 50);
  core.overlayStructural(cells, { frame: 'box' });
  const hasDataLayer = cells.some(row => row.some(c => c.layer === 'data'));
  assert.equal(hasDataLayer, false);
});

test('formatSeedLine: hex sur 8 caractères + rev + unit', () => {
  const { formatSeedLine } = loadBlasonCore();
  const line = formatSeedLine({ seed: 0x7F3A, rev: '2.6', unit: 'UNIT/D-01' });
  assert.equal(line, 'SEED 0x00007F3A  REV 2.6  UNIT/D-01');
});

const FIXTURE_GRID = { cols: 3, rows: 2, cells: [
  [{ char: 'A', color: '#E61919', layer: 'data' },
   { char: 'B', color: '#8A9AD4', layer: 'struct' },
   { char: 'C', color: 'rgb(107, 126, 196)', layer: 'braille' }],
  [{ char: '⠁', color: 'rgb(120, 130, 200)', layer: 'braille' },
   { char: '⠀', color: 'rgb(107, 126, 196)', layer: 'braille' },
   { char: 'D', color: '#8A9AD4', layer: 'struct' }],
], seed: 42, meta: { seed: 42, rev: '2.6', unit: 'U' } };

test('serializeText: lignes jointes, glyphes bruts + ligne seed', () => {
  const { serializeText } = loadBlasonCore();
  assert.equal(serializeText(FIXTURE_GRID), 'ABC\n⠁⠀D\n\nSEED 0x0000002A  REV 2.6  U');
});

test('parseColor: hex et rgb()', () => {
  const { parseColor } = loadBlasonCore();
  assertLoose.deepEqual(parseColor('#E61919'), [230, 25, 25]);
  assertLoose.deepEqual(parseColor('rgb(107, 126, 196)'), [107, 126, 196]);
});

test('serializeAnsi: contient un escape truecolor, un reset, et la ligne seed', () => {
  const { serializeAnsi } = loadBlasonCore();
  const out = serializeAnsi(FIXTURE_GRID);
  assert.ok(out.includes('\x1b[38;2;230;25;25m')); // rouge hazard du 'A'
  assert.ok(out.includes('\x1b[0m'));
  // le texte visible (hors escapes) reste lisible, seed inclus
  const stripped = out.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(stripped, 'ABC\n⠁⠀D\n\nSEED 0x0000002A  REV 2.6  U');
});

test('escapeXml: échappe &, <, >', () => {
  const { escapeXml } = loadBlasonCore();
  assert.equal(escapeXml('a<b>&c'), 'a&lt;b&gt;&amp;c');
});

test('serializeSvg: enveloppe SVG + fond + dimensions (rows+1 pour la ligne seed)', () => {
  const { serializeSvg } = loadBlasonCore();
  const svg = serializeSvg(FIXTURE_GRID, { cellW: 10, cellH: 20, fontSize: 18 });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('width="30"'));   // 3 cols × 10
  assert.ok(svg.includes('height="60"'));  // (2 rows + 1) × 20
  assert.ok(svg.includes('fill="#0A0A0A"')); // fond
  assert.ok(svg.trim().endsWith('</svg>'));
});

test('serializeSvg: dessine les glyphes non-blancs, saute le blank braille, ajoute la ligne seed', () => {
  const { serializeSvg } = loadBlasonCore();
  const svg = serializeSvg(FIXTURE_GRID);
  assert.ok(svg.includes('>A</text>'));
  assert.ok(svg.includes('fill="#E61919"')); // couleur du 'A'
  assert.ok(svg.includes('SEED 0x0000002A')); // ligne seed présente
  // le blank U+2800 (cellule [1][1]) ne doit PAS produire de <text> pour ce glyphe
  const textCount = (svg.match(/<text /g) || []).length;
  assert.equal(textCount, 6); // A B C ⠁ D + 1 ligne seed
});

test('colorize: couleurs par layer', () => {
  const core = loadBlasonCore();
  const cells = [[
    { char: '⣿', intensity: 1, layer: 'braille' },
    { char: '│', intensity: 1, layer: 'struct' },
    { char: 'S', intensity: 1, layer: 'data' },
  ]];
  const grid = core.colorize(cells, { paletteBias: 0.5 });
  assert.equal(grid.cells[0][2].color, '#E61919');   // data = rouge
  assert.equal(grid.cells[0][1].color, '#8A9AD4');   // struct = bleu clair
  assert.ok(/^rgb\(/.test(grid.cells[0][0].color));  // braille = rgb(...)
});

test('buildGrid: grille complète bien formée', () => {
  const { buildGrid, COLS, ROWS } = loadBlasonCore();
  const grid = buildGrid('sthol', 0xABCDEF01);
  assert.equal(grid.cols, COLS);
  assert.equal(grid.rows, ROWS);
  assert.equal(grid.cells.length, ROWS);
  assert.equal(grid.cells[0].length, COLS);
  assert.equal(grid.seed, (grid.seed >>> 0));
  assert.ok(grid.cells.every(row => row.every(c => typeof c.color === 'string')));
});

test('buildGrid: déterministe pour (texte, entropy) fixés', () => {
  const { buildGrid } = loadBlasonCore();
  const a = buildGrid('sthol', 42);
  const b = buildGrid('sthol', 42);
  const flat = g => g.cells.map(r => r.map(c => c.char).join('')).join('\n');
  assert.equal(flat(a), flat(b));
});

test('buildGrid: vrai hasard — entropies différentes = grilles différentes', () => {
  const { buildGrid } = loadBlasonCore();
  const flat = g => g.cells.map(r => r.map(c => c.char).join('')).join('\n');
  assert.notEqual(flat(buildGrid('sthol', 1)), flat(buildGrid('sthol', 2)));
});

test('buildGrid: même mot = même seed de famille (symétrie stable)', () => {
  const { buildGrid, hashString, mulberry32, deriveParams } = loadBlasonCore();
  const expected = deriveParams(mulberry32(hashString('sthol')), mulberry32(1)).symmetry;
  // la symétrie ne dépend que de familyRng(hashString(texte)) → stable quel que soit entropy
  const g1 = buildGrid('sthol', 111);
  const g2 = buildGrid('sthol', 222);
  // pas d'accès direct aux params depuis grid : on vérifie via la stabilité de la famille
  // en comparant la structure de cadre (frame dépend de familyRng)
  const frameChar = g => g.cells[0][0].char;
  assert.equal(frameChar(g1), frameChar(g2));
});


// Garde-fou : une rotation seule à 3 ou 4 branches dessine un moulinet
// (triskèle / svastika). Ces familles doivent toujours être miroir.
test('symétrie : radial k=3 et k=4 sont toujours miroir', () => {
  const { mulberry32, deriveParams } = loadBlasonCore();
  for (let seed = 0; seed < 500; seed++) {
    const { symmetry } = deriveParams(mulberry32(seed), mulberry32(1));
    if (symmetry.type === 'radial' && symmetry.k <= 4) {
      assert.equal(symmetry.mirror, true, `seed ${seed}: k=${symmetry.k} sans miroir`);
    }
  }
});

test('symétrie : les centres miroir sont invariants par réflexion verticale', () => {
  const { mulberry32, generateParticles } = loadBlasonCore();
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
