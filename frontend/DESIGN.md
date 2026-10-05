# StudyMate — Design Brief

Use this brief (as a prompt for people or AI tools) whenever a screen is added or changed.

> Design StudyMate as a **calm academic workspace**. Every screen answers exactly one
> question for the student, shows the answer first, and hides everything else behind
> one click. It should feel quiet, precise and trustworthy — closer to Linear or Apple
> Notes than to a busy analytics dashboard.

## One screen = one question

| Screen     | Question it answers                     | What it shows first                       |
|------------|-----------------------------------------|-------------------------------------------|
| Overview   | How am I doing and what is next?        | 3 key numbers, next class, what needs attention |
| Schedule   | Where do I need to be today?            | One day at a time, today selected by default |
| Grades     | What are my grades?                     | Course list grouped by semester            |
| Attendance | Am I at risk of FX?                     | Overall rate, then each course vs the 20% limit |

## Rules

1. **At most 3 headline numbers per screen.** Everything else is secondary text.
2. **No duplicates.** A status (e.g. "Good standing", "Synced") appears once in the whole UI.
3. **One primary action per screen.** Other actions are quiet ghost or icon buttons.
4. **Subtitles fit on one line.** No explanatory paragraphs; move rules to a single footnote.
5. **Colour means status only.** Neutral greys for structure, indigo for interaction,
   green / amber / red only for good / caution / risk.
6. **Navigation lives in the sidebar** (bottom bar on mobile), never inside page content.

## Visual system

- **Type:** Inter only. Page title 24/600, section title 15/600, body 14/400, labels 12/500.
  Numbers use tabular figures.
- **Spacing:** 4-pt grid; cards have 20–24px padding; 24px between sections.
- **Surfaces:** soft grey background, white cards, 1px hairline borders, almost no shadow,
  14px radius on cards, 10px on controls.
- **Accent:** indigo `#4F46E5` (light) / `#818CF8` (dark).
- **Status:** green `#16A34A`, amber `#D97706`, red `#DC2626`, each with a 10% tint background.
- **Motion:** 150–200ms ease-out fades only. No bouncing, glowing or pulsing decorations.
- **Dark mode:** same hierarchy, near-black background, borders instead of shadows.
