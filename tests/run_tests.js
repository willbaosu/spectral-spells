// Tests for js/dsp.js. Run with: node tests/run_tests.js
// 1. FFT matches the DFT sum computed directly (N^2 way)
// 2. Bandpass keeps a tone inside 80 Hz to 4 kHz, removes tones outside
// 3. Test recordings score highest on the spell that was said
// 4. Scores as background noise gets louder
// 5. Saying the word twice scores the same as saying it once
const fs = require('fs');
const path = require('path');
const DSP = require('../js/dsp.js');

// Read a .wav file -> samples x and sampling rate fs
function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12, fmt = null, data = null;
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(p + 10), fs: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size % 2);
  }
  const n = data.length / 2 / fmt.ch, x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = data.readInt16LE(i * 2 * fmt.ch) / 32768;
  return { x, fs: fmt.fs };
}

let fails = 0;
function check(name, ok, info) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : ''));
  if (!ok) fails++;
}

// ---- 1. FFT vs direct DFT ----
{
  const N = 64, re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) { re[i] = Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1); im[i] = 0.1 * i % 1; }
  const r0 = Float64Array.from(re), i0 = Float64Array.from(im);
  DSP.fft(re, im, false);
  let err = 0;
  for (let n = 0; n < N; n++) {
    let sr = 0, si = 0;
    for (let k = 0; k < N; k++) {
      const a = -2 * Math.PI * k * n / N;
      sr += r0[k] * Math.cos(a) - i0[k] * Math.sin(a);
      si += r0[k] * Math.sin(a) + i0[k] * Math.cos(a);
    }
    err = Math.max(err, Math.hypot(sr - re[n], si - im[n]));
  }
  check('FFT matches direct DFT', err < 1e-9, 'max error ' + err.toExponential(2));
  DSP.fft(re, im, true);
  let err2 = 0;
  for (let i = 0; i < N; i++) err2 = Math.max(err2, Math.hypot(re[i] - r0[i], im[i] - i0[i]));
  check('Inverse FFT restores input', err2 < 1e-9, 'max error ' + err2.toExponential(2));
}

// ---- 2. Bandpass ----
{
  const fs = 16000, n = 16000, x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    x[i] = Math.sin(2 * Math.PI * 30 * t) + Math.sin(2 * Math.PI * 1000 * t) + Math.sin(2 * Math.PI * 6000 * t);
  }
  const y = DSP.bandpass(x, fs, DSP.F_LOW, DSP.F_HIGH).y;
  // Amplitude of each tone: inner product with sin and cos at that frequency
  const amp = f => {
    let s = 0, c = 0;
    for (let i = 2000; i < 14000; i++) {
      s += y[i] * Math.sin(2 * Math.PI * f * i / fs);
      c += y[i] * Math.cos(2 * Math.PI * f * i / fs);
    }
    return 2 * Math.hypot(s, c) / 12000;
  };
  check('Bandpass keeps 1000 Hz', Math.abs(amp(1000) - 1) < 0.02, 'amp ' + amp(1000).toFixed(3));
  check('Bandpass removes 30 Hz', amp(30) < 0.02, 'amp ' + amp(30).toFixed(3));
  check('Bandpass removes 6000 Hz', amp(6000) < 0.02, 'amp ' + amp(6000).toFixed(3));
}

// ---- 3. Score matrix: each test recording vs each spell ----
const spellDir = path.join(__dirname, '..', 'spells');
const spells = fs.readdirSync(spellDir).filter(d => fs.statSync(path.join(spellDir, d)).isDirectory()).sort();
const refs = {};
for (const s of spells) {
  refs[s] = fs.readdirSync(path.join(spellDir, s)).filter(f => f.endsWith('.wav')).map(f => {
    const w = readWav(path.join(spellDir, s, f));
    return DSP.process(w.x, w.fs).feat;
  });
}
const audioDir = path.join(__dirname, 'audio');
const files = fs.readdirSync(audioDir).filter(f => f.endsWith('.wav')).sort();
const right = [], wrong = [];
console.log('\nScores (rho) of each test recording against each spell:');
console.log('file'.padEnd(36) + spells.map(s => s.padStart(13)).join(''));
let correctTop = 0;
const misses = [];
const rows = [];
for (const f of files) {
  const truth = f.split('__')[0];
  const w = readWav(path.join(audioDir, f));
  const cast = DSP.process(w.x, w.fs).feat;
  const sc = spells.map(s => DSP.scoreMulti(refs[s], cast).rho);
  const top = spells[sc.indexOf(Math.max(...sc))];
  if (top === truth) correctTop++;
  else misses.push(f + ' scored highest on ' + top);
  spells.forEach((s, i) => (s === truth ? right : wrong).push(sc[i]));
  rows.push({ file: f, truth, scores: sc });
  console.log(f.padEnd(36) + sc.map((v, i) => ((spells[i] === truth ? '*' : ' ') + v.toFixed(3)).padStart(13)).join(''));
}
const mean = a => a.reduce((p, q) => p + q, 0) / a.length;
console.log('\nright word: mean ' + mean(right).toFixed(3) + ', min ' + Math.min(...right).toFixed(3));
console.log('wrong word: mean ' + mean(wrong).toFixed(3) + ', max ' + Math.max(...wrong).toFixed(3));
misses.forEach(m => console.log('  miss: ' + m));
// The player picks the spell, so the game never has to guess which
// word was said. 90% is checked as a sanity test.
check('Recordings score highest on their own spell (>= 90%)', correctTop >= 0.9 * files.length, correctTop + '/' + files.length);
check('Right word scores above the fizzle threshold on average', mean(right) > DSP.RHO_FAIL, mean(right).toFixed(3));
check('Wrong word averages below the right word by > 0.2', mean(right) - mean(wrong) > 0.2, (mean(right) - mean(wrong)).toFixed(3));

// ---- 4. Noise ----
function addNoise(x, snrDb, seed) {
  let s = seed, p = 0;
  for (let i = 0; i < x.length; i++) p += x[i] * x[i];
  p /= x.length;
  const sd = Math.sqrt(p / 10 ** (snrDb / 10)), y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    // Random noise, from a fixed seed so every run gives the same numbers
    s = (s * 1664525 + 1013904223) % 4294967296; const u1 = (s + 1) / 4294967297;
    s = (s * 1664525 + 1013904223) % 4294967296; const u2 = (s + 1) / 4294967297;
    y[i] = x[i] + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  return y;
}
console.log('\nNoise test (held-out flite kal voice, rho for the right spell):');
const noise = [];
for (const snr of [30, 20, 10, 5]) {
  const vals = [];
  for (const s of spells) {
    const w = readWav(path.join(audioDir, s + '__kal.wav'));
    // Add 0.5 s of silence on each side, so there is noise with no voice
    const pad = new Float64Array(w.x.length + w.fs);
    pad.set(w.x, Math.floor(w.fs / 2));
    vals.push(DSP.scoreMulti(refs[s], DSP.process(addNoise(pad, snr, 7), w.fs).feat).rho);
  }
  noise.push({ snr, mean: mean(vals) });
  console.log('  SNR ' + String(snr).padStart(2) + ' dB: mean rho ' + mean(vals).toFixed(3));
}

// ---- 5. Word said twice in one recording ----
{
  const w = readWav(path.join(audioDir, 'fireball__esm3fast.wav'));
  const gap = Math.floor(0.6 * w.fs), y = new Float64Array(gap * 3 + w.x.length * 2);
  y.set(w.x, gap); y.set(w.x.map(v => 0.8 * v), gap * 2 + w.x.length);
  const once = DSP.scoreMulti(refs.fireball, DSP.process(w.x, w.fs).feat).rho;
  const twice = DSP.scoreMulti(refs.fireball, DSP.process(y, w.fs).feat).rho;
  check('Saying the word twice scores like saying it once', Math.abs(once - twice) < 0.05,
    'once ' + once.toFixed(3) + ', twice ' + twice.toFixed(3));
}

fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ spells, rows, noise }, null, 1));
console.log(fails ? '\n' + fails + ' check(s) failed' : '\nAll checks passed');
process.exit(fails ? 1 : 0);
