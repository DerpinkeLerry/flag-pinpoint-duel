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

test('two players can create, join and resolve a round', async (t) => {
  const game = createGameServer({
    totalRounds: 1,
    roundStartDelayMs: 15,
    roundDurationMs: 2500,
    revealDurationMs: 40,
    disconnectGraceMs: 100,
  });

  assert.ok(game.debug.playableCountries.length >= 100);
  assert.ok(game.debug.playableCountries.every((country) => (
    typeof country.capital === 'string'
    && Number.isFinite(country.lat)
    && Number.isFinite(country.lng)
  )));

  await new Promise((resolve) => game.httpServer.listen(0, '127.0.0.1', resolve));
  const port = game.httpServer.address().port;
  const url = `http://127.0.0.1:${port}`;
  const a = Client(url, { transports: ['websocket'] });
  const b = Client(url, { transports: ['websocket'] });

  t.after(async () => {
    a.close();
    b.close();
    await game.close();
  });

  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  assert.equal((await emitAck(a, 'hello', { playerId: 'player_alpha_123456' })).ok, true);
  assert.equal((await emitAck(b, 'hello', { playerId: 'player_bravo_123456' })).ok, true);

  const created = await emitAck(a, 'create-room', { playerId: 'player_alpha_123456', name: 'Alpha' });
  assert.equal(created.ok, true);
  assert.match(created.roomCode, /^[A-Z0-9]{6}$/);

  const roundA = once(a, 'round-start');
  const roundB = once(b, 'round-start');
  const joined = await emitAck(b, 'join-room', {
    playerId: 'player_bravo_123456',
    name: 'Bravo',
    roomCode: created.roomCode,
  });
  assert.equal(joined.ok, true);

  const [payloadA, payloadB] = await Promise.all([roundA, roundB]);
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 200);
  assert.equal(payloadA.roundNumber, 1);
  assert.equal(payloadA.flagUrl, payloadB.flagUrl);
  assert.match(payloadA.flagUrl, /^\/api\/flag\/[A-Za-z0-9_-]+$/);
  const flagResponse = await fetch(`${url}${payloadA.flagUrl}`);
  assert.equal(flagResponse.status, 200);
  assert.match(flagResponse.headers.get('content-type') || '', /image\/svg\+xml/);
  assert.match(await flagResponse.text(), /<svg/i);

  const gameOverA = once(a, 'game-over');
  const resultA = once(a, 'round-result');
  assert.equal((await emitAck(a, 'submit-guess', {
    playerId: 'player_alpha_123456', roomCode: created.roomCode, lat: 0, lng: 0,
  })).ok, true);
  assert.equal((await emitAck(b, 'submit-guess', {
    playerId: 'player_bravo_123456', roomCode: created.roomCode, lat: 20, lng: 20,
  })).ok, true);

  const result = await resultA;
  assert.equal(result.guesses.length, 2);
  assert.equal(typeof result.target.name, 'string');
  assert.equal(typeof result.target.capital, 'string');
  assert.ok(Number.isFinite(result.target.lat));
  assert.ok(Number.isFinite(result.target.lng));
  assert.equal(result.isLastRound, true);
  assert.ok(result.guesses.every((guess) => Number.isFinite(guess.distanceKm)));

  const gameOver = await gameOverA;
  assert.equal(gameOver.scores.length, 2);
});
