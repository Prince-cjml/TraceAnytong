/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as artifactRules from "../artifactRules.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as bootstrapFixtures from "../bootstrapFixtures.js";
import type * as contentIndexRules from "../contentIndexRules.js";
import type * as dashboard from "../dashboard.js";
import type * as dashboardRules from "../dashboardRules.js";
import type * as devBootstrap from "../devBootstrap.js";
import type * as documents from "../documents.js";
import type * as issuanceRules from "../issuanceRules.js";
import type * as issuances from "../issuances.js";
import type * as jobRules from "../jobRules.js";
import type * as jobs from "../jobs.js";
import type * as onboarding from "../onboarding.js";
import type * as onboardingRules from "../onboardingRules.js";
import type * as storage from "../storage.js";
import type * as traceCandidateSnapshotRules from "../traceCandidateSnapshotRules.js";
import type * as traceCaseRules from "../traceCaseRules.js";
import type * as traceCases from "../traceCases.js";
import type * as traceDecisionRules from "../traceDecisionRules.js";
import type * as traceRankRules from "../traceRankRules.js";
import type * as users from "../users.js";
import type * as watermarkProfileRules from "../watermarkProfileRules.js";
import type * as watermarkProfiles from "../watermarkProfiles.js";
import type * as webSessionRules from "../webSessionRules.js";
import type * as webSessions from "../webSessions.js";
import type * as workerAuth from "../workerAuth.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  artifactRules: typeof artifactRules;
  audit: typeof audit;
  auth: typeof auth;
  bootstrapFixtures: typeof bootstrapFixtures;
  contentIndexRules: typeof contentIndexRules;
  dashboard: typeof dashboard;
  dashboardRules: typeof dashboardRules;
  devBootstrap: typeof devBootstrap;
  documents: typeof documents;
  issuanceRules: typeof issuanceRules;
  issuances: typeof issuances;
  jobRules: typeof jobRules;
  jobs: typeof jobs;
  onboarding: typeof onboarding;
  onboardingRules: typeof onboardingRules;
  storage: typeof storage;
  traceCandidateSnapshotRules: typeof traceCandidateSnapshotRules;
  traceCaseRules: typeof traceCaseRules;
  traceCases: typeof traceCases;
  traceDecisionRules: typeof traceDecisionRules;
  traceRankRules: typeof traceRankRules;
  users: typeof users;
  watermarkProfileRules: typeof watermarkProfileRules;
  watermarkProfiles: typeof watermarkProfiles;
  webSessionRules: typeof webSessionRules;
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
