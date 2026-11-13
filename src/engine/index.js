// Public entry point of the engine: the only module the server imports (see docs/CONTRACT.md).
// Real engine: buildPackages, validateRequest, applyChange, getOptions; Person B: validatePackage, exportTrip.
export { buildPackages } from './build.js';
export { validateRequest } from './request.js';
export { applyChange, getOptions } from './change.js';
export { getMeta } from './stub.js';
export { validatePackage } from './validate.js';
export { exportTrip } from './export.js';
