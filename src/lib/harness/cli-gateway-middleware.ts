/**
 * Dual client/server middleware for gated gateway createServerFn calls.
 * Client attaches Authorization: Bearer when a session CLI token is set.
 * Server enforces the backend contract (loopback optional; off-loopback required).
 *
 * Must NOT live in a *.server.ts file — the client hook has to ship to the browser.
 */
import { createMiddleware } from "@tanstack/react-start";

export const cliGatewayMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getCliToken } = await import("./cli-token");
    const token = getCliToken();
    if (!token) return next();
    return next({
      headers: { Authorization: `Bearer ${token}` },
    });
  })
  .server(async ({ next }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { assertGatewayCallerAuthorized } = await import("./cli-auth");
    assertGatewayCallerAuthorized(getRequest());
    return next();
  });
