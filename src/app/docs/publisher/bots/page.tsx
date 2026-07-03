import DocsArticle, { type DocsSection } from "@/components/docs/DocsArticle";

const integrationUrl = "https://app.adsgalaxy.online/api/bot/integration/YOUR_BOT_ID/YOUR_SECRET";

const phpExample = `// Inside your existing /start handler. Keep all of your current bot logic.
$payload = [
    'telegram_user_id' => $message['from']['id'],
    'chat_id' => $message['chat']['id'],
    'username' => $message['from']['username'] ?? null,
    'first_name' => $message['from']['first_name'] ?? null,
    'language_code' => $message['from']['language_code'] ?? null,
    'bot_id' => 'YOUR_BOT_ID',
    'timestamp' => time(),
    'request_id' => bin2hex(random_bytes(16)),
];

$ch = curl_init('YOUR_INTEGRATION_URL');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 3,
]);
curl_exec($ch);
curl_close($ch);`;

const phpStreamExample = `// Paste this inside your /start command handler.
$payload = json_encode([
    'telegram_user_id' => $message['from']['id'] ?? null,
    'chat_id' => $message['chat']['id'],
    'username' => $message['from']['username'] ?? null,
    'first_name' => $message['from']['first_name'] ?? null,
    'language_code' => $message['from']['language_code'] ?? null,
    'bot_id' => 'YOUR_BOT_ID', 'timestamp' => time(),
    'request_id' => bin2hex(random_bytes(16)),
]);
$context = stream_context_create(['http' => [
    'method' => 'POST', 'header' => "Content-Type: application/json\r\n",
    'content' => $payload, 'timeout' => 3, 'ignore_errors' => true,
]]);
@file_get_contents('YOUR_INTEGRATION_URL', false, $context);`;

const nodeExample = `// Telegraf example: add this without removing your existing start logic.
bot.start(async (ctx) => {
  // Your existing /start response and business logic stay here.

  fetch('YOUR_INTEGRATION_URL', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      telegram_user_id: ctx.from.id,
      chat_id: ctx.chat.id,
      username: ctx.from.username,
      first_name: ctx.from.first_name,
      language_code: ctx.from.language_code,
      bot_id: 'YOUR_BOT_ID',
      timestamp: Math.floor(Date.now() / 1000),
      request_id: crypto.randomUUID(),
    }),
    signal: AbortSignal.timeout(3000),
  }).catch(console.error);
});`;

const expressExample = `// Place this call inside the existing /start branch of your Express webhook route.
app.post('/telegram/webhook', async (req, res) => {
  const message = req.body.message;
  if (message?.text?.startsWith('/start')) {
    // Keep your existing welcome message and bot logic here.
    fetch(process.env.ADSGALAXY_BOT_INTEGRATION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        telegram_user_id: message.from?.id,
        chat_id: message.chat?.id,
        username: message.from?.username,
        first_name: message.from?.first_name,
        language_code: message.from?.language_code,
        bot_id: process.env.ADSGALAXY_BOT_ID,
        timestamp: Math.floor(Date.now() / 1000),
        request_id: crypto.randomUUID(),
      }),
    }).catch(console.error);
  }
  res.sendStatus(200); // Your Telegram webhook response remains yours.
});`;

const pythonExample = `# python-telegram-bot example
import time
import requests

def start(update, context):
    # Your existing /start response and business logic stay here.
    user = update.effective_user
    chat = update.effective_chat
    try:
        requests.post("YOUR_INTEGRATION_URL", json={
            "telegram_user_id": user.id,
            "chat_id": chat.id,
            "username": user.username,
            "first_name": user.first_name,
            "language_code": user.language_code,
            "bot_id": "YOUR_BOT_ID",
            "timestamp": int(time.time()),
            "request_id": str(__import__('uuid').uuid4()),
        }, timeout=3)
    except requests.RequestException:
        pass  # Never interrupt your bot if the integration is unavailable.`;

const goExample = `// Inside your existing /start handler.
payload, _ := json.Marshal(map[string]any{
    "telegram_user_id": user.ID,
    "chat_id": chat.ID,
    "username": user.Username,
    "first_name": user.FirstName,
    "language_code": user.LanguageCode,
    "bot_id": "YOUR_BOT_ID",
    "timestamp": time.Now().Unix(),
    "request_id": uuid.NewString(),
})

client := &http.Client{Timeout: 3 * time.Second}
req, _ := http.NewRequest(http.MethodPost, "YOUR_INTEGRATION_URL", bytes.NewReader(payload))
req.Header.Set("Content-Type", "application/json")
resp, err := client.Do(req)
if err == nil { defer resp.Body.Close() }`;

const laravelExample = `use Illuminate\Support\Facades\Http;

// Inside your existing /start handler.
Http::timeout(3)->post(config('services.adsgalaxy.bot_integration_url'), [
    'telegram_user_id' => $message['from']['id'],
    'chat_id' => $message['chat']['id'],
    'username' => $message['from']['username'] ?? null,
    'first_name' => $message['from']['first_name'] ?? null,
    'language_code' => $message['from']['language_code'] ?? null,
    'bot_id' => env('ADSGALAXY_BOT_ID'),
    'timestamp' => now()->timestamp,
    'request_id' => (string) Str::uuid(),
]);

// .env
// ADSGALAXY_BOT_ID=YOUR_BOT_ID
// ADSGALAXY_BOT_INTEGRATION_URL=YOUR_INTEGRATION_URL`;

const testExample = `curl -X POST "YOUR_INTEGRATION_URL" \\
  -H "Content-Type: application/json" \\
  -d '{
    "test":true,
    "telegram_user_id":"123456789",
    "chat_id":"123456789",
    "username":"integration_test",
    "first_name":"Test",
    "language_code":"en",
    "bot_id":"YOUR_BOT_ID",
    "timestamp":'"$(date +%s)"'
    ,"request_id":"manual-test-'"$(date +%s%N)"'"
  }'`;

const bjsExample = `/* Paste this inside your /start command handler (BotBusiness/BJS style). */
HTTP.post({
  url: "YOUR_INTEGRATION_URL",
  headers: { "Content-Type": "application/json" },
  body: {
    telegram_user_id: user.telegramid,
    chat_id: chat.chatid,
    username: user.username,
    first_name: user.first_name,
    language_code: user.language_code
    ,bot_id: "YOUR_BOT_ID"
    ,timestamp: Math.floor(Date.now() / 1000)
    ,request_id: "start-" + user.telegramid + "-" + Date.now()
  }
});
// Keep your existing Bot.sendMessage(...) and command logic unchanged.`;

const sections: DocsSection[] = [
  {
    id: "overview",
    title: "Overview",
    body: [
      "Bot Monetization lets approved publishers earn from sponsored broadcasts sent to legitimate users who started their Telegram bot.",
      "The AdsGalaxy Integration is a small, one-way registration call added to your existing /start handler. It is not a Telegram webhook and does not process Telegram updates.",
    ],
  },
  {
    id: "how-it-works",
    title: "How Bot Monetization works",
    body: [
      "When a user sends /start, your bot handles the command exactly as it does today. Your handler additionally forwards that user's registration fields to AdsGalaxy. AdsGalaxy stores the Telegram user ID and chat ID for eligible future broadcasts.",
      "Broadcast delivery continues to use the bot token already stored with the approved bot and the registered Telegram user IDs. The Integration endpoint never sends a Telegram message or changes your bot response.",
    ],
    bullets: [
      "Your bot receives and answers /start.",
      "Your code sends one JSON POST to the bot's unique Integration URL.",
      "AdsGalaxy validates the per-bot secret and records or reactivates the user.",
      "Your bot continues its normal flow independently of the Integration response.",
    ],
  },
  {
    id: "architecture",
    title: "Architecture Overview",
    body: [
      "Telegram sends updates to the publisher's existing webhook. The publisher's application processes /start and continues its normal response. From inside that handler, the publisher sends a separate registration request to the bot-specific AdsGalaxy Integration URL.",
      "The Integration service validates the secret, updates the user idempotently, writes a diagnostic event, and returns JSON. It does not become part of Telegram update delivery and cannot alter the publisher's bot response.",
    ],
  },
  {
    id: "webhook-ownership",
    title: "Why AdsGalaxy does not replace your webhook",
    body: [
      "A Telegram bot can have one primary webhook. Replacing it would redirect Telegram updates away from your application and could disable commands, automation, payments, support flows, and every other feature your bot already provides.",
      "AdsGalaxy therefore never asks for your webhook URL and never asks you to call Telegram setWebhook. You retain complete ownership of update delivery and bot behavior.",
    ],
  },
  {
    id: "integration-url",
    title: "Integration URL",
    body: [
      `Each bot receives a unique URL in this format: ${integrationUrl}.`,
      "The final path value is a private credential. Store the full URL as a server-side secret, do not expose it in browser code or public repositories, and use only the URL shown in Bot Details.",
      "Installed means a test ping has succeeded. Active means at least one forwarded /start registration has been accepted.",
      "The status model is Not Installed, Installed, Active, Error, or Disabled. Existing successful registrations always prevent a Not Installed state.",
    ],
  },
  {
    id: "integration-flow",
    title: "Integration Flow",
    body: ["The Integration is intentionally one-way and safe to call asynchronously."],
    bullets: [
      "1. A Telegram user sends /start to your bot.",
      "2. Telegram delivers the update to your existing webhook or bot framework.",
      "3. Your existing /start handler performs its normal work.",
      "4. The same handler forwards the user fields to AdsGalaxy.",
      "5. AdsGalaxy records or refreshes the user and returns a JSON result.",
    ],
  },
  {
    id: "installation",
    title: "Installation steps",
    body: ["Installation does not require any Telegram or BotFather configuration."],
    bullets: [
      "Open Publisher > Monetize > Bots and select View Details.",
      "Copy the Integration URL and store it in your bot's server environment.",
      "Locate the existing /start command handler in your bot code or bot builder.",
      "Keep the existing handler logic and add a JSON POST using one of the examples below.",
      "Deploy your bot, then start it with a test Telegram account.",
      "Return to Bot Details and confirm Integration Status changes to Active.",
    ],
  },
  { id: "php", title: "PHP example", body: ["This cURL call can be added to a plain PHP handler. A short timeout prevents the Integration from delaying your bot."], code: { language: "php", value: phpExample } },
  { id: "php-stream", title: "PHP file_get_contents example", body: ["Paste this inside your /start command handler when cURL is unavailable. allow_url_fopen must be enabled."], code: { language: "php", value: phpStreamExample } },
  { id: "node", title: "Node.js example", body: ["This example uses the built-in fetch API with Telegraf-style context values."], code: { language: "javascript", value: nodeExample } },
  { id: "express", title: "Express example", body: ["Paste the Integration call inside the /start branch of your existing Express Telegram webhook route."], code: { language: "javascript", value: expressExample } },
  { id: "python", title: "Python example", body: ["This example uses requests with python-telegram-bot-style update objects."], code: { language: "python", value: pythonExample } },
  { id: "go", title: "Go example", body: ["Use an HTTP client with a short timeout and preserve your existing handler response."], code: { language: "go", value: goExample } },
  { id: "laravel", title: "Laravel example", body: ["Keep the Integration URL in server-side configuration and call it from the existing command handler."], code: { language: "php", value: laravelExample } },
  {
    id: "botmother",
    title: "BotMother",
    body: [
      "BotMother can be used when your plan and bot flow support an external HTTP request action. In the existing /start flow, add an API Request/HTTP Request step without removing the current response blocks.",
      "Choose POST, paste the Integration URL, set Content-Type to application/json, and map the Telegram user ID, chat ID, username, first name, language code, bot ID, current Unix timestamp, and a unique request ID to the documented JSON fields. Configure the flow to continue even if the request fails.",
      "BotMother labels and available variables can vary by product version. If your workspace cannot send a dynamic timestamp, unique request ID, or JSON POST, use a small server-side relay; never place your bot token in the request body.",
    ],
  },
  {
    id: "botbusiness",
    title: "BotBusiness / BJS example",
    body: ["Paste this inside your /start command handler. Bot builder APIs can vary by version; map the equivalent current-user variables and keep your existing response actions."],
    code: { language: "javascript", value: bjsExample },
  },
  {
    id: "security",
    title: "Security",
    body: [
      "Treat the complete Integration URL like an API credential. AdsGalaxy stores its secret encrypted and verifies a one-way hash for every request.",
      "The bot token is never returned to the browser or included in integration logs. Regenerating the Integration Secret immediately invalidates the prior URL and does not delete stored users.",
    ],
    bullets: [
      "Keep the Integration URL in server-side environment variables.",
      "Never paste the URL into public client-side code, screenshots, or repositories.",
      "Use HTTPS and a short request timeout.",
      "Use Regenerate Secret in Bot Details if the URL may be exposed.",
      "Requests with invalid bot IDs or secrets are rejected; valid endpoints are rate-limited against abuse.",
      "Every request needs a fresh Unix timestamp and a unique request_id. Request IDs cannot be replayed.",
    ],
  },
  {
    id: "common-errors",
    title: "Common errors",
    body: ["The endpoint returns JSON and standard HTTP status codes."],
    bullets: [
      "400 Invalid request: include telegram_user_id or chat_id, bot_id, a current Unix timestamp, and a unique request_id.",
      "403 Bot mismatch: bot_id does not belong to the Integration URL, or the integration is disabled.",
      "409 Replay rejected: request_id was already processed. Expired timestamps return 400.",
      "404 Integration not found: the bot ID or secret in the URL is incorrect, expired, or belongs to a deleted bot.",
      "500 Server error: keep your bot running, log the failure, and retry later rather than blocking /start.",
      "Status remains Installed: confirm the request is sent as JSON to the exact URL copied from Bot Details.",
    ],
  },
  {
    id: "testing",
    title: "Testing",
    body: [
      "The best end-to-end test is to deploy the integration and send /start to your bot from a real test account. Confirm your normal welcome flow still works, then refresh Bot Details and look for Active and Last user received.",
      "For a server-only connectivity test, replace the placeholders below. The Test Integration control records a diagnostic event without creating a bot user.",
    ],
    code: { language: "bash", value: testExample },
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    body: ["Log the HTTP status and response body on your server, but never log the full Integration URL or bot token."],
    bullets: [
      "Verify the request runs only from the /start path and uses POST with Content-Type: application/json.",
      "Check that IDs are numeric strings or numbers. timestamp is required in Unix seconds and request_id must be unique for every call.",
      "Confirm bot_id exactly matches the bot shown in AdsGalaxy.",
      "Use a three-second timeout and catch network errors so your welcome message is never interrupted.",
      "If the URL may have leaked, contact AdsGalaxy support to rotate the Integration secret.",
      "Do not troubleshoot by changing your Telegram webhook; it is unrelated to this Integration.",
    ],
  },
  {
    id: "faq",
    title: "FAQ",
    body: ["Answers to the most common integration questions."],
    bullets: [
      "Do I replace my Telegram webhook? No. Keep your webhook and all existing bot logic unchanged.",
      "Does AdsGalaxy need my webhook URL? No. Publishers never provide their webhook URL.",
      "Does the Integration answer users? No. It records registration data only.",
      "Should I send my bot token? No. Send only bot_id; AdsGalaxy never needs the token in registration payloads.",
      "Can I call the Integration asynchronously? Yes. This is recommended as long as your runtime completes the request reliably.",
      "What happens when a user sends /start again? Their existing record is refreshed and marked active.",
      "Does broadcasting change? No. AdsGalaxy continues using the stored bot token and registered Telegram user IDs.",
      "Can I import historical users? Existing user management remains available, but only import legitimate users who interacted with your bot.",
    ],
  },
];

export default function PublisherBotsDocsPage() {
  return (
    <DocsArticle
      eyebrow="Publisher Developer Documentation"
      title="Telegram Bot Monetization Integration"
      intro="Register /start users with AdsGalaxy while keeping complete ownership of your Telegram webhook, commands, and bot experience."
      sections={sections}
    />
  );
}
