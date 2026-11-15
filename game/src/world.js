// Kestrel Yard — the map. A decommissioned container terminal at dusk.
// x east, z north (north is -z). Playable x in [-26, 26], z in [-20, 20].
// Vanguard spawn south (z ~ +16), Jackal spawn north (z ~ -16).
// Site A "CRANE" at (-19, -11), site B "SILO" at (19, -11).
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const BOUNDS = { x0: -26, x1: 26, z0: -20, z1: 20 };
export const SITES = {
  A: { name: 'CRANE', x: -19, z: -11, r: 4.5 },
  B: { name: 'SILO', x: 19, z: -11, r: 4.5 },
};
export const SPAWNS = {
  vanguard: [
    { x: -6, z: 16 }, { x: -2, z: 17 }, { x: 2, z: 17 }, { x: 6, z: 16 }, { x: 0, z: 18 },
  ],
  jackal: [
    { x: -6, z: -16 }, { x: -2, z: -17 }, { x: 2, z: -17 }, { x: 6, z: -16 }, { x: 0, z: -18 },
  ],
};

// Waypoints: node name -> {x, z}. Edges are walkable links; bots BFS over them.
export const WAYPOINTS = {
  vs: { x: 0, z: 16 }, v1: { x: -8, z: 14 }, v2: { x: 8, z: 14 },
  w1: { x: -14, z: 8 }, w2: { x: -14, z: -2 }, w3: { x: -20, z: 0 },
  aSite: { x: -19, z: -11 }, aApp: { x: -10, z: -14 },
  m1: { x: 0, z: 8 }, m2: { x: 0, z: 0 }, m3: { x: 0, z: -8 },
  e1: { x: 14, z: 8 }, e2: { x: 14, z: -2 }, e3: { x: 20, z: 0 },
  bSite: { x: 19, z: -11 }, bApp: { x: 10, z: -14 },
  j1: { x: -8, z: -16 }, j2: { x: 8, z: -16 }, js: { x: 0, z: -16 },
};
export const EDGES = [
  ['vs', 'v1'], ['vs', 'v2'], ['vs', 'm1'], ['v1', 'w1'], ['v1', 'm1'],
  ['v2', 'e1'], ['v2', 'm1'], ['w1', 'w2'], ['w1', 'w3'], ['w2', 'aApp'],
  ['w2', 'm2'], ['w3', 'aSite'], ['aSite', 'aApp'], ['aApp', 'm3'],
  ['aApp', 'j1'], ['m1', 'm2'], ['m2', 'm3'], ['m2', 'w2'], ['m2', 'e2'],
  ['m3', 'aApp'], ['m3', 'bApp'], ['m3', 'j1'], ['m3', 'j2'], ['m3', 'js'],
  ['e1', 'e2'], ['e1', 'e3'], ['e2', 'bApp'], ['e2', 'm2'], ['e3', 'bSite'],
  ['bSite', 'bApp'], ['bApp', 'j2'], ['bApp', 'm3'], ['j1', 'js'],
  ['j2', 'js'], ['j1', 'aApp'], ['j2', 'bApp'],
];

const ADJ = {};
for (const n of Object.keys(WAYPOINTS)) ADJ[n] = [];
for (const [a, b] of EDGES) { ADJ[a].push(b); ADJ[b].push(a); }

// BFS route between waypoints; returns an array of node names (start excluded).
export function bfsRoute(from, to) {
  if (from === to) return [];
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const n = queue.shift();
    for (const m of ADJ[n]) {
      if (!(m in prev)) {
        prev[m] = n;
        if (m === to) {
          const path = [m];
          let c = n;
          while (c !== from) { path.unshift(c); c = prev[c]; }
          return path;
        }
        queue.push(m);
      }
    }
  }
  return [to];
}

export function nearestNode(x, z) {
  let best = null;
  let bd = Infinity;
  for (const [name, p] of Object.entries(WAYPOINTS)) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

// Colliders: axis-aligned boxes {x0, z0, x1, z1, y0, y1}. y0 is always 0
// (ground) unless noted; y1 is the top. Bullets and movement both use them.
export const COLLIDERS = [];
function box(x, z, w, d, h, y0 = 0) {
  COLLIDERS.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, y0, y1: y0 + h });
  return COLLIDERS[COLLIDERS.length - 1];
}
// Perimeter walls (h=5).
box(0, -20.5, 54, 1, 5); box(0, 20.5, 54, 1, 5);
box(-26.5, 0, 1, 42, 5); box(26.5, 0, 1, 42, 5);
// Mid maze containers (6 x 2.6 footprint, 1.2 high... actually 2.6 high, 6 long).
box(-4, 4, 6, 2.6, 2.6); box(4, 2, 2.6, 6, 2.6); box(0, -4, 6, 2.6, 2.6);
// Crates 1.1 high.
box(-8, -2, 1.2, 1.2, 1.1); box(8, -6, 1.2, 1.2, 1.1);
box(-2, 10, 1.2, 1.2, 1.1); box(2, 10, 1.2, 1.2, 1.1);
// West lane.
box(-14, 6, 6, 2.6, 2.6); box(-20, 2, 2.6, 6, 2.6);
box(-14, -6, 1.2, 1.2, 1.1); box(-22, -6, 2.6, 2.6, 5.2);
// East lane (mirrored).
box(14, 6, 6, 2.6, 2.6); box(20, 2, 2.6, 6, 2.6);
box(14, -6, 1.2, 1.2, 1.1); box(22, -6, 2.6, 2.6, 5.2);
// Defender side.
box(-8, -14, 6, 2.6, 2.6); box(8, -14, 6, 2.6, 2.6);
box(-2, -16, 1.2, 1.2, 1.1); box(2, -16, 1.2, 1.2, 1.1);
// Gantry crane legs (site A) — thin tall pillars.
box(-22.5, -13.5, 0.8, 0.8, 7); box(-15.5, -13.5, 0.8, 0.8, 7);
box(-22.5, -8.5, 0.8, 0.8, 7); box(-15.5, -8.5, 0.8, 0.8, 7);
// Fuel silo (site B) — cylinder approximated by its square footprint.
box(19, -11, 5.2, 5.2, 7);

// --- Collision + raycast helpers (pure math, no three needed) ---

// Move a circle (radius r, at feet y) through colliders; returns corrected {x, z}.
export function collideCircle(x, z, r) {
  let nx = x;
  let nz = z;
  for (const c of COLLIDERS) {
    if (c.y1 < 0.5) continue; // too low to block a body
    const cx = Math.max(c.x0, Math.min(nx, c.x1));
    const cz = Math.max(c.z0, Math.min(nz, c.z1));
    const dx = nx - cx;
    const dz = nz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nx = cx + (dx / d) * r;
        nz = cz + (dz / d) * r;
      } else {
        // centre inside the box: push out along the smallest penetration axis
        const pl = nx - c.x0 + r;
        const pr = c.x1 - nx + r;
        const pt = nz - c.z0 + r;
        const pb = c.z1 - nz + r;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) nx = c.x0 - r;
        else if (m === pr) nx = c.x1 + r;
        else if (m === pt) nz = c.z0 - r;
        else nz = c.z1 + r;
      }
    }
  }
  nx = Math.max(BOUNDS.x0 + r, Math.min(BOUNDS.x1 - r, nx));
  nz = Math.max(BOUNDS.z0 + r, Math.min(BOUNDS.z1 - r, nz));
  return { x: nx, z: nz };
}

// Ray vs AABB (slab method). Returns distance t or Infinity.
function rayBox(ox, oy, oz, dx, dy, dz, c) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [ox, dx, c.x0, c.x1], [oy, dy, c.y0, c.y1], [oz, dz, c.z0, c.z1],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Nearest world hit along a ray; maxDist caps the range. Ignores boxes
// shorter than 0.5 m (crates still block: they are 1.1 m; nothing is lower).
export function rayWorld(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = Infinity;
  for (const c of COLLIDERS) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, c);
    if (t < best && t <= maxDist) best = t;
  }
  // Floor.
  if (dy < -1e-9) {
    const t = -oy / dy;
    if (t >= 0 && t < best && t <= maxDist) best = t;
  }
  return best;
}

// Line of sight between two points (eye heights given by y values).
export function losClear(ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-6) return true;
  const t = rayWorld(ax, ay, az, dx / dist, dy / dist, dz / dist, dist - 0.05);
  return t === Infinity;
}

// --- Canvas-painted textures (no image files) ---
function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function groundTexture() {
  return canvasTex(1024, 768, (g, w, h) => {
    g.fillStyle = '#3a3f45';
    g.fillRect(0, 0, w, h);
    // asphalt noise
    for (let i = 0; i < 9000; i++) {
      const v = 40 + Math.random() * 40;
      g.fillStyle = `rgb(${v | 0},${(v + 4) | 0},${(v + 8) | 0})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // tyre-worn lanes (mid + west + east), dashed centre lines
    g.strokeStyle = 'rgba(220,190,90,0.55)';
    g.lineWidth = 4;
    g.setLineDash([26, 22]);
    for (const x of [w * 0.5, w * 0.23, w * 0.77]) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    g.setLineDash([]);
    // site rings + letters
    for (const [cx, cy, letter] of [[w * 0.135, h * 0.225, 'A'], [w * 0.865, h * 0.225, 'B']]) {
      g.strokeStyle = '#ffc861';
      g.lineWidth = 6;
      g.beginPath(); g.arc(cx, cy, 62, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,200,97,0.85)';
      g.font = 'bold 64px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(letter, cx, cy);
    }
    // hazard chevrons at the two spawn gates
    g.fillStyle = '#c08a2e';
    for (const gy of [h * 0.92, h * 0.08]) {
      for (let i = 0; i < 12; i++) {
        g.save();
        g.translate(60 + i * 74, gy);
        g.rotate(Math.PI / 4);
        g.fillRect(-14, -5, 28, 10);
        g.restore();
      }
    }
  });
}

function containerTexture(base, label) {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    // corrugation stripes
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x, 0, 5, h);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x + 8, 0, 4, h);
    }
    // rust streaks
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(60,25,8,${0.08 + Math.random() * 0.16})`;
      const x = Math.random() * w;
      g.fillRect(x, Math.random() * h * 0.4, 3 + Math.random() * 6, 20 + Math.random() * 60);
    }
    g.fillStyle = 'rgba(240,235,220,0.85)';
    g.font = 'bold 26px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(label, w / 2, h / 2 + 9);
    g.strokeStyle = 'rgba(240,235,220,0.5)';
    g.lineWidth = 3;
    g.strokeRect(6, 6, w - 12, h - 12);
  });
}

function concreteTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8a8d90';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 110 + Math.random() * 50;
      g.fillStyle = `rgb(${v | 0},${v | 0},${(v + 4) | 0})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    for (let y = 0; y <= h; y += 64) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    for (let x = 0; x <= w; x += 64) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
  });
}

function woodTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#9a7b4f';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 22) {
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.fillRect(0, y, w, 3);
      g.strokeStyle = 'rgba(60,35,10,0.35)';
      g.beginPath();
      g.moveTo(0, y + 11);
      g.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y + 16, w, y + 10);
      g.stroke();
    }
  });
}

// --- Scene building ---
export function buildWorld(scene) {
  const P = PALETTE;
  scene.fog = new THREE.Fog(P.fog, P.fogNear, P.fogFar);
  scene.background = new THREE.Color(P.sky);

  const hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, P.hemiIntensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(P.sun, P.sunIntensity);
  sun.position.set(-30, 38, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 32;
  sun.shadow.camera.bottom = -32;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(P.fill, P.fillIntensity);
  fill.position.set(20, 18, -30);
  scene.add(fill);

  const groundTex = groundTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(52, 40),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Apron outside the walls so the floor does not end at a void.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.05;
  apron.receiveShadow = true;
  scene.add(apron);

  const concreteTex = concreteTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 });
  const wallDefs = [
    [0, -20.5, 54, 5, 1], [0, 20.5, 54, 5, 1], [-26.5, 0, 1, 5, 42], [26.5, 0, 1, 5, 42],
  ];
  for (const [x, z, w, h, d] of wallDefs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  const contTex = {
    rust: containerTexture('#a2542f', 'KST-07'),
    teal: containerTexture('#2f7d7a', 'KST-12'),
    ochre: containerTexture('#c08a2e', 'KST-21'),
    steel: containerTexture('#6d7a80', 'KST-04'),
  };
  const woodTex = woodTexture();
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.9 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x4a5257, roughness: 0.6, metalness: 0.6 });

  // Containers and crates: mesh per collider box (except walls, crane legs, silo).
  const contDefs = [
    // x, z, w, d, h, texture
    [-4, 4, 6, 2.6, 2.6, 'rust'], [4, 2, 2.6, 6, 2.6, 'teal'], [0, -4, 6, 2.6, 2.6, 'ochre'],
    [-14, 6, 6, 2.6, 2.6, 'teal'], [-20, 2, 2.6, 6, 2.6, 'rust'],
    [14, 6, 6, 2.6, 2.6, 'ochre'], [20, 2, 2.6, 6, 2.6, 'teal'],
    [-8, -14, 6, 2.6, 2.6, 'steel'], [8, -14, 6, 2.6, 2.6, 'rust'],
    [-22, -6, 2.6, 2.6, 2.6, 'ochre'], [-22, -6, 2.6, 2.6, 2.6, 'teal'], // double stack: lower + upper
    [22, -6, 2.6, 2.6, 2.6, 'rust'], [22, -6, 2.6, 2.6, 2.6, 'steel'],
  ];
  for (const [x, z, w, d, h, tex] of contDefs) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ map: contTex[tex], roughness: 0.85, metalness: 0.15 }),
    );
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  // Upper boxes of the two double stacks.
  for (const [x, z, tex] of [[-22, -6, 'teal'], [22, -6, 'steel']]) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 2.6, 2.6),
      new THREE.MeshStandardMaterial({ map: contTex[tex], roughness: 0.85, metalness: 0.15 }),
    );
    m.position.set(x, 2.6 + 1.3, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  for (const [x, z] of [[-8, -2], [8, -6], [-2, 10], [2, 10], [-14, -6], [14, -6], [-2, -16], [2, -16]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 1.2), woodMat);
    m.position.set(x, 0.55, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  // Gantry crane over site A: 4 legs, beam, hook block.
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xc08a2e, roughness: 0.7, metalness: 0.4 });
  for (const [x, z] of [[-22.5, -13.5], [-15.5, -13.5], [-22.5, -8.5], [-15.5, -8.5]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7, 0.8), craneMat);
    leg.position.set(x, 3.5, z);
    leg.castShadow = true;
    scene.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(9, 1, 1.2), craneMat);
  beam.position.set(-19, 7.2, -11);
  beam.castShadow = true;
  scene.add(beam);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.9), steelMat);
  hook.position.set(-19, 5.6, -11);
  scene.add(hook);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), steelMat);
  cable.position.set(-19, 6.5, -11);
  scene.add(cable);

  // Fuel silo at site B: cylinder + dome.
  const siloMat = new THREE.MeshStandardMaterial({ color: 0x8a9296, roughness: 0.55, metalness: 0.5 });
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 7, 20), siloMat);
  silo.position.set(19, 3.5, -11);
  silo.castShadow = true;
  silo.receiveShadow = true;
  scene.add(silo);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), siloMat);
  dome.position.set(19, 7, -11);
  dome.castShadow = true;
  scene.add(dome);

  // Site rings on the ground (pulsing markers are driven by hud/sim via material).
  const ringMatA = new THREE.MeshBasicMaterial({ color: P.siteRing, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const ringMatB = ringMatA.clone();
  for (const [site, mat] of [[SITES.A, ringMatA], [SITES.B, ringMatB]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(site.r - 0.25, site.r, 40), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.06, site.z);
    scene.add(ring);
  }

  // Distant skyline silhouettes + low amber moon for depth.
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x1c2636, fog: true });
  const skyline = [
    [-60, -45, 18, 26], [-38, -58, 14, 34], [-8, -62, 22, 22], [22, -55, 12, 30],
    [52, -42, 16, 20], [-70, 10, 14, 18], [68, 22, 18, 24], [-62, 52, 20, 16], [58, 58, 14, 22],
  ];
  for (const [x, z, w, h] of skyline) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 8), skyMat);
    m.position.set(x, h / 2 - 0.05, z);
    scene.add(m);
  }
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(6, 32),
    new THREE.MeshBasicMaterial({ color: P.moon, fog: false }),
  );
  moon.position.set(38, 34, -80);
  moon.lookAt(0, 10, 0);
  scene.add(moon);

  // Sodium lamps: mid, A, B.
  const lamps = [];
  for (const [x, z] of [[0, 0], [-19, -11], [19, -11]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8), steelMat);
    pole.position.set(x + 2.5, 2.7, z);
    pole.castShadow = true;
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: P.lamp, emissiveIntensity: 1.6 }));
    head.position.set(x + 2.5, 5.5, z);
    scene.add(head);
    const light = new THREE.PointLight(P.lamp, 26, 22, 1.8);
    light.position.set(x + 2.5, 5.2, z);
    scene.add(light);
    lamps.push(light);
  }

  return { ringMatA, ringMatB, lamps };
}
