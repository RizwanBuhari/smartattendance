# API Documentation — what it is and how to talk about it

A crib sheet for explaining deliverable #4. Ahmed, El Sewedy Electric UAE.

---

## The 30-second version

> "The API documents itself. I used `@nestjs/swagger`, which reads decorators on
> the controllers and generates an OpenAPI 3.0 spec at runtime — 61 endpoints
> across 13 groups. It's browsable at `/api/docs`, where you can authenticate and
> fire real requests, and the raw spec is at `/api/docs-json` if another team
> wants to generate a client from it.
>
> I chose generated over hand-written because a document maintained by hand goes
> stale on the first refactor, and then it's worse than nothing — people trust it
> and it's wrong. This one can't drift: if I change a route, the docs change with
> it."

That's the answer. Everything below is for follow-up questions.

---

## If asked: "Show me"

1. `cd backend && npm run start:dev`
2. Open **http://localhost:3000/api/docs**
3. Expand **Attendance → POST /attendance/check-in**

That endpoint is the one to demo, because the documentation carries the design
decision, not just the field list:

> **`isInsideGeofence`** — The phone's own geofence opinion. **Not the decision** —
> the server computes that from the coordinates above. Supplying `true` from
> outside an approved radius does not grant a check-in; it records
> `verification.clientDisagreed: true` against the attempt.

Then click **Authorize**, paste a Firebase ID token, and run it live.

---

## If asked: "How much is covered?"

| | |
|---|---|
| Operations | **61** |
| Tags (groups) | **13** |
| Schemas | **16** |
| Operations missing a summary | **0** |
| Duplicate operation ids | **0** |
| Spec version | OpenAPI **3.0.0** |

Both authentication schemes are declared and attached per route:

- `firebase` — the Firebase ID token bearer
- `session` — the `X-Session-Id` header that enforces one-account-one-device

I verified these numbers by generating the document against a running app, not
by counting decorators by hand.

---

## If asked: "Why Swagger and not a written document?"

Three reasons, in order of how much they matter:

1. **It cannot go stale.** The decorators sit on the same methods that handle the
   requests. A route that changes without its documentation changing is not
   possible.
2. **It's executable.** A reader can authenticate and call the endpoint from the
   page. A Word document describing 61 endpoints cannot be tried, so nobody
   finds out it's wrong until integration.
3. **It's a machine-readable contract.** `/api/docs-json` is a standard OpenAPI
   spec, so a mobile or frontend team can generate a typed client from it rather
   than hand-writing request models.

The honest trade-off, if pressed: generated docs describe *shape* well and
*intent* only if you write the descriptions. Route listings come free; the
useful part took deliberate effort. Which leads to the next question.

---

## If asked: "What did you actually write, then?"

The route inventory is free — Swagger discovers it. The value I added is in the
descriptions, and they cover the things that cost an integrator a day to
discover by experiment:

- **`isInsideGeofence` is not the decision.** Documented explicitly, because the
  field name invites exactly the wrong assumption.
- **A refused check-in is HTTP 201 with `accepted: false`,** not a 4xx. The
  request was well-formed; the *location* was not. Clients must branch on the
  field, not the status code. This is written on the endpoint, and the response
  is modelled as a `oneOf` union of the accepted and rejected shapes so both are
  visible.
- **The four verification steps in order** — coordinates, accuracy ceiling,
  nearest-location distance, radius comparison — so a reader knows *why* a
  rejection carries the `reason` it does.
- **Why check-out is deliberately never geofence-blocked.** Someone ending a
  shift must not get stuck permanently checked in because their GPS drifted.
  Out-of-radius check-outs succeed and open an admin review instead. Without
  that note the behaviour looks like a missing check.
- **Why `/admins/verify` is unguarded.** It *is* the admin check — guarding it
  would be circular. Otherwise it reads as a security hole.
- **`inconclusive` on location pings.** A GPS fix too poor to judge is not
  evidence of absence. Documented so nobody "fixes" it into a false positive.

Point at `src/attendance/dto/attendance.dto.ts` if he wants to see the source of
those descriptions.

---

## If asked: "What's the risk / what's missing?"

Answer straight, it's a better look than claiming completeness:

- **14 of the 61 endpoints** (the `offsite-checkin` and `otp` groups) are tagged
  and summarised but don't have full request-body schemas yet. They're internal
  to flows the mobile app owns end to end, so the payoff was lower than for
  attendance. Easy to deepen.
- **`SWAGGER_ENABLED=false`** turns the whole thing off. Worth mentioning
  unprompted — it shows the production question was considered. The endpoints are
  all guarded by Firebase tokens, so describing them isn't itself a disclosure,
  but the switch exists if the surface shouldn't be public.
- **Run `npm install` first.** `@nestjs/swagger` is in `package.json`; if he
  clones and starts without installing, it won't boot.

---

## Questions he might ask that aren't really about Swagger

**"Could someone fake a check-in?"**
Not by lying in the request body. The server computes the haversine distance from
the reported coordinates to the employee's approved locations and compares it to
the configured radius. The device's claim is recorded and cross-checked, so a
phone that says "inside" while its own coordinates say otherwise leaves a
`clientDisagreed` flag on the record. GPS spoofing at the OS level is a
different, harder problem — the current mitigation is the accuracy ceiling and
the native-geofence DWELL confirmation; an implied-velocity check is the next
thing I'd add.

**"How do I know the geofence maths is right?"**
`geofence/geo.ts` holds the distance functions as pure functions with no I/O, and
they're unit tested against independently checkable distances — one degree of
latitude is ~111 km anywhere, a degree of longitude shrinks by `cos(latitude)`,
and Dubai to Abu Dhabi is ~120 km. There are 142 assertions across the maths, the
decision logic, the payload validation and the end-to-end check-in path.

**"Is this the standard way to do it?"**
Yes — `@nestjs/swagger` is the first-party NestJS package for this, and OpenAPI
3.0 is the industry-standard format. Nothing bespoke.

---

## What not to say

- Don't call it "auto-generated documentation" as if that were the whole story —
  it invites "so you didn't write anything." Say **generated from the code, with
  the design decisions written by hand.**
- Don't claim 100% coverage. The 14 thinner endpoints are easy to find.
- Don't oversell spoofing resistance. Server-side verification closes the
  trivially-forged-request hole. It does not defeat a rooted phone running a
  mock-location provider, and saying otherwise invites a question you can't win.
