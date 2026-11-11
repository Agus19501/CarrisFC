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
