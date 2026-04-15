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

Hypecast is a PWA-first Farcaster client scaffold built with vanilla TypeScript, Vite, and a static HTML entrypoint. It also includes wallet-native identity, Farcaster auth, and XMTP browser client integration.

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
- `npm run test:e2e` runs the Playwright suite against a local Vite server on `127.0.0.1:4173`.
- After every push to `main`, check the latest `deploy-pages.yml` run and wait for it to finish with `gh run watch <run-id> --exit-status`.
- Install the Playwright browser runtime with `npx playwright install chromium` after adding or refreshing the dependency.

## Project Structure

- `index.html`: single static entrypoint
- `src/main.ts`: app bootstrap and PWA service worker registration
- `src/app.ts`: top-level DOM rendering and interaction/state wiring
- `src/config.ts`: runtime config parsing for RPC and XMTP environment
- `src/services/feed.ts`: loads the committed Farcaster feed snapshot from same-origin app assets
- `src/test-support.ts`: browser-only test seam for Playwright mocks of standalone mode, wallet, Farcaster, and XMTP
- `src/services/wallet.ts`: injected EVM wallet connection
- `src/services/farcaster.ts`: Farcaster auth channel creation, QR generation, and verification
- `src/services/xmtp.ts`: XMTP browser client bootstrap
- `src/styles.css`: global styles and responsive layout
- `scripts/sync-farcaster-feed.mjs`: refreshes `public/farcaster-feed.json` from public Farcaster SSR profile pages
- `public/farcaster-feed.json`: committed same-origin snapshot used by the home feed in production
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
- Search, draft composer state, locally published casts, and the persisted Farcaster profile currently live in `src/app.ts` via `localStorage`. If you change those flows, update the storage behavior and the E2E coverage together.
- Keep the bottom nav outside the `.shell-content` scroll container. The intended behavior is a pinned shell footer while only the feed/pane content scrolls.
- Keep the Home timeline free of synthetic placeholder cards. Account/status controls belong in panes or overlays; the feed itself should start with real snapshot or local casts.

## Dependencies That Matter

- `vite@^7.3.2`
- `vite-plugin-pwa@^1.2.0`
- `typescript@^6.0.2`
- `viem@^2.47.18`
- `@farcaster/auth-client@^0.7.1`
- `@xmtp/browser-sdk@^7.0.0`
- `qrcode@^1.5.4`

## Known Issues & Solutions

- `vite-plugin-pwa@1.2.0` does not accept Vite 8. The project is pinned to Vite 7 for compatibility.
- The XMTP browser SDK emits a large `.wasm` asset. The PWA build excludes `*.wasm` from precache and caches it at runtime instead. If Pages builds start failing with Workbox size-limit errors, inspect `vite.config.ts` before changing anything else.
- XMTP browser storage uses OPFS. Multiple tabs using the same app instance can conflict.
- Farcaster auth via the public relay works best when the app is reachable from the signing device. On local dev, use `--host 0.0.0.0` or a tunnel if mobile sign-in is failing.
- The XMTP SDK typings currently require a small adapter/cast when creating the client with a custom backend. Be careful upgrading that package, because the runtime behavior and the exported TypeScript shapes are not perfectly aligned.
- The browser app cannot fetch `https://ssr.farcaster.xyz/*` directly because of cross-origin restrictions. If the home feed needs fresher real data, update the committed snapshot with `npm run sync:feed` instead of wiring runtime fetches to SSR pages.
- If the bottom nav drifts below the fold again, inspect `html`, `body`, `#app`, `.app-shell`, and `.phone-shell` first. The shell depends on viewport-locked `100dvh` sizing plus `body { overflow: hidden; }`.
- Keep `.bottom-nav` sticky with `bottom: 0` and `margin-top: auto` so it stays anchored to the phone shell edge while only `.shell-content` scrolls.

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
- The Playwright config targets a mobile Chromium profile and blocks service workers to keep the shell tests deterministic.
- The app rerenders the shell from `root.innerHTML`, so any live text inputs added to overlays need explicit focus restoration after render, or typing/search will break.
- Playwright defaults now include a mocked feed snapshot; if you change timeline tabs or feed copy, update `tests/feed-fixture.ts` and the corresponding E2E assertions together.
- The profile/account overlay now owns the Farcaster QR and deep-link handoff. If you change the auth flow, keep that overlay scrollable on mobile so the close button and QR stay reachable.
- If you learn a new repo-specific command, deployment quirk, or SDK hazard, add it here before finishing the task.
- Runtime feed loading now attempts live Farcaster SSR profile data via CORS-friendly mirrors (`allorigins`, `r.jina.ai`) before falling back to the committed snapshot; successful responses are cached in `localStorage` under `hypecast:feed-snapshot` for a short TTL.

## Rapport & Reflection

- The collaborator prefers direct progress over long planning.
- The collaborator wants each completed task committed and pushed to the remote instead of leaving local-only work behind.
- The collaborator also wants post-push deploy status checked every time instead of assuming GitHub Pages succeeded.
- Product direction so far: PWA first, mobile-friendly, accessible on web, wallet-native, Farcaster-integrated, XMTP-capable.
- Keep responses concise and execution-oriented.
- Update this file when collaborator preferences or product direction become clearer.
