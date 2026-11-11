'use strict';

const { spawn } = require('child_process');

// Contraintes Instagram Reels : H.264, 4:2:0, GOP fermé, moov en tête
// (faststart), AAC <= 48 kHz. Le débit est plafonné pour qu'un reel de 15 s
// reste autour de 2 à 4 Mo.
const MAX_VIDEO_KBPS = 2200;

// Halo léger : la frame est floutée puis recomposée en "screen" sur elle-même.
const GLOW = 'split[sharp][soft];[soft]gblur=sigma=9[soft];[sharp][soft]blend=all_mode=screen:all_opacity=0.32';

// `writeFrames(write)` reçoit une fonction async `write(buffer)` et lui passe
// les frames RGB24 une par une. `audioPath` est optionnel : sans lui, une
// piste AAC silencieuse est ajoutée (les reels sans piste audio sont parfois
// refusés par l'API, et la piste ne coûte presque rien).
function encodeMp4({ width, height, fps, duration, outPath, audioPath, writeFrames }) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0'];
  if (audioPath) args.push('-i', audioPath);
  else args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');

  const fadeOut = Math.max(0, duration - 1.2).toFixed(2);
  const filters = [`[0:v]${GLOW},scale=out_color_matrix=bt709,format=yuv420p[v]`];
  if (audioPath) filters.push(`[1:a]afade=t=in:d=0.4,afade=t=out:st=${fadeOut}:d=1.2,aresample=48000[a]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', audioPath ? '[a]' : '1:a');

  args.push('-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-crf', '19',
    '-maxrate', `${MAX_VIDEO_KBPS}k`, '-bufsize', `${MAX_VIDEO_KBPS * 2}k`,
    '-g', String(fps), '-flags', '+cgop',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', audioPath ? '128k' : '32k', '-ac', '2',
    '-t', String(duration), '-movflags', '+faststart', outPath);

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '', failed = false;
    const fail = (err) => { if (!failed) { failed = true; reject(err); } };
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (err) => {
      fail(err.code === 'ENOENT'
        ? new Error('ffmpeg introuvable — installe-le (brew install ffmpeg / apt install ffmpeg)')
        : err);
    });
    proc.stdin.on('error', () => {}); // EPIPE si ffmpeg meurt : l'erreur utile arrive par "close"
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else fail(new Error(`ffmpeg a échoué (code ${code}): ${stderr.slice(-800)}`));
    });

    const write = (buffer) => new Promise((res) => {
      if (failed || proc.stdin.destroyed) return res();
      if (proc.stdin.write(buffer)) res();
      else proc.stdin.once('drain', res);
    });
    Promise.resolve(writeFrames(write)).then(() => proc.stdin.end(), fail);
  });
}

module.exports = { encodeMp4 };
