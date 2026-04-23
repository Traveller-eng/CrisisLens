/**
 * Fires an automated alert to a Google Chat Space webhook when a DISPATCH is confirmed.
 * Set VITE_GOOGLE_CHAT_WEBHOOK_URL in web/.env to enable.
 */
export async function triggerGoogleChatAlert(incident: {
  location: string;
  confidence: string;
  reasoning: string;
}): Promise<void> {
  const webhookUrl = import.meta.env.VITE_GOOGLE_CHAT_WEBHOOK_URL as string | undefined;

  if (!webhookUrl) {
    console.warn("Google Chat Webhook URL not configured. Skipping alert.");
    return;
  }

  const messagePayload = {
    text:
      `🚨 *URGENT DISPATCH RECOMMENDED* 🚨\n\n` +
      `*Location:* ${incident.location}\n` +
      `*Confidence Score:* ${incident.confidence}\n\n` +
      `*🧠 Gemini AI Reasoning:*\n${incident.reasoning}\n\n` +
      `*Action Required:* Deploy immediate response unit to coordinates.`
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(messagePayload)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    console.log("Successfully fired Google Chat alert for", incident.location);
  } catch (error) {
    console.error("Failed to send Google Chat alert:", error);
  }
}
