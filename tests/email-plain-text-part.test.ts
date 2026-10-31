import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "@/modules/communications/email-html";

describe("markdownToPlainText (#1411 A6)", () => {
  it("flattens headings, bold and links in the text part", () => {
    const source = [
      "# We received your registration",
      "",
      "- **Confirmation code:** ABC123",
      "",
      "[View, pay, or edit your registration](https://events.example.test/manage/tok)",
    ].join("\n");
    expect(markdownToPlainText(source)).toBe([
      "We received your registration",
      "",
      "- Confirmation code: ABC123",
      "",
      "View, pay, or edit your registration: https://events.example.test/manage/tok",
    ].join("\n"));
  });

  it("drops italic underscores but keeps snake_case and URLs intact", () => {
    expect(markdownToPlainText("Please _read_ this.")).toBe("Please read this.");
    expect(markdownToPlainText("Code my_code_1 at https://x.example.test/a_b_c")).toBe(
      "Code my_code_1 at https://x.example.test/a_b_c",
    );
  });

  it("prints a bare URL once when the label is the URL, and leaves plain text alone", () => {
    expect(markdownToPlainText("[https://a.example.test](https://a.example.test)")).toBe("https://a.example.test");
    expect(markdownToPlainText("Hello Mary-Ann.\nSee you soon.")).toBe("Hello Mary-Ann.\nSee you soon.");
  });
});
