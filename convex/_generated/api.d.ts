/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as demoAudio from "../demoAudio.js";
import type * as demoSummary from "../demoSummary.js";
import type * as glance from "../glance.js";
import type * as jobs from "../jobs.js";
import type * as meta from "../meta.js";
import type * as pipeline from "../pipeline.js";
import type * as server from "../server.js";
import type * as validation from "../validation.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  demoAudio: typeof demoAudio;
  demoSummary: typeof demoSummary;
  glance: typeof glance;
  jobs: typeof jobs;
  meta: typeof meta;
  pipeline: typeof pipeline;
  server: typeof server;
  validation: typeof validation;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
