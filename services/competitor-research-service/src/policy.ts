export function requiresHumanApproval(): boolean {
  // Research reports are private deliverables — no public publish gate.
  return false;
}
