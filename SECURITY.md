# Security Policy

## Supported Versions

Hypecast is a single actively deployed static client. Security fixes are only guaranteed for the latest `main` branch and the current production deployment at `https://hypecast.net/`.

| Version | Supported |
| --- | --- |
| `main` / latest production deploy | Yes |
| Older commits, branches, or forks | No |

## Reporting a Vulnerability

Do not open a public GitHub issue for a suspected vulnerability.

Report security issues through GitHub's private vulnerability reporting flow for this repository if it is enabled. If private reporting is unavailable, contact the maintainer directly with:

- A short description of the issue and why it matters
- Reproduction steps or a proof of concept
- The affected URL, browser, wallet, and commit SHA if known
- Whether the issue requires a signed-in Farcaster profile, wallet, or XMTP session

Target response expectations:

- Initial acknowledgement within 3 business days
- Triage and severity assessment as soon as the issue is reproducible
- Coordinated disclosure after a fix is available or a mitigation is documented

## Security Model

Hypecast is a static GitHub Pages application. There is no Hypecast-owned application server, database, or server-side session layer today. The browser is the execution environment and primary trust boundary.

### Assets Worth Protecting

- Wallet connection state and chain/account metadata
- Farcaster sign-in state, relay channel URLs, and bound profile metadata
- Farcaster custody recovery phrases and private keys while an account sheet is active
- The decrypted Ed25519 app signer while signing is unlocked, plus its encrypted browser vault
- XMTP browser storage and derived inbox/account identifiers
- Local drafts, local casts, cached feed snapshots, and Neynar key overrides stored in the browser

### Trust Boundaries

- The browser and device running Hypecast
- The injected wallet provider
- Farcaster auth relay infrastructure used during SIWF
- The configured Optimism RPC and Farcaster IdGateway used for account inspection and registration
- Neynar's API when loading personalized following feeds or submitting signed messages
- The public Haatz Snapchain gateway used as a signer-state and message-submission fallback
- XMTP's browser SDK, storage, and network
- GitHub Pages as the static asset host

### Current Controls

- Untrusted text is escaped before insertion into `innerHTML`
- Remote `href` and `src` values are protocol-allowlisted before rendering
- External links use `rel="noreferrer"`
- The app ships a restrictive meta `Content-Security-Policy` and `Referrer-Policy`
- Imported custody material is held only in memory for the active account flow, the import control is cleared after parsing, and raw custody secrets are never persisted in `localStorage`
- The local Ed25519 app signer seed is encrypted with AES-GCM under an HKDF-SHA-256 key derived from the custody private key and must be unlocked by importing the custody secret again after reload
- Direct writes require the unlocked signer FID to match the visible Farcaster profile; switching identities locks mismatched local signing state
- Optimism registration requires a fresh IdGateway quote and balance check, explicit plaintext-backup confirmation, a successful transaction receipt, and FID readback
- Signed Farcaster submissions use bounded network calls and best-effort message readback; a successful submission can still show pending while propagation completes
- Unit tests cover URL sanitization and feed-preview normalization
- Playwright covers end-to-end shell flows and deployable UI behavior
- Every completed task should be pushed and the GitHub Pages deploy verified before considering it done

### Storage Model

- `localStorage`
  - Saved Farcaster profile
  - Composer draft
  - Locally published casts
  - Feed snapshot cache
  - Optional Neynar API key override
  - Encrypted Ed25519 signer seed, signer metadata, random salt, and IV; never the raw custody phrase or private key
- OPFS / browser-managed storage
  - XMTP client data

### Known Limitations

- The built-in Neynar client key is client-visible by design. It is not a secret-management solution.
- GitHub Pages cannot set full response headers for every hardening control, so CSP is currently enforced through a meta tag.
- If the browser, device, wallet extension, or operating system is compromised, Hypecast cannot protect the user from that compromise.
- Browser-local storage is user-accessible on the device. The signer seed is encrypted, but its vault metadata and ciphertext remain available to scripts running in the same origin.
- Hypecast's local-account flow deliberately accepts custody recovery phrases and private keys. The browser cannot provide hardware-wallet-grade isolation: malicious extensions, injected scripts, clipboard monitors, screenshots, or a compromised device can capture secrets while they are visible or in memory.
- Generated account downloads and clipboard exports are plaintext and fully control the Farcaster custody account. Hypecast cannot recover a lost backup.
- Locking clears the decrypted app signer from memory. Hypecast locks it on reload, page backgrounding, or 15 minutes of inactivity. Forgetting the encrypted local vault deletes only this browser's copy and does not revoke the already authorized signer from the Farcaster network.
- A successful IdGateway registration creates an FID, not a username. Username ownership must be claimed separately through a supported Farcaster username flow.
- Haatz is a public third-party fallback. Signed messages sent through any gateway disclose their public protocol contents and depend on that gateway for availability, while message readback remains best-effort.

### Safe Usage Guidance

- Use a test wallet or low-value account when evaluating wallet, Farcaster registration, or XMTP flows
- Keep the browser, wallet extension, and operating system updated
- Import custody secrets only on a trusted device at the expected Hypecast origin, and close or lock the account when finished
- Store generated plaintext backups offline, never share them, and clear the clipboard after copying one
- Treat local vault deletion as device cleanup, not signer revocation; revoke network-authorized signers separately when required
- Treat browser-local Neynar overrides as convenience configuration, not protected credentials

## Scope Notes

Security issues in upstream dependencies, Farcaster infrastructure, wallet providers, Neynar, XMTP, or the user's device/browser may still affect Hypecast. Report them if they have a concrete impact on Hypecast users, but fixes may require upstream remediation rather than a repository-only change.
