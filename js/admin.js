import { dispatch, getPlayableQuestions, getState, initializeState, subscribe, subscribeConnectionStatus } from "./state.js";

const ADMIN_PIN = "2026";
const ADMIN_AUTH_KEY = "fm100_admin_auth";

const authOverlay = document.getElementById("auth-overlay");
const pinForm = document.getElementById("pin-form");
const pinInput = document.getElementById("pin-input");
const pinError = document.getElementById("pin-error");
const adminApp = document.getElementById("admin-app");
const logoutAdminButton = document.getElementById("logout-admin");

const adminTeamNameA = document.getElementById("admin-team-name-a");
const adminTeamNameB = document.getElementById("admin-team-name-b");
const adminTeamControlBadgeA = document.getElementById("admin-team-control-badge-a");
const adminTeamControlBadgeB = document.getElementById("admin-team-control-badge-b");
const teamNameInputA = document.getElementById("team-name-a-input");
const teamNameInputB = document.getElementById("team-name-b-input");
const adminScoreA = document.getElementById("admin-score-a");
const adminScoreB = document.getElementById("admin-score-b");
const adminStrikesA = document.getElementById("admin-strikes-a");
const adminStrikesB = document.getElementById("admin-strikes-b");
const captainSelectA = document.getElementById("captain-select-a");
const captainSelectB = document.getElementById("captain-select-b");
const scoreDeltaInputA = document.getElementById("score-delta-a");
const scoreDeltaInputB = document.getElementById("score-delta-b");
const teamMembersA = document.getElementById("team-members-a");
const teamMembersB = document.getElementById("team-members-b");
const toggleQrButton = document.getElementById("toggle-qr");
const clearRoundControlButton = document.getElementById("clear-round-control");
const awardRevealedPointsButton = document.getElementById("award-revealed-points");
const stealRevealedPointsButton = document.getElementById("steal-revealed-points");
const addStrikeControlButton = document.getElementById("add-strike-control");
const logoutAllPlayersButton = document.getElementById("logout-all-players");
const roundMultiplierSelect = document.getElementById("round-multiplier-select");
const gameQuestionTypeSelect = document.getElementById("game-question-type-select");
const resetRoundButton = document.getElementById("reset-round");
const nextQuestionButton = document.getElementById("next-question");
const prevQuestionButton = document.getElementById("prev-question");
const resetGameButton = document.getElementById("reset-game");
const adminSupabaseStatus = document.getElementById("admin-supabase-status");
const adminBuzzerStatus = document.getElementById("admin-buzzer-status");
const adminRoundLabel = document.getElementById("admin-round-label");
const adminQuestionText = document.getElementById("admin-question-text");
const adminAnswersList = document.getElementById("admin-answers-list");
const adminConfirmModal = document.getElementById("admin-confirm-modal");
const adminConfirmMessage = document.getElementById("admin-confirm-message");
const adminConfirmCancelButton = document.getElementById("admin-confirm-cancel");
const adminConfirmAcceptButton = document.getElementById("admin-confirm-accept");

let pendingConfirmAction = null;
let syncingSelects = 0;
let questionTypeOptionsSignature = "";
const correctSound = new Audio("./assets/audio/correcto.mp3");
const incorrectSound = new Audio("./assets/audio/incorrecto.mp3");
const aJugarSound = new Audio("./assets/audio/a_jugar.mp3");
const triunfoSound = new Audio("./assets/audio/triunfo.mp3");
let lastSoundEventVersion = null;
let pendingSoundEvent = null;
let audioUnlockConfigured = false;

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
  const sounds = [correctSound, incorrectSound, aJugarSound, triunfoSound];
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
    toggleButton.addEventListener("click", () => {
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

function renderTeamMembers(state, team, container) {
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
    const item = document.createElement("li");
    item.className = "team-member-item";
    item.innerHTML = `
      <span>${player.name}</span>
      <div class="team-member-actions">
        <button type="button" class="question-action-btn" data-player-logout="${player.id}">Cerrar sesión</button>
      </div>
    `;

    const logoutButton = item.querySelector("[data-player-logout]");
    logoutButton.addEventListener("click", () => {
      dispatch("LOGOUT_PLAYER", { id: player.id });
    });

    container.appendChild(item);
  });
}

function renderCaptainSelect(state, team, selectEl) {
  const players = (state.players || []).filter((player) => player.active && player.team === team);
  const currentCaptainId = state.round?.captains?.[team] || "";
  runWithSelectSync(() => {
    selectEl.innerHTML = "";

    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "No hay capitán";
    selectEl.appendChild(noneOption);

    players.forEach((player) => {
      const option = document.createElement("option");
      option.value = player.id;
      option.textContent = player.name;
      selectEl.appendChild(option);
    });

    const validCaptain = players.some((player) => player.id === currentCaptainId);
    selectEl.value = validCaptain ? currentCaptainId : "";
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
  renderTeamMembers(state, "A", teamMembersA);
  renderTeamMembers(state, "B", teamMembersB);
  renderCaptainSelect(state, "A", captainSelectA);
  renderCaptainSelect(state, "B", captainSelectB);
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
  clearRoundControlButton.disabled = !(controlTeam === "A" || controlTeam === "B");

  const revealedPoints = getRevealedPointsTotal(state);
  const multiplier = [1, 2, 3].includes(Number(state.round.pointsMultiplier)) ? Number(state.round.pointsMultiplier) : 1;
  if (document.activeElement !== roundMultiplierSelect) {
    runWithSelectSync(() => {
      roundMultiplierSelect.value = String(multiplier);
    });
  }
  awardRevealedPointsButton.disabled = !(controlTeam === "A" || controlTeam === "B") || revealedPoints <= 0;
  stealRevealedPointsButton.disabled = !(controlTeam === "A" || controlTeam === "B") || revealedPoints <= 0;
  addStrikeControlButton.disabled = !(controlTeam === "A" || controlTeam === "B");
  prevQuestionButton.disabled = state.round.questionIndex <= 0;
  nextQuestionButton.disabled = state.round.questionIndex >= playableQuestions.length - 1;

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
  clearRoundControlButton.addEventListener("click", () => {
    dispatch("CLEAR_ROUND_CONTROL");
  });
  addStrikeControlButton.addEventListener("click", () => {
    const controlTeam = getState().round?.buzzerWinner;
    if (controlTeam !== "A" && controlTeam !== "B") {
      return;
    }

    dispatch("ADD_STRIKE", { team: controlTeam });
  });
  awardRevealedPointsButton.addEventListener("click", () => {
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

    dispatch("ADD_SCORE", { team: controlTeam, points: points * multiplier, playTriumph: true });
  });
  stealRevealedPointsButton.addEventListener("click", () => {
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

    dispatch("ADD_SCORE", { team: targetTeam, points: points * multiplier, playTriumph: true });
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

    if (!gameQuestionTypeSelect.value) {
      return;
    }

    dispatch("SET_ACTIVE_QUESTION_TYPE", { id: gameQuestionTypeSelect.value });
  });
  logoutAllPlayersButton.addEventListener("click", () => {
    openConfirmModal("¿Seguro que deseas cerrar la sesión de todos los jugadores?", () => dispatch("LOGOUT_ALL_PLAYERS"));
  });
  resetRoundButton.addEventListener("click", () => {
    openConfirmModal("¿Seguro que deseas resetear la ronda actual?", () => dispatch("RESET_ROUND"));
  });
  nextQuestionButton.addEventListener("click", () => dispatch("NEXT_QUESTION"));
  prevQuestionButton.addEventListener("click", () => dispatch("PREV_QUESTION"));
  resetGameButton.addEventListener("click", () => {
    openConfirmModal("¿Seguro que deseas resetear toda la partida?", () => dispatch("RESET_GAME"));
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

  teamNameInputA.addEventListener("change", () => updateTeamName("A", teamNameInputA));
  teamNameInputB.addEventListener("change", () => updateTeamName("B", teamNameInputB));
  teamNameInputA.addEventListener("blur", () => updateTeamName("A", teamNameInputA));
  teamNameInputB.addEventListener("blur", () => updateTeamName("B", teamNameInputB));
  captainSelectA.addEventListener("change", (event) => {
    if (!isUserSelectChange(event)) {
      return;
    }

    dispatch("SET_ROUND_CAPTAIN", { team: "A", playerId: captainSelectA.value || null });
  });
  captainSelectB.addEventListener("change", (event) => {
    if (!isUserSelectChange(event)) {
      return;
    }

    dispatch("SET_ROUND_CAPTAIN", { team: "B", playerId: captainSelectB.value || null });
  });

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
  subscribeConnectionStatus(renderSupabaseStatus);
  subscribe(render);
}

main();
