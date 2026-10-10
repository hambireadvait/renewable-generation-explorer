// Shared client state. Nothing here is persisted except saved scenarios (see scenarios.js).
export const state = {
  defaults: null,   // GET /api/defaults
  providers: null,  // GET /api/providers
  map: null,
  area: null,       // drawn region {south, west, north, east} or null
  label: null,      // human label for the current location
  route: "landing",
  last: { forecast: null, longterm: null }, // { request, payload }
  status: { forecast: "idle", longterm: "idle" }, // idle | loading | ok | error
  error: { forecast: null, longterm: null },
  pending: {},     // request currently loading, per view
  controllers: {},
};
