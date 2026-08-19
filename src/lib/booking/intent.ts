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
  /\b(un\s+)?(servicio|viaje|taxi|transporte|carrera)\s+(para|a|al|hacia|hasta|en)\s+\S+/i,
  /\b(servicio|viaje|taxi|transporte|carrera)\b.{0,20}\b(por\s+favor|ya|ahora|urgente)?\b/i,
  /\b(llevame|ll[eé]vame|llevalo|ll[eé]valo|recojanme|rec[oó]janme)\b/i,
  /\b(me\s+pueden\s+llevar|me\s+lleva|me\s+recogen|me\s+recojan)\b/i,
  /\b(necesito|quiero|pido).{0,30}\bque\s+me\s+(recojan|recogen|lleven)\b/i,
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
  /(?:necesito|quiero|pido).{0,30}(?:que\s+)?me\s+(?:recojan|recogen|lleven)\s+(?:en\s+)?(.+)$/i,
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

/**
 * Label de origen desde texto libre (p. ej. WAITING_PICKUP_TEXT).
 * Solicitud natural → solo pickupText. Ubicación directa → texto tal cual.
 * @returns null si hay intención de servicio sin lugar extraíble (seguir preguntando).
 */
export function resolvePickupLabelFromText(text: string): string | null {
  const raw = text.trim();
  if (!raw) {
    return null;
  }
  const mobility = parseMobilityIntent(raw);
  if (mobility.isServiceIntent) {
    const place = mobility.pickupText?.trim() || null;
    return place;
  }
  return raw;
}

export type ParsedPickupAddress = {
  /** Texto descriptivo completo (sin la frase de solicitud). */
  fullText: string;
  /** Zona/barrio/sector visible en la oferta al conductor. */
  zone: string;
  /** Nomenclatura detallada; disponible tras aceptar. */
  detail: string;
};

const STREET_TYPE =
  "(?:carrera|cra|kr|calle|cll|avenida|avda|diagonal|diag|transversal|transv|circunvalar|av|dg|tv|cl)";

const STREET_UNIT_RE = new RegExp(
  String.raw`\b${STREET_TYPE}\.?\s+\d+[A-Za-z]?(?:\s*#\s*[0-9A-Za-z]+(?:\s*-\s*[0-9A-Za-z]+)?)?`,
  "gi",
);

const RESIDENTIAL_TYPE =
  "(?:super\\s*manzana|supermanzana|smz|manzana|mza|mz|casa|lote|interior|apartamento|apto|torre|bloque)";

const RESIDENTIAL_UNIT_RE = new RegExp(
  String.raw`\b${RESIDENTIAL_TYPE}\.?\s+\d+[A-Za-z]?`,
  "gi",
);

type PickupSegmentKind = "street" | "residential" | "zone";

type PickupUnit = {
  start: number;
  end: number;
  kind: "street" | "residential";
};

function collectNomenclatureUnits(text: string): PickupUnit[] {
  const found: PickupUnit[] = [];
  for (const [source, kind] of [
    [STREET_UNIT_RE.source, "street"],
    [RESIDENTIAL_UNIT_RE.source, "residential"],
  ] as const) {
    const re = new RegExp(source, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      found.push({
        start: match.index,
        end: match.index + match[0].length,
        kind,
      });
    }
  }

  found.sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );

  const kept: PickupUnit[] = [];
  for (const unit of found) {
    const overlaps = kept.some(
      (other) => !(unit.end <= other.start || unit.start >= other.end),
    );
    if (!overlaps) {
      kept.push(unit);
    }
  }
  return kept.sort((a, b) => a.start - b.start);
}

function pickupSegmentKind(segment: string): PickupSegmentKind {
  const trimmed = segment.trim();
  const units = collectNomenclatureUnits(trimmed);
  if (
    units.length === 1 &&
    units[0].start === 0 &&
    units[0].end >= trimmed.length
  ) {
    return units[0].kind;
  }
  return "zone";
}

function trimPunctuation(value: string): string {
  return value.replace(/^[\s,;]+|[\s,;]+$/g, "").trim();
}

/**
 * Separa barrio/zona (oferta) vs nomenclatura (después de aceptar).
 * El barrio puede ir antes o después del detalle, con o sin comas.
 * No inventa barrio: si no hay zona identificable, zone queda vacío.
 */
export function parsePickupAddress(text: string): ParsedPickupAddress {
  const fullText = text.trim().replace(/[.]+$/g, "").trim();
  if (!fullText) {
    return { fullText: "", zone: "", detail: "" };
  }

  const units = collectNomenclatureUnits(fullText);
  if (units.length === 0) {
    return { fullText, zone: fullText, detail: "" };
  }

  const zoneParts: string[] = [];
  const detailParts: string[] = [];
  let cursor = 0;
  for (const unit of units) {
    const gap = trimPunctuation(fullText.slice(cursor, unit.start));
    if (gap) {
      zoneParts.push(gap);
    }
    detailParts.push(fullText.slice(unit.start, unit.end).trim());
    cursor = unit.end;
  }
  const tail = trimPunctuation(fullText.slice(cursor));
  if (tail) {
    zoneParts.push(tail);
  }

  return {
    fullText,
    zone: zoneParts.join(", "),
    detail: detailParts.join(", "),
  };
}

/** Zona que debe ver el conductor en la oferta (antes de aceptar). */
export function pickupOfferZone(text: string): string {
  const parsed = parsePickupAddress(text);
  const zone = parsed.zone.trim();
  if (zone) {
    return zone;
  }
  if (parsed.detail.trim()) {
    return "";
  }
  return parsed.fullText.trim();
}

const GENERIC_OFFER_ORIGIN = "Punto de recogida";

/**
 * Texto de origen para la oferta al conductor.
 * Si hay pickupNeighborhood real, se usa tal cual. El fallback genérico
 * no sustituye un barrio ya disponible.
 */
export function resolveOfferOrigin(
  pickupNeighborhood?: string | null,
  pickupLabel?: string | null,
): string {
  const stored = pickupNeighborhood?.trim() ?? "";
  if (stored && stored !== GENERIC_OFFER_ORIGIN) {
    return stored;
  }
  const fromLabel = pickupLabel?.trim()
    ? pickupOfferZone(pickupLabel).trim()
    : "";
  if (fromLabel && fromLabel !== GENERIC_OFFER_ORIGIN) {
    return fromLabel;
  }
  return stored || GENERIC_OFFER_ORIGIN;
}
