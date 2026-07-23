import { calculateTariff } from "@/lib/tariff/calculator";
import type {
  CityTariffConfig,
  EstimateFareInput,
  FinalizeFareInput,
  TariffProvider,
  TariffQuote,
} from "@/lib/tariff/types";
import { resolveWaitSeconds } from "@/lib/tariff/waiting";

/**
 * Proveedor local: aplica fórmulas sobre config ya resuelta (Supabase).
 * Futuros: TaximeterProvider, ExternalTariffProvider, DynamicPricingProvider.
 */
export class LocalTariffProvider implements TariffProvider {
  readonly id = "supabase_fare_rules_v1";

  async estimate(
    input: EstimateFareInput,
    config: CityTariffConfig,
  ): Promise<TariffQuote> {
    const wait = resolveWaitSeconds({
      config,
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
      providedWaitSeconds: input.waitSeconds,
      // Estimada: no inventar espera por velocidad salvo que venga explícita.
      deriveFromSpeed: false,
    });

    return calculateTariff({
      kind: "estimated",
      config,
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
      waitSeconds: wait.waitSeconds,
      waitSource: wait.source,
      at: input.at ?? new Date(),
      origin: input.origin,
      destination: input.destination,
      provider: this.id,
    });
  }

  async finalize(
    input: FinalizeFareInput,
    config: CityTariffConfig,
  ): Promise<TariffQuote> {
    const wait = resolveWaitSeconds({
      config,
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
      providedWaitSeconds: input.waitSeconds,
      deriveFromSpeed: input.deriveWaitFromSpeed !== false,
    });

    return calculateTariff({
      kind: "final",
      config,
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
      waitSeconds: wait.waitSeconds,
      waitSource: wait.source,
      at: input.startedAt,
      origin: input.origin,
      destination: input.destination,
      provider: this.id,
    });
  }
}

let activeProvider: TariffProvider = new LocalTariffProvider();

/** Permite inyectar taxímetro / motor externo sin rediseñar Mobility. */
export function setTariffProvider(provider: TariffProvider): void {
  activeProvider = provider;
}

export function getTariffProvider(): TariffProvider {
  return activeProvider;
}

export function resetTariffProvider(): void {
  activeProvider = new LocalTariffProvider();
}
