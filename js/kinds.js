// What a task is: one field, `kind`.
//   todo   something to do; it gets planned (the default)
//   saved  comes back without a fixed rhythm; you put it on a day yourself (gym, cleaning, the travel legs)
//   meal   an old meal type; converted at start into a saved task in a meal category (v87)
//   event  has a fixed date (and maybe a time); the planner never moves it
//   step   a small task a rule or a preparation adds (↳), listed under Preparations
// Attributes that describe a task rather than what it is stay separate: `travelRole` (a saved task used
// as "Get there" / "Come back"), `allDay` (an event without a time), `check` (the meal ingredient check).
// Blocks have a `kind` of their own (prep, meal, groceries, followup): that is what the block is for.
//
// (v89) The booleans of records from before v34 (helper, routine, meal, event) are no longer read: none were left.
export const KINDS = ['todo', 'saved', 'meal', 'event', 'step'];

export function kindOf(x) {
  if (!x) return null;
  return KINDS.includes(x.kind) ? x.kind : 'todo';
}
export const isTodo = (x) => kindOf(x) === 'todo';
export const isEvent = (x) => kindOf(x) === 'event';
export const isStep = (x) => kindOf(x) === 'step';
export const isMealType = (x) => kindOf(x) === 'meal';
// Lives under Saved: saved tasks and meal types.
export const isSaved = (x) => kindOf(x) === 'saved' || kindOf(x) === 'meal';

// The record with its `kind` set.
export function withKind(x, kind = kindOf(x)) { return { ...x, kind }; }
