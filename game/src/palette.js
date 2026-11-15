// Kestrel Yard — palette: one dusk palette for the whole game.
// Slate-blue dusk sky, warm sodium amber, rust containers, concrete.
export const PALETTE = {
  sky: 0x2b3a55,
  fog: 0x141a26,
  fogNear: 30,
  fogFar: 95,
  hemiSky: 0x33415e,
  hemiGround: 0x1a1410,
  hemiIntensity: 0.95,
  sun: 0xffb36b,
  sunIntensity: 2.4,
  fill: 0x5a6b8c,
  fillIntensity: 0.5,
  lamp: 0xffa640,
  ground: 0x3a3f45,
  concrete: 0x8a8d90,
  rust: 0xa2542f,
  teal: 0x2f7d7a,
  ochre: 0xc08a2e,
  steel: 0x6d7a80,
  wood: 0x9a7b4f,
  vanguard: 0x2fa8a0, // teal — attackers
  jackal: 0xc65a35, // rust red — defenders
  siteRing: 0xffc861,
  moon: 0xffd9a0,
};

// mulberry32: small deterministic RNG, seeded per match / per shot.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
