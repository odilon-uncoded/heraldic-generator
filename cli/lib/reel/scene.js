'use strict';

// Scène du reel (20 s) : tout ce qui est affiché est une grille de
// caractères braille, comme les exports image. Chaque frame est une fonction
// pure du temps : même mot + même entropie = même vidéo.
//
// Trois actes quand le mot a une silhouette (voir silhouette.js) :
//   0.3 →  2.5  le cadre se trace, le mot apparaît en gothique tramé, la graine se calcule
//   2.5 →  4.5  les lettres se défont et leurs points bâtissent l'objet, de bas en haut
//   4.5 →  7.8  tenue de l'objet : lumière rasante, lueur mouvante, brume, braises
//   7.8 →  9.5  l'objet se désagrège vers les foyers du blason
//   8.4 → 13.5  le blason pousse : les particules du générateur s'accumulent
//  13.5 → 18.2  tenue, balayage de lumière
//  18.2 → 19.7  dissolution tramée, retour au noir
// Sans silhouette, le mot tient plus longtemps et migre directement vers les
// foyers (deux actes).

const { CELL_W, CELL_H, blit } = require('./atlas');

const WIDTH = 1080, HEIGHT = 1920, FPS = 30, DURATION = 20;
const COLS = 80, BLOCK_ROWS = 50;
// La grille plein cadre fait 72 lignes ; le bloc 80x50 du blason y occupe les
// lignes 11 à 60, soit y = 285 → 1635 px : la même position que l'export
// png-clean-story. Le centre de la frame se superpose au pixel près à un export png.
const FULL_ROWS = 72, ROW0 = 11, Y0 = -12;
const DW = COLS * 2, DH = FULL_ROWS * 4, BW = COLS * 2, BH = BLOCK_ROWS * 4, DOT_Y0 = ROW0 * 4;

const COVER_MS = 16500; // frame de couverture : blason complet, après le balayage

const BG = [10, 10, 10];
const BLUE_A = [0x6B, 0x7E, 0xC4], BLUE_B = [0x8A, 0x9A, 0xD4], RED = [0xE6, 0x19, 0x19], WHITE = [236, 240, 255];
const BRAILLE_BITS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
const FIELD_GAMMA = 0.55, FIELD_THRESHOLD = 0.06; // identiques à core.js
const SCRAMBLE = '⠿⣿⢿⡿⣻⠷█▓▒░/\\|+°';

const COMMON = {
  borderIn: 0.3, borderDur: 1.6,
  titleIn: 0.5, titleDur: 0.9,
  seedIn: 1.4, seedLock: 1.7, seedLockStep: 0.08,
  bloomStagger: 0.22,
  sweepIn: 14.4, sweepDur: 1.5,
  out: 18.2, outDur: 1.5,
};
const T_OBJECT = Object.assign({}, COMMON, {
  leave: 2.5, build: 2.6, buildDur: 1.9, hold: 4.6, go: 7.8, bloom: 8.4, bloomDur: 4.0,
});
const T_WORD = Object.assign({}, COMMON, {
  leave: 4.0, bloom: 4.6, bloomDur: 4.5,
});

const SPARKS = 26;

function bayerMatrix(n) {
  let m = [[0]];
  for (let size = 1; size < n; size *= 2) {
    const next = [];
    for (let y = 0; y < size * 2; y++) {
      next.push([]);
      for (let x = 0; x < size * 2; x++) {
        next[y].push(m[y % size][x % size] * 4 + [[0, 2], [3, 1]][y < size ? 0 : 1][x < size ? 0 : 1]);
      }
    }
    m = next;
  }
  return m;
}
const BAYER = bayerMatrix(8);
// Seuil de tramage ordonné dans ]0,1[ pour le point (x, y).
const bayer = (x, y) => (BAYER[((y % 8) + 8) % 8][((x % 8) + 8) % 8] + 0.5) / 64;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const k = clamp01((v - a) / (b - a)); return k * k * (3 - 2 * k); };
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// Bruit de valeur déterministe (sans Math.random), pour la brume et les vacillements.
function hash2(x, y, s) {
  let h = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function parseColor(color) {
  if (color[0] === '#') return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  return m ? [+m[1], +m[2], +m[3]] : BLUE_B;
}

// Rejoue la génération de core.js en gardant, pour chaque particule, son
// foyer et sa distance au foyer : c'est ce qui permet d'animer la pousse dans
// l'ordre réel du procédé (foyers symétriques, puis diffusion), et d'arriver
// exactement sur le blason que buildGrid produit.
function buildBloom(word, entropy, core, T) {
  const textHash = core.hashString(word);
  const seed = (textHash ^ (entropy >>> 0)) >>> 0;
  const variantRng = core.mulberry32(seed);
  const params = core.deriveParams(core.mulberry32(textHash), variantRng);
  const particles = core.generateParticles(params, variantRng, BW, BH);

  const cx = BW / 2, cy = BH / 2, maxRadius = Math.min(BW, BH) * 0.42;
  const rank = params.clusters.map((c, i) => [c.distance, i]).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const rankOf = [];
  rank.forEach((ci, r) => { rankOf[ci] = r; });
  const jitter = core.mulberry32((seed ^ 0x9E3779B9) >>> 0);

  const centers = [], timed = [];
  let idx = 0;
  params.clusters.forEach((cluster, ci) => {
    const baseAngle = cluster.angle - Math.PI / 2;
    const own = [];
    if (params.symmetry.type === 'axial') {
      const bx = cx + Math.cos(baseAngle) * cluster.distance * maxRadius;
      const by = cy + Math.sin(baseAngle) * cluster.distance * maxRadius;
      own.push([bx, by], [2 * cx - bx, by]);
    } else {
      // mirror (k=3, k=4) : chaque branche a son reflet, jamais de moulinet
      for (let k = 0; k < params.symmetry.k * (params.symmetry.mirror ? 2 : 1); k++) {
        const rot = (k < params.symmetry.k ? baseAngle : -cluster.angle - Math.PI / 2)
          + (k % params.symmetry.k) * params.sectorAngle;
        own.push([cx + Math.cos(rot) * cluster.distance * maxRadius, cy + Math.sin(rot) * cluster.distance * maxRadius]);
      }
    }
    const start = idx, dists = [];
    for (const [ccx, ccy] of own) {
      centers.push([ccx, ccy]);
      for (let p = 0; p < cluster.particleCount; p++) {
        const pt = particles[idx++];
        dists.push(Math.hypot(pt.x - ccx, pt.y - ccy));
      }
    }
    const sorted = dists.slice().sort((a, b) => a - b);
    const reach = sorted[Math.floor(sorted.length * 0.95)] || 1;
    for (let i = 0; i < dists.length; i++) {
      const spread = Math.pow(Math.min(dists[i] / reach, 1.2), 0.7);
      const time = T.bloom + rankOf[ci] * T.bloomStagger + spread * T.bloomDur + jitter() * 0.2;
      timed.push([time, particles[start + i]]);
    }
  });

  const counts = new Uint32Array(BW * BH);
  const dotOf = (pt) => {
    const x = Math.round(pt.x), y = Math.round(pt.y);
    return (x >= 0 && x < BW && y >= 0 && y < BH) ? y * BW + x : -1;
  };
  for (const pt of particles) { const d = dotOf(pt); if (d >= 0) counts[d]++; }
  let max = 0;
  for (const c of counts) if (c > max) max = c;
  let need = 1;
  while (need <= max && !(Math.pow(need / max, FIELD_GAMMA) > FIELD_THRESHOLD)) need++;

  // Instant d'allumage de chaque point : celui où sa densité franchit le seuil.
  const act = new Float32Array(BW * BH).fill(Infinity);
  const running = new Uint32Array(BW * BH);
  timed.sort((a, b) => a[0] - b[0]);
  let end = T.bloom;
  for (const [time, pt] of timed) {
    const d = dotOf(pt);
    if (d < 0) continue;
    if (++running[d] === need) { act[d] = time; if (time > end) end = time; }
  }
  return { act, centers, end };
}

function nearestCenter(centers, x, y) {
  let best = centers[0], bestD = Infinity;
  for (const c of centers) {
    const d = Math.hypot(c[0] - x, c[1] - y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// `silhouette` : masque { w, h, on } de silhouette.js, ou null.
async function buildScene(word, entropy, core, { atlas, titleDots, silhouette }) {
  const T = silhouette ? T_OBJECT : T_WORD;
  const grid = core.buildGrid(word, entropy);
  const bloom = buildBloom(word, entropy, core, T);
  const rng = core.mulberry32((grid.seed ^ 0x51ED270B) >>> 0);

  // Garde-fou : la pousse doit aboutir exactement au blason de buildGrid.
  for (let r = 0; r < BLOCK_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid.cells[r][c].layer !== 'braille') continue;
      let bits = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (bloom.act[(r * 4 + dy) * BW + c * 2 + dx] < Infinity) bits |= BRAILLE_BITS[dy][dx];
        }
      }
      if (String.fromCharCode(0x2800 + bits) !== grid.cells[r][c].char) {
        throw new Error(`reel: la pousse ne retombe pas sur le blason (cellule ${r},${c}) — core.js a changé ?`);
      }
    }
  }

  const cellColor = grid.cells.map((row) => row.map((cell) => parseColor(cell.color)));
  const glyphOf = (ch) => atlas.index.get(ch);

  // Cadre : ordre de tracé le long du périmètre, depuis le coin haut-gauche
  // dans les deux sens.
  const border = [];
  const perimeter = 2 * (COLS - 1 + BLOCK_ROWS - 1);
  for (let r = 0; r < BLOCK_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = grid.cells[r][c];
      if (cell.layer !== 'struct') continue;
      let d;
      if (r === 0) d = c;
      else if (c === COLS - 1) d = COLS - 1 + r;
      else if (r === BLOCK_ROWS - 1) d = COLS - 1 + BLOCK_ROWS - 1 + (COLS - 1 - c);
      else d = perimeter - r;
      border.push({ r, c, glyph: glyphOf(cell.char), order: Math.min(d, perimeter - d) / (perimeter / 2) });
    }
  }

  // Acte 1 — le mot en gothique, tramé en points.
  const title = await titleDots(word, 140, 44);
  const tox = Math.floor((BW - title.w) / 2), toy = Math.floor(BH / 2 - title.h / 2) - 10;
  const titlePts = [];
  for (let y = 0; y < title.h; y++) {
    for (let x = 0; x < title.w; x++) {
      if (!title.on[y * title.w + x]) continue;
      const sx = tox + x, sy = toy + y;
      const target = nearestCenter(bloom.centers, sx, sy);
      titlePts.push({
        sx, sy,
        tx: Math.min(BW - 3, Math.max(2, target[0] + (rng() - 0.5) * 3)),
        ty: Math.min(BH - 5, Math.max(4, target[1] + (rng() - 0.5) * 3)),
        appear: T.titleIn + T.titleDur * (0.7 * bayer(sx, sy) + 0.3 * (x / title.w)),
        leave: T.leave + rng() * (silhouette ? 0.35 : 0.4),
        travel: 0.5 + rng() * 0.25,
      });
    }
  }

  // Acte 2 — l'objet : points ombrés et tramés, bords érodés (pas de contour
  // net), chacun venant d'une lettre du mot puis repartant vers un foyer.
  const objPts = [], sparks = [];
  let sx0 = 0, sy0 = 0, sil = null;
  if (silhouette) {
    sil = silhouette;
    sx0 = Math.floor((BW - sil.w) / 2);
    sy0 = Math.floor((BH - sil.h) / 2) + 4;
    const inSil = (x, y) => x >= 0 && y >= 0 && x < sil.w && y < sil.h && sil.on[y * sil.w + x] === 1;
    for (let y = 0; y < sil.h; y++) {
      for (let x = 0; x < sil.w; x++) {
        if (!inSil(x, y)) continue;
        const edge = !inSil(x - 1, y) || !inSil(x + 1, y) || !inSil(x, y - 1) || !inSil(x, y + 1);
        // lumière rasante venue du haut-gauche, modulée par un bruit de pierre
        const shade = 0.25 + 0.33 * (1 - y / sil.h) + 0.24 * (1 - x / sil.w) + 0.25 * vnoise(x * 0.18, y * 0.18, 7);
        const keep = edge ? vnoise(x * 0.35, y * 0.35, 11) > 0.22 : shade > bayer(x, y);
        if (!keep) continue;
        const px = sx0 + x, py = sy0 + y;
        const target = nearestCenter(bloom.centers, px, py);
        objPts.push({
          x, y, px, py, edge, shade,
          src: titlePts[Math.floor(rng() * titlePts.length)],
          arrive: T.build + T.buildDur * (0.75 * (1 - y / sil.h) + 0.25 * rng()), // de bas en haut
          travel: 0.55 + rng() * 0.3,
          tx: target[0] + (rng() - 0.5) * 3, ty: target[1] + (rng() - 0.5) * 3,
          go: T.go + rng() * 0.5 + 0.3 * (y / sil.h),
          ember: edge && rng() < 0.07, // braises : accent rouge de la charte
          phase: rng() * Math.PI * 2,
        });
      }
    }
    // étincelles qui montent depuis le bas de l'objet
    const base = objPts.filter((p) => p.edge && p.y > sil.h * 0.45);
    for (let i = 0; i < SPARKS && base.length; i++) {
      const from = base[Math.floor(rng() * base.length)];
      sparks.push({ x: from.px, y: from.py, period: 1.6 + rng() * 1.4, offset: rng() * 3, drift: (rng() - 0.5) * 10, rise: 22 + rng() * 26 });
    }
  }

  // Ligne de graine, lettres espacées d'une cellule, centrée sous le titre.
  const seedText = 'SEED 0x' + (grid.seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const seedRow = ROW0 + Math.ceil((toy + title.h) / 4) + 2;
  const seedCol = Math.floor((COLS - (seedText.length * 2 - 1)) / 2);
  const seedChars = [...seedText].map((ch, i) => ({
    ch, col: seedCol + i * 2, hex: i >= 7 ? i - 7 : -1,
    leave: T.leave + rng() * 0.25,
  }));

  const dn = new Float32Array(BW * BH); // distance normalisée au centre
  for (let y = 0; y < BH; y++) {
    for (let x = 0; x < BW; x++) dn[y * BW + x] = Math.min(1, Math.hypot(x - BW / 2, y - BH / 2) / 120);
  }

  const lum = new Float32Array(DW * DH), col = new Float32Array(DW * DH * 3);
  const accent = new Uint8Array(DW * DH);
  const setDot = (x, y, l, rgb, isAccent) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= DW || y < 0 || y >= DH) return;
    const i = y * DW + x;
    if (l <= lum[i] && !isAccent) return;
    lum[i] = Math.max(l, lum[i]); col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2];
    if (isAccent) accent[i] = 1;
  };
  // l < 1 : le point s'éteint vers le fond ; l > 1 : il chauffe vers le blanc.
  const shade = (rgb, o, l, out) => {
    for (let k = 0; k < 3; k++) {
      const c = rgb[o + k];
      out[k] += l <= 1 ? BG[k] + (c - BG[k]) * l : c + (WHITE[k] - c) * Math.min(1, l - 1);
    }
  };
  const sweepAt = (u, t) => {
    const pos = -0.2 + 1.4 * ((t - T.sweepIn) / T.sweepDur);
    const k = (u - pos) / 0.06;
    return 0.8 * Math.exp(-k * k);
  };

  function renderFrame(t, frame) {
    lum.fill(0);
    accent.fill(0);
    const outQ = (t - T.out) / T.outDur;

    // Halo tramé au-dessus et au-dessous du cadre : la lumière du blason qui
    // déborde, rendue en tramage ordonné.
    const auraAmp = smooth(T.bloom + 1, T.bloom + 5, t) * (1 - smooth(T.out, T.out + 1.0, t));
    if (auraAmp > 0) {
      for (let y = 0; y < DH; y++) {
        const above = y < DOT_Y0, below = y >= DOT_Y0 + BH;
        if (!above && !below) continue;
        const d = above ? (DOT_Y0 - y) / DOT_Y0 : (y - (DOT_Y0 + BH) + 1) / (DH - DOT_Y0 - BH);
        const fall = Math.pow(1 - d, 1.7);
        for (let x = 0; x < DW; x++) {
          const wave = 0.5 + 0.2 * Math.sin(t * 0.9 + x * 0.07 + (above ? 0 : 2.1)) + 0.13 * Math.sin(t * 0.53 - x * 0.031);
          const side = (x - DW / 2) / 58; // plus dense au centre : une lueur, pas un bandeau
          if (auraAmp * fall * wave * (0.3 + 0.7 * Math.exp(-side * side)) > bayer(x, y)) setDot(x, y, 0.34, BLUE_A);
        }
      }
    }

    // Blason : points allumés selon l'avancement de la pousse.
    if (t >= T.bloom) {
      for (let y = 0; y < BH; y++) {
        for (let x = 0; x < BW; x++) {
          const i = y * BW + x, a = bloom.act[i];
          if (a > t) continue;
          if (outQ > 0 && outQ > 0.55 * (1 - dn[i]) + 0.45 * bayer(x, y)) continue;
          let l = 1 + 0.9 * Math.exp(-(t - a) / 0.35);
          l *= 1 + 0.1 * Math.sin(2 * Math.PI * (0.4 * t - 1.2 * dn[i]));
          l += sweepAt((x / BW + y / BH) / 2, t);
          setDot(x, y + DOT_Y0, l, cellColor[y >> 2][x >> 1]);
        }
      }
    }

    // Le mot : apparition tramée, puis (sans silhouette) migration vers les foyers.
    if (t >= T.titleIn && t < T.leave + 1.2) {
      for (const p of titlePts) {
        if (t < p.appear) continue;
        if (t < p.leave) {
          setDot(p.sx, p.sy + DOT_Y0, 1 + 0.8 * Math.exp(-(t - p.appear) / 0.25), BLUE_B);
        } else if (!silhouette) {
          const k = (t - p.leave) / p.travel;
          if (k >= 1) continue;
          const e = k * k * k;
          setDot(p.sx + (p.tx - p.sx) * e, p.sy + (p.ty - p.sy) * e + DOT_Y0, 1.25, BLUE_B);
        }
      }
    }

    // L'objet.
    if (silhouette && t >= T.build - 0.6 && t < T.go + 2) {
      const holdK = smooth(T.hold - 0.4, T.hold + 0.6, t) * (1 - smooth(T.go - 0.2, T.go + 0.4, t));
      // lueur qui tourne lentement autour de l'objet
      const ang = t * 0.55 + (grid.seed % 628) / 100;
      const lx = sx0 + sil.w * (0.5 + 0.55 * Math.cos(ang)), ly = sy0 + sil.h * (0.35 + 0.3 * Math.sin(ang * 0.7));
      const flick = 0.8 + 0.2 * vnoise(t * 5, 0, 3);
      for (const p of objPts) {
        const depart = p.arrive - p.travel;
        if (t < depart) continue;
        if (t < p.arrive) { // en vol depuis une lettre du mot
          const k = easeInOut((t - depart) / p.travel);
          setDot(p.src.sx + (p.px - p.src.sx) * k, p.src.sy + (p.py - p.src.sy) * k + DOT_Y0, 1.3, BLUE_B);
        } else if (t >= p.go) { // vers les foyers du blason
          const k = (t - p.go) / p.travel;
          if (k >= 1) continue;
          const e = k * k * k;
          setDot(p.px + (p.tx - p.px) * e, p.py + (p.ty - p.py) * e + DOT_Y0, 1.25, BLUE_B);
        } else { // posé
          const settle = Math.exp(-(t - p.arrive) / 0.3);
          const glow = holdK * flick * Math.exp(-Math.hypot(p.px - lx, p.py - ly) / 26);
          let l = (p.edge ? 1.05 : 0.55 + 0.5 * p.shade) + 0.7 * settle + 0.55 * glow;
          if (p.y < sil.h * 0.12 && hash2(p.x, Math.floor(t * 7), 5) > 0.93) l += 0.6; // scintillement des sommets
          if (p.ember && holdK > 0.05) {
            const heat = holdK * (0.55 + 0.45 * Math.sin(t * 7 + p.phase) * vnoise(t * 3, p.x, 9));
            if (heat > 0.35) { setDot(p.px, p.py + DOT_Y0, 1, RED, true); continue; }
          }
          setDot(p.px, p.py + DOT_Y0, l, BLUE_B);
        }
      }
      // étincelles rouges
      if (holdK > 0) {
        for (const s of sparks) {
          const k = ((t + s.offset) % s.period) / s.period;
          if (k > 0.8 || hash2(Math.floor((t + s.offset) / s.period), s.x, 13) < 0.35) continue;
          setDot(s.x + s.drift * k + Math.sin(k * 9 + s.offset) * 1.5, s.y - s.rise * k + DOT_Y0, 1, RED, true);
        }
      }
      // brume tramée au pied
      const fog = smooth(T.build + 1.2, T.hold + 0.8, t) * (1 - smooth(T.go, T.go + 0.9, t));
      if (fog > 0) {
        const fy0 = sy0 + Math.floor(sil.h * 0.72), fy1 = Math.min(BH - 4, sy0 + sil.h + 14);
        for (let y = fy0; y < fy1; y++) {
          const band = smooth(fy0, fy0 + 10, y) * (1 - smooth(fy1 - 8, fy1, y));
          for (let x = 4; x < BW - 4; x++) {
            const n = vnoise(x * 0.06 + t * 0.35, y * 0.12, 21) * 0.7 + vnoise(x * 0.15 - t * 0.2, y * 0.2, 22) * 0.3;
            if (fog * band * (n - 0.25) * 1.4 > bayer(x, y)) setDot(x, y + DOT_Y0, 0.42, BLUE_A);
          }
        }
      }
    }

    frame.fill(BG[0]);
    const out = [0, 0, 0];
    const py = (row) => Y0 + row * CELL_H;

    for (let r = 0; r < FULL_ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        let bits = 0, n = 0, hot = false;
        out[0] = out[1] = out[2] = 0;
        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const i = (r * 4 + dy) * DW + c * 2 + dx;
            if (lum[i] <= 0) continue;
            bits |= BRAILLE_BITS[dy][dx]; n++;
            if (accent[i]) hot = true;
            shade(col, i * 3, lum[i], out);
          }
        }
        if (n === 0) continue;
        // une braise colore toute la cellule : l'accent doit rester lisible
        const rgb = hot ? mix([out[0] / n, out[1] / n, out[2] / n], RED, 0.85) : [out[0] / n, out[1] / n, out[2] / n];
        blit(frame, WIDTH, HEIGHT, atlas, bits, c * CELL_W, py(r), rgb[0], rgb[1], rgb[2], BG);
      }
    }

    // Cadre braille du bloc (par-dessus, comme overlayStructural).
    const borderP = outQ > 0 ? 1 - easeInOut(clamp01(outQ)) : easeInOut(clamp01((t - T.borderIn) / T.borderDur));
    if (borderP > 0) {
      for (const b of border) {
        if (b.order > borderP) continue;
        const head = borderP < 1 ? Math.exp(-(borderP - b.order) / 0.04) : 0;
        out[0] = out[1] = out[2] = 0;
        shade(BLUE_B, 0, 1 + head + sweepAt((b.c / COLS + b.r / BLOCK_ROWS) / 2, t), out);
        blit(frame, WIDTH, HEIGHT, atlas, b.glyph, b.c * CELL_W, py(b.r + ROW0), out[0], out[1], out[2], BG);
      }
    }

    // Graine : les chiffres défilent en rouge puis se figent un par un.
    if (t >= T.seedIn && t < T.leave + 0.5) {
      const tick = Math.floor(t * FPS / 2);
      seedChars.forEach((s, i) => {
        if (s.ch === ' ' || t < T.seedIn + i * 0.03) return;
        let ch = s.ch, rgb = s.hex >= 0 ? BLUE_B : BLUE_A;
        if (t >= s.leave) {
          if (t >= s.leave + 0.2) return;
          ch = SCRAMBLE[(tick * 7 + i * 13) % SCRAMBLE.length];
        } else if (s.hex >= 0 && t < T.seedLock + s.hex * T.seedLockStep) {
          ch = '0123456789ABCDEF'[(Math.imul(tick * 31 + i * 17 + 7, 0x9E3779B1) >>> 13) % 16];
          rgb = RED;
        }
        blit(frame, WIDTH, HEIGHT, atlas, glyphOf(ch), s.col * CELL_W, py(seedRow), rgb[0], rgb[1], rgb[2], BG);
      });
    }
  }

  return { grid, renderFrame, bloomEnd: bloom.end, timeline: T };
}

module.exports = { WIDTH, HEIGHT, FPS, DURATION, COVER_MS, buildScene };
