import { BookOpen, User } from "lucide-react";
import { cn } from "~/lib/utils";

/** A course card's footer row: who teaches it and how many lessons it has. */
export function CourseByline({
  instructorName,
  lessonCount,
  className,
}: {
  instructorName: string;
  lessonCount: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-xs text-muted-foreground",
        className
      )}
    >
      <span className="flex items-center gap-1">
        <User className="size-3" />
        {instructorName}
      </span>
      <span className="flex items-center gap-1">
        <BookOpen className="size-3" />
        {lessonCount} lessons
      </span>
    </div>
  );
}
