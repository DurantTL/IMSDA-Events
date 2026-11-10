import { ArrowRight } from "lucide-react";
import { AdminHub } from "@/components/admin-hub";
import { NavigationLink as Link } from "@/components/navigation-link";
import { PageHeader, type TitledPageHeaderProps } from "@/components/page-header";
import type { HubBody } from "@/modules/system-admin/admin-hubs-model";

/**
 * The hub page template (#1772): header, key numbers, then groups of cards. It is the existing hub pattern
 * (`AdminHub`, `HubCardGroup`) under the one `PageHeader`: the hub's description is the header's sentence and its one
 * main action is the header's one filled button (a quiet action is outlined). Everything on a hub is a link.
 */
export function HubPage({ title, view, header }: { title: string; view: HubBody; header?: Omit<TitledPageHeaderProps, "title" | "description" | "primary"> }) {
  const action = view.action
    ? (
      <Link
        className={view.action.primary === false ? "secondary-button" : "primary-button"}
        data-primary={view.action.primary === false ? "false" : "true"}
        data-testid="hub-action"
        href={view.action.href}
      >
        {view.action.label}
        <ArrowRight aria-hidden="true" size={16} />
      </Link>
    )
    : undefined;
  return (
    <section className="page-stack" data-page-template="hub">
      <PageHeader {...header} description={view.description} primary={action} title={title} />
      <AdminHub intro={false} view={view} />
    </section>
  );
}
