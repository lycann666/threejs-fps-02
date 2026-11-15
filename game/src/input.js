// Input: keyboard + mouse (pointer lock) + edge presses.
// The sim reads `held` every step; `pressed` fires once per keydown.
export function createInput() {
  return {
    held: new Set(), // KeyEvent.code values currently down
    pressed: new Set(), // codes pressed since last consume
    mouseDX: 0,
    mouseDY: 0,
    firing: false,
    aiming: false,
    locked: false,
  };
}

// Attach listeners to a canvas element. Returns a detach function.
export function attachInput(input, canvas, onLockChange) {
  const keydown = (e) => {
    if (e.repeat) return;
    input.held.add(e.code);
    input.pressed.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  };
  const keyup = (e) => input.held.delete(e.code);
  const mousedown = (e) => {
    if (!input.locked) return;
    if (e.button === 0) input.firing = true;
    if (e.button === 2) input.aiming = true;
  };
  const mouseup = (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  };
  const mousemove = (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  };
  const lockchange = () => {
    input.locked = document.pointerLockElement === canvas;
    if (onLockChange) onLockChange(input.locked);
  };
  const contextmenu = (e) => e.preventDefault();
  const blur = () => {
    input.held.clear();
    input.firing = false;
    input.aiming = false;
  };

  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  canvas.addEventListener('mousedown', mousedown);
  window.addEventListener('mouseup', mouseup);
  window.addEventListener('mousemove', mousemove);
  document.addEventListener('pointerlockchange', lockchange);
  canvas.addEventListener('contextmenu', contextmenu);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keyup', keyup);
    canvas.removeEventListener('mousedown', mousedown);
    window.removeEventListener('mouseup', mouseup);
    window.removeEventListener('mousemove', mousemove);
    document.removeEventListener('pointerlockchange', lockchange);
    canvas.removeEventListener('contextmenu', contextmenu);
    window.removeEventListener('blur', blur);
  };
}

// True once when a code was pressed since the last call for that code.
export function consumePress(input, code) {
  if (input.pressed.has(code)) {
    input.pressed.delete(code);
    return true;
  }
  return false;
}

export function consumeMouse(input) {
  const dx = input.mouseDX;
  const dy = input.mouseDY;
  input.mouseDX = 0;
  input.mouseDY = 0;
  return { dx, dy };
}

// WASD movement vector in world space for a given yaw (yaw 0 faces -z, north).
export function moveVector(input, yaw) {
  let fx = 0;
  let fz = 0;
  if (input.held.has('KeyW')) fz -= 1;
  if (input.held.has('KeyS')) fz += 1;
  if (input.held.has('KeyA')) fx -= 1;
  if (input.held.has('KeyD')) fx += 1;
  if (fx === 0 && fz === 0) return { x: 0, z: 0 };
  const len = Math.hypot(fx, fz);
  fx /= len;
  fz /= len;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // Rotate local (right, forward) into world space. Local forward is
  // (0,-1); world forward is (-sin(yaw), -cos(yaw)); world right is
  // (cos(yaw), -sin(yaw)). So: x = fx*cos + fz*sin, z = -fx*sin + fz*cos.
  return {
    x: fx * cos + fz * sin,
    z: fx * -sin + fz * cos,
  };
}
