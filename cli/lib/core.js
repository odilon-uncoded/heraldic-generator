'use strict';

const COLS = 80;
const ROWS = 50;
const DOT_W = COLS * 2;   // 160
const DOT_H = ROWS * 4;   // 200

function hashString(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) + text.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slugify(text) {
  const slug = text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug.length > 0 ? slug : 'blason';
}

function gaussianRandom(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function deriveParams(familyRng, variantRng) {
  const symmetryOptions = [
    { type: 'axial', k: 2 },
    { type: 'radial', k: 3, mirror: true },
    { type: 'radial', k: 4, mirror: true },
    { type: 'radial', k: 6 },
    { type: 'radial', k: 8 },
  ];
  const symmetry = symmetryOptions[Math.floor(familyRng() * symmetryOptions.length)];
  const sectorAngle = symmetry.type === 'axial' ? Math.PI : (2 * Math.PI / symmetry.k);
  const paletteBias = familyRng();
  const densityBand = 1.1 + familyRng() * 1.0;

  const clusterCount = 3 + Math.floor(variantRng() * 5); // 3..7
  const clusters = [];
  for (let i = 0; i < clusterCount; i++) {
    clusters.push({
      angle: variantRng() * sectorAngle,
      distance: 0.15 + variantRng() * 0.75,
      radius: 0.10 + variantRng() * 0.16,
      particleCount: Math.ceil(Math.floor((260 + variantRng() * 420) * densityBand) / (symmetry.mirror ? 2 : 1)),
    });
  }
  const jitter = 0.3 + variantRng() * 0.5;

  return { symmetry, sectorAngle, clusters, jitter, paletteBias, densityBand };
}

function overlayStructural(cells, params) {
  const rows = cells.length, cols = cells[0].length;
  const put = (r, c, ch, layer) => {
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      cells[r][c] = { char: ch, intensity: 1, layer: layer || 'struct' };
    }
  };
  for (let c = 0; c < cols; c++) { put(0, c, '⠉'); put(rows - 1, c, '⣀'); }
  for (let r = 0; r < rows; r++) { put(r, 0, '⡇'); put(r, cols - 1, '⢸'); }
  put(0, 0, '⡏'); put(0, cols - 1, '⢹'); put(rows - 1, 0, '⣇'); put(rows - 1, cols - 1, '⣸');
  return cells;
}

function formatSeedLine(meta) {
  const hex = (meta.seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `SEED 0x${hex}  REV ${meta.rev}  ${meta.unit}`;
}

function generateParticles(params, rng, width, height) {
  const cx = width / 2, cy = height / 2;
  const maxRadius = Math.min(width, height) * 0.42;
  const particles = [];
  for (const cluster of params.clusters) {
    const baseAngle = cluster.angle - Math.PI / 2;
    const baseX = cx + Math.cos(baseAngle) * cluster.distance * maxRadius;
    const baseY = cy + Math.sin(baseAngle) * cluster.distance * maxRadius;
    const centers = [];
    if (params.symmetry.type === 'axial') {
      centers.push([baseX, baseY]);
      centers.push([2 * cx - baseX, baseY]);
    } else {
      // mirror (k=3, k=4) : chaque branche a son reflet, jamais de moulinet
      for (let k = 0; k < params.symmetry.k * (params.symmetry.mirror ? 2 : 1); k++) {
        const rot = (k < params.symmetry.k ? baseAngle : -cluster.angle - Math.PI / 2)
          + (k % params.symmetry.k) * params.sectorAngle;
        centers.push([
          cx + Math.cos(rot) * cluster.distance * maxRadius,
          cy + Math.sin(rot) * cluster.distance * maxRadius,
        ]);
      }
    }
    for (const [ccx, ccy] of centers) {
      for (let p = 0; p < cluster.particleCount; p++) {
        const r = Math.abs(gaussianRandom(rng)) * cluster.radius * maxRadius * params.jitter;
        const theta = rng() * Math.PI * 2;
        particles.push({ x: ccx + Math.cos(theta) * r, y: ccy + Math.sin(theta) * r });
      }
    }
  }
  return particles;
}

function rasterizeToDotField(particles, dotW, dotH) {
  const field = new Float64Array(dotW * dotH);
  for (const pt of particles) {
    const x = Math.round(pt.x), y = Math.round(pt.y);
    if (x >= 0 && x < dotW && y >= 0 && y < dotH) field[y * dotW + x] += 1;
  }
  let max = 0;
  for (let i = 0; i < field.length; i++) if (field[i] > max) max = field[i];
  if (max > 0) for (let i = 0; i < field.length; i++) field[i] /= max;
  return field;
}

const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

const FIELD_GAMMA = 0.55;

function dotFieldToBraille(dotField, cols, rows, threshold) {
  if (threshold === undefined) threshold = 0.06;
  const dotW = cols * 2;
  const cells = [];
  for (let ry = 0; ry < rows; ry++) {
    const row = [];
    for (let cx = 0; cx < cols; cx++) {
      let bits = 0, sum = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const raw = dotField[(ry * 4 + dy) * dotW + (cx * 2 + dx)];
          const v = raw > 0 ? Math.pow(raw, FIELD_GAMMA) : 0;
          sum += v;
          if (v > threshold) bits |= BRAILLE_BITS[dy][dx];
        }
      }
      row.push({ char: String.fromCharCode(0x2800 + bits), intensity: sum / 8, layer: 'braille' });
    }
    cells.push(row);
  }
  return cells;
}

function colorize(cells, params) {
  const A = [0x6B, 0x7E, 0xC4], B = [0x8A, 0x9A, 0xD4];
  const rows = cells.length, cols = cells[0].length;
  const bias = (params && typeof params.paletteBias === 'number') ? params.paletteBias : 0.5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[r][c];
      if (cell.layer === 'data') {
        cell.color = '#E61919';
      } else if (cell.layer === 'struct') {
        cell.color = '#8A9AD4';
      } else {
        const t = Math.min(1, Math.max(0, cell.intensity * 0.7 + bias * 0.3));
        const col = [
          Math.round(A[0] + (B[0] - A[0]) * t),
          Math.round(A[1] + (B[1] - A[1]) * t),
          Math.round(A[2] + (B[2] - A[2]) * t),
        ];
        cell.color = `rgb(${col[0]}, ${col[1]}, ${col[2]})`;
      }
    }
  }
  return { cols, rows, cells };
}

function buildGrid(text, entropy, opts) {
  opts = opts || {};
  const cols = opts.cols || COLS, rows = opts.rows || ROWS;
  const dotW = cols * 2, dotH = rows * 4;
  const textHash = hashString(text);
  const seed = (textHash ^ (entropy >>> 0)) >>> 0;
  const familyRng = mulberry32(textHash);
  const variantRng = mulberry32(seed);
  const params = deriveParams(familyRng, variantRng);
  const particles = generateParticles(params, variantRng, dotW, dotH);
  const field = rasterizeToDotField(particles, dotW, dotH);
  let cells = dotFieldToBraille(field, cols, rows);
  const meta = { seed, rev: '2.6', unit: 'UNIT/D-01' };
  if (!opts.clean) cells = overlayStructural(cells, params);
  const grid = colorize(cells, params);
  grid.seed = seed;
  grid.meta = meta;
  return grid;
}

module.exports = {
  COLS, ROWS, DOT_W, DOT_H,
  hashString, mulberry32, slugify,
  gaussianRandom, deriveParams,
  overlayStructural, formatSeedLine,
  generateParticles, rasterizeToDotField,
  dotFieldToBraille, colorize, buildGrid,
};
