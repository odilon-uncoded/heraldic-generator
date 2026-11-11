'use strict';

// Scène du reel : tout ce qui est affiché est une grille de caractères
// (braille + quelques glyphes), exactement comme les exports image. Chaque frame est
// une fonction pure du temps — même mot + même entropie = même vidéo.
//
// Déroulé (15 s, boucle sur du noir) :
//   0.3 →  1.9  le cadre braille se trace
//   0.5 →  1.4  le mot apparaît en gothique, tramé en points braille
//   1.55 → 2.7  la graine se calcule sous le mot (chiffres rouges qui se figent)
//   2.75 → 3.7  les points du mot migrent vers les foyers du blason
//   3.35 → 8.8  le blason pousse : les particules du générateur s'accumulent
//   8.8 → 13.2  tenue : respiration lente + un balayage de lumière
//   13.2 → 14.5 dissolution tramée, retour au noir

const { CELL_W, CELL_H, blit } = require('./atlas');

const WIDTH = 1080, HEIGHT = 1920, FPS = 30, DURATION = 15;
const COLS = 80, BLOCK_ROWS = 50;
// La grille plein cadre fait 72 lignes ; le bloc 80x50 du blason y occupe les
// lignes 11 à 60, soit y = 285 → 1635 px : la même position que l'export png-clean-story.
// Le centre de chaque frame se superpose donc au pixel près à un export png.
const FULL_ROWS = 72, ROW0 = 11, Y0 = -12;
const DW = COLS * 2, DH = FULL_ROWS * 4, BLOCK_DW = COLS * 2, BLOCK_DH = BLOCK_ROWS * 4, DOT_Y0 = ROW0 * 4;

const COVER_MS = 9500; // frame de couverture : blason complet, avant le balayage

const BG = [10, 10, 10];
const BLUE_A = [0x6B, 0x7E, 0xC4], BLUE_B = [0x8A, 0x9A, 0xD4], RED = [0xE6, 0x19, 0x19], WHITE = [236, 240, 255];
const BRAILLE_BITS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
const FIELD_GAMMA = 0.55, FIELD_THRESHOLD = 0.06; // identiques à core.js
const SCRAMBLE = '⠿⣿⢿⡿⣻⠷█▓▒░/\\|+°';

const T = {
  borderIn: 0.3, borderDur: 1.6,
  titleIn: 0.5, titleDur: 0.9,
  seedIn: 1.55, seedLock: 1.9, seedLockStep: 0.1,
  leave: 2.75,
  bloom: 3.35, bloomStagger: 0.22, bloomDur: 3.4,
  sweepIn: 10.2, sweepDur: 1.4,
  out: 13.2, outDur: 1.3,
};

function bayerMatrix(n) {
  let m = [[0]];
  for (let size = 1; size < n; size *= 2) {
    const next = [];
    for (let y = 0; y < size * 2; y++) {
      next.push([]);
      for (let x = 0; x < size * 2; x++) {
        const base = m[y % size][x % size] * 4;
        next[y].push(base + [[0, 2], [3, 1]][y < size ? 0 : 1][x < size ? 0 : 1]);
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

function parseColor(color) {
  if (color[0] === '#') return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  return m ? [+m[1], +m[2], +m[3]] : BLUE_B;
}

// Rejoue la génération de core.js en gardant, pour chaque particule, son
// foyer et sa distance au foyer : c'est ce qui permet d'animer la pousse dans
// l'ordre réel du procédé (foyers symétriques, puis diffusion), et d'arriver
// exactement sur le blason que buildGrid produit.
function buildBloom(word, entropy, core) {
  const textHash = core.hashString(word);
  const seed = (textHash ^ (entropy >>> 0)) >>> 0;
  const variantRng = core.mulberry32(seed);
  const params = core.deriveParams(core.mulberry32(textHash), variantRng);
  const particles = core.generateParticles(params, variantRng, BLOCK_DW, BLOCK_DH);

  const cx = BLOCK_DW / 2, cy = BLOCK_DH / 2, maxRadius = Math.min(BLOCK_DW, BLOCK_DH) * 0.42;
  const rank = params.clusters.map((c, i) => [c.distance, i]).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const rankOf = []; rank.forEach((ci, r) => { rankOf[ci] = r; });
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
      for (let k = 0; k < params.symmetry.k; k++) {
        const rot = baseAngle + k * params.sectorAngle;
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

  const counts = new Uint32Array(BLOCK_DW * BLOCK_DH);
  const dotOf = (pt) => {
    const x = Math.round(pt.x), y = Math.round(pt.y);
    return (x >= 0 && x < BLOCK_DW && y >= 0 && y < BLOCK_DH) ? y * BLOCK_DW + x : -1;
  };
  for (const pt of particles) { const d = dotOf(pt); if (d >= 0) counts[d]++; }
  let max = 0;
  for (const c of counts) if (c > max) max = c;
  let need = 1;
  while (need <= max && !(Math.pow(need / max, FIELD_GAMMA) > FIELD_THRESHOLD)) need++;

  // Instant d'allumage de chaque point : celui où sa densité franchit le seuil.
  const act = new Float32Array(BLOCK_DW * BLOCK_DH).fill(Infinity);
  const running = new Uint32Array(BLOCK_DW * BLOCK_DH);
  timed.sort((a, b) => a[0] - b[0]);
  let end = T.bloom;
  for (const [time, pt] of timed) {
    const d = dotOf(pt);
    if (d < 0) continue;
    if (++running[d] === need) { act[d] = time; if (time > end) end = time; }
  }
  return { act, centers, end };
}

async function buildScene(word, entropy, core, { atlas, titleDots }) {
  const grid = core.buildGrid(word, entropy);
  const bloom = buildBloom(word, entropy, core);
  const rng = core.mulberry32((grid.seed ^ 0x51ED270B) >>> 0);

  // Garde-fou : la pousse doit aboutir exactement au blason de buildGrid.
  for (let r = 0; r < BLOCK_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid.cells[r][c].layer !== 'braille') continue;
      let bits = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
        if (bloom.act[(r * 4 + dy) * BLOCK_DW + c * 2 + dx] < Infinity) bits |= BRAILLE_BITS[dy][dx];
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

  // Titre gothique → points, chacun avec son instant d'apparition (tramé) et
  // sa trajectoire vers le foyer du blason le plus proche.
  const title = await titleDots(word, 140, 44);
  const tox = Math.floor((BLOCK_DW - title.w) / 2), toy = Math.floor(BLOCK_DH / 2 - title.h / 2) - 10;
  const titlePts = [];
  for (let y = 0; y < title.h; y++) {
    for (let x = 0; x < title.w; x++) {
      if (!title.on[y * title.w + x]) continue;
      const sx = tox + x, sy = toy + y;
      let best = bloom.centers[0], bestD = Infinity;
      for (const ctr of bloom.centers) {
        const d = Math.hypot(ctr[0] - sx, ctr[1] - sy);
        if (d < bestD) { bestD = d; best = ctr; }
      }
      titlePts.push({
        sx, sy,
        tx: Math.min(BLOCK_DW - 3, Math.max(2, best[0] + (rng() - 0.5) * 3)),
        ty: Math.min(BLOCK_DH - 5, Math.max(4, best[1] + (rng() - 0.5) * 3)),
        appear: T.titleIn + T.titleDur * (0.7 * bayer(sx, sy) + 0.3 * (x / title.w)),
        leave: T.leave + rng() * 0.4,
        travel: 0.5 + rng() * 0.25,
      });
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

  const dn = new Float32Array(BLOCK_DW * BLOCK_DH); // distance normalisée au centre
  for (let y = 0; y < BLOCK_DH; y++) for (let x = 0; x < BLOCK_DW; x++) {
    dn[y * BLOCK_DW + x] = Math.min(1, Math.hypot(x - BLOCK_DW / 2, y - BLOCK_DH / 2) / 120);
  }

  const lum = new Float32Array(DW * DH), col = new Float32Array(DW * DH * 3);
  const setDot = (x, y, l, rgb) => {
    if (x < 0 || x >= DW || y < 0 || y >= DH) return;
    const i = y * DW + x;
    if (l <= lum[i]) return;
    lum[i] = l; col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2];
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
    const outQ = (t - T.out) / T.outDur;

    // Halo tramé au-dessus et au-dessous du cadre : la lumière du blason qui
    // déborde, rendue en tramage ordonné.
    const auraAmp = smooth(4.2, 8.8, t) * (1 - smooth(T.out, T.out + 1.0, t));
    if (auraAmp > 0) {
      for (let y = 0; y < DH; y++) {
        const above = y < DOT_Y0, below = y >= DOT_Y0 + BLOCK_DH;
        if (!above && !below) continue;
        const d = above ? (DOT_Y0 - y) / DOT_Y0 : (y - (DOT_Y0 + BLOCK_DH) + 1) / (DH - DOT_Y0 - BLOCK_DH);
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
      for (let y = 0; y < BLOCK_DH; y++) {
        for (let x = 0; x < BLOCK_DW; x++) {
          const i = y * BLOCK_DW + x, a = bloom.act[i];
          if (a > t) continue;
          if (outQ > 0 && outQ > 0.55 * (1 - dn[i]) + 0.45 * bayer(x, y)) continue;
          let l = 1 + 0.9 * Math.exp(-(t - a) / 0.35);
          l *= 1 + 0.1 * Math.sin(2 * Math.PI * (0.4 * t - 1.2 * dn[i]));
          l += sweepAt((x / BLOCK_DW + y / BLOCK_DH) / 2, t);
          setDot(x, y + DOT_Y0, l, cellColor[y >> 2][x >> 1]);
        }
      }
    }

    // Titre : apparition tramée, puis migration vers les foyers.
    if (t >= T.titleIn && t < T.leave + 1.2) {
      for (const p of titlePts) {
        if (t < p.appear) continue;
        if (t < p.leave) {
          setDot(p.sx, p.sy + DOT_Y0, 1 + 0.8 * Math.exp(-(t - p.appear) / 0.25), BLUE_B);
        } else {
          const k = (t - p.leave) / p.travel;
          if (k >= 1) continue;
          const e = k * k * k;
          setDot(Math.round(p.sx + (p.tx - p.sx) * e), Math.round(p.sy + (p.ty - p.sy) * e) + DOT_Y0, 1.25, BLUE_B);
        }
      }
    }

    frame.fill(BG[0]);
    const out = [0, 0, 0];
    const py = (row) => Y0 + row * CELL_H;

    for (let r = 0; r < FULL_ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        let bits = 0, n = 0;
        out[0] = out[1] = out[2] = 0;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
          const i = (r * 4 + dy) * DW + c * 2 + dx;
          if (lum[i] <= 0) continue;
          bits |= BRAILLE_BITS[dy][dx]; n++;
          shade(col, i * 3, lum[i], out);
        }
        if (n === 0) continue;
        blit(frame, WIDTH, HEIGHT, atlas, bits, c * CELL_W, py(r), out[0] / n, out[1] / n, out[2] / n, BG);
      }
    }

    // Cadre braille du bloc (par-dessus, comme overlayStructural).
    const borderP = outQ > 0 ? 1 - easeInOut(clamp01(outQ)) : easeInOut(clamp01((t - T.borderIn) / T.borderDur));
    if (borderP > 0) {
      for (const b of border) {
        if (b.order > borderP) continue;
        const head = borderP < 1 ? Math.exp(-(borderP - b.order) / 0.04) : 0;
        const l = 1 + head + sweepAt((b.c / COLS + b.r / BLOCK_ROWS) / 2, t);
        out[0] = out[1] = out[2] = 0;
        shade(BLUE_B, 0, l, out);
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

  return { grid, renderFrame, bloomEnd: bloom.end };
}

module.exports = { WIDTH, HEIGHT, FPS, DURATION, COVER_MS, buildScene };
