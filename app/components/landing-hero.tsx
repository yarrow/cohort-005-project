import { Link } from "react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "~/components/ui/button";
import { CourseImage } from "~/components/course-image";
import { CourseByline } from "~/components/course-byline";
import type { LandingCourse } from "~/modules/landing/index.server";

export function LandingHero({
  spotlight,
  totalCourses,
  totalLessons,
  isSignedIn,
}: {
  spotlight: LandingCourse | null;
  totalCourses: number;
  totalLessons: number;
  isSignedIn: boolean;
}) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-linear-to-br from-muted/70 via-background to-background"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 sm:py-20 lg:grid-cols-[1.15fr_1fr] lg:py-28">
        <HeroCopy
          totalCourses={totalCourses}
          totalLessons={totalLessons}
          isSignedIn={isSignedIn}
        />
        {spotlight && <SpotlightCard course={spotlight} />}
      </div>
    </section>
  );
}

function HeroCopy({
  totalCourses,
  totalLessons,
  isSignedIn,
}: {
  totalCourses: number;
  totalLessons: number;
  isSignedIn: boolean;
}) {
  return (
    <div>
      <p className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" />
        {totalCourses} courses · {totalLessons} lessons
      </p>
      <h1 className="mt-6 text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
        Learn to code,
        <br />
        <span className="text-muted-foreground">at your own pace</span>
      </h1>
      <p className="mt-6 max-w-xl text-lg text-muted-foreground">
        Structured courses built by experienced instructors. Track your
        progress, take quizzes, and build real-world skills.
      </p>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <Link to="/courses">
            Browse Courses
            <ArrowRight className="ml-2 size-4" />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          {isSignedIn ? (
            <Link to="/dashboard">Go to your dashboard</Link>
          ) : (
            <Link to="/signup">Create a free account</Link>
          )}
        </Button>
      </div>
    </div>
  );
}

function SpotlightCard({ course }: { course: LandingCourse }) {
  return (
    <div className="relative mx-auto w-full max-w-md lg:mr-0">
      <div
        aria-hidden
        className="absolute inset-0 translate-x-3 translate-y-3 rotate-2 rounded-xl border border-border bg-muted"
      />
      <Link
        to={`/courses/${course.slug}`}
        className="group relative block overflow-hidden rounded-xl border border-border bg-card shadow-lg transition-shadow hover:shadow-xl"
      >
        <span className="absolute top-3 left-3 z-10 rounded-full bg-background/90 px-2.5 py-1 text-xs font-semibold shadow-sm">
          New · {course.categoryName}
        </span>
        <CourseImage
          src={course.coverImageUrl}
          alt={course.title}
          className="aspect-video w-full object-cover"
        />
        <div className="p-5">
          <h2 className="text-lg font-semibold leading-snug group-hover:text-primary">
            {course.title}
          </h2>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {course.description}
          </p>
          <CourseByline
            instructorName={course.instructorName}
            lessonCount={course.lessonCount}
            className="mt-4"
          />
        </div>
      </Link>
    </div>
  );
}
