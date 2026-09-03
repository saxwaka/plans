"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { sessionCookieName, uiPassword, verifySession } from "@/lib/gateway/session";

/**
 * Middleware already turns away requests without a session, but these actions
 * can spend money and issue keys, so each one re-checks rather than trusting
 * that the matcher will always cover every path it is called from.
 */
async function requireUi(): Promise<void> {
  const password = uiPassword();
  if (!password) return;
  const jar = await cookies();
  if (!(await verifySession(jar.get(sessionCookieName)?.value, password))) {
    throw new Error("Unauthorized: dashboard session required");
  }
}
import { syncAll } from "@/lib/gateway/catalog";
import { reconcileVilao } from "@/lib/gateway/reconcile";
import { applyRules } from "@/lib/gateway/rules";
import { verifyPool } from "@/lib/gateway/verify";
import { setMemberPosition, setMemberState, setRule, toggleMember } from "@/lib/gateway/pool";
import { loadConfig } from "@/lib/gateway/config";
import {
  addMember, createPool, deletePool, moveMember, removeMember, setMemberWeight, updatePool,
} from "@/lib/gateway/pool";

export async function syncCatalog() {
  await requireUi();
  await syncAll(loadConfig());
  // Rules are re-evaluated right after a sync, so a newly listed seller shows up
  // in the review queue instead of waiting for someone to remember.
  applyRules();
  revalidatePath("/catalog");
  revalidatePath("/pools");
}

export async function actionCreatePool(formData: FormData) {
  await requireUi();
  const name = String(formData.get("name") ?? "").trim();
  if (name) createPool(name, String(formData.get("strategy") ?? "failover"));
  revalidatePath("/pools");
}

export async function actionDeletePool(formData: FormData) {
  await requireUi();
  deletePool(String(formData.get("poolId")));
  revalidatePath("/pools");
}

export async function actionAddMember(formData: FormData) {
  await requireUi();
  addMember(String(formData.get("poolId")), String(formData.get("listingId")));
  revalidatePath("/pools");
  revalidatePath("/catalog");
}

export async function actionRemoveMember(formData: FormData) {
  await requireUi();
  removeMember(String(formData.get("poolId")), String(formData.get("listingId")));
  revalidatePath("/pools");
}

export async function actionMoveMember(formData: FormData) {
  await requireUi();
  moveMember(
    String(formData.get("poolId")),
    String(formData.get("listingId")),
    Number(formData.get("direction")) as -1 | 1,
  );
  revalidatePath("/pools");
}

const optionalNumber = (value: FormDataEntryValue | null) => {
  const s = String(value ?? "").trim();
  return s === "" ? null : Number(s);
};

export async function actionUpdatePool(formData: FormData) {
  await requireUi();
  updatePool(String(formData.get("poolId")), {
    strategy: String(formData.get("strategy") ?? "failover"),
    maxAttempts: Number(formData.get("maxAttempts") ?? 3),
    dailyBudget: optionalNumber(formData.get("dailyBudget")),
    monthlyBudget: optionalNumber(formData.get("monthlyBudget")),
    maxPricePerRequest: optionalNumber(formData.get("maxPricePerRequest")),
  });
  revalidatePath("/pools");
}

export async function actionSetWeight(formData: FormData) {
  await requireUi();
  setMemberWeight(
    String(formData.get("poolId")),
    String(formData.get("listingId")),
    Number(formData.get("weight") ?? 1),
  );
  revalidatePath("/pools");
}

export async function actionReconcile() {
  await requireUi();
  await reconcileVilao(loadConfig(), 5);
  revalidatePath("/usage");
  revalidatePath("/");
  revalidatePath("/pools");
}

export async function actionSetRule(formData: FormData) {
  await requireUi();
  const raw = String(formData.get("ruleJson") ?? "").trim();
  setRule(String(formData.get("poolId")), raw === "" ? null : raw, formData.get("autoAdmit") === "1");
  applyRules();
  revalidatePath("/pools");
}

export async function actionMemberState(formData: FormData) {
  await requireUi();
  setMemberState(
    String(formData.get("poolId")),
    String(formData.get("listingId")),
    String(formData.get("state")),
  );
  revalidatePath("/pools");
}

export async function actionVerifyPool(formData: FormData) {
  await requireUi();
  await verifyPool(loadConfig(), String(formData.get("poolId")), {
    includeCandidates: formData.get("includeCandidates") === "1",
  });
  revalidatePath("/pools");
  revalidatePath("/usage");
}

export async function actionToggleMember(formData: FormData) {
  await requireUi();
  toggleMember(
    String(formData.get("poolId")),
    String(formData.get("listingId")),
    formData.get("enabled") === "1",
  );
  revalidatePath("/pools");
}

export async function actionSetPosition(formData: FormData) {
  await requireUi();
  const position = Number(formData.get("position"));
  if (Number.isFinite(position) && position >= 1) {
    setMemberPosition(String(formData.get("poolId")), String(formData.get("listingId")), position);
  }
  revalidatePath("/pools");
}
