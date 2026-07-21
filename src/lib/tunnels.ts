import { getSupabase } from "@/lib/supabase/client";
import { normalizePhone, samePhone } from "@/lib/trips";
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

const CLOSE_AFTER_MS = 20 * 60 * 1000;

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

  const { data, error } = await supabase
    .from("conversation_tunnels")
    .insert({
      trip_id: input.tripId,
      passenger_phone: normalizePhone(input.passengerPhone),
      driver_phone: normalizePhone(input.driverPhone),
      status: "active",
    })
    .select("*")
    .single();

  if (error) {
    // Ya existe túnel para este viaje.
    if (error.code === "23505") {
      const existing = await getTunnelByTripId(input.tripId);
      if (existing) {
        return existing;
      }
    }
    console.error("[tunnel] error al abrir:", error);
    throw error;
  }

  const tunnel = mapTunnel(data as ConversationTunnel);

  await Promise.allSettled([
    sendTextMessage(tunnel.passenger_phone, TUNNEL_OPEN_NOTICE),
    sendTextMessage(tunnel.driver_phone, TUNNEL_OPEN_NOTICE),
  ]);

  console.log("[tunnel:open]", {
    tunnelId: tunnel.id,
    tripId: tunnel.trip_id,
  });

  return tunnel;
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

/**
 * Túnel usable para mensajes: active o closing (mientras no expire).
 */
export async function findOpenTunnelForPhone(
  phone: string,
): Promise<ConversationTunnel | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("conversation_tunnels")
    .select("*")
    .in("status", OPEN_STATUSES)
    .or(
      `passenger_phone.eq.${normalized},driver_phone.eq.${normalized}`,
    )
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[tunnel] error al buscar abierto:", error);
    throw error;
  }

  if (!data) {
    return null;
  }

  const tunnel = mapTunnel(data as ConversationTunnel);

  // Cierre lazy: closing → closed cuando closes_at ya pasó.
  if (
    tunnel.status === "closing" &&
    tunnel.closes_at &&
    new Date(tunnel.closes_at).getTime() <= Date.now()
  ) {
    await closeTunnel(tunnel.id);
    return null;
  }

  return tunnel;
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

/**
 * Enruta un texto del túnel al interlocutor.
 * Solo active/closing. closed → none (el handler puede volver al menú con Hola).
 */
export async function routeTunnelMessage(
  senderPhone: string,
  content: string,
): Promise<"routed" | "none"> {
  const trimmed = content.trim();
  if (!trimmed) {
    return "none";
  }

  await closeExpiredTunnels();

  const tunnel = await findOpenTunnelForPhone(senderPhone);

  if (!tunnel) {
    return "none";
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

  return "routed";
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
