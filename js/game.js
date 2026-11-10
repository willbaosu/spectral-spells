// Spectral Spells game logic: spells, the boss, recording, combat,
// effects, and charts.
(function () {
  'use strict';

  // kind: 'attack' spells are cast on your turn; 'reaction' spells are
  // cast while the boss's spell is incoming.
  const SPELLS = [
    { id: 'fireball', name: 'Fireball', kind: 'attack', base: 26, color: '#ff8a4c',
      desc: '26 damage. Halved by Bubble Barrier.' },
    { id: 'lightning_bolt', name: 'Lightning Bolt', kind: 'attack', base: 20, color: '#ffd84d',
      desc: '20 damage. Double damage through Bubble Barrier, and breaks it.' },
    { id: 'focus', name: 'Focus', kind: 'attack', base: 0, color: '#c48cff',
      desc: 'Your next 3 attacks deal up to 60% more damage.' },
    { id: 'shield', name: 'Shield', kind: 'reaction', base: 0, color: '#7cc8ff',
      desc: 'Reaction. Blocks up to all of an incoming spell.' }
  ];
  const BOSS_SPELLS = {
    water_jet: { name: 'Water Jet', dmg: L => 9 + 2 * L },
    tidal_wave: { name: 'Tidal Wave', dmg: L => 17 + 3 * L },
    healing_rain: { name: 'Healing Rain', heal: 18 },
    bubble_barrier: { name: 'Bubble Barrier' }
  };
  const VOICES = ['slt', 'awb', 'esus', 'esf3'];   // reference voices per spell
  const PLAY_VOICE = 'slt';                         // the one players hear
  const RECORD_SEC = 3;
  const PLAYER_MAX = 100;
  const FOCUS_TURNS = 3, FOCUS_MAX = 0.6;

  const $ = id => document.getElementById(id);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const state = {
    refs: {}, refAudio: {}, selected: 'fireball', ctx: null,
    phase: 'loading', player: PLAYER_MAX, focus: { turns: 0, bonus: 0 },
    boss: null, level: 1, incoming: null, busy: false,
    wins: 0, casts: 0, bestRho: 0, bossR: null, playerR: null,
    fightStarted: false, bossSink: 0, playerDown: false
  };

  // ---------- Audio ----------

  function audioCtx() {
    if (!state.ctx) state.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (state.ctx.state === 'suspended') state.ctx.resume();
    return state.ctx;
  }

  // Read the reference .wav files directly, so they keep their
  // 16 kHz sampling rate (the browser would change it to 48 kHz)
  function parseWav(buf) {
    const v = new DataView(buf);
    let p = 12, ch = 1, fs = 16000, data = null;
    while (p + 8 <= v.byteLength) {
      const id = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
      const size = v.getUint32(p + 4, true);
      if (id === 'fmt ') { ch = v.getUint16(p + 10, true); fs = v.getUint32(p + 12, true); }
      if (id === 'data') data = { off: p + 8, size };
      p += 8 + size + (size % 2);
    }
    const n = Math.floor(data.size / 2 / ch), x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = v.getInt16(data.off + i * 2 * ch, true) / 32768;
    return { x, fs };
  }

  async function loadSpells() {
    for (const s of SPELLS) {
      state.refs[s.id] = [];
      for (const voice of VOICES) {
        const url = `spells/${s.id}/${voice}.wav`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('could not load ' + url);
        const w = parseWav(await res.arrayBuffer());
        const proc = DSP.process(w.x, w.fs);
        proc.voice = voice;
        state.refs[s.id].push(proc);
        if (voice === PLAY_VOICE) state.refAudio[s.id] = w;
      }
    }
  }

  function playSamples(w) {
    const ctx = audioCtx();
    const b = ctx.createBuffer(1, w.x.length, w.fs);
    b.getChannelData(0).set(Float32Array.from(w.x));
    const src = ctx.createBufferSource();
    src.buffer = b; src.connect(ctx.destination); src.start();
  }

  function playBossLine(id) {
    try { new Audio(`enemy/${id}.wav`).play().catch(() => {}); } catch (e) { /* no audio */ }
  }

  async function recordVoice(word, onTick) {
    onTick = onTick || setStatus;
    const stream = await navigator.mediaDevices.getUserMedia({
      // Turn off the browser's own processing so our filters do the work
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    const done = new Promise(r => (rec.onstop = r));
    rec.start();
    for (let t = RECORD_SEC; t > 0; t--) {
      onTick(`Recording… say "${word}" (${t})`);
      await wait(1000);
    }
    rec.stop();
    await done;
    stream.getTracks().forEach(t => t.stop());
    return decode(await new Blob(chunks).arrayBuffer());
  }

  async function decode(buf) {
    const ab = await audioCtx().decodeAudioData(buf);
    return { x: Float64Array.from(ab.getChannelData(0)), fs: ab.sampleRate };
  }

  // ---------- Sprites and effect positions ----------

  function newBoss() {
    const L = state.level;
    const hp = 150 + 40 * (L - 1);
    state.boss = { name: 'Nerith the Tidecaller', hp, maxHp: hp, barrier: false, healsLeft: 2 };
    drawBoss();
  }

  function drawBoss(flash) {
    state.bossR = Sprites.drawBoss($('bossArt'), {
      flash, sink: state.bossSink, bubble: state.boss && state.boss.barrier && !state.bossSink
    });
  }

  function drawPlayer(flash) {
    state.playerR = Sprites.drawPlayer($('playerArt'), {
      flash, tint: state.playerDown ? 'rgba(20,16,40,0.6)' : null
    });
  }

  // Convert a point on a sprite grid to the effects canvas
  function spritePoint(canvasId, r, gx, gy) {
    const c = $(canvasId).getBoundingClientRect(), f = $('fx').getBoundingClientRect();
    return { x: c.left - f.left + r.ox + gx * r.px, y: c.top - f.top + r.oy + gy * r.px };
  }
  const pts = {
    boss: () => spritePoint('bossArt', state.bossR, 14, 20),
    orb: () => spritePoint('bossArt', state.bossR, 26, 5),
    player: () => spritePoint('playerArt', state.playerR, 18, 20),
    wand: () => spritePoint('playerArt', state.playerR, 3.5, 10)
  };

  function shake(id) {
    const el = $(id);
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  function hitBoss() {
    shake('bossArt'); drawBoss(true); setTimeout(() => drawBoss(), 120);
  }

  function hitPlayer() {
    shake('playerArt'); drawPlayer(true); setTimeout(() => drawPlayer(), 120);
  }

  function updateAura() {
    FX.setAura(state.focus.turns > 0 ? pts.wand() : null);
  }

  // Weighted random choice. A spell he just cast is less likely next
  // time, and he never casts the same spell three times in a row.
  function chooseBossSpell() {
    const b = state.boss, last = state.bossLast || [];
    const w = { water_jet: 3, tidal_wave: 3, bubble_barrier: b.barrier ? 0 : 1.5,
      healing_rain: b.hp < 0.5 * b.maxHp && b.healsLeft > 0 ? 2 : 0 };
    if (last[0] && w[last[0]]) w[last[0]] *= 0.4;
    if (last[0] && last[0] === last[1]) w[last[0]] = 0;
    const total = Object.values(w).reduce((p, q) => p + q, 0);
    let r = Math.random() * total, id = 'water_jet';
    for (const k in w) { if ((r -= w[k]) < 0) { id = k; break; } }
    state.bossLast = [id, last[0]];
    return id;
  }

  // ---------- UI ----------

  const spell = () => SPELLS.find(s => s.id === state.selected);
  const setStatus = t => ($('status').textContent = t);

  function log(text, cls) {
    const li = document.createElement('li');
    li.textContent = text; if (cls) li.className = cls;
    $('log').prepend(li);
  }

  function updateBars() {
    const b = state.boss;
    $('bossName').textContent = `${b.name}  ·  Lv ${state.level}`;
    $('bossHp').style.width = (100 * b.hp / b.maxHp) + '%';
    $('bossHpText').textContent = `${b.hp} / ${b.maxHp} HP`;
    $('bossStatus').textContent = b.barrier ? 'Bubble Barrier up: Fireball is halved, Lightning Bolt does double.' : '';
    $('playerHp').style.width = (100 * state.player / PLAYER_MAX) + '%';
    $('playerHpText').textContent = `${state.player} / ${PLAYER_MAX} HP`;
    const f = state.focus;
    $('playerStatus').textContent = f.turns > 0
      ? `Focused: +${Math.round(100 * f.bonus)}% damage for ${f.turns} more attack${f.turns > 1 ? 's' : ''}.` : '';
    $('statsText').textContent = `Wins: ${state.wins}  ·  Casts: ${state.casts}  ·  Best ρ: ${state.bestRho.toFixed(2)}`;
    updateAura();
  }

  function buildSpellbook() {
    const box = $('spells');
    SPELLS.forEach(s => {
      const b = document.createElement('button');
      b.className = 'spell';
      b.dataset.id = s.id;
      b.style.setProperty('--spell-color', s.color);
      b.innerHTML = `<div class="sname">${s.name}</div><div class="sdesc">${s.desc}</div>`;
      b.onclick = () => { if (!b.disabled) select(s.id); };
      box.appendChild(b);
    });
  }

  function select(id) {
    state.selected = id;
    document.querySelectorAll('.spell').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
  }

  // Enable the spells that fit the current phase
  function refreshControls() {
    const p = state.phase, busy = state.busy;
    document.querySelectorAll('.spell').forEach(c => {
      const s = SPELLS.find(x => x.id === c.dataset.id);
      const ok = (p === 'attack' && s.kind === 'attack') || (p === 'react' && s.kind === 'reaction');
      c.disabled = busy || !ok;
    });
    const canCast = !busy && (p === 'attack' || p === 'react');
    $('recordBtn').disabled = !canCast;
    $('listenBtn').disabled = !canCast;
    $('uploadInput').disabled = !canCast;
    $('uploadLabel').classList.toggle('disabled', !canCast);
    $('takeHitBtn').classList.toggle('hidden', p !== 'react');
    $('takeHitBtn').disabled = busy;
    $('trainBtn').disabled = busy || p !== 'attack';
  }

  function setBusy(b) { state.busy = b; refreshControls(); }

  function startAttackPhase(msg) {
    state.phase = 'attack';
    if (spell().kind !== 'attack') select('fireball');
    refreshControls();
    setStatus(msg || 'Your turn. Pick Fireball, Lightning Bolt, or Focus and say it.');
  }

  // ---------- Your turn ----------

  function scoreCast(proc, s) {
    const sc = DSP.scoreMulti(state.refs[s.id].map(r => r.feat), proc.feat);
    const eff = DSP.effectiveness(sc.rho);
    state.casts++;
    state.bestRho = Math.max(state.bestRho, sc.rho);
    $('result').classList.remove('hidden');
    $('rhoText').textContent = sc.rho.toFixed(3);
    $('effText').textContent = Math.round(100 * eff) + '%';
    drawCharts(proc, sc, s);
    return { sc, eff };
  }

  function heard(audio, proc) {
    let peak = 0;
    for (let i = 0; i < audio.x.length; i++) peak = Math.max(peak, Math.abs(audio.x[i]));
    return peak >= 0.01 && proc.duration >= 0.15;
  }

  async function castAttack(audio) {
    const s = spell(), b = state.boss;
    const proc = DSP.process(audio.x, audio.fs);
    if (!heard(audio, proc)) { setStatus('Nothing was heard. Try again closer to the mic.'); return; }
    const { sc, eff } = scoreCast(proc, s);
    const tag = `(ρ = ${sc.rho.toFixed(2)}, ${Math.round(100 * eff)}%)`;

    if (eff === 0) {
      $('outText').textContent = 'Fizzle';
      await FX.fizzle(pts.wand());
      FX.text(pts.wand(), 'Fizzle', '#b3adc6');
      log(`${s.name} fizzles ${tag}. Say it more like the incantation.`, 'miss');
      if (s.id !== 'focus' && state.focus.turns > 0) state.focus.turns--;
    } else if (s.id === 'focus') {
      state.focus = { turns: FOCUS_TURNS, bonus: FOCUS_MAX * eff };
      $('outText').textContent = '+' + Math.round(100 * state.focus.bonus) + '%';
      await FX.focus(pts.wand(), eff);
      FX.text(pts.wand(), `+${Math.round(100 * state.focus.bonus)}% power`, '#d9b8ff');
      log(`You focus: next ${FOCUS_TURNS} attacks deal +${Math.round(100 * state.focus.bonus)}% ${tag}.`, 'hit');
    } else {
      let dmg = s.base * eff, note = '', popped = false;
      if (state.focus.turns > 0) { dmg *= 1 + state.focus.bonus; state.focus.turns--; }
      if (b.barrier) {
        if (s.id === 'fireball') { dmg *= 0.5; note = ' The barrier turns half of it to steam.'; }
        if (s.id === 'lightning_bolt') { dmg *= 2; popped = true; note = ' Lightning runs through the water and bursts the barrier.'; }
      }
      dmg = Math.round(dmg);
      $('outText').textContent = dmg + ' dmg';
      if (s.id === 'fireball') await FX.fireball(pts.wand(), pts.boss(), eff);
      else await FX.lightning(pts.boss(), eff);
      if (popped) { b.barrier = false; FX.pop(pts.boss()); }
      b.hp = Math.max(0, b.hp - dmg);
      hitBoss();
      FX.text(pts.boss(), '-' + dmg, s.color, eff >= 1);
      log(`${s.name} hits for ${dmg} ${tag}.${note}`, 'hit');
    }
    updateBars();

    if (b.hp <= 0) {
      state.wins++;
      state.phase = 'won';
      refreshControls();
      log(`${b.name} collapses into a puddle. You win!`, 'hit');
      setStatus('Nerith is defeated!');
      await bossDeath();
      updateBars();
      showBanner('Victory!', `Nerith the Tidecaller is a puddle. Wins: ${state.wins}.`, true);
      return;
    }
    await wait(700);
    await bossTurn();
  }

  // ---------- Boss turn and your reaction ----------

  async function bossTurn() {
    const b = state.boss, id = chooseBossSpell(), bs = BOSS_SPELLS[id];
    playBossLine(id);
    if (id === 'healing_rain') {
      const heal = Math.min(bs.heal, b.maxHp - b.hp);
      await FX.healingRain(pts.boss());
      b.hp += heal; b.healsLeft--;
      FX.text(pts.boss(), '+' + heal, '#8dffb0');
      log(`${b.name} casts Healing Rain and recovers ${heal} HP.`, 'hurt');
      updateBars();
      startAttackPhase();
      return;
    }
    if (id === 'bubble_barrier') {
      await FX.bubbles(pts.boss());
      b.barrier = true;
      drawBoss(); updateBars();
      log(`${b.name} casts Bubble Barrier.`, 'hurt');
      startAttackPhase('Bubble Barrier is up. Lightning Bolt will burst it for double damage.');
      return;
    }
    const dmg = bs.dmg(state.level);
    state.incoming = { id, name: bs.name, dmg };
    FX.setTelegraph(pts.orb(), id === 'tidal_wave');
    state.phase = 'react';
    select('shield');
    refreshControls();
    log(`${b.name} casts ${bs.name}! (${dmg} damage incoming)`, 'hurt');
    setStatus(`${bs.name} is coming for ${dmg} damage. Say "Shield" to block it, or take the hit.`);
  }

  // Play the incoming spell, then apply what the shield did not block
  async function landHit(blocked) {
    const inc = state.incoming, taken = inc.dmg - blocked;
    FX.setTelegraph(null);
    if (inc.id === 'tidal_wave') await FX.tidalWave(pts.player());
    else await FX.waterJet(pts.orb(), pts.player());
    if (blocked > 0) {
      FX.shield(pts.player(), blocked / inc.dmg);
      FX.text({ x: pts.player().x - 60, y: pts.player().y - 30 }, 'Blocked ' + blocked, '#9fe0ff');
    }
    if (taken > 0) { hitPlayer(); FX.text(pts.player(), '-' + taken, '#ff6b6b', taken >= 15); }
    state.player = Math.max(0, state.player - taken);
    if (blocked > 0) log(`Your shield blocks ${blocked} of ${inc.dmg}. You take ${taken}.`, taken ? 'hurt' : 'hit');
    else log(`${inc.name} hits you for ${taken}.`, 'hurt');
    state.incoming = null;
    updateBars();
    if (state.player <= 0) {
      state.phase = 'lost';
      state.focus = { turns: 0, bonus: 0 };
      state.playerDown = true;
      drawPlayer();
      updateBars();
      setStatus('You were washed away.');
      refreshControls();
      showBanner('Defeated', 'Nerith washed you away.', false);
      return;
    }
    await wait(300);
    startAttackPhase();
  }

  async function castShield(audio) {
    const proc = DSP.process(audio.x, audio.fs);
    if (!heard(audio, proc)) { setStatus('Nothing was heard. Say "Shield" again, or take the hit.'); return; }
    const { sc, eff } = scoreCast(proc, spell());
    const blocked = Math.round(state.incoming.dmg * eff);
    $('outText').textContent = blocked + ' blocked';
    if (eff === 0) { log(`Shield fizzles (ρ = ${sc.rho.toFixed(2)}).`, 'miss'); FX.fizzle(pts.wand()); }
    await landHit(blocked);
  }

  async function handleCast(audio) {
    if (state.phase === 'react') await castShield(audio);
    else await castAttack(audio);
  }

  // ---------- Voice training ----------

  // At the start of each session you record each spell one to three
  // times. Each take is added as an extra reference for that spell, so
  // the game compares your voice with your own voice as well as the
  // computer voices. Takes last until the page is closed or reloaded.
  const MAX_TAKES = 3;
  const yours = id => state.refs[id].filter(r => r.voice === 'you');

  // x: your filtered recording at 16 kHz. Past MAX_TAKES, the oldest
  // take is replaced.
  function addYourRef(id, x) {
    const F = DSP.features(x, DSP.FS);
    const takes = yours(id);
    if (takes.length >= MAX_TAKES) state.refs[id].splice(state.refs[id].indexOf(takes[0]), 1);
    state.refs[id].push({ voice: 'you', feat: F.feat, spec: F.spec, binHz: F.binHz, x });
  }

  function buildTraining() {
    const box = $('trainList');
    SPELLS.forEach(s => {
      const row = document.createElement('div');
      row.className = 'train-row';
      row.style.setProperty('--spell-color', s.color);
      row.innerHTML = `<span class="sname">${s.name}</span>
        <button class="secondary t-hear">▶ Hear it</button>
        <button class="primary t-rec">● Record</button>
        <span class="t-status muted small"></span>`;
      row.querySelector('.t-hear').onclick = () => playSamples(state.refAudio[s.id]);
      row.querySelector('.t-rec').onclick = () => trainSpell(s.id, row);
      row.dataset.id = s.id;
      box.appendChild(row);
    });
  }

  function updateTraining() {
    let n = 0;
    document.querySelectorAll('.train-row').forEach(row => {
      const k = yours(row.dataset.id).length;
      if (k) n++;
      const st = row.querySelector('.t-status');
      if (!row.dataset.msg) st.textContent = k ? `✓ ${k} of ${MAX_TAKES} takes` : 'Not trained yet';
      row.querySelector('.t-rec').textContent = k === 0 ? '● Record' : k < MAX_TAKES ? '● Add a take' : '● Replace oldest';
      row.querySelectorAll('button').forEach(b => (b.disabled = state.busy));
    });
    $('trainDoneBtn').disabled = state.busy;
    $('trainDoneBtn').textContent = n === 0 ? 'Skip (use computer voices only)'
      : state.fightStarted ? 'Back to the fight' : `Start the fight (${n} of 4 trained)`;
  }

  async function trainSpell(id, row) {
    if (state.busy) return;
    const s = SPELLS.find(x => x.id === id), st = row.querySelector('.t-status');
    state.busy = true; updateTraining();
    row.dataset.msg = '1';
    try {
      const audio = await recordVoice(s.name, t => (st.textContent = t));
      const proc = DSP.process(audio.x, audio.fs);
      if (!heard(audio, proc)) {
        st.textContent = 'Nothing was heard. Try again closer to the mic.';
      } else {
        const computer = state.refs[id].filter(r => r.voice !== 'you').map(r => r.feat);
        const rho = DSP.scoreMulti(computer, proc.feat).rho;
        addYourRef(id, Float64Array.from(proc.filtered));
        const k = yours(id).length;
        st.textContent = `✓ Take ${k} of ${MAX_TAKES} saved. Match with the computer voices: ρ = ${rho.toFixed(2)}`;
      }
    } catch (err) {
      st.textContent = 'Microphone error: ' + err.message;
    }
    state.busy = false; updateTraining();
  }

  function openTraining() {
    state.phase = 'training';
    document.querySelectorAll('.train-row').forEach(r => delete r.dataset.msg);
    $('training').classList.remove('hidden');
    updateTraining(); refreshControls();
    setStatus('Voice training: say each spell once.');
    $('training').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeTraining() {
    $('training').classList.add('hidden');
    if (state.fightStarted) startAttackPhase();
    else newFight('same');
  }

  // ---------- Charts ----------

  function drawCharts(proc, sc, s) {
    const db = m => {
      let mx = 0; for (const v of m) mx = Math.max(mx, v);
      return Array.from(m, v => 20 * Math.log10(v / mx + 1e-6));
    };
    const B = proc.spectrumBefore, A = proc.spectrumAfter;
    Charts.line($('chartSpectrum'), [
      { x: Array.from(A.f, f => f / 1000), y: db(A.mag), color: s.color, label: 'after bandpass' },
      { x: Array.from(B.f, f => f / 1000), y: db(B.mag), color: '#9a90b8', label: 'raw (dashed)', dash: true }
    ], {
      xmin: 0, xmax: 8, ymin: -80, ymax: 0, xTicks: 8, yTicks: 4,
      title: 'Spectrum before and after the bandpass', xlabel: 'frequency (kHz)', ylabel: '|S(f)| (dB)',
      vbands: [{ from: DSP.F_LOW / 1000, to: DSP.F_HIGH / 1000, color: 'rgba(180,140,255,0.08)' }]
    });

    const curve = sc.curve;
    const best = curve.reduce((a, b) => (b.rho > a.rho ? b : a));
    const span = DSP.MAX_LAG * 10;
    Charts.line($('chartCorr'), [
      { x: curve.map(c => c.lag * DSP.HOP / DSP.FS * 1000), y: curve.map(c => c.rho), color: s.color },
      { x: [-span, span], y: [DSP.RHO_FAIL, DSP.RHO_FAIL], color: '#ff6b6b', label: 'fizzle below this', dash: true, inline: true },
      { x: [-span, span], y: [DSP.RHO_FULL, DSP.RHO_FULL], color: '#5fd18b', label: 'full power above this', dash: true, inline: true }
    ], {
      xmin: -span, xmax: span, ymin: -0.2, ymax: 1, xTicks: 6, yTicks: 6,
      title: 'Correlation with the reference', xlabel: 'time shift (ms)', ylabel: 'ρ',
      marker: { x: best.lag * 10, y: best.rho, color: '#fff', label: 'peak ρ = ' + best.rho.toFixed(3) }
    });

    const frameSec = DSP.HOP / DSP.FS;
    Charts.spectrogram($('chartCast'), proc.spec, proc.binHz, frameSec, 'Your cast');
    const ref = state.refs[s.id][sc.ref];
    const who = ref.voice === 'you' ? 'your training take' : `computer voice ${sc.ref + 1}`;
    Charts.spectrogram($('chartRef'), ref.spec, ref.binHz, frameSec, `Closest reference: ${who}`);
  }

  // ---------- Wire up ----------

  // Nerith sinks into a puddle with a splash
  async function bossDeath() {
    FX.setTelegraph(null);
    FX.splash(pts.boss());
    const t0 = performance.now(), dur = 1600;
    await new Promise(res => {
      function step(t) {
        state.bossSink = Math.min(1, (t - t0) / dur);
        drawBoss();
        if (state.bossSink < 1) requestAnimationFrame(step); else res();
      }
      requestAnimationFrame(step);
    });
  }

  // win = true shows Play again and Fight a stronger Nerith;
  // win = false shows Try again
  function showBanner(title, text, win) {
    $('bannerTitle').textContent = title;
    $('bannerText').textContent = text;
    $('banner').classList.toggle('lost', !win);
    $('harderBtn').classList.toggle('hidden', !win);
    $('playAgainBtn').textContent = win ? 'Play again' : 'Try again';
    $('banner').classList.remove('hidden');
  }

  // level: 'same', 'harder', or 'reset'
  function newFight(level) {
    if (level === 'harder') state.level++;
    if (level === 'reset') state.level = 1;
    $('banner').classList.add('hidden');
    state.bossSink = 0;
    state.playerDown = false;
    state.bossLast = [];
    state.fightStarted = true;
    state.player = PLAYER_MAX;
    state.focus = { turns: 0, bonus: 0 };
    state.incoming = null;
    FX.setTelegraph(null);
    newBoss();
    drawPlayer();
    updateBars();
    log(`${state.boss.name} rises from the water (${state.boss.maxHp} HP).`);
    startAttackPhase('Your turn. Pick Fireball, Lightning Bolt, or Focus, hear it, then say it.');
  }

  $('listenBtn').onclick = () => playSamples(state.refAudio[state.selected]);

  $('recordBtn').onclick = async () => {
    if (state.busy) return;
    setBusy(true);
    $('recordBtn').classList.add('recording');
    try {
      const audio = await recordVoice(spell().name);
      $('recordBtn').classList.remove('recording');
      setStatus('Analyzing…');
      await handleCast(audio);
    } catch (err) {
      setStatus('Microphone error: ' + err.message + '. You can upload a recording instead.');
    }
    $('recordBtn').classList.remove('recording');
    setBusy(false);
  };

  $('uploadInput').onchange = async ev => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f || state.busy) return;
    setBusy(true);
    try {
      setStatus('Analyzing ' + f.name + '…');
      await handleCast(await decode(await f.arrayBuffer()));
    } catch (err) {
      setStatus('Could not read that file: ' + err.message);
    }
    setBusy(false);
  };

  $('takeHitBtn').onclick = async () => {
    if (state.phase !== 'react' || state.busy) return;
    setBusy(true);
    await landHit(0);
    setBusy(false);
  };
  $('playAgainBtn').onclick = () => newFight(state.phase === 'won' ? 'reset' : 'same');
  $('harderBtn').onclick = () => newFight('harder');
  $('trainBtn').onclick = () => { if (!state.busy && state.phase === 'attack') openTraining(); };
  $('trainDoneBtn').onclick = () => { if (!state.busy) closeTraining(); };

  window.addEventListener('resize', () => { if (state.boss) { drawBoss(); drawPlayer(); updateAura(); } });

  FX.init($('fx'));
  buildSpellbook();
  buildTraining();
  select('fireball');
  newBoss();
  drawPlayer();
  updateBars();
  refreshControls();
  setStatus('Loading spells…');
  loadSpells()
    .then(() => openTraining())
    .catch(err => setStatus('Error loading spells: ' + err.message + '. Open the page through a web server, not as a file.'));

  // Exposed for automated testing
  window.SpectralSpells = { state, FX };
})();
