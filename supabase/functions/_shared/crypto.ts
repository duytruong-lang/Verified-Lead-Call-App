import { createShareToken, toBase64Url } from './http.ts';

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function key(): Promise<CryptoKey> {
  const value = Deno.env.get('SHARE_ENCRYPTION_KEY');
  if (!value) throw new Error('share_encryption_key_missing');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
}

export async function decryptShareToken(ciphertext: string): Promise<string> {
  const [ivPart, dataPart] = ciphertext.split('.');
  if (!ivPart || !dataPart) throw new Error('share_ciphertext_invalid');
  const iv = Uint8Array.from(decodeBase64Url(ivPart));
  const data = Uint8Array.from(decodeBase64Url(dataPart));
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv.buffer }, await key(), data.buffer);
  return new TextDecoder().decode(clear);
}

export { createShareToken, toBase64Url };
