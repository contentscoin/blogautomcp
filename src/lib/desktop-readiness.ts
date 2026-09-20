import { getDesktopActivitySnapshot } from "@/lib/desktop-activity";
import { prisma } from "@/lib/db";
import { hasPendingRemoteCompletions } from "@/lib/remote-agent-completion";
import { getUserDataRoot } from "../../scripts/lib/app-paths";

export async function getDesktopReadiness() {
  const [runningPosts, publishingLinks, publishingTopics, draftingLinks] = await Promise.all([
    prisma.post.count({ where: { status: "RUNNING" } }),
    prisma.brandLink.count({ where: { status: "PUBLISHING" } }),
    prisma.topicPostTask.count({ where: { status: "PUBLISHING" } }),
    prisma.brandLink.count({ where: { status: "DRAFTING" } }),
  ]);
  const desktopActivities = getDesktopActivitySnapshot();
  const pendingRemoteCompletions = hasPendingRemoteCompletions(getUserDataRoot());
  const activeCount = runningPosts + publishingLinks + publishingTopics + draftingLinks + desktopActivities.count + Number(pendingRemoteCompletions);

  return {
    ready: activeCount === 0,
    activeCount,
    active: {
      posts: runningPosts,
      brandLinks: publishingLinks,
      draftingLinks,
      topicTasks: publishingTopics,
      processes: desktopActivities.count,
      pendingRemoteCompletions,
      processKinds: desktopActivities.activities.map((item) => item.label),
    },
  };
}
