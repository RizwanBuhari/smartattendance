// The admin assistant that sits in the dashboard.
//
// The model never touches Firestore. It is given a small set of TOOLS, each of
// which is a thin wrapper over a service this backend already owns, and it can
// only ask for data by calling one of them. That matters for two reasons:
//
//   1. Firestore has no joins, no LIKE and no ad-hoc query language, so "who
//      was late at Dubai Office this week" is not a query the database could
//      answer even if the model were allowed to write one. The business logic
//      lives in our services; the tools reuse it rather than reinventing it.
//   2. Anything reading attendance must go through the same rules as the rest
//      of the API. The route is behind AdminGuard and the tools are read-only,
//      so the worst a confused model can do is fetch something the signed-in
//      admin was already entitled to see.
//
// Tools are built PER REQUEST (see buildTools) so the caller's identity is held
// in a closure. The model cannot pass an identity as an argument, because it
// isn't a parameter — the same reasoning as the guards: identity comes from the
// verified token, never from the payload.
import { Injectable, Logger } from '@nestjs/common';
import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { AttendanceService } from '../attendance/attendance.service';
import { LocationsService } from '../locations/locations.service';
import {
  filterRecords,
  summarise,
  toExplanation,
  toLocationSummary,
} from './record-filters';

// What the assistant needs to know to answer correctly rather than plausibly.
// Kept here (rather than retrieved from a vector store) because it is small and
// changes only when the system changes — retrieval would be machinery without
// a payoff at this size.
const SYSTEM_PROMPT = `
You are the assistant inside the Smart Attendance & Geofencing admin dashboard
at El Sewedy Electric UAE. You help administrators understand attendance data.

HOW THE SYSTEM WORKS

- Presence is detected by native OS geofencing on the employee's phone: real
  geofences registered with Android/iOS per approved location, firing ENTER,
  DWELL, EXIT and RETURN. A five-minute dwell delay means someone merely
  walking past a site is never counted as present.
- The server does not trust what the phone reports. It re-measures: haversine
  distance from the reported coordinates to the nearest approved location,
  compared against that location's radius plus a buffer of
  min(gpsAccuracy, 25 m). A fix worse than 50 m is refused as inconclusive,
  because a poor fix is not evidence of absence.
- Every record therefore carries a real measurement:
    distanceMeters   - metres from the location centre, measured server-side
    radiusMeters     - the approved radius it was judged against
    reason           - one of: inside, outside_radius, poor_accuracy,
                       invalid_coordinates, no_approved_locations
    clientDisagreed  - true when the phone claimed one thing and the server
                       measured another. This is the strongest fraud signal in
                       the system; call it out when you see it.
- Check-out is deliberately never geofence-blocked, so nobody is trapped
  permanently checked in by GPS drift. An out-of-radius check-out succeeds,
  is flagged with its real distance, and opens an admin review. If asked, say
  this is intentional, not a missing check.
- flaggedOutside on a record means a background location ping OR the check-out
  itself placed the employee outside their approved area during that session.

HOW TO ANSWER

- Use the tools for anything about real data. Never invent a name, a date, a
  distance or a location.
- Call listLocations first when the admin names a place, so you filter on a
  name that actually exists.
- All timestamps are UTC ISO-8601 strings. Today's date is provided to you in
  the user turn; use it to resolve "this week", "yesterday" and similar.
- Be brief. Lead with the answer, then the supporting detail. Prefer a short
  list over a paragraph when reporting several records.
- If a tool returns nothing, say so plainly. Do not pad or speculate.
- You are read-only. If asked to change, delete or approve anything, explain
  that you cannot, and point to the dashboard page that can.
`;

/**
 * Strip a reasoning model's scratchpad from the reply, if it leaked into the
 * answer text as inline <think> tags rather than a separate structured field.
 * Three lines, fails safe, and costs nothing when there is nothing to strip.
 */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    // An unclosed <think> means generation was cut off mid-thought (hit the
    // token limit). Everything after the tag is scratchpad, so drop the tail.
    .replace(/<think>[\s\S]*$/, '')
    .trim();
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  // Model name is configurable so a model swap is an env change, not a code
  // change. Hosted rather than local: this used to run on an in-cluster
  // Ollama pod, but that pod has no GPU (Docker Desktop's Kubernetes does not
  // expose the host GPU), and one question can cost up to maxTurns (5)
  // generation passes — CPU inference made that painfully slow. Gemini's free
  // tier (a key from https://aistudio.google.com/apikey, no card required) is
  // fast enough that this is no longer a concern for a single-admin dashboard.
  //
  // Trade-off worth knowing: the tools below return real attendance data —
  // names, locations, GPS-derived verdicts — into the prompt Google receives.
  // On the free tier Google may use that data for training. If that data
  // sensitivity becomes a problem, switch to a paid Gemini key (no training
  // on your data) rather than reverting to local inference.
  private readonly geminiModel =
    process.env.GEMINI_MODEL ?? 'gemini-flash-latest';

  // One Genkit instance for the process. googleAI() reads GEMINI_API_KEY (or
  // GOOGLE_API_KEY) from the environment itself — set in backend/.env, which
  // reaches the cluster as the backend-env Secret (see k8s/02-backend.yaml).
  private readonly ai = genkit({
    plugins: [googleAI()],
    model: googleAI.model(this.geminiModel),
  });

  constructor(
    private readonly attendance: AttendanceService,
    private readonly locations: LocationsService,
  ) {}

  /**
   * Answer one question from an authenticated admin.
   *
   * @param message    what the admin typed
   * @param adminEmail the identity AdminGuard verified — used for logging and
   *                   captured by the tools, never supplied by the model
   */
  async ask(message: string, adminEmail: string) {
    const tools = this.buildTools(adminEmail);

    try {
      const res = await this.ai.generate({
        system: SYSTEM_PROMPT,
        // The model has no clock. Without today's date it cannot resolve
        // "this week", and will quietly guess a year.
        prompt: `Today is ${new Date().toISOString().slice(0, 10)} (UTC).\n\n${message}`,
        tools,
        // Bounds how many tool round-trips one question can trigger. Without
        // it, a confused model can loop and every lap costs a call.
        maxTurns: 5,
      });

      // Which tools actually ran. Worth surfacing: an answer with an empty
      // toolsUsed came from the prompt alone, which for a data question means
      // the model made it up. Cheap to compute, and it turns "is this real?"
      // into something you can check rather than trust.
      const toolsUsed = Array.from(
        new Set(
          (res.messages ?? [])
            .flatMap((m: any) => m?.content ?? [])
            .map((p: any) => p?.toolRequest?.name)
            .filter((n: unknown): n is string => typeof n === 'string'),
        ),
      );

      this.logger.log(
        `Assistant answered for ${adminEmail} using [${toolsUsed.join(', ') || 'no tools'}]`,
      );

      return { answer: stripThinking(res.text), toolsUsed };
    } catch (err) {
      const detail = (err as Error)?.message ?? String(err);

      // Full stack to the console for the team.
      this.logger.error(`Assistant failed for ${adminEmail}: ${detail}`);
      this.logger.error((err as Error)?.stack ?? '');

      // The reason also goes back to the caller. This route is admin-only, so
      // the audience is someone entitled to see it — and a generic "something
      // went wrong" turns a bad API key into a debugging session. If this ever
      // opens up beyond admins, trim this back to the generic line.
      return {
        answer:
          'Sorry — I could not answer that.\n\n' +
          `Reason: ${detail}\n\n` +
          `The assistant is using Gemini model '${this.geminiModel}'. Common ` +
          'causes:\n' +
          '• GEMINI_API_KEY is missing or invalid — set it in backend/.env ' +
          '(get a free key at https://aistudio.google.com/apikey) and make ' +
          'sure the backend-env Secret was recreated from it (see ' +
          'k8s/README.md).\n' +
          '• The free-tier rate limit was hit — it is shared across every ' +
          'key on the same Google Cloud project, not per-key, and this ' +
          'assistant can make up to maxTurns (5) requests for one question.\n' +
          '• GEMINI_MODEL does not match a model your key can access.\n' +
          '• The cluster cannot reach generativelanguage.googleapis.com — ' +
          'check outbound network access from the backend pod.',
        toolsUsed: [],
      };
    }
  }

  /**
   * The tools the model may call, with the caller baked in.
   *
   * `dynamicTool` rather than `defineTool` on purpose: defineTool registers the
   * tool in Genkit's global registry under its name, so building these once per
   * request would try to register `listLocations` again on every message.
   * Dynamic tools are identical to the model but live only for this call, which
   * is exactly what per-request construction needs.
   *
   * Every tool here is READ-ONLY by design. Adding a tool that writes would
   * mean the model could change attendance on its own reading of an ambiguous
   * sentence — so writes belong behind an explicit confirmation in the UI, not
   * behind a tool call.
   */
  private buildTools(adminEmail: string) {
    const listLocations = this.ai.dynamicTool(
      {
        name: 'listLocations',
        description:
          'Every approved work location, with the radius in metres that ' +
          'check-ins there are measured against. Call this first when the ' +
          'admin mentions a place by name.',
        inputSchema: z.object({}),
      },
      async () => (await this.locations.findAll()).map(toLocationSummary),
    );

    const findAttendance = this.ai.dynamicTool(
      {
        name: 'findAttendance',
        description:
          'Attendance records, newest first, with the server-measured ' +
          'verification on each one. Filter by ISO date range (yyyy-mm-dd), ' +
          'employee name, or location name. Use onlyFlagged to see just the ' +
          'records that need attention.',
        inputSchema: z.object({
          from: z
            .string()
            .optional()
            .describe('Earliest check-in date, yyyy-mm-dd'),
          to: z.string().optional().describe('Latest check-in date, yyyy-mm-dd'),
          employeeName: z
            .string()
            .optional()
            .describe('Partial, case-insensitive match'),
          locationName: z
            .string()
            .optional()
            .describe('Partial, case-insensitive match'),
          onlyFlagged: z
            .boolean()
            .optional()
            .describe(
              'Only records where the device disagreed with the server, the ' +
                'check-out was out of radius, or a ping placed them outside',
            ),
          limit: z.number().int().min(1).max(50).default(25),
        }),
      },
      async ({ from, to, employeeName, locationName, onlyFlagged, limit }) => {
        // findAll() returns every record. That is fine at the current data
        // volume and keeps this tool honest about reusing existing logic, but
        // it is the first thing to replace with a real Firestore range query
        // when the collection grows.
        const rows = (await this.attendance.findAll()) as Record<string, any>[];

        // The filtering and trimming live in record-filters.ts as pure
        // functions, so they can be tested without a model, a database or Nest.
        return summarise(
          filterRecords(rows, {
            from,
            to,
            employeeName,
            locationName,
            onlyFlagged,
          }),
          limit,
        );
      },
    );

    const explainRecord = this.ai.dynamicTool(
      {
        name: 'explainRecord',
        description:
          'Why one specific attendance record was accepted or rejected: the ' +
          'measured distance, the radius it was judged against, the reason ' +
          'code, and whether the device contradicted the server. Use this ' +
          'when the admin asks about a particular record or employee session.',
        inputSchema: z.object({
          attendanceId: z.string().describe('The record id from findAttendance'),
        }),
      },
      async ({ attendanceId }) => {
        const rows = (await this.attendance.findAll()) as Record<string, any>[];
        // Nothing is computed here — every field was decided by the server at
        // check-in and stored. The assistant reads a verdict, it does not form
        // one.
        return toExplanation(rows.find((r) => r.id === attendanceId));
      },
    );

    // adminEmail is deliberately unused by the tools today: an admin may see
    // every record, so there is nothing to narrow. It is threaded through now
    // because the moment supervisors get access, each tool needs to filter to
    // the caller's team — and doing that here, in the closure, is a line per
    // tool rather than a redesign.
    void adminEmail;

    return [listLocations, findAttendance, explainRecord];
  }
}
