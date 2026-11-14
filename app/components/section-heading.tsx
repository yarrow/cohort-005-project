import type { LucideIcon } from "lucide-react";

export function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <Icon className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">{title}</h2>
      </div>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
