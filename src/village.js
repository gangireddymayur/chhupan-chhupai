// Rampur: a small Indian village at night. Everything the game knows about the map lives here:
// tiles (what the ground is), objects (furniture, trees, vehicles), lights, named places and hiding spots.
// Coordinates are grid tiles: x grows to the lower right on screen, y grows to the lower left.
export const N = 36;

export const T = {
  GROUND: 'ground', SHOULDER: 'shoulder', ROAD: 'road', CC: 'cc', GULLY: 'gully',
  FLOOR: 'floor', WALL: 'wall', DOOR: 'door', WATER: 'water', YARD: 'yard', FIELD: 'field',
};

export const ROOM_NAMES = {
  bedroom: 'bedroom', kitchen: 'kitchen', hall: 'hall', puja: 'puja room', bath: 'bathroom',
  aangan: 'aangan (courtyard)', shop: 'shop', store: 'godown', shed: 'cattle shed', class: 'classroom',
};

export const TILE_NAMES = {
  ground: 'open ground', shoulder: 'road side', road: 'tar road', cc: 'cement road', gully: 'gully',
  floor: 'floor', wall: 'wall', door: 'doorway', water: 'water', yard: 'temple yard', field: 'field',
};

export function buildVillage() {
  const tiles = [];
  for (let y = 0; y < N; y++) {
    const row = [];
    for (let x = 0; x < N; x++) row.push({ t: T.GROUND, place: 'Open ground' });
    tiles.push(row);
  }
  const at = (x, y) => (x >= 0 && y >= 0 && x < N && y < N ? tiles[y][x] : null);
  const fill = (x0, y0, x1, y1, props) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const t = at(x, y); if (t) Object.assign(t, props); }
  };

  const objects = [], lights = [], labels = [], hideSpots = [], houses = [], wires = [];
  const add = (kind, x, y, p = {}) => objects.push({ kind, x, y, ...p });
  const light = (x, y, z, r, color, k = 0.9, p = {}) => lights.push({ x, y, z, r, color, k, ...p });
  const label = (text, x, y, z = 30) => labels.push({ text, x, y, z });
  const hide = (name, x, y) => hideSpots.push({ name, x, y });

  // ---------- open areas ----------
  fill(0, 8, 6, 14, { t: T.YARD, place: 'Shiv Mandir yard' });
  fill(18, 6, 26, 14, { place: 'Peepal maidan' });
  fill(24, 0, 26, 5, { place: 'Behind Gupta house' });
  fill(28, 7, 35, 14, { place: 'Talab bank' });
  fill(29, 8, 34, 13, { t: T.WATER, place: 'Talab (pond)' });
  fill(0, 20, 7, 26, { place: 'Chai tapri corner' });
  fill(25, 20, 25, 26, { place: 'School side lane' });
  fill(26, 28, 35, 35, { place: 'Tank ground' });
  fill(9, 33, 15, 35, { t: T.FIELD, place: 'Bhindi field' });
  fill(14, 28, 15, 32, { t: T.FIELD, place: 'Bhindi field' });

  // ---------- roads ----------
  fill(0, 15, N - 1, 15, { t: T.SHOULDER, place: 'Main road side' });
  fill(0, 19, N - 1, 19, { t: T.SHOULDER, place: 'Main road side' });
  fill(0, 16, N - 1, 18, { t: T.ROAD, place: 'Main road' });
  for (let y = 0; y < N; y++) for (const x of [16, 17]) {
    const t = at(x, y);
    if (t.t === T.ROAD) t.place = 'Chowk (crossing)';
    else Object.assign(t, { t: T.CC, place: 'CC road' });
  }
  const gully = (x0, y0, x1, y1, name) => fill(x0, y0, x1, y1, { t: T.GULLY, place: name, dir: x0 === x1 ? 'v' : 'h' });
  gully(7, 0, 7, 14, 'Sharma–Verma gully');
  gully(0, 7, 15, 7, 'Mandir gully');
  gully(27, 0, 27, 14, 'Talab gully');
  gully(8, 20, 8, 35, 'Kirana gully');
  gully(0, 27, 15, 27, 'Khan gully');
  gully(18, 27, 35, 27, 'School gully');

  // ---------- houses ----------
  // rooms: [x0, y0, x1, y1, type, lightsOn]; the edges of each room rectangle are walls, rooms share walls
  // doors: [x, y, isMainDoor]
  function house(name, color, rooms, doors) {
    const h = { name, color, rooms: [] };
    for (const [x0, y0, x1, y1, type, lit = true] of rooms) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = at(x, y);
        const edge = x === x0 || x === x1 || y === y0 || y === y1;
        if (edge) { if (t.t !== T.FLOOR) Object.assign(t, { t: T.WALL, house: name, color, place: name }); }
        else Object.assign(t, { t: T.FLOOR, floor: type, house: name, lit, place: `${name} · ${ROOM_NAMES[type]}` });
      }
      h.rooms.push({ x0, y0, x1, y1, type, lit });
      if (lit) {
        const iw = x1 - x0 - 1, ih = y1 - y0 - 1;
        light((x0 + 1 + x1) / 2, (y0 + 1 + y1) / 2, 30, Math.max(iw, ih) * 0.52 + 0.65, '#ffd59a', 0.93, { kind: 'bulb' });
      }
    }
    const around = (x, y) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [x, y, main] of doors) {
      const t = at(x, y);
      const inside = around(x, y).map(([a, b]) => at(a, b)).find((q) => q && q.t === T.FLOOR && q.house === name);
      const along = at(x - 1, y)?.t === T.WALL || at(x + 1, y)?.t === T.WALL ? 'x' : 'y';
      Object.assign(t, { t: T.DOOR, house: name, color, floor: inside ? inside.floor : 'hall', along, main: !!main,
        place: `${name} · ${main ? 'main door' : 'doorway'}` });
      if (main === true) {
        const out = around(x, y).find(([a, b]) => { const q = at(a, b); return q && ![T.FLOOR, T.WALL, T.DOOR].includes(q.t); });
        if (out) add('rangoli', out[0], out[1], { flat: true, seed: x * 3 + y });
      }
    }
    houses.push(h);
    return h;
  }

  // Sharma house (green)
  house('Sharma house', '#a3c98f', [[0, 0, 3, 3, 'bedroom'], [3, 0, 6, 3, 'kitchen'], [0, 3, 6, 6, 'hall']],
    [[2, 3], [5, 3], [3, 6, true]]);
  add('bed', 1.1, 1.08, { w: 0.85, d: 1.82, color: '#c0504d' });
  add('almirah', 2.3, 1.05, { w: 0.62, d: 0.42 });
  add('counter', 4.02, 1.02, { w: 1.96, d: 0.45, stove: true });
  add('gas', 5.7, 2.45); add('matka', 4.35, 2.6);
  add('rug', 1.5, 4.55, { w: 2.4, d: 1.1, color: '#9e3a2b', flat: true });
  add('sofa', 1.15, 4.05, { w: 1.7, d: 0.55, color: '#7b2d3b', back: 'y0' });
  add('tv', 4.2, 5.55, { w: 1.0, d: 0.38 }); light(4.7, 5.4, 18, 0.9, '#8fbfff', 0.55, { kind: 'tv' });
  add('puja', 5.45, 4.05, { w: 0.5, d: 0.45 });

  // Verma house (pink) — family asleep, bedroom dark
  house('Verma house', '#e9a3b6', [[8, 0, 12, 4, 'hall'], [12, 0, 15, 4, 'bedroom', false], [8, 4, 10, 6, 'bath'], [10, 4, 15, 6, 'kitchen']],
    [[12, 2], [9, 4], [11, 4], [8, 2, true]]);
  add('charpai', 9.15, 1.15, { w: 0.8, d: 1.7 });
  add('table', 10.4, 2.3, { w: 0.9, d: 0.6 });
  add('cooler', 11.3, 1.08, { w: 0.6, d: 0.5 });
  add('bed', 13.1, 1.1, { w: 0.85, d: 1.82, color: '#3d6fb6', sleeper: true });
  add('almirah', 14.3, 1.05, { w: 0.6, d: 0.42 });
  add('bucket', 9.45, 5.45);
  add('counter', 11.05, 5.5, { w: 2.0, d: 0.45, stove: true });
  add('gas', 13.45, 5.3); add('drum', 14.5, 5.5);

  // Shiv Mandir yard
  add('temple', 2, 9, { w: 3, d: 3 });
  light(3.5, 12.35, 6, 1.6, '#ff9d3d', 0.95, { kind: 'diya', flicker: 'diya' });
  light(3.5, 11.8, 40, 2.2, '#ffc777', 0.8, { kind: 'bulb' });
  add('cow', 3.6, 13.6, { stone: true, s: 0.7 });
  add('well', 5.4, 13.3, { r: 0.42 });
  add('tree', 0.9, 13.1, { type: 'neem' });
  add('bush', 5.6, 8.6);

  // Yadav house (yellow) with an aangan
  house('Yadav house', '#f2d16b', [[8, 8, 11, 11, 'bedroom'], [11, 8, 15, 11, 'kitchen'], [8, 11, 15, 14, 'aangan']],
    [[9, 11], [13, 11], [15, 12, true]]);
  add('bed', 9.1, 9.08, { w: 0.85, d: 1.82, color: '#6a994e' });
  add('almirah', 10.3, 9.05, { w: 0.6, d: 0.42 });
  add('counter', 12.02, 9.02, { w: 2.96, d: 0.45, stove: true });
  add('gas', 14.6, 10.55); add('matka', 12.35, 10.6);
  add('tulsi', 11.4, 12.55);
  add('handpump', 9.45, 13.4);
  add('charpai', 12.6, 12.12, { w: 1.7, d: 0.8 });
  add('clothesline', 9.2, 12.15, { x2: 10.9, y2: 12.15 });
  add('bicycle', 13.4, 13.55);

  // Gupta house (sky blue) and the peepal maidan
  house('Gupta house', '#9cc8e8', [[18, 0, 23, 3, 'hall'], [18, 3, 21, 5, 'bedroom'], [21, 3, 23, 5, 'bath']],
    [[19, 3], [22, 3], [23, 2, true]]);
  add('sofa', 19.1, 1.05, { w: 1.6, d: 0.55, color: '#4a4e69', back: 'y0' });
  add('tv', 20.55, 2.55, { w: 0.95, d: 0.36 }); light(21, 2.4, 18, 0.9, '#8fbfff', 0.55, { kind: 'tv' });
  add('cooler', 22.3, 1.1, { w: 0.6, d: 0.5 });
  add('bed', 19.05, 4.08, { w: 1.85, d: 0.85, color: '#e07a5f' });
  add('bucket', 22.45, 4.45);
  add('tree', 25.3, 2.6, { type: 'neem' });
  add('bush', 24.4, 4.8);

  add('chabutra', 21, 9, { w: 3, d: 3 });
  add('tree', 22.25, 9.85, { type: 'peepal', base: 10, bias: 1 });
  add('haystack', 25.4, 7.4, { r: 0.62 });
  add('haystack', 19.2, 13.3, { r: 0.55 });
  add('cow', 25.1, 12.4);
  add('charpai', 18.35, 6.35, { w: 1.6, d: 0.75 });

  // Reddy house (peach) and the talab
  house('Reddy house', '#e9b384', [[28, 0, 32, 6, 'hall'], [32, 0, 35, 3, 'bedroom'], [32, 3, 35, 6, 'kitchen']],
    [[32, 2], [32, 4], [28, 3, true]]);
  add('rug', 29.6, 1.6, { w: 1.6, d: 2.2, color: '#355070', flat: true });
  add('sofa', 29.05, 1.1, { w: 0.55, d: 1.8, color: '#6d597a', back: 'x0' });
  add('tv', 31.5, 1.9, { w: 0.36, d: 1.0 }); light(31.4, 2.4, 18, 0.9, '#8fbfff', 0.55, { kind: 'tv' });
  add('table', 29.6, 4.1, { w: 1.2, d: 0.8 });
  add('puja', 31.4, 5.45, { w: 0.5, d: 0.45 });
  add('bed', 33.05, 1.08, { w: 1.85, d: 0.85, color: '#b56576' });
  add('almirah', 34.35, 2.5, { w: 0.55, d: 0.42 });
  add('counter', 34.5, 4.02, { w: 0.45, d: 1.96, stove: true });
  add('gas', 33.3, 5.6); add('matka', 33.35, 4.35);

  add('ghat', 28.15, 9.2, { w: 0.85, d: 2.6 });
  add('tree', 28.5, 7.6, { type: 'coconut', lean: 12 });
  add('tree', 35.3, 13.5, { type: 'coconut', lean: -10 });
  add('tree', 35.2, 8.3, { type: 'coconut', lean: 8 });
  add('reeds', 34.85, 7.6); add('reeds', 28.6, 13.7); add('reeds', 33.2, 14.5);

  // chai tapri corner
  add('tapri', 4.1, 20.15, { w: 1.9, d: 1.0 });
  light(5.0, 20.7, 36, 2.4, '#ffcf73', 0.95, { kind: 'lantern' });
  add('bench', 3.05, 21.55, { w: 0.4, d: 1.3 });
  add('bench', 6.45, 21.55, { w: 0.4, d: 1.3 });
  add('handpump', 1.4, 21.2);
  add('auto', 0.85, 23.7, { w: 1.4, d: 0.75 });
  add('cart', 2.7, 25.2, { w: 1.1, d: 0.6 });
  add('tree', 6.6, 24.3, { type: 'neem' });
  add('dog', 5.6, 25.6);
  add('bush', 0.6, 20.5);

  // Kirana store (open shop) and its dark godown
  house('Kirana store', '#d7c49e', [[9, 20, 15, 23, 'shop'], [9, 23, 15, 26, 'store', false]],
    [[11, 20, true], [12, 20, 2], [13, 23]]);
  add('shelf', 10.05, 21.0, { w: 0.45, d: 2.0 });
  add('shelf', 14.5, 21.0, { w: 0.45, d: 2.0 });
  add('counter', 11.2, 22.35, { w: 2.2, d: 0.5, shop: true });
  add('sacks', 10.3, 24.3, { n: 3 }); add('sacks', 11.6, 24.4, { n: 2 }); add('sacks', 13.7, 25.1, { n: 3 });
  add('drum', 14.5, 24.4);

  // Khan house (mint)
  house('Khan house', '#a7d3c4', [[0, 28, 4, 32, 'hall'], [4, 28, 7, 32, 'bedroom'], [0, 32, 4, 35, 'kitchen'], [4, 32, 7, 35, 'bath']],
    [[4, 30], [2, 32], [5, 32], [2, 28, true]]);
  add('rug', 1.7, 29.4, { w: 1.5, d: 1.9, color: '#bc4b51', flat: true });
  add('sofa', 1.05, 29.1, { w: 0.55, d: 1.8, color: '#3d5a80', back: 'x0' });
  add('tv', 3.55, 29.6, { w: 0.36, d: 0.95 }); light(3.4, 30.1, 18, 0.9, '#8fbfff', 0.55, { kind: 'tv' });
  add('bed', 5.05, 29.1, { w: 0.85, d: 1.82, color: '#8d5a97' });
  add('almirah', 6.35, 30.5, { w: 0.55, d: 0.42 });
  add('counter', 1.02, 33.05, { w: 2.96, d: 0.45, stove: true });
  add('gas', 3.6, 34.6); add('matka', 1.35, 34.5);
  add('bucket', 5.4, 33.5); add('drum', 6.45, 34.45);

  // cattle shed and fields
  house('Cattle shed', '#b89b72', [[9, 28, 13, 32, 'shed', false]], [[11, 32, 2]]);
  add('trough', 10.1, 29.1, { w: 1.6, d: 0.4 });
  add('cow', 10.6, 30.6, { buffalo: true });
  add('cow', 12.1, 31.0, { buffalo: true, flip: true });
  add('haystack', 12.4, 29.5, { r: 0.4 });
  add('haystack', 12.6, 34.4, { r: 0.6 });

  // Pandit house (salmon) with a puja room
  house('Pandit house', '#f2a7a0', [[18, 20, 24, 23, 'hall'], [18, 23, 21, 26, 'bedroom'], [21, 23, 24, 26, 'puja']],
    [[19, 23], [22, 23], [21, 20, true]]);
  add('charpai', 19.1, 21.1, { w: 1.7, d: 0.75 });
  add('cooler', 20.6, 22.45, { w: 0.6, d: 0.45 });
  add('tv', 23.55, 21.05, { w: 0.36, d: 1.0 }); light(23.4, 21.6, 18, 0.9, '#8fbfff', 0.55, { kind: 'tv' });
  add('bed', 19.05, 24.08, { w: 1.85, d: 0.85, color: '#e9c46a' });
  add('almirah', 19.1, 25.5, { w: 0.6, d: 0.42 });
  add('puja', 22.25, 25.45, { w: 1.5, d: 0.45 });
  light(23, 25.5, 14, 1.0, '#ff9d3d', 0.9, { kind: 'diya', flicker: 'diya' });
  add('rangoli', 22, 24, { flat: true, seed: 7 });

  // Government school, closed at night (dark)
  house('Govt. school', '#cfd8b8', [[26, 20, 31, 26, 'class', false], [31, 20, 35, 26, 'class', false]],
    [[28, 20, 2], [33, 20, 2], [31, 23]]);
  add('blackboard', 27.05, 21.3, { w: 0.14, d: 2.6 });
  for (const y of [21.6, 22.9, 24.2]) { add('desk', 27.7, y, { w: 1.1, d: 0.45 }); add('desk', 29.2, y, { w: 1.1, d: 0.45 }); }
  add('blackboard', 32.05, 21.3, { w: 0.14, d: 2.6 });
  for (const y of [21.6, 22.9, 24.2]) add('desk', 32.7, y, { w: 1.6, d: 0.45 });

  // Mehta house (lavender) and the tank ground
  house('Mehta house', '#c4b3e6', [[18, 28, 22, 33, 'hall'], [22, 28, 25, 31, 'kitchen'], [22, 31, 25, 35, 'aangan'], [18, 33, 22, 35, 'bedroom']],
    [[22, 29], [22, 32], [20, 33], [20, 28, true], [25, 33, true]]);
  add('rug', 19.7, 29.6, { w: 1.4, d: 2.0, color: '#2a9d8f', flat: true });
  add('sofa', 19.05, 29.1, { w: 0.55, d: 1.8, color: '#9d4edd', back: 'x0' });
  add('tv', 21.55, 30.3, { w: 0.36, d: 0.9 }); light(21.4, 30.75, 18, 0.9, '#8fbfff', 0.55, { kind: 'tv' });
  add('counter', 23.02, 29.05, { w: 1.96, d: 0.45, stove: true });
  add('gas', 24.6, 30.6); add('matka', 23.35, 30.6);
  add('tulsi', 23.55, 33.0);
  add('handpump', 24.5, 34.4);
  add('bed', 19.1, 34.08, { w: 1.85, d: 0.85, color: '#f4a261' });
  add('almirah', 21.3, 34.5, { w: 0.6, d: 0.42 });

  add('tank', 30.5, 31.5);
  add('tractor', 32.3, 33.5, { w: 1.6, d: 0.95 });
  add('tree', 27.6, 34.1, { type: 'banyan' });
  add('tree', 34.8, 28.9, { type: 'coconut', lean: -12 });
  add('cart', 27.2, 29.2, { w: 1.1, d: 0.6 });
  add('bush', 35.2, 35.2); add('bush', 26.4, 31.4);

  // ---------- street lights ----------
  const lamp = (x, y, ax, ay, color, chain) => {
    add('lamp', x, y, { ax, ay });
    light(x + ax, y + ay, 104, 3.3, color, 0.95, { kind: 'lamp' });
    if (chain) chain.push([x, y]);
  };
  const north = [], cc = [];
  for (const x of [3.5, 11.5, 21.5, 30.5]) lamp(x, 15.8, 0, 0.55, '#ffb35c', north);
  for (const x of [6.5, 25.5, 33.5]) lamp(x, 19.2, 0, -0.55, '#ffb35c');
  for (const y of [4.5, 11.5, 23.5, 31.5]) lamp(16.2, y, 0.55, 0, '#dcefff', cc);
  lamp(19.6, 8.4, 0.35, 0.35, '#ffc06a');
  wires.push(north, cc);

  // tube lights on brackets in the gullies (two of them flicker)
  const tube = (x, y, along, flicker) => {
    add('tube', x, y, { along });
    light(x, y, 38, 2.0, '#cffff0', 0.82, { kind: 'tube', flicker: flicker ? 'tube' : null });
  };
  tube(7.15, 3.5, 'y'); tube(3.5, 7.15, 'x'); tube(12.5, 7.15, 'x');
  tube(27.15, 4.5, 'y'); tube(27.15, 11.5, 'y', true);
  tube(8.15, 30.5, 'y'); tube(4.5, 27.15, 'x'); tube(12.5, 27.15, 'x');
  tube(24.5, 27.15, 'x'); tube(31.5, 27.15, 'x', true);

  // ---------- names on the map ----------
  label('Sharma house', 3.5, 3.5); label('Verma house', 11.5, 3.0); label('Shiv Mandir', 3.5, 10.5, 130);
  label('Yadav house', 11.5, 11.5); label('Gupta house', 20.5, 2.5); label('Peepal chabutra · den', 22.5, 10.5, 175);
  label('Reddy house', 31.5, 3.5); label('Talab', 31.5, 10.5, 6); label('Chai tapri', 5.0, 20.7, 70);
  label('Kirana store', 12, 22); label('Khan house', 3.5, 31.5); label('Cattle shed', 11, 30.5);
  label('Pandit house', 21, 23); label('Govt. school', 30.5, 23); label('Mehta house', 21.5, 31.5);
  label('Water tank', 30.5, 31.5, 125); label('Main road', 27.5, 17.5, 4); label('CC road', 17, 27.5, 4);

  // ---------- hiding spots (for the agents later) ----------
  hide('Behind the haystack', 25.95, 6.85);
  hide('Inside the cattle shed', 11.5, 29.7);
  hide('Behind the Shiv Mandir', 2.0, 8.5);
  hide('Under the charpai, Yadav aangan', 13.45, 12.5);
  hide("Verma family's dark bedroom", 14.45, 2.6);
  hide('Dark school classroom', 29.7, 24.6);
  hide('Behind the auto-rickshaw', 1.45, 25.4);
  hide('Behind the water tank', 31.3, 30.7);
  hide('Beside the tractor', 33.1, 35.5);
  hide('Behind the rice sacks', 12.2, 25.5);
  hide('Pond ghat steps', 28.6, 11.3);
  hide('Behind the chai tapri', 5.0, 19.95);

  return { N, tiles, objects, lights, labels, hideSpots, houses, wires, den: { x: 22.5, y: 10.5, z: 10 } };
}
