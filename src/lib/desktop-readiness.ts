import { getDesktopActivitySnapshot } from "@/lib/desktop-activity";
import { prisma } from "@/lib/db";

export async function getDesktopReadiness() {
  const [runningPosts, publishingLinks, publishingTopics, draftingLinks] = await Promise.all([
    prisma.post.count({ where: { status: "RUNNING" } }),
    prisma.brandLink.count({ where: { status: "PUBLISHING" } }),
    prisma.topicPostTask.count({ where: { status: "PUBLISHING" } }),
    prisma.brandLink.count({ where: { status: "DRAFTING" } }),
  ]);
  const desktopActivities = getDesktopActivitySnapshot();
  const activeCount = runningPosts + publishingLinks + publishingTopics + draftingLinks + desktopActivities.count;

  return {
    ready: activeCount === 0,
    activeCount,
    active: {
      posts: runningPosts,
      brandLinks: publishingLinks,
      draftingLinks,
      topicTasks: publishingTopics,
      processes: desktopActivities.count,
      processKinds: desktopActivities.activities.map((item) => item.label),
    },
  };
}
