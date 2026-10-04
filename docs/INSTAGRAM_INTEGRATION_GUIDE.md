# Naro Fashion - Instagram Integration & Newsletter System Guide

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Instagram Graph API Integration](#3-instagram-graph-api-integration)
   - 3.1 [How It Works](#31-how-it-works)
   - 3.2 [Data Flow](#32-data-flow)
   - 3.3 [Post Ordering Logic](#33-post-ordering-logic)
   - 3.4 [Cron Jobs (Auto Sync & Token Refresh)](#34-cron-jobs)
   - 3.5 [Code Structure](#35-code-structure)
4. [Facebook Developer Account Setup](#4-facebook-developer-account-setup)
   - 4.1 [Prerequisites](#41-prerequisites)
   - 4.2 [Step-by-Step App Creation](#42-step-by-step-app-creation)
   - 4.3 [Connecting Instagram (non-expiring Page token)](#43-connecting-instagram-non-expiring-page-token)
   - 4.4 [Finding Instagram Business Account ID](#44-finding-instagram-business-account-id)
   - 4.5 [Verifying the connection & what breaks a Page token](#45-verifying-the-connection--what-breaks-a-page-token)
5. [Environment Configuration](#5-environment-configuration)
6. [Admin Dashboard - Instagram Management](#6-admin-dashboard---instagram-management)
   - 6.1 [Sync from Instagram](#61-sync-from-instagram)
   - 6.2 [Pin/Unpin Posts](#62-pinunpin-posts)
   - 6.3 [Manual Post Creation](#63-manual-post-creation)
   - 6.4 [Visibility Toggle](#64-visibility-toggle)
7. [Storefront Display](#7-storefront-display)
8. [Newsletter System](#8-newsletter-system)
   - 8.1 [Subscriber Management](#81-subscriber-management)
   - 8.2 [Email Campaign Compose](#82-email-campaign-compose)
   - 8.3 [Template Types](#83-template-types)
   - 8.4 [Delivery Tracking](#84-delivery-tracking)
   - 8.5 [Resending Failed Emails](#85-resending-failed-emails)
9. [Database Models](#9-database-models)
10. [API Endpoints Reference](#10-api-endpoints-reference)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Overview

The Naro Fashion platform integrates with Instagram to automatically display the latest posts from the official @narofashion2019 account on the storefront. Additionally, a full newsletter/email campaign system allows admin to compose and send marketing emails to subscribers with delivery tracking.

### Key Features:
- **Auto-sync** Instagram posts every 6 hours via Facebook Graph API
- **Manual control**: Admin can add manual posts, pin/unpin, toggle visibility
- **Smart ordering**: API posts (newest first) → Pinned posts → Manual posts
- **Newsletter campaigns**: 4 template types with per-recipient delivery tracking
- **New Arrivals auto-population**: Automatically includes products not yet sent in previous newsletters
- **Failed email resend**: Track failures with reasons and retry

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    NARO FASHION PLATFORM                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │  Storefront   │    │  Admin Panel  │    │  NestJS API   │  │
│  │  (Port 3000)  │    │  (Port 3001)  │    │  (Port 4000)  │  │
│  │               │    │               │    │               │  │
│  │ InstagramFeed │    │ IG Posts Page │    │ CMS Module    │  │
│  │ component     │◄──►│ Sync/Pin/CRUD │◄──►│ IG Service    │  │
│  │               │    │               │    │               │  │
│  │ Newsletter    │    │ Newsletter    │    │ Newsletter    │  │
│  │ Subscribe     │◄──►│ Dashboard     │◄──►│ Module        │  │
│  │ Forms         │    │ Compose/Send  │    │               │  │
│  └──────────────┘    └──────────────┘    └───────┬───────┘  │
│                                                    │          │
├────────────────────────────────────────────────────┼──────────┤
│                                                    │          │
│  ┌──────────────┐    ┌──────────────┐    ┌───────▼───────┐  │
│  │  PostgreSQL   │    │  Scheduler   │    │ Facebook      │  │
│  │  Database     │◄──►│  (Cron Jobs) │───►│ Graph API     │  │
│  │               │    │              │    │ v25.0         │  │
│  │ InstagramPost │    │ Sync: */6hrs │    │               │  │
│  │ Newsletter*   │    │ Token: daily │    │ @narofashion  │  │
│  │ Subscriber    │    │   check 3am  │    │ 2019          │  │
│  └──────────────┘    └──────────────┘    └───────────────┘  │
│                                                               │
│  ┌──────────────┐                                            │
│  │  SMTP Server  │◄── EmailService (Nodemailer + Handlebars)  │
│  │  (Brevo)      │    Newsletter templates                    │
│  └──────────────┘                                            │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Instagram Graph API Integration

### 3.1 How It Works

The integration uses the **Facebook Graph API v25.0** (not the deprecated Instagram Basic Display API) to fetch posts from the Instagram Business Account linked to the Facebook Page "nancyfashion2019".

**Flow:**
1. The `InstagramService` reads the tenant's access token (a non-expiring **Page** token) and IG account ID from its SiteSettings (`instagram_access_token`, `instagram_business_account_id`; env vars are a first-boot fallback for the default tenant only)
2. Makes a GET request to `https://graph.facebook.com/v25.0/{ACCOUNT_ID}/media`
3. Fetches up to 12 most recent posts with fields: id, caption, media_type, media_url, permalink, thumbnail_url, timestamp
4. For each post, upserts into the `InstagramPost` database table using `instagramMediaId` as the unique key
5. Videos use `thumbnail_url` as the display image; images use `media_url`

### 3.2 Data Flow

```
Facebook Graph API
       │
       ▼
GET /v25.0/{account_id}/media
  ?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp
  &access_token={token}
  &limit=12
       │
       ▼
┌─────────────────────────┐
│   InstagramService      │
│   syncFromInstagram()   │
│                         │
│   For each post:        │
│   - Upsert by mediaId   │
│   - source='INSTAGRAM_API'│
│   - Map video→thumbnail │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   InstagramPost Table   │
│                         │
│   id, caption, imageUrl │
│   postUrl, source,      │
│   isPinned, postedAt    │
│   instagramMediaId      │
└─────────────────────────┘
             │
             ▼
┌─────────────────────────┐     ┌──────────────────────┐
│   GET /cms/instagram-   │     │  Storefront          │
│   posts (public)        │────►│  InstagramFeed.tsx    │
│                         │     │  Shows ordered posts  │
│   Ordering:             │     └──────────────────────┘
│   1. API (newest first) │
│   2. Pinned (sortOrder) │
│   3. Manual (sortOrder) │
└─────────────────────────┘
```

### 3.3 Post Ordering Logic

When the storefront requests Instagram posts, the API returns them in this specific order:

| Priority | Source | Sort By | Description |
|----------|--------|---------|-------------|
| 1st | `INSTAGRAM_API` | `postedAt DESC` | Latest posts from the real IG account appear first |
| 2nd | Any with `isPinned=true` | `sortOrder ASC` | Admin-pinned posts appear next |
| 3rd | `MANUAL` (not pinned) | `sortOrder ASC` | Admin-created manual posts appear last |

**Code location:** `apps/api/src/cms/cms.service.ts` → `findActiveInstagramPosts()`

### 3.4 Cron Jobs

| Cron | Schedule | Job | Description |
|------|----------|-----|-------------|
| `15 * * * *` | Hourly sweep | `instagram-sync-per-tenant` | Syncs each tenant whose own `instagram_sync_interval` (default 6h) has elapsed since `instagram_last_sync_at` |
| `0 3 * * *` | Daily 03:00 | `instagram-token-refresh` | **Token health check** (see below) |

**Code location:** `apps/api/src/cms/instagram.service.ts` (sweep, `checkAllTenantTokens`) + `apps/api/src/scheduler/scheduler.service.ts` (`handleInstagramTokenRefresh`).

**Token health check (daily):** for every non-suspended tenant holding a token the API calls `GET /debug_token` (app token, server-side):
- **PAGE token / `expires_at = 0`** (the normal case): no exchange — just records `instagram_token_checked_at` + validity. If Facebook reports it invalid, the log shows `INSTAGRAM_TOKEN_INVALID … re-connect Instagram in Admin → CMS → Instagram`.
- **USER token** (legacy / env fallback): still re-exchanged (harmless), but when it is invalid or expires within **14 days** the log shows `ERROR INSTAGRAM_TOKEN_EXPIRING` (once a day, the job's cadence) with the tenant admin's email. No email is sent yet — there is no generic admin-alert email template.

> **Why the old "refresh" didn't work.** Until October 2026 the cron re-exchanged a long-lived **user** token with `grant_type=fb_exchange_token` on the 1st/15th. Facebook does *not* extend a long-lived user token that way — the expiry stays 60 days from the original login. The feed therefore died on 2026-09-26, ~60 days after the July bootstrap (OAuthException 190). Page tokens derived from a long-lived user token have no expiry, so there is nothing to refresh.

### 3.5 Code Structure

```
apps/api/src/
├── cms/
│   ├── cms.module.ts          # Registers InstagramService
│   ├── cms.service.ts         # Instagram CRUD + ordering logic
│   ├── cms.controller.ts      # Endpoints: sync, pin, CRUD
│   └── instagram.service.ts   # Facebook Graph API integration
├── scheduler/
│   └── scheduler.service.ts   # Cron jobs for sync + token refresh
└── notifications/
    └── templates/
        ├── newsletter.hbs              # Generic newsletter template
        └── newsletter-new-arrivals.hbs # Product grid template
```

---

## 4. Facebook Developer Account Setup

### 4.1 Prerequisites

- A Facebook account that manages the Naro Fashion Facebook Page
- An Instagram Professional/Business account (@narofashion2019) linked to that Facebook Page
- The Instagram account must be connected to the Facebook Page in Facebook Page Settings

### 4.2 Step-by-Step App Creation

1. **Go to** https://developers.facebook.com/
2. **Click** "Get Started" → complete developer registration if needed
3. **Navigate to** https://developers.facebook.com/apps/ → "Create App"
4. **App details**: Enter app name (e.g., "Narofashion"), contact email
5. **Use cases**: Select **"Business messaging"** → check **"Manage messaging & content on Instagram"**
6. **Business**: Select your business portfolio (e.g., "Nancy Fashion")
7. **Review & Create**: Click "Create app"

### 4.3 Connecting Instagram (non-expiring Page token)

**Why a Page token?** A Facebook *user* token lives at most 60 days and cannot be renewed server-side — only a fresh login by the account owner produces a new one. A **Page access token** obtained from a long-lived user token never expires (`debug_token` shows `expires_at: 0`) and can read the Instagram media edge (`/{ig-business-account-id}/media`) of the Instagram account linked to that Page. The API does the whole exchange for you; the app secret never leaves the server and the pasted token is not stored.

**Owner steps (5 minutes, no technical knowledge needed):**

1. Open **Graph API Explorer**: https://developers.facebook.com/tools/explorer/ and log in with the Facebook account that is an **admin of the Facebook Page linked to the shop's Instagram** (the "Nancy Fashion" business Page).
2. Top right, **Meta App** → choose **Narofashion**.
3. **User or Page** → choose **User Token**.
4. **Permissions** → add these four (type each name and click it):
   - `instagram_basic`
   - `pages_show_list`
   - `pages_read_engagement`
   - `business_management`
5. Click **Generate Access Token**. In the Facebook pop-up click *Continue*, make sure the shop's **Page** and **Instagram account** are ticked, and finish.
6. Click the **copy** icon next to the long token (starts with `EAA…`).
7. In the admin dashboard go to **CMS → Instagram Posts → Instagram Connection → Connect Instagram** (or *Re-connect*), paste the token in the box and click **Connect**.
8. You should see a green **Connected** badge, *Token type: Page (permanent)*, *Expires: Never*, and the posts sync immediately.

What the server does (`POST /cms/instagram/connect`, permission `settings:manage`):
1. Exchanges the pasted token for a long-lived user token (`fb_exchange_token`, with `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET`).
2. `GET /me/accounts?fields=id,name,access_token,instagram_business_account{id,username}` (follows paging).
3. Picks the Page whose `instagram_business_account.id` equals the tenant's `instagram_business_account_id` (or env fallback for the default tenant). If none is configured and exactly one Page has an IG business account, that one is used and its id saved. Otherwise it returns an error listing the Page names found.
4. `GET /debug_token` on the Page token (must be `is_valid` and from the Narofashion app) and test-reads `/{ig-id}/media?limit=1`.
5. Stores, for that tenant only: `instagram_access_token` (the Page token — secret, hidden from `GET /cms/settings`), `instagram_token_type=PAGE`, `instagram_page_id`, `instagram_page_name`, `instagram_username`, `instagram_token_expires_at` (`never` or ISO), `instagram_token_checked_at`.
6. Runs a sync and returns `{ pageName, igUsername, tokenType, expiresAt, synced }` (never the token).

**Alternative — on the VPS (if the admin UI is unavailable):**

```bash
cd /var/www/naro-fashion
node scripts/instagram-connect.js <tenantSlug>
# paste the token when prompted (keeps it out of shell history), press Enter
```

It runs the same flow (app id/secret from `apps/api/.env`), prints Page name, IG username, expiry and `SUCCESS`/`FAILED`, never prints a token, and clears `instagram_last_sync_at` so the next hourly sweep (HH:15) syncs — or click **Sync from Instagram** in the admin.

### 4.4 Finding Instagram Business Account ID

Normally you don't need to: the connect flow discovers and saves it. To look it up manually in Graph API Explorer with a user token:

1. Set the URL to: `me/accounts?fields=id,name,instagram_business_account`
2. Click **Submit**
3. The response contains your page with:
```json
{
  "data": [{
    "id": "103693824395641",
    "name": "nancyfashion2019",
    "instagram_business_account": {
      "id": "17841418108905851"   ← THIS IS YOUR ACCOUNT ID
    }
  }]
}
```

### 4.5 Verifying the connection & what breaks a Page token

**Verify:** Admin → CMS → Instagram Posts → *Instagram Connection* card shows type, Page, @username, *Expires: Never*, last checked, last sync and the last error (green/amber/red). Click **Check** to force a live `debug_token` (otherwise cached 10 minutes). API: `GET /cms/instagram/token-status` (`cms:manage`) → `{ tokenType, pageName, igUsername, expiresAt, checkedAt, lastSyncAt, lastError, valid, … }` — never the token.

Manual check on the VPS (token never echoed):
```bash
TOKEN=$(sudo -u postgres psql -d naro_fashion -tAc "SELECT value FROM \"SiteSetting\" WHERE key='instagram_access_token' AND \"tenantId\" IS NOT NULL LIMIT 1")
curl -s "https://graph.facebook.com/v25.0/debug_token?input_token=$TOKEN&access_token=$FACEBOOK_APP_ID|$FACEBOOK_APP_SECRET" | jq '.data | {type,is_valid,expires_at,scopes}'
```
Expect `"type": "PAGE"`, `"is_valid": true`, `"expires_at": 0`.

**A Page token stops working (and you must re-connect) when:**
- the Facebook account that generated it **changes its password** or logs out of all sessions for security reasons;
- that person **loses admin (full control) rights** on the Page, or the Page/Instagram link is removed;
- the **Narofashion app is removed** from that person's *Settings → Business Integrations* (de-authorised), or the app secret is reset;
- Facebook invalidates it for a security checkpoint.

The daily check logs `INSTAGRAM_TOKEN_INVALID` and the admin card turns red; just repeat §4.3.

## 5. Environment Configuration

Add these variables to `apps/api/.env`:

```env
# Facebook Developer App
FACEBOOK_APP_ID="4338851449722487"
FACEBOOK_APP_SECRET="your_app_secret_here"

# Instagram Graph API
# Optional legacy seed — use Admin → CMS → Instagram → Connect instead
INSTAGRAM_ACCESS_TOKEN=""
INSTAGRAM_BUSINESS_ACCOUNT_ID="17841418108905851"
```

| Variable | Source | Expiry |
|----------|--------|--------|
| `FACEBOOK_APP_ID` | App Settings → Basic | Permanent |
| `FACEBOOK_APP_SECRET` | App Settings → Basic | Permanent (can be reset) |
| `INSTAGRAM_ACCESS_TOKEN` | Legacy first-boot seed (default tenant only) — superseded by the Connect flow, which stores a Page token in SiteSetting | n/a |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Graph API: `me/accounts` query | Permanent |

---

## 6. Admin Dashboard - Instagram Management

### 6.1 Sync from Instagram

**Location:** Admin → CMS → Instagram Posts

The "Sync from Instagram" button triggers a manual sync. It calls `POST /api/v1/cms/instagram-posts/sync` which:
- Fetches latest 12 posts from the Graph API
- Upserts into database (new posts added, existing updated)
- Returns `{ synced: 12, errors: 0 }`

Posts from Instagram appear with a blue **"IG"** badge.

### 6.2 Pin/Unpin Posts

Any post (API or manual) can be pinned by clicking the **Pin** icon on hover. Pinned posts:
- Show a gold **"Pinned"** badge
- Appear after API posts but before manual posts on the storefront
- Are sorted by `sortOrder` among themselves

### 6.3 Manual Post Creation

Click "Add Post" to create a manual post with:
- Image URL (required)
- Caption
- Instagram post URL (optional)
- Likes count
- Sort order

Manual posts show a gray **"Manual"** badge.

### 6.4 Visibility Toggle

**Location:** Admin → CMS → Settings → Features

The **"Show Instagram Feed on Storefront"** setting (`instagram_feed_visible`) controls whether the entire Instagram section appears on the storefront homepage. When set to `false`, the `<InstagramFeed />` component is not rendered.

---

## 7. Storefront Display

The `InstagramFeed` component (`apps/storefront/components/social/InstagramFeed.tsx`):

1. Fetches active posts from `GET /api/v1/cms/instagram-posts`
2. Displays them in a 6-column responsive grid
3. On hover, shows likes count and caption
4. Each post links to the actual Instagram post URL (or the main IG profile)
5. Includes a "Follow on Instagram" button linking to @narofashion2019

The homepage (`apps/storefront/app/page.tsx`) checks the `instagram_feed_visible` site setting before rendering the component.

---

## 8. Newsletter System

### 8.1 Subscriber Management

**Subscription flow:**
```
Storefront Homepage/Footer Form
         │
         ▼
POST /api/v1/newsletter/subscribe
  { email: "user@example.com" }
         │
         ▼
NewsletterSubscriber table
  - Auto-generates unsubscribeToken
  - If already exists & inactive: reactivates
  - If already exists & active: returns "Already subscribed"
```

**Unsubscribe flow:**
```
Email Footer → "Unsubscribe" link
         │
         ▼
GET /api/v1/newsletter/unsubscribe/{token}
         │
         ▼
Sets isActive=false, unsubscribedAt=now()
         │
         ▼
Storefront /unsubscribe page shows confirmation
```

### 8.2 Email Campaign Compose

**Location:** Admin → Newsletter → Compose

The compose page allows:
1. Selecting a template type (radio buttons)
2. Entering a subject line
3. Writing HTML body content with live preview
4. For NEW_ARRIVALS: auto-fetching products not yet sent
5. Saving as draft or sending immediately

### 8.3 Template Types

| Type | Description | Auto-Population |
|------|-------------|-----------------|
| NEW_ARRIVALS | Showcases new products | Yes — fetches products created since last NEW_ARRIVALS newsletter, excludes already-included products via NewsletterProduct join table |
| NEW_DEALS | Flash sales, promotions | No — admin writes content |
| TIPS | Fashion tips, style advice | No — admin writes content |
| CUSTOM | Free-form newsletter | No — admin writes content |

**Email templates** (Handlebars):
- `newsletter.hbs` — Generic: renders `{{{bodyHtml}}}` + unsubscribe link
- `newsletter-new-arrivals.hbs` — Product grid with images, prices, "Shop Now" buttons

All templates are wrapped in the master `layout.hbs` with Naro Fashion branding (black #1A1A1A + gold #D4AF37).

### 8.4 Delivery Tracking

When admin clicks "Send":

```
Newsletter status → SENDING
         │
         ▼
Create NewsletterDelivery for each active subscriber
  (status: PENDING)
         │
         ▼
Async processDeliveries():
  For each delivery:
    1. Call EmailService.send()
    2. Update status → SENT or FAILED
    3. Store failureReason if failed
    4. Wait 200ms (rate limiting)
         │
         ▼
Newsletter status → SENT (or FAILED if all failed)
```

**Admin can see:**
- Total emails sent / failed / pending
- Delivery rate percentage
- Per-recipient failure reasons

### 8.5 Resending Failed Emails

**Location:** Admin → Newsletter → [newsletter detail] → "Resend Failed"

1. Resets all FAILED deliveries to PENDING
2. Sets newsletter status back to SENDING
3. Re-runs the async delivery process
4. Only retries previously failed recipients

---

## 9. Database Models

### InstagramPost
```
id               String    @id @default(cuid())
caption          String?
imageUrl         String
postUrl          String?
likes            Int       @default(0)
sortOrder        Int       @default(0)
isActive         Boolean   @default(true)
deletedAt        DateTime?
source           String    @default("MANUAL")   // INSTAGRAM_API or MANUAL
isPinned         Boolean   @default(false)
instagramMediaId String?   @unique              // Prevents duplicates
mediaType        String?                        // IMAGE, VIDEO, CAROUSEL_ALBUM
postedAt         DateTime?                      // Original IG post date
```

### NewsletterSubscriber
```
id               String    @id @default(cuid())
email            String    @unique
name             String?
isActive         Boolean   @default(true)
source           String    @default("STOREFRONT")
unsubscribeToken String    @unique @default(cuid())
subscribedAt     DateTime  @default(now())
unsubscribedAt   DateTime?
```

### Newsletter
```
id           String    @id @default(cuid())
subject      String
bodyHtml     String
templateType String    @default("CUSTOM")  // NEW_ARRIVALS, NEW_DEALS, TIPS, CUSTOM
status       String    @default("DRAFT")   // DRAFT, SENDING, SENT, FAILED
sentAt       DateTime?
createdById  String?
```

### NewsletterDelivery
```
id            String    @id @default(cuid())
newsletterId  String
subscriberId  String
status        String    @default("PENDING") // PENDING, SENT, FAILED
sentAt        DateTime?
failureReason String?
```

### NewsletterProduct
```
id           String   @id @default(cuid())
newsletterId String
productId    String
// Tracks which products were included to prevent duplicates
```

---

## 10. API Endpoints Reference

### Instagram Posts (CMS)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/cms/instagram-posts` | Public | Active posts (ordered: API→Pinned→Manual) |
| GET | `/cms/instagram-posts/admin` | JWT | All posts for admin |
| POST | `/cms/instagram-posts` | JWT | Create manual post |
| PATCH | `/cms/instagram-posts/:id` | JWT | Update post |
| DELETE | `/cms/instagram-posts/:id` | JWT | Soft delete |
| PATCH | `/cms/instagram-posts/:id/restore` | JWT | Restore deleted |
| PATCH | `/cms/instagram-posts/:id/pin` | JWT | Toggle pin |
| POST | `/cms/instagram-posts/sync` | JWT | Trigger Instagram sync |
| GET | `/cms/instagram-posts/deleted` | JWT | Deleted posts |
| POST | `/cms/instagram/connect` | Admin + `settings:manage`, 5/min | Body `{ userAccessToken }` — exchange a Graph API Explorer user token for a non-expiring Page token, store it, sync. Returns `{ pageName, igUsername, tokenType, expiresAt, scopes, synced, syncErrors }` |
| GET | `/cms/instagram/token-status` | Admin + `cms:manage` | Connection status (debug_token cached 10 min; `?refresh=true` forces). Never returns the token |

### Newsletter

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/newsletter/subscribe` | Public | Subscribe email |
| GET | `/newsletter/unsubscribe/:token` | Public | Unsubscribe by token |
| GET | `/newsletter/subscribers` | JWT | Paginated subscriber list |
| GET | `/newsletter/subscribers/stats` | JWT | Subscriber counts |
| GET | `/newsletter/dashboard` | JWT | Overall stats |
| POST | `/newsletter` | JWT | Create newsletter |
| GET | `/newsletter` | JWT | List newsletters |
| GET | `/newsletter/:id` | JWT | Newsletter detail |
| PATCH | `/newsletter/:id` | JWT | Update draft |
| DELETE | `/newsletter/:id` | JWT | Delete draft |
| POST | `/newsletter/:id/send` | JWT | Send newsletter |
| GET | `/newsletter/:id/deliveries` | JWT | Delivery stats |
| GET | `/newsletter/:id/failed` | JWT | Failed deliveries |
| POST | `/newsletter/:id/resend-failed` | JWT | Resend failed |
| GET | `/newsletter/new-arrivals-preview` | JWT | Products for NEW_ARRIVALS |

---

## 11. Troubleshooting

### Instagram Sync Fails
- **Look at the Instagram Connection card** (Admin → CMS → Instagram Posts) — it shows the last Graph error.
- **API logs**: `pm2 logs naro-api --lines 2000 | grep -i instagram` (the Graph error body is logged, e.g. `OAuthException code 190: …`).
- **Wrong API URL?** Must use `graph.facebook.com` not `graph.instagram.com`.

### Code 190 — "Session has expired" / "Error validating access token"
The stored token is dead. If the card says *Token type: USER* you are still on an old 60-day user token — re-connect (§4.3) to switch to a permanent Page token. If it says *PAGE*, something in §4.5's list happened (password change, admin rights lost, app removed) — re-connect.

### Code 10 / 200–299 — permission errors ("(#10) Application does not have permission", "(#200) …")
The token was generated without one of the four permissions, or the Facebook pop-up was finished without ticking the Page/Instagram account. Generate a new token in Graph API Explorer with `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `business_management` and tick the shop's Page + Instagram account, then Connect again.

### "No Facebook Page with a linked Instagram business account was found" / "None of your Facebook Pages is linked to Instagram account …"
- You logged in to Graph API Explorer with an account that is not an admin of the shop's Page — log in as the Page admin.
- The Instagram account must be a Professional/Business account **linked to the Page** (Page settings → Linked accounts → Instagram).
- If the error lists the right Page but a different Instagram id, the tenant's `instagram_business_account_id` setting is wrong — fix it (§4.4) and connect again.

### "The pasted token was generated for a different Facebook app"
In Graph API Explorer pick **Narofashion** under *Meta App* before generating the token.

### "Instagram connect is not configured on the server"
`FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` are missing from the API env (check all three `.env` files — see CLAUDE.md "Env File Sprawl").

### Newsletter Emails Not Sending
- Check SMTP configuration in `.env` (SMTP_HOST, SMTP_USER, SMTP_PASS)
- If SMTP not configured, emails are logged only (check API console output)
- Check `NewsletterDelivery` records for `failureReason`

### "Insufficient Developer Role" Error
- Ensure your Facebook account is an admin of the Meta Developer App
- The Instagram account must be a Professional/Business account
- The Facebook Page must be linked to the Instagram account

---

## Appendix: Key File Locations

| Purpose | File Path |
|---------|-----------|
| Instagram sync service | `apps/api/src/cms/instagram.service.ts` |
| CMS service (ordering) | `apps/api/src/cms/cms.service.ts` |
| CMS controller (endpoints) | `apps/api/src/cms/cms.controller.ts` |
| Newsletter service | `apps/api/src/newsletter/newsletter.service.ts` |
| Newsletter controller | `apps/api/src/newsletter/newsletter.controller.ts` |
| Scheduler (cron jobs) | `apps/api/src/scheduler/scheduler.service.ts` |
| Email templates | `apps/api/src/notifications/templates/` |
| Admin IG posts page | `apps/admin/app/dashboard/cms/instagram-posts/page.tsx` |
| Admin IG connection card | `apps/admin/app/dashboard/cms/instagram-posts/InstagramConnectionCard.tsx` |
| VPS connect script | `scripts/instagram-connect.js` |
| Admin newsletter pages | `apps/admin/app/dashboard/newsletter/` |
| Storefront IG feed | `apps/storefront/components/social/InstagramFeed.tsx` |
| Storefront subscribe forms | `apps/storefront/app/page.tsx` + `components/layout/Footer.tsx` |
| Unsubscribe page | `apps/storefront/app/unsubscribe/page.tsx` |
| Prisma schema | `packages/database/prisma/schema.prisma` |
| Environment config | `apps/api/.env` |

---

*Document generated for Naro Fashion — March 2026; token section rewritten October 2026 (Page-token method)*
*Instagram: @narofashion2019 | Dar es Salaam, Tanzania*
