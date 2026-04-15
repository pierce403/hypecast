# Hypecast - Features

## Features

### Installable PWA Shell
- **Stability**: stable
- **Description**: The app ships as a static, installable web client with service-worker-backed caching and GitHub Pages deployment.
- **Properties**:
  - Vite PWA generates a manifest and service worker during `npm run build`
  - The UI responds to `beforeinstallprompt` and `appinstalled`
  - Pages deploys the built `dist/` artifact from the workflow on `main`
- **Test Criteria**:
  - [x] `npm run build` completes and emits PWA assets
  - [x] Browsers that expose `beforeinstallprompt` can surface an install action in the UI
  - [x] Standalone launches are detected and reflected in app state

### Logged-In Mobile Feed Shell
- **Stability**: in-progress
- **Description**: The signed-in app surface now mirrors a Farcaster-like mobile layout with avatar, top search affordance, bottom navigation, and floating composer placement.
- **Properties**:
  - Home view renders a phone-first feed shell instead of a launchpad dashboard
  - Bottom navigation exposes home, apps, wallet, notifications, and chat surfaces
  - Search and composer affordances open in-app overlays that reserve the intended interaction pattern
- **Test Criteria**:
  - [x] Logged-in and signed-out states both render inside the same mobile shell
  - [x] Avatar, search, bottom nav, and floating compose button stay visible on mobile
  - [ ] Live Farcaster timeline data hydrates the feed instead of local scaffold content

### Farcaster Sign-In And Profile Binding
- **Stability**: in-progress
- **Description**: Users can authenticate through the Farcaster relay flow, bind profile metadata into the client shell, and restore that profile after reloads.
- **Properties**:
  - Relay channels are created through `@farcaster/auth-client`
  - QR and deep-link handoff support mobile completion
  - Verified profile metadata populates the signed-in shell after successful auth
- **Test Criteria**:
  - [x] Sign-in channel creation succeeds with a reachable app origin
  - [x] QR code and deep link are rendered while the session is pending
  - [x] Session state persists across reloads

### Injected Wallet Connection
- **Stability**: in-progress
- **Description**: The app can connect to an injected EVM wallet and expose account plus chain metadata to the shell.
- **Properties**:
  - Uses the injected provider on `window.ethereum`
  - Requests accounts with `eth_requestAccounts`
  - Displays address and chain label after a successful connection
- **Test Criteria**:
  - [x] Wallet connection requests account access from an injected provider
  - [x] Connected address is shown in the UI
  - [ ] Chain switching and unsupported-network handling are implemented

### XMTP Browser Bootstrap
- **Stability**: in-progress
- **Description**: The client can initialize an XMTP browser session from a connected wallet and expose inbox identity details.
- **Properties**:
  - XMTP client creation runs in-browser with the configured backend environment
  - Inbox ID and account identifier are captured after initialization
  - The shell preserves the OPFS storage caveat and encourages one active profile per browser context
- **Test Criteria**:
  - [x] XMTP initialization requires a connected wallet
  - [x] Successful bootstrap exposes inbox metadata in the UI
  - [ ] Conversation list and message sync are implemented

### Search And Discovery
- **Stability**: in-progress
- **Description**: Search now works as a local-first discovery layer for channels, casts, profiles, and shell surfaces, with room for live Farcaster discovery later.
- **Properties**:
  - Query input searches local users, channels, casts, and primary shell panes
  - Results can navigate directly into timelines, panes, and the profile sheet
  - Search state remains usable on mobile without breaking the bottom rail
- **Test Criteria**:
  - [x] Search input accepts live queries
  - [x] Query results render with user and cast matches
  - [x] Selecting a result updates the active view

### Cast Composer And Publishing
- **Stability**: in-progress
- **Description**: The floating compose action now supports local drafts and signed-in local publishing inside the shell, while network cast publishing remains a future step.
- **Properties**:
  - Composer opens as an in-app sheet from the floating action button
  - Draft state survives accidental sheet closes and page reloads on the same device
  - Signed-in publishing posts a local cast into the feed using the authenticated Farcaster profile
- **Test Criteria**:
  - [x] Compose button placement is present in the shell
  - [x] Draft text can be entered and preserved locally
  - [x] Authenticated users can publish a cast successfully

### Notifications And Chat Delivery
- **Stability**: planned
- **Description**: The notifications and chat rails should evolve from status placeholders into live Farcaster and XMTP activity surfaces.
- **Properties**:
  - Notifications reflect account-specific activity instead of local status summaries
  - Chat shows XMTP conversations and unread state
  - Badge counts derive from real data
- **Test Criteria**:
  - [ ] Notification list is populated from live account activity
  - [ ] Chat rail renders a conversation list
  - [ ] Unread badges update from live notification or XMTP state
