import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const REL_WASM =
  'rust-agent/plugin/target/wasm32-unknown-unknown/release/agent_plugin.wasm';

let instancePromise: Promise<WebAssembly.Instance> | null = null;

/** Build the ordered list of candidate locations for the plugin wasm. */
function candidatePaths(): string[] {
  const fromEnv = process.env.AGENT_PLUGIN_WASM;
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return [
    ...(fromEnv ? [fromEnv] : []),
    // Project root relative to the compiled/source module (dist/.. or src/..).
    resolve(moduleDir, '..', REL_WASM),
    // Fallback: relative to the current working directory.
    resolve(process.cwd(), REL_WASM),
  ];
}

async function resolveWasmPath(): Promise<string> {
  const candidates = candidatePaths();
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `agent_plugin.wasm not found. Looked in:\n  ${candidates.join(
      '\n  ',
    )}\nBuild it with: npm run wasm:build`,
  );
}

async function loadInstance(): Promise<WebAssembly.Instance> {
  if (instancePromise) return instancePromise;
  instancePromise = (async () => {
    const wasmPath = await resolveWasmPath();
    const buf = await fs.readFile(wasmPath); // Node Buffer
    const bytes = new Uint8Array(buf); // -> BufferSource for correct overload
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return instance;
  })().catch((err) => {
    // Reset so a later call can retry (e.g. after the wasm is built).
    instancePromise = null;
    throw err;
  });
  return instancePromise;
}

export async function scoreTag(tag: number): Promise<number> {
  const inst = await loadInstance();
  const fn = inst.exports['score_tag'] as (x: number) => number;
  return fn(Number(tag) | 0);
}
