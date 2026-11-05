import type { ReactNode } from "react";

/**
 * The section title of a coordinator page, in the club portal's pattern (#1555): a purple uppercase eyebrow over a bold
 * heading, inside a `public-manage-card-heading` (the same markup the club home cards use). Any children (the scope line)
 * follow as the muted last paragraph. Presentation only.
 */
export function CoordinatorSectionHeading({
  eyebrow,
  title,
  id,
  level = 2,
  children,
}: {
  eyebrow: string;
  title: string;
  id?: string;
  level?: 2 | 3;
  children?: ReactNode;
}) {
  const Heading = `h${level}` as const;
  return (
    <header className="public-manage-card-heading">
      <p className="public-registration-eyebrow">{eyebrow}</p>
      <Heading id={id}>{title}</Heading>
      {children}
    </header>
  );
}
