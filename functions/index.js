// OPTIONAL — not required for Smart Attendance to work.
//
// The dashboard already shows a real-time-ish "Anomalies" panel by polling
// GET /location-pings/anomalies every 30s (see dashboard/src/pages/
// OverviewPage.jsx). This function adds a step further: an actual push
// notification the moment a ping lands outside the geofence, so an admin
// finds out even if the dashboard tab isn't open.
//
// This requires things this codebase can't set up for you:
//   1. The Firebase project must be on the Blaze (pay-as-you-go) plan —
//      Cloud Functions don't run on the free Spark plan. Only the project
//      owner can enable this, in the Firebase console's Usage & Billing page.
//   2. Deploy with `firebase deploy --only functions` from this directory
//      (needs the Firebase CLI: `npm install -g firebase-tools`, then
//      `firebase login` and `firebase use <project-id>` once).
//   3. For the dashboard to actually RECEIVE the push, it needs to subscribe
//      to the "admins" FCM topic this function publishes to — see
//      dashboard/src/push-notifications.js.example for that piece, which is
//      deliberately NOT wired into the running app (it needs a VAPID key
//      from Firebase Console > Project Settings > Cloud Messaging, which
//      only the project owner can generate).
//
// Until all three are done, the app works exactly as it does today — this
// file has zero effect unless deployed.
const { initializeApp } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');

initializeApp();

exports.notifyOnGeofenceAnomaly = onDocumentCreated(
  'location_Pings/{pingId}',
  async (event) => {
    const ping = event.data?.data();
    if (!ping || ping.insideGeofence !== false) return;

    // Sending to a topic with zero subscribers is a harmless no-op — safe
    // to deploy before anyone has subscribed on the dashboard side.
    await getMessaging().send({
      topic: 'admins',
      notification: {
        title: 'Geofence anomaly',
        body: `${ping.employeeName} is ${ping.distanceMeters ?? '?'}m from ${
          ping.locationName ?? 'their approved area'
        }.`,
      },
      data: {
        employeeId: String(ping.employeeId ?? ''),
        timestamp: String(ping.timestamp ?? ''),
      },
    });
  },
);
