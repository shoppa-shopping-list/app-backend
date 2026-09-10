export class ApiError extends Error {
  code: string;
  // erasableSyntaxOnly forbids parameter properties — fields declared and assigned explicitly.
  statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
