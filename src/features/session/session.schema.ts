import { z } from 'zod';

// .passthrough(): Fastify validates and replaces `request.headers` with this schema's
// output, so every other header (host, content-length, ...) must survive untouched.
export const sessionHeadersSchema = z.object({ authorization: z.string() }).loose();
