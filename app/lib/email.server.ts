export type Email = { to: string; subject: string; body: string };

/**
 * "Sends" an email. There is no mail transport wired up yet, so the built
 * message goes to the server log.
 */
export function logEmail(email: Email): void {
  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);
}
