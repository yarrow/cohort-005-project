# Notification vendors for Cadence

**Question:** Which third-party notification services fit Cadence? Cadence is a React Router app with a Node server and SQLite via Drizzle. It has no mobile app and already sends Email through Postmark with a raw `fetch` in `app/lib/mailer.server.ts`.

**Scope:** Knock, Novu, MagicBell, Courier and SuprSend. Each one is compared on the Feed, Push, Email, client authentication, Node triggering, Notification state, preferences, dev/test, pricing and data residency.

**Sources and date:** All sources are the vendors' own docs and pricing pages, checked on **2026-11-11**. Pricing changes often, so re-check it before deciding. "Not found" means the official pages we read don't state the fact. It does not mean the vendor lacks the feature.

**Glossary:** A *Notification* is a short notice telling one person that something concerns them. A *Channel* is Feed, Push or Email. The *Feed* is the in-app list of a person's Notifications. *Push* is a web browser notification shown outside the page. Vendor product names such as "Inbox" are quoted as the vendors write them.

This document compares the options. It does not pick one.

---

## Comparison table

| | Knock | Novu | MagicBell | Courier | SuprSend |
|---|---|---|---|---|---|
| **React Feed: prebuilt** | `@knocklabs/react`: `NotificationFeedPopover`, `NotificationFeed`, `NotificationIconButton` [k1] | `@novu/react` `<Inbox />`, plus composable Bell, Notifications and Preferences parts [n1] | `@magicbell/react`: `Inbox`, `FloatingInbox`, `InlineNotification`, `WebPushButton`, `UserPreferences` [m1] | `@trycourier/courier-react` v9: `<CourierInbox />` [c1] | `@suprsend/react`: popover Inbox, full-screen and side-sheet feeds [s1][s2] |
| **React Feed: headless** | Yes: `useNotifications`, `useNotificationStore`, `useKnockClient` [k2] | Yes: `useNotifications`, `useCounts`, `useNovu` [n2] | No hooks documented. You get CSS variables, `unstyled` and component slots [m1] | One hook, `useCourier()`, which exposes `inbox`, `preferences` and `auth` [c2] | Yes, "headless react hooks" in the docs, but the hook names aren't on the pages read [s1][s2] |
| **Push (web)** | Through **FCM** or **OneSignal**. No native VAPID [k3] | Through **FCM**, **OneSignal** or **Pushpad**, plus Push Webhook and Pusher Beams. No native VAPID found [n3] | **Native Web Push.** You give it your VAPID keys, and its token is the browser `PushSubscription` [m2] | Providers include FCM, OneSignal and others. Native VAPID isn't listed [c3] | **Native Web Push.** It holds your VAPID keys, and you add `serviceworker.js` and call `registerPush()` [s3] |
| **Email through our Postmark?** | Yes, Postmark provider [k4] | Yes, Postmark provider [n4] | **Postmark isn't in the docs' provider list.** The list is SES, Mailgun, SendGrid, Ping Email and SMTP [m3] | Yes, Postmark provider, including `MessageStream` [c4] | Yes, Postmark vendor [s4] |
| **Client auth** | RS256 JWT signed by our server, sent as the `userToken` prop. Needs "enhanced security mode" turned on [k5] | HMAC-SHA256 of `subscriberId` with the secret key, sent as the `subscriberHash` prop [n5] | HS256 JWT signed with the project Secret Key [m4] | JWT minted on our backend with the API key, then `signIn({ userId, jwt })` with scopes [c2] | ES256 JWT with `entity_id` set to our user id. Only checked when Enhanced Security Mode is on, and that is off in Sandbox [s5] |
| **Node trigger** | `@knocklabs/node` `workflows.trigger()` [k6] | `@novu/api` `novu.trigger({ workflowId, to, payload })` [n6] | `magicbell-js/project-client` `broadcasts.createBroadcast()` [m5] | `@trycourier/courier` `client.send.message()` [c5] | `@suprsend/node-sdk` `workflows.trigger()`, which needs version 1.10.0 or later [s6] |
| **Feed state** | seen, read, interacted, archived, link-clicked. These can stack [k7] | read, unread, archive, plus snooze on Cloud only [n2][n7] | seen, read and archived timestamps, with mark and archive endpoints [m6] | read, unread, archive, opened. Seen isn't mentioned [c1] | seen, read, unread, archived, interacted [s7] |
| **Preferences** | Per Channel type, per category and per workflow. Hosted or custom preference centre [k8] | Global, per workflow and per Channel, with a Preferences view inside `<Inbox />` [n8] | Per category × Channel, through the API or `UserPreferences` component [m1][m6] | Topics and sections with OPTED_IN, OPTED_OUT or REQUIRED. Hosted page or `CourierPreferences` component [c6] | Global Channel, category, and Channel within a category. Hosted, embedded or headless [s8] |
| **Dev/test** | Unlimited isolated environments on all plans. Dev → prod promotion through commits. No sandbox flag; the Postmark integration has a sandbox toggle [k9][k4][kp] | Development and Production on Free, custom environments on Team+. **Self-hostable OSS** [n9][n10] | Separate projects per environment, and Free gives one project [m7][mp] | Production and Test environments in every workspace. **Test sends are billable** [c7] | Sandbox, Staging and Production workspaces [s9] |
| **Free tier** | 10,000 messages/mo [kp] | 10,000 workflow runs/mo, 5 workflows, 3 team members [np] | 1,000 deliveries/mo, 1 project [mp] | 10,000 sends/mo [cp] | 10,000 Notifications/mo [sp] |
| **First paid tier** | Starter at **$250/mo**: 50k messages, then $0.005 each [kp] | Pro **from $30/mo**: 30k runs, then $1.20/1k [np] | Startup at **$249/mo**: 50k deliveries, then $0.0025 each [mp] | Business at **$0.005 per send**, pay as you go [cp] | Essentials at **$100/mo**: 50k, then $2/1k [sp] |
| **EU residency** | **Not yet.** "Coming soon", expected by end of 2026. Data is processed in the US today [k10][k11] | US and EU on Free and up, via `eu.api.novu.co` [np][n5] | Not found in the docs or the trust centre [m8] | EU datacenter on Business and Enterprise, via `api.eu.courier.com` [c8] | "Each workspace has a data region, including the EU" [s9]. Pricing lists custom regions under Enterprise [sp] |

---

## Per-vendor notes

### Knock
- **Feed:** The prebuilt popover, full-page Feed and bell are all in `@knocklabs/react` [k1]. Headless hooks also exist, but you mark items seen yourself, for example with `feedClient.markAsSeen(item)` [k2]. Its state model has the most states of the five: seen, read, interacted and archived, which can stack [k7].
- **Push:** Push needs Firebase. You add FCM as a Channel, register a token with the Firebase web SDK, and serve a `firebase-messaging-sw.js` service worker. OneSignal is the alternative [k3]. Either way, Cadence would take on a Google or OneSignal dependency just for Push.
- **Email:** Knock sends through our Postmark server token, and a payload override can pick the `MessageStream` [k4]. The pricing page notes we still pay Postmark directly [kp].
- **Auth:** Our server signs an RS256 JWT with `sub` set to the user id. Enhanced security mode must be on, or the public key can act as any user [k5].
- **Pricing:** The jump from Free to Starter is steep: $0 to $250/mo. Going over the free tier has no hard cap, and Knock contacts you instead [kp].
- **Residency:** EU data residency is "coming soon … by the end of 2026" [k10]. The privacy policy says data is processed and stored in the US [k11].

### Novu
- **Feed:** `<Inbox />` comes with a bell, the Feed and a preferences panel. It supports style overrides, sub-component replacement and localisation [n1], and also has headless hooks [n2].
- **Push:** No native VAPID option was found. The providers are FCM (which supports web), OneSignal, Pushpad (which targets all major browsers) and Push Webhook [n3].
- **Email:** Novu has a Postmark provider that takes a Server API token and a verified From address [n4].
- **Auth:** HMAC-SHA256 of `subscriberId`, hex-encoded, keyed with the secret key. Once HMAC is on, the Inbox won't load without the hash [n5].
- **Dev/test:** Free includes Development and Production environments. Workflows are published from Development to Production, which is view-only [n9]. Novu is the only candidate with an open-source self-hosted edition. The Community edition lacks snooze and branding removal, allows only 1 team member, and supports at most 2 environments [n10]. The pages we read don't state the license.
- **Pricing and residency:** Novu has the cheapest first paid tier, Pro from $30/mo [np]. **EU hosting is available on Free.** The client points at `eu.api.novu.co` and the socket at `eu.socket.novu.co` [np][n5].

### MagicBell
- **Feed:** `@magicbell/react` ships styled components that you customise with CSS variables, `ItemComponent`, `ButtonComponent` or `InboxComponent` slots, and `unstyled` [m1]. No headless hook API is documented [m1][m9].
- **Push:** MagicBell has native Web Push with your own VAPID keys [m2]. Its pages don't say how it delivers internally.
- **Email: Postmark isn't a documented provider.** The docs list Mailgun, Ping Email, SendGrid, Amazon SES and SMTP [m3]. A MagicBell marketing page says Postmark is supported, but we found no Postmark setup docs to confirm it [m10]. Sending through Postmark's SMTP endpoint might work, but we haven't checked this against Postmark's docs.
- **Auth:** HS256 JWT with `user_email` and/or `user_external_id` [m4].
- **Dev/test:** The Quick Start recommends a separate project for staging and production [m7]. Free (Builder) allows only **1 project**. Startup allows 5, and each extra project costs $99 [mp].
- **Pricing:** The free tier is the smallest: 1,000 deliveries/mo. Startup costs $249/mo [mp]. **EU residency isn't stated anywhere we found** [m8].

### Courier
- **Feed:** `<CourierInbox />` is themed with `CourierInboxTheme`. You can also supply custom views or build on `useCourier()` [c1][c2]. The older packages are **deprecated**: `@trycourier/react-inbox`, `react-provider` and `components` [c1].
- **Push:** The provider list includes FCM, OneSignal, Pusher Beams, Airship and even MagicBell. None of them is native VAPID [c3]. A Courier guide recommends OneSignal for browser Push [c9].
- **Email:** Postmark is a first-class provider. You can override the `MessageStream` and use Postmark templates per send [c4].
- **Dev/test:** Every workspace has Production and Test environments, and **Test sends are billable**. The built-in test email provider only delivers to the address you signed up with [c7].
- **Pricing:** Courier now prices by usage. Developer is free up to 10k sends/mo, and Business is $0.005 per send. The page lists no included allotment or minimum for Business, and the FAQ answer about going over the free tier was blank when we checked [cp]. Inbox pricing isn't shown separately [cp].
- **Residency:** The EU datacenter is "available on every paid plan: Business and Enterprise". It uses separate EU API, Inbox and websocket hosts. Data already sent through the US stays there [c8].

### SuprSend
- **Feed:** The popover Inbox can be customised with `theme`, `themeType`, a set of `*Component` slots, click and action handlers, CSS and i18n [s2]. Full-screen and side-sheet layouts are also available [s2]. Headless hooks are available too [s1]. **`@suprsend/react-inbox` has reached end of support**, and you migrate to `@suprsend/react` [s1].
- **Push:** SuprSend has native VAPID Web Push. The public key comes from the dashboard, a root-level `serviceworker.js` imports the SuprSend SDK, and `registerPush()` handles permission and the token [s3]. The JS and React pages pin different web-sdk versions, 3.0.3 and 4.0.0 [s3].
- **Email:** SuprSend has a Postmark vendor with Server Token, From, Reply-to and optional Account Token settings [s4].
- **Auth:** ES256 JWT that SuprSend refreshes through a callback. Enforcement is off in the Sandbox workspace, so test with it on before going live [s5].
- **Dev/test:** Sandbox, Staging and Production workspaces share no data. Changes move between them through the dashboard, the CLI or the Management API [s9]. Sandbox is the trial-period space [s9].
- **Pricing:** Essentials costs $100/mo for 50k, then $2/1k. Business costs $250/mo [sp]. **Going over the free tier doesn't stop sending**, and SuprSend contacts you instead [sp]. Self-hosting and BYOC are Enterprise-only, and BYOC is marked beta [sp].
- **Residency:** The overview says each workspace has a data region, "including the EU" [s9]. Neither the overview nor the pricing page says how to pick a region or whether that needs a paid plan [s9][sp].

---

## Trade-offs (shortlist view, no winner)

- **Keeping Postmark:** Knock, Novu, Courier and SuprSend each have a documented Postmark integration. MagicBell doesn't, so using it means either SMTP (not verified) or leaving Email in `mailer.server.ts`. With any vendor, Cadence could also keep sending Email itself and use the vendor only for Feed and Push. The trade is losing one cross-Channel preference model. Either way, the local `.outbox/` workflow only survives if Email stays in our code, because vendor dev environments send for real.
- **Push without Firebase:** Only MagicBell [m2] and SuprSend [s3] document native VAPID Web Push. Knock and Novu route Push through FCM or OneSignal, or Pushpad for Novu. Courier routes it through third-party push providers.
- **Feed customisability:** Knock, Novu and SuprSend offer both prebuilt components and headless hooks. Courier has one broad hook plus theming. MagicBell is styled-component-first.
- **Data residency:** Novu offers EU even on Free. Courier offers it on any paid plan. SuprSend says per-workspace EU but the docs give no detail on choosing it. Knock has no EU option yet. MagicBell's position isn't documented.
- **Cost at small scale:** All free tiers are 10k/mo except MagicBell's 1k. The first paid steps are Novu $30, SuprSend $100, Knock $250, MagicBell $249, and Courier at $0.005 per send with no fixed fee listed.
- **Local, dev and self-hosting:** Novu is the only one we could run ourselves (Community edition, with limits) [n10]. The others offer separate environments or workspaces only.

---

## Sources (all accessed 2026-11-11)

**Knock**
- [k1] https://docs.knock.app/in-app-ui/react/overview
- [k2] https://docs.knock.app/in-app-ui/react/custom-notifications-ui
- [k3] https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm and https://docs.knock.app/integrations/push/overview
- [k4] https://docs.knock.app/integrations/email/postmark
- [k5] https://docs.knock.app/in-app-ui/security-and-authentication
- [k6] https://docs.knock.app/developer-tools/migration-guides/node and https://docs.knock.app/api-reference/workflows/trigger. The Node SDK overview URL we tried returned 404.
- [k7] https://docs.knock.app/send-notifications/message-statuses
- [k8] https://docs.knock.app/concepts/preferences
- [k9] https://docs.knock.app/concepts/environments
- [k10] https://docs.knock.app/manage-your-account/knock-plans
- [k11] https://knock.app/legal/privacy-policy
- [kp] https://knock.app/pricing

**Novu**
- [n1] https://docs.novu.co/platform/inbox/overview
- [n2] https://docs.novu.co/platform/inbox/headless-mode
- [n3] https://docs.novu.co/platform/integrations/push, https://docs.novu.co/platform/integrations/push/fcm and https://docs.novu.co/platform/integrations/push/pushpad
- [n4] https://docs.novu.co/platform/integrations/email/postmark
- [n5] https://docs.novu.co/platform/inbox/prepare-for-production
- [n6] https://docs.novu.co/platform/sdks/server/typescript
- [n7] https://docs.novu.co/community/self-hosted-and-novu-cloud (snooze is Cloud-only)
- [n8] https://docs.novu.co/platform/concepts/preferences
- [n9] https://docs.novu.co/platform/developer/environments
- [n10] https://docs.novu.co/community/self-hosting-novu/overview and https://docs.novu.co/community/self-hosted-and-novu-cloud
- [np] https://novu.co/pricing

**MagicBell**
- [m1] https://www.magicbell.com/docs/libraries/magicbell-react
- [m2] https://www.magicbell.com/docs/channels/web_push
- [m3] https://www.magicbell.com/docs/channels/email
- [m4] https://www.magicbell.com/docs/api/authentication/user
- [m5] https://www.magicbell.com/docs/libraries/magicbell-js. We read only the first half of this long page.
- [m6] https://www.magicbell.com/docs/api/reference and https://www.magicbell.com/docs/channels/in_app. These came from search-result excerpts and weren't read in full.
- [m7] https://www.magicbell.com/docs/quick-start
- [m8] https://www.magicbell.com/security and https://www.magicbell.com/privacy-policy. Neither states a hosting region.
- [m9] https://www.magicbell.com/docs/libraries
- [m10] https://www.magicbell.com/email (marketing claim of Postmark support)
- [mp] https://www.magicbell.com/pricing

**Courier**
- [c1] https://www.courier.com/docs/platform/inbox/inbox-overview
- [c2] https://www.courier.com/docs/sdk-libraries/courier-react-web
- [c3] https://www.courier.com/docs/integrations/push/overview
- [c4] https://www.courier.com/docs/external-integrations/email/postmark
- [c5] https://www.courier.com/docs/sdk-libraries/node
- [c6] https://courier.com/docs/platform/preferences and https://www.courier.com/docs/guides/build-a-preference-center
- [c7] https://www.courier.com/docs/platform/workspaces/environments-api-keys
- [c8] https://www.courier.com/docs/platform/workspaces/eu-datacenter
- [c9] https://www.courier.com/guides/nodejs-send-push-notifications (a Courier guide, not reference docs)
- [cp] https://www.courier.com/pricing

**SuprSend**
- [s1] https://docs.suprsend.com/docs/react-inbox-integration
- [s2] https://docs.suprsend.com/docs/react-in-app-feed
- [s3] https://docs.suprsend.com/docs/react-webpush, https://docs.suprsend.com/docs/js-webpush and https://docs.suprsend.com/docs/web-push-quick-start. These came from search-result excerpts.
- [s4] https://docs.suprsend.com/docs/postmark
- [s5] https://docs.suprsend.com/docs/client-authentication
- [s6] https://docs.suprsend.com/docs/node-trigger-workflow-from-api
- [s7] https://docs.suprsend.com/docs/js-inapp-feed
- [s8] https://docs.suprsend.com/docs/user-preferences
- [s9] https://docs.suprsend.com/docs/what-is-suprsend
- [sp] https://www.suprsend.com/pricing
