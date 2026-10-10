import { randomUUID } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getOAuthProviders } from "@/lib/model-runtime";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

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
  const { token, code } = (await req.json()) as { token?: string; code?: string };

  if (typeof token !== "string" || typeof code !== "string" || !token || !code) {
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
  let cancelled = false;
  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    if (!cancelled && !abort.signal.aborted) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    }
  };
  const close = (controller: ReadableStreamDefaultController) => {
    if (!cancelled) controller.close();
  };

  // AbortController propagates client disconnect into ModelRuntime.login()
  const abort = new AbortController();
  if (req.signal.aborted) abort.abort();
  else req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const runtime = await ModelRuntime.create();
      if (abort.signal.aborted) {
        close(controller);
        return;
      }
      const providers = getOAuthProviders(runtime);
      const providerInfo = providers.find((p) => p.id === provider);
      if (!providerInfo) {
        send(controller, { type: "error", message: `Unknown provider: ${provider}` });
        close(controller);
        return;
      }

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
        await runtime.login(provider, "oauth", {
          signal: abort.signal,
          notify: (event) => {
            switch (event.type) {
              case "auth_url": {
                const request = getManualInputRequest();
                send(controller, {
                  type: "auth",
                  url: event.url,
                  instructions: event.instructions ?? null,
                  token: request.token,
                });
                break;
              }
              case "device_code":
                send(controller, {
                  type: "device_code",
                  userCode: event.userCode,
                  verificationUri: event.verificationUri,
                  intervalSeconds: event.intervalSeconds ?? null,
                  expiresInSeconds: event.expiresInSeconds ?? null,
                });
                break;
              case "progress":
                send(controller, { type: "progress", message: event.message });
                break;
              case "info":
                // Informational only; no dedicated frontend handler.
                break;
            }
          },
          prompt: async (prompt) => {
            if (prompt.type === "select") {
              // Fresh token per select: a flow may emit auth_url then a select
              // prompt, and each prompt must resolve its own submission.
              const request = createClientInputRequest(new Set(prompt.options.map((option) => option.id)));
              send(controller, {
                type: "select_request",
                message: prompt.message,
                options: prompt.options.map((o) => ({ id: o.id, label: o.label })),
                token: request.token,
              });
              return request.promise;
            }
            const request = getManualInputRequest();
            send(controller, {
              type: "prompt_request",
              message: prompt.message,
              placeholder: prompt.placeholder ?? null,
              token: request.token,
            });
            return request.promise;
          },
        });

        invalidateModelsCache();
        send(controller, { type: "success" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "Login cancelled") {
          send(controller, { type: "error", message: msg });
        } else {
          send(controller, { type: "cancelled" });
        }
      } finally {
        cleanup();
        close(controller);
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
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
