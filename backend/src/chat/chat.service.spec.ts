// Wiring-level tests for the assistant service.
//
// The record handling itself is covered by record-filters.spec.ts, where it is
// pure and needs no framework. What is left here is the behaviour that only
// makes sense with the service assembled: that a missing API key degrades to a
// sentence instead of an exception, and that the tools are constructed per
// request rather than registered globally.
import { ChatService } from './chat.service';

function makeService(rows: any[] = [], locations: any[] = []) {
  const attendance = { findAll: jest.fn().mockResolvedValue(rows) } as any;
  const locationsSvc = { findAll: jest.fn().mockResolvedValue(locations) } as any;
  return new ChatService(attendance, locationsSvc);
}

describe('ChatService', () => {
  const saved = {
    gemini: process.env.GEMINI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  };

  afterEach(() => {
    if (saved.gemini) process.env.GEMINI_API_KEY = saved.gemini;
    else delete process.env.GEMINI_API_KEY;
    if (saved.google) process.env.GOOGLE_API_KEY = saved.google;
    else delete process.env.GOOGLE_API_KEY;
  });

  it('degrades to a clear sentence when no API key is configured', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const out = await makeService().ask('anything', 'admin@elsewedy.com');

    // No throw: the dashboard renders a message rather than an error state,
    // and the rest of the API is unaffected by the assistant being unconfigured.
    expect(out.answer).toContain('not configured');
  });

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
