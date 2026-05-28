import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://xtjvnnpofngocnpafbsm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0anZubnBvZm5nb2NucGFmYnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Nzc1MDUsImV4cCI6MjA5NTQ1MzUwNX0.0B7AUJiRpV2HlwmYjQemIHzda0OV-DikAuIcpqtMLEo";
const PROGRAM_TABLE = "program_state";
const ADMIN_TABLE = "admin_users";
const PROGRAM_ROW_ID = "main";
const SUPABASE_AUTH_SCOPE = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: false,
};
const RESERVED_PUBLIC_SLUGS = new Set(["admin-inlog", "deelnemers", "deelnemers.html", "api", "index.html"]);

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: SUPABASE_AUTH_SCOPE,
});

const APP_MODE = location.pathname.toLowerCase().startsWith("/admin-inlog") ? "admin" : "participant";
const PUBLIC_TOURNAMENT_SLUG = APP_MODE === "participant" ? getParticipantRouteSlug() : "";

document.body.classList.toggle("participant-mode", APP_MODE === "participant");
document.body.classList.toggle("admin-mode", APP_MODE !== "participant");
document.title = APP_MODE === "participant" ? "Toernooimaker - Deelnemers" : "Toernooimaker - Admin";

function todayISODate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function formatProgramDateLabel(value) {
  if (!validDate(value)) return "Datum onbekend";
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

const defaultState = () => ({
  id: "tournament-1",
  slug: "",
  nextId: 1,
  updatedAt: 0,
  settings: {
    name: "Mijn toernooi",
    format: "groups",
    date: todayISODate(),
    teamCount: 16,
    groupCount: 4,
    advancePerGroup: 2,
    doubleRound: false,
    leagueMatches: 8,
    playoffEnabled: true,
    directQualifiers: 8,
    playoffQualifiers: 16,
    startTime: "09:00",
    endTime: "17:00",
    matchDuration: 20,
    breakDuration: 5,
    fieldCount: 1,
    fieldStart: 1,
    doubleKnockoutEnabled: false,
  },
  teams: Array.from({ length: 16 }, (_, index) => ({
    id: `team-${index + 1}`,
    name: `Team ${index + 1}`,
  })),
  tournament: null,
  activeView: "matches",
  selectedTeamId: "team-1",
  locked: false,
  doubleKnockoutView: "winners",
  tieTimeOverrides: {},
});

function defaultProgramState() {
  return {
    version: 2,
    updatedAt: 0,
    nextTournamentId: 2,
    activeTournamentId: "tournament-1",
    tournaments: [defaultState()],
  };
}

function slugifyTournamentName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " en ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function getParticipantRouteSlug(pathname = location.pathname) {
  const normalized = String(pathname || "").trim().toLowerCase();
  if (!normalized || normalized === "/" || normalized === "/index.html" || normalized === "/deelnemers.html") {
    return "";
  }

  const trimmed = normalized.replace(/^\/+|\/+$/g, "");
  const [firstSegment] = trimmed.split("/");
  if (!firstSegment || RESERVED_PUBLIC_SLUGS.has(firstSegment)) {
    return "";
  }

  try {
    return decodeURIComponent(firstSegment);
  } catch {
    return firstSegment;
  }
}

function getTournamentSlug(name, tournamentId, tournaments = program.tournaments) {
  let base = slugifyTournamentName(name) || `toernooi-${String(tournamentId || "").replace(/[^a-z0-9]+/gi, "-") || "1"}`;
  if (RESERVED_PUBLIC_SLUGS.has(base)) {
    base = `toernooi-${base}`;
  }
  let slug = base;
  let counter = 2;
  while (RESERVED_PUBLIC_SLUGS.has(slug) || tournaments.some((tournament) => tournament.id !== tournamentId && tournament.slug === slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
}

function syncTournamentSlugFromName(tournament = state) {
  if (!tournament) return;
  tournament.slug = getTournamentSlug(tournament.settings?.name, tournament.id, program.tournaments);
}

function ensureTournamentSlugs(tournaments = program.tournaments) {
  tournaments.forEach((tournament, index) => {
    if (!tournament) return;
    const baseName = tournament.settings?.name || `Toernooi ${index + 1}`;
    tournament.slug = getTournamentSlug(tournament.slug || baseName, tournament.id, tournaments);
  });
  return tournaments;
}

function getTournamentPublicPath(tournament) {
  return `/${encodeURIComponent(tournament?.slug || "")}`;
}

function getParticipantTournament(programState = program) {
  const tournaments = Array.isArray(programState.tournaments) ? programState.tournaments : [];
  if (PUBLIC_TOURNAMENT_SLUG) {
    return tournaments.find((tournament) => tournament.slug === PUBLIC_TOURNAMENT_SLUG) || (tournaments.length === 1 ? tournaments[0] : null);
  }
  if (tournaments.length === 1) {
    return tournaments[0];
  }
  return null;
}

let program = defaultProgramState();
let state = getActiveTournamentState(program);
let currentSchedule = new Map();
let validationReport = null;
let adminSession = null;
let authBusy = false;
let authNotice = null;
let remoteReady = false;
let remoteRevision = 0;
let remoteSubscription = null;
let saveTimer = null;
let applyingRemoteState = false;

const elements = {
  setupPanel: document.querySelector(".setup-panel"),
  appShell: document.querySelector(".app-shell"),
  authPanel: document.querySelector("#authPanel"),
  authForm: document.querySelector("#authForm"),
  authStatus: document.querySelector("#authStatus"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword"),
  authSignIn: document.querySelector("#authSignIn"),
  authSignOut: document.querySelector("#authSignOut"),
  tournamentPicker: document.querySelector("#tournamentPicker"),
  addTournamentButton: document.querySelector("#addTournamentButton"),
  duplicateTournamentButton: document.querySelector("#duplicateTournamentButton"),
  deleteTournamentButton: document.querySelector("#deleteTournamentButton"),
  tournamentName: document.querySelector("#tournamentName"),
  tournamentDate: document.querySelector("#tournamentDate"),
  teamCount: document.querySelector("#teamCount"),
  startTime: document.querySelector("#startTime"),
  endTime: document.querySelector("#endTime"),
  matchDuration: document.querySelector("#matchDuration"),
  breakDuration: document.querySelector("#breakDuration"),
  fieldCount: document.querySelector("#fieldCount"),
  fieldStart: document.querySelector("#fieldStart"),
  doubleKnockoutEnabled: document.querySelector("#doubleKnockoutEnabled"),
  groupCount: document.querySelector("#groupCount"),
  advancePerGroup: document.querySelector("#advancePerGroup"),
  doubleRound: document.querySelector("#doubleRound"),
  leagueMatches: document.querySelector("#leagueMatches"),
  directQualifiers: document.querySelector("#directQualifiers"),
  playoffQualifiers: document.querySelector("#playoffQualifiers"),
  playoffEnabled: document.querySelector("#playoffEnabled"),
  randomizeLeagueButton: document.querySelector("#randomizeLeagueButton"),
  groupOptions: document.querySelector("#groupOptions"),
  leagueOptions: document.querySelector("#leagueOptions"),
  teamFields: document.querySelector("#teamFields"),
  generateButton: document.querySelector("#generateButton"),
  shuffleTeams: document.querySelector("#shuffleTeams"),
  planButton: document.querySelector("#planButton"),
  validateButton: document.querySelector("#validateButton"),
  programButton: document.querySelector("#programButton"),
  lockButton: document.querySelector("#lockButton"),
  newButton: document.querySelector("#newButton"),
  exportButton: document.querySelector("#exportButton"),
  importButton: document.querySelector("#importButton"),
  importFile: document.querySelector("#importFile"),
  workspaceFormat: document.querySelector("#workspaceFormat"),
  workspaceTitle: document.querySelector("#workspaceTitle"),
  viewTabs: document.querySelector("#viewTabs"),
  statusMessage: document.querySelector("#statusMessage"),
  planningResult: document.querySelector("#planningResult"),
  validationResult: document.querySelector("#validationResult"),
  tournamentContent: document.querySelector("#tournamentContent"),
};

async function loadProgramState() {
  try {
    const { data, error } = await supabase
      .from(PROGRAM_TABLE)
      .select("id,payload,updated_at")
      .eq("id", PROGRAM_ROW_ID)
      .maybeSingle();

    if (error) throw error;
    if (!data?.payload) return { program: defaultProgramState(), revision: 0 };

    const revision = Number(new Date(data.updated_at)) || Number(data.payload?.updatedAt) || 0;
    return {
      program: normalizeProgramState(data.payload),
      revision,
    };
  } catch {
    return { program: defaultProgramState(), revision: 0 };
  }
}

function normalizeProgramState(loaded) {
  const fresh = defaultProgramState();
  const tournaments = Array.isArray(loaded.tournaments) && loaded.tournaments.length
    ? loaded.tournaments.map((tournament, index) => normalizeTournamentState(tournament, tournament.id || `tournament-${index + 1}`))
    : fresh.tournaments;
  ensureTournamentSlugs(tournaments);
  const activeTournamentId = tournaments.some((tournament) => tournament.id === loaded.activeTournamentId)
    ? loaded.activeTournamentId
    : tournaments[0]?.id || fresh.activeTournamentId;

  return {
    ...fresh,
    ...loaded,
    activeTournamentId,
    nextTournamentId: Math.max(fresh.nextTournamentId, Number(loaded.nextTournamentId) || 0, tournaments.length + 1),
    tournaments,
  };
}

function linkMatchCollections(rounds, matches) {
  const byId = new Map();

  const register = (match) => {
    if (!match || !match.id) return null;
    const existing = byId.get(match.id);
    if (existing) {
      Object.assign(existing, match);
      return existing;
    }
    byId.set(match.id, match);
    return match;
  };

  const safeRounds = Array.isArray(rounds) ? rounds : [];
  const safeMatches = Array.isArray(matches) ? matches : [];

  const linkedRounds = safeRounds.map((round) => (Array.isArray(round) ? round.map(register).filter(Boolean) : []));
  safeMatches.forEach(register);

  const linkedMatches = [];
  linkedRounds.forEach((round) => {
    round.forEach((match) => {
      if (!linkedMatches.includes(match)) linkedMatches.push(match);
    });
  });
  safeMatches.forEach((match) => {
    const ref = match?.id ? byId.get(match.id) : null;
    if (ref && !linkedMatches.includes(ref)) linkedMatches.push(ref);
  });

  return { rounds: linkedRounds, matches: linkedMatches };
}

function normalizeGroupState(group) {
  const safeGroup = group || {};
  const linked = linkMatchCollections(safeGroup.rounds, safeGroup.matches);
  return {
    ...safeGroup,
    teamIds: Array.isArray(safeGroup.teamIds) ? safeGroup.teamIds.filter(Boolean) : [],
    rounds: linked.rounds,
    matches: linked.matches,
  };
}

function normalizeTournamentState(loaded, idFallback) {
  const fresh = defaultState();
  const teams = Array.isArray(loaded?.teams) && loaded.teams.length
    ? loaded.teams.map((team, index) => ({
        id: team?.id || `team-${index + 1}`,
        name: String(team?.name || "").trim() || `Team ${index + 1}`,
      }))
    : fresh.teams;
  const teamIds = Array.isArray(loaded?.teamIds) && loaded.teamIds.length
    ? loaded.teamIds.filter(Boolean)
    : teams.map((team) => team.id);
  const groups = Array.isArray(loaded?.groups) ? loaded.groups.map(normalizeGroupState) : [];
  const linkedMatches = linkMatchCollections(loaded?.rounds, loaded?.matches);
  return {
    ...fresh,
    ...loaded,
    id: idFallback || loaded?.id || fresh.id,
    slug: loaded?.slug || slugifyTournamentName(loaded?.settings?.name || idFallback || fresh.id),
    teams,
    teamIds,
    groups,
    rounds: linkedMatches.rounds,
    matches: linkedMatches.matches,
    playoff: loaded?.playoff || null,
    knockout: loaded?.knockout || null,
    activeView: loaded.activeView || fresh.activeView,
    locked: Boolean(loaded.locked),
    settings: {
      ...fresh.settings,
      ...(loaded.settings || {}),
      doubleKnockoutEnabled: Boolean(loaded.settings?.doubleKnockoutEnabled),
    },
    tieTimeOverrides: { ...(loaded.tieTimeOverrides || {}) },
    doubleKnockoutView: loaded.doubleKnockoutView === "losers" ? "losers" : "winners",
  };
}

function persist() {
  syncActiveTournamentToProgram();
  program.updatedAt = Date.now();
  state.updatedAt = program.updatedAt;
  if (!remoteReady || applyingRemoteState || APP_MODE === "participant") return;
  queueProgramSave();
}

function publishTournament() {
  persist();
}

function isEditingEnabled() {
  return APP_MODE !== "participant" && !state.locked;
}

function updateAuthUi() {
  if (!elements.authStatus) return;
  elements.authStatus.textContent = APP_MODE === "participant" ? "Alleen lezen" : "Beheerder";
  updateWriteGate();
}

function updateWriteGate() {
  if (APP_MODE === "participant") return;
  const canEdit = isEditingEnabled();
  document.body.classList.toggle("admin-readonly", !canEdit);

  const protectedControls = document.querySelectorAll(
    ".header-actions button, .header-actions select, .setup-panel input, .setup-panel select, .setup-panel textarea, .setup-panel button, .tournament-content input, .tournament-content select, .tournament-content textarea, .tournament-content button",
  );
  const alwaysEnabledIds = new Set(["lockButton", "programButton", "tournamentPicker"]);
  const alwaysEditableSelectors = [".score-input", ".winner-select", ".tie-start-input", ".double-knockout-tab"];

  protectedControls.forEach((control) => {
    if (control.closest(".view-tabs")) return;
    if (alwaysEnabledIds.has(control.id)) {
      control.disabled = false;
      return;
    }
    if (alwaysEditableSelectors.some((selector) => control.matches(selector))) {
      control.disabled = false;
      return;
    }
    control.disabled = !canEdit;
  });
}

function queueProgramSave() {
  if (APP_MODE === "participant") return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveProgramToServer();
  }, 250);
}

async function saveProgramToServer() {
  try {
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ program }),
    });

    if (!response.ok) {
      throw new Error(`Opslaan mislukt (${response.status})`);
    }

    const saved = await response.json();
    remoteRevision = Number(new Date(saved.updated_at)) || remoteRevision;
    showStatus("Wijzigingen opgeslagen.");
  } catch (error) {
    showStatus(`Opslaan mislukt. ${error?.message || "Controleer je verbinding."}`);
  }
}

function applyRemoteProgram(loadedProgram, revision = 0) {
  applyingRemoteState = true;
  try {
    program = normalizeProgramState(loadedProgram);
    state = getActiveTournamentState(program);
    remoteRevision = Math.max(remoteRevision, revision || 0, Number(program.updatedAt) || 0);
    normalizeSettings();
    renderAll();
  } finally {
    applyingRemoteState = false;
  }
}

async function refreshRemoteProgram() {
  if (remoteReady === false && APP_MODE !== "participant") return;
  try {
    const loaded = await loadProgramState();
    applyRemoteProgram(loaded.program, loaded.revision);
  } catch (error) {
    showStatus(`Servergegevens laden mislukt. ${error?.message || ""}`.trim());
  }
}

function subscribeToRemoteProgram() {
  if (remoteSubscription) {
    supabase.removeChannel(remoteSubscription);
  }

  remoteSubscription = supabase
    .channel("program-state-live")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: PROGRAM_TABLE,
        filter: `id=eq.${PROGRAM_ROW_ID}`,
      },
      (payload) => {
        const incoming = payload.new?.payload;
        if (!incoming) return;
        const revision = Number(new Date(payload.new?.updated_at)) || Number(incoming.updatedAt) || 0;
        if (revision && revision <= remoteRevision) return;
        applyRemoteProgram(incoming, revision);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        showStatus("Realtime verbinding actief.");
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        showStatus("Realtime verbinding hapert. We proberen opnieuw te verbinden.");
      }
    });
}

async function verifyAdminSession(session) {
  if (!session?.access_token) return false;
  try {
    const response = await fetch("/api/admin-status", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Beheercontrole mislukt (${response.status}).`);
    }
    const result = await response.json();
    return {
      isAdmin: Boolean(result?.isAdmin),
      user: result?.user || null,
    };
  } catch (error) {
    throw new Error(error?.message || "Beheercontrole mislukt.");
  }
}

async function syncAuthSession() {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data?.session || null;
    if (!session) {
      adminSession = null;
      updateAuthUi();
      return;
    }

    const access = await verifyAdminSession(session);
    adminSession = access.isAdmin ? session : null;
    if (!access.isAdmin) {
      authNotice = "Geen beheerrechten";
      showStatus("Deze account heeft geen beheerrechten.");
    }
    if (access.isAdmin) authNotice = null;
    updateAuthUi();
  } catch (error) {
    adminSession = null;
    authNotice = "Kan rechten niet controleren";
    showStatus(`Beheerrechten controleren mislukt. ${error?.message || ""}`.trim());
    updateAuthUi();
  }
}

async function bootstrapRemoteState() {
  if (APP_MODE === "participant") {
    const loaded = await loadProgramState();
    applyRemoteProgram(loaded.program, loaded.revision);
    remoteReady = true;
    subscribeToRemoteProgram();
    window.setTimeout(() => {
      void refreshRemoteProgram();
    }, 250);
    window.setTimeout(() => {
      void refreshRemoteProgram();
    }, 1000);
    return;
  }

  const loaded = await loadProgramState();
  applyRemoteProgram(loaded.program, loaded.revision);
  remoteReady = true;
  subscribeToRemoteProgram();
  updateAuthUi();
}

function getActiveTournamentState(programState = program) {
  if (APP_MODE === "participant" && PUBLIC_TOURNAMENT_SLUG) {
    const matchedTournament = getParticipantTournament(programState);
    if (matchedTournament) return matchedTournament;
  }

  const tournamentId = programState.activeTournamentId || programState.tournaments[0]?.id;
  return programState.tournaments.find((tournament) => tournament.id === tournamentId) || programState.tournaments[0] || defaultState();
}

function syncActiveTournamentToProgram() {
  const index = program.tournaments.findIndex((tournament) => tournament.id === state.id);
  if (index === -1) {
    program.tournaments.push(state);
    program.activeTournamentId = state.id;
  } else {
    program.tournaments[index] = state;
  }
  ensureTournamentSlugs(program.tournaments);
}

function createTournamentState(id, overrides = {}) {
  return normalizeTournamentState(
    {
      ...defaultState(),
      id,
      ...overrides,
    },
    id,
  );
}

function setActiveTournament(tournamentId) {
  syncActiveTournamentToProgram();
  program.activeTournamentId = tournamentId;
  state = getActiveTournamentState(program);
  state.activeView = state.settings.format === "groups" ? "matches" : "league";
  validationReport = null;
  normalizeSettings();
  showStatus(`Actief toernooi: ${state.settings.name || "onbekend"}.`);
  renderAll();
}

function setTournamentLock(locked) {
  state.locked = locked;
  syncActiveTournamentToProgram();
  persist();
  renderAll();
}

function toggleTournamentLock() {
  setTournamentLock(!state.locked);
  showStatus(state.locked ? "Toernooi vastgezet. Teamnamen en instellingen zijn nu geblokkeerd." : "Toernooi staat weer open om te bewerken.");
}

function addTournament() {
  syncActiveTournamentToProgram();
  const id = `tournament-${program.nextTournamentId}`;
  program.nextTournamentId += 1;
  const newTournament = createTournamentState(id, {
    settings: {
      ...defaultState().settings,
      name: `Toernooi ${program.tournaments.length + 1}`,
    },
  });
  ensureTournamentSlugs(program.tournaments);
  program.tournaments.push(newTournament);
  syncTournamentSlugFromName(newTournament);
  program.activeTournamentId = newTournament.id;
  state = newTournament;
  state.activeView = "program";
  state.locked = false;
  validationReport = null;
  persist();
  showStatus("Nieuw toernooi toegevoegd.");
  renderAll();
}

function duplicateTournament() {
  syncActiveTournamentToProgram();
  const id = `tournament-${program.nextTournamentId}`;
  program.nextTournamentId += 1;
  const copy = normalizeTournamentState(JSON.parse(JSON.stringify(state)), id);
  copy.id = id;
  copy.settings.name = `${state.settings.name} kopie`;
  copy.updatedAt = 0;
  program.tournaments.push(copy);
  ensureTournamentSlugs(program.tournaments);
  syncTournamentSlugFromName(copy);
  program.activeTournamentId = copy.id;
  state = copy;
  state.activeView = "program";
  state.locked = Boolean(state.locked);
  validationReport = null;
  persist();
  showStatus("Toernooi gekopieerd.");
  renderAll();
}

function deleteTournament() {
  if (program.tournaments.length <= 1) {
    showStatus("Er moet minstens één toernooi blijven bestaan.");
    return;
  }

  const index = program.tournaments.findIndex((tournament) => tournament.id === state.id);
  if (index === -1) return;

  program.tournaments.splice(index, 1);
  const fallback = program.tournaments[index] || program.tournaments[index - 1] || program.tournaments[0];
  program.activeTournamentId = fallback.id;
  state = fallback;
  state.activeView = "program";
  validationReport = null;
  persist();
  showStatus("Toernooi verwijderd.");
  renderAll();
}

function resetActiveTournament() {
  const fresh = createTournamentState(state.id, {
    settings: {
      ...defaultState().settings,
      name: state.settings.name || "Mijn toernooi",
    },
    id: state.id,
  });
  state = fresh;
  state.locked = false;
  const index = program.tournaments.findIndex((tournament) => tournament.id === fresh.id);
  if (index === -1) {
    program.tournaments.push(fresh);
  } else {
    program.tournaments[index] = fresh;
  }
  state.activeView = "program";
  validationReport = null;
  persist();
  showStatus("Actief toernooi gereset.");
  renderAll();
}

function makeId(prefix) {
  const id = `${prefix}-${state.nextId}`;
  state.nextId += 1;
  return id;
}

function clamp(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function teamName(teamId) {
  if (!teamId) return "Nog open";
  return state.teams.find((team) => team.id === teamId)?.name || "Onbekend team";
}

function validTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function parseTimeToMinutes(value) {
  const [hours, minutes] = (validTime(value) ? value : "09:00").split(":").map(Number);
  return hours * 60 + minutes;
}

function formatClock(totalMinutes) {
  const dayOffset = Math.floor(totalMinutes / 1440);
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = String(Math.floor(minutesInDay / 60)).padStart(2, "0");
  const minutes = String(minutesInDay % 60).padStart(2, "0");
  return `${hours}:${minutes}${dayOffset ? ` +${dayOffset}d` : ""}`;
}

function formatScheduleWindow(schedule) {
  if (!schedule) return "--:--";
  return `${formatClock(schedule.start)}-${formatClock(schedule.end)}`;
}

function formatInputTime(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return "";
  const minutesInDay = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  const hours = String(Math.floor(minutesInDay / 60)).padStart(2, "0");
  const minutes = String(minutesInDay % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatFieldLabel(schedule) {
  if (!schedule) return "Veld --";
  return `Veld ${schedule.displayField || schedule.field}`;
}

function getTieStartValue(tie, schedule) {
  const override = state.tieTimeOverrides?.[tie.id];
  const persisted = validTime(override) ? override : validTime(tie.manualStart) ? tie.manualStart : null;
  return persisted || (schedule ? formatInputTime(schedule.start) : "");
}

function renderScheduleSlot(schedule, className) {
  return `
    <div class="${className}">
      <time class="${className === "tie-slot" ? "tie-time" : "match-time"}">${formatScheduleWindow(schedule)}</time>
      <span class="field-label">${formatFieldLabel(schedule)}</span>
    </div>
  `;
}

function renderPlanningResult() {
  const plan = state.planningAdvice;
  if (!plan) {
    elements.planningResult.hidden = true;
    elements.planningResult.innerHTML = "";
    return;
  }

  const fitClass = plan.fits ? "ok" : "warn";
  const fitLabel = plan.fits ? "Past binnen de eindtijd" : "Past niet binnen de eindtijd";
  elements.planningResult.hidden = false;
  elements.planningResult.innerHTML = `
    <strong>Planning advies</strong>
    <div class="${fitClass}">${fitLabel}</div>
    <div>${escapeHtml(plan.summary)}</div>
    <div>${escapeHtml(plan.details)}</div>
    ${plan.leagueSummary ? `<div>${escapeHtml(plan.leagueSummary)}</div>` : ""}
  `;
}

function renderValidationResult() {
  if (!elements.validationResult) return;

  if (!validationReport) {
    elements.validationResult.hidden = true;
    elements.validationResult.innerHTML = "";
    return;
  }

  const report = validationReport;
  const stale = report.sourceUpdatedAt !== state.updatedAt;
  const toneClass = report.errors.length ? "error" : report.warnings.length ? "warn" : "ok";
  const toneLabel = report.errors.length
    ? `${report.errors.length} fout${report.errors.length === 1 ? "" : "en"}`
    : report.warnings.length
      ? `${report.warnings.length} aandachtspunt${report.warnings.length === 1 ? "" : "en"}`
      : "Alles lijkt in orde";
  const issueList = [...report.errors, ...report.warnings];

  elements.validationResult.hidden = false;
  elements.validationResult.innerHTML = `
    <div class="validation-head">
      <strong>Toernooi controle</strong>
      <span class="validation-state ${toneClass}">${escapeHtml(toneLabel)}</span>
    </div>
    <div class="validation-summary">${escapeHtml(report.summary)}</div>
    <div class="validation-meta">Gecontroleerd op ${escapeHtml(new Date(report.checkedAt).toLocaleString("nl-NL"))}</div>
    ${stale ? `<div class="validation-stale">Let op: het toernooi is gewijzigd na deze controle. Klik opnieuw op <strong>Controleer toernooi</strong>.</div>` : ""}
    ${issueList.length
      ? `<div class="validation-list">
          ${issueList
            .map(
              (item) => `
                <div class="validation-item ${item.level}">
                  <strong>${escapeHtml(item.title)}</strong>
                  <div>${escapeHtml(item.detail)}</div>
                </div>
              `,
            )
            .join("")}
        </div>`
      : `<div class="validation-ok">Geen onregelmatigheden gevonden in de huidige data.</div>`}
  `;
}

function clearPlanningAdvice() {
  state.planningAdvice = null;
  renderPlanningResult();
}

function clearValidationReport() {
  validationReport = null;
  renderValidationResult();
}

function addValidationIssue(report, level, title, detail) {
  const item = { level, title, detail };
  if (level === "error") {
    report.errors.push(item);
  } else {
    report.warnings.push(item);
  }
}

function isValidScoreValue(value) {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= 99);
}

function buildValidationReport() {
  const report = {
    checkedAt: Date.now(),
    sourceUpdatedAt: state.updatedAt,
    summary: "",
    errors: [],
    warnings: [],
  };

  const tournament = state.tournament;
  if (!tournament) {
    report.summary = "Er is nog geen toernooi om te controleren.";
    addValidationIssue(report, "warning", "Nog geen toernooi", "Maak eerst een toernooi aan om de punten, standen en planning te laten controleren.");
    return report;
  }

  const teamIds = Array.isArray(tournament.teamIds) && tournament.teamIds.length
    ? tournament.teamIds
    : state.teams.map((team) => team.id);
  const teamSet = new Set(teamIds);
  const expectedCounts = new Map();
  const pairCounts = new Map();
  let matches = [];

  if (tournament.format === "groups") {
    tournament.groups.forEach((group) => {
      group.matches.forEach((match, matchIndex) => {
        matches.push({
          ...match,
          groupName: group.name,
          matchLabel: `${group.name} - wedstrijd ${matchIndex + 1}`,
          teamIds: group.teamIds,
        });
      });
      const expectedPerTeam = (group.teamIds.length - 1) * (state.settings.doubleRound ? 2 : 1);
      group.teamIds.forEach((teamId) => expectedCounts.set(teamId, expectedPerTeam));
    });
  } else if (tournament.format === "league") {
    matches = tournament.matches.map((match) => ({ ...match, teamIds }));
    teamIds.forEach((teamId) => expectedCounts.set(teamId, tournament.matchesPerTeam));
  }

  let playedMatches = 0;
  let openMatches = 0;
  let totalGoals = 0;
  let distributedPoints = 0;
  const appearances = new Map(teamIds.map((teamId) => [teamId, 0]));

  matches.forEach((match, index) => {
    const contextLabel = tournament.format === "groups" ? match.matchLabel : `Wedstrijd ${index + 1}`;

    if (!teamSet.has(match.homeTeamId)) {
      addValidationIssue(report, "error", contextLabel, `Thuisteam ${teamName(match.homeTeamId)} hoort niet bij dit toernooi.`);
    }
    if (!teamSet.has(match.awayTeamId)) {
      addValidationIssue(report, "error", contextLabel, `Uitteam ${teamName(match.awayTeamId)} hoort niet bij dit toernooi.`);
    }
    if (match.homeTeamId && match.homeTeamId === match.awayTeamId) {
      addValidationIssue(report, "error", contextLabel, "Een team kan niet tegen zichzelf spelen.");
    }
    if (!isValidScoreValue(match.homeScore) || !isValidScoreValue(match.awayScore)) {
      addValidationIssue(report, "error", contextLabel, "Er staat een ongeldige score in een wedstrijd.");
    }

    const pairKey = [match.homeTeamId, match.awayTeamId].sort().join("|");
    pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);

    if (appearances.has(match.homeTeamId)) appearances.set(match.homeTeamId, appearances.get(match.homeTeamId) + 1);
    if (appearances.has(match.awayTeamId)) appearances.set(match.awayTeamId, appearances.get(match.awayTeamId) + 1);

    if (match.homeScore === null || match.awayScore === null) {
      openMatches += 1;
      return;
    }

    playedMatches += 1;
    totalGoals += match.homeScore + match.awayScore;
    distributedPoints += match.homeScore === match.awayScore ? 2 : 3;
  });

  const standings = calculateStandings(teamIds, matches);
  const tablePoints = standings.reduce((sum, row) => sum + row.points, 0);
  const tableMatches = standings.reduce((sum, row) => sum + row.played, 0);

  if (tablePoints !== distributedPoints) {
    addValidationIssue(report, "error", "Puntentelling", `De stand telt ${tablePoints} punten, maar op basis van de ingevulde uitslagen zouden dat ${distributedPoints} punten moeten zijn.`);
  }
  if (tableMatches !== playedMatches * 2) {
    addValidationIssue(report, "error", "Wedstrijdtelling", `De stand telt ${tableMatches} gespeelde teambeurten, maar er zijn ${playedMatches} volledig ingevulde wedstrijden.`);
  }

  standings.forEach((row) => {
    const expected = expectedCounts.get(row.teamId);
    if (typeof expected === "number" && row.played !== expected) {
      addValidationIssue(report, "warning", teamName(row.teamId), `Dit team heeft ${row.played} gespeelde wedstrijden, verwacht waren er ${expected}.`);
    }
    if (row.won + row.drawn + row.lost !== row.played) {
      addValidationIssue(report, "error", teamName(row.teamId), "De optelsom winst + gelijk + verlies klopt niet met het aantal gespeelde wedstrijden.");
    }
  });

  const expectedPairCount = tournament.format === "groups" ? (state.settings.doubleRound ? 2 : 1) : 1;
  for (const [pairKey, count] of pairCounts.entries()) {
    if (!pairKey || pairKey === "|") continue;
    if (count !== expectedPairCount) {
      addValidationIssue(report, "warning", "Dubbele koppeling", `De combinatie ${pairKey.replace("|", " tegen ")} komt ${count} keer voor, verwacht was ${expectedPairCount} keer.`);
    }
  }

  if (tournament.format === "groups") {
    const groupsComplete = areGroupMatchesComplete(tournament);
    if (tournament.knockout && !groupsComplete) {
      addValidationIssue(report, "error", "Poule en knock-out door elkaar", "Er staat al een knock-out klaar terwijl de poulefase nog niet af is.");
    }
  } else if (tournament.format === "league") {
    const leagueComplete = areLeagueMatchesComplete(tournament);
    if (!state.settings.playoffEnabled && tournament.playoff) {
      addValidationIssue(report, "warning", "Tussenronde uit", "De tussenronde staat uit, maar er staat nog wel een tussenronde klaar.");
    }
    if (!leagueComplete && (tournament.playoff || tournament.knockout)) {
      addValidationIssue(report, "error", "League en knock-out door elkaar", "Er staat al een knock-out of tussenronde klaar terwijl de leaguefase nog niet af is.");
    }
  }

  for (const bracket of [tournament.playoff, tournament.knockout].filter(Boolean)) {
    const seenTieIds = new Set();
    forEachBracketTie(bracket, ({ roundIndex, tie }) => {
      if (seenTieIds.has(tie.id)) {
        addValidationIssue(report, "error", "Dubbele bracketwedstrijd", `De bracketwedstrijd ${tie.id} staat dubbel in de planning.`);
      }
      seenTieIds.add(tie.id);

      if (tie.teamAId && !teamSet.has(tie.teamAId)) {
        addValidationIssue(report, "error", tie.id, `Team A (${teamName(tie.teamAId)}) hoort niet bij dit toernooi.`);
      }
      if (tie.teamBId && !teamSet.has(tie.teamBId)) {
        addValidationIssue(report, "error", tie.id, `Team B (${teamName(tie.teamBId)}) hoort niet bij dit toernooi.`);
      }
      if (tie.teamAId && tie.teamBId && tie.teamAId === tie.teamBId) {
        addValidationIssue(report, "error", tie.id, "Een bracketwedstrijd heeft hetzelfde team aan beide kanten.");
      }
      if (!isValidScoreValue(tie.scoreA) || !isValidScoreValue(tie.scoreB)) {
        addValidationIssue(report, "error", tie.id, "Er staat een ongeldige score in een bracketwedstrijd.");
      }
      if (scoresComplete(tie) && tie.scoreA === tie.scoreB && !tie.winnerOverride) {
        addValidationIssue(report, "warning", tie.id, "Deze bracketwedstrijd staat gelijk, maar er is nog geen winnaar gekozen.");
      }
      if (tie.winnerId && tie.winnerId !== tie.teamAId && tie.winnerId !== tie.teamBId) {
        addValidationIssue(report, "error", tie.id, "De ingevulde winnaar hoort niet bij deze bracketwedstrijd.");
      }
      if (roundIndex === 0 && !tie.teamAId && !tie.teamBId) {
        addValidationIssue(report, "warning", tie.id, "Deze eerste bracketwedstrijd heeft nog geen teams.");
      }
    });
  }

  const issueCount = report.errors.length + report.warnings.length;
  if (!matches.length && !tournament.knockout && !tournament.playoff) {
    report.summary = "Er staat nog niets ingevuld om te controleren.";
  } else if (issueCount === 0) {
    report.summary = `${teamIds.length} teams, ${matches.length} wedstrijden en geen onregelmatigheden gevonden.`;
  } else {
    report.summary = `${teamIds.length} teams, ${matches.length} wedstrijden en ${issueCount} aandachtspunt${issueCount === 1 ? "" : "en"} gevonden.`;
  }

  return report;
}

function runTournamentCheck() {
  validationReport = buildValidationReport();
  renderValidationResult();
  showStatus(
    validationReport.errors.length
      ? "Controle uitgevoerd, er zijn aandachtspunten."
      : validationReport.warnings.length
        ? "Controle uitgevoerd, er zijn waarschuwingen."
        : "Controle uitgevoerd, alles lijkt in orde.",
  );
}

function simulateSchedule(blocks, fields, startMinutes, matchDuration, breakDuration) {
  let currentTime = startMinutes;
  let waves = 0;
  let idleFieldSlots = 0;
  let totalMatches = 0;

  blocks.forEach((block) => {
    const waveSizes = splitEvenly(block.items.length, fields);
    waveSizes.forEach((waveSize) => {
      totalMatches += waveSize;
      idleFieldSlots += fields - waveSize;
      waves += 1;
      currentTime += matchDuration;
      currentTime += breakDuration;
    });
  });

  return {
    totalMatches,
    waves,
    idleFieldSlots,
    finishMinutes: waves ? currentTime - breakDuration : startMinutes,
  };
}

function splitEvenly(total, maxPerWave) {
  if (total <= 0) return [];
  const waves = Math.ceil(total / maxPerWave);
  const base = Math.floor(total / waves);
  const extra = total % waves;
  return Array.from({ length: waves }, (_, index) => base + (index < extra ? 1 : 0));
}

function findIdealFieldCount(blocks) {
  const startMinutes = parseTimeToMinutes(state.settings.startTime);
  const endMinutes = parseTimeToMinutes(state.settings.endTime);
  const matchDuration = state.settings.matchDuration;
  const breakDuration = state.settings.breakDuration;
  const maxFields = Math.max(1, Math.min(32, state.settings.teamCount));
  const availableMinutes = endMinutes - startMinutes;
  const targetFinish = startMinutes + Math.floor(availableMinutes * 0.88);

  const candidates = [];

  for (let fields = 1; fields <= maxFields; fields += 1) {
    const simulation = simulateSchedule(blocks, fields, startMinutes, matchDuration, breakDuration);
    const fits = simulation.finishMinutes <= endMinutes;
    const score = Math.abs(simulation.finishMinutes - targetFinish) + simulation.idleFieldSlots * 6;
    candidates.push({
      fields,
      fits,
      score,
      ...simulation,
    });
  }

  const fitting = candidates.filter((candidate) => candidate.fits);
  if (fitting.length) {
    fitting.sort((a, b) => a.score - b.score || b.fields - a.fields);
    return fitting[0];
  }

  candidates.sort((a, b) => a.finishMinutes - b.finishMinutes || a.idleFieldSlots - b.idleFieldSlots);
  return candidates[0];
}

function findIdealLeagueMatches() {
  const teamCount = state.settings.teamCount;
  const startMinutes = parseTimeToMinutes(state.settings.startTime);
  const endMinutes = parseTimeToMinutes(state.settings.endTime);
  const matchDuration = state.settings.matchDuration;
  const breakDuration = state.settings.breakDuration;
  const fields = Math.max(1, state.settings.fieldCount);
  const maxMatches = teamCount - 1;
  const matchesPerRound = Math.max(1, Math.floor(teamCount / 2));
  const availableMinutes = endMinutes - startMinutes;
  const targetFinish = startMinutes + Math.floor(availableMinutes * 0.88);
  const note = teamCount % 2 === 1 ? " Met een oneven aantal teams is er per ronde 1 team vrij." : "";

  const candidates = [];
  for (let leagueMatches = 1; leagueMatches <= maxMatches; leagueMatches += 1) {
    const waveCount = Math.ceil(matchesPerRound / fields);
    const roundDuration = waveCount * (matchDuration + breakDuration) - breakDuration;
    const finishMinutes = startMinutes + leagueMatches * roundDuration;
    const fits = finishMinutes <= endMinutes;
    const score = Math.abs(finishMinutes - targetFinish);
    candidates.push({ leagueMatches, finishMinutes, fits, score, matchesPerRound, note });
  }

  const fitting = candidates.filter((candidate) => candidate.fits);
  if (fitting.length) {
    fitting.sort((a, b) => a.score - b.score || b.leagueMatches - a.leagueMatches);
    return {
      supported: true,
      leagueMatches: fitting[0].leagueMatches,
      fits: true,
      finishMinutes: fitting[0].finishMinutes,
      matchesPerRound,
      note,
    };
  }

  candidates.sort((a, b) => a.finishMinutes - b.finishMinutes);
  return {
    supported: true,
    leagueMatches: candidates[0].leagueMatches,
    fits: false,
    finishMinutes: candidates[0].finishMinutes,
    matchesPerRound,
    note,
  };
}

function planTournamentSchedule() {
  if (state.locked) {
    showStatus("Zet het toernooi eerst op bewerken.");
    return;
  }
  const tournament = state.tournament;
  if (!tournament) {
    state.planningAdvice = {
      fits: false,
      summary: "Genereer eerst een toernooi.",
      details: "Daarna kan ik een planningadvies maken op basis van de echte wedstrijdstructuur.",
    };
    renderPlanningResult();
    persist();
    return;
  }

  const startMinutes = parseTimeToMinutes(state.settings.startTime);
  const endMinutes = parseTimeToMinutes(state.settings.endTime);
  if (endMinutes <= startMinutes) {
    state.planningAdvice = {
      fits: false,
      summary: "De eindtijd moet later zijn dan de starttijd.",
      details: "Kies een eindtijd die na de starttijd ligt.",
    };
    renderPlanningResult();
    persist();
    return;
  }

  const blocks = collectScheduledBlocks(tournament);
  const best = findIdealFieldCount(blocks);
  const leagueAdvice = state.settings.format === "league" ? findIdealLeagueMatches() : null;
  if (!best) {
    state.planningAdvice = {
      fits: false,
      summary: "Geen planning gevonden.",
      details: "Er kon geen bruikbare planning worden berekend.",
    };
    renderPlanningResult();
    persist();
    return;
  }

  if (best.fits) {
    state.settings.fieldCount = best.fields;
  }

  state.planningAdvice = {
    fits: best.fits,
    summary: best.fits
      ? `Aanbevolen: ${best.fields} velden en ${best.waves} tijdsblokken.`
      : `Zelfs met ${best.fields} velden past het schema niet binnen de eindtijd.`,
    details: best.fits
      ? `Geschatte eindtijd: ${formatClock(best.finishMinutes)}. Er blijven ongeveer ${Math.max(0, parseTimeToMinutes(state.settings.endTime) - best.finishMinutes)} minuten buffer over.`
      : `Geschatte eindtijd: ${formatClock(best.finishMinutes)}. Verleng de eindtijd of verkort de wedstrijdduur.`,
    leagueSummary:
      leagueAdvice && leagueAdvice.supported
        ? leagueAdvice.fits
          ? `Leaguefase advies: ${leagueAdvice.leagueMatches} wedstrijden per team (nu ${state.settings.leagueMatches}). Geschatte league-eindtijd: ${formatClock(leagueAdvice.finishMinutes)}.${leagueAdvice.note || ""}`
          : `Leaguefase advies: zelfs met het minst lange schema past een leaguefase van ${leagueAdvice.leagueMatches} wedstrijden per team niet binnen de eindtijd.${leagueAdvice.note || ""}`
        : leagueAdvice
          ? leagueAdvice.summary
          : null,
  };

  persist();
  renderAll();
}

function renderSetup() {
  if (APP_MODE === "participant" || !elements.setupPanel) return;
  normalizeSettings();
  renderTournamentPicker();
  const locked = Boolean(state.locked);
  elements.tournamentName.value = state.settings.name;
  elements.tournamentName.disabled = locked;
  if (elements.tournamentDate) {
    elements.tournamentDate.value = validDate(state.settings.date) ? state.settings.date : todayISODate();
    elements.tournamentDate.disabled = locked;
  }
  elements.teamCount.value = state.settings.teamCount;
  elements.teamCount.disabled = locked;
  elements.startTime.value = state.settings.startTime;
  elements.startTime.disabled = locked;
  elements.endTime.value = state.settings.endTime;
  elements.endTime.disabled = locked;
  elements.matchDuration.value = state.settings.matchDuration;
  elements.matchDuration.disabled = locked;
  elements.breakDuration.value = state.settings.breakDuration;
  elements.breakDuration.disabled = locked;
  elements.fieldCount.value = state.settings.fieldCount;
  elements.fieldCount.disabled = locked;
  if (elements.fieldStart) {
    elements.fieldStart.value = state.settings.fieldStart;
    elements.fieldStart.disabled = locked;
  }
  if (elements.doubleKnockoutEnabled) {
    elements.doubleKnockoutEnabled.checked = Boolean(state.settings.doubleKnockoutEnabled);
    elements.doubleKnockoutEnabled.disabled = locked;
  }
  elements.groupCount.value = state.settings.groupCount;
  elements.groupCount.disabled = locked;
  elements.advancePerGroup.value = state.settings.advancePerGroup;
  elements.advancePerGroup.disabled = locked;
  elements.doubleRound.checked = state.settings.doubleRound;
  elements.doubleRound.disabled = locked;
  elements.leagueMatches.value = state.settings.leagueMatches;
  elements.leagueMatches.disabled = locked;
  elements.playoffEnabled.checked = state.settings.playoffEnabled;
  elements.playoffEnabled.disabled = locked;
  elements.directQualifiers.value = state.settings.directQualifiers;
  elements.directQualifiers.disabled = locked;
  elements.playoffQualifiers.value = state.settings.playoffQualifiers;
  elements.playoffQualifiers.disabled = locked || !state.settings.playoffEnabled;
  if (elements.generateButton) elements.generateButton.disabled = locked;
  if (elements.shuffleTeams) elements.shuffleTeams.disabled = locked;
  if (elements.planButton) elements.planButton.disabled = locked;
  if (elements.validateButton) elements.validateButton.disabled = locked;
  if (elements.randomizeLeagueButton) elements.randomizeLeagueButton.disabled = locked;
  if (elements.lockButton) {
    elements.lockButton.textContent = locked ? "Bewerk toernooi" : "Toernooi vastzetten";
  }
  if (elements.programButton) {
    elements.programButton.hidden = false;
    elements.programButton.textContent = state.activeView === "program" ? "Terug naar toernooi" : "Programma";
  }

  document.querySelectorAll("[data-format]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.format === state.settings.format);
    button.disabled = locked;
  });

  elements.groupOptions.hidden = state.settings.format !== "groups";
  elements.leagueOptions.hidden = state.settings.format !== "league";
  renderTeamFields();
  renderPlanningResult();
  renderValidationResult();
}

function renderTournamentPicker() {
  if (!elements.tournamentPicker) return;

  elements.tournamentPicker.innerHTML = program.tournaments
    .map((tournament, index) => {
      const label = tournament.settings?.name?.trim() || `Toernooi ${index + 1}`;
      return `<option value="${escapeHtml(tournament.id)}" ${tournament.id === program.activeTournamentId ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
  elements.tournamentPicker.value = program.activeTournamentId || program.tournaments[0]?.id || "";
  elements.tournamentPicker.disabled = program.tournaments.length <= 1;
}

function renderTeamFields() {
  elements.teamFields.innerHTML = state.teams
    .map(
      (team, index) => `
        <label class="team-field">
          <span class="team-number">${index + 1}</span>
          <input class="team-input" data-team-id="${team.id}" type="text" value="${escapeHtml(team.name)}" autocomplete="off" ${state.locked ? "disabled" : ""} />
        </label>
      `,
    )
    .join("");
}

function renderTournament() {
  const tournament = state.tournament;
  const participantTournament = APP_MODE === "participant" ? getParticipantTournament(program) : tournament;
  const knockoutFocus = state.activeView === "knockout" && APP_MODE === "admin";
  const programFocus = state.activeView === "program" && APP_MODE === "admin";
  document.body.classList.toggle("knockout-focus", knockoutFocus);
  document.body.classList.toggle("program-focus", programFocus);
  if (elements.setupPanel) {
    elements.setupPanel.hidden = knockoutFocus || programFocus;
  }
  if (elements.appShell) {
    elements.appShell.classList.toggle("knockout-focus", knockoutFocus);
    elements.appShell.classList.toggle("program-focus", programFocus);
  }
  if (state.activeView === "program" && APP_MODE !== "participant") {
    elements.workspaceTitle.textContent = "Programma";
    elements.workspaceFormat.textContent = `${program.tournaments.length} toernooi${program.tournaments.length === 1 ? "" : "en"}`;
    renderTabs();
    elements.tournamentContent.innerHTML = renderProgramView();
    return;
  }

  if (APP_MODE === "participant") {
    if (!remoteReady) {
      state.activeView = "team";
      renderTabs();
      elements.workspaceTitle.textContent = "Toernooi laden";
      elements.workspaceFormat.textContent = "Even wachten op het schema";
      elements.tournamentContent.innerHTML = `
        <div class="empty-state">
          <div>
            <h3>Bezig met laden</h3>
            <p>Het schema en de standen worden opgehaald. Dat kan een ogenblik duren.</p>
          </div>
        </div>
      `;
      return;
    }

    state.activeView = "team";
    renderTabs();

    if (!program.tournaments.length) {
      elements.workspaceTitle.textContent = "Maak je toernooi";
      elements.workspaceFormat.textContent = "Geen schema";
      elements.tournamentContent.innerHTML = `
        <div class="empty-state">
          <div>
            <h3>Nog niets gepubliceerd</h3>
            <p>Er is nog geen toernooi beschikbaar. Ga naar de admin-pagina om een toernooi te maken.</p>
            <p><a class="inline-link" href="/admin-inlog">Naar admin</a></p>
          </div>
        </div>
      `;
      return;
    }

    const participantTournamentRecord = participantTournament;
    const participantTournamentData = participantTournamentRecord?.tournament || participantTournamentRecord;

    if (!participantTournamentRecord) {
      elements.workspaceTitle.textContent = "Toernooien";
      elements.workspaceFormat.textContent = `${program.tournaments.length} toernooi${program.tournaments.length === 1 ? "" : "en"}`;
      elements.tournamentContent.innerHTML = `
        <div class="empty-state">
          <div>
            <h3>Toernooi niet gevonden</h3>
            <p>De link die je opent hoort niet bij een bekend toernooi. Kies hieronder een geldig toernooi of ga terug naar het overzicht.</p>
            <p><a class="inline-link" href="/">Terug naar overzicht</a></p>
          </div>
        </div>
        ${renderParticipantDirectory()}
      `;
      return;
    }

    if (!PUBLIC_TOURNAMENT_SLUG && program.tournaments.length > 1) {
      elements.workspaceTitle.textContent = "Toernooien";
      elements.workspaceFormat.textContent = `${program.tournaments.length} toernooi${program.tournaments.length === 1 ? "" : "en"}`;
      elements.tournamentContent.innerHTML = renderParticipantDirectory();
      return;
    }

    currentSchedule = buildScheduleMap(participantTournamentData, participantTournamentRecord);
    elements.workspaceTitle.textContent = participantTournamentRecord.settings?.name || participantTournamentData?.name || "Maak je toernooi";
    elements.workspaceFormat.textContent = participantTournament
      ? participantTournamentData?.format === "groups"
        ? "Poules met knock-out"
        : "Leaguefase met knock-out"
      : "Geen schema";
    elements.tournamentContent.innerHTML = renderTeamView(participantTournamentData || participantTournamentRecord);
    return;
  }

  currentSchedule = buildScheduleMap(tournament);
  elements.workspaceTitle.textContent = tournament?.name || "Maak je toernooi";
  elements.workspaceFormat.textContent = tournament
    ? tournament.format === "groups"
      ? "Poules met knock-out"
      : "Leaguefase met knock-out"
    : "Geen schema";

  renderTabs();

  if (!tournament) {
    elements.tournamentContent.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>Nog geen schema</h3>
          <p>Vul links je teams en format in.</p>
        </div>
      </div>
    `;
    return;
  }

  if (tournament.format === "groups") {
    renderGroupTournament(tournament);
    return;
  }

  renderLeagueTournament(tournament);
}

function renderTabs() {
  const tournament = state.tournament;
  if (APP_MODE === "admin") {
    const tabs = [["program", "Programma"]];

    if (tournament) {
      tabs.push(
        ...(tournament.format === "groups"
          ? [
              ["matches", "Wedstrijden"],
              ["tables", "Standen"],
              ["knockout", "Knock-out"],
              ["team", "Team"],
            ]
          : [
              ["league", "Leaguefase"],
              ["knockout", "Knock-out"],
              ["team", "Team"],
            ]),
      );
    }

    if (!tabs.some(([view]) => view === state.activeView)) {
      state.activeView = "program";
    }

    elements.viewTabs.hidden = false;
    elements.viewTabs.innerHTML = tabs
      .map(
        ([view, label]) => `
          <button class="${state.activeView === view ? "is-active" : ""}" data-view="${view}" type="button">${label}</button>
        `,
      )
      .join("");
    return;
  }

  if (!tournament) {
    elements.viewTabs.innerHTML = "";
    elements.viewTabs.hidden = APP_MODE === "participant";
    return;
  }

  if (APP_MODE === "participant") {
    elements.viewTabs.innerHTML = "";
    elements.viewTabs.hidden = true;
    return;
  }

  elements.viewTabs.hidden = false;
  const tabs = [];
  tabs.push(
    ...(tournament.format === "groups"
      ? [
          ["matches", "Wedstrijden"],
          ["tables", "Standen"],
          ["knockout", "Knock-out"],
          ["team", "Team"],
        ]
      : [
          ["league", "Leaguefase"],
          ["knockout", "Knock-out"],
          ["team", "Team"],
        ]),
  );

  if (!tabs.some(([view]) => view === state.activeView)) {
    state.activeView = tabs[0][0];
  }

  elements.viewTabs.innerHTML = tabs
    .map(
      ([view, label]) => `
        <button class="${state.activeView === view ? "is-active" : ""}" data-view="${view}" type="button">${label}</button>
      `,
    )
    .join("");
}

function renderProgramTournamentCard(tournament, index) {
  const totalMatches = getTournamentMatchCount(tournament);
  const fieldStart = Number(tournament.settings?.fieldStart) || 1;
  const fieldEnd = fieldStart + Math.max(1, Number(tournament.settings?.fieldCount) || 1) - 1;
  const selected = tournament.id === program.activeTournamentId;
  const publicPath = getTournamentPublicPath(tournament);
  const dateLabel = formatProgramDateLabel(tournament.settings?.date);

  return `
    <article class="program-tournament ${selected ? "is-active" : ""}">
      <div>
        <strong>${escapeHtml(tournament.settings?.name?.trim() || `Toernooi ${index + 1}`)}</strong>
        <p>${escapeHtml(tournament.settings?.format === "groups" ? "Poules met knock-out" : "Leaguefase met knock-out")}</p>
        <p>${escapeHtml(dateLabel)}</p>
        <p><a class="inline-link" href="${escapeHtml(publicPath)}" target="_blank" rel="noreferrer">${escapeHtml(publicPath)}</a></p>
      </div>
      <div class="program-tournament-meta">
        <span>${totalMatches} wedstrijden</span>
        <span>Veld ${fieldStart}-${fieldEnd}</span>
      </div>
      <div class="button-row program-tournament-actions">
        <button class="secondary-button" data-action="switch-tournament" data-tournament-id="${escapeHtml(tournament.id)}" type="button">
          Openen
        </button>
        <a class="secondary-button" href="${escapeHtml(publicPath)}" target="_blank" rel="noreferrer">Open deelnemers</a>
      </div>
    </article>
  `;
}

function renderProgramSchedule(rows) {
  if (!rows.length) {
    return `
      <div class="empty-state compact">
        <div>
          <h3>Geen schema in programma</h3>
          <p>Maak eerst een of meer toernooien aan en genereer daar de schema's.</p>
        </div>
      </div>
    `;
  }

  const groups = [];
  rows.forEach((row) => {
    const key = row.date || "";
    const group = groups.find((item) => item.key === key);
    if (group) {
      group.rows.push(row);
    } else {
      groups.push({ key, rows: [row] });
    }
  });

  groups.sort((a, b) => {
    if (!a.key && !b.key) return 0;
    if (!a.key) return 1;
    if (!b.key) return -1;
    return a.key.localeCompare(b.key);
  });

  return `
    <div class="program-day-list">
      ${groups
        .map((group, dayIndex) => {
          const dayRows = group.rows.sort(
            (a, b) =>
              a.schedule.start - b.schedule.start ||
              a.schedule.displayField - b.schedule.displayField ||
              a.tournamentName.localeCompare(b.tournamentName, "nl"),
          );
          const title = formatProgramDateLabel(group.key);
          const tournamentsCount = new Set(dayRows.map((row) => row.tournamentId)).size;
          return `
            <section class="program-day-card">
              <div class="section-head program-day-head">
                <div>
                  <span class="eyebrow">Dag ${dayIndex + 1}</span>
                  <h3>${escapeHtml(title)}</h3>
                </div>
                <div class="section-actions">
                  <span class="stage-meta">${dayRows.length} wedstrijden · ${tournamentsCount} toernooi${tournamentsCount === 1 ? "" : "en"}</span>
                </div>
              </div>
              <div class="program-schedule-list">
                ${dayRows
                  .map(
                    (row) => `
                      <article class="program-schedule-row">
                        <div class="program-schedule-time">${escapeHtml(formatScheduleWindow(row.schedule))}</div>
                        <div class="program-schedule-field">Veld ${row.schedule.displayField || row.schedule.field}</div>
                        <div class="program-schedule-title">${escapeHtml(row.tournamentName)}</div>
                        <div class="program-schedule-detail">${escapeHtml(row.detail)}</div>
                      </article>
                    `,
                  )
                  .join("")}
              </div>
            </section>
          `;
        })
        .join("")}
    </div>
  `;
}

function summarizeProgramFields() {
  if (!program.tournaments.length) return "--";
  return program.tournaments
    .map((tournament) => {
      const start = Number(tournament.settings?.fieldStart) || 1;
      const count = Number(tournament.settings?.fieldCount) || 1;
      return `Veld ${start}-${start + count - 1}`;
    })
    .join(" / ");
}

function renderProgramView() {
  const programRows = collectProgramScheduleRows();
  const programDays = new Set(program.tournaments.map((tournament) => tournament.settings?.date).filter(Boolean)).size;
  const cards = program.tournaments
    .map((tournament, index) => renderProgramTournamentCard(tournament, index))
    .join("");

  return `
    <div class="program-overview">
      <div class="program-return-row">
        <button class="secondary-button" data-action="return-to-tournament" type="button">Terug naar toernooi</button>
      </div>
      <div class="admin-overview">
        <div class="admin-overview-grid">
          <article class="overview-card">
            <span>Toernooien</span>
            <strong>${program.tournaments.length}</strong>
            <small>Losse opzet per evenement</small>
          </article>
          <article class="overview-card">
            <span>Dagen</span>
            <strong>${program.tournaments.length ? programDays || 1 : 0}</strong>
            <small>Programma per datum gegroepeerd</small>
          </article>
          <article class="overview-card">
            <span>Geplande wedstrijden</span>
            <strong>${programRows.length}</strong>
            <small>Alles gecombineerd in tijdsvolgorde</small>
          </article>
          <article class="overview-card">
            <span>Actief toernooi</span>
            <strong>${escapeHtml(state.settings.name)}</strong>
            <small>${escapeHtml(state.settings.format === "groups" ? "Poules" : "Leaguefase")}</small>
          </article>
          <article class="overview-card">
            <span>Status</span>
            <strong>${state.locked ? "Vastgezet" : "Bewerkbaar"}</strong>
            <small>Teamnamen en instellingen ${state.locked ? "staan op slot" : "kunnen nog aangepast worden"}</small>
          </article>
        </div>
      </div>
      <div class="program-layout">
        <section class="stage-card program-card-list">
          <div class="section-head">
            <h3>Toernooien</h3>
            <div class="section-actions">
              <button class="secondary-button" data-action="toggle-lock" type="button">${state.locked ? "Bewerk toernooi" : "Toernooi vastzetten"}</button>
            </div>
          </div>
          <div class="program-tournament-list">${cards}</div>
        </section>
        <section class="stage-card program-schedule">
          <div class="section-head">
            <h3>Gecombineerd schema</h3>
          </div>
          ${renderProgramSchedule(programRows)}
        </section>
      </div>
    </div>
  `;
}

function renderParticipantDirectory() {
  if (!program.tournaments.length) {
    return `
      <div class="empty-state">
        <div>
          <h3>Nog niets gepubliceerd</h3>
          <p>Er zijn nog geen toernooien beschikbaar.</p>
        </div>
      </div>
    `;
  }

  const cards = program.tournaments
    .map((tournament, index) => {
      const totalMatches = getTournamentMatchCount(tournament);
      const fieldStart = Number(tournament.settings?.fieldStart) || 1;
      const fieldEnd = fieldStart + Math.max(1, Number(tournament.settings?.fieldCount) || 1) - 1;
      const publicPath = getTournamentPublicPath(tournament);
      const label = tournament.settings?.format === "groups" ? "Poules met knock-out" : "Leaguefase met knock-out";

      return `
        <article class="program-tournament">
          <div>
            <strong>${escapeHtml(tournament.settings?.name?.trim() || `Toernooi ${index + 1}`)}</strong>
            <p>${escapeHtml(label)}</p>
            <p><a class="inline-link" href="${escapeHtml(publicPath)}">${escapeHtml(publicPath)}</a></p>
          </div>
          <div class="program-tournament-meta">
            <span>${totalMatches} wedstrijden</span>
            <span>Veld ${fieldStart}-${fieldEnd}</span>
          </div>
          <div class="button-row program-tournament-actions">
            <a class="secondary-button" href="${escapeHtml(publicPath)}" target="_blank" rel="noreferrer">Open deelnemers</a>
          </div>
        </article>
      `;
    })
    .join("");

  return `
    <div class="program-overview">
      <div class="program-layout">
        <section class="stage-card program-card-list">
          <div class="section-head">
            <h3>Toernooien</h3>
            <div class="section-actions">
              <span>${program.tournaments.length} toernooi${program.tournaments.length === 1 ? "" : "en"}</span>
            </div>
          </div>
          <div class="program-tournament-list">${cards}</div>
        </section>
      </div>
    </div>
  `;
}

function renderGroupTournament(tournament) {
  const overview = APP_MODE === "admin" ? renderTournamentOverview(tournament) : "";
  const groups = Array.isArray(tournament.groups) ? tournament.groups : [];
  if (state.activeView === "team") {
    elements.tournamentContent.innerHTML = renderTeamView(tournament);
    return;
  }

  if (state.activeView === "tables") {
    elements.tournamentContent.innerHTML = `
      <div class="section-head">
        <h3>Standen</h3>
        <div class="section-actions">
          <button class="primary-button" data-action="generate-group-knockout" type="button">Genereer knock-out</button>
        </div>
      </div>
      <div class="table-grid">
        ${groups.map((group) => renderGroupTableCard(group, tournament.advancePerGroup)).join("")}
      </div>
    `;
    return;
  }

  if (state.activeView === "knockout") {
    elements.tournamentContent.innerHTML = renderGroupKnockout(tournament);
    return;
  }

  elements.tournamentContent.innerHTML = `
    ${overview}
    <div class="group-grid">
      ${groups.map(renderGroupMatchCard).join("")}
    </div>
  `;
}

function renderGroupMatchCard(group) {
  const rounds = Array.isArray(group?.rounds) ? group.rounds : [];
  const roundsMarkup = rounds
    .map(
      (round, index) => `
        <div class="round-block">
          <h4>Ronde ${index + 1}</h4>
          ${(Array.isArray(round) ? round : []).map(renderMatchRow).join("")}
        </div>
      `,
    )
    .join("");

  return `
    <article class="stage-card">
      <header>
        <h3>${escapeHtml(group?.name || "Poule")}</h3>
        <span class="stage-meta">${(group?.teamIds || []).length} teams</span>
      </header>
      <div class="round-list">${roundsMarkup}</div>
    </article>
  `;
}

function renderGroupTableCard(group, advancePerGroup) {
  const standings = calculateStandings(group?.teamIds || [], group?.matches || []);
  return `
    <article class="stage-card">
      <header>
        <h3>${escapeHtml(group?.name || "Poule")}</h3>
        <span class="stage-meta">Top ${advancePerGroup}</span>
      </header>
      ${renderStandingsTable(standings, {
        qualifies: (_, index) => index < advancePerGroup,
      })}
    </article>
  `;
}

function renderGroupKnockout(tournament) {
  if (!areGroupMatchesComplete(tournament)) {
    return `
      <div class="empty-state">
        <div>
          <h3>Poulefase nog bezig</h3>
          <p>De knock-out verschijnt pas zodra alle poulewedstrijden gespeeld zijn.</p>
        </div>
      </div>
    `;
  }

  if (!tournament.knockout) {
    return `
      <div class="empty-state">
        <div>
          <h3>Knock-out staat klaar</h3>
          <p>Maak hem vanuit de actuele poulestanden.</p>
          <div class="button-row">
            <button class="primary-button" data-action="generate-group-knockout" type="button">Genereer knock-out</button>
          </div>
        </div>
      </div>
    `;
  }

  return renderKnockoutDisplay(tournament.knockout, "Knock-out", "generate-group-knockout");
}

function renderLeagueTournament(tournament) {
  const overview = APP_MODE === "admin" ? renderTournamentOverview(tournament) : "";
  const rounds = Array.isArray(tournament.rounds) ? tournament.rounds : [];
  if (state.activeView === "team") {
    elements.tournamentContent.innerHTML = renderTeamView(tournament);
    return;
  }

  if (state.activeView === "knockout") {
    elements.tournamentContent.innerHTML = renderLeagueKnockout(tournament);
    return;
  }

  const standings = calculateStandings(tournament.teamIds || [], tournament.matches || []);
  elements.tournamentContent.innerHTML = `
    ${overview}
    <div class="split-layout">
      <section class="stage-card">
        <header>
          <h3>Leaguefase</h3>
          <span class="stage-meta">${tournament.matchesPerTeam} wedstrijden per team</span>
        </header>
        ${renderStandingsTable(standings, {
          league: true,
          direct: tournament.directQualifiers,
          playoff: tournament.playoffQualifiers,
        })}
      </section>
      <section class="match-section">
        ${renderLeagueRounds(rounds)}
      </section>
    </div>
  `;
}

function renderLeagueRounds(rounds) {
  const safeRounds = Array.isArray(rounds) ? rounds : [];
  if (!safeRounds.length) {
    return `
      <div class="empty-state compact">
        <div>
          <h3>Nog geen schema</h3>
          <p>Genereer eerst de leaguewedstrijden.</p>
        </div>
      </div>
    `;
  }

  return safeRounds
    .map(
      (round, index) => `
        <article class="stage-card">
          <header>
            <h3>Ronde ${index + 1}</h3>
            <span class="stage-meta">${Array.isArray(round) ? round.length : 0} wedstrijden</span>
          </header>
          <div class="round-list">${(Array.isArray(round) ? round : []).map(renderMatchRow).join("")}</div>
        </article>
      `,
    )
    .join("");
}

function renderLeagueKnockout(tournament) {
  const sections = [];
  const preview = getLeagueKnockoutPreview(tournament);
  const playoffEnabled = leaguePlayoffActive(tournament);
  const viewOnly = APP_MODE === "participant";
  const canManageStructure = APP_MODE !== "participant" && !state.locked;

  if (playoffEnabled) {
    sections.push(`
      <section>
        <div class="section-head">
          <h3>Tussenronde</h3>
          ${canManageStructure ? `<div class="section-actions"><button class="secondary-button" data-action="check-league-progress" type="button">Check wie er door is</button></div>` : ""}
        </div>
        ${
          tournament.playoff
            ? renderBracket(tournament.playoff, viewOnly ? { preview: true } : {})
            : renderBracketPreview(preview.playoff, !viewOnly)
        }
      </section>
    `);
  }

  sections.push(`
      <section>
        <div class="section-head">
          <h3>Eindfase</h3>
          ${canManageStructure ? `<div class="section-actions"><button class="primary-button" data-action="generate-league-finals" type="button">Genereer eindfase</button></div>` : ""}
        </div>
        ${
          tournament.knockout
            ? renderKnockoutDisplay(tournament.knockout, "Eindfase", "generate-league-finals", viewOnly)
            : renderKnockoutDisplay(preview.knockout, "Eindfase", "generate-league-finals", true)
        }
      </section>
    `);

  return `<div class="stack">${sections.join("")}</div>`;
}

function renderKnockoutDisplay(bracket, title, action, preview = false) {
  if (!bracket) return "";
  if (isDoubleKnockoutContainer(bracket)) {
    return renderDoubleKnockout(bracket, title, action, preview);
  }
  return renderBracketSection(bracket, title, action, preview);
}

function renderDoubleKnockout(container, title, action, preview = false) {
  if (!container.losers || APP_MODE === "participant") {
    const sections = [renderBracketBlock(container.winners, `${title} - Winnaars`, action, preview)];
    if (container.losers) {
      sections.push(renderBracketBlock(container.losers, `${title} - Verliezers`, action, preview));
    }
    return `<div class="stack double-knockout-stack">${sections.join("")}</div>`;
  }

  const activeView = container.losers && state.doubleKnockoutView === "losers" ? "losers" : "winners";
  const winnersActive = activeView === "winners";
  const losersActive = activeView === "losers" && Boolean(container.losers);

  return `
    <div class="double-knockout-tabs">
      <div class="double-knockout-tablist" role="tablist" aria-label="${escapeHtml(title)}">
        <button
          class="secondary-button double-knockout-tab ${winnersActive ? "is-active" : ""}"
          data-action="switch-double-knockout-view"
          data-double-knockout-view="winners"
          type="button"
        >
          Winnaars
        </button>
        <button
          class="secondary-button double-knockout-tab ${losersActive ? "is-active" : ""}"
          data-action="switch-double-knockout-view"
          data-double-knockout-view="losers"
          type="button"
        >
          Verliezers
        </button>
      </div>
      <div class="double-knockout-panels">
        <div class="double-knockout-panel ${winnersActive ? "is-active" : ""}">
          ${renderBracketBlock(container.winners, `${title} - Winnaars`, action, preview)}
        </div>
        <div class="double-knockout-panel ${losersActive ? "is-active" : ""}" ${container.losers ? "" : "hidden"}>
          ${container.losers ? renderBracketBlock(container.losers, `${title} - Verliezers`, action, preview) : ""}
        </div>
      </div>
    </div>
  `;
}

function renderBracketBlock(bracket, title, action, preview = false) {
  const viewOnly = preview || APP_MODE === "participant";
  const showAction = !preview && APP_MODE !== "participant" && !state.locked;
  return `
    <section>
      <div class="section-head">
        <h3>${escapeHtml(title)}</h3>
        ${showAction ? `<div class="section-actions"><button class="secondary-button" data-action="${action}" type="button">Opnieuw genereren</button></div>` : ""}
      </div>
      ${viewOnly ? renderBracketPreview(bracket, false) : renderBracket(bracket)}
    </section>
  `;
}

function renderBracketPreview(bracket, allowTimeEdit = false) {
  return renderBracket(bracket, { preview: true, allowTimeEdit });
}

function renderBracketMobile(bracket, options = {}) {
  if (!bracket) return "";
  const rounds = Array.isArray(bracket.rounds) ? bracket.rounds : [];
  if (!rounds.length) return "";

  return `
    <div class="bracket-mobile">
      <div class="bracket-mobile-rounds">
        ${rounds
          .map(
            (round, roundIndex) => `
              <section class="bracket-mobile-round">
                ${
                  options.preview
                    ? `<h3>${escapeHtml(round.name)}</h3>`
                    : `<label class="round-name-field bracket-round-label">
                        <span class="round-name-label">Ronde</span>
                        <input class="round-name-input" data-bracket-kind="${escapeHtml(options.bracketKind || "")}" data-round-index="${round.sourceRoundIndex ?? roundIndex}" type="text" value="${escapeHtml(round.name)}" />
                      </label>`
                }
                <div class="bracket-mobile-node-list">
                  ${round.ties.map((tie) => renderBracketNode(tie, options)).join("")}
                </div>
              </section>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderTeamView(tournament) {
  const selectedTeamId = ensureSelectedTeamId(tournament);
  const standingsContext = getTeamStandingsContext(tournament, selectedTeamId);
  const matches = getTeamScheduleItems(tournament, selectedTeamId);
  const spotlight = getTeamSpotlight(matches);
  const teamRow = standingsContext.standings.find((row) => row.teamId === selectedTeamId);
  const position = standingsContext.standings.findIndex((row) => row.teamId === selectedTeamId) + 1;

  return `
    <div class="team-view">
      ${renderTeamSpotlight(spotlight, matches)}
      <section class="team-overview">
        <label class="field team-select-field">
          <span>Kies team</span>
          <select id="participantTeamSelect" class="team-select">
            ${getTournamentTeamIds(tournament)
              .map(
                (teamId) => `
                  <option value="${teamId}" ${teamId === selectedTeamId ? "selected" : ""}>${escapeHtml(teamName(teamId))}</option>
                `,
              )
              .join("")}
          </select>
        </label>
        <div class="team-summary">
          <div>
            <span>Positie</span>
            <strong>${position || "-"}</strong>
          </div>
          <div>
            <span>Punten</span>
            <strong>${teamRow?.points ?? 0}</strong>
          </div>
          <div>
            <span>Gespeeld</span>
            <strong>${teamRow?.played ?? 0}</strong>
          </div>
          <div>
            <span>Doelsaldo</span>
            <strong>${teamRow?.goalDifference ?? 0}</strong>
          </div>
        </div>
      </section>

      <div class="team-view-grid">
        <section class="stage-card">
          <header>
            <h3>Schema en uitslagen</h3>
            <span class="stage-meta">${matches.length} wedstrijden</span>
          </header>
          <div class="team-match-list">
            ${matches.length ? matches.map((item) => renderTeamScheduleItem(item, selectedTeamId, { isNext: spotlight.next?.id === item.id })).join("") : renderNoTeamMatches()}
          </div>
        </section>

        <section class="stage-card">
          <header>
            <h3>${escapeHtml(standingsContext.title)}</h3>
            <span class="stage-meta">${escapeHtml(teamName(selectedTeamId))}</span>
          </header>
          ${renderStandingsTable(standingsContext.standings, {
            ...standingsContext.options,
            selectedTeamId,
          })}
        </section>
      </div>
    </div>
  `;
}

function renderNoTeamMatches() {
  return `
    <div class="team-empty">
      <strong>Nog geen wedstrijden zichtbaar</strong>
      <span>Genereer het schema of de knock-outfase om meer wedstrijden te zien.</span>
    </div>
  `;
}

function renderTournamentOverview(tournament) {
  const overview = getTournamentOverview(tournament);
  return `
    <section class="admin-overview">
      <div class="admin-overview-grid">
        <article class="overview-card">
          <span>Wedstrijden</span>
          <strong>${overview.completed}/${overview.total}</strong>
          <small>${overview.remaining} open</small>
        </article>
        <article class="overview-card">
          <span>Planning</span>
          <strong>${overview.start} - ${overview.finish}</strong>
          <small>${overview.fields} velden</small>
        </article>
        <article class="overview-card">
          <span>Fase</span>
          <strong>${escapeHtml(overview.phase)}</strong>
          <small>${escapeHtml(overview.playoff)}</small>
        </article>
        <article class="overview-card">
          <span>Voortgang</span>
          <strong>${overview.percent}%</strong>
          <small>${overview.status}</small>
        </article>
      </div>
    </section>
  `;
}

function getTournamentOverview(tournament) {
  const matches = tournament
    ? tournament.format === "groups"
      ? (Array.isArray(tournament.groups) ? tournament.groups : []).flatMap((group) => group.matches || [])
      : Array.isArray(tournament.matches)
        ? tournament.matches
        : []
    : [];
  const completed = matches.filter((match) => match.homeScore !== null && match.awayScore !== null).length;
  const total = matches.length;
  const scheduleEntries = [...currentSchedule.values()].sort((a, b) => a.start - b.start);
  const first = scheduleEntries[0];
  const last = scheduleEntries.at(-1);
  const phase = tournament
    ? tournament.format === "groups"
      ? "Poules"
      : "Leaguefase"
    : "Geen schema";
  const playoff = tournament
    ? tournament.format === "league"
      ? state.settings.playoffEnabled
        ? "Tussenronde aan"
        : "Tussenronde uit"
      : areGroupMatchesComplete(tournament)
        ? "Knock-out mogelijk"
        : "Knock-out nog niet vrij"
    : "";

  return {
    completed,
    total,
    remaining: Math.max(0, total - completed),
    start: first ? formatClock(first.start) : state.settings.startTime,
    finish: last ? formatClock(last.end) : state.settings.endTime,
    fields: state.settings.fieldCount,
    phase,
    playoff,
    percent: total ? Math.round((completed / total) * 100) : 0,
    status:
      total === 0
        ? "Nog geen wedstrijden"
        : completed === total
          ? "Alles gespeeld"
          : `${completed} van ${total} gespeeld`,
  };
}

function getTeamSpotlight(items) {
  const next = items.find((item) => item.scoreText === "Nog geen uitslag") || null;
  const last = [...items].reverse().find((item) => item.scoreText !== "Nog geen uitslag") || null;
  const completed = items.filter((item) => item.scoreText !== "Nog geen uitslag").length;
  return {
    next,
    last,
    completed,
    total: items.length,
    pending: Math.max(0, items.length - completed),
  };
}

function renderTeamSpotlight(spotlight, items) {
  return `
    <section class="team-spotlight">
      <article class="spotlight-card">
        <span>Volgende wedstrijd</span>
        ${spotlight.next ? renderSpotlightItem(spotlight.next) : `<strong>Nog niets gepland</strong><p>Geen volgende wedstrijd zichtbaar.</p>`}
      </article>
      <article class="spotlight-card">
        <span>Laatste uitslag</span>
        ${spotlight.last ? renderSpotlightItem(spotlight.last) : `<strong>Nog geen uitslag</strong><p>Zodra er een wedstrijd gespeeld is, verschijnt die hier.</p>`}
      </article>
      <article class="spotlight-card">
        <span>Voortgang</span>
        <strong>${spotlight.completed}/${spotlight.total}</strong>
        <p>${spotlight.pending} wedstrijden wachten nog op uitslag.</p>
      </article>
    </section>
  `;
}

function renderSpotlightItem(item) {
  const schedule = currentSchedule.get(`${item.type}:${item.id}`);
  return `
    <div class="spotlight-item">
      <div class="spotlight-time">${escapeHtml(schedule ? formatScheduleWindow(schedule) : "--:--")}</div>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
      <div class="team-result ${item.resultClass}">
        <span>${escapeHtml(item.scoreText)}</span>
        <strong>${escapeHtml(item.resultLabel)}</strong>
      </div>
    </div>
  `;
}

function renderTeamScheduleItem(item, selectedTeamId, options = {}) {
  const schedule = currentSchedule.get(`${item.type}:${item.id}`);
  return `
    <article class="team-match-card ${options.isNext ? "is-next" : ""}">
      ${renderScheduleSlot(schedule, "match-slot")}
      <div class="team-match-main">
        <div class="team-match-stage">${escapeHtml(item.stageLabel)}</div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.detail)}</span>
      </div>
      <div class="team-result ${item.resultClass}">
        <span>${escapeHtml(item.scoreText)}</span>
        <strong>${escapeHtml(item.resultLabel)}</strong>
      </div>
    </article>
  `;
}

function getTournamentTeamIds(tournament) {
  if (!tournament) return state.teams.map((team) => team.id);
  const fallbackTeamIds = (Array.isArray(tournament.teams) ? tournament.teams : state.teams).map((team) => team.id);
  if (tournament.format === "league") {
    return Array.isArray(tournament.teamIds) && tournament.teamIds.length ? tournament.teamIds : fallbackTeamIds;
  }
  const groups = Array.isArray(tournament.groups) ? tournament.groups : [];
  return groups.length ? groups.flatMap((group) => group.teamIds || []) : fallbackTeamIds;
}

function ensureSelectedTeamId(tournament = state.tournament) {
  const teamIds = getTournamentTeamIds(tournament);
  if (!teamIds.includes(state.selectedTeamId)) {
    state.selectedTeamId = teamIds[0] || null;
  }
  return state.selectedTeamId;
}

function getTeamStandingsContext(tournament, teamId) {
  if (tournament.format === "groups") {
    const groups = Array.isArray(tournament.groups) ? tournament.groups : [];
    const fallbackTeamIds = getTournamentTeamIds(tournament);
    const group = groups.find((item) => (item.teamIds || []).includes(teamId)) || groups[0];
    if (!group) {
      return {
        title: "Stand",
        standings: calculateStandings(fallbackTeamIds, []),
        options: {
          qualifies: (_, index) => index < tournament.advancePerGroup,
        },
      };
    }
    return {
      title: `${group.name || "Poule"} stand`,
      standings: calculateStandings(group.teamIds || [], group.matches || []),
      options: {
        qualifies: (_, index) => index < tournament.advancePerGroup,
      },
    };
  }

  return {
    title: "League stand",
    standings: calculateStandings(tournament.teamIds, tournament.matches),
    options: {
      league: true,
      direct: tournament.directQualifiers,
      playoff: tournament.playoffQualifiers,
    },
  };
}

function getTeamScheduleItems(tournament, teamId) {
  const items = [];
  const knockoutReady = isKnockoutStageReady(tournament);

  if (tournament.format === "groups") {
    const groups = Array.isArray(tournament.groups) ? tournament.groups : [];
    groups.forEach((group) => {
      (group.matches || [])
        .filter((match) => match.homeTeamId === teamId || match.awayTeamId === teamId)
        .forEach((match) => {
          items.push(createTeamMatchItem(match, teamId, `${group.name || "Poule"} ronde ${match.round}`));
        });
    });

    if (knockoutReady && tournament.knockout) collectTeamTieItems(tournament.knockout, teamId, items);
  } else {
    (Array.isArray(tournament.matches) ? tournament.matches : [])
      .filter((match) => match.homeTeamId === teamId || match.awayTeamId === teamId)
      .forEach((match) => {
        items.push(createTeamMatchItem(match, teamId, `Leaguefase ronde ${match.round}`));
      });

    if (knockoutReady && tournament.playoff) collectTeamTieItems(tournament.playoff, teamId, items);
    if (knockoutReady && tournament.knockout) collectTeamTieItems(tournament.knockout, teamId, items);
  }

  return items.sort((a, b) => {
    const scheduleA = currentSchedule.get(`${a.type}:${a.id}`);
    const scheduleB = currentSchedule.get(`${b.type}:${b.id}`);
    if ((scheduleA?.start ?? 0) !== (scheduleB?.start ?? 0)) {
      return (scheduleA?.start ?? 0) - (scheduleB?.start ?? 0);
    }
    return (scheduleA?.field ?? 0) - (scheduleB?.field ?? 0);
  });
}

function createTeamMatchItem(match, teamId, stageLabel) {
  const opponentId = match.homeTeamId === teamId ? match.awayTeamId : match.homeTeamId;
  const scoreComplete = match.homeScore !== null && match.awayScore !== null;
  const teamScore = match.homeTeamId === teamId ? match.homeScore : match.awayScore;
  const opponentScore = match.homeTeamId === teamId ? match.awayScore : match.homeScore;
  const result = getResultMeta(scoreComplete, teamScore, opponentScore);

  return {
    type: "match",
    id: match.id,
    stageLabel,
    title: `${teamName(match.homeTeamId)} - ${teamName(match.awayTeamId)}`,
    detail: `Tegen ${teamName(opponentId)}`,
    scoreText: scoreComplete ? `${match.homeScore}-${match.awayScore}` : "Nog geen uitslag",
    resultLabel: result.label,
    resultClass: result.className,
  };
}

function collectTeamTieItems(bracket, teamId, items) {
  if (!bracket) return;
  if (isDoubleKnockoutContainer(bracket)) {
    collectTeamTieItems(bracket.winners, teamId, items);
    collectTeamTieItems(bracket.losers, teamId, items);
    return;
  }
  updateBracketWinners(bracket);
  (Array.isArray(bracket.rounds) ? bracket.rounds : []).forEach((round) => {
    round.ties
      .filter((tie) => tie.teamAId === teamId || tie.teamBId === teamId)
      .forEach((tie) => {
        items.push(createTeamTieItem(tie, teamId, round.name));
      });
  });
}

function createTeamTieItem(tie, teamId, stageLabel) {
  const opponentId = tie.teamAId === teamId ? tie.teamBId : tie.teamAId;
  const scoreComplete = scoresComplete(tie);
  const teamScore = tie.teamAId === teamId ? tie.scoreA : tie.scoreB;
  const opponentScore = tie.teamAId === teamId ? tie.scoreB : tie.scoreA;
  const result = tie.winnerId
    ? {
        label: tie.winnerId === teamId ? "Door" : "Uitgeschakeld",
        className: tie.winnerId === teamId ? "win" : "loss",
      }
    : getResultMeta(scoreComplete, teamScore, opponentScore);

  return {
    type: "tie",
    id: tie.id,
    stageLabel,
    title: `${teamName(tie.teamAId)} - ${teamName(tie.teamBId)}`,
    detail: opponentId ? `Tegen ${teamName(opponentId)}` : "Tegenstander nog open",
    scoreText: scoreComplete ? `${tie.scoreA}-${tie.scoreB}` : "Nog geen uitslag",
    resultLabel: result.label,
    resultClass: result.className,
  };
}

function getResultMeta(scoreComplete, teamScore, opponentScore) {
  if (!scoreComplete) {
    return { label: "Open", className: "open" };
  }
  if (teamScore > opponentScore) {
    return { label: "Winst", className: "win" };
  }
  if (teamScore < opponentScore) {
    return { label: "Verlies", className: "loss" };
  }
  return { label: "Gelijk", className: "draw" };
}

function renderBracketSection(bracket, title, action, preview = false) {
  const viewOnly = preview || APP_MODE === "participant";
  const showAction = !preview && APP_MODE !== "participant" && !state.locked;
  return `
    <div class="section-head">
      <h3>${title}</h3>
      ${showAction ? `<div class="section-actions"><button class="secondary-button" data-action="${action}" type="button">Opnieuw genereren</button></div>` : ""}
    </div>
    ${viewOnly ? renderBracketPreview(bracket) : renderBracket(bracket)}
  `;
}

function splitBracketForDisplay(bracket) {
  const rounds = Array.isArray(bracket?.rounds) ? bracket.rounds : [];
  if (!rounds.length) {
    return { left: null, center: null, right: null };
  }
  if (rounds.length === 1) {
    return { left: null, center: { ...rounds[0], sourceRoundIndex: 0 }, right: null };
  }

  const finalRoundIndex = rounds.length - 1;
  const halfIndex = (round) => Math.floor(round.ties.length / 2);

  const leftRounds = rounds.slice(0, finalRoundIndex).map((round, roundIndex) => ({
    ...round,
    sourceRoundIndex: roundIndex,
    ties: round.ties.slice(0, halfIndex(round)),
  }));

  const rightRounds = rounds.slice(0, finalRoundIndex).map((round, roundIndex) => ({
    ...round,
    sourceRoundIndex: roundIndex,
    ties: round.ties.slice(halfIndex(round)),
  }));

  return {
    left: buildBracketHalfLayout(leftRounds),
    center: { ...rounds[finalRoundIndex], sourceRoundIndex: finalRoundIndex },
    right: buildBracketHalfLayout(rightRounds),
  };
}

function buildBracketHalfLayout(rounds) {
  const layoutRounds = [];
  const firstRoundTieCount = rounds[0]?.ties?.length || 0;
  const rowCount = Math.max(1, firstRoundTieCount * 2 - 1);
  const stageHeight = Math.max(280, (rowCount - 1) * 72 + 144);

  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
    const round = rounds[roundIndex];
    const prevRound = layoutRounds[roundIndex - 1] || null;
    const ties = round.ties.map((tie, tieIndex) => {
      let row = 0;
      if (roundIndex === 0) {
        row = tieIndex * 2;
      } else {
        const childA = prevRound?.ties[tieIndex * 2];
        const childB = prevRound?.ties[tieIndex * 2 + 1];
        if (childA && childB) {
          row = (childA.row + childB.row) / 2;
        } else if (childA || childB) {
          row = childA?.row ?? childB?.row ?? 0;
        }
      }

      return {
        ...tie,
        row,
      };
    });

    layoutRounds.push({
      ...round,
      ties,
    });
  }

  return { rounds: layoutRounds, rowCount, stageHeight };
}

function renderBracketRoundColumn(round, options = {}, roundIndex = 0, layout = null) {
  const stageHeight = layout?.stageHeight || 280;
  const rowCount = layout?.rowCount || 1;
  return `
    <div class="bracket-round-column">
      ${
        options.preview
          ? `<h3>${escapeHtml(round.name)}</h3>`
          : `<label class="round-name-field bracket-round-label">
              <span class="round-name-label">Ronde</span>
              <input class="round-name-input" data-bracket-kind="${escapeHtml(options.bracketKind || "")}" data-round-index="${roundIndex}" type="text" value="${escapeHtml(round.name)}" />
            </label>`
      }
      <div class="bracket-round-stage" style="--bracket-stage-height:${stageHeight}px; --bracket-row-count:${rowCount};">
        ${round.ties
          .map(
            (tie) => `
              <div class="bracket-slot" style="top:${rowCount > 1 ? (tie.row / (rowCount - 1)) * 100 : 50}%;">
                ${renderBracketNode(tie, options)}
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderBracketCenterColumn(round, options = {}, stageHeight = 280) {
  if (!round) return "";
  const centerTie = round.ties[0];
  return `
    <div class="bracket-center-column">
      ${
        options.preview
          ? `<h3>${escapeHtml(round.name)}</h3>`
          : `<label class="round-name-field bracket-round-label">
              <span class="round-name-label">Ronde</span>
              <input class="round-name-input" data-bracket-kind="${escapeHtml(options.bracketKind || "")}" data-round-index="${round.sourceRoundIndex ?? 0}" type="text" value="${escapeHtml(round.name)}" />
            </label>`
      }
      <div class="bracket-center-stage" style="--bracket-stage-height:${stageHeight}px;">
        <div class="bracket-slot" style="top:50%;">
          ${renderBracketNode(centerTie, options)}
        </div>
      </div>
    </div>
  `;
}

function renderBracketHalf(layout, options = {}, side = "left") {
  if (!layout || !layout.rounds.length) return "";
  const rounds = side === "right" ? [...layout.rounds].reverse() : layout.rounds;
  return `
    <div class="bracket-half ${side}">
      <div class="bracket-half-grid" style="--bracket-stage-height:${layout.stageHeight}px; --bracket-row-count:${layout.rowCount}; --bracket-round-count:${rounds.length};">
        ${rounds
          .map((round) => renderBracketRoundColumn(round, options, round.sourceRoundIndex ?? 0, layout))
          .join("")}
      </div>
    </div>
  `;
}

function renderBracketSplit(bracket, options = {}) {
  const split = splitBracketForDisplay(bracket);
  if (!split.center) return "";

  const bracketOptions = { ...options, bracketKind: bracket?.kind || "" };
  const stageHeight = Math.max(split.left?.stageHeight || 0, split.right?.stageHeight || 0, 280);

  if (!split.left && !split.right) {
    return renderBracketCenterColumn(split.center, bracketOptions, stageHeight);
  }

  return `
    <div class="bracket-split">
      ${renderBracketHalf(split.left, bracketOptions, "left")}
      <div class="bracket-center-wrap">
        ${renderBracketCenterColumn(split.center, bracketOptions, stageHeight)}
      </div>
      ${renderBracketHalf(split.right, bracketOptions, "right")}
    </div>
  `;
}

function buildBracketLayout(bracket) {
  const rounds = Array.isArray(bracket?.rounds) ? bracket.rounds : [];
  const roundCount = rounds.length;
  const baseTieCount = rounds[0]?.ties?.length || 0;
  const rowCount = Math.max(1, baseTieCount * 2 - 1);
  const columnWidth = roundCount ? 100 / roundCount : 100;
  const nodeWidth = roundCount <= 1 ? 24 : Math.max(16, Math.min(22, 26 - roundCount * 0.9));
  const roundLayouts = [];

  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
    const round = rounds[roundIndex];
    const x = columnWidth * roundIndex + columnWidth / 2;
    const prevRound = roundLayouts[roundIndex - 1] || null;
    const ties = round.ties.map((tie, tieIndex) => {
      let y = 50;
      if (roundIndex === 0) {
        y = tieIndex * 2;
      } else {
        const childA = prevRound?.ties[tieIndex * 2];
        const childB = prevRound?.ties[tieIndex * 2 + 1];
        if (childA && childB) {
          y = (childA.y + childB.y) / 2;
        } else if (childA || childB) {
          y = childA?.y ?? childB?.y ?? y;
        }
      }

      return {
        ...tie,
        x,
        y,
      };
    });

    roundLayouts.push({
      ...round,
      x,
      ties,
    });
  }

  return {
    rounds: roundLayouts,
    rowCount,
    columnWidth,
    nodeWidth,
  };
}

function renderBracketHeaders(layout, bracket, options = {}) {
  return `
    <div class="bracket-heads">
      ${layout.rounds
        .map(
          (round, index) => `
            <div class="bracket-head">
              ${
                options.preview
                  ? `<h3>${escapeHtml(round.name)}</h3>`
                  : `<label class="round-name-field bracket-round-label">
                      <span class="round-name-label">Ronde</span>
                      <input class="round-name-input" data-bracket-kind="${escapeHtml(bracket.kind || "")}" data-round-index="${index}" type="text" value="${escapeHtml(round.name)}" />
                    </label>`
              }
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderBracketConnections(layout) {
  if (!layout.rounds.length || layout.rounds.length === 1) return "";

  const nodeWidth = layout.nodeWidth;
  const lines = [];

  for (let roundIndex = 1; roundIndex < layout.rounds.length; roundIndex += 1) {
    const currentRound = layout.rounds[roundIndex];
    const previousRound = layout.rounds[roundIndex - 1];

    currentRound.ties.forEach((tie, tieIndex) => {
      const childA = previousRound.ties[tieIndex * 2];
      const childB = previousRound.ties[tieIndex * 2 + 1];
      if (!childA || !childB) return;

      const childRightX = childA.x + nodeWidth / 2;
      const parentLeftX = tie.x - nodeWidth / 2;
      const joinX = childRightX + (parentLeftX - childRightX) * 0.5;
      const childTopY = childA.y;
      const childBottomY = childB.y;
      const parentY = tie.y;

      lines.push(`<line x1="${childRightX}" y1="${childTopY}" x2="${joinX}" y2="${childTopY}" />`);
      lines.push(`<line x1="${childRightX}" y1="${childBottomY}" x2="${joinX}" y2="${childBottomY}" />`);
      lines.push(`<line x1="${joinX}" y1="${childTopY}" x2="${joinX}" y2="${childBottomY}" />`);
      lines.push(`<line x1="${joinX}" y1="${parentY}" x2="${parentLeftX}" y2="${parentY}" />`);
    });
  }

  return lines.join("");
}

function renderBracketNode(tie, options = {}, layoutTie = null) {
  const teamA = tie.teamAId;
  const teamB = tie.teamBId;
  const canSelectWinner = teamA && teamB && (!scoresComplete(tie) || tie.scoreA === tie.scoreB);
  const winnerText = tie.winnerId ? `${escapeHtml(teamName(tie.winnerId))} door` : "Winnaar open";
  const schedule = currentSchedule.get(`tie:${tie.id}`);
  const previewTeamA = options.preview ? "Nog open" : teamName(teamA);
  const previewTeamB = options.preview ? "Nog open" : teamName(teamB);
  const canEditTime = !options.preview || options.allowTimeEdit;
  const timeValue = getTieStartValue(tie, schedule);

  return `
    <article class="bracket-node">
      <div class="bracket-node-meta">
        <time class="bracket-node-time">${escapeHtml(formatScheduleWindow(schedule))}</time>
        <span class="bracket-node-field">${escapeHtml(formatFieldLabel(schedule))}</span>
      </div>
      ${
        canEditTime
          ? `
            <label class="tie-time-control compact">
              <span>Starttijd</span>
              <input class="tie-start-input" data-tie-start="${tie.id}" type="time" value="${escapeHtml(timeValue)}" />
            </label>
          `
          : ""
      }
      <div class="bracket-node-teams">
        ${renderTieTeam(tie, "A", previewTeamA, options)}
        ${renderTieTeam(tie, "B", previewTeamB, options)}
      </div>
      <div class="tie-footer">
        ${
          !options.preview && canSelectWinner
            ? `
              <select class="winner-select" data-tie="${tie.id}" data-side="winner">
                <option value="">Winnaar</option>
                <option value="${teamA}" ${tie.winnerOverride === teamA ? "selected" : ""}>${escapeHtml(teamName(teamA))}</option>
                <option value="${teamB}" ${tie.winnerOverride === teamB ? "selected" : ""}>${escapeHtml(teamName(teamB))}</option>
              </select>
            `
            : `<span class="winner-note">${winnerText}</span>`
        }
      </div>
    </article>
  `;
}

function renderBracket(bracket, options = {}) {
  if (!options.preview) {
    updateBracketWinners(bracket);
  }
  const champion = options.preview || bracket.multiWinner ? null : getBracketChampion(bracket);
  const championStrip = champion
    ? `<div class="champion-strip"><span>Winnaar</span><strong>${escapeHtml(teamName(champion))}</strong></div>`
    : "";

  return `
    ${championStrip}
    <div class="bracket-view">
      <div class="bracket-desktop">
        ${renderBracketSplit(bracket, options)}
      </div>
      ${renderBracketMobile(bracket, { ...options, bracketKind: bracket?.kind || "" })}
    </div>
  `;
}

function renderTieCard(tie, options = {}) {
  const teamA = tie.teamAId;
  const teamB = tie.teamBId;
  const canSelectWinner = teamA && teamB && (!scoresComplete(tie) || tie.scoreA === tie.scoreB);
  const winnerText = tie.winnerId ? `${escapeHtml(teamName(tie.winnerId))} door` : "Winnaar open";
  const schedule = currentSchedule.get(`tie:${tie.id}`);
  const previewTeamA = options.preview ? "Nog open" : teamName(teamA);
  const previewTeamB = options.preview ? "Nog open" : teamName(teamB);
  const canEditTime = !options.preview || options.allowTimeEdit;
  const timeValue = getTieStartValue(tie, schedule);

  return `
    <article class="tie-card">
      ${renderScheduleSlot(schedule, "tie-slot")}
      ${
        canEditTime
          ? `
            <label class="tie-time-control">
              <span>Starttijd</span>
              <input class="tie-start-input" data-tie-start="${tie.id}" type="time" value="${escapeHtml(timeValue)}" />
            </label>
          `
          : ""
      }
      ${renderTieTeam(tie, "A", previewTeamA, options)}
      ${renderTieTeam(tie, "B", previewTeamB, options)}
      <div class="tie-footer">
        ${
          !options.preview && canSelectWinner
            ? `
              <select class="winner-select" data-tie="${tie.id}" data-side="winner">
                <option value="">Winnaar</option>
                <option value="${teamA}" ${tie.winnerOverride === teamA ? "selected" : ""}>${escapeHtml(teamName(teamA))}</option>
                <option value="${teamB}" ${tie.winnerOverride === teamB ? "selected" : ""}>${escapeHtml(teamName(teamB))}</option>
              </select>
            `
            : `<span class="winner-note">${winnerText}</span>`
        }
      </div>
    </article>
  `;
}

function renderTieTeam(tie, slot, displayName, options = {}) {
  const teamId = slot === "A" ? tie.teamAId : tie.teamBId;
  const score = slot === "A" ? tie.scoreA : tie.scoreB;
  const side = slot === "A" ? "scoreA" : "scoreB";
  const isWinner = tie.winnerId && tie.winnerId === teamId;
  const canEdit = !options.preview && Boolean(teamId);

  return `
    <div class="tie-team ${isWinner ? "is-winner" : ""}">
      <span class="team-name">${escapeHtml(displayName || teamName(teamId))}</span>
      <input class="score-input" data-tie="${tie.id}" data-side="${side}" type="number" min="0" max="99" value="${score ?? ""}" ${canEdit ? "" : "disabled"} />
    </div>
  `;
}

function renderMatchRow(match) {
  const schedule = currentSchedule.get(`match:${match.id}`);
  return `
    <div class="match-row">
      ${renderScheduleSlot(schedule, "match-slot")}
      <span class="team-name">${escapeHtml(teamName(match.homeTeamId))}</span>
      <input class="score-input" data-match="${match.id}" data-side="homeScore" type="number" min="0" max="99" value="${match.homeScore ?? ""}" />
      <span class="score-separator">-</span>
      <input class="score-input" data-match="${match.id}" data-side="awayScore" type="number" min="0" max="99" value="${match.awayScore ?? ""}" />
      <span class="team-name away">${escapeHtml(teamName(match.awayTeamId))}</span>
    </div>
  `;
}

function renderStandingsTable(standings, options = {}) {
  return `
    <table class="standings-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th>W</th>
          <th>Pt</th>
          <th>DS</th>
          <th>V</th>
          <th>T</th>
          ${options.league ? "<th>Status</th>" : ""}
        </tr>
      </thead>
      <tbody>
        ${standings
          .map((row, index) => {
            const className = getStandingClass(row, index, options);
            return `
              <tr class="${className}">
                <td>${index + 1}</td>
                <td>${escapeHtml(teamName(row.teamId))}</td>
                <td>${row.played}</td>
                <td>${row.points}</td>
                <td>${row.goalDifference}</td>
                <td>${row.goalsFor}</td>
                <td>${row.goalsAgainst}</td>
                ${options.league ? `<td>${renderLeagueBadge(index, options)}</td>` : ""}
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function getStandingClass(row, index, options) {
  const classes = [];
  if (typeof options.qualifies === "function" && options.qualifies(row, index)) classes.push("qualifies");
  if (options.league && index < options.direct) classes.push("direct");
  if (options.league && index < options.direct + options.playoff) classes.push("playoff");
  if (options.selectedTeamId === row.teamId) classes.push("selected-team");
  return classes.join(" ");
}

function renderLeagueBadge(index, options) {
  if (index < options.direct) return `<span class="badge direct">Direct</span>`;
  if (index < options.direct + options.playoff) return `<span class="badge playoff">Tussenronde</span>`;
  return `<span class="badge out">Uit</span>`;
}

function normalizeSettings() {
  state.settings.teamCount = clamp(state.settings.teamCount, 2, 64);
  ensureTeamCount(state.settings.teamCount);
  if (!validDate(state.settings.date)) {
    state.settings.date = todayISODate();
  }

  if (!validTime(state.settings.startTime)) {
    state.settings.startTime = "09:00";
  }
  if (!validTime(state.settings.endTime)) {
    state.settings.endTime = "17:00";
  }
  state.settings.matchDuration = clamp(state.settings.matchDuration, 1, 240);
  state.settings.breakDuration = clamp(state.settings.breakDuration, 0, 120);
  state.settings.fieldCount = clamp(state.settings.fieldCount, 1, 32);
  state.settings.fieldStart = clamp(state.settings.fieldStart, 1, 64);

  state.settings.groupCount = clamp(
    state.settings.groupCount,
    1,
    Math.max(1, Math.floor(state.settings.teamCount / 2)),
  );

  const minGroupSize = Math.floor(state.settings.teamCount / state.settings.groupCount);
  state.settings.advancePerGroup = clamp(state.settings.advancePerGroup, 1, Math.max(1, minGroupSize));

  const maxLeagueMatches = state.settings.teamCount - 1;
  const minLeagueMatches = state.settings.teamCount % 2 === 1 ? Math.min(2, maxLeagueMatches) : 1;
  state.settings.leagueMatches = clamp(state.settings.leagueMatches, minLeagueMatches, maxLeagueMatches);

  if (state.settings.teamCount % 2 === 1 && state.settings.leagueMatches % 2 === 1) {
    state.settings.leagueMatches =
      state.settings.leagueMatches === maxLeagueMatches
        ? state.settings.leagueMatches - 1
        : state.settings.leagueMatches + 1;
  }

  state.settings.directQualifiers = clamp(
    state.settings.directQualifiers,
    1,
    Math.max(1, state.settings.teamCount - 1),
  );

  const playoffMax = Math.max(0, state.settings.teamCount - state.settings.directQualifiers);
  state.settings.playoffQualifiers = clamp(state.settings.playoffQualifiers, 0, playoffMax);
  if (state.settings.playoffQualifiers % 2 === 1) {
    state.settings.playoffQualifiers -= 1;
  }
}

function hasLeaguePlayoff(source) {
  if (!source) return false;
  return source.playoffEnabled !== false && Number(source.playoffQualifiers) > 0;
}

function leaguePlayoffActive(tournament) {
  return state.settings.playoffEnabled && hasLeaguePlayoff(tournament);
}

function ensureTeamCount(count) {
  if (state.teams.length > count) {
    state.teams = state.teams.slice(0, count);
    return;
  }

  const usedNumbers = state.teams
    .map((team) => Number.parseInt(team.id.replace("team-", ""), 10))
    .filter((number) => !Number.isNaN(number));
  let nextNumber = usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1;

  while (state.teams.length < count) {
    state.teams.push({
      id: `team-${nextNumber}`,
      name: `Team ${state.teams.length + 1}`,
    });
    nextNumber += 1;
  }
}

function generateTournament() {
  if (state.locked) {
    showStatus("Zet het toernooi eerst op bewerken.");
    return;
  }
  normalizeTeamNames();
  normalizeSettings();
  clearPlanningAdvice();

  if (state.settings.format === "groups") {
    state.tournament = createGroupTournament();
    state.activeView = "matches";
  } else {
    state.tournament = createLeagueTournament();
    state.activeView = "league";
  }

  ensureSelectedTeamId(state.tournament);
  showStatus("Toernooi gegenereerd.");
  persist();
  renderAll();
}

function randomizeLeaguePhase() {
  if (state.locked) {
    showStatus("Zet het toernooi eerst op bewerken.");
    return;
  }
  if (state.settings.format !== "league") {
    showStatus("Deze functie werkt alleen in de leaguefase.");
    return;
  }

  normalizeTeamNames();
  normalizeSettings();
  clearPlanningAdvice();
  if (!state.tournament || state.tournament.format !== "league") {
    state.tournament = createLeagueTournament();
  }

  randomizeLeagueScores(state.tournament);

  state.tournament.playoff = null;
  state.tournament.knockout = null;
  state.activeView = "league";
  ensureSelectedTeamId(state.tournament);
  showStatus("League-uitslagen willekeurig ingevuld.");
  persist();
  renderAll();
}

function randomizeLeagueScores(tournament) {
  if (!tournament || tournament.format !== "league") return;

  const matches = tournament.rounds.flat();
  matches.forEach((match) => {
    const homeScore = Math.floor(Math.random() * 6);
    const awayScore = Math.floor(Math.random() * 6);
    match.homeScore = homeScore;
    match.awayScore = awayScore;
  });

  if (Array.isArray(tournament.matches)) {
    tournament.matches.forEach((match, index) => {
      const source = matches[index];
      if (!source) return;
      match.homeScore = source.homeScore;
      match.awayScore = source.awayScore;
    });
  }
}

function normalizeTeamNames() {
  state.teams = state.teams.map((team, index) => ({
    ...team,
    name: team.name.trim() || `Team ${index + 1}`,
  }));
}

function createGroupTournament() {
  const teamIds = state.teams.map((team) => team.id);
  const grouped = distributeTeams(teamIds, state.settings.groupCount);
  const groups = grouped.map((groupTeamIds, index) => {
    const rounds = createRoundRobin(groupTeamIds, {
      doubleRound: state.settings.doubleRound,
      stage: "group",
      groupId: `group-${index + 1}`,
    });
    return {
      id: `group-${index + 1}`,
      name: `Poule ${String.fromCharCode(65 + index)}`,
      teamIds: groupTeamIds,
      rounds,
      matches: rounds.flat(),
    };
  });

  return {
    format: "groups",
    name: state.settings.name.trim() || "Mijn toernooi",
    advancePerGroup: state.settings.advancePerGroup,
    groups,
    knockout: null,
  };
}

function createLeagueTournament() {
  const teamIds = state.teams.map((team) => team.id);
  const rounds = createLeagueSchedule(teamIds, state.settings.leagueMatches);
  return {
    format: "league",
    name: state.settings.name.trim() || "Mijn toernooi",
    teamIds,
    matchesPerTeam: state.settings.leagueMatches,
    playoffEnabled: state.settings.playoffEnabled,
    directQualifiers: state.settings.directQualifiers,
    playoffQualifiers: hasLeaguePlayoff(state.settings) ? state.settings.playoffQualifiers : 0,
    rounds,
    matches: rounds.flat(),
    playoff: null,
    knockout: null,
  };
}

function distributeTeams(teamIds, groupCount) {
  const groups = Array.from({ length: groupCount }, () => []);
  teamIds.forEach((teamId, index) => {
    groups[index % groupCount].push(teamId);
  });
  return groups;
}

function createRoundRobin(teamIds, options = {}) {
  const teams = [...teamIds];
  if (teams.length % 2 === 1) teams.push(null);

  const rounds = [];
  const totalRounds = teams.length - 1;
  let rotation = [...teams];

  for (let roundIndex = 0; roundIndex < totalRounds; roundIndex += 1) {
    const round = [];
    for (let pairIndex = 0; pairIndex < rotation.length / 2; pairIndex += 1) {
      const first = rotation[pairIndex];
      const second = rotation[rotation.length - 1 - pairIndex];
      if (!first || !second) continue;

      const flipHome = (roundIndex + pairIndex) % 2 === 1;
      round.push(
        createMatch({
          stage: options.stage || "round-robin",
          groupId: options.groupId || null,
          round: roundIndex + 1,
          homeTeamId: flipHome ? second : first,
          awayTeamId: flipHome ? first : second,
        }),
      );
    }
    rounds.push(round);
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, rotation.length - 1)];
  }

  if (!options.doubleRound) return rounds;

  const returnRounds = rounds.map((round, roundIndex) =>
    round.map((match) =>
      createMatch({
        stage: match.stage,
        groupId: match.groupId,
        round: totalRounds + roundIndex + 1,
        homeTeamId: match.awayTeamId,
        awayTeamId: match.homeTeamId,
      }),
    ),
  );

  return [...rounds, ...returnRounds];
}

function shuffleList(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

function createLeagueSchedule(teamIds, matchesPerTeam) {
  const randomize = true;
  if (teamIds.length % 2 === 0) {
    const rounds = createRoundRobin(teamIds, { stage: "league" }).slice(0, matchesPerTeam);
    return randomize ? shuffleList(rounds).map((round) => shuffleList(round)) : rounds;
  }

  const edges = [];
  const degreeRadius = matchesPerTeam / 2;
  for (let offset = 1; offset <= degreeRadius; offset += 1) {
    for (let index = 0; index < teamIds.length; index += 1) {
      const opponentIndex = (index + offset) % teamIds.length;
      edges.push([teamIds[index], teamIds[opponentIndex]]);
    }
  }

  const rounds = [];
  edges.forEach(([teamA, teamB], edgeIndex) => {
    let placed = false;
    for (const round of rounds) {
      const used = new Set(round.flat());
      if (!used.has(teamA) && !used.has(teamB)) {
        round.push([teamA, teamB]);
        placed = true;
        break;
      }
    }
    if (!placed) rounds.push([[teamA, teamB]]);
  });

  const orderedRounds = rounds.map((round, roundIndex) =>
    round.map(([teamA, teamB], matchIndex) => {
      const flipHome = (roundIndex + matchIndex) % 2 === 1;
      return createMatch({
        stage: "league",
        groupId: null,
        round: roundIndex + 1,
        homeTeamId: flipHome ? teamB : teamA,
        awayTeamId: flipHome ? teamA : teamB,
      });
    }),
  );
  return randomize ? shuffleList(orderedRounds).map((round) => shuffleList(round)) : orderedRounds;
}

function createMatch({ stage, groupId, round, homeTeamId, awayTeamId }) {
  return {
    id: makeId("match"),
    stage,
    groupId,
    round,
    homeTeamId,
    awayTeamId,
    homeScore: null,
    awayScore: null,
  };
}

function calculateStandings(teamIds, matches) {
  const table = new Map(
    teamIds.map((teamId) => [
      teamId,
      {
        teamId,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
      },
    ]),
  );

  matches.forEach((match) => {
    if (match.homeScore === null || match.awayScore === null) return;
    const home = table.get(match.homeTeamId);
    const away = table.get(match.awayTeamId);
    if (!home || !away) return;

    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;

    if (match.homeScore > match.awayScore) {
      home.won += 1;
      away.lost += 1;
      home.points += 3;
    } else if (match.homeScore < match.awayScore) {
      away.won += 1;
      home.lost += 1;
      away.points += 3;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  });

  return [...table.values()]
    .map((row) => ({
      ...row,
      goalDifference: row.goalsFor - row.goalsAgainst,
    }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return teamName(a.teamId).localeCompare(teamName(b.teamId), "nl");
    });
}

function buildScheduleMap(tournament, tournamentState = state) {
  const schedule = new Map();
  if (!tournament) return schedule;

  const blocks = collectScheduledBlocks(tournament);
  const start = parseTimeToMinutes(tournamentState.settings.startTime);
  const matchDuration = tournamentState.settings.matchDuration;
  const slotDuration = tournamentState.settings.matchDuration + tournamentState.settings.breakDuration;
  const fields = tournamentState.settings.fieldCount;
  const fieldStart = tournamentState.settings.fieldStart || 1;

  let currentTime = start;
  blocks.forEach((block) => {
    const waveSizes = splitEvenly(block.items.length, fields);
    let offset = 0;
    waveSizes.forEach((waveSize, waveIndex) => {
      const wave = block.items.slice(offset, offset + waveSize);
      wave.forEach((item, fieldIndex) => {
        let startTime = currentTime;
        if (item.type === "tie") {
          const override = tournamentState.tieTimeOverrides?.[item.id];
          const tie = findTieInTournament(tournament, item.id);
          const manualStart = validTime(override) ? override : tie?.manualStart;
          if (validTime(manualStart)) {
            startTime = parseTimeToMinutes(manualStart);
          }
        }
        schedule.set(`${item.type}:${item.id}`, {
          start: startTime,
          end: startTime + matchDuration,
          field: fieldIndex + 1,
          displayField: fieldStart + fieldIndex,
          label: block.label,
        });
      });
      offset += waveSize;
      currentTime += slotDuration;
    });
  });

  return schedule;
}

function findTieInTournament(tournament, tieId) {
  if (!tournament) return null;
  const brackets = [];
  if (tournament.knockout) brackets.push(tournament.knockout);
  if (tournament.playoff) brackets.push(tournament.playoff);

  for (const bracket of brackets) {
    const found = findTieInBracket(bracket, tieId);
    if (found) return found.tie;
  }

  return null;
}

function collectScheduledBlocks(tournament) {
  const blocks = [];
  const knockoutReady = isKnockoutStageReady(tournament);

  if (tournament.format === "groups") {
    const groups = Array.isArray(tournament.groups) ? tournament.groups : [];
    const maxRounds = groups.length ? Math.max(...groups.map((group) => (group.rounds || []).length)) : 0;
    if (!maxRounds) return blocks;
    for (let roundIndex = 0; roundIndex < maxRounds; roundIndex += 1) {
      const items = [];
      groups.forEach((group) => {
        ((group.rounds || [])[roundIndex] || []).forEach((match) => {
          items.push({ type: "match", id: match.id });
        });
      });
      blocks.push({ label: `Poule ronde ${roundIndex + 1}`, items });
    }

    if (knockoutReady && tournament.knockout) {
      blocks.push(...collectBracketBlocks(tournament.knockout, "Knock-out"));
    }
    return blocks;
  }

  (Array.isArray(tournament.rounds) ? tournament.rounds : []).forEach((round, index) => {
    blocks.push({
      label: `League ronde ${index + 1}`,
      items: round.map((match) => ({ type: "match", id: match.id })),
    });
  });

  if (knockoutReady && leaguePlayoffActive(tournament) && tournament.playoff) {
    blocks.push(...collectBracketBlocks(tournament.playoff, "Tussenronde"));
  } else if (leaguePlayoffActive(tournament)) {
    blocks.push(...collectBracketBlocks(getLeagueKnockoutPreview(tournament).playoff, "Tussenronde"));
  }

  if (knockoutReady && tournament.knockout) {
    blocks.push(...collectBracketBlocks(tournament.knockout, "Eindfase"));
  } else {
    blocks.push(...collectBracketBlocks(getLeagueKnockoutPreview(tournament).knockout, "Eindfase"));
  }

  return blocks;
}

function splitKnockoutSeeds(seedIds) {
  const winnersSize = Math.ceil(seedIds.length / 2);
  return {
    winners: seedIds.slice(0, winnersSize),
    losers: seedIds.slice(winnersSize),
  };
}

function createDoubleKnockoutBracket(seedIds, prefix = "knockout") {
  const split = splitKnockoutSeeds(seedIds);
  return {
    kind: "double",
    winners: createKnockoutBracket(split.winners, `${prefix}-winners`),
    losers: split.losers.length ? createKnockoutBracket(split.losers, `${prefix}-losers`) : null,
  };
}

function countBracketMatches(bracket) {
  if (!bracket) return 0;
  if (isDoubleKnockoutContainer(bracket)) {
    return countBracketMatches(bracket.winners) + countBracketMatches(bracket.losers);
  }
  return (Array.isArray(bracket.rounds) ? bracket.rounds : []).reduce((sum, round) => sum + (round.ties || []).length, 0);
}

function forEachBracketTie(bracket, callback) {
  if (!bracket) return;
  if (isDoubleKnockoutContainer(bracket)) {
    forEachBracketTie(bracket.winners, callback);
    forEachBracketTie(bracket.losers, callback);
    return;
  }

  (Array.isArray(bracket.rounds) ? bracket.rounds : []).forEach((round, roundIndex) => {
    (round.ties || []).forEach((tie, tieIndex) => callback({ bracket, round, roundIndex, tie, tieIndex }));
  });
}

function findTieInBracket(bracket, tieId) {
  if (!bracket) return null;
  if (isDoubleKnockoutContainer(bracket)) {
    return findTieInBracket(bracket.winners, tieId) || findTieInBracket(bracket.losers, tieId);
  }
  for (const round of bracket.rounds) {
    const tie = round.ties.find((item) => item.id === tieId);
    if (tie) return { bracket, tie };
  }
  return null;
}

function getTournamentMatchCount(tournament) {
  if (!tournament) return 0;
  if (tournament.format === "groups") {
    const groups = Array.isArray(tournament.groups) ? tournament.groups : [];
    const groupMatches = groups.reduce((sum, group) => sum + (group.matches || []).length, 0);
    return groupMatches + countBracketMatches(tournament.knockout);
  }

  const leagueMatches = Array.isArray(tournament.matches) ? tournament.matches.length : 0;
  const playoffMatches = countBracketMatches(tournament.playoff);
  const knockoutMatches = countBracketMatches(tournament.knockout);
  return leagueMatches + playoffMatches + knockoutMatches;
}

function collectProgramScheduleRows() {
  const rows = [];

  program.tournaments.forEach((tournamentState, tournamentIndex) => {
    const tournament = tournamentState.tournament;
    if (!tournament) return;

    const scheduleMap = buildScheduleMap(tournament, tournamentState);
    collectScheduledBlocks(tournament).forEach((block) => {
      block.items.forEach((item) => {
        const schedule = scheduleMap.get(`${item.type}:${item.id}`);
        if (!schedule) return;

        if (item.type === "match") {
          const match = findMatchInTournament(tournament, item.id);
          rows.push({
            tournamentId: tournamentState.id,
            tournamentIndex,
            tournamentName: tournamentState.settings.name || `Toernooi ${tournamentIndex + 1}`,
            date: tournamentState.settings?.date || "",
            schedule,
            detail: `${block.label} · ${teamName(match?.homeTeamId)} - ${teamName(match?.awayTeamId)}`,
          });
          return;
        }

        const foundTie = findTieInTournament(tournament, item.id);
        rows.push({
          tournamentId: tournamentState.id,
          tournamentIndex,
          tournamentName: tournamentState.settings.name || `Toernooi ${tournamentIndex + 1}`,
          date: tournamentState.settings?.date || "",
          schedule,
          detail: `${block.label} · ${teamName(foundTie?.tie.teamAId)} - ${teamName(foundTie?.tie.teamBId)}`,
        });
      });
    });
  });

  return rows.sort(
    (a, b) =>
      (a.date || "zzzz").localeCompare(b.date || "zzzz") ||
      a.schedule.start - b.schedule.start ||
      a.schedule.displayField - b.schedule.displayField ||
      a.tournamentName.localeCompare(b.tournamentName, "nl"),
  );
}

function findMatchInTournament(tournament, matchId) {
  if (!tournament) return null;
  if (tournament.format === "groups") {
    return (Array.isArray(tournament.groups) ? tournament.groups : [])
      .flatMap((group) => group.matches || [])
      .find((match) => match.id === matchId) || null;
  }
  return (Array.isArray(tournament.matches) ? tournament.matches : []).find((match) => match.id === matchId) || null;
}

function areGroupMatchesComplete(tournament) {
  if (!tournament || tournament.format !== "groups") return false;
  const groups = Array.isArray(tournament.groups) ? tournament.groups : [];
  return groups.length > 0 && groups.every((group) =>
    (group.matches || []).every((match) => match.homeScore !== null && match.awayScore !== null),
  );
}

function areLeagueMatchesComplete(tournament) {
  if (!tournament || tournament.format !== "league") return false;
  return Array.isArray(tournament.matches) && tournament.matches.every((match) => match.homeScore !== null && match.awayScore !== null);
}

function isKnockoutStageReady(tournament) {
  if (!tournament) return false;
  return tournament.format === "groups" ? areGroupMatchesComplete(tournament) : areLeagueMatchesComplete(tournament);
}

function getLeagueKnockoutPreview(tournament) {
  const playoffSize = leaguePlayoffActive(tournament) ? tournament.playoffQualifiers : 0;
  const finalEntrants = playoffSize > 0 ? tournament.directQualifiers + tournament.playoffQualifiers / 2 : tournament.directQualifiers;

  return {
    playoff: playoffSize > 0 ? createPreviewBracket(playoffSize, "league-playoff") : null,
    knockout: state.settings.doubleKnockoutEnabled
      ? createDoublePreviewBracket(finalEntrants, "league-knockout")
      : createPreviewBracket(finalEntrants, "league-knockout"),
  };
}

function createDoublePreviewBracket(seedCount, prefix) {
  const { winners, losers } = splitSeedCounts(seedCount);
  const winnerBracket = winners ? createPreviewBracket(winners, `${prefix}-winners`) : null;
  const loserBracket = losers ? createPreviewBracket(losers, `${prefix}-losers`) : null;
  return {
    preview: true,
    kind: "double",
    winners: winnerBracket,
    losers: loserBracket,
  };
}

function createPreviewBracket(seedCount, prefix) {
  if (!seedCount) return null;

  const size = nextPowerOfTwo(Math.max(2, seedCount));
  const rounds = [];

  for (let entrants = size; entrants >= 2; entrants /= 2) {
    const roundIndex = rounds.length;
    const ties = Array.from({ length: entrants / 2 }, (_, index) => ({
      id: bracketTieId(prefix, roundIndex, index),
      teamAId: null,
      teamBId: null,
      scoreA: null,
      scoreB: null,
      winnerOverride: null,
      winnerId: null,
      manualStart: null,
    }));
    rounds.push({ name: roundName(entrants), ties });
  }

  return { preview: true, kind: prefix, rounds };
}

function splitSeedCounts(seedCount) {
  const winners = Math.ceil(seedCount / 2);
  const losers = Math.floor(seedCount / 2);
  return { winners, losers };
}

function bracketTieId(kind, roundIndex, tieIndex) {
  return `${kind}-r${roundIndex + 1}-t${tieIndex + 1}`;
}

function collectBracketBlocks(bracket, prefix) {
  if (!bracket) return [];
  if (isDoubleKnockoutContainer(bracket)) {
    return [
      ...collectBracketBlocks(bracket.winners, `${prefix} - Winnaars`),
      ...collectBracketBlocks(bracket.losers, `${prefix} - Verliezers`),
    ];
  }
  return bracket.rounds.map((round, index) => ({
    label: `${prefix} ${round.name || `Ronde ${index + 1}`}`,
    items: round.ties.map((tie) => ({ type: "tie", id: tie.id })),
  }));
}

function isDoubleKnockoutContainer(bracket) {
  return Boolean(bracket && bracket.kind === "double");
}

function generateGroupKnockout() {
  if (state.locked) {
    showStatus("Zet het toernooi eerst op bewerken.");
    return;
  }
  const tournament = state.tournament;
  if (!tournament || tournament.format !== "groups") return;
  if (!areGroupMatchesComplete(tournament)) {
    showStatus("Alle poulewedstrijden moeten eerst gespeeld zijn.");
    return;
  }

  const seeds = [];
  for (let rank = 0; rank < tournament.advancePerGroup; rank += 1) {
    tournament.groups.forEach((group) => {
      const standings = calculateStandings(group.teamIds, group.matches);
      if (standings[rank]) seeds.push(standings[rank].teamId);
    });
  }

  tournament.knockout = state.settings.doubleKnockoutEnabled
    ? createDoubleKnockoutBracket(seeds, "group-knockout")
    : createKnockoutBracket(seeds, "group-knockout");
  state.activeView = "knockout";
  showStatus("Knock-out gegenereerd.");
  persist();
  renderAll();
}

function generateLeaguePlayoff() {
  if (state.locked) {
    showStatus("Zet het toernooi eerst op bewerken.");
    return;
  }
  const tournament = state.tournament;
  if (!tournament || tournament.format !== "league" || !hasLeaguePlayoff(tournament) || !state.settings.playoffEnabled) {
    showStatus("De tussenronde staat uit.");
    return;
  }
  if (!areLeagueMatchesComplete(tournament)) {
    showStatus("Alle leaguewedstrijden moeten eerst gespeeld zijn. Teams blijven nog leeg.");
    return;
  }

  const standings = calculateStandings(tournament.teamIds, tournament.matches);
  const start = tournament.directQualifiers;
  const seeds = standings
    .slice(start, start + tournament.playoffQualifiers)
    .map((row) => row.teamId);
  tournament.playoff = createPlayoffRound(seeds, "league-playoff");
  tournament.knockout = null;
  state.activeView = "knockout";
  showStatus("Tussenronde gegenereerd.");
  persist();
  renderAll();
}

function generateLeagueFinals() {
  if (state.locked) {
    showStatus("Zet het toernooi eerst op bewerken.");
    return;
  }
  const tournament = state.tournament;
  if (!tournament || tournament.format !== "league") return;
  if (!areLeagueMatchesComplete(tournament)) {
    showStatus("Alle leaguewedstrijden moeten eerst gespeeld zijn. Teams blijven nog leeg.");
    return;
  }

  const standings = calculateStandings(tournament.teamIds, tournament.matches);
  const direct = standings.slice(0, tournament.directQualifiers).map((row) => row.teamId);
  let playoffWinners = [];

  if (hasLeaguePlayoff(tournament) && state.settings.playoffEnabled) {
    if (!tournament.playoff) {
      showStatus("Genereer eerst de tussenronde.");
      return;
    }

    updateBracketWinners(tournament.playoff);
    playoffWinners = tournament.playoff.rounds[0].ties.map((tie) => tie.winnerId).filter(Boolean);
    const expectedWinners = tournament.playoffQualifiers / 2;
    if (playoffWinners.length < expectedWinners) {
      showStatus("Vul eerst de winnaars van de tussenronde in.");
      return;
    }
  }

  const finalSeeds = [...direct, ...playoffWinners];
  tournament.knockout = state.settings.doubleKnockoutEnabled
    ? createDoubleKnockoutBracket(finalSeeds, "league-knockout")
    : createKnockoutBracket(finalSeeds, "league-knockout");
  showStatus("Eindfase gegenereerd.");
  persist();
  renderAll();
}

function checkLeagueProgress() {
  if (state.locked) {
    showStatus("Zet het toernooi eerst op bewerken.");
    return;
  }
  const tournament = state.tournament;
  if (!tournament || tournament.format !== "league") return;

  if (!areLeagueMatchesComplete(tournament)) {
    tournament.playoff = null;
    tournament.knockout = null;
    showStatus("Nog niet alle leaguewedstrijden gespeeld. De planning blijft zichtbaar, maar teams worden nog niet ingevuld.");
    persist();
    renderAll();
    return;
  }

  const standings = calculateStandings(tournament.teamIds, tournament.matches);

  if (hasLeaguePlayoff(tournament) && state.settings.playoffEnabled) {
    const start = tournament.directQualifiers;
    const seeds = standings
      .slice(start, start + tournament.playoffQualifiers)
      .map((row) => row.teamId);
    tournament.playoff = createPlayoffRound(seeds, "league-playoff");
    tournament.knockout = null;
    showStatus("Leaguefase gecontroleerd. De tussenronde is nu gevuld; de eindfase blijft nog leeg.");
  } else {
    const direct = standings.slice(0, tournament.directQualifiers).map((row) => row.teamId);
    tournament.knockout = state.settings.doubleKnockoutEnabled
      ? createDoubleKnockoutBracket(direct, "league-knockout")
      : createKnockoutBracket(direct, "league-knockout");
    tournament.playoff = null;
    showStatus("Leaguefase gecontroleerd. De knock-out is nu gevuld.");
  }

  persist();
  renderAll();
}

function createKnockoutBracket(seedIds, kind = "knockout") {
  if (seedIds.length === 1) {
    return {
      kind,
      rounds: [
        {
          name: "Winnaar",
          ties: [
            {
              id: bracketTieId(kind, 0, 0),
              teamAId: seedIds[0],
              teamBId: null,
              scoreA: null,
              scoreB: null,
              winnerOverride: null,
              winnerId: seedIds[0],
              manualStart: null,
            },
          ],
        },
      ],
    };
  }

  const size = nextPowerOfTwo(Math.max(2, seedIds.length));
  const order = seedOrder(size);
  const slots = order.map((seedNumber) => seedIds[seedNumber - 1] || null);
  const rounds = [];

  for (let entrants = size; entrants >= 2; entrants /= 2) {
    const roundIndex = rounds.length;
    const ties = Array.from({ length: entrants / 2 }, (_, index) => ({
      id: bracketTieId(kind, roundIndex, index),
      teamAId: roundIndex === 0 ? slots[index * 2] : null,
      teamBId: roundIndex === 0 ? slots[index * 2 + 1] : null,
      scoreA: null,
      scoreB: null,
      winnerOverride: null,
      winnerId: null,
      manualStart: null,
    }));
    rounds.push({ name: roundName(entrants), ties });
  }

  const bracket = { kind, rounds };
  updateBracketWinners(bracket);
  return bracket;
}

function createPlayoffRound(seedIds, kind = "playoff") {
  const ties = [];
  for (let index = 0; index < seedIds.length / 2; index += 1) {
    ties.push({
      id: bracketTieId(kind, 0, index),
      teamAId: seedIds[index],
      teamBId: seedIds[seedIds.length - 1 - index],
      scoreA: null,
      scoreB: null,
      winnerOverride: null,
      winnerId: null,
      manualStart: null,
    });
  }

  return {
    kind,
    multiWinner: true,
    rounds: [
      {
        name: "Tussenronde",
        ties,
      },
    ],
  };
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function seedOrder(size) {
  if (size <= 1) return [1];
  let order = [1, 2];
  for (let currentSize = 4; currentSize <= size; currentSize *= 2) {
    order = order.flatMap((seed) => [seed, currentSize + 1 - seed]);
  }
  return order;
}

function roundName(entrants) {
  if (entrants === 2) return "Finale";
  if (entrants === 4) return "Halve finale";
  if (entrants === 8) return "Kwartfinale";
  if (entrants === 16) return "Achtste finale";
  return `Ronde van ${entrants}`;
}

function findEditableBracket(kind) {
  const tournament = state.tournament;
  if (!tournament) return null;
  if (tournament.playoff) {
    const found = findEditableBracketInBracket(tournament.playoff, kind);
    if (found) return found;
  }
  if (tournament.knockout) {
    const found = findEditableBracketInBracket(tournament.knockout, kind);
    if (found) return found;
  }
  return null;
}

function findEditableBracketInBracket(bracket, kind) {
  if (!bracket) return null;
  if (isDoubleKnockoutContainer(bracket)) {
    return findEditableBracketInBracket(bracket.winners, kind) || findEditableBracketInBracket(bracket.losers, kind);
  }
  if (bracket.kind === kind) return bracket;
  return null;
}

function updateBracketRoundName(kind, roundIndex, name) {
  if (state.locked) {
    showStatus("Zet het toernooi eerst op bewerken.");
    return;
  }
  const bracket = findEditableBracket(kind);
  if (!bracket || !Number.isInteger(roundIndex) || !bracket.rounds[roundIndex]) return;

  const round = bracket.rounds[roundIndex];
  const fallback = roundName(round.ties.length * 2);
  round.name = name.trim() || fallback;
  persist();
  renderAll();
}

function updateBracketWinners(bracket) {
  if (!bracket) return;
  if (isDoubleKnockoutContainer(bracket)) {
    updateBracketWinners(bracket.winners);
    updateBracketWinners(bracket.losers);
    return;
  }

  bracket.rounds.forEach((round, roundIndex) => {
    round.ties.forEach((tie) => {
      tie.winnerId = resolveTieWinner(tie);
    });

    const nextRound = bracket.rounds[roundIndex + 1];
    if (!nextRound) return;

    nextRound.ties.forEach((nextTie, index) => {
      const nextTeamA = round.ties[index * 2]?.winnerId || null;
      const nextTeamB = round.ties[index * 2 + 1]?.winnerId || null;
      updateTieSlot(nextTie, "A", nextTeamA);
      updateTieSlot(nextTie, "B", nextTeamB);
    });
  });
}

function updateTieSlot(tie, slot, teamId) {
  const key = slot === "A" ? "teamAId" : "teamBId";
  if (tie[key] === teamId) return;
  tie[key] = teamId;
  tie.scoreA = null;
  tie.scoreB = null;
  tie.winnerOverride = null;
  tie.winnerId = null;
}

function resolveTieWinner(tie) {
  if (tie.teamAId && !tie.teamBId) return tie.teamAId;
  if (!tie.teamAId && tie.teamBId) return tie.teamBId;
  if (!tie.teamAId || !tie.teamBId) return null;

  if (scoresComplete(tie) && tie.scoreA !== tie.scoreB) {
    return tie.scoreA > tie.scoreB ? tie.teamAId : tie.teamBId;
  }

  if (tie.winnerOverride === tie.teamAId || tie.winnerOverride === tie.teamBId) {
    return tie.winnerOverride;
  }

  return null;
}

function scoresComplete(tie) {
  return tie.scoreA !== null && tie.scoreB !== null;
}

function getBracketChampion(bracket) {
  updateBracketWinners(bracket);
  const finalRound = bracket.rounds.at(-1);
  return finalRound?.ties[0]?.winnerId || null;
}

function parseScore(value) {
  if (value === "") return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return null;
  return Math.min(parsed, 99);
}

function findMatch(matchId) {
  const tournament = state.tournament;
  if (!tournament) return null;

  if (tournament.format === "groups") {
    return (Array.isArray(tournament.groups) ? tournament.groups : [])
      .flatMap((group) => [
        ...(Array.isArray(group.matches) ? group.matches : []),
        ...(Array.isArray(group.rounds) ? group.rounds.flat() : []),
      ])
      .find((match) => match?.id === matchId) || null;
  }

  return (
    (Array.isArray(tournament.matches) ? tournament.matches : []).find((match) => match?.id === matchId) ||
    (Array.isArray(tournament.rounds) ? tournament.rounds.flat() : []).find((match) => match?.id === matchId) ||
    null
  );
}

function findTie(tieId) {
  const tournament = state.tournament;
  if (!tournament) return null;

  const brackets = [];
  if (tournament.knockout) brackets.push(tournament.knockout);
  if (tournament.playoff) brackets.push(tournament.playoff);

  for (const bracket of brackets) {
    const found = findTieInBracket(bracket, tieId);
    if (found) return found;
  }

  return null;
}

function showStatus(message) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.hidden = false;
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    elements.statusMessage.hidden = true;
  }, 2600);
}

function renderAll() {
  const programFocus = APP_MODE === "admin" && state.activeView === "program";
  renderSetup();
  renderTournament();
  updateAuthUi();
  updateWriteGate();
  document.body.classList.toggle("program-focus", programFocus);
  if (elements.setupPanel) {
    elements.setupPanel.hidden = programFocus || document.body.classList.contains("knockout-focus");
  }
  if (elements.appShell) {
    elements.appShell.classList.toggle("program-focus", programFocus);
  }
}

function applyLeagueDefaultsForTeamCount() {
  const count = state.settings.teamCount;
  const maxMatches = count - 1;
  let matches = count >= 36 ? 8 : Math.min(maxMatches, Math.max(2, Math.floor(count / 3)));
  if (count % 2 === 1 && matches % 2 === 1) matches += matches < maxMatches ? 1 : -1;
  state.settings.leagueMatches = Math.max(1, Math.min(maxMatches, matches));

  if (count >= 24) {
    state.settings.directQualifiers = 8;
    state.settings.playoffQualifiers = Math.min(16, count - 8);
    return;
  }

  state.settings.directQualifiers = Math.max(1, Math.min(count - 1, Math.floor(count / 4) || 1));
  const playoffMax = count - state.settings.directQualifiers;
  state.settings.playoffQualifiers = Math.min(playoffMax - (playoffMax % 2), state.settings.directQualifiers * 2);
}

function shuffleTeamsList() {
  if (state.locked) {
    showStatus("Zet het toernooi eerst op bewerken.");
    return;
  }
  for (let index = state.teams.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [state.teams[index], state.teams[randomIndex]] = [state.teams[randomIndex], state.teams[index]];
  }
  persist();
  renderTeamFields();
}

function exportTournament() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(state.settings.name || "toernooi").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importTournament(file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(reader.result);
      if (imported && Array.isArray(imported.tournaments)) {
        program = normalizeProgramState(imported);
        state = getActiveTournamentState(program);
      } else {
        state = normalizeTournamentState(imported, state.id);
        program = normalizeProgramState({
          ...defaultProgramState(),
          tournaments: [state],
          activeTournamentId: state.id,
          nextTournamentId: 2,
        });
      }
      normalizeSettings();
      validationReport = null;
      persist();
      renderAll();
      showStatus("Toernooi geimporteerd.");
    } catch {
      showStatus("Importeren is niet gelukt.");
    }
  });
  reader.readAsText(file);
}

document.addEventListener("click", (event) => {
  const formatButton = event.target.closest("[data-format]");
  if (formatButton) {
    state.settings.format = formatButton.dataset.format;
    if (state.settings.format === "league") applyLeagueDefaultsForTeamCount();
    clearPlanningAdvice();
    persist();
    renderAll();
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.activeView = viewButton.dataset.view;
    persist();
    renderTournament();
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === "generate-group-knockout") generateGroupKnockout();
    if (action === "check-league-progress") checkLeagueProgress();
    if (action === "generate-league-finals") generateLeagueFinals();
    if (action === "return-to-tournament") {
      state.activeView = state.settings.format === "groups" ? "matches" : "league";
      renderAll();
      return;
    }
    if (action === "switch-tournament") setActiveTournament(actionButton.dataset.tournamentId);
    if (action === "toggle-lock") toggleTournamentLock();
    if (action === "switch-double-knockout-view") {
      state.doubleKnockoutView = actionButton.dataset.doubleKnockoutView === "losers" ? "losers" : "winners";
      persist();
      renderAll();
    }
  }
});

if (elements.tournamentName) {
  elements.tournamentName.addEventListener("input", (event) => {
    state.settings.name = event.target.value;
    syncTournamentSlugFromName();
    persist();
    renderAll();
  });
}

if (elements.tournamentDate) {
  elements.tournamentDate.addEventListener("change", (event) => {
    state.settings.date = validDate(event.target.value) ? event.target.value : todayISODate();
    normalizeSettings();
    persist();
    renderAll();
  });
}

if (elements.teamCount) {
  elements.teamCount.addEventListener("change", (event) => {
    state.settings.teamCount = clamp(event.target.value, 2, 64);
    if (state.settings.format === "league") applyLeagueDefaultsForTeamCount();
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderAll();
  });
}

if (elements.startTime) {
  elements.startTime.addEventListener("change", (event) => {
    state.settings.startTime = validTime(event.target.value) ? event.target.value : "09:00";
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderAll();
  });
}

if (elements.endTime) {
  elements.endTime.addEventListener("change", (event) => {
    state.settings.endTime = validTime(event.target.value) ? event.target.value : "17:00";
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderAll();
  });
}

if (elements.matchDuration) {
  elements.matchDuration.addEventListener("change", (event) => {
    state.settings.matchDuration = event.target.value;
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderAll();
  });
}

if (elements.breakDuration) {
  elements.breakDuration.addEventListener("change", (event) => {
    state.settings.breakDuration = event.target.value;
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderAll();
  });
}

if (elements.fieldCount) {
  elements.fieldCount.addEventListener("change", (event) => {
    state.settings.fieldCount = event.target.value;
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderAll();
  });
}

if (elements.fieldStart) {
  elements.fieldStart.addEventListener("change", (event) => {
    state.settings.fieldStart = event.target.value;
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderAll();
  });
}

if (elements.doubleKnockoutEnabled) {
  elements.doubleKnockoutEnabled.addEventListener("change", (event) => {
    state.settings.doubleKnockoutEnabled = event.target.checked;
    clearPlanningAdvice();
    persist();
    renderAll();
  });
}

if (elements.groupCount) {
  elements.groupCount.addEventListener("change", (event) => {
    state.settings.groupCount = event.target.value;
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderSetup();
  });
}

if (elements.advancePerGroup) {
  elements.advancePerGroup.addEventListener("change", (event) => {
    state.settings.advancePerGroup = event.target.value;
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderSetup();
  });
}

if (elements.doubleRound) {
  elements.doubleRound.addEventListener("change", (event) => {
    state.settings.doubleRound = event.target.checked;
    clearPlanningAdvice();
    persist();
  });
}

if (elements.leagueMatches) {
  elements.leagueMatches.addEventListener("change", (event) => {
    state.settings.leagueMatches = event.target.value;
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderSetup();
  });
}

if (elements.directQualifiers) {
  elements.directQualifiers.addEventListener("change", (event) => {
    state.settings.directQualifiers = event.target.value;
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderSetup();
  });
}

if (elements.playoffQualifiers) {
  elements.playoffQualifiers.addEventListener("change", (event) => {
    state.settings.playoffQualifiers = event.target.value;
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderSetup();
  });
}

if (elements.playoffEnabled) {
  elements.playoffEnabled.addEventListener("change", (event) => {
    state.settings.playoffEnabled = event.target.checked;
    normalizeSettings();
    clearPlanningAdvice();
    persist();
    renderAll();
  });
}

if (elements.planButton) {
  elements.planButton.addEventListener("click", planTournamentSchedule);
}
if (elements.validateButton) {
  elements.validateButton.addEventListener("click", runTournamentCheck);
}
if (elements.programButton) {
  elements.programButton.addEventListener("click", () => {
    state.activeView = state.activeView === "program" ? (state.settings.format === "groups" ? "matches" : "league") : "program";
    renderAll();
  });
}
if (elements.lockButton) {
  elements.lockButton.addEventListener("click", toggleTournamentLock);
}
if (elements.tournamentPicker) {
  elements.tournamentPicker.addEventListener("change", (event) => {
    setActiveTournament(event.target.value);
  });
}
if (elements.addTournamentButton) {
  elements.addTournamentButton.addEventListener("click", addTournament);
}
if (elements.duplicateTournamentButton) {
  elements.duplicateTournamentButton.addEventListener("click", duplicateTournament);
}
if (elements.deleteTournamentButton) {
  elements.deleteTournamentButton.addEventListener("click", deleteTournament);
}

async function handleAdminLogin(event) {
  event?.preventDefault?.();
  if (authBusy) return;

  const email = elements.authEmail?.value.trim();
  const password = elements.authPassword?.value || "";
  if (!email || !password) {
    setAuthStatus("Vul e-mail en wachtwoord in");
    showStatus("Vul je admin e-mail en wachtwoord in.");
    return;
  }

  try {
    setAuthBusy(true);
    authNotice = null;
    showStatus("Inloggen bij Supabase...");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data?.session) {
      throw new Error(error?.message || "Inloggen is niet gelukt.");
    }

    authNotice = "Beheerrechten controleren...";
    updateAuthUi();
    const access = await verifyAdminSession(data.session);
    if (!access.isAdmin) {
      await supabase.auth.signOut();
      adminSession = null;
      authNotice = "Geen beheerrechten";
      showStatus("Deze account heeft geen beheerrechten.");
      return;
    }

    adminSession = data.session;
    authNotice = null;
    updateAuthUi();
    void refreshRemoteProgram();
    showStatus("Beheerder ingelogd.");
  } catch (error) {
    adminSession = null;
    authNotice = error?.message ? `Inloggen mislukt. ${error.message}` : "Inloggen mislukt";
    showStatus(`Inloggen mislukt. ${error?.message || "Controleer je verbinding."}`);
  } finally {
    setAuthBusy(false);
  }
}

window.addEventListener("online", () => {
  subscribeToRemoteProgram();
  void refreshRemoteProgram();
});

window.addEventListener("focus", () => {
  void refreshRemoteProgram();
});

window.addEventListener("error", (event) => {
  if (!event?.error) return;
  console.error(event.error);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
});

document.addEventListener("input", (event) => {
  const roundInput = event.target.closest(".round-name-input");
  if (!roundInput) return;
  updateBracketRoundName(
    roundInput.dataset.bracketKind,
    Number.parseInt(roundInput.dataset.roundIndex, 10),
    roundInput.value,
  );
});

if (elements.teamFields) {
  elements.teamFields.addEventListener("input", (event) => {
    const input = event.target.closest("[data-team-id]");
    if (!input) return;
    const team = state.teams.find((item) => item.id === input.dataset.teamId);
    if (!team) return;
    team.name = input.value;
    persist();
  });
}

if (elements.generateButton) {
  elements.generateButton.addEventListener("click", generateTournament);
}
if (elements.randomizeLeagueButton) {
  elements.randomizeLeagueButton.addEventListener("click", randomizeLeaguePhase);
}
if (elements.shuffleTeams) {
  elements.shuffleTeams.addEventListener("click", shuffleTeamsList);
}
if (elements.exportButton) {
  elements.exportButton.addEventListener("click", exportTournament);
}
if (elements.importButton) {
  elements.importButton.addEventListener("click", () => elements.importFile?.click());
}
if (elements.importFile) {
  elements.importFile.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) importTournament(file);
    event.target.value = "";
  });
}

if (elements.newButton) {
  elements.newButton.addEventListener("click", () => {
    resetActiveTournament();
  });
}

elements.tournamentContent.addEventListener("input", (event) => {
  const tieStartInput = event.target.closest("[data-tie-start]");
  if (tieStartInput) {
    const tieId = tieStartInput.dataset.tieStart;
    const value = validTime(tieStartInput.value) ? tieStartInput.value : null;
    if (value) {
      state.tieTimeOverrides[tieId] = value;
    } else {
      delete state.tieTimeOverrides[tieId];
    }
    const found = findTie(tieId);
    if (found) found.tie.manualStart = value;
    persist();
    renderTournament();
    return;
  }

  const matchScore = event.target.closest("[data-match]");
  if (matchScore) {
    const match = findMatch(matchScore.dataset.match);
    if (!match) return;
    match[matchScore.dataset.side] = parseScore(matchScore.value);
    persist();
    return;
  }

  const tieScore = event.target.closest("[data-tie]");
  if (!tieScore || tieScore.dataset.side === "winner") return;
  const found = findTie(tieScore.dataset.tie);
  if (!found) return;
  found.tie[tieScore.dataset.side] = parseScore(tieScore.value);
  found.tie.winnerOverride = null;
  updateBracketWinners(found.bracket);
  persist();
});

elements.tournamentContent.addEventListener("change", (event) => {
  const participantSelect = event.target.closest("#participantTeamSelect");
  if (participantSelect) {
    state.selectedTeamId = participantSelect.value;
    persist();
    renderTournament();
    return;
  }

  const scoreInput = event.target.closest("[data-match]");
  if (scoreInput) {
    const match = findMatch(scoreInput.dataset.match);
    if (!match) return;
    match[scoreInput.dataset.side] = parseScore(scoreInput.value);
    persist();
    renderTournament();
    return;
  }

  const tieInput = event.target.closest("[data-tie]");
  if (tieInput) {
    const found = findTie(tieInput.dataset.tie);
    if (!found) return;
    const { bracket, tie } = found;
    const side = tieInput.dataset.side;
    if (side === "winner") {
      tie.winnerOverride = tieInput.value || null;
    } else {
      tie[side] = parseScore(tieInput.value);
      tie.winnerOverride = null;
    }
    updateBracketWinners(bracket);
    persist();
    renderTournament();
  }
});

renderAll();
void bootstrapRemoteState();
