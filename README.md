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
```

## Environment

Copy `.env.example` to `.env` if you need custom settings.

- `VITE_OPTIMISM_RPC_URL`: Optimism RPC used by Farcaster auth verification
- `VITE_XMTP_ENV`: XMTP network environment, defaults to `production`

## Notes

- Farcaster sign-in uses the public relay and works best when the dev server is reachable on the same device or via a tunnel.
- XMTP browser clients rely on OPFS-backed storage, so multiple tabs using the same app instance can conflict.
- The UI is intentionally modular: wallet, Farcaster, and XMTP each live behind dedicated service adapters in `src/services`.
