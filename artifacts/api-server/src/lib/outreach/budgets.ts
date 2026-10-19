import type { OutreachChannel } from "@workspace/db";

/**
 * How much a sender account may do in a day. Pure: the pacer (phase 1) asks
 * this before every send, and the admin page shows the answer beside what
 * was used.
 *
 * The figures are not ours. LinkedIn's are the ones Unipile recommends and
 * LinkedIn enforces (https://www.unipile.com/linkedin-api-rate-limits/):
 * about 100 invitations a day and 200 a week on a paid account, 100 "other
 * actions" a day across messages, profile views and post interactions, 30
 * to 50 free InMails a day to open profiles. A free LinkedIn account gets
 * roughly five invitations with a note a month, so it is treated as a
 * follow-up channel only. Email figures are deliverability practice for a
 * mailbox that has not sent cold mail before: start small, double weekly.
 * WhatsApp and Instagram are the follow-up channels for a known contact,
 * where a first message to a stranger is what gets a number restricted, so
 * their cold allowance is deliberately tiny.
 *
 * Warm-up. New accounts are a separate, smaller budget - LinkedIn holds
 * invitations from accounts with few connections for manual review, and
 * mailboxes that go from nothing to 150 a day get filtered. The ramp counts
 * from `connectedAt`, which a reconnect does not reset, so a customer who
 * reconnects a long-standing account keeps its full allowance.
 */

export type LinkedInAccountClass = "free" | "premium" | "sales_navigator" | "recruiter";

export type DailyBudget = {
  /** First touches to people who do not know the sender: invitations, cold emails, cold DMs. */
  firstTouches: number;
  /** Everything else: messages to connections, replies, follow-ups, profile views, post interactions. */
  actions: number;
  /** LinkedIn only: free InMails to open profiles. */
  inMails: number;
  /** The week of the ramp this budget is for (1-based), or null once fully warmed. */
  warmUpWeek: number | null;
  /** The weekly ceiling on first touches, where the provider enforces one (LinkedIn: ~200 invitations). */
  weeklyFirstTouches: number | null;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const LINKEDIN_PAID_RAMP = [20, 40, 60, 80];
const EMAIL_RAMP = [20, 40, 80, 120];

export function dailyBudget(input: { channel: OutreachChannel; connectedAt: Date; now: Date; linkedInClass?: LinkedInAccountClass | null }): DailyBudget {
  const ageWeeks = Math.max(0, Math.floor((input.now.getTime() - input.connectedAt.getTime()) / WEEK_MS));
  const ramp = (steps: number[]) => (ageWeeks < steps.length ? { value: steps[ageWeeks]!, week: ageWeeks + 1 } : { value: steps[steps.length - 1]!, week: null });

  switch (input.channel) {
    case "LINKEDIN": {
      const klass = input.linkedInClass ?? "premium";
      if (klass === "free") {
        // Five invitations with a note a month, so two a day keeps a free account out of trouble; messages to connections are the real use.
        return { firstTouches: 2, actions: 50, inMails: 0, warmUpWeek: null, weeklyFirstTouches: 10 };
      }
      const step = ramp(LINKEDIN_PAID_RAMP);
      return { firstTouches: step.value, actions: 100, inMails: step.week === null ? 40 : 15, warmUpWeek: step.week, weeklyFirstTouches: 200 };
    }
    case "EMAIL": {
      const step = ramp(EMAIL_RAMP);
      return { firstTouches: step.value, actions: 200, inMails: 0, warmUpWeek: step.week, weeklyFirstTouches: null };
    }
    case "WHATSAPP":
      return { firstTouches: ageWeeks < 2 ? 10 : 25, actions: 150, inMails: 0, warmUpWeek: ageWeeks < 2 ? ageWeeks + 1 : null, weeklyFirstTouches: null };
    case "INSTAGRAM":
      return { firstTouches: ageWeeks < 2 ? 10 : 20, actions: 80, inMails: 0, warmUpWeek: ageWeeks < 2 ? ageWeeks + 1 : null, weeklyFirstTouches: null };
  }
}

/** A sending window in the recipient's local day: weekdays, 8:30 to 18:00. The pacer never sends outside it. */
export const SENDING_WINDOW = { startMinutes: 8 * 60 + 30, endMinutes: 18 * 60, weekdaysOnly: true } as const;

export function withinSendingWindow(localDate: Date): boolean {
  const day = localDate.getDay();
  if (SENDING_WINDOW.weekdaysOnly && (day === 0 || day === 6)) return false;
  const minutes = localDate.getHours() * 60 + localDate.getMinutes();
  return minutes >= SENDING_WINDOW.startMinutes && minutes < SENDING_WINDOW.endMinutes;
}
