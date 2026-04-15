import { Client, IdentifierKind, createBackend } from "@xmtp/browser-sdk";
import { toBytes, type Address } from "viem";

import { APP_CONFIG } from "../config";
import { getHypecastTestApi } from "../test-support";
import type { WalletSession } from "./wallet";

export interface XmtpSession {
  inboxId: string;
  accountIdentifier: string;
  installationId: string;
  client: Client<unknown>;
}

export async function connectXmtp(
  wallet: WalletSession,
  address: Address
): Promise<XmtpSession> {
  const testApi = getHypecastTestApi();

  if (testApi?.connectXmtp) {
    const session = await testApi.connectXmtp({
      address,
      chainId: wallet.chainId,
      chainName: wallet.chainName
    });

    return {
      inboxId: session.inboxId,
      accountIdentifier: session.accountIdentifier,
      installationId: session.installationId ?? "test-installation",
      client: {
        close: () => {}
      } as Client<unknown>
    };
  }

  type CreateClientOptions = Parameters<typeof Client.create>[1];

  const signer = {
    type: "EOA" as const,
    getIdentifier: () => ({
      identifier: address.toLowerCase(),
      identifierKind: IdentifierKind.Ethereum
    }),
    signMessage: async (message: string) =>
      toBytes(
        await wallet.client.signMessage({
          account: address,
          message
        })
      )
  };

  const backend = await createBackend({
    env: APP_CONFIG.xmtpEnv,
    appVersion: "hypecast/0.1.0"
  });

  const client = await Client.create(signer, { backend } as CreateClientOptions);

  if (!client.inboxId || !client.accountIdentifier || !client.installationId) {
    client.close();
    throw new Error("XMTP client initialized without a usable inbox identity.");
  }

  return {
    inboxId: client.inboxId,
    accountIdentifier: client.accountIdentifier.identifier,
    installationId: client.installationId,
    client
  };
}
