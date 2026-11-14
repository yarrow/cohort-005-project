import { db } from "~/db";
import { getLandingPage, type Db } from "./lib/landing";

export type { LandingCourse, LandingPage } from "./lib/landing";

/**
 * The landing page's data bound to a database. The app uses `landing`,
 * which reads the app database; tests build their own against a test
 * database.
 */
export function createLanding(database: Db) {
  return {
    /**
     * Everything the landing page at `/` shows: the newest published course
     * as the spotlight, the next three newest as featured courses, each with
     * its lesson count, and the published course, category and lesson
     * totals. Drafts and archived courses never appear or count.
     */
    get() {
      return getLandingPage(database);
    },
  };
}

// Pure so a route importing this only for its loader doesn't pull the
// database into the client bundle (see `~/db`).
export const landing = /* @__PURE__ */ createLanding(db);
