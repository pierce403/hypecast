import { custom, createWalletClient, type Address, type WalletClient } from "viem";
import { base, mainnet, optimism } from "viem/chains";

export interface InjectedProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

export interface WalletSession {
  address: Address;
  chainId: number;
  chainName: string;
  provider: InjectedProvider;
  client: WalletClient;
}

const CHAIN_LABELS = new Map<number, string>([
  [mainnet.id, mainnet.name],
  [optimism.id, optimism.name],
  [base.id, base.name]
]);

function getInjectedProvider(): InjectedProvider {
  const provider = (window as Window & { ethereum?: InjectedProvider }).ethereum;

  if (!provider) {
    throw new Error(
      "No injected wallet found. Install Coinbase Wallet, MetaMask, or another EVM wallet."
    );
  }

  return provider;
}

export async function connectWallet(): Promise<WalletSession> {
  const provider = getInjectedProvider();

  await provider.request({ method: "eth_requestAccounts" });

  const walletClient = createWalletClient({
    chain: optimism,
    transport: custom(provider)
  });

  const [address] = await walletClient.getAddresses();

  if (!address) {
    throw new Error("The wallet connected, but no account was returned.");
  }

  const chainIdHex = (await provider.request({
    method: "eth_chainId"
  })) as string;
  const chainId = Number.parseInt(chainIdHex, 16);

  return {
    address,
    chainId,
    chainName: CHAIN_LABELS.get(chainId) ?? `Chain ${chainId}`,
    provider,
    client: walletClient
  };
}

export function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
