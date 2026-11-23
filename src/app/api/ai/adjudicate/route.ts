import { createClient } from '../../../../ai';
import { sharedRateLimiter } from '../handler';
import { createAdjudicateHandler } from './handler';

export const POST = createAdjudicateHandler({ getClient: createClient, limiter: sharedRateLimiter });
