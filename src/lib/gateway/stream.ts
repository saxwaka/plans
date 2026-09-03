import type { UpstreamUsage } from "./types";

export interface StreamResult {
  usage?: UpstreamUsage;
  /** Model the upstream says it actually served; a mismatch is worth flagging. */
  actualModel?: string;
  ttfbMs?: number;
  latencyMs: number;
}

/**
 * Passes an SSE body through byte-for-byte while sniffing it for the usage frame.
 *
 * Verified against CKey: usage arrives on its own, without the client asking for
 * stream_options.include_usage, in the frame just before [DONE]:
 *   data: {"choices":[],"usage":{...,"x_ckey":{"cost":23.4,...}}}
 * That frame carries an empty choices array, so it must be forwarded untouched —
 * dropping it would be both wrong and pointless.
 *
 * onFinish fires at most once, and never from inside transform(), so logging
 * stays off the hot path. Pass the request signal so a client that hangs up
 * mid-stream is still recorded — flush() never runs on an abandoned stream.
 */
export function instrumentSse(
  upstream: ReadableStream<Uint8Array>,
  startedAt: number,
  onFinish: (result: StreamResult) => void,
  abortSignal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let pending = "";
  let usage: UpstreamUsage | undefined;
  let actualModel: string | undefined;
  let ttfbMs: number | undefined;
  let settled = false;

  const finish = () => {
    if (settled) return;
    settled = true;
    onFinish({ usage, actualModel, ttfbMs, latencyMs: Date.now() - startedAt });
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      ttfbMs ??= Date.now() - startedAt;
      controller.enqueue(chunk);

      pending += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        // Most frames carry neither, so skip the parse unless one is present.
        if (!payload.includes('"usage"') && actualModel) continue;
        try {
          const frame = JSON.parse(payload) as { usage?: UpstreamUsage; model?: string };
          if (frame.usage) usage = frame.usage;
          actualModel ??= frame.model;
        } catch {
          // A partial frame is normal mid-stream; the next chunk completes it.
        }
      }
    },
    flush: finish,
  });

  abortSignal?.addEventListener("abort", finish, { once: true });

  return upstream.pipeThrough(transform);
}

export interface HeldStream {
  /** Rebuilds the full body: the chunk already read, then everything after it. */
  body: ReadableStream<Uint8Array>;
  ttfbMs: number;
}

/**
 * Reads far enough into an upstream stream to know it is really working, while
 * keeping the option to abandon it.
 *
 * Once a byte reaches the client the request is committed — there is no way to
 * take it back and try another seller. So the first chunk is held here instead:
 * anything that goes wrong before it (a dead connection, an error frame, a
 * stream that ends with no data, a stall past the TTFB deadline) is still
 * recoverable and the caller can fall back. Anything after it is not.
 *
 * Costs a little time-to-first-token. Worth it, because relay failures cluster
 * at the handshake.
 */
export async function holdFirstChunk(
  upstream: ReadableStream<Uint8Array>,
  startedAt: number,
  ttfbTimeoutMs: number,
): Promise<HeldStream> {
  const reader = upstream.getReader();

  let first: Uint8Array;
  try {
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("ttfb_timeout")), ttfbTimeoutMs).unref?.(),
    );
    const { value, done } = await Promise.race([reader.read(), timer]);
    if (done || !value) throw new Error("empty_stream");
    first = value;
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  }

  // A 200 that opens with an error payload is still a failure — some upstreams
  // report a dead seller in-band rather than through the status code.
  const opening = new TextDecoder().decode(first);
  if (opening.includes('"error"') && !opening.includes('"choices"')) {
    reader.cancel().catch(() => {});
    throw new Error(`upstream_error_frame: ${opening.slice(0, 200)}`);
  }

  const ttfbMs = Date.now() - startedAt;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first);
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });

  return { body, ttfbMs };
}
