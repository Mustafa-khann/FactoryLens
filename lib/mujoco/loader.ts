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
  FS: { writeFile: (path: string, data: string) => void };
  MjModel: { loadFromXML: (path: string) => MjModelHandle | null };
  MjData: new (model: MjModelHandle) => MjDataHandle;
  mj_step: (model: MjModelHandle, data: MjDataHandle) => void;
  mj_forward: (model: MjModelHandle, data: MjDataHandle) => void;
  [key: string]: unknown;
}

export interface MjModelHandle {
  nq: number;
  nv: number;
  nu: number;
  ngeom: number;
  geom_type: ArrayLike<number>;
  geom_size: ArrayLike<number>;
  geom_rgba: ArrayLike<number>;
  geom_bodyid: ArrayLike<number>;
  dof_damping: number[];
  dof_frictionloss: number[];
  actuator_gainprm: number[];
  actuator_biasprm: number[];
  geom_friction: number[];
  delete: () => void;
}

export interface MjDataHandle {
  time: number;
  qpos: ArrayLike<number> & { [i: number]: number };
  qvel: ArrayLike<number> & { [i: number]: number };
  ctrl: ArrayLike<number> & { [i: number]: number };
  actuator_force: ArrayLike<number> & { [i: number]: number };
  geom_xpos: ArrayLike<number>;
  geom_xmat: ArrayLike<number>;
  delete: () => void;
}

const MODULE_URL = "/mujoco/mujoco_wasm.js";

export function loadMujocoModule(): Promise<MujocoModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MuJoCo can only be loaded in the browser."));
  }
  if (!modulePromise) {
    // Hide the specifier from the bundler so the public asset is fetched as-is.
    const runtimeImport = new Function("url", "return import(url);") as (
      url: string,
    ) => Promise<{ default?: () => Promise<MujocoModule> }>;

    modulePromise = runtimeImport(MODULE_URL)
      .then((mod) => {
        const factory = mod.default;
        if (typeof factory !== "function") {
          throw new Error("MuJoCo module did not export a factory function.");
        }
        return factory();
      })
      .catch((err) => {
        // Allow a later retry instead of caching a permanent failure.
        modulePromise = null;
        throw err;
      });
  }
  return modulePromise;
}
