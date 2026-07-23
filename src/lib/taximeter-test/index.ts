/**
 * Taxímetro de prueba — calibración tarifaria (independiente de Mobility).
 */

export {
  handleTaximeterMessage,
  isTaximeterActivationText,
  isTaximeterButton,
  TAXIMETER_BUTTON_IDS,
} from "@/lib/taximeter-test/flow";

export { getTaximeterSession } from "@/lib/taximeter-test/store";

export {
  PRICING_ENGINE_VERSION,
  ROUTE_PROVIDER_GOOGLE,
} from "@/lib/taximeter-test/types";
