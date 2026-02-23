import { dispatch, getState, initializeState, subscribe } from "./state.js";

const params = new URLSearchParams(window.location.search);
const team = (params.get("team") || "").toUpperCase();

const captainTitle = document.getElementById("captain-title");
const captainRoundControl = document.getElementById("captain-round-control");
const captainQuestionType = document.getElementById("captain-question-type");
const captainStrikes = document.getElementById("captain-strikes");
const captainBuzzButton = document.getElementById("captain-buzz");
const teamBackModalEl = document.getElementById("team-back-modal");
const teamBackAcceptButton = document.getElementById("team-back-accept");
const winnerModalEl = document.getElementById("winner-modal");
const winnerMessageEl = document.getElementById("winner-message");
const winnerMembersEl = document.getElementById("winner-members");
const winnerAcceptButtonEl = document.getElementById("winner-accept");
const strikeOverlayEl = document.getElementById("strike-overlay");
const strikeOverlayImagesEl = document.getElementById("strike-overlay-images");
const PLAYER_SESSION_KEY = "fm100_player_session";
const TEAM_BACK_SEEN_KEY = "fm100_team_back_seen";
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
let lastSoundEventVersion = null;
let pendingSoundEvent = null;
let audioUnlockConfigured = false;
let strikeOverlayTimeoutId = null;
let strikeSoundDurationMs = STRIKE_OVERLAY_DEFAULT_MS;
let lastWinnerVersionShown = 0;
let winnerModalTimeoutId = null;
let lastWinnerFallbackKeyShown = "";

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

function resolveTeam() {
  return team === "A" || team === "B" ? team : null;
}

function loadPlayerSession() {
  const raw = sessionStorage.getItem(PLAYER_SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const id = String(parsed?.id || "").trim();
    const playerTeam = String(parsed?.team || "").trim();
    const name = String(parsed?.name || "").trim();
    if (!id || !name || (playerTeam !== "A" && playerTeam !== "B")) {
      return null;
    }

    return {
      id,
      team: playerTeam,
      name,
    };
  } catch {
    return null;
  }
}

function denyCaptainAccess() {
  window.location.replace("./index.html");
}

function getSeenTeamBackVersion() {
  return Number(sessionStorage.getItem(TEAM_BACK_SEEN_KEY)) || 0;
}

function setSeenTeamBackVersion(version) {
  sessionStorage.setItem(TEAM_BACK_SEEN_KEY, String(version));
}

function renderTeamBackModal(state, validTeam) {
  const targetTeam = state.ui?.teamBackAlertTeam;
  const version = Number(state.ui?.teamBackAlertVersion) || 0;
  if ((targetTeam === "A" || targetTeam === "B") && targetTeam === validTeam && version > 0) {
    const seen = getSeenTeamBackVersion();
    teamBackModalEl.dataset.version = String(version);
    teamBackModalEl.classList.toggle("hidden", seen >= version);
    return;
  }

  teamBackModalEl.classList.add("hidden");
}

async function loadDefaultQuestions() {
  const response = await fetch("./data/questions.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No se pudo cargar data/questions.json");
  }

  return response.json();
}

function render(state) {
  handleGlobalSound(state);
  waitForSoundsAndCelebrate(state);

  const validTeam = resolveTeam();
  if (!validTeam) {
    captainTitle.textContent = "Equipo no válido";
    captainBuzzButton.disabled = true;
    return;
  }

  const session = loadPlayerSession();
  if (!session || session.team !== validTeam) {
    denyCaptainAccess();
    return;
  }

  const player = (state.players || []).find((item) => item.id === session.id);
  const assignedCaptain = state.round?.captains?.[validTeam] || null;
  if (!player || !player.active || assignedCaptain !== session.id) {
    denyCaptainAccess();
    return;
  }

  const ownTeamName = state.teams[validTeam]?.name || `Equipo ${validTeam}`;
  captainTitle.textContent = `Capitán ${ownTeamName}`;
  renderTeamBackModal(state, validTeam);

  const activeTypeId = state.ui?.activeQuestionTypeId || "";
  const activeTypeName = (state.questionTypes || []).find((type) => type.id === activeTypeId)?.name || "--";
  captainQuestionType.textContent = `Tipo de partida: ${activeTypeName}`;

  const controlTeam = state.round.buzzerWinner;
  if (controlTeam === "A" || controlTeam === "B") {
    const controlName = state.teams[controlTeam]?.name || `Equipo ${controlTeam}`;
    captainRoundControl.textContent = `Control de ronda: ${controlName}`;
  } else {
    captainRoundControl.textContent = "Control de ronda: sin equipo";
  }

  const ownStrikes = Number(state.teams[validTeam]?.strikes) || 0;
  captainStrikes.innerHTML = `Strikes: <strong>${ownStrikes}</strong>`;

  const winner = state.round.buzzerWinner;
  const isOpen = state.round.status === "buzz-open";

  captainBuzzButton.disabled = !isOpen || Boolean(winner);
}

function onBuzz() {
  const validTeam = resolveTeam();
  if (!validTeam) {
    return;
  }

  const state = getState();
  if (state.round.status !== "buzz-open" || state.round.buzzerWinner) {
    return;
  }

  dispatch("LOCK_BUZZ", { team: validTeam });
}

function attachEvents() {
  captainBuzzButton.addEventListener("click", onBuzz);
  teamBackAcceptButton.addEventListener("click", () => {
    const seenVersion = Number(teamBackModalEl.dataset.version || 0);
    if (seenVersion > 0) {
      setSeenTeamBackVersion(seenVersion);
    }
    teamBackModalEl.classList.add("hidden");
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onBuzz();
    }
  });

  winnerAcceptButtonEl.addEventListener("click", closeWinnerModal);
}

async function main() {
  setupAudioUnlock();
  let defaults = [];
  try {
    defaults = await loadDefaultQuestions();
  } catch {
    defaults = [];
  }

  await initializeState(defaults);
  subscribe(render);
  attachEvents();
}

main();
