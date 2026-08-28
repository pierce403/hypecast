const VAULT_VERSION = 2 as const;
const LEGACY_VAULT_VERSION = 1 as const;
const VAULT_STORAGE_PREFIX = "hypecast:farcaster-signer-v1";
const HKDF_CONTEXT_PREFIX = "hypecast:farcaster-signer-vault:v1";
const SALT_BYTES = 16;
const IV_BYTES = 12;
const SIGNER_SEED_BYTES = 32;

export interface FarcasterSignerVaultIdentity {
  fid: number;
  custodyAddress: string;
}

export interface FarcasterSignerVaultMetadata extends FarcasterSignerVaultIdentity {
  status: "pending" | "verified";
  publicKey: string;
  nonce: number;
  scopes: number[];
  ttlSeconds: number;
  createdAtUnix: number;
  lastVerifiedAtUnix?: number;
  /** Farcaster epoch deadline on the custody authorization for a pending KEY_ADD. */
  authorizationDeadlineFarcaster?: number;
  /** Optimism IdGateway registration transaction used before the FID event has settled. */
  registrationTransactionHash?: string;
}

export interface SaveFarcasterSignerVaultOptions extends FarcasterSignerVaultMetadata {
  custodyPrivateKey: Uint8Array;
  signerSeed: Uint8Array;
  storage?: Storage;
}

export interface LoadFarcasterSignerVaultOptions extends FarcasterSignerVaultIdentity {
  custodyPrivateKey: Uint8Array;
  storage?: Storage;
}

export interface MarkFarcasterSignerVaultVerifiedOptions
  extends FarcasterSignerVaultIdentity {
  publicKey: string;
  nonce: number;
  lastVerifiedAtUnix: number;
  storage?: Storage;
}

export interface DecryptedFarcasterSignerVault {
  metadata: FarcasterSignerVaultMetadata;
  /** A new byte array owned by the caller. Clear it as soon as it is no longer needed. */
  signerSeed: Uint8Array;
}

interface StoredFarcasterSignerVault extends FarcasterSignerVaultMetadata {
  version: typeof VAULT_VERSION | typeof LEGACY_VAULT_VERSION;
  salt: string;
  iv: string;
  ciphertext: string;
}

function normalizeFid(fid: number): number {
  if (!Number.isSafeInteger(fid) || fid <= 0) {
    throw new Error("Farcaster fid must be a positive safe integer.");
  }

  return fid;
}

export function normalizeCustodyAddress(address: string): `0x${string}` {
  const normalized = address.trim().toLowerCase();

  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error("Farcaster custody address must be a 20-byte hex address.");
  }

  return normalized as `0x${string}`;
}

function normalizePublicKey(publicKey: string): string {
  const normalized = publicKey.trim().toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Farcaster signer public key must be 32 bytes.");
  }

  return normalized;
}

function normalizeRegistrationTransactionHash(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Farcaster registration transaction hash must be 32 bytes.");
  }

  return normalized;
}

function resolveStorage(storage?: Storage): Storage {
  if (storage) {
    return storage;
  }

  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }

  throw new Error("Browser storage is unavailable for the Farcaster signer vault.");
}

function resolveCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error("Web Crypto is unavailable for the Farcaster signer vault.");
  }

  return globalThis.crypto;
}

function assertPrivateKey(privateKey: Uint8Array): void {
  if (privateKey.byteLength !== 32) {
    throw new Error("Farcaster custody private key must be 32 bytes.");
  }
}

function assertSignerSeed(seed: Uint8Array): void {
  if (seed.byteLength !== SIGNER_SEED_BYTES) {
    throw new Error("Farcaster signer seed must be 32 bytes.");
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;

  try {
    binary = atob(value);
  } catch {
    throw new Error("The stored Farcaster signer vault is malformed.");
  }

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function vaultContext(identity: FarcasterSignerVaultIdentity): Uint8Array {
  const fid = normalizeFid(identity.fid);
  const custodyAddress = normalizeCustodyAddress(identity.custodyAddress);
  return new TextEncoder().encode(`${HKDF_CONTEXT_PREFIX}:${fid}:${custodyAddress}`);
}

function vaultStorageKey(identity: FarcasterSignerVaultIdentity): string {
  const fid = normalizeFid(identity.fid);
  const custodyAddress = normalizeCustodyAddress(identity.custodyAddress);
  return `${VAULT_STORAGE_PREFIX}:${fid}:${custodyAddress}`;
}

async function deriveVaultKey(
  custodyPrivateKey: Uint8Array,
  salt: Uint8Array,
  context: Uint8Array,
  usages: KeyUsage[]
): Promise<CryptoKey> {
  assertPrivateKey(custodyPrivateKey);
  const webCrypto = resolveCrypto();
  const sourceKey = await webCrypto.subtle.importKey(
    "raw",
    custodyPrivateKey as BufferSource,
    "HKDF",
    false,
    ["deriveKey"]
  );

  return webCrypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: context as BufferSource
    },
    sourceKey,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

function validateMetadata(value: StoredFarcasterSignerVault): FarcasterSignerVaultMetadata {
  const fid = normalizeFid(value.fid);
  const custodyAddress = normalizeCustodyAddress(value.custodyAddress);
  const publicKey = normalizePublicKey(value.publicKey);

  if (value.status !== "pending" && value.status !== "verified") {
    throw new Error("The stored Farcaster signer vault has an invalid lifecycle status.");
  }

  if (!Number.isSafeInteger(value.nonce) || value.nonce <= 0) {
    throw new Error("The stored Farcaster signer vault has an invalid nonce.");
  }

  if (
    !Array.isArray(value.scopes) ||
    value.scopes.length === 0 ||
    value.scopes.some((scope) => !Number.isSafeInteger(scope) || scope <= 0)
  ) {
    throw new Error("The stored Farcaster signer vault has invalid scopes.");
  }

  if (!Number.isSafeInteger(value.ttlSeconds) || value.ttlSeconds <= 0) {
    throw new Error("The stored Farcaster signer vault has an invalid TTL.");
  }

  if (!Number.isSafeInteger(value.createdAtUnix) || value.createdAtUnix <= 0) {
    throw new Error("The stored Farcaster signer vault has an invalid creation time.");
  }

  if (
    value.lastVerifiedAtUnix !== undefined &&
    (!Number.isSafeInteger(value.lastVerifiedAtUnix) || value.lastVerifiedAtUnix <= 0)
  ) {
    throw new Error("The stored Farcaster signer vault has an invalid verification time.");
  }

  if (value.status === "verified" && value.lastVerifiedAtUnix === undefined) {
    throw new Error("The stored Farcaster signer vault is missing its verification time.");
  }

  if (
    value.authorizationDeadlineFarcaster !== undefined &&
    (!Number.isSafeInteger(value.authorizationDeadlineFarcaster) ||
      value.authorizationDeadlineFarcaster <= 0)
  ) {
    throw new Error("The stored Farcaster signer vault has an invalid authorization deadline.");
  }

  if (value.status === "pending" && value.authorizationDeadlineFarcaster === undefined) {
    throw new Error("The pending Farcaster signer vault is missing its authorization deadline.");
  }

  const registrationTransactionHash =
    value.registrationTransactionHash === undefined
      ? undefined
      : normalizeRegistrationTransactionHash(value.registrationTransactionHash);

  return {
    fid,
    custodyAddress,
    status: value.status,
    publicKey,
    nonce: value.nonce,
    scopes: [...value.scopes],
    ttlSeconds: value.ttlSeconds,
    createdAtUnix: value.createdAtUnix,
    lastVerifiedAtUnix: value.lastVerifiedAtUnix,
    authorizationDeadlineFarcaster: value.authorizationDeadlineFarcaster,
    registrationTransactionHash
  };
}

function parseStoredVault(raw: string): StoredFarcasterSignerVault {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The stored Farcaster signer vault is malformed.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("The stored Farcaster signer vault is malformed.");
  }

  const value = parsed as Partial<StoredFarcasterSignerVault>;
  const isLegacy = value.version === LEGACY_VAULT_VERSION;

  if (
    (!isLegacy && value.version !== VAULT_VERSION) ||
    typeof value.fid !== "number" ||
    typeof value.custodyAddress !== "string" ||
    typeof value.publicKey !== "string" ||
    typeof value.nonce !== "number" ||
    !Array.isArray(value.scopes) ||
    typeof value.ttlSeconds !== "number" ||
    typeof value.createdAtUnix !== "number" ||
    (value.lastVerifiedAtUnix !== undefined && typeof value.lastVerifiedAtUnix !== "number") ||
    (!isLegacy && value.status !== "pending" && value.status !== "verified") ||
    (value.authorizationDeadlineFarcaster !== undefined &&
      typeof value.authorizationDeadlineFarcaster !== "number") ||
    (value.registrationTransactionHash !== undefined &&
      typeof value.registrationTransactionHash !== "string") ||
    typeof value.salt !== "string" ||
    typeof value.iv !== "string" ||
    typeof value.ciphertext !== "string"
  ) {
    throw new Error("The stored Farcaster signer vault is malformed.");
  }

  const stored: StoredFarcasterSignerVault = {
    ...(value as StoredFarcasterSignerVault),
    status: isLegacy ? "verified" : (value.status as "pending" | "verified")
  };
  validateMetadata(stored);
  return stored;
}

export function hasFarcasterSignerVault(
  identity: FarcasterSignerVaultIdentity,
  storage?: Storage
): boolean {
  try {
    return resolveStorage(storage).getItem(vaultStorageKey(identity)) !== null;
  } catch {
    return false;
  }
}

export function readFarcasterSignerVaultMetadata(
  identity: FarcasterSignerVaultIdentity,
  storage?: Storage
): FarcasterSignerVaultMetadata | undefined {
  const raw = resolveStorage(storage).getItem(vaultStorageKey(identity));

  if (!raw) {
    return undefined;
  }

  const stored = parseStoredVault(raw);
  const expectedAddress = normalizeCustodyAddress(identity.custodyAddress);

  if (stored.fid !== normalizeFid(identity.fid) || stored.custodyAddress !== expectedAddress) {
    throw new Error("The stored Farcaster signer vault identity does not match.");
  }

  return validateMetadata(stored);
}

export async function saveFarcasterSignerVault(
  options: SaveFarcasterSignerVaultOptions
): Promise<FarcasterSignerVaultMetadata> {
  assertPrivateKey(options.custodyPrivateKey);
  assertSignerSeed(options.signerSeed);

  const metadata = validateMetadata({
    version: VAULT_VERSION,
    fid: options.fid,
    custodyAddress: options.custodyAddress,
    status: options.status,
    publicKey: options.publicKey,
    nonce: options.nonce,
    scopes: options.scopes,
    ttlSeconds: options.ttlSeconds,
    createdAtUnix: options.createdAtUnix,
    lastVerifiedAtUnix: options.lastVerifiedAtUnix,
    authorizationDeadlineFarcaster: options.authorizationDeadlineFarcaster,
    registrationTransactionHash: options.registrationTransactionHash,
    salt: "",
    iv: "",
    ciphertext: ""
  });

  const webCrypto = resolveCrypto();
  const salt = webCrypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = webCrypto.getRandomValues(new Uint8Array(IV_BYTES));
  const context = vaultContext(metadata);
  const key = await deriveVaultKey(options.custodyPrivateKey, salt, context, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await webCrypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: context as BufferSource,
        tagLength: 128
      },
      key,
      options.signerSeed as BufferSource
    )
  );

  const stored: StoredFarcasterSignerVault = {
    version: VAULT_VERSION,
    ...metadata,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext)
  };

  resolveStorage(options.storage).setItem(vaultStorageKey(metadata), JSON.stringify(stored));
  return metadata;
}

/**
 * Atomically promotes an existing pending record after Snapchain readback.
 * The ciphertext is left untouched, so a failed setItem retains the complete pending record.
 */
export function markFarcasterSignerVaultVerified(
  options: MarkFarcasterSignerVaultVerifiedOptions
): FarcasterSignerVaultMetadata {
  const storage = resolveStorage(options.storage);
  const keyName = vaultStorageKey(options);
  const raw = storage.getItem(keyName);

  if (!raw) {
    throw new Error("The pending Farcaster signer vault is missing.");
  }

  const stored = parseStoredVault(raw);
  const expectedPublicKey = normalizePublicKey(options.publicKey);

  if (
    stored.fid !== normalizeFid(options.fid) ||
    stored.custodyAddress !== normalizeCustodyAddress(options.custodyAddress) ||
    stored.publicKey !== expectedPublicKey ||
    stored.nonce !== options.nonce
  ) {
    throw new Error("The pending Farcaster signer vault changed before verification.");
  }

  const verified: StoredFarcasterSignerVault = {
    ...stored,
    version: VAULT_VERSION,
    status: "verified",
    lastVerifiedAtUnix: options.lastVerifiedAtUnix
  };
  const metadata = validateMetadata(verified);
  storage.setItem(keyName, JSON.stringify(verified));
  return metadata;
}

export async function loadFarcasterSignerVault(
  options: LoadFarcasterSignerVaultOptions
): Promise<DecryptedFarcasterSignerVault | undefined> {
  assertPrivateKey(options.custodyPrivateKey);
  const storage = resolveStorage(options.storage);
  const keyName = vaultStorageKey(options);
  const raw = storage.getItem(keyName);

  if (!raw) {
    return undefined;
  }

  const stored = parseStoredVault(raw);
  const metadata = validateMetadata(stored);
  const expectedAddress = normalizeCustodyAddress(options.custodyAddress);

  if (metadata.fid !== normalizeFid(options.fid) || metadata.custodyAddress !== expectedAddress) {
    throw new Error("The stored Farcaster signer vault identity does not match.");
  }

  const salt = base64ToBytes(stored.salt);
  const iv = base64ToBytes(stored.iv);

  if (salt.byteLength !== SALT_BYTES || iv.byteLength !== IV_BYTES) {
    throw new Error("The stored Farcaster signer vault is malformed.");
  }

  const context = vaultContext(metadata);
  const key = await deriveVaultKey(options.custodyPrivateKey, salt, context, ["decrypt"]);

  try {
    const plaintext = new Uint8Array(
      await resolveCrypto().subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv as BufferSource,
          additionalData: context as BufferSource,
          tagLength: 128
        },
        key,
        base64ToBytes(stored.ciphertext) as BufferSource
      )
    );

    assertSignerSeed(plaintext);
    return { metadata, signerSeed: plaintext };
  } catch {
    throw new Error("Unable to unlock the stored Farcaster signer.");
  }
}

export function forgetFarcasterSignerVault(
  identity: FarcasterSignerVaultIdentity,
  storage?: Storage
): void {
  resolveStorage(storage).removeItem(vaultStorageKey(identity));
}

export const FARCASTER_SIGNER_VAULT_STORAGE_PREFIX = VAULT_STORAGE_PREFIX;
