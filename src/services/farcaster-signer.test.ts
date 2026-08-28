import { afterEach, describe, expect, it } from "vitest";

import {
  connectLocalFarcasterAccount,
  hasActiveFarcasterSigner,
  lockActiveFarcasterSigner,
  publishSignedCast,
  publishSignedLink,
  publishSignedProfile,
  publishSignedReaction,
  removeSignedCast
} from "./farcaster-signer";

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

class FaultingStorage extends MemoryStorage {
  private readonly failingWrites = new Set<number>();
  private writeCount = 0;

  constructor(failingWrites: number[]) {
    super();
    this.failingWrites = new Set(failingWrites);
  }

  setItem(key: string, value: string): void {
    this.writeCount += 1;

    if (this.failingWrites.has(this.writeCount)) {
      throw new Error("Simulated signer vault write failure.");
    }

    super.setItem(key, value);
  }

  allowWrites(): void {
    this.failingWrites.clear();
  }
}

const FID = 12_345;
const CUSTODY_PRIVATE_KEY = `0x${"11".repeat(32)}`;
const CAST_HASH = `0x${"ab".repeat(20)}`;
const REGISTRATION_TRANSACTION_HASH = `0x${"cd".repeat(32)}`;

interface GatewayHarness {
  fetchImpl: typeof fetch;
  messages: import("@farcaster/core").Message[];
  requests: Array<{ url: string; init?: RequestInit }>;
  setAcceptKeyAdds(value: boolean): void;
}

async function createGatewayHarness(options: { acceptKeyAdds?: boolean } = {}): Promise<GatewayHarness> {
  const core = await import("@farcaster/core");
  const messages: import("@farcaster/core").Message[] = [];
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let provisionedPublicKey: string | undefined;
  let acceptKeyAdds = options.acceptKeyAdds ?? true;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });

    if (url.includes("/v1/signersByFid")) {
      const signers = provisionedPublicKey
        ? [
            {
              source: "OFFCHAIN",
              key: provisionedPublicKey,
              keyType: core.KEY_TYPE_ED25519,
              fid: FID,
              scopes: core.ADMISSIBLE_KEY_ADD_SCOPES.map((scope) => core.messageTypeToJSON(scope)),
              ttl: core.MAX_KEY_TTL_SECONDS,
              expiresAt: Math.floor(Date.now() / 1000) + core.MAX_KEY_TTL_SECONDS,
              nonce: 8
            }
          ]
        : [];

      return new Response(
        JSON.stringify({
          signers,
          currentUserNonce: provisionedPublicKey ? 8 : 7,
          gaslessSignerCount: signers.length,
          gaslessSignerLimit: 1_000
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.endsWith("/v1/submitMessage") && init?.method === "POST") {
      const body = init.body as unknown as Uint8Array;
      const message = core.Message.decode(body);
      messages.push(message);

      if (message.data?.type === core.MessageType.KEY_ADD && acceptKeyAdds) {
        provisionedPublicKey = `0x${[...(message.data.keyAddBody?.key ?? [])]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")}`;
      }

      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (url.includes("/v1/castById") || url.includes("/v1/reactionById") || url.includes("/v1/linkById") || url.includes("/v1/userDataByFid")) {
      const latestMessage = messages.at(-1);
      const latestHash = latestMessage
        ? `0x${[...latestMessage.hash]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("")}`
        : undefined;
      return new Response(JSON.stringify({ hash: latestHash }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(null, { status: 404 });
  };

  return {
    fetchImpl,
    messages,
    requests,
    setAcceptKeyAdds(value: boolean) {
      acceptKeyAdds = value;
    }
  };
}

function readStoredVault(storage: Storage): Record<string, unknown> | undefined {
  const key = storage.key(0);
  const raw = key ? storage.getItem(key) : null;
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
}

async function connectWithHarness(
  storage: Storage,
  harness: GatewayHarness,
  options: { registrationTransactionHash?: string } = {}
) {
  return connectLocalFarcasterAccount({
    fid: FID,
    custodyPrivateKey: CUSTODY_PRIVATE_KEY,
    neynarApiKey: "test-neynar-key",
    haatzBaseUrl: false,
    fetchImpl: harness.fetchImpl,
    storage,
    signerVerificationAttempts: 1,
    signerVerificationDelayMs: 0,
    messageReadbackAttempts: 1,
    messageReadbackDelayMs: 0,
    ...options
  });
}

function decodeHex(value: string): Uint8Array {
  const normalized = value.replace(/^0x/, "");
  return Uint8Array.from(
    normalized.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []
  );
}

afterEach(() => {
  lockActiveFarcasterSigner();
});

describe("local Farcaster signer", () => {
  it("does not submit KEY_ADD when the initial pending vault write fails", async () => {
    const storage = new FaultingStorage([1]);
    const harness = await createGatewayHarness();

    await expect(connectWithHarness(storage, harness)).rejects.toThrow(
      "Simulated signer vault write failure"
    );

    expect(harness.messages).toHaveLength(0);
    expect(storage.length).toBe(0);
    expect(hasActiveFarcasterSigner()).toBe(false);
  });

  it("validates and includes the IdGateway registration transaction hash in the initial KEY_ADD", async () => {
    const storage = new MemoryStorage();
    const harness = await createGatewayHarness();

    await connectWithHarness(storage, harness, {
      registrationTransactionHash: REGISTRATION_TRANSACTION_HASH.toUpperCase()
    });

    expect(harness.messages[0]?.data?.keyAddBody?.registrationTxHash).toEqual(
      decodeHex(REGISTRATION_TRANSACTION_HASH)
    );
    expect(readStoredVault(storage)?.registrationTransactionHash).toBe(
      REGISTRATION_TRANSACTION_HASH
    );
  });

  it("rejects a malformed IdGateway registration transaction hash before any network request", async () => {
    const storage = new MemoryStorage();
    const harness = await createGatewayHarness();

    await expect(
      connectWithHarness(storage, harness, { registrationTransactionHash: "0x1234" })
    ).rejects.toThrow("Farcaster registration transaction hash must be 32 bytes");

    expect(harness.requests).toHaveLength(0);
    expect(harness.messages).toHaveLength(0);
    expect(storage.length).toBe(0);
  });

  it("retains and resubmits the same pending signer and nonce after ambiguous verification", async () => {
    const core = await import("@farcaster/core");
    const storage = new MemoryStorage();
    const harness = await createGatewayHarness({ acceptKeyAdds: false });

    await expect(
      connectWithHarness(storage, harness, {
        registrationTransactionHash: REGISTRATION_TRANSACTION_HASH
      })
    ).rejects.toThrow("Snapchain did not confirm the new Farcaster signer");
    expect(readStoredVault(storage)?.status).toBe("pending");
    expect(readStoredVault(storage)?.registrationTransactionHash).toBe(
      REGISTRATION_TRANSACTION_HASH
    );
    expect(hasActiveFarcasterSigner()).toBe(false);

    harness.setAcceptKeyAdds(true);
    const session = await connectWithHarness(storage, harness);
    const keyAdds = harness.messages.filter(
      (message) => message.data?.type === core.MessageType.KEY_ADD
    );

    expect(keyAdds).toHaveLength(2);
    expect(keyAdds[1]?.data?.keyAddBody?.key).toEqual(keyAdds[0]?.data?.keyAddBody?.key);
    expect(keyAdds[1]?.data?.keyAddBody?.nonce).toBe(keyAdds[0]?.data?.keyAddBody?.nonce);
    expect(keyAdds[0]?.data?.keyAddBody?.registrationTxHash).toEqual(
      decodeHex(REGISTRATION_TRANSACTION_HASH)
    );
    expect(keyAdds[1]?.data?.keyAddBody?.registrationTxHash).toEqual(
      keyAdds[0]?.data?.keyAddBody?.registrationTxHash
    );
    expect(session.signerPublicKey).toBe(
      `0x${[...(keyAdds[0]?.data?.keyAddBody?.key ?? [])]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")}`
    );
    expect(readStoredVault(storage)?.status).toBe("verified");
  });

  it("retains pending ciphertext when final verification persistence fails", async () => {
    const core = await import("@farcaster/core");
    const storage = new FaultingStorage([2]);
    const harness = await createGatewayHarness();

    await expect(connectWithHarness(storage, harness)).rejects.toThrow(
      "Simulated signer vault write failure"
    );
    expect(readStoredVault(storage)?.status).toBe("pending");
    expect(
      harness.messages.filter((message) => message.data?.type === core.MessageType.KEY_ADD)
    ).toHaveLength(1);
    expect(hasActiveFarcasterSigner()).toBe(false);

    storage.allowWrites();
    const session = await connectWithHarness(storage, harness);

    expect(session.source).toBe("vault");
    expect(
      harness.messages.filter((message) => message.data?.type === core.MessageType.KEY_ADD)
    ).toHaveLength(1);
    expect(readStoredVault(storage)?.status).toBe("verified");
  });

  it("uses network nonce + 1, explicit scopes, max TTL, encrypted persistence, and readback", async () => {
    const core = await import("@farcaster/core");
    const storage = new MemoryStorage();
    const harness = await createGatewayHarness();
    const session = await connectWithHarness(storage, harness);

    expect(session.source).toBe("provisioned");
    expect(session.nonce).toBe(8);
    expect(session.scopes).toEqual([...core.ADMISSIBLE_KEY_ADD_SCOPES]);
    expect(hasActiveFarcasterSigner()).toBe(true);

    const keyAdd = harness.messages[0];
    expect(keyAdd.data?.type).toBe(core.MessageType.KEY_ADD);
    expect(keyAdd.data?.keyAddBody?.nonce).toBe(8);
    expect(keyAdd.data?.keyAddBody?.ttl).toBe(core.MAX_KEY_TTL_SECONDS);
    expect(keyAdd.data?.keyAddBody?.scopes).toEqual([...core.ADMISSIBLE_KEY_ADD_SCOPES]);
    expect(keyAdd.data?.keyAddBody?.registrationTxHash).toEqual(new Uint8Array());
    expect((keyAdd.data?.keyAddBody?.deadline ?? 0) - (keyAdd.data?.timestamp ?? 0)).toBe(3_600);

    const submitRequest = harness.requests.find((request) => request.url.endsWith("/v1/submitMessage"));
    expect(new Headers(submitRequest?.init?.headers).get("x-api-key")).toBe("test-neynar-key");
    expect(new Headers(submitRequest?.init?.headers).get("content-type")).toBe(
      "application/octet-stream"
    );

    const stored = storage.key(0) ? storage.getItem(storage.key(0) ?? "") : null;
    expect(stored).not.toBeNull();
    expect(stored?.toLowerCase()).not.toContain(CUSTODY_PRIVATE_KEY.slice(2));

    lockActiveFarcasterSigner();
    expect(hasActiveFarcasterSigner()).toBe(false);

    const reconnected = await connectWithHarness(storage, harness);
    expect(reconnected.source).toBe("vault");
    expect(harness.messages.filter((message) => message.data?.type === core.MessageType.KEY_ADD)).toHaveLength(1);
  });

  it("checks every configured gateway before treating a verified vault signer as absent", async () => {
    const core = await import("@farcaster/core");
    const storage = new MemoryStorage();
    const harness = await createGatewayHarness();
    await connectWithHarness(storage, harness);
    lockActiveFarcasterSigner();

    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);

      if (
        url.startsWith("https://snapchain-api.neynar.com") &&
        url.includes("/v1/signersByFid")
      ) {
        return new Response(
          JSON.stringify({
            signers: [],
            currentUserNonce: 8,
            gaslessSignerCount: 0,
            gaslessSignerLimit: 1_000
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return harness.fetchImpl(input, init);
    };

    const session = await connectLocalFarcasterAccount({
      fid: FID,
      custodyPrivateKey: CUSTODY_PRIVATE_KEY,
      neynarApiKey: "test-neynar-key",
      fetchImpl,
      storage,
      signerVerificationAttempts: 1,
      signerVerificationDelayMs: 0,
      messageReadbackAttempts: 0
    });

    expect(session.source).toBe("vault");
    expect(
      requestedUrls.some((url) => url.startsWith("https://snapchain-api.neynar.com"))
    ).toBe(true);
    expect(
      requestedUrls.some((url) => url.startsWith("https://haatz.quilibrium.com"))
    ).toBe(true);
    expect(
      harness.messages.filter((message) => message.data?.type === core.MessageType.KEY_ADD)
    ).toHaveLength(1);
  });

  it("retains a verified vault when a successful signer lookup is incomplete", async () => {
    const core = await import("@farcaster/core");
    const storage = new MemoryStorage();
    const harness = await createGatewayHarness();
    await connectWithHarness(storage, harness);
    lockActiveFarcasterSigner();
    const storedBefore = readStoredVault(storage);
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });

      if (url.includes("/v1/signersByFid")) {
        return new Response(
          JSON.stringify({
            signers: [],
            currentUserNonce: 8,
            gaslessSignerCount: 0,
            gaslessSignerLimit: 1_000
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(null, { status: 500 });
    };

    await expect(
      connectLocalFarcasterAccount({
        fid: FID,
        custodyPrivateKey: CUSTODY_PRIVATE_KEY,
        neynarApiKey: "test-neynar-key",
        haatzBaseUrl: false,
        fetchImpl,
        storage,
        signerVerificationAttempts: 1,
        signerVerificationDelayMs: 0,
        messageReadbackAttempts: 0
      })
    ).rejects.toThrow("encrypted vault was retained");

    expect(readStoredVault(storage)).toMatchObject({
      status: "verified",
      publicKey: storedBefore?.publicKey
    });
    expect(requests.some((request) => request.init?.method === "POST")).toBe(false);
    expect(
      harness.messages.filter((message) => message.data?.type === core.MessageType.KEY_ADD)
    ).toHaveLength(1);
    expect(hasActiveFarcasterSigner()).toBe(false);
  });

  it("builds and submits official messages for casts, reactions, links, removals, and profile data", async () => {
    const core = await import("@farcaster/core");
    const storage = new MemoryStorage();
    const harness = await createGatewayHarness();
    await connectWithHarness(storage, harness);

    const cast = await publishSignedCast({ text: "Signed directly by Hypecast." });
    const reaction = await publishSignedReaction({
      reactionType: "like",
      target: { fid: 99, hash: CAST_HASH }
    });
    await publishSignedReaction({
      reactionType: "like",
      target: { fid: 99, hash: CAST_HASH },
      remove: true
    });
    await publishSignedLink({ targetFid: 99 });
    await publishSignedLink({ targetFid: 99, remove: true });
    await publishSignedProfile({ type: "bio", value: "Hello from Hypecast" });
    const removal = await removeSignedCast({ targetHash: CAST_HASH });

    expect(cast.hash).toMatch(/^0x[0-9a-f]{40}$/);
    expect(cast.readback).toBe("verified");
    expect(reaction.readback).toBe("verified");
    expect(removal.readback).toBe("not-supported");
    expect(harness.messages.map((message) => message.data?.type)).toEqual([
      core.MessageType.KEY_ADD,
      core.MessageType.CAST_ADD,
      core.MessageType.REACTION_ADD,
      core.MessageType.REACTION_REMOVE,
      core.MessageType.LINK_ADD,
      core.MessageType.LINK_REMOVE,
      core.MessageType.USER_DATA_ADD,
      core.MessageType.CAST_REMOVE
    ]);
    expect(harness.messages[1]?.data?.castAddBody?.text).toBe("Signed directly by Hypecast.");
    expect(harness.messages[6]?.data?.userDataBody).toMatchObject({
      type: core.UserDataType.BIO,
      value: "Hello from Hypecast"
    });
  });

  it("falls back to Haatz without forwarding the Neynar API key", async () => {
    const storage = new MemoryStorage();
    const harness = await createGatewayHarness();
    const attemptedRequests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      attemptedRequests.push({ url, init });

      if (url.startsWith("https://snapchain-api.neynar.com")) {
        return new Response(null, { status: 503 });
      }

      return harness.fetchImpl(input, init);
    };

    const session = await connectLocalFarcasterAccount({
      fid: FID,
      custodyPrivateKey: CUSTODY_PRIVATE_KEY,
      neynarApiKey: "must-not-leak",
      fetchImpl,
      storage,
      signerVerificationAttempts: 1,
      signerVerificationDelayMs: 0,
      messageReadbackAttempts: 0
    });

    expect(session.source).toBe("provisioned");
    expect(attemptedRequests.some((request) => request.url.startsWith("https://snapchain-api.neynar.com"))).toBe(true);
    const haatzRequests = harness.requests.filter((request) =>
      request.url.startsWith("https://haatz.quilibrium.com")
    );
    expect(haatzRequests.length).toBeGreaterThan(0);
    expect(
      haatzRequests.every((request) => !new Headers(request.init?.headers).has("x-api-key"))
    ).toBe(true);
  });
});
