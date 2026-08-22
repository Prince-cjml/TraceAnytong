/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as documents from "../documents.js";
import type * as issuances from "../issuances.js";
import type * as jobRules from "../jobRules.js";
import type * as jobs from "../jobs.js";
import type * as storage from "../storage.js";
import type * as traceCases from "../traceCases.js";
import type * as webSessions from "../webSessions.js";
import type * as workerAuth from "../workerAuth.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audit: typeof audit;
  auth: typeof auth;
  documents: typeof documents;
  issuances: typeof issuances;
  jobRules: typeof jobRules;
  jobs: typeof jobs;
  storage: typeof storage;
  traceCases: typeof traceCases;
  webSessions: typeof webSessions;
  workerAuth: typeof workerAuth;
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
