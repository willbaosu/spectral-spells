// Spell effects drawn on a canvas laid over the battle area.
// Each effect returns a Promise that resolves when it hits its target,
// so the game can show damage at the right moment.
(function (root) {
  'use strict';
  const FX = {};
  let canvas, ctx, W = 0, H = 0, last = 0;
  const effects = [];
  const persistent = { aura: null, telegraph: null };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    ctx.clearRect(0, 0, W, H);
    if (persistent.aura) drawAura(persistent.aura, t / 1000);
    if (persistent.telegraph) drawTelegraph(persistent.telegraph, t / 1000);
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.age += dt;
      e.draw(e, dt);
      if (e.age >= e.life) effects.splice(i, 1);
    }
    requestAnimationFrame(loop);
  }

  function add(e) { e.age = 0; effects.push(e); return e; }
  const ease = u => 1 - Math.pow(1 - u, 2);
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- Particles ----------

  function particles(at, opts) {
    const n = opts.n || 20, ps = [];
    for (let i = 0; i < n; i++) {
      const a = rand(0, 2 * Math.PI), sp = rand(opts.speed * 0.3, opts.speed);
      ps.push({ x: at.x, y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + (opts.up || 0),
        r: rand(opts.size * 0.5, opts.size), c: opts.colors[i % opts.colors.length] });
    }
    add({
      life: opts.life || 0.7, draw(e, dt) {
        const k = 1 - e.age / e.life;
        for (const p of ps) {
          p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (opts.gravity || 0) * dt;
          ctx.globalAlpha = Math.max(0, k);
          ctx.fillStyle = p.c;
          ctx.fillRect(Math.round(p.x - p.r / 2), Math.round(p.y - p.r / 2), Math.ceil(p.r * k + 1), Math.ceil(p.r * k + 1));
        }
        ctx.globalAlpha = 1;
      }
    });
  }

  function glow(x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---------- Your spells ----------

  // Fireball: a flaming ball with a trail of embers
  FX.fireball = function (from, to, power) {
    const size = 12 + 12 * power, dur = 0.6;
    return new Promise(res => {
      const trail = [];
      add({
        life: dur, draw(e) {
          const u = ease(e.age / dur);
          const x = from.x + (to.x - from.x) * u, y = from.y + (to.y - from.y) * u - Math.sin(u * Math.PI) * 40;
          trail.push({ x, y, a: 1 });
          for (const p of trail) {
            p.a -= 0.06;
            if (p.a > 0) glow(p.x + rand(-3, 3), p.y + rand(-3, 3), size * 0.8 * p.a, '#ff7a2a', p.a * 0.7);
          }
          glow(x, y, size * 2.6, 'rgba(255,120,30,1)', 0.55);
          glow(x, y, size * 1.2, '#ffd27a', 1);
          glow(x, y, size * 0.5, '#ffffff', 1);
          if (e.age + 0.02 >= dur && !e.done) {
            e.done = true;
            particles(to, { n: 30 + 30 * power, speed: 260, size: 7, colors: ['#ffd27a', '#ff8a3c', '#ff4a2a', '#fff2c0'], life: 0.7, gravity: 300 });
            add(ring(to, '#ffb347', 70 + 40 * power, 0.35));
            res();
          }
        }
      });
    });
  };

  // Lightning: a jagged bolt from the sky onto the target, with a flash
  FX.lightning = function (to, power) {
    return new Promise(res => {
      const bolts = [0, 1, 2].map(() => boltPath({ x: to.x + rand(-40, 40), y: 0 }, to));
      add({
        life: 0.5, draw(e) {
          const k = e.age / e.life;
          if (k < 0.15) { ctx.fillStyle = `rgba(255,250,210,${0.35 * (1 - k / 0.15)})`; ctx.fillRect(0, 0, W, H); }
          const b = bolts[Math.min(2, Math.floor(k * 3))];
          ctx.globalAlpha = 1 - k * 0.8;
          ctx.strokeStyle = '#fff7b0'; ctx.lineWidth = 3 + 3 * power; ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 18;
          ctx.beginPath(); b.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
          ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
          ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        }
      });
      setTimeout(() => {
        particles(to, { n: 24 + 20 * power, speed: 300, size: 5, colors: ['#fff7b0', '#ffe14d', '#ffffff'], life: 0.5 });
        res();
      }, 90);
    });
  };

  function boltPath(a, b) {
    const pts = [a], n = 9;
    for (let i = 1; i < n; i++) {
      const u = i / n;
      pts.push({ x: a.x + (b.x - a.x) * u + rand(-22, 22), y: a.y + (b.y - a.y) * u });
    }
    pts.push(b);
    return pts;
  }

  // Focus: violet energy gathers into the wand tip
  FX.focus = function (at, power) {
    const n = 16 + 16 * power;
    const ps = Array.from({ length: n }, () => ({ a: rand(0, 2 * Math.PI), r: rand(60, 110), s: rand(2.5, 4) }));
    add({
      life: 0.6, draw(e) {
        const k = e.age / e.life;
        for (const p of ps) {
          const r = p.r * (1 - k), a = p.a + k * 3;
          ctx.fillStyle = '#e6ccff';
          ctx.fillRect(Math.round(at.x + r * Math.cos(a) - 2), Math.round(at.y + r * Math.sin(a) - 2), p.s, p.s);
        }
      }
    });
    setTimeout(() => { add(ring(at, '#c48cff', 60, 0.5)); glowFlash(at); }, 550);
    return new Promise(res => setTimeout(res, 700));
  };

  function glowFlash(at) {
    add({ life: 0.4, draw(e) { glow(at.x, at.y, 60, 'rgba(220,180,255,1)', 1 - e.age / e.life); } });
  }

  // Glow on the wand while Focus is active (null to turn off)
  FX.setAura = function (at) { persistent.aura = at; };
  // While Focus lasts: the wand tip glows violet with sparks circling it
  function drawAura(at, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    glow(at.x, at.y, 30 + 8 * pulse, 'rgba(200,150,255,1)', 0.6 + 0.3 * pulse);
    for (let i = 0; i < 4; i++) {
      const a = t * 3 + i * Math.PI / 2, r = 20 + 4 * Math.sin(t * 4 + i);
      ctx.fillStyle = i % 2 ? '#e6ccff' : '#c48cff';
      ctx.fillRect(Math.round(at.x + r * Math.cos(a) - 2), Math.round(at.y + r * Math.sin(a) * 0.7 - 2), 4, 4);
    }
  }

  // Shield: a curved barrier in front of you; stronger = brighter
  FX.shield = function (at, frac) {
    add({
      life: 0.8, draw(e) {
        const k = e.age / e.life, a = (1 - k) * (0.35 + 0.65 * frac);
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#9fe0ff'; ctx.lineWidth = 6; ctx.shadowColor = '#7cc8ff'; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(at.x + 30, at.y, 110, Math.PI * 0.72, Math.PI * 1.28); ctx.stroke();
        ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(124,200,255,0.12)';
        ctx.beginPath(); ctx.arc(at.x + 30, at.y, 110, Math.PI * 0.72, Math.PI * 1.28); ctx.lineTo(at.x + 30, at.y); ctx.fill();
        ctx.globalAlpha = 1;
      }
    });
    if (frac > 0) particles({ x: at.x - 78, y: at.y }, { n: 14 + 20 * frac, speed: 220, size: 5, colors: ['#ffffff', '#9fe0ff', '#5fdcff'], life: 0.5 });
  };

  // Fizzle: a small grey puff at the wand
  FX.fizzle = function (at) {
    particles(at, { n: 14, speed: 60, up: -40, size: 7, colors: ['#8a84a0', '#6b6582', '#b3adc6'], life: 0.8 });
    return new Promise(res => setTimeout(res, 300));
  };

  // ---------- Nerith's spells ----------

  // Pulsing water gathering at the orb while you decide how to react
  FX.setTelegraph = function (at, big) { persistent.telegraph = at ? { at, big } : null; };
  function drawTelegraph(tg, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 8), r = (tg.big ? 44 : 30) + 8 * pulse;
    glow(tg.at.x, tg.at.y, r * 2, 'rgba(95,220,255,1)', 0.5 + 0.25 * pulse);
    ctx.strokeStyle = `rgba(200,245,255,${0.5 + 0.4 * pulse})`; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = t * 3 + i * 2.1;
      ctx.beginPath(); ctx.arc(tg.at.x, tg.at.y, r * (0.6 + 0.2 * i), a, a + 1.6); ctx.stroke();
    }
  }

  // Water Jet: a stream of droplets from the orb to you
  FX.waterJet = function (from, to) {
    const dur = 0.6;
    return new Promise(res => {
      add({
        life: dur + 0.3, draw(e) {
          const head = Math.min(1, e.age / dur), tail = Math.max(0, (e.age - 0.3) / dur);
          ctx.shadowColor = '#5fdcff'; ctx.shadowBlur = 14;
          for (let i = 0; i < 40; i++) {
            const u = tail + (head - tail) * (i / 39);
            const x = from.x + (to.x - from.x) * u, y = from.y + (to.y - from.y) * u + Math.sin(u * 12 + e.age * 30) * 6;
            const s = 14 - 6 * Math.abs(i / 39 - 0.8);
            ctx.fillStyle = i % 4 ? '#5fdcff' : '#e3fbff';
            ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
          }
          ctx.shadowBlur = 0;
          if (head >= 1 && !e.done) {
            e.done = true;
            particles(to, { n: 26, speed: 220, size: 6, colors: ['#e3fbff', '#5fdcff', '#2a9fd0'], life: 0.6, gravity: 500 });
            res();
          }
        }
      });
    });
  };

  // Tidal Wave: a wave rolls across the battlefield toward you
  FX.tidalWave = function (to) {
    const dur = 0.9;
    return new Promise(res => {
      add({
        life: dur + 0.5, draw(e) {
          const u = Math.min(1, e.age / dur), fade = e.age > dur ? 1 - (e.age - dur) / 0.5 : 1;
          const front = -60 + (W + 120) * ease(u), top = H * 0.38;
          const g = ctx.createLinearGradient(0, top, 0, H);
          g.addColorStop(0, 'rgba(120,225,255,0.85)'); g.addColorStop(1, 'rgba(20,90,140,0.9)');
          ctx.globalAlpha = 0.85 * fade; ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(0, H);
          for (let x = 0; x <= front; x += 8) {
            const crest = top + 18 * Math.sin(x / 40 + e.age * 6) + (front - x < 70 ? -(70 - (front - x)) * 0.5 : 0);
            ctx.lineTo(x, crest);
          }
          ctx.lineTo(front, H); ctx.closePath(); ctx.fill();
          // Foam along the top
          ctx.fillStyle = '#ffffff';
          for (let x = 0; x <= front; x += 14) {
            const crest = top + 18 * Math.sin(x / 40 + e.age * 6) + (front - x < 70 ? -(70 - (front - x)) * 0.5 : 0);
            ctx.fillRect(Math.round(x), Math.round(crest - 3), 6, 4);
          }
          ctx.globalAlpha = 1;
          if (front >= to.x && !e.done) {
            e.done = true;
            particles(to, { n: 36, speed: 260, up: -120, size: 7, colors: ['#ffffff', '#a6f4fa', '#5fdcff'], life: 0.8, gravity: 600 });
            res();
          }
        }
      });
    });
  };

  // Healing Rain: drops fall over Nerith with rising green sparks
  FX.healingRain = function (at) {
    const drops = Array.from({ length: 70 }, () => ({ x: at.x + rand(-120, 120), y: at.y - 180 + rand(-160, 0), v: rand(380, 520) }));
    add({
      life: 1.1, draw(e, dt) {
        ctx.strokeStyle = 'rgba(190,248,255,0.95)'; ctx.lineWidth = 3;
        glow(at.x, at.y - 40, 150, 'rgba(120,255,170,0.7)', 0.25 * (1 - e.age / e.life));
        for (const d of drops) {
          d.y += d.v * dt;
          if (d.y > at.y + 110) continue;
          ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 3, d.y - 16); ctx.stroke();
        }
      }
    });
    setTimeout(() => particles(at, { n: 40, speed: 70, up: -130, size: 8, colors: ['#8dffb0', '#5fd18b', '#d6ffe2'], life: 1 }), 400);
    return new Promise(res => setTimeout(res, 700));
  };

  // Bubble Barrier: bubbles rise around Nerith
  FX.bubbles = function (at) {
    const bs = Array.from({ length: 22 }, () => ({ x: at.x + rand(-100, 100), y: at.y + rand(40, 140), r: rand(4, 12), v: rand(60, 140) }));
    add({
      life: 1.0, draw(e, dt) {
        ctx.strokeStyle = 'rgba(190,245,255,0.9)'; ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - e.age / e.life;
        for (const b of bs) {
          b.y -= b.v * dt;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 2 * Math.PI); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    });
    return new Promise(res => setTimeout(res, 500));
  };

  // Burst of bubbles when Lightning Bolt pops the barrier
  FX.pop = function (at) {
    particles(at, { n: 30, speed: 260, size: 6, colors: ['#e3fbff', '#a6f4fa', '#5fdcff'], life: 0.6 });
    add(ring(at, '#a6f4fa', 130, 0.35));
  };

  // ---------- Shared ----------

  function ring(at, color, rMax, life) {
    return {
      life, draw(e) {
        const k = e.age / e.life;
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = color; ctx.lineWidth = 4 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(at.x, at.y, rMax * ease(k), 0, 2 * Math.PI); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };
  }

  // Number or word that floats up and fades
  FX.text = function (at, text, color, big) {
    const x = at.x + rand(-12, 12);
    add({
      life: 1.2, draw(e) {
        const k = e.age / e.life;
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.font = `800 ${big ? 30 : 22}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 5; ctx.strokeStyle = '#120e24';
        const y = at.y - 50 * ease(Math.min(1, k * 1.5));
        ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
        ctx.globalAlpha = 1;
      }
    });
  };

  FX.init = function (c) {
    canvas = c; ctx = c.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    requestAnimationFrame(t => { last = t; loop(t); });
  };

  root.FX = FX;
})(window);
