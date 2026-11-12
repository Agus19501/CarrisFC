const HOME_VENUE = "Estadio Jesuitas";
const PLAYER_STATUSES = new Set(["called", "personal", "lottery"]);
const POSITIONS = new Set(["Portero", "Defensa", "Centrocampista", "Delantero"]);

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, field, maxLength, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && !value.trim())) {
    throw invalid(`${field} no es válido.`);
  }
  return value.trim();
}

function count(value, field, max = 100000) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw invalid(`${field} no es válido.`);
  return value;
}

function dateOnly(value, field, allowEmpty = false) {
  const result = text(value, field, 10, allowEmpty);
  if (!result && allowEmpty) return result;
  const match = result.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw invalid(`${field} debe tener una fecha válida.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw invalid(`${field} debe tener una fecha válida.`);
  }
  return result;
}

function identifier(value, field) {
  if ((typeof value !== "string" && typeof value !== "number") ||
    !String(value).trim() || String(value).length > 64) {
    throw invalid(`${field} no es válido.`);
  }
  return value;
}

function validateState(input) {
  if (!isRecord(input) || !isRecord(input.match) || !Array.isArray(input.teams) ||
    !Array.isArray(input.players) || !Array.isArray(input.matches) ||
    !isRecord(input.callup) || !Array.isArray(input.callupHistory)) {
    throw invalid("La estructura de los datos del club no es válida.");
  }
  if (input.teams.length < 2 || input.teams.length > 100 ||
    input.players.length > 99 || input.matches.length > 200 || input.callupHistory.length > 200) {
    throw invalid("Se ha superado el límite permitido de elementos.");
  }

  const teams = input.teams.map(team => text(team, "Equipo", 80));
  const normalizedTeams = teams.map(team => team.toLocaleLowerCase());
  if (new Set(normalizedTeams).size !== teams.length ||
    !teams.includes("Carris FC") || !teams.includes("Descanso")) {
    throw invalid("La lista de equipos debe ser única e incluir Carris FC y Descanso.");
  }

  const playerIds = new Set();
  const dorsals = new Set();
  const players = input.players.map((player, index) => {
    const field = `Jugador ${index + 1}`;
    if (!isRecord(player)) throw invalid(`${field} no es válido.`);
    const id = identifier(player.id, `${field}: identificador`);
    const idKey = String(id);
    const dorsal = player.dorsal;
    if (playerIds.has(idKey)) throw invalid("Hay identificadores de jugador duplicados.");
    if (!Number.isInteger(dorsal) || dorsal < 1 || dorsal > 99 || dorsals.has(dorsal)) {
      throw invalid("Los dorsales deben ser únicos y estar entre 1 y 99.");
    }
    if (!POSITIONS.has(player.position) || !PLAYER_STATUSES.has(player.status)) {
      throw invalid(`${field}: posición o estado no válido.`);
    }
    if (typeof player.immunity !== "boolean" || typeof player.infiniteImmunity !== "boolean") {
      throw invalid(`${field}: las inmunidades no son válidas.`);
    }
    if (typeof player.color !== "string" || !/^#[0-9a-f]{6}$/i.test(player.color)) {
      throw invalid(`${field}: color no válido.`);
    }
    playerIds.add(idKey);
    dorsals.add(dorsal);
    const infiniteImmunity = player.infiniteImmunity || player.position === "Portero";
    return {
      id,
      dorsal,
      name: text(player.name, `${field}: nombre`, 100),
      position: player.position,
      goals: count(player.goals, `${field}: goles`),
      yellow: count(player.yellow, `${field}: amarillas`),
      red: count(player.red, `${field}: rojas`),
      status: player.status,
      immunity: player.immunity || infiniteImmunity,
      infiniteImmunity,
      color: player.color
    };
  });

  if (!isRecord(input.match) || !Number.isInteger(input.match.round) || input.match.round < 1) {
    throw invalid("Los datos del próximo partido no son válidos.");
  }
  const match = {
    round: input.match.round,
    opponent: text(input.match.opponent, "Rival", 80, true),
    date: dateOnly(input.match.date, "Fecha", true),
    time: text(input.match.time, "Hora", 40, true),
    venue: HOME_VENUE
  };

  const matchRounds = new Set();
  const matches = input.matches.map((item, index) => {
    const field = `Partido ${index + 1}`;
    if (!isRecord(item) || !Number.isInteger(item.round) || item.round < 1 ||
      matchRounds.has(item.round) || !isRecord(item.playerStats)) {
      throw invalid(`${field} no es válido o repite una jornada.`);
    }
    matchRounds.add(item.round);
    if (Object.keys(item.playerStats).length > 99) {
      throw invalid(`${field}: demasiadas estadísticas de jugadores.`);
    }
    const playerStatsEntries = [];
    for (const [playerId, stats] of Object.entries(item.playerStats)) {
      if (playerId.length > 64 || !isRecord(stats)) throw invalid(`${field}: estadísticas no válidas.`);
      playerStatsEntries.push([playerId, {
        goals: count(stats.goals, `${field}: goles`),
        yellow: count(stats.yellow, `${field}: amarillas`),
        red: count(stats.red, `${field}: rojas`)
      }]);
    }
    const isRest = item.home === "Descanso" || item.away === "Descanso";
    return {
      round: item.round,
      date: dateOnly(item.date, `${field}: fecha`, true),
      time: item.time === undefined ? "" : text(item.time, `${field}: hora`, 40, true),
      home: text(item.home, `${field}: equipo local`, 80),
      away: text(item.away, `${field}: equipo visitante`, 80),
      score: text(item.score, `${field}: resultado`, 30),
      scorers: text(item.scorers, `${field}: goleadores`, 500, true),
      result: text(item.result, `${field}: detalles`, 500, true),
      venue: isRest ? "" : HOME_VENUE,
      playerStats: Object.fromEntries(playerStatsEntries)
    };
  });

  const maxCalled = input.maxCalled;
  if (!Number.isInteger(maxCalled) || maxCalled < 1 || maxCalled > 99) {
    throw invalid("El máximo de convocados no es válido.");
  }
  const callup = input.callup;
  const idLists = ["availableIds", "fixedIds", "entrantIds", "excludedIds"];
  const validatedCallup = {};
  for (const name of idLists) {
    if (!Array.isArray(callup[name]) || callup[name].length > players.length) {
      throw invalid(`La lista ${name} de la convocatoria no es válida.`);
    }
    const ids = callup[name].map(value => identifier(value, `Convocatoria: ${name}`));
    if (new Set(ids.map(String)).size !== ids.length || ids.some(id => !playerIds.has(String(id)))) {
      throw invalid(`La lista ${name} contiene jugadores que no existen.`);
    }
    validatedCallup[name] = ids;
  }
  if (!Number.isInteger(callup.desiredPlayers) || callup.desiredPlayers < 1 ||
    callup.desiredPlayers > 99 || typeof callup.created !== "boolean" ||
    typeof callup.completed !== "boolean") {
    throw invalid("La configuración de la convocatoria no es válida.");
  }
  const availableIds = new Set(validatedCallup.availableIds.map(String));
  if ([...validatedCallup.fixedIds, ...validatedCallup.entrantIds, ...validatedCallup.excludedIds]
    .some(id => !availableIds.has(String(id)))) {
    throw invalid("La convocatoria contiene jugadores que no estaban disponibles.");
  }
  Object.assign(validatedCallup, {
    desiredPlayers: callup.desiredPlayers,
    created: callup.created,
    completed: callup.completed
  });

  const historyRounds = new Set();
  const callupHistory = input.callupHistory.map((entry, index) => {
    if (!isRecord(entry) || !Number.isInteger(entry.round) || entry.round < 1 ||
      historyRounds.has(entry.round) || !isRecord(entry.statuses)) {
      throw invalid(`La jornada ${index + 1} del historial no es válida.`);
    }
    if (Object.keys(entry.statuses).length > 99) {
      throw invalid(`La jornada ${index + 1} del historial tiene demasiados jugadores.`);
    }
    historyRounds.add(entry.round);
    const statuses = [];
    for (const [playerId, status] of Object.entries(entry.statuses)) {
      if (playerId.length > 64 || !PLAYER_STATUSES.has(status)) {
        throw invalid("El historial contiene un estado no válido.");
      }
      statuses.push([playerId, status]);
    }
    return {
      round: entry.round,
      date: text(entry.date, "Fecha del historial", 100, true),
      statuses: Object.fromEntries(statuses)
    };
  });

  return { match, maxCalled, teams, players, matches, callup: validatedCallup, callupHistory };
}

module.exports = { validateState };
