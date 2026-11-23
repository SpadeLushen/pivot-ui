import { after } from "next/server";
import { startRpcSession } from "./rpc-manager";

/** Let Next's graceful shutdown wait for wrappers started by HTTP, including in-flight starts. */
export function startRequestRpcSession(...args: Parameters<typeof startRpcSession>) {
  const starting = startRpcSession(...args);
  after(starting.then(({ session }) => session.whenClosed, () => undefined));
  return starting;
}
