import { APP_CONFIG } from "./config";
import {
  createChannelQrCode,
  createFarcasterChannel,
  waitForFarcasterProfile
} from "./services/farcaster";
import {
  clearStoredNeynarApiKey,
  getDefaultNeynarApiKey,
  getEffectiveNeynarApiKey,
  loadFeedSnapshot,
  loadStoredNeynarApiKey,
  saveStoredNeynarApiKey
} from "./services/feed";
import {
  escapeAttribute,
  escapeHtml,
  sanitizeImageUrl,
  sanitizeLinkUrl,
  sanitizeVideoUrl
} from "./services/security";
import { connectWallet, shortAddress, type WalletSession } from "./services/wallet";
import { connectXmtp } from "./services/xmtp";
import { getHypecastTestApi } from "./test-support";
import type {
  AppState,
  BeforeInstallPromptEvent,
  FarcasterProfile,
  FeedCast,
  FeedSnapshot,
  XmtpState
} from "./types";

declare const __HYPECAST_BUILD_ID__: string;
declare const __HYPECAST_BUILD_TIME__: string;

type NavPane = "home" | "apps" | "wallet" | "notifications" | "chat";
type TimelineTab = string;
type Overlay = "none" | "profile" | "search" | "composer" | "settings";
type IconName =
  | "apps"
  | "bell"
  | "chat"
  | "close"
  | "comment"
  | "compose"
  | "heart"
  | "home"
  | "more"
  | "refresh"
  | "search"
  | "share"
  | "sparkle"
  | "wallet";

interface SearchResult {
  id: string;
  kind: "timeline" | "pane" | "cast" | "profile";
  title: string;
  detail: string;
  timeline?: TimelineTab;
  nav?: NavPane;
  action?: Overlay;
}

interface UiState {
  activePane: NavPane;
  activeTimeline: TimelineTab;
  overlay: Overlay;
  searchQuery: string;
  composerDraft: string;
  localCasts: FeedCast[];
  feedInteractions: FeedInteractionMap;
  replyTargetCastId?: string;
}

interface FocusTarget {
  field: "search" | "composer";
  start?: number;
  end?: number;
}

interface PullToRefreshState {
  active: boolean;
  refreshing: boolean;
  shouldRefresh: boolean;
  distancePx: number;
  startY: number;
}

interface FeedInteractionState {
  liked?: boolean;
  recasted?: boolean;
}

type FeedInteractionMap = Record<string, FeedInteractionState>;

const STORAGE_KEYS = {
  farcasterProfile: "hypecast:farcaster-profile",
  composerDraft: "hypecast:composer-draft",
  localCasts: "hypecast:local-casts",
  feedInteractions: "hypecast:feed-interactions"
} as const;

const feedAggregateTab = {
  id: "following",
  label: "following"
} as const;

const navItems: Array<{ id: NavPane; label: string; icon: IconName }> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "apps", label: "Apps", icon: "apps" },
  { id: "wallet", label: "Wallet", icon: "wallet" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "chat", label: "Chat", icon: "chat" }
];

const PULL_REFRESH_THRESHOLD_PX = 88;
const PULL_REFRESH_MAX_PX = 132;
const PULL_REFRESH_HOLD_PX = 66;
const BUILD_INFO = {
  id: __HYPECAST_BUILD_ID__,
  time: __HYPECAST_BUILD_TIME__
} as const;


function loadStoredJson<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key);

    if (!value) {
      return null;
    }

    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function saveStoredJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

function removeStoredValue(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

function loadStoredProfile(): FarcasterProfile | undefined {
  const profile = loadStoredJson<FarcasterProfile>(STORAGE_KEYS.farcasterProfile);

  if (!profile || typeof profile.fid !== "number") {
    return undefined;
  }

  return profile;
}

function saveStoredProfile(profile?: FarcasterProfile): void {
  if (!profile) {
    removeStoredValue(STORAGE_KEYS.farcasterProfile);
    return;
  }

  saveStoredJson(STORAGE_KEYS.farcasterProfile, profile);
}

function loadStoredComposerDraft(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.composerDraft) ?? "";
  } catch {
    return "";
  }
}

function saveStoredComposerDraft(draft: string): void {
  if (!draft.trim()) {
    removeStoredValue(STORAGE_KEYS.composerDraft);
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEYS.composerDraft, draft);
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

function normalizeStoredMedia(value: unknown): FeedCast["media"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<NonNullable<FeedCast["media"]>>;

  if (
    (candidate.kind !== "image" && candidate.kind !== "video" && candidate.kind !== "link") ||
    typeof candidate.title !== "string" ||
    typeof candidate.description !== "string"
  ) {
    return undefined;
  }

  const safeSrc =
    typeof candidate.src === "string"
      ? candidate.kind === "video"
        ? sanitizeVideoUrl(candidate.src)
        : sanitizeImageUrl(candidate.src)
      : undefined;

  return {
    kind: candidate.kind,
    title: candidate.title,
    description: candidate.description,
    src: safeSrc,
    href: typeof candidate.href === "string" ? sanitizeLinkUrl(candidate.href) : undefined,
    posterSrc:
      typeof candidate.posterSrc === "string" ? sanitizeImageUrl(candidate.posterSrc) : undefined,
    alt: typeof candidate.alt === "string" ? candidate.alt : undefined,
    eyebrow: typeof candidate.eyebrow === "string" ? candidate.eyebrow : undefined,
    showDetails: typeof candidate.showDetails === "boolean" ? candidate.showDetails : undefined
  };
}

function normalizeStoredFeedInteractions(value: unknown): FeedInteractionMap {
  if (!value || typeof value !== "object") {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const interactions: FeedInteractionMap = {};

  Object.entries(candidate).forEach(([castId, interaction]) => {
    if (!interaction || typeof interaction !== "object") {
      return;
    }

    const nextInteraction = interaction as FeedInteractionState;
    const liked = nextInteraction.liked === true;
    const recasted = nextInteraction.recasted === true;

    if (!liked && !recasted) {
      return;
    }

    interactions[castId] = {
      liked,
      recasted
    };
  });

  return interactions;
}

function normalizeStoredCast(value: unknown): FeedCast | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (
    typeof candidate.id !== "string" ||
    typeof candidate.channel !== "string" ||
    typeof candidate.authorName !== "string" ||
    typeof candidate.authorInitial !== "string" ||
    typeof candidate.text !== "string"
  ) {
    return null;
  }

  const timestamp =
    typeof candidate.timestamp === "number"
      ? candidate.timestamp
      : typeof candidate.time === "string"
        ? Date.now()
        : Number.NaN;

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return {
    id: candidate.id,
    channel: candidate.channel,
    authorName: candidate.authorName,
    authorHandle:
      typeof candidate.authorHandle === "string"
        ? candidate.authorHandle
        : candidate.authorName.toLowerCase().replaceAll(/\s+/g, ""),
    authorInitial: candidate.authorInitial,
    authorAvatarUrl:
      typeof candidate.authorAvatarUrl === "string"
        ? sanitizeImageUrl(candidate.authorAvatarUrl)
        : undefined,
    accentClass: typeof candidate.accentClass === "string" ? candidate.accentClass : undefined,
    timestamp,
    contextLabel: typeof candidate.contextLabel === "string" ? candidate.contextLabel : undefined,
    replyToCastId: typeof candidate.replyToCastId === "string" ? candidate.replyToCastId : undefined,
    text: candidate.text,
    permalink:
      typeof candidate.permalink === "string" ? sanitizeLinkUrl(candidate.permalink) : undefined,
    replies: typeof candidate.replies === "number" ? candidate.replies : undefined,
    recasts: typeof candidate.recasts === "number" ? candidate.recasts : undefined,
    reactions: typeof candidate.reactions === "number" ? candidate.reactions : undefined,
    media: normalizeStoredMedia(candidate.media)
  };
}

function loadStoredLocalCasts(): FeedCast[] {
  const casts = loadStoredJson<unknown[]>(STORAGE_KEYS.localCasts);

  if (!Array.isArray(casts)) {
    return [];
  }

  return casts
    .map(normalizeStoredCast)
    .filter((cast): cast is FeedCast => cast !== null);
}

function saveStoredLocalCasts(casts: FeedCast[]): void {
  if (casts.length === 0) {
    removeStoredValue(STORAGE_KEYS.localCasts);
    return;
  }

  saveStoredJson(STORAGE_KEYS.localCasts, casts);
}

function loadStoredFeedInteractions(): FeedInteractionMap {
  return normalizeStoredFeedInteractions(loadStoredJson<unknown>(STORAGE_KEYS.feedInteractions));
}

function saveStoredFeedInteractions(interactions: FeedInteractionMap): void {
  if (Object.keys(interactions).length === 0) {
    removeStoredValue(STORAGE_KEYS.feedInteractions);
    return;
  }

  saveStoredJson(STORAGE_KEYS.feedInteractions, interactions);
}

function renderIcon(name: IconName): string {
  const paths: Record<IconName, string> = {
    apps: `
      <rect x="4" y="4" width="6" height="6" rx="1.2"></rect>
      <rect x="14" y="4" width="6" height="6" rx="1.2"></rect>
      <rect x="4" y="14" width="6" height="6" rx="1.2"></rect>
      <rect x="14" y="14" width="6" height="6" rx="1.2"></rect>
    `,
    bell: `
      <path d="M8 17h8"></path>
      <path d="M9.2 20a2.8 2.8 0 0 0 5.6 0"></path>
      <path d="M18 17V11a6 6 0 1 0-12 0v6l-1.4 1.8a.8.8 0 0 0 .64 1.3h13.52a.8.8 0 0 0 .64-1.3z"></path>
    `,
    chat: `
      <path d="M6 18.5a7 7 0 1 1 2.26 1.2L4 21l1.18-4.1A6.9 6.9 0 0 1 6 18.5Z"></path>
      <path d="M14.5 5.5A5.5 5.5 0 0 1 20 11c0 .85-.2 1.66-.56 2.38L20.5 17l-3.16-.9"></path>
    `,
    close: `
      <path d="M6 6 18 18"></path>
      <path d="M18 6 6 18"></path>
    `,
    comment: `
      <path d="M5 6.5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H10l-4 3v-3H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"></path>
    `,
    compose: `
      <path d="m4 20 4.2-1 9.4-9.4a2.2 2.2 0 1 0-3.1-3.1L5.1 15.9 4 20Z"></path>
      <path d="M13.5 7.5 16.5 10.5"></path>
    `,
    heart: `
      <path d="M12 20.2 4.9 13a4.5 4.5 0 0 1 6.36-6.36L12 7.38l.74-.74A4.5 4.5 0 1 1 19.1 13z"></path>
    `,
    home: `
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.8v-6.4H9.8V21H5a1 1 0 0 1-1-1z"></path>
    `,
    more: `
      <circle cx="6.5" cy="12" r="1.2" fill="currentColor" stroke="none"></circle>
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"></circle>
      <circle cx="17.5" cy="12" r="1.2" fill="currentColor" stroke="none"></circle>
    `,
    refresh: `
      <path d="M20 6v5h-5"></path>
      <path d="M4 18v-5h5"></path>
      <path d="M6.9 9A7 7 0 0 1 18 11"></path>
      <path d="M17.1 15A7 7 0 0 1 6 13"></path>
    `,
    search: `
      <circle cx="11" cy="11" r="6.5"></circle>
      <path d="m16 16 4 4"></path>
    `,
    share: `
      <path d="M12 16V5"></path>
      <path d="m7.5 9.5 4.5-4.5 4.5 4.5"></path>
      <path d="M6 13.5V18a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4.5"></path>
    `,
    sparkle: `
      <path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8Z"></path>
    `,
    wallet: `
      <path d="M4.5 7.5A2.5 2.5 0 0 1 7 5h10.5A1.5 1.5 0 0 1 19 6.5V8"></path>
      <path d="M4 9.5A2.5 2.5 0 0 1 6.5 7H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 15.5z"></path>
      <circle cx="15.5" cy="13" r="1.2" fill="currentColor" stroke="none"></circle>
    `
  };

  return `
    <svg class="icon icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      ${paths[name]}
    </svg>
  `;
}

function getInitialState(): AppState {
  const testApi = getHypecastTestApi();
  const storedProfile = loadStoredProfile();
  const inStandaloneMode =
    testApi?.isStandalone ??
    (window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true);

  return {
    installPrompt: null,
    pwaInstalled: inStandaloneMode,
    wallet: {
      status: "idle"
    },
    farcaster: storedProfile
      ? {
          status: "connected",
          profile: storedProfile
        }
      : {
          status: "idle"
        },
    xmtp: {
      status: "idle"
    },
    feed: {
      status: "idle"
    }
  };
}

function getInitialUiState(): UiState {
  return {
    activePane: "home",
    activeTimeline: "following",
    overlay: "none",
    searchQuery: "",
    composerDraft: loadStoredComposerDraft(),
    localCasts: loadStoredLocalCasts(),
    feedInteractions: loadStoredFeedInteractions()
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

function describeFeed(state: AppState["feed"]): string {
  if (state.snapshot?.mode === "following" && typeof state.snapshot.viewerFid === "number") {
    return `Following feed for fid ${state.snapshot.viewerFid} via Neynar.`;
  }

  if (state.status === "loading") {
    return "Loading the public fallback feed.";
  }

  if (state.status === "error") {
    return state.error ?? "The feed could not be loaded.";
  }

  return "Public fallback feed sourced from recent Farcaster casts.";
}

function paneTitle(activePane: NavPane): string {
  switch (activePane) {
    case "apps":
      return "Apps";
    case "wallet":
      return "Wallet";
    case "notifications":
      return "Notifications";
    case "chat":
      return "Chat";
    case "home":
    default:
      return "Home";
  }
}

function profileName(profile?: FarcasterProfile): string {
  return profile?.displayName ?? profile?.username ?? "Hypecast";
}

function profileHandle(profile?: FarcasterProfile): string {
  if (profile?.username) {
    return `@${profile.username}`;
  }

  if (profile?.fid) {
    return `fid ${profile.fid}`;
  }

  return "@guest";
}

function profileInitial(profile?: FarcasterProfile): string {
  return (profile?.displayName ?? profile?.username ?? "H").slice(0, 1).toUpperCase();
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function summarizeText(value: string, maxLength = 68): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function formatSnapshotStamp(value?: string): string {
  if (!value) {
    return "Waiting for first sync";
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp);
}

function getTimelineTabs(snapshot?: FeedSnapshot): Array<{ id: TimelineTab; label: string }> {
  return [
    feedAggregateTab,
    ...(snapshot?.sources.map((source) => ({
      id: source.id,
      label: source.label
    })) ?? [])
  ];
}

function getAllFeedCasts(state: AppState, ui: UiState): FeedCast[] {
  return [...ui.localCasts, ...(state.feed.snapshot?.casts ?? [])];
}

function getCastById(state: AppState, ui: UiState, castId: string | undefined): FeedCast | undefined {
  if (!castId) {
    return undefined;
  }

  return getAllFeedCasts(state, ui).find((cast) => cast.id === castId);
}

function getReplyTargetCast(state: AppState, ui: UiState): FeedCast | undefined {
  return getCastById(state, ui, ui.replyTargetCastId);
}

function getLocalReplyCount(ui: UiState, castId: string): number {
  return ui.localCasts.filter((cast) => cast.replyToCastId === castId).length;
}

function feedInteractionState(ui: UiState, castId: string): FeedInteractionState {
  return ui.feedInteractions[castId] ?? {};
}

function replyCountForCast(cast: FeedCast, ui: UiState): number {
  return Math.max(0, (cast.replies ?? 0) + getLocalReplyCount(ui, cast.id));
}

function recastCountForCast(cast: FeedCast, ui: UiState): number {
  const recastDelta = feedInteractionState(ui, cast.id).recasted ? 1 : 0;
  return Math.max(0, (cast.recasts ?? 0) + recastDelta);
}

function likeCountForCast(cast: FeedCast, ui: UiState): number {
  const likeDelta = feedInteractionState(ui, cast.id).liked ? 1 : 0;
  return Math.max(0, (cast.reactions ?? 0) + likeDelta);
}

function getFeedSource(snapshot: FeedSnapshot | undefined, sourceId: string) {
  return snapshot?.sources.find((source) => source.id === sourceId);
}

function formatRelativeTime(timestamp: number): string {
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (deltaSeconds < 60) {
    return "now";
  }

  const deltaMinutes = Math.floor(deltaSeconds / 60);

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);

  if (deltaHours < 24) {
    return `${deltaHours}h`;
  }

  const deltaDays = Math.floor(deltaHours / 24);

  if (deltaDays < 7) {
    return `${deltaDays}d`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric"
  }).format(new Date(timestamp));
}

function publishChannel(state: AppState, ui: UiState, replyTarget?: FeedCast): TimelineTab {
  if (replyTarget) {
    return replyTarget.channel;
  }

  if (ui.activePane === "home" && ui.activeTimeline !== feedAggregateTab.id) {
    return ui.activeTimeline;
  }

  return state.feed.snapshot?.sources[0]?.id ?? "following";
}

function buildLocalCast(state: AppState, ui: UiState, text: string): FeedCast {
  const replyTarget = getReplyTargetCast(state, ui);
  const channel = publishChannel(state, ui, replyTarget);
  const profile = state.farcaster.profile;
  const source = getFeedSource(state.feed.snapshot, channel);

  return {
    id: `local-${Date.now()}`,
    channel,
    authorName: profileName(profile),
    authorHandle: profile?.username ?? "guest",
    authorInitial: profileInitial(profile),
    authorAvatarUrl: profile?.pfpUrl,
    accentClass: "accent-live",
    timestamp: Date.now(),
    contextLabel: replyTarget
      ? `replying to @${replyTarget.authorHandle}`
      : channel === feedAggregateTab.id
        ? undefined
        : `in ${source?.label ?? channel}`,
    replyToCastId: replyTarget?.id,
    text,
    permalink: undefined
  };
}

function renderAvatar(
  profile: FarcasterProfile | undefined,
  imageClass: string,
  fallbackClass: string
): string {
  const safeAvatarUrl = sanitizeImageUrl(profile?.pfpUrl);

  if (safeAvatarUrl) {
    return `<img class="${imageClass}" src="${escapeAttribute(safeAvatarUrl)}" alt="${escapeAttribute(profileName(profile))}" />`;
  }

  return `<span class="${fallbackClass}">${escapeHtml(profileInitial(profile))}</span>`;
}

function stateTone(status: string): string {
  if (status === "connected") {
    return "is-live";
  }

  if (status === "pending" || status === "creating" || status === "connecting") {
    return "is-warm";
  }

  if (status === "error") {
    return "is-issue";
  }

  return "is-idle";
}

function stateLabel(status: string): string {
  switch (status) {
    case "connected":
      return "live";
    case "pending":
      return "waiting";
    case "creating":
      return "starting";
    case "connecting":
      return "working";
    case "error":
      return "issue";
    case "idle":
    default:
      return "idle";
  }
}

function renderStatusCapsules(state: AppState): string {
  return `
    <div class="status-capsules">
      <span class="status-capsule ${stateTone(state.farcaster.status)}">Farcaster ${escapeHtml(stateLabel(state.farcaster.status))}</span>
      <span class="status-capsule ${state.feed.snapshot?.mode === "following" ? "is-live" : "is-idle"}">Feed ${escapeHtml(state.feed.snapshot?.mode === "following" ? "following" : "public")}</span>
      <span class="status-capsule ${stateTone(state.wallet.status)}">Wallet ${escapeHtml(stateLabel(state.wallet.status))}</span>
      <span class="status-capsule ${stateTone(state.xmtp.status)}">XMTP ${escapeHtml(stateLabel(state.xmtp.status))}</span>
    </div>
  `;
}

function activeTimelineLabel(ui: UiState, snapshot?: FeedSnapshot): string {
  if (ui.activeTimeline === feedAggregateTab.id) {
    return feedAggregateTab.label;
  }

  return getFeedSource(snapshot, ui.activeTimeline)?.label ?? ui.activeTimeline;
}

function renderDesktopStatusRow(label: string, detail: string, tone: string): string {
  return `
    <div class="desktop-status-row">
      <span class="notice-dot ${tone}" aria-hidden="true"></span>
      <div>
        <strong>${escapeHtml(label)}</strong>
        <p>${escapeHtml(detail)}</p>
      </div>
    </div>
  `;
}

function renderDesktopStartRail(state: AppState, ui: UiState): string {
  const tabs = getTimelineTabs(state.feed.snapshot).slice(0, 5);
  const feedMode = state.feed.snapshot?.mode === "following" ? "Personal following" : "Public fallback";

  return `
    <aside class="desktop-rail desktop-rail-start">
      <article class="desktop-panel desktop-hero-panel">
        <p class="eyebrow-label">desktop stage</p>
        <h2>Hypecast keeps the phone shell centered and readable on larger screens.</h2>
        <p class="support-copy">
          The mobile interaction model stays intact in the center while the surrounding rails summarize the live session, feed mode, and current focus.
        </p>
      </article>

      <article class="desktop-panel">
        <p class="eyebrow-label">live summary</p>
        <div class="desktop-stat-grid">
          <div class="desktop-stat">
            <span>Feed</span>
            <strong>${escapeHtml(feedMode)}</strong>
          </div>
          <div class="desktop-stat">
            <span>Pane</span>
            <strong>${escapeHtml(paneTitle(ui.activePane))}</strong>
          </div>
          <div class="desktop-stat">
            <span>Timeline</span>
            <strong>${escapeHtml(activeTimelineLabel(ui, state.feed.snapshot))}</strong>
          </div>
          <div class="desktop-stat">
            <span>Casts loaded</span>
            <strong>${escapeHtml(String(getAllFeedCasts(state, ui).length))}</strong>
          </div>
        </div>
        <div class="desktop-chip-row" aria-hidden="true">
          ${tabs
            .map((tab) => `<span class="desktop-chip">${escapeHtml(tab.label)}</span>`)
            .join("")}
        </div>
      </article>
    </aside>
  `;
}

function renderDesktopEndRail(state: AppState, ui: UiState): string {
  const featuredCast = getAllFeedCasts(state, ui)[0];

  return `
    <aside class="desktop-rail desktop-rail-end">
      <article class="desktop-panel">
        <p class="eyebrow-label">session pulse</p>
        <div class="desktop-status-list">
          ${renderDesktopStatusRow("Farcaster", describeFarcaster(state.farcaster), stateTone(state.farcaster.status))}
          ${renderDesktopStatusRow(
            "Feed",
            describeFeed(state.feed),
            state.feed.snapshot?.mode === "following" ? "is-live" : stateTone(state.feed.status)
          )}
          ${renderDesktopStatusRow("Wallet", describeWallet(state.wallet), stateTone(state.wallet.status))}
          ${renderDesktopStatusRow("XMTP", describeXmtp(state.xmtp), stateTone(state.xmtp.status))}
        </div>
      </article>

      ${
        featuredCast
          ? `
            <article class="desktop-panel desktop-cast-panel">
              <p class="eyebrow-label">top cast</p>
              <strong>${escapeHtml(featuredCast.authorName)} <span>@${escapeHtml(featuredCast.authorHandle)}</span></strong>
              <p>${escapeHtml(summarizeText(featuredCast.text, 180))}</p>
            </article>
          `
          : ""
      }
    </aside>
  `;
}

function renderFeedActionButton(options: {
  action: string;
  castId: string;
  icon: IconName;
  label: string;
  active?: boolean;
  count?: number;
  pressed?: boolean;
  tone?: "reply" | "recast" | "like" | "share";
}): string {
  const count = options.count ?? 0;
  const activeClass = options.active ? ` is-active is-${options.tone ?? "reply"}` : "";
  const ariaPressed =
    typeof options.pressed === "boolean" ? `aria-pressed="${options.pressed}"` : "";

  return `
    <button
      class="feed-action-button${activeClass}"
      type="button"
      data-action="${escapeAttribute(options.action)}"
      data-cast-id="${escapeAttribute(options.castId)}"
      aria-label="${escapeAttribute(options.label)}"
      ${ariaPressed}
    >
      ${renderIcon(options.icon)}
      ${count > 0 ? `<span class="feed-action-count">${escapeHtml(count)}</span>` : ""}
    </button>
  `;
}

function renderFeedActions(cast: FeedCast, state: AppState, ui: UiState): string {
  const interaction = feedInteractionState(ui, cast.id);
  const replyTarget = getReplyTargetCast(state, ui);

  return `
    <div class="feed-actions">
      ${renderFeedActionButton({
        action: "reply-cast",
        castId: cast.id,
        icon: "comment",
        label: `Reply to cast by ${cast.authorName}`,
        active: replyTarget?.id === cast.id && ui.overlay === "composer",
        count: replyCountForCast(cast, ui),
        tone: "reply"
      })}
      ${renderFeedActionButton({
        action: "recast-cast",
        castId: cast.id,
        icon: "refresh",
        label: `${interaction.recasted ? "Undo recast" : "Recast"} cast by ${cast.authorName}`,
        active: interaction.recasted === true,
        count: recastCountForCast(cast, ui),
        pressed: interaction.recasted === true,
        tone: "recast"
      })}
      ${renderFeedActionButton({
        action: "like-cast",
        castId: cast.id,
        icon: "heart",
        label: `${interaction.liked ? "Unlike" : "Like"} cast by ${cast.authorName}`,
        active: interaction.liked === true,
        count: likeCountForCast(cast, ui),
        pressed: interaction.liked === true,
        tone: "like"
      })}
      ${renderFeedActionButton({
        action: "share-cast",
        castId: cast.id,
        icon: "share",
        label: `Share cast by ${cast.authorName}`,
        tone: "share"
      })}
    </div>
  `;
}

function renderMediaDetails(media: NonNullable<FeedCast["media"]>): string {
  return `
    <div class="media-copy">
      ${media.eyebrow ? `<p class="media-eyebrow">${escapeHtml(media.eyebrow)}</p>` : ""}
      <strong>${escapeHtml(media.title)}</strong>
      <p>${escapeHtml(media.description)}</p>
    </div>
  `;
}

function renderMediaActionLink(label: string, href: string): string {
  return `<a class="media-action-button" href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function renderMediaDownloadButton(label: string, url: string, fileName: string): string {
  return `
    <button
      class="media-action-button"
      type="button"
      data-download-url="${escapeAttribute(url)}"
      data-download-filename="${escapeAttribute(fileName)}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function inferMediaDownloadFileName(url: string, kind: "image" | "video"): string {
  const fallbackExtension = kind === "video" ? "mp4" : "jpg";
  const fallbackName = `hypecast-${kind}.${fallbackExtension}`;

  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split("/").filter(Boolean).at(-1);

    if (!lastSegment) {
      return fallbackName;
    }

    const decoded = decodeURIComponent(lastSegment).replace(/[^\w.\-]+/g, "-");
    return decoded || fallbackName;
  } catch {
    return fallbackName;
  }
}

function triggerBrowserDownload(url: string, fileName: string, openInNewTab = false): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;

  if (openInNewTab) {
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
  }

  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function downloadMediaAsset(url: string, fileName: string): Promise<void> {
  const safeUrl = sanitizeImageUrl(url) ?? sanitizeVideoUrl(url);

  if (!safeUrl) {
    return;
  }

  try {
    const response = await fetch(safeUrl, {
      mode: "cors"
    });

    if (!response.ok) {
      throw new Error(`Download failed with ${response.status}.`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(objectUrl, fileName);
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 30_000);
  } catch {
    triggerBrowserDownload(safeUrl, fileName, true);
  }
}

async function shareCast(cast: FeedCast): Promise<void> {
  const shareUrl = sanitizeLinkUrl(cast.permalink) ?? sanitizeLinkUrl(cast.media?.href);
  const shareText = `${cast.authorName}: ${cast.text}`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: cast.authorName,
        text: shareText,
        url: shareUrl
      });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
    }
  }

  const fallbackPayload = shareUrl ? `${shareText}\n${shareUrl}` : shareText;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(fallbackPayload);
      return;
    } catch {
      // Fall through to the window-open fallback.
    }
  }

  if (shareUrl) {
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  }
}

function renderFeedMedia(media: FeedCast["media"]): string {
  if (!media) {
    return "";
  }

  const safeHref = sanitizeLinkUrl(media.href);
  const shouldShowDetails = media.showDetails !== false;
  const safeImageSrc = media.kind === "image" ? sanitizeImageUrl(media.src) : undefined;
  const safeVideoSrc = media.kind === "video" ? sanitizeVideoUrl(media.src) : undefined;
  const safePosterSrc = media.kind === "video" ? sanitizeImageUrl(media.posterSrc) : undefined;

  if (media.kind === "image" && safeImageSrc) {
    const linkHref = safeHref ?? safeImageSrc;
    const imageMarkup = `
      <img
        src="${escapeAttribute(safeImageSrc)}"
        alt="${escapeAttribute(media.alt ?? media.title)}"
        loading="lazy"
        referrerpolicy="no-referrer"
      />
    `;

    return `
      <div class="media-card media-image ${shouldShowDetails ? "has-details" : "is-attachment"}">
        ${
          linkHref
            ? `<a class="media-asset-link" href="${escapeAttribute(linkHref)}" target="_blank" rel="noreferrer">${imageMarkup}</a>`
            : imageMarkup
        }
        ${
          shouldShowDetails
            ? `
              ${renderMediaDetails(media)}
              <div class="media-actions">
                ${
                  safeHref && safeHref !== safeImageSrc
                    ? renderMediaActionLink("Open link", safeHref)
                    : ""
                }
                ${renderMediaDownloadButton(
                  "Download image",
                  safeImageSrc,
                  inferMediaDownloadFileName(safeImageSrc, "image")
                )}
              </div>
            `
            : `
              <div class="media-actions">
                ${renderMediaDownloadButton(
                  "Download image",
                  safeImageSrc,
                  inferMediaDownloadFileName(safeImageSrc, "image")
                )}
              </div>
            `
        }
      </div>
    `;
  }

  if (media.kind === "video" && safeVideoSrc) {
    return `
      <div class="media-card media-video ${shouldShowDetails ? "has-details" : "is-attachment"}">
        <video
          controls
          playsinline
          preload="metadata"
          ${safePosterSrc ? `poster="${escapeAttribute(safePosterSrc)}"` : ""}
        >
          <source src="${escapeAttribute(safeVideoSrc)}" />
        </video>
        ${
          shouldShowDetails
            ? renderMediaDetails(media)
            : ""
        }
        <div class="media-actions">
          ${
            safeHref
              ? renderMediaActionLink(
                  safeHref === safeVideoSrc ? "Open video" : "Open link",
                  safeHref
                )
              : ""
          }
          ${renderMediaDownloadButton(
            "Download video",
            safeVideoSrc,
            inferMediaDownloadFileName(safeVideoSrc, "video")
          )}
        </div>
      </div>
    `;
  }

  if (media.kind === "link" || media.kind === "image" || media.kind === "video") {
    const cardMarkup = `
      <div class="media-hero">
        <span>${renderIcon("search")}</span>
      </div>
      ${renderMediaDetails(media)}
    `;

    return `
      ${
        safeHref
          ? `<a class="media-card media-link media-link-card" href="${escapeAttribute(safeHref)}" target="_blank" rel="noreferrer">${cardMarkup}</a>`
          : `<div class="media-card media-link">${cardMarkup}</div>`
      }
    `;
  }

  return "";
}

function renderFeedCast(cast: FeedCast, state: AppState, ui: UiState): string {
  const safeAvatarUrl = sanitizeImageUrl(cast.authorAvatarUrl);
  const safePermalink = sanitizeLinkUrl(cast.permalink);

  return `
    <article class="feed-card">
      <div class="feed-header">
        <div class="feed-avatar-wrap">
          ${
            safeAvatarUrl
              ? `<img class="feed-avatar" src="${escapeAttribute(safeAvatarUrl)}" alt="${escapeAttribute(cast.authorName)}" />`
              : `<span class="feed-avatar feed-avatar-fallback ${escapeAttribute(cast.accentClass ?? "accent-live")}">${escapeHtml(
                  cast.authorInitial
                )}</span>`
          }
        </div>
        <div class="feed-main">
          <div class="author-row">
            <strong>${escapeHtml(cast.authorName)}</strong>
            <span class="author-meta">@${escapeHtml(cast.authorHandle)}</span>
            ${cast.contextLabel ? `<span class="context-pill">${escapeHtml(cast.contextLabel)}</span>` : ""}
            <span class="author-meta">${escapeHtml(formatRelativeTime(cast.timestamp))}</span>
          </div>
          <p class="cast-text">${escapeHtml(cast.text)}</p>
          ${renderFeedMedia(cast.media)}
        </div>
        ${
          safePermalink
            ? `<a class="feed-menu" href="${escapeAttribute(safePermalink)}" target="_blank" rel="noreferrer" aria-label="Open cast">${renderIcon("more")}</a>`
            : `<span class="feed-menu" aria-hidden="true">${renderIcon("more")}</span>`
        }
      </div>
      ${renderFeedActions(cast, state, ui)}
    </article>
  `;
}

function getSearchResults(state: AppState, ui: UiState): SearchResult[] {
  const query = normalizeSearch(ui.searchQuery);

  if (!query) {
    return [];
  }

  const results: SearchResult[] = [];
  const allCasts = getAllFeedCasts(state, ui);

  getTimelineTabs(state.feed.snapshot).forEach((tab) => {
    if (normalizeSearch(tab.label).includes(query)) {
      results.push({
        id: `timeline-${tab.id}`,
        kind: "timeline",
        title: tab.label,
        detail: "Jump to a timeline tab",
        timeline: tab.id
      });
    }
  });

  navItems.forEach((item) => {
    if (normalizeSearch(item.label).includes(query)) {
      results.push({
        id: `pane-${item.id}`,
        kind: "pane",
        title: item.label,
        detail: "Open a primary app surface",
        nav: item.id
      });
    }
  });

  if (state.farcaster.profile) {
    const profile = state.farcaster.profile;
    const profileFields = [
      profileName(profile),
      profileHandle(profile),
      profile.bio ?? ""
    ]
      .join(" ")
      .toLowerCase();

    if (profileFields.includes(query)) {
      results.push({
        id: `profile-${profile.fid}`,
        kind: "profile",
        title: profileName(profile),
        detail: profileHandle(profile),
        action: "profile"
      });
    }
  }

  allCasts.forEach((cast) => {
    const source = getFeedSource(state.feed.snapshot, cast.channel);
    const searchBlob = [
      cast.authorName,
      cast.authorHandle,
      cast.channel,
      source?.displayName ?? "",
      cast.contextLabel ?? "",
      cast.text,
      cast.media?.title ?? "",
      cast.media?.description ?? ""
    ]
      .join(" ")
      .toLowerCase();

    if (searchBlob.includes(query)) {
      results.push({
        id: `cast-${cast.id}`,
        kind: "cast",
        title: summarizeText(`${cast.authorName}: ${cast.text}`, 82),
        detail: cast.contextLabel ?? `in ${source?.label ?? cast.channel}`,
        timeline: cast.channel
      });
    }
  });

  return results.slice(0, 8);
}

function renderSearchResult(result: SearchResult): string {
  const attributes = result.timeline
    ? `data-timeline="${escapeAttribute(result.timeline)}"`
    : result.nav
      ? `data-nav="${escapeAttribute(result.nav)}"`
      : result.action
        ? `data-action="${escapeAttribute(result.action)}"`
        : "";

  return `
    <button class="search-result" type="button" ${attributes}>
      <span class="search-result-kind">${escapeHtml(result.kind)}</span>
      <strong>${escapeHtml(result.title)}</strong>
      <p>${escapeHtml(result.detail)}</p>
    </button>
  `;
}

function renderEmptyTimeline(activeTimeline: TimelineTab, snapshot?: FeedSnapshot): string {
  const label =
    activeTimeline === feedAggregateTab.id
      ? feedAggregateTab.label
      : getFeedSource(snapshot, activeTimeline)?.label ?? activeTimeline;

  return `
    <article class="feed-card empty-card">
      <p class="eyebrow-label">${escapeHtml(label)}</p>
      <h2>No recent casts are available for this tab.</h2>
      <p class="support-copy">
        The shell is using the latest feed snapshot available in the app. Try another source or refresh the snapshot asset.
      </p>
    </article>
  `;
}

function renderHomePane(state: AppState, ui: UiState): string {
  const allCasts = getAllFeedCasts(state, ui);
  const filteredCasts =
    ui.activeTimeline === feedAggregateTab.id
      ? allCasts
      : allCasts.filter((cast) => cast.channel === ui.activeTimeline);

  const cards: string[] = [];

  if (state.feed.status === "loading" && filteredCasts.length === 0) {
    cards.push(`
      <article class="feed-card empty-card">
        <p class="eyebrow-label">syncing</p>
        <h2>Loading the Farcaster feed snapshot.</h2>
        <p class="support-copy">Pulling the latest published snapshot into the shell.</p>
      </article>
    `);
  } else if (state.feed.status === "error" && filteredCasts.length === 0) {
    cards.push(`
      <article class="feed-card empty-card">
        <p class="eyebrow-label">feed unavailable</p>
        <h2>Could not load the Farcaster feed.</h2>
        <p class="support-copy">${escapeHtml(state.feed.error ?? "The feed snapshot request failed.")}</p>
      </article>
    `);
  } else if (filteredCasts.length === 0) {
    cards.push(renderEmptyTimeline(ui.activeTimeline, state.feed.snapshot));
  } else {
    cards.push(...filteredCasts.map((cast) => renderFeedCast(cast, state, ui)));
  }

  return `
    <section class="feed-shell" data-feed-shell>
      <div class="pull-refresh" aria-hidden="true">
        <div class="pull-refresh-indicator" data-pull-refresh-indicator>
          ${renderIcon("refresh")}
          <span data-pull-refresh-label>Pull to refresh</span>
        </div>
      </div>
      <section class="feed-stack">${cards.join("")}</section>
    </section>
  `;
}

function renderAppsPane(state: AppState): string {
  const snapshotStamp = formatSnapshotStamp(state.feed.snapshot?.generatedAt);

  return `
    <section class="pane-stack">
      <article class="pane-card">
        <p class="eyebrow-label">launchpad</p>
        <h2>Shell utilities</h2>
        <p class="support-copy">
          The mobile chrome now mirrors a signed-in client. These utilities keep the existing scaffold reachable without leaving that frame.
        </p>
        <div class="action-grid">
          <button class="secondary-button" type="button" data-action="install" ${state.installPrompt ? "" : "disabled"}>
            ${state.pwaInstalled ? "Installed" : "Install app"}
          </button>
          <button class="secondary-button" type="button" data-action="farcaster">Farcaster</button>
          <button class="secondary-button" type="button" data-action="wallet">Wallet</button>
          <button class="secondary-button" type="button" data-action="xmtp">XMTP</button>
          <button class="secondary-button" type="button" data-action="settings">Settings</button>
        </div>
      </article>

      <article class="pane-card">
        <p class="eyebrow-label">tracker</p>
        <h2>Feature maturity</h2>
        <p class="support-copy">
          The repo root now includes <code>FEATURES.md</code> using the <code>stable</code>, <code>in-progress</code>, and <code>planned</code> structure from features.md.
        </p>
        <div class="mini-list">
          <div class="mini-item">
            <span>Stable</span>
            <strong>PWA shell</strong>
          </div>
          <div class="mini-item">
            <span>In progress</span>
            <strong>Snapshot-backed mobile feed</strong>
          </div>
          <div class="mini-item">
            <span>In progress</span>
            <strong>Search, drafts, and local publish</strong>
          </div>
        </div>
      </article>

      <article class="pane-card">
        <p class="eyebrow-label">runtime</p>
        <h2>Current environment</h2>
        <div class="mini-list">
          <div class="mini-item">
            <span>Optimism RPC</span>
            <strong>${escapeHtml(APP_CONFIG.optimismRpcUrl)}</strong>
          </div>
          <div class="mini-item">
            <span>XMTP env</span>
            <strong>${escapeHtml(APP_CONFIG.xmtpEnv)}</strong>
          </div>
          <div class="mini-item">
            <span>Feed snapshot</span>
            <strong>${escapeHtml(snapshotStamp)}</strong>
          </div>
          <div class="mini-item">
            <span>Feed mode</span>
            <strong>${escapeHtml(state.feed.snapshot?.mode === "following" ? "Personal following" : "Public fallback")}</strong>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderWalletPane(state: AppState): string {
  return `
    <section class="pane-stack">
      <article class="pane-card">
        <p class="eyebrow-label">wallet</p>
        <h2>${escapeHtml(
          state.wallet.status === "connected" ? "Wallet connected" : "Connect your wallet"
        )}</h2>
        <p class="support-copy">${escapeHtml(describeWallet(state.wallet))}</p>
        <div class="action-grid">
          <button class="primary-button" type="button" data-action="wallet">
            ${state.wallet.status === "connected" ? "Reconnect wallet" : "Connect wallet"}
          </button>
          <button class="secondary-button" type="button" data-action="xmtp" ${
            state.wallet.status !== "connected" ? "disabled" : ""
          }>
            ${state.xmtp.status === "connected" ? "Reinitialize XMTP" : "Start XMTP"}
          </button>
        </div>
      </article>

      <article class="pane-card">
        <div class="mini-list">
          <div class="mini-item">
            <span>Account</span>
            <strong>${escapeHtml(
              state.wallet.address ? shortAddress(state.wallet.address) : "Not connected"
            )}</strong>
          </div>
          <div class="mini-item">
            <span>Network</span>
            <strong>${escapeHtml(state.wallet.chainName ?? "Unknown")}</strong>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderNotificationRow(title: string, detail: string, tone: string): string {
  return `
    <article class="notice-row">
      <span class="notice-dot ${tone}"></span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(detail)}</p>
      </div>
    </article>
  `;
}

function renderNotificationsPane(state: AppState): string {
  const installTone = state.pwaInstalled ? "is-live" : state.installPrompt ? "is-warm" : "is-idle";
  const installDetail = state.pwaInstalled
    ? "Installed and ready for home-screen launch."
    : state.installPrompt
      ? "Install prompt is available in this browser."
      : "Install prompt has not surfaced in this session.";

  return `
    <section class="pane-stack">
      <article class="pane-card">
        <p class="eyebrow-label">status</p>
        <h2>System notifications</h2>
        <div class="notice-list">
          ${renderNotificationRow("Farcaster", describeFarcaster(state.farcaster), stateTone(state.farcaster.status))}
          ${renderNotificationRow("Feed", describeFeed(state.feed), state.feed.snapshot?.mode === "following" ? "is-live" : stateTone(state.feed.status))}
          ${renderNotificationRow("Wallet", describeWallet(state.wallet), stateTone(state.wallet.status))}
          ${renderNotificationRow("XMTP", describeXmtp(state.xmtp), stateTone(state.xmtp.status))}
          ${renderNotificationRow("Install", installDetail, installTone)}
        </div>
      </article>
    </section>
  `;
}

function renderChatPane(state: AppState): string {
  return `
    <section class="pane-stack">
      <article class="pane-card">
        <p class="eyebrow-label">chat rail</p>
        <h2>${escapeHtml(state.xmtp.status === "connected" ? "XMTP ready" : "XMTP bootstrap")}</h2>
        <p class="support-copy">${escapeHtml(describeXmtp(state.xmtp))}</p>
        <div class="action-grid">
          <button class="primary-button" type="button" data-action="xmtp" ${
            state.wallet.status !== "connected" ? "disabled" : ""
          }>
            ${state.xmtp.status === "connected" ? "Refresh XMTP" : "Initialize XMTP"}
          </button>
          <button class="secondary-button" type="button" data-action="wallet">
            ${state.wallet.status === "connected" ? "Wallet ready" : "Connect wallet first"}
          </button>
        </div>
      </article>

      <article class="pane-card">
        <p class="support-copy">
          Live conversations are still planned. The current implementation stops at authenticated browser client creation and inbox identity capture.
        </p>
        <div class="mini-list">
          <div class="mini-item">
            <span>Inbox</span>
            <strong>${escapeHtml(state.xmtp.inboxId ?? "Not created")}</strong>
          </div>
          <div class="mini-item">
            <span>Account</span>
            <strong>${escapeHtml(state.xmtp.accountIdentifier ?? "Unavailable")}</strong>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderPane(state: AppState, ui: UiState): string {
  switch (ui.activePane) {
    case "apps":
      return renderAppsPane(state);
    case "wallet":
      return renderWalletPane(state);
    case "notifications":
      return renderNotificationsPane(state);
    case "chat":
      return renderChatPane(state);
    case "home":
    default:
      return renderHomePane(state, ui);
  }
}

function renderSearchOverlay(state: AppState, ui: UiState): string {
  const query = ui.searchQuery.trim();
  const results = getSearchResults(state, ui);
  const quickTimelineChips = getTimelineTabs(state.feed.snapshot)
    .slice(0, 4)
    .map(
      (tab) =>
        `<button class="suggestion-chip" type="button" data-timeline="${escapeAttribute(tab.id)}">${escapeHtml(tab.label)}</button>`
    )
    .join("");
  const quickPaneChips = navItems
    .filter((item) => item.id !== "home")
    .slice(0, 3)
    .map(
      (item) =>
        `<button class="suggestion-chip" type="button" data-nav="${escapeAttribute(item.id)}">${escapeHtml(item.label.toLowerCase())}</button>`
    )
    .join("");

  return `
    <div class="overlay-backdrop">
      <section class="overlay-sheet">
        <div class="sheet-head">
          <div>
            <p class="eyebrow-label">search</p>
            <h2>${query ? "Search results" : "Quick jumps"}</h2>
          </div>
          <button class="icon-button" type="button" data-action="close-overlay" aria-label="Close search">
            ${renderIcon("close")}
          </button>
        </div>
        <label class="search-field">
          ${renderIcon("search")}
          <input
            type="text"
            data-input="search"
            value="${escapeAttribute(ui.searchQuery)}"
            placeholder="Search casts, channels, people, and app surfaces"
            aria-label="Search Hypecast"
          />
        </label>
        ${
          query
            ? results.length > 0
              ? `
                <div class="search-results" role="list">
                  ${results.map(renderSearchResult).join("")}
                </div>
              `
              : `
                <div class="search-empty">
                  <strong>No results yet for "${escapeHtml(query)}".</strong>
                  <p class="support-copy">Try a channel name, a cast phrase, or a primary tab like wallet or chat.</p>
                </div>
              `
            : `
              <div class="suggestion-grid">
                ${quickTimelineChips}
                ${quickPaneChips}
              </div>
            `
        }
        <p class="support-copy">
          Search is local-first right now and runs against the current Farcaster snapshot plus your local drafts and casts.
        </p>
      </section>
    </div>
  `;
}

function renderFarcasterRelayCard(state: AppState): string {
  if (state.farcaster.status === "connected" && !state.farcaster.qrCodeDataUrl) {
    return "";
  }

  const safeQrCodeDataUrl = sanitizeImageUrl(state.farcaster.qrCodeDataUrl, {
    allowDataImage: true
  });
  const safeChannelUrl = sanitizeLinkUrl(state.farcaster.channelUrl);

  return `
    <div class="sheet-auth-card">
      <p class="support-copy farcaster-status-copy">${escapeHtml(describeFarcaster(state.farcaster))}</p>
      ${
        safeQrCodeDataUrl
          ? `
            <div class="sheet-qr-card">
              <img src="${escapeAttribute(safeQrCodeDataUrl)}" alt="Farcaster sign-in QR code" />
              <div>
                <p class="eyebrow-label">scan from your phone</p>
                <p class="support-copy">Use Warpcast or another Farcaster wallet to complete the sign-in flow.</p>
                ${
                  safeChannelUrl
                    ? `<a class="text-link" href="${escapeAttribute(safeChannelUrl)}" target="_blank" rel="noreferrer">Open deep link</a>`
                    : ""
                }
              </div>
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderProfileOverlay(state: AppState): string {
  const profile = state.farcaster.profile;
  const storedNeynarApiKey = loadStoredNeynarApiKey();
  const defaultNeynarApiKey = getDefaultNeynarApiKey();
  const effectiveNeynarApiKey = getEffectiveNeynarApiKey();
  const usingStoredNeynarApiKey = Boolean(storedNeynarApiKey);
  const usingDefaultNeynarApiKey = !usingStoredNeynarApiKey && Boolean(defaultNeynarApiKey);
  const personalizedFeedReady = Boolean(profile?.fid && effectiveNeynarApiKey);
  const feedKeySourceLabel = usingStoredNeynarApiKey
    ? "Local override active"
    : usingDefaultNeynarApiKey
      ? "App default active"
      : "No key configured";
  const feedHelperText = profile?.fid
    ? usingStoredNeynarApiKey
      ? "A saved override is active in this browser. Refresh the feed to load your following timeline."
      : usingDefaultNeynarApiKey
        ? "The app's built-in Neynar key is active. Refresh the feed to load your following timeline, or save a local override below."
        : "Save a Neynar API key to load your following feed in this browser."
    : usingStoredNeynarApiKey
      ? "Saved override is ready. Sign in with Farcaster to load your following feed."
      : usingDefaultNeynarApiKey
        ? "The app's built-in Neynar key is ready. Sign in with Farcaster to load your following feed."
        : "Paste a Neynar API key to load your real following feed in this browser.";

  return `
    <div class="overlay-backdrop">
      <section class="overlay-sheet">
        <div class="sheet-head">
          <div>
            <p class="eyebrow-label">account</p>
            <h2>${escapeHtml(profileName(profile))}</h2>
          </div>
          <button class="icon-button" type="button" data-action="close-overlay" aria-label="Close account sheet">
            ${renderIcon("close")}
          </button>
        </div>
        <div class="profile-sheet">
          <div class="sheet-avatar-wrap">
            ${renderAvatar(profile, "sheet-avatar", "sheet-avatar sheet-avatar-fallback")}
          </div>
          <div>
            <strong>${escapeHtml(profileHandle(profile))}</strong>
            <p class="support-copy">
              ${
                profile
                  ? escapeHtml(profile.bio ?? `FID ${profile.fid}`)
                  : "Connect Farcaster to bind your profile to the shell."
              }
            </p>
          </div>
        </div>
        ${renderFarcasterRelayCard(state)}
        ${renderStatusCapsules(state)}
        <div class="mini-list">
          <div class="mini-item">
            <span>Wallet</span>
            <strong>${escapeHtml(describeWallet(state.wallet))}</strong>
          </div>
          <div class="mini-item">
            <span>XMTP</span>
            <strong>${escapeHtml(describeXmtp(state.xmtp))}</strong>
          </div>
          <div class="mini-item">
            <span>Feed</span>
            <strong>${escapeHtml(describeFeed(state.feed))}</strong>
          </div>
        </div>
        <div class="feed-config-card">
          <p class="eyebrow-label">following feed</p>
          <h3>Load your real Farcaster feed</h3>
          <p class="eyebrow-label">${escapeHtml(feedKeySourceLabel)}</p>
          <p class="support-copy">${escapeHtml(feedHelperText)}</p>
          <label class="secret-field">
            <span class="sr-only">Neynar API key</span>
            <input
              type="password"
              data-field="neynar-api-key"
              value="${escapeAttribute(storedNeynarApiKey)}"
              placeholder="Optional local Neynar override"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
            />
          </label>
          <div class="action-grid">
            <button class="secondary-button" type="button" data-action="save-feed-key">
              ${usingStoredNeynarApiKey ? "Update override" : "Save override"}
            </button>
            <button class="secondary-button" type="button" data-action="clear-feed-key" ${usingStoredNeynarApiKey ? "" : "disabled"}>
              Clear key
            </button>
            <button class="primary-button" type="button" data-action="refresh-feed" ${personalizedFeedReady ? "" : "disabled"}>
              Refresh following feed
            </button>
          </div>
        </div>
        <div class="action-grid">
          <button class="primary-button" type="button" data-action="farcaster">
            ${state.farcaster.status === "connected" ? "Refresh Farcaster" : "Sign In With Farcaster"}
          </button>
          <button class="secondary-button" type="button" data-action="settings">Settings</button>
          <button class="secondary-button" type="button" data-action="wallet">Wallet</button>
          <button class="secondary-button" type="button" data-action="xmtp">XMTP</button>
        </div>
      </section>
    </div>
  `;
}

function renderSettingsOverlay(state: AppState): string {
  const runningSurface = window.matchMedia("(display-mode: standalone)").matches
    ? "Standalone app"
    : "Browser tab";
  const snapshotStamp = state.feed.snapshot?.generatedAt ?? "No feed loaded";
  const feedMode = state.feed.snapshot?.mode === "following" ? "Personal following" : "Public fallback";

  return `
    <div class="overlay-backdrop">
      <section class="overlay-sheet">
        <div class="sheet-head">
          <div>
            <p class="eyebrow-label">settings</p>
            <h2>Settings</h2>
            <p class="support-copy">Use About to confirm the exact bundle currently running on this device.</p>
          </div>
          <button class="icon-button" type="button" data-action="close-overlay" aria-label="Close settings">
            ${renderIcon("close")}
          </button>
        </div>
        <div class="settings-stack">
          <article class="pane-card">
            <p class="eyebrow-label">about</p>
            <h3>About this build</h3>
            <p class="support-copy">
              If these values do not match the newest deploy, fully close and reopen the installed app to pick up the latest service worker.
            </p>
            <div class="mini-list">
              <div class="mini-item">
                <span>Build ID</span>
                <strong class="settings-value" data-build-id>${escapeHtml(BUILD_INFO.id)}</strong>
              </div>
              <div class="mini-item">
                <span>Build time</span>
                <strong class="settings-value" data-build-time>${escapeHtml(BUILD_INFO.time)}</strong>
              </div>
              <div class="mini-item">
                <span>Surface</span>
                <strong class="settings-value">${escapeHtml(runningSurface)}</strong>
              </div>
            </div>
          </article>

          <article class="pane-card">
            <p class="eyebrow-label">runtime</p>
            <h3>Current data</h3>
            <div class="mini-list">
              <div class="mini-item">
                <span>Feed snapshot</span>
                <strong class="settings-value">${escapeHtml(snapshotStamp)}</strong>
              </div>
              <div class="mini-item">
                <span>Feed mode</span>
                <strong class="settings-value">${escapeHtml(feedMode)}</strong>
              </div>
              <div class="mini-item">
                <span>Farcaster</span>
                <strong class="settings-value">${escapeHtml(profileHandle(state.farcaster.profile))}</strong>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderComposerOverlay(state: AppState, ui: UiState): string {
  const draftLength = ui.composerDraft.trim().length;
  const canPublish = state.farcaster.status === "connected" && draftLength > 0;
  const replyTarget = getReplyTargetCast(state, ui);

  return `
    <div class="overlay-backdrop">
      <section class="overlay-sheet">
        <div class="sheet-head">
          <div>
            <p class="eyebrow-label">${replyTarget ? "reply" : "new cast"}</p>
            <h2>${replyTarget ? `Reply to @${escapeHtml(replyTarget.authorHandle)}` : "Composer placement is in"}</h2>
          </div>
          <button class="icon-button" type="button" data-action="close-overlay" aria-label="Close composer">
            ${renderIcon("close")}
          </button>
        </div>
        ${
          replyTarget
            ? `
              <div class="reply-target-card">
                <strong>@${escapeHtml(replyTarget.authorHandle)}</strong>
                <p class="support-copy">${escapeHtml(summarizeText(replyTarget.text, 140))}</p>
              </div>
            `
            : ""
        }
        <div class="composer-shell">
          <div class="composer-head">
            <div class="sheet-avatar-wrap">
              ${renderAvatar(state.farcaster.profile, "sheet-avatar", "sheet-avatar sheet-avatar-fallback")}
            </div>
            <div>
              <strong>${escapeHtml(profileName(state.farcaster.profile))}</strong>
              <p class="support-copy">
                Drafts save locally on this device. ${
                  state.farcaster.status === "connected"
                    ? replyTarget
                      ? "Publishing adds a local reply to the feed shell and updates the reply count."
                      : "Publishing adds a local cast to the feed shell."
                    : "Sign in with Farcaster when you want to publish."
                }
              </p>
            </div>
          </div>
          <textarea
            data-input="composer"
            placeholder="What’s happening on Hypecast?"
          >${escapeHtml(ui.composerDraft)}</textarea>
          <div class="composer-footer">
            <span class="support-copy">Draft saved locally</span>
            <strong>${escapeHtml(draftLength)}/320</strong>
          </div>
        </div>
        <div class="action-grid">
          <button class="secondary-button" type="button" data-action="clear-reply-target" ${
            replyTarget ? "" : "disabled"
          }>Cancel reply</button>
          <button class="secondary-button" type="button" data-action="clear-draft" ${
            ui.composerDraft ? "" : "disabled"
          }>Clear draft</button>
          <button class="primary-button" type="button" data-action="publish-cast" ${
            canPublish ? "" : "disabled"
          }>
            ${state.farcaster.status === "connected" ? "Publish cast" : "Sign in to publish"}
          </button>
        </div>
      </section>
    </div>
  `;
}

function renderOverlay(state: AppState, ui: UiState): string {
  switch (ui.overlay) {
    case "search":
      return renderSearchOverlay(state, ui);
    case "profile":
      return renderProfileOverlay(state);
    case "settings":
      return renderSettingsOverlay(state);
    case "composer":
      return renderComposerOverlay(state, ui);
    case "none":
    default:
      return "";
  }
}

function unreadBadge(_state: AppState, _navId: NavPane): string {
  return "";
}

function template(
  state: AppState,
  ui: UiState
): string {
  const timelineTabs = getTimelineTabs(state.feed.snapshot);

  return `
    <div class="app-shell">
      <div class="ambient ambient-left"></div>
      <div class="ambient ambient-right"></div>
      <div class="desktop-stage">
        ${renderDesktopStartRail(state, ui)}
        <section class="phone-shell">
          <header class="topbar">
            <button class="avatar-button" type="button" data-action="profile" aria-label="Open account">
              ${renderAvatar(state.farcaster.profile, "top-avatar", "top-avatar top-avatar-fallback")}
            </button>
            <h1>${escapeHtml(paneTitle(ui.activePane))}</h1>
            <button class="icon-button" type="button" data-action="search" aria-label="Open search">
              ${renderIcon("search")}
            </button>
          </header>

          ${
            ui.activePane === "home"
              ? `
                <div class="timeline-tabs" role="tablist" aria-label="Timeline tabs">
                  ${timelineTabs
                    .map(
                      (tab) => `
                        <button
                          class="timeline-tab ${ui.activeTimeline === tab.id ? "is-active" : ""}"
                          type="button"
                          data-timeline="${escapeAttribute(tab.id)}"
                          role="tab"
                          aria-selected="${ui.activeTimeline === tab.id}"
                        >
                          ${escapeHtml(tab.label)}
                        </button>
                      `
                    )
                    .join("")}
                </div>
              `
              : ""
          }

          <main class="shell-content">
            ${renderPane(state, ui)}
          </main>

          <button class="compose-fab" type="button" data-action="compose" aria-label="New cast">
            ${renderIcon("compose")}
          </button>

          <nav class="bottom-nav" aria-label="Primary">
            ${navItems
              .map(
                (item) => `
                  <button
                    class="nav-button ${ui.activePane === item.id ? "is-active" : ""}"
                    type="button"
                    data-nav="${escapeAttribute(item.id)}"
                    aria-label="${escapeAttribute(item.label)}"
                  >
                    <span class="nav-icon-wrap">
                      ${renderIcon(item.icon)}
                      ${unreadBadge(state, item.id)}
                    </span>
                    <span class="sr-only">${escapeHtml(item.label)}</span>
                  </button>
                `
              )
              .join("")}
          </nav>

          ${renderOverlay(state, ui)}
        </section>
        ${renderDesktopEndRail(state, ui)}
      </div>
    </div>
  `;
}

export function createApp(root: HTMLDivElement): void {
  const state = getInitialState();
  const ui = getInitialUiState();
  const pullToRefresh: PullToRefreshState = {
    active: false,
    refreshing: false,
    shouldRefresh: false,
    distancePx: 0,
    startY: 0
  };
  let walletSession: WalletSession | null = null;
  let xmtpSession: Awaited<ReturnType<typeof connectXmtp>> | null = null;
  let activeFeedRefreshPromise: Promise<void> | null = null;

  const isPullToRefreshEnabled = () => ui.activePane === "home" && ui.overlay === "none";

  const resetPullToRefresh = () => {
    pullToRefresh.active = false;
    pullToRefresh.shouldRefresh = false;
    pullToRefresh.distancePx = 0;
    pullToRefresh.startY = 0;
  };

  const pullToRefreshLabel = () => {
    if (pullToRefresh.refreshing) {
      return "Refreshing feed";
    }

    return pullToRefresh.shouldRefresh ? "Release to refresh" : "Pull to refresh";
  };

  const syncPullToRefreshUi = () => {
    if (!isPullToRefreshEnabled() && !pullToRefresh.refreshing) {
      resetPullToRefresh();
    }

    const shellContent = root.querySelector<HTMLElement>(".shell-content");
    const label = root.querySelector<HTMLElement>("[data-pull-refresh-label]");
    const distancePx = isPullToRefreshEnabled() || pullToRefresh.refreshing ? pullToRefresh.distancePx : 0;
    const progress = Math.min(1, distancePx / PULL_REFRESH_THRESHOLD_PX);

    if (shellContent) {
      shellContent.style.setProperty("--pull-refresh-distance", `${distancePx}px`);
      shellContent.style.setProperty("--pull-refresh-progress", progress.toFixed(3));
      shellContent.classList.toggle(
        "is-pull-refresh-active",
        pullToRefresh.active || pullToRefresh.refreshing
      );
      shellContent.classList.toggle("is-pull-refresh-armed", pullToRefresh.shouldRefresh);
      shellContent.classList.toggle("is-pull-refresh-refreshing", pullToRefresh.refreshing);
    }

    if (label) {
      label.textContent = pullToRefreshLabel();
    }
  };

  const render = (focusTarget?: FocusTarget) => {
    root.innerHTML = template(state, ui);
    syncPullToRefreshUi();

    if (!focusTarget) {
      return;
    }

    const selector =
      focusTarget.field === "search" ? '[data-input="search"]' : '[data-input="composer"]';
    const element = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);

    if (!element) {
      return;
    }

    const start = Math.min(focusTarget.start ?? element.value.length, element.value.length);
    const end = Math.min(focusTarget.end ?? start, element.value.length);

    element.focus();
    element.setSelectionRange(start, end);
  };

  const setPartialState = (patch: Partial<AppState>) => {
    Object.assign(state, patch);
    render();
  };

  const persistFeedInteractions = () => {
    saveStoredFeedInteractions(ui.feedInteractions);
  };

  const persistComposerDraft = (draft: string) => {
    ui.composerDraft = draft;
    saveStoredComposerDraft(draft);
  };

  const clearComposerDraft = () => {
    persistComposerDraft("");
  };

  const clearReplyTarget = () => {
    ui.replyTargetCastId = undefined;
  };

  const toggleFeedInteraction = (castId: string, key: keyof FeedInteractionState) => {
    const nextInteraction = {
      ...feedInteractionState(ui, castId),
      [key]: !feedInteractionState(ui, castId)[key]
    };

    if (!nextInteraction.liked && !nextInteraction.recasted) {
      delete ui.feedInteractions[castId];
    } else {
      ui.feedInteractions[castId] = nextInteraction;
    }

    persistFeedInteractions();
    render();
  };

  const refreshFeedSnapshot = async () => {
    if (activeFeedRefreshPromise) {
      return activeFeedRefreshPromise;
    }

    const neynarApiKey = getEffectiveNeynarApiKey();
    const fid = state.farcaster.profile?.fid;

    activeFeedRefreshPromise = (async () => {
      setPartialState({
        feed: {
          status: "loading",
          snapshot: state.feed.snapshot
        }
      });

      try {
        const snapshot = await loadFeedSnapshot({
          fid,
          neynarApiKey
        });
        const nextTabs = new Set(getTimelineTabs(snapshot).map((tab) => tab.id));

        if (!nextTabs.has(ui.activeTimeline)) {
          ui.activeTimeline = feedAggregateTab.id;
        }

        setPartialState({
          feed: {
            status: "ready",
            snapshot
          }
        });
      } catch (error) {
        setPartialState({
          feed: {
            status: "error",
            snapshot: state.feed.snapshot,
            error: error instanceof Error ? error.message : "The feed snapshot request failed."
          }
        });
      } finally {
        activeFeedRefreshPromise = null;

        if (pullToRefresh.refreshing) {
          pullToRefresh.refreshing = false;
          pullToRefresh.shouldRefresh = false;
          pullToRefresh.distancePx = 0;
          pullToRefresh.startY = 0;
          syncPullToRefreshUi();
        }
      }
    })();

    return activeFeedRefreshPromise;
  };

  const handlePublishCast = () => {
    if (state.farcaster.status !== "connected") {
      return;
    }

    const draft = ui.composerDraft.trim();

    if (!draft) {
      return;
    }

    const nextCast = buildLocalCast(state, ui, draft);
    ui.localCasts = [nextCast, ...ui.localCasts];
    saveStoredLocalCasts(ui.localCasts);
    clearComposerDraft();
    clearReplyTarget();
    ui.activePane = "home";
    ui.activeTimeline = nextCast.channel;
    ui.overlay = "none";
    render();
  };

  const handleInstall = async () => {
    if (!state.installPrompt || state.pwaInstalled) {
      return;
    }

    await state.installPrompt.prompt();
    const choice = await state.installPrompt.userChoice;

    state.installPrompt = null;
    state.pwaInstalled = choice.outcome === "accepted" || state.pwaInstalled;
    render();
  };

  const handleWalletConnect = async () => {
    ui.overlay = "none";
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
    const existingProfile = state.farcaster.profile;

    setPartialState({
      farcaster: {
        status: "creating",
        profile: existingProfile
      }
    });

    try {
      const channel = await createFarcasterChannel({ domain, siweUri });
      const qrCodeDataUrl = await createChannelQrCode(channel.url);

      setPartialState({
        farcaster: {
          status: "pending",
          channelUrl: channel.url,
          qrCodeDataUrl,
          profile: existingProfile
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
                qrCodeDataUrl,
                profile: existingProfile
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
      saveStoredProfile(profile);
      void refreshFeedSnapshot();
    } catch (error) {
      setPartialState({
        farcaster: {
          status: "error",
          profile: existingProfile,
          error:
            error instanceof Error ? error.message : "Farcaster sign-in could not be completed."
        }
      });
    }
  };

  const handleXmtpConnect = async () => {
    if (!walletSession) {
      ui.overlay = "none";
      setPartialState({
        xmtp: {
          status: "error",
          error: "Connect a wallet before initializing XMTP."
        }
      });
      return;
    }

    ui.overlay = "none";
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

  const resolvePullRefreshContainer = (eventTarget: EventTarget | null): HTMLElement | null => {
    if (!(eventTarget instanceof Element)) {
      return null;
    }

    const shellContent = eventTarget.closest<HTMLElement>(".shell-content");

    if (!shellContent || !root.contains(shellContent)) {
      return null;
    }

    return shellContent;
  };

  const startPullToRefresh = (event: TouchEvent) => {
    if (
      !isPullToRefreshEnabled() ||
      pullToRefresh.refreshing ||
      state.feed.status === "loading"
    ) {
      return;
    }

    const shellContent = resolvePullRefreshContainer(event.target);
    const primaryTouch = event.touches[0];

    if (!shellContent || !primaryTouch || shellContent.scrollTop > 0) {
      return;
    }

    pullToRefresh.active = true;
    pullToRefresh.shouldRefresh = false;
    pullToRefresh.distancePx = 0;
    pullToRefresh.startY = primaryTouch.clientY;
    syncPullToRefreshUi();
  };

  const movePullToRefresh = (event: TouchEvent) => {
    if (!pullToRefresh.active) {
      return;
    }

    if (!isPullToRefreshEnabled()) {
      resetPullToRefresh();
      syncPullToRefreshUi();
      return;
    }

    const shellContent = root.querySelector<HTMLElement>(".shell-content");
    const primaryTouch = event.touches[0];

    if (!shellContent || !primaryTouch) {
      return;
    }

    if (shellContent.scrollTop > 0) {
      resetPullToRefresh();
      syncPullToRefreshUi();
      return;
    }

    const deltaY = primaryTouch.clientY - pullToRefresh.startY;

    if (deltaY <= 0) {
      pullToRefresh.distancePx = 0;
      pullToRefresh.shouldRefresh = false;
      syncPullToRefreshUi();
      return;
    }

    event.preventDefault();
    pullToRefresh.distancePx = Math.min(PULL_REFRESH_MAX_PX, deltaY * 0.48);
    pullToRefresh.shouldRefresh = pullToRefresh.distancePx >= PULL_REFRESH_THRESHOLD_PX;
    syncPullToRefreshUi();
  };

  const finishPullToRefresh = () => {
    if (!pullToRefresh.active) {
      return;
    }

    pullToRefresh.active = false;

    if (!pullToRefresh.shouldRefresh) {
      resetPullToRefresh();
      syncPullToRefreshUi();
      return;
    }

    pullToRefresh.refreshing = true;
    pullToRefresh.shouldRefresh = false;
    pullToRefresh.distancePx = PULL_REFRESH_HOLD_PX;
    syncPullToRefreshUi();
    void refreshFeedSnapshot();
  };

  root.addEventListener("touchstart", startPullToRefresh, { passive: true });
  root.addEventListener("touchmove", movePullToRefresh, { passive: false });
  root.addEventListener("touchend", finishPullToRefresh);
  root.addEventListener("touchcancel", () => {
    if (pullToRefresh.refreshing) {
      return;
    }

    resetPullToRefresh();
    syncPullToRefreshUi();
  });

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const target = event.target.closest<HTMLElement>(
      "[data-action], [data-nav], [data-timeline], [data-download-url]"
    );

    if (!target) {
      return;
    }

    const nav = target.dataset.nav as NavPane | undefined;
    const timeline = target.dataset.timeline as TimelineTab | undefined;
    const castId = target.dataset.castId;
    const downloadUrl = target.dataset.downloadUrl;
    const action = target.dataset.action;

    if (nav) {
      ui.activePane = nav;
      ui.overlay = "none";
      render();
      return;
    }

    if (timeline) {
      ui.activePane = "home";
      ui.activeTimeline = timeline;
      ui.overlay = "none";
      render();
      return;
    }

    if (downloadUrl) {
      const fileName = target.dataset.downloadFilename ?? inferMediaDownloadFileName(downloadUrl, "image");
      void downloadMediaAsset(downloadUrl, fileName);
      return;
    }

    switch (action) {
      case "close-overlay":
        ui.overlay = "none";
        render();
        break;
      case "profile":
        ui.overlay = ui.overlay === "profile" ? "none" : "profile";
        render();
        break;
      case "search":
        ui.overlay = ui.overlay === "search" ? "none" : "search";
        render(
          ui.overlay === "search"
            ? {
                field: "search",
                start: ui.searchQuery.length,
                end: ui.searchQuery.length
              }
            : undefined
        );
        break;
      case "compose":
        clearReplyTarget();
        ui.overlay = ui.overlay === "composer" ? "none" : "composer";
        render(
          ui.overlay === "composer"
            ? {
                field: "composer",
                start: ui.composerDraft.length,
                end: ui.composerDraft.length
              }
            : undefined
        );
        break;
      case "settings":
        ui.overlay = ui.overlay === "settings" ? "none" : "settings";
        render();
        break;
      case "reply-cast":
        if (!castId) {
          break;
        }

        ui.replyTargetCastId = castId;
        ui.overlay = "composer";
        render({
          field: "composer",
          start: ui.composerDraft.length,
          end: ui.composerDraft.length
        });
        break;
      case "recast-cast":
        if (!castId) {
          break;
        }

        toggleFeedInteraction(castId, "recasted");
        break;
      case "like-cast":
        if (!castId) {
          break;
        }

        toggleFeedInteraction(castId, "liked");
        break;
      case "share-cast":
        if (!castId) {
          break;
        }

        {
          const cast = getCastById(state, ui, castId);

          if (cast) {
            void shareCast(cast);
          }
        }
        break;
      case "clear-reply-target":
        clearReplyTarget();
        render({
          field: "composer",
          start: ui.composerDraft.length,
          end: ui.composerDraft.length
        });
        break;
      case "clear-draft":
        clearComposerDraft();
        render({ field: "composer", start: 0, end: 0 });
        break;
      case "publish-cast":
        handlePublishCast();
        break;
      case "save-feed-key": {
        const input = root.querySelector<HTMLInputElement>('[data-field="neynar-api-key"]');
        const nextKey = input?.value ?? "";

        if (nextKey.trim()) {
          saveStoredNeynarApiKey(nextKey);
        } else {
          clearStoredNeynarApiKey();
        }

        void refreshFeedSnapshot();
        break;
      }
      case "clear-feed-key":
        clearStoredNeynarApiKey();
        void refreshFeedSnapshot();
        break;
      case "refresh-feed":
        void refreshFeedSnapshot();
        break;
      case "install":
        void handleInstall();
        break;
      case "wallet":
        void handleWalletConnect();
        break;
      case "farcaster":
        void handleFarcasterConnect();
        break;
      case "xmtp":
        void handleXmtpConnect();
        break;
      default:
        break;
    }
  });

  root.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
      return;
    }

    if (event.target.dataset.input === "search") {
      ui.searchQuery = event.target.value;
      render({
        field: "search",
        start: event.target.selectionStart ?? event.target.value.length,
        end: event.target.selectionEnd ?? event.target.value.length
      });
      return;
    }

    if (event.target.dataset.input === "composer") {
      persistComposerDraft(event.target.value);
      render({
        field: "composer",
        start: event.target.selectionStart ?? event.target.value.length,
        end: event.target.selectionEnd ?? event.target.value.length
      });
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || ui.overlay === "none") {
      return;
    }

    ui.overlay = "none";
    render();
  });

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
  void refreshFeedSnapshot();
}
