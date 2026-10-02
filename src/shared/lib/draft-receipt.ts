export type DraftCopy = { value: string | null; valueVersion?: string };
export type DraftReceipt = { acknowledgedVersion?: string; acknowledgedValue?: string };

/** Opaque revision IDs identify exact submitted copies without retaining their bodies. */
export function copyIdentity(copy: DraftCopy): string | null {
  if (copy.value === null) return null;
  return copy.valueVersion === undefined ? 'legacy:' + copy.value : 'version:' + copy.valueVersion;
}
export function receiptIdentity(receipt: DraftReceipt): string | null {
  if (receipt.acknowledgedVersion !== undefined) return 'version:' + receipt.acknowledgedVersion;
  return receipt.acknowledgedValue === undefined ? null : 'legacy:' + receipt.acknowledgedValue;
}
export function receiptFor(copy: DraftCopy): DraftReceipt {
  if (copy.value === null) return {};
  // Preserve compatibility when acknowledging a record written by a previous client.
  return copy.valueVersion === undefined
    ? { acknowledgedValue: copy.value }
    : { acknowledgedVersion: copy.valueVersion };
}
export function acknowledgesCopy(receipt: DraftReceipt, copy: DraftCopy): boolean {
  const identity = copyIdentity(copy);
  return identity !== null && receiptIdentity(receipt) === identity;
}
