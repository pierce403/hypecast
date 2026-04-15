# Hypecast

Hypecast is a PWA-first Farcaster client scaffold built with vanilla TypeScript, Vite, and static HTML. The first slice includes:

- An installable app shell with offline caching
- Injected-wallet connection for EVM wallets
- Sign In With Farcaster via the official Farcaster auth client
- An XMTP integration seam ready for a live browser client bootstrap

## Run it

```bash
npm install
npm run dev
npm run sync:feed
```

`npm run sync:feed` refreshes `public/farcaster-feed.json` from public Farcaster SSR profile pages so the home feed ships with real data on the same origin.

## Environment

Copy `.env.example` to `.env` if you need custom settings.

- `VITE_OPTIMISM_RPC_URL`: Optimism RPC used by Farcaster auth verification
- `VITE_XMTP_ENV`: XMTP network environment, defaults to `production`

## Notes

- Farcaster sign-in uses the public relay and works best when the dev server is reachable on the same device or via a tunnel.
- XMTP browser clients rely on OPFS-backed storage, so multiple tabs using the same app instance can conflict.
- The UI is intentionally modular: wallet, Farcaster, and XMTP each live behind dedicated service adapters in `src/services`.
- The home feed does not hit Farcaster SSR pages directly at runtime because the browser cannot fetch them cross-origin. Refresh the committed snapshot with `npm run sync:feed` when you want newer real feed content.

## Deployment

- Production deploys from `main` through `.github/workflows/deploy-pages.yml`.
- GitHub Pages should stay on the `workflow` build type with the custom domain set to `hypecast.net`.
- The workflow uploads the Vite `dist/` output as the Pages artifact and deploys it to the `github-pages` environment.
