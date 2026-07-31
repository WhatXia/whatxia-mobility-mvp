export const BOT_OPERATIONAL_STATUSES = ["ACTIVE", "MAINTENANCE"] as const;

export type BotOperationalStatusCode =
  (typeof BOT_OPERATIONAL_STATUSES)[number];

export type BotOperationalStatus = {
  status: BotOperationalStatusCode;
  maintenanceMessage: string;
  cmsMessageCode: string;
  updatedAt: string | null;
  updatedByEmail: string | null;
  updatedById: string | null;
};

export function isBotOperationalStatus(
  value: unknown,
): value is BotOperationalStatusCode {
  return (
    typeof value === "string" &&
    (BOT_OPERATIONAL_STATUSES as readonly string[]).includes(value)
  );
}
