// Effects: pooled, no per-frame allocation in hot loops.
// One THREE.Points cloud (240 particles) for impact dust, hit puffs and
// explosion fireball/smoke; one THREE.LineSegments cloud (24 slots) for
// tracers; one reusable PointLight for explosion flashes.
import * as THREE from 'three';

const MAX_PARTICLES = 240;
const MAX_TRACERS = 24;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    // Particles: position + velocity + life + colour, stored in typed arrays.
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMaxLife = new Float32Array(MAX_PARTICLES);
    this.pGrav = new Float32Array(MAX_PARTICLES);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.pMat = new THREE.PointsMaterial({
      size: 0.14, vertexColors: true, transparent: true, opacity: 0.95,
      sizeAttenuation: true, depthWrite: false,
    });
    this.points = new THREE.Points(this.pGeo, this.pMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.pCursor = 0;
    // Park all particles far below the map until used.
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -100;

    // Tracers: 24 segments, each with its own fade timer.
    this.tGeo = new THREE.BufferGeometry();
    this.tPos = new Float32Array(MAX_TRACERS * 6);
    this.tLife = new Float32Array(MAX_TRACERS);
    this.tGeo.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3));
    this.tMat = new THREE.LineBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0.9 });
    this.tracers = new THREE.LineSegments(this.tGeo, this.tMat);
    this.tracers.frustumCulled = false;
    this.scene.add(this.tracers);
    this.tCursor = 0;
    for (let i = 0; i < MAX_TRACERS; i++) this.tPos[i * 6 + 1] = -100;

    this.flash = new THREE.PointLight(0xffa040, 0, 18, 1.6);
    this.flash.position.y = -100;
    this.scene.add(this.flash);
    this.flashLife = 0;
  }

  _spawn(x, y, z, vx, vy, vz, life, r, g, b, grav) {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    this.pCol[i * 3] = r; this.pCol[i * 3 + 1] = g; this.pCol[i * 3 + 2] = b;
    this.pLife[i] = life;
    this.pMaxLife[i] = life;
    this.pGrav[i] = grav;
  }

  impact(x, y, z, nx, ny, nz) {
    for (let i = 0; i < 6; i++) {
      this._spawn(
        x, y, z,
        nx * (1 + Math.random() * 2) + (Math.random() - 0.5) * 2,
        ny * (1 + Math.random() * 2) + Math.random() * 1.5,
        nz * (1 + Math.random() * 2) + (Math.random() - 0.5) * 2,
        0.3 + Math.random() * 0.3, 0.75, 0.7, 0.62, 4,
      );
    }
  }

  hitPuff(x, y, z) {
    for (let i = 0; i < 8; i++) {
      this._spawn(
        x, y, z,
        (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2,
        0.35 + Math.random() * 0.25, 0.9, 0.15, 0.12, 2,
      );
    }
  }

  explosion(x, y, z) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 5 + 1;
      const out = Math.random() * 4 + 1;
      const fire = i % 2 === 0;
      this._spawn(
        x, y + 0.3, z,
        Math.cos(a) * out, up, Math.sin(a) * out,
        0.6 + Math.random() * 0.7,
        fire ? 1 : 0.25, fire ? 0.55 : 0.22, fire ? 0.15 : 0.18,
        fire ? -2 : 1.5,
      );
    }
    this.flash.position.set(x, y + 1.2, z);
    this.flash.intensity = 160;
    this.flashLife = 0.25;
  }

  tracer(from, to) {
    const i = this.tCursor;
    this.tCursor = (this.tCursor + 1) % MAX_TRACERS;
    this.tPos[i * 6] = from.x; this.tPos[i * 6 + 1] = from.y; this.tPos[i * 6 + 2] = from.z;
    this.tPos[i * 6 + 3] = to.x; this.tPos[i * 6 + 4] = to.y; this.tPos[i * 6 + 5] = to.z;
    this.tLife[i] = 0.07;
  }

  update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pPos[i * 3 + 1] = -100;
        continue;
      }
      this.pVel[i * 3 + 1] -= this.pGrav[i] * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pPos[i * 3 + 1] < 0.02) {
        this.pPos[i * 3 + 1] = 0.02;
        this.pVel[i * 3 + 1] = 0;
      }
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (this.tLife[i] > 0) {
        this.tLife[i] -= dt;
        if (this.tLife[i] <= 0) this.tPos[i * 6 + 1] = -100;
      }
    }
    this.tGeo.attributes.position.needsUpdate = true;
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flash.intensity = Math.max(0, this.flash.intensity - dt * 700);
      if (this.flashLife <= 0) this.flash.position.y = -100;
    }
  }
}
