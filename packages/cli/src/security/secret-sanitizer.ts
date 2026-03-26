const REDACTED = "[REDACTED]";

const AUTH_BEARER_PATTERN = /(authorization\s*[:=]\s*bearer\s+)([^\s,;"']+)/gi;
const INLINE_SECRET_ASSIGNMENT_PATTERN =
  /((?:["']?(?:api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|session[_-]?token|refresh[_-]?token|authorization|token|password|passphrase|secret)["']?)\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|bearer\s+[^\s,;}\]]+|[^\s,;}\]]+)/gi;
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9]{16,}\b/g;
const GITHUB_TOKEN_PATTERN = /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g;
const AWS_ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/g;
const SLACK_TOKEN_PATTERN = /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/g;
const CREDENTIAL_URI_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi;

export function maskSensitiveString(value: string): string {
  return value
    .replace(INLINE_SECRET_ASSIGNMENT_PATTERN, (_whole, prefix: string, rawValue: string) => {
      if (rawValue.startsWith('"')) {
        return `${prefix}"${REDACTED}"`;
      }
      if (rawValue.startsWith("'")) {
        return `${prefix}'${REDACTED}'`;
      }
      return `${prefix}${REDACTED}`;
    })
    .replace(AUTH_BEARER_PATTERN, `$1${REDACTED}`)
    .replace(OPENAI_KEY_PATTERN, REDACTED)
    .replace(GITHUB_TOKEN_PATTERN, REDACTED)
    .replace(AWS_ACCESS_KEY_PATTERN, REDACTED)
    .replace(SLACK_TOKEN_PATTERN, REDACTED)
    .replace(JWT_PATTERN, REDACTED)
    .replace(CREDENTIAL_URI_PATTERN, `$1${REDACTED}@`);
}

export function maskSensitiveData<T>(value: T): T {
  return maskUnknown(value, new WeakSet<object>()) as T;
}

function maskUnknown(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return maskSensitiveString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskUnknown(item, seen));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(input)) {
    if (isSensitiveKey(key)) {
      output[key] = entry === undefined ? undefined : REDACTED;
      continue;
    }
    output[key] = maskUnknown(entry, seen);
  }

  return output;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    normalized.includes("apikey") ||
    normalized.includes("accesskey") ||
    normalized.includes("privatekey") ||
    normalized.includes("clientsecret") ||
    normalized.includes("sessiontoken") ||
    normalized.includes("refreshtoken") ||
    normalized.includes("authorization") ||
    normalized === "token" ||
    normalized.endsWith("token") ||
    normalized.includes("connectionstring") ||
    normalized.includes("databaseurl") ||
    normalized.includes("databaseuri") ||
    normalized === "dsn" ||
    normalized.endsWith("dsn") ||
    normalized.includes("password") ||
    normalized.includes("passphrase") ||
    normalized.includes("secret")
  );
}
