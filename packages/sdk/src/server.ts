/**
 * An HTTP front door, for a CRM that is not JavaScript.
 *
 *   node --import tsx packages/sdk/src/server.ts --port 8787 --config ./contracts.json
 *
 *   POST /price      body: the AIR file, as text     → the priced documents
 *   POST /statement  body: { statementCsv, files: [{name, text}] }
 *   GET  /health
 *
 * Deliberately small: no framework, no database, no session. It holds the
 * contract configuration in memory and answers questions about text it is
 * handed. Anything that needs storing is the caller's to store — which is what
 * makes it safe to run beside a CRM that already has a database.
 *
 * It binds to localhost by default. This answers questions about commercial
 * contracts and passenger names; putting it on a public interface is a decision
 * that has to be made deliberately, with a proxy in front of it.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import {
  checkStatement, priceAirFile, seedConfig, type Config,
} from "./index.js";

interface Args {
  port: number;
  host: string;
  configPath: string | null;
  view: "subagent" | "host";
  subAgentId: string;
}

function parseArgs(argv: readonly string[]): Args {
  const flag = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
  };
  return {
    port: Number(flag("port", "8787")),
    host: flag("host", "127.0.0.1"),
    configPath: argv.includes("--config") ? flag("config", "") || null : null,
    view: flag("view", "subagent") === "host" ? "host" : "subagent",
    subAgentId: flag("sub-agent", "subagent"),
  };
}

function loadConfig(path: string | null): Config {
  if (!path) return seedConfig();
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Config;
  } catch (e) {
    process.stderr.write(`could not read ${path}: ${(e as Error).message}\n`);
    process.exit(2);
  }
}

const LIMIT = 8 * 1024 * 1024;   // an AIR record is kilobytes; a batch, a few MB

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > LIMIT) {
        reject(new Error("the request body is larger than this server accepts"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

export function start(args: Args = parseArgs(process.argv.slice(2))): void {
  const config = loadConfig(args.configPath);
  const opts = { config, view: args.view, subAgentId: args.subAgentId } as const;

  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "/").split("?")[0];

      if (req.method === "GET" && path === "/health") {
        return send(res, 200, {
          ok: true,
          consolidators: config.consolidators.map((c) => ({
            id: c.id, name: c.name, iata: c.iata,
            carriers: c.contracts.map((k) => k.carrier),
          })),
          view: args.view,
        });
      }

      if (req.method !== "POST") {
        return send(res, 405, { ok: false, error: `${req.method} is not supported here` });
      }

      let body: string;
      try {
        body = await readBody(req);
      } catch (e) {
        return send(res, 413, { ok: false, error: (e as Error).message });
      }

      if (path === "/price") {
        // The body is the AIR file itself, so a caller can cat a file into curl.
        return send(res, 200, priceAirFile(body, opts));
      }

      if (path === "/statement") {
        try {
          const parsed = JSON.parse(body) as {
            statementCsv?: string;
            files?: { name: string; text: string }[];
          };
          if (!parsed.statementCsv || !Array.isArray(parsed.files)) {
            return send(res, 400, {
              ok: false,
              error: "expected { statementCsv: string, files: [{ name, text }] }",
            });
          }
          return send(res, 200, checkStatement(parsed.statementCsv, parsed.files, opts));
        } catch (e) {
          return send(res, 400, { ok: false, error: `invalid JSON: ${(e as Error).message}` });
        }
      }

      send(res, 404, { ok: false, error: `nothing is served at ${path}` });
    })();
  });

  server.listen(args.port, args.host, () => {
    process.stdout.write(
      `commission sdk on http://${args.host}:${args.port}\n` +
      `  consolidators: ${config.consolidators.map((c) => `${c.name} (${c.iata})`).join(", ") || "none"}\n` +
      `  pricing as:    ${args.view}\n` +
      `  POST /price · POST /statement · GET /health\n`,
    );
  });
}

start();
