// Where the agent appears (the panel's "Where I appear"): 'off' (beside the cursor, the default), 'drop' (the capsule
// at the top of the screen, on every desktop) or, with a notched screen (a Mac), 'spread' (widening out of the notch);
// without one, 'spread' is the capsule. See showcase/roamies/notch.js.
export const pickNotch = ({ notchScreen, pick }) => (pick === 'drop' || (pick === 'spread' && !notchScreen) ? 'drop' : pick === 'spread' ? 'spread' : 'off');
