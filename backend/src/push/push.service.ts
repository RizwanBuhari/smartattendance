// Sends Firebase Cloud Messaging pushes to employees' phones.
//
// This is what makes a site admin findable when they are NOT staring at the
// app. The in-app screen can only react while it is open, and a Firestore
// listener dies with the process — a push is delivered by the OS, so it lands
// on a locked phone.
//
// Tokens live in "device_Tokens", keyed BY THE TOKEN itself rather than by
// employee. That makes re-registration naturally idempotent, and it models the
// real relationship: one person may carry two devices, and one device may be
// handed to a different person, in which case the token simply moves.
import { Injectable, Logger } from '@nestjs/common';
import { getMessaging } from 'firebase-admin/messaging';
import { getFirestore } from 'firebase-admin/firestore';

export interface PushMessage {
  title: string;
  body: string;
  // Delivered alongside the notification so the app can act on a tap —
  // FCM requires every value to be a string.
  data?: Record<string, string>;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly db = getFirestore();
  private readonly tokens = this.db.collection('device_Tokens');

  // Called after sign-in, and again whenever Firebase rotates the token.
  async register(employeeId: string, token: string, platform?: string) {
    if (!token) return { ok: false };
    await this.tokens.doc(token).set({
      employeeId,
      platform: platform ?? 'unknown',
      updatedAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  // Called on sign-out, so a shared or handed-on phone stops receiving pushes
  // meant for the previous user.
  async unregister(token: string) {
    if (!token) return { ok: false };
    await this.tokens.doc(token).delete();
    return { ok: true };
  }

  // Sends to every device belonging to any of these employees.
  //
  // Never throws: a push is a courtesy on top of an action that has already
  // succeeded, so a messaging outage must not fail the caller's request.
  async sendToEmployees(employeeIds: string[], message: PushMessage) {
    if (employeeIds.length === 0) return { sent: 0 };

    try {
      // Firestore caps `in` at 30 values.
      const snapshots = await Promise.all(
        chunk(employeeIds, 30).map((ids) =>
          this.tokens.where('employeeId', 'in', ids).get(),
        ),
      );
      const docs = snapshots.flatMap((snap) => snap.docs);
      if (docs.length === 0) {
        this.logger.log(
          `No registered devices for ${employeeIds.length} employee(s) — nothing to push.`,
        );
        return { sent: 0 };
      }

      const tokens = docs.map((d) => d.id);
      const response = await getMessaging().sendEachForMulticast({
        tokens,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: {
          priority: 'high',
          notification: {
            // Must match the channel the Flutter app creates, or Android
            // silently drops the notification into a default low-importance
            // channel and it never makes a sound.
            channelId: 'checkn_alerts',
          },
        },
      });

      // Logged on the SUCCESS path too, not just on failure. Without this,
      // "nothing in the log" meant either "sent fine" or "never ran", which is
      // the worst possible thing to be ambiguous when a push does not arrive.
      this.logger.log(
        `Push to ${tokens.length} device(s): ${response.successCount} accepted, ${response.failureCount} rejected.`,
      );
      response.responses.forEach((r, i) => {
        if (!r.success) {
          this.logger.warn(
            `  token ${tokens[i].slice(0, 12)}… rejected: ${r.error?.code ?? 'unknown'}`,
          );
        }
      });

      // A token stays in Firestore forever unless we clean it up — uninstalls
      // and reinstalls would otherwise accumulate into a pile of dead sends.
      await this.pruneDeadTokens(docs, response.responses);

      return { sent: response.successCount };
    } catch (err) {
      this.logger.error(`Push failed: ${String(err)}`);
      return { sent: 0 };
    }
  }

  private async pruneDeadTokens(
    docs: FirebaseFirestore.QueryDocumentSnapshot[],
    responses: { success: boolean; error?: { code?: string } }[],
  ) {
    const dead = docs.filter((_, i) => {
      const error = responses[i]?.error?.code ?? '';
      return (
        error === 'messaging/registration-token-not-registered' ||
        error === 'messaging/invalid-registration-token'
      );
    });
    await Promise.all(dead.map((d) => d.ref.delete().catch(() => {})));
    if (dead.length) {
      this.logger.log(`Pruned ${dead.length} dead device token(s).`);
    }
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
