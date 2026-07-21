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
    base: number;
    distanceComponent: number;
    timeComponent: number;
    raw: number;
    minimumApplied: boolean;
  };
};

export type BookingDraft = {
  /** Texto libre del pasajero: "¿Dónde te recogemos?" */
  pickupLabel?: string;
  /** Coordenadas obligatorias de WhatsApp (origen para ruta). */
  pickupLocation?: GeoPoint;
  /**
   * Origen compuesto para ruta/createTrip:
   * name = pickupLabel, location = pickupLocation.
   */
  pickup?: ResolvedPlace;
  dropoff?: ResolvedPlace;
  candidates?: PlaceCandidate[];
  candidateRole?: "pickup" | "dropoff";
  /**
   * MVP: label_plus_whatsapp_location.
   * Futuro: places_text para resolver origen solo por nombre.
   */
  originCapture?: "label_plus_whatsapp_location" | "places_text";
  route?: RouteEstimate;
  quote?: FareQuote;
};
