const HOME_VENUE = "Estadio Jesuitas";
const API_BASE_URL = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? `${window.location.protocol}//${window.location.hostname}:10000`
  : "";

let state = null;
let adminSession = { authenticated: false, email: "" };
let csrfToken = "";
let stateSaveInProgress = false;
let activePage = "inicio";
let matchFilter = "todos";
let editingMatchIndex = null;
let editingCallupRound = null;
let toastTimer;

function dateToISO(value) {
  const input = String(value || "").trim();
  let year;
  let month;
  let day;
  let match = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = input.match(/(?:^|\D)(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D|$)/);
    if (!match) return "";
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function localDateISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDate(value) {
  const isoDate = dateToISO(value);
  if (!isoDate) return String(value || "");
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? value : "";
}

function timeFromLegacyDate(value) {
  const match = String(value || "").match(/\b([01]\d|2[0-3]):[0-5]\d\b/);
  return match ? match[0] : "";
}

function formatMatchDate(match) {
  const date = formatDate(match.date);
  const time = validTime(match.time) || timeFromLegacyDate(match.date);
  return [date, time].filter(Boolean).join(" · ");
}

function nextRoundNumber(targetState = state) {
  const latestMatchRound = Math.max(0, ...targetState.matches.map(match => Number(match.round) || 0));
  const latestHistoryRound = Math.max(0, ...targetState.callupHistory.map(entry => Number(entry.round) || 0));
  return Math.max(Number(targetState.match.round) || 1, latestMatchRound + 1, latestHistoryRound + 1);
}

function compareMatchesBySchedule(a, b) {
  const dateA = dateToISO(a.date);
  const dateB = dateToISO(b.date);
  if (dateA && dateB) return dateA.localeCompare(dateB) || a.round - b.round;
  if (dateA) return -1;
  if (dateB) return 1;
  return a.round - b.round;
}

function setNextMatchFromFixture(match, targetState = state) {
  const opponent = match.home === "Carris FC" ? match.away : match.home;
  targetState.match = {
    round: match.round,
    opponent,
    date: dateToISO(match.date),
    time: validTime(match.time) || "—",
    venue: opponent === "Descanso" ? "" : HOME_VENUE
  };
}

function syncNextMatchFromSchedule(targetState = state) {
  const today = localDateISO();
  const nextFixture = targetState.matches
    .filter(match => match.score === "—" && (!dateToISO(match.date) || dateToISO(match.date) >= today))
    .slice()
    .sort(compareMatchesBySchedule)[0];
  const currentDate = dateToISO(targetState.match.date);
  if (nextFixture && (!currentDate || currentDate < today || dateToISO(nextFixture.date) <= currentDate)) {
    setNextMatchFromFixture(nextFixture, targetState);
  } else if (!nextFixture && targetState.match.opponent && (!currentDate || currentDate < today)) {
    targetState.match = {
      round: nextRoundNumber(targetState),
      opponent: "",
      date: "",
      time: "—",
      venue: HOME_VENUE
    };
  }
}

async function apiRequest(path, { method = "GET", body, csrf = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf) headers["X-CSRF-Token"] = csrfToken;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "No se pudo completar la solicitud.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function refreshCsrfToken() {
  const result = await apiRequest("/api/auth/csrf");
  csrfToken = result.csrfToken;
}

async function loadState() {
  const result = await apiRequest("/api/state");
  if (!result || !result.match || !Array.isArray(result.players) || !Array.isArray(result.matches)) {
    throw new Error("La API devolvió datos del club con un formato inesperado.");
  }
  result.match.date = dateToISO(result.match.date);
  if (!validTime(result.match.time) && result.match.time !== "—") result.match.time = "—";
  result.matches.forEach(match => {
    const originalDate = match.date;
    match.date = dateToISO(originalDate);
    if (!validTime(match.time)) match.time = timeFromLegacyDate(originalDate);
  });
  result.callupHistory.forEach(entry => {
    entry.date = dateToISO(entry.date) || entry.date;
  });
  syncNextMatchFromSchedule(result);
  return result;
}

async function initializeApp() {
  document.querySelector("#page-inicio").innerHTML = `<div class="card empty-state connection-loading">Conectando con la base de datos de Carris FC…</div>`;
  try {
    await refreshCsrfToken();
    adminSession = await apiRequest("/api/auth/session");
    state = await loadState();
    updateAdminControls();
    renderAll();
  } catch (error) {
    console.error("No se pudo conectar con Carris FC.", error);
    renderConnectionError(error);
  }
}

function renderConnectionError(error) {
  activePage = "inicio";
  document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === "page-inicio"));
  document.querySelector("#current-section").textContent = "INICIO";
  document.querySelector("#page-inicio").innerHTML = `
    <section class="card connection-error">
      <h1>No se pudo conectar con Carris FC</h1>
      <p>${escapeHtml(error.message || "Comprueba la conexión e inténtalo de nuevo.")}</p>
      <button class="primary-button" data-action="retry-connection">Reintentar</button>
    </section>`;
}

async function saveState(message) {
  if (stateSaveInProgress) {
    showToast("Espera a que termine el guardado actual.");
    return;
  }
  stateSaveInProgress = true;
  try {
    const result = await apiRequest("/api/state", { method: "PUT", body: state, csrf: true });
    state = result.state;
    renderAll();
    if (message) showToast(message);
  } catch (error) {
    console.error("No se pudieron guardar los datos del club.", error);
    try {
      state = await loadState();
      adminSession = await apiRequest("/api/auth/session");
      if (error.status === 401 || error.status === 403) await refreshCsrfToken();
      updateAdminControls(false);
      renderAll();
    } catch (reloadError) {
      console.error("No se pudieron recuperar los datos del servidor.", reloadError);
      renderConnectionError(reloadError);
    }
    showToast(error.message || "No se pudieron guardar los cambios.");
  } finally {
    stateSaveInProgress = false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function playerDorsal(player) {
  const dorsal = Number(player.dorsal);
  return `<span class="player-dorsal" aria-label="Dorsal ${Number.isInteger(dorsal) ? dorsal : "sin asignar"}">#${Number.isInteger(dorsal) ? dorsal : "—"}</span>`;
}

function nextAvailableDorsal() {
  const used = new Set(state.players.map(player => Number(player.dorsal)));
  for (let dorsal = 1; dorsal <= 99; dorsal++) {
    if (!used.has(dorsal)) return dorsal;
  }
  return null;
}

function avatar(player, index = 0) {
  const color = player.color || ["#b8ceaa", "#d9b7a3", "#a8bac3", "#d1c392"][index % 4];
  const dorsal = Number(player.dorsal);
  const label = Number.isInteger(dorsal) ? `#${dorsal}` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="${color}"/><circle cx="60" cy="48" r="23" fill="#f3d9bd"/><path d="M37 45c1-24 46-31 49 1-9-9-19-14-31-13-5 5-11 9-18 12" fill="#493b35"/><path d="M20 120c3-29 17-44 40-44s38 15 40 44" fill="#171513"/><path d="M48 77l12 15 13-15" fill="#ffd21a"/><text x="60" y="111" text-anchor="middle" fill="#fff" opacity=".9" font-family="Arial,sans-serif" font-size="12" font-weight="700">${label}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function getPlayerStatus(status) {
  return status === "personal" ? "No disponible · Personal" : status === "lottery" ? "Desconvocado · Sorteo" : "Convocado";
}

function isGoalkeeper(player) { return String(player.position).toLowerCase() === "portero"; }
function hasInfiniteImmunity(player) { return Boolean(player.infiniteImmunity || isGoalkeeper(player)); }
function hasAnyImmunity(player) { return hasInfiniteImmunity(player) || Boolean(player.immunity); }
function calledPlayers() { return state.players.filter(player => player.status === "called"); }
function absentees(status) { return state.players.filter(player => player.status === status); }
function totalGoals() { return state.players.reduce((sum, player) => sum + Number(player.goals || 0), 0); }
function allCards() { return state.players.reduce((sum, player) => sum + Number(player.yellow || 0) + Number(player.red || 0), 0); }
function isRestMatch(match) { return match.home === "Descanso" || match.away === "Descanso"; }
function matchPlayerStats(match, playerId) {
  return match.playerStats && match.playerStats[playerId] || { goals: 0, yellow: 0, red: 0 };
}
function matchScorers(match) {
  return state.players.map(player => {
    const goals = Number(matchPlayerStats(match, player.id).goals || 0);
    return goals ? `#${player.dorsal} ${player.name}${goals > 1 ? ` (${goals})` : ""}` : "";
  }).filter(Boolean).join(", ");
}
function matchCards(match, field) {
  return state.players.map(player => {
    const count = Number(matchPlayerStats(match, player.id)[field] || 0);
    return count ? `#${player.dorsal} ${player.name}${count > 1 ? ` (${count})` : ""}` : "";
  }).filter(Boolean).join(", ") || "Ninguna";
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function adminBanner() {
  return `<div class="admin-banner">⚙ <span>Sesión de administrador segura · Los cambios se guardan en la base de datos.</span></div>`;
}

function renderHome() {
  const called = calledPlayers();
  const personal = absentees("personal");
  const lottery = absentees("lottery");
  const match = state.match;
  const isRest = match.opponent === "Descanso";
  const hasUpcomingMatch = Boolean(match.opponent);
  document.querySelector("#page-inicio").innerHTML = `
    ${adminBanner()}
    <div class="welcome-copy">
      <div><div class="eyebrow">EL CLUB · LA TEMPORADA 25/26</div><h1 id="welcome-title">Esto es Carris FC<span style="color:var(--lime)">.</span></h1><p>El equipo que somos, dentro y fuera del campo.</p></div>
      <div class="welcome-date">JORNADA ${match.round || 8}<br>TEMPORADA 25/26</div>
    </div>
    <section class="hero-match" aria-label="Próximo partido">
      <div class="hero-top"><span>${hasUpcomingMatch ? `JORNADA ${match.round} · ${isRest ? "JORNADA DE DESCANSO" : "PRÓXIMO PARTIDO"}` : "PRÓXIMO PARTIDO"}</span><span class="match-status"><i class="live-dot"></i> ${isRest ? "ESTA SEMANA DESCANSAMOS" : hasUpcomingMatch ? "ENCUENTRO PRÓXIMO" : "PENDIENTE DE PROGRAMAR"}</span></div>
      ${isRest ? `<div class="rest-matchup"><div class="team-crest"><img src="assets/carris-escudo.jpg" alt=""></div><span class="rest-icon">Ⅱ</span><div><strong>Esta jornada descansamos</strong><small>La liga nos da un respiro. ¡Nos vemos en la próxima!</small></div></div>` : !hasUpcomingMatch ? `<div class="rest-matchup"><div class="team-crest"><img src="assets/carris-escudo.jpg" alt=""></div><span class="rest-icon">◷</span><div><strong>Partido pendiente de programar</strong><small>Pronto publicaremos los detalles de la próxima jornada.</small></div></div>` : `
        <div class="matchup">
          <div class="team"><div class="team-crest"><img src="assets/carris-escudo.jpg" alt=""></div><div><div class="team-name">Carris FC</div><div class="team-caption">EL EQUIPO DE CASA</div></div></div>
          <div class="versus">VS</div>
          <div class="team"><div class="team-crest opponent">${escapeHtml(match.opponent.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase())}</div><div><div class="team-name">${escapeHtml(match.opponent)}</div><div class="team-caption">EL PRÓXIMO RETO</div></div></div>
        </div>`}
      <div class="match-info">${match.date ? `<span><b>◷</b> ${escapeHtml(formatMatchDate(match))}</span>` : ""}${isRest || !hasUpcomingMatch ? "" : `<span><b>⌖</b> ${HOME_VENUE}</span>`}</div>
    </section>
    <div class="dashboard-grid">
      <section class="card">
        <div class="card-header"><div class="card-title"><span class="title-mark">♙</span><h2>Los convocados</h2></div><span class="count-pill">${called.length} jugadores</span></div>
        ${called.length ? `<div class="called-grid">${called.map((player, index) => `<div class="player-tile"><img class="player-photo" src="${avatar(player, index)}" alt="Retrato ilustrado de ${escapeHtml(player.name)}"><strong>${playerDorsal(player)} ${escapeHtml(player.name)}</strong><span class="player-position">${escapeHtml(player.position)}</span></div>`).join("")}</div>` : `<div class="empty-state">La convocatoria todavía no está publicada.</div>`}
      </section>
      <section class="card absent-card">
        <div class="card-header"><div class="card-title"><span class="title-mark">↗</span><h2>Esta jornada</h2></div><span class="count-pill">${personal.length + lottery.length} ausencias</span></div>
        <div class="absent-group"><div class="absent-heading"><i class="status-dot personal"></i> MOTIVOS PERSONALES <span style="color:#9aa39d;font-weight:500">(${personal.length})</span></div>
          <div class="absent-list">${personal.length ? personal.map((player, index) => `<div class="absent-player"><img src="${avatar(player, index)}" alt=""><span class="absent-name">${playerDorsal(player)} ${escapeHtml(player.name)}</span></div>`).join("") : `<span class="player-position">Ninguna ausencia</span>`}</div>
        </div>
        <div class="absent-group"><div class="absent-heading"><i class="status-dot lottery"></i> DESCONVOCADOS <span style="color:#9aa39d;font-weight:500">(${lottery.length})</span></div>
          <div class="absent-list">${lottery.length ? lottery.map((player, index) => `<div class="absent-player"><img src="${avatar(player, index + 2)}" alt=""><span class="absent-name">${playerDorsal(player)} ${escapeHtml(player.name)}</span>${player.immunity ? `<span class="immunity-badge" title="Pase para el próximo sorteo">✳ Inmune</span>` : ""}</div>`).join("") : `<span class="player-position">Ninguna ausencia</span>`}</div>
        </div>
      </section>
    </div>
    <div class="section-spacer"><div class="page-heading"><div><div class="eyebrow">EL VESTUARIO</div><h2 style="margin:7px 0 0;font-size:18px">Un vistazo a la temporada</h2></div><button class="text-button" data-go="plantilla">Ver plantilla →</button></div>
      <div class="stat-grid">${[
        ["Jugadores", state.players.length, "En la plantilla"],
        ["Goles", totalGoals(), "Esta temporada"],
        ["Tarjetas", allCards(), "Amarillas y rojas"],
        ["Partidos", state.matches.filter(match => match.score !== "—" && !isRestMatch(match)).length, "Disputados"]
      ].map(item => `<div class="card stat-card"><div class="stat-label">${item[0]}</div><div class="stat-number">${item[1]}</div><div class="stat-detail">${item[2]}</div></div>`).join("")}</div>
    </div>
    <section class="club-media" aria-label="El club y sus colores">
      <article class="club-photo-card"><img src="assets/carris-equipo.jpg" alt="El equipo Carris FC posa con su camiseta amarilla y negra"><div class="club-photo-copy"><span>FAMILIA CARRIS</span><h2>Un escudo.<br>Un mismo equipo.</h2><p>El orgullo de compartir cada partido.</p></div></article>
      <div class="club-media-side">
        <article class="card kit-card"><div class="kit-image"><img src="assets/carris-camiseta.jpg" alt="Camiseta amarilla y negra de Carris FC"></div><div class="kit-copy"><span class="eyebrow">NUESTROS COLORES</span><h2>Negro y amarillo.</h2><p>La camiseta que nos une.</p><span class="sponsor-label">PATROCINADOR · BERAVI</span></div></article>
        <article class="card social-photo-card"><img src="assets/carris-equipo-amarillo.jpg" alt="Jugadores de Carris FC en el campo"><div><span class="eyebrow">DESDE EL INSTAGRAM DEL EQUIPO</span><h2>Los de siempre.<br>En cada partido.</h2><p>Momentos de nuestra familia dentro y fuera del campo.</p></div></article>
      </div>
      <article class="card sponsor-card"><img src="assets/carris-patrocinio.jpeg" alt="Cartel de bienvenida a Beravi S.L., patrocinador oficial de Carris FC"><div><span class="sponsor-label">PATROCINADOR OFICIAL</span><h2>Beravi S.L.</h2><p>Autonivelantes · Gracias por acompañar a Carris FC esta temporada.</p></div></article>
    </section>
  `;
}

function renderSquad() {
  document.querySelector("#page-plantilla").innerHTML = `
    ${adminBanner()}
    <div class="page-heading"><div><div class="eyebrow">NUESTRO VESTUARIO</div><h1 id="squad-title">La plantilla</h1><p>Los nombres, las historias y las estadísticas de nuestro equipo.</p></div><span class="count-pill">${state.players.length} jugadores</span></div>
    ${activePage === "plantilla" ? adminPanel() : ""}
    <div class="stat-grid">
      <div class="card stat-card"><div class="stat-label">Goles marcados</div><div class="stat-number">${totalGoals()}</div><div class="stat-detail">Entre toda la plantilla</div></div>
      <div class="card stat-card"><div class="stat-label">Amarillas</div><div class="stat-number">${state.players.reduce((s,p)=>s+Number(p.yellow||0),0)}</div><div class="stat-detail">Tarjetas esta temporada</div></div>
      <div class="card stat-card"><div class="stat-label">Rojas</div><div class="stat-number">${state.players.reduce((s,p)=>s+Number(p.red||0),0)}</div><div class="stat-detail">Tarjetas esta temporada</div></div>
      <div class="card stat-card"><div class="stat-label">Convocados</div><div class="stat-number">${calledPlayers().length}</div><div class="stat-detail">Para el próximo partido</div></div>
    </div>
    <section class="card"><div class="card-header"><div class="card-title"><span class="title-mark">♙</span><h2>Todos los jugadores</h2></div><span class="eyebrow">TEMPORADA 25/26</span></div>
      <div class="table-wrap"><table class="roster-table"><thead><tr><th>Jugador</th><th>Dorsal</th><th>Posición</th><th>Goles</th><th>Amarillas</th><th>Rojas</th><th>Inmunidad</th></tr></thead><tbody>
      ${state.players.map((player, index) => {
        const permanent = hasInfiniteImmunity(player);
        const status = permanent ? "infinite" : player.immunity ? "active" : "empty";
        const label = permanent ? (isGoalkeeper(player) ? "Portero fijo" : "Infinita") : player.immunity ? "Temporal" : "Sin inmunidad";
        return `<tr><td><span class="roster-person"><img src="${avatar(player,index)}" alt="">${escapeHtml(player.name)}</span></td><td class="number-cell">${player.dorsal}</td><td>${escapeHtml(player.position)}</td><td class="number-cell">${player.goals}</td><td><span class="yellow-card"></span>${player.yellow}</td><td><span class="red-card"></span>${player.red}</td><td><span class="immunity-display"><i class="immunity-square ${status}" role="img" aria-label="${label}">${status === "infinite" ? "∞" : status === "active" ? "✓" : ""}</i><small>${label}</small></span></td></tr>`;
      }).join("")}
      </tbody></table></div>
    </section>
  `;
}

function leagueTeamsPanel() {
  const teams = Array.isArray(state.teams) ? state.teams : [];
  return `
    <details class="card league-admin-panel">
      <summary>Editar equipos de la liga</summary>
      <div class="league-team-content">
        <p>Carris FC y Descanso son opciones fijas.</p>
        <div class="league-team-list">${teams.map((team, index) => `<div class="league-team-row"><span class="team-number">${index + 1}</span><input data-team-index="${index}" value="${escapeHtml(team)}" ${team === "Carris FC" || team === "Descanso" ? "readonly" : ""} aria-label="Equipo ${index + 1}"><span class="team-kind">${team === "Descanso" ? "Jornada especial" : team === "Carris FC" ? "Nuestro equipo" : "Equipo de liga"}</span></div>`).join("")}</div>
        <div class="admin-actions"><button class="primary-button" data-action="save-teams">Guardar equipos</button></div>
        <div class="edit-fields team-add-fields">
          <div class="field"><label for="new-team-name">Añadir equipo</label><input id="new-team-name" placeholder="Nombre del equipo"></div>
          <div class="field team-add-action"><label>&nbsp;</label><button class="secondary-button" data-action="add-team">Añadir a la lista</button></div>
        </div>
      </div>
    </details>`;
}

function fixtureCreatePanel() {
  const teams = Array.isArray(state.teams) ? state.teams : [];
  return `
    <section class="card fixture-create-panel">
      <h2>Añadir partido</h2>
      <p>Rival y jornada son suficientes; puedes añadir la fecha y la hora más adelante.</p>
      <div class="edit-fields">
        <div class="field"><label for="new-match-round">Jornada</label><input id="new-match-round" type="number" min="1" value="${nextRoundNumber()}"></div>
        <div class="field"><label for="new-match-date">Fecha (opcional)</label><input id="new-match-date" type="date"></div>
        <div class="field" data-regular-match-field><label for="new-match-time">Hora (opcional)</label><input id="new-match-time" type="time"></div>
        <div class="field"><label for="new-match-opponent">Rival</label><select id="new-match-opponent">${teams.filter(team => team !== "Carris FC").map(team => `<option value="${escapeHtml(team)}">${escapeHtml(team === "Descanso" ? "Descanso de liga" : team)}</option>`).join("")}</select></div>
        <div class="field" data-regular-match-field><label for="new-match-location">¿Dónde jugamos?</label><select id="new-match-location"><option value="local">En casa</option><option value="visitante">Como visitantes</option></select></div>
        <p class="fixed-venue-note" data-regular-match-field>Todos los partidos se juegan en <strong>${HOME_VENUE}</strong>.</p>
      </div>
      <div class="admin-actions"><button class="primary-button" data-action="add-fixture">Añadir a partidos</button></div>
    </section>`;
}

function renderMatches() {
  const isAdmin = document.body.classList.contains("admin-mode");
  const matches = state.matches
    .filter(match => matchFilter === "todos" ||
      (matchFilter === "jugados" ? match.score !== "—" : match.score === "—"))
    .slice()
    .sort(compareMatchesBySchedule);
  document.querySelector("#page-partidos").innerHTML = `
    ${adminBanner()}
    <div class="page-heading"><div><div class="eyebrow">EL CAMINO DEL EQUIPO</div><h1 id="matches-title">Partidos</h1><p>Gestiona jornadas, resultados y convocatorias pasadas desde cada partido.</p></div><span class="count-pill">${state.matches.length} jornadas</span></div>
    ${activePage === "partidos" && isAdmin ? fixtureCreatePanel() : ""}
    <div class="filter-row match-filter-row">${[["todos","Todos"],["jugados","Jugados"],["pendientes","Próximos"]].map(([value,label])=>`<button class="filter-chip ${matchFilter===value?"active":""}" data-filter="${value}">${label}</button>`).join("")}</div>
    <div class="fixture-list">${matches.map(match => {
      const matchIndex = state.matches.indexOf(match);
      const hasResult = match.score !== "—";
      const date = dateToISO(match.date);
      const isUpcoming = hasResult === false && (!date || date >= localDateISO());
      const isRest = isRestMatch(match);
      const scorers = matchScorers(match) || match.scorers || "Sin goleadores añadidos";
      const callupEntry = state.callupHistory.find(entry => Number(entry.round) === Number(match.round));
      const canEditCallup = !isRest && (hasResult || Boolean(date && date < localDateISO()));
      const editor = editingMatchIndex === matchIndex ? `
        <div class="match-edit-form">
          <div class="edit-fields">
            <div class="field"><label>Jornada</label><input data-match-field="round" type="number" min="1" value="${match.round}"></div>
            <div class="field"><label>Fecha (opcional)</label><input data-match-field="date" type="date" value="${escapeHtml(date)}"></div>
            <div class="field" ${isRest ? "hidden" : ""}><label>Hora (opcional)</label><input data-match-field="time" type="time" value="${escapeHtml(validTime(match.time) || timeFromLegacyDate(match.date))}"></div>
            <div class="field"><label>Equipo local</label><input data-match-field="home" value="${escapeHtml(match.home)}"></div>
            <div class="field"><label>Equipo visitante</label><input data-match-field="away" value="${escapeHtml(match.away)}"></div>
            <div class="field"><label>Resultado (goles local-visitante)</label><input data-match-field="score" value="${escapeHtml(match.score)}" placeholder="Ej.: 2-1"></div>
            <div class="field field-wide"><label>Detalles del partido</label><input data-match-field="result" value="${escapeHtml(match.result)}"></div>
          </div>
          ${isRest ? "" : `<div class="match-stats-editor"><div class="eyebrow">Estadísticas de Carris FC · goles y tarjetas por jugador</div><div class="table-wrap"><table class="match-stats-table"><thead><tr><th>Jugador</th><th>Goles</th><th>Amarillas</th><th>Rojas</th></tr></thead><tbody>
            ${state.players.map(player => {
              const stats = matchPlayerStats(match, player.id);
              return `<tr data-match-player-id="${player.id}"><td>${playerDorsal(player)} ${escapeHtml(player.name)}</td><td><input data-player-stat="goals" type="number" min="0" step="1" value="${Number(stats.goals || 0)}" aria-label="Goles de ${escapeHtml(player.name)}"></td><td><input data-player-stat="yellow" type="number" min="0" step="1" value="${Number(stats.yellow || 0)}" aria-label="Amarillas de ${escapeHtml(player.name)}"></td><td><input data-player-stat="red" type="number" min="0" step="1" value="${Number(stats.red || 0)}" aria-label="Rojas de ${escapeHtml(player.name)}"></td></tr>`;
            }).join("")}
          </tbody></table></div></div>`}
          <div class="admin-actions"><button class="primary-button" data-action="save-existing-match" data-match-index="${matchIndex}">Guardar partido y resultado</button><button class="secondary-button" data-action="cancel-match-edit">Cancelar</button></div>
        </div>` : "";
      const callupEditor = editingCallupRound === Number(match.round) ? `
        <div class="match-callup-editor">
          <div class="eyebrow">Convocatoria de la jornada ${match.round}</div>
          <p>Registra quién fue convocado, quién quedó fuera por sorteo o quién tuvo motivos personales. El pase temporal queda editable para el próximo sorteo.</p>
          <div class="table-wrap">
            <table class="match-callup-table">
              <thead><tr><th>Jugador</th><th>Situación</th><th>Inmunidad para el próximo sorteo</th></tr></thead>
              <tbody>${state.players.map(player => {
                const playerId = String(player.id);
                const status = callupEntry && callupEntry.statuses[playerId] || "";
                const hasInfinitePass = hasInfiniteImmunity(player);
                return `<tr data-callup-player-id="${escapeHtml(playerId)}">
                  <td>${playerDorsal(player)} ${escapeHtml(player.name)}</td>
                  <td><select data-callup-status aria-label="Situación de ${escapeHtml(player.name)}">
                    <option value="" ${status === "" ? "selected" : ""}>Sin registro</option>
                    <option value="called" ${status === "called" ? "selected" : ""}>Convocado</option>
                    <option value="lottery" ${status === "lottery" ? "selected" : ""} ${isGoalkeeper(player) ? "disabled" : ""}>Desconvocado por sorteo</option>
                    <option value="personal" ${status === "personal" ? "selected" : ""}>Motivos personales</option>
                  </select></td>
                  <td><label class="callup-immunity-toggle"><input data-callup-immunity type="checkbox" ${player.immunity || hasInfinitePass ? "checked" : ""} ${hasInfinitePass ? "disabled" : ""}><span>${hasInfinitePass ? "Inmunidad permanente" : "Pase temporal"}</span></label></td>
                </tr>`;
              }).join("")}</tbody>
            </table>
          </div>
          <div class="admin-actions"><button class="primary-button" data-action="save-match-callup" data-match-round="${match.round}">Guardar convocatoria</button><button class="secondary-button" data-action="cancel-callup-edit">Cancelar</button></div>
        </div>` : "";
      const displayDate = formatMatchDate(match) || "Fecha por confirmar";
      const status = isRest ? "Jornada de descanso" : hasResult ? "Jugado" : isUpcoming ? "Próximo partido" : "Sin resultado";
      const fixtureMain = isRest
        ? `<span class="rest-fixture-label">JORNADA DE DESCANSO</span>`
        : `<span class="fixture-round">JORNADA ${match.round}<small>${status}</small></span><span class="fixture-teams"><span>${escapeHtml(match.home)}</span><span class="fixture-score ${hasResult?"":"fixture-upcoming"}">${escapeHtml(match.score)}</span><span>${escapeHtml(match.away)}</span></span><span class="fixture-date">${escapeHtml(formatMatchDate(match) || "Fecha por confirmar")}</span>`;
      return `<article class="fixture-card">
        <button class="fixture-main fixture-toggle ${isRest ? "rest-fixture-main" : ""}" type="button" data-fixture aria-expanded="false">${fixtureMain}</button>
        <div class="fixture-detail">${isRest ? `<strong>JORNADA DE DESCANSO</strong>` : hasResult ? `<strong>Goleadores: </strong>${escapeHtml(scorers)}<br><strong>Amarillas: </strong>${escapeHtml(matchCards(match, "yellow"))} · <strong>Rojas: </strong>${escapeHtml(matchCards(match, "red"))}<br><strong>Estadio: </strong>${HOME_VENUE}` : `<strong>${isUpcoming ? "Próximo encuentro" : "Sin resultado"}</strong><br>${escapeHtml(displayDate)}${match.date && !isRest ? ` · ${HOME_VENUE}` : ""}`}<br>${escapeHtml(match.result || "")}</div>
        ${isAdmin ? `<div class="fixture-actions"><span class="fixture-admin-status">${status}</span><div class="fixture-action-buttons"><button class="secondary-button match-edit-button" data-action="edit-match" data-match-index="${matchIndex}">${hasResult ? "Editar resultado" : isUpcoming ? "Editar partido" : "Registrar resultado"}</button>${canEditCallup ? `<button class="secondary-button match-edit-button" data-action="edit-match-callup" data-match-round="${match.round}">${callupEntry ? "Editar convocatoria" : "Registrar convocatoria"}</button>` : ""}<button class="danger-button" data-action="delete-match" data-match-index="${matchIndex}" aria-label="Eliminar jornada ${match.round}">Eliminar</button></div></div>` : ""}
        ${editor}
        ${callupEditor}
      </article>`;
    }).join("") || `<div class="card empty-state">No hay partidos en esta categoría.</div>`}</div>
    ${activePage === "partidos" && isAdmin ? leagueTeamsPanel() : ""}
  `;
}

function renderCalls() {
  const called = calledPlayers();
  const personal = absentees("personal");
  const lottery = absentees("lottery");
  const groups = [
    { title: "CONVOCADOS", note: "Disponibles para jugar", players: called, kind: "called" },
    { title: "DESCONVOCADOS POR SORTEO", note: "No jugarán esta jornada", players: lottery, kind: "lottery" },
    { title: "AUSENCIAS · MOTIVOS PERSONALES", note: "No pueden asistir esta jornada", players: personal, kind: "personal" }
  ];
  document.querySelector("#page-convocatorias").innerHTML = `
    ${adminBanner()}
    <div class="page-heading"><div><div class="eyebrow">LA LISTA DE CADA JORNADA</div><h1 id="calls-title">Desconvocados y ausencias</h1><p>Convocados, desconvocados por sorteo y ausencias personales.</p></div><span class="count-pill">Jornada ${state.match.round || 8}</span></div>
    <div class="call-summary"><div class="card summary-box"><strong>${called.length}</strong><span>Convocados</span></div><div class="card summary-box"><strong>${lottery.length}</strong><span>Desconvocados por sorteo</span></div><div class="card summary-box"><strong>${personal.length}</strong><span>Ausencias personales</span></div></div>
    ${groups.map(group=>`<section class="card availability-group"><div class="availability-title"><i class="status-dot ${group.kind}"></i>${group.title}<span class="count-pill">${group.players.length}</span></div><div class="availability-list">${group.players.length?group.players.map((player,index)=>`<div class="availability-person"><img src="${avatar(player,index)}" alt="Retrato de ${escapeHtml(player.name)}"><div><strong>${playerDorsal(player)} ${escapeHtml(player.name)}</strong><small>${escapeHtml(group.note)}${player.immunity&&group.kind==="lottery"?" · ✳ Inmune al siguiente sorteo":""}</small></div></div>`).join(""):`<div class="empty-state" style="grid-column:1/-1">No hay jugadores en esta categoría.</div>`}</div></section>`).join("")}
    <section class="card" style="padding:17px 18px"><div class="card-title"><span class="title-mark">✳</span><h2>¿Cómo funciona el pase de inmunidad?</h2></div><p style="margin:10px 0 0 35px;color:#7a867d;font-size:10px;line-height:1.7">Quien queda fuera por sorteo recibe un pase temporal y no vuelve a entrar mientras haya suficientes jugadores sin pase. Si hacen falta más desconvocatorias, se sortea primero entre quienes ya tienen pase, protegiendo a los que aún no habían quedado fuera cuando sea posible. Si todos tienen pase, se reinician los temporales. La inmunidad infinita nunca se pierde y las ausencias personales no cambian los pases.</p></section>
  `;
}

function renderCallupHistory() {
  const history = state.callupHistory.slice().sort((a, b) => Number(a.round) - Number(b.round));
  const upcomingMatches = state.matches
    .filter(match => match.score === "—" && (!dateToISO(match.date) || dateToISO(match.date) >= localDateISO()) && !isRestMatch(match))
    .slice()
    .sort(compareMatchesBySchedule);
  const scheduledRounds = new Map();
  history.forEach(entry => {
    scheduledRounds.set(Number(entry.round), { entry, date: dateToISO(entry.date) });
  });
  upcomingMatches.forEach(match => {
    const round = Number(match.round);
    const existing = scheduledRounds.get(round);
    scheduledRounds.set(round, {
      entry: existing ? existing.entry : null,
      date: dateToISO(match.date) || (existing && existing.date) || ""
    });
  });
  const matchDate = dateToISO(state.match.date);
  const hasStandaloneNextMatch = Boolean(state.match.opponent && state.match.opponent !== "Descanso" &&
    (!matchDate || matchDate >= localDateISO()) && !scheduledRounds.has(Number(state.match.round)));
  if (hasStandaloneNextMatch) {
    scheduledRounds.set(Number(state.match.round), { entry: null, date: matchDate });
  }
  const scheduledCurrentMatch = upcomingMatches.find(match => Number(match.round) === Number(state.match.round));
  const currentRound = scheduledCurrentMatch
    ? Number(scheduledCurrentMatch.round)
    : upcomingMatches.length
      ? Number(upcomingMatches[0].round)
    : hasStandaloneNextMatch ? Number(state.match.round) : null;
  const rounds = Array.from(scheduledRounds.keys()).filter(Number.isInteger).sort((a, b) => a - b);
  const statusNames = { called: "Convocado", personal: "Motivos personales", lottery: "Desconvocado por sorteo" };
  function statusForRound(round, player) {
    if (round === currentRound) return player.status;
    const info = scheduledRounds.get(round);
    return info && info.entry && info.entry.statuses
      ? info.entry.statuses[String(player.id)] || ""
      : "";
  }
  document.querySelector("#page-historial").innerHTML = `
    <div class="page-heading"><div><div class="eyebrow">TEMPORADA 25/26</div><h1 id="history-title">Historial de convocatorias</h1><p>Un resumen visual de la situación de cada jugador en cada jornada.</p></div><span class="count-pill">${rounds.length} ${rounds.length === 1 ? "jornada" : "jornadas"}</span></div>
    <div class="history-legend" aria-label="Leyenda del historial">
      <span class="history-legend-item"><i class="history-status called"></i>Convocado</span>
      <span class="history-legend-item"><i class="history-status personal"></i>Motivos personales</span>
      <span class="history-legend-item"><i class="history-status lottery"></i>Desconvocado por sorteo</span>
      <span class="history-legend-item"><i class="history-status unrecorded"></i>Sin registro</span>
    </div>
    ${rounds.length ? "" : `<div class="card history-empty"><strong>Aún no hay jornadas en el historial.</strong><span>Las convocatorias se añadirán aquí al confirmar cada sorteo.</span></div>`}
    <section class="card history-card">
      <div class="table-wrap">
        <table class="history-table">
          <thead><tr><th>Jugador</th>${rounds.map(round => {
            const info = scheduledRounds.get(round);
            const isCurrent = round === currentRound;
            const date = info && info.date;
            return `<th><span>J${round}${isCurrent ? " · PRÓXIMA" : ""}</span>${date ? `<small>${escapeHtml(formatDate(date))}</small>` : ""}</th>`;
          }).join("")}<th>Resumen</th></tr></thead>
          <tbody>${state.players.map((player, index) => {
            const statusCounts = { called: 0, personal: 0, lottery: 0 };
            const cells = rounds.map(round => {
              const status = statusForRound(round, player);
              const isKnownStatus = Object.prototype.hasOwnProperty.call(statusCounts, status);
              if (isKnownStatus) statusCounts[status]++;
              const label = isKnownStatus ? statusNames[status] : "Sin registro";
              return `<td><span class="history-status ${isKnownStatus ? status : "unrecorded"}" role="img" aria-label="Jornada ${round}: ${label}" title="Jornada ${round}: ${label}"></span></td>`;
            }).join("");
            return `<tr><td><span class="history-player"><img src="${avatar(player, index)}" alt="">${playerDorsal(player)} ${escapeHtml(player.name)}</span></td>${cells}<td><div class="history-summary" aria-label="${statusCounts.called} convocado, ${statusCounts.personal} por motivos personales, ${statusCounts.lottery} desconvocado por sorteo">
              <span class="called-count"><i></i>${statusCounts.called} Conv.</span><span class="personal-count"><i></i>${statusCounts.personal} Pers.</span><span class="lottery-count"><i></i>${statusCounts.lottery} Sort.</span>
            </div></td></tr>`;
          }).join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCreateCallup() {
  const section = document.querySelector("#page-crear-convocatoria");
  if (!document.body.classList.contains("admin-mode")) {
    section.innerHTML = `<div class="empty-state">Esta pantalla solo está disponible en modo administrador.</div>`;
    return;
  }
  const selectedIds = state.callup.availableIds;
  const desiredPlayers = state.callup.created ? state.callup.desiredPlayers : state.maxCalled;
  const playerById = id => state.players.find(player => String(player.id) === String(id));
  const fixedPlayers = state.callup.fixedIds.map(playerById).filter(Boolean);
  const entrantPlayers = state.callup.entrantIds.map(playerById).filter(Boolean);
  const excludedPlayers = state.callup.excludedIds.map(playerById).filter(Boolean);
  const selectedCount = state.players.filter(player => selectedIds.some(id => String(id) === String(player.id))).length;
  const required = Math.max(0, selectedCount - Number(desiredPlayers || 0));
  section.innerHTML = `
    <div class="admin-banner">⚙ <span>Esta herramienta solo aparece en el menú cuando activas el modo administrador.</span></div>
    <div class="page-heading"><div><div class="eyebrow">GESTIÓN DE JORNADA</div><h1 id="create-callup-title">Crear convocatoria</h1><p>Elige quién está disponible y cuántos jugadores quieres para esta semana.</p></div><span class="count-pill">${selectedCount} disponibles</span></div>
    <section class="card callup-setup">
      <div class="card-header"><div class="card-title"><span class="title-mark">♙</span><h2>Jugadores disponibles</h2></div><span class="eyebrow">MARCA LOS DISPONIBLES</span></div>
      <div class="available-grid">${state.players.map((player,index)=>`<label class="available-player"><input type="checkbox" data-available-player="${player.id}" ${selectedIds.some(id=>String(id)===String(player.id))?"checked":""}><img src="${avatar(player,index)}" alt=""><span><strong>${playerDorsal(player)} ${escapeHtml(player.name)}</strong><small>${isGoalkeeper(player)?"Portero fijo · siempre protegido":hasInfiniteImmunity(player)?"Inmunidad infinita":player.immunity?"Pase de inmunidad":"Disponible para sorteo"}</small></span><i class="availability-check">✓</i></label>`).join("")}</div>
      <div class="callup-controls">
        <div class="field"><label for="callup-max-playing">¿Cuántos quieres que jueguen esta semana?</label><input id="callup-max-playing" type="number" min="1" value="${desiredPlayers}" max="${state.players.length}"></div>
        <button class="primary-button" data-action="create-callup">Crear convocatoria</button>
      </div>
    </section>
    ${state.callup.created ? `
      <div class="callup-summary">
        <div class="card summary-box"><strong>${selectedCount}</strong><span>Disponibles</span></div>
        <div class="card summary-box"><strong>${fixedPlayers.length}</strong><span>${state.callup.completed?"Convocados":"Protegidos inicialmente"}</span></div>
        <div class="card summary-box"><strong>${state.callup.completed?excludedPlayers.length:required}</strong><span>${state.callup.completed?"Desconvocados":"Plazas a sortear"}</span></div>
      </div>
      ${state.callup.completed ? `
        <section class="card callup-result"><div class="availability-title"><i class="status-dot called"></i>CONVOCADOS<span class="count-pill">${fixedPlayers.length}</span></div>
          <div class="availability-list">${fixedPlayers.map((player,index)=>`<div class="availability-person"><img src="${avatar(player,index)}" alt=""><div><strong>${playerDorsal(player)} ${escapeHtml(player.name)}</strong><small>Convocado para esta jornada</small></div></div>`).join("") || `<div class="empty-state">No hay jugadores convocados.</div>`}</div></section>
        <section class="card callup-result"><div class="availability-title"><i class="status-dot lottery"></i>DESCONVOCADOS POR SORTEO<span class="count-pill">${excludedPlayers.length}</span></div>
          <div class="availability-list">${excludedPlayers.map((player,index)=>`<div class="availability-person"><img src="${avatar(player,index)}" alt=""><div><strong>${playerDorsal(player)} ${escapeHtml(player.name)}</strong><small>✳ Inmune al siguiente sorteo</small></div></div>`).join("") || `<div class="empty-state">No hubo desconvocados por sorteo.</div>`}</div></section>
      ` : `
        <section class="card callup-result"><div class="card-header"><div class="card-title"><span class="title-mark">✳</span><h2>Antes del sorteo</h2></div><span class="count-pill">${required} ${required===1?"plaza":"plazas"} por cubrir</span></div>
          <p class="callup-explainer">Los jugadores con pase temporal no entran mientras haya suficientes jugadores sin pase. Si hacen falta más desconvocatorias, los jugadores sin pase quedan protegidos cuando sea posible y se sortea entre quienes ya tenían pase. Si todos tienen pase, se reinician los temporales; la inmunidad infinita nunca se pierde.</p>
        </section>
        <section class="card callup-result"><div class="availability-title"><i class="status-dot called"></i>PROTEGIDOS ANTES DEL SORTEO<span class="count-pill">${fixedPlayers.length}</span></div>
          <div class="availability-list">${fixedPlayers.map((player,index)=>`<div class="availability-person"><img src="${avatar(player,index)}" alt=""><div><strong>${playerDorsal(player)} ${escapeHtml(player.name)}</strong><small>Protegido de este sorteo</small></div></div>`).join("") || `<div class="empty-state">Ningún jugador tiene inmunidad esta jornada.</div>`}</div></section>
        <section class="card callup-result"><div class="availability-title"><i class="status-dot lottery"></i>SIN PASE TEMPORAL<span class="count-pill">${entrantPlayers.length}</span></div>
          <div class="availability-list">${entrantPlayers.map((player,index)=>`<div class="availability-person"><img src="${avatar(player,index)}" alt=""><div><strong>${playerDorsal(player)} ${escapeHtml(player.name)}</strong><small>Entran primero en el sorteo</small></div></div>`).join("") || `<div class="empty-state">${required ? "No hay jugadores sin pase: el sorteo reiniciará los pases temporales si hace falta." : "No hacen falta desconvocatorias esta jornada."}</div>`}</div></section>
        <div class="admin-actions"><button class="primary-button" data-action="draw-callup-lottery">${required?"Realizar sorteo · "+required+" desconvocatorias":"Confirmar convocatoria"}</button></div>
      `}` : ""}
  `;
}

function adminPanel() {
  return `<section class="card admin-panel"><h2>Gestión de plantilla</h2><p>Administra jugadores, posiciones, estadísticas e inmunidades. El rival, la fecha y la hora se gestionan desde Partidos.</p><p class="immunity-help">El pase temporal protege del sorteo mientras haya suficientes jugadores sin pase. Si no alcanza para cubrir las plazas, se reinician los pases temporales y se sortea entre quienes ya habían sido desconvocados. La inmunidad infinita nunca se pierde.</p>
    <div class="edit-fields">
      <div class="field"><label for="new-player">Añadir jugador</label><input id="new-player" placeholder="Nombre y apellidos"></div>
      <div class="field"><label for="new-position">Posición</label><select id="new-position"><option>Portero</option><option>Defensa</option><option>Centrocampista</option><option>Delantero</option></select></div>
      <div class="field"><label for="max-called">Máximo de convocados</label><input id="max-called" type="number" min="1" max="99" value="${state.maxCalled}"></div>
    </div>
    <div class="admin-actions"><button class="primary-button" data-action="add-player">Añadir jugador</button><button class="secondary-button" data-action="save-roster-settings">Guardar máximo de convocados</button></div>
    <div class="table-wrap" style="margin-top:14px"><table class="manage-table"><thead><tr><th>Jugador</th><th>Dorsal</th><th>Posición</th><th>Estado</th><th>Goles</th><th>Amarillas</th><th>Rojas</th><th>Pase temporal</th><th>Inmunidad infinita</th><th>Acciones</th></tr></thead><tbody>
      ${state.players.map(player=>`<tr data-player-id="${escapeHtml(player.id)}"><td><span class="player-manage-name"><img src="${avatar(player)}" alt="">${escapeHtml(player.name)}</span></td><td><input data-field="dorsal" type="number" min="1" max="99" step="1" value="${player.dorsal}" aria-label="Dorsal de ${escapeHtml(player.name)}"></td><td><select data-field="position" aria-label="Posición de ${escapeHtml(player.name)}">${["Portero","Defensa","Centrocampista","Delantero"].map(position=>`<option value="${position}" ${player.position===position?"selected":""}>${position}</option>`).join("")}</select></td><td><select data-field="status"><option value="called" ${player.status==="called"?"selected":""}>Convocado</option><option value="personal" ${player.status==="personal"?"selected":""}>Motivos personales</option><option value="lottery" ${player.status==="lottery"?"selected":""} ${isGoalkeeper(player)?"disabled":""}>Por sorteo</option></select></td><td><input data-field="goals" type="number" min="0" value="${player.goals}"></td><td><input data-field="yellow" type="number" min="0" value="${player.yellow}"></td><td><input data-field="red" type="number" min="0" value="${player.red}"></td><td><input data-field="immunity" type="checkbox" ${player.immunity || hasInfiniteImmunity(player)?"checked":""} ${hasInfiniteImmunity(player)?"disabled":""} aria-label="Pase temporal para ${escapeHtml(player.name)}"></td><td><label class="infinite-toggle" title="${isGoalkeeper(player)?"El portero siempre tiene inmunidad infinita":"Activar o quitar inmunidad infinita"}"><input data-field="infiniteImmunity" type="checkbox" ${hasInfiniteImmunity(player)?"checked":""} ${isGoalkeeper(player)?"disabled":""} aria-label="Inmunidad infinita para ${escapeHtml(player.name)}"><span aria-hidden="true">∞</span></label></td><td><button class="danger-button" data-action="delete-player" data-player-id="${escapeHtml(player.id)}" aria-label="Eliminar a ${escapeHtml(player.name)}">Eliminar</button></td></tr>`).join("")}
    </tbody></table></div><div class="admin-actions"><button class="primary-button" data-action="save-roster">Guardar plantilla y estadísticas</button></div>
  </section>`;
}

function renderAll() {
  renderHome();
  renderSquad();
  renderMatches();
  renderCalls();
  renderCallupHistory();
  renderCreateCallup();
  document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === `page-${activePage}`));
  document.querySelectorAll(".nav-link").forEach(link => link.classList.toggle("active", link.dataset.page === activePage));
  document.querySelector("#create-callup-nav").hidden = !document.body.classList.contains("admin-mode");
  document.querySelector("#current-section").textContent = ({ inicio: "INICIO", plantilla: "LA PLANTILLA", partidos: "PARTIDOS", convocatorias: "DESCONVOCADOS Y AUSENCIAS", historial: "HISTORIAL DE CONVOCATORIAS", "crear-convocatoria": "CREAR CONVOCATORIA" })[activePage];
  document.querySelectorAll(".filter-chip").forEach(button => button.classList.toggle("active", button.dataset.filter === matchFilter));
}

function updateAdminControls(render = true) {
  const enabled = Boolean(adminSession && adminSession.authenticated);
  document.body.classList.toggle("admin-mode", enabled);
  const adminLabel = enabled ? "Cerrar sesión" : "Iniciar sesión";
  document.querySelector("#admin-label").textContent = adminLabel;
  document.querySelector("#admin-toggle").setAttribute("aria-label", enabled ? "Cerrar sesión de administrador" : "Iniciar sesión como administrador");
  document.querySelector("#admin-toggle").title = adminLabel;
  document.querySelector("#admin-toggle").classList.toggle("admin-on", enabled);
  document.querySelector("#mobile-admin").textContent = enabled ? "Salir" : "Admin";
  document.querySelector("#mobile-admin").setAttribute("aria-label", enabled ? "Cerrar sesión de administrador" : "Iniciar sesión como administrador");
  if (!enabled && activePage === "crear-convocatoria") activePage = "inicio";
  if (render && state) renderAll();
}

function openAdminLogin() {
  const dialog = document.querySelector("#admin-login-dialog");
  document.querySelector("#admin-login-form").reset();
  document.querySelector("#login-error").hidden = true;
  dialog.showModal();
  document.querySelector("#login-email").focus();
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const errorMessage = document.querySelector("#login-error");
  const email = document.querySelector("#login-email").value.trim();
  const password = document.querySelector("#login-password").value;
  submitButton.disabled = true;
  errorMessage.hidden = true;
  try {
    await refreshCsrfToken();
    const result = await apiRequest("/api/auth/login", {
      method: "POST",
      body: { email, password },
      csrf: true
    });
    csrfToken = result.csrfToken;
    adminSession = { authenticated: true, email: result.email };
    document.querySelector("#admin-login-dialog").close();
    form.reset();
    updateAdminControls();
    showToast("Sesión de administrador iniciada.");
  } catch (error) {
    errorMessage.textContent = error.message || "No se pudo iniciar sesión.";
    errorMessage.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
}

async function logoutAdmin() {
  try {
    await apiRequest("/api/auth/logout", { method: "POST", csrf: true });
    csrfToken = "";
    adminSession = await apiRequest("/api/auth/session");
    await refreshCsrfToken();
    updateAdminControls();
    showToast("Sesión cerrada.");
  } catch (error) {
    console.error("No se pudo cerrar la sesión.", error);
    showToast(error.message || "No se pudo cerrar la sesión.");
  }
}

function handleAdminToggle() {
  if (adminSession && adminSession.authenticated) {
    logoutAdmin();
    return;
  }
  openAdminLogin();
}

function recordCallupHistory(calledIds, excludedIds) {
  const called = new Set(calledIds.map(String));
  const excluded = new Set(excludedIds.map(String));
  const round = Number(state.match.round) || state.callupHistory.length + 1;
  const entry = {
    round,
    date: state.match.date || "",
    statuses: Object.fromEntries(state.players.map(player => [
      String(player.id),
      called.has(String(player.id)) ? "called" : excluded.has(String(player.id)) ? "lottery" : "personal"
    ]))
  };
  const existingIndex = state.callupHistory.findIndex(item => Number(item.round) === round);
  if (existingIndex < 0) state.callupHistory.push(entry);
  else state.callupHistory[existingIndex] = entry;
  state.callupHistory.sort((a, b) => Number(a.round) - Number(b.round));
}

function createCallup() {
  const availableIds = Array.from(document.querySelectorAll("#page-crear-convocatoria [data-available-player]:checked"), input => Number(input.dataset.availablePlayer));
  const desiredPlayers = Number(document.querySelector("#callup-max-playing").value);
  if (!availableIds.length) {
    showToast("Selecciona al menos un jugador disponible.");
    return;
  }
  if (!Number.isInteger(desiredPlayers) || desiredPlayers < 1) {
    showToast("Indica cuántos jugadores quieres que jueguen.");
    return;
  }
  const available = state.players.filter(player => availableIds.includes(Number(player.id)));
  const protectedPlayers = available.filter(hasAnyImmunity);
  const entrants = available.filter(player => !hasAnyImmunity(player));
  const required = Math.max(0, available.length - desiredPlayers);
  const infinitePlayers = available.filter(hasInfiniteImmunity);
  if (infinitePlayers.length > desiredPlayers) {
    showToast("Hay más jugadores con inmunidad infinita que plazas disponibles. Aumenta el número de jugadores o revisa los disponibles.");
    return;
  }
  state.maxCalled = desiredPlayers;
  state.callup = {
    availableIds: available.map(player => player.id),
    desiredPlayers,
    fixedIds: required ? protectedPlayers.map(player => player.id) : available.map(player => player.id),
    entrantIds: required ? entrants.map(player => player.id) : [],
    excludedIds: [],
    created: true,
    completed: required === 0
  };
  if (required === 0) {
    const availableSet = new Set(available.map(player => String(player.id)));
    state.players.forEach(player => {
      player.status = availableSet.has(String(player.id)) ? "called" : "personal";
    });
    recordCallupHistory(available.map(player => player.id), []);
  }
  saveState(required ? `Convocatoria preparada: ${protectedPlayers.length} protegidos inicialmente y ${entrants.length} jugadores sin pase.` : "Convocatoria creada: todos los disponibles son fijos.");
}

function drawCallupLottery() {
  if (!state.callup.created || state.callup.completed) return;
  const available = state.players.filter(player => state.callup.availableIds.some(id => String(id) === String(player.id)));
  const required = Math.max(0, available.length - Number(state.callup.desiredPlayers || 0));
  const infinitePlayers = available.filter(hasInfiniteImmunity);
  if (infinitePlayers.length > Number(state.callup.desiredPlayers || 0)) {
    showToast("Hay más jugadores con inmunidad infinita que plazas disponibles. Revisa cuántos jugadores quieres convocar.");
    return;
  }
  const eligible = available.filter(player => !hasInfiniteImmunity(player));
  const withoutPass = eligible.filter(player => !player.immunity);
  const withPass = eligible.filter(player => player.immunity);
  const drawFrom = (players, count) => {
    const pool = players.slice();
    const selected = [];
    for (let i = 0; i < count; i++) {
      const index = Math.floor(Math.random() * pool.length);
      selected.push(pool.splice(index, 1)[0]);
    }
    return selected;
  };
  const resetPasses = withoutPass.length < required;
  const excluded = resetPasses
    ? drawFrom(withPass, Math.min(required, withPass.length))
    : drawFrom(withoutPass, required);
  if (resetPasses && excluded.length < required) {
    excluded.push(...drawFrom(withoutPass, required - excluded.length));
  }
  if (resetPasses) {
    state.players.forEach(player => {
      if (!hasInfiniteImmunity(player)) player.immunity = false;
    });
  }
  const excludedIds = excluded.map(player => player.id);
  const calledIds = available.map(player => player.id).filter(id => !excludedIds.some(excludedId => String(excludedId) === String(id)));
  state.players.forEach(player => {
    if (available.some(candidate => candidate.id === player.id)) {
      player.status = excludedIds.some(id => String(id) === String(player.id)) ? "lottery" : "called";
      if (player.status === "lottery" && !hasInfiniteImmunity(player)) player.immunity = true;
    } else {
      player.status = "personal";
    }
  });
  state.callup.fixedIds = calledIds;
  state.callup.excludedIds = excludedIds;
  state.callup.completed = true;
  recordCallupHistory(calledIds, excludedIds);
  saveState(required ? `Sorteo completado: ${required} desconvocatorias${resetPasses ? " y pases temporales reiniciados" : ""}.` : "Convocatoria confirmada.");
}

document.addEventListener("change", event => {
  if (event.target.matches('[data-field="position"]')) {
    const row = event.target.closest("[data-player-id]");
    const goalKeeper = event.target.value === "Portero";
    const status = row.querySelector('[data-field="status"]');
    const lotteryOption = status.querySelector('option[value="lottery"]');
    const infinite = row.querySelector('[data-field="infiniteImmunity"]');
    const temporary = row.querySelector('[data-field="immunity"]');
    lotteryOption.disabled = goalKeeper;
    if (goalKeeper && status.value === "lottery") status.value = "called";
    infinite.disabled = goalKeeper;
    temporary.disabled = goalKeeper || infinite.checked;
    if (goalKeeper) {
      infinite.checked = true;
      temporary.checked = true;
    }
  }
  if (event.target.matches('[data-field="immunity"]')) {
    const infinite = event.target.closest("[data-player-id]").querySelector('[data-field="infiniteImmunity"]');
    if (infinite.checked) event.target.checked = true;
  }
  if (event.target.matches('[data-field="infiniteImmunity"]')) {
    const row = event.target.closest("[data-player-id]");
    const temporary = row.querySelector('[data-field="immunity"]');
    const goalKeeper = row.querySelector('[data-field="position"]').value === "Portero";
    temporary.disabled = goalKeeper || event.target.checked;
    if (event.target.checked) temporary.checked = true;
  }
  if (event.target.id === "new-match-opponent") {
    const regularFields = document.querySelectorAll("[data-regular-match-field]");
    regularFields.forEach(field => { field.hidden = event.target.value === "Descanso"; });
  }
  if (event.target.matches("[data-callup-status]") && event.target.value === "lottery") {
    const row = event.target.closest("[data-callup-player-id]");
    const immunity = row && row.querySelector("[data-callup-immunity]");
    if (immunity && !immunity.disabled) immunity.checked = true;
  }
});

document.addEventListener("click", event => {
  if (!state && !event.target.closest('[data-action="retry-connection"]')) return;
  const nav = event.target.closest("[data-page], [data-go]");
  if (nav) {
    activePage = nav.dataset.page || nav.dataset.go;
    renderAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (event.target.closest("#admin-toggle, #mobile-admin")) { handleAdminToggle(); return; }
  if (event.target.closest("[data-close-login]")) {
    document.querySelector("#admin-login-dialog").close();
    return;
  }
  const filter = event.target.closest("[data-filter]");
  if (filter) { matchFilter = filter.dataset.filter; editingMatchIndex = null; renderMatches(); return; }
  const fixture = event.target.closest("[data-fixture]");
  if (fixture) {
    const card = fixture.closest(".fixture-card");
    const expanded = card.classList.toggle("expanded");
    fixture.setAttribute("aria-expanded", String(expanded));
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "retry-connection") {
    initializeApp();
  } else if (action.dataset.action === "edit-match") {
    editingMatchIndex = Number(action.dataset.matchIndex);
    editingCallupRound = null;
    renderMatches();
  } else if (action.dataset.action === "edit-match-callup") {
    editingMatchIndex = null;
    editingCallupRound = Number(action.dataset.matchRound);
    renderMatches();
  } else if (action.dataset.action === "cancel-match-edit") {
    editingMatchIndex = null;
    renderMatches();
  } else if (action.dataset.action === "cancel-callup-edit") {
    editingCallupRound = null;
    renderMatches();
  } else if (action.dataset.action === "delete-match") {
    const matchIndex = Number(action.dataset.matchIndex);
    const match = state.matches[matchIndex];
    if (!match) return;
    const opponent = match.home === "Carris FC" ? match.away : match.home;
    const matchLabel = `jornada ${match.round} · ${match.home} ${match.score} ${match.away}`;
    if (!window.confirm(`¿Eliminar ${matchLabel}? También se descontarán de las estadísticas acumuladas los goles y tarjetas registrados en este partido. Esta acción no se puede deshacer.`)) return;
    const wasNextMatch = Number(state.match.round) === Number(match.round) && state.match.opponent === opponent;
    state.players.forEach(player => {
      const stats = matchPlayerStats(match, player.id);
      player.goals = Math.max(0, Number(player.goals || 0) - Number(stats.goals || 0));
      player.yellow = Math.max(0, Number(player.yellow || 0) - Number(stats.yellow || 0));
      player.red = Math.max(0, Number(player.red || 0) - Number(stats.red || 0));
    });
    state.matches.splice(matchIndex, 1);
    if (wasNextMatch) {
      const nextRound = Math.max(
        1,
        Number(match.round) + 1,
        ...state.matches.map(item => Number(item.round) + 1),
        ...state.callupHistory.map(item => Number(item.round) + 1)
      );
      state.match = { round: nextRound, opponent: "", date: "", time: "—", venue: HOME_VENUE };
    }
    syncNextMatchFromSchedule();
    editingMatchIndex = null;
    saveState(`Jornada ${match.round} eliminada.`);
  } else if (action.dataset.action === "save-existing-match") {
    const matchIndex = Number(action.dataset.matchIndex);
    const match = state.matches[matchIndex];
    const card = action.closest(".fixture-card");
    const round = Number(card.querySelector('[data-match-field="round"]').value);
    const date = card.querySelector('[data-match-field="date"]').value.trim();
    const time = card.querySelector('[data-match-field="time"]').value.trim();
    const home = card.querySelector('[data-match-field="home"]').value.trim();
    const away = card.querySelector('[data-match-field="away"]').value.trim();
    const score = card.querySelector('[data-match-field="score"]').value.trim() || "—";
    if (!match || !Number.isInteger(round) || round < 1 || (date && !dateToISO(date)) || (time && !validTime(time)) || !home || !away) {
      showToast("Revisa la jornada, la fecha y hora (si las has indicado) y los equipos.");
      return;
    }
    if (state.matches.some((other, index) => index !== matchIndex && Number(other.round) === round)) {
      showToast(`Ya existe un partido en la jornada ${round}.`);
      return;
    }
    if (Number(match.round) !== round && state.callupHistory.some(entry =>
      Number(entry.round) === round && Number(entry.round) !== Number(match.round))) {
      showToast(`Ya existe una convocatoria guardada en la jornada ${round}.`);
      return;
    }
    const updatedStats = {};
    let invalidStats = false;
    if (home !== "Descanso" && away !== "Descanso") {
      card.querySelectorAll("[data-match-player-id]").forEach(row => {
        const stats = {};
        row.querySelectorAll("[data-player-stat]").forEach(input => {
          const value = Number(input.value);
          if (!Number.isInteger(value) || value < 0) invalidStats = true;
          stats[input.dataset.playerStat] = value;
        });
        updatedStats[row.dataset.matchPlayerId] = stats;
      });
    }
    if (invalidStats) {
      showToast("Los goles y las tarjetas deben ser números enteros iguales o mayores que cero.");
      return;
    }
    const oldRound = match.round;
    const oldOpponent = match.home === "Carris FC" ? match.away : match.home;
    const wasNextMatch = Number(state.match.round) === Number(oldRound) && state.match.opponent === oldOpponent;
    state.players.forEach(player => {
      const previous = matchPlayerStats(match, player.id);
      const next = updatedStats[player.id] || { goals: 0, yellow: 0, red: 0 };
      player.goals = Math.max(0, Number(player.goals || 0) - Number(previous.goals || 0) + Number(next.goals || 0));
      player.yellow = Math.max(0, Number(player.yellow || 0) - Number(previous.yellow || 0) + Number(next.yellow || 0));
      player.red = Math.max(0, Number(player.red || 0) - Number(previous.red || 0) + Number(next.red || 0));
    });
    match.round = round;
    match.home = home;
    match.away = away;
    match.score = score;
    match.playerStats = updatedStats;
    match.scorers = isRestMatch(match) ? "Jornada de descanso" : matchScorers(match) || "Sin goleadores añadidos";
    match.result = card.querySelector('[data-match-field="result"]').value.trim() || (isRestMatch(match) ? "Esta jornada descansamos." : "Sin detalles adicionales.");
    match.date = dateToISO(date);
    match.time = validTime(time);
    match.venue = isRestMatch(match) ? "" : HOME_VENUE;
    const linkedCallup = state.callupHistory.find(entry => Number(entry.round) === Number(oldRound));
    if (linkedCallup) {
      linkedCallup.round = round;
      linkedCallup.date = match.date;
    }
    const nextFixture = state.matches
      .filter(other => other !== match && other.score === "—" && (!dateToISO(other.date) || dateToISO(other.date) >= localDateISO()))
      .slice()
      .sort(compareMatchesBySchedule)[0];
    if (wasNextMatch && score !== "—") {
      if (nextFixture) setNextMatchFromFixture(nextFixture);
      else state.match = { round: nextRoundNumber(), opponent: "", date: "", time: "—", venue: HOME_VENUE };
    } else {
      syncNextMatchFromSchedule();
    }
    editingMatchIndex = null;
    saveState(`Jornada ${round} actualizada.`);
  } else if (action.dataset.action === "save-teams") {
    const inputs = Array.from(document.querySelectorAll("[data-team-index]"));
    const updatedTeams = inputs.map(input => input.value.trim());
    const normalized = updatedTeams.map(team => team.toLocaleLowerCase());
    if (updatedTeams.some(team => !team) || new Set(normalized).size !== normalized.length) {
      showToast("Cada equipo debe tener un nombre y no puede haber nombres duplicados.");
      return;
    }
    const renamed = new Map(state.teams.map((team, index) => [team, updatedTeams[index]]));
    state.matches.forEach(match => {
      match.home = renamed.get(match.home) || match.home;
      match.away = renamed.get(match.away) || match.away;
    });
    if (renamed.has(state.match.opponent)) state.match.opponent = renamed.get(state.match.opponent);
    state.teams = updatedTeams;
    saveState("Equipos de la liga actualizados.");
  } else if (action.dataset.action === "add-team") {
    const input = document.querySelector("#new-team-name");
    const name = input.value.trim();
    if (!name) { showToast("Escribe el nombre del equipo."); input.focus(); return; }
    if (state.teams.some(team => team.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      showToast("Ese equipo ya está en la lista.");
      return;
    }
    state.teams.splice(Math.max(0, state.teams.indexOf("Descanso")), 0, name);
    saveState(`${name} añadido a la lista de equipos.`);
  } else if (action.dataset.action === "add-fixture") {
    const round = Number(document.querySelector("#new-match-round").value);
    const date = document.querySelector("#new-match-date").value.trim();
    const time = document.querySelector("#new-match-time").value.trim();
    const opponent = document.querySelector("#new-match-opponent").value;
    const location = document.querySelector("#new-match-location").value;
    const isRest = opponent === "Descanso";
    if (!Number.isInteger(round) || round < 1 || (date && !dateToISO(date)) || (time && !validTime(time)) || !opponent) {
      showToast("Indica una jornada y revisa la fecha y hora si las has añadido.");
      return;
    }
    if (state.matches.some(match => Number(match.round) === round)) {
      showToast(`Ya existe un partido en la jornada ${round}.`);
      return;
    }
    const fixture = {
      round,
      date: dateToISO(date),
      time: isRest ? "" : validTime(time),
      home: isRest || location === "local" ? "Carris FC" : opponent,
      away: isRest ? "Descanso" : location === "local" ? opponent : "Carris FC",
      score: "—",
      scorers: isRest ? "Jornada de descanso" : "Por jugar",
      result: isRest ? "Esta jornada descansamos." : "¡Te esperamos!",
      venue: isRest ? "" : HOME_VENUE,
      playerStats: {}
    };
    state.matches.push(fixture);
    syncNextMatchFromSchedule();
    saveState(isRest ? `Jornada ${round} de descanso añadida.` : `Partido de la jornada ${round} añadido.`);
  } else if (action.dataset.action === "save-roster-settings") {
    const maxCalled = Number(document.querySelector("#max-called").value);
    if (!Number.isInteger(maxCalled) || maxCalled < 1 || maxCalled > 99) {
      showToast("El máximo de convocados debe ser un número entre 1 y 99.");
      return;
    }
    state.maxCalled = maxCalled;
    saveState("Máximo de convocados actualizado.");
  } else if (action.dataset.action === "save-match-callup") {
    const round = Number(action.dataset.matchRound);
    const match = state.matches.find(item => Number(item.round) === round);
    if (!match) {
      showToast("No se encontró el partido de esta convocatoria.");
      return;
    }
    const statuses = {};
    const immunityUpdates = [];
    let invalidCallup = false;
    action.closest(".fixture-card").querySelectorAll("[data-callup-player-id]").forEach(row => {
      const playerId = row.dataset.callupPlayerId;
      const player = state.players.find(item => String(item.id) === playerId);
      const status = row.querySelector("[data-callup-status]").value;
      if (!player || (status === "lottery" && isGoalkeeper(player))) {
        invalidCallup = true;
        return;
      }
      if (status) statuses[playerId] = status;
      if (!hasInfiniteImmunity(player)) {
        immunityUpdates.push([player, row.querySelector("[data-callup-immunity]").checked]);
      }
    });
    if (invalidCallup) {
      showToast("Revisa la convocatoria: el portero no puede quedar desconvocado por sorteo.");
      return;
    }
    immunityUpdates.forEach(([player, immunity]) => { player.immunity = immunity; });
    let entry = state.callupHistory.find(item => Number(item.round) === round);
    if (!entry) {
      entry = { round, date: dateToISO(match.date) || "", statuses: {} };
      state.callupHistory.push(entry);
    }
    entry.date = dateToISO(match.date) || "";
    entry.statuses = statuses;
    state.callupHistory.sort((a, b) => Number(a.round) - Number(b.round));
    editingCallupRound = null;
    saveState(`Convocatoria de la jornada ${round} guardada.`);
  } else if (action.dataset.action === "delete-player") {
    const playerId = String(action.dataset.playerId);
    const player = state.players.find(item => String(item.id) === playerId);
    if (!player) return;
    if (!window.confirm(`¿Eliminar a ${player.name} de la plantilla? También se borrarán sus estadísticas individuales, sus datos del historial de convocatorias y sus goles/tarjetas registrados por jornada. Los resultados de los partidos se conservarán. Esta acción no se puede deshacer.`)) return;
    state.players = state.players.filter(item => String(item.id) !== playerId);
    state.callup.availableIds = state.callup.availableIds.filter(id => String(id) !== playerId);
    state.callup.fixedIds = [];
    state.callup.entrantIds = [];
    state.callup.excludedIds = [];
    state.callup.created = false;
    state.callup.completed = false;
    state.matches.forEach(match => {
      if (Object.prototype.hasOwnProperty.call(match.playerStats, playerId)) {
        delete match.playerStats[playerId];
        match.scorers = matchScorers(match) || "Sin goleadores añadidos";
      }
    });
    state.callupHistory.forEach(entry => { delete entry.statuses[playerId]; });
    saveState(`${player.name} eliminado de la plantilla.`);
  } else if (action.dataset.action === "add-player") {
    const input = document.querySelector("#new-player");
    const name = input.value.trim();
    if (!name) { showToast("Escribe el nombre del jugador."); input.focus(); return; }
    const dorsal = nextAvailableDorsal();
    if (!dorsal) { showToast("No quedan dorsales libres entre el 1 y el 99."); return; }
    const id = Date.now();
    const position = document.querySelector("#new-position").value;
    state.players.push({ id, dorsal, name, position, goals: 0, yellow: 0, red: 0, status: "called", immunity: false, infiniteImmunity: position === "Portero", color: "#b8ceaa" });
    state.callup.availableIds.push(id);
    state.callup.created = false;
    saveState(`${name} se ha añadido a la plantilla.`);
  } else if (action.dataset.action === "create-callup") {
    createCallup();
  } else if (action.dataset.action === "draw-callup-lottery") {
    drawCallupLottery();
  } else if (action.dataset.action === "save-roster") {
    const rows = Array.from(document.querySelectorAll(".manage-table tbody tr"));
    const dorsals = rows.map(row => Number(row.querySelector('[data-field="dorsal"]').value));
    if (dorsals.some(dorsal => !Number.isInteger(dorsal) || dorsal < 1 || dorsal > 99)) {
      showToast("Cada dorsal debe ser un número entero entre 1 y 99.");
      return;
    }
    if (new Set(dorsals).size !== dorsals.length) {
      showToast("No puede haber dorsales duplicados en la plantilla.");
      return;
    }
    let callupNeedsRefresh = false;
    rows.forEach(row => {
      const player = state.players.find(item => String(item.id) === row.dataset.playerId);
      if (!player) return;
      const status = row.querySelector('[data-field="status"]').value;
      const position = row.querySelector('[data-field="position"]').value;
      const infiniteImmunity = position === "Portero" || row.querySelector('[data-field="infiniteImmunity"]').checked;
      const immunity = infiniteImmunity || row.querySelector('[data-field="immunity"]').checked;
      player.dorsal = Number(row.querySelector('[data-field="dorsal"]').value);
      if (player.status !== status || player.position !== position || player.immunity !== immunity || player.infiniteImmunity !== infiniteImmunity) callupNeedsRefresh = true;
      player.status = status;
      player.position = position;
      player.goals = Math.max(0, Number(row.querySelector('[data-field="goals"]').value) || 0);
      player.yellow = Math.max(0, Number(row.querySelector('[data-field="yellow"]').value) || 0);
      player.red = Math.max(0, Number(row.querySelector('[data-field="red"]').value) || 0);
      player.immunity = immunity;
      player.infiniteImmunity = infiniteImmunity;
    });
    const pendingCallupNeedsRefresh = callupNeedsRefresh && state.callup.created;
    if (pendingCallupNeedsRefresh) {
      state.callup.created = false;
      state.callup.completed = false;
      state.callup.fixedIds = [];
      state.callup.entrantIds = [];
      state.callup.excludedIds = [];
    }
    saveState(pendingCallupNeedsRefresh ? "Plantilla guardada. Vuelve a crear la convocatoria para aplicar los cambios." : "Plantilla, convocatoria y estadísticas actualizadas.");
  }
});

document.querySelector("#admin-login-form").addEventListener("submit", handleAdminLogin);
initializeApp();
