"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  getBotOperationalStatus,
  updateBotOperationalStatus,
} from "@/lib/bot-operational-status/config";
import {
  isBotOperationalStatus,
  type BotOperationalStatus,
  type BotOperationalStatusCode,
} from "@/lib/bot-operational-status/types";

async function requireOpsUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error("No autorizado");
  }
  return user;
}

export async function fetchBotOperationalStatus(): Promise<BotOperationalStatus> {
  await requireOpsUser();
  return getBotOperationalStatus({ bypassCache: true });
}

export async function saveBotOperationalStatus(input: {
  status: string;
  maintenanceMessage: string;
}): Promise<{ ok: true; status: BotOperationalStatus } | { ok: false; error: string }> {
  const user = await requireOpsUser();

  if (!isBotOperationalStatus(input.status)) {
    return { ok: false, error: "Estado inválido." };
  }

  const message = input.maintenanceMessage.trim();
  if (!message) {
    return { ok: false, error: "El mensaje de mantenimiento no puede estar vacío." };
  }
  if (message.length > 1000) {
    return { ok: false, error: "El mensaje no puede superar 1000 caracteres." };
  }

  try {
    const status = await updateBotOperationalStatus({
      status: input.status as BotOperationalStatusCode,
      maintenanceMessage: message,
      actorEmail: user.email ?? null,
      actorId: user.id,
    });
    revalidatePath("/ops/sistema");
    return { ok: true, status };
  } catch (err) {
    console.error("[ops/sistema] save:", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "No se pudo guardar el estado del bot.",
    };
  }
}
