/** The one-field form on the certificate check page (#2052): a plain GET form, so it works without scripts. */
export function CertificateCheckForm({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <form action="/verify" className="auth-form" method="get">
      <label>
        Verification number
        <input autoCapitalize="characters" autoComplete="off" defaultValue={defaultValue} inputMode="text" name="code" placeholder="XXXX-XXXX" required spellCheck={false} type="text" />
      </label>
      <button className="primary-button" type="submit">Check</button>
    </form>
  );
}
