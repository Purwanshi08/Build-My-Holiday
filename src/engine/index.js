// Public entry point of the engine: the only module the server imports (see docs/CONTRACT.md).
// Currently delegates everything to the stub; swap each export to the real implementation as it lands.
export {
  getMeta,
  validateRequest,
  buildPackages,
  validatePackage,
  getOptions,
  applyChange,
  exportTrip,
} from './stub.js';
