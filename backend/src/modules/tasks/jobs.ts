import { Prisma } from '@prisma/client';
import { prisma, withTenant } from '../../kernel/db';
import { JobTally } from '../../kernel/jobs';
import { withDefaults } from '../../contracts/workspace';
import { notificationsWithDefaults, personalWithDefaults } from '../../contracts/account';
import { notify } from '../notifications/service';

// Hourly: tell the person a task is given to that it is due, once, from 9 AM India time, on the day
// Settings › Tasks says (the due day or the day before). Turned off there, or under Notifications ›
// Alerts to your team, or muted by the person in My account: nothing is sent. Each business on its own.

const FROM_HOUR_IST = 9;
const DAY = 86_400_000;

interface Due {
  id: string;
  tenant_id: string;
  title: string;
  assignee_id: string;
  due_day: string;
  tenant_prefs: unknown;
  user_prefs: unknown;
}

export async function runTaskReminders(now = new Date()) {
  const tally = new JobTally();
  const ist = new Date(now.getTime() + 330 * 60_000);
  if (ist.getUTCHours() < FROM_HOUR_IST) {
    tally.note('Waits until 9 AM India time');
    return tally;
  }
  const today = ist.toISOString().slice(0, 10);
  const tomorrow = new Date(ist.getTime() + DAY).toISOString().slice(0, 10);
  // Start of today in India, as a moment: a reminder sent since then is not sent again
  const todayStart = new Date(`${today}T00:00:00+05:30`);
  const rows = await prisma.$queryRaw<Due[]>(Prisma.sql`
    SELECT t.id, t.tenant_id, t.title, t.assignee_id,
           to_char((t.due_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS due_day,
           tn.preferences AS tenant_prefs, u.preferences AS user_prefs
      FROM tasks t
      JOIN tenants tn ON tn.id = t.tenant_id
      JOIN users u ON u.id = t.assignee_id
     WHERE t.status::text IN ('todo', 'in_progress')
       AND t.assignee_id IS NOT NULL AND t.due_at IS NOT NULL
       AND (t.due_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${today}::date AND ${tomorrow}::date
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.user_id = t.assignee_id AND n.link = '/app/m/tasks/' || t.id::text
            AND n.title LIKE 'Task due%' AND n.created_at >= ${todayStart})`);

  let sent = 0;
  for (const r of rows) {
    const when = withDefaults(r.tenant_prefs).tasks.dueReminder;
    const fires = (when === 'due_day' && r.due_day === today) || (when === 'day_before' && r.due_day === tomorrow);
    if (!fires) continue;
    const team = notificationsWithDefaults((r.tenant_prefs as { notifications?: unknown } | null)?.notifications).team.task_due;
    if (!team?.inApp || personalWithDefaults(r.user_prefs).mutedAlerts.inApp.includes('task_due')) continue;
    await tally.item(`task ${r.id}`, async () => {
      await withTenant({ kind: 'system', tenantId: r.tenant_id }, () =>
        notify(r.assignee_id, r.due_day === today ? 'Task due today' : 'Task due tomorrow', r.title, `/app/m/tasks/${r.id}`),
      );
      sent += 1;
    });
  }
  tally.note(sent > 0 && `${sent} reminder${sent === 1 ? '' : 's'} sent`);
  return tally;
}
