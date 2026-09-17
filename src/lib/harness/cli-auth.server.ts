/**
 * Server-only gateway auth middleware for createServerFn.
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { assertGatewayCallerAuthorized } from "./cli-auth";

export {
  CliAuthError,
  assertGatewayCallerAuthorized,
  bearerFromHeaders,
  cliAuthorized,
  expectedCliToken,
  gatewayBindIsLoopback,
  tokensEqual,
} from "./cli-auth";

export const cliGatewayMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    assertGatewayCallerAuthorized(getRequest());
    return next();
  },
);
