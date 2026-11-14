import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "~/db/schema";
import {
  CourseStatus,
  categories,
  courses,
  lessons,
  modules,
  users,
} from "~/db/schema";

export type Db = BetterSQLite3Database<typeof schema>;

/** How many courses the landing page shows below the spotlight. */
const FEATURED_COUNT = 3;

export type LandingCourse = {
  id: number;
  title: string;
  slug: string;
  description: string;
  coverImageUrl: string | null;
  instructorName: string;
  categoryName: string;
  lessonCount: number;
};

export type LandingPage = {
  /** The newest published course, or null when nothing is published. */
  spotlight: LandingCourse | null;
  /** The next newest published courses after the spotlight. */
  featuredCourses: LandingCourse[];
  totalCourses: number;
  totalCategories: number;
  totalLessons: number;
};

const isPublished = eq(courses.status, CourseStatus.Published);

function getNewestPublished(db: Db, limit: number) {
  return db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      description: courses.description,
      coverImageUrl: courses.coverImageUrl,
      instructorName: users.name,
      categoryName: categories.name,
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .innerJoin(categories, eq(courses.categoryId, categories.id))
    .where(isPublished)
    .orderBy(desc(courses.createdAt), desc(courses.id))
    .limit(limit)
    .all();
}

function getLessonCounts(db: Db, courseIds: number[]) {
  const rows = db
    .select({ courseId: modules.courseId, lessonCount: count(lessons.id) })
    .from(modules)
    .innerJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(inArray(modules.courseId, courseIds))
    .groupBy(modules.courseId)
    .all();
  return new Map(rows.map((row) => [row.courseId, row.lessonCount]));
}

function singleCount(rows: { total: number }[]) {
  const [{ total }] = rows;
  return total;
}

function countPublishedCourses(db: Db) {
  return singleCount(
    db.select({ total: count() }).from(courses).where(isPublished).all()
  );
}

function countCategories(db: Db) {
  return singleCount(db.select({ total: count() }).from(categories).all());
}

function countPublishedLessons(db: Db) {
  return singleCount(
    db
      .select({ total: count() })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(modules.courseId, courses.id))
      .where(isPublished)
      .all()
  );
}

export function getLandingPage(db: Db): LandingPage {
  const newest = getNewestPublished(db, FEATURED_COUNT + 1);
  const lessonCounts = getLessonCounts(
    db,
    newest.map((course) => course.id)
  );
  const withCounts = newest.map((course) => ({
    ...course,
    lessonCount: lessonCounts.get(course.id) ?? 0,
  }));
  const [spotlight = null, ...featuredCourses] = withCounts;

  return {
    spotlight,
    featuredCourses,
    totalCourses: countPublishedCourses(db),
    totalCategories: countCategories(db),
    totalLessons: countPublishedLessons(db),
  };
}
