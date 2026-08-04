export function isAllowedEmail(email: string | null | undefined): boolean {
  const allowed = process.env.AUTH_ALLOWED_EMAIL;
  if (!allowed || !email) return false;
  return email.toLowerCase() === allowed.toLowerCase();
}
