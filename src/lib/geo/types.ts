export type GeoPoint = {
  lat: number;
  lng: number;
};

export type PlaceCandidate = {
  placeId: string;
  name: string;
  address: string;
  location: GeoPoint;
  confidenceScore: number;
};

export type ResolvedPlace = {
  placeId: string | null;
  name: string;
  address: string;
  location: GeoPoint;
};

export type RouteEstimate = {
  distanceMeters: number;
  durationSeconds: number;
  polylineEncoded?: string;
};

export type FareQuote = {
  amount: number;
  currency: "COP";
  distanceKm: number;
  durationMin: number;
  breakdown: {
    flagDrop: number;
    distanceComponent: number;
    waitComponent: number;
    officialRaw: number;
    officialFare: number;
    minimumApplied: boolean;
    surchargeNight: number;
    surchargeSundayHoliday: number;
    surchargeAirport: number;
    surchargeWhatxia: number;
    /** @deprecated alias flagDrop */
    base: number;
    /** @deprecated alias waitComponent */
    timeComponent: number;
    /** @deprecated alias officialRaw */
    raw: number;
  };
};

export type BookingDraft = {
  /**
   * Texto original del pasajero (“¿Dónde te recogemos?”).
   * Es la referencia corta que ve el conductor; no sustituir por nombre Places.
   */
  pickupLabel?: string;
  /** Coordenadas (pin WA o Places) para ruta/dispatch. */
  pickupLocation?: GeoPoint;
  /**
   * Origen compuesto para ruta/createTrip:
   * name = pickupLabel (referencia), address = dirección Google si aplica,
   * location = pickupLocation.
   */
  pickup?: ResolvedPlace;
  dropoff?: ResolvedPlace;
  /**
   * Destino mencionado al inicio pero aún no resuelto con Places
   * (p. ej. falló resolución dual origen+destino).
   */
  pendingDropoffText?: string;
  candidates?: PlaceCandidate[];
  candidateRole?: "pickup" | "dropoff";
  /**
   * MVP: label_plus_whatsapp_location (Places opcional en pickup + pin fallback).
   * Futuro: places_text para resolver origen solo por nombre.
   */
  originCapture?: "label_plus_whatsapp_location" | "places_text";
  route?: RouteEstimate;
  quote?: FareQuote;
};
