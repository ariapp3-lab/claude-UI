/**
 * reconcile — price a folder of documents against a contract.
 *
 *   npm run reconcile -- <folder> [--all] [--csv out.csv] [--json out.json]
 *
 * Reads every file in the folder, parses what it can, prices each document
 * against the rules in force, and prints the queue a human works through.
 * Files it cannot parse are reported, never skipped silently.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Money } from "@commission/engine";
import { LY_MAINST_2026 } from "../../engine/contracts/ly-mainst-2026.js";
import { parseAmadeusAir } from "@commission/parsers";
import { reconcile, type ReconcileInput } from "./reconcile.js";
import { renderReport, toCsv, toJson } from "./report.js";

interface Args {
  dir: string;
  all: boolean;
  csv: string | null;
  json: string | null;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  return {
    dir: positional[0] ?? ".",
    all: argv.includes("--all"),
    csv: flag("csv"),
    json: flag("json"),
  };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));

  let entries: string[];
  try {
    entries = readdirSync(args.dir)
      .map((f) => join(args.dir, f))
      .filter((f) => statSync(f).isFile())
      .sort();
  } catch (e) {
    process.stderr.write(`cannot read ${args.dir}: ${(e as Error).message}\n`);
    return 2;
  }
  if (entries.length === 0) {
    process.stderr.write(`no files in ${args.dir}\n`);
    return 2;
  }

  // The contract is filed unapproved and cannot fire until a human confirms the
  // readings; a reconciliation run is that confirmation being exercised.
  const rules = LY_MAINST_2026.map((r) => ({ ...r, approved: true }));

  const inputs: ReconcileInput[] = [];
  const warnings: string[] = [];

  for (const file of entries) {
    const name = file.split("/").pop() ?? file;
    let parsed;
    try {
      parsed = parseAmadeusAir(readFileSync(file, "utf8"));
    } catch (e) {
      warnings.push(`${name}: could not be parsed — ${(e as Error).message}`);
      continue;
    }
    if (parsed.tickets.length === 0) {
      warnings.push(`${name}: no tickets found`);
      continue;
    }
    for (const p of parsed.passengers) {
      inputs.push({
        ticket: p.ticket,
        // A markup recorded on a net fare is revenue, not a commission claim,
        // and must not be counted as one.
        claimed: p.reportedFM && !p.ticket.bulk ? p.reportedFM.amount : null,
        markup: p.markup,
      });
    }
    for (const w of parsed.warnings) warnings.push(`${name}: ${w}`);
  }

  if (inputs.length === 0) {
    process.stderr.write(`no documents could be priced from ${entries.length} file(s)\n`);
    for (const w of warnings) process.stderr.write(`  ${w}\n`);
    return 1;
  }

  const result = reconcile(inputs, rules, warnings);
  process.stdout.write(
    renderReport(result, { colour: process.stdout.isTTY === true, all: args.all }),
  );

  if (args.csv) {
    writeFileSync(args.csv, toCsv(result));
    process.stdout.write(`  wrote ${args.csv}\n`);
  }
  if (args.json) {
    writeFileSync(args.json, toJson(result));
    process.stdout.write(`  wrote ${args.json}\n`);
  }

  // Exit non-zero when money is at stake, so this can gate a filing step.
  const atStake: Money[] = [result.totals.forfeited, result.totals.overclaimed, result.totals.unclaimed];
  return atStake.some((m) => m.units > 0n) ? 1 : 0;
}

process.exit(main());
