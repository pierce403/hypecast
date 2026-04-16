import { getHypecastTestApi } from "../test-support";
import type { FarcasterProfile, FarcasterWriteSession } from "../types";

const NEYNAR_LOGIN_URL = "https://app.neynar.com/login";
const NEYNAR_LOGIN_ORIGIN = new URL(NEYNAR_LOGIN_URL).origin;
const NEYNAR_CLIENT_ID_STORAGE_KEY = "hypecast:neynar-client-id";
const FARCASTER_WRITE_SESSION_STORAGE_KEY = "hypecast:farcaster-write-session";
const SIWN_TIMEOUT_MS = 5 * 60_000;

interface UntrustedRecord {
  [key: string]: any;
}

export interface NeynarWriteRequestError extends Error {
  status?: number;
  code?: string;
}

function createIdemKey(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 16);
}

function resolveDefaultNeynarClientId(): string {
  return import.meta.env.VITE_NEYNAR_CLIENT_ID?.trim() ?? "";
}

function normalizeProfileFromSiwn(data: UntrustedRecord, fid: number): FarcasterProfile {
  const user = data.user ?? {};
  const profile = user.profile ?? {};
  const bio = profile.bio ?? user.bio ?? {};
  const pfp = user.pfp ?? {};

  return {
    fid,
    username: typeof user.username === "string" ? user.username : undefined,
    displayName:
      typeof user.display_name === "string"
        ? user.display_name
        : typeof user.displayName === "string"
          ? user.displayName
          : undefined,
    bio: typeof bio.text === "string" ? bio.text : undefined,
    pfpUrl:
      typeof user.pfp_url === "string"
        ? user.pfp_url
        : typeof pfp.url === "string"
          ? pfp.url
          : undefined
  };
}

function normalizeWriteSession(
  data: UntrustedRecord,
  options: {
    clientId: string;
    apiKey: string;
  }
): { session: FarcasterWriteSession; profile: FarcasterProfile } {
  const rawFid = data.fid ?? data.user?.fid;
  const fid = typeof rawFid === "number" ? rawFid : Number(rawFid);
  const signerUuid = typeof data.signer_uuid === "string" ? data.signer_uuid.trim() : "";

  if (!Number.isFinite(fid) || fid <= 0 || !signerUuid) {
    throw new Error("Neynar sign-in did not return a valid signer session.");
  }

  const profile = normalizeProfileFromSiwn(data, fid);

  return {
    session: {
      fid,
      signerUuid,
      clientId: options.clientId,
      apiKey: options.apiKey,
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      pfpUrl: profile.pfpUrl
    },
    profile
  };
}

function loadStoredJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as T;
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

async function parseNeynarError(response: Response): Promise<NeynarWriteRequestError> {
  const error = new Error(`Neynar write request failed with ${response.status}.`) as NeynarWriteRequestError;
  error.status = response.status;

  try {
    const payload = (await response.json()) as UntrustedRecord;

    if (typeof payload.message === "string" && payload.message.trim()) {
      error.message = payload.message.trim();
    } else if (typeof payload.error === "string" && payload.error.trim()) {
      error.message = payload.error.trim();
    }

    if (typeof payload.code === "string") {
      error.code = payload.code;
    } else if (typeof payload.errorResponse?.code === "string") {
      error.code = payload.errorResponse.code;
    }
  } catch {
    // Fall back to the default status message.
  }

  return error;
}

function sessionMatchesCredentials(
  session: FarcasterWriteSession | null | undefined,
  options: {
    clientId: string;
    apiKey: string;
  }
): boolean {
  if (!session) {
    return false;
  }

  return session.clientId === options.clientId && session.apiKey === options.apiKey;
}

function openNeynarPopup(clientId: string): Window | null {
  const authUrl = new URL(NEYNAR_LOGIN_URL);
  authUrl.searchParams.set("client_id", clientId);

  const isDesktop = window.matchMedia("(min-width: 800px)").matches;
  const width = 600;
  const height = 700;
  const left = Math.round(window.screen.width / 2 - width / 2);
  const top = Math.round(window.screen.height / 2 - height / 2);
  const windowFeatures = `width=${width},height=${height},top=${top},left=${left}`;
  const windowOptions = isDesktop ? windowFeatures : "fullscreen=yes";

  return window.open(authUrl.toString(), "_blank", windowOptions);
}

export function loadStoredNeynarClientId(): string {
  try {
    return window.localStorage.getItem(NEYNAR_CLIENT_ID_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function getDefaultNeynarClientId(): string {
  return resolveDefaultNeynarClientId();
}

export function getEffectiveNeynarClientId(): string {
  return loadStoredNeynarClientId() || getDefaultNeynarClientId();
}

export function saveStoredNeynarClientId(value: string): void {
  const nextValue = value.trim();

  if (!nextValue) {
    clearStoredNeynarClientId();
    return;
  }

  try {
    window.localStorage.setItem(NEYNAR_CLIENT_ID_STORAGE_KEY, nextValue);
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

export function clearStoredNeynarClientId(): void {
  try {
    window.localStorage.removeItem(NEYNAR_CLIENT_ID_STORAGE_KEY);
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

export function loadStoredFarcasterWriteSession(): FarcasterWriteSession | undefined {
  const session = loadStoredJson<FarcasterWriteSession>(FARCASTER_WRITE_SESSION_STORAGE_KEY);

  if (
    !session ||
    typeof session.fid !== "number" ||
    typeof session.signerUuid !== "string" ||
    typeof session.clientId !== "string" ||
    typeof session.apiKey !== "string"
  ) {
    return undefined;
  }

  return {
    fid: session.fid,
    signerUuid: session.signerUuid.trim(),
    clientId: session.clientId.trim(),
    apiKey: session.apiKey.trim(),
    username: typeof session.username === "string" ? session.username : undefined,
    displayName: typeof session.displayName === "string" ? session.displayName : undefined,
    bio: typeof session.bio === "string" ? session.bio : undefined,
    pfpUrl: typeof session.pfpUrl === "string" ? session.pfpUrl : undefined
  };
}

export function saveStoredFarcasterWriteSession(session: FarcasterWriteSession): void {
  saveStoredJson(FARCASTER_WRITE_SESSION_STORAGE_KEY, session);
}

export function clearStoredFarcasterWriteSession(): void {
  removeStoredValue(FARCASTER_WRITE_SESSION_STORAGE_KEY);
}

export function hasMatchingFarcasterWriteSession(options: {
  clientId: string;
  apiKey: string;
}): boolean {
  return sessionMatchesCredentials(loadStoredFarcasterWriteSession(), options);
}

export function isNeynarPermissionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as NeynarWriteRequestError;
  return (
    candidate.status === 401 ||
    candidate.status === 403 ||
    candidate.code === "InsufficientPermission"
  );
}

export async function connectFarcasterWriteAccess(options: {
  clientId: string;
  apiKey: string;
}): Promise<{ session: FarcasterWriteSession; profile: FarcasterProfile }> {
  const testApi = getHypecastTestApi();
  const clientId = options.clientId.trim();
  const apiKey = options.apiKey.trim();

  if (!clientId) {
    throw new Error("A Neynar client ID is required to request write access.");
  }

  if (!apiKey) {
    throw new Error("A matching Neynar API key is required to request write access.");
  }

  if (testApi?.connectFarcasterWriteAccess) {
    const result = await testApi.connectFarcasterWriteAccess({ clientId, apiKey });
    return normalizeWriteSession(result as UntrustedRecord, { clientId, apiKey });
  }

  const popup = openNeynarPopup(clientId);

  if (!popup) {
    throw new Error("The Neynar sign-in popup was blocked. Allow popups and try again.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(closedPollId);
      window.removeEventListener("message", handleMessage);
    };

    const resolveOnce = (value: { session: FarcasterWriteSession; profile: FarcasterProfile }) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(value);
    };

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== NEYNAR_LOGIN_ORIGIN) {
        return;
      }

      const data = event.data as UntrustedRecord;

      if (data?.is_authenticated !== true) {
        return;
      }

      try {
        if (!popup.closed) {
          popup.close();
        }
      } catch {
        // Ignore close errors.
      }

      try {
        resolveOnce(normalizeWriteSession(data, { clientId, apiKey }));
      } catch (error) {
        rejectOnce(
          error instanceof Error
            ? error
            : new Error("Neynar sign-in returned an invalid write-access payload.")
        );
      }
    };

    const timeoutId = window.setTimeout(() => {
      try {
        if (!popup.closed) {
          popup.close();
        }
      } catch {
        // Ignore close errors.
      }

      rejectOnce(new Error("Neynar sign-in timed out before write access was approved."));
    }, SIWN_TIMEOUT_MS);

    const closedPollId = window.setInterval(() => {
      if (!popup.closed) {
        return;
      }

      rejectOnce(new Error("Neynar sign-in was closed before it completed."));
    }, 500);

    window.addEventListener("message", handleMessage, false);
  });
}

export async function publishReaction(options: {
  apiKey: string;
  signerUuid: string;
  reactionType: "like" | "recast";
  target: string;
  targetAuthorFid?: number;
  remove?: boolean;
}): Promise<void> {
  const testApi = getHypecastTestApi();

  if (testApi?.publishReaction) {
    await testApi.publishReaction(options);
    return;
  }

  const response = await fetch("https://api.neynar.com/v2/farcaster/reaction/", {
    method: options.remove ? "DELETE" : "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": options.apiKey
    },
    body: JSON.stringify({
      signer_uuid: options.signerUuid,
      reaction_type: options.reactionType,
      target: options.target,
      target_author_fid: options.targetAuthorFid,
      idem: createIdemKey()
    })
  });

  if (!response.ok) {
    throw await parseNeynarError(response);
  }
}

export async function publishCast(options: {
  apiKey: string;
  signerUuid: string;
  text: string;
  parent?: string;
  parentAuthorFid?: number;
}): Promise<{ hash: string }> {
  const testApi = getHypecastTestApi();

  if (testApi?.publishCast) {
    return testApi.publishCast(options);
  }

  const response = await fetch("https://api.neynar.com/v2/farcaster/cast/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": options.apiKey
    },
    body: JSON.stringify({
      signer_uuid: options.signerUuid,
      text: options.text,
      parent: options.parent,
      parent_author_fid: options.parentAuthorFid,
      idem: createIdemKey()
    })
  });

  if (!response.ok) {
    throw await parseNeynarError(response);
  }

  const payload = (await response.json()) as UntrustedRecord;
  const hash = typeof payload.cast?.hash === "string" ? payload.cast.hash : "";

  if (!hash) {
    throw new Error("Neynar publish cast response did not include a cast hash.");
  }

  return { hash };
}
