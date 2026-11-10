// Small canvas plotting helpers for the analysis panel.
(function (root) {
  'use strict';
  const Charts = {};

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // Size the canvas for the screen's pixel density
  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  // Margins around the plot area: room for the title on top, tick
  // labels and the axis label below, and the y labels on the left
  const PAD = { l: 58, r: 18, t: 36, b: 48 };

  // Evenly spaced tick values with a round step (1, 2, or 5 x 10^k)
  function niceTicks(min, max, target) {
    const raw = (max - min) / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag, step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
    const ticks = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(10));
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    return { ticks, fmt: v => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(dec) };
  }

  function axes(ctx, w, h, o) {
    const x0 = PAD.l, y0 = h - PAD.b, x1 = w - PAD.r, y1 = PAD.t;
    const X = v => x0 + (x1 - x0) * (v - o.xmin) / (o.xmax - o.xmin);
    const Y = v => y0 - (y0 - y1) * (v - o.ymin) / (o.ymax - o.ymin);
    const xt = niceTicks(o.xmin, o.xmax, o.xTicks || 6);
    const yt = niceTicks(o.ymin, o.ymax, o.yTicks || 5);
    ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
    ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui, sans-serif';
    // Grid lines and tick labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of xt.ticks) {
      const px = X(v);
      ctx.beginPath(); ctx.moveTo(px, y1); ctx.lineTo(px, y0); ctx.stroke();
      ctx.fillText(xt.fmt(v), px, y0 + 6);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of yt.ticks) {
      const py = Y(v);
      ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
      ctx.fillText(yt.fmt(v), x0 - 6, py);
    }
    // Title above the plot, axis labels centered on their axes
    ctx.fillStyle = css('--text'); ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(o.title, 12, 10);
    ctx.fillStyle = css('--muted'); ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(o.xlabel, (x0 + x1) / 2, h - 8);
    if (o.ylabel) {
      ctx.save(); ctx.translate(14, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'middle'; ctx.fillText(o.ylabel, 0, 0); ctx.restore();
    }
    return { x0, y0, x1, y1, X, Y };
  }

  // series: [{x:[], y:[], color, label, dash, inline}]
  Charts.line = function (canvas, series, o) {
    const { ctx, w, h } = setup(canvas);
    const A = axes(ctx, w, h, o);
    const Y = v => A.Y(Math.max(o.ymin, Math.min(o.ymax, v)));
    if (o.vbands) {
      o.vbands.forEach(b => {
        ctx.fillStyle = b.color;
        ctx.fillRect(A.X(b.from), A.y1, A.X(b.to) - A.X(b.from), A.y0 - A.y1);
      });
    }
    let legendRow = 0;
    series.forEach(s => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.5;
      ctx.setLineDash(s.dash ? [5, 4] : []); ctx.beginPath();
      let started = false;
      for (let i = 0; i < s.x.length; i++) {
        if (s.x[i] < o.xmin || s.x[i] > o.xmax) continue;
        const px = A.X(s.x[i]), py = Y(s.y[i]);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (!s.label) return;
      ctx.fillStyle = s.color; ctx.font = '11px system-ui, sans-serif';
      if (s.inline) {
        // Label sits just above its line, at the left edge
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(s.label, A.x0 + 6, Y(s.y[0]) - 3);
      } else {
        // Legend in the top right corner of the plot
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText(s.label, A.x1 - 6, A.y1 + 6 + 15 * legendRow++);
      }
    });
    if (o.marker) {
      const px = A.X(o.marker.x), py = Y(o.marker.y);
      ctx.fillStyle = o.marker.color; ctx.beginPath(); ctx.arc(px, py, 4, 0, 2 * Math.PI); ctx.fill();
      ctx.font = '600 12px system-ui, sans-serif';
      const right = px > (A.x0 + A.x1) / 2;
      ctx.textAlign = right ? 'right' : 'left';
      // Put the label below the point if there is no room above it
      const below = py - 20 < A.y1;
      ctx.textBaseline = below ? 'top' : 'bottom';
      ctx.fillText(o.marker.label, right ? px - 8 : px + 8, below ? py + 6 : py - 6);
    }
  };

  // Short ffts over time: 20log10|S| for each piece. Time on x,
  // frequency on y, brighter = stronger.
  Charts.spectrogram = function (canvas, spec, binHz, frameSec, title) {
    const { ctx, w, h } = setup(canvas);
    const nF = spec.length, nB = spec[0].length;
    const fmax = (nB - 1) * binHz, tmax = nF * frameSec;
    const A = axes(ctx, w, h, {
      xmin: 0, xmax: tmax, ymin: 0, ymax: fmax / 1000, xTicks: 5, yTicks: 4,
      title, xlabel: 'time (s)', ylabel: 'frequency (kHz)'
    });
    let mx = -Infinity;
    for (const r of spec) for (const v of r) mx = Math.max(mx, v);
    const lo = mx - 60;  // show |S| down to 1/1000 of the largest
    const W = Math.max(1, Math.round(A.x1 - A.x0)), Hh = Math.max(1, Math.round(A.y0 - A.y1));
    const img = ctx.createImageData(W, Hh);
    for (let px = 0; px < W; px++) {
      const f = Math.min(nF - 1, Math.floor(px * nF / W));
      for (let py = 0; py < Hh; py++) {
        const b = Math.min(nB - 1, Math.floor((Hh - 1 - py) * nB / Hh));
        const v = Math.max(0, Math.min(1, (spec[f][b] - lo) / 60));
        const c = Charts.colormap(v), i = 4 * (py * W + px);
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      }
    }
    // putImageData ignores the canvas scaling, so draw through a
    // second canvas to place the picture inside the axes
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = Hh; tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.drawImage(tmp, A.x0, A.y1, A.x1 - A.x0, A.y0 - A.y1);
  };

  // Dark purple -> magenta -> orange -> pale yellow
  Charts.colormap = function (v) {
    const stops = [[12, 7, 30], [84, 24, 110], [180, 46, 120], [240, 110, 60], [252, 230, 150]];
    const s = v * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(s)), d = s - i;
    return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * d));
  };

  root.Charts = Charts;
})(window);
