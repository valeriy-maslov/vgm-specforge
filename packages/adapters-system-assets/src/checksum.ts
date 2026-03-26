import { createHash, timingSafeEqual } from "node:crypto";

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function equalsSha256Hex(expected: string, actual: string): boolean {
  if (expected.length !== actual.length || expected.length !== 64) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  if (expectedBuffer.length !== 32 || actualBuffer.length !== 32) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
