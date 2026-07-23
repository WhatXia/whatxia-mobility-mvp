/**
 * Detección de intención Mobility y extracción de origen/destino.
 * Regla: un solo lugar → origen (recogida). Origen+destino claros → ambos.
 */

export type MobilityIntentResult = {
  isServiceIntent: boolean;
  /** Lugar de recogida si se identificó. */
  pickupText: string | null;
  /** Destino solo si quedó claro junto al origen (o solo destino en frases cortas legacy no aplica). */
  destinationText: string | null;
};

const INTENT_PATTERNS: RegExp[] = [
  /\b(necesito|quiero|pido|solicito|busco)\b.{0,40}\b(servicio|viaje|taxi|carro|transporte|carrera)\b/i,
  /\b(servicio|viaje|taxi|transporte|carrera)\b.{0,20}\b(por\s+favor|ya|ahora|urgente)?\b/i,
  /\b(llevame|ll[eé]vame|llevalo|ll[eé]valo|recojanme|rec[oó]janme)\b/i,
  /\b(me\s+pueden\s+llevar|me\s+lleva|me\s+recogen)\b/i,
  /\b(pedir|solicitar)\s+(un\s+)?(servicio|viaje|taxi)\b/i,
  /\bun\s+(servicio|viaje|taxi)\b/i,
  /\b(estoy\s+en|me\s+encuentro\s+en|desde)\b/i,
];

/**
 * Origen + destino en el mismo mensaje.
 * Captura [1]=origen, [2]=destino.
 */
const BOTH_PLACE_PATTERNS: RegExp[] = [
  /\bestoy\s+en\s+(.+?)\s+y\s+(?:voy\s+)?(?:para|hacia|hasta|a|al)\s+(.+)$/i,
  /\bme\s+encuentro\s+en\s+(.+?)\s+y\s+(?:voy\s+)?(?:para|hacia|hasta|a|al)\s+(.+)$/i,
  /\bdesde\s+(.+?)\s+(?:hasta|hacia|para|a|al)\s+(.+)$/i,
  /\b(?:recojanme|rec[oó]janme|rec[oó]geme|recogerme)\s+(?:en\s+)?(.+?)\s+(?:y\s+)?(?:voy\s+)?(?:para|hacia|hasta|a|al)\s+(.+)$/i,
  /\b(?:necesito|quiero|pido|solicito).{0,40}\b(?:en|desde)\s+(.+?)\s+(?:y\s+)?(?:voy\s+)?(?:para|hacia|hasta|a|al)\s+(.+)$/i,
  /\bde\s+(.+?)\s+a\s+(?!servicio|viaje|taxi)(.+)$/i,
  /\b(.+?)\s+y\s+(?:voy\s+)?(?:para|hacia|hasta)\s+(.+)$/i,
];

/** Un solo lugar → se interpreta como origen (recogida). */
const PICKUP_EXTRACTORS: RegExp[] = [
  /(?:estoy\s+en|me\s+encuentro\s+en)\s+(.+)$/i,
  /(?:recojanme|rec[oó]janme|rec[oó]geme|recogerme)\s+(?:en\s+)?(.+)$/i,
  /(?:desde)\s+(.+)$/i,
  /(?:llevame|ll[eé]vame)\s+(?:a|al|hacia|hasta|en)\s+(.+)$/i,
  /(?:me\s+pueden\s+llevar|me\s+lleva|me\s+recogen)\s+(?:a|al|hacia|hasta|en)\s+(.+)$/i,
  /(?:viaje|servicio|taxi|transporte|carrera)\s+(?:a|al|para|hacia|hasta|en)\s+(.+)$/i,
  /(?:para|hacia|hasta|en)\s+(?:ir\s+a\s+|ir\s+al\s+)?(.+)$/i,
  /(?:necesito|quiero|pido|solicito).{0,40}(?:para|a|al|hacia|hasta|en)\s+(.+)$/i,
  /(?:a|al)\s+(?!servicio|viaje|taxi|transporte|conductor)(.+)$/i,
];

const NOISE_SUFFIX = /\s*(por\s+favor|please|ya|ahora|urgente|gracias)[.!]*$/i;

function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalizeIntentText(text: string): string {
  return stripDiacritics(text.trim().toLowerCase()).replace(/\s+/g, " ");
}

/** Quita saludo inicial para poder detectar intención en "Hola, necesito…". */
export function stripLeadingGreeting(text: string): string {
  return text
    .trim()
    .replace(/^(hola|buenas|buenos\s+d[ií]as)\s*[,!.:]?\s*/i, "")
    .trim();
}

function cleanPlace(raw: string): string | null {
  let d = raw.trim().replace(/[.!,;:]+$/g, "").trim();
  d = d.replace(NOISE_SUFFIX, "").trim();
  // Quitar conectores residuales al final del origen en patrones "ambos"
  d = d.replace(/\s+\by\b\s*$/i, "").trim();
  if (d.length < 2) {
    return null;
  }
  const alone = normalizeIntentText(d);
  if (
    /^(un\s+)?(servicio|viaje|taxi|transporte|carrera)$/.test(alone) ||
    /^(aqui|allá|alla|mi\s+casa|casa)$/.test(alone)
  ) {
    return null;
  }
  return d;
}

export function hasServiceIntent(text: string): boolean {
  const t = stripLeadingGreeting(text);
  if (t.length < 3) {
    return false;
  }
  return INTENT_PATTERNS.some((re) => re.test(t));
}

export function extractBothPlaces(
  text: string,
): { pickupText: string; destinationText: string } | null {
  const trimmed = stripLeadingGreeting(text);
  if (!trimmed) {
    return null;
  }

  for (const re of BOTH_PLACE_PATTERNS) {
    const m = trimmed.match(re);
    if (m?.[1] && m?.[2]) {
      const pickupText = cleanPlace(m[1]);
      const destinationText = cleanPlace(m[2]);
      if (
        pickupText &&
        destinationText &&
        normalizeIntentText(pickupText) !== normalizeIntentText(destinationText)
      ) {
        return { pickupText, destinationText };
      }
    }
  }

  return null;
}

/**
 * Extrae un único lugar del texto (se usará como origen).
 * No usar si extractBothPlaces ya encontró par.
 */
export function extractSinglePlaceFromText(text: string): string | null {
  const trimmed = stripLeadingGreeting(text);
  if (!trimmed) {
    return null;
  }

  for (const re of PICKUP_EXTRACTORS) {
    const m = trimmed.match(re);
    if (m?.[1]) {
      const cleaned = cleanPlace(m[1]);
      if (cleaned) {
        return cleaned;
      }
    }
  }

  return null;
}

/** @deprecated Prefer extractSinglePlaceFromText (ahora el único lugar = origen). */
export function extractDestinationFromText(text: string): string | null {
  return extractSinglePlaceFromText(text);
}

/**
 * Analiza el primer mensaje del pasajero.
 * - Ambos lugares claros → pickup + destination
 * - Un solo lugar → solo pickup
 * - Solo intención → sin lugares
 */
export function parseMobilityIntent(text: string | null): MobilityIntentResult {
  if (!text?.trim()) {
    return {
      isServiceIntent: false,
      pickupText: null,
      destinationText: null,
    };
  }

  const body = stripLeadingGreeting(text);
  const isServiceIntent = hasServiceIntent(text);

  if (!isServiceIntent) {
    // Frases cortas "para el Multicentro" / "estoy en la 60" → intención + origen
    const both = extractBothPlaces(text);
    if (both) {
      return {
        isServiceIntent: true,
        pickupText: both.pickupText,
        destinationText: both.destinationText,
      };
    }
    const single = extractSinglePlaceFromText(text);
    if (
      single &&
      /^(para|hacia|hasta|a|al|en|desde|estoy\s+en)\s+/i.test(body)
    ) {
      return {
        isServiceIntent: true,
        pickupText: single,
        destinationText: null,
      };
    }
    return {
      isServiceIntent: false,
      pickupText: null,
      destinationText: null,
    };
  }

  const both = extractBothPlaces(text);
  if (both) {
    return {
      isServiceIntent: true,
      pickupText: both.pickupText,
      destinationText: both.destinationText,
    };
  }

  return {
    isServiceIntent: true,
    pickupText: extractSinglePlaceFromText(text),
    destinationText: null,
  };
}
