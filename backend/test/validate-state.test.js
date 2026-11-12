const assert = require("node:assert/strict");
const test = require("node:test");
const { createEmptyState } = require("../src/default-state");
const { validateState } = require("../src/validate-state");

test("accepts and sanitizes the empty club state", () => {
  const input = createEmptyState();
  input.callup.unrecognized = "discard this";
  const state = validateState(input);
  assert.deepEqual(state, createEmptyState());
});

test("rejects duplicated player dorsals", () => {
  const input = createEmptyState();
  input.players = [
    { id: 1, dorsal: 7, name: "Jugador 1", position: "Defensa", goals: 0, yellow: 0, red: 0, status: "called", immunity: false, infiniteImmunity: false, color: "#123456" },
    { id: 2, dorsal: 7, name: "Jugador 2", position: "Delantero", goals: 0, yellow: 0, red: 0, status: "called", immunity: false, infiniteImmunity: false, color: "#654321" }
  ];
  assert.throws(() => validateState(input), /dorsales deben ser únicos/);
});

test("keeps infinite immunity reflected in the temporary pass", () => {
  const input = createEmptyState();
  input.players = [
    { id: 1, dorsal: 1, name: "Portero", position: "Portero", goals: 0, yellow: 0, red: 0, status: "called", immunity: false, infiniteImmunity: false, color: "#123456" },
    { id: 2, dorsal: 2, name: "Inmune", position: "Defensa", goals: 0, yellow: 0, red: 0, status: "called", immunity: false, infiniteImmunity: true, color: "#654321" }
  ];

  const state = validateState(input);
  assert.equal(state.players[0].infiniteImmunity, true);
  assert.equal(state.players[0].immunity, true);
  assert.equal(state.players[1].infiniteImmunity, true);
  assert.equal(state.players[1].immunity, true);
});

test("stores match dates as calendar dates with a separate kick-off time", () => {
  const input = createEmptyState();
  input.matches.push({
    round: 4,
    date: "2026-11-15",
    time: "10:30",
    home: "Carris FC",
    away: "Descanso",
    score: "—",
    scorers: "Jornada de descanso",
    result: "Esta jornada descansamos.",
    playerStats: {}
  });
  const state = validateState(input);
  assert.equal(state.matches[0].date, "2026-11-15");
  assert.equal(state.matches[0].time, "10:30");

  input.matches[0].date = "";
  input.matches[0].time = "";
  const unscheduledState = validateState(input);
  assert.equal(unscheduledState.matches[0].date, "");
  assert.equal(unscheduledState.matches[0].time, "");

  input.matches[0].date = "2026-02-31";
  assert.throws(() => validateState(input), /fecha válida/);
});
