import { and, eq } from "drizzle-orm";
import {
  accessGrantsTable,
  db,
  normalizeGrantEmail,
  organizationMembersTable,
  organizationPlansTable,
  organizationsTable,
  plansTable,
  usersTable,
  type AccessGrant,
} from "@workspace/db";
import { ensureCurrentAllowance, postCreditEntry } from "./credits";

/**
 * The invite-only door, and what happens when someone walks through it.
 *
 * `admitByGrant` is called on every authenticated request. It is cheap on the
 * common path - one indexed lookup by Clerk user id - and does real work only
 * once per person, on the first login that matches an invited grant. That
 * first login provisions the whole account so the customer never sees a
 * "create your organisation" form:
 *
 *   organisation  → created from the grant's `organizationName`, or joined if
 *                   the admin pre-attached an existing one
 *   membership    → owner of a new org, member of an existing one
 *   plan          → `organization_plans` row from the grant's `planCode`
 *   credits       → this month's allowance, plus any `initialCredits`
 *
 * All in one transaction, so a failure part-way leaves the grant `invited`
 * and the next request tries again.
 *
 * Why the lookup is by Clerk user id after the first login, not by email
 * every time: the email is what we invited, but the Clerk id is what proves
 * it is still the same account. Binding the grant to the id on first login
 * means a person who later changes their Clerk email keeps their access, and
 * a second Clerk account created with the same email does not inherit it.
 */
export type AdmissionDecision =
  | { admitted: true; grant: AccessGrant }
  | { admitted: false; code: "not_invited" | "suspended" | "no_email"; message: string };

const NOT_INVITED: AdmissionDecision = {
  admitted: false,
  code: "not_invited",
  message: "JYRA is invite-only right now. If you were expecting access, get in touch and we'll set you up.",
};

export async function admitByGrant(input: { userId: string; primaryEmail: string | null }): Promise<AdmissionDecision> {
  /* Fast path: this Clerk account has been through the door before. */
  const [bound] = await db.select().from(accessGrantsTable)
    .where(eq(accessGrantsTable.clerkUserId, input.userId)).limit(1);
  if (bound) return decide(bound);

  if (!input.primaryEmail) {
    return { admitted: false, code: "no_email", message: "Your account has no verified email address. Verify one and try again." };
  }

  const [byEmail] = await db.select().from(accessGrantsTable)
    .where(eq(accessGrantsTable.email, normalizeGrantEmail(input.primaryEmail))).limit(1);
  if (!byEmail) return NOT_INVITED;
  if (byEmail.status === "suspended") return decide(byEmail);
  if (byEmail.clerkUserId && byEmail.clerkUserId !== input.userId) {
    /* The email was invited and a different Clerk account already claimed it.
     * Treat the newcomer as uninvited rather than transferring the grant. */
    return NOT_INVITED;
  }

  const provisioned = await provisionFirstLogin(byEmail, input.userId);
  return decide(provisioned);
}

function decide(grant: AccessGrant): AdmissionDecision {
  if (grant.status === "suspended") {
    return { admitted: false, code: "suspended", message: "This account is paused. Contact us to restore access." };
  }
  return { admitted: true, grant };
}

/**
 * Everything the first login needs, atomically. Re-entrant: if two requests
 * race on the first login, the second finds the grant already bound and the
 * unique constraints refuse a duplicate organisation.
 */
async function provisionFirstLogin(grant: AccessGrant, userId: string): Promise<AccessGrant> {
  return db.transaction(async (tx) => {
    /* Re-read inside the transaction so a concurrent first login is seen. */
    const [fresh] = await tx.select().from(accessGrantsTable)
      .where(eq(accessGrantsTable.id, grant.id)).limit(1);
    if (!fresh) return grant;
    if (fresh.clerkUserId && fresh.clerkUserId !== userId) return fresh;
    if (fresh.status === "active" && fresh.clerkUserId === userId) return fresh;

    await tx.insert(usersTable).values({ id: userId, onboardedAt: new Date() })
      .onConflictDoUpdate({ target: usersTable.id, set: { onboardedAt: new Date() } });

    const [plan] = await tx.select().from(plansTable).where(eq(plansTable.code, fresh.planCode)).limit(1);
    if (!plan) throw new Error(`Access grant ${fresh.id} names plan "${fresh.planCode}", which does not exist`);

    let organizationId = fresh.organizationId;
    if (!organizationId) {
      const [organization] = await tx.insert(organizationsTable).values({
        name: (fresh.organizationName ?? "").trim() || organizationNameFromEmail(fresh.email),
        createdByUserId: userId,
      }).returning({ id: organizationsTable.id });
      organizationId = organization!.id;
      await tx.insert(organizationMembersTable).values({ organizationId, userId, role: "owner" });
    } else {
      await tx.insert(organizationMembersTable).values({ organizationId, userId, role: "member" })
        .onConflictDoNothing();
    }

    /* Assign the plan. An organisation that already has one (a second person
     * joining) keeps it; the grant's plan applies to new organisations only. */
    const [existingPlan] = await tx.select({ id: organizationPlansTable.id }).from(organizationPlansTable)
      .where(eq(organizationPlansTable.organizationId, organizationId)).limit(1);
    if (!existingPlan) {
      await tx.insert(organizationPlansTable).values({
        organizationId, planId: plan.id, note: fresh.note ?? null,
      });
    }

    if (fresh.initialCredits > 0) {
      await postCreditEntry({
        organizationId,
        kind: "grant",
        delta: fresh.initialCredits,
        description: "Starting credits",
        context: { accessGrantId: fresh.id },
        createdByUserId: fresh.invitedByUserId ?? null,
      }, tx);
    }

    const [updated] = await tx.update(accessGrantsTable).set({
      status: "active",
      clerkUserId: userId,
      organizationId,
      firstLoginAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(accessGrantsTable.id, fresh.id)).returning();
    return updated!;
  }).then(async (result) => {
    /* The allowance is applied outside the provisioning transaction because
     * it is idempotent on its own and runs on every later read anyway. */
    if (result.organizationId) {
      const [plan] = await db.select({ creditsPerMonth: plansTable.creditsPerMonth, name: plansTable.name })
        .from(plansTable).where(eq(plansTable.code, result.planCode)).limit(1);
      if (plan) await ensureCurrentAllowance({ organizationId: result.organizationId, creditsPerMonth: plan.creditsPerMonth, planName: plan.name });
    }
    return result;
  });
}

/** "priya@acme.co" → "Acme". The admin can rename it; this only stops it being blank. */
export function organizationNameFromEmail(email: string): string {
  const domain = email.split("@")[1] ?? "";
  const label = domain.split(".")[0] ?? "";
  if (!label) return "My organisation";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The grant a Clerk user is admitted under, if any. For pages that need the organisation. */
export async function grantForUser(userId: string): Promise<AccessGrant | null> {
  const [grant] = await db.select().from(accessGrantsTable)
    .where(and(eq(accessGrantsTable.clerkUserId, userId), eq(accessGrantsTable.status, "active"))).limit(1);
  return grant ?? null;
}
