'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const countries = require('world-countries');
const { CAPITAL_COORDINATES } = require('./capitals');
const { CURATED_COUNTRY_CODE_SET } = require('./countryPool');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const LEAFLET_DIR = path.dirname(require.resolve('leaflet/package.json'));
const FLAG_ICONS_DIR = path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags', '4x3');
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const DEFAULT_STARTING_SCORE = 5000;
const DEFAULT_MAX_ROUND_POINTS = 1000;
const DEFAULT_SCORE_DISTANCE_SCALE_KM = 1750;
const GAME_MODES = new Set(['map', 'globe']);

function createGameServer(options = {}) {
  const config = {
    startingScore: options.startingScore ?? DEFAULT_STARTING_SCORE,
    maxRoundPoints: options.maxRoundPoints ?? DEFAULT_MAX_ROUND_POINTS,
    scoreDistanceScaleKm: options.scoreDistanceScaleKm ?? DEFAULT_SCORE_DISTANCE_SCALE_KM,
    roundStartDelayMs: options.roundStartDelayMs ?? 1200,
    roundDurationMs: options.roundDurationMs ?? 22000,
    revealDurationMs: options.revealDurationMs ?? 9000,
    disconnectGraceMs: options.disconnectGraceMs ?? 30000,
  };

  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    transports: ['websocket', 'polling'],
    pingInterval: 20000,
    pingTimeout: 20000,
  });

  const rooms = new Map();
  const players = new Map();
  const flagTokens = new Map();

  const countriesWithGameData = countries
    .filter((country) => country.independent === true)
    .filter((country) => Array.isArray(country.capital) && country.capital.length > 0)
    .filter((country) => /^[A-Z]{2}$/.test(country.cca2 || ''))
    .filter((country) => Array.isArray(CAPITAL_COORDINATES[country.cca2]))
    .filter((country) => fs.existsSync(path.join(FLAG_ICONS_DIR, `${country.cca2.toLowerCase()}.svg`)))
    .map((country) => {
      const [lat, lng] = CAPITAL_COORDINATES[country.cca2];
      return {
        code: country.cca2.toLowerCase(),
        isoCode: country.cca2,
        name: country.translations?.deu?.common || country.name.common,
        capital: country.capital[0],
        lat,
        lng,
      };
    });

  const curatedCountries = countriesWithGameData
    .filter((country) => CURATED_COUNTRY_CODE_SET.has(country.isoCode));

  // Prefer the stable curated pool. If an upstream metadata package ever
  // changes enough that the curated list can no longer be resolved, keep the
  // service online with all countries that still have capital + flag data.
  const playableCountries = curatedCountries.length >= 100
    ? curatedCountries
    : countriesWithGameData;

  if (curatedCountries.length < 100) {
    console.warn(
      `[flag-pinpoint] Curated pool resolved to only ${curatedCountries.length} countries; `
      + `falling back to ${countriesWithGameData.length} countries with complete game data.`,
    );
  }

  if (playableCountries.length < 20) {
    throw new Error(
      `Only ${playableCountries.length} countries with complete flag/capital data were found.`,
    );
  }

  console.log(`[flag-pinpoint] Loaded ${playableCountries.length} playable countries.`);

  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
  app.use('/vendor/leaflet', express.static(LEAFLET_DIR, { maxAge: '30d', immutable: true }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  app.get('/api/flag/:token', (req, res) => {
    const record = flagTokens.get(req.params.token);
    if (!record || record.expiresAt < Date.now()) {
      flagTokens.delete(req.params.token);
      return res.sendStatus(404);
    }

    const filePath = path.join(FLAG_ICONS_DIR, `${record.countryCode}.svg`);
    if (!fs.existsSync(filePath)) return res.sendStatus(404);

    res.set({
      'Cache-Control': 'private, max-age=120',
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.sendFile(filePath);
  });

  function safeAck(ack, payload) {
    if (typeof ack === 'function') ack(payload);
  }

  function normalizePlayerId(value) {
    const id = String(value || '').trim();
    return /^[a-zA-Z0-9_-]{16,80}$/.test(id) ? id : null;
  }

  function normalizeName(value) {
    const cleaned = String(value || '')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 18);
    return cleaned || 'Spieler';
  }

  function normalizeRoomCode(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
  }

  function normalizeGameMode(value) {
    const mode = String(value || '').toLowerCase();
    return GAME_MODES.has(mode) ? mode : 'map';
  }

  function makeRoomCode() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        code += ROOM_ALPHABET[crypto.randomInt(0, ROOM_ALPHABET.length)];
      }
      if (!rooms.has(code)) return code;
    }
    throw new Error('Could not allocate room code.');
  }

  function makeFlagToken(countryCode) {
    const token = crypto.randomBytes(24).toString('base64url');
    flagTokens.set(token, { countryCode, expiresAt: Date.now() + 10 * 60 * 1000 });
    return token;
  }

  function publicPlayers(room) {
    return room.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connected,
      score: player.score,
      hasGuessed: Boolean(player.guess),
      rematchReady: room.rematchReady.has(player.id),
    }));
  }

  function lobbyPayload(room) {
    return {
      roomCode: room.code,
      status: room.status,
      startingScore: room.startingScore,
      maxRoundPoints: config.maxRoundPoints,
      mode: room.mode,
      players: publicPlayers(room),
    };
  }

  function emitLobby(room) {
    io.to(room.code).emit('lobby-update', lobbyPayload(room));
  }

  function getPlayer(room, playerId) {
    return room.players.find((player) => player.id === playerId);
  }

  function bindSocketToPlayer(socket, playerId, { sync = true } = {}) {
    const existing = players.get(playerId);
    if (!existing) {
      players.set(playerId, { roomCode: null, socketId: socket.id, disconnectTimer: null });
      return players.get(playerId);
    }

    if (existing.disconnectTimer) {
      clearTimeout(existing.disconnectTimer);
      existing.disconnectTimer = null;
    }

    existing.socketId = socket.id;
    const room = existing.roomCode ? rooms.get(existing.roomCode) : null;
    if (room) {
      const player = getPlayer(room, playerId);
      if (player) {
        player.socketId = socket.id;
        player.connected = true;
        socket.join(room.code);
        if (sync) socket.emit('state-sync', buildStateSync(room, playerId));
        emitLobby(room);
      }
    }
    return existing;
  }

  function buildStateSync(room, playerId) {
    const payload = {
      room: lobbyPayload(room),
      selfId: playerId,
      round: null,
    };

    if (room.status === 'playing' && room.target && room.flagToken) {
      payload.round = {
        roundNumber: room.roundIndex + 1,
        flagUrl: `/api/flag/${room.flagToken}`,
        deadline: room.deadline,
        serverTime: Date.now(),
        roundDurationMs: config.roundDurationMs,
        mode: room.mode,
        hasGuessed: Boolean(getPlayer(room, playerId)?.guess),
        guess: getPlayer(room, playerId)?.guess ? {
          lat: getPlayer(room, playerId).guess.lat,
          lng: getPlayer(room, playerId).guess.lng,
        } : null,
      };
    }

    if (room.status === 'playing' && !payload.round && room.lastRoundResult && room.resultExpiresAt > Date.now()) {
      payload.roundResult = {
        ...room.lastRoundResult,
        nextRoundInMs: Math.max(0, room.resultExpiresAt - Date.now()),
      };
    }

    if (room.status === 'ended') {
      payload.gameOver = room.finalResult || finalPayload(room);
    }

    return payload;
  }

  function leaveCurrentRoom(playerId, { notify = true } = {}) {
    const record = players.get(playerId);
    if (!record?.roomCode) return;
    const room = rooms.get(record.roomCode);
    if (!room) {
      record.roomCode = null;
      return;
    }

    const index = room.players.findIndex((player) => player.id === playerId);
    if (index >= 0) room.players.splice(index, 1);
    room.rematchReady.delete(playerId);
    record.roomCode = null;

    if (room.players.length === 0) {
      clearRoomTimers(room);
      rooms.delete(room.code);
    } else if (notify) {
      emitLobby(room);
    }
  }

  function clearRoomTimers(room) {
    if (room.roundTimer) clearTimeout(room.roundTimer);
    if (room.transitionTimer) clearTimeout(room.transitionTimer);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.roundTimer = null;
    room.transitionTimer = null;
    room.cleanupTimer = null;
  }

  function chooseCountry(room) {
    const available = playableCountries.filter((country) => !room.usedCountries.has(country.code));
    const pool = available.length ? available : playableCountries;
    const country = pool[crypto.randomInt(0, pool.length)];
    room.usedCountries.add(country.code);
    return country;
  }

  function startGame(room) {
    if (room.players.length !== 2 || room.players.some((p) => !p.connected)) return;
    clearRoomTimers(room);
    room.status = 'playing';
    room.roundIndex = -1;
    room.usedCountries = new Set();
    room.rematchReady.clear();
    room.target = null;
    room.flagToken = null;
    room.finalResult = null;
    room.lastRoundResult = null;
    room.resultExpiresAt = 0;
    room.players.forEach((player) => {
      player.score = room.startingScore;
      player.guess = null;
    });
    emitLobby(room);
    room.transitionTimer = setTimeout(() => nextRound(room), config.roundStartDelayMs);
  }

  function nextRound(room) {
    if (room.status !== 'playing' || room.players.length !== 2) return;
    room.roundIndex += 1;
    room.players.forEach((player) => { player.guess = null; });
    room.lastRoundResult = null;
    room.resultExpiresAt = 0;
    room.target = chooseCountry(room);
    room.flagToken = makeFlagToken(room.target.code);
    room.deadline = Date.now() + config.roundDurationMs;

    io.to(room.code).emit('round-start', {
      roundNumber: room.roundIndex + 1,
      flagUrl: `/api/flag/${room.flagToken}`,
      deadline: room.deadline,
      serverTime: Date.now(),
      roundDurationMs: config.roundDurationMs,
      mode: room.mode,
    });
    emitLobby(room);

    room.roundTimer = setTimeout(() => finishRound(room), config.roundDurationMs + 75);
  }

  function haversineKm(aLat, aLng, bLat, bLng) {
    const R = 6371.0088;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function roundPointsForDistance(distanceKm) {
    if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
    const raw = config.maxRoundPoints * Math.exp(-distanceKm / config.scoreDistanceScaleKm);
    return Math.max(0, Math.min(config.maxRoundPoints, Math.round(raw)));
  }

  function finishRound(room) {
    if (room.status !== 'playing' || !room.target) return;
    if (room.roundTimer) clearTimeout(room.roundTimer);
    room.roundTimer = null;

    const guesses = room.players.map((player) => {
      const distanceKm = player.guess
        ? haversineKm(player.guess.lat, player.guess.lng, room.target.lat, room.target.lng)
        : null;
      const roundPoints = roundPointsForDistance(distanceKm);
      const scoreBefore = player.score;
      player.score = Math.max(0, player.score - roundPoints);
      return {
        playerId: player.id,
        name: player.name,
        lat: player.guess?.lat ?? null,
        lng: player.guess?.lng ?? null,
        distanceKm,
        roundPoints,
        scoreBefore,
        scoreAfter: player.score,
      };
    });

    const valid = guesses.filter((guess) => Number.isFinite(guess.distanceKm));
    let winnerId = null;
    if (valid.length === 1) {
      winnerId = valid[0].playerId;
    } else if (valid.length === 2) {
      const [a, b] = valid;
      if (Math.abs(a.distanceKm - b.distanceKm) > 0.001) {
        winnerId = a.distanceKm < b.distanceKm ? a.playerId : b.playerId;
      }
    }

    const zeroPlayers = room.players.filter((player) => player.score === 0);
    let matchWinnerId = null;
    if (zeroPlayers.length === 1) {
      matchWinnerId = zeroPlayers[0].id;
    } else if (zeroPlayers.length === 2) {
      const [a, b] = guesses;
      if (Math.abs((a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)) > 0.001) {
        matchWinnerId = (a.distanceKm ?? Infinity) < (b.distanceKm ?? Infinity) ? a.playerId : b.playerId;
      }
    }
    const matchEnded = zeroPlayers.length > 0;

    const resultPayload = {
      roundNumber: room.roundIndex + 1,
      target: {
        name: room.target.name,
        capital: room.target.capital,
        lat: room.target.lat,
        lng: room.target.lng,
      },
      guesses,
      winnerId,
      matchWinnerId,
      matchEnded,
      scores: room.players.map((player) => ({ playerId: player.id, name: player.name, score: player.score })),
      nextRoundInMs: config.revealDurationMs,
      mode: room.mode,
    };
    room.lastRoundResult = resultPayload;
    room.resultExpiresAt = Date.now() + config.revealDurationMs;
    io.to(room.code).emit('round-result', resultPayload);
    emitLobby(room);

    room.target = null;
    room.flagToken = null;
    room.transitionTimer = setTimeout(() => {
      if (matchEnded) endGame(room, matchWinnerId, 'score-zero');
      else nextRound(room);
    }, config.revealDurationMs);
  }

  function finalPayload(room, forcedWinnerId = null, reason = 'completed') {
    const scores = room.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      score: player.score,
      connected: player.connected,
    }));

    let winnerId = forcedWinnerId;
    if (!winnerId && scores.length === 2) {
      if (scores[0].score !== scores[1].score) {
        winnerId = scores[0].score < scores[1].score ? scores[0].playerId : scores[1].playerId;
      }
    }

    return { roomCode: room.code, scores, winnerId, reason, mode: room.mode };
  }

  function endGame(room, forcedWinnerId = null, reason = 'completed') {
    clearRoomTimers(room);
    room.status = 'ended';
    room.target = null;
    room.flagToken = null;
    room.rematchReady.clear();
    const payload = finalPayload(room, forcedWinnerId, reason);
    room.finalResult = payload;
    io.to(room.code).emit('game-over', payload);
    emitLobby(room);

    room.cleanupTimer = setTimeout(() => {
      if (room.status !== 'ended') return;
      rooms.delete(room.code);
      room.players.forEach((player) => {
        const record = players.get(player.id);
        if (record?.roomCode === room.code) record.roomCode = null;
      });
    }, 30 * 60 * 1000);
  }

  function maybeFinishEarly(room) {
    if (room.players.length === 2 && room.players.every((player) => Boolean(player.guess))) {
      if (room.roundTimer) clearTimeout(room.roundTimer);
      room.roundTimer = setTimeout(() => finishRound(room), 450);
    }
  }

  io.on('connection', (socket) => {
    socket.on('hello', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId);
      if (!playerId) return safeAck(ack, { ok: false, error: 'Ungültige Spieler-ID.' });
      bindSocketToPlayer(socket, playerId);
      return safeAck(ack, { ok: true });
    });

    socket.on('create-room', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId);
      if (!playerId) return safeAck(ack, { ok: false, error: 'Ungültige Spieler-ID.' });
      const record = bindSocketToPlayer(socket, playerId, { sync: false });
      const oldRoomCode = record.roomCode;
      leaveCurrentRoom(playerId);
      if (oldRoomCode) socket.leave(oldRoomCode);

      const roomCode = makeRoomCode();
      const room = {
        code: roomCode,
        status: 'waiting',
        mode: normalizeGameMode(data.mode),
        startingScore: config.startingScore,
        roundIndex: -1,
        usedCountries: new Set(),
        players: [],
        rematchReady: new Set(),
        target: null,
        flagToken: null,
        deadline: 0,
        roundTimer: null,
        transitionTimer: null,
        cleanupTimer: null,
        finalResult: null,
        lastRoundResult: null,
        resultExpiresAt: 0,
      };
      rooms.set(roomCode, room);

      const player = {
        id: playerId,
        name: normalizeName(data.name),
        socketId: socket.id,
        connected: true,
        score: config.startingScore,
        guess: null,
      };
      room.players.push(player);
      players.get(playerId).roomCode = roomCode;
      socket.join(roomCode);
      emitLobby(room);
      return safeAck(ack, { ok: true, roomCode, mode: room.mode });
    });

    socket.on('join-room', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId);
      const roomCode = normalizeRoomCode(data.roomCode);
      if (!playerId) return safeAck(ack, { ok: false, error: 'Ungültige Spieler-ID.' });
      const room = rooms.get(roomCode);
      if (!room) return safeAck(ack, { ok: false, error: 'Lobby nicht gefunden.' });

      const record = bindSocketToPlayer(socket, playerId, { sync: false });
      const existingPlayer = getPlayer(room, playerId);
      if (existingPlayer) {
        existingPlayer.name = normalizeName(data.name || existingPlayer.name);
        existingPlayer.connected = true;
        existingPlayer.socketId = socket.id;
        players.get(playerId).roomCode = roomCode;
        socket.join(roomCode);
        socket.emit('state-sync', buildStateSync(room, playerId));
        emitLobby(room);
        return safeAck(ack, { ok: true, roomCode, rejoined: true });
      }

      if (room.status !== 'waiting') {
        return safeAck(ack, { ok: false, error: 'Dieses Spiel läuft bereits.' });
      }
      if (room.players.length >= 2) {
        return safeAck(ack, { ok: false, error: 'Die Lobby ist bereits voll.' });
      }

      const oldRoomCode = record.roomCode;
      leaveCurrentRoom(playerId);
      if (oldRoomCode) socket.leave(oldRoomCode);
      const player = {
        id: playerId,
        name: normalizeName(data.name),
        socketId: socket.id,
        connected: true,
        score: config.startingScore,
        guess: null,
      };
      room.players.push(player);
      players.get(playerId).roomCode = roomCode;
      socket.join(roomCode);
      emitLobby(room);
      safeAck(ack, { ok: true, roomCode });

      if (room.players.length === 2) {
        room.transitionTimer = setTimeout(() => startGame(room), config.roundStartDelayMs);
      }
    });

    socket.on('submit-guess', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId);
      const roomCode = normalizeRoomCode(data.roomCode);
      const room = rooms.get(roomCode);
      const player = room && playerId ? getPlayer(room, playerId) : null;
      const lat = Number(data.lat);
      const lng = Number(data.lng);

      if (!room || !player) return safeAck(ack, { ok: false, error: 'Lobby oder Spieler nicht gefunden.' });
      if (room.status !== 'playing' || !room.target) return safeAck(ack, { ok: false, error: 'Keine aktive Runde.' });
      if (Date.now() > room.deadline + 250) return safeAck(ack, { ok: false, error: 'Die Zeit ist abgelaufen.' });
      if (player.guess) return safeAck(ack, { ok: false, error: 'Tipp wurde bereits abgegeben.' });
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return safeAck(ack, { ok: false, error: 'Ungültige Position.' });
      }

      player.guess = { lat, lng, submittedAt: Date.now() };
      io.to(room.code).emit('guess-status', {
        playerId,
        hasGuessed: true,
        playersReady: room.players.filter((p) => p.guess).length,
      });
      emitLobby(room);
      safeAck(ack, { ok: true });
      maybeFinishEarly(room);
    });

    socket.on('request-rematch', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId);
      const roomCode = normalizeRoomCode(data.roomCode);
      const room = rooms.get(roomCode);
      if (!room || room.status !== 'ended' || !playerId || !getPlayer(room, playerId)) {
        return safeAck(ack, { ok: false, error: 'Rematch ist gerade nicht möglich.' });
      }
      room.rematchReady.add(playerId);
      emitLobby(room);
      io.to(room.code).emit('rematch-status', { ready: Array.from(room.rematchReady) });
      safeAck(ack, { ok: true });
      if (room.rematchReady.size === 2 && room.players.every((p) => p.connected)) {
        if (room.transitionTimer) clearTimeout(room.transitionTimer);
        room.transitionTimer = setTimeout(() => startGame(room), 900);
      }
    });

    socket.on('leave-room', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId);
      if (!playerId) return safeAck(ack, { ok: false });
      const record = players.get(playerId);
      const oldRoomCode = record?.roomCode;
      leaveCurrentRoom(playerId);
      if (oldRoomCode) socket.leave(oldRoomCode);
      safeAck(ack, { ok: true });
    });

    socket.on('disconnect', () => {
      for (const [playerId, record] of players.entries()) {
        if (record.socketId !== socket.id) continue;
        const room = record.roomCode ? rooms.get(record.roomCode) : null;
        const player = room ? getPlayer(room, playerId) : null;
        if (!room || !player) break;

        player.connected = false;
        emitLobby(room);
        record.disconnectTimer = setTimeout(() => {
          const latestRoom = record.roomCode ? rooms.get(record.roomCode) : null;
          const latestPlayer = latestRoom ? getPlayer(latestRoom, playerId) : null;
          if (!latestRoom || !latestPlayer || latestPlayer.connected) return;

          if (latestRoom.status === 'playing') {
            const opponent = latestRoom.players.find((p) => p.id !== playerId && p.connected);
            endGame(latestRoom, opponent?.id || null, 'opponent-disconnected');
          } else if (latestRoom.status === 'waiting' || latestRoom.status === 'ended') {
            leaveCurrentRoom(playerId);
          }
        }, config.disconnectGraceMs);
        break;
      }
    });
  });

  return {
    app,
    httpServer,
    io,
    debug: {
      playableCountries,
      rooms,
      scoreSettings: {
        startingScore: config.startingScore,
        maxRoundPoints: config.maxRoundPoints,
        scoreDistanceScaleKm: config.scoreDistanceScaleKm,
      },
    },
    close: async () => {
      for (const room of rooms.values()) clearRoomTimers(room);
      for (const player of players.values()) {
        if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
      }
      await new Promise((resolve) => io.close(resolve));
      if (httpServer.listening) {
        await new Promise((resolve) => httpServer.close(resolve));
      }
    },
  };
}

module.exports = { createGameServer };
