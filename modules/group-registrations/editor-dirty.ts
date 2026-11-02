type Answers = Record<string, unknown>;

export type GroupEditorStaged = {
  keptIds: readonly string[];
  newPersonCount: number;
  locationId: string | null;
  /** Answers by client id, as the people's form last reported them. */
  answers: Record<string, Answers>;
};

export type GroupEditorLoaded = {
  attendees: ReadonlyArray<{ attendeeId: string; clientId: string; responses: Answers }>;
  locationId: string | null;
};

const isBlank = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

function sameAnswers(a: Answers, b: Answers): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) => {
    const left = a[key];
    const right = b[key];
    if (isBlank(left) && isBlank(right)) return true;
    return JSON.stringify(left) === JSON.stringify(right);
  });
}

/**
 * True when the staged edits (someone unticked or added, another location, changed answers) differ from what is
 * registered. Putting everything back makes it clean again; an empty answer equals a missing one (B6, #1468).
 */
export function groupEditorChanged(staged: GroupEditorStaged, loaded: GroupEditorLoaded): boolean {
  if (staged.newPersonCount > 0) return true;
  if (staged.locationId !== loaded.locationId) return true;
  const kept = new Set(staged.keptIds);
  if (kept.size !== loaded.attendees.length || loaded.attendees.some((person) => !kept.has(person.attendeeId))) return true;
  return loaded.attendees.some((person) => {
    const answered = staged.answers[person.clientId];
    return answered !== undefined && !sameAnswers(answered, person.responses);
  });
}
