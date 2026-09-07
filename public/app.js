/* global io, L */
'use strict';

const socket = io({ transports: ['websocket', 'polling'] });

const $ = (id) => document.getElementById(id);
const els = {
  homeScreen: $('homeScreen'), lobbyScreen: $('lobbyScreen'), gameScreen: $('gameScreen'),
  playerName: $('playerName'), roomCodeInput: $('roomCodeInput'), homeError: $('homeError'),
  soloStartButton: $('soloStartButton'), dailyStartButton: $('dailyStartButton'), createRoomButton: $('createRoomButton'), battleRoomButton: $('battleRoomButton'), joinRoomButton: $('joinRoomButton'), spectateButton: $('spectateButton'),
  regionSelect: $('regionSelect'), roundTimeSelect: $('roundTimeSelect'), startingScoreSelect: $('startingScoreSelect'), scoreMultiplierSelect: $('scoreMultiplierSelect'), formatSelect: $('formatSelect'), bestOfSelect: $('bestOfSelect'), bestOfField: $('bestOfField'), difficultySelect: $('difficultySelect'), visualModeSelect: $('visualModeSelect'), scoringProfileSelect: $('scoringProfileSelect'), playerLimitSelect: $('playerLimitSelect'), streakBonusToggle: $('streakBonusToggle'), rankedToggle: $('rankedToggle'), settingsHint: $('settingsHint'),
  presetSelect: $('presetSelect'), savePresetButton: $('savePresetButton'), deletePresetButton: $('deletePresetButton'),
  profileName: $('profileName'), profileRating: $('profileRating'), profileRecord: $('profileRecord'), openProfileButton: $('openProfileButton'), profileModal: $('profileModal'), profileDetails: $('profileDetails'), achievementList: $('achievementList'), rankedLeaderboard: $('rankedLeaderboard'), closeProfileButton: $('closeProfileButton'),
  dailyLabel: $('dailyLabel'), dailyTop: $('dailyTop'),
  lobbyTitle: $('lobbyTitle'), lobbyCode: $('lobbyCode'), lobbyPlayers: $('lobbyPlayers'), lobbyStatus: $('lobbyStatus'), lobbyModeBadge: $('lobbyModeBadge'), lobbySettings: $('lobbySettings'), spectatorCount: $('spectatorCount'), copyCodeButton: $('copyCodeButton'), copyLinkButton: $('copyLinkButton'), leaveLobbyButton: $('leaveLobbyButton'),
  hudRoomLabel: $('hudRoomLabel'), hudRoomCode: $('hudRoomCode'), scoreBoard: $('scoreBoard'), selfScoreCard: $('selfScoreCard'), opponentScoreCard: $('opponentScoreCard'), selfName: $('selfName'), selfScore: $('selfScore'), opponentName: $('opponentName'), opponentScore: $('opponentScore'), roundLabel: $('roundLabel'),
  timerText: $('timerText'), timerRingProgress: $('timerRingProgress'), timerWrap: document.querySelector('.timer-wrap'),
  gameMenuButton: $('gameMenuButton'), gameMenuModal: $('gameMenuModal'), gameMenuContext: $('gameMenuContext'), resumeGameButton: $('resumeGameButton'), soundToggleButton: $('soundToggleButton'), exitGameButton: $('exitGameButton'),
  map: $('map'), globe: $('globe'), globeStatus: $('globeStatus'), mapHint: $('mapHint'), battleRoster: $('battleRoster'), spectatorBadge: $('spectatorBadge'),
  flagDock: $('flagDock'), flagFrame: $('flagFrame'), flagImage: $('flagImage'), flagHiddenMessage: $('flagHiddenMessage'), guessState: $('guessState'), submitGuessButton: $('submitGuessButton'),
  roundResult: $('roundResult'), resultHeadline: $('resultHeadline'), resultCountry: $('resultCountry'), resultDistances: $('resultDistances'), nextRoundProgress: $('nextRoundProgress'), resultCountdown: $('resultCountdown'),
  gameOverModal: $('gameOverModal'), gameOverTitle: $('gameOverTitle'), gameOverScore: $('gameOverScore'), gameOverNote: $('gameOverNote'), matchStats: $('matchStats'), dailyResultLeaderboard: $('dailyResultLeaderboard'), analysisButton: $('analysisButton'), rematchButton: $('rematchButton'), backHomeButton: $('backHomeButton'), rematchStatus: $('rematchStatus'),
  analysisBar: $('analysisBar'), closeAnalysisButton: $('closeAnalysisButton'),
  connectionBadge: $('connectionBadge'), toast: $('toast'), achievementToast: $('achievementToast'), achievementToastTitle: $('achievementToastTitle'), achievementToastText: $('achievementToastText'),
};

const state = {
  playerId: getOrCreatePlayerId(), roomCode: null, room: null, isSpectator: false,
  map: null, globeController: null, globePromise: null, ownMarker: null, resultLayers: [],
  pendingGuess: null, submitted: false, roundDeadline: 0, roundDuration: 22000, serverOffset: 0,
  timerInterval: null, resultTimer: null, resultCountdownTimer: null, flagHideTimer: null,
  currentScreen: 'home', lastGameOver: null, analysisMode: false, profile: null, leaderboard: [], dailyInfo: null,
  soundEnabled: localStorage.getItem('flagPinpointSound') !== 'off', lastCountdownSecond: null,
};

const BUILTIN_PRESETS = {
  standard: { label: 'Standard', mode: 'globe', settings: { region: 'world', roundTimeSec: 22, startingScore: 5000, scoreMultiplier: 1, format: 'race', difficulty: 'medium', visualMode: 'flag', scoringProfile: 'normal', bestOfRounds: 5, playerLimit: 4, streakBonus: false, ranked: false } },
  hardcore: { label: 'Hardcore Globe', mode: 'globe', settings: { region: 'world', roundTimeSec: 15, startingScore: 5000, scoreMultiplier: 1, format: 'race', difficulty: 'hard', visualMode: 'crop', scoringProfile: 'normal', bestOfRounds: 5, playerLimit: 4, streakBonus: false, ranked: false } },
  blitz: { label: 'Blitz 8s', mode: 'globe', settings: { region: 'world', roundTimeSec: 8, startingScore: 5000, scoreMultiplier: 1.5, format: 'race', difficulty: 'medium', visualMode: 'flag', scoringProfile: 'normal', bestOfRounds: 5, playerLimit: 4, streakBonus: true, ranked: false } },
  precision: { label: 'Precision', mode: 'globe', settings: { region: 'world', roundTimeSec: 30, startingScore: 5000, scoreMultiplier: 1, format: 'race', difficulty: 'hard', visualMode: 'flag', scoringProfile: 'precision', bestOfRounds: 5, playerLimit: 4, streakBonus: false, ranked: false } },
  blind: { label: 'Blind Guess', mode: 'globe', settings: { region: 'world', roundTimeSec: 22, startingScore: 5000, scoreMultiplier: 1, format: 'race', difficulty: 'hard', visualMode: 'flash', scoringProfile: 'normal', bestOfRounds: 5, playerLimit: 4, streakBonus: false, ranked: false } },
  distance: { label: 'Distance Duel', mode: 'globe', settings: { region: 'world', roundTimeSec: 22, startingScore: 5000, scoreMultiplier: 1, format: 'distance', difficulty: 'medium', visualMode: 'flag', scoringProfile: 'normal', bestOfRounds: 5, playerLimit: 4, streakBonus: false, ranked: false } },
  ranked: { label: 'Ranked Standard', mode: 'globe', settings: { region: 'world', roundTimeSec: 22, startingScore: 5000, scoreMultiplier: 1, format: 'race', difficulty: 'medium', visualMode: 'flag', scoringProfile: 'normal', bestOfRounds: 5, playerLimit: 4, streakBonus: false, ranked: true } },
  chaos: { label: 'Chaos ×3', mode: 'globe', settings: { region: 'world', roundTimeSec: 10, startingScore: 7500, scoreMultiplier: 3, format: 'race', difficulty: 'insane', visualMode: 'crop', scoringProfile: 'normal', bestOfRounds: 5, playerLimit: 6, streakBonus: true, ranked: false } },
};

function getOrCreatePlayerId() {
  let id = localStorage.getItem('flagDuelPlayerId');
  if (!id) { id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[^a-zA-Z0-9_-]/g, ''); localStorage.setItem('flagDuelPlayerId', id); }
  return id;
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function normalizeLng(lng) { let value = lng; while (value > 180) value -= 360; while (value < -180) value += 360; return value; }
function getName() { const name = els.playerName.value.trim().slice(0, 18) || 'Spieler'; localStorage.setItem('flagDuelName', name); return name; }
function getSelectedMode() { return document.querySelector('input[name="gameMode"]:checked')?.value === 'globe' ? 'globe' : 'map'; }
function showError(message = '') { els.homeError.textContent = message; }
function showToast(message) { els.toast.textContent = message; els.toast.classList.remove('hidden'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), 2300); }
function emitAck(event, payload) { return new Promise((resolve) => socket.emit(event, payload, (response) => resolve(response || { ok: false, error: 'Keine Serverantwort.' }))); }
function setSelectValue(select, value) { if (!select) return; const option = Array.from(select.options).find((item) => item.value === String(value)); if (option) select.value = String(value); }

function readCustomPresets() { try { return JSON.parse(localStorage.getItem('flagPinpointPresets') || '[]'); } catch { return []; } }
function writeCustomPresets(items) { localStorage.setItem('flagPinpointPresets', JSON.stringify(items.slice(0, 20))); }
function refreshPresetOptions(selected = '') {
  const custom = readCustomPresets();
  els.presetSelect.innerHTML = '<optgroup label="Mitgeliefert">' + Object.entries(BUILTIN_PRESETS).map(([key, preset]) => `<option value="builtin:${key}">${escapeHtml(preset.label)}</option>`).join('') + '</optgroup>'
    + (custom.length ? '<optgroup label="Eigene Presets">' + custom.map((preset) => `<option value="custom:${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`).join('') + '</optgroup>' : '');
  if (selected && Array.from(els.presetSelect.options).some((o) => o.value === selected)) els.presetSelect.value = selected;
  els.deletePresetButton.disabled = !els.presetSelect.value.startsWith('custom:');
}
function currentSettingsForStorage() {
  return { region: els.regionSelect.value, roundTimeSec: Number(els.roundTimeSelect.value), startingScore: Number(els.startingScoreSelect.value), scoreMultiplier: Number(els.scoreMultiplierSelect.value), format: els.formatSelect.value, bestOfRounds: Number(els.bestOfSelect.value), difficulty: els.difficultySelect.value, visualMode: els.visualModeSelect.value, scoringProfile: els.scoringProfileSelect.value, playerLimit: Number(els.playerLimitSelect.value), streakBonus: els.streakBonusToggle.checked, ranked: els.rankedToggle.checked };
}
function getSelectedSettings() { const s = currentSettingsForStorage(); return { ...s, roundDurationMs: s.roundTimeSec * 1000 }; }
function applySettings(settings = {}, mode = null, { persist = true } = {}) {
  if (mode === 'map' || mode === 'globe') { const radio = document.querySelector(`input[name="gameMode"][value="${mode}"]`); if (radio) radio.checked = true; }
  setSelectValue(els.regionSelect, settings.region); setSelectValue(els.roundTimeSelect, settings.roundTimeSec); setSelectValue(els.startingScoreSelect, settings.startingScore); setSelectValue(els.scoreMultiplierSelect, settings.scoreMultiplier);
  setSelectValue(els.formatSelect, settings.format); setSelectValue(els.bestOfSelect, settings.bestOfRounds); setSelectValue(els.difficultySelect, settings.difficulty); setSelectValue(els.visualModeSelect, settings.visualMode); setSelectValue(els.scoringProfileSelect, settings.scoringProfile); setSelectValue(els.playerLimitSelect, settings.playerLimit);
  if (settings.streakBonus != null) els.streakBonusToggle.checked = Boolean(settings.streakBonus); if (settings.ranked != null) els.rankedToggle.checked = Boolean(settings.ranked);
  updateSettingsUI(); if (persist) saveSelectedSettings();
}
function saveSelectedSettings() {
  const storage = currentSettingsForStorage(); localStorage.setItem('flagDuelSettings', JSON.stringify(storage)); localStorage.setItem('flagDuelMode', getSelectedMode()); updateSettingsUI(); return getSelectedSettings();
}
function updateSettingsUI() {
  els.bestOfField.classList.toggle('hidden', els.formatSelect.value !== 'bestof');
  const ranked = els.rankedToggle.checked;
  if (ranked) {
    setSelectValue(els.regionSelect, 'world'); setSelectValue(els.roundTimeSelect, 22); setSelectValue(els.startingScoreSelect, 5000); setSelectValue(els.scoreMultiplierSelect, 1); setSelectValue(els.formatSelect, 'race'); setSelectValue(els.difficultySelect, 'medium'); setSelectValue(els.visualModeSelect, 'flag'); setSelectValue(els.scoringProfileSelect, 'normal'); els.streakBonusToggle.checked = false;
    const globeRadio = document.querySelector('input[name="gameMode"][value="globe"]'); if (globeRadio) globeRadio.checked = true;
  }
  const locked = ranked;
  [els.regionSelect, els.roundTimeSelect, els.startingScoreSelect, els.scoreMultiplierSelect, els.formatSelect, els.difficultySelect, els.visualModeSelect, els.scoringProfileSelect, els.streakBonusToggle].forEach((control) => { control.disabled = locked; });
  const multiplier = Number(els.scoreMultiplierSelect.value || 1); const maxPoints = Math.round(1000 * multiplier);
  const extra = ranked ? ' Ranked nutzt feste faire Regeln: 3D, Weltweit, 22s, 5000, ×1.' : els.scoringProfileSelect.value === 'precision' ? ' Precision bestraft schon mittlere Distanzen deutlich stärker.' : els.streakBonusToggle.checked ? ' Gute Serien erhöhen den Abbau bis maximal ×1,5.' : '';
  els.settingsHint.textContent = `Perfekter Guess: bis ${maxPoints.toLocaleString('de-DE')} Punkte.${extra}`;
  els.bestOfField.classList.toggle('hidden', els.formatSelect.value !== 'bestof');
}
function applySelectedPreset() {
  const value = els.presetSelect.value;
  if (value.startsWith('builtin:')) { const preset = BUILTIN_PRESETS[value.split(':')[1]]; if (preset) applySettings(preset.settings, preset.mode); }
  else if (value.startsWith('custom:')) { const item = readCustomPresets().find((p) => p.id === value.slice(7)); if (item) applySettings(item.settings, item.mode); }
  els.deletePresetButton.disabled = !value.startsWith('custom:');
}

function currentGameMode() { return state.room?.mode === 'globe' ? 'globe' : 'map'; }
function currentMatchKind() { return state.room?.kind || 'duel'; }
function setRoomMeta(payload = {}) { if (!state.room) return; if (payload.mode) state.room.mode = payload.mode; if (payload.kind) state.room.kind = payload.kind; if (payload.settings) state.room.settings = { ...(state.room.settings || {}), ...payload.settings }; }
function setScreen(name) { state.currentScreen = name; els.homeScreen.classList.toggle('hidden', name !== 'home'); els.lobbyScreen.classList.toggle('hidden', name !== 'lobby'); els.gameScreen.classList.toggle('hidden', name !== 'game'); if (name !== 'game') closeGameMenu(); if (name === 'game') syncGameSurface(); }

function openGameMenu() {
  if (state.currentScreen !== 'game' || !state.roomCode) return;
  const kind = currentMatchKind();
  els.gameMenuContext.textContent = state.isSpectator ? 'Du verlässt den Zuschauerplatz und kehrst ins Hauptmenü zurück.' : ['solo', 'daily'].includes(kind) ? 'Das aktuelle Spiel wird beendet und du kehrst zum Hauptmenü zurück.' : kind === 'battle' ? 'Wenn du gehst, scheidest du aus dem Battle Royale aus.' : 'Wenn du gehst, endet das laufende Match für deinen Gegner sofort.';
  els.soundToggleButton.textContent = `Sound: ${state.soundEnabled ? 'An' : 'Aus'}`; els.gameMenuModal.classList.remove('hidden'); els.gameMenuButton.setAttribute('aria-expanded', 'true'); requestAnimationFrame(() => els.resumeGameButton.focus());
}
function closeGameMenu() { els.gameMenuModal.classList.add('hidden'); els.gameMenuButton.setAttribute('aria-expanded', 'false'); }

function syncGameSurface() {
  const globeMode = currentGameMode() === 'globe'; els.map.classList.toggle('hidden', globeMode); els.globe.classList.toggle('hidden', !globeMode);
  if (globeMode) ensureGlobe().then((globe) => { globe.resize(); if (state.currentScreen === 'game' && !state.pendingGuess && state.roundDeadline && !state.isSpectator) els.mapHint.textContent = 'Drehen & zoomen · Mittelpunkt = exakter Tipp'; }).catch(() => { els.globeStatus.textContent = '3D-Globus konnte nicht geladen werden.'; els.globeStatus.classList.remove('hidden'); });
  else { ensureMap(); setTimeout(() => state.map?.invalidateSize(), 80); }
}
async function ensureGlobe() {
  if (state.globeController) return state.globeController; if (state.globePromise) return state.globePromise;
  state.globePromise = import('/globe.js').then(async ({ GlobeController }) => { const globe = new GlobeController(els.globe, { statusElement: els.globeStatus, onSelect: ({ lat, lng }) => handleSurfaceSelection(lat, lng) }); state.globeController = globe; await globe.init(); return globe; }).catch((error) => { state.globeController = null; state.globePromise = null; console.error(error); throw error; }); return state.globePromise;
}
function ensureMap() {
  if (state.map) return;
  state.map = L.map('map', { zoomControl: true, minZoom: 2, maxZoom: 9, worldCopyJump: true, maxBoundsViscosity: .8 }).setView([18, 0], 2); state.map.setMaxBounds([[-85, -190], [85, 190]]);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(state.map);
  state.map.on('click', (event) => { if (currentGameMode() === 'map') handleSurfaceSelection(event.latlng.lat, event.latlng.lng); });
}

function isSelfEliminated() { return Boolean(state.room?.players?.find((p) => p.id === state.playerId)?.eliminated); }
function handleSurfaceSelection(lat, lng) {
  if (state.isSpectator || isSelfEliminated() || state.submitted || !state.roundDeadline || Date.now() >= state.roundDeadline) return;
  const safeLat = Math.max(-90, Math.min(90, Number(lat))); const safeLng = normalizeLng(Number(lng)); if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) return;
  state.pendingGuess = { lat: safeLat, lng: safeLng };
  if (currentGameMode() === 'globe') state.globeController?.setGuessMarker(safeLat, safeLng, false);
  else if (state.map) {
    if (!state.ownMarker) state.ownMarker = L.circleMarker([safeLat, safeLng], { radius: 6, weight: 2, color: '#fff', fillColor: '#34d399', fillOpacity: 1 }).addTo(state.map); else state.ownMarker.setLatLng([safeLat, safeLng]);
  }
  els.submitGuessButton.disabled = false; els.guessState.textContent = 'Pin gesetzt – noch nicht gesendet'; els.mapHint.textContent = currentGameMode() === 'globe' ? 'Weiter drehen oder Tipp abgeben' : 'Pin verschieben oder Tipp abgeben'; playSound('pin');
}
function clearPlaySurfaceRound() {
  if (state.map) { if (state.ownMarker) state.map.removeLayer(state.ownMarker); state.ownMarker = null; state.resultLayers.forEach((layer) => { try { state.map.removeLayer(layer); } catch {} }); state.resultLayers = []; }
  state.globeController?.clearRound();
}

function configureFlagVisual(settings, roundNumber) {
  clearTimeout(state.flagHideTimer); els.flagFrame.classList.remove('is-crop', 'is-flash-hidden'); els.flagImage.classList.remove('hidden'); els.flagHiddenMessage.classList.add('hidden');
  if (settings?.visualMode === 'crop') { els.flagFrame.classList.add('is-crop'); els.flagImage.style.setProperty('--crop-x', `${44 + ((roundNumber * 17) % 13)}%`); els.flagImage.style.setProperty('--crop-y', `${42 + ((roundNumber * 11) % 15)}%`); }
  else { els.flagImage.style.removeProperty('--crop-x'); els.flagImage.style.removeProperty('--crop-y'); }
  if (settings?.visualMode === 'flash') state.flagHideTimer = setTimeout(() => { if (!state.submitted && state.roundDeadline) { els.flagImage.classList.add('hidden'); els.flagHiddenMessage.classList.remove('hidden'); els.flagFrame.classList.add('is-flash-hidden'); } }, Number(settings.flashDurationMs || 2500));
}

function startRound(payload, { synced = false } = {}) {
  setRoomMeta(payload); setScreen('game'); closeGameMenu(); state.analysisMode = false; els.analysisBar.classList.add('hidden'); els.gameOverModal.classList.add('hidden'); els.roundResult.classList.add('hidden'); els.flagDock.classList.remove('hidden');
  state.serverOffset = Number(payload.serverTime || Date.now()) - Date.now(); state.roundDeadline = Number(payload.deadline) - state.serverOffset; state.roundDuration = Number(payload.roundDurationMs || 22000); state.pendingGuess = null; state.submitted = Boolean(payload.hasGuessed); state.lastCountdownSecond = null;
  clearPlaySurfaceRound(); syncGameSurface(); updateScores(state.room?.players || []); renderBattleRoster();
  els.roundLabel.textContent = currentMatchKind() === 'daily' ? `Daily ${payload.roundNumber}/${payload.settings?.dailyRounds || 10}` : `Runde ${payload.roundNumber}`;
  els.flagImage.src = payload.flagUrl; configureFlagVisual(payload.settings || {}, payload.roundNumber); els.flagImage.alt = 'Zu erratende Flagge';
  const blocked = state.isSpectator || isSelfEliminated();
  els.submitGuessButton.disabled = true; els.submitGuessButton.textContent = blocked ? (state.isSpectator ? 'Zuschauer' : 'Ausgeschieden') : state.submitted ? 'Tipp gesendet' : 'Tipp abgeben';
  els.guessState.textContent = blocked ? (state.isSpectator ? 'Live zuschauen' : 'Du schaust die restlichen Runden') : state.submitted ? 'Tipp ist gespeichert' : payload.settings?.scoringProfile === 'precision' ? 'Precision: jeder Kilometer zählt' : 'Ziel: Hauptstadt';
  els.mapHint.textContent = blocked ? 'Zuschauermodus · Runde läuft' : currentGameMode() === 'globe' ? 'Drehen & zoomen · tippen zum Setzen' : 'Tippe auf die Hauptstadt des Landes';
  if (synced && payload.guess && Number.isFinite(payload.guess.lat) && Number.isFinite(payload.guess.lng)) { state.pendingGuess = { lat: payload.guess.lat, lng: payload.guess.lng }; if (currentGameMode() === 'globe') ensureGlobe().then((g) => g.setGuessMarker(payload.guess.lat, payload.guess.lng, true)); else { ensureMap(); state.ownMarker = L.circleMarker([payload.guess.lat, payload.guess.lng], { radius: 6, weight: 2, color: '#fff', fillColor: '#60a5fa', fillOpacity: 1 }).addTo(state.map); } }
  startTimer(); playSound('round');
}

function startTimer() {
  clearInterval(state.timerInterval); const circumference = 113.1;
  function update() {
    const remainingMs = Math.max(0, state.roundDeadline - Date.now()); const remainingSec = Math.ceil(remainingMs / 1000); const ratio = state.roundDuration ? remainingMs / state.roundDuration : 0;
    els.timerText.textContent = remainingSec; els.timerRingProgress.style.strokeDashoffset = String(circumference * (1 - Math.max(0, Math.min(1, ratio)))); els.timerWrap.classList.toggle('danger', remainingSec <= 5);
    if (remainingSec <= 3 && remainingSec > 0 && remainingSec !== state.lastCountdownSecond) { state.lastCountdownSecond = remainingSec; playSound('tick'); }
    if (remainingMs <= 0) { clearInterval(state.timerInterval); state.roundDeadline = 0; els.submitGuessButton.disabled = true; if (!state.submitted && !state.isSpectator && !isSelfEliminated()) els.guessState.textContent = 'Zeit abgelaufen'; }
  }
  update(); state.timerInterval = setInterval(update, 120);
}

async function submitGuess() {
  if (!state.pendingGuess || state.submitted || state.isSpectator || isSelfEliminated()) return; els.submitGuessButton.disabled = true;
  const response = await emitAck('submit-guess', { playerId: state.playerId, roomCode: state.roomCode, lat: state.pendingGuess.lat, lng: state.pendingGuess.lng });
  if (!response.ok) { if (state.roundDeadline > Date.now()) els.submitGuessButton.disabled = false; return showToast(response.error || 'Tipp konnte nicht gesendet werden.'); }
  state.submitted = true; state.globeController?.setGuessSubmitted(); els.submitGuessButton.textContent = 'Tipp gesendet'; els.guessState.textContent = 'Gespeichert · warte auf Auswertung'; els.mapHint.textContent = currentMatchKind() === 'solo' || currentMatchKind() === 'daily' ? 'Tipp gespeichert…' : 'Tipp gespeichert · warte auf andere'; playSound('submit');
}

function playerColor(index) { return ['#34d399', '#60a5fa', '#f472b6', '#a78bfa', '#fb923c', '#22d3ee', '#facc15', '#c084fc'][index % 8]; }
function formatDistance(km) { if (!Number.isFinite(km)) return 'Kein Tipp'; if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`; return `${Math.round(km).toLocaleString('de-DE')} km`; }
function formatMs(ms) { if (!Number.isFinite(ms)) return '–'; return `${(ms / 1000).toFixed(1).replace('.', ',')}s`; }

function showRoundResult(payload) {
  setRoomMeta(payload); clearInterval(state.timerInterval); clearTimeout(state.flagHideTimer); state.roundDeadline = 0; state.submitted = true; els.submitGuessButton.disabled = true; els.flagImage.classList.remove('hidden'); els.flagHiddenMessage.classList.add('hidden'); els.flagFrame.classList.remove('is-flash-hidden');
  const selfGuess = payload.guesses.find((g) => g.playerId === state.playerId); const selfWon = payload.winnerId === state.playerId; const eliminated = payload.eliminatedId ? payload.guesses.find((g) => g.playerId === payload.eliminatedId) : null;
  els.resultHeadline.textContent = payload.kind === 'battle' && eliminated ? `${eliminated.name} ist raus` : payload.kind === 'daily' ? `Daily Runde ${payload.roundNumber}` : payload.winnerId == null ? 'Unentschieden' : selfWon ? 'Du warst näher!' : payload.guesses.length > 1 ? `${payload.guesses.find((g) => g.playerId === payload.winnerId)?.name || 'Jemand'} war näher` : 'Runde ausgewertet';
  els.resultCountry.textContent = `${payload.target.name} · ${payload.target.capital}`;
  els.resultDistances.innerHTML = payload.guesses.map((guess, index) => {
    const isSelf = guess.playerId === state.playerId; const pointsText = payload.settings?.format === 'bestof' || payload.settings?.format === 'sudden' || payload.settings?.format === 'battle' ? `${guess.roundPoints.toLocaleString('de-DE')} Pot.` : payload.kind === 'daily' ? `+${guess.appliedPoints.toLocaleString('de-DE')} P` : guess.appliedPoints === guess.roundPoints ? `−${guess.appliedPoints.toLocaleString('de-DE')}` : `${guess.roundPoints.toLocaleString('de-DE')} → −${guess.appliedPoints.toLocaleString('de-DE')}`;
    const streak = guess.streakMultiplier > 1 ? ` · ×${guess.streakMultiplier.toFixed(1).replace('.', ',')} Streak` : '';
    const eliminatedTag = payload.eliminatedId === guess.playerId ? ' · RAUS' : '';
    return `<div class="distance-row"><span><i class="player-dot" style="--dot:${playerColor(index)}"></i>${escapeHtml(isSelf ? 'Du' : guess.name)}${eliminatedTag}</span><strong>${formatDistance(guess.distanceKm)} · ${pointsText}${streak}</strong></div>`;
  }).join('');
  els.roundResult.classList.remove('hidden');
  const startedAt = Date.now(); clearInterval(state.resultCountdownTimer);
  const updateCountdown = () => { const left = Math.max(0, payload.nextRoundInMs - (Date.now() - startedAt)); els.resultCountdown.textContent = payload.matchEnded ? `Match endet in ${Math.ceil(left / 1000)}s` : `Nächste Runde in ${Math.ceil(left / 1000)}s`; els.nextRoundProgress.style.transform = `scaleX(${Math.max(0, left / payload.nextRoundInMs)})`; };
  updateCountdown(); state.resultCountdownTimer = setInterval(updateCountdown, 150);

  if (state.room) {
    payload.scores.forEach((score) => { const p = state.room.players.find((x) => x.id === score.playerId); if (p) Object.assign(p, { score: score.score, roundWins: score.roundWins, eliminated: score.eliminated, rank: score.rank }); }); updateScores(state.room.players); renderBattleRoster();
  }

  if (currentGameMode() === 'map') {
    ensureMap(); clearPlaySurfaceRound();
    const targetMarker = L.circleMarker([payload.target.lat, payload.target.lng], { radius: 6, weight: 2, color: '#fff', fillColor: '#fbbf24', fillOpacity: 1 }).addTo(state.map).bindTooltip(`${escapeHtml(payload.target.capital)}`, { permanent: true, direction: 'top', className: 'result-map-label target-label', offset: [0, -6] }); state.resultLayers.push(targetMarker);
    const points = [[payload.target.lat, payload.target.lng]];
    payload.guesses.forEach((guess, index) => { if (!Number.isFinite(guess.lat) || !Number.isFinite(guess.lng)) return; const color = playerColor(index); const marker = L.circleMarker([guess.lat, guess.lng], { radius: 5, weight: 2, color: '#fff', fillColor: color, fillOpacity: 1 }).addTo(state.map).bindTooltip(`${escapeHtml(guess.playerId === state.playerId ? 'Du' : guess.name)} · ${formatDistance(guess.distanceKm)}`, { permanent: payload.guesses.length <= 3, direction: 'top', className: 'result-map-label', offset: [0, -5] }); const line = L.polyline([[guess.lat, guess.lng], [payload.target.lat, payload.target.lng]], { weight: 1.5, opacity: .6, dashArray: '4 7', color }).addTo(state.map); state.resultLayers.push(marker, line); points.push([guess.lat, guess.lng]); });
    if (points.length > 1) state.map.fitBounds(points, { padding: [70, 70], maxZoom: 4.5, animate: true });
  } else ensureGlobe().then((globe) => globe.showRoundResult(payload, state.playerId)).catch(() => {});

  const bestDistance = selfGuess?.distanceKm; if (Number.isFinite(bestDistance) && bestDistance < 50) playSound('perfect'); else playSound(selfWon ? 'winRound' : 'result');
  clearTimeout(state.resultTimer); state.resultTimer = setTimeout(() => { clearInterval(state.resultCountdownTimer); if (!payload.matchEnded) els.roundResult.classList.add('hidden'); }, payload.nextRoundInMs + 120);
}

function renderBattleRoster() {
  const room = state.room; const show = room?.kind === 'battle'; els.battleRoster.classList.toggle('hidden', !show); if (!show) return;
  els.battleRoster.innerHTML = `<span class="hud-label">BATTLE ROYALE</span>${room.players.map((p, i) => `<div class="battle-player ${p.eliminated ? 'is-out' : ''}"><i style="--dot:${playerColor(i)}"></i><span>${escapeHtml(p.id === state.playerId ? `${p.name} · Du` : p.name)}</span><strong>${p.eliminated ? `#${p.rank || '?'}` : p.hasGuessed ? '✓' : 'LIVE'}</strong></div>`).join('')}`;
}
function updateScores(players = state.room?.players || []) {
  const self = players.find((p) => p.id === state.playerId); const opponents = players.filter((p) => p.id !== state.playerId); const opponent = opponents[0]; const kind = currentMatchKind(); const settings = state.room?.settings || {};
  state.isSpectator = state.isSpectator || Boolean(state.room?.spectator);
  els.spectatorBadge.classList.toggle('hidden', !state.isSpectator); els.scoreBoard.classList.toggle('is-solo', ['solo', 'daily'].includes(kind));
  if (state.isSpectator) { els.selfName.textContent = 'Zuschauer'; els.selfScore.textContent = 'LIVE'; const active = players.filter((p) => !p.eliminated).length; els.opponentName.textContent = kind === 'battle' ? 'übrig' : players.map((p) => p.name).join(' vs '); els.opponentScore.textContent = kind === 'battle' ? `${active}/${players.length}` : ''; els.opponentScoreCard.classList.remove('hidden'); return; }
  if (self) { els.selfName.textContent = self.name; if (kind === 'daily') els.selfScore.textContent = self.score.toLocaleString('de-DE'); else if (settings.format === 'bestof') els.selfScore.textContent = `${self.roundWins || 0}W`; else if (settings.format === 'sudden') els.selfScore.textContent = 'LIVE'; else if (kind === 'battle') els.selfScore.textContent = self.eliminated ? 'RAUS' : 'AKTIV'; else els.selfScore.textContent = self.score.toLocaleString('de-DE'); }
  if (kind === 'solo' || kind === 'daily') { els.opponentScoreCard.classList.add('hidden'); }
  else if (kind === 'battle') { els.opponentScoreCard.classList.remove('hidden'); const active = players.filter((p) => !p.eliminated).length; els.opponentName.textContent = 'übrig'; els.opponentScore.textContent = `${active}/${players.length}`; }
  else { els.opponentScoreCard.classList.remove('hidden'); if (opponent) { els.opponentName.textContent = opponent.name; els.opponentScore.textContent = settings.format === 'bestof' ? `${opponent.roundWins || 0}W` : settings.format === 'sudden' ? 'LIVE' : opponent.score.toLocaleString('de-DE'); } }
}

function setRoomFromPayload(room, spectator = state.isSpectator) { state.room = room; state.roomCode = room.roomCode; state.isSpectator = Boolean(spectator); renderLobby(room); }
function renderLobby(room) {
  state.room = room; state.roomCode = room.roomCode; const settings = room.settings || {}; const kind = room.kind;
  els.lobbyCode.textContent = room.roomCode; els.hudRoomLabel.textContent = ['solo', 'daily'].includes(kind) ? 'MODUS' : 'LOBBY'; els.hudRoomCode.textContent = kind === 'solo' ? 'SOLO' : kind === 'daily' ? 'DAILY' : room.roomCode;
  els.lobbyTitle.textContent = kind === 'battle' ? `Battle Royale · ${room.playerLimit} Spieler` : settings.ranked ? 'Ranked 1-vs-1' : 'Warte auf Mitspieler';
  els.lobbyModeBadge.textContent = `${room.mode === 'globe' ? '3D GLOBUS · OHNE LABELS' : '2D WELTKARTE'}${settings.ranked ? ' · RANKED' : ''}`; els.lobbyModeBadge.classList.toggle('is-globe', room.mode === 'globe');
  const chips = [settings.regionLabel, settings.formatLabel, `${Math.round((settings.roundDurationMs || 22000) / 1000)} Sek.`, settings.difficultyLabel, settings.visualLabel]; if (!['bestof', 'sudden', 'battle'].includes(settings.format)) chips.push(`${Number(settings.startingScore || 5000).toLocaleString('de-DE')} P`, `×${String(settings.scoreMultiplier || 1).replace('.', ',')}`); if (settings.scoringProfile === 'precision') chips.push('Precision'); if (settings.streakBonus) chips.push('Streak');
  els.lobbySettings.innerHTML = chips.filter(Boolean).map((item) => `<span>${escapeHtml(item)}</span>`).join('');
  const slots = [...room.players]; const desired = room.playerLimit || (['solo', 'daily'].includes(kind) ? 1 : 2); while (slots.length < desired) slots.push(null);
  els.lobbyPlayers.innerHTML = slots.map((player, index) => player ? `<div class="lobby-player ${player.eliminated ? 'is-out' : ''}"><div class="player-avatar">${escapeHtml(player.name.charAt(0).toUpperCase() || '?')}</div><strong>${escapeHtml(player.name)}${player.id === state.playerId ? ' · Du' : ''}</strong><small><span class="online-dot"></span>${player.connected ? 'verbunden' : 'Reconnect…'}</small></div>` : `<div class="lobby-player waiting"><div class="player-avatar">${index + 1}</div><strong>Spieler gesucht…</strong></div>`).join('');
  els.spectatorCount.textContent = `${room.spectatorCount || 0} Zuschauer`; const needed = desired - room.players.length; els.lobbyStatus.textContent = room.status === 'waiting' ? needed > 0 ? `Noch ${needed} ${needed === 1 ? 'Spieler' : 'Spieler'} benötigt…` : 'Vollständig · Spiel startet…' : 'Match läuft';
  if (room.mode === 'globe') ensureGlobe().catch(() => {}); if (state.currentScreen === 'game') syncGameSurface(); updateScores(room.players); renderBattleRoster();
}

async function createRoom(kind = 'duel') {
  showError(''); const button = kind === 'battle' ? els.battleRoomButton : els.createRoomButton; button.disabled = true; const mode = getSelectedMode(); const settings = saveSelectedSettings();
  const response = await emitAck('create-room', { playerId: state.playerId, name: getName(), mode, kind, settings }); button.disabled = false; if (!response.ok) return showError(response.error || 'Lobby konnte nicht erstellt werden.');
  state.isSpectator = false; setRoomFromPayload(response.room, false); history.replaceState(null, '', `?room=${encodeURIComponent(response.roomCode)}`); setScreen('lobby');
}
async function startSolo() {
  showError(''); els.soloStartButton.disabled = true; const response = await emitAck('start-solo', { playerId: state.playerId, name: getName(), mode: getSelectedMode(), settings: saveSelectedSettings() }); els.soloStartButton.disabled = false; if (!response.ok) return showError(response.error || 'Solo-Spiel konnte nicht gestartet werden.'); state.isSpectator = false; setRoomFromPayload(response.room, false); history.replaceState(null, '', location.pathname); setScreen('game'); els.mapHint.textContent = 'Solo startet…';
}
async function startDaily() {
  showError(''); els.dailyStartButton.disabled = true; const response = await emitAck('start-daily', { playerId: state.playerId, name: getName(), mode: 'globe', settings: saveSelectedSettings() }); els.dailyStartButton.disabled = false; if (!response.ok) return showError(response.error || 'Daily konnte nicht gestartet werden.'); state.isSpectator = false; setRoomFromPayload(response.room, false); history.replaceState(null, '', location.pathname); setScreen('game'); els.mapHint.textContent = 'Daily Challenge startet…';
}
async function joinRoom(asSpectator = false) {
  showError(''); const code = els.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); if (code.length !== 6) return showError('Bitte einen 6-stelligen Lobby-Code eingeben.'); const button = asSpectator ? els.spectateButton : els.joinRoomButton; button.disabled = true;
  const response = await emitAck(asSpectator ? 'spectate-room' : 'join-room', { playerId: state.playerId, name: getName(), roomCode: code }); button.disabled = false; if (!response.ok) return showError(response.error || 'Beitritt fehlgeschlagen.'); state.roomCode = response.roomCode; state.isSpectator = Boolean(response.spectator); history.replaceState(null, '', `?room=${encodeURIComponent(response.roomCode)}`); if (!asSpectator) setScreen('lobby');
}

function renderProfile(profile = state.profile, leaderboard = state.leaderboard) {
  if (!profile) return; state.profile = profile; state.leaderboard = leaderboard || state.leaderboard; els.profileName.textContent = profile.name || getName(); els.profileRating.textContent = Number(profile.rating || 1000).toLocaleString('de-DE'); els.profileRecord.textContent = `${profile.wins || 0}–${profile.losses || 0}`;
  els.profileDetails.innerHTML = `<div><span>Rating</span><strong>${Number(profile.rating || 1000).toLocaleString('de-DE')}</strong></div><div><span>Matches</span><strong>${profile.matches || 0}</strong></div><div><span>Winrate</span><strong>${profile.matches ? Math.round((profile.wins / profile.matches) * 100) : 0}%</strong></div><div><span>Ø Distanz</span><strong>${formatDistance(profile.avgDistanceKm)}</strong></div><div><span>Bester Guess</span><strong>${formatDistance(profile.bestDistanceKm)}</strong></div><div><span>Beste Streak</span><strong>${profile.bestStreak || 0}</strong></div>`;
  els.achievementList.innerHTML = profile.achievements?.length ? profile.achievements.map((a) => `<div class="achievement"><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.description)}</small></div>`).join('') : '<p class="muted">Noch keine Achievements – der erste präzise Guess kommt bestimmt.</p>';
  els.rankedLeaderboard.innerHTML = (state.leaderboard || []).length ? state.leaderboard.map((entry) => `<div class="leaderboard-row"><span>#${entry.rank} ${escapeHtml(entry.name)}</span><strong>${entry.rating} · ${entry.wins}W</strong></div>`).join('') : '<p class="muted">Noch keine Ranked-Matches.</p>';
}
function renderDailyInfo(info) {
  state.dailyInfo = info; if (!info) return; els.dailyLabel.textContent = `${info.dailyId} · ${info.rounds} feste Flaggen`;
  els.dailyTop.innerHTML = info.leaderboard?.length ? info.leaderboard.slice(0, 3).map((entry) => `<span>#${entry.rank} ${escapeHtml(entry.name)} <strong>${entry.score.toLocaleString('de-DE')}</strong></span>`).join('') : 'Noch keine Scores – hol dir Platz 1.';
}
async function refreshMeta() {
  if (!socket.connected) return; const [profile, daily] = await Promise.all([emitAck('get-profile', { playerId: state.playerId, name: getName() }), emitAck('get-daily-info', {})]); if (profile.ok) renderProfile(profile.profile, profile.leaderboard); if (daily.ok) renderDailyInfo(daily);
}

function renderMatchStats(payload) {
  const summary = payload.stats?.[state.playerId] || (state.isSpectator ? payload.stats?.[payload.winnerId] : null); if (!summary) { els.matchStats.innerHTML = '<p class="muted">Keine persönlichen Matchdaten vorhanden.</p>'; return; }
  els.matchStats.innerHTML = `<div><span>Ø Distanz</span><strong>${formatDistance(summary.avgDistanceKm)}</strong></div><div><span>Bester Guess</span><strong>${formatDistance(summary.bestDistanceKm)}</strong></div><div><span>Ø Zeit</span><strong>${formatMs(summary.avgResponseMs)}</strong></div><div><span>Guess-Punkte</span><strong>${Number(summary.totalPoints || 0).toLocaleString('de-DE')}</strong></div>`;
}
function showGameOver(payload) {
  closeGameMenu(); setRoomMeta(payload); clearInterval(state.timerInterval); clearInterval(state.resultCountdownTimer); state.roundDeadline = 0; state.lastGameOver = payload; els.roundResult.classList.add('hidden'); els.gameOverModal.classList.remove('hidden'); els.analysisButton.classList.toggle('hidden', !payload.history?.length);
  const self = payload.scores.find((s) => s.playerId === state.playerId); const opponents = payload.scores.filter((s) => s.playerId !== state.playerId); const opponent = opponents[0]; const selfWon = payload.winnerId === state.playerId; const draw = !payload.winnerId; const settings = payload.settings || {};
  els.rematchButton.classList.toggle('hidden', state.isSpectator || (payload.reason === 'opponent-left' && selfWon)); els.rematchButton.disabled = false; els.dailyResultLeaderboard.classList.add('hidden');
  if (state.isSpectator) { els.gameOverTitle.textContent = `${payload.scores.find((s) => s.playerId === payload.winnerId)?.name || 'Match'} gewinnt`; els.gameOverScore.textContent = 'Zuschauer'; els.gameOverNote.textContent = 'Du hast dieses Match live verfolgt.'; els.rematchButton.classList.add('hidden'); }
  else if (payload.kind === 'daily') { els.gameOverTitle.textContent = 'Daily abgeschlossen'; els.gameOverScore.textContent = `${Number(self?.score || 0).toLocaleString('de-DE')} Punkte`; const place = payload.dailyLeaderboard?.find((e) => e.playerId === state.playerId)?.rank; els.gameOverNote.textContent = place ? `Aktuell Platz #${place} der heutigen Challenge.` : 'Dein Daily-Score wurde gewertet.'; els.rematchButton.textContent = 'Daily nochmal'; if (payload.dailyLeaderboard?.length) { els.dailyResultLeaderboard.classList.remove('hidden'); els.dailyResultLeaderboard.innerHTML = `<strong>Daily Top 10</strong>${payload.dailyLeaderboard.slice(0, 10).map((e) => `<div><span>#${e.rank} ${escapeHtml(e.name)}</span><strong>${e.score.toLocaleString('de-DE')}</strong></div>`).join('')}`; } }
  else if (payload.kind === 'solo') { els.gameOverTitle.textContent = selfWon ? 'Geschafft!' : 'Solo beendet'; els.gameOverScore.textContent = `${Number(self?.score ?? 0).toLocaleString('de-DE')} Punkte`; els.gameOverNote.textContent = selfWon ? `Du hast ${Number(settings.startingScore || 5000).toLocaleString('de-DE')} Restpunkte auf 0 gespielt.` : 'Das Solo-Match wurde beendet.'; els.rematchButton.textContent = 'Nochmal spielen'; }
  else if (payload.kind === 'battle') { const rank = self?.rank || (selfWon ? 1 : '?'); els.gameOverTitle.textContent = selfWon ? 'Last One Standing!' : `Platz #${rank}`; els.gameOverScore.textContent = selfWon ? 'BATTLE ROYALE SIEG' : `${payload.scores.length} Spieler`; els.gameOverNote.textContent = selfWon ? 'Du hast als Letzter überlebt.' : `${payload.scores.find((s) => s.playerId === payload.winnerId)?.name || 'Der Sieger'} gewinnt das Battle Royale.`; els.rematchButton.textContent = 'Rematch'; }
  else if (settings.format === 'bestof') { els.gameOverTitle.textContent = draw ? 'Unentschieden!' : selfWon ? 'Du gewinnst!' : 'Gegner gewinnt'; els.gameOverScore.textContent = `${self?.roundWins || 0} : ${opponent?.roundWins || 0}`; els.gameOverNote.textContent = `Best of ${settings.bestOfRounds}.`; els.rematchButton.textContent = 'Rematch'; }
  else if (settings.format === 'sudden') { els.gameOverTitle.textContent = draw ? 'Unentschieden!' : selfWon ? 'Sudden-Death-Sieg!' : 'Sudden Death verloren'; els.gameOverScore.textContent = selfWon ? 'WIN' : 'LOSS'; els.gameOverNote.textContent = 'Eine Runde, eine Entscheidung.'; els.rematchButton.textContent = 'Rematch'; }
  else { els.gameOverTitle.textContent = draw ? 'Unentschieden!' : selfWon ? 'Du gewinnst!' : 'Gegner gewinnt'; els.gameOverScore.textContent = `${self?.score ?? 0} : ${opponent?.score ?? 0}`; els.gameOverNote.textContent = payload.reason === 'opponent-left' && selfWon ? 'Dein Gegner hat das Spiel verlassen.' : settings.ranked ? 'Ranked-Match gewertet – dein Rating wurde aktualisiert.' : selfWon ? 'Du hast deine Restpunkte zuerst auf 0 gespielt.' : 'Dein Gegner war zuerst bei 0.'; els.rematchButton.textContent = 'Rematch'; }
  renderMatchStats(payload); playSound(selfWon ? 'victory' : 'gameOver'); refreshMeta();
}

async function showMatchAnalysis() {
  const payload = state.lastGameOver; if (!payload?.history?.length) return; state.analysisMode = true; els.gameOverModal.classList.add('hidden'); els.analysisBar.classList.remove('hidden'); els.flagDock.classList.add('hidden'); els.roundResult.classList.add('hidden'); els.mapHint.textContent = 'Alle Guesses dieses Matches';
  clearPlaySurfaceRound();
  if (currentGameMode() === 'globe') { const globe = await ensureGlobe(); globe.showMatchHistory?.(payload.history, state.playerId, { allPlayers: state.isSpectator }); globe.resize(); return; }
  ensureMap(); const points = [];
  payload.history.forEach((round, roundIndex) => {
    const target = round.target; if (Number.isFinite(target?.lat) && Number.isFinite(target?.lng)) { const tm = L.circleMarker([target.lat, target.lng], { radius: 3, weight: 1, color: '#fbbf24', fillColor: '#fbbf24', fillOpacity: .55 }).addTo(state.map); state.resultLayers.push(tm); points.push([target.lat, target.lng]); }
    round.guesses.filter((g) => state.isSpectator || g.playerId === state.playerId).forEach((g) => { if (!Number.isFinite(g.lat) || !Number.isFinite(g.lng)) return; const quality = Number.isFinite(g.distanceKm) ? Math.max(0, Math.min(1, 1 - g.distanceKm / 5000)) : 0; const marker = L.circleMarker([g.lat, g.lng], { radius: 4 + quality * 8, weight: 1, color: '#34d399', fillColor: '#34d399', fillOpacity: .14 + quality * .35 }).addTo(state.map).bindTooltip(`R${roundIndex + 1} · ${formatDistance(g.distanceKm)}`); state.resultLayers.push(marker); points.push([g.lat, g.lng]); });
  });
  if (points.length) state.map.fitBounds(points, { padding: [40, 40], maxZoom: 3.5 }); else state.map.setView([18, 0], 2);
}
function closeMatchAnalysis() { state.analysisMode = false; els.analysisBar.classList.add('hidden'); els.flagDock.classList.remove('hidden'); els.gameOverModal.classList.remove('hidden'); if (currentGameMode() === 'globe' && state.lastGameOver?.history?.length) state.globeController?.showMatchHistory?.(state.lastGameOver.history.slice(-1), state.playerId); }

async function copyText(text, message) { try { await navigator.clipboard.writeText(text); showToast(message); } catch { showToast('Kopieren nicht möglich – bitte manuell markieren.'); } }
function inviteUrl() { return `${location.origin}${location.pathname}?room=${encodeURIComponent(state.roomCode || '')}`; }
async function leaveRoom() { closeGameMenu(); const roomCode = state.roomCode; if (roomCode && socket.connected) await Promise.race([emitAck('leave-room', { playerId: state.playerId }), new Promise((resolve) => setTimeout(resolve, 900))]); resetHome(); }
function resetHome() {
  closeGameMenu(); state.roomCode = null; state.room = null; state.isSpectator = false; state.roundDeadline = 0; state.pendingGuess = null; state.submitted = false; state.analysisMode = false; clearInterval(state.timerInterval); clearTimeout(state.resultTimer); clearInterval(state.resultCountdownTimer); clearTimeout(state.flagHideTimer); clearPlaySurfaceRound(); state.globeController?.resetView();
  els.gameOverModal.classList.add('hidden'); els.roundResult.classList.add('hidden'); els.analysisBar.classList.add('hidden'); els.flagDock.classList.remove('hidden'); history.replaceState(null, '', location.pathname); setScreen('home'); refreshMeta();
}

let audioContext = null;
function playSound(type) {
  if (!state.soundEnabled) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); if (audioContext.state === 'suspended') audioContext.resume();
    const patterns = { pin: [[520, .035, .025]], submit: [[420, .06, .035], [650, .07, .025]], round: [[330, .05, .02]], tick: [[720, .045, .035]], result: [[280, .1, .025]], winRound: [[520, .07, .03], [760, .09, .025]], perfect: [[700, .07, .035], [980, .12, .025]], victory: [[440, .08, .03], [660, .09, .03], [880, .14, .025]], gameOver: [[260, .12, .025]] };
    let offset = 0; for (const [frequency, duration, gainValue] of patterns[type] || []) { const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain(); oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(gainValue, audioContext.currentTime + offset); gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + offset + duration); oscillator.connect(gain).connect(audioContext.destination); oscillator.start(audioContext.currentTime + offset); oscillator.stop(audioContext.currentTime + offset + duration); offset += duration * .8; }
  } catch {}
}

function showAchievement(payload) { els.achievementToastTitle.textContent = payload.title; els.achievementToastText.textContent = payload.description; els.achievementToast.classList.remove('hidden'); clearTimeout(showAchievement.timer); showAchievement.timer = setTimeout(() => els.achievementToast.classList.add('hidden'), 4200); playSound('perfect'); }

// Initial local state
els.playerName.value = localStorage.getItem('flagDuelName') || '';
const savedMode = localStorage.getItem('flagDuelMode'); if (savedMode === 'globe' || savedMode === 'map') { const radio = document.querySelector(`input[name="gameMode"][value="${savedMode}"]`); if (radio) radio.checked = true; }
let savedSettings = {}; try { savedSettings = JSON.parse(localStorage.getItem('flagDuelSettings') || '{}'); } catch {}
applySettings(savedSettings, savedMode, { persist: false }); refreshPresetOptions('builtin:standard'); updateSettingsUI();
const inviteCode = new URLSearchParams(location.search).get('room'); if (inviteCode) els.roomCodeInput.value = inviteCode.toUpperCase().slice(0, 6);

// UI bindings
els.soloStartButton.addEventListener('click', startSolo); els.dailyStartButton.addEventListener('click', startDaily); els.createRoomButton.addEventListener('click', () => createRoom('duel')); els.battleRoomButton.addEventListener('click', () => createRoom('battle')); els.joinRoomButton.addEventListener('click', () => joinRoom(false)); els.spectateButton.addEventListener('click', () => joinRoom(true));
els.roomCodeInput.addEventListener('input', () => { els.roomCodeInput.value = els.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }); els.roomCodeInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(false); });
document.querySelectorAll('input[name="gameMode"]').forEach((input) => input.addEventListener('change', saveSelectedSettings)); [els.regionSelect, els.roundTimeSelect, els.startingScoreSelect, els.scoreMultiplierSelect, els.formatSelect, els.bestOfSelect, els.difficultySelect, els.visualModeSelect, els.scoringProfileSelect, els.playerLimitSelect].forEach((control) => control.addEventListener('change', saveSelectedSettings));
els.streakBonusToggle.addEventListener('change', saveSelectedSettings); els.rankedToggle.addEventListener('change', saveSelectedSettings);
els.presetSelect.addEventListener('change', applySelectedPreset); els.savePresetButton.addEventListener('click', () => { const name = window.prompt('Name für dieses Preset:', 'Mein Modus'); if (!name?.trim()) return; const custom = readCustomPresets(); const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; custom.push({ id, name: name.trim().slice(0, 28), mode: getSelectedMode(), settings: currentSettingsForStorage() }); writeCustomPresets(custom); refreshPresetOptions(`custom:${id}`); showToast('Preset gespeichert'); }); els.deletePresetButton.addEventListener('click', () => { const value = els.presetSelect.value; if (!value.startsWith('custom:')) return; writeCustomPresets(readCustomPresets().filter((p) => p.id !== value.slice(7))); refreshPresetOptions('builtin:standard'); showToast('Preset gelöscht'); });
els.copyCodeButton.addEventListener('click', () => copyText(state.roomCode || '', 'Lobby-Code kopiert')); els.copyLinkButton.addEventListener('click', () => copyText(inviteUrl(), 'Einladungslink kopiert')); els.leaveLobbyButton.addEventListener('click', leaveRoom);
els.gameMenuButton.addEventListener('click', openGameMenu); els.resumeGameButton.addEventListener('click', closeGameMenu); els.exitGameButton.addEventListener('click', leaveRoom); els.soundToggleButton.addEventListener('click', () => { state.soundEnabled = !state.soundEnabled; localStorage.setItem('flagPinpointSound', state.soundEnabled ? 'on' : 'off'); els.soundToggleButton.textContent = `Sound: ${state.soundEnabled ? 'An' : 'Aus'}`; if (state.soundEnabled) playSound('pin'); }); els.gameMenuModal.addEventListener('click', (event) => { if (event.target === els.gameMenuModal) closeGameMenu(); });
els.submitGuessButton.addEventListener('click', submitGuess); els.backHomeButton.addEventListener('click', leaveRoom); els.analysisButton.addEventListener('click', showMatchAnalysis); els.closeAnalysisButton.addEventListener('click', closeMatchAnalysis);
els.rematchButton.addEventListener('click', async () => { const kind = currentMatchKind(); els.rematchButton.disabled = true; els.rematchButton.textContent = ['solo', 'daily'].includes(kind) ? 'Neues Spiel startet…' : 'Warte auf Mitspieler…'; const response = await emitAck('request-rematch', { playerId: state.playerId, roomCode: state.roomCode }); if (!response.ok) { els.rematchButton.disabled = false; showToast(response.error || 'Rematch nicht möglich.'); } });
els.openProfileButton.addEventListener('click', () => { renderProfile(); els.profileModal.classList.remove('hidden'); }); els.closeProfileButton.addEventListener('click', () => els.profileModal.classList.add('hidden')); els.profileModal.addEventListener('click', (event) => { if (event.target === els.profileModal) els.profileModal.classList.add('hidden'); });
document.addEventListener('keydown', (event) => { if (event.key !== 'Escape') return; if (!els.profileModal.classList.contains('hidden')) els.profileModal.classList.add('hidden'); else if (!els.gameMenuModal.classList.contains('hidden')) closeGameMenu(); else if (state.analysisMode) closeMatchAnalysis(); });

// Socket lifecycle
socket.on('connect', async () => { els.connectionBadge.classList.add('hidden'); const hello = await emitAck('hello', { playerId: state.playerId, name: getName() }); if (hello.profile) renderProfile(hello.profile, hello.leaderboard); const daily = await emitAck('get-daily-info', {}); if (daily.ok) renderDailyInfo(daily); });
socket.on('disconnect', () => { if (state.currentScreen !== 'home') els.connectionBadge.classList.remove('hidden'); }); socket.on('connect_error', () => { if (state.currentScreen !== 'home') els.connectionBadge.classList.remove('hidden'); });
socket.on('state-sync', (payload) => { if (!payload?.room) return; state.isSpectator = Boolean(payload.spectator); setRoomFromPayload(payload.room, state.isSpectator); if (payload.room.status === 'waiting' && !['solo', 'daily'].includes(payload.room.kind)) setScreen('lobby'); else if (payload.room.status === 'playing') { setScreen('game'); if (payload.round) startRound(payload.round, { synced: true }); else if (payload.roundResult) showRoundResult(payload.roundResult); } else if (payload.room.status === 'ended') { setScreen('game'); if (payload.gameOver) showGameOver(payload.gameOver); } });
socket.on('lobby-update', (room) => { renderLobby(room); if (room.status === 'waiting' && !['solo', 'daily'].includes(room.kind) && state.currentScreen !== 'home' && !state.isSpectator) setScreen('lobby'); });
socket.on('round-start', (payload) => startRound(payload)); socket.on('guess-status', (payload) => { if (state.room) { const p = state.room.players.find((x) => x.id === payload.playerId); if (p) p.hasGuessed = true; renderBattleRoster(); } if (!state.isSpectator && payload.playerId !== state.playerId && state.submitted && payload.playersReady >= payload.playersNeeded) els.mapHint.textContent = 'Alle Tipps sind da – Auswertung…'; }); socket.on('round-result', showRoundResult); socket.on('game-over', showGameOver); socket.on('rematch-status', (payload) => { if (state.isSpectator) return; const selfReady = payload.ready.includes(state.playerId); els.rematchStatus.textContent = payload.ready.length === state.room?.players?.length ? 'Alle bereit – neues Match startet…' : selfReady ? 'Du bist bereit. Warte auf die anderen…' : ''; }); socket.on('profile-update', (profile) => renderProfile(profile, state.leaderboard)); socket.on('achievement-unlocked', showAchievement);
