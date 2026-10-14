import { describe, expect, it } from "vitest";
import {
  buildOperationalReport,
  type OperationalReportRegistration,
} from "@/modules/reporting/operational-reports";
import { buildEventPacketGroups } from "@/modules/reporting/event-packets";
import * as legacyPackets from "@/modules/reporting/retreat-packets";
import * as currentPackets from "@/modules/reporting/event-packets";
import {
  defaultEventPacketConfig,
  parseEventPacketConfig,
} from "@/modules/reporting/event-packet-config";
import type { RegistrationRecord } from "@/modules/registrations/repository";

const definition = {
  title: "Women’s Retreat",
  description: "",
  confirmationMessage: "Registered.",
  sections: [{
    id: "group",
    title: "Church",
    description: "",
    fields: [{
      id: "church",
      key: "church",
      label: "Home church",
      helpText: "",
      type: "SELECT",
      scope: "REGISTRATION",
      required: true,
      options: ["Central", "Other"],
    }, {
      id: "allergy",
      key: "allergy",
      label: "Medical allergies",
      helpText: "",
      type: "LONG_TEXT",
      scope: "ATTENDEE",
      required: false,
      options: [],
    }],
  }],
} as const;

function registration(): RegistrationRecord {
  return {
    id: "registration-1",
    confirmationCode: "WR-001",
    status: "CONFIRMED",
    totalAmountCents: 25000,
    paidCents: 25000,
    balanceCents: 0,
    onlinePaymentUnavailable: false,
    isDeferredOrganizationBilling: false,
    isGroup: false,
    submittedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    accountHolder: {
      id: "person-1",
      firstName: "Ana",
      lastName: "Rivera",
      email: "ana@example.org",
      phone: "555-0100",
    },
    attendees: [{
      id: "attendee-1",
      firstName: "Ana",
      lastName: "Rivera",
      email: "ana@example.org",
      phone: "555-0100",
      attendeeType: "Adult",
      position: 0,
      source: "PUBLIC_REGISTRATION",
      responses: { shirt_size: "Adult M", allergy: "PRIVATE-ALLERGY" },
      checkedIn: false,
      checkInId: null,
      checkedInAt: null,
    }],
    attendeeType: "Adult",
    attendeeCount: 1,
    checkedInCount: 0,
    payments: [],
    adjustments: [],
    messages: [],
    publicSubmission: {
      formName: "Women’s Retreat",
      formSlug: "womens-retreat",
      versionNumber: 1,
      responses: { church: "Central" },
      originalResponses: { church: "Central" },
      attendeeResponses: [{ shirt_size: "Adult M", allergy: "PRIVATE-ALLERGY" }],
      definition,
      rosterEnabled: true,
      pricingSnapshot: {},
      originalPricingSnapshot: {},
      submittedAt: "2026-01-01T00:00:00.000Z",
      amendedAt: null as never,
      amendmentOperationId: null as never,
    },
  };
}

describe("grouped event packets", () => {
  it("combines group contacts, shirt sizes, arrival state, and current assignments", () => {
    const source = registration();
    const report = buildOperationalReport([source as OperationalReportRegistration]);
    const packets = buildEventPacketGroups(
      [source],
      report.rosterGroups,
      [{ fieldLabel: "Seminar", attendeeId: "attendee-1", option: "Prayer" }],
    );

    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({
      label: "Central",
      registrations: [{
        confirmationCode: "WR-001",
        email: "ana@example.org",
      }],
      attendees: [{
        firstName: "Ana",
        shirtSize: "Adult M",
        checkedIn: false,
        assignments: [{ label: "Seminar", option: "Prayer" }],
      }],
    });
    expect(JSON.stringify(packets)).not.toContain("PRIVATE-ALLERGY");
  });
});

describe("event-neutral packets (#155)", () => {
  function campRegistration() {
    const source = registration();
    const campDefinition = {
      ...definition,
      title: "Spring Camporee",
      sections: [{
        ...definition.sections[0],
        fields: [
          { ...definition.sections[0].fields[0], id: "club", key: "club", label: "Club name", options: ["Eagles", "Falcons"] },
          { id: "church", key: "church", label: "Home church", helpText: "", type: "SELECT", scope: "REGISTRATION", required: false, options: ["Central", "Eastside"] },
          definition.sections[0].fields[1],
        ],
      }],
    };
    return {
      ...source,
      publicSubmission: {
        ...source.publicSubmission!,
        formName: "Spring Camporee",
        responses: { club: "Eagles", church: "Central" },
        definition: campDefinition as never,
      },
    };
  }

  it("builds packets for a non-retreat event and groups by the event's chosen field", () => {
    const source = campRegistration();
    const auto = buildOperationalReport([source as OperationalReportRegistration]);
    expect(auto.rosterGroups[0].label).toBe("Eagles");

    const byChurch = buildOperationalReport(
      [source as OperationalReportRegistration],
      { groupingFieldKey: "church" },
    );
    expect(byChurch.rosterGroups[0]).toMatchObject({ label: "Central", fieldLabel: "Home church" });

    const unknown = buildOperationalReport(
      [source as OperationalReportRegistration],
      { groupingFieldKey: "no_such_field" },
    );
    expect(unknown.rosterGroups[0].label).toBe("Eagles");

    const packets = buildEventPacketGroups([source], byChurch.rosterGroups, []);
    expect(packets[0].label).toBe("Central");
  });

  it("omits a disabled section's data and never groups by a sensitive field", () => {
    const source = registration();
    const report = buildOperationalReport([source as OperationalReportRegistration]);
    const config = parseEventPacketConfig({
      sections: { shirtSize: false, assignedSessions: false, planningTotals: false },
    });
    expect(config.sections).toMatchObject({
      shirtSize: false,
      assignedSessions: false,
      planningTotals: false,
      registrationContacts: true,
    });
    const [packet] = buildEventPacketGroups(
      [source],
      report.rosterGroups,
      [{ fieldLabel: "Seminar", attendeeId: "attendee-1", option: "Prayer" }],
      config,
    );
    expect(packet.attendees[0].shirtSize).toBeNull();
    expect(packet.attendees[0].assignments).toEqual([]);
    expect(packet.mealCounts).toEqual([]);
    expect(packet.housingCounts).toEqual([]);

    const sensitive = buildOperationalReport(
      [source as OperationalReportRegistration],
      { groupingFieldKey: "allergy" },
    );
    expect(sensitive.rosterGroups[0].label).toBe("Central");
  });

  it("defaults unreadable stored config to the Women's Retreat layout", () => {
    expect(parseEventPacketConfig(null)).toEqual(defaultEventPacketConfig);
    expect(parseEventPacketConfig({ sections: { shirtSize: "yes" } })).toEqual(defaultEventPacketConfig);
    expect(parseEventPacketConfig("junk")).toEqual(defaultEventPacketConfig);
    expect(defaultEventPacketConfig.sections.shirtSize).toBe(true);
  });

  it("keeps the pre-#155 retreat names resolvable", () => {
    expect(legacyPackets.buildRetreatPacketGroups).toBe(currentPackets.buildEventPacketGroups);
  });
});
