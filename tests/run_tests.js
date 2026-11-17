// Tests for js/dsp.js. Run with: node tests/run_tests.js
// 1. FFT matches the DFT sum computed directly (N^2 way)
// 2. Bandpass keeps a tone inside 80 Hz to 7 kHz, removes tones outside
// 3. Test recordings score highest on the spell that was said
// 4. Scores with and without frequency scaling
// 5. Scores as background noise gets louder
// 6. Saying the word twice scores the same as saying it once
// Real recordings in tests/real are scored too, if there are any
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
    x[i] = Math.sin(2 * Math.PI * 30 * t) + Math.sin(2 * Math.PI * 1000 * t) + Math.sin(2 * Math.PI * 7500 * t);
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
  check('Bandpass removes 7500 Hz', amp(7500) < 0.02, 'amp ' + amp(7500).toFixed(3));
}

// ---- 3. Score matrix: each test recording vs each spell ----
// Reference recordings are listed in spells/references.json
const spellDir = path.join(__dirname, '..', 'spells');
const list = JSON.parse(fs.readFileSync(path.join(spellDir, 'references.json'), 'utf8'));
const spells = Object.keys(list).sort();
const refs = {};
for (const s of spells) {
  refs[s] = list[s].map(r => {
    const w = readWav(path.join(spellDir, s, r.file));
    return DSP.process(w.x, w.fs).feat;
  });
}
const mean = a => a.reduce((p, q) => p + q, 0) / a.length;

// Test recordings are named <spell>__<speaker>.wav. tests/audio holds
// text-to-speech voices; tests/real holds recordings of real people.
function scoreSet(dir, label) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.wav')).sort();
  const right = [], wrong = [], rows = [], misses = [];
  let correctTop = 0;
  console.log('\n' + label + ': rho of each test recording against each spell');
  console.log('file'.padEnd(36) + spells.map(s => s.padStart(15)).join(''));
  for (const f of files) {
    const truth = f.split('__')[0];
    const w = readWav(path.join(dir, f));
    const cast = DSP.process(w.x, w.fs);
    const sc = spells.map(s => DSP.scoreMulti(refs[s], cast).rho);
    const top = spells[sc.indexOf(Math.max(...sc))];
    if (top === truth) correctTop++;
    else misses.push(f + ' scored highest on ' + top);
    spells.forEach((s, i) => (s === truth ? right : wrong).push(sc[i]));
    rows.push({ file: f, truth, scores: sc });
    console.log(f.padEnd(36) + sc.map((v, i) => ((spells[i] === truth ? '*' : ' ') + v.toFixed(3)).padStart(15)).join(''));
  }
  console.log('right word: mean ' + mean(right).toFixed(3) + ', min ' + Math.min(...right).toFixed(3));
  console.log('wrong word: mean ' + mean(wrong).toFixed(3) + ', max ' + Math.max(...wrong).toFixed(3));
  misses.forEach(m => console.log('  miss: ' + m));
  return { files, right, wrong, rows, correctTop };
}

const audioDir = path.join(__dirname, 'audio');
const tts = scoreSet(audioDir, 'Text-to-speech voices');
// The player picks the spell, so the game never has to guess which
// word was said. 90% is checked as a sanity test.
check('Recordings score highest on their own spell (>= 90%)', tts.correctTop >= 0.9 * tts.files.length, tts.correctTop + '/' + tts.files.length);
check('Right word scores above the fizzle threshold on average', mean(tts.right) > DSP.RHO_FAIL, mean(tts.right).toFixed(3));
check('Wrong word averages below the right word by > 0.2', mean(tts.right) - mean(tts.wrong) > 0.2, (mean(tts.right) - mean(tts.wrong)).toFixed(3));
const rows = tts.rows;

const realDir = path.join(__dirname, 'real');
let real = null;
if (fs.existsSync(realDir) && fs.readdirSync(realDir).some(f => f.endsWith('.wav'))) {
  real = scoreSet(realDir, 'Real recordings');
} else {
  console.log('\nNo real recordings in tests/real yet');
}

// ---- 4. Frequency scaling on and off ----
// Same test recordings, scored with and without trying a = 0.85 to 1.15
const scaling = {};
for (const on of [false, true]) {
  DSP.USE_SCALING = on;
  const r = [], wr = [], low = [], high = [];
  for (const f of tts.files) {
    const truth = f.split('__')[0];
    const w = readWav(path.join(audioDir, f));
    const cast = DSP.process(w.x, w.fs);
    for (const s of spells) {
      const rho = DSP.scoreMulti(refs[s], cast).rho;
      if (s !== truth) { wr.push(rho); continue; }
      r.push(rho);
      if (f.includes('low')) low.push(rho);
      if (f.includes('high')) high.push(rho);
    }
  }
  scaling[on ? 'on' : 'off'] = { right: mean(r), wrong: mean(wr), low: mean(low), high: mean(high) };
}
DSP.USE_SCALING = true;
console.log('\nFrequency scaling (mean rho):      off     on');
for (const k of ['right', 'wrong', 'low', 'high']) {
  console.log('  ' + (k === 'low' ? 'right word, low voice' : k === 'high' ? 'right word, high voice' : k + ' word').padEnd(30)
    + scaling.off[k].toFixed(3).padStart(7) + scaling.on[k].toFixed(3).padStart(7));
}

// ---- 5. Noise ----
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
    vals.push(DSP.scoreMulti(refs[s], DSP.process(addNoise(pad, snr, 7), w.fs)).rho);
  }
  noise.push({ snr, mean: mean(vals) });
  console.log('  SNR ' + String(snr).padStart(2) + ' dB: mean rho ' + mean(vals).toFixed(3));
}

// ---- 6. Word said twice in one recording ----
{
  const w = readWav(path.join(audioDir, 'fireball__esm3fast.wav'));
  const gap = Math.floor(0.6 * w.fs), y = new Float64Array(gap * 3 + w.x.length * 2);
  y.set(w.x, gap); y.set(w.x.map(v => 0.8 * v), gap * 2 + w.x.length);
  const once = DSP.scoreMulti(refs.fireball, DSP.process(w.x, w.fs)).rho;
  const twice = DSP.scoreMulti(refs.fireball, DSP.process(y, w.fs)).rho;
  check('Saying the word twice scores like saying it once', Math.abs(once - twice) < 0.05,
    'once ' + once.toFixed(3) + ', twice ' + twice.toFixed(3));
}

fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ spells, rows, noise, scaling, real: real && real.rows }, null, 1));
console.log(fails ? '\n' + fails + ' check(s) failed' : '\nAll checks passed');
process.exit(fails ? 1 : 0);
