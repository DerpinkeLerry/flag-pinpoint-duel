'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: Client } = require('socket.io-client');
const { createGameServer } = require('../src/gameServer');

function once(socket, event, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeout);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}
function ack(socket, event, payload) { return new Promise((resolve) => socket.emit(event, payload, resolve)); }
async function server(options = {}) {
  const game = createGameServer({ roundStartDelayMs: 10, roundDurationMs: 1500, revealDurationMs: 25, disconnectGraceMs: 50, ...options });
  await new Promise((resolve) => game.httpServer.listen(0, '127.0.0.1', resolve));
  return { game, url: `http://127.0.0.1:${game.httpServer.address().port}` };
}
async function connect(url, id) {
  const client = Client(url, { transports: ['websocket'] }); await once(client, 'connect'); await ack(client, 'hello', { playerId: id, name: id.slice(0, 8) }); return client;
}
function opposite(target) { return { lat: -target.lat, lng: target.lng >= 0 ? target.lng - 180 : target.lng + 180 }; }

async function createAndJoin(game, url, settings = {}, kind = 'duel', count = 2) {
  const clients = [];
  for (let i = 0; i < count; i += 1) clients.push(await connect(url, `v2_player_${i}_123456789`));
  const created = await ack(clients[0], 'create-room', { playerId: 'v2_player_0_123456789', name: 'P0', mode: 'globe', kind, settings });
  assert.equal(created.ok, true);
  const roundPromises = clients.map((c) => once(c, 'round-start'));
  for (let i = 1; i < count; i += 1) {
    const joined = await ack(clients[i], 'join-room', { playerId: `v2_player_${i}_123456789`, name: `P${i}`, roomCode: created.roomCode });
    assert.equal(joined.ok, true);
  }
  const rounds = await Promise.all(roundPromises);
  return { clients, created, rounds, room: game.debug.rooms.get(created.roomCode) };
}

test('Distance Duel only applies points for the closer player', async (t) => {
  const { game, url } = await server({ maxRoundPoints: 1000 });
  const { clients, created, room } = await createAndJoin(game, url, { startingScore: 1000, format: 'distance' });
  t.after(async () => { clients.forEach((c) => c.close()); await game.close(); });
  const resultP = once(clients[0], 'round-result'); const overP = once(clients[0], 'game-over'); const target = room.target; const far = opposite(target);
  await ack(clients[0], 'submit-guess', { playerId: 'v2_player_0_123456789', roomCode: created.roomCode, lat: target.lat, lng: target.lng });
  await ack(clients[1], 'submit-guess', { playerId: 'v2_player_1_123456789', roomCode: created.roomCode, lat: far.lat, lng: far.lng });
  const result = await resultP; const a = result.guesses.find((g) => g.playerId.includes('_0_')); const b = result.guesses.find((g) => g.playerId.includes('_1_'));
  assert.equal(a.appliedPoints, 1000); assert.equal(a.scoreAfter, 0); assert.equal(b.appliedPoints, 0); assert.equal(b.scoreAfter, 1000); assert.equal((await overP).winnerId, a.playerId);
});

test('Best of 3 and Sudden Death use round wins instead of the health race', async (t) => {
  const first = await server();
  const match = await createAndJoin(first.game, first.url, { format: 'bestof', bestOfRounds: 3, startingScore: 5000 });
  t.after(async () => { match.clients.forEach((c) => c.close()); await first.game.close(); });
  for (let roundIndex = 0; roundIndex < 2; roundIndex += 1) {
    const resultP = once(match.clients[0], 'round-result'); const room = first.game.debug.rooms.get(match.created.roomCode); const target = room.target; const far = opposite(target);
    await ack(match.clients[0], 'submit-guess', { playerId: 'v2_player_0_123456789', roomCode: match.created.roomCode, lat: target.lat, lng: target.lng });
    await ack(match.clients[1], 'submit-guess', { playerId: 'v2_player_1_123456789', roomCode: match.created.roomCode, lat: far.lat, lng: far.lng });
    const result = await resultP;
    if (roundIndex === 0) { assert.equal(result.matchEnded, false); assert.equal(result.scores[0].roundWins, 1); await once(match.clients[0], 'round-start'); }
    else { assert.equal(result.matchEnded, true); assert.equal(result.scores[0].roundWins, 2); }
  }
  const gameOver = await once(match.clients[0], 'game-over'); assert.equal(gameOver.winnerId, 'v2_player_0_123456789'); assert.equal(gameOver.settings.format, 'bestof');

  const second = await server(); const sudden = await createAndJoin(second.game, second.url, { format: 'sudden' });
  const target = sudden.room.target; const far = opposite(target); const over = once(sudden.clients[0], 'game-over');
  await ack(sudden.clients[0], 'submit-guess', { playerId: 'v2_player_0_123456789', roomCode: sudden.created.roomCode, lat: target.lat, lng: target.lng });
  await ack(sudden.clients[1], 'submit-guess', { playerId: 'v2_player_1_123456789', roomCode: sudden.created.roomCode, lat: far.lat, lng: far.lng });
  assert.equal((await over).winnerId, 'v2_player_0_123456789'); sudden.clients.forEach((c) => c.close()); await second.game.close();
});

test('Battle Royale supports four players and eliminates the worst guess', async (t) => {
  const { game, url } = await server(); const match = await createAndJoin(game, url, { playerLimit: 4 }, 'battle', 4);
  t.after(async () => { match.clients.forEach((c) => c.close()); await game.close(); });
  const room = game.debug.rooms.get(match.created.roomCode); assert.equal(room.kind, 'battle'); assert.equal(room.players.length, 4);
  const resultP = once(match.clients[0], 'round-result'); const target = room.target; const far = opposite(target);
  for (let i = 0; i < 4; i += 1) {
    const guess = i === 3 ? far : { lat: Math.max(-89, Math.min(89, target.lat + i * 0.5)), lng: target.lng };
    await ack(match.clients[i], 'submit-guess', { playerId: `v2_player_${i}_123456789`, roomCode: match.created.roomCode, ...guess });
  }
  const result = await resultP; assert.equal(result.matchEnded, false); assert.equal(result.eliminatedId, 'v2_player_3_123456789'); assert.equal(game.debug.rooms.get(match.created.roomCode).players.find((p) => p.id.endsWith('3_123456789')).eliminated, true);
});

test('spectators receive live rounds but cannot submit a guess', async (t) => {
  const { game, url } = await server(); const host = await connect(url, 'spec_host_123456789'); const guest = await connect(url, 'spec_guest_123456789'); const spec = await connect(url, 'spec_watch_123456789');
  t.after(async () => { host.close(); guest.close(); spec.close(); await game.close(); });
  const created = await ack(host, 'create-room', { playerId: 'spec_host_123456789', name: 'Host', mode: 'globe' });
  assert.equal((await ack(spec, 'spectate-room', { playerId: 'spec_watch_123456789', name: 'Watch', roomCode: created.roomCode })).spectator, true);
  const specRound = once(spec, 'round-start'); await ack(guest, 'join-room', { playerId: 'spec_guest_123456789', name: 'Guest', roomCode: created.roomCode }); await specRound;
  const target = game.debug.rooms.get(created.roomCode).target; const rejected = await ack(spec, 'submit-guess', { playerId: 'spec_watch_123456789', roomCode: created.roomCode, lat: target.lat, lng: target.lng }); assert.equal(rejected.ok, false);
  assert.equal(game.debug.rooms.get(created.roomCode).spectators.length, 1);
});

test('Ranked locks fair rules, changes Elo and Daily uses deterministic countries', async (t) => {
  const { game, url } = await server({ maxRoundPoints: 5000 }); const a = await connect(url, 'rank_alpha_12345678'); const b = await connect(url, 'rank_bravo_12345678');
  t.after(async () => { a.close(); b.close(); await game.close(); });
  const created = await ack(a, 'create-room', { playerId: 'rank_alpha_12345678', name: 'Alpha', mode: 'map', settings: { ranked: true, region: 'asia', startingScore: 20000, roundDurationMs: 5000, scoreMultiplier: 4, visualMode: 'crop', scoringProfile: 'precision' } });
  assert.equal(created.room.mode, 'globe'); assert.equal(created.room.settings.region, 'world'); assert.equal(created.room.settings.startingScore, 5000); assert.equal(created.room.settings.roundDurationMs, 22000); assert.equal(created.room.settings.scoreMultiplier, 1); assert.equal(created.room.settings.visualMode, 'flag');
  const round = once(a, 'round-start'); await ack(b, 'join-room', { playerId: 'rank_bravo_12345678', name: 'Bravo', roomCode: created.roomCode }); await round; const room = game.debug.rooms.get(created.roomCode); const far = opposite(room.target); const over = once(a, 'game-over');
  await ack(a, 'submit-guess', { playerId: 'rank_alpha_12345678', roomCode: created.roomCode, lat: room.target.lat, lng: room.target.lng }); await ack(b, 'submit-guess', { playerId: 'rank_bravo_12345678', roomCode: created.roomCode, lat: far.lat, lng: far.lng }); await over;
  assert.ok(game.debug.profiles.get('rank_alpha_12345678').rating > 1000); assert.equal(game.debug.profiles.get('rank_alpha_12345678').rankedMatches, 1);

  const c = await connect(url, 'daily_one_123456789'); const d = await connect(url, 'daily_two_123456789'); t.after(() => { c.close(); d.close(); });
  const cRound = once(c, 'round-start'); const dRound = once(d, 'round-start'); const cStart = await ack(c, 'start-daily', { playerId: 'daily_one_123456789', name: 'D1', mode: 'map', settings: { roundDurationMs: 5000, visualMode: 'crop' } }); const dStart = await ack(d, 'start-daily', { playerId: 'daily_two_123456789', name: 'D2', mode: 'map', settings: { roundDurationMs: 60000, visualMode: 'flash' } }); await Promise.all([cRound, dRound]);
  const cRoom = game.debug.rooms.get(cStart.roomCode); const dRoom = game.debug.rooms.get(dStart.roomCode); assert.equal(cRoom.mode, 'globe'); assert.equal(dRoom.mode, 'globe'); assert.equal(cRoom.roundDurationMs, 22000); assert.equal(cRoom.visualMode, 'flag'); assert.equal(cRoom.target.isoCode, dRoom.target.isoCode);
});

test('subregions, blind visual settings, precision and streak bonus are carried through rounds', async (t) => {
  const { game, url } = await server(); const player = await connect(url, 'modifier_player_123456');
  t.after(async () => { player.close(); await game.close(); });
  const firstRound = once(player, 'round-start');
  const started = await ack(player, 'start-solo', {
    playerId: 'modifier_player_123456', name: 'Mods', mode: 'globe',
    settings: { region: 'caribbean', startingScore: 5000, visualMode: 'flash', scoringProfile: 'precision', streakBonus: true },
  });
  const round1 = await firstRound; assert.equal(round1.settings.region, 'caribbean'); assert.equal(round1.settings.visualMode, 'flash'); assert.equal(round1.settings.scoringProfile, 'precision'); assert.equal(round1.settings.streakBonus, true);
  for (let i = 0; i < 3; i += 1) {
    const room = game.debug.rooms.get(started.roomCode); assert.equal(room.target.subregionKey.toLowerCase(), 'caribbean'); const resultP = once(player, 'round-result');
    await ack(player, 'submit-guess', { playerId: 'modifier_player_123456', roomCode: started.roomCode, lat: room.target.lat, lng: room.target.lng });
    const result = await resultP; const guess = result.guesses[0]; assert.equal(guess.streak, i + 1); assert.equal(guess.streakMultiplier, 1 + Math.min(.5, i * .1));
    if (i < 2) await once(player, 'round-start');
  }
});
