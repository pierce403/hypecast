# Hypecast

Hypecast is a PWA-first Farcaster client built with vanilla TypeScript, Vite, and static HTML. It includes:

- An installable app shell with offline caching
- Injected-wallet connection for EVM wallets
- Sign In With Farcaster via the official Farcaster auth client
- Local Farcaster account access from a 12/24-word BIP-39 phrase, 32-byte custody key, or Hypecast/Maelstrom JSON backup
- New FID creation through Farcaster's IdGateway on Optimism mainnet
- A real personalized following feed path keyed off the signed-in user's `fid`
- Directly signed casts, replies, likes, recasts, profile updates, and cast deletion, with hosted Neynar signing as an optional fallback
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

- `VITE_OPTIMISM_RPC_URL`: Optimism RPC used for Farcaster auth verification, account inspection, and IdGateway registration
- `VITE_XMTP_ENV`: XMTP network environment, defaults to `production`
- `VITE_NEYNAR_API_KEY`: Optional override for the app's built-in Neynar client key
- `VITE_NEYNAR_CLIENT_ID`: Optional Neynar client ID for built-in Farcaster write access

## Notes

- Farcaster sign-in uses the public relay and works best when the dev server is reachable on the same device or via a tunnel. It remains a read-only alternative to local custody-key access.
- Existing accounts can be imported from a 12- or 24-word BIP-39 recovery phrase, a 32-byte secp256k1 custody private key, or JSON containing `seedPhrase`, `mnemonic`, `custodyPrivateKey`, or `privateKey`. The import field is cleared immediately after parsing, and the raw custody secret remains in memory only while the account sheet is active; it is never written to `localStorage`.
- Hypecast uses the custody key to unlock or authorize a scoped Ed25519 app signer. The signer seed is stored in an AES-GCM-encrypted browser vault whose key is derived from the custody key with HKDF-SHA-256, so reload, backgrounding, or 15 minutes of inactivity locks signing and requires the custody secret again.
- New-account setup generates a custody phrase, reads the live IdGateway price and native ETH balance on Optimism, shows the funding target, requires explicit plaintext-backup confirmation, submits `IdGateway.register`, waits for a successful receipt, and verifies the resulting FID before authorizing the app signer. The confirmed transaction hash is carried into immediate signer authorization while Snapchain catches up. Registration never starts automatically.
- Direct messages are submitted through the configured Neynar Snapchain endpoint when a key is available, with the public Haatz gateway as a fallback. An HTTP success means the gateway accepted the submission; exact message-hash readback is best-effort and may temporarily remain pending while the network propagates it.
- XMTP browser clients rely on OPFS-backed storage, so multiple tabs using the same app instance can conflict.
- The UI is intentionally modular: wallet, Farcaster, and XMTP each live behind dedicated service adapters in `src/services`.
- The home feed falls back to a committed public snapshot because the browser cannot fetch Farcaster SSR pages directly cross-origin. Refresh that snapshot with `npm run sync:feed` when you want newer public feed content.
- To load your own following feed, sign in with Farcaster. Hypecast now ships with a working built-in Neynar key and requests Neynar's following feed for your saved `fid` directly from the browser.
- The account sheet still accepts a browser-local Neynar override if you want to swap keys without rebuilding the app. If you save one, it is stored in `localStorage` on your device.
- Hosted Neynar write access remains available as an optional fallback. If you use your own Neynar app, the client ID and API key must come from the same app, and that app must authorize `https://hypecast.net` as an origin.
- Because production is still a static GitHub Pages app, the long-term fix for secret management is still adding a backend or proxy for feed requests.
- Untrusted remote URLs are allowlisted before they are rendered into `href` or `src`, and the repo now includes unit coverage for that policy plus feed preview selection.
- Custody downloads and copied backups are plaintext by design; move them to secure offline storage and clear the clipboard. Deleting the encrypted local signer vault does not revoke that signer on Farcaster. A newly registered FID also has no username until one is claimed through a separate Farcaster username flow.

## Security

- See [SECURITY.md](SECURITY.md) for the reporting process, supported versions, and the current client-side security model.
- `npm run test:unit` covers the shared security helpers and feed media normalization logic.

## Deployment

- Production deploys from `main` through `.github/workflows/deploy-pages.yml`.
- GitHub Pages should stay on the `workflow` build type with the custom domain set to `hypecast.net`.
- The workflow uploads the Vite `dist/` output as the Pages artifact and deploys it to the `github-pages` environment.
