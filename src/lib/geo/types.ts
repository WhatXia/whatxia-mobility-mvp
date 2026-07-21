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
  pickup?: ResolvedPlace;
  dropoff?: ResolvedPlace;
  candidates?: PlaceCandidate[];
  /** 'pickup' | 'dropoff' — qué lista de candidatos está activa */
  candidateRole?: "pickup" | "dropoff";
  route?: RouteEstimate;
  quote?: FareQuote;
};
