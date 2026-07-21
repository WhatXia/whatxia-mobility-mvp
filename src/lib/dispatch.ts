import { getAvailableDrivers } from "@/lib/drivers";
import { sendButtonsMessage } from "@/lib/whatsapp/client";

export const DRIVER_BUTTON_IDS = {
  ACEPTAR: "aceptar_servicio",
  RECHAZAR: "rechazar_servicio",
} as const;

export async function offerTripToDrivers(pickupNeighborhood: string) {
  const availableDrivers = getAvailableDrivers();

  if (availableDrivers.length === 0) {
    console.warn("[dispatch] no hay conductores disponibles");
    return;
  }

  const body = [
    "🚖 Nuevo servicio",
    "",
    "📍 Recogida:",
    pickupNeighborhood,
    "",
    "Aceptar el servicio:",
  ].join("\n");

  const buttons = [
    { id: DRIVER_BUTTON_IDS.ACEPTAR, title: "✅ Aceptar" },
    { id: DRIVER_BUTTON_IDS.RECHAZAR, title: "❌ Rechazar" },
  ];

  console.log("[dispatch] enviando oferta a conductores:", {
    pickupNeighborhood,
    drivers: availableDrivers.map((d) => ({ id: d.id, phone: d.phone })),
  });

  const results = await Promise.allSettled(
    availableDrivers.map((driver) =>
      sendButtonsMessage(driver.phone, body, buttons),
    ),
  );

  results.forEach((result, index) => {
    const driver = availableDrivers[index];

    if (result.status === "fulfilled") {
      console.log("[dispatch] oferta enviada:", driver.phone);
    } else {
      console.error(
        "[dispatch] fallo al notificar:",
        driver.phone,
        result.reason,
      );
    }
  });
}
