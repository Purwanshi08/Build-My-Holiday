// Public entry point of the engine: the only module the server imports (see docs/CONTRACT.md).
// validatePackage/exportTrip come from Person B's ./validate.js and ./export.js; the rest from the stub for now.
export { getMeta, validateRequest, buildPackages, getOptions, applyChange } from './stub.js';
export { validatePackage } from './validate.js';
export { exportTrip } from './export.js';
