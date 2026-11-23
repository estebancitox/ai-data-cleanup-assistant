import { createClient } from '../../../../ai';
import { createContractHandler } from './handler';

export const POST = createContractHandler({ getClient: createClient });
