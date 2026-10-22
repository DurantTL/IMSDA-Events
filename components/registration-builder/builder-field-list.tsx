// Field list zone: the "Add module" button and the ready-made module library
// that adds fields to a section. Today it opens under a section; this is the
// piece that becomes the left-hand field list.
import { Layers3, Plus, Search, X } from "lucide-react";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { moduleCategories } from "./builder-types";
import { useLoadedBuilder } from "./builder-context";

export function BuilderFieldList({ section, sectionIndex }: { section: RegistrationFormDefinition["sections"][number]; sectionIndex: number }) {
  const { openModuleSection, setOpenModuleSection, moduleQuery, setModuleQuery, moduleCategory, setModuleCategory, closeModuleLibrary, visibleFieldModules, canEdit, addModule } = useLoadedBuilder();
  if (!canEdit) return null;
  return (
    <>
            <button
              className="add-field-button"
              type="button"
              onClick={() => {
                if (openModuleSection === sectionIndex) closeModuleLibrary();
                else setOpenModuleSection(sectionIndex);
              }}
            >
              <Plus size={15} /> Add module to {section.title}
            </button>
            {openModuleSection === sectionIndex && (
              <div className="module-library">
                <div className="module-library-head">
                  <div>
                    <p className="eyebrow">Drop-in modules</p>
                    <strong>Search or filter ready-made blocks</strong>
                  </div>
                  <button
                    className="icon-button modal-close-button"
                    type="button"
                    aria-label="Close module library"
                    onClick={closeModuleLibrary}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="module-library-filters">
                  <label>
                    Search modules
                    <span className="search-input">
                      <Search size={14} aria-hidden="true" />
                      <input autoComplete="off" name="builder-rb-field-18"
                        value={moduleQuery}
                        placeholder="Contact, housing, meals…"
                        onChange={(event) => setModuleQuery(event.target.value)}
                      />
                    </span>
                  </label>
                  <label>
                    Category
                    <select
                      value={moduleCategory}
                      onChange={(event) => setModuleCategory(
                        event.target.value as typeof moduleCategories[number],
                      )}
                    >
                      {moduleCategories.map((category) => (
                        <option value={category} key={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {visibleFieldModules.length === 0 ? (
                  <p className="module-library-empty">
                    No modules match that search.
                  </p>
                ) : (
                  <div className="module-grid">
                    {visibleFieldModules.map((module) => (
                      <button
                        type="button"
                        key={module.key}
                        onClick={() => addModule(sectionIndex, module)}
                      >
                        <span><Layers3 size={17} /></span>
                        <strong>{module.name}</strong>
                        <small>{module.description}</small>
                        <b>
                          {module.category} · {module.fields.length} field
                          {module.fields.length === 1 ? "" : "s"}
                        </b>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
    </>
  );
}
