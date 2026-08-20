import { genkit, z } from 'genkit';
import { ollama } from 'genkitx-ollama';

const MODEL = 'gemma4:12b';

const ai = genkit({
  plugins: [
    ollama({
      serverAddress: 'http://127.0.0.1:11434',
      models: [{ name: MODEL, type: 'chat', supports: { tools: true } }],
    }),
  ],
  model: ollama.model(MODEL),
});

const listLocations = ai.dynamicTool(
  {
    name: 'listLocations',
    description: 'Every approved work location with its radius in metres.',
    inputSchema: z.object({}),
  },
  async () => {
    console.log('>>> TOOL CALLED: listLocations');
    return [
      { name: 'Dubai Office', radiusMeters: 100 },
      { name: 'Jebel Ali Site', radiusMeters: 250 },
    ];
  },
);

const res = await ai.generate({
  system: 'You are an assistant. Use the listLocations tool for questions about locations.',
  prompt: 'Which locations are set up, and what are their radii?',
  tools: [listLocations],
  maxTurns: 5,
});

console.log('--- ANSWER ---');
console.log(res.text);
