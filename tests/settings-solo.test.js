'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: Client } = require('socket.io-client');
const { createGameServer } = require('../src/gameServer');

function once(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function startTestServer() {
  const game = createGameServer({
    roundStartDelayMs: 15,
    roundDurationMs: 22000,
    revealDurationMs: 35,
    disconnectGraceMs: 100,
  });
  await new Promise((resolve) => game.httpServer.listen(0, '127.0.0.1', resolve));
  return { game, url: `http://127.0.0.1:${game.httpServer.address().port}` };
}

test('solo mode uses custom region, timer, score and multiplier', async (t) => {
  const { game, url } = await startTestServer();
  const player = Client(url, { transports: ['websocket'] });
  t.after(async () => { player.close(); await game.close(); });

  await once(player, 'connect');
  assert.equal((await emitAck(player, 'hello', { playerId: 'solo_player_123456' })).ok, true);

  const firstRound = once(player, 'round-start');
  const started = await emitAck(player, 'start-solo', {
    playerId: 'solo_player_123456',
    name: 'Solo',
    mode: 'globe',
    settings: {
      region: 'europe',
      roundDurationMs: 10000,
      startingScore: 2000,
      scoreMultiplier: 2,
    },
  });

  assert.equal(started.ok, true);
  assert.equal(started.room.kind, 'solo');
  assert.equal(started.room.mode, 'globe');
  assert.equal(started.room.settings.region, 'europe');
  assert.equal(started.room.settings.regionLabel, 'Europa');
  assert.equal(started.room.settings.roundDurationMs, 10000);
  assert.equal(started.room.settings.startingScore, 2000);
  assert.equal(started.room.settings.scoreMultiplier, 2);
  assert.equal(started.room.settings.maxRoundPoints, 2000);

  const round = await firstRound;
  assert.equal(round.kind, 'solo');
  assert.equal(round.roundDurationMs, 10000);
  const room = game.debug.rooms.get(started.roomCode);
  assert.equal(room.target.regionKey, 'europe');

  const resultPromise = once(player, 'round-result');
  const gameOverPromise = once(player, 'game-over');
  assert.equal((await emitAck(player, 'submit-guess', {
    playerId: 'solo_player_123456',
    roomCode: started.roomCode,
    lat: room.target.lat,
    lng: room.target.lng,
  })).ok, true);

  const result = await resultPromise;
  assert.equal(result.guesses.length, 1);
  assert.equal(result.guesses[0].roundPoints, 2000);
  assert.equal(result.guesses[0].scoreAfter, 0);
  assert.equal(result.matchEnded, true);
  assert.equal(result.kind, 'solo');

  const gameOver = await gameOverPromise;
  assert.equal(gameOver.kind, 'solo');
  assert.equal(gameOver.winnerId, 'solo_player_123456');
  assert.equal(gameOver.scores[0].score, 0);
});

test('multiplayer lobby synchronizes host settings and regional pool', async (t) => {
  const { game, url } = await startTestServer();
  const host = Client(url, { transports: ['websocket'] });
  const guest = Client(url, { transports: ['websocket'] });
  t.after(async () => { host.close(); guest.close(); await game.close(); });

  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);
  await emitAck(host, 'hello', { playerId: 'settings_host_123456' });
  await emitAck(guest, 'hello', { playerId: 'settings_guest_123456' });

  const created = await emitAck(host, 'create-room', {
    playerId: 'settings_host_123456',
    name: 'Host',
    mode: 'map',
    settings: {
      region: 'asia',
      roundDurationMs: 30000,
      startingScore: 7500,
      scoreMultiplier: 1.5,
    },
  });
  assert.equal(created.ok, true);
  assert.equal(created.room.settings.region, 'asia');

  const guestLobby = once(guest, 'lobby-update');
  const guestRound = once(guest, 'round-start');
  assert.equal((await emitAck(guest, 'join-room', {
    playerId: 'settings_guest_123456',
    name: 'Guest',
    roomCode: created.roomCode,
  })).ok, true);

  const syncedLobby = await guestLobby;
  assert.equal(syncedLobby.kind, 'duel');
  assert.equal(syncedLobby.settings.regionLabel, 'Asien');
  assert.equal(syncedLobby.settings.startingScore, 7500);
  assert.equal(syncedLobby.settings.roundDurationMs, 30000);
  assert.equal(syncedLobby.settings.scoreMultiplier, 1.5);
  assert.equal(syncedLobby.settings.maxRoundPoints, 1500);

  const round = await guestRound;
  assert.equal(round.roundDurationMs, 30000);
  assert.equal(round.settings.region, 'asia');
  const room = game.debug.rooms.get(created.roomCode);
  assert.equal(room.target.regionKey, 'asia');
  assert.ok(room.players.every((item) => item.score === 7500));

  await emitAck(host, 'leave-room', { playerId: 'settings_host_123456' });
  await emitAck(guest, 'leave-room', { playerId: 'settings_guest_123456' });
});
