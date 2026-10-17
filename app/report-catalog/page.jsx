import { redirect } from "next/navigation";

/**
 * The project's resource library is kept with the contract resources it
 * feeds (one place for resources, 2026-10-17). The old address leads there.
 */
export default function ReportCatalogPage() {
  redirect("/contracts/resources");
}
