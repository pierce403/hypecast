import type Hls from "hls.js";

const HLS_MIME_TYPES = new Set(["application/vnd.apple.mpegurl", "application/x-mpegurl"]);

type HlsModule = typeof import("hls.js");

let hlsModulePromise: Promise<HlsModule> | null = null;

const hlsControllers = new WeakMap<HTMLVideoElement, Hls>();

function loadHlsModule(): Promise<HlsModule> {
  hlsModulePromise ??= import("hls.js");
  return hlsModulePromise;
}

function normalizedVideoPath(value: string): string {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function canPlayHlsNatively(video: HTMLVideoElement): boolean {
  return Boolean(
    video.canPlayType("application/vnd.apple.mpegurl") ||
      video.canPlayType("application/x-mpegurl")
  );
}

function assignVideoSource(video: HTMLVideoElement, src: string): void {
  destroyInlineVideoSource(video);

  if (video.src !== src) {
    video.src = src;
  }

  video.load();
  video.dataset.videoReadySrc = src;
}

async function attachHlsSource(video: HTMLVideoElement, src: string): Promise<void> {
  const { default: Hls } = await loadHlsModule();

  if (!Hls.isSupported()) {
    assignVideoSource(video, src);
    return;
  }

  destroyInlineVideoSource(video);

  const hls = new Hls({
    enableWorker: true
  });
  hlsControllers.set(video, hls);
  hls.loadSource(src);
  hls.attachMedia(video);

  await new Promise<void>((resolve) => {
    const handleReady = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      hls.off(Hls.Events.MANIFEST_PARSED, handleReady);
      hls.off(Hls.Events.ERROR, handleError);
    };

    hls.on(Hls.Events.MANIFEST_PARSED, handleReady);
    hls.on(Hls.Events.ERROR, handleError);
  });

  video.dataset.videoReadySrc = src;
}

export function looksLikeHlsStream(src: string | undefined, mimeType?: string): boolean {
  if (!src) {
    return false;
  }

  const normalizedMimeType = mimeType?.split(";")[0]?.trim().toLowerCase();

  if (normalizedMimeType && HLS_MIME_TYPES.has(normalizedMimeType)) {
    return true;
  }

  return normalizedVideoPath(src).endsWith(".m3u8");
}

export async function ensureInlineVideoSource(video: HTMLVideoElement): Promise<void> {
  const src = video.dataset.videoSrc;
  const mimeType = video.dataset.videoMimeType;

  if (!src || video.dataset.videoReadySrc === src) {
    return;
  }

  if (!looksLikeHlsStream(src, mimeType) || canPlayHlsNatively(video)) {
    assignVideoSource(video, src);
    return;
  }

  try {
    await attachHlsSource(video, src);
  } catch {
    assignVideoSource(video, src);
  }
}

export function destroyInlineVideoSource(video: HTMLVideoElement): void {
  const hls = hlsControllers.get(video);

  if (!hls) {
    return;
  }

  hls.destroy();
  hlsControllers.delete(video);
}

export function destroyInlineVideoSources(root: ParentNode): void {
  root.querySelectorAll<HTMLVideoElement>("video[data-video-src]").forEach((video) => {
    destroyInlineVideoSource(video);
  });
}

export const __test__ = {
  looksLikeHlsStream
};
