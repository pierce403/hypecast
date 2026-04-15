const XMTP_ENVS = [
  "local",
  "dev",
  "production",
  "testnet-staging",
  "testnet-dev",
  "testnet",
  "mainnet"
] as const;

export type XmtpEnvironment = (typeof XMTP_ENVS)[number];

function parseXmtpEnv(value?: string): XmtpEnvironment {
  if (value && (XMTP_ENVS as readonly string[]).includes(value)) {
    return value as XmtpEnvironment;
  }

  return "production";
}

export const APP_CONFIG = {
  appName: "Hypecast",
  optimismRpcUrl:
    import.meta.env.VITE_OPTIMISM_RPC_URL ?? "https://mainnet.optimism.io",
  xmtpEnv: parseXmtpEnv(import.meta.env.VITE_XMTP_ENV)
} as const;
