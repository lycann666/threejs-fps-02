// Economy: prices, round rewards, buy logic.
// Money is per fighter; the player buys from the HUD buy menu (B),
// bots buy automatically at round start.
import { WEAPONS, GRENADE, KEVLAR } from './weapons.js';

export const START_MONEY = 800;
export const REWARDS = {
  kill: 300,
  roundWin: 3250,
  roundLoss: 1900,
  lossStreakBonus: 500,
  lossStreakCap: 3400,
  plant: 300,
  defuse: 300,
};

// Buy-menu entries, in display order: {key, id, name, price, owned(fighter)}.
export function buyMenu(fighter) {
  const has = (id) => fighter.weapons.some((w) => w.id === id);
  return [
    { key: '1', id: 'VK47', name: 'VK-47 Carbine', price: WEAPONS.VK47.price, owned: has('VK47') },
    { key: '2', id: 'P9', name: 'P9 Sidearm', price: 0, owned: true },
    { key: '3', id: 'RAPTOR9', name: 'Raptor-9 SMG', price: WEAPONS.RAPTOR9.price, owned: has('RAPTOR9') },
    { key: '4', id: 'LONGBOW', name: 'Longbow DMR', price: WEAPONS.LONGBOW.price, owned: has('LONGBOW') },
    { key: '5', id: 'FRAG', name: 'Frag grenade', price: GRENADE.price, owned: fighter.grenades >= GRENADE.max },
    { key: '6', id: 'KEVLAR', name: 'Kevlar vest', price: KEVLAR.price, owned: fighter.armour >= KEVLAR.armour },
  ];
}

// Attempt a purchase; returns true on success. Adds the weapon / grenade /
// armour to the fighter and deducts money. Weapons are bought with a full mag.
export function buy(fighter, id) {
  const entry = buyMenu(fighter).find((e) => e.id === id);
  if (!entry || entry.owned) return false;
  if (fighter.money < entry.price) return false;
  fighter.money -= entry.price;
  if (id === 'FRAG') {
    fighter.grenades += 1;
  } else if (id === 'KEVLAR') {
    fighter.armour = KEVLAR.armour;
  } else {
    fighter.weapons.push({ id, def: WEAPONS[id], mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve, cooldown: 0, reloading: 0 });
    fighter.current = fighter.weapons.length - 1;
  }
  return true;
}

// Bot shopping at round start: rifle if rich, else SMG; armour if affordable;
// grenade 40% of the time if affordable. Uses the bot's rng.
export function botBuy(fighter, rng) {
  if (fighter.money >= WEAPONS.VK47.price && !fighter.weapons.some((w) => w.id === 'VK47')) {
    buy(fighter, 'VK47');
  } else if (fighter.money >= WEAPONS.RAPTOR9.price && !fighter.weapons.some((w) => w.id === 'RAPTOR9')) {
    buy(fighter, 'RAPTOR9');
  }
  if (fighter.money >= KEVLAR.price && fighter.armour < KEVLAR.armour) buy(fighter, 'KEVLAR');
  if (fighter.money >= GRENADE.price && fighter.grenades < GRENADE.max && rng() < 0.4) buy(fighter, 'FRAG');
  // Refill ammo for owned weapons (free, like a fresh buy each round).
  for (const w of fighter.weapons) {
    w.mag = w.def.mag;
    w.reserve = w.def.reserve;
  }
}

export function roundReward(fighter, won, lossStreak) {
  if (won) return REWARDS.roundWin;
  return Math.min(REWARDS.roundLoss + REWARDS.lossStreakBonus * lossStreak, REWARDS.lossStreakCap);
}
