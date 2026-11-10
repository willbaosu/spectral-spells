// Signal processing for Spectral Spells: FFT, filtering in frequency,
// resampling, noise removal, and correlation.
// Runs in the browser (window.DSP) and in Node (require).
(function (root) {
  'use strict';
  const DSP = {};

  DSP.FS = 16000;           // sampling rate 1/Δt (Hz)
  DSP.F_LOW = 80;           // bandpass f_low (Hz)
  DSP.F_HIGH = 7000;        // bandpass f_high (Hz); keeps hissing sounds like f, s, sh
  DSP.FRAME = 512;          // N per short fft: 32 ms, Δf = 1/(NΔt) = 31.25 Hz
  DSP.HOP = 160;            // step between short ffts: 10 ms
  DSP.N_BANDS = 24;         // frequency bands per short fft

  // ---------- FFT ----------

  // FFT: computes the DFT S_n = Σ x_k e^(-j2πkn/N) using
  // (N/2)log2(N) complex multiplies instead of N^2. N must be a
  // power of 2. inverse = true gives the IDFT, x_n = (1/N) Σ S_k e^(+j2πkn/N).
  DSP.fft = function (re, im, inverse) {
    const N = re.length;
    // Reorder the samples so pairs can be combined
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    // log2(N) stages, each with N/2 complex multiplies
    const sign = inverse ? 1 : -1;
    for (let len = 2; len <= N; len <<= 1) {
      const ang = sign * 2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci;
          const xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; }
    }
  };

  DSP.nextPow2 = function (n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  };

  // Frequency of point k in fft order: 0, Δf, 2Δf, ... up to 1/(2Δt),
  // then the negative frequencies wrapped to the end
  DSP.binFreq = function (k, N, fs) {
    return (k <= N / 2 ? k : k - N) * fs / N;
  };

  // ---------- Bandpass filter ----------

  // Filtering with the FFT: fft -> multiply by H(s) -> inverse fft.
  // H(s) = rect(s/2f_high) - rect(s/2f_low). H depends only on |s|,
  // so the +nΔf and -nΔf points are kept together and the result is
  // real. A sharp rect in frequency is a sinc in time, which ripples,
  // so the edges of H are rounded off over 40 Hz.
  DSP.bandpass = function (x, fs, fLow, fHigh, taper) {
    taper = taper || 40;
    const N = DSP.nextPow2(x.length);
    const re = new Float64Array(N), im = new Float64Array(N);
    re.set(x);
    DSP.fft(re, im, false);
    const before = DSP.magSpectrum(re, im, fs);
    for (let k = 0; k < N; k++) {
      const f = Math.abs(DSP.binFreq(k, N, fs));
      let H;
      if (f < fLow - taper || f > fHigh + taper) H = 0;
      else if (f >= fLow && f <= fHigh) H = 1;
      else if (f < fLow) H = 0.5 - 0.5 * Math.cos(Math.PI * (f - fLow + taper) / taper);
      else H = 0.5 + 0.5 * Math.cos(Math.PI * (f - fHigh) / taper);
      re[k] *= H; im[k] *= H;
    }
    const after = DSP.magSpectrum(re, im, fs);
    DSP.fft(re, im, true);
    return { y: Float64Array.from(re.subarray(0, x.length)), before, after };
  };

  // |S(f)| for f >= 0, reduced to 400 points for plotting
  DSP.magSpectrum = function (re, im, fs) {
    const N = re.length, half = N / 2, pts = Math.min(400, half);
    const f = new Float64Array(pts), mag = new Float64Array(pts);
    const step = half / pts;
    for (let p = 0; p < pts; p++) {
      let m = 0;
      const k0 = Math.floor(p * step), k1 = Math.floor((p + 1) * step);
      for (let k = k0; k < Math.max(k1, k0 + 1); k++) {
        m = Math.max(m, Math.hypot(re[k], im[k]));
      }
      f[p] = k0 * fs / N; mag[p] = m;
    }
    return { f, mag };
  };

  // ---------- Resampling ----------

  // Linear interpolation: f(x1 + Δ) = f(x1)(1 - Δ/(x2 - x1)) + f(x2)Δ/(x2 - x1).
  // Done after the bandpass: nothing is left above 7 kHz, so the new
  // rate 1/Δt = 16 kHz >= 2 · 7 kHz and there is no aliasing.
  DSP.resample = function (x, fsIn, fsOut) {
    if (fsIn === fsOut) return Float64Array.from(x);
    const n = Math.floor(x.length * fsOut / fsIn);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = i * fsIn / fsOut;
      const i0 = Math.floor(t), d = t - i0;
      const a = x[i0], b = i0 + 1 < x.length ? x[i0 + 1] : a;
      y[i] = a * (1 - d) + b * d;
    }
    return y;
  };

  // ---------- Noise removal ----------

  // Cut the signal into short pieces and fft each one. The quietest
  // 10% of pieces are taken as background noise; their average |S|^2
  // at each frequency is the noise level. Each piece is multiplied by
  //   G(f) = max(1 - ALPHA · noise(f) / |S(f)|^2, FLOOR)
  // (near 1 where the voice is much louder than the noise, near 0
  // where noise dominates), inverse fft'd, and added back in place.
  // Each piece is tapered to 0 at its ends and pieces overlap by half,
  // so the tapers add up to 1.
  DSP.USE_DENOISE = true;
  DSP.NR_ALPHA = 2;
  DSP.NR_FLOOR = 0.05;
  DSP.denoise = function (x, fs) {
    const N = 512, H = N / 2;
    const nF = Math.floor((x.length - N) / H) + 1;
    if (nF < 10) return { y: x, noise: null };
    const win = new Float64Array(N);
    for (let n = 0; n < N; n++) win[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N);
    const frames = [], energy = [];
    for (let f = 0; f < nF; f++) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let n = 0; n < N; n++) re[n] = x[f * H + n] * win[n];
      DSP.fft(re, im, false);
      let e = 0;
      for (let k = 0; k < N; k++) e += re[k] * re[k] + im[k] * im[k];
      frames.push({ re, im }); energy.push(e);
    }
    const order = energy.map((e, i) => i).sort((a, b) => energy[a] - energy[b]);
    const nq = Math.max(3, Math.floor(0.1 * nF));
    const noise = new Float64Array(N);
    for (let q = 0; q < nq; q++) {
      const { re, im } = frames[order[q]];
      for (let k = 0; k < N; k++) noise[k] += (re[k] * re[k] + im[k] * im[k]) / nq;
    }
    const y = new Float64Array(x.length);
    for (let f = 0; f < nF; f++) {
      const { re, im } = frames[f];
      for (let k = 0; k < N; k++) {
        const P = re[k] * re[k] + im[k] * im[k] + 1e-12;
        const G = Math.max(1 - DSP.NR_ALPHA * noise[k] / P, DSP.NR_FLOOR);
        re[k] *= G; im[k] *= G;
      }
      DSP.fft(re, im, true);
      for (let n = 0; n < N; n++) y[f * H + n] += re[n];
    }
    return { y, noise };
  };

  // ---------- Find the word ----------

  // Energy ∫|x|^2 dt of each 20 ms piece; keep the loudest stretch of
  // speech, plus 40 ms on each side
  DSP.trimSilence = function (x, fs) {
    const L = Math.round(0.02 * fs);
    const nF = Math.floor(x.length / L);
    const e = new Float64Array(nF);
    let eMax = 0;
    for (let i = 0; i < nF; i++) {
      let s = 0;
      for (let k = 0; k < L; k++) s += x[i * L + k] ** 2;
      e[i] = s; eMax = Math.max(eMax, s);
    }
    if (eMax === 0) return x;
    // Loud: energy above 1/1000 of the largest piece and 4x the
    // background (the quietest 10% of pieces)
    const sorted = Array.from(e).sort((p, q) => p - q);
    const floor = sorted[Math.floor(0.1 * (nF - 1))];
    const thr = Math.max(eMax * 1e-3, floor * 4);
    // Gaps under 300 ms count as the same word. Only the stretch with
    // the most energy is kept, so a repeated word or a cough is dropped.
    const GAP = Math.round(0.3 / 0.02);
    let best = null, cur = null, quiet = 0;
    for (let i = 0; i < nF; i++) {
      if (e[i] >= thr) {
        if (cur && quiet <= GAP) { cur.b = i; cur.E += e[i]; }
        else { cur = { a: i, b: i, E: e[i] }; }
        quiet = 0;
        if (!best || cur.E > best.E) best = cur;
      } else quiet++;
    }
    if (!best) return x;
    const a = best.a, b = best.b;
    const pad = Math.round(0.04 * fs);
    const s0 = Math.max(0, a * L - pad);
    const s1 = Math.min(x.length, (b + 1) * L + pad);
    return x.subarray(s0, s1);
  };

  // Scale so the largest |x| is 1
  DSP.normalize = function (x) {
    let p = 0;
    for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
    const y = new Float64Array(x.length);
    if (p > 0) for (let i = 0; i < x.length; i++) y[i] = x[i] / p;
    return y;
  };

  // ---------- Frequency content over time ----------

  // Band edges from 100 Hz to f_high, each band a fixed ratio wider
  // than the last. Each band covers several harmonics of the voice's
  // base frequency, so a high and a low voice look alike.
  DSP.bandEdges = function () {
    const e = [];
    const lo = Math.log(Math.max(DSP.F_LOW, 100)), hi = Math.log(DSP.F_HIGH);
    for (let b = 0; b <= DSP.N_BANDS; b++) {
      e.push(Math.exp(lo + (hi - lo) * b / DSP.N_BANDS));
    }
    return e;
  };

  // Short ffts: an fft of each 32 ms piece, every 10 ms, so each row
  // shows which frequencies are present at that moment. Each piece is
  // tapered to 0 at its ends first, so the cut edges do not add false
  // high frequencies. Returns:
  //   feat:  cosine coefficients per piece (used for scoring)
  //   bands: log of the energy in each band
  //   spec:  20log10|S| up to f_high (for plots)
  DSP.features = function (x, fs) {
    const N = DSP.FRAME, H = DSP.HOP;
    const nF = Math.max(1, Math.floor((x.length - N) / H) + 1);
    const win = new Float64Array(N);
    for (let n = 0; n < N; n++) win[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1));
    const edges = DSP.bandEdges();
    const kMax = Math.floor(DSP.F_HIGH * N / fs);
    const feat = [], spec = [];
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let f = 0; f < nF; f++) {
      re.fill(0); im.fill(0);
      for (let n = 0; n < N; n++) {
        const v = x[f * H + n];
        re[n] = (v === undefined ? 0 : v) * win[n];
      }
      DSP.fft(re, im, false);
      const P = new Float64Array(kMax + 1);
      const row = new Float64Array(kMax + 1);
      for (let k = 0; k <= kMax; k++) {
        P[k] = re[k] * re[k] + im[k] * im[k];
        row[k] = 10 * Math.log10(P[k] + 1e-10);
      }
      spec.push(row);
      const bands = new Float64Array(DSP.N_BANDS);
      for (let b = 0; b < DSP.N_BANDS; b++) {
        const k0 = Math.floor(edges[b] * N / fs);
        const k1 = Math.max(k0 + 1, Math.floor(edges[b + 1] * N / fs));
        let s = 0;
        for (let k = k0; k < k1 && k <= kMax; k++) s += P[k];
        bands[b] = Math.log10(s + 1e-6);
      }
      feat.push(bands);
    }
    const cep = DSP.removeMean(DSP.cepstrum(feat, DSP.N_CEP));
    return { feat: cep, bands: feat, spec, frames: nF, binHz: fs / N };
  };

  // Inner product of each piece's log band energies with cosines,
  // like Fourier series coefficients c_1..c_K. Low terms describe the
  // overall shape of the spectrum (which sound is being said). c_0,
  // the average (loudness), is skipped, and the higher terms, which
  // hold fine detail like pitch, are dropped.
  DSP.N_CEP = 8;
  DSP.cepstrum = function (bands, K) {
    const B = bands[0].length;
    return bands.map(row => {
      const c = new Float64Array(K);
      for (let k = 1; k <= K; k++) {
        let s = 0;
        for (let b = 0; b < B; b++) s += row[b] * Math.cos(Math.PI * k * (b + 0.5) / B);
        c[k - 1] = s;
      }
      return c;
    });
  };

  // Subtract each coefficient's average over the word, which removes
  // anything that stays constant, like the microphone's sound
  DSP.removeMean = function (F) {
    const K = F[0].length, n = F.length, m = new Float64Array(K);
    for (const row of F) for (let k = 0; k < K; k++) m[k] += row[k] / n;
    return F.map(row => row.map((v, k) => v - m[k]));
  };

  // Stretch or squeeze in time to newLen pieces by linear
  // interpolation, for faster or slower speech
  DSP.stretch = function (feat, newLen) {
    const L = feat.length, B = feat[0].length, out = [];
    for (let i = 0; i < newLen; i++) {
      const t = newLen === 1 ? 0 : i * (L - 1) / (newLen - 1);
      const i0 = Math.floor(t), d = t - i0, i1 = Math.min(i0 + 1, L - 1);
      const row = new Float64Array(B);
      for (let b = 0; b < B; b++) row[b] = feat[i0][b] * (1 - d) + feat[i1][b] * d;
      out.push(row);
    }
    return out;
  };

  // ---------- Correlation and scoring ----------

  // Correlation at one shift, divided by the energies:
  //   rho(lag) = Σ A[t+lag] B[t] / sqrt(Σ A^2 · Σ B^2)
  // over the pieces that overlap. rho = 1 means the same shape;
  // speaking louder or softer does not change it.
  DSP.normCorr = function (A, Bm, lag) {
    let ab = 0, aa = 0, bb = 0, n = 0;
    for (let t = 0; t < Bm.length; t++) {
      const ta = t + lag;
      if (ta < 0 || ta >= A.length) continue;
      const a = A[ta], b = Bm[t];
      for (let k = 0; k < a.length; k++) {
        ab += a[k] * b[k]; aa += a[k] * a[k]; bb += b[k] * b[k];
      }
      n++;
    }
    if (aa === 0 || bb === 0) return { rho: 0, overlap: n };
    return { rho: ab / Math.sqrt(aa * bb), overlap: n };
  };

  // Slide like a correlation: try every shift up to ±150 ms and
  // stretches from 80% to 125%; the score is the peak rho
  DSP.STRETCHES = [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25];
  DSP.MAX_LAG = 15;  // frames

  DSP.score = function (refFeat, castFeat) {
    const R = refFeat.length;
    let best = { rho: -1, stretch: 1, lag: 0, curve: null };
    for (const s of DSP.STRETCHES) {
      const C = DSP.stretch(castFeat, Math.max(2, Math.round(R * s)));
      const curve = [];
      for (let lag = -DSP.MAX_LAG; lag <= DSP.MAX_LAG; lag++) {
        const r = DSP.normCorr(refFeat, C, lag);
        // Count only shifts that cover at least 70% of the word
        const rho = r.overlap >= 0.7 * Math.min(R, C.length) ? r.rho : 0;
        curve.push({ lag, rho });
        if (rho > best.rho) best = { rho, stretch: s, lag, curve: null, _curve: curve };
      }
      if (best._curve === curve) best.curve = curve;
    }
    delete best._curve;
    return best;
  };

  // Best peak rho over the four reference voices
  DSP.scoreMulti = function (refFeats, castFeat) {
    let best = null;
    refFeats.forEach((r, i) => {
      const s = DSP.score(r, castFeat);
      if (!best || s.rho > best.rho) { best = s; best.ref = i; }
    });
    return best;
  };

  // Spell power 0 to 1: 0 below RHO_FAIL, 1 at RHO_FULL, linear between.
  // In tests the right word averaged 0.77 and a wrong word 0.46.
  DSP.RHO_FAIL = 0.5;
  DSP.RHO_FULL = 0.8;
  DSP.effectiveness = function (rho) {
    const e = (rho - DSP.RHO_FAIL) / (DSP.RHO_FULL - DSP.RHO_FAIL);
    return Math.max(0, Math.min(1, e));
  };

  // ---------- Full pipeline ----------

  // bandpass -> resample to 16 kHz -> remove noise -> find the word ->
  // scale -> short ffts and coefficients
  DSP.process = function (samples, fs) {
    const bp = DSP.bandpass(samples, fs, DSP.F_LOW, DSP.F_HIGH);
    const r = DSP.resample(bp.y, fs, DSP.FS);
    const d = DSP.USE_DENOISE ? DSP.denoise(r, DSP.FS).y : r;
    const t = DSP.trimSilence(d, DSP.FS);
    const x = DSP.normalize(t);
    const F = DSP.features(x, DSP.FS);
    return {
      raw: samples, filtered: x, fsIn: fs,
      spectrumBefore: bp.before, spectrumAfter: bp.after,
      feat: F.feat, spec: F.spec, binHz: F.binHz,
      duration: x.length / DSP.FS
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DSP;
  else root.DSP = DSP;
})(typeof window !== 'undefined' ? window : this);
