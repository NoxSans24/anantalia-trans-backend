const allowedFields = ['requestId', 'method', 'statusCode', 'durationMs', 'errorType'];

export function createLogger(write = (line) => process.stdout.write(`${line}\n`)) {
  return {
    info(event, fields = {}) { write(JSON.stringify({ level: 'info', event, ...safeFields(fields) })); },
    error(event, fields = {}) { write(JSON.stringify({ level: 'error', event, ...safeFields(fields) })); },
  };
}

function safeFields(fields) {
  return Object.fromEntries(allowedFields.filter((key) => fields[key] !== undefined).map((key) => [key, fields[key]]));
}

export const logger = createLogger();
