import { createAppClient, viemConnector } from "@farcaster/auth-client";
import QRCode from "qrcode";

import { APP_CONFIG } from "../config";
import { getHypecastTestApi } from "../test-support";
import type { FarcasterProfile } from "../types";

const appClient = createAppClient({
  ethereum: viemConnector(APP_CONFIG.optimismRpcUrl)
});

export interface FarcasterChannel {
  channelToken: string;
  url: string;
  nonce: string;
}

function createNonce(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 16);
}

export async function createFarcasterChannel(options: {
  domain: string;
  siweUri: string;
}): Promise<FarcasterChannel> {
  const testApi = getHypecastTestApi();
  const nonce = createNonce();

  if (testApi?.createFarcasterChannel) {
    const response = await testApi.createFarcasterChannel(options);

    return {
      channelToken: response.channelToken,
      url: response.url,
      nonce: response.nonce ?? nonce
    };
  }

  const response = await appClient.createChannel({
    domain: options.domain,
    siweUri: options.siweUri,
    nonce
  });

  if (response.isError) {
    throw response.error;
  }

  return {
    channelToken: response.data.channelToken,
    url: response.data.url,
    nonce
  };
}

export async function createChannelQrCode(url: string): Promise<string> {
  const testApi = getHypecastTestApi();

  if (testApi?.createChannelQrCode) {
    return testApi.createChannelQrCode(url);
  }

  return QRCode.toDataURL(url, {
    margin: 1,
    width: 240,
    color: {
      dark: "#08111d",
      light: "#0000"
    }
  });
}

export async function waitForFarcasterProfile(options: {
  channelToken: string;
  domain: string;
  nonce: string;
  onPoll?: () => void;
}): Promise<FarcasterProfile> {
  const testApi = getHypecastTestApi();

  if (testApi?.waitForFarcasterProfile) {
    return testApi.waitForFarcasterProfile(options);
  }

  const status = await appClient.watchStatus({
    channelToken: options.channelToken,
    timeout: 5 * 60_000,
    interval: 1_500,
    onResponse: () => options.onPoll?.()
  });

  if (status.isError) {
    throw status.error;
  }

  if (!status.data.message || !status.data.signature || !status.data.fid) {
    throw new Error("The Farcaster relay did not return a complete sign-in payload.");
  }

  const verification = await appClient.verifySignInMessage({
    nonce: options.nonce,
    domain: options.domain,
    message: status.data.message,
    signature: status.data.signature
  });

  if (verification.isError || !verification.success) {
    throw verification.error ?? new Error("Farcaster sign-in could not be verified.");
  }

  return {
    fid: status.data.fid,
    username: status.data.username,
    displayName: status.data.displayName,
    bio: status.data.bio,
    pfpUrl: status.data.pfpUrl,
    custody: status.data.custody
  };
}
