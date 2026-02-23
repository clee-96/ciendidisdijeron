import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ROOM_CODE, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

const STORAGE_KEY = "fm100_state_v1";
const CHANNEL_NAME = "fm100_channel";
const QUESTION_ACTIONS = new Set(["SET_QUESTIONS", "UPSERT_QUESTION", "DELETE_QUESTION"]);
const QUESTION_TYPE_ACTIONS = new Set(["UPSERT_QUESTION_TYPE", "DELETE_QUESTION_TYPE"]);
const DEFAULT_QUESTION_TYPE_ID = "general";
const DEFAULT_QUESTION_TYPE_NAME = "General";

let state = null;
let channel = null;
let supabase = null;
let realtimeChannel = null;
let questionsRealtimeChannel = null;
let questionTypesRealtimeChannel = null;
let roomSyncInterval = null;
let supabaseEnabled = false;
let pendingRoomSync = false;
let pendingQuestionsSync = false;
let pendingQuestionTypesSync = false;
const listeners = new Set();
const connectionListeners = new Set();
let connectionStatus = "connecting";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeQuestionTypes(questionTypes) {
  const fallback = [{ id: DEFAULT_QUESTION_TYPE_ID, name: DEFAULT_QUESTION_TYPE_NAME, description: "Categoría principal" }];
  if (!Array.isArray(questionTypes) || !questionTypes.length) {
    return fallback;
  }

  const normalized = questionTypes
    .map((item, index) => {
      const rawId = String(item?.id || "").trim();
      const id = rawId || `type-${index + 1}`;
      const name = String(item?.name || "").trim().slice(0, 40);
      const description = String(item?.description || "").trim().slice(0, 180);
      if (!name) {
        return null;
      }

      return {
        id,
        name,
        description,
      };
    })
    .filter(Boolean);

  if (!normalized.length) {
    return fallback;
  }

  const seen = new Set();
  return normalized.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function normalizeQuestions(questions, questionTypes = []) {
  if (!Array.isArray(questions) || !questions.length) {
    return [];
  }

  const typeIds = new Set((questionTypes || []).map((item) => item.id));
  const fallbackTypeId = (questionTypes || [])[0]?.id || DEFAULT_QUESTION_TYPE_ID;

  return questions
    .map((item, index) => ({
      id: item.id || `q${index + 1}`,
      question: String(item.question || "Pregunta sin texto"),
      typeId: typeIds.has(String(item.typeId || item.type_id || "").trim())
        ? String(item.typeId || item.type_id).trim()
        : fallbackTypeId,
      displayOrder: Number.isInteger(Number(item.displayOrder ?? item.display_order))
        ? Math.max(1, Number(item.displayOrder ?? item.display_order))
        : index + 1,
      answers: Array.isArray(item.answers)
        ? item.answers
            .map((answer) => ({
              text: String(answer.text || "Respuesta"),
              points: Number.isFinite(Number(answer.points)) ? Number(answer.points) : 0,
            }))
            .filter((answer) => answer.text.trim().length > 0)
        : [],
    }))
    .filter((item) => item.answers.length > 0);
}

function getQuestionsByType(questions, typeId) {
  return (questions || [])
    .filter((question) => question.typeId === typeId)
    .sort((left, right) => {
      const orderDiff = Number(left.displayOrder || 0) - Number(right.displayOrder || 0);
      if (orderDiff !== 0) {
        return orderDiff;
      }

      return String(left.question || "").localeCompare(String(right.question || ""), "es", { sensitivity: "base" });
    });
}

function normalizeTeamName(value, fallback) {
  const text = String(value || "").trim();
  return text.length ? text.slice(0, 24) : fallback;
}

function normalizePlayers(players) {
  if (!Array.isArray(players)) {
    return [];
  }

  return players
    .map((player) => {
      const id = String(player?.id || "").trim();
      const name = String(player?.name || "").trim().slice(0, 32);
      const team = player?.team === "A" || player?.team === "B" ? player.team : null;
      if (!id || !name || !team) {
        return null;
      }

      return {
        id,
        name,
        team,
        active: player?.active !== false,
      };
    })
    .filter(Boolean);
}

function createInitialState(defaultQuestions = []) {
  const questionTypes = normalizeQuestionTypes([]);
  const questions = normalizeQuestions(defaultQuestions, questionTypes);

  return {
    version: 1,
    stateVersion: 0,
    teams: {
      A: { name: "Equipo A", score: 0, strikes: 0 },
      B: { name: "Equipo B", score: 0, strikes: 0 },
    },
    questionTypes,
    questions,
    round: {
      questionIndex: -1,
      status: "buzz-open",
      buzzerWinner: null,
      revealed: [],
      pointsMultiplier: 1,
      captains: {
        A: null,
        B: null,
      },
    },
    players: [],
    ui: {
      showQr: false,
      activeQuestionTypeId: questionTypes[0].id,
      logoutAllVersion: 0,
      teamBackAlertTeam: null,
      teamBackAlertVersion: 0,
      soundEventType: null,
      soundEventVersion: 0,
    },
    updatedAt: Date.now(),
  };
}

function validateState(nextState, fallbackQuestions = []) {
  if (!nextState || typeof nextState !== "object") {
    return createInitialState(fallbackQuestions);
  }

  const questionTypes = normalizeQuestionTypes(nextState.questionTypes);
  const activeQuestionTypeId = questionTypes.some((item) => item.id === nextState.ui?.activeQuestionTypeId)
    ? nextState.ui.activeQuestionTypeId
    : questionTypes[0].id;

  const questions = normalizeQuestions(nextState.questions?.length ? nextState.questions : fallbackQuestions, questionTypes);
  const activeQuestions = getQuestionsByType(questions, activeQuestionTypeId);
  const maxQuestionIndex = Math.max(-1, activeQuestions.length - 1);
  const incomingQuestionIndex = Number(nextState.round?.questionIndex);
  const normalizedQuestionIndex = Number.isInteger(incomingQuestionIndex) ? incomingQuestionIndex : -1;
  const safeQuestionIndex = questions.length
    ? Math.min(Math.max(normalizedQuestionIndex, -1), maxQuestionIndex)
    : Math.max(normalizedQuestionIndex, -1);

  const parsedStatus = ["idle", "buzz-open", "locked", "round-end"].includes(nextState.round?.status)
    ? nextState.round.status
    : "idle";
  const parsedBuzzerWinner = ["A", "B", null].includes(nextState.round?.buzzerWinner) ? nextState.round.buzzerWinner : null;
  const effectiveRoundStatus = parsedBuzzerWinner ? "locked" : "buzz-open";

  return {
    version: 1,
    stateVersion: Number.isFinite(Number(nextState.stateVersion)) ? Number(nextState.stateVersion) : 0,
    teams: {
      A: {
        name: normalizeTeamName(nextState.teams?.A?.name, "Equipo A"),
        score: Number(nextState.teams?.A?.score) || 0,
        strikes: Math.max(0, Number(nextState.teams?.A?.strikes) || 0),
      },
      B: {
        name: normalizeTeamName(nextState.teams?.B?.name, "Equipo B"),
        score: Number(nextState.teams?.B?.score) || 0,
        strikes: Math.max(0, Number(nextState.teams?.B?.strikes) || 0),
      },
    },
    questionTypes,
    questions,
    round: {
      questionIndex: safeQuestionIndex,
      status: parsedStatus === "round-end" ? "round-end" : effectiveRoundStatus,
      buzzerWinner: parsedBuzzerWinner,
      revealed: Array.isArray(nextState.round?.revealed)
        ? nextState.round.revealed.filter((value) => Number.isInteger(value) && value >= 0)
        : [],
      pointsMultiplier: [1, 2, 3].includes(Number(nextState.round?.pointsMultiplier))
        ? Number(nextState.round.pointsMultiplier)
        : 1,
      captains: {
        A: typeof nextState.round?.captains?.A === "string" ? nextState.round.captains.A : null,
        B: typeof nextState.round?.captains?.B === "string" ? nextState.round.captains.B : null,
      },
    },
    players: normalizePlayers(nextState.players),
    ui: {
      showQr: Boolean(nextState.ui?.showQr),
      activeQuestionTypeId,
      logoutAllVersion: Number.isFinite(Number(nextState.ui?.logoutAllVersion))
        ? Number(nextState.ui.logoutAllVersion)
        : 0,
      teamBackAlertTeam: ["A", "B", null].includes(nextState.ui?.teamBackAlertTeam)
        ? nextState.ui.teamBackAlertTeam
        : null,
      teamBackAlertVersion: Number.isFinite(Number(nextState.ui?.teamBackAlertVersion))
        ? Number(nextState.ui.teamBackAlertVersion)
        : 0,
      soundEventType: ["correct", "incorrect", "a_jugar", "triunfo", null].includes(nextState.ui?.soundEventType)
        ? nextState.ui.soundEventType
        : null,
      soundEventVersion: Number.isFinite(Number(nextState.ui?.soundEventVersion))
        ? Number(nextState.ui.soundEventVersion)
        : 0,
    },
    updatedAt: Number(nextState.updatedAt) || Date.now(),
  };
}

function isRemoteStateNewer(remote, local) {
  if (!local) {
    return true;
  }

  const remoteVersion = Number(remote.stateVersion) || 0;
  const localVersion = Number(local.stateVersion) || 0;

  if (remoteVersion !== localVersion) {
    return remoteVersion > localVersion;
  }

  return Number(remote.updatedAt) >= Number(local.updatedAt);
}

function persistAndNotify(shouldBroadcast = true) {
  state.updatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  if (shouldBroadcast && channel) {
    channel.postMessage({
      type: "state:update",
      payload: state,
    });
  }

  listeners.forEach((callback) => callback(getState()));
}

function notifyOnly() {
  listeners.forEach((callback) => callback(getState()));
}

function notifyConnectionStatus() {
  connectionListeners.forEach((callback) => callback(connectionStatus));
}

function setConnectionStatus(nextStatus) {
  if (connectionStatus === nextStatus) {
    return;
  }

  connectionStatus = nextStatus;
  notifyConnectionStatus();
}

function setupChannel() {
  if (channel || typeof BroadcastChannel === "undefined") {
    return;
  }

  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    if (!event?.data || event.data.type !== "state:update") {
      return;
    }

    const remoteState = validateState(event.data.payload, state?.questions || []);
    if (isRemoteStateNewer(remoteState, state)) {
      state = remoteState;
      persistAndNotify(false);
    }
  };
}

export function initializeState(defaultQuestions = []) {
  return initializeStateAsync(defaultQuestions);
}

export function getState() {
  return clone(state);
}

export function getPlayableQuestions(snapshot = null) {
  const source = snapshot || state;
  if (!source) {
    return [];
  }

  const activeTypeId = source.ui?.activeQuestionTypeId || source.questionTypes?.[0]?.id || DEFAULT_QUESTION_TYPE_ID;
  return clone(getQuestionsByType(source.questions || [], activeTypeId));
}

export function subscribe(callback) {
  listeners.add(callback);
  callback(getState());

  return () => {
    listeners.delete(callback);
  };
}

export function getConnectionStatus() {
  return connectionStatus;
}

export function isSupabaseConnected() {
  return supabaseEnabled && connectionStatus === "connected";
}

export function subscribeConnectionStatus(callback) {
  connectionListeners.add(callback);
  callback(getConnectionStatus());

  return () => {
    connectionListeners.delete(callback);
  };
}

function clampQuestionIndex(nextIndex) {
  const activeTypeId = state.ui?.activeQuestionTypeId || state.questionTypes?.[0]?.id || DEFAULT_QUESTION_TYPE_ID;
  const activeQuestions = getQuestionsByType(state.questions || [], activeTypeId);
  const max = Math.max(-1, activeQuestions.length - 1);
  return Math.min(Math.max(nextIndex, -1), max);
}

function emitSoundEvent(type) {
  if (!["correct", "incorrect", "a_jugar", "triunfo"].includes(type)) {
    return;
  }

  state.ui.soundEventType = type;
  state.ui.soundEventVersion = (Number(state.ui.soundEventVersion) || 0) + 1;
}

function resetRoundInternals() {
  state.round.status = "buzz-open";
  state.round.buzzerWinner = null;
  state.round.revealed = [];
  state.round.pointsMultiplier = 1;
  state.round.captains = {
    A: null,
    B: null,
  };
  state.teams.A.strikes = 0;
  state.teams.B.strikes = 0;
  state.ui.teamBackAlertTeam = null;
}

function applyActionLocal(action, payload = {}) {
  switch (action) {
    case "OPEN_BUZZ": {
      state.round.status = "buzz-open";
      state.round.buzzerWinner = null;
      break;
    }
    case "LOCK_BUZZ": {
      if (state.round.status === "buzz-open" && !state.round.buzzerWinner) {
        if (payload.team === "A" || payload.team === "B") {
          state.round.buzzerWinner = payload.team;
          state.round.status = "locked";
        }
      }
      break;
    }
    case "SWITCH_ROUND_CONTROL": {
      if (state.round.buzzerWinner === "A") {
        state.round.buzzerWinner = "B";
        state.round.status = "locked";
      } else if (state.round.buzzerWinner === "B") {
        state.round.buzzerWinner = "A";
        state.round.status = "locked";
      }
      break;
    }
    case "CLEAR_ROUND_CONTROL": {
      state.round.buzzerWinner = null;
      state.round.status = "buzz-open";
      break;
    }
    case "RESET_ROUND": {
      resetRoundInternals();
      break;
    }
    case "TOGGLE_REVEAL": {
      const answerIndex = Number(payload.answerIndex);
      if (!Number.isInteger(answerIndex) || answerIndex < 0) {
        break;
      }

      if (state.round.revealed.includes(answerIndex)) {
        state.round.revealed = state.round.revealed.filter((value) => value !== answerIndex);
      } else {
        state.round.revealed.push(answerIndex);
        emitSoundEvent("correct");
      }
      break;
    }
    case "ADD_SCORE": {
      const team = payload.team;
      const points = Number(payload.points) || 0;
      if (team !== "A" && team !== "B") {
        break;
      }

      state.teams[team].score = Math.max(0, state.teams[team].score + points);
      if (payload.playTriumph === true) {
        emitSoundEvent("triunfo");
      }
      break;
    }
    case "ADD_STRIKE": {
      const team = payload.team;
      if (team !== "A" && team !== "B") {
        break;
      }

      state.teams[team].strikes = Math.max(0, (Number(state.teams[team].strikes) || 0) + 1);
      emitSoundEvent("incorrect");

      const controlTeam = state.round.buzzerWinner;
      if (state.teams[team].strikes >= 2 && (controlTeam === "A" || controlTeam === "B") && controlTeam === team) {
        state.ui.teamBackAlertTeam = controlTeam === "A" ? "B" : "A";
        state.ui.teamBackAlertVersion = (Number(state.ui.teamBackAlertVersion) || 0) + 1;
      }
      break;
    }
    case "SET_TEAM_NAME": {
      const team = payload.team;
      if (team !== "A" && team !== "B") {
        break;
      }

      const fallback = team === "A" ? "Equipo A" : "Equipo B";
      state.teams[team].name = normalizeTeamName(payload.name, fallback);
      break;
    }
    case "REGISTER_PLAYER": {
      const id = String(payload.id || "").trim();
      const team = payload.team;
      const name = String(payload.name || "").trim().slice(0, 32);
      if (!id || (team !== "A" && team !== "B") || !name) {
        break;
      }

      const existingIndex = state.players.findIndex((player) => player.id === id);
      const nextPlayer = { id, team, name, active: true };

      if (existingIndex >= 0) {
        state.players[existingIndex] = nextPlayer;
      } else {
        state.players.push(nextPlayer);
      }
      break;
    }
    case "SET_ROUND_CAPTAIN": {
      const team = payload.team;
      const playerId = String(payload.playerId || "").trim();
      if (team !== "A" && team !== "B") {
        break;
      }

      if (!playerId) {
        state.round.captains[team] = null;
        break;
      }

      const player = state.players.find((item) => item.id === playerId && item.active && item.team === team);
      if (!player) {
        break;
      }

      state.round.captains[team] = playerId;
      break;
    }
    case "SET_ROUND_MULTIPLIER": {
      const value = Number(payload.multiplier);
      if (![1, 2, 3].includes(value)) {
        break;
      }

      state.round.pointsMultiplier = value;
      break;
    }
    case "LOGOUT_PLAYER": {
      const id = String(payload.id || "").trim();
      if (!id) {
        break;
      }

      state.players = state.players.map((player) => {
        if (player.id !== id) {
          return player;
        }

        return {
          ...player,
          active: false,
        };
      });

      if (state.round.captains.A === id) {
        state.round.captains.A = null;
      }

      if (state.round.captains.B === id) {
        state.round.captains.B = null;
      }
      break;
    }
    case "LOGOUT_ALL_PLAYERS": {
      state.players = state.players.map((player) => ({
        ...player,
        active: false,
      }));
      state.round.captains.A = null;
      state.round.captains.B = null;
      state.ui.logoutAllVersion = (Number(state.ui.logoutAllVersion) || 0) + 1;
      break;
    }
    case "TOGGLE_QR": {
      if (typeof payload.value === "boolean") {
        state.ui.showQr = payload.value;
      } else {
        state.ui.showQr = !state.ui.showQr;
      }
      break;
    }
    case "SET_QUESTION_INDEX": {
      const nextIndex = Number(payload.index);
      if (!Number.isInteger(nextIndex)) {
        break;
      }

      state.round.questionIndex = clampQuestionIndex(nextIndex);
      resetRoundInternals();
      break;
    }
    case "NEXT_QUESTION": {
      const previousIndex = state.round.questionIndex;
      state.round.questionIndex = clampQuestionIndex(state.round.questionIndex + 1);
      if (state.round.questionIndex !== previousIndex) {
        emitSoundEvent("a_jugar");
      }
      resetRoundInternals();
      break;
    }
    case "PREV_QUESTION": {
      state.round.questionIndex = clampQuestionIndex(state.round.questionIndex - 1);
      resetRoundInternals();
      break;
    }
    case "SET_QUESTIONS": {
      const normalized = normalizeQuestions(payload.questions, state.questionTypes);
      if (!normalized.length) {
        break;
      }

      state.questions = normalized;
      state.round.questionIndex = clampQuestionIndex(state.round.questionIndex);
      resetRoundInternals();
      break;
    }
    case "UPSERT_QUESTION": {
      const index = Number(payload.index);
      const question = normalizeQuestions([payload.question], state.questionTypes)[0];
      if (!question) {
        break;
      }

      if (Number.isInteger(index) && index >= 0 && index < state.questions.length) {
        state.questions[index] = question;
      } else {
        state.questions.push(question);
      }

      state.round.questionIndex = clampQuestionIndex(state.round.questionIndex);
      break;
    }
    case "UPSERT_QUESTION_TYPE": {
      const id = String(payload.id || "").trim() || `type-${Date.now()}`;
      const name = String(payload.name || "").trim().slice(0, 40);
      const description = String(payload.description || "").trim().slice(0, 180);
      if (!name) {
        break;
      }

      const existingIndex = state.questionTypes.findIndex((item) => item.id === id);
      if (existingIndex >= 0) {
        state.questionTypes[existingIndex] = { id, name, description };
      } else {
        state.questionTypes.push({ id, name, description });
      }
      break;
    }
    case "DELETE_QUESTION_TYPE": {
      const id = String(payload.id || "").trim();
      if (!id || state.questionTypes.length <= 1) {
        break;
      }

      const fallbackTypeId = state.questionTypes.find((item) => item.id !== id)?.id;
      if (!fallbackTypeId) {
        break;
      }

      state.questionTypes = state.questionTypes.filter((item) => item.id !== id);
      state.questions = state.questions.map((question) => {
        if (question.typeId !== id) {
          return question;
        }

        return {
          ...question,
          typeId: fallbackTypeId,
        };
      });

      if (state.ui.activeQuestionTypeId === id) {
        state.ui.activeQuestionTypeId = fallbackTypeId;
        state.round.questionIndex = -1;
        resetRoundInternals();
      }
      break;
    }
    case "SET_ACTIVE_QUESTION_TYPE": {
      const id = String(payload.id || "").trim();
      if (!state.questionTypes.some((item) => item.id === id)) {
        break;
      }

      if (state.ui.activeQuestionTypeId !== id) {
        state.ui.activeQuestionTypeId = id;
        state.round.questionIndex = -1;
        state.round.status = "buzz-open";
        state.round.buzzerWinner = null;
        state.round.revealed = [];
        state.ui.teamBackAlertTeam = null;
      }
      break;
    }
    case "DELETE_QUESTION": {
      const index = Number(payload.index);
      if (!Number.isInteger(index) || index < 0 || index >= state.questions.length || state.questions.length === 1) {
        break;
      }

      state.questions.splice(index, 1);
      state.round.questionIndex = clampQuestionIndex(state.round.questionIndex);
      resetRoundInternals();
      break;
    }
    case "RESET_GAME": {
      state.teams.A.score = 0;
      state.teams.B.score = 0;
      state.round.questionIndex = -1;
      resetRoundInternals();
      break;
    }
    default:
      break;
  }
}

async function upsertRoomState(nextState) {
  if (!supabaseEnabled || !supabase) {
    return false;
  }

  const roomPayload = {
    ...nextState,
    questions: [],
  };

  const { error } = await supabase.from("game_rooms").upsert(
    {
      room_code: ROOM_CODE,
      state: roomPayload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "room_code" }
  );

  if (error) {
    return false;
  }

  return true;
}

async function upsertRoomStateWithRetry(nextState, attempts = 2) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const synced = await upsertRoomState(nextState);
    if (synced) {
      return true;
    }
  }

  return false;
}

async function loadRoomState() {
  if (!supabaseEnabled || !supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("game_rooms")
    .select("state")
    .eq("room_code", ROOM_CODE)
    .maybeSingle();

  if (error || !data?.state) {
    return null;
  }

  return data.state;
}

async function replaceQuestionsInSupabaseWithRetry(questions, attempts = 2) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const synced = await replaceQuestionsInSupabase(questions);
    if (synced) {
      return true;
    }
  }

  return false;
}

async function replaceQuestionTypesInSupabaseWithRetry(questionTypes, attempts = 2) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const synced = await replaceQuestionTypesInSupabase(questionTypes);
    if (synced) {
      return true;
    }
  }

  return false;
}

async function runRoomSyncCycle() {
  try {
    if (pendingQuestionTypesSync && state?.questionTypes) {
      const pushedQuestionTypes = await replaceQuestionTypesInSupabaseWithRetry(state.questionTypes);
      if (pushedQuestionTypes) {
        pendingQuestionTypesSync = false;
        setConnectionStatus("connected");
      }
    }

    if (pendingQuestionsSync && state?.questions) {
      const pushedQuestions = await replaceQuestionsInSupabaseWithRetry(state.questions);
      if (pushedQuestions) {
        pendingQuestionsSync = false;
        setConnectionStatus("connected");
      }
    }

    if (pendingRoomSync && state) {
      const pushed = await upsertRoomStateWithRetry(state);
      if (pushed) {
        pendingRoomSync = false;
        setConnectionStatus("connected");
      }
    }

    const remoteState = await loadRoomState();
    if (!remoteState) {
      return;
    }

    const nextState = validateState(remoteState, state?.questions || []);
    if (isRemoteStateNewer(nextState, state)) {
      state = nextState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      notifyOnly();
    }
  } catch {
    setConnectionStatus("disconnected");
  }
}

function startRoomStatePolling() {
  if (roomSyncInterval || !supabaseEnabled || !supabase) {
    return;
  }

  runRoomSyncCycle();

  roomSyncInterval = setInterval(async () => {
    runRoomSyncCycle();
  }, 1500);
}

async function loadQuestionsFromSupabase() {
  if (!supabaseEnabled || !supabase) {
    return null;
  }

  let { data, error } = await supabase
    .from("game_questions")
    .select("position,question,answers,type_id,display_order")
    .eq("room_code", ROOM_CODE)
    .order("position", { ascending: true });

  if (error) {
    const legacyResult = await supabase
      .from("game_questions")
      .select("position,question,answers")
      .eq("room_code", ROOM_CODE)
      .order("position", { ascending: true });

    data = legacyResult.data;
    error = legacyResult.error;
  }

  if (error) {
    return null;
  }

  const questions = (data || []).map((row, index) => ({
    id: `q${index + 1}`,
    question: row.question,
    typeId: row.type_id || undefined,
    displayOrder: Number.isInteger(Number(row.display_order)) ? Number(row.display_order) : index + 1,
    answers: Array.isArray(row.answers) ? row.answers : [],
  }));

  return normalizeQuestions(questions, state?.questionTypes || []);
}

async function loadQuestionTypesFromSupabase() {
  if (!supabaseEnabled || !supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("game_question_types")
    .select("id,name,description")
    .eq("room_code", ROOM_CODE)
    .order("name", { ascending: true });

  if (error) {
    return null;
  }

  return normalizeQuestionTypes(data || []);
}

async function replaceQuestionsInSupabase(questions) {
  if (!supabaseEnabled || !supabase) {
    return false;
  }

  const { error: deleteError } = await supabase.from("game_questions").delete().eq("room_code", ROOM_CODE);
  if (deleteError) {
    return false;
  }

  if (!questions.length) {
    return true;
  }

  const rows = questions.map((item, index) => ({
    room_code: ROOM_CODE,
    position: index,
    question: item.question,
    answers: item.answers,
    type_id: item.typeId || null,
    display_order: Number.isInteger(Number(item.displayOrder)) ? Number(item.displayOrder) : index + 1,
    updated_at: new Date().toISOString(),
  }));

  let { error: insertError } = await supabase.from("game_questions").insert(rows);
  if (insertError) {
    const legacyRows = rows.map(({ room_code, position, question, answers, updated_at }) => ({
      room_code,
      position,
      question,
      answers,
      updated_at,
    }));
    const legacyInsert = await supabase.from("game_questions").insert(legacyRows);
    insertError = legacyInsert.error;
  }
  if (insertError) {
    return false;
  }

  return true;
}

async function replaceQuestionTypesInSupabase(questionTypes) {
  if (!supabaseEnabled || !supabase) {
    return false;
  }

  const { error: deleteError } = await supabase.from("game_question_types").delete().eq("room_code", ROOM_CODE);
  if (deleteError) {
    return false;
  }

  const normalizedTypes = normalizeQuestionTypes(questionTypes);
  if (!normalizedTypes.length) {
    return true;
  }

  const rows = normalizedTypes.map((item) => ({
    room_code: ROOM_CODE,
    id: item.id,
    name: item.name,
    description: item.description || null,
    updated_at: new Date().toISOString(),
  }));

  const { error: insertError } = await supabase.from("game_question_types").insert(rows);
  if (insertError) {
    return false;
  }

  return true;
}

async function refreshQuestionsFromSupabase() {
  const questions = await loadQuestionsFromSupabase();
  if (!questions) {
    return false;
  }

  state.questions = questions;
  state.round.questionIndex = clampQuestionIndex(state.round.questionIndex);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  notifyOnly();
  return true;
}

async function refreshQuestionTypesFromSupabase() {
  const questionTypes = await loadQuestionTypesFromSupabase();
  if (!questionTypes) {
    return false;
  }

  state.questionTypes = questionTypes;
  if (!state.questionTypes.some((item) => item.id === state.ui?.activeQuestionTypeId)) {
    state.ui.activeQuestionTypeId = state.questionTypes[0]?.id || DEFAULT_QUESTION_TYPE_ID;
  }
  state.questions = normalizeQuestions(state.questions || [], state.questionTypes);
  state.round.questionIndex = clampQuestionIndex(state.round.questionIndex);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  notifyOnly();
  return true;
}

async function setupSupabase(defaultQuestions = []) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ROOM_CODE) {
    supabaseEnabled = false;
    setConnectionStatus("disconnected");
    return;
  }

  setConnectionStatus("connecting");
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  supabaseEnabled = true;

  let remoteState = await loadRoomState();
  if (!remoteState) {
    const seededRoom = await upsertRoomStateWithRetry(validateState(state, defaultQuestions));
    if (!seededRoom) {
      pendingRoomSync = true;
    }
    remoteState = await loadRoomState();
  }

  if (remoteState) {
    state = validateState(remoteState, defaultQuestions);
    persistAndNotify(false);
    setConnectionStatus("connected");
  } else {
    setConnectionStatus("disconnected");
  }

  const questionTypesFromTable = await loadQuestionTypesFromSupabase();
  if (questionTypesFromTable && questionTypesFromTable.length) {
    state.questionTypes = questionTypesFromTable;
    if (!state.questionTypes.some((item) => item.id === state.ui?.activeQuestionTypeId)) {
      state.ui.activeQuestionTypeId = state.questionTypes[0]?.id || DEFAULT_QUESTION_TYPE_ID;
    }
  } else {
    const seededTypes = await replaceQuestionTypesInSupabaseWithRetry(state.questionTypes || []);
    if (!seededTypes) {
      pendingQuestionTypesSync = true;
      setConnectionStatus("disconnected");
    }
  }
  state.questions = normalizeQuestions(state.questions || [], state.questionTypes || []);

  const questionsFromTable = await loadQuestionsFromSupabase();
  if (questionsFromTable && questionsFromTable.length) {
    state.questions = questionsFromTable;
  } else {
    const seeded = await replaceQuestionsInSupabaseWithRetry(state.questions);
    if (!seeded) {
      pendingQuestionsSync = true;
      setConnectionStatus("disconnected");
    }
  }
  persistAndNotify(false);

  if (!realtimeChannel) {
    realtimeChannel = supabase
      .channel(`room-${ROOM_CODE}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_rooms",
          filter: `room_code=eq.${ROOM_CODE}`,
        },
        (payload) => {
          const nextState = validateState(payload?.new?.state, state?.questions || []);
          if (isRemoteStateNewer(nextState, state)) {
            state = nextState;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            notifyOnly();
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnectionStatus("connected");
          return;
        }

        if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionStatus("disconnected");
        }
      });
  }

  if (!questionsRealtimeChannel) {
    questionsRealtimeChannel = supabase
      .channel(`questions-${ROOM_CODE}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_questions",
          filter: `room_code=eq.${ROOM_CODE}`,
        },
        async () => {
          const refreshed = await refreshQuestionsFromSupabase();
          if (!refreshed) {
            setConnectionStatus("disconnected");
          }
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionStatus("disconnected");
        }
      });
  }

  if (!questionTypesRealtimeChannel) {
    questionTypesRealtimeChannel = supabase
      .channel(`question-types-${ROOM_CODE}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_question_types",
          filter: `room_code=eq.${ROOM_CODE}`,
        },
        async () => {
          const refreshed = await refreshQuestionTypesFromSupabase();
          if (!refreshed) {
            setConnectionStatus("disconnected");
          }
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionStatus("disconnected");
        }
      });
  }

  startRoomStatePolling();
}

async function initializeStateAsync(defaultQuestions = []) {
  if (!state) {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    state = validateState(parsed, defaultQuestions);
    persistAndNotify(false);
  }

  setupChannel();

  try {
    await setupSupabase(defaultQuestions);
  } catch {
    supabaseEnabled = false;
    setConnectionStatus("disconnected");
  }

  return getState();
}

export function dispatch(action, payload = {}) {
  return dispatchAsync(action, payload);
}

async function dispatchAsync(action, payload = {}) {
  if (!state) {
    throw new Error("State no inicializado. Llama initializeState primero.");
  }

  if ((QUESTION_ACTIONS.has(action) || QUESTION_TYPE_ACTIONS.has(action)) && !supabaseEnabled) {
    throw new Error("No hay conexión con Base de Datos. No se puede guardar preguntas en modo local.");
  }

  if (supabaseEnabled && action === "LOCK_BUZZ") {
    const previousVersion = Number(state.stateVersion) || 0;
    const team = payload.team;
    if (team !== "A" && team !== "B") {
      return getState();
    }

    const { data, error } = await supabase.rpc("try_lock_buzzer", {
      p_room: ROOM_CODE,
      p_team: team,
    });

    if (!error && Array.isArray(data) && data.length) {
      const result = data[0];
      if (result?.state) {
        state = validateState(result.state, state.questions || []);
        if ((Number(state.stateVersion) || 0) <= previousVersion) {
          state.stateVersion = previousVersion + 1;
          await upsertRoomState(state);
        }
        persistAndNotify(true);
      }
      return getState();
    }

    setConnectionStatus("disconnected");
  }

  const previousState = clone(state);

  state.stateVersion = (Number(state.stateVersion) || 0) + 1;
  applyActionLocal(action, payload);

  if (QUESTION_ACTIONS.has(action) && supabaseEnabled) {
    const questionsSynced = await replaceQuestionsInSupabaseWithRetry(state.questions);
    if (!questionsSynced) {
      pendingQuestionsSync = true;
      setConnectionStatus("disconnected");
      persistAndNotify(true);
      throw new Error("No se pudo guardar preguntas/respuestas en Base de Datos. Se reintentará automáticamente.");
    }

    pendingQuestionsSync = false;
  }

  if (QUESTION_TYPE_ACTIONS.has(action) && supabaseEnabled) {
    const questionTypesSynced = await replaceQuestionTypesInSupabaseWithRetry(state.questionTypes || []);
    if (!questionTypesSynced) {
      pendingQuestionTypesSync = true;
      setConnectionStatus("disconnected");
      persistAndNotify(true);
      throw new Error("No se pudo guardar tipos de preguntas en Base de Datos. Se reintentará automáticamente.");
    }

    pendingQuestionTypesSync = false;

    if (action === "DELETE_QUESTION_TYPE") {
      const questionsSyncedAfterTypeDelete = await replaceQuestionsInSupabaseWithRetry(state.questions || []);
      if (!questionsSyncedAfterTypeDelete) {
        pendingQuestionsSync = true;
        setConnectionStatus("disconnected");
        persistAndNotify(true);
        throw new Error("No se pudieron actualizar preguntas después de eliminar el tipo. Se reintentará automáticamente.");
      }

      pendingQuestionsSync = false;
    }
  }

  if (supabaseEnabled) {
    const synced = await upsertRoomStateWithRetry(state);
    if (!synced) {
      setConnectionStatus("disconnected");
      pendingRoomSync = true;
      if (QUESTION_ACTIONS.has(action)) {
        state = previousState;
        persistAndNotify(true);
        throw new Error("No se pudo guardar en Base de Datos. Verifica conexión y permisos.");
      }
      persistAndNotify(true);
      return getState();
    }

    pendingRoomSync = false;
    setConnectionStatus("connected");
  }

  persistAndNotify(true);
  return getState();
}
