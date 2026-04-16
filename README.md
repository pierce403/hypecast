# Hypecast

Hypecast is a PWA-first Farcaster client scaffold built with vanilla TypeScript, Vite, and static HTML. The first slice includes:

- An installable app shell with offline caching
- Injected-wallet connection for EVM wallets
- Sign In With Farcaster via the official Farcaster auth client
- A real personalized following feed path keyed off the signed-in user's `fid`
- On-demand Farcaster write access for posts, replies, likes, and recasts through Neynar
- A responsive shell that stays mobile-native on phones and framed/centered on desktop
- An XMTP integration seam ready for a live browser client bootstrap

## Run it

```bash
npm install
npm run dev
npm run sync:feed
npm run test:unit
```

`npm run sync:feed` refreshes `public/farcaster-feed.json` from public Farcaster SSR profile pages so the home feed ships with real data on the same origin.

## Environment

Copy `.env.example` to `.env` if you need custom settings.

- `VITE_OPTIMISM_RPC_URL`: Optimism RPC used by Farcaster auth verification
- `VITE_XMTP_ENV`: XMTP network environment, defaults to `production`
- `VITE_NEYNAR_API_KEY`: Optional override for the app's built-in Neynar client key
- `VITE_NEYNAR_CLIENT_ID`: Optional Neynar client ID for built-in Farcaster write access

## Notes

- Farcaster sign-in uses the public relay and works best when the dev server is reachable on the same device or via a tunnel.
- XMTP browser clients rely on OPFS-backed storage, so multiple tabs using the same app instance can conflict.
- The UI is intentionally modular: wallet, Farcaster, and XMTP each live behind dedicated service adapters in `src/services`.
- The home feed falls back to a committed public snapshot because the browser cannot fetch Farcaster SSR pages directly cross-origin. Refresh that snapshot with `npm run sync:feed` when you want newer public feed content.
- To load your own following feed, sign in with Farcaster. Hypecast now ships with a working built-in Neynar key and requests Neynar's following feed for your saved `fid` directly from the browser.
- The account sheet still accepts a browser-local Neynar override if you want to swap keys without rebuilding the app. If you save one, it is stored in `localStorage` on your device.
- Post, reply, like, and recast actions now request real Farcaster write access when needed. If you use your own Neynar app, the client ID and API key must come from the same Neynar app, and that app must authorize `https://hypecast.net` as an origin.
- Because production is still a static GitHub Pages app, the long-term fix for secret management is still adding a backend or proxy for feed requests.
- Untrusted remote URLs are allowlisted before they are rendered into `href` or `src`, and the repo now includes unit coverage for that policy plus feed preview selection.

## Security

- See [SECURITY.md](SECURITY.md) for the reporting process, supported versions, and the current client-side security model.
- `npm run test:unit` covers the shared security helpers and feed media normalization logic.

## Deployment

- Production deploys from `main` through `.github/workflows/deploy-pages.yml`.
- GitHub Pages should stay on the `workflow` build type with the custom domain set to `hypecast.net`.
- The workflow uploads the Vite `dist/` output as the Pages artifact and deploys it to the `github-pages` environment.
