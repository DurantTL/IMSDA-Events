/**
 * The short reason shown under a disabled button (#1003). A disabled button
 * cannot take focus or be hovered, so the reason has to sit in the page: the
 * button points at it with `aria-describedby`, only while it is disabled.
 *
 *   <button aria-describedby={disabledHintId(reason, "x-hint")} disabled={reason !== null}>
 *   <DisabledHint id="x-hint" reason={reason} />
 */
export function disabledHintId(reason: string | null | undefined, id: string): string | undefined {
  return reason ? id : undefined;
}

export function DisabledHint({ id, reason }: { id: string; reason: string | null | undefined }) {
  if (!reason) return null;
  return <p className="disabled-hint" id={id}>{reason}</p>;
}
