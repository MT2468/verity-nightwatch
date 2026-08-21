export const MAP_W = 24;
export const MAP_H = 24;

function buildMap() {
  const map = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(0));

  for (let x = 0; x < MAP_W; x += 1) {
    map[0][x] = 1;
    map[MAP_H - 1][x] = 1;
  }
  for (let y = 0; y < MAP_H; y += 1) {
    map[y][0] = 1;
    map[y][MAP_W - 1] = 1;
  }

  const hWall = (y, x1, x2, type = 1, gaps = []) => {
    for (let x = x1; x <= x2; x += 1) {
      if (!gaps.includes(x)) map[y][x] = type;
    }
  };
  const vWall = (x, y1, y2, type = 1, gaps = []) => {
    for (let y = y1; y <= y2; y += 1) {
      if (!gaps.includes(y)) map[y][x] = type;
    }
  };

  hWall(5, 2, 10, 1, [4, 8]);
  vWall(10, 2, 11, 2, [4, 9]);
  hWall(9, 5, 15, 1, [8, 12]);
  vWall(5, 8, 18, 1, [11, 16]);
  hWall(14, 2, 18, 2, [5, 11, 16]);
  vWall(15, 3, 21, 1, [7, 13, 18]);
  hWall(19, 3, 14, 1, [6, 10, 13]);
  vWall(19, 6, 20, 2, [10, 15]);
  hWall(4, 13, 21, 1, [16, 20]);
  hWall(11, 17, 22, 1, [19, 21]);
  vWall(8, 16, 22, 2, [19, 21]);

  // Small block clusters, kept deliberately sparse so the space stays navigable.
  map[7][3] = 1; map[7][4] = 1;
  map[12][7] = 2; map[12][8] = 2;
  map[17][11] = 1; map[17][12] = 1;
  map[6][18] = 2; map[7][18] = 2;
  map[20][18] = 1; map[20][19] = 1;

  return map;
}

export const WORLD_MAP = buildMap();

export const RELAYS = [
  { id: 0, x: 3.5, y: 3.5, label: "RELÉ A", active: false },
  { id: 1, x: 18.5, y: 2.5, label: "RELÉ B", active: false },
  { id: 2, x: 3.5, y: 20.5, label: "RELÉ C", active: false },
  { id: 3, x: 20.5, y: 18.5, label: "RELÉ D", active: false },
];

export const EXIT_NODE = { x: 21.5, y: 21.5 };
export const PLAYER_START = { x: 2.5, y: 2.5, angle: 0.18 };
export const VERITY_START = { x: 1.82, y: 3.72 };
export const SHADOW_START = { x: 21.2, y: 2.2 };

export function tileAt(x, y) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return 1;
  return WORLD_MAP[ty][tx];
}

export function isWall(x, y) {
  return tileAt(x, y) !== 0;
}

export function canStand(x, y, radius = 0.22) {
  return !isWall(x - radius, y - radius)
    && !isWall(x + radius, y - radius)
    && !isWall(x - radius, y + radius)
    && !isWall(x + radius, y + radius);
}

export function resetRelays() {
  for (const relay of RELAYS) relay.active = false;
}
