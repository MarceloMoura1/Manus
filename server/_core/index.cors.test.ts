import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerMegaDeskCors } from "./index";

const servers: ReturnType<express.Express["listen"]>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(server =>
      new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      )
    )
  );
});

describe("MegaDesk CORS middleware", () => {
  it("accepts the custom background-upload headers in a cross-origin PUT preflight", async () => {
    const app = express();
    registerMegaDeskCors(app);
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/user-personalization/background`,
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.megadesk.online",
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers":
            "content-type,x-megadesk-incoming-bubble-color,x-megadesk-outgoing-bubble-color",
        },
      }
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.megadesk.online"
    );
    const allowed = response.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
    for (const header of [
      "content-type",
      "authorization",
      "x-tenant-id",
      "x-user-role",
      "x-trpc-source",
      "cookie",
      "x-megadesk-incoming-bubble-color",
      "x-megadesk-outgoing-bubble-color",
    ]) {
      expect(allowed).toContain(header);
    }
  });
});
