import {
  queryGeneric, mutationGeneric, internalQueryGeneric, internalMutationGeneric,
  actionGeneric, internalActionGeneric,
  type DataModelFromSchemaDefinition, type DocumentByName,
  type QueryBuilder, type MutationBuilder, type ActionBuilder,
  type GenericQueryCtx, type GenericMutationCtx,
} from "convex/server";
import type { GenericId } from "convex/values";
import schema from "./schema";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type Doc<T extends keyof DataModel> = DocumentByName<DataModel, T>;
export type Id<T extends keyof DataModel | "_storage"> = GenericId<T>;
export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export const query: QueryBuilder<DataModel, "public"> = queryGeneric;
export const mutation: MutationBuilder<DataModel, "public"> = mutationGeneric;
export const internalQuery: QueryBuilder<DataModel, "internal"> = internalQueryGeneric;
export const internalMutation: MutationBuilder<DataModel, "internal"> = internalMutationGeneric;
export const internalAction: ActionBuilder<DataModel, "internal"> = internalActionGeneric;
export const action: ActionBuilder<DataModel, "public"> = actionGeneric;
