// Tests for js/dsp.js. Run with: node tests/run_tests.js
// 1. FFT matches the DFT sum computed directly (N^2 way)
// 2. Bandpass keeps a tone inside 80 Hz to 7 kHz, removes tones outside
// 3. Test recordings score highest on the spell that was said
// 4. Scores with and without frequency scaling
// 5. Scores as background noise gets louder
// 6. Saying the word twice scores the same as saying it once
// Test recordings are in tests/audio (text-to-speech) and tests/real
// (real voices), named <spell>__<speaker>.wav. The results are saved
// to tests/results.json for report_figures.m.
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
const names = { fireball: 'Fireball', focus: 'Focus', lightning_bolt: 'Lightning Bolt', shield: 'Shield' };
const refs = {};
for (const s of spells) {
  refs[s] = list[s].map(r => {
    const w = readWav(path.join(spellDir, s, r.file));
    return DSP.process(w.x, w.fs).feat;
  });
}
const mean = a => a.reduce((p, q) => p + q, 0) / a.length;
const round = v => Math.round(v * 1000) / 1000;

function loadSet(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.wav')).sort().map(f => {
    const w = readWav(path.join(dir, f));
    return { file: f, truth: f.split('__')[0], w };
  });
}

// Score each recording against each spell, and average the scores
// for the right word and the wrong words
function scoreSet(set, label) {
  const rows = [];
  let top = 0;
  for (const r of set) {
    const cast = DSP.process(r.w.x, r.w.fs);
    const sc = spells.map(s => DSP.scoreMulti(refs[s], cast).rho);
    if (spells[sc.indexOf(Math.max(...sc))] === r.truth) top++;
    rows.push({ file: r.file, truth: r.truth, scores: sc.map(round) });
  }
  const per = spells.map((s, i) => {
    const right = rows.filter(r => r.truth === s).map(r => r.scores[i]);
    const wrong = rows.filter(r => r.truth !== s).map(r => r.scores[i]);
    return { spell: s, right_mean: round(mean(right)), right_min: round(Math.min(...right)),
      wrong_mean: round(mean(wrong)) };
  });
  const right = rows.map(r => r.scores[spells.indexOf(r.truth)]);
  const wrong = rows.flatMap(r => r.scores.filter((v, i) => spells[i] !== r.truth));
  if (label) {
    console.log('\n' + label + ': rho of each test recording against each spell');
    console.log('file'.padEnd(36) + spells.map(s => s.padStart(15)).join(''));
    for (const r of rows) {
      console.log(r.file.padEnd(36) + r.scores.map((v, i) =>
        ((spells[i] === r.truth ? '*' : ' ') + v.toFixed(3)).padStart(15)).join(''));
    }
    console.log('right word: mean ' + mean(right).toFixed(3) + ', min ' + Math.min(...right).toFixed(3));
    console.log('wrong word: mean ' + mean(wrong).toFixed(3) + ', max ' + Math.max(...wrong).toFixed(3));
    console.log('highest score on the spell said: ' + top + '/' + rows.length);
  }
  return { rows, per, top, n: rows.length, right: round(mean(right)), wrong: round(mean(wrong)) };
}

const tts = loadSet(path.join(__dirname, 'audio'));
const real = loadSet(path.join(__dirname, 'real'));
const ttsRes = scoreSet(tts, 'Text-to-speech voices');
// At least 90% should score highest on the spell that was said
check('Recordings score highest on their own spell (>= 90%)', ttsRes.top >= 0.9 * ttsRes.n, ttsRes.top + '/' + ttsRes.n);
check('Right word scores above the fizzle threshold on average', ttsRes.right > DSP.RHO_FAIL, ttsRes.right.toFixed(3));
check('Wrong word averages below the right word by > 0.2', ttsRes.right - ttsRes.wrong > 0.2, (ttsRes.right - ttsRes.wrong).toFixed(3));
const realRes = real.length ? scoreSet(real, 'Real recordings') : null;
if (!realRes) console.log('\nNo real recordings in tests/real yet');

// ---- 4. Frequency scaling on and off ----
const scaling = {};
for (const [key, set] of [['tts', tts], ['real', real]]) {
  if (!set.length) continue;
  scaling[key] = {};
  for (const on of [false, true]) {
    DSP.USE_SCALING = on;
    const r = scoreSet(set);
    scaling[key][on ? 'on' : 'off'] = { right: r.right, wrong: r.wrong, top: r.top, n: r.n };
  }
}
DSP.USE_SCALING = true;
console.log('\nFrequency scaling (mean rho):    right off  right on  wrong off  wrong on');
for (const k of Object.keys(scaling)) {
  const v = scaling[k];
  console.log('  ' + (k === 'tts' ? 'text-to-speech' : 'real').padEnd(30)
    + [v.off.right, v.on.right, v.off.wrong, v.on.wrong].map(x => x.toFixed(3).padStart(10)).join(''));
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
// Add 0.5 s of silence on each side, then random noise. Score with
// and without noise removal.
const SNRS = [40, 30, 20, 15, 10, 5, 0];
const noise = { snr: SNRS, denoise: [], bandpass: [], wrong: [] };
console.log('\nNoise test (text-to-speech voices, mean rho):');
console.log('  SNR (dB)   right, noise removal   right, bandpass only   wrong, noise removal');
for (const snr of SNRS) {
  const res = {};
  for (const on of [true, false]) {
    DSP.USE_DENOISE = on;
    const right = [], wrong = [];
    for (const r of tts) {
      const pad = new Float64Array(r.w.x.length + r.w.fs);
      pad.set(r.w.x, Math.floor(r.w.fs / 2));
      const cast = DSP.process(addNoise(pad, snr, 7), r.w.fs);
      for (const s of spells) {
        if (s === r.truth) right.push(DSP.scoreMulti(refs[s], cast).rho);
        else if (on) wrong.push(DSP.scoreMulti(refs[s], cast).rho);
      }
    }
    res[on] = { right: mean(right), wrong: on ? mean(wrong) : null };
  }
  DSP.USE_DENOISE = true;
  noise.denoise.push(round(res[true].right));
  noise.bandpass.push(round(res[false].right));
  noise.wrong.push(round(res[true].wrong));
  console.log('  ' + String(snr).padStart(8) + res[true].right.toFixed(3).padStart(23)
    + res[false].right.toFixed(3).padStart(23) + res[true].wrong.toFixed(3).padStart(23));
}

// ---- 6. Word said twice in one recording ----
{
  const w = readWav(path.join(__dirname, 'audio', 'fireball__esm3fast.wav'));
  const gap = Math.floor(0.6 * w.fs), y = new Float64Array(gap * 3 + w.x.length * 2);
  y.set(w.x, gap); y.set(w.x.map(v => 0.8 * v), gap * 2 + w.x.length);
  const once = DSP.scoreMulti(refs.fireball, DSP.process(w.x, w.fs)).rho;
  const twice = DSP.scoreMulti(refs.fireball, DSP.process(y, w.fs)).rho;
  check('Saying the word twice scores like saying it once', Math.abs(once - twice) < 0.05,
    'once ' + once.toFixed(3) + ', twice ' + twice.toFixed(3));
}

// Numbers for the README figures (read by report_figures.m)
const results = {
  spells, names: spells.map(s => names[s] || s),
  tts: { per: ttsRes.per, right: ttsRes.right, wrong: ttsRes.wrong, top: ttsRes.top, n: ttsRes.n,
    speakers: [...new Set(tts.map(r => r.file.split('__')[1].replace('.wav', '')))].length },
  real: realRes && { per: realRes.per, right: realRes.right, wrong: realRes.wrong, top: realRes.top, n: realRes.n,
    speakers: [...new Set(real.map(r => r.file.split('__')[1].replace(/\d*\.wav$/, '')))].length },
  scaling, noise,
  rows: { tts: ttsRes.rows, real: realRes ? realRes.rows : [] }
};
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 1));
console.log(fails ? '\n' + fails + ' check(s) failed' : '\nAll checks passed');
process.exit(fails ? 1 : 0);
