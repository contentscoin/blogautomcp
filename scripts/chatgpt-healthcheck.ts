import "dotenv/config";
import {
  createChatGPTContext,
  openChatGPTTarget,
} from "./lib/chatgpt-browser";

const targets = [
  {
    label: "ChatGPT",
    url: "https://chatgpt.com/",
  },
];

async function main() {
  const handle = await createChatGPTContext(true);
  try {
    const page = await handle.context.newPage();
    const results: Array<{ label: string; ok: boolean; url: string; error?: string }> = [];

    for (const target of targets) {
      try {
        await openChatGPTTarget(page, target.url, `ChatGPT healthcheck:${target.label}`);
        results.push({
          label: target.label,
          ok: true,
          url: target.url,
        });
      } catch (error) {
        results.push({
          label: target.label,
          ok: false,
          url: target.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const allOk = results.every((entry) => entry.ok);
    process.stdout.write(
      JSON.stringify(
        {
          ok: allOk,
          checkedAt: new Date().toISOString(),
          results,
        },
        null,
        2,
      ),
    );

    if (!allOk) {
      process.exitCode = 1;
    }
  } finally {
    await handle.close().catch(() => {});
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
