# AGENTS.md - Instructions for Coding Agents

## Self-Improvement Directive

**Important:** Read this file at the start of each task, and update it whenever you learn something important about this codebase.

Capture both wins to repeat and mistakes to avoid. Prefer concrete notes over general advice:

- Verified build, test, and deploy commands
- Project conventions and architectural patterns
- Common errors, incompatibilities, and their fixes
- Effective file paths and navigation shortcuts
- Important dependencies, versions, and integration constraints
- Collaboration preferences and product direction signals

Keep this file compact and current. If guidance becomes repetitive, consolidate it instead of adding more noise.

## Project Overview

Hypecast is a PWA-first Farcaster client built with vanilla TypeScript, Vite, and a static HTML entrypoint. It includes local custody-account access and creation, wallet-native identity, Farcaster auth, direct signed Farcaster writes, and XMTP browser client integration.

Current priorities:

- Mobile-first installable web app
- Easy access on web and mobile
- Static HTML plus TypeScript, not a React app
- Wallet and XMTP support built into the client shell
- GitHub Pages deployment to `https://hypecast.net/`

## Build & Test Commands

Verified commands:

```bash
npm install
npm run dev
npm run dev -- --host 0.0.0.0
npm run sync:feed
npm run test:unit
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
gh run list --workflow deploy-pages.yml --limit 1
gh run watch <run-id> --exit-status
```

Notes:

- `npm run build` runs `tsc --noEmit && vite build`.
- `npm run dev -- --host 0.0.0.0` is useful for testing Farcaster sign-in from another device on the same network.
- `npm run sync:feed` refreshes `public/farcaster-feed.json` from the configured Farcaster SSR profile sources.
- `npm run test:unit` runs the Vitest suite for shared security helpers, feed normalization, custody-account parsing, and signer-vault behavior.
- `npm run test:e2e` runs the Playwright suite against a local Vite server on `127.0.0.1:4173`.
- After every push to `main`, check the latest `deploy-pages.yml` run and wait for it to finish with `gh run watch <run-id> --exit-status`.
- Install the Playwright browser runtime with `npx playwright install chromium` after adding or refreshing the dependency.

## Project Structure

- `index.html`: single static entrypoint
- `src/main.ts`: app bootstrap and PWA service worker registration
- `src/app.ts`: top-level DOM rendering and interaction/state wiring
- `src/config.ts`: runtime config parsing for RPC and XMTP environment
- `src/services/feed.ts`: loads the public fallback feed plus the personalized Neynar following feed when a signed-in `fid` and stored API key are available
- `src/services/neynar.ts`: handles Neynar write-access storage, popup auth, and Farcaster cast/reaction writes
- `src/services/security.ts`: shared escaping and protocol-allowlist helpers for untrusted text and remote URLs
- `src/test-support.ts`: browser-only test seam for Playwright mocks of standalone mode, wallet, Farcaster, and XMTP
- `src/services/wallet.ts`: injected EVM wallet connection
- `src/services/farcaster.ts`: Farcaster auth channel creation, QR generation, and verification
- `src/services/farcaster-account.ts`: custody import/generation, plaintext backup creation, Optimism account inspection, IdGateway registration, and profile lookup
- `src/services/farcaster-signer.ts`: scoped Ed25519 signer authorization, Snapchain submission/readback, and direct Farcaster message builders
- `src/services/farcaster-vault.ts`: HKDF/AES-GCM encrypted browser vault for the local Ed25519 signer seed
- `src/services/xmtp.ts`: XMTP browser client bootstrap
- `src/styles.css`: global styles and responsive layout
- `scripts/sync-farcaster-feed.mjs`: refreshes `public/farcaster-feed.json` from public Farcaster SSR profile pages
- `public/farcaster-feed.json`: committed same-origin snapshot used by the home feed in production
- `public/logo.svg`: public brand logo served directly at `/logo.svg`
- `tests/`: Playwright end-to-end coverage for the mobile shell and mocked integration flows
- `public/icons/icon.svg`: app icon used by the PWA manifest
- `vite.config.ts`: Vite config plus PWA and Workbox settings
- `.github/workflows/deploy-pages.yml`: GitHub Pages build and deploy workflow

## Coding Conventions

- Keep the app framework-free unless the user explicitly changes direction. This repo is currently vanilla TypeScript plus direct DOM rendering.
- Preserve the static HTML entry model. Do not introduce server-side rendering or framework routers without a clear product decision.
- Keep integration logic behind focused service modules in `src/services`.
- Put runtime config in `src/config.ts` and environment variables in `.env` / `.env.example`.
- Favor mobile-first UI changes and preserve the installable PWA behavior.
- Keep CSS intentional and branded. Avoid replacing the current visual direction with generic component-library styling.
- Keep the signed-in experience inside the phone-shell UI in `src/app.ts` / `src/styles.css`. Wallet, Farcaster, XMTP, and install actions should stay reachable from panes or overlays within that shell instead of reintroducing a separate dashboard.
- On desktop, keep the interactive phone shell centered and treat any surrounding rails as supporting context only. Do not move primary controls or flows out of the shell.
- Search, draft composer state, locally published casts, and the persisted Farcaster profile currently live in `src/app.ts` via `localStorage`. If you change those flows, update the storage behavior and the E2E coverage together.
- Local reply targets and feed interaction toggles (`like` / `recast`) are also managed in `src/app.ts`. If you touch feed actions, keep their local persistence and the action-count tests in sync.
- Keep the bottom nav outside the `.shell-content` scroll container. The intended behavior is a pinned shell footer while only the feed/pane content scrolls.
- Keep the Home timeline free of synthetic placeholder cards. Account/status controls belong in panes or overlays; the feed itself should start with real snapshot or local casts.
- Any untrusted remote URL that reaches `href` or `src` should go through `src/services/security.ts` first. Do not interpolate remote URLs directly into markup.
- `FeedMedia` now supports `href`, `posterSrc`, and `showDetails`. Use `showDetails: false` for plain image/video attachments so the shell does not print redundant source/title captions.
- Custody recovery phrases and private keys must remain memory-only: clear import controls immediately after parsing, never place raw secrets in app persistence or logs, and discard the transient account whenever the account sheet closes.
- Keep custody and app signing separate. The custody key authorizes or decrypts the scoped Ed25519 signer; ordinary casts, replies, reactions, profile changes, and deletions should use the app signer.
- Keep the decrypted local signer bounded: reload, `pagehide`, background visibility, and 15 minutes of inactivity lock it. Do not rely on `beforeunload` alone for mobile/PWA cleanup.
- Optimism registration must stay explicit: re-read the IdGateway price and balance, require plaintext-backup confirmation, wait for a successful receipt, and read the FID back before enabling writes. Never auto-spend merely because an address is funded.
- Forward the confirmed IdGateway transaction hash into immediate gasless `KEY_ADD` authorization and preserve it in pending-vault retries; IdRegistry readback does not prove Snapchain has ingested the registration yet.
- A local signer may write only when its FID matches the visible Farcaster profile. Lock a mismatched signer on SIWF/hosted/local account switches, and do not merge identity fields across different FIDs.
- Guard every async account inspection/registration completion with the current account-flow token and custody identity. A stale response must never replace a newer funding address, QR code, or mnemonic.
- Direct cast replies/reactions require a real cast hash plus author FID. Trust a hash-shaped `cast.id`; otherwise resolve through the cast lookup service or block the write. Never extract a hash substring from an untrusted permalink.

## Dependencies That Matter

- `vite@^7.3.6`
- `vite-plugin-pwa@^1.2.0`
- `typescript@^6.0.2`
- `hls.js@^1.6.16`
- `viem@^2.56.0`
- `@farcaster/auth-client@^0.7.1`
- `@farcaster/core@^0.20.0`
- `@scure/bip39@^1.6.0`
- `@xmtp/browser-sdk@^7.0.0`
- `qrcode@^1.5.4`

## Known Issues & Solutions

- `vite-plugin-pwa@1.2.0` does not accept Vite 8. The project is pinned to Vite 7 for compatibility.
- The XMTP browser SDK emits a large `.wasm` asset. The PWA build excludes `*.wasm` from precache and caches it at runtime instead. If Pages builds start failing with Workbox size-limit errors, inspect `vite.config.ts` before changing anything else.
- XMTP browser storage uses OPFS. Multiple tabs using the same app instance can conflict.
- Farcaster auth via the public relay works best when the app is reachable from the signing device. On local dev, use `--host 0.0.0.0` or a tunnel if mobile sign-in is failing.
- `@farcaster/core` is lazy-loaded into a named `farcaster-core` chunk larger than 2 MiB. `vite.config.ts` must keep that stable chunk name, exclude its JavaScript from Workbox precache, and runtime-cache it. A static core import or removing the Workbox ignore breaks the build's 2 MiB precache gate.
- Local custody imports accept 12/24-word BIP-39 phrases, 32-byte secp256k1 keys, and Hypecast/Maelstrom JSON fields. Raw custody material is memory-only; the persisted Ed25519 signer seed is AES-GCM encrypted under an HKDF-SHA-256 key derived from the custody key, so reload requires reimport.
- Persist a newly generated app signer as a pending encrypted vault before submitting its network authorization. Retain that pending vault when submission or readback is ambiguous so retries reuse the same key and nonce; never authorize first and attempt to save the signer afterward.
- Retain a verified signer vault when a gateway temporarily omits its network record. A single successful-but-incomplete replica response is not proof of revocation and must not trigger replacement-key provisioning.
- Direct Snapchain submission prefers Neynar when an API key is available and falls back to `https://haatz.quilibrium.com`. Readback is best-effort after a successful submission, so a pending readback is not equivalent to a failed write.
- Deleting the local signer vault does not revoke its on-network authorization. New IdGateway registrations create an FID but do not claim a username; both signer revocation and username claims need separate Farcaster flows.
- The XMTP SDK typings currently require a small adapter/cast when creating the client with a custom backend. Be careful upgrading that package, because the runtime behavior and the exported TypeScript shapes are not perfectly aligned.
- The browser app cannot fetch `https://ssr.farcaster.xyz/*` directly because of cross-origin restrictions. If the home feed needs fresher real data, update the committed snapshot with `npm run sync:feed` instead of wiring runtime fetches to SSR pages.
- If the bottom nav drifts below the fold again, inspect `html`, `body`, `#app`, `.app-shell`, and `.phone-shell` first. The shell depends on viewport-locked `100dvh` sizing plus `body { overflow: hidden; }`.
- Keep `.bottom-nav` sticky with `bottom: 0` and `margin-top: auto` so it stays anchored to the phone shell edge while only `.shell-content` scrolls.
- The personalized following feed currently uses Neynar from the browser with a built-in default client key, and optional browser-local overrides stored in `localStorage`. That is the practical Pages-compatible path today, but it is not the long-term secret-management model.
- Hypecast now ships with the verified Converge Neynar client key as the built-in default. The account-sheet field is a browser-local override, not a required setup step.
- Local custody signing is the primary Farcaster write path. Hosted Neynar signing remains optional and still requires a client ID plus the matching API key from the same Neynar app.
- `index.html` now carries the repo's meta CSP and referrer policy. If new browser capabilities need extra origins or worker behavior, update the policy deliberately instead of loosening it blindly.

## Deployment Notes

- Production deploys from `main` through `.github/workflows/deploy-pages.yml`.
- GitHub Pages is configured with `build_type: workflow`.
- The custom domain is `hypecast.net`.
- HTTPS enforcement is enabled on the GitHub Pages site.
- The deploy workflow builds `dist/` and uploads it as the Pages artifact.
- The expected post-push verification flow is: push, get the newest `deploy-pages.yml` run ID, then wait on it with `gh run watch <run-id> --exit-status`.
- `dist/` is build output and should stay ignored locally.

## Agent Tips

- Read `README.md`, `vite.config.ts`, and `src/app.ts` before broad architectural changes.
- For wallet, Farcaster, or XMTP work, inspect the service module first instead of spreading logic through the UI layer.
- If a change touches PWA behavior, verify both `npm run build` and the Pages workflow assumptions.
- When adjusting XMTP or PWA config, expect bundler-level issues before app-level issues.
- `FEATURES.md` lives at the repo root and follows the features.md structure. Use `stable`, `in-progress`, and `planned`, and keep properties plus test criteria concrete.
- If the visual shell changes significantly, keep `index.html` and `vite.config.ts` theme colors aligned with the active app chrome so installed PWA chrome does not drift.
- Prefer extending `src/test-support.ts` for Playwright integration mocks instead of stubbing production modules ad hoc in tests.
- Keep pure trust-boundary logic testable from Vitest. The current unit-test surface lives in `src/services/security.test.ts` and `src/services/feed.test.ts`.
- The Playwright config targets a mobile Chromium profile and blocks service workers to keep the shell tests deterministic.
- The app rerenders the shell from `root.innerHTML`, so any live text inputs added to overlays need explicit focus restoration after render, or typing/search will break.
- Build metadata is stamped in `vite.config.ts` via `__HYPECAST_BUILD_ID__` and `__HYPECAST_BUILD_TIME__`, and surfaced in the Settings overlay in `src/app.ts`. The shell now renders build time in local browser time with a timezone label while keeping the raw ISO stamp in the element `title`.
- Playwright defaults now include a mocked feed snapshot; if you change timeline tabs or feed copy, update `tests/feed-fixture.ts` and the corresponding E2E assertions together.
- The profile/account overlays own SIWF handoff, custody import, funding QR, backup, and registration. Keep them scrollable on mobile so warnings, close controls, and registration gates remain reachable.
- If you learn a new repo-specific command, deployment quirk, or SDK hazard, add it here before finishing the task.
- Runtime feed loading now attempts live Farcaster SSR profile data via CORS-friendly mirrors (`allorigins`, `r.jina.ai`) before falling back to the committed snapshot; successful responses are cached in `localStorage` under `hypecast:feed-snapshot` for a short TTL.
- Personalized feed loading uses the signed-in Farcaster `fid` plus `hypecast:neynar-api-key` from `localStorage` to request Neynar's following feed directly from the browser. If that request fails, the app falls back to the last matching cached personalized snapshot when available.
- The working built-in Neynar fallback was verified against the live following-feed endpoint on April 16, 2026. An older key still referenced in `../converge.cv/AGENTS.md` is dead and should not be copied forward.
- Neynar image embeds often arrive as `metadata.content_type: image/*` plus `metadata.image`, even when the URL has no file extension. The media normalizer must treat those as images and should rank direct image/OG/frame previews above embedded-cast fallbacks.
- Inline feed video setup now lives in `src/services/video.ts`. If remote feed videos stop playing inline in Chromium-class browsers, check the HLS detection/helper there before changing the feed renderer.
- `hls.js` is lazy-loaded into its own Vite chunk for inline feed playback. That chunk currently triggers Rollup's 500 kB size warning during `npm run build`, but the build still succeeds and the split stays off the main bundle.
- Media downloads are handled client-side in `src/app.ts` with a fetch-to-blob attempt and a new-tab fallback. If you add new downloadable media surfaces, keep them behind sanitized URLs and `data-download-url` buttons.
- Fullscreen feed media now uses a fixed viewport overlay from `src/app.ts` with icon-only close/download controls. Keep image/video taps wired through `data-action="open-media-viewer"` and preserve `.shell-content` scroll when opening or closing that overlay.
- Pull-to-refresh now lives on `.shell-content` in `src/app.ts` and only arms when Home is at scroll-top with no overlay open. Keep the gesture tied to the feed scroller so the bottom nav stays fixed.
- Like/recast no longer need a full shell rerender; `src/app.ts` now patches those button counts/states in place. If those actions start jumping the feed again, inspect `toggleFeedInteraction()` and `syncFeedInteractionUi()` before touching broader render logic.
- Cast overflow actions mix network and local behavior in `src/app.ts`: an owned network cast is removed with a signed `CastRemove`, while local-only removal, mute, and block remain Hypecast-local moderation controls.
- Shared cast routing now lives in `src/services/routes.ts` and `src/app.ts`. Keep copied links query-based (`?cast=...&fid=...`) so they work on GitHub Pages, and use the route-resolution token guard so stale async cast lookups cannot clear a newer routed cast.
- Hypecast publishes casts, replies, likes/recasts, profile fields, and owned-cast deletion through `src/services/farcaster-signer.ts` when local signing is unlocked. The first write opens custody import/account creation; `src/services/neynar.ts` remains the hosted fallback.
- A `signer_uuid` is paired with the Neynar API key that created it. If write auth behaves inconsistently, inspect `hypecast:neynar-client-id`, `hypecast:neynar-api-key`, and `hypecast:farcaster-write-session` together instead of changing just one value.
- Feed action counts still patch locally after successful writes so the shell updates immediately, but the old purely local reaction state was migrated away by clearing `hypecast:feed-interactions` once under the `hypecast:feed-interactions-v2-migrated` flag.
- Playwright now runs against both `mobile-chromium` and `desktop-chromium`. If layout changes are viewport-specific, keep assertions for both form factors green.
- A quick way to sanity-check SVG brand assets locally is Chromium headless screenshot output, e.g. `/snap/bin/chromium --headless --disable-gpu --screenshot=./preview.png file:///.../public/logo.svg`.
- October 2026 dependency review: Vitest 5.0.4 works with the existing Vite 7 stack under Node 22; a clean install, all 61 unit tests, typecheck, PWA build, and 55 of 56 Playwright cases (one existing mobile-only skip) passed after a narrow npm audit fix. This kept the installed Farcaster, XMTP, viem, HLS, and PWA versions unchanged. Local Ubuntu 26.04 is not recognized by the pinned Playwright 1.59, so install its official Chromium 1217 build and run E2E with `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` plus a dedicated `PLAYWRIGHT_BROWSERS_PATH`. Live npm audit fell from ten package findings (two critical) to two high. Both remaining findings arise from `@farcaster/core@0.20.0` pulling `@faker-js/faker@7.6.0`; npm proposes downgrading Farcaster core to 0.15.3, not a compatible patch. Do not force an override or call the runtime chain fixed without real custody/signing and Farcaster integration proof. The Pages workflow only builds on main/manual; keep this candidate as a draft PR and do not push directly to main during dependency review.

## Rapport & Reflection

- The collaborator prefers direct progress over long planning.
- The collaborator wants each completed task committed and pushed to the remote instead of leaving local-only work behind.
- The collaborator also wants post-push deploy status checked every time instead of assuming GitHub Pages succeeded.
- The collaborator does not want fake “saved in Hypecast only” success states for Farcaster actions; missing requirements should be collected when the action is attempted.
- Product direction so far: PWA first, mobile-friendly, accessible on web, wallet-native, Farcaster-integrated, XMTP-capable.
- Keep responses concise and execution-oriented.
- Update this file when collaborator preferences or product direction become clearer.

## Cloudflare static hosting

Native main builds use the original generator plus build:cloudflare postprocessing.
Run the existing meaningful tests/typecheck and npm run check:deploy. Pages/source
recovery remains; credentials stay in Cloudflare and previews stay off. Local saves,
service-worker paths and integration behavior are not changed by hosting.
