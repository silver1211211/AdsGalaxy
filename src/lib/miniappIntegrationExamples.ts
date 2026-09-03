export const canonicalMiniappScriptExample =
  '<script src="https://app.adsgalaxy.online/sdk.js?id=YOUR_NUMERIC_MINI_APP_ID"></script>';

export const minimalMiniappDisplayExample = "window.showAdsGalaxy();";

export const canonicalMiniappDisplayExample = `window.showAdsGalaxy()
  .then(function (result) {
    // Send result.request_id to your backend.
    // Do not credit a valuable wallet here.
  })
  .catch(function (error) {
    console.log(error.code, error.message);
  });`;

export const directRewardCallbackPayloadExample = `{
  "event_id": "rwe_...",
  "request_id": "req_...",
  "mini_app_id": 123,
  "user_id": "123456789",
  "status": "completed",
  "completed_at": "2026-08-01T22:58:00Z"
}`;

export const nodeRewardCallbackVerificationExample = `import crypto from "node:crypto";

function verify(rawBody, headers, secret) {
  const timestamp = headers["x-adsgalaxy-timestamp"];
  const eventId = headers["x-adsgalaxy-event-id"];

  if (
    !timestamp ||
    !eventId ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  ) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(timestamp + "." + eventId + "." + rawBody)
    .digest("hex");

  const supplied = String(
    headers["x-adsgalaxy-signature"] || ""
  );

  return (
    supplied.length === expected.length &&
    crypto.timingSafeEqual(
      Buffer.from(supplied),
      Buffer.from(expected)
    )
  );
}

// In one database transaction:
// 1. Insert eventId under a UNIQUE constraint.
// 2. Credit the user once.
// 3. Commit.
// Return HTTP 2xx only after successful processing.`;
