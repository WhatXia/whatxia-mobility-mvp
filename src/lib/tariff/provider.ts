import { calculateTariff } from "@/lib/tariff/calculator";
import {
  isPublicHoliday,
  isSundayOrPublicHoliday,
} from "@/lib/tariff/holidays";
import type {
  CityTariffConfig,
  EstimateFareInput,
  FinalizeFareInput,
  TariffProvider,
  TariffQuote,
} from "@/lib/tariff/types";
import { resolveWaitSeconds } from "@/lib/tariff/waiting";

/**
 * Proveedor local: fórmulas sobre config fare_rules + festivos en public.holidays.
 */
export class LocalTariffProvider implements TariffProvider {
  readonly id = "supabase_fare_rules_v1";

  async estimate(
    input: EstimateFareInput,
    config: CityTariffConfig,
  ): Promise<TariffQuote> {
    const at = input.at ?? new Date();
    const wait = resolveWaitSeconds({
      config,
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
      providedWaitSeconds: input.waitSeconds,
      deriveFromSpeed: false,
    });

    const holiday = await isPublicHoliday(config.countryCode, at);

    return calculateTariff({
      kind: "estimated",
      config,
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
      waitSeconds: wait.waitSeconds,
      waitSource: wait.source,
      at,
      isPublicHoliday: holiday,
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

    const holiday = await isPublicHoliday(config.countryCode, input.startedAt);

    return calculateTariff({
      kind: "final",
      config,
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
      waitSeconds: wait.waitSeconds,
      waitSource: wait.source,
      at: input.startedAt,
      isPublicHoliday: holiday,
      origin: input.origin,
      destination: input.destination,
      provider: this.id,
    });
  }
}

let activeProvider: TariffProvider = new LocalTariffProvider();

export function setTariffProvider(provider: TariffProvider): void {
  activeProvider = provider;
}

export function getTariffProvider(): TariffProvider {
  return activeProvider;
}

export function resetTariffProvider(): void {
  activeProvider = new LocalTariffProvider();
}

export { isSundayOrPublicHoliday };
