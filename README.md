# AdsFusion

AdsFusion is a comprehensive Telegram-based advertising network connecting **Advertisers** (who want to promote their campaigns) with **Publishers** (Telegram channel owners looking to monetize their audience).

The platform handles automated placements, click/view auditing, financial settlements, and withdrawal processing, all managed through a robust admin dashboard.

---

## 🌟 Key Features

* **Dual-Role Platform**: Users can act as Publishers (monetizing channels) or Advertisers (creating ad campaigns).
* **Automated Telegram Integration**: Ads are posted to Telegram channels automatically based on budget and CPM rules.
* **Smart Placement Logic**: Dynamic rules limit ad frequency based on campaign budgets to ensure fair distribution.
* **Views & Click Auditing**: Built-in verification logic locks funds for a 30-day period. Admins can audit and invalidate suspected fake/bot views, automatically refunding the advertiser and penalizing the publisher.
* **Comprehensive Admin Panel**: A Cloudflare-style administrative interface for tracking user growth, managing withdrawals, invalidating views, setting up placement logic, and configuring system-wide variables.
* **Cron-based Automation**: Automated endpoints scan for active campaigns, settle locked views, and clean up expired posts continuously.

---

## 🛠 Tech Stack

* **Frontend**: Next.js (React), Tailwind CSS, Lucide Icons
* **Backend**: Next.js API Routes (Serverless)
* **Database**: MySQL / MariaDB (via `mysql2` driver)
* **Authentication**: Cookie-based JWT & Admin secure hashing
* **Integration**: Telegram Bot API

---

## 🚀 Setup & Installation

### 1. Prerequisites
* Node.js (v18+ recommended)
* MySQL Server (or MariaDB)
* A Telegram Bot Token (from [@BotFather](https://t.me/botfather))

### 2. Clone and Install
Clone the repository and install the Node modules:
```bash
git clone https://github.com/nasirul786/AdsFusion.git
cd AdsFusion
npm install
```

### 3. Environment Configuration
Copy the sample environment file and configure your credentials:
```bash
cp .env.example .env
```
Open `.env` and configure:
* Database credentials (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`)
* Your `BOT_TOKEN` for Telegram
* NextAuth secrets or other application-specific secrets

Production startup requires these security variables and fails fast if they are missing:
* `BOT_INTEGRATION_ENCRYPTION_KEY`
* `PRIVATE_INVITE_LINK_ENCRYPTION_KEY`
* `TELEGRAM_WEBHOOK_SECRET_TOKEN`

Use at least 32 random characters for the encryption keys, or exactly 64 hex characters. Development mode continues to run without this production-only startup gate.

### 4. Database Initialization
You do not need to manually import any `.sql` files. The project includes a dedicated database builder.
To create all tables and populate the default admin configurations (Settings, FAQs, Placement Logic), run:
```bash
node init-db.js
```
*(Note: This will safely drop existing tables if they exist and rebuild the architecture from scratch without mock data).*

### 5. Running the Development Server
Start the local Next.js development server:
```bash
npm run dev
```
Your application will be live at: [http://localhost:3000](http://localhost:3000)

---

## ⚙️ Administration

To access the admin panel, navigate to `/admin/login` and use the default credentials established by `init-db.js`.
* **Default Admin Username**: `admin`
* **Default Admin Password**: `admin123`

*(Important: Change your password immediately in a production environment!)*

### Admin Capabilities
* **Dashboard**: View real-time platform statistics (Users, Campaigns, Channels, Financials).
* **System Settings**: Dynamically update reward percentages, minimum withdrawal limits, and referral bonuses.
* **Placement Logic**: Set rules for how frequently campaigns are posted based on their budget.
* **Views Audit**: Review flagged posts, calculate time-velocity of views, and invalidate fraudulent bot activity.
* **Manage FAQs**: Update Publisher and Advertiser help content directly from the UI.

---

## 🖼️ Image Uploading Logic

When an advertiser creates a new campaign and uploads a banner image, AdsFusion offloads the image hosting to an external provider to save server bandwidth and storage. 

### How It Works
1. The user uploads an image (Max size: 1MB) on the frontend form.
2. The frontend sends the image file to the Next.js API (`/api/advertiser/campaigns`) as `multipart/form-data`.
3. The server takes this file and forwards it via a `POST` request to the endpoint defined in your `.env` file under `IMG_API_ENDPOINT`.

### Request Payload Sent to the Endpoint
The app sends a `multipart/form-data` request with the following fields:
* `action`: `"upload"`
* `image`: `[The binary image File]`

### Expected JSON Response
To successfully process the upload, your external image API must return a JSON response matching this exact structure:
```json
{
  "success": true,
  "data": {
    "url": "https://your-image-host.com/path/to/image.jpg"
  }
}
```
If successful, AdsFusion extracts the `url` from the response and saves it permanently to the `campaigns` table in the database so it can be used when posting to Telegram channels.
