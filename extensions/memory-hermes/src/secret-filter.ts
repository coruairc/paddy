const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
  /\b(?:sk|rk)-[A-Za-z0-9]{16,}\b/,
  /\b(?:sk-ant-|sk-proj-)[A-Za-z0-9_-]{12,}\b/,
  /\bxai-[A-Za-z0-9_-]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:xox[baprs]|xapp)-[A-Za-z0-9-]{10,}\b/,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{12,}=*/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd)\b\s*[:=]\s*\S{6,}/i,
  /\b(?:postgres|mysql|mongodb|redis):\/\/[^\s]+:[^\s]+@/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
];

export function findSecret(text: string): string | null {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return pattern.source;
    }
  }
  return null;
}
