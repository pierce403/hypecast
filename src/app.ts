import { APP_CONFIG } from "./config";
import {
  createChannelQrCode,
  createFarcasterChannel,
  waitForFarcasterProfile
} from "./services/farcaster";
import { connectWallet, shortAddress, type WalletSession } from "./services/wallet";
import { connectXmtp } from "./services/xmtp";
import type { AppState, BeforeInstallPromptEvent, XmtpState } from "./types";

const signalItems = [
  {
    label: "PWA shell",
    detail: "Installable, cached, and tuned for home-screen entry instead of tab sprawl."
  },
  {
    label: "Wallet-native identity",
    detail: "Injected EVM wallet support is live, ready to anchor auth and signing flows."
  },
  {
    label: "Farcaster auth",
    detail: "Sign In With Farcaster runs through the official relay flow with QR handoff."
  },
  {
    label: "XMTP seam",
    detail: "The client boundary is present so inbox, conversations, and notifications can slot in cleanly."
  }
] as const;

function getInitialState(): AppState {
  const inStandaloneMode =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  return {
    installPrompt: null,
    pwaInstalled: inStandaloneMode,
    wallet: {
      status: "idle"
    },
    farcaster: {
      status: "idle"
    },
    xmtp: {
      status: "idle"
    }
  };
}

function describeWallet(state: AppState["wallet"]): string {
  if (state.status === "connected" && state.address) {
    return `${shortAddress(state.address)} on ${state.chainName}`;
  }

  if (state.status === "connecting") {
    return "Waiting for wallet approval.";
  }

  if (state.status === "error") {
    return state.error ?? "Wallet connection failed.";
  }

  return "No wallet session yet.";
}

function describeFarcaster(state: AppState["farcaster"]): string {
  if (state.status === "connected" && state.profile) {
    const label = state.profile.displayName ?? state.profile.username ?? `fid ${state.profile.fid}`;
    return `${label} is ready on Hypecast.`;
  }

  if (state.status === "creating") {
    return "Creating a Farcaster relay channel.";
  }

  if (state.status === "pending") {
    return "Scan the QR code or open the deep link from your Farcaster wallet.";
  }

  if (state.status === "error") {
    return state.error ?? "Farcaster sign-in failed.";
  }

  return "No Farcaster identity attached yet.";
}

function describeXmtp(state: XmtpState): string {
  if (state.status === "connected" && state.inboxId) {
    return `XMTP inbox ${state.inboxId.slice(0, 12)}... is live.`;
  }

  if (state.status === "connecting") {
    return "Requesting XMTP signatures and initializing secure storage.";
  }

  if (state.status === "error") {
    return state.error ?? "XMTP initialization failed.";
  }

  return "Messaging has not been initialized yet.";
}

function renderInstallButton(state: AppState): string {
  if (state.pwaInstalled) {
    return `<button class="secondary-button" type="button" disabled>Installed</button>`;
  }

  return `<button class="primary-button" type="button" data-action="install"${
    state.installPrompt ? "" : " disabled"
  }>Install App</button>`;
}

function renderProfile(state: AppState): string {
  if (!state.farcaster.profile) {
    return `<p class="support-copy">Sign in to bind a Farcaster identity to the local shell.</p>`;
  }

  const profile = state.farcaster.profile;

  return `
    <div class="identity-block">
      ${
        profile.pfpUrl
          ? `<img class="avatar" src="${profile.pfpUrl}" alt="${profile.displayName ?? profile.username ?? "Farcaster profile"}" />`
          : `<div class="avatar avatar-fallback">${(profile.displayName ?? profile.username ?? "H").slice(0, 1)}</div>`
      }
      <div>
        <strong>${profile.displayName ?? "Unnamed caster"}</strong>
        <p>@${profile.username ?? `fid-${profile.fid}`}</p>
        <p>FID ${profile.fid}</p>
      </div>
    </div>
    <p class="support-copy">${profile.bio ?? "Profile metadata is available and ready for feed personalization."}</p>
  `;
}

function template(state: AppState): string {
  return `
    <div class="app-shell">
      <div class="glow glow-left"></div>
      <div class="glow glow-right"></div>
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">PWA-first Farcaster client</p>
          <h1>Hypecast</h1>
          <p class="lede">
            An installable social shell for Farcaster identity, wallet-native presence,
            and XMTP messaging. Built to feel at home on mobile before anything else.
          </p>
          <div class="hero-actions">
            ${renderInstallButton(state)}
            <a class="ghost-link" href="#launchpad">Open Launchpad</a>
          </div>
        </div>
        <div class="hero-panel">
          <div class="metric">
            <span>Wallet</span>
            <strong>${state.wallet.status === "connected" ? "Ready" : "Offline"}</strong>
          </div>
          <div class="metric">
            <span>Farcaster</span>
            <strong>${state.farcaster.status === "connected" ? "Bound" : "Waiting"}</strong>
          </div>
          <div class="metric">
            <span>XMTP</span>
            <strong>${state.xmtp.status === "connected" ? "Linked" : "Dormant"}</strong>
          </div>
          <p class="support-copy">
            Optimism RPC: <code>${APP_CONFIG.optimismRpcUrl}</code>
          </p>
        </div>
      </header>

      <main id="launchpad" class="dashboard">
        <section class="panel">
          <div class="panel-head">
            <span class="status-pill">${state.wallet.status}</span>
            <h2>Wallet Deck</h2>
          </div>
          <p class="support-copy">${describeWallet(state.wallet)}</p>
          <button class="primary-button" type="button" data-action="wallet">
            ${state.wallet.status === "connected" ? "Reconnect Wallet" : "Connect Wallet"}
          </button>
          <div class="meta-grid">
            <div>
              <span class="meta-label">Account</span>
              <strong>${state.wallet.address ? shortAddress(state.wallet.address) : "Not connected"}</strong>
            </div>
            <div>
              <span class="meta-label">Network</span>
              <strong>${state.wallet.chainName ?? "Unknown"}</strong>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <span class="status-pill">${state.farcaster.status}</span>
            <h2>Farcaster Passport</h2>
          </div>
          <p class="support-copy">${describeFarcaster(state.farcaster)}</p>
          <button class="primary-button" type="button" data-action="farcaster">
            ${
              state.farcaster.status === "connected"
                ? "Refresh Farcaster Session"
                : "Sign In With Farcaster"
            }
          </button>
          ${
            state.farcaster.qrCodeDataUrl
              ? `
                <div class="qr-card">
                  <img src="${state.farcaster.qrCodeDataUrl}" alt="Farcaster sign-in QR code" />
                  <a class="ghost-link inline-link" href="${state.farcaster.channelUrl}" target="_blank" rel="noreferrer">
                    Open on mobile
                  </a>
                </div>
              `
              : ""
          }
          ${renderProfile(state)}
        </section>

        <section class="panel">
          <div class="panel-head">
            <span class="status-pill">${state.xmtp.status}</span>
            <h2>XMTP Relay</h2>
          </div>
          <p class="support-copy">${describeXmtp(state.xmtp)}</p>
          <button
            class="primary-button"
            type="button"
            data-action="xmtp"
            ${state.wallet.status !== "connected" ? "disabled" : ""}
          >
            ${state.xmtp.status === "connected" ? "Reinitialize XMTP" : "Initialize XMTP"}
          </button>
          <div class="meta-grid">
            <div>
              <span class="meta-label">Environment</span>
              <strong>${APP_CONFIG.xmtpEnv}</strong>
            </div>
            <div>
              <span class="meta-label">Inbox</span>
              <strong>${state.xmtp.inboxId ?? "Not created"}</strong>
            </div>
          </div>
          <p class="support-copy subtle">
            XMTP browser clients use OPFS storage. Keep one active Hypecast tab per profile to avoid local DB contention.
          </p>
        </section>

        <section class="panel panel-wide">
          <div class="panel-head">
            <span class="status-pill">blueprint</span>
            <h2>Pulse Board</h2>
          </div>
          <div class="signal-grid">
            ${signalItems
              .map(
                (item) => `
                  <article class="signal-card">
                    <h3>${item.label}</h3>
                    <p>${item.detail}</p>
                  </article>
                `
              )
              .join("")}
          </div>
        </section>
      </main>
    </div>
  `;
}

export function createApp(root: HTMLDivElement): void {
  const state = getInitialState();
  let walletSession: WalletSession | null = null;
  let xmtpSession: Awaited<ReturnType<typeof connectXmtp>> | null = null;

  const render = () => {
    root.innerHTML = template(state);

    root
      .querySelector<HTMLButtonElement>('[data-action="install"]')
      ?.addEventListener("click", handleInstall);
    root
      .querySelector<HTMLButtonElement>('[data-action="wallet"]')
      ?.addEventListener("click", handleWalletConnect);
    root
      .querySelector<HTMLButtonElement>('[data-action="farcaster"]')
      ?.addEventListener("click", handleFarcasterConnect);
    root
      .querySelector<HTMLButtonElement>('[data-action="xmtp"]')
      ?.addEventListener("click", handleXmtpConnect);
  };

  const setPartialState = (patch: Partial<AppState>) => {
    Object.assign(state, patch);
    render();
  };

  const handleInstall = async () => {
    if (!state.installPrompt) {
      return;
    }

    await state.installPrompt.prompt();
    const choice = await state.installPrompt.userChoice;

    state.installPrompt = null;
    state.pwaInstalled = choice.outcome === "accepted" || state.pwaInstalled;
    render();
  };

  const handleWalletConnect = async () => {
    setPartialState({
      wallet: {
        status: "connecting"
      }
    });

    try {
      xmtpSession?.client.close();
      xmtpSession = null;
      walletSession = await connectWallet();
      setPartialState({
        wallet: {
          status: "connected",
          address: walletSession.address,
          chainId: walletSession.chainId,
          chainName: walletSession.chainName
        },
        xmtp: {
          status: "idle"
        }
      });
    } catch (error) {
      setPartialState({
        wallet: {
          status: "error",
          error: error instanceof Error ? error.message : "Wallet connection failed."
        }
      });
    }
  };

  const handleFarcasterConnect = async () => {
    const domain = window.location.hostname || "localhost";
    const siweUri = new URL("/auth/farcaster", window.location.origin).toString();

    setPartialState({
      farcaster: {
        status: "creating"
      }
    });

    try {
      const channel = await createFarcasterChannel({ domain, siweUri });
      const qrCodeDataUrl = await createChannelQrCode(channel.url);

      setPartialState({
        farcaster: {
          status: "pending",
          channelUrl: channel.url,
          qrCodeDataUrl
        }
      });

      const profile = await waitForFarcasterProfile({
        channelToken: channel.channelToken,
        domain,
        nonce: channel.nonce,
        onPoll: () => {
          if (state.farcaster.status !== "connected") {
            setPartialState({
              farcaster: {
                status: "pending",
                channelUrl: channel.url,
                qrCodeDataUrl
              }
            });
          }
        }
      });

      setPartialState({
        farcaster: {
          status: "connected",
          channelUrl: channel.url,
          qrCodeDataUrl,
          profile
        }
      });
    } catch (error) {
      setPartialState({
        farcaster: {
          status: "error",
          error:
            error instanceof Error ? error.message : "Farcaster sign-in could not be completed."
        }
      });
    }
  };

  const handleXmtpConnect = async () => {
    if (!walletSession) {
      setPartialState({
        xmtp: {
          status: "error",
          error: "Connect a wallet before initializing XMTP."
        }
      });
      return;
    }

    setPartialState({
      xmtp: {
        status: "connecting"
      }
    });

    try {
      xmtpSession?.client.close();
      xmtpSession = await connectXmtp(walletSession, walletSession.address);
      setPartialState({
        xmtp: {
          status: "connected",
          inboxId: xmtpSession.inboxId,
          accountIdentifier: xmtpSession.accountIdentifier
        }
      });
    } catch (error) {
      setPartialState({
        xmtp: {
          status: "error",
          error: error instanceof Error ? error.message : "XMTP initialization failed."
        }
      });
    }
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();

    state.installPrompt = event as BeforeInstallPromptEvent;
    render();
  });

  window.addEventListener("appinstalled", () => {
    state.pwaInstalled = true;
    state.installPrompt = null;
    render();
  });

  window.addEventListener("beforeunload", () => {
    xmtpSession?.client.close();
  });

  render();
}
