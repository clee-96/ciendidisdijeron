import { dispatch, getPlayableQuestions, getState, initializeState, subscribe } from "./state.js";

const scoreAEl = document.getElementById("score-a");
const scoreBEl = document.getElementById("score-b");
const strikesAEl = document.getElementById("strikes-a");
const strikesBEl = document.getElementById("strikes-b");
const teamControlBadgeAEl = document.getElementById("team-control-badge-a");
const teamControlBadgeBEl = document.getElementById("team-control-badge-b");
const teamNameAEl = document.getElementById("team-name-a");
const teamNameBEl = document.getElementById("team-name-b");
const playerIdentityEl = document.getElementById("player-identity");
const questionTextEl = document.getElementById("question-text");
const answersListEl = document.getElementById("answers-list");
const roundLabelEl = document.getElementById("round-label");
const questionTypeIndicatorEl = document.getElementById("question-type-indicator");
const roundMultiplierIndicatorEl = document.getElementById("round-multiplier-indicator");
const qrModalEl = document.getElementById("qr-modal");
const teamBackModalEl = document.getElementById("team-back-modal");
const teamBackAcceptButton = document.getElementById("team-back-accept");
const winnerModalEl = document.getElementById("winner-modal");
const winnerMessageEl = document.getElementById("winner-message");
const winnerMembersEl = document.getElementById("winner-members");
const winnerAcceptButtonEl = document.getElementById("winner-accept");
const strikeOverlayEl = document.getElementById("strike-overlay");
const strikeOverlayImagesEl = document.getElementById("strike-overlay-images");
const playerGateEl = document.getElementById("player-gate");
const playerGateFormEl = document.getElementById("player-gate-form");
const playerNameInputEl = document.getElementById("player-name-input");
const playerTeamSelectEl = document.getElementById("player-team-select");
const playerGateErrorEl = document.getElementById("player-gate-error");
const PLAYER_SESSION_KEY = "fm100_player_session";
const TEAM_BACK_SEEN_KEY = "fm100_team_back_seen";
const ADMIN_AUTH_KEY = "fm100_admin_auth";
const correctSound = new Audio("./assets/audio/correcto.mp3");
const incorrectSound = new Audio("./assets/audio/incorrecto.mp3");
const aJugarSound = new Audio("./assets/audio/a_jugar.mp3");
const triunfoSound = new Audio("./assets/audio/triunfo.mp3");
const buttonSound = new Audio("./assets/audio/button.mp3");
const championsSound = new Audio("./assets/audio/we-are-the-champions.mp3");
const STRIKE_IMAGE_SRC = "./assets/images/X.png?v=20260223";
const STRIKE_OVERLAY_DEFAULT_MS = 1200;
const STRIKE_OVERLAY_MIN_MS = 600;
const STRIKE_OVERLAY_MAX_MS = 2500;

let playerRegistered = false;
let redirectingToCaptain = false;
let lastSoundEventVersion = null;
let pendingSoundEvent = null;
let audioUnlockConfigured = false;
let strikeOverlayTimeoutId = null;
let strikeSoundDurationMs = STRIKE_OVERLAY_DEFAULT_MS;
let lastWinnerVersionShown = 0;
let winnerModalTimeoutId = null;
let lastWinnerFallbackKeyShown = "";

function hideStrikeOverlay() {
  if (!strikeOverlayEl) {
    return;
  }

  strikeOverlayEl.classList.add("hidden");
  if (strikeOverlayTimeoutId) {
    clearTimeout(strikeOverlayTimeoutId);
    strikeOverlayTimeoutId = null;
  }
}

function getActiveSounds() {
  return [correctSound, incorrectSound, aJugarSound, triunfoSound, buttonSound];
}

function isAnyRegularSoundPlaying() {
  return getActiveSounds().some((sound) => !sound.paused && !sound.ended && sound.currentTime > 0);
}

function closeWinnerModal() {
  winnerModalEl.classList.add("hidden");
  championsSound.pause();
  championsSound.currentTime = 0;
}

function renderWinnerMembers(state, team) {
  const teamPlayers = (state.players || []).filter((player) => player.active && player.team === team);
  if (!teamPlayers.length) {
    winnerMembersEl.innerHTML = '<p class="winner-member">¡Gran trabajo, equipo!</p>';
    return;
  }

  winnerMembersEl.innerHTML = teamPlayers.map((player) => `<p class="winner-member">✨ ${player.name}</p>`).join("");
}

function openWinnerModal(state, team) {
  const teamName = state.teams?.[team]?.name || `Equipo ${team}`;
  winnerMessageEl.textContent = `¡${teamName} llegó a 500 puntos y ganó la partida!`;
  renderWinnerMembers(state, team);
  winnerModalEl.classList.remove("hidden");
  playSound(championsSound);
}

function waitForSoundsAndCelebrate(state) {
  const winnerFromState = state.ui?.winnerTeam;
  const winnerFromScores = Number(state.teams?.A?.score || 0) >= 500 ? "A" : (Number(state.teams?.B?.score || 0) >= 500 ? "B" : null);
  const winnerTeam = winnerFromState === "A" || winnerFromState === "B" ? winnerFromState : winnerFromScores;
  if (winnerTeam !== "A" && winnerTeam !== "B") {
    return;
  }

  const winnerVersion = Number(state.ui?.winnerVersion) || 0;
  const fallbackKey = `${winnerTeam}:${Number(state.teams?.A?.score || 0)}:${Number(state.teams?.B?.score || 0)}`;
  const alreadyShown = winnerVersion > 0 ? winnerVersion <= lastWinnerVersionShown : fallbackKey === lastWinnerFallbackKeyShown;
  if (alreadyShown) {
    return;
  }

  if (winnerModalTimeoutId) {
    clearTimeout(winnerModalTimeoutId);
    winnerModalTimeoutId = null;
  }

  const schedule = () => {
    if (isAnyRegularSoundPlaying()) {
      winnerModalTimeoutId = window.setTimeout(schedule, 200);
      return;
    }

    winnerModalTimeoutId = window.setTimeout(() => {
      const latest = getState();
      const latestWinnerFromState = latest.ui?.winnerTeam;
      const latestWinnerFromScores = Number(latest.teams?.A?.score || 0) >= 500 ? "A" : (Number(latest.teams?.B?.score || 0) >= 500 ? "B" : null);
      const latestWinnerTeam = latestWinnerFromState === "A" || latestWinnerFromState === "B" ? latestWinnerFromState : latestWinnerFromScores;
      if (latestWinnerTeam !== winnerTeam) {
        winnerModalTimeoutId = null;
        return;
      }

      openWinnerModal(latest, winnerTeam);
      if (winnerVersion > 0) {
        lastWinnerVersionShown = winnerVersion;
      } else {
        lastWinnerFallbackKeyShown = fallbackKey;
      }
      winnerModalTimeoutId = null;
    }, 1000);
  };

  schedule();
}

incorrectSound.addEventListener("loadedmetadata", () => {
  const duration = Number(incorrectSound.duration);
  if (Number.isFinite(duration) && duration > 0) {
    const ms = Math.round(duration * 1000);
    strikeSoundDurationMs = Math.min(STRIKE_OVERLAY_MAX_MS, Math.max(STRIKE_OVERLAY_MIN_MS, ms));
  }
});

incorrectSound.addEventListener("ended", hideStrikeOverlay);

function getStrikeOverlayCount(state) {
  const strikesA = Number(state.teams?.A?.strikes) || 0;
  const strikesB = Number(state.teams?.B?.strikes) || 0;
  return Math.max(1, Math.min(3, Math.max(strikesA, strikesB)));
}

function renderStrikeOverlayImages(count) {
  if (!strikeOverlayImagesEl) {
    return;
  }

  strikeOverlayImagesEl.innerHTML = "";
  for (let index = 0; index < count; index += 1) {
    const image = document.createElement("img");
    image.src = STRIKE_IMAGE_SRC;
    image.alt = "Strike";
    image.className = "strike-overlay-image";
    strikeOverlayImagesEl.appendChild(image);
  }
}

function showStrikeOverlay(state) {
  if (!strikeOverlayEl) {
    return;
  }

  const count = getStrikeOverlayCount(state);
  renderStrikeOverlayImages(count);
  strikeOverlayEl.classList.remove("hidden");

  if (strikeOverlayTimeoutId) {
    clearTimeout(strikeOverlayTimeoutId);
  }

  strikeOverlayTimeoutId = window.setTimeout(() => {
    hideStrikeOverlay();
  }, strikeSoundDurationMs);
}

function playSound(sound) {
  if (!sound) {
    return Promise.resolve(false);
  }

  sound.currentTime = 0;
  return sound.play().then(() => true).catch(() => false);
}

function getSoundByType(type) {
  if (type === "correct") {
    return correctSound;
  }

  if (type === "incorrect") {
    return incorrectSound;
  }

  if (type === "a_jugar") {
    return aJugarSound;
  }

  if (type === "triunfo") {
    return triunfoSound;
  }

  if (type === "button") {
    return buttonSound;
  }

  return null;
}

async function tryPlaySoundEvent(type, version) {
  const sound = getSoundByType(type);
  if (!sound) {
    return;
  }

  const played = await playSound(sound);
  if (played) {
    lastSoundEventVersion = version;
    pendingSoundEvent = null;
  } else {
    pendingSoundEvent = { type, version };
  }
}

async function unlockAudioAndReplay() {
  const sounds = [...getActiveSounds(), championsSound];
  await Promise.allSettled(
    sounds.map(async (sound) => {
      sound.muted = true;
      sound.currentTime = 0;
      const ok = await playSound(sound);
      if (ok) {
        sound.pause();
        sound.currentTime = 0;
      }
      sound.muted = false;
    })
  );

  if (pendingSoundEvent) {
    const { type, version } = pendingSoundEvent;
    tryPlaySoundEvent(type, version);
  }
}

function setupAudioUnlock() {
  if (audioUnlockConfigured) {
    return;
  }

  audioUnlockConfigured = true;

  const unlock = () => {
    unlockAudioAndReplay();
  };

  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("touchstart", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function handleGlobalSound(state) {
  const version = Number(state.ui?.soundEventVersion) || 0;
  const type = state.ui?.soundEventType || null;

  if (lastSoundEventVersion === null) {
    lastSoundEventVersion = version;
    return;
  }

  if (version <= lastSoundEventVersion || !type) {
    return;
  }

  if (type === "incorrect") {
    showStrikeOverlay(state);
  }

  tryPlaySoundEvent(type, version);
}

function loadPlayerSession() {
  const raw = sessionStorage.getItem(PLAYER_SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const id = String(parsed?.id || "").trim();
    const name = String(parsed?.name || "").trim();
    const team = String(parsed?.team || "").trim();
    const logoutVersion = Number.isFinite(Number(parsed?.logoutVersion)) ? Number(parsed.logoutVersion) : 0;

    if (!id || !name || (team !== "A" && team !== "B")) {
      return null;
    }

    return { id, name, team, logoutVersion };
  } catch {
    return null;
  }
}

function savePlayerSession(id, name, team, logoutVersion = 0) {
  sessionStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify({ id, name, team, logoutVersion }));
}

function clearPlayerSession() {
  sessionStorage.removeItem(PLAYER_SESSION_KEY);
}

function createPlayerId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `p-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function getSeenTeamBackVersion() {
  return Number(sessionStorage.getItem(TEAM_BACK_SEEN_KEY)) || 0;
}

function setSeenTeamBackVersion(version) {
  sessionStorage.setItem(TEAM_BACK_SEEN_KEY, String(version));
}

function isAdminSession() {
  return localStorage.getItem(ADMIN_AUTH_KEY) === "1";
}

async function loadDefaultQuestions() {
  const response = await fetch("./data/questions.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No se pudo cargar data/questions.json");
  }

  return response.json();
}

function renderAnswers(state) {
  const playableQuestions = getPlayableQuestions(state);
  const question = playableQuestions[state.round.questionIndex];
  answersListEl.innerHTML = "";

  question.answers.forEach((answer, index) => {
    const item = document.createElement("li");
    const visible = state.round.revealed.includes(index);

    item.className = `answer-item ${visible ? "revealed" : "hidden-answer"}`;
    if (visible) {
      item.innerHTML = `
        <span class="answer-text">${answer.text}</span>
        <strong class="answer-points">${answer.points}</strong>
      `;
    } else {
      item.innerHTML = '<span class="answer-hidden-placeholder" aria-hidden="true"></span>';
    }

    answersListEl.appendChild(item);
  });
}

function render(state) {
  handleGlobalSound(state);
  waitForSoundsAndCelebrate(state);

  const playableQuestions = getPlayableQuestions(state);
  const question = playableQuestions[state.round.questionIndex];
  const activeTypeId = state.ui?.activeQuestionTypeId || "";
  const activeTypeName = (state.questionTypes || []).find((type) => type.id === activeTypeId)?.name || "--";

  teamNameAEl.textContent = state.teams.A.name;
  teamNameBEl.textContent = state.teams.B.name;
  const optionA = playerTeamSelectEl.querySelector('option[value="A"]');
  const optionB = playerTeamSelectEl.querySelector('option[value="B"]');
  optionA.textContent = state.teams.A.name;
  optionB.textContent = state.teams.B.name;

  const session = loadPlayerSession();
  if (isAdminSession()) {
    playerIdentityEl.innerHTML = "<span class=\"player-identity-value\">Administrador</span>";
  } else if (session) {
    const teamName = session.team === "A" ? state.teams.A.name : state.teams.B.name;
    playerIdentityEl.innerHTML = `Jugador: <span class="player-identity-value">${session.name}</span> | Equipo: <span class="player-identity-value">${teamName}</span>`;
  } else {
    playerIdentityEl.innerHTML = "Jugador: <span class=\"player-identity-value\">--</span> | Equipo: <span class=\"player-identity-value\">--</span>";
  }

  scoreAEl.textContent = state.teams.A.score;
  scoreBEl.textContent = state.teams.B.score;
  strikesAEl.textContent = String(state.teams.A.strikes || 0);
  strikesBEl.textContent = String(state.teams.B.strikes || 0);

  const controlTeam = state.round.buzzerWinner;
  teamControlBadgeAEl.textContent = controlTeam === "A" ? "TIENEN EL CONTROL" : "";
  teamControlBadgeBEl.textContent = controlTeam === "B" ? "TIENEN EL CONTROL" : "";
  if (controlTeam === "A" || controlTeam === "B") {
    teamControlBadgeAEl.classList.toggle("active", controlTeam === "A");
    teamControlBadgeBEl.classList.toggle("active", controlTeam === "B");
  } else {
    teamControlBadgeAEl.classList.remove("active");
    teamControlBadgeBEl.classList.remove("active");
  }

  const multiplier = [1, 2, 3].includes(Number(state.round.pointsMultiplier)) ? Number(state.round.pointsMultiplier) : 1;
  roundMultiplierIndicatorEl.textContent = `x${multiplier}`;
  questionTypeIndicatorEl.textContent = `Tipo: ${activeTypeName}`;

  qrModalEl.classList.toggle("hidden", !state.ui?.showQr);
  enforcePlayerSession(state);
  renderTeamBackModal(state);
  maybeRedirectCaptain(state);

  if (!question) {
    if (playableQuestions.length && state.round.questionIndex < 0) {
      roundLabelEl.textContent = `Pregunta 0 / ${playableQuestions.length}`;
      questionTextEl.textContent = "Esperando inicio de ronda";
    } else {
      roundLabelEl.textContent = "Sin preguntas";
      questionTextEl.textContent = "Agrega preguntas desde el panel de admin";
    }
    answersListEl.innerHTML = "";
    return;
  }

  roundLabelEl.textContent = `Pregunta ${state.round.questionIndex + 1} / ${playableQuestions.length}`;
  questionTextEl.textContent = question.question;

  renderAnswers(state);
}

function renderTeamBackModal(state) {
  if (isAdminSession()) {
    teamBackModalEl.classList.add("hidden");
    return;
  }

  const session = loadPlayerSession();
  const targetTeam = state.ui?.teamBackAlertTeam;
  const version = Number(state.ui?.teamBackAlertVersion) || 0;

  if (!session || (targetTeam !== "A" && targetTeam !== "B") || version <= 0 || session.team !== targetTeam) {
    teamBackModalEl.classList.add("hidden");
    return;
  }

  const seen = getSeenTeamBackVersion();
  teamBackModalEl.dataset.version = String(version);
  teamBackModalEl.classList.toggle("hidden", seen >= version);
}

function maybeRedirectCaptain(state) {
  if (redirectingToCaptain) {
    return;
  }

  if (isAdminSession()) {
    return;
  }

  const session = loadPlayerSession();
  if (!session) {
    return;
  }

  const captainId = state.round?.captains?.[session.team] || null;
  if (captainId && captainId === session.id) {
    redirectingToCaptain = true;
    window.location.replace(`./captain.html?team=${session.team}`);
  }
}

function enforcePlayerSession(state) {
  if (isAdminSession()) {
    playerRegistered = true;
    playerGateEl.classList.add("hidden");
    return;
  }

  const session = loadPlayerSession();
  if (!session) {
    playerRegistered = false;
    playerGateEl.classList.remove("hidden");
    return;
  }

  const roomLogoutVersion = Number.isFinite(Number(state.ui?.logoutAllVersion)) ? Number(state.ui.logoutAllVersion) : 0;
  if ((session.logoutVersion || 0) < roomLogoutVersion) {
    clearPlayerSession();
    playerRegistered = false;
    playerGateErrorEl.textContent = "Tu sesión fue cerrada por el administrador.";
    playerGateEl.classList.remove("hidden");
    return;
  }

  const current = (state.players || []).find((player) => player.id === session.id);
  if (current && current.active === false) {
    clearPlayerSession();
    playerRegistered = false;
    playerGateErrorEl.textContent = "Tu sesión fue cerrada por el administrador.";
    playerGateEl.classList.remove("hidden");
    return;
  }

  playerRegistered = true;
  playerGateEl.classList.add("hidden");
}

function attachPlayerGateEvents() {
  if (isAdminSession()) {
    playerRegistered = true;
    playerGateEl.classList.add("hidden");
    return;
  }

  const existingSession = loadPlayerSession();
  if (existingSession) {
    playerNameInputEl.value = existingSession.name;
    playerTeamSelectEl.value = existingSession.team;
    playerRegistered = true;
    playerGateEl.classList.add("hidden");
    return;
  }

  playerNameInputEl.focus();

  playerGateFormEl.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = playerNameInputEl.value.trim();
    const team = playerTeamSelectEl.value;
    const existing = loadPlayerSession();
    const playerId = existing?.id || createPlayerId();

    if (!name.length) {
      playerGateErrorEl.textContent = "Ingresa tu nombre.";
      return;
    }

    if (team !== "A" && team !== "B") {
      playerGateErrorEl.textContent = "Selecciona un equipo.";
      return;
    }

    savePlayerSession(playerId, name, team);

    try {
      const nextState = await dispatch("REGISTER_PLAYER", { id: playerId, name, team });
      const logoutVersion = Number.isFinite(Number(nextState?.ui?.logoutAllVersion)) ? Number(nextState.ui.logoutAllVersion) : 0;
      savePlayerSession(playerId, name, team, logoutVersion);
      playerRegistered = true;
      playerGateErrorEl.textContent = "";
      playerGateEl.classList.add("hidden");
    } catch (error) {
      clearPlayerSession();
      playerGateErrorEl.textContent = error?.message || "No se pudo registrar tu sesión.";
    }
  });
}

function attachTeamBackEvents() {
  teamBackAcceptButton.addEventListener("click", () => {
    const seenVersion = Number(teamBackModalEl.dataset.version || 0);
    if (seenVersion > 0) {
      setSeenTeamBackVersion(seenVersion);
    }
    teamBackModalEl.classList.add("hidden");
  });

  winnerAcceptButtonEl.addEventListener("click", closeWinnerModal);
}

async function main() {
  try {
    setupAudioUnlock();
    attachPlayerGateEvents();
    attachTeamBackEvents();
    const defaultQuestions = await loadDefaultQuestions();
    const initialState = await initializeState(defaultQuestions);

    const session = loadPlayerSession();
    if (!isAdminSession() && session) {
      const existing = (initialState.players || []).find((player) => player.id === session.id);
      if (!existing) {
        await dispatch("REGISTER_PLAYER", { id: session.id, name: session.name, team: session.team });
      }
    }

    subscribe(render);

    if (!playerRegistered) {
      playerGateEl.classList.remove("hidden");
    }
  } catch (error) {
    questionTextEl.textContent = "Error cargando la configuración del juego";
    buzzerStatusEl.textContent = error.message;
  }
}

main();
