export type ChatGptBrowserVisibility = "background" | "visible" | "headless";

type BrowserVisibilityEnv = Record<string, string | undefined>;

export interface ChatGptBrowserLaunchPolicy {
  visibility: ChatGptBrowserVisibility;
  headless: boolean;
  slowMo: number;
  args: string[];
}

const BACKGROUND_CHROMIUM_ARGS = [
  "--start-minimized",
  "--window-position=-32000,-32000",
  "--window-size=1440,960",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
];

/**
 * Normal desktop work uses a real Chromium window outside the visible desktop.
 * This is more compatible with an existing consumer ChatGPT session than true
 * headless mode, while still keeping the automation out of the user's way.
 */
export function resolveChatGptBrowserVisibility(
  env: BrowserVisibilityEnv = process.env,
): ChatGptBrowserVisibility {
  const requested = env.CHATGPT_BROWSER_VISIBILITY?.trim().toLowerCase();
  if (requested === "background" || requested === "visible" || requested === "headless") {
    return requested;
  }

  // Backward compatibility for existing advanced installs.
  if (env.CHATGPT_HEADLESS?.trim().toLowerCase() === "true") {
    return "headless";
  }

  return "background";
}

export function buildChatGptBrowserLaunchPolicy(
  env: BrowserVisibilityEnv = process.env,
): ChatGptBrowserLaunchPolicy {
  const visibility = resolveChatGptBrowserVisibility(env);
  const background = visibility === "background";
  const headless = visibility === "headless";

  return {
    visibility,
    headless,
    slowMo: visibility === "visible" ? 30 : 0,
    args: [
      "--disable-blink-features=AutomationControlled",
      ...(background ? BACKGROUND_CHROMIUM_ARGS : []),
    ],
  };
}

export function describeChatGptBrowserVisibility(
  visibility: ChatGptBrowserVisibility,
): string {
  if (visibility === "visible") return "화면 표시";
  if (visibility === "headless") return "헤드리스";
  return "백그라운드";
}
