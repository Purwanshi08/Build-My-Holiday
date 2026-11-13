// Public entry point of the engine: the only module the server imports (see docs/CONTRACT.md).
// buildPackages and validateRequest are real; the rest still come from the stub until they are built.
export { buildPackages } from './build.js';
export { validateRequest } from './request.js';
export {
  getMeta,
  validatePackage,
  getOptions,
  applyChange,
  exportTrip,
} from './stub.js';
