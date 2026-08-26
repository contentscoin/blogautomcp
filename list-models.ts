import "dotenv/config";

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(url);
    const data: any = await res.json();
    if (data.models) {
        console.log(data.models.map((m: any) => m.name).join("\n"));
    } else {
        console.log(data);
    }
}
listModels();