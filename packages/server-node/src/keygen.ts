import { randomBytes } from 'crypto';

export function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

if (import.meta.main) {
  console.log(generateApiKey());
}
