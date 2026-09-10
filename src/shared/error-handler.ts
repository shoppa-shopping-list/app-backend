import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

import { ApiError } from './api-error.js';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (hasZodFastifySchemaValidationErrors(error)) {
    reply.code(400).send({ details: error.validation, error: 'validation_error' });
    return;
  }

  if (error instanceof ApiError) {
    reply.code(error.statusCode).send({ error: error.code, message: error.message });
    return;
  }

  request.log.error(error);
  reply.code(500).send({ error: 'internal_error' });
}
