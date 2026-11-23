import { createRecordingHandler } from './handler';

// Read from the query string and the file system on every request.
export const dynamic = 'force-dynamic';

export const GET = createRecordingHandler();
