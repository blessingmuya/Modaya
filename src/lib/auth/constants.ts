export const SESSION_COOKIE = 'modaya_session';
export const SESSION_TTL_DAYS = 30;

export type Credentials = { email: string; password: string };

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Deliberately simple, honest validation: 8+ chars, one letter, one number. */
export function validateCredentials(creds: Partial<Credentials>): string | null {
  const email = (creds.email ?? '').trim();
  const password = creds.password ?? '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Enter a valid email address.';
  if (email.length > 254) return 'That email address is too long.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 200) return 'Password must be at most 200 characters.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}
