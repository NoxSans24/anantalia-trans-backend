import argon2 from 'argon2';

const parameterNames = Object.freeze({
  memoryCost: 'ARGON2_MEMORY_COST',
  timeCost: 'ARGON2_TIME_COST',
  parallelism: 'ARGON2_PARALLELISM',
  hashLength: 'ARGON2_HASH_LENGTH',
});

function getParameters(environment = process.env) {
  const parameters = {};
  for (const [key, name] of Object.entries(parameterNames)) {
    const value = environment[name];
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
      throw new Error('Argon2id parameters are missing or invalid');
    }
    parameters[key] = Number(value);
    if (!Number.isSafeInteger(parameters[key])) throw new Error('Argon2id parameters are missing or invalid');
  }
  if (parameters.memoryCost < 8 * parameters.parallelism || parameters.hashLength < 4) {
    throw new Error('Argon2id parameters are missing or invalid');
  }
  return parameters;
}

export function validatePasswordConfiguration(environment = process.env) {
  return Object.freeze(getParameters(environment));
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('Password must be a non-empty string');
  }
}

export async function hashPassword(password) {
  assertPassword(password);
  const { memoryCost, timeCost, parallelism, hashLength } = getParameters();
  try {
    return await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost,
      timeCost,
      parallelism,
      hashLength,
    });
  } catch {
    throw new Error('Password hashing failed');
  }
}

export async function verifyPassword(password, encodedHash) {
  assertPassword(password);
  getParameters();
  if (typeof encodedHash !== 'string' || !encodedHash.startsWith('$argon2id$')) return false;
  try {
    return await argon2.verify(encodedHash, password);
  } catch {
    return false;
  }
}
