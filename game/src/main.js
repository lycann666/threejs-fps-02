// main.js — boot, render loop, camera, view model, event drain, shot mode.
// The sim owns all game logic; this file owns three.js presentation.
// Fixed 60 Hz accumulator; rendering reads sim state every frame.
// ?shot=start|play|bomb|end&seed=N renders a deterministic frozen frame
// for screenshots, then sets window.__shotReady.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { createMatch, step } from './sim.js';
import { createInput, attachInput } from './input.js';
import { eyeHeight } from './player.js';
import { buildViewModel } from './weapons.js';
import { buildBotMesh, syncBotMesh } from './bots.js';
import { buildBombMesh } from './bomb.js';
import { Sfx } from './audio.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { buy } from './economy.js';

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const SHOT_MODE = !!shot;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = buildWorld(scene);
const effects = new Effects(scene);
const sfx = new Sfx();
const hud = new Hud(document);

const state = createMatch(seed);
const input = createInput();

// --- Fighters' meshes ---
const botMeshes = new Map();
for (const f of state.fighters) {
  if (f.isPlayer) continue;
  const mesh = buildBotMesh(f);
  scene.add(mesh);
  botMeshes.set(f.id, mesh);
}
const bombMesh = buildBombMesh();
scene.add(bombMesh);

// --- View model (the player's gun, attached to the camera) ---
let viewModel = buildViewModel('P9');
let viewModelId = 'P9';
camera.add(viewModel);
viewModel.position.set(0.28, -0.26, -0.5);
viewModel.rotation.set(0, 0, 0);
const flashLight = new THREE.PointLight(0xffc861, 0, 6, 2);
flashLight.position.set(0.28, -0.2, -1.1);
camera.add(flashLight);
let flashT = 0;

// --- Input + overlays ---
let paused = false;
attachInput(input, renderer.domElement, (locked) => {
  if (SHOT_MODE) return;
  if (!locked && state.phase !== 'matchEnd' && !state.player.alive) return; // dead: stay spectating
  if (!locked && state.phase !== 'matchEnd') {
    paused = true;
    hud.showOverlay('Paused', 'Click to keep playing. Your team fights on without you.', 'Resume');
  } else {
    paused = false;
    hud.hideOverlay();
  }
});

hud.el.play.addEventListener('click', () => {
  if (state.phase === 'matchEnd') {
    location.reload();
    return;
  }
  sfx.ensure();
  hud.hideOverlay();
  paused = false;
  renderer.domElement.requestPointerLock();
});
hud.el['buy-list'].addEventListener('click', (e) => {
  const btn = e.target.closest('[data-buy]');
  if (!btn) return;
  if (buy(state.player, btn.dataset.buy)) {
    sfx.buy();
    hud.renderBuy(state.player);
  }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Event drain: sim events -> audio / effects / HUD ---
function drainEvents() {
  for (const ev of state.events) {
    switch (ev.type) {
      case 'shot': {
        const by = state.fighters.find((f) => f.id === ev.by);
        sfx.shot(ev.kind);
        effects.tracer(ev.from, ev.to);
        if (by && by.isPlayer) {
          flashT = 0.06;
          viewModel.userData.flash.material.opacity = 0.95;
          flashLight.intensity = 14;
        }
        break;
      }
      case 'impact':
        effects.impact(ev.x, ev.y, ev.z, 0, 1, 0);
        break;
      case 'blood':
        effects.hitPuff(ev.x, ev.y, ev.z);
        break;
      case 'explosion':
        effects.explosion(ev.x, ev.y, ev.z);
        sfx.explosion();
        break;
      case 'beep':
        sfx.beep(ev.urgent);
        break;
      case 'hit':
        hud.flashHit(ev.kill);
        sfx.hit();
        break;
      case 'kill':
        sfx.kill();
        break;
      case 'hurt':
        hud.damageFlash();
        sfx.hurt();
        break;
      case 'killfeed':
        hud.killfeedAdd(ev.text);
        break;
      case 'roundStart':
        hud.banner(`ROUND ${ev.round}`, 'Buy phase — press B for the buy menu', 4);
        hud.setBuyOpen(true, state.player);
        break;
      case 'roundLive':
        hud.setBuyOpen(false);
        hud.banner('GO', '', 1.2);
        break;
      case 'roundEnd': {
        const names = ['Vanguard', 'Jackals'];
        const won = ev.winner === state.player.team;
        hud.banner(`${names[ev.winner]} win the round`, state.banner?.sub || '', 4);
        if (won) sfx.roundWin(); else sfx.roundLose();
        break;
      }
      case 'planted':
        hud.banner('CHARGE PLANTED', `Site ${ev.site} — 35 seconds to detonation`, 3);
        break;
      case 'defused':
        hud.banner('CHARGE DEFUSED', 'Jackals hold the site', 3);
        break;
      case 'pickup':
        hud.killfeedAdd('Charge picked up');
        break;
      case 'drop':
        hud.killfeedAdd('Charge dropped');
        break;
      case 'toggleBuy':
        hud.setBuyOpen(!hud.buyOpen, state.player);
        break;
      case 'dryfire':
        sfx.dryFire();
        break;
      case 'throw':
        sfx.grenadeThrow();
        break;
      case 'bounce':
        sfx.bounce();
        break;
      case 'matchEnd': {
        const names = ['Vanguard', 'Jackals'];
        const title = ev.winner === -1 ? 'Draw' : `${names[ev.winner]} win the match`;
        hud.showOverlay(title, `Final score Vanguard ${ev.score[0]} — ${ev.score[1]} Jackals. First to 5 rounds.`, 'Play again');
        break;
      }
      default:
        break;
    }
  }
  state.events.length = 0;
}

// --- Camera + view model sync ---
let bobPhase = 0;
function syncCamera(dt) {
  const p = state.player;
  const b = p.body;
  camera.position.set(b.x, b.y + eyeHeight(b), b.z);
  const pitch = b.pitch + p.recoil;
  camera.rotation.y = b.yaw;
  camera.rotation.x = pitch;
  // DMR zoom on right-click aim.
  const aiming = input.aiming && p.weapons[p.current]?.def.kind === 'dmr';
  const targetFov = aiming ? 45 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }
  // View model: swap when the weapon changes; bob + recoil kick.
  const wid = p.weapons[p.current]?.id;
  if (wid && wid !== viewModelId) {
    camera.remove(viewModel);
    viewModel = buildViewModel(wid);
    viewModelId = wid;
    camera.add(viewModel);
    viewModel.position.set(0.28, -0.26, -0.5);
  }
  const speed = Math.hypot(b.vx, b.vz);
  bobPhase += dt * speed * 1.6;
  const bob = Math.min(1, speed / 5) * 0.012;
  viewModel.position.y = -0.26 + Math.sin(bobPhase * 2) * bob;
  viewModel.position.x = 0.28 + Math.cos(bobPhase) * bob * 0.6;
  viewModel.position.z = -0.5 + p.recoil * 1.6;
  if (flashT > 0) {
    flashT -= dt;
    if (flashT <= 0) {
      viewModel.userData.flash.material.opacity = 0;
      flashLight.intensity = 0;
    }
  }
  // Bomb mesh follows bomb state; its light blinks when planted.
  const bomb = state.bomb;
  if (bomb.state === 'planted' || bomb.state === 'dropped') {
    bombMesh.visible = true;
    bombMesh.position.set(bomb.x, 0.14, bomb.z);
    const blink = bomb.state === 'planted' ? (Math.sin(state.time * 8) > 0 ? 1 : 0.15) : 1;
    bombMesh.userData.light.material.color.setRGB(1, blink * 0.25, blink * 0.2);
  } else {
    bombMesh.visible = false;
  }
  // Site rings pulse gently.
  const pulse = 0.45 + 0.2 * Math.sin(state.time * 2);
  world.ringMatA.opacity = pulse;
  world.ringMatB.opacity = pulse;
}

// --- Shot mode: deterministic staged frames ---
function runShot(name) {
  const p = state.player;
  if (name === 'start') {
    // Buy phase at spawn, looking down mid lane.
    p.body.yaw = 0;
    p.body.pitch = -0.02;
    for (let i = 0; i < 30; i++) step(state, null, 1 / 60);
    hud.setBuyOpen(true, p);
  } else if (name === 'play') {
    // Mid-round firefight: walk up the centre gap of mid for ~2.5 s AFTER
    // the round goes live (not during buy phase), then hold and fight
    // with a slow scan. Start at x=0 so the walk stays in the open lane
    // between the mid containers (spawn x=-6 faces a container 3 m ahead).
    p.body.yaw = 0;
    p.body.x = 0;
    const scripted = {
      held: new Set(),
      pressed: new Set(),
      mouseDX: 0, mouseDY: 0, firing: false, aiming: false, locked: true,
    };
    let steps = 0;
    let roundStartStep = -1;
    while (steps < 60 * 24) {
      if (state.phase === 'round' && roundStartStep < 0) roundStartStep = steps;
      const intoRound = roundStartStep < 0 ? 0 : steps - roundStartStep;
      if (state.phase === 'round' && intoRound < 150) scripted.held.add('KeyW');
      else scripted.held.delete('KeyW');
      scripted.firing = state.phase === 'round' && steps % 90 < 40 && intoRound > 60 * 3;
      scripted.mouseDX = state.phase === 'round' && intoRound > 150 ? Math.sin(steps * 0.02) * 1.5 : 0;
      step(state, scripted, 1 / 60);
      steps++;
      if (state.phase === 'roundEnd') break;
    }
    drainEvents();
    // Stage the frame: full magazine, no transient banner, no muzzle flash
    // (drainEvents leaves the last shot's flash lit; syncCamera(0) never
    // decays it, so hide it explicitly before the frozen render).
    const w = p.weapons[p.current];
    if (w) { w.mag = w.def.mag; w.reloading = 0; }
    hud.hideBanner();
    hud.setBuyOpen(false);
    flashT = 0;
    viewModel.userData.flash.material.opacity = 0;
    flashLight.intensity = 0;
  } else if (name === 'bomb') {
    // Plant moment at site A: force the plant, player beside the site.
    state.bomb.state = 'planted';
    state.bomb.site = 'A';
    state.bomb.x = -19;
    state.bomb.z = -11;
    state.bomb.timer = 32;
    // Stage it as mid-round, not buy phase.
    state.phase = 'round';
    state.timer = 62;
    p.body.x = -12;
    p.body.z = -4;
    p.body.yaw = Math.atan2(-(-19 - p.body.x), -(-11 - p.body.z));
    p.body.pitch = 0.02;
    for (let i = 0; i < 20; i++) step(state, null, 1 / 60);
    drainEvents();
    hud.setBuyOpen(false);
    hud.banner('CHARGE PLANTED', 'Site A — 32 seconds to detonation', 30);
  } else if (name === 'end') {
    // Round-won banner + scoreboard feel: end round 1 for Vanguard.
    state.score = [1, 0];
    state.phase = 'roundEnd';
    state.timer = 3;
    state.banner = { text: 'Vanguard win the round', sub: 'Jackals eliminated' };
    hud.banner('Vanguard win the round', 'Jackals eliminated', 30);
    p.body.yaw = 0.4;
    p.body.pitch = 0;
    for (let i = 0; i < 10; i++) step(state, null, 1 / 60);
    drainEvents();
    hud.setBuyOpen(false);
    hud.banner('Vanguard win the round', 'Jackals eliminated', 30);
  }
  // Sync meshes once, render twice, freeze.
  for (const f of state.fighters) {
    if (!f.isPlayer) syncBotMesh(f, botMeshes.get(f.id), 0);
  }
  syncCamera(0);
  hud.update(state, p, 0);
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  window.__shotReady = true;
}

// --- Main loop ---
let last = performance.now();
let acc = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const frameDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (paused || state.phase === 'matchEnd') {
    // Still render (frozen scene) so the overlay sits over the game.
    syncCamera(0);
    renderer.render(scene, camera);
    return;
  }
  acc += frameDt;
  const dt = 1 / 60;
  let n = 0;
  while (acc >= dt && n < 5) {
    step(state, input, dt);
    acc -= dt;
    n++;
  }
  drainEvents();
  for (const f of state.fighters) {
    if (!f.isPlayer) syncBotMesh(f, botMeshes.get(f.id), frameDt);
  }
  syncCamera(frameDt);
  hud.update(state, state.player, frameDt);
  effects.update(frameDt);
  renderer.render(scene, camera);
}

if (SHOT_MODE) {
  hud.hideOverlay();
  runShot(shot);
} else {
  hud.showOverlay(
    'KESTREL YARD',
    'Vanguard vs Jackals — plant the charge at CRANE or SILO, or eliminate the other team. First to 5 rounds. Click to play.',
    'Click to play',
  );
  requestAnimationFrame(loop);
}
