// Player / bot body physics: one shared AABB mover.
// Position is the feet. Height 1.8 standing, 1.2 crouched. Radius 0.4.
import { collideCircle } from './world.js';
import { clamp } from './palette.js';

export const BODY = {
  radius: 0.4,
  height: 1.8,
  crouchHeight: 1.2,
  eyeStanding: 1.62,
  eyeCrouch: 1.05,
  walkSpeed: 5.2,
  crouchSpeed: 2.6,
  aimSpeed: 3.4,
  accel: 42,
  friction: 11,
  jumpSpeed: 6.4,
  gravity: 17,
};

export function createBody(x, z, yaw = 0) {
  return {
    x, z, y: 0, // y = feet height above ground
    vx: 0, vy: 0, vz: 0,
    yaw, pitch: 0,
    crouched: false,
    onGround: true,
  };
}

// One fixed step. `move` is a normalized {x, z} wish direction (world space).
// Returns nothing; mutates body.
export function stepBody(body, move, wishJump, dt) {
  const speed = body.crouched ? BODY.crouchSpeed : BODY.walkSpeed;
  const tx = move.x * speed;
  const tz = move.z * speed;
  // Accelerate toward the wish velocity; friction when no wish.
  const k = move.x !== 0 || move.z !== 0 ? BODY.accel * dt : BODY.friction * dt;
  body.vx += (tx - body.vx) * Math.min(1, k);
  body.vz += (tz - body.vz) * Math.min(1, k);
  if (move.x === 0 && move.z === 0) {
    body.vx *= Math.max(0, 1 - BODY.friction * dt * 0.6);
    body.vz *= Math.max(0, 1 - BODY.friction * dt * 0.6);
  }
  body.x += body.vx * dt;
  body.z += body.vz * dt;
  const fixed = collideCircle(body.x, body.z, BODY.radius);
  body.x = fixed.x;
  body.z = fixed.z;

  if (wishJump && body.onGround && !body.crouched) {
    body.vy = BODY.jumpSpeed;
    body.onGround = false;
  }
  if (!body.onGround) {
    body.vy -= BODY.gravity * dt;
    body.y += body.vy * dt;
    if (body.y <= 0) {
      body.y = 0;
      body.vy = 0;
      body.onGround = true;
    }
  }
}

export function groundSpeed(body) {
  return Math.hypot(body.vx, body.vz);
}

export function eyeHeight(body) {
  return body.y + (body.crouched ? BODY.eyeCrouch : BODY.eyeStanding);
}

export function applyLook(body, dx, dy, sens = 0.0023) {
  body.yaw -= dx * sens;
  body.pitch = clamp(body.pitch - dy * sens, -1.45, 1.45);
}

// Direction the body faces, as a unit vector.
export function facing(body) {
  const cp = Math.cos(body.pitch);
  return {
    x: -Math.sin(body.yaw) * cp,
    y: Math.sin(body.pitch),
    z: -Math.cos(body.yaw) * cp,
  };
}
