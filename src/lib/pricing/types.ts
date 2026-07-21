export type FareRules = {
  id: string;
  currency: "COP" | string;
  flagDrop: number;
  minimumFare: number;
  minDistanceMeters: number;
  incrementMeters: number;
  incrementAmount: number;
  waitSeconds: number;
  waitAmount: number;
  surchargeNight: number;
  surchargeSundayHoliday: number;
  surchargeAirport: number;
  surchargeWhatxia: number;
  nightStartHour: number;
  nightEndHour: number;
  holidayDates: string[];
  airportKeywords: string[];
  airportCenterLat: number | null;
  airportCenterLng: number | null;
  airportRadiusMeters: number | null;
};

export type FareContext = {
  /** Momento de cotización (default: ahora). */
  at?: Date;
  /**
   * Segundos de espera del taxímetro.
   * Si no se envía, no se cobra espera (la duración de ruta no es espera).
   */
  waitSeconds?: number;
  pickupLabel?: string;
  dropoffLabel?: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
};
