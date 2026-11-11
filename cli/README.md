# heraldic

One word, one blazon. Not carved in stone — carved into the text: the
signature (symmetry, palette, density) is fixed by what you type, but every
invocation redistributes the particles differently. Same seal, never the
same imprint twice.

Braille-glyph rendering, cold colors `#6B7EC4` / `#8A9AD4`, black
background. No frame, no outline — the blazon floats in the terminal like
an artifact decoded live.

## How it works

The text is hashed (`hashString`) to seed a first deterministic
pseudo-random stream (`mulberry32`) that derives the blazon's **family**:
symmetry type (axial, or radial k=3/4/6/8), palette bias, density band.
This stream depends only on the text — fixed for a given word.

Each generation also draws a fresh random **entropy**
(`crypto.randomBytes`), XORed with the text hash to form the final seed.
That seed drives a second `mulberry32` stream that places the particle
clusters and their scatter — this is the stream that varies on every draw,
not the first one. Result: same text → same visual family, different
entropy → different variant within that family.

`(text, entropy)` fixed → strictly reproducible grid (guaranteed by
`node --test`). `/reroll` just draws a new entropy for the current text,
without retyping it.

Full pipeline: hash → family parameters → particles → dot field → braille
raster → structural overlay → colorize.

## Installation

```bash
npm install -g heraldic
```

## Usage

```
heraldic:~$ chateau
[colored braille grid]
SEED 0x4F2A91C3  REV 2.6  UNIT/D-01

heraldic:~$ /reroll
[new variant, same family, new SEED]

heraldic:~$ /export png
écrit: chateau.png

heraldic:~$ /help
commandes disponibles :
  <texte>              génère un blason à partir du texte
  /reroll               nouveau tirage du même texte
  /export <fmt>         exporte le dernier blason (fmt: png, png-story, png-clean, png-clean-story, mp4, mp4-story, mp4-clean, mp4-clean-story, reel, txt, ans, svg)
  /export reel [audio]  reel 9:16 de 15 s ; chemin de piste audio optionnel
  /clear                 vide l’écran
  /quit                  quitte le programme
  /help                  affiche cette liste
```

(the CLI's own output stays in French — that's what you'll actually see)

## Video export

The `mp4` and `mp4-story` formats render the decode animation to MP4 video.
This requires the `ffmpeg` system binary — install with `brew install ffmpeg`
(macOS) or `apt install ffmpeg` (Linux/Debian).

Supported export formats:
- `png`: single frame PNG (1080×1377)
- `png-story`: tall story-format PNG (1080×1920) — same 1080×1377 render as `png`, letterboxed (centered, black margins top/bottom) rather than stretched
- `png-clean`: motif only, no decorative frame, no SEED metadata line (1080×1350)
- `png-clean-story`: `png-clean` render (1080×1350), letterboxed in a 1080×1920 canvas
- `mp4`: video with decode animation (1080×1376, 30fps, ~2.2s) — height rounds down for H.264/yuv420p even-dimension requirement
- `mp4-story`: tall video with decode animation (1080×1920, 30fps, ~2.2s) — same letterbox treatment as `png-story`
- `mp4-clean`: motif-only video, no frame, no SEED line (1080×1350, already even — no H.264 rounding)
- `mp4-clean-story`: `mp4-clean` render, letterboxed in a 1080×1920 canvas
- `reel`: 15 s vertical reel (1080×1920, 30fps, H.264 + AAC, ~2 MB) — see below
- `txt`: plain text
- `ans`: ANSI colored text
- `svg`: scalable vector

## Reel export

```
heraldic:~$ tenebre
heraldic:~$ /export reel
écrit: tenebre-reel.mp4

heraldic:~$ /export reel ~/Music/track.mp3
```

A 15-second loop built from the current blazon (same text, same entropy —
the reel ends on exactly the grid you see in the terminal):

| Time | Sequence |
|---|---|
| 0.3 → 1.9 s | the braille frame draws itself |
| 0.5 → 1.4 s | the word appears in blackletter, dithered into braille dots |
| 1.55 → 2.7 s | the seed resolves under the word, red digits locking one by one |
| 2.75 → 3.7 s | the word's dots migrate to the blazon's cluster centers |
| 3.35 → 8.8 s | the blazon grows: the generator's own particles accumulate |
| 8.8 → 13.2 s | hold: slow breathing, dithered halo, one light sweep |
| 13.2 → 15 s | dithered dissolve back to black |

Every frame is a character grid, composited from a glyph atlas rendered
once with the same pipeline as `png`. The center 1080×1350 of the frame
lines up with `png-clean-story`.

The optional argument is an audio file (anything `ffmpeg` reads) mixed in
with a fade in/out; without it the audio track is silent. Requires
`ffmpeg`, like the `mp4` formats. The title font is
[Jacquard 24](https://github.com/scfried/soft-type-jacquard) (SIL OFL 1.1,
bundled in `assets/fonts`).

## Local development

```bash
cd cli
npm install
npm link
```

## Tests

```bash
npm test
```
