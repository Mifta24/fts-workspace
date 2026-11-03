/**
 * Who must have two-step sign-in (ADR-025). A session of a user who has it always passed the code
 * step, so checking the flag on the user is enough. Operators always need it; owners only while
 * `MFA_REQUIRED_FOR_OWNERS` is on.
 */
export function mfaRequired(input: {
  twoFactorEnabled: boolean;
  isOperator?: boolean;
  isOwner?: boolean;
  ownersRequired?: boolean;
}): boolean {
  if (input.twoFactorEnabled) return false;
  return Boolean(input.isOperator) || Boolean(input.isOwner && input.ownersRequired);
}
