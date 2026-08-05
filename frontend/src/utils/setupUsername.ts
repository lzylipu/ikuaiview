export function normalizeSetupUsername(value: string): string {
  return value.trim().replace(/[A-Z]/g, char =>
    String.fromCharCode(char.charCodeAt(0) + 32));
}
