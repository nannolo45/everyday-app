// What a task is: one field, `kind`.
//   todo   something to do; it gets planned (the default)
//   saved  comes back without a fixed rhythm; you put it on a day yourself (gym, cleaning, the travel legs)
//   meal   a meal type (Breakfast, Lunch…): a saved task the meal planner uses
//   event  has a fixed date (and maybe a time); the planner never moves it
//   step   a small task a rule or a preparation adds (↳), listed under Preparations
// Attributes that describe a task rather than what it is stay separate: `travelRole` (a saved task used
// as "Get there" / "Come back"), `allDay` (an event without a time), `check` (the meal ingredient check).
// Blocks have a `kind` of their own (prep, meal, groceries, followup): that is what the block is for.
//
// Records written before v34 carry booleans instead (helper, routine, meal, event); kindOf reads both,
// and withKind turns an old record into the new shape.
export const KINDS = ['todo', 'saved', 'meal', 'event', 'step'];
const LEGACY = ['helper', 'routine', 'meal', 'event'];

export function kindOf(x) {
  if (!x) return null;
  if (KINDS.includes(x.kind)) return x.kind;
  if (x.event) return 'event';
  if (x.helper) return 'step';
  if (x.meal) return 'meal';
  if (x.routine) return 'saved';
  return 'todo';
}
export const isTodo = (x) => kindOf(x) === 'todo';
export const isEvent = (x) => kindOf(x) === 'event';
export const isStep = (x) => kindOf(x) === 'step';
export const isMealType = (x) => kindOf(x) === 'meal';
// Lives under Saved: saved tasks and meal types.
export const isSaved = (x) => kindOf(x) === 'saved' || kindOf(x) === 'meal';

// The record with `kind` set and the old booleans gone.
export function withKind(x, kind = kindOf(x)) {
  const out = { ...x, kind };
  for (const k of LEGACY) delete out[k];
  return out;
}
// Does this record still need converting?
export const needsKind = (x) => !KINDS.includes(x?.kind) || LEGACY.some((k) => k in x);
