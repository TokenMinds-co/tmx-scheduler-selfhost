import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * One exception type for every deliberate API failure, so the shape the admin
 * UI parses (`{ statusCode, code, message }`) is the same everywhere.
 */
export class ApiException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super({ statusCode: status, code, message }, status);
  }

  static badRequest(message: string, code = 'bad_request') {
    return new ApiException(HttpStatus.BAD_REQUEST, code, message);
  }

  static unauthorized(message = 'Authentication required.') {
    return new ApiException(HttpStatus.UNAUTHORIZED, 'unauthorized', message);
  }

  static forbidden(message = 'Not permitted.') {
    return new ApiException(HttpStatus.FORBIDDEN, 'forbidden', message);
  }

  static notFound(message: string) {
    return new ApiException(HttpStatus.NOT_FOUND, 'not_found', message);
  }

  static conflict(message: string, code = 'conflict') {
    return new ApiException(HttpStatus.CONFLICT, code, message);
  }

  static unprocessable(message: string, code = 'unprocessable') {
    return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
  }
}
