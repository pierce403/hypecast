import {
  generateMnemonic as generateBip39Mnemonic,
  validateMnemonic
} from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseEther,
  toHex,
  type Address,
  type Hex,
  type LocalAccount
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { optimism } from "viem/chains";

import { APP_CONFIG } from "../config";
import {
  getHypecastTestApi,
  type HypecastTestApi,
  type HypecastTestFarcasterCustodyAccount
} from "../test-support";
import type { FarcasterProfile } from "../types";
import { getEffectiveNeynarApiKey } from "./feed";

const SUPPORTED_MNEMONIC_WORD_COUNTS = new Set([12, 24]);
const PRIVATE_KEY_PATTERN = /^(?:0x)?[0-9a-fA-F]{64}$/;
const DECIMAL_INTEGER_PATTERN = /^\d+$/;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ID_GATEWAY_ADDRESS = "0x00000000fc25870c6ed6b6c7e41fb078b7656f69" as Address;
const ID_REGISTRY_ADDRESS = "0x00000000fc6c5f01fc30151999387bb99a9f489b" as Address;
const ID_GATEWAY_ABI = parseAbi([
  "function price() view returns (uint256)",
  "function register(address recovery) payable returns (uint256 fid)"
]);
const ID_REGISTRY_ABI = parseAbi([
  "function idOf(address owner) view returns (uint256)"
]);

export const OPTIMISM_CHAIN_ID = optimism.id;
export const DEFAULT_REGISTRATION_GAS_BUFFER_WEI = parseEther("0.0002");

export type CustodySecret =
  | {
      kind: "mnemonic";
      mnemonic: string;
    }
  | {
      kind: "private-key";
      privateKey: Hex;
    };

export interface CustodyAccount {
  account: LocalAccount;
  address: Address;
  privateKey: Hex;
  mnemonic?: string;
  kind: "mnemonic" | "privateKey";
  secret: CustodySecret;
}

export interface CustodyBackupDownload {
  fileName: string;
  mimeType: "application/json";
  contents: string;
}

export interface OptimismAccountInspection {
  chainId: typeof OPTIMISM_CHAIN_ID;
  address: Address;
  recoveryAddress: Address;
  fid: number | null;
  balanceWei: bigint;
  registrationPriceWei: bigint;
  gasBufferWei: bigint;
  recommendedBalanceWei: bigint;
  recommendedFundingWei: bigint;
}

export interface OptimismRegistrationReceipt {
  transactionHash: Hex;
  blockNumber: bigint;
  status: "success";
}

export interface OptimismAccountRegistration {
  chainId: typeof OPTIMISM_CHAIN_ID;
  address: Address;
  recoveryAddress: Address;
  fid: number;
  registrationPriceWei: bigint;
  receipt: OptimismRegistrationReceipt;
}

export interface OptimismAccountClient {
  getChainId(): Promise<number>;
  getBalance(address: Address): Promise<bigint>;
  getRegistrationPrice(): Promise<bigint>;
  getFid(address: Address): Promise<bigint>;
  register(recoveryAddress: Address, value: bigint): Promise<Hex>;
  waitForTransactionReceipt(transactionHash: Hex): Promise<{
    transactionHash?: Hex;
    blockNumber: bigint;
    status: "success" | "reverted";
  }>;
}

interface AccountOperationOptions {
  client?: OptimismAccountClient;
  gasBufferWei?: bigint;
}

interface ProfileFetchOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function normalizeMnemonic(value: string): string {
  return value
    .normalize("NFKD")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .join(" ");
}

function parseMnemonic(value: string): CustodyAccount {
  const mnemonic = normalizeMnemonic(value);
  const wordCount = mnemonic ? mnemonic.split(" ").length : 0;

  if (!SUPPORTED_MNEMONIC_WORD_COUNTS.has(wordCount)) {
    throw new Error("A Farcaster recovery phrase must contain 12 or 24 words.");
  }

  if (!validateMnemonic(mnemonic, englishWordlist)) {
    throw new Error("The Farcaster recovery phrase has an invalid BIP-39 checksum.");
  }

  const account = mnemonicToAccount(mnemonic, {
    path: "m/44'/60'/0'/0/0"
  });
  const privateKeyBytes = account.getHdKey().privateKey;

  if (!privateKeyBytes) {
    throw new Error("The Farcaster recovery phrase could not derive a custody private key.");
  }
  const privateKey = toHex(privateKeyBytes);

  return {
    account,
    address: getAddress(account.address),
    privateKey,
    mnemonic,
    kind: "mnemonic",
    secret: {
      kind: "mnemonic",
      mnemonic
    }
  };
}

function parsePrivateKey(value: string): CustodyAccount {
  const normalized = value.trim();

  if (!PRIVATE_KEY_PATTERN.test(normalized)) {
    throw new Error("A custody private key must be exactly 32 bytes of hexadecimal data.");
  }

  const privateKey = `${normalized.startsWith("0x") ? "" : "0x"}${normalized}`.toLowerCase() as Hex;

  try {
    const account = privateKeyToAccount(privateKey);

    return {
      account,
      address: getAddress(account.address),
      privateKey,
      kind: "privateKey",
      secret: {
        kind: "private-key",
        privateKey
      }
    };
  } catch {
    throw new Error("The custody private key is not a valid secp256k1 private key.");
  }
}

function parseSecretValue(value: string): CustodyAccount {
  if (PRIVATE_KEY_PATTERN.test(value.trim())) {
    return parsePrivateKey(value);
  }

  return parseMnemonic(value);
}

function parseJsonCustodySecret(raw: string): CustodyAccount {
  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("The custody backup is not valid JSON.");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("The custody backup must be a JSON object.");
  }

  const record = payload as Record<string, unknown>;
  const supportedFields = [
    "seedPhrase",
    "mnemonic",
    "custodyPrivateKey",
    "privateKey"
  ] as const;
  const parsedAccounts: CustodyAccount[] = [];

  for (const field of supportedFields) {
    if (!(field in record)) {
      continue;
    }

    if (typeof record[field] !== "string" || !record[field].trim()) {
      throw new Error(`The custody backup field \"${field}\" must be a non-empty string.`);
    }

    parsedAccounts.push(parseSecretValue(record[field]));
  }

  if (parsedAccounts.length === 0) {
    throw new Error(
      "The custody backup does not contain seedPhrase, mnemonic, custodyPrivateKey, or privateKey."
    );
  }

  const [firstAccount, ...otherAccounts] = parsedAccounts;

  if (otherAccounts.some((candidate) => candidate.address !== firstAccount.address)) {
    throw new Error("The custody backup contains secrets for different Ethereum addresses.");
  }

  return firstAccount;
}

function normalizeRecoveryAddress(value: Address): Address {
  if (!isAddress(value)) {
    throw new Error("The Farcaster recovery address is not a valid Ethereum address.");
  }

  return getAddress(value);
}

function normalizeFid(value: unknown, fieldName = "fid"): number | null {
  let parsed: bigint;

  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    parsed = BigInt(value);
  } else if (typeof value === "string" && DECIMAL_INTEGER_PATTERN.test(value)) {
    parsed = BigInt(value);
  } else if (value === null || value === undefined) {
    return null;
  } else {
    throw new Error(`The ${fieldName} response is invalid.`);
  }

  if (parsed === 0n) {
    return null;
  }

  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`The ${fieldName} response is outside the supported range.`);
  }

  return Number(parsed);
}

function normalizeDecimalBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value === "bigint" && value >= 0n) {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && DECIMAL_INTEGER_PATTERN.test(value)) {
    return BigInt(value);
  }

  throw new Error(`The ${fieldName} response is not a non-negative decimal integer.`);
}

function normalizeTransactionHash(value: unknown): Hex {
  if (typeof value !== "string" || !TRANSACTION_HASH_PATTERN.test(value)) {
    throw new Error("The registration response did not include a valid transaction hash.");
  }

  return value as Hex;
}

function getAccountTestApi(): HypecastTestApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return getHypecastTestApi();
}

function createOptimismAccountClient(custodyAccount: CustodyAccount): OptimismAccountClient {
  const account = custodyAccount.account;
  const publicClient = createPublicClient({
    chain: optimism,
    transport: http(APP_CONFIG.optimismRpcUrl)
  });
  const walletClient = createWalletClient({
    account,
    chain: optimism,
    transport: http(APP_CONFIG.optimismRpcUrl)
  });

  return {
    getChainId: () => publicClient.getChainId(),
    getBalance: (address) => publicClient.getBalance({ address }),
    getRegistrationPrice: () =>
      publicClient.readContract({
        address: ID_GATEWAY_ADDRESS,
        abi: ID_GATEWAY_ABI,
        functionName: "price",
        args: []
      }),
    getFid: (address) =>
      publicClient.readContract({
        address: ID_REGISTRY_ADDRESS,
        abi: ID_REGISTRY_ABI,
        functionName: "idOf",
        args: [address]
      }),
    register: (recoveryAddress, value) =>
      walletClient.writeContract({
        address: ID_GATEWAY_ADDRESS,
        abi: ID_GATEWAY_ABI,
        functionName: "register",
        args: [recoveryAddress],
        value
      }),
    waitForTransactionReceipt: (transactionHash) =>
      publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        confirmations: 2
      })
  };
}

async function assertOptimismChain(client: OptimismAccountClient): Promise<void> {
  const chainId = await client.getChainId();

  if (chainId !== OPTIMISM_CHAIN_ID) {
    throw new Error(
      `Farcaster account registration requires Optimism mainnet (chain ${OPTIMISM_CHAIN_ID}); the RPC returned chain ${chainId}.`
    );
  }
}

function normalizeTestInspection(
  payload: Record<string, unknown>,
  address: Address,
  recoveryAddress: Address,
  gasBufferWei: bigint
): OptimismAccountInspection {
  const balanceWei = normalizeDecimalBigInt(payload.balanceWei, "balanceWei");
  const registrationPriceWei = normalizeDecimalBigInt(
    payload.registrationPriceWei ?? payload.priceWei,
    "registrationPriceWei"
  );
  const recommendedBalanceWei =
    payload.recommendedBalanceWei === undefined
      ? registrationPriceWei + gasBufferWei
      : normalizeDecimalBigInt(payload.recommendedBalanceWei, "recommendedBalanceWei");
  const recommendedFundingWei =
    payload.recommendedFundingWei === undefined
      ? recommendedBalanceWei > balanceWei
        ? recommendedBalanceWei - balanceWei
        : 0n
      : normalizeDecimalBigInt(payload.recommendedFundingWei, "recommendedFundingWei");

  return {
    chainId: OPTIMISM_CHAIN_ID,
    address,
    recoveryAddress,
    fid: normalizeFid(payload.fid),
    balanceWei,
    registrationPriceWei,
    gasBufferWei,
    recommendedBalanceWei,
    recommendedFundingWei
  };
}

export function parseCustodySecret(raw: string): CustodyAccount {
  const normalized = raw.trim();

  if (!normalized) {
    throw new Error("Enter a recovery phrase, custody private key, or backup JSON.");
  }

  return normalized.startsWith("{")
    ? parseJsonCustodySecret(normalized)
    : parseSecretValue(normalized);
}

export function generateCustodyAccount(): CustodyAccount {
  return parseMnemonic(generateBip39Mnemonic(englishWordlist, 128));
}

export function createCustodyBackupJson(
  custodyAccount: CustodyAccount,
  options: { now?: Date } = {}
): string {
  const now = options.now ?? new Date();
  const secretField =
    custodyAccount.secret.kind === "mnemonic"
      ? { seedPhrase: custodyAccount.secret.mnemonic }
      : { custodyPrivateKey: custodyAccount.secret.privateKey };

  return `${JSON.stringify(
    {
      version: 1,
      app: APP_CONFIG.appName,
      createdAt: now.toISOString(),
      address: custodyAccount.address,
      warning: "This plaintext backup controls the Farcaster account. Keep it secret and offline.",
      ...secretField
    },
    null,
    2
  )}\n`;
}

export function createCustodyBackupDownload(
  custodyAccount: CustodyAccount,
  options: { now?: Date } = {}
): CustodyBackupDownload {
  const now = options.now ?? new Date();

  return {
    fileName: `hypecast-custody-${custodyAccount.address.toLowerCase()}-${now
      .toISOString()
      .slice(0, 10)}.json`,
    mimeType: "application/json",
    contents: createCustodyBackupJson(custodyAccount, { now })
  };
}

export async function inspectAccountOnOptimism(
  custodyAccount: CustodyAccount,
  recovery: Address,
  options: AccountOperationOptions = {}
): Promise<OptimismAccountInspection> {
  const address = getAddress(custodyAccount.address);
  const recoveryAddress = normalizeRecoveryAddress(recovery);
  const gasBufferWei = options.gasBufferWei ?? DEFAULT_REGISTRATION_GAS_BUFFER_WEI;

  if (gasBufferWei < 0n) {
    throw new Error("The registration gas buffer cannot be negative.");
  }

  if (!options.client) {
    const testApi = getAccountTestApi();

    if (testApi?.inspectFarcasterAccount) {
      const payload = await testApi.inspectFarcasterAccount({
        address,
        recoveryAddress
      });
      return normalizeTestInspection(
        payload as unknown as Record<string, unknown>,
        address,
        recoveryAddress,
        gasBufferWei
      );
    }
  }

  const client = options.client ?? createOptimismAccountClient(custodyAccount);
  await assertOptimismChain(client);

  const [fidValue, balanceWei, registrationPriceWei] = await Promise.all([
    client.getFid(address),
    client.getBalance(address),
    client.getRegistrationPrice()
  ]);
  const recommendedBalanceWei = registrationPriceWei + gasBufferWei;
  const recommendedFundingWei =
    recommendedBalanceWei > balanceWei ? recommendedBalanceWei - balanceWei : 0n;

  return {
    chainId: OPTIMISM_CHAIN_ID,
    address,
    recoveryAddress,
    fid: normalizeFid(fidValue),
    balanceWei,
    registrationPriceWei,
    gasBufferWei,
    recommendedBalanceWei,
    recommendedFundingWei
  };
}

export async function registerAccountOnOptimism(
  custodyAccount: CustodyAccount,
  recovery: Address,
  options: AccountOperationOptions = {}
): Promise<OptimismAccountRegistration> {
  const address = getAddress(custodyAccount.address);
  const recoveryAddress = normalizeRecoveryAddress(recovery);

  if (!options.client) {
    const testApi = getAccountTestApi();

    if (testApi?.registerFarcasterAccount) {
      let inspection: OptimismAccountInspection | undefined;

      if (testApi.inspectFarcasterAccount) {
        inspection = await inspectAccountOnOptimism(custodyAccount, recoveryAddress, options);
      }

      const payload = await testApi.registerFarcasterAccount({
        account: {
          address,
          privateKey: custodyAccount.privateKey,
          mnemonic: custodyAccount.mnemonic,
          kind: custodyAccount.kind
        } satisfies HypecastTestFarcasterCustodyAccount,
        recoveryAddress
      });
      const payloadRecord = payload as unknown as Record<string, unknown>;
      const fid = normalizeFid(payloadRecord.fid);

      if (fid === null) {
        throw new Error("Optimism registration completed without an FID readback.");
      }

      const receiptPayload =
        payloadRecord.receipt && typeof payloadRecord.receipt === "object"
          ? (payloadRecord.receipt as Record<string, unknown>)
          : payloadRecord;
      const transactionHash = normalizeTransactionHash(
        receiptPayload.transactionHash ?? payloadRecord.transactionHash
      );
      const blockNumber = normalizeDecimalBigInt(
        receiptPayload.blockNumber ?? payloadRecord.blockNumber ?? "0",
        "blockNumber"
      );
      const registrationPriceWei = inspection?.registrationPriceWei ??
        normalizeDecimalBigInt(
          payloadRecord.registrationPriceWei ?? payloadRecord.priceWei ?? "0",
          "registrationPriceWei"
        );

      return {
        chainId: OPTIMISM_CHAIN_ID,
        address,
        recoveryAddress,
        fid,
        registrationPriceWei,
        receipt: {
          transactionHash,
          blockNumber,
          status: "success"
        }
      };
    }
  }

  const client = options.client ?? createOptimismAccountClient(custodyAccount);
  await assertOptimismChain(client);

  const existingFid = normalizeFid(await client.getFid(address));

  if (existingFid !== null) {
    throw new Error(`This custody address is already registered as FID ${existingFid}.`);
  }

  const [balanceWei, registrationPriceWei] = await Promise.all([
    client.getBalance(address),
    client.getRegistrationPrice()
  ]);

  if (balanceWei < registrationPriceWei) {
    throw new Error("The custody address does not have enough ETH for the registration price.");
  }

  const transactionHash = await client.register(recoveryAddress, registrationPriceWei);
  const receipt = await client.waitForTransactionReceipt(transactionHash);

  if (receipt.status !== "success") {
    throw new Error("The Optimism Farcaster registration transaction reverted.");
  }

  const fid = normalizeFid(await client.getFid(address));

  if (fid === null) {
    throw new Error("Optimism registration was mined, but the IdRegistry did not return an FID.");
  }

  return {
    chainId: OPTIMISM_CHAIN_ID,
    address,
    recoveryAddress,
    fid,
    registrationPriceWei,
    receipt: {
      transactionHash: receipt.transactionHash ?? transactionHash,
      blockNumber: receipt.blockNumber,
      status: "success"
    }
  };
}

export async function fetchFarcasterProfileByFid(
  fid: number,
  options: ProfileFetchOptions = {}
): Promise<FarcasterProfile> {
  if (!Number.isSafeInteger(fid) || fid <= 0) {
    throw new Error("A positive integer FID is required to load a Farcaster profile.");
  }

  const fallbackProfile: FarcasterProfile = { fid };

  try {
    const apiKey = options.apiKey?.trim() || getEffectiveNeynarApiKey();

    if (!apiKey) {
      return fallbackProfile;
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    const url = new URL("https://api.neynar.com/v2/farcaster/user/bulk");
    url.searchParams.set("fids", String(fid));
    const response = await fetchImpl(url.toString(), {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-api-key": apiKey
      }
    });

    if (!response.ok) {
      return fallbackProfile;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const users = Array.isArray(payload.users) ? payload.users : [];
    const user = users[0];

    if (!user || typeof user !== "object") {
      return fallbackProfile;
    }

    const record = user as Record<string, unknown>;
    const profile =
      record.profile && typeof record.profile === "object"
        ? (record.profile as Record<string, unknown>)
        : {};
    const bio =
      profile.bio && typeof profile.bio === "object"
        ? (profile.bio as Record<string, unknown>)
        : {};
    const custodyValue = record.custody_address ?? record.custodyAddress;

    return {
      fid,
      username: typeof record.username === "string" ? record.username : undefined,
      displayName:
        typeof record.display_name === "string"
          ? record.display_name
          : typeof record.displayName === "string"
            ? record.displayName
            : undefined,
      bio: typeof bio.text === "string" ? bio.text : undefined,
      pfpUrl:
        typeof record.pfp_url === "string"
          ? record.pfp_url
          : typeof record.pfpUrl === "string"
            ? record.pfpUrl
            : undefined,
      custody:
        typeof custodyValue === "string" && isAddress(custodyValue)
          ? getAddress(custodyValue)
          : undefined
    };
  } catch {
    return fallbackProfile;
  }
}
