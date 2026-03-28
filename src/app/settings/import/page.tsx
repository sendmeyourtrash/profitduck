import { redirect } from "next/navigation";

export default function ImportRedirect() {
  redirect("/settings/import/upload");
}
