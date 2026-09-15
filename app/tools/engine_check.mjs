// Run the browser engine outside a browser, so the test-suite can hold it to the Python.
//   node tools/engine_check.mjs <site.json> <params.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { runScenario } = await import(pathToFileURL(join(here, "..", "raseen", "web", "engine.js")).href);

const [sitePath, paramsPath, outPath] = process.argv.slice(2);
const site = JSON.parse(readFileSync(sitePath, "utf8"));
const params = JSON.parse(readFileSync(paramsPath, "utf8"));
const t0 = performance.now();
const scenario = runScenario(params, site);
scenario.elapsed_ms = Math.round(performance.now() - t0);
writeFileSync(outPath, JSON.stringify(scenario));
