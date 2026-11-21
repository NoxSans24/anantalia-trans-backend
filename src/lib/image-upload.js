const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MIME_EXTENSION_MAP = Object.freeze({
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
});

function createValidationError(message, code = 'INVALID_INPUT', status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.userMessage = message;
  return err;
}

export function validateImageUpload({ fileName, mimeType, dataBase64, maxBytes = 524288 } = {}) {
  if (typeof fileName !== 'string' || !fileName.trim()) {
    throw createValidationError('Nama berkas gambar wajib diisi.');
  }
  const cleanName = fileName.trim();
  if (cleanName.includes('..') || cleanName.includes('/') || cleanName.includes('\\') || cleanName.includes('\0')) {
    throw createValidationError('Nama berkas mengandung karakter path yang tidak diizinkan.', 'INVALID_FILE_NAME');
  }
  if (/\.(php|phtml|html?|js|mjs|cjs|svg|exe|sh|bat|cmd|ps1)\./i.test(cleanName)) {
    throw createValidationError('Nama berkas mengandung ekstensi ganda yang tidak aman.', 'INVALID_FILE_NAME');
  }
  const nameMatch = cleanName.match(/^([a-zA-Z0-9 ._-]{1,120})\.([a-zA-Z0-9]+)$/);
  if (!nameMatch) {
    throw createValidationError('Format nama berkas tidak valid. Gunakan huruf, angka, spasi, titik, underscore, atau strip.', 'INVALID_FILE_NAME');
  }
  const baseSlug = nameMatch[1].replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'image';
  const ext = nameMatch[2].toLowerCase();

  const normalizedMime = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMime)) {
    throw createValidationError('Tipe file tidak didukung. Hanya JPG, JPEG, PNG, dan WebP yang diizinkan.', 'INVALID_MIME_TYPE');
  }
  if (!MIME_EXTENSION_MAP[normalizedMime].includes(ext)) {
    throw createValidationError('Ekstensi berkas tidak cocok dengan tipe MIME gambar.', 'INVALID_FILE_EXTENSION');
  }

  if (typeof dataBase64 !== 'string' || !dataBase64.trim()) {
    throw createValidationError('Data gambar base64 wajib diisi.');
  }
  const stripped = dataBase64.trim().replace(/^data:image\/[a-z0-9+.-]+;base64,/i, '').replace(/\s+/g, '');
  if (!stripped || !/^[A-Za-z0-9+/=]+$/.test(stripped)) {
    throw createValidationError('Format base64 gambar tidak valid.');
  }
  const bytes = Buffer.from(stripped, 'base64');
  if (bytes.length === 0) {
    throw createValidationError('Berkas gambar kosong.');
  }
  if (bytes.length > maxBytes) {
    throw createValidationError(`Ukuran gambar (${Math.ceil(bytes.length / 1024)} KB) melebihi batas maksimal ${Math.round(maxBytes / 1024)} KB.`, 'FILE_TOO_LARGE');
  }

  const isPng =
    normalizedMime === 'image/png' &&
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isJpeg =
    normalizedMime === 'image/jpeg' &&
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const isWebp =
    normalizedMime === 'image/webp' &&
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP';

  if (!isPng && !isJpeg && !isWebp) {
    throw createValidationError('Isi biner berkas tidak sesuai dengan format gambar yang dideklarasikan.', 'INVALID_IMAGE_SIGNATURE');
  }

  return {
    safeName: `${baseSlug}.${ext}`,
    mimeType: normalizedMime,
    cleanBase64: stripped,
    bytes,
  };
}

export async function uploadToExternalObjectStorage({
  externalUrlRaw,
  token,
  objectKey,
  safeName,
  mimeType,
  bytes,
  cleanBase64,
  fetchImpl = globalThis.fetch,
} = {}) {
  let parsedStorageUrl = null;
  try {
    parsedStorageUrl = new URL(externalUrlRaw);
  } catch {
    parsedStorageUrl = null;
  }
  if (!parsedStorageUrl || !['http:', 'https:'].includes(parsedStorageUrl.protocol)) {
    throw createValidationError('Konfigurasi OBJECT_STORAGE_UPLOAD_URL tidak valid (harus http/https).', 'OBJECT_STORAGE_UPLOAD_FAILED', 502);
  }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetchImpl(parsedStorageUrl.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        objectKey,
        fileName: safeName,
        mimeType,
        sizeBytes: bytes.length,
        dataBase64: cleanBase64,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const payload = await resp.json().catch(() => null);
    const candidateUrl = payload?.imageUrl || payload?.publicUrl || payload?.url || null;
    if (!resp.ok || typeof candidateUrl !== 'string' || !/^https?:\/\//i.test(candidateUrl.trim())) {
      throw createValidationError(`Gagal mengunggah berkas ke object storage (HTTP ${resp.status}).`, 'OBJECT_STORAGE_UPLOAD_FAILED', 502);
    }
    return {
      externalImageUrl: candidateUrl.trim(),
      objectKey: typeof payload?.objectKey === 'string' && payload.objectKey.trim()
        ? payload.objectKey.trim().slice(0, 300)
        : objectKey,
    };
  } catch (err) {
    if (err?.code === 'OBJECT_STORAGE_UPLOAD_FAILED') throw err;
    throw createValidationError(
      err?.name === 'TimeoutError' ? 'Timeout mengunggah berkas ke object storage (8s).' : 'Gagal menghubungi layanan object storage.',
      'OBJECT_STORAGE_UPLOAD_FAILED',
      502,
    );
  }
}
