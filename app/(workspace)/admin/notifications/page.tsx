import { redirect } from "next/navigation";

/** Notifications became the Email page (#1043); this keeps old links and bookmarks working. */
export default function NotificationsPage() {
  redirect("/admin/email#staff-alerts");
}
