// Bots: 9 AI fighters. States: route -> hold -> engage -> plant/defuse -> hunt.
// Perception is throttled to every 0.15 s; reaction time 0.35–0.6 s after
// first sighting. Shooting is bursts with aim error that grows with
// distance, target speed and own speed. Hearing: gunshots within 30 m
// alert bots to the shooter's position.
import * as THREE from 'three';
import { WAYPOINTS, bfsRoute, nearestNode, losClear } from './world.js';
import { PALETTE, clamp } from './palette.js';
import { stepBody, groundSpeed } from './player.js';

export const BOT_NAMES = {
  vanguard: ['Rook', 'Heron', 'Moss', 'Pike'],
  jackal: ['Vex', 'Grit', 'Sable', 'Hex', 'Wren'],
};

const DEFEND_HOLDS = {
  // defenders: 2 hold A, 2 hold B, 1 roams mid.
  Vex: 'aSite', Grit: 'aApp', Sable: 'bSite', Hex: 'bApp', Wren: 'm3',
};
const ATTACK_SITES = { Rook: 'aSite', Heron: 'bSite', Moss: 'aSite', Pike: 'bSite' };

export function createBotState(name, team, rng) {
  return {
    name,
    state: 'route',
    route: [],
    routeIdx: 0,
    holdNode: team === 1 ? DEFEND_HOLDS[name] : ATTACK_SITES[name] || 'm2',
    holdUntil: 0,
    targetId: null,
    lastSeen: 0,
    lastSeenX: 0,
    lastSeenZ: 0,
    hearX: 0,
    hearZ: 0,
    hearAt: -100,
    reactAt: 0,
    thinkAt: 0,
    burstLeft: 0,
    burstAt: 0,
    burstPauseUntil: 0,
    strafeDir: rng() < 0.5 ? -1 : 1,
    strafeAt: 0,
    aimErr: 0.03,
    plantAt: 0,
  };
}

// Pick a route for a bot: from its nearest waypoint to a destination node.
export function setRoute(bot, fromX, fromZ, dest) {
  const from = nearestNode(fromX, fromZ);
  bot.route = bfsRoute(from, dest);
  bot.routeIdx = 0;
  bot.state = 'route';
}

// One fixed step of AI. Sets fighter.intent; movement + firing are applied
// by sim.js. `sim` carries fighters, bomb, time, rng.
export function updateBot(sim, fighter, dt) {
  const bot = fighter.bot;
  const rng = sim.rng;
  const now = sim.time;
  const intent = fighter.intent;
  intent.moveX = 0;
  intent.moveZ = 0;
  intent.firing = false;
  intent.jump = false;
  intent.crouch = false;
  fighter.channel = null;

  if (!fighter.alive) return;

  // --- Perception (throttled) ---
  if (now >= bot.thinkAt) {
    bot.thinkAt = now + 0.15;
    const eyeY = fighter.body.y + 1.62;
    let best = null;
    let bd = Infinity;
    for (const other of sim.fighters) {
      if (!other.alive || other.team === fighter.team) continue;
      const dx = other.body.x - fighter.body.x;
      const dz = other.body.z - fighter.body.z;
      const d = Math.hypot(dx, dz);
      if (d > 48) continue;
      const oy = other.body.y + 1.3;
      if (!losClear(fighter.body.x, eyeY, fighter.body.z, other.body.x, oy, other.body.z)) continue;
      if (d < bd) { bd = d; best = other; }
    }
    if (best) {
      if (bot.targetId !== best.id) {
        bot.targetId = best.id;
        bot.reactAt = now + 0.35 + rng() * 0.25;
      }
      bot.lastSeen = now;
      bot.lastSeenX = best.body.x;
      bot.lastSeenZ = best.body.z;
      bot.targetDist = bd;
    } else if (bot.targetId !== null && now - bot.lastSeen > 2.5) {
      bot.targetId = null;
    }
    // Hearing: a recent shot within 30 m.
    if (sim.lastShotAt > bot.hearAt && now - sim.lastShotAt < 0.6) {
      const d = Math.hypot(sim.lastShotX - fighter.body.x, sim.lastShotZ - fighter.body.z);
      if (d < 30 && d > 2) {
        bot.hearX = sim.lastShotX;
        bot.hearZ = sim.lastShotZ;
        bot.hearAt = now;
      }
    }
  }

  const target = bot.targetId !== null
    ? sim.fighters.find((f) => f.id === bot.targetId && f.alive) : null;
  if (target && bot.targetId !== null && !target) bot.targetId = null;

  // --- Bomb duties override movement ---
  const bomb = sim.bomb;
  if (fighter.team === 0 && bomb.carrier === fighter.id && bomb.state === 'carried') {
    // Carrier: go to the nearest site and plant.
    const siteKey = bombSiteFor(fighter, sim);
    const site = siteKey === 'A' ? { x: -19, z: -11 } : { x: 19, z: -11 };
    const d = Math.hypot(site.x - fighter.body.x, site.z - fighter.body.z);
    if (d <= 4.0 && !target) {
      fighter.channel = 'plant';
      bot.state = 'plant';
      facePoint(fighter, site.x, site.z);
      return;
    }
    if (bot.state !== 'route' || bot.routeDest !== siteKey) {
      setRoute(bot, fighter.body.x, fighter.body.z, siteKey === 'A' ? 'aSite' : 'bSite');
      bot.routeDest = siteKey;
    }
  } else if (fighter.team === 1 && bomb.state === 'planted') {
    // Defenders: route to the planted site; nearest defuses.
    const site = bomb.site === 'A' ? { x: -19, z: -11 } : { x: 19, z: -11 };
    const d = Math.hypot(site.x - fighter.body.x, site.z - fighter.body.z);
    const nearest = nearestDefender(sim, bomb.site);
    if (d <= 2.5 && nearest === fighter) {
      fighter.channel = 'defuse';
      bot.state = 'defuse';
      facePoint(fighter, site.x, site.z);
      return;
    }
    if (bot.state !== 'route' || bot.routeDest !== ('plant' + bomb.site)) {
      setRoute(bot, fighter.body.x, fighter.body.z, bomb.site === 'A' ? 'aSite' : 'bSite');
      bot.routeDest = 'plant' + bomb.site;
    }
  }

  // --- Engage: target visible and reaction time passed ---
  if (target && now >= bot.reactAt) {
    bot.state = 'engage';
    const dx = target.body.x - fighter.body.x;
    const dz = target.body.z - fighter.body.z;
    const dist = Math.hypot(dx, dz);
    facePoint(fighter, target.body.x, target.body.z);
    // Strafe while firing; change direction every 0.7–1.4 s.
    if (now >= bot.strafeAt) {
      bot.strafeAt = now + 0.7 + rng() * 0.7;
      bot.strafeDir = rng() < 0.5 ? -1 : 1;
    }
    const fx = -Math.sin(fighter.body.yaw);
    const fz = -Math.cos(fighter.body.yaw);
    const rx = -fz;
    const rz = fx;
    const strafe = dist > 14 ? bot.strafeDir : 0;
    intent.moveX = rx * strafe * 0.7;
    intent.moveZ = rz * strafe * 0.7;
    // Bursts of 3–5 with pauses.
    if (bot.burstLeft <= 0 && now >= bot.burstPauseUntil) {
      bot.burstLeft = 3 + Math.floor(rng() * 3);
      bot.burstAt = now;
    }
    if (bot.burstLeft > 0 && now >= bot.burstAt) {
      intent.firing = true;
      bot.burstLeft -= 1;
      bot.burstAt = now + 0.09 + rng() * 0.04;
      if (bot.burstLeft === 0) bot.burstPauseUntil = now + 0.5 + rng() * 0.6;
    }
    // Aim error for this shot (used by sim when the bot fires).
    const tSpeed = groundSpeed(target.body);
    const oSpeed = groundSpeed(fighter.body);
    bot.aimErr = 0.028 + dist * 0.0011 + tSpeed * 0.008 + oSpeed * 0.02;
    // Pitch toward the target's chest.
    const dy = (target.body.y + 1.25) - (fighter.body.y + 1.5);
    fighter.body.pitch = clamp(Math.atan2(dy, dist), -1.2, 1.2);
    return;
  }

  // --- Route / hold ---
  if (bot.state === 'engage') {
    // Lost the target: return to route/hold.
    bot.state = 'route';
    setRoute(bot, fighter.body.x, fighter.body.z, bot.holdNode);
  }
  if (bot.route.length === 0) {
    // Arrived: hold this node, watch an angle, then pick a new hold.
    if (now >= bot.holdUntil) {
      bot.holdUntil = now + 3 + rng() * 4;
      // Defenders stay near their hold; attackers drift between sites/mid.
      if (fighter.team === 1) {
        setRoute(bot, fighter.body.x, fighter.body.z, bot.holdNode);
      } else {
        const dest = rng() < 0.5 ? 'aSite' : (rng() < 0.5 ? 'bSite' : 'm2');
        setRoute(bot, fighter.body.x, fighter.body.z, dest);
      }
      return;
    }
    // Hold: small drift + slow scan.
    fighter.body.yaw += Math.sin(now * 0.6 + fighter.id) * 0.004;
    if (now - bot.hearAt < 3) facePoint(fighter, bot.hearX, bot.hearZ);
    return;
  }
  // Follow the route.
  const node = WAYPOINTS[bot.route[bot.routeIdx]];
  const dx = node.x - fighter.body.x;
  const dz = node.z - fighter.body.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.9) {
    bot.routeIdx += 1;
    if (bot.routeIdx >= bot.route.length) bot.route = [];
    return;
  }
  intent.moveX = dx / d;
  intent.moveZ = dz / d;
  facePoint(fighter, node.x, node.z);
  // Crouch occasionally when holding a lane (flavour, keeps the profile low).
  if (fighter.team === 1 && bot.state === 'route' && rng() < 0.002) intent.crouch = true;
}

function facePoint(fighter, x, z) {
  const dx = x - fighter.body.x;
  const dz = z - fighter.body.z;
  fighter.body.yaw = Math.atan2(-dx, -dz);
}

function bombSiteFor(fighter, sim) {
  // Carrier's site: the one assigned at round start, else the nearer one.
  if (fighter.bot.attackSite) return fighter.bot.attackSite;
  const da = Math.hypot(-19 - fighter.body.x, -11 - fighter.body.z);
  const db = Math.hypot(19 - fighter.body.x, -11 - fighter.body.z);
  return da <= db ? 'A' : 'B';
}

function nearestDefender(sim, site) {
  const s = site === 'A' ? { x: -19, z: -11 } : { x: 19, z: -11 };
  let best = null;
  let bd = Infinity;
  for (const f of sim.fighters) {
    if (!f.alive || f.team !== 1) continue;
    const d = Math.hypot(f.body.x - s.x, f.body.z - s.z);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

// --- Bot meshes (torso, head + helmet, legs, gun) ---
export function buildBotMesh(fighter) {
  const teamColor = fighter.team === 0 ? PALETTE.vanguard : PALETTE.jackal;
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a17e, roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), suit);
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.34), dark);
  vest.position.y = 1.1;
  g.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin);
  head.position.y = 1.58;
  head.castShadow = true;
  g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
  helmet.position.y = 1.62;
  g.add(helmet);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.2), dark);
  legL.position.set(-0.14, 0.36, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.14;
  g.add(legR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.55), dark);
  gun.position.set(0.2, 1.15, -0.3);
  g.add(gun);
  // Name tag: a small floating sprite is expensive; the HUD kill feed
  // carries names instead. Store refs for the death fall-over.
  g.userData = { torso, head, legL, legR, gun };
  return g;
}

// Sync a bot mesh from fighter state (position, yaw, death fall-over).
// Called every frame by main.js; no allocation.
export function syncBotMesh(fighter, mesh, dt) {
  const b = fighter.body;
  mesh.position.set(b.x, b.y, b.z);
  if (!fighter.alive) {
    fighter.deathT = Math.min(1, (fighter.deathT || 0) + dt / 0.4);
    mesh.rotation.x = -1.45 * fighter.deathT;
    mesh.position.y = b.y + 0.15 * fighter.deathT;
    return;
  }
  mesh.rotation.set(0, b.yaw, 0);
  // Walk cycle: swing the legs with speed.
  const sp = groundSpeed(b);
  const ph = (fighter.walkPhase || 0) + dt * sp * 2.2;
  fighter.walkPhase = ph;
  const swing = Math.min(0.5, sp * 0.09) * Math.sin(ph);
  mesh.userData.legL.rotation.x = swing;
  mesh.userData.legR.rotation.x = -swing;
}
