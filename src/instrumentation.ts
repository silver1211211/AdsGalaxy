export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateBotIntegrationEncryptionConfig, isBotEncryptionError } = await import("@/lib/botIntegration");
  try {
    validateBotIntegrationEncryptionConfig();
  } catch (error: unknown) {
    if (isBotEncryptionError(error)) {
      console.error("[startup] Bot integration encryption configuration failure", { code: error.code, diagnostic: error.message });
      if (process.env.NODE_ENV === "production") throw error;
      return;
    }
    throw error;
  }
}
