// Wiring-level tests for the assistant service.
//
// The record handling itself is covered by record-filters.spec.ts, where it is
// pure and needs no framework. What is left here is the behaviour that only
// makes sense with the service assembled: that an unreachable/misconfigured
// Gemini API degrades to a sentence instead of an exception, and that the
// tools are constructed per request rather than registered globally.
import { ChatService, stripThinking } from './chat.service';

function makeService(rows: any[] = [], locations: any[] = []) {
  const attendance = { findAll: jest.fn().mockResolvedValue(rows) } as any;
  const locationsSvc = { findAll: jest.fn().mockResolvedValue(locations) } as any;
  return new ChatService(attendance, locationsSvc);
}

describe('ChatService', () => {
  const savedKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (savedKey) process.env.GEMINI_API_KEY = savedKey;
    else delete process.env.GEMINI_API_KEY;
  });

  it('degrades to a clear sentence when Gemini cannot be reached', async () => {
    // An API key Google will reject, rather than relying on whichever
    // machine runs this test having no key configured — that would make the
    // test pass or fail depending on developer setup instead of on the code
    // being tested.
    process.env.GEMINI_API_KEY = 'invalid-test-key';

    const out = await makeService().ask('anything', 'admin@elsewedy.com');

    // No throw: the dashboard renders a message rather than an error state,
    // and the rest of the API is unaffected by the assistant being down.
    expect(out.answer).toContain('could not answer');
    expect(out.answer).toContain('Gemini');
  }, 10000);

  it('builds a fresh set of tools on every call', () => {
    // dynamicTool rather than defineTool matters here: defineTool registers in
    // Genkit's global registry by name, so per-request construction would try
    // to register `listLocations` again on the second message.
    const service = makeService();
    const first = (service as any).buildTools('admin@elsewedy.com');
    const second = (service as any).buildTools('admin@elsewedy.com');

    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(first[0]).not.toBe(second[0]);
  });
});

// Defensive cleanup for a reasoning model that leaks its scratchpad into the
// answer text as inline <think> tags instead of a separate structured field.
// These cover what the chat panel must never display.
describe('stripThinking', () => {
  it('removes a complete think block', () => {
    expect(
      stripThinking('<think>Let me check the tools first.</think>Two locations.'),
    ).toBe('Two locations.');
  });

  it('removes a think block spanning multiple lines', () => {
    const raw = '<think>\nFirst I should call listLocations.\nThen filter.\n</think>\nDubai Office, 100 m.';
    expect(stripThinking(raw)).toBe('Dubai Office, 100 m.');
  });

  it('drops an unterminated block, which is what a truncated reply looks like', () => {
    // Generation hit the token limit mid-thought, so there is no closing tag
    // and everything after it is scratchpad. Better to show nothing than to
    // show the model reasoning with itself.
    expect(stripThinking('Answer first.<think>but wait, maybe')).toBe('Answer first.');
  });

  it('leaves an ordinary answer untouched', () => {
    const plain = 'Three employees checked in today.';
    expect(stripThinking(plain)).toBe(plain);
  });

  it('does not mangle prose that merely mentions thinking', () => {
    const plain = 'I think two records need review.';
    expect(stripThinking(plain)).toBe(plain);
  });

  it('survives an empty reply', () => {
    expect(stripThinking('')).toBe('');
    expect(stripThinking('<think>only thoughts, no answer</think>')).toBe('');
  });
});
