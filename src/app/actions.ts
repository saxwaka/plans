"use server";

import { revalidatePath } from "next/cache";
import { syncAll } from "@/lib/gateway/catalog";
import { loadConfig } from "@/lib/gateway/config";
import {
  addMember, createPool, deletePool, moveMember, removeMember, setMemberWeight, updatePool,
} from "@/lib/gateway/pool";

export async function syncCatalog() {
  await syncAll(loadConfig());
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
