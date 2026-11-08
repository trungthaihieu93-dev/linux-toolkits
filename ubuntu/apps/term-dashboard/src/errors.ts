/**
 * Errors that map to an HTTP status. Services throw them; the app's error
 * handler turns them into `ApiError` bodies. Anything else becomes a 500.
 */
export type HttpStatus = 400 | 404 | 409 | 413 | 422 | 503;

export class HttpError extends Error {
  constructor(
    readonly status: HttpStatus,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Invalid identifier or body. */
export const badRequest = (message: string, detail?: string) =>
  new HttpError(400, message, detail);
/** Unknown id (profile, backup). */
export const notFound = (message: string) => new HttpError(404, message);
/** The file changed on disk since the client read it (only that). */
export const conflict = (message: string, detail?: string) =>
  new HttpError(409, message, detail);
/** A syntax check (`bash -n`, `sh -n`, `zsh -n`, `ghostty +validate-config`) failed. */
export const checkFailed = (message: string, detail: string) =>
  new HttpError(422, message, detail);
/**
 * The request is well-formed but cannot be applied to the current state (the
 * default profile, a file that is not UTF-8, a restore that partly failed).
 */
export const unprocessable = (message: string, detail?: string) =>
  new HttpError(422, message, detail);
/** The feature needs a program or schema that is not installed. */
export const unavailable = (message: string) => new HttpError(503, message);

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
