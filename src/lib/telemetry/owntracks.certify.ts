/**
 * Certificación parser + auth OwnTracks (sin I/O).
 * Ejecutar: npx tsx src/lib/telemetry/owntracks.certify.ts
 */

import {
  authenticateOwnTracksRequest,
  parseBasicAuthorization,
} from "./auth";
import {
  parseOwnTracksPayload,
  parseOwnTracksTopic,
  tstToDate,
} from "./owntracks";

function assert(condition: boolean, label: string) {
  if (!condition) {
    throw new Error(`FAIL: ${label}`);
  }
  console.log(`OK: ${label}`);
}

function basicHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

const SECRET = "fleet-secret-owntracks";

assert(
  authenticateOwnTracksRequest({
    authorizationHeader: basicHeader("juan", SECRET),
    secret: "",
  }).ok === false,
  "fail closed si falta el secreto",
);

assert(
  authenticateOwnTracksRequest({
    authorizationHeader: null,
    secret: SECRET,
  }).ok === false,
  "sin Authorization → 401",
);

const okBasic = authenticateOwnTracksRequest({
  authorizationHeader: basicHeader("juan", SECRET),
  secret: SECRET,
});
assert(okBasic.ok === true && okBasic.username === "juan", "Basic válido");

assert(
  authenticateOwnTracksRequest({
    authorizationHeader: basicHeader("juan", "otro"),
    secret: SECRET,
  }).ok === false,
  "password incorrecto → 401",
);

assert(
  authenticateOwnTracksRequest({
    authorizationHeader: basicHeader("otro", SECRET),
    secret: SECRET,
    fleetUser: "flota",
  }).ok === false,
  "fleet user distinto → 401",
);

assert(
  authenticateOwnTracksRequest({
    authorizationHeader: basicHeader("flota", SECRET),
    secret: SECRET,
    fleetUser: "flota",
  }).ok === true,
  "fleet user coincidente → ok",
);

assert(
  authenticateOwnTracksRequest({
    authorizationHeader: `Bearer ${SECRET}`,
    secret: SECRET,
  }).ok === true,
  "Bearer válido",
);

const parsedBasic = parseBasicAuthorization(
  basicHeader("user", "p:ass:with:colons"),
);
assert(
  parsedBasic?.username === "user" && parsedBasic.password === "p:ass:with:colons",
  "Basic admite ':' en el password",
);

assert(
  parseOwnTracksTopic("owntracks/573001112233/moto-1")?.user ===
    "573001112233" &&
    parseOwnTracksTopic("owntracks/573001112233/moto-1")?.device === "moto-1",
  "topic owntracks/user/device",
);

assert(
  parseOwnTracksTopic("owntracks/juan/phone/event")?.device === "phone",
  "topic con segmento extra usa user/device",
);

const tst = tstToDate(1_700_000_000);
assert(
  tst !== null && tst.toISOString() === "2023-11-14T22:13:20.000Z",
  "tst epoch segundos → timestamptz",
);

const location = {
  _type: "location",
  lat: 4.4389,
  lon: -75.2322,
  tst: 1_700_000_000,
  acc: 12,
  vel: 34,
  cog: 180,
  tid: "JX",
  topic: "owntracks/573001112233/moto-1",
};

const parsedOne = parseOwnTracksPayload(location);
assert(parsedOne.locations.length === 1, "objeto location se acepta");
assert(parsedOne.locations[0].latitude === 4.4389, "lat");
assert(parsedOne.locations[0].longitude === -75.2322, "lon");
assert(parsedOne.locations[0].accuracyM === 12, "acc");
assert(parsedOne.locations[0].velocityKmh === 34, "vel");
assert(parsedOne.locations[0].bearingDeg === 180, "cog");
assert(
  parsedOne.locations[0].identity?.user === "573001112233" &&
    parsedOne.locations[0].identity?.device === "moto-1",
  "user/device desde topic",
);
assert(
  parsedOne.locations[0].recordedAt.toISOString() ===
    "2023-11-14T22:13:20.000Z",
  "recordedAt desde tst",
);

const parsedArray = parseOwnTracksPayload([
  { _type: "lwt", tst: 1 },
  location,
  { _type: "waypoint", lat: 1, lon: 1 },
]);
assert(
  parsedArray.locations.length === 1 && parsedArray.skipped === 2,
  "array: solo _type=location",
);

const invalidLat = parseOwnTracksPayload({
  ...location,
  lat: 91,
});
assert(invalidLat.locations.length === 0, "lat fuera de rango se descarta");

const invalidLon = parseOwnTracksPayload({
  ...location,
  lon: -181,
});
assert(invalidLon.locations.length === 0, "lon fuera de rango se descarta");

const fallback = parseOwnTracksPayload(
  {
    _type: "location",
    lat: 4.4,
    lon: -75.2,
    tst: 1_700_000_000,
    tid: "AB",
  },
  { user: "juan", device: "android-1" },
);
assert(
  fallback.locations[0]?.identity?.user === "juan" &&
    fallback.locations[0]?.identity?.device === "android-1",
  "fallback user/device si no hay topic",
);

console.log("owntracks.certify: OK");
