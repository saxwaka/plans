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
