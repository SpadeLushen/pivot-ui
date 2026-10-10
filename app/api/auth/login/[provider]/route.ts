import { createHash, randomUUID } from "node:crypto";
import { CredentialSynchronizationError, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getOAuthProviders } from "@/lib/model-runtime";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getAuthStore } from "@/lib/auth-store";
import { beginProviderLogin, providerLoginDeviceId, providerLoginError } from "@/lib/provider-login";
import { notifyMcpConfigurationChanged } from "@/lib/session-resource-events";

export const dynamic = "force-dynamic";
function authUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid authorization URL");
  return url.href;
}

// Ephemeral registry: each provider-bound prompt owns a one-use token.
declare global {
  var __piLoginCallbacks: Map<string, { provider: string; allowedValues?: ReadonlySet<string>; resolve: (v: string) => void; reject: (e: Error) => void }> | undefined;
}

function getCallbackRegistry() {
  if (!globalThis.__piLoginCallbacks) globalThis.__piLoginCallbacks = new Map();
  return globalThis.__piLoginCallbacks;
}

// POST /api/auth/login/[provider] — frontend sends redirect URL or auth code
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const body = await req.json().catch(() => null) as { token?: unknown; code?: unknown } | null;
  const token = body?.token, code = body?.code;
  if (typeof token !== "string" || typeof code !== "string" || !token || !code || code.length > 16384) {
    return Response.json({ error: "token and code required" }, { status: 400 });
  }

  const registry = getCallbackRegistry();
  const callbacks = registry.get(token);
  if (!callbacks) {
    return Response.json({ error: "No pending login for token" }, { status: 404 });
  }
  if (callbacks.provider !== provider) {
    return Response.json({ error: "Token does not match provider" }, { status: 400 });
  }

  if (callbacks.allowedValues && !callbacks.allowedValues.has(code)) {
    return Response.json({ error: "Invalid login selection" }, { status: 400 });
  }

  callbacks.resolve(code);
  registry.delete(token);
  return Response.json({ ok: true, provider });
}

// GET /api/auth/login/[provider] — SSE stream for OAuth flow
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  const encoder = new TextEncoder();
  let cancelled = false, ended = false;
  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    if (!cancelled && !ended && !abort.signal.aborted) {
      try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
      catch { abort.abort(); }
    }
  };
  const close = (controller: ReadableStreamDefaultController) => {
    if (!cancelled && !ended) { ended = true; try { controller.close(); } catch { /* Disconnected. */ } }
  };

  // AbortController propagates client disconnect into ModelRuntime.login()
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  if (req.signal.aborted) abort.abort();
  else req.signal.addEventListener("abort", onAbort, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const release = beginProviderLogin(provider, abort);
      if (!release) { send(controller, { type: "error", message: "auth.loginBusy" }); close(controller); req.signal.removeEventListener("abort", onAbort); return; }
      let expired = false;
      const timeout = setTimeout(() => { expired = true; send(controller, { type: "error", message: "auth.loginExpired" }); abort.abort(); }, 5 * 60_000);
      timeout.unref();
      const heartbeat = setInterval(() => send(controller, { type: "keepalive" }), 15_000);
      heartbeat.unref();
      const registry = getCallbackRegistry();
      const activeTokens = new Set<string>();
      let pendingManualRequest: { token: string; promise: Promise<string> } | undefined;

      const createClientInputRequest = (allowedValues?: ReadonlySet<string>) => {
        abort.signal.throwIfAborted();
        const token = `${provider}-${randomUUID()}`;
        activeTokens.add(token);

        const promise = new Promise<string>((resolve, reject) => {
          registry.set(token, {
            provider,
            allowedValues,
            resolve: (value) => {
              activeTokens.delete(token);
              registry.delete(token);
              resolve(value);
            },
            reject: (error) => {
              activeTokens.delete(token);
              registry.delete(token);
              reject(error);
            },
          });
        });

        return { token, promise };
      };

      const getManualInputRequest = () => {
        if (!pendingManualRequest) {
          pendingManualRequest = createClientInputRequest();
          pendingManualRequest.promise
            .finally(() => {
              pendingManualRequest = undefined;
            })
            .catch(() => {});
        }
        return pendingManualRequest;
      };

      const bindPromptSignal = (request: { token: string; promise: Promise<string> }, signal?: AbortSignal) => {
        const cancel = () => registry.get(request.token)?.reject(new Error("Login cancelled"));
        if (signal?.aborted) cancel();
        else signal?.addEventListener("abort", cancel, { once: true });
        void request.promise.finally(() => signal?.removeEventListener("abort", cancel)).catch(() => {});
      };

      // Cleanup: remove pending token and abort any waiting promise
      const cleanup = () => {
        for (const token of activeTokens) {
          registry.get(token)?.reject(new Error("Login cancelled"));
          registry.delete(token);
        }
        activeTokens.clear();
      };

      // Also cancel on client disconnect
      abort.signal.addEventListener("abort", cleanup);

      try {
        abort.signal.throwIfAborted();
        const store = getAuthStore(), previous = await store.read(provider);
        if (previous?.type === "api_key" && new URL(req.url).searchParams.get("replace") !== "api_key") throw new Error("auth.replaceApiKey");
        const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
        const expected = fingerprint(previous);
        const runtime = await ModelRuntime.create({ signal: abort.signal, credentials: {
          read: store.read.bind(store), list: store.list.bind(store), delete: store.delete.bind(store),
          modify: (id, update, options) => store.modify(id, async current => {
            abort.signal.throwIfAborted();
            if (id === provider && fingerprint(current) !== expected) throw new Error("auth.credentialsChanged");
            return update(current);
          }, options),
        } });
        if (!getOAuthProviders(runtime).some(p => p.id === provider)) throw new Error("Unknown OAuth provider");
        const deviceId = await providerLoginDeviceId();
        abort.signal.throwIfAborted();
        await runtime.login(provider, "oauth", {
          signal: abort.signal,
          notify: (event) => {
            switch (event.type) {
              case "auth_url": {
                const request = getManualInputRequest();
                send(controller, {
                  type: "auth",
                  url: authUrl(event.url),
                  instructions: event.instructions ?? null,
                  token: request.token,
                });
                break;
              }
              case "device_code":
                send(controller, {
                  type: "device_code",
                  userCode: event.userCode,
                  verificationUri: authUrl(event.verificationUri),
                  intervalSeconds: event.intervalSeconds ?? null,
                  expiresInSeconds: event.expiresInSeconds ?? null,
                });
                break;
              case "progress":
                send(controller, { type: "progress", message: event.message });
                break;
              case "info":
                send(controller, { type: "info", message: event.message,
                  links: event.links?.map(link => ({ ...link, url: authUrl(link.url) })) });
                break;
            }
          },
          prompt: async (prompt) => {
            if (prompt.type === "select") {
              // Fresh token per select: a flow may emit auth_url then a select
              // prompt, and each prompt must resolve its own submission.
              const request = createClientInputRequest(new Set(prompt.options.map((option) => option.id)));
              bindPromptSignal(request, prompt.signal);
              send(controller, {
                type: "select_request",
                message: prompt.message,
                options: prompt.options.map((o) => ({ id: o.id, label: o.label })),
                token: request.token,
              });
              return request.promise;
            }
            const request = getManualInputRequest();
            bindPromptSignal(request, prompt.signal);
            send(controller, {
              type: "prompt_request",
              inputType: prompt.type,
              message: prompt.message,
              placeholder: prompt.placeholder ?? null,
              token: request.token,
            });
            return request.promise;
          },
        }, { getDeviceId: () => deviceId });

        // Refresh only the provider just authorized (e.g. Radius account catalogs).
        // Catalog failure must not misreport an already saved login as failed.
        try {
          const refreshed = await runtime.refresh({ providers: [provider], allowNetwork: true,
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]) });
          if (refreshed.errors.size || refreshed.aborted) send(controller, { type: "info", message: "auth.savedReloadFailed" });
        } catch { send(controller, { type: "info", message: "auth.savedReloadFailed" }); }
        invalidateModelsCache();
        notifyMcpConfigurationChanged();
        send(controller, { type: "success" });
      } catch (err) {
        if (err instanceof CredentialSynchronizationError && err.operation === "login") {
          invalidateModelsCache(); notifyMcpConfigurationChanged();
          send(controller, { type: "info", message: "auth.savedReloadFailed" });
          send(controller, { type: "success" });
        } else if (!expired && !abort.signal.aborted) {
          send(controller, { type: "error", message: providerLoginError(err) });
        }
      } finally {
        cleanup(); clearTimeout(timeout); clearInterval(heartbeat);
        abort.signal.removeEventListener("abort", cleanup);
        req.signal.removeEventListener("abort", onAbort);
        release(); close(controller);
      }
    },
    cancel() {
      cancelled = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
