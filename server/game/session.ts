/**
 * Short, human-friendly room codes for Arena Royale. Uppercase, no ambiguous
 * characters (0/O/1/I/L removed) so they read cleanly over voice and fit a
 * shareable link. Generated with Node's CSPRNG — no extra dependency.
 */

import { randomInt } from "crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;

export function generateRoomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}
