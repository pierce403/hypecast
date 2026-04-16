import { expect, test, type Page } from "@playwright/test";

import {
  defaultWalletAddress,
  dispatchInstallPrompt,
  mountApp,
  primaryNav,
  shortAddress,
  triggerPullToRefresh
} from "./test-helpers";
import type { FeedSnapshot } from "../src/types";
import { defaultFeedSnapshot } from "./feed-fixture";

const personalizedFeedSnapshot: FeedSnapshot = {
  generatedAt: "2026-04-16T04:00:00.000Z",
  mode: "following",
  provider: "neynar",
  viewerFid: 777,
  sources: [],
  casts: [
    {
      id: "personal-1",
      channel: "following",
      authorName: "Real Follow",
      authorHandle: "realfollow",
      authorInitial: "R",
      authorAvatarUrl: "https://example.com/realfollow.png",
      accentClass: "accent-live",
      timestamp: 1776310800000,
      contextLabel: "in builders",
      text: "A real following-feed cast just landed in Hypecast.",
      media: {
        kind: "link",
        href: "https://example.com/personalized-preview",
        eyebrow: "example.com",
        title: "Real personalized preview",
        description: "Pulled from the signed-in user's following feed."
      }
    }
  ]
};

async function signInWithFarcaster(page: Page) {
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await page.locator(".overlay-sheet").getByRole("button", { name: "Sign In With Farcaster" }).click();
}

function shellMain(page: Page) {
  return page.getByRole("main");
}

function overlaySheet(page: Page) {
  return page.locator(".overlay-sheet");
}

async function mockInlineVideoPlayback(page: Page) {
  await page.evaluate(() => {
    const playingVideos = new WeakSet<HTMLMediaElement>();

    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return !playingVideos.has(this);
      }
    });

    HTMLMediaElement.prototype.play = function () {
      playingVideos.add(this);
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };

    HTMLMediaElement.prototype.pause = function () {
      playingVideos.delete(this);
      this.dispatchEvent(new Event("pause"));
    };
  });
}

test("renders the mobile shell, filters snapshot tabs, and opens overlays", async ({ page }) => {
  const nav = primaryNav(page);
  const main = shellMain(page);

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
  await expect(page.getByText("identity bridge")).toHaveCount(0);
  await expect(page.getByText("Sign in with Farcaster to replace the placeholder chrome")).toHaveCount(0);

  await page.getByRole("tab", { name: "farcaster" }).click();
  await expect(
    main.getByText("introducing snaps. a new primitive for richer, interactive feed posts.")
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
  await expect(page.getByRole("button", { name: "Sign in to post locally" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { level: 2, name: "Composer placement is in" })
  ).toHaveCount(0);
});

test("renders clickable media cards, plain attachments, and download controls", async ({ page }) => {
  const main = shellMain(page);

  await mountApp(page);

  await expect(main.getByText("Snap Kitchen Sink")).toBeVisible();
  await expect(main.locator('.media-link-card[href="https://snap.host/kitchen-sink"]')).toBeVisible();

  await page.getByRole("tab", { name: "base" }).click();
  await expect(main.locator('.media-image img[alt="Base preview"]')).toBeVisible();
  await expect(main.getByText("Builder Week")).toBeVisible();
  await expect(main.getByRole("button", { name: "Open image fullscreen" })).toBeVisible();
  await expect(main.locator('.media-actions a[href="https://base.org/builder-week"]')).toBeVisible();
  await expect(main.getByRole("button", { name: "Download image" })).toBeVisible();

  await page.getByRole("tab", { name: "dwr" }).click();
  await expect(main.locator('.media-image.is-attachment img[alt="River photo at sunset"]')).toBeVisible();
  await expect(main.locator(".media-image.is-attachment .media-copy")).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Download image" })).toBeVisible();

  await page.getByRole("tab", { name: "v" }).click();
  await expect(main.locator('.media-video video')).toBeVisible();
  await expect(main.getByRole("button", { name: "Play video inline" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Download video" })).toBeVisible();
});

test("opens feed images and videos in the fullscreen media viewer", async ({ page }) => {
  const main = shellMain(page);
  const mediaViewer = page.locator(".media-viewer");

  await mountApp(page);

  await page.getByRole("tab", { name: "base" }).click();
  await main.getByRole("button", { name: "Open image fullscreen" }).click();
  await expect(mediaViewer).toBeVisible();
  await expect(mediaViewer.getByRole("button", { name: "Close media viewer" })).toBeVisible();
  await expect(mediaViewer.getByRole("button", { name: "Download image" })).toBeVisible();
  await expect(mediaViewer.locator(".media-viewer-image")).toBeVisible();
  await mediaViewer.getByRole("button", { name: "Close media viewer" }).click();
  await expect(mediaViewer).toHaveCount(0);

  await page.getByRole("tab", { name: "v" }).click();
  await main.getByRole("button", { name: "Open video fullscreen" }).click();
  await expect(mediaViewer).toBeVisible();
  await expect(mediaViewer.getByRole("button", { name: "Download video" })).toBeVisible();
  await expect(mediaViewer.locator(".media-viewer-video")).toBeVisible();
});

test("plays video inline from the feed card", async ({ page }) => {
  const main = shellMain(page);

  await mountApp(page);
  await mockInlineVideoPlayback(page);

  await page.getByRole("tab", { name: "v" }).click();
  await main.getByRole("button", { name: "Play video inline" }).click();

  await expect(main.locator(".media-video-player")).toHaveClass(/is-playing/);
  await expect(main.getByRole("button", { name: "Pause inline video" })).toHaveText("Pause");
});

test("reply, recast, and like buttons update cast state", async ({ page }) => {
  const main = shellMain(page);
  const shellContent = page.locator(".shell-content");
  const replyText = "Shipping a real reply from the Hypecast shell.";
  const likeButton = main.locator('[data-action="like-cast"][data-cast-id="cast-farcaster-snaps"]');
  const recastButton = main.locator('[data-action="recast-cast"][data-cast-id="cast-farcaster-snaps"]');
  const replyButton = main.locator('[data-action="reply-cast"][data-cast-id="cast-farcaster-snaps"]');

  await mountApp(page);

  await page.getByRole("tab", { name: "farcaster" }).click();
  await expect(likeButton.locator(".feed-action-count")).toHaveText("29");
  await expect(recastButton.locator(".feed-action-count")).toHaveText("12");
  await expect(replyButton.locator(".feed-action-count")).toHaveText("4");

  await shellContent.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const scrollBeforeLike = await shellContent.evaluate((node) => node.scrollTop);
  expect(scrollBeforeLike).toBeGreaterThan(0);

  await likeButton.click();
  await expect(likeButton).toHaveAttribute("aria-pressed", "true");
  await expect(likeButton.locator(".feed-action-count")).toHaveText("30");
  await expect(
    main.getByText("Like saved in Hypecast only. It has not been sent to Farcaster.")
  ).toBeVisible();
  await expect(
    main.locator('.feed-action-status-link[href="https://warpcast.com/farcaster/0xcastfarcastersnaps"]')
  ).toBeVisible();
  await expect
    .poll(async () => shellContent.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);

  await recastButton.click();
  await expect(recastButton).toHaveAttribute("aria-pressed", "true");
  await expect(recastButton.locator(".feed-action-count")).toHaveText("13");
  await expect(
    main.getByText("Like + Recast saved in Hypecast only. It has not been sent to Farcaster.")
  ).toBeVisible();

  await signInWithFarcaster(page);
  await page.getByRole("button", { name: "Close account sheet" }).click();

  await replyButton.click();
  await expect(page.getByRole("heading", { level: 2, name: "Reply to @farcaster" })).toBeVisible();
  await expect(
    page.getByText("Replies stay local to Hypecast for now and will not appear in Warpcast or other Farcaster clients.")
  ).toBeVisible();
  await page.getByPlaceholder("What’s happening on Hypecast?").fill(replyText);
  await page.getByRole("button", { name: "Reply in Hypecast only" }).click();

  await expect(main.getByText(replyText)).toBeVisible();
  await expect(main.getByText("local only").first()).toBeVisible();
  await expect(replyButton.locator(".feed-action-count")).toHaveText("5");
});

test("opens the cast menu and applies local delete, copy link, mute, and block actions", async ({ page }) => {
  const main = shellMain(page);

  await page.addInitScript(() => {
    let clipboardText = "";

    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          clipboardText = value;
          (window as Window & { __hypecastClipboard?: string }).__hypecastClipboard = clipboardText;
        }
      }
    });
  });

  await mountApp(page);

  await page.getByRole("tab", { name: "farcaster" }).click();
  await main.locator('[data-action="open-cast-menu"][data-cast-id="cast-farcaster-snaps"]').click();
  await expect(overlaySheet(page).getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(overlaySheet(page).getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(overlaySheet(page).getByRole("button", { name: "Mute @farcaster" })).toBeVisible();
  await expect(overlaySheet(page).getByRole("button", { name: "Block @farcaster" })).toBeVisible();

  await overlaySheet(page).getByRole("button", { name: "Copy link" }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => (window as Window & { __hypecastClipboard?: string }).__hypecastClipboard ?? "")
    )
    .toContain("cast=cast-farcaster-snaps");
  await expect
    .poll(async () =>
      page.evaluate(() => (window as Window & { __hypecastClipboard?: string }).__hypecastClipboard ?? "")
    )
    .toContain("fid=3");

  await main.locator('[data-action="open-cast-menu"][data-cast-id="cast-farcaster-snaps"]').click();
  await overlaySheet(page).getByRole("button", { name: "Delete" }).click();
  await expect(main.getByText("introducing snaps. a new primitive for richer, interactive feed posts.")).toHaveCount(0);
  await expect(main.getByText("clients can now render richer post actions without leaving the feed.")).toBeVisible();

  await main.locator('[data-action="open-cast-menu"][data-cast-id="cast-farcaster-clients"]').click();
  await overlaySheet(page).getByRole("button", { name: "Mute @farcaster" }).click();
  await expect(main.getByText("clients can now render richer post actions without leaving the feed.")).toHaveCount(0);
  await expect(main.getByRole("heading", { level: 2, name: "No recent casts are available for this tab." })).toBeVisible();

  await page.getByRole("tab", { name: "v" }).click();
  await main.locator('[data-action="open-cast-menu"][data-cast-id="cast-v-elon"]').click();
  await overlaySheet(page).getByRole("button", { name: "Block @v" }).click();
  await expect(main.getByText("Elon likes the Farcasters.")).toHaveCount(0);
  await expect(main.getByText("shipping another round of protocol and app performance work.")).toHaveCount(0);
});

test("routes cast links from query params into the feed shell", async ({ page }) => {
  const main = shellMain(page);

  await mountApp(page, {}, "/?fid=3&cast=cast-farcaster-snaps");

  await expect(main.getByText("Showing the requested cast at the top of the feed.")).toBeVisible();
  await expect(main.getByText("introducing snaps. a new primitive for richer, interactive feed posts.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "farcaster" })).toHaveAttribute("aria-selected", "true");

  await main.getByRole("button", { name: "Clear route" }).click();
  await expect(main.getByText("Showing the requested cast at the top of the feed.")).toHaveCount(0);
  await expect(page).toHaveURL(/^(?!.*[?&]cast=).*$/);
});

test("refuses to render unsafe remote feed URLs", async ({ page }) => {
  const main = shellMain(page);

  await mountApp(page, {
    feed: {
      snapshot: {
        generatedAt: "2026-04-16T06:00:00.000Z",
        mode: "public",
        provider: "bundled",
        sources: [
          {
            id: "following",
            label: "following",
            username: "following",
            displayName: "Following"
          }
        ],
        casts: [
          {
            id: "unsafe-1",
            channel: "following",
            authorName: "Unsafe Feed",
            authorHandle: "unsafe",
            authorInitial: "U",
            authorAvatarUrl: "javascript:alert(1)",
            accentClass: "accent-live",
            timestamp: 1776320000000,
            text: "This cast should not get executable URLs.",
            permalink: "javascript:alert(2)",
            media: {
              kind: "image",
              src: "javascript:alert(3)",
              title: "Unsafe preview",
              description: "Falls back to text-only media rendering."
            }
          }
        ]
      }
    }
  });

  await expect(main.getByText("This cast should not get executable URLs.")).toBeVisible();
  await expect(main.locator(".feed-card img.feed-avatar")).toHaveCount(0);
  await expect(main.locator(".feed-card .feed-avatar-fallback")).toBeVisible();
  await expect(main.locator(".feed-card .media-image img")).toHaveCount(0);
  await expect(main.getByText("Unsafe preview")).toBeVisible();
  await expect(main.locator('.feed-card .feed-menu[href^="javascript:"]')).toHaveCount(0);
});

test("frames the shell cleanly on desktop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only layout assertion.");

  await mountApp(page);

  const viewport = page.viewportSize();
  const rails = page.locator(".desktop-rail");
  const shell = page.locator(".phone-shell");
  const shellBox = await shell.boundingBox();
  const leftRailBox = await rails.nth(0).boundingBox();
  const rightRailBox = await rails.nth(1).boundingBox();

  await expect(rails).toHaveCount(2);
  await expect(page.getByText("desktop stage")).toBeVisible();

  expect(shellBox).toBeTruthy();
  expect(leftRailBox).toBeTruthy();
  expect(rightRailBox).toBeTruthy();
  expect(shellBox?.width ?? 0).toBeLessThan((viewport?.width ?? 0) * 0.4);
  expect(Math.abs((shellBox?.x ?? 0) + (shellBox?.width ?? 0) / 2 - (viewport?.width ?? 0) / 2)).toBeLessThanOrEqual(24);
  expect((leftRailBox?.x ?? 0) + (leftRailBox?.width ?? 0)).toBeLessThan(shellBox?.x ?? 0);
  expect(rightRailBox?.x ?? 0).toBeGreaterThan((shellBox?.x ?? 0) + (shellBox?.width ?? 0));
});

test("loads a personalized following feed automatically after Farcaster sign-in", async ({ page }) => {
  const main = shellMain(page);

  await mountApp(page, {
    feed: {
      personalizedSnapshot: personalizedFeedSnapshot
    }
  });

  await signInWithFarcaster(page);

  await expect(overlaySheet(page).getByText("Following feed for fid 777 via Neynar.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh following feed" })).toBeEnabled();
  await expect(page.locator('[data-field="neynar-api-key"]')).toHaveValue("");
  await expect(overlaySheet(page).getByText("App default active")).toBeVisible();

  await page.getByRole("button", { name: "Close account sheet" }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(main.getByText("A real following-feed cast just landed in Hypecast.")).toBeVisible();
});

test("shows the current build id and build time in Settings", async ({ page }) => {
  const nav = primaryNav(page);

  await mountApp(page);

  await nav.getByRole("button", { name: "Apps" }).click();
  await page.getByRole("button", { name: "Settings" }).click();

  const settingsSheet = overlaySheet(page);

  await expect(settingsSheet.getByRole("heading", { level: 2, name: "Settings" })).toBeVisible();
  await expect(settingsSheet.getByRole("heading", { level: 3, name: "About this build" })).toBeVisible();
  await expect(settingsSheet.locator("[data-build-id]")).toHaveText(/[0-9a-f]{7}|dev/);
  await expect(settingsSheet.locator("[data-build-time]")).toHaveText(
    /[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M (?:[A-Z]{2,5}|GMT[+-]\d{1,2})/
  );
  await expect(settingsSheet.locator("[data-build-time]")).toHaveAttribute(
    "title",
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
  );
  await expect(settingsSheet.locator("[data-build-time]")).not.toHaveText(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
  );
});

test("keeps the bottom nav pinned while the feed scrolls", async ({ page }) => {
  const nav = primaryNav(page);

  await mountApp(page);
  const viewport = page.viewportSize();

  const before = await nav.boundingBox();
  const pageMetricsBefore = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
    clientHeight: document.scrollingElement?.clientHeight ?? 0
  }));

  await page.locator(".shell-content").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });

  const after = await nav.boundingBox();

  expect(before?.y).toBeTruthy();
  expect(after?.y).toBeTruthy();
  expect(Math.round(after?.y ?? 0)).toBe(Math.round(before?.y ?? 0));
  expect(pageMetricsBefore.scrollHeight - pageMetricsBefore.clientHeight).toBeLessThanOrEqual(2);
  expect((after?.y ?? 0) + (after?.height ?? 0)).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
});

test("pulling down from the top of the feed refreshes the snapshot", async ({ page }) => {
  const main = shellMain(page);
  const refreshedSnapshot: FeedSnapshot = {
    ...defaultFeedSnapshot,
    generatedAt: "2026-04-16T09:30:00.000Z",
    casts: [
      {
        id: "cast-refresh-new",
        channel: "following",
        authorName: "Refresh Bot",
        authorHandle: "refreshbot",
        authorInitial: "R",
        accentClass: "accent-live",
        timestamp: 1776331800000,
        contextLabel: "in following",
        text: "Pull to refresh just loaded a newer snapshot."
      },
      ...defaultFeedSnapshot.casts
    ]
  };

  await mountApp(page, {
    feed: {
      delayMs: 20,
      snapshots: [defaultFeedSnapshot, refreshedSnapshot]
    }
  });

  await expect(main.getByText("Pull to refresh just loaded a newer snapshot.")).toHaveCount(0);

  await triggerPullToRefresh(page);

  await expect(main.getByText("Pull to refresh just loaded a newer snapshot.")).toBeVisible();
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
  const main = shellMain(page);
  const expectedWalletLabel = `${shortAddress(defaultWalletAddress)} on Base`;

  await mountApp(page);

  await nav.getByRole("button", { name: "Wallet" }).click();
  await page.getByRole("button", { name: "Connect wallet" }).click();

  await expect(main.getByText(expectedWalletLabel)).toBeVisible();

  await nav.getByRole("button", { name: "Notifications" }).click();
  await expect(main.getByText(expectedWalletLabel)).toBeVisible();
});

test("signs in with Farcaster, shows the pending QR state, and binds the profile", async ({
  page
}) => {
  const overlay = overlaySheet(page);

  await mountApp(page, {
    farcaster: {
      profileDelayMs: 150
    }
  });

  await signInWithFarcaster(page);

  await expect(page.getByAltText("Farcaster sign-in QR code")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open deep link" })).toBeVisible();
  await expect(
    overlay.getByText("Use Warpcast or another Farcaster wallet to complete the sign-in flow.")
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Ada Lovelace" })).toBeVisible();

  await expect(overlay.getByText("@ada", { exact: true })).toBeVisible();
});

test("persists the Farcaster profile across reloads", async ({ page }) => {
  await mountApp(page);

  await signInWithFarcaster(page);
  await expect(page.getByRole("heading", { level: 2, name: "Ada Lovelace" })).toBeVisible();
  await page.getByRole("button", { name: "Close account sheet" }).click();

  await page.reload();
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Ada Lovelace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In With Farcaster" })).toHaveCount(0);
});

test("searches local shell content and opens matching results", async ({ page }) => {
  const main = shellMain(page);

  await mountApp(page);

  await signInWithFarcaster(page);
  await expect(page.getByRole("heading", { level: 2, name: "Ada Lovelace" })).toBeVisible();
  await page.getByRole("button", { name: "Close account sheet" }).click();

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
    main.getByText("introducing snaps. a new primitive for richer, interactive feed posts.")
  ).toBeVisible();
});

test("preserves composer drafts locally and publishes a local cast after sign-in", async ({
  page
}) => {
  const main = shellMain(page);
  const draft = "Shipping the next Hypecast draft straight from the phone shell.";

  await mountApp(page);

  await page.getByRole("button", { name: "New cast" }).click();
  await page.getByPlaceholder("What’s happening on Hypecast?").fill(draft);
  await expect(page.getByText("Draft saved locally")).toBeVisible();
  await page.getByRole("button", { name: "Close composer" }).click();

  await page.getByRole("button", { name: "New cast" }).click();
  await expect(page.getByPlaceholder("What’s happening on Hypecast?")).toHaveValue(draft);
  await expect(page.getByRole("button", { name: "Sign in to post locally" })).toBeDisabled();
  await page.getByRole("button", { name: "Close composer" }).click();

  await signInWithFarcaster(page);
  await expect(page.getByRole("heading", { level: 2, name: "Ada Lovelace" })).toBeVisible();
  await page.getByRole("button", { name: "Close account sheet" }).click();

  await page.getByRole("button", { name: "New cast" }).click();
  await expect(page.getByPlaceholder("What’s happening on Hypecast?")).toHaveValue(draft);
  await expect(
    page.getByText("Posts stay local to Hypecast for now and will not appear in Warpcast or other Farcaster clients.")
  ).toBeVisible();
  await page.getByRole("button", { name: "Post in Hypecast only" }).click();

  await expect(main.getByText(draft)).toBeVisible();
  await expect(main.getByText("local only").first()).toBeVisible();

  await page.getByRole("button", { name: "New cast" }).click();
  await expect(page.getByPlaceholder("What’s happening on Hypecast?")).toHaveValue("");
});

test("requires a wallet before XMTP bootstrap", async ({ page }) => {
  const nav = primaryNav(page);
  const main = shellMain(page);

  await mountApp(page);

  await nav.getByRole("button", { name: "Apps" }).click();
  await page.getByRole("button", { name: /^XMTP$/ }).click();

  await nav.getByRole("button", { name: "Chat" }).click();
  await expect(main.getByText("Connect a wallet before initializing XMTP.")).toBeVisible();

  await page.getByRole("button", { name: "Connect wallet first" }).click();
  await expect(page.getByRole("button", { name: "Initialize XMTP" })).toBeEnabled();

  await page.getByRole("button", { name: "Initialize XMTP" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "XMTP ready" })).toBeVisible();
  await expect(main.getByText("inbox-987654321")).toBeVisible();
});

test("renders notification summaries from Farcaster, wallet, and XMTP state", async ({
  page
}) => {
  const nav = primaryNav(page);
  const main = shellMain(page);
  const expectedWalletLabel = `${shortAddress(defaultWalletAddress)} on Base`;

  await mountApp(page);

  await signInWithFarcaster(page);
  await expect(page.getByRole("heading", { level: 2, name: "Ada Lovelace" })).toBeVisible();
  await page.getByRole("button", { name: "Close account sheet" }).click();

  await nav.getByRole("button", { name: "Wallet" }).click();
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(main.getByText(expectedWalletLabel)).toBeVisible();

  await nav.getByRole("button", { name: "Chat" }).click();
  await page.getByRole("button", { name: "Initialize XMTP" }).click();
  await expect(main.getByText("inbox-987654321")).toBeVisible();

  await nav.getByRole("button", { name: "Notifications" }).click();
  await expect(main.getByText("Ada Lovelace is ready on Hypecast.")).toBeVisible();
  await expect(main.getByText(expectedWalletLabel)).toBeVisible();
  await expect(main.getByText("XMTP inbox inbox-98765")).toBeVisible();
});
