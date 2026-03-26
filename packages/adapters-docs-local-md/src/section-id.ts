export interface MarkdownSection {
  line: number;
  depth: number;
  title: string;
  id?: string;
}

export interface GeneratedSectionId {
  line: number;
  title: string;
  id: string;
}

export interface BackfillSectionIdsResult {
  markdown: string;
  generated: GeneratedSectionId[];
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)(?:\s+\{#([A-Za-z0-9._:-]+)\})?\s*$/;

export function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const lines = markdown.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const match = line.match(HEADING_PATTERN);
    if (match === null) {
      continue;
    }

    const hashes = match[1] ?? "";
    const title = (match[2] ?? "").trim();
    const id = match[3]?.trim();
    const section: MarkdownSection = {
      line: index + 1,
      depth: hashes.length,
      title,
    };
    if (id !== undefined && id.length > 0) {
      section.id = id;
    }
    sections.push(section);
  }

  return sections;
}

export function backfillMissingSectionIds(markdown: string): BackfillSectionIdsResult {
  const lines = markdown.split(/\r?\n/);
  const usedIds = new Set<string>();

  for (const section of parseMarkdownSections(markdown)) {
    if (section.id !== undefined) {
      usedIds.add(section.id);
    }
  }

  const generated: GeneratedSectionId[] = [];
  const updatedLines = lines.map((line, index) => {
    const match = line.match(HEADING_PATTERN);
    if (match === null) {
      return line;
    }

    const hashes = match[1] ?? "";
    const title = (match[2] ?? "").trim();
    const id = match[3]?.trim();

    if (id !== undefined && id.length > 0) {
      return `${hashes} ${title} {#${id}}`;
    }

    const generatedId = generateSectionId(title, usedIds);
    usedIds.add(generatedId);
    generated.push({
      line: index + 1,
      title,
      id: generatedId,
    });

    return `${hashes} ${title} {#${generatedId}}`;
  });

  return {
    markdown: updatedLines.join("\n"),
    generated,
  };
}

export function generateSectionId(title: string, usedIds: ReadonlySet<string>): string {
  const slug = slugify(title);
  const base = `sec-${slug.length > 0 ? slug : "section"}`;

  if (!usedIds.has(base)) {
    return base;
  }

  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (usedIds.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
}
