import { extractUsage, mergeUsage, type NormalizedUsage } from "./usage";

export interface StreamResult {
  usage: NormalizedUsage;
  /** Model the upstream says it actually served; a mismatch is worth flagging. */
  actualModel?: string;
  ttfbMs?: number;
  latencyMs: number;
}

export interface InstrumentOptions {
  /**
   * Given the usage accumulated so far, returns fields to merge into the usage
   * object of the frame that carries it — how the gateway adds a normalised
   * `cost` for callers. Return null to leave the frame untouched.
   */
  augmentUsage?: (usage: NormalizedUsage) => Record<string, unknown> | null;
}

/**
 * Forwards an SSE body while reading it for usage and the served model.
 *
 * Frames are re-emitted line by line rather than chunk by chunk. Every line
 * goes out byte-identical except one: the frame carrying `usage`, which may be
 * rewritten to include a cost the caller can rely on. The upstreams never put
 * usage anywhere but the tail (OpenAI: the frame before [DONE]; Anthropic: the
 * message_delta event), so buffering to line boundaries costs nothing visible.
 *
 * onFinish fires at most once and never inside transform(), keeping logging
 * off the hot path. Pass the request signal so an abandoned stream is still
 * recorded — flush() never runs on one.
 */
export function instrumentSse(
  upstream: ReadableStream<Uint8Array>,
  startedAt: number,
  onFinish: (result: StreamResult) => void,
  abortSignal?: AbortSignal,
  options: InstrumentOptions = {},
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let usage: NormalizedUsage = {};
  let actualModel: string | undefined;
  let ttfbMs: number | undefined;
  let settled = false;

  const finish = () => {
    if (settled) return;
    settled = true;
    onFinish({ usage, actualModel, ttfbMs, latencyMs: Date.now() - startedAt });
  };

  const emitLine = (line: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!line.startsWith("data:")) {
      controller.enqueue(encoder.encode(line + "\n"));
      return;
    }
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      controller.enqueue(encoder.encode(line + "\n"));
      return;
    }

    // Most frames carry neither field; skip the parse unless one might be present.
    const interesting = payload.includes('"usage"') || (!actualModel && payload.includes('"model"'));
    if (!interesting) {
      controller.enqueue(encoder.encode(line + "\n"));
      return;
    }

    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(payload);
    } catch {
      // A partial frame mid-stream is normal; forward it as-is.
      controller.enqueue(encoder.encode(line + "\n"));
      return;
    }

    if (typeof frame.model === "string") actualModel ??= frame.model;
    // Anthropic nests the served model under message_start.message.
    const message = frame.message as Record<string, unknown> | undefined;
    if (typeof message?.model === "string") actualModel ??= message.model;

    const seen = extractUsage(frame.usage ? frame : message ? { usage: message.usage } : {});
    const hasUsage = seen.tokensIn !== undefined || seen.tokensOut !== undefined || seen.upstreamCost !== undefined;
    if (!hasUsage) {
      controller.enqueue(encoder.encode(line + "\n"));
      return;
    }

    usage = mergeUsage(usage, seen);
    const extra = options.augmentUsage?.(usage);
    if (extra && frame.usage && typeof frame.usage === "object") {
      frame.usage = { ...(frame.usage as Record<string, unknown>), ...extra };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n`));
    } else {
      controller.enqueue(encoder.encode(line + "\n"));
    }
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      ttfbMs ??= Date.now() - startedAt;
      pending += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        emitLine(line.replace(/\r$/, ""), controller);
      }
    },
    flush(controller) {
      if (pending) controller.enqueue(encoder.encode(pending));
      finish();
    },
  });

  abortSignal?.addEventListener("abort", finish, { once: true });
  return upstream.pipeThrough(transform);
}

export interface HeldStream {
  body: ReadableStream<Uint8Array>;
  ttfbMs: number;
}

/**
 * Reads far enough into an upstream stream to know it is really working, while
 * keeping the option to abandon it. Once a byte reaches the client the request
 * is committed; anything that fails before the first chunk — dead connection,
 * in-band error frame, empty body, TTFB stall — can still fall back.
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

  const opening = new TextDecoder().decode(first);
  if (opening.includes('"error"') && !opening.includes('"choices"') && !opening.includes('"type":"message_start"')) {
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
