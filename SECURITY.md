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
- XMTP browser storage and derived inbox/account identifiers
- Local drafts, local casts, cached feed snapshots, and Neynar key overrides stored in the browser

### Trust Boundaries

- The browser and device running Hypecast
- The injected wallet provider
- Farcaster auth relay infrastructure used during SIWF
- Neynar's API when loading personalized following feeds
- XMTP's browser SDK, storage, and network
- GitHub Pages as the static asset host

### Current Controls

- Untrusted text is escaped before insertion into `innerHTML`
- Remote `href` and `src` values are protocol-allowlisted before rendering
- External links use `rel="noreferrer"`
- The app ships a restrictive meta `Content-Security-Policy` and `Referrer-Policy`
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
- OPFS / browser-managed storage
  - XMTP client data

### Known Limitations

- The built-in Neynar client key is client-visible by design. It is not a secret-management solution.
- GitHub Pages cannot set full response headers for every hardening control, so CSP is currently enforced through a meta tag.
- If the browser, device, wallet extension, or operating system is compromised, Hypecast cannot protect the user from that compromise.
- Browser-local storage is user-accessible on the device. It must not be treated as secure secret storage.
- Hypecast does not ask for or need seed phrases or private keys. Any flow requesting them is unsafe.

### Safe Usage Guidance

- Use a test wallet when evaluating new wallet or XMTP flows
- Keep the browser, wallet extension, and operating system updated
- Do not paste seed phrases, private keys, or wallet recovery material into Hypecast
- Treat browser-local Neynar overrides as convenience configuration, not protected credentials

## Scope Notes

Security issues in upstream dependencies, Farcaster infrastructure, wallet providers, Neynar, XMTP, or the user's device/browser may still affect Hypecast. Report them if they have a concrete impact on Hypecast users, but fixes may require upstream remediation rather than a repository-only change.
