/** One object in the backup bucket, as the listing reports it. */
export type BackupObject = {
  key: string;
  lastModified: Date;
  size: number | null;
};

export type R2ReadConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  prefix: string;
};

export type R2ReadConfigState =
  | { state: "not_connected" }
  /** Some of the settings are set. Names only, never values. */
  | { state: "misconfigured"; missing: string[]; invalid: string[] }
  | { state: "connected"; config: R2ReadConfig };

export type BackupListing = {
  objects: BackupObject[];
  /** True when the page cap was reached or the listing ended early, so newer objects may exist. */
  partial: boolean;
};

export type R2ListFailure = "refused" | "timeout" | "unreachable" | "bad_response";
