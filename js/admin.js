import { dispatch, getPlayableQuestions, getState, initializeState, subscribe, subscribeConnectionStatus } from "./state.js";

const ADMIN_PIN = "2026";
const ADMIN_AUTH_KEY = "fm100_admin_auth";

const authOverlay = document.getElementById("auth-overlay");
const pinForm = document.getElementById("pin-form");
const pinInput = document.getElementById("pin-input");
const pinError = document.getElementById("pin-error");
const adminApp = document.getElementById("admin-app");
const topbarMenuToggle = document.getElementById("topbar-menu-toggle");
const topbarControls = document.getElementById("topbar-controls");
const logoutAdminButton = document.getElementById("logout-admin");

const adminTeamNameA = document.getElementById("admin-team-name-a");
const adminTeamNameB = document.getElementById("admin-team-name-b");
const adminTeamControlBadgeA = document.getElementById("admin-team-control-badge-a");
const adminTeamControlBadgeB = document.getElementById("admin-team-control-badge-b");
const teamNameInputA = document.getElementById("team-name-a-input");
const teamNameInputB = document.getElementById("team-name-b-input");
const takeControlAButton = document.getElementById("take-control-a");
const takeControlBButton = document.getElementById("take-control-b");
const adminScoreA = document.getElementById("admin-score-a");
const adminScoreB = document.getElementById("admin-score-b");
const adminStrikesA = document.getElementById("admin-strikes-a");
const adminStrikesB = document.getElementById("admin-strikes-b");
const captainNameInputA = document.getElementById("captain-name-a");
const captainNameInputB = document.getElementById("captain-name-b");
const manualPlayerNameInputA = document.getElementById("manual-player-name-a");
const manualPlayerNameInputB = document.getElementById("manual-player-name-b");
const addManualPlayerAButton = document.getElementById("add-manual-player-a");
const addManualPlayerBButton = document.getElementById("add-manual-player-b");
const scoreDeltaInputA = document.getElementById("score-delta-a");
const scoreDeltaInputB = document.getElementById("score-delta-b");
const teamMembersA = document.getElementById("team-members-a");
const teamMembersB = document.getElementById("team-members-b");
const toggleQrButton = document.getElementById("toggle-qr");
const awardRevealedPointsButton = document.getElementById("award-revealed-points");
const stealRevealedPointsButton = document.getElementById("steal-revealed-points");
const addStrikeControlButton = document.getElementById("add-strike-control");
const logoutAllPlayersButton = document.getElementById("logout-all-players");
const winningScoreSelect = document.getElementById("winning-score-select");
const roundMultiplierSelect = document.getElementById("round-multiplier-select");
const gameQuestionTypeSelect = document.getElementById("game-question-type-select");
const nextQuestionButton = document.getElementById("next-question");
const resetGameButton = document.getElementById("reset-game");
const finishGameButton = document.getElementById("finish-game");
const adminSupabaseStatus = document.getElementById("admin-supabase-status");
const adminBuzzerStatus = document.getElementById("admin-buzzer-status");
const adminRoundLabel = document.getElementById("admin-round-label");
const adminQuestionText = document.getElementById("admin-question-text");
const adminAnswersList = document.getElementById("admin-answers-list");
const adminConfirmModal = document.getElementById("admin-confirm-modal");
const adminConfirmMessage = document.getElementById("admin-confirm-message");
const adminConfirmCancelButton = document.getElementById("admin-confirm-cancel");
const adminConfirmAcceptButton = document.getElementById("admin-confirm-accept");
const winnerModal = document.getElementById("winner-modal");
const winnerMessage = document.getElementById("winner-message");
const winnerMembers = document.getElementById("winner-members");
const winnerAcceptButton = document.getElementById("winner-accept");

let pendingConfirmAction = null;
let syncingSelects = 0;
let questionTypeOptionsSignature = "";
const correctSound = new Audio("./assets/audio/correcto.mp3");
const incorrectSound = new Audio("./assets/audio/incorrecto.mp3");
const aJugarSound = new Audio("./assets/audio/a_jugar.mp3");
const triunfoSound = new Audio("./assets/audio/triunfo.mp3");
const buttonSound = new Audio("./assets/audio/button.mp3");
const championsSound = new Audio("./assets/audio/we-are-the-champions.mp3");
let lastSoundEventVersion = null;
let pendingSoundEvent = null;
let audioUnlockConfigured = false;
let lastWinnerVersionShown = 0;
let winnerModalTimeoutId = null;
let lastWinnerFallbackKeyShown = "";
let pendingWinnerToken = null;

function toggleTopbarMenu(forceOpen = null) {
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : topbarControls.classList.contains("collapsed");
  topbarControls.classList.toggle("collapsed", !shouldOpen);
  topbarMenuToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function runWithSelectSync(callback) {
  syncingSelects += 1;
  try {
    callback();
  } finally {
    syncingSelects = Math.max(0, syncingSelects - 1);
  }
}

function isUserSelectChange(event) {
  if (syncingSelects > 0) {
    return false;
  }

  return Boolean(event?.isTrusted);
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

function getActiveSounds() {
  return [correctSound, incorrectSound, aJugarSound, triunfoSound, buttonSound];
}

function isAnyRegularSoundPlaying() {
  return getActiveSounds().some((sound) => !sound.paused && !sound.ended && sound.currentTime > 0);
}

function closeWinnerModal() {
  winnerModal.classList.add("hidden");
  championsSound.pause();
  championsSound.currentTime = 0;
}

function renderWinnerMembers(state, team) {
  const teamPlayers = (state.players || []).filter((player) => player.active && player.team === team);
  if (!teamPlayers.length) {
    winnerMembers.innerHTML = '<p class="winner-member">¡Gran trabajo, equipo!</p>';
    return;
  }

  winnerMembers.innerHTML = teamPlayers.map((player) => `<p class="winner-member">✨ ${player.name}</p>`).join("");
}

function openWinnerModal(state, team) {
  const teamName = state.teams?.[team]?.name || `Equipo ${team}`;
  const winningScore = Number(state.ui?.winningScore || 500);
  const teamScore = Number(state.teams?.[team]?.score || 0);
  winnerMessage.textContent = teamScore >= winningScore
    ? `¡${teamName} alcanzó la meta de ${winningScore} puntos y ganó la partida!`
    : `¡${teamName} ganó la partida por cierre final con ${teamScore} puntos!`;
  renderWinnerMembers(state, team);
  winnerModal.classList.remove("hidden");
  playSound(championsSound);
}

function waitForSoundsAndCelebrate(state) {
  const winnerFromState = state.ui?.winnerTeam;
  const winningScore = Number(state.ui?.winningScore || 500);
  const winnerFromScores = Number(state.teams?.A?.score || 0) >= winningScore ? "A" : (Number(state.teams?.B?.score || 0) >= winningScore ? "B" : null);
  const winnerTeam = winnerFromState === "A" || winnerFromState === "B" ? winnerFromState : winnerFromScores;
  if (winnerTeam !== "A" && winnerTeam !== "B") {
    return;
  }

  const winnerVersion = Number(state.ui?.winnerVersion) || 0;
  const fallbackKey = `${winnerTeam}:${Number(state.teams?.A?.score || 0)}:${Number(state.teams?.B?.score || 0)}`;
  const alreadyShown = winnerVersion > 0 ? winnerVersion <= lastWinnerVersionShown : fallbackKey === lastWinnerFallbackKeyShown;
  if (alreadyShown) {
    pendingWinnerToken = null;
    return;
  }

  const token = winnerVersion > 0 ? `v:${winnerVersion}` : `k:${fallbackKey}`;
  if (pendingWinnerToken === token) {
    return;
  }

  if (winnerModalTimeoutId) {
    clearTimeout(winnerModalTimeoutId);
    winnerModalTimeoutId = null;
  }

  pendingWinnerToken = token;

  const latest = getState();
  const latestWinnerFromState = latest.ui?.winnerTeam;
  const latestWinningScore = Number(latest.ui?.winningScore || 500);
  const latestWinnerFromScores = Number(latest.teams?.A?.score || 0) >= latestWinningScore ? "A" : (Number(latest.teams?.B?.score || 0) >= latestWinningScore ? "B" : null);
  const latestWinnerTeam = latestWinnerFromState === "A" || latestWinnerFromState === "B" ? latestWinnerFromState : latestWinnerFromScores;
  if (latestWinnerTeam !== winnerTeam) {
    pendingWinnerToken = null;
    return;
  }

  openWinnerModal(latest, winnerTeam);
  if (winnerVersion > 0) {
    lastWinnerVersionShown = winnerVersion;
  } else {
    lastWinnerFallbackKeyShown = fallbackKey;
  }
  pendingWinnerToken = null;
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

  tryPlaySoundEvent(type, version);
}

async function loadDefaultQuestions() {
  const response = await fetch("./data/questions.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No se pudo cargar data/questions.json");
  }

  return response.json();
}

function renderAdminAnswers(state) {
  const playableQuestions = getPlayableQuestions(state);
  const question = playableQuestions[state.round.questionIndex];
  adminAnswersList.innerHTML = "";

  if (!question) {
    return;
  }

  const hasControl = state.round?.buzzerWinner === "A" || state.round?.buzzerWinner === "B";

  question.answers.forEach((answer, index) => {
    const item = document.createElement("li");
    const visible = state.round.revealed.includes(index);

    item.className = `answer-item admin-answer-item ${visible ? "revealed" : ""}`;
    item.innerHTML = `
      <div class="admin-answer-main">
        <span>${answer.text}</span>
      </div>
      <div class="admin-answer-actions">
        <strong>${answer.points}</strong>
        <button type="button" class="question-action-btn" data-answer-toggle="${index}">${visible ? "Ocultar" : "Mostrar"}</button>
      </div>
    `;

    const toggleButton = item.querySelector("[data-answer-toggle]");
    if (!hasControl) {
      toggleButton.disabled = true;
      toggleButton.classList.add("answer-toggle-locked");
      toggleButton.title = "Debes asignar control de ronda para mostrar/ocultar respuestas.";
    }

    toggleButton.addEventListener("click", () => {
      if (!hasControl) {
        return;
      }
      dispatch("TOGGLE_REVEAL", { answerIndex: index });
    });

    adminAnswersList.appendChild(item);
  });
}

function renderBuzzerInfo(state) {
  adminBuzzerStatus.classList.remove("ok", "warn");

  if (state.round.status === "buzz-open") {
    adminBuzzerStatus.textContent = "";
    adminBuzzerStatus.classList.add("ok");
    return;
  }

  if (state.round.status === "locked" && state.round.buzzerWinner) {
    adminBuzzerStatus.textContent = "";
    adminBuzzerStatus.classList.add("warn");
    return;
  }

  adminBuzzerStatus.textContent = "Buzzer cerrado.";
}

function getRevealedPointsTotal(state) {
  const playableQuestions = getPlayableQuestions(state);
  const question = playableQuestions[state.round.questionIndex];
  if (!question) {
    return 0;
  }

  const revealedIndexes = Array.from(new Set(state.round.revealed || []));
  return revealedIndexes.reduce((total, index) => {
    const answer = question.answers[index];
    if (!answer) {
      return total;
    }

    const points = Number(answer.points);
    return total + (Number.isFinite(points) && points > 0 ? points : 0);
  }, 0);
}

function renderSupabaseStatus(status) {
  adminSupabaseStatus.classList.remove("status-connected", "status-connecting", "status-disconnected");

  if (status === "connected") {
    adminSupabaseStatus.textContent = "Base de Datos: conectado";
    adminSupabaseStatus.classList.add("status-connected");
    return;
  }

  if (status === "connecting") {
    adminSupabaseStatus.textContent = "Base de Datos: conectando...";
    adminSupabaseStatus.classList.add("status-connecting");
    return;
  }

  adminSupabaseStatus.textContent = "Base de Datos: no conectado";
  adminSupabaseStatus.classList.add("status-disconnected");
}

function syncInputValue(input, value) {
  if (document.activeElement !== input) {
    input.value = value;
  }
}

function renderTeamMembers(state, team, container, captainInput) {
  const players = (state.players || []).filter((player) => player.active && player.team === team);
  container.innerHTML = "";

  if (!players.length) {
    const empty = document.createElement("li");
    empty.className = "team-member-item team-member-empty";
    empty.textContent = "Sin integrantes activos";
    container.appendChild(empty);
    return;
  }

  players.forEach((player) => {
    const isManual = player.source === "manual";
    const item = document.createElement("li");
    item.className = "team-member-item";
    item.innerHTML = `
      <span class="team-member-name">${player.name}</span>
      <div class="team-member-actions">
        <button type="button" class="question-action-btn" data-captain-copy="${player.id}">Copiar a capitán</button>
        ${isManual
    ? `<button type="button" class="question-action-btn" data-player-edit="${player.id}">Editar</button>
             <button type="button" class="question-action-btn danger" data-player-delete="${player.id}">Eliminar</button>`
    : `<button type="button" class="question-action-btn" data-player-logout="${player.id}">Cerrar sesión</button>`}
      </div>
    `;

    const copyCaptainButton = item.querySelector("[data-captain-copy]");
    copyCaptainButton.addEventListener("click", () => {
      captainInput.value = player.name;
      dispatch("SET_ROUND_CAPTAIN", { team, name: player.name });
    });

    const editButton = item.querySelector("[data-player-edit]");
    if (editButton) {
      editButton.addEventListener("click", () => {
        const nextName = window.prompt("Editar nombre del jugador", player.name);
        if (nextName === null) {
          return;
        }

        dispatch("EDIT_MANUAL_PLAYER", { id: player.id, name: nextName });
      });
    }

    const deleteButton = item.querySelector("[data-player-delete]");
    if (deleteButton) {
      deleteButton.addEventListener("click", () => {
        dispatch("DELETE_MANUAL_PLAYER", { id: player.id });
      });
    }

    const logoutButton = item.querySelector("[data-player-logout]");
    if (logoutButton) {
      logoutButton.addEventListener("click", () => {
        dispatch("LOGOUT_PLAYER", { id: player.id });
      });
    }

    container.appendChild(item);
  });
}

function renderQuestionTypeSelect(state) {
  const questionTypes = state.questionTypes || [];
  const nextSignature = questionTypes.map((type) => `${type.id}::${type.name}`).join("||");
  const selectedTypeId = state.ui?.activeQuestionTypeId || "";

  runWithSelectSync(() => {
    if (questionTypeOptionsSignature !== nextSignature) {
      gameQuestionTypeSelect.innerHTML = "";

      questionTypes.forEach((type) => {
        const option = document.createElement("option");
        option.value = type.id;
        option.textContent = type.name;
        gameQuestionTypeSelect.appendChild(option);
      });

      questionTypeOptionsSignature = nextSignature;
    }

    const hasSelected = questionTypes.some((type) => type.id === selectedTypeId);
    const nextValue = hasSelected ? selectedTypeId : questionTypes[0]?.id || "";
    if (gameQuestionTypeSelect.value !== nextValue) {
      gameQuestionTypeSelect.value = nextValue;
    }
  });
}

function render(state) {
  handleGlobalSound(state);
  waitForSoundsAndCelebrate(state);

  const playableQuestions = getPlayableQuestions(state);
  const question = playableQuestions[state.round.questionIndex];

  adminTeamNameA.textContent = state.teams.A.name;
  adminTeamNameB.textContent = state.teams.B.name;
  syncInputValue(teamNameInputA, state.teams.A.name);
  syncInputValue(teamNameInputB, state.teams.B.name);

  adminScoreA.textContent = state.teams.A.score;
  adminScoreB.textContent = state.teams.B.score;
  adminStrikesA.textContent = String(state.teams.A.strikes || 0);
  adminStrikesB.textContent = String(state.teams.B.strikes || 0);
  const hasActivePlayers = (state.players || []).some((player) => player.active);
  logoutAllPlayersButton.disabled = !hasActivePlayers;
  renderTeamMembers(state, "A", teamMembersA, captainNameInputA);
  renderTeamMembers(state, "B", teamMembersB, captainNameInputB);
  syncInputValue(captainNameInputA, state.round?.captains?.A || "");
  syncInputValue(captainNameInputB, state.round?.captains?.B || "");
  const winningScore = Number(state.ui?.winningScore || 500);
  if (document.activeElement !== winningScoreSelect) {
    runWithSelectSync(() => {
      winningScoreSelect.value = String(winningScore);
    });
  }
  renderQuestionTypeSelect(state);
  toggleQrButton.textContent = state.ui?.showQr ? "Ocultar QR" : "Mostrar QR";
  const controlTeam = state.round.buzzerWinner;
  adminTeamControlBadgeA.textContent = controlTeam === "A" ? "TIENEN EL CONTROL" : "";
  adminTeamControlBadgeB.textContent = controlTeam === "B" ? "TIENEN EL CONTROL" : "";
  if (controlTeam === "A" || controlTeam === "B") {
    adminTeamControlBadgeA.classList.toggle("active", controlTeam === "A");
    adminTeamControlBadgeB.classList.toggle("active", controlTeam === "B");
  } else {
    adminTeamControlBadgeA.classList.remove("active");
    adminTeamControlBadgeB.classList.remove("active");
  }
  takeControlAButton.disabled = controlTeam === "A";
  takeControlBButton.disabled = controlTeam === "B";

  const revealedPoints = getRevealedPointsTotal(state);
  const roundStarted = Number(state.round?.questionIndex) >= 0;
  const multiplier = [1, 2, 3].includes(Number(state.round.pointsMultiplier)) ? Number(state.round.pointsMultiplier) : 1;
  if (document.activeElement !== roundMultiplierSelect) {
    runWithSelectSync(() => {
      roundMultiplierSelect.value = String(multiplier);
    });
  }
  winningScoreSelect.disabled = roundStarted;
  roundMultiplierSelect.disabled = roundStarted;
  gameQuestionTypeSelect.disabled = roundStarted;
  const actionsLocked = Boolean(state.round?.actionsLocked);
  const controlTeamStrikes = controlTeam === "A" || controlTeam === "B" ? Number(state.teams?.[controlTeam]?.strikes || 0) : 0;
  const hasTeamWithThreeStrikes = Number(state.teams?.A?.strikes || 0) >= 3 || Number(state.teams?.B?.strikes || 0) >= 3;
  awardRevealedPointsButton.disabled = !(controlTeam === "A" || controlTeam === "B") || revealedPoints <= 0 || actionsLocked;
  stealRevealedPointsButton.disabled = !(controlTeam === "A" || controlTeam === "B") || revealedPoints <= 0 || actionsLocked || !hasTeamWithThreeStrikes;
  addStrikeControlButton.disabled = !(controlTeam === "A" || controlTeam === "B") || actionsLocked || controlTeamStrikes >= 3;
  const questionStarted = Number(state.round.questionIndex) >= 0;
  const canGoNextByRound = !questionStarted || actionsLocked;
  nextQuestionButton.disabled = state.round.questionIndex >= playableQuestions.length - 1 || !canGoNextByRound;

  if (!question) {
    if (playableQuestions.length && state.round.questionIndex < 0) {
      adminRoundLabel.textContent = `Pregunta 0 / ${playableQuestions.length}`;
      adminQuestionText.textContent = "Presiona Siguiente Pregunta para iniciar";
    } else {
      adminRoundLabel.textContent = "Sin preguntas";
      adminQuestionText.textContent = "Importa o crea preguntas";
    }
    adminAnswersList.innerHTML = "";
    return;
  }

  adminRoundLabel.textContent = `Pregunta ${state.round.questionIndex + 1} / ${playableQuestions.length}`;
  adminQuestionText.textContent = question.question;

  renderAdminAnswers(state);
  renderBuzzerInfo(state);
}

function enableAdmin() {
  authOverlay.classList.add("hidden");
  adminApp.classList.remove("hidden");
}

function disableAdmin() {
  authOverlay.classList.remove("hidden");
  adminApp.classList.add("hidden");
}

function ensureAuth() {
  const saved = localStorage.getItem(ADMIN_AUTH_KEY);
  if (saved === "1") {
    enableAdmin();
  }
}

function closeConfirmModal() {
  adminConfirmModal.classList.add("hidden");
  pendingConfirmAction = null;
}

function openConfirmModal(message, onConfirm) {
  adminConfirmMessage.textContent = message;
  pendingConfirmAction = onConfirm;
  adminConfirmModal.classList.remove("hidden");
}

function attachEvents() {
  pinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const pin = pinInput.value.trim();

    if (!/^\d{4}$/.test(pin)) {
      pinError.textContent = "Ingresa un PIN numérico de 4 dígitos";
      return;
    }

    if (pin !== ADMIN_PIN) {
      pinError.textContent = "PIN incorrecto";
      return;
    }

    localStorage.setItem(ADMIN_AUTH_KEY, "1");
    pinError.textContent = "";
    pinInput.value = "";
    enableAdmin();
  });

  toggleQrButton.addEventListener("click", () => {
    const state = getState();
    dispatch("TOGGLE_QR", { value: !state.ui?.showQr });
  });
  takeControlAButton.addEventListener("click", () => {
    dispatch("FORCE_ROUND_CONTROL", { team: "A" });
  });
  takeControlBButton.addEventListener("click", () => {
    dispatch("FORCE_ROUND_CONTROL", { team: "B" });
  });
  addStrikeControlButton.addEventListener("click", () => {
    const controlTeam = getState().round?.buzzerWinner;
    if (controlTeam !== "A" && controlTeam !== "B") {
      return;
    }

    dispatch("ADD_STRIKE", { team: controlTeam });
  });
  awardRevealedPointsButton.addEventListener("click", async () => {
    const state = getState();
    const controlTeam = state.round.buzzerWinner;
    if (controlTeam !== "A" && controlTeam !== "B") {
      return;
    }

    const points = getRevealedPointsTotal(state);
    if (points <= 0) {
      return;
    }

    const multiplier = [1, 2, 3].includes(Number(state.round.pointsMultiplier)) ? Number(state.round.pointsMultiplier) : 1;

    await dispatch("ADD_SCORE", { team: controlTeam, points: points * multiplier, playTriumph: true, lockRoundActions: true });
    await dispatch("SET_QUESTION_INDEX", { index: -1 });
  });
  stealRevealedPointsButton.addEventListener("click", async () => {
    const state = getState();
    const controlTeam = state.round.buzzerWinner;
    if (controlTeam !== "A" && controlTeam !== "B") {
      return;
    }

    const targetTeam = controlTeam === "A" ? "B" : "A";
    const points = getRevealedPointsTotal(state);
    if (points <= 0) {
      return;
    }

    const multiplier = [1, 2, 3].includes(Number(state.round.pointsMultiplier)) ? Number(state.round.pointsMultiplier) : 1;

    await dispatch("ADD_SCORE", { team: targetTeam, points: points * multiplier, playTriumph: true, lockRoundActions: true });
    await dispatch("SET_QUESTION_INDEX", { index: -1 });
  });
  winningScoreSelect.addEventListener("change", (event) => {
    if (!isUserSelectChange(event) || Number(getState().round?.questionIndex) >= 0) {
      return;
    }

    const value = Number(winningScoreSelect.value);
    if (![250, 500, 750, 1000].includes(value)) {
      return;
    }

    dispatch("SET_WINNING_SCORE", { value });
  });
  roundMultiplierSelect.addEventListener("change", (event) => {
    if (!isUserSelectChange(event)) {
      return;
    }

    const value = Number(roundMultiplierSelect.value);
    if (![1, 2, 3].includes(value)) {
      return;
    }

    dispatch("SET_ROUND_MULTIPLIER", { multiplier: value });
  });
  gameQuestionTypeSelect.addEventListener("change", (event) => {
    if (!isUserSelectChange(event)) {
      return;
    }

    if (Number(getState().round?.questionIndex) >= 0) {
      return;
    }

    if (!gameQuestionTypeSelect.value) {
      return;
    }

    dispatch("SET_ACTIVE_QUESTION_TYPE", { id: gameQuestionTypeSelect.value });
  });
  logoutAllPlayersButton.addEventListener("click", () => {
    openConfirmModal("¿Seguro que deseas expulsar a todos los jugadores?", () => dispatch("LOGOUT_ALL_PLAYERS"));
  });
  nextQuestionButton.addEventListener("click", () => dispatch("NEXT_QUESTION"));
  resetGameButton.addEventListener("click", () => {
    openConfirmModal("¿Seguro que deseas resetear toda la partida?", () => dispatch("RESET_GAME"));
  });
  finishGameButton.addEventListener("click", () => {
    openConfirmModal("¿Seguro que deseas terminar la partida y declarar ganador al equipo con más puntos?", async () => {
      const state = getState();
      const scoreA = Number(state.teams?.A?.score || 0);
      const scoreB = Number(state.teams?.B?.score || 0);
      if (scoreA === scoreB) {
        return;
      }

      const winnerTeam = scoreA > scoreB ? "A" : "B";
      await dispatch("DECLARE_WINNER", { team: winnerTeam });
    });
  });

  adminConfirmCancelButton.addEventListener("click", closeConfirmModal);
  adminConfirmAcceptButton.addEventListener("click", () => {
    const action = pendingConfirmAction;
    closeConfirmModal();
    if (action) {
      action();
    }
  });

  adminConfirmModal.addEventListener("click", (event) => {
    if (event.target === adminConfirmModal) {
      closeConfirmModal();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !adminConfirmModal.classList.contains("hidden")) {
      closeConfirmModal();
    }

    if (event.key === "Escape" && !winnerModal.classList.contains("hidden")) {
      closeWinnerModal();
    }
  });

  winnerAcceptButton.addEventListener("click", closeWinnerModal);

  topbarMenuToggle.addEventListener("click", () => {
    toggleTopbarMenu();
  });

  topbarControls.addEventListener("click", (event) => {
    const option = event.target.closest("a, button");
    if (!option || option.id === "topbar-menu-toggle") {
      return;
    }

    if (window.innerWidth <= 900) {
      toggleTopbarMenu(false);
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) {
      toggleTopbarMenu(true);
    }
  });

  logoutAdminButton.addEventListener("click", () => {
    localStorage.removeItem(ADMIN_AUTH_KEY);
    pinError.textContent = "";
    pinInput.value = "";
    disableAdmin();
    pinInput.focus();
  });

  const updateTeamName = (team, input) => {
    dispatch("SET_TEAM_NAME", { team, name: input.value });
  };

  const updateCaptainName = (team, input) => {
    dispatch("SET_ROUND_CAPTAIN", { team, name: input.value });
  };

  const addManualPlayer = (team, input) => {
    const name = String(input.value || "").trim();
    if (!name) {
      return;
    }

    dispatch("ADD_MANUAL_PLAYER", { team, name });
    input.value = "";
  };

  teamNameInputA.addEventListener("change", () => updateTeamName("A", teamNameInputA));
  teamNameInputB.addEventListener("change", () => updateTeamName("B", teamNameInputB));
  teamNameInputA.addEventListener("blur", () => updateTeamName("A", teamNameInputA));
  teamNameInputB.addEventListener("blur", () => updateTeamName("B", teamNameInputB));
  captainNameInputA.addEventListener("change", () => updateCaptainName("A", captainNameInputA));
  captainNameInputB.addEventListener("change", () => updateCaptainName("B", captainNameInputB));
  captainNameInputA.addEventListener("blur", () => updateCaptainName("A", captainNameInputA));
  captainNameInputB.addEventListener("blur", () => updateCaptainName("B", captainNameInputB));
  addManualPlayerAButton.addEventListener("click", () => addManualPlayer("A", manualPlayerNameInputA));
  addManualPlayerBButton.addEventListener("click", () => addManualPlayer("B", manualPlayerNameInputB));

  [
    [teamNameInputA, "A"],
    [teamNameInputB, "B"],
  ].forEach(([input, team]) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        updateTeamName(team, input);
        input.blur();
      }
    });
  });

  [
    [captainNameInputA, "A"],
    [captainNameInputB, "B"],
  ].forEach(([input, team]) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        updateCaptainName(team, input);
        input.blur();
      }
    });
  });

  [
    [manualPlayerNameInputA, "A"],
    [manualPlayerNameInputB, "B"],
  ].forEach(([input, team]) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addManualPlayer(team, input);
      }
    });
  });

  document.querySelectorAll("[data-score-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const [team, operation] = button.dataset.scoreAction.split(":");
      const sourceInput = team === "A" ? scoreDeltaInputA : scoreDeltaInputB;
      const baseValue = Number(sourceInput.value);
      const normalized = Number.isFinite(baseValue) && baseValue > 0 ? Math.floor(baseValue) : 0;
      const points = operation === "sub" ? -normalized : normalized;
      if (!points) {
        return;
      }

      dispatch("ADD_SCORE", { team, points: Number(points) });
    });
  });
}

async function main() {
  setupAudioUnlock();
  attachEvents();
  ensureAuth();

  let defaults = [];
  try {
    defaults = await loadDefaultQuestions();
  } catch (error) {
    pinError.textContent = "No se pudo cargar questions.json. Puedes seguir usando el panel con datos locales.";
  }

  await initializeState(defaults);
  toggleTopbarMenu(window.innerWidth > 900);
  subscribeConnectionStatus(renderSupabaseStatus);
  subscribe(render);
}

main();
