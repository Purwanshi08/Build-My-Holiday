// Public entry point of the engine: the only module the server imports (see docs/CONTRACT.md).
// buildPackages/validateRequest are the real engine; validatePackage/exportTrip are Person B's; the rest is stub.
export { buildPackages } from './build.js';
export { validateRequest } from './request.js';
export { getMeta, getOptions, applyChange } from './stub.js';
export { validatePackage } from './validate.js';
export { exportTrip } from './export.js';
