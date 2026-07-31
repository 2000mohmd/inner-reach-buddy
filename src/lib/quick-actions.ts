export type QuickAction = {
  id: string;
  label: string;
  prompt: string;
};

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "anxious",
    label: "I'm feeling anxious",
    prompt: "I'm feeling anxious right now.",
  },
  {
    id: "reframe",
    label: "Help me reframe a thought",
    prompt: "There's a thought stuck in my head that I'd like help reframing.",
  },
  {
    id: "grounding",
    label: "I need a grounding exercise",
    prompt: "Can you walk me through a grounding exercise?",
  },
  {
    id: "sleep",
    label: "I can't sleep",
    prompt: "I can't switch my mind off enough to sleep.",
  },
  {
    id: "vent",
    label: "I just want to vent",
    prompt: "I just need to get something off my chest.",
  },
];

export const QUICK_ACTION_IDS = QUICK_ACTIONS.map((action) => action.id);
