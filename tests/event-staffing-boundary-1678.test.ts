import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The staffing sheet holds names of people on an event, minors included (#1678). It creates no account, person or registration,
 * stores no name or contact detail, and the only reader that is neither staff nor an Area Coordinator is the person's own
 * assignment list. These read the boundary's source, so a later change that crosses a line fails here.
 */

const root = process.cwd();
const dir = join(root, "modules/event-staffing");
const sources = readdirSync(dir).filter((name) => name.endsWith(".ts")).map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
const get = (name: string) => sources.find((source) => source.name === name)!.text;
const importsOf = (text: string) => [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);

describe("the event staffing boundary", () => {
  it("has the domain, access, repository, settings and own-assignment files", () => {
    expect(sources.map((source) => source.name)).toEqual(expect.arrayContaining(["domain.ts", "access.ts", "repository.ts", "settings.ts", "own-assignments.ts", "api-errors.ts"]));
  });

  it("writes only activities, assignments and the audit log, and never a person, account, registration or payment", () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/\.(person|attendeeAccount|user|registration|registrationAttendee|eventMembership|payment|invoice|ledgerEntry)\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/);
      for (const specifier of importsOf(text)) {
        expect(specifier, `${name} imports ${specifier}`).not.toMatch(/modules\/(payments|invoices|ledger|refunds|accounts|attendee-accounts\/(service|mutations)|registrations\/(service|mutations|operations))/);
      }
    }
    const writes = [...get("repository.ts").matchAll(/\b(tx|prisma|getPrisma\(\))\.(\w+)\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/g)].map((match) => match[2]);
    expect(new Set(writes)).toEqual(new Set(["eventStaffingActivity", "eventStaffingAssignment"]));
    expect(get("own-assignments.ts")).not.toMatch(/\.(create|update|delete|upsert)/);
  });

  it("stores no name, contact detail or age: the tables hold ids, a role and the activity's own text", () => {
    const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
    for (const model of ["EventStaffingActivity", "EventStaffingAssignment"]) {
      const text = new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`).exec(schema)![0];
      expect(text, model).not.toMatch(/firstName|lastName|email|phone|birth|age\b|health|address/i);
    }
  });

  it("keeps names, activity text and every free field out of the audit log", () => {
    const repository = get("repository.ts");
    const auditBlock = /async function audit\([\s\S]*?\n\}/.exec(repository)![0];
    expect(auditBlock).not.toMatch(/name|description|location|timeText/i);
    for (const call of repository.matchAll(/metadata: \{[^}]*\}/g)) {
      expect(call[0], call[0]).not.toMatch(/\bname\b|description|location|timeText|displayName|firstName|lastName|email/);
    }
  });

  it("builds the CSV from name, activity and role only", () => {
    const domain = get("domain.ts");
    const csv = /export function staffingCsv[\s\S]*$/.exec(domain)![0];
    expect(csv).not.toMatch(/email|phone|birth|age\b|health|contact/i);
  });

  it("is read by the person themselves only through the own-assignment list, and that list is used on the account front page alone", () => {
    const users: string[] = [];
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && readFileSync(path, "utf8").includes("event-staffing/own-assignments")) users.push(path.slice(root.length + 1).split("\\").join("/"));
      }
    };
    for (const folder of ["app", "components", "modules"]) walk(join(root, folder));
    expect(users.sort()).toEqual(["app/(public)/account/(portal)/page.tsx", "components/my-event-staffing.tsx"].sort());
  });

  it("has no upload and no free-text role: the roles are a short fixed list", () => {
    for (const { name, text } of sources) expect(text, name).not.toMatch(/asset-storage|putObject|multipart|formData\(|FormData|type="file"/);
    const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
    expect(/enum EventStaffingRole \{([^}]*)\}/.exec(schema)![1]!.split(/\s+/).filter(Boolean)).toEqual(["LEAD", "HELPER", "LIFEGUARD", "TLT"]);
  });
});
