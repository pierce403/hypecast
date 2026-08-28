import { validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import { getAddress, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  createCustodyBackupDownload,
  createCustodyBackupJson,
  fetchFarcasterProfileByFid,
  generateCustodyAccount,
  inspectAccountOnOptimism,
  parseCustodySecret,
  registerAccountOnOptimism,
  type OptimismAccountClient
} from "./farcaster-account";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = getAddress("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
const RECOVERY_ADDRESS = getAddress(
  "0x00000000fcb080a4d6c39a9354da9eb9bc104cd7"
);
const TRANSACTION_HASH = `0x${"ab".repeat(32)}` as Hex;

function createMockClient(
  overrides: Partial<OptimismAccountClient> = {}
): OptimismAccountClient {
  return {
    getChainId: vi.fn().mockResolvedValue(10),
    getBalance: vi.fn().mockResolvedValue(2_000n),
    getRegistrationPrice: vi.fn().mockResolvedValue(1_000n),
    getFid: vi.fn().mockResolvedValue(0n),
    register: vi.fn().mockResolvedValue(TRANSACTION_HASH),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      transactionHash: TRANSACTION_HASH,
      blockNumber: 123n,
      status: "success"
    }),
    ...overrides
  };
}

describe("Farcaster custody secret handling", () => {
  it("derives the standard Ethereum custody account from a 12-word mnemonic", () => {
    const result = parseCustodySecret(TEST_MNEMONIC);

    expect(result.address).toBe(TEST_ADDRESS);
    expect(result.privateKey).toBe(TEST_PRIVATE_KEY);
    expect(result.kind).toBe("mnemonic");
    expect(result.mnemonic).toBe(TEST_MNEMONIC);
    expect(result.secret).toEqual({
      kind: "mnemonic",
      mnemonic: TEST_MNEMONIC
    });
  });

  it("accepts prefixed and bare 32-byte secp256k1 private keys", () => {
    expect(parseCustodySecret(TEST_PRIVATE_KEY)).toMatchObject({
      address: TEST_ADDRESS,
      privateKey: TEST_PRIVATE_KEY,
      kind: "privateKey"
    });
    expect(parseCustodySecret(TEST_PRIVATE_KEY.slice(2)).address).toBe(TEST_ADDRESS);
  });

  it.each(["seedPhrase", "mnemonic"])(
    "accepts a JSON %s mnemonic backup",
    (field) => {
      const result = parseCustodySecret(
        JSON.stringify({
          [field]: TEST_MNEMONIC
        })
      );

      expect(result.address).toBe(TEST_ADDRESS);
      expect(result.secret.kind).toBe("mnemonic");
    }
  );

  it.each(["custodyPrivateKey", "privateKey"])(
    "accepts a JSON %s private-key backup",
    (field) => {
      const result = parseCustodySecret(
        JSON.stringify({
          [field]: TEST_PRIVATE_KEY
        })
      );

      expect(result.address).toBe(TEST_ADDRESS);
      expect(result.secret.kind).toBe("private-key");
    }
  );

  it("rejects JSON backups whose secrets resolve to different addresses", () => {
    expect(() =>
      parseCustodySecret(
        JSON.stringify({
          seedPhrase: TEST_MNEMONIC,
          privateKey:
            "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
        })
      )
    ).toThrow("different Ethereum addresses");
  });

  it("rejects unsupported mnemonic lengths and invalid private keys", () => {
    expect(() => parseCustodySecret("abandon abandon abandon")).toThrow(
      "12 or 24 words"
    );
    expect(() => parseCustodySecret(`0x${"00".repeat(32)}`)).toThrow(
      "valid secp256k1"
    );
  });

  it("generates a valid 12-word custody mnemonic", () => {
    const generated = generateCustodyAccount();

    expect(generated.secret.kind).toBe("mnemonic");

    if (generated.secret.kind !== "mnemonic") {
      throw new Error("Expected a mnemonic custody account.");
    }

    expect(generated.secret.mnemonic.split(" ")).toHaveLength(12);
    expect(validateMnemonic(generated.secret.mnemonic, englishWordlist)).toBe(true);
    expect(parseCustodySecret(generated.secret.mnemonic).address).toBe(generated.address);
  });

  it("creates a deterministic plaintext JSON backup that can be imported", () => {
    const custody = parseCustodySecret(TEST_MNEMONIC);
    const now = new Date("2026-08-28T12:34:56.000Z");
    const contents = createCustodyBackupJson(custody, { now });
    const download = createCustodyBackupDownload(custody, { now });
    const payload = JSON.parse(contents) as Record<string, unknown>;

    expect(payload).toMatchObject({
      version: 1,
      app: "Hypecast",
      createdAt: now.toISOString(),
      address: TEST_ADDRESS,
      seedPhrase: TEST_MNEMONIC
    });
    expect(contents).not.toContain("custodyPrivateKey");
    expect(download.fileName).toBe(
      `hypecast-custody-${TEST_ADDRESS.toLowerCase()}-2026-08-28.json`
    );
    expect(download.mimeType).toBe("application/json");
    expect(download.contents).toBe(contents);
    expect(parseCustodySecret(contents).address).toBe(TEST_ADDRESS);
  });

  it("backs up an imported private key under the Maelstrom-compatible field", () => {
    const custody = parseCustodySecret(TEST_PRIVATE_KEY);
    const payload = JSON.parse(createCustodyBackupJson(custody)) as Record<
      string,
      unknown
    >;

    expect(payload.custodyPrivateKey).toBe(TEST_PRIVATE_KEY);
    expect(payload).not.toHaveProperty("seedPhrase");
  });
});

describe("Farcaster Optimism account operations", () => {
  it("returns FID, balance, price, and the remaining recommended funding", async () => {
    const custody = parseCustodySecret(TEST_PRIVATE_KEY);
    const client = createMockClient({
      getBalance: vi.fn().mockResolvedValue(250n),
      getRegistrationPrice: vi.fn().mockResolvedValue(1_000n),
      getFid: vi.fn().mockResolvedValue(42n)
    });

    await expect(
      inspectAccountOnOptimism(custody, RECOVERY_ADDRESS, {
        client,
        gasBufferWei: 200n
      })
    ).resolves.toEqual({
      chainId: 10,
      address: TEST_ADDRESS,
      recoveryAddress: RECOVERY_ADDRESS,
      fid: 42,
      balanceWei: 250n,
      registrationPriceWei: 1_000n,
      gasBufferWei: 200n,
      recommendedBalanceWei: 1_200n,
      recommendedFundingWei: 950n
    });
  });

  it("rejects an RPC connected to a chain other than Optimism mainnet", async () => {
    const client = createMockClient({
      getChainId: vi.fn().mockResolvedValue(1)
    });

    await expect(
      inspectAccountOnOptimism(
        parseCustodySecret(TEST_PRIVATE_KEY),
        RECOVERY_ADDRESS,
        { client }
      )
    ).rejects.toThrow("requires Optimism mainnet");
  });

  it("registers with register(address), waits for the receipt, and reads back the FID", async () => {
    const getFid = vi
      .fn<OptimismAccountClient["getFid"]>()
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(777n);
    const register = vi
      .fn<OptimismAccountClient["register"]>()
      .mockResolvedValue(TRANSACTION_HASH);
    const client = createMockClient({ getFid, register });

    const result = await registerAccountOnOptimism(
      parseCustodySecret(TEST_PRIVATE_KEY),
      RECOVERY_ADDRESS,
      { client }
    );

    expect(register).toHaveBeenCalledWith(RECOVERY_ADDRESS, 1_000n);
    expect(client.waitForTransactionReceipt).toHaveBeenCalledWith(TRANSACTION_HASH);
    expect(getFid).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      chainId: 10,
      address: TEST_ADDRESS,
      recoveryAddress: RECOVERY_ADDRESS,
      fid: 777,
      registrationPriceWei: 1_000n,
      receipt: {
        transactionHash: TRANSACTION_HASH,
        blockNumber: 123n,
        status: "success"
      }
    });
  });

  it("does not submit a duplicate registration for an existing FID", async () => {
    const client = createMockClient({
      getFid: vi.fn().mockResolvedValue(88n)
    });

    await expect(
      registerAccountOnOptimism(
        parseCustodySecret(TEST_PRIVATE_KEY),
        RECOVERY_ADDRESS,
        { client }
      )
    ).rejects.toThrow("already registered as FID 88");
    expect(client.register).not.toHaveBeenCalled();
  });

  it("rejects a reverted registration receipt", async () => {
    const client = createMockClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        transactionHash: TRANSACTION_HASH,
        blockNumber: 123n,
        status: "reverted"
      })
    });

    await expect(
      registerAccountOnOptimism(
        parseCustodySecret(TEST_PRIVATE_KEY),
        RECOVERY_ADDRESS,
        { client }
      )
    ).rejects.toThrow("transaction reverted");
  });

  it("does not report success until IdRegistry returns an FID", async () => {
    const client = createMockClient();

    await expect(
      registerAccountOnOptimism(
        parseCustodySecret(TEST_PRIVATE_KEY),
        RECOVERY_ADDRESS,
        { client }
      )
    ).rejects.toThrow("did not return an FID");
    expect(client.getFid).toHaveBeenCalledTimes(2);
  });
});

describe("Farcaster profile lookup", () => {
  it("normalizes a Neynar profile", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain("fids=777");

      return new Response(
        JSON.stringify({
          users: [
            {
              fid: 777,
              username: "hypecaster",
              display_name: "Hype Caster",
              pfp_url: "https://example.com/avatar.png",
              custody_address: TEST_ADDRESS,
              profile: {
                bio: {
                  text: "Building on Farcaster"
                }
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    await expect(
      fetchFarcasterProfileByFid(777, {
        apiKey: "test-key",
        fetchImpl: fetchImpl as typeof fetch
      })
    ).resolves.toEqual({
      fid: 777,
      username: "hypecaster",
      displayName: "Hype Caster",
      bio: "Building on Farcaster",
      pfpUrl: "https://example.com/avatar.png",
      custody: TEST_ADDRESS
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("fids=777"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "test-key"
        })
      })
    );
  });

  it("falls back to an FID-only profile when Neynar is unavailable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(
      fetchFarcasterProfileByFid(777, {
        apiKey: "test-key",
        fetchImpl: fetchImpl as typeof fetch
      })
    ).resolves.toEqual({ fid: 777 });
  });
});
