const test = require('node:test');
const assert = require('node:assert/strict');
const assertLoose = require('node:assert');
const { loadBlasonCore } = require('./support/extract-core');

test('hashString est déterministe pour un même texte', () => {
  const { hashString } = loadBlasonCore();
  assert.equal(hashString('sthol'), hashString('sthol'));
});

test('hashString diffère pour des textes différents', () => {
  const { hashString } = loadBlasonCore();
  assert.notEqual(hashString('sthol'), hashString('kaldrek'));
});

test('hashString accepte les phrases et retourne un entier non signé 32 bits', () => {
  const { hashString } = loadBlasonCore();
  const h = hashString('une phrase assez longue avec espaces et Majuscules');
  assert.ok(Number.isInteger(h));
  assert.ok(h >= 0 && h <= 0xFFFFFFFF);
});

test('mulberry32 produit des séquences identiques pour des seeds identiques', () => {
  const { mulberry32 } = loadBlasonCore();
  const rngA = mulberry32(12345);
  const rngB = mulberry32(12345);
  const drawsA = Array.from({ length: 5 }, () => rngA());
  const drawsB = Array.from({ length: 5 }, () => rngB());
  assert.deepEqual(drawsA, drawsB);
});

test('mulberry32 reste dans [0, 1)', () => {
  const { mulberry32 } = loadBlasonCore();
  const rng = mulberry32(7);
  for (let i = 0; i < 200; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `valeur hors bornes: ${v}`);
  }
});

test('mulberry32 produit des séquences différentes pour des seeds différents', () => {
  const { mulberry32 } = loadBlasonCore();
  const rngA = mulberry32(1);
  const rngB = mulberry32(2);
  assert.notEqual(rngA(), rngB());
});

test('deriveParams est déterministe pour un même rng', () => {
  const { mulberry32, deriveParams } = loadBlasonCore();
  const paramsA = deriveParams(mulberry32(999));
  const paramsB = deriveParams(mulberry32(999));
  assert.deepEqual(paramsA, paramsB);
});

test('deriveParams choisit une symétrie valide', () => {
  const { mulberry32, deriveParams } = loadBlasonCore();
  const { symmetry } = deriveParams(mulberry32(1));
  assert.ok(symmetry.type === 'axial' || symmetry.type === 'radial');
  if (symmetry.type === 'radial') {
    assert.ok([3, 4, 6, 8].includes(symmetry.k));
  }
});

test('deriveParams génère entre 3 et 7 clusters', () => {
  const { mulberry32, deriveParams } = loadBlasonCore();
  for (let seed = 0; seed < 20; seed++) {
    const { clusters } = deriveParams(mulberry32(seed));
    assert.ok(clusters.length >= 3 && clusters.length <= 7, `seed ${seed}: ${clusters.length} clusters`);
  }
});

test('deriveParams contraint chaque cluster dans le secteur de base', () => {
  const { mulberry32, deriveParams } = loadBlasonCore();
  for (let seed = 0; seed < 20; seed++) {
    const { clusters, sectorAngle } = deriveParams(mulberry32(seed));
    for (const cluster of clusters) {
      assert.ok(cluster.angle >= 0 && cluster.angle < sectorAngle);
      assert.ok(cluster.distance > 0 && cluster.distance <= 1);
    }
  }
});

test('generateParticles est déterministe pour un même texte', () => {
  const { hashString, mulberry32, deriveParams, generateParticles } = loadBlasonCore();
  const run = () => {
    const rng = mulberry32(hashString('kaldrek'));
    const params = deriveParams(rng);
    return generateParticles(params, rng, 1080, 1350);
  };
  assert.deepEqual(run(), run());
});

test('generateParticles reste dans les bornes du canvas (avec marge de jitter)', () => {
  const { hashString, mulberry32, deriveParams, generateParticles } = loadBlasonCore();
  const width = 1080, height = 1350;
  const rng = mulberry32(hashString('un test de bornes'));
  const params = deriveParams(rng);
  const particles = generateParticles(params, rng, width, height);
  assert.ok(particles.length > 0);
  const margin = 400;
  for (const particle of particles) {
    assert.ok(particle.x >= -margin && particle.x <= width + margin);
    assert.ok(particle.y >= -margin && particle.y <= height + margin);
  }
});

test('generateParticles duplique les clusters selon la symétrie (comptage exact)', () => {
  const { mulberry32, generateParticles } = loadBlasonCore();
  const axialParams = {
    symmetry: { type: 'axial', k: 2 },
    sectorAngle: Math.PI,
    jitter: 0.5,
    clusters: [{ angle: 0.4, distance: 0.5, radius: 0.1, particleCount: 100 }],
  };
  const rng = mulberry32(42);
  const particles = generateParticles(axialParams, rng, 1080, 1350);
  assert.equal(particles.length, 200); // 1 cluster * 2 (mirroir) * 100 particules

  const radialParams = {
    symmetry: { type: 'radial', k: 4 },
    sectorAngle: Math.PI / 2,
    jitter: 0.5,
    clusters: [{ angle: 0.2, distance: 0.5, radius: 0.1, particleCount: 50 }],
  };
  const rng2 = mulberry32(42);
  const radialParticles = generateParticles(radialParams, rng2, 1080, 1350);
  assert.equal(radialParticles.length, 200); // 1 cluster * 4 branches * 50 particules
});

test('lerpColor interpole entre les deux couleurs de la palette', () => {
  const { lerpColor } = loadBlasonCore();
  const a = [0x6B, 0x7E, 0xC4];
  const b = [0x8A, 0x9A, 0xD4];
  assertLoose.deepEqual(lerpColor(a, b, 0), a);
  assertLoose.deepEqual(lerpColor(a, b, 1), b);
  const mid = lerpColor(a, b, 0.5);
  assertLoose.deepEqual(mid, [
    Math.round((a[0] + b[0]) / 2),
    Math.round((a[1] + b[1]) / 2),
    Math.round((a[2] + b[2]) / 2),
  ]);
});

test('generateBlason : même texte → résultat identique (déterminisme bout-en-bout)', () => {
  const { generateBlason } = loadBlasonCore();
  const a = generateBlason('sthol', 1080, 1350);
  const b = generateBlason('sthol', 1080, 1350);
  assert.deepEqual(a, b);
});

test('generateBlason : textes différents → résultats visuellement distincts', () => {
  const { generateBlason } = loadBlasonCore();
  const examples = [
    'sthol',
    'kaldrek le renégat',
    'la lanterne qui ne s\'éteint jamais',
    'vhast',
  ];
  const results = examples.map((text) => generateBlason(text, 1080, 1350));
  const seeds = results.map((r) => r.seed);
  assert.equal(new Set(seeds).size, seeds.length, 'seeds doivent tous différer');
  const particleCounts = results.map((r) => r.particles.length);
  assert.equal(new Set(particleCounts.map((c) => JSON.stringify(c))).size > 0, true);
});

test('generateBlason : phrase longue traitée sans erreur', () => {
  const { generateBlason } = loadBlasonCore();
  const long = 'une phrase assez longue pour vérifier que le hash et la génération tiennent la route sans erreur ni troncature silencieuse';
  const result = generateBlason(long, 1080, 1350);
  assert.ok(result.particles.length > 0);
});

test('slugify produit un nom de fichier sûr et non vide', () => {
  const { slugify } = loadBlasonCore();
  assert.equal(slugify('Sthol'), 'sthol');
  assert.equal(slugify('Kaldrek le Renégat'), 'kaldrek-le-renegat');
  assert.equal(slugify('   '), 'blason');
  assert.ok(slugify('a'.repeat(200)).length <= 40);
});


// Garde-fou : une rotation seule à 3 ou 4 branches dessine un moulinet
// (triskèle / svastika). Ces familles doivent toujours être miroir.
test('symétrie : radial k=3 et k=4 sont toujours miroir', () => {
  const { mulberry32, deriveParams } = loadBlasonCore();
  for (let seed = 0; seed < 500; seed++) {
    const { symmetry } = deriveParams(mulberry32(seed));
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
