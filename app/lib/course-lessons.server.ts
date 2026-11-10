import { eq } from "drizzle-orm";
import { db } from "~/db";
import { lessons, modules } from "~/db/schema";

/** The ids of every lesson in a course, across all its modules. */
export function getCourseLessonIds(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}
