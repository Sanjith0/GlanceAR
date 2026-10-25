import { cronJobs, anyApi } from "convex/server";
const crons = cronJobs();
crons.interval("purge expired raw recordings and orphan uploads", { minutes: 5 }, anyApi.jobs.sweep, {});
export default crons;
