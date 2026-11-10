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

  const PAD = { l: 44, r: 10, t: 22, b: 30 };

  function axes(ctx, w, h, o) {
    const x0 = PAD.l, y0 = h - PAD.b, x1 = w - PAD.r, y1 = PAD.t;
    ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
    ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui, sans-serif';
    // Grid and tick labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= o.xTicks; i++) {
      const v = o.xmin + (o.xmax - o.xmin) * i / o.xTicks;
      const px = x0 + (x1 - x0) * i / o.xTicks;
      ctx.beginPath(); ctx.moveTo(px, y1); ctx.lineTo(px, y0); ctx.stroke();
      ctx.fillText(o.xFmt(v), px, y0 + 4);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= o.yTicks; i++) {
      const v = o.ymin + (o.ymax - o.ymin) * i / o.yTicks;
      const py = y0 - (y0 - y1) * i / o.yTicks;
      ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
      ctx.fillText(o.yFmt(v), x0 - 4, py);
    }
    // Axis labels and title
    ctx.fillStyle = css('--text'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText(o.title, x0, 3);
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = css('--muted');
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(o.xlabel, x1, h - 1);
    return { x0, y0, x1, y1 };
  }

  // series: [{x:[], y:[], color, label}]
  Charts.line = function (canvas, series, o) {
    const { ctx, w, h } = setup(canvas);
    const A = axes(ctx, w, h, o);
    const X = v => A.x0 + (A.x1 - A.x0) * (v - o.xmin) / (o.xmax - o.xmin);
    const Y = v => A.y0 - (A.y0 - A.y1) * (Math.max(o.ymin, Math.min(o.ymax, v)) - o.ymin) / (o.ymax - o.ymin);
    series.forEach((s, si) => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.5;
      ctx.setLineDash(s.dash ? [5, 4] : []); ctx.beginPath();
      let started = false;
      for (let i = 0; i < s.x.length; i++) {
        if (s.x[i] < o.xmin || s.x[i] > o.xmax) continue;
        const px = X(s.x[i]), py = Y(s.y[i]);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Legend
      if (s.label && s.inline) {
        ctx.fillStyle = s.color; ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(s.label, A.x0 + 4, Y(s.y[0]) - 2);
      } else if (s.label) {
        ctx.fillStyle = s.color; ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        if (o.legendBottom) {
          ctx.textBaseline = 'bottom';
          ctx.fillText(s.label, A.x1 - 2, A.y0 - 2 - (series.length - 1 - si) * 14);
        } else ctx.fillText(s.label, A.x1 - 2, A.y1 + 2 + si * 14);
      }
    });
    if (o.marker) {
      const px = X(o.marker.x), py = Y(o.marker.y);
      ctx.fillStyle = o.marker.color; ctx.beginPath(); ctx.arc(px, py, 4, 0, 2 * Math.PI); ctx.fill();
      ctx.font = '600 11px system-ui, sans-serif'; ctx.textBaseline = 'bottom';
      const right = px > (A.x0 + A.x1) / 2;
      ctx.textAlign = right ? 'right' : 'left';
      ctx.fillText(o.marker.label, right ? px - 6 : px + 6, py - 4);
    }
    if (o.vbands) {
      o.vbands.forEach(b => {
        ctx.fillStyle = b.color;
        ctx.fillRect(X(b.from), A.y1, X(b.to) - X(b.from), A.y0 - A.y1);
      });
    }
  };

  // Short ffts over time: 20log10|S| for each piece. Time on x,
  // frequency on y, brighter = stronger.
  Charts.spectrogram = function (canvas, spec, binHz, frameSec, title) {
    const { ctx, w, h } = setup(canvas);
    const nF = spec.length, nB = spec[0].length;
    const fmax = (nB - 1) * binHz, tmax = nF * frameSec;
    const A = axes(ctx, w, h, {
      xmin: 0, xmax: tmax, ymin: 0, ymax: fmax / 1000, xTicks: 4, yTicks: 4,
      xFmt: v => v.toFixed(1), yFmt: v => v.toFixed(0), title, xlabel: 'time (s)'
    });
    let mx = -Infinity;
    for (const r of spec) for (const v of r) mx = Math.max(mx, v);
    const lo = mx - 60;  // show |S| down to 1/1000 of the largest
    const img = ctx.createImageData(Math.max(1, Math.round(A.x1 - A.x0)), Math.max(1, Math.round(A.y0 - A.y1)));
    const W = img.width, Hh = img.height;
    for (let px = 0; px < W; px++) {
      const f = Math.min(nF - 1, Math.floor(px * nF / W));
      for (let py = 0; py < Hh; py++) {
        const b = Math.min(nB - 1, Math.floor((Hh - 1 - py) * nB / Hh));
        const v = Math.max(0, Math.min(1, (spec[f][b] - lo) / 60));
        const c = Charts.colormap(v), i = 4 * (py * W + px);
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      }
    }
    // putImageData ignores the transform, so place it in device pixels
    const dpr = window.devicePixelRatio || 1;
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = Hh; tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.drawImage(tmp, A.x0, A.y1, A.x1 - A.x0, A.y0 - A.y1);
    ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui, sans-serif';
    ctx.save(); ctx.translate(10, (A.y0 + A.y1) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('kHz', 0, 0); ctx.restore();
    void dpr;
  };

  // Dark purple -> magenta -> orange -> pale yellow
  Charts.colormap = function (v) {
    const stops = [[12, 7, 30], [84, 24, 110], [180, 46, 120], [240, 110, 60], [252, 230, 150]];
    const s = v * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(s)), d = s - i;
    return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * d));
  };

  root.Charts = Charts;
})(window);
