import { getSupabase } from "@/lib/supabase/client";
import { getTrip, normalizePhone, samePhone } from "@/lib/trips";
import { sendTextMessage } from "@/lib/whatsapp/client";

export type TunnelStatus = "active" | "closing" | "closed";
export type TunnelMessageStatus = "pending" | "sent" | "failed";
export type TunnelSenderRole = "passenger" | "driver";

export type ConversationTunnel = {
  id: string;
  trip_id: string;
  passenger_phone: string;
  driver_phone: string;
  status: TunnelStatus;
  opened_at: string;
  closes_at: string | null;
  closed_at: string | null;
};

export type TunnelMessage = {
  id: string;
  tunnel_id: string;
  trip_id: string;
  sender_phone: string;
  recipient_phone: string;
  sender_role: TunnelSenderRole;
  content: string;
  status: TunnelMessageStatus;
  created_at: string;
};

export const TUNNEL_CLOSED_MESSAGE =
  "Este canal de comunicación ya no está disponible.";

const TUNNEL_OPEN_NOTICE =
  "💬 Canal WhatXia activo. Puedes escribir mensajes aquí: se reenviarán automáticamente sin compartir números.";

const CLOSE_AFTER_MS = 5 * 60 * 1000;

const OPEN_STATUSES: TunnelStatus[] = ["active", "closing"];

function mapTunnel(row: ConversationTunnel): ConversationTunnel {
  return row;
}

export async function openTunnel(input: {
  tripId: string;
  passengerPhone: string;
  driverPhone: string;
}): Promise<ConversationTunnel> {
  const supabase = getSupabase();
  const passengerPhone = normalizePhone(input.passengerPhone);
  const driverPhone = normalizePhone(input.driverPhone);

  console.log("[tunnel:open:insert:start]", {
    trip_id: input.tripId,
    passenger_phone: passengerPhone,
    driver_phone: driverPhone,
    status: "active",
  });

  const { data, error } = await supabase
    .from("conversation_tunnels")
    .insert({
      trip_id: input.tripId,
      passenger_phone: passengerPhone,
      driver_phone: driverPhone,
      status: "active",
    })
    .select("*")
    .single();

  if (error) {
    console.error("[tunnel:open:insert:FAIL]", {
      trip_id: input.tripId,
      passenger_phone: passengerPhone,
      driver_phone: driverPhone,
      supabase_error: {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      },
      supabase_error_full: error,
    });

    // Ya existe túnel para este viaje → reabrir / reasignar conductor.
    if (error.code === "23505") {
      const rebound = await rebindTunnelDriver({
        tripId: input.tripId,
        passengerPhone,
        driverPhone,
      });
      if (rebound) {
        console.log("[tunnel:open:rebind]", {
          trip_id: input.tripId,
          tunnel_id: rebound.id,
          driver_phone: rebound.driver_phone,
          status: rebound.status,
        });
        await Promise.allSettled([
          sendTextMessage(rebound.passenger_phone, TUNNEL_OPEN_NOTICE),
          sendTextMessage(rebound.driver_phone, TUNNEL_OPEN_NOTICE),
        ]);
        return rebound;
      }
    }
    throw error;
  }

  const tunnel = mapTunnel(data as ConversationTunnel);

  console.log("[tunnel:open:insert:OK]", {
    trip_id: tunnel.trip_id,
    passenger_phone: tunnel.passenger_phone,
    driver_phone: tunnel.driver_phone,
    tunnel_id: tunnel.id,
    status: tunnel.status,
    insert_row: data,
  });

  // Verificación inmediata post-INSERT (solo diagnóstico).
  await diagnoseTunnelVisibility({
    tripId: tunnel.trip_id,
    passengerPhone: tunnel.passenger_phone,
    driverPhone: tunnel.driver_phone,
    expectedTunnelId: tunnel.id,
    phase: "right_after_insert",
  });

  await Promise.allSettled([
    sendTextMessage(tunnel.passenger_phone, TUNNEL_OPEN_NOTICE),
    sendTextMessage(tunnel.driver_phone, TUNNEL_OPEN_NOTICE),
  ]);

  console.log("[tunnel:open]", {
    tunnelId: tunnel.id,
    tripId: tunnel.trip_id,
    status: tunnel.status,
    passengerPhone: tunnel.passenger_phone,
    driverPhone: tunnel.driver_phone,
  });

  return tunnel;
}

/** Solo logs: confirma si el túnel es visible por trip_id y por teléfonos. */
export async function diagnoseTunnelVisibility(input: {
  tripId: string;
  passengerPhone: string;
  driverPhone: string;
  expectedTunnelId?: string | null;
  phase: string;
}): Promise<void> {
  const supabase = getSupabase();
  const passengerPhone = normalizePhone(input.passengerPhone);
  const driverPhone = normalizePhone(input.driverPhone);

  try {
    const byTrip = await supabase
      .from("conversation_tunnels")
      .select("id, status, trip_id, passenger_phone, driver_phone")
      .eq("trip_id", input.tripId);

    const byPassenger = await supabase
      .from("conversation_tunnels")
      .select("id, status, trip_id, passenger_phone, driver_phone")
      .eq("passenger_phone", passengerPhone)
      .in("status", OPEN_STATUSES);

    const byDriver = await supabase
      .from("conversation_tunnels")
      .select("id, status, trip_id, passenger_phone, driver_phone")
      .eq("driver_phone", driverPhone)
      .in("status", OPEN_STATUSES);

    const lookup = await lookupOpenTunnelForPhone(passengerPhone);
    const lookupDriver = await lookupOpenTunnelForPhone(driverPhone);

    const foundByTrip =
      (byTrip.data ?? []).some((row) => row.id === input.expectedTunnelId) ||
      (byTrip.data?.length ?? 0) > 0;

    console.log("[tunnel:diagnose]", {
      phase: input.phase,
      trip_id: input.tripId,
      passenger_phone: passengerPhone,
      driver_phone: driverPhone,
      expected_tunnel_id: input.expectedTunnelId ?? null,
      count_by_trip_id: byTrip.data?.length ?? 0,
      rows_by_trip_id: byTrip.data ?? null,
      by_trip_error: byTrip.error
        ? {
            message: byTrip.error.message,
            code: byTrip.error.code,
            details: byTrip.error.details,
            hint: byTrip.error.hint,
          }
        : null,
      count_active_by_passenger_phone: byPassenger.data?.length ?? 0,
      rows_active_by_passenger_phone: byPassenger.data ?? null,
      by_passenger_error: byPassenger.error
        ? {
            message: byPassenger.error.message,
            code: byPassenger.error.code,
            details: byPassenger.error.details,
            hint: byPassenger.error.hint,
          }
        : null,
      count_active_by_driver_phone: byDriver.data?.length ?? 0,
      rows_active_by_driver_phone: byDriver.data ?? null,
      by_driver_error: byDriver.error
        ? {
            message: byDriver.error.message,
            code: byDriver.error.code,
            details: byDriver.error.details,
            hint: byDriver.error.hint,
          }
        : null,
      lookup_passenger_found: Boolean(lookup.tunnel),
      lookup_passenger_reason: lookup.reason,
      lookup_passenger_tunnel_id: lookup.tunnel?.id ?? null,
      lookup_driver_found: Boolean(lookupDriver.tunnel),
      lookup_driver_reason: lookupDriver.reason,
      lookup_driver_tunnel_id: lookupDriver.tunnel?.id ?? null,
      insert_ok_but_lookup_miss:
        Boolean(input.expectedTunnelId) &&
        (!lookup.tunnel || lookup.tunnel.id !== input.expectedTunnelId),
      found_by_trip_query: foundByTrip,
    });
  } catch (error) {
    console.error("[tunnel:diagnose:exception]", {
      phase: input.phase,
      trip_id: input.tripId,
      error,
    });
  }
}

export async function getTunnelByTripId(
  tripId: string,
): Promise<ConversationTunnel | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("conversation_tunnels")
    .select("*")
    .eq("trip_id", tripId)
    .maybeSingle();

  if (error) {
    console.error("[tunnel] error al buscar por viaje:", error);
    throw error;
  }

  return data ? mapTunnel(data as ConversationTunnel) : null;
}

/** Reasigna el conductor del túnel y lo deja active (Sprint 21). */
export async function rebindTunnelDriver(input: {
  tripId: string;
  passengerPhone: string;
  driverPhone: string;
}): Promise<ConversationTunnel | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("conversation_tunnels")
    .update({
      passenger_phone: normalizePhone(input.passengerPhone),
      driver_phone: normalizePhone(input.driverPhone),
      status: "active",
      closes_at: null,
      closed_at: null,
    })
    .eq("trip_id", input.tripId)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[tunnel] error al rebind:", error);
    throw error;
  }

  return data ? mapTunnel(data as ConversationTunnel) : null;
}

type TunnelLookupResult = {
  tunnel: ConversationTunnel | null;
  reason: string;
};

/**
 * Túnel usable para mensajes: active o closing (mientras no expire).
 * Busca por passenger_phone y driver_phone por separado (evita bugs de .or + .in).
 */
export async function findOpenTunnelForPhone(
  phone: string,
): Promise<ConversationTunnel | null> {
  const result = await lookupOpenTunnelForPhone(phone);
  return result.tunnel;
}

export async function lookupOpenTunnelForPhone(
  phone: string,
): Promise<TunnelLookupResult> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);
  const candidates = Array.from(
    new Set([normalized, phone.trim()].filter(Boolean)),
  );

  console.log("[tunnel:lookup]", {
    phone,
    normalized,
    candidates,
  });

  try {
    for (const candidate of candidates) {
      const { data: asPassenger, error: passengerError } = await supabase
        .from("conversation_tunnels")
        .select("*")
        .eq("passenger_phone", candidate)
        .in("status", OPEN_STATUSES)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (passengerError) {
        console.error("[tunnel] error al buscar por pasajero:", passengerError);
        return {
          tunnel: null,
          reason: `db_error_passenger:${passengerError.message}`,
        };
      }

      if (asPassenger) {
        return finalizeOpenTunnel(
          mapTunnel(asPassenger as ConversationTunnel),
          "matched_passenger_phone",
        );
      }

      const { data: asDriver, error: driverError } = await supabase
        .from("conversation_tunnels")
        .select("*")
        .eq("driver_phone", candidate)
        .in("status", OPEN_STATUSES)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (driverError) {
        console.error("[tunnel] error al buscar por conductor:", driverError);
        return {
          tunnel: null,
          reason: `db_error_driver:${driverError.message}`,
        };
      }

      if (asDriver) {
        return finalizeOpenTunnel(
          mapTunnel(asDriver as ConversationTunnel),
          "matched_driver_phone",
        );
      }
    }

    // Fallback: últimos túneles abiertos y match con samePhone (formatos mixtos).
    const { data: openRows, error: openError } = await supabase
      .from("conversation_tunnels")
      .select("*")
      .in("status", OPEN_STATUSES)
      .order("opened_at", { ascending: false })
      .limit(20);

    if (openError) {
      console.error("[tunnel] error al listar abiertos:", openError);
      return {
        tunnel: null,
        reason: `db_error_list:${openError.message}`,
      };
    }

    const fuzzy = (openRows ?? []).find(
      (row) =>
        samePhone(phone, (row as ConversationTunnel).passenger_phone) ||
        samePhone(phone, (row as ConversationTunnel).driver_phone),
    );

    if (fuzzy) {
      return finalizeOpenTunnel(
        mapTunnel(fuzzy as ConversationTunnel),
        "matched_samePhone_fallback",
      );
    }

    return {
      tunnel: null,
      reason: `no_open_tunnel_for_phone (checked ${candidates.join(",")}; open_count=${openRows?.length ?? 0})`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[tunnel] lookup exception:", error);
    return { tunnel: null, reason: `exception:${message}` };
  }
}

async function finalizeOpenTunnel(
  tunnel: ConversationTunnel,
  matchReason: string,
): Promise<TunnelLookupResult> {
  // Cierre lazy: closing → closed cuando closes_at ya pasó.
  if (
    tunnel.status === "closing" &&
    tunnel.closes_at &&
    new Date(tunnel.closes_at).getTime() <= Date.now()
  ) {
    await closeTunnel(tunnel.id);
    return {
      tunnel: null,
      reason: `tunnel_expired_lazy_closed trip_id=${tunnel.trip_id} status_was=closing`,
    };
  }

  return { tunnel, reason: matchReason };
}

/** @deprecated Usar findOpenTunnelForPhone */
export async function findActiveTunnelForPhone(
  phone: string,
): Promise<ConversationTunnel | null> {
  return findOpenTunnelForPhone(phone);
}

/**
 * Viaje finalizado → status closing + closes_at = now + 20 min.
 * El cron / lazy close hará closing → closed.
 */
export async function scheduleTunnelClose(
  tripId: string,
  delayMs: number = CLOSE_AFTER_MS,
): Promise<ConversationTunnel | null> {
  const supabase = getSupabase();
  const closesAt = new Date(Date.now() + delayMs).toISOString();

  const { data, error } = await supabase
    .from("conversation_tunnels")
    .update({
      status: "closing",
      closes_at: closesAt,
    })
    .eq("trip_id", tripId)
    .eq("status", "active")
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[tunnel] error al programar cierre:", error);
    throw error;
  }

  if (data) {
    console.log("[tunnel:schedule-close]", {
      tripId,
      status: "closing",
      closesAt,
      tunnelId: (data as ConversationTunnel).id,
    });
  }

  return data ? mapTunnel(data as ConversationTunnel) : null;
}

export async function closeTunnel(
  tunnelId: string,
): Promise<ConversationTunnel | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("conversation_tunnels")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
    })
    .eq("id", tunnelId)
    .in("status", OPEN_STATUSES)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[tunnel] error al cerrar:", error);
    throw error;
  }

  if (data) {
    console.log("[tunnel:closed]", { tunnelId });
  }

  return data ? mapTunnel(data as ConversationTunnel) : null;
}

/** Cierre inmediato (p. ej. cancelación de viaje). */
export async function closeTunnelForTrip(
  tripId: string,
): Promise<ConversationTunnel | null> {
  const supabase = getSupabase();
  const closedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("conversation_tunnels")
    .update({
      status: "closed",
      closed_at: closedAt,
      closes_at: closedAt,
    })
    .eq("trip_id", tripId)
    .in("status", OPEN_STATUSES)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[tunnel] error al cerrar por viaje:", error);
    throw error;
  }

  if (data) {
    console.log("[tunnel:closed-immediate]", {
      tripId,
      tunnelId: (data as ConversationTunnel).id,
    });
  }

  return data ? mapTunnel(data as ConversationTunnel) : null;
}

/** Cron / lazy: closing → closed cuando closes_at <= now. */
export async function closeExpiredTunnels(): Promise<number> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("conversation_tunnels")
    .update({
      status: "closed",
      closed_at: now,
    })
    .eq("status", "closing")
    .not("closes_at", "is", null)
    .lte("closes_at", now)
    .select("id");

  if (error) {
    console.error("[tunnel] error al cerrar expirados:", error);
    throw error;
  }

  const count = data?.length ?? 0;
  console.log("[tunnel:close-expired]", { count });
  return count;
}

async function insertTunnelMessage(input: {
  tunnelId: string;
  tripId: string;
  senderPhone: string;
  recipientPhone: string;
  senderRole: TunnelSenderRole;
  content: string;
  status: TunnelMessageStatus;
}): Promise<TunnelMessage> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("tunnel_messages")
    .insert({
      tunnel_id: input.tunnelId,
      trip_id: input.tripId,
      sender_phone: normalizePhone(input.senderPhone),
      recipient_phone: normalizePhone(input.recipientPhone),
      sender_role: input.senderRole,
      content: input.content,
      status: input.status,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[tunnel] error al guardar mensaje:", error);
    throw error;
  }

  return data as TunnelMessage;
}

async function updateMessageStatus(
  messageId: string,
  status: TunnelMessageStatus,
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase
    .from("tunnel_messages")
    .update({ status })
    .eq("id", messageId);

  if (error) {
    console.error("[tunnel] error al actualizar estado mensaje:", error);
  }
}

export type TunnelRouteResult = {
  outcome: "routed" | "none";
  found: boolean;
  tripId: string | null;
  status: TunnelStatus | null;
  reason: string;
};

/**
 * Enruta un texto del túnel al interlocutor.
 * Solo active/closing. closed → none (el handler puede volver al menú con Hola).
 */
export async function routeTunnelMessage(
  senderPhone: string,
  content: string,
): Promise<TunnelRouteResult> {
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      outcome: "none",
      found: false,
      tripId: null,
      status: null,
      reason: "empty_text",
    };
  }

  try {
    await closeExpiredTunnels();
  } catch (error) {
    console.error("[tunnel] closeExpiredTunnels falló (¿tabla existe?):", error);
  }

  const lookup = await lookupOpenTunnelForPhone(senderPhone);
  const tunnel = lookup.tunnel;

  if (!tunnel) {
    return {
      outcome: "none",
      found: false,
      tripId: null,
      status: null,
      reason: lookup.reason,
    };
  }

  // Durante SEARCHING (reasignación) el túnel permanece abierto pero no enruta.
  const trip = await getTrip(tunnel.trip_id);
  if (
    !trip ||
    trip.status === "SEARCHING" ||
    trip.status === "CANCELLED" ||
    trip.status === "COMPLETED"
  ) {
    return {
      outcome: "none",
      found: true,
      tripId: tunnel.trip_id,
      status: tunnel.status,
      reason: `trip_status_${trip?.status ?? "missing"}`,
    };
  }

  const isPassenger = samePhone(senderPhone, tunnel.passenger_phone);
  const recipientPhone = isPassenger
    ? tunnel.driver_phone
    : tunnel.passenger_phone;
  const senderRole: TunnelSenderRole = isPassenger ? "passenger" : "driver";
  const prefix = isPassenger ? "💬 Pasajero" : "💬 Conductor";

  const saved = await insertTunnelMessage({
    tunnelId: tunnel.id,
    tripId: tunnel.trip_id,
    senderPhone,
    recipientPhone,
    senderRole,
    content: trimmed,
    status: "pending",
  });

  try {
    await sendTextMessage(recipientPhone, `${prefix}:\n${trimmed}`);
    await updateMessageStatus(saved.id, "sent");
  } catch (error) {
    console.error("[tunnel] fallo al reenviar:", error);
    await updateMessageStatus(saved.id, "failed");
    await sendTextMessage(
      senderPhone,
      "No pudimos entregar tu mensaje. Intenta de nuevo en un momento.",
    );
  }

  return {
    outcome: "routed",
    found: true,
    tripId: tunnel.trip_id,
    status: tunnel.status,
    reason: lookup.reason,
  };
}

/**
 * Si el túnel ya cerró y el usuario escribe texto que no es saludo/comando.
 * "Hola" no pasa por aquí: el handler lo envía al menú normal.
 */
export async function notifyIfTunnelClosed(
  phone: string,
): Promise<boolean> {
  await closeExpiredTunnels();

  const open = await findOpenTunnelForPhone(phone);
  if (open) {
    return false;
  }

  const recentlyClosed = await findRecentlyClosedTunnelForPhone(phone);
  if (!recentlyClosed) {
    return false;
  }

  await sendTextMessage(phone, TUNNEL_CLOSED_MESSAGE);
  return true;
}

async function findRecentlyClosedTunnelForPhone(
  phone: string,
): Promise<ConversationTunnel | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("conversation_tunnels")
    .select("*")
    .eq("status", "closed")
    .or(
      `passenger_phone.eq.${normalized},driver_phone.eq.${normalized}`,
    )
    .gte("closed_at", since)
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[tunnel] error al buscar cerrado reciente:", error);
    throw error;
  }

  return data ? mapTunnel(data as ConversationTunnel) : null;
}
