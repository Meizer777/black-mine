const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 8000,
  maxHttpBufferSize: 1e5,
});

app.use(express.static(__dirname));

app.get('/health', (_, res) => res.send('OK'));

const MAX_PLAYERS = 3;
const rooms = new Map(); // roomCode -> Map<socketId, playerState>

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ name, room } = {}) => {
    if (socket.data.room) return; // уже в комнате

    const roomCode = String(room || 'MINE').toUpperCase().slice(0, 8) || 'MINE';
    const playerName = String(name || 'Игрок').trim().slice(0, 14) || 'Игрок';

    let r = rooms.get(roomCode);
    if (!r) { r = new Map(); rooms.set(roomCode, r); }
// Удаляем старую сессию с таким же именем (переподключение / дубликат)
for (const [oldId, oldP] of [...r]) {
  if (oldId !== socket.id && oldP.name === playerName) {
    r.delete(oldId);
    socket.to(roomCode).emit('playerLeft', { id: oldId });
    console.log(`[${roomCode}] удалён дубликат ${playerName} (${oldId})`);
  }
}
    if (r.size >= MAX_PLAYERS) {
      socket.emit('roomFull', { room: roomCode, max: MAX_PLAYERS });
      return;
    }

    r.set(socket.id, {
      id: socket.id,
      name: playerName,
      x: 0, y: 0, z: 5.5,
      ry: Math.PI,
      wp: 0,
      sw: false,
    });

    socket.join(roomCode);
    socket.data.room = roomCode;
    socket.data.name = playerName;

    // сообщаем новому игроку о уже присутствующих
    const others = [];
    for (const [id, p] of r) if (id !== socket.id) others.push(p);

    socket.emit('roomJoined', {
      room: roomCode,
      selfId: socket.id,
      players: others,
    });

    // сообщаем остальным о новом игроке
    socket.to(roomCode).emit('playerJoined', {
      id: socket.id,
      name: playerName,
      x: 0, y: 0, z: 5.5, ry: Math.PI,
    });

    console.log(`[${roomCode}] ${playerName} вошёл. Игроков: ${r.size}`);
  });

  socket.on('playerUpdate', (data) => {
    const room = socket.data.room;
    if (!room || !data) return;
    const r = rooms.get(room);
    if (!r) return;
    const p = r.get(socket.id);
    if (!p) return;

    p.x = +data.x || 0;
    p.y = +data.y || 0;
    p.z = +data.z || 0;
    p.ry = +data.ry || 0;
    p.wp = +data.wp || 0;
    p.sw = !!data.sw;

    socket.to(room).emit('playerUpdate', {
      id: socket.id,
      x: p.x, y: p.y, z: p.z,
      ry: p.ry, wp: p.wp, sw: p.sw,
    });
  });

  // Синхронизация разрушения руды
  socket.on('oreBroken', (data) => {
    const room = socket.data.room;
    if (!room || !data || typeof data.index !== 'number') return;
    socket.to(room).emit('oreBroken', {
      index: data.index,
      delay: Math.max(1, Math.min(120, +data.delay || 30)),
    });
  });

  // Необязательный чат
  socket.on('chat', (msg) => {
    const room = socket.data.room;
    if (!room || !msg) return;
    const text = String(msg).slice(0, 120);
socket.to(room).emit('chat', { name: socket.data.name || 'Игрок', msg: text });
  });
 socket.on('switchWorld', ({ world } = {}) => {
    const room = socket.data.room;
    if (!room) return;
    if (world !== 'mine' && world !== 'ice') return;
    io.to(room).emit('worldChanged', { world });
});
// PvP — удар по другому игроку
socket.on('pvpHit', ({ targetId, dmg } = {}) => {
  const room = socket.data.room;
  if (!room || !targetId || typeof dmg !== 'number') return;
  const r = rooms.get(room);
  if (!r || !r.has(targetId)) return;
  const d = Math.max(1, Math.min(50, Math.round(dmg)));
  io.to(targetId).emit('pvpHit', { targetId, dmg: d, attacker: socket.data.name });
});

// Смена мира
socket.on('switchWorld', ({ world } = {}) => {
  const room = socket.data.room;
  if (!room) return;
  if (world !== 'mine' && world !== 'ice' && world !== 'volcano') return;
  io.to(room).emit('worldChanged', { world });
});

// Запрос на общий счёт команды (опционально)
socket.on('teamScoreRequest', () => {
  const room = socket.data.room;
  if (!room) return;
  const r = rooms.get(room);
  if (!r) return;
  let total = 0;
  for (const [, p] of r) total += (p.coinsEarned || 0);
  io.to(room).emit('teamScore', { total });
});
  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room) return;
    const r = rooms.get(room);
    if (!r) return;
    r.delete(socket.id);
    socket.to(room).emit('playerLeft', { id: socket.id });
    if (r.size === 0) rooms.delete(room);
    console.log(`[${room}] отключился. Осталось: ${r.size}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ BLACK MINE server: http://localhost:${PORT}`);
});
