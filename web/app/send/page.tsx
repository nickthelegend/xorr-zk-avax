import { redirect } from "next/navigation";

// Consolidated into the Home page tabs.
export default function SendRedirect() {
  redirect("/?tab=pay");
}
