export const SHELTER_STATE = {
  stateVersion: 1,
  region: "Metro Bay Coastal Sector",
  shelters: [
    {
      code: "SH-BAY-101",
      name: "Harbor Civic Resilience Center",
      distanceKm: 1.2,
      openBays: 34,
      adaStepFree: true,
      solarMicrogridKw: 120,
      medicalFridge2to8C: true,
      sensoryQuietRoom: true,
      nearestDepot: "DEPOT-NORTH-01"
    },
    {
      code: "SH-HILL-204",
      name: "Eastview Community Gymnasium",
      distanceKm: 2.6,
      openBays: 58,
      adaStepFree: true,
      solarMicrogridKw: 65,
      medicalFridge2to8C: true,
      sensoryQuietRoom: false,
      nearestDepot: "DEPOT-EAST-02"
    },
    {
      code: "SH-PARK-309",
      name: "Westpark Elementary Annex",
      distanceKm: 3.4,
      openBays: 19,
      adaStepFree: false,
      solarMicrogridKw: 30,
      medicalFridge2to8C: false,
      sensoryQuietRoom: true,
      nearestDepot: "DEPOT-EAST-02"
    }
  ],
  reservations: []
};

export function registerActions(actions) {
  actions.register({
    name: "get_shelter_board_state",
    description: "Read live shelter capacities, ADA step-free bays, solar microgrid power, and current stateVersion. Read-only.",
    effect: "read",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => ({
      ok: true,
      stateVersion: SHELTER_STATE.stateVersion,
      region: SHELTER_STATE.region,
      shelters: SHELTER_STATE.shelters,
      reservationsCount: SHELTER_STATE.reservations.length
    })
  });

  actions.register({
    name: "lookup_shelter_capacity",
    description: "Filter shelters by party size, step-free wheelchair requirement, and 2-8C medical fridge support. Read-only.",
    effect: "read",
    parameters: {
      type: "object",
      properties: {
        partySize: { type: "integer", description: "Evacuee household size." },
        requireStepFree: { type: "boolean", description: "Require ADA step-free ramp access." },
        requireMedicalFridge: { type: "boolean", description: "Require 2-8C biologic refrigeration." }
      },
      required: ["partySize"],
      additionalProperties: false
    },
    handler: async ({ partySize = 1, requireStepFree = true, requireMedicalFridge = false } = {}) => {
      const matches = SHELTER_STATE.shelters.filter(
        (s) =>
          s.openBays >= partySize &&
          (!requireStepFree || s.adaStepFree) &&
          (!requireMedicalFridge || s.medicalFridge2to8C)
      );
      return { ok: true, stateVersion: SHELTER_STATE.stateVersion, matches };
    }
  });

  actions.register({
    name: "commit_emergency_reservation",
    description: "Commit a verified accessible shelter bay and anonymous cold-chain kit hold onto the local dispatch board. Mutating write action requiring explicit human confirmation.",
    effect: "write",
    requiresConfirmation: true,
    parameters: {
      type: "object",
      properties: {
        shelterCode: { type: "string", description: "Target shelter code such as SH-BAY-101." },
        partySize: { type: "integer", description: "Number of evacuees (1-12)." },
        depotCode: { type: "string", description: "Matched peer medical depot code." },
        supplySummary: { type: "string", description: "Anonymous supply hold description." },
        expectedVersion: { type: "integer", description: "Optimistic concurrency stateVersion." }
      },
      required: ["shelterCode", "partySize", "depotCode", "supplySummary"],
      additionalProperties: false
    },
    handler: async ({ shelterCode, partySize, depotCode, supplySummary, expectedVersion }) => {
      if (typeof expectedVersion === "number" && expectedVersion !== SHELTER_STATE.stateVersion) {
        return {
          ok: false,
          reason: `State version changed (expected ${expectedVersion}, current ${SHELTER_STATE.stateVersion}). Re-read before committing.`
        };
      }
      const target = SHELTER_STATE.shelters.find((s) => s.code === shelterCode);
      if (!target || target.openBays < partySize) {
        return { ok: false, reason: "Selected shelter lacks sufficient open bays." };
      }
      target.openBays -= partySize;
      SHELTER_STATE.stateVersion += 1;
      const receiptId = `CAB-${Date.now().toString(36).toUpperCase().slice(-6)}`;
      const record = {
        receiptId,
        shelterCode: target.code,
        shelterName: target.name,
        partySize,
        depotCode,
        supplySummary,
        committedAt: new Date().toISOString()
      };
      SHELTER_STATE.reservations.unshift(record);
      return { ok: true, stateVersion: SHELTER_STATE.stateVersion, receipt: record };
    }
  });
}
