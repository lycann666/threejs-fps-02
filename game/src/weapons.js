// Weapons: definitions, magazine state, view models.
// Damage falloff and armour are applied in sim.js; this module owns the
// numbers and the first-person view model.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// key: buy-menu key. gap: seconds between shots. spread: radians (still / moving).
export const WEAPONS = {
  P9: {
    id: 'P9', name: 'P9 Sidearm', key: '2', price: 0,
    mag: 12, reserve: 24, damage: 26, headMult: 4, gap: 0.16, reload: 1.4,
    spreadStill: 0.004, spreadMove: 0.03, auto: false, kind: 'pistol',
    falloff: [[20, 0.8], [35, 0.65]],
  },
  VK47: {
    id: 'VK47', name: 'VK-47 Carbine', key: '1', price: 2700,
    mag: 30, reserve: 90, damage: 34, headMult: 4, gap: 0.1, reload: 2.0,
    spreadStill: 0.0022, spreadMove: 0.028, auto: true, kind: 'rifle',
    falloff: [[25, 0.8], [40, 0.6]],
  },
  RAPTOR9: {
    id: 'RAPTOR9', name: 'Raptor-9 SMG', key: '3', price: 1500,
    mag: 32, reserve: 96, damage: 22, headMult: 4, gap: 0.075, reload: 1.7,
    spreadStill: 0.006, spreadMove: 0.038, auto: true, kind: 'smg',
    falloff: [[15, 0.75], [30, 0.5]],
  },
  LONGBOW: {
    id: 'LONGBOW', name: 'Longbow DMR', key: '4', price: 4750,
    mag: 5, reserve: 15, damage: 88, headMult: 4, gap: 1.1, reload: 3.0,
    spreadStill: 0.0008, spreadMove: 0.05, auto: false, kind: 'dmr',
    falloff: [],
  },
};
export const WEAPON_ORDER = ['VK47', 'P9', 'RAPTOR9', 'LONGBOW'];
export const GRENADE = { id: 'FRAG', name: 'Frag grenade', price: 300, max: 2, damage: 120, radius: 6 };
export const KEVLAR = { id: 'KEVLAR', name: 'Kevlar vest', price: 650, armour: 100 };

// Damage after falloff at a distance (metres).
export function falloffDamage(def, dist) {
  let mult = 1;
  for (const [d, m] of def.falloff) {
    if (dist > d) mult = m;
  }
  return def.damage * mult;
}

export function newWeaponState(id) {
  const def = WEAPONS[id];
  return { id, def, mag: def.mag, reserve: def.reserve, cooldown: 0, reloading: 0 };
}

// --- View models (first-person gun, built from boxes; one per weapon) ---
const VM_MATS = {
  body: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.45, metalness: 0.7 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x3a2f24, roughness: 0.9 }),
  accent: new THREE.MeshStandardMaterial({ color: PALETTE.lamp, roughness: 0.4, metalness: 0.4 }),
};

export function buildViewModel(id) {
  const g = new THREE.Group();
  const add = (w, h, d, x, y, z, mat = VM_MATS.body) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  if (id === 'P9') {
    add(0.07, 0.09, 0.3, 0, 0, -0.12);
    add(0.06, 0.12, 0.09, 0, -0.09, 0.02, VM_MATS.grip);
    add(0.02, 0.03, 0.05, 0, 0.055, -0.24, VM_MATS.accent);
  } else if (id === 'VK47') {
    add(0.08, 0.11, 0.62, 0, 0, -0.2);
    add(0.05, 0.14, 0.1, 0, -0.1, -0.05, VM_MATS.grip);
    add(0.06, 0.2, 0.08, 0, -0.13, -0.28, VM_MATS.grip); // foregrip
    add(0.07, 0.06, 0.3, 0, 0.02, -0.05); // handguard
    add(0.015, 0.04, 0.06, 0, 0.075, -0.46, VM_MATS.accent); // front sight
  } else if (id === 'RAPTOR9') {
    add(0.08, 0.1, 0.42, 0, 0, -0.16);
    add(0.05, 0.16, 0.07, 0, -0.11, -0.02, VM_MATS.grip);
    add(0.045, 0.18, 0.06, 0, -0.12, -0.3); // long mag
    add(0.02, 0.03, 0.04, 0, 0.06, -0.34, VM_MATS.accent);
  } else { // LONGBOW
    add(0.07, 0.1, 0.78, 0, 0, -0.26);
    add(0.05, 0.13, 0.09, 0, -0.1, 0.02, VM_MATS.grip);
    add(0.06, 0.09, 0.16, 0, 0.09, -0.2); // scope
    add(0.05, 0.05, 0.12, 0, 0, -0.62); // barrel tip
  }
  // Muzzle flash: a soft radial glow (canvas texture), not a flat square.
  // Small (0.16) so it reads as a flash, not a wall, at arm's length.
  const flashTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,240,180,1)');
    grad.addColorStop(0.4, 'rgba(255,200,97,0.85)');
    grad.addColorStop(1, 'rgba(255,160,40,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  flash.position.set(0, 0.01, id === 'LONGBOW' ? -0.68 : id === 'VK47' ? -0.52 : -0.38);
  g.add(flash);
  g.userData.flash = flash;
  return g;
}
