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

type JobStoreFacade = {
  create: PostgresJobStore["create"];
  get: PostgresJobStore["get"];
  update: PostgresJobStore["update"];
  setStatus: PostgresJobStore["setStatus"];
  markDispatched: PostgresJobStore["markDispatched"];
  markDispatchFailed: PostgresJobStore["markDispatchFailed"];
  listStaleQueued: PostgresJobStore["listStaleQueued"];
  oldestQueuedAgeSeconds: PostgresJobStore["oldestQueuedAgeSeconds"];
  list: PostgresJobStore["list"];
};

/** Default store singleton used by routes. */
export const jobStore: JobStoreFacade = {
  create: (...args) => getJobStore().create(...args),
  get: (...args) => getJobStore().get(...args),
  update: (...args) => getJobStore().update(...args),
  setStatus: (...args) => getJobStore().setStatus(...args),
  markDispatched: (...args) => getJobStore().markDispatched(...args),
  markDispatchFailed: (...args) => getJobStore().markDispatchFailed(...args),
  listStaleQueued: (...args) => getJobStore().listStaleQueued(...args),
  oldestQueuedAgeSeconds: (...args) => getJobStore().oldestQueuedAgeSeconds(...args),
  list: () => getJobStore().list(),
};
