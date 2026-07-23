/**
 * Detección de intención Mobility y extracción de destino desde texto libre.
 * Tolerante a variaciones de escritura (sin depender del saludo "Hola").
 */

export type MobilityIntentResult = {
  isServiceIntent: boolean;
  /** Frase de destino si se pudo extraer; null si no. */
  destinationText: string | null;
};

const INTENT_PATTERNS: RegExp[] = [
  /\b(necesito|quiero|pido|solicito|busco)\b.{0,40}\b(servicio|viaje|taxi|carro|transporte|carrera)\b/i,
  /\b(servicio|viaje|taxi|transporte|carrera)\b.{0,20}\b(por\s+favor|ya|ahora|urgente)?\b/i,
  /\b(llevame|ll[eé]vame|llevalo|ll[eé]valo|recojanme|rec[oó]janme)\b/i,
  /\b(me\s+pueden\s+llevar|me\s+lleva|me\s+recogen)\b/i,
  /\b(pedir|solicitar)\s+(un\s+)?(servicio|viaje|taxi)\b/i,
  /\bun\s+(servicio|viaje|taxi)\b/i,
];

/** Prefijos/conectores que introducen el destino. */
const DESTINATION_EXTRACTORS: RegExp[] = [
  /(?:llevame|ll[eé]vame)\s+(?:a|al|hacia|hasta)\s+(.+)$/i,
  /(?:me\s+pueden\s+llevar|me\s+lleva|me\s+recogen)\s+(?:a|al|hacia|hasta)\s+(.+)$/i,
  /(?:viaje|servicio|taxi|transporte|carrera)\s+(?:a|al|para|hacia|hasta)\s+(.+)$/i,
  /(?:para|hacia|hasta)\s+(?:ir\s+a\s+|ir\s+al\s+)?(.+)$/i,
  /(?:necesito|quiero|pido|solicito).{0,40}(?:para|a|al|hacia|hasta)\s+(.+)$/i,
  /(?:a|al)\s+(?!servicio|viaje|taxi|transporte|conductor)(.+)$/i,
];

const NOISE_SUFFIX = /\s*(por\s+favor|please|ya|ahora|urgente|gracias)[.!]*$/i;

function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalizeIntentText(text: string): string {
  return stripDiacritics(text.trim().toLowerCase()).replace(/\s+/g, " ");
}

function cleanDestination(raw: string): string | null {
  let d = raw.trim().replace(/[.!,;:]+$/g, "").trim();
  d = d.replace(NOISE_SUFFIX, "").trim();
  // Quitar artículos iniciales redundantes si quedaron solos
  if (d.length < 2) {
    return null;
  }
  // Evitar destinos que son solo ruido de intención
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
  const t = text.trim();
  if (t.length < 3) {
    return false;
  }
  return INTENT_PATTERNS.some((re) => re.test(t));
}

export function extractDestinationFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  for (const re of DESTINATION_EXTRACTORS) {
    const m = trimmed.match(re);
    if (m?.[1]) {
      const cleaned = cleanDestination(m[1]);
      if (cleaned) {
        return cleaned;
      }
    }
  }

  return null;
}

/**
 * Analiza el primer mensaje del pasajero.
 * Si hay intención de servicio, intenta sacar el destino.
 */
export function parseMobilityIntent(text: string | null): MobilityIntentResult {
  if (!text?.trim()) {
    return { isServiceIntent: false, destinationText: null };
  }

  const isServiceIntent = hasServiceIntent(text);
  if (!isServiceIntent) {
    // Frases cortas tipo "al aeropuerto" / "para el Multicentro" sin verbo de servicio
    const destOnly = extractDestinationFromText(text);
    if (
      destOnly &&
      /^(para|hacia|hasta|a|al)\s+/i.test(text.trim())
    ) {
      return { isServiceIntent: true, destinationText: destOnly };
    }
    return { isServiceIntent: false, destinationText: null };
  }

  return {
    isServiceIntent: true,
    destinationText: extractDestinationFromText(text),
  };
}
