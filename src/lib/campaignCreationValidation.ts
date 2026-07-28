export const CAMPAIGN_OBJECTIVES = ["views", "clicks", "broadcast"] as const;
export type CampaignObjective = typeof CAMPAIGN_OBJECTIVES[number];

export class CampaignCreatePublicError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status = 400,
  ) {
    super(message);
    this.name = "CampaignCreatePublicError";
    this.code = code;
    this.status = status;
  }
}

export function validateCampaignObjective(value: unknown): CampaignObjective {
  const objective = typeof value === "string" ? value.trim() : "";
  if (!CAMPAIGN_OBJECTIVES.includes(objective as CampaignObjective)) {
    throw new CampaignCreatePublicError(
      "INVALID_CAMPAIGN_TYPE",
      "Campaign objective must be views, clicks, or broadcast.",
    );
  }
  return objective as CampaignObjective;
}

export function validateCampaignText(input: {
  name: string;
  campaignTitle: string;
  messageText: string;
  link: unknown;
  buttonText: unknown;
}) {
  if (input.name.length < 3 || input.name.length > 50) {
    throw new CampaignCreatePublicError("INVALID_CAMPAIGN_NAME", "Campaign name must be between 3 and 50 characters.");
  }
  if (input.campaignTitle.length < 3 || input.campaignTitle.length > 255) {
    throw new CampaignCreatePublicError("INVALID_CAMPAIGN_TITLE", "Campaign title must be between 3 and 255 characters.");
  }
  if (!input.messageText.trim() || input.messageText.length > 1000) {
    throw new CampaignCreatePublicError("INVALID_AD_TEXT", "Message text is required and must not exceed 1000 characters.");
  }
  if (!String(input.buttonText || "").trim()) {
    throw new CampaignCreatePublicError("MISSING_CTA", "Please select a button text.");
  }
  try {
    const destination = new URL(String(input.link || ""));
    if (!["http:", "https:"].includes(destination.protocol) || !destination.hostname.includes(".")) throw new Error();
  } catch {
    throw new CampaignCreatePublicError("INVALID_DESTINATION_URL", "Enter a valid HTTP or HTTPS destination URL.");
  }
}

const SAFE_VALIDATION_PATTERNS = [
  /budget/i, /CPM Bid/i, /CPC/i, /campaign category/i, /countries/i,
  /languages/i, /policy/i, /date/i, /frequency cap/i, /postback/i,
  /direct placement/i, /inventory/i,
];

export function publicCampaignValidationError(error: unknown) {
  if (error instanceof CampaignCreatePublicError) return error;
  const message = error instanceof Error ? error.message : "";
  if (SAFE_VALIDATION_PATTERNS.some((pattern) => pattern.test(message))) {
    return new CampaignCreatePublicError("INVALID_CAMPAIGN_DETAILS", message);
  }
  return null;
}

export function classifyCampaignCreateFailure(error: unknown) {
  if (error && typeof error === "object" && "code" in error && error.code === "CAMPAIGN_SCHEMA_NOT_READY") {
    return {
      status: 503,
      body: {
        error: "Campaign creation is temporarily unavailable. Please try again later.",
        code: "CAMPAIGN_SCHEMA_NOT_READY",
      },
    };
  }
  const validationError = publicCampaignValidationError(error);
  if (validationError) {
    return {
      status: validationError.status,
      body: { error: validationError.message, code: validationError.code },
    };
  }
  return {
    status: 500,
    body: {
      error: "Campaign creation failed. Please try again later.",
      code: "CAMPAIGN_CREATE_FAILED",
    },
  };
}
