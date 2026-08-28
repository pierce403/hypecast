import { getHypecastTestApi } from "../test-support";
import {
  forgetFarcasterSignerVault,
  loadFarcasterSignerVault,
  markFarcasterSignerVaultVerified,
  normalizeCustodyAddress,
  saveFarcasterSignerVault,
  type FarcasterSignerVaultIdentity
} from "./farcaster-vault";

const DEFAULT_NEYNAR_SNAPCHAIN_BASE_URL = "https://snapchain-api.neynar.com";
const DEFAULT_HAATZ_BASE_URL = "https://haatz.quilibrium.com";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_SIGNER_VERIFY_ATTEMPTS = 5;
const DEFAULT_SIGNER_VERIFY_DELAY_MS = 600;
const DEFAULT_MESSAGE_READBACK_ATTEMPTS = 2;
const DEFAULT_MESSAGE_READBACK_DELAY_MS = 350;
const KEY_AUTHORIZATION_DEADLINE_SECONDS = 60 * 60;
const LOCAL_TEST_SESSION_STORAGE_KEY = "hypecast:farcaster-local-session";
const LOCAL_TEST_SIGNER_KEY_ID = "playwright-local-signer";
const CAST_HASH_BYTES = 20;

const MESSAGE_TYPE_BY_JSON_NAME: Record<string, number> = {
  MESSAGE_TYPE_CAST_ADD: 1,
  CAST_ADD: 1,
  MESSAGE_TYPE_CAST_REMOVE: 2,
  CAST_REMOVE: 2,
  MESSAGE_TYPE_REACTION_ADD: 3,
  REACTION_ADD: 3,
  MESSAGE_TYPE_REACTION_REMOVE: 4,
  REACTION_REMOVE: 4,
  MESSAGE_TYPE_LINK_ADD: 5,
  LINK_ADD: 5,
  MESSAGE_TYPE_LINK_REMOVE: 6,
  LINK_REMOVE: 6,
  MESSAGE_TYPE_VERIFICATION_ADD_ETH_ADDRESS: 7,
  VERIFICATION_ADD_ETH_ADDRESS: 7,
  MESSAGE_TYPE_VERIFICATION_REMOVE: 8,
  VERIFICATION_REMOVE: 8,
  MESSAGE_TYPE_USER_DATA_ADD: 11,
  USER_DATA_ADD: 11,
  MESSAGE_TYPE_USERNAME_PROOF: 12,
  USERNAME_PROOF: 12,
  MESSAGE_TYPE_FRAME_ACTION: 13,
  FRAME_ACTION: 13,
  MESSAGE_TYPE_LINK_COMPACT_STATE: 14,
  LINK_COMPACT_STATE: 14,
  MESSAGE_TYPE_LEND_STORAGE: 15,
  LEND_STORAGE: 15
};

type CoreModule = typeof import("@farcaster/core");
type CoreMessage = import("@farcaster/core").Message;
type CoreSigner = import("@farcaster/core").Signer;

export interface FarcasterTransportOptions {
  /** Neynar's API key. It is retained only in module memory for the active session. */
  neynarApiKey?: string;
  neynarBaseUrl?: string;
  /** Set false to disable the public Haatz fallback. */
  haatzBaseUrl?: string | false;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  signerVerificationAttempts?: number;
  signerVerificationDelayMs?: number;
  messageReadbackAttempts?: number;
  messageReadbackDelayMs?: number;
}

export interface ConnectLocalFarcasterAccountOptions extends FarcasterTransportOptions {
  fid: number;
  /** The FID custody secp256k1 private key, with or without a 0x prefix. */
  custodyPrivateKey: string;
  /** If supplied, it must be the address derived from custodyPrivateKey. */
  custodyAddress?: string;
  /** Optimism IdGateway transaction hash for an FID whose registration is still settling. */
  registrationTransactionHash?: string;
  storage?: Storage;
}

export interface LocalFarcasterSignerSession {
  fid: number;
  custodyAddress: `0x${string}`;
  signerPublicKey?: string;
  source: "vault" | "provisioned" | "test";
  nonce?: number;
  scopes: number[];
}

export interface FarcasterCastIdInput {
  fid: number;
  hash: string;
}

export type FarcasterCastParentInput = FarcasterCastIdInput | { url: string };

export type FarcasterCastEmbedInput = { url: string } | { castId: FarcasterCastIdInput };

export interface PublishSignedCastOptions {
  text: string;
  parent?: FarcasterCastParentInput;
  embeds?: FarcasterCastEmbedInput[];
  mentions?: number[];
  mentionsPositions?: number[];
  castType?: "cast" | "long" | "ten-k";
}

export interface PublishSignedReplyOptions extends Omit<PublishSignedCastOptions, "parent"> {
  parent: FarcasterCastParentInput;
}

export interface PublishSignedReactionOptions {
  reactionType: "like" | "recast";
  target: FarcasterCastIdInput | { url: string };
  remove?: boolean;
}

export interface RemoveSignedCastOptions {
  targetHash: string;
}

export interface PublishSignedLinkOptions {
  targetFid: number;
  type?: string;
  remove?: boolean;
  displayTimestamp?: number;
}

export type FarcasterProfileField =
  | "pfp"
  | "displayName"
  | "bio"
  | "url"
  | "username"
  | "location"
  | "twitter"
  | "github"
  | "banner"
  | "primaryAddressEthereum"
  | "primaryAddressSolana"
  | "profileToken"
  | "liveAt";

export interface PublishSignedProfileOptions {
  type: FarcasterProfileField;
  value: string;
}

export type FarcasterMessageReadback = "verified" | "pending" | "not-supported" | "test";

export interface SignedFarcasterSubmission {
  hash: string;
  submitResponse?: unknown;
  readback: FarcasterMessageReadback;
}

interface Gateway {
  kind: "neynar" | "haatz";
  baseUrl: string;
  headers: Record<string, string>;
}

interface TransportRuntime {
  gateways: Gateway[];
  fetchImpl: typeof fetch;
  requestTimeoutMs: number;
  signerVerificationAttempts: number;
  signerVerificationDelayMs: number;
  messageReadbackAttempts: number;
  messageReadbackDelayMs: number;
}

interface NetworkSigner {
  key: string;
  keyType: number;
  scopes: number[];
  expiresAt?: number;
  nonce?: number;
}

interface SignerNetworkState {
  signers: NetworkSigner[];
  currentUserNonce: number;
  gaslessSignerCount?: number;
  gaslessSignerLimit?: number;
}

interface RealActiveSigner extends FarcasterSignerVaultIdentity {
  mode: "real";
  custodyAddress: `0x${string}`;
  source: "vault" | "provisioned";
  signerSeed: Uint8Array;
  signerPublicKey: string;
  scopes: number[];
  storage?: Storage;
  transport: TransportRuntime;
}

interface TestActiveSigner {
  mode: "test";
  fid: number;
  custodyAddress: `0x${string}`;
}

type ActiveSigner = RealActiveSigner | TestActiveSigner;

interface LocalSignerTestApi {
  connectLocalFarcasterAccount?: (options: {
    fid: number;
    custodyAddress?: string;
    registrationTransactionHash?: `0x${string}`;
  }) => Promise<Partial<LocalFarcasterSignerSession> | void>;
  publishSignedCast?: (options: PublishSignedCastOptions) => Promise<{ hash?: string } | void>;
  publishSignedReaction?: (options: PublishSignedReactionOptions) => Promise<unknown>;
  removeSignedCast?: (options: RemoveSignedCastOptions) => Promise<unknown>;
  publishSignedLink?: (options: PublishSignedLinkOptions) => Promise<unknown>;
  publishSignedProfile?: (options: PublishSignedProfileOptions) => Promise<unknown>;
}

let corePromise: Promise<CoreModule> | undefined;
let activeSigner: ActiveSigner | undefined;
let testSentinelLocked = false;

function loadCore(): Promise<CoreModule> {
  corePromise ??= import("@farcaster/core");
  return corePromise;
}

function getLocalSignerTestApi(): LocalSignerTestApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return getHypecastTestApi() as (ReturnType<typeof getHypecastTestApi> & LocalSignerTestApi) | undefined;
}

function normalizeFid(fid: number): number {
  if (!Number.isSafeInteger(fid) || fid <= 0) {
    throw new Error("Farcaster fid must be a positive safe integer.");
  }

  return fid;
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");

  if (!normalized) {
    throw new Error("Snapchain gateway URL cannot be empty.");
  }

  return normalized;
}

function normalizePositiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function normalizeNonnegativeInteger(
  value: number | undefined,
  fallback: number,
  label: string
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }

  return value;
}

function createTransport(options: FarcasterTransportOptions): TransportRuntime {
  const gateways: Gateway[] = [];
  const neynarApiKey = options.neynarApiKey?.trim();

  if (neynarApiKey) {
    gateways.push({
      kind: "neynar",
      baseUrl: normalizeBaseUrl(options.neynarBaseUrl ?? DEFAULT_NEYNAR_SNAPCHAIN_BASE_URL),
      headers: { "x-api-key": neynarApiKey }
    });
  }

  if (options.haatzBaseUrl !== false) {
    gateways.push({
      kind: "haatz",
      baseUrl: normalizeBaseUrl(options.haatzBaseUrl ?? DEFAULT_HAATZ_BASE_URL),
      headers: {}
    });
  }

  if (gateways.length === 0) {
    throw new Error("A Neynar API key or Haatz fallback is required for Snapchain writes.");
  }

  const globalFetch = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);

  if (!globalFetch) {
    throw new Error("Fetch is unavailable for Snapchain requests.");
  }

  return {
    gateways,
    fetchImpl: globalFetch,
    requestTimeoutMs: normalizePositiveInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "Snapchain request timeout"
    ),
    signerVerificationAttempts: normalizePositiveInteger(
      options.signerVerificationAttempts,
      DEFAULT_SIGNER_VERIFY_ATTEMPTS,
      "Signer verification attempts"
    ),
    signerVerificationDelayMs: normalizeNonnegativeInteger(
      options.signerVerificationDelayMs,
      DEFAULT_SIGNER_VERIFY_DELAY_MS,
      "Signer verification delay"
    ),
    messageReadbackAttempts: normalizeNonnegativeInteger(
      options.messageReadbackAttempts,
      DEFAULT_MESSAGE_READBACK_ATTEMPTS,
      "Message readback attempts"
    ),
    messageReadbackDelayMs: normalizeNonnegativeInteger(
      options.messageReadbackDelayMs,
      DEFAULT_MESSAGE_READBACK_DELAY_MS,
      "Message readback delay"
    )
  };
}

function parseHexBytes(value: string, expectedBytes: number, label: string): Uint8Array {
  const normalized = value.trim().toLowerCase().replace(/^0x/, "");

  if (!new RegExp(`^[0-9a-f]{${expectedBytes * 2}}$`).test(normalized)) {
    throw new Error(`${label} must be ${expectedBytes} bytes of hexadecimal data.`);
  }

  const bytes = new Uint8Array(expectedBytes);

  for (let index = 0; index < expectedBytes; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let value = "0x";

  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, "0");
  }

  return value;
}

function normalizeNetworkPublicKey(value: unknown): string | undefined {
  if (typeof value === "string") {
    const asHex = value.trim().toLowerCase();

    if (/^(0x)?[0-9a-f]{64}$/.test(asHex)) {
      return `0x${asHex.replace(/^0x/, "")}`;
    }

    try {
      const binary = atob(value);

      if (binary.length === 32) {
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }

        return bytesToHex(bytes);
      }
    } catch {
      return undefined;
    }
  }

  if (Array.isArray(value) && value.length === 32 && value.every(Number.isInteger)) {
    const bytes = Uint8Array.from(value as number[]);
    return bytesToHex(bytes);
  }

  return undefined;
}

function parseInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function parseMessageType(value: unknown): number | undefined {
  const numeric = parseInteger(value);

  if (numeric !== undefined) {
    return numeric;
  }

  return typeof value === "string"
    ? MESSAGE_TYPE_BY_JSON_NAME[value.trim().toUpperCase()]
    : undefined;
}

function parseKeyType(value: unknown): number | undefined {
  const numeric = parseInteger(value);

  if (numeric !== undefined) {
    return numeric;
  }

  if (typeof value === "string" && value.trim().toUpperCase().includes("ED25519")) {
    return 1;
  }

  return undefined;
}

function parseSignerNetworkState(value: unknown): SignerNetworkState {
  if (!value || typeof value !== "object") {
    throw new Error("Snapchain returned an invalid signer response.");
  }

  const outer = value as Record<string, unknown>;
  const payload =
    outer.result && typeof outer.result === "object"
      ? (outer.result as Record<string, unknown>)
      : outer;
  const currentUserNonce = parseInteger(payload.currentUserNonce);

  if (!Array.isArray(payload.signers) || currentUserNonce === undefined) {
    throw new Error("Snapchain returned an incomplete signer response.");
  }

  const signers: NetworkSigner[] = [];

  for (const candidate of payload.signers) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const signer = candidate as Record<string, unknown>;
    const key = normalizeNetworkPublicKey(signer.key);

    if (!key) {
      continue;
    }

    const scopes = Array.isArray(signer.scopes)
      ? signer.scopes
          .map(parseMessageType)
          .filter((scope): scope is number => scope !== undefined && scope > 0)
      : [];

    signers.push({
      key,
      keyType: parseKeyType(signer.keyType) ?? 0,
      scopes,
      expiresAt: parseInteger(signer.expiresAt),
      nonce: parseInteger(signer.nonce)
    });
  }

  return {
    signers,
    currentUserNonce,
    gaslessSignerCount: parseInteger(payload.gaslessSignerCount),
    gaslessSignerLimit: parseInteger(payload.gaslessSignerLimit)
  };
}

async function fetchWithTimeout(
  transport: TransportRuntime,
  input: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), transport.requestTimeoutMs);

  try {
    return await transport.fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readSignerState(transport: TransportRuntime, fid: number): Promise<SignerNetworkState> {
  const results = await Promise.allSettled(
    transport.gateways.map(async (gateway) => {
      const url = `${gateway.baseUrl}/v1/signersByFid?fid=${encodeURIComponent(String(fid))}`;
      const response = await fetchWithTimeout(transport, url, {
        method: "GET",
        headers: { accept: "application/json", ...gateway.headers }
      });

      if (!response.ok) {
        throw new Error(`Signer lookup failed with HTTP ${response.status}.`);
      }

      return parseSignerNetworkState(await response.json());
    })
  );
  const states = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );

  if (states.length > 0) {
    const gaslessSignerCounts = states.flatMap((state) =>
      state.gaslessSignerCount === undefined ? [] : [state.gaslessSignerCount]
    );
    const gaslessSignerLimits = states.flatMap((state) =>
      state.gaslessSignerLimit === undefined ? [] : [state.gaslessSignerLimit]
    );

    return {
      signers: states.flatMap((state) => state.signers),
      currentUserNonce: Math.max(...states.map((state) => state.currentUserNonce)),
      gaslessSignerCount:
        gaslessSignerCounts.length > 0 ? Math.max(...gaslessSignerCounts) : undefined,
      gaslessSignerLimit:
        gaslessSignerLimits.length > 0 ? Math.min(...gaslessSignerLimits) : undefined
    };
  }

  const lastFailure = results.at(-1);
  const reason = lastFailure?.status === "rejected" ? lastFailure.reason : undefined;
  throw new Error(
    reason instanceof Error
      ? `Unable to read Farcaster signer state: ${reason.message}`
      : "Unable to read Farcaster signer state."
  );
}

async function submitEncodedMessage(
  transport: TransportRuntime,
  encodedMessage: Uint8Array
): Promise<unknown> {
  let lastFailure: unknown;

  for (const gateway of transport.gateways) {
    try {
      const response = await fetchWithTimeout(transport, `${gateway.baseUrl}/v1/submitMessage`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/octet-stream",
          ...gateway.headers
        },
        body: encodedMessage as unknown as BodyInit
      });

      if (!response.ok) {
        throw new Error(`Message submission failed with HTTP ${response.status}.`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      return contentType.includes("application/json") ? await response.json() : await response.text();
    } catch (error) {
      lastFailure = error;
    }
  }

  throw new Error(
    lastFailure instanceof Error
      ? `Unable to submit the Farcaster message: ${lastFailure.message}`
      : "Unable to submit the Farcaster message."
  );
}

function hasEveryScope(actual: number[], required: readonly number[]): boolean {
  const scopeSet = new Set(actual);
  return required.every((scope) => scopeSet.has(scope));
}

function findValidNetworkSigner(
  state: SignerNetworkState,
  publicKey: string,
  requiredScopes: readonly number[]
): NetworkSigner | undefined {
  const nowUnix = Math.floor(Date.now() / 1000);

  return state.signers.find(
    (signer) =>
      signer.key === publicKey.toLowerCase() &&
      signer.keyType === 1 &&
      (!signer.expiresAt || signer.expiresAt > nowUnix) &&
      hasEveryScope(signer.scopes, requiredScopes)
  );
}

function findNetworkSigner(state: SignerNetworkState, publicKey: string): NetworkSigner | undefined {
  return state.signers.find((signer) => signer.key === publicKey.toLowerCase());
}

function isNetworkSignerExpired(signer: NetworkSigner | undefined): boolean {
  return signer?.expiresAt !== undefined && signer.expiresAt <= Math.floor(Date.now() / 1000);
}

function hubErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return "unknown validation error";
}

function unwrapHubResult<T>(
  result: { isErr: () => boolean; value?: T; error?: unknown },
  operation: string
): T {
  if (result.isErr() || result.value === undefined) {
    throw new Error(`${operation} failed: ${hubErrorMessage(result.error)}.`);
  }

  return result.value;
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }

  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function verifyProvisionedSigner(
  transport: TransportRuntime,
  fid: number,
  publicKey: string,
  requiredScopes: readonly number[],
  nonce: number
): Promise<NetworkSigner> {
  for (let attempt = 0; attempt < transport.signerVerificationAttempts; attempt += 1) {
    if (attempt > 0) {
      await delay(transport.signerVerificationDelayMs);
    }

    try {
      const state = await readSignerState(transport, fid);
      const signer = findValidNetworkSigner(state, publicKey, requiredScopes);

      if (signer && state.currentUserNonce >= nonce) {
        return signer;
      }
    } catch {
      // Propagation and transient gateway failures are retried within the bounded loop.
    }
  }

  throw new Error("Snapchain did not confirm the new Farcaster signer.");
}

async function submitPendingSignerAuthorization(options: {
  core: CoreModule;
  account: import("viem").LocalAccount;
  transport: TransportRuntime;
  fid: number;
  signerSeed: Uint8Array;
  publicKeyBytes: Uint8Array;
  scopes: import("@farcaster/core").MessageType[];
  ttlSeconds: number;
  nonce: number;
  authorizationDeadlineFarcaster: number;
  messageTimestampFarcaster: number;
  registrationTransactionHash?: Uint8Array;
}): Promise<unknown> {
  if (options.authorizationDeadlineFarcaster <= options.messageTimestampFarcaster) {
    throw new Error("The pending Farcaster signer authorization has expired.");
  }

  const custodySigner = new options.core.ViemLocalEip712Signer(options.account);
  const signerSeed = options.signerSeed.slice();

  try {
    const signer = new options.core.NobleEd25519Signer(signerSeed);
    const body = unwrapHubResult(
      await options.core.makeKeyAddBody(
        {
          fid: BigInt(options.fid),
          key: options.publicKeyBytes,
          scopes: options.scopes,
          ttl: options.ttlSeconds,
          nonce: options.nonce,
          deadline: options.authorizationDeadlineFarcaster,
          requestFid: BigInt(options.fid),
          keyType: options.core.KEY_TYPE_ED25519,
          ...(options.registrationTransactionHash
            ? { registrationTxHash: options.registrationTransactionHash }
            : {})
        },
        custodySigner,
        custodySigner
      ),
      "Farcaster signer authorization"
    );
    const keyAddMessage = unwrapHubResult(
      await options.core.makeKeyAdd(
        body,
        {
          fid: options.fid,
          network: options.core.FarcasterNetwork.MAINNET,
          timestamp: options.messageTimestampFarcaster
        },
        signer
      ),
      "Farcaster signer registration"
    );

    return submitEncodedMessage(
      options.transport,
      options.core.Message.encode(keyAddMessage).finish()
    );
  } finally {
    signerSeed.fill(0);
  }
}

function installActiveSigner(next: ActiveSigner): void {
  if (activeSigner?.mode === "real") {
    activeSigner.signerSeed.fill(0);
  }

  activeSigner = next;
  testSentinelLocked = false;
}

function readTestSentinel(): TestActiveSigner | undefined {
  if (testSentinelLocked || !getLocalSignerTestApi() || typeof window === "undefined") {
    return undefined;
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_TEST_SESSION_STORAGE_KEY);

    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (parsed.signerKeyId !== LOCAL_TEST_SIGNER_KEY_ID) {
      return undefined;
    }

    const fid = parseInteger(parsed.fid);

    if (!fid || fid <= 0) {
      return undefined;
    }

    const custodyAddress: `0x${string}` =
      typeof parsed.custodyAddress === "string" && /^0x[0-9a-fA-F]{40}$/.test(parsed.custodyAddress)
        ? normalizeCustodyAddress(parsed.custodyAddress)
        : "0x0000000000000000000000000000000000000000";

    return { mode: "test", fid, custodyAddress };
  } catch {
    return undefined;
  }
}

function requireActiveSigner(): ActiveSigner {
  const signer = activeSigner ?? readTestSentinel();

  if (!signer) {
    throw new Error("Unlock or import a Farcaster account before publishing.");
  }

  return signer;
}

function ensureMessageScope(active: RealActiveSigner, messageType: number): void {
  if (!active.scopes.includes(messageType)) {
    throw new Error("The active Farcaster signer is not authorized for this message type.");
  }
}

function testSubmission(hash?: string): SignedFarcasterSubmission {
  const normalized = hash && /^(0x)?[0-9a-fA-F]{40}$/.test(hash)
    ? `0x${hash.toLowerCase().replace(/^0x/, "")}`
    : `0x${"0".repeat(40)}`;

  return { hash: normalized, readback: "test" };
}

function makeReadbackPath(
  kind: "cast" | "reaction" | "link" | "profile",
  options: Record<string, string | number>
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(options)) {
    params.set(key, String(value));
  }

  const endpoint =
    kind === "cast"
      ? "castById"
      : kind === "reaction"
        ? "reactionById"
        : kind === "link"
          ? "linkById"
          : "userDataByFid";

  return `/v1/${endpoint}?${params.toString()}`;
}

async function tryMessageReadback(
  transport: TransportRuntime,
  path: string | undefined,
  expectedHash: string
): Promise<FarcasterMessageReadback> {
  if (!path) {
    return "not-supported";
  }

  if (transport.messageReadbackAttempts === 0) {
    return "pending";
  }

  for (let attempt = 0; attempt < transport.messageReadbackAttempts; attempt += 1) {
    if (attempt > 0) {
      await delay(transport.messageReadbackDelayMs);
    }

    for (const gateway of transport.gateways) {
      try {
        const response = await fetchWithTimeout(transport, `${gateway.baseUrl}${path}`, {
          method: "GET",
          headers: { accept: "application/json", ...gateway.headers }
        });

        if (response.ok) {
          const payload = (await response.json()) as unknown;

          if (payloadContainsHash(payload, expectedHash)) {
            return "verified";
          }
        }
      } catch {
        // A successful submission remains successful even if optional readback is unavailable.
      }
    }
  }

  return "pending";
}

function payloadContainsHash(payload: unknown, expectedHash: string): boolean {
  const normalizedExpected = expectedHash.toLowerCase().replace(/^0x/, "");
  const pending: unknown[] = [payload];
  let visited = 0;

  while (pending.length > 0 && visited < 10_000) {
    const value = pending.pop();
    visited += 1;

    if (typeof value === "string") {
      if (value.toLowerCase().replace(/^0x/, "") === normalizedExpected) {
        return true;
      }

      continue;
    }

    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }

    if (value && typeof value === "object") {
      pending.push(...Object.values(value as Record<string, unknown>));
    }
  }

  return false;
}

async function buildAndSubmit(
  messageType: number,
  build: (
    core: CoreModule,
    signer: CoreSigner,
    timestamp: number,
    fid: number
  ) => Promise<CoreMessage>,
  readbackPath: (fid: number, hash: string) => string | undefined
): Promise<SignedFarcasterSubmission> {
  const active = requireActiveSigner();

  if (active.mode !== "real") {
    throw new Error("The requested Farcaster test write is not configured.");
  }

  ensureMessageScope(active, messageType);
  const core = await loadCore();
  const seedCopy = active.signerSeed.slice();

  try {
    const signer = new core.NobleEd25519Signer(seedCopy);
    const timestamp = unwrapHubResult(core.getFarcasterTime(), "Farcaster clock");
    const message = await build(core, signer, timestamp, active.fid);
    const encoded = core.Message.encode(message).finish();
    const submitResponse = await submitEncodedMessage(active.transport, encoded);
    const hash = bytesToHex(message.hash);
    const readback = await tryMessageReadback(
      active.transport,
      readbackPath(active.fid, hash),
      hash
    );
    return { hash, submitResponse, readback };
  } finally {
    seedCopy.fill(0);
  }
}

export function hasActiveFarcasterSigner(): boolean {
  return activeSigner !== undefined || readTestSentinel() !== undefined;
}

export function getActiveFarcasterSignerSession(): LocalFarcasterSignerSession | undefined {
  const active = activeSigner ?? readTestSentinel();

  if (!active) {
    return undefined;
  }

  if (active.mode === "test") {
    return {
      fid: active.fid,
      custodyAddress: active.custodyAddress,
      source: "test",
      scopes: []
    };
  }

  return {
    fid: active.fid,
    custodyAddress: active.custodyAddress,
    signerPublicKey: active.signerPublicKey,
    source: active.source,
    scopes: [...active.scopes]
  };
}

export function lockActiveFarcasterSigner(): void {
  if (activeSigner?.mode === "real") {
    activeSigner.signerSeed.fill(0);
  }

  activeSigner = undefined;
  testSentinelLocked = true;
}

export function forgetActiveFarcasterSigner(identity?: FarcasterSignerVaultIdentity & { storage?: Storage }): void {
  const current = activeSigner;
  lockActiveFarcasterSigner();

  if (current?.mode === "real") {
    forgetFarcasterSignerVault(current, current.storage);
  } else if (identity) {
    forgetFarcasterSignerVault(identity, identity.storage);
  }

  if (getLocalSignerTestApi() && typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(LOCAL_TEST_SESSION_STORAGE_KEY);
    } catch {
      // Test-only storage may be unavailable; the in-memory sentinel is still locked.
    }
  }
}

export const lockFarcasterSigner = lockActiveFarcasterSigner;
export const forgetFarcasterSigner = forgetActiveFarcasterSigner;

export async function connectLocalFarcasterAccount(
  options: ConnectLocalFarcasterAccountOptions
): Promise<LocalFarcasterSignerSession> {
  const fid = normalizeFid(options.fid);
  const testApi = getLocalSignerTestApi();

  if (testApi?.connectLocalFarcasterAccount) {
    const response = await testApi.connectLocalFarcasterAccount({
      fid,
      custodyAddress: options.custodyAddress,
      registrationTransactionHash: options.registrationTransactionHash as
        | `0x${string}`
        | undefined
    });
    const responseAddress =
      response && typeof response.custodyAddress === "string"
        ? response.custodyAddress
        : options.custodyAddress;
    const custodyAddress: `0x${string}` = responseAddress && /^0x[0-9a-fA-F]{40}$/.test(responseAddress)
      ? normalizeCustodyAddress(responseAddress)
      : "0x0000000000000000000000000000000000000000";
    const session: LocalFarcasterSignerSession = {
      fid,
      custodyAddress,
      signerPublicKey:
        response && typeof response.signerPublicKey === "string"
          ? response.signerPublicKey
          : undefined,
      source: "test",
      scopes: []
    };
    installActiveSigner({ mode: "test", fid, custodyAddress });
    return session;
  }

  const custodyPrivateKey = parseHexBytes(
    options.custodyPrivateKey,
    32,
    "Farcaster custody private key"
  );

  try {
    const [{ privateKeyToAccount }, core] = await Promise.all([import("viem/accounts"), loadCore()]);
    const account = privateKeyToAccount(bytesToHex(custodyPrivateKey) as `0x${string}`);
    const custodyAddress = normalizeCustodyAddress(account.address);

    if (
      options.custodyAddress &&
      normalizeCustodyAddress(options.custodyAddress) !== custodyAddress
    ) {
      throw new Error("The imported custody private key does not match the expected address.");
    }

    const registrationTransactionHash =
      options.registrationTransactionHash === undefined
        ? undefined
        : bytesToHex(
            parseHexBytes(
              options.registrationTransactionHash,
              32,
              "Farcaster registration transaction hash"
            )
          );

    const transport = createTransport(options);
    const signerState = await readSignerState(transport, fid);
    const requiredScopes = [...core.ADMISSIBLE_KEY_ADD_SCOPES];
    const stored = await loadFarcasterSignerVault({
      fid,
      custodyAddress,
      custodyPrivateKey,
      storage: options.storage
    });

    if (stored) {
      const storedSeed = stored.signerSeed;
      let seedTransferred = false;

      try {
        const signer = new core.NobleEd25519Signer(storedSeed);
        const publicKeyBytes = unwrapHubResult(
          await signer.getSignerKey(),
          "Farcaster signer key derivation"
        );
        const derivedPublicKey = bytesToHex(publicKeyBytes);

        if (derivedPublicKey !== stored.metadata.publicKey) {
          throw new Error("The encrypted Farcaster signer does not match its stored public key.");
        }

        const storedNetworkSigner = findValidNetworkSigner(
          signerState,
          stored.metadata.publicKey,
          requiredScopes
        );

        if (storedNetworkSigner) {
          if (stored.metadata.status === "pending") {
            markFarcasterSignerVaultVerified({
              fid,
              custodyAddress,
              publicKey: stored.metadata.publicKey,
              nonce: stored.metadata.nonce,
              lastVerifiedAtUnix: Math.floor(Date.now() / 1000),
              storage: options.storage
            });
          }

          installActiveSigner({
            mode: "real",
            source: "vault",
            fid,
            custodyAddress,
            signerSeed: storedSeed,
            signerPublicKey: stored.metadata.publicKey,
            scopes: [...storedNetworkSigner.scopes],
            storage: options.storage,
            transport
          });
          seedTransferred = true;

          return {
            fid,
            custodyAddress,
            signerPublicKey: stored.metadata.publicKey,
            source: "vault",
            nonce: storedNetworkSigner.nonce ?? stored.metadata.nonce,
            scopes: [...storedNetworkSigner.scopes]
          };
        }

        if (stored.metadata.status === "pending") {
          const matchingNetworkSigner = findNetworkSigner(
            signerState,
            stored.metadata.publicKey
          );
          const currentFarcasterTimestamp = unwrapHubResult(
            core.getFarcasterTime(),
            "Farcaster clock"
          );
          const authorizationIsStale =
            stored.metadata.authorizationDeadlineFarcaster === undefined ||
            stored.metadata.authorizationDeadlineFarcaster <= currentFarcasterTimestamp;
          const nonceCannotBeAccepted =
            signerState.currentUserNonce >= stored.metadata.nonce;
          let pendingRegistrationTransactionHash =
            stored.metadata.registrationTransactionHash;

          if (
            !matchingNetworkSigner &&
            !authorizationIsStale &&
            !nonceCannotBeAccepted
          ) {
            if (!pendingRegistrationTransactionHash && registrationTransactionHash) {
              await saveFarcasterSignerVault({
                ...stored.metadata,
                registrationTransactionHash,
                custodyPrivateKey,
                signerSeed: storedSeed,
                storage: options.storage
              });
              pendingRegistrationTransactionHash = registrationTransactionHash;
            }

            await submitPendingSignerAuthorization({
              core,
              account,
              transport,
              fid,
              signerSeed: storedSeed,
              publicKeyBytes,
              scopes: stored.metadata.scopes as import("@farcaster/core").MessageType[],
              ttlSeconds: stored.metadata.ttlSeconds,
              nonce: stored.metadata.nonce,
              authorizationDeadlineFarcaster:
                stored.metadata.authorizationDeadlineFarcaster!,
              messageTimestampFarcaster: currentFarcasterTimestamp,
              registrationTransactionHash: pendingRegistrationTransactionHash
                ? parseHexBytes(
                    pendingRegistrationTransactionHash,
                    32,
                    "Farcaster registration transaction hash"
                  )
                : undefined
            });
            const verifiedSigner = await verifyProvisionedSigner(
              transport,
              fid,
              stored.metadata.publicKey,
              requiredScopes,
              stored.metadata.nonce
            );

            markFarcasterSignerVaultVerified({
              fid,
              custodyAddress,
              publicKey: stored.metadata.publicKey,
              nonce: stored.metadata.nonce,
              lastVerifiedAtUnix: Math.floor(Date.now() / 1000),
              storage: options.storage
            });
            installActiveSigner({
              mode: "real",
              source: "provisioned",
              fid,
              custodyAddress,
              signerSeed: storedSeed,
              signerPublicKey: stored.metadata.publicKey,
              scopes: [...verifiedSigner.scopes],
              storage: options.storage,
              transport
            });
            seedTransferred = true;

            return {
              fid,
              custodyAddress,
              signerPublicKey: stored.metadata.publicKey,
              source: "provisioned",
              nonce: stored.metadata.nonce,
              scopes: [...verifiedSigner.scopes]
            };
          }

          if (matchingNetworkSigner && !isNetworkSignerExpired(matchingNetworkSigner)) {
            throw new Error(
              "Snapchain returned the pending signer with unexpected authorization state; the encrypted recovery record was retained."
            );
          }

          if (!authorizationIsStale && !nonceCannotBeAccepted) {
            throw new Error(
              "The pending Farcaster signer could not be resolved safely; its encrypted recovery record was retained."
            );
          }

          forgetFarcasterSignerVault({ fid, custodyAddress }, options.storage);
        } else {
          throw new Error(
            "The verified Farcaster signer was not confirmed by current gateway state; its encrypted vault was retained. Forget it explicitly before provisioning a replacement."
          );
        }
      } finally {
        if (!seedTransferred) {
          storedSeed.fill(0);
        }
      }
    }

    if (
      signerState.gaslessSignerLimit !== undefined &&
      signerState.gaslessSignerCount !== undefined &&
      signerState.gaslessSignerCount >= signerState.gaslessSignerLimit
    ) {
      throw new Error("This Farcaster account has reached its active gasless signer limit.");
    }

    if (signerState.currentUserNonce >= Number.MAX_SAFE_INTEGER) {
      throw new Error("The Farcaster signer nonce cannot be incremented safely.");
    }

    const nonce = signerState.currentUserNonce + 1;
    const signerSeed = crypto.getRandomValues(new Uint8Array(32));

    try {
      const signer = new core.NobleEd25519Signer(signerSeed);
      const publicKeyBytes = unwrapHubResult(
        await signer.getSignerKey(),
        "Farcaster signer key derivation"
      );
      const signerPublicKey = bytesToHex(publicKeyBytes);
      const farcasterTimestamp = unwrapHubResult(core.getFarcasterTime(), "Farcaster clock");
      const authorizationDeadlineFarcaster =
        farcasterTimestamp + KEY_AUTHORIZATION_DEADLINE_SECONDS;
      const nowUnix = Math.floor(Date.now() / 1000);

      await saveFarcasterSignerVault({
        fid,
        custodyAddress,
        status: "pending",
        publicKey: signerPublicKey,
        nonce,
        scopes: [...requiredScopes],
        ttlSeconds: core.MAX_KEY_TTL_SECONDS,
        createdAtUnix: nowUnix,
        authorizationDeadlineFarcaster,
        registrationTransactionHash,
        custodyPrivateKey,
        signerSeed,
        storage: options.storage
      });
      await submitPendingSignerAuthorization({
        core,
        account,
        transport,
        fid,
        signerSeed,
        publicKeyBytes,
        scopes: requiredScopes,
        ttlSeconds: core.MAX_KEY_TTL_SECONDS,
        nonce,
        authorizationDeadlineFarcaster,
        messageTimestampFarcaster: farcasterTimestamp,
        registrationTransactionHash: registrationTransactionHash
          ? parseHexBytes(
              registrationTransactionHash,
              32,
              "Farcaster registration transaction hash"
            )
          : undefined
      });
      const verifiedSigner = await verifyProvisionedSigner(
        transport,
        fid,
        signerPublicKey,
        requiredScopes,
        nonce
      );

      markFarcasterSignerVaultVerified({
        fid,
        custodyAddress,
        publicKey: signerPublicKey,
        nonce,
        lastVerifiedAtUnix: Math.floor(Date.now() / 1000),
        storage: options.storage
      });

      installActiveSigner({
        mode: "real",
        source: "provisioned",
        fid,
        custodyAddress,
        signerSeed,
        signerPublicKey,
        scopes: [...verifiedSigner.scopes],
        storage: options.storage,
        transport
      });

      return {
        fid,
        custodyAddress,
        signerPublicKey,
        source: "provisioned",
        nonce,
        scopes: [...verifiedSigner.scopes]
      };
    } catch (error) {
      signerSeed.fill(0);
      throw error;
    }
  } finally {
    custodyPrivateKey.fill(0);
  }
}

export async function publishSignedCast(
  options: PublishSignedCastOptions
): Promise<SignedFarcasterSubmission> {
  const active = requireActiveSigner();

  if (active.mode === "test") {
    const response = await getLocalSignerTestApi()?.publishSignedCast?.(options);
    return testSubmission(response?.hash);
  }

  const core = await loadCore();
  const messageType = core.MessageType.CAST_ADD;

  return buildAndSubmit(
    messageType,
    async (loadedCore, signer, timestamp, fid) => {
      const parentCastId =
        options.parent && "fid" in options.parent
          ? {
              fid: normalizeFid(options.parent.fid),
              hash: parseHexBytes(options.parent.hash, CAST_HASH_BYTES, "Parent cast hash")
            }
          : undefined;
      const parentUrl = options.parent && "url" in options.parent ? options.parent.url : undefined;
      const embeds = (options.embeds ?? []).map((embed) =>
        "url" in embed
          ? { url: embed.url }
          : {
              castId: {
                fid: normalizeFid(embed.castId.fid),
                hash: parseHexBytes(embed.castId.hash, CAST_HASH_BYTES, "Embedded cast hash")
              }
            }
      );
      const castType =
        options.castType === "long"
          ? loadedCore.CastType.LONG_CAST
          : options.castType === "ten-k"
            ? loadedCore.CastType.TEN_K_CAST
            : loadedCore.CastType.CAST;
      const result = await loadedCore.makeCastAdd(
        {
          embedsDeprecated: [],
          mentions: [...(options.mentions ?? [])],
          parentCastId,
          parentUrl,
          text: options.text,
          mentionsPositions: [...(options.mentionsPositions ?? [])],
          embeds,
          type: castType
        },
        { fid, network: loadedCore.FarcasterNetwork.MAINNET, timestamp },
        signer
      );
      return unwrapHubResult(result, "Signed cast creation");
    },
    (fid, hash) => makeReadbackPath("cast", { fid, hash })
  );
}

export function publishSignedReply(
  options: PublishSignedReplyOptions
): Promise<SignedFarcasterSubmission> {
  return publishSignedCast(options);
}

export async function publishSignedReaction(
  options: PublishSignedReactionOptions
): Promise<SignedFarcasterSubmission> {
  const active = requireActiveSigner();

  if (active.mode === "test") {
    await getLocalSignerTestApi()?.publishSignedReaction?.(options);
    return testSubmission();
  }

  const core = await loadCore();
  const messageType = options.remove
    ? core.MessageType.REACTION_REMOVE
    : core.MessageType.REACTION_ADD;

  return buildAndSubmit(
    messageType,
    async (loadedCore, signer, timestamp, fid) => {
      const type =
        options.reactionType === "like"
          ? loadedCore.ReactionType.LIKE
          : loadedCore.ReactionType.RECAST;
      const targetCastId =
        "fid" in options.target
          ? {
              fid: normalizeFid(options.target.fid),
              hash: parseHexBytes(options.target.hash, CAST_HASH_BYTES, "Reaction target hash")
            }
          : undefined;
      const targetUrl = "url" in options.target ? options.target.url : undefined;
      const body = { type, targetCastId, targetUrl };
      const dataOptions = {
        fid,
        network: loadedCore.FarcasterNetwork.MAINNET,
        timestamp
      };

      if (options.remove) {
        return unwrapHubResult(
          await loadedCore.makeReactionRemove(body, dataOptions, signer),
          "Signed reaction removal"
        );
      }

      return unwrapHubResult(
        await loadedCore.makeReactionAdd(body, dataOptions, signer),
        "Signed reaction creation"
      );
    },
    (fid) => {
      if (!("fid" in options.target)) {
        return undefined;
      }

      return makeReadbackPath("reaction", {
        fid,
        reaction_type: options.reactionType === "like" ? 1 : 2,
        target_fid: options.target.fid,
        target_hash: options.target.hash
      });
    }
  );
}

export async function removeSignedCast(
  options: RemoveSignedCastOptions
): Promise<SignedFarcasterSubmission> {
  const active = requireActiveSigner();

  if (active.mode === "test") {
    await getLocalSignerTestApi()?.removeSignedCast?.(options);
    return testSubmission();
  }

  const core = await loadCore();

  return buildAndSubmit(
    core.MessageType.CAST_REMOVE,
    async (loadedCore, signer, timestamp, fid) => {
      const result = await loadedCore.makeCastRemove(
        { targetHash: parseHexBytes(options.targetHash, CAST_HASH_BYTES, "Cast hash") },
        { fid, network: loadedCore.FarcasterNetwork.MAINNET, timestamp },
        signer
      );
      return unwrapHubResult(result, "Signed cast removal");
    },
    () => undefined
  );
}

export async function publishSignedLink(
  options: PublishSignedLinkOptions
): Promise<SignedFarcasterSubmission> {
  const active = requireActiveSigner();

  if (active.mode === "test") {
    await getLocalSignerTestApi()?.publishSignedLink?.(options);
    return testSubmission();
  }

  const core = await loadCore();
  const messageType = options.remove ? core.MessageType.LINK_REMOVE : core.MessageType.LINK_ADD;
  const linkType = options.type?.trim() || "follow";

  return buildAndSubmit(
    messageType,
    async (loadedCore, signer, timestamp, fid) => {
      const body = {
        type: linkType,
        targetFid: normalizeFid(options.targetFid),
        displayTimestamp: options.displayTimestamp
      };
      const dataOptions = {
        fid,
        network: loadedCore.FarcasterNetwork.MAINNET,
        timestamp
      };

      if (options.remove) {
        return unwrapHubResult(
          await loadedCore.makeLinkRemove(body, dataOptions, signer),
          "Signed link removal"
        );
      }

      return unwrapHubResult(
        await loadedCore.makeLinkAdd(body, dataOptions, signer),
        "Signed link creation"
      );
    },
    (fid) =>
      makeReadbackPath("link", {
        fid,
        target_fid: options.targetFid,
        link_type: linkType
      })
  );
}

export const publishSignedFollow = publishSignedLink;

export async function publishSignedProfile(
  options: PublishSignedProfileOptions
): Promise<SignedFarcasterSubmission> {
  const active = requireActiveSigner();

  if (active.mode === "test") {
    await getLocalSignerTestApi()?.publishSignedProfile?.(options);
    return testSubmission();
  }

  const core = await loadCore();
  const typeByField: Record<FarcasterProfileField, import("@farcaster/core").UserDataType> = {
    pfp: core.UserDataType.PFP,
    displayName: core.UserDataType.DISPLAY,
    bio: core.UserDataType.BIO,
    url: core.UserDataType.URL,
    username: core.UserDataType.USERNAME,
    location: core.UserDataType.LOCATION,
    twitter: core.UserDataType.TWITTER,
    github: core.UserDataType.GITHUB,
    banner: core.UserDataType.BANNER,
    primaryAddressEthereum: core.UserDataType.USER_DATA_PRIMARY_ADDRESS_ETHEREUM,
    primaryAddressSolana: core.UserDataType.USER_DATA_PRIMARY_ADDRESS_SOLANA,
    profileToken: core.UserDataType.PROFILE_TOKEN,
    liveAt: core.UserDataType.LIVE_AT
  };
  const userDataType = typeByField[options.type];

  return buildAndSubmit(
    core.MessageType.USER_DATA_ADD,
    async (loadedCore, signer, timestamp, fid) => {
      const result = await loadedCore.makeUserDataAdd(
        { type: userDataType, value: options.value },
        { fid, network: loadedCore.FarcasterNetwork.MAINNET, timestamp },
        signer
      );
      return unwrapHubResult(result, "Signed profile update");
    },
    (fid) => makeReadbackPath("profile", { fid, user_data_type: userDataType })
  );
}

export { DEFAULT_HAATZ_BASE_URL, DEFAULT_NEYNAR_SNAPCHAIN_BASE_URL };
