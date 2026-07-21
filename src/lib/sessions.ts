import type {
  DriverDraft,
  DriverFieldCategory,
  UserSession,
  UserState,
} from "@/types";
import { getSupabase } from "@/lib/supabase/client";
import { normalizePhone } from "@/lib/trips";

type SessionRow = {
  phone: string;
  name: string;
  state: UserState;
  pickup_neighborhood: string | null;
  driver_name: string | null;
  driver_draft: DriverDraft | null;
  driver_flow_step: string | null;
  driver_update_category: DriverFieldCategory | null;
  driver_update_field: string | null;
};

function mapRow(row: SessionRow): UserSession {
  return {
    phone: row.phone,
    name: row.name,
    state: row.state,
    pickupNeighborhood: row.pickup_neighborhood,
    driverName: row.driver_name,
    driverDraft: row.driver_draft,
    driverFlowStep: row.driver_flow_step,
    driverUpdateCategory: row.driver_update_category,
    driverUpdateField: row.driver_update_field,
  };
}

export async function getSession(
  phone: string,
): Promise<UserSession | undefined> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("conversation_sessions")
    .select(
      "phone, name, state, pickup_neighborhood, driver_name, driver_draft, driver_flow_step, driver_update_category, driver_update_field",
    )
    .eq("phone", normalized)
    .maybeSingle();

  if (error) {
    console.error("[session] error al leer:", error);
    throw error;
  }

  if (!data) {
    return undefined;
  }

  return mapRow(data as SessionRow);
}

export async function upsertSession(
  phone: string,
  data: {
    name?: string;
    state: UserState;
    pickupNeighborhood?: string | null;
    driverName?: string | null;
    driverDraft?: DriverDraft | null;
    driverFlowStep?: string | null;
    driverUpdateCategory?: DriverFieldCategory | null;
    driverUpdateField?: string | null;
  },
): Promise<UserSession> {
  const current = await getSession(phone);
  const normalized = normalizePhone(phone);

  const session: UserSession = {
    phone: normalized,
    name: data.name ?? current?.name ?? "",
    state: data.state,
    pickupNeighborhood:
      data.pickupNeighborhood !== undefined
        ? data.pickupNeighborhood
        : (current?.pickupNeighborhood ?? null),
    driverName:
      data.driverName !== undefined
        ? data.driverName
        : (current?.driverName ?? null),
    driverDraft:
      data.driverDraft !== undefined
        ? data.driverDraft
        : (current?.driverDraft ?? null),
    driverFlowStep:
      data.driverFlowStep !== undefined
        ? data.driverFlowStep
        : (current?.driverFlowStep ?? null),
    driverUpdateCategory:
      data.driverUpdateCategory !== undefined
        ? data.driverUpdateCategory
        : (current?.driverUpdateCategory ?? null),
    driverUpdateField:
      data.driverUpdateField !== undefined
        ? data.driverUpdateField
        : (current?.driverUpdateField ?? null),
  };

  const supabase = getSupabase();

  const { error } = await supabase.from("conversation_sessions").upsert(
    {
      phone: normalized,
      name: session.name,
      state: session.state,
      pickup_neighborhood: session.pickupNeighborhood,
      driver_name: session.driverName,
      driver_draft: session.driverDraft,
      driver_flow_step: session.driverFlowStep,
      driver_update_category: session.driverUpdateCategory,
      driver_update_field: session.driverUpdateField,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "phone" },
  );

  if (error) {
    console.error("[session] error al guardar:", error);
    throw error;
  }

  console.log("[session:upsert]", {
    phone: normalized,
    state: session.state,
    driverUpdateCategory: session.driverUpdateCategory,
    driverUpdateField: session.driverUpdateField,
    driverFlowStep: session.driverFlowStep,
  });

  return session;
}

export async function clearSession(phone: string): Promise<void> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { error } = await supabase
    .from("conversation_sessions")
    .delete()
    .eq("phone", normalized);

  if (error) {
    console.error("[session] error al eliminar:", error);
    throw error;
  }

  console.log("[session:clear]", { phone: normalized });
}
