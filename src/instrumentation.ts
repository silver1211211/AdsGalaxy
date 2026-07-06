export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { validateProductionStartupEnvironment } = await import("./lib/productionStartupValidation");
  validateProductionStartupEnvironment();

  const { validateBotIntegrationEncryptionConfig, isBotEncryptionError } = await import("@/lib/botIntegration");
  try {
    validateBotIntegrationEncryptionConfig();
  } catch (error: unknown) {
    if (isBotEncryptionError(error)) {
      console.error("[startup] Bot integration encryption configuration failure", { code: error.code, diagnostic: error.message });
      if (process.env.MODE === "PROD") throw error;
      return;
    }
    throw error;
  }
}
