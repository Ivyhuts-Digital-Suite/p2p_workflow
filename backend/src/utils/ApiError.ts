export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'You are not allowed to perform this action') {
    return new ApiError(403, message);
  }

  static notFound(entity = 'Resource') {
    return new ApiError(404, `${entity} not found`);
  }

  static conflict(message: string, details?: unknown) {
    return new ApiError(409, message, details);
  }

  /** Request is well-formed but violates a business rule */
  static unprocessable(message: string, details?: unknown) {
    return new ApiError(422, message, details);
  }
}
