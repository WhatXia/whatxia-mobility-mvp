import type { PlaceCandidate } from "@/lib/geo/types";
import {
  getPlaceConfidenceThreshold,
  PLACE_TOP_MARGIN,
} from "@/lib/geo/config";

/**
 * Asigna scores relativos por posición (1.0, 0.85, 0.7…).
 * Si el caller ya trae scores, se respetan.
 */
export function rankPlaceCandidates(
  candidates: Omit<PlaceCandidate, "confidenceScore">[],
): PlaceCandidate[] {
  return candidates.map((c, index) => ({
    ...c,
    confidenceScore: Math.max(0, 1 - index * 0.15),
  }));
}

export function isHighConfidenceMatch(
  candidates: PlaceCandidate[],
  threshold = getPlaceConfidenceThreshold(),
): boolean {
  if (candidates.length === 0) {
    return false;
  }

  const [top, second] = candidates;

  if (candidates.length === 1) {
    return top.confidenceScore >= threshold;
  }

  return (
    top.confidenceScore >= threshold &&
    top.confidenceScore - second.confidenceScore >= PLACE_TOP_MARGIN
  );
}

export function topCandidates(
  candidates: PlaceCandidate[],
  limit = 3,
): PlaceCandidate[] {
  return candidates.slice(0, limit);
}
