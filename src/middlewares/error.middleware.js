export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR';
  const message = status === 413 ? 'Request body is too large' : status === 400 ? 'Invalid request' : 'An unexpected error occurred';
  req.log?.error('request_failed', { requestId: req.id, method: req.method, statusCode: status, errorType: error?.constructor?.name ?? 'Error' });
  res.status(status).json({ error: { code, message }, requestId: req.id });
}
