/**
 * Runtime loader for the MuJoCo WebAssembly module.
 *
 * The module (public/mujoco/mujoco_wasm.js) is an 11 MB Emscripten build with
 * the WASM embedded as base64. We deliberately load it at runtime from /public
 * rather than importing it, for two reasons:
 *   1. It must never enter the app bundle (it would bloat the initial load and
 *      trip the bundler over Emscripten's Node-only `require` branches).
 *   2. It only needs to exist once the user opens the Simulation tab.
 *
 * The `new Function(...)` indirection hides the dynamic import from the bundler
 * so neither webpack nor Turbopack tries to resolve or rewrite the specifier.
 */

// The instantiated module is a singleton — the 11 MB WASM is parsed once and
// reused across model switches.
let modulePromise: Promise<MujocoModule> | null = null;

/** Loose typing for the bits of the Embind module we touch. The shipped .d.ts
 *  types everything as `any`; this keeps call sites honest without re-declaring
 *  the entire surface. */
export interface MujocoModule {
  FS: {
    writeFile: (path: string, data: string | Uint8Array) => void;
    mkdir: (path: string) => void;
    analyzePath: (path: string) => { exists: boolean };
  };
  MjModel: { loadFromXML: (path: string) => MjModelHandle | null };
  MjData: new (model: MjModelHandle) => MjDataHandle;
  mj_step: (model: MjModelHandle, data: MjDataHandle) => void;
  mj_forward: (model: MjModelHandle, data: MjDataHandle) => void;
  /** mj_name2id(model, objType, name) — objType 3=joint, 5=geom, 6=site. */
  mj_name2id: (model: MjModelHandle, objType: number, name: string) => number;
  [key: string]: unknown;
}

type Num = ArrayLike<number> & { [i: number]: number };

export interface MjModelHandle {
  nq: number;
  nv: number;
  nu: number;
  ngeom: number;
  nmesh: number;
  nsite: number;
  opt: { timestep: number };
  // geom appearance / placement
  geom_type: Num;
  geom_size: Num;
  geom_rgba: Num;
  geom_dataid: Num;
  geom_matid: Num;
  geom_group: Num;
  // materials
  mat_rgba: Num;
  // mesh data (per-mesh slices of the shared vert/normal/face arrays)
  mesh_vertadr: Num;
  mesh_vertnum: Num;
  mesh_faceadr: Num;
  mesh_facenum: Num;
  mesh_vert: Num;
  mesh_normal: Num;
  mesh_face: Num;
  // mutable model parameters (writable heap views despite the `readonly` .d.ts)
  dof_damping: number[];
  dof_frictionloss: number[];
  actuator_gainprm: number[];
  actuator_biasprm: number[];
  geom_friction: number[];
  delete: () => void;
}

export interface MjDataHandle {
  time: number;
  qpos: Num;
  qvel: Num;
  ctrl: Num;
  actuator_force: Num;
  geom_xpos: Num;
  geom_xmat: Num;
  site_xpos: Num;
  delete: () => void;
}

const MODULE_URL = "/mujoco/mujoco_wasm.js";
const MODULE_LOAD_TIMEOUT_MS = 45_000;
const MODEL_ASSET_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(id);
        resolve(value);
      },
      (err) => {
        clearTimeout(id);
        reject(err);
      },
    );
  });
}

async function assertPublicAsset(url: string, label: string) {
  const res = await withTimeout(fetch(url, { method: "HEAD", cache: "no-store" }), 10_000, `${label} did not respond at ${url}.`);
  const contentType = res.headers.get("content-type") ?? "";
  const contentLength = Number(res.headers.get("content-length") ?? "0");

  if (!res.ok) {
    throw new Error(`${label} is missing at ${url} (HTTP ${res.status}). Check that public/mujoco is included in the Vercel deployment.`);
  }
  if (contentType.includes("text/html")) {
    throw new Error(`${label} returned the app HTML instead of a static asset. Check that public/mujoco is included in the Vercel deployment.`);
  }
  if (contentLength > 0 && contentLength < 1_000_000) {
    throw new Error(`${label} at ${url} looks too small (${contentLength} bytes). Check the deployed MuJoCo runtime asset.`);
  }
}

async function fetchModelAsset(file: VfsFile): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_ASSET_TIMEOUT_MS);
  try {
    const res = await fetch(file.url, { signal: controller.signal });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) throw new Error(`Failed to fetch ${file.url} (HTTP ${res.status}).`);
    if (contentType.includes("text/html")) {
      throw new Error(`Model asset ${file.url} returned the app HTML instead of ${file.binary ? "mesh bytes" : "XML"}. Check the Vercel static assets.`);
    }
    return res;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Timed out loading model asset ${file.url}.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function loadMujocoModule(): Promise<MujocoModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MuJoCo can only be loaded in the browser."));
  }
  if (!modulePromise) {
    // Hide the specifier from the bundler so the public asset is fetched as-is.
    const runtimeImport = new Function("url", "return import(url);") as (
      url: string,
    ) => Promise<{ default?: () => Promise<MujocoModule> }>;

    modulePromise = assertPublicAsset(MODULE_URL, "MuJoCo runtime")
      .then(() => withTimeout(runtimeImport(MODULE_URL), MODULE_LOAD_TIMEOUT_MS, "Timed out importing the MuJoCo runtime."))
      .then((mod) => {
        const factory = mod.default;
        if (typeof factory !== "function") {
          throw new Error("MuJoCo module did not export a factory function.");
        }
        return withTimeout(factory(), MODULE_LOAD_TIMEOUT_MS, "Timed out initializing the MuJoCo physics engine.");
      })
      .catch((err) => {
        modulePromise = null; // allow a later retry instead of caching the failure
        throw err;
      });
  }
  return modulePromise;
}

// ── Asset staging ──────────────────────────────────────────────────────────
// Real robot models (UR5e, KUKA) reference mesh files that MuJoCo loads from
// the Emscripten virtual FS. We mirror the public asset layout into the VFS,
// fetching each file once and caching that it has been written.

export interface VfsFile {
  /** Path inside the MuJoCo virtual FS. */
  path: string;
  /** Public URL to fetch the bytes from. */
  url: string;
  /** True for binary assets (meshes); false for text (XML). */
  binary: boolean;
}

export interface ModelAssets {
  /** Directories to create in the VFS (parents first). */
  dirs: string[];
  files: VfsFile[];
  /** VFS path passed to loadFromXML. */
  rootPath: string;
}

const stagedRoots = new Set<string>();

function mkdirp(mod: MujocoModule, dir: string) {
  let cur = "";
  for (const part of dir.split("/").filter(Boolean)) {
    cur += `/${part}`;
    if (!mod.FS.analyzePath(cur).exists) {
      try {
        mod.FS.mkdir(cur);
      } catch {
        // Concurrent creation or already-exists — safe to ignore.
      }
    }
  }
}

/** Stage a model's assets into the VFS (once) and compile it. */
export async function stageAndLoad(mod: MujocoModule, assets: ModelAssets): Promise<MjModelHandle> {
  if (!stagedRoots.has(assets.rootPath)) {
    for (const dir of assets.dirs) mkdirp(mod, dir);
    await Promise.all(
      assets.files.map(async (f) => {
        const res = await fetchModelAsset(f);
        if (f.binary) mod.FS.writeFile(f.path, new Uint8Array(await res.arrayBuffer()));
        else mod.FS.writeFile(f.path, await res.text());
      }),
    );
    stagedRoots.add(assets.rootPath);
  }
  const model = mod.MjModel.loadFromXML(assets.rootPath);
  if (!model) throw new Error(`MuJoCo failed to compile ${assets.rootPath}.`);
  return model;
}
