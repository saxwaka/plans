"use server";

import { revalidatePath } from "next/cache";
import { syncAll } from "@/lib/gateway/catalog";
import { loadConfig } from "@/lib/gateway/config";
import { addMember, createPool, deletePool, moveMember, removeMember } from "@/lib/gateway/pool";

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
