export function parsePreparedBrandPostSections(markdown: string): string[] {
  const visibleMarkdown = markdown
    .split(/^##\s+Sources\s*$/m)[0]
    .replace(/<!--[\s\S]*?-->/g, "")
    // 해시태그는 매니페스트에서 별도로 복원한다. 마지막 본문에 합쳐지면
    // 발행 직전 품질검사가 마지막 결론 문단을 고지 문구로 오인한다.
    .replace(/\n+(?:#[^\r\n#]+(?:\s+|$))+$/u, "")
    .trim();
  const withoutTitle = visibleMarkdown.replace(/^#\s+.+\r?\n+/, "");
  const chunks = withoutTitle.split(/^##\s+/m);
  const intro = chunks.shift()?.replace(/!\[[^\]]*\]\([^\)]+\)/g, "").trim() || "";
  const parsedSections = chunks.map((chunk) => {
    const [heading = "", ...bodyLines] = chunk.split(/\r?\n/);
    const body = bodyLines
      .join("\n")
      .replace(/!\[[^\]]*\]\([^\)]+\)/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return [heading.trim(), body].filter(Boolean).join("\n\n");
  }).filter(Boolean);

  const sections = [...(intro ? [`여행 전 확인\n\n${intro}`] : [])];
  for (const section of parsedSections) {
    const disclosureMatch = section.match(/(?:^|\n)(이 포스팅은 네이버 (?:쇼핑|여행) 커넥트 활동의 일환으로[\s\S]*)$/u);
    if (!disclosureMatch || disclosureMatch.index === undefined) {
      sections.push(section);
      continue;
    }
    const editorialBody = section.slice(0, disclosureMatch.index).trim();
    const disclosure = disclosureMatch[1].trim();
    if (editorialBody) sections.push(editorialBody);
    if (disclosure) sections.push(disclosure);
  }
  return sections;
}
