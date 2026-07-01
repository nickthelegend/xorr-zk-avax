import { redirect } from "next/navigation";

// Consolidated into the Home page tabs.
export default function ReceiveRedirect() {
  redirect("/?tab=pay&mode=receive");
}
