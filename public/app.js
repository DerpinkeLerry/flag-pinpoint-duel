/* global io, L */
'use strict';

const socket = io({ transports: ['websocket', 'polling'] });

const els = {
  homeScreen: document.getElementById('homeScreen'),
  lobbyScreen: document.getElementById('lobbyScreen'),
  gameScreen: document.getElementById('gameScreen'),
  playerName: document.getElementById('playerName'),
  roomCodeInput: document.getElementById('roomCodeInput'),
  soloStartButton: document.getElementById('soloStartButton'),
  createRoomButton: document.getElementById('createRoomButton'),
  joinRoomButton: document.getElementById('joinRoomButton'),
  regionSelect: document.getElementById('regionSelect'),
  roundTimeSelect: document.getElementById('roundTimeSelect'),
  startingScoreSelect: document.getElementById('startingScoreSelect'),
  scoreMultiplierSelect: document.getElementById('scoreMultiplierSelect'),
  settingsHint: document.getElementById('settingsHint'),
  homeError: document.getElementById('homeError'),
  lobbyCode: document.getElementById('lobbyCode'),
  lobbyPlayers: document.getElementById('lobbyPlayers'),
  lobbyStatus: document.getElementById('lobbyStatus'),
  lobbyModeBadge: document.getElementById('lobbyModeBadge'),
  lobbySettings: document.getElementById('lobbySettings'),
  copyCodeButton: document.getElementById('copyCodeButton'),
  copyLinkButton: document.getElementById('copyLinkButton'),
  leaveLobbyButton: document.getElementById('leaveLobbyButton'),
  hudRoomLabel: document.getElementById('hudRoomLabel'),
  hudRoomCode: document.getElementById('hudRoomCode'),
  scoreBoard: document.getElementById('scoreBoard'),
  selfScoreCard: document.getElementById('selfScoreCard'),
  opponentScoreCard: document.getElementById('opponentScoreCard'),
  selfName: document.getElementById('selfName'),
  selfScore: document.getElementById('selfScore'),
  opponentName: document.getElementById('opponentName'),
  opponentScore: document.getElementById('opponentScore'),
  roundLabel: document.getElementById('roundLabel'),
  timerText: document.getElementById('timerText'),
  timerRingProgress: document.getElementById('timerRingProgress'),
  timerWrap: document.querySelector('.timer-wrap'),
  gameMenuButton: document.getElementById('gameMenuButton'),
  gameMenuModal: document.getElementById('gameMenuModal'),
  gameMenuContext: document.getElementById('gameMenuContext'),
  resumeGameButton: document.getElementById('resumeGameButton'),
  exitGameButton: document.getElementById('exitGameButton'),
  map: document.getElementById('map'),
  globe: document.getElementById('globe'),
  globeStatus: document.getElementById('globeStatus'),
  mapHint: document.getElementById('mapHint'),
  flagImage: document.getElementById('flagImage'),
  guessState: document.getElementById('guessState'),
  submitGuessButton: document.getElementById('submitGuessButton'),
  roundResult: document.getElementById('roundResult'),
  resultHeadline: document.getElementById('resultHeadline'),
  resultCountry: document.getElementById('resultCountry'),
  resultDistances: document.getElementById('resultDistances'),
  nextRoundProgress: document.getElementById('nextRoundProgress'),
  resultCountdown: document.getElementById('resultCountdown'),
  gameOverModal: document.getElementById('gameOverModal'),
  gameOverTitle: document.getElementById('gameOverTitle'),
  gameOverScore: document.getElementById('gameOverScore'),
  gameOverNote: document.getElementById('gameOverNote'),
  rematchButton: document.getElementById('rematchButton'),
  backHomeButton: document.getElementById('backHomeButton'),
  rematchStatus: document.getElementById('rematchStatus'),
  connectionBadge: document.getElementById('connectionBadge'),
  toast: document.getElementById('toast'),
};

const state = {
  playerId: getOrCreatePlayerId(),
  roomCode: null,
  room: null,
  map: null,
  globeController: null,
  globePromise: null,
  ownMarker: null,
  resultLayers: [],
  pendingGuess: null,
  submitted: false,
  roundDeadline: 0,
  roundDuration: 22000,
  timerInterval: null,
  resultTimer: null,
  resultCountdownTimer: null,
  currentScreen: 'home',
};

function getOrCreatePlayerId() {
  let id = localStorage.getItem('flagDuelPlayerId');
  if (!id) {
    id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[^a-zA-Z0-9_-]/g, '');
    localStorage.setItem('flagDuelPlayerId', id);
  }
  return id;
}

els.playerName.value = localStorage.getItem('flagDuelName') || '';
const savedMode = localStorage.getItem('flagDuelMode');
if (savedMode === 'globe' || savedMode === 'map') {
  const modeInput = document.querySelector(`input[name="gameMode"][value="${savedMode}"]`);
  if (modeInput) modeInput.checked = true;
}
const savedSettings = (() => {
  try { return JSON.parse(localStorage.getItem('flagDuelSettings') || '{}'); } catch { return {}; }
})();
const settingSelects = {
  region: els.regionSelect,
  roundTimeSec: els.roundTimeSelect,
  startingScore: els.startingScoreSelect,
  scoreMultiplier: els.scoreMultiplierSelect,
};
Object.entries(settingSelects).forEach(([key, select]) => {
  const value = savedSettings[key];
  if (value == null) return;
  const option = Array.from(select.options).find((item) => item.value === String(value));
  if (option) select.value = String(value);
});

const inviteCode = new URLSearchParams(location.search).get('room');
if (inviteCode) els.roomCodeInput.value = inviteCode.toUpperCase().slice(0, 6);

function getSelectedMode() {
  return document.querySelector('input[name="gameMode"]:checked')?.value === 'globe' ? 'globe' : 'map';
}

function getSelectedSettings() {
  return {
    region: els.regionSelect.value,
    roundDurationMs: Number(els.roundTimeSelect.value) * 1000,
    startingScore: Number(els.startingScoreSelect.value),
    scoreMultiplier: Number(els.scoreMultiplierSelect.value),
  };
}

function saveSelectedSettings() {
  const settings = getSelectedSettings();
  localStorage.setItem('flagDuelSettings', JSON.stringify({
    region: settings.region,
    roundTimeSec: settings.roundDurationMs / 1000,
    startingScore: settings.startingScore,
    scoreMultiplier: settings.scoreMultiplier,
  }));
  const maxPoints = Math.round(1000 * settings.scoreMultiplier);
  els.settingsHint.textContent = `×${String(settings.scoreMultiplier).replace('.', ',')}: perfekter Guess baut bis zu ${maxPoints.toLocaleString('de-DE')} Punkte ab.`;
  return settings;
}

function currentGameMode() {
  return state.room?.mode === 'globe' ? 'globe' : 'map';
}

function currentMatchKind() {
  return state.room?.kind === 'solo' ? 'solo' : 'duel';
}

function setRoomMeta(payload = {}) {
  if (!state.room) return;
  if (payload.mode) state.room.mode = payload.mode === 'globe' ? 'globe' : 'map';
  if (payload.kind) state.room.kind = payload.kind === 'solo' ? 'solo' : 'duel';
  if (payload.settings) state.room.settings = { ...(state.room.settings || {}), ...payload.settings };
}

function setRoomMode(mode) {
  setRoomMeta({ mode });
}

function setScreen(name) {
  state.currentScreen = name;
  els.homeScreen.classList.toggle('hidden', name !== 'home');
  els.lobbyScreen.classList.toggle('hidden', name !== 'lobby');
  els.gameScreen.classList.toggle('hidden', name !== 'game');
  if (name !== 'game') closeGameMenu();
  if (name === 'game') syncGameSurface();
}

function openGameMenu() {
  if (state.currentScreen !== 'game' || !state.roomCode) return;
  const isSolo = currentMatchKind() === 'solo';
  els.gameMenuContext.textContent = isSolo
    ? 'Das Solo-Spiel wird beendet und du kehrst zum Hauptmenü zurück.'
    : 'Wenn du gehst, endet das laufende Match für deinen Gegner sofort.';
  els.gameMenuModal.classList.remove('hidden');
  els.gameMenuButton.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => els.resumeGameButton.focus());
}

function closeGameMenu() {
  els.gameMenuModal?.classList.add('hidden');
  els.gameMenuButton?.setAttribute('aria-expanded', 'false');
}

function syncGameSurface() {
  const globeMode = currentGameMode() === 'globe';
  els.map.classList.toggle('hidden', globeMode);
  els.globe.classList.toggle('hidden', !globeMode);

  if (globeMode) {
    ensureGlobe().then((globe) => {
      globe.resize();
      if (state.currentScreen === 'game' && !state.pendingGuess && state.roundDeadline) {
        els.mapHint.textContent = 'Drehen & zoomen · Fadenkreuz = exakter Tipp';
      }
    }).catch(() => {
      els.globeStatus.textContent = '3D-Globus konnte nicht geladen werden.';
      els.globeStatus.classList.remove('hidden');
      els.mapHint.textContent = '3D-Globus nicht verfügbar';
    });
  } else {
    ensureMap();
    setTimeout(() => state.map?.invalidateSize(), 80);
  }
}

async function ensureGlobe() {
  if (state.globePromise) return state.globePromise;
  if (state.globeController) return state.globeController;

  state.globePromise = import('/globe.js')
    .then(async ({ GlobeController }) => {
      const globe = new GlobeController(els.globe, {
        statusElement: els.globeStatus,
        onSelect: ({ lat, lng }) => handleSurfaceSelection(lat, lng),
      });
      state.globeController = globe;
      await globe.init();
      return globe;
    })
    .catch((error) => {
      state.globeController = null;
      state.globePromise = null;
      console.error('3D globe failed to initialize', error);
      throw error;
    });
  return state.globePromise;
}

function getName() {
  const name = els.playerName.value.trim().slice(0, 18) || 'Spieler';
  localStorage.setItem('flagDuelName', name);
  return name;
}

function showError(message = '') {
  els.homeError.textContent = message;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), 2200);
}

function emitAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response || { ok: false, error: 'Keine Serverantwort.' }));
  });
}

async function createRoom() {
  showError('');
  els.createRoomButton.disabled = true;
  const mode = getSelectedMode();
  const settings = saveSelectedSettings();
  localStorage.setItem('flagDuelMode', mode);
  const response = await emitAck('create-room', { playerId: state.playerId, name: getName(), mode, settings });
  els.createRoomButton.disabled = false;
  if (!response.ok) return showError(response.error || 'Lobby konnte nicht erstellt werden.');
  state.roomCode = response.roomCode;
  if (response.room) renderLobby(response.room);
  history.replaceState(null, '', `?room=${encodeURIComponent(response.roomCode)}`);
  setScreen('lobby');
}

async function startSolo() {
  showError('');
  els.soloStartButton.disabled = true;
  const mode = getSelectedMode();
  const settings = saveSelectedSettings();
  localStorage.setItem('flagDuelMode', mode);
  const response = await emitAck('start-solo', { playerId: state.playerId, name: getName(), mode, settings });
  els.soloStartButton.disabled = false;
  if (!response.ok) return showError(response.error || 'Solo-Spiel konnte nicht gestartet werden.');
  state.roomCode = response.roomCode;
  if (response.room) renderLobby(response.room);
  history.replaceState(null, '', location.pathname);
  setScreen('game');
  els.mapHint.textContent = 'Solo startet…';
}

async function joinRoom() {
  showError('');
  const roomCode = els.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (roomCode.length !== 6) return showError('Bitte einen 6-stelligen Lobby-Code eingeben.');
  els.joinRoomButton.disabled = true;
  const response = await emitAck('join-room', { playerId: state.playerId, name: getName(), roomCode });
  els.joinRoomButton.disabled = false;
  if (!response.ok) return showError(response.error || 'Beitritt fehlgeschlagen.');
  state.roomCode = response.roomCode;
  history.replaceState(null, '', `?room=${encodeURIComponent(response.roomCode)}`);
  setScreen('lobby');
}

function renderLobby(room) {
  state.room = room;
  state.roomCode = room.roomCode;
  const isSolo = room.kind === 'solo';
  const settings = room.settings || {};
  els.lobbyCode.textContent = room.roomCode;
  els.hudRoomLabel.textContent = isSolo ? 'MODUS' : 'LOBBY';
  els.hudRoomCode.textContent = isSolo ? 'SOLO' : room.roomCode;
  els.scoreBoard.classList.toggle('is-solo', isSolo);
  els.opponentScoreCard.classList.toggle('hidden', isSolo);
  const globeMode = room.mode === 'globe';
  els.lobbyModeBadge.textContent = globeMode ? '3D GLOBUS · OHNE LABELS' : '2D WELTKARTE';
  els.lobbyModeBadge.classList.toggle('is-globe', globeMode);
  els.lobbySettings.innerHTML = [
    settings.regionLabel || 'Weltweit',
    `${Math.round((settings.roundDurationMs || 22000) / 1000)} Sek.`,
    `${Number(settings.startingScore || room.startingScore || 5000).toLocaleString('de-DE')} Punkte`,
    `×${String(settings.scoreMultiplier || 1).replace('.', ',')} Abbau`,
  ].map((item) => `<span>${escapeHtml(item)}</span>`).join('');
  if (globeMode) ensureGlobe().catch(() => {});
  if (state.currentScreen === 'game') syncGameSurface();

  const slots = [...room.players];
  const desiredSlots = isSolo ? 1 : 2;
  while (slots.length < desiredSlots) slots.push(null);
  els.lobbyPlayers.innerHTML = slots.map((player) => {
    if (!player) {
      return `<div class="lobby-player waiting"><div class="player-avatar">?</div><strong>Gegner gesucht…</strong></div>`;
    }
    const me = player.id === state.playerId ? ' · Du' : '';
    const initial = escapeHtml(player.name.charAt(0).toUpperCase() || '?');
    return `<div class="lobby-player"><div class="player-avatar">${initial}</div><strong>${escapeHtml(player.name)}${me}</strong><small><span class="online-dot"></span>${player.connected ? 'verbunden' : 'Reconnect…'}</small></div>`;
  }).join('');

  if (room.status === 'waiting') {
    els.lobbyStatus.textContent = room.players.length === 2 ? 'Gegner gefunden. Spiel startet…' : 'Lobby ist offen…';
  }
  updateScores(room.players);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function updateScores(players = state.room?.players || []) {
  const self = players.find((player) => player.id === state.playerId);
  const opponent = players.find((player) => player.id !== state.playerId);
  if (self) {
    els.selfName.textContent = self.name;
    els.selfScore.textContent = self.score;
  }
  if (opponent) {
    els.opponentName.textContent = opponent.name;
    els.opponentScore.textContent = opponent.score;
  } else if (currentMatchKind() === 'solo') {
    els.opponentName.textContent = '';
    els.opponentScore.textContent = '';
  }
}

function ensureMap() {
  if (state.map) return;
  state.map = L.map('map', {
    zoomControl: true,
    minZoom: 2,
    maxZoom: 8,
    worldCopyJump: true,
    maxBoundsViscosity: .8,
  }).setView([18, 0], 2);
  state.map.setMaxBounds([[-85, -190], [85, 190]]);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(state.map);

  state.map.on('click', (event) => {
    if (currentGameMode() !== 'map') return;
    handleSurfaceSelection(event.latlng.lat, event.latlng.lng);
  });
}

function handleSurfaceSelection(lat, lng) {
  if (state.submitted || !state.roundDeadline || Date.now() >= state.roundDeadline) return;
  const safeLat = Math.max(-90, Math.min(90, Number(lat)));
  const safeLng = normalizeLng(Number(lng));
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) return;

  state.pendingGuess = { lat: safeLat, lng: safeLng };
  if (currentGameMode() === 'globe') {
    state.globeController?.setGuessMarker(safeLat, safeLng, false);
  } else if (state.map) {
    if (!state.ownMarker) {
      state.ownMarker = L.circleMarker([safeLat, safeLng], {
        radius: 9,
        weight: 4,
        color: '#ffffff',
        fillColor: '#34d399',
        fillOpacity: 1,
      }).addTo(state.map);
    } else {
      state.ownMarker.setLatLng([safeLat, safeLng]);
    }
  }

  els.submitGuessButton.disabled = false;
  els.guessState.textContent = 'Pin gesetzt – noch nicht gesendet';
  els.mapHint.textContent = currentGameMode() === 'globe'
    ? 'Weiter drehen oder Tipp abgeben'
    : 'Pin verschieben oder Tipp abgeben';
}

function normalizeLng(lng) {
  let value = lng;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function clearPlaySurfaceRound() {
  if (state.ownMarker && state.map) {
    state.map.removeLayer(state.ownMarker);
    state.ownMarker = null;
  }
  if (state.map) state.resultLayers.forEach((layer) => state.map.removeLayer(layer));
  state.resultLayers = [];
  state.globeController?.clearRound();
  state.pendingGuess = null;
  state.submitted = false;
  els.submitGuessButton.disabled = true;
  els.guessState.textContent = 'Ziel: Hauptstadt';
  els.mapHint.textContent = currentGameMode() === 'globe'
    ? 'Drehen & zoomen · Fadenkreuz = exakter Tipp'
    : 'Tippe auf die Hauptstadt des Landes';

  if (currentGameMode() === 'globe') state.globeController?.resetView();
  else state.map?.setView([18, 0], 2, { animate: true });
}

function startRound(payload, { synced = false } = {}) {
  setRoomMeta(payload);
  setScreen('game');
  els.gameOverModal.classList.add('hidden');
  els.roundResult.classList.add('hidden');
  clearTimeout(state.resultTimer);
  clearInterval(state.resultCountdownTimer);
  clearPlaySurfaceRound();
  els.flagImage.src = payload.flagUrl;
  els.roundLabel.textContent = `Runde ${payload.roundNumber}`;
  state.roundDeadline = Number(payload.deadline || 0);
  state.roundDuration = Number(payload.roundDurationMs || 22000);
  state.submitted = Boolean(payload.hasGuessed);

  if (payload.guess && Number.isFinite(payload.guess.lat) && Number.isFinite(payload.guess.lng)) {
    state.pendingGuess = { lat: payload.guess.lat, lng: normalizeLng(payload.guess.lng) };
    if (currentGameMode() === 'globe') {
      const restoredGuess = { ...state.pendingGuess };
      ensureGlobe().then((globe) => {
        if (state.pendingGuess?.lat === restoredGuess.lat && state.pendingGuess?.lng === restoredGuess.lng) {
          globe.setGuessMarker(restoredGuess.lat, restoredGuess.lng, true);
        }
      }).catch(() => {});
    } else if (state.map) {
      state.ownMarker = L.circleMarker([payload.guess.lat, payload.guess.lng], {
        radius: 9,
        weight: 4,
        color: '#ffffff',
        fillColor: '#60a5fa',
        fillOpacity: 1,
      }).addTo(state.map);
    }
  }

  if (state.submitted) {
    els.submitGuessButton.disabled = true;
    els.guessState.textContent = 'Tipp ist abgegeben';
    els.mapHint.textContent = currentMatchKind() === 'solo' ? 'Auswertung läuft…' : 'Warte auf deinen Gegner…';
  }
  startTimer();
  if (!synced) showToast(`Runde ${payload.roundNumber} startet`);
}

function startTimer() {
  clearInterval(state.timerInterval);
  const circumference = 2 * Math.PI * 18;
  function update() {
    if (!state.roundDeadline) return;
    const remaining = Math.max(0, state.roundDeadline - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const ratio = Math.max(0, Math.min(1, remaining / state.roundDuration));
    els.timerText.textContent = seconds;
    els.timerRingProgress.style.strokeDashoffset = String(circumference * (1 - ratio));
    els.timerWrap.classList.toggle('danger', seconds <= 5);
    if (remaining <= 0) {
      clearInterval(state.timerInterval);
      state.submitted = true;
      els.submitGuessButton.disabled = true;
      els.guessState.textContent = state.pendingGuess ? 'Zeit abgelaufen' : 'Kein Tipp abgegeben';
      els.mapHint.textContent = 'Runde wird ausgewertet…';
    }
  }
  update();
  state.timerInterval = setInterval(update, 120);
}

async function submitGuess() {
  if (!state.pendingGuess || state.submitted) return;
  els.submitGuessButton.disabled = true;
  const response = await emitAck('submit-guess', {
    playerId: state.playerId,
    roomCode: state.roomCode,
    lat: state.pendingGuess.lat,
    lng: state.pendingGuess.lng,
  });
  if (!response.ok) {
    showToast(response.error || 'Tipp konnte nicht gesendet werden.');
    if (Date.now() < state.roundDeadline) els.submitGuessButton.disabled = false;
    return;
  }
  state.submitted = true;
  els.guessState.textContent = 'Tipp ist abgegeben';
  els.mapHint.textContent = currentMatchKind() === 'solo' ? 'Auswertung läuft…' : 'Warte auf deinen Gegner…';
  if (currentGameMode() === 'globe') state.globeController?.setGuessSubmitted();
  else if (state.ownMarker) state.ownMarker.setStyle({ fillColor: '#60a5fa' });
}

function showRoundResult(payload) {
  setRoomMeta(payload);
  if (state.currentScreen === 'game') syncGameSurface();
  clearInterval(state.timerInterval);
  if (state.ownMarker && state.map) {
    state.map.removeLayer(state.ownMarker);
    state.ownMarker = null;
  }
  state.globeController?.clearGuessMarker();
  state.roundDeadline = 0;
  els.submitGuessButton.disabled = true;
  els.flagImage.removeAttribute('src');

  const selfGuess = payload.guesses.find((guess) => guess.playerId === state.playerId);
  const opponentGuess = payload.guesses.find((guess) => guess.playerId !== state.playerId);
  const selfRoundPoints = Number(selfGuess?.roundPoints || 0);
  const opponentRoundPoints = Number(opponentGuess?.roundPoints || 0);
  if (currentMatchKind() === 'solo') {
    els.resultHeadline.textContent = selfRoundPoints > 0
      ? `−${selfRoundPoints.toLocaleString('de-DE')} Punkte`
      : 'Keine Punkte abgebaut';
  } else if (selfRoundPoints === 0) {
    els.resultHeadline.textContent = 'Keine Punkte abgebaut';
  } else if (selfRoundPoints > opponentRoundPoints) {
    els.resultHeadline.textContent = `Stark: −${selfRoundPoints.toLocaleString('de-DE')} Punkte`;
  } else {
    els.resultHeadline.textContent = `−${selfRoundPoints.toLocaleString('de-DE')} Punkte für dich`;
  }
  els.resultCountry.textContent = payload.target.capital
    ? `${payload.target.name} · Ziel: ${payload.target.capital}`
    : payload.target.name;
  els.resultDistances.innerHTML = payload.guesses.map((guess) => {
    const who = guess.playerId === state.playerId ? 'Du' : escapeHtml(guess.name);
    const distance = Number.isFinite(guess.distanceKm) ? formatDistance(guess.distanceKm) : 'Kein Tipp';
    const points = Number(guess.roundPoints || 0);
    const pointsText = points > 0 ? `−${points.toLocaleString('de-DE')} Pkt` : '0 Pkt';
    return `<div class="distance-row"><span>${who}</span><strong>${distance} · ${pointsText}</strong></div>`;
  }).join('');
  els.roundResult.classList.remove('hidden');

  const revealEndsAt = Date.now() + Number(payload.nextRoundInMs || 0);
  clearInterval(state.resultCountdownTimer);
  const updateResultCountdown = () => {
    const seconds = Math.max(0, Math.ceil((revealEndsAt - Date.now()) / 1000));
    els.resultCountdown.textContent = payload.matchEnded
      ? `Match endet in ${seconds}s`
      : `Nächste Runde in ${seconds}s`;
  };
  updateResultCountdown();
  state.resultCountdownTimer = setInterval(updateResultCountdown, 200);

  els.nextRoundProgress.style.transition = 'none';
  els.nextRoundProgress.style.transform = 'scaleX(1)';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      els.nextRoundProgress.style.transition = `transform ${payload.nextRoundInMs}ms linear`;
      els.nextRoundProgress.style.transform = 'scaleX(0)';
    });
  });

  if (currentGameMode() === 'map' && state.map) {
    const targetMarker = L.circleMarker([payload.target.lat, payload.target.lng], {
      radius: 10,
      weight: 4,
      color: '#ffffff',
      fillColor: '#fbbf24',
      fillOpacity: 1,
    }).addTo(state.map).bindTooltip(
      `Ziel: ${escapeHtml(payload.target.capital || payload.target.name)}${payload.target.capital ? ` · ${escapeHtml(payload.target.name)}` : ''}`,
      { permanent: true, direction: 'top', className: 'result-map-label target-label', offset: [0, -8] },
    );
    state.resultLayers.push(targetMarker);

    const guessMarkers = [];
    payload.guesses.forEach((guess) => {
      if (!Number.isFinite(guess.lat) || !Number.isFinite(guess.lng)) return;
      const isSelf = guess.playerId === state.playerId;
      const marker = L.circleMarker([guess.lat, guess.lng], {
        radius: 8,
        weight: 3,
        color: '#ffffff',
        fillColor: isSelf ? '#34d399' : '#60a5fa',
        fillOpacity: 1,
      }).addTo(state.map).bindTooltip(
        `${isSelf ? 'Du' : escapeHtml(guess.name)} · ${formatDistance(guess.distanceKm)}`,
        { permanent: true, direction: 'top', className: `result-map-label ${isSelf ? 'self-label' : 'opponent-label'}`, offset: [0, -7] },
      );
      const line = L.polyline([[guess.lat, guess.lng], [payload.target.lat, payload.target.lng]], {
        weight: 2,
        opacity: .68,
        dashArray: '5 7',
        color: isSelf ? '#34d399' : '#60a5fa',
      }).addTo(state.map);
      guessMarkers.push(marker);
      state.resultLayers.push(marker, line);
    });
    targetMarker.bringToFront();
    guessMarkers.forEach((marker) => marker.bringToFront());

    const points = [[payload.target.lat, payload.target.lng]];
    [selfGuess, opponentGuess].forEach((guess) => {
      if (Number.isFinite(guess?.lat) && Number.isFinite(guess?.lng)) points.push([guess.lat, guess.lng]);
    });
    if (points.length > 1) {
      const mobile = window.matchMedia('(max-width: 700px)').matches;
      state.map.fitBounds(points, {
        paddingTopLeft: mobile ? [36, 105] : [90, 110],
        paddingBottomRight: mobile ? [225, 125] : [365, 145],
        maxZoom: mobile ? 3.4 : 4.2,
        animate: true,
      });
    } else {
      state.map.setView([payload.target.lat, payload.target.lng], 4, { animate: true });
    }
  } else if (currentGameMode() === 'globe') {
    ensureGlobe().then((globe) => globe.showRoundResult(payload, state.playerId)).catch(() => {});
  }

  if (state.room) {
    payload.scores.forEach((score) => {
      const player = state.room.players.find((p) => p.id === score.playerId);
      if (player) player.score = score.score;
    });
    updateScores(state.room.players);
  }

  clearTimeout(state.resultTimer);
  state.resultTimer = setTimeout(() => {
    clearInterval(state.resultCountdownTimer);
    if (!payload.matchEnded) els.roundResult.classList.add('hidden');
  }, payload.nextRoundInMs + 100);
}

function formatDistance(km) {
  if (!Number.isFinite(km)) return 'Kein Tipp';
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km).toLocaleString('de-DE')} km`;
}

function showGameOver(payload) {
  closeGameMenu();
  setRoomMeta(payload);
  clearInterval(state.timerInterval);
  clearInterval(state.resultCountdownTimer);
  state.roundDeadline = 0;
  els.roundResult.classList.add('hidden');
  els.gameOverModal.classList.remove('hidden');
  const self = payload.scores.find((score) => score.playerId === state.playerId);
  const opponent = payload.scores.find((score) => score.playerId !== state.playerId);
  const isSolo = payload.kind === 'solo' || currentMatchKind() === 'solo';
  const selfWon = payload.winnerId === state.playerId;
  const draw = !payload.winnerId;
  const startingScore = Number(payload.settings?.startingScore || state.room?.startingScore || 5000);

  els.rematchButton.classList.remove('hidden');

  if (isSolo) {
    els.gameOverTitle.textContent = selfWon ? 'Geschafft!' : 'Solo beendet';
    els.gameOverScore.textContent = `${Number(self?.score ?? 0).toLocaleString('de-DE')} Punkte`;
    els.gameOverNote.textContent = selfWon
      ? `Du hast deine ${startingScore.toLocaleString('de-DE')} Restpunkte auf 0 gespielt.`
      : 'Das Solo-Match wurde beendet.';
    els.rematchButton.textContent = 'Nochmal spielen';
    els.rematchStatus.textContent = '';
  } else {
    els.gameOverTitle.textContent = draw ? 'Unentschieden!' : selfWon ? 'Du gewinnst!' : 'Gegner gewinnt';
    els.gameOverScore.textContent = `${self?.score ?? 0} : ${opponent?.score ?? 0}`;
    if (payload.reason === 'opponent-left' && selfWon) {
      els.gameOverNote.textContent = 'Dein Gegner hat das Spiel verlassen.';
      els.rematchButton.classList.add('hidden');
    } else if (payload.reason === 'opponent-disconnected' && selfWon) {
      els.gameOverNote.textContent = 'Dein Gegner hat die Verbindung nicht wiederhergestellt.';
      els.rematchButton.classList.add('hidden');
    } else {
      els.gameOverNote.textContent = draw
        ? 'Ihr habt 0 gleichzeitig mit exakt gleicher Distanz erreicht.'
        : selfWon
          ? `Du hast deine ${startingScore.toLocaleString('de-DE')} Restpunkte zuerst auf 0 gespielt.`
          : `Dein Gegner hat seine ${startingScore.toLocaleString('de-DE')} Restpunkte zuerst auf 0 gespielt.`;
    }
    els.rematchButton.textContent = 'Rematch';
    els.rematchStatus.textContent = '';
  }
  els.rematchButton.disabled = false;
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch {
    showToast('Kopieren nicht möglich – bitte manuell markieren.');
  }
}

function inviteUrl() {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(state.roomCode || '')}`;
}

async function leaveRoom() {
  closeGameMenu();
  const roomCode = state.roomCode;
  if (roomCode && socket.connected) {
    await Promise.race([
      emitAck('leave-room', { playerId: state.playerId }),
      new Promise((resolve) => setTimeout(resolve, 900)),
    ]);
  }
  resetHome();
}

function resetHome() {
  closeGameMenu();
  state.roomCode = null;
  state.room = null;
  state.roundDeadline = 0;
  state.pendingGuess = null;
  state.submitted = false;
  clearInterval(state.timerInterval);
  clearTimeout(state.resultTimer);
  clearInterval(state.resultCountdownTimer);
  state.globeController?.clearRound();
  els.gameOverModal.classList.add('hidden');
  els.roundResult.classList.add('hidden');
  history.replaceState(null, '', location.pathname);
  setScreen('home');
}

els.soloStartButton.addEventListener('click', startSolo);
els.createRoomButton.addEventListener('click', createRoom);
els.joinRoomButton.addEventListener('click', joinRoom);
document.querySelectorAll('input[name="gameMode"]').forEach((input) => {
  input.addEventListener('change', () => localStorage.setItem('flagDuelMode', getSelectedMode()));
});
[els.regionSelect, els.roundTimeSelect, els.startingScoreSelect, els.scoreMultiplierSelect].forEach((select) => {
  select.addEventListener('change', saveSelectedSettings);
});
saveSelectedSettings();
els.roomCodeInput.addEventListener('input', () => {
  els.roomCodeInput.value = els.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});
els.roomCodeInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(); });
els.playerName.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !els.roomCodeInput.value) createRoom(); });
els.copyCodeButton.addEventListener('click', () => copyText(state.roomCode || '', 'Lobby-Code kopiert'));
els.copyLinkButton.addEventListener('click', () => copyText(inviteUrl(), 'Einladungslink kopiert'));
els.leaveLobbyButton.addEventListener('click', leaveRoom);
els.gameMenuButton.addEventListener('click', openGameMenu);
els.resumeGameButton.addEventListener('click', closeGameMenu);
els.exitGameButton.addEventListener('click', leaveRoom);
els.gameMenuModal.addEventListener('click', (event) => {
  if (event.target === els.gameMenuModal) closeGameMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.gameMenuModal.classList.contains('hidden')) closeGameMenu();
});
els.submitGuessButton.addEventListener('click', submitGuess);
els.backHomeButton.addEventListener('click', leaveRoom);
els.rematchButton.addEventListener('click', async () => {
  const isSolo = currentMatchKind() === 'solo';
  els.rematchButton.disabled = true;
  els.rematchButton.textContent = isSolo ? 'Neues Spiel startet…' : 'Warte auf Gegner…';
  const response = await emitAck('request-rematch', { playerId: state.playerId, roomCode: state.roomCode });
  if (!response.ok) {
    els.rematchButton.disabled = false;
    els.rematchButton.textContent = isSolo ? 'Nochmal spielen' : 'Rematch';
    showToast(response.error || 'Rematch nicht möglich.');
  }
});

socket.on('connect', async () => {
  els.connectionBadge.classList.add('hidden');
  await emitAck('hello', { playerId: state.playerId });
});
socket.on('disconnect', () => {
  if (state.currentScreen !== 'home') els.connectionBadge.classList.remove('hidden');
});
socket.on('connect_error', () => {
  if (state.currentScreen !== 'home') els.connectionBadge.classList.remove('hidden');
});

socket.on('state-sync', (payload) => {
  if (!payload?.room) return;
  state.roomCode = payload.room.roomCode;
  renderLobby(payload.room);
  if (payload.room.status === 'waiting' && payload.room.kind !== 'solo') setScreen('lobby');
  else if (payload.room.status === 'playing') {
    setScreen('game');
    if (payload.round) startRound(payload.round, { synced: true });
    else if (payload.roundResult) showRoundResult(payload.roundResult);
  } else if (payload.room.status === 'ended') {
    setScreen('game');
    if (payload.gameOver) showGameOver(payload.gameOver);
  }
});

socket.on('lobby-update', (room) => {
  renderLobby(room);
  if (room.status === 'waiting' && room.kind !== 'solo' && state.currentScreen !== 'home') setScreen('lobby');
});

socket.on('round-start', (payload) => startRound(payload));
socket.on('guess-status', (payload) => {
  if (currentMatchKind() !== 'solo' && payload.playerId !== state.playerId && state.submitted) {
    els.mapHint.textContent = 'Beide Tipps sind da – Auswertung…';
  }
});
socket.on('round-result', showRoundResult);
socket.on('game-over', showGameOver);
socket.on('rematch-status', (payload) => {
  if (currentMatchKind() === 'solo') return;
  const selfReady = payload.ready.includes(state.playerId);
  els.rematchStatus.textContent = payload.ready.length === 2 ? 'Beide bereit – neues Match startet…' : selfReady ? 'Du bist bereit. Warte auf deinen Gegner…' : '';
});
