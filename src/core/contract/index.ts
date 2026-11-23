// The data contract: what is sent to the model, the shape of its answer, and the check of
// every proposed rule against the file. SPEC §6.1 to §6.3.

export { buildContractRequest } from './request';
export { ContractRequestSchema, ContractSchema } from './schema';
export { verifyContract } from './verify';
// What a verified rule means for a cell, for the detectors the contract drives.
export { dependencyGroups, observedValues, rangePosition } from './rules';
export type { DependencyGroup, ObservedValue } from './rules';
