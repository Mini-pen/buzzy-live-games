import { customAlphabet } from "nanoid";

/** * Alphabet without visually ambiguous glyphs (invite codes typed on phones). */
const JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const joinCodeNano = customAlphabet(JOIN_CODE_CHARS, 6);

/** * Builds a random 6-character room code. */
export function randomJoinCode(): string {
  return joinCodeNano();
}

/** * Builds a cryptographically adequate admin bearer token */
export function randomSecretHex(bytes = 24): string {
  const buf = Buffer.allocUnsafe(bytes);
  crypto.getRandomValues(buf);
  return buf.toString("hex");
}
