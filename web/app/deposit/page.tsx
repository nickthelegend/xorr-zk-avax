import { redirect } from "next/navigation";

// Consolidated into the Home page Deposit tab.
export default function DepositRedirect() {
  redirect("/?tab=deposit");
}
