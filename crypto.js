const format = 'family-recipe-box/v1';
const iterations = 600000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(bytes) {
  // Keep spread calls short enough for browser argument limits.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function decode(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

export function makeSalt() {
  return encode(crypto.getRandomValues(new Uint8Array(16)));
}

export function checkEnvelope(envelope) {
  if (envelope?.format !== format || envelope.iterations !== iterations ||
      decode(envelope.salt).length !== 16 || decode(envelope.iv).length !== 12 ||
      typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length < 24) {
    throw new Error('Invalid encrypted cookbook');
  }
  return envelope;
}

export async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey({
    name: 'PBKDF2', hash: 'SHA-256', salt: decode(salt), iterations
  }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function cipherOptions(iv, purpose) {
  return { name: 'AES-GCM', iv, additionalData: encoder.encode(format + '/' + purpose) };
}

export async function seal(payload, key, salt, purpose = 'catalog') {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = encoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(cipherOptions(iv, purpose), key, bytes);
  return { format, iterations, salt, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}

export async function unseal(envelope, key, purpose = 'catalog') {
  checkEnvelope(envelope);
  const output = await crypto.subtle.decrypt(
    cipherOptions(decode(envelope.iv), purpose), key, decode(envelope.ciphertext)
  );
  return JSON.parse(decoder.decode(output));
}
