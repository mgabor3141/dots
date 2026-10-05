/**
 * `video_sample`: cut a window out of a video and attach the frames.
 *
 * Why this exists rather than just reading the file: the endpoint samples a fixed number of
 * frames per video, so the length of the clip does not buy any detail. A 300 s clip and a 10 s
 * clip both arrive as the same 32 frames (16 temporal groups), which means the long clip is
 * understood at one frame every 9 seconds while the short one is understood at one per third of
 * a second, for the same tokens. Cutting the window is the only way to spend that fixed budget
 * densely, and it also shrinks the upload, which is re-sent on every later turn.
 *
 * Server facts measured against this endpoint (vLLM with every multimodal default, no launch
 * flags), and confirmed by /tokenize probes from the client side:
 *
 *   frames per video = min(32, source frames)   (VideoMediaIO.num_frames default)
 *   clip pixel budget = 25165824 px total       (processor_config.json longest_edge), applied to
 *                     the whole clip, so frames are downscaled when 32 cannot fit at full size
 *   vision tokens    = (frames / 2) * (px per frame / 1024)
 *
 * 32 frames of 720p costs 11520 tokens, and 32 frames of anything above 720p costs the same
 * because it is scaled to the same grid first: 10 s at 720p, 1080p and 1440p each priced 11698.
 *
 * Frame count is reachable per request via `media_io_kwargs.video.num_frames`, which the proxy
 * passes through unchanged (verified: 8/16/64 frames priced 974/1888/7376 on a clip whose default
 * was 3718). It is a request-wide field rather than a per-part one, so one value applies to every
 * video in the request, which is what the tool says out loud rather than hides.
 */

import { createHash, randomBytes } from "node:crypto";
import { access, readFile, stat, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, resolve } from "node:path";
import { Type } from "typebox";
import { formatSize, type AgentToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_FRAMES, VIDEO_PROVIDERS, detectVideoMime, estimateTokens, probeVideo, type Probe, type Run } from "./media.ts";

/** A stream copy this far off the requested window is keyframe-starved; re-encode instead. */
const COPY_TOLERANCE = 0.6;
/** Containers that can be handed over untouched, without a remux. */
const PASSTHROUGH_EXTENSIONS = new Set([".mp4", ".m4v"]);

const sampleSchema = Type.Object({
  path: Type.String({ description: "Video file to sample (relative or absolute)" }),
  from: Type.Optional(Type.Number({ description: "Window start in seconds (default 0)" })),
  to: Type.Optional(Type.Number({ description: "Window end in seconds (default: end of file)" })),
  num_frames: Type.Optional(
    Type.Number({
      description:
        `Frames for the server to sample, default ${DEFAULT_FRAMES}. Tokens scale linearly with it. This is a request-wide ` +
        "setting: it applies to every video in the request, so do not raise it when reading two clips at once.",
      minimum: 2,
      maximum: 256,
    }),
  ),
  height: Type.Optional(
    Type.Number({
      description:
        "Re-encode and scale to this pixel height (never upscales). Saves upload bytes only: the server downsamples every " +
        "clip to roughly 720p equivalence regardless, so anything above 720 costs identical tokens.",
      minimum: 96,
      maximum: 4320,
    }),
  ),
});

type SampleParams = { path: string; from?: number; to?: number; num_frames?: number; height?: number };

/** sha256 of the data URL → the frame count to request for it, applied again on every later turn. */
const samplingHints = new Map<string, number>();

/**
 * Puts `media_io_kwargs.video.num_frames` on a request carrying a sampled video so the requested
 * density survives into the provider call. Last sampled video wins: the field is request-wide and
 * the newest call is the one whose intent is current.
 */
export function applyVideoSamplingHints(
  payload: Record<string, unknown>,
  model: { provider?: string } | undefined,
): Record<string, unknown> | undefined {
  if (!model || typeof model.provider !== "string" || !VIDEO_PROVIDERS.has(model.provider)) return undefined;
  if (!Array.isArray(payload.messages)) return undefined;

  let frames: number | undefined;
  for (const message of payload.messages as Array<Record<string, unknown>>) {
    if (!Array.isArray(message?.content)) continue;
    for (const part of message.content as Array<Record<string, unknown>>) {
      const holder = part?.type === "video_url" ? part.video_url : part?.type === "image_url" ? part.image_url : undefined;
      const url = (holder as { url?: unknown } | undefined)?.url;
      if (typeof url !== "string" || !url.startsWith("data:video/")) continue;
      const hint = samplingHints.get(createHash("sha256").update(url).digest("hex"));
      if (hint) frames = hint;
    }
  }
  if (!frames) return undefined;
  return { ...payload, media_io_kwargs: { video: { num_frames: frames } } };
}

type Cut = { file: string; bytes: number; method: string; temp: boolean; warning?: string } | { error: string };

/**
 * Cuts [from, to]. A stream copy needs no decode and finishes in well under a second on
 * gigabyte inputs, but can only start on a keyframe, so a copy that comes out wildly short of
 * the window falls back to a real re-encode. Audio is dropped throughout: this model has none.
 */
async function cutWindow(
  path: string,
  from: number,
  to: number,
  source: Probe,
  scaleTo: number | undefined,
  run: Run,
): Promise<Cut> {
  const out = resolve(tmpdir(), `pi-video-${process.pid}-${randomBytes(4).toString("hex")}.mp4`);
  const seek = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", from.toFixed(3), "-to", to.toFixed(3)];
  const input = ["-i", path, "-map", "0:v:0", "-an"];
  const wanted = to - from;
  const exec = (args: string[], timeout: number) => run("ffmpeg", [...args, out], timeout);
  const encode = (scale: string | undefined, timeout: number) =>
    exec(
      [
        ...seek,
        ...input,
        ...(scale ? ["-vf", scale] : []),
        "-preset",
        "fast",
        "-crf",
        "28",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
      ],
      timeout,
    );
  const lastLines = (text: string | undefined) => (text ?? "").trim().split("\n").filter(Boolean).slice(-2).join(" ");

  const scale = scaleTo && scaleTo < source.height ? `scale=-2:${Math.round(scaleTo)}` : undefined;
  const discard = () => unlink(out).catch(() => {});
  let method = "stream copy";
  let warning = scaleTo && !scale ? "requested height is not below the source height, so nothing was scaled" : undefined;
  let probed: Probe | undefined;

  if (scale) {
    // Scaling is a decode, so a stream copy cannot do it: encode the window once instead.
    const encoded = await exec(
      [...seek, ...input, "-vf", scale, "-preset", "fast", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
      600_000,
    );
    probed = encoded?.code === 0 ? await probeVideo(out, run) : undefined;
    if (!probed) {
      await discard();
      return { error: lastLines(encoded?.stderr) || "ffmpeg could not scale this window" };
    }
    method = "re-encode, scaled";
  } else {
    const copy = await exec([...seek, ...input, "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart"], 120_000);
    probed = copy?.code === 0 ? await probeVideo(out, run) : undefined;
    const aligned = probed && probed.duration >= wanted * COPY_TOLERANCE && probed.duration <= wanted * (2 - COPY_TOLERANCE);
    if (!aligned) {
      // Keyframes are too sparse to start the window where it was asked for; decode and re-encode.
      await discard();
      warning = "keyframe spacing forced a re-encode";
      const encoded = await encode(undefined, 600_000);
      probed = encoded?.code === 0 ? await probeVideo(out, run) : undefined;
      if (!probed) {
        await discard();
        return { error: lastLines(encoded?.stderr || copy?.stderr) || "ffmpeg produced no usable output for this window" };
      }
      method = "re-encode";
    }
  }

  const bytes = (await stat(out)).size;
  return { file: out, bytes, method, temp: true, warning };
}

export function registerVideoSample(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "video_sample",
    label: "video sample",
    description:
      "Sample a window of a video file and attach its frames, for when reading the whole clip is too coarse or too large. " +
      `The endpoint samples at most ${DEFAULT_FRAMES} frames per video no matter how long it is, so a five minute clip is ` +
      "understood at one frame every 9 seconds while a 30 second window of the same clip is understood at one frame per second " +
      "for the same tokens. Cut the window around the moment you care about instead of reading a long file whole. Windows are " +
      "cut by stream copy where possible (fast, lossless, starts on the nearest keyframe) and re-encoded otherwise. Audio is " +
      "dropped: this model has no audio channel. The frames attach like an image and stay in context until compaction.",
    promptSnippet: "video_sample(path, from, to, num_frames, height) cuts a window from a video and attaches its frames",
    promptGuidelines: [
      "For a long clip, video_sample the window that contains the moment rather than reading the whole file: every video gets 32 frames, so a shorter window is that much finer for the same cost.",
      "Raise num_frames only when one video is in the request; it is request-wide and costs tokens linearly.",
    ],
    parameters: sampleSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const { path: rawPath, num_frames, height } = params as SampleParams;
      // homedir(), not process.env.HOME: Windows sets USERPROFILE and usually leaves HOME unset.
      // media.ts already expands "~/" this way for the read override.
      const path = resolve(ctx.cwd ?? process.cwd(), rawPath.startsWith("~/") ? resolve(homedir(), rawPath.slice(2)) : rawPath);
      const fail = (text: string): AgentToolResult<undefined> => ({ content: [{ type: "text", text }], details: undefined, isError: true });
      const run: Run = (command, args, timeout = 20_000) => pi.exec(command, args, { signal, timeout }).catch(() => undefined);

      const provider = ctx.model?.provider;
      if (typeof provider !== "string" || !VIDEO_PROVIDERS.has(provider)) {
        return fail(`video_sample: the current model (${provider ?? "unknown"}) cannot decode video. Switch to a video-capable model.`);
      }
      if (!(await access(path).then(() => true).catch(() => false))) return fail(`video_sample: no such file: ${path}`);

      const source = await probeVideo(path, run);
      if (!source) {
        return fail(
          `video_sample: ffprobe could not read ${path}. If it is missing from PATH, a static build belongs at /mnt/user/appdata/bin/ffprobe, symlinked into ~/.local/bin.`,
        );
      }

      const from = Math.max(0, Math.min(params.from ?? 0, source.duration));
      const to = Math.min(params.to ?? source.duration, source.duration);
      if (to - from < 0.2) return fail(`video_sample: the window ${from.toFixed(1)}s to ${to.toFixed(1)}s holds nothing (${source.duration.toFixed(1)}s file).`);

      // Hand the file over untouched only when the whole thing is wanted and it needs no remux.
      const untouched = from <= 0 && to >= source.duration - 0.05 && !height && PASSTHROUGH_EXTENSIONS.has(extname(path).toLowerCase());
      let file = path;
      let bytes = (await stat(path)).size;
      let method = "original file";
      let warning: string | undefined;
      let temp = false;

      if (!untouched) {
        const cut = await cutWindow(path, from, to, source, height, run);
        if ("error" in cut) return fail(`video_sample: ${cut.error}`);
        ({ file, bytes, method, warning } = cut);
        temp = cut.temp;
      }

      // The mime is settled while the file still exists, and the same string goes into the media
      // block, the hint key, and so the data URL that pi-ai builds for the wire.
      const mime = (untouched ? await detectVideoMime(path) : undefined) ?? "video/mp4";
      const base64 = (await readFile(file)).toString("base64");
      if (temp) await unlink(file).catch(() => {});

      const targetHeight = height && height < source.height ? Math.round(height) : 0;
      const width = targetHeight ? Math.round((source.width * targetHeight) / source.height) : source.width;
      const frameHeight = targetHeight || source.height;
      const span = to - from;
      const frames = Math.min(num_frames ?? DEFAULT_FRAMES, Math.max(2, Math.floor(span * (source.fps || 25))));
      if (num_frames) samplingHints.set(createHash("sha256").update(`data:${mime};base64,${base64}`).digest("hex"), num_frames);

      const summary =
        `${from.toFixed(1)}s-${to.toFixed(1)}s of ${source.duration.toFixed(1)}s at ${width}x${frameHeight}, ` +
        `${formatSize(bytes)}, ${method}${targetHeight ? `, scaled from ${source.width}x${source.height}` : ""}` +
        `${warning ? ` (${warning})` : ""}. Audio dropped. ` +
        `${frames} frames = one every ${(span / frames).toFixed(2)}s, ~${estimateTokens(frames, width, frameHeight)} tokens.`;

      return {
        details: undefined,
        content: [
          { type: "text", text: `Video sample ${extname(path) || ".mp4"} ${path}\n${summary}` },
          { type: "image", data: base64, mimeType: mime },
        ],
      };
    },
  });
}
