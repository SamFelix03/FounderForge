import {
  PostgresJobStore,
  getJobStore,
  setJobStoreForTests,
  createPool,
  migrate,
  closePool,
  resetPoolForTests,
} from "@founderforge/db";

export {
  PostgresJobStore as JobStore,
  getJobStore,
  setJobStoreForTests,
  createPool,
  migrate,
  closePool,
  resetPoolForTests,
};

/** Default store singleton used by routes. */
export const jobStore = {
  create: (...args: Parameters<PostgresJobStore["create"]>) => getJobStore().create(...args),
  get: (...args: Parameters<PostgresJobStore["get"]>) => getJobStore().get(...args),
  update: (...args: Parameters<PostgresJobStore["update"]>) => getJobStore().update(...args),
  setStatus: (...args: Parameters<PostgresJobStore["setStatus"]>) =>
    getJobStore().setStatus(...args),
  list: () => getJobStore().list(),
};
