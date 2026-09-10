import { createFileRoute } from "@tanstack/react-router";
import { handleCliRequest } from "@/lib/harness/cli-api";

export const Route = createFileRoute("/api/cli")({
  server: {
    handlers: {
      GET: async ({ request }) => handleCliRequest(request),
      POST: async ({ request }) => handleCliRequest(request),
      OPTIONS: async ({ request }) => handleCliRequest(request),
    },
  },
});
