// Bomb: plant / defuse channels, timer, explosion, dropped-bomb pickup.
// The bomb is carried by one Vanguard (the carrier). On the carrier's death
// it drops where they fell; any living Vanguard within 1.5 m picks it up.
// Plant: hold E in a site zone for 3 s. Defuse: hold E at the planted site
// for 5 s. Planted bomb: 35 s timer, beeps speed up as it runs down.
import * as THREE from 'three';
import { SITES } from './world.js';
import { clamp } from './palette.js';

export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const BOMB_TIMER = 35;

export function createBomb() {
  return {
    state: 'carried', // carried | dropped | planted | exploded | defused
    carrier: null, // fighter id
    site: null, // 'A' | 'B' when planted
    x: 0, z: 0, // dropped / planted position
    timer: BOMB_TIMER,
    plantProgress: 0,
    defuseProgress: 0,
    planter: null, // fighter id currently channelling a plant
    defuser: null, // fighter id currently channelling a defuse
    beepAt: 0,
  };
}

export function siteAt(x, z) {
  for (const [key, s] of Object.entries(SITES)) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d <= s.r) return key;
  }
  return null;
}

// Mesh: a small dark charge with a blinking amber light. Built once, moved
// by main.js from bomb state (carried = hidden on the carrier's back).
export function buildBombMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.24, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 }),
  );
  g.add(body);
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff5040 }),
  );
  light.position.set(0.12, 0.14, 0);
  g.add(light);
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.43, 0.03, 0.31),
    new THREE.MeshBasicMaterial({ color: 0xffc861 }),
  );
  strip.position.y = 0.1;
  g.add(strip);
  g.userData.light = light;
  return g;
}

// Per-step update. `sim` is the match state (fighters, events, time).
// Returns nothing; mutates bomb + pushes events.
export function updateBomb(sim, dt) {
  const bomb = sim.bomb;
  if (bomb.state === 'planted') {
    bomb.timer -= dt;
    // Beep faster as the timer runs down: every 1 s, then 0.5 s under 10 s.
    const interval = bomb.timer < 10 ? 0.5 : 1;
    if (sim.time - bomb.beepAt >= interval) {
      bomb.beepAt = sim.time;
      sim.events.push({ type: 'beep', urgent: bomb.timer < 10 });
    }
    if (bomb.timer <= 0) {
      bomb.state = 'exploded';
      sim.events.push({ type: 'explosion', x: bomb.x, z: bomb.z, site: bomb.site });
      // The blast kills everyone in the open within 12 m (through walls: no).
      for (const f of sim.fighters) {
        if (!f.alive) continue;
        const d = Math.hypot(f.body.x - bomb.x, f.body.z - bomb.z);
        if (d < 12) sim.damageFighter(f, 1000, null, 'bomb');
      }
      sim.endRound(0, 'bomb');
    }
    return;
  }

  // Dropped bomb pickup: nearest living Vanguard within 1.5 m becomes carrier.
  if (bomb.state === 'dropped') {
    let best = null;
    let bd = Infinity;
    for (const f of sim.fighters) {
      if (!f.alive || f.team !== 0) continue;
      const d = Math.hypot(f.body.x - bomb.x, f.body.z - bomb.z);
      if (d < bd) { bd = d; best = f; }
    }
    if (best && bd <= 1.5) {
      bomb.state = 'carried';
      bomb.carrier = best.id;
      sim.events.push({ type: 'pickup', by: best.id });
    }
    return;
  }
  // 'carried': nothing to do here; planting is driven by sim channels.
  if (bomb.state !== 'carried') return;

  // Carrier died? The carrier is re-checked in sim.damageFighter; this is
  // a safety net in case the carrier reference went stale.
  const carrier = sim.fighters.find((f) => f.id === bomb.carrier);
  if (!carrier || !carrier.alive) {
    if (carrier) {
      bomb.state = 'dropped';
      bomb.x = carrier.body.x;
      bomb.z = carrier.body.z;
      sim.events.push({ type: 'drop', x: bomb.x, z: bomb.z });
    } else {
      bomb.carrier = sim.fighters.find((f) => f.team === 0 && f.alive)?.id ?? null;
    }
  }
}

// Called by sim when the carrier dies: drop the bomb at their feet.
export function dropBomb(sim, carrier) {
  const bomb = sim.bomb;
  if (bomb.state !== 'carried' || bomb.carrier !== carrier.id) return;
  bomb.state = 'dropped';
  bomb.x = carrier.body.x;
  bomb.z = carrier.body.z;
  bomb.plantProgress = 0;
  bomb.planter = null;
  sim.events.push({ type: 'drop', x: bomb.x, z: bomb.z });
}

export function plantProgress01(bomb) {
  return clamp(bomb.plantProgress / PLANT_TIME, 0, 1);
}

export function defuseProgress01(bomb) {
  return clamp(bomb.defuseProgress / DEFUSE_TIME, 0, 1);
}
