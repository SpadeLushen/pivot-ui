import { EventEmitter } from "node:events";
import { Client, Pool, EnvHttpProxyAgent, fetch as httpFetch } from "undici";
import type { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

// Pi's CLI installs a process-wide dispatcher. Pivot hosts Next.js in the same
// process, so attach the dispatcher only to this session's model requests.
export function bindModelHttpTransport(runtime: ModelRuntime, settings: SettingsManager) {
  let pool: EnvHttpProxyAgent | undefined;
  let timeout = -1;
  const retire = () => { void pool?.close().catch(error => console.warn("Model HTTP pool close failed", error)); };
  const modelFetch: typeof fetch = (input, init) => {
    const ms = settings.getHttpIdleTimeoutMs();
    if (!pool || timeout !== ms) {
      retire();
      timeout = ms;
      // A mid-stream disconnect already rejects the reader. As in Pi's CLI,
      // consume the additional undici Client error event instead of crashing Node.
      const guarded = <T extends Client | Pool>(dispatcher: T) => {
        EventEmitter.prototype.on.call(dispatcher, "error", () => {});
        return dispatcher;
      };
      const client = (origin: URL | string, opts: object) => guarded(new Client(origin, opts));
      pool = new EnvHttpProxyAgent({ headersTimeout: ms, bodyTimeout: ms, allowH2: false,
        proxyTunnel: true, connect: { autoSelectFamilyAttemptTimeout: 2000 }, clientFactory: client,
        factory: (origin, opts) => "connections" in opts && opts.connections === 1 ? client(origin, opts)
          : guarded(new Pool(origin, { ...opts, factory: client })),
      });
    }
    return (httpFetch as unknown as typeof fetch)(input, { ...init, dispatcher: pool } as RequestInit);
  };
  const stream = runtime.streamSimple;
  runtime.streamSimple = (model, context, options) => stream.call(runtime, model, context, {
    ...options, fetch: options?.fetch ?? modelFetch,
  });
  return () => { runtime.streamSimple = stream; retire(); };
}
