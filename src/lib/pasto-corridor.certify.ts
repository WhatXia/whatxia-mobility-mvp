/**
 * Certificación — corredor Pasto ↔ Tangua / Nariño / Chachagüí / Buesaco / El Tablón.
 * Ejecutar: npx tsx src/lib/pasto-corridor.certify.ts
 */
export {};

import {
  buildCityScopedPlaceQuery,
  resolveCityFromPointSync,
  isPointInCity,
  outOfCityServiceMessage,
  type City,
} from "@/lib/city/context";
import {
  PASTO_CORRIDOR_GOOGLE_CITIES,
  PASTO_CORRIDOR_SLUGS,
  buildDropoffPlaceQuery,
  dispatchFleetCity,
  driverServesOriginCity,
  dropoffNotAllowedMessage,
  dropoffSearchScopeCity,
  filterCandidatesForDropoff,
  isAllowedDropoffPoint,
  isAuthorizedCorridorPair,
  matchDriverFleetCity,
  matchMunicipalityCity,
  operationalTripCity,
  placeSearchBiasCircle,
  placeSearchBiasCity,
  preferMunicipalityPlaces,
  EL_TABLON_GOOGLE_LANDMARKS,
} from "@/lib/city/corridors";
import {
  planTripCompletion,
  pricingModeForCitySlug,
  shouldFinalizeFare,
} from "@/lib/city/pricing";
import { canAcceptTripInCity, filterDriversByTripCity } from "@/lib/city/isolation";
import { isDraftReadyToPublish, requiresFareQuote } from "@/lib/booking/flow";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

function city(
  id: string,
  slug: string,
  name: string,
  region: string,
  lat: number,
  lng: number,
  radiusMeters: number,
): City {
  return {
    id,
    slug,
    name,
    region,
    countryCode: "CO",
    center: { lat, lng },
    radiusMeters,
    active: true,
  };
}

const ibague = city(
  "city-ibague",
  "ibague",
  "Ibagué",
  "Tolima",
  4.4389,
  -75.2322,
  18000,
);
const pasto = city(
  "city-pasto",
  "pasto",
  "Pasto",
  "Nariño",
  1.2136,
  -77.2811,
  20000,
);

const satellites = PASTO_CORRIDOR_GOOGLE_CITIES.map((row) =>
  city(
    `city-${row.slug}`,
    row.slug,
    row.name,
    row.region,
    row.center.lat,
    row.center.lng,
    row.radiusMeters,
  ),
);

const tangua = satellites.find((c) => c.slug === "tangua")!;
const narino = satellites.find((c) => c.slug === "narino")!;
const chachagui = satellites.find((c) => c.slug === "chachagui")!;
const buesaco = satellites.find((c) => c.slug === "buesaco")!;
const elTablon = satellites.find((c) => c.slug === "el-tablon")!;
const enabled = [ibague, pasto, ...satellites];

const pickup = {
  location: pasto.center,
  name: "Plaza",
  address: "Pasto",
  placeId: "p1",
};
const dropoff = {
  location: tangua.center,
  name: "Tangua",
  address: "Tangua",
  placeId: "d1",
};

// 1–8 corredor ida y vuelta
assert(
  isAllowedDropoffPoint(pasto, tangua.center, enabled),
  "1. Pasto → Tangua permitido (fuera o al borde del radio Pasto)",
);
assert(
  isAllowedDropoffPoint(tangua, pasto.center, enabled),
  "2. Tangua → Pasto permitido",
);
assert(
  isAllowedDropoffPoint(pasto, narino.center, enabled),
  "3. Pasto → Nariño permitido",
);
assert(
  isAllowedDropoffPoint(narino, pasto.center, enabled),
  "4. Nariño → Pasto permitido",
);
assert(
  isAllowedDropoffPoint(pasto, chachagui.center, enabled),
  "5. Pasto → Chachagüí permitido",
);
assert(
  isAllowedDropoffPoint(chachagui, pasto.center, enabled),
  "6. Chachagüí → Pasto permitido",
);
assert(
  !isPointInCity(buesaco.center, pasto) &&
    isAllowedDropoffPoint(pasto, buesaco.center, enabled),
  "7. Pasto → Buesaco permitido aunque Buesaco está fuera del radio 20 km",
);
assert(
  isAllowedDropoffPoint(buesaco, pasto.center, enabled),
  "8. Buesaco → Pasto permitido",
);

assert(
  isAllowedDropoffPoint(pasto, elTablon.center, enabled),
  "Pasto → El Tablón permitido",
);
assert(
  isAllowedDropoffPoint(elTablon, pasto.center, enabled),
  "El Tablón → Pasto permitido",
);
assert(
  isAllowedDropoffPoint(pasto, chachagui.center, enabled),
  "Pasto → Chachagüí sigue permitido",
);

const corridorZones = PASTO_CORRIDOR_SLUGS.map((slug) => {
  const zone = enabled.find((city) => city.slug === slug);
  if (!zone) throw new Error(`zona ausente: ${slug}`);
  return zone;
});
assert(corridorZones.length === 6, "Seis zonas operativas en el corredor");

let directed = 0;
let symmetric = 0;
for (const origin of corridorZones) {
  assert(
    resolveCityFromPointSync(origin.center, enabled)?.slug === origin.slug,
    `Pickup pin en radio de ${origin.slug} → ${origin.slug}`,
  );
  for (const destination of corridorZones) {
    if (origin.slug === destination.slug) continue;
    directed += 1;
    assert(
      isAuthorizedCorridorPair(origin.slug, destination.slug),
      `texto/par ${origin.slug} → ${destination.slug}`,
    );
    assert(
      isAllowedDropoffPoint(origin, destination.center, enabled),
      `pin destino ${origin.slug} → ${destination.slug}`,
    );
    assert(
      filterCandidatesForDropoff(
        [{ name: destination.name, location: destination.center }],
        origin,
        enabled,
      ).length === 1,
      `Places ${origin.slug} → candidato en ${destination.slug}`,
    );
  }
}
assert(directed === 30, "30 combinaciones dirigidas entre las seis zonas");
for (let i = 0; i < corridorZones.length; i += 1) {
  for (let j = i + 1; j < corridorZones.length; j += 1) {
    symmetric += 1;
    const a = corridorZones[i];
    const b = corridorZones[j];
    assert(
      isAuthorizedCorridorPair(a.slug, b.slug) &&
        isAuthorizedCorridorPair(b.slug, a.slug),
      `simétrico ${a.slug} ↔ ${b.slug}`,
    );
  }
}
assert(symmetric === 15, "15 pares simétricos");

assert(
  buildDropoffPlaceQuery("Chachagüí", elTablon, enabled) ===
    "Chachagüí, Nariño" &&
    placeSearchBiasCircle(elTablon, "Chachagüí", enabled).slug === "chachagui",
  "Texto Chachagüí desde el-tablon busca la cabecera, no el origen",
);
assert(
  buildDropoffPlaceQuery("Tangua", buesaco, enabled) === "Tangua, Nariño",
  "Texto Tangua desde Buesaco usa contexto regional del municipio destino",
);

const unicoOutlet = { lat: 1.2056794, lng: -77.2604111 };
assert(
  resolveCityFromPointSync(unicoOutlet, enabled)?.slug === "pasto",
  "Centro Comercial Único Outlet (Places Pasto) se clasifica como pasto",
);
assert(
  isAllowedDropoffPoint(elTablon, unicoOutlet, enabled),
  "el-tablon → Centro Comercial Único Outlet, Pasto: permitido",
);
assert(
  isAuthorizedCorridorPair("el-tablon", "pasto") &&
    isAuthorizedCorridorPair("pasto", "el-tablon"),
  "Par el-tablon ↔ pasto es simétrico",
);

assert(
  buildCityScopedPlaceQuery("Centro Comercial Único Outlet", elTablon) ===
    "Centro Comercial Único Outlet, El Tablón, Nariño",
  "REPRO: enrich del origen satélite sesgaba Places a El Tablón",
);
assert(
  buildDropoffPlaceQuery(
    "Centro Comercial Único Outlet",
    elTablon,
    enabled,
  ) === "Centro Comercial Único Outlet, Pasto, Nariño",
  "FIX: dropoff desde el-tablon se busca en Pasto, no en El Tablón",
);
assert(
  dropoffSearchScopeCity(elTablon, enabled).slug === "pasto" &&
    placeSearchBiasCircle(
      elTablon,
      "Centro Comercial Único Outlet",
      enabled,
    ).slug === "pasto",
  "FIX: bias Places desde el-tablon genérico apunta a Pasto",
);
assert(
  filterCandidatesForDropoff(
    [
      {
        name: "Centro Comercial Unico Outlet - Pasto",
        location: unicoOutlet,
      },
      { name: "Bogotá", location: { lat: 4.711, lng: -74.0721 } },
    ],
    elTablon,
    enabled,
  ).map((c) => c.name).join() === "Centro Comercial Unico Outlet - Pasto",
  "Filtro de destino el-tablon conserva Único Outlet y rechaza fuera de cobertura",
);
assert(
  !isAllowedDropoffPoint(
    elTablon,
    EL_TABLON_GOOGLE_LANDMARKS.ruralNorthOfAirport,
    enabled,
  ),
  "el-tablon → zona no cubierta: rechazado",
);
assert(
  isAllowedDropoffPoint(elTablon, chachagui.center, enabled),
  "el-tablon → chachagui: permitido (malla regional)",
);
assert(
  outOfCityServiceMessage(elTablon).includes("El Tablón") &&
    !dropoffNotAllowedMessage(elTablon).includes("solo opera dentro de El Tablón"),
  "Mensaje de corredor no dice 'solo opera dentro de El Tablón'",
);

assert(
  !isAuthorizedCorridorPair("pasto", "ibague") &&
    !isAuthorizedCorridorPair("el-tablon", "ibague") &&
    !isAllowedDropoffPoint(pasto, ibague.center, enabled),
  "Ibagué queda fuera de la malla regional",
);

// 9 viaje dentro de Pasto
assert(
  resolveCityFromPointSync(pasto.center, enabled)?.slug === "pasto" &&
    isAllowedDropoffPoint(pasto, { lat: 1.22, lng: -77.28 }, enabled),
  "9. Viaje interno Pasto: origen Pasto y destino urbano permitido",
);

// 10 viaje dentro de Ibagué
assert(
  resolveCityFromPointSync(ibague.center, enabled)?.slug === "ibague" &&
    isAllowedDropoffPoint(ibague, { lat: 4.44, lng: -75.23 }, enabled) &&
    !isAllowedDropoffPoint(ibague, pasto.center, enabled) &&
    !isAllowedDropoffPoint(ibague, buesaco.center, enabled),
  "10. Viaje interno Ibagué intacto; no hay corredor Ibagué↔Pasto",
);

// 11 rechazo conductor de otra ciudad
assert(
  !driverServesOriginCity(pasto, ibague) &&
    !driverServesOriginCity(tangua, ibague) &&
    !canAcceptTripInCity(pasto.id, ibague.id),
  "11. Conductor Ibagué no sirve viajes del corredor Pasto",
);
assert(
  driverServesOriginCity(pasto, pasto) &&
    driverServesOriginCity(tangua, pasto) &&
    driverServesOriginCity(buesaco, pasto),
  "11b. Flota Pasto sirve origen Pasto y satélites",
);
assert(
  dispatchFleetCity(tangua, enabled).id === pasto.id &&
    dispatchFleetCity(pasto, enabled).id === pasto.id &&
    dispatchFleetCity(ibague, enabled).id === ibague.id,
  "11c. Despacho: satélite→flota Pasto; Ibagué sigue Ibagué",
);
assert(
  filterDriversByTripCity(
    [
      { id: "d-pas", city_id: pasto.id },
      { id: "d-iba", city_id: ibague.id },
    ],
    dispatchFleetCity(tangua, enabled).id,
  ).every((d) => d.city_id === pasto.id),
  "11d. Listado de oferta para origen Tangua solo ve conductores Pasto",
);

// 12 Places municipio vs carretera/restaurante
const mixedBuesaco = preferMunicipalityPlaces(
  "Buesaco",
  [
    {
      name: "Restaurante Cafe Buesaco",
      address: "Pasto, Nariño",
      location: pasto.center,
      types: ["restaurant", "food", "point_of_interest"],
      primaryType: "restaurant",
    },
    {
      name: "Buesaco",
      address: "Buesaco, Nariño",
      location: buesaco.center,
      types: ["locality", "political"],
      primaryType: "locality",
    },
  ],
  enabled,
);
assert(
  mixedBuesaco.length === 1 && mixedBuesaco[0].name === "Buesaco",
  "12. Query Buesaco prefiere localidad, no restaurante",
);

const mixedRoad = preferMunicipalityPlaces(
  "Chachagüí",
  [
    {
      name: "Chachagüí-Pasto",
      address: "Vía a Chachagüí",
      location: { lat: 1.28, lng: -77.28 },
      types: ["route"],
      primaryType: "route",
    },
    {
      name: "Chachagüí",
      address: "Chachagüí, Nariño",
      location: chachagui.center,
      types: ["locality", "political"],
      primaryType: "locality",
    },
  ],
  enabled,
);
assert(
  mixedRoad.length === 1 && mixedRoad[0].primaryType === "locality",
  "12b. Query Chachagüí descarta la carretera",
);

assert(
  buildDropoffPlaceQuery("Chachagüí", pasto, enabled) === "Chachagüí, Nariño",
  "12c. No sesga el municipio con ', Pasto, Nariño'",
);
assert(
  buildDropoffPlaceQuery("Gobernación", pasto, enabled) ===
    "Gobernación, Pasto, Nariño",
  "12d. Query genérica en Pasto sigue enriqueciéndose",
);
assert(
  buildDropoffPlaceQuery("Centro", ibague, enabled) === "Centro, Ibagué, Tolima",
  "12e. Query genérica Ibagué intacta",
);
assert(
  placeSearchBiasCity(pasto, "Buesaco", enabled).slug === "buesaco",
  "12f. Bias de Places para 'Buesaco' desde Pasto apunta a Buesaco",
);
assert(
  placeSearchBiasCity(pasto, "Hospital", enabled).slug === "pasto",
  "12g. Bias genérico permanece en la ciudad de origen",
);

const filteredFromPasto = filterCandidatesForDropoff(
  [
    { name: "Buesaco", location: buesaco.center },
    { name: "Bogotá", location: { lat: 4.711, lng: -74.0721 } },
  ],
  pasto,
  enabled,
);
assert(
  filteredFromPasto.length === 1 && filteredFromPasto[0].name === "Buesaco",
  "12h. Filtro de destino conserva Buesaco y rechaza Bogotá",
);

// 13 cierre NO_FARE
for (const slug of [
  "pasto",
  "tangua",
  "narino",
  "chachagui",
  "buesaco",
  "el-tablon",
]) {
  assert(
    pricingModeForCitySlug(slug) === "NO_FARE" &&
      !shouldFinalizeFare(slug) &&
      !requiresFareQuote(slug) &&
      planTripCompletion(slug).runFinalizeFare === false,
    `13. ${slug}: NO_FARE, cierre sin finalizeFare`,
  );
}

assert(
  isDraftReadyToPublish(
    { pickup, dropoff, route: undefined, quote: undefined },
    "tangua",
  ),
  "13b. Pickup Tangua puede publicarse sin quote (NO_FARE)",
);

// 14 Ibagué sin regresión tarifaria
assert(
  pricingModeForCitySlug("ibague") === "FARE" &&
    shouldFinalizeFare("ibague") &&
    requiresFareQuote("ibague") &&
    planTripCompletion("ibague").persistFinalFare,
  "14. Ibagué sigue FARE",
);
assert(
  !isDraftReadyToPublish(
    { pickup, dropoff, route: undefined, quote: undefined },
    "ibague",
  ),
  "14b. Ibagué no publica sin route+quote",
);

assert(
  resolveCityFromPointSync(tangua.center, enabled)?.slug === "tangua",
  "Cobertura geográfica: pickup Tangua → tangua (radio menor gana el solape)",
);
assert(
  resolveCityFromPointSync(narino.center, enabled)?.slug === "narino",
  "Cobertura geográfica: pickup Nariño → narino",
);
assert(
  resolveCityFromPointSync(chachagui.center, enabled)?.slug === "chachagui",
  "Cobertura geográfica: pickup Chachagüí → chachagui",
);
assert(
  resolveCityFromPointSync(buesaco.center, enabled)?.slug === "buesaco",
  "Cobertura geográfica: pickup Buesaco → buesaco",
);
assert(
  resolveCityFromPointSync(pasto.center, enabled)?.slug === "pasto",
  "Centro Pasto no es capturado por radios satélite",
);
assert(
  chachagui.radiusMeters === 664,
  "Chachagüí conserva radio 664 m (no se amplia a 18 km)",
);
assert(
  resolveCityFromPointSync(EL_TABLON_GOOGLE_LANDMARKS.airport, enabled)
    ?.slug === "el-tablon",
  "Aeropuerto Antonio Nariño se clasifica como el-tablon",
);
assert(
  resolveCityFromPointSync(EL_TABLON_GOOGLE_LANDMARKS.hotelExplora, enabled)
    ?.slug === "el-tablon",
  "Hotel Explora (entrada al aeropuerto) se clasifica como el-tablon",
);
assert(
  resolveCityFromPointSync(EL_TABLON_GOOGLE_LANDMARKS.airport, enabled)
    ?.slug !== "chachagui",
  "El Tablón / aeropuerto no se clasifica como chachagui",
);
assert(
  resolveCityFromPointSync(
    EL_TABLON_GOOGLE_LANDMARKS.sieteColoresRural,
    enabled,
  )?.slug !== "el-tablon" &&
    resolveCityFromPointSync(
      EL_TABLON_GOOGLE_LANDMARKS.sieteColoresRural,
      enabled,
    )?.slug !== "chachagui",
  "Zona rural entre cabecera y aeropuerto no es el-tablon ni chachagui",
);
assert(
  resolveCityFromPointSync(
    EL_TABLON_GOOGLE_LANDMARKS.ruralNorthOfAirport,
    enabled,
  ) === null,
  "Punto fuera del radio de El Tablón queda sin cobertura",
);
assert(
  resolveCityFromPointSync(EL_TABLON_GOOGLE_LANDMARKS.tablonDeGomez, enabled) ===
    null,
  "El Tablón de Gómez no entra como el-tablon",
);
assert(
  matchMunicipalityCity("El Tablón de Gómez", enabled) === null,
  "Query El Tablón de Gómez no alias a el-tablon",
);
assert(
  matchMunicipalityCity("Aeropuerto Antonio Nariño", enabled)?.slug ===
    "el-tablon" &&
    buildDropoffPlaceQuery("El Tablón", pasto, enabled) ===
      "Aeropuerto Antonio Nariño, Chachagüí, Nariño",
  "Places: El Tablón / aeropuerto se buscan en Chachagüí, no en Gómez",
);
assert(
  operationalTripCity(elTablon, enabled).id === pasto.id &&
    operationalTripCity(chachagui, enabled).id === pasto.id &&
    operationalTripCity(ibague, enabled).id === ibague.id,
  "trip.city_id operacional: satélites → Pasto; Ibagué intacto",
);
assert(
  dispatchFleetCity(elTablon, enabled).id === pasto.id &&
    driverServesOriginCity(elTablon, pasto) &&
    !driverServesOriginCity(elTablon, ibague),
  "Dispatch El Tablón usa flota Pasto y rechaza Ibagué",
);

assert(
  matchDriverFleetCity("Tangua", enabled)?.slug === "pasto" &&
    matchDriverFleetCity("Chachagüí", enabled)?.slug === "pasto" &&
    matchDriverFleetCity("El Tablón", enabled)?.slug === "pasto" &&
    matchDriverFleetCity("Ibague", enabled)?.slug === "ibague",
  "Registro conductor: satélites → flota Pasto; Ibagué intacto",
);

assert(
  dropoffNotAllowedMessage(ibague).includes("Ibagué") &&
    !dropoffNotAllowedMessage(ibague).includes("Tangua"),
  "Mensaje de destino Ibagué no menciona el corredor Pasto",
);

console.log("\nPasto corridor: todas las aserciones OK");
