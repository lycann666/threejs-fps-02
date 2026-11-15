// HUD: DOM overlay. Health/armour/ammo/money/timer/score/alive counts,
// bomb status, kill feed, banners, crosshair, hitmarker, damage vignette,
// plant/defuse progress, buy menu, overlays, 2D minimap.
import { SITES, BOUNDS } from './world.js';
import { buyMenu } from './economy.js';
import { clamp } from './palette.js';

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = {};
    const ids = [
      'health-bar', 'health-num', 'armour-bar', 'armour-num', 'ammo', 'ammo-mag',
      'ammo-reserve', 'weapon-name', 'money', 'timer', 'round-label',
      'score-v', 'score-j', 'alive-v', 'alive-j', 'bomb-line', 'killfeed',
      'banner', 'banner-sub', 'crosshair', 'hitmarker', 'vignette',
      'channel', 'channel-fill', 'channel-label', 'buymenu', 'buy-list',
      'overlay', 'overlay-title', 'overlay-copy', 'play', 'minimap',
    ];
    for (const id of ids) this.el[id] = root.querySelector('#' + id);
    this.feed = [];
    this.bannerAt = 0;
    this.buyOpen = false;
    this.minimapCtx = this.el.minimap ? this.el.minimap.getContext('2d') : null;
  }

  showOverlay(title, copy, buttonLabel) {
    this.el['overlay-title'].textContent = title;
    this.el['overlay-copy'].textContent = copy;
    this.el.play.textContent = buttonLabel;
    this.el.overlay.hidden = false;
  }

  hideOverlay() {
    this.el.overlay.hidden = true;
  }

  banner(text, sub, seconds = 4) {
    this.el.banner.textContent = text;
    this.el['banner-sub'].textContent = sub || '';
    this.el.banner.parentElement.hidden = false;
    this.bannerAt = performance.now() / 1000 + seconds;
  }

  hideBanner() {
    this.el.banner.parentElement.hidden = true;
  }

  killfeedAdd(text) {
    this.feed.unshift({ text, at: performance.now() / 1000 });
    if (this.feed.length > 5) this.feed.pop();
    this.el.killfeed.innerHTML = this.feed
      .map((f) => `<div>${escapeHtml(f.text)}</div>`).join('');
  }

  flashHit(kill) {
    const h = this.el.hitmarker;
    h.classList.add('on');
    h.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${kill ? 1.5 : 1})`;
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => h.classList.remove('on'), 110);
  }

  damageFlash() {
    const v = this.el.vignette;
    v.style.opacity = '0.85';
    clearTimeout(this._vigT);
    this._vigT = setTimeout(() => { v.style.opacity = '0'; }, 260);
  }

  setBuyOpen(open, fighter) {
    this.buyOpen = open;
    this.el.buymenu.hidden = !open;
    if (open && fighter) this.renderBuy(fighter);
  }

  renderBuy(fighter) {
    const items = buyMenu(fighter);
    this.el['buy-list'].innerHTML = items.map((it) => {
      const dis = it.owned || fighter.money < it.price;
      return `<button data-buy="${it.id}" ${dis ? 'disabled' : ''} class="buy-item">
        <span class="buy-key">${it.key}</span>
        <span class="buy-name">${escapeHtml(it.name)}</span>
        <span class="buy-price">${it.price === 0 ? (it.owned ? 'OWNED' : 'FREE') : '$' + it.price}</span>
      </button>`;
    }).join('');
  }

  // Per-frame update from match state. `player` is the player fighter.
  update(state, player, dt) {
    const now = performance.now() / 1000;
    if (this.bannerAt && now > this.bannerAt) this.hideBanner();

    const w = player.weapons[player.current];
    this.el['health-num'].textContent = Math.max(0, Math.ceil(player.hp));
    this.el['health-bar'].style.width = clamp(player.hp, 0, 100) + '%';
    this.el['armour-num'].textContent = Math.ceil(player.armour);
    this.el['armour-bar'].style.width = clamp(player.armour, 0, 100) + '%';
    this.el['ammo-mag'].textContent = w ? w.mag : '—';
    this.el['ammo-reserve'].textContent = w ? '/ ' + w.reserve : '';
    this.el['weapon-name'].textContent = w ? w.def.name : '';
    this.el.ammo && this.el.ammo.classList.toggle('empty', !w || w.mag === 0);
    this.el.money.textContent = '$' + player.money;

    const t = Math.max(0, Math.ceil(state.timer));
    const mm = String(Math.floor(t / 60));
    const ss = String(t % 60).padStart(2, '0');
    this.el.timer.textContent = mm + ':' + ss;
    this.el.timer.classList.toggle('urgent', t <= 10 && state.phase === 'round');
    this.el['round-label'].textContent =
      state.phase === 'buy' ? 'BUY PHASE' : state.phase === 'round' ? 'ROUND ' + state.round : state.phase.toUpperCase();
    this.el['score-v'].textContent = state.score[0];
    this.el['score-j'].textContent = state.score[1];
    const aliveV = state.fighters.filter((f) => f.team === 0 && f.alive).length;
    const aliveJ = state.fighters.filter((f) => f.team === 1 && f.alive).length;
    this.el['alive-v'].textContent = aliveV + ' alive';
    this.el['alive-j'].textContent = aliveJ + ' alive';

    // Bomb status line.
    const bomb = state.bomb;
    let bombText = '';
    if (bomb.state === 'carried') {
      const carrier = state.fighters.find((f) => f.id === bomb.carrier);
      bombText = carrier ? `Charge carried by ${carrier.isPlayer ? 'YOU' : carrier.bot.name}` : 'Charge carried';
    } else if (bomb.state === 'dropped') {
      bombText = 'Charge DROPPED — walk over it to pick up';
    } else if (bomb.state === 'planted') {
      bombText = `CHARGE PLANTED at site ${bomb.site} — ${Math.ceil(bomb.timer)}s`;
    } else if (bomb.state === 'exploded') {
      bombText = 'Charge detonated';
    }
    this.el['bomb-line'].textContent = bombText;

    // Plant/defuse channel bar (player only).
    const prog = state.channelProgress;
    if (prog && prog.active) {
      this.el.channel.hidden = false;
      this.el['channel-fill'].style.width = Math.round(prog.p * 100) + '%';
      this.el['channel-label'].textContent = prog.label;
    } else {
      this.el.channel.hidden = true;
    }

    // Crosshair gap grows with spread.
    const gap = 3 + (state.spreadPx || 0);
    const ch = this.el.crosshair;
    ch.style.setProperty('--gap', gap + 'px');

    this.drawMinimap(state, player);
  }

  drawMinimap(state, player) {
    const ctx = this.minimapCtx;
    if (!ctx) return;
    const W = 160;
    const H = 124;
    const sx = (x) => ((x - BOUNDS.x0) / (BOUNDS.x1 - BOUNDS.x0)) * W;
    const sy = (z) => ((z - BOUNDS.z0) / (BOUNDS.z1 - BOUNDS.z0)) * H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,14,20,0.72)';
    ctx.fillRect(0, 0, W, H);
    // Walls: perimeter rect.
    ctx.strokeStyle = '#8a8d90';
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    // Sites.
    for (const [key, s] of Object.entries(SITES)) {
      ctx.fillStyle = key === 'A' ? '#ffc861' : '#ff9a5c';
      ctx.beginPath();
      ctx.arc(sx(s.x), sy(s.z), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#10141a';
      ctx.font = 'bold 8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key, sx(s.x), sy(s.z));
    }
    // Planted bomb: pulsing dot.
    if (state.bomb.state === 'planted') {
      const p = 0.5 + 0.5 * Math.sin(performance.now() / 130);
      ctx.fillStyle = `rgba(255,60,40,${0.5 + p * 0.5})`;
      ctx.beginPath();
      ctx.arc(sx(state.bomb.x), sy(state.bomb.z), 4 + p * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Fighters: teammates teal dots, enemies only when recently seen (fair:
    // enemies are not shown — only teammates and the player arrow).
    for (const f of state.fighters) {
      if (!f.alive) continue;
      if (f.isPlayer) continue;
      if (f.team !== player.team) continue;
      ctx.fillStyle = '#2fa8a0';
      ctx.beginPath();
      ctx.arc(sx(f.body.x), sy(f.body.z), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow.
    ctx.save();
    ctx.translate(sx(player.body.x), sy(player.body.z));
    ctx.rotate(Math.atan2(-Math.sin(player.body.yaw), -Math.cos(player.body.yaw)) + Math.PI / 2);
    ctx.fillStyle = '#e9e6df';
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.5, 4);
    ctx.lineTo(-3.5, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
