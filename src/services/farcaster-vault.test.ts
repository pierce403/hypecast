import { describe, expect, it } from "vitest";

import {
  FARCASTER_SIGNER_VAULT_STORAGE_PREFIX,
  forgetFarcasterSignerVault,
  hasFarcasterSignerVault,
  loadFarcasterSignerVault,
  markFarcasterSignerVaultVerified,
  readFarcasterSignerVaultMetadata,
  saveFarcasterSignerVault
} from "./farcaster-vault";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const IDENTITY = {
  fid: 12_345,
  custodyAddress: "0x1111111111111111111111111111111111111111"
};
const PUBLIC_KEY = `0x${"22".repeat(32)}`;
const REGISTRATION_TRANSACTION_HASH = `0x${"44".repeat(32)}`;
const CUSTODY_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const SIGNER_SEED = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);

function hexWithoutPrefix(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function saveFixture(storage: Storage): Promise<void> {
  await saveFarcasterSignerVault({
    ...IDENTITY,
    status: "verified",
    publicKey: PUBLIC_KEY,
    nonce: 9,
    scopes: [1, 2, 3, 4, 5, 6, 11],
    ttlSeconds: 7_776_000,
    createdAtUnix: 1_800_000_000,
    lastVerifiedAtUnix: 1_800_000_010,
    custodyPrivateKey: CUSTODY_KEY,
    signerSeed: SIGNER_SEED,
    storage
  });
}

describe("Farcaster signer vault", () => {
  it("encrypts a signer seed and decrypts it only for the matching identity", async () => {
    const storage = new MemoryStorage();
    await saveFixture(storage);

    expect(hasFarcasterSignerVault(IDENTITY, storage)).toBe(true);
    expect(readFarcasterSignerVaultMetadata(IDENTITY, storage)).toMatchObject({
      ...IDENTITY,
      publicKey: PUBLIC_KEY,
      nonce: 9
    });

    const key = storage.key(0);
    const raw = key ? storage.getItem(key) : null;
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(hexWithoutPrefix(CUSTODY_KEY));
    expect(raw).not.toContain(hexWithoutPrefix(SIGNER_SEED));

    const unlocked = await loadFarcasterSignerVault({
      ...IDENTITY,
      custodyPrivateKey: CUSTODY_KEY,
      storage
    });

    expect(unlocked?.metadata.publicKey).toBe(PUBLIC_KEY);
    expect(unlocked?.signerSeed).toEqual(SIGNER_SEED);
    expect(unlocked?.signerSeed).not.toBe(SIGNER_SEED);
    unlocked?.signerSeed.fill(0);
  });

  it("rejects the wrong custody key without exposing decrypted material", async () => {
    const storage = new MemoryStorage();
    await saveFixture(storage);
    const wrongKey = CUSTODY_KEY.slice();
    wrongKey[0] ^= 0xff;

    await expect(
      loadFarcasterSignerVault({
        ...IDENTITY,
        custodyPrivateKey: wrongKey,
        storage
      })
    ).rejects.toThrow("Unable to unlock the stored Farcaster signer");
  });

  it("binds ciphertext authentication to both fid and custody address", async () => {
    const storage = new MemoryStorage();
    await saveFixture(storage);
    const originalKey = storage.key(0);
    const raw = originalKey ? storage.getItem(originalKey) : null;
    expect(raw).not.toBeNull();

    const differentIdentity = {
      fid: IDENTITY.fid + 1,
      custodyAddress: "0x3333333333333333333333333333333333333333"
    };
    const tampered = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    tampered.fid = differentIdentity.fid;
    tampered.custodyAddress = differentIdentity.custodyAddress;
    storage.setItem(
      `${FARCASTER_SIGNER_VAULT_STORAGE_PREFIX}:${differentIdentity.fid}:${differentIdentity.custodyAddress}`,
      JSON.stringify(tampered)
    );

    await expect(
      loadFarcasterSignerVault({
        ...differentIdentity,
        custodyPrivateKey: CUSTODY_KEY,
        storage
      })
    ).rejects.toThrow("Unable to unlock the stored Farcaster signer");
  });

  it("forgets only the requested encrypted signer record", async () => {
    const storage = new MemoryStorage();
    await saveFixture(storage);

    forgetFarcasterSignerVault(IDENTITY, storage);

    expect(hasFarcasterSignerVault(IDENTITY, storage)).toBe(false);
  });

  it("promotes a pending record without replacing its encrypted seed", async () => {
    const storage = new MemoryStorage();
    await saveFarcasterSignerVault({
      ...IDENTITY,
      status: "pending",
      publicKey: PUBLIC_KEY,
      nonce: 10,
      scopes: [1, 2, 3, 4, 5, 6, 11],
      ttlSeconds: 7_776_000,
      createdAtUnix: 1_800_000_000,
      authorizationDeadlineFarcaster: 200_000_000,
      registrationTransactionHash: REGISTRATION_TRANSACTION_HASH,
      custodyPrivateKey: CUSTODY_KEY,
      signerSeed: SIGNER_SEED,
      storage
    });
    const key = storage.key(0) ?? "";
    const pending = JSON.parse(storage.getItem(key) ?? "{}") as Record<string, unknown>;

    const verified = markFarcasterSignerVaultVerified({
      ...IDENTITY,
      publicKey: PUBLIC_KEY,
      nonce: 10,
      lastVerifiedAtUnix: 1_800_000_010,
      storage
    });
    const storedVerified = JSON.parse(storage.getItem(key) ?? "{}") as Record<string, unknown>;

    expect(verified.status).toBe("verified");
    expect(verified.registrationTransactionHash).toBe(REGISTRATION_TRANSACTION_HASH);
    expect(storedVerified.status).toBe("verified");
    expect(storedVerified.registrationTransactionHash).toBe(
      REGISTRATION_TRANSACTION_HASH
    );
    expect(storedVerified.ciphertext).toBe(pending.ciphertext);
  });

  it("continues to unlock version-one vault records as verified", async () => {
    const storage = new MemoryStorage();
    await saveFixture(storage);
    const key = storage.key(0) ?? "";
    const legacy = JSON.parse(storage.getItem(key) ?? "{}") as Record<string, unknown>;
    legacy.version = 1;
    delete legacy.status;
    delete legacy.authorizationDeadlineFarcaster;
    storage.setItem(key, JSON.stringify(legacy));

    const unlocked = await loadFarcasterSignerVault({
      ...IDENTITY,
      custodyPrivateKey: CUSTODY_KEY,
      storage
    });

    expect(unlocked?.metadata.status).toBe("verified");
    expect(unlocked?.signerSeed).toEqual(SIGNER_SEED);
    unlocked?.signerSeed.fill(0);
  });
});
