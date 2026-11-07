import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { JWK } from "jose";

/**
 * Local JWKS endpoint with request counting, controllable latency, and
 * failure modes (HTTP error, dropped connection, or stopped server →
 * connection refused).
 */
export class TestJwksServer {
  requestCount = 0;
  latencyMs = 0;
  mode: "ok" | "http-error" | "drop" = "ok";
  keys: JWK[] = [];

  private server: Server | null = null;
  private port = 0;

  get url(): URL {
    return new URL(`http://127.0.0.1:${this.port}/auth/v1/.well-known/jwks.json`);
  }

  async start(port = 0): Promise<void> {
    this.server = createServer((req, res) => {
      this.requestCount += 1;
      const respond = () => {
        if (this.mode === "drop") {
          req.socket.destroy();
          return;
        }
        if (this.mode === "http-error") {
          res.writeHead(500).end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: this.keys }));
      };
      if (this.latencyMs > 0) setTimeout(respond, this.latencyMs);
      else respond();
    });
    await new Promise<void>((resolve) => this.server?.listen(port, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  /** Stops listening; later requests get "connection refused". */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server === null) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
