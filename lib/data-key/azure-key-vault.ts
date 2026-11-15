import { getServerEnv } from "@/lib/env";
import {
  DataKeySourceError,
  type DataKeyMaterial,
  type DataKeyRing,
  type DataKeySource,
  type DataKeyUnavailableReason,
} from "@/lib/data-key/types";

/**
 * Loads the data key from Azure Key Vault (#1652). The server holds only
 * wrapped copies of the key (`<kekVersion>.<base64url ciphertext>`, made by
 * `npm run data-key:wrap`); the vault's own key, which never leaves the vault,
 * unwraps them. The unwrapped key is kept in memory by the keyring.
 *
 * Two HTTPS calls, each with a 10 second limit: a sign-in for the application
 * (client credentials), then one unwrap per wrapped key. No package is used.
 * A failure is a reason category only; response bodies, tokens and the client
 * secret are never put in an error or a log line.
 */

const REQUEST_TIMEOUT_MS = 10_000;
const API_VERSION = "7.4";
const KEY_BYTES = 32;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

type AzureEnv = {
  AZURE_KEY_VAULT_URL?: string;
  AZURE_KEY_VAULT_KEY_NAME?: string;
  AZURE_TENANT_ID?: string;
  AZURE_CLIENT_ID?: string;
  AZURE_CLIENT_SECRET?: string;
  DATA_ENCRYPTION_KEY_WRAPPED?: string;
  DATA_ENCRYPTION_KEY_VERSION?: number;
  DATA_ENCRYPTION_PREVIOUS_KEY_WRAPPED?: string;
  DATA_ENCRYPTION_PREVIOUS_KEY_VERSION?: number;
};

function reasonForStatus(status: number, step: "token" | "unwrap"): DataKeyUnavailableReason {
  // The sign-in endpoint answers 400 (or 404) for a wrong tenant or client id: a settings problem, not an unwrap problem.
  if (step === "token" && (status === 400 || status === 404)) return "misconfigured";
  if (status === 401 || status === 403) return "access-denied";
  if (status >= 500 || status === 408 || status === 429) return "vault-unreachable";
  return "unwrap-failed";
}

async function call(fetchImpl: FetchLike, url: string, init: RequestInit, step: "token" | "unwrap"): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new DataKeySourceError("vault-unreachable");
  }
  if (!response.ok) throw new DataKeySourceError(reasonForStatus(response.status, step));
  try {
    return await response.json();
  } catch {
    throw new DataKeySourceError("unwrap-failed");
  }
}

function stringField(body: unknown, name: string) {
  const value = (body as Record<string, unknown> | null)?.[name];
  if (typeof value !== "string" || !value) throw new DataKeySourceError("unwrap-failed");
  return value;
}

export function createAzureKeyVaultDataKeySource(options: { fetch?: FetchLike; env?: AzureEnv } = {}): DataKeySource {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  async function accessToken(env: AzureEnv) {
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.AZURE_CLIENT_ID ?? "",
      client_secret: env.AZURE_CLIENT_SECRET ?? "",
      scope: "https://vault.azure.net/.default",
    });
    const body = await call(
      fetchImpl,
      `https://login.microsoftonline.com/${encodeURIComponent(env.AZURE_TENANT_ID ?? "")}/oauth2/v2.0/token`,
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() },
      "token",
    );
    return stringField(body, "access_token");
  }

  async function unwrap(env: AzureEnv, token: string, wrapped: string, version: number): Promise<DataKeyMaterial> {
    const dot = wrapped.indexOf(".");
    const kekVersion = dot > 0 ? wrapped.slice(0, dot) : "";
    const ciphertext = dot > 0 ? wrapped.slice(dot + 1) : "";
    if (!/^[0-9a-fA-F]+$/.test(kekVersion) || !ciphertext) throw new DataKeySourceError("misconfigured");
    const vault = (env.AZURE_KEY_VAULT_URL ?? "").replace(/\/+$/, "");
    const body = await call(
      fetchImpl,
      `${vault}/keys/${encodeURIComponent(env.AZURE_KEY_VAULT_KEY_NAME ?? "")}/${kekVersion}/unwrapkey?api-version=${API_VERSION}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ alg: "RSA-OAEP-256", value: ciphertext }),
      },
      "unwrap",
    );
    const ikm = Buffer.from(stringField(body, "value"), "base64url");
    if (ikm.length !== KEY_BYTES) throw new DataKeySourceError("unwrap-failed");
    return { version, ikm };
  }

  return {
    async load(): Promise<DataKeyRing> {
      const env = options.env ?? getServerEnv();
      const required = [
        env.AZURE_KEY_VAULT_URL, env.AZURE_KEY_VAULT_KEY_NAME, env.AZURE_TENANT_ID,
        env.AZURE_CLIENT_ID, env.AZURE_CLIENT_SECRET, env.DATA_ENCRYPTION_KEY_WRAPPED,
      ];
      if (required.some((value) => !value)) throw new DataKeySourceError("misconfigured");
      const token = await accessToken(env);
      const current = await unwrap(env, token, env.DATA_ENCRYPTION_KEY_WRAPPED ?? "", env.DATA_ENCRYPTION_KEY_VERSION ?? 1);
      if (!env.DATA_ENCRYPTION_PREVIOUS_KEY_WRAPPED || env.DATA_ENCRYPTION_PREVIOUS_KEY_VERSION === undefined) {
        return { current };
      }
      // A previous key that fails must not lock everything: the current key alone still opens current values.
      try {
        const previous = await unwrap(env, token, env.DATA_ENCRYPTION_PREVIOUS_KEY_WRAPPED, env.DATA_ENCRYPTION_PREVIOUS_KEY_VERSION);
        return { current, previous };
      } catch (error) {
        return { current, previousProblem: error instanceof DataKeySourceError ? error.reason : "unwrap-failed" };
      }
    },
  };
}
