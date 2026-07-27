import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';
import { PushService } from '../push/push.service';

@Injectable()
export class CheckoutReminderService implements OnModuleInit {
  private readonly logger = new Logger(CheckoutReminderService.name);
  private readonly db = getFirestore();
  private readonly collection = this.db.collection('attendance_ids');

  constructor(private readonly pushService: PushService) {}

  onModuleInit() {
    // Check every 15 minutes for active sessions past shift end (6:15 PM)
    setInterval(
      () => {
        this.checkAndSendReminders().catch((err) =>
          this.logger.error(`Error sending checkout reminders: ${err}`),
        );
      },
      15 * 60 * 1000,
    );
  }

  async checkAndSendReminders() {
    const now = new Date();
    // Dubai is UTC+4. Local hour is (UTC hour + 4) % 24
    const dubaiHour = (now.getUTCHours() + 4) % 24;

    // Send reminders only between 6 PM (18) and 11 PM (23) local time
    if (dubaiHour < 18 || dubaiHour > 23) {
      return;
    }

    const activeSnap = await this.collection
      .where('status', '==', 'checked_in')
      .get();

    if (activeSnap.empty) return;

    const employeeIdsToRemind: string[] = [];
    const todayStr = now.toISOString().split('T')[0];

    for (const doc of activeSnap.docs) {
      const data = doc.data();
      const empId = data.employeeId || data.employeeUid;
      const lastRemindedDate = data.lastCheckoutReminderDate;

      // Only send once per day per active check-in
      if (empId && lastRemindedDate !== todayStr) {
        employeeIdsToRemind.push(empId);
        await doc.ref.update({
          lastCheckoutReminderDate: todayStr,
        });
      }
    }

    if (employeeIdsToRemind.length > 0) {
      this.logger.log(
        `Sending checkout reminders to ${employeeIdsToRemind.length} employee(s)`,
      );
      await this.pushService.sendToEmployees(employeeIdsToRemind, {
        title: 'Forgotten Check-out Reminder',
        body: 'Your shift ended at 6:00 PM and you are still checked in. Please submit your check-out.',
      });
    }
  }
}
