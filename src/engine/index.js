// Public entry point of the engine: the only module the server imports (see docs/CONTRACT.md).
// Delegates to the stub for now; validatePackage/exportTrip switch to Person B's ./validate.js and ./export.js.
export {
  getMeta,
  validateRequest,
  buildPackages,
  validatePackage,
  getOptions,
  applyChange,
  exportTrip,
} from './stub.js';
