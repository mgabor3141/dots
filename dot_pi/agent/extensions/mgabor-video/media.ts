/**
 * Video support for the `read` tool.
 *
 * Pi has one media block and the endpoint wants two: Pi's adapter turns an `image` block into
 * an OpenAI `image_url` part, and vLLM/Qwen-VL answers "Failed to load image" unless the part is
 * `video_url`. So this module does exactly two things:
 *
 *   1. `read` returns video as a media block, the way it already returns images.
 *   2. the outgoing payload has those parts retyped to `video_url`.
 *
 * Everything else is Pi's own media plumbing: the bytes land in the tool result, the harness
 * attaches them to the following request, they stay in history and are re-sent each turn, and
 * compaction drops them from context once the conversation has moved past them. That is the
 * same lifecycle as an image, which means the session file carries the frames themselves rather
 * than a reference to a file that may later change or disappear.
 *
 * What is therefore NOT here: pricing probes, token budgets, markers, eviction policies, and
 * flags. If a session needs less video context, compact it or run a subagent over the clip and
 * keep only its summary.
 *
 * Server-side facts measured against this endpoint (vLLM with all multimodal defaults):
 *
 *   frames per video = min(32, source frames), then grouped in pairs by temporal_patch_size = 2,
 *                     so a clip is seen as 16 temporal groups however long it runs
 *   pixel budget     = 25165824 px for the whole clip, so frames shrink when 32 cannot fit
 *   vision tokens    = (frames / 2) * (px per frame / 1024)  ~ 11520 for 32 frames of 720p
 *
 * The frame count is request-wide and reachable from the client through
 * `media_io_kwargs.video.num_frames` (see sample.ts); the keys that do nothing are `fps`,
 * `max_frames` and friends inside `mm_processor_kwargs`. Audio is dropped because Qwen3-VL has
 * no audio channel. Cost details, since a video is re-sent on every turn until compaction:
 * 32 frames of 360 p ~3.7k tokens, of 720 p or above ~11.7k of a 262144 token window.
 */

import { open, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import {
  createReadToolDefinition,
  formatSize,
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ReadToolDetails,
} from "@earendil-works/pi-coding-agent";

/** Providers whose endpoint accepts a `video_url` part. Everywhere else, say so out loud. */
export const VIDEO_PROVIDERS = new Set(["mgabor"]);

/**
 * Ceiling for one file in `read`. The endpoint has no size limit and samples the same 32 frames
 * regardless, so this is about the transport: base64 inflates 1.37x and the proxy cancels
 * chunked bodies above 128 MiB (`max_chunked_body_bytes`), which puts the honest ceiling near
 * 90 MiB of raw file. A bigger file is not wrong, it just belongs in a window.
 */
const MAX_VIDEO_BYTES = 90 * 1024 * 1024;

/** Whole-clip pixel budget the endpoint applies before sampling (processor_config.json longest_edge). */
export const CLIP_PIXEL_BUDGET = 25_165_824;

/** Frames the endpoint samples per video unless the request asks for something else. */
export const DEFAULT_FRAMES = 32;

const VIDEO_MIME_BY_EXTENSION = new Map<string, string>([
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".mkv", "video/x-matroska"],
  [".avi", "video/x-msvideo"],
  [".mpg", "video/mpeg"],
  [".mpeg", "video/mpeg"],
  [".3gp", "video/3gpp"],
]);

/**
 * Rewrites `image_url` parts that carry video into the `video_url` shape the endpoint expects.
 * Runs before anything measures or sends the payload, and leaves every other part untouched.
 */
export function promoteVideoParts(
  payload: Record<string, unknown>,
  model: { provider?: string } | undefined,
): Record<string, unknown> | undefined {
  if (!model || typeof model.provider !== "string" || !VIDEO_PROVIDERS.has(model.provider)) return undefined;
  if (!Array.isArray(payload.messages)) return undefined;

  const messages = payload.messages as Array<Record<string, unknown>>;
  let next: Array<Record<string, unknown>> | undefined;
  messages.forEach((message, index) => {
    if (!Array.isArray(message?.content)) return;
    let touched = false;
    const content = (message.content as Array<Record<string, unknown>>).map((part) => {
      if (part?.type === "image_url" && isVideoUrl(part)) {
        touched = true;
        const { image_url: imageUrl, ...rest } = part;
        return { ...rest, type: "video_url", video_url: imageUrl };
      }
      // A media block that survived to the wire unconverted, e.g. from a different adapter.
      if (part?.type === "image" && typeof part.mimeType === "string" && part.mimeType.startsWith("video/")) {
        touched = true;
        return { type: "video_url", video_url: { url: `data:${part.mimeType};base64,${String(part.data ?? "")}` } };
      }
      return part;
    });
    if (touched) {
      next ??= messages.slice();
      next[index] = { ...message, content };
    }
  });
  return next ? { ...payload, messages: next } : undefined;
}

function isVideoUrl(part: Record<string, unknown>): boolean {
  const url = (part.image_url as { url?: unknown } | undefined)?.url;
  return typeof url === "string" && /^data:video\//i.test(url);
}

// ---------------------------------------------------------------------------
// read override
// ---------------------------------------------------------------------------

function sniffVideoMime(head: Buffer): string | undefined {
  if (head.length < 12) return undefined;
  const at = (offset: number, length: number) => head.subarray(offset, offset + length).toString("latin1");
  // ISO base media (mp4/mov/m4v): `ftyp` normally, or a bare box from a fragmented export.
  const brand = at(4, 4);
  if (brand === "ftyp" || brand === "moov" || brand === "mdat") return "video/mp4";
  // EBML: Matroska or WebM, told apart by the DocType string in the header.
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return at(0, 64).includes("webm") ? "video/webm" : "video/x-matroska";
  }
  if (at(0, 4) === "RIFF" && at(8, 4) === "AVI ") return "video/x-msvideo";
  return undefined;
}

export type Probe = { duration: number; width: number; height: number; fps: number };

/**
 * Child-process runner shared by the probe and the encoder: pi.exec with the tool call's abort
 * signal already bound and a timeout defaulted.
 */
export type Run = (command: string, args: string[], timeout?: number) => Promise<{ code: number; stdout: string; stderr: string } | undefined>;

/**
 * Reads duration, dimensions and frame rate. Cheap: a metadata-only probe measured 61 ms, which
 * is why it is worth paying to tell the model what its 32 frames will actually cover.
 */
export async function probeVideo(path: string, run: Run): Promise<Probe | undefined> {
  const result = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=width,height,r_frame_rate,duration:format=duration",
    "-of",
    "json",
    path,
  ]);
  if (!result || result.code !== 0) return undefined;
  try {
    const json = JSON.parse(result.stdout) as {
      streams?: Array<{ width?: number; height?: number; r_frame_rate?: string; duration?: string }>;
      format?: { duration?: string };
    };
    const stream = json.streams?.[0];
    const { width = 0, height = 0 } = stream ?? {};
    const [num = 0, den = 1] = (stream?.r_frame_rate ?? "0/1").split("/").map(Number);
    const duration = Number(json.format?.duration ?? stream?.duration ?? 0) || 0;
    if (!width || !height || !duration) return undefined;
    return { duration, width, height, fps: den ? num / den : 0 };
  } catch {
    return undefined;
  }
}

/** Approximates the endpoint's own cost rule, enough to make the tradeoff visible to the model. */
export function estimateTokens(frames: number, width: number, height: number): number {
  const perFrame = Math.min(width * height, Math.floor(CLIP_PIXEL_BUDGET / Math.max(frames, 1)));
  return Math.round((frames / 2) * (perFrame / 1024));
}

/** Sniff the container first so a mislabeled or streamed file still works; extension as tie-breaker. */
export async function detectVideoMime(path: string): Promise<string | undefined> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buffer, 0, 64, 0);
    return sniffVideoMime(buffer.subarray(0, bytesRead)) ?? VIDEO_MIME_BY_EXTENSION.get(extname(path).toLowerCase());
  } finally {
    await handle.close();
  }
}

const REFUSAL_HINT = (path: string) =>
  `Cut a window with video_sample, or extract frames and read those as images:\n  ffmpeg -ss 0 -t 20 -i ${JSON.stringify(path)} -map 0:v:0 -an -vf scale=960:-2 -r 2 /tmp/frames_%02d.jpg`;

/** Returns undefined for anything that is not a video, so the built-in read answers it. */
async function readVideo(
  rawPath: string,
  ctx: ExtensionContext,
  run: Run,
): Promise<AgentToolResult<ReadToolDetails | undefined> | undefined> {
  const expanded = rawPath.startsWith("~/") ? resolve(homedir(), rawPath.slice(2)) : rawPath;
  const path = resolve(ctx.cwd ?? process.cwd(), expanded);

  let mime: string | undefined;
  try {
    mime = await detectVideoMime(path);
  } catch {
    return undefined; // unreadable: the built-in read produces the normal error for this path
  }
  if (!mime) return undefined;

  const size = (await stat(path)).size;
  const described = `${mime}, ${formatSize(size)}`;

  // Without this override, read would decode an mp4 as UTF-8 text and hand the model
  // megabytes of replacement characters, so a clear refusal earns its keep even when video
  // works fine on the model this session is pointed at.
  const refuse = (reason: string, action = REFUSAL_HINT(path)): AgentToolResult<ReadToolDetails | undefined> => ({
    content: [{ type: "text", text: `Read video file ${path}\n[${described}: ${reason}]\n${action}` }],
    details: undefined,
    isError: true,
  });

  if (size === 0) return refuse("the file is empty, so there is nothing to decode", "");
  if (size > MAX_VIDEO_BYTES) {
    return refuse(`larger than the ${formatSize(MAX_VIDEO_BYTES)} limit for one file, and it would be re-sent on every later request`);
  }
  if (!ctx.model || typeof ctx.model.provider !== "string" || !VIDEO_PROVIDERS.has(ctx.model.provider)) {
    return refuse("the current model cannot decode video", `Switch to a video-capable model, or:\n${REFUSAL_HINT(path)}`);
  }

  // Worth the 60 ms: without the duration the model cannot know that what it is about to see
  // covers the file at one frame every N seconds, which is the fact that decides whether to
  // read a window instead.
  const meta = await probeVideo(path, run).catch(() => undefined);
  const facts = meta
    ? (() => {
        const per = meta.duration / DEFAULT_FRAMES;
        return (
          `${meta.duration.toFixed(1)}s, ${meta.width}x${meta.height}. ` +
          `The endpoint samples ${DEFAULT_FRAMES} frames per video, so this whole file arrives as one frame every ` +
          `${per.toFixed(1)}s and costs ~${estimateTokens(DEFAULT_FRAMES, meta.width, meta.height)} tokens. `
        );
      })()
    : "";

  const base64 = (await readFile(path)).toString("base64");
  return {
    details: undefined,
    content: [
      {
        type: "text",
        text:
          `Read video file [${mime}] ${path}\n` +
          `${formatSize(size)}. ${facts}` +
          "Audio is dropped; this model has no audio channel. For a moment that needs finer timing, " +
          "video_sample a window of it. The frames stay in context until compaction; read the file again if they have been.",
      },
      { type: "image", data: base64, mimeType: mime },
    ],
  };
}

export function registerVideoRead(pi: ExtensionAPI): void {
  let reference: ReturnType<typeof createReadToolDefinition>;
  try {
    reference = createReadToolDefinition(process.cwd());
  } catch {
    return; // factory renamed upstream: keep the built-in read tool rather than break it
  }

  // execute() resolves relative paths against the closed-over cwd, so keep one per cwd.
  const byCwd = new Map<string, ReturnType<typeof createReadToolDefinition>>();
  const definitionFor = (cwd: string) => {
    let definition = byCwd.get(cwd);
    if (!definition) {
      definition = createReadToolDefinition(cwd);
      byCwd.set(cwd, definition);
    }
    return definition;
  };

  pi.registerTool({
    name: "read", // overrides the built-in read tool
    label: reference.label,
    description:
      `${reference.description}\n Also reads video files (mp4, m4v, mov, webm, mkv, avi, mpeg, 3gp) when the active model decodes ` +
      "video: the server samples up to 32 frames from anywhere in the file and attaches them like an image, so a long clip is " +
      "seen sparsely and video_sample a window of it for detail. offset and limit do not apply to video.",
    // Not inherited on override; copy so the system prompt keeps Pi's read guidance.
    promptSnippet: reference.promptSnippet,
    promptGuidelines: [
      ...(reference.promptGuidelines ?? []),
      "Read video files directly only on a video-capable model; elsewhere extract frames with ffmpeg and read those as images.",
      "A whole video is 32 frames spread over its duration: use video_sample on the window that holds the moment instead of reading a long file.",
    ],
    parameters: reference.parameters, // unchanged schema: video takes a path like any other file
    constrainedSampling: reference.constrainedSampling,
    renderShell: reference.renderShell,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const path = (params as { path?: unknown }).path;
      if (typeof path === "string" && path.trim()) {
        const run: Run = (command, args) => pi.exec(command, args, { timeout: 20_000 }).catch(() => undefined);
        const video = await readVideo(path, ctx, run).catch(() => undefined);
        // A misdetected container must not lose the read; anything thrown here means "not
        // actually a video", which is exactly what the built-in tool is for.
        if (video) return video;
      }
      return definitionFor(ctx.cwd ?? process.cwd()).execute(toolCallId, params, signal, onUpdate, ctx);
    },

    // Delegate rendering so the override is indistinguishable from the built-in tool. Note that
    // the interactive UI renders media blocks straight from the tool result, not through these
    // methods, so a terminal that speaks kitty or iTerm2 graphics will be handed the video block
    // the same way it is handed an image. `terminal.images: false` in settings.json opts out.
    renderCall(args, theme, context) {
      return reference.renderCall!(args, theme, context);
    },
    renderResult(result, options, theme, context) {
      return reference.renderResult!(result as AgentToolResult<ReadToolDetails | undefined>, options, theme, context);
    },
  });
}
