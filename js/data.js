// Exercise library, default plan, default settings.
//
// kind:     'weighted'   = the number you log is the bar or plate weight.
//           'bodyweight' = the number you log is ADDED weight (0 = bodyweight only).
// jump:     which load increment from Settings applies ('upper' or 'lower').
// repRange: [floor, ceiling]. When every working set reaches the ceiling,
//           the next prescription adds one jump. Under the floor two sessions
//           running at 0-1 RIR, it drops one jump.
// rest:     'main' (full rest) or 'pair' (short rest, used inside supersets).

export const MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'core', 'calves'];

export const SEED_EXERCISES = [
  // The five lifts in the default plan.
  { id: 'zercher',  name: 'Zercher squat', kind: 'weighted',   primary: ['quads', 'glutes'],      secondary: ['core'],                 jump: 'lower', repRange: [5, 8],  rest: 'main' },
  { id: 'deadlift', name: 'Deadlift',      kind: 'weighted',   primary: ['hamstrings', 'glutes'], secondary: ['back'],                 jump: 'lower', repRange: [5, 8],  rest: 'main' },
  { id: 'row',      name: 'Barbell row',   kind: 'weighted',   primary: ['back'],                 secondary: ['biceps', 'shoulders'],  jump: 'upper', repRange: [6, 10], rest: 'main' },
  { id: 'dip',      name: 'Dips',          kind: 'bodyweight', primary: ['chest', 'triceps'],     secondary: ['shoulders'],            jump: 'upper', repRange: [3, 6],  rest: 'pair' },
  { id: 'pullup',   name: 'Pull-ups',      kind: 'bodyweight', primary: ['back'],                 secondary: ['biceps'],               jump: 'upper', repRange: [3, 6],  rest: 'pair' },
  // Optional extras. In the library, not in the plan.
  { id: 'chinup',   name: 'Chin-ups',           kind: 'bodyweight', primary: ['back', 'biceps'],       secondary: [],                     jump: 'upper', repRange: [3, 6],   rest: 'pair' },
  { id: 'facepull', name: 'Ring face pull',     kind: 'bodyweight', primary: ['shoulders'],            secondary: ['back'],               jump: 'upper', repRange: [12, 20], rest: 'pair' },
  { id: 'latraise', name: 'Plate lateral raise', kind: 'weighted',  primary: ['shoulders'],            secondary: [],                     jump: 'upper', repRange: [12, 20], rest: 'pair' },
  { id: 'rdl',      name: 'Romanian deadlift',  kind: 'weighted',   primary: ['hamstrings', 'glutes'], secondary: ['back'],               jump: 'lower', repRange: [8, 12],  rest: 'main' },
  { id: 'ohp',      name: 'Overhead press',     kind: 'weighted',   primary: ['shoulders'],            secondary: ['triceps'],            jump: 'upper', repRange: [6, 10],  rest: 'main' },
  { id: 'ringpush', name: 'Ring push-up',       kind: 'bodyweight', primary: ['chest'],                secondary: ['triceps', 'shoulders'], jump: 'upper', repRange: [8, 12], rest: 'pair' },
];

// Two alternating sessions. Dips and pull-ups are a superset (pairNext).
export const DEFAULT_PLAN = {
  nextDay: 0,
  days: [
    { name: 'A', items: [
      { exerciseId: 'zercher', sets: 3 },
      { exerciseId: 'dip',     sets: 3, pairNext: true },
      { exerciseId: 'pullup',  sets: 3 },
      { exerciseId: 'row',     sets: 3 },
    ] },
    { name: 'B', items: [
      { exerciseId: 'deadlift', sets: 3 },
      { exerciseId: 'dip',      sets: 3, pairNext: true },
      { exerciseId: 'pullup',   sets: 3 },
      { exerciseId: 'row',      sets: 3 },
    ] },
  ],
};

export const DEFAULT_SETTINGS = {
  units: 'lb',
  jumpUpper: 5,
  jumpLower: 10,
  restMain: 150,
  restPair: 75,
  bodyweight: null,
  deloadEveryWeeks: 5,
  deloadUntil: null,
  lastDeloadEnd: null,
  deloadDismissedAt: null,
};
