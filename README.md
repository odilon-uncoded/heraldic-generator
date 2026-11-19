# Blazon Generator 

A word in, a coat of arms out — procedurally generated, seeded from the
text itself. Three surfaces, each with its own take on how much of that
generation is fixed by the text alone (details below).

odilon.wav palette: black background, stippled particles, desaturated
blue-gray (`#6B7EC4` / `#8A9AD4`), eroded organic shapes, no hard edges, no
frame.

## Three surfaces, one pipeline

- **Node CLI**, published on npm as [`heraldic`](https://www.npmjs.com/package/heraldic) — same pipeline in a real terminal. Text fixes the family, every draw varies the rest:
  ```bash
  npm install -g heraldic
  ```
  See [`cli/README.md`](cli/README.md).
- **[`terminal/index.html`](terminal/index.html)** — terminal-only browser variant with fresh randomness on every draw (text fixes the family, `/reroll` draws a new variant). See [`terminal/README.md`](terminal/README.md).
- **[`index.html`](index.html)** (root, this one) — the canonical web version: a single deterministic draw per text, no randomness mixed in — same text → same image, always.

## Usage

Open `index.html` directly in a browser — no build, no dependencies, no
server.

1. Type a word or phrase into the text field.
2. The canvas updates live (150ms debounce).
3. "Exporter PNG" downloads the image at 1080×1350 (4:5 ratio), named after
   the input text (slugified).

## How it works

1. **Hash → seed**: the text is hashed (djb2-like) into a 32-bit integer.
2. **Seeded PRNG** (`mulberry32`): the entire generation draws from this
   single stream, in a fixed order. Never `Math.random()`.
3. **Derived parameters**: symmetry type (axial, or radial k∈{3,4,6,8};
   k=3 and k=4 are always mirrored so they can never form a pinwheel),
   cluster count, each cluster's position/radius/density, jitter.
4. **Particle field**: the base sector's clusters are duplicated/mirrored
   per the symmetry, then each one scatters its particles (Gaussian noise,
   density falling off from center). No fixed silhouette or outline — the
   shape emerges from the cloud.
5. **Render**: black background, each particle interpolated between the two
   palette colors.

This is the only surface with zero randomness beyond the text hash — the
CLI and terminal variants both mix in fresh entropy per draw (see their
own READMEs for why).

## Tests

```bash
node --test test/core.test.js
```

18 tests, zero npm dependencies. The pure logic (`index.html#blason-script`)
is extracted via `node:vm` by `test/support/extract-core.js` — no build, no
bundler.

## Structure

- `cli/` — Node CLI published on npm as `heraldic` (see `cli/README.md`).
- `terminal/` — terminal-only web variant (see `terminal/README.md`).
- `index.html` — single self-contained file. Two `<script>` blocks:
  - `#blason-script`: pure logic (hash, PRNG, generation, rendering,
    slugify). Testable in Node, zero DOM access.
  - `#blason-ui`: DOM wiring (input, canvas, export button). Untested
    (requires a browser).
- `test/core.test.js` — native Node test suite (`node:test`).
- `test/support/extract-core.js` — harness that extracts `#blason-script`
  from `index.html` via `node:vm` to test it.
- `docs/superpowers/specs/2026-07-11-blason-generateur-design.md` —
  validated design spec.
- `docs/superpowers/plans/2026-07-11-blason-generateur.md` — implementation
  plan (8 TDD tasks).

