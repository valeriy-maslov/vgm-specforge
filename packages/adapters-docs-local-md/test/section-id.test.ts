import { describe, expect, it } from "vitest";
import { backfillMissingSectionIds, parseMarkdownSections } from "../src/section-id.js";

describe("section-id", () => {
  it("parses markdown sections and existing ids", () => {
    const markdown = [
      "# Root {#sec-root}",
      "",
      "## Intro",
      "### Details {#sec-details}",
    ].join("\n");

    const sections = parseMarkdownSections(markdown);
    expect(sections).toEqual([
      { line: 1, depth: 1, title: "Root", id: "sec-root" },
      { line: 3, depth: 2, title: "Intro" },
      { line: 4, depth: 3, title: "Details", id: "sec-details" },
    ]);
  });

  it("backfills missing ids with stable and unique values", () => {
    const markdown = [
      "# Root",
      "## Intro",
      "## Intro",
      "### Existing {#sec-existing}",
      "### Existing",
    ].join("\n");

    const result = backfillMissingSectionIds(markdown);

    expect(result.generated.map((entry) => entry.id)).toEqual([
      "sec-root",
      "sec-intro",
      "sec-intro-2",
      "sec-existing-2",
    ]);
    expect(result.markdown).toContain("# Root {#sec-root}");
    expect(result.markdown).toContain("## Intro {#sec-intro}");
    expect(result.markdown).toContain("## Intro {#sec-intro-2}");
  });
});
