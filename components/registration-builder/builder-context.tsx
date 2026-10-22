import { createContext, useContext } from "react";
import type { BuilderModel } from "./use-builder-model";

export const BuilderContext = createContext<BuilderModel | null>(null);

export function useBuilder(): BuilderModel {
  const model = useContext(BuilderContext);
  if (!model) throw new Error("The registration builder context is missing.");
  return model;
}

export type LoadedBuilderModel = BuilderModel & {
  selectedForm: NonNullable<BuilderModel["selectedForm"]>;
  selectedVersion: NonNullable<BuilderModel["selectedVersion"]>;
  definition: NonNullable<BuilderModel["definition"]>;
};

// For zones that only render once a form, a version and its definition are open.
export function useLoadedBuilder(): LoadedBuilderModel {
  const model = useBuilder();
  const { selectedForm, selectedVersion, definition } = model;
  if (!selectedForm || !selectedVersion || !definition) throw new Error("The registration builder has no form open.");
  return { ...model, selectedForm, selectedVersion, definition };
}
