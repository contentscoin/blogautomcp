import "dotenv/config";

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(url);
    const data: unknown = await res.json();
    const models =
        typeof data === "object" && data !== null && Array.isArray((data as { models?: unknown }).models)
            ? (data as { models: unknown[] }).models
            : null;

    if (models) {
        const names = models.flatMap((model) => {
            if (typeof model !== "object" || model === null) return [];
            const name = (model as { name?: unknown }).name;
            return typeof name === "string" ? [name] : [];
        });
        console.log(names.join("\n"));
    } else {
        console.log(data);
    }
}
listModels();
