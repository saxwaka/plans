"use server";

import { revalidatePath } from "next/cache";
import { syncAll } from "@/lib/gateway/catalog";
import { reconcileVilao } from "@/lib/gateway/reconcile";
import { applyRules } from "@/lib/gateway/rules";
import { verifyPool } from "@/lib/gateway/verify";
import { setMemberState, setRule } from "@/lib/gateway/pool";
import { loadConfig } from "@/lib/gateway/config";
import {
  addMember, createPool, deletePool, moveMember, removeMember, setMemberWeight, updatePool,
} from "@/lib/gateway/pool";

export async function syncCatalog() {
  await syncAll(loadConfig());
  // Rules are re-evaluated right after a sync, so a newly listed seller shows up
  // in the review queue instead of waiting for someone to remember.
  applyRules();
  revalidatePath("/catalog");
  revalidatePath("/pools");
}

export async function actionCreatePool(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (name) createPool(name, String(formData.get("strategy") ?? "failover"));
  revalidatePath("/pools");
}

export async function actionDeletePool(formData: FormData) {
  deletePool(String(formData.get("poolId")));
  revalidatePath("/pools");
}

export async function actionAddMember(formData: FormData) {
  addMember(String(formData.get("poolId")), String(formData.get("listingId")));
  revalidatePath("/pools");
  revalidatePath("/catalog");
}

export async function actionRemoveMember(formData: FormData) {
  removeMember(String(formData.get("poolId")), String(formData.get("listingId")));
  revalidatePath("/pools");
}

export async function actionMoveMember(formData: FormData) {
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
  setMemberWeight(
    String(formData.get("poolId")),
    String(formData.get("listingId")),
    Number(formData.get("weight") ?? 1),
  );
  revalidatePath("/pools");
}

export async function actionReconcile() {
  await reconcileVilao(loadConfig(), 5);
  revalidatePath("/usage");
  revalidatePath("/");
  revalidatePath("/pools");
}

export async function actionSetRule(formData: FormData) {
  const raw = String(formData.get("ruleJson") ?? "").trim();
  setRule(String(formData.get("poolId")), raw === "" ? null : raw, formData.get("autoAdmit") === "1");
  applyRules();
  revalidatePath("/pools");
}

export async function actionMemberState(formData: FormData) {
  setMemberState(
    String(formData.get("poolId")),
    String(formData.get("listingId")),
    String(formData.get("state")),
  );
  revalidatePath("/pools");
}

export async function actionVerifyPool(formData: FormData) {
  await verifyPool(loadConfig(), String(formData.get("poolId")), {
    includeCandidates: formData.get("includeCandidates") === "1",
  });
  revalidatePath("/pools");
  revalidatePath("/usage");
}
