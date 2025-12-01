# Resend Production Domain Setup (qbutton.co.za)

This guide documents how to migrate Unity ERP email sending from the temporary `@apexza.net` addresses to the production `@qbutton.co.za` domain using [Resend](https://resend.com).

## Overview

Unity ERP sends transactional emails for two major flows:

| Flow | Purpose | Target Sender |
|------|---------|---------------|
| Purchasing | Supplier follow-up emails & purchase orders | `orders@qbutton.co.za`
| Sales | Quote PDFs & customer correspondence | `sales@qbutton.co.za`

To move these to the production domain we must:

1. Add and verify `qbutton.co.za` inside Resend
2. Configure required DNS records (DKIM/SPF/DMARC)
3. Create sender identities for `orders@…` and `sales@…`
4. Update Netlify environment variables
5. Amend the application code to pick the correct sender per workflow

Each step is detailed below.

---

## 1. Add Domain in Resend

1. Sign in to Resend → **Domains** → **Add Domain**
2. Enter `qbutton.co.za`
3. Copy the DNS records that Resend displays (store them in a password manager or secure document)
4. Leave this tab open – you will return after DNS propagation to click **Verify**

> Tip: Resend allows you to configure multiple sending regions. Keep the default (US) unless you need EU data residency.

---

## 2. Configure DNS Records

In the DNS provider for `qbutton.co.za` (registrar or hosting control panel) add the records provided by Resend. Typical records include:

| Type | Host / Name | Value / Target | Purpose |
|------|--------------|----------------|---------|
| `TXT` | `resend._domainkey` | Long DKIM string from Resend | Enables DKIM signing |
| `TXT` | `@` | `v=spf1 include:amazonses.com ~all` (Resend default) | SPF authentication |
| `CNAME` | `tracking` | `custom.resend.dev` | Enables click tracking (optional) |
| `TXT` | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@qbutton.co.za` | DMARC policy (recommended) |

> ⚠️ DNS changes can take 15 minutes to 48 hours to propagate. Verify using `dig` or an online DNS checker.

After records propagate, return to Resend and click **Verify**. The domain must show the "Verified" badge before production cut-over.

---

## 3. Create Sender Identities

1. In Resend, go to **Domains → qbutton.co.za → Add from address**
2. Add both senders:
   - `orders@qbutton.co.za`
   - `sales@qbutton.co.za`
3. Optionally add display names (e.g., `Unity Purchasing` / `Unity Sales`)
4. Send a test email from Resend to confirm deliverability

> Custom reply-to addresses can remain per-email (e.g., supplier's account rep). Only the `from` address must match the verified domain.

---

## 4. Update Netlify Environment Variables

Add the new sender addresses to Netlify so the Next.js APIs can select the correct identity.

| Variable | Example Value | Notes |
|----------|---------------|-------|
| `EMAIL_FROM_ORDERS` | `orders@qbutton.co.za` | Used by purchasing + supplier flows |
| `EMAIL_FROM_SALES` | `sales@qbutton.co.za` | Used by quote emails + sales flows |
| `EMAIL_FROM` | (optional fallback) | Can point to `orders@...` until code adopts multi-sender |

Steps:
1. Netlify Dashboard → **Site settings → Build & deploy → Environment → Environment variables**
2. Add/update the keys above (set scope to **All contexts**)
3. Click **Save** and trigger a new deploy so the values reach the runtime

> Keep `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `NEXT_PUBLIC_APP_URL` unchanged – they remain valid.

---

## 5. Application Code Changes (TODO)

To fully support multiple senders we need the application to read the new variables. Planned changes:

1. **`lib/email.tsx`** – add helpers `getOrdersSender()` and `getSalesSender()` that resolve the correct `from` address with fallbacks to `EMAIL_FROM`.
2. **Purchasing API routes** (`send-follow-up-email`, `send-po-follow-up`, `send-purchase-order-email`, etc.) – use `EMAIL_FROM_ORDERS` when invoking Resend.
3. **Quote / Sales API routes** (`app/api/quotes/[id]/send-email/route.ts`, `lib/email.tsx` quote helper) – use `EMAIL_FROM_SALES`.
4. Update unit tests or manual smoke tests to confirm the sender header in delivered emails.
5. Update documentation (`email-integration.md`) after code changes ship.

Until the code is updated, setting `EMAIL_FROM` to `orders@qbutton.co.za` keeps purchasing emails on-brand, but quotes will still use the fallback. Track this task in the TODO index.

---

## Verification Checklist

1. New DNS records verified in Resend (`qbutton.co.za` shows "Verified")
2. Test emails from both senders arrive successfully
3. Netlify env vars updated and deploy completed
4. Logs show Resend requests using the new addresses
5. Actual supplier/customer emails show `orders@qbutton.co.za` or `sales@qbutton.co.za` as intended

---

## Rollback Plan

If something goes wrong:
1. Switch the Netlify env vars back to `@apexza.net` values and redeploy
2. In Resend, deactivate the `qbutton.co.za` domain (optional) and re-enable the test domain
3. Notify operations that emails reverted to the test sender temporarily

---

## References

- [Resend Domain Verification Docs](https://resend.com/docs/email/domains)
- [Deployment Guide](./deployment-guide.md)
- [Email Integration Guide](./email-integration.md)
