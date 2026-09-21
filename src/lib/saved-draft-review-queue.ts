// One browser session: serialize rechecks and deduplicate StrictMode/remounts.
export function createSavedDraftReviewQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  const jobs = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, work: () => Promise<T>): Promise<T> {
      const existing = jobs.get(key);
      if (existing) return existing as Promise<T>;
      const job = tail.then(work);
      jobs.set(key, job);
      tail = job.catch(() => undefined);
      return job;
    },
    retry(key: string) { jobs.delete(key); },
  };
}
