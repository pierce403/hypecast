import { expect, test } from "@playwright/test";

import {
  defaultWalletAddress,
  dispatchInstallPrompt,
  mountApp,
  primaryNav,
  shortAddress
} from "./test-helpers";

test("renders the mobile shell, filters snapshot tabs, and opens overlays", async ({ page }) => {
  const nav = primaryNav(page);

  await mountApp(page);

  await expect(page.getByRole("tab", { name: "following" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(nav.getByRole("button", { name: "Home" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Apps" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Wallet" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Notifications" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Chat" })).toBeVisible();
  await expect(nav.locator(".nav-badge")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New cast" })).toBeVisible();

  await page.getByRole("tab", { name: "farcaster" }).click();
  await expect(
    page.getByText("introducing snaps. a new primitive for richer, interactive feed posts.")
  ).toBeVisible();
  await expect(page.getByText("Elon likes the Farcasters.")).toHaveCount(0);

  await page.getByRole("button", { name: "Open search" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Quick jumps" })).toBeVisible();
  await page.locator(".overlay-sheet").getByRole("button", { name: "wallet", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Wallet" })).toBeVisible();

  await nav.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "New cast" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Composer placement is in" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in to publish" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { level: 2, name: "Composer placement is in" })
  ).toHaveCount(0);
});

test("keeps the bottom nav pinned while the feed scrolls", async ({ page }) => {
  const nav = primaryNav(page);

  await mountApp(page);

  const before = await nav.boundingBox();

  await page.locator(".shell-content").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });

  const after = await nav.boundingBox();

  expect(before?.y).toBeTruthy();
  expect(after?.y).toBeTruthy();
  expect(Math.round(after?.y ?? 0)).toBe(Math.round(before?.y ?? 0));
});

test("updates install state from the install prompt lifecycle", async ({ page }) => {
  const nav = primaryNav(page);

  await mountApp(page);

  await nav.getByRole("button", { name: "Apps" }).click();
  await expect(page.getByRole("button", { name: "Install app" })).toBeDisabled();

  await dispatchInstallPrompt(page);
  await expect(page.getByRole("button", { name: "Install app" })).toBeEnabled();

  await page.getByRole("button", { name: "Install app" }).click();
  await expect(page.getByRole("button", { name: "Installed" })).toBeDisabled();

  await nav.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByText("Installed and ready for home-screen launch.")).toBeVisible();
});

test("boots in standalone mode when the browser reports a PWA launch", async ({ page }) => {
  const nav = primaryNav(page);

  await mountApp(page, { isStandalone: true });

  await nav.getByRole("button", { name: "Apps" }).click();
  await expect(page.getByRole("button", { name: "Installed" })).toBeDisabled();
});

test("connects a wallet and surfaces the session in the shell", async ({ page }) => {
  const nav = primaryNav(page);
  const expectedWalletLabel = `${shortAddress(defaultWalletAddress)} on Base`;

  await mountApp(page);

  await nav.getByRole("button", { name: "Wallet" }).click();
  await page.getByRole("button", { name: "Connect wallet" }).click();

  await expect(page.getByText(expectedWalletLabel)).toBeVisible();

  await nav.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByText(expectedWalletLabel)).toBeVisible();
});

test("signs in with Farcaster, shows the pending QR state, and binds the profile", async ({
  page
}) => {
  await mountApp(page, {
    farcaster: {
      profileDelayMs: 150
    }
  });

  await page.getByRole("button", { name: "Sign In With Farcaster" }).click();

  await expect(page.getByAltText("Farcaster sign-in QR code")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open deep link" })).toBeVisible();
  await expect(page.getByText("Scan the QR code or open the deep link")).toBeVisible();
  await expect(page.getByText("Ada Lovelace is live in the shell")).toBeVisible();

  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Ada Lovelace" })).toBeVisible();
  await expect(page.locator(".overlay-sheet").getByText("@ada", { exact: true })).toBeVisible();
});

test("persists the Farcaster profile across reloads", async ({ page }) => {
  await mountApp(page);

  await page.getByRole("button", { name: "Sign In With Farcaster" }).click();
  await expect(page.getByText("Ada Lovelace is live in the shell")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Ada Lovelace is live in the shell")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In With Farcaster" })).toHaveCount(0);
});

test("searches local shell content and opens matching results", async ({ page }) => {
  await mountApp(page);

  await page.getByRole("button", { name: "Sign In With Farcaster" }).click();
  await expect(page.getByText("Ada Lovelace is live in the shell")).toBeVisible();

  await page.getByRole("button", { name: "Open search" }).click();
  await page.getByRole("textbox", { name: "Search Hypecast" }).fill("ada");
  await expect(page.getByRole("button", { name: /profile Ada Lovelace/i })).toBeVisible();
  await page.getByRole("button", { name: /profile Ada Lovelace/i }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Ada Lovelace" })).toBeVisible();
  await page.getByRole("button", { name: "Close account sheet" }).click();

  await page.getByRole("button", { name: "Open search" }).click();
  await page.getByRole("textbox", { name: "Search Hypecast" }).fill("snaps");
  await expect(page.getByRole("button", { name: /cast Farcaster: introducing snaps/i })).toBeVisible();
  await page.getByRole("button", { name: /cast Farcaster: introducing snaps/i }).click();
  await expect(page.getByRole("tab", { name: "farcaster" })).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("introducing snaps. a new primitive for richer, interactive feed posts.")
  ).toBeVisible();
});

test("preserves composer drafts locally and publishes a local cast after sign-in", async ({
  page
}) => {
  const draft = "Shipping the next Hypecast draft straight from the phone shell.";

  await mountApp(page);

  await page.getByRole("button", { name: "New cast" }).click();
  await page.getByPlaceholder("What’s happening on Hypecast?").fill(draft);
  await expect(page.getByText("Draft saved locally")).toBeVisible();
  await page.getByRole("button", { name: "Close composer" }).click();

  await page.getByRole("button", { name: "New cast" }).click();
  await expect(page.getByPlaceholder("What’s happening on Hypecast?")).toHaveValue(draft);
  await expect(page.getByRole("button", { name: "Sign in to publish" })).toBeDisabled();
  await page.getByRole("button", { name: "Close composer" }).click();

  await page.getByRole("button", { name: "Sign In With Farcaster" }).click();
  await expect(page.getByText("Ada Lovelace is live in the shell")).toBeVisible();

  await page.getByRole("button", { name: "New cast" }).click();
  await expect(page.getByPlaceholder("What’s happening on Hypecast?")).toHaveValue(draft);
  await page.getByRole("button", { name: "Publish cast" }).click();

  await expect(page.getByText(draft)).toBeVisible();

  await page.getByRole("button", { name: "New cast" }).click();
  await expect(page.getByPlaceholder("What’s happening on Hypecast?")).toHaveValue("");
});

test("requires a wallet before XMTP bootstrap", async ({ page }) => {
  const nav = primaryNav(page);

  await mountApp(page);

  await nav.getByRole("button", { name: "Apps" }).click();
  await page.getByRole("button", { name: /^XMTP$/ }).click();

  await nav.getByRole("button", { name: "Chat" }).click();
  await expect(page.getByText("Connect a wallet before initializing XMTP.")).toBeVisible();

  await page.getByRole("button", { name: "Connect wallet first" }).click();
  await expect(page.getByRole("button", { name: "Initialize XMTP" })).toBeEnabled();

  await page.getByRole("button", { name: "Initialize XMTP" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "XMTP ready" })).toBeVisible();
  await expect(page.getByText("inbox-987654321")).toBeVisible();
});

test("renders notification summaries from Farcaster, wallet, and XMTP state", async ({
  page
}) => {
  const nav = primaryNav(page);
  const expectedWalletLabel = `${shortAddress(defaultWalletAddress)} on Base`;

  await mountApp(page);

  await page.getByRole("button", { name: "Sign In With Farcaster" }).click();
  await expect(page.getByText("Ada Lovelace is live in the shell")).toBeVisible();

  await nav.getByRole("button", { name: "Wallet" }).click();
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText(expectedWalletLabel)).toBeVisible();

  await nav.getByRole("button", { name: "Chat" }).click();
  await page.getByRole("button", { name: "Initialize XMTP" }).click();
  await expect(page.getByText("inbox-987654321")).toBeVisible();

  await nav.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByText("Ada Lovelace is ready on Hypecast.")).toBeVisible();
  await expect(page.getByText(expectedWalletLabel)).toBeVisible();
  await expect(page.getByText("XMTP inbox inbox-98765")).toBeVisible();
});
