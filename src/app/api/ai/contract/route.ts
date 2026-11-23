import { createClient } from '../../../../ai';
import { sharedRateLimiter } from '../handler';
import { createContractHandler } from './handler';

export const POST = createContractHandler({ getClient: createClient, limiter: sharedRateLimiter });
