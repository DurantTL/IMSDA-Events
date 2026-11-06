import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEALED_COLUMNS, SEALING_INFRASTRUCTURE_FILES } from "@/modules/security/sealed-columns";

const root = process.cwd();
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".next", ".git", ".claude", "tests", "scripts", "coverage", "prisma"]);

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(name)) continue;
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) found.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return found;
}

// `sealSecret(` does not match `sealSecretWithKey(`: operator tools are not sealing call sites.
const SEALING_CALL = /\b(sealSecret|fingerprintSecret)\(/;

describe("sealed column registry (#1516)", () => {
  const registeredFiles = new Set<string>([
    ...SEALED_COLUMNS.flatMap((column) => column.sourceFiles),
    ...SEALING_INFRASTRUCTURE_FILES,
  ]);

  it("covers every file that seals or fingerprints a value", () => {
    const callers = sourceFiles(root).filter((file) => SEALING_CALL.test(readFileSync(path.join(root, file), "utf8")));
    expect(callers.length).toBeGreaterThan(8);
    const missing = callers.filter((file) => !registeredFiles.has(file));
    expect(
      missing,
      "These files call sealSecret/fingerprintSecret but are not in modules/security/sealed-columns.ts. Add their column there so key rotation and key:check cover it.",
    ).toEqual([]);
  });

  it("names only files that exist and still seal something", () => {
    for (const file of registeredFiles) {
      const text = readFileSync(path.join(root, file), "utf8");
      if (SEALING_INFRASTRUCTURE_FILES.includes(file) && file !== "modules/security/key-rotation.ts") continue;
      expect(SEALING_CALL.test(text) || /\b(sealBirthDate|sealSensitiveAnswers)\b|function seal/.test(text), file).toBe(true);
    }
  });

  it("covers every sealed* column in the Prisma schema", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const found: string[] = [];
    let model = "";
    for (const line of schema.split("\n")) {
      const start = line.match(/^model (\w+) \{/);
      if (start) model = start[1];
      const field = line.match(/^\s+(sealed\w+)\s/);
      if (field && model) found.push(`${model}.${field[1]}`);
    }
    expect(found.length).toBeGreaterThan(8);
    const registered = SEALED_COLUMNS.map((column) => `${column.schemaModel}.${column.column}`);
    expect(found.filter((entry) => !registered.includes(entry))).toEqual([]);
    expect(registered.filter((entry) => !found.includes(entry))).toEqual([]);
  });

  it("builds the purpose each owning module uses", () => {
    const purposeOf = (label: string, row: Record<string, unknown>) =>
      SEALED_COLUMNS.find((column) => column.label === label)!.purpose(row);
    expect(purposeOf("HealthRecordField.sealedValue", { recordId: "r1", fieldKey: "f1" })).toBe("health-record:r1:f1");
    expect(purposeOf("HealthRecordSnapshotField.sealedValue", { snapshotId: "s1", fieldKey: "f1" })).toBe("health-snapshot:s1:f1");
    expect(purposeOf("ClubFormSubmission.sealedSensitiveAnswers", { id: "c1" })).toBe("club-form:sensitive-answers:c1");
    expect(purposeOf("AttendeeStepUpCode.sealedCode", { purpose: "SIGN_IN" })).toBe("attendee-sign-in-code");
    expect(purposeOf("AttendeeStepUpCode.sealedCode", { purpose: "TWO_STEP_RECOVERY" })).toBe("attendee-two-step-recovery");
    expect(purposeOf("AttendeeStepUpCode.sealedCode", { purpose: "REGISTRATION_EDIT" })).toBe("attendee-step-up-code");
    expect(purposeOf("CalendarFeed.sealedUrl", {})).toBe("calendar-feed-url");
  });
});
