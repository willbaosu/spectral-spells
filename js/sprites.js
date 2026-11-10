// Pixel-art sprites, built on a 32 x 40 grid from simple shapes and
// then outlined.
//   Boss:   Nerith the Tidecaller, a sea wizard with a coral crown,
//           seafoam beard, teal robe, and a staff with a water orb.
//   Player: a young mage in a crimson hooded cloak, facing left,
//           holding a wand.
(function (root) {
  'use strict';
  const W = 32, H = 40;

  function makeGrid() {
    const g = Array.from({ length: H }, () => Array(W).fill('.'));
    const api = {
      g,
      set(x, y, c) { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; },
      // Fill pixels whose centers fall inside an ellipse
      ellipse(cx, cy, rx, ry, fn) {
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) api.set(x, y, typeof fn === 'function' ? fn(x, y, dx, dy) : fn);
        }
      },
      rect(x0, y0, x1, y1, c) {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) api.set(x, y, c);
      }
    };
    return api;
  }

  // Dark outline around every filled shape
  function outline(g) {
    const out = g.map(r => r.slice());
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (g[y][x] !== '.') continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && g[ny][nx] !== '.') { out[y][x] = 'K'; break; }
      }
    }
    return out;
  }

  // ---------- Boss ----------

  const BOSS_PAL = {
    K: '#120e24',
    c: '#ff8a73', C: '#d24f4f', q: '#ffc2b0',           // coral
    s: '#b4e6f0', S: '#86c7d8', n: '#6aaec2',           // skin
    e: '#120e24', i: '#7ff3ff',                          // eye, glowing iris
    b: '#f2fffd', B: '#c4e6e1', d: '#97c9c2',           // beard and hair
    r: '#2390a7', R: '#176477', M: '#0f4a59',           // robe
    w: '#a6f4fa', v: '#61d6e6',                          // wave trim
    t: '#9a6a47', T: '#6b452c', y: '#f2c14e',           // staff, gold band
    o: '#5fdcff', O: '#e3fbff', p: '#2a9fd0', P: '#1c78a8' // orb
  };

  function buildBoss() {
    const G = makeGrid(), cx = 13.5;
    // Staff: two pixels wide, light left edge, dark right edge
    for (let y = 9; y < 40; y++) { G.set(25, y, 't'); G.set(26, y, 'T'); }
    G.rect(25, 10, 26, 11, 'y');
    // Robe, widening toward the hem
    for (let y = 17; y < 40; y++) {
      const half = 6 + (y - 17) * 0.33;
      for (let x = Math.ceil(cx - half - 0.5); x <= Math.floor(cx + half - 0.5); x++) {
        let c = x < cx - half * 0.45 ? 'R' : 'r';
        if (x < cx - half * 0.8) c = 'M';
        if (y >= 36) c = ((x + y) % 4 < 2) ? 'w' : 'v';
        else if (y === 35) c = 'v';
        G.set(x, y, c);
      }
    }
    for (let y = 22; y < 35; y++) { G.set(13, y, 'v'); G.set(14, y, 'w'); }
    // Left sleeve hanging down, right arm reaching the staff
    G.ellipse(7.5, 25, 2.2, 5, (x) => (x < 7 ? 'M' : 'R'));
    G.rect(19, 21, 23, 23, 'r'); G.rect(19, 23, 23, 23, 'R');
    G.rect(24, 20, 24, 23, 's'); G.set(24, 23, 'S'); G.rect(27, 21, 27, 22, 'S');
    // Hair behind the head, then the head
    G.ellipse(cx, 11, 6.4, 6.6, (x, y, dx) => (dx < -0.5 ? 'd' : 'B'));
    G.ellipse(cx, 11.4, 4.6, 4.9, (x, y, dx) => (dx > 0.5 ? 'S' : 's'));
    // Brows, eyes, nose
    G.rect(10, 9, 12, 9, 'b'); G.rect(15, 9, 17, 9, 'b');
    G.set(11, 10, 'e'); G.set(12, 10, 'i'); G.set(15, 10, 'i'); G.set(16, 10, 'e');
    G.set(13, 12, 'n'); G.set(14, 12, 'n');
    // Mustache and long beard
    G.rect(10, 13, 17, 13, 'b'); G.set(9, 14, 'b'); G.set(18, 14, 'b');
    for (let y = 14; y < 29; y++) {
      const half = Math.max(0.6, 4.6 - (y - 14) * 0.3);
      for (let x = Math.ceil(cx - half - 0.5); x <= Math.floor(cx + half - 0.5); x++) {
        G.set(x, y, x % 3 === 0 && y > 15 ? 'B' : 'b');
      }
    }
    // Coral crown: band and branches
    G.rect(8, 5, 19, 5, 'C'); G.rect(8, 4, 19, 4, 'c');
    [[8, 3], [8, 2], [7, 1], [11, 3], [11, 2], [10, 1], [13, 3], [14, 3], [13, 2], [14, 2],
     [13, 1], [14, 1], [16, 3], [16, 2], [17, 1], [19, 3], [19, 2], [20, 1]].forEach(([x, y]) => G.set(x, y, 'c'));
    G.set(13, 4, 'q'); G.set(14, 4, 'q');
    // Orb: a circle centered on the staff (between columns 25 and 26)
    G.ellipse(26, 5, 4.9, 4.9, (x, y, dx, dy) => {
      const r2 = dx * dx + dy * dy;
      if (r2 > 0.6 && dx + dy > 0.3) return 'P';
      if (dx + dy > 0.5) return 'p';
      if (dx < -0.15 && dy < -0.15 && r2 < 0.45) return 'O';
      return 'o';
    });
    G.set(23, 3, 'O'); G.set(24, 2, 'O');
    return outline(G.g);
  }

  // ---------- Player ----------

  const PLAYER_PAL = {
    K: '#120e24',
    h: '#c0394b', H: '#8a2236', j: '#5e1626',           // cloak
    y: '#f2c14e', Y: '#c48f2a',                          // gold trim
    s: '#f6c9a8', S: '#d9a27f',                          // skin
    a: '#5a3a28', A: '#3d2619',                          // hair
    e: '#120e24',
    n: '#7b5235', N: '#563820',                          // wand
    x: '#fff6c2', X: '#ffd75e'                           // wand tip
  };

  function buildPlayer() {
    const G = makeGrid(), cx = 18.5;
    // Cloak
    for (let y = 16; y < 40; y++) {
      const half = 6 + (y - 16) * 0.3;
      for (let x = Math.ceil(cx - half - 0.5); x <= Math.floor(cx + half - 0.5); x++) {
        let c = x > cx + half * 0.45 ? 'H' : 'h';
        if (x > cx + half * 0.8) c = 'j';
        if (y >= 38) c = 'y';
        G.set(x, y, c);
      }
    }
    for (let y = 18; y < 38; y++) G.set(18, y, 'y');
    // Arm reaching forward (left) with the wand
    G.rect(8, 21, 13, 23, 'h'); G.rect(8, 23, 13, 23, 'H');
    G.rect(6, 21, 7, 23, 's'); G.set(6, 23, 'S');
    // Wand, angled up and forward
    for (let i = 0; i < 9; i++) { const x = 6 - Math.round(i * 0.4); G.set(x, 20 - i, 'n'); G.set(x + 1, 20 - i, 'N'); }
    G.ellipse(3.5, 10, 2.3, 2.3, (x, y, dx, dy) => (dx < 0 && dy < 0 ? 'x' : 'X'));
    // Hood, face, hair fringe
    G.ellipse(cx, 11, 6.6, 7.2, (x, y, dx) => (dx > 0.45 ? 'H' : 'h'));
    G.ellipse(cx - 0.5, 12.2, 4.3, 4.4, (x, y, dx) => (dx > 0.5 ? 'S' : 's'));
    G.rect(15, 8, 21, 9, 'a'); G.rect(14, 10, 15, 10, 'a'); G.set(21, 10, 'A'); G.set(16, 10, 'A');
    // Eyes looking left, small mouth
    G.set(15, 12, 'e'); G.set(19, 12, 'e'); G.set(17, 15, 'S');
    // Hood tip
    G.set(cx + 5, 4, 'h'); G.set(cx + 6, 5, 'H');
    return outline(G.g);
  }

  const BOSS = buildBoss(), PLAYER = buildPlayer();

  // Draw a sprite grid onto a canvas, scaled to whole pixels and centered.
  // Sprites stand on the bottom of the canvas, so every sprite
  // drawn on a same-size canvas shares one baseline. opts: {flash, tint}
  function drawGrid(canvas, grid, pal, opts) {
    opts = opts || {};
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    // Leave headroom above the sprite for effects like the bubble
    const px = Math.max(1, Math.floor(Math.min(cw / (W + 10), ch / (H + 14))));
    const ox = Math.round((cw - W * px) / 2), oy = ch - H * px - 2 * px;
    // Shadow under the feet
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(ox + W * px / 2, oy + H * px, W * px * 0.36, px * 1.6, 0, 0, 2 * Math.PI); ctx.fill();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = grid[y][x];
      if (c === '.') continue;
      ctx.fillStyle = opts.flash && c !== 'K' ? '#ffffff' : pal[c];
      ctx.fillRect(ox + x * px, oy + y * px, px, px);
    }
    if (opts.tint) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = opts.tint;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
    }
    return { ctx, px, ox, oy, w: W * px, h: H * px, cw, ch };
  }

  function drawBoss(canvas, opts) {
    opts = opts || {};
    const r = drawGrid(canvas, BOSS, BOSS_PAL, opts);
    if (opts.bubble) {
      const { ctx, ox, oy, w, h, cw, ch } = r;
      // Bubble around Nerith, sized so it never runs off the canvas
      const cx = ox + w / 2, cy = oy + h * 0.47;
      const rx = Math.min(w * 0.6, cx - 4, cw - cx - 4);
      const ry = Math.min(h * 0.55, cy - 4, ch - cy - 4);
      const g = ctx.createRadialGradient(cx, cy, rx * 0.3, cx, cy, rx * 1.1);
      g.addColorStop(0, 'rgba(120,220,255,0.05)'); g.addColorStop(1, 'rgba(120,220,255,0.28)');
      ctx.fillStyle = g; ctx.strokeStyle = 'rgba(170,240,255,0.95)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.8, ry * 0.8, 0, Math.PI * 1.1, Math.PI * 1.4); ctx.stroke();
    }
    return r;
  }

  function drawPlayer(canvas, opts) { return drawGrid(canvas, PLAYER, PLAYER_PAL, opts); }

  // Where effects should start or land, in canvas pixels
  function anchors(r) {
    return {
      center: { x: r.ox + r.w / 2, y: r.oy + r.h * 0.5 },
      head: { x: r.ox + r.w / 2, y: r.oy + r.h * 0.25 }
    };
  }

  root.Sprites = { drawBoss, drawPlayer, anchors, BOSS, PLAYER, BOSS_PAL, PLAYER_PAL, W, H };
})(window);
