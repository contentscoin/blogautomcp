export interface TopicCandidate {
  title: string;
  subtopics: { subtitle: string; summary: string }[];
  content: string;
  image_prompt: string;
  hashtags: string[];
}

const isText = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maximum;

/** Validate both generated API responses and client input before rendering or queuing. */
export function isTopicCandidateList(value: unknown): value is TopicCandidate[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 10 && value.every((topic: unknown) => {
    if (!topic || typeof topic !== "object") return false;
    const item = topic as Record<string, unknown>;
    return isText(item.title, 200) && isText(item.content, 20_000) && isText(item.image_prompt, 2_000)
      && Array.isArray(item.subtopics) && item.subtopics.length > 0 && item.subtopics.length <= 12
      && item.subtopics.every((part: unknown) => {
        if (!part || typeof part !== "object") return false;
        const section = part as Record<string, unknown>;
        return isText(section.subtitle, 200) && isText(section.summary, 2_000);
      })
      && Array.isArray(item.hashtags) && item.hashtags.length <= 30
      && item.hashtags.every((tag: unknown) => isText(tag, 100));
  });
}
