type ReplyButton = {
  id: string;
  title: string;
};

function getConfig() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION ?? "v21.0";

  if (!token || !phoneNumberId) {
    throw new Error(
      "Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en el entorno.",
    );
  }

  return { token, phoneNumberId, apiVersion };
}

async function sendMessage(payload: Record<string, unknown>) {
  const { token, phoneNumberId, apiVersion } = getConfig();

  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...payload,
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[whatsapp] error al enviar mensaje:", errorBody);
    throw new Error(`WhatsApp API error: ${response.status}`);
  }

  return response.json();
}

export async function sendTextMessage(
  to: string,
  text: string,
  options?: { previewUrl?: boolean },
) {
  return sendMessage({
    to,
    type: "text",
    text: { preview_url: Boolean(options?.previewUrl), body: text },
  });
}

/**
 * Botón CTA con URL (abre el enlace nativamente, p. ej. Google Maps).
 * Docs: interactive type cta_url
 */
export async function sendCtaUrlMessage(
  to: string,
  bodyText: string,
  cta: { displayText: string; url: string },
) {
  return sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: bodyText },
      action: {
        name: "cta_url",
        parameters: {
          display_text: cta.displayText.slice(0, 20),
          url: cta.url,
        },
      },
    },
  });
}

export async function sendButtonsMessage(
  to: string,
  bodyText: string,
  buttons: ReplyButton[],
) {
  return sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.map((button) => ({
          type: "reply",
          reply: {
            id: button.id,
            title: button.title,
          },
        })),
      },
    },
  });
}

export async function sendLocationMessage(
  to: string,
  location: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  },
) {
  return sendMessage({
    to,
    type: "location",
    location: {
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.name,
      address: location.address,
    },
  });
}

/**
 * Location request message (Meta Cloud API oficial).
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/location-request-messages/
 *
 * Muestra cuerpo + botón nativo "Enviar ubicación" que abre el selector de ubicación.
 */
export async function sendLocationRequestMessage(
  to: string,
  bodyText: string,
) {
  return sendMessage({
    to,
    type: "interactive",
    interactive: {
      type: "location_request_message",
      body: {
        text: bodyText,
      },
      action: {
        name: "send_location",
      },
    },
  });
}
