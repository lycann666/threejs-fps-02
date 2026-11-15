// sim.js — the match. One central state object, one fixed-step `step(dt)`.
// Phases: buy (15 s) -> round (100 s) -> roundEnd (4 s) -> ... -> matchEnd.
// The sim owns all game logic: movement, shooting, bots, bomb, grenades,
// economy, round flow. It pushes presentation events into state.events;
// main.js drains them for audio, effects and the HUD. No DOM, no three.
import { mulberry32, clamp } from './palette.js';
import { createBody, stepBody, groundSpeed, eyeHeight, facing, applyLook } from './player.js';
import { SPAWNS, COLLIDERS, rayWorld, losClear } from './world.js';
import { WEAPONS, GRENADE, falloffDamage, newWeaponState } from './weapons.js';
import { START_MONEY, REWARDS, botBuy, roundReward } from './economy.js';
import { createBomb, updateBomb, dropBomb, siteAt, PLANT_TIME, DEFUSE_TIME, BOMB_TIMER } from './bomb.js';
import { createBotState, updateBot, setRoute } from './bots.js';
import { BOT_NAMES } from './bots.js';
import { moveVector, consumePress, consumeMouse } from './input.js';

export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const ROUND_END_TIME = 4;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

let nextId = 1;

export function createFighter(name, team, isPlayer, x, z, yaw) {
  return {
    id: nextId++,
    name, team, isPlayer,
    alive: true,
    hp: 100,
    armour: 0,
    money: START_MONEY,
    weapons: [newWeaponState('P9')],
    current: 0,
    grenades: 0,
    body: createBody(x, z, yaw),
    bot: isPlayer ? null : createBotState(name, team, Math.random),
    intent: { moveX: 0, moveZ: 0, firing: false, jump: false, crouch: false },
    channel: null,
    recoil: 0,
    deathT: 0,
    walkPhase: 0,
    kills: 0,
    deaths: 0,
    lossStreak: 0,
    attackSite: null,
  };
}

export function createMatch(seed) {
  nextId = 1;
  const rng = mulberry32(seed);
  const state = {
    seed,
    rng,
    time: 0,
    phase: 'buy',
    round: 1,
    timer: BUY_TIME,
    score: [0, 0],
    fighters: [],
    bomb: createBomb(),
    grenades: [],
    events: [],
    winner: null,
    winReason: '',
    lastShotAt: -100,
    lastShotX: 0,
    lastShotZ: 0,
    channelProgress: null,
    spreadPx: 0,
    matchSeed: seed,
    colliders: COLLIDERS,
    // bomb.js calls these on the state object (avoids a circular import).
    damageFighter: (f, amt, atk, cause) => damageFighter(state, f, amt, atk, cause),
    endRound: (team, reason) => endRound(state, team, reason),
  };
  // Player: Vanguard, spawn south, facing north (-z).
  const p = createFighter('You', 0, true, SPAWNS.vanguard[0].x, SPAWNS.vanguard[0].z, 0);
  state.fighters.push(p);
  state.player = p;
  // Vanguard bots.
  BOT_NAMES.vanguard.forEach((name, i) => {
    const s = SPAWNS.vanguard[i + 1];
    const f = createFighter(name, 0, false, s.x, s.z, 0);
    f.attackSite = i % 2 === 0 ? 'A' : 'B';
    state.fighters.push(f);
  });
  // Jackal bots, facing south (+z, yaw PI).
  BOT_NAMES.jackal.forEach((name, i) => {
    const s = SPAWNS.jackal[i];
    const f = createFighter(name, 1, false, s.x, s.z, Math.PI);
    state.fighters.push(f);
  });
  startRound(state);
  return state;
}

function startRound(state) {
  state.phase = 'buy';
  state.timer = BUY_TIME;
  state.grenades = [];
  state.bomb = createBomb();
  // Reset fighters to spawns with fresh weapons (P9 + bought kit refilled).
  const vSpawns = [...SPAWNS.vanguard];
  const jSpawns = [...SPAWNS.jackal];
  let vi = 0;
  let ji = 0;
  for (const f of state.fighters) {
    f.alive = true;
    f.hp = 100;
    f.armour = 0;
    f.grenades = 0;
    f.deathT = 0;
    f.channel = null;
    f.recoil = 0;
    const s = f.team === 0 ? vSpawns[vi++ % vSpawns.length] : jSpawns[ji++ % jSpawns.length];
    f.body = createBody(s.x, s.z, f.team === 0 ? 0 : Math.PI);
    // Keep owned weapons, refill ammo; bots shop.
    if (!f.isPlayer) botBuy(f, state.rng);
    else {
      for (const w of f.weapons) { w.mag = w.def.mag; w.reserve = w.def.reserve; w.reloading = 0; }
    }
    f.weapons.sort((a, b) => (a.id === 'P9' ? 1 : 0) - (b.id === 'P9' ? 1 : 0));
    f.current = 0;
    if (f.bot) {
      f.bot.route = [];
      f.bot.targetId = null;
      f.bot.state = 'route';
      setRoute(f.bot, f.body.x, f.body.z, f.bot.holdNode);
    }
  }
  // Carrier: the player (Vanguard, alive) else a designated Vanguard bot.
  state.bomb.carrier = state.player.id;
  state.events.push({ type: 'roundStart', round: state.round });
}

export function endRound(state, winnerTeam, reason) {
  if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
  state.phase = 'roundEnd';
  state.timer = ROUND_END_TIME;
  state.winner = winnerTeam;
  state.winReason = reason;
  state.score[winnerTeam] += 1;
  for (const f of state.fighters) {
    const won = f.team === winnerTeam;
    const gain = roundReward(f, won, won ? 0 : f.lossStreak);
    f.money += gain;
    f.lossStreak = won ? 0 : f.lossStreak + 1;
  }
  const names = ['Vanguard', 'Jackals'];
  state.events.push({ type: 'roundEnd', winner: winnerTeam, reason, score: [...state.score] });
  state.banner = {
    text: `${names[winnerTeam]} win the round`,
    sub: roundReasonText(reason, winnerTeam),
  };
}

function roundReasonText(reason, winner) {
  if (reason === 'elimination') return winner === 0 ? 'Jackals eliminated' : 'Vanguard eliminated';
  if (reason === 'bomb') return 'The charge detonated — site lost';
  if (reason === 'defuse') return 'The charge was defused';
  if (reason === 'time') return 'Time expired with no plant';
  return '';
}

function nextRound(state) {
  if (state.score[0] >= WIN_ROUNDS || state.score[1] >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
    state.phase = 'matchEnd';
    const winner = state.score[0] > state.score[1] ? 0 : state.score[1] > state.score[0] ? 1 : -1;
    state.events.push({ type: 'matchEnd', winner, score: [...state.score] });
    return;
  }
  state.round += 1;
  startRound(state);
}

// --- Damage ---
export function damageFighter(state, target, amount, attacker, cause) {
  if (!target.alive) return;
  let remaining = amount;
  if (target.armour > 0) {
    const absorbed = Math.min(target.armour, remaining * 0.5);
    target.armour -= absorbed;
    remaining -= absorbed;
  }
  target.hp -= remaining;
  if (target.isPlayer) state.events.push({ type: 'hurt' });
  if (attacker && attacker.isPlayer && target !== attacker) {
    state.events.push({ type: 'hit', kill: target.hp <= 0 });
  }
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths += 1;
    target.deathT = 0;
    if (attacker && attacker !== target) {
      attacker.kills += 1;
      attacker.money += REWARDS.kill;
      state.events.push({
        type: 'killfeed',
        text: `${attacker.isPlayer ? 'You' : attacker.bot.name} ▸ ${target.isPlayer ? 'You' : target.bot.name}${cause === 'headshot' ? '  [HEADSHOT]' : ''}`,
      });
      if (attacker.isPlayer) state.events.push({ type: 'kill' });
    } else {
      state.events.push({
        type: 'killfeed',
        text: `${target.isPlayer ? 'You' : target.bot.name} died${cause === 'bomb' ? ' in the blast' : ''}`,
      });
    }
    if (state.bomb.carrier === target.id) dropBomb(state, target);
  }
}

// --- Shooting (shared by player and bots) ---
function rayHitFighter(ox, oy, oz, dx, dy, dz, maxDist, shooter) {
  let best = null;
  let bestT = maxDist;
  let bestPart = null;
  for (const f of stateFightersCache) {
    if (!f.alive || f === shooter) continue;
    if (f.team === shooter.team) continue;
    // Torso AABB: x/z ±0.32, y +0.7..+1.45. Head sphere at y+1.58, r 0.19.
    const b = f.body;
    const tTorso = rayAABB(ox, oy, oz, dx, dy, dz, b.x - 0.32, b.y + 0.7, b.z - 0.32, b.x + 0.32, b.y + 1.45, b.z + 0.32);
    if (tTorso !== null && tTorso < bestT) {
      best = f; bestT = tTorso; bestPart = 'torso';
    }
    const tHead = raySphere(ox, oy, oz, dx, dy, dz, b.x, b.y + 1.58, b.z, 0.2);
    if (tHead !== null && tHead < bestT) {
      best = f; bestT = tHead; bestPart = 'head';
    }
  }
  return best ? { fighter: best, dist: bestT, part: bestPart } : null;
}

// Set per-step by step(); the ray helpers read it (avoids passing state
// through every call in the hot path).
let stateFightersCache = [];

function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

// Fire one bullet from a fighter. `spread` is radians; `aimErr` overrides
// spread for bots (their computed aim error).
export function shoot(state, fighter, spread) {
  const w = fighter.weapons[fighter.current];
  if (!w || w.mag <= 0 || w.reloading > 0 || w.cooldown > 0) return false;
  w.mag -= 1;
  w.cooldown = w.def.gap;
  const eye = eyeHeight(fighter.body);
  const ox = fighter.body.x;
  const oy = fighter.body.y + eye;
  const oz = fighter.body.z;
  const base = facing(fighter.body);
  // Spread cone: random direction inside a small cone around the facing.
  const r = spread * Math.sqrt(state.rng());
  const a = state.rng() * Math.PI * 2;
  const right = { x: Math.cos(fighter.body.yaw), y: 0, z: -Math.sin(fighter.body.yaw) };
  const up = {
    x: Math.sin(fighter.body.yaw) * Math.sin(fighter.body.pitch),
    y: Math.cos(fighter.body.pitch),
    z: Math.cos(fighter.body.yaw) * Math.sin(fighter.body.pitch),
  };
  let dx = base.x + (right.x * Math.cos(a) + up.x * Math.sin(a)) * r;
  let dy = base.y + (right.y * Math.cos(a) + up.y * Math.sin(a)) * r;
  let dz = base.z + (right.z * Math.cos(a) + up.z * Math.sin(a)) * r;
  const len = Math.hypot(dx, dy, dz);
  dx /= len; dy /= len; dz /= len;

  const worldT = rayWorld(ox, oy, oz, dx, dy, dz, 120);
  const hit = rayHitFighter(ox, oy, oz, dx, dy, dz, 120, fighter);
  // Cap the tracer endpoint: a shot at the sky has no world hit (Infinity).
  const endT = hit && hit.dist < worldT ? hit.dist : (worldT === Infinity ? 120 : worldT);
  const ex = ox + dx * endT;
  const ey = oy + dy * endT;
  const ez = oz + dz * endT;
  state.events.push({ type: 'shot', by: fighter.id, from: { x: ox, y: oy, z: oz }, to: { x: ex, y: ey, z: ez }, kind: w.def.kind });
  state.lastShotAt = state.time;
  state.lastShotX = ox;
  state.lastShotZ = oz;
  if (fighter.isPlayer) fighter.recoil = Math.min(0.09, fighter.recoil + (w.def.kind === 'dmr' ? 0.05 : 0.012));

  if (hit && hit.dist < worldT) {
    let dmg = falloffDamage(w.def, hit.dist);
    if (hit.part === 'head') dmg *= w.def.headMult;
    damageFighter(state, hit.fighter, dmg, fighter, hit.part === 'head' ? 'headshot' : 'shot');
    state.events.push({ type: 'blood', x: ex, y: ey, z: ez });
  } else if (worldT !== Infinity) {
    state.events.push({ type: 'impact', x: ex, y: ey, z: ez });
  }
  return true;
}

function reloadWeapon(w) {
  if (w.reloading > 0 || w.mag >= w.def.mag || w.reserve <= 0) return;
  w.reloading = w.def.reload;
}

// --- Grenades ---
function throwGrenade(state, fighter) {
  if (fighter.grenades <= 0) return;
  fighter.grenades -= 1;
  const eye = eyeHeight(fighter.body);
  const f = facing(fighter.body);
  const g = {
    x: fighter.body.x + f.x * 0.5,
    y: fighter.body.y + eye - 0.1,
    z: fighter.body.z + f.z * 0.5,
    vx: f.x * 13 + fighter.body.vx * 0.5,
    vy: f.y * 13 + 3.5,
    vz: f.z * 13 + fighter.body.vz * 0.5,
    fuse: 2.5,
    owner: fighter.id,
  };
  state.grenades.push(g);
  state.events.push({ type: 'throw' });
}

function updateGrenades(state, dt) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vy -= 12 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    // Bounce off colliders: treat each box as a solid; simple axis resolve.
    let bounced = false;
    for (const c of state.colliders) {
      if (g.x > c.x0 - 0.12 && g.x < c.x1 + 0.12 && g.z > c.z0 - 0.12 && g.z < c.z1 + 0.12 && g.y > c.y0 && g.y < c.y1 + 0.12) {
        // Push out along the smallest penetration and damp that axis.
        const pl = g.x - (c.x0 - 0.12);
        const pr = (c.x1 + 0.12) - g.x;
        const pt = g.z - (c.z0 - 0.12);
        const pb = (c.z1 + 0.12) - g.z;
        const pb2 = (c.y1 + 0.12) - g.y;
        const m = Math.min(pl, pr, pt, pb, pb2);
        if (m === pl) { g.x = c.x0 - 0.12; g.vx = -Math.abs(g.vx) * 0.45; }
        else if (m === pr) { g.x = c.x1 + 0.12; g.vx = Math.abs(g.vx) * 0.45; }
        else if (m === pt) { g.z = c.z0 - 0.12; g.vz = -Math.abs(g.vz) * 0.45; }
        else if (m === pb) { g.z = c.z1 + 0.12; g.vz = Math.abs(g.vz) * 0.45; }
        else { g.y = c.y1 + 0.12; g.vy = Math.abs(g.vy) * 0.45; }
        bounced = true;
      }
    }
    if (g.y < 0.12) {
      g.y = 0.12;
      if (Math.abs(g.vy) > 1.5) bounced = true;
      g.vy = Math.abs(g.vy) * 0.45;
      g.vx *= 0.8;
      g.vz *= 0.8;
    }
    if (bounced) state.events.push({ type: 'bounce', x: g.x, y: g.y, z: g.z });
    if (g.fuse <= 0) {
      state.grenades.splice(i, 1);
      state.events.push({ type: 'explosion', x: g.x, y: g.y, z: g.z });
      const owner = state.fighters.find((f) => f.id === g.owner);
      for (const f of state.fighters) {
        if (!f.alive) continue;
        const d = Math.hypot(f.body.x - g.x, f.body.z - g.z) + Math.abs(f.body.y + 1 - g.y) * 0.5;
        if (d > GRENADE.radius) continue;
        // Line of sight: walls block the blast.
        if (!losClear(g.x, g.y, g.z, f.body.x, f.body.y + 1.2, f.body.z)) continue;
        const dmg = GRENADE.damage * (1 - d / GRENADE.radius);
        damageFighter(state, f, dmg, owner === f ? null : owner, 'grenade');
      }
    }
  }
}

// --- Player step ---
function stepPlayer(state, input, dt) {
  const p = state.player;
  // Dead players still look around (spectating); they cannot move or shoot.
  const { dx, dy } = consumeMouse(input);
  if (!p.alive) {
    applyLook(p.body, dx, dy);
    return;
  }
  applyLook(p.body, dx, dy);
  const move = moveVector(input, p.body.yaw);
  const aiming = input.aiming && p.weapons[p.current].def.kind === 'dmr';
  const speedMul = aiming ? 0.65 : 1;
  p.body.crouched = input.held.has('ControlLeft') || input.held.has('KeyC');
  stepBody(p.body, { x: move.x * speedMul, z: move.z * speedMul }, input.held.has('Space'), dt);

  // Weapon switching first, so the rest of this step uses the new weapon.
  for (let i = 0; i < p.weapons.length; i++) {
    if (consumePress(input, 'Digit' + (i + 1)) && i !== p.current) {
      p.current = i;
      const old = p.weapons.find((w) => w.reloading > 0);
      if (old) old.reloading = 0;
    }
  }
  const w = p.weapons[p.current];
  if (w) {
    w.cooldown = Math.max(0, w.cooldown - dt);
    if (w.reloading > 0) {
      w.reloading -= dt;
      if (w.reloading <= 0) {
        const need = w.def.mag - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
      }
    }
  }
  p.recoil = Math.max(0, p.recoil - dt * 0.5);

  if (consumePress(input, 'KeyR')) reloadWeapon(w);
  if (consumePress(input, 'KeyG')) throwGrenade(state, p);
  if (consumePress(input, 'KeyB') && state.phase === 'buy') {
    state.events.push({ type: 'toggleBuy' });
  }

  // Firing: semi-auto weapons fire on the rising edge only.
  const wantFire = input.firing;
  const edge = wantFire && !p._wasFiring;
  p._wasFiring = wantFire;
  if (w && w.mag === 0 && edge) state.events.push({ type: 'dryfire' });
  if (w && wantFire && (w.def.auto || edge)) {
    const moving = groundSpeed(p.body) > 0.5;
    let spread = moving ? w.def.spreadMove : w.def.spreadStill;
    if (p.body.crouched) spread *= 0.7;
    if (aiming) spread *= 0.35;
    shoot(state, p, spread);
    state.spreadPx = spread * 900;
  }

  // Plant / defuse channels (hold E).
  updatePlayerChannel(state, input, dt);
}

function updatePlayerChannel(state, input, dt) {
  const p = state.player;
  const bomb = state.bomb;
  const holdingE = input.held.has('KeyE');
  state.channelProgress = null;
  if (!holdingE) {
    bomb.planter = null;
    bomb.defuser = null;
    return;
  }
  if (bomb.state === 'carried' && bomb.carrier === p.id) {
    const site = siteAt(p.body.x, p.body.z);
    if (site) {
      bomb.planter = p.id;
      bomb.plantProgress += dt;
      state.channelProgress = { active: true, p: bomb.plantProgress / PLANT_TIME, label: 'PLANTING CHARGE…' };
      if (bomb.plantProgress >= PLANT_TIME) {
        bomb.state = 'planted';
        bomb.site = site;
        bomb.x = p.body.x;
        bomb.z = p.body.z;
        bomb.timer = BOMB_TIMER;
        bomb.plantProgress = 0;
        bomb.planter = null;
        p.money += REWARDS.plant;
        state.events.push({ type: 'planted', site });
      }
      return;
    }
  }
  if (bomb.state === 'planted') {
    const d = Math.hypot(p.body.x - bomb.x, p.body.z - bomb.z);
    if (p.team === 1 && d <= 2.5) {
      bomb.defuser = p.id;
      bomb.defuseProgress += dt;
      state.channelProgress = { active: true, p: bomb.defuseProgress / DEFUSE_TIME, label: 'DEFUSING…' };
      if (bomb.defuseProgress >= DEFUSE_TIME) {
        bomb.state = 'defused';
        p.money += REWARDS.defuse;
        state.events.push({ type: 'defused' });
        endRound(state, 1, 'defuse');
      }
    }
  }
}

// --- Bot step ---
function stepBot(state, fighter, dt) {
  updateBot(state, fighter, dt);
  const intent = fighter.intent;
  fighter.body.crouched = intent.crouch;
  stepBody(fighter.body, { x: intent.moveX, z: intent.moveZ }, intent.jump, dt);
  const w = fighter.weapons[fighter.current];
  if (w) {
    w.cooldown = Math.max(0, w.cooldown - dt);
    if (w.reloading > 0) {
      w.reloading -= dt;
      if (w.reloading <= 0) {
        const need = w.def.mag - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
      }
    }
    if (w.mag === 0) reloadWeapon(w);
  }
  if (intent.firing && w) {
    shoot(state, fighter, fighter.bot.aimErr);
  }
  // Bot plant/defuse channels.
  const bomb = state.bomb;
  if (fighter.channel === 'plant' && bomb.state === 'carried' && bomb.carrier === fighter.id) {
    bomb.planter = fighter.id;
    bomb.plantProgress += dt;
    if (bomb.plantProgress >= PLANT_TIME) {
      const site = siteAt(fighter.body.x, fighter.body.z) || (fighter.bot.attackSite || 'A');
      bomb.state = 'planted';
      bomb.site = site;
      bomb.x = fighter.body.x;
      bomb.z = fighter.body.z;
      bomb.timer = BOMB_TIMER;
      bomb.plantProgress = 0;
      bomb.planter = null;
      fighter.money += REWARDS.plant;
      state.events.push({ type: 'planted', site });
    }
  } else if (fighter.channel === 'defuse' && bomb.state === 'planted') {
    bomb.defuser = fighter.id;
    bomb.defuseProgress += dt;
    if (bomb.defuseProgress >= DEFUSE_TIME) {
      bomb.state = 'defused';
      fighter.money += REWARDS.defuse;
      state.events.push({ type: 'defused' });
      endRound(state, 1, 'defuse');
    }
  }
  // Grenade: bots throw one when an enemy is close and visible (rare).
  if (fighter.grenades > 0 && fighter.bot.targetId !== null && state.rng() < 0.001) {
    throwGrenade(state, fighter);
  }
}

// --- Main step ---
export function step(state, input, dt) {
  state.time += dt;
  stateFightersCache = state.fighters;
  if (state.phase === 'buy') {
    state.timer -= dt;
    if (state.timer <= 0) {
      state.phase = 'round';
      state.timer = ROUND_TIME;
      state.events.push({ type: 'roundLive' });
    }
  } else if (state.phase === 'round') {
    state.timer -= dt;
    if (state.timer <= 0) {
      endRound(state, 1, 'time');
    }
  } else if (state.phase === 'roundEnd') {
    state.timer -= dt;
    if (state.timer <= 0) nextRound(state);
    return;
  } else if (state.phase === 'matchEnd') {
    return;
  }

  if (input) stepPlayer(state, input, dt);
  for (const f of state.fighters) {
    if (!f.isPlayer) stepBot(state, f, dt);
  }
  updateBomb(state, dt);
  updateGrenades(state, dt);

  // Round end by elimination.
  if (state.phase === 'round') {
    const aliveV = state.fighters.some((f) => f.team === 0 && f.alive);
    const aliveJ = state.fighters.some((f) => f.team === 1 && f.alive);
    if (!aliveV) endRound(state, 1, 'elimination');
    else if (!aliveJ) endRound(state, 0, 'elimination');
  }
}
