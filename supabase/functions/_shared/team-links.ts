export function normalizeTeamEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("email_invalid");
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("email_invalid");
  }
  return email;
}

export function isMemberRole(
  value: unknown,
): value is "admin" | "staff" | "viewer" {
  return value === "admin" || value === "staff" || value === "viewer";
}

export type MemberTokenPayload = {
  tokenHash: string;
  verificationType: "invite" | "recovery";
};

export async function inputFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value));
  return toBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

export async function encryptMemberToken(
  payload: MemberTokenPayload,
  secret: string,
): Promise<string> {
  if (!secret) throw new Error("team_link_encryption_key_missing");
  const rawKey = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptMemberToken(
  ciphertext: string,
  secret: string,
): Promise<MemberTokenPayload> {
  if (!secret) throw new Error("team_link_encryption_key_missing");
  const [ivText, dataText, extra] = ciphertext.split(".");
  if (!ivText || !dataText || extra !== undefined) {
    throw new Error("team_link_ciphertext_invalid");
  }
  const rawKey = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "decrypt",
  ]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(ivText) },
    key,
    fromBase64Url(dataText),
  );
  const decoded = new TextDecoder().decode(plaintext);
  try {
    const payload = JSON.parse(decoded) as Partial<MemberTokenPayload>;
    if (
      typeof payload.tokenHash === "string" &&
      (payload.verificationType === "invite" ||
        payload.verificationType === "recovery")
    ) {
      return {
        tokenHash: payload.tokenHash,
        verificationType: payload.verificationType,
      };
    }
  } catch { /* pilot ciphertext may contain an older raw token hash */ }
  if (decoded) return { tokenHash: decoded, verificationType: "invite" };
  throw new Error("team_link_ciphertext_invalid");
}

export function memberActionLink(
  appUrl: string,
  tokenHash: string,
  kind: "invite" | "recovery",
): string {
  const url = new URL("/auth/confirm", appUrl);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", kind);
  return url.toString();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort((
      [a],
      [b],
    ) => a.localeCompare(b));
    return `{${
      entries.map(([key, nested]) =>
        `${JSON.stringify(key)}:${stableJson(nested)}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value) ?? "null";
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}
