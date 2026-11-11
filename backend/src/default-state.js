function createEmptyState() {
  return {
    match: { round: 1, opponent: "", date: "", time: "—", venue: "Estadio Jesuitas" },
    maxCalled: 8,
    teams: ["Carris FC", "Descanso"],
    players: [],
    matches: [],
    callup: {
      availableIds: [],
      desiredPlayers: 8,
      fixedIds: [],
      entrantIds: [],
      excludedIds: [],
      created: false,
      completed: false
    },
    callupHistory: []
  };
}

module.exports = { createEmptyState };
