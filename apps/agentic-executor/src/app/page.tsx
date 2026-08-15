import { redirect } from "next/navigation";

/*
 * The dashboard split into two views in Story 3.4. Root forwards to Videos,
 * the default view, so an old bookmark to "/" still lands somewhere useful.
 */
export default function RootPage() {
  redirect("/videos");
}
