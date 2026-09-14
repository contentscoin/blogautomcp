import fs from 'node:fs';
import path from 'node:path';
import { createChatGPTContext, countRenderableChatGPTImages, isChatGPTGenerating, waitForChatGPTImageArtifacts, downloadChatGPTImages } from './lib/chatgpt-browser';

// Read-only diagnosis of an existing conversation. Never submits a prompt.
async function main() {
  const url = process.argv[2] || 'https://chatgpt.com/';
  if (!/^https:\/\/chatgpt\.com\/(?:c\/[a-zA-Z0-9-]+)?$/.test(url)) throw new Error('Expected ChatGPT conversation URL');
  const handle = await createChatGPTContext(true);
  try {
    const page = await handle.context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(10_000);
    const dir = path.resolve('output/playwright/image-recovery');
    fs.mkdirSync(dir, {recursive:true});
    await page.screenshot({path:path.join(dir,'conversation.png')});
    const observation = await page.evaluate(() => ({
      conversations: Array.from(document.querySelectorAll('a[href^="/c/"]')).slice(0,12).map(a=>({title:a.textContent,href:a.getAttribute('href')})),
      mainText: document.querySelector('main')?.innerText,
      images: Array.from(document.querySelectorAll('main img')).map(i=>({alt:i.getAttribute('alt'),complete:(i as HTMLImageElement).complete,naturalWidth:(i as HTMLImageElement).naturalWidth,rectWidth:i.getBoundingClientRect().width,role:i.closest('[data-message-author-role]')?.getAttribute('data-message-author-role'),parents:[i.parentElement?.className,i.parentElement?.parentElement?.className]})),
      stops: Array.from(document.querySelectorAll('button[data-testid="stop-button"],.result-streaming')).map(e=>({tag:e.tagName,testid:e.getAttribute('data-testid'),label:e.getAttribute('aria-label'),text:e.textContent?.slice(0,120)})),
    }));
    console.log(JSON.stringify({...observation,generating:await isChatGPTGenerating(page),renderable:await countRenderableChatGPTImages(page)},null,2));
    if (process.argv.includes('--recover')) {
      const count = await waitForChatGPTImageArtifacts(page, 45_000);
      if (!count) throw new Error('No completed artifact observed');
      console.log(JSON.stringify({recovered:await downloadChatGPTImages(page,dir)}));
    }
  } finally { await handle.close(); }
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
