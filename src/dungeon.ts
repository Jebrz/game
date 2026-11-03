// 随机地牢生成：放置不重叠的房间，用最小生成树 + 少量额外通道连接，保证全部连通。

export type RoomKind = 'start' | 'normal' | 'stairs' | 'boss';

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  kind: RoomKind;
}

export interface Dungeon {
  w: number;
  h: number;
  /** 1 = 地面，0 = 实心 */
  grid: Uint8Array;
  /** 每个格子所属房间 id，走廊/墙为 -1 */
  roomAt: Int16Array;
  rooms: Room[];
  start: Room;
  goal: Room;
}

const rnd = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

function overlaps(a: Room, b: { x: number; y: number; w: number; h: number }, margin: number) {
  return (
    a.x - margin < b.x + b.w &&
    a.x + a.w + margin > b.x &&
    a.y - margin < b.y + b.h &&
    a.y + a.h + margin > b.y
  );
}

export function generateDungeon(level: number, bossLevel: boolean): Dungeon {
  // 偶尔房间过少时重试，保证体验
  for (let attempt = 0; attempt < 20; attempt++) {
    const d = tryGenerate(level, bossLevel);
    if (d) return d;
  }
  return tryGenerate(level, bossLevel, true)!;
}

function tryGenerate(level: number, bossLevel: boolean, force = false): Dungeon | null {
  const w = 54 + level * 6;
  const h = 40 + level * 4;
  const grid = new Uint8Array(w * h);
  const roomAt = new Int16Array(w * h).fill(-1);
  const rooms: Room[] = [];
  const target = 7 + level * 2;

  const place = (rw: number, rh: number, kind: RoomKind): Room | null => {
    for (let i = 0; i < 80; i++) {
      const x = rnd(2, w - rw - 3);
      const y = rnd(2, h - rh - 3);
      const cand = { x, y, w: rw, h: rh };
      if (rooms.some((r) => overlaps(r, cand, 3))) continue;
      const room: Room = {
        id: rooms.length,
        x,
        y,
        w: rw,
        h: rh,
        cx: x + Math.floor(rw / 2),
        cy: y + Math.floor(rh / 2),
        kind,
      };
      rooms.push(room);
      return room;
    }
    return null;
  };

  let bossRoom: Room | null = null;
  if (bossLevel) {
    bossRoom = place(15, 11, 'boss');
    if (!bossRoom) return null;
  }
  for (let i = 0; i < 300 && rooms.length < target; i++) {
    place(rnd(6, 11), rnd(5, 8), 'normal');
  }
  if (rooms.length < Math.min(6, target) && !force) return null;

  // 挖出房间
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        grid[y * w + x] = 1;
        roomAt[y * w + x] = r.id;
      }
  }

  const carveH = (x1: number, x2: number, y: number) => {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2) + 1; x++)
      for (let dy = 0; dy < 2; dy++) if (x > 0 && x < w - 1 && y + dy > 0 && y + dy < h - 1) grid[(y + dy) * w + x] = 1;
  };
  const carveV = (y1: number, y2: number, x: number) => {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2) + 1; y++)
      for (let dx = 0; dx < 2; dx++) if (y > 0 && y < h - 1 && x + dx > 0 && x + dx < w - 1) grid[y * w + x + dx] = 1;
  };
  const connect = (a: Room, b: Room) => {
    if (Math.random() < 0.5) {
      carveH(a.cx, b.cx, a.cy);
      carveV(a.cy, b.cy, b.cx);
    } else {
      carveV(a.cy, b.cy, a.cx);
      carveH(a.cx, b.cx, b.cy);
    }
  };

  // Prim 最小生成树
  const dist = (a: Room, b: Room) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
  const inTree = new Set<number>([0]);
  const edges = new Set<string>();
  while (inTree.size < rooms.length) {
    let best: [Room, Room] | null = null;
    let bestD = Infinity;
    for (const i of inTree)
      for (const r of rooms) {
        if (inTree.has(r.id)) continue;
        const d = dist(rooms[i], r);
        if (d < bestD) {
          bestD = d;
          best = [rooms[i], r];
        }
      }
    if (!best) break;
    connect(best[0], best[1]);
    edges.add(`${Math.min(best[0].id, best[1].id)}-${Math.max(best[0].id, best[1].id)}`);
    inTree.add(best[1].id);
  }
  // 额外通道制造环路，探索更自由
  for (const r of rooms) {
    if (Math.random() > 0.3) continue;
    const others = rooms
      .filter((o) => o.id !== r.id && !edges.has(`${Math.min(o.id, r.id)}-${Math.max(o.id, r.id)}`))
      .sort((p, q) => dist(r, p) - dist(r, q));
    if (others[0]) {
      connect(r, others[0]);
      edges.add(`${Math.min(others[0].id, r.id)}-${Math.max(others[0].id, r.id)}`);
    }
  }

  // BFS 求房间间路径距离
  const bfs = (sx: number, sy: number) => {
    const dd = new Int32Array(w * h).fill(-1);
    const q = [sy * w + sx];
    dd[q[0]] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      const cx = c % w;
      const cy = (c / w) | 0;
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (grid[n] && dd[n] < 0) {
          dd[n] = dd[c] + 1;
          q.push(n);
        }
      }
    }
    return dd;
  };

  let start: Room;
  let goal: Room;
  if (bossRoom) {
    const dd = bfs(bossRoom.cx, bossRoom.cy);
    start = rooms
      .filter((r) => r !== bossRoom)
      .reduce((a, b) => (dd[b.cy * w + b.cx] > dd[a.cy * w + a.cx] ? b : a));
    goal = bossRoom;
  } else {
    start = rooms[rnd(0, rooms.length - 1)];
    const dd = bfs(start.cx, start.cy);
    goal = rooms
      .filter((r) => r !== start)
      .reduce((a, b) => (dd[b.cy * w + b.cx] > dd[a.cy * w + a.cx] ? b : a));
    goal.kind = 'stairs';
  }
  start.kind = 'start';

  // 校验连通性
  const check = bfs(start.cx, start.cy);
  if (rooms.some((r) => check[r.cy * w + r.cx] < 0)) return null;

  return { w, h, grid, roomAt, rooms, start, goal };
}
