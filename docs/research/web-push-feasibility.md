# Web Push feasibility for Cadence

Research date: 2026-11-11. Question: can Cadence, a React Router web app with no native mobile app, deliver **Push** (a Notification shown by the recipient's web browser, outside the Cadence page, after they've allowed it)? And who can never get Push, so needs the **Feed** or **Email** Channel instead?

## Answer

**Bottom line:** Yes, Push works, but only as an opt-in extra Channel. It cannot be the only way a Notification reaches someone.

- **Desktop and Android:** Push works in every current major browser. That covers Chrome, Edge, Firefox, Opera, Samsung Internet, and Safari on macOS 13 Ventura or later [3][4].
- **iPhone and iPad:** Push only works once the person adds Cadence to their Home Screen and opens it from there, on iOS/iPadOS 16.4 or later [1][2][3]. A plain Safari tab on iOS cannot get Push. Neither can a Chrome or Firefox tab on iOS [3][4].
- **What Cadence must build:**
  - an HTTPS origin;
  - a service worker served from `public/sw.js` at scope `/`;
  - a web app manifest;
  - a subscribe button that asks for permission (no prompt on page load);
  - a VAPID key pair;
  - server-side sending under RFC 8030, 8291 and 8292, normally through a library such as `web-push` [5][6][7][8].

**Who can never get Push** (they need the Feed and/or Email):

- iPhone and iPad users who browse Cadence in a Safari, Chrome or Firefox tab and never add it to the Home Screen. This is probably most iOS visitors.
- iOS/iPadOS older than 16.4, and Safari on macOS older than 13 Ventura.
- Anyone who denies or blocks the prompt, or ignores it. "Default" acts as "denied" [9].
- People whose permission was silently removed later. Chrome now auto-revokes notification permission from low-engagement sites that send a lot [12][13]. That fits a course site people visit in bursts.
- In-app browsers and webviews, such as links opened from Instagram, Gmail or Slack apps. Android WebView and iOS WKWebView/SFSafariViewController have no Push [3][4].
- Firefox ESR (push disabled by default), Opera Mini, and private/incognito windows in Chrome, Samsung Internet and Opera [3][4].
- Devices they haven't subscribed on. A subscription belongs to one browser profile on one device [10]. Allowing Push on a work laptop does nothing for the phone.
- On desktop, Push generally arrives only while the browser is running [4]. If the browser is closed, the message waits until the TTL runs out, then it is lost.

**What this means for the Email fallback:**

1. **Email has to be the default reliable Channel** for anything a learner must not miss: purchase, refund, enrollment, account and security Notifications. Push is a "nice extra" for people who opt in on a given device.
2. **Never assume Push was delivered.** A 201 from the push service only means it was accepted, not shown. Subscriptions also expire or disappear (410 Gone) [5][8]. So "send Email only if Push fails" is not a safe rule for important Notifications. Decide per Notification type. Or send Email when the Notification is still unread in the Feed after a delay.
3. **Store subscriptions per device**, as many as a user has, and delete them on 404/410. A user with zero live subscriptions has to get Email or the Feed.
4. **Every Notification belongs in the Feed.** Push and Email are pointers back to it.

---

## 1. Browser support (Push API + Notifications API)

### Support table

"Push" below means `PushManager.subscribe`, the service-worker `push` event and `showNotification`. Version numbers come from MDN browser-compat-data 8.1.8 (2026-11-02) [4] and caniuse's raw data [3].

| Browser | Push API from | Notifications from | Notes |
| --- | --- | --- | --- |
| Chrome desktop | 42 (payloads from 50) | 20 | Gets messages only while the browser is running [3]. No notifications in incognito [4]. |
| Edge desktop | 17 (Chromium Edge 79+) | 14 | Same running-browser caveat as Chrome [3][4]. |
| Firefox desktop | 44 | 22 | `subscribe()` and `requestPermission()` need a user gesture since 72 [4][11]. Push is off by default in ESR [3]. |
| Opera desktop | 29 | 23 | [4] |
| Safari macOS | 16 / 16.1 | 7 | Needs macOS 13 Ventura or later [1][4]. Declarative Web Push: Safari 18.5 per Apple [15], 18.4 per MDN data [4]. |
| Chrome Android | 42 | 42 (service worker only) | `new Notification()` isn't supported; use `registration.showNotification()` [4]. |
| Firefox Android | 48 | 22 | User gesture needed since 79 [4]. |
| Samsung Internet | 4.0 | 4.0 (service worker only) | No notifications in incognito since 5.0 [4]. |
| Safari iOS/iPadOS | 16.4, **Home Screen web app only** | 16.4, Home Screen web app only | In a normal tab, `Notification` is undefined [4]. Declarative Web Push from 18.4 [2]. |
| Chrome / Firefox / Edge on iOS | No (in a tab) | No | They render with WKWebView, which has no Push [3][4]. They can still "Add to Home Screen", and the result is a WebKit web app that can use Push [14]. |
| Android WebView (in-app browsers) | No | No | [4] |
| iOS WKWebView / SFSafariViewController | No | No | [3][4] |
| Opera Mini | No | No | [3] |

MDN marks the Push API as "Baseline: widely available", meaning across browsers since March 2023 [10]. caniuse rates iOS Safari only "partial", because it needs the Home Screen [3].

**Uncertain:**

- The caniuse data says "Safari 7.0 – 26.3 supported Safari Push Notifications". That is Apple's older, proprietary website-push format, not W3C Web Push [3]. It suggests the legacy format is gone from Safari 26.4. I could not confirm this from Apple: the WebKit Safari 26.4 post lists only a `FontFaceSet` deprecation [16]. It doesn't matter for Cadence, which should only use standard Web Push.
- Apple's WWDC25 session gives Safari 18.5 on macOS for Declarative Web Push [15]. MDN's data gives 18.4 for `window.pushManager` [4]. Either way, any current Safari has it.

## 2. iOS / iPadOS requirements

- **Home Screen web app.** iOS/iPadOS 16.4 added Web Push only "to web apps added to the Home Screen" [1][14]. Up to iOS 18 that meant the site had to serve a manifest with `display` set to `standalone` or `fullscreen` [1]. MDN's data says `Notification` "is undefined, unless the page is a web app saved to the home screen. The app's manifest must have a non-default `display` value" [4].
- **iOS/iPadOS 26 change.** "By default, every website added to the Home Screen opens as a web app", and "giving users a web app experience simply no longer requires a manifest file" [17]. The user can still switch off "Open as Web App" when adding the site [17].
  - **Uncertain:** I found no Apple statement that Push works in a web app with no manifest. Ship a manifest anyway. It provides `name`, icons, `display: standalone`, and `id`. WebKit supports the manifest `id` "to support notifications and badging for multiple installs of the same web app" [14].
- **User gesture.** The permission request must be "in response to direct user interaction", such as tapping a subscribe button [1].
- **No Apple Developer account needed.** If you restrict outbound endpoints, allow `*.push.apple.com` [1].
- **Third-party browsers.** From 16.4, other browsers can offer "Add to Home Screen" in the Share menu [14]. The web app that results runs on WebKit and can use Push. In a tab of those browsers, there is no Push [3][4].
- **Plain Safari tabs on iOS can't receive Push.** Every Apple source scopes Push to Home Screen web apps [1][2][14][15]. MDN's data says `Notification` is undefined in a normal tab [4].
- **Declarative Web Push (iOS/iPadOS 18.4).** It's "available on iOS and iPadOS 18.4 for web apps added to the Home Screen" [2]. So it removes the service-worker requirement but not the Home Screen requirement.
- **Badging.** Home Screen web apps can call `setAppBadge()`, and that permission is granted automatically [14]. It's a cheap "you have N new Notifications" signal that mirrors the Feed.
- **EU.** In the iOS 17.4 betas (February 2024), Apple removed Home Screen web apps in the EU. After pushback it reversed course before iOS 17.4 shipped in March 2024, keeping the existing WebKit-based capability [18].
  - Apple's DMA support page as of 2026 no longer mentions Home Screen web apps [19].
  - I found no later change that removes them.
  - **Uncertain:** EU browsers that use a non-WebKit engine could in principle behave differently. I found no Apple source saying non-WebKit engines can install Home Screen web apps or support Push.
- **Nothing found newer than iOS 26 that changes Push.** The Safari 26.0 and 26.4 posts mention no Push changes beyond the Home Screen default [16][17].

## 3. The permission prompt and how to ask

- **User gesture.**
  - Firefox 72+: `Notification.requestPermission()` and `PushManager.subscribe()` "can now only be called in response to a user gesture such as a click event" [11]. Before that, Mozilla found prompts shown after a user interaction were accepted far more often [20].
  - Safari/iOS requires it [1].
  - MDN advises it for every browser [9].
  - Lighthouse flags permission requests made on page load [21].
- **Chrome's quieter UI (since Chrome 80, January 2020).**
  - Users can turn on "Use quieter messaging". Chrome also puts some users and some sites with very low acceptance rates on it automatically [22][23].
  - In quiet mode the user sees only a bell icon in the address bar, no pop-up [23].
- **Chrome on Android, Chrome 155 (July 2026).**
  - The prompt is now lighter and non-blocking. If the user doesn't decide before it times out, `requestPermission()` resolves `'default'`. The user can subscribe later through Site Controls [24].
  - So code must also watch `navigator.permissions.query({name: 'notifications'})` for a later change to `granted`, then subscribe [24].
- **Abuse controls in Chrome.**
  - Sites flagged by Safe Browsing lose the permission automatically [12].
  - From October 2025, Chrome auto-revokes the permission from sites with "very low user engagement and a high volume of notifications". Installed web apps are exempt, and Chrome says "less than 1% of all notifications receive any interaction" [13].
  - From January 2026, Chrome rate-limits the Push API for disruptive sites. Pushes over the limit get HTTP 429, with 1-, 7- and 14-day penalties [25].
  - Chrome on Android warns users about spammy or deceptive notifications, using an on-device ML model [12].
- **Best practice: the double permission, or pre-prompt [26].**
  - First show Cadence's own UI explaining the value, at a moment when the benefit is obvious. Only call the browser prompt if the user says yes.
  - Once the browser prompt is "blocked", the site "can't ask for permission again". Only the user can undo it in browser settings [26].
  - Offer an obvious off switch [26].
  - Natural moments for Cadence: after enrolling in a course, on a "notify me when the next lesson is released" toggle, or in a notification-preferences screen. Never on landing pages.
- **iOS install step.** On iOS, the pre-prompt really needs two steps. First an "Add Cadence to your Home Screen" explainer. Then, inside the installed app, the subscribe button. Feature-detect with `'PushManager' in window` / `'Notification' in window`, not by sniffing the browser [1].

## 4. Service worker, and wiring Push into Cadence

- **Classic Web Push needs a service worker.** "An app must have an active service worker to receive push messages" [10]. `ServiceWorkerRegistration.pushManager.subscribe()` fails without an active worker [27]. The page needs a secure context (HTTPS, or localhost) [9].
- **Declarative Web Push.**
  - It removes the need on Safari only. Subscribe through `window.pushManager`, then send JSON with `"web_push": 8030` plus a `notification` object that has a `title` and a `navigate` URL. The browser shows it without running any JavaScript [2][15][27].
  - It's now in the W3C Push API editor's draft [27].
  - Chrome, Edge, Firefox and Samsung Internet don't support `window.pushManager` [4]. Cadence still needs a service worker for them.
  - The same declarative JSON payload works everywhere: older browsers just hand it to the service worker's `push` handler [2][15].
  - Recommended: send declarative-format payloads, and keep a small `sw.js` that parses them and calls `showNotification`. That covers Safari 18.4+ with no service-worker wake-up, and every other browser through the worker.
  - With a root-scoped service worker present, Safari shares one subscription between `window.pushManager` and the worker [2]. Window-scoped subscriptions get no `pushsubscriptionchange` event [27].

**What it takes in this repo** (looked at, not changed). The `package.json` shows React Router 8.3.0 and Vite 7, so the brief's "v7" is out of date. `ssr: true`.

- `public/` exists and holds only `favicon.svg` and `images/`. There is **no manifest and no service worker**, and nothing in `app/` references either.
  - Vite serves `public/` "at root path `/` during dev" and copies it "to the root of the dist directory as-is", with no hashing [28].
  - So `public/sw.js` is served at `/sw.js`, and its default scope is `/`, the whole app. A worker served from a hashed asset path would get the wrong scope and a changing URL, so keep it in `public/`.
- Add `public/manifest.webmanifest` with `name`, `id`, `start_url`, `display: "standalone"` and icons, and link it from `links` in `app/root.tsx`.
- In the client (a `useEffect` or a click handler, never during SSR), call `navigator.serviceWorker.register('/sw.js')`. Then, inside a click handler, call `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
  - Chrome, Edge and Samsung Internet require `applicationServerKey` [4]. It's the VAPID P-256 public key [27].
  - Chrome requires `userVisibleOnly: true`, meaning every push must show a Notification.
- POST the `PushSubscription` (endpoint plus `p256dh`/`auth` keys) to a React Router action, and store it in a new table, one row per device.
  - The endpoint is a secret capability URL, so protect the subscribe action against CSRF [10]. Adding the table means a schema change plus migration (see the database-migrations skill).
- Server sending: POST the encrypted message to `endpoint`.
  - **RFC 8030** (Web Push protocol): the `TTL` header is mandatory. `Urgency` and `Topic` are optional. Push services must accept bodies of at least 4096 bytes [5].
  - **RFC 8291**: the payload is encrypted with `aes128gcm`, for at most 3993 bytes of plaintext [6].
  - **RFC 8292** (VAPID): `Authorization: vapid t=<ES256 JWT>, k=<public key>`, with `aud` set to the push-service origin and `exp` no more than 24 hours ahead [7].
  - Use a maintained library such as `web-push`. The web.dev protocol article is useful background, but it describes the older draft `aesgcm` encoding [8].
  - Generate the VAPID key pair once and keep the private key server-side in env.
  - On 404/410, delete the subscription. On 429 (Chrome rate limit [25]), back off.
- `sw.js` needs:
  - a `push` handler that calls `event.waitUntil(self.registration.showNotification(...))`;
  - a `notificationclick` handler that focuses or opens the Feed item's URL;
  - optionally a `pushsubscriptionchange` handler that re-POSTs the new subscription [27].

## 5. Reach: who can never get Push

| Group | Why | Fallback |
| --- | --- | --- |
| iOS/iPadOS users in a Safari, Chrome or Firefox tab | Push only exists in Home Screen web apps [1][2][4] | Email + Feed |
| iOS/iPadOS older than 16.4; macOS older than Ventura (Safari) | No Web Push support [1][4] | Email + Feed |
| Anyone who denies, blocks or ignores the prompt | "default" acts as denied; once blocked, the site can't re-ask [9][26] | Email + Feed |
| Users whose permission Chrome auto-revoked (low engagement + high volume, or abusive) | [12][13] | Email + Feed |
| In-app browsers (Android WebView, iOS WKWebView/SFSafariViewController) | No Push API [3][4] | Email + Feed |
| Firefox ESR, Opera Mini, private/incognito windows | Disabled or unsupported [3][4] | Email + Feed |
| Brief visitors who never reach the opt-in moment | Opt-in needs a gesture and a reason [11][26] | Email |
| Users subscribed on another device only | One subscription per browser profile and device [10] | Email (and Push on that other device) |
| Desktop users whose browser is closed past the TTL | Delivery needs the browser running [3]; the message expires after the TTL [5] | Email, or Feed on next visit |

**Implications for Email:**

- Email is the only Channel that reaches everyone with an account, on any device, without an opt-in prompt.
- Push should be per-device, opt-in, and limited to timely nudges, such as "new lesson released" or "reply to your question".
- Anything a learner must be told about goes to Email, or at least Email if still unread. The Feed always holds the full record.
- Cadence can't see whether a Push was actually shown, so "Email only if Push failed" can't be detected reliably. Use per-type rules, or "Email if the Feed item is still unread after N hours".

## Sources

1. WebKit — Web Push for Web Apps on iOS and iPadOS (2023): https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
2. WebKit — Meet Declarative Web Push (2025): https://webkit.org/blog/16535/meet-declarative-web-push/ ; WebKit Features in Safari 18.4: https://webkit.org/blog/16574/webkit-features-in-safari-18-4/
3. caniuse raw data (Fyrd/caniuse), push-api and notifications: https://caniuse.com/push-api , https://caniuse.com/notifications (data: https://github.com/Fyrd/caniuse/tree/main/features-json)
4. MDN browser-compat-data 8.1.8 (2026-11-02), api.PushManager, api.PushManager.subscribe, api.PushEvent, api.Notification, api.Notification.requestPermission_static, api.ServiceWorkerRegistration.showNotification, api.Window.pushManager: https://github.com/mdn/browser-compat-data
5. RFC 8030 — Generic Event Delivery Using HTTP Push: https://www.rfc-editor.org/rfc/rfc8030.html
6. RFC 8291 — Message Encryption for Web Push: https://www.rfc-editor.org/rfc/rfc8291.html
7. RFC 8292 — VAPID for Web Push: https://www.rfc-editor.org/rfc/rfc8292.html
8. web.dev — The Web Push Protocol: https://web.dev/articles/push-notifications-web-push-protocol
9. MDN — Notification.requestPermission(): https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static
10. MDN — Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
11. MDN — Firefox 72 release notes for developers: https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/72
12. Google (Chromium) — Fighting Unwanted Notifications with Machine Learning in Chrome (2025-05-08): https://blog.google/chromium/fighting-unwanted-notifications-wi/
13. Google (Chromium) — Reducing notification overload for a quieter browsing experience in Chrome (2025-10-10): https://blog.google/chromium/automatic-notification-permission/
14. WebKit — WebKit Features in Safari 16.4: https://webkit.org/blog/13966/
15. Apple WWDC25 — Learn more about Declarative Web Push: https://developer.apple.com/videos/play/wwdc2025/235/
16. WebKit — WebKit Features for Safari 26.4: https://webkit.org/blog/17862/webkit-features-for-safari-26-4/
17. WebKit — WebKit Features in Safari 26.0: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
18. Apple's March 2024 EU Home Screen web apps statement, as reported (Apple's own page no longer carries it): https://9to5mac.com/2024/03/01/apple-home-screen-web-apps-ios-17-eu/ (secondary source; flagged)
19. Apple Developer — Update on apps distributed in the EU (2026 version): https://developer.apple.com/support/dma-and-apps-in-the-eu/
20. Mozilla — Restricting Notification Permission Prompts in Firefox (2019): https://blog.mozilla.org/futurereleases/2019/11/04/restricting-notification-permission-prompts-in-firefox/
21. Chrome for Developers — Lighthouse: Requests the notification permission on page load: https://developer.chrome.com/docs/lighthouse/best-practices/notification-on-start
22. Chromium Blog — Introducing quieter permission UI for notifications (2020-01-07): https://blog.chromium.org/2020/01/introducing-quieter-permission-ui-for.html
23. Google Chrome Help — Use notifications to get alerts: https://support.google.com/chrome/answer/3220216
24. Chrome for Developers — Lighter notification prompts on Android (2026-07-22, Chrome 155): https://developer.chrome.com/blog/notification-prompts-android
25. Chrome for Developers — Increasing web push notification value with rate limits (2026-01-06): https://developer.chrome.com/blog/web-push-rate-limits
26. web.dev — Permission UX (push notifications): https://web.dev/articles/push-notifications-permissions-ux
27. W3C Push API (Editor's Draft): https://w3c.github.io/push-api/
28. Vite — Static Asset Handling, The public directory: https://vite.dev/guide/assets#the-public-directory

**Notes on source quality:**

- [18] is a news report. The primary Apple statement has been taken off Apple's page.
- I couldn't load the full body of [22]. Its facts are corroborated by [23].
- Apple's "Sending web push notifications in web apps and browsers" developer doc wouldn't load through the fetch tool, so this note doesn't rely on it.
