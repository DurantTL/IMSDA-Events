import { HubLink } from "@/components/site-notices-view";
import type { HubLink as HubLinkItem } from "@/modules/site-content/hub-content-domain";

/** The extra links staff added to the public header (#111). Nothing when there are none, so the header is unchanged. */
export function PublicHeaderNavLinks({ links }: { links: readonly HubLinkItem[] }) {
  if (links.length === 0) return null;
  return (
    <nav aria-label="Site links" className="public-header-nav">
      <ul>
        {links.map((link, index) => (
          <li key={`${link.href}-${index}`}><HubLink className="text-button" href={link.href}>{link.label}</HubLink></li>
        ))}
      </ul>
    </nav>
  );
}
