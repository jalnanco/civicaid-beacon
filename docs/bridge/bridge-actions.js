import { SHELTER_STATE } from "../site-actions.js";

export function registerActions(actions) {
  actions.register({
    name: "get_shelter_board_state",
    description: "Read public accessible shelter bay availability and solar microgrid telemetry. Changes nothing.",
    effect: "read",
    availability: "bridge",
    callers: ["*"],
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => ({
      ok: true,
      region: SHELTER_STATE.region,
      shelters: SHELTER_STATE.shelters
    })
  });

  actions.register({
    name: "lookup_shelter_capacity",
    description: "Filter accessible disaster shelters by party size and medical refrigeration. Changes nothing.",
    effect: "read",
    availability: "bridge",
    callers: ["*"],
    parameters: {
      type: "object",
      properties: {
        partySize: { type: "integer" },
        requireStepFree: { type: "boolean" },
        requireMedicalFridge: { type: "boolean" }
      },
      required: ["partySize"],
      additionalProperties: false
    },
    handler: async ({ partySize = 1, requireStepFree = true, requireMedicalFridge = false } = {}) => ({
      ok: true,
      matches: SHELTER_STATE.shelters.filter(
        (s) =>
          s.openBays >= partySize &&
          (!requireStepFree || s.adaStepFree) &&
          (!requireMedicalFridge || s.medicalFridge2to8C)
      )
    })
  });
}
