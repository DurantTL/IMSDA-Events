/**
 * Draws the registration PDF (#1082) from a `RegistrationPdfModel`.
 *
 * Same approach as the invoice PDF: pdf-lib (pure JavaScript), the standard Helvetica fonts, no object streams, no
 * random ids and no clock (the creation and modification dates are the time the copy was made, passed in), so the same
 * input is the same bytes. The repository stores the first rendering and serves those bytes for every later send and
 * download. Text outside the standard fonts' Latin set is replaced with "?" rather than failing a send. English only.
 *
 * Letter paper, 54 pt margins. Headings follow the form's sections; the roster is a table whose heading row repeats on
 * each page; a roster with many columns is laid out one person per block instead of squeezing the columns. Version 2
 * and later carry an "UPDATED" mark and the date, so a copy can never be mistaken for the one it replaces.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { MARGIN, MUTED, PAGE, RULE, TEXT, Writer, formatPdfMoney } from "@/modules/invoices/invoice-pdf";
import type { RegistrationPdfModel, RegistrationPdfRoster } from "@/modules/registration-pdf/model";

export type RegistrationPdfRenderInput = {
  model: RegistrationPdfModel;
  /** True from the second version on: marks the document "UPDATED". */
  updated: boolean;
  /** When this copy was made, and the document's creation date. */
  generatedAt: Date;
  /** The event's own time zone, so the date reads as it did to staff. */
  timezone: string;
};

const ACCENT = rgb(0.1, 0.32, 0.5);
const BAND = rgb(0.94, 0.96, 0.97);
const MAX_TABLE_COLUMNS = 6;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

function formatDate(date: Date, timezone: string) {
  const options = { year: "numeric", month: "long", day: "numeric" } as const;
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
  }
}

/** Column widths for the table: the name column and short columns get what they need, long text shares the rest. */
function columnWidths(roster: RegistrationPdfRoster, font: PDFFont, bold: PDFFont, width: number) {
  const padding = 10;
  const natural = roster.columns.map((column, index) => {
    const longest = Math.max(
      bold.widthOfTextAtSize(column, 8.5),
      ...roster.rows.map((row) => font.widthOfTextAtSize((row[index] ?? "").slice(0, 60), 9)),
    );
    return Math.max(34, Math.min(longest + padding, index === 0 ? 170 : 150));
  });
  const total = natural.reduce((sum, value) => sum + value, 0);
  if (total <= width) {
    // Spread the spare room over the columns in proportion, so the table fills the page.
    const spare = width - total;
    return natural.map((value) => value + (spare * value) / total);
  }
  const scale = width / total;
  return natural.map((value) => value * scale);
}

/** Renders the registration. The same input always yields the same bytes. */
export async function renderRegistrationPdf(input: RegistrationPdfRenderInput): Promise<Uint8Array> {
  const { model } = input;
  const doc = await PDFDocument.create({ updateMetadata: false });
  const subject = [model.clubName ?? model.registrantName, model.eventName].filter(Boolean).join(" - ");
  doc.setTitle(`${input.updated ? "Updated registration" : "Registration"}: ${model.eventName}`);
  doc.setSubject(subject);
  doc.setAuthor("IMSDA Events");
  doc.setCreator("IMSDA Events");
  doc.setProducer("IMSDA Events");
  doc.setCreationDate(input.generatedAt);
  doc.setModificationDate(input.generatedAt);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, regular, bold);
  const madeOn = formatDate(input.generatedAt, input.timezone);

  // Title block: the event, then what this is, with the UPDATED mark at the right.
  w.text(model.eventName, { size: 18, font: bold, width: CONTENT_WIDTH - 130, lead: 23 });
  w.text(model.formTitle, { size: 11, color: MUTED, width: CONTENT_WIDTH - 130, lead: 15 });
  const afterTitle = w.y;
  if (input.updated) {
    const top = PAGE.height - MARGIN;
    const boxWidth = 118;
    const x = PAGE.width - MARGIN - boxWidth;
    w.page.drawRectangle({ x, y: top - 40, width: boxWidth, height: 40, borderColor: ACCENT, borderWidth: 1.4, color: BAND });
    const label = "UPDATED";
    w.page.drawText(label, { x: x + (boxWidth - bold.widthOfTextAtSize(label, 15)) / 2, y: top - 17, size: 15, font: bold, color: ACCENT });
    const dateLine = w.clean(madeOn);
    w.page.drawText(dateLine, { x: x + (boxWidth - regular.widthOfTextAtSize(dateLine, 9)) / 2, y: top - 33, size: 9, font: regular, color: TEXT });
  }
  w.y = Math.min(afterTitle, input.updated ? PAGE.height - MARGIN - 46 : afterTitle);
  w.gap(4);

  // Who and when.
  const facts: Array<[string, string]> = [];
  if (model.clubName) facts.push(["Club", model.clubName]);
  if (model.teamName) facts.push(["Team", model.teamName]);
  if (!model.clubName || model.registrantName.toLowerCase() !== model.clubName.toLowerCase()) facts.push([model.clubName ? "Contact" : "Registrant", model.registrantName]);
  if (model.eventDates) facts.push(["Dates", model.eventDates]);
  if (model.eventLocation) facts.push(["Location", model.eventLocation]);
  if (model.submittedOn) facts.push(["Submitted", model.submittedOn]);
  if (input.updated) facts.push(["This copy", `Updated ${madeOn}. It replaces any earlier copy.`]);
  const labelWidth = 84;
  w.page.drawRectangle({ x: MARGIN - 6, y: w.y - (facts.reduce((sum, [, value]) => sum + Math.max(1, w.wrap(value, regular, 10, CONTENT_WIDTH - labelWidth - 12).length) * 14, 0) + 10), width: CONTENT_WIDTH + 12, height: facts.reduce((sum, [, value]) => sum + Math.max(1, w.wrap(value, regular, 10, CONTENT_WIDTH - labelWidth - 12).length) * 14, 0) + 10, color: BAND });
  w.gap(5);
  for (const [label, value] of facts) {
    const lines = w.wrap(value, regular, 10, CONTENT_WIDTH - labelWidth - 12);
    w.ensure(lines.length * 14);
    w.page.drawText(w.clean(label), { x: MARGIN, y: w.y - 10, size: 9, font: bold, color: MUTED });
    lines.forEach((line, index) => w.page.drawText(line, { x: MARGIN + labelWidth, y: w.y - 10 - index * 14, size: 10, font: regular, color: TEXT }));
    w.y -= Math.max(1, lines.length) * 14;
  }
  w.gap(10);

  const heading = (title: string, description: string) => {
    w.ensure(60);
    w.gap(6);
    w.text(title, { size: 13, font: bold, color: ACCENT, lead: 17 });
    w.page.drawLine({ start: { x: MARGIN, y: w.y + 1 }, end: { x: PAGE.width - MARGIN, y: w.y + 1 }, thickness: 1, color: ACCENT });
    w.gap(5);
    if (description) {
      w.text(description, { size: 9, color: MUTED, lead: 12 });
      w.gap(3);
    }
  };

  const answerRows = (rows: Array<{ label: string; value: string }>) => {
    const answerLabelWidth = 190;
    const valueX = MARGIN + answerLabelWidth + 10;
    const valueWidth = PAGE.width - MARGIN - valueX;
    for (const row of rows) {
      const labelLines = w.wrap(row.label, bold, 9.5, answerLabelWidth);
      const valueLines = w.wrap(row.value, regular, 10, valueWidth);
      const count = Math.max(labelLines.length, valueLines.length, 1);
      w.ensure(Math.min(count, 3) * 13 + 6);
      const top = w.y;
      // A long answer can run past a page: draw it line by line, moving to a new page when the room runs out.
      const startPage = w.page;
      labelLines.forEach((line, index) => {
        if (w.page === startPage) w.page.drawText(line, { x: MARGIN, y: top - 10 - index * 13, size: 9.5, font: bold, color: MUTED });
      });
      let y = top;
      for (const line of valueLines) {
        if (y - 13 < MARGIN + 24) {
          w.newPage();
          y = w.y;
        }
        w.page.drawText(line, { x: valueX, y: y - 10, size: 10, font: regular, color: TEXT });
        y -= 13;
      }
      w.y = Math.min(y, top - labelLines.length * 13) - 5;
      w.page.drawLine({ start: { x: MARGIN, y: w.y + 2 }, end: { x: PAGE.width - MARGIN, y: w.y + 2 }, thickness: 0.4, color: RULE });
    }
  };

  const rosterTable = (roster: RegistrationPdfRoster) => {
    if (roster.columns.length > MAX_TABLE_COLUMNS) {
      // Too many questions for columns: one block per person, each question on its own line.
      roster.rows.forEach((row, rowIndex) => {
        w.ensure(40);
        w.gap(4);
        w.text(`${rowIndex + 1}. ${row[0] ?? ""}`, { size: 10.5, font: bold, lead: 15 });
        answerRows(roster.columns.slice(1).flatMap((column, index) => ((row[index + 1] ?? "") ? [{ label: column, value: row[index + 1]! }] : [])));
      });
      w.text(roster.countLabel, { size: 9, color: MUTED });
      return;
    }
    const widths = columnWidths(roster, regular, bold, CONTENT_WIDTH - 24);
    const numberWidth = 24;
    const xs: number[] = [];
    let cursor = MARGIN + numberWidth;
    for (const width of widths) {
      xs.push(cursor);
      cursor += width;
    }
    const header = () => {
      w.ensure(40);
      w.page.drawRectangle({ x: MARGIN, y: w.y - 16, width: CONTENT_WIDTH, height: 18, color: BAND });
      w.page.drawText("#", { x: MARGIN + 4, y: w.y - 12, size: 8.5, font: bold, color: MUTED });
      roster.columns.forEach((column, index) => {
        const lines = w.wrap(column, bold, 8.5, widths[index]! - 8);
        w.page.drawText(lines[0] ?? "", { x: xs[index]!, y: w.y - 12, size: 8.5, font: bold, color: MUTED });
      });
      w.y -= 20;
    };
    header();
    roster.rows.forEach((row, rowIndex) => {
      const cells = row.map((cell, index) => w.wrap(cell, index === 0 ? bold : regular, 9, widths[index]! - 8));
      const lines = Math.max(1, ...cells.map((cell) => cell.length));
      if (w.y - (lines * 12 + 6) < MARGIN + 24) {
        w.newPage();
        header();
      }
      const top = w.y;
      w.page.drawText(String(rowIndex + 1), { x: MARGIN + 4, y: top - 10, size: 8.5, font: regular, color: MUTED });
      cells.forEach((cell, index) => cell.forEach((line, lineIndex) => (
        w.page.drawText(line, { x: xs[index]!, y: top - 10 - lineIndex * 12, size: 9, font: index === 0 ? bold : regular, color: TEXT })
      )));
      w.y -= lines * 12 + 5;
      w.page.drawLine({ start: { x: MARGIN, y: w.y + 2 }, end: { x: PAGE.width - MARGIN, y: w.y + 2 }, thickness: 0.4, color: RULE });
    });
    w.gap(3);
    w.text(roster.countLabel, { size: 9, color: MUTED });
  };

  for (const section of model.sections) {
    heading(section.title, section.description);
    if (section.rows.length > 0) answerRows(section.rows);
    if (section.roster) {
      if (section.rows.length > 0) w.gap(6);
      rosterTable(section.roster);
    }
  }

  // Fees: the lines, the total and what was owed when this copy was made. A church-billed registration shows the
  // per-person price only, never a total (#621).
  if (model.fees) {
    heading("Fees", "");
    if (model.fees.kind === "CHURCH_BILLED") {
      for (const line of model.fees.lines) w.text(line, { size: 10 });
    } else {
      const amountEdge = PAGE.width - MARGIN;
      if (model.fees.lines.length === 0) w.text("No fees on this registration.", { size: 10, color: MUTED });
      for (const line of model.fees.lines) {
        const labelLines = w.wrap(line.label, regular, 10, CONTENT_WIDTH - 100);
        w.ensure(labelLines.length * 13 + 4);
        const top = w.y;
        labelLines.forEach((text, index) => w.page.drawText(text, { x: MARGIN, y: top - 10 - index * 13, size: 10, font: regular, color: TEXT }));
        w.right(formatPdfMoney(line.amountCents), { rightEdge: amountEdge, y: top });
        w.y -= labelLines.length * 13 + 3;
      }
      w.rule(3);
      const totalRow = (label: string, cents: number, strong = false) => {
        w.ensure(22);
        const size = strong ? 12 : 10;
        const font = strong ? bold : regular;
        w.page.drawText(label, { x: MARGIN, y: w.y - size, size, font, color: TEXT });
        w.right(formatPdfMoney(cents), { size, font, rightEdge: amountEdge, y: w.y });
        w.y -= strong ? 20 : 16;
      };
      totalRow("Total", model.fees.totalCents);
      if (model.fees.paidCents !== 0) totalRow("Paid when this copy was made", -model.fees.paidCents);
      totalRow("Amount owed when this copy was made", model.fees.owedCents, true);
    }
  }

  // Footers, now the page count is known.
  const total = w.pages.length;
  w.pages.forEach((page, index) => {
    const who = model.clubName ?? model.registrantName;
    const footer = w.clean(`${model.eventName}  |  ${who}${input.updated ? "  |  UPDATED " + madeOn : ""}  |  Page ${index + 1} of ${total}`);
    page.drawText(footer, { x: MARGIN, y: MARGIN - 8, size: 8, font: regular, color: MUTED });
  });

  return doc.save({ useObjectStreams: false, addDefaultPage: false });
}
