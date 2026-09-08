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
const DAILY_ROUNDS = 10;

const GAME_MODES = new Set(['map', 'globe']);
const GAME_FORMATS = new Set(['race', 'distance', 'bestof', 'sudden', 'battle']);
const VISUAL_MODES = new Set(['flag', 'crop', 'flash']);
const DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'insane']);
const SCORING_PROFILES = new Set(['normal', 'precision']);

const REGION_LABELS = Object.freeze({
  world: 'Weltweit', europe: 'Europa', northern_europe: 'Nordeuropa', southern_europe: 'Südeuropa',
  western_europe: 'Westeuropa', eastern_europe: 'Osteuropa', asia: 'Asien', western_asia: 'Westasien',
  eastern_asia: 'Ostasien', southeast_asia: 'Südostasien', southern_asia: 'Südasien', central_asia: 'Zentralasien',
  africa: 'Afrika', north_africa: 'Nordafrika', west_africa: 'Westafrika', east_africa: 'Ostafrika',
  central_africa: 'Zentralafrika', southern_africa: 'Südliches Afrika', americas: 'Amerika',
  north_america: 'Nordamerika', central_america: 'Zentralamerika', caribbean: 'Karibik', south_america: 'Südamerika',
  oceania: 'Ozeanien',
});
const REGION_KEYS = new Set(Object.keys(REGION_LABELS));
const FORMAT_LABELS = Object.freeze({
  race: '5000 → 0', distance: 'Distance Duel', bestof: 'Best of', sudden: 'Sudden Death', battle: 'Battle Royale',
});
const DIFFICULTY_LABELS = Object.freeze({ easy: 'Easy', medium: 'Medium', hard: 'Hard', insane: 'Insane' });
const VISUAL_LABELS = Object.freeze({ flag: 'Volle Flagge', crop: 'Mystery Crop', flash: 'Blind Flash' });
const ACHIEVEMENTS = Object.freeze({
  bullseye: { title: 'Bullseye', description: 'Unter 10 km von einer Hauptstadt.' },
  sharpshooter: { title: 'Sharpshooter', description: 'Unter 50 km von einer Hauptstadt.' },
  speed_demon: { title: 'Speed Demon', description: 'Einen Tipp in unter 3 Sekunden abgegeben.' },
  hot_streak: { title: 'On Fire', description: '3 starke Guesses in Folge.' },
  first_win: { title: 'Erster Sieg', description: 'Dein erstes Multiplayer-Match gewonnen.' },
  ten_wins: { title: 'Veteran', description: '10 Multiplayer-Matches gewonnen.' },
  explorer: { title: 'Globetrotter', description: '100 gültige Guesses abgegeben.' },
  daily: { title: 'Daily Grinder', description: 'Eine Daily Challenge abgeschlossen.' },
  battle: { title: 'Last One Standing', description: 'Ein Battle Royale gewonnen.' },
  precision: { title: 'Millimeterarbeit', description: 'Im Precision-Modus unter 25 km geraten.' },
});

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
    transports: ['websocket', 'polling'], pingInterval: 20000, pingTimeout: 20000,
  });

  const rooms = new Map();
  const identities = new Map();
  const flagTokens = new Map();
  const profiles = new Map();
  const dailyBoards = new Map();
  let shuttingDown = false;
  const persistData = options.persistData ?? !process.env.NODE_TEST_CONTEXT;
  const dataFile = options.dataFile || path.join(__dirname, '..', 'data', 'progress.json');
  let persistTimer = null;

  function loadPersistentState() {
    if (!persistData) return;
    try {
      const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      for (const item of raw.profiles || []) {
        if (!item?.id) continue;
        profiles.set(item.id, { ...item, achievements: new Set(item.achievements || []), regionGuesses: item.regionGuesses || {} });
      }
      for (const [day, entries] of Object.entries(raw.dailyBoards || {})) dailyBoards.set(day, Array.isArray(entries) ? entries : []);
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn('[flag-pinpoint] Could not load progress data:', error.message);
    }
  }

  function persistNow() {
    if (!persistData) return;
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      const payload = {
        version: 1,
        profiles: Array.from(profiles.values()).map((profile) => ({ ...profile, achievements: Array.from(profile.achievements || []) })),
        dailyBoards: Object.fromEntries(dailyBoards.entries()),
      };
      const temporary = `${dataFile}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(payload, null, 2));
      fs.renameSync(temporary, dataFile);
    } catch (error) {
      console.warn('[flag-pinpoint] Could not persist progress data:', error.message);
    }
  }

  function schedulePersist() {
    if (!persistData || shuttingDown) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persistTimer = null; persistNow(); }, 120);
    persistTimer.unref?.();
  }

  loadPersistentState();

  const countriesWithGameData = countries
    .filter((country) => country.independent === true)
    .filter((country) => Array.isArray(country.capital) && country.capital.length > 0)
    .filter((country) => /^[A-Z]{2}$/.test(country.cca2 || ''))
    .filter((country) => Array.isArray(CAPITAL_COORDINATES[country.cca2]))
    .filter((country) => fs.existsSync(path.join(FLAG_ICONS_DIR, `${country.cca2.toLowerCase()}.svg`)))
    .map((country) => {
      const [lat, lng] = CAPITAL_COORDINATES[country.cca2];
      return {
        code: country.cca2.toLowerCase(), isoCode: country.cca2,
        name: country.translations?.deu?.common || country.name.common,
        capital: country.capital[0], lat, lng,
        regionKey: String(country.region || '').toLowerCase(),
        subregionKey: String(country.subregion || '').toLowerCase(),
        population: Number(country.population || 0),
      };
    });

  const curatedCountries = countriesWithGameData.filter((country) => CURATED_COUNTRY_CODE_SET.has(country.isoCode));
  const playableCountries = curatedCountries.length >= 100 ? curatedCountries : countriesWithGameData;
  if (curatedCountries.length < 100) {
    console.warn(`[flag-pinpoint] Curated pool resolved to only ${curatedCountries.length}; using ${countriesWithGameData.length}.`);
  }
  if (playableCountries.length < 20) throw new Error(`Only ${playableCountries.length} playable countries found.`);
  console.log(`[flag-pinpoint] Loaded ${playableCountries.length} curated and ${countriesWithGameData.length} total countries.`);

  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
  app.use('/vendor/leaflet', express.static(LEAFLET_DIR, { maxAge: '30d', immutable: true }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  app.get('/api/flag/:token', (req, res) => {
    const record = flagTokens.get(req.params.token);
    if (!record || record.expiresAt < Date.now()) { flagTokens.delete(req.params.token); return res.sendStatus(404); }
    const filePath = path.join(FLAG_ICONS_DIR, `${record.countryCode}.svg`);
    if (!fs.existsSync(filePath)) return res.sendStatus(404);
    res.set({ 'Cache-Control': 'private, max-age=120', 'Content-Type': 'image/svg+xml; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    return res.sendFile(filePath);
  });

  function safeAck(ack, payload) { if (typeof ack === 'function') ack(payload); }
  function normalizePlayerId(value) { const id = String(value || '').trim(); return /^[a-zA-Z0-9_-]{16,80}$/.test(id) ? id : null; }
  function normalizeName(value) { return String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18) || 'Spieler'; }
  function normalizeRoomCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH); }
  function normalizeGameMode(value) { const mode = String(value || '').toLowerCase(); return GAME_MODES.has(mode) ? mode : 'map'; }
  function clampNumber(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback; }
  function normalizeBoolean(value) { return value === true || value === 'true' || value === 1 || value === '1'; }
  function slugSubregion(value) { return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''); }

  function normalizeRoomSettings(data = {}, kind = 'duel') {
    const input = data && typeof data === 'object' ? data : {};
    const regionRaw = String(input.region || 'world').toLowerCase();
    let region = REGION_KEYS.has(regionRaw) ? regionRaw : 'world';
    let startingScore = Math.round(clampNumber(input.startingScore, 1000, 30000, config.startingScore));
    let roundDurationMs = Math.round(clampNumber(input.roundDurationMs, 5000, 120000, config.roundDurationMs));
    let scoreMultiplier = Math.round(clampNumber(input.scoreMultiplier, 0.25, 5, 1) * 100) / 100;
    let format = GAME_FORMATS.has(String(input.format || '').toLowerCase()) ? String(input.format).toLowerCase() : 'race';
    let visualMode = VISUAL_MODES.has(String(input.visualMode || '').toLowerCase()) ? String(input.visualMode).toLowerCase() : 'flag';
    let difficulty = DIFFICULTIES.has(String(input.difficulty || '').toLowerCase()) ? String(input.difficulty).toLowerCase() : 'medium';
    let scoringProfile = SCORING_PROFILES.has(String(input.scoringProfile || '').toLowerCase()) ? String(input.scoringProfile).toLowerCase() : 'normal';
    let streakBonus = normalizeBoolean(input.streakBonus);
    let ranked = normalizeBoolean(input.ranked) && kind === 'duel';
    let bestOfRounds = Math.round(clampNumber(input.bestOfRounds, 3, 9, 5));
    if (bestOfRounds % 2 === 0) bestOfRounds += 1;
    const playerLimit = kind === 'battle' ? Math.round(clampNumber(input.playerLimit, 4, 8, 4)) : (kind === 'solo' || kind === 'daily' ? 1 : 2);
    if (kind === 'battle') format = 'battle';
    if (kind === 'solo' || kind === 'daily') { format = 'race'; ranked = false; }
    if (ranked) {
      region = 'world'; startingScore = 5000; roundDurationMs = 22000; scoreMultiplier = 1; format = 'race'; bestOfRounds = 5;
      visualMode = 'flag'; difficulty = 'medium'; scoringProfile = 'normal'; streakBonus = false;
    }
    return {
      region, startingScore, roundDurationMs, scoreMultiplier, format, visualMode, difficulty,
      scoringProfile, streakBonus, ranked, bestOfRounds, playerLimit, flashDurationMs: 2500,
    };
  }

  function publicSettings(room) {
    return {
      region: room.region, regionLabel: REGION_LABELS[room.region] || REGION_LABELS.world,
      startingScore: room.startingScore, roundDurationMs: room.roundDurationMs, scoreMultiplier: room.scoreMultiplier,
      maxRoundPoints: Math.round(config.maxRoundPoints * room.scoreMultiplier),
      format: room.format, formatLabel: FORMAT_LABELS[room.format] || FORMAT_LABELS.race,
      visualMode: room.visualMode, visualLabel: VISUAL_LABELS[room.visualMode] || VISUAL_LABELS.flag,
      difficulty: room.difficulty, difficultyLabel: DIFFICULTY_LABELS[room.difficulty] || DIFFICULTY_LABELS.medium,
      scoringProfile: room.scoringProfile, streakBonus: room.streakBonus, ranked: room.ranked,
      bestOfRounds: room.bestOfRounds, playerLimit: room.playerLimit, flashDurationMs: room.flashDurationMs,
      dailyRounds: room.kind === 'daily' ? DAILY_ROUNDS : null,
    };
  }

  function requiredPlayerCount(room) { return room.kind === 'solo' || room.kind === 'daily' ? 1 : room.kind === 'battle' ? room.playerLimit : 2; }
  function activePlayers(room) { return room.players.filter((player) => !player.eliminated); }
  function makeRoomCode() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      let code = ''; for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) code += ROOM_ALPHABET[crypto.randomInt(0, ROOM_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
    throw new Error('Could not allocate room code.');
  }
  function makeFlagToken(countryCode) { const token = crypto.randomBytes(24).toString('base64url'); flagTokens.set(token, { countryCode, expiresAt: Date.now() + 10 * 60 * 1000 }); return token; }

  function getProfile(playerId, name = 'Spieler') {
    if (!profiles.has(playerId)) {
      profiles.set(playerId, {
        id: playerId, name: normalizeName(name), rating: 1000, matches: 0, rankedMatches: 0, wins: 0, losses: 0, draws: 0,
        guesses: 0, totalDistanceKm: 0, totalPoints: 0, bestDistanceKm: null, bestStreak: 0,
        achievements: new Set(), regionGuesses: {},
      });
    }
    const profile = profiles.get(playerId);
    if (name) profile.name = normalizeName(name);
    return profile;
  }
  function publicProfile(profile) {
    return {
      id: profile.id, name: profile.name, rating: Math.round(profile.rating), matches: profile.matches, rankedMatches: profile.rankedMatches || 0, wins: profile.wins,
      losses: profile.losses, draws: profile.draws, guesses: profile.guesses,
      avgDistanceKm: profile.guesses ? profile.totalDistanceKm / profile.guesses : null,
      bestDistanceKm: profile.bestDistanceKm, totalPoints: profile.totalPoints, bestStreak: profile.bestStreak,
      achievements: Array.from(profile.achievements).map((key) => ({ key, ...(ACHIEVEMENTS[key] || { title: key, description: '' }) })),
    };
  }
  function leaderboardPayload() {
    return Array.from(profiles.values()).filter((p) => (p.rankedMatches || 0) > 0).sort((a, b) => b.rating - a.rating || b.wins - a.wins).slice(0, 20).map((p, index) => ({ rank: index + 1, name: p.name, rating: Math.round(p.rating), wins: p.wins, matches: p.matches }));
  }
  function emitProfile(playerId) {
    const record = identities.get(playerId); const profile = profiles.get(playerId);
    if (record?.socketId && profile) io.to(record.socketId).emit('profile-update', publicProfile(profile));
  }
  function unlock(playerId, key) {
    const profile = getProfile(playerId); if (!ACHIEVEMENTS[key] || profile.achievements.has(key)) return;
    profile.achievements.add(key); schedulePersist(); const record = identities.get(playerId);
    if (record?.socketId) io.to(record.socketId).emit('achievement-unlocked', { key, ...ACHIEVEMENTS[key] });
  }

  function publicPlayers(room) {
    return room.players.map((player) => ({
      id: player.id, name: player.name, connected: player.connected, score: player.score, hasGuessed: Boolean(player.guess),
      rematchReady: room.rematchReady.has(player.id), roundWins: player.roundWins || 0, eliminated: Boolean(player.eliminated),
      rank: player.rank || null,
    }));
  }
  function lobbyPayload(room) {
    return {
      roomCode: room.code, status: room.status, kind: room.kind, startingScore: room.startingScore,
      maxRoundPoints: Math.round(config.maxRoundPoints * room.scoreMultiplier), mode: room.mode, settings: publicSettings(room),
      players: publicPlayers(room), spectatorCount: room.spectators.length, playerLimit: room.playerLimit,
    };
  }
  function emitLobby(room) { io.to(room.code).emit('lobby-update', lobbyPayload(room)); }
  function getPlayer(room, playerId) { return room.players.find((player) => player.id === playerId); }
  function getSpectator(room, playerId) { return room.spectators.find((spectator) => spectator.id === playerId); }

  function buildStateSync(room, playerId) {
    const spectator = Boolean(getSpectator(room, playerId));
    const self = getPlayer(room, playerId);
    const payload = { room: lobbyPayload(room), selfId: playerId, spectator, round: null };
    if (room.status === 'playing' && room.target && room.flagToken) {
      payload.round = {
        roundNumber: room.roundIndex + 1, flagUrl: `/api/flag/${room.flagToken}`, deadline: room.deadline,
        serverTime: Date.now(), roundDurationMs: room.roundDurationMs, mode: room.mode, kind: room.kind,
        settings: publicSettings(room), spectator, hasGuessed: Boolean(self?.guess),
        guess: self?.guess ? { lat: self.guess.lat, lng: self.guess.lng } : null,
      };
    }
    if (room.status === 'playing' && !payload.round && room.lastRoundResult && room.resultExpiresAt > Date.now()) {
      payload.roundResult = { ...room.lastRoundResult, nextRoundInMs: Math.max(0, room.resultExpiresAt - Date.now()) };
    }
    if (room.status === 'ended') payload.gameOver = room.finalResult || finalPayload(room);
    return payload;
  }

  function bindSocket(socket, playerId, { sync = true } = {}) {
    let record = identities.get(playerId);
    if (!record) { record = { roomCode: null, socketId: socket.id, disconnectTimer: null, role: null }; identities.set(playerId, record); }
    if (record.disconnectTimer) { clearTimeout(record.disconnectTimer); record.disconnectTimer = null; }
    record.socketId = socket.id;
    const room = record.roomCode ? rooms.get(record.roomCode) : null;
    if (room) {
      const participant = record.role === 'spectator' ? getSpectator(room, playerId) : getPlayer(room, playerId);
      if (participant) {
        participant.socketId = socket.id; participant.connected = true; socket.join(room.code);
        if (sync) socket.emit('state-sync', buildStateSync(room, playerId)); emitLobby(room);
      }
    }
    return record;
  }

  function clearRoomTimers(room) {
    if (room.roundTimer) clearTimeout(room.roundTimer); if (room.transitionTimer) clearTimeout(room.transitionTimer); if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.roundTimer = null; room.transitionTimer = null; room.cleanupTimer = null;
  }

  function leaveCurrentRoom(playerId, { notify = true } = {}) {
    const record = identities.get(playerId); if (!record?.roomCode) return;
    const room = rooms.get(record.roomCode); if (!room) { record.roomCode = null; record.role = null; return; }
    if (record.role === 'spectator') {
      const index = room.spectators.findIndex((item) => item.id === playerId); if (index >= 0) room.spectators.splice(index, 1);
    } else {
      const index = room.players.findIndex((item) => item.id === playerId); if (index >= 0) room.players.splice(index, 1); room.rematchReady.delete(playerId);
    }
    record.roomCode = null; record.role = null;
    if (room.players.length === 0) { clearRoomTimers(room); rooms.delete(room.code); }
    else if (notify) emitLobby(room);
  }

  function matchesRegion(country, region) {
    if (region === 'world') return true;
    if (['europe', 'asia', 'africa', 'americas', 'oceania'].includes(region)) return country.regionKey === region;
    const slug = slugSubregion(country.subregionKey);
    const aliases = {
      northern_europe: ['northern_europe'], southern_europe: ['southern_europe'], western_europe: ['western_europe'], eastern_europe: ['eastern_europe'],
      western_asia: ['western_asia'], eastern_asia: ['eastern_asia'], southeast_asia: ['south_eastern_asia', 'southeast_asia'], southern_asia: ['southern_asia'], central_asia: ['central_asia'],
      north_africa: ['northern_africa'], west_africa: ['western_africa'], east_africa: ['eastern_africa'], central_africa: ['middle_africa', 'central_africa'], southern_africa: ['southern_africa'],
      north_america: ['northern_america'], central_america: ['central_america'], caribbean: ['caribbean'], south_america: ['south_america'],
    };
    return (aliases[region] || [region]).includes(slug);
  }
  function difficultyPool(room) {
    const source = room.difficulty === 'insane' ? countriesWithGameData : playableCountries;
    const regional = source.filter((country) => matchesRegion(country, room.region));
    const regionFallback = regional.length ? regional : source;
    let filtered = regionFallback;
    if (room.difficulty === 'easy') filtered = regionFallback.filter((country) => country.population >= 20_000_000);
    else if (room.difficulty === 'medium') filtered = regionFallback.filter((country) => country.population >= 4_000_000);
    if (filtered.length < Math.min(8, regionFallback.length)) filtered = regionFallback;
    return filtered;
  }
  function seededIndex(seed, length) { const hash = crypto.createHash('sha256').update(seed).digest(); return hash.readUInt32BE(0) % Math.max(1, length); }
  function dailyCountrySequence(room) {
    const pool = difficultyPool(room); const available = [...pool]; const result = [];
    for (let i = 0; i < Math.min(DAILY_ROUNDS, available.length); i += 1) {
      const idx = seededIndex(`${room.dailyId}:${i}`, available.length); result.push(available.splice(idx, 1)[0]);
    }
    return result;
  }
  function chooseCountry(room) {
    if (room.kind === 'daily') return room.dailyCountries[room.roundIndex % room.dailyCountries.length];
    const basePool = difficultyPool(room); const available = basePool.filter((country) => !room.usedCountries.has(country.code));
    const pool = available.length ? available : basePool; const country = pool[crypto.randomInt(0, pool.length)]; room.usedCountries.add(country.code); return country;
  }

  function createRoomObject({ kind, mode, settings, dailyId = null }) {
    return {
      code: makeRoomCode(), kind, status: 'waiting', mode: normalizeGameMode(mode),
      ...settings, roundIndex: -1, usedCountries: new Set(), players: [], spectators: [], rematchReady: new Set(),
      target: null, flagToken: null, deadline: 0, roundStartedAt: 0, roundTimer: null, transitionTimer: null, cleanupTimer: null,
      finalResult: null, lastRoundResult: null, resultExpiresAt: 0, history: [], recordedFinal: false,
      dailyId, dailyCountries: null,
    };
  }
  function createPlayer(playerId, name, room, socket) {
    return {
      id: playerId, name: normalizeName(name), socketId: socket.id, connected: true,
      score: room.kind === 'daily' ? 0 : room.startingScore, guess: null, roundWins: 0, streak: 0,
      eliminated: false, rank: null, matchStats: { guesses: 0, totalDistanceKm: 0, totalPoints: 0, bestDistanceKm: null, totalResponseMs: 0 },
    };
  }

  function startGame(room) {
    if (room.players.length !== requiredPlayerCount(room) || room.players.some((p) => !p.connected)) return;
    clearRoomTimers(room); room.status = 'playing'; room.roundIndex = -1; room.usedCountries = new Set(); room.rematchReady.clear();
    room.target = null; room.flagToken = null; room.finalResult = null; room.lastRoundResult = null; room.resultExpiresAt = 0; room.history = []; room.recordedFinal = false;
    if (room.kind === 'daily') room.dailyCountries = dailyCountrySequence(room);
    room.players.forEach((player) => {
      player.score = room.kind === 'daily' ? 0 : room.startingScore; player.guess = null; player.roundWins = 0; player.streak = 0; player.eliminated = false; player.rank = null;
      player.matchStats = { guesses: 0, totalDistanceKm: 0, totalPoints: 0, bestDistanceKm: null, totalResponseMs: 0 };
    });
    emitLobby(room); room.transitionTimer = setTimeout(() => nextRound(room), config.roundStartDelayMs);
  }

  function nextRound(room) {
    if (room.status !== 'playing') return;
    if (room.kind !== 'battle' && room.players.length !== requiredPlayerCount(room)) return;
    if (room.kind === 'battle' && activePlayers(room).length <= 1) { endGame(room, activePlayers(room)[0]?.id || null, 'battle-last-standing'); return; }
    room.roundIndex += 1; room.players.forEach((player) => { player.guess = null; }); room.lastRoundResult = null; room.resultExpiresAt = 0;
    room.target = chooseCountry(room); room.flagToken = makeFlagToken(room.target.code); room.roundStartedAt = Date.now(); room.deadline = room.roundStartedAt + room.roundDurationMs;
    io.to(room.code).emit('round-start', {
      roundNumber: room.roundIndex + 1, flagUrl: `/api/flag/${room.flagToken}`, deadline: room.deadline, serverTime: Date.now(), roundDurationMs: room.roundDurationMs,
      mode: room.mode, kind: room.kind, settings: publicSettings(room),
    });
    emitLobby(room); room.roundTimer = setTimeout(() => finishRound(room), room.roundDurationMs + 75);
  }

  function haversineKm(aLat, aLng, bLat, bLng) {
    const R = 6371.0088; const toRad = (deg) => (deg * Math.PI) / 180; const dLat = toRad(bLat - aLat); const dLng = toRad(bLng - aLng);
    const lat1 = toRad(aLat); const lat2 = toRad(bLat); const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function baseRoundPoints(distanceKm, room) {
    if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
    const effectiveMax = config.maxRoundPoints * room.scoreMultiplier;
    const scale = room.scoringProfile === 'precision' ? 650 : config.scoreDistanceScaleKm;
    const raw = effectiveMax * Math.exp(-distanceKm / scale);
    return Math.max(0, Math.min(Math.round(effectiveMax), Math.round(raw)));
  }

  function roundWinner(guesses) {
    const valid = guesses.filter((guess) => Number.isFinite(guess.distanceKm)); if (!valid.length) return null;
    valid.sort((a, b) => a.distanceKm - b.distanceKm || (a.submittedAt || Infinity) - (b.submittedAt || Infinity));
    if (valid.length >= 2 && Math.abs(valid[0].distanceKm - valid[1].distanceKm) <= 0.001) return null;
    return valid[0].playerId;
  }

  function recordRoundProfile(room, player, guess) {
    if (!Number.isFinite(guess.distanceKm)) return;
    const profile = getProfile(player.id, player.name); profile.guesses += 1; profile.totalDistanceKm += guess.distanceKm; profile.totalPoints += guess.roundPoints;
    profile.bestDistanceKm = profile.bestDistanceKm == null ? guess.distanceKm : Math.min(profile.bestDistanceKm, guess.distanceKm);
    profile.bestStreak = Math.max(profile.bestStreak, player.streak || 0); profile.regionGuesses[room.region] = (profile.regionGuesses[room.region] || 0) + 1;
    if (guess.distanceKm < 50) unlock(player.id, 'sharpshooter'); if (guess.distanceKm < 10) unlock(player.id, 'bullseye');
    if ((guess.responseMs || Infinity) < 3000) unlock(player.id, 'speed_demon'); if ((player.streak || 0) >= 3) unlock(player.id, 'hot_streak');
    if (profile.guesses >= 100) unlock(player.id, 'explorer'); if (room.scoringProfile === 'precision' && guess.distanceKm < 25) unlock(player.id, 'precision');
    schedulePersist(); emitProfile(player.id);
  }

  function finishRound(room) {
    if (room.status !== 'playing' || !room.target) return;
    if (room.roundTimer) clearTimeout(room.roundTimer); room.roundTimer = null;
    const participants = room.kind === 'battle' ? activePlayers(room) : room.players;
    const guesses = participants.map((player) => {
      const distanceKm = player.guess ? haversineKm(player.guess.lat, player.guess.lng, room.target.lat, room.target.lng) : null;
      const basePoints = baseRoundPoints(distanceKm, room); const quality = basePoints / Math.max(1, config.maxRoundPoints * room.scoreMultiplier);
      player.streak = Number.isFinite(distanceKm) && quality >= 0.7 ? (player.streak || 0) + 1 : 0;
      const streakMultiplier = room.streakBonus && player.streak > 1 ? 1 + Math.min(0.5, (player.streak - 1) * 0.1) : 1;
      const roundPoints = Math.round(basePoints * streakMultiplier); const responseMs = player.guess ? Math.max(0, player.guess.submittedAt - room.roundStartedAt) : null;
      return { playerId: player.id, name: player.name, lat: player.guess?.lat ?? null, lng: player.guess?.lng ?? null, distanceKm, basePoints, roundPoints, appliedPoints: 0, streak: player.streak, streakMultiplier, responseMs, submittedAt: player.guess?.submittedAt ?? null, scoreBefore: player.score, scoreAfter: player.score };
    });
    const winnerId = roundWinner(guesses);
    let matchWinnerId = null; let matchEnded = false; let eliminatedId = null;

    if (room.kind === 'daily') {
      for (const guess of guesses) { const player = getPlayer(room, guess.playerId); guess.appliedPoints = guess.roundPoints; player.score += guess.roundPoints; guess.scoreAfter = player.score; }
      matchEnded = room.roundIndex + 1 >= DAILY_ROUNDS; if (matchEnded) matchWinnerId = room.players[0]?.id || null;
    } else if (room.format === 'bestof') {
      if (winnerId) { const winner = getPlayer(room, winnerId); winner.roundWins += 1; }
      for (const guess of guesses) guess.scoreAfter = getPlayer(room, guess.playerId).score;
      const needed = Math.floor(room.bestOfRounds / 2) + 1; const winner = room.players.find((player) => player.roundWins >= needed);
      if (winner) { matchEnded = true; matchWinnerId = winner.id; }
    } else if (room.format === 'sudden') {
      if (winnerId) { matchEnded = true; matchWinnerId = winnerId; }
    } else if (room.format === 'battle') {
      if (participants.length > 1) {
        const sortedWorst = [...guesses].sort((a, b) => (b.distanceKm ?? Infinity) - (a.distanceKm ?? Infinity) || (b.submittedAt || Infinity) - (a.submittedAt || Infinity));
        const worst = sortedWorst[0]; eliminatedId = worst?.playerId || null;
        const eliminated = eliminatedId ? getPlayer(room, eliminatedId) : null;
        if (eliminated) { eliminated.eliminated = true; eliminated.rank = participants.length; }
      }
      const remaining = activePlayers(room); if (remaining.length <= 1) { matchEnded = true; matchWinnerId = remaining[0]?.id || winnerId; if (remaining[0]) remaining[0].rank = 1; }
    } else {
      for (const guess of guesses) {
        const player = getPlayer(room, guess.playerId);
        const applies = room.kind !== 'duel' || winnerId === guess.playerId;
        guess.appliedPoints = applies ? guess.roundPoints : 0; player.score = Math.max(0, player.score - guess.appliedPoints); guess.scoreAfter = player.score;
      }
      const zeroPlayers = room.players.filter((player) => player.score === 0);
      if (zeroPlayers.length) {
        matchEnded = true;
        if (zeroPlayers.length === 1) matchWinnerId = zeroPlayers[0].id;
        else matchWinnerId = winnerId;
      }
    }

    for (const guess of guesses) {
      const player = getPlayer(room, guess.playerId); if (!player) continue;
      if (Number.isFinite(guess.distanceKm)) {
        player.matchStats.guesses += 1; player.matchStats.totalDistanceKm += guess.distanceKm; player.matchStats.totalPoints += guess.roundPoints;
        player.matchStats.bestDistanceKm = player.matchStats.bestDistanceKm == null ? guess.distanceKm : Math.min(player.matchStats.bestDistanceKm, guess.distanceKm);
        player.matchStats.totalResponseMs += guess.responseMs || 0;
      }
      recordRoundProfile(room, player, guess);
    }

    const resultPayload = {
      roundNumber: room.roundIndex + 1, target: { name: room.target.name, capital: room.target.capital, lat: room.target.lat, lng: room.target.lng, code: room.target.isoCode },
      guesses, winnerId, eliminatedId, matchWinnerId, matchEnded,
      scores: room.players.map((player) => ({ playerId: player.id, name: player.name, score: player.score, roundWins: player.roundWins, eliminated: player.eliminated, rank: player.rank })),
      nextRoundInMs: config.revealDurationMs, mode: room.mode, kind: room.kind, settings: publicSettings(room),
    };
    room.history.push(resultPayload); room.lastRoundResult = resultPayload; room.resultExpiresAt = Date.now() + config.revealDurationMs;
    io.to(room.code).emit('round-result', resultPayload); emitLobby(room); room.target = null; room.flagToken = null;
    room.transitionTimer = setTimeout(() => { if (matchEnded) endGame(room, matchWinnerId, room.kind === 'battle' ? 'battle-last-standing' : room.kind === 'daily' ? 'daily-complete' : 'completed'); else nextRound(room); }, config.revealDurationMs);
  }

  function matchSummary(room) {
    const summary = {};
    for (const player of room.players) {
      const s = player.matchStats || {}; summary[player.id] = {
        playerId: player.id, name: player.name, rounds: room.history.length, guesses: s.guesses || 0,
        avgDistanceKm: s.guesses ? s.totalDistanceKm / s.guesses : null, bestDistanceKm: s.bestDistanceKm,
        totalPoints: s.totalPoints || 0, avgResponseMs: s.guesses ? s.totalResponseMs / s.guesses : null,
        roundWins: player.roundWins || 0, score: player.score, eliminated: Boolean(player.eliminated), rank: player.rank || null,
      };
    }
    return summary;
  }

  function updateRanked(room, winnerId) {
    if (!room.ranked || room.kind !== 'duel' || room.players.length !== 2 || room.recordedFinal) return;
    const [a, b] = room.players; const pa = getProfile(a.id, a.name); const pb = getProfile(b.id, b.name);
    const ea = 1 / (1 + 10 ** ((pb.rating - pa.rating) / 400)); const eb = 1 - ea;
    const sa = winnerId === a.id ? 1 : winnerId === b.id ? 0 : 0.5; const sb = 1 - sa; const K = 32;
    pa.rating += K * (sa - ea); pb.rating += K * (sb - eb);
    for (const [profile, player, score] of [[pa, a, sa], [pb, b, sb]]) {
      profile.matches += 1; profile.rankedMatches = (profile.rankedMatches || 0) + 1; if (score === 1) { profile.wins += 1; unlock(player.id, 'first_win'); if (profile.wins >= 10) unlock(player.id, 'ten_wins'); }
      else if (score === 0) profile.losses += 1; else profile.draws += 1; emitProfile(player.id);
    }
    schedulePersist();
  }

  function updateCasualProfile(room, winnerId) {
    if (room.ranked || room.recordedFinal || !['duel', 'battle'].includes(room.kind)) return;
    for (const player of room.players) {
      const p = getProfile(player.id, player.name); p.matches += 1;
      if (!winnerId) p.draws += 1; else if (winnerId === player.id) { p.wins += 1; unlock(player.id, 'first_win'); if (p.wins >= 10) unlock(player.id, 'ten_wins'); if (room.kind === 'battle') unlock(player.id, 'battle'); }
      else p.losses += 1; emitProfile(player.id);
    }
    schedulePersist();
  }

  function dailyBoardFor(id) { if (!dailyBoards.has(id)) dailyBoards.set(id, []); return dailyBoards.get(id); }
  function publicDailyBoard(id) { return dailyBoardFor(id).slice().sort((a, b) => b.score - a.score || a.avgDistanceKm - b.avgDistanceKm || a.avgResponseMs - b.avgResponseMs).slice(0, 20).map((entry, i) => ({ ...entry, rank: i + 1 })); }
  function recordDaily(room) {
    if (room.kind !== 'daily' || room.recordedFinal || !room.players[0]) return;
    const player = room.players[0]; const summary = matchSummary(room)[player.id]; const board = dailyBoardFor(room.dailyId);
    const entry = { playerId: player.id, name: player.name, score: player.score, avgDistanceKm: summary.avgDistanceKm ?? Infinity, avgResponseMs: summary.avgResponseMs ?? Infinity, completedAt: Date.now() };
    const existing = board.findIndex((item) => item.playerId === player.id); if (existing < 0 || entry.score > board[existing].score) { if (existing >= 0) board.splice(existing, 1); board.push(entry); }
    unlock(player.id, 'daily'); schedulePersist(); emitProfile(player.id);
  }

  function finalPayload(room, forcedWinnerId = null, reason = 'completed') {
    const scores = room.players.map((player) => ({ playerId: player.id, name: player.name, score: player.score, connected: player.connected, roundWins: player.roundWins || 0, eliminated: Boolean(player.eliminated), rank: player.rank || null }));
    let winnerId = forcedWinnerId;
    if (!winnerId && room.kind === 'duel' && scores.length === 2) {
      if (room.format === 'bestof' && scores[0].roundWins !== scores[1].roundWins) winnerId = scores[0].roundWins > scores[1].roundWins ? scores[0].playerId : scores[1].playerId;
      else if (scores[0].score !== scores[1].score) winnerId = scores[0].score < scores[1].score ? scores[0].playerId : scores[1].playerId;
    }
    if (!winnerId && ['solo', 'daily'].includes(room.kind) && scores.length === 1) winnerId = room.kind === 'daily' || scores[0].score === 0 ? scores[0].playerId : null;
    return { roomCode: room.code, scores, winnerId, reason, mode: room.mode, kind: room.kind, settings: publicSettings(room), stats: matchSummary(room), history: room.history.slice(-60), dailyId: room.dailyId, dailyLeaderboard: room.kind === 'daily' ? publicDailyBoard(room.dailyId) : null };
  }

  function endGame(room, forcedWinnerId = null, reason = 'completed') {
    if (room.status === 'ended') return;
    clearRoomTimers(room); room.status = 'ended'; room.target = null; room.flagToken = null; room.rematchReady.clear();
    if (room.kind === 'daily') recordDaily(room); else { updateRanked(room, forcedWinnerId); updateCasualProfile(room, forcedWinnerId); }
    room.recordedFinal = true; const payload = finalPayload(room, forcedWinnerId, reason); room.finalResult = payload;
    io.to(room.code).emit('game-over', payload); emitLobby(room);
    room.cleanupTimer = setTimeout(() => { if (room.status !== 'ended') return; rooms.delete(room.code); [...room.players, ...room.spectators].forEach((participant) => { const record = identities.get(participant.id); if (record?.roomCode === room.code) { record.roomCode = null; record.role = null; } }); }, 30 * 60 * 1000);
  }

  function maybeFinishEarly(room) {
    const required = room.kind === 'battle' ? activePlayers(room) : room.players;
    if (required.length && required.every((player) => Boolean(player.guess))) { if (room.roundTimer) clearTimeout(room.roundTimer); room.roundTimer = setTimeout(() => finishRound(room), 450); }
  }

  io.on('connection', (socket) => {
    socket.on('hello', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId); if (!playerId) return safeAck(ack, { ok: false, error: 'Ungültige Spieler-ID.' });
      bindSocket(socket, playerId); const profile = getProfile(playerId, data.name); return safeAck(ack, { ok: true, profile: publicProfile(profile), leaderboard: leaderboardPayload() });
    });

    socket.on('get-profile', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId); if (!playerId) return safeAck(ack, { ok: false }); return safeAck(ack, { ok: true, profile: publicProfile(getProfile(playerId, data.name)), leaderboard: leaderboardPayload() });
    });
    socket.on('get-daily-info', (_data = {}, ack) => {
      const dailyId = new Date().toISOString().slice(0, 10); return safeAck(ack, { ok: true, dailyId, rounds: DAILY_ROUNDS, leaderboard: publicDailyBoard(dailyId) });
    });

    socket.on('create-room', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId); if (!playerId) return safeAck(ack, { ok: false, error: 'Ungültige Spieler-ID.' });
      const kind = data.kind === 'battle' ? 'battle' : 'duel'; const record = bindSocket(socket, playerId, { sync: false }); const old = record.roomCode; leaveCurrentRoom(playerId); if (old) socket.leave(old);
      const settings = normalizeRoomSettings(data.settings, kind); const mode = settings.ranked ? 'globe' : normalizeGameMode(data.mode); const room = createRoomObject({ kind, mode, settings }); rooms.set(room.code, room);
      room.players.push(createPlayer(playerId, data.name, room, socket)); getProfile(playerId, data.name); record.roomCode = room.code; record.role = 'player'; socket.join(room.code); emitLobby(room);
      return safeAck(ack, { ok: true, roomCode: room.code, mode: room.mode, room: lobbyPayload(room) });
    });

    socket.on('start-solo', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId); if (!playerId) return safeAck(ack, { ok: false, error: 'Ungültige Spieler-ID.' });
      const record = bindSocket(socket, playerId, { sync: false }); const old = record.roomCode; leaveCurrentRoom(playerId); if (old) socket.leave(old);
      const settings = normalizeRoomSettings(data.settings, 'solo'); const room = createRoomObject({ kind: 'solo', mode: normalizeGameMode(data.mode), settings }); rooms.set(room.code, room);
      room.players.push(createPlayer(playerId, data.name, room, socket)); getProfile(playerId, data.name); record.roomCode = room.code; record.role = 'player'; socket.join(room.code); startGame(room);
      return safeAck(ack, { ok: true, roomCode: room.code, mode: room.mode, room: lobbyPayload(room) });
    });

    socket.on('start-daily', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId); if (!playerId) return safeAck(ack, { ok: false, error: 'Ungültige Spieler-ID.' });
      const record = bindSocket(socket, playerId, { sync: false }); const old = record.roomCode; leaveCurrentRoom(playerId); if (old) socket.leave(old);
      const dailyId = new Date().toISOString().slice(0, 10); const settings = normalizeRoomSettings({ region: 'world', roundDurationMs: 22000, startingScore: 5000, scoreMultiplier: 1, difficulty: 'hard', visualMode: 'flag', scoringProfile: 'normal', streakBonus: false }, 'daily');
      const room = createRoomObject({ kind: 'daily', mode: 'globe', settings, dailyId }); rooms.set(room.code, room); room.players.push(createPlayer(playerId, data.name, room, socket));
      getProfile(playerId, data.name); record.roomCode = room.code; record.role = 'player'; socket.join(room.code); startGame(room); return safeAck(ack, { ok: true, roomCode: room.code, room: lobbyPayload(room), dailyId });
    });

    socket.on('join-room', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId); const roomCode = normalizeRoomCode(data.roomCode); if (!playerId) return safeAck(ack, { ok: false, error: 'Ungültige Spieler-ID.' });
      const room = rooms.get(roomCode); if (!room) return safeAck(ack, { ok: false, error: 'Lobby nicht gefunden.' }); if (!['duel', 'battle'].includes(room.kind)) return safeAck(ack, { ok: false, error: 'Diese Session ist nicht beitretbar.' });
      const record = bindSocket(socket, playerId, { sync: false }); const existing = getPlayer(room, playerId);
      if (existing) { existing.name = normalizeName(data.name || existing.name); existing.connected = true; existing.socketId = socket.id; record.roomCode = roomCode; record.role = 'player'; socket.join(roomCode); socket.emit('state-sync', buildStateSync(room, playerId)); emitLobby(room); return safeAck(ack, { ok: true, roomCode, rejoined: true }); }
      if (room.status !== 'waiting') return safeAck(ack, { ok: false, error: 'Dieses Spiel läuft bereits – du kannst zuschauen.' }); if (room.players.length >= requiredPlayerCount(room)) return safeAck(ack, { ok: false, error: 'Die Lobby ist bereits voll.' });
      const old = record.roomCode; leaveCurrentRoom(playerId); if (old) socket.leave(old); room.players.push(createPlayer(playerId, data.name, room, socket)); getProfile(playerId, data.name); record.roomCode = roomCode; record.role = 'player'; socket.join(roomCode); emitLobby(room); safeAck(ack, { ok: true, roomCode, room: lobbyPayload(room) });
      if (room.players.length === requiredPlayerCount(room)) room.transitionTimer = setTimeout(() => startGame(room), config.roundStartDelayMs);
    });

    socket.on('spectate-room', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId); const roomCode = normalizeRoomCode(data.roomCode); if (!playerId) return safeAck(ack, { ok: false, error: 'Ungültige Spieler-ID.' });
      const room = rooms.get(roomCode); if (!room || !['duel', 'battle'].includes(room.kind)) return safeAck(ack, { ok: false, error: 'Lobby nicht gefunden.' });
      const record = bindSocket(socket, playerId, { sync: false }); const old = record.roomCode; leaveCurrentRoom(playerId); if (old) socket.leave(old);
      room.spectators.push({ id: playerId, name: normalizeName(data.name), socketId: socket.id, connected: true }); record.roomCode = roomCode; record.role = 'spectator'; socket.join(roomCode); socket.emit('state-sync', buildStateSync(room, playerId)); emitLobby(room); return safeAck(ack, { ok: true, roomCode, spectator: true });
    });

    socket.on('submit-guess', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId); const roomCode = normalizeRoomCode(data.roomCode); const room = rooms.get(roomCode); const player = room && playerId ? getPlayer(room, playerId) : null;
      const lat = Number(data.lat); const lng = Number(data.lng);
      if (!room || !player) return safeAck(ack, { ok: false, error: 'Lobby oder Spieler nicht gefunden.' }); if (player.eliminated) return safeAck(ack, { ok: false, error: 'Du bist bereits ausgeschieden.' });
      if (room.status !== 'playing' || !room.target) return safeAck(ack, { ok: false, error: 'Keine aktive Runde.' }); if (Date.now() > room.deadline + 250) return safeAck(ack, { ok: false, error: 'Die Zeit ist abgelaufen.' }); if (player.guess) return safeAck(ack, { ok: false, error: 'Tipp wurde bereits abgegeben.' });
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return safeAck(ack, { ok: false, error: 'Ungültige Position.' });
      player.guess = { lat, lng, submittedAt: Date.now() }; io.to(room.code).emit('guess-status', { playerId, hasGuessed: true, playersReady: activePlayers(room).filter((p) => p.guess).length, playersNeeded: activePlayers(room).length }); emitLobby(room); safeAck(ack, { ok: true }); maybeFinishEarly(room);
    });

    socket.on('request-rematch', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId); const roomCode = normalizeRoomCode(data.roomCode); const room = rooms.get(roomCode);
      if (!room || room.status !== 'ended' || !playerId || !getPlayer(room, playerId)) return safeAck(ack, { ok: false, error: 'Rematch ist gerade nicht möglich.' });
      if (room.kind === 'solo' || room.kind === 'daily') { safeAck(ack, { ok: true, solo: true }); startGame(room); return; }
      room.rematchReady.add(playerId); emitLobby(room); io.to(room.code).emit('rematch-status', { ready: Array.from(room.rematchReady) }); safeAck(ack, { ok: true });
      if (room.rematchReady.size === room.players.length && room.players.length === requiredPlayerCount(room) && room.players.every((p) => p.connected)) { if (room.transitionTimer) clearTimeout(room.transitionTimer); room.transitionTimer = setTimeout(() => startGame(room), 900); }
    });

    socket.on('leave-room', (data = {}, ack) => {
      const playerId = normalizePlayerId(data.playerId); if (!playerId) return safeAck(ack, { ok: false }); const record = identities.get(playerId); const oldRoomCode = record?.roomCode; const room = oldRoomCode ? rooms.get(oldRoomCode) : null;
      if (record?.role === 'spectator') { leaveCurrentRoom(playerId); if (oldRoomCode) socket.leave(oldRoomCode); return safeAck(ack, { ok: true }); }
      if (room?.status === 'playing' && room.kind === 'duel') { const opponent = room.players.find((player) => player.id !== playerId); if (oldRoomCode) socket.leave(oldRoomCode); if (opponent) endGame(room, opponent.id, 'opponent-left'); leaveCurrentRoom(playerId); }
      else if (room?.status === 'playing' && room.kind === 'battle') { const player = getPlayer(room, playerId); if (player) player.eliminated = true; leaveCurrentRoom(playerId); if (oldRoomCode) socket.leave(oldRoomCode); const remaining = activePlayers(room); if (remaining.length <= 1) endGame(room, remaining[0]?.id || null, 'battle-last-standing'); else emitLobby(room); }
      else { leaveCurrentRoom(playerId); if (oldRoomCode) socket.leave(oldRoomCode); }
      return safeAck(ack, { ok: true });
    });

    socket.on('disconnect', () => {
      if (shuttingDown) return;
      for (const [playerId, record] of identities.entries()) {
        if (record.socketId !== socket.id) continue; const room = record.roomCode ? rooms.get(record.roomCode) : null; if (!room) break;
        const participant = record.role === 'spectator' ? getSpectator(room, playerId) : getPlayer(room, playerId); if (!participant) break; participant.connected = false; emitLobby(room);
        record.disconnectTimer = setTimeout(() => {
          const latestRoom = record.roomCode ? rooms.get(record.roomCode) : null; if (!latestRoom) return; const latest = record.role === 'spectator' ? getSpectator(latestRoom, playerId) : getPlayer(latestRoom, playerId); if (!latest || latest.connected) return;
          if (record.role === 'spectator') leaveCurrentRoom(playerId);
          else if (latestRoom.status === 'playing' && latestRoom.kind === 'duel') { const opponent = latestRoom.players.find((p) => p.id !== playerId && p.connected); endGame(latestRoom, opponent?.id || null, 'opponent-disconnected'); }
          else if (latestRoom.status === 'playing' && latestRoom.kind === 'battle') { latest.eliminated = true; const remaining = activePlayers(latestRoom); if (remaining.length <= 1) endGame(latestRoom, remaining[0]?.id || null, 'battle-last-standing'); else emitLobby(latestRoom); }
          else if (latestRoom.status === 'playing') endGame(latestRoom, null, 'player-disconnected'); else leaveCurrentRoom(playerId);
        }, config.disconnectGraceMs); break;
      }
    });
  });

  return {
    app, httpServer, io,
    debug: { playableCountries, countriesWithGameData, rooms, profiles, dailyBoards, scoreSettings: { startingScore: config.startingScore, maxRoundPoints: config.maxRoundPoints, scoreDistanceScaleKm: config.scoreDistanceScaleKm } },
    close: async () => {
      shuttingDown = true;
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      persistNow();
      for (const room of rooms.values()) clearRoomTimers(room); for (const item of identities.values()) if (item.disconnectTimer) clearTimeout(item.disconnectTimer);
      await new Promise((resolve) => io.close(resolve)); if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

module.exports = { createGameServer };
