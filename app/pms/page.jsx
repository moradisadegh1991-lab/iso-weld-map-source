import { redirect } from "next/navigation";

/**
 * The schedule and the PMS are versions of the contract's EPS now (one plan,
 * 2026-10-17): a file is imported there, and what was imported into this
 * page before is converted there. The old address leads to it.
 */
export default function PmsPage() {
  redirect("/eps");
}
